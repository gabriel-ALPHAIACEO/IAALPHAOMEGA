// PRUEBAS DE LAS FOTOS DEL SISTEMA (16-oct-2026): si el sistema de inventario
// tiene fotos (una columna con la dirección o el archivo, o una carpeta con las
// fotos nombradas por el código), el agente las manda.
//
//   node pruebas/fotos.mjs          (desde la carpeta agente-puente)
//
// Lo que no se puede romper:
//   · se encuentran por la columna (dirección, ruta, varias con |) o por la carpeta (A1.jpg, A1-2.jpg…);
//   · solo se manda lo nuevo o cambiado (se recuerda la huella), y como mucho N por vuelta;
//   · una foto mala (no es foto, pesa demasiado) se salta con su motivo y NO hace malo el conteo;
//   · a la tienda ALPHA IA, a otra plataforma (JSON con base64, firmado) y a una carpeta;
//   · solo a los destinos que recibieron bien el stock.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const a = await import(pathToFileURL(path.resolve(AQUI, "../agente-puente.mjs")).href);

let fallos = 0;
let pasadas = 0;
function ok(condicion, que, detalle = "") {
  if (condicion) {
    pasadas++;
    console.log(`  ✅ ${que}`);
  } else {
    fallos++;
    console.log(`  ❌ ${que}${detalle ? `\n      ${detalle}` : ""}`);
  }
}
function titulo(t) {
  console.log(`\n${t}`);
}

// Unos bytes que empiezan como un JPG / PNG (la tienda mira los primeros bytes).
const jpg = (n = 1) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, n)]);
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 7)]);

const CLAVE = "clave-de-la-tienda-fotos-1";
const FIRMA = "firma-de-las-fotos-22";
const visto = { tienda: [], webhook: [], sinProducto: new Set(), red: [] };
const servidor = http.createServer(async (req, res) => {
  const trozos = [];
  for await (const t of req) trozos.push(t);
  const cuerpo = Buffer.concat(trozos);
  const url = new URL(req.url, "http://127.0.0.1");
  const enviar = (estado, datos) => res.writeHead(estado, { "content-type": "application/json" }).end(JSON.stringify(datos));
  if (url.pathname.startsWith("/red/")) {
    // Una foto en la red de la oficina (http://192.168…/img/A1.jpg).
    visto.red.push(url.pathname);
    if (url.pathname === "/red/no-hay.jpg") return res.writeHead(404).end();
    return res.writeHead(200, { "content-type": "image/jpeg" }).end(jpg(9));
  }
  if (url.pathname === "/recibir") {
    visto.webhook.push({ headers: req.headers, cuerpo: cuerpo.toString("utf8") });
    return enviar(200, {});
  }
  if (req.headers.authorization !== `Bearer ${CLAVE}`) return enviar(401, { ok: false, error: "Clave incorrecta." });
  if (url.pathname === "/api/sync/latido") return enviar(200, { ok: true, ordenes: [] });
  if (url.pathname === "/api/sync/inventario") return enviar(200, { ok: true, trabajo: 1, estado: "listo", filas: cuerpo.toString().split("\n").length - 1, informe: {} });
  if (url.pathname === "/api/sync/foto") {
    const codigo = url.searchParams.get("codigo");
    if (visto.sinProducto.has(codigo)) return enviar(404, { ok: false, estado: "sin-producto" });
    visto.tienda.push({ codigo, producto: url.searchParams.get("producto"), posicion: Number(url.searchParams.get("posicion")), tipo: req.headers["content-type"], bytes: cuerpo.length, huella: crypto.createHash("sha256").update(cuerpo).digest("hex") });
    return enviar(200, { ok: true, estado: "nueva" });
  }
  enviar(404, { ok: false });
});
await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${servidor.address().port}`;
const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "puente-fotos-"));
const sinEsperar = async () => {};
const nunca = async () => null;

try {
  titulo("encontrar las fotos: por la columna o por la carpeta");
  {
    const dirFotos = path.join(carpeta, "Imagenes");
    fs.mkdirSync(dirFotos);
    fs.writeFileSync(path.join(dirFotos, "A1.jpg"), jpg(1));
    fs.writeFileSync(path.join(dirFotos, "A1-2.jpg"), jpg(2));
    fs.writeFileSync(path.join(dirFotos, "a1 (3).png"), png());
    fs.writeFileSync(path.join(dirFotos, "B7_2.jpg"), jpg(3));
    fs.writeFileSync(path.join(dirFotos, "notas.txt"), "x");
    const tabla = { columnas: ["Código", "Nombre", "Stock"], filas: [["A1", "Zapato", "2"], ["A1", "Zapato", "3"], ["B7", "Bolso", "1"], ["C9", "Gorra", "4"]] };
    const indices = a.detectarColumnas(tabla.columnas).indices;
    let f = a.fotosDeLosProductos({ fotos: { carpeta: dirFotos } }, { tabla, indices });
    ok(f.filter((x) => x.codigo === "A1").map((x) => path.basename(x.fuente.archivo)).join() === "A1.jpg,A1-2.jpg,a1 (3).png", "carpeta: A1.jpg (principal), A1-2.jpg y «a1 (3).png», sin importar mayúsculas", JSON.stringify(f.map((x) => [x.codigo, x.posicion, path.basename(x.fuente.archivo)])));
    ok(f.filter((x) => x.codigo === "A1").length === 3, "un producto con varias tallas (varias filas): sus fotos una sola vez");
    ok(f.some((x) => x.codigo === "B7" && x.posicion === 0) && !f.some((x) => x.codigo === "C9"), "B7_2.jpg es de B7; C9 no tiene ninguna");
    const t2 = { columnas: ["Ref", "Descripción", "Existencia", "Imagen"], filas: [["R1", "Camisa", "1", "https://cdn.ejemplo.com/r1.jpg | R1-espalda.jpg"], ["R2", "Pantalón", "2", "C:\\Fotos\\r2.jpg"], ["R3", "Correa", "1", ""]] };
    const i2 = a.detectarColumnas(t2.columnas).indices;
    ok(i2.foto === 3, "la columna «Imagen» se reconoce sola");
    f = a.fotosDeLosProductos({ fotos: { carpeta: "D:\\Sistema\\Fotos" } }, { tabla: t2, indices: i2 });
    ok(f[0].fuente.url === "https://cdn.ejemplo.com/r1.jpg" && f[1].fuente.archivo.endsWith("R1-espalda.jpg") && f[1].posicion === 1, "en la columna: una dirección y un archivo (varias con «|»), cada una con su posición", JSON.stringify(f));
    ok(f[2].fuente.archivo === "C:\\Fotos\\r2.jpg" && !f.some((x) => x.codigo === "R3"), "una ruta completa de Windows queda tal cual; una celda vacía no da foto");
    ok(a.fotosActivadas({}, i2) && !a.fotosActivadas({}, indices) && a.fotosActivadas({ fotos: { carpeta: "x" } }, indices) && !a.fotosActivadas({ fotos: { activar: false } }, i2), "se mandan solas si hay columna o carpeta; «activar: false» las apaga");
    const porNombre = a.fotosDeLosProductos({ fotos: { carpeta: dirFotos, por: "producto" } }, { tabla: { columnas: ["Nombre", "Stock"], filas: [["B7", "1"]] }, indices: a.detectarColumnas(["Nombre", "Stock"]).indices });
    ok(porNombre.length === 1, '"por": "producto" busca la foto por el nombre');
  }

  const stock = path.join(carpeta, "stock.csv");
  fs.writeFileSync(stock, "Código;Nombre;Stock\nA1;Zapato;2\nB7;Bolso;1\nC9;Gorra;4\n");
  const dirFotos = path.join(carpeta, "Imagenes");
  const configTienda = (extra = {}) => a.completarConfig({ agente: "pc-fotos", origen: "Saint", url: BASE, clave: CLAVE, fuente: { tipo: "archivo", ruta: stock }, fotos: { carpeta: dirFotos, ...extra } }, carpeta);

  titulo("a la tienda ALPHA IA: después del stock, solo lo nuevo");
  {
    fs.rmSync(path.join(carpeta, "fotos-enviadas.json"), { force: true });
    const r = await a.vuelta(configTienda(), { esperar: sinEsperar, registrar: () => {}, achicar: nunca });
    ok(r.ok && visto.tienda.length === 4, "las 4 fotos (3 de A1 y 1 de B7) llegan a /api/sync/foto", JSON.stringify(visto.tienda));
    const a1 = visto.tienda.filter((x) => x.codigo === "A1").sort((x, y) => x.posicion - y.posicion);
    ok(a1.map((x) => x.posicion).join() === "0,1,2" && a1[2].tipo === "image/png" && a1[0].producto === "Zapato", "con su código, su nombre, su posición y su tipo");
    ok(/4 fotos mandadas/.test(r.resultados[0].mensaje), "y lo cuenta en el resultado (lo que se ve en el panel)", r.resultados[0].mensaje);
    const antes = visto.tienda.length;
    await a.vuelta(configTienda(), { forzar: true, esperar: sinEsperar, registrar: () => {}, achicar: nunca });
    ok(visto.tienda.length === antes, "la vuelta siguiente: ninguna otra vez (no cambiaron)");
    fs.writeFileSync(path.join(dirFotos, "A1-2.jpg"), jpg(5));
    await a.vuelta(configTienda(), { forzar: true, esperar: sinEsperar, registrar: () => {}, achicar: nunca });
    ok(visto.tienda.length === antes + 1 && visto.tienda.at(-1).codigo === "A1" && visto.tienda.at(-1).posicion === 1, "cambian la foto 2 de A1 en el sistema: solo esa se vuelve a mandar");
  }

  titulo("muchas fotos: como mucho N por vuelta; sin producto todavía: más tarde");
  {
    const muchas = path.join(carpeta, "muchas");
    fs.mkdirSync(muchas);
    let csv = "Código;Nombre;Stock\n";
    for (let i = 0; i < 7; i++) {
      csv += `M${i};Modelo ${i};1\n`;
      fs.writeFileSync(path.join(muchas, `M${i}.jpg`), jpg(20 + i));
    }
    const archivo = path.join(carpeta, "muchas.csv");
    fs.writeFileSync(archivo, csv);
    const c = a.completarConfig({ agente: "pc-muchas", url: BASE, clave: CLAVE, fuente: { tipo: "archivo", ruta: archivo }, fotos: { carpeta: muchas, maximoPorVuelta: 3 } }, path.join(carpeta, "muchas"));
    const antes = visto.tienda.length;
    let r = await a.vuelta(c, { esperar: sinEsperar, registrar: () => {}, achicar: nunca });
    ok(visto.tienda.length === antes + 3 && /4 fotos para las próximas vueltas/.test(r.resultados[0].mensaje), "7 fotos con «maximoPorVuelta: 3»: 3 ahora y 4 para después", r.resultados[0].mensaje);
    await a.vuelta(c, { forzar: true, esperar: sinEsperar, registrar: () => {}, achicar: nunca });
    await a.vuelta(c, { forzar: true, esperar: sinEsperar, registrar: () => {}, achicar: nunca });
    ok(visto.tienda.length === antes + 7, "en 3 vueltas están todas");
    visto.sinProducto.add("M9");
    fs.appendFileSync(archivo, "M9;Nuevo;1\n");
    fs.writeFileSync(path.join(muchas, "M9.jpg"), jpg(99));
    const n = visto.tienda.length;
    r = await a.vuelta(c, { forzar: true, esperar: sinEsperar, registrar: () => {}, achicar: nunca });
    ok(r.ok && visto.tienda.length === n, "la tienda todavía no tiene M9 (404 «sin-producto»): no es un error");
    visto.sinProducto.delete("M9");
    await a.vuelta(c, { forzar: true, esperar: sinEsperar, registrar: () => {}, achicar: nunca });
    ok(visto.tienda.length === n, "y no se reintenta en cada vuelta (espera unas horas)");
    const cache = JSON.parse(fs.readFileSync(path.join(carpeta, "muchas", "fotos-enviadas.json"), "utf8"));
    for (const k of Object.keys(cache.sinProducto)) cache.sinProducto[k] -= 7 * 60 * 60 * 1000;
    fs.writeFileSync(path.join(carpeta, "muchas", "fotos-enviadas.json"), JSON.stringify(cache));
    await a.vuelta(c, { forzar: true, esperar: sinEsperar, registrar: () => {}, achicar: nunca });
    ok(visto.tienda.length === n + 1 && visto.tienda.at(-1).codigo === "M9", "pasadas 6 horas, se vuelve a intentar y entra");
  }

  titulo("fotos malas: se saltan con su motivo, el stock sigue bien");
  {
    const malas = path.join(carpeta, "malas");
    fs.mkdirSync(malas);
    fs.writeFileSync(path.join(malas, "A1.jpg"), "esto no es una foto");
    fs.writeFileSync(path.join(malas, "B7.jpg"), Buffer.concat([jpg(1), Buffer.alloc(1_600_000)]));
    const c = a.completarConfig({ agente: "pc-malas", url: BASE, clave: CLAVE, fuente: { tipo: "archivo", ruta: stock }, fotos: { carpeta: malas } }, malas);
    const antes = visto.tienda.length;
    const r = await a.vuelta(c, { esperar: sinEsperar, registrar: () => {}, achicar: nunca });
    ok(r.ok && visto.tienda.length === antes, "el conteo sale bien y no se manda ninguna foto mala");
    ok(/2 fotos con problemas/.test(r.resultados[0].mensaje) && /no es JPG, PNG o WEBP|pesa 1\.6 MB/.test(r.resultados[0].mensaje), "dice cuántas y por qué", r.resultados[0].mensaje);
    // Si se puede achicar (en Windows lo hace PowerShell), se manda achicada.
    fs.rmSync(path.join(malas, "fotos-enviadas.json"), { force: true });
    const achicadas = [];
    await a.vuelta(c, { forzar: true, esperar: sinEsperar, registrar: () => {}, achicar: async (ruta) => (achicadas.push(path.basename(ruta)), jpg(42)) });
    ok(achicadas.sort().join() === "A1.jpg,B7.jpg" && visto.tienda.length === antes + 2 && visto.tienda.at(-1).bytes < 1_500_000, "con algo para achicar (PowerShell en Windows): se achican y se mandan", JSON.stringify(achicadas));
  }

  titulo("de una dirección (internet o la red de la oficina)");
  {
    const archivo = path.join(carpeta, "con-url.csv");
    fs.writeFileSync(archivo, `Código;Nombre;Stock;Foto\nU1;Lente;1;${BASE}/red/u1.jpg\nU2;Reloj;1;${BASE}/red/no-hay.jpg\n`);
    const dir = path.join(carpeta, "url");
    fs.mkdirSync(dir);
    const c = a.completarConfig({ agente: "pc-url", url: BASE, clave: CLAVE, fuente: { tipo: "archivo", ruta: archivo } }, dir);
    const antes = visto.tienda.length;
    const r = await a.vuelta(c, { esperar: sinEsperar, registrar: () => {}, achicar: nunca });
    ok(visto.tienda.length === antes + 1 && visto.tienda.at(-1).codigo === "U1", "la de U1 se baja y se manda", JSON.stringify(visto.tienda.slice(antes)));
    ok(/no se pudo leer \(la dirección contestó 404\)/.test(r.resultados[0].mensaje), "la que no existe: dice que no se pudo leer", r.resultados[0].mensaje);
    const bajadas = visto.red.length;
    await a.vuelta(c, { forzar: true, esperar: sinEsperar, registrar: () => {}, achicar: nunca });
    ok(visto.red.filter((x) => x === "/red/u1.jpg").length === 1 && visto.red.length === bajadas + 1, "una dirección ya mandada no se vuelve a bajar en el día (la que falló, sí)", JSON.stringify(visto.red));
  }

  titulo("a otra plataforma (JSON firmado) y a una carpeta");
  {
    const salida = path.join(carpeta, "salida");
    const c = a.completarConfig(
      {
        agente: "pc-otros",
        origen: "Saint",
        fuente: { tipo: "archivo", ruta: stock },
        fotos: { carpeta: dirFotos },
        destinos: [
          { tipo: "webhook", url: `${BASE}/recibir`, secretoFirma: FIRMA },
          { tipo: "carpeta", carpeta: salida },
        ],
      },
      salida
    );
    fs.mkdirSync(salida, { recursive: true });
    const r = await a.vuelta(c, { esperar: sinEsperar, registrar: () => {}, achicar: nunca });
    const fotos = visto.webhook.filter((x) => x.headers["x-puente-tipo"] === "foto").map((x) => ({ ...x, json: JSON.parse(x.cuerpo) }));
    ok(r.ok && fotos.length === 4, "a la plataforma: 4 envíos de foto, aparte del stock", String(fotos.length));
    const f = fotos.find((x) => x.json.codigo === "A1" && x.json.posicion === 0);
    ok(f && f.json.tipo === "foto" && f.json.contentType === "image/jpeg" && Buffer.from(f.json.datos, "base64").equals(fs.readFileSync(path.join(dirFotos, "A1.jpg"))), "cada una con su código, posición, tipo y los bytes en base64");
    const esperada = `sha256=${crypto.createHmac("sha256", FIRMA).update(`${f.headers["x-puente-tiempo"]}.${f.cuerpo}`).digest("hex")}`;
    ok(f.headers["x-puente-firma"] === esperada && f.json.huella === crypto.createHash("sha256").update(Buffer.from(f.json.datos, "base64")).digest("hex"), "firmada como el stock, y con su huella");
    ok(["A1-1.jpg", "A1-2.jpg", "A1-3.png", "B7-1.jpg"].every((n) => fs.existsSync(path.join(salida, "fotos", n))), "a la carpeta: fotos/<código>-<n>", fs.readdirSync(path.join(salida, "fotos")).join());
  }

  titulo("solo a los destinos que recibieron bien el stock");
  {
    const c = a.completarConfig({ agente: "pc-mal", url: BASE, clave: "clave-mala-mala", fuente: { tipo: "archivo", ruta: stock }, fotos: { carpeta: dirFotos } }, path.join(carpeta, "salida"));
    const antes = visto.tienda.length;
    const r = await a.vuelta(c, { forzar: true, esperar: sinEsperar, registrar: () => {}, achicar: nunca });
    ok(!r.ok && visto.tienda.length === antes, "si el stock no entró (clave mala), no se mandan fotos", JSON.stringify({ ok: r.ok, error: r.error, n: visto.tienda.length - antes }));
  }

  titulo("--doctor y --probar dicen cuántas fotos hay");
  {
    const r = await a.doctor(configTienda(), { esperar: sinEsperar, ejecutar: async () => ({ codigo: 0 }), plataforma: "win32" });
    const linea = r.find((x) => x.nombre === "Fotos del sistema");
    ok(linea?.ok === true && /4 fotos de 2 productos/.test(linea.detalle) && /carpeta/.test(linea.detalle), "el doctor: cuántas fotos y de dónde", linea?.detalle);
    const sinNada = await a.doctor(configTienda({ carpeta: path.join(carpeta, "vacia") }), { esperar: sinEsperar, ejecutar: async () => ({ codigo: 0 }), plataforma: "win32" });
    ok(sinNada.some((x) => x.nombre === "Fotos del sistema" && x.ok === null && /A1\.jpg/.test(x.detalle)), "con una carpeta sin fotos: explica cómo se tienen que llamar");
    const texto = await a.probar(configTienda(), { esperar: sinEsperar });
    ok(/Fotos: 4 encontradas/.test(texto), "--probar: cuántas encontró", texto);
  }
} finally {
  servidor.close();
  fs.rmSync(carpeta, { recursive: true, force: true });
}

console.log(`\n${pasadas} bien, ${fallos} mal.`);
process.exitCode = fallos ? 1 : 0;
