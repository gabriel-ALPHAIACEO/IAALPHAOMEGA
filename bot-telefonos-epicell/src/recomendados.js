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

export function pideVerLoRecomendado(texto) {
  const limpio = String(texto || "").trim();
  if (!limpio) return false;
  return PIDE_VERLOS.test(limpio) || LOS_QUE_DIJISTE.test(limpio);
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
