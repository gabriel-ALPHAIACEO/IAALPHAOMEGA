// EL AGENTE PUENTE, VISTO DESDE EL BOT (16-oct-2026): su latido, sus órdenes y
// sus alertas.
//
// QUÉ ES EL AGENTE PUENTE. Un programa que corre en la PC del cliente, junto a
// su sistema de inventario cerrado, y le pasa el stock al bot (ver
// conectores.js y la carpeta agente-puente/). Hasta hoy era un mensajero mudo: si se
// apagaba la PC, si cambiaban la clave de la base o si el sistema dejaba de
// exportar, NADIE se enteraba y el bot seguía ofreciendo un stock cada vez más
// viejo. Esta pieza arregla eso:
//
//   1. LATIDO. El agente le dice al bot cada minuto (o en cada vuelta, si lo
//      corre el Programador de tareas) «estoy vivo, esto fue lo que hice, esto
//      falló». El bot lo guarda en `sync_agentes` y los últimos hechos en
//      `sync_eventos`.
//   2. LO QUE VE EL DUEÑO. En Inventario › Importar sale cada agente: si está
//      activo, con error o sin señal; cuándo fue su último conteo bueno; el
//      último error con sus palabras; y un botón «Sincronizar ahora».
//   3. LAS ÓRDENES. El botón no le manda nada al agente (el bot no puede
//      entrar a la PC del cliente): deja una marca (`sync_orden`) y el agente,
//      que pregunta en cada latido, la ve y sincroniza enseguida. Solo hay UNA
//      orden posible: «sincronizar». El agente no acepta comandos de afuera.
//   4. LAS ALERTAS. Si el agente reporta un error, o pasa más del umbral sin
//      dar señal, sale un aviso a Slack (SLACK_WEBHOOK) y al panel central
//      (alerta «puente»); y cuando vuelve, otro. Sin repetir de más: un error
//      igual se vuelve a avisar a las 6 horas, no cada minuto.
//
// REGLAS:
//   · Todo con la misma clave que el resto de /api/sync (SYNC_CLAVE).
//   · Un latido NUNCA guarda secretos: se le quitan claves, contraseñas y
//     tokens al mensaje antes de guardarlo (el agente también lo hace).
//   · Un latido nunca toca el inventario: solo avisa. Las órdenes tampoco.
//   · Todo lo que crea (tablas) se crea desde el código (regla 3 de CLAUDE.md).

import { alertarCentral } from "./registro.js";
import { asegurarInventario, guardarAjuste, leerAjuste } from "./inventario.js";

const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;
// Un error que sigue igual se vuelve a avisar pasado este tiempo.
export const REPETIR_AVISO_MS = 6 * HORA;
// Cuántos agentes puede tener una tienda (un latido de más se rechaza).
export const MAXIMO_DE_AGENTES = 20;
// Cuántos hechos se guardan por agente (los últimos).
export const MAXIMO_DE_EVENTOS = 100;
export const MAXIMO_DEL_LATIDO = 8 * 1024;

const TABLAS = [
  `CREATE TABLE IF NOT EXISTS sync_agentes (
    id              TEXT PRIMARY KEY,
    origen          TEXT NOT NULL DEFAULT '',
    equipo          TEXT NOT NULL DEFAULT '',
    version         TEXT NOT NULL DEFAULT '',
    modo            TEXT NOT NULL DEFAULT '',
    cada_min        INTEGER NOT NULL DEFAULT 0,
    estado          TEXT NOT NULL DEFAULT '',
    mensaje         TEXT NOT NULL DEFAULT '',
    filas           INTEGER NOT NULL DEFAULT 0,
    sin_cambios     INTEGER NOT NULL DEFAULT 0,
    primer_latido   INTEGER NOT NULL,
    ultimo_latido   INTEGER NOT NULL,
    ultimo_ok       INTEGER NOT NULL DEFAULT 0,
    ultimo_error    TEXT NOT NULL DEFAULT '',
    ultimo_error_en INTEGER NOT NULL DEFAULT 0,
    ciclos_ok       INTEGER NOT NULL DEFAULT 0,
    ciclos_error    INTEGER NOT NULL DEFAULT 0,
    aviso_error_en  INTEGER NOT NULL DEFAULT 0,
    aviso_error     TEXT NOT NULL DEFAULT '',
    silencio_avisado INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS sync_eventos (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    agente  TEXT NOT NULL,
    creado  INTEGER NOT NULL,
    tipo    TEXT NOT NULL,
    mensaje TEXT NOT NULL DEFAULT '',
    filas   INTEGER NOT NULL DEFAULT 0
  )`,
  "CREATE INDEX IF NOT EXISTS sync_eventos_agente ON sync_eventos (agente, id)",
];

// Por base (y no un «listo» suelto): así una prueba con dos bases no se salta
// las tablas de la segunda.
const listas = new WeakSet();
export async function asegurarAgentes(db) {
  if (listas.has(db)) return;
  for (const sentencia of TABLAS) await db.prepare(sentencia).run();
  listas.add(db);
}

/* ── Limpiar lo que llega ────────────────────────────────────────────── */

// Quita claves, contraseñas y tokens de un texto, y lo recorta. Se usa en lo
// que manda el agente (por si algo se le escapó) y también aquí.
export function sinSecretos(texto, { secretos = [], largo = 300 } = {}) {
  let t = String(texto ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***")
    .replace(/((?:clave|contrase[ñn]a|password|passwd|pwd|token|secret|secreto|api[_-]?key)\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi, "$1***")
    .replace(/(\s-P\s+)("[^"]*"|'[^']*'|\S+)/g, "$1***")
    .replace(/(\s-p)(?!\s)(\S+)/g, "$1***");
  for (const s of secretos) {
    const v = String(s || "");
    if (v.length >= 4) t = t.split(v).join("***");
  }
  return t.replace(/\s+/g, " ").trim().slice(0, largo);
}

function limpiarId(valor) {
  const id = String(valor ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ._-]/g, "")
    .trim()
    .slice(0, 40);
  return id || "puente";
}

const ESTADOS = new Set(["inicio", "ok", "error", "trabajando", "espera"]);

/* ── Estado de un agente ─────────────────────────────────────────────── */

// Pasados cuántos minutos sin latido se dice que no da señal. El agente que
// corre siempre late cada minuto: 10 min es mucho. El que lo corre el
// Programador de tareas late en cada vuelta: 3 vueltas, y no menos de 45 min.
export function umbralDeSilencioMin(agente, env = {}) {
  const forzado = Number(env?.AGENTE_SILENCIO_MIN);
  if (Number.isFinite(forzado) && forzado >= 2) return forzado;
  if (agente?.modo === "continuo") return 10;
  return Math.max(45, 3 * (Number(agente?.cada_min) || 15));
}

// 'sin_senal' | 'error' | 'trabajando' | 'activo' | 'nuevo'
export function estadoDelAgente(agente, ahora = Date.now(), env = {}) {
  if (!agente) return { clave: "nuevo", etiqueta: "Sin conectar" };
  const umbral = umbralDeSilencioMin(agente, env);
  if (ahora - Number(agente.ultimo_latido) > umbral * MINUTO) return { clave: "sin_senal", etiqueta: "Sin señal", umbralMin: umbral };
  if (agente.estado === "error") return { clave: "error", etiqueta: "Con error", umbralMin: umbral };
  if (agente.estado === "trabajando") return { clave: "trabajando", etiqueta: "Sincronizando", umbralMin: umbral };
  return { clave: "activo", etiqueta: "Activo", umbralMin: umbral };
}

export function haceCuanto(ms, ahora = Date.now()) {
  const t = Number(ms);
  if (!t) return "nunca";
  const s = Math.max(0, Math.round((ahora - t) / 1000));
  if (s < 60) return "hace unos segundos";
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

/* ── Las órdenes (solo una: sincronizar ya) ─────────────────────────── */

export async function ordenPendiente(db) {
  await asegurarInventario(db);
  const v = Number(await leerAjuste(db, "sync_orden"));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

// El botón «Sincronizar ahora» del panel. Devuelve la marca de la orden.
export async function pedirSincronizacion(db, ahora = Date.now()) {
  await asegurarInventario(db);
  await guardarAjuste(db, "sync_orden", String(ahora));
  return ahora;
}

async function limpiarOrden(db, hastaMarca) {
  const marca = await ordenPendiente(db);
  // Solo se borra la que el agente de verdad vio: una orden pedida después
  // (marca mayor) sigue esperando.
  if (marca && marca <= Number(hastaMarca)) await db.prepare("DELETE FROM inv_ajustes WHERE clave = 'sync_orden'").run();
}

/* ── El latido ───────────────────────────────────────────────────────── */

async function avisar(env, tipo, texto) {
  const tareas = [alertarCentral(env, [{ tipo, texto }])];
  if (env?.SLACK_WEBHOOK) {
    tareas.push(
      fetch(env.SLACK_WEBHOOK, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: `*${texto}*` }),
        signal: AbortSignal.timeout(4000),
      }).catch((e) => console.error("Slack (puente):", e?.message || e))
    );
  }
  await Promise.allSettled(tareas);
}

async function anotarEvento(db, agente, tipo, mensaje = "", filas = 0, ahora = Date.now()) {
  await db.prepare("INSERT INTO sync_eventos (agente, creado, tipo, mensaje, filas) VALUES (?, ?, ?, ?, ?)").bind(agente, ahora, tipo, mensaje, Number(filas) || 0).run();
  // Solo los últimos.
  await db
    .prepare("DELETE FROM sync_eventos WHERE agente = ? AND id <= (SELECT id FROM sync_eventos WHERE agente = ? ORDER BY id DESC LIMIT 1 OFFSET ?)")
    .bind(agente, agente, MAXIMO_DE_EVENTOS)
    .run();
}

// Un latido del agente. «cuerpo» es el JSON que mandó. Devuelve
// { estado, cuerpo } para la respuesta HTTP.
export async function recibirLatido(env, cuerpo, ahora = Date.now()) {
  const db = env.DB;
  await asegurarAgentes(db);
  if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo)) return { estado: 400, cuerpo: { ok: false, error: "El latido tiene que ser un objeto JSON." } };
  const secretos = [env.SYNC_CLAVE, env.CONECTOR_CLAVE];
  const id = limpiarId(cuerpo.agente);
  const estado = ESTADOS.has(String(cuerpo.estado)) ? String(cuerpo.estado) : "ok";
  const origen = sinSecretos(cuerpo.origen, { secretos, largo: 60 });
  const equipo = sinSecretos(cuerpo.equipo, { secretos, largo: 60 });
  const version = sinSecretos(cuerpo.version, { secretos, largo: 20 });
  const modo = cuerpo.modo === "continuo" ? "continuo" : "una-vez";
  const cada = Math.max(0, Math.min(1440, Math.trunc(Number(cuerpo.cadaMinutos)) || 0));
  const mensaje = sinSecretos(cuerpo.mensaje, { secretos, largo: 300 });
  const filas = Math.max(0, Math.trunc(Number(cuerpo.filas)) || 0);
  const sinCambios = Math.max(0, Math.trunc(Number(cuerpo.sinCambios)) || 0);

  const antes = await db.prepare("SELECT * FROM sync_agentes WHERE id = ?").bind(id).first();
  if (!antes) {
    const { n } = (await db.prepare("SELECT COUNT(*) AS n FROM sync_agentes").first()) || { n: 0 };
    if (Number(n) >= MAXIMO_DE_AGENTES) return { estado: 409, cuerpo: { ok: false, error: `Esta tienda ya tiene ${MAXIMO_DE_AGENTES} agentes. Borra los que no uses.` } };
    await db
      .prepare("INSERT INTO sync_agentes (id, origen, equipo, version, modo, cada_min, estado, primer_latido, ultimo_latido) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, origen, equipo, version, modo, cada, estado, ahora, ahora)
      .run();
  }
  const venia = antes || { aviso_error_en: 0, aviso_error: "", silencio_avisado: 0, ultimo_error: "" };
  const nombre = origen || id;
  const donde = equipo ? ` (${equipo})` : "";

  // Un «sigo vivo» entre dos conteos no borra el error del último: el panel
  // sigue diciendo «Con error» hasta que un conteo salga bien.
  const estadoGuardado = (estado === "espera" || estado === "inicio") && antes?.estado === "error" ? "error" : estado;
  const cambios = [
    ["origen", origen],
    ["equipo", equipo],
    ["version", version],
    ["modo", modo],
    ["cada_min", cada],
    ["estado", estadoGuardado],
    ["ultimo_latido", ahora],
  ];
  const alertas = [];
  let tipoDeEvento = "";

  if (estado === "inicio") tipoDeEvento = "inicio";

  // Estaba avisado como «sin señal» y vuelve a hablar (con lo que sea menos un
  // error, que se avisa aparte): se dice que volvió.
  const volvioDelSilencio = Number(venia.silencio_avisado) && estado !== "error";
  if (volvioDelSilencio) {
    cambios.push(["silencio_avisado", 0]);
    if (!(estado === "ok" && Number(venia.aviso_error_en))) {
      alertas.push(["puenteok", `✅ El puente de inventario de ${nombre}${donde} volvió a dar señal.`]);
      await anotarEvento(db, id, "volvio", "Volvió a dar señal", 0, ahora);
    }
  }

  if (estado === "ok") {
    cambios.push(["mensaje", mensaje], ["filas", filas], ["sin_cambios", sinCambios], ["ultimo_ok", ahora], ["aviso_error_en", 0], ["aviso_error", ""]);
    tipoDeEvento = "ok";
    if (Number(venia.aviso_error_en)) {
      alertas.push(["puenteok", `✅ El puente de inventario de ${nombre}${donde} volvió a funcionar${mensaje ? `: ${mensaje}` : ""}`]);
      await anotarEvento(db, id, "volvio", "Volvió a funcionar", 0, ahora);
    }
  } else if (estado === "error") {
    cambios.push(["mensaje", mensaje], ["ultimo_error", mensaje], ["ultimo_error_en", ahora], ["silencio_avisado", 0]);
    tipoDeEvento = "error";
    // Se avisa la primera vez, si el error es otro, o pasadas 6 horas.
    const mismo = String(venia.aviso_error || "").slice(0, 60) === mensaje.slice(0, 60);
    if (!Number(venia.aviso_error_en) || !mismo || ahora - Number(venia.aviso_error_en) > REPETIR_AVISO_MS) {
      alertas.push(["puente", `🔌 El puente de inventario de ${nombre}${donde} tiene un error: ${mensaje || "sin detalle"}. Hasta que se arregle, el bot sigue con el último stock que recibió.`]);
      cambios.push(["aviso_error_en", ahora], ["aviso_error", mensaje]);
    }
  }

  // Si el latido trae su propio resultado, se cuentan los ciclos. (Un Map: si
  // una columna se puso dos veces, vale la última.)
  const finales = [...new Map(cambios)];
  const sumas = estado === "ok" && cuerpo.ciclo === true ? "ciclos_ok = ciclos_ok + 1, " : estado === "error" ? "ciclos_error = ciclos_error + 1, " : "";
  await db
    .prepare(`UPDATE sync_agentes SET ${sumas}${finales.map(([c]) => `${c} = ?`).join(", ")} WHERE id = ?`)
    .bind(...finales.map(([, v]) => v), id)
    .run();

  // Los hechos que vale la pena guardar: el encendido, cada conteo (bueno o
  // con error). Un «sigo vivo» cada minuto, no.
  if (tipoDeEvento === "ok") {
    if (cuerpo.ciclo === true) await anotarEvento(db, id, "ok", mensaje, filas, ahora);
  } else if (tipoDeEvento) await anotarEvento(db, id, tipoDeEvento, mensaje, filas, ahora);

  if (Number(cuerpo.ordenHecha)) {
    await limpiarOrden(db, cuerpo.ordenHecha);
    await anotarEvento(db, id, "orden", "Sincronizó porque se lo pidieron desde el panel", 0, ahora);
  }

  for (const [tipo, texto] of alertas) await avisar(env, tipo, texto);

  const orden = await ordenPendiente(db);
  return {
    estado: 200,
    cuerpo: { ok: true, hora: ahora, ordenes: orden ? ["sincronizar"] : [], ordenEn: orden || undefined, silencioMin: umbralDeSilencioMin({ modo, cada_min: cada }, env) },
  };
}

/* ── Vigilar el silencio (lo llama el cron) ─────────────────────────── */

export async function vigilarAgentes(env, ahora = Date.now()) {
  const db = env?.DB;
  if (!db) return 0;
  await asegurarAgentes(db);
  const { results } = await db.prepare("SELECT * FROM sync_agentes WHERE silencio_avisado = 0").all();
  let avisados = 0;
  for (const a of results || []) {
    const umbral = umbralDeSilencioMin(a, env);
    if (ahora - Number(a.ultimo_latido) <= umbral * MINUTO) continue;
    const nombre = a.origen || a.id;
    const donde = a.equipo ? ` (${a.equipo})` : "";
    // Se marca primero: si el aviso tarda o falla, no se repite en cada cron.
    await db.prepare("UPDATE sync_agentes SET silencio_avisado = 1 WHERE id = ? AND silencio_avisado = 0").bind(a.id).run();
    await anotarEvento(db, a.id, "silencio", `Sin señal desde ${haceCuanto(a.ultimo_latido, ahora)}`, 0, ahora);
    await avisar(
      env,
      "puente",
      `🔌 El puente de inventario de ${nombre}${donde} no da señal desde ${haceCuanto(a.ultimo_latido, ahora)} (pasan más de ${umbral} min). Revisa que la PC esté encendida y con internet. Mientras tanto, el bot sigue con el último stock que recibió.`
    );
    avisados++;
  }
  return avisados;
}

/* ── Lo que lee el panel ─────────────────────────────────────────────── */

export async function listarAgentes(db, ahora = Date.now(), env = {}) {
  await asegurarAgentes(db);
  const { results } = await db.prepare("SELECT * FROM sync_agentes ORDER BY ultimo_latido DESC LIMIT ?").bind(MAXIMO_DE_AGENTES).all();
  return (results || []).map((a) => ({ ...a, estadoActual: estadoDelAgente(a, ahora, env) }));
}

export async function eventosDelAgente(db, id, cuantos = 5) {
  await asegurarAgentes(db);
  const { results } = await db.prepare("SELECT creado, tipo, mensaje, filas FROM sync_eventos WHERE agente = ? ORDER BY id DESC LIMIT ?").bind(id, cuantos).all();
  return results || [];
}

export async function borrarAgente(db, id) {
  await asegurarAgentes(db);
  await db.prepare("DELETE FROM sync_agentes WHERE id = ?").bind(String(id || "")).run();
  await db.prepare("DELETE FROM sync_eventos WHERE agente = ?").bind(String(id || "")).run();
}

export const TIPOS_DE_EVENTO = {
  inicio: "Se encendió",
  ok: "Conteo correcto",
  error: "Error",
  silencio: "Dejó de dar señal",
  volvio: "Volvió",
  orden: "Sincronizó por orden del panel",
};
