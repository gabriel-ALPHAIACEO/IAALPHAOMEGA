// PAGAR EN LA TIENDA WEB CON COMPROBANTE (12-oct-2026, pedido del dueño:
// "dentro de esta página vamos a colocar los pagos").
//
// QUÉ SE PROTEGE.
//   · El cliente elige un método que la tienda cargó (con sus datos), sube
//     el comprobante y el pedido queda "por revisar". La web NO toca el stock.
//   · Los precios y el total los pone el servidor, no el navegador.
//   · Solo se acepta una foto o un PDF de verdad (por sus bytes), con tope de
//     tamaño, y unos pocos pedidos por hora desde la misma conexión.
//   · El cliente ve su pedido solo con su clave del enlace.
//   · En el panel: aprobar anota la venta (ahí baja el stock), y no dos veces;
//     rechazar pide motivo (el cliente lo ve); si el stock no alcanza, avisa
//     y el pedido sigue por revisar. El comprobante se ve solo con sesión, y
//     en una caja de arena (no corre nada de lo que suba un desconocido).
//   · Los métodos de pago y la tasa se escriben en el panel.

import { prepararSrc, baseDeMentira, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const inv = await src.cargar("inventario.js");
const web = await src.cargar("catalogo-web.js");
const ped = await src.cargar("pedidos-web.js");
const { atenderPanel } = await src.cargar("panel.js");
const { DB, sql } = baseDeMentira();
const [sede] = await inv.sedes(DB);

const idDe = (r) => r?.id ?? r;
async function crear(titulo, { precio, tallas = [["única", null]] } = {}) {
  const id = idDe(await inv.guardarProducto(DB, { titulo, origen: "manual", origen_id: titulo, precio }));
  const v = {};
  for (const [opcion, cantidad] of tallas) {
    v[opcion] = idDe(await inv.guardarVariante(DB, id, { opcion }));
    if (cantidad != null) await inv.ajustarStock(DB, { varianteId: v[opcion], sedeId: sede.id, cantidad });
  }
  return { id, v };
}
const af1 = await crear("Nike Air Force One blanca", { precio: 85, tallas: [["40", 2], ["41", 0], ["42", null]] });
const samba = await crear("Adidas Samba negra", { precio: 75, tallas: [["única", 3]] });
const sinPrecio = await crear("Bolso sin precio", { precio: null, tallas: [["única", 4]] });
const stock = (v) => Number(sql.prepare("SELECT COALESCE(SUM(cantidad), 0) AS n FROM inv_stock WHERE variante_id = ?").get(v).n);

const env = { DB, WHATSAPP: "+584141234567", TIENDA_NOMBRE: "Prueba", PANEL_CLAVE: "clave-de-prueba" };
const GET = async (ruta, e = env) => {
  const r = await web.atenderCatalogoWeb(new Request(`https://t.test${ruta}`), e, { tienda: "Prueba", rubro: "calzado" });
  return r ? { estado: r.status, html: await r.text() } : null;
};

const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, ...new Array(200).fill(7)]);
const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF");
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
const HTML = new TextEncoder().encode("<html><script>alert(1)</script></html>");

let ip = 10;
async function enviar(campos = {}, archivo = { bytes: JPG, nombre: "captura.jpg", tipo: "image/jpeg" }, { desde = `10.0.0.${ip++}` } = {}) {
  const fd = new FormData();
  const base = { cliente: "María Pérez", telefono: "0414-555.12.34", entrega: "retiro", metodo: "Pago Móvil", carrito: `${samba.v["única"]}x1`, referencia: "001234" };
  for (const [k, v] of Object.entries({ ...base, ...campos })) if (v !== undefined) fd.set(k, v);
  if (archivo) fd.set("comprobante", new File([archivo.bytes], archivo.nombre, { type: archivo.tipo }));
  const r = await web.atenderCatalogoWeb(new Request("https://t.test/tienda/api/pedido", { method: "POST", body: fd, headers: { "cf-connecting-ip": desde } }), env, { tienda: "Prueba", rubro: "calzado" });
  return { estado: r.status, j: await r.json() };
}

// ───────────────────────────────────────────────────────────────────────
titulo("sin métodos cargados, la web sigue con WhatsApp");
let c = await GET("/tienda/pagar");
ok(c.estado === 200 && /Los pedidos van por WhatsApp/.test(c.html), "/tienda/pagar dice que los pedidos van por WhatsApp");
let api = JSON.parse((await GET(`/tienda/api/carrito?v=${samba.v["única"]}x1`)).html);
ok(api.pago === false, "y el carrito no ofrece «Pagar aquí»");
let r = await enviar();
ok(r.estado === 400 && /Elige cómo vas a pagar/.test(r.j.error), "un pedido sin métodos cargados no entra", r.j.error);
const metodosDePartida = (await ped.leerPagos(DB)).metodos.map((m) => m.nombre).join(", ");
ok(/Pago Móvil/.test(metodosDePartida) && /Transferencia/.test(metodosDePartida) && /Zelle/.test(metodosDePartida) && /Zinli/.test(metodosDePartida), "los métodos que nombró el dueño ya están, vacíos", metodosDePartida);

titulo("el dueño escribe los datos de pago en el panel");
await ped.guardarPagos(DB, {
  metodos: [
    { nombre: "Pago Móvil", moneda: "bs", datos: "Banesco 0134\nTel: 0414-1234567\nC.I.: V-12.345.678 <b>", activo: true },
    { nombre: "Zelle", moneda: "usd", datos: "pagos@tienda.com", activo: true },
    { nombre: "Zinli", moneda: "usd", datos: "", activo: true },
    { nombre: "Binance (USDT)", moneda: "usd", datos: "Pay ID 999", activo: false },
  ],
  tasa: "36,5",
});
const pagos = await ped.leerPagos(DB);
ok(pagos.tasa === 36.5 && pagos.tasaFecha > 0, "la tasa «36,5» se guarda como 36.5", String(pagos.tasa));
ok(ped.metodosVisibles(pagos).map((m) => m.nombre).join() === "Pago Móvil,Zelle", "solo se ofrecen los que tienen datos y están encendidos");
let error = "";
try {
  await ped.guardarPagos(DB, { metodos: [{ nombre: "Zelle", datos: "a" }, { nombre: "zelle", datos: "b" }] });
} catch (e) {
  error = e.message;
}
ok(/dos veces/.test(error), "un método repetido no se guarda", error);
error = "";
try {
  await ped.guardarPagos(DB, { metodos: pagos.metodos, tasa: "mucho" });
} catch (e) {
  error = e.message;
}
ok(/tasa/.test(error), "una tasa que no es número no se guarda", error);

c = await GET("/tienda/pagar");
ok(/Pago Móvil/.test(c.html) && /Zelle/.test(c.html) && !/value="Zinli"/.test(c.html) && !/Binance/.test(c.html), "la página de pago enseña Pago Móvil y Zelle (no Zinli sin datos, ni Binance apagado)");
ok(/C\.I\.: V-12\.345\.678 &lt;b&gt;/.test(c.html), "los datos salen tal cual (y escapados)");
ok(/data-tasa="36\.5"/.test(c.html) && /type="file" name="comprobante"/.test(c.html), "con la tasa para los bolívares y el campo del comprobante");
api = JSON.parse((await GET(`/tienda/api/carrito?v=${samba.v["única"]}x1`)).html);
ok(api.pago === true, "ahora el carrito ofrece «Pagar aquí»");
ok(/data-pagar href="\/tienda\/pagar"/.test((await GET("/tienda/carrito")).html), "el carrito trae el botón «Pagar aquí»");

// ───────────────────────────────────────────────────────────────────────
titulo("el cliente paga y sube el comprobante");
r = await enviar({ carrito: `${af1.v["40"]}x1,${samba.v["única"]}x2,precio=1`, cedula: "V-12.345.678" });
ok(r.estado === 200 && r.j.ok && /^P-[A-Z0-9]{6}$/.test(r.j.codigo), "el pedido entra con su código", JSON.stringify(r.j));
ok(new RegExp(`^/tienda/pedido/${r.j.codigo}\\?t=[0-9a-f]{32}$`).test(r.j.url), "y con el enlace (con clave) para ver cómo va", r.j.url);
const fila = sql.prepare("SELECT * FROM web_pedidos WHERE codigo = ?").get(r.j.codigo);
ok(fila.estado === "revisar" && fila.total === 235 && fila.total_bs === 8577.5, "por revisar, total 235 $ calculado por el servidor y 8577,50 Bs a 36,5", `${fila.total} / ${fila.total_bs}`);
ok(fila.telefono === "0414555.12.34".replace(/\./g, "") || /^0414/.test(fila.telefono), "el teléfono se guarda limpio", fila.telefono);
ok(sql.prepare("SELECT tipo FROM web_comprobantes WHERE pedido_id = ?").get(fila.id).tipo === "image/jpeg", "el comprobante se guarda (JPG)");
ok(stock(af1.v["40"]) === 2 && stock(samba.v["única"]) === 3, "el stock NO se toca al pedir (solo al aprobar)");
const pedidoUno = r.j;

c = await GET(pedidoUno.url);
ok(c.estado === 200 && /Recibimos tu pago/.test(c.html) && c.html.includes(pedidoUno.codigo) && /Bs 8\.577,50/.test(c.html), "con su clave, el cliente ve su pedido «Recibimos tu pago» y el monto en Bs");
ok(/noindex/.test(c.html), "esa página no sale en Google");
ok((await GET(`/tienda/pedido/${pedidoUno.codigo}`)).estado === 404 && (await GET(`/tienda/pedido/${pedidoUno.codigo}?t=${"0".repeat(32)}`)).estado === 404, "sin la clave, o con otra, no se ve nada");

r = await enviar({ metodo: "Zelle" }, { bytes: PDF, nombre: "pago.pdf", tipo: "application/pdf" });
ok(r.j.ok && sql.prepare("SELECT c.tipo, p.total_bs FROM web_comprobantes c JOIN web_pedidos p ON p.id = c.pedido_id WHERE p.codigo = ?").get(r.j.codigo).tipo === "application/pdf", "un PDF también vale (y en Zelle no hay monto en Bs)");

titulo("lo que no entra");
r = await enviar({}, null);
ok(r.estado === 400 && /Sube la foto o el PDF/.test(r.j.error), "sin comprobante", r.j.error);
r = await enviar({}, { bytes: SVG, nombre: "pago.jpg", tipo: "image/jpeg" });
ok(r.estado === 400 && /foto \(JPG, PNG\) o un PDF/.test(r.j.error), "un SVG con nombre de .jpg no pasa (se miran los bytes)", r.j.error);
r = await enviar({}, { bytes: HTML, nombre: "pago.png", tipo: "image/png" });
ok(r.estado === 400, "una página HTML disfrazada tampoco");
r = await enviar({}, { bytes: new Uint8Array([0xff, 0xd8, 0xff, ...new Array(1_300_000).fill(1)]), nombre: "enorme.jpg", tipo: "image/jpeg" });
ok(r.estado === 413, "un archivo de más de 1,2 MB no entra", r.j.error);
r = await enviar({ carrito: `${af1.v["41"]}x1` });
ok(r.estado === 400 && /se agotó/.test(r.j.error), "una talla agotada no se paga", r.j.error);
r = await enviar({ carrito: `${af1.v["40"]}x3` });
ok(r.estado === 400 && /solo quedan 2/.test(r.j.error), "más de lo que hay, tampoco", r.j.error);
r = await enviar({ carrito: `${af1.v["42"]}x5` });
ok(r.j.ok, "una talla sin contar sí (como en el bot y en la web)");
r = await enviar({ carrito: `${sinPrecio.v["única"]}x1` });
ok(r.estado === 400 && /no tiene precio/.test(r.j.error), "un producto sin precio se pide por WhatsApp", r.j.error);
r = await enviar({ carrito: "" });
ok(r.estado === 400 && /vacío/.test(r.j.error), "un carrito vacío no");
r = await enviar({ entrega: "envio", direccion: "" });
ok(r.estado === 400 && /dirección/.test(r.j.error), "envío sin dirección no", r.j.error);
r = await enviar({ metodo: "Zinli" });
ok(r.estado === 400 && /Elige cómo vas a pagar/.test(r.j.error), "un método sin datos (Zinli) no se puede elegir a mano");
r = await enviar({ cliente: "A" });
ok(r.estado === 400 && /nombre/.test(r.j.error), "sin nombre no");
const muchos = [];
for (let i = 0; i < 6; i++) muchos.push((await enviar({}, undefined, { desde: "203.0.113.9" })).estado);
ok(muchos.slice(0, 5).every((e) => e === 200) && muchos[5] === 429, "más de 5 pedidos en una hora desde la misma conexión: se frena", muchos.join(","));
ok((await GET("/tienda/api/pedido")).estado === 405, "/api/pedido solo por POST");
const otroPost = await web.atenderCatalogoWeb(new Request("https://t.test/tienda/carrito", { method: "POST", body: "x" }), env, { tienda: "Prueba" });
ok(otroPost === null, "ningún otro POST lo atiende la web");

// ───────────────────────────────────────────────────────────────────────
titulo("en el panel: aprobar anota la venta, rechazar pide motivo");
const datosEntrada = new FormData();
datosEntrada.set("clave", "clave-de-prueba");
const galleta = (await atenderPanel(new Request("https://t.test/panel/entrar", { method: "POST", body: datosEntrada }), env, { tienda: "Prueba" })).headers.get("set-cookie") || "";
const cookie = galleta.split(";")[0];
const panel = (ruta, init = {}) => atenderPanel(new Request(`https://t.test${ruta}`, { ...init, headers: { cookie, "sec-fetch-site": "same-origin", ...(init.headers || {}) } }), env, { tienda: "Prueba" });
const postPanel = (ruta, campos) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return panel(ruta, { method: "POST", body: fd });
};

let html = await (await panel("/panel/pedidos")).text();
ok(html.includes(pedidoUno.codigo) && /Aprobar y anotar la venta/.test(html) && /Rechazar/.test(html), "la lista «Por revisar» trae el pedido con sus botones");
ok(new RegExp(`/panel/pedidos/${fila.id}/comprobante`).test(html) && /María Pérez/.test(html) && /0414/.test(html), "con la foto del comprobante, el cliente y su teléfono");
ok(/href="\/panel\/pedidos"/.test(html) && /Pedidos web/.test(html), "y «Pedidos web» está en el menú");
const comp = await panel(`/panel/pedidos/${fila.id}/comprobante`);
ok(comp.status === 200 && comp.headers.get("content-type") === "image/jpeg" && /sandbox/.test(comp.headers.get("content-security-policy") || ""), "el comprobante se ve, en caja de arena");
ok((await comp.arrayBuffer()).byteLength === JPG.length, "y es el mismo archivo que subió");
const sinSesion = await atenderPanel(new Request(`https://t.test/panel/pedidos/${fila.id}/comprobante`), env, { tienda: "Prueba" });
ok(sinSesion.headers.get("content-type") !== "image/jpeg", "sin sesión, el comprobante no se ve");

let rr = await postPanel("/panel/pedidos/aprobar", { id: fila.id, quien: "Ana" });
ok(rr.status === 303 && /ok=/.test(rr.headers.get("location")), "aprobar", rr.headers.get("location"));
const aprobado = sql.prepare("SELECT estado, venta_id, quien FROM web_pedidos WHERE id = ?").get(fila.id);
ok(aprobado.estado === "aprobado" && aprobado.venta_id > 0 && aprobado.quien === "Ana", "queda aprobado, con su venta y quién lo aprobó");
ok(stock(af1.v["40"]) === 1 && stock(samba.v["única"]) === 1, "AHORA sí baja el stock (40: 2→1, Samba: 3→1)");
const venta = sql.prepare("SELECT metodo_pago, total, cliente, nota FROM inv_ventas WHERE id = ?").get(aprobado.venta_id);
ok(venta.metodo_pago === "Pago Móvil" && venta.total === 235 && venta.cliente === "María Pérez" && venta.nota.includes(pedidoUno.codigo), "la venta sale en Ventas con su método, el cliente y el código", JSON.stringify(venta));
rr = await postPanel("/panel/pedidos/aprobar", { id: fila.id });
ok(/error=/.test(rr.headers.get("location")) && sql.prepare("SELECT COUNT(*) AS n FROM inv_ventas").get().n === 1, "aprobarlo otra vez no anota otra venta");
ok(/Pago confirmado/.test((await GET(pedidoUno.url)).html), "el cliente ve «¡Pago confirmado!»");

const otro = (await enviar({ carrito: `${af1.v["40"]}x1` })).j;
const idOtro = sql.prepare("SELECT id FROM web_pedidos WHERE codigo = ?").get(otro.codigo).id;
rr = await postPanel("/panel/pedidos/rechazar", { id: idOtro, motivo: "" });
ok(/error=/.test(rr.headers.get("location")), "rechazar sin motivo no se puede");
rr = await postPanel("/panel/pedidos/rechazar", { id: idOtro, motivo: "El pago no llegó" });
ok(sql.prepare("SELECT estado, motivo FROM web_pedidos WHERE id = ?").get(idOtro).estado === "rechazado" && stock(af1.v["40"]) === 1, "rechazado, y el stock no se toca");
c = await GET(otro.url);
ok(/No pudimos confirmar tu pago/.test(c.html) && /El pago no llegó/.test(c.html), "el cliente ve el motivo");

titulo("si el stock ya no alcanza al aprobar");
const tarde = (await enviar({ carrito: `${samba.v["única"]}x1` })).j;
const idTarde = sql.prepare("SELECT id FROM web_pedidos WHERE codigo = ?").get(tarde.codigo).id;
await inv.ajustarStock(DB, { varianteId: samba.v["única"], sedeId: sede.id, cantidad: 0 });
rr = await postPanel("/panel/pedidos/aprobar", { id: idTarde });
ok(/error=/.test(rr.headers.get("location")) && /Corrige\+el\+stock|Corrige%20el%20stock/.test(rr.headers.get("location")), "avisa que no alcanza y qué hacer", decodeURIComponent(rr.headers.get("location")).slice(0, 160));
ok(sql.prepare("SELECT estado FROM web_pedidos WHERE id = ?").get(idTarde).estado === "revisar", "y el pedido sigue por revisar (no se queda a medias)");
rr = await postPanel("/panel/pedidos/aprobar", { id: idTarde, sinVenta: "1" });
const sinVenta = sql.prepare("SELECT estado, venta_id FROM web_pedidos WHERE id = ?").get(idTarde);
ok(sinVenta.estado === "aprobado" && sinVenta.venta_id === null && stock(samba.v["única"]) === 0, "«Aprobar sin anotar la venta»: aprobado, sin venta y sin tocar el stock");

titulo("los métodos de pago, desde el panel");
html = await (await panel("/panel/pedidos/pagos")).text();
ok(/name="m_nombre" value="Pago Móvil"/.test(html) && /name="tasa" value="36,5"/.test(html) && (html.match(/name="m_nombre"/g) || []).length === 6, "trae los métodos, la tasa y dos filas para añadir otros");
const fd = new FormData();
for (const [n, d, m, a] of [["Pago Móvil", "Banesco", "bs", true], ["Zelle", "z@t.com", "usd", false], ["PayPal", "p@t.com", "usd", true], ["", "", "usd", true]]) {
  fd.append("m_nombre", n);
  fd.append("m_datos", d);
  fd.append("m_moneda", m);
}
fd.append("m_activo", "0");
fd.append("m_activo", "2");
fd.append("tasa", "");
rr = await panel("/panel/pedidos/pagos", { method: "POST", body: fd });
const despues = await ped.leerPagos(DB);
ok(/ok=/.test(rr.headers.get("location")) && ped.metodosVisibles(despues).map((m) => m.nombre).join() === "Pago Móvil,PayPal" && despues.tasa === null, "se guardan: Zelle apagado, PayPal añadido, sin tasa", ped.metodosVisibles(despues).map((m) => m.nombre).join());
const fuera = await panel("/panel/pedidos/pagos", { method: "POST", body: fd, headers: { "sec-fetch-site": "cross-site" } });
ok(fuera.status === 403, "un formulario de otra página no puede cambiar los datos de pago");

titulo("con dominio propio (TIENDA_RAIZ)");
const raiz = await web.atenderCatalogoWeb(new Request("https://t.test/pagar"), { ...env, TIENDA_RAIZ: "si" }, { tienda: "Prueba" });
ok(raiz?.status === 200 && /Pagar tu pedido/.test(await raiz.text()), "/pagar también en la raíz");

terminar();
