// LO QUE LA RESPUESTA DEJA SIN HACER (11-oct-2026, informe de errores del
// 12-sep al 11-oct). Redes por debajo de la IA de texto, para los fallos
// que el revisor encontró una y otra vez y que se ven sin pensar:
//
//   · Preguntó la TALLA y la respuesta ni la nombra ("¿tienes talla 12
//     americana?" → "Es el primero 👇"). En esta tienda la talla la
//     confirma un asesor: se le dice.
//   · Preguntó el precio EN BOLÍVARES y solo se le dieron dólares.
//   · La respuesta dice "aquí tienes el catálogo / todo lo que manejamos"
//     y no se le manda nada: se le manda el botón, que es lo que prometió.
//   · "Los precios están en las fotos que te mandé" sin ninguna foto.
//   · "No tengo Alexander McQueen" cuando el catálogo SÍ lo tiene.
//
// Cada una solo AÑADE una frase o QUITA la frase falsa; no reescribe.

import listaCatalogo from "./prompts/catalogo.txt";

const despejar = (t) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const frases = (t) => String(t || "").split(/(?<=[.!?😊😅🙌👇👆👟😕])\s+/);

/* ── La talla ───────────────────────────────────────────────────── */
const PREGUNTA_TALLA =
  /\btallas?\b|\b(?:us|eu|eur)\s*\d{1,2}(?:[.,]5)?\b|\b\d{1,2}(?:[.,]5)?\s*(?:us|americana|europea)\b|\bcalzo\b|\bqu[eé]\s+n[uú]meros?\b|\bn[uú]mero\s+\d{2}\b/i;
const NOMBRA_TALLA = /\btallas?\b|\bn[uú]mero\b/i;

export const FRASE_TALLA = "La talla te la confirma un asesor en un momento 😊";

export function contestaLaTalla(respuesta, texto) {
  const r = String(respuesta || "").trim();
  if (!PREGUNTA_TALLA.test(String(texto || "")) || NOMBRA_TALLA.test(r)) return { respuesta: r, corregido: false };
  return { respuesta: r ? `${r}\n\n${FRASE_TALLA}` : FRASE_TALLA, corregido: true };
}

/* ── Los bolívares ──────────────────────────────────────────────── */
const PIDE_BOLIVARES = /\bbol[ií]vares?\b|\bbs\.?\s*[sf]?\b|\bbsv\b|\bbsf\b|\ben\s+bs\b/i;
const NOMBRA_BOLIVARES = /\bbol[ií]var|\bbs\b|\btasa\b/i;

export const FRASE_BOLIVARES = "El precio en bolívares te lo confirma un asesor con la tasa del día 😊";

export function contestaLosBolivares(respuesta, texto) {
  const r = String(respuesta || "").trim();
  if (!PIDE_BOLIVARES.test(String(texto || "")) || NOMBRA_BOLIVARES.test(r)) return { respuesta: r, corregido: false };
  return { respuesta: r ? `${r}\n\n${FRASE_BOLIVARES}` : FRASE_BOLIVARES, corregido: true };
}

/* ── Promete algo que no se manda ───────────────────────────────── */
const PROMETE_CATALOGO =
  /\bcat[aá]logo\s+completo\b|\baqu[ií]\s+tienes\s+(?:el\s+)?cat[aá]logo\b|\btodo\s+lo\s+que\s+manejamos\b|\bb[uú]scalo\s+con\s+calma\b/i;

export function prometeElCatalogo(respuesta) {
  return PROMETE_CATALOGO.test(String(respuesta || ""));
}

const FOTOS_QUE_NO_HAY =
  /\b(?:fotos?|fichas?|im[aá]genes)\s+que\s+te\s+(?:mand[eé]|envi[eé]|pas[eé])(?!\p{L})|\baqu[ií]\s+tienes\s+el\s+precio\b/iu;

// Sin fichas en este mensaje ni antes: la frase que las nombra se va.
export function sinFotosQueNoHay(respuesta, { hayFichas = false, yaLasVio = false } = {}) {
  const r = String(respuesta || "").trim();
  if (hayFichas || yaLasVio || !FOTOS_QUE_NO_HAY.test(r)) return { respuesta: r, corregido: false };
  const limpia = frases(r).filter((f) => !FOTOS_QUE_NO_HAY.test(f)).join(" ").trim();
  return { respuesta: limpia, corregido: true };
}

/* ── Niega una marca que sí está en el catálogo ─────────────────── */
let titulos = null;
function titulosDespejados() {
  if (!titulos) {
    titulos = String(listaCatalogo || "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .map(despejar);
  }
  return titulos;
}

const NIEGA = /\bno\s+(?:tengo|tenemos|manejo|manejamos|hay|trabajamos(?:\s+con)?|vendemos)\s+(?:de\s+|la\s+marca\s+)?([\p{L}\d][\p{L}\d'’ ]{2,40}?)(?=[,.!?😕😊]|\s+(?:pero|ahora|por|en\s+este|disponible)|$)/iu;

// Lo que niega, si el catálogo lo tiene (al menos sus dos primeras palabras
// están en algún título). "" si no niega nada o si de verdad no está.
export function niegaLoQueHay(respuesta) {
  const m = String(respuesta || "").match(NIEGA);
  if (!m) return "";
  const palabras = despejar(m[1]).split(" ").filter((p) => p.length >= 3 && !/^(ese|esa|eso|ese|modelo|color|talla|stock|ahora|nada|nadie)$/.test(p));
  if (!palabras.length) return "";
  const clave = palabras.slice(0, 2).join(" ");
  if (clave.length < 4) return "";
  return titulosDespejados().some((t) => t.includes(clave)) ? m[1].trim() : "";
}

export function sinNegarLoQueHay(respuesta) {
  const r = String(respuesta || "").trim();
  const marca = niegaLoQueHay(r);
  if (!marca) return { respuesta: r, corregido: false, marca: "" };
  const limpia = frases(r)
    .map((f) => (NIEGA.test(f) ? f.replace(NIEGA, "").replace(/^[\s,.:;]*(?:pero\s+)?/i, "") : f))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const conMayuscula = limpia.charAt(0).toUpperCase() + limpia.slice(1);
  return { respuesta: conMayuscula, corregido: true, marca };
}
