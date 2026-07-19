import { extraerFilasPDFTodasLasPaginas } from "./pdfExtract.js";

// Mapeo de códigos de nomenclador OSDE → tipo de prestación del CRM.
// Se completa de a poco a medida que aparecen códigos nuevos en los PDF reales.
const MAPEO_CODIGOS_OSDE = {
  "1250181": "FKT",
};

function parseFilaDato(fila) {
  const items = fila.items;
  if (items.length < 6) return null;
  if (!/^\d+$/.test(items[0].text)) return null; // no es una fila de dato (ID Osde)
  if (!/^\d{2}\/\d{2}\/\d{2}$/.test(items[2]?.text || "")) return null;

  const idxCodigo = items.findIndex(i => /^-\s*\d+/.test(i.text));
  if (idxCodigo < 0) return null;
  const codigo = items[idxCodigo].text.match(/\d+/)?.[0] || null;

  // Estado: primera palabra en mayúsculas de 3+ letras después del código
  // (ivaAfi/Cxto son una sola letra, así se descartan)
  const idxEstado = items.findIndex((it, idx) => idx > idxCodigo && /^[A-ZÁÉÍÓÚÑ]{3,}$/.test(it.text));
  if (idxEstado < 0) return null;
  const estado = items[idxEstado].text;

  const resto = items.slice(idxEstado + 1);
  const decimales = resto
    .filter(it => /^[\d,]+\.\d{2}$/.test(it.text))
    .map(it => parseFloat(it.text.replace(/,/g, "")));

  const liquidado = decimales[1] ?? null; // [0]=facturado, [1]=liquidado, [2]=diferencia
  if (liquidado == null || !codigo) return null;

  return { codigo, estado, fechaConsumo: items[2].text, liquidado };
}

// Parsea el PDF "Detalle de Liquidación" (línea por línea, muchas páginas)
// y devuelve un resumen agregado por tipo de prestación + rango de fechas
// real del período. No guarda cada línea individual todavía (eso queda
// para el motor de conciliación); esto alcanza para completar el
// desglose por prestación y el período de un trámite.
export async function parseDetalleOSDE(file, onProgreso) {
  const paginas = await extraerFilasPDFTodasLasPaginas(file, onProgreso);

  const porTipo = {};
  const codigosSinMapear = {};
  let fechaMin = null, fechaMax = null;
  let debitadas = 0;
  let totalFilas = 0;

  for (const pagina of paginas) {
    for (const fila of pagina) {
      const d = parseFilaDato(fila);
      if (!d) continue;
      totalFilas++;

      const tipo = MAPEO_CODIGOS_OSDE[d.codigo];
      if (!tipo) {
        codigosSinMapear[d.codigo] = (codigosSinMapear[d.codigo] || 0) + 1;
        continue;
      }
      if (!porTipo[tipo]) porTipo[tipo] = { visitas: 0, liquidado: 0 };
      porTipo[tipo].visitas += 1;
      porTipo[tipo].liquidado += d.liquidado;
      if (d.estado !== "APROBADO") debitadas++;

      const [dd, mm, yy] = d.fechaConsumo.split("/");
      const iso = `20${yy}-${mm}-${dd}`;
      if (!fechaMin || iso < fechaMin) fechaMin = iso;
      if (!fechaMax || iso > fechaMax) fechaMax = iso;
    }
  }

  return { totalFilas, porTipo, codigosSinMapear, debitadas, fechaDesde: fechaMin, fechaHasta: fechaMax };
}
