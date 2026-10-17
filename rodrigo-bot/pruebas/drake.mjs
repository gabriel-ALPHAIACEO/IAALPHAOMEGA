// LOS DRAKE SON LOS AF1, Y LAS FOTOS QUE SE LLAMAN "IMG 3212" (6-oct-2026).
//
// QUÉ SE PROTEGE. El 5-oct cinco clientes pidieron "los AF1 Drake" y el bot
// contestó "ese justo no me queda" con diez calzados cualquiera. Dos causas:
//   1. "AF1", "Air Force 1" y "Air Force One" no se encontraban entre sí, y
//      nadie le había dicho que "los Drake" son AF1.
//   2. En la carpeta de Drive casi ninguna foto dice el modelo en el nombre
//      ("IMG 3212", "329/36-44"): la búsqueda por texto no las veía. El
//      modelo lo había dicho la IA al indexar, y se tiraba.
// Y el mensaje vacío que llega pegado al de un anuncio (doble respuesta).

import { prepararSrc, baseDeMentira, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const D = await src.cargar("drive.js");
const S = await src.cargar("shopify.js");
const I = await src.cargar("indice.js");
const C = await src.cargar("catalogo.js");

const RAIZ = "14lvw1gxxkZSMEdtZbvJ_fIuaCcCcZykA";
const ARCHIVOS = {
  [RAIZ]: [{ id: "cal", name: "CALZADOS", mimeType: "application/vnd.google-apps.folder" }],
  cal: [
    { id: "a1", name: "Nike AF1 blanco 45$.jpg", mimeType: "image/jpeg" },
    { id: "a2", name: "Air Force 1 negro 50$.jpg", mimeType: "image/jpeg" },
    { id: "i1", name: "IMG 3212.jpg", mimeType: "image/jpeg" },
    { id: "i2", name: "IMG 3213 60$.jpg", mimeType: "image/jpeg" },
    { id: "i3", name: "IMG 3214.jpg", mimeType: "image/jpeg" },
    { id: "cab", name: "CABALLERO", mimeType: "application/vnd.google-apps.folder" },
  ],
  cab: [{ id: "i4", name: "IMG 4001 55$.jpg", mimeType: "image/jpeg" }],
};
const foto = (id) => `https://lh3.googleusercontent.com/d/${id}=w1000`;
const driveDeMentira = async (url) => {
  const u = new URL(String(url));
  if (u.hostname !== "www.googleapis.com") return new Response("", { status: 404 });
  const carpeta = u.searchParams.get("q").match(/'([^']+)' in parents/)[1];
  return new Response(JSON.stringify({ files: ARCHIVOS[carpeta] || [] }), { status: 200 });
};
const { DB } = baseDeMentira();
const env = { CATALOGO: "drive", DRIVE_CARPETA: `https://drive.google.com/drive/folders/${RAIZ}`, DRIVE_API_KEY: "x", DB };

async function conDrive(fn) {
  const real = globalThis.fetch, log = console.log, err = console.error;
  globalThis.fetch = driveDeMentira;
  console.log = () => {}; console.error = () => {};
  D.olvidarCatalogoDeDrive();
  try { return await fn(); } finally { globalThis.fetch = real; console.log = log; console.error = err; }
}
const titulos = (r) => r.productos.map((p) => p.titulo).join(" · ");

titulo("AF1, Air Force 1, Air Force One: el mismo zapato");
{
  for (const t of ["Air Force One", "air force 1", "AF1", "af 1", "airforce", "af01"]) {
    const r = await conDrive(() => S.buscarProductos(env, t, 10));
    ok(r.productos.length === 2, `"${t}" encuentra las dos AF1 (una se llama "AF1", la otra "Air Force 1")`, titulos(r));
  }
  ok(D.modelosEnUnaPalabra("nike air force one blanco") === "nike af1 blanco", "se vuelven una sola palabra");
  ok(D.modelosEnUnaPalabra("jordan 4 retro") === "jordan 4 retro", "y no toca otros modelos");
  ok(D.modelosEnUnaPalabra("air max 90") === "airmax 90", '"Air Max 90" = la carpeta "AIRMAX 90"');
}

titulo("las fotos que se llaman 'IMG 3212' se encuentran por el índice");
{
  await I.guardarIndexados(DB, [
    { imagen: foto("i1"), titulo: "IMG 3212", visto: "swoosh, suela blanca", rasgos: {}, color: "blanco", modelo: "Air Force One Drake" },
    { imagen: foto("i2"), titulo: "IMG 3213", visto: "jumpman, alas", rasgos: {}, color: "negro", modelo: "Retro 3" },
    { imagen: foto("i3"), titulo: "IMG 3214", visto: "", rasgos: {}, color: "", modelo: "" },
    { imagen: foto("i4"), titulo: "IMG 4001", visto: "", rasgos: {}, color: "", modelo: "Retro 3" },
  ]);
  const r3 = await conDrive(() => S.buscarProductos(env, "Retro 3", 10));
  ok(r3.productos.length === 2 && r3.productos[0].imagen === foto("i2") && r3.productos[0].precio === "$60", '"Retro 3" encuentra las fotos "IMG 3213" e "IMG 4001" (lo dijo el índice), con su precio', titulos(r3));
  const j3 = await conDrive(() => S.buscarProductos(env, "jordan 3", 10));
  ok(j3.productos.length === 2, '"jordan 3" también (jordan = retro)', titulos(j3));
  const cab = await conDrive(() => S.buscarProductos(env, "Retro 3 caballero", 10));
  ok(cab.productos.length === 1 && cab.productos[0].imagen === foto("i4"), '"Retro 3 caballero": el modelo del índice + la carpeta CABALLERO', titulos(cab));
  const drake = await conDrive(() => S.buscarProductos(env, "Air Force One Drake", 10));
  ok(drake.productos.length === 1 && drake.productos[0].imagen === foto("i1"), '"Air Force One Drake" → la foto que el índice reconoció como Drake', titulos(drake));
  const af1 = await conDrive(() => S.buscarProductos(env, "AF1", 10));
  ok(af1.productos.length === 3 && af1.productos[2].imagen === foto("i1"), "y en \"AF1\" sale también, después de las que lo dicen en el nombre", titulos(af1));
  const idx = await I.leerIndice(DB);
  ok(idx.find((p) => p.imagen === foto("i3"))?.modelo === "", "la que no reconoció queda con modelo vacío (no se vuelve a mirar)");
}

titulo("si ninguna foto dice Drake, se enseñan las AF1 (no 'ese no me queda')");
{
  await DB.prepare("UPDATE catalogo SET modelo = 'Air Force One' WHERE imagen = ?").bind(foto("i1")).run();
  const r = await conDrive(() => S.buscarProductos(env, "Air Force One Drake", 10));
  ok(r.productos.length === 3, '"Air Force One Drake" sin ninguna Drake → las 3 AF1', titulos(r));
  const nada = await conDrive(() => S.buscarProductos(env, "Retro 11", 10));
  ok(nada.productos.length === 0, "lo que no existe sigue sin existir (no se inventa)");
}

titulo("un índice viejo, sin la columna modelo, se pone al día solo");
{
  const { DB: vieja, sql } = baseDeMentira();
  sql.exec("CREATE TABLE catalogo (imagen TEXT PRIMARY KEY, titulo TEXT, precio TEXT, url TEXT, visto TEXT, rasgos TEXT, color TEXT, actualizado INTEGER)");
  sql.exec("INSERT INTO catalogo VALUES ('x', 'IMG 1', '', '', 'algo', '{}', 'blanco', 1)");
  // Un Worker recién desplegado: el módulo no ha mirado la tabla todavía.
  const I2 = await (await prepararSrc()).cargar("indice.js");
  const log = console.log; console.log = () => {};
  const filas = await I2.leerIndice(vieja);
  console.log = log;
  ok(filas[0].modelo === null, "las fotos ya indexadas quedan sin modelo (null): el cron las vuelve a mirar", JSON.stringify(filas[0].modelo));
}

titulo("el cliente dice 'drake': se buscan las Air Force One Drake");
{
  const casos = [
    ["Precio de los AF1 Drake", "NADA", "Air Force One Drake", true],
    ["Si de los af1 drake", "Air Force One", "Air Force One Drake", false],
    ["tienen los drake de dama?", "NADA", "Air Force One Drake", true],
    ["los drake", "Nike", "Air Force One Drake", false],
    ["los drake de caballero", "Air Force One caballero", "Air Force One Drake caballero", false],
  ];
  for (const [texto, buscar, espera, cambiaFrase] of casos) {
    const r = C.corregirBusquedaDeApodos(texto, buscar);
    ok(r.corregido && r.buscar === espera && Boolean(r.respuesta) === cambiaFrase, `"${texto}" con buscar "${buscar}" → "${espera}"`, `${r.buscar} | ${r.respuesta || "(frase de la IA)"}`);
  }
  ok(!C.corregirBusquedaDeApodos("precio de los AF1 Drake", "Air Force One Drake").corregido, "si ya busca las Drake, no se toca");
  ok(!C.corregirBusquedaDeApodos("tienen retro 4 y los drake?", "Retro 4").corregido, "si busca otro modelo con nombre (pide dos cosas), no se pisa");
  ok(!C.corregirBusquedaDeApodos("tienen af1 blancas?", "NADA").corregido, "sin 'drake', nada que hacer");
}

terminar();
