// LA HOJA DE GOOGLE DESCONECTADA (13-oct-2026, el dueño: "hay más
// powerbanks, están todos en el sistema de inventario. Vamos a desconectar
// el drive") y lo que salió en el panel ese mismo día.
//
// Lo que no se puede romper:
//   · sin USAR_HOJA el bot ofrece SOLO lo del inventario, aunque SHEET_ID
//     siga puesto y aunque nunca se haya traído la hoja (no llama a Google);
//   · la categoría del panel dice qué es: un "Xiaomi 20000mAh" en
//     «Powerbanks» sale al pedir power banks;
//   · «es el único» no se dice dos veces (la «ú» con tilde se reconoce);
//   · la ficha técnica escrita ("🔹 Pantalla: …") no se borra al ir las fotos;
//   · a "Redmi 17" no se le contesta "¿De cuál equipo me hablas?" si está;
//   · si ya hablaron, no se vuelve a presentar.
//
//   python3 pruebas/preparar.py && node pruebas/desconectada.mjs
import { DatabaseSync } from "node:sqlite";
import { turno, baseFalsa } from "./banco.mjs";
import { buscarProductos, listaDeTitulos, catalogoCompleto, diagnosticoHoja, olvidarElInventario, hojaConectada } from "./.stub/sheets.js";
import { tipoDelProducto } from "./.stub/tipos.js";
import { conLoUnicoQueHay } from "./.stub/recomendados.js";
import * as inv from "./.stub/inventario.js";

let fallos = 0;
const comprobar = (n, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};
const textos = (e) => e.filter((m) => m.text).map((m) => m.text).join(" ");
const titulos = (e) => e.flatMap((m) => m.attachment?.payload?.elements || []).map((f) => f.title);

// SQLite de verdad para el inventario; la D1 de mentira del banco para los
// contactos (como en producción, la misma base).
function base(fila = {}) {
  const sql = new DatabaseSync(":memory:");
  const preparada = (consulta, args = []) => ({
    bind: (...a) => preparada(consulta, a),
    run: async () => (sql.prepare(consulta).run(...args), { success: true }),
    all: async () => ({ results: sql.prepare(consulta).all(...args) }),
    first: async () => sql.prepare(consulta).get(...args) ?? null,
  });
  const falsa = baseFalsa({ id: "cliente1", ...fila });
  const real = {
    prepare: (consulta) => preparada(consulta),
    batch: async (lista) => {
      sql.exec("BEGIN");
      try { const s = []; for (const x of lista) s.push(await x.run()); sql.exec("COMMIT"); return s; } catch (e) { sql.exec("ROLLBACK"); throw e; }
    },
  };
  return {
    real,
    filas: falsa.filas,
    batch: (lista) => real.batch(lista),
    prepare: (consulta) => (/\binv_|mensajes_recibidos/.test(consulta) ? real.prepare(consulta) : falsa.prepare(consulta)),
  };
}

const GAR = "Powerbank 20.000mAh GAr 158";
const XIAOMI = "Xiaomi 20000mAh 22.5W";
const ANKER = "Anker PowerCore 10000";
const REDMI = "Redmi 17 4G";

async function inventario(DB) {
  // Cada prueba con su base nueva: que vuelva a crear las tablas.
  inv.olvidarQueEstaListo();
  const [sede] = await inv.sedes(DB.real);
  const nuevo = async (titulo, marca, precio, cashea, categoria) => {
    const id = await inv.guardarProducto(DB.real, { origen: "manual", titulo, marca, precio, precio_cashea: cashea, extras: { categoria } });
    const [v] = await inv.guardarVariantes(DB.real, id, [{ opcion: "única" }]);
    await inv.ajustarStock(DB.real, { varianteId: v, sedeId: sede.id, cantidad: 3 });
    await DB.real.prepare("INSERT INTO inv_fotos (producto_id, url, orden) VALUES (?, ?, 0)").bind(id, `https://bot.workers.dev/tienda/img/${id}.jpg`).run();
  };
  await nuevo(GAR, "GAr", 30, 38, "Powerbanks");
  await nuevo(XIAOMI, "Xiaomi", 35, 45, "Powerbanks");
  await nuevo(ANKER, "Anker", 28, 34, "Power Bank");
  await nuevo(REDMI, "Xiaomi", 210, 250, "Teléfonos");
}

// Google no contesta: si el bot intentara leer la hoja, se notaría.
let aGoogle = 0;
const log = console.log;
const callar = () => { console.log = () => {}; console.error = () => {}; };
const hablar = () => { console.log = log; console.error = log; };

console.log("— sin USAR_HOJA: solo el inventario");
{
  const DB = base();
  callar();
  await inventario(DB);
  hablar();
  // SHEET_ID puesto y sin haber traído nunca la hoja (sin el ajuste de Importar).
  const env = { DB, SHEET_ID: "la-de-siempre", SHEET_NOMBRE: "Hoja 1", URL_CATALOGO: "https://bot.workers.dev/tienda" };
  globalThis.fetch = async (url) => { if (String(url).includes("google")) aGoogle++; throw new Error(`sin internet: ${url}`); };
  olvidarElInventario();
  callar();
  const todo = await catalogoCompleto(env);
  const pb = (await buscarProductos(env, "powerbank")).productos.map((p) => p.titulo).sort();
  const lista = await listaDeTitulos(env);
  const diagnostico = await diagnosticoHoja(env);
  hablar();
  comprobar("hojaConectada: no, si no se pone USAR_HOJA", [hojaConectada(env), hojaConectada({ USAR_HOJA: "si" }), hojaConectada({ USAR_HOJA: "no" })], [false, true, false]);
  comprobar("el bot ve los 4 del inventario", todo.map((p) => p.titulo).sort(), [ANKER, GAR, REDMI, XIAOMI].sort());
  comprobar("y no llama a Google ni una vez", aGoogle, 0);
  comprobar("«powerbank» trae los 3, también los que solo la categoría dice que lo son", pb, [ANKER, GAR, XIAOMI].sort());
  comprobar("la categoría dice qué es: Xiaomi 20000mAh es un power bank", [tipoDelProducto(XIAOMI), tipoDelProducto(ANKER), tipoDelProducto(REDMI)], ["powerbank", "powerbank", "telefono"]);
  comprobar("la IA lo lee con su tipo al lado", lista.includes(`${XIAOMI} · categoría: power banks`) && !lista.includes(`${GAR} · categoría`), true);
  comprobar("/probar-hoja dice que está desconectada", /DESCONECTADA/.test(diagnostico) && /Productos visibles para el bot: 4/.test(diagnostico), true);
}

console.log("— «Powerbanks» por Instagram, con el inventario");
{
  const DB = base({ historial: "Ya di la bienvenida. Le mostré power banks.", ultimos_productos: JSON.stringify([GAR]), mostrados: JSON.stringify([GAR]) });
  callar();
  await inventario(DB);
  olvidarElInventario();
  const r = await turno({
    texto: "Powerbanks",
    db: DB,
    env: { USAR_HOJA: "" },
    respuestaDelModelo: { respuesta: "Aquí tienes el Powerbank de 20.000mAh GAr 158 que ya hemos visto. ¿Te gustaría saber algo más?", buscar: GAR },
  });
  hablar();
  const t = titulos(r.enviados);
  comprobar("le enseña los 3 power banks del inventario", [...t].sort(), [ANKER, GAR, XIAOMI].sort());
  comprobar("y no le dice que es el único", /[uú]nico/i.test(textos(r.enviados)), false);
}

console.log("— «es el único», una sola vez");
{
  const ya = "¡Hola Alberto! Soy la asistente virtual de EPICCELL 👋 Por ahora es el único powerbank que tenemos:\n\nPowerbank 20.000mAh GAr 158 · $38.00 con Cashea.";
  comprobar("si ya lo dice con tilde, no se repite", conLoUnicoQueHay(ya, { cuantos: 1, deQue: "powerbank" }), ya);
  comprobar("si hay que decirlo, va después del saludo", conLoUnicoQueHay("¡Hola Alberto! Soy la asistente virtual de EPICCELL 👋 Mira 👇", { cuantos: 1, deQue: "powerbank" }), "¡Hola Alberto! Soy la asistente virtual de EPICCELL 👋 Por ahora es el único que tenemos de powerbank 😊 Mira 👇");
  comprobar("«únicos» y «sólo tenemos» también cuentan", [conLoUnicoQueHay("Son los únicos 😊", { cuantos: 2 }), conLoUnicoQueHay("Sólo tenemos ese 😊")], ["Son los únicos 😊", "Sólo tenemos ese 😊"]);
}

console.log("— la ficha técnica escrita se queda");
{
  const HOJA = `Nombre,Precio Divisas ($),Precio Cashea,Foto\n${REDMI},210,250,https://x/r17.jpg\nPoco X8 pro 5G,210,70,https://x/pocox8.jpg`;
  callar();
  const r = await turno({
    texto: "Redmi 17",
    hoja: HOJA,
    fila: { historial: "Ya di la bienvenida." },
    respuestaDelModelo: { respuesta: "Aquí tienes el Redmi 17 que pediste 👇\n🔹 Pantalla: 6,9\" IPS LCD, 120 Hz, HD+\n🔹 Procesador: MediaTek Helio G91 Ultra\n🔹 RAM: 8 GB\n¿Te gustaría saber el precio?", buscar: "Redmi 17" },
  });
  hablar();
  const dice = textos(r.enviados);
  comprobar("van la pantalla, el procesador y la RAM", /Pantalla: 6,9/.test(dice) && /Procesador: MediaTek/.test(dice) && /RAM: 8 GB/.test(dice), true);
  comprobar("sin la pregunta del precio (está en la foto)", /gustar[ií]a saber el precio/i.test(dice), false);
  comprobar("con su ficha", titulos(r.enviados), [REDMI]);
}
{
  const HOJA = `Nombre,Precio Divisas ($),Precio Cashea,Foto\nRedmi 15c,145,182,https://x/1.jpg\nRedmi 15 Pro,200,230,https://x/2.jpg\n${REDMI},210,250,https://x/r17.jpg`;
  callar();
  const r = await turno({
    texto: "Tienes redmi?",
    hoja: HOJA,
    fila: { historial: "Ya di la bienvenida." },
    respuestaDelModelo: { respuesta: "¡Claro! Tengo estos:\n🔹 Redmi 15c\n🔹 Redmi 15 Pro\n🔹 Redmi 17 4G\n¿Cuál te gusta?", buscar: "Redmi" },
  });
  hablar();
  comprobar("una lista de PRODUCTOS sí se quita (van las fotos)", /🔹 Redmi 15c/.test(textos(r.enviados)), false);
}

console.log("— «Redmi 17» con la IA preguntando cuál");
{
  const HOJA = `Nombre,Precio Divisas ($),Precio Cashea,Foto\n${REDMI},210,250,https://x/r17.jpg\nRedmi Note 15 Pro,300,320,https://x/n15.jpg`;
  callar();
  const r = await turno({
    texto: "Redmi 17",
    hoja: HOJA,
    fila: { historial: "Vio Poco y Redmi." },
    respuestaDelModelo: { respuesta: "¿De cuál equipo me hablas? 😊 Estoy aquí para ayudarte con lo que necesites.", buscar: "NADA", mostrar: "texto" },
  });
  hablar();
  comprobar("le manda el Redmi 17", titulos(r.enviados), [REDMI]);
  comprobar("y no le pregunta de cuál equipo habla", /de cu[aá]l equipo/i.test(textos(r.enviados)), false);
}

console.log("— si ya hablaron, no se presenta otra vez");
{
  const HOJA = `Nombre,Precio Divisas ($),Precio Cashea,Foto\n${GAR},30,38,https://x/gar.jpg`;
  callar();
  const r = await turno({
    texto: "y el precio?",
    hoja: HOJA,
    // Sin resumen guardado, pero con la charla de antes.
    fila: { historial: "", conversacion: JSON.stringify([{ de: "cliente", texto: "Powerbank" }, { de: "bot", texto: "Mira este 👇" }]) },
    respuestaDelModelo: { respuesta: "¡Hola Alberto! Soy la asistente virtual de EPICCELL 👋 Está en $38 con Cashea.", buscar: GAR },
  });
  hablar();
  comprobar("sin «Soy la asistente virtual»", /asistente virtual/i.test(textos(r.enviados)), false);
}

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
