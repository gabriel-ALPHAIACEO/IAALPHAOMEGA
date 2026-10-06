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

import { quedan as quedanConexiones } from "./presupuesto.js";
import { categoriaDelTipo, categoriaDeCarpeta } from "./categorias.js";

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

// "$. 60" o "USD . 60" (con un punto o dos puntos en medio) también es
// precio. Y en "45$" el número no puede venir pegado a un guion: en
// "Tallas 40-45 $. 60" el 45 es la talla, no el precio (caso real, 5-oct-2026:
// salía "$45" y el título "Tallas 40- . 60").
const PRECIO = [
  /(?:\$|usd\b)[\s.:]*(\d{1,4}(?:[.,]\d{1,2})?)/i, //   "$45", "USD 45", "$. 60"
  /(?<![\d\-])(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:\$|usd\b|d[oó]lares?\b|verdes\b)/i, // "45$", "45 USD"
  /\bprecio\s*[:=\-]?\s*(\d{1,4}(?:[.,]\d{1,2})?)/i, //   "precio 45", "precio: 45"
];

// EL NÚMERO DEL FINAL ES EL PRECIO (5-oct-2026, pedido del dueño): en
// "Nike Air Force 1 blanco 45" el 45 es el precio aunque no lleve "$".
// Excepto cuando ese número es parte del MODELO: va justo después de una de
// estas palabras ("Jordan 4", "Air Max 90", "New Balance 530") o de "talla".
// Los de cuatro cifras (años, "9060") tampoco: ningún precio llega a eso.
const ANTES_DE_UN_MODELO = new Set([
  "force", "jordan", "retro", "max", "airmax", "yeezy", "boost", "balance", "nb",
  "forum", "levis", "levi's", "pegasus", "kayano", "gel", "cloud", "vomero",
  "lebron", "kd", "kobe", "zoom", "talla", "tallas", "size", "numero", "número", "n°", "no",
]);
const PRECIO_MINIMO_SUELTO = 5;

function precioAlFinal(resto) {
  const m = resto.match(/(?:^|\s)(\d{1,3}(?:[.,]\d{1,2})?)\s*$/);
  if (!m) return null;
  const antes = resto.slice(0, m.index).trim();
  const palabraAnterior = (antes.split(/\s+/).pop() || "").toLowerCase();
  if (!antes || ANTES_DE_UN_MODELO.has(palabraAnterior)) return null;
  if (Number(m[1].replace(",", ".")) < PRECIO_MINIMO_SUELTO) return null;
  return m;
}

// El precio como lo ve el cliente debajo de la foto: "$45", "$45.50".
export function conSimboloDeDolar(cifra) {
  const n = Number(cifra);
  if (!Number.isFinite(n) || n <= 0) return "";
  return `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
}

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
  // Sin "$" ni "precio": el número del final (ver precioAlFinal). Se mira
  // DESPUÉS de quitar el código, para que "COD 125" no cuente como precio.
  let codigo = "";
  for (const patron of CODIGO) {
    const m = resto.match(patron);
    if (m) {
      codigo = m[1].toUpperCase();
      resto = resto.replace(m[0], " ");
      break;
    }
  }
  resto = resto.replace(/\s+/g, " ").trim();
  if (!precio) {
    const m = precioAlFinal(resto);
    if (m) {
      precio = m[1].replace(",", ".");
      resto = resto.slice(0, m.index);
    }
  }

  const titulo = resto
    // Lo que queda de "(COD ACG)" después de sacar el código: "( )".
    .replace(/[(\[]\s*[)\]]/g, " ")
    .replace(/\s*[|•·]\s*/g, " ")
    .replace(/\s+-\s+/g, " ")
    .replace(/^[\s\-:,.]+|[\s\-:,.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return { titulo, codigo, precio: conSimboloDeDolar(precio) };
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
    // La ruta tal cual (["CALZADOS", "DEPORTIVOS", "NIKE", "AIR FORCE ONE"]):
    // de aquí sale la lista de modelos de la tienda (ver modelosDeDrive).
    ruta: carpetas,
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

/* ── La carpeta, leída POR PARTES y guardada en D1 (1-oct-2026) ──────

   QUÉ PASÓ. "/probar-drive: no se pudo conectar con Google Drive: Too many
   subrequests". Leer la carpeta pública cuesta UNA conexión por subcarpeta,
   y la de El Emperador (CATALOGO › CNTND › CALZADOS › marcas…) tiene más
   subcarpetas que las 50 conexiones que Cloudflare deja por pasada. Leerla
   entera de una vez ya no era posible, y con eso el bot se quedaba sin
   catálogo — y cada mensaje de un cliente lo volvía a intentar.

   AHORA:
     · La carpeta se lee POR PARTES: unas pocas subcarpetas por pasada,
       las que quepan en las conexiones libres (ver presupuesto.js). Lo
       leído se guarda en D1, en UNA sola fila (un JSON con el árbol), así
       que guardar cuesta una consulta, no una por foto.
     · El cron sigue leyendo en cada pasada hasta tenerla entera, y después
       la va refrescando de a poco (cada carpeta, cada REFRESCO_HORAS).
     · Los mensajes de los clientes leen el catálogo DE D1: cero conexiones
       a Drive. Solo si todavía no hay nada guardado se lee un trozo.
     · /probar-drive enseña cuánto lleva leído y, cada vez que se abre, lee
       otro trozo.
   ─────────────────────────────────────────────────────────────────────── */

const REFRESCO_HORAS = 2;
// Subcarpetas que se leen como mucho en una pasada (si caben).
const CARPETAS_POR_PASADA = 30;
// Lo que se deja libre para el resto de la pasada (contestar, indexar…).
const RESERVA_DRIVE = 10;

const TABLA_DRIVE = `
  CREATE TABLE IF NOT EXISTS drive_estado (
    raiz TEXT PRIMARY KEY,
    arbol TEXT NOT NULL,
    actualizado INTEGER NOT NULL
  )`;
let tablaDriveLista = false;

async function leerArbol(db, raiz) {
  if (!tablaDriveLista) {
    await db.prepare(TABLA_DRIVE).run();
    tablaDriveLista = true;
  }
  const fila = await db.prepare("SELECT arbol FROM drive_estado WHERE raiz = ?").bind(raiz).first();
  if (fila?.arbol) {
    try {
      return JSON.parse(fila.arbol);
    } catch {}
  }
  return { carpetas: { [raiz]: { ruta: [], nivel: 0, leida: 0, fotos: [], hijas: [] } } };
}

async function guardarArbol(db, raiz, arbol) {
  await db
    .prepare(
      "INSERT INTO drive_estado (raiz, arbol, actualizado) VALUES (?, ?, ?) " +
        "ON CONFLICT(raiz) DO UPDATE SET arbol = excluded.arbol, actualizado = excluded.actualizado"
    )
    .bind(raiz, JSON.stringify(arbol), Date.now())
    .run();
}

// Quita una carpeta que ya no está en Drive, con todo lo que tenía dentro.
function quitarRama(arbol, id) {
  const c = arbol.carpetas[id];
  if (!c) return;
  for (const h of c.hijas || []) quitarRama(arbol, h);
  delete arbol.carpetas[id];
}

function progreso(arbol) {
  const todas = Object.values(arbol.carpetas);
  return { leidas: todas.filter((c) => c.leida).length, total: todas.length };
}

function productosDelArbol(arbol) {
  const productos = [];
  for (const c of Object.values(arbol.carpetas)) {
    for (const f of c.fotos || []) {
      const p = aProducto({ id: f.id, name: f.n, description: f.d || "" }, c.ruta || []);
      if (p.titulo) productos.push(p);
    }
  }
  return productos;
}

// Lee un trozo de la carpeta (lo que quepa) y lo guarda. Devuelve cuántas
// subcarpetas leyó y cómo va.
export async function leerUnTrozoDeDrive(env, { maximo = CARPETAS_POR_PASADA, soloNuevas = false } = {}) {
  const raiz = idDeCarpeta(env.DRIVE_CARPETA);
  if (!raiz || !env.DB) return { leidas: 0, error: raiz ? "" : "falta DRIVE_CARPETA" };

  const arbol = await leerArbol(env.DB, raiz);
  const vieja = Date.now() - REFRESCO_HORAS * 3600 * 1000;
  const porLeer = () =>
    Object.entries(arbol.carpetas)
      .filter(([, c]) => !c.leida || (!soloNuevas && c.leida < vieja))
      .sort(([, a], [, b]) => (a.leida ? 1 : 0) - (b.leida ? 1 : 0) || a.nivel - b.nivel || (a.leida || 0) - (b.leida || 0));

  const clave = claveDeDrive(env);
  const listarUna = async (id) => {
    if (clave) {
      try {
        return { lista: await listar(env, id, clave), via: "API de Google Drive (DRIVE_API_KEY)" };
      } catch (error) {
        console.error("Drive con clave falló, sigo con la carpeta pública:", error.message);
      }
    }
    return { lista: await listarPublica(id), via: "carpeta pública (sin clave)" };
  };

  let leidas = 0;
  let error = "";
  let via = "";
  const intentadas = new Set();
  // Se repite: al leer una carpeta aparecen sus subcarpetas, y si quedan
  // conexiones se leen en la misma pasada.
  for (;;) {
    const libres = Math.max(0, quedanConexiones() - RESERVA_DRIVE);
    const cupo = Math.min(maximo - intentadas.size, libres, A_LA_VEZ);
    const grupo = porLeer().filter(([id]) => !intentadas.has(id)).slice(0, cupo);
    if (!grupo.length) break;
    grupo.forEach(([id]) => intentadas.add(id));
    const resultados = await Promise.allSettled(grupo.map(([id]) => listarUna(id)));
    resultados.forEach((r, j) => {
      const [id, c] = grupo[j];
      if (r.status !== "fulfilled") {
        error = r.reason?.message || String(r.reason);
        return;
      }
      via = r.value.via;
      const lista = r.value.lista;
      const hijasAhora = [];
      c.fotos = [];
      for (const a of lista) {
        if (a.mimeType === CARPETA_MIME) {
          if (c.nivel >= PROFUNDIDAD) continue;
          hijasAhora.push(a.id);
          const ruta = [...(c.ruta || []), a.name];
          const ya = arbol.carpetas[a.id];
          arbol.carpetas[a.id] = ya ? { ...ya, ruta, nivel: c.nivel + 1 } : { ruta, nivel: c.nivel + 1, leida: 0, fotos: [], hijas: [] };
          continue;
        }
        if (!/^image\//.test(a.mimeType || "")) continue;
        c.fotos.push({ id: a.id, n: a.name, ...(a.description ? { d: a.description } : {}) });
      }
      for (const vieja of c.hijas || []) if (!hijasAhora.includes(vieja)) quitarRama(arbol, vieja);
      c.hijas = hijasAhora;
      c.leida = Date.now();
      arbol.carpetas[id] = c;
      leidas++;
    });
  }

  if (!intentadas.size) {
    const p = progreso(arbol);
    return { leidas: 0, carpetasLeidas: p.leidas, total: p.total, error: "" };
  }

  if (via) arbol.via = via;
  if (error) arbol.error = error;
  else delete arbol.error;
  await guardarArbol(env.DB, raiz, arbol);
  cache = null;
  const p = progreso(arbol);
  console.log(`Drive: leí ${leidas} carpeta(s); van ${p.leidas} de ${p.total}`);
  return { leidas, carpetasLeidas: p.leidas, total: p.total, error };
}

export async function catalogoDeDrive(env) {
  const carpeta = idDeCarpeta(env.DRIVE_CARPETA);
  if (!carpeta) return { productos: [], error: "falta DRIVE_CARPETA en wrangler.toml (el enlace de la carpeta).", via: "" };

  if (cache && cache.carpeta === carpeta && cache.vence > Date.now()) return cache.datos;

  // CON BASE DE DATOS (lo normal): el catálogo sale de D1, ya leído por
  // partes. Solo si todavía no hay NADA leído, se lee un trozo ahora.
  if (env.DB) {
    let arbol = await leerArbol(env.DB, carpeta);
    if (!progreso(arbol).leidas) {
      await leerUnTrozoDeDrive(env, { soloNuevas: true });
      arbol = await leerArbol(env.DB, carpeta);
    }
    const p = progreso(arbol);
    const productos = productosDelArbol(arbol);
    const datos = {
      productos,
      error: !p.leidas && arbol.error ? arbol.error : "",
      via: arbol.via || "",
      aviso: p.leidas < p.total ? `todavía leyendo la carpeta: ${p.leidas} de ${p.total} subcarpetas (el cron sigue solo)` : "",
      carpetasLeidas: p.leidas,
      carpetasTotal: p.total,
    };
    // Un minuto en memoria: suficiente para que una conversación no lea D1
    // en cada paso, y corto para que lo nuevo del cron aparezca enseguida.
    cache = { carpeta, vence: Date.now() + 60 * 1000, datos };
    return datos;
  }

  // SIN BASE DE DATOS (pruebas sueltas): la carpeta entera, de una vez.
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
      cache = { carpeta, vence: Date.now() + 60 * 1000, datos: fallo };
      return fallo;
    }
  }

  const datos = { productos, error: "", via, aviso };
  cache = { carpeta, vence: Date.now() + MINUTOS_DE_CACHE * 60 * 1000, datos };
  console.log(`Catálogo de Drive: ${productos.length} productos (${via})`);
  return datos;
}

/* ── Qué TIPO de producto es cada foto (2-oct-2026) ─────────────────
   El Emperador vende calzado, bolsos, ropa y gorras. La IA de visión dice
   qué TIPO es lo de la foto del cliente ("gorra"), y el cotejo solo compara
   contra los productos de ese tipo: una gorra no puede salir emparejada con
   un zapato. El tipo de cada producto sale de su carpeta (CALZADOS,
   GORRAS…), que es como el dueño ya los tiene ordenados.
   ─────────────────────────────────────────────────────────────────── */

export const TIPOS = ["calzado", "gorra", "bolso", "franela", "pantalon", "short", "uniforme"];

const CARPETA_DEL_TIPO = {
  calzado: /calzad|zapat|tenis|bota/i,
  gorra: /gorr|cachucha|visera/i,
  bolso: /bols|carter|morral|mochil|koala|riñonera|rinonera/i,
  franela: /franel|camis|chemise|polo|sueter|suéter|hoodie|sudader/i,
  pantalon: /pantal|jean|jogger/i,
  short: /short|bermud/i,
  uniforme: /uniform/i,
};

// ¿La carpeta (categoría) es de ese tipo? Con las cinco del dueño (ver
// categorias.js): una foto de "short" vale contra la carpeta PANTALONES y
// una de "franela" contra CAMISAS. Si el tipo no es de los cinco ("otro"),
// se usa el patrón fino de aquí.
export function carpetaDelTipo(categoria, tipo) {
  const cinco = categoriaDelTipo(tipo);
  if (cinco) return categoriaDeCarpeta(categoria) === cinco;
  const patron = CARPETA_DEL_TIPO[tipo];
  return Boolean(patron && patron.test(String(categoria || "")));
}

// foto (url de la imagen) → categoría de su carpeta. Vacío si no es Drive.
export async function categoriasPorImagen(env) {
  if (!usaDrive(env)) return new Map();
  const { productos } = await catalogoDeDrive(env);
  return new Map(productos.map((p) => [p.imagen, p.categoria || ""]));
}

/* ── Lo mismo que shopify.js, para que nadie más se entere ───────── */

function despejar(texto) {
  return modelosEnUnaPalabra(
    String(texto || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
  );
}

// EL MISMO MODELO ESCRITO DE MIL MANERAS (6-oct-2026). "Air Force One",
// "Air Force 1", "airforce", "AF1", "af 1", "af01" son el mismo zapato. Se
// vuelven una sola palabra —"af1"— tanto en lo que se busca como en el
// título, la carpeta y el modelo del índice, así que cualquiera encuentra a
// cualquiera. Pasó el 5-oct: "Precio de los AF1 Drake" buscó "Air Force One
// Drake" y no salió nada.
export function modelosEnUnaPalabra(texto) {
  return String(texto || "")
    .replace(/\bair\s*force\s*(?:one|1|uno)\b|\bairforce(?:one|1)?\b|\bair\s*force\b|\baf\s*0?1\b/g, "af1")
    // "Air Max 90" y la carpeta "AIRMAX 90" (6-oct-2026).
    .replace(/\bair\s*max\b/g, "airmax");
}

// LOS APODOS (6-oct-2026, dueño: "los zapatos drake son los af1"). Si con
// el apodo no sale nada (ningún título ni ninguna foto del índice lo
// dice), se busca el modelo del que es apodo: mejor enseñar los AF1 que
// decir "ese no me queda".
export const APODOS = {
  drake: "af1",
};

// LAS MISMAS ZAPATILLAS CON OTRO NOMBRE. El prompt (heredado de Invictus,
// donde Shopify las llama "Retro") busca "Retro 4" cuando el cliente pide
// "jordan 4"; en la carpeta de Drive pueden llamarse "Jordan 4". Pasó el
// 1-oct: "tienes jordan?" → buscó "Retro" → 0. Ahora una vale por la otra.
//
// LAS CATEGORÍAS ("zapatos" = CALZADOS, "camisas" = FRANELAS…) ya NO van
// aquí (5-oct-2026): con ellas, "jean" valía por toda la carpeta PANTALONES
// y traía joggers. Ahora lo hace categorias.js: la búsqueda se filtra por la
// categoría, y si con la palabra no sale nada, se buscan todos los de esa
// categoría (ver buscarProductos en shopify.js).
const SINONIMOS = {
  retro: ["retro", "jordan"],
  jordan: ["jordan", "retro"],
  // Como están escritas las carpetas de El Emperador (6-oct-2026):
  // "METCOM 6", "ZOON GT". El cliente (y la IA) escriben Metcon y Zoom.
  metcon: ["metcon", "metcom"],
  metcom: ["metcom", "metcon"],
  zoom: ["zoom", "zoon"],
  zoon: ["zoon", "zoom"],
  // Los Dunk están en la carpeta "NIKE SB".
  dunk: ["dunk", "sb"],
  // Los de fútbol: carpeta "Calzados para futbol".
  tacos: ["tacos", "futbol"],
  guayos: ["guayos", "futbol"],
  botines: ["botines", "futbol"],
  // "TN" y "Air Max Plus" son el mismo zapato.
  tn: ["tn", "plus"],
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
function coincide(producto, palabras, modelo = "") {
  const donde = despejar(`${producto.titulo} ${producto.codigo} ${producto.carpetas} ${modelo}`);
  return palabras.every((p) => alternativas(p).some((alt) => estaLaPalabra(donde, alt)));
}

export async function buscarEnDrive(env, termino, cuantos = 10) {
  const palabras = despejar(termino).split(/\s+/).filter(Boolean).slice(0, 5);
  if (!palabras.length) return { productos: [], hayMas: false };

  const { productos } = await catalogoDeDrive(env);
  const modelos = await modelosPorFoto(env);
  let encontrados = buscarConPalabras(productos, palabras, modelos);

  // El apodo no salió en ningún lado: el modelo del que es apodo.
  if (!encontrados.length && palabras.some((p) => APODOS[p])) {
    const sinApodo = [...new Set(palabras.map((p) => APODOS[p] || p))];
    console.log(`Apodo sin resultados: "${palabras.join(" ")}" → busco "${sinApodo.join(" ")}"`);
    encontrados = buscarConPalabras(productos, sinApodo, modelos);
  }

  return { productos: encontrados.slice(0, cuantos).map(sinInternos), hayMas: encontrados.length > cuantos };
}

// EL NOMBRE Y, DETRÁS, EL ÍNDICE (6-oct-2026). En la carpeta de Drive la
// mayoría de las fotos se llaman "IMG 3212" o "329/36-44": el nombre no
// dice el modelo, y buscar "Air Force One" no las encontraba nunca. Pero al
// indexar, la IA ya miró cada foto y dijo qué modelo es (ver indice.js,
// columna "modelo"). Primero van las que lo dicen en el nombre o la
// carpeta; después, las que el índice reconoció. El modelo del índice
// cuenta como si estuviera en el nombre: "Retro 3 caballero" encuentra la
// foto "IMG 3213" de la carpeta CABALLERO.
function buscarConPalabras(productos, palabras, modelos) {
  const porNombre = productos.filter((p) => coincide(p, palabras));
  if (!modelos.size) return porNombre;
  const ya = new Set(porNombre.map((p) => p.imagen));
  const porIndice = productos.filter((p) => !ya.has(p.imagen) && modelos.has(p.imagen) && coincide(p, palabras, modelos.get(p.imagen)));
  return [...porNombre, ...porIndice];
}

// El modelo que la IA reconoció en cada foto al indexar: una consulta a D1
// por búsqueda, sin modelo de IA de por medio.
async function modelosPorFoto(env) {
  if (!env?.DB) return new Map();
  try {
    const { results } = await env.DB
      .prepare("SELECT imagen, modelo FROM catalogo WHERE modelo IS NOT NULL AND modelo != ''")
      .all();
    return new Map((results || []).map((f) => [f.imagen, f.modelo]));
  } catch (error) {
    // Sin la columna todavía (el cron aún no pasó) o sin índice: solo el nombre.
    console.error("No pude leer los modelos del índice:", error?.message || error);
    return new Map();
  }
}

export async function catalogoCompletoDeDrive(env, maximo = 1000) {
  const { productos } = await catalogoDeDrive(env);
  return { productos: productos.slice(0, maximo).map(sinInternos), completo: productos.length <= maximo };
}

// Los títulos, uno por línea, para el prompt (lo que en Shopify es
// prompts/catalogo.txt). Sin repetir.
// Agrupados por categoría, para que la IA sepa qué es cada cosa: no es lo
// mismo "Nike blanco" en CALZADOS que en GORRAS.
//
// 6-oct-2026: van PRIMERO los modelos (las carpetas: ver modelosDeDrive) y
// después solo los nombres de foto que dicen algo. Antes iban todos los
// nombres, y en El Emperador casi todos eran "IMG 3212": la IA no sabía
// qué modelos había y escribía "buscar" a ciegas.
const MAXIMO_NOMBRES_POR_CATEGORIA = 120;

export async function titulosDeDrive(env) {
  const { productos } = await catalogoDeDrive(env);
  const modelos = new Map((await modelosDeDrive(env)).map((m) => [m.categoria, m.modelos]));
  const grupos = new Map();
  for (const p of productos) {
    const cat = p.categoria || "OTROS";
    if (!grupos.has(cat)) grupos.set(cat, new Set());
    if (nombreQueNoDiceNada(p.titulo)) continue;
    // Sin el código: "ADISTAR TALLAS 36-40 · Cód. AD1" una sola vez.
    grupos.get(cat).add(p.titulo.replace(/\s*·\s*C[oó]d\..*$/i, "").trim());
  }
  for (const cat of modelos.keys()) if (!grupos.has(cat)) grupos.set(cat, new Set());
  if (grupos.size === 1 && grupos.has("OTROS") && !modelos.size) return [...grupos.get("OTROS")].join("\n");
  return [...grupos.entries()]
    .map(([cat, titulos]) => {
      const deModelos = (modelos.get(cat) || []).map((m) => `  ${m.ruta} (${m.fotos} ${m.fotos === 1 ? "foto" : "fotos"})`);
      const nombres = [...titulos].slice(0, MAXIMO_NOMBRES_POR_CATEGORIA);
      return [
        `${cat}:`,
        deModelos.length ? `Modelos (carpetas):\n${deModelos.join("\n")}` : "",
        nombres.length ? `Nombres de fotos:\n${nombres.join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

// Los MODELOS en una lista corta, para la IA que mira fotos: una línea por
// modelo, "NIKE › AIR FORCE ONE". Solo lo que tiene marca y modelo.
export async function listaDeModelosParaFotos(env) {
  const lineas = [];
  for (const { categoria, modelos } of await modelosDeDrive(env)) {
    for (const m of modelos) lineas.push(`${categoria} › ${m.ruta}`);
  }
  return lineas.join("\n");
}

// Las categorías que hay, con cuántos productos cada una.
// LOS MODELOS DE LA TIENDA, SACADOS DE LAS CARPETAS (6-oct-2026).
//
// El dueño ordena las fotos por carpeta: CALZADOS › DEPORTIVOS › NIKE ›
// AIR FORCE ONE. Los nombres de los archivos no dicen nada ("IMG 3212"),
// pero las carpetas son la lista de modelos de la tienda, y sale sola de
// Drive: una carpeta nueva es un modelo nuevo, sin tocar ningún archivo.
//
// Devuelve, por categoría, cada ruta de modelo con cuántas fotos tiene:
//   [{ categoria: "CALZADOS", modelos: [{ ruta: "DEPORTIVOS › NIKE › AIR FORCE ONE", fotos: 12 }, …] }]
// La ruta va SIN la categoría ni las carpetas de lote ("CNTND 1").
export async function modelosDeDrive(env) {
  const { productos } = await catalogoDeDrive(env);
  const porCategoria = new Map();
  for (const p of productos) {
    const ruta = (p.ruta || []).map((c) => String(c).trim()).filter((c) => c && !ES_CONTENEDOR.test(c));
    if (!ruta.length) continue;
    const [categoria, ...resto] = ruta;
    if (!resto.length) continue;
    const clave = resto.join(" › ");
    if (!porCategoria.has(categoria)) porCategoria.set(categoria, new Map());
    const modelos = porCategoria.get(categoria);
    modelos.set(clave, (modelos.get(clave) || 0) + 1);
  }
  return [...porCategoria.entries()].map(([categoria, modelos]) => ({
    categoria,
    modelos: [...modelos.entries()].map(([ruta, fotos]) => ({ ruta, fotos })).sort((a, b) => a.ruta.localeCompare(b.ruta)),
  }));
}

// Un nombre de foto que no dice nada: "IMG 3212", "IMG-20260630-WA0192",
// "20260702 131111", "329/36-44/". Esos no se le pasan a la IA.
export function nombreQueNoDiceNada(titulo) {
  const t = String(titulo || "")
    .replace(/·\s*C[oó]d\.?.*$/i, "")
    .replace(/\btallas?\b/gi, " ")
    .trim();
  if (/^(?:img|image|imagen|foto|photo|dsc|wa|screenshot|captura|whatsapp)\b/i.test(t)) return true;
  // Un código de modelo ("K6066", "A2000") sí dice algo.
  if (/\b[a-z]{1,3}\d{3,}\b/i.test(t)) return false;
  // Sin una palabra de 3 letras o más, son números y signos.
  return !/[a-záéíóúñ]{3,}/i.test(t.replace(/\b(?:img|wa)\d*\b/gi, ""));
}

export async function categoriasDeDrive(env) {
  const { productos } = await catalogoDeDrive(env);
  const cuenta = new Map();
  for (const p of productos) if (p.categoria) cuenta.set(p.categoria, (cuenta.get(p.categoria) || 0) + 1);
  return [...cuenta.entries()].map(([nombre, cuantos]) => ({ nombre, cuantos }));
}

// La carpeta viaja con el producto: es lo que dice si es un bolso o un
// zapato (ver categorias.js).
function sinInternos({ titulo, precio, imagen, url, categoria = "" }) {
  return { titulo, precio, imagen, url, categoria };
}

// Solo para las pruebas: olvidar lo leído.
export function olvidarCatalogoDeDrive() {
  cache = null;
  tablaDriveLista = false;
}
