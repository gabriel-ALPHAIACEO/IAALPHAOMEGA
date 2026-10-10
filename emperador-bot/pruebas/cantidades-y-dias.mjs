// LA CANTIDAD ESCRITA Y LAS VENTAS DE OTRO DÍA (9-oct-2026, pedido del dueño):
//   · al crear un producto o añadir tallas, una casilla de cantidad por talla
//     (sin botones), y en la ficha el número de cada talla se cambia
//     escribiéndolo y se guarda solo;
//   · "se le olvidó colocar la venta del día": la caja y «Vendí» pueden anotar
//     una venta en ayer u otro día.
//
// Lo que no se puede romper:
//   · una cantidad mal escrita no deja un producto a medias;
//   · escribir una cantidad aplica la DIFERENCIA sobre lo que haya: una venta
//     que cayó mientras tanto no se pierde, y nunca queda una venta falsa;
//   · una venta de ayer cuenta en AYER (Ventas, balance, fiados), baja el
//     stock de hoy, queda marcada como anotada después, y no se puede poner
//     en el futuro ni en una fecha que no existe;
//   · si un producto se contó después de esa fecha, la caja avisa que el
//     conteo ya traía la venta descontada.

import vm from "node:vm";
import { prepararSrc, baseDeMentira, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const inv = await src.cargar("inventario.js");
const neg = await src.cargar("negocio.js");
const { atenderPanel } = await src.cargar("panel.js");

// D1 hace cada batch en una transacción: aquí igual.
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
const DIA = 24 * 60 * 60 * 1000;
const ayer = neg.diaDe(Date.now() - DIA);
const anteayer = neg.diaDe(Date.now() - 2 * DIA);
const hoy = neg.diaDe(Date.now());
const stockDe = (variante) => sql.prepare("SELECT cantidad FROM inv_stock WHERE variante_id = ? AND local_id = ?").get(variante, sede.id)?.cantidad;
const filaDeStock = (variante) => sql.prepare("SELECT 1 AS si FROM inv_stock WHERE variante_id = ? AND local_id = ?").get(variante, sede.id);
const movimientos = (variante) => sql.prepare("SELECT tipo, delta, queda, nota FROM inv_movimientos WHERE variante_id = ? ORDER BY id").all(variante);
async function falla(promesa) {
  try {
    await promesa;
    return null;
  } catch (e) {
    return e;
  }
}

/* ── Las cantidades por talla ────────────────────────────────────────── */

titulo("cargarCantidades: una cantidad por talla");
const zapato = await inv.guardarProducto(DB, { origen: "manual", titulo: "Zapato de prueba", precio: 40, costo: 25 });
const [t38, t39, t40] = await inv.guardarVariantes(DB, zapato, [{ opcion: "38" }, { opcion: "39" }, { opcion: "40" }]);
let r = await inv.cargarCantidades(DB, { sedeId: sede.id, quien: "Ana", nota: "Al crearlo", filas: [{ varianteId: t38, cantidad: "3" }, { varianteId: t39, cantidad: "" }, { varianteId: t40, cantidad: 5 }] });
ok(r.unidades === 8 && r.cargadas === 2, "3 + 5 unidades en dos tallas", JSON.stringify(r));
ok(stockDe(t38) === 3 && stockDe(t40) === 5, "cada talla con su cantidad");
ok(filaDeStock(t39) && stockDe(t39) === 0, "la casilla vacía deja la talla contada en 0");
ok(movimientos(t38).length === 1 && movimientos(t38)[0].tipo === "carga" && movimientos(t38)[0].delta === 3 && movimientos(t38)[0].nota === "Al crearlo", "una talla nueva: Carga inicial, con su nota", JSON.stringify(movimientos(t38)));
ok(movimientos(t39).length === 0, "y la del 0 no deja un movimiento de nada");
r = await inv.cargarCantidades(DB, { sedeId: sede.id, nota: "Al añadirla", filas: [{ varianteId: t38, cantidad: "2" }] });
ok(stockDe(t38) === 5 && movimientos(t38)[1].tipo === "entrada" && movimientos(t38)[1].queda === 5, "en una talla que ya tenía, SUMA (Entrada) y no pisa", JSON.stringify(movimientos(t38)));

titulo("cargarCantidades: nada mal escrito entra");
const antes = sql.prepare("SELECT COUNT(*) AS n FROM inv_movimientos").get().n;
for (const [malo, que] of [["-1", "negativa"], ["2.5", "con decimales"], ["abc", "con letras"], ["100001", "enorme"]]) {
  const e = await falla(inv.cargarCantidades(DB, { sedeId: sede.id, filas: [{ varianteId: t39, cantidad: "4", nombre: "la 39" }, { varianteId: t40, cantidad: malo, nombre: "la 40" }] }));
  ok(/de la 40/.test(e?.message || "") && stockDe(t39) === 0 && stockDe(t40) === 5, `una cantidad ${que} se rechaza diciendo cuál talla, y no se carga ni la buena`, e?.message);
}
ok(sql.prepare("SELECT COUNT(*) AS n FROM inv_movimientos").get().n === antes, "sin ningún movimiento a medias");
ok(inv.leerCantidad("") === 0 && inv.leerCantidad(" 7 ") === 7, "vacía = 0; con espacios, se entiende");

titulo("60 tallas no pasan de unas pocas llamadas a la base");
// Cuenta como Cloudflare: un batch es UNA llamada, sea cual sea su tamaño.
let llamadas = 0;
let enBatch = false;
const contar = () => {
  if (!enBatch) llamadas++;
};
const contada = {
  batch: async (s) => {
    llamadas++;
    enBatch = true;
    try {
      return await DB.batch(s);
    } finally {
      enBatch = false;
    }
  },
  prepare: (q) => {
    const real = DB.prepare(q);
    const envoltura = {
      bind: (...a) => (real.bind(...a), envoltura),
      run: () => (contar(), real.run()),
      all: () => (contar(), real.all()),
      first: () => (contar(), real.first()),
    };
    return envoltura;
  },
};
const muchas = await inv.guardarProducto(DB, { origen: "manual", titulo: "Muchas tallas" });
const idsMuchas = await inv.guardarVariantes(DB, muchas, Array.from({ length: 60 }, (_, i) => ({ opcion: String(i + 1) })));
llamadas = 0;
r = await inv.cargarCantidades(contada, { sedeId: sede.id, filas: idsMuchas.map((id, i) => ({ varianteId: id, cantidad: String(i % 4) })) });
ok(llamadas <= 6 && r.unidades === idsMuchas.reduce((a, _, i) => a + (i % 4), 0), `60 tallas cargadas con ${llamadas} llamadas`, JSON.stringify(r));

/* ── Cambiar la cantidad escribiéndola en la ficha ───────────────────── */

titulo("cambiarCantidad: se escribe y se guarda sola");
const modelo = await inv.guardarProducto(DB, { origen: "manual", titulo: "Modelo de la ficha", precio: 30 });
const [a41, a42, a43] = await inv.guardarVariantes(DB, modelo, [{ opcion: "41" }, { opcion: "42" }, { opcion: "43" }]);
await inv.ajustarStock(DB, { varianteId: a41, sedeId: sede.id, cantidad: 5, tipo: "carga" });
let c = await inv.cambiarCantidad(DB, { varianteId: a41, sedeId: sede.id, nueva: 8, vista: 5, quien: "Luis" });
ok(c.queda === 8 && c.delta === 3 && c.anterior === 5 && stockDe(a41) === 8, "de 5 a 8: quedan 8 (+3)", JSON.stringify(c));
let m = movimientos(a41).at(-1);
ok(m.tipo === "entrada" && m.delta === 3 && /de 5 a 8/.test(m.nota), "subir es una Entrada, con el antes y el después", JSON.stringify(m));
c = await inv.cambiarCantidad(DB, { varianteId: a41, sedeId: sede.id, nueva: 6, vista: 8 });
m = movimientos(a41).at(-1);
ok(c.queda === 6 && m.tipo === "ajuste" && m.delta === -2, "bajar es un Ajuste (nunca una venta)", JSON.stringify(m));
ok(sql.prepare("SELECT COUNT(*) AS n FROM inv_ventas").get().n === 0 && !movimientos(a41).some((x) => x.tipo === "venta"), "y no aparece ninguna venta de la nada");
c = await inv.cambiarCantidad(DB, { varianteId: a41, sedeId: sede.id, nueva: 6, vista: 6 });
ok(c.delta === 0 && movimientos(a41).length === 3, "escribir el mismo número no deja nada en el historial");

titulo("cambiarCantidad: lo que pasó mientras tanto no se pierde");
await inv.cobrar(DB, { sedeId: sede.id, metodoPago: "Efectivo", items: [{ varianteId: a41, cantidad: 2 }] });
ok(stockDe(a41) === 4, "una venta de la caja baja a 4 mientras la ficha seguía mostrando 6");
c = await inv.cambiarCantidad(DB, { varianteId: a41, sedeId: sede.id, nueva: 9, vista: 6 });
ok(c.queda === 7 && c.delta === 3 && stockDe(a41) === 7, "quien escribió 9 (veía 6) suma 3 sobre lo de ahora: quedan 7, la venta sigue descontada", JSON.stringify(c));
let e = await falla(inv.cambiarCantidad(DB, { varianteId: a41, sedeId: sede.id, nueva: 0, vista: 20 }));
ok(e?.name === "SinStock" && /Ahora quedan 7/.test(e.message) && e.queda === 7 && stockDe(a41) === 7, "si el cambio dejaría el stock en negativo, se dice cuánto queda (en el texto y como número) y no se toca", e?.message);
for (const malo of ["-1", "2.5", "abc", "", "100001"]) {
  e = await falla(inv.cambiarCantidad(DB, { varianteId: a41, sedeId: sede.id, nueva: malo, vista: 7 }));
  ok(Boolean(e) && stockDe(a41) === 7, `«${malo}» no se guarda`, e?.message);
}

titulo("cambiarCantidad: una talla que nunca se contó");
c = await inv.cambiarCantidad(DB, { varianteId: a42, sedeId: sede.id, nueva: 4, vista: null, quien: "Luis" });
ok(c.queda === 4 && movimientos(a42)[0].tipo === "carga" && movimientos(a42)[0].delta === 4, "el número escrito es el conteo (Carga inicial)", JSON.stringify(movimientos(a42)));
c = await inv.cambiarCantidad(DB, { varianteId: a43, sedeId: sede.id, nueva: 0, vista: "" });
ok(c.queda === 0 && filaDeStock(a43) && movimientos(a43).length === 0, "escribir 0 la deja contada en 0 sin movimiento");

titulo("cambiarCantidad: Deshacer no resucita lo que se vendió mientras tanto");
const prueba = await inv.guardarProducto(DB, { origen: "manual", titulo: "Modelo de las carreras", precio: 30 });
const [d1, d2, d3] = await inv.guardarVariantes(DB, prueba, [{ opcion: "36" }, { opcion: "37" }, { opcion: "38" }]);
await inv.ajustarStock(DB, { varianteId: d1, sedeId: sede.id, cantidad: 5, tipo: "carga" });
await inv.cobrar(DB, { sedeId: sede.id, metodoPago: "Efectivo", items: [{ varianteId: d1, cantidad: 2 }] }); // la ficha seguía viendo 5; quedan 3
c = await inv.cambiarCantidad(DB, { varianteId: d1, sedeId: sede.id, nueva: 8, vista: 5 });
ok(c.queda === 6 && c.delta === 3 && c.anterior === 3, "«anterior» es lo que había justo antes de ese cambio (3), no lo que se veía en pantalla (5)", JSON.stringify(c));
c = await inv.cambiarCantidad(DB, { varianteId: d1, sedeId: sede.id, nueva: c.anterior, vista: c.queda });
ok(c.queda === 3 && stockDe(d1) === 3, "Deshacer deja 3: las 2 vendidas siguen vendidas", JSON.stringify(c));
await inv.cobrar(DB, { sedeId: sede.id, metodoPago: "Efectivo", items: [{ varianteId: d1, cantidad: 1 }] }); // otra venta: quedan 2
c = await inv.cambiarCantidad(DB, { varianteId: d1, sedeId: sede.id, nueva: 1, vista: 3 }); // la ficha veía 3, baja 2
ok(c.queda === 0 && c.delta === -2 && c.anterior === 2 && stockDe(d1) === 0, "bajando también: la diferencia se aplica sobre lo de ahora", JSON.stringify(c));
c = await inv.cambiarCantidad(DB, { varianteId: d1, sedeId: sede.id, nueva: c.anterior, vista: c.queda });
ok(c.queda === 2 && stockDe(d1) === 2, "y Deshacer vuelve a lo que de verdad había (2)", JSON.stringify(c));

titulo("cambiarCantidad: reenviar el mismo cambio no suma dos veces");
await inv.ajustarStock(DB, { varianteId: d2, sedeId: sede.id, cantidad: 5, tipo: "carga" });
c = await inv.cambiarCantidad(DB, { varianteId: d2, sedeId: sede.id, nueva: 8, vista: 5 });
const otra = await inv.cambiarCantidad(DB, { varianteId: d2, sedeId: sede.id, nueva: 8, vista: 5 }); // la respuesta se perdió y se reintenta, o la otra pestaña tenía la ficha vieja
ok(c.queda === 8 && otra.queda === 8 && otra.delta === 0 && stockDe(d2) === 8, "el segundo envío deja 8 (no 11) y no mueve nada", JSON.stringify(otra));
ok(movimientos(d2).length === 2, "y no deja un segundo movimiento", JSON.stringify(movimientos(d2).map((x) => x.delta)));
c = await inv.cambiarCantidad(DB, { varianteId: d2, sedeId: sede.id, nueva: 6, vista: 8 });
const laOtra = await inv.cambiarCantidad(DB, { varianteId: d2, sedeId: sede.id, nueva: 6, vista: 8 }); // dos pestañas que veían 8 escriben 6
ok(c.queda === 6 && laOtra.queda === 6 && stockDe(d2) === 6, "dos personas que veían 8 y escriben 6: quedan 6, no 4", JSON.stringify(laOtra));

titulo("cambiarCantidad: lo que nunca se contó no se deja contado por un Deshacer");
c = await inv.cambiarCantidad(DB, { varianteId: d3, sedeId: sede.id, nueva: 5, vista: "" });
ok(c.queda === 5 && c.anterior === null, "una talla sin contar no tiene un «antes» al que volver (anterior null: la ficha no ofrece Deshacer)", JSON.stringify(c));

/* ── Las pantallas ───────────────────────────────────────────────────── */

const ENV = { DB, PANEL_CLAVE: "clave-de-prueba", TIENDA_NOMBRE: "Prueba" };
const entrada = new FormData();
entrada.set("clave", "clave-de-prueba");
entrada.set("pregunta_sesion", "1");
entrada.set("recordar", "si");
const cookie = ((await atenderPanel(new Request("https://bot.test/panel/entrar", { method: "POST", body: entrada }), ENV, { tienda: "Prueba" })).headers.get("set-cookie") || "").split(";")[0];
const pedir = (ruta, opciones = {}, init = {}) =>
  atenderPanel(new Request(`https://bot.test${ruta}`, { ...init, headers: { cookie, "sec-fetch-site": "same-origin", ...(init.headers || {}) } }), ENV, { tienda: "Prueba", rubro: "calzado", ...opciones });
const formulario = (campos) => {
  const f = new FormData();
  for (const [k, v] of campos) f.append(k, String(v));
  return f;
};
const json = (ruta, cuerpo, opciones) => pedir(ruta, opciones, { method: "POST", body: JSON.stringify(cuerpo), headers: { "content-type": "application/json", accept: "application/json" } }).then((x) => x.json());
// Todos los <script> de la página tienen que ser JavaScript que compila.
function scriptsCompilan(html) {
  const malos = [];
  for (const [, codigo] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    try {
      new vm.Script(codigo);
    } catch (error) {
      malos.push(error.message);
    }
  }
  return malos;
}
const productosEnLaBase = () => sql.prepare("SELECT COUNT(*) AS n FROM inv_productos").get().n;
const donde = (respuesta) => decodeURIComponent(respuesta.headers.get("location") || "");

titulo("Nuevo producto: una casilla por talla");
let html = await (await pedir("/panel/inventario/nuevo")).text();
ok(/data-grilla-opciones/.test(html) && /data-grilla-lista/.test(html) && /name="cantidad"/.test(html), "la página trae la grilla y, sin JavaScript, la casilla de siempre");
ok(/Igual para todas/.test(html) && /Cuántas hay de cada talla/.test(html), "con «Igual para todas»");
ok(scriptsCompilan(html).length === 0, "los scripts de la página compilan", scriptsCompilan(html).join(" | "));
const parsear = new Function(`return (${inv.leerOpciones.toString()})`)();
ok(JSON.stringify(parsear("40-43")) === JSON.stringify(["40", "41", "42", "43"]) && JSON.stringify(parsear("S, M, L")) === JSON.stringify(["S", "M", "L"]) && parsear("")[0] === "única", "las tallas se entienden igual en el navegador (40-43, S, M, L, vacío)");
ok(html.includes(inv.leerOpciones.toString().slice(0, 40)), "y el navegador recibe esa misma función");

let rr = await pedir("/panel/inventario/nuevo", {}, { method: "POST", body: formulario([["titulo", "Bota Grilla"], ["precio", "60"], ["sede", sede.id], ["opciones", "38-40"], ["cantidad", "2"], ["v_opcion", "38"], ["v_cantidad", "2"], ["v_opcion", "39"], ["v_cantidad", ""], ["v_opcion", "40"], ["v_cantidad", "5"]]) });
const botaId = sql.prepare("SELECT id FROM inv_productos WHERE titulo = 'Bota Grilla'").get()?.id;
const botas = sql.prepare("SELECT id, opcion FROM inv_variantes WHERE producto_id = ? ORDER BY CAST(opcion AS REAL)").all(botaId);
ok(rr.status === 303 && botas.length === 3, "se crea con sus 3 tallas", `${rr.status} · ${botas.length}`);
ok(stockDe(botas[0].id) === 2 && stockDe(botas[1].id) === 0 && stockDe(botas[2].id) === 5, "cada talla con SU cantidad (2, 0, 5), no la misma para todas", botas.map((b) => stockDe(b.id)).join(","));
ok(donde(rr).includes("7 unidades"), "y dice cuántas unidades quedaron", donde(rr));
ok(movimientos(botas[0].id)[0].nota === "Al crearlo", "con su movimiento «Al crearlo»");

rr = await pedir("/panel/inventario/nuevo", {}, { method: "POST", body: formulario([["titulo", "Sandalia sin JS"], ["sede", sede.id], ["opciones", "41-43"], ["cantidad", "4"]]) });
const sandaliaId = sql.prepare("SELECT id FROM inv_productos WHERE titulo = 'Sandalia sin JS'").get()?.id;
const sandalias = sql.prepare("SELECT id FROM inv_variantes WHERE producto_id = ?").all(sandaliaId);
ok(rr.status === 303 && sandalias.length === 3 && sandalias.every((s) => stockDe(s.id) === 4), "sin JavaScript sigue valiendo: la misma cantidad para todas", sandalias.map((s) => stockDe(s.id)).join(","));

rr = await pedir("/panel/inventario/nuevo", {}, { method: "POST", body: formulario([["titulo", "Sin cantidades"], ["opciones", "S, M"]]) });
const sinId = sql.prepare("SELECT id FROM inv_productos WHERE titulo = 'Sin cantidades'").get()?.id;
ok(rr.status === 303 && sql.prepare("SELECT COUNT(*) AS n FROM inv_variantes WHERE producto_id = ?").get(sinId).n === 2 && sql.prepare("SELECT COUNT(*) AS n FROM inv_stock s JOIN inv_variantes v ON v.id = s.variante_id WHERE v.producto_id = ?").get(sinId).n === 0, "si no escribe ninguna cantidad, el stock no se toca (quedan sin contar)");

const n0 = productosEnLaBase();
rr = await pedir("/panel/inventario/nuevo", {}, { method: "POST", body: formulario([["titulo", "No debe existir"], ["sede", sede.id], ["v_opcion", "38"], ["v_cantidad", "3"], ["v_opcion", "39"], ["v_cantidad", "-4"]]) });
ok(rr.status === 303 && /error=/.test(rr.headers.get("location") || "") && /39/.test(donde(rr)), "una cantidad mal escrita da error y dice cuál talla", donde(rr));
ok(productosEnLaBase() === n0, "y no deja un producto a medias");

titulo("Añadir tallas a un producto, con su cantidad");
html = await (await pedir(`/panel/inventario/p/${botaId}`)).text();
ok(/action="\/panel\/inventario\/variante"[^>]*data-quien/.test(html) && /name="sede" value="/.test(html) && /data-grilla/.test(html), "la ficha trae el formulario de añadir con su grilla y la sede");
ok(scriptsCompilan(html).length === 0, "los scripts de la ficha compilan", scriptsCompilan(html).join(" | "));
rr = await pedir("/panel/inventario/variante", {}, { method: "POST", body: formulario([["producto", botaId], ["sede", sede.id], ["opciones", "41, 38"], ["v_opcion", "41"], ["v_cantidad", "6"], ["v_opcion", "38"], ["v_cantidad", "1"]]) });
const b41 = sql.prepare("SELECT id FROM inv_variantes WHERE producto_id = ? AND opcion = '41'").get(botaId)?.id;
ok(rr.status === 303 && stockDe(b41) === 6 && movimientos(b41)[0].tipo === "carga" && movimientos(b41)[0].nota === "Al añadirla", "la 41 nueva queda con 6 (Carga inicial «Al añadirla»)");
ok(stockDe(botas[0].id) === 3 && movimientos(botas[0].id).at(-1).tipo === "entrada", "la 38, que ya existía, SUMA 1 (2 → 3) y no se pisa");
ok(sql.prepare("SELECT COUNT(*) AS n FROM inv_variantes WHERE producto_id = ?").get(botaId).n === 4, "y no se duplica la talla");
rr = await pedir("/panel/inventario/variante", {}, { method: "POST", body: formulario([["producto", botaId], ["sede", sede.id], ["opciones", "45"], ["v_opcion", "45"], ["v_cantidad", "x"]]) });
ok(/error=/.test(rr.headers.get("location") || "") && !sql.prepare("SELECT 1 AS si FROM inv_variantes WHERE producto_id = ? AND opcion = '45'").get(botaId), "una cantidad mal escrita no crea la talla");

titulo("la ficha: el número se escribe y se guarda");
html = await (await pedir(`/panel/inventario/p/${botaId}`)).text();
ok(new RegExp(`data-cantidad="${botas[2].id}"[^>]*data-vista="5"`).test(html), "cada talla muestra su cantidad en una casilla editable");
ok(/placeholder="—"/.test(html) && /data-n-todas/.test(html) && /data-otras=/.test(html), "con los totales listos para ponerse al día sin recargar");
ok(/\/panel\/inventario\/cantidad/.test(html) && /Deshacer/.test(html), "y avisa con Deshacer");
let cant = await json("/panel/inventario/cantidad", { variante: botas[2].id, sede: sede.id, nueva: 9, vista: 5, quien: "Ana" });
ok(cant.ok && cant.queda === 9 && cant.delta === 4 && cant.anterior === 5 && stockDe(botas[2].id) === 9, "la ruta guarda y contesta cuánto quedó", JSON.stringify(cant));
cant = await json("/panel/inventario/cantidad", { variante: botas[2].id, sede: sede.id, nueva: cant.anterior, vista: cant.queda });
ok(cant.ok && cant.queda === 5 && stockDe(botas[2].id) === 5, "Deshacer vuelve a lo de antes (otro movimiento, nada se borra)");
ok(movimientos(botas[2].id).length === 3, "y el historial cuenta las tres cosas", JSON.stringify(movimientos(botas[2].id).map((x) => x.delta)));
cant = await json("/panel/inventario/cantidad", { variante: botas[2].id, sede: sede.id, nueva: "-3", vista: 5 });
ok(!cant.ok && /entero/.test(cant.error) && stockDe(botas[2].id) === 5, "un número mal escrito se rechaza con su motivo", cant.error);
cant = await json("/panel/inventario/cantidad", { variante: botas[2].id, sede: sede.id, nueva: 0, vista: 99 });
ok(!cant.ok && /negativo/.test(cant.error) && cant.queda === 5 && stockDe(botas[2].id) === 5, "y uno que dejaría el stock en negativo, también, y dice cuánto queda de verdad para que la casilla se corrija", JSON.stringify(cant));
const sinSesion = await atenderPanel(new Request("https://bot.test/panel/inventario/cantidad", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }), ENV, { tienda: "Prueba" });
const textoSinSesion = await sinSesion.text();
ok(!/"queda"/.test(textoSinSesion) && stockDe(botas[2].id) === 5, "sin la clave del panel no se puede", `${sinSesion.status} · ${textoSinSesion.slice(0, 60)}`);

/* ── Las ventas de otro día ──────────────────────────────────────────── */

titulo("momentoDeLaVenta: qué fechas valen");
const ahora = Date.UTC(2026, 9, 9, 15, 0, 0); // 9-oct-2026, 11:00 en Caracas
ok(inv.momentoDeLaVenta("", ahora) === null && inv.momentoDeLaVenta(undefined, ahora) === null && inv.momentoDeLaVenta("2026-10-09", ahora) === null, "vacío y hoy: cuenta desde ahora mismo");
const deAyer = inv.momentoDeLaVenta("2026-10-08", ahora);
ok(neg.diaDe(deAyer) === "2026-10-08" && new Date(deAyer).toISOString() === "2026-10-08T16:00:00.000Z", "ayer cuenta a mediodía de Caracas (16:00 UTC), dentro de ese día", new Date(deAyer).toISOString());
ok(neg.diaDe(inv.momentoDeLaVenta("2026-01-01", ahora)) === "2026-01-01", "un día de hace meses, también");
for (const [malo, regex] of [["2026-10-10", /todavía no llega/], ["2027-01-01", /todavía no llega/], ["2026-02-31", /no es válida/], ["ayer", /no es válida/], ["2026-13-01", /no es válida/], ["08/10/2026", /no es válida/], ["2024-01-01", /más de un año/]]) {
  const x = await falla(Promise.resolve().then(() => inv.momentoDeLaVenta(malo, ahora)));
  ok(regex.test(x?.message || ""), `«${malo}» no vale`, x?.message);
}
for (const [hora, donde] of [[12, "8:00"], [17, "13:00"], [23, "19:00"], [3, "23:00 del día anterior"]]) {
  const aquel = Date.UTC(2026, 9, 9, hora, 0, 0);
  const elMasViejo = new Date(aquel - 4 * 3600000 - 400 * DIA).toISOString().slice(0, 10); // lo que ofrece el calendario como primer día
  const elAnterior = new Date(aquel - 4 * 3600000 - 401 * DIA).toISOString().slice(0, 10);
  const valido = await falla(Promise.resolve().then(() => inv.momentoDeLaVenta(elMasViejo, aquel)));
  const pasado = await falla(Promise.resolve().then(() => inv.momentoDeLaVenta(elAnterior, aquel)));
  ok(!valido && /más de un año/.test(pasado?.message || ""), `a las ${donde} de Caracas el día más lejano que ofrece el calendario (${elMasViejo}) vale y el siguiente hacia atrás no`, valido?.message);
}
const nocheEnCaracas = Date.UTC(2026, 9, 9, 2, 0, 0); // 8-oct, 22:00 en Caracas
const mananaEnCaracas = await falla(Promise.resolve().then(() => inv.momentoDeLaVenta("2026-10-09", nocheEnCaracas)));
ok(neg.diaDe(nocheEnCaracas) === "2026-10-08" && inv.momentoDeLaVenta("2026-10-08", nocheEnCaracas) === null && /todavía no llega/.test(mananaEnCaracas?.message || ""), "a las 22:00 de Caracas «hoy» es el día de Caracas (8), no el de UTC (9)");

titulo("una venta de ayer cuenta en ayer");
const camisa = await inv.guardarProducto(DB, { origen: "manual", titulo: "Camisa del día", precio: 20, costo: 8 });
const [cm, cl] = await inv.guardarVariantes(DB, camisa, [{ opcion: "M" }, { opcion: "L" }]);
await inv.cargarCantidades(DB, { sedeId: sede.id, filas: [{ varianteId: cm, cantidad: 10 }, { varianteId: cl, cantidad: 10 }] });
const lugar = (dia) => neg.periodoDe(new URLSearchParams(`desde=${dia}&hasta=${dia}`));
const antesDeHoy = (await neg.resumen(DB, lugar(hoy))).ventas.cantidad;
const antesDeAyer = (await neg.resumen(DB, lugar(ayer))).ventas.cantidad;
const va = await inv.cobrar(DB, { sedeId: sede.id, quien: "Ana", metodoPago: "Efectivo", items: [{ varianteId: cm, cantidad: 2 }], fecha: ayer });
const fila = sql.prepare("SELECT creado, registrada FROM inv_ventas WHERE id = ?").get(va.ventaId);
ok(va.deOtroDia && neg.diaDe(fila.creado) === ayer && Math.abs(fila.registrada - Date.now()) < 5000, "creado cae en ayer y «registrada» guarda cuándo se anotó de verdad", `${neg.diaDe(fila.creado)} · ${fila.registrada}`);
ok(stockDe(cm) === 8, "el stock baja HOY, al anotarla");
const movVenta = sql.prepare("SELECT creado, nota FROM inv_movimientos WHERE venta_id = ?").get(va.ventaId);
ok(neg.diaDe(movVenta.creado) === ayer && /anotada después/.test(movVenta.nota), "el movimiento queda en ayer y dice «anotada después»", JSON.stringify(movVenta));
ok((await neg.resumen(DB, lugar(ayer))).ventas.cantidad === antesDeAyer + 1 && (await neg.resumen(DB, lugar(hoy))).ventas.cantidad === antesDeHoy, "el balance de ayer la cuenta; el de hoy no");
const ventasAyer = await neg.listarVentas(DB, lugar(ayer));
ok(ventasAyer.some((v) => v.id === va.ventaId) && neg.anotadaDespues(ventasAyer.find((v) => v.id === va.ventaId)), "Ventas de ayer la lista, marcada como anotada después");
const vh = await inv.cobrar(DB, { sedeId: sede.id, metodoPago: "Efectivo", items: [{ varianteId: cm, cantidad: 1 }], fecha: hoy });
ok(!vh.deOtroDia && sql.prepare("SELECT registrada FROM inv_ventas WHERE id = ?").get(vh.ventaId).registrada === null && !neg.anotadaDespues(await neg.verVenta(DB, vh.ventaId)), "poner la fecha de hoy es una venta de siempre");
const v0 = await inv.cobrar(DB, { sedeId: sede.id, metodoPago: "Efectivo", items: [{ varianteId: cm, cantidad: 1 }] });
ok(!v0.deOtroDia && v0.fecha > Date.now() - 5000, "y sin fecha, también");
ok(neg.anotadaDespues({ creado: 1000, registrada: 1000 + 60 * 60 * 1000 }) === false && neg.anotadaDespues({ creado: 1000, registrada: 1000 + 7 * 60 * 60 * 1000 }) === true && neg.anotadaDespues({ creado: 5 }) === false, "«anotada después» solo si pasaron más de 6 horas");

titulo("lo que no se puede anotar");
const antesDelStock = stockDe(cl);
for (const [fecha, regex] of [[neg.diaDe(Date.now() + 2 * DIA), /todavía no llega/], ["2026-02-31", /no es válida/], ["2020-05-05", /más de un año/]]) {
  const x = await falla(inv.cobrar(DB, { sedeId: sede.id, metodoPago: "Efectivo", items: [{ varianteId: cl, cantidad: 1 }], fecha }));
  ok(regex.test(x?.message || "") && stockDe(cl) === antesDelStock, `«${fecha}» se rechaza y el stock no se toca`, x?.message);
}
const sinStockAyer = await falla(inv.cobrar(DB, { sedeId: sede.id, metodoPago: "Efectivo", items: [{ varianteId: cl, cantidad: 99 }], fecha: ayer }));
ok(sinStockAyer?.name === "SinStock", "y una de ayer también respeta que no se puede vender lo que no hay");

titulo("el fiado de anteayer debe desde anteayer");
await inv.cobrar(DB, { sedeId: sede.id, fiado: true, cliente: "Pepe Prueba", telefono: "0414-555-0000", items: [{ varianteId: cl, cantidad: 1 }], fecha: anteayer });
const fiado = (await neg.listarFiados(DB)).find((f) => f.cliente === "Pepe Prueba");
ok(fiado && neg.diaDe(fiado.desde) === anteayer, "«debe desde» es el día de la venta, no el día en que se anotó", fiado ? neg.diaDe(fiado.desde) : "sin fiado");

titulo("anular una venta de ayer");
const stockAntesDeAnular = stockDe(cm);
const an = await inv.anularVenta(DB, va.ventaId, { quien: "Ana", motivo: "se anotó dos veces" });
ok(an.devueltas === 2 && stockDe(cm) === stockAntesDeAnular + 2, "devuelve el stock", String(stockDe(cm)));
ok(neg.diaDe(sql.prepare("SELECT creado FROM inv_ventas WHERE id = ?").get(va.ventaId).creado) === ayer && sql.prepare("SELECT anulada FROM inv_ventas WHERE id = ?").get(va.ventaId).anulada === 1, "y la venta sigue siendo de ayer, marcada como anulada");
ok((await neg.resumen(DB, lugar(ayer))).ventas.cantidad === antesDeAyer, "sale del balance de ayer");

titulo("el conteo que ya traía la venta descontada");
const gorra = await inv.guardarProducto(DB, { origen: "manual", titulo: "Gorra contada", precio: 15 });
const [gr1, gr2] = await inv.guardarVariantes(DB, gorra, [{ opcion: "única" }, { opcion: "negra" }]);
await inv.moverStock(DB, { varianteId: gr1, sedeId: sede.id, tipo: "entrada", cantidad: 10 });
await inv.ajustarStock(DB, { varianteId: gr2, sedeId: sede.id, cantidad: 10 });
const conAviso = await inv.cobrar(DB, { sedeId: sede.id, metodoPago: "Efectivo", items: [{ varianteId: gr1, cantidad: 1 }, { varianteId: gr2, cantidad: 1 }], fecha: ayer });
ok(conAviso.contadasDespues.length === 1 && conAviso.contadasDespues[0].varianteId === gr2 && /Gorra contada \(negra\)/.test(conAviso.contadasDespues[0].nombre), "avisa solo de la que se CONTÓ después de esa fecha (no de la que solo tuvo una entrada)", JSON.stringify(conAviso.contadasDespues));
const deHoy = await inv.cobrar(DB, { sedeId: sede.id, metodoPago: "Efectivo", items: [{ varianteId: gr2, cantidad: 1 }] });
ok(deHoy.contadasDespues.length === 0, "una venta de hoy nunca avisa");

titulo("el aviso del conteo también mira lo escrito en la ficha");
const lote = await inv.guardarProducto(DB, { origen: "manual", titulo: "Lote de la ficha", precio: 10 });
const [f1, f2, f3, f4] = await inv.guardarVariantes(DB, lote, [{ opcion: "1" }, { opcion: "2" }, { opcion: "3" }, { opcion: "4" }]);
for (const id of [f1, f2, f3, f4]) await inv.moverStock(DB, { varianteId: id, sedeId: sede.id, tipo: "entrada", cantidad: 10 });
await inv.cambiarCantidad(DB, { varianteId: f1, sedeId: sede.id, nueva: 12, vista: 10 }); // la ficha SUBE el número (se guarda como entrada)
const subio = await inv.cambiarCantidad(DB, { varianteId: f2, sedeId: sede.id, nueva: 12, vista: 10 });
await inv.cambiarCantidad(DB, { varianteId: f2, sedeId: sede.id, nueva: subio.anterior, vista: subio.queda }); // y lo deshace: nadie contó nada
await inv.cambiarCantidad(DB, { varianteId: f3, sedeId: sede.id, nueva: 8, vista: 10 }); // la ficha BAJA el número (se guarda como ajuste)
await inv.moverStock(DB, { varianteId: f4, sedeId: sede.id, tipo: "entrada", cantidad: 3 }); // llegó mercancía de verdad
const lasQueAvisan = await inv.cobrar(DB, { sedeId: sede.id, metodoPago: "Efectivo", items: [f1, f2, f3, f4].map((id) => ({ varianteId: id, cantidad: 1 })), fecha: ayer });
const idsAvisados = lasQueAvisan.contadasDespues.map((x) => x.varianteId).sort((a, b) => a - b);
ok(JSON.stringify(idsAvisados) === JSON.stringify([f1, f3].sort((a, b) => a - b)), "avisa la que subió y la que bajó desde la ficha; NO la deshecha, ni la que solo recibió mercancía", JSON.stringify(idsAvisados) + " · esperaba " + [f1, f3]);

titulo("el historial por fecha");
const recientes = await inv.movimientosRecientes(DB, { limite: 500 });
const iVieja = recientes.findIndex((x) => x.venta_id === va.ventaId && x.tipo === "venta");
const iNueva = recientes.findIndex((x) => x.venta_id === v0.ventaId && x.tipo === "venta");
ok(iNueva >= 0 && iVieja > iNueva, "un movimiento de ayer sale DESPUÉS de los de hoy, aunque se anotó después", `${iNueva} < ${iVieja}`);
const ventasDeHoy = await inv.ventasDelDia(DB, 0);
ok(ventasDeHoy.findIndex((x) => x.id === va.ventaId) > ventasDeHoy.findIndex((x) => x.id === v0.ventaId), "y en la lista de ventas igual");

titulo("la caja y la ficha en pantalla");
html = await (await pedir("/panel/caja")).text();
ok(/name="dia" value="hoy" checked/.test(html) && /name="dia" value="ayer"/.test(html) && /name="dia" value="otro"/.test(html), "la caja pregunta «Venta de»: Hoy, Ayer, Otro día");
ok(new RegExp(`id="fecha-otro"[^>]*max="${hoy}"`).test(html) && /min="\d{4}-\d{2}-\d{2}"/.test(html), "con el calendario que no deja pasar de hoy ni de hace más de un año");
ok(/id="cobrar-texto"/.test(html) && /id="exito-avisos"/.test(html) && /Anotar la venta/.test(html), "el botón cambia a «Anotar la venta» y el recibo muestra los avisos");
ok(scriptsCompilan(html).length === 0, "el script de la caja compila", scriptsCompilan(html).join(" | "));
html = await (await pedir(`/panel/inventario/p/${gorra}`)).text();
ok(/name="fecha"/.test(html) && /Día de la venta/.test(html), "«Vendí» también deja poner el día");

titulo("lo que manda el botón Cobrar");
const cobrarEnCaja = (cuerpo, opciones) => json("/panel/caja/cobrar", cuerpo, opciones);
let caja = await cobrarEnCaja({ sede: sede.id, metodo: "Pago móvil", fecha: ayer, items: [{ variante: cm, cantidad: 1 }] });
ok(caja.ok && caja.deOtroDia === true && typeof caja.fechaTexto === "string" && caja.fechaTexto.length > 3 && Array.isArray(caja.avisos), "de ayer: lo dice, con el día en letras", JSON.stringify(caja).slice(0, 200));
ok(neg.diaDe(sql.prepare("SELECT creado FROM inv_ventas WHERE id = ?").get(caja.ventaId).creado) === ayer, "y quedó en ayer");
ok(/Recibo #\d+ · /.test(neg.textoDelRecibo(await neg.verVenta(DB, caja.ventaId), "Tienda")), "el recibo para WhatsApp lleva la fecha de la venta");
caja = await cobrarEnCaja({ sede: sede.id, metodo: "Efectivo", fecha: ayer, items: [{ variante: gr2, cantidad: 1 }] });
ok(caja.ok && caja.avisos.length === 1 && /se contó o se cambió a mano el/.test(caja.avisos[0]) && /Mover › Entrada/.test(caja.avisos[0]), "el aviso del conteo llega escrito para la persona", caja.avisos?.[0]);
const stockAntes = stockDe(cm);
caja = await cobrarEnCaja({ sede: sede.id, metodo: "Efectivo", fecha: neg.diaDe(Date.now() + 3 * DIA), items: [{ variante: cm, cantidad: 1 }] });
ok(!caja.ok && /todavía no llega/.test(caja.error) && stockDe(cm) === stockAntes, "una fecha futura da error, sin cobrar nada", caja.error);
caja = await cobrarEnCaja({ sede: sede.id, metodo: "Efectivo", items: [{ variante: cm, cantidad: 1 }] });
ok(caja.ok && caja.deOtroDia === false && caja.avisos.length === 0, "sin fecha: una venta de siempre");

titulo("lo que revisó el navegador");
html = await (await pedir(`/panel/inventario/p/${botaId}`)).text();
ok(!/\sdata-mover="/.test(html) && /data-mover-variante="/.test(html), "el botón Mover no usa data-mover (el carrusel de alpha.js lo toma y le quita el clic)");
ok(/class="cant-editable[^"]*"[^>]*autocomplete="off"/.test(html), "las casillas de la ficha no se dejan reponer por el navegador al volver atrás");
ok(/data-una-vez/.test(html) && /Cuántas llegaron de cada talla/.test(html) && /Se suman a lo que ya hay/.test(html), "«Añadir tallas» dice que lo que se escribe SE SUMA, y se manda una sola vez");
html = await (await pedir("/panel/inventario/nuevo")).text();
ok(/action="\/panel\/inventario\/nuevo"[^>]*data-una-vez/.test(html) && /name="cantidad" data-grilla-igual[^>]*autocomplete="off"/.test(html), "«Nuevo producto» también se manda una sola vez y sus casillas no se reponen");
html = await (await pedir("/panel/caja")).text();
ok(/name="dia" value="ayer" autocomplete="off"/.test(html) && /id="fecha-otro" hidden autocomplete="off"/.test(html) && /var diaAyer=/.test(html), "la caja no deja que «Atrás» traiga un «Ayer» viejo, y «Ayer» se fija al elegirlo");
html = await (await pedir(`/panel/inventario/p/${botaId}?cuenta=${encodeURIComponent("«X» se contó <script>alert(1)</script>")}`)).text();
ok(/class="aviso-fijo"/.test(html) && !/<script>alert\(1\)<\/script>/.test(html) && /&lt;script&gt;/.test(html), "un aviso que no se va solo se ve en la ficha, con el texto escapado");
ok(scriptsCompilan(html).length === 0, "y los scripts de la ficha siguen compilando", scriptsCompilan(html).join(" | "));

titulo("Vendí con el día");
rr = await pedir("/panel/inventario/mover", {}, { method: "POST", body: formulario([["variante", cm], ["sede", sede.id], ["tipo", "venta"], ["cantidad", 1], ["metodo", "Efectivo"], ["fecha", anteayer], ["volver", `/panel/inventario/p/${camisa}`]]) });
const ultimaVenta = sql.prepare("SELECT id, creado FROM inv_ventas ORDER BY id DESC LIMIT 1").get();
ok(rr.status === 303 && neg.diaDe(ultimaVenta.creado) === anteayer && /del/.test(donde(rr)), "la venta queda en el día puesto y el aviso lo dice", donde(rr));
rr = await pedir("/panel/inventario/mover", {}, { method: "POST", body: formulario([["variante", cm], ["sede", sede.id], ["tipo", "venta"], ["cantidad", 1], ["fecha", "2099-01-01"], ["volver", `/panel/inventario/p/${camisa}`]]) });
ok(/error=/.test(rr.headers.get("location") || "") && sql.prepare("SELECT id FROM inv_ventas ORDER BY id DESC LIMIT 1").get().id === ultimaVenta.id, "y con un día futuro, error y nada se vende");
rr = await pedir("/panel/inventario/mover", {}, { method: "POST", body: formulario([["variante", gr2], ["sede", sede.id], ["tipo", "venta"], ["cantidad", 1], ["fecha", ayer], ["volver", `/panel/inventario/p/${gorra}`]]) });
const ir = donde(rr);
ok(/[?&]cuenta=/.test(ir) && /se contó o se cambió a mano/.test(ir) && !/ok=[^&]*súmale/.test(ir), "si el producto se contó después, el aviso va aparte (no se va solo como la tostada)", ir);

titulo("Ventas y el recibo");
html = await (await pedir(`/panel/ventas?desde=${ayer}&hasta=${ayer}`)).text();
ok(/anotada después/.test(html), "Ventas marca las anotadas después");
html = await (await pedir(`/panel/ventas/${va.ventaId}`)).text();
ok(/Anotada el /.test(html), "el recibo dice cuándo se anotó");
html = await (await pedir(`/panel/ventas/${vh.ventaId}`)).text();
ok(!/Anotada el /.test(html), "y el de una venta de hoy no dice nada raro");

terminar();
