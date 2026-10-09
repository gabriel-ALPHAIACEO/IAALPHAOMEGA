// LOS MODELOS SON LAS CARPETAS (6-oct-2026).
//
// El dueño ordena las fotos así (capturas del 6-oct):
//   CALZADOS › DEPORTIVOS › ACG, ADIDAS, ASICS, Calzados para futbol, DC
//   SHOES, DIOR, JORDAN, NEW BALANCE, NIKE, ON CLOUD, PUMA, REEBOK, UNDER
//   ARMOUR, VALENTINO, VANS, VELOX
//   … › NIKE › AIR FORCE ONE, AIR MAX PULSE, AIRMAX 90, BAILLELI, BOTA 180,
//   CALZADO P/BEISBOL, CURRY, DN, HYPERDUNK, HYPERSET, INITIATOR, JCB, KOBE
//   BRYANT MANBA, KYRIE IRVING, LEBRON 7, LUCAS, METCOM 6, Nike Mind 002,
//   NIKE RUNNER, NIKE SB, Nike VK, NOCTA, RETRO 1, RUNNER, SHOX (12
//   RESORTES), TIBURON, TN, TN PLUS, TRAIL ATC, V2, V5, ZEGAMA, ZOON GT
// y las fotos se llaman "IMG 3212". "Debe reconocer estos también": por
// texto (la IA ve la lista de carpetas y la búsqueda las mira) y por foto
// (la IA de visión recibe la misma lista).

import { prepararSrc, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const D = await src.cargar("drive.js");
const S = await src.cargar("shopify.js");
const IA = await src.cargar("ia.js");

const RAIZ = "14lvw1gxxkZSMEdtZbvJ_fIuaCcCcZykA";
const MODELOS_NIKE = ["AIR FORCE ONE", "AIR MAX PULSE", "AIRMAX 90", "BAILLELI", "BOTA 180", "CALZADO P/BEISBOL", "CURRY", "DN", "HYPERDUNK", "HYPERSET", "INITIATOR", "JCB", "KOBE BRYANT MANBA", "KYRIE IRVING", "LEBRON 7", "LUCAS", "METCOM 6", "Nike Mind 002", "NIKE RUNNER", "NIKE SB", "Nike VK", "NOCTA", "RETRO 1", "RUNNER", "SHOX (12 RESORTES)", "TIBURON", "TN", "TN PLUS", "TRAIL ATC", "V2", "V5", "ZEGAMA", "ZOON GT"];
const MARCAS = ["ACG", "ADIDAS", "ASICS", "Calzados para futbol", "DC SHOES", "DIOR", "JORDAN", "NEW BALANCE", "ON CLOUD", "PUMA", "REEBOK", "UNDER ARMOUR", "VALENTINO", "VANS", "VELOX"];
const carpeta = (id, name) => ({ id, name, mimeType: "application/vnd.google-apps.folder" });
const foto = (id, name) => ({ id, name, mimeType: "image/jpeg" });
const id = (t) => t.replace(/\W+/g, "_");
const ARCHIVOS = {
  [RAIZ]: [carpeta("lote", "CNTND 1 (30/6/26)")],
  lote: [carpeta("cal", "CALZADOS"), carpeta("gor", "GORRAS")],
  cal: [carpeta("dep", "DEPORTIVOS")],
  dep: [carpeta("NIKE", "NIKE"), ...MARCAS.map((m) => carpeta(id(m), m))],
  NIKE: MODELOS_NIKE.map((m) => carpeta(`n_${id(m)}`, m)),
  gor: [foto("g1", "IMG 9001 15$.jpg")],
};
let n = 0;
for (const m of MODELOS_NIKE) ARCHIVOS[`n_${id(m)}`] = [foto(`f${++n}`, `IMG ${3000 + n} 50$.jpg`), foto(`f${++n}`, `IMG-20260630-WA0${100 + n}.jpg`)];
for (const m of MARCAS) ARCHIVOS[id(m)] = [foto(`f${++n}`, `IMG ${3000 + n} 45$.jpg`)];
ARCHIVOS.ADIDAS.push(foto("ad1", "ADISTAR (COD 21020) TALLAS 36-40 $32.jpg"));

function driveDeMentira(u) {
  const padre = new URL(String(u)).searchParams.get("q")?.match(/'([^']+)' in parents/)?.[1];
  return new Response(JSON.stringify({ files: ARCHIVOS[padre] || [] }), { status: 200 });
}
const env = { CATALOGO: "drive", DRIVE_CARPETA: `https://drive.google.com/drive/folders/${RAIZ}`, DRIVE_API_KEY: "x" };
async function conDrive(fn, responder = driveDeMentira) {
  const real = globalThis.fetch, log = console.log, err = console.error;
  globalThis.fetch = async (u, op) => responder(String(u?.url || u), op);
  console.log = () => {}; console.error = () => {};
  D.olvidarCatalogoDeDrive();
  try { return await fn(); } finally { globalThis.fetch = real; console.log = log; console.error = err; }
}
const cuantos = (r) => r.productos.length;

titulo("la lista de modelos sale de las carpetas");
{
  const modelos = await conDrive(() => D.modelosDeDrive(env));
  const calzado = modelos.find((m) => m.categoria === "CALZADOS");
  ok(calzado && calzado.modelos.length === MODELOS_NIKE.length + MARCAS.length, `${MODELOS_NIKE.length} modelos de Nike + ${MARCAS.length} marcas`, String(calzado?.modelos.length));
  ok(calzado.modelos.some((m) => m.ruta === "DEPORTIVOS › NIKE › AIR FORCE ONE" && m.fotos === 2), "cada uno con su ruta y cuántas fotos tiene (sin la carpeta de lote ni la categoría)");
  const lista = await conDrive(() => D.listaDeModelosParaFotos(env));
  ok(/CALZADOS › DEPORTIVOS › NIKE › SHOX \(12 RESORTES\)/.test(lista) && /CALZADOS › DEPORTIVOS › ON CLOUD/.test(lista), "la lista para la IA de fotos: una línea por modelo");
}

titulo("lo que ve la IA de texto: los modelos, no 'IMG 3212'");
{
  const t = await conDrive(() => D.titulosDeDrive(env));
  ok(/Modelos \(carpetas\):/.test(t) && /DEPORTIVOS › NIKE › KYRIE IRVING \(2 fotos\)/.test(t), "van los modelos de las carpetas", t.slice(0, 200));
  ok(!/IMG \d|WA0\d/.test(t), "y ningún 'IMG 3212' ni 'IMG-…-WA…' (no dicen nada)");
  ok(/ADISTAR/.test(t) && !/ADISTAR.*Cód/.test(t), "los nombres que sí dicen algo siguen (sin el código)");
  for (const nombre of ["IMG 3212", "IMG-20260630-WA0192", "20260702 131111", "329/36-44/ · Cód. 60", "A3-1 / 36-45 /"]) ok(D.nombreQueNoDiceNada(nombre), `"${nombre}" no dice nada`);
  for (const nombre of ["ADISTAR TALLAS 36-40", "Nike Air Force One blanco", "K6066 Tallas 36-40"]) ok(!D.nombreQueNoDiceNada(nombre), `"${nombre}" sí`);
}

titulo("la IA de fotos recibe la misma lista");
{
  let sistema = "";
  const responder = (u, op) => {
    if (u.startsWith("https://www.googleapis.com/")) return driveDeMentira(u);
    sistema = JSON.parse(op.body).messages[0].content;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ tipo: "calzado", visto: "x", rasgos: {}, buscar: "SHOX", color: "negro", variosProductos: false, pedirNombreExacto: false }) }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
  };
  await conDrive(() => IA.identificarEnImagen({ ...env, OPENAI_API_KEY: "x", DEEPSEEK_API_KEY: "x" }, "https://cdn.test/x.jpg"), responder);
  ok(/NIKE › SHOX \(12 RESORTES\)/.test(sistema) && /NIKE › ZOON GT/.test(sistema), "el prompt de visión trae los modelos de las carpetas", sistema.match(/.*SHOX.*/)?.[0] || "(no está)");
  ok(!/Todavía no está cargada la lista de modelos/.test(sistema), "ya no va 'sin lista de modelos'");
}

titulo("se encuentra cada modelo, como lo escribe el cliente (o la IA)");
for (const [busca, esperados, porque] of [
  ["Air Force One", 2, "AIR FORCE ONE"],
  ["af1", 2, "AIR FORCE ONE"],
  ["Air Max 90", 2, '"AIRMAX 90" (junto)'],
  ["Air Max Pulse", 2, "AIR MAX PULSE"],
  ["Metcon", 2, '"METCOM 6" (con m)'],
  ["Zoom GT", 2, '"ZOON GT" (con n)'],
  ["Dunk", 4, "los Dunk están en NIKE SB (y el HYPERDUNK, que también lo dice)"],
  ["Shox", 2, "SHOX (12 RESORTES)"],
  ["Kyrie", 2, "KYRIE IRVING"],
  ["Irving", 2, "KYRIE IRVING"],
  ["Kobe", 2, "KOBE BRYANT MANBA"],
  ["Lebron", 2, "LEBRON 7"],
  ["Mind 002", 2, "Nike Mind 002"],
  ["Nocta", 2, "NOCTA"],
  ["Curry", 2, "CURRY"],
  ["Jordan", 3, "la marca JORDAN y los RETRO 1 (son Jordan 1)"],
  ["On Cloud", 1, "ON CLOUD"],
  ["New Balance", 1, "NEW BALANCE"],
  ["Velox", 1, "VELOX"],
  ["tacos", 1, "Calzados para futbol"],
  ["beisbol", 2, "CALZADO P/BEISBOL"],
  ["Adidas", 2, "ADIDAS (con el Adistar)"],
]) {
  const r = await conDrive(() => S.buscarProductos(env, busca, 10, { categoria: "calzado" }));
  ok(cuantos(r) === esperados, `"${busca}" → ${porque}`, `${cuantos(r)} fotos`);
}
{
  const tn = await conDrive(() => S.buscarProductos(env, "TN", 10, { categoria: "calzado" }));
  ok(cuantos(tn) === 4, '"TN" → TN y TN PLUS', `${cuantos(tn)} fotos`);
  const nike = await conDrive(() => S.buscarProductos(env, "Nike", 100, { categoria: "calzado" }));
  ok(cuantos(nike) === MODELOS_NIKE.length * 2, '"Nike" → todo lo de la carpeta NIKE', `${cuantos(nike)} fotos`);
}

terminar();
