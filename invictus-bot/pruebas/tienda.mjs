// EL PANEL DE LA TIENDA (/panel, 2-oct-2026): la clave, la lista de
// conversaciones, los mensajes guardados (cliente, bot y asesor), lo que
// pensó la IA debajo de cada respuesta, y pausar / devolver.
//
// Instagram, OpenAI y Shopify son de mentira; la base es SQLite de verdad.

import { prepararSrc, baseDeMentira, ok, titulo, terminar } from "./ayuda.mjs";
import crypto from "node:crypto";

const SECRETO = "secreto-de-prueba";
const CLAVE = "clave-del-panel-123";
const src = await prepararSrc();
const { default: worker } = await src.cargar("index.js");
const P = await src.cargar("panel.js");
const { DB } = baseDeMentira();
const ENV = {
  DB, META_APP_SECRET: SECRETO, META_MODO: "todo", IG_TOKEN: "x", OPENAI_API_KEY: "x",
  SHOPIFY_TIENDA: "tienda.test", SHOPIFY_TOKEN: "x", URL_CATALOGO: "https://tienda.test",
  PANEL_CLAVE: CLAVE, TIENDA_NOMBRE: "Invictus Shoes", PAUSA_HORAS: "1",
};

function falso(modelo) {
  return async (url, op = {}) => {
    const u = String(url);
    if (u.includes("api.openai.com")) {
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(modelo) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
    }
    if (u.includes("graph.instagram.com") && u.includes("/messages")) return new Response(JSON.stringify({ message_id: `mid-${Math.random()}` }), { status: 200 });
    if (u.includes("graph.instagram.com")) return new Response(JSON.stringify({ name: "Ana Pérez", username: "ana" }), { status: 200 });
    if (u.includes("/graphql.json")) return new Response(JSON.stringify({ data: { products: { edges: [], pageInfo: { hasNextPage: false } } } }), { status: 200 });
    return new Response("ok", { status: 200 });
  };
}

async function callado(fn) {
  const [l, e] = [console.log, console.error];
  console.log = console.error = () => {};
  try { return await fn(); } finally { console.log = l; console.error = e; }
}

async function escribe(texto, modelo) {
  const cuerpo = JSON.stringify({ object: "instagram", entry: [{ id: "999", time: Date.now(), messaging: [{ sender: { id: "123" }, recipient: { id: "999" }, timestamp: Date.now(), message: { mid: `m-${Math.random()}`, text: texto } }] }] });
  const firma = "sha256=" + crypto.createHmac("sha256", SECRETO).update(cuerpo).digest("hex");
  const real = globalThis.fetch;
  globalThis.fetch = falso(modelo);
  const tareas = [];
  try {
    await callado(async () => {
      await worker.fetch(new Request("https://bot.test/webhook", { method: "POST", headers: { "x-hub-signature-256": firma }, body: cuerpo }), ENV, { waitUntil: (p) => tareas.push(p) });
      await Promise.all(tareas);
    });
  } finally {
    globalThis.fetch = real;
  }
}

async function pedir(ruta, { metodo = "GET", cookie = "", cuerpo = null, origen = "", env = ENV } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (origen) headers.origin = origen;
  const real = globalThis.fetch;
  globalThis.fetch = falso({});
  try {
    const r = await callado(() => worker.fetch(new Request(`https://bot.test${ruta}`, { method: metodo, headers, body: cuerpo }), env, { waitUntil() {} }));
    return { estado: r.status, texto: await r.text(), cookie: r.headers.get("set-cookie") || "", donde: r.headers.get("location") || "" };
  } finally {
    globalThis.fetch = real;
  }
}

await escribe("hola, tienen jordan 4?", { pienso: "Saluda y pide Jordan 4: primer mensaje, bienvenida y busco Retro 4.", mostrar: "texto_e_imagenes", voz: false, respuesta: "¡Hola! Soy la asistente virtual de Invictus Shoes 👋 Déjame revisar los Jordan 4", buscar: "NADA", historial: "Ya di la bienvenida. Pidió Jordan 4." });
// Un asesor escribe a mano desde Instagram (lo guarda la rama del eco).
await callado(() => P.anotarMensaje(DB, "123", "asesor", "Hola Ana, te escribo yo 😊"));

titulo("la clave");
let r = await pedir("/panel");
ok(/Escribe la clave del panel/.test(r.texto) && !/Jordan/.test(r.texto), "sin sesión pide la clave y no enseña nada");
const mala = new FormData(); mala.set("clave", "otra");
r = await pedir("/panel/entrar", { metodo: "POST", cuerpo: mala });
ok(/Esa no es la clave/.test(r.texto) && !r.cookie, "con la clave equivocada no entra");
const buena = new FormData(); buena.set("clave", CLAVE);
r = await pedir("/panel/entrar", { metodo: "POST", cuerpo: buena });
const cookie = r.cookie.split(";")[0];
ok(/HttpOnly/.test(r.cookie) && /Path=\/panel/.test(r.cookie), "con la buena entra (cookie firmada, solo para /panel)");
const sinClave = await pedir("/panel", { env: { DB } });
ok(/El panel está apagado/.test(sinClave.texto), "sin PANEL_CLAVE el panel no abre para nadie");

titulo("la lista y la conversación");
r = await pedir("/panel", { cookie });
ok(/Ana Pérez/.test(r.texto) && /@ana/.test(r.texto), "la lista enseña a la clienta, con su @");
ok(!/Anuncios/.test(r.texto), "Invictus no tiene panel de anuncios: no sale en el menú");
r = await pedir("/panel?q=jordan", { cookie });
ok(/Ana Pérez/.test(r.texto), "el buscador encuentra por lo que escribió");
r = await pedir("/panel/c/123", { cookie });
ok(/hola, tienen jordan 4\?/.test(r.texto), "la conversación: lo que escribió la clienta");
ok(/Déjame revisar los Jordan 4/.test(r.texto), "lo que contestó el bot");
ok(/Asesor \(a mano\)/.test(r.texto) && /te escribo yo/.test(r.texto), "y lo que escribió un asesor a mano");
ok(/Lo que pensó la IA/.test(r.texto) && /busco Retro 4/.test(r.texto), "debajo de la respuesta, LO QUE PENSÓ LA IA");

titulo("pausar y devolver");
const id = new FormData(); id.set("id", "123");
r = await pedir("/panel/pausar", { metodo: "POST", cookie, cuerpo: id, origen: "https://otra-web.com" });
ok(r.estado === 403, "una acción que viene de otra web se rechaza");
await pedir("/panel/pausar", { metodo: "POST", cookie, cuerpo: id, origen: "https://bot.test" });
r = await pedir("/panel/c/123", { cookie });
ok(/Bot en pausa hasta/.test(r.texto), "pausar el bot desde el panel");
const id2 = new FormData(); id2.set("id", "123");
await pedir("/panel/devolver", { metodo: "POST", cookie, cuerpo: id2, origen: "https://bot.test" });
r = await pedir("/panel/c/123", { cookie });
ok(/Pausar el bot 1 h/.test(r.texto), "y devolverle la conversación");

titulo("seguridad y el resto");
r = await pedir("/panel/c/%3Cscript%3E", { cookie });
ok(!/<script>/.test(r.texto), "lo que viene en la URL se escapa");
r = await pedir("/panel/estado", { cookie });
ok(/PANEL_CLAVE/.test(r.texto), "el estado se ve dentro del panel");

src.limpiar();
terminar();
