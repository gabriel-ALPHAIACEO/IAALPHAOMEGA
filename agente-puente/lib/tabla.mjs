// LEER Y ESCRIBIR TABLAS: el texto que sale de un sistema (CSV con ; , tab o
// |, la salida de sqlcmd o mysql) se convierte en { columnas, filas }, y de
// vuelta a CSV. Sin dependencias.

// La codificación. "auto" (lo normal): si el texto es UTF-8 válido, es UTF-8;
// si no, es el latin1 de Windows (casi todos los sistemas viejos). Con la marca
// FF FE es UTF-16.
export function decodificar(buffer, codificacion = "auto") {
  const b = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || "");
  const c = String(codificacion || "auto").toLowerCase();
  if (c === "latin1" || c === "windows-1252" || c === "cp1252" || c === "ansi") return new TextDecoder("windows-1252").decode(b);
  if (c === "utf16le" || c === "utf-16le" || c === "utf16" || (c === "auto" && b[0] === 0xff && b[1] === 0xfe)) return new TextDecoder("utf-16le").decode(b);
  if (c === "auto") {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(b);
    } catch {
      return new TextDecoder("windows-1252").decode(b);
    }
  }
  return new TextDecoder("utf-8").decode(b);
}

// La salida de sqlcmd y parecidos trae una línea de rayas debajo del encabezado
// y un "(123 filas afectadas)" al final: se limpian. Un CSV normal queda igual.
export function limpiarSalida(texto) {
  return String(texto || "")
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .filter((l) => !/^[-=;,\s|+\t]+$/.test(l))
    .filter((l) => !/^\(\d+\s+(rows?|filas?)[^)]*\)$/i.test(l.trim()))
    .join("\n");
}

const SEPARADORES = [";", "\t", ",", "|"];

// Qué separa las columnas: el que más sale en la primera línea (fuera de comillas).
export function separadorDe(linea) {
  const cuenta = Object.fromEntries(SEPARADORES.map((s) => [s, 0]));
  let comillas = false;
  for (const c of String(linea || "")) {
    if (c === '"') comillas = !comillas;
    else if (!comillas && c in cuenta) cuenta[c]++;
  }
  let mejor = ";";
  for (const s of SEPARADORES) if (cuenta[s] > cuenta[mejor]) mejor = s;
  return mejor;
}

// CSV → { columnas, filas }. Respeta las comillas ("a;b", "dijo ""hola""") y
// los saltos de línea dentro de ellas. Las filas vacías se saltan.
export function leerCsv(texto) {
  const limpio = String(texto || "").replace(/^﻿/, "");
  const sep = separadorDe(limpio.split(/\r?\n/, 1)[0]);
  const filas = [];
  let fila = [];
  let celda = "";
  let comillas = false;
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (comillas) {
      if (c === '"' && limpio[i + 1] === '"') {
        celda += '"';
        i++;
      } else if (c === '"') comillas = false;
      else celda += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) {
      fila.push(celda.trim());
      celda = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && limpio[i + 1] === "\n") i++;
      fila.push(celda.trim());
      filas.push(fila);
      fila = [];
      celda = "";
    } else celda += c;
  }
  if (celda || fila.length) {
    fila.push(celda.trim());
    filas.push(fila);
  }
  return aTabla(filas.filter((f) => f.some((x) => x !== "")));
}

// [[encabezados], [fila], …] → { columnas, filas }. Un encabezado vacío se
// llama «columna N»; las filas quedan del mismo ancho que el encabezado.
export function aTabla(matriz) {
  const [cabeza = [], ...resto] = matriz;
  const columnas = cabeza.map((c, i) => String(c ?? "").trim() || `columna ${i + 1}`);
  const filas = resto.map((f) => columnas.map((_, i) => String(f[i] ?? "").trim()));
  return { columnas, filas };
}

// Una lista de objetos (un JSON) → tabla. Acepta [ {...} ] o { productos: [ … ] }
// (también «items», «data», «articulos»).
export function tablaDeJson(datos) {
  let lista = datos;
  if (lista && !Array.isArray(lista) && typeof lista === "object") {
    lista = ["productos", "items", "data", "articulos", "inventario", "stock"].map((k) => lista[k]).find(Array.isArray);
  }
  if (!Array.isArray(lista)) throw new Error("El JSON tiene que ser una lista de productos ([{…}, {…}]) o traerla en «productos».");
  const columnas = [];
  for (const o of lista) for (const k of Object.keys(o || {})) if (!columnas.includes(k) && (o[k] === null || typeof o[k] !== "object")) columnas.push(k);
  return { columnas, filas: lista.map((o) => columnas.map((k) => (o?.[k] === null || o?.[k] === undefined ? "" : String(o[k])))) };
}

function celdaCsv(valor, sep) {
  const v = String(valor ?? "");
  return v.includes(sep) || /["\r\n]/.test(v) || v !== v.trim() ? `"${v.replace(/"/g, '""')}"` : v;
}

export function aCsv(columnas, filas, sep = ";") {
  return [columnas, ...filas].map((f) => f.map((c) => celdaCsv(c, sep)).join(sep)).join("\n");
}

// "1.234,50" → 1234.5 · "1,234.50" → 1234.5 · "12,5" → 12.5 · "$ 45" → 45 ·
// "12.500" → 12500 (un solo punto con 3 cifras detrás = miles) · "0.500" → 0.5.
export function aNumero(texto) {
  let t = String(texto ?? "").trim().replace(/[^\d.,-]/g, "");
  if (!t || /^[-.,]+$/.test(t)) return null;
  const negativo = t.startsWith("-");
  t = t.replace(/-/g, "");
  const punto = t.lastIndexOf(".");
  const coma = t.lastIndexOf(",");
  if (punto !== -1 && coma !== -1) {
    const decimal = punto > coma ? "." : ",";
    t = t.split(decimal === "." ? "," : ".").join("").replace(decimal, ".");
  } else if (punto !== -1 || coma !== -1) {
    const s = punto !== -1 ? "." : ",";
    const partes = t.split(s);
    const miles = partes.length > 2 || (partes[1].length === 3 && partes[0] !== "" && partes[0] !== "0");
    t = miles ? partes.join("") : partes.join(".");
  }
  const n = Number(t);
  return Number.isFinite(n) ? (negativo ? -n : n) : null;
}
