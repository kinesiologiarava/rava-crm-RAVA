import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, LineChart, Line } from "recharts";
import { IDS_ACTIVOS, IDS_TODOS, COLOR_POR_PROFESIONAL, PROFESIONALES_ACTIVOS } from "./lib/profesionales.js";
import { parseCabeceraOSDE } from "./lib/parseCabeceraOSDE.js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const ARANCELES_REALES = {
  FKT:        { OSDE: 11970.61, MEDIFE: 9052.00, PARTICULAR: 10000 },
  RPG:        { OSDE: 24058.00, MEDIFE: null,     PARTICULAR: 40000 },
  DRENAJE:    { OSDE: 20897.07, MEDIFE: null,     PARTICULAR: 40000 },
  ATM:        { OSDE: null,     MEDIFE: null,     PARTICULAR: 40000 },
};

// Aranceles dinámicos — leen de Supabase si están disponibles
function getAranceles(precios) {
  return {
    FKT:       { OSDE: precios?.osde_fkt     ?? 11970.61, MEDIFE: precios?.medife_sesion ?? 9233, PARTICULAR: 10000 },
    RPG:       { OSDE: precios?.osde_rpg     ?? 24058.00, MEDIFE: null,  PARTICULAR: 40000 },
    DRENAJE:   { OSDE: precios?.osde_drenaje ?? 20897.07, MEDIFE: null,  PARTICULAR: 40000 },
    ATM:       { OSDE: precios?.osde_atm     ?? 11970.61, MEDIFE: null,  PARTICULAR: 40000 },
    OSTEOPATIA:{ OSDE: null,                              MEDIFE: null,  PARTICULAR: 60000 },
  };
}
const VALORES_PROF = {
  ISOLINA:     { prepaga: 3850,  particular: 10000, regalo: 3000  },
  DAVID:       { prepaga: 3850,  particular: 10000, regalo: 3000  },
  FRANCISCO:   { prepaga: 3600,  particular:  8000, regalo: 3000  },
  "JUAN CRUZ": { prepaga: 3600,  particular:  8000, regalo: 3000  },
  MILAGROS:    { prepaga: 3600,  particular:  8000, regalo: 3000  },
  BELEN:       { prepaga: 3600,  particular:  8000, regalo: 3000  }, // provisorio, misma tarifa que Milagros/Francisco/Juan Cruz — ajustar en Lista de Precios cuando se defina
  PAULA:       { prepaga: 14500, particular:     0, regalo: 14000, soloRPG: true },
  DANIELA:     { prepaga: 0,     particular:     0, regalo: 0,    esDuena: true },
};
// Ingreso por regalo: $9.233 por sesión (arancel MEDIFE)
const ARANCEL_REGALO = 9233;
const PRESTACIONES = Object.keys(ARANCELES_REALES);

// Registros sincronizados desde Fichas ("FICHAS_AUTO"/"FICHAS_REGALO") o cargados
// desde Control Diario ("CONTROL DIARIO") traen cantidad de sesiones pero no el tipo
// de prestación (FKT/RPG/DRENAJE) por fila. Sin esto, calcIngresoBruto/PorOS/PorPrestacion
// no encuentran arancel y esas filas suman $0 aunque representen atención real.
// Se infiere la especialidad por profesional (Daniela es aproximado: también hace
// Osteopatía/RPG, pero no se puede distinguir por fila — se usa Drenaje, su tipo más frecuente).
const ESPECIALIDAD_DEFAULT = { PAULA: "RPG", DANIELA: "DRENAJE" };
function prestacionEfectiva(prof, prestacion, aranceles) {
  if (aranceles[prestacion]) return prestacion;
  return ESPECIALIDAD_DEFAULT[prof] || "FKT";
}
const NOMBRES_MES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
// Antes era un objeto fijo con 5 meses hardcodeados (se rompía apenas pasaba el tiempo).
// Ahora formatea cualquier "YYYY-MM" válido; si el valor está corrupto, devuelve undefined
// y el "||m" de cada lugar que lo usa cae al string crudo (para poder detectarlo a simple vista).
const MES_LABELS = new Proxy({}, {
  get: (_, key) => {
    if (typeof key !== "string") return undefined;
    const m = key.match(/^(\d{4})-(\d{2})$/);
    if (!m) return undefined;
    const nombre = NOMBRES_MES[parseInt(m[2], 10) - 1];
    return nombre ? `${nombre} ${m[1]}` : undefined;
  }
});
const CATEGORIAS_GASTO = ["Expensas","Luz","Insumos","Limpieza","Sueldo Susana","Honorarios Contabilidad","Alquiler","Otros"];
const PIE_COLORS = ["#4338ca","#7c3aed","#059669","#d97706","#06b6d4","#a78bfa","#f43f5e","#34d399"];

function getMesActual() {
  const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}
const fp = n => n==null||isNaN(n) ? "-" : "$"+Number(n).toLocaleString("es-AR",{minimumFractionDigits:0,maximumFractionDigits:0});
const fid = () => Math.random().toString(36).slice(2,9);

// ─── DATOS INICIALES ──────────────────────────────────────────────────────────
// Todos los datos se cargan desde Supabase — array vacío
const REGISTROS_INIT = [];

const GASTOS_INIT = [
  { id:"g1", mes:"2026-02", categoria:"Sueldo Susana", monto:750000, notas:"Febrero 2026" },
  { id:"g2", mes:"2026-02", categoria:"Expensas",      monto:0,      notas:"" },
  { id:"g3", mes:"2026-02", categoria:"Luz",           monto:0,      notas:"" },
];

// Cobros OSDE reales registrados (período 15-15)

// ─── CÁLCULOS ─────────────────────────────────────────────────────────────────
function calcResumen(registros, mes) {
  const filtered = mes ? registros.filter(r=>r.mes===mes) : registros;
  const res = {};
  IDS_TODOS.forEach(p=>{ res[p]={osde:0,medife:0,particular:0,regalo:0,pasadaOsde:0,prest:{}}; });
  filtered.forEach(r=>{
    if(!res[r.prof]) res[r.prof]={osde:0,medife:0,particular:0,regalo:0,pasadaOsde:0,prest:{}};
    res[r.prof].osde      += r.osde||0;
    res[r.prof].medife    += r.medife||0;
    res[r.prof].particular+= r.particular||0;
    res[r.prof].regalo    += r.regalo||0;
    res[r.prof].pasadaOsde+= r.pasada_osde||0;
    if(!res[r.prof].prest[r.prestacion]) res[r.prof].prest[r.prestacion]={osde:0,medife:0,particular:0};
    res[r.prof].prest[r.prestacion].osde      += r.osde||0;
    res[r.prof].prest[r.prestacion].medife    += r.medife||0;
    res[r.prof].prest[r.prestacion].particular+= r.particular||0;
  });
  return res;
}

function calcHonorario(prof, d, precios=null) {
  const v = VALORES_PROF[prof];
  if(!v||v.esDuena) return 0;
  // Usar precios dinámicos de Supabase si están disponibles
  const key = prof.toLowerCase().replace(" ","");
  const prepaga   = precios?.[`hon_${key}_prepaga`]   ?? v.prepaga;
  const particular= precios?.[`hon_${key}_particular`]?? v.particular;
  const regalo    = precios?.[`hon_${key}_regalo`]    ?? v.regalo;
  if(v.soloRPG) return (d.osde+(d.regalo||0))*prepaga;
  return (d.osde+d.medife)*prepaga + d.particular*particular + (d.regalo||0)*regalo;
}

function calcIngresoBruto(registros, mes, precios=null) {
  const aranceles = getAranceles(precios);
  return registros.filter(r=>!mes||r.mes===mes).reduce((sum,r)=>{
    const ar=aranceles[prestacionEfectiva(r.prof,r.prestacion,aranceles)];
    return sum+((r.osde||0)+(r.pasada_osde||0))*(ar.OSDE||0)+(r.medife||0)*(ar.MEDIFE||0)+(r.particular||0)*(ar.PARTICULAR||0);
  },0);
}

function calcIngresoPorOS(registros, mes, precios=null) {
  const aranceles = getAranceles(precios);
  return registros.filter(r=>!mes||r.mes===mes).reduce((acc,r)=>{
    const ar=aranceles[prestacionEfectiva(r.prof,r.prestacion,aranceles)];
    acc.OSDE      += ((r.osde||0)+(r.pasada_osde||0))*(ar.OSDE||0);
    acc.MEDIFE    += (r.medife||0)*(ar.MEDIFE||0);
    acc.PARTICULAR+= (r.particular||0)*(ar.PARTICULAR||0);
    return acc;
  },{OSDE:0,MEDIFE:0,PARTICULAR:0});
}

function calcIngresoPorPrestacion(registros, mes, precios=null) {
  const aranceles = getAranceles(precios);
  const acc={};
  registros.filter(r=>!mes||r.mes===mes).forEach(r=>{
    const prestEf=prestacionEfectiva(r.prof,r.prestacion,aranceles);
    const ar=aranceles[prestEf];
    if(!acc[prestEf]) acc[prestEf]={OSDE:0,MEDIFE:0,PARTICULAR:0,total:0};
    acc[prestEf].OSDE      += ((r.osde||0)+(r.pasada_osde||0))*(ar.OSDE||0);
    acc[prestEf].MEDIFE    += (r.medife||0)*(ar.MEDIFE||0);
    acc[prestEf].PARTICULAR+= (r.particular||0)*(ar.PARTICULAR||0);
    acc[prestEf].total     += ((r.osde||0)+(r.pasada_osde||0))*(ar.OSDE||0)+(r.medife||0)*(ar.MEDIFE||0)+(r.particular||0)*(ar.PARTICULAR||0);
  });
  return acc;
}

// ─── ESTILOS ──────────────────────────────────────────────────────────────────
const S = {
  input: {background:"#f8faff",border:"1px solid #c7d2fe",borderRadius:8,padding:"8px 12px",color:"#1e293b",fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"},
  label: {display:"block",color:"#64748b",fontSize:10,fontWeight:700,marginBottom:5,letterSpacing:1,textTransform:"uppercase"},
  th:    {color:"#64748b",fontWeight:700,fontSize:11,padding:"10px 12px",textAlign:"left",letterSpacing:.5,borderBottom:"1px solid #dbeafe"},
  td:    {padding:"9px 12px",borderBottom:"1px solid #e0e7ff",verticalAlign:"middle"},
  btn:   (c="#4338ca",sz=13)=>({background:c,color:["#e2e8f0","#f1f5f9","#64748b"].includes(c)?"#475569":"#fff",border:"none",borderRadius:8,padding:`${sz>11?9:6}px ${sz>11?20:14}px`,fontWeight:700,cursor:"pointer",fontSize:sz,fontFamily:"inherit"}),
};
const Card = ({children,style={}}) => <div style={{background:"#ffffff",border:"1px solid #dbeafe",borderRadius:14,padding:20,boxShadow:"0 2px 8px rgba(99,102,241,0.08)",...style}}>{children}</div>;
const Badge = ({children,color="#4338ca"}) => <span style={{background:color+"22",color,border:`1px solid ${color}44`,borderRadius:6,padding:"2px 8px",fontSize:11,fontWeight:700}}>{children}</span>;
const StatCard = ({label,value,color="#4338ca",sub}) => (
  <div style={{background:"#eef2f7",border:`1px solid ${color}33`,borderRadius:12,padding:"15px 18px",flex:1,minWidth:140}}>
    <div style={{color:"#64748b",fontSize:10,fontWeight:700,letterSpacing:1,marginBottom:5}}>{label}</div>
    <div style={{color,fontSize:20,fontWeight:800,fontFamily:"'DM Mono',monospace"}}>{value}</div>
    {sub&&<div style={{color:"#94a3b8",fontSize:11,marginTop:3}}>{sub}</div>}
  </div>
);
function EN({val,onChange,color="#4338ca"}) {
  const [ed,setEd]=useState(false);
  const [tmp,setTmp]=useState(val);
  if(ed) return <input autoFocus type="number" value={tmp} onChange={e=>setTmp(e.target.value)}
    onBlur={()=>{onChange(tmp);setEd(false)}} onKeyDown={e=>{if(e.key==="Enter"){onChange(tmp);setEd(false)}}}
    style={{...S.input,width:75,padding:"3px 7px",textAlign:"right"}}/>;
  return <span onClick={()=>{setTmp(val);setEd(true)}} title="Click para editar"
    style={{color,fontWeight:700,cursor:"pointer",padding:"2px 5px",borderRadius:4,
    borderBottom:`1px dashed ${color}55`,minWidth:28,display:"inline-block",textAlign:"right"}}>{val}</span>;
}

const TooltipCustom = ({active,payload,label}) => {
  if(!active||!payload?.length) return null;
  return (
    <div style={{background:"#1e3a6e",border:"none",borderRadius:10,padding:"10px 14px"}}>
      <div style={{color:"#94a3b8",fontSize:12,marginBottom:6,fontWeight:700}}>{label}</div>
      {payload.map((p,i)=>(
        <div key={i} style={{color:p.color,fontSize:12,marginBottom:2}}>
          {p.name}: <strong>{fp(p.value)}</strong>
        </div>
      ))}
    </div>
  );
};

// ─── VISTA: INGRESOS BRUTOS (GRÁFICOS) ───────────────────────────────────────
function ViewIngresos({registros}) {
  const mesesDisp = [...new Set(registros.map(r=>r.mes))].sort();
  const [mes,setMes] = useState(getMesActual());

  const porOS = useMemo(()=>calcIngresoPorOS(registros,mes),[registros,mes]);
  const porPrest = useMemo(()=>calcIngresoPorPrestacion(registros,mes),[registros,mes]);
  const bruto = porOS.OSDE+porOS.MEDIFE+porOS.PARTICULAR;

  // Data para gráfico barras por prestación
  const barData = Object.entries(porPrest).map(([prest,d])=>({
    name:prest, OSDE:Math.round(d.OSDE), MEDIFE:Math.round(d.MEDIFE), PARTICULAR:Math.round(d.PARTICULAR)
  }));

  // Data pie OS
  const pieDataOS = [
    {name:"OSDE",     value:Math.round(porOS.OSDE)},
    {name:"MEDIFE",   value:Math.round(porOS.MEDIFE)},
    {name:"PARTICULAR",value:Math.round(porOS.PARTICULAR)},
  ].filter(d=>d.value>0);

  // Tendencia mensual
  const tendencia = mesesDisp.map(m=>{
    const b = calcIngresoPorOS(registros,m);
    return { mes:MES_LABELS[m]||m, OSDE:Math.round(b.OSDE), MEDIFE:Math.round(b.MEDIFE), PARTICULAR:Math.round(b.PARTICULAR), Total:Math.round(b.OSDE+b.MEDIFE+b.PARTICULAR) };
  });

  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
        {mesesDisp.concat([getMesActual()]).filter((v,i,a)=>a.indexOf(v)===i).reverse().map(m=>(
          <button key={m} onClick={()=>setMes(m)} style={{...S.btn(mes===m?"#4338ca":"#e2e8f0",12),padding:"7px 16px"}}>
            {MES_LABELS[m]||m}
          </button>
        ))}
      </div>

      <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:24}}>
        <StatCard label="TOTAL BRUTO" value={fp(bruto)} color="#4338ca"/>
        <StatCard label="OSDE" value={fp(porOS.OSDE)} color="#4338ca" sub={bruto>0?`${(porOS.OSDE/bruto*100).toFixed(1)}% del total`:""}/>
        <StatCard label="MEDIFE" value={fp(porOS.MEDIFE)} color="#7c3aed" sub={bruto>0?`${(porOS.MEDIFE/bruto*100).toFixed(1)}% del total`:""}/>
        <StatCard label="PARTICULAR" value={fp(porOS.PARTICULAR)} color="#059669" sub={bruto>0?`${(porOS.PARTICULAR/bruto*100).toFixed(1)}% del total`:""}/>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:20}}>
        {/* Pie OS */}
        <Card>
          <div style={{color:"#1e293b",fontWeight:700,marginBottom:14,fontSize:13}}>🥧 Distribución por Obra Social</div>
          {pieDataOS.length>0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={pieDataOS} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({name,percent})=>`${name} ${(percent*100).toFixed(0)}%`} labelLine={false}>
                  {pieDataOS.map((_,i)=><Cell key={i} fill={["#4338ca","#7c3aed","#059669"][i]}/>)}
                </Pie>
                <Tooltip formatter={v=>fp(v)} contentStyle={{background:"#1e3a6e",border:"none",borderRadius:10,color:"white"}}/>
              </PieChart>
            </ResponsiveContainer>
          ) : <div style={{color:"#64748b",textAlign:"center",padding:40}}>Sin datos para este período</div>}
        </Card>

        {/* Barras por prestación */}
        <Card>
          <div style={{color:"#1e293b",fontWeight:700,marginBottom:14,fontSize:13}}>📊 Ingreso por Prestación y OS</div>
          {barData.length>0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={barData} margin={{top:5,right:10,bottom:5,left:10}}>
                <XAxis dataKey="name" tick={{fill:"#64748b",fontSize:11}}/>
                <YAxis tick={{fill:"#64748b",fontSize:10}} tickFormatter={v=>v>=1000000?`${(v/1000000).toFixed(1)}M`:v>=1000?`${(v/1000).toFixed(0)}k`:v}/>
                <Tooltip content={<TooltipCustom/>}/>
                <Legend wrapperStyle={{fontSize:11,color:"#94a3b8"}}/>
                <Bar dataKey="OSDE" fill="#4338ca" radius={[3,3,0,0]}/>
                <Bar dataKey="MEDIFE" fill="#7c3aed" radius={[3,3,0,0]}/>
                <Bar dataKey="PARTICULAR" fill="#059669" radius={[3,3,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          ) : <div style={{color:"#64748b",textAlign:"center",padding:40}}>Sin datos</div>}
        </Card>
      </div>

      {/* Tendencia mensual */}
      {tendencia.length>1 && (
        <Card style={{marginBottom:20}}>
          <div style={{color:"#1e293b",fontWeight:700,marginBottom:14,fontSize:13}}>📈 Tendencia mensual — Ingreso bruto</div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={tendencia} margin={{top:5,right:20,bottom:5,left:10}}>
              <XAxis dataKey="mes" tick={{fill:"#64748b",fontSize:10}}/>
              <YAxis tick={{fill:"#64748b",fontSize:10}} tickFormatter={v=>v>=1000000?`${(v/1000000).toFixed(1)}M`:v>=1000?`${(v/1000).toFixed(0)}k`:v}/>
              <Tooltip content={<TooltipCustom/>}/>
              <Legend wrapperStyle={{fontSize:11,color:"#94a3b8"}}/>
              <Line type="monotone" dataKey="OSDE" stroke="#4338ca" strokeWidth={2} dot={{r:4}}/>
              <Line type="monotone" dataKey="MEDIFE" stroke="#7c3aed" strokeWidth={2} dot={{r:4}}/>
              <Line type="monotone" dataKey="PARTICULAR" stroke="#059669" strokeWidth={2} dot={{r:4}}/>
              <Line type="monotone" dataKey="Total" stroke="#d97706" strokeWidth={2} strokeDasharray="4 2" dot={{r:4}}/>
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Tabla detalle */}
      <Card>
        <div style={{color:"#1e293b",fontWeight:700,marginBottom:14,fontSize:13}}>📋 Detalle por prestación — {MES_LABELS[mes]||mes}</div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead>
              <tr>{["PRESTACIÓN","OSDE","MEDIFE","PARTICULAR","TOTAL"].map(h=><th key={h} style={{...S.th,textAlign:h==="PRESTACIÓN"?"left":"right"}}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {Object.entries(porPrest).map(([prest,d])=>(
                <tr key={prest}>
                  <td style={S.td}><Badge color="#4338ca">{prest}</Badge></td>
                  <td style={{...S.td,textAlign:"right",fontFamily:"'DM Mono',monospace",color:"#4338ca"}}>{fp(d.OSDE)}</td>
                  <td style={{...S.td,textAlign:"right",fontFamily:"'DM Mono',monospace",color:"#7c3aed"}}>{fp(d.MEDIFE)}</td>
                  <td style={{...S.td,textAlign:"right",fontFamily:"'DM Mono',monospace",color:"#059669"}}>{fp(d.PARTICULAR)}</td>
                  <td style={{...S.td,textAlign:"right",fontFamily:"'DM Mono',monospace",fontWeight:700,color:"#1e293b"}}>{fp(d.total)}</td>
                </tr>
              ))}
              <tr style={{background:"#eef2f7"}}>
                <td style={{...S.td,fontWeight:700,color:"#94a3b8"}}>TOTAL</td>
                <td style={{...S.td,textAlign:"right",fontFamily:"'DM Mono',monospace",fontWeight:700,color:"#4338ca"}}>{fp(porOS.OSDE)}</td>
                <td style={{...S.td,textAlign:"right",fontFamily:"'DM Mono',monospace",fontWeight:700,color:"#7c3aed"}}>{fp(porOS.MEDIFE)}</td>
                <td style={{...S.td,textAlign:"right",fontFamily:"'DM Mono',monospace",fontWeight:700,color:"#059669"}}>{fp(porOS.PARTICULAR)}</td>
                <td style={{...S.td,textAlign:"right",fontFamily:"'DM Mono',monospace",fontWeight:800,fontSize:15,color:"#1e293b"}}>{fp(bruto)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ─── VISTA: COBROS OSDE (TRÁMITES REALES) ────────────────────────────────────
//
// Lógica real extraída del PDF OSDE:
//  - Trámite Nº: número único del trámite
//  - Fecha emisión: cuando OSDE emite la liquidación
//  - Período cubierto: rango de fechas de las prestaciones incluidas (no es mes calendario)
//  - Mes de cobro: el mes en que impacta en tu caja (ej: trámite emitido 23/02 → cobro marzo)
//  - Prestaciones: FKT (1250181), RPG (1250164), DRENAJE (1250186)
//  - Gravado vs Exento: pacientes con y sin IVA
//  - IVA 10.5%: solo sobre gravado
//  - Total con IVA = lo que efectivamente deposita OSDE
//
// Primer trámite real cargado desde el PDF adjunto:
// ─── DATOS COBROS MEDIFE ──────────────────────────────────────────────────────
const COBROS_MEDIFE_INIT = [
  {
    id: "med1",
    factNro: "FC N° 85",
    fechaEmision: "09/12/2025",
    periodoDesde: "01/11/2025",
    periodoHasta: "30/11/2025",
    mesImpacto: "2025-12",
    pacientesObligatorios: 9,
    pacientesDirectos: 24,
    totalPacientes: 33,
    precioUnitario: 8752,
    importeExento: 78768,
    importeGravado: 210048,
    iva: 22055.04,
    totalConIVA: 310871.04,
    notas: "Pacientes noviembre 2025 — facturado diciembre",
  },
];

// ─── DATOS COBROS PARTICULARES ────────────────────────────────────────────────
const COBROS_PARTICULARES_INIT = [];

const TRAMITES_OSDE_INIT = [
  {
    id: "t1",
    tramiteNro: "5805582132",
    fechaEmision: "23/02/2026",
    periodoDesde: "15/01/2026",
    periodoHasta: "12/02/2026",
    mesImpacto: "2026-03",
    // Desglose por prestación (del PDF detalle)
    prestaciones: {
      FKT:    { visitas: 817, liquidado: 9555729.19 },
      RPG:    { visitas: 121, liquidado: 2847538.00 },
      DRENAJE:{ visitas: 50,  liquidado: 1016364.81 },
    },
    // De la cabecera
    importeGravado:  5945294.00,
    importeExento:   7474338.02,
    iva:             624255.86,
    totalSinIVA:     13419632.17,
    totalConIVA:     14043887.88,
    cantPrestaciones: 1005,
    notas: "Trámite cargado desde PDF OSDE — pago marzo 2026",
  },
];

function ViewCobrosOSDE({registros}) {
  const [tramites, setTramites] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editando, setEditando] = useState(null); // id del trámite en edición, o null
  const [guardando, setGuardando] = useState(false);
  const [tab, setTab] = useState("tramites");
  const [mesFiltro, setMesFiltro] = useState("todos");
  const [importandoPdf, setImportandoPdf] = useState(false);
  const pdfRefOsde = useRef(null);

  const FORM_EMPTY = {
    tramiteNro:"", fechaEmision:"", periodoDesde:"", periodoHasta:"",
    mesImpacto: getMesActual(),
    prestaciones: { FKT:{visitas:0,liquidado:0}, RPG:{visitas:0,liquidado:0}, DRENAJE:{visitas:0,liquidado:0} },
    importeGravado:0, importeExento:0, iva:0, totalConIVA:0, notas:"",
  };
  const [form, setForm] = useState(FORM_EMPTY);

  // Últimos 8 meses como opciones en el select mes impacto
  const mesesOpc = Array.from({length:8},(_,i)=>{
    const d=new Date(); d.setDate(1); d.setMonth(d.getMonth()-i+2);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  }).reverse();

  // Cargar de Supabase
  useEffect(()=>{ cargar(); },[]);

  async function cargar() {
    setCargando(true);
    const {data,error} = await supabase.from("crm_tramites_osde").select("*").order("fecha_emision",{ascending:false});
    if (!error && data) {
      setTramites(data.map(r=>({
        id: r.id,
        tramiteNro: r.tramite_nro,
        fechaEmision: r.fecha_emision,
        periodoDesde: r.periodo_desde,
        periodoHasta: r.periodo_hasta,
        mesImpacto: r.mes_impacto,
        prestaciones: r.prestaciones || {},
        importeGravado: Number(r.importe_gravado)||0,
        importeExento: Number(r.importe_exento)||0,
        iva: Number(r.iva)||0,
        totalSinIVA: Number(r.total_sin_iva)||0,
        totalConIVA: Number(r.total_con_iva)||0,
        cantPrestaciones: Number(r.cant_prestaciones)||0,
        notas: r.notas||"",
      })));
    }
    setCargando(false);
  }

  function abrirNuevo() {
    setForm({...FORM_EMPTY, mesImpacto: mesFiltro !== "todos" ? mesFiltro : getMesActual()});
    setEditando(null);
    setShowForm(true);
  }

  async function importarPdfCabecera(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportandoPdf(true);
    try {
      const r = await parseCabeceraOSDE(file);
      if (!r.ok) {
        alert("No se pudo leer el PDF — parece que no es una Cabecera de Liquidación de OSDE, o tiene un formato distinto al esperado. Completá el formulario a mano.");
      } else {
        setForm(f => ({
          ...f,
          tramiteNro: r.tramite || f.tramiteNro,
          fechaEmision: r.fechaEmision || f.fechaEmision,
          importeGravado: r.gravado ?? f.importeGravado,
          importeExento: r.exento ?? f.importeExento,
          iva: r.iva ?? f.iva,
          totalConIVA: r.total ?? f.totalConIVA,
        }));
        alert(`✅ Datos leídos de "${file.name}".\nTrámite ${r.tramite}, total $${r.total?.toLocaleString("es-AR")}.\nRevisá los datos antes de guardar (el período y el desglose por prestación hay que completarlos con el Detalle).`);
      }
    } catch (err) {
      alert("No se pudo leer el PDF: " + err.message);
    }
    setImportandoPdf(false);
    if (pdfRefOsde.current) pdfRefOsde.current.value = "";
  }

  function abrirEditar(t) {
    setForm({
      tramiteNro: t.tramiteNro,
      fechaEmision: t.fechaEmision,
      periodoDesde: t.periodoDesde,
      periodoHasta: t.periodoHasta,
      mesImpacto: t.mesImpacto,
      prestaciones: {
        FKT: t.prestaciones.FKT || {visitas:0,liquidado:0},
        RPG: t.prestaciones.RPG || {visitas:0,liquidado:0},
        DRENAJE: t.prestaciones.DRENAJE || {visitas:0,liquidado:0},
      },
      importeGravado: t.importeGravado,
      importeExento: t.importeExento,
      iva: t.iva,
      totalConIVA: t.totalConIVA,
      notas: t.notas,
    });
    setEditando(t.id);
    setShowForm(true);
  }

  async function eliminar(id) {
    if (!window.confirm("¿Eliminar este trámite OSDE? Esta acción no se puede deshacer.")) return;
    await supabase.from("crm_tramites_osde").delete().eq("id", id);
    await cargar();
  }

  async function guardar() {
    setGuardando(true);
    const prest = form.prestaciones;
    const totalSinIVA = Object.values(prest).reduce((s,p)=>s+(parseFloat(p.liquidado)||0),0);
    const cantPrest   = Object.values(prest).reduce((s,p)=>s+(parseInt(p.visitas)||0),0);
    const row = {
      tramite_nro:       form.tramiteNro,
      fecha_emision:     form.fechaEmision,
      periodo_desde:     form.periodoDesde,
      periodo_hasta:     form.periodoHasta,
      mes_impacto:       form.mesImpacto,
      prestaciones:      prest,
      importe_gravado:   parseFloat(form.importeGravado)||0,
      importe_exento:    parseFloat(form.importeExento)||0,
      iva:               parseFloat(form.iva)||0,
      total_sin_iva:     totalSinIVA,
      total_con_iva:     parseFloat(form.totalConIVA)||0,
      cant_prestaciones: cantPrest,
      notas:             form.notas,
    };
    if (editando) {
      await supabase.from("crm_tramites_osde").update(row).eq("id", editando);
    } else {
      await supabase.from("crm_tramites_osde").insert({...row, id: fid()});
    }
    await cargar();
    setShowForm(false);
    setGuardando(false);
  }

  function setPrestVal(prest, campo, val) {
    setForm(f => ({...f, prestaciones:{...f.prestaciones,[prest]:{...f.prestaciones[prest],[campo]:parseFloat(val)||0}}}));
  }

  function getEstimadoCRM(t) {
    const meses = [t.periodoDesde?.slice(6,10)+"-"+t.periodoDesde?.slice(3,5),
                   t.periodoHasta?.slice(6,10)+"-"+t.periodoHasta?.slice(3,5)]
                  .filter((v,i,a)=>v&&a.indexOf(v)===i);
    let fkt=0, rpg=0, drenaje=0;
    registros.filter(r=>meses.includes(r.mes)).forEach(r=>{
      const efectivo = (r.osde||0)+(r.pasada_osde||0);
      if(r.prestacion==="FKT")     fkt     += efectivo;
      if(r.prestacion==="RPG")     rpg     += efectivo;
      if(r.prestacion==="DRENAJE") drenaje += efectivo;
    });
    return {
      FKT:    {visitas:fkt,    estimado:fkt    *ARANCELES_REALES.FKT.OSDE},
      RPG:    {visitas:rpg,    estimado:rpg    *ARANCELES_REALES.RPG.OSDE},
      DRENAJE:{visitas:drenaje,estimado:drenaje*ARANCELES_REALES.DRENAJE.OSDE},
      total:  fkt*ARANCELES_REALES.FKT.OSDE+rpg*ARANCELES_REALES.RPG.OSDE+drenaje*ARANCELES_REALES.DRENAJE.OSDE,
    };
  }

  // Totales por mes de impacto (para KPIs)
  const porMes = useMemo(()=>{
    const acc={};
    tramites.forEach(t=>{
      if(!acc[t.mesImpacto]) acc[t.mesImpacto]={totalConIVA:0,totalSinIVA:0,visitas:0};
      acc[t.mesImpacto].totalConIVA += t.totalConIVA||0;
      acc[t.mesImpacto].totalSinIVA += t.totalSinIVA||0;
      acc[t.mesImpacto].visitas     += t.cantPrestaciones||0;
    });
    return acc;
  },[tramites]);

  // Meses con trámites (para el filtro pill)
  const mesesConDatos = useMemo(()=>
    [...new Set(tramites.map(t=>t.mesImpacto))].sort().reverse()
  ,[tramites]);

  const tramitesFiltrados = mesFiltro==="todos" ? tramites : tramites.filter(t=>t.mesImpacto===mesFiltro);

  function labelMes(m) {
    const [y,mo]=m.split("-");
    const ns=["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    return `${ns[parseInt(mo)-1]} ${y}`;
  }

  return (
    <div>
      {/* Info header */}
      <Card style={{marginBottom:20,background:"#ffffff",borderLeft:"3px solid #4338ca"}}>
        <div style={{color:"#475569",fontSize:13,lineHeight:1.8}}>
          <strong style={{color:"#4338ca"}}>¿Cómo liquida OSDE?</strong> Emite un <strong style={{color:"#1e293b"}}>trámite con número único</strong> que cubre un período de fechas (no mes calendario). El depósito llega aprox. el <strong style={{color:"#1e293b"}}>día 9 del mes siguiente</strong> a la emisión.<br/>
          <span style={{color:"#64748b",fontSize:12}}>Ej: Trámite 5805582132 emitido 23/02 → cubre 15/01 al 12/02 → cobro impacta en <strong style={{color:"#d97706"}}>marzo 2026</strong>.</span>
        </div>
      </Card>

      {/* KPIs por mes */}
      {Object.keys(porMes).length > 0 && (
        <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:20}}>
          {Object.entries(porMes).sort((a,b)=>b[0].localeCompare(a[0])).map(([m,d])=>(
            <div key={m} onClick={()=>setMesFiltro(mesFiltro===m?"todos":m)}
              style={{background: mesFiltro===m?"#4338ca":"#f8faff",
                border:`1px solid ${mesFiltro===m?"#4338ca":"#4338ca33"}`,
                borderRadius:12,padding:"14px 18px",flex:1,minWidth:160,cursor:"pointer",
                transition:"all 0.15s"}}>
              <div style={{color:mesFiltro===m?"rgba(255,255,255,0.7)":"#64748b",fontSize:10,fontWeight:700,letterSpacing:1,marginBottom:5}}>
                COBRO {labelMes(m).toUpperCase()}
              </div>
              <div style={{color:mesFiltro===m?"#fff":"#059669",fontSize:20,fontWeight:800,fontFamily:"'DM Mono',monospace"}}>{fp(d.totalConIVA)}</div>
              <div style={{color:mesFiltro===m?"rgba(255,255,255,0.6)":"#64748b",fontSize:11,marginTop:3}}>
                {d.visitas} prest. · s/IVA: {fp(d.totalSinIVA)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs + acciones */}
      <div style={{display:"flex",gap:8,marginBottom:20,alignItems:"center",flexWrap:"wrap"}}>
        {[["tramites","📋 Trámites OSDE"],["comparativa","🔍 Estimado vs Real"]].map(([id,lbl])=>(
          <button key={id} onClick={()=>setTab(id)}
            style={{...S.btn(tab===id?"#4338ca":"#e2e8f0",12),padding:"7px 18px"}}>{lbl}</button>
        ))}
        {mesFiltro!=="todos" && (
          <span style={{background:"#fef3c7",border:"1px solid #fde68a",borderRadius:20,padding:"4px 12px",fontSize:12,color:"#92400e",fontWeight:700}}>
            Filtrando: {labelMes(mesFiltro)} ✕
            <button onClick={()=>setMesFiltro("todos")} style={{background:"none",border:"none",color:"#92400e",cursor:"pointer",marginLeft:4,fontSize:14,lineHeight:1}}>×</button>
          </span>
        )}
        <div style={{flex:1}}/>
        <button onClick={abrirNuevo} style={S.btn("#4338ca")}>＋ Nuevo trámite OSDE</button>
      </div>

      {cargando && <div style={{color:"#64748b",padding:40,textAlign:"center"}}>Cargando trámites...</div>}

      {/* TAB: TRÁMITES */}
      {!cargando && tab==="tramites" && (
        <div>
          {tramitesFiltrados.length === 0 && (
            <div style={{color:"#94a3b8",textAlign:"center",padding:40,fontSize:14}}>
              {mesFiltro==="todos" ? "No hay trámites cargados aún. Cargá el primero con ＋" : `Sin trámites para ${labelMes(mesFiltro)}`}
            </div>
          )}

          {tramitesFiltrados.map(t=>{
            const est = getEstimadoCRM(t);
            const delta = t.totalSinIVA - est.total;
            return (
              <Card key={t.id} style={{marginBottom:14}}>
                {/* Cabecera trámite */}
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
                  <div>
                    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4,flexWrap:"wrap"}}>
                      <span style={{color:"#1e293b",fontWeight:800,fontSize:15}}>Trámite {t.tramiteNro}</span>
                      <Badge color="#d97706">OSDE</Badge>
                      <Badge color="#059669">Impacta {labelMes(t.mesImpacto)}</Badge>
                    </div>
                    <div style={{color:"#64748b",fontSize:12}}>
                      Emitido: <span style={{color:"#94a3b8"}}>{t.fechaEmision}</span>
                      &nbsp;·&nbsp; Período: <span style={{color:"#94a3b8"}}>{t.periodoDesde} al {t.periodoHasta}</span>
                      &nbsp;·&nbsp; {t.cantPrestaciones} prestaciones
                    </div>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:8}}>
                    <div style={{textAlign:"right"}}>
                      <div style={{color:"#64748b",fontSize:10,marginBottom:3}}>TOTAL CON IVA</div>
                      <div style={{color:"#059669",fontFamily:"'DM Mono',monospace",fontWeight:800,fontSize:20}}>{fp(t.totalConIVA)}</div>
                    </div>
                    <div style={{display:"flex",gap:6}}>
                      <button onClick={()=>abrirEditar(t)} title="Editar"
                        style={{background:"#e0e7ff",border:"none",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:13,color:"#4338ca",fontWeight:700}}>✏️ Editar</button>
                      <button onClick={()=>eliminar(t.id)} title="Eliminar"
                        style={{background:"#fee2e2",border:"none",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:13,color:"#b91c1c",fontWeight:700}}>🗑️</button>
                    </div>
                  </div>
                </div>

                {/* Desglose financiero */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>
                  {[
                    {lbl:"Gravado",val:t.importeGravado,color:"#4338ca"},
                    {lbl:"Exento",val:t.importeExento,color:"#94a3b8"},
                    {lbl:"IVA 10.5%",val:t.iva,color:"#d97706"},
                    {lbl:"Sin IVA (base)",val:t.totalSinIVA,color:"#1e293b"},
                  ].map(({lbl,val,color})=>(
                    <div key={lbl} style={{background:"#f8faff",borderRadius:8,padding:"10px 12px",textAlign:"center"}}>
                      <div style={{color:"#64748b",fontSize:10,marginBottom:4}}>{lbl}</div>
                      <div style={{color,fontFamily:"'DM Mono',monospace",fontWeight:700,fontSize:13}}>{fp(val)}</div>
                    </div>
                  ))}
                </div>

                {/* Desglose por prestación */}
                {Object.keys(t.prestaciones).length > 0 && (
                  <div style={{background:"#f8faff",borderRadius:10,padding:14}}>
                    <div style={{color:"#64748b",fontSize:10,fontWeight:700,letterSpacing:1,marginBottom:10}}>DESGLOSE POR PRESTACIÓN</div>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                      <thead>
                        <tr>
                          {["PRESTACIÓN","VISITAS OSDE","LIQUIDADO OSDE","VISITAS CRM","ESTIMADO CRM","DIFERENCIA"].map(h=>(
                            <th key={h} style={{...S.th,fontSize:10,textAlign:h==="PRESTACIÓN"?"left":"right"}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(t.prestaciones).map(([prest,d])=>{
                          const e = est[prest]||{visitas:0,estimado:0};
                          const dif = (d.liquidado||0) - e.estimado;
                          return (
                            <tr key={prest}>
                              <td style={S.td}><Badge color={prest==="FKT"?"#4338ca":prest==="RPG"?"#7c3aed":"#06b6d4"}>{prest}</Badge></td>
                              <td style={{...S.td,textAlign:"right",color:"#059669",fontWeight:700}}>{d.visitas}</td>
                              <td style={{...S.td,textAlign:"right",fontFamily:"'DM Mono',monospace",color:"#059669"}}>{fp(d.liquidado)}</td>
                              <td style={{...S.td,textAlign:"right",color:"#4338ca"}}>{e.visitas||"—"}</td>
                              <td style={{...S.td,textAlign:"right",fontFamily:"'DM Mono',monospace",color:"#4338ca"}}>{e.estimado>0?fp(e.estimado):"Sin datos"}</td>
                              <td style={{...S.td,textAlign:"right",fontFamily:"'DM Mono',monospace",fontWeight:700,
                                color:e.estimado===0?"#64748b":Math.abs(dif)<10000?"#059669":dif>0?"#d97706":"#dc2626"}}>
                                {e.estimado===0?"—":dif>=0?`▲ ${fp(dif)}`:`▼ ${fp(Math.abs(dif))}`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Delta total */}
                <div style={{marginTop:12,display:"flex",justifyContent:"flex-end",alignItems:"center",gap:12}}>
                  <span style={{color:"#64748b",fontSize:12}}>Diferencia total (real vs estimado CRM):</span>
                  <span style={{color:est.total===0?"#64748b":Math.abs(delta)<50000?"#059669":delta>0?"#d97706":"#dc2626",
                    fontFamily:"'DM Mono',monospace",fontWeight:800,fontSize:16}}>
                    {est.total===0?"Sin datos en CRM":delta>=0?`▲ ${fp(delta)}`:`▼ ${fp(Math.abs(delta))}`}
                  </span>
                </div>

                {t.notas && <div style={{marginTop:10,color:"#64748b",fontSize:12,borderTop:"1px solid #dbeafe",paddingTop:10}}>{t.notas}</div>}
              </Card>
            );
          })}
        </div>
      )}

      {/* TAB: COMPARATIVA */}
      {!cargando && tab==="comparativa" && (
        <Card style={{marginBottom:16}}>
          <div style={{color:"#1e293b",fontWeight:700,marginBottom:14,fontSize:13}}>
            🔍 Estimado CRM vs Cobro real OSDE — por mes de impacto
          </div>
          <div style={{color:"#64748b",fontSize:12,marginBottom:16,lineHeight:1.6}}>
            Diferencia entre visitas × arancel (CRM) y lo que efectivamente liquidó OSDE.
            Puede variar por planes distintos, rechazos, o desfase de período.
          </div>
          {tramites.length === 0
            ? <div style={{color:"#94a3b8",textAlign:"center",padding:24}}>Sin trámites cargados.</div>
            : <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead>
                  <tr>{["MES COBRO","TRÁMITE Nº","PERÍODO","ESTIMADO CRM","REAL s/IVA","CON IVA","Δ DIF"].map(h=>(
                    <th key={h} style={{...S.th,textAlign:["MES COBRO","TRÁMITE Nº","PERÍODO"].includes(h)?"left":"right"}}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {tramites.map(t=>{
                    const est=getEstimadoCRM(t);
                    const delta=t.totalSinIVA-est.total;
                    return (
                      <tr key={t.id}>
                        <td style={{...S.td,fontWeight:700,color:"#d97706"}}>{labelMes(t.mesImpacto)}</td>
                        <td style={{...S.td,color:"#94a3b8",fontFamily:"'DM Mono',monospace",fontSize:11}}>{t.tramiteNro}</td>
                        <td style={{...S.td,color:"#64748b",fontSize:11}}>{t.periodoDesde} → {t.periodoHasta}</td>
                        <td style={{...S.td,textAlign:"right",fontFamily:"'DM Mono',monospace",color:est.total>0?"#4338ca":"#64748b"}}>{est.total>0?fp(est.total):"—"}</td>
                        <td style={{...S.td,textAlign:"right",fontFamily:"'DM Mono',monospace",color:"#059669",fontWeight:700}}>{fp(t.totalSinIVA)}</td>
                        <td style={{...S.td,textAlign:"right",fontFamily:"'DM Mono',monospace",color:"#059669"}}>{fp(t.totalConIVA)}</td>
                        <td style={{...S.td,textAlign:"right",fontFamily:"'DM Mono',monospace",fontWeight:700,
                          color:est.total===0?"#64748b":Math.abs(delta)<100000?"#059669":delta>0?"#d97706":"#dc2626"}}>
                          {est.total===0?"—":delta>=0?`▲ ${fp(delta)}`:`▼ ${fp(Math.abs(delta))}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
          }
        </Card>
      )}

      {/* MODAL NUEVO / EDITAR TRÁMITE */}
      {showForm && (
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,overflow:"auto",padding:20}}>
          <Card style={{width:600,maxWidth:"95vw",maxHeight:"90vh",overflowY:"auto"}}>
            <div style={{color:"#1e293b",fontWeight:800,fontSize:15,marginBottom:6}}>
              {editando ? "✏️ Editar trámite OSDE" : "＋ Registrar trámite OSDE"}
            </div>
            <div style={{color:"#64748b",fontSize:12,marginBottom:12}}>
              Completá con los datos del PDF "Cabecera de Liquidación" — o importá desde el Excel del Generador.
            </div>

            {/* Importar desde PDF (Cabecera de Liquidación) */}
            <div style={{background:"#f5f3ff",border:"1px dashed #c4b5fd",borderRadius:10,padding:"12px 16px",marginBottom:12}}>
              <div style={{fontSize:12,color:"#5b21b6",fontWeight:700,marginBottom:4}}>📄 Subir PDF "Cabecera de Liquidación" de OSDE</div>
              <div style={{fontSize:11,color:"#7c3aed",marginBottom:10}}>Lee el trámite, fecha, gravado/exento/IVA y total directo del PDF. Revisá antes de guardar.</div>
              <label style={{display:"inline-flex",alignItems:"center",gap:8,background:"#7c3aed",color:"white",padding:"6px 14px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:700}}>
                {importandoPdf ? "⏳ Leyendo..." : "📄 Seleccionar PDF"}
                <input ref={pdfRefOsde} type="file" accept=".pdf" style={{display:"none"}} onChange={importarPdfCabecera} disabled={importandoPdf}/>
              </label>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
              <div><label style={S.label}>Nº Trámite</label>
                <input style={S.input} value={form.tramiteNro} onChange={e=>setForm(f=>({...f,tramiteNro:e.target.value}))} placeholder="5805582132"/></div>
              <div><label style={S.label}>Fecha Emisión (DD/MM/AAAA)</label>
                <input style={S.input} value={form.fechaEmision} onChange={e=>setForm(f=>({...f,fechaEmision:e.target.value}))} placeholder="23/02/2026"/></div>
              <div><label style={S.label}>Período Desde</label>
                <input style={S.input} value={form.periodoDesde} onChange={e=>setForm(f=>({...f,periodoDesde:e.target.value}))} placeholder="15/01/2026"/></div>
              <div><label style={S.label}>Período Hasta</label>
                <input style={S.input} value={form.periodoHasta} onChange={e=>setForm(f=>({...f,periodoHasta:e.target.value}))} placeholder="12/02/2026"/></div>
              <div style={{gridColumn:"1/-1"}}>
                <label style={S.label}>Mes que impacta en caja</label>
                <select style={S.input} value={form.mesImpacto} onChange={e=>setForm(f=>({...f,mesImpacto:e.target.value}))}>
                  {mesesOpc.map(m=><option key={m} value={m}>{labelMes(m)}</option>)}
                </select>
              </div>
            </div>

            <div style={{color:"#64748b",fontSize:10,fontWeight:700,letterSpacing:1,marginBottom:10}}>DESGLOSE POR PRESTACIÓN (del PDF Detalle)</div>
            <div style={{background:"#f8faff",borderRadius:10,padding:12,marginBottom:14}}>
              {["FKT","RPG","DRENAJE"].map(prest=>(
                <div key={prest} style={{display:"grid",gridTemplateColumns:"90px 1fr 1fr",gap:10,marginBottom:8,alignItems:"center"}}>
                  <Badge color={prest==="FKT"?"#4338ca":prest==="RPG"?"#7c3aed":"#06b6d4"}>{prest}</Badge>
                  <div>
                    <label style={S.label}>Visitas</label>
                    <input type="number" style={S.input} value={form.prestaciones[prest]?.visitas||0}
                      onChange={e=>setPrestVal(prest,"visitas",e.target.value)}/>
                  </div>
                  <div>
                    <label style={S.label}>Liquidado $</label>
                    <input type="number" style={S.input} value={form.prestaciones[prest]?.liquidado||0}
                      onChange={e=>setPrestVal(prest,"liquidado",e.target.value)}/>
                  </div>
                </div>
              ))}
              <div style={{borderTop:"1px solid #dbeafe",paddingTop:10,marginTop:8,display:"flex",justifyContent:"flex-end",color:"#475569",fontSize:12,fontWeight:700}}>
                Total sin IVA (calculado): <span style={{fontFamily:"'DM Mono',monospace",color:"#4338ca",marginLeft:10}}>
                  {fp(Object.values(form.prestaciones).reduce((s,p)=>s+(parseFloat(p.liquidado)||0),0))}
                </span>
              </div>
            </div>

            <div style={{color:"#64748b",fontSize:10,fontWeight:700,letterSpacing:1,marginBottom:10}}>TOTALES (de la Cabecera del PDF)</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
              <div><label style={S.label}>Importe Gravado</label>
                <input type="number" style={S.input} value={form.importeGravado} onChange={e=>setForm(f=>({...f,importeGravado:e.target.value}))}/></div>
              <div><label style={S.label}>Importe Exento</label>
                <input type="number" style={S.input} value={form.importeExento} onChange={e=>setForm(f=>({...f,importeExento:e.target.value}))}/></div>
              <div><label style={S.label}>IVA 10.5%</label>
                <input type="number" style={S.input} value={form.iva} onChange={e=>setForm(f=>({...f,iva:e.target.value}))}/></div>
              <div><label style={S.label}>TOTAL CON IVA ← el que deposita OSDE</label>
                <input type="number" style={{...S.input,border:"2px solid #059669",background:"#f0fdf4"}} value={form.totalConIVA} onChange={e=>setForm(f=>({...f,totalConIVA:e.target.value}))}/></div>
              <div style={{gridColumn:"1/-1"}}>
                <label style={S.label}>Notas</label>
                <input style={S.input} value={form.notas} onChange={e=>setForm(f=>({...f,notas:e.target.value}))} placeholder="Ej: Pago acreditado el 09/03/2026"/>
              </div>
            </div>

            <div style={{display:"flex",gap:10}}>
              <button onClick={guardar} disabled={guardando} style={S.btn("#4338ca")}>
                {guardando ? "Guardando..." : editando ? "💾 Actualizar trámite" : "💾 Guardar trámite"}
              </button>
              <button onClick={()=>setShowForm(false)} style={S.btn("#64748b")}>Cancelar</button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// ─── VISTA: GASTOS Y RENTABILIDAD ─────────────────────────────────────────────
function ViewRentabilidad({registros,precios}) {
  const [gastos,setGastos] = useState(GASTOS_INIT);
  const [mes,setMes] = useState(getMesActual());
  const [showForm,setShowForm] = useState(false);
  const [form,setForm] = useState({categoria:"Expensas",monto:0,notas:""});

  const mesesDisp = [...new Set([...registros.map(r=>r.mes),...gastos.map(g=>g.mes)])].sort().reverse();
  if(!mesesDisp.includes(mes)) mesesDisp.unshift(mes);

  const gastosMes  = gastos.filter(g=>g.mes===mes);
  const totalGastos= gastosMes.reduce((s,g)=>s+(g.monto||0),0);
  const bruto      = calcIngresoBruto(registros,mes,precios);
  const resumen    = calcResumen(registros,mes);
  const totalHon   = IDS_TODOS.reduce((s,p)=>{
    const d=resumen[p]||{osde:0,medife:0,particular:0,regalo:0};
    return s+calcHonorario(p,d,precios);
  },0);
  const totalCostos   = totalGastos+totalHon;
  const rentabilidad  = bruto-totalCostos;
  const margen        = bruto>0 ? (rentabilidad/bruto*100).toFixed(1) : 0;

  function guardar() {
    setGastos(prev=>[...prev,{id:fid(),mes,...form,monto:parseInt(form.monto)||0}]);
    setShowForm(false);
    setForm(f=>({...f,monto:0,notas:""}));
  }
  function eliminar(id) { setGastos(prev=>prev.filter(g=>g.id!==id)); }

  // Gráfico pie costos
  const pieData = [
    {name:"Honorarios",value:Math.round(totalHon)},
    ...CATEGORIAS_GASTO.map(cat=>{
      const total = gastosMes.filter(g=>g.categoria===cat).reduce((s,g)=>s+g.monto,0);
      return {name:cat,value:total};
    }).filter(d=>d.value>0)
  ];

  // Tendencia rentabilidad
  const tendencia = mesesDisp.slice(0,6).reverse().map(m=>{
    const b = calcIngresoBruto(registros,m,precios);
    const gm = gastos.filter(g=>g.mes===m).reduce((s,g)=>s+g.monto,0);
    const res2 = calcResumen(registros,m);
    const hon = IDS_TODOS.reduce((s,p)=>{const d=res2[p]||{osde:0,medife:0,particular:0,regalo:0};return s+calcHonorario(p,d,precios);},0);
    return {mes:MES_LABELS[m]||m, Ingresos:Math.round(b), Costos:Math.round(gm+hon), Rentabilidad:Math.round(b-gm-hon)};
  });

  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap",alignItems:"center"}}>
        {mesesDisp.slice(0,5).map(m=>(
          <button key={m} onClick={()=>setMes(m)} style={{...S.btn(mes===m?"#4338ca":"#e2e8f0",12),padding:"7px 16px"}}>
            {MES_LABELS[m]||m}
          </button>
        ))}
        <div style={{flex:1}}/>
        <button onClick={()=>setShowForm(true)} style={S.btn("#7c3aed")}>＋ Agregar gasto</button>
      </div>

      {/* KPIs rentabilidad */}
      <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:20}}>
        <StatCard label="INGRESO BRUTO" value={fp(bruto)} color="#4338ca"/>
        <StatCard label="HONORARIOS PROFS." value={fp(totalHon)} color="#d97706"/>
        <StatCard label="GASTOS FIJOS" value={fp(totalGastos)} color="#dc2626"/>
        <StatCard label="RESULTADO NETO" value={fp(rentabilidad)} color={rentabilidad>=0?"#059669":"#dc2626"} sub={`Margen: ${margen}%`}/>
      </div>

      {/* Resumen waterfall visual */}
      <Card style={{marginBottom:20}}>
        <div style={{color:"#1e293b",fontWeight:700,marginBottom:16,fontSize:13}}>💧 Análisis de Rentabilidad — {MES_LABELS[mes]||mes}</div>
        {[
          {label:"Ingreso Bruto Clínica",valor:bruto,color:"#4338ca",signo:"+"},
          {label:"Honorarios Profesionales",valor:totalHon,color:"#d97706",signo:"−"},
          {label:"Gastos Fijos",valor:totalGastos,color:"#dc2626",signo:"−"},
          {label:"RESULTADO NETO",valor:rentabilidad,color:rentabilidad>=0?"#059669":"#dc2626",signo:"=",bold:true},
        ].map(({label,valor,color,signo,bold})=>(
          <div key={label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 0",borderBottom:"1px solid #dbeafe"}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{color,fontFamily:"'DM Mono',monospace",fontWeight:700,fontSize:16,width:20}}>{signo}</span>
              <span style={{color:bold?"#fff":"#94a3b8",fontWeight:bold?800:400,fontSize:bold?14:13}}>{label}</span>
            </div>
            <span style={{color,fontFamily:"'DM Mono',monospace",fontWeight:bold?800:700,fontSize:bold?18:14}}>{fp(valor)}</span>
          </div>
        ))}
      </Card>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:20}}>
        {/* Pie distribución costos */}
        <Card>
          <div style={{color:"#1e293b",fontWeight:700,marginBottom:14,fontSize:13}}>🥧 Distribución de Costos</div>
          {pieData.length>0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" outerRadius={75} dataKey="value" label={({name,percent})=>percent>0.05?`${(percent*100).toFixed(0)}%`:""} labelLine={false}>
                  {pieData.map((_,i)=><Cell key={i} fill={PIE_COLORS[i%PIE_COLORS.length]}/>)}
                </Pie>
                <Tooltip formatter={v=>fp(v)} contentStyle={{background:"#1e3a6e",border:"none",borderRadius:10,color:"white"}}/>
                <Legend wrapperStyle={{fontSize:10,color:"#94a3b8"}}/>
              </PieChart>
            </ResponsiveContainer>
          ) : <div style={{color:"#64748b",textAlign:"center",padding:40}}>Sin costos cargados</div>}
        </Card>

        {/* Tendencia */}
        {tendencia.length>1 && (
          <Card>
            <div style={{color:"#1e293b",fontWeight:700,marginBottom:14,fontSize:13}}>📈 Tendencia Rentabilidad</div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={tendencia} margin={{top:5,right:10,bottom:5,left:10}}>
                <XAxis dataKey="mes" tick={{fill:"#64748b",fontSize:9}}/>
                <YAxis tick={{fill:"#64748b",fontSize:9}} tickFormatter={v=>v>=1000000?`${(v/1000000).toFixed(1)}M`:v>=1000?`${(v/1000).toFixed(0)}k`:v}/>
                <Tooltip content={<TooltipCustom/>}/>
                <Legend wrapperStyle={{fontSize:10,color:"#94a3b8"}}/>
                <Line type="monotone" dataKey="Ingresos" stroke="#4338ca" strokeWidth={2} dot={{r:3}}/>
                <Line type="monotone" dataKey="Costos" stroke="#dc2626" strokeWidth={2} dot={{r:3}}/>
                <Line type="monotone" dataKey="Rentabilidad" stroke="#059669" strokeWidth={2} dot={{r:3}}/>
              </LineChart>
            </ResponsiveContainer>
          </Card>
        )}
      </div>

      {/* Lista gastos */}
      <Card>
        <div style={{color:"#1e293b",fontWeight:700,marginBottom:14,fontSize:13}}>💸 Gastos — {MES_LABELS[mes]||mes}</div>
        {gastosMes.length===0 && <div style={{color:"#64748b",textAlign:"center",padding:24}}>No hay gastos cargados para este mes</div>}
        {gastosMes.map(g=>(
          <div key={g.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:"1px solid #dbeafe"}}>
            <Badge color={g.categoria==="Sueldo Susana"?"#7c3aed":g.categoria==="Luz"?"#d97706":"#4338ca"}>{g.categoria}</Badge>
            <div style={{flex:1,color:"#94a3b8",fontSize:12}}>{g.notas||"—"}</div>
            <div style={{color:"#dc2626",fontFamily:"'DM Mono',monospace",fontWeight:700}}>{fp(g.monto)}</div>
            <button onClick={()=>eliminar(g.id)} style={{...S.btn("#1a0a0a",11),padding:"4px 10px",color:"#dc2626"}}>✕</button>
          </div>
        ))}
        {gastosMes.length>0 && (
          <div style={{display:"flex",justifyContent:"flex-end",padding:"10px 0",fontFamily:"'DM Mono',monospace",fontWeight:800,color:"#dc2626",fontSize:16}}>
            Total gastos: {fp(totalGastos)}
          </div>
        )}
      </Card>

      {showForm && (
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999}}>
          <Card style={{width:420,maxWidth:"90vw"}}>
            <div style={{color:"#1e293b",fontWeight:800,fontSize:15,marginBottom:18}}>Agregar gasto — {MES_LABELS[mes]||mes}</div>
            <div style={{display:"grid",gap:12}}>
              <div>
                <label style={S.label}>Categoría</label>
                <select style={S.input} value={form.categoria} onChange={e=>setForm(f=>({...f,categoria:e.target.value}))}>
                  {CATEGORIAS_GASTO.map(c=><option key={c}>{c}</option>)}
                </select>
              </div>
              <div><label style={S.label}>Monto</label><input type="number" style={S.input} value={form.monto} onChange={e=>setForm(f=>({...f,monto:e.target.value}))}/></div>
              <div><label style={S.label}>Notas</label><input style={S.input} value={form.notas} onChange={e=>setForm(f=>({...f,notas:e.target.value}))} placeholder="Opcional"/></div>
            </div>
            <div style={{display:"flex",gap:10,marginTop:18}}>
              <button onClick={guardar} style={S.btn("#7c3aed")}>Guardar</button>
              <button onClick={()=>setShowForm(false)} style={S.btn("#e2e8f0")}>Cancelar</button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// ─── VISTA: LIQUIDACIÓN ───────────────────────────────────────────────────────
function ViewLiquidacion({registros,setRegistros,precios}) {
  const mesActual = getMesActual();
  const mesesDisp = [...new Set([...registros.map(r=>r.mes),mesActual])].sort().reverse();
  const [mes,setMes] = useState(mesActual);
  const [overrides,setOverrides] = useState({});
  const [regalos,setRegalos] = useState({});
  const [showAgregar,setShowAgregar] = useState(false);
  const [showImport,setShowImport] = useState(false);
  const [importMsg,setImportMsg] = useState(null);
  const [formDia,setFormDia] = useState({prof:"ISOLINA",prestacion:"FKT",dia:"",osde:0,medife:0,particular:0,regalo:0,notas:""});
  const fileRef = useRef();

  const resumen = useMemo(()=>calcResumen(registros,mes),[registros,mes]);
  const bruto   = useMemo(()=>calcIngresoBruto(registros,mes,precios),[registros,mes,precios]);

  const getVal=(prof,campo)=>{const k=`${mes}_${prof}_${campo}`;return overrides[k]!==undefined?overrides[k]:(resumen[prof]?.[campo]||0);};
  const setOv=(prof,campo,v)=>setOverrides(p=>({...p,[`${mes}_${prof}_${campo}`]:parseInt(v)||0}));

  const tieneActividad=(id)=>{const d=resumen[id]; return !!d&&(d.osde>0||d.medife>0||d.particular>0||d.regalo>0);};
  const profRows=[...IDS_ACTIVOS, ...IDS_TODOS.filter(id=>!IDS_ACTIVOS.includes(id)&&tieneActividad(id))];
  let totalHon=0;
  const profData=profRows.map(prof=>{
    const v=VALORES_PROF[prof];
    const isDuena=v?.esDuena,isPaula=v?.soloRPG;
    const osde=getVal(prof,"osde"),medife=getVal(prof,"medife"),particular=getVal(prof,"particular");
    const reg=regalos[`${mes}_${prof}`]||getVal(prof,"regalo");
    const hon=isDuena?0:calcHonorario(prof,{osde,medife,particular,regalo:reg},precios);
    if(!isDuena) totalHon+=hon;
    return {prof,osde,medife,prepaga:osde+medife,particular,reg,hon,isDuena,isPaula,color:COLOR_POR_PROFESIONAL[prof]||"#fff"};
  });

  function handleFile(e) {
    const file=e.target.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=ev=>{
      const wb=XLSX.read(new Uint8Array(ev.target.result),{type:"array"});
      const resultados=[];
      wb.SheetNames.forEach(sheetName=>{
        const ws=wb.Sheets[sheetName];
        const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:""});
        const profNames=["ISOLINA","DAVID","JUAN CRUZ","FRANCISCO","PAULA","MILAGROS"];
        rows.forEach(row=>{
          const nombre=String(row[0]||"").trim().toUpperCase();
          if(profNames.includes(nombre)){
            const sl=sheetName.toLowerCase();
            let m=mesActual;
            if(sl.includes("febrero")||sl.includes("feb")) m="2026-02";
            else if(sl.includes("marzo")||sl.includes("mar")) m="2026-03";
            else if(sl.includes("enero")) m="2026-01";
            resultados.push({id:fid(),mes:m,prof:nombre,prestacion:nombre==="PAULA"?"RPG":"FKT",
              osde:parseInt(row[1])||0,medife:parseInt(row[2])||0,particular:parseInt(row[3])||0,regalo:parseInt(row[4])||0,
              notas:`Importado desde ${sheetName}`,importado:true});
          }
        });
      });
      if(resultados.length===0){
        setImportMsg({ok:false,msg:"No se encontraron datos. Usá el formato de liquidación del CRM."});
      } else {
        const meses=new Set(resultados.map(r=>r.mes));
        setRegistros(prev=>[...prev.filter(r=>!meses.has(r.mes)||!r.importado),...resultados]);
        setImportMsg({ok:true,msg:`✅ ${resultados.length} registros importados de: ${[...meses].map(m=>MES_LABELS[m]||m).join(", ")}`});
        setMes(resultados[0].mes);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value="";
  }

  function guardarDia(){
    setRegistros(prev=>[...prev,{id:fid(),mes,...formDia,osde:parseInt(formDia.osde)||0,medife:parseInt(formDia.medife)||0,particular:parseInt(formDia.particular)||0,regalo:parseInt(formDia.regalo)||0}]);
    setShowAgregar(false);
  }

  const tieneData=profData.some(p=>p.osde>0||p.medife>0||p.particular>0||p.reg>0);

  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap",alignItems:"center"}}>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",flex:1}}>
          {mesesDisp.slice(0,5).map(m=>(
            <button key={m} onClick={()=>setMes(m)} style={{...S.btn(mes===m?"#4338ca":"#e2e8f0",12),padding:"7px 16px"}}>
              {MES_LABELS[m]||m}
            </button>
          ))}
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>setShowImport(true)} style={{...S.btn("#cbd5e1",12),border:"1px solid #2a3d5a"}}>📥 Importar Excel</button>
          <button onClick={()=>setShowAgregar(true)} style={S.btn("#059669",12)}>＋ Agregar</button>
          <button onClick={()=>{ setOverrides({}); setRegalos({}); }} style={{...S.btn("#d97706",12),border:"1px solid #d9770633"}} title="Limpiar ajustes manuales y recalcular desde Supabase">🔄 Actualizar</button>
        </div>
      </div>

      <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:20}}>
        <StatCard label="INGRESO BRUTO" value={fp(bruto)} color="#4338ca"/>
        <StatCard label="TOTAL HONORARIOS" value={fp(totalHon)} color="#dc2626"/>
        <StatCard label="MARGEN BRUTO" value={fp(bruto-totalHon)} color="#059669" sub="Antes gastos fijos"/>
      </div>

      {!tieneData && (
        <div style={{background:"#d977060d",border:"1px solid #d9770633",borderRadius:10,padding:"12px 16px",marginBottom:16,color:"#d97706",fontSize:13}}>
          ⚠️ Sin datos para <strong>{MES_LABELS[mes]||mes}</strong>. Importá el Excel o cargá manualmente.
        </div>
      )}

      <Card style={{marginBottom:20}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div style={{color:"#1e293b",fontWeight:800,fontSize:14}}>💰 {MES_LABELS[mes]||mes} — Honorarios</div>
          <div style={{color:"#cbd5e1",fontSize:11}}>✏️ Números editables</div>
        </div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead>
              <tr>{["PROFESIONAL","OSDE","MEDIFE","PREPAGA","PART","REGALO","HONORARIO"].map(h=>(
                <th key={h} style={{...S.th,textAlign:h==="PROFESIONAL"?"left":"right"}}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {profData.map(({prof,osde,medife,prepaga,particular,reg,hon,isDuena,isPaula,color})=>(
                <tr key={prof} style={{background:isDuena?"#07101e":"transparent"}}>
                  <td style={{...S.td,fontWeight:700,color}}>
                    {prof}{isDuena&&<span style={{color:"#64748b",fontSize:10,marginLeft:6}}>dueña</span>}
                    {isPaula&&<span style={{color,fontSize:10,marginLeft:6}}>RPG</span>}
                  </td>
                  <td style={{...S.td,textAlign:"right"}}><EN val={osde} onChange={v=>setOv(prof,"osde",v)} color={color}/></td>
                  <td style={{...S.td,textAlign:"right"}}><EN val={medife} onChange={v=>setOv(prof,"medife",v)} color={color}/></td>
                  <td style={{...S.td,textAlign:"right",color:isDuena?"#94a3b8":"#475569",fontWeight:700}}>{prepaga}</td>
                  <td style={{...S.td,textAlign:"right"}}>
                    {isPaula?<span style={{color:"#cbd5e1"}}>—</span>:<EN val={particular} onChange={v=>setOv(prof,"particular",v)} color={color}/>}
                  </td>
                  <td style={{...S.td,textAlign:"right"}}>
                    {isDuena?<span style={{color:"#cbd5e1"}}>—</span>:<EN val={reg} onChange={v=>setRegalos(r=>({...r,[`${mes}_${prof}`]:parseInt(v)||0}))} color="#d97706"/>}
                  </td>
                  <td style={{...S.td,textAlign:"right"}}>
                    {isDuena?<span style={{color:"#cbd5e1",fontSize:12}}>No aplica</span>
                      :<span style={{color:"#059669",fontWeight:800,fontFamily:"'DM Mono',monospace",fontSize:16}}>{fp(hon)}</span>}
                  </td>
                </tr>
              ))}
              <tr style={{background:"#eef2f7"}}>
                <td style={{...S.td,fontWeight:800,color:"#dc2626"}} colSpan={6}>TOTAL A PAGAR</td>
                <td style={{...S.td,textAlign:"right",fontWeight:800,color:"#dc2626",fontFamily:"'DM Mono',monospace",fontSize:18}}>{fp(totalHon)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Modal importar */}
      {showImport&&(
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999}}>
          <Card style={{width:460,maxWidth:"90vw"}}>
            <div style={{color:"#1e293b",fontWeight:800,fontSize:15,marginBottom:14}}>📥 Importar Excel</div>
            <div style={{background:"#f8faff",borderRadius:9,padding:14,marginBottom:14,color:"#94a3b8",fontSize:13,lineHeight:1.6}}>
              Subí el archivo <code style={{color:"#4338ca"}}>.xlsx</code> de liquidación generado por el CRM.<br/>
              <span style={{color:"#64748b",fontSize:11}}>El mes se detecta automáticamente por el nombre de la hoja.</span>
            </div>
            {importMsg&&<div style={{background:importMsg.ok?"#05966911":"#dc262611",border:`1px solid ${importMsg.ok?"#059669":"#dc2626"}44`,borderRadius:8,padding:"10px 14px",marginBottom:12,color:importMsg.ok?"#059669":"#dc2626",fontSize:13}}>{importMsg.msg}</div>}
            <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleFile} style={{display:"none"}}/>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>fileRef.current.click()} style={S.btn("#4338ca")}>Seleccionar .xlsx</button>
              <button onClick={()=>{setShowImport(false);setImportMsg(null)}} style={S.btn("#e2e8f0")}>Cerrar</button>
            </div>
          </Card>
        </div>
      )}

      {/* Modal agregar día */}
      {showAgregar&&(
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999}}>
          <Card style={{width:460,maxWidth:"90vw"}}>
            <div style={{color:"#1e293b",fontWeight:800,fontSize:15,marginBottom:18}}>➕ Agregar — {MES_LABELS[mes]||mes}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div><label style={S.label}>Profesional</label>
                <select style={S.input} value={formDia.prof} onChange={e=>setFormDia(f=>({...f,prof:e.target.value}))}>
                  {IDS_ACTIVOS.map(p=><option key={p}>{p}</option>)}
                </select>
              </div>
              <div><label style={S.label}>Prestación</label>
                <select style={S.input} value={formDia.prestacion} onChange={e=>setFormDia(f=>({...f,prestacion:e.target.value}))}>
                  {PRESTACIONES.map(p=><option key={p}>{p}</option>)}
                </select>
              </div>
              <div><label style={S.label}>Día (ej: 06/03)</label><input style={S.input} value={formDia.dia} onChange={e=>setFormDia(f=>({...f,dia:e.target.value}))} placeholder="06/03"/></div>
              <div><label style={S.label}>OSDE</label><input type="number" style={S.input} value={formDia.osde} onChange={e=>setFormDia(f=>({...f,osde:e.target.value}))}/></div>
              <div><label style={S.label}>MEDIFE</label><input type="number" style={S.input} value={formDia.medife} onChange={e=>setFormDia(f=>({...f,medife:e.target.value}))}/></div>
              <div><label style={S.label}>PARTICULAR</label><input type="number" style={S.input} value={formDia.particular} onChange={e=>setFormDia(f=>({...f,particular:e.target.value}))}/></div>
              <div><label style={S.label}>REGALOS</label><input type="number" style={S.input} value={formDia.regalo} onChange={e=>setFormDia(f=>({...f,regalo:e.target.value}))}/></div>
              <div><label style={S.label}>Notas</label><input style={S.input} value={formDia.notas} onChange={e=>setFormDia(f=>({...f,notas:e.target.value}))}/></div>
            </div>
            <div style={{display:"flex",gap:10,marginTop:18}}>
              <button onClick={guardarDia} style={S.btn("#059669")}>Guardar</button>
              <button onClick={()=>setShowAgregar(false)} style={S.btn("#e2e8f0")}>Cancelar</button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// ─── VISTA: DASHBOARD ─────────────────────────────────────────────────────────
const mesDeFecha = (f) => f ? f.slice(0,7) : null;
const hoyISO = () => new Date().toISOString().slice(0,10);

// ─── VISTA: FICHA DE PROFESIONAL ───────────────────────────────────────────────
function ViewFichaProfesional({prof, registros, precios, pagosProfesionales=[], onVolver}) {
  const [mes, setMes] = useState(getMesActual());
  const mesesDisp = Array.from({length:6},(_,i)=>{
    const d=new Date(); d.setDate(1); d.setMonth(d.getMonth()-i);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  });
  const color = COLOR_POR_PROFESIONAL[prof] || "#4338ca";

  const res = useMemo(()=>calcResumen(registros,mes),[registros,mes]);
  const d = res[prof] || {osde:0,medife:0,particular:0,regalo:0,pasadaOsde:0};
  const sesiones = d.osde+d.medife+d.particular+(d.regalo||0)+(d.pasadaOsde||0);
  const honGenerado = useMemo(()=>calcHonorario(prof,d,precios),[prof,d,precios]);
  const pago = pagosProfesionales.find(p=>p.mes===mes && p.profesional===prof);
  const honPagado = pago ? pago.importe_pagado : null;
  const diferencia = honPagado!=null ? honGenerado-honPagado : null;

  const evolucion = mesesDisp.slice().reverse().map(m=>{
    const r = calcResumen(registros,m)[prof] || {osde:0,medife:0,particular:0,regalo:0};
    const hon = calcHonorario(prof,r,precios);
    const total = r.osde+r.medife+r.particular+(r.regalo||0);
    return {mes:(MES_LABELS[m]||m).slice(0,3), Sesiones:total, Honorario:Math.round(hon)};
  });

  const diasMes = useMemo(()=>{
    const map={};
    registros.filter(r=>r.mes===mes && r.prof===prof).forEach(r=>{
      const k=r.dia||"sin día";
      if(!map[k]) map[k]={dia:k,osde:0,medife:0,particular:0,regalo:0,notas:[]};
      map[k].osde+=r.osde||0; map[k].medife+=r.medife||0; map[k].particular+=r.particular||0; map[k].regalo+=r.regalo||0;
      if(r.notas) map[k].notas.push(r.notas);
    });
    return Object.values(map).sort((a,b)=>{
      const [da,ma]=a.dia.split("/"); const [db,mb]=b.dia.split("/");
      return (ma||"").localeCompare(mb||"") || (da||"").localeCompare(db||"");
    });
  },[registros,mes,prof]);

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
        <button onClick={onVolver} style={{background:"#f1f5f9",border:"none",borderRadius:8,padding:"6px 12px",cursor:"pointer",fontSize:12,color:"#64748b",fontFamily:"inherit"}}>← Volver</button>
        <div style={{width:12,height:12,borderRadius:"50%",background:color}}/>
        <h1 style={{color:"#1e293b",fontSize:19,fontWeight:800,margin:0}}>{prof}</h1>
        <div style={{flex:1}}/>
        <select value={mes} onChange={e=>setMes(e.target.value)} style={{...S.input,width:160}}>
          {mesesDisp.map(m=><option key={m} value={m}>{MES_LABELS[m]||m}</option>)}
        </select>
      </div>

      <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:20}}>
        {[
          {label:"SESIONES",         val:sesiones,   color:"#1e293b", fmt:v=>v},
          {label:"HONORARIO GENERADO", val:honGenerado, color:"#4338ca", fmt:fp},
          {label:"HONORARIO PAGADO", val:honPagado,  color:"#059669", fmt:v=>v==null?"sin registrar":fp(v)},
          {label:"DIFERENCIA",       val:diferencia, color:diferencia&&diferencia!==0?"#dc2626":"#94a3b8", fmt:v=>v==null?"—":fp(v)},
        ].map(({label,val,color:c,fmt})=>(
          <div key={label} style={{background:"#f8faff",border:`1px solid ${c}28`,borderRadius:12,padding:"14px 16px",flex:1,minWidth:140}}>
            <div style={{color:"#64748b",fontSize:10,fontWeight:700,letterSpacing:1,marginBottom:5}}>{label}</div>
            <div style={{color:c,fontSize:18,fontWeight:800,fontFamily:"'DM Mono',monospace"}}>{fmt(val)}</div>
          </div>
        ))}
      </div>

      <Card style={{marginBottom:20}}>
        <div style={{color:"#64748b",fontSize:12}}>
          OSDE <b style={{color:"#1e293b"}}>{d.osde}</b> · MEDIFE <b style={{color:"#1e293b"}}>{d.medife}</b> ·
          {" "}Particular <b style={{color:"#1e293b"}}>{d.particular}</b> · Regalo <b style={{color:"#1e293b"}}>{d.regalo||0}</b>
        </div>
      </Card>

      <Card style={{marginBottom:20}}>
        <div style={{color:"#1e293b",fontWeight:700,marginBottom:14,fontSize:13}}>📊 Evolución (6 meses)</div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={evolucion} margin={{top:5,right:20,bottom:5,left:10}}>
            <XAxis dataKey="mes" tick={{fill:"#64748b",fontSize:11}}/>
            <YAxis tick={{fill:"#64748b",fontSize:9}}/>
            <Tooltip/>
            <Legend wrapperStyle={{fontSize:10,color:"#94a3b8"}}/>
            <Bar dataKey="Sesiones" fill={color} radius={[3,3,0,0]}/>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card>
        <div style={{color:"#1e293b",fontWeight:700,marginBottom:14,fontSize:13}}>📋 Detalle diario — {MES_LABELS[mes]||mes}</div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead>
              <tr>{["DÍA","OSDE","MEDIFE","PARTICULAR","REGALO","TOTAL","NOTAS"].map(h=>(
                <th key={h} style={{...S.th,textAlign:h==="DÍA"||h==="NOTAS"?"left":"right"}}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {diasMes.map(row=>{
                const total=row.osde+row.medife+row.particular+row.regalo;
                return (
                  <tr key={row.dia}>
                    <td style={{...S.td,fontWeight:700,color:"#1e293b"}}>{row.dia}</td>
                    <td style={{...S.td,textAlign:"right",color:"#4338ca"}}>{row.osde}</td>
                    <td style={{...S.td,textAlign:"right",color:"#7c3aed"}}>{row.medife}</td>
                    <td style={{...S.td,textAlign:"right",color:"#059669"}}>{row.particular}</td>
                    <td style={{...S.td,textAlign:"right",color:"#d97706"}}>{row.regalo}</td>
                    <td style={{...S.td,textAlign:"right",fontWeight:700}}>{total}</td>
                    <td style={{...S.td,color:"#94a3b8",fontSize:11}}>{[...new Set(row.notas)].join(" · ")}</td>
                  </tr>
                );
              })}
              {diasMes.length===0 && (
                <tr><td colSpan={7} style={{...S.td,textAlign:"center",color:"#94a3b8"}}>Sin registros para {MES_LABELS[mes]||mes}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function ViewDashboard({registros, precios, periodos=[], obrasSociales=[], onVerFicha}) {
  const mesesDisp = [...new Set(registros.map(r=>r.mes))].sort().reverse();
  if(!mesesDisp.includes(getMesActual())) mesesDisp.unshift(getMesActual());
  const [mes, setMes] = useState(getMesActual());
  const [vista, setVista] = useState("profesional");

  const nombreOS = (id) => obrasSociales.find(o=>o.id===id)?.nombre || "?";
  const periodosDelMes = useMemo(()=>periodos.filter(p=>mesDeFecha(p.fecha_hasta)===mes),[periodos,mes]);
  const facturadoReal  = periodosDelMes.reduce((s,p)=>s+(p.importe_facturado||0),0);
  const cobradoReal    = periodosDelMes.reduce((s,p)=>s+(p.importe_cobrado||0),0);
  const pendienteReal  = facturadoReal - cobradoReal;
  const porOSReal = useMemo(()=>{
    const acc={};
    periodosDelMes.forEach(p=>{
      const nombre=nombreOS(p.obra_social_id);
      if(!acc[nombre]) acc[nombre]={facturado:0,cobrado:0};
      acc[nombre].facturado+=p.importe_facturado||0;
      acc[nombre].cobrado+=p.importe_cobrado||0;
    });
    return acc;
  },[periodosDelMes,obrasSociales]);
  const pendientesDeFacturar = useMemo(()=>periodos.filter(p=>!p.numero_factura),[periodos]);
  const vencidos = useMemo(()=>periodos.filter(p=>p.numero_factura && p.estado!=="cobrado_total" && p.fecha_cobro_estimada && p.fecha_cobro_estimada<hoyISO()),[periodos]);

  const idxMes = mesesDisp.indexOf(mes);
  const mesAnt  = mesesDisp[idxMes+1] || null;

  const res    = useMemo(()=>calcResumen(registros,mes),[registros,mes]);
  const resAnt = useMemo(()=>mesAnt?calcResumen(registros,mesAnt):{},[registros,mesAnt]);
  const bruto    = useMemo(()=>calcIngresoBruto(registros,mes,precios),[registros,mes,precios]);
  const brutoAnt = useMemo(()=>mesAnt?calcIngresoBruto(registros,mesAnt,precios):0,[registros,mesAnt,precios]);
  const porOS    = useMemo(()=>calcIngresoPorOS(registros,mes,precios),[registros,mes,precios]);
  const porOSAnt = useMemo(()=>mesAnt?calcIngresoPorOS(registros,mesAnt,precios):{OSDE:0,MEDIFE:0,PARTICULAR:0},[registros,mesAnt,precios]);
  const porPrest = useMemo(()=>calcIngresoPorPrestacion(registros,mes,precios),[registros,mes,precios]);

  let totalHon=0, totalHonAnt=0;
  const profStats=IDS_TODOS.map(prof=>{
    const d  = res[prof]||{osde:0,medife:0,particular:0,regalo:0};
    const da = resAnt[prof]||{osde:0,medife:0,particular:0,regalo:0};
    const hon=calcHonorario(prof,d,precios), honA=calcHonorario(prof,da,precios);
    totalHon+=hon; totalHonAnt+=honA;
    const total=d.osde+d.medife+d.particular+(d.regalo||0)+(d.pasadaOsde||0);
    const desglose={osde:d.osde,medife:d.medife,particular:d.particular,regalo:d.regalo||0,pasadaOsde:d.pasadaOsde||0};
    return {prof,total,hon,color:COLOR_POR_PROFESIONAL[prof]||"#fff",desglose};
  }).filter(p=>p.total>0||p.hon>0);

  const barPrestData = Object.entries(porPrest).map(([prest,d])=>({
    name:prest, OSDE:Math.round(d.OSDE), MEDIFE:Math.round(d.MEDIFE), PARTICULAR:Math.round(d.PARTICULAR),
  }));

  const antLabel = mesAnt?(MES_LABELS[mesAnt]||mesAnt).slice(0,3):"Ant";
  const mesLabel  = (MES_LABELS[mes]||mes).slice(0,3);
  const comparData=[
    {name:"Bruto",     [antLabel]:Math.round(brutoAnt),       [mesLabel]:Math.round(bruto)},
    {name:"OSDE",      [antLabel]:Math.round(porOSAnt.OSDE),  [mesLabel]:Math.round(porOS.OSDE)},
    {name:"MEDIFE",    [antLabel]:Math.round(porOSAnt.MEDIFE),[mesLabel]:Math.round(porOS.MEDIFE)},
    {name:"Particular",[antLabel]:Math.round(porOSAnt.PARTICULAR),[mesLabel]:Math.round(porOS.PARTICULAR)},
    {name:"Honorarios",[antLabel]:Math.round(totalHonAnt),    [mesLabel]:Math.round(totalHon)},
  ];

  const delta=(a,b)=>{if(!b)return null;const d=a-b,pct=b>0?((d/b)*100).toFixed(1):null;return{d,pct,color:d>=0?"#059669":"#dc2626",arrow:d>=0?"▲":"▼"};};

  return (
    <div>
      {/* Selector mes + toggle vista */}
      <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap",alignItems:"center"}}>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {mesesDisp.slice(0,5).map(m=>(
            <button key={m} onClick={()=>setMes(m)} style={{...S.btn(mes===m?"#4338ca":"#e2e8f0",12),padding:"7px 16px"}}>
              {MES_LABELS[m]||m}
            </button>
          ))}
        </div>
        <div style={{flex:1}}/>
        <div style={{display:"flex",gap:6}}>
          {[["profesional","👥 Por profesional"],["especialidad","🏥 Por especialidad"]].map(([id,lbl])=>(
            <button key={id} onClick={()=>setVista(id)} style={{...S.btn(vista===id?"#059669":"#e2e8f0",11),padding:"6px 14px"}}>{lbl}</button>
          ))}
        </div>
      </div>

      {/* ¿Cómo viene el mes? — KPI reales del módulo Cobros */}
      <div style={{color:"#64748b",fontSize:11,fontWeight:700,letterSpacing:1,marginBottom:8}}>¿CÓMO VIENE {(MES_LABELS[mes]||mes).toUpperCase()}?</div>
      <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:16}}>
        {[
          {label:"FACTURADO",       val:facturadoReal, color:"#4338ca"},
          {label:"COBRADO",         val:cobradoReal,   color:"#059669"},
          {label:"PENDIENTE",       val:pendienteReal, color:"#d97706"},
          {label:"HONORARIOS A PAGAR", val:totalHon,    color:"#dc2626"},
        ].map(({label,val,color})=>(
          <div key={label} style={{background:"#f8faff",border:`1px solid ${color}28`,borderRadius:12,padding:"16px 18px",flex:1,minWidth:150}}>
            <div style={{color:"#64748b",fontSize:10,fontWeight:700,letterSpacing:1,marginBottom:6}}>{label}</div>
            <div style={{color,fontSize:22,fontWeight:800,fontFamily:"'DM Mono',monospace"}}>{fp(val)}</div>
          </div>
        ))}
      </div>
      {periodosDelMes.length===0 && (
        <div style={{background:"#d977060d",border:"1px solid #d9770633",borderRadius:10,padding:"10px 16px",marginBottom:16,color:"#b45309",fontSize:12}}>
          Todavía no hay períodos de liquidación cargados para {MES_LABELS[mes]||mes} — Facturado/Cobrado/Pendiente se van a completar a medida que se carguen los trámites y facturas correspondientes.
        </div>
      )}

      {/* Por obra social */}
      <div style={{color:"#64748b",fontSize:11,fontWeight:700,letterSpacing:1,marginBottom:8}}>POR OBRA SOCIAL</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:20}}>
        {["OSDE","MEDIFE"].map(nombre=>{
          const d=porOSReal[nombre]||{facturado:0,cobrado:0};
          const color=nombre==="OSDE"?"#4338ca":"#7c3aed";
          return (
            <Card key={nombre} style={{padding:16}}>
              <div style={{color,fontWeight:800,fontSize:13,marginBottom:8}}>{nombre}</div>
              <div style={{color:"#64748b",fontSize:10,letterSpacing:.5}}>FACTURADO</div>
              <div style={{color:"#1e293b",fontFamily:"'DM Mono',monospace",fontWeight:700,fontSize:16,marginBottom:6}}>{fp(d.facturado)}</div>
              <div style={{color:"#64748b",fontSize:10,letterSpacing:.5}}>PENDIENTE DE COBRO</div>
              <div style={{color:"#d97706",fontFamily:"'DM Mono',monospace",fontWeight:700,fontSize:16}}>{fp(d.facturado-d.cobrado)}</div>
            </Card>
          );
        })}
        <Card style={{padding:16}}>
          <div style={{color:"#059669",fontWeight:800,fontSize:13,marginBottom:8}}>PARTICULAR</div>
          <div style={{color:"#64748b",fontSize:10,letterSpacing:.5}}>ESTIMADO (sin período de liquidación propio)</div>
          <div style={{color:"#1e293b",fontFamily:"'DM Mono',monospace",fontWeight:700,fontSize:16}}>{fp(porOS.PARTICULAR)}</div>
        </Card>
      </div>

      {/* Pendiente de atención */}
      {(pendientesDeFacturar.length>0 || vencidos.length>0) && (
        <Card style={{marginBottom:20,borderLeft:"3px solid #d97706"}}>
          <div style={{color:"#92400e",fontWeight:700,fontSize:13,marginBottom:10}}>⚠ Pendiente de atención</div>
          {pendientesDeFacturar.map(p=>(
            <div key={p.id} style={{fontSize:12,color:"#475569",marginBottom:6}}>• {p.etiqueta} — sin facturar todavía</div>
          ))}
          {vencidos.map(p=>(
            <div key={p.id} style={{fontSize:12,color:"#b91c1c",marginBottom:6}}>• {p.etiqueta} — cobro estimado {p.fecha_cobro_estimada}, todavía no se registró el cobro</div>
          ))}
        </Card>
      )}

      {/* VISTA POR PROFESIONAL */}
      {vista==="profesional" && (
        <div style={{display:"grid",gridTemplateColumns:"1fr",gap:16,marginBottom:20}}>
          <Card>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <div style={{color:"#1e293b",fontWeight:700,fontSize:13}}>👥 Profesionales — {MES_LABELS[mes]||mes}</div>
              <div style={{color:"#dc2626",fontFamily:"'DM Mono',monospace",fontWeight:800,fontSize:15}}>Total a pagar: {fp(totalHon)}</div>
            </div>
            {profStats.map(({prof,total,hon,color})=>(
              <div key={prof} onClick={()=>onVerFicha&&onVerFicha(prof)}
                style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 4px",
                  borderBottom:"1px solid #f1f5f9",cursor:onVerFicha?"pointer":"default"}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:9,height:9,borderRadius:"50%",background:color}}/>
                  <span style={{color:"#1e293b",fontSize:13,fontWeight:700}}>{prof}</span>
                  <span style={{color:"#94a3b8",fontSize:12}}>{total} sesiones</span>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{color:"#059669",fontFamily:"'DM Mono',monospace",fontWeight:700,fontSize:13}}>{fp(hon)}</span>
                  {onVerFicha && <span style={{color:"#cbd5e1",fontSize:14}}>›</span>}
                </div>
              </div>
            ))}
          </Card>

          {mesAnt&&(
            <Card style={{gridColumn:"1/-1"}}>
              <div style={{color:"#1e293b",fontWeight:700,marginBottom:14,fontSize:13}}>📊 {MES_LABELS[mesAnt]||mesAnt} → {MES_LABELS[mes]||mes}</div>
              <ResponsiveContainer width="100%" height={190}>
                <BarChart data={comparData} margin={{top:5,right:20,bottom:5,left:10}}>
                  <XAxis dataKey="name" tick={{fill:"#64748b",fontSize:10}}/>
                  <YAxis tick={{fill:"#64748b",fontSize:9}} tickFormatter={v=>v>=1000000?`${(v/1000000).toFixed(1)}M`:v>=1000?`${(v/1000).toFixed(0)}k`:v}/>
                  <Tooltip content={<TooltipCustom/>}/>
                  <Legend wrapperStyle={{fontSize:10,color:"#94a3b8"}}/>
                  <Bar dataKey={antLabel} fill="#1e3050" radius={[3,3,0,0]}/>
                  <Bar dataKey={mesLabel} fill="#4338ca" radius={[3,3,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}
        </div>
      )}

      {/* VISTA POR ESPECIALIDAD */}
      {vista==="especialidad" && (
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:20}}>
          <Card>
            <div style={{color:"#1e293b",fontWeight:700,marginBottom:14,fontSize:13}}>🏥 Ingreso por especialidad</div>
            {Object.entries(porPrest).map(([prest,d],i)=>{
              const total=d.total||0;
              const max=Math.max(...Object.values(porPrest).map(x=>x.total||0))||1;
              const col=PIE_COLORS[i%PIE_COLORS.length];
              return (
                <div key={prest} style={{marginBottom:14}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                    <span style={{color:col,fontSize:12,fontWeight:700}}>{prest}</span>
                    <div style={{display:"flex",gap:8,fontSize:11}}>
                      {d.OSDE>0      && <span style={{color:"#4338ca"}}>O:{fp(d.OSDE)}</span>}
                      {d.MEDIFE>0    && <span style={{color:"#7c3aed"}}>M:{fp(d.MEDIFE)}</span>}
                      {d.PARTICULAR>0&& <span style={{color:"#059669"}}>P:{fp(d.PARTICULAR)}</span>}
                      <span style={{color:"#1e293b",fontFamily:"'DM Mono',monospace",fontWeight:700}}>{fp(total)}</span>
                    </div>
                  </div>
                  <div style={{display:"flex",borderRadius:4,overflow:"hidden",height:7,background:"#f8fafc"}}>
                    {total>0&&[{v:d.OSDE,c:"#4338ca"},{v:d.MEDIFE,c:"#7c3aed"},{v:d.PARTICULAR,c:"#059669"}]
                      .map(({v,c},j)=>v>0&&<div key={j} style={{width:`${(v/total*100)}%`,background:c}}/>)}
                  </div>
                </div>
              );
            })}
          </Card>

          <Card>
            <div style={{color:"#1e293b",fontWeight:700,marginBottom:14,fontSize:13}}>🥧 Distribución por especialidad</div>
            <ResponsiveContainer width="100%" height={230}>
              <PieChart>
                <Pie data={Object.entries(porPrest).map(([name,d])=>({name,value:Math.round(d.total||0)}))}
                  cx="50%" cy="50%" outerRadius={80} dataKey="value"
                  label={({name,percent})=>percent>0.05?`${name} ${(percent*100).toFixed(0)}%`:""} labelLine={false}>
                  {Object.keys(porPrest).map((_,i)=><Cell key={i} fill={PIE_COLORS[i%PIE_COLORS.length]}/>)}
                </Pie>
                <Tooltip formatter={v=>fp(v)} contentStyle={{background:"#1e3a6e",border:"none",borderRadius:10,color:"white"}}/>
              </PieChart>
            </ResponsiveContainer>
          </Card>

          <Card style={{gridColumn:"1/-1"}}>
            <div style={{color:"#1e293b",fontWeight:700,marginBottom:14,fontSize:13}}>📋 Detalle por especialidad — {MES_LABELS[mes]||mes}</div>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead>
                  <tr>{["ESPECIALIDAD","OSDE $","MEDIFE $","PARTICULAR $","TOTAL","% bruto"].map(h=>(
                    <th key={h} style={{...S.th,textAlign:h==="ESPECIALIDAD"?"left":"right"}}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {Object.entries(porPrest).map(([prest,d],i)=>(
                    <tr key={prest}>
                      <td style={S.td}><Badge color={PIE_COLORS[i%PIE_COLORS.length]}>{prest}</Badge></td>
                      <td style={{...S.td,textAlign:"right",fontFamily:"'DM Mono',monospace",color:"#4338ca"}}>{fp(d.OSDE)}</td>
                      <td style={{...S.td,textAlign:"right",fontFamily:"'DM Mono',monospace",color:"#7c3aed"}}>{fp(d.MEDIFE)}</td>
                      <td style={{...S.td,textAlign:"right",fontFamily:"'DM Mono',monospace",color:"#059669"}}>{fp(d.PARTICULAR)}</td>
                      <td style={{...S.td,textAlign:"right",fontFamily:"'DM Mono',monospace",fontWeight:700,color:"#1e293b"}}>{fp(d.total)}</td>
                      <td style={{...S.td,textAlign:"right",color:"#64748b"}}>{bruto>0?`${(d.total/bruto*100).toFixed(1)}%`:"—"}</td>
                    </tr>
                  ))}
                  <tr style={{background:"#eef2f7"}}>
                    <td style={{...S.td,fontWeight:700,color:"#94a3b8"}}>TOTAL</td>
                    <td style={{...S.td,textAlign:"right",fontFamily:"'DM Mono',monospace",fontWeight:700,color:"#4338ca"}}>{fp(porOS.OSDE)}</td>
                    <td style={{...S.td,textAlign:"right",fontFamily:"'DM Mono',monospace",fontWeight:700,color:"#7c3aed"}}>{fp(porOS.MEDIFE)}</td>
                    <td style={{...S.td,textAlign:"right",fontFamily:"'DM Mono',monospace",fontWeight:700,color:"#059669"}}>{fp(porOS.PARTICULAR)}</td>
                    <td style={{...S.td,textAlign:"right",fontFamily:"'DM Mono',monospace",fontWeight:800,fontSize:15,color:"#1e293b"}}>{fp(bruto)}</td>
                    <td style={{...S.td,textAlign:"right",color:"#64748b"}}>100%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          <Card style={{gridColumn:"1/-1"}}>
            <div style={{color:"#1e293b",fontWeight:700,marginBottom:14,fontSize:13}}>📊 Desglose por especialidad y obra social</div>
            <ResponsiveContainer width="100%" height={190}>
              <BarChart data={barPrestData} margin={{top:5,right:20,bottom:5,left:10}}>
                <XAxis dataKey="name" tick={{fill:"#64748b",fontSize:11}}/>
                <YAxis tick={{fill:"#64748b",fontSize:9}} tickFormatter={v=>v>=1000000?`${(v/1000000).toFixed(1)}M`:v>=1000?`${(v/1000).toFixed(0)}k`:v}/>
                <Tooltip content={<TooltipCustom/>}/>
                <Legend wrapperStyle={{fontSize:10,color:"#94a3b8"}}/>
                <Bar dataKey="OSDE"       fill="#4338ca" radius={[3,3,0,0]}/>
                <Bar dataKey="MEDIFE"     fill="#7c3aed" radius={[3,3,0,0]}/>
                <Bar dataKey="PARTICULAR" fill="#059669" radius={[3,3,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}
    </div>
  );
}



// ─── VISTA: COBROS (OSDE + MEDIFE + PARTICULARES) ────────────────────────────
function ViewCobros({registros}) {
  const [tab, setTab] = useState("osde");
  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:20}}>
        {[["osde","🏦 OSDE"],["medife","💙 MEDIFE"],["particular","💵 Particulares"]].map(([id,lbl])=>(
          <button key={id} onClick={()=>setTab(id)}
            style={{...S.btn(tab===id?"#4338ca":"#e2e8f0",12),padding:"7px 18px"}}>{lbl}</button>
        ))}
      </div>
      {tab==="osde"      && <ViewCobrosOSDE registros={registros}/>}
      {tab==="medife"    && <ViewCobrosMedife/>}
      {tab==="particular"&& <ViewCobrosParticular/>}
    </div>
  );
}



// ─── VISTA: LISTA DE PRECIOS ──────────────────────────────────────────────────
function ViewPrecios({ onPreciosUpdate }) {
  const [mes, setMes] = useState(getMesActual());
  const [precios, setPrecios] = useState(null);
  const [editando, setEditando] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [copiando, setCopiando] = useState(false);
  const [saved, setSaved] = useState(false);
  const [sinDatos, setSinDatos] = useState(false);

  // Últimos 6 meses disponibles como opciones
  const mesesDisp = Array.from({length: 6}, (_, i) => {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  });

  function labelMes(m) {
    const [y, mo] = m.split("-");
    const nombres = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    return `${nombres[parseInt(mo)-1]} ${y}`;
  }

  function mesPrevio(m) {
    const [y, mo] = m.split("-").map(Number);
    const d = new Date(y, mo-1, 1); d.setMonth(d.getMonth()-1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  }

  useEffect(() => { cargar(mes); }, [mes]);

  async function cargar(m) {
    setPrecios(null);
    setEditando({});
    const { data } = await supabase.from("crm_precios").select("*").eq("mes", m);
    if (data && data.length > 0) {
      const map = {};
      data.forEach(r => { map[r.clave] = { valor: Number(r.valor), descripcion: r.descripcion }; });
      setPrecios(map);
      setSinDatos(false);
    } else {
      setPrecios({});
      setSinDatos(true);
    }
  }

  async function copiarMesAnterior() {
    setCopiando(true);
    const prev = mesPrevio(mes);
    const { data } = await supabase.from("crm_precios").select("*").eq("mes", prev);
    if (!data || data.length === 0) {
      alert(`No hay precios guardados para ${labelMes(prev)}`);
      setCopiando(false); return;
    }
    // Borrar filas del mes destino y reinsertar con IDs determinísticos
    await supabase.from("crm_precios").delete().eq("mes", mes);
    const filas = data.map(r => ({ mes, clave: r.clave, valor: r.valor, descripcion: r.descripcion }));
    const { error } = await supabase.from("crm_precios").insert(filas);
    if (error) { alert("Error al copiar: " + error.message); setCopiando(false); return; }
    await cargar(mes);
    if (onPreciosUpdate) onPreciosUpdate();
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    setCopiando(false);
  }

  function onChange(clave, valor) {
    setEditando(prev => ({ ...prev, [clave]: valor }));
  }

  async function guardarTodo() {
    setGuardando(true);
    const cambios = Object.entries(editando);
    if (cambios.length === 0) { setGuardando(false); return; }
    // Para cada clave editada: borrar fila existente (cualquier ID) e insertar con ID determinístico
    const clavesEditadas = cambios.map(([c]) => c);
    await supabase.from("crm_precios").delete().eq("mes", mes).in("clave", clavesEditadas);
    const filas = cambios.map(([clave, valor]) => ({
      mes, clave,
      valor: parseFloat(valor) || 0,
      descripcion: precios?.[clave]?.descripcion || clave,
    }));
    const { error } = await supabase.from("crm_precios").insert(filas);
    if (error) { alert("Error al guardar: " + error.message); setGuardando(false); return; }
    await cargar(mes);
    if (onPreciosUpdate) onPreciosUpdate();
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    setGuardando(false);
  }

  const val = (clave) => {
    if (editando[clave] !== undefined) return editando[clave];
    return precios?.[clave]?.valor ?? "";
  };

  const hayEdiciones = Object.keys(editando).length > 0;

  const inputStyle = (clave) => ({
    background: editando[clave] !== undefined ? "#fffbeb" : "#f8faff",
    border: `1px solid ${editando[clave] !== undefined ? "#d97706" : "#c7d2fe"}`,
    borderRadius: 8, padding: "7px 10px", color: "#1e293b",
    fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box",
    fontFamily: "'DM Mono', monospace", fontWeight: 700,
    transition: "border-color 0.15s, background 0.15s"
  });

  const PROFS = PROFESIONALES_ACTIVOS.map(p => ({
    key: p.id.toLowerCase().replace(" ", ""),
    label: p.id,
    soloRPG: !!p.soloRPG,
  }));

  return (
    <div>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:12}}>
        <div>
          <div style={{color:"#1e293b",fontWeight:800,fontSize:18}}>🏷️ Lista de Precios</div>
          <div style={{color:"#64748b",fontSize:12,marginTop:3}}>Los precios se guardan por mes — podés actualizar sin perder el historial</div>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
          {saved && <span style={{color:"#059669",fontWeight:700,fontSize:12}}>✅ Guardado correctamente</span>}
          <button onClick={guardarTodo} disabled={guardando || !hayEdiciones}
            style={{...S.btn(hayEdiciones?"#4338ca":"#94a3b8"),opacity:hayEdiciones?1:0.6}}>
            {guardando ? "Guardando..." : `💾 Guardar cambios${hayEdiciones ? ` (${Object.keys(editando).length})` : ""}`}
          </button>
          <button onClick={()=>cargar(mes)} disabled={guardando} style={S.btn("#64748b")}>↩ Descartar</button>
        </div>
      </div>

      {/* Selector de mes — pills */}
      <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
        {mesesDisp.map(m => (
          <button key={m} onClick={()=>{ if(!hayEdiciones || window.confirm("Tenés cambios sin guardar. ¿Salir igual?")) setMes(m); }}
            style={{padding:"6px 16px",borderRadius:20,border:"none",cursor:"pointer",fontSize:12,fontWeight:700,
              background: m===mes ? "#4338ca" : "#e0e7ff",
              color: m===mes ? "#fff" : "#4338ca",
              boxShadow: m===mes ? "0 2px 8px rgba(99,102,241,0.3)" : "none",
              transition:"all 0.15s"}}>
            {labelMes(m)}{m===getMesActual()?" ★":""}
          </button>
        ))}
      </div>

      {/* Sin datos para el mes — ofrecer copiar del anterior */}
      {sinDatos && (
        <div style={{background:"#f0f9ff",border:"1px solid #7dd3fc",borderRadius:12,padding:"18px 20px",marginBottom:20,display:"flex",justifyContent:"space-between",alignItems:"center",gap:16,flexWrap:"wrap"}}>
          <div>
            <div style={{color:"#0369a1",fontWeight:700,fontSize:14}}>📋 Sin precios para {labelMes(mes)}</div>
            <div style={{color:"#0284c7",fontSize:12,marginTop:3}}>
              Podés copiar los precios de {labelMes(mesPrevio(mes))} como punto de partida y luego editarlos.
            </div>
          </div>
          <button onClick={copiarMesAnterior} disabled={copiando}
            style={{...S.btn("#0ea5e9"),whiteSpace:"nowrap"}}>
            {copiando ? "Copiando..." : `📥 Copiar de ${labelMes(mesPrevio(mes))}`}
          </button>
        </div>
      )}

      {hayEdiciones && (
        <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:10,padding:"10px 16px",marginBottom:16,fontSize:12,color:"#92400e",fontWeight:600}}>
          ⚠️ Tenés {Object.keys(editando).length} cambio{Object.keys(editando).length>1?"s":""} sin guardar en {labelMes(mes)}
        </div>
      )}

      {precios === null ? (
        <div style={{color:"#64748b",padding:40,textAlign:"center"}}>Cargando precios...</div>
      ) : (
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>

          {/* HONORARIOS POR PROFESIONAL */}
          <Card style={{gridColumn:"1/-1"}}>
            <div style={{color:"#1e293b",fontWeight:800,fontSize:14,marginBottom:16}}>👥 Honorarios por profesional — {labelMes(mes)}</div>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                <thead>
                  <tr style={{borderBottom:"2px solid #dbeafe"}}>
                    {["Profesional","Prepaga (OSDE/MEDIFE)","Particular","Regalo"].map(h=>(
                      <th key={h} style={{...S.th,textAlign:h==="Profesional"?"left":"center"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PROFS.map((p,i) => (
                    <tr key={p.key} style={{borderBottom:"1px solid #f0f4ff",background:i%2===0?"transparent":"#f8faff"}}>
                      <td style={{...S.td}}>
                        <span style={{fontWeight:700,color:"#1e293b"}}>{p.label}</span>
                        {p.soloRPG && <Badge color="#7c3aed" style={{marginLeft:8}}>Solo RPG</Badge>}
                      </td>
                      <td style={{...S.td,textAlign:"center"}}>
                        <div style={{display:"flex",alignItems:"center",gap:4,justifyContent:"center"}}>
                          <span style={{color:"#64748b",fontSize:11}}>$</span>
                          <input type="number" value={val(`hon_${p.key}_prepaga`)}
                            onChange={e=>onChange(`hon_${p.key}_prepaga`, e.target.value)}
                            style={{...inputStyle(`hon_${p.key}_prepaga`),width:110}}/>
                        </div>
                      </td>
                      <td style={{...S.td,textAlign:"center"}}>
                        {p.soloRPG ? (
                          <span style={{color:"#94a3b8",fontSize:11}}>— No aplica</span>
                        ) : (
                          <div style={{display:"flex",alignItems:"center",gap:4,justifyContent:"center"}}>
                            <span style={{color:"#64748b",fontSize:11}}>$</span>
                            <input type="number" value={val(`hon_${p.key}_particular`)}
                              onChange={e=>onChange(`hon_${p.key}_particular`, e.target.value)}
                              style={{...inputStyle(`hon_${p.key}_particular`),width:110}}/>
                          </div>
                        )}
                      </td>
                      <td style={{...S.td,textAlign:"center"}}>
                        <div style={{display:"flex",alignItems:"center",gap:4,justifyContent:"center"}}>
                          <span style={{color:"#64748b",fontSize:11}}>$</span>
                          <input type="number" value={val(`hon_${p.key}_regalo`)}
                            onChange={e=>onChange(`hon_${p.key}_regalo`, e.target.value)}
                            style={{...inputStyle(`hon_${p.key}_regalo`),width:110}}/>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* ARANCELES OSDE */}
          <Card>
            <div style={{color:"#1e293b",fontWeight:800,fontSize:14,marginBottom:16}}>🏦 Aranceles OSDE — {labelMes(mes)}</div>
            {[
              {clave:"osde_fkt",    label:"FKT"},
              {clave:"osde_rpg",    label:"RPG"},
              {clave:"osde_drenaje",label:"Drenaje Linfático"},
              {clave:"osde_atm",    label:"ATM"},
            ].map(item=>(
              <div key={item.clave} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,gap:12}}>
                <div style={{color:"#1e293b",fontWeight:600,fontSize:13,minWidth:140}}>{item.label}</div>
                <div style={{display:"flex",alignItems:"center",gap:4}}>
                  <span style={{color:"#64748b",fontSize:11}}>$</span>
                  <input type="number" value={val(item.clave)}
                    onChange={e=>onChange(item.clave, e.target.value)}
                    style={{...inputStyle(item.clave),width:130}}/>
                </div>
              </div>
            ))}
          </Card>

          {/* ARANCEL MEDIFE Y REGALO */}
          <Card>
            <div style={{color:"#1e293b",fontWeight:800,fontSize:14,marginBottom:16}}>💙 MEDIFE & 🎁 Regalo — {labelMes(mes)}</div>
            {[
              {clave:"medife_sesion", label:"MEDIFE — por sesión",        color:"#8b5cf6"},
              {clave:"regalo_ingreso",label:"Ingreso por Regalo (consulta)",color:"#d97706"},
            ].map(item=>(
              <div key={item.clave} style={{marginBottom:16}}>
                <div style={{color:"#64748b",fontSize:11,fontWeight:600,marginBottom:6,letterSpacing:"0.05em",textTransform:"uppercase"}}>{item.label}</div>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <span style={{color:"#64748b",fontSize:13,fontWeight:700}}>$</span>
                  <input type="number" value={val(item.clave)}
                    onChange={e=>onChange(item.clave, e.target.value)}
                    style={{...inputStyle(item.clave),width:160}}/>
                  <span style={{color:item.color,fontWeight:700,fontSize:13}}>
                    = ${Number(val(item.clave)||0).toLocaleString("es-AR")}
                  </span>
                </div>
              </div>
            ))}
            <div style={{background:"#eef2f7",borderRadius:10,padding:"12px 14px",marginTop:8,border:"1px solid #dbeafe"}}>
              <div style={{color:"#64748b",fontSize:11,fontWeight:600,marginBottom:4}}>💡 RECORDÁ</div>
              <div style={{color:"#475569",fontSize:11,lineHeight:1.5}}>
                Los aranceles OSDE se usan para estimar ingresos. El valor real lo confirma la liquidación de OSDE.<br/>
                El arancel de Regalo se usa para calcular el ingreso del consultorio por sesiones sin cargo al paciente.
              </div>
            </div>
          </Card>

        </div>
      )}
    </div>
  );
}

// ─── VISTA: CONCILIACIÓN (OSDE + MEDIFE) ──────────────────────────────────────
function ViewConciliacion({registros}) {
  const [tabConc, setTabConc] = useState("osde"); // "osde" | "medife"

  return (
    <div>
      {/* Selector OSDE / MEDIFE */}
      <div style={{display:"flex",gap:8,marginBottom:24}}>
        {[["osde","🏦 OSDE"],["medife","💜 MEDIFE"]].map(([id,lbl])=>(
          <button key={id} onClick={()=>setTabConc(id)}
            style={{...S.btn(tabConc===id?(id==="osde"?"#4338ca":"#8b5cf6"):"#e2e8f0",13),padding:"8px 22px",fontWeight:700}}>
            {lbl}
          </button>
        ))}
      </div>
      {tabConc==="osde"   && <ViewConciliacionOSDE   registros={registros}/>}
      {tabConc==="medife" && <ViewConciliacionMedife  registros={registros}/>}
    </div>
  );
}

function ViewConciliacionOSDE({registros}) {
  const [archivo, setArchivo] = useState(null);
  const [osdeData, setOsdeData] = useState(null); // {fecha: {consumo, diferida, anulacion, autorizacion}}
  const [mes, setMes] = useState(getMesActual());
  const [procesando, setProcesando] = useState(false);
  const [nombreArchivo, setNombreArchivo] = useState("");

  // Procesar Excel de OSDE
  async function handleArchivo(e) {
    const file = e.target.files[0];
    if (!file) return;
    setProcesando(true);
    setNombreArchivo(file.name);
    const buf = await file.arrayBuffer();
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buf, {type:"array", cellDates:true});
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, {defval:""});

    const porDia = {};
    rows.forEach(row => {
      let fechaRaw = row["Fecha"] || row["fecha"] || "";
      let dia = "";
      if (fechaRaw instanceof Date) dia = fechaRaw.toISOString().slice(0,10);
      else dia = String(fechaRaw).slice(0,10);
      if (!dia || dia.length < 10) return;

      const tipo   = String(row["Tipo Transacción"] || row["Tipo Transaccion"] || "").trim().toUpperCase();
      // Estado: el campo tiene tab al final en algunos exports — limpiar
      const estado = String(row["Estado	"] || row["Estado"] || "").trim().toUpperCase();
      const esOk   = estado === "OK";

      if (!porDia[dia]) porDia[dia] = {consumo:0, diferida:0, autorizacion:0};

      // Solo contar REGISTRACION DE CONSUMO y DIFERIDA — autorizaciones van aparte como info
      if (tipo === "REGISTRACION DE CONSUMO" && esOk) {
        porDia[dia].consumo++;
      } else if (tipo === "REGISTRACION DE CONSUMO DIFERIDA" && esOk) {
        porDia[dia].diferida++;
      } else if (tipo === "SOLICITUD DE AUTORIZACION") {
        porDia[dia].autorizacion++;
      }
      // ANULACIONES y RESCATES no se cuentan — si el export viene filtrado por OK ya están limpios
    });

    // PISA el mes anterior — no acumula
    const dias = Object.keys(porDia).sort();
    const mesDatos = dias.length > 0 ? dias[0].slice(0,7) : mes;
    setOsdeData(prev => {
      const nuevo = {...prev};
      // Eliminar días del mismo mes y reemplazar
      Object.keys(nuevo).forEach(k => { if (k.startsWith(mesDatos)) delete nuevo[k]; });
      Object.assign(nuevo, porDia);
      return nuevo;
    });
    setMes(mesDatos);
    setProcesando(false);
  }

  // Registros CRM del mes seleccionado — suma OSDE por día (todos los profesionales)
  const crmPorDia = {};
  registros.filter(r => r.mes === mes).forEach(r => {
    const dia = r.dia || "";
    if (!dia) return;
    // Convertir dia "02/03" → "2026-03-02"
    const partes = dia.split("/");
    if (partes.length !== 2) return;
    const [d, m] = partes;
    const anio = mes.slice(0,4);
    const key = `${anio}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
    if (!crmPorDia[key]) crmPorDia[key] = {osde:0, medife:0, particular:0};
    crmPorDia[key].osde       += r.osde||0;
    crmPorDia[key].medife     += r.medife||0;
    crmPorDia[key].particular += r.particular||0;
  });

  // Unir días de ambas fuentes
  const todasFechas = new Set([
    ...Object.keys(crmPorDia),
    ...(osdeData ? Object.keys(osdeData).filter(d => d.startsWith(mes)) : [])
  ]);
  const filas = [...todasFechas].sort().map(fecha => {
    const crm = crmPorDia[fecha] || {osde:0};
    const osde = osdeData ? (osdeData[fecha] || {consumo:0, diferida:0, anulacion:0}) : null;
    const osdeTotal = osde ? (osde.consumo + osde.diferida) : null;
    const diff = osde !== null ? (osdeTotal - crm.osde) : null;
    let estado = "sin_osde";
    if (diff !== null) {
      if (diff >= 0) estado = "ok";   // OSDE >= CRM — OK (puede tener diferidas de más)
      else estado = "crm_mayor";       // OSDE < CRM — PROBLEMA: faltan registraciones en OSDE
    }
    return { fecha, crmOsde: crm.osde, osdeTotal, diff, estado, detalle: osde };
  });

  const totalCRM  = filas.reduce((s,f) => s+f.crmOsde, 0);
  const totalOSDE = filas.reduce((s,f) => s+(f.osdeTotal||0), 0);
  const diasOk    = filas.filter(f => f.estado==="ok").length;
  const diasAlerta= filas.filter(f => f.estado==="crm_mayor").length;

  const badgeColor = {
    ok:        {bg:"#f0fdf4", color:"#16a34a", txt:"✅ OK"},
    crm_mayor: {bg:"#fef2f2", color:"#dc2626", txt:"🚨 PROBLEMA"},
    sin_osde:  {bg:"#f8fafc", color:"#94a3b8", txt:"— Sin dato OSDE"},
  };

  return (
    <div>
      {/* Encabezado */}
      <div style={{...S.card, marginBottom:20}}>
        <div style={{color:"#1e293b",fontWeight:800,fontSize:16,marginBottom:4}}>🔍 Conciliación OSDE</div>
        <div style={{color:"#64748b",fontSize:12}}>
          Compará lo registrado en el Control Diario vs las transacciones reales de OSDE.
          Si el CRM tiene más que OSDE, hay prestaciones no registradas en el sistema de OSDE.
        </div>
      </div>

      {/* Upload + selector mes */}
      <div style={{display:"flex",gap:16,marginBottom:20,flexWrap:"wrap",alignItems:"flex-end"}}>
        <div style={{...S.card,flex:1,minWidth:280}}>
          <div style={{color:"#94a3b8",fontSize:11,marginBottom:8,fontWeight:600}}>📁 IMPORTAR EXCEL DE OSDE</div>
          <label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",
            background:"#ffffff",border:"2px dashed #1a2840",borderRadius:8,padding:"12px 16px"}}>
            <span style={{fontSize:20}}>📥</span>
            <div>
              <div style={{color:"#1e293b",fontSize:12,fontWeight:600}}>
                {nombreArchivo || "Seleccionar archivo .xlsx"}
              </div>
              <div style={{color:"#64748b",fontSize:10}}>Exportado desde el portal OSDE</div>
            </div>
            <input type="file" accept=".xlsx,.xls" onChange={handleArchivo} style={{display:"none"}}/>
          </label>
          {procesando && <div style={{color:"#d97706",fontSize:11,marginTop:8}}>⏳ Procesando...</div>}
        </div>

        <div style={{...S.card}}>
          <div style={{color:"#94a3b8",fontSize:11,marginBottom:8,fontWeight:600}}>📅 MES A ANALIZAR</div>
          <input type="month" value={mes} onChange={e=>setMes(e.target.value)}
            style={{...S.input, width:160}}/>
        </div>
      </div>

      {/* KPIs */}
      {filas.length > 0 && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12,marginBottom:20}}>
          {[
            {l:"DÍAS ANALIZADOS",  v:filas.length,    c:"#94a3b8"},
            {l:"TOTAL CRM (OSDE)", v:totalCRM,        c:"#4338ca"},
            {l:"TOTAL OSDE",       v:osdeData?totalOSDE:"—", c:"#0ea5e9"},
            {l:"DÍAS OK",          v:diasOk,           c:"#059669"},
            {l:"DÍAS CON PROBLEMA",v:diasAlerta,       c:diasAlerta>0?"#dc2626":"#059669"},
          ].map(k=>(
            <div key={k.l} style={{...S.card}}>
              <div style={{color:"#64748b",fontSize:9,letterSpacing:1,fontWeight:600}}>{k.l}</div>
              <div style={{color:k.c,fontFamily:"'DM Mono',monospace",fontWeight:800,fontSize:22,marginTop:4}}>{k.v}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabla conciliación */}
      {filas.length > 0 && (
        <div style={{...S.card}}>
          <div style={{color:"#1e293b",fontWeight:700,fontSize:13,marginBottom:14}}>
            📊 Detalle por día — {mes}
            {!osdeData && <span style={{color:"#d97706",fontSize:11,fontWeight:400,marginLeft:8}}>⚠ Importá el Excel de OSDE para ver la comparación</span>}
          </div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead>
                <tr style={{borderBottom:"1px solid #dbeafe"}}>
                  {["Fecha","CRM — OSDE","OSDE — OK","Diferencia","Autorizaciones","Estado"].map(h=>(
                    <th key={h} style={{padding:"8px 12px",textAlign:h==="Fecha"||h==="Estado"?"left":"center",
                      color:"#64748b",fontWeight:600,fontSize:10,letterSpacing:"0.05em",textTransform:"uppercase"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.map((f,i)=>{
                  const b = badgeColor[f.estado];
                  return (
                    <tr key={f.fecha} style={{borderBottom:"1px solid #e0e7ff",background:i%2===0?"white":"#f8faff"}}>
                      <td style={{padding:"10px 12px",color:"#1e293b",fontWeight:700,fontFamily:"'DM Mono',monospace"}}>{f.fecha}</td>
                      <td style={{textAlign:"center",color:"#4338ca",fontWeight:800,fontSize:15,fontFamily:"'DM Mono',monospace"}}>{f.crmOsde}</td>
                      <td style={{textAlign:"center",color:"#0ea5e9",fontWeight:800,fontSize:15,fontFamily:"'DM Mono',monospace"}}>
                        {f.osdeTotal !== null ? f.osdeTotal : <span style={{color:"#cbd5e1"}}>—</span>}

                      </td>
                      <td style={{textAlign:"center",fontFamily:"'DM Mono',monospace",fontWeight:800,fontSize:15,
                        color: f.diff===null?"#cbd5e1":f.diff>=0?"#059669":"#dc2626"}}>
                        {f.diff===null ? "—" : f.diff >= 0 ? (f.diff===0?"=":"+"+f.diff) : f.diff}
                      </td>
                      <td style={{textAlign:"center",color:"#64748b",fontFamily:"'DM Mono',monospace"}}>
                        {f.detalle ? f.detalle.autorizacion : "—"}
                      </td>
                      <td style={{padding:"10px 12px"}}>
                        <span style={{background:b.bg,color:b.color,padding:"3px 10px",borderRadius:6,fontSize:10,fontWeight:700}}>
                          {b.txt}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {osdeData && (
                <tfoot>
                  <tr style={{borderTop:"2px solid #dbeafe"}}>
                    <td style={{padding:"10px 12px",color:"#1e293b",fontWeight:700}}>TOTAL</td>
                    <td style={{textAlign:"center",color:"#4338ca",fontWeight:800,fontSize:15,fontFamily:"'DM Mono',monospace"}}>{totalCRM}</td>
                    <td style={{textAlign:"center",color:"#0ea5e9",fontWeight:800,fontSize:15,fontFamily:"'DM Mono',monospace"}}>{totalOSDE}</td>
                    <td style={{textAlign:"center",fontWeight:800,fontSize:15,fontFamily:"'DM Mono',monospace",
                      color:totalOSDE>=totalCRM?"#059669":"#dc2626"}}>
                      {totalOSDE>=totalCRM ? (totalOSDE-totalCRM===0?"=":"+")+(totalOSDE-totalCRM) : totalOSDE-totalCRM}
                    </td>
                    <td/><td/>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Leyenda */}
          <div style={{marginTop:16,display:"flex",gap:16,flexWrap:"wrap",borderTop:"1px solid #dbeafe",paddingTop:12}}>
            {[
              {c:"#059669", t:"✅ OK — CRM y OSDE coinciden exactamente"},
              {c:"#d97706", t:"⚠️ OSDE mayor — Puede haber diferidas o autorizaciones extra, no es problema"},
              {c:"#dc2626", t:"🚨 Problema — El CRM tiene más que OSDE: hay prestaciones NO registradas en OSDE"},
            ].map(l=>(
              <div key={l.t} style={{display:"flex",alignItems:"center",gap:6,fontSize:10,color:l.c}}>{l.t}</div>
            ))}
          </div>
        </div>
      )}

      {filas.length === 0 && !osdeData && (
        <div style={{...S.card,textAlign:"center",padding:40,color:"#64748b"}}>
          <div style={{fontSize:40,marginBottom:12}}>🔍</div>
          <div style={{fontSize:14,fontWeight:600,color:"#94a3b8",marginBottom:6}}>Sin datos para analizar</div>
          <div style={{fontSize:12}}>Importá el Excel de OSDE y seleccioná el mes para ver la conciliación</div>
        </div>
      )}
    </div>
  );
}

// ─── VISTA: CONCILIACIÓN MEDIFE ───────────────────────────────────────────────
function ViewConciliacionMedife({registros}) {
  const [medifeData, setMedifeData] = useState(null);
  const [mes, setMes] = useState(getMesActual());
  const [procesando, setProcesando] = useState(false);
  const [nombreArchivo, setNombreArchivo] = useState("");
  const [expandida, setExpandida] = useState(null);

  function labelMes(m) {
    const [y,mo]=m.split("-");
    const ns=["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    return `${ns[parseInt(mo)-1]} ${y}`;
  }

  async function handleArchivo(e) {
    const file = e.target.files[0];
    if (!file) return;
    setProcesando(true);
    setNombreArchivo(file.name);
    const buf = await file.arrayBuffer();
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buf, {type:"array", cellDates:true});
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, {defval:""});

    const porDia = {};
    rows.forEach(row => {
      let fechaRaw = row["Fecha"] || row["fecha"] || row["FECHA"] || row["Fecha Prestación"] || row["Fecha Prestacion"] || "";
      let dia = "";
      if (fechaRaw instanceof Date) dia = fechaRaw.toISOString().slice(0,10);
      else dia = String(fechaRaw).slice(0,10);
      if (!dia || dia.length < 10) return;

      const estado = String(row["Estado"] || row["ESTADO"] || row["estado"] || "OK").trim().toUpperCase();
      if (estado.includes("RECHAZ") || estado.includes("ANUL")) return;

      if (!porDia[dia]) porDia[dia] = {pacientes:0, detalle:[]};
      porDia[dia].pacientes++;

      const nroSocio = row["Nro Socio"] || row["Número de Socio"] || row["N° Socio"] || row["nro_socio"] || "";
      const nombre   = row["Apellido y Nombre"] || row["Nombre"] || row["nombre"] || "";
      if (nroSocio || nombre) porDia[dia].detalle.push({nroSocio, nombre});
    });

    const dias = Object.keys(porDia).sort();
    const mesDatos = dias.length > 0 ? dias[0].slice(0,7) : mes;
    setMedifeData(prev => {
      const nuevo = {...(prev||{})};
      Object.keys(nuevo).forEach(k => { if(k.startsWith(mesDatos)) delete nuevo[k]; });
      Object.assign(nuevo, porDia);
      return nuevo;
    });
    setMes(mesDatos);
    setProcesando(false);
  }

  // CRM MEDIFE por día
  const crmPorDia = {};
  registros.filter(r => r.mes === mes).forEach(r => {
    const dia = r.dia || "";
    if (!dia) return;
    const partes = dia.split("/");
    if (partes.length !== 2) return;
    const [d, m] = partes;
    const anio = mes.slice(0,4);
    const key = `${anio}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
    if (!crmPorDia[key]) crmPorDia[key] = {medife:0, profs:[]};
    crmPorDia[key].medife += r.medife||0;
    if ((r.medife||0)>0) crmPorDia[key].profs.push({prof:r.prof, medife:r.medife});
  });

  const todasFechas = new Set([
    ...Object.keys(crmPorDia),
    ...(medifeData ? Object.keys(medifeData).filter(d=>d.startsWith(mes)) : [])
  ]);

  const filas = [...todasFechas].sort().map(fecha => {
    const crm = crmPorDia[fecha] || {medife:0};
    const med = medifeData ? (medifeData[fecha] || {pacientes:0}) : null;
    const diff = med !== null ? ((med.pacientes||0) - crm.medife) : null;
    let estado = "sin_medife";
    if (diff !== null) {
      if (diff === 0)   estado = "ok";
      else if (diff > 0) estado = "medife_mayor";
      else               estado = "crm_mayor";
    }
    return {fecha, crmMedife:crm.medife, medPacientes:med?.pacientes??null, diff, estado, profs:crm.profs||[], detalle:med?.detalle||[]};
  });

  const totalCRM    = filas.reduce((s,f)=>s+f.crmMedife,0);
  const totalMedife = filas.reduce((s,f)=>s+(f.medPacientes||0),0);
  const diasOk      = filas.filter(f=>f.estado==="ok").length;
  const diasProblem = filas.filter(f=>f.estado==="crm_mayor").length;

  const badgeColor = {
    ok:          {bg:"#f0fdf4",color:"#16a34a",txt:"✅ OK"},
    medife_mayor:{bg:"#fef3c7",color:"#d97706",txt:"⚠️ MEDIFE mayor"},
    crm_mayor:   {bg:"#fef2f2",color:"#dc2626",txt:"🚨 PROBLEMA"},
    sin_medife:  {bg:"#f8fafc",color:"#94a3b8",txt:"— Sin dato MEDIFE"},
  };

  return (
    <div>
      <Card style={{marginBottom:20,borderLeft:"3px solid #8b5cf6"}}>
        <div style={{color:"#1e293b",fontWeight:800,fontSize:15,marginBottom:4}}>💜 Conciliación MEDIFE</div>
        <div style={{color:"#64748b",fontSize:12,lineHeight:1.6}}>
          Compará los pacientes MEDIFE del CRM vs el archivo del sistema MEDIFE por día.<br/>
          Si el CRM tiene más → hay pacientes no registrados en MEDIFE. Si MEDIFE tiene más → puede haber reingresos.
        </div>
      </Card>

      <div style={{display:"flex",gap:16,marginBottom:20,flexWrap:"wrap",alignItems:"flex-end"}}>
        <Card style={{flex:1,minWidth:280}}>
          <div style={{color:"#94a3b8",fontSize:11,marginBottom:8,fontWeight:600}}>📁 IMPORTAR EXCEL DE MEDIFE</div>
          <label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",
            background:"#f8faff",border:"2px dashed #8b5cf6",borderRadius:8,padding:"12px 16px"}}>
            <span style={{fontSize:20}}>📥</span>
            <div>
              <div style={{color:"#1e293b",fontSize:12,fontWeight:600}}>
                {nombreArchivo || "Seleccionar archivo .xlsx"}
              </div>
              <div style={{color:"#64748b",fontSize:10}}>Exportado del portal MEDIFE — historial de pacientes</div>
            </div>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleArchivo} style={{display:"none"}}/>
          </label>
          {procesando && <div style={{color:"#8b5cf6",fontSize:11,marginTop:8}}>⏳ Procesando...</div>}
          {nombreArchivo && !procesando && <div style={{color:"#7c3aed",fontSize:11,marginTop:6,fontWeight:600}}>✅ Archivo cargado</div>}
        </Card>
        <Card>
          <div style={{color:"#94a3b8",fontSize:11,marginBottom:8,fontWeight:600}}>📅 MES</div>
          <input type="month" value={mes} onChange={e=>setMes(e.target.value)} style={{...S.input,width:160}}/>
          <div style={{color:"#64748b",fontSize:10,marginTop:6}}>{labelMes(mes)}</div>
        </Card>
      </div>

      {filas.length > 0 && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginBottom:20}}>
          {[
            {l:"DÍAS ANALIZADOS",v:filas.length,    c:"#94a3b8"},
            {l:"TOTAL CRM",      v:totalCRM,         c:"#8b5cf6"},
            {l:"TOTAL MEDIFE",   v:medifeData?totalMedife:"—",c:"#06b6d4"},
            {l:"DÍAS OK",        v:diasOk,           c:"#059669"},
            {l:"DÍAS PROBLEMA",  v:diasProblem,      c:diasProblem>0?"#dc2626":"#059669"},
          ].map(k=>(
            <div key={k.l} style={{background:"#f8faff",border:"1px solid #e0e7ff",borderRadius:12,padding:"14px 16px"}}>
              <div style={{color:"#64748b",fontSize:9,letterSpacing:1,fontWeight:700}}>{k.l}</div>
              <div style={{color:k.c,fontFamily:"'DM Mono',monospace",fontWeight:800,fontSize:22,marginTop:4}}>{k.v}</div>
            </div>
          ))}
        </div>
      )}

      {filas.length > 0 && (
        <Card>
          <div style={{color:"#1e293b",fontWeight:700,fontSize:13,marginBottom:14}}>
            📊 Detalle por día — {labelMes(mes)}
            {!medifeData && <span style={{color:"#d97706",fontSize:11,fontWeight:400,marginLeft:8}}>⚠ Importá el Excel de MEDIFE para comparar</span>}
          </div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead>
                <tr style={{borderBottom:"1px solid #dbeafe"}}>
                  {["Fecha","CRM (pac.)","MEDIFE (arch.)","Diferencia","Estado","▼"].map(h=>(
                    <th key={h} style={{padding:"8px 12px",textAlign:["Fecha","Estado"].includes(h)?"left":"center",
                      color:"#64748b",fontWeight:700,fontSize:10,letterSpacing:"0.05em",textTransform:"uppercase"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.map((f,i)=>{
                  const b = badgeColor[f.estado];
                  const isExp = expandida === f.fecha;
                  return (
                    <React.Fragment key={f.fecha}>
                      <tr style={{borderBottom:"1px solid #e0e7ff",background:i%2===0?"white":"#f8faff"}}>
                        <td style={{padding:"10px 12px",color:"#1e293b",fontWeight:700,fontFamily:"'DM Mono',monospace"}}>{f.fecha}</td>
                        <td style={{textAlign:"center",color:"#8b5cf6",fontWeight:800,fontSize:15,fontFamily:"'DM Mono',monospace"}}>{f.crmMedife}</td>
                        <td style={{textAlign:"center",color:"#06b6d4",fontWeight:800,fontSize:15,fontFamily:"'DM Mono',monospace"}}>
                          {f.medPacientes !== null ? f.medPacientes : <span style={{color:"#cbd5e1"}}>—</span>}
                        </td>
                        <td style={{textAlign:"center",fontFamily:"'DM Mono',monospace",fontWeight:800,fontSize:15,
                          color:f.diff===null?"#cbd5e1":f.diff===0?"#059669":f.diff>0?"#d97706":"#dc2626"}}>
                          {f.diff===null?"—":f.diff===0?"=":f.diff>0?"+"+f.diff:f.diff}
                        </td>
                        <td style={{padding:"10px 12px"}}>
                          <span style={{background:b.bg,color:b.color,padding:"3px 10px",borderRadius:6,fontSize:10,fontWeight:700}}>
                            {b.txt}
                          </span>
                        </td>
                        <td style={{textAlign:"center"}}>
                          {(f.profs.length>0||f.detalle.length>0) && (
                            <button onClick={()=>setExpandida(isExp?null:f.fecha)}
                              style={{background:isExp?"#e0e7ff":"#f1f5f9",border:"none",borderRadius:6,padding:"3px 8px",cursor:"pointer",fontSize:11,color:"#4338ca",fontWeight:700}}>
                              {isExp?"▲":"▼"}
                            </button>
                          )}
                        </td>
                      </tr>
                      {isExp && (
                        <tr style={{background:"#f5f3ff"}}>
                          <td colSpan={6} style={{padding:"10px 16px",borderBottom:"1px solid #dbeafe"}}>
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
                              {f.profs.length>0 && (
                                <div>
                                  <div style={{color:"#8b5cf6",fontSize:10,fontWeight:700,letterSpacing:1,marginBottom:6}}>CRM — PROFESIONALES</div>
                                  {f.profs.map((p,j)=>(
                                    <div key={j} style={{color:"#475569",fontSize:11,padding:"2px 0"}}>
                                      <span style={{fontWeight:700}}>{p.prof}</span> → {p.medife} paciente{p.medife!==1?"s":""}
                                    </div>
                                  ))}
                                </div>
                              )}
                              {f.detalle.length>0 && (
                                <div>
                                  <div style={{color:"#06b6d4",fontSize:10,fontWeight:700,letterSpacing:1,marginBottom:6}}>MEDIFE — PACIENTES</div>
                                  {f.detalle.slice(0,12).map((p,j)=>(
                                    <div key={j} style={{color:"#475569",fontSize:11,padding:"2px 0"}}>
                                      {p.nombre||"—"}{p.nroSocio?<span style={{color:"#94a3b8",marginLeft:6}}>#{p.nroSocio}</span>:null}
                                    </div>
                                  ))}
                                  {f.detalle.length>12&&<div style={{color:"#94a3b8",fontSize:10,marginTop:4}}>...y {f.detalle.length-12} más</div>}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
              {medifeData && (
                <tfoot>
                  <tr style={{borderTop:"2px solid #dbeafe"}}>
                    <td style={{padding:"10px 12px",color:"#1e293b",fontWeight:700}}>TOTAL</td>
                    <td style={{textAlign:"center",color:"#8b5cf6",fontWeight:800,fontSize:15,fontFamily:"'DM Mono',monospace"}}>{totalCRM}</td>
                    <td style={{textAlign:"center",color:"#06b6d4",fontWeight:800,fontSize:15,fontFamily:"'DM Mono',monospace"}}>{totalMedife}</td>
                    <td style={{textAlign:"center",fontWeight:800,fontSize:15,fontFamily:"'DM Mono',monospace",
                      color:totalMedife>=totalCRM?"#059669":"#dc2626"}}>
                      {totalMedife>=totalCRM?(totalMedife-totalCRM===0?"=":"+"+(totalMedife-totalCRM)):totalMedife-totalCRM}
                    </td>
                    <td/><td/>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <div style={{marginTop:16,display:"flex",gap:16,flexWrap:"wrap",borderTop:"1px solid #dbeafe",paddingTop:12}}>
            {[
              {c:"#059669",t:"✅ OK — CRM y MEDIFE coinciden"},
              {c:"#d97706",t:"⚠️ MEDIFE mayor — Puede haber reingresos"},
              {c:"#dc2626",t:"🚨 Problema — CRM tiene más: atenciones no registradas en MEDIFE"},
            ].map(l=>(
              <div key={l.t} style={{display:"flex",alignItems:"center",gap:6,fontSize:10,color:l.c}}>{l.t}</div>
            ))}
          </div>
        </Card>
      )}

      {filas.length === 0 && (
        <Card style={{textAlign:"center",padding:40}}>
          <div style={{fontSize:40,marginBottom:12}}>💜</div>
          <div style={{fontSize:14,fontWeight:600,color:"#94a3b8",marginBottom:6}}>Sin datos para analizar</div>
          <div style={{fontSize:12,color:"#64748b"}}>Seleccioná el mes. Opcionalmente importá el Excel de MEDIFE para comparar paciente por paciente.</div>
        </Card>
      )}
    </div>
  );
}

// ─── VISTA: COBROS MEDIFE ─────────────────────────────────────────────────────
function ViewCobrosMedife() {
  const [cobros, setCobros] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editando, setEditando] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [mesFiltro, setMesFiltro] = useState("todos");

  const FORM_EMPTY = {
    factNro:"", fechaEmision:"", periodoDesde:"", periodoHasta:"",
    mesImpacto: getMesActual(),
    pacientesObligatorios:0, pacientesDirectos:0,
    precioUnitario:0, importeExento:0, importeGravado:0, iva:0, totalConIVA:0, notas:"",
  };
  const [form, setForm] = useState(FORM_EMPTY);

  // Últimos 8 meses para el selector
  const mesesOpc = Array.from({length:8},(_,i)=>{
    const d=new Date(); d.setDate(1); d.setMonth(d.getMonth()-i+2);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  }).reverse();

  function labelMes(m) {
    const [y,mo]=m.split("-");
    const ns=["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    return `${ns[parseInt(mo)-1]} ${y}`;
  }

  useEffect(()=>{ cargar(); },[]);

  async function cargar() {
    setCargando(true);
    const {data,error}=await supabase.from("crm_cobros_medife").select("*").order("fecha_emision",{ascending:false});
    if(!error&&data) {
      setCobros(data.map(r=>({
        id: r.id,
        factNro: r.fact_nro,
        fechaEmision: r.fecha_emision,
        periodoDesde: r.periodo_desde,
        periodoHasta: r.periodo_hasta,
        mesImpacto: r.mes_impacto,
        pacientesObligatorios: Number(r.pacientes_obligatorios)||0,
        pacientesDirectos: Number(r.pacientes_directos)||0,
        totalPacientes: Number(r.total_pacientes)||0,
        precioUnitario: Number(r.precio_unitario)||0,
        importeExento: Number(r.importe_exento)||0,
        importeGravado: Number(r.importe_gravado)||0,
        iva: Number(r.iva)||0,
        totalConIVA: Number(r.total_con_iva)||0,
        notas: r.notas||"",
      })));
    }
    setCargando(false);
  }

  function abrirNuevo() {
    setForm(FORM_EMPTY);
    setEditando(null);
    setShowForm(true);
  }

  function abrirEditar(c) {
    setForm({
      factNro:c.factNro, fechaEmision:c.fechaEmision,
      periodoDesde:c.periodoDesde, periodoHasta:c.periodoHasta,
      mesImpacto:c.mesImpacto,
      pacientesObligatorios:c.pacientesObligatorios, pacientesDirectos:c.pacientesDirectos,
      precioUnitario:c.precioUnitario, importeExento:c.importeExento,
      importeGravado:c.importeGravado, iva:c.iva, totalConIVA:c.totalConIVA, notas:c.notas,
    });
    setEditando(c.id);
    setShowForm(true);
  }

  async function eliminar(id) {
    if(!window.confirm("¿Eliminar esta factura MEDIFE?")) return;
    await supabase.from("crm_cobros_medife").delete().eq("id",id);
    await cargar();
  }

  async function guardar() {
    setGuardando(true);
    const ob=parseInt(form.pacientesObligatorios)||0;
    const di=parseInt(form.pacientesDirectos)||0;
    const row={
      fact_nro:           form.factNro,
      fecha_emision:      form.fechaEmision,
      periodo_desde:      form.periodoDesde,
      periodo_hasta:      form.periodoHasta,
      mes_impacto:        form.mesImpacto,
      pacientes_obligatorios: ob,
      pacientes_directos:     di,
      total_pacientes:        ob+di,
      precio_unitario:    parseFloat(form.precioUnitario)||0,
      importe_exento:     parseFloat(form.importeExento)||0,
      importe_gravado:    parseFloat(form.importeGravado)||0,
      iva:                parseFloat(form.iva)||0,
      total_con_iva:      parseFloat(form.totalConIVA)||0,
      notas:              form.notas,
    };
    if(editando) {
      await supabase.from("crm_cobros_medife").update(row).eq("id",editando);
    } else {
      await supabase.from("crm_cobros_medife").insert({...row, id:fid()});
    }
    await cargar();
    setShowForm(false);
    setGuardando(false);
  }

  // KPIs por mes (para cards clicables)
  const porMes = useMemo(()=>{
    const acc={};
    cobros.forEach(c=>{
      if(!acc[c.mesImpacto]) acc[c.mesImpacto]={totalConIVA:0,pacientes:0,facturas:0};
      acc[c.mesImpacto].totalConIVA += c.totalConIVA||0;
      acc[c.mesImpacto].pacientes   += c.totalPacientes||0;
      acc[c.mesImpacto].facturas    += 1;
    });
    return acc;
  },[cobros]);

  const cobrosFiltrados = mesFiltro==="todos" ? cobros : cobros.filter(c=>c.mesImpacto===mesFiltro);

  // Total con IVA calculado en tiempo real para el form
  const totalCalculado = useMemo(()=>{
    const ob=parseInt(form.pacientesObligatorios)||0;
    const di=parseInt(form.pacientesDirectos)||0;
    const pu=parseFloat(form.precioUnitario)||0;
    return (ob+di)*pu;
  },[form.pacientesObligatorios,form.pacientesDirectos,form.precioUnitario]);

  return (
    <div>
      <Card style={{marginBottom:20,background:"#ffffff",borderLeft:"3px solid #8b5cf6"}}>
        <div style={{color:"#475569",fontSize:13,lineHeight:1.8}}>
          <strong style={{color:"#8b5cf6"}}>¿Cómo liquida MEDIFE?</strong> Se factura del <strong style={{color:"#1e293b"}}>1 al 10</strong> de cada mes por las atenciones del mes anterior.<br/>
          <span style={{color:"#64748b",fontSize:12}}>Ej: FC N°85 emitida 09/12/2025 → pacientes atendidos en noviembre 2025. Precio unitario por paciente.</span>
        </div>
      </Card>

      {/* KPI cards por mes — clicables como filtro */}
      {Object.keys(porMes).length > 0 && (
        <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:20}}>
          {Object.entries(porMes).sort((a,b)=>b[0].localeCompare(a[0])).map(([m,d])=>(
            <div key={m} onClick={()=>setMesFiltro(mesFiltro===m?"todos":m)}
              style={{background:mesFiltro===m?"#7c3aed":"#f5f3ff",
                border:`1px solid ${mesFiltro===m?"#7c3aed":"#8b5cf633"}`,
                borderRadius:12,padding:"14px 18px",flex:1,minWidth:150,cursor:"pointer",transition:"all 0.15s"}}>
              <div style={{color:mesFiltro===m?"rgba(255,255,255,0.7)":"#7c3aed",fontSize:10,fontWeight:700,letterSpacing:1,marginBottom:5}}>
                COBRO {labelMes(m).toUpperCase()}
              </div>
              <div style={{color:mesFiltro===m?"#fff":"#059669",fontSize:20,fontWeight:800,fontFamily:"'DM Mono',monospace"}}>{fp(d.totalConIVA)}</div>
              <div style={{color:mesFiltro===m?"rgba(255,255,255,0.6)":"#64748b",fontSize:11,marginTop:3}}>
                {d.pacientes} pacientes · {d.facturas} factura{d.facturas!==1?"s":""}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div>
          {mesFiltro!=="todos" && (
            <span style={{background:"#f3e8ff",border:"1px solid #d8b4fe",borderRadius:20,padding:"4px 12px",fontSize:12,color:"#7c3aed",fontWeight:700}}>
              Filtrando: {labelMes(mesFiltro)}
              <button onClick={()=>setMesFiltro("todos")} style={{background:"none",border:"none",color:"#7c3aed",cursor:"pointer",marginLeft:6,fontSize:14,lineHeight:1}}>×</button>
            </span>
          )}
        </div>
        <button onClick={abrirNuevo} style={S.btn("#8b5cf6")}>＋ Nueva factura MEDIFE</button>
      </div>

      {cargando && <div style={{color:"#64748b",padding:40,textAlign:"center"}}>Cargando facturas...</div>}

      {!cargando && cobrosFiltrados.length===0 && (
        <Card style={{textAlign:"center",padding:"3rem",color:"#94a3b8"}}>
          {mesFiltro==="todos" ? "No hay facturas cargadas aún." : `Sin facturas para ${labelMes(mesFiltro)}.`}<br/>
          <button onClick={abrirNuevo} style={{...S.btn("#8b5cf6",12),marginTop:12}}>＋ Registrar primera factura</button>
        </Card>
      )}

      {!cargando && cobrosFiltrados.map(c=>(
        <Card key={c.id} style={{marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4,flexWrap:"wrap"}}>
                <span style={{color:"#1e293b",fontWeight:800,fontSize:15}}>{c.factNro}</span>
                <Badge color="#8b5cf6">MEDIFE</Badge>
                <Badge color="#059669">Impacta {labelMes(c.mesImpacto)}</Badge>
              </div>
              <div style={{color:"#64748b",fontSize:12}}>
                Emitida: <span style={{color:"#94a3b8"}}>{c.fechaEmision}</span>
                &nbsp;·&nbsp; Período: <span style={{color:"#94a3b8"}}>{c.periodoDesde} → {c.periodoHasta}</span>
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:8}}>
              <div style={{textAlign:"right"}}>
                <div style={{color:"#64748b",fontSize:10,marginBottom:3}}>TOTAL CON IVA</div>
                <div style={{color:"#059669",fontFamily:"'DM Mono',monospace",fontWeight:800,fontSize:20}}>{fp(c.totalConIVA)}</div>
              </div>
              <div style={{display:"flex",gap:6}}>
                <button onClick={()=>abrirEditar(c)}
                  style={{background:"#f3e8ff",border:"none",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:13,color:"#7c3aed",fontWeight:700}}>✏️ Editar</button>
                <button onClick={()=>eliminar(c.id)}
                  style={{background:"#fee2e2",border:"none",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:13,color:"#b91c1c",fontWeight:700}}>🗑️</button>
              </div>
            </div>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:12}}>
            {[
              {lbl:"Pacientes obligatorios",val:c.pacientesObligatorios,color:"#8b5cf6"},
              {lbl:"Pacientes directos",val:c.pacientesDirectos,color:"#a78bfa"},
              {lbl:"Total pacientes",val:c.totalPacientes,color:"#1e293b"},
              {lbl:"Precio unitario",val:fp(c.precioUnitario),color:"#d97706"},
            ].map(({lbl,val,color})=>(
              <div key={lbl} style={{background:"#f8faff",borderRadius:8,padding:"10px 12px",textAlign:"center"}}>
                <div style={{color:"#64748b",fontSize:10,marginBottom:4}}>{lbl}</div>
                <div style={{color,fontFamily:"'DM Mono',monospace",fontWeight:700,fontSize:14}}>{val}</div>
              </div>
            ))}
          </div>

          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
            {[
              {lbl:"Exento",val:fp(c.importeExento),color:"#94a3b8"},
              {lbl:"Gravado",val:fp(c.importeGravado),color:"#4338ca"},
              {lbl:"IVA 10.5%",val:fp(c.iva),color:"#d97706"},
              {lbl:"Total c/IVA",val:fp(c.totalConIVA),color:"#059669"},
            ].map(({lbl,val,color})=>(
              <div key={lbl} style={{background:"#f8faff",borderRadius:8,padding:"10px 12px",textAlign:"center"}}>
                <div style={{color:"#64748b",fontSize:10,marginBottom:4}}>{lbl}</div>
                <div style={{color,fontFamily:"'DM Mono',monospace",fontWeight:700,fontSize:13}}>{val}</div>
              </div>
            ))}
          </div>

          {c.notas&&<div style={{marginTop:10,color:"#64748b",fontSize:12,borderTop:"1px solid #dbeafe",paddingTop:10}}>{c.notas}</div>}
        </Card>
      ))}

      {/* MODAL NUEVO / EDITAR */}
      {showForm && (
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,overflow:"auto",padding:20}}>
          <Card style={{width:540,maxWidth:"95vw",maxHeight:"90vh",overflowY:"auto"}}>
            <div style={{color:"#1e293b",fontWeight:800,fontSize:15,marginBottom:6}}>
              {editando ? "✏️ Editar factura MEDIFE" : "＋ Registrar factura MEDIFE"}
            </div>
            <div style={{color:"#64748b",fontSize:12,marginBottom:16}}>Completá con los datos de la Factura A emitida a MEDIFE</div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
              <div><label style={S.label}>Nº Factura</label>
                <input style={S.input} value={form.factNro} onChange={e=>setForm(f=>({...f,factNro:e.target.value}))} placeholder="FC N° 86"/></div>
              <div><label style={S.label}>Fecha Emisión</label>
                <input style={S.input} value={form.fechaEmision} onChange={e=>setForm(f=>({...f,fechaEmision:e.target.value}))} placeholder="09/01/2026"/></div>
              <div><label style={S.label}>Período Desde</label>
                <input style={S.input} value={form.periodoDesde} onChange={e=>setForm(f=>({...f,periodoDesde:e.target.value}))} placeholder="01/12/2025"/></div>
              <div><label style={S.label}>Período Hasta</label>
                <input style={S.input} value={form.periodoHasta} onChange={e=>setForm(f=>({...f,periodoHasta:e.target.value}))} placeholder="31/12/2025"/></div>
              <div style={{gridColumn:"1/-1"}}>
                <label style={S.label}>Mes que impacta en caja</label>
                <select style={S.input} value={form.mesImpacto} onChange={e=>setForm(f=>({...f,mesImpacto:e.target.value}))}>
                  {mesesOpc.map(m=><option key={m} value={m}>{labelMes(m)}</option>)}
                </select>
              </div>
            </div>

            <div style={{color:"#64748b",fontSize:10,fontWeight:700,letterSpacing:1,marginBottom:8}}>PACIENTES</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:4}}>
              <div><label style={S.label}>Obligatorios</label>
                <input type="number" style={S.input} value={form.pacientesObligatorios} onChange={e=>setForm(f=>({...f,pacientesObligatorios:e.target.value}))}/></div>
              <div><label style={S.label}>Directos</label>
                <input type="number" style={S.input} value={form.pacientesDirectos} onChange={e=>setForm(f=>({...f,pacientesDirectos:e.target.value}))}/></div>
              <div><label style={S.label}>Precio unitario $</label>
                <input type="number" style={S.input} value={form.precioUnitario} onChange={e=>setForm(f=>({...f,precioUnitario:e.target.value}))}/></div>
            </div>
            {totalCalculado > 0 && (
              <div style={{background:"#f3e8ff",borderRadius:8,padding:"8px 12px",marginBottom:14,fontSize:12,color:"#7c3aed",fontWeight:700}}>
                💜 {(parseInt(form.pacientesObligatorios)||0)+(parseInt(form.pacientesDirectos)||0)} pacientes × {fp(parseFloat(form.precioUnitario)||0)} = <span style={{fontSize:14}}>{fp(totalCalculado)}</span>
              </div>
            )}

            <div style={{color:"#64748b",fontSize:10,fontWeight:700,letterSpacing:1,marginBottom:8}}>TOTALES (de la factura)</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
              <div><label style={S.label}>Importe Exento</label>
                <input type="number" style={S.input} value={form.importeExento} onChange={e=>setForm(f=>({...f,importeExento:e.target.value}))}/></div>
              <div><label style={S.label}>Importe Gravado</label>
                <input type="number" style={S.input} value={form.importeGravado} onChange={e=>setForm(f=>({...f,importeGravado:e.target.value}))}/></div>
              <div><label style={S.label}>IVA 10.5%</label>
                <input type="number" style={S.input} value={form.iva} onChange={e=>setForm(f=>({...f,iva:e.target.value}))}/></div>
              <div><label style={S.label}>TOTAL CON IVA ← el que paga MEDIFE</label>
                <input type="number" style={{...S.input,border:"2px solid #059669",background:"#f0fdf4"}} value={form.totalConIVA} onChange={e=>setForm(f=>({...f,totalConIVA:e.target.value}))}/></div>
              <div style={{gridColumn:"1/-1"}}>
                <label style={S.label}>Notas</label>
                <input style={S.input} value={form.notas} onChange={e=>setForm(f=>({...f,notas:e.target.value}))} placeholder="Ej: Acreditado 15/01/2026"/>
              </div>
            </div>

            <div style={{display:"flex",gap:10}}>
              <button onClick={guardar} disabled={guardando} style={S.btn("#8b5cf6")}>
                {guardando?"Guardando...":editando?"💾 Actualizar factura":"💾 Guardar factura"}
              </button>
              <button onClick={()=>setShowForm(false)} style={S.btn("#64748b")}>Cancelar</button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// ─── VISTA: COBROS PARTICULARES ───────────────────────────────────────────────
function ViewCobrosParticular() {
  const [cobros, setCobros] = useState(COBROS_PARTICULARES_INIT);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    fecha:"", descripcion:"", prof:"ISOLINA", pacientes:0, monto:0, mesImpacto:getMesActual(), notas:"",
  });

  function guardar() {
    setCobros(prev=>[...prev,{...form,id:fid(),pacientes:parseInt(form.pacientes)||0,monto:parseFloat(form.monto)||0}]);
    setShowForm(false);
    setForm({fecha:"",descripcion:"",prof:"ISOLINA",pacientes:0,monto:0,mesImpacto:getMesActual(),notas:""});
  }

  const totalMes = cobros.reduce((s,c)=>s+(c.monto||0),0);
  const totalPacientes = cobros.reduce((s,c)=>s+(c.pacientes||0),0);

  return (
    <div>
      <Card style={{marginBottom:20,background:"#ffffff",borderLeft:"3px solid #059669"}}>
        <div style={{color:"#94a3b8",fontSize:13,lineHeight:1.8}}>
          <strong style={{color:"#059669"}}>Particulares</strong> — pagos directos de pacientes sin obra social. Se registran al momento del cobro.<br/>
          <span style={{color:"#64748b",fontSize:12}}>Incluye pacientes sin cobertura, tratamientos especiales y sesiones fuera de convenio.</span>
        </div>
      </Card>

      <div style={{display:"flex",gap:12,marginBottom:20}}>
        <div style={{background:"#f8faff",border:"1px solid #05966933",borderRadius:12,padding:"14px 18px",flex:1}}>
          <div style={{color:"#64748b",fontSize:10,fontWeight:700,letterSpacing:1,marginBottom:4}}>COBRADO PARTICULAR</div>
          <div style={{color:"#059669",fontSize:22,fontWeight:800,fontFamily:"'DM Mono',monospace"}}>{fp(totalMes)}</div>
        </div>
        <div style={{background:"#f8faff",border:"1px solid #05966933",borderRadius:12,padding:"14px 18px",flex:1}}>
          <div style={{color:"#64748b",fontSize:10,fontWeight:700,letterSpacing:1,marginBottom:4}}>PACIENTES</div>
          <div style={{color:"#1e293b",fontSize:22,fontWeight:800,fontFamily:"'DM Mono',monospace"}}>{totalPacientes}</div>
        </div>
        <div style={{display:"flex",alignItems:"center"}}>
          <button onClick={()=>setShowForm(true)} style={S.btn("#059669")}>＋ Registrar cobro</button>
        </div>
      </div>

      {cobros.length===0&&(
        <Card style={{textAlign:"center",padding:"3rem",color:"#64748b"}}>
          Sin registros de cobros particulares.<br/>
          <button onClick={()=>setShowForm(true)} style={{...S.btn("#059669",12),marginTop:12}}>＋ Registrar primero</button>
        </Card>
      )}

      {cobros.map(c=>(
        <Card key={c.id} style={{marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{color:"#1e293b",fontWeight:700,fontSize:13}}>{c.descripcion||"Cobro particular"}</div>
            <div style={{color:"#64748b",fontSize:12,marginTop:2}}>
              {c.fecha} · {c.prof} · {c.pacientes} paciente{c.pacientes!==1?"s":""}
              {c.mesImpacto&&<span style={{marginLeft:8,color:"#d97706"}}>{MES_LABELS[c.mesImpacto]||c.mesImpacto}</span>}
            </div>
            {c.notas&&<div style={{color:"#64748b",fontSize:11,marginTop:2,fontStyle:"italic"}}>{c.notas}</div>}
          </div>
          <div style={{color:"#059669",fontFamily:"'DM Mono',monospace",fontWeight:800,fontSize:18,textAlign:"right"}}>
            {fp(c.monto)}
          </div>
        </Card>
      ))}

      {showForm&&(
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:20}}>
          <Card style={{width:460,maxWidth:"95vw"}}>
            <div style={{color:"#1e293b",fontWeight:800,fontSize:15,marginBottom:14}}>＋ Registrar cobro particular</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
              <div><label style={S.label}>Fecha</label><input type="date" style={S.input} value={form.fecha} onChange={e=>setForm(f=>({...f,fecha:e.target.value}))}/></div>
              <div><label style={S.label}>Profesional</label>
                <select style={S.input} value={form.prof} onChange={e=>setForm(f=>({...f,prof:e.target.value}))}>
                  {IDS_ACTIVOS.map(p=><option key={p}>{p}</option>)}
                </select>
              </div>
              <div style={{gridColumn:"1/-1"}}><label style={S.label}>Descripción</label><input style={S.input} value={form.descripcion} onChange={e=>setForm(f=>({...f,descripcion:e.target.value}))} placeholder="ej: 3 sesiones RPG — Paciente García"/></div>
              <div><label style={S.label}>Cantidad pacientes</label><input type="number" style={S.input} value={form.pacientes} onChange={e=>setForm(f=>({...f,pacientes:e.target.value}))}/></div>
              <div><label style={S.label}>Monto total $</label><input type="number" style={S.input} value={form.monto} onChange={e=>setForm(f=>({...f,monto:e.target.value}))}/></div>
              <div style={{gridColumn:"1/-1"}}><label style={S.label}>Mes que impacta</label>
                <select style={S.input} value={form.mesImpacto} onChange={e=>setForm(f=>({...f,mesImpacto:e.target.value}))}>
                  {["2026-04","2026-03","2026-02","2026-01","2025-12"].map(m=><option key={m} value={m}>{MES_LABELS[m]||m}</option>)}
                </select>
              </div>
              <div style={{gridColumn:"1/-1"}}><label style={S.label}>Notas</label><input style={S.input} value={form.notas} onChange={e=>setForm(f=>({...f,notas:e.target.value}))}/></div>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={guardar} style={S.btn("#059669")}>Guardar</button>
              <button onClick={()=>setShowForm(false)} style={S.btn("#e2e8f0")}>Cancelar</button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// ─── VISTA: CONTROL DIARIO ADMIN ─────────────────────────────────────────────
function ViewControlDiarioAdmin({registros, setRegistros, onRefresh}) {
  const [profSel, setProfSel] = useState(null);
  const [mes, setMes]         = useState(getMesActual());
  const [showEdit, setShowEdit] = useState(null);
  const [showAdd,  setShowAdd]  = useState(false);
  const [formAdd,  setFormAdd]  = useState({prof:"ISOLINA",prestacion:"FKT",dia:"",osde:0,medife:0,particular:0,notas:""});
  const [guardando, setGuardando] = useState(false);

  // Últimos 6 meses dinámicos
  const mesesDisp = Array.from({length:6}, (_,i) => {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth()-i);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  });

  const nombreMesLocal = (m) => {
    const s = new Date(m+"-15").toLocaleString("es-AR",{month:"long",year:"numeric"});
    return s.charAt(0).toUpperCase()+s.slice(1);
  };

  const regMes = registros.filter(r => r.mes === mes);

  // Stats por profesional (para la tabla resumen)
  // Dedup AUTO+MANUAL: si un día tiene ambos, usar solo AUTO para los totales
  const statsPorProf = [...IDS_TODOS,"CHEQUEAR"].map(prof => {
    const regs = regMes.filter(r => r.prof===prof);
    const diasProf = {};
    regs.forEach(r => {
      const k = r.dia || "sin_dia";
      if (!diasProf[k]) diasProf[k] = { auto: null, manuales: [] };
      if ((r.id||"").startsWith("fichas_auto_")) diasProf[k].auto = r;
      else diasProf[k].manuales.push(r);
    });
    const regsEfectivos = Object.values(diasProf).flatMap(d => d.auto ? [d.auto] : d.manuales);
    const osde       = regsEfectivos.reduce((s,r)=>s+(r.osde||0),0);
    const medife     = regsEfectivos.reduce((s,r)=>s+(r.medife||0),0);
    const particular = regsEfectivos.reduce((s,r)=>s+(r.particular||0),0);
    const regalo     = regs.reduce((s,r)=>s+(r.regalo||0),0);
    const ausentes   = regsEfectivos.reduce((s,r)=>s+(r.ausentes||0),0);
    return {prof, osde, medife, particular, regalo, ausentes, total:osde+medife+particular};
  }).filter(p => p.total>0||p.ausentes>0||p.regalo>0||p.prof==="CHEQUEAR");

  const totales = statsPorProf.reduce((a,p)=>({
    osde:a.osde+p.osde, medife:a.medife+p.medife, particular:a.particular+p.particular,
    regalo:a.regalo+p.regalo, ausentes:a.ausentes+p.ausentes, total:a.total+p.total,
  }), {osde:0,medife:0,particular:0,regalo:0,ausentes:0,total:0});

  // Agrupar por día: una fila por día con todas las prestaciones del día sumadas
  // Dedup AUTO+MANUAL: si hay registro AUTO para el día, usar solo ese para totales
  const diasDetalle = profSel ? (() => {
    const map = {};
    [...regMes].filter(r => r.prof === profSel).forEach(r => {
      const k = r.dia || "sin día";
      if (!map[k]) map[k] = { dia: k, osde: 0, medife: 0, particular: 0, regalo: 0, notas: [], prestaciones: [], records: [] };
      if (r.notas) map[k].notas.push(r.notas);
      if (r.prestacion) map[k].prestaciones.push(r.prestacion);
      map[k].records.push(r);
    });
    Object.values(map).forEach(d => {
      const autoRec = d.records.find(r => (r.id||"").startsWith("fichas_auto_"));
      const efectivos = autoRec ? [autoRec] : d.records;
      d.osde       = efectivos.reduce((s,r)=>s+(r.osde||0),0);
      d.medife     = efectivos.reduce((s,r)=>s+(r.medife||0),0);
      d.particular = efectivos.reduce((s,r)=>s+(r.particular||0),0);
      d.regalo     = d.records.reduce((s,r)=>s+(r.regalo||0),0);
    });
    return Object.values(map).sort((a,b) => a.dia.localeCompare(b.dia));
  })() : [];

  const totDet = diasDetalle.reduce((a,d)=>({
    osde:a.osde+d.osde, medife:a.medife+d.medife, particular:a.particular+d.particular, regalo:a.regalo+d.regalo
  }),{osde:0,medife:0,particular:0,regalo:0});

  const colorSel = COLOR_POR_PROFESIONAL[profSel]||"#4338ca";

  async function eliminar(id) {
    if(!confirm("¿Eliminar este registro?")) return;
    const {error} = await supabase.from("crm_registros").delete().eq("id",id);
    if(!error) setRegistros(prev=>prev.filter(r=>r.id!==id));
    else alert("Error: "+error.message);
  }

  async function guardarEdicion(r) {
    setGuardando(true);
    const {error} = await supabase.from("crm_registros")
      .update({dia:r.dia,osde:r.osde||0,medife:r.medife||0,particular:r.particular||0,notas:r.notas||""})
      .eq("id",r.id);
    if(!error){setRegistros(prev=>prev.map(x=>x.id===r.id?{...x,...r}:x));setShowEdit(null);}
    else alert("Error: "+error.message);
    setGuardando(false);
  }

  async function guardarNuevo() {
    if(!formAdd.dia){alert("Ingresá el día");return;}
    setGuardando(true);
    const nuevo = {
      id:`adm_${Date.now()}`, mes,
      prof:formAdd.prof, prestacion:formAdd.prestacion||"FKT", dia:formAdd.dia,
      osde:parseInt(formAdd.osde)||0, medife:parseInt(formAdd.medife)||0,
      particular:parseInt(formAdd.particular)||0, regalo:0,
      notas:formAdd.notas||"", importado:false,
    };
    const {error} = await supabase.from("crm_registros").insert(nuevo);
    if(!error){
      setRegistros(prev=>[...prev,nuevo]);
      setFormAdd({prof:formAdd.prof,prestacion:"FKT",dia:"",osde:0,medife:0,particular:0,notas:""});
      setShowAdd(false);
    } else alert("Error: "+error.message);
    setGuardando(false);
  }

  const btnMes = (m) => ({
    padding:"6px 18px", borderRadius:20, border:"2px solid",
    borderColor: mes===m?"#0d2347":"#e2e8f0",
    background: mes===m?"#0d2347":"white",
    color: mes===m?"white":"#64748b",
    fontWeight: mes===m?700:400, fontSize:13, cursor:"pointer",
    whiteSpace:"nowrap", fontFamily:"inherit",
  });

  return (
    <div style={{fontFamily:"'DM Sans','Segoe UI',sans-serif"}}>

      {/* ── SELECTOR MES ── */}
      <div style={{background:"white",borderRadius:16,padding:"12px 16px",marginBottom:16,
        border:"1px solid #e2e8f0",display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
        {mesesDisp.map(m=>(
          <button key={m} onClick={()=>setMes(m)} style={btnMes(m)}>
            {nombreMesLocal(m)}
          </button>
        ))}
        <div style={{flex:1}}/>
        <button onClick={onRefresh} style={{background:"#f8fafc",border:"1px solid #dbeafe",color:"#64748b",
          padding:"5px 14px",borderRadius:8,cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>
          🔄 Actualizar
        </button>
      </div>

      {/* ── KPI CARDS ── */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:12,marginBottom:20}}>
        {[
          {label:"OSDE",       valor:totales.osde,       color:"#3b82f6", bg:"#eff6ff"},
          {label:"MEDIFE",     valor:totales.medife,     color:"#8b5cf6", bg:"#f5f3ff"},
          {label:"PARTICULAR", valor:totales.particular, color:"#059669", bg:"#f0fdf4"},
          {label:"🎁 REGALO",  valor:totales.regalo,     color:"#d97706", bg:"#fffbeb"},
          {label:"AUSENTES",   valor:totales.ausentes,   color:"#dc2626", bg:"#fef2f2"},
          {label:"TOTAL",      valor:totales.total,      color:"#0f172a", bg:"#f8fafc",grande:true},
        ].map(k=>(
          <div key={k.label} style={{background:k.bg,borderRadius:16,padding:"16px 18px",
            boxShadow:"0 2px 8px rgba(0,0,0,0.05)",border:k.grande?"2px solid #e2e8f0":"none"}}>
            <div style={{fontSize:10,color:"#94a3b8",fontWeight:700,letterSpacing:"0.06em",marginBottom:4}}>{k.label}</div>
            <div style={{fontSize:k.grande?26:20,fontWeight:800,color:k.color,fontFamily:"'DM Mono',monospace"}}>{k.valor}</div>
          </div>
        ))}
      </div>

      {/* ── TABLA RESUMEN TODOS LOS PROFES ── */}
      <div style={{background:"white",borderRadius:16,boxShadow:"0 2px 12px rgba(0,0,0,0.06)",
        padding:"20px",marginBottom:20,overflowX:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:10}}>
          <div>
            <h3 style={{fontWeight:700,color:"#1e293b",margin:0,fontSize:15}}>👥 Detalle por profesional — {nombreMesLocal(mes)}</h3>
            <p style={{color:"#94a3b8",fontSize:11,margin:"4px 0 0"}}>Clic en un profesional para ver y editar sus registros</p>
          </div>
          <button onClick={()=>{setShowAdd(true);}} style={{...S.btn("#059669",12)}}>＋ Agregar registro</button>
        </div>
        {statsPorProf.length===0 ? (
          <div style={{textAlign:"center",padding:"2rem",color:"#94a3b8"}}>Sin registros para {nombreMesLocal(mes)}</div>
        ) : (
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead>
              <tr style={{borderBottom:"2px solid #f1f5f9"}}>
                {["Profesional","OSDE","MEDIFE","Prepaga","Particular","🎁 Regalo","Ausentes","Total",""].map(h=>(
                  <th key={h} style={{padding:"8px 12px",textAlign:h==="Profesional"?"left":"center",
                    color:"#64748b",fontWeight:700,fontSize:11,letterSpacing:"0.05em",textTransform:"uppercase"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {statsPorProf.map((p,i)=>(
                <tr key={p.prof}
                  onClick={()=>setProfSel(profSel===p.prof?null:p.prof)}
                  style={{borderBottom:"1px solid #f8fafc",cursor:"pointer",
                    background:profSel===p.prof?(COLOR_POR_PROFESIONAL[p.prof]||"#4338ca")+"18":i%2===0?"white":"#fafafa"}}>
                  <td style={{padding:"10px 12px"}}>
                    <span style={{display:"inline-flex",alignItems:"center",gap:8}}>
                      <span style={{width:10,height:10,borderRadius:"50%",background:COLOR_POR_PROFESIONAL[p.prof]||"#94a3b8",display:"inline-block"}}/>
                      <strong style={{color:profSel===p.prof?(COLOR_POR_PROFESIONAL[p.prof]||"#4338ca"):"#1e293b"}}>{p.prof}</strong>
                      <span style={{fontSize:10,color:"#94a3b8"}}>{profSel===p.prof?"▲":"▼"}</span>
                    </span>
                  </td>
                  <td style={{textAlign:"center",color:"#3b82f6",fontWeight:700}}>{p.osde||"—"}</td>
                  <td style={{textAlign:"center",color:"#8b5cf6",fontWeight:700}}>{p.medife||"—"}</td>
                  <td style={{textAlign:"center",color:"#475569",fontWeight:600}}>{p.osde+p.medife||"—"}</td>
                  <td style={{textAlign:"center",color:"#059669",fontWeight:700}}>{p.particular||"—"}</td>
                  <td style={{textAlign:"center",color:"#d97706",fontWeight:700}}>{p.regalo||"—"}</td>
                  <td style={{textAlign:"center",color:"#dc2626",fontWeight:700}}>{p.ausentes||"—"}</td>
                  <td style={{textAlign:"center"}}>
                    <span style={{background:"#f1f5f9",borderRadius:8,padding:"3px 10px",fontWeight:800,color:"#1e293b"}}>{p.total}</span>
                  </td>
                  <td style={{textAlign:"center"}}>
                    <button onClick={e=>{e.stopPropagation();setProfSel(p.prof);setFormAdd(f=>({...f,prof:p.prof}));setShowAdd(true);}}
                      style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:6,padding:"3px 10px",cursor:"pointer",fontSize:11,color:"#16a34a",fontWeight:700}}>＋</button>
                  </td>
                </tr>
              ))}
              <tr style={{borderTop:"2px solid #e2e8f0",background:"#f8fafc"}}>
                <td style={{padding:"10px 12px",fontWeight:800,color:"#1e293b"}}>TOTAL</td>
                <td style={{textAlign:"center",fontWeight:700,color:"#3b82f6"}}>{totales.osde}</td>
                <td style={{textAlign:"center",fontWeight:700,color:"#8b5cf6"}}>{totales.medife}</td>
                <td style={{textAlign:"center",fontWeight:700,color:"#475569"}}>{totales.osde+totales.medife}</td>
                <td style={{textAlign:"center",fontWeight:700,color:"#059669"}}>{totales.particular}</td>
                <td style={{textAlign:"center",fontWeight:700,color:"#d97706"}}>{totales.regalo}</td>
                <td style={{textAlign:"center",fontWeight:700,color:"#dc2626"}}>{totales.ausentes}</td>
                <td style={{textAlign:"center"}}>
                  <span style={{background:"#0f172a",color:"white",borderRadius:8,padding:"4px 10px",fontWeight:800}}>{totales.total}</span>
                </td>
                <td/>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {/* ── DETALLE REGISTROS DEL PROFESIONAL SELECCIONADO ── */}
      {profSel && (
        <div style={{background:"white",borderRadius:16,boxShadow:"0 4px 20px rgba(0,0,0,0.08)",
          padding:"20px",marginBottom:20,borderLeft:`4px solid ${colorSel}`}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:12}}>
            <div style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
              <h3 style={{fontWeight:700,color:"#1e293b",fontSize:15,margin:0}}>
                <span style={{display:"inline-block",width:12,height:12,borderRadius:"50%",background:colorSel,marginRight:8,verticalAlign:"middle"}}/>
                {profSel} — {nombreMesLocal(mes)}
              </h3>
              <div style={{display:"flex",gap:16}}>
                {[
                  {l:"OSDE",   v:totDet.osde,       c:"#3b82f6"},
                  {l:"MEDIFE", v:totDet.medife,      c:"#8b5cf6"},
                  {l:"PART.",  v:totDet.particular,  c:"#059669"},
                  ...(totDet.regalo>0?[{l:"REGALO",v:totDet.regalo,c:"#d97706"}]:[]),
                  {l:"TOTAL",  v:totDet.osde+totDet.medife+totDet.particular+totDet.regalo, c:colorSel},
                ].map(x=>(
                  <div key={x.l} style={{textAlign:"center"}}>
                    <div style={{fontSize:10,color:"#94a3b8",fontWeight:600}}>{x.l}</div>
                    <div style={{fontSize:18,fontWeight:800,color:x.c,fontFamily:"'DM Mono',monospace"}}>{x.v}</div>
                  </div>
                ))}
              </div>
            </div>
            <button onClick={()=>{setFormAdd(f=>({...f,prof:profSel}));setShowAdd(true);}}
              style={{...S.btn("#059669",12)}}>＋ Agregar día</button>
          </div>

          {diasDetalle.length===0 ? (
            <div style={{textAlign:"center",padding:"1.5rem",color:"#94a3b8"}}>Sin registros de {profSel} en {nombreMesLocal(mes)}</div>
          ) : (
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                <thead>
                  <tr style={{borderBottom:"2px solid #f1f5f9"}}>
                    {["Día","OSDE","MEDIFE","Part.","🎁 Regalo","Total","Notas",""].map(h=>(
                      <th key={h} style={{padding:"8px 10px",
                        textAlign:h==="Día"||h==="Notas"?"left":"center",
                        color:"#64748b",fontWeight:700,fontSize:11,letterSpacing:"0.05em",textTransform:"uppercase"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {diasDetalle.map((d,i)=>{
                    const tot=d.osde+d.medife+d.particular+d.regalo;
                    const notasTexto=[...new Set(d.notas)].join(" · ")||"—";
                    const prests=[...new Set(d.prestaciones)].join(", ");
                    return (
                      <tr key={d.dia} style={{borderBottom:"1px solid #f8fafc",background:i%2===0?"white":"#fafafa"}}>
                        <td style={{padding:"8px 10px",fontWeight:700,color:"#1e293b"}}>
                          {d.dia}
                          {prests && <div style={{fontSize:10,color:colorSel,fontWeight:600,marginTop:2}}>{prests}</div>}
                        </td>
                        <td style={{textAlign:"center",color:"#3b82f6",fontWeight:700}}>{d.osde||"—"}</td>
                        <td style={{textAlign:"center",color:"#8b5cf6",fontWeight:700}}>{d.medife||"—"}</td>
                        <td style={{textAlign:"center",color:"#059669",fontWeight:700}}>{d.particular||"—"}</td>
                        <td style={{textAlign:"center"}}>
                          {d.regalo>0
                            ? <span style={{background:"#fffbeb",color:"#d97706",borderRadius:6,padding:"2px 8px",fontWeight:700,fontSize:12}}>{d.regalo}</span>
                            : <span style={{color:"#cbd5e1"}}>—</span>}
                        </td>
                        <td style={{textAlign:"center"}}>
                          <span style={{background:colorSel+"20",color:colorSel,borderRadius:6,padding:"2px 8px",fontWeight:800}}>{tot}</span>
                        </td>
                        <td style={{padding:"8px 10px",color:"#94a3b8",fontSize:11,fontStyle:"italic",maxWidth:180}}>{notasTexto}</td>
                        <td style={{padding:"8px 8px"}}>
                          <div style={{display:"flex",flexDirection:"column",gap:3,alignItems:"flex-end"}}>
                            {d.records.map(r=>(
                              <div key={r.id} style={{display:"flex",gap:4}}>
                                <button onClick={()=>setShowEdit({...r})}
                                  title={r.prestacion}
                                  style={{background:"#eff6ff",border:"1px solid #dbeafe",borderRadius:6,padding:"2px 7px",cursor:"pointer",fontSize:11}}>✏️</button>
                                <button onClick={()=>eliminar(r.id)}
                                  title={r.prestacion}
                                  style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:6,padding:"2px 7px",cursor:"pointer",fontSize:11}}>🗑️</button>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{borderTop:"2px solid #e2e8f0",background:"#f8fafc"}}>
                    <td style={{padding:"10px",fontWeight:800,color:"#1e293b"}}>TOTAL</td>
                    <td style={{textAlign:"center",fontWeight:800,color:"#3b82f6"}}>{totDet.osde}</td>
                    <td style={{textAlign:"center",fontWeight:800,color:"#8b5cf6"}}>{totDet.medife}</td>
                    <td style={{textAlign:"center",fontWeight:800,color:"#059669"}}>{totDet.particular}</td>
                    <td style={{textAlign:"center",fontWeight:800,color:"#d97706"}}>{totDet.regalo||"—"}</td>
                    <td style={{textAlign:"center"}}>
                      <span style={{background:colorSel,color:"white",borderRadius:6,padding:"3px 10px",fontWeight:800}}>
                        {totDet.osde+totDet.medife+totDet.particular+totDet.regalo}
                      </span>
                    </td>
                    <td colSpan={2}/>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── MODAL EDITAR ── */}
      {showEdit && (
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999}}>
          <div style={{background:"white",borderRadius:16,padding:24,width:420,maxWidth:"95vw",boxShadow:"0 25px 50px rgba(0,0,0,0.25)"}}>
            <div style={{fontWeight:800,fontSize:15,color:"#1e293b",marginBottom:16}}>✏️ Editar — {showEdit.dia} · {showEdit.prof}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
              <div><label style={S.label}>Día (ej: 08/04)</label>
                <input style={S.input} value={showEdit.dia} onChange={e=>setShowEdit(s=>({...s,dia:e.target.value}))}/></div>
              <div><label style={S.label}>OSDE</label>
                <input type="number" style={S.input} value={showEdit.osde||0} onChange={e=>setShowEdit(s=>({...s,osde:parseInt(e.target.value)||0}))}/></div>
              <div><label style={S.label}>MEDIFE</label>
                <input type="number" style={S.input} value={showEdit.medife||0} onChange={e=>setShowEdit(s=>({...s,medife:parseInt(e.target.value)||0}))}/></div>
              <div><label style={S.label}>PARTICULAR</label>
                <input type="number" style={S.input} value={showEdit.particular||0} onChange={e=>setShowEdit(s=>({...s,particular:parseInt(e.target.value)||0}))}/></div>
              <div style={{gridColumn:"1/-1"}}><label style={S.label}>Notas</label>
                <input style={S.input} value={showEdit.notas||""} onChange={e=>setShowEdit(s=>({...s,notas:e.target.value}))}/></div>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>guardarEdicion(showEdit)} disabled={guardando}
                style={S.btn(guardando?"#64748b":"#4338ca")}>{guardando?"Guardando...":"Guardar cambios"}</button>
              <button onClick={()=>setShowEdit(null)} style={S.btn("#e2e8f0")}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL AGREGAR ── */}
      {showAdd && (
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999}}>
          <div style={{background:"white",borderRadius:16,padding:24,width:440,maxWidth:"95vw",boxShadow:"0 25px 50px rgba(0,0,0,0.25)"}}>
            <div style={{fontWeight:800,fontSize:15,color:"#1e293b",marginBottom:16}}>➕ Agregar registro — {nombreMesLocal(mes)}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
              <div><label style={S.label}>Profesional</label>
                <select style={S.input} value={formAdd.prof} onChange={e=>setFormAdd(f=>({...f,prof:e.target.value}))}>
                  {IDS_ACTIVOS.map(p=><option key={p}>{p}</option>)}
                </select>
              </div>
              <div><label style={S.label}>Prestación</label>
                <select style={S.input} value={formAdd.prestacion} onChange={e=>setFormAdd(f=>({...f,prestacion:e.target.value}))}>
                  {PRESTACIONES.map(p=><option key={p}>{p}</option>)}
                </select>
              </div>
              <div><label style={S.label}>Día (ej: 08/04)</label>
                <input style={S.input} value={formAdd.dia} onChange={e=>setFormAdd(f=>({...f,dia:e.target.value}))} placeholder="08/04"/></div>
              <div><label style={S.label}>OSDE</label>
                <input type="number" style={S.input} value={formAdd.osde} onChange={e=>setFormAdd(f=>({...f,osde:e.target.value}))}/></div>
              <div><label style={S.label}>MEDIFE</label>
                <input type="number" style={S.input} value={formAdd.medife} onChange={e=>setFormAdd(f=>({...f,medife:e.target.value}))}/></div>
              <div><label style={S.label}>PARTICULAR</label>
                <input type="number" style={S.input} value={formAdd.particular} onChange={e=>setFormAdd(f=>({...f,particular:e.target.value}))}/></div>
              <div style={{gridColumn:"1/-1"}}><label style={S.label}>Notas</label>
                <input style={S.input} value={formAdd.notas} onChange={e=>setFormAdd(f=>({...f,notas:e.target.value}))}/></div>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={guardarNuevo} disabled={guardando}
                style={S.btn(guardando?"#64748b":"#059669")}>{guardando?"Guardando...":"Guardar"}</button>
              <button onClick={()=>setShowAdd(false)} style={S.btn("#e2e8f0")}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



// ─── APP ──────────────────────────────────────────────────────────────────────
const VIEWS=[
  {id:"dashboard",      label:"Dashboard",       icon:"📊"},
  {id:"liquidacion",    label:"Liquidación",     icon:"💰"},
  {id:"ingresos",       label:"Ingresos",        icon:"📈"},
  {id:"cobros",         label:"Cobros",          icon:"🏦"},
  {id:"controldiario",  label:"Control Diario",  icon:"📋"},
  {id:"conciliacion",   label:"Conciliación",    icon:"🔍"},
  {id:"precios",        label:"Lista de Precios",icon:"🏷️"},
  {id:"rentabilidad",   label:"Rentabilidad",    icon:"💹"},
];

export default function RavaCRM({ user, onLogout }) {
  const [view,setView]=useState("dashboard");
  const [registros,setRegistros]=useState(REGISTROS_INIT);
  const [cargando,setCargando]=useState(true);
  const [precios,setPrecios]=useState(null);
  const [periodos,setPeriodos]=useState([]);
  const [obrasSociales,setObrasSociales]=useState([]);
  const [pagosProfesionales,setPagosProfesionales]=useState([]);
  const [fichaProf,setFichaProf]=useState(null);

  const cargarPrecios = useCallback(async () => {
    const mesActual = getMesActual();
    const { data } = await supabase.from("crm_precios").select("*").eq("mes", mesActual);
    if (data && data.length > 0) {
      const map = {};
      data.forEach(r => { map[r.clave] = Number(r.valor); });
      setPrecios(map);
    }
  }, []);

  useEffect(() => { cargarPrecios(); }, [cargarPrecios]);

  const cargarCobros = useCallback(async () => {
    const [{ data: p }, { data: os }, { data: pagos }] = await Promise.all([
      supabase.from("crm_periodos_estado").select("*"),
      supabase.from("crm_obras_sociales").select("*"),
      supabase.from("crm_pagos_profesionales").select("*"),
    ]);
    if (p) setPeriodos(p);
    if (os) setObrasSociales(os);
    if (pagos) setPagosProfesionales(pagos);
  }, []);

  useEffect(() => { cargarCobros(); }, [cargarCobros]);

  const cargarDesdeSupabase = useCallback(async () => {
    setCargando(true);
    const { data, error } = await supabase
      .from("crm_registros")
      .select("*")
      .order("mes", { ascending: false });
    if (!error && data && data.length > 0) {
      // Combinar: datos de Supabase + datos hardcodeados de febrero (que no están en Supabase)
      const idsSupabase = new Set(data.map(r=>r.id));
      const initFiltrados = REGISTROS_INIT.filter(r=>!idsSupabase.has(r.id));
      setRegistros([...data, ...initFiltrados]);
    }
    setCargando(false);
  }, []);

  useEffect(() => { cargarDesdeSupabase(); }, [cargarDesdeSupabase]);

  const mesActual = getMesActual();
  const registrosMesActual = registros.filter(r=>r.mes===mesActual);

  return (
    <div style={{minHeight:"100vh",background:"#eef2f7",fontFamily:"'DM Sans','Segoe UI',sans-serif",color:"#94a3b8"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;800&family=DM+Mono:wght@400;500;700&display=swap');
        *{box-sizing:border-box} input,select{color:#1e293b!important}
        ::-webkit-scrollbar{width:5px;height:5px} ::-webkit-scrollbar-track{background:#f0f4ff} ::-webkit-scrollbar-thumb{background:#c7d2fe;border-radius:3px}
        button:hover{opacity:.82;transition:opacity .12s}
      `}</style>

      <div style={{background:"linear-gradient(135deg,#0d2347,#1e3a6e)",borderBottom:"1px solid #dbeafe",padding:"0 24px",display:"flex",alignItems:"center",gap:16,height:54}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:32,height:32,borderRadius:8,background:"linear-gradient(135deg,#4338ca,#7c3aed)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17}}>🏥</div>
          <div>
            <div style={{color:"#f1f5f9",fontWeight:800,fontSize:14,lineHeight:1.1}}>Kinesiología Rava</div>
            <div style={{color:"#cbd5e1",fontSize:9,letterSpacing:1.5}}>CRM · GESTIÓN INTERNA</div>
          </div>
        </div>
        <div style={{flex:1}}/>
        {user && <div style={{color:"#64748b",fontSize:11,fontFamily:"'DM Mono',monospace"}}>👤 {user.nombre}</div>}
        {onLogout && <button onClick={onLogout} style={{background:"#f8fafc",border:"1px solid #dbeafe",color:"#64748b",padding:"4px 10px",borderRadius:6,cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>Salir</button>}
      </div>

      <div style={{display:"flex",height:"calc(100vh - 54px)"}}>
        <div style={{width:188,background:"#ffffff",borderRight:"1px solid #c7d2fe",padding:"16px 8px",display:"flex",flexDirection:"column",gap:2}}>
          {VIEWS.map(v=>(
            <button key={v.id} onClick={()=>setView(v.id)}
              style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderRadius:8,border:"none",cursor:"pointer",textAlign:"left",
                background:view===v.id?"#dbeafe":"transparent",color:view===v.id?"#4338ca":"#64748b",fontWeight:view===v.id?700:400,fontSize:13,fontFamily:"inherit"}}>
              <span>{v.icon}</span>{v.label}
            </button>
          ))}
          <div style={{flex:1}}/>
          <div style={{background:"#ffffff",borderRadius:10,padding:"12px 14px",border:"1px solid #dbeafe"}}>
            <div style={{color:"#cbd5e1",fontSize:9,letterSpacing:1,marginBottom:5}}>REGISTROS {(MES_LABELS[mesActual]||mesActual).split(" ")[0].toUpperCase()}</div>
            <div style={{color:"#4338ca",fontFamily:"'DM Mono',monospace",fontWeight:800,fontSize:22}}>
              {cargando ? "..." : registrosMesActual.length}
            </div>
            <button onClick={cargarDesdeSupabase} title="Actualizar desde Supabase"
              style={{marginTop:8,width:"100%",background:"#f8fafc",border:"1px solid #dbeafe",color:"#64748b",padding:"4px",borderRadius:6,cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>
              🔄 Actualizar
            </button>
          </div>
        </div>

        <div style={{flex:1,overflow:"auto",padding:24}}>
          {cargando && (
            <div style={{background:"#f8fafc",border:"1px solid #1a284055",borderRadius:10,padding:"10px 16px",marginBottom:16,color:"#64748b",fontSize:12,display:"flex",alignItems:"center",gap:8}}>
              <span style={{animation:"spin 1s linear infinite",display:"inline-block"}}>⟳</span> Cargando datos desde Supabase...
            </div>
          )}
          {fichaProf ? (
            <ViewFichaProfesional prof={fichaProf} registros={registros} precios={precios}
              pagosProfesionales={pagosProfesionales} onVolver={()=>setFichaProf(null)}/>
          ) : (
          <>
          <div style={{marginBottom:20}}>
            <h1 style={{color:"#1e293b",fontSize:19,fontWeight:800,margin:0}}>
              {VIEWS.find(v=>v.id===view)?.icon} {VIEWS.find(v=>v.id===view)?.label}
            </h1>
          </div>
          {view==="dashboard"    && <ViewDashboard registros={registros} precios={precios} periodos={periodos} obrasSociales={obrasSociales} onVerFicha={setFichaProf}/>}
          {view==="liquidacion"  && <ViewLiquidacion registros={registros} setRegistros={setRegistros} onRefresh={cargarDesdeSupabase} precios={precios}/>}
          {view==="ingresos"     && <ViewIngresos registros={registros}/>}
          {view==="cobros"       && <ViewCobros registros={registros}/>}
          {view==="controldiario"&& <ViewControlDiarioAdmin registros={registros} setRegistros={setRegistros} onRefresh={cargarDesdeSupabase}/>}
          {view==="conciliacion" && <ViewConciliacion registros={registros}/>}
          {view==="precios"       && <ViewPrecios onPreciosUpdate={cargarPrecios}/>}
          {view==="rentabilidad" && <ViewRentabilidad registros={registros} precios={precios}/>}
          </>
          )}
        </div>
      </div>
    </div>
  );
}
