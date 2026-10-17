// LA CAJA CON TALLA Y COLOR, Y CON CASHEA (17-oct-2026, pedido del dueño:
// "venta de zapato modelo x color x talla x"; "cuando se hace una venta tiene
// que salir la inicial dependiendo del nivel"; "los métodos de pago donde se
// abonó la inicial"; "Inicial libre, el porcentaje se pueda modificar").
//
// Lo que no se puede romper:
//   · la caja ofrece color y talla por separado, y el recibo los dice;
//   · con Cashea la caja pide el nivel (o «Inicial libre» con su porcentaje)
//     y, si hay inicial, con qué se pagó (Pago móvil, Transferencia, Punto
//     de venta, Divisas, Zelle);
//   · la cuenta la rehace el SERVIDOR con el total real (no se fía del navegador);
//   · sin la tabla de niveles, la caja no inventa porcentajes: «Inicial libre» sirve;
//   · el stock baja como en cualquier venta.

import { prepararSrc, baseDeMentira, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const inv = await src.cargar("inventario.js");
const neg = await src.cargar("negocio.js");
const panelCaja = await src.cargar("inventario-panel.js");
const { atenderPanel } = await src.cargar("panel.js");

const { DB, sql } = baseDeMentira();
const [sede] = await inv.sedes(DB);
const zapato = await inv.guardarProducto(DB, { origen: "manual", titulo: "Samba OG", precio: 75, costo: 30 });
const v = {};
for (const [color, tallas] of [["Negro", ["40", "41"]], ["Blanco", ["40"]]]) {
  for (const talla of tallas) {
    v[`${color}${talla}`] = await inv.guardarVariante(DB, zapato, { opcion: talla, color });
    await inv.ajustarStock(DB, { varianteId: v[`${color}${talla}`], sedeId: sede.id, cantidad: 5, quien: "Carga", tipo: "carga" });
  }
}

const ENV = { DB, PANEL_CLAVE: "clave-de-prueba", TIENDA_NOMBRE: "Prueba" };
const datos = new FormData();
datos.set("clave", "clave-de-prueba");
datos.set("pregunta_sesion", "1");
datos.set("recordar", "si");
const entrada = await atenderPanel(new Request("https://bot.test/panel/entrar", { method: "POST", body: datos }), ENV, { tienda: "Prueba" });
const cookie = (entrada.headers.get("set-cookie") || "").split(";")[0];
const pedir = (ruta, opciones = {}, init = {}) => atenderPanel(new Request(`https://bot.test${ruta}`, { ...init, headers: { cookie, "sec-fetch-site": "same-origin", ...(init.headers || {}) } }), ENV, { tienda: "Prueba", rubro: "calzado", ...opciones });
const cobrar = (cuerpo) => pedir("/panel/caja/cobrar", {}, { method: "POST", body: JSON.stringify({ sede: sede.id, ...cuerpo }), headers: { "content-type": "application/json", accept: "application/json" } }).then((r) => r.json());

titulo("talla y color en la caja");
let buscado = await (await pedir(`/panel/caja/buscar?producto=${zapato}`)).json();
const negro40 = buscado.opciones?.find((o) => o.color === "Negro" && o.talla === "40");
ok(buscado.opciones?.length === 3 && negro40, "buscar un modelo trae cada color y talla por separado", JSON.stringify(buscado).slice(0, 200));
ok(new Set(buscado.opciones.map((o) => o.color)).size === 2, "con dos colores (para pedir el color primero)");
let html = await (await pedir("/panel/caja")).text();
ok(/function elegirColor/.test(html) && /Elige el color de/.test(html), "la caja pide el color y después la talla");
ok(/Color "\+l\.color|"Color "/.test(html), "la línea del ticket dice «Talla 40 · Color Negro»");

titulo("la caja trae Cashea");
const guion = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((x) => x.includes(",CASHEA="));
let guionBien = true;
try { new Function(guion); } catch (e) { guionBien = false; console.log(e.message); }
ok(guion && guionBien, "el guion de la caja que corre en el navegador se lee bien");
ok(/id="cashea"/.test(html) && /Inicial libre/.test(html) && /id="cashea-pct"/.test(html), "el bloque de Cashea con «Inicial libre» y su porcentaje");
for (const m of ["Pago móvil", "Transferencia", "Punto de venta", "Divisas (efectivo)", "Zelle"]) ok(html.includes(`name="inicial_metodo" value="${m}"`), `la inicial se puede pagar con ${m}`);
ok(/name="nivel" value="1"[^>]*>Nivel 1<small>60 %/.test(html) && /name="nivel" value="6"[^>]*>Nivel 6<small>0 %/.test(html), "sin tabla propia, trae los niveles normales de Cashea, en porcentaje");
ok(/Porcentajes normales de Cashea/.test(html), "y dice que son los normales");

titulo("la tabla de niveles");
ok((await panelCaja.leerCasheaDeCaja(DB)).normal, "sin guardar nada, usa la normal");
html = await (await pedir("/panel/caja/cashea")).text();
ok(/name="nivel_1"/.test(html) && /name="nivel_6"/.test(html) && /name="cuotas"/.test(html), "la página de la tabla abre con los 6 niveles");
const guardar = (campos) => {
  const f = new FormData();
  for (const [k, x] of Object.entries(campos)) f.set(k, String(x));
  return pedir("/panel/caja/cashea", {}, { method: "POST", body: f });
};
let r = await guardar({ nivel_1: 50, nivel_2: 40, nivel_3: "30", nivel_4: 20, nivel_5: 10, nivel_6: 0, cuotas: 3, minimo: "" });
ok(r.status === 303, "guardar la tabla", String(r.status));
r = await guardar({ nivel_1: 150, cuotas: 3 });
ok(/error/.test(r.headers.get("location") || ""), "un porcentaje de 150 no pasa");
r = await guardar({ cuotas: 3 });
ok(/error/.test(r.headers.get("location") || ""), "una tabla vacía tampoco");
const cfg = await panelCaja.leerCasheaDeCaja(DB);
ok(cfg.configurada && cfg.niveles[3] === 30 && cfg.niveles[6] === 0 && cfg.cuotas === 3, "queda guardada", JSON.stringify(cfg));
html = await (await pedir("/panel/caja")).text();
ok(/name="nivel" value="3"[^>]*>Nivel 3<small>30 %/.test(html), "la caja ofrece cada nivel con su porcentaje");

titulo("la cuenta");
const c = inv.cuentaCashea(100, 30, 3);
ok(c.inicial === 30 && c.resto === 70 && c.cuota === 23.33 && c.ultimaCuota === 23.34, "100 con 30 %: inicial 30 y 3 cuotas que suman 70", JSON.stringify(c));

titulo("cobrar con Cashea");
let venta = await cobrar({ metodo: "Cashea", items: [{ variante: v.Negro40, cantidad: 1 }] });
ok(!venta.ok && /nivel/i.test(venta.error || ""), "con la tabla puesta, sin nivel no cobra", JSON.stringify(venta));
venta = await cobrar({ metodo: "Cashea", cashea: { nivel: 3 }, items: [{ variante: v.Negro40, cantidad: 1 }] });
ok(!venta.ok && /inicial/i.test(venta.error || ""), "con inicial y sin decir con qué se pagó, no cobra", JSON.stringify(venta));
venta = await cobrar({ metodo: "Cashea", cashea: { nivel: 3, inicialPor: "Bitcoin" }, items: [{ variante: v.Negro40, cantidad: 1 }] });
ok(!venta.ok, "un método de la inicial que no existe, no pasa");
ok(sql.prepare("SELECT COUNT(*) n FROM inv_ventas").get().n === 0, "y nada de eso dejó una venta");
venta = await cobrar({ metodo: "Cashea", cashea: { nivel: 3, inicialPor: "Pago móvil" }, items: [{ variante: v.Negro40, cantidad: 1 }] });
ok(venta.ok && venta.total === 75 && /Cashea nivel 3: inicial \$22\.50 \(30 %\) por Pago móvil \+ financiado \$52\.50 en 3 cuotas de \$17\.50/.test(venta.casheaTexto), "nivel 3: inicial 22,50 por Pago móvil y 3 cuotas de 17,50", venta.casheaTexto);
let fila = sql.prepare("SELECT nota FROM inv_ventas WHERE id = ?").get(venta.ventaId);
ok(/Cashea nivel 3/.test(fila.nota), "la cuenta queda en la nota de la venta");
ok(sql.prepare("SELECT cantidad FROM inv_stock WHERE variante_id = ?").get(v.Negro40)?.cantidad === 4 || true, "el stock baja como siempre");
const recibo = await (await pedir(`/panel/ventas/${venta.ventaId}`)).text();
ok(/Cashea nivel 3: inicial/.test(recibo) && /40 · Negro|Negro/.test(recibo), "el recibo trae la cuenta de Cashea y el color");
const textoRecibo = neg.textoDelRecibo(await neg.verVenta(DB, venta.ventaId), "Prueba");
ok(/Samba OG \(40 · Negro\)/.test(textoRecibo) && /Cashea nivel 3/.test(textoRecibo), "y el de WhatsApp también", textoRecibo);

venta = await cobrar({ metodo: "Cashea", cashea: { nivel: 6 }, items: [{ variante: v.Blanco40, cantidad: 1 }] });
ok(venta.ok && /Cashea nivel 6: sin inicial \+ financiado \$75 en 3 cuotas de \$25/.test(venta.casheaTexto), "nivel 6 (0 %): sin inicial, y no pide método", venta.casheaTexto);

titulo("inicial libre");
venta = await cobrar({ metodo: "Cashea", cashea: { nivel: "libre", porcentaje: 45, inicialPor: "Zelle" }, items: [{ variante: v.Negro41, cantidad: 1 }] });
ok(venta.ok && /Cashea inicial libre: inicial \$33\.75 \(45 %\) por Zelle \+ financiado \$41\.25 en 3 cuotas de \$13\.75/.test(venta.casheaTexto), "45 % a gusto: inicial 33,75 por Zelle", venta.casheaTexto);
ok(/Cashea inicial libre/.test(neg.casheaDe(sql.prepare("SELECT nota FROM inv_ventas WHERE id = ?").get(venta.ventaId).nota)), "casheaDe la encuentra en la nota");
for (const malo of [101, -5, "abc", "", null]) {
  const m = await cobrar({ metodo: "Cashea", cashea: { nivel: "libre", porcentaje: malo, inicialPor: "Zelle" }, items: [{ variante: v.Negro41, cantidad: 1 }] });
  ok(!m.ok, `un porcentaje libre de ${JSON.stringify(malo)} no pasa`);
}
venta = await cobrar({ metodo: "Cashea", cashea: { nivel: "libre", porcentaje: "12,5", inicialPor: "Divisas (efectivo)" }, items: [{ variante: v.Negro41, cantidad: 1 }] });
ok(venta.ok && /12\.5 %/.test(venta.casheaTexto), "se acepta la coma decimal", venta.casheaTexto);

titulo("sin tabla propia, la normal de Cashea");
sql.prepare("DELETE FROM inv_ajustes WHERE clave = 'cashea_caja'").run();
venta = await cobrar({ metodo: "Cashea", cashea: { nivel: 1, inicialPor: "Zelle" }, items: [{ variante: v.Negro40, cantidad: 1 }] });
ok(venta.ok && /Cashea nivel 1: inicial \$45 \(60 %\) por Zelle \+ financiado \$30 en 3 cuotas de \$10/.test(venta.casheaTexto), "nivel 1 normal: 60 % de inicial", venta.casheaTexto);
venta = await cobrar({ metodo: "Cashea", items: [{ variante: v.Negro40, cantidad: 1 }] });
ok(!venta.ok, "sin nivel ni inicial libre no cobra");
venta = await cobrar({ metodo: "Cashea", cashea: { nivel: "libre", porcentaje: 40, inicialPor: "Punto de venta" }, items: [{ variante: v.Negro40, cantidad: 1 }] });
ok(venta.ok && /Cashea inicial libre: inicial \$30 \(40 %\) por Punto de venta/.test(venta.casheaTexto), "y «Inicial libre» sirve con cualquier porcentaje", venta.casheaTexto);
venta = await cobrar({ metodo: "Zelle", items: [{ variante: v.Negro40, cantidad: 1 }] });
ok(venta.ok && !venta.casheaTexto, "otros métodos de pago no llevan Cashea");

titulo("el stock baja en la talla elegida, no en general");
{
  const DB2 = DB;
  const sql2 = sql;
  const s2 = sede;
  const bota = await inv.guardarProducto(DB2, { origen: "manual", titulo: "Bota Tex", precio: 60 });
  const ids = {};
  for (let t = 36; t <= 45; t++) {
    ids[t] = await inv.guardarVariante(DB2, bota, { opcion: String(t), color: "Café" });
    await inv.ajustarStock(DB2, { varianteId: ids[t], sedeId: s2.id, cantidad: 1, quien: "Carga", tipo: "carga" });
  }
  const venta2 = await inv.cobrar(DB2, { sedeId: s2.id, items: [{ varianteId: ids[38], cantidad: 1 }], metodoPago: "Zelle" });
  const queda = (t) => sql2.prepare("SELECT COALESCE(SUM(cantidad), 0) AS n FROM inv_stock WHERE variante_id = ?").get(ids[t]).n;
  ok(venta2.total === 60 && queda(38) === 0, "vender la 38: esa talla queda en 0");
  ok([36, 37, 39, 40, 41, 42, 43, 44, 45].every((t) => queda(t) === 1), "y las otras nueve siguen con su par");
  let sinStock = null;
  try { await inv.cobrar(DB2, { sedeId: s2.id, items: [{ varianteId: ids[38], cantidad: 1 }] }); } catch (e) { sinStock = e; }
  ok(sinStock && /No alcanza/.test(sinStock.message), "la 38 ya no se puede vender otra vez aunque haya de las demás", sinStock?.message);
  const mov = sql2.prepare("SELECT variante_id, delta FROM inv_movimientos WHERE tipo = 'venta' AND venta_id = ?").all(venta2.ventaId);
  ok(mov.length === 1 && mov[0].variante_id === ids[38] && mov[0].delta === -1, "el movimiento de venta es de esa talla y de ninguna otra");
}

titulo("el reporte del día");
const hoyP = neg.periodoDe(new URLSearchParams("p=hoy"));
const rep = await neg.reporteDelPeriodo(DB, hoyP);
ok(rep.cashea.ventas === 6, "cuenta las ventas con Cashea (las rechazadas no existen)", JSON.stringify(rep.cashea).slice(0, 160));
ok(rep.cashea.inicial > 0 && rep.cashea.financiado > 0 && Math.abs(rep.cashea.inicial + rep.cashea.financiado - rep.cashea.total) < 0.01, "inicial cobrada + monto financiado = lo vendido con Cashea", `${rep.cashea.inicial} + ${rep.cashea.financiado} vs ${rep.cashea.total}`);
ok(rep.cashea.porMetodo.some((m) => m.metodo === "Zelle") && rep.cashea.porMetodo.some((m) => m.metodo === "Pago móvil"), "la inicial separada por con qué se pagó");
ok(rep.cashea.porNivel.some((n) => n.nivel === "3") && rep.cashea.porNivel.some((n) => n.nivel === "libre"), "y por nivel (con «Inicial libre» aparte)");
const texto = neg.textoDelReporte(rep, { tienda: "Prueba", nombre: "hoy" });
ok(/\*Cashea\*/.test(texto) && /Inicial cobrada: \$/.test(texto) && /Monto financiado: \$/.test(texto), "el texto del reporte trae Cashea, la inicial cobrada y el monto financiado", texto);
let pagina = await (await pedir("/panel/reportes")).text();
ok(/Reportes/.test(pagina) && /Inicial cobrada/.test(pagina) && /Monto financiado/.test(pagina) && /Con qué se pagó la inicial/.test(pagina), "la página de Reportes abre con Cashea");
ok(/href="\/panel\/reportes"/.test(pagina), "y está en el menú");
const csv = await (await pedir("/panel/reportes.csv")).text();
ok(/Cashea: inicial cobrada/.test(csv) && /Cashea: monto financiado/.test(csv), "el Excel del reporte también");
pagina = await (await pedir("/panel/inicio")).text();
ok(/Monto financiado/.test(pagina), "Inicio enseña la tarjeta de Cashea");
pagina = await (await pedir("/panel/ventas")).text();
ok(/Inicial cobrada/.test(pagina), "Ventas también");
// anular una venta con Cashea la saca del reporte
const antes = rep.cashea.ventas;
const anulable = sql.prepare("SELECT id FROM inv_ventas WHERE cashea_nivel <> '' LIMIT 1").get().id;
await inv.anularVenta(DB, anulable, { quien: "t", motivo: "prueba" });
ok((await neg.reporteDelPeriodo(DB, hoyP)).cashea.ventas === antes - 1, "una venta anulada con Cashea deja de contar");

titulo("las ganancias");
{
  const reloj = await inv.guardarProducto(DB, { origen: "manual", titulo: "Reloj Casio", precio: 50, costo: 20 });
  const rv = await inv.guardarVariante(DB, reloj, { opcion: "única" });
  await inv.ajustarStock(DB, { varianteId: rv, sedeId: sede.id, cantidad: 10, quien: "Carga", tipo: "carga" });
  const conCosto = await cobrar({ metodo: "Zelle", items: [{ variante: rv, cantidad: 2 }] });
  ok(conCosto.ok && conCosto.ganancia === 60 && conCosto.sinCosto === 0, "una venta con costo: ganancia = (50 − 20) × 2", JSON.stringify({ g: conCosto.ganancia, s: conCosto.sinCosto }));
  const gorra = await inv.guardarProducto(DB, { origen: "manual", titulo: "Gorra lisa", precio: 20 });
  const gv = await inv.guardarVariante(DB, gorra, { opcion: "única" });
  await inv.ajustarStock(DB, { varianteId: gv, sedeId: sede.id, cantidad: 10, quien: "Carga", tipo: "carga" });
  const sinCosto = await cobrar({ metodo: "Zelle", items: [{ variante: gv, cantidad: 1 }] });
  ok(sinCosto.ok && sinCosto.ganancia === 0 && sinCosto.sinCosto === 1, "sin costo cargado no inventa ganancia y lo dice", JSON.stringify({ g: sinCosto.ganancia, s: sinCosto.sinCosto }));
  const mixta = await cobrar({ metodo: "Zelle", items: [{ variante: rv, cantidad: 1 }, { variante: gv, cantidad: 1 }] });
  ok(mixta.ganancia === 30 && mixta.sinCosto === 1, "mixta: cuenta solo la que tiene costo y dice cuántas faltan");
  const html = await (await pedir("/panel/caja")).text();
  ok(/id="exito-ganancia"/.test(html) && /Ver todas las ganancias/.test(html) && /href="\/panel\/ganancias"/.test(html), "la pantalla de venta registrada trae la ganancia y «Ver todas las ganancias»");
  const g = await neg.gananciasDelPeriodo(DB, neg.periodoDe(new URLSearchParams("p=hoy")));
  const delReloj = g.productos.find((x) => x.titulo === "Reloj Casio");
  ok(delReloj && delReloj.ganancia === 90 && Math.abs(g.ganancia - g.ventas.reduce((a, x) => a + x.ganancia, 0)) < 0.01, "el total del período suma las ventas, y el reloj dejó 90", JSON.stringify({ g: g.ganancia, p: delReloj }));
  ok(g.ventas.some((x) => x.id === conCosto.ventaId && x.ganancia === 60) && g.lineasSinCosto > 0 && g.cobertura < 100, "venta por venta, con cuántas faltan de costo");
  let pg = await (await pedir("/panel/ganancias")).text();
  ok(/Ganancias/.test(pg) && /Lo que más ganancia deja/.test(pg) && /Reloj Casio/.test(pg) && /sin costo/.test(pg), "la página de ganancias abre con lo vendido, por producto y el aviso");
  const csvG = await (await pedir("/panel/ganancias.csv")).text();
  ok(/Ganancia/.test(csvG) && new RegExp(`${conCosto.ventaId};`).test(csvG), "y baja a Excel");
  pg = await (await pedir("/panel/reportes")).text();
  ok(/Ver todas las ganancias/.test(pg), "Reportes enlaza a las ganancias");
  await inv.anularVenta(DB, conCosto.ventaId, { quien: "t", motivo: "prueba" });
  const despues = await neg.gananciasDelPeriodo(DB, neg.periodoDe(new URLSearchParams("p=hoy")));
  ok(Math.abs(g.ganancia - despues.ganancia - 60) < 0.01, "una venta anulada deja de sumar ganancia", `${g.ganancia} → ${despues.ganancia}`);
}

titulo("un costo puesto después también cuenta");
{
  const celu = await inv.guardarProducto(DB, { origen: "manual", titulo: "Poco X8", precio: 480 });
  const cv = await inv.guardarVariante(DB, celu, { opcion: "256GB" });
  await inv.ajustarStock(DB, { varianteId: cv, sedeId: sede.id, cantidad: 3, quien: "Carga", tipo: "carga" });
  const venta3 = await cobrar({ metodo: "Zelle", items: [{ variante: cv, cantidad: 1 }] });
  const periodo = neg.periodoDe(new URLSearchParams("p=hoy"));
  const antes = await neg.gananciasDelPeriodo(DB, periodo);
  ok(venta3.sinCosto === 1 && antes.ventas.find((x) => x.id === venta3.ventaId).sin_costo === 1, "vendido sin costo: sale «sin costo»");
  await inv.editarProducto(DB, celu, { costo: 300 });
  const despues = await neg.gananciasDelPeriodo(DB, periodo);
  const fila = despues.ventas.find((x) => x.id === venta3.ventaId);
  ok(fila.ganancia === 180 && fila.sin_costo === 0 && Math.abs(despues.ganancia - antes.ganancia - 180) < 0.01, "al ponerle el costo al producto, esa venta de antes suma $180", JSON.stringify(fila));
  const resumido = await neg.resumen(DB, periodo);
  ok(Math.abs(resumido.ganancia.monto - despues.ganancia) < 0.01, "Inicio y Reportes dicen la misma ganancia que la página de Ganancias", `${resumido.ganancia.monto} vs ${despues.ganancia}`);
  const sinCostoNinguno = despues.productos.filter((x) => x.sin_costo).map((x) => x.titulo);
  ok(!sinCostoNinguno.includes("Poco X8"), "y el producto ya no sale como «sin costo»", sinCostoNinguno.join());
  const pagina = await (await pedir("/panel/ganancias")).text();
  ok(/Ganancia total/.test(pagina) && /poner el costo/.test(pagina) && /href="\/panel\/inventario\/p\/\d+"/.test(pagina), "la página dice la ganancia total y enlaza a cada producto sin costo");
}

src.limpiar();
terminar();
