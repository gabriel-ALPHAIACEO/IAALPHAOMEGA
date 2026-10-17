// PRUEBAS DE LO ABIERTO (16-oct-2026): el agente lee CUALQUIER sistema que esté
// en una computadora y manda a CUALQUIER tienda o plataforma, no solo a las
// tiendas con ALPHA IA.
//
//   node pruebas/abierto.mjs          (desde la carpeta agente-puente)
//
// Lo que no se puede romper:
//   · un CSV con ; , tab o |, con comillas, en UTF-8 o latin1, se lee igual;
//   · un Excel .xlsx se lee sin instalar nada (textos, números, varias hojas);
//   · las columnas se reconocen solas y, si no, se dicen en config.json;
//   · el más nuevo de una carpeta; un JSON;
//   · a otra plataforma le llega un JSON (o CSV) limpio, por partes, con su clave
//     y una firma que se puede comprobar; sin el costo si no se pide;
//   · a una carpeta, un archivo completo (nunca a medias);
//   · con varios destinos, si uno falla los demás reciben igual;
//   · el agente avisa solo (Slack, Teams…) una vez, y cuando vuelve; sin secretos.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import zlib from "node:zlib";
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

// Un .xlsx de verdad, armado a mano (un zip con su XML), para no depender de Excel.
function zip(archivos) {
  const locales = [];
  const centrales = [];
  let p = 0;
  for (const [nombre, contenido] of Object.entries(archivos)) {
    const datos = zlib.deflateRawSync(Buffer.from(contenido));
    const n = Buffer.from(nombre);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(datos.length, 18);
    local.writeUInt32LE(Buffer.byteLength(contenido), 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(datos.length, 20);
    central.writeUInt32LE(Buffer.byteLength(contenido), 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(p, 42);
    locales.push(local, n, datos);
    centrales.push(central, n);
    p += 30 + n.length + datos.length;
  }
  const dir = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(Object.keys(archivos).length, 8);
  fin.writeUInt16LE(Object.keys(archivos).length, 10);
  fin.writeUInt32LE(dir.length, 12);
  fin.writeUInt32LE(p, 16);
  return Buffer.concat([...locales, dir, fin]);
}
function xlsx() {
  return zip({
    "[Content_Types].xml": "<Types/>",
    "xl/workbook.xml": '<workbook><sheets><sheet name="Resumen" sheetId="1" r:id="rId1"/><sheet name="Stock" sheetId="2" r:id="rId2"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    "xl/sharedStrings.xml": "<sst><si><t>Código</t></si><si><t>Descripción</t></si><si><t>Existencia</t></si><si><r><t>Zapato </t></r><r><t>Casual &amp; Cómodo</t></r></si><si><t>Precio</t></si></sst>",
    "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Solo un resumen</t></is></c></row></sheetData></worksheet>',
    "xl/worksheets/sheet2.xml":
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>4</v></c></row>' +
      '<row r="2"><c r="A2" t="inlineStr"><is><t>Z-01</t></is></c><c r="B2" t="s"><v>3</v></c><c r="C2"><v>7</v></c><c r="D2"><v>45.500000000000007</v></c></row>' +
      '<row r="3"/><row r="4"><c r="A4" t="str"><v>Z-02</v></c><c r="C4"><v>0</v></c></row></sheetData></worksheet>',
  });
}

/* ── Una tienda ALPHA IA, otra plataforma y un Slack, de mentira ─────── */

const CLAVE = "clave-de-la-tienda-alpha-1";
const LLAVE_API = "llave-de-la-otra-plataforma-77";
const FIRMA = "secreto-para-firmar-55";
const SLACK = "https://hooks.slack.com/services/T000/B000/abcdefghijklmnop";
const visto = { alpha: [], latidos: [], webhook: [], avisos: [], fallarWebhook: 0 };
const servidor = http.createServer(async (req, res) => {
  const trozos = [];
  for await (const t of req) trozos.push(t);
  const cuerpo = Buffer.concat(trozos).toString("utf8");
  const url = new URL(req.url, "http://127.0.0.1");
  const enviar = (estado, datos) => {
    res.writeHead(estado, { "content-type": "application/json" });
    res.end(JSON.stringify(datos));
  };
  if (url.pathname === "/recibir") {
    if (req.method === "HEAD") return res.writeHead(405).end();
    if (req.headers["x-api-key"] !== LLAVE_API) return enviar(401, { message: "Unauthorized" });
    if (visto.fallarWebhook > 0) {
      visto.fallarWebhook--;
      return enviar(422, { message: "producto inválido" });
    }
    visto.webhook.push({ headers: req.headers, cuerpo });
    return enviar(200, { recibido: true });
  }
  if (url.pathname === "/slack") {
    visto.avisos.push(JSON.parse(cuerpo));
    return enviar(200, {});
  }
  if (req.headers.authorization !== `Bearer ${CLAVE}`) return enviar(401, { ok: false, error: "Clave incorrecta." });
  if (url.pathname === "/api/sync/latido") {
    visto.latidos.push(JSON.parse(cuerpo));
    return enviar(200, { ok: true, ordenes: [] });
  }
  if (url.pathname === "/api/sync/inventario") {
    visto.alpha.push({ csv: cuerpo, consulta: Object.fromEntries(url.searchParams) });
    return enviar(200, { ok: true, trabajo: visto.alpha.length, estado: "listo", filas: cuerpo.split("\n").length - 1, informe: { nuevos: 0, errores: [] } });
  }
  if (url.pathname === "/api/sync/estado") return enviar(200, { ok: true, productos: 9 });
  enviar(404, { ok: false, error: "no existe" });
});
await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${servidor.address().port}`;
// El aviso «de Slack» se manda a la tienda de mentira (la dirección se cambia al vuelo).
const fetchDePrueba = (u, o) => fetch(String(u).replace("https://hooks.slack.com/services/T000/B000/abcdefghijklmnop", `${BASE}/slack`), o);

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "puente-abierto-"));
const sinEsperar = async () => {};
process.env.PRUEBA_LLAVE_API = LLAVE_API;
process.env.PRUEBA_FIRMA = FIRMA;

try {
  titulo("leer tablas: cualquier separador, comillas, codificación");
  {
    for (const [sep, nombre] of [[";", "punto y coma"], [",", "coma"], ["\t", "tabulación"], ["|", "barra"]]) {
      const t = a.leerCsv(["Código", "Descripción", "Existencia"].join(sep) + "\n" + ["A1", '"Zapato, ""el bueno"""', "3"].join(sep) + "\n");
      ok(t.columnas.length === 3 && t.filas[0][1] === 'Zapato, "el bueno"' && t.filas[0][2] === "3", `separado con ${nombre}`, JSON.stringify(t));
    }
    const multi = a.leerCsv('cod;nota;cant\nA;"dos\nlíneas";1\nB;x;2\n');
    ok(multi.filas.length === 2 && multi.filas[0][1] === "dos\nlíneas", "un salto de línea dentro de comillas no parte la fila");
    ok(a.decodificar(Buffer.from("Pantalón", "latin1")) === "Pantalón" && a.decodificar(Buffer.from("Pantalón", "utf8")) === "Pantalón", "la codificación se adivina sola (latin1 o UTF-8)");
    ok(a.decodificar(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Año", "utf16le")])).replace(/^﻿/, "") === "Año", "y UTF-16 con su marca");
    const numeros = { "1.234,50": 1234.5, "1,234.50": 1234.5, "12,5": 12.5, "$ 45": 45, "12.500": 12500, "0.500": 0.5, "Bs. 1.000.000": 1000000, "-3": -3, "": null, abc: null };
    ok(Object.entries(numeros).every(([t, n]) => a.aNumero(t) === n), "los números en cualquier formato (1.234,50 · 1,234.50 · $ 45 …)", JSON.stringify(Object.keys(numeros).map((t) => [t, a.aNumero(t)])));
    const json = a.tablaDeJson({ productos: [{ sku: "J1", nombre: "Bolso", stock: 2, extra: { x: 1 } }, { sku: "J2", nombre: "Gorra", stock: 0 }] });
    ok(json.columnas.join() === "sku,nombre,stock" && json.filas[1][2] === "0", "un JSON (lista o { productos: […] }) es una tabla", JSON.stringify(json));
  }

  titulo("un Excel (.xlsx) sin instalar nada");
  {
    const libro = xlsx();
    const t = a.leerXlsx(libro, { hoja: "Stock" });
    ok(t.columnas.join("|") === "Código|Descripción|Existencia|Precio", "los encabezados (textos compartidos, con tildes)", JSON.stringify(t.columnas));
    ok(t.filas[0][1] === "Zapato Casual & Cómodo", "un texto partido en varios trozos, con & ", t.filas[0][1]);
    ok(t.filas[0][3] === "45.5", "los números de Excel se redondean (45.500000000000007 → 45.5)", t.filas[0][3]);
    ok(t.filas.length === 2 && t.filas[1][0] === "Z-02" && t.filas[1][2] === "0", "las filas vacías se saltan y las celdas que faltan quedan vacías", JSON.stringify(t.filas));
    ok(a.leerXlsx(libro).columnas[0] === "Solo un resumen", "sin decir la hoja: la primera");
    let e = null;
    try {
      a.leerXlsx(libro, { hoja: "Otra" });
    } catch (x) {
      e = x;
    }
    ok(/no tiene la hoja «Otra».*Resumen, Stock/.test(e?.message), "una hoja que no existe: dice cuáles hay", e?.message);
    e = null;
    try {
      a.tablaDeBytes(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]), { nombre: "viejo.xls" });
    } catch (x) {
      e = x;
    }
    ok(/\.xls viejo/.test(e?.message) && /\.xlsx o \.csv/.test(e?.message), "un .xls viejo: dice cómo guardarlo", e?.message);
  }

  titulo("las columnas: solas o dichas en config.json");
  {
    const leer = (cols, mapeo) => a.detectarColumnas(cols, mapeo);
    let r = leer(["Código", "Descripción", "Talla", "Color", "Existencia Actual", "Precio de Compra", "PVP", "Marca", "Almacén", "Departamento"]);
    const i = r.indices;
    ok(i.codigo === 0 && i.producto === 1 && i.talla === 2 && i.color === 3 && i.cantidad === 4 && i.costo === 5 && i.precio === 6 && i.marca === 7 && i.sede === 8 && i.categoria === 9, "en español: todas solas («Precio de Compra» es el costo, no el precio)", JSON.stringify(i));
    r = leer(["SKU", "Name", "Qty", "Price", "Brand", "Size"]);
    ok(r.indices.codigo === 0 && r.indices.producto === 1 && r.indices.cantidad === 2 && r.indices.precio === 3 && r.indices.marca === 4 && r.indices.talla === 5, "en inglés también", JSON.stringify(r.indices));
    r = leer(["ID", "Código", "Nombre", "Stock"]);
    ok(r.indices.codigo === 1, "con «ID» y «Código», el código es «Código»", JSON.stringify(r.indices));
    r = leer(["CO_ART", "ART_DES", "STOCK_ACT", "PREC_VTA1"]);
    ok(r.problemas.some((p) => /CÓDIGO ni el NOMBRE/.test(p)), "nombres raros (como Profit): dice qué falta y cómo decirlo", r.problemas.join(" "));
    r = leer(["CO_ART", "ART_DES", "STOCK_ACT", "PREC_VTA1"], { codigo: "co_art", producto: "ART_DES", cantidad: "Stock_Act", precio: "PREC_VTA1" });
    ok(!r.problemas.length && r.indices.codigo === 0 && r.indices.precio === 3 && r.comoSeLeyo.every((x) => x.dicho), "dichas en config.json (sin importar mayúsculas)", JSON.stringify(r));
    r = leer(["Código", "Nombre", "Stock", "Precio"], { precio: "" });
    ok(r.indices.precio === -1, '"precio": "" = no usar esa columna');
    r = leer(["Código", "Nombre", "Stock"], { cantidad: "Unidades" });
    ok(r.problemas.some((p) => /«Unidades».*no está.*Código, Nombre, Stock/.test(p)), "una columna dicha que no existe: dice cuáles hay", r.problemas.join(" "));
    r = leer(["Código", "Nombre", "Stock"], { cantida: "Stock" });
    ok(r.problemas.some((p) => /«cantida» no es un campo/.test(p)), "un campo mal escrito: lo dice");
    const p = a.productosDe({ columnas: ["Código", "Nombre", "Stock", "Precio", "Costo", "Ubicación"], filas: [["A1", "Zapato", "1.200", "45,50", "20", "Pasillo 3"], ["", "", "3", "", "", ""]] }, leer(["Código", "Nombre", "Stock", "Precio", "Costo", "Ubicación"]).indices);
    ok(p.productos.length === 1 && p.saltadas === 1 && p.productos[0].cantidad === 1200 && p.productos[0].precio === 45.5, "los productos limpios, con números de verdad; sin código ni nombre se salta", JSON.stringify(p));
    ok(p.productos[0].costo === undefined && p.productos[0].extras?.["Ubicación"] === "Pasillo 3", "el costo NO sale si no se pide; lo demás va en «extras»");
  }

  titulo("las fuentes: el más nuevo de una carpeta, un Excel, un JSON");
  {
    const exportes = path.join(carpeta, "exportes");
    fs.mkdirSync(exportes);
    fs.writeFileSync(path.join(exportes, "stock_20261014.csv"), "cod;nombre;cant\nV;Viejo;1\n");
    fs.utimesSync(path.join(exportes, "stock_20261014.csv"), new Date(Date.now() - 86400000), new Date(Date.now() - 86400000));
    fs.writeFileSync(path.join(exportes, "stock_20261016.csv"), "cod;nombre;cant\nN;Nuevo;5\n");
    fs.writeFileSync(path.join(exportes, "otra-cosa.txt"), "nada");
    let r = await a.leerFuente({ fuente: { tipo: "carpeta", carpeta: exportes, patron: "stock_*.csv" } });
    ok(r.nombre === "stock_20261016.csv" && r.tabla.filas[0][0] === "N", "carpeta: toma el más nuevo que cumpla el patrón", r.nombre);
    let e = null;
    try {
      await a.leerFuente({ fuente: { tipo: "carpeta", carpeta: exportes, patron: "*.xlsx" } });
    } catch (x) {
      e = x;
    }
    ok(/no hay ningún archivo «\*\.xlsx»/.test(e?.message), "sin ninguno que cumpla: lo dice", e?.message);
    fs.writeFileSync(path.join(carpeta, "stock.xlsx"), xlsx());
    r = await a.leerFuente({ fuente: { tipo: "archivo", ruta: path.join(carpeta, "stock.xlsx"), hoja: "Stock" } });
    ok(r.tabla.filas.length === 2 && r.tabla.columnas[2] === "Existencia", "archivo .xlsx");
    fs.writeFileSync(path.join(carpeta, "stock.json"), JSON.stringify([{ ref: "J1", articulo: "Bolso", existencia: 4 }]));
    r = await a.leerFuente({ fuente: { tipo: "archivo", ruta: path.join(carpeta, "stock.json") } });
    ok(r.tabla.filas[0].join() === "J1,Bolso,4", "archivo .json");
    const script = path.join(carpeta, "json.mjs");
    fs.writeFileSync(script, 'console.log(JSON.stringify({ items: [{ code: "C1", title: "Camisa", quantity: 9 }] }))');
    r = await a.leerFuente({ fuente: { tipo: "comando", comando: `"${process.execPath}" "${script}"` } });
    ok(r.tabla.columnas.join() === "code,title,quantity", "un comando que escribe JSON (una API local, un script)");
  }

  const archivoXlsx = path.join(carpeta, "stock.xlsx");
  const configWebhook = (extra = {}) =>
    a.completarConfig({ agente: "pc-web", origen: "Saint", equipo: "Caja 2", fuente: { tipo: "archivo", ruta: archivoXlsx, hoja: "Stock" }, destinos: [{ tipo: "webhook", url: `${BASE}/recibir`, cabeceras: { "X-Api-Key": "${ENV:PRUEBA_LLAVE_API}" }, secretoFirma: "${ENV:PRUEBA_FIRMA}", ...extra }] }, carpeta);

  titulo("a OTRA plataforma (webhook): JSON limpio, con su clave y firmado");
  {
    const config = configWebhook();
    ok(!a.problemasDeConfig(config).length, "una configuración solo con un webhook es válida (no hace falta ninguna tienda ALPHA IA)", a.problemasDeConfig(config).join(" | "));
    fs.rmSync(path.join(carpeta, "estado-puente.json"), { force: true });
    const r = await a.vuelta(config, { esperar: sinEsperar, registrar: () => {} });
    const llegada = visto.webhook.at(-1);
    const cuerpo = JSON.parse(llegada.cuerpo);
    ok(r.ok && cuerpo.total === 2 && cuerpo.productos[0].codigo === "Z-01" && cuerpo.productos[0].cantidad === 7 && cuerpo.productos[0].precio === 45.5, "le llega cada producto con números de verdad", llegada.cuerpo.slice(0, 200));
    ok(cuerpo.origen === "Saint" && cuerpo.agente === "pc-web" && cuerpo.parte === 1 && cuerpo.partes === 1 && /^\d{4}-\d\d-\d\dT/.test(cuerpo.generado), "con quién lo manda, cuándo se leyó y en qué parte va");
    ok(llegada.headers["x-api-key"] === LLAVE_API, "con su clave (sacada de la variable de entorno ${ENV:…})");
    const firma = crypto.createHmac("sha256", FIRMA).update(`${llegada.headers["x-puente-tiempo"]}.${llegada.cuerpo}`).digest("hex");
    ok(llegada.headers["x-puente-firma"] === `sha256=${firma}`, "y una firma que el que recibe puede comprobar (HMAC-SHA256)");
    ok(!visto.latidos.some((l) => l.agente === "pc-web"), "a una plataforma que no es ALPHA IA no se le manda latido");
    const e = a.leerEstado(config);
    ok(e.ultimoOk > 0 && /2 productos/.test(e.ultimoMensaje), "recuerda el último conteo bueno", JSON.stringify(e));
  }

  titulo("muchos productos: por partes; el costo solo si se pide; o en CSV");
  {
    const antes = visto.webhook.length;
    await a.vuelta(configWebhook({ lote: 1, incluirCosto: true }), { forzar: true, esperar: sinEsperar, registrar: () => {} });
    const partes = visto.webhook.slice(antes).map((x) => JSON.parse(x.cuerpo));
    ok(partes.length === 2 && partes[0].parte === 1 && partes[1].parte === 2 && partes.every((x) => x.partes === 2 && x.total === 2), "lote 1 con 2 productos: 2 partes, cada una dice cuál es", JSON.stringify(partes.map((x) => [x.parte, x.partes])));
    ok(new Set(partes.map((x) => x.envio)).size === 1, "las dos partes llevan el mismo «envio» (para juntarlas allá)");
    fs.writeFileSync(path.join(carpeta, "con-costo.csv"), "Código;Nombre;Stock;Costo\nK1;Kit;2;10\n");
    const c2 = a.completarConfig({ ...configWebhook({ incluirCosto: true }), fuente: { tipo: "archivo", ruta: path.join(carpeta, "con-costo.csv") } }, carpeta);
    await a.vuelta(c2, { forzar: true, esperar: sinEsperar, registrar: () => {} });
    ok(JSON.parse(visto.webhook.at(-1).cuerpo).productos[0].costo === 10, "con incluirCosto: el costo va");
    const c3 = a.completarConfig({ ...configWebhook(), fuente: { tipo: "archivo", ruta: path.join(carpeta, "con-costo.csv") } }, carpeta);
    await a.vuelta(c3, { forzar: true, esperar: sinEsperar, registrar: () => {} });
    ok(JSON.parse(visto.webhook.at(-1).cuerpo).productos[0].costo === undefined, "sin pedirlo: el costo NO sale de la PC");
    await a.vuelta(configWebhook({ formato: "csv" }), { forzar: true, esperar: sinEsperar, registrar: () => {} });
    const csv = visto.webhook.at(-1);
    ok(/text\/csv/.test(csv.headers["content-type"]) && csv.cuerpo.startsWith("codigo;producto;cantidad;precio") && /Z-01;Zapato Casual & Cómodo;7;45\.5/.test(csv.cuerpo), "en CSV, con los encabezados de siempre", csv.cuerpo);
  }

  titulo("si la plataforma no lo acepta: lo dice, y avisa solo (una vez)");
  {
    const config = a.completarConfig({ ...configWebhook(), avisos: { webhook: SLACK } }, carpeta);
    fs.rmSync(path.join(carpeta, "estado-puente.json"), { force: true });
    const registro = [];
    const registrar = a.crearRegistro({ archivo: path.join(carpeta, "abierto.log"), consola: false, secretos: a.secretosDe(config) });
    visto.fallarWebhook = 1;
    let r = await a.vuelta(config, { hacer: fetchDePrueba, esperar: sinEsperar, registrar: (m, o) => (registro.push(m), registrar(m, o)) });
    ok(!r.ok && /127\.0\.0\.1:\d+: No lo aceptó \(422\): producto inválido/.test(r.error), "un 422 con su motivo", r.error);
    ok(visto.avisos.length === 1 && /tiene un error/.test(visto.avisos[0].text) && /Saint \(Caja 2\)/.test(visto.avisos[0].text), "avisa a Slack con quién y qué pasó", JSON.stringify(visto.avisos));
    visto.fallarWebhook = 1;
    r = await a.vuelta(config, { forzar: true, hacer: fetchDePrueba, esperar: sinEsperar, registrar: () => {} });
    ok(visto.avisos.length === 1, "el mismo error otra vez: no repite el aviso");
    r = await a.vuelta(config, { forzar: true, hacer: fetchDePrueba, esperar: sinEsperar, registrar: () => {} });
    ok(r.ok && visto.avisos.length === 2 && /volvió a funcionar/.test(visto.avisos[1].text), "cuando vuelve: «volvió a funcionar»");
    const log = fs.readFileSync(path.join(carpeta, "abierto.log"), "utf8");
    ok(!log.includes("abcdefghijklmnop") && !log.includes(LLAVE_API) && !log.includes(FIRMA), "ni la dirección de Slack, ni la clave, ni la firma salen en el registro");
    const malo = a.completarConfig({ ...configWebhook({ cabeceras: { "X-Api-Key": "otra" } }) }, carpeta);
    r = await a.vuelta(malo, { forzar: true, esperar: sinEsperar, registrar: () => {} });
    ok(/no aceptó la clave o la firma.*Unauthorized/.test(r.error), "una clave mala: lo dice así, con lo que contestó la plataforma", r.error);
  }

  titulo("a una CARPETA: un archivo limpio, completo, siempre igual");
  {
    const salida = path.join(carpeta, "salida");
    const config = a.completarConfig({ agente: "pc-carpeta", origen: "Saint", fuente: { tipo: "archivo", ruta: archivoXlsx, hoja: "Stock" }, destinos: [{ tipo: "carpeta", carpeta: salida }, { tipo: "carpeta", carpeta: salida, formato: "json", archivo: "inventario.json" }] }, carpeta);
    const r = await a.vuelta(config, { forzar: true, esperar: sinEsperar, registrar: () => {} });
    const csv = fs.readFileSync(path.join(salida, "stock.csv"), "utf8");
    ok(r.ok && csv.startsWith("﻿codigo;producto;cantidad;precio") && csv.includes("Z-02;;0;"), "stock.csv con la marca para Excel y los encabezados de siempre", JSON.stringify(csv.slice(0, 120)));
    const json = JSON.parse(fs.readFileSync(path.join(salida, "inventario.json"), "utf8"));
    ok(json.total === 2 && json.productos[1].codigo === "Z-02", "y en JSON, con el nombre que se pida");
    ok(!fs.readdirSync(salida).some((n) => n.endsWith(".tmp")), "sin temporales: el que lee nunca ve un archivo a medias");
  }

  titulo("VARIOS destinos a la vez: si uno falla, los demás reciben");
  {
    const config = a.completarConfig(
      {
        agente: "pc-mixta",
        origen: "Saint",
        url: BASE,
        clave: CLAVE,
        fuente: { tipo: "archivo", ruta: archivoXlsx, hoja: "Stock" },
        destinos: [{ tipo: "alpha" }, { tipo: "webhook", url: `${BASE}/recibir`, cabeceras: { "X-Api-Key": LLAVE_API } }, { tipo: "carpeta", carpeta: path.join(carpeta, "mixta") }],
      },
      carpeta
    );
    ok(a.listaDeDestinos(config).map((d) => d.tipo).join() === "alpha,webhook,carpeta", "tres destinos (la tienda ALPHA IA toma la url y la clave de arriba)");
    fs.rmSync(path.join(carpeta, "estado-puente.json"), { force: true });
    visto.fallarWebhook = 1;
    const antes = visto.alpha.length;
    const r = await a.vuelta(config, { esperar: sinEsperar, registrar: () => {} });
    ok(!r.ok && r.resultados.map((x) => x.ok).join() === "true,false,true", "la plataforma falla; la tienda y la carpeta reciben igual", JSON.stringify(r.resultados.map((x) => [x.destino.tipo, x.ok, x.mensaje])));
    ok(visto.alpha.length === antes + 1 && visto.alpha.at(-1).csv.startsWith("codigo;producto;cantidad;precio"), "a la tienda ALPHA IA le llega el CSV con sus encabezados de siempre", visto.alpha.at(-1)?.csv);
    const l = visto.latidos.filter((x) => x.agente === "pc-mixta").at(-1);
    ok(l.estado === "ok" && l.ciclo === true, "y su latido dice «ok» (su parte salió bien)", JSON.stringify(l));
    ok(/127\.0\.0\.1:\d+: .*422/.test(r.error), "el error dice cuál destino falló", r.error);
    ok(fs.existsSync(path.join(carpeta, "mixta", "stock.csv")), "la carpeta tiene su archivo");
  }

  titulo("--probar y --doctor con otras plataformas: sin mandar nada");
  {
    const antes = visto.webhook.length;
    const texto = await a.probar(configWebhook({ lote: 1 }), { esperar: sinEsperar });
    ok(/mandaría 2 productos a 127\.0\.0\.1:\d+ en 2 partes/.test(texto) && /"codigo":"Z-01"/.test(texto) && visto.webhook.length === antes, "--probar dice qué mandaría y enseña el primero, sin mandar", texto);
    ok(!texto.includes(LLAVE_API) && !texto.includes(FIRMA), "sin las claves");
    const r = await a.doctor(configWebhook(), { esperar: sinEsperar, ejecutar: async () => ({ codigo: 0 }), plataforma: "win32" });
    ok(r.every((x) => x.ok !== false) && visto.webhook.length === antes, "el doctor revisa la plataforma sin mandarle datos", a.textoDelDoctor(r));
    ok(r.some((x) => /Se entienden las columnas/.test(x.nombre) && /cantidad ← «Existencia»/.test(x.detalle)), "y dice cómo entendió cada columna");
    ok(r.some((x) => /Fotos/.test(x.nombre) && /Sin foto/.test(x.detalle)), "y si el sistema no trae fotos, dice dónde se suben");
    const sinDestino = a.problemasDeConfig(a.completarConfig({ fuente: { tipo: "archivo", ruta: "x" } }, carpeta));
    ok(sinDestino.some((p) => /a dónde mandar/.test(p)), "sin ningún destino: lo dice");
    const raro = a.problemasDeConfig(a.completarConfig({ fuente: { tipo: "archivo", ruta: "x" }, destinos: [{ tipo: "webhook", url: "http://sin-cifrar.com" }, { tipo: "ftp" }] }, carpeta));
    ok(raro.some((p) => /https/.test(p)) && raro.some((p) => /«ftp» no es un destino/.test(p)), "un webhook sin https y un destino que no existe: lo dice", raro.join(" | "));
  }

  titulo("--configurar para otra plataforma y para una carpeta");
  {
    const ruta = path.join(carpeta, "config-web.json");
    let respuestas = ["2", `${BASE}/recibir`, "json", "X-Api-Key", "${ENV:PRUEBA_LLAVE_API}", "", "Saint", "Caja 2", "1", archivoXlsx, "Stock", "0", "s", "15", SLACK];
    await a.configurar({ ruta, preguntar: async () => respuestas.shift() ?? "", escribir: () => {} });
    let c = JSON.parse(fs.readFileSync(ruta, "utf8"));
    ok(c.destinos?.[0]?.tipo === "webhook" && c.destinos[0].cabeceras["X-Api-Key"] === "${ENV:PRUEBA_LLAVE_API}" && !c.url, "webhook: su dirección y su cabecera (con la variable, no la clave)", JSON.stringify(c));
    ok(c.avisos?.webhook === SLACK && c.avisos.formato === "slack", "y a dónde avisar si falla", JSON.stringify(c));
    ok(c.fuente.hoja === "Stock", "de un Excel pregunta la hoja");
    ok(!a.problemasDeConfig(a.completarConfig(c, carpeta)).length, "y queda lista para usar", a.problemasDeConfig(a.completarConfig(c, carpeta)).join(" | "));
    respuestas = ["3", path.join(carpeta, "para-drive"), "csv", "Saint", "PC", "2", path.join(carpeta, "exportes"), "stock_*.csv", "0", "n", "Código", "", "", "-", "", "", "30", ""];
    fs.writeFileSync(path.join(carpeta, "exportes", "stock_20261016.csv"), "Código;Producto;Existencia;Precio\nN;Nuevo;5;9\n");
    const ruta2 = path.join(carpeta, "config-carpeta.json");
    await a.configurar({ ruta: ruta2, preguntar: async () => respuestas.shift() ?? "", escribir: () => {} });
    c = JSON.parse(fs.readFileSync(ruta2, "utf8"));
    ok(c.destinos[0].tipo === "carpeta" && c.fuente.tipo === "carpeta" && c.fuente.patron === "stock_*.csv" && c.cadaMinutos === 30, "carpeta → carpeta, con su patrón", JSON.stringify(c));
    ok(c.columnas?.cantidad === "Código" && c.columnas?.precio === "", "si las columnas no están bien, se corrigen ahí mismo («-» = no usarla)", JSON.stringify(c.columnas));
  }
} finally {
  servidor.close();
  fs.rmSync(carpeta, { recursive: true, force: true });
}

console.log(`\n${pasadas} bien, ${fallos} mal.`);
process.exitCode = fallos ? 1 : 0;
