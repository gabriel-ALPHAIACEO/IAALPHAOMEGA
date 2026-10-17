// LEER UN EXCEL (.xlsx) SIN INSTALAR NADA. Muchos sistemas cerrados solo
// exportan a Excel. Un .xlsx es un zip con XML adentro: se abre el zip (con el
// zlib de Node), se leen los textos compartidos y la hoja, y sale
// { columnas, filas } como un CSV.
//
// Lee: textos, números, textos «en línea» y resultados de fórmulas. No lee
// fechas como fechas (salen como el número de Excel) ni el formato. Los .xls
// viejos (binarios, de antes de 2007) no: hay que guardarlos como .xlsx o .csv.

import zlib from "node:zlib";
import { aTabla } from "./tabla.mjs";

export function esXlsx(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 4 && buffer.readUInt32LE(0) === 0x04034b50;
}

export function esXlsViejo(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 8 && buffer.readUInt32LE(0) === 0xe011cfd0 && buffer.readUInt32LE(4) === 0xe11ab1a1;
}

// Los archivos del zip: { nombre: () => Buffer }.
export function abrirZip(buffer) {
  let fin = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66000); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin === -1) throw new Error("El archivo de Excel está dañado (no se puede abrir).");
  const cuantos = buffer.readUInt16LE(fin + 10);
  let p = buffer.readUInt32LE(fin + 16);
  const archivos = {};
  for (let n = 0; n < cuantos; n++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) throw new Error("El archivo de Excel está dañado (índice roto).");
    const metodo = buffer.readUInt16LE(p + 10);
    const comprimido = buffer.readUInt32LE(p + 20);
    const largoNombre = buffer.readUInt16LE(p + 28);
    const largoExtra = buffer.readUInt16LE(p + 30);
    const largoComentario = buffer.readUInt16LE(p + 32);
    const local = buffer.readUInt32LE(p + 42);
    const nombre = buffer.toString("utf8", p + 46, p + 46 + largoNombre);
    archivos[nombre] = () => {
      const inicio = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      const datos = buffer.subarray(inicio, inicio + comprimido);
      if (metodo === 0) return Buffer.from(datos);
      if (metodo === 8) return zlib.inflateRawSync(datos);
      throw new Error(`El Excel usa una compresión que no se puede leer (${metodo}).`);
    };
    p += 46 + largoNombre + largoExtra + largoComentario;
  }
  return archivos;
}

function sinEntidades(t) {
  return String(t)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// El texto de un <si> o un <is>: puede venir partido en varios <t> (negritas, etc.).
function textoDe(xml) {
  return [...String(xml).matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => sinEntidades(m[1])).join("");
}

function columnaDeReferencia(ref) {
  const letras = String(ref || "").replace(/[^A-Z]/gi, "").toUpperCase();
  let n = 0;
  for (const l of letras) n = n * 26 + (l.charCodeAt(0) - 64);
  return n - 1;
}

// Los números de Excel a veces salen como 0.30000000000000004: se redondean.
function numeroLimpio(v) {
  if (!/^-?\d+\.\d{10,}$/.test(v)) return v;
  return String(Number(Number(v).toPrecision(15)));
}

// La ruta de la hoja: la que se pide por nombre, o la primera.
function rutaDeLaHoja(archivos, hoja = "") {
  const leer = (n) => (archivos[n] ? archivos[n]().toString("utf8") : "");
  const libro = leer("xl/workbook.xml");
  const relaciones = leer("xl/_rels/workbook.xml.rels");
  const hojas = [...libro.matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
    nombre: sinEntidades((m[0].match(/\bname="([^"]*)"/) || [])[1] || ""),
    rid: (m[0].match(/\br:id="([^"]*)"/) || m[0].match(/\bid="([^"]*)"/) || [])[1] || "",
  }));
  let elegida = hojas[0];
  if (hoja) {
    elegida = hojas.find((h) => h.nombre.toLowerCase() === String(hoja).toLowerCase());
    if (!elegida) throw new Error(`El Excel no tiene la hoja «${hoja}». Tiene: ${hojas.map((h) => h.nombre).join(", ")}.`);
  }
  if (elegida?.rid) {
    const rel = [...relaciones.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${elegida.rid}"`));
    const destino = (rel?.match(/\bTarget="([^"]*)"/) || [])[1];
    if (destino) {
      const ruta = destino.startsWith("/") ? destino.slice(1) : `xl/${destino.replace(/^\.\//, "")}`;
      if (archivos[ruta]) return ruta;
    }
  }
  const primera = Object.keys(archivos).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))[0];
  if (!primera) throw new Error("El Excel no tiene ninguna hoja.");
  return primera;
}

export function leerXlsx(buffer, { hoja = "" } = {}) {
  if (esXlsViejo(buffer)) throw new Error("Es un .xls viejo (de antes de 2007) y no se puede leer: en el sistema elige guardar como .xlsx o .csv.");
  if (!esXlsx(buffer)) throw new Error("No es un archivo de Excel (.xlsx).");
  const archivos = abrirZip(buffer);
  const compartidos = archivos["xl/sharedStrings.xml"] ? [...archivos["xl/sharedStrings.xml"]().toString("utf8").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textoDe(m[1])) : [];
  const xml = archivos[rutaDeLaHoja(archivos, hoja)]().toString("utf8");
  const matriz = [];
  for (const r of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const fila = [];
    for (const c of String(r[1] || "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const atributos = c[1];
      const dentro = c[2] || "";
      const i = columnaDeReferencia((atributos.match(/\br="([^"]*)"/) || [])[1]);
      const tipo = (atributos.match(/\bt="([^"]*)"/) || [])[1] || "n";
      const v = sinEntidades((dentro.match(/<v>([\s\S]*?)<\/v>/) || [])[1] ?? "");
      let valor = "";
      if (tipo === "s") valor = compartidos[Number(v)] ?? "";
      else if (tipo === "inlineStr") valor = textoDe(dentro);
      else if (tipo === "e") valor = "";
      else valor = tipo === "n" ? numeroLimpio(v) : v;
      fila[i >= 0 ? i : fila.length] = valor;
    }
    matriz.push(Array.from(fila, (x) => x ?? ""));
  }
  return aTabla(matriz.filter((f) => f.some((x) => String(x).trim() !== "")));
}
