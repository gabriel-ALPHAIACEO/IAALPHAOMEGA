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
//   · una clave de Google con la API de Drive activada: DRIVE_API_KEY, o
//     la misma GEMINI_API_KEY si en su proyecto de Google se activa Drive.
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
const PROFUNDIDAD = 3;

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
  return env.DRIVE_API_KEY || env.GEMINI_API_KEY || "";
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
    // Las carpetas ("Nike", "Dama") también se buscan, aunque no salgan en
    // el título: "Nike" encuentra lo que está en la carpeta Nike.
    carpetas: carpetas.join(" "),
  };
}

export async function catalogoDeDrive(env) {
  const carpeta = idDeCarpeta(env.DRIVE_CARPETA);
  if (!carpeta) return { productos: [], error: "falta DRIVE_CARPETA en wrangler.toml (el enlace de la carpeta)." };
  const clave = claveDeDrive(env);
  if (!clave) return { productos: [], error: "falta la clave de Google: carga DRIVE_API_KEY con wrangler secret put." };

  if (cache && cache.carpeta === carpeta && cache.vence > Date.now()) return cache.datos;

  const productos = [];
  try {
    const pendientes = [{ id: carpeta, ruta: [], nivel: 0 }];
    while (pendientes.length) {
      const { id, ruta, nivel } = pendientes.shift();
      for (const archivo of await listar(env, id, clave)) {
        if (archivo.mimeType === CARPETA_MIME) {
          if (nivel < PROFUNDIDAD) pendientes.push({ id: archivo.id, ruta: [...ruta, archivo.name], nivel: nivel + 1 });
          continue;
        }
        if (!/^image\//.test(archivo.mimeType || "")) continue;
        const producto = aProducto(archivo, ruta);
        if (producto.titulo) productos.push(producto);
      }
    }
  } catch (error) {
    console.error("Catálogo de Drive:", error.message);
    return { productos: [], error: error.message };
  }

  const datos = { productos, error: "" };
  cache = { carpeta, vence: Date.now() + MINUTOS_DE_CACHE * 60 * 1000, datos };
  console.log(`Catálogo de Drive: ${productos.length} productos`);
  return datos;
}

/* ── Lo mismo que shopify.js, para que nadie más se entere ───────── */

function despejar(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// Todas las palabras tienen que estar (como en Shopify). Las cortas y los
// números, como palabra completa: "4" no puede encontrar "40".
function coincide(producto, palabras) {
  const donde = despejar(`${producto.titulo} ${producto.codigo} ${producto.carpetas}`);
  return palabras.every((p) =>
    p.length <= 3 || /^\d+$/.test(p)
      ? new RegExp(`(^|[^a-z0-9])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(donde)
      : donde.includes(p)
  );
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
export async function titulosDeDrive(env) {
  const { productos } = await catalogoDeDrive(env);
  return [...new Set(productos.map((p) => p.titulo))].join("\n");
}

function sinInternos({ titulo, precio, imagen, url }) {
  return { titulo, precio, imagen, url };
}

// Solo para las pruebas: olvidar lo leído.
export function olvidarCatalogoDeDrive() {
  cache = null;
}
