// CONECTAR CON UN SISTEMA CERRADO (15-oct-2026): el stock que manda el sistema
// de afuera (CSV o JSON, empujado con clave o leído de una dirección) y las
// ventas que se le entregan de vuelta. Sin API del otro lado: archivos.
//
// Lo que no se puede romper:
//   · sin SYNC_CLAVE la puerta está cerrada, y con una clave mala no entra nadie;
//   · el conteo que manda el sistema queda tal cual (con su movimiento) y repetirlo
//     no duplica nada;
//   · lo vendido en la caja DESPUÉS del corte del conteo se tiene en cuenta;
//   · dos conteos no se mezclan (el segundo espera), y por tandas termina;
//   · «solo probar» no guarda nada;
//   · lo que se entrega de vuelta no lleva costos;
//   · esto NUNCA crea una venta ni descuenta por su cuenta.

import { prepararSrc, baseDeMentira, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const inv = await src.cargar("inventario.js");
const con = await src.cargar("conectores.js");

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
const CLAVE = "clave-de-prueba-123";
const env = { DB, SYNC_CLAVE: CLAVE };
const [sede] = await inv.sedes(DB);

function pedido(ruta, { metodo = "GET", cuerpo, tipo = "", clave = CLAVE, cabecera = "authorization" } = {}) {
  const headers = {};
  if (clave) headers[cabecera] = cabecera === "authorization" ? `Bearer ${clave}` : clave;
  if (tipo) headers["content-type"] = tipo;
  return new Request(`https://bot.test${ruta}`, { method: metodo, headers, body: cuerpo });
}
async function llamar(ruta, opciones = {}, entorno = env) {
  const solicitud = pedido(ruta, opciones);
  const respuesta = await con.atenderSync(solicitud, entorno, new URL(solicitud.url), { waitUntil: (p) => void p.catch?.(() => {}) });
  if (!respuesta) return { estado: 0, cuerpo: null, texto: "" };
  const texto = await respuesta.text();
  let cuerpo = null;
  try {
    cuerpo = JSON.parse(texto);
  } catch {}
  return { estado: respuesta.status, cuerpo, texto, tipo: respuesta.headers.get("content-type") || "" };
}
// El código de un modelo corto («A100») queda como su código de origen; el de
// barras largo, como «de fábrica». Se busca en los dos y se suman las tallas.
const stockPorCodigo = (codigo) => {
  const fila = sql
    .prepare(
      `SELECT SUM(s.cantidad) AS n, COUNT(DISTINCT p.id) AS modelos FROM inv_productos p
         JOIN inv_variantes v ON v.producto_id = p.id LEFT JOIN inv_stock s ON s.variante_id = v.id
        WHERE p.origen_id = ? OR v.codigo_fabricante = ? OR v.codigo_barras = ?`
    )
    .get(codigo, codigo, codigo);
  return fila?.modelos ? Number(fila.n) || 0 : undefined;
};
const movimientos = () => sql.prepare("SELECT tipo, delta, quien, nota FROM inv_movimientos ORDER BY id").all();
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── La puerta ───────────────────────────────────────────────────────── */

titulo("la puerta: sin clave puesta está cerrada; con clave mala no entra nadie");
{
  const a = await llamar("/api/sync/estado", {}, { DB });
  ok(a.estado === 503 && /SYNC_CLAVE/.test(a.cuerpo?.error || ""), "sin SYNC_CLAVE en el Worker: 503 y dice qué falta", `${a.estado} ${a.texto.slice(0, 100)}`);
  const b = await llamar("/api/sync/estado", { clave: "otra" });
  ok(b.estado === 401, "clave equivocada: 401", String(b.estado));
  const c = await llamar("/api/sync/estado", { clave: "" });
  ok(c.estado === 401, "sin clave: 401", String(c.estado));
  const d = await llamar("/api/sync/estado", { clave: CLAVE, cabecera: "x-clave" });
  ok(d.estado === 200 && d.cuerpo?.ok, "la clave también vale en la cabecera X-Clave", String(d.estado));
  const e = await llamar("/api/otra/cosa");
  ok(e.estado === 0, "lo que no es de /api/sync no se toca (devuelve null)");
}

/* ── Un CSV del sistema cerrado ──────────────────────────────────────── */

titulo("un CSV con las columnas del sistema: crea, pone el stock y lo cuenta");
const CSV = [
  "Código;Descripción;Talla;Existencia;Precio",
  "A100;Zapato Casual Negro;40;5;45",
  "A100;Zapato Casual Negro;41;3;45",
  "B200;Bota Cuero;42;0;80",
].join("\n");
{
  const r = await llamar("/api/sync/inventario?origen=Profit", { metodo: "POST", cuerpo: CSV, tipo: "text/csv" });
  ok(r.estado === 200 && r.cuerpo?.estado === "listo" && r.cuerpo?.filas === 3, "un CSV corto se termina en la misma llamada", JSON.stringify(r.cuerpo).slice(0, 200));
  ok(stockPorCodigo("A100") !== undefined, "los productos se crearon");
  const total = sql.prepare("SELECT SUM(cantidad) AS n FROM inv_stock").get().n;
  ok(total === 8, "el stock quedó como lo contó el sistema (5 + 3 + 0)", String(total));
  const m = movimientos();
  ok(m.length >= 2 && m.every((x) => x.tipo === "carga" && x.quien === "Sistema: Profit"), "con su movimiento «Carga inicial» a nombre del sistema", JSON.stringify(m));
  ok(!movimientos().some((x) => x.tipo === "venta"), "y nunca una venta: esto no descuenta por su cuenta");
}

titulo("repetir el mismo archivo no duplica nada; un cambio se ve como ajuste");
{
  const productos = sql.prepare("SELECT COUNT(*) AS n FROM inv_productos").get().n;
  const movs = movimientos().length;
  const r = await llamar("/api/sync/inventario", { metodo: "POST", cuerpo: CSV, tipo: "text/csv" });
  ok(r.estado === 200 && sql.prepare("SELECT COUNT(*) AS n FROM inv_productos").get().n === productos, "los mismos productos, sin duplicar");
  ok(movimientos().length === movs, "y sin un solo movimiento nuevo (nada cambió)");
  const CAMBIADO = CSV.replace("A100;Zapato Casual Negro;40;5;45", "A100;Zapato Casual Negro;40;9;45");
  await llamar("/api/sync/inventario", { metodo: "POST", cuerpo: CAMBIADO, tipo: "text/csv" });
  const ultimo = movimientos().at(-1);
  ok(ultimo.tipo === "ajuste" && ultimo.delta === 4, "5 → 9: un ajuste de +4", JSON.stringify(ultimo));
}

/* ── Un JSON ─────────────────────────────────────────────────────────── */

titulo("un JSON: con variantes dentro, o una lista plana con nombres en español");
{
  const a = await llamar("/api/sync/inventario?origen=Saint", {
    metodo: "POST",
    tipo: "application/json",
    cuerpo: JSON.stringify({ productos: [{ sku: "C300", nombre: "Sandalia Playa", precio: 30, variantes: [{ talla: "36", stock: 2 }, { talla: "37", stock: 4 }] }] }),
  });
  ok(a.estado === 200 && stockPorCodigo("C300") !== undefined, "productos con «variantes» dentro: una fila por talla", JSON.stringify(a.cuerpo).slice(0, 160));
  const c300 = sql.prepare("SELECT SUM(s.cantidad) AS n FROM inv_stock s JOIN inv_variantes v ON v.id = s.variante_id JOIN inv_productos p ON p.id = v.producto_id WHERE p.titulo = 'Sandalia Playa'").get().n;
  ok(c300 === 6, "2 + 4 unidades", String(c300));
  const b = await llamar("/api/sync/inventario", { metodo: "POST", tipo: "application/json", cuerpo: JSON.stringify([{ codigo: "D400", producto: "Gorra Negra", cantidad: 7, precio: 12 }]) });
  ok(b.estado === 200 && stockPorCodigo("D400") === 7, "una lista plana de filas", JSON.stringify(b.cuerpo).slice(0, 160));
  const mal = await llamar("/api/sync/inventario", { metodo: "POST", tipo: "application/json", cuerpo: "{esto no es json" });
  ok(mal.estado === 400, "un JSON roto: 400 y se dice");
  const raro = await llamar("/api/sync/inventario", { metodo: "POST", tipo: "application/json", cuerpo: JSON.stringify({ hola: 1 }) });
  ok(raro.estado === 400 && /lista de productos/.test(raro.cuerpo?.error || ""), "un JSON sin lista de productos: 400 que explica qué mandar", raro.texto.slice(0, 120));
}

titulo("el precio del sistema de afuera manda (y se puede apagar)");
{
  const precio = () => sql.prepare("SELECT precio FROM inv_productos WHERE origen_id = 'A100'").get().precio;
  ok(precio() === 45, "el precio que llegó la primera vez (45)", String(precio()));
  await llamar("/api/sync/inventario", { metodo: "POST", cuerpo: CSV.replace(/;45\b/g, ";52"), tipo: "text/csv" });
  ok(precio() === 52, "cambió en el sistema (52): la tienda lo sigue", String(precio()));
  await llamar("/api/sync/inventario?precios=no", { metodo: "POST", cuerpo: CSV.replace(/;45\b/g, ";60"), tipo: "text/csv" });
  ok(precio() === 52, "con ?precios=no no se toca (queda 52)", String(precio()));
  await llamar("/api/sync/inventario", { metodo: "POST", cuerpo: CSV, tipo: "text/csv" });
  ok(precio() === 45, "y de vuelta a 45", String(precio()));
}

titulo("lo que viene mal se dice, y no guarda nada");
{
  const antes = sql.prepare("SELECT COUNT(*) AS n FROM inv_productos").get().n;
  const sinCantidad = await llamar("/api/sync/inventario", { metodo: "POST", cuerpo: "Código;Descripción\nZ1;Algo", tipo: "text/csv" });
  ok(sinCantidad.estado === 400 && /cantidad/i.test(sinCantidad.cuerpo?.error || ""), "sin la columna de la cantidad: 400 que lo dice", sinCantidad.texto.slice(0, 120));
  const vacio = await llamar("/api/sync/inventario", { metodo: "POST", cuerpo: "", tipo: "text/csv" });
  ok(vacio.estado === 400, "un archivo vacío: 400");
  const sede404 = await llamar("/api/sync/inventario?sede=Marte", { metodo: "POST", cuerpo: CSV, tipo: "text/csv" });
  ok(sede404.estado === 400 && /Marte/.test(sede404.cuerpo?.error || ""), "una sede que no existe: 400 con su nombre", sede404.texto.slice(0, 120));
  const solo = await llamar("/api/sync/inventario?probar=1", { metodo: "POST", cuerpo: "Código;Descripción;Existencia\nNUEVO1;Algo Nuevo;5", tipo: "text/csv" });
  ok(solo.estado === 200 && solo.cuerpo?.probando === true && sql.prepare("SELECT COUNT(*) AS n FROM inv_productos").get().n === antes, "«probar»: dice qué haría y no guarda nada", JSON.stringify(solo.cuerpo).slice(0, 160));
  const grande = await llamar("/api/sync/inventario", { metodo: "POST", cuerpo: "x".repeat(2 * 1024 * 1024 + 10), tipo: "text/csv" });
  ok(grande.estado === 413, "más de 2 MB: 413");
  const get = await llamar("/api/sync/inventario");
  ok(get.estado === 405, "esa ruta es POST");
}

/* ── Lo vendido en la caja mientras tanto ────────────────────────────── */

titulo("el conteo trae la hora en que se leyó: lo vendido después de ella se descuenta");
{
  const variante = sql.prepare("SELECT v.id FROM inv_variantes v JOIN inv_productos p ON p.id = v.producto_id WHERE p.titulo = 'Gorra Negra'").get().id;
  const hay = () => sql.prepare("SELECT cantidad FROM inv_stock WHERE variante_id = ?").get(variante).cantidad;
  const antesDeVender = Date.now() - 5;
  await pausa(10);
  await inv.cobrar(DB, { sedeId: sede.id, quien: "Caja", metodoPago: "Efectivo", items: [{ varianteId: variante, cantidad: 2 }] });
  ok(hay() === 5, "la caja vendió 2 (7 → 5)");
  // El sistema leyó su stock ANTES de esa venta (todavía decía 7): hay que restar las 2.
  await llamar(`/api/sync/inventario?generado=${antesDeVender}`, { metodo: "POST", cuerpo: "Código;Descripción;Existencia\nD400;Gorra Negra;7", tipo: "text/csv" });
  ok(hay() === 5, "conteo leído ANTES de la venta (7): queda 5, la venta no se pierde", String(hay()));
  // El sistema ya descontó la venta (lo leyó después): 5 tal cual.
  await pausa(10);
  await llamar(`/api/sync/inventario?generado=${Date.now()}`, { metodo: "POST", cuerpo: "Código;Descripción;Existencia\nD400;Gorra Negra;5", tipo: "text/csv" });
  ok(hay() === 5, "conteo leído DESPUÉS (5): queda 5", String(hay()));
  await pausa(10);
  await llamar(`/api/sync/inventario?generado=${Date.now()}`, { metodo: "POST", cuerpo: "Código;Descripción;Existencia\nD400;Gorra Negra;11", tipo: "text/csv" });
  ok(hay() === 11, "y si el sistema recibió mercancía (11), queda 11", String(hay()));
}

/* ── Un conteo grande: por tandas, y dos no se mezclan ───────────────── */

titulo("un conteo grande va por tandas; mientras tanto otro espera");
{
  const filas = ["Código;Descripción;Talla;Existencia"];
  for (let i = 0; i < 90; i++) filas.push(`G${1000 + i};Modelo ${i};U;${i % 7}`);
  const a = await llamar("/api/sync/inventario?origen=Grande", { metodo: "POST", cuerpo: filas.join("\n"), tipo: "text/csv" });
  ok(a.estado === 202 && a.cuerpo?.estado === "trabajando" && a.cuerpo?.filas === 90, "más de 40 filas: 202, sigue en el fondo", JSON.stringify(a.cuerpo).slice(0, 160));
  const b = await llamar("/api/sync/inventario", { metodo: "POST", cuerpo: filas.join("\n"), tipo: "text/csv" });
  ok(b.estado === 409 && b.cuerpo?.ocupado === true && b.cuerpo?.reintenta_en_segundos > 0, "otro conteo mientras hay uno a medias: 409, «espera y reintenta»", JSON.stringify(b.cuerpo).slice(0, 160));
  let r;
  let vueltas = 0;
  do {
    r = await llamar(`/api/sync/avanzar?trabajo=${a.cuerpo.trabajo}`, { metodo: "POST" });
    vueltas++;
  } while (r.cuerpo?.estado === "trabajando" && vueltas < 60);
  ok(r.cuerpo?.estado === "listo" && r.cuerpo?.informe?.filas === 90, "avanzar, avanzar… y termina: 90 filas", `${vueltas} vueltas ${JSON.stringify(r.cuerpo).slice(0, 160)}`);
  ok(stockPorCodigo("G1006") === 6 && stockPorCodigo("G1089") === 5, "el stock de cada fila quedó como el conteo", `${stockPorCodigo("G1006")} ${stockPorCodigo("G1089")}`);
  const c = await llamar("/api/sync/inventario", { metodo: "POST", cuerpo: CSV, tipo: "text/csv" });
  ok(c.estado === 200, "terminado el grande, el siguiente conteo entra");
  const sin = await llamar("/api/sync/avanzar", { metodo: "POST" });
  ok(sin.estado === 200 && sin.cuerpo?.ok, "avanzar sin nada pendiente no falla");
}

/* ── Solo lo que cambió ──────────────────────────────────────────────── */

titulo("un catálogo grande no se pasa entero cada vez: solo lo que cambió");
{
  const base = ["Código;Descripción;Talla;Existencia;Precio"];
  for (let i = 0; i < 120; i++) base.push(`M${2000 + i};Mocasín ${i};U;${(i % 5) + 1};${20 + (i % 9)}`);
  const primera = await llamar("/api/sync/inventario?origen=Grande2", { metodo: "POST", cuerpo: base.join("\n"), tipo: "text/csv" });
  ok(primera.estado === 202 && primera.cuerpo?.filas === 120, "la primera vez pasa las 120", JSON.stringify(primera.cuerpo).slice(0, 140));
  let r;
  for (let i = 0; i < 60; i++) {
    r = await llamar(`/api/sync/avanzar?trabajo=${primera.cuerpo.trabajo}`, { metodo: "POST" });
    if (r.cuerpo?.estado === "listo") break;
  }
  ok(r.cuerpo?.estado === "listo", "…y termina", JSON.stringify(r.cuerpo).slice(0, 120));
  const mismo = await llamar("/api/sync/inventario?origen=Grande2", { metodo: "POST", cuerpo: base.join("\n"), tipo: "text/csv" });
  ok(mismo.estado === 200 && mismo.cuerpo?.sinCambios === 120 && !mismo.cuerpo?.trabajo, "el mismo archivo otra vez: «nada cambió», sin crear ningún trabajo", JSON.stringify(mismo.cuerpo).slice(0, 160));
  const movs = sql.prepare("SELECT COUNT(*) AS n FROM inv_movimientos").get().n;
  const cambio = base.slice();
  cambio[11] = cambio[11].replace(/;\d+;(\d+)$/, ";40;$1"); // otra cantidad en M2010
  cambio.push("M9999;Mocasín Nuevo;U;6;31"); // y uno nuevo
  const segunda = await llamar("/api/sync/inventario?origen=Grande2", { metodo: "POST", cuerpo: cambio.join("\n"), tipo: "text/csv" });
  ok(segunda.estado === 200 && segunda.cuerpo?.filas === 121 && segunda.cuerpo?.sinCambios === 119 && segunda.cuerpo?.informe?.filas === 2, "una cambiada y una nueva: pasa solo esas 2 y 119 quedan igual", JSON.stringify(segunda.cuerpo).slice(0, 220));
  ok(stockPorCodigo("M2010") === 40 && stockPorCodigo("M9999") === 6, "con su stock nuevo", `${stockPorCodigo("M2010")} ${stockPorCodigo("M9999")}`);
  ok(sql.prepare("SELECT COUNT(*) AS n FROM inv_movimientos").get().n <= movs + 2, "y solo dos movimientos más");
  const otroSistema = await llamar("/api/sync/inventario?origen=OtroSistema", { metodo: "POST", cuerpo: base.join("\n"), tipo: "text/csv" });
  ok(otroSistema.cuerpo?.sinCambios === undefined || otroSistema.cuerpo.sinCambios === 0, "las huellas son de cada sistema: otro origen pasa todo", JSON.stringify(otroSistema.cuerpo).slice(0, 160));
  for (let i = 0; i < 60; i++) if ((await llamar("/api/sync/avanzar", { metodo: "POST" })).cuerpo?.estado !== "trabajando") break;
  // Un conteo que se detiene a medias NO deja huellas válidas.
  const cambio2 = base.slice(0, 100).map((l, i) => (i === 0 ? l : l.replace(/;\d+;(\d+)$/, ";77;$1")));
  const a = await llamar("/api/sync/inventario?origen=Grande2", { metodo: "POST", cuerpo: cambio2.join("\n"), tipo: "text/csv" });
  ok(a.estado === 202, "otro conteo grande a medias");
  const id = a.cuerpo.trabajo;
  await inv.detenerImportacion(DB, id);
  const de_nuevo = await llamar("/api/sync/inventario?origen=Grande2", { metodo: "POST", cuerpo: cambio2.join("\n"), tipo: "text/csv" });
  ok(de_nuevo.estado === 202 && de_nuevo.cuerpo?.filas === 99 && (de_nuevo.cuerpo?.sinCambios || 0) < 99, "detenido a medias: sus filas se vuelven a pasar (no cuentan como hechas)", JSON.stringify(de_nuevo.cuerpo).slice(0, 200));
  for (let i = 0; i < 60; i++) if ((await llamar("/api/sync/avanzar", { metodo: "POST" })).cuerpo?.estado !== "trabajando") break;
}

/* ── Cómo va ─────────────────────────────────────────────────────────── */

titulo("el estado");
{
  const r = await llamar("/api/sync/estado");
  ok(r.estado === 200 && r.cuerpo.productos > 90 && Array.isArray(r.cuerpo.ultimos) && r.cuerpo.ultimos.length > 0, "productos, variantes y los últimos conteos", JSON.stringify(r.cuerpo).slice(0, 200));
  ok(r.cuerpo.ultimos[0].estado === "listo", "el último, terminado", JSON.stringify(r.cuerpo.ultimos[0]).slice(0, 120));
}

/* ── Las ventas de vuelta ────────────────────────────────────────────── */

titulo("las ventas de vuelta, para cargarlas en el sistema cerrado");
{
  const variante = sql.prepare("SELECT v.id FROM inv_variantes v JOIN inv_productos p ON p.id = v.producto_id WHERE p.titulo = 'Zapato Casual Negro' AND v.opcion = '40'").get().id;
  await inv.cobrar(DB, { sedeId: sede.id, quien: "Ana", metodoPago: "Pago Móvil", cliente: "María", items: [{ varianteId: variante, cantidad: 2 }], libres: [{ descripcion: "Arreglo de suela", cantidad: 1, precio: 5 }] });
  const r = await llamar("/api/sync/ventas");
  ok(r.estado === 200 && /text\/csv/.test(r.tipo), "CSV por defecto", r.tipo);
  const lineas = r.texto.trim().split("\n");
  ok(lineas[0] === con.COLUMNAS_DE_VENTAS.join(","), "con las columnas de siempre", lineas[0]);
  ok(lineas.some((l) => /,A100,Zapato Casual Negro,/.test(l) && /,40,,2,45,90,/.test(l)), "una fila por producto: el código DE SU SISTEMA, nombre, talla, cantidad, precio y total", lineas.join(" | ").slice(0, 300));
  ok(lineas.some((l) => /Arreglo de suela/.test(l)), "y también el cobro sin inventario");
  ok(!/costo/i.test(lineas[0]) && !/costo/i.test(r.texto.split("\n").slice(1).join(" ")), "SIN costos de ningún tipo", lineas[0]);
  // Un producto CON costo: el costo no sale por ningún lado.
  const conCosto = await inv.guardarProducto(DB, { origen: "manual", origen_id: "COSTOSO", titulo: "Reloj Con Costo", precio: 100, costo: 33.77 });
  const [vCosto] = await inv.guardarVariantes(DB, conCosto, [{ opcion: "única" }]);
  await inv.ajustarStock(DB, { varianteId: vCosto, sedeId: sede.id, cantidad: 3, quien: "t", tipo: "carga" });
  await inv.cobrar(DB, { sedeId: sede.id, quien: "Ana", metodoPago: "Efectivo", items: [{ varianteId: vCosto, cantidad: 1 }] });
  const conC = await llamar("/api/sync/ventas");
  ok(/Reloj Con Costo/.test(conC.texto) && !conC.texto.includes("33.77") && !conC.texto.includes("33,77"), "una venta de un producto CON costo: el costo no sale en el CSV", conC.texto.slice(-200));
  const conCJ = await llamar("/api/sync/ventas?formato=json");
  ok(!conCJ.texto.includes("33.77"), "ni en el JSON");
  const j = await llamar("/api/sync/ventas?formato=json");
  ok(j.cuerpo?.ok && j.cuerpo.ventas.length >= 2 && j.cuerpo.ventas.every((v) => !("costo" in v)), "en JSON también, sin costo", JSON.stringify(j.cuerpo).slice(0, 160));
  const ultimaId = Math.max(...j.cuerpo.ventas.map((v) => v.id));
  const nada = await llamar(`/api/sync/ventas?formato=json&desde_id=${ultimaId}`);
  ok(nada.cuerpo?.ok && nada.cuerpo.ventas.length === 0, "desde_id: lo que va después de la última que ya cargaste (nada)");
  const viejo = await llamar("/api/sync/ventas?formato=json&desde=2020-01-01");
  ok(viejo.cuerpo.ventas.length >= j.cuerpo.ventas.length, "desde=AAAA-MM-DD también");
  const sinClave = await llamar("/api/sync/ventas", { clave: "" });
  ok(sinClave.estado === 401, "sin clave no sale ni una venta");
}

/* ── Leer solo, de una dirección ─────────────────────────────────────── */

titulo("CONECTOR_URL: el Worker lee el archivo del sistema, solo");
{
  const fetchReal = globalThis.fetch;
  const llamadas = [];
  let respuesta = () => new Response("Código;Descripción;Existencia\nH500;Pantalón Jean;12", { headers: { "content-type": "text/csv" } });
  globalThis.fetch = async (direccion, opciones) => {
    llamadas.push({ direccion: String(direccion), cabeceras: opciones?.headers || {} });
    return respuesta();
  };
  try {
    const sin = await con.sincronizarDelSistema({ DB });
    ok(sin.hizo === false && !llamadas.length, "sin CONECTOR_URL no hace nada ni sale a ninguna parte");
    // Lo que quedó a medias de antes se termina primero.
    for (let i = 0; i < 40; i++) if ((await llamar("/api/sync/avanzar", { metodo: "POST" })).cuerpo?.estado !== "trabajando") break;
    const entorno = { DB, CONECTOR_URL: "https://sistema.test/exportar.csv", CONECTOR_CLAVE: "secreto-del-sistema", CONECTOR_ORIGEN: "MiSistema" };
    const r = await con.sincronizarDelSistema(entorno);
    ok(r.hizo && stockPorCodigo("H500") === 12, "lee el CSV de la dirección y pone el stock", JSON.stringify(r).slice(0, 160));
    ok(llamadas[0].cabeceras.Authorization === "Bearer secreto-del-sistema", "mandando la clave como Bearer", JSON.stringify(llamadas[0].cabeceras));
    ok(sql.prepare("SELECT quien FROM inv_movimientos WHERE tipo = 'carga' ORDER BY id DESC LIMIT 1").get().quien === "Sistema: MiSistema", "los movimientos dicen de qué sistema vinieron");
    respuesta = () => new Response(JSON.stringify({ generado: new Date().toISOString(), productos: [{ codigo: "H500", nombre: "Pantalón Jean", cantidad: 9 }] }), { headers: { "content-type": "application/json" } });
    const j = await con.sincronizarDelSistema(entorno);
    ok(j.hizo && stockPorCodigo("H500") === 9, "también un JSON de la API del sistema (con cabecera propia si hace falta)");
    respuesta = () => new Response("no", { status: 500 });
    const mal = await con.sincronizarDelSistema(entorno);
    ok(mal.hizo === false, "si el sistema se cae, no pasa nada: el bot sigue con lo último que tiene", JSON.stringify(mal));
    ok(stockPorCodigo("H500") === 9, "y el stock no se toca");
    respuesta = () => new Response("Código;Descripción;Existencia\nH500;Pantalón Jean;3", { headers: { "content-type": "text/csv" } });
    const filas = ["Código;Descripción;Existencia"];
    for (let i = 0; i < 60; i++) filas.push(`K${i};Cosa ${i};1`);
    await llamar("/api/sync/inventario", { metodo: "POST", cuerpo: filas.join("\n"), tipo: "text/csv" });
    llamadas.length = 0;
    const ocupado = await con.sincronizarDelSistema(entorno);
    ok(ocupado.hizo === false && !llamadas.length, "con un conteo a medias, no lee otro (no se mezclan)");
    await con.trabajoDelConector(entorno).catch(() => {});
  } finally {
    globalThis.fetch = fetchReal;
  }
}

/* ── El agente puente, de punta a punta ─────────────────────────────── */

titulo("el AGENTE PUENTE (conector-puente/): archivo y comando, contra la puerta de verdad");
{
  // Lo que quedó a medias de antes se termina primero.
  for (let i = 0; i < 60; i++) if ((await llamar("/api/sync/avanzar", { metodo: "POST" })).cuerpo?.estado !== "trabajando") break;
  const http = await import("node:http");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const agente = await import(pathToFileURL(path.resolve(import.meta.dirname, "../../conector-puente/agente-puente.mjs")).href);
  const servidor = http.createServer(async (req, res) => {
    const trozos = [];
    for await (const t of req) trozos.push(t);
    const cuerpo = Buffer.concat(trozos);
    const url = new URL(req.url, "http://127.0.0.1");
    const solicitud = new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : cuerpo });
    const r = await con.atenderSync(solicitud, env, url, { waitUntil: () => {} });
    res.writeHead(r.status, { "content-type": r.headers.get("content-type") || "text/plain" });
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const puerto = servidor.address().port;
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "puente-"));
  const registro = [];
  const registrar = (m) => registro.push(m);
  const base = { url: `http://127.0.0.1:${puerto}`, clave: CLAVE, origen: "PruebaPuente", cadaMinutos: 15 };
  try {
    // 1. Un CSV exportado por el sistema (en latin1, como lo haría un sistema viejo).
    const archivo = path.join(carpeta, "stock.csv");
    fs.writeFileSync(archivo, Buffer.from("Código;Descripción;Talla;Existencia\nP100;Camisa Azul;M;8\nP100;Camisa Azul;L;4\n", "latin1"));
    let c = await agente.ciclo({ ...base, fuente: { tipo: "archivo", ruta: archivo, codificacion: "latin1" } }, { registrar, esperar: async () => {} });
    ok(c.ok && stockPorCodigo("P100") === 12, "desde un archivo en latin1: el stock llega con sus tildes bien", JSON.stringify(c).slice(0, 160));
    ok(sql.prepare("SELECT 1 AS x FROM inv_productos WHERE titulo = 'Camisa Azul'").get(), "y el nombre con su acento");
    // 2. Un comando que escribe como sqlcmd: rayas debajo del encabezado y "(3 filas afectadas)".
    const script = path.join(carpeta, "salida.mjs");
    fs.writeFileSync(script, 'console.log("Código;Descripción;Talla;Existencia");console.log("------;-----------;-----;----------");console.log("P200;Chaqueta Cuero;L;3");console.log("P200;Chaqueta Cuero;XL;2");console.log("");console.log("(2 filas afectadas)");');
    c = await agente.ciclo({ ...base, fuente: { tipo: "comando", comando: `"${process.execPath}" "${script}"` } }, { registrar, esperar: async () => {} });
    ok(c.ok && stockPorCodigo("P200") === 5, "desde un comando (como sqlcmd): quita las rayas y el «(2 filas afectadas)»", JSON.stringify(c).slice(0, 160));
    // 3. Solo probar no guarda.
    fs.writeFileSync(archivo, "Código;Descripción;Talla;Existencia\nP300;Algo Que No Debe Entrar;U;9\n");
    c = await agente.ciclo({ ...base, fuente: { tipo: "archivo", ruta: archivo } }, { probar: true, registrar, esperar: async () => {} });
    ok(c.ok && stockPorCodigo("P300") === undefined, "--probar: no guarda nada", JSON.stringify(c).slice(0, 120));
    // 4. Un archivo viejo no se manda (el sistema dejó de exportar).
    fs.utimesSync(archivo, new Date(Date.now() - 3 * 3600000), new Date(Date.now() - 3 * 3600000));
    let error = null;
    try {
      await agente.ciclo({ ...base, fuente: { tipo: "archivo", ruta: archivo, maximoMinutos: 60 } }, { registrar, esperar: async () => {} });
    } catch (e) {
      error = e;
    }
    ok(/viejo/.test(error?.message || ""), "un archivo de hace 3 horas no se manda (maximoMinutos)", error?.message);
    // 5. Un archivo sin filas, una clave mala y un comando roto se dicen claro.
    fs.writeFileSync(archivo, "Código;Descripción;Talla;Existencia\n");
    error = null;
    try {
      await agente.ciclo({ ...base, fuente: { tipo: "archivo", ruta: archivo } }, { registrar, esperar: async () => {} });
    } catch (e) {
      error = e;
    }
    ok(/ninguna fila/.test(error?.message || ""), "sin filas: lo dice", error?.message);
    fs.writeFileSync(archivo, "Código;Descripción;Talla;Existencia\nP400;Otra;U;1\n");
    error = null;
    try {
      await agente.ciclo({ ...base, clave: "mala", fuente: { tipo: "archivo", ruta: archivo } }, { registrar, esperar: async () => {} });
    } catch (e) {
      error = e;
    }
    ok(/401/.test(error?.message || "") && !String(error?.message).includes("mala"), "clave mala: 401, y no la repite", error?.message);
    error = null;
    try {
      await agente.ciclo({ ...base, fuente: { tipo: "comando", comando: `"${process.execPath}" -e "process.exit(3)"` } }, { registrar, esperar: async () => {} });
    } catch (e) {
      error = e;
    }
    ok(/El comando falló/.test(error?.message || ""), "un comando que falla: lo dice", error?.message);
    // 6. Las ventas, a una carpeta.
    const variante = sql.prepare("SELECT v.id FROM inv_variantes v JOIN inv_productos p ON p.id = v.producto_id WHERE p.titulo = 'Camisa Azul' AND v.opcion = 'M'").get().id;
    await inv.cobrar(DB, { sedeId: sede.id, quien: "Ana", metodoPago: "Zelle", items: [{ varianteId: variante, cantidad: 1 }] });
    const ventas = path.join(carpeta, "ventas");
    const cuantas = await agente.bajarVentas({ ...base, ventas: { activar: true, carpeta: ventas } }, { registrar });
    ok(cuantas >= 1 && fs.readdirSync(ventas).some((f) => /^ventas-nuevas-\d+\.csv$/.test(f)) && fs.existsSync(path.join(ventas, "ventas-ultimos-3-dias.csv")), "las ventas nuevas y las de los últimos 3 días, en archivos", fs.readdirSync(ventas).join(", "));
    const otra = await agente.bajarVentas({ ...base, ventas: { activar: true, carpeta: ventas } }, { registrar });
    ok(otra === 0, "la segunda vez no repite las que ya bajó");
    ok(!registro.join(" ").includes(CLAVE), "el agente no imprime la clave en ninguna parte");
  } finally {
    servidor.close();
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
}

titulo("el panel (Importar) enseña cómo está la conexión, sin la clave");
{
  const { atenderPanel } = await src.cargar("panel.js");
  const entorno = { DB, PANEL_CLAVE: "clave-del-panel", TIENDA_NOMBRE: "Prueba" };
  const formulario = new FormData();
  formulario.set("clave", "clave-del-panel");
  const sesion = await atenderPanel(new Request("https://bot.test/panel/entrar", { method: "POST", body: formulario }), entorno, { tienda: "Prueba" });
  const cookie = (sesion.headers.get("set-cookie") || "").split(";")[0];
  const ver = async (env2) => {
    const r = await atenderPanel(new Request("https://bot.test/panel/inventario/importar", { headers: { cookie, "sec-fetch-site": "same-origin" } }), env2, { tienda: "Prueba", rubro: "calzado", verTexto: async () => "" });
    return { estado: r.status, html: await r.text() };
  };
  const apagada = await ver(entorno);
  ok(apagada.estado === 200 && /Conectar con tu sistema de inventario/.test(apagada.html) && /SYNC_CLAVE/.test(apagada.html) && !/chip marca">encendida/.test(apagada.html), "sin SYNC_CLAVE: dice cómo encenderla", String(apagada.estado));
  const encendida = await ver({ ...entorno, SYNC_CLAVE: CLAVE });
  ok(/chip marca">encendida/.test(encendida.html) && /https:\/\/bot\.test\/api\/sync\/inventario/.test(encendida.html) && /\/api\/sync\/ventas/.test(encendida.html), "con SYNC_CLAVE: la dirección para mandar el stock y la de las ventas");
  ok(!encendida.html.includes(CLAVE) && !apagada.html.includes(CLAVE), "y la clave NO sale en la página");
  ok(/Último conteo del sistema/.test(encendida.html) && /PruebaPuente|Sistema/.test(encendida.html), "enseña el último conteo que mandó un sistema", encendida.html.match(/Último conteo[^<]*(<b>[^<]*<\/b>)?[^<]*/)?.[0]?.slice(0, 160));
}

titulo("la clave no sale en ningún registro ni respuesta");
{
  const registro = [];
  for (let i = 0; i < 40; i++) if ((await llamar("/api/sync/avanzar", { metodo: "POST" })).cuerpo?.estado !== "trabajando") break;
  const log = console.error;
  console.error = (...a) => registro.push(a.join(" "));
  const fetchReal = globalThis.fetch;
  globalThis.fetch = async () => new Response("no", { status: 403 });
  try {
    await con.sincronizarDelSistema({ DB, CONECTOR_URL: "https://sistema.test/x.csv", CONECTOR_CLAVE: "NO-LA-IMPRIMAS" });
  } finally {
    console.error = log;
    globalThis.fetch = fetchReal;
  }
  ok(registro.length > 0 && !registro.join(" ").includes("NO-LA-IMPRIMAS"), "el error se registra sin la clave", registro.join(" ").slice(0, 120));
  const r = await llamar("/api/sync/estado");
  ok(!r.texto.includes(CLAVE), "y las respuestas tampoco la devuelven");
}

terminar();
