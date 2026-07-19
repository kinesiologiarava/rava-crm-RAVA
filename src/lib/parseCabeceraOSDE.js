import { extraerFilasPDF } from "./pdfExtract.js";

function valorDeFila(filas, regexLabel) {
  const f = filas.find(f => regexLabel.test(f.texto));
  if (!f || f.numeros.length === 0) return null;
  return f.numeros[f.numeros.length - 1]; // última columna = "Documentación a Presentar" (= Liquidado)
}

// Parsea el PDF "Informe de Cabecera de Liquidación" de OSDE.
// Formato verificado contra 8 documentos reales — el orden de las filas
// (gravado/exento/IVA) varía entre trámites, por eso se busca cada una
// por su etiqueta en vez de asumir una posición fija.
export async function parseCabeceraOSDE(file) {
  const filas = await extraerFilasPDF(file, 1);
  const texto = filas.map(f => f.texto).join("\n");

  const tramite = texto.match(/Tramite:\s*(\d+)/i)?.[1] || null;
  const fechaEmision = texto.match(/Fecha de Emisi[oó]n:\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1] || null;

  let cantPrestaciones = null, importeConsumos = null;
  const idxDatos = filas.findIndex(f => /Importe Consumos Presentados/i.test(f.texto));
  if (idxDatos >= 0 && filas[idxDatos + 1]) {
    const nums = filas[idxDatos + 1].numeros;
    importeConsumos = nums[0] ?? null;
    cantPrestaciones = nums[1] ?? null;
  }

  const gravado = valorDeFila(filas, /Importe gravado/i);
  const exento  = valorDeFila(filas, /Importe exento/i);
  const iva105  = valorDeFila(filas, /IVA al 10[.,]50/i);
  const iva21   = valorDeFila(filas, /IVA al 21/i);
  const iva = (iva105 || 0) + (iva21 || 0);

  const filaTotal = filas.find(f => /^Total:/i.test(f.texto.trim()));
  const total = filaTotal?.numeros?.[filaTotal.numeros.length - 1] ?? null;

  const ok = !!(tramite && fechaEmision && total != null && (gravado != null || exento != null));

  return { ok, tramite, fechaEmision, cantPrestaciones, importeConsumos, gravado, exento, iva, total };
}
