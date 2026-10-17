// POWER BANKS DEL INVENTARIO (14-oct-2026, "tenemos errores con el mismo
// powerbank"). Con el inventario real, un cliente que pide power banks:
//   · los ve TODOS aunque el nombre no diga "powerbank" (por la categoría o
//     por los mAh: "Xiaomi 20000mAh", "Baseus 30.000 mAh");
//   · "de 20000" encuentra el 20.000mAh y el 20000mAh (la cifra con punto,
//     pegada a "mAh" o separada es la misma);
//   · "power bank" separado no confunde, y las cifras de un power bank son
//     capacidad, no un "modelo" que no está (antes: «justo ese no me queda,
//     pero el de 10000 es de la misma familia»);
//   · un producto en dos colores es una sola tarjeta.
//
//   python3 pruebas/preparar.py && node pruebas/powerbanks-inventario.mjs
import { DatabaseSync } from "node:sqlite";
import { turno, baseFalsa } from "./banco.mjs";
import * as inv from "./.stub/inventario.js";
import { olvidarElInventario } from "./.stub/sheets.js";
import { tipoDelProducto } from "./.stub/tipos.js";

let fallos = 0;
const comprobar = (n, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};

function base(fila) {
  const sql = new DatabaseSync(":memory:");
  const preparada = (c, a = []) => ({ bind: (...x) => preparada(c, x), run: async () => (sql.prepare(c).run(...a), { success: true }), all: async () => ({ results: sql.prepare(c).all(...a) }), first: async () => sql.prepare(c).get(...a) ?? null });
  const falsa = baseFalsa({ id: "cliente1", ...fila });
  const real = { prepare: (c) => preparada(c), batch: async (l) => { for (const x of l) await x.run(); } };
  return { real, filas: falsa.filas, batch: (l) => real.batch(l), prepare: (c) => (/\binv_|mensajes_recibidos/.test(c) ? real.prepare(c) : falsa.prepare(c)) };
}

const GAR = "Powerbank 20.000mAh GAr 158";
const AORAX = "Power Bank Aorax 10000mAh";
const XIAOMI = "Xiaomi 20000mAh 22.5W"; // categoría Powerbanks
const BASEUS = "Baseus Bipow 30.000 mAh"; // categoría Accesorios: solo los mAh lo dicen
const ANKER = "Cargador portátil Anker 10000";
const REDMI = "Redmi 17 4G";
const PRODUCTOS = [
  [GAR, "GAr", 30, 38, "Powerbanks", [["única", ""]]],
  [AORAX, "Aorax", 18, 22, "Powerbanks", [["única", ""]]],
  [XIAOMI, "Xiaomi", 35, 45, "Powerbanks", [["única", ""]]],
  [BASEUS, "Baseus", 50, 60, "Accesorios", [["única", "Negro"], ["única", "Blanco"]]],
  [ANKER, "Anker", 28, 34, "Cargadores", [["única", ""]]],
  [REDMI, "Xiaomi", 210, 250, "Teléfonos", [["128GB", ""], ["256GB", ""]]],
];
const titulos = (e) => e.flatMap((m) => m.attachment?.payload?.elements || []).map((f) => f.title);
const textos = (e) => e.filter((m) => m.text).map((m) => m.text).join(" ");
const log = console.log;

async function pedir(msg, buscar, { vio = [] } = {}) {
  const DB = base({ historial: "Ya di la bienvenida.", ultimos_productos: JSON.stringify(vio), mostrados: JSON.stringify(vio) });
  console.log = () => {}; console.error = () => {};
  inv.olvidarQueEstaListo();
  const [sede] = await inv.sedes(DB.real);
  for (const [t, m, p, c, cat, vars] of PRODUCTOS) {
    const id = await inv.guardarProducto(DB.real, { origen: "manual", titulo: t, marca: m, precio: p, precio_cashea: c, extras: { categoria: cat } });
    const vs = await inv.guardarVariantes(DB.real, id, vars.map(([opcion, color]) => ({ opcion, color })));
    for (const v of vs) await inv.ajustarStock(DB.real, { varianteId: v, sedeId: sede.id, cantidad: 2 });
    await DB.real.prepare("INSERT INTO inv_fotos (producto_id, url, orden) VALUES (?, ?, 0)").bind(id, `https://w/img/${id}.jpg`).run();
  }
  olvidarElInventario();
  const r = await turno({ texto: msg, db: DB, env: { USAR_HOJA: "" }, respuestaDelModelo: { respuesta: "¡Claro! Mira 👇", buscar } });
  console.log = log; console.error = log;
  return r.enviados;
}

const TODOS = [AORAX, ANKER, BASEUS, GAR, XIAOMI].sort();

comprobar("los mAh del nombre dicen que es power bank", [tipoDelProducto(BASEUS), tipoDelProducto("Redmi 17 5000mAh"), tipoDelProducto(REDMI)], ["powerbank", "telefono", "telefono"]);

for (const [msg, buscar] of [["Powerbanks", "NADA"], ["muestrame los power bank", "powerbank"], ["bateria portatil", "NADA"]]) {
  comprobar(`«${msg}» trae los 5, también los que no dicen «powerbank»`, titulos(await pedir(msg, buscar)).sort(), TODOS);
}
comprobar("«Powerbank» después de ver el GAr: salen todos y el visto al final", titulos(await pedir("Powerbank", GAR, { vio: [GAR] })).slice(-1), [GAR]);
comprobar("…sin repetir el Baseus por sus dos colores", titulos(await pedir("Powerbanks", "NADA")).filter((t) => t === BASEUS).length, 1);

for (const [msg, buscar] of [["tienen power bank de 20000?", "power bank 20000"], ["power banks de 20000", "power bank 20000"], ["powerbank de 20000", "powerbank 20000mAh"]]) {
  const e = await pedir(msg, buscar);
  comprobar(`«${msg}»: el GAr 20.000mAh y el Xiaomi 20000mAh`, titulos(e).sort(), [GAR, XIAOMI].sort());
  comprobar("   y sin «justo ese no me queda»", /no me queda|no tengo|misma familia/i.test(textos(e)), false);
}
comprobar("«tienes algo de 30000 mah»: el Baseus (30.000 mAh)", titulos(await pedir("tienes algo de 30000 mah", "30000mAh")), [BASEUS]);
comprobar("«powerbank de 10000»: solo el de 10000", titulos(await pedir("powerbank de 10000", "powerbank 10000mAh")), [AORAX]);

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
