// MIND 002 ES MIND 002 (6-oct-2026, dueño: "le digo Mind 002 y me manda una
// chola 001 y demás 002; debe mandar solo 002, y 001 bien").
//
// En la carpeta de Drive hay una sola carpeta "Nike Mind 002" y, dentro,
// también cholas Mind 001. El nombre de la carpeta dice 002 para todas; lo
// que las separa es la FOTO: al indexar, la IA dice "Mind 001" (chola) o
// "Mind 002" (zapato), y eso manda sobre la carpeta.

import { prepararSrc, baseDeMentira, ok, titulo, terminar } from "./ayuda.mjs";
import crypto from "node:crypto";

const src = await prepararSrc();
const D = await src.cargar("drive.js");
const S = await src.cargar("shopify.js");
const I = await src.cargar("indice.js");
const { default: worker } = await src.cargar("index.js");

const RAIZ = "14lvw1gxxkZSMEdtZbvJ_fIuaCcCcZykA";
const carpeta = (id, name) => ({ id, name, mimeType: "application/vnd.google-apps.folder" });
const foto = (id, name) => ({ id, name, mimeType: "image/jpeg" });
const ARCHIVOS = {
  [RAIZ]: [carpeta("cal", "CALZADOS")],
  cal: [carpeta("nike", "NIKE")],
  nike: [carpeta("mind", "Nike Mind 002"), carpeta("am90", "AIRMAX 90")],
  mind: [foto("z1", "IMG 6001 Ref.80.jpg"), foto("z2", "IMG 6002 Ref.80.jpg"), foto("c1", "IMG 6003 Ref.40.jpg"), foto("n1", "IMG 6004 Ref.80.jpg")],
  am90: [foto("a1", "IMG 7001 Ref.60.jpg"), foto("a2", "IMG 7002 Ref.60.jpg")],
};
const url = (id) => `https://lh3.googleusercontent.com/d/${id}=w1000`;
function driveDeMentira(u) {
  const padre = new URL(String(u)).searchParams.get("q")?.match(/'([^']+)' in parents/)?.[1];
  return new Response(JSON.stringify({ files: ARCHIVOS[padre] || [] }), { status: 200 });
}
const BASE = baseDeMentira();
// Lo que la IA vio al indexar: dos zapatos, una chola, uno sin mirar todavía
// (modelo NULL), y en AIRMAX 90 una foto que en realidad es una 97.
await I.guardarIndexados(BASE.DB, [
  { imagen: url("z1"), titulo: "IMG 6001", rasgos: {}, visto: "zapato cerrado", color: "negro", modelo: "Mind 002" },
  { imagen: url("z2"), titulo: "IMG 6002", rasgos: {}, visto: "zapato cerrado", color: "blanco", modelo: "Nike Mind 002" },
  { imagen: url("c1"), titulo: "IMG 6003", rasgos: {}, visto: "chola, pie destapado", color: "negro", modelo: "Mind 001" },
  { imagen: url("a1"), titulo: "IMG 7001", rasgos: {}, visto: "", color: "", modelo: "Air Max 90" },
  { imagen: url("a2"), titulo: "IMG 7002", rasgos: {}, visto: "", color: "", modelo: "Air Max 97" },
]);
const env = { CATALOGO: "drive", DRIVE_CARPETA: `https://drive.google.com/drive/folders/${RAIZ}`, DRIVE_API_KEY: "x", DB: BASE.DB };
async function conDrive(fn) {
  const real = globalThis.fetch, log = console.log, err = console.error;
  globalThis.fetch = async (u) => driveDeMentira(String(u?.url || u));
  console.log = () => {}; console.error = () => {};
  D.olvidarCatalogoDeDrive();
  try { return await fn(); } finally { globalThis.fetch = real; console.log = log; console.error = err; }
}
const fotos = (r) => r.productos.map((p) => p.imagen.match(/d\/(\w+)=/)[1]).sort().join(",");

titulo("la búsqueda: la foto manda sobre la carpeta");
{
  const r2 = await conDrive(() => S.buscarProductos(env, "Mind 002", 10));
  ok(fotos(r2) === "n1,z1,z2", '"Mind 002" → los zapatos (y el que no se ha mirado), NUNCA la chola', fotos(r2));
  const r1 = await conDrive(() => S.buscarProductos(env, "Mind 001", 10));
  ok(fotos(r1) === "c1", '"Mind 001" → solo la chola (la encuentra el índice, aunque la carpeta diga 002)', fotos(r1));
  const todas = await conDrive(() => S.buscarProductos(env, "Mind", 10));
  ok(fotos(todas) === "c1,n1,z1,z2", '"Mind" a secas → todas (ahí sí, y la IA pregunta chola o zapato)', fotos(todas));
  const am = await conDrive(() => S.buscarProductos(env, "Air Max 90", 10));
  ok(fotos(am) === "a1", '"Air Max 90" → no la foto que la IA vio como 97, aunque esté en la carpeta AIRMAX 90', fotos(am));
}

// ── De punta a punta ──────────────────────────────────────────────────
const SECRETO = "secreto-de-prueba";
const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
let cliente = 900;
async function escribe(texto, ia) {
  const igsid = String(++cliente);
  const enviados = [];
  const responder = (u, op) => {
    if (u.startsWith("https://www.googleapis.com/")) return driveDeMentira(u);
    if (u.startsWith("https://api.deepseek.com/")) return json({ choices: [{ message: { content: JSON.stringify({ pienso: "x", respuesta: "¡Claro! 👟", historial: "Ya di la bienvenida.", categoria: "calzado", ...ia }) }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    if (u.includes("graph.instagram.com") && u.includes("/messages")) { enviados.push(JSON.parse(op.body).message); return json({ message_id: `mid-${Math.random()}` }); }
    if (u.includes("graph.instagram.com")) return json({ name: "Ana", username: "ana" });
    if (u.includes("hooks.slack.com")) return new Response("ok");
    return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { "content-type": "image/jpeg" } });
  };
  const envBot = { ...env, META_APP_SECRET: SECRETO, META_MODO: "todo", IG_TOKEN: "x", DEEPSEEK_API_KEY: "x", SLACK_WEBHOOK: "https://hooks.slack.com/x", URL_CATALOGO: "https://drive.test", COTEJO_BARRIDO: "no", REVISOR_IA: "no" };
  const cuerpo = JSON.stringify({ object: "instagram", entry: [{ id: "999", time: Date.now(), messaging: [{ sender: { id: igsid }, recipient: { id: "999" }, timestamp: Date.now(), message: { mid: `m-${Math.random()}`, text: texto } }] }] });
  const firma = "sha256=" + crypto.createHmac("sha256", SECRETO).update(cuerpo).digest("hex");
  const real = globalThis.fetch, log = console.log, err = console.error;
  console.log = () => {}; console.error = () => {};
  D.olvidarCatalogoDeDrive();
  try {
    globalThis.fetch = async (u, op = {}) => responder(String(u?.url || u), op);
    const pendientes = [];
    await worker.fetch(new Request("https://bot.test/webhook", { method: "POST", body: cuerpo, headers: { "x-hub-signature-256": firma } }), envBot, { waitUntil: (p) => pendientes.push(p) });
    await Promise.all(pendientes);
  } finally { globalThis.fetch = real; console.log = log; console.error = err; }
  return enviados.flatMap((m) => m.attachment?.payload?.elements || []).map((e) => e.title);
}

titulo("el cliente escribe 'mind 002'");
{
  const f = await escribe("tienen las mind 002?", { buscar: "Mind 002" });
  ok(f.length === 3 && !f.includes("IMG 6003"), "le llegan solo Mind 002 (sin la chola)", f.join(" · "));
  const g = await escribe("tienen las mind 002?", { buscar: "Mind" });
  ok(g.length === 3 && !g.includes("IMG 6003"), 'aunque la IA busque "Mind" a secas: el 002 que escribió va a la búsqueda', g.join(" · "));
  const h = await escribe("y las mind 001?", { buscar: "Mind 001" });
  ok(h.length === 1 && h[0] === "IMG 6003", "y 'mind 001' → solo la chola", h.join(" · "));
  const k = await escribe("mind 002 gucci?", { buscar: "Mind 002 Gucci" });
  ok(!k.includes("IMG 6003"), "si no hay exacto, lo más cercano conserva el 002 (nunca la chola)", k.join(" · "));
}

terminar();
