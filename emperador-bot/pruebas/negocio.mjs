// EL NEGOCIO (7-oct-2026): gastos, fiados, ventas anuladas, el balance, la
// caja con Cashea, cada tienda con las palabras de su negocio y la sesión
// que se queda abierta. negocio.js, negocio-panel.js, inventario-panel.js
// y la parte de la sesión de panel.js.
//
// Lo que no se puede romper:
//   · anular una venta devuelve el stock y la saca del balance (no se borra);
//   · un abono no puede ser mayor que lo que se debe, y se reparte de la
//     venta fiada más vieja a la más nueva;
//   · fiar sin el nombre del cliente no se puede;
//   · en la caja de EPICCELL se cobra el precio Cashea, salvo en divisas en
//     efectivo (regla del dueño, 7-oct);
//   · "Dejar la sesión abierta": sí = 90 días y se renueva sola; no = se
//     acaba al cerrar el navegador.

import { prepararSrc, baseDeMentira, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const inv = await src.cargar("inventario.js");
const neg = await src.cargar("negocio.js");
const { tarifaDeLaVenta } = await src.cargar("inventario-panel.js");
const { RUBROS, rubroDe } = await src.cargar("marco.js");
const { atenderPanel } = await src.cargar("panel.js");

// D1 hace cada batch en una transacción, y uno detrás de otro: aquí igual
// (la fila de espera es para que dos batch a la vez no se mezclen).
function baseConTransacciones() {
  const base = baseDeMentira();
  let fila = Promise.resolve();
  base.DB.batch = (sentencias) => {
    const turno = fila.then(async () => {
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
    });
    fila = turno.catch(() => {});
    return turno;
  };
  return base;
}

const { DB, sql } = baseConTransacciones();
const [sede] = await inv.sedes(DB);
const zapato = await inv.guardarProducto(DB, { origen: "manual", titulo: "Samba OG", precio: 50, costo: 30 });
const talla = await inv.guardarVariante(DB, zapato, { opcion: "40" });
await inv.ajustarStock(DB, { varianteId: talla, sedeId: sede.id, cantidad: 10, quien: "Carga", tipo: "carga" });
const hoy = () => neg.periodoDe(new URLSearchParams("dias=1"));

titulo("gastos");
ok((await neg.registrarGasto(DB, { categoria: "Transporte", monto: "15,50", descripcion: "Taxi" })) === 15.5, "un gasto con coma decimal");
let error = null;
try {
  await neg.registrarGasto(DB, { categoria: "Alquiler", monto: 0 });
} catch (e) {
  error = e;
}
ok(/mayor que cero/.test(error?.message || ""), "un gasto de 0 no se guarda", error?.message);
await neg.registrarGasto(DB, { categoria: "Inventada", monto: 5 });
let gastos = await neg.listarGastos(DB, { desde: 0, hasta: Date.now() + 1000 });
ok(gastos.some((g) => g.categoria === "Otros" && g.monto === 5), "una categoría que no existe queda en Otros");
await neg.borrarGasto(DB, gastos.find((g) => g.monto === 5).id);
gastos = await neg.listarGastos(DB, { desde: 0, hasta: Date.now() + 1000 });
ok(gastos.length === 1 && sql.prepare("SELECT COUNT(*) AS n FROM neg_gastos").get().n === 2, "borrar lo saca de la lista, pero queda marcado en la base");

titulo("ventas: con libres, fiadas y anuladas");
const v1 = await inv.cobrar(DB, { sedeId: sede.id, quien: "Ana", metodoPago: "Pago móvil", items: [{ varianteId: talla, cantidad: 1 }], libres: [{ descripcion: "Limpieza", precio: 8, cantidad: 2 }] });
ok(v1.total === 66 && v1.unidades === 3, "1 zapato de $50 + 2 limpiezas de $8 = $66", JSON.stringify(v1));
ok((await inv.verVariante(DB, talla)).porSede[sede.id] === 9, "lo libre no toca el stock");
error = null;
try {
  await inv.cobrar(DB, { sedeId: sede.id, items: [{ varianteId: talla, cantidad: 1 }], libres: [{ descripcion: "", precio: 5 }] });
} catch (e) {
  error = e;
}
ok(/descripción/.test(error?.message || "") && (await inv.verVariante(DB, talla)).porSede[sede.id] === 9, "un cobro libre sin descripción no deja cobrar nada", error?.message);
error = null;
try {
  await inv.cobrar(DB, { sedeId: sede.id, fiado: true, items: [{ varianteId: talla, cantidad: 1 }] });
} catch (e) {
  error = e;
}
ok(/nombre del cliente/.test(error?.message || ""), "fiar sin el nombre del cliente no se puede", error?.message);
const f1 = await inv.cobrar(DB, { sedeId: sede.id, fiado: true, cliente: "Luisa Gómez", telefono: "0414-555-1234", items: [{ varianteId: talla, cantidad: 1 }] });
const f2 = await inv.cobrar(DB, { sedeId: sede.id, fiado: true, cliente: "luisa gomez", telefono: "+58 414 555 1234", items: [{ varianteId: talla, cantidad: 2 }] });
let fiados = await neg.listarFiados(DB);
ok(fiados.length === 1 && fiados[0].saldo === 150 && fiados[0].ventas.length === 2, "las dos ventas fiadas de la misma persona son UN fiado de $150", JSON.stringify(fiados.map((f) => [f.cliente, f.saldo])));
error = null;
try {
  await neg.abonar(DB, { clave: fiados[0].clave, monto: 151 });
} catch (e) {
  error = e;
}
ok(/no puede ser mayor/.test(error?.message || ""), "no se abona más de lo que debe", error?.message);
const a = await neg.abonar(DB, { clave: fiados[0].clave, monto: 60, metodo: "Pago móvil", quien: "Ana" });
ok(a.queda === 90, "abona $60 y quedan $90", JSON.stringify(a));
const abonos = sql.prepare("SELECT venta_id, monto FROM neg_abonos ORDER BY id").all();
ok(abonos.length === 2 && abonos[0].venta_id === f1.ventaId && abonos[0].monto === 50 && abonos[1].monto === 10, "se paga primero la venta más vieja", JSON.stringify(abonos));
await neg.abonar(DB, { clave: fiados[0].clave, monto: 90 });
ok((await neg.listarFiados(DB)).length === 0 && (await neg.listarFiados(DB, { incluirPagados: true })).length === 1, "pagado todo, sale de la lista (y vuelve con «Incluir pagados»)");

let balance = await neg.resumen(DB, hoy());
ok(balance.ventas.cantidad === 3 && balance.ventas.total === 216 && balance.ventas.fiado === 150 && balance.ventas.contado === 66, "el balance: 3 ventas por $216, de ellas $150 fiadas", JSON.stringify(balance.ventas));
ok(balance.cobrado === 216 && balance.gastos.total === 15.5 && balance.balance === 200.5, "cobrado = contado + abonos, menos gastos", JSON.stringify([balance.cobrado, balance.gastos.total, balance.balance]));
ok(balance.ganancia.monto === 80 && balance.ganancia.cobertura === 100, "la ganancia sale del costo: 4 × ($50 − $30)", JSON.stringify(balance.ganancia));
const r1 = await inv.anularVenta(DB, v1.ventaId, { quien: "Ana", motivo: "se cobró dos veces" });
ok(r1.devueltas === 1 && (await inv.verVariante(DB, talla)).porSede[sede.id] === 7, "anular devuelve el zapato al stock", JSON.stringify(r1));
balance = await neg.resumen(DB, hoy());
ok(balance.ventas.cantidad === 2 && balance.ventas.contado === 0, "y la venta anulada sale del balance");
ok(sql.prepare("SELECT anulada FROM inv_ventas WHERE id = ?").get(v1.ventaId).anulada === 1, "…pero no se borra");
error = null;
try {
  await inv.anularVenta(DB, v1.ventaId);
} catch (e) {
  error = e;
}
ok(/ya estaba anulada/.test(error?.message || "") && (await inv.verVariante(DB, talla)).porSede[sede.id] === 7, "anular dos veces no devuelve dos veces");

titulo("el recibo");
const conSerial = await inv.cobrar(DB, { sedeId: sede.id, metodoPago: "Zelle", nota: "IMEI/serial: 356789012345678", items: [{ varianteId: talla, cantidad: 1 }] });
ok(neg.serialDe("IMEI/serial: 356789012345678") === "IMEI/serial: 356789012345678" && neg.serialDe("Caja") === "", "el IMEI se lee de la nota");
const recibo = neg.textoDelRecibo(await neg.verVenta(DB, conSerial.ventaId), "EPICCELL");
ok(/356789012345678/.test(recibo) && /Total: \$50/.test(recibo), "y sale en el recibo para la garantía", recibo.split("\n").slice(0, 3).join(" / "));

titulo("Cashea en la caja (EPICCELL)");
ok(tarifaDeLaVenta("cashea", "Pago móvil") === "cashea" && tarifaDeLaVenta("cashea", "") === "cashea", "con Cashea en la caja, se cobra el precio Cashea");
ok(tarifaDeLaVenta("cashea", "Divisas (efectivo)") === "", "salvo en divisas en efectivo: ahí el precio en dólares");
ok(tarifaDeLaVenta("", "Pago móvil") === "", "las tiendas sin Cashea, como siempre");
const telefono = await inv.guardarProducto(DB, { origen: "manual", titulo: "iPhone 15", precio: 800, precio_cashea: 900 });
const gb128 = await inv.guardarVariante(DB, telefono, { opcion: "128GB" });
await inv.ajustarStock(DB, { varianteId: gb128, sedeId: sede.id, cantidad: 3 });
ok((await inv.cobrar(DB, { sedeId: sede.id, items: [{ varianteId: gb128, cantidad: 1 }], tarifa: "cashea" })).total === 900, "Cashea: $900");
ok((await inv.cobrar(DB, { sedeId: sede.id, items: [{ varianteId: gb128, cantidad: 1 }] })).total === 800, "divisas: $800");

titulo("contar mientras se vende no pierde la venta");
const variosAjustes = await Promise.all([
  inv.ajustarStock(DB, { varianteId: talla, sedeId: sede.id, cantidad: 4, quien: "Luis" }),
  inv.ajustarStock(DB, { varianteId: talla, sedeId: sede.id, cantidad: 4, quien: "Luis" }),
]);
const movsAjuste = sql.prepare("SELECT delta, queda FROM inv_movimientos WHERE variante_id = ? AND tipo = 'ajuste'").all(talla);
ok(variosAjustes.every((n) => n === 4) && movsAjuste.length === 1 && movsAjuste[0].delta === -2, "el mismo conteo dos veces deja UN movimiento con la diferencia", JSON.stringify(movsAjuste));
await Promise.all([
  inv.cobrar(DB, { sedeId: sede.id, items: [{ varianteId: talla, cantidad: 1 }] }),
  inv.ajustarStock(DB, { varianteId: talla, sedeId: sede.id, cantidad: 6, quien: "Luis" }),
  inv.cobrar(DB, { sedeId: sede.id, items: [{ varianteId: talla, cantidad: 1 }] }),
]);
const cuadra = sql.prepare("SELECT (SELECT SUM(delta) FROM inv_movimientos WHERE variante_id = ? AND local_id = ?) AS suma, (SELECT cantidad FROM inv_stock WHERE variante_id = ? AND local_id = ?) AS hay").get(talla, sede.id, talla, sede.id);
ok(cuadra.suma === cuadra.hay, "con ventas y un conteo a la vez, el historial sigue cuadrando con el stock", JSON.stringify(cuadra));

titulo("importar: el mismo modelo con otro archivo, y el COD del Excel");
const emperador = [{ origen: "drive", origen_id: "archivo-1", titulo: "Gorra NY", extras: { codigo: "G125" }, variantes: [{ opcion: "única", cantidad: 4 }] }];
await inv.importarCatalogo(DB, emperador, { sedeId: sede.id });
const gorra = sql.prepare("SELECT id FROM inv_productos WHERE origen = 'drive'").get().id;
await inv.importarCatalogo(DB, [{ ...emperador[0], origen_id: "archivo-2" }], { sedeId: sede.id });
const enDrive = sql.prepare("SELECT id, origen_id FROM inv_productos WHERE origen = 'drive'").all();
ok(enDrive.length === 1 && enDrive[0].id === gorra && enDrive[0].origen_id === "archivo-2", "cambiaron la foto en Drive (otro archivo, mismo COD): sigue siendo el mismo modelo", JSON.stringify(enDrive));
const dosConElMismo = await inv.importarCatalogo(DB, [{ ...emperador[0], origen_id: "archivo-3" }, { ...emperador[0], origen_id: "archivo-2", titulo: "Gorra NY" }], { sedeId: sede.id });
ok(sql.prepare("SELECT COUNT(*) AS n FROM inv_productos WHERE origen = 'drive'").get().n === 2 && dosConElMismo.modelos === 2, "si el viejo sigue en el catálogo, el nuevo es otro modelo (no se pisan)");
await inv.importarCsv(DB, "COD;Cantidad\nG125;9\n", { sedeId: sede.id, quien: "Excel" });
const varGorra = sql.prepare("SELECT v.id FROM inv_variantes v WHERE v.producto_id = ?").get(gorra).id;
ok((await inv.verVariante(DB, varGorra)).porSede[sede.id] === 9, "el Excel con el COD de El Emperador pone el stock en ese modelo");
const informeJuntadas = await inv.importarCatalogo(DB, [{ origen: "sheets", origen_id: "moto-g", titulo: "Moto G", juntadas: 2, variantes: [{ opcion: "64GB", cantidad: 5 }] }], { sedeId: sede.id });
ok(informeJuntadas.juntadas === 2, "el informe dice cuántas filas repetidas se juntaron");

titulo("cada capacidad con lo suyo, y lo que ofrece el bot");
const moto = await inv.guardarProducto(DB, { origen: "sheets", origen_id: "moto-edge", titulo: "Moto Edge", precio: 300, precio_local: 11000, precio_cashea: 340 });
const m128 = await inv.guardarVariante(DB, moto, { opcion: "128GB", precio: 300, precio_cashea: 340, precio_local: 11000, foto: "https://x/edge.jpg", extras: { RAM: "8GB" } });
const m256 = await inv.guardarVariante(DB, moto, { opcion: "256GB", precio: 360 });
const m512 = await inv.guardarVariante(DB, moto, { opcion: "512GB", oculta: true });
let paraElBot = (await inv.catalogoParaElBot(DB)).filter((f) => f.productoId === moto);
ok(paraElBot.map((f) => f.opcion).join(",") === "128GB,256GB", "lo oculto no se ofrece; lo que nunca se contó, sí", JSON.stringify(paraElBot.map((f) => f.opcion)));
const de256 = paraElBot.find((f) => f.opcion === "256GB");
ok(de256.precio === 360 && de256.precioCashea === null && de256.precioLocal === null, "la de 256GB no toma el Cashea ni los Bs de la de 128GB (eran de otra capacidad)", JSON.stringify(de256));
ok((await inv.verVariante(DB, m256)).precioCashea === null, "ni la caja");
ok(paraElBot[0].foto === "https://x/edge.jpg" && paraElBot[0].extras.RAM === "8GB" && de256.foto === "", "cada capacidad con su foto y sus columnas");
await inv.ajustarStock(DB, { varianteId: m128, sedeId: sede.id, cantidad: 0 });
paraElBot = (await inv.catalogoParaElBot(DB)).filter((f) => f.productoId === moto);
ok(!paraElBot.some((f) => f.opcion === "128GB"), "contada en 0, ya no se ofrece");
let fallo = null;
try {
  await inv.editarVariante(DB, m256, { foto: "http://inseguro.jpg" });
} catch (e) {
  fallo = e;
}
ok(/https/.test(fallo?.message || ""), "una foto que no es https no se guarda", fallo?.message);
await inv.editarVariante(DB, m256, { precio: "", precio_cashea: "399", foto: "https://x/256.jpg", oculta: undefined });
const editada = sql.prepare("SELECT precio, precio_cashea, foto, oculta FROM inv_variantes WHERE id = ?").get(m256);
ok(editada.precio === null && editada.precio_cashea === 399 && editada.foto === "https://x/256.jpg" && editada.oculta === 0, "editar: vacío vuelve al precio del modelo, y sin decir nada no cambia si se ofrece", JSON.stringify(editada));
await inv.editarVariante(DB, m512, { oculta: false });
ok(sql.prepare("SELECT oculta FROM inv_variantes WHERE id = ?").get(m512).oculta === 0, "y mostrarla otra vez");
ok((await inv.elBotLeeElInventario(DB)) === false, "hasta que no se dice, el bot sigue con la hoja");
const importado = await inv.importarCatalogo(DB, [{ origen: "sheets", origen_id: "cero", titulo: "Agotado en la hoja", variantes: [{ opcion: "64GB", cantidad: 0 }, { opcion: "128GB", cantidad: null }] }], { sedeId: sede.id });
const cero = (await inv.catalogoParaElBot(DB)).filter((f) => f.titulo === "Agotado en la hoja").map((f) => f.opcion);
ok(importado.conStock === 0 && cero.join() === "128GB", "importar: el 0 de la hoja queda contado (no se ofrece); sin número, sin contar (sí)", JSON.stringify(cero));

titulo("cada tienda con las palabras de su negocio");
ok(rubroDe("calzado").variantes === "tallas" && rubroDe("telefonos").variantes === "capacidades" && rubroDe("raro") === RUBROS.general, "zapatos: tallas · teléfonos: capacidades · otra: variantes");
ok(rubroDe("telefonos").conSerial && !rubroDe("calzado").conSerial && !rubroDe("moda").conSerial, "solo la de teléfonos pide IMEI");

const ENV = { DB, PANEL_CLAVE: "clave-de-prueba", TIENDA_NOMBRE: "Prueba" };
async function entrar(campos) {
  const datos = new FormData();
  datos.set("clave", "clave-de-prueba");
  for (const [k, v] of Object.entries(campos)) datos.set(k, v);
  const r = await atenderPanel(new Request("https://bot.test/panel/entrar", { method: "POST", body: datos }), ENV, { tienda: "Prueba" });
  return r.headers.get("set-cookie") || "";
}
const galleta = await entrar({ pregunta_sesion: "1", recordar: "si" });
const cookie = galleta.split(";")[0];
const pedir = (ruta, opciones = {}, init = {}) => atenderPanel(new Request(`https://bot.test${ruta}`, { ...init, headers: { cookie, "sec-fetch-site": "same-origin", ...(init.headers || {}) } }), ENV, { tienda: "Prueba", ...opciones });

let html = await (await pedir("/panel/inventario/nuevo", { rubro: "telefonos" })).text();
ok(/Capacidades<input/.test(html) && /128GB, 256GB/.test(html) && /Condición<input/.test(html) && !/Tallas<input/.test(html), "teléfonos: capacidades y condición, no tallas");
html = await (await pedir("/panel/inventario/nuevo", { rubro: "calzado" })).text();
ok(/Tallas<input/.test(html) && /38-44/.test(html) && !/Capacidades/.test(html), "zapatos: tallas");
html = await (await pedir("/panel/caja", { rubro: "telefonos", tarifaDeCaja: "cashea" })).text();
ok(/id="serial"/.test(html) && /IMEI/.test(html), "la caja de teléfonos pide el IMEI para la garantía");
html = await (await pedir("/panel/caja", { rubro: "calzado" })).text();
ok(!/id="serial"/.test(html), "la de zapatos no");

html = await (await pedir(`/panel/inventario/p/${moto}`, { rubro: "telefonos", botLeeInventario: true })).text();
ok(/popovertarget="editar-variante"/.test(html) && /id="variante-form"/.test(html) && /type="checkbox" name="al_bot"/.test(html), "cada capacidad se edita (precio, Cashea, Bs, foto y si el bot la ofrece)");
ok(/sin contar/.test(html), "y la que nunca se contó lo dice");
html = await (await pedir(`/panel/inventario/p/${moto}`, { rubro: "calzado" })).text();
ok(/id="variante-form"/.test(html) && !/type="checkbox" name="al_bot"/.test(html), "en una tienda cuyo bot no lee el inventario, sin el interruptor del bot");
const formVariante = new FormData();
for (const [k, v] of Object.entries({ producto: moto, variante: m512, precio: "450", precio_cashea: "", precio_local: "", foto: "", codigo_fabricante: "", con_bot: "1" })) formVariante.set(k, String(v));
let rv = await pedir("/panel/inventario/variante/editar", { botLeeInventario: true }, { method: "POST", body: formVariante });
ok(rv.status === 303 && sql.prepare("SELECT precio, oculta FROM inv_variantes WHERE id = ?").get(m512).oculta === 1, "desmarcado «El bot la ofrece», queda oculta", String(rv.status));
html = await (await pedir("/panel/inventario/importar", { botLeeInventario: true, traerCatalogo: async () => [], nombreDelCatalogo: "la hoja de Google (todo)" })).text();
ok(/Lo que ofrece el bot/.test(html) && /Todavía lee la hoja de Google\./.test(html), "Importar dice de dónde saca el bot lo que ofrece");
const traer = new FormData();
traer.set("sede", String(sede.id));
const catalogoDePrueba = async () => [{ origen: "sheets", origen_id: "nuevo", titulo: "Redmi 15", variantes: [{ opcion: "128GB", cantidad: 2 }] }];
html = await (await pedir("/panel/inventario/importar/catalogo", { botLeeInventario: true, traerCatalogo: catalogoDePrueba }, { method: "POST", body: traer })).text();
ok(/Desde ahora el bot ofrece lo del inventario/.test(html) && (await inv.elBotLeeElInventario(DB)), "traer el catálogo hace que el bot ofrezca lo del inventario");
const volver = new FormData();
volver.set("fuente", "hoja");
rv = await pedir("/panel/inventario/fuente-del-bot", { botLeeInventario: true }, { method: "POST", body: volver });
ok(rv.status === 303 && !(await inv.elBotLeeElInventario(DB)), "con un botón vuelve a la hoja");
await (await pedir("/panel/inventario/importar/catalogo", { botLeeInventario: true, traerCatalogo: catalogoDePrueba }, { method: "POST", body: traer })).text();
ok(!(await inv.elBotLeeElInventario(DB)), "y volver a traer el catálogo respeta esa decisión");
await (await pedir("/panel/inventario/importar/catalogo", { traerCatalogo: catalogoDePrueba }, { method: "POST", body: traer })).text();
await pedir("/panel/inventario/fuente-del-bot", {}, { method: "POST", body: (() => { const f = new FormData(); f.set("fuente", "inventario"); return f; })() });
ok(!(await inv.elBotLeeElInventario(DB)), "en Invictus o El Emperador (su bot no lee el inventario) no cambia nada");

titulo("la caja por dentro (lo que manda el botón Cobrar)");
const cobrarEnCaja = (cuerpo, opciones) =>
  pedir("/panel/caja/cobrar", opciones, { method: "POST", body: JSON.stringify(cuerpo), headers: { "content-type": "application/json", accept: "application/json" } }).then((r) => r.json());
let caja = await cobrarEnCaja({ sede: sede.id, metodo: "Pago móvil", items: [{ variante: gb128, cantidad: 1 }] }, { rubro: "telefonos", tarifaDeCaja: "cashea" });
ok(caja.ok && caja.total === 900 && caja.tarifa === "cashea", "EPICCELL en Pago móvil: precio Cashea", JSON.stringify(caja).slice(0, 120));
ok(caja.whatsapp?.startsWith("https://wa.me/") && caja.recibo === `/panel/ventas/${caja.ventaId}`, "con su recibo y el enlace de WhatsApp");
await inv.ajustarStock(DB, { varianteId: gb128, sedeId: sede.id, cantidad: 2 });
caja = await cobrarEnCaja({ sede: sede.id, metodo: "Divisas (efectivo)", items: [{ variante: gb128, cantidad: 1 }] }, { rubro: "telefonos", tarifaDeCaja: "cashea" });
ok(caja.ok && caja.total === 800 && caja.tarifa === "", "EPICCELL en divisas en efectivo: el precio en dólares", JSON.stringify(caja).slice(0, 120));
caja = await cobrarEnCaja({ sede: sede.id, fiado: true, items: [{ variante: gb128, cantidad: 1 }] }, {});
ok(!caja.ok && /nombre del cliente/.test(caja.error || ""), "fiar sin nombre: lo dice y no cobra", JSON.stringify(caja));

titulo("las páginas del negocio abren");
for (const ruta of ["/panel/inicio", "/panel/ventas", `/panel/ventas/${f1.ventaId}`, "/panel/gastos", "/panel/fiados?pagados=1", "/panel/ventas.csv", "/panel/gastos.csv", "/panel/fiados.csv"]) {
  const r = await pedir(ruta);
  ok(r.status === 200, `${ruta} abre`, String(r.status));
}
html = await (await pedir(`/panel/ventas/${f1.ventaId}`)).text();
ok(/Luisa Gómez/.test(html) && /Fiado/.test(html), "el recibo de una venta fiada dice a quién");

titulo("¿dejar la sesión abierta?");
ok(/; Max-Age=7776000/.test(galleta) && /SameSite=Lax/.test(galleta) && /HttpOnly/.test(galleta), "sí: dura 90 días aunque cierre el navegador", galleta.replace(/=[^;]+/, "=…"));
const corta = await entrar({ pregunta_sesion: "1" });
ok(corta && !/Max-Age/.test(corta), "no: se acaba al cerrar el navegador", corta.replace(/=[^;]+/, "=…"));
const vieja = await entrar({});
ok(/Max-Age/.test(vieja), "una pantalla de entrada vieja (sin la pregunta) la deja abierta, como antes");
html = await (await atenderPanel(new Request("https://bot.test/panel"), ENV, { tienda: "Prueba" })).text();
ok(/¿Dejar la sesión abierta\?/.test(html) && /name="recordar" value="si" checked/.test(html), "la pantalla de entrada lo pregunta (marcado de entrada)");
let r = await pedir("/panel/inicio");
ok(!r.headers.get("set-cookie"), "recién entrado no hace falta renovar");
const ahoraReal = Date.now;
Date.now = () => ahoraReal() + 11 * 24 * 3600 * 1000;
r = await pedir("/panel/inicio");
ok(r.status === 200 && /; Max-Age=7776000/.test(r.headers.get("set-cookie") || ""), "a los 11 días, entrando, se renueva sola");
const cortaCookie = corta.split(";")[0];
r = await atenderPanel(new Request("https://bot.test/panel/inicio", { headers: { cookie: cortaCookie } }), ENV, { tienda: "Prueba" });
ok(!/Inicio<\/title>/.test(await r.text()), "la de solo esta vez ya venció (12 horas)");
Date.now = ahoraReal;
r = await atenderPanel(new Request("https://bot.test/panel/inicio", { headers: { cookie: cortaCookie } }), ENV, { tienda: "Prueba" });
ok(!r.headers.get("set-cookie"), "y la de solo esta vez nunca se renueva");
r = await atenderPanel(new Request("https://bot.test/panel/inicio", { headers: { cookie: cookie.replace(/\.r\./, ".s.") } }), ENV, { tienda: "Prueba" });
ok(!/Inicio<\/title>/.test(await r.text()), "cambiarle el modo a mano rompe la firma");

src.limpiar();
terminar();
