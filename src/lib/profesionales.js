// Fuente única de verdad para los profesionales de la clínica.
// Antes esta lista (y el hecho de que David ya no trabaja acá) estaba
// duplicada y parcheada a mano en RavaCRM.jsx y PanelSusana.jsx.
export const PROFESIONALES = [
  { id: "ISOLINA",    color: "#6366f1", activo: true },
  { id: "JUAN CRUZ",  color: "#10b981", activo: true },
  { id: "FRANCISCO",  color: "#f59e0b", activo: true },
  { id: "PAULA",      color: "#ec4899", activo: true, soloRPG: true },
  { id: "DANIELA",    color: "#64748b", activo: true, esDuena: true },
  { id: "MILAGROS",   color: "#8b5cf6", activo: true },
  { id: "DAVID",      color: "#06b6d4", activo: false },
];

// Para selectores donde se carga/agrega información nueva (no tiene sentido
// dejar elegir a alguien que ya no trabaja en la clínica).
export const PROFESIONALES_ACTIVOS = PROFESIONALES.filter(p => p.activo);

// Para reportes e historial: incluye inactivos, porque meses viejos
// pueden tener datos de ellos y no queremos perder ese historial.
export const PROFESIONALES_TODOS = PROFESIONALES;

export const IDS_ACTIVOS = PROFESIONALES_ACTIVOS.map(p => p.id);
export const IDS_TODOS   = PROFESIONALES_TODOS.map(p => p.id);

export const COLOR_POR_PROFESIONAL = Object.fromEntries(
  PROFESIONALES.map(p => [p.id, p.color])
);
