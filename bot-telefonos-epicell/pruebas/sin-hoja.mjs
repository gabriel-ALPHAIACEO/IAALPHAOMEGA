// EL BOT SOLO CON EL INVENTARIO, SIN LA HOJA (13-oct-2026, pregunta del
// dueño: "¿la IA funciona bien solo con el inventario, y sin el sheet?").
//
// Lo que se comprueba: con "Lo que ofrece el bot" en El inventario, el bot
// NO toca Google Sheets (aunque no haya SHEET_ID o Google no conteste) y
// ofrece lo creado a mano en el panel —con su foto subida, su precio en
// divisas, en Bs y Cashea, su capacidad y su categoría—; lo agotado no
// sale, lo vendido en la caja deja de salir y una talla sin contar sí sale.
import { DatabaseSync } from "node:sqlite";
import { catalogoCompleto, buscarProductos, listaDeTitulos, olvidarElInventario } from "./.stub/sheets.js";
import * as inv from "./.stub/inventario.js";

let fallos = 0;
const comprobar = (n, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};
function d1() {
  const sql = new DatabaseSync(":memory:");
  const preparada = (consulta, args = []) => ({
    bind: (...a) => preparada(consulta, a),
    run: async () => (sql.prepare(consulta).run(...args), { success: true }),
    all: async () => ({ results: sql.prepare(consulta).all(...args) }),
    first: async () => sql.prepare(consulta).get(...args) ?? null,
  });
  return {
    prepare: (consulta) => preparada(consulta),
    batch: async (lista) => {
      sql.exec("BEGIN");
      try { const s = []; for (const x of lista) s.push(await x.run()); sql.exec("COMMIT"); return s; } catch (e) { sql.exec("ROLLBACK"); throw e; }
    },
  };
}

// Google no contesta: si el bot intentara leer la hoja, se notaría.
let llamadasAGoogle = 0;
globalThis.fetch = async (url) => { llamadasAGoogle++; throw new Error(`sin internet: ${url}`); };
const log = console.log;
console.log = () => {};
const DB = d1();
const env = { DB, URL_CATALOGO: "https://bot.workers.dev/tienda" }; // SIN SHEET_ID

const [sede] = await inv.sedes(DB);
await inv.guardarAjuste(DB, "catalogo_del_bot", "inventario");
const s25 = await inv.guardarProducto(DB, { origen: "manual", titulo: "Samsung Galaxy S25 FE", marca: "Samsung", precio: 520, precio_cashea: 598, precio_local: 26000, extras: { categoria: "Teléfonos" } });
await DB.prepare("INSERT INTO inv_fotos (producto_id, url, orden) VALUES (?, ?, 0)").bind(s25, "https://bot.workers.dev/tienda/img/1.jpg").run();
const [v128, v256] = await inv.guardarVariantes(DB, s25, [{ opcion: "128GB" }, { opcion: "256GB" }]);
await inv.ajustarStock(DB, { varianteId: v128, sedeId: sede.id, cantidad: 2 });
await inv.ajustarStock(DB, { varianteId: v256, sedeId: sede.id, cantidad: 0 });
const reloj = await inv.guardarProducto(DB, { origen: "manual", titulo: "Xiaomi Redmi Watch 5", marca: "Xiaomi", precio: 60, precio_cashea: 70, extras: { categoria: "Relojes" } });
await inv.guardarVariantes(DB, reloj, [{ opcion: "única" }]); // sin contar: se ofrece

const todo = await catalogoCompleto(env);
console.log = log;
const s = todo.find((p) => p.titulo === "Samsung Galaxy S25 FE");
comprobar("sin SHEET_ID, el bot lee el inventario: 2 productos (la capacidad agotada no)", todo.map((p) => `${p.titulo} ${p.capacidad}`.trim()).sort(), ["Samsung Galaxy S25 FE 128GB", "Xiaomi Redmi Watch 5"]);
comprobar("con la foto subida en el panel", s?.imagen, "https://bot.workers.dev/tienda/img/1.jpg");
comprobar("con su precio en divisas y sin bolívares (se eliminaron, 17-oct)", /\$520/.test(s?.precio || "") && !/26\.000|Bs/.test(s?.precio || ""), true);
comprobar("el precio Cashea llega tal cual", s?.precioCashea, "598");
console.log = () => {};
const r1 = (await buscarProductos(env, "relojes")).productos.map((p) => p.titulo);
const r2 = (await buscarProductos(env, "galaxy s25")).productos.map((p) => p.titulo);
const lista = await listaDeTitulos(env);
console.log = log;
comprobar("y la categoría sirve para buscar", r1, ["Xiaomi Redmi Watch 5"]);
comprobar("buscar «galaxy s25» lo encuentra", r2, ["Samsung Galaxy S25 FE"]);
comprobar("la lista de títulos para la IA sale del inventario", /Samsung Galaxy S25 FE/.test(lista), true);

// Se vende en la caja el último de 128GB: deja de ofrecerse.
await inv.cobrar(DB, { sedeId: sede.id, items: [{ varianteId: v128, cantidad: 2 }], metodoPago: "Pago móvil" });
olvidarElInventario();
console.log = () => {};
const despues = await catalogoCompleto(env);
console.log = log;
comprobar("lo vendido en la caja deja de ofrecerse solo", despues.map((p) => p.titulo), ["Xiaomi Redmi Watch 5"]);
comprobar("y en todo esto, ni una llamada a Google Sheets", llamadasAGoogle, 0);

console.log(fallos ? `\n${fallos} FALLOS` : "\nTodo verde.");
process.exit(fallos ? 1 : 0);
