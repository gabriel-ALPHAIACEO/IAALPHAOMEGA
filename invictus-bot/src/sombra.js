// EL RESPALDO (16-oct-2026, giro del dueño: "la IA sombra gratis realmente no
// nos sirve de nada, solo servirá de respaldo por si el sistema se cae, y
// cuando paguemos los Workers es que se usará al 100% para respaldar").
//
// MODO POR DEFECTO = "respaldo": la IA sin costo NO corre en paralelo (eso
// gastaba la cuota midiendo sin aportar). Se queda quieta hasta que la de pago
// (OpenAI) no responde —sin saldo, límite del minuto, caída—; entonces contesta
// ELLA, con el mismo prompt y los ejemplos aprendidos, en vez del «se me trabó
// el sistema». Su respuesta pasa por TODAS las redes de seguridad de siempre
// (tono, precios, Cashea, datos de la tienda), el panel la marca como
// «respondió la IA de respaldo» y el dueño recibe UN aviso (cada 30 min) de que
// la de pago está fallando. Los ejemplos de la de pago se siguen juntando en
// cada mensaje, sin llamar a nadie: así el respaldo ya sabe cómo contesta la
// tienda cuando le toca.
//   SOMBRA_MODO  "respaldo" (por defecto) | "sombra" (la comparación en
//                paralelo de abajo) | "ambos".
//   RESPALDO_MAX_DIA  tope de respaldos al día (400): es lo que limita el gasto
//                cuando la cuota gratis ya no es el límite (cuenta de pago).
//
// LA IA SOMBRA (16-oct-2026, pedido del dueño: "vamos a ir trabajando sobre
// las IA sin pagar api key… usar por ahora los 2 en paralelo para que las IA
// aprendan de las otras IA").
//
// QUÉ ES. Una segunda IA, GRATIS, que lee cada conversación en paralelo a la
// de pago (OpenAI) y escribe en secreto qué habría contestado. NUNCA le habla
// al cliente: el cliente sigue recibiendo lo de siempre. Corre DESPUÉS de que
// la respuesta ya salió (igual que el revisor), así que no retrasa a nadie, y
// si falla no pasa nada.
//
// CÓMO APRENDE DE LA OTRA (sin entrenar nada, sin pagar):
//   1. LOS EJEMPLOS DEL MAESTRO. Cada respuesta de la IA de pago —la que
//      realmente vio el cliente, con las redes de seguridad ya aplicadas— se
//      guarda como ejemplo (tabla ia_ejemplos) salvo que el revisor la haya
//      marcado mal. Cuando la IA gratis va a contestar, recibe además los 3
//      ejemplos más parecidos a lo que escribió el cliente: "así contestó bien
//      la asistente principal en casos parecidos". Cuantos más mensajes pasan,
//      más aprende. Estos ejemplos se juntan en CADA mensaje, sin llamar a la
//      IA gratis: la cuota gratis no limita lo que se aprende, solo cuánto se
//      mide (ver abajo).
//   2. LA COMPARACIÓN. Cada respuesta de la gratis se compara con la de pago
//      (¿buscó lo mismo? ¿decidió igual enseñar fotos o solo texto? ¿dijo algo
//      parecido? ¿inventó algún número que la otra no dijo?) y se guarda con
//      un puntaje (tabla ia_sombra). Ver /sombra.
//   3. EL VEREDICTO. Cuando suficientes respuestas coinciden y no inventa
//      datos, /sombra dice «lista para tomar el mando». Hasta entonces, la de
//      pago sigue contestando sola.
//   4. EL MATERIAL PARA ENTRENAR. /sombra/ejemplos.jsonl baja todos los
//      ejemplos del maestro por si algún día se quiere afinar un modelo propio.
//
// LA CUOTA. Cloudflare Workers AI regala 10.000 «neuronas» al día (se reinicia
// a las 00:00 UTC) y el prompt de esta tienda es largo (~25.000 tokens), así
// que cada llamada gasta bastante. Por eso hay un TOPE DIARIO de llamadas
// (SOMBRA_MAX_DIA, 12) y, si Cloudflare dice que la cuota se acabó, la sombra
// descansa hasta el día siguiente. Una cuenta de pago de Cloudflare cobra lo
// que pase de la cuota gratis ($0,011 por 1.000 neuronas): el tope de llamadas
// es lo que lo limita a centavos.
//
// SE ENCIENDE con SOMBRA = "si" en wrangler.toml. Proveedores:
//   · "cloudflare" (por defecto): Workers AI, SIN CLAVE (binding [ai] AI).
//   · "compatible": cualquier servicio con API estilo OpenAI y plan gratis
//     (Gemini, Groq…): SOMBRA_URL + el secreto SOMBRA_CLAVE.

import { armarPedidoDeTexto, leerRespuestaDelModelo } from "./ia.js";
import { noHaceFaltaRevisar } from "./revisor.js";
import { alertarCentral } from "./registro.js";

export const MODELO_POR_DEFECTO = "@cf/meta/llama-4-scout-17b-16e-instruct";
const MAXIMO_POR_DIA = 12;
const EJEMPLOS_POR_DEFECTO = 3;
const MAXIMO_DE_EJEMPLOS = 600;
// Cloudflare corta las tareas de segundo plano a los ~30 s: la gratis tiene que
// contestar antes, y aprender de la de pago NO depende de que conteste.
const TIEMPO_MAXIMO_MS = 25000;

const TABLAS = [
  `CREATE TABLE IF NOT EXISTS ia_ejemplos (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    cuando    INTEGER NOT NULL,
    turno     INTEGER NOT NULL DEFAULT 0,
    cliente   TEXT NOT NULL,
    respuesta TEXT NOT NULL,
    buscar    TEXT NOT NULL DEFAULT 'NADA',
    mostrar   TEXT NOT NULL DEFAULT 'texto_e_imagenes',
    bueno     INTEGER NOT NULL DEFAULT 1,
    revisado  INTEGER NOT NULL DEFAULT 0
  )`,
  "CREATE INDEX IF NOT EXISTS ia_ejemplos_bueno ON ia_ejemplos (bueno, id)",
  `CREATE TABLE IF NOT EXISTS ia_sombra (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    cuando         INTEGER NOT NULL,
    dia            TEXT NOT NULL,
    turno          INTEGER NOT NULL DEFAULT 0,
    cliente        TEXT NOT NULL DEFAULT '',
    paga_respuesta TEXT NOT NULL DEFAULT '',
    paga_buscar    TEXT NOT NULL DEFAULT '',
    paga_mostrar   TEXT NOT NULL DEFAULT '',
    libre_respuesta TEXT NOT NULL DEFAULT '',
    libre_buscar   TEXT NOT NULL DEFAULT '',
    libre_mostrar  TEXT NOT NULL DEFAULT '',
    proveedor      TEXT NOT NULL DEFAULT '',
    modelo         TEXT NOT NULL DEFAULT '',
    ejemplos       INTEGER NOT NULL DEFAULT 0,
    ms             INTEGER NOT NULL DEFAULT 0,
    tokens_entrada INTEGER NOT NULL DEFAULT 0,
    tokens_salida  INTEGER NOT NULL DEFAULT 0,
    mismo_buscar   INTEGER NOT NULL DEFAULT 0,
    mismo_modo     INTEGER NOT NULL DEFAULT 0,
    parecido       REAL NOT NULL DEFAULT 0,
    inventa        INTEGER NOT NULL DEFAULT 0,
    puntaje        REAL NOT NULL DEFAULT 0,
    error          TEXT NOT NULL DEFAULT ''
  )`,
  "CREATE INDEX IF NOT EXISTS ia_sombra_dia ON ia_sombra (dia, id)",
  // Cada vez que contestó el respaldo porque la de pago falló.
  `CREATE TABLE IF NOT EXISTS ia_respaldo (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    cuando         INTEGER NOT NULL,
    dia            TEXT NOT NULL,
    cliente        TEXT NOT NULL DEFAULT '',
    respuesta      TEXT NOT NULL DEFAULT '',
    modelo         TEXT NOT NULL DEFAULT '',
    ms             INTEGER NOT NULL DEFAULT 0,
    tokens_entrada INTEGER NOT NULL DEFAULT 0,
    tokens_salida  INTEGER NOT NULL DEFAULT 0,
    ok             INTEGER NOT NULL DEFAULT 1,
    error          TEXT NOT NULL DEFAULT ''
  )`,
  "CREATE INDEX IF NOT EXISTS ia_respaldo_dia ON ia_respaldo (dia, id)",
];

const listas = new WeakSet();
export async function asegurarSombra(db) {
  if (listas.has(db)) return;
  for (const sentencia of TABLAS) await db.prepare(sentencia).run();
  listas.add(db);
}

/* ── Configuración ───────────────────────────────────────────────────── */

const SI = /^(si|sí|true|1|on)$/i;

export function proveedorDeLaSombra(env = {}) {
  return String(env.SOMBRA_PROVEEDOR || "").toLowerCase() === "compatible" ? "compatible" : "cloudflare";
}

export function modeloDeLaSombra(env = {}) {
  return String(env.SOMBRA_MODELO || "").trim() || (proveedorDeLaSombra(env) === "compatible" ? "gemini-2.0-flash" : MODELO_POR_DEFECTO);
}

// "respaldo" (por defecto), "sombra" o "ambos".
export function modoDeLaSombra(env = {}) {
  const m = String(env.SOMBRA_MODO || "").trim().toLowerCase();
  return m === "sombra" || m === "ambos" ? m : "respaldo";
}

// ¿Está encendida Y tiene con qué correr? (Sin el binding [ai] o sin la
// dirección y la clave no hay nada que llamar: se queda quieta.)
export function sombraActiva(env = {}) {
  if (!SI.test(String(env.SOMBRA || "").trim())) return false;
  return proveedorDeLaSombra(env) === "compatible" ? Boolean(env.SOMBRA_URL && env.SOMBRA_CLAVE) : Boolean(env.AI && typeof env.AI.run === "function");
}

// La comparación en paralelo (modo "sombra" o "ambos").
export function sombraParalelaActiva(env = {}) {
  return sombraActiva(env) && modoDeLaSombra(env) !== "respaldo";
}

// Contestar cuando la de pago no responde (modo "respaldo" o "ambos").
export function respaldoActivo(env = {}) {
  return sombraActiva(env) && modoDeLaSombra(env) !== "sombra";
}

export function maximoDeRespaldos(env = {}) {
  const n = Number(env.RESPALDO_MAX_DIA);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 400;
}

export function maximoPorDia(env = {}) {
  const n = Number(env.SOMBRA_MAX_DIA);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : MAXIMO_POR_DIA;
}

function cuantosEjemplos(env = {}) {
  const n = Number(env.SOMBRA_EJEMPLOS);
  return Number.isFinite(n) && n >= 0 ? Math.min(8, Math.floor(n)) : EJEMPLOS_POR_DEFECTO;
}

// El día de Cloudflare: la cuota se reinicia a las 00:00 UTC.
export function diaUtc(ahora = Date.now()) {
  return new Date(ahora).toISOString().slice(0, 10);
}

/* ── Palabras y parecido ─────────────────────────────────────────────── */

const SIN_VALOR = new Set(["para", "por", "con", "los", "las", "una", "uno", "que", "del", "esta", "este", "como", "hay", "tiene", "tienen", "mas", "pero", "sus", "muy", "son", "ese", "esa", "nos", "les", "ustedes", "aqui", "alli", "hola", "gracias", "buenas", "buenos", "dias", "tardes", "noches"]);

export function palabras(texto) {
  const lista = String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, " ")
    .split(" ")
    .filter((p) => p.length > 2 && !SIN_VALOR.has(p));
  return new Set(lista);
}

function jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  let comunes = 0;
  for (const x of a) if (b.has(x)) comunes++;
  return comunes / (a.size + b.size - comunes);
}

function coseno(a, b) {
  if (!a.size || !b.size) return 0;
  let comunes = 0;
  for (const x of a) if (b.has(x)) comunes++;
  return comunes / Math.sqrt(a.size * b.size);
}

const NUMEROS = /\d+(?:[.,]\d+)?/g;
function numerosDe(texto) {
  return new Set((String(texto ?? "").match(NUMEROS) || []).filter((n) => n.length >= 2 || /[.,]/.test(n)));
}

// Paga = lo que realmente vio el cliente (con las redes ya aplicadas).
// Libre = lo que contestó la IA gratis. entrada = lo que ambas leyeron.
export function compararRespuestas(paga, libre, entrada = "") {
  const buscaPaga = String(paga.buscar || "NADA").trim();
  const buscaLibre = String(libre.buscar || "NADA").trim();
  const nadaPaga = /^nada$/i.test(buscaPaga);
  const nadaLibre = /^nada$/i.test(buscaLibre);
  const mismoBuscar = nadaPaga || nadaLibre ? nadaPaga === nadaLibre : jaccard(palabras(buscaPaga), palabras(buscaLibre)) >= 0.6;
  const mismoModo = (paga.mostrar || "texto_e_imagenes") === (libre.mostrar || "texto_e_imagenes");
  const parecido = jaccard(palabras(paga.respuesta), palabras(libre.respuesta));
  // Un número que dice la gratis y no está ni en lo que dijo la de pago ni en
  // lo que ambas leyeron (precios, tallas, horas): se lo inventó.
  const conocidos = new Set([...numerosDe(paga.respuesta), ...numerosDe(entrada)]);
  const nuevos = [...numerosDe(libre.respuesta)].filter((n) => !conocidos.has(n));
  const inventa = nuevos.length > 0;
  let puntaje = 0.4 * (mismoBuscar ? 1 : 0) + 0.2 * (mismoModo ? 1 : 0) + 0.4 * parecido;
  if (inventa) puntaje -= 0.5;
  puntaje = Math.max(0, Math.min(1, puntaje));
  return { mismoBuscar, mismoModo, parecido: Math.round(parecido * 1000) / 1000, inventa, inventados: nuevos.slice(0, 5), puntaje: Math.round(puntaje * 1000) / 1000 };
}

/* ── Los ejemplos del maestro ───────────────────────────────────────── */

// Guarda lo que contestó la IA de pago, para que la gratis aprenda de ahí.
// bueno = 0 si el revisor la marcó mal (esas NO se imitan).
export async function guardarEjemplo(db, { turno = 0, cliente, respuesta, buscar = "NADA", mostrar = "texto_e_imagenes", bueno = true, revisado = false }) {
  await asegurarSombra(db);
  const c = String(cliente || "").replace(/^🎤\s*/, "").trim().slice(0, 400);
  const r = String(respuesta || "").replace(/^🎤 \(nota de voz\)\s*/, "").trim().slice(0, 1500);
  if (c.length < 2 || r.length < 2) return false;
  const repetido = await db.prepare("SELECT id FROM ia_ejemplos WHERE cliente = ? AND respuesta = ? LIMIT 1").bind(c, r).first();
  if (repetido) return false;
  await db
    .prepare("INSERT INTO ia_ejemplos (cuando, turno, cliente, respuesta, buscar, mostrar, bueno, revisado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(Date.now(), Number(turno) || 0, c, r, String(buscar || "NADA").slice(0, 120), String(mostrar || "texto_e_imagenes"), bueno ? 1 : 0, revisado ? 1 : 0)
    .run();
  // Solo los últimos: la tabla no crece sin fin.
  await db.prepare("DELETE FROM ia_ejemplos WHERE id <= (SELECT id FROM ia_ejemplos ORDER BY id DESC LIMIT 1 OFFSET ?)").bind(MAXIMO_DE_EJEMPLOS).run();
  return true;
}

// Los ejemplos buenos más parecidos a lo que escribió el cliente.
// «excluirTurno»: el turno que se está contestando ahora. Su respuesta de pago
// puede estar ya guardada, y la gratis no puede copiarla (sería hacer trampa).
export async function ejemplosParecidos(db, textoCliente, cuantos = EJEMPLOS_POR_DEFECTO, excluirTurno = 0) {
  if (!cuantos) return [];
  await asegurarSombra(db);
  const mios = palabras(textoCliente);
  if (!mios.size) return [];
  const { results } = await db.prepare("SELECT cliente, respuesta, buscar, mostrar, revisado FROM ia_ejemplos WHERE bueno = 1 AND turno <> ? ORDER BY id DESC LIMIT 300").bind(Number(excluirTurno) || 0).all();
  const puntuados = (results || [])
    .map((e) => ({ e, puntos: coseno(mios, palabras(e.cliente)) + (e.revisado ? 0.1 : 0) }))
    .filter((x) => x.puntos >= 0.3)
    .sort((a, b) => b.puntos - a.puntos);
  const vistos = new Set();
  const salida = [];
  for (const { e } of puntuados) {
    if (vistos.has(e.respuesta)) continue;
    vistos.add(e.respuesta);
    salida.push(e);
    if (salida.length >= cuantos) break;
  }
  return salida;
}

export function bloqueDeEjemplos(ejemplos) {
  if (!ejemplos.length) return "";
  return [
    "EJEMPLOS DE CÓMO CONTESTÓ BIEN LA ASISTENTE PRINCIPAL EN CASOS PARECIDOS (imita su tono y sus decisiones; los datos reales —precios, tallas, modelos— salen SIEMPRE de la conversación y del catálogo de arriba, nunca de estos ejemplos):",
    ...ejemplos.map((e, i) => `${i + 1}. El cliente escribió: «${e.cliente}»\n   Ella respondió: «${e.respuesta}»${/^nada$/i.test(e.buscar) ? "" : ` (y buscó: ${e.buscar})`}`),
  ].join("\n");
}

const FORMATO =
  'RESPONDE SOLO CON UN OBJETO JSON (sin texto antes ni después, sin ```), con EXACTAMENTE estas claves: "pienso" (string: razona primero qué te piden), "mostrar" ("texto", "texto_e_imagenes" o "imagenes"), "voz" (true o false), "respuesta" (string: lo que ve el cliente), "buscar" (string: el término de búsqueda como aparece en el catálogo, o "NADA"), "historial" (string: memoria para el próximo mensaje).';

/* ── Llamar a la IA gratis ───────────────────────────────────────────── */

function sinClave(texto, env) {
  let t = String(texto ?? "");
  for (const s of [env.SOMBRA_CLAVE]) if (s && String(s).length >= 4) t = t.split(String(s)).join("***");
  return t.slice(0, 300);
}

// Lo que devuelven los distintos modelos: { response }, estilo OpenAI
// (choices) o el formato de «responses» (output).
export function textoDeLaRespuesta(r) {
  if (!r) return "";
  if (typeof r === "string") return r;
  const x = r.result ?? r;
  if (typeof x.response === "string") return x.response;
  if (x.response && typeof x.response === "object") return JSON.stringify(x.response);
  const c = x.choices?.[0]?.message?.content ?? x.choices?.[0]?.text;
  if (typeof c === "string") return c;
  if (Array.isArray(x.output)) {
    // Solo el mensaje, nunca el razonamiento del modelo.
    return x.output
      .filter((o) => o?.type !== "reasoning")
      .flatMap((o) => (Array.isArray(o.content) ? o.content : []))
      .filter((p) => p?.type === "output_text" || (p?.type === undefined && typeof p?.text === "string"))
      .map((p) => p.text)
      .join("");
  }
  return "";
}

function conTiempo(promesa, ms) {
  let reloj;
  const tope = new Promise((_, rechazar) => (reloj = setTimeout(() => rechazar(new Error(`no contestó en ${Math.round(ms / 1000)} s`)), ms)));
  return Promise.race([promesa, tope]).finally(() => clearTimeout(reloj));
}

export async function llamarALaGratis(env, sistema, contenido, { maxTokens = 1024 } = {}) {
  const modelo = modeloDeLaSombra(env);
  const messages = [
    { role: "system", content: sistema },
    { role: "user", content: contenido },
  ];
  if (proveedorDeLaSombra(env) === "compatible") {
    const r = await fetch(env.SOMBRA_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.SOMBRA_CLAVE}` },
      body: JSON.stringify({ model: modelo, messages, max_tokens: maxTokens, temperature: 0.3, response_format: { type: "json_object" } }),
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
    });
    const crudo = await r.text();
    if (!r.ok) throw new Error(`contestó ${r.status}: ${sinClave(crudo, env).slice(0, 200)}`);
    let datos = {};
    try {
      datos = JSON.parse(crudo);
    } catch {}
    return { texto: textoDeLaRespuesta(datos), entrada: datos.usage?.prompt_tokens || 0, salida: datos.usage?.completion_tokens || 0 };
  }
  // Workers AI, sin clave: el binding. Algunos modelos aceptan «modo JSON» y
  // otros no: se intenta con él y, si lo rechaza, sin él.
  const razona = /gpt-oss/i.test(modelo) ? { reasoning: { effort: "low" } } : {};
  const pedir = (extra) => conTiempo(env.AI.run(modelo, { messages, max_tokens: maxTokens, temperature: 0.3, ...razona, ...extra }), TIEMPO_MAXIMO_MS);
  let r;
  try {
    r = /gpt-oss/i.test(modelo) ? await pedir({}) : await pedir({ response_format: { type: "json_object" } });
  } catch (error) {
    if (!/response_format|json|schema|unsupported|not supported/i.test(String(error?.message))) throw error;
    r = await pedir({});
  }
  const u = (r?.result ?? r)?.usage || {};
  return { texto: textoDeLaRespuesta(r), entrada: u.prompt_tokens || u.input_tokens || 0, salida: u.completion_tokens || u.output_tokens || 0 };
}

/* ── El tope del día ─────────────────────────────────────────────────── */

// «agotado»: Cloudflare dijo hace menos de 30 minutos que la cuota se acabó.
// Pasado ese rato se vuelve a intentar (si mientras tanto pasaron a una cuenta
// de pago, vuelve a funcionar sin esperar al día siguiente).
const REINTENTO_AGOTADO_MS = 30 * 60 * 1000;
export async function llamadasDeHoy(db, ahora = Date.now()) {
  await asegurarSombra(db);
  const f = await db.prepare("SELECT COUNT(*) AS n FROM ia_sombra WHERE dia = ?").bind(diaUtc(ahora)).first();
  const a = await db.prepare("SELECT MAX(cuando) AS ultima FROM (SELECT cuando FROM ia_sombra WHERE error LIKE 'agotado%' UNION ALL SELECT cuando FROM ia_respaldo WHERE error LIKE 'agotado%')").first();
  return { n: Number(f?.n) || 0, agotado: Boolean(a?.ultima) && ahora - Number(a.ultima) < REINTENTO_AGOTADO_MS };
}

const CUOTA_AGOTADA = /neuron|quota|allocation|limit|exceeded|capacity|4006|3036|too many/i;

/* ── El turno: consultar a la gratis y anotar ───────────────────────── */

// «datos»: { entrada, textoCliente } — lo que leyó la IA de pago. Devuelve lo
// que contestó la gratis (o por qué no), sin lanzar nunca un error.
export async function consultarSombra(env, datos, { turno = null, ahora = Date.now() } = {}) {
  if (!sombraActiva(env) || !env.DB || !datos?.entrada) return null;
  try {
    await asegurarSombra(env.DB);
    if (turno && noHaceFaltaRevisar(turno)) return { saltada: "cortesia" };
    const hoy = await llamadasDeHoy(env.DB, ahora);
    if (hoy.agotado) return { saltada: "cuota-agotada" };
    if (hoy.n >= maximoPorDia(env)) return { saltada: "tope-del-dia" };
    const ejemplos = await ejemplosParecidos(env.DB, datos.textoCliente, cuantosEjemplos(env), turno?.id);
    const { sistema, contenido } = await armarPedidoDeTexto(env, datos.entrada);
    const pedido = [bloqueDeEjemplos(ejemplos), contenido, FORMATO].filter(Boolean).join("\n\n");
    const inicio = Date.now();
    try {
      const r = await llamarALaGratis(env, sistema, pedido);
      return { ...r, ms: Date.now() - inicio, ejemplos: ejemplos.length, libre: leerRespuestaDelModelo(r.texto) };
    } catch (error) {
      const motivo = sinClave(error?.message || error, env);
      return { error: CUOTA_AGOTADA.test(motivo) ? `agotado: ${motivo}` : motivo, ms: Date.now() - inicio, ejemplos: ejemplos.length };
    }
  } catch (error) {
    console.error("SOMBRA:", sinClave(error?.message || error, env));
    return null;
  }
}

// APRENDER DE LA DE PAGO: guarda lo que contestó (lo que realmente vio el
// cliente) como ejemplo. Va aparte de la consulta a la gratis a propósito: no
// espera a que ella conteste, así que aprender nunca depende de la cuota ni de
// que el modelo gratis esté vivo. bueno = 0 si el revisor la marcó mal (esas
// NO se imitan). Nunca lanza.
export async function aprenderDelMaestro(env, datos, veredicto, turno) {
  try {
    if (!env.DB || !turno?.id || !sombraActiva(env)) return false;
    const malo = veredicto && veredicto.veredicto && veredicto.veredicto !== "bien";
    return await guardarEjemplo(env.DB, {
      turno: turno.id,
      cliente: turno.cliente,
      respuesta: turno.respuesta,
      buscar: datos?.salida?.buscar,
      mostrar: datos?.salida?.mostrar,
      bueno: !malo,
      revisado: Boolean(veredicto),
    });
  } catch (error) {
    console.error("SOMBRA (aprender):", sinClave(error?.message || error, env));
    return false;
  }
}

// Guarda la comparación de las dos respuestas. Nunca lanza.
export async function anotarSombra(env, datos, consulta, turno, ahora = Date.now()) {
  try {
    if (!env.DB || !turno?.id || !consulta || consulta.saltada) return;
    const db = env.DB;
    await asegurarSombra(db);
    const base = { cuando: ahora, dia: diaUtc(ahora), turno: turno.id, cliente: String(turno.cliente || "").slice(0, 400), proveedor: proveedorDeLaSombra(env), modelo: modeloDeLaSombra(env) };
    const paga = { respuesta: String(turno.respuesta || ""), buscar: datos?.salida?.buscar, mostrar: datos?.salida?.mostrar };
    const libre = consulta.libre;
    const cmp = libre ? compararRespuestas(paga, libre, datos?.entrada) : { mismoBuscar: false, mismoModo: false, parecido: 0, inventa: false, puntaje: 0 };
    const error = consulta.error || (libre ? "" : "no devolvió un JSON que se entienda");
    await db
      .prepare(
        `INSERT INTO ia_sombra (cuando, dia, turno, cliente, paga_respuesta, paga_buscar, paga_mostrar, libre_respuesta, libre_buscar, libre_mostrar, proveedor, modelo, ejemplos, ms, tokens_entrada, tokens_salida, mismo_buscar, mismo_modo, parecido, inventa, puntaje, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        base.cuando, base.dia, base.turno, base.cliente,
        paga.respuesta.slice(0, 1500), String(paga.buscar || "NADA").slice(0, 120), String(paga.mostrar || ""),
        String(libre?.respuesta || "").slice(0, 1500), String(libre?.buscar || "").slice(0, 120), String(libre?.mostrar || ""),
        base.proveedor, base.modelo, consulta.ejemplos || 0, consulta.ms || 0, consulta.entrada || 0, consulta.salida || 0,
        cmp.mismoBuscar ? 1 : 0, cmp.mismoModo ? 1 : 0, cmp.parecido, cmp.inventa ? 1 : 0, cmp.puntaje, String(error).slice(0, 300)
      )
      .run();
  } catch (error) {
    console.error("SOMBRA (anotar):", sinClave(error?.message || error, env));
  }
}

/* ── El respaldo: contesta cuando la de pago no responde ─────────────── */

const AVISO_CADA_MS = 30 * 60 * 1000;

export async function respaldosDeHoy(db, ahora = Date.now()) {
  await asegurarSombra(db);
  const f = await db.prepare("SELECT COUNT(*) AS n FROM ia_respaldo WHERE dia = ?").bind(diaUtc(ahora)).first();
  return Number(f?.n) || 0;
}

// La IA de pago no respondió: contesta la de respaldo. Devuelve lo mismo que
// responderTexto (respuesta, buscar, mostrar…) o null si tampoco puede (sin
// cupo, tope del día, apagada, o ella también falló): en ese caso todo sigue
// como antes, con el «se me trabó el sistema». Nunca lanza.
export async function responderConRespaldo(env, entrada, textoCliente = "", { ahora = Date.now() } = {}) {
  if (!respaldoActivo(env) || !env.DB || !entrada) return null;
  const db = env.DB;
  try {
    await asegurarSombra(db);
    const hoy = await llamadasDeHoy(db, ahora);
    if (hoy.agotado) return null;
    if ((await respaldosDeHoy(db, ahora)) >= maximoDeRespaldos(env)) return null;
    const ejemplos = await ejemplosParecidos(db, textoCliente, cuantosEjemplos(env));
    const { sistema, contenido } = await armarPedidoDeTexto(env, entrada);
    const pedido = [bloqueDeEjemplos(ejemplos), contenido, FORMATO].filter(Boolean).join("\n\n");
    const inicio = Date.now();
    let r = null;
    let libre = null;
    let error = "";
    // Dos intentos solo si el primero no devolvió un JSON entendible (pasa con
    // los modelos chicos); un error de la API no se repite.
    for (let intento = 0; intento < 2 && !libre && !error; intento++) {
      try {
        r = await llamarALaGratis(env, sistema, pedido);
        libre = leerRespuestaDelModelo(r.texto);
      } catch (e) {
        const motivo = sinClave(e?.message || e, env);
        error = CUOTA_AGOTADA.test(motivo) ? `agotado: ${motivo}` : motivo;
      }
    }
    if (!libre && !error) error = "no devolvió un JSON que se entienda";
    // El aviso al dueño: la primera vez y luego cada 30 minutos, no en cada mensaje.
    const antes = await db.prepare("SELECT MAX(cuando) AS ultima FROM ia_respaldo").first();
    const avisar = !antes?.ultima || ahora - Number(antes.ultima) >= AVISO_CADA_MS;
    await db
      .prepare("INSERT INTO ia_respaldo (cuando, dia, cliente, respuesta, modelo, ms, tokens_entrada, tokens_salida, ok, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(ahora, diaUtc(ahora), String(textoCliente || "").slice(0, 400), String(libre?.respuesta || "").slice(0, 1500), modeloDeLaSombra(env), Date.now() - inicio, r?.entrada || 0, r?.salida || 0, libre ? 1 : 0, error.slice(0, 300))
      .run();
    if (avisar) {
      await alertarCentral(env, [
        {
          tipo: "error",
          texto: libre
            ? "⚙️ La IA de pago (OpenAI) no está respondiendo (¿sin saldo o caída?): está contestando la IA de respaldo. Revisa platform.openai.com → Billing."
            : `⚙️ La IA de pago (OpenAI) no responde y la de respaldo tampoco pudo (${error.slice(0, 120)}). Los clientes reciben el aviso de «se me trabó el sistema».`,
        },
      ]).catch(() => {});
    }
    if (!libre) return null;
    // Nada de nota de voz: la voz también es de OpenAI y si no responde, tampoco.
    return { ...libre, voz: false };
  } catch (error) {
    console.error("RESPALDO:", sinClave(error?.message || error, env));
    return null;
  }
}

/* ── El informe ──────────────────────────────────────────────────────── */

export const MINIMO_PARA_OPINAR = 50;

export async function resumenDeLaSombra(db, { dias = 14, ahora = Date.now() } = {}) {
  await asegurarSombra(db);
  const desde = diaUtc(ahora - (dias - 1) * 86400000);
  const f = await db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN error = '' THEN 1 ELSE 0 END) AS validos,
              SUM(CASE WHEN error <> '' THEN 1 ELSE 0 END) AS errores,
              SUM(CASE WHEN error = '' THEN mismo_buscar ELSE 0 END) AS buscar,
              SUM(CASE WHEN error = '' THEN mismo_modo ELSE 0 END) AS modo,
              SUM(CASE WHEN error = '' THEN inventa ELSE 0 END) AS inventa,
              AVG(CASE WHEN error = '' THEN parecido END) AS parecido,
              AVG(CASE WHEN error = '' THEN puntaje END) AS puntaje,
              AVG(CASE WHEN tokens_entrada > 0 THEN tokens_entrada END) AS tokens_entrada,
              AVG(CASE WHEN tokens_salida > 0 THEN tokens_salida END) AS tokens_salida,
              AVG(CASE WHEN ms > 0 THEN ms END) AS ms
         FROM ia_sombra WHERE turno > 0 AND dia >= ?`
    )
    .bind(desde)
    .first();
  const validos = Number(f?.validos) || 0;
  const pct = (n) => (validos ? Math.round((Number(n) / validos) * 1000) / 10 : 0);
  const { results: porDia } = await db
    .prepare("SELECT dia, COUNT(*) AS n, AVG(CASE WHEN error = '' THEN puntaje END) AS puntaje FROM ia_sombra WHERE turno > 0 AND dia >= ? GROUP BY dia ORDER BY dia")
    .bind(desde)
    .all();
  const ej = await db.prepare("SELECT COUNT(*) AS total, SUM(bueno) AS buenos, SUM(revisado) AS revisados FROM ia_ejemplos").first();
  const hoy = await llamadasDeHoy(db, ahora);
  const rp = await db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS bien, SUM(CASE WHEN dia = ? THEN 1 ELSE 0 END) AS hoy, MAX(cuando) AS ultimo FROM ia_respaldo WHERE dia >= ?").bind(diaUtc(ahora), desde).first();
  const resumen = {
    respaldo: { usosEnElPeriodo: Number(rp?.total) || 0, contestaronBien: Number(rp?.bien) || 0, hoy: Number(rp?.hoy) || 0, ultimo: Number(rp?.ultimo) || null },
    desde,
    comparaciones: Number(f?.total) || 0,
    validas: validos,
    conError: Number(f?.errores) || 0,
    buscaLoMismoPct: pct(f?.buscar),
    decideElModoPct: pct(f?.modo),
    inventaDatosPct: pct(f?.inventa),
    parecidoMedio: Math.round((Number(f?.parecido) || 0) * 1000) / 1000,
    puntajeMedio: Math.round((Number(f?.puntaje) || 0) * 1000) / 1000,
    tokensDeEntradaMedios: Math.round(Number(f?.tokens_entrada) || 0),
    tokensDeSalidaMedios: Math.round(Number(f?.tokens_salida) || 0),
    msMedios: Math.round(Number(f?.ms) || 0),
    porDia: (porDia || []).map((d) => ({ dia: d.dia, n: Number(d.n), puntaje: Math.round((Number(d.puntaje) || 0) * 1000) / 1000 })),
    ejemplos: { total: Number(ej?.total) || 0, buenos: Number(ej?.buenos) || 0, revisados: Number(ej?.revisados) || 0 },
    hoy: { llamadas: hoy.n, cuotaAgotada: hoy.agotado },
  };
  // «Lista para tomar el mando»: con suficientes comparaciones, casi siempre
  // busca lo mismo, casi nunca inventa un dato y se parece de verdad.
  resumen.listaParaElMando = validos >= MINIMO_PARA_OPINAR && resumen.buscaLoMismoPct >= 90 && resumen.inventaDatosPct <= 2 && resumen.parecidoMedio >= 0.45;
  resumen.veredicto = validos < MINIMO_PARA_OPINAR ? `Todavía pocas comparaciones (${validos} de ${MINIMO_PARA_OPINAR}): sigue la de pago sola.` : resumen.listaParaElMando ? "Lista para tomar el mando: coincide, no inventa datos y se parece." : "Todavía no: " + [resumen.buscaLoMismoPct < 90 && `busca lo mismo solo el ${resumen.buscaLoMismoPct}% de las veces (hace falta 90%)`, resumen.inventaDatosPct > 2 && `inventa datos el ${resumen.inventaDatosPct}% (hace falta 2% o menos)`, resumen.parecidoMedio < 0.45 && `se parece poco (${resumen.parecidoMedio}, hace falta 0,45)`].filter(Boolean).join("; ") + ".";
  return resumen;
}

export async function ultimasComparaciones(db, cuantas = 20) {
  await asegurarSombra(db);
  const { results } = await db.prepare("SELECT * FROM ia_sombra WHERE turno > 0 ORDER BY id DESC LIMIT ?").bind(Math.max(1, Math.min(100, cuantas))).all();
  return results || [];
}

export async function ejemplosEnJsonl(db) {
  await asegurarSombra(db);
  const { results } = await db.prepare("SELECT cliente, respuesta, buscar, mostrar, revisado FROM ia_ejemplos WHERE bueno = 1 ORDER BY id").all();
  return (results || []).map((e) => JSON.stringify({ cliente: e.cliente, respuesta: e.respuesta, buscar: e.buscar, mostrar: e.mostrar, revisado: Boolean(e.revisado) })).join("\n") + "\n";
}

// Una prueba a mano: UNA llamada real con el prompt completo, para saber si el
// modelo existe, cuánto pesa, qué tarda y si devuelve un JSON entendible.
export async function probarLaSombra(env) {
  const salida = { activa: sombraActiva(env), proveedor: proveedorDeLaSombra(env), modelo: modeloDeLaSombra(env) };
  if (!salida.activa) {
    salida.problema = !SI.test(String(env.SOMBRA || "")) ? 'Está apagada: pon SOMBRA = "si" en wrangler.toml.' : salida.proveedor === "compatible" ? "Falta SOMBRA_URL o el secreto SOMBRA_CLAVE." : "Falta el binding de Workers AI: en wrangler.toml, [ai] binding = \"AI\".";
    return salida;
  }
  const { sistema, contenido } = await armarPedidoDeTexto(env, 'CLIENTE: "Hola, ¿tienen Nike Air Force 1 blancas en talla 42?"');
  const inicio = Date.now();
  try {
    const r = await llamarALaGratis(env, sistema, `${contenido}\n\n${FORMATO}`);
    const libre = leerRespuestaDelModelo(r.texto);
    Object.assign(salida, { ms: Date.now() - inicio, tokensDeEntrada: r.entrada, tokensDeSalida: r.salida, devolvioJson: Boolean(libre), respuesta: libre?.respuesta || null, buscar: libre?.buscar || null, mostrar: libre?.mostrar || null, crudo: libre ? undefined : String(r.texto || "").slice(0, 400) });
    if (env.DB) {
      await asegurarSombra(env.DB);
      const hoy = diaUtc();
      await env.DB.prepare("INSERT INTO ia_sombra (cuando, dia, turno, cliente, proveedor, modelo, ms, tokens_entrada, tokens_salida, error) VALUES (?, ?, 0, '(prueba a mano)', ?, ?, ?, ?, ?, '')").bind(Date.now(), hoy, salida.proveedor, salida.modelo, salida.ms, r.entrada || 0, r.salida || 0).run();
    }
  } catch (error) {
    salida.ms = Date.now() - inicio;
    salida.error = sinClave(error?.message || error, env);
    salida.pista = CUOTA_AGOTADA.test(salida.error) ? "Parece que se acabó la cuota del día de Workers AI (se reinicia a las 00:00 UTC)." : /context|too long|token|length/i.test(salida.error) ? "El modelo no admite un prompt tan largo (~25.000 tokens): elige uno con ventana de 100.000 o más en SOMBRA_MODELO." : /model|not found|no such|unknown/i.test(salida.error) ? "El modelo no existe en tu cuenta (Cloudflare retira modelos): mira el catálogo de Workers AI y cambia SOMBRA_MODELO." : "";
  }
  return salida;
}

/* ── La página del informe (/sombra) ────────────────────────────────── */

function esc(t) {
  return String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function paginaDeLaSombra(d, ultimas, clave = "") {
  const q = clave ? `?clave=${encodeURIComponent(clave)}` : "";
  const dato = (valor, nombre, nota = "") => `<div class="d"><b>${esc(valor)}</b><span>${esc(nombre)}</span>${nota ? `<small>${esc(nota)}</small>` : ""}</div>`;
  const filas = ultimas
    .map(
      (c) => `<tr class="${c.error ? "mal" : c.inventa ? "ojo" : ""}">
<td>${esc(new Date(Number(c.cuando)).toLocaleString("es-VE", { timeZone: "America/Caracas", dateStyle: "short", timeStyle: "short" }))}</td>
<td>${esc(c.cliente)}</td><td>${esc(c.paga_respuesta)}<small>busca: ${esc(c.paga_buscar || "NADA")} · ${esc(c.paga_mostrar)}</small></td>
<td>${c.error ? `<i>${esc(c.error)}</i>` : `${esc(c.libre_respuesta)}<small>busca: ${esc(c.libre_buscar || "NADA")} · ${esc(c.libre_mostrar)}${c.inventa ? " · ⚠ inventa un número" : ""}</small>`}</td>
<td>${c.error ? "—" : esc(c.puntaje)}</td></tr>`
    )
    .join("");
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>IA sombra</title>
<style>:root{color-scheme:dark light}body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:20px 16px;max-width:1100px;margin-inline:auto;background:#0d0f14;color:#e8eaf0}
h1{margin:0 0 4px}p{color:#9aa3b5;margin:4px 0 16px}.v{padding:12px 16px;border-radius:12px;margin:12px 0 20px;background:#1b2130;border:1px solid #2b3550}.v.ok{border-color:#2fa56a;background:#12261c}
.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:20px}.d{background:#161a24;border:1px solid #232a3b;border-radius:12px;padding:12px}.d b{display:block;font-size:22px}.d span{color:#9aa3b5;font-size:13px}.d small{display:block;color:#6d7690;font-size:12px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:8px;border-bottom:1px solid #232a3b;vertical-align:top}td small{display:block;color:#6d7690}tr.mal td{opacity:.6}tr.ojo td:last-child{color:#f0b429}a{color:#6ea8ff}
@media (prefers-color-scheme:light){body{background:#f6f7fb;color:#1b2130}.d,.v{background:#fff;border-color:#dde2ee}.v.ok{background:#e9f7ef}th,td{border-color:#dde2ee}}</style>
<h1>IA de respaldo y sombra</h1><p>${d.encendida ? `Encendida · modo <b>${esc(d.modo)}</b>${d.modo === "respaldo" ? " (contesta solo cuando la de pago falla)" : ""}` : "<b>Apagada</b> (SOMBRA = \"si\" en wrangler.toml)"} · ${esc(d.proveedor)} · <code>${esc(d.modelo)}</code> · hasta ${esc(d.maximoPorDia)} llamadas al día · desde ${esc(d.desde)}</p>
<div class="v ${d.listaParaElMando ? "ok" : ""}"><b>${esc(d.veredicto)}</b></div>
<div class="g">${dato(d.respaldo.usosEnElPeriodo, "veces que contestó el respaldo", d.respaldo.usosEnElPeriodo ? `${d.respaldo.hoy} hoy · ${d.respaldo.contestaronBien} bien · la de pago estaba fallando` : "la de pago no ha fallado")}${dato(d.validas, "comparaciones válidas", `${d.conError} con error`)}${dato(`${d.buscaLoMismoPct}%`, "busca lo mismo", "hace falta 90%")}${dato(`${d.decideElModoPct}%`, "decide igual: texto o fotos")}${dato(d.parecidoMedio, "se parece (0 a 1)", "hace falta 0,45")}${dato(`${d.inventaDatosPct}%`, "inventa un número", "hace falta 2% o menos")}${dato(d.puntajeMedio, "puntaje medio (0 a 1)")}${dato(d.ejemplos.buenos, "ejemplos del maestro", `${d.ejemplos.total} guardados · ${d.ejemplos.revisados} revisados`)}${dato(`${d.hoy.llamadas}/${d.maximoPorDia}`, "llamadas hoy", d.hoy.cuotaAgotada ? "se acabó la cuota del día: descansa hasta las 00:00 UTC" : "")}${dato(d.tokensDeEntradaMedios, "tokens de entrada por llamada", `${d.tokensDeSalidaMedios} de salida · ${d.msMedios} ms`)}</div>
<p><a href="/sombra/probar${q}">Probar el modelo ahora</a> · <a href="/sombra/ejemplos.jsonl${q}">Bajar los ejemplos del maestro</a> · <a href="/sombra${q}${q ? "&" : "?"}formato=json">JSON</a></p>
<table><thead><tr><th>Cuándo</th><th>Cliente</th><th>La de pago (la que vio el cliente)</th><th>La sombra (sin costo)</th><th>Puntaje</th></tr></thead><tbody>${filas || '<tr><td colspan="5">Todavía no hay comparaciones. Cuando lleguen mensajes aparecen aquí.</td></tr>'}</tbody></table></html>`;
}
