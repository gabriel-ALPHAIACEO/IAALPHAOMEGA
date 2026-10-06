// LAS TALLAS, LEÍDAS DEL NOMBRE (6-oct-2026, pedido del dueño).
//
// "En el nombre sale 36-45: si preguntan talla 46, dice no tenemos; si
// preguntan 38, dice sí tenemos y los detalles te los comunica un asesor. Y
// cuando no hay talla de ese, que muestre uno parecido: 'no tenemos talla de
// ese pero tenemos este que te puede gustar'."
//
// Caso real (5-oct, informe de errores): pidió "talla 33 de niño" y el bot le
// dijo "¡ese sí lo tenemos!" con zapatos de 36-40.

import { prepararSrc, baseDeMentira, ok, titulo, terminar } from "./ayuda.mjs";
import crypto from "node:crypto";

const src = await prepararSrc();
const T = await src.cargar("tallas.js");
const D = await src.cargar("drive.js");
const I = await src.cargar("indice.js");
const { default: worker } = await src.cargar("index.js");

titulo("la talla que pide el cliente");
for (const [texto, esperada] of [
  ["tienen talla 46?", 46],
  ["Talla 33 de niño", 33],
  ["Pero talla 33", 33],
  ["y en 38?", 38],
  ["calzo 42", 42],
  ["número 40 tienes?", 40],
  ["talla 38.5", 38.5],
  ["precio de los Retro 4", null],
  ["cuánto cuestan los jordan 40?", null],
  ["Q precio los tienes amiga", null],
  ["qué tallas tienen?", null],
  ["tienes 2 pares en 45$?", null],
]) {
  ok(T.tallaPedida(texto) === esperada, `"${texto}" → ${esperada ?? "ninguna"}`, String(T.tallaPedida(texto)));
}

titulo("el rango de tallas del nombre de la foto (tal como los escribe el dueño)");
for (const [nombre, desde, hasta] of [
  ["A3-2 / 40-45 /", 40, 45],
  ["329/ 44-36 /", 36, 44],
  ["329/36-54/", 36, 45],
  ["K6066 Tallas 36-40", 36, 40],
  ["ADISTAR ( ) TALLAS 36-40 · Cód. 21020", 36, 40],
  ["3057 / / tallas 40-45 · Cód. 60", 40, 45],
  ["Niño 26 al 35", 26, 35],
]) {
  const r = T.rangoDeTallas(nombre);
  ok(r?.desde === desde && r?.hasta === hasta, `"${nombre}" → ${desde}-${hasta}`, JSON.stringify(r));
}
for (const nombre of ["A3-1", "IMG 3212", "IMG-20260630-WA0192", "20260702 131111", "Nike Air Force One blanco 45$", "Jordan 4 Retro"]) {
  ok(T.rangoDeTallas(nombre) === null, `"${nombre}" → no dice tallas`);
}
ok(T.traeLaTalla("A3-2 / 40-45 /", 46) === false && T.traeLaTalla("A3-2 / 40-45 /", 40) === true && T.traeLaTalla("IMG 3212", 40) === null, "trae / no trae / no se sabe");

// ── De punta a punta, con una carpeta de Drive de mentira ──────────────
const RAIZ = "14lvw1gxxkZSMEdtZbvJ_fIuaCcCcZykA";
const carpeta = (id, name) => ({ id, name, mimeType: "application/vnd.google-apps.folder" });
const foto = (id, name) => ({ id, name, mimeType: "image/jpeg" });
const ARCHIVOS = {
  [RAIZ]: [carpeta("cal", "CALZADOS"), carpeta("bol", "BOLSOS")],
  cal: [
    foto("r3", "Retro 3 negro 36-45 60$.jpg"),
    foto("af", "Air Force One blanco 36-40 45$.jpg"),
    foto("dk", "Dunk Low panda 40-46 50$.jpg"),
    foto("tn", "TN Plus negro 40-46 55$.jpg"),
    foto("ni", "Nike niño 26-35 30$.jpg"),
    foto("im", "IMG 3212 50$.jpg"),
  ],
  bol: [foto("bo", "Bolso Nike 40-46 25$.jpg")],
};
const url = (id) => `https://lh3.googleusercontent.com/d/${id}=w1000`;
function driveDeMentira(u) {
  const padre = new URL(u).searchParams.get("q")?.match(/'([^']+)' in parents/)?.[1];
  return new Response(JSON.stringify({ files: ARCHIVOS[padre] || [] }), { status: 200 });
}

const SECRETO = "secreto-de-prueba";
const RASGOS = (o = {}) => Object.fromEntries(["camaraAireTalon", "camaraAireCompleta", "suelaTransparente", "suelaRedondeadaSinAire", "suelaPlanaPlacaDura", "muescaLateralArco", "suelaNubesHuecas", "mallaPlasticaCuadros", "alasPlasticasCordones", "jumpman", "swooshGrandeRecto", "piezaMetalicaOjal", "tresFranjas", "punteraGamuzaT", "punteraGomaConcha"].map((k) => [k, Boolean(o[k])]));
const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
const BASE = baseDeMentira();

// El índice: el Air Force (36-40) se parece al Dunk (swoosh, suela plana),
// no al TN (cámara de aire). El parecido que se ofrece tiene que ser el Dunk.
await I.guardarIndexados(BASE.DB, [
  { imagen: url("af"), titulo: "Air Force One blanco 36-40", rasgos: RASGOS({ swooshGrandeRecto: true, piezaMetalicaOjal: true }), visto: "swoosh grande, suela blanca plana, cuero", color: "blanco", modelo: "Air Force One" },
  { imagen: url("dk"), titulo: "Dunk Low panda 40-46", rasgos: RASGOS({ swooshGrandeRecto: true }), visto: "swoosh grande, suela plana, cuero blanco y negro", color: "blanco", modelo: "Dunk" },
  { imagen: url("tn"), titulo: "TN Plus negro 40-46", rasgos: RASGOS({ camaraAireTalon: true, camaraAireCompleta: true }), visto: "cámara de aire visible, malla", color: "negro", modelo: "TN" },
]);

let avisos = 0;
async function escribe(igsid, texto, ia) {
  const enviados = [];
  const responder = (u, op) => {
    if (u.startsWith("https://www.googleapis.com/")) return driveDeMentira(u);
    if (u.startsWith("https://api.deepseek.com/")) {
      return json({ choices: [{ message: { content: JSON.stringify({ pienso: "x", respuesta: "¡Claro! 👟", historial: "x", categoria: "calzado", ...ia }) }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    }
    if (u.includes("graph.instagram.com") && u.includes("/messages")) {
      enviados.push(JSON.parse(op.body).message);
      return json({ message_id: `mid-${Math.random()}` });
    }
    if (u.includes("graph.instagram.com")) return json({ name: "Ana", username: "ana" });
    if (u.includes("hooks.slack.com")) { avisos++; return new Response("ok"); }
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
  const fichas = enviados.flatMap((m) => m.attachment?.payload?.elements || []).map((e) => e.title);
  const textos = enviados.map((m) => m.text).filter(Boolean);
  return { fichas, textos, registro };
}

titulo("talla DENTRO del rango: 'sí tenemos, los detalles te los comunica un asesor'");
{
  const antes = avisos;
  const r = await escribe("501", "tienen el retro 3 en talla 38?", { buscar: "Retro 3" });
  ok(r.textos.some((t) => /Sí tenemos talla 38/.test(t) && /asesor/.test(t)), "dice que sí y que los detalles los da un asesor", r.textos.join(" | "));
  ok(r.fichas.length === 1 && /Retro 3/.test(r.fichas[0]), "con la ficha del Retro 3", r.fichas.join(" · "));
  ok(avisos > antes, "y avisa al asesor");
}

titulo("talla FUERA del rango: 'de ese no tenemos, pero tenemos este que te puede gustar'");
{
  const antes = avisos;
  await escribe("502", "tienen air force?", { buscar: "Air Force One" });
  const r = await escribe("502", "y en talla 46?", { buscar: "NADA" });
  ok(r.textos.some((t) => /De ese no tenemos talla 46/.test(t) && /tenemos este que te puede gustar/.test(t)), "dice que de ese no hay y ofrece otro", r.textos.join(" | "));
  ok(r.fichas.length === 1 && /Dunk/.test(r.fichas[0]), "le enseña UNO: el Dunk (se parece al Air Force), no el TN", r.fichas.join(" · "));
  ok(r.fichas.every((t) => /40-46/.test(t)), "todos los que ofrece traen la 46", r.fichas.join(" · "));
  ok(!r.fichas.some((t) => /Bolso/.test(t)), "y ninguno es de otra categoría (el bolso 40-46 no sale)");
  ok(!r.fichas.some((t) => /Air Force/.test(t)), "ni le repite el que no la trae");
  ok(!r.registro.some((l) => /PREGUNTO POR TALLAS/.test(l)), "no se le pasa al asesor por la talla: ya se le contestó", r.registro.filter((l) => /Slack/.test(l)).join(" | "));
}

titulo("el caso real: talla 33 de niño con zapatos de 36-40");
{
  await escribe("503", "tienen air force?", { buscar: "Air Force One" });
  const r = await escribe("503", "Talla 33 de niño", { buscar: "NADA" });
  ok(!r.textos.some((t) => /ese (sí|mismo) lo (tenemos|manejamos)/i.test(t)), "ya no dice '¡ese sí lo tenemos!'", r.textos.join(" | "));
  ok(r.textos.some((t) => /no tenemos talla 33/.test(t)), "dice que de ese no hay talla 33", r.textos.join(" | "));
  ok(r.fichas.length === 1 && /niño 26-35/.test(r.fichas[0]), "y le ofrece el de niño que sí la trae", r.fichas.join(" · "));
}

titulo("si el nombre no dice tallas, como antes: lo confirma un asesor");
{
  await escribe("504", "y ese?", { buscar: "IMG 3212" });
  const r = await escribe("504", "talla 42 tienen?", { buscar: "NADA" });
  ok(r.textos.some((t) => /asesor/.test(t)) && !r.textos.some((t) => /Sí tenemos talla|no tenemos talla/.test(t)), "no inventa: 'eso te lo confirma un asesor'", r.textos.join(" | "));
}

terminar();
