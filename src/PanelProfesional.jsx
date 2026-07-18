import { useState, useEffect, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const CONFIG = {
  ISOLINA:    { color: "#6366f1", emoji: "🏋️" },
  DAVID:      { color: "#0ea5e9", emoji: "💪" },
  "JUAN CRUZ":{ color: "#10b981", emoji: "🤸" },
  FRANCISCO:  { color: "#f59e0b", emoji: "⚡" },
  PAULA:      { color: "#ec4899", emoji: "🧘" },
  DANIELA:    { color: "#8b5cf6", emoji: "👩‍⚕️" },
  MILAGROS:   { color: "#8b5cf6", emoji: "🌟" },
  BELEN:      { color: "#14b8a6", emoji: "🌊" },
};

function mesActual() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}`;
}

export default function PanelProfesional({ user, onLogout }) {
  const [vista, setVista] = useState("resumen");
  const [mes, setMes] = useState(mesActual());
  const [registros, setRegistros] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [msgExito, setMsgExito] = useState("");

  const prof  = user.profesional;
  const cfg   = CONFIG[prof] || { color: "#6366f1", emoji: "👤" };
  const color = cfg.color;

  const [form, setForm] = useState({
    fecha: new Date().toISOString().split("T")[0],
    osde: "", medife: "", particular: "", ausentes: "", notas: "",
  });

  const cargar = useCallback(async () => {
    setCargando(true);
    const { data, error } = await supabase
      .from("crm_registros")
      .select("*")
      .eq("prof", prof)
      .eq("mes", mes)
      .order("dia", { ascending: false });
    if (!error) setRegistros(data || []);
    setCargando(false);
  }, [prof, mes]);

  useEffect(() => { cargar(); }, [cargar]);

  const guardar = async () => {
    const osde       = parseInt(form.osde)       || 0;
    const medife     = parseInt(form.medife)     || 0;
    const particular = parseInt(form.particular) || 0;
    const ausentes   = parseInt(form.ausentes)   || 0;

    if (osde + medife + particular + ausentes === 0) {
      alert("Ingresá al menos un valor"); return;
    }

    const d = new Date(form.fecha + "T12:00:00");
    const dia = `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
    const mesStr = form.fecha.slice(0,7);

    setGuardando(true);

    const existente = registros.find(r => r.dia === dia && r.mes === mesStr);
    let error;
    if (existente) {
      ({ error } = await supabase
        .from("crm_registros")
        .update({ osde, medife, particular, notas: ausentes > 0 ? `${form.notas||""} [ausentes: ${ausentes}]`.trim() : (form.notas||"") })
        .eq("id", existente.id));
    } else {
      ({ error } = await supabase.from("crm_registros").insert({
        id: `cd_${Date.now()}`,
        mes: mesStr, dia, prof,
        prestacion: "CONTROL DIARIO",
        osde, medife, particular,
        regalo: 0,
        notas: ausentes > 0 ? `${form.notas||""} [ausentes: ${ausentes}]`.trim() : (form.notas||""),
        importado: false,
      }));
    }

    if (!error) {
      setMsgExito("✅ Registro guardado correctamente");
      setTimeout(() => setMsgExito(""), 3000);
      setForm({ fecha: new Date().toISOString().split("T")[0], osde:"", medife:"", particular:"", ausentes:"", notas:"" });
      await cargar();
      setVista("historial");
    } else {
      alert("Error al guardar: " + error.message);
    }
    setGuardando(false);
  };

  const tot = registros.reduce((a,r) => ({
    osde:       a.osde       + (r.osde||0),
    medife:     a.medife     + (r.medife||0),
    particular: a.particular + (r.particular||0),
    ausentes:   a.ausentes   + (r.ausentes||0),
  }), { osde:0, medife:0, particular:0, ausentes:0 });

  const totalAtendidos = tot.osde + tot.medife + tot.particular;
  const nombreMes = new Date(mes+"-15").toLocaleString("es-AR",{month:"long",year:"numeric"});

  return (
    <div style={{minHeight:"100vh",background:"#f8fafc",fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      <div style={{background:`linear-gradient(135deg,${color},${color}cc)`,color:"white",padding:"1rem 1.5rem",boxShadow:"0 4px 20px rgba(0,0,0,0.15)"}}>
        <div style={{maxWidth:"640px",margin:"0 auto"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{display:"flex",alignItems:"center",gap:"0.75rem"}}>
              <span style={{fontSize:"1.75rem"}}>{cfg.emoji}</span>
              <div>
                <div style={{fontWeight:700,fontSize:"1.1rem"}}>{user.nombre}</div>
                <div style={{fontSize:"0.8rem",opacity:0.85}}>Kinesiología Rava</div>
              </div>
            </div>
            <button onClick={onLogout} style={{background:"rgba(255,255,255,0.2)",border:"1px solid rgba(255,255,255,0.3)",color:"white",padding:"0.4rem 0.9rem",borderRadius:"8px",cursor:"pointer",fontSize:"0.85rem",fontWeight:600}}>Salir</button>
          </div>
          <div style={{display:"flex",gap:"0.5rem",marginTop:"1rem"}}>
            {[{id:"resumen",label:"📊 Resumen"},{id:"cargar",label:"➕ Cargar día"},{id:"historial",label:"📋 Historial"}].map(tab=>(
              <button key={tab.id} onClick={()=>setVista(tab.id)} style={{padding:"0.5rem 1rem",borderRadius:"8px",border:"none",cursor:"pointer",fontWeight:600,fontSize:"0.85rem",background:vista===tab.id?"white":"rgba(255,255,255,0.2)",color:vista===tab.id?color:"white",transition:"all 0.2s"}}>
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{maxWidth:"640px",margin:"0 auto",padding:"1.5rem 1rem"}}>

        {vista==="resumen" && (
          <div>
            <div style={{display:"flex",alignItems:"center",gap:"1rem",marginBottom:"1.5rem"}}>
              <input type="month" value={mes} onChange={e=>setMes(e.target.value)}
                style={{padding:"0.5rem 0.75rem",borderRadius:"10px",border:"1px solid #e2e8f0",fontSize:"0.9rem",outline:"none",background:"white"}}/>
              <span style={{color:"#64748b",fontSize:"0.9rem",textTransform:"capitalize"}}>{nombreMes}</span>
            </div>
            {cargando ? <div style={{textAlign:"center",padding:"3rem",color:"#94a3b8"}}>Cargando...</div> : (
              <>
                <div style={{background:`linear-gradient(135deg,${color},${color}cc)`,borderRadius:"20px",padding:"1.75rem",color:"white",marginBottom:"1rem",boxShadow:`0 8px 32px ${color}40`}}>
                  <div style={{fontSize:"0.85rem",opacity:0.85,marginBottom:"0.25rem"}}>📅 Total atendidos en {nombreMes}</div>
                  <div style={{fontSize:"3.5rem",fontWeight:800,letterSpacing:"-2px",lineHeight:1}}>{totalAtendidos}</div>
                  <div style={{display:"flex",gap:"1.5rem",marginTop:"0.75rem",fontSize:"0.85rem",opacity:0.9}}>
                    <span>OSDE: <strong>{tot.osde}</strong></span>
                    <span>MEDIFE: <strong>{tot.medife}</strong></span>
                    <span>PART: <strong>{tot.particular}</strong></span>
                  </div>
                  <div style={{fontSize:"0.8rem",opacity:0.65,marginTop:"0.4rem"}}>{registros.length} días cargados · {tot.ausentes} ausentes</div>
                </div>

                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.75rem"}}>
                  <KpiCard label="OSDE"       valor={tot.osde}       color="#3b82f6" bg="#eff6ff"/>
                  <KpiCard label="MEDIFE"     valor={tot.medife}     color="#8b5cf6" bg="#f5f3ff"/>
                  <KpiCard label="PARTICULAR" valor={tot.particular} color="#10b981" bg="#f0fdf4"/>
                  <KpiCard label="AUSENTES"   valor={tot.ausentes}   color="#ef4444" bg="#fef2f2"/>
                </div>
              </>
            )}
          </div>
        )}

        {vista==="cargar" && (
          <div>
            <h2 style={{fontSize:"1.25rem",fontWeight:700,color:"#1e293b",marginBottom:"1.5rem"}}>➕ Cargar atenciones del día</h2>
            {msgExito && (
              <div style={{background:"#d1fae5",border:"1px solid #6ee7b7",borderRadius:"12px",padding:"0.875rem 1rem",color:"#065f46",fontWeight:600,marginBottom:"1rem"}}>{msgExito}</div>
            )}
            <div style={{background:"white",borderRadius:"16px",border:"1px solid #f1f5f9",boxShadow:"0 2px 8px rgba(0,0,0,0.06)",padding:"1.5rem"}}>
              <Campo label="📅 Fecha">
                <input type="date" value={form.fecha} onChange={e=>setForm({...form,fecha:e.target.value})} style={inputStyle}/>
              </Campo>
              <div style={{borderTop:"1px solid #f1f5f9",margin:"1rem 0",paddingTop:"1rem"}}>
                <div style={{fontSize:"0.8rem",fontWeight:600,color:"#94a3b8",marginBottom:"0.75rem",letterSpacing:"0.05em"}}>PACIENTES DEL DÍA</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.75rem"}}>
                  <CampoNum label="🏥 OSDE"       value={form.osde}       onChange={v=>setForm({...form,osde:v})}/>
                  <CampoNum label="💙 MEDIFE"      value={form.medife}     onChange={v=>setForm({...form,medife:v})}/>
                  <CampoNum label="💵 PARTICULAR"  value={form.particular} onChange={v=>setForm({...form,particular:v})}/>
                  <CampoNum label="❌ AUSENTES"    value={form.ausentes}   onChange={v=>setForm({...form,ausentes:v})}/>
                </div>
              </div>
              <Campo label="📝 Nota / Nombres de ausentes (opcional)">
                <input type="text" value={form.notas} onChange={e=>setForm({...form,notas:e.target.value})}
                  placeholder="ej: Cancelo: 1.Giadanes 2.Graff" style={inputStyle}/>
              </Campo>
              {((parseInt(form.osde)||0)+(parseInt(form.medife)||0)+(parseInt(form.particular)||0)) > 0 && (
                <div style={{background:`${color}15`,border:`1px solid ${color}40`,borderRadius:"10px",padding:"0.875rem 1rem",marginTop:"0.75rem",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:"0.9rem",color:"#475569"}}>Total del día:</span>
                  <span style={{fontWeight:800,color,fontSize:"1.5rem"}}>
                    {(parseInt(form.osde)||0)+(parseInt(form.medife)||0)+(parseInt(form.particular)||0)}
                  </span>
                </div>
              )}
              <button onClick={guardar} disabled={guardando} style={{width:"100%",marginTop:"1.25rem",padding:"0.9rem",background:guardando?"#94a3b8":`linear-gradient(135deg,${color},${color}cc)`,border:"none",borderRadius:"12px",color:"white",fontSize:"1rem",fontWeight:700,cursor:guardando?"not-allowed":"pointer"}}>
                {guardando?"Guardando...":"✅ Guardar registro"}
              </button>
            </div>
          </div>
        )}

        {vista==="historial" && (
          <div>
            <div style={{display:"flex",alignItems:"center",gap:"1rem",marginBottom:"1.25rem"}}>
              <h2 style={{fontSize:"1.25rem",fontWeight:700,color:"#1e293b",margin:0}}>📋 Mis registros</h2>
              <input type="month" value={mes} onChange={e=>setMes(e.target.value)}
                style={{padding:"0.4rem 0.75rem",borderRadius:"8px",border:"1px solid #e2e8f0",fontSize:"0.85rem",outline:"none",background:"white",marginLeft:"auto"}}/>
            </div>
            {cargando ? (
              <div style={{textAlign:"center",padding:"3rem",color:"#94a3b8"}}>Cargando...</div>
            ) : registros.length===0 ? (
              <div style={{background:"white",borderRadius:"16px",border:"1px solid #f1f5f9",padding:"3rem",textAlign:"center",color:"#94a3b8"}}>
                No hay registros este mes.<br/>
                <button onClick={()=>setVista("cargar")} style={{marginTop:"1rem",padding:"0.6rem 1.25rem",background:color,color:"white",border:"none",borderRadius:"8px",cursor:"pointer",fontWeight:600}}>➕ Cargar primer día</button>
              </div>
            ) : (
              <div style={{display:"flex",flexDirection:"column",gap:"0.75rem"}}>
                {registros.map(r => {
                  const total=(r.osde||0)+(r.medife||0)+(r.particular||0);
                  return (
                    <div key={r.id} style={{background:"white",borderRadius:"14px",border:"1px solid #f1f5f9",boxShadow:"0 2px 8px rgba(0,0,0,0.04)",padding:"1rem 1.25rem"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"0.75rem"}}>
                        <span style={{fontWeight:700,color:"#1e293b",fontSize:"1rem"}}>{r.dia}</span>
                        <span style={{fontWeight:800,color,fontSize:"1.4rem"}}>{total}</span>
                      </div>
                      <div style={{display:"flex",gap:"0.5rem",flexWrap:"wrap"}}>
                        {(r.osde||0)>0       && <Chip label={`OSDE: ${r.osde}`}             bg="#eff6ff" color="#1d4ed8"/>}
                        {(r.medife||0)>0     && <Chip label={`MEDIFE: ${r.medife}`}         bg="#f5f3ff" color="#7c3aed"/>}
                        {(r.particular||0)>0 && <Chip label={`PARTICULAR: ${r.particular}`} bg="#f0fdf4" color="#15803d"/>}
                        {(r.ausentes||0)>0   && <Chip label={`AUSENTES: ${r.ausentes}`}     bg="#fef2f2" color="#dc2626"/>}
                      </div>
                      {r.notas && <div style={{marginTop:"0.5rem",fontSize:"0.8rem",color:"#94a3b8",fontStyle:"italic"}}>📝 {r.notas}</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const inputStyle={width:"100%",padding:"0.75rem 0.875rem",border:"1px solid #e2e8f0",borderRadius:"10px",fontSize:"0.95rem",outline:"none",background:"#f8fafc",boxSizing:"border-box"};
function Campo({label,children}){return <div style={{marginBottom:"1rem"}}><label style={{display:"block",fontSize:"0.8rem",fontWeight:600,color:"#475569",marginBottom:"0.4rem"}}>{label}</label>{children}</div>;}
function CampoNum({label,value,onChange}){return(<div><label style={{display:"block",fontSize:"0.75rem",fontWeight:600,color:"#64748b",marginBottom:"0.3rem"}}>{label}</label><input type="number" min="0" value={value} onChange={e=>onChange(e.target.value)} placeholder="0" style={{...inputStyle,textAlign:"center",fontWeight:700,fontSize:"1.25rem"}}/></div>);}
function KpiCard({label,valor,color,bg}){return(<div style={{background:bg,borderRadius:"14px",padding:"1rem 1.25rem"}}><div style={{fontSize:"0.75rem",color:"#94a3b8",marginBottom:"0.25rem",fontWeight:600}}>{label}</div><div style={{fontSize:"1.75rem",fontWeight:800,color}}>{valor}</div></div>);}
function Chip({label,bg,color}){return <span style={{background:bg,color,padding:"0.25rem 0.6rem",borderRadius:"6px",fontSize:"0.75rem",fontWeight:600}}>{label}</span>;}
