// LOS PEDIDOS DE LA TIENDA WEB, PAGADOS CON COMPROBANTE (12-oct-2026, pedido
// del dueño: "dentro de esta página vamos a colocar los pagos").
//
// CÓMO VA.
//   1. En /tienda/pagar el cliente pone sus datos, elige cómo paga (Pago
//      Móvil, Transferencia, Zelle, Zinli, Binance… lo que la tienda tenga
//      cargado), ve los datos para pagar y SUBE EL COMPROBANTE.
//   2. El pedido queda "por revisar" en el panel (/panel/pedidos) con la foto
//      del comprobante. Le llega un aviso al asesor (Slack) y al panel central.
//   3. El dueño o el asesor mira el pago y lo APRUEBA o lo RECHAZA. Aprobar
//      anota la venta con la caja de siempre (cobrar): ahí, y solo ahí, baja
//      el stock. Regla del dueño: el stock baja cuando una persona confirma
//      la venta; la web nunca descuenta ni aparta.
//   4. El cliente ve en qué va su pedido en /tienda/pedido/<código>?t=<clave>
//      (la clave va en el enlace que recibe; sin ella no se ve nada).
//
// LOS PRECIOS LOS PONE EL SERVIDOR, nunca el navegador: el carrito solo dice
// qué variante y cuántas. Un carrito tocado a mano no cambia el total.
//
// LOS MÉTODOS DE PAGO y sus datos (número de Pago Móvil, correo de Zelle…)
// se escriben en el panel, en Pedidos web › Métodos de pago, y viven en la
// base (inv_ajustes, clave "pagos_web"). Un método sin datos no sale en la
// web. Si no hay ninguno con datos, la web sigue como antes: pedir por
// WhatsApp. La "tasa del día" (Bs por dólar) es opcional: si está, la web
// dice cuánto es en bolívares.
//
// EL COMPROBANTE se guarda en la misma base D1 (tabla web_comprobantes, en
// base64), sin R2 ni nada que configurar. El navegador achica la foto antes
// de mandarla; el servidor solo acepta JPG, PNG, WEBP o PDF de hasta
// MAXIMO_COMPROBANTE bytes, mirando sus primeros bytes (no el nombre).
//
// ESTE ARCHIVO ES IGUAL EN LAS TRES TIENDAS.

import { asegurarInventario, leerAjuste, guardarAjuste, sedes, cobrar, SinStock } from "./inventario.js";

export const MAXIMO_COMPROBANTE = 1_200_000;
export const PEDIDOS_POR_HORA = 5;
const HORA_MS = 60 * 60 * 1000;

const TABLAS = [
  `CREATE TABLE IF NOT EXISTS web_pedidos (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     codigo TEXT NOT NULL UNIQUE,
     token TEXT NOT NULL,
     creado INTEGER NOT NULL,
     estado TEXT NOT NULL DEFAULT 'revisar',
     cliente TEXT NOT NULL DEFAULT '',
     telefono TEXT NOT NULL DEFAULT '',
     cedula TEXT NOT NULL DEFAULT '',
     entrega TEXT NOT NULL DEFAULT '',
     direccion TEXT NOT NULL DEFAULT '',
     nota TEXT NOT NULL DEFAULT '',
     metodo TEXT NOT NULL DEFAULT '',
     moneda TEXT NOT NULL DEFAULT 'usd',
     referencia TEXT NOT NULL DEFAULT '',
     items TEXT NOT NULL DEFAULT '[]',
     total REAL,
     tasa REAL,
     total_bs REAL,
     origen TEXT NOT NULL DEFAULT '',
     revisado INTEGER,
     quien TEXT NOT NULL DEFAULT '',
     motivo TEXT NOT NULL DEFAULT '',
     venta_id INTEGER
   )`,
  "CREATE INDEX IF NOT EXISTS web_pedidos_estado ON web_pedidos (estado, creado)",
  "CREATE INDEX IF NOT EXISTS web_pedidos_origen ON web_pedidos (origen, creado)",
  `CREATE TABLE IF NOT EXISTS web_comprobantes (
     pedido_id INTEGER PRIMARY KEY,
     tipo TEXT NOT NULL,
     nombre TEXT NOT NULL DEFAULT '',
     tamano INTEGER NOT NULL DEFAULT 0,
     datos TEXT NOT NULL
   )`,
];

let listo = false;

export async function asegurarPedidos(db) {
  await asegurarInventario(db);
  if (listo) return;
  for (const sentencia of TABLAS) await db.prepare(sentencia).run();
  listo = true;
}

export function olvidarQuePedidosEstaListo() {
  listo = false;
}

/* ── Los métodos de pago (se escriben en el panel) ─────────────────── */

// Los que el dueño nombró (12-oct-2026): "Pago móvil, transferencia, Zelle,
// Zinli y otros". Salen vacíos: hasta que no se escriben sus datos, la web
// no los ofrece.
export const METODOS_DE_PARTIDA = [
  { nombre: "Pago Móvil", moneda: "bs" },
  { nombre: "Transferencia", moneda: "bs" },
  { nombre: "Zelle", moneda: "usd" },
  { nombre: "Zinli", moneda: "usd" },
  { nombre: "Binance (USDT)", moneda: "usd" },
];

const MAXIMO_DE_METODOS = 12;

function limpiarMetodo(m) {
  const nombre = String(m?.nombre || "").trim().slice(0, 40);
  const datos = String(m?.datos || "").replace(/\r/g, "").trim().slice(0, 600);
  const moneda = m?.moneda === "bs" ? "bs" : "usd";
  const activo = m?.activo !== false;
  return { nombre, datos, moneda, activo };
}

// { metodos: [{ nombre, datos, moneda: "usd"|"bs", activo }], tasa: n|null,
//   tasaFecha: ms|null, aviso: "" }
export async function leerPagos(db) {
  let guardado = null;
  try {
    guardado = JSON.parse((await leerAjuste(db, "pagos_web")) || "null");
  } catch {
    guardado = null;
  }
  const metodos = Array.isArray(guardado?.metodos) ? guardado.metodos.map(limpiarMetodo).filter((m) => m.nombre) : METODOS_DE_PARTIDA.map((m) => limpiarMetodo({ ...m, datos: "" }));
  const tasa = Number(guardado?.tasa);
  return {
    metodos,
    tasa: Number.isFinite(tasa) && tasa > 0 ? tasa : null,
    tasaFecha: Number(guardado?.tasaFecha) || null,
    aviso: String(guardado?.aviso || "").trim().slice(0, 300),
  };
}

// Lo que se ofrece en la web: activo y con datos.
export function metodosVisibles(pagos) {
  return (pagos?.metodos || []).filter((m) => m.activo && m.datos);
}

// La tienda web pregunta esto en cada página (para enseñar "Pagar aquí" en
// el carrito): se guarda un minuto en memoria para no ir a la base cada vez.
let enMemoria = { hasta: 0, valor: null };
export async function pagosParaLaWeb(db) {
  if (enMemoria.valor && Date.now() < enMemoria.hasta) return enMemoria.valor;
  const valor = await leerPagos(db);
  enMemoria = { hasta: Date.now() + 60_000, valor };
  return valor;
}

export async function guardarPagos(db, { metodos = [], tasa = null, aviso = "" } = {}) {
  const lista = (metodos || []).map(limpiarMetodo).filter((m) => m.nombre).slice(0, MAXIMO_DE_METODOS);
  const vistos = new Set();
  for (const m of lista) {
    const clave = m.nombre.toLowerCase();
    if (vistos.has(clave)) throw new Error(`«${m.nombre}» está dos veces.`);
    vistos.add(clave);
  }
  let laTasa = null;
  if (tasa !== null && tasa !== undefined && String(tasa).trim() !== "") {
    laTasa = Number(String(tasa).trim().replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", "."));
    if (!Number.isFinite(laTasa) || laTasa <= 0 || laTasa > 10_000_000) throw new Error("La tasa tiene que ser un número mayor que cero (Bs por cada dólar).");
    laTasa = Math.round(laTasa * 10000) / 10000;
  }
  const antes = await leerPagos(db);
  const valor = {
    metodos: lista,
    tasa: laTasa,
    tasaFecha: laTasa === null ? null : laTasa === antes.tasa ? antes.tasaFecha || Date.now() : Date.now(),
    aviso: String(aviso || "").trim().slice(0, 300),
  };
  await guardarAjuste(db, "pagos_web", JSON.stringify(valor));
  enMemoria = { hasta: 0, valor: null };
  return valor;
}

/* ── El comprobante ────────────────────────────────────────────────── */

// Por sus primeros bytes, no por el nombre ni por lo que diga el navegador.
export function tipoDelArchivo(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return "application/pdf";
  return "";
}

function aBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function deBase64(texto) {
  const bin = atob(String(texto || ""));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

/* ── Crear un pedido (desde la web) ────────────────────────────────── */

export class PedidoInvalido extends Error {
  constructor(mensaje, estado = 400) {
    super(mensaje);
    this.name = "PedidoInvalido";
    this.estado = estado;
  }
}

// "123x2,456x1" → [{ v: 123, n: 2 }, { v: 456, n: 1 }]
export function leerCarrito(texto) {
  const juntos = new Map();
  for (const trozo of String(texto || "").split(",").slice(0, 40)) {
    const [v, n] = trozo.split("x").map((x) => parseInt(x, 10));
    if (!Number.isInteger(v) || v <= 0) continue;
    const cuantos = Math.max(1, Math.min(20, Number.isInteger(n) ? n : 1));
    juntos.set(v, Math.min(20, (juntos.get(v) || 0) + cuantos));
  }
  return [...juntos.entries()].map(([v, n]) => ({ v, n }));
}

const LETRAS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function aleatorio(n) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => LETRAS[b % LETRAS.length]).join("");
}

function token() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function huella(texto) {
  const datos = new TextEncoder().encode(`pedidos-web:${texto}`);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", datos));
  return [...h.slice(0, 10)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const telefonoLimpio = (t) => String(t || "").replace(/[^\d+]/g, "").slice(0, 20);

// Las líneas del pedido con el precio y el nombre DE LA BASE. Lanza
// PedidoInvalido si algo no se puede pedir (ya no está, no alcanza, sin
// precio).
export async function lineasDelPedido(db, carrito) {
  if (!carrito.length) throw new PedidoInvalido("Tu carrito está vacío.");
  const lineas = [];
  for (const { v, n } of carrito) {
    const f = await db
      .prepare(
        `SELECT v.id, v.opcion, v.color, v.precio, p.id AS producto, p.titulo, p.precio AS precio_base,
                (SELECT COALESCE(SUM(s.cantidad), 0) FROM inv_stock s WHERE s.variante_id = v.id) AS stock,
                (SELECT COUNT(*) FROM inv_stock s WHERE s.variante_id = v.id) AS contada
           FROM inv_variantes v JOIN inv_productos p ON p.id = v.producto_id
          WHERE v.id = ? AND v.oculta = 0 AND p.activo = 1`
      )
      .bind(v)
      .first();
    if (!f) throw new PedidoInvalido("Uno de los productos de tu carrito ya no está. Revisa el carrito.");
    const opcion = String(f.opcion || "").trim();
    const etiqueta = [/^[uú]nica$/i.test(opcion) ? "" : opcion, String(f.color || "").trim()].filter(Boolean).join(" · ");
    const nombre = `${f.titulo}${etiqueta ? ` (${etiqueta})` : ""}`;
    if (Number(f.contada) && Number(f.stock) < n) {
      throw new PedidoInvalido(Number(f.stock) > 0 ? `De ${nombre} solo quedan ${Number(f.stock)}. Ajusta el carrito.` : `${nombre} se agotó. Quítalo del carrito.`);
    }
    const precio = f.precio ?? f.precio_base ?? null;
    if (precio === null || !(Number(precio) >= 0)) throw new PedidoInvalido(`${nombre} no tiene precio en la web: pídelo por WhatsApp.`);
    lineas.push({ v: Number(f.id), producto: Number(f.producto), titulo: String(f.titulo), etiqueta, precio: Number(precio), n });
  }
  return lineas;
}

export const totalDe = (lineas) => Math.round(lineas.reduce((a, l) => a + l.precio * l.n, 0) * 100) / 100;

// datos: { carrito, cliente, telefono, cedula, entrega, direccion, nota,
//          metodo, referencia, archivo: { bytes: Uint8Array, nombre }, ip }
export async function crearPedido(db, datos, { ahora = Date.now() } = {}) {
  await asegurarPedidos(db);
  const cliente = String(datos?.cliente || "").replace(/\s+/g, " ").trim().slice(0, 80);
  const telefono = telefonoLimpio(datos?.telefono);
  if (cliente.length < 3) throw new PedidoInvalido("Escribe tu nombre y apellido.");
  if (telefono.replace(/\D/g, "").length < 7) throw new PedidoInvalido("Escribe tu número de teléfono o WhatsApp.");
  const entrega = datos?.entrega === "envio" ? "envio" : "retiro";
  const direccion = String(datos?.direccion || "").trim().slice(0, 300);
  if (entrega === "envio" && direccion.length < 6) throw new PedidoInvalido("Escribe la dirección para el envío.");

  const pagos = await leerPagos(db);
  const metodo = metodosVisibles(pagos).find((m) => m.nombre === String(datos?.metodo || ""));
  if (!metodo) throw new PedidoInvalido("Elige cómo vas a pagar.");

  const bytes = datos?.archivo?.bytes instanceof Uint8Array ? datos.archivo.bytes : null;
  if (!bytes || !bytes.length) throw new PedidoInvalido("Sube la foto o el PDF del comprobante de pago.");
  if (bytes.length > MAXIMO_COMPROBANTE) throw new PedidoInvalido("El comprobante pesa demasiado. Manda una captura de pantalla o un PDF más liviano.", 413);
  const tipo = tipoDelArchivo(bytes);
  if (!tipo) throw new PedidoInvalido("El comprobante tiene que ser una foto (JPG, PNG) o un PDF.");

  // Freno a los envíos en cadena: unos pocos por hora desde la misma conexión.
  const origen = datos?.ip ? await huella(datos.ip) : "";
  if (origen) {
    const fila = await db.prepare("SELECT COUNT(*) AS n FROM web_pedidos WHERE origen = ? AND creado > ?").bind(origen, ahora - HORA_MS).first();
    if (Number(fila?.n) >= PEDIDOS_POR_HORA) throw new PedidoInvalido("Recibimos varios pedidos seguidos desde tu conexión. Escríbenos por WhatsApp y te ayudamos.", 429);
  }

  const lineas = await lineasDelPedido(db, leerCarrito(datos?.carrito));
  const total = totalDe(lineas);
  const totalBs = metodo.moneda === "bs" && pagos.tasa ? Math.round(total * pagos.tasa * 100) / 100 : null;

  const clave = token();
  for (let intento = 0; intento < 5; intento++) {
    const codigo = `P-${aleatorio(6)}`;
    try {
      await db.batch([
        db
          .prepare(
            `INSERT INTO web_pedidos (codigo, token, creado, estado, cliente, telefono, cedula, entrega, direccion, nota, metodo, moneda, referencia, items, total, tasa, total_bs, origen)
             VALUES (?, ?, ?, 'revisar', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            codigo,
            clave,
            ahora,
            cliente,
            telefono,
            String(datos?.cedula || "").replace(/[^\dVvEeJjGgPp.-]/g, "").slice(0, 20),
            entrega,
            entrega === "envio" ? direccion : "",
            String(datos?.nota || "").trim().slice(0, 300),
            metodo.nombre,
            metodo.moneda,
            String(datos?.referencia || "").trim().slice(0, 60),
            JSON.stringify(lineas),
            total,
            metodo.moneda === "bs" ? pagos.tasa : null,
            totalBs,
            origen
          ),
        db
          .prepare("INSERT INTO web_comprobantes (pedido_id, tipo, nombre, tamano, datos) VALUES ((SELECT id FROM web_pedidos WHERE codigo = ?), ?, ?, ?, ?)")
          .bind(codigo, tipo, String(datos?.archivo?.nombre || "").slice(0, 80), bytes.length, aBase64(bytes)),
      ]);
      return { codigo, token: clave, total, totalBs, metodo: metodo.nombre, lineas };
    } catch (error) {
      if (/UNIQUE/i.test(String(error?.message || error)) && intento < 4) continue;
      throw error;
    }
  }
  throw new Error("No pude guardar el pedido.");
}

/* ── Leer pedidos ──────────────────────────────────────────────────── */

function desdeFila(f) {
  if (!f) return null;
  let items = [];
  try {
    items = JSON.parse(f.items || "[]");
  } catch {
    items = [];
  }
  return { ...f, id: Number(f.id), creado: Number(f.creado), total: f.total === null ? null : Number(f.total), items };
}

// Para la página del cliente: solo con su clave.
export async function pedidoPublico(db, codigo, clave) {
  await asegurarPedidos(db);
  const f = await db.prepare("SELECT * FROM web_pedidos WHERE codigo = ?").bind(String(codigo || "").toUpperCase().slice(0, 12)).first();
  if (!f || !clave || !iguales(String(f.token), String(clave))) return null;
  const p = desdeFila(f);
  delete p.token;
  delete p.origen;
  return p;
}

function iguales(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export const ESTADOS = { revisar: "Por revisar", aprobado: "Aprobado", rechazado: "Rechazado" };

export async function listarPedidos(db, { estado = "revisar", limite = 100 } = {}) {
  await asegurarPedidos(db);
  const filtro = ESTADOS[estado] ? "WHERE p.estado = ?" : "";
  const consulta = db.prepare(
    `SELECT p.*, c.tipo AS comprobante_tipo, c.tamano AS comprobante_tamano
       FROM web_pedidos p LEFT JOIN web_comprobantes c ON c.pedido_id = p.id
       ${filtro} ORDER BY p.creado DESC LIMIT ?`
  );
  const { results } = await (filtro ? consulta.bind(estado, limite) : consulta.bind(limite)).all();
  return (results || []).map(desdeFila);
}

export async function contarPorEstado(db) {
  await asegurarPedidos(db);
  const { results } = await db.prepare("SELECT estado, COUNT(*) AS n FROM web_pedidos GROUP BY estado").all();
  const cuenta = { revisar: 0, aprobado: 0, rechazado: 0 };
  for (const f of results || []) cuenta[f.estado] = Number(f.n);
  return cuenta;
}

export async function verPedido(db, id) {
  await asegurarPedidos(db);
  return desdeFila(await db.prepare("SELECT * FROM web_pedidos WHERE id = ?").bind(Number(id) || 0).first());
}

export async function comprobanteDe(db, pedidoId) {
  await asegurarPedidos(db);
  const f = await db.prepare("SELECT tipo, nombre, datos FROM web_comprobantes WHERE pedido_id = ?").bind(Number(pedidoId) || 0).first();
  if (!f) return null;
  return { tipo: String(f.tipo), nombre: String(f.nombre || ""), bytes: deBase64(f.datos) };
}

/* ── Revisar (desde el panel) ──────────────────────────────────────── */

// Aprobar = el pago llegó. Por defecto anota la venta (baja el stock, sale en
// Ventas con su método de pago). sinVenta: solo lo marca aprobado (cuando la
// venta ya se cobró en la caja, o el stock no cuadra y se arregla a mano).
export async function aprobarPedido(db, id, { quien = "", sinVenta = false } = {}) {
  const p = await verPedido(db, id);
  if (!p) throw new Error("Ese pedido no existe.");
  if (p.estado !== "revisar") throw new Error(`Ese pedido ya está ${ESTADOS[p.estado]?.toLowerCase() || "en revisión por otra persona"}.`);
  // Dos personas aprobando a la vez anotarían la venta dos veces: primero se
  // "toma" el pedido con una marca propia, y solo quien lo tomó cobra.
  const marca = `tomado:${token()}`;
  await db.prepare("UPDATE web_pedidos SET estado = 'aprobando', motivo = ? WHERE id = ? AND estado = 'revisar'").bind(marca, p.id).run();
  const tomado = await db.prepare("SELECT estado, motivo FROM web_pedidos WHERE id = ?").bind(p.id).first();
  if (tomado?.estado !== "aprobando" || tomado?.motivo !== marca) throw new Error("Otra persona ya lo está revisando.");

  let ventaId = null;
  try {
    if (!sinVenta) {
      const sede = (await sedes(db))[0];
      const venta = await cobrar(db, {
        sedeId: sede?.id,
        quien: String(quien || "Tienda web").slice(0, 60),
        metodoPago: p.metodo,
        items: p.items.map((l) => ({ varianteId: l.v, cantidad: l.n })),
        cliente: p.cliente,
        telefono: p.telefono,
        nota: `Pedido web ${p.codigo}${p.referencia ? ` · ref. ${p.referencia}` : ""}`,
      });
      ventaId = venta.ventaId;
    }
  } catch (error) {
    await db.prepare("UPDATE web_pedidos SET estado = 'revisar', motivo = '' WHERE id = ? AND motivo = ?").bind(p.id, marca).run();
    if (error instanceof SinStock || error?.name === "SinStock") {
      throw new SinStock(`${error.message} Corrige el stock en Inventario, o apruébalo sin anotar la venta y cóbralo en la caja.`);
    }
    throw error;
  }
  await db
    .prepare("UPDATE web_pedidos SET estado = 'aprobado', revisado = ?, quien = ?, venta_id = ?, motivo = '' WHERE id = ? AND motivo = ?")
    .bind(Date.now(), String(quien || "").slice(0, 60), ventaId, p.id, marca)
    .run();
  return { ventaId, codigo: p.codigo };
}

export async function rechazarPedido(db, id, { quien = "", motivo = "" } = {}) {
  const p = await verPedido(db, id);
  if (!p) throw new Error("Ese pedido no existe.");
  if (p.estado !== "revisar") throw new Error(`Ese pedido ya está ${ESTADOS[p.estado]?.toLowerCase() || p.estado}.`);
  const porQue = String(motivo || "").trim().slice(0, 200);
  if (!porQue) throw new Error("Escribe por qué se rechaza (el cliente lo ve).");
  await db.prepare("UPDATE web_pedidos SET estado = 'rechazado', revisado = ?, quien = ?, motivo = ? WHERE id = ? AND estado = 'revisar'").bind(Date.now(), String(quien || "").slice(0, 60), porQue, p.id).run();
  return { codigo: p.codigo };
}

/* ── Formatos ──────────────────────────────────────────────────────── */

export function bolivares(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "";
  const [ent, dec] = x.toFixed(2).split(".");
  return `Bs ${ent.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec}`;
}
