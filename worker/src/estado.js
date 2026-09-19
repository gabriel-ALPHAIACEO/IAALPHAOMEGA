// Memoria del bot: quién es cada cliente, qué se habló y si un asesor tomó
// la conversación. Vive en D1, la base de datos de Cloudflare.
//
// Solo se usa en el modo Instagram directo. En el modo ManyChat, ManyChat ya
// guarda el historial en sus propios campos.

const MAX_MIDS = 20;

export async function cargarContacto(db, id) {
  const fila = await db
    .prepare("SELECT * FROM contactos WHERE id = ?")
    .bind(id)
    .first();

  if (!fila) {
    return { id, nombre: "", historial: "", pausado_hasta: 0, mids_enviados: [] };
  }

  return {
    id: fila.id,
    nombre: fila.nombre || "",
    historial: fila.historial || "",
    pausado_hasta: Number(fila.pausado_hasta) || 0,
    mids_enviados: leerLista(fila.mids_enviados),
  };
}

export async function guardarContacto(db, contacto) {
  // Solo guardamos los últimos: la lista existe para reconocer ecos recientes,
  // no para ser un archivo histórico.
  const mids = contacto.mids_enviados.slice(-MAX_MIDS);

  await db
    .prepare(
      `INSERT INTO contactos (id, nombre, historial, pausado_hasta, mids_enviados)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         nombre = excluded.nombre,
         historial = excluded.historial,
         pausado_hasta = excluded.pausado_hasta,
         mids_enviados = excluded.mids_enviados`
    )
    .bind(
      contacto.id,
      contacto.nombre || "",
      contacto.historial || "",
      Number(contacto.pausado_hasta) || 0,
      JSON.stringify(mids)
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
