// Memoria del bot: quién es cada cliente, qué se habló y si un asesor tomó
// la conversación. Vive en D1, la base de datos de Cloudflare.
//
// Antes esto quedaba sin usar: el historial vivía en los campos de
// ManyChat. Con ManyChat retirado (19-sep-2026), esta es la ÚNICA memoria
// del bot entre un mensaje y el siguiente — hace falta la tabla creada
// (ver migrations/0001_contactos.sql) y el binding "DB" en wrangler.toml.

const MAX_MIDS = 20;

export async function cargarContacto(db, id) {
  const fila = await db
    .prepare("SELECT * FROM contactos WHERE id = ?")
    .bind(id)
    .first();

  if (!fila) {
    return {
      id,
      nombre: "",
      historial: "",
      pausado_hasta: 0,
      mids_enviados: [],
      ultimo_envio: 0,
    };
  }

  return {
    id: fila.id,
    nombre: fila.nombre || "",
    historial: fila.historial || "",
    pausado_hasta: Number(fila.pausado_hasta) || 0,
    mids_enviados: leerLista(fila.mids_enviados),
    ultimo_envio: Number(fila.ultimo_envio) || 0,
  };
}

// Deja constancia de que el bot ACABA de mandar algo, en el momento exacto
// en que lo mandó — no al final de atender el mensaje.
//
// POR QUÉ EXISTE ESTO APARTE. Meta devuelve un "eco" de cada mensaje que
// sale de la cuenta, y ese eco llega como una petición nueva al webhook,
// en paralelo. Si para cuando llega todavía no habíamos anotado el mid,
// el bot no reconoce su propio mensaje, cree que lo escribió un asesor
// humano y se pausa a sí mismo. Pasó en producción: cinco de siete
// conversaciones quedaron mudas. Por eso el mid se guarda inmediatamente
// después de enviar, antes de Slack y antes de cualquier otra cosa lenta.
export async function marcarEnvio(db, id, mids, cuando = Date.now()) {
  await db
    .prepare(
      `INSERT INTO contactos (id, nombre, historial, pausado_hasta, mids_enviados, ultimo_envio)
       VALUES (?, '', '', 0, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         mids_enviados = excluded.mids_enviados,
         ultimo_envio = excluded.ultimo_envio`
    )
    .bind(id, JSON.stringify(mids.slice(-MAX_MIDS)), cuando)
    .run();
}

// La red de seguridad del párrafo de arriba: aunque el mid no aparezca en
// la lista (porque el eco ganó la carrera de todas formas), si el bot
// mandó algo hace nada, ese eco es casi con certeza suyo. Un asesor humano
// que justo escribe en esa misma ventana solo retrasa la pausa hasta su
// mensaje siguiente; confundir el eco propio, en cambio, deja al cliente
// sin atención durante horas.
const VENTANA_ECO_PROPIO_MS = 90 * 1000;

export function envioReciente(contacto, ahora = Date.now()) {
  const ultimo = Number(contacto.ultimo_envio) || 0;
  return ultimo > 0 && ahora - ultimo < VENTANA_ECO_PROPIO_MS;
}

export async function guardarContacto(db, contacto) {
  // Solo guardamos los últimos: la lista existe para reconocer ecos recientes,
  // no para ser un archivo histórico.
  const mids = contacto.mids_enviados.slice(-MAX_MIDS);

  await db
    .prepare(
      `INSERT INTO contactos (id, nombre, historial, pausado_hasta, mids_enviados, ultimo_envio)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         nombre = excluded.nombre,
         historial = excluded.historial,
         pausado_hasta = excluded.pausado_hasta,
         mids_enviados = excluded.mids_enviados,
         ultimo_envio = excluded.ultimo_envio`
    )
    .bind(
      contacto.id,
      contacto.nombre || "",
      contacto.historial || "",
      Number(contacto.pausado_hasta) || 0,
      JSON.stringify(mids),
      Number(contacto.ultimo_envio) || 0
    )
    .run();
}

// Cuando un asesor escribe desde la app de Instagram, el bot se aparta unas
// horas para no hablar por encima de él.
export async function pausar(db, id, horas) {
  const hasta = Date.now() + horas * 60 * 60 * 1000;
  await db
    .prepare(
      `INSERT INTO contactos (id, nombre, historial, pausado_hasta, mids_enviados)
       VALUES (?, '', '', ?, '[]')
       ON CONFLICT(id) DO UPDATE SET pausado_hasta = excluded.pausado_hasta`
    )
    .bind(id, hasta)
    .run();
}

export function estaPausado(contacto) {
  return Number(contacto.pausado_hasta) > Date.now();
}

// Instagram nos avisa de TODO mensaje que sale de la cuenta, incluidos los que
// mandó el propio bot. Si el identificador está en la lista, el eco es nuestro
// y hay que ignorarlo; si no lo está, lo escribió una persona.
export function esEcoPropio(contacto, mid) {
  if (!mid) return false;
  return contacto.mids_enviados.includes(mid);
}

function leerLista(valor) {
  if (!valor) return [];
  try {
    const lista = JSON.parse(valor);
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}
