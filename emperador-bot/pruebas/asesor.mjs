// QUE LA IA SE CALLE CUANDO HABLA EL ASESOR (5-oct-2026).
//
// El dueño: "la IA responde mientras está hablando el asesor; que se quede
// 100% callada". Tres casos de verdad:
//   1. El asesor escribe SEGUNDOS después de una respuesta del bot (antes,
//      la red de 90 segundos lo tomaba por el bot y no se pausaba).
//   2. El eco del propio mensaje del bot, con el mid todavía sin guardar:
//      no puede pausar (si no, el bot se calla solo).
//   3. El asesor entra MIENTRAS la IA está pensando: no sale nada más.
//
// Cada caso espera los 4 segundos reales del "segundo vistazo".
//   4. Un mensaje vacío pegado al de un anuncio: una sola respuesta.

import crypto from "node:crypto";
import { prepararSrc, baseDeMentira, ok, titulo, terminar } from "./ayuda.mjs";

const SECRETO = "secreto-de-prueba";
const CUENTA = "999";
const src = await prepararSrc();
const { default: worker } = await src.cargar("index.js");
const E = await src.cargar("estado.js");
const { DB } = baseDeMentira();
const ENV = {
  DB, META_APP_SECRET: SECRETO, META_MODO: "todo", IG_TOKEN: "x", OPENAI_API_KEY: "x", DEEPSEEK_API_KEY: "x", PROVEEDOR: "deepseek", CATALOGO: "shopify",
  SHOPIFY_TIENDA: "tienda.test", SHOPIFY_TOKEN: "x", URL_CATALOGO: "https://tienda.test",
  TIENDA_NOMBRE: "El Emperador", PAUSA_HORAS: "4", REVISOR_IA: "no",
};

const RESPUESTA = "¡Hola! Claro que sí, tenemos varios modelos. ¿Qué talla usas? 😊";
let enviados = [];
let alPensar = null; // se llama mientras "la IA piensa"

globalThis.fetch = async (url, op = {}) => {
  const u = String(url?.url || url);
  if ((u.includes("api.openai.com") || u.includes("deepseek.com"))) {
    if (alPensar) await alPensar();
    return Response.json({ choices: [{ message: { content: JSON.stringify({ pienso: "Saludo.", mostrar: "texto", voz: false, respuesta: RESPUESTA, buscar: "NADA", historial: "Saludó." }) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
  }
  if (u.includes("graph.instagram.com") && u.includes("/messages")) {
    const cuerpo = JSON.parse(op.body || "{}");
    enviados.push(cuerpo?.message?.text || "(adjunto)");
    return Response.json({ message_id: `mid-bot-${Math.random()}` });
  }
  if (u.includes("graph.instagram.com")) return Response.json({ name: "Ana Pérez", username: "ana" });
  if (u.includes("graphql.json")) return Response.json({ data: { products: { edges: [], pageInfo: { hasNextPage: false } } } });
  return new Response("ok");
};

async function webhookCrudo(evento) {
  const cuerpo = JSON.stringify({ object: "instagram", entry: [{ id: CUENTA, time: Date.now(), messaging: [evento] }] });
  const firma = "sha256=" + crypto.createHmac("sha256", SECRETO).update(cuerpo).digest("hex");
  const tareas = [];
  await worker.fetch(new Request("https://bot.test/webhook", { method: "POST", headers: { "x-hub-signature-256": firma }, body: cuerpo }), ENV, { waitUntil: (p) => tareas.push(p) });
  await Promise.all(tareas);
}
// Varios a la vez, con la consola callada UNA vez para todos (si cada uno
// la callara y la devolviera por su cuenta, se cruzan y no se ve nada).
async function aLaVez(...eventos) {
  const [l, e] = [console.log, console.error];
  console.log = console.error = () => {};
  try {
    await Promise.all(eventos.map(webhookCrudo));
  } finally {
    console.log = l;
    console.error = e;
  }
}
const webhook = (evento) => aLaVez(evento);
const delCliente = (igsid, texto) => webhook({ sender: { id: igsid }, recipient: { id: CUENTA }, timestamp: Date.now(), message: { mid: `m-${Math.random()}`, text: texto } });
const eco = (igsid, texto) => webhook({ sender: { id: CUENTA }, recipient: { id: igsid }, timestamp: Date.now(), message: { mid: `m-ajeno-${Math.random()}`, is_echo: true, ...(texto ? { text: texto } : { attachments: [{ type: "template", payload: {} }] }) } });
const pausado = async (igsid) => E.estaPausado(await E.cargarContacto(DB, igsid));

titulo("1. el asesor escribe segundos después del bot: el bot se pausa");
{
  await delCliente("100", "hola, tienen jordan?");
  ok(enviados.includes(RESPUESTA), "el bot contestó");
  await eco("100", "Hola Ana, soy Carlos de la tienda, ya te atiendo yo 🙌");
  ok(await pausado("100"), "el mensaje del asesor (dentro de los 90 s) pausa al bot");
  enviados = [];
  await delCliente("100", "dale, gracias Carlos");
  ok(enviados.length === 0, "y el bot NO responde lo siguiente del cliente", enviados.join(" | "));
}

titulo("2. el eco del propio bot (mid sin guardar) no pausa");
{
  enviados = [];
  await delCliente("200", "buenas");
  await eco("200", RESPUESTA);
  ok(!(await pausado("200")), "su mismo texto, aunque el mid no cuadre: es del bot, no pausa");
  await eco("200", "");
  ok(!(await pausado("200")), "un eco sin texto justo después (el carrusel de fichas): tampoco");
}

titulo("4. el mensaje vacío pegado al del anuncio: una sola respuesta (6-oct-2026)");
{
  enviados = [];
  // Instagram, desde un anuncio: la tarjeta (sin texto) y la pregunta, a la vez.
  await aLaVez(
    { sender: { id: "400" }, recipient: { id: CUENTA }, timestamp: Date.now(), message: { mid: `m-${Math.random()}`, attachments: [{ type: "fallback", payload: {} }] } },
    { sender: { id: "400" }, recipient: { id: CUENTA }, timestamp: Date.now(), message: { mid: `m-${Math.random()}`, text: "¿Cuál es el precio de los zapatos Retro 3?" } }
  );
  ok(enviados.filter((t) => t === RESPUESTA).length === 1, "se contesta una sola vez (la pregunta), no un '¿qué estás buscando?' de más", enviados.join(" | "));
  enviados = [];
  await webhook({ sender: { id: "401" }, recipient: { id: CUENTA }, timestamp: Date.now(), message: { mid: `m-${Math.random()}`, attachments: [{ type: "fallback", payload: {} }] } });
  ok(enviados.length >= 1, "un vacío SOLO (sin nada al lado) sigue teniendo respuesta: nadie se queda sin contestar", enviados.join(" | "));
}

titulo("3. el asesor entra mientras la IA piensa: no sale nada");
{
  enviados = [];
  alPensar = async () => {
    alPensar = null;
    await E.pausar(DB, "300", 4); // lo que hace el eco del asesor, a mitad del turno
  };
  await delCliente("300", "tienen yeezy?");
  ok(enviados.length === 0, "el turno ya empezado no manda nada después de la pausa", enviados.join(" | "));
}

terminar();
