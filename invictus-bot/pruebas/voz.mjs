// LAS NOTAS DE VOZ (2-oct-2026): el cliente manda un audio, el bot lo
// escucha (lo pasa a texto con OpenAI) y le contesta como si lo hubiera
// escrito. Si no lo puede escuchar, le pide que escriba: nunca se calla.
//
// Instagram, OpenAI y Slack son de mentira (se cambia fetch).

import { prepararSrc, baseDeMentira, ok, titulo, terminar } from "./ayuda.mjs";
import crypto from "node:crypto";

const SECRETO = "secreto-de-prueba";

titulo("Instagram: una nota de voz se reconoce como audio");
{
  const src = await prepararSrc();
  const I = await src.cargar("instagram.js");
  const log = console.log; console.log = () => {};
  const m = I.leerMensaje({ entry: [{ messaging: [{ sender: { id: "1" }, message: { mid: "a1", attachments: [{ type: "audio", payload: { url: "https://cdn.test/nota.mp4" } }] } }] }] });
  console.log = log;
  ok(m && m.tipo === "audio" && m.audio === "https://cdn.test/nota.mp4", "tipo audio, con el enlace de la nota", JSON.stringify(m));
  src.limpiar();
}

async function mandarNota({ transcripcion = "hola tienes las jordan 4 en negro", falla = false, comoTexto = false } = {}) {
  const src = await prepararSrc();
  const { default: worker } = await src.cargar("index.js");
  const enviados = [], llamadasIA = [], transcripciones = [], habladas = [];
  const falso = async (url, op = {}) => {
    const u = String(url);
    if (u === "https://cdn.test/nota.mp4") return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), { status: 200, headers: { "content-type": "audio/mp4" } });
    if (u.includes("/audio/speech")) {
      habladas.push(JSON.parse(op.body));
      return new Response(new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]), { status: 200, headers: { "content-type": "audio/wav" } });
    }
    if (u.includes("/audio/transcriptions")) {
      transcripciones.push(op.body);
      if (falla) return new Response('{"error":{"message":"boom"}}', { status: 500 });
      return new Response(JSON.stringify({ text: transcripcion, usage: { input_tokens: 50, output_tokens: 10 } }), { status: 200 });
    }
    if (u.includes("api.openai.com")) {
      const cuerpo = JSON.parse(op.body);
      llamadasIA.push(cuerpo.messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n"));
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ pienso: "Pide Jordan 4 negro.", mostrar: "texto", respuesta: "¡Sí tengo las Jordan 4! 😊", buscar: "NADA", historial: "Pidió Jordan 4 por audio." }) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
    }
    if (u.includes("graph.instagram.com") && u.includes("/messages")) {
      enviados.push(JSON.parse(op.body).message);
      return new Response(JSON.stringify({ message_id: `mid-${enviados.length}` }), { status: 200 });
    }
    if (u.includes("graph.instagram.com")) return new Response(JSON.stringify({ name: "Ana", username: "ana" }), { status: 200 });
    if (u.includes("/graphql.json")) return new Response(JSON.stringify({ data: { products: { edges: [], pageInfo: { hasNextPage: false } } } }), { status: 200 });
    return new Response("ok", { status: 200 });
  };
  const env = { DB: baseDeMentira().DB, META_APP_SECRET: SECRETO, META_MODO: "todo", IG_TOKEN: "x", OPENAI_API_KEY: "x",
    SHOPIFY_TIENDA: "tienda.test", SHOPIFY_TOKEN: "x", SLACK_WEBHOOK: "https://hooks.slack.com/x", URL_CATALOGO: "https://tienda.test" };
  const cuerpo = JSON.stringify({ object: "instagram", entry: [{ id: "999", time: Date.now(), messaging: [{ sender: { id: "123" }, recipient: { id: "999" }, timestamp: Date.now(),
    message: comoTexto ? { mid: `m-${Math.random()}`, text: "hola tienes las jordan 4 en negro" } : { mid: `m-${Math.random()}`, attachments: [{ type: "audio", payload: { url: "https://cdn.test/nota.mp4" } }] } }] }] });
  const firma = "sha256=" + crypto.createHmac("sha256", SECRETO).update(cuerpo).digest("hex");
  const registro = [];
  const [real, log, error] = [globalThis.fetch, console.log, console.error];
  globalThis.fetch = falso;
  console.log = (...a) => registro.push(a.join(" "));
  console.error = (...a) => registro.push(a.join(" "));
  const tareas = [];
  try {
    await worker.fetch(new Request("https://bot.test/webhook", { method: "POST", headers: { "x-hub-signature-256": firma }, body: cuerpo }), env, { waitUntil: (p) => tareas.push(p) });
    await Promise.all(tareas);
  } finally {
    globalThis.fetch = real; console.log = log; console.error = error;
  }
  // Lo que Instagram bajaría del enlace de la nota de voz.
  const audio = enviados.find((m) => m.attachment?.type === "audio");
  let servida = null;
  if (audio) {
    const r = await worker.fetch(new Request(audio.attachment.payload.url), env, { waitUntil() {} });
    servida = { estado: r.status, tipo: r.headers.get("content-type"), bytes: (await r.arrayBuffer()).byteLength };
  }
  src.limpiar();
  return { enviados, llamadasIA, transcripciones, habladas, audio, servida, registro: registro.join("\n") };
}

titulo("el cliente manda un audio: se escucha y se contesta");
{
  const r = await mandarNota();
  const form = r.transcripciones[0];
  ok(form instanceof FormData && form.get("model") === "gpt-4o-mini-transcribe" && form.get("language") === "es", "se manda a transcribir, en español", form && form.get("model"));
  ok(/Jordan/.test(String(form?.get("prompt"))), "con las marcas de la tienda como pista");
  ok(r.llamadasIA.some((t) => /hola tienes las jordan 4 en negro/.test(t)), "lo que dijo le llega a la IA como si lo hubiera escrito");
  ok(r.llamadasIA.some((t) => /NOTA DE VOZ/.test(t)), "y la IA sabe que vino por voz (por si alguna palabra salió mal)");
  ok(r.enviados.some((m) => /Sí tengo las Jordan 4/.test(m.text || "")), "el cliente recibe la respuesta", JSON.stringify(r.enviados).slice(0, 120));
  ok(/Voz: el cliente dijo/.test(r.registro), "y en el registro queda lo que dijo");
}

titulo("le habló con voz: le contesta con voz, ADEMÁS del texto");
{
  const r = await mandarNota();
  ok(r.enviados.some((m) => /Sí tengo las Jordan 4/.test(m.text || "")), "el texto le llega igual");
  ok(r.audio && /^https:\/\/bot\.test\/voz\/[a-f0-9]+\.wav$/.test(r.audio.attachment.payload.url), "y una nota de voz, con un enlace del propio Worker", r.audio?.attachment?.payload?.url);
  ok(r.servida && r.servida.estado === 200 && r.servida.tipo === "audio/wav" && r.servida.bytes === 8, "el Worker sirve ese audio (Instagram lo puede bajar)", JSON.stringify(r.servida));
  const dicho = r.habladas[0] || {};
  ok(dicho.model === "gpt-4o-mini-tts" && /español latinoamericano/.test(dicho.instructions || ""), "voz de OpenAI, en español latino y tono de vendedora");
  ok(dicho.input === "¡Sí tengo las Jordan 4!", "lee la frase, sin emojis", JSON.stringify(dicho.input));
}
{
  const r = await mandarNota({ comoTexto: true });
  ok(!r.audio && r.habladas.length === 0, "si escribió, se le contesta solo por escrito (sin voz)");
}

titulo("lo que se lee en voz: sin emojis, sin enlaces, corto");
{
  const src = await prepararSrc();
  const V = await src.cargar("voz.js");
  ok(V.textoParaVoz("¡Hola! 😊 Mira 👇 https://tienda.test/p") === "¡Hola! Mira", "fuera emojis y enlaces", V.textoParaVoz("¡Hola! 😊 Mira 👇 https://tienda.test/p"));
  const largo = "Esta es una frase bastante larga para una nota de voz. ".repeat(12);
  ok(V.textoParaVoz(largo).length <= 350 && /\.$/.test(V.textoParaVoz(largo)), "y como mucho unos 20 segundos, cortando en una frase completa");
  src.limpiar();
}

titulo("si no se puede escuchar, le pide que escriba (nunca se calla)");
{
  const r = await mandarNota({ falla: true });
  ok(r.enviados.some((m) => /no logré escuchar tu nota de voz/.test(m.text || "")), "le pide con amabilidad que lo escriba", JSON.stringify(r.enviados).slice(0, 120));
  ok(r.llamadasIA.length === 0, "y no le inventa una respuesta a un audio que no se escuchó");
}

terminar();
