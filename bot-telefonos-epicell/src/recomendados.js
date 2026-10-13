// "Muéstrame esos": enseñar lo que el bot acaba de nombrar.
//
// EL FALLO QUE ESTO ARREGLA, tal como pasó en producción:
//
//   Cliente:  "¿Qué me recomiendas de 8/256gb?"
//   Bot:      "1. Samsung A37  2. Samsung A27  3. Redmi Note 17
//              4. Camon 50 Ultra  5. Note 60 Pro"
//   Cliente:  "Muéstrame esos"
//   Bot:      "¡Claro! Te muestro los Samsung que tengo"
//              → dos CARGADORES de $40
//
// El modelo había recitado cinco teléfonos y, al pedirle verlos, buscó
// "Samsung" a ciegas. La lista que acababa de decir no estaba guardada en
// ninguna parte: el historial es un resumen, no el mensaje.
//
// LA IDEA. Se guarda el último mensaje del bot tal cual (ver
// ultima_respuesta en estado.js) y, cuando el cliente pide verlos, se
// buscan EN ESE TEXTO los títulos del catálogo. No hay que adivinar nada:
// los nombres están escritos ahí, y el catálogo dice cuáles existen.
//
// Y si en ese mensaje había una capacidad —"con 8GB y 256GB"— solo pasan
// los equipos que la tienen. El cliente pidió esos, no los parecidos.

import { leerColumnaCapacidad, separarCapacidad } from "./capacidad.js";

// "muéstrame esos", "enséñamelos", "los quiero ver", "dale, muéstramelos".
//
// Tiene que ser una petición de VER lo ya nombrado, no una búsqueda nueva.
// Por eso pide un demostrativo ("esos", "los", "esos mismos") o el verbo
// solo: "muéstrame el Samsung A37" NO entra aquí, eso es una búsqueda
// normal y el modelo la resuelve mejor.
const PIDE_VERLOS =
  /^\s*(?:(?:dale|ok|va|s[ií]|bueno|perfecto|claro)[\s,]+)?(?:mu[eé]stra|ens[eé][ñn]a|most?ra|quiero ver|me gustar[ií]a ver|d[ée]jame ver|ver)(?:me|nos)?\s*(?:los|las|esos|esas|esto|estos|todos|todas|el resto|los dem[aá]s)?\s*[.!?]*\s*$/i;

// "los que me dijiste", "esos mismos", "los que mencionaste".
const LOS_QUE_DIJISTE =
  /\b(los|las|esos|esas)\s+(que\s+)?(me\s+)?(dijiste|mencionaste|nombraste|recomendaste|dices|recomiendas)\b|\besos\s+mismos\b/i;

// "Mándalos", "en imágenes", "ahora muéstrame, quiero verlos" (2-oct-2026,
// caso real con una nota de voz): también es pedir ver lo que se acaba de
// nombrar. Solo mensajes cortos que no dicen NADA más que eso: si nombra un
// equipo, es una búsqueda y va por el camino normal.
const PIDE_FOTOS_CORTO =
  /^(?:\s*(?:ahora|ok|dale|va|s[ií]|bueno|claro|porfa|por\s+favor|entonces|y|pues)[\s,]*)*(?:m[aá]nd(?:a|ame)?(?:los|las|melos|melas)|env[ií]a(?:me)?(?:los|las|melos|melas)|p[aá]sa(?:me)?(?:los|las|melos|melas)|mu[eé]stra(?:me)?(?:los|las|melos|melas)?|ens[eé][ñn]a(?:me)?(?:los|las|melos|melas)?|(?:en|con)\s+(?:im[aá]genes|fotos?)|(?:las\s+|sus\s+)?(?:im[aá]genes|fotos?)|quiero\s+ver(?:los|las)?)(?:[\s,.!]+(?:quiero\s+ver(?:los|las)?|porfa|por\s+favor|en\s+(?:im[aá]genes|fotos?)|las\s+fotos|las\s+im[aá]genes))*\s*[.!?]*\s*$/i;

// ¿PIDE OTRA VEZ LO MISMO QUE YA VIO? (13-oct-2026, informe de errores:
// "Powerbanks" y luego "Powerbank"; la tienda tenía UNO y ya se lo habían
// enseñado. El bot contestó "aquí tienes el que ya hemos visto" y el revisor
// lo marcó como que no contestó.) Si lo que pide es lo mismo que se buscó
// —o pide "más opciones", "otros"— y no hay más, se le dice claro que es lo
// único que hay. Devuelve las palabras con que lo pidió ("powerbanks"), o "".
const PIDE_MAS_OPCIONES =
  /\b(?:m[aá]s|otr[oa]s?)\s+(?:opciones|modelos|marcas|tipos|colores|capacidades)\b|\bqu[eé]\s+m[aá]s\s+(?:tienen|hay|tienes)\b|\bno\s+(?:tienen|hay|tienes)\s+otr[oa]s?\b|\bnada\s+m[aá]s\b|\bsolo\s+(?:ese|esa|eso|tienen\s+ese)\b/i;
const RELLENO = new Set(
  ("tienen tienes tiene hay de del los las el la lo un una unos unas me nos muestras muestra muestrame ensename quiero ver busco buscando " +
    "algun alguna algunos algunas que y o para por favor porfa precio modelo modelos opcion opciones mas otro otra otros otras " +
    "hola buenas tienda ustedes venden vendes disponible disponibles cuales cual tipo tipos")
    .split(" ")
);

function sinTildes(texto) {
  return String(texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function singular(p) {
  if (p.length > 5 && p.endsWith("es")) return p.slice(0, -2);
  if (p.length > 3 && p.endsWith("s")) return p.slice(0, -1);
  return p;
}

function palabrasQueImportan(texto) {
  return sinTildes(String(texto || "").toLowerCase())
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !RELLENO.has(w));
}

export function pideLoMismoOtraVez(texto, termino) {
  const dice = palabrasQueImportan(texto);
  if (PIDE_MAS_OPCIONES.test(sinTildes(texto))) return dice.join(" ") || "eso";
  const busca = new Set(palabrasQueImportan(termino).map(singular));
  if (!dice.length || dice.length > 4 || !busca.size) return "";
  const todas = dice.every((w) => {
    const s = singular(w);
    return busca.has(s) || [...busca].some((b) => b.length >= 4 && s.length >= 4 && (b.startsWith(s) || s.startsWith(b)));
  });
  return todas ? dice.join(" ") : "";
}

// "Por ahora es el único que tenemos de powerbanks 😊", si la respuesta no
// lo dice ya. La frase va primero: es lo que contesta lo que pidió.
const YA_DICE_QUE_ES_LO_UNICO = /\b[uú]nic[oa]s?\b|\bs[oó]lo\s+(?:tenemos|hay|queda|nos\s+queda)\b|\bno\s+(?:tenemos|hay)\s+(?:m[aá]s|otr[oa]s?)\b/i;

export function conLoUnicoQueHay(respuesta, { cuantos = 1, deQue = "" } = {}) {
  const texto = String(respuesta || "").trim();
  if (YA_DICE_QUE_ES_LO_UNICO.test(texto)) return texto;
  const de = deQue && deQue !== "eso" ? ` de ${deQue}` : "";
  const frase = cuantos === 1 ? `Por ahora es el único que tenemos${de} 😊` : `Por ahora son los únicos que tenemos${de} 😊`;
  // "Aquí tienes el X que ya hemos visto." sobra delante de la frase nueva.
  // (Los puntos de "20.000mAh" no cortan la frase.)
  const resto = texto.replace(/^aqu[ií]\s+tienes\s+(?:[^.!?]|\.(?=\d))*?\bya\s+(?:hemos\s+visto|viste|te\s+mostr[eé])(?:[^.!?]|\.(?=\d))*[.!?]\s*/i, "");
  return `${frase}${resto ? ` ${resto}` : ""}`;
}

export function pideVerLoRecomendado(texto) {
  const limpio = String(texto || "").trim();
  if (!limpio) return false;
  return PIDE_VERLOS.test(limpio) || LOS_QUE_DIJISTE.test(limpio) || PIDE_FOTOS_CORTO.test(limpio);
}

// Los productos del catálogo que aparecen nombrados en un texto.
//
// Se buscan los títulos LARGOS primero: si el catálogo tiene "Samsung
// A57" y "Samsung A5", un texto que diga "Samsung A57" tiene que dar el
// A57 y no los dos. Al encontrar uno, su nombre se tacha del texto para
// que un título más corto no lo vuelva a pescar.
export function productosRecomendados(productos, texto, tope = 10) {
  const original = String(texto || "");
  if (!original.trim() || !productos?.length) return [];

  let restante = normalizar(original);
  const nombrados = [];

  const porLargo = [...productos].sort(
    (a, b) => String(b.titulo).length - String(a.titulo).length
  );

  for (const producto of porLargo) {
    const titulo = normalizar(producto.titulo);
    if (!titulo || titulo.length < 4) continue; // "Mi", "A7": pescan cualquier cosa

    const donde = restante.indexOf(titulo);
    if (donde === -1) continue;

    // Dónde lo nombró, para devolverlos en el mismo orden en que los dijo.
    nombrados.push({ producto, donde: normalizar(original).indexOf(titulo) });
    restante = restante.slice(0, donde) + " ".repeat(titulo.length) + restante.slice(donde + titulo.length);
  }

  if (!nombrados.length) return [];

  const enOrden = nombrados.sort((a, b) => a.donde - b.donde).map((n) => n.producto);

  // Si el mensaje hablaba de una capacidad, solo van los que la tienen:
  // el cliente pidió "los de 8/256", no "algo parecido".
  const conCapacidad = filtrarPorCapacidadDelTexto(enOrden, original);

  return conCapacidad.slice(0, tope);
}

function filtrarPorCapacidadDelTexto(productos, texto) {
  const { capacidades } = separarCapacidad(texto);
  if (!capacidades.length) return productos;

  const quedan = productos.filter((producto) => {
    const { ram, almacenamiento } = leerColumnaCapacidad(producto.capacidad);
    const suyas = [ram, almacenamiento].filter(Boolean);
    if (!suyas.length) return false;

    // Con que coincida el almacenamiento alcanza: el cliente que dice
    // "8/256" está pidiendo los de 256, y la RAM es el acompañante.
    return capacidades.some((pedida) => suyas.includes(pedida));
  });

  // Si el filtro deja la lista vacía, es que la capacidad del texto no
  // casa con lo guardado (una hoja sin esa columna, por ejemplo). Mejor
  // enseñar los que nombró que no enseñar nada.
  return quedan.length ? quedan : productos;
}

function normalizar(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}
