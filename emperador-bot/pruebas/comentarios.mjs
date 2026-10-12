// LOS COMENTARIOS DE INSTAGRAM, EN EL EMPERADOR (12-oct-2026): la IA responde
// todos, de punta a punta (webhook firmado → IA → lo que sale por Instagram).
//
// Lo que se protege:
//   · cada comentario recibe una respuesta pública escrita por la IA;
//   · si hay interés de compra, se abre el privado con los productos y su
//     precio sacados del catálogo (la IA no escribe precios);
//   · el spam y los insultos no se responden;
//   · el mismo comentario (Meta reintenta) se contesta una sola vez;
//   · el bot no se responde a sí mismo, ni a su propia respuesta;
//   · no promete "te escribimos por DM" si el privado no salió.

import { prepararSrc, baseDeMentira, fuente, ok, titulo, terminar } from "./ayuda.mjs";
import crypto from "node:crypto";

const SECRETO = "secreto-de-prueba";
const src = await prepararSrc();
const { default: worker } = await src.cargar("index.js");
const base = baseDeMentira();

async function comentar(texto, { decision, env = {}, privadoFalla = false, de = "555", id = `c${Math.random()}`, media = "M1" } = {}) {
  const publicas = [];
  const privados = [];
  const slack = [];
  const falso = async (url, op = {}) => {
    const u = String(url);
    if (u.includes("api.deepseek.com") || u.includes("api.openai.com")) {
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(decision) } }], usage: { prompt_tokens: 100, completion_tokens: 10 } }), { status: 200 });
    }
    if (u.includes("graph.instagram.com") && /\/replies/.test(u)) {
      publicas.push(JSON.parse(op.body).message);
      return new Response(JSON.stringify({ id: "r1" }), { status: 200 });
    }
    if (u.includes("graph.instagram.com") && /\/me\/messages/.test(u)) {
      const cuerpo = JSON.parse(op.body);
      if (cuerpo.recipient?.comment_id) {
        if (privadoFalla) return new Response('{"error":{"message":"no"}}', { status: 403 });
        privados.push(cuerpo.message.text);
        return new Response(JSON.stringify({ recipient_id: "555", message_id: "mid-privado" }), { status: 200 });
      }
      return new Response(JSON.stringify({ message_id: "mid-x" }), { status: 200 });
    }
    if (u.includes("graph.instagram.com") && /fields=caption/.test(u)) return new Response(JSON.stringify({ caption: "Nike Air Force One blancas", permalink: "https://ig/p/1" }), { status: 200 });
    if (u.includes("graph.instagram.com") && /fields=id,username/.test(u)) return new Response(JSON.stringify({ id: "999", username: "elemperador" }), { status: 200 });
    if (u.includes("graph.instagram.com")) return new Response(JSON.stringify({ name: "Ana", username: "ana" }), { status: 200 });
    if (u.includes("hooks.slack.com")) {
      slack.push(JSON.parse(op.body).text || "");
      return new Response("ok", { status: 200 });
    }
    if (u.includes("/graphql.json")) {
      const edges = [{ node: { title: "Nike Air Force One blancas", featuredImage: { url: "https://cdn.test/af1.jpg" }, onlineStoreUrl: "https://tienda.test/af1", priceRangeV2: { minVariantPrice: { amount: "85", currencyCode: "USD" } } } }];
      return new Response(JSON.stringify({ data: { products: { edges, pageInfo: { hasNextPage: false } } } }), { status: 200 });
    }
    return new Response("", { status: 404 });
  };
  const cuerpo = JSON.stringify({
    object: "instagram",
    entry: [{ id: "999", time: Date.now(), changes: [{ field: "comments", value: { id, text: texto, from: { id: de, username: "cliente" + de }, media: { id: media } } }] }],
  });
  const firma = "sha256=" + crypto.createHmac("sha256", SECRETO).update(cuerpo).digest("hex");
  const fullEnv = { DB: base.DB, META_APP_SECRET: SECRETO, META_MODO: "todo", IG_TOKEN: "x", DEEPSEEK_API_KEY: "x", SHOPIFY_TIENDA: "tienda.test", SHOPIFY_TOKEN: "x", SLACK_WEBHOOK: "https://hooks.slack.com/x", URL_CATALOGO: "https://tienda.test", ...env };
  const [fetchReal, log, error] = [globalThis.fetch, console.log, console.error];
  globalThis.fetch = falso;
  console.log = () => {};
  console.error = () => {};
  const tareas = [];
  try {
    await worker.fetch(new Request("https://bot.test/webhook", { method: "POST", headers: { "x-hub-signature-256": firma, "content-type": "application/json" }, body: cuerpo }), fullEnv, { waitUntil: (p) => tareas.push(p) });
    await Promise.all(tareas);
  } finally {
    globalThis.fetch = fetchReal;
    console.log = log;
    console.error = error;
  }
  return { publicas, privados, slack };
}

const GRACIAS = { publico: "¡Gracias! 🙌", interes: false, buscar: "NADA", privado: "" };
const PRECIO = { publico: "¡Hola! 😊 Te escribimos por privado con el precio 📩", interes: true, buscar: "Air Force One", privado: "¡Hola! 😊 Vi tu comentario, te paso la info 👇" };

titulo("un elogio: se responde en público, sin vender");
let r = await comentar("🔥🔥🔥", { decision: GRACIAS });
ok(r.publicas.length === 1 && r.publicas[0] === "¡Gracias! 🙌", "la respuesta pública la escribe la IA", JSON.stringify(r.publicas));
ok(r.privados.length === 0, "y no se abre ningún privado");

titulo("quiere el precio: público + privado con los productos");
r = await comentar("precio?", { decision: PRECIO });
ok(r.privados.length === 1 && /Air Force One blancas/.test(r.privados[0]) && /85/.test(r.privados[0]), "el privado trae el producto y su precio del catálogo", r.privados[0]);
ok(r.privados[0] && !/\$\s?\d{3,}/.test(r.privados[0]), "ningún precio inventado");
ok(r.publicas.length === 1 && /DM|privado/i.test(r.publicas[0]), "en público dice que le escriben, y es verdad", r.publicas[0]);
ok(r.slack.length === 1 && /COMENT/i.test(r.slack[0]), "y avisa al asesor", r.slack[0]?.slice(0, 80));

titulo("spam o insulto: no se responde");
r = await comentar("gana dinero www.algo.com", { decision: { publico: "", interes: false, buscar: "NADA", privado: "" } });
ok(r.publicas.length === 0 && r.privados.length === 0, "no sale nada");

titulo("Meta reintenta: se contesta una sola vez");
r = await comentar("hola", { decision: GRACIAS, id: "repetido" });
const otra = await comentar("hola", { decision: GRACIAS, id: "repetido" });
ok(r.publicas.length === 1 && otra.publicas.length === 0, "el mismo comentario, una sola respuesta");

titulo("el bot no se responde a sí mismo");
r = await comentar("¡Gracias! 🙌", { decision: GRACIAS, de: "999" });
ok(r.publicas.length === 0, "un comentario de la propia cuenta se ignora");
r = await comentar("¡Gracias! 🙌", { decision: GRACIAS, id: "r1" });
ok(r.publicas.length === 0, "el eco de su propia respuesta (id r1) se ignora");

titulo("si el privado no sale, no se promete");
r = await comentar("cuánto cuestan?", { decision: PRECIO, privadoFalla: true });
ok(r.privados.length === 0 && r.publicas.length === 1 && /escr[ií]b/i.test(r.publicas[0]) && !/te escribimos/i.test(r.publicas[0]), "en público le pide que escriba él", r.publicas[0]);

r = await comentar("precio?", { decision: PRECIO, env: { COMENTARIOS: "off" } });
ok(r.publicas.length === 0 && r.privados.length === 0, "off: no toca los comentarios");
r = await comentar("precio?", { decision: PRECIO, env: { COMENTARIOS: "publico" } });
ok(r.publicas.length === 1 && r.privados.length === 0, "publico: solo la respuesta pública");
ok(!/te escribimos por dm/i.test(r.publicas[0] || ""), "y no promete un DM que no manda", r.publicas[0]);
r = await comentar("precio?", { decision: PRECIO, env: { COMENTARIOS: "privado" } });
ok(r.privados.length === 1 && r.publicas.length === 0, "privado: solo el privado, sin respuesta pública");

titulo("conexiones");
ok(/comments/.test(fuente("instagram.js").match(/CAMPOS_DEL_WEBHOOK = "[^"]+"/)?.[0] || ""), "el webhook se suscribe al campo comments");

terminar();
