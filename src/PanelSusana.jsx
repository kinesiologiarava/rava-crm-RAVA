import { useState, useEffect, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, PieChart, Pie, Cell
} from "recharts";
import { IDS_ACTIVOS, IDS_TODOS, COLOR_POR_PROFESIONAL } from "./lib/profesionales.js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// Cliente separado para Fichas Pacientes (lee sesiones con detalle)
const FICHAS_URL = "https://svwifjhdxuytjenkqulz.supabase.co";
const FICHAS_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2d2lmamhkeHV5dGplbmtxdWx6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjkwOTI0NCwiZXhwIjoyMDg4NDg1MjQ0fQ.fTzeTBdSFolVFnKKqiG2mGoEHnxElZqneAl77-LsApQ";
const fichasSupa = createClient(FICHAS_URL, FICHAS_KEY);

// Antes esta lista y sus colores estaban duplicados acá (y desincronizados
// de RavaCRM.jsx — David tenía un color distinto en cada panel). Ahora
// viven en un solo lugar: src/lib/profesionales.js
const PROFESIONALES = [...IDS_TODOS, "CHEQUEAR"];
const COLORES = { ...COLOR_POR_PROFESIONAL, CHEQUEAR: "#94a3b8" };
const PIE_COLORS = ["#6366f1","#0ea5e9","#10b981","#ec4899","#f59e0b","#8b5cf6"];

function mesActual() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}`;
}

function nombreMes(m) {
  const s = new Date(m+"-15").toLocaleString("es-AR",{month:"long",year:"numeric"});
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function ultimos12Meses() {
  const meses = [];
  const hoy = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    meses.push(key);
  }
  return meses;
}

export default function PanelSusana({ user, onLogout }) {
  const [mes, setMes] = useState(mesActual());
  const [registros, setRegistros] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [ultimaAct, setUltimaAct] = useState(null);
  const [profDetalle, setProfDetalle] = useState(null);
  const [showRegalo, setShowRegalo] = useState(false);
  const [showEditDia, setShowEditDia] = useState(null);
  const [guardandoEdit, setGuardandoEdit] = useState(false);
  const [fichasDetalle, setFichasDetalle] = useState({}); // {prof_dia: [{nombre, hora, cobertura}]}
  const [loadingFichas, setLoadingFichas] = useState({});
  const [expandedDia, setExpandedDia] = useState(null); // "PROF_DD/MM"
  const [expandKey, setExpandKey] = useState(null); // para detalle manual "man_ID"

  // Carga el detalle de pacientes desde Fichas para un profesional+dia
  async function cargarDetalleFichas(prof, dia, mesStr) {
    if (!fichasSupa || prof === "CHEQUEAR") return;
    const key = `${prof}_${dia}`;
    if (fichasDetalle[key]) { setExpandedDia(expandedDia === key ? null : key); return; }
    setLoadingFichas(prev => ({...prev, [key]: true}));
    // Convertir dia "DD/MM" a fecha "YYYY-MM-DD"
    const [d, m] = dia.split("/");
    const y = mesStr.split("-")[0];
    const fecha = `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
    // Mapeo de nombre CRM → username en Fichas (exactamente como está en la tabla sesiones)
    // Mapeo CRM → campo profesional en tabla sesiones de Fichas
    const profMap = {
      "ISOLINA":"ISOLINA","JUAN CRUZ":"JUANCRUZ","FRANCISCO":"FRANCISCO",
      "PAULA":"PAULA","DANIELA":"DANIELA","MILAGROS":"MILAGROS","DAVID":"DAVID"
    };
    const profFichas = profMap[prof];
    if (!profFichas) { setLoadingFichas(prev => ({...prev, [key]: false})); return; }
    try {
      // Buscar sesiones del día — sin columna hora (no existe en Fichas)
      const { data: sesiones, error: sesErr } = await fichasSupa
        .from("sesiones")
        .select("id, estado, paciente_id, autorizacion_id, profesional")
        .eq("profesional", profFichas)
        .eq("fecha", fecha);
      console.log(`[Fichas] ${prof} → ${profFichas} ${fecha}: ${sesiones?.length ?? 0} sesiones`, sesErr);
      
      if (!sesiones || sesiones.length === 0) {
        setFichasDetalle(prev => ({...prev, [key]: []}));
        setExpandedDia(key);
        setLoadingFichas(prev => ({...prev, [key]: false}));
        return;
      }
      // Traer nombres de pacientes
      const pacIds = [...new Set(sesiones.map(s => s.paciente_id).filter(Boolean))];
      const { data: pacientes } = await fichasSupa
        .from("pacientes")
        .select("id, nombre, apellido")
        .in("id", pacIds);
      const pacMap = {};
      (pacientes||[]).forEach(p => { pacMap[p.id] = `${p.apellido}, ${p.nombre}`; });
      
      // Traer cobertura de autorizaciones
      const authIds = [...new Set(sesiones.map(s => s.autorizacion_id).filter(Boolean))];
      let authMap = {};
      if (authIds.length) {
        const { data: auths } = await fichasSupa
          .from("autorizaciones")
          .select("id, cobertura")
          .in("id", authIds);
        (auths||[]).forEach(a => { authMap[a.id] = a.cobertura || "PARTICULAR"; });
      }
      
      const detalle = sesiones
        .filter(s => s.estado && s.estado !== "")
        .map(s => ({
          nombre: pacMap[s.paciente_id] || "Sin nombre",
          cobertura: (authMap[s.autorizacion_id] || "PARTICULAR").toUpperCase(),
          estado: s.estado,
        })).sort((a,b) => a.nombre.localeCompare(b.nombre));
      
      setFichasDetalle(prev => ({...prev, [key]: detalle}));
      setExpandedDia(key);
    } catch(e) {
      console.warn("Error cargando Fichas:", e);
    }
    setLoadingFichas(prev => ({...prev, [key]: false}));
  }
  const [formRegalo, setFormRegalo] = useState({prof:"ISOLINA", dia:"", cantidad:1, notas:""});
  const [guardandoRegalo, setGuardandoRegalo] = useState(false);
  const [tab, setTab] = useState("resumen"); // "resumen" | "conciliacion"
  const [osdeData, setOsdeData] = useState(null);
  const [nombreArchivo, setNombreArchivo] = useState("");
  const [procesandoOsde, setProcesandoOsde] = useState(false);
  const mesesDisponibles = ultimos12Meses();

  const cargar = useCallback(async () => {
    setCargando(true);
    const { data, error } = await supabase
      .from("crm_registros")
      .select("*")
      .eq("mes", mes)
      .order("dia", { ascending: true });
    if (!error) {
      // Normalizar prof a mayúsculas para consistencia
      const normalized = (data || []).map(r => ({...r, prof: (r.prof||"").toUpperCase()}));
      setRegistros(normalized);
      setUltimaAct(new Date());
    }
    setCargando(false);
  }, [mes]);

  useEffect(() => { cargar(); setProfDetalle(null); }, [cargar]);

  useEffect(() => {
    const interval = setInterval(cargar, 120000);
    return () => clearInterval(interval);
  }, [cargar]);

  const statsPorProf = PROFESIONALES.map(prof => {
    const regs = registros.filter(r => r.prof === prof);
    // Para evitar duplicados AUTO+MANUAL: si un día tiene ambos, usar solo AUTO.
    // Agrupamos por día y priorizamos el registro AUTO.
    const diasProf = {};
    regs.forEach(r => {
      const k = r.dia || "sin_dia";
      if (!diasProf[k]) diasProf[k] = { auto: null, manuales: [] };
      if ((r.id||"").startsWith("fichas_auto_")) diasProf[k].auto = r;
      else diasProf[k].manuales.push(r);
    });
    // Para cada día: si hay AUTO usarlo; si solo hay manual(es), sumarlos
    const regsEfectivos = Object.values(diasProf).flatMap(d => d.auto ? [d.auto] : d.manuales);
    const osde       = regsEfectivos.reduce((s,r) => s+(r.osde||0), 0);
    const regalo     = regs.reduce((s,r) => s+(r.regalo||0), 0); // regalo siempre suma todo
    const medife     = regsEfectivos.reduce((s,r) => s+(r.medife||0), 0);
    const particular = regsEfectivos.reduce((s,r) => s+(r.particular||0), 0);
    const ausentes   = regsEfectivos.reduce((s,r) => s+(r.ausentes||0), 0);
    const total      = osde + medife + particular;
    return { prof, osde, medife, particular, ausentes, regalo, total };
  }).filter(p => p.total > 0 || p.ausentes > 0 || p.prof === "CHEQUEAR");

  const totales = statsPorProf.reduce((a,p) => ({
    osde:      a.osde      + p.osde,
    medife:    a.medife    + p.medife,
    particular:a.particular+ p.particular,
    ausentes:  a.ausentes  + p.ausentes,
    regalo:    a.regalo    + p.regalo,
    total:     a.total     + p.total,
  }), { osde:0, medife:0, particular:0, ausentes:0, regalo:0, total:0 });

  const pieData = statsPorProf.filter(p => p.total > 0).map(p => ({ name: p.prof, value: p.total }));

  const diasMap = {};
  registros.forEach(r => {
    if (!r.dia) return;
    if (!diasMap[r.dia]) diasMap[r.dia] = { dia: r.dia, total: 0, osde: 0, medife: 0, particular: 0 };
    diasMap[r.dia].osde       += r.osde||0;
    diasMap[r.dia].medife     += r.medife||0;
    diasMap[r.dia].particular += r.particular||0;
    diasMap[r.dia].total      += (r.osde||0)+(r.medife||0)+(r.particular||0);
  });
  const evolucion = Object.values(diasMap).sort((a,b) => a.dia.localeCompare(b.dia));

  // Agrupado por día para la TABLA — una sola fila por fecha, con regalo incluido
  const diasDetalle = profDetalle ? (() => {
    const map = {};
    registros.filter(r => r.prof === profDetalle).forEach(r => {
      const k = r.dia || "sin día";
      if (!map[k]) map[k] = { dia: k, osde: 0, medife: 0, particular: 0, regalo: 0, notas: [], records: [] };
      if (r.notas) map[k].notas.push(r.notas);
      map[k].records.push(r);
    });
    // Para cada día: si hay AUTO, usar solo ese para los totales; si no, sumar manuales
    Object.values(map).forEach(d => {
      const autoRec = d.records.find(r => (r.id||"").startsWith("fichas_auto_"));
      const efectivos = autoRec ? [autoRec] : d.records;
      d.osde       = efectivos.reduce((s,r) => s+(r.osde||0), 0);
      d.medife     = efectivos.reduce((s,r) => s+(r.medife||0), 0);
      d.particular = efectivos.reduce((s,r) => s+(r.particular||0), 0);
      d.regalo     = d.records.reduce((s,r) => s+(r.regalo||0), 0); // regalo siempre
    });
    return Object.values(map).sort((a,b) => a.dia.localeCompare(b.dia));
  })() : [];

  // Agrupado por día solo para el gráfico de barras
  const diasProfChart = diasDetalle.map(d => ({
    dia: d.dia, osde: d.osde, medife: d.medife, particular: d.particular, regalo: d.regalo,
    total: d.osde + d.medife + d.particular,
  }));

  const colorProf = profDetalle ? (COLORES[profDetalle] || "#6366f1") : "#6366f1";
  const statsProf = profDetalle ? statsPorProf.find(p => p.prof === profDetalle) : null;

  async function eliminarDia(id) {
    if (!confirm("¿Eliminar este registro?")) return;
    const { error } = await supabase.from("crm_registros").delete().eq("id", id);
    if (!error) {
      setRegistros(prev => prev.filter(r => r.id !== id));
    } else {
      alert("Error al eliminar: " + error.message);
    }
  }

  async function guardarEditDia() {
    if (!showEditDia) return;
    setGuardandoEdit(true);
    const { error } = await supabase.from("crm_registros")
      .update({
        dia: showEditDia.dia,
        osde: showEditDia.osde||0,
        medife: showEditDia.medife||0,
        particular: showEditDia.particular||0,
        notas: showEditDia.notas||""
      })
      .eq("id", showEditDia.id);
    if (!error) {
      setRegistros(prev => prev.map(r => r.id===showEditDia.id ? {...r,...showEditDia} : r));
      setShowEditDia(null);
    } else {
      alert("Error al guardar: " + error.message);
    }
    setGuardandoEdit(false);
  }

  async function guardarRegalo() {
    if (!formRegalo.dia) { alert("Ingresá el día"); return; }
    setGuardandoRegalo(true);
    const nuevo = {
      id: `reg_${Date.now()}`,
      mes,
      prof: formRegalo.prof,
      dia: formRegalo.dia,
      prestacion: "FKT",
      osde: 0,
      medife: 0,
      particular: 0,
      regalo: parseInt(formRegalo.cantidad) || 1,
      notas: formRegalo.notas || "Regalo cargado por Susana",
      importado: false,
    };
    const { error } = await supabase.from("crm_registros").insert(nuevo);
    if (!error) {
      setShowRegalo(false);
      setFormRegalo({prof:"ISOLINA", dia:"", cantidad:1, notas:""});
      await cargar();
    } else {
      alert("Error al guardar: " + error.message);
    }
    setGuardandoRegalo(false);
  }

  async function procesarArchivoOsde(e) {
    const file = e.target.files[0];
    if (!file) return;
    setProcesandoOsde(true);
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
      const estado = String(row["Estado	"] || row["Estado"] || "").trim().toUpperCase();
      const esOk   = estado === "OK";
      if (!porDia[dia]) porDia[dia] = {consumo:0, diferida:0, autorizacion:0};
      if (tipo === "REGISTRACION DE CONSUMO" && esOk) {
        porDia[dia].consumo++;
      } else if (tipo === "REGISTRACION DE CONSUMO DIFERIDA" && esOk) {
        porDia[dia].diferida++;
      } else if (tipo === "SOLICITUD DE AUTORIZACION") {
        porDia[dia].autorizacion++;
      }
    });
    // PISA el mes — no acumula
    const dias = Object.keys(porDia).sort();
    const mesDatos = dias.length > 0 ? dias[0].slice(0,7) : mes;
    setOsdeData(prev => {
      const nuevo = {...prev};
      Object.keys(nuevo).forEach(k => { if (k.startsWith(mesDatos)) delete nuevo[k]; });
      Object.assign(nuevo, porDia);
      return nuevo;
    });
    setMes(mesDatos);
    setProcesandoOsde(false);
  }

  // CRM por día para conciliación — solo registros automáticos de fichas (no manuales ni regalos)
  const crmPorDia = {};
  registros.filter(r => r.mes === mes && (r.id||"").startsWith("fichas_auto_")).forEach(r => {
    const dia = r.dia || "";
    if (!dia) return;
    const partes = dia.split("/");
    if (partes.length !== 2) return;
    const [d, m2] = partes;
    const anio = mes.slice(0,4);
    const key = `${anio}-${m2.padStart(2,"0")}-${d.padStart(2,"0")}`;
    if (!crmPorDia[key]) crmPorDia[key] = 0;
    crmPorDia[key] += r.osde||0;
  });

  const todasFechas = new Set([
    ...Object.keys(crmPorDia),
    ...(osdeData ? Object.keys(osdeData).filter(d => d.startsWith(mes)) : [])
  ]);
  const filasConcil = [...todasFechas].sort().map(fecha => {
    const crmOsde = crmPorDia[fecha] || 0;
    const od = osdeData ? (osdeData[fecha] || null) : null;
    const osdeTotal = od ? (od.consumo + od.diferida) : null;
    const diff = osdeTotal !== null ? (osdeTotal - crmOsde) : null;
    let estado = "sin_osde";
    if (diff !== null) {
      if (diff >= 0) estado = "ok";
      else estado = "crm_mayor";
    }
    return { fecha, crmOsde, osdeTotal, diff, estado, detalle: od };
  });

  return (
    <div style={{ minHeight:"100vh", background:"#f1f5f9", fontFamily:"'Segoe UI',system-ui,sans-serif" }}>

      {/* HEADER */}
      <div style={{ background:"linear-gradient(135deg,#0a1628,#0d2347)", color:"white", padding:"1rem 1.5rem", boxShadow:"0 4px 20px rgba(0,0,0,0.3)" }}>
        <div style={{ maxWidth:"1100px", margin:"0 auto" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:"0.75rem" }}>
            <div style={{ display:"flex", alignItems:"center", gap:"0.75rem" }}>
              <span style={{ fontSize:"1.75rem" }}>📊</span>
              <div>
                <div style={{ fontWeight:700, fontSize:"1.15rem" }}>Panel de Atenciones</div>
                <div style={{ fontSize:"0.8rem", color:"rgba(127,255,0,0.8)" }}>Kinesiología Rava · {user.nombre}</div>
              </div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:"0.75rem" }}>
              <button onClick={()=>setShowRegalo(true)} style={{ background:"rgba(245,158,11,0.2)", border:"1px solid rgba(245,158,11,0.4)", color:"#fbbf24", padding:"0.4rem 0.75rem", borderRadius:"8px", cursor:"pointer", fontSize:"0.85rem", fontWeight:600 }}>
                🎁 Registrar Regalo
              </button>
              <button onClick={cargar} style={{ background:"rgba(127,255,0,0.15)", border:"1px solid rgba(127,255,0,0.3)", color:"#7fff00", padding:"0.4rem 0.75rem", borderRadius:"8px", cursor:"pointer", fontSize:"0.85rem", fontWeight:600 }}>
                🔄 Actualizar
              </button>
              <button onClick={onLogout} style={{ background:"rgba(255,255,255,0.1)", border:"1px solid rgba(255,255,255,0.2)", color:"white", padding:"0.4rem 0.9rem", borderRadius:"8px", cursor:"pointer", fontSize:"0.85rem", fontWeight:600 }}>
                Salir
              </button>
            </div>
          </div>
          {ultimaAct && (
            <div style={{ fontSize:"0.72rem", color:"rgba(255,255,255,0.3)", marginTop:"0.5rem", textAlign:"right" }}>
              Última actualización: {ultimaAct.toLocaleTimeString("es-AR")}
            </div>
          )}
        </div>
      </div>

      {/* SELECTOR DE MESES - HISTORIAL 12 MESES */}
      <div style={{ background:"white", borderBottom:"1px solid #e2e8f0", padding:"0.75rem 1.5rem", overflowX:"auto" }}>
        <div style={{ maxWidth:"1100px", margin:"0 auto", display:"flex", gap:"0.5rem", flexWrap:"nowrap", minWidth:"max-content" }}>
          {mesesDisponibles.map(m => (
            <button key={m} onClick={() => setMes(m)}
              style={{
                padding:"0.4rem 1rem", borderRadius:"20px", border:"2px solid",
                borderColor: mes===m ? "#0d2347" : "#e2e8f0",
                background: mes===m ? "#0d2347" : "white",
                color: mes===m ? "white" : "#64748b",
                fontWeight: mes===m ? 700 : 400,
                fontSize:"0.82rem", cursor:"pointer", whiteSpace:"nowrap",
              }}>
              {nombreMes(m)}
            </button>
          ))}
        </div>
      </div>

      {/* TABS RESUMEN / CONCILIACIÓN */}
      <div style={{ background:"white", borderBottom:"1px solid #e2e8f0", padding:"0 1.5rem" }}>
        <div style={{ maxWidth:"1100px", margin:"0 auto", display:"flex", gap:0 }}>
          {[["resumen","📊 Resumen"],["conciliacion","🔍 Conciliación OSDE"]].map(([id,lbl])=>(
            <button key={id} onClick={()=>setTab(id)}
              style={{ padding:"0.75rem 1.25rem", border:"none", background:"transparent", cursor:"pointer",
                fontWeight: tab===id?700:400, fontSize:"0.9rem",
                color: tab===id?"#0d2347":"#64748b",
                borderBottom: tab===id?"3px solid #0d2347":"3px solid transparent" }}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth:"1100px", margin:"0 auto", padding:"1.5rem 1rem" }}>
        {tab === "resumen" && (cargando ? (
          <div style={{ textAlign:"center", padding:"4rem", color:"#94a3b8", fontSize:"1.1rem" }}>Cargando datos...</div>
        ) : (
          <>
            <h2 style={{ fontSize:"1.4rem", fontWeight:700, color:"#1e293b", marginBottom:"1.5rem" }}>
              📅 {nombreMes(mes)}
            </h2>

            {/* KPIs */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:"1rem", marginBottom:"1.5rem" }}>
              {[
                { label:"OSDE",            valor:totales.osde,       color:"#3b82f6", bg:"#eff6ff" },
                { label:"MEDIFE",          valor:totales.medife,     color:"#8b5cf6", bg:"#f5f3ff" },
                { label:"PARTICULAR",      valor:totales.particular, color:"#10b981", bg:"#f0fdf4" },
                { label:"🎁 REGALOS",      valor:totales.regalo||0,  color:"#f59e0b", bg:"#fffbeb" },
                { label:"AUSENTES",        valor:totales.ausentes,   color:"#ef4444", bg:"#fef2f2" },
                { label:"TOTAL ATENDIDOS", valor:totales.total,      color:"#0f172a", bg:"#f8fafc", grande:true },
              ].map(k => (
                <div key={k.label} style={{ background:k.bg, borderRadius:"16px", padding:"1.25rem", boxShadow:"0 2px 8px rgba(0,0,0,0.06)", border:k.grande?"2px solid #e2e8f0":"1px solid transparent" }}>
                  <div style={{ fontSize:"0.72rem", color:"#94a3b8", fontWeight:600, letterSpacing:"0.05em" }}>{k.label}</div>
                  <div style={{ fontSize:k.grande?"2.5rem":"2rem", fontWeight:800, color:k.color, lineHeight:1.1, marginTop:"0.25rem" }}>{k.valor}</div>
                </div>
              ))}
            </div>

            {/* TABLA POR PROFESIONAL */}
            <div style={{ background:"white", borderRadius:"16px", boxShadow:"0 2px 12px rgba(0,0,0,0.06)", padding:"1.5rem", marginBottom:"1.5rem", overflowX:"auto" }}>
              <h3 style={{ fontWeight:700, color:"#1e293b", marginBottom:"0.5rem", fontSize:"1.05rem" }}>👥 Detalle por profesional</h3>
              <p style={{ color:"#94a3b8", fontSize:"0.8rem", marginBottom:"1rem", marginTop:0 }}>Clic en un profesional para ver el detalle por día</p>
              {statsPorProf.length === 0 ? (
                <p style={{ textAlign:"center", color:"#94a3b8", padding:"2rem" }}>No hay registros este mes</p>
              ) : (
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"0.9rem" }}>
                  <thead>
                    <tr style={{ borderBottom:"2px solid #f1f5f9" }}>
                      {["Profesional","OSDE","MEDIFE","Prepaga","Particular","🎁 Regalo","Ausentes","Total"].map(h => (
                        <th key={h} style={{ padding:"0.6rem 1rem", textAlign:h==="Profesional"?"left":"center", color:"#64748b", fontWeight:600, fontSize:"0.8rem", letterSpacing:"0.04em", textTransform:"uppercase" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {statsPorProf.map((p,i) => (
                      <tr key={p.prof}
                        onClick={() => setProfDetalle(profDetalle===p.prof ? null : p.prof)}
                        style={{
                          borderBottom:"1px solid #f8fafc",
                          background: profDetalle===p.prof ? "#eff6ff" : i%2===0?"white":"#fafafa",
                          cursor:"pointer",
                        }}>
                        <td style={{ padding:"0.75rem 1rem" }}>
                          <span style={{ display:"inline-flex", alignItems:"center", gap:"0.5rem" }}>
                            <span style={{ width:10, height:10, borderRadius:"50%", background:COLORES[p.prof]||"#94a3b8", display:"inline-block" }}/>
                            <strong style={{ color: profDetalle===p.prof ? "#1d4ed8" : "#1e293b" }}>{p.prof}</strong>
                            <span style={{ fontSize:"0.7rem", color:"#94a3b8" }}>{profDetalle===p.prof ? "▲" : "▼"}</span>
                          </span>
                        </td>
                        <td style={{ textAlign:"center", color:"#3b82f6", fontWeight:700 }}>{p.osde}</td>
                        <td style={{ textAlign:"center", color:"#8b5cf6", fontWeight:700 }}>{p.medife}</td>
                        <td style={{ textAlign:"center", color:"#475569", fontWeight:600 }}>{p.osde+p.medife}</td>
                        <td style={{ textAlign:"center", color:"#10b981", fontWeight:700 }}>{p.particular}</td>
                        <td style={{ textAlign:"center", color:"#f59e0b", fontWeight:700 }}>{p.regalo||0}</td>
                        <td style={{ textAlign:"center", color:"#ef4444", fontWeight:700 }}>{p.ausentes}</td>
                        <td style={{ textAlign:"center" }}>
                          <span style={{ background:"#f1f5f9", borderRadius:"8px", padding:"0.25rem 0.75rem", fontWeight:800, color:"#1e293b" }}>{p.total}</span>
                        </td>
                      </tr>
                    ))}
                    <tr style={{ borderTop:"2px solid #e2e8f0", background:"#f8fafc" }}>
                      <td style={{ padding:"0.75rem 1rem", fontWeight:700, color:"#1e293b" }}>TOTAL</td>
                      <td style={{ textAlign:"center", fontWeight:700, color:"#3b82f6" }}>{totales.osde}</td>
                      <td style={{ textAlign:"center", fontWeight:700, color:"#8b5cf6" }}>{totales.medife}</td>
                      <td style={{ textAlign:"center", fontWeight:700 }}>{totales.osde+totales.medife}</td>
                      <td style={{ textAlign:"center", fontWeight:700, color:"#10b981" }}>{totales.particular}</td>
                      <td style={{ textAlign:"center", fontWeight:700, color:"#f59e0b" }}>{totales.regalo||0}</td>
                      <td style={{ textAlign:"center", fontWeight:700, color:"#ef4444" }}>{totales.ausentes}</td>
                      <td style={{ textAlign:"center" }}>
                        <span style={{ background:"#0f172a", color:"white", borderRadius:"8px", padding:"0.3rem 0.75rem", fontWeight:800 }}>{totales.total}</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>

            {/* DETALLE DÍAS PROFESIONAL */}
            {profDetalle && diasDetalle.length > 0 && (
              <div style={{ background:"white", borderRadius:"16px", boxShadow:"0 4px 20px rgba(0,0,0,0.08)", padding:"1.5rem", marginBottom:"1.5rem", borderLeft:`4px solid ${colorProf}` }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"1rem", flexWrap:"wrap", gap:"0.75rem" }}>
                  <h3 style={{ fontWeight:700, color:"#1e293b", fontSize:"1.05rem", margin:0 }}>
                    <span style={{ display:"inline-block", width:12, height:12, borderRadius:"50%", background:colorProf, marginRight:8, verticalAlign:"middle" }}/>
                    {profDetalle} — detalle diario · {nombreMes(mes)}
                  </h3>
                  <div style={{ display:"flex", gap:"1.25rem" }}>
                    {[
                      { l:"OSDE",   v:statsProf?.osde,       c:"#3b82f6" },
                      { l:"MEDIFE", v:statsProf?.medife,     c:"#8b5cf6" },
                      { l:"PART.",  v:statsProf?.particular, c:"#10b981" },
                      ...(statsProf?.regalo>0 ? [{ l:"🎁 REG.", v:statsProf.regalo, c:"#f59e0b" }] : []),
                      { l:"TOTAL",  v:statsProf?.total,      c:colorProf },
                    ].map(x => (
                      <div key={x.l} style={{ textAlign:"center" }}>
                        <div style={{ fontSize:"0.65rem", color:"#94a3b8", fontWeight:600 }}>{x.l}</div>
                        <div style={{ fontSize:"1.3rem", fontWeight:800, color:x.c }}>{x.v}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"0.88rem" }}>
                  <thead>
                    <tr style={{ borderBottom:"2px solid #f1f5f9" }}>
                      {["Día","OSDE","MEDIFE","Particular","🎁 Regalo","Total","Notas",""].map(h => (
                        <th key={h} style={{ padding:"0.5rem 0.75rem", textAlign:h==="Día"||h==="Notas"?"left":"center", color:h==="🎁 Regalo"?"#f59e0b":"#64748b", fontWeight:600, fontSize:"0.75rem", letterSpacing:"0.04em", textTransform:"uppercase" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {diasDetalle.map((d,i) => {
                      const tot = d.osde + d.medife + d.particular;
                      const notasUnicas = [...new Set(d.notas)].join(" · ");
                      const expandKeyDia = `${profDetalle}_${d.dia}`;
                      const isExpanded = expandedDia === expandKeyDia;
                      const detPacientes = fichasDetalle[expandKeyDia];
                      const isLoading = loadingFichas[expandKeyDia];
                      // Detectar si hay registros auto (fichas_auto_) y/o manuales por ID
                      const tieneAuto = d.records.some(r => (r.id||"").startsWith("fichas_auto_"));
                      const tieneManual = d.records.some(r => !(r.id||"").startsWith("fichas_auto_"));
                      return (
                      <>
                      <tr key={d.dia} style={{ borderBottom: isExpanded?"none":"1px solid #f8fafc", background:i%2===0?"white":"#fafafa" }}>
                        <td style={{ padding:"0.6rem 0.75rem", fontWeight:700, color:"#1e293b" }}>
                          <div style={{display:"flex",alignItems:"center",gap:6}}>
                            {d.dia}
                            {tieneAuto && <span style={{background:"#dbeafe",color:"#1d4ed8",fontSize:10,fontWeight:700,padding:"1px 5px",borderRadius:4}} title="Sincronizado automáticamente desde Fichas">🔄 AUTO</span>}
                            {tieneManual && <span style={{background:"#dcfce7",color:"#15803d",fontSize:10,fontWeight:700,padding:"1px 5px",borderRadius:4}} title="Cargado manualmente en el CRM">✏️ MANUAL</span>}
                            {tieneAuto && tieneManual && <span style={{background:"#fef3c7",color:"#92400e",fontSize:10,fontWeight:700,padding:"1px 5px",borderRadius:4}} title="Hay registros duplicados para este día">⚠️ DUPLICADO</span>}
                          </div>
                        </td>
                        <td style={{ textAlign:"center", color:"#3b82f6", fontWeight:600 }}>{d.osde || "—"}</td>
                        <td style={{ textAlign:"center", color:"#8b5cf6", fontWeight:600 }}>{d.medife || "—"}</td>
                        <td style={{ textAlign:"center", color:"#10b981", fontWeight:600 }}>{d.particular || "—"}</td>
                        <td style={{ textAlign:"center", color:"#f59e0b", fontWeight:700 }}>
                          {d.regalo > 0
                            ? <span style={{ background:"#fef3c7", borderRadius:6, padding:"0.15rem 0.5rem" }}>{d.regalo}</span>
                            : "—"}
                        </td>
                        <td style={{ textAlign:"center" }}>
                          <span style={{ background:colorProf+"22", color:colorProf, borderRadius:"6px", padding:"0.2rem 0.6rem", fontWeight:800 }}>{tot}</span>
                        </td>
                        <td style={{ color:"#94a3b8", fontSize:"0.8rem", maxWidth:200 }}>{notasUnicas || "—"}</td>
                        <td style={{ padding:"0.6rem 0.5rem" }}>
                          <div style={{ display:"flex", gap:3, justifyContent:"flex-end", flexWrap:"wrap", alignItems:"center" }}>
                            <button onClick={()=>cargarDetalleFichas(profDetalle, d.dia, mes)}
                              title="Ver pacientes del día desde Fichas"
                              style={{ background:isExpanded?"#dbeafe":"#f1f5f9", border:"1px solid "+(isExpanded?"#93c5fd":"#e2e8f0"), borderRadius:6, padding:"3px 8px", cursor:"pointer", fontSize:11, fontWeight:700, color:isExpanded?"#1d4ed8":"#64748b" }}>
                              {isLoading ? "⏳" : isExpanded ? "▲" : "👁️"}
                            </button>
                            {d.records.map(r => {
                              const esAuto = (r.id||"").startsWith("fichas_auto_");
                              const manKey = "man_"+r.id;
                              const manExpanded = expandKey === manKey;
                              return (
                              <span key={r.id} style={{ display:"flex", flexDirection:"column", gap:2 }}>
                                <span style={{ display:"flex", gap:3, alignItems:"center" }}>
                                  <span style={{
                                    fontSize:9, fontWeight:700, padding:"1px 4px", borderRadius:3,
                                    background: esAuto ? "#dbeafe" : "#fff7ed",
                                    color: esAuto ? "#1d4ed8" : "#f97316"
                                  }}>{esAuto ? "AUTO" : "MAN"}</span>
                                  {!esAuto && (
                                    <button
                                      onClick={()=>setExpandKey(manExpanded ? null : manKey)}
                                      title="Ver detalle del registro manual"
                                      style={{ background: manExpanded?"#fff7ed":"#f1f5f9", border:"1px solid "+(manExpanded?"#fed7aa":"#e2e8f0"), borderRadius:6, padding:"3px 8px", cursor:"pointer", fontSize:11, fontWeight:700, color: manExpanded?"#f97316":"#64748b" }}>
                                      {manExpanded ? "▲" : "📋"}
                                    </button>
                                  )}
                                  <button onClick={()=>setShowEditDia({...r})}
                                    style={{ background:"#eff6ff", border:"1px solid #dbeafe", borderRadius:6, padding:"3px 7px", cursor:"pointer", fontSize:11 }}>✏️</button>
                                  <button onClick={()=>eliminarDia(r.id)}
                                    style={{ background:"#fef2f2", border:"1px solid #fecaca", borderRadius:6, padding:"3px 7px", cursor:"pointer", fontSize:11 }}>🗑️</button>
                                </span>
                                {!esAuto && manExpanded && (
                                  <div style={{ background:"#fff7ed", border:"1px solid #fed7aa", borderRadius:8, padding:"0.5rem 0.75rem", marginTop:2, fontSize:"0.8rem", minWidth:180 }}>
                                    <div style={{ fontWeight:700, color:"#f97316", marginBottom:4, fontSize:10 }}>✏️ CARGA MANUAL</div>
                                    <div style={{ display:"flex", flexWrap:"wrap", gap:"0.4rem" }}>
                                      {(r.osde||0)>0 && <span style={{background:"#eff6ff",color:"#1d4ed8",padding:"2px 6px",borderRadius:4,fontWeight:700,fontSize:11}}>OSDE: {r.osde}</span>}
                                      {(r.medife||0)>0 && <span style={{background:"#f5f3ff",color:"#7c3aed",padding:"2px 6px",borderRadius:4,fontWeight:700,fontSize:11}}>MEDIFE: {r.medife}</span>}
                                      {(r.particular||0)>0 && <span style={{background:"#f0fdf4",color:"#15803d",padding:"2px 6px",borderRadius:4,fontWeight:700,fontSize:11}}>PART: {r.particular}</span>}
                                      {(r.regalo||0)>0 && <span style={{background:"#fef3c7",color:"#92400e",padding:"2px 6px",borderRadius:4,fontWeight:700,fontSize:11}}>🎁 {r.regalo}</span>}
                                      {(r.osde||0)+(r.medife||0)+(r.particular||0) === 0 && <span style={{color:"#94a3b8",fontSize:11}}>Sin pacientes cargados</span>}
                                    </div>
                                    {r.notas && <div style={{ marginTop:4, color:"#92400e", fontSize:10, fontStyle:"italic" }}>📝 {r.notas}</div>}
                                  </div>
                                )}
                              </span>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={expandKeyDia+"_detail"} style={{ background:"#f8fafc" }}>
                          <td colSpan={8} style={{ padding:"0.5rem 1rem 1rem 2rem" }}>
                            {isLoading ? (
                              <div style={{color:"#94a3b8",fontSize:"0.85rem"}}>Cargando pacientes...</div>
                            ) : !detPacientes || detPacientes.length === 0 ? (
                              <div style={{color:"#94a3b8",fontSize:"0.85rem",fontStyle:"italic"}}>Sin registros en Fichas para este día.</div>
                            ) : (
                              <table style={{width:"100%",borderCollapse:"collapse",fontSize:"0.8rem"}}>
                                <thead>
                                  <tr>
                                    {["#","Paciente","Cobertura","Estado"].map(h=>(
                                      <th key={h} style={{textAlign:"left",padding:"0.3rem 0.75rem",color:"#94a3b8",fontWeight:600,fontSize:"0.7rem",textTransform:"uppercase",borderBottom:"1px solid #e2e8f0"}}>{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {detPacientes.map((p,pi)=>{
                                    const estadoColor = p.estado==="presente"||p.estado==="presente_perdonada" ? "#15803d"
                                      : p.estado==="ausente" ? "#dc2626"
                                      : p.estado==="chequear" ? "#d97706" : "#64748b";
                                    const estadoBg = p.estado==="presente"||p.estado==="presente_perdonada" ? "#f0fdf4"
                                      : p.estado==="ausente" ? "#fef2f2"
                                      : p.estado==="chequear" ? "#fef3c7" : "#f8fafc";
                                    return (
                                      <tr key={pi} style={{borderBottom:"1px solid #f1f5f9"}}>
                                        <td style={{padding:"0.3rem 0.75rem",color:"#94a3b8",fontWeight:700,fontSize:"0.75rem"}}>{pi+1}</td>
                                        <td style={{padding:"0.3rem 0.75rem",color:"#1e293b",fontWeight:600}}>{p.nombre}</td>
                                        <td style={{padding:"0.3rem 0.75rem"}}>
                                          <span style={{background:p.cobertura==="OSDE"?"#dbeafe":p.cobertura==="MEDIFE"?"#f3e8ff":"#f0fdf4",color:p.cobertura==="OSDE"?"#1d4ed8":p.cobertura==="MEDIFE"?"#7c3aed":"#15803d",padding:"1px 6px",borderRadius:4,fontSize:"0.7rem",fontWeight:700}}>{p.cobertura}</span>
                                        </td>
                                        <td style={{padding:"0.3rem 0.75rem"}}>
                                          <span style={{background:estadoBg,color:estadoColor,padding:"1px 6px",borderRadius:4,fontSize:"0.7rem",fontWeight:700,textTransform:"capitalize"}}>{p.estado}</span>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                      </>
                      );
                    })}
                  </tbody>
                </table>

                {diasProfChart.length > 1 && (
                  <div style={{ marginTop:"1.25rem" }}>
                    <ResponsiveContainer width="100%" height={150}>
                      <BarChart data={diasProfChart} margin={{ top:5, right:10, left:-15, bottom:5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                        <XAxis dataKey="dia" tick={{ fontSize:10 }}/>
                        <YAxis tick={{ fontSize:10 }}/>
                        <Tooltip/>
                        <Bar dataKey="osde"       name="OSDE"       fill="#3b82f6" stackId="a" radius={[0,0,0,0]}/>
                        <Bar dataKey="medife"     name="MEDIFE"     fill="#8b5cf6" stackId="a" radius={[0,0,0,0]}/>
                        <Bar dataKey="particular" name="Particular" fill="#10b981" stackId="a" radius={[3,3,0,0]}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            )}

            {/* GRÁFICOS GENERALES */}
            {statsPorProf.length > 0 && (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))", gap:"1.5rem", marginBottom:"1.5rem" }}>
                <div style={{ background:"white", borderRadius:"16px", boxShadow:"0 2px 12px rgba(0,0,0,0.06)", padding:"1.5rem" }}>
                  <h3 style={{ fontWeight:700, color:"#1e293b", marginBottom:"1.25rem", fontSize:"1rem" }}>📊 Atenciones por profesional</h3>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={statsPorProf} margin={{ top:5, right:10, left:-10, bottom:5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                      <XAxis dataKey="prof" tick={{ fontSize:11 }} tickFormatter={v=>v.split(" ")[0]}/>
                      <YAxis tick={{ fontSize:11 }}/>
                      <Tooltip/>
                      <Legend iconSize={10} wrapperStyle={{ fontSize:"0.8rem" }}/>
                      <Bar dataKey="osde"       name="OSDE"       fill="#3b82f6" radius={[4,4,0,0]}/>
                      <Bar dataKey="medife"     name="MEDIFE"     fill="#8b5cf6" radius={[4,4,0,0]}/>
                      <Bar dataKey="particular" name="Particular" fill="#10b981" radius={[4,4,0,0]}/>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ background:"white", borderRadius:"16px", boxShadow:"0 2px 12px rgba(0,0,0,0.06)", padding:"1.5rem" }}>
                  <h3 style={{ fontWeight:700, color:"#1e293b", marginBottom:"1.25rem", fontSize:"1rem" }}>🥧 Distribución del mes</h3>
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" outerRadius={85} dataKey="value"
                        label={({name,percent})=>`${name.split(" ")[0]} ${(percent*100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                        {pieData.map((_,i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]}/>)}
                      </Pie>
                      <Tooltip formatter={(v,n)=>[v+" atenciones",n]}/>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {evolucion.length > 0 && (
              <div style={{ background:"white", borderRadius:"16px", boxShadow:"0 2px 12px rgba(0,0,0,0.06)", padding:"1.5rem" }}>
                <h3 style={{ fontWeight:700, color:"#1e293b", marginBottom:"1.25rem", fontSize:"1rem" }}>📈 Evolución diaria del mes</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={evolucion} margin={{ top:5, right:10, left:-10, bottom:5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                    <XAxis dataKey="dia" tick={{ fontSize:10 }}/>
                    <YAxis tick={{ fontSize:11 }}/>
                    <Tooltip/>
                    <Bar dataKey="total" name="Total atendidos" fill="#0f172a" radius={[4,4,0,0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        ))}

          {/* ── TAB CONCILIACIÓN ── */}
          {tab === "conciliacion" && (
            <div>
              <h2 style={{ fontSize:"1.4rem", fontWeight:700, color:"#1e293b", marginBottom:"1.5rem" }}>
                🔍 Conciliación OSDE — {nombreMes(mes)}
              </h2>

              {/* Upload */}
              <div style={{ background:"white", borderRadius:"16px", boxShadow:"0 2px 12px rgba(0,0,0,0.06)", padding:"1.5rem", marginBottom:"1.5rem" }}>
                <h3 style={{ fontWeight:700, color:"#1e293b", marginBottom:"1rem", fontSize:"1.05rem" }}>📁 Importar Excel de OSDE</h3>
                <label style={{ display:"flex", alignItems:"center", gap:"1rem", cursor:"pointer",
                  background:"#f8fafc", border:"2px dashed #e2e8f0", borderRadius:"12px", padding:"1.25rem 1.5rem" }}>
                  <span style={{ fontSize:"2rem" }}>📥</span>
                  <div>
                    <div style={{ fontWeight:700, color:"#1e293b", fontSize:"0.95rem" }}>
                      {nombreArchivo || "Seleccionar archivo .xlsx exportado de OSDE"}
                    </div>
                    <div style={{ color:"#94a3b8", fontSize:"0.8rem", marginTop:"0.2rem" }}>
                      El mes se detecta automáticamente del archivo
                    </div>
                  </div>
                  <input type="file" accept=".xlsx,.xls" onChange={procesarArchivoOsde} style={{ display:"none" }}/>
                </label>
                {procesandoOsde && <div style={{ color:"#f59e0b", marginTop:"0.75rem", fontSize:"0.85rem" }}>⏳ Procesando archivo...</div>}
              </div>

              {/* KPIs conciliación */}
              {filasConcil.length > 0 && (() => {
                const totalC  = filasConcil.reduce((s,f)=>s+f.crmOsde,0);
                const totalO  = filasConcil.reduce((s,f)=>s+(f.osdeTotal||0),0);
                const diasOk  = filasConcil.filter(f=>f.estado==="ok").length;
                const diasProb= filasConcil.filter(f=>f.estado==="crm_mayor").length;
                return (
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:"1rem", marginBottom:"1.5rem" }}>
                    {[
                      {l:"DÍAS ANALIZADOS", v:filasConcil.length, c:"#475569", bg:"#f8fafc"},
                      {l:"TOTAL CRM",       v:totalC,              c:"#6366f1", bg:"#eff6ff"},
                      {l:"TOTAL OSDE",      v:osdeData?totalO:"—", c:"#0ea5e9", bg:"#f0f9ff"},
                      {l:"DÍAS OK",         v:diasOk,              c:"#16a34a", bg:"#f0fdf4"},
                      {l:"DÍAS PROBLEMA",   v:diasProb,            c:diasProb>0?"#dc2626":"#16a34a", bg:diasProb>0?"#fef2f2":"#f0fdf4"},
                    ].map(k=>(
                      <div key={k.l} style={{ background:k.bg, borderRadius:"16px", padding:"1.25rem", boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
                        <div style={{ fontSize:"0.7rem", color:"#94a3b8", fontWeight:600, letterSpacing:"0.05em" }}>{k.l}</div>
                        <div style={{ fontSize:"1.8rem", fontWeight:800, color:k.c, lineHeight:1.1, marginTop:"0.25rem" }}>{k.v}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Tabla */}
              {filasConcil.length > 0 && (
                <div style={{ background:"white", borderRadius:"16px", boxShadow:"0 2px 12px rgba(0,0,0,0.06)", padding:"1.5rem", overflowX:"auto" }}>
                  <h3 style={{ fontWeight:700, color:"#1e293b", marginBottom:"1rem", fontSize:"1.05rem" }}>
                    📊 Comparación día a día
                    {!osdeData && <span style={{ color:"#f59e0b", fontSize:"0.8rem", fontWeight:400, marginLeft:"0.5rem" }}>— Importá el Excel para ver la comparación</span>}
                  </h3>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"0.88rem" }}>
                    <thead>
                      <tr style={{ borderBottom:"2px solid #f1f5f9" }}>
                        {["Fecha","CRM (OSDE)","OSDE — OK","Diferencia","Autorizaciones","Estado"].map(h=>(
                          <th key={h} style={{ padding:"0.6rem 0.75rem", textAlign:h==="Fecha"||h==="Estado"?"left":"center",
                            color:"#64748b", fontWeight:600, fontSize:"0.75rem", letterSpacing:"0.04em", textTransform:"uppercase" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filasConcil.map((f,i) => {
                        const colores = {
                          ok:        {bg:"#f0fdf4", c:"#16a34a", txt:"✅ OK"},
                          osde_mayor:{bg:"#fffbeb", c:"#d97706", txt:"⚠️ OSDE mayor"},
                          crm_mayor: {bg:"#fef2f2", c:"#dc2626", txt:"🚨 PROBLEMA"},
                          sin_osde:  {bg:"#f8fafc", c:"#94a3b8", txt:"— Sin dato OSDE"},
                        };
                        const b = colores[f.estado];
                        return (
                          <tr key={f.fecha} style={{ borderBottom:"1px solid #f8fafc", background:i%2===0?"white":"#fafafa" }}>
                            <td style={{ padding:"0.65rem 0.75rem", fontWeight:700, color:"#1e293b", fontFamily:"monospace" }}>{f.fecha}</td>
                            <td style={{ textAlign:"center", color:"#6366f1", fontWeight:800, fontSize:"1.05rem" }}>{f.crmOsde}</td>
                            <td style={{ textAlign:"center", color:"#0ea5e9", fontWeight:800, fontSize:"1.05rem" }}>
                              {f.osdeTotal !== null ? f.osdeTotal : <span style={{color:"#cbd5e1"}}>—</span>}

                            </td>
                            <td style={{ textAlign:"center", fontWeight:800, fontSize:"1.05rem",
                              color: f.diff===null?"#cbd5e1":f.diff>=0?"#16a34a":"#dc2626" }}>
                              {f.diff===null?"—":f.diff>=0?(f.diff===0?"=":"+"+f.diff):f.diff}
                            </td>
                            <td style={{ textAlign:"center", color:"#64748b" }}>{f.detalle?f.detalle.autorizacion:"—"}</td>
                            <td style={{ padding:"0.65rem 0.75rem" }}>
                              <span style={{ background:b.bg, color:b.c, padding:"3px 10px", borderRadius:"6px", fontSize:"0.75rem", fontWeight:700 }}>{b.txt}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div style={{ marginTop:"1rem", display:"flex", gap:"1rem", flexWrap:"wrap", borderTop:"1px solid #f1f5f9", paddingTop:"0.75rem" }}>
                    {[
                      {c:"#16a34a", t:"✅ OK — CRM y OSDE coinciden"},
                      {c:"#d97706", t:"⚠️ OSDE mayor — Puede haber diferidas, no es problema"},
                      {c:"#dc2626", t:"🚨 Problema — Hay prestaciones NO registradas en OSDE"},
                    ].map(l=><div key={l.t} style={{fontSize:"0.75rem",color:l.c,fontWeight:500}}>{l.t}</div>)}
                  </div>
                </div>
              )}

              {filasConcil.length === 0 && !osdeData && (
                <div style={{ background:"white", borderRadius:"16px", padding:"3rem", textAlign:"center", boxShadow:"0 2px 12px rgba(0,0,0,0.06)" }}>
                  <div style={{ fontSize:"3rem", marginBottom:"1rem" }}>🔍</div>
                  <div style={{ fontWeight:700, color:"#1e293b", marginBottom:"0.5rem" }}>Importá el Excel de OSDE para comenzar</div>
                  <div style={{ color:"#94a3b8", fontSize:"0.85rem" }}>Se compararán automáticamente las registraciones de OSDE con el Control Diario del CRM</div>
                </div>
              )}
            </div>
          )}

      </div>
      {/* MODAL EDITAR DÍA */}
      {showEditDia && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:999 }}>
          <div style={{ background:"white", borderRadius:"20px", padding:"2rem", width:380, maxWidth:"95vw", boxShadow:"0 20px 60px rgba(0,0,0,0.3)" }}>
            <h3 style={{ margin:"0 0 1.5rem", color:"#1e293b", fontWeight:800, fontSize:"1.1rem" }}>✏️ Editar — {showEditDia.dia} · {showEditDia.prof}</h3>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"1rem", marginBottom:"1.5rem" }}>
              <div>
                <label style={{ display:"block", fontSize:"0.75rem", fontWeight:700, color:"#64748b", marginBottom:"0.4rem", textTransform:"uppercase" }}>Día</label>
                <input value={showEditDia.dia||""} onChange={e=>setShowEditDia(s=>({...s,dia:e.target.value}))}
                  style={{ width:"100%", padding:"0.6rem", borderRadius:"8px", border:"1px solid #e2e8f0", fontSize:"0.9rem", boxSizing:"border-box" }}/>
              </div>
              <div>
                <label style={{ display:"block", fontSize:"0.75rem", fontWeight:700, color:"#64748b", marginBottom:"0.4rem", textTransform:"uppercase" }}>OSDE</label>
                <input type="number" value={showEditDia.osde||0} onChange={e=>setShowEditDia(s=>({...s,osde:parseInt(e.target.value)||0}))}
                  style={{ width:"100%", padding:"0.6rem", borderRadius:"8px", border:"1px solid #e2e8f0", fontSize:"0.9rem", boxSizing:"border-box" }}/>
              </div>
              <div>
                <label style={{ display:"block", fontSize:"0.75rem", fontWeight:700, color:"#64748b", marginBottom:"0.4rem", textTransform:"uppercase" }}>MEDIFE</label>
                <input type="number" value={showEditDia.medife||0} onChange={e=>setShowEditDia(s=>({...s,medife:parseInt(e.target.value)||0}))}
                  style={{ width:"100%", padding:"0.6rem", borderRadius:"8px", border:"1px solid #e2e8f0", fontSize:"0.9rem", boxSizing:"border-box" }}/>
              </div>
              <div>
                <label style={{ display:"block", fontSize:"0.75rem", fontWeight:700, color:"#64748b", marginBottom:"0.4rem", textTransform:"uppercase" }}>Particular</label>
                <input type="number" value={showEditDia.particular||0} onChange={e=>setShowEditDia(s=>({...s,particular:parseInt(e.target.value)||0}))}
                  style={{ width:"100%", padding:"0.6rem", borderRadius:"8px", border:"1px solid #e2e8f0", fontSize:"0.9rem", boxSizing:"border-box" }}/>
              </div>
              <div style={{ gridColumn:"1/-1" }}>
                <label style={{ display:"block", fontSize:"0.75rem", fontWeight:700, color:"#64748b", marginBottom:"0.4rem", textTransform:"uppercase" }}>Notas</label>
                <input value={showEditDia.notas||""} onChange={e=>setShowEditDia(s=>({...s,notas:e.target.value}))}
                  style={{ width:"100%", padding:"0.6rem", borderRadius:"8px", border:"1px solid #e2e8f0", fontSize:"0.9rem", boxSizing:"border-box" }}/>
              </div>
            </div>
            <div style={{ display:"flex", gap:"0.75rem" }}>
              <button onClick={guardarEditDia} disabled={guardandoEdit}
                style={{ flex:1, padding:"0.75rem", background:"#6366f1", color:"white", border:"none", borderRadius:"10px", fontWeight:700, cursor:"pointer", fontSize:"0.9rem" }}>
                {guardandoEdit ? "Guardando..." : "💾 Guardar"}
              </button>
              <button onClick={()=>setShowEditDia(null)}
                style={{ padding:"0.75rem 1.25rem", background:"#f1f5f9", color:"#64748b", border:"none", borderRadius:"10px", fontWeight:600, cursor:"pointer" }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL REGALO */}
      {showRegalo && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:999 }}>
          <div style={{ background:"white", borderRadius:"20px", padding:"2rem", width:380, maxWidth:"95vw", boxShadow:"0 20px 60px rgba(0,0,0,0.3)" }}>
            <h3 style={{ margin:"0 0 1.5rem", color:"#1e293b", fontWeight:800, fontSize:"1.1rem" }}>🎁 Registrar Regalo</h3>
            <div style={{ display:"flex", flexDirection:"column", gap:"1rem", marginBottom:"1.5rem" }}>
              <div>
                <label style={{ display:"block", fontSize:"0.75rem", fontWeight:700, color:"#64748b", marginBottom:"0.4rem", textTransform:"uppercase", letterSpacing:"0.05em" }}>Profesional</label>
                <select value={formRegalo.prof} onChange={e=>setFormRegalo(f=>({...f,prof:e.target.value}))}
                  style={{ width:"100%", padding:"0.6rem 0.75rem", borderRadius:"8px", border:"1px solid #e2e8f0", fontSize:"0.9rem", background:"#f8fafc" }}>
                  {IDS_ACTIVOS.map(p=>(
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display:"block", fontSize:"0.75rem", fontWeight:700, color:"#64748b", marginBottom:"0.4rem", textTransform:"uppercase", letterSpacing:"0.05em" }}>Día (ej: 20/03)</label>
                <input value={formRegalo.dia} onChange={e=>setFormRegalo(f=>({...f,dia:e.target.value}))}
                  placeholder="20/03"
                  style={{ width:"100%", padding:"0.6rem 0.75rem", borderRadius:"8px", border:"1px solid #e2e8f0", fontSize:"0.9rem", background:"#f8fafc", boxSizing:"border-box" }}/>
              </div>
              <div>
                <label style={{ display:"block", fontSize:"0.75rem", fontWeight:700, color:"#64748b", marginBottom:"0.4rem", textTransform:"uppercase", letterSpacing:"0.05em" }}>Cantidad de regalos</label>
                <input type="number" min="1" value={formRegalo.cantidad} onChange={e=>setFormRegalo(f=>({...f,cantidad:e.target.value}))}
                  style={{ width:"100%", padding:"0.6rem 0.75rem", borderRadius:"8px", border:"1px solid #e2e8f0", fontSize:"0.9rem", background:"#f8fafc", boxSizing:"border-box" }}/>
              </div>
              <div>
                <label style={{ display:"block", fontSize:"0.75rem", fontWeight:700, color:"#64748b", marginBottom:"0.4rem", textTransform:"uppercase", letterSpacing:"0.05em" }}>Notas (opcional)</label>
                <input value={formRegalo.notas} onChange={e=>setFormRegalo(f=>({...f,notas:e.target.value}))}
                  placeholder="Ej: Paciente OSDE sin cargo"
                  style={{ width:"100%", padding:"0.6rem 0.75rem", borderRadius:"8px", border:"1px solid #e2e8f0", fontSize:"0.9rem", background:"#f8fafc", boxSizing:"border-box" }}/>
              </div>

            </div>
            <div style={{ display:"flex", gap:"0.75rem" }}>
              <button onClick={guardarRegalo} disabled={guardandoRegalo}
                style={{ flex:1, padding:"0.75rem", background:"#f59e0b", color:"white", border:"none", borderRadius:"10px", fontWeight:700, cursor:"pointer", fontSize:"0.9rem" }}>
                {guardandoRegalo ? "Guardando..." : "✅ Guardar Regalo"}
              </button>
              <button onClick={()=>setShowRegalo(false)}
                style={{ padding:"0.75rem 1.25rem", background:"#f1f5f9", color:"#64748b", border:"none", borderRadius:"10px", fontWeight:600, cursor:"pointer" }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
