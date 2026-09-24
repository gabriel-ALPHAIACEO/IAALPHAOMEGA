// EL CLIENTE COMPARTIÓ UNA PUBLICACIÓN DEL FEED Y PREGUNTA POR ELLA.
//
// EL FALLO QUE ESTO ARREGLA (visto en producción, 23-sep-2026).
//
// Un cliente ve una publicación en el feed, le da a compartir, la manda por
// el chat y escribe "Feliz noche, precio?". Lo que recibió fue:
//
//     [publicación del SAMSUNG A57 5G]
//     Feliz noche, precio?
//     → "¡Hola! Soy la asistente virtual de EPICELL 👋 ¿Qué equipo estás
//        buscando?"
//     → "¡Hola! Soy la asistente virtual de EPICELL 👋 ¿Qué equipo estás
//        buscando?"
//
// Dos veces la misma bienvenida, y preguntándole qué busca a quien acababa
// de señalarlo con el dedo.
//
// Dos veces la misma bienvenida, y preguntándole qué busca a alguien que
// acababa de señalarlo con el dedo. Dos causas, las dos aquí:
//
//   1. La publicación compartida NO SE LEÍA. instagram.js solo reconocía
//      fotos sueltas y respuestas a historias; un "share" o un "ig_reel"
//      caía en el saco de "texto", y como ese mensaje no lleva texto, al
//      modelo le llegaba la nada. De ahí la bienvenida genérica.
//
//   2. La publicación y la pregunta llegan como DOS webhooks distintos,
//      con uno o dos segundos de diferencia, y se atienden en paralelo. Sin
//      memoria de por medio, cada uno contestaba por su cuenta: de ahí el
//      mensaje repetido. Esa memoria se guarda en D1 (ver estado.js,
//      guardarPublicacion) y quien atiende el texto se encuentra con la
//      publicación puesta y contesta UNA sola vez, por los dos.
//
// Este archivo es la parte de "leer": de lo que manda Meta —o de un enlace
// pegado a mano— saca la imagen que se puede mirar, el pie de foto y, si el
// enlace apunta a la ficha de un producto, su título exacto.

// Cuánto vale una publicación compartida como contexto del mensaje
// siguiente. El cliente comparte y escribe acto seguido: con tres minutos
// sobra. Más que eso sería arrastrar una publicación vieja a una pregunta
// que ya no habla de ella, que es justo el error que historial.js pelea.
export const PUBLICACION_FRESCA_MS = 3 * 60 * 1000;

// Los adjuntos con los que Meta manda una publicación compartida. Cambian
// según sea un post, un reel o un vídeo, y según la versión de la API, así
// que se aceptan todos los nombres que ha usado.
const ADJUNTOS_COMPARTIDOS = new Set([
  "share",
  "media_share",
  "ig_reel",
  "reel",
  "post",
  "story_reply",
]);

// Los dominios donde Meta guarda el archivo de una publicación. Sirve para
// distinguir "esto es una imagen que puedo mirar" de "esto es un enlace a
// una página que tengo que leer": el adjunto "share" se usa para las dos
// cosas.
const ARCHIVO_DE_META = /(cdninstagram|fbcdn|lookaside|scontent)/i;

export function esArchivoDeMeta(url) {
  return ARCHIVO_DE_META.test(String(url || ""));
}

// Lo que viene en el webhook, ya despejado. instagram.js lo llama; se deja
// aquí para que toda la forma de una publicación compartida viva en un solo
// archivo.
export function leerAdjuntoCompartido(adjuntos) {
  const vacio = { url: "", titulo: "", enlace: "" };
  const lista = Array.isArray(adjuntos) ? adjuntos : [];

  const compartido = lista.find((a) =>
    ADJUNTOS_COMPARTIDOS.has(String(a?.type || "").toLowerCase())
  );
  if (!compartido) return vacio;

  const carga = compartido.payload || {};
  const url = String(carga.url || "").trim();

  // El pie de foto solo viene en los reels ("title"), y es oro: muchas
  // veces nombra el producto mejor que la propia imagen.
  const titulo = String(carga.title || carga.description || "").trim();

  // Un enlace de fuera (la ficha de la tienda, otra web) llega por el mismo
  // adjunto "share" que una publicación nuestra. Se separan por el dominio:
  // lo que está en el CDN de Meta es un archivo para mirar, lo demás es una
  // página para leer.
  if (!/^https?:\/\//i.test(url)) return { ...vacio, titulo };

  return esArchivoDeMeta(url)
    ? { url, titulo, enlace: String(carga.permalink_url || carga.link || "").trim() }
    : { url: "", titulo, enlace: url };
}

// Un enlace de Instagram: una publicación, un reel o un perfil. Importa
// porque Instagram no siempre se deja leer desde fuera, y cuando no se
// deja, saber que ERA una publicación nuestra sigue valiendo: el bot le
// pregunta al cliente cuál le gustó en vez de saludarlo como si no hubiera
// mandado nada.
const DE_INSTAGRAM = /^https?:\/\/(?:[a-z0-9-]+\.)?instagram\.com\//i;

export function esEnlaceDeInstagram(url) {
  return DE_INSTAGRAM.test(String(url || "").trim());
}

// El enlace que el cliente pegó a mano en el texto. Es el otro camino por
// el que llega una publicación: en vez de compartirla, copian la dirección
// desde los tres puntos y la mandan escrita.
export function enlaceEnTexto(texto) {
  const encontrado = String(texto || "").match(/https?:\/\/[^\s<>"']+/i);
  if (!encontrado) return "";
  // Un enlace al final de una frase se lleva pegado el punto o el paréntesis.
  return encontrado[0].replace(/[).,;!?]+$/, "");
}

/* ── Nuestro propio feed, por la API de Instagram ─────────────────── */

// LA FORMA FIABLE DE LEER UNA PUBLICACIÓN NUESTRA.
//
// EL PROBLEMA. Cuando el cliente manda el ENLACE de una publicación (o
// cuando Meta manda el permalink en vez del archivo), abrir esa dirección
// desde el Worker casi nunca funciona: Instagram le devuelve un muro de
// inicio de sesión a cualquiera que no sea un navegador con sesión, y de
// ahí no sale ni la foto ni el pie. Raspar etiquetas og: es un intento, no
// una garantía.
//
// LA IDEA. Esa publicación es NUESTRA. No hace falta entrar por la puerta
// de la calle: la API de Instagram nos deja leer nuestro propio feed con el
// mismo token con el que el bot contesta los mensajes. Del enlace se saca
// el código de la publicación, se busca en nuestras últimas publicaciones,
// y de ahí salen el PIE DE FOTO —que casi siempre nombra el equipo con su
// capacidad— y la IMAGEN, que ya se puede mirar.
//
// Si el token no alcanza o la publicación es vieja, no pasa nada: se sigue
// con el camino de las etiquetas og:, y si tampoco, el bot pregunta.
const GRAFO = "https://graph.instagram.com/v23.0";

const CAMPOS = "id,caption,media_url,thumbnail_url,permalink,media_type";

// Cuántas publicaciones se miran hacia atrás. Tres páginas de 50 cubren el
// feed de varios meses, que es de donde sale lo que comparte un cliente.
const PAGINAS = 3;
const POR_PAGINA = 50;

// El feed cambia poco y esto corre en cada enlace que llega: se guarda en
// memoria unos minutos, como el catálogo.
const CACHE_MS = 10 * 60 * 1000;
let cache = { cuando: 0, medios: [] };

// El código que identifica una publicación dentro de su enlace:
// instagram.com/p/CODIGO/ o /reel/CODIGO/.
export function codigoDePublicacion(url) {
  const encontrado = String(url || "").match(
    /instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i
  );
  return encontrado ? encontrado[1] : "";
}

async function nuestrasPublicaciones(env) {
  const ahora = Date.now();
  if (cache.medios.length && ahora - cache.cuando < CACHE_MS) return cache.medios;

  const medios = [];
  let siguiente = `${GRAFO}/me/media?fields=${CAMPOS}&limit=${POR_PAGINA}&access_token=${env.IG_TOKEN}`;

  for (let pagina = 0; pagina < PAGINAS && siguiente; pagina++) {
    let respuesta;
    try {
      respuesta = await fetch(siguiente, { signal: AbortSignal.timeout(ESPERA_MS) });
    } catch (error) {
      console.error("No pude leer nuestro feed:", error?.message || error);
      break;
    }

    if (!respuesta.ok) {
      console.error(
        `La API de Instagram no dio el feed (${respuesta.status}). ` +
          "Con IG_TOKEN sin permiso para leer publicaciones, el bot sigue " +
          "igual: usa las etiquetas de la página y, si no, pregunta."
      );
      break;
    }

    let datos;
    try {
      datos = await respuesta.json();
    } catch {
      break;
    }

    medios.push(...(datos?.data || []));
    siguiente = datos?.paging?.next || "";
  }

  if (medios.length) {
    cache = { cuando: ahora, medios };
    console.log(`Feed propio leído: ${medios.length} publicaciones en memoria`);
  }

  return medios;
}

// Devuelve lo mismo que leerEnlace, para que quien llama no tenga que
// distinguir de dónde salió.
export async function buscarEnNuestroFeed(env, enlace) {
  const codigo = codigoDePublicacion(enlace);
  if (!codigo || !env?.IG_TOKEN) return null;

  const medios = await nuestrasPublicaciones(env);
  const encontrada = medios.find((m) => codigoDePublicacion(m?.permalink) === codigo);

  if (!encontrada) {
    console.log(`La publicación ${codigo} no está en nuestras últimas publicaciones`);
    return null;
  }

  // En un vídeo, "media_url" es el vídeo: lo que se puede mirar es la
  // miniatura.
  const esVideo = String(encontrada.media_type || "").toUpperCase() === "VIDEO";
  const imagen = primeraHttp(
    esVideo ? encontrada.thumbnail_url : encontrada.media_url,
    encontrada.thumbnail_url,
    encontrada.media_url
  );

  const pie = String(encontrada.caption || "").trim();
  console.log(
    `La publicación ${codigo} es nuestra: ${imagen ? "con imagen" : "sin imagen"}, ` +
      `pie: ${JSON.stringify(pie.slice(0, 60))}`
  );

  return { imagen, titulo: pie, descripcion: "", termino: "" };
}

/* ── Leer lo que hay del otro lado del enlace ─────────────────────── */

// No se espera indefinidamente: esto corre mientras el cliente mira la
// pantalla. Si la página no contesta en este tiempo, se sigue sin ella.
const ESPERA_MS = 6000;

// Con la cabecera de una página sobra: las etiquetas og: van en el <head>.
// Leer megas de HTML para sacar tres líneas no tiene sentido.
const MAXIMO_HTML = 300 * 1024;

const NAVEGADOR =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0 Safari/537.36";

// De un enlace a lo que se puede usar para atender al cliente:
//
//   imagen       una foto que el modelo puede mirar (la de la publicación,
//                o la de la ficha del producto)
//   titulo       el título de la página o el pie de la publicación
//   descripcion  el resumen que publica la propia página
//   termino      SOLO cuando el enlace es la ficha de un producto: su
//                título exacto, que es el mejor término de búsqueda que
//                existe — no hay que adivinarlo
//
// Todo es "lo que se pueda": si la página no se deja leer —Instagram lo
// hace a ratos— se devuelve lo que haya y el bot sigue con el texto del
// cliente. Un enlace ilegible no puede dejar al cliente sin respuesta.
export async function leerEnlace(url) {
  const vacio = { imagen: "", titulo: "", descripcion: "", termino: "" };
  const enlace = String(url || "").trim();
  if (!/^https?:\/\//i.test(enlace)) return vacio;

  // La ficha de un producto de Shopify sabe contestar en JSON, y eso es
  // mucho más fiable que raspar el HTML: devuelve el título tal cual está
  // escrito en la tienda, que es exactamente lo que la búsqueda necesita.
  const ficha = await leerFichaDeProducto(enlace);
  if (ficha.termino) return ficha;

  const html = await traerHtml(enlace);
  if (!html) return vacio;

  const etiquetas = etiquetasMeta(html);

  return {
    imagen: primeraHttp(etiquetas["og:image"], etiquetas["twitter:image"]),
    titulo: String(etiquetas["og:title"] || etiquetas["twitter:title"] || "").trim(),
    descripcion: String(
      etiquetas["og:description"] || etiquetas["twitter:description"] || ""
    ).trim(),
    termino: "",
  };
}

// Toda tienda de Shopify sirve la ficha en JSON añadiéndole ".js" a la
// dirección del producto. No hace falta token ni permiso: es lo mismo que
// ve cualquiera que abra la página.
async function leerFichaDeProducto(enlace) {
  const vacio = { imagen: "", titulo: "", descripcion: "", termino: "" };

  let direccion;
  try {
    direccion = new URL(enlace);
  } catch {
    return vacio;
  }

  const handle = (direccion.pathname.match(/\/products\/([^/?#]+)/i) || [])[1];
  if (!handle) return vacio;

  let respuesta;
  try {
    respuesta = await fetch(`${direccion.origin}/products/${handle}.js`, {
      headers: { "user-agent": NAVEGADOR, accept: "application/json" },
      signal: AbortSignal.timeout(ESPERA_MS),
    });
  } catch (error) {
    console.error("No pude leer la ficha del producto:", error?.message || error);
    return vacio;
  }

  if (!respuesta.ok) return vacio;

  let datos;
  try {
    datos = await respuesta.json();
  } catch {
    return vacio;
  }

  const titulo = String(datos?.title || "").trim();
  if (!titulo) return vacio;

  console.log(`El enlace es la ficha de "${titulo}"`);

  return {
    imagen: primeraHttp(datos.featured_image, datos.images?.[0]),
    titulo,
    descripcion: "",
    // El título exacto de la tienda. Se recorta al llegar a la búsqueda:
    // Shopify exige que TODAS las palabras estén en el título, así que
    // mandarle el título entero devuelve cero en cuanto sobre una coma.
    termino: titulo,
  };
}

async function traerHtml(enlace) {
  let respuesta;
  try {
    respuesta = await fetch(enlace, {
      headers: {
        "user-agent": NAVEGADOR,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "es-ES,es;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(ESPERA_MS),
    });
  } catch (error) {
    console.error("No se pudo abrir el enlace:", error?.message || error);
    return "";
  }

  if (!respuesta.ok) {
    console.error(`El enlace respondió ${respuesta.status}: sigo sin él.`);
    return "";
  }

  const tipo = (respuesta.headers.get("content-type") || "").toLowerCase();

  // Si el enlace apunta directo a una imagen, no hay HTML que leer: ya es
  // la imagen. Se devuelve vacío y quien llama usa la URL tal cual.
  if (!tipo.includes("html")) return "";

  const texto = await respuesta.text();
  return texto.length > MAXIMO_HTML ? texto.slice(0, MAXIMO_HTML) : texto;
}

// Las etiquetas <meta> de la cabecera, en un objeto. Se recorren todas de
// una pasada en vez de buscar cada una por separado: el orden de los
// atributos cambia de una web a otra y una expresión regular por etiqueta
// se rompe con la mitad de ellas.
function etiquetasMeta(html) {
  const mapa = {};

  for (const etiqueta of html.match(/<meta\b[^>]*>/gi) || []) {
    const clave = (etiqueta.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const valor = (etiqueta.match(/content\s*=\s*["']([^"']*)["']/i) || [])[1];
    if (clave && valor) mapa[clave.toLowerCase()] = sinEntidades(valor);
  }

  return mapa;
}

function sinEntidades(texto) {
  return String(texto)
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function primeraHttp(...valores) {
  for (const valor of valores) {
    const texto = String(valor || "").trim();
    if (/^https?:\/\//i.test(texto)) return texto;
    // Shopify devuelve las imágenes empezando por "//", sin el protocolo.
    // Así tal cual no se pueden descargar.
    if (texto.startsWith("//")) return `https:${texto}`;
  }
  return "";
}

/* ── Lo que se le dice al modelo ──────────────────────────────────── */

// Cuántas palabras del título se mandan a buscar. Shopify exige que TODAS
// estén en el título del producto, así que el título entero —con sus comas,
// su capacidad y su color— devuelve cero. Las primeras palabras son la
// marca y el modelo, que es lo que identifica el producto.
const PALABRAS_DE_BUSQUEDA = 4;

export function terminoDeTitulo(titulo) {
  return String(titulo || "")
    .replace(/[,|/()]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, PALABRAS_DE_BUSQUEDA)
    .join(" ")
    .trim();
}

// LO QUE SE LE AÑADE AL CONTEXTO DEL MODELO DE TEXTO.
//
// Ojo con la división de trabajo de este bot: el encabezado ("el cliente
// compartió una publicación…") lo pone index.js, junto con lo que la IA de
// visión haya identificado. Lo de aquí es lo que SOLO sabe la publicación:
// su pie de foto y, si el enlace era la ficha de un producto, su nombre
// exacto. Son las dos cosas que muchas veces nombran el equipo mejor que la
// propia imagen.
export function marcaDePublicacion({ titulo, descripcion, termino }) {
  const lineas = [];

  const pie = [titulo, descripcion].filter(Boolean).join(" · ").slice(0, 300);
  if (pie) {
    lineas.push(
      `[TEXTO DE LA PUBLICACIÓN: ${pie}]`,
      "[Si ahí se nombra el equipo, ese nombre vale tanto como si lo hubiera",
      "escrito el cliente: búscalo]"
    );
  }

  if (termino) {
    lineas.push(
      `[LA PUBLICACIÓN ES LA FICHA DE ESTE PRODUCTO: "${termino}". Es el dato`,
      'bueno, sale de la tienda: úsalo tal cual en "buscar"]'
    );
  }

  return lineas.join("\n");
}
