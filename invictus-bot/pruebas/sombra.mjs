// LA IA SOMBRA (16-oct-2026, ver sombra.js): una IA GRATIS que lee cada
// conversación en paralelo a la de pago y aprende de ella.
//
// Lo que no se puede romper:
//   · EL CLIENTE NO NOTA NADA: recibe exactamente lo mismo con la sombra
//     encendida, apagada, rota o sin cuota;
//   · la sombra lee EXACTAMENTE lo mismo que la de pago (mismo prompt y mismo
//     mensaje), más los ejemplos de la de pago;
//   · corre DESPUÉS de enviar, y nunca lanza un error hacia el turno;
//   · el tope diario y la cuota agotada se respetan (cuesta lo que se dice);
//   · lo que aprende de la de pago son sus respuestas buenas, no las que el
//     revisor marcó mal;
//   · la clave de un proveedor externo no sale en ninguna parte;
//   · /sombra es confidencial (con la clave del panel central).

import crypto from "node:crypto";
import { prepararSrc, baseDeMentira, ok, titulo, terminar } from "./ayuda.mjs";

const SECRETO = "secreto-de-prueba";
const CUENTA = "999";
const API = "clave-larga-del-panel-central-123";
const src = await prepararSrc();
const S = await src.cargar("sombra.js");
const { default: worker } = await src.cargar("index.js");
const { DB, sql } = baseDeMentira();

/* ── Las piezas solas ─────────────────────────────────────────────────── */

titulo("encenderla: solo con SOMBRA = si y con algo que llamar");
{
  const AI = { run: async () => ({}) };
  ok(!S.sombraActiva({}) && !S.sombraActiva({ AI }) && !S.sombraActiva({ SOMBRA: "no", AI }), "apagada por defecto, y con «no»");
  ok(!S.sombraActiva({ SOMBRA: "si" }), "encendida pero sin el binding [ai]: se queda quieta");
  ok(S.sombraActiva({ SOMBRA: "si", AI }) && S.sombraActiva({ SOMBRA: "Sí", AI }), "con SOMBRA = si y Workers AI: activa");
  ok(!S.sombraActiva({ SOMBRA: "si", SOMBRA_PROVEEDOR: "compatible", SOMBRA_URL: "https://x.test" }) && S.sombraActiva({ SOMBRA: "si", SOMBRA_PROVEEDOR: "compatible", SOMBRA_URL: "https://x.test", SOMBRA_CLAVE: "abcd1234" }), "con otro proveedor hacen falta la dirección Y la clave");
  ok(S.modeloDeLaSombra({}) === S.MODELO_POR_DEFECTO && S.modeloDeLaSombra({ SOMBRA_MODELO: "@cf/otro" }) === "@cf/otro", "el modelo se cambia en wrangler.toml");
  ok(S.maximoPorDia({}) === 12 && S.maximoPorDia({ SOMBRA_MAX_DIA: "3" }) === 3 && S.maximoPorDia({ SOMBRA_MAX_DIA: "0" }) === 0 && S.maximoPorDia({ SOMBRA_MAX_DIA: "x" }) === 12, "el tope diario: 12 por defecto, se puede bajar a 0");
  ok(S.diaUtc(Date.parse("2026-10-16T23:59:59Z")) === "2026-10-16" && S.diaUtc(Date.parse("2026-10-17T00:00:00Z")) === "2026-10-17", "el día es el UTC de Cloudflare (la cuota se reinicia a las 00:00 UTC)");
}

titulo("comparar a la gratis con la de pago");
{
  const paga = { respuesta: "Claro, las Jordan 1 están en $120 y tenemos talla 42 😊", buscar: "Jordan 1", mostrar: "texto_e_imagenes" };
  const igual = S.compararRespuestas(paga, { respuesta: "Claro 😊 las Jordan 1 cuestan $120, hay talla 42", buscar: "jordan 1", mostrar: "texto_e_imagenes" }, "CLIENTE: busco jordan 1 talla 42");
  ok(igual.mismoBuscar && igual.mismoModo && !igual.inventa && igual.puntaje >= 0.7, "dice lo mismo: puntaje alto", JSON.stringify(igual));
  const otra = S.compararRespuestas(paga, { respuesta: "Hola, ¿qué buscas?", buscar: "NADA", mostrar: "texto" }, "CLIENTE: busco jordan 1");
  ok(!otra.mismoBuscar && !otra.mismoModo && otra.puntaje < 0.3, "no busca nada cuando la otra sí: puntaje bajo", JSON.stringify(otra));
  const inventa = S.compararRespuestas(paga, { respuesta: "Las Jordan 1 están en $95 y talla 42", buscar: "Jordan 1", mostrar: "texto_e_imagenes" }, "CLIENTE: busco jordan 1 talla 42");
  ok(inventa.inventa && inventa.inventados.includes("95") && inventa.puntaje < igual.puntaje - 0.4, "un precio que ni la de pago ni el cliente dijeron: «inventa» y se descuenta", JSON.stringify(inventa));
  const talla = S.compararRespuestas(paga, { respuesta: "Tengo talla 42 a $120", buscar: "Jordan 1", mostrar: "texto_e_imagenes" }, "CLIENTE: talla 42");
  ok(!talla.inventa, "un número que sí estaba en lo que se leyó no es inventar");
  ok(S.compararRespuestas({ respuesta: "ok", buscar: "NADA" }, { respuesta: "ok", buscar: "nada", mostrar: "texto_e_imagenes" }).mismoBuscar, "«NADA» y «nada» son lo mismo");
}

titulo("leer lo que devuelven los distintos modelos");
{
  ok(S.textoDeLaRespuesta({ response: '{"a":1}' }) === '{"a":1}', "Workers AI clásico: { response }");
  ok(S.textoDeLaRespuesta({ choices: [{ message: { content: "hola" } }] }) === "hola", "estilo OpenAI: choices");
  ok(S.textoDeLaRespuesta({ output: [{ type: "reasoning", content: [{ type: "reasoning_text", text: "pienso" }] }, { type: "message", content: [{ type: "output_text", text: "respuesta" }] }] }) === "respuesta", "estilo «responses» (gpt-oss): solo el texto de salida, no el razonamiento");
  ok(S.textoDeLaRespuesta({ result: { response: "x" } }) === "x" && S.textoDeLaRespuesta(null) === "" && S.textoDeLaRespuesta("texto") === "texto", "con result, sin nada y un texto suelto");
}

titulo("los ejemplos del maestro: lo bueno se guarda, lo malo no se imita");
{
  await S.guardarEjemplo(DB, { turno: 1, cliente: "tienen jordan 1 en talla 42?", respuesta: "¡Claro! Mira estas Jordan 1 en talla 42 😊", buscar: "Jordan 1", bueno: true, revisado: true });
  await S.guardarEjemplo(DB, { turno: 2, cliente: "cuanto cuesta el envio a valencia", respuesta: "El envío te lo confirma un asesor en un momento 😊", bueno: true });
  await S.guardarEjemplo(DB, { turno: 3, cliente: "tienen jordan 1 baratas?", respuesta: "Sí, te las dejo a $5 (INVENTADO)", buscar: "Jordan 1", bueno: false, revisado: true });
  ok(!(await S.guardarEjemplo(DB, { turno: 4, cliente: "tienen jordan 1 en talla 42?", respuesta: "¡Claro! Mira estas Jordan 1 en talla 42 😊" })), "el mismo ejemplo dos veces no se duplica");
  ok(!(await S.guardarEjemplo(DB, { turno: 5, cliente: "x", respuesta: "" })), "uno vacío no se guarda");
  const parecidos = await S.ejemplosParecidos(DB, "busco unas jordan 1 talla 42", 3);
  ok(parecidos.length === 1 && /Mira estas Jordan 1/.test(parecidos[0].respuesta), "para algo parecido sale el ejemplo bueno", JSON.stringify(parecidos));
  ok(!parecidos.some((e) => /INVENTADO/.test(e.respuesta)), "y el que el revisor marcó mal NO se imita");
  ok((await S.ejemplosParecidos(DB, "quiero hablar de otra cosa muy distinta", 3)).length === 0, "si no se parece a nada, no sale ninguno (no se fuerza)");
  ok((await S.ejemplosParecidos(DB, "jordan 1", 0)).length === 0, "SOMBRA_EJEMPLOS = 0: ninguno");
  const bloque = S.bloqueDeEjemplos(parecidos);
  ok(/El cliente escribió: «tienen jordan 1 en talla 42\?»/.test(bloque) && /nunca de estos ejemplos/.test(bloque), "se le dan como ejemplos de tono y decisiones, no como datos");
  sql.exec("DELETE FROM ia_ejemplos");
  for (let i = 0; i < 620; i++) await S.guardarEjemplo(DB, { turno: i, cliente: `pregunta numero ${i} sobre zapatos`, respuesta: `respuesta ${i}` });
  ok(sql.prepare("SELECT COUNT(*) AS n FROM ia_ejemplos").get().n <= 601, "la tabla guarda solo los últimos ~600", String(sql.prepare("SELECT COUNT(*) AS n FROM ia_ejemplos").get().n));
  sql.exec("DELETE FROM ia_ejemplos");
}

titulo("llamar a la IA gratis: Workers AI sin clave, y otro proveedor con clave");
{
  const vistas = [];
  const AI = { run: async (modelo, args) => (vistas.push({ modelo, args }), { response: '{"respuesta":"ok"}', usage: { prompt_tokens: 25000, completion_tokens: 120 } }) };
  const r = await S.llamarALaGratis({ AI, SOMBRA: "si" }, "SISTEMA", "MENSAJE");
  ok(r.texto === '{"respuesta":"ok"}' && r.entrada === 25000 && r.salida === 120, "devuelve el texto y los tokens que gastó");
  ok(vistas[0].modelo === S.MODELO_POR_DEFECTO && vistas[0].args.messages[0].content === "SISTEMA" && vistas[0].args.messages[1].content === "MENSAJE" && vistas[0].args.response_format?.type === "json_object", "con el sistema y el mensaje, pidiendo JSON");
  // Un modelo que no acepta el «modo JSON»: se reintenta sin él.
  let intentos = 0;
  const AI2 = { run: async (m, a) => { intentos++; if (a.response_format) throw new Error("AiError: response_format is not supported for this model"); return { response: "{}" }; } };
  await S.llamarALaGratis({ AI: AI2 }, "S", "M");
  ok(intentos === 2, "si el modelo rechaza el modo JSON, se reintenta sin él");
  const AI3 = { run: async () => { throw new Error("AiError: 3036: account is limited"); } };
  let error = null;
  try { await S.llamarALaGratis({ AI: AI3 }, "S", "M"); } catch (e) { error = e; }
  ok(/3036/.test(error?.message || ""), "un error de verdad sí sube (lo recoge consultarSombra)");
  const gpt = [];
  await S.llamarALaGratis({ AI: { run: async (m, a) => (gpt.push(a), { output: [] }) }, SOMBRA_MODELO: "@cf/openai/gpt-oss-120b" }, "S", "M");
  ok(gpt[0].reasoning?.effort === "low" && !gpt[0].response_format, "gpt-oss: razona poco y sin modo JSON");

  // Otro proveedor (Gemini, Groq…): con su clave, que NO puede salir en un error.
  const real = globalThis.fetch;
  let pedido = null;
  globalThis.fetch = async (url, op) => {
    pedido = { url: String(url), op, cuerpo: JSON.parse(op.body) };
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"respuesta":"hola"}' } }], usage: { prompt_tokens: 100, completion_tokens: 10 } }));
  };
  const env = { SOMBRA_PROVEEDOR: "compatible", SOMBRA_URL: "https://api.gratis.test/v1/chat/completions", SOMBRA_CLAVE: "clave-secreta-777", SOMBRA_MODELO: "gemini-x" };
  const c = await S.llamarALaGratis(env, "S", "M");
  ok(c.texto === '{"respuesta":"hola"}' && pedido.op.headers.authorization === "Bearer clave-secreta-777" && pedido.cuerpo.model === "gemini-x", "otro proveedor: su dirección, su clave y su modelo");
  globalThis.fetch = async () => new Response("invalid key clave-secreta-777", { status: 401 });
  error = null;
  try { await S.llamarALaGratis(env, "S", "M"); } catch (e) { error = e; }
  ok(/401/.test(error?.message || "") && !String(error?.message).includes("clave-secreta-777"), "si falla, el error NO lleva la clave", error?.message);
  globalThis.fetch = real;
}

/* ── El turno completo, por el webhook de verdad ─────────────────────── */

let llamadasPaga = [];
let llamadasLibre = [];
let enviados = [];
let respuestaPaga = "¡Hola! ¿Qué estás buscando? 😊";
let comportamientoLibre = () => ({ response: JSON.stringify({ pienso: "saludo", mostrar: "texto", voz: false, respuesta: "¡Hola! ¿Qué estás buscando hoy?", buscar: "NADA", historial: "" }), usage: { prompt_tokens: 25000, completion_tokens: 90 } });
const AI = { run: async (modelo, args) => { llamadasLibre.push({ modelo, args }); return comportamientoLibre(); } };

const real = globalThis.fetch;
let pagaFalla = null; // null = responde; "saldo" = 429 sin saldo; "caida" = 500
let alertasCentral = [];
globalThis.fetch = async (url, op = {}) => {
  const u = String(url?.url || url);
  if (u.startsWith("https://central.test/api/alerta")) {
    alertasCentral.push(...JSON.parse(op.body).alertas);
    return new Response("{}");
  }
  if (u.includes("api.openai.com")) {
    llamadasPaga.push(JSON.parse(op.body || "{}"));
    if (pagaFalla === "saldo") return new Response(JSON.stringify({ error: { code: "insufficient_quota", message: "You exceeded your current quota, please check your plan and billing details." } }), { status: 429 });
    if (pagaFalla === "caida") return new Response("Bad gateway", { status: 502 });
    return Response.json({ choices: [{ message: { content: JSON.stringify({ pienso: "Saludo.", mostrar: "texto", voz: false, respuesta: respuestaPaga, buscar: "NADA", historial: "Saludó." }) } }], usage: { prompt_tokens: 100, completion_tokens: 20 } });
  }
  if (u.includes("graph.instagram.com") && u.includes("/messages")) {
    const cuerpo = JSON.parse(op.body || "{}");
    enviados.push({ a: cuerpo?.recipient?.id, texto: cuerpo?.message?.text || "(adjunto)" });
    return Response.json({ message_id: `mid-bot-${Math.random()}` });
  }
  if (u.includes("graph.instagram.com")) return Response.json({ name: "Ana Pérez", username: "ana" });
  if (u.includes("graphql.json")) return Response.json({ data: { products: { edges: [], pageInfo: { hasNextPage: false } } } });
  return new Response("ok");
};
const envDe = (extra = {}) => ({ PANEL_CENTRAL_URL: "https://central.test", DB, META_APP_SECRET: SECRETO, META_MODO: "todo", IG_TOKEN: "x", OPENAI_API_KEY: "x", SHOPIFY_TIENDA: "tienda.test", SHOPIFY_TOKEN: "x", URL_CATALOGO: "https://tienda.test", TIENDA_NOMBRE: "Invictus Shoes", REVISOR_IA: "no", JUNTAR_MENSAJES: "no", PANEL_API_CLAVE: API, ...extra });
async function webhook(env, evento) {
  const cuerpo = JSON.stringify({ object: "instagram", entry: [{ id: CUENTA, time: Date.now(), messaging: [evento] }] });
  const firma = "sha256=" + crypto.createHmac("sha256", SECRETO).update(cuerpo).digest("hex");
  const tareas = [];
  const r = await worker.fetch(new Request("https://bot.test/webhook", { method: "POST", headers: { "x-hub-signature-256": firma }, body: cuerpo }), env, { waitUntil: (p) => tareas.push(p) });
  await Promise.all(tareas);
  return r.status;
}
const texto = (igsid, t) => ({ sender: { id: igsid }, recipient: { id: CUENTA }, timestamp: Date.now(), message: { mid: `m-${Math.random()}`, text: t } });
async function callado(hacer) {
  if (process.env.VER) return hacer();
  const [l, e] = [console.log, console.error];
  const vistos = [];
  console.log = (...a) => vistos.push(a.join(" "));
  console.error = (...a) => vistos.push(a.join(" "));
  try { await hacer(); } finally { console.log = l; console.error = e; }
  return vistos;
}
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const reiniciar = () => { llamadasPaga = []; llamadasLibre = []; enviados = []; };

titulo("el cliente recibe EXACTAMENTE lo mismo con la sombra encendida o apagada");
{
  reiniciar();
  await callado(async () => { await webhook(envDe(), texto("1001", "busco unas botas negras")); });
  const sinSombra = enviados.filter((e) => e.a === "1001").map((e) => e.texto);
  ok(llamadasLibre.length === 0 && sinSombra.length === 1, "apagada: la gratis no se llama", `llamadas ${llamadasLibre.length}`);
  reiniciar();
  await callado(async () => { await webhook(envDe({ SOMBRA: "si", SOMBRA_MODO: "sombra", AI }), texto("1002", "busco unas botas negras")); });
  const conSombra = enviados.filter((e) => e.a === "1002").map((e) => e.texto);
  ok(llamadasLibre.length === 1, "encendida: se llama a la gratis una vez");
  ok(JSON.stringify(sinSombra) === JSON.stringify(conSombra), "el cliente recibe lo mismo, palabra por palabra", JSON.stringify({ sinSombra, conSombra }));
  ok(!conSombra.join(" ").includes("hoy?"), "y NADA de lo que dijo la gratis llega al cliente");
}

titulo("la sombra lee EXACTAMENTE lo mismo que la de pago");
{
  reiniciar();
  await callado(async () => { await webhook(envDe({ SOMBRA: "si", SOMBRA_MODO: "sombra", AI, SOMBRA_EJEMPLOS: "0" }), texto("1003", "buenas, busco unas Nike Pegasus")); });
  const paga = llamadasPaga.at(-1);
  const libre = llamadasLibre.at(-1);
  const sistemaPaga = paga.messages[0].content;
  const mensajePaga = paga.messages[1].content[0].text;
  ok(libre.args.messages[0].content === sistemaPaga && sistemaPaga.length > 50000, "el mismo prompt de sistema, entero", `${libre.args.messages[0].content.length} vs ${sistemaPaga.length}`);
  ok(libre.args.messages[1].content.includes(mensajePaga), "el mismo mensaje (la conversación y lo que escribió)");
  ok(/RESPONDE SOLO CON UN OBJETO JSON/.test(libre.args.messages[1].content), "más la forma del JSON que tiene que devolver");
  ok(libre.modelo === S.MODELO_POR_DEFECTO, "con el modelo configurado");
}

titulo("se guarda la comparación y el ejemplo del maestro");
{
  const c = sql.prepare("SELECT * FROM ia_sombra WHERE turno > 0 ORDER BY id DESC LIMIT 1").get();
  ok(c && /Nike Pegasus/.test(c.cliente) && c.paga_respuesta === respuestaPaga && /hoy\?/.test(c.libre_respuesta) && c.error === "", "la pareja: lo que dijo cada una", JSON.stringify(c));
  ok(c.tokens_entrada === 25000 && c.tokens_salida === 90 && c.proveedor === "cloudflare" && c.modelo === S.MODELO_POR_DEFECTO, "con lo que gastó la gratis (para sacar la cuenta de la cuota)");
  ok(c.mismo_buscar === 1 && c.puntaje > 0.5, "y el puntaje", String(c.puntaje));
  const e = sql.prepare("SELECT * FROM ia_ejemplos WHERE cliente LIKE '%Nike Pegasus%'").get();
  ok(e && e.respuesta === respuestaPaga && e.bueno === 1, "lo que contestó la de pago queda de ejemplo", JSON.stringify(e));
}

titulo("la segunda vez, la gratis recibe lo que ya aprendió de la de pago");
{
  reiniciar();
  respuestaPaga = "¡Hola! Cuéntame, ¿qué modelo de Nike Pegasus buscas? 😊";
  await callado(async () => { await webhook(envDe({ SOMBRA: "si", SOMBRA_MODO: "sombra", AI }), texto("1004", "tienen Nike Pegasus?")); });
  const pedido = llamadasLibre.at(-1).args.messages[1].content;
  ok(/EJEMPLOS DE CÓMO CONTESTÓ BIEN LA ASISTENTE PRINCIPAL/.test(pedido) && /buscas unas Nike Pegasus|busco unas Nike Pegasus/.test(pedido) && pedido.includes("¡Hola! ¿Qué estás buscando? 😊"), "recibe el ejemplo parecido de la primera vez", pedido.slice(0, 400));
  const dentro = pedido.indexOf("EJEMPLOS DE CÓMO");
  ok(!/Cuéntame, ¿qué modelo/.test(pedido.slice(dentro)), "pero NO su propia respuesta de ahora (no hace trampa)");
  ok(sql.prepare("SELECT ejemplos FROM ia_sombra WHERE turno > 0 ORDER BY id DESC LIMIT 1").get().ejemplos >= 1, "queda anotado cuántos ejemplos usó");
  respuestaPaga = "¡Hola! ¿Qué estás buscando? 😊";
}

titulo("si la gratis falla, no pasa nada: el cliente ni se entera");
{
  reiniciar();
  comportamientoLibre = () => { throw new Error("AiError: el modelo se cayó"); };
  const visto = await callado(async () => { ok((await webhook(envDe({ SOMBRA: "si", SOMBRA_MODO: "sombra", AI }), texto("1005", "busco sandalias negras"))) === 200, "a Meta se le responde 200"); });
  ok(enviados.filter((e) => e.a === "1005").length === 1 && /Qué estás buscando/.test(enviados.find((e) => e.a === "1005").texto), "el cliente recibe su respuesta normal");
  const f = sql.prepare("SELECT * FROM ia_sombra WHERE turno > 0 ORDER BY id DESC LIMIT 1").get();
  ok(/el modelo se cayó/.test(f.error) && f.puntaje === 0, "el fallo queda anotado con su motivo", JSON.stringify(f));
  ok(!visto.some((l) => /ATENDER FALLÓ/.test(l)), "y no aparece como error del bot");
  reiniciar();
  comportamientoLibre = () => ({ response: "esto no es un json" });
  await callado(async () => { await webhook(envDe({ SOMBRA: "si", SOMBRA_MODO: "sombra", AI }), texto("1006", "busco tenis blancos")); });
  ok(/no devolvió un JSON/.test(sql.prepare("SELECT error FROM ia_sombra WHERE turno > 0 ORDER BY id DESC LIMIT 1").get().error) && enviados.filter((e) => e.a === "1006").length === 1, "si no devuelve un JSON entendible, se anota y el cliente igual recibe lo suyo");
  comportamientoLibre = () => ({ response: JSON.stringify({ pienso: "", mostrar: "texto", voz: false, respuesta: "¡Hola! ¿Qué estás buscando hoy?", buscar: "NADA", historial: "" }), usage: { prompt_tokens: 25000, completion_tokens: 90 } });
}

titulo("aprender de la de pago NO depende de que la gratis conteste");
{
  sql.exec("DELETE FROM ia_ejemplos");
  sql.exec("DELETE FROM ia_sombra");
  reiniciar();
  comportamientoLibre = () => { throw new Error("AiError: se cayó todo"); };
  await callado(async () => { await webhook(envDe({ SOMBRA: "si", SOMBRA_MODO: "sombra", AI }), texto("1401", "busco unas botas de cuero")); });
  ok(sql.prepare("SELECT COUNT(*) AS n FROM ia_ejemplos WHERE cliente LIKE '%botas de cuero%'").get().n === 1, "la gratis se cayó, pero el ejemplo de la de pago quedó guardado");
  // Una gratis lenta (más que lo que dura una tarea de fondo) tampoco se lo lleva por delante.
  sql.exec("DELETE FROM ia_ejemplos");
  reiniciar();
  let soltar;
  comportamientoLibre = () => new Promise((r) => (soltar = r));
  const AIlenta = { run: async (m, a) => (llamadasLibre.push({ m, a }), comportamientoLibre()) };
  const trabajo = webhook(envDe({ SOMBRA: "si", SOMBRA_MODO: "sombra", AI: AIlenta }), texto("1402", "busco unas sandalias de playa"));
  await pausa(300);
  ok(sql.prepare("SELECT COUNT(*) AS n FROM ia_ejemplos WHERE cliente LIKE '%sandalias de playa%'").get().n === 1, "mientras la gratis todavía piensa, el ejemplo de la de pago ya está guardado");
  ok(enviados.filter((e) => e.a === "1402").length === 1, "y el cliente ya recibió su respuesta");
  soltar({ response: JSON.stringify({ pienso: "", mostrar: "texto", voz: false, respuesta: "Hola", buscar: "NADA", historial: "" }) });
  await trabajo;
  comportamientoLibre = () => ({ response: JSON.stringify({ pienso: "", mostrar: "texto", voz: false, respuesta: "¡Hola! ¿Qué estás buscando hoy?", buscar: "NADA", historial: "" }), usage: { prompt_tokens: 25000, completion_tokens: 90 } });
  // Aunque el ejemplo de ESTE turno ya esté guardado, la gratis no lo ve.
  const turnoId = sql.prepare("SELECT turno FROM ia_ejemplos WHERE cliente LIKE '%sandalias de playa%'").get().turno;
  ok((await S.ejemplosParecidos(DB, "busco unas sandalias de playa", 3, turnoId)).length === 0 && (await S.ejemplosParecidos(DB, "busco unas sandalias de playa", 3)).length === 1, "el ejemplo del turno que se está contestando se excluye por código (no hace trampa)");
}

titulo("EL RESPALDO: por defecto la gratis NO corre en paralelo, solo entra cuando la de pago falla");
{
  sql.exec("DELETE FROM ia_ejemplos"); sql.exec("DELETE FROM ia_sombra"); sql.exec("DELETE FROM ia_respaldo");
  ok(S.modoDeLaSombra({}) === "respaldo" && S.modoDeLaSombra({ SOMBRA_MODO: "sombra" }) === "sombra" && S.modoDeLaSombra({ SOMBRA_MODO: "ambos" }) === "ambos" && S.modoDeLaSombra({ SOMBRA_MODO: "raro" }) === "respaldo", "el modo por defecto es «respaldo»");
  const e = { SOMBRA: "si", AI };
  ok(S.respaldoActivo(e) && !S.sombraParalelaActiva(e) && S.respaldoActivo({ ...e, SOMBRA_MODO: "ambos" }) && S.sombraParalelaActiva({ ...e, SOMBRA_MODO: "ambos" }) && !S.respaldoActivo({ ...e, SOMBRA_MODO: "sombra" }), "respaldo / sombra / ambos activan lo que dicen");
  reiniciar();
  await callado(async () => { await webhook(envDe({ SOMBRA: "si", AI }), texto("1501", "busco unos mocasines")); });
  ok(llamadasLibre.length === 0, "con la de pago sana, la gratis no gasta ni una llamada (la cuota queda para cuando haga falta)");
  ok(sql.prepare("SELECT COUNT(*) AS n FROM ia_ejemplos WHERE cliente LIKE '%mocasines%'").get().n === 1, "pero el ejemplo de la de pago sí se guarda: el respaldo va aprendiendo");
  ok(sql.prepare("SELECT COUNT(*) AS n FROM ia_sombra").get().n === 0, "y no hay comparaciones");
}

titulo("la de pago se queda sin saldo: contesta el respaldo, y el cliente recibe una respuesta de verdad");
{
  reiniciar();
  alertasCentral = [];
  pagaFalla = "saldo";
  comportamientoLibre = () => ({ response: JSON.stringify({ pienso: "pide mocasines", mostrar: "texto", voz: true, respuesta: "¡Hola! Claro, cuéntame qué talla buscas en mocasines 😊", buscar: "NADA", historial: "Pidió mocasines." }), usage: { prompt_tokens: 25000, completion_tokens: 80 } });
  const visto = await callado(async () => { await webhook(envDe({ SOMBRA: "si", AI }), texto("1502", "busco unos mocasines negros")); });
  const dijo = enviados.filter((x) => x.a === "1502").map((x) => x.texto);
  ok(llamadasPaga.length >= 1 && llamadasLibre.length === 1, "la de pago falló y se llamó al respaldo una vez", `${llamadasPaga.length} / ${llamadasLibre.length}`);
  ok(dijo.length === 1 && /cuéntame qué talla buscas/.test(dijo[0]) && !/se me trabó/.test(dijo[0]), "el cliente recibe la respuesta del respaldo, NO el «se me trabó el sistema»", JSON.stringify(dijo));
  const pedidoPaga = llamadasPaga[0].messages[1].content[0].text;
  ok(llamadasLibre[0].args.messages[0].content === llamadasPaga[0].messages[0].content && llamadasLibre[0].args.messages[1].content.includes(pedidoPaga), "el respaldo lee el mismo prompt y el mismo mensaje que la de pago");
  const t = sql.prepare("SELECT respuesta, notas FROM turnos WHERE cliente LIKE '%mocasines negros%' ORDER BY id DESC LIMIT 1").get();
  ok(t && /RESPALDO/.test(t.notas || JSON.stringify(t)), "el panel anota que esa respuesta la dio el respaldo", JSON.stringify(t));
  const r = sql.prepare("SELECT * FROM ia_respaldo ORDER BY id DESC LIMIT 1").get();
  ok(r && r.ok === 1 && r.tokens_entrada === 25000 && /cuéntame qué talla/.test(r.respuesta), "queda anotado el uso (con los tokens que gastó)", JSON.stringify(r));
  ok(sql.prepare("SELECT COUNT(*) AS n FROM ia_ejemplos WHERE cliente LIKE '%mocasines negros%'").get().n === 0, "y NO se guarda como ejemplo: no es la maestra");
  ok(alertasCentral.length === 1 && /no está respondiendo/.test(alertasCentral[0].texto) && /Billing/.test(alertasCentral[0].texto), "el dueño recibe UN aviso: la de pago está fallando", JSON.stringify(alertasCentral));
  ok(!visto.some((l) => /ATENDER FALLÓ/.test(l)), "sin errores del bot");
  // Segundo cliente, enseguida: contesta otra vez el respaldo, pero el aviso no se repite.
  reiniciar();
  await callado(async () => { await webhook(envDe({ SOMBRA: "si", AI }), texto("1503", "busco unas sandalias")); });
  ok(enviados.filter((x) => x.a === "1503").length === 1 && /cuéntame/.test(enviados.find((x) => x.a === "1503").texto), "el siguiente cliente también se atiende");
  ok(alertasCentral.length === 1, "pero el aviso al dueño NO se repite (uno cada 30 minutos)");
  // Pasada media hora, vuelve a avisar.
  await S.responderConRespaldo(envDe({ SOMBRA: "si", AI }), "CLIENTE: x", "x", { ahora: Date.now() + 31 * 60000 });
  ok(alertasCentral.length === 2, "pasados 30 minutos, avisa otra vez");
  ok(sql.prepare("SELECT COUNT(*) AS n FROM ia_sombra").get().n === 0, "y el respaldo no cuenta como comparación en paralelo");
}

titulo("el respaldo pasa por las mismas redes de seguridad que la de pago");
{
  const fuente = (await import("node:fs")).readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const iRespaldo = fuente.indexOf("responderConRespaldo(env, entrada");
  const iRed = fuente.indexOf("revisarDatoDeLaTienda(salida?.respuesta");
  ok(iRespaldo > 0 && iRed > iRespaldo, "su respuesta se asigna a «salida» ANTES de las redes de los datos de la tienda, tono, precios y Cashea (index.js)");
  reiniciar();
  pagaFalla = "saldo";
  comportamientoLibre = () => ({ response: JSON.stringify({ pienso: "", mostrar: "texto", voz: false, respuesta: "Te cuento: el envío es gratis a todo el país 🚚", buscar: "NADA", historial: "" }) });
  await callado(async () => { await webhook(envDe({ SOMBRA: "si", AI }), texto("1504", "cuanto cuesta el envio a valencia")); });
  const dijo = enviados.filter((x) => x.a === "1504").map((x) => x.texto).join(" ");
  ok(!/gratis a todo el país/.test(dijo), "un «envío gratis» inventado por el respaldo NO le llega al cliente (lo corrigen los datos de la tienda)", dijo);
}

titulo("si el respaldo también falla, todo sigue como antes");
{
  reiniciar();
  alertasCentral = [];
  sql.exec("DELETE FROM ia_respaldo");
  pagaFalla = "saldo";
  comportamientoLibre = () => { throw new Error("AiError: se cayó todo"); };
  await callado(async () => { await webhook(envDe({ SOMBRA: "si", AI }), texto("1505", "busco unas botas")); });
  ok(enviados.filter((x) => x.a === "1505").length === 1 && /se me trabó el sistema/.test(enviados.find((x) => x.a === "1505").texto), "el cliente recibe el aviso de siempre (nadie se queda sin respuesta)");
  ok(sql.prepare("SELECT ok, error FROM ia_respaldo ORDER BY id DESC LIMIT 1").get().ok === 0 && alertasCentral.some((a) => /tampoco pudo/.test(a.texto)), "queda anotado y el aviso al dueño dice que ninguna de las dos pudo");
  reiniciar();
  pagaFalla = "caida";
  comportamientoLibre = () => ({ response: "esto no es un json" });
  let intentos = 0;
  const AIdosVeces = { run: async () => (intentos++, intentos === 1 ? { response: "no es json" } : { response: JSON.stringify({ pienso: "", mostrar: "texto", voz: false, respuesta: "¡Hola! ¿Qué buscas hoy? 😊", buscar: "NADA", historial: "" }) }) };
  await callado(async () => { await webhook(envDe({ SOMBRA: "si", AI: AIdosVeces }), texto("1506", "busco unos tenis")); });
  ok(intentos === 2 && /¿Qué buscas hoy\?/.test(enviados.find((x) => x.a === "1506")?.texto || ""), "si el primer intento no devuelve un JSON, se reintenta una vez y contesta");
}

titulo("el modo «sombra» no contesta por la de pago; el respaldo apagado tampoco");
{
  reiniciar();
  pagaFalla = "saldo";
  comportamientoLibre = () => ({ response: JSON.stringify({ pienso: "", mostrar: "texto", voz: false, respuesta: "NO DEBERÍA SALIR", buscar: "NADA", historial: "" }) });
  await callado(async () => { await webhook(envDe({ SOMBRA: "si", SOMBRA_MODO: "sombra", AI }), texto("1507", "busco unas pantuflas")); });
  ok(llamadasLibre.length === 0 && /se me trabó/.test(enviados.find((x) => x.a === "1507")?.texto || ""), "modo «sombra»: no entra de respaldo");
  reiniciar();
  await callado(async () => { await webhook(envDe(), texto("1508", "busco unas pantuflas azules")); });
  ok(llamadasLibre.length === 0 && /se me trabó/.test(enviados.find((x) => x.a === "1508")?.texto || ""), "apagada: igual que siempre");
  pagaFalla = null;
}

titulo("el tope de respaldos del día y la cuota agotada");
{
  sql.exec("DELETE FROM ia_respaldo");
  reiniciar();
  pagaFalla = "saldo";
  comportamientoLibre = () => ({ response: JSON.stringify({ pienso: "", mostrar: "texto", voz: false, respuesta: "Claro, dime qué buscas 😊", buscar: "NADA", historial: "" }) });
  const env = envDe({ SOMBRA: "si", AI, RESPALDO_MAX_DIA: "2" });
  await callado(async () => { for (const [i, t] of ["busco botas", "busco tenis", "busco chancletas"].entries()) await webhook(env, texto(`16${i}`, t)); });
  ok(llamadasLibre.length === 2, "con tope 2: el tercero ya no llama al respaldo (el gasto tiene techo)", String(llamadasLibre.length));
  ok(/se me trabó/.test(enviados.find((x) => x.a === "162")?.texto || ""), "y ese tercero recibe el aviso de siempre");
  ok(S.maximoDeRespaldos({}) === 400 && S.maximoDeRespaldos({ RESPALDO_MAX_DIA: "0" }) === 0, "por defecto 400 al día");
  // Cuota agotada: descansa 30 minutos, no todo el día (por si pasan a una cuenta de pago).
  sql.exec("DELETE FROM ia_respaldo");
  reiniciar();
  comportamientoLibre = () => { throw new Error("AiError: 4006: you have used up your daily free allocation of 10,000 neurons"); };
  await callado(async () => { for (const [i, t] of ["busco zapatos", "busco mocasines"].entries()) await webhook(envDe({ SOMBRA: "si", AI }), texto(`17${i}`, t)); });
  ok(llamadasLibre.length === 1, "si la cuota se acabó, el siguiente no vuelve a intentarlo enseguida (no hace esperar al cliente)", String(llamadasLibre.length));
  ok((await S.llamadasDeHoy(DB)).agotado && !(await S.llamadasDeHoy(DB, Date.now() + 31 * 60000)).agotado, "y a los 30 minutos vuelve a intentar (por si ya pagaron)");
  pagaFalla = null;
  comportamientoLibre = () => ({ response: JSON.stringify({ pienso: "", mostrar: "texto", voz: false, respuesta: "¡Hola! ¿Qué estás buscando hoy?", buscar: "NADA", historial: "" }), usage: { prompt_tokens: 25000, completion_tokens: 90 } });
  sql.exec("DELETE FROM ia_sombra"); sql.exec("DELETE FROM ia_respaldo");
}

titulo("el tope del día y la cuota gratis");
{
  sql.exec("DELETE FROM ia_sombra");
  reiniciar();
  const env = envDe({ SOMBRA: "si", SOMBRA_MODO: "sombra", AI, SOMBRA_MAX_DIA: "2" });
  await callado(async () => { for (const [i, t] of ["busco botas", "busco sandalias", "busco tenis blancos", "busco zapatos negros"].entries()) await webhook(env, texto(`11${i}`, t)); });
  ok(llamadasLibre.length === 2 && enviados.length >= 4, "con tope 2: se llama a la gratis 2 veces y los 4 clientes reciben su respuesta", `${llamadasLibre.length} llamadas, ${enviados.length} envíos`);
  sql.exec("DELETE FROM ia_sombra");
  reiniciar();
  comportamientoLibre = () => { throw new Error("AiError: 4006: you have used up your daily free allocation of 10,000 neurons"); };
  await callado(async () => { for (const [i, t] of ["busco botas", "busco sandalias", "busco tenis blancos"].entries()) await webhook(envDe({ SOMBRA: "si", SOMBRA_MODO: "sombra", AI }), texto(`12${i}`, t)); });
  ok(llamadasLibre.length === 1 && /^agotado/.test(sql.prepare("SELECT error FROM ia_sombra ORDER BY id LIMIT 1").get().error), "si Cloudflare dice que se acabó la cuota: UNA llamada y descansa el resto del día", `${llamadasLibre.length} llamadas`);
  ok((await S.llamadasDeHoy(DB)).agotado, "queda anotado: descansa un rato");
  ok((await S.llamadasDeHoy(DB, Date.now() + 86400000)).agotado === false, "pasado el rato (y al día siguiente) vuelve a intentar");
  comportamientoLibre = () => ({ response: JSON.stringify({ pienso: "", mostrar: "texto", voz: false, respuesta: "¡Hola! ¿Qué estás buscando hoy?", buscar: "NADA", historial: "" }), usage: { prompt_tokens: 25000, completion_tokens: 90 } });
  sql.exec("DELETE FROM ia_sombra");
  reiniciar();
  await callado(async () => { await webhook(envDe({ SOMBRA: "si", SOMBRA_MODO: "sombra", AI }), texto("1301", "gracias")); });
  ok(llamadasLibre.length === 0, "un «gracias» no gasta cuota (es cortesía)");
}

titulo("lo que el revisor marcó mal NO se imita");
{
  sql.exec("DELETE FROM ia_ejemplos");
  sql.exec("DELETE FROM ia_sombra");
  const turno = { id: 99, cliente: "tienen Nike Dunk?", respuesta: "Sí, a $5 cada una (inventado)" };
  await S.aprenderDelMaestro(envDe({ SOMBRA: "si", SOMBRA_MODO: "sombra", AI }), { entrada: "x", salida: { buscar: "Nike Dunk", mostrar: "texto" } }, { veredicto: "alucino" }, turno);
  ok(sql.prepare("SELECT bueno, revisado FROM ia_ejemplos WHERE turno = 99").get().bueno === 0, "queda guardado pero como malo: no se usa de ejemplo");
  ok((await S.ejemplosParecidos(DB, "tienen Nike Dunk", 3)).length === 0, "y no sale entre los parecidos");
  await S.aprenderDelMaestro(envDe({ SOMBRA: "si", SOMBRA_MODO: "sombra", AI }), { entrada: "x", salida: { buscar: "NADA", mostrar: "texto" } }, { veredicto: "bien" }, { id: 100, cliente: "tienen Nike Dunk?", respuesta: "Claro, mira estas 😊" });
  ok((await S.ejemplosParecidos(DB, "tienen Nike Dunk", 3)).length === 1, "una que el revisor dio por buena, sí");
  await S.aprenderDelMaestro(envDe(), { entrada: "x", salida: {} }, null, { id: 101, cliente: "algo nuevo de pruebas", respuesta: "respuesta nueva" });
  ok(!sql.prepare("SELECT 1 FROM ia_ejemplos WHERE turno = 101").get(), "con la sombra apagada no se junta nada");
}

titulo("el informe: cuándo diría «lista para tomar el mando»");
{
  sql.exec("DELETE FROM ia_sombra");
  let r = await S.resumenDeLaSombra(DB);
  ok(!r.listaParaElMando && /pocas comparaciones/.test(r.veredicto), "sin datos: todavía pocas comparaciones");
  const meter = (n, { buscar = 1, inventa = 0, parecido = 0.6, error = "" } = {}) => {
    for (let i = 0; i < n; i++) sql.prepare("INSERT INTO ia_sombra (cuando, dia, turno, cliente, mismo_buscar, mismo_modo, parecido, inventa, puntaje, tokens_entrada, tokens_salida, ms, error) VALUES (?, ?, ?, 'x', ?, 1, ?, ?, 0.7, 25000, 90, 3000, ?)").run(Date.now(), S.diaUtc(), 1000 + i, buscar, parecido, inventa, error);
  };
  meter(60);
  r = await S.resumenDeLaSombra(DB);
  ok(r.listaParaElMando && r.buscaLoMismoPct === 100 && r.inventaDatosPct === 0 && /Lista para tomar el mando/.test(r.veredicto), "60 comparaciones buenas: lista para tomar el mando", r.veredicto);
  ok(r.tokensDeEntradaMedios === 25000 && r.msMedios === 3000, "dice cuántos tokens gasta por llamada (para calcular la cuota)");
  meter(10, { inventa: 1 });
  r = await S.resumenDeLaSombra(DB);
  ok(!r.listaParaElMando && /inventa datos/.test(r.veredicto), "si inventa datos más del 2%: todavía no", r.veredicto);
  sql.exec("DELETE FROM ia_sombra");
  meter(60, { buscar: 0 });
  r = await S.resumenDeLaSombra(DB);
  ok(!r.listaParaElMando && /busca lo mismo solo el 0%/.test(r.veredicto), "si casi nunca busca lo mismo: todavía no", r.veredicto);
  meter(5, { error: "boom" });
  r = await S.resumenDeLaSombra(DB);
  ok(r.conError === 5 && r.validas === 60, "los errores se cuentan aparte y no cuentan como comparaciones");
}

titulo("/sombra es confidencial y se puede probar");
{
  const get = (ruta, extra = {}) => worker.fetch(new Request(`https://bot.test${ruta}`), envDe({ SOMBRA: "si", SOMBRA_MODO: "sombra", AI, ...extra }), { waitUntil: () => {} });
  let r = await get("/sombra");
  let t = await r.text();
  ok(/Bot activo/.test(t) && !/IA sombra/.test(t), "sin la clave: solo «vivo»");
  r = await get(`/sombra?clave=${API}`);
  t = await r.text();
  ok(r.status === 200 && /IA sombra/.test(t) && /llamadas hoy/.test(t) && /comparaciones válidas/.test(t), "con la clave: el informe");
  ok(!t.includes(API) || t.includes(`clave=${encodeURIComponent(API)}`), "la clave solo aparece en los enlaces de la propia página");
  sql.prepare("INSERT INTO ia_sombra (cuando, dia, turno, cliente, libre_respuesta, error) VALUES (?, ?, 7, '<script>alert(1)</script>', '<img src=x>', '')").run(Date.now(), S.diaUtc());
  t = await (await get(`/sombra?clave=${API}`)).text();
  ok(!/<script>alert|<img src=x>/.test(t) && /&lt;script&gt;/.test(t), "lo que escribió un cliente sale escapado (no ejecuta nada)");
  const j = await (await get(`/sombra?clave=${API}&formato=json`)).json();
  ok(j.encendida && j.modelo === S.MODELO_POR_DEFECTO && Array.isArray(j.ultimas) && j.ejemplos, "y en JSON");
  const p = await (await get(`/sombra/probar?clave=${API}`)).json();
  ok(p.activa && p.devolvioJson && p.respuesta && p.tokensDeEntrada === 25000 && !p.error, "/sombra/probar: una llamada real; dice si el modelo existe y cuántos tokens gasta", JSON.stringify(p));
  comportamientoLibre = () => { throw new Error("AiError: the prompt is too long, exceeds context length"); };
  const mal = await (await get(`/sombra/probar?clave=${API}`)).json();
  ok(/ventana de 100\.000/.test(mal.pista), "si el prompt no cabe en el modelo: dice qué hacer", JSON.stringify(mal));
  comportamientoLibre = () => { throw new Error("AiError: 5007: No such model @cf/x"); };
  ok(/no existe en tu cuenta/.test((await (await get(`/sombra/probar?clave=${API}`)).json()).pista), "si el modelo no existe: dice que cambie SOMBRA_MODELO");
  const apagada = await (await worker.fetch(new Request(`https://bot.test/sombra/probar?clave=${API}`), envDe(), { waitUntil: () => {} })).json();
  ok(!apagada.activa && /SOMBRA = "si"/.test(apagada.problema), "apagada: dice cómo encenderla");
  const sinBinding = await (await worker.fetch(new Request(`https://bot.test/sombra/probar?clave=${API}`), envDe({ SOMBRA: "si" }), { waitUntil: () => {} })).json();
  ok(/\[ai\]/.test(sinBinding.problema), "sin el binding [ai]: dice qué falta");
  const jsonl = await (await get(`/sombra/ejemplos.jsonl?clave=${API}`)).text();
  ok(jsonl.trim().split("\n").every((l) => { const o = JSON.parse(l); return o.cliente && o.respuesta; }) && /Claro, mira estas/.test(jsonl), "los ejemplos del maestro se bajan en JSONL, por si algún día se quiere afinar un modelo");
}

globalThis.fetch = real;
src.limpiar();
terminar();
