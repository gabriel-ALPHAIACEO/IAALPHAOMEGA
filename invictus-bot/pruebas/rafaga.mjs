// LOS MENSAJES REPETIDOS Y LOS MENSAJES SEGUIDOS (13-oct-2026, ver rafaga.js).
//
// Por el webhook de verdad (firma, worker.fetch, ctx.waitUntil) con SQLite
// de verdad debajo:
//   1. Meta manda 5 veces el mismo mensaje → UNA respuesta y UNA llamada a la IA.
//   2. "hola" / "tienes" / "la camisa roja?" seguidos → UNA llamada con los tres.
//   3. Dos clientes a la vez no se mezclan.
//   4. Quien escribe despacio recibe una respuesta por mensaje, como siempre.
//   5. JUNTAR_MENSAJES = "no" → cada mensaje por separado (lo repetido igual se descarta).
// Y la pieza sola: la foto se lleva el texto de antes, lo que no se junta
// (eco, voz, botón, anuncio), una base sin RETURNING o caída, y la cuenta
// para /estado.

import crypto from "node:crypto";
import { prepararSrc, baseDeMentira, baseCaida, ok, titulo, terminar } from "./ayuda.mjs";

const SECRETO = "secreto-de-prueba";
const CUENTA = "999";
const src = await prepararSrc();
const { default: worker } = await src.cargar("index.js");
const R = await src.cargar("rafaga.js");

// UNA base para todo lo que pasa por el webhook, como en producción: el
// Worker prepara sus tablas una vez y lo recuerda. Cada caso usa sus clientes.
const { DB: BASE } = baseDeMentira();
const envDe = (DB, extra = {}) => ({
  DB, META_APP_SECRET: SECRETO, META_MODO: "todo", IG_TOKEN: "x", OPENAI_API_KEY: "x",
  SHOPIFY_TIENDA: "tienda.test", SHOPIFY_TOKEN: "x", URL_CATALOGO: "https://tienda.test",
  TIENDA_NOMBRE: "Invictus Shoes", REVISOR_IA: "no", JUNTAR_SEGUNDOS: "0.4", ...extra,
});

// Lo que sale hacia la IA y hacia Instagram, por cliente.
let llamadas = [];
let enviados = [];
globalThis.fetch = async (url, op = {}) => {
  const u = String(url?.url || url);
  if (u.includes("api.openai.com")) {
    llamadas.push(String(op.body || ""));
    return Response.json({ choices: [{ message: { content: JSON.stringify({ pienso: "Saludo.", mostrar: "texto", voz: false, respuesta: "¡Hola! ¿Qué estás buscando? 😊", buscar: "NADA", historial: "Saludó." }) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
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

// Manda un aviso al webhook y devuelve lo que quedó trabajando (sin esperarlo).
async function webhook(env, evento) {
  const cuerpo = JSON.stringify({ object: "instagram", entry: [{ id: CUENTA, time: Date.now(), messaging: [evento] }] });
  const firma = "sha256=" + crypto.createHmac("sha256", SECRETO).update(cuerpo).digest("hex");
  const tareas = [];
  const r = await worker.fetch(new Request("https://bot.test/webhook", { method: "POST", headers: { "x-hub-signature-256": firma }, body: cuerpo }), env, { waitUntil: (p) => tareas.push(p) });
  return { status: r.status, listo: Promise.all(tareas) };
}
const texto = (igsid, t, mid = `m-${Math.random()}`) => ({ sender: { id: igsid }, recipient: { id: CUENTA }, timestamp: Date.now(), message: { mid, text: t } });
const pausa = (ms) => new Promise((s) => setTimeout(s, ms));

async function callado(hacer) {
  // VER=1 node pruebas/rafaga.mjs enseña el registro entero.
  if (process.env.VER) { await hacer(); return []; }
  const [l, e] = [console.log, console.error];
  const vistos = [];
  console.log = (...a) => vistos.push(a.join(" "));
  console.error = (...a) => vistos.push(a.join(" "));
  try {
    await hacer();
  } finally {
    console.log = l;
    console.error = e;
  }
  return vistos;
}

titulo("1. Meta manda 5 veces el mismo mensaje: una respuesta, una llamada a la IA");
{
  const DB = BASE;
  const env = envDe(DB);
  llamadas = [];
  enviados = [];
  const visto = await callado(async () => {
    const trabajos = [];
    for (let i = 0; i < 5; i++) {
      const r = await webhook(env, texto("100", "hola, tienen jordan?", "mid-repetido"));
      ok(r.status === 200, `aviso ${i + 1}: a Meta se le responde 200 igual`);
      trabajos.push(r.listo);
    }
    await Promise.all(trabajos);
  });
  ok(llamadas.length === 1, "una sola llamada a la IA", `hubo ${llamadas.length}`);
  ok(enviados.filter((e) => e.a === "100").length === 1, "una sola respuesta al cliente", `hubo ${enviados.length}`);
  ok(visto.filter((l) => /ya llegó antes/.test(l)).length === 4, "los otros 4 se descartan y queda escrito en el registro");
  const c = await R.cuentaDeRafagas(DB);
  ok(c.recibidos === 1 && c.repetidos === 4, "/estado cuenta 1 recibido y 4 repetidos", JSON.stringify(c));
}

titulo("2. «hola» / «tienes» / «la camisa roja?» seguidos: UNA llamada con los tres");
{
  const DB = BASE;
  const env = envDe(DB);
  llamadas = [];
  enviados = [];
  const antes = await R.cuentaDeRafagas(DB);
  await callado(async () => {
    const a = await webhook(env, texto("200", "hola"));
    await pausa(80);
    const b = await webhook(env, texto("200", "tienes"));
    await pausa(80);
    const c = await webhook(env, texto("200", "la camisa roja?"));
    await Promise.all([a.listo, b.listo, c.listo]);
  });
  ok(llamadas.length === 1, "una sola llamada a la IA", `hubo ${llamadas.length}`);
  const vio = llamadas[0] || ""; // el cuerpo entero que vio la IA
  ok(/hola\\ntienes\\nla camisa roja\?/.test(vio), "la IA recibe los tres, en orden y en líneas", vio.slice(-300));
  ok(enviados.filter((e) => e.a === "200").length === 1, "el cliente recibe una sola respuesta");
  const guardado = DB.prepare("SELECT texto FROM mensajes WHERE igsid = ? AND de = 'cliente'").bind("200");
  const filas = (await guardado.all()).results;
  ok(filas.length === 1 && /hola\ntienes\nla camisa roja\?/.test(filas[0].texto), "en el panel queda lo que escribió, entero", JSON.stringify(filas));
  const cuenta = await R.cuentaDeRafagas(DB);
  ok(cuenta.recibidos - antes.recibidos === 3 && cuenta.juntados - antes.juntados === 2, "/estado: 3 recibidos más, 2 juntados con otro", JSON.stringify({ antes, cuenta }));
}

titulo("3. Dos clientes a la vez no se mezclan");
{
  const DB = BASE;
  const env = envDe(DB);
  llamadas = [];
  enviados = [];
  await callado(async () => {
    const t = [];
    t.push((await webhook(env, texto("301", "buenas, busco zapatoalfa"))).listo);
    t.push((await webhook(env, texto("302", "hola, tienen zapatobeta"))).listo);
    await pausa(60);
    t.push((await webhook(env, texto("301", "tallaquince"))).listo);
    t.push((await webhook(env, texto("302", "colorpurpura"))).listo);
    await Promise.all(t);
  });
  ok(llamadas.length === 2, "una llamada por cliente", `hubo ${llamadas.length}`);
  const de301 = llamadas.find((l) => l.includes("busco zapatoalfa")) || "";
  const de302 = llamadas.find((l) => l.includes("tienen zapatobeta")) || "";
  ok(/busco zapatoalfa\\ntallaquince/.test(de301) && !/zapatobeta|colorpurpura/.test(de301), "la del primero lleva SOLO lo suyo");
  ok(/tienen zapatobeta\\ncolorpurpura/.test(de302) && !/zapatoalfa|tallaquince/.test(de302), "la del segundo lleva SOLO lo suyo");
  ok(enviados.filter((e) => e.a === "301").length === 1 && enviados.filter((e) => e.a === "302").length === 1, "cada uno recibe su respuesta");
}

titulo("4. Quien escribe despacio recibe una respuesta por mensaje");
{
  const DB = BASE;
  const env = envDe(DB, { JUNTAR_SEGUNDOS: "0.15" });
  llamadas = [];
  enviados = [];
  await callado(async () => {
    const a = await webhook(env, texto("400", "hola"));
    await a.listo;
    const b = await webhook(env, texto("400", "busco unas jordan"));
    await b.listo;
  });
  ok(llamadas.length === 2, "dos mensajes separados: dos llamadas", `hubo ${llamadas.length}`);
  ok(!llamadas[1].includes("hola\\nbusco"), "el segundo no arrastra al primero (ya se contestó)");
}

titulo("5. JUNTAR_MENSAJES = \"no\": cada mensaje por separado, lo repetido igual fuera");
{
  const DB = BASE;
  const env = envDe(DB, { JUNTAR_MENSAJES: "no" });
  llamadas = [];
  enviados = [];
  const inicio = Date.now();
  await callado(async () => {
    const a = await webhook(env, texto("500", "hola", "mid-500-a"));
    const b = await webhook(env, texto("500", "tienes jordan?", "mid-500-b"));
    const c = await webhook(env, texto("500", "tienes jordan?", "mid-500-b"));
    await Promise.all([a.listo, b.listo, c.listo]);
  });
  ok(llamadas.length === 2, "dos mensajes, dos llamadas (el repetido no cuenta)", `hubo ${llamadas.length}`);
  ok(Date.now() - inicio < 2000, "y sin esperar los segundos de la ráfaga");
  ok(R.juntarActivado({}) && R.juntarActivado({ JUNTAR_MENSAJES: "si" }) && !R.juntarActivado({ JUNTAR_MENSAJES: "No" }) && !R.juntarActivado({ JUNTAR_MENSAJES: "off" }), "encendido por defecto; «no»/«off» lo apagan");
  ok(R.esperaDeRafaga({}) === 3000 && R.esperaDeRafaga({ JUNTAR_SEGUNDOS: "4,5" }) === 4500 && R.esperaDeRafaga({ JUNTAR_SEGUNDOS: "60" }) === 8000 && R.esperaDeRafaga({ JUNTAR_SEGUNDOS: "x" }) === 3000, "espera: 3 s por defecto, con coma decimal, 8 s como mucho");
}

titulo("6. La pieza sola: foto, lo que no se junta, y una base que no ayuda");
{
  const { DB } = baseDeMentira();
  const env = { DB, JUNTAR_SEGUNDOS: "0.3" };
  const base = { igsid: "600", foto: "", historia: { url: "", id: "" } };
  const sinEsperar = { dormir: () => pausa(0) };
  let res;
  await callado(async () => {
    // El texto espera; la foto llega detrás y se lo lleva sin esperar.
    const t = R.recibirMensaje(env, { ...base, tipo: "texto", mid: "f1", texto: "¿tienes este?" });
    await pausa(30);
    const f = await R.recibirMensaje(env, { ...base, tipo: "imagen", mid: "f2", texto: "", foto: "https://cdn/foto.jpg" });
    res = { texto: await t, foto: f };
  });
  ok(res.texto === null, "el texto se calla: lo contesta la foto");
  ok(res.foto?.tipo === "imagen" && res.foto.texto === "¿tienes este?" && res.foto.foto === "https://cdn/foto.jpg", "la foto lleva la pregunta de antes", JSON.stringify(res.foto));

  // Foto primero, texto después: cada uno lo suyo (como siempre).
  await callado(async () => {
    const f = await R.recibirMensaje(env, { ...base, igsid: "601", tipo: "imagen", mid: "g1", texto: "", foto: "https://cdn/x.jpg" });
    const t = await R.recibirMensaje(env, { ...base, igsid: "601", tipo: "texto", mid: "g2", texto: "precio?" }, sinEsperar);
    res = { f, t };
  });
  ok(res.f?.texto === "" && res.t?.texto === "precio?", "foto y después texto: se contestan los dos, cada uno con lo suyo");

  // Lo que no se junta: eco, nota de voz, botón, anuncio.
  for (const [nombre, m] of [
    ["un eco", { tipo: "eco", mid: "e1", texto: "ya te atiendo" }],
    ["una nota de voz", { tipo: "audio", mid: "v1", texto: "", audio: "https://cdn/nota" }],
    ["un botón", { tipo: "texto", mid: "b1", texto: "Ver más", opcion: "MAS" }],
    ["un anuncio", { tipo: "texto", mid: "a1", texto: "Hola, quiero info", anuncio: { id: "123" } }],
  ]) {
    let dormido = false;
    const salida = await R.recibirMensaje(env, { ...base, igsid: "610", ...m }, { dormir: async () => { dormido = true; } });
    ok(salida && salida.texto === m.texto && !dormido, `${nombre}: sale tal cual y sin esperar`);
  }
  ok((await R.recibirMensaje(env, { ...base, igsid: "610", tipo: "eco", mid: "e1", texto: "ya te atiendo" })) === null, "un eco repetido también se descarta");
  // Un texto que llega después de la nota de voz no se calla por ella.
  const t2 = await R.recibirMensaje(env, { ...base, igsid: "610", tipo: "texto", mid: "t9", texto: "hola" }, sinEsperar);
  ok(t2?.texto === "hola", "un texto suelto después de eso: se contesta");

  // Sin mid, sin base, o un comentario: como antes, sin tocar nada.
  const sinMid = { ...base, tipo: "texto", mid: "", texto: "hola" };
  ok((await R.recibirMensaje(env, sinMid)) === sinMid, "sin mid: como antes");
  ok((await R.recibirMensaje({}, { ...sinMid, mid: "z" }))?.texto === "hola", "sin base: como antes");
  const coment = { tipo: "comentario", igsid: "x", mid: "c1", texto: "precio" };
  ok((await R.recibirMensaje(env, coment)) === coment, "un comentario: como antes");

  // Una base caída o una que no devuelve RETURNING: se contesta igual.
  let caida;
  await callado(async () => {
    caida = await R.recibirMensaje({ DB: baseCaida().DB }, { ...base, tipo: "texto", mid: "k1", texto: "hola" });
  });
  ok(caida?.texto === "hola", "base caída: se contesta (mejor un doble que un cliente sin respuesta)");
  let dormido = false;
  const tonta = { prepare: () => ({ bind() { return this; }, run: async () => ({}), first: async () => null, all: async () => ({}) }), batch: async () => [] };
  const conTonta = await R.recibirMensaje({ DB: tonta }, { ...base, tipo: "texto", mid: "k2", texto: "hola" }, { dormir: async () => { dormido = true; } });
  ok(conTonta?.texto === "hola" && !dormido, "una base sin RETURNING: se contesta sin esperar");

  // Lo de hace más de 48 h se borra solo.
  await DB.prepare("INSERT INTO mensajes_recibidos (mid, igsid, tipo, texto, llego) VALUES ('viejo', '1', 'texto', '', ?)").bind(Date.now() - 49 * 3600 * 1000).run();
  const azar = Math.random;
  Math.random = () => 0;
  try {
    await R.recibirMensaje({ DB, JUNTAR_MENSAJES: "no" }, { ...base, tipo: "texto", mid: "limpia", texto: "x" });
  } finally {
    Math.random = azar;
  }
  const viejo = await DB.prepare("SELECT 1 FROM mensajes_recibidos WHERE mid = 'viejo'").first();
  ok(!viejo, "lo de hace más de 48 h se borra");
}

terminar();
