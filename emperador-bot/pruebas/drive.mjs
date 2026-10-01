// EL CATÁLOGO DESDE GOOGLE DRIVE: que lea bien cada foto y que el resto del
// bot la use igual que si viniera de Shopify.
//
// La API de Google Drive es de mentira (se cambia fetch): aquí no hay clave
// ni carpeta de verdad. Lo que se prueba es lo nuestro: cómo se lee el
// nombre de cada foto, la búsqueda, las subcarpetas y los errores.

import { prepararSrc, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const D = await src.cargar("drive.js");
const S = await src.cargar("shopify.js");

titulo("leer el nombre de la foto: título, código y precio");

for (const [nombre, titulo_, codigo, precio] of [
  ["Nike Air Force One blanco COD 125 45$.jpg", "Nike Air Force One blanco", "125", "45 USD"],
  ["AIR MAX 90 - Cód: AM90 - $55.png", "AIR MAX 90", "AM90", "55 USD"],
  ["Jordan 4 negro #J4N 60 USD.jpeg", "Jordan 4 negro", "J4N", "60 USD"],
  ["Campus gris_precio 40.jpeg", "Campus gris", "", "40 USD"],
  ["Samba blanca ref S12 35,50$", "Samba blanca", "S12", "35.5 USD"],
  ["New Balance 9060.jpg", "New Balance 9060", "", ""],
]) {
  const r = D.leerNombre(nombre);
  ok(r.titulo === titulo_ && r.codigo === codigo && r.precio === precio,
     `"${nombre}"`, `${r.titulo} | ${r.codigo || "-"} | ${r.precio || "sin precio"}`);
}
ok(D.leerNombre("New Balance 9060.jpg").titulo.includes("9060"), "el número del MODELO no se confunde con el precio");

titulo("el id de la carpeta, del enlace tal cual se copia");
ok(D.idDeCarpeta("https://drive.google.com/drive/folders/14lvw1gxxkZSMEdtZbvJ_fIuaCcCcZykA?usp=sharing") === "14lvw1gxxkZSMEdtZbvJ_fIuaCcCcZykA",
   "del enlace de 'Compartir' saca el id");
ok(D.idDeCarpeta("PENDIENTE: el enlace") === "", "con el texto de ejemplo, nada");

// ── Una carpeta de mentira, con una subcarpeta ────────────────────────
const RAIZ = "14lvw1gxxkZSMEdtZbvJ_fIuaCcCcZykA";
const ARCHIVOS = {
  [RAIZ]: [
    { id: "f1", name: "Air Force One blanco COD 125 45$.jpg", mimeType: "image/jpeg" },
    { id: "f2", name: "Retro 4 negro #R4N 60$.jpg", mimeType: "image/jpeg" },
    { id: "f3", name: "lista de precios.pdf", mimeType: "application/pdf" },
    { id: "sub", name: "Adidas", mimeType: "application/vnd.google-apps.folder" },
  ],
  sub: [
    { id: "f4", name: "Campus gris COD C1.jpg", mimeType: "image/jpeg", description: "Campus gris COD C1 precio 40" },
  ],
};
let pedidas = 0;
function driveDeMentira(error = "") {
  return async (url) => {
    const u = new URL(String(url));
    if (u.hostname !== "www.googleapis.com") return new Response("", { status: 404 });
    pedidas++;
    if (error) return new Response(error, { status: 403 });
    const carpeta = u.searchParams.get("q").match(/'([^']+)' in parents/)[1];
    return new Response(JSON.stringify({ files: ARCHIVOS[carpeta] || [] }), { status: 200 });
  };
}
const env = { CATALOGO: "drive", DRIVE_CARPETA: `https://drive.google.com/drive/folders/${RAIZ}?usp=sharing`, DRIVE_API_KEY: "x" };

async function conDrive(fn, error = "") {
  const real = globalThis.fetch, log = console.log, err = console.error;
  globalThis.fetch = driveDeMentira(error);
  console.log = () => {}; console.error = () => {};
  D.olvidarCatalogoDeDrive();
  try { return await fn(); } finally { globalThis.fetch = real; console.log = log; console.error = err; }
}

titulo("la carpeta entera, con subcarpetas, como si fuera Shopify");
{
  const { productos } = await conDrive(() => S.traerCatalogoCompleto(env));
  ok(productos.length === 3, "3 productos: las fotos (el PDF no cuenta), también la de la subcarpeta", productos.map((p) => p.titulo).join(" · "));
  const af = productos.find((p) => /Air Force/.test(p.titulo));
  ok(af.titulo === "Air Force One blanco · Cód. 125" && af.precio === "45 USD", "con su código y su precio", `${af.titulo} — ${af.precio}`);
  ok(/^https:\/\/lh3\.googleusercontent\.com\/d\/f1=w1000$/.test(af.imagen), "la foto, servida directa por Google (la puede bajar Instagram)", af.imagen);
  ok(af.url === "https://drive.google.com/file/d/f1/view", "y 'Ver producto' abre la foto en Drive");
  const campus = productos.find((p) => /Campus/.test(p.titulo));
  ok(campus.precio === "40 USD", "la DESCRIPCIÓN manda si trae el precio (el nombre no lo tenía)");
  ok(S.urlPequena(af.imagen).endsWith("=w512"), "para el cotejo se pide pequeña (512)", S.urlPequena(af.imagen));
}

titulo("buscar, igual que en Shopify");
{
  const r1 = await conDrive(() => S.buscarProductos(env, "air force", 10));
  ok(r1.productos.length === 1 && /Air Force/.test(r1.productos[0].titulo), '"air force" → las Air Force');
  const r2 = await conDrive(() => S.buscarProductos(env, "adidas", 10));
  ok(r2.productos.length === 1 && /Campus/.test(r2.productos[0].titulo), '"adidas" → la de la subcarpeta Adidas (aunque el nombre no lo diga)');
  const r3 = await conDrive(() => S.buscarProductos(env, "R4N", 10));
  ok(r3.productos.length === 1, "por el código también encuentra");
  const r4 = await conDrive(() => S.buscarProductos(env, "retro 40", 10));
  ok(r4.productos.length === 0, '"retro 40" no encuentra el Retro 4 (el número es palabra completa)');
  ok(Object.keys(r1.productos[0]).sort().join() === "imagen,precio,titulo,url", "la ficha tiene la misma forma que la de Shopify");
}

titulo("se recuerda unos minutos: no se relee la carpeta en cada mensaje");
{
  pedidas = 0;
  const real = globalThis.fetch;
  globalThis.fetch = driveDeMentira();
  const log = console.log; console.log = () => {};
  D.olvidarCatalogoDeDrive();
  await S.buscarProductos(env, "air", 10);
  const primera = pedidas;
  await S.buscarProductos(env, "retro", 10);
  globalThis.fetch = real; console.log = log;
  ok(primera === 2 && pedidas === 2, "la segunda búsqueda no vuelve a pedir nada a Google", `${pedidas} pedidas`);
}

titulo("los errores, en palabras que se puedan arreglar");
{
  const r = await conDrive(() => D.catalogoDeDrive(env), JSON.stringify({ error: { message: "Google Drive API has not been used in project 123 before or it is disabled.", status: "PERMISSION_DENIED" } }));
  ok(r.productos.length === 0 && /no está activada/.test(r.error) && /Habilitar/.test(r.error), "API de Drive apagada → dice dónde activarla", r.error.slice(0, 80));
  const sinCarpeta = await conDrive(() => D.catalogoDeDrive({ ...env, DRIVE_CARPETA: "PENDIENTE" }));
  ok(/falta DRIVE_CARPETA/.test(sinCarpeta.error), "sin carpeta → lo dice");
  const sinClave = await conDrive(() => D.catalogoDeDrive({ CATALOGO: "drive", DRIVE_CARPETA: RAIZ }));
  ok(/falta la clave/.test(sinClave.error), "sin clave → lo dice");
  const busca = await conDrive(() => S.buscarProductos(env, "air", 10), "boom");
  ok(busca.productos.length === 0, "y si Drive falla, la búsqueda devuelve vacío en vez de romper el bot");
}

titulo("sin CATALOGO = drive, sigue siendo Shopify");
ok(!D.usaDrive({}) && D.usaDrive({ CATALOGO: "drive" }), "solo con CATALOGO = \"drive\"");

src.limpiar();
terminar();
