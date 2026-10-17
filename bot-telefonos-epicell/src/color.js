// "¿Tienen el iPhone 15 en negro?"
//
// El color NO se busca dentro de la hoja junto con el modelo. Se hace al
// revés: se busca el modelo, y el color se filtra aquí sobre los títulos que
// volvieron. Por tres razones:
//
//   · Los títulos mezclan idiomas: "iPhone 15 Black" junto a "Galaxy A15
//     Negro". Buscar "negro" se saltaría el Black, y al revés.
//
//   · Las marcas le ponen nombre propio al color: Apple dice "Medianoche" o
//     "Titanio Natural", Samsung "Onyx" o "Phantom Black". El cliente dice
//     "negro" y espera ver esos.
//
//   · La búsqueda exige TODAS las palabras. Aquí sí podemos decir que
//     "medianoche" y "negro" son lo mismo para quien pide un teléfono negro.

// Cada color: cómo lo pide el cliente, y cómo puede estar escrito en un
// título. "titulo" va sin \b a propósito, para que "negr" alcance a negro,
// negra, negros y negras de una vez.
const COLORES = [
  // Los nombres de fábrica van en "titulo": quien pide "negro" también
  // quiere ver el Medianoche, el Onyx o el Grafito.
  { nombre: "negro",    pide: /\b(negr[oa]s?|black|medianoche|midnight)\b/gi,   titulo: /negr|black|medianoche|midnight|onyx|grafit|graphite/i },
  { nombre: "blanco",   pide: /\b(blanc[oa]s?|white|estelar|starlight)\b/gi,    titulo: /blanc|white|estelar|starlight|marble/i },
  { nombre: "gris",     pide: /\b(gris|grises|gray|grey|grafito|graphite)\b/gi, titulo: /gris|gray|grey|grafit|graphite/i },
  // El acabado de los iPhone Pro: "Titanio Natural", "Titanio Negro"...
  { nombre: "titanio",  pide: /\b(titanio|titanium)\b/gi,                       titulo: /titani/i },
  { nombre: "beige",    pide: /\b(beige|beis)\b/gi,                             titulo: /beige|beis/i },
  { nombre: "azul",     pide: /\b(azul|azules|blue|navy)\b/gi,                  titulo: /azul|blue|navy/i },
  { nombre: "verde",    pide: /\b(verdes?|green)\b/gi,                          titulo: /verde|green/i },
  { nombre: "marrón",   pide: /\b(marr[oó]n|marrones|caf[eé]|brown|camel)\b/gi, titulo: /marr[oó]n|marron|caf[eé]|brown|camel/i },
  { nombre: "rojo",     pide: /\b(roj[oa]s?|red|vinotinto)\b/gi,                titulo: /roj|red\b|vinotinto/i },
  { nombre: "rosado",   pide: /\b(rosad[oa]s?|rosa|rosas|pink)\b/gi,            titulo: /rosa|pink/i },
  { nombre: "morado",   pide: /\b(morad[oa]s?|lila|violeta|purple|lavanda|lavender)\b/gi, titulo: /morad|lila|violeta|purple|lavand|lavender/i },
  { nombre: "dorado",   pide: /\b(dorad[oa]s?|oro|gold)\b/gi,                   titulo: /dorad|gold/i },
  { nombre: "plateado", pide: /\b(platead[oa]s?|plata|silver)\b/gi,             titulo: /platead|silver/i },
  { nombre: "amarillo", pide: /\b(amarill[oa]s?|yellow)\b/gi,                   titulo: /amarill|yellow/i },
  { nombre: "naranja",  pide: /\b(naranjas?|orange)\b/gi,                       titulo: /naranja|orange/i },
  { nombre: "crema",    pide: /\b(cremas?|hueso)\b/gi,                          titulo: /crema|hueso/i },
  { nombre: "celeste",  pide: /\b(celestes?)\b/gi,                              titulo: /celeste/i },
  { nombre: "turquesa", pide: /\b(turquesas?)\b/gi,                             titulo: /turquesa/i },
];

// Qué colores pidió el cliente, y el término de búsqueda ya sin ellos.
//
//   "Air Force One negro"  ->  { termino: "Air Force One", colores: ["negro"] }
//   "terrex negro y blanco" -> { termino: "terrex",        colores: ["negro","blanco"] }
//   "Jordan 4"             ->  { termino: "Jordan 4",      colores: [] }
export function separarColor(termino) {
  const texto = String(termino || "");
  const colores = COLORES.filter((c) => reiniciar(c.pide).test(texto));

  let limpio = texto;
  for (const c of colores) limpio = limpio.replace(reiniciar(c.pide), " ");

  // Se quedan colgando las conjunciones de "negro y blanco".
  limpio = limpio
    .replace(/\s+[yo]\s+/gi, " ")
    .replace(/[\/,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return { termino: limpio, colores: colores.map((c) => c.nombre) };
}

// De los productos que devolvió Shopify, los que son de esos colores.
// Si pidió dos colores, el título tiene que llevar los dos: quien pide
// "terrex negro y blanco" no quiere el terrex negro a secas.
export function filtrarPorColor(productos, colores) {
  if (!colores.length) return productos;

  const patrones = colores
    .map((n) => COLORES.find((c) => c.nombre === n)?.titulo)
    .filter(Boolean);

  return productos.filter((p) =>
    patrones.every((patron) => patron.test(String(p.titulo || "")))
  );
}

// Cuando el cliente solo dice un color, sin modelo ("¿tienes algo en
// negro?"), no queda término que buscar. Entonces sí se le pide a Shopify
// el color, pero recortado —"negr"— para que el comodín alcance negro,
// negra y negros. Los que estén escritos en inglés se quedan fuera; para
// eso está el filtro de arriba cuando sí hay modelo.
export function terminoDeColor(colores) {
  const RECORTES = {
    negro: "negr", blanco: "blanc", rojo: "roj", morado: "morad",
    dorado: "dorad", plateado: "platead", amarillo: "amarill",
    marrón: "marr", rosado: "rosa", verde: "verde", azul: "azul",
    gris: "gris", beige: "beige", naranja: "naranja", crema: "crema",
    celeste: "celeste", turquesa: "turquesa", titanio: "titani",
  };
  return colores.map((n) => RECORTES[n] || n).join(" ");
}

// Un regex con /g recuerda por dónde iba entre llamadas. Sin esto, la
// segunda vez que se usa el mismo patrón empieza a fallar de forma
// intermitente, que es de los fallos más difíciles de ver.
function reiniciar(patron) {
  patron.lastIndex = 0;
  return patron;
}
