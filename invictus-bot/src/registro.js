// LO QUE PASA EN EL BOT, GUARDADO PARA EL PANEL CENTRAL (2-oct-2026).
//
// QUÉ SE PEDÍA. El dueño: "necesito saber todo sobre el bot, qué hace y
// cómo está trabajando: gastos, productos ganadores, errores del bot".
// Hasta hoy los errores solo se veían en `wrangler tail`, en el momento, y
// los avisos al asesor solo en Slack. Aquí se guardan en D1, y el panel
// central (ver panel.js, /api/central) los lee de todas las tiendas.
//
//   · ERRORES. Todo lo que el bot escribe con console.error —"OpenAI no
//     contestó", "Instagram rechazó el envío", "no pude leer la hoja", un
//     fallo técnico— ya dice en palabras qué pasó. Se recoge tal cual
//     (vigilarErrores) y se guarda al terminar cada mensaje
//     (guardarErrores). Tabla "errores", 30 días.
//   · AVISOS AL ASESOR. Cada vez que el bot pasa a alguien a una persona
//     —va a comprar, preguntó un color, un fallo— queda anotado con el
//     motivo y los productos que estaba viendo. De ahí salen los productos
//     ganadores: los que más llevan a "lo quiero". Tabla "avisos", 90 días.
//
//   · EN TIEMPO REAL. Si la tienda está conectada al panel central
//     (PANEL_CENTRAL_URL + PANEL_API_CLAVE), cada error, cada vez que una
//     red tuvo que corregir a la IA y cada queja de un cliente ("no es
//     eso", "no entiendes") se le manda al central EN EL MOMENTO, y el
//     central le avisa al dueño (Telegram o Slack). Ver alertarCentral.
//
// Nada de esto puede dejar a un cliente sin respuesta: si la base falla,
// se sigue igual.

const ERRORES_DIAS = 30;
const AVISOS_DIAS = 90;
const MAXIMO_EN_ESPERA = 100;

let pendientes = [];
let vigilando = false;

// Se llama una vez al cargar el Worker. Lo que se escriba con console.error
// sigue saliendo en el registro como siempre, y además queda en espera
// para guardarse.
export function vigilarErrores() {
  if (vigilando || typeof console === "undefined") return;
  vigilando = true;
  const original = console.error.bind(console);
  console.error = (...partes) => {
    try {
      const texto = partes
        .map((p) => (p instanceof Error ? p.message : typeof p === "string" ? p : JSON.stringify(p)))
        .join(" ")
        .slice(0, 600);
      if (texto && pendientes.length < MAXIMO_EN_ESPERA) pendientes.push({ cuando: Date.now(), texto });
    } catch {}
    original(...partes);
  };
}

const CREAR_ERRORES = `
  CREATE TABLE IF NOT EXISTS errores (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    cuando INTEGER NOT NULL,
    texto  TEXT NOT NULL
  )
`;

// Al terminar de atender: lo que se juntó, a la base. Y si hay panel
// central, también allá, en el momento.
export async function guardarErrores(db, env = null) {
  if (!pendientes.length) return;
  const lote = pendientes;
  pendientes = [];
  if (env) {
    await alertarCentral(
      env,
      lote.slice(0, 10).map((e) => ({ tipo: tipoDeError(e.texto), texto: e.texto, cuando: e.cuando }))
    );
  }
  if (!db) return;
  try {
    await db.prepare(CREAR_ERRORES).run();
    for (const e of lote.slice(0, 30)) {
      await db.prepare("INSERT INTO errores (cuando, texto) VALUES (?, ?)").bind(e.cuando, e.texto).run();
    }
    if (Math.random() < 0.02) {
      await db.prepare("DELETE FROM errores WHERE cuando < ?").bind(Date.now() - ERRORES_DIAS * 86400000).run();
    }
  } catch {
    // Sin console.error aquí: se volvería a anotar a sí mismo.
  }
}

// Qué clase de cosa es, para separarlas en el panel: un fallo de verdad, o
// una red de seguridad que corrigió a la IA (que es bueno saberlo, pero no
// es una avería).
export function tipoDeError(texto) {
  const t = String(texto || "");
  if (/PRECIO INVENTADO|TONO:|DISPONIBLE:|CUOTAS:|CASHEA|corrijo|lo cambio|lo quito|se corrige/i.test(t)) return "correccion";
  return "error";
}

const CREAR_AVISOS = `
  CREATE TABLE IF NOT EXISTS avisos (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    cuando    INTEGER NOT NULL,
    igsid     TEXT NOT NULL DEFAULT '',
    motivo    TEXT NOT NULL DEFAULT '',
    mensaje   TEXT NOT NULL DEFAULT '',
    busco     TEXT NOT NULL DEFAULT '',
    productos TEXT NOT NULL DEFAULT '[]'
  )
`;

export async function anotarAviso(db, { igsid = "", motivo = "", mensaje = "", busco = "", productos = [] } = {}) {
  if (!db) return;
  try {
    await db.prepare(CREAR_AVISOS).run();
    await db
      .prepare("INSERT INTO avisos (cuando, igsid, motivo, mensaje, busco, productos) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(
        Date.now(),
        String(igsid),
        String(motivo || "El bot lo pasó a un asesor").slice(0, 200),
        String(mensaje || "").slice(0, 500),
        String(busco || "").slice(0, 200),
        JSON.stringify((productos || []).map((p) => (typeof p === "string" ? p : p?.titulo)).filter(Boolean).slice(0, 10))
      )
      .run();
    if (Math.random() < 0.02) {
      await db.prepare("DELETE FROM avisos WHERE cuando < ?").bind(Date.now() - AVISOS_DIAS * 86400000).run();
    }
  } catch {}
}

// ¿Este aviso es alguien que va a comprar? Es lo que hace "ganador" a un
// producto: no que se enseñe mucho, sino que lleve a "lo quiero".
export function esIntencionDeCompra(motivo) {
  return /compr|cerrar|cierre|apart|lo quiere|pagar|pago|datos de pago|cashea/i.test(String(motivo || ""));
}

export async function leerTabla(db, crear, consulta, ...args) {
  try {
    await db.prepare(crear).run();
    const r = await db.prepare(consulta).bind(...args).all();
    return r?.results || [];
  } catch {
    return [];
  }
}

/* ── LO QUE PENSÓ LA IA, TURNO A TURNO, CON SU MARCA ──────────────────
   Una fila por respuesta del modelo (60 días). La "marca" dice si esa
   respuesta tuvo un problema, para señalarla en los paneles:

     error        ❌  el bot falló o no pudo contestar
     indebida     🔴  el revisor dice que alucinó, fue incoherente o no
                      contestó lo que le preguntaron (ver revisor.js)
     corregida    ⚠️  la IA inventó algo y una red lo atrapó antes de salir
     queja        👎  el cliente se quejó justo después de esta respuesta
   ───────────────────────────────────────────────────────────────────── */

export const MARCAS = {
  error: { simbolo: "❌", nombre: "Error del bot" },
  indebida: { simbolo: "🔴", nombre: "Respuesta indebida (alucinó o incoherente)" },
  corregida: { simbolo: "⚠️", nombre: "La IA inventó algo y se corrigió" },
  queja: { simbolo: "👎", nombre: "El cliente se quejó" },
};

const TURNOS_DIAS = 60;

const CREAR_TURNOS = `
  CREATE TABLE IF NOT EXISTS turnos (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    igsid     TEXT NOT NULL,
    cuando    INTEGER NOT NULL,
    cliente   TEXT NOT NULL DEFAULT '',
    pienso    TEXT NOT NULL DEFAULT '',
    buscar    TEXT NOT NULL DEFAULT '',
    mostrar   TEXT NOT NULL DEFAULT '',
    respuesta TEXT NOT NULL DEFAULT '',
    productos TEXT NOT NULL DEFAULT '[]',
    notas     TEXT NOT NULL DEFAULT '[]',
    marca     TEXT NOT NULL DEFAULT '',
    motivo    TEXT NOT NULL DEFAULT ''
  )
`;

let turnosListos = false;

// La tabla se creó sin "marca" ni "motivo" en la versión anterior: se
// añaden solas (como todo lo de la base, sin migraciones a mano).
export async function asegurarTurnos(db) {
  if (turnosListos) return;
  await db.prepare(CREAR_TURNOS).run();
  for (const columna of ["marca", "motivo"]) {
    try {
      await db.prepare(`ALTER TABLE turnos ADD COLUMN ${columna} TEXT NOT NULL DEFAULT ''`).run();
    } catch {
      // Ya estaba.
    }
  }
  // Para abrir un chat y contar el día sin leer la tabla entera.
  await db.prepare("CREATE INDEX IF NOT EXISTS turnos_igsid ON turnos (igsid, cuando)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS turnos_cuando ON turnos (cuando)").run();
  turnosListos = true;
}

// Las redes que corrigen a la IA dejan su nota en el turno: si hay una,
// la IA inventó algo (aunque no le llegara al cliente).
// (No cuentan los retoques de estilo, como cambiar "¿quieres el precio?"
// por "está en cada foto": eso no es inventar.)
const NOTA_DE_CORRECCION = /grosería|regaño|marca que no hay|Cashea: se corrigi|inventad|contradec|precio que no era/i;

// Devuelve el id del turno, para poder marcarlo después (revisor, queja).
// Con "env", si el turno nace marcado (error, corregida), el panel central
// se entera en el momento.
export async function anotarTurno(db, turno, env = null) {
  if (!db || !turno?.igsid) return 0;
  try {
    await asegurarTurnos(db);
    const notas = (turno.notas || []).filter(Boolean).slice(0, 12);
    const marca = turno.marca || (notas.some((n) => NOTA_DE_CORRECCION.test(n)) ? "corregida" : "");
    const motivo = turno.motivo || (marca === "corregida" ? notas.find((n) => NOTA_DE_CORRECCION.test(n)) : "") || "";
    await db
      .prepare(
        "INSERT INTO turnos (igsid, cuando, cliente, pienso, buscar, mostrar, respuesta, productos, notas, marca, motivo) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        String(turno.igsid),
        Date.now(),
        String(turno.cliente || "").slice(0, 1000),
        String(turno.pienso || "").slice(0, 1000),
        String(turno.buscar || "").slice(0, 200),
        String(turno.mostrar || ""),
        String(turno.respuesta || "").slice(0, 2000),
        JSON.stringify((turno.productos || []).slice(0, 10)),
        JSON.stringify(notas),
        marca,
        String(motivo).slice(0, 300)
      )
      .run();
    const fila = await db.prepare("SELECT MAX(id) AS id FROM turnos WHERE igsid = ?").bind(String(turno.igsid)).first();
    if (env && marca) {
      await alertarCentral(env, [
        { tipo: marca, texto: `${motivo || marca}\nRespondió: "${String(turno.respuesta || "").slice(0, 200)}"`, igsid: String(turno.igsid) },
      ]);
    }
    if (Math.random() < 0.02) {
      await db.prepare("DELETE FROM turnos WHERE cuando < ?").bind(Date.now() - TURNOS_DIAS * 86400000).run();
    }
    return Number(fila?.id) || 0;
  } catch (error) {
    // Guardar esto es un extra: nunca deja a un cliente sin respuesta.
    console.error("No pude anotar el turno para el panel:", error?.message || error);
    return 0;
  }
}

// Una marca más grave no la pisa una más leve: un error sigue siendo error
// aunque luego el cliente se queje.
const GRAVEDAD = { "": 0, queja: 1, corregida: 2, indebida: 3, error: 4 };

export async function marcarTurno(db, id, marca, motivo = "") {
  if (!db || !id || !MARCAS[marca]) return;
  try {
    await asegurarTurnos(db);
    const fila = await db.prepare("SELECT marca FROM turnos WHERE id = ?").bind(Number(id)).first();
    if (!fila || (GRAVEDAD[fila.marca] || 0) > GRAVEDAD[marca]) return;
    await db.prepare("UPDATE turnos SET marca = ?, motivo = ? WHERE id = ?").bind(marca, String(motivo).slice(0, 300), Number(id)).run();
  } catch {}
}

// La queja de un cliente marca la ÚLTIMA respuesta que recibió.
export async function marcarUltimoTurno(db, igsid, marca, motivo = "") {
  if (!db || !igsid) return;
  try {
    await asegurarTurnos(db);
    const fila = await db
      .prepare("SELECT id FROM turnos WHERE igsid = ? ORDER BY cuando DESC, id DESC LIMIT 1")
      .bind(String(igsid))
      .first();
    if (fila?.id) await marcarTurno(db, fila.id, marca, motivo);
  } catch {}
}

export const TABLAS = { CREAR_ERRORES, CREAR_AVISOS, CREAR_TURNOS };

/* ── EN TIEMPO REAL, AL PANEL CENTRAL ─────────────────────────────── */

// Lo que el cliente escribe cuando el bot le contestó mal. No es un
// insulto suelto (eso lo atiende el tono): es una queja sobre la respuesta.
const QUEJA =
  /\b(no\s+es\s+(?:eso|ese|esa|esos|lo\s+que)|no\s+te\s+(?:pregunt|ped)\w*|no\s+(?:me\s+)?entiendes|no\s+entendiste|respond(?:es|iste)\s+mal|contestas?\s+mal|est[aá]s\s+ciego|nada\s+que\s+ver|te\s+pregunt[eé]\s+otra|eso\s+no\s+(?:fue\s+lo\s+que|es\s+lo\s+que)|otra\s+vez\s+lo\s+mismo|ya\s+te\s+(?:dije|lo\s+dije)|no\s+sirves|bot\s+(?:de\s+mierda|in[uú]til|malo)|eres\s+un\s+robot|habla\s+con\s+una\s+persona|quiero\s+(?:hablar\s+con\s+)?(?:una\s+persona|un\s+humano|un\s+asesor))/i;

export function esQueja(texto) {
  return QUEJA.test(String(texto || ""));
}

// Lo que escribió el cliente: si suena a "me contestaste mal", al central.
export async function vigilarQueja(env, igsid, texto) {
  if (!esQueja(texto)) return;
  console.log(`QUEJA del cliente ${igsid}: ${String(texto).slice(0, 80)} → aviso al panel central`);
  await marcarUltimoTurno(env?.DB, igsid, "queja", `El cliente dijo: "${String(texto).slice(0, 120)}"`);
  await alertarCentral(env, [{ tipo: "queja", texto: String(texto).slice(0, 300), igsid }]);
}

export function centralConectado(env) {
  return /^https:\/\//i.test(String(env?.PANEL_CENTRAL_URL || "")) && String(env?.PANEL_API_CLAVE || "").length >= 16;
}

// Le manda al panel central lo que acaba de pasar. Nunca lanza, y nunca
// espera más de 4 segundos: un aviso que no sale no puede costar una
// respuesta al cliente.
export async function alertarCentral(env, alertas = []) {
  if (!centralConectado(env) || !alertas.length) return false;
  try {
    const r = await fetch(`${String(env.PANEL_CENTRAL_URL).replace(/\/+$/, "")}/api/alerta`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.PANEL_API_CLAVE}` },
      body: JSON.stringify({ tienda: String(env.TIENDA_ID || ""), alertas }),
      signal: AbortSignal.timeout(4000),
    });
    return r.ok;
  } catch {
    return false;
  }
}
