// LA GESTIÓN DEL NEGOCIO (fase 2, 7-oct-2026): ventas, gastos, fiados,
// balance y la IA que acompaña al dueño.
//
// QUÉ SE PEDÍA. El dueño: "un sistema completo, en la misma app, donde los
// clientes sientan que llevan su control y que la IA los apoya. Algo estilo
// Treinta pero con IA". El inventario y la caja ya estaban (inventario.js);
// aquí está lo demás de un negocio:
//
//   · GASTOS: lo que sale (alquiler, sueldos, mercancía…), por categoría.
//   · FIADOS: lo que se vendió a crédito y cuánto debe cada cliente, con
//     sus abonos.
//   · EL BALANCE: lo que entró, lo que salió y lo que se ganó, por día,
//     semana o mes, con lo más vendido y lo que se está acabando.
//   · LA IA: consejos que salen de los números (sin gastar nada) y un
//     asistente al que se le pregunta en palabras ("¿cuánto vendí esta
//     semana?", "gasté 20 en transporte").
//
// LA IA PROPONE, LA PERSONA DECIDE (misma regla que el inventario): el
// asistente nunca registra nada por su cuenta. Si entiende "gasté 20 en
// transporte", lo deja listo en un botón y una persona lo confirma.
//
// ESTE ARCHIVO ES IGUAL EN LAS TRES TIENDAS. Las ventas son las de la caja
// (inv_ventas en inventario.js); aquí se suman, no se duplican.

import { asegurarInventario, sedes } from "./inventario.js";
import { anotarGasto } from "./gasto.js";

const TABLAS_NEGOCIO = [
  `CREATE TABLE IF NOT EXISTS neg_gastos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha       INTEGER NOT NULL,
    categoria   TEXT NOT NULL,
    descripcion TEXT NOT NULL DEFAULT '',
    monto       REAL NOT NULL CHECK (monto > 0),
    metodo      TEXT NOT NULL DEFAULT '',
    quien       TEXT NOT NULL DEFAULT '',
    local_id    INTEGER,
    borrado     INTEGER NOT NULL DEFAULT 0,
    creado      INTEGER NOT NULL
  )`,
  // Lo que un cliente va pagando de una venta fiada.
  `CREATE TABLE IF NOT EXISTS neg_abonos (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    venta_id INTEGER NOT NULL,
    monto    REAL NOT NULL CHECK (monto > 0),
    metodo   TEXT NOT NULL DEFAULT '',
    quien    TEXT NOT NULL DEFAULT '',
    nota     TEXT NOT NULL DEFAULT '',
    creado   INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS neg_gastos_fecha ON neg_gastos (fecha)",
  "CREATE INDEX IF NOT EXISTS neg_abonos_venta ON neg_abonos (venta_id)",
  "CREATE INDEX IF NOT EXISTS neg_abonos_creado ON neg_abonos (creado)",
];

export const CATEGORIAS_DE_GASTO = [
  "Mercancía",
  "Alquiler",
  "Sueldos",
  "Servicios (luz, agua, internet)",
  "Transporte",
  "Publicidad",
  "Comisiones",
  "Mantenimiento",
  "Impuestos",
  "Otros",
];

export const METODOS_DE_PAGO = ["Divisas (efectivo)", "Pago móvil", "Transferencia", "Punto de venta", "Zelle", "Cashea", "Bolívares (efectivo)", "Otro"];

let listo = false;

export async function asegurarNegocio(db) {
  await asegurarInventario(db);
  if (listo) return;
  for (const sentencia of TABLAS_NEGOCIO) await db.prepare(sentencia).run();
  listo = true;
}

export function olvidarQueNegocioEstaListo() {
  listo = false;
}

/* ── Las fechas, en hora de Venezuela ────────────────────────────────── */

const DESFASE_MS = -4 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;

export function diaDe(ms) {
  return new Date(Number(ms) + DESFASE_MS).toISOString().slice(0, 10);
}

function inicioDe(dia) {
  return Date.parse(`${dia}T00:00:00Z`) - DESFASE_MS;
}

// El período que se mira: ?p=hoy|ayer|7|30|mes|mes-pasado, o ?desde=&hasta=.
// Devuelve { desde, hasta } en ms (hasta excluido), los días y un nombre.
export function periodoDe(params, ahora = Date.now()) {
  const p = String(params?.get?.("p") || "hoy");
  const hoy = diaDe(ahora);
  const valido = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || "")) && Number.isFinite(Date.parse(`${d}T00:00:00Z`));
  const desdeTexto = params?.get?.("desde");
  const hastaTexto = params?.get?.("hasta");
  if (valido(desdeTexto) && valido(hastaTexto) && desdeTexto <= hastaTexto) {
    return armar(desdeTexto, hastaTexto, "a-medida", `del ${desdeTexto} al ${hastaTexto}`);
  }
  const menos = (n) => diaDe(inicioDe(hoy) - n * DIA_MS + 12 * 3600 * 1000);
  if (p === "ayer") return armar(menos(1), menos(1), p, "ayer");
  if (p === "7") return armar(menos(6), hoy, p, "los últimos 7 días");
  if (p === "30") return armar(menos(29), hoy, p, "los últimos 30 días");
  if (p === "mes") return armar(`${hoy.slice(0, 8)}01`, hoy, p, "este mes");
  if (p === "mes-pasado") {
    const primero = `${hoy.slice(0, 8)}01`;
    const ultimoDelAnterior = diaDe(inicioDe(primero) - DIA_MS + 12 * 3600 * 1000);
    return armar(`${ultimoDelAnterior.slice(0, 8)}01`, ultimoDelAnterior, p, "el mes pasado");
  }
  return armar(hoy, hoy, "hoy", "hoy");

  function armar(d, h, clave, nombre) {
    const desde = inicioDe(d);
    const hasta = inicioDe(h) + DIA_MS;
    return { clave, nombre, desdeDia: d, hastaDia: h, desde, hasta, dias: Math.round((hasta - desde) / DIA_MS) };
  }
}

function numero(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  let t = String(valor).replace(/[^\d.,-]/g, "");
  if (!t) return null;
  if (t.includes(",") && t.includes(".")) t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if (t.includes(",")) t = /,\d{1,2}$/.test(t) ? t.replace(",", ".") : t.replace(/,/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const redondo = (n) => Math.round((Number(n) || 0) * 100) / 100;

/* ── Gastos ──────────────────────────────────────────────────────────── */

export async function registrarGasto(db, { categoria, descripcion = "", monto, metodo = "", quien = "", fecha = null, sedeId = null }) {
  await asegurarNegocio(db);
  const m = numero(monto);
  if (m === null || m <= 0) throw new Error("El monto del gasto tiene que ser mayor que cero.");
  if (m > 10_000_000) throw new Error("Ese monto no parece real.");
  const cat = CATEGORIAS_DE_GASTO.includes(categoria) ? categoria : "Otros";
  let cuando = Date.now();
  if (fecha && /^\d{4}-\d{2}-\d{2}$/.test(String(fecha))) {
    const dia = String(fecha);
    cuando = dia === diaDe(Date.now()) ? Date.now() : inicioDe(dia) + 12 * 3600 * 1000;
  }
  await db
    .prepare("INSERT INTO neg_gastos (fecha, categoria, descripcion, monto, metodo, quien, local_id, creado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(cuando, cat, String(descripcion).trim().slice(0, 200), redondo(m), String(metodo).slice(0, 40), String(quien).slice(0, 60), Number(sedeId) || null, Date.now())
    .run();
  return redondo(m);
}

// No se borra de verdad: queda marcado, por si fue un error al borrar.
export async function borrarGasto(db, id) {
  await asegurarNegocio(db);
  await db.prepare("UPDATE neg_gastos SET borrado = 1 WHERE id = ?").bind(Number(id) || 0).run();
}

export async function listarGastos(db, { desde, hasta, limite = 500 } = {}) {
  await asegurarNegocio(db);
  const { results } = await db
    .prepare("SELECT * FROM neg_gastos WHERE borrado = 0 AND fecha >= ? AND fecha < ? ORDER BY fecha DESC, id DESC LIMIT ?")
    .bind(desde, hasta, Math.min(Number(limite) || 500, 2000))
    .all();
  return results || [];
}

/* ── Ventas ──────────────────────────────────────────────────────────── */

export async function listarVentas(db, { desde, hasta, q = "", limite = 300 } = {}) {
  await asegurarNegocio(db);
  const texto = String(q || "").trim().slice(0, 40);
  const filtro = texto ? "AND (ve.cliente LIKE ? OR ve.telefono LIKE ? OR ve.id = ?)" : "";
  const args = texto ? [`%${texto}%`, `%${texto}%`, Number(texto.replace(/^#/, "")) || -1] : [];
  const { results } = await db
    .prepare(
      `SELECT ve.*, l.nombre AS sede,
              COALESCE((SELECT SUM(-delta) FROM inv_movimientos m WHERE m.venta_id = ve.id AND m.tipo = 'venta'), 0)
                + COALESCE((SELECT SUM(cantidad) FROM inv_venta_libre x WHERE x.venta_id = ve.id), 0) AS unidades,
              COALESCE((SELECT SUM(monto) FROM neg_abonos a WHERE a.venta_id = ve.id), 0) AS abonado
         FROM inv_ventas ve LEFT JOIN inv_locales l ON l.id = ve.local_id
        WHERE ve.creado >= ? AND ve.creado < ? ${filtro}
        ORDER BY ve.id DESC LIMIT ?`
    )
    .bind(desde, hasta, ...args, Math.min(Number(limite) || 300, 2000))
    .all();
  const ventas = results || [];
  if (!ventas.length) return ventas;
  // Qué se llevó cada una ("2 × Jordan 4 · Gorra"), en dos consultas por
  // rango de ids (D1 no deja más de 100 valores en un IN).
  const min = Math.min(...ventas.map((v) => v.id));
  const max = Math.max(...ventas.map((v) => v.id));
  const { results: lineas } = await db
    .prepare(
      `SELECT m.venta_id, p.titulo, v.opcion, SUM(-m.delta) AS cantidad FROM inv_movimientos m
         JOIN inv_variantes v ON v.id = m.variante_id JOIN inv_productos p ON p.id = v.producto_id
        WHERE m.tipo = 'venta' AND m.venta_id BETWEEN ? AND ? GROUP BY m.venta_id, m.variante_id ORDER BY MIN(m.id)`
    )
    .bind(min, max)
    .all();
  const { results: libres } = await db.prepare("SELECT venta_id, descripcion AS titulo, cantidad FROM inv_venta_libre WHERE venta_id BETWEEN ? AND ? ORDER BY id").bind(min, max).all();
  const detalle = new Map();
  for (const l of [...(lineas || []), ...(libres || [])]) {
    if (!detalle.has(l.venta_id)) detalle.set(l.venta_id, []);
    detalle.get(l.venta_id).push(`${Number(l.cantidad) > 1 ? `${l.cantidad} × ` : ""}${l.titulo}${l.opcion && l.opcion !== "única" ? ` (${l.opcion})` : ""}`);
  }
  return ventas.map((v) => ({ ...v, detalle: (detalle.get(v.id) || []).join(" · ") }));
}

export async function verVenta(db, id) {
  await asegurarNegocio(db);
  const venta = await db
    .prepare("SELECT ve.*, l.nombre AS sede FROM inv_ventas ve LEFT JOIN inv_locales l ON l.id = ve.local_id WHERE ve.id = ?")
    .bind(Number(id) || 0)
    .first();
  if (!venta) return null;
  const { results: lineas } = await db
    .prepare(
      `SELECT p.id AS producto_id, p.titulo, v.opcion, v.color, v.codigo_barras, SUM(-m.delta) AS cantidad, m.precio, m.costo
         FROM inv_movimientos m JOIN inv_variantes v ON v.id = m.variante_id JOIN inv_productos p ON p.id = v.producto_id
        WHERE m.venta_id = ? AND m.tipo = 'venta'
        GROUP BY m.variante_id ORDER BY MIN(m.id)`
    )
    .bind(venta.id)
    .all();
  const { results: libres } = await db.prepare("SELECT descripcion, cantidad, precio FROM inv_venta_libre WHERE venta_id = ? ORDER BY id").bind(venta.id).all();
  const { results: abonos } = await db.prepare("SELECT * FROM neg_abonos WHERE venta_id = ? ORDER BY id").bind(venta.id).all();
  const abonado = (abonos || []).reduce((a, x) => a + Number(x.monto), 0);
  return {
    ...venta,
    lineas: lineas || [],
    libres: libres || [],
    abonos: abonos || [],
    abonado: redondo(abonado),
    saldo: venta.fiado && !venta.anulada ? redondo(Math.max(0, (Number(venta.total) || 0) - abonado)) : 0,
  };
}

// El IMEI o serial que la caja de una tienda de teléfonos anota en la venta
// (sale en el recibo, para la garantía).
export function serialDe(nota) {
  const m = String(nota || "").match(/IMEI\/serial:\s*([^·]+)/i);
  return m ? `IMEI/serial: ${m[1].trim()}` : "";
}

// El recibo como texto, para mandarlo por WhatsApp.
export function textoDelRecibo(venta, tienda = "La tienda") {
  const plata = (n) => (n === null || n === undefined ? "" : `$${redondo(n)}`);
  const lineas = [
    ...venta.lineas.map((l) => `• ${l.cantidad} × ${l.titulo}${l.opcion && l.opcion !== "única" ? ` (${l.opcion})` : ""}${l.precio !== null ? ` — ${plata(l.precio * l.cantidad)}` : ""}`),
    ...venta.libres.map((l) => `• ${l.cantidad} × ${l.descripcion} — ${plata(l.precio * l.cantidad)}`),
  ];
  return [
    `*${tienda}*`,
    `Recibo #${venta.id} · ${new Date(venta.creado).toLocaleString("es-VE", { timeZone: "America/Caracas", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`,
    venta.cliente ? `Cliente: ${venta.cliente}` : "",
    "",
    ...lineas,
    serialDe(venta.nota),
    "",
    `*Total: ${venta.total === null ? "por confirmar" : plata(venta.total)}*`,
    venta.fiado ? `Abonado: ${plata(venta.abonado)} · Pendiente: ${plata(venta.saldo)}` : venta.metodo_pago ? `Pago: ${venta.metodo_pago}` : "",
    venta.anulada ? "VENTA ANULADA" : "",
    "",
    "¡Gracias por tu compra!",
  ]
    .filter((x, i, a) => x !== "" || (a[i - 1] !== "" && i > 0))
    .join("\n")
    .trim();
}

/* ── Fiados ──────────────────────────────────────────────────────────── */
//
// Un cliente se reconoce por su teléfono, o por su nombre si no dejó
// teléfono. Su deuda es la suma de lo que le falta pagar de cada venta
// fiada (no anulada).

export function claveDeCliente(nombre, telefono) {
  const tel = String(telefono || "").replace(/\D/g, "");
  if (tel.length >= 7) return `t:${tel.slice(-10)}`;
  return `n:${String(nombre || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim()}`;
}

export async function listarFiados(db, { incluirPagados = false } = {}) {
  await asegurarNegocio(db);
  const { results } = await db
    .prepare(
      `SELECT ve.id, ve.cliente, ve.telefono, ve.total, ve.creado,
              COALESCE((SELECT SUM(monto) FROM neg_abonos a WHERE a.venta_id = ve.id), 0) AS abonado
         FROM inv_ventas ve WHERE ve.fiado = 1 AND ve.anulada = 0 ORDER BY ve.creado`
    )
    .all();
  const porCliente = new Map();
  for (const v of results || []) {
    const clave = claveDeCliente(v.cliente, v.telefono);
    if (!porCliente.has(clave)) porCliente.set(clave, { clave, cliente: v.cliente, telefono: v.telefono, total: 0, abonado: 0, saldo: 0, ventas: [], desde: null, ultima: 0 });
    const c = porCliente.get(clave);
    const saldo = Math.max(0, (Number(v.total) || 0) - Number(v.abonado));
    c.total += Number(v.total) || 0;
    c.abonado += Number(v.abonado);
    c.saldo += saldo;
    if (v.telefono && !c.telefono) c.telefono = v.telefono;
    c.ultima = Math.max(c.ultima, v.creado);
    if (saldo > 0.009 && !c.desde) c.desde = v.creado;
    c.ventas.push({ ...v, saldo: redondo(saldo) });
  }
  return [...porCliente.values()]
    .map((c) => ({ ...c, total: redondo(c.total), abonado: redondo(c.abonado), saldo: redondo(c.saldo) }))
    .filter((c) => incluirPagados || c.saldo > 0.009)
    .sort((a, b) => b.saldo - a.saldo);
}

// Un abono de un cliente se reparte entre sus ventas fiadas, de la más
// vieja a la más nueva. No se acepta más de lo que debe.
export async function abonar(db, { clave, monto, metodo = "", quien = "", nota = "" }) {
  await asegurarNegocio(db);
  const m = numero(monto);
  if (m === null || m <= 0) throw new Error("El abono tiene que ser mayor que cero.");
  const cliente = (await listarFiados(db)).find((c) => c.clave === clave);
  if (!cliente) throw new Error("Ese cliente no debe nada.");
  if (m > cliente.saldo + 0.009) throw new Error(`Debe ${cliente.saldo}: el abono no puede ser mayor.`);
  let resta = redondo(m);
  const ahora = Date.now();
  const sentencias = [];
  for (const v of cliente.ventas) {
    if (resta <= 0) break;
    if (v.saldo <= 0) continue;
    const parte = redondo(Math.min(resta, v.saldo));
    sentencias.push(
      db.prepare("INSERT INTO neg_abonos (venta_id, monto, metodo, quien, nota, creado) VALUES (?, ?, ?, ?, ?, ?)").bind(v.id, parte, String(metodo).slice(0, 40), String(quien).slice(0, 60), String(nota).slice(0, 200), ahora)
    );
    resta = redondo(resta - parte);
  }
  await db.batch(sentencias);
  return { cliente: cliente.cliente, abonado: redondo(m), queda: redondo(cliente.saldo - m) };
}

/* ── El balance ──────────────────────────────────────────────────────── */

export async function resumen(db, { desde, hasta }) {
  await asegurarNegocio(db);
  const ventas = await db
    .prepare(
      `SELECT COUNT(*) AS cantidad, COALESCE(SUM(total), 0) AS total, SUM(CASE WHEN total IS NULL THEN 1 ELSE 0 END) AS sin_precio,
              COALESCE(SUM(CASE WHEN fiado = 0 THEN total ELSE 0 END), 0) AS contado,
              COALESCE(SUM(CASE WHEN fiado = 1 THEN total ELSE 0 END), 0) AS fiado
         FROM inv_ventas WHERE anulada = 0 AND creado >= ? AND creado < ?`
    )
    .bind(desde, hasta)
    .first();
  // La ganancia de lo vendido: precio − costo de cada producto que tiene
  // costo cargado. Lo que no lo tiene se dice aparte, para no inventar.
  const margen = await db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN m.costo IS NOT NULL AND m.precio IS NOT NULL THEN -m.delta * (m.precio - m.costo) ELSE 0 END), 0) AS ganancia,
              COALESCE(SUM(CASE WHEN m.costo IS NOT NULL AND m.precio IS NOT NULL THEN -m.delta * m.precio ELSE 0 END), 0) AS vendido_con_costo,
              COALESCE(SUM(CASE WHEN m.precio IS NOT NULL THEN -m.delta * m.precio ELSE 0 END), 0) AS vendido,
              COALESCE(SUM(-m.delta), 0) AS unidades
         FROM inv_movimientos m JOIN inv_ventas ve ON ve.id = m.venta_id
        WHERE m.tipo = 'venta' AND ve.anulada = 0 AND ve.creado >= ? AND ve.creado < ?`
    )
    .bind(desde, hasta)
    .first();
  const libres = await db
    .prepare(
      `SELECT COALESCE(SUM(x.cantidad), 0) AS unidades FROM inv_venta_libre x JOIN inv_ventas ve ON ve.id = x.venta_id
        WHERE ve.anulada = 0 AND ve.creado >= ? AND ve.creado < ?`
    )
    .bind(desde, hasta)
    .first();
  const abonos = await db
    .prepare("SELECT COALESCE(SUM(a.monto), 0) AS total FROM neg_abonos a JOIN inv_ventas ve ON ve.id = a.venta_id WHERE ve.anulada = 0 AND a.creado >= ? AND a.creado < ?")
    .bind(desde, hasta)
    .first();
  const { results: gastosPorCategoria } = await db
    .prepare("SELECT categoria, SUM(monto) AS total, COUNT(*) AS cantidad FROM neg_gastos WHERE borrado = 0 AND fecha >= ? AND fecha < ? GROUP BY categoria ORDER BY total DESC")
    .bind(desde, hasta)
    .all();
  const { results: porMetodo } = await db
    .prepare(
      `SELECT CASE WHEN metodo_pago = '' THEN 'Sin decir' ELSE metodo_pago END AS metodo, COUNT(*) AS cantidad, COALESCE(SUM(total), 0) AS total
         FROM inv_ventas WHERE anulada = 0 AND creado >= ? AND creado < ? GROUP BY 1 ORDER BY total DESC`
    )
    .bind(desde, hasta)
    .all();
  const { results: masVendidos } = await db
    .prepare(
      `SELECT p.id, p.titulo, SUM(-m.delta) AS unidades, COALESCE(SUM(-m.delta * m.precio), 0) AS monto
         FROM inv_movimientos m JOIN inv_ventas ve ON ve.id = m.venta_id
         JOIN inv_variantes v ON v.id = m.variante_id JOIN inv_productos p ON p.id = v.producto_id
        WHERE m.tipo = 'venta' AND ve.anulada = 0 AND ve.creado >= ? AND ve.creado < ?
        GROUP BY p.id ORDER BY unidades DESC, monto DESC LIMIT 10`
    )
    .bind(desde, hasta)
    .all();

  // Por día, para el gráfico.
  const dias = [];
  for (let t = desde; t < hasta; t += DIA_MS) dias.push({ dia: diaDe(t + 12 * 3600 * 1000), ventas: 0, gastos: 0, cantidad: 0 });
  const indice = new Map(dias.map((d, i) => [d.dia, i]));
  const { results: ventasDia } = await db.prepare("SELECT creado, total FROM inv_ventas WHERE anulada = 0 AND creado >= ? AND creado < ?").bind(desde, hasta).all();
  for (const v of ventasDia || []) {
    const i = indice.get(diaDe(v.creado));
    if (i !== undefined) {
      dias[i].ventas += Number(v.total) || 0;
      dias[i].cantidad++;
    }
  }
  const { results: gastosDia } = await db.prepare("SELECT fecha, monto FROM neg_gastos WHERE borrado = 0 AND fecha >= ? AND fecha < ?").bind(desde, hasta).all();
  for (const g of gastosDia || []) {
    const i = indice.get(diaDe(g.fecha));
    if (i !== undefined) dias[i].gastos += Number(g.monto) || 0;
  }

  const totalGastos = (gastosPorCategoria || []).reduce((a, g) => a + Number(g.total), 0);
  const cobrado = Number(ventas.contado) + Number(abonos.total);
  return {
    ventas: {
      cantidad: Number(ventas.cantidad) || 0,
      total: redondo(ventas.total),
      contado: redondo(ventas.contado),
      fiado: redondo(ventas.fiado),
      sinPrecio: Number(ventas.sin_precio) || 0,
      unidades: (Number(margen.unidades) || 0) + (Number(libres.unidades) || 0),
      ticketPromedio: Number(ventas.cantidad) ? redondo(Number(ventas.total) / Number(ventas.cantidad)) : 0,
    },
    abonos: redondo(abonos.total),
    cobrado: redondo(cobrado),
    gastos: { total: redondo(totalGastos), porCategoria: (gastosPorCategoria || []).map((g) => ({ ...g, total: redondo(g.total) })) },
    balance: redondo(cobrado - totalGastos),
    ganancia: {
      monto: redondo(margen.ganancia),
      // Qué parte de lo vendido (en dinero) tiene costo cargado.
      cobertura: Number(margen.vendido) > 0 ? Math.round((Number(margen.vendido_con_costo) / Number(margen.vendido)) * 100) : 0,
    },
    porMetodo: (porMetodo || []).map((m) => ({ ...m, total: redondo(m.total) })),
    masVendidos: (masVendidos || []).map((m) => ({ ...m, monto: redondo(m.monto) })),
    dias: dias.map((d) => ({ ...d, ventas: redondo(d.ventas), gastos: redondo(d.gastos) })),
  };
}

// Lo que se está acabando: tallas con 2 o menos (en todas las sedes) que
// se vendieron en los últimos 30 días, primero las que más se venden.
export async function seEstanAcabando(db, { umbral = 2, limite = 12 } = {}) {
  await asegurarNegocio(db);
  const hace30 = Date.now() - 30 * DIA_MS;
  const { results } = await db
    .prepare(
      `SELECT v.id, p.id AS producto_id, p.titulo, v.opcion, v.color,
              COALESCE((SELECT SUM(cantidad) FROM inv_stock s WHERE s.variante_id = v.id), 0) AS quedan,
              (SELECT SUM(-delta) FROM inv_movimientos m WHERE m.variante_id = v.id AND m.tipo = 'venta' AND m.creado >= ?) AS vendidas
         FROM inv_variantes v JOIN inv_productos p ON p.id = v.producto_id AND p.activo = 1
        WHERE vendidas > 0 AND quedan <= ?
        ORDER BY vendidas DESC, quedan LIMIT ?`
    )
    .bind(hace30, umbral, limite)
    .all();
  return results || [];
}

/* ── La IA que acompaña: consejos de los números ─────────────────────── */
//
// No cuestan nada: salen de comparar los números. Cada uno dice qué pasa y
// lleva a la pantalla donde se arregla. icono y tono son de marco.js
// (iconos.js): nada de emojis.

export function consejos({ actual, anterior, acabando = [], fiados = [], periodo }) {
  const lista = [];
  const plata = (n) => `$${redondo(n)}`;
  if (actual.ventas.cantidad === 0 && periodo.clave === "hoy") {
    lista.push({ icono: "caja", tono: "marca", texto: "Todavía no hay ventas hoy. Cuando cobres en la Caja, aquí verás cómo va el día.", enlace: "/panel/caja" });
  }
  if (anterior && anterior.ventas.total > 0 && actual.ventas.total > 0) {
    const cambio = Math.round(((actual.ventas.total - anterior.ventas.total) / anterior.ventas.total) * 100);
    if (cambio >= 15) lista.push({ icono: "sube", tono: "bien", texto: `Vendiste ${cambio}% más que en el período anterior (${plata(actual.ventas.total)} contra ${plata(anterior.ventas.total)}).` });
    else if (cambio <= -15) lista.push({ icono: "baja", tono: "mal", texto: `Las ventas bajaron ${-cambio}% frente al período anterior (${plata(actual.ventas.total)} contra ${plata(anterior.ventas.total)}). Revisa qué se vendía antes y si queda stock.`, enlace: "/panel/inventario?f=agotados" });
  }
  if (acabando.length) {
    const nombres = acabando.slice(0, 3).map((a) => `${a.titulo}${a.opcion !== "única" ? ` (${a.opcion})` : ""}: ${a.quedan}`).join(" · ");
    lista.push({ icono: "inventario", tono: "aviso", texto: `Se está acabando lo que más se vende: ${nombres}. Conviene reponer.`, enlace: "/panel/inventario?f=pocos" });
  }
  const viejos = fiados.filter((f) => f.desde && Date.now() - f.desde > 15 * DIA_MS);
  if (viejos.length) {
    const total = viejos.reduce((a, f) => a + f.saldo, 0);
    lista.push({ icono: "fiados", tono: "aviso", texto: `${viejos.length} ${viejos.length === 1 ? "cliente debe" : "clientes deben"} desde hace más de 15 días (${plata(total)}). Mándales un recordatorio por WhatsApp.`, enlace: "/panel/fiados" });
  }
  if (actual.gastos.total > 0 && actual.cobrado > 0 && actual.gastos.total > actual.cobrado) {
    lista.push({ icono: "alerta", tono: "mal", texto: `Salió más de lo que entró: ${plata(actual.gastos.total)} en gastos contra ${plata(actual.cobrado)} cobrado.`, enlace: "/panel/gastos" });
  }
  const mayor = actual.gastos.porCategoria[0];
  if (mayor && actual.gastos.total > 0 && mayor.total / actual.gastos.total >= 0.5 && actual.gastos.porCategoria.length > 1) {
    lista.push({ icono: "gastos", tono: "neutro", texto: `${mayor.categoria} se lleva ${Math.round((mayor.total / actual.gastos.total) * 100)}% de los gastos.` });
  }
  if (actual.ventas.total > 0 && actual.ganancia.cobertura < 60) {
    lista.push({ icono: "idea", tono: "ia", texto: "Carga el costo de tus productos (Inventario → el modelo → Costo) y te digo cuánto ganas de verdad en cada venta.", enlace: "/panel/inventario" });
  }
  if (actual.ventas.sinPrecio > 0) {
    lista.push({ icono: "etiqueta", tono: "aviso", texto: `${actual.ventas.sinPrecio} ${actual.ventas.sinPrecio === 1 ? "venta tiene" : "ventas tienen"} productos sin precio: no suman al total. Ponles precio en el inventario.`, enlace: "/panel/inventario" });
  }
  const top = actual.masVendidos[0];
  if (top && top.unidades >= 3) lista.push({ icono: "ganadores", tono: "bien", texto: `Lo más vendido ${periodo.nombre}: ${top.titulo} (${top.unidades} unidades).`, enlace: `/panel/inventario/p/${top.id}` });
  return lista;
}

/* ── El asistente: se le pregunta en palabras ────────────────────────── */
//
// Usa la IA de texto de la tienda (OpenAI con OPENAI_MODELO, o DeepSeek si
// PROVEEDOR = "deepseek"). Recibe SOLO los números del negocio, ya
// calculados: no inventa cifras, las lee. Cuesta lo de una respuesta corta
// y se anota en el gasto de la IA como "asistente".

const INSTRUCCIONES_ASISTENTE = `Eres el asistente de negocio de ALPHA IA dentro del panel de una tienda en Venezuela.
Le hablas al dueño o a su equipo: claro, cálido, en español neutro y breve (máximo 6 líneas).
Tienes los NÚMEROS REALES del negocio en JSON. Úsalos tal cual: nunca inventes cifras, productos ni clientes.
Si algo no está en los datos, dilo ("no tengo ese dato") y di dónde se carga en el panel.
Los montos van en dólares con el signo $.
Puedes dar ideas concretas para vender más o gastar menos, siempre basadas en los datos.

Si te piden REGISTRAR algo (un gasto o un abono de un cliente que debe), NO lo registras tú:
lo dejas preparado en "accion" para que una persona lo confirme con un botón.
  · Gasto: {"tipo":"gasto","monto":20,"categoria":"Transporte","descripcion":"taxi"}
    categoria es una de: ${CATEGORIAS_DE_GASTO.join(", ")}.
  · Abono: {"tipo":"abono","clave":"<la clave del cliente en fiados>","cliente":"<nombre>","monto":10}
    Solo si el cliente está en la lista de fiados; si no, explícalo.
Si no hay nada que registrar, "accion" es null.

Responde SOLO con JSON: {"respuesta":"texto para el dueño","accion":null}`;

export function asistenteActivo(env) {
  const deepseek = String(env?.PROVEEDOR || "").toLowerCase() === "deepseek";
  return deepseek ? Boolean(env?.DEEPSEEK_API_KEY) : Boolean(env?.OPENAI_API_KEY);
}

export async function datosParaElAsistente(db, ahora = Date.now()) {
  const periodos = {};
  for (const clave of ["hoy", "ayer", "7", "30", "mes", "mes-pasado"]) {
    const p = periodoDe(new URLSearchParams({ p: clave }), ahora);
    const r = await resumen(db, p);
    periodos[p.nombre] = {
      desde: p.desdeDia,
      hasta: p.hastaDia,
      ventas: r.ventas,
      cobrado: r.cobrado,
      gastos: r.gastos,
      balance: r.balance,
      ganancia: r.ganancia,
      porMetodo: r.porMetodo,
      masVendidos: r.masVendidos.slice(0, 5).map((m) => ({ titulo: m.titulo, unidades: m.unidades, monto: m.monto })),
    };
  }
  const fiados = (await listarFiados(db)).slice(0, 30).map((f) => ({ clave: f.clave, cliente: f.cliente, saldo: f.saldo, debeDesde: f.desde ? diaDe(f.desde) : null }));
  const acabando = (await seEstanAcabando(db)).map((a) => ({ titulo: a.titulo, talla: a.opcion, quedan: a.quedan, vendidasEn30Dias: a.vendidas }));
  const inventario = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM inv_productos WHERE activo = 1) AS modelos,
              (SELECT COALESCE(SUM(s.cantidad), 0) FROM inv_stock s) AS unidades,
              (SELECT COALESCE(SUM(s.cantidad * COALESCE(v.precio, p.precio)), 0) FROM inv_stock s JOIN inv_variantes v ON v.id = s.variante_id JOIN inv_productos p ON p.id = v.producto_id) AS valor_a_precio_de_venta,
              (SELECT COALESCE(SUM(s.cantidad * p.costo), 0) FROM inv_stock s JOIN inv_variantes v ON v.id = s.variante_id JOIN inv_productos p ON p.id = v.producto_id WHERE p.costo IS NOT NULL) AS valor_al_costo`
    )
    .first();
  return { hoy: diaDe(ahora), sedes: (await sedes(db)).map((s) => s.nombre), periodos, fiados, seEstanAcabando: acabando, inventario };
}

const RUBRO_EN_PALABRAS = { calzado: "zapatería (cada modelo con sus tallas)", moda: "tienda de calzado, bolsos, camisas, pantalones y gorras (por tallas)", telefonos: "tienda de teléfonos (por capacidad y color; precio en divisas y precio Cashea)" };

export async function preguntarAlAsistente(env, pregunta, { tienda = "La tienda", historial = [], rubro = "" } = {}) {
  const texto = String(pregunta || "").trim().slice(0, 500);
  if (!texto) throw new Error("Escribe qué quieres saber.");
  if (!asistenteActivo(env)) throw new Error("El asistente necesita la clave de la IA de la tienda (la misma que usa el bot).");
  await asegurarNegocio(env.DB);
  const datos = await datosParaElAsistente(env.DB);
  const deepseek = String(env?.PROVEEDOR || "").toLowerCase() === "deepseek";
  const modelo = deepseek ? env.DEEPSEEK_MODELO || "deepseek-chat" : env.OPENAI_MODELO || "gpt-4o-mini";
  const mensajes = [
    { role: "system", content: `${INSTRUCCIONES_ASISTENTE}\n\nTIENDA: ${tienda}${RUBRO_EN_PALABRAS[rubro] ? ` · ${RUBRO_EN_PALABRAS[rubro]}` : ""}\n\nDATOS DEL NEGOCIO:\n${JSON.stringify(datos)}` },
    ...historial.slice(-6).map((h) => ({ role: h.de === "yo" ? "user" : "assistant", content: String(h.texto || "").slice(0, 800) })),
    { role: "user", content: texto },
  ];
  const r = await fetch(deepseek ? "https://api.deepseek.com/chat/completions" : "https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${deepseek ? env.DEEPSEEK_API_KEY : env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: modelo, temperature: 0.2, response_format: { type: "json_object" }, messages: mensajes, max_tokens: 500 }),
    signal: AbortSignal.timeout(20000),
  }).catch((error) => ({ ok: false, status: 0, error }));
  if (!r.ok) {
    console.log(`ASISTENTE: la IA respondió ${r.status || r.error?.message}`);
    throw new Error(r.status === 429 ? "La IA está sin saldo o muy ocupada. Prueba en un rato." : "La IA no respondió. Prueba otra vez.");
  }
  const cuerpo = await r.json();
  if (cuerpo?.usage) {
    await anotarGasto(env, {
      modelo: `${modelo} (asistente)`,
      entrada: cuerpo.usage.prompt_tokens || 0,
      cacheadas: cuerpo.usage.prompt_cache_hit_tokens || cuerpo.usage.prompt_tokens_details?.cached_tokens || 0,
      salida: cuerpo.usage.completion_tokens || 0,
    }).catch(() => {});
  }
  let salida = {};
  try {
    salida = JSON.parse(cuerpo?.choices?.[0]?.message?.content || "{}");
  } catch {
    salida = { respuesta: String(cuerpo?.choices?.[0]?.message?.content || "") };
  }
  return { respuesta: String(salida.respuesta || "No entendí la pregunta. ¿Me la dices de otra forma?").slice(0, 2000), accion: accionValida(salida.accion, datos) };
}

// Lo que propone la IA se revisa antes de enseñarlo como botón: una
// categoría que existe, un monto razonable, un cliente que de verdad debe.
function accionValida(accion, datos) {
  if (!accion || typeof accion !== "object") return null;
  const monto = numero(accion.monto);
  if (monto === null || monto <= 0 || monto > 10_000_000) return null;
  if (accion.tipo === "gasto") {
    return {
      tipo: "gasto",
      monto: redondo(monto),
      categoria: CATEGORIAS_DE_GASTO.includes(accion.categoria) ? accion.categoria : "Otros",
      descripcion: String(accion.descripcion || "").slice(0, 200),
    };
  }
  if (accion.tipo === "abono") {
    const cliente = datos.fiados.find((f) => f.clave === accion.clave) || datos.fiados.find((f) => f.cliente && f.cliente.toLowerCase() === String(accion.cliente || "").toLowerCase());
    if (!cliente) return null;
    return { tipo: "abono", clave: cliente.clave, cliente: cliente.cliente, monto: redondo(Math.min(monto, cliente.saldo)) };
  }
  return null;
}
