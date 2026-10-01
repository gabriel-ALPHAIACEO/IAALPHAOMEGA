// EL CATÁLOGO DESDE GOOGLE DRIVE (1-oct-2026).
//
// QUÉ SE PEDÍA. El Emperador todavía no tiene Shopify, pero tiene una
// carpeta de Drive con todos los zapatos: una foto por producto, y debajo
// de cada foto el nombre con su código y el precio. Mientras se arma la
// tienda, el bot tiene que vender con ESO: buscar, enseñar las fichas con
// su foto y su precio, cotejar las fotos de los clientes e indexar.
//
// CÓMO. Este archivo lee la carpeta con la API de Google Drive y devuelve
// los productos con LA MISMA FORMA que shopify.js —{ titulo, precio,
// imagen, url }—, así que el resto del bot no se entera de dónde vienen.
// shopify.js le pasa la pelota cuando en wrangler.toml dice
// CATALOGO = "drive".
//
// LO QUE HAY QUE TENER:
//   · DRIVE_CARPETA   el enlace (o el id) de la carpeta, compartida como
//                     "Cualquier persona con el enlace — Lector".
//   · NADA MÁS. Sin clave, el bot lee la carpeta pública tal como la ve
//     cualquiera con el enlace (la vista "embebida" de Drive).
//   · DRIVE_API_KEY es OPCIONAL: si algún día se carga una clave con la API
//     de Drive activada, se usa primero (trae además la descripción de cada
//     foto), y si falla se vuelve a la carpeta pública.
//
// SOLO DRIVE_API_KEY (1-oct-2026). Se probó con una clave de IA y Google la
// rechazó para Drive ("API keys are not supported by this API", 401), así
// que ninguna otra clave se intenta.
//
// DE DÓNDE SALEN EL NOMBRE, EL CÓDIGO Y EL PRECIO. De lo que se ve debajo
// de cada foto en Drive: el NOMBRE DEL ARCHIVO. Si el archivo tiene además
// una DESCRIPCIÓN (Drive → clic derecho → Información del archivo) y esa
// trae el precio, manda la descripción. Ejemplos que entiende:
//
//   "Nike Air Force One blanco COD 125 45$.jpg"
//   "AIR MAX 90 - Cód: AM90 - $55"
//   "Jordan 4 negro #J4N 60 USD"
//   "Campus gris_precio 40.jpeg"
//
// Lo que no se pueda leer no se inventa: sin precio, la ficha sale sin
// precio (y el bot lo manda al asesor si se lo preguntan).

const API = "https://www.googleapis.com/drive/v3/files";
const CARPETA_MIME = "application/vnd.google-apps.folder";

// Cuánto se recuerda la carpeta. Releerla en cada mensaje es lento y gasta
// cupo de Google; diez minutos de retraso para un producto nuevo no.
const MINUTOS_DE_CACHE = 10;

// Hasta cuántos niveles de subcarpetas se entra ("Nike" → "Air Force").
// La carpeta de El Emperador va así (1-oct-2026):
//   CATALOGO › CNTND 1 (30/6/26) › CALZADOS › (marca…) › fotos
// Cinco niveles dejan sitio a una subcarpeta más por si acaso.
const PROFUNDIDAD = 5;

// LAS CATEGORÍAS. Cada foto pertenece a la primera carpeta de su ruta que no
// sea un "contenedor" (las de lote, como "CNTND 1 (30/6/26)": un envío de
// mercancía, no una categoría). Así "CALZADOS", "GORRAS", "BOLSOS" quedan
// como categoría aunque el día de mañana haya un "CNTND 2".
const ES_CONTENEDOR = /\bcntnd\b|\bcontenedor|\blote\b|\(\s*\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s*\)|^\d+$/i;

export function categoriaDeLaRuta(ruta = []) {
  const nombre = ruta.find((c) => !ES_CONTENEDOR.test(String(c).trim()));
  return nombre ? String(nombre).trim() : "";
}

let cache = null;

export function usaDrive(env) {
  return String(env.CATALOGO || "").toLowerCase() === "drive";
}

// "https://drive.google.com/drive/folders/1AbC...?usp=sharing" → "1AbC..."
export function idDeCarpeta(valor) {
  const texto = String(valor || "").trim();
  const enUrl = texto.match(/folders\/([\w-]{10,})/) || texto.match(/[?&]id=([\w-]{10,})/);
  if (enUrl) return enUrl[1];
  return /^[\w-]{10,}$/.test(texto) ? texto : "";
}

function claveDeDrive(env) {
  return env.DRIVE_API_KEY || "";
}

/* ── Leer el nombre: título, código y precio ─────────────────────── */

const EXTENSION = /\.(jpe?g|png|webp|heic|heif|gif|avif)$/i;

const PRECIO = [
  /(?:\$|usd)\s*(\d{1,4}(?:[.,]\d{1,2})?)/i, //          "$45", "USD 45"
  /(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:\$|usd\b|d[oó]lares?\b|verdes\b)/i, // "45$", "45 USD"
  /\bprecio\s*[:=\-]?\s*(\d{1,4}(?:[.,]\d{1,2})?)/i, //   "precio 45", "precio: 45"
];

const CODIGO = [
  /\b(?:c[oó]d(?:igo)?|ref(?:erencia)?|art(?:[ií]culo)?)\.?\s*[:#\-]?\s*([a-z0-9][a-z0-9\-]{0,14})\b/i,
  /#\s*([a-z0-9][a-z0-9\-]{0,14})\b/i,
];

export function leerNombre(texto) {
  let resto = String(texto || "").replace(EXTENSION, "").replace(/_/g, " ").replace(/\s+/g, " ").trim();
  if (!resto) return { titulo: "", codigo: "", precio: "" };

  let precio = "";
  for (const patron of PRECIO) {
    const m = resto.match(patron);
    if (m) {
      precio = m[1].replace(",", ".");
      resto = resto.replace(m[0], " ");
      break;
    }
  }

  let codigo = "";
  for (const patron of CODIGO) {
    const m = resto.match(patron);
    if (m) {
      codigo = m[1].toUpperCase();
      resto = resto.replace(m[0], " ");
      break;
    }
  }

  const titulo = resto
    .replace(/\s*[|•·]\s*/g, " ")
    .replace(/\s+-\s+/g, " ")
    .replace(/^[\s\-:,.]+|[\s\-:,.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return { titulo, codigo, precio: precio ? `${Number(precio)} USD` : "" };
}

/* ── Leer la carpeta ─────────────────────────────────────────────── */

async function listar(env, carpeta, clave) {
  const archivos = [];
  let pagina = "";

  for (let vuelta = 0; vuelta < 20; vuelta++) {
    const params = new URLSearchParams({
      q: `'${carpeta}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, description, mimeType)",
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      key: clave,
    });
    if (pagina) params.set("pageToken", pagina);

    let respuesta;
    try {
      respuesta = await fetch(`${API}?${params}`);
    } catch (error) {
      throw new Error(`no se pudo conectar con Google Drive: ${error?.message || error}`);
    }

    if (!respuesta.ok) {
      const detalle = await respuesta.text();
      throw new Error(explicarError(respuesta.status, detalle));
    }

    const datos = await respuesta.json();
    archivos.push(...(datos.files || []));
    pagina = datos.nextPageToken || "";
    if (!pagina) break;
  }

  return archivos;
}

// Lo que dice Google, en palabras que el dueño pueda arreglar.
function explicarError(estado, detalle) {
  if (/API has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(detalle)) {
    return (
      "la API de Google Drive no está activada en el proyecto de esa clave. " +
      "Actívala en console.cloud.google.com → APIs y servicios → Biblioteca → " +
      "Google Drive API → Habilitar."
    );
  }
  if (/API keys are not supported|UNAUTHENTICATED/i.test(detalle)) {
    return "esa clave no sirve para Google Drive (tiene que ser una clave con la Google Drive API).";
  }
  if (/API key not valid|API_KEY_INVALID/i.test(detalle)) return "la clave de Google no es válida (DRIVE_API_KEY).";
  if (/API_KEY_SERVICE_BLOCKED|blocked/i.test(detalle)) {
    return "esa clave está restringida a otras APIs. Usa una clave con Google Drive API permitida (DRIVE_API_KEY).";
  }
  if (estado === 404 || /File not found/i.test(detalle)) {
    return "no encuentro la carpeta. Revisa DRIVE_CARPETA y que esté compartida como 'Cualquier persona con el enlace'.";
  }
  return `Google Drive respondió ${estado}: ${detalle.slice(0, 200)}`;
}

function aProducto(archivo, carpetas) {
  const delNombre = leerNombre(archivo.name);
  const deLaDescripcion = leerNombre(archivo.description || "");
  // La descripción manda si trae el precio: es donde se escribe a mano "el
  // pie de foto" con más detalle. Si no, el nombre del archivo.
  const datos = deLaDescripcion.precio ? deLaDescripcion : delNombre;
  const titulo = datos.titulo || delNombre.titulo;

  return {
    titulo: datos.codigo ? `${titulo} · Cód. ${datos.codigo}` : titulo,
    precio: datos.precio || delNombre.precio,
    // La imagen directa, servida por Google: Instagram y la IA la bajan sin
    // pasar por la página de Drive. urlPequena() la pide a 512 para el cotejo.
    imagen: `https://lh3.googleusercontent.com/d/${archivo.id}=w1000`,
    url: `https://drive.google.com/file/d/${archivo.id}/view`,
    codigo: datos.codigo,
    // El nombre del archivo tal cual, para /probar-drive.
    nombre: archivo.name,
    // Las carpetas ("Nike", "Dama") también se buscan, aunque no salgan en
    // el título: "Nike" encuentra lo que está en la carpeta Nike.
    carpetas: carpetas.join(" "),
    categoria: categoriaDeLaRuta(carpetas),
  };
}

/* ── Sin clave: la carpeta pública, como la ve cualquiera ─────────── */

const PAGINA = "https://drive.google.com/embeddedfolderview";

// Lo que no es una foto, por la extensión del nombre. Un nombre SIN
// extensión se toma como foto: en una carpeta de catálogo casi todo lo es.
const NO_ES_FOTO = /\.(pdf|docx?|xlsx?|pptx?|txt|csv|zip|rar|mp4|mov|avi|mkv|mp3|wav|apk|exe)$/i;

function sinEntidades(texto) {
  return String(texto || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

// La página trae una "flip-entry" por archivo:
//   <div class="flip-entry" id="entry-ID"> … <a href=".../file/d/ID/view">
//   … <div class="flip-entry-title">Nombre.jpg</div>
// Las subcarpetas enlazan a /folders/ID.
export function leerPaginaDeCarpeta(html) {
  const texto = String(html || "");
  const marcas = [...texto.matchAll(/id="entry-([\w-]{10,})"/g)];
  const archivos = [];
  marcas.forEach((m, i) => {
    const trozo = texto.slice(m.index, i + 1 < marcas.length ? marcas[i + 1].index : undefined);
    const nombre = sinEntidades((trozo.match(/class="flip-entry-title"[^>]*>([^<]*)</) || [])[1] || "").trim();
    const enlace = (trozo.match(/href="([^"]+)"/) || [])[1] || "";
    const esCarpeta = /\/folders\//.test(enlace) || /flip-entry-folder|folder-icon/.test(trozo);
    if (!nombre) return;
    if (esCarpeta) archivos.push({ id: m[1], name: nombre, mimeType: CARPETA_MIME });
    else if (!NO_ES_FOTO.test(nombre)) archivos.push({ id: m[1], name: nombre, mimeType: "image/*" });
  });
  return archivos;
}

async function listarPublica(carpeta) {
  let respuesta;
  try {
    respuesta = await fetch(`${PAGINA}?id=${encodeURIComponent(carpeta)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; emperador-bot)", "Accept-Language": "es" },
    });
  } catch (error) {
    throw new Error(`no se pudo conectar con Google Drive: ${error?.message || error}`);
  }
  const html = await respuesta.text();
  const archivos = leerPaginaDeCarpeta(html);
  if (archivos.length) return archivos;

  // Vacía de verdad, o Google no la enseña (privada, o pide iniciar sesión).
  if (respuesta.ok && /flip-entries|flip-view/.test(html)) return [];
  if (respuesta.status === 404 || /accounts\.google\.com|ServiceLogin|signin/i.test(html)) {
    throw new Error(
      "Google no deja ver la carpeta sin iniciar sesión. En Drive: clic derecho en la carpeta → " +
        "Compartir → Acceso general → \"Cualquier persona con el enlace\" → Lector."
    );
  }
  const tituloDePagina = sinEntidades((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || "").trim();
  throw new Error(
    `no entendí la página de la carpeta (Google respondió ${respuesta.status}` +
      (tituloDePagina ? `, "${tituloDePagina.slice(0, 80)}"` : "") +
      `). Mándale a Claude una captura de esto.`
  );
}

// Las subcarpetas de un mismo nivel se leen A LA VEZ, de 6 en 6 (lo que
// Cloudflare deja abrir junto). Una por una, una carpeta con muchas marcas
// tardaba tanto que el primer mensaje del día se iba a 20 segundos.
const A_LA_VEZ = 6;

async function recorrer(carpeta, listarUna) {
  const productos = [];
  let nivelActual = [{ id: carpeta, ruta: [], nivel: 0 }];
  while (nivelActual.length) {
    const siguiente = [];
    for (let i = 0; i < nivelActual.length; i += A_LA_VEZ) {
      const tanda = nivelActual.slice(i, i + A_LA_VEZ);
      const listas = await Promise.all(tanda.map((c) => listarUna(c.id)));
      listas.forEach((lista, j) => {
        const { ruta, nivel } = tanda[j];
        for (const archivo of lista) {
          if (archivo.mimeType === CARPETA_MIME) {
            if (nivel < PROFUNDIDAD) siguiente.push({ id: archivo.id, ruta: [...ruta, archivo.name], nivel: nivel + 1 });
            continue;
          }
          if (!/^image\//.test(archivo.mimeType || "")) continue;
          const producto = aProducto(archivo, ruta);
          if (producto.titulo) productos.push(producto);
        }
      });
    }
    nivelActual = siguiente;
  }
  return productos;
}

export async function catalogoDeDrive(env) {
  const carpeta = idDeCarpeta(env.DRIVE_CARPETA);
  if (!carpeta) return { productos: [], error: "falta DRIVE_CARPETA en wrangler.toml (el enlace de la carpeta).", via: "" };

  if (cache && cache.carpeta === carpeta && cache.vence > Date.now()) return cache.datos;

  const clave = claveDeDrive(env);
  let productos = null;
  let via = "";
  let aviso = "";

  if (clave) {
    try {
      productos = await recorrer(carpeta, (id) => listar(env, id, clave));
      via = "API de Google Drive (DRIVE_API_KEY)";
    } catch (error) {
      aviso = `la DRIVE_API_KEY falló (${error.message}); se leyó la carpeta pública.`;
      console.error("Catálogo de Drive, con clave:", error.message);
    }
  }

  if (!productos) {
    try {
      productos = await recorrer(carpeta, listarPublica);
      via = "carpeta pública (sin clave)";
    } catch (error) {
      console.error("Catálogo de Drive:", error.message);
      const fallo = { productos: [], error: aviso ? `${error.message} (Antes: ${aviso})` : error.message, via: "" };
      // Un fallo se recuerda UN minuto: si no, cada mensaje volvería a
      // recorrer todas las carpetas para fallar otra vez, y el cliente
      // esperaría por nada.
      cache = { carpeta, vence: Date.now() + 60 * 1000, datos: fallo };
      return fallo;
    }
  }

  const datos = { productos, error: "", via, aviso };
  cache = { carpeta, vence: Date.now() + MINUTOS_DE_CACHE * 60 * 1000, datos };
  console.log(`Catálogo de Drive: ${productos.length} productos (${via})`);
  return datos;
}

/* ── Lo mismo que shopify.js, para que nadie más se entere ───────── */

function despejar(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// LAS MISMAS ZAPATILLAS CON OTRO NOMBRE. El prompt (heredado de Invictus,
// donde Shopify las llama "Retro") busca "Retro 4" cuando el cliente pide
// "jordan 4"; en la carpeta de Drive pueden llamarse "Jordan 4". Pasó el
// 1-oct: "tienes jordan?" → buscó "Retro" → 0. Ahora una vale por la otra.
//
// Y las CATEGORÍAS con las palabras de la gente: "zapatos" o "tenis" son lo
// que en la carpeta se llama CALZADOS; "camisas", FRANELAS.
const SINONIMOS = {
  retro: ["retro", "jordan"],
  jordan: ["jordan", "retro"],
  zapato: ["zapato", "calzado"],
  zapatos: ["zapato", "calzado"],
  tenis: ["tenis", "calzado"],
  zapatilla: ["zapatilla", "calzado"],
  zapatillas: ["zapatilla", "calzado"],
  calzado: ["calzado"],
  camisa: ["camisa", "franela"],
  camisas: ["camisa", "franela"],
  camiseta: ["camiseta", "franela"],
  camisetas: ["camiseta", "franela"],
  franela: ["franela"],
  cartera: ["cartera", "bolso"],
  carteras: ["cartera", "bolso"],
  morral: ["morral", "bolso"],
  morrales: ["morral", "bolso"],
  gorro: ["gorro", "gorra"],
  gorros: ["gorro", "gorra"],
  pantalon: ["pantalon"],
  jean: ["jean", "pantalon"],
  jeans: ["jean", "pantalon"],
  bermuda: ["bermuda", "short"],
  bermudas: ["bermuda", "short"],
};

// La palabra, sus sinónimos, y su singular ("shorts" → "short", "bolsos" →
// "bolso"): el cliente escribe en plural y la carpeta puede estar en singular.
function alternativas(p) {
  const todas = new Set([p, ...(SINONIMOS[p] || [])]);
  if (/[^s]s$/.test(p) && p.length > 4) todas.add(p.slice(0, -1));
  if (/[^aeiou]es$/.test(p) && p.length > 5) todas.add(p.slice(0, -2));
  return [...todas];
}

function estaLaPalabra(donde, p) {
  return p.length <= 3 || /^\d+$/.test(p)
    ? new RegExp(`(^|[^a-z0-9])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(donde)
    : donde.includes(p);
}

// Todas las palabras tienen que estar (como en Shopify). Las cortas y los
// números, como palabra completa: "4" no puede encontrar "40".
function coincide(producto, palabras) {
  const donde = despejar(`${producto.titulo} ${producto.codigo} ${producto.carpetas}`);
  return palabras.every((p) => alternativas(p).some((alt) => estaLaPalabra(donde, alt)));
}

export async function buscarEnDrive(env, termino, cuantos = 10) {
  const palabras = despejar(termino).split(/\s+/).filter(Boolean).slice(0, 5);
  if (!palabras.length) return { productos: [], hayMas: false };

  const { productos } = await catalogoDeDrive(env);
  const encontrados = productos.filter((p) => coincide(p, palabras)).map(sinInternos);
  return { productos: encontrados.slice(0, cuantos), hayMas: encontrados.length > cuantos };
}

export async function catalogoCompletoDeDrive(env, maximo = 1000) {
  const { productos } = await catalogoDeDrive(env);
  return { productos: productos.slice(0, maximo).map(sinInternos), completo: productos.length <= maximo };
}

// Los títulos, uno por línea, para el prompt (lo que en Shopify es
// prompts/catalogo.txt). Sin repetir.
// Agrupados por categoría, para que la IA sepa qué es cada cosa: no es lo
// mismo "Nike blanco" en CALZADOS que en GORRAS.
export async function titulosDeDrive(env) {
  const { productos } = await catalogoDeDrive(env);
  const grupos = new Map();
  for (const p of productos) {
    const cat = p.categoria || "OTROS";
    if (!grupos.has(cat)) grupos.set(cat, new Set());
    grupos.get(cat).add(p.titulo);
  }
  if (grupos.size === 1 && grupos.has("OTROS")) return [...grupos.get("OTROS")].join("\n");
  return [...grupos.entries()].map(([cat, titulos]) => `${cat}:\n${[...titulos].join("\n")}`).join("\n\n");
}

// Las categorías que hay, con cuántos productos cada una.
export async function categoriasDeDrive(env) {
  const { productos } = await catalogoDeDrive(env);
  const cuenta = new Map();
  for (const p of productos) if (p.categoria) cuenta.set(p.categoria, (cuenta.get(p.categoria) || 0) + 1);
  return [...cuenta.entries()].map(([nombre, cuantos]) => ({ nombre, cuantos }));
}

function sinInternos({ titulo, precio, imagen, url }) {
  return { titulo, precio, imagen, url };
}

// Solo para las pruebas: olvidar lo leído.
export function olvidarCatalogoDeDrive() {
  cache = null;
}
