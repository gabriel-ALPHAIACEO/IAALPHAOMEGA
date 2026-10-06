// LAS ALERTAS: LO QUE PASA EN LAS TIENDAS, EN EL MOMENTO.
//
// El dueño: "todo con monitoreo; si hay algún error o la IA respondió mal,
// que me avise, en tiempo real, en el mismo Worker". Así que:
//
//   · Cada tienda, en cuanto pasa algo, lo manda aquí (POST /api/alerta):
//     un error del bot, una respuesta que el revisor marcó 🔴, una que una
//     red tuvo que corregir ⚠️, o la queja de un cliente 👎.
//   · Cada 2 minutos (el cron) este Worker comprueba que todas las tiendas
//     respondan. Si una se cae, alerta; cuando vuelve, también.
//   · El panel abierto pregunta cada pocos segundos si hay alertas nuevas
//     (/vivo) y las enseña al instante: campana, aviso y notificación del
//     navegador.
//
// Se guardan en la base del panel central (D1, tabla "alertas", 60 días).
// La misma alerta repetida en 10 minutos no se duplica: suma "veces".

export const TIPOS = {
  error: { simbolo: "❌", nombre: "Error del bot", avisar: true },
  indebida: { simbolo: "🔴", nombre: "Respuesta indebida", avisar: true },
  corregida: { simbolo: "⚠️", nombre: "La IA inventó algo y se corrigió", avisar: true },
  queja: { simbolo: "👎", nombre: "Queja de un cliente", avisar: true },
  caida: { simbolo: "🚨", nombre: "Tienda sin responder", avisar: true },
  volvio: { simbolo: "✅", nombre: "La tienda volvió", avisar: true },
  correccion: { simbolo: "🛡", nombre: "Red de seguridad", avisar: false },
  // La IA aprende sola sus errores (ver lecciones.js de la tienda); esto
  // llega solo cuando una regla no basta y hay que tocar el código.
  codigo: { simbolo: "🛠️", nombre: "Hay que ponerlo en el código", avisar: true },
};

const CREAR = `
  CREATE TABLE IF NOT EXISTS alertas (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    cuando  INTEGER NOT NULL,
    tienda  TEXT NOT NULL,
    tipo    TEXT NOT NULL,
    texto   TEXT NOT NULL,
    igsid   TEXT NOT NULL DEFAULT '',
    veces   INTEGER NOT NULL DEFAULT 1,
    leida   INTEGER NOT NULL DEFAULT 0,
    resuelta INTEGER NOT NULL DEFAULT 0
  )
`;

const REPETIDA_MS = 10 * 60 * 1000;

// El panel abierto pregunta cada pocos segundos: con el índice, contar las
// no leídas lee solo esas filas y no la tabla entera (D1 cobra por fila leída).
const preparadas = new WeakSet();
async function preparar(db) {
  if (preparadas.has(db)) return;
  await db.prepare(CREAR).run();
  // "Solucionada" (6-oct-2026): la tabla de antes no la tenía.
  try {
    await db.prepare("ALTER TABLE alertas ADD COLUMN resuelta INTEGER NOT NULL DEFAULT 0").run();
  } catch {
    // Ya estaba.
  }
  await db.prepare("CREATE INDEX IF NOT EXISTS alertas_leida ON alertas (leida)").run();
  preparadas.add(db);
}

export async function guardarAlerta(db, { tienda, tipo, texto, igsid = "", cuando = Date.now() }) {
  if (!db) return 0;
  const clase = TIPOS[tipo] ? tipo : "error";
  const limpio = String(texto || "").slice(0, 1200);
  await preparar(db);
  const igual = await db
    .prepare("SELECT id FROM alertas WHERE tienda = ? AND tipo = ? AND substr(texto, 1, 80) = substr(?, 1, 80) AND cuando > ? ORDER BY id DESC LIMIT 1")
    .bind(tienda, clase, limpio, Date.now() - REPETIDA_MS)
    .first();
  if (igual) {
    // Si vuelve a pasar, vuelve a estar sin solucionar.
    await db.prepare("UPDATE alertas SET veces = veces + 1, cuando = ?, leida = 0, resuelta = 0 WHERE id = ?").bind(Date.now(), igual.id).run();
    return igual.id;
  }
  await db
    .prepare("INSERT INTO alertas (cuando, tienda, tipo, texto, igsid) VALUES (?, ?, ?, ?, ?)")
    .bind(Number(cuando) || Date.now(), tienda, clase, limpio, String(igsid || ""))
    .run();
  if (Math.random() < 0.02) {
    await db.prepare("DELETE FROM alertas WHERE cuando < ?").bind(Date.now() - 60 * 86400000).run();
  }
  const fila = await db.prepare("SELECT MAX(id) AS id FROM alertas").first();
  return Number(fila?.id) || 0;
}

export async function listarAlertas(db, { tienda = "", tipo = "", limite = 200, desdeId = 0, todas = false } = {}) {
  if (!db) return [];
  await preparar(db);
  // Las solucionadas no salen (salvo que se pidan todas).
  const condiciones = todas ? ["id > ?"] : ["id > ?", "resuelta = 0"];
  const args = [Number(desdeId) || 0];
  if (tienda) {
    condiciones.push("tienda = ?");
    args.push(tienda);
  }
  if (tipo) {
    condiciones.push("tipo = ?");
    args.push(tipo);
  }
  const r = await db
    .prepare(`SELECT * FROM alertas WHERE ${condiciones.join(" AND ")} ORDER BY id DESC LIMIT ?`)
    .bind(...args, limite)
    .all();
  return r?.results || [];
}

export async function sinLeer(db) {
  if (!db) return 0;
  await preparar(db);
  const tiposAvisables = Object.entries(TIPOS).filter(([, t]) => t.avisar).map(([k]) => `'${k}'`).join(",");
  const r = await db.prepare(`SELECT COUNT(*) AS n FROM alertas WHERE leida = 0 AND resuelta = 0 AND tipo IN (${tiposAvisables})`).first();
  return Number(r?.n) || 0;
}

// ✅ SOLUCIONAR (6-oct-2026): dejan de salir (y de contar en la campana).
// No se borran: con "ver también las solucionadas" se ven.
export async function solucionarAlertas(db, { tienda = "" } = {}) {
  if (!db) return 0;
  await preparar(db);
  const r = tienda
    ? await db.prepare("UPDATE alertas SET resuelta = 1, leida = 1 WHERE resuelta = 0 AND tienda = ?").bind(tienda).run()
    : await db.prepare("UPDATE alertas SET resuelta = 1, leida = 1 WHERE resuelta = 0").run();
  return Number(r?.meta?.changes) || 0;
}

export async function marcarLeidas(db) {
  if (!db) return;
  await preparar(db);
  await db.prepare("UPDATE alertas SET leida = 1 WHERE leida = 0").run();
}

// El estado de cada tienda la última vez que se miró (para avisar UNA vez
// cuando se cae y UNA vez cuando vuelve). "desde" cambia solo cuando cambia
// el estado; "visto" y "detalle" (la versión, o el motivo de la caída) se
// actualizan en cada chequeo.
const CREAR_SALUD = `
  CREATE TABLE IF NOT EXISTS salud (
    tienda  TEXT PRIMARY KEY,
    bien    INTEGER NOT NULL,
    desde   INTEGER NOT NULL,
    visto   INTEGER NOT NULL DEFAULT 0,
    detalle TEXT NOT NULL DEFAULT ''
  )
`;

export async function anotarSalud(db, tienda, bien, detalle = "") {
  if (!db) return null;
  await db.prepare(CREAR_SALUD).run();
  const antes = await db.prepare("SELECT bien FROM salud WHERE tienda = ?").bind(tienda).first();
  const cambio = !antes || Boolean(antes.bien) !== Boolean(bien);
  const ahora = Date.now();
  if (cambio) {
    await db
      .prepare(
        "INSERT INTO salud (tienda, bien, desde, visto, detalle) VALUES (?, ?, ?, ?, ?) ON CONFLICT(tienda) DO UPDATE SET bien = excluded.bien, desde = excluded.desde, visto = excluded.visto, detalle = excluded.detalle"
      )
      .bind(tienda, bien ? 1 : 0, ahora, ahora, String(detalle).slice(0, 300))
      .run();
  } else {
    await db.prepare("UPDATE salud SET visto = ?, detalle = ? WHERE tienda = ?").bind(ahora, String(detalle).slice(0, 300), tienda).run();
  }
  return { cambio, antes: antes ? Boolean(antes.bien) : null };
}

export async function leerSalud(db) {
  if (!db) return {};
  await db.prepare(CREAR_SALUD).run();
  const r = await db.prepare("SELECT * FROM salud").all();
  return Object.fromEntries((r?.results || []).map((f) => [f.tienda, { ...f, bien: Boolean(f.bien) }]));
}
