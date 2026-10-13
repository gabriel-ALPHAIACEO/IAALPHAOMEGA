// VENTAS POR CATEGORÍA Y EL FILTRO DEL INVENTARIO (13-oct-2026, pedido del
// dueño: "¿cuánto vendí en relojes este mes?").
//
// QUÉ SE PROTEGE.
//   · Lo vendido se suma por la categoría del producto, sin las ventas
//     anuladas; "Relojes" y "relojes" son la misma; lo que no tiene categoría
//     va junto, y lo cobrado sin inventario (un servicio) aparte.
//   · Inicio y Ventas lo enseñan; sin ninguna categoría puesta, Ventas
//     explica cómo tenerla. El asistente también lo sabe.
//   · En el inventario, atajos por categoría (y «Sin categoría»).

import { prepararSrc, baseDeMentira, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const inv = await src.cargar("inventario.js");
const neg = await src.cargar("negocio.js");
const { atenderPanel } = await src.cargar("panel.js");
const { DB } = baseDeMentira();
const [sede] = await inv.sedes(DB);

const ENV = { DB, PANEL_CLAVE: "clave-de-prueba", TIENDA_NOMBRE: "Prueba" };
const entrar = new FormData();
entrar.set("clave", "clave-de-prueba");
const cookie = ((await atenderPanel(new Request("https://bot.test/panel/entrar", { method: "POST", body: entrar }), ENV, { tienda: "Prueba" })).headers.get("set-cookie") || "").split(";")[0];
const pagina = async (ruta) => (await atenderPanel(new Request(`https://bot.test${ruta}`, { headers: { cookie, "sec-fetch-site": "same-origin" } }), ENV, { tienda: "Prueba", rubro: "telefonos" })).text();

async function crear(titulo, precio, categoria, cantidad = 10) {
  const id = await inv.guardarProducto(DB, { origen: "manual", titulo, precio, precio_cashea: precio, extras: categoria ? { categoria } : {} });
  const [v] = await inv.guardarVariantes(DB, id, [{ opcion: "única" }]);
  await inv.ajustarStock(DB, { varianteId: v, sedeId: sede.id, cantidad });
  return v;
}

titulo("sin categorías todavía");
const cable = await crear("Cable Tipo C", 5, "");
await inv.cobrar(DB, { sedeId: sede.id, items: [{ varianteId: cable, cantidad: 3 }], metodoPago: "Pago móvil" });
let html = await pagina("/panel/ventas");
ok(/Ponle categoría a tus productos/.test(html), "Ventas explica cómo tener las ventas por categoría");
html = await pagina("/panel/inicio");
ok(!/Ventas por categoría/.test(html), "y en Inicio no sale una tarjeta vacía");
html = await pagina("/panel/inventario");
ok(!/class="inv-cats"/.test(html), "ni atajos de categoría en el inventario");

titulo("con categorías");
const relojA = await crear("Xiaomi Redmi Watch 5", 60, "Relojes");
const relojB = await crear("Amazfit Bip 6", 40, "relojes");
const tel = await crear("Samsung Galaxy S25 FE", 500, "Teléfonos");
await inv.cobrar(DB, { sedeId: sede.id, items: [{ varianteId: relojA, cantidad: 2 }, { varianteId: relojB, cantidad: 1 }], metodoPago: "Zelle" });
const ventaTel = await inv.cobrar(DB, { sedeId: sede.id, items: [{ varianteId: tel, cantidad: 1 }], metodoPago: "Zelle" });
await inv.cobrar(DB, { sedeId: sede.id, items: [], libres: [{ descripcion: "Cambio de pantalla", precio: 20, cantidad: 1 }], metodoPago: "Divisas (efectivo)" });
await inv.anularVenta(DB, ventaTel.ventaId, { motivo: "prueba" });

const r = await neg.resumen(DB, neg.periodoDe(new URLSearchParams({ p: "hoy" })));
const por = Object.fromEntries(r.porCategoria.map((c) => [c.categoria, c]));
ok(por.Relojes?.unidades === 3 && por.Relojes?.monto === 160, "«Relojes» y «relojes» suman juntas: 3 unidades, $160", JSON.stringify(por.Relojes));
ok(!por["Teléfonos"], "la venta anulada no cuenta");
ok(por["Sin categoría"]?.unidades === 3 && por["Sin categoría"]?.monto === 15, "lo que no tiene categoría va junto ($15)");
ok(por["Cobros sin inventario"]?.monto === 20, "lo cobrado sin inventario (un servicio) va aparte ($20)");
ok(r.porCategoria[0].categoria === "Relojes", "primero la que más vendió", r.porCategoria.map((c) => c.categoria).join(", "));

html = await pagina("/panel/inicio");
ok(/Ventas por categoría/.test(html) && /Relojes · 3 unidades/.test(html), "Inicio enseña las ventas por categoría");
html = await pagina("/panel/ventas");
ok(/Ventas por categoría/.test(html) && /Relojes · 3 unidades/.test(html) && !/Ponle categoría/.test(html), "y Ventas también");

const datos = await neg.datosParaElAsistente(DB);
const hoy = Object.values(datos.periodos)[0];
ok(hoy.ventasPorCategoria?.some((c) => c.categoria === "Relojes" && c.monto === 160), "el asistente sabe cuánto se vendió en Relojes", JSON.stringify(hoy.ventasPorCategoria));

titulo("el inventario, por categoría");
html = await pagina("/panel/inventario");
ok(/class="inv-cats"/.test(html) && /Relojes <small>2<\/small>/.test(html) && /Teléfonos <small>1<\/small>/.test(html) && /Sin categoría <small>1<\/small>/.test(html), "atajos: Relojes 2, Teléfonos 1, Sin categoría 1");
html = await pagina("/panel/inventario?cat=relojes");
ok(/Xiaomi Redmi Watch 5/.test(html) && /Amazfit Bip 6/.test(html) && !/Samsung Galaxy S25 FE/.test(html) && !/Cable Tipo C/.test(html), "?cat=relojes: solo los relojes");
ok(/class="on" aria-current="true">Relojes/.test(html), "y el atajo de Relojes queda marcado");
html = await pagina("/panel/inventario?cat=-");
ok(/Cable Tipo C/.test(html) && !/Amazfit Bip 6/.test(html), "«Sin categoría»: los que les falta");
html = await pagina("/panel/inventario?cat=Relojes&q=amazfit");
ok(/Amazfit Bip 6/.test(html) && !/Xiaomi Redmi Watch 5/.test(html) && /name="cat" value="Relojes"/.test(html), "se combina con el buscador (y el buscador la conserva)");
ok(/<b>Xiaomi Redmi Watch 5<\/b><small>Relojes<\/small>/.test(await pagina("/panel/inventario?cat=Relojes")), "cada producto dice su categoría en la lista");

terminar();
