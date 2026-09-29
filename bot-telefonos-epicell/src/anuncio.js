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
