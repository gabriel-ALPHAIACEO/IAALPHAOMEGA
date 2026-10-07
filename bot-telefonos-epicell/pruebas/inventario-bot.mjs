// EL BOT OFRECE LO DEL INVENTARIO (7-oct-2026, decisión del dueño: "en
// EPICCELL todo pasa, hasta precios y fotos, absolutamente todo").
//
// Lo que no se puede romper:
//   · traída la hoja al inventario, el bot ofrece LO MISMO que ofrecía con
//     la hoja: los mismos equipos, con los mismos precios (divisas, Bs y
//     Cashea), la misma foto y las mismas columnas;
//   · lo que se vende en la caja deja de ofrecerse solo;
//   · lo que en la hoja estaba en NO o en 0 tampoco se ofrece; lo que decía
//     "SI" (sin número) sí;
//   · con el botón de Importar se vuelve a la hoja, y si la base falla, el
//     bot sigue con la hoja (nunca se queda sin catálogo).
import { DatabaseSync } from "node:sqlite";
import { catalogoCompleto, buscarProductos, catalogoParaInventario, diagnosticoHoja, olvidarElInventario } from "./.stub/sheets.js";
import * as inv from "./.stub/inventario.js";

let fallos = 0;
const comprobar = (n, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};

// D1 de verdad: SQLite, y cada batch en una transacción.
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
      try {
        const salida = [];
        for (const s of lista) salida.push(await s.run());
        sql.exec("COMMIT");
        return salida;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

const HOJA = `Nombre,Marca,Capacidad,Precio Divisas,Precio Bs,Precio Cashea,Cantidad,Activo,Foto,RAM,Color
iPhone 13,Apple,128GB,$420,Bs 15.000,470,3,,https://drive.google.com/file/d/1AbCdEfGhIJKlmNoPQrsTUV/view?usp=sharing,4GB,Negro
iPhone 13,Apple,256GB,$480,,530,1,,https://x/13b.jpg,4GB,Negro
Samsung A17,Samsung,128GB,$150,,170,SI,,https://x/a17.jpg,6GB,
Samsung A57,Samsung,256GB,$310,,350,0,,https://x/a57.jpg,8GB,
Poco X8 Pro,Xiaomi,512GB,$300,,340,2,no,https://x/x8.jpg,12GB,
Cable Tipo C,Samsung,,$8,,,5,,https://x/cable.jpg,,`;

const real = globalThis.fetch;
globalThis.fetch = async () => new Response(HOJA, { status: 200 });
const log = console.log;
const callado = async (fn) => { console.log = () => {}; try { return await fn(); } finally { console.log = log; } };

const DB = d1();
const env = { SHEET_ID: "epiccell", SHEET_NOMBRE: "Hoja 1", URL_CATALOGO: "https://epiccell.test", DB };
const forma = (p) => ({ titulo: p.titulo, marca: p.marca, capacidad: p.capacidad, precio: p.precio, precioCashea: p.precioCashea, imagen: p.imagen, url: p.url, extras: p.extras });

// 1. Hoy: el bot lee la hoja.
const conLaHoja = await callado(() => catalogoCompleto(env));
comprobar("con la hoja: se ofrecen los 4 que están activos y no en 0", conLaHoja.map((p) => `${p.titulo} ${p.capacidad}`.trim()), ["iPhone 13 128GB", "iPhone 13 256GB", "Samsung A17 128GB", "Cable Tipo C"]);
const buscadoConHoja = await callado(() => buscarProductos(env, "iphone 256"));

// 2. Se trae la hoja al inventario (lo que hace el botón "Traer ahora").
const items = await callado(() => catalogoParaInventario(env));
const informe = await callado(() => inv.importarCatalogo(DB, items, { quien: "catálogo" }));
comprobar("el inventario recibe los 5 modelos (también el inactivo y el agotado)", informe.modelos, 5);
olvidarElInventario();
comprobar("hasta que no se dice, el bot sigue con la hoja", (await callado(() => catalogoCompleto(env))).length, 4);
await inv.guardarAjuste(DB, "catalogo_del_bot", "inventario");
olvidarElInventario();

// 3. Desde el inventario: LO MISMO.
const conElInventario = await callado(() => catalogoCompleto(env));
comprobar("desde el inventario: los mismos equipos, con los mismos precios, foto y columnas", conElInventario.map(forma), conLaHoja.map(forma));
const buscadoConInventario = await callado(() => buscarProductos(env, "iphone 256"));
comprobar("y la búsqueda encuentra lo mismo", buscadoConInventario.productos.map(forma), buscadoConHoja.productos.map(forma));
comprobar("también por una columna de la hoja (RAM)", (await callado(() => buscarProductos(env, "samsung 6gb"))).productos.map((p) => p.titulo), ["Samsung A17"]);
comprobar("el precio en Bs sale como en la hoja", conElInventario[0].precio, "$420 · Bs 15.000");
comprobar("la foto de Drive, ya lista para la ficha", conElInventario[0].imagen, "https://lh3.googleusercontent.com/d/1AbCdEfGhIJKlmNoPQrsTUV=w1000");

// 4. Lo que se vende deja de ofrecerse.
const [sede] = await inv.sedes(DB);
const v256 = (await inv.listarProductos(DB, { q: "iphone" }))[0];
const iphone = await inv.verProducto(DB, v256.id);
const de256 = iphone.variantes.find((v) => v.opcion === "256GB");
await callado(() => inv.cobrar(DB, { sedeId: sede.id, quien: "Ana", metodoPago: "Pago móvil", items: [{ varianteId: de256.id, cantidad: 1 }], tarifa: "cashea" }));
olvidarElInventario();
comprobar("vendido el último de 256GB en la caja, el bot ya no lo ofrece", (await callado(() => catalogoCompleto(env))).map((p) => `${p.titulo} ${p.capacidad}`.trim()), ["iPhone 13 128GB", "Samsung A17 128GB", "Cable Tipo C"]);
const venta = (await DB.prepare("SELECT total FROM inv_ventas ORDER BY id DESC").first()).total;
comprobar("y se cobró al precio Cashea de esa capacidad", venta, 530);

// 5. Lo oculto, lo editado y lo que se vuelve a contar.
await inv.editarVariante(DB, de256.id, { precio: 490, precio_cashea: 540, oculta: false });
await inv.ajustarStock(DB, { varianteId: de256.id, sedeId: sede.id, cantidad: 2, quien: "Luis" });
olvidarElInventario();
const otraVez = (await callado(() => catalogoCompleto(env))).find((p) => p.capacidad === "256GB");
comprobar("contado otra vez y con precio nuevo en el panel, el bot lo ofrece así", [otraVez?.precio, otraVez?.precioCashea], ["$490", "540"]);
await inv.editarVariante(DB, de256.id, { oculta: true });
olvidarElInventario();
comprobar("oculto en el panel, el bot no lo ofrece aunque haya", (await callado(() => catalogoCompleto(env))).some((p) => p.capacidad === "256GB"), false);

// 6. /probar-hoja lo dice.
const diag = await callado(() => diagnosticoHoja(env));
comprobar("/probar-hoja dice que el bot ofrece lo del inventario", /EL BOT OFRECE LO DEL INVENTARIO DEL PANEL: 3 productos/.test(diag), true);

// 7. Volver a la hoja, y la base caída.
await inv.guardarAjuste(DB, "catalogo_del_bot", "hoja");
olvidarElInventario();
comprobar("con el botón de Importar se vuelve a la hoja", (await callado(() => catalogoCompleto(env))).length, 4);
olvidarElInventario();
const caida = { ...env, DB: { prepare() { throw new Error("base caída (a propósito)"); } } };
const errores = [];
const err = console.error;
console.error = (...a) => errores.push(a.join(" "));
const conBaseCaida = await callado(() => catalogoCompleto(caida));
console.error = err;
comprobar("con la base caída, el bot sigue con la hoja (nunca sin catálogo)", conBaseCaida.length, 4);

globalThis.fetch = real;
console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
