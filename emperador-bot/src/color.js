// "¿Tienen el Air Force en negro?"
//
// El color NO se le manda a Shopify dentro de la búsqueda. Se hace al revés:
// se busca el modelo, y el color se filtra aquí sobre los títulos que
// volvieron. Hay tres razones, y las tres salen de tu catálogo real:
//
//   · Tus títulos mezclan idiomas. Tienes "Retro 4 full Black Caballero"
//     junto a "Air Force One Negro dama". Buscar "negro" en Shopify se
//     saltaría el Black, y buscar "black" se saltaría todos los demás.
//
//   · Tus títulos mezclan género y número: "Jordan 40 blanca caballero",
//     "Air Force One clásicos blancos dama". Un "blanco" literal no
//     encuentra ninguno de los dos.
//
//   · Shopify une las palabras con AND y no sabe de sinónimos. Aquí sí
//     podemos decir que café y marrón son lo mismo.
//
// Y sigue siendo UNA sola llamada a Shopify, igual que antes.

// Cada color: cómo lo pide el cliente, y cómo puede estar escrito en un
// título. "titulo" va sin \b a propósito, para que "negr" alcance a negro,
// negra, negros y negras de una vez.
const COLORES = [
  { nombre: "negro",    pide: /\b(negr[oa]s?|black)\b/gi,                       titulo: /negr|black/i },
  { nombre: "blanco",   pide: /\b(blanc[oa]s?|white)\b/gi,                      titulo: /blanc|white/i },
  { nombre: "gris",     pide: /\b(gris|grises|gray|grey)\b/gi,                  titulo: /gris|gray|grey/i },
  { nombre: "beige",    pide: /\b(beige|beis)\b/gi,                             titulo: /beige|beis/i },
  { nombre: "azul",     pide: /\b(azul|azules|blue|navy)\b/gi,                  titulo: /azul|blue|navy/i },
  { nombre: "verde",    pide: /\b(verdes?|green)\b/gi,                          titulo: /verde|green/i },
  { nombre: "marrón",   pide: /\b(marr[oó]n|marrones|caf[eé]|brown|camel)\b/gi, titulo: /marr[oó]n|marron|caf[eé]|brown|camel/i },
  { nombre: "rojo",     pide: /\b(roj[oa]s?|red|vinotinto)\b/gi,                titulo: /roj|red\b|vinotinto/i },
  { nombre: "rosado",   pide: /\b(rosad[oa]s?|rosa|rosas|pink)\b/gi,            titulo: /rosa|pink/i },
  { nombre: "morado",   pide: /\b(morad[oa]s?|lila|violeta|purple)\b/gi,        titulo: /morad|lila|violeta|purple/i },
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
    celeste: "celeste", turquesa: "turquesa",
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

// ── Para el reconocimiento por foto ─────────────────────────────────

// Lo que dijo la IA de visión ("negra", "black", "Negro") al nombre
// interno. Devuelve "" si no es un color que sepamos reconocer.
export function nombreDeColor(texto) {
  const limpio = String(texto || "").trim();
  if (!limpio) return "";
  const encontrado = COLORES.find((c) => reiniciar(c.pide).test(limpio));
  return encontrado ? encontrado.nombre : "";
}

// ¿El título de este producto es de ese color?
//
// Sirve para lo que más se quejaba la tienda: la historia enseña el
// negro y el bot manda el blanco. Con esto, entre varios del mismo
// modelo, el del color de la foto va primero.
//
// OJO: que dé false NO significa que sea de otro color. Muchos títulos no
// nombran ninguno ("Tommy caballero"), y esos no se penalizan — solo se
// premia al que SÍ coincide.
export function tituloEsDelColor(titulo, color) {
  const nombre = String(color || "").trim().toLowerCase();
  if (!nombre) return false;
  const c = COLORES.find((x) => x.nombre === nombre);
  return c ? c.titulo.test(String(titulo || "")) : false;
}

// ¿El título nombra algún color, el que sea? Un título que no dice color
// no contradice a la foto; uno que dice otro color, sí.
export function tituloNombraColor(titulo) {
  const texto = String(titulo || "");
  return COLORES.some((c) => c.titulo.test(texto));
}
