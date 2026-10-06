// LO MÁS CERCANO, NO DIEZ CUALQUIERA · Y EL PRECIO QUE LA FICHA NO TRAE
// (6-oct-2026, puntos 2 y 3 de las mejoras de El Emperador).
//
// Del informe de errores del 5 y 6 de octubre:
//   · "Las negras me interesan" (Retro 4) → "De ese no tengo ahora mismo 😕
//     Pero mira estos calzados" con diez cualquiera.
//   · "Cuánto cuesta" (Air Max Plus) → "Ese justo no me queda" + diez
//     cualquiera.
//   · "Aquí las tienes con sus precios 👇" con fichas sin precio.

import { prepararSrc, baseDeMentira, ok, titulo, terminar } from "./ayuda.mjs";
import crypto from "node:crypto";

const src = await prepararSrc();
const D = await src.cargar("drive.js");
const { default: worker } = await src.cargar("index.js");

const RAIZ = "14lvw1gxxkZSMEdtZbvJ_fIuaCcCcZykA";
const carpeta = (id, name) => ({ id, name, mimeType: "application/vnd.google-apps.folder" });
const foto = (id, name) => ({ id, name, mimeType: "image/jpeg" });
// Muchos calzados (más de 10, como la tienda de verdad) para que "diez
// cualquiera" se note.
const RELLENO = Array.from({ length: 15 }, (_, i) => foto(`r${i}`, `IMG ${5000 + i} Ref.40.jpg`));
const ARCHIVOS = {
  [RAIZ]: [carpeta("cal", "CALZADOS"), carpeta("bol", "BOLSOS")],
  cal: [carpeta("dep", "DEPORTIVOS")],
  dep: [carpeta("nike", "NIKE"), carpeta("jor", "JORDAN"), carpeta("var", "VARIOS")],
  nike: [carpeta("noc", "NOCTA"), carpeta("tn", "TN")],
  noc: [foto("n1", "IMG 3001 Ref.70.jpg"), foto("n2", "IMG 3002 Ref.70.jpg")],
  tn: [foto("t1", "IMG 3101 negro Ref.55.jpg")],
  jor: [carpeta("r4", "RETRO 4"), carpeta("r3", "RETRO 3")],
  r4: [foto("j1", "Retro 4 blanco Ref.60.jpg"), foto("j2", "Retro 4 gris Ref.60.jpg")],
  r3: [foto("k1", "IMG 4001.jpg"), foto("k2", "IMG 4002 Ref.60.jpg")],
  var: RELLENO,
  bol: [foto("b1", "Bolso Nike Heritage Ref.25.jpg")],
};
function driveDeMentira(u) {
  const padre = new URL(u).searchParams.get("q")?.match(/'([^']+)' in parents/)?.[1];
  return new Response(JSON.stringify({ files: ARCHIVOS[padre] || [] }), { status: 200 });
}

const SECRETO = "secreto-de-prueba";
const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
const BASE = baseDeMentira();
let cliente = 700;

async function escribe(texto, ia) {
  const igsid = String(++cliente);
  const enviados = [];
  const slack = [];
  const responder = (u, op) => {
    if (u.startsWith("https://www.googleapis.com/")) return driveDeMentira(u);
    if (u.startsWith("https://api.deepseek.com/")) {
      return json({ choices: [{ message: { content: JSON.stringify({ pienso: "x", respuesta: "¡Claro! 👟", historial: "Ya di la bienvenida.", categoria: "calzado", ...ia }) }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    }
    if (u.includes("graph.instagram.com") && u.includes("/messages")) {
      enviados.push(JSON.parse(op.body).message);
      return json({ message_id: `mid-${Math.random()}` });
    }
    if (u.includes("graph.instagram.com")) return json({ name: "Ana", username: "ana" });
    if (u.includes("hooks.slack.com")) { slack.push(JSON.parse(op.body).text); return new Response("ok"); }
    return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { "content-type": "image/jpeg" } });
  };
  const env = {
    CATALOGO: "drive", DRIVE_CARPETA: `https://drive.google.com/drive/folders/${RAIZ}`, DRIVE_API_KEY: "x",
    DB: BASE.DB, META_APP_SECRET: SECRETO, META_MODO: "todo", IG_TOKEN: "x", DEEPSEEK_API_KEY: "x",
    SLACK_WEBHOOK: "https://hooks.slack.com/x", URL_CATALOGO: "https://drive.test", COTEJO_BARRIDO: "no", REVISOR_IA: "no",
  };
  const cuerpo = JSON.stringify({ object: "instagram", entry: [{ id: "999", time: Date.now(), messaging: [{ sender: { id: igsid }, recipient: { id: "999" }, timestamp: Date.now(), message: { mid: `m-${Math.random()}`, text: texto } }] }] });
  const firma = "sha256=" + crypto.createHmac("sha256", SECRETO).update(cuerpo).digest("hex");
  const real = globalThis.fetch, log = console.log, err = console.error;
  const registro = [];
  console.log = (...a) => registro.push(a.join(" "));
  console.error = (...a) => registro.push(a.join(" "));
  D.olvidarCatalogoDeDrive();
  try {
    globalThis.fetch = async (u, op = {}) => responder(String(u?.url || u), op);
    const pendientes = [];
    await worker.fetch(new Request("https://bot.test/webhook", { method: "POST", body: cuerpo, headers: { "x-hub-signature-256": firma } }), env, { waitUntil: (p) => pendientes.push(p) });
    await Promise.all(pendientes);
  } finally {
    globalThis.fetch = real; console.log = log; console.error = err;
  }
  const elementos = enviados.flatMap((m) => m.attachment?.payload?.elements || []);
  return { fichas: elementos.map((e) => e.title), precios: elementos.map((e) => e.subtitle), textos: enviados.map((m) => m.text || m.attachment?.payload?.text).filter(Boolean), slack, registro };
}
const ningunoDeRelleno = (r) => !r.fichas.some((t) => /IMG 50\d\d/.test(t));

titulo("3. el mismo modelo en OTRO color: 'las negras' no hay");
{
  const r = await escribe("Las negras me interesan", { buscar: "Retro 4 negro" });
  ok(r.textos.some((t) => /De ese en negro no tengo ahora/.test(t) && /colores que sí hay/.test(t)), "le dice la verdad: en negro no, pero mira los colores que hay", r.textos.join(" | "));
  ok(r.fichas.length === 2 && r.fichas.every((t) => /Retro 4/.test(t)), "y le enseña los Retro 4 (blanco y gris), no diez cualquiera", r.fichas.join(" · "));
}

titulo("3. el modelo sin la palabra que sobraba");
{
  const r = await escribe("precio de los nike nocta glide", { buscar: "Nike Nocta Glide" });
  ok(r.fichas.length === 2 && ningunoDeRelleno(r), 'no hay "Nike Nocta Glide" → le enseña los Nocta (2), no el relleno', r.fichas.join(" · "));
  ok(r.textos.some((t) => /De ese exacto no tengo ahora/.test(t) && /Nike Nocta|Nocta/.test(t)), "diciéndole que de ese exacto no, pero mira estos Nocta", r.textos.join(" | "));
}

titulo("3. un parecido (Vapormax no hay → TN)");
{
  const r = await escribe("tienen vapormax?", { buscar: "Vapormax" });
  ok(r.fichas.length >= 1 && r.fichas.every((t) => /3101/.test(t)) && ningunoDeRelleno(r), "le ofrece el TN (parecido de verdad)", r.fichas.join(" · "));
  ok(r.textos.some((t) => /parecidos que sí tenemos/.test(t)), "con 'mira estos parecidos'", r.textos.join(" | "));
}

titulo("3. nada parecido: ni diez cualquiera, ni 'no me queda'");
{
  const r = await escribe("tienen gucci rhyton?", { buscar: "Gucci Rhyton" });
  ok(r.fichas.length === 0 || ningunoDeRelleno(r), "no le manda los diez primeros calzados", r.fichas.join(" · "));
  ok(!r.textos.some((t) => /Ese justo no me queda|mira estos calzados/i.test(t)), "ya no sale 'Ese justo no me queda… los calzados que hay'", r.textos.join(" | "));
  ok(r.textos.some((t) => /asesor/.test(t)), "va al asesor y al catálogo, como siempre que se busca y no hay", r.textos.join(" | "));
}

titulo("3. en bolsos (pocos) sigue saliendo lo que hay de la categoría");
{
  const r = await escribe("tienes bolsos gucci?", { buscar: "bolso Gucci", categoria: "bolso" });
  ok(r.fichas.length === 1 && /Heritage/.test(r.fichas[0]), "le enseña el bolso que sí hay", r.fichas.join(" · "));
}

titulo("2. pidió el precio y la ficha no lo trae: no se promete");
{
  const r = await escribe("cuánto cuestan los retro 3?", { buscar: "Retro 3", respuesta: "¡Claro! Aquí las tienes con sus precios 👇" });
  ok(r.fichas.length === 2, "le enseña los dos Retro 3", r.fichas.join(" · "));
  ok(!r.textos.some((t) => /con sus precios/.test(t)), "ya no dice 'aquí las tienes con sus precios'", r.textos.join(" | "));
  ok(r.textos.some((t) => /Los que no traen el precio debajo te los confirma un asesor/.test(t)), "le dice que el que no trae precio se lo confirma un asesor", r.textos.join(" | "));
  ok(r.slack.some((t) => /PIDIO EL PRECIO Y LA FICHA NO LO TRAE/.test(t)), "y el asesor recibe el aviso", r.slack.join(" | ").slice(0, 120));
}
{
  const r = await escribe("cuánto cuesta el TN?", { buscar: "TN", respuesta: "¡Claro! Aquí tienes el precio 👇" });
  ok(r.textos.some((t) => /Aquí tienes el precio/.test(t)) && r.precios.some((p) => p === "$55"), "si la ficha SÍ trae el precio, sale normal ($55)", `${r.textos.join(" | ")} · ${r.precios.join(" ")}`);
  ok(!r.slack.some((t) => /PIDIO EL PRECIO/.test(t)), "y sin aviso");
}

terminar();
