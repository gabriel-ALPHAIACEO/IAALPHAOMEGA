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
  ["Nike Air Force One blanco COD 125 45$.jpg", "Nike Air Force One blanco", "125", "$45"],
  ["AIR MAX 90 - Cód: AM90 - $55.png", "AIR MAX 90", "AM90", "$55"],
  ["Jordan 4 negro #J4N 60 USD.jpeg", "Jordan 4 negro", "J4N", "$60"],
  ["Campus gris_precio 40.jpeg", "Campus gris", "", "$40"],
  ["Samba blanca ref S12 35,50$", "Samba blanca", "S12", "$35.50"],
  ["New Balance 9060.jpg", "New Balance 9060", "", ""],
]) {
  const r = D.leerNombre(nombre);
  ok(r.titulo === titulo_ && r.codigo === codigo && r.precio === precio,
     `"${nombre}"`, `${r.titulo} | ${r.codigo || "-"} | ${r.precio || "sin precio"}`);
}
ok(D.leerNombre("New Balance 9060.jpg").titulo.includes("9060"), "el número del MODELO no se confunde con el precio");

titulo("el número del FINAL es el precio, aunque no lleve $ (5-oct-2026)");
for (const [nombre, titulo_, precio] of [
  ["Nike Air Force 1 blanco 45.jpg", "Nike Air Force 1 blanco", "$45"],
  ["Nike Dunk Low panda 50.jpg", "Nike Dunk Low panda", "$50"],
  ["Jordan 4 negro 60.jpg", "Jordan 4 negro", "$60"],
  ["Air Max 90 blanco 85.jpg", "Air Max 90 blanco", "$85"],
  ["Campus gris 39,99.jpg", "Campus gris", "$39.99"],
  ["Bolso Nike COD 125 30.jpg", "Bolso Nike", "$30"],
  // El número es del MODELO, no un precio:
  ["Jordan 4.jpg", "Jordan 4", ""],
  ["Air Max 90.jpg", "Air Max 90", ""],
  ["New Balance 530.jpg", "New Balance 530", ""],
  ["Real Madrid 2026.jpg", "Real Madrid 2026", ""],
  ["Short Nike talla 32.jpg", "Short Nike talla 32", ""],
  ["Bolso Nike COD 125.jpg", "Bolso Nike", ""],
]) {
  const r = D.leerNombre(nombre);
  ok(r.titulo === titulo_ && r.precio === precio, `"${nombre}" → ${precio || "sin precio"}`, `${r.titulo} | ${r.precio || "sin precio"}`);
}
titulo("tallas con guion y \"$. 60\": el precio es el 60, no la talla (caso real, 5-oct-2026)");
for (const [nombre, titulo_, codigo, precio] of [
  ["NIKE ACG (Cód. ACG) Tallas 40-45 $. 60.jpg", "NIKE ACG Tallas 40-45", "ACG", "$60"],
  ["NIKE ACG (COD NAG) Tallas 40-45 USD . 60.jpg", "NIKE ACG Tallas 40-45", "NAG", "$60"],
  ["NIKE ACG (COD ACG) Tallas 40-45 . 60.jpg", "NIKE ACG Tallas 40-45", "ACG", "$60"],
  ["Nike 45$ AF1.jpg", "Nike AF1", "", "$45"],
]) {
  const r = D.leerNombre(nombre);
  ok(r.titulo === titulo_ && r.codigo === codigo && r.precio === precio,
     `"${nombre}" → ${precio}`, `${r.titulo} | ${r.codigo || "-"} | ${r.precio || "sin precio"}`);
}
ok(D.conSimboloDeDolar("45") === "$45" && D.conSimboloDeDolar("45.5") === "$45.50", "debajo de la foto sale con el símbolo: $45, $45.50");

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
  ok(af.titulo === "Air Force One blanco · Cód. 125" && af.precio === "$45", "con su código y su precio", `${af.titulo} — ${af.precio}`);
  ok(/^https:\/\/lh3\.googleusercontent\.com\/d\/f1=w1000$/.test(af.imagen), "la foto, servida directa por Google (la puede bajar Instagram)", af.imagen);
  ok(af.url === "https://drive.google.com/file/d/f1/view", "y 'Ver producto' abre la foto en Drive");
  const campus = productos.find((p) => /Campus/.test(p.titulo));
  ok(campus.precio === "$40", "la DESCRIPCIÓN manda si trae el precio (el nombre no lo tenía)");
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
  ok(Object.keys(r1.productos[0]).sort().join() === "categoria,imagen,precio,titulo,url", "la ficha tiene la misma forma que la de Shopify (con su categoría)");
  const r5 = await conDrive(() => S.buscarProductos(env, "jordan 4", 10));
  ok(r5.productos.length === 1 && /Retro 4/.test(r5.productos[0].titulo), '"jordan 4" encuentra el "Retro 4" (son la misma zapatilla)');
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
  ok(r.productos.length === 0 && /no está activada/.test(r.error) && /Habilitar/.test(r.error), "API de Drive apagada (y sin página pública) → dice dónde activarla", r.error.slice(0, 80));
  const sinCarpeta = await conDrive(() => D.catalogoDeDrive({ ...env, DRIVE_CARPETA: "PENDIENTE" }));
  ok(/falta DRIVE_CARPETA/.test(sinCarpeta.error), "sin carpeta → lo dice");
  const busca = await conDrive(() => S.buscarProductos(env, "air", 10), "boom");
  ok(busca.productos.length === 0, "y si Drive falla, la búsqueda devuelve vacío en vez de romper el bot");
}

// ── SIN CLAVE: la carpeta pública (embeddedfolderview) ──────────────
// Así es la página que Google enseña a cualquiera con el enlace.
function entrada(id, nombre, carpeta = false) {
  const href = carpeta ? `https://drive.google.com/drive/folders/${id}` : `https://drive.google.com/file/d/${id}/view?usp=drive_web`;
  return `<div class="flip-entry" id="entry-${id}" tabindex="0" role="link"><div class="flip-entry-info"><a href="${href}" target="_blank"><div class="flip-entry-thumb"><img src="https://lh3.google.com/u/0/d/${id}=w200-h190-p-k-nu-iv1" alt=""></div><div class="flip-entry-title">${nombre}</div></a></div><div class="flip-entry-last-modified"><div>1 oct</div></div></div>`;
}
const PUB_RAIZ = "14lvw1gxxkZSMEdtZbvJ_fIuaCcCcZykA", PUB_SUB = "1SubCarpetaNikeXXXXXXXX";
const PAGINAS = {
  [PUB_RAIZ]: `<html><head><title>CATALOGO</title></head><body><div class="flip-view"><div class="flip-entries">` +
    entrada("1FotoAirForceXXXXXX", "Air Force One blanco COD 125 45$.jpg") +
    entrada("1FotoSambaXXXXXXXXX", "Samba &amp; Gazelle &quot;negra&quot; 38$.jpeg") +
    entrada("1ListaPreciosXXXXXX", "lista de precios.pdf") +
    entrada(PUB_SUB, "Nike", true) +
    `</div></div></body></html>`,
  [PUB_SUB]: `<html><body><div class="flip-entries">` + entrada("1FotoDunkXXXXXXXXXX", "Dunk Low panda 50$") + `</div></body></html>`,
};
let paginasPedidas = [];
function publicaDeMentira({ api = "", privada = false } = {}) {
  return async (url) => {
    const u = new URL(String(url));
    if (u.hostname === "www.googleapis.com") return new Response(api || "{}", { status: api ? 401 : 200 });
    if (u.hostname !== "drive.google.com" || u.pathname !== "/embeddedfolderview") return new Response("", { status: 404 });
    paginasPedidas.push(u.searchParams.get("id"));
    if (privada) return new Response(`<html><head><title>Google Drive: inicia sesión</title></head><body><a href="https://accounts.google.com/ServiceLogin">Acceder</a></body></html>`, { status: 200 });
    return new Response(PAGINAS[u.searchParams.get("id")] || "", { status: PAGINAS[u.searchParams.get("id")] ? 200 : 404 });
  };
}
async function conPublica(fn, opciones) {
  const real = globalThis.fetch, log = console.log, err = console.error;
  globalThis.fetch = publicaDeMentira(opciones);
  console.log = () => {}; console.error = () => {};
  D.olvidarCatalogoDeDrive();
  paginasPedidas = [];
  try { return await fn(); } finally { globalThis.fetch = real; console.log = log; console.error = err; }
}
const envSinClave = { CATALOGO: "drive", DRIVE_CARPETA: `https://drive.google.com/drive/folders/${PUB_RAIZ}?usp=sharing` };

titulo("SIN CLAVE: lee la carpeta pública, como cualquiera con el enlace");
{
  const lista = D.leerPaginaDeCarpeta(PAGINAS[PUB_RAIZ]);
  ok(lista.length === 3, "de la página saca 2 fotos y 1 subcarpeta (el PDF no)", lista.map((a) => a.name).join(" · "));
  ok(lista.some((a) => a.name === 'Samba & Gazelle "negra" 38$.jpeg'), "los &amp; y &quot; de la página salen como letras");

  const r = await conPublica(() => D.catalogoDeDrive(envSinClave));
  ok(!r.error && r.productos.length === 3, "sin DRIVE_API_KEY: 3 productos, también el de la subcarpeta", r.error || r.productos.map((p) => p.titulo).join(" · "));
  ok(/pública/.test(r.via), "y dice que la leyó como carpeta pública", r.via);
  ok(paginasPedidas.includes(PUB_SUB), "entró en la subcarpeta Nike");
  const af = r.productos.find((p) => /Air Force/.test(p.titulo));
  ok(af.titulo === "Air Force One blanco · Cód. 125" && af.precio === "$45", "con su código y su precio", `${af.titulo} — ${af.precio}`);
  ok(af.imagen === "https://lh3.googleusercontent.com/d/1FotoAirForceXXXXXX=w1000", "la foto directa de Google", af.imagen);
  ok(af.nombre === "Air Force One blanco COD 125 45$.jpg", "guarda el nombre del archivo tal cual (para /probar-drive)");
  const rj = await conPublica(() => S.buscarProductos(envSinClave, "retro", 10));
  ok(rj.productos.length === 0, '"retro" no inventa: aquí no hay ninguna Jordan');
  const b = await conPublica(() => S.buscarProductos(envSinClave, "nike", 10));
  ok(b.productos.length === 1 && /Dunk/.test(b.productos[0].titulo), '"nike" encuentra lo de la subcarpeta Nike');
  ok(Object.keys(b.productos[0]).sort().join() === "categoria,imagen,precio,titulo,url", "la ficha sigue con la forma de Shopify (sin el nombre interno, con su categoría)");
}

titulo("una clave de IA cargada NO se usa para Drive (Google la rechaza)");
{
  const r = await conPublica(() => D.catalogoDeDrive({ ...envSinClave, DEEPSEEK_API_KEY: "clave-de-ia" }));
  ok(!r.error && /pública/.test(r.via), "con solo la clave de la IA lee la carpeta pública, sin pedirle nada a la API", r.via);
}

titulo("con una DRIVE_API_KEY que falla, se vuelve a la carpeta pública");
{
  const r = await conPublica(
    () => D.catalogoDeDrive({ ...envSinClave, DRIVE_API_KEY: "mala" }),
    { api: JSON.stringify({ error: { code: 401, message: "API keys are not supported by this API. Expected OAuth2 access token", status: "UNAUTHENTICATED" } }) }
  );
  ok(!r.error && r.productos.length === 3, "igual salen los 3 productos", r.error);
  ok(/DRIVE_API_KEY falló/.test(r.aviso) && /no sirve para Google Drive/.test(r.aviso), "y avisa en palabras claras qué pasó con la clave", r.aviso);
}

titulo("carpeta privada: dice exactamente cómo compartirla");
{
  const r = await conPublica(() => D.catalogoDeDrive(envSinClave), { privada: true });
  ok(r.productos.length === 0 && /Cualquier persona con el enlace/.test(r.error), "explica el paso de Compartir", r.error.slice(0, 90));
}

titulo("las CATEGORÍAS de la carpeta (CATALOGO › CNTND 1 (30/6/26) › CALZADOS…)");
{
  ok(D.categoriaDeLaRuta(["CNTND 1 (30/6/26)", "CALZADOS", "NIKE"]) === "CALZADOS", "la carpeta de lote no es categoría: CALZADOS sí");
  ok(D.categoriaDeLaRuta(["GORRAS"]) === "GORRAS" && D.categoriaDeLaRuta([]) === "", "sin lote, la primera carpeta; sin carpetas, ninguna");

  const R = "1RaizCategoriasXXXXXXX", L = "1LoteCategoriasXXXXXXX", C = "1CalzadosCategoriasXXX", G = "1GorrasCategoriasXXXXX";
  const e = (id, nombre, carpeta) =>
    `<div class="flip-entry" id="entry-${id}"><a href="https://drive.google.com/${carpeta ? "drive/folders" : "file/d"}/${id}"><div class="flip-entry-title">${nombre}</div></a></div>`;
  const pags = {
    [R]: `<div class="flip-entries">${e(L, "CNTND 1 (30/6/26)", true)}</div>`,
    [L]: `<div class="flip-entries">${e(C, "CALZADOS", true)}${e(G, "GORRAS", true)}</div>`,
    [C]: `<div class="flip-entries">${e("1ZapatoUnoXXXXXXXX", "Air Force One blanco 45$.jpg")}${e("1ZapatoDosXXXXXXXX", "Jordan 4 negro 60$.jpg")}</div>`,
    [G]: `<div class="flip-entries">${e("1GorraUnoXXXXXXXXX", "New Era negra 20$.jpg")}</div>`,
  };
  const real = globalThis.fetch, log = console.log, err = console.error;
  const sistemas = [];
  globalThis.fetch = async (url, op = {}) => {
    const u = String(url);
    if (u.startsWith("https://drive.google.com/embeddedfolderview")) return new Response(pags[new URL(u).searchParams.get("id")] || "", { status: 200 });
    if (u.startsWith("https://api.deepseek.com/")) {
      sistemas.push(JSON.parse(op.body).messages[0].content);
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"respuesta":"¡Hola! ¿Qué estás buscando? 😊","buscar":"NADA","historial":"Saludó."}' } }] }), { status: 200 });
    }
    return new Response("", { status: 404 });
  };
  console.log = () => {}; console.error = () => {};
  D.olvidarCatalogoDeDrive();
  const envC = { CATALOGO: "drive", DRIVE_CARPETA: R, DEEPSEEK_API_KEY: "x" };
  try {
    const gorras = await S.buscarProductos(envC, "gorras", 10);
    ok(gorras.productos.length === 1 && /New Era/.test(gorras.productos[0].titulo), '"gorras" → lo de la carpeta GORRAS');
    const zapatos = await S.buscarProductos(envC, "zapatos", 10);
    ok(zapatos.productos.length === 2, '"zapatos" → lo de CALZADOS (sinónimo)', `${zapatos.productos.length}`);
    const tenis = await S.buscarProductos(envC, "tenis negros", 10);
    ok(tenis.productos.length === 1 && /Jordan/.test(tenis.productos[0].titulo), '"tenis negros" → el Jordan negro (calzado + plural)');
    const lista = await D.titulosDeDrive(envC);
    ok(/^CALZADOS:\n/m.test(lista) && /^GORRAS:\n/m.test(lista), "los títulos van al prompt agrupados por categoría", lista.replace(/\n/g, " | "));
    // EL TIPO de la foto filtra el cotejo: una gorra solo contra gorras.
    const C = await src.cargar("cotejo.js");
    const todos = (await D.catalogoDeDrive(envC)).productos;
    const soloGorras = todos.filter(await C.filtroDelTipo(envC, "gorra"));
    ok(soloGorras.length === 1 && /New Era/.test(soloGorras[0].titulo), "foto de una GORRA → el cotejo solo compara contra GORRAS", soloGorras.map((p) => p.titulo).join(" · "));
    const soloCalzado = todos.filter(await C.filtroDelTipo(envC, "calzado"));
    ok(soloCalzado.length === 2 && soloCalzado.every((p) => !/New Era/.test(p.titulo)), "foto de un ZAPATO → solo contra CALZADOS");
    ok(todos.filter(await C.filtroDelTipo(envC, "bolso")).length === 3, "un tipo que la tienda no tiene en carpetas (bolso) no deja al cotejo sin nada: compara con todo");
    ok(todos.filter(await C.filtroDelTipo(envC, "")).length === 3, "sin tipo, todo");
    ok(D.carpetaDelTipo("FRANELAS", "franela") && D.carpetaDelTipo("PANTALONES", "pantalon") && D.carpetaDelTipo("SHORT", "short") && D.carpetaDelTipo("UNIFORMES", "uniforme") && D.carpetaDelTipo("BOLSOS", "bolso"),
       "las carpetas de El Emperador se reconocen por tipo");

    const cats = await D.categoriasDeDrive(envC);
    ok(cats.map((c) => c.nombre).sort().join() === "CALZADOS,GORRAS", "las categorías: CALZADOS y GORRAS");

    // EL PROMPT ARMADO DE VERDAD: con lo de Drive, el horario, Cashea y sin marcadores sueltos.
    const ia = await src.cargar("ia.js");
    await ia.responderTexto(envC, "Cliente: hola");
    const sistema = sistemas[0] || "";
    ok(sistema && !/\{\{\w+\}\}/.test(sistema), "el prompt que le llega a DeepSeek no tiene ningún {{MARCADOR}} sin rellenar", (sistema.match(/\{\{\w+\}\}/g) || []).join(" "));
    ok(/🔹 Calzados/.test(sistema) && /🔹 Gorras/.test(sistema), "sabe qué vende: Calzados y Gorras");
    ok(/8:30am a 5:30pm/.test(sistema) && /no hacemos envíos/.test(sistema) && /no hacemos delivery/.test(sistema), "sabe el horario de El Emperador y que no hay envíos ni delivery");
    ok(/trabaja con Cashea/.test(sistema), "y que trabaja con Cashea (las cuentas las pone el sistema)");
    ok(/Air Force One blanco/.test(sistema) && /New Era negra/.test(sistema), "y los nombres reales de la carpeta");
  } finally {
    globalThis.fetch = real; console.log = log; console.error = err;
  }
}

titulo("el índice con Drive mira la carpeta ENTERA, no solo 600");
{
  const { baseDeMentira } = await import("./ayuda.mjs");
  const I = await src.cargar("indice.js");
  const R = "1RaizSeiscientosXXXXXX";
  const e = (id, nombre) => `<div class="flip-entry" id="entry-${id}"><a href="https://drive.google.com/file/d/${id}"><div class="flip-entry-title">${nombre}</div></a></div>`;
  const pagina = `<div class="flip-entries">${Array.from({ length: 650 }, (_, i) => e(`1Foto${String(i).padStart(15, "0")}`, `Producto ${i} 20$.jpg`)).join("")}</div>`;
  const real = globalThis.fetch, log = console.log, err = console.error;
  globalThis.fetch = async (url, op = {}) => {
    const u = String(url);
    if (u.startsWith("https://drive.google.com/embeddedfolderview")) return new Response(pagina, { status: 200 });
    if (u.startsWith("https://api.deepseek.com/")) {
      const rasgos = Object.fromEntries(["camaraAireTalon","camaraAireCompleta","suelaTransparente","suelaRedondeadaSinAire","suelaPlanaPlacaDura","muescaLateralArco","suelaNubesHuecas","mallaPlasticaCuadros","alasPlasticasCordones","jumpman","swooshGrandeRecto","piezaMetalicaOjal","tresFranjas","punteraGamuzaT","punteraGomaConcha"].map((k) => [k, false]));
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ visto: "x", rasgos, buscar: "x", color: "negro", variosProductos: false, pedirNombreExacto: false }) } }] }), { status: 200 });
    }
    return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { "content-type": "image/jpeg" } });
  };
  console.log = () => {}; console.error = () => {};
  D.olvidarCatalogoDeDrive();
  let r;
  try {
    r = await I.indexarTanda({ DB: baseDeMentira().DB, CATALOGO: "drive", DRIVE_CARPETA: R, DEEPSEEK_API_KEY: "x", COTEJO_MAXIMO: "600" }, { cuantos: 2 });
  } finally {
    globalThis.fetch = real; console.log = log; console.error = err;
  }
  ok(r.ok && r.catalogo === 650, "las 650 fotos de la carpeta entran al índice (COTEJO_MAXIMO = 600 ya no lo corta)", `${r.catalogo}`);
  ok(r.fuente === "Google Drive" && r.carpetasTotal === 1 && r.carpetasLeidas === 1, "y la página dice Google Drive, con las carpetas leídas", `${r.fuente} ${r.carpetasLeidas}/${r.carpetasTotal}`);
}

titulo("sin CATALOGO = drive, sigue siendo Shopify");
ok(!D.usaDrive({}) && D.usaDrive({ CATALOGO: "drive" }), "solo con CATALOGO = \"drive\"");

src.limpiar();
terminar();
