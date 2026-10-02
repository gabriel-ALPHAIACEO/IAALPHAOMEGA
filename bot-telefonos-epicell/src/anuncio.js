// EL ANUNCIO, LEÍDO EN LA API DE META.
//
// POR QUÉ HACE FALTA, SI EL AVISO YA TRAE COSAS.
//
// Cuando alguien pulsa "Enviar mensaje" en una publicidad, Meta manda un
// aviso con "ads_context_data": el título del anuncio, su foto y, a veces,
// el post del que salió. Con eso solo, el bot ya identifica el equipo (ver
// publicacionDelTurno en index.js).
//
// Pero ese bloque NO SIEMPRE VIENE. Depende del formato del anuncio, de
// dónde se hizo clic y de la versión de la API; hay avisos que llegan con
// el id del anuncio y nada más. Ahí el bot se quedaba sin contexto y tenía
// que preguntar "¿qué equipo viste?" a alguien que acababa de ver el
// equipo en pantalla — y que la tienda pagó por traer.
//
// Con el id se puede ir a buscar el anuncio entero: su nombre, el título
// del creativo, el texto y la imagen. Eso es el contexto que faltaba.
//
// QUÉ HACE FALTA PARA QUE ESTO FUNCIONE (una vez, en Meta):
//
//   1. Que la app y la cuenta publicitaria estén en el MISMO portafolio
//      comercial (Business), con la cuenta asignada como activo.
//   2. Un token con permiso "ads_read". Lo cómodo es un usuario del
//      sistema (Configuración del negocio -> Usuarios del sistema ->
//      Generar token) con la app y la cuenta publicitaria asignadas.
//   3. Cargarlo:  npx wrangler secret put ADS_TOKEN
//
// Si no hay ADS_TOKEN, no pasa nada malo: el bot sigue funcionando con lo
// que traiga el aviso. Esto solo AÑADE contexto cuando el aviso viene
// pelado.

// Los anuncios se leen en graph.facebook.com, no en graph.instagram.com:
// son de la API de marketing, aunque el clic venga de Instagram.
const GRAFO = "https://graph.facebook.com/v23.0";

// Lo que se le pide a Meta del anuncio. "creative" es donde vive lo que el
// cliente vio: el título, el texto y la imagen.
const CAMPOS = [
  "name",
  "creative{title,body,image_url,thumbnail_url,object_story_id,effective_object_story_id,asset_feed_spec}",
].join(",");

// Un anuncio no cambia mientras está corriendo, y por el mismo anuncio
// entran decenas de personas: leerlo una vez por isolate y guardarlo evita
// una llamada a Meta en cada conversación.
const CACHE_MS = 30 * 60 * 1000;
const leidos = new Map();

const ESPERA_MS = 4000;

export async function detallesDelAnuncio(env, adId) {
  const id = String(adId || "").trim();
  if (!id || !env?.ADS_TOKEN) return null;

  const guardado = leidos.get(id);
  if (guardado && Date.now() - guardado.cuando < CACHE_MS) return guardado.datos;

  let respuesta;
  try {
    respuesta = await fetch(`${GRAFO}/${id}?fields=${CAMPOS}&access_token=${env.ADS_TOKEN}`, {
      signal: AbortSignal.timeout(ESPERA_MS),
    });
  } catch (error) {
    console.error("No pude leer el anuncio:", error?.message || error);
    return null;
  }

  if (!respuesta.ok) {
    const detalle = (await respuesta.text()).slice(0, 300);
    console.error(
      `No pude leer el anuncio ${id}: ${respuesta.status} ${detalle}` +
        (/permission|OAuth|token/i.test(detalle)
          ? " · CAUSA PROBABLE: al ADS_TOKEN le falta el permiso ads_read, o la " +
            "cuenta publicitaria no está asignada a la app en el portafolio comercial."
          : "")
    );
    return null;
  }

  let datos;
  try {
    datos = await respuesta.json();
  } catch {
    return null;
  }

  const leido = loQueImporta(datos);
  leidos.set(id, { cuando: Date.now(), datos: leido });

  console.log(
    `Anuncio ${id} leído: ${leido.titulo ? `"${leido.titulo.slice(0, 60)}"` : "sin título"}` +
      `${leido.imagen ? " · con imagen" : ""}${leido.publicacion ? ` · post ${leido.publicacion}` : ""}`
  );

  return leido;
}

// De lo que devuelve Meta a lo que el bot necesita: un título que nombre el
// equipo, una imagen que mirar y el post del que salió.
//
// Meta pone lo mismo en sitios distintos según cómo se creó el anuncio. El
// "asset_feed_spec" es el de los anuncios con varios títulos y varias
// imágenes (los dinámicos): ahí se toma el primero de cada cosa.
function loQueImporta(datos) {
  const creativo = datos?.creative || {};
  const surtido = creativo.asset_feed_spec || {};

  const primero = (lista, campo) =>
    Array.isArray(lista) && lista.length ? String(lista[0]?.[campo] || "").trim() : "";

  const titulo =
    String(creativo.title || "").trim() ||
    primero(surtido.titles, "text") ||
    String(datos?.name || "").trim();

  const texto =
    String(creativo.body || "").trim() || primero(surtido.bodies, "text");

  const imagen =
    String(creativo.image_url || "").trim() ||
    String(creativo.thumbnail_url || "").trim() ||
    primero(surtido.images, "url");

  // El post del feed desde el que se hizo el anuncio, con la forma
  // "<pagina>_<post>". Se guarda entero: quien lo use decide qué hacer.
  const publicacion =
    String(creativo.effective_object_story_id || creativo.object_story_id || "").trim();

  return { titulo, texto, imagen, publicacion };
}

/* ── EL PANEL DE ANUNCIOS (2-oct-2026) ─────────────────────────────────
   El dueño: "necesito avances grandes con la parte de los anuncios". Hasta
   hoy solo se podía probar un anuncio a la vez, sabiendo su id. Ahora:

     · revisarTokenDeAnuncios: dice EXACTAMENTE qué le falta al ADS_TOKEN
       (vencido, sin ads_read, sin cuenta publicitaria asignada).
     · anunciosActivos: lee TODOS los anuncios activos de las cuentas que el
       token ve, para enseñarlos en /anuncios con el equipo que el bot va a
       mandar en cada uno, y si ese equipo está agotado.
     · ANUNCIOS_EQUIPOS (wrangler.toml): el equipo de un anuncio, puesto a
       mano, para los anuncios cuyo texto no lo nombra.
     · anotarLlegada / llegadasPorAnuncio: cuántas PERSONAS distintas
       llegaron por cada anuncio (D1, se crea sola).
   ───────────────────────────────────────────────────────────────────── */

async function grafo(env, ruta) {
  const separador = ruta.includes("?") ? "&" : "?";
  try {
    const r = await fetch(`${GRAFO}/${ruta}${separador}access_token=${encodeURIComponent(env.ADS_TOKEN)}`, {
      signal: AbortSignal.timeout(6000),
    });
    const datos = await r.json().catch(() => ({}));
    if (!r.ok || datos?.error) return { error: datos?.error || { message: `HTTP ${r.status}` } };
    return { datos };
  } catch (error) {
    return { error: { message: error?.message || String(error) } };
  }
}

// Lo que dice Meta, en palabras que el dueño pueda arreglar.
export function explicarErrorDeAnuncios(error) {
  const mensaje = String(error?.message || "");
  const codigo = Number(error?.code);
  if (codigo === 190 || /expired|session has been invalidated|invalid oauth|malformed/i.test(mensaje)) {
    return "El ADS_TOKEN está VENCIDO o no es válido. Genera uno nuevo de un USUARIO DEL SISTEMA (no caduca) y cárgalo otra vez.";
  }
  if (/ads_read|ads_management|permission|#200|#10\b|requires/i.test(mensaje) || codigo === 200 || codigo === 10) {
    return "Al ADS_TOKEN le FALTA EL PERMISO ads_read. Al generarlo, marca ads_read (y business_management).";
  }
  return `Meta respondió: ${mensaje.slice(0, 200)}`;
}

const PERMISOS_QUE_HACEN_FALTA = ["ads_read"];

export async function revisarTokenDeAnuncios(env) {
  if (!env?.ADS_TOKEN) return { ok: false, problema: "FALTA el secreto ADS_TOKEN.", cuentas: [] };

  const yo = await grafo(env, "me?fields=id,name");
  if (yo.error) return { ok: false, problema: explicarErrorDeAnuncios(yo.error), cuentas: [] };

  const permisos = await grafo(env, "me/permissions");
  const concedidos = (permisos.datos?.data || []).filter((p) => p.status === "granted").map((p) => p.permission);
  // Los usuarios del sistema a veces no listan permisos: si no hay lista,
  // no se acusa de nada; lo dirá la lectura de las cuentas.
  const faltan = concedidos.length ? PERMISOS_QUE_HACEN_FALTA.filter((p) => !concedidos.includes(p)) : [];

  const cuentas = await cuentasDeAnuncios(env);
  const problema = faltan.length
    ? `Al ADS_TOKEN le falta: ${faltan.join(", ")}.`
    : cuentas.error
      ? explicarErrorDeAnuncios(cuentas.error)
      : !cuentas.lista.length
        ? "El token funciona pero NO VE NINGUNA CUENTA PUBLICITARIA. En Configuración del negocio → Usuarios del sistema → (tu usuario) → Asignar activos → Cuentas publicitarias, asígnale la cuenta con permiso de ver."
        : "";

  return { ok: !problema, problema, quien: yo.datos?.name || yo.datos?.id || "", permisos: concedidos, cuentas: cuentas.lista || [] };
}

const ESTADO_DE_CUENTA = { 1: "activa", 2: "deshabilitada", 3: "con deuda", 7: "en revisión", 9: "en período de gracia", 101: "cerrada" };

async function cuentasDeAnuncios(env) {
  // ADS_CUENTA en wrangler.toml limita a esas cuentas ("act_123, 456").
  const puestas = String(env?.ADS_CUENTA || "")
    .split(/[,\s]+/)
    .map((c) => c.trim().replace(/^act_/, ""))
    .filter(Boolean);
  if (puestas.length) return { lista: puestas.map((id) => ({ id: `act_${id}`, nombre: "", estado: "" })) };

  const r = await grafo(env, "me/adaccounts?fields=account_id,name,account_status&limit=50");
  if (r.error) return { error: r.error, lista: [] };
  return {
    lista: (r.datos?.data || []).map((c) => ({
      id: `act_${c.account_id}`,
      nombre: c.name || "",
      estado: ESTADO_DE_CUENTA[c.account_status] || String(c.account_status || ""),
    })),
  };
}

export async function anunciosActivos(env, cuentas) {
  const campos = [
    "id",
    "name",
    "effective_status",
    "campaign{name}",
    "creative{title,body,image_url,thumbnail_url,object_story_id,effective_object_story_id,asset_feed_spec}",
  ].join(",");
  const filtro = encodeURIComponent('["ACTIVE"]');
  const anuncios = [];
  const errores = [];

  for (const cuenta of cuentas.slice(0, 5)) {
    const r = await grafo(env, `${cuenta.id}/ads?fields=${campos}&effective_status=${filtro}&limit=50`);
    if (r.error) {
      errores.push(`${cuenta.id}: ${explicarErrorDeAnuncios(r.error)}`);
      continue;
    }
    for (const a of r.datos?.data || []) {
      const leido = loQueImporta(a);
      // De paso queda en la caché: el cliente que llegue por este anuncio
      // ya no espera la llamada a Meta.
      leidos.set(String(a.id), { cuando: Date.now(), datos: leido });
      anuncios.push({ id: String(a.id), nombre: a.name || "", campana: a.campaign?.name || "", cuenta: cuenta.id, ...leido });
    }
  }
  return { anuncios, errores };
}

// ANUNCIOS_EQUIPOS = "120212345678901234=Samsung A57 | promo-poco=Poco X8 pro 5G"
// La clave es el id del anuncio o su "ref" (el que se pone en el enlace
// ig.me/m/tucuenta?ref=promo-poco).
export function equiposAsignados(env) {
  const mapa = new Map();
  for (const trozo of String(env?.ANUNCIOS_EQUIPOS || "").split(/[|\n;]/)) {
    const corte = trozo.indexOf("=");
    if (corte === -1) continue;
    const clave = trozo.slice(0, corte).trim();
    const equipo = trozo.slice(corte + 1).trim();
    if (clave && equipo) mapa.set(clave.toLowerCase(), equipo);
  }
  return mapa;
}

export function equipoAsignado(env, anuncio = {}) {
  const mapa = equiposAsignados(env);
  for (const clave of [anuncio.id, anuncio.ref]) {
    const equipo = clave && mapa.get(String(clave).toLowerCase());
    if (equipo) return equipo;
  }
  return "";
}

/* ── Cuántas personas llegó cada anuncio ──────────────────────────── */

const CREAR_LLEGADAS = `
  CREATE TABLE IF NOT EXISTS anuncios_clientes (
    anuncio TEXT NOT NULL,
    igsid   TEXT NOT NULL,
    primera INTEGER NOT NULL,
    PRIMARY KEY (anuncio, igsid)
  )
`;

export function claveDelAnuncio(anuncio = {}) {
  if (anuncio.id) return String(anuncio.id);
  if (anuncio.ref) return `ref:${anuncio.ref}`;
  if (anuncio.titulo) return `titulo:${String(anuncio.titulo).slice(0, 60)}`;
  return "";
}

export async function anotarLlegada(db, anuncio, igsid) {
  const clave = claveDelAnuncio(anuncio);
  if (!db || !clave || !igsid) return;
  try {
    await db.prepare(CREAR_LLEGADAS).run();
    await db
      .prepare("INSERT OR IGNORE INTO anuncios_clientes (anuncio, igsid, primera) VALUES (?, ?, ?)")
      .bind(clave, String(igsid), Date.now())
      .run();
  } catch (error) {
    // Contar es un extra: nunca deja a un cliente sin respuesta.
    console.error("No pude anotar la llegada del anuncio:", error?.message || error);
  }
}

export async function llegadasPorAnuncio(db) {
  const mapa = new Map();
  if (!db) return mapa;
  try {
    await db.prepare(CREAR_LLEGADAS).run();
    const r = await db
      .prepare(
        "SELECT anuncio, COUNT(*) AS personas, MAX(primera) AS ultima, " +
          "SUM(CASE WHEN primera > ? THEN 1 ELSE 0 END) AS semana FROM anuncios_clientes GROUP BY anuncio"
      )
      .bind(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .all();
    for (const fila of r?.results || []) {
      mapa.set(String(fila.anuncio), { personas: Number(fila.personas) || 0, semana: Number(fila.semana) || 0, ultima: Number(fila.ultima) || 0 });
    }
  } catch (error) {
    console.error("No pude leer las llegadas de los anuncios:", error?.message || error);
  }
  return mapa;
}
