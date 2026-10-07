// EL INVENTARIO Y LA CAJA (7-oct-2026): inventario.js y sus pantallas.
//
// Lo que no se puede romper:
//   · el stock nunca baja de 0, y una venta con un producto que no alcanza
//     no descuenta NADA (D1 hace el batch entero o nada; aquí también);
//   · cada talla recibe sola un EAN-13 válido, y la caja lo encuentra igual
//     que el código de fábrica;
//   · importar dos veces no duplica modelos ni stock;
//   · el Excel del sistema viejo se lee con ; o , y con encabezados en
//     español, y "solo probar" no guarda nada.

import { prepararSrc, baseDeMentira, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const inv = await src.cargar("inventario.js");
const { atenderPanel } = await src.cargar("panel.js");

// D1 de verdad hace el batch en una transacción. La base de mentira no:
// aquí se le pone, porque la regla de "todo o nada" depende de eso.
function baseConTransacciones() {
  const base = baseDeMentira();
  base.DB.batch = async (sentencias) => {
    base.sql.exec("BEGIN");
    try {
      const salida = [];
      for (const s of sentencias) salida.push(await s.run());
      base.sql.exec("COMMIT");
      return salida;
    } catch (error) {
      base.sql.exec("ROLLBACK");
      throw error;
    }
  };
  return base;
}

const { DB, sql } = baseConTransacciones();

titulo("códigos de barras");
ok(inv.codigoInterno(1) === "2000000000015", "la variante 1 es 2000000000015", inv.codigoInterno(1));
ok(inv.ean13Valido("7501031311309") && !inv.ean13Valido("7501031311308"), "valida el dígito de control");
ok(/<svg[\s\S]*<rect/.test(inv.svgEan13(inv.codigoInterno(7))), "pinta el código como SVG");

titulo("modelos, tallas y sedes");
const [principal] = await inv.sedes(DB);
ok(principal?.nombre === "Principal", "nace con una sede Principal");
await inv.crearSede(DB, "Sambil");
const lasSedes = await inv.sedes(DB);
const sambil = lasSedes.find((s) => s.nombre === "Sambil");
ok(lasSedes.length === 2, "se añade una sede");
ok(JSON.stringify(inv.leerOpciones("40-42")) === '["40","41","42"]', "40-42 son tres tallas");
ok(JSON.stringify(inv.leerOpciones("")) === '["única"]', "sin tallas queda una variante única (Invictus)");
const zapato = await inv.guardarProducto(DB, { origen: "manual", titulo: "Jordan 4 Negro", precio: "$45" });
const tallas = [];
for (const o of inv.leerOpciones("40-42")) tallas.push(await inv.guardarVariante(DB, zapato, { opcion: o }));
const p = await inv.verProducto(DB, zapato);
ok(p.variantes.length === 3 && p.variantes.every((v) => inv.ean13Valido(v.codigo_barras)), "cada talla con su EAN-13 válido");
ok((await inv.guardarVariante(DB, zapato, { opcion: "41" })) === tallas[1], "la misma talla no se duplica");

titulo("stock y movimientos");
ok((await inv.moverStock(DB, { varianteId: tallas[0], sedeId: principal.id, tipo: "entrada", cantidad: 2, quien: "Ana" })) === 2, "entran 2");
let error = null;
try {
  await inv.moverStock(DB, { varianteId: tallas[0], sedeId: principal.id, tipo: "venta", cantidad: 3 });
} catch (e) {
  error = e;
}
ok(error?.name === "SinStock", "no se vende más de lo que hay", error?.message);
ok((await inv.verVariante(DB, tallas[0])).porSede[principal.id] === 2, "y el stock sigue en 2");
ok((await inv.ajustarStock(DB, { varianteId: tallas[1], sedeId: sambil.id, cantidad: 5, quien: "Luis" })) === 5, "ajustar pone la cantidad contada");
const movs = await inv.movimientosRecientes(DB, { productoId: zapato });
ok(movs.length === 2 && movs[0].queda === 5 && movs[0].quien === "Luis", "cada cambio queda con quién y cuánto quedó");

titulo("la caja");
const buscado = await inv.buscarPorCodigo(DB, p.variantes[0].codigo_barras);
ok(buscado?.id === tallas[0] && buscado.precioFinal === 45, "el lector encuentra la talla y su precio");
await inv.guardarVariante(DB, zapato, { opcion: "43", codigo_fabricante: "7501031311309" });
ok((await inv.buscarPorCodigo(DB, " 7501031311309\n"))?.opcion === "43", "y también por el código de fábrica");
const venta = await inv.cobrar(DB, { sedeId: principal.id, quien: "Ana", metodoPago: "Pago móvil", items: [{ varianteId: tallas[0], cantidad: 2 }] });
ok(venta.total === 90 && venta.unidades === 2, "cobra 2 × $45 = $90", JSON.stringify(venta));
ok((await inv.verVariante(DB, tallas[0])).porSede[principal.id] === 0, "y descuenta");
const antes = (await inv.verVariante(DB, tallas[1])).porSede[sambil.id];
error = null;
try {
  await inv.cobrar(DB, { sedeId: sambil.id, items: [{ varianteId: tallas[1], cantidad: 1 }, { varianteId: tallas[2], cantidad: 1 }] });
} catch (e) {
  error = e;
}
ok(error?.name === "SinStock" && /42/.test(error.message), "si una talla no alcanza, dice cuál", error?.message);
ok((await inv.verVariante(DB, tallas[1])).porSede[sambil.id] === antes, "y no descuenta ninguna");
ok(sql.prepare("SELECT COUNT(*) AS n FROM inv_ventas").get().n === 1, "ni deja una venta a medias");
// La red de verdad: aunque la revisión previa se saltara, el CHECK y el
// batch impiden el negativo.
error = null;
try {
  await DB.batch([
    DB.prepare("UPDATE inv_stock SET cantidad = cantidad - 1 WHERE variante_id = ? AND local_id = ?").bind(tallas[1], sambil.id),
    DB.prepare("UPDATE inv_stock SET cantidad = cantidad - 99 WHERE variante_id = ? AND local_id = ?").bind(tallas[1], sambil.id),
  ]);
} catch (e) {
  error = e;
}
ok(error && (await inv.verVariante(DB, tallas[1])).porSede[sambil.id] === antes, "la base nunca queda en negativo");

titulo("importar el catálogo");
const catalogo = [
  { origen: "sheets", origen_id: "fila-2", titulo: "iPhone 13", precio: 420, precio_cashea: 470, fotos: ["https://x/1.jpg"], variantes: [{ opcion: "128GB", cantidad: 3 }] },
  { origen: "shopify", origen_id: "99", titulo: "Air Force 1", precio: "60 USD" },
];
let informe = await inv.importarCatalogo(DB, catalogo, { sedeId: principal.id, quien: "catálogo" });
ok(informe.modelos === 2 && informe.conStock === 1, "trae los modelos y carga el stock que traen", JSON.stringify(informe));
informe = await inv.importarCatalogo(DB, catalogo, { sedeId: principal.id });
ok(informe.conStock === 0 && (await inv.contarProductos(DB)).modelos === 3, "otra vez no duplica nada");
const iphone = (await inv.listarProductos(DB, { q: "iphone" }))[0];
ok(iphone?.total === 3 && iphone.foto === "https://x/1.jpg", "con su foto y su stock");

titulo("el Excel del sistema viejo");
const csv = "Código;Descripción;Talla;Cantidad;Precio\n7790000000017;Bolso Gucci;;4;35,50\n;Gorra NY;;2;\n;;;;\n";
informe = await inv.importarCsv(DB, csv, { sedeId: principal.id, aplicar: false });
ok(informe.filas >= 2 && (await inv.contarProductos(DB)).modelos === 3, "solo probar no guarda nada", JSON.stringify(informe));
informe = await inv.importarCsv(DB, csv, { sedeId: principal.id, quien: "Excel" });
const bolso = await inv.buscarPorCodigo(DB, "7790000000017");
ok(bolso?.titulo === "Bolso Gucci" && bolso.porSede[principal.id] === 4 && bolso.precioFinal === 35.5, "lee ; y coma decimal, y el código viejo pasa en caja", JSON.stringify(informe));
const filas = await inv.filasParaExportar(DB);
ok(filas.some((f) => f.titulo === "Gorra NY" && f.cantidad === 2), "y sale en el Excel de vuelta");

titulo("las pantallas del panel");
const ENV = { DB, PANEL_CLAVE: "clave-de-prueba", TIENDA_NOMBRE: "Prueba" };
const entrar = new FormData();
entrar.set("clave", "clave-de-prueba");
const r0 = await atenderPanel(new Request("https://bot.test/panel/entrar", { method: "POST", body: entrar }), ENV, { tienda: "Prueba" });
const cookie = (r0.headers.get("set-cookie") || "").split(";")[0];
const traido = [];
const opciones = { tienda: "Prueba", traerCatalogo: async () => (traido.push(1), [{ origen: "shopify", origen_id: "100", titulo: "Yeezy 350" }]) };
const pedir = (ruta, init = {}) => atenderPanel(new Request(`https://bot.test${ruta}`, { ...init, headers: { cookie, "sec-fetch-site": "same-origin", ...(init.headers || {}) } }), ENV, opciones);

let r = await pedir("/panel/inventario");
let html = await r.text();
ok(r.status === 200 && /Jordan 4 Negro/.test(html) && /href="\/panel\/caja"/.test(html), "la lista de modelos, con la caja en el menú");
r = await atenderPanel(new Request("https://bot.test/panel/inventario"), ENV, opciones);
ok(!/Jordan/.test(await r.text()), "sin sesión no se ve el inventario");
html = await (await pedir(`/panel/inventario/p/${zapato}`)).text();
ok(/<svg/.test(html) && /Entrada/.test(html) && /Ajustar/.test(html), "el modelo con códigos y botones");
const mover = new FormData();
Object.entries({ variante: tallas[2], sede: principal.id, cantidad: 4, tipo: "entrada", quien: "Ana", volver: `/panel/inventario/p/${zapato}` }).forEach(([k, v]) => mover.set(k, String(v)));
r = await pedir("/panel/inventario/mover", { method: "POST", body: mover });
ok(r.status === 303 && /Quedan%204/.test(r.headers.get("location")), "Entrada desde el panel", r.headers.get("location"));
r = await pedir("/panel/inventario/mover", { method: "POST", body: mover, headers: { "sec-fetch-site": "cross-site" } });
ok(r.status === 403, "otra web no puede mover stock");
const fuera = new FormData();
Object.entries({ variante: tallas[2], sede: principal.id, cantidad: 1, tipo: "entrada", volver: "https://malo.com" }).forEach(([k, v]) => fuera.set(k, String(v)));
r = await pedir("/panel/inventario/mover", { method: "POST", body: fuera });
ok(r.headers.get("location").startsWith("/panel/inventario"), "volver solo lleva dentro del panel");
r = await pedir(`/panel/caja/buscar?q=${p.variantes[2].codigo_barras}`);
const encontrado = await r.json();
ok(encontrado.variante?.id === tallas[2] && encontrado.variante.porSede[principal.id] === 5, "la caja busca por código", JSON.stringify(encontrado));
ok((await (await pedir("/panel/caja/buscar?q=jordan")).json()).opciones?.length >= 3, "y por nombre ofrece las tallas");
r = await pedir("/panel/caja/cobrar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sede: principal.id, quien: "Ana", metodo: "Zelle", items: [{ variante: tallas[2], cantidad: 9 }] }) });
ok(r.status === 409 && !(await r.json()).ok, "cobrar de más responde que no alcanza");
r = await pedir("/panel/caja/cobrar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sede: principal.id, quien: "Ana", metodo: "Zelle", items: [{ variante: tallas[2], cantidad: 1 }] }) });
const cobro = await r.json();
ok(cobro.ok && cobro.unidades === 1, "cobrar desde la caja", JSON.stringify(cobro));
html = await (await pedir(`/panel/inventario/etiquetas?producto=${zapato}&formato=termica&n=2`)).text();
ok(html.startsWith("<!doctype") && (html.match(/class="etq"/g) || []).length === 8, "etiquetas: 4 tallas × 2 copias, en página para imprimir");
r = await pedir("/panel/inventario.csv");
ok(/text\/csv/.test(r.headers.get("content-type")) && /Jordan 4 Negro/.test(await r.text()), "el inventario baja a Excel");
const sub = new FormData();
sub.set("sede", String(principal.id));
r = await pedir("/panel/inventario/importar/catalogo", { method: "POST", body: sub });
ok(traido.length === 1 && /Yeezy/.test(await (await pedir("/panel/inventario?q=yeezy")).text()), "Traer del catálogo usa el de la tienda");
const archivo = new FormData();
archivo.set("archivo", new File(["producto,cantidad\nChancla Nike,7\n"], "stock.csv", { type: "text/csv" }));
archivo.set("sede", String(principal.id));
archivo.set("probar", "si");
html = await (await pedir("/panel/inventario/importar/csv", { method: "POST", body: archivo })).text();
ok(/Fue una prueba/.test(html) && !(await inv.listarProductos(DB, { q: "Chancla" })).length, "subir CSV en prueba no guarda");
for (const ruta of ["/panel/inventario/importar", "/panel/inventario/sedes", "/panel/inventario/movimientos", "/panel/inventario/nuevo", "/panel/caja", "/panel/inventario/etiquetas"]) {
  const x = await pedir(ruta);
  ok(x.status === 200, `${ruta} abre`);
}

titulo("la app instalable (programa propio)");
const sinSesion = (ruta) => atenderPanel(new Request(`https://bot.test${ruta}`), ENV, opciones);
r = await sinSesion("/panel/app.webmanifest");
const manifiesto = await r.json();
ok(/manifest\+json/.test(r.headers.get("content-type")) && manifiesto.display === "standalone" && manifiesto.scope === "/panel", "el manifiesto se sirve sin sesión, en ventana propia", JSON.stringify({ d: manifiesto.display, s: manifiesto.scope }));
ok(manifiesto.icons.some((i) => i.sizes === "512x512" && i.purpose === "maskable") && manifiesto.shortcuts.some((a) => a.url === "/panel/caja"), "con ícono 512 y atajo a la Caja");
r = await sinSesion("/panel/sw.js");
const sw = await r.text();
ok(r.headers.get("service-worker-allowed") === "/panel" && /javascript/.test(r.headers.get("content-type")), "el trabajador cuida todo /panel");
ok(/r\.method !== "GET"\) return/.test(sw) && /Sin internet/.test(sw), "nunca guarda ventas sin red: solo enseña 'Sin internet'");
r = await sinSesion("/panel/app-512.png");
const png = new Uint8Array(await r.arrayBuffer());
ok(r.headers.get("content-type") === "image/png" && png[16] === 0 && png[18] === 2 && png[19] === 0, "el ícono es un PNG de 512×512");
html = await (await pedir("/panel/inventario")).text();
ok(/rel="manifest" href="\/panel\/app.webmanifest"/.test(html) && /id="instalar-app"/.test(html) && /serviceWorker\.register\("\/panel\/sw\.js"/.test(html), "cada página trae el manifiesto y el botón 📲 Instalar");
html = await (await sinSesion("/panel")).text();
ok(/rel="manifest"/.test(html) && /id="instalar-app"/.test(html), "también la pantalla de entrada (se puede instalar antes de poner la clave)");

src.limpiar();
terminar();
