import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// Lee un PDF y devuelve sus líneas de texto reconstruidas por posición
// (agrupando por Y y ordenando por X) en vez de por el orden crudo de
// extracción, que no siempre coincide con el orden visual de una tabla.
export async function extraerFilasPDF(file, pagina = 1) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const page = await pdf.getPage(pagina);
  const content = await page.getTextContent();

  const items = content.items
    .filter(it => it.str && it.str.trim())
    .map(it => ({ text: it.str.trim(), x: it.transform[4], y: it.transform[5] }));

  const filas = [];
  for (const it of items) {
    let fila = filas.find(f => Math.abs(f.y - it.y) < 3);
    if (!fila) { fila = { y: it.y, items: [] }; filas.push(fila); }
    fila.items.push(it);
  }
  filas.sort((a, b) => b.y - a.y);
  filas.forEach(f => f.items.sort((a, b) => a.x - b.x));

  return filas.map(f => ({
    y: f.y,
    texto: f.items.map(i => i.text).join(" "),
    numeros: f.items
      .map(i => i.text)
      .filter(t => /^-?[\d.]+$/.test(t) && /\d/.test(t))
      .map(t => parseFloat(t))
      .filter(n => !isNaN(n)),
  }));
}
