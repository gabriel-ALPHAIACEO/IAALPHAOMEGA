// DE PUNTA A PUNTA (2-oct-2026): lo que de verdad le llega al cliente, con
// lo portado de Invictus — notas de voz (solo se escuchan), las 3 formas de
// responder, el precio en la ficha, el catálogo y el tono.
//
// Instagram, OpenAI y la hoja de Google son de mentira (se cambia fetch).

import { prepararSrc, baseDeMentira, prompt, fuente, ok, titulo, terminar } from "./ayuda.mjs";
import crypto from "node:crypto";

const SECRETO = "secreto-de-prueba";
const HOJA = [
  { titulo: "IPHONE 15 128GB", precio: "$650", imagen: "https://cdn.test/i15.jpg" },
  { titulo: "IPHONE 15 PRO 256GB", precio: "$900", imagen: "https://cdn.test/i15p.jpg" },
  { titulo: "SAMSUNG GALAXY A55 8/256", precio: "$380", imagen: "https://cdn.test/a55.jpg" },
];

function csvDe(productos) {
  return ["titulo,precio,imagen", ...productos.map((p) => `${p.titulo},${p.precio},${p.imagen}`)].join("\n");
}

export function nuevaSesion() {
  return { db: baseDeMentira().DB };
}

// Un mensaje del cliente, de punta a punta. "modelo" es lo que contesta la
// IA de texto.
async function conversar(texto, { modelo, sesion = nuevaSesion(), audio = false, transcripcion = "", fallaTranscripcion = false, hoja = HOJA } = {}) {
  const src = await prepararSrc();
  const { default: worker } = await src.cargar("index.js");
  const enviados = [], llamadasIA = [], transcripciones = [], habladas = [];
  const falso = async (url, op = {}) => {
    const u = String(url);
    if (u === "https://cdn.test/nota.mp4") {
      return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), { status: 200, headers: { "content-type": "audio/mp4" } });
    }
    if (u.includes("/audio/speech")) {
      habladas.push(op.body);
      return new Response(new Uint8Array([1]), { status: 200 });
    }
    if (u.includes("/audio/transcriptions")) {
      transcripciones.push(op.body);
      if (fallaTranscripcion) return new Response('{"error":{"message":"boom"}}', { status: 500 });
      return new Response(JSON.stringify({ text: transcripcion }), { status: 200 });
    }
    if (u.includes("api.openai.com")) {
      const cuerpo = JSON.parse(op.body);
      llamadasIA.push(cuerpo);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(modelo) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
    }
    if (u.includes("graph.instagram.com") && u.includes("/messages")) {
      enviados.push(JSON.parse(op.body).message);
      return new Response(JSON.stringify({ message_id: `mid-${Math.random()}` }), { status: 200 });
    }
    if (u.includes("graph.instagram.com")) return new Response(JSON.stringify({ name: "Ana", username: "ana" }), { status: 200 });
    if (u.includes("docs.google.com")) return new Response(csvDe(hoja), { status: 200, headers: { "content-type": "text/csv" } });
    if (u.includes("hooks.slack.com")) return new Response("ok", { status: 200 });
    return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { "content-type": "image/jpeg" } });
  };
  const env = {
    DB: sesion.db, META_APP_SECRET: SECRETO, META_MODO: "todo", IG_TOKEN: "x", OPENAI_API_KEY: "x",
    SHEET_ID: "hoja-de-prueba", URL_CATALOGO: "https://tienda.test", SLACK_WEBHOOK: "https://hooks.slack.com/x",
  };
  const mensaje = audio
    ? { mid: `m-${Math.random()}`, attachments: [{ type: "audio", payload: { url: "https://cdn.test/nota.mp4" } }] }
    : { mid: `m-${Math.random()}`, text: texto };
  const cuerpo = JSON.stringify({ object: "instagram", entry: [{ id: "999", time: Date.now(), messaging: [{ sender: { id: "123" }, recipient: { id: "999" }, timestamp: Date.now(), message: mensaje }] }] });
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
  src.limpiar();
  const textos = enviados.map((m) => m.text || m.attachment?.payload?.text || "").filter(Boolean);
  const carrusel = enviados.filter((m) => m.attachment?.payload?.template_type === "generic").length;
  const boton = enviados.filter((m) => m.attachment?.payload?.template_type === "button").length;
  const audioEnviado = enviados.some((m) => m.attachment?.type === "audio");
  return { enviados, textos, carrusel, boton, audioEnviado, llamadasIA, transcripciones, habladas, registro: registro.join("\n") };
}

const IA = (extra) => ({ pienso: "x", mostrar: "texto_e_imagenes", respuesta: "¡Claro!", buscar: "NADA", historial: "x", ...extra });

titulo("la IA piensa antes de responder (esquema obligado)");
{
  const r = await conversar("tienen iphone 15?", { modelo: IA({ pienso: "Pide iPhone 15, no lo ha visto.", respuesta: "¡Sí tenemos! Mira 👇", buscar: "iPhone 15", historial: "Pidió iPhone 15. Ya busqué: iPhone 15." }) });
  const esquema = r.llamadasIA[0]?.response_format?.json_schema?.schema;
  ok(esquema && esquema.required.join() === "pienso,mostrar,respuesta,buscar,historial", "'pienso' va PRIMERO y 'mostrar' es obligatorio", JSON.stringify(esquema?.required));
  ok(/La IA pensó: Pide iPhone 15/.test(r.registro), "lo que pensó queda en el registro");
  ok(r.carrusel === 1, "y le llegan las fichas del iPhone 15");
}

titulo("las 3 formas de responder: solo texto, texto con fichas, fichas");
{
  const sesion = nuevaSesion();
  const primero = await conversar("tienen iphone 15?", { sesion, modelo: IA({ respuesta: "¡Sí tenemos! Mira 👇", buscar: "iPhone 15" }) });
  ok(primero.carrusel === 1, "TEXTO Y FICHAS: algo nuevo → texto y fichas");
  const cashea = await conversar("y con cashea cuanto es la inicial? soy level 5", { sesion, modelo: IA({ mostrar: "texto", respuesta: "Con tu nivel 5 la inicial es del 20% 😊", buscar: "iPhone 15" }) });
  ok(cashea.carrusel === 0 && /nivel 5/.test(cashea.textos.join(" ")), "SOLO TEXTO: pregunta de algo que ya vio → no se le repiten las fichas", cashea.textos.join(" | "));
  const otraVez = await conversar("mandamelos otra vez", { sesion, modelo: IA({ mostrar: "imagenes", respuesta: "¡Claro! Aquí los tienes otra vez 👇 Son los iPhone 15 que te mostré hace un momento, con su capacidad y su precio, por si quieres compararlos con calma.", buscar: "iPhone 15" }) });
  ok(otraVez.carrusel === 1 && otraVez.textos[0].length <= 60, "FICHAS: con un texto corto", otraVez.textos[0]);
  ok(otraVez.boton === 0, "'mándamelos otra vez' no es pedir el catálogo");
  const nuevo = await conversar("y samsung?", { modelo: IA({ mostrar: "texto", respuesta: "¡Sí, claro que tengo!", buscar: "Samsung" }) });
  ok(nuevo.carrusel === 1, "marcó 'texto' pero los equipos son NUEVOS para él → las fichas van igual");
}

titulo("el precio ya está en la ficha: no lo pregunta");
{
  const r = await conversar("tienen iphone 15?", { modelo: IA({ respuesta: "¡Sí tenemos iPhone 15! 📱 ¿Quieres saber el precio?", buscar: "iPhone 15" }) });
  ok(r.carrusel === 1 && !/quieres saber el precio/i.test(r.textos.join(" ")), "no le pregunta si quiere saber el precio", r.textos[0]);
  ok(/precios están en cada foto/i.test(r.textos[0]), "le dice que está en cada foto", r.textos[0]);
}

titulo("el catálogo existe");
{
  const r = await conversar("tienen catálogo de samsung y xiaomi?", { modelo: IA({ respuesta: "Lo siento, no tenemos catálogo. ¿Qué modelo buscas?", buscar: "NADA" }) });
  ok(!/no tenemos cat[aá]logo/i.test(r.textos.join(" ")), "la frase que niega el catálogo no sale", r.textos.join(" | "));
  ok(r.boton === 1, "y le llega el botón del catálogo");
}

titulo("el cliente grosero: la IA no le contesta igual");
{
  const r = await conversar("esta mrd no responde", { modelo: IA({ respuesta: "No seas bruto, ya te respondí. ¿Qué equipo buscas?", buscar: "NADA" }) });
  ok(!/bruto|ya te respond/i.test(r.textos.join(" ")) && /Qué equipo buscas/.test(r.textos.join(" ")), "se quita el insulto, queda lo útil", r.textos.join(" | "));
}

titulo("notas de voz: las escucha y contesta POR ESCRITO (nunca con voz)");
{
  const r = await conversar("", { audio: true, transcripcion: "hola tienes el iphone 15", modelo: IA({ respuesta: "¡Sí tenemos iPhone 15! Mira 👇", buscar: "iPhone 15" }) });
  const form = r.transcripciones[0];
  ok(form instanceof FormData && form.get("language") === "es" && /iPhone/.test(String(form.get("prompt"))), "se manda a transcribir, en español y con las marcas de la tienda como pista");
  const alModelo = JSON.stringify(r.llamadasIA[0]?.messages || []);
  ok(/hola tienes el iphone 15/.test(alModelo) && /NOTA DE VOZ/.test(alModelo), "lo que dijo le llega a la IA, y sabe que vino por voz");
  ok(/Sí tenemos iPhone 15/.test(r.textos.join(" ")) && r.carrusel === 1, "le contesta por escrito, con las fichas");
  ok(!r.audioEnviado && r.habladas.length === 0, "y NUNCA manda una nota de voz");
}
{
  const r = await conversar("", { audio: true, fallaTranscripcion: true, modelo: IA({}) });
  ok(/no logré escuchar tu nota de voz/.test(r.textos.join(" ")), "si no se puede escuchar, le pide con amabilidad que escriba", r.textos.join(" | "));
  ok(r.llamadasIA.length === 0, "y no le inventa una respuesta");
}

titulo("lo que NO hay en la hoja no se ofrece (caso real: iPhone por nota de voz)");
{
  const SIN_IPHONE = [
    { titulo: "SAMSUNG GALAXY A55 8/256", precio: "$380", imagen: "https://cdn.test/a55.jpg" },
    { titulo: "Samsung A57 12/512", precio: "$450", imagen: "https://cdn.test/a57.jpg" },
    { titulo: "Redmi A7 pro 4/128", precio: "$120", imagen: "https://cdn.test/a7.jpg" },
    { titulo: "Forro iPhone 15", precio: "$10", imagen: "https://cdn.test/forro.jpg" },
  ];
  const r = await conversar("", { hoja: SIN_IPHONE, audio: true, transcripcion: "hola tienes el iphone 15 pro max", modelo: IA({ respuesta: "¡Hola! Soy la asistente virtual de EPICELL 👋 ¡Sí tenemos iPhone 15 Pro Max! 📱", buscar: "NADA" }) });
  const alModelo = JSON.stringify(r.llamadasIA[0]?.messages || []);
  ok(/NO HAY NINGÚN equipo de: iPhone/.test(alModelo), "la IA recibe, contado con TODA la hoja, que no hay ningún iPhone");
  ok(/MARCAS DE TELÉFONO QUE HAY HOY[^"]*Samsung \(2\)/.test(alModelo), "y qué marcas sí hay", alModelo.match(/MARCAS DE TEL[^\\]*/)?.[0]);
  ok(/De iPhone hay SOLO accesorios/.test(alModelo), "un forro de iPhone no cuenta como iPhone");
  const dicho = r.textos.join(" | ");
  ok(!/Sí tenemos iPhone/i.test(dicho) && /no tengo iPhone/.test(dicho) && /Samsung/.test(dicho), "si igual dice que hay, se corrige: no hay iPhone, pero hay Samsung", dicho);

  const s = await conversar("tienes iphone 15?", { hoja: SIN_IPHONE, modelo: IA({ respuesta: "Déjame revisar los iPhone 15 📱", buscar: "iPhone 15" }) });
  const dicho2 = s.textos.join(" | ");
  ok(/no tengo iPhone/.test(dicho2) && !/asesor/.test(dicho2) && !/revisar/.test(dicho2), "si lo busca y no hay: se le dice claro, sin 'déjame confirmarlo con un asesor'", dicho2);

  const t = await conversar("tienen samsung?", { hoja: SIN_IPHONE, modelo: IA({ respuesta: "¡Mira los Samsung! 📱", buscar: "Samsung" }) });
  ok(t.carrusel === 1 && !/no tengo/.test(t.textos.join(" ")), "lo que sí hay se enseña normal");
}

titulo("Cashea: 'level 5' es nivel 5");
ok(/\(\?:nivel\|level\|lvl\|niv\|nv\)/.test(fuente("index.js")), "YA_DIJO_SU_NIVEL entiende level / lvl / nv");
ok(/"level", "lvl", "nv" o "niv", es lo mismo que "nivel"/.test(prompt("texto.txt")), "y el prompt lo explica");

terminar();
