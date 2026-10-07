// EL INVENTARIO DE LA TIENDA (fase 1, 7-oct-2026).
//
// QUÉ SE PEDÍA. Saber cuántas quedan de cada modelo, de qué talla y en qué
// sede; que cada cambio deje rastro; códigos de barras automáticos para
// cobrar en caja con un lector o con la cámara del celular. Diseño completo
// y decisiones del dueño en el documento "Diseño del inventario multitienda".
//
// ESTE ARCHIVO ES IGUAL EN LAS TRES TIENDAS (invictus-bot, emperador-bot,
// bot-telefonos-epicell). Lo que cambia por tienda —de dónde sale el
// catálogo— lo pasa index.js al panel como traerCatalogo().
//
// LAS REGLAS QUE NO SE NEGOCIAN (decisiones del dueño, 7-oct-2026):
//
//   · El stock SOLO baja cuando una persona confirma la venta (caja o
//     panel). La IA nunca descuenta ni aparta nada.
//   · No hay apartados.
//   · Cada cambio de stock deja una fila en inv_movimientos: quién, cuándo,
//     cuánto y por qué. El stock nunca cambia "en silencio".
//   · Invictus no maneja tallas: sus modelos tienen una sola variante
//     "única". El mismo código sirve para todas.
//   · Varias sedes desde el inicio: cada movimiento dice en qué sede pasó.
//
// TODO VIVE EN LA D1 DE LA TIENDA (un Worker y una base por tienda, regla
// del 29-sep). Las tablas se crean solas (regla 3 de CLAUDE.md): nadie
// tiene que correr una migración.

/* ── Las tablas ──────────────────────────────────────────────────────── */

const TABLAS_INVENTARIO = [
  `CREATE TABLE IF NOT EXISTS inv_locales (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    creado INTEGER NOT NULL
  )`,
  // Un modelo. origen + origen_id es su llave en la fuente:
  //   'shopify'  el gid del producto (Invictus)
  //   'drive'    el código COD del nombre del archivo, o el id del archivo
  //   'manual'   creado en el panel o importado de la hoja de EPICCELL
  `CREATE TABLE IF NOT EXISTS inv_productos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    origen        TEXT NOT NULL,
    origen_id     TEXT NOT NULL,
    titulo        TEXT NOT NULL,
    marca         TEXT NOT NULL DEFAULT '',
    gama          TEXT NOT NULL DEFAULT '',
    precio        REAL,
    precio_local  REAL,
    precio_cashea REAL,
    costo         REAL,
    enlace        TEXT NOT NULL DEFAULT '',
    extras        TEXT NOT NULL DEFAULT '{}',
    activo        INTEGER NOT NULL DEFAULT 1,
    actualizado   INTEGER NOT NULL,
    UNIQUE (origen, origen_id)
  )`,
  // Una talla (calzado), una capacidad y color (teléfonos), o "única".
  `CREATE TABLE IF NOT EXISTS inv_variantes (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    producto_id       INTEGER NOT NULL REFERENCES inv_productos(id),
    opcion            TEXT NOT NULL,
    color             TEXT NOT NULL DEFAULT '',
    codigo_barras     TEXT,
    codigo_fabricante TEXT,
    precio            REAL,
    precio_cashea     REAL,
    UNIQUE (producto_id, opcion, color)
  )`,
  `CREATE TABLE IF NOT EXISTS inv_fotos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    producto_id INTEGER NOT NULL REFERENCES inv_productos(id),
    url         TEXT NOT NULL,
    orden       INTEGER NOT NULL DEFAULT 0
  )`,
  // El CHECK es la última red: aunque dos cajas cobren el último par a la
  // vez, la segunda falla entera (D1 corre el batch como una transacción).
  `CREATE TABLE IF NOT EXISTS inv_stock (
    variante_id INTEGER NOT NULL REFERENCES inv_variantes(id),
    local_id    INTEGER NOT NULL REFERENCES inv_locales(id),
    cantidad    INTEGER NOT NULL DEFAULT 0 CHECK (cantidad >= 0),
    actualizado INTEGER NOT NULL,
    PRIMARY KEY (variante_id, local_id)
  )`,
  `CREATE TABLE IF NOT EXISTS inv_ventas (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ref         TEXT NOT NULL UNIQUE,
    local_id    INTEGER NOT NULL,
    quien       TEXT NOT NULL DEFAULT '',
    metodo_pago TEXT NOT NULL DEFAULT '',
    total       REAL,
    contacto_id TEXT,
    creado      INTEGER NOT NULL,
    cliente     TEXT NOT NULL DEFAULT '',
    telefono    TEXT NOT NULL DEFAULT '',
    fiado       INTEGER NOT NULL DEFAULT 0,
    anulada     INTEGER NOT NULL DEFAULT 0,
    nota        TEXT NOT NULL DEFAULT '',
    costo       REAL
  )`,
  // Lo que se cobró SIN ser del inventario (un servicio, un arreglo, un
  // producto que no se lleva en stock): descripción y monto.
  `CREATE TABLE IF NOT EXISTS inv_venta_libre (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    venta_id    INTEGER NOT NULL,
    descripcion TEXT NOT NULL,
    cantidad    INTEGER NOT NULL DEFAULT 1,
    precio      REAL NOT NULL
  )`,
  // delta: +12 al llegar un lote, -1 en una venta. queda: el stock después.
  `CREATE TABLE IF NOT EXISTS inv_movimientos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    variante_id INTEGER NOT NULL,
    local_id    INTEGER NOT NULL,
    tipo        TEXT NOT NULL,
    delta       INTEGER NOT NULL,
    queda       INTEGER NOT NULL,
    quien       TEXT NOT NULL DEFAULT '',
    nota        TEXT NOT NULL DEFAULT '',
    contacto_id TEXT,
    venta_id    INTEGER,
    creado      INTEGER NOT NULL,
    precio      REAL,
    costo       REAL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS inv_codigo ON inv_variantes (codigo_barras)",
  "CREATE UNIQUE INDEX IF NOT EXISTS inv_codigo_fab ON inv_variantes (codigo_fabricante)",
  "CREATE INDEX IF NOT EXISTS inv_var_producto ON inv_variantes (producto_id)",
  "CREATE INDEX IF NOT EXISTS inv_mov_variante ON inv_movimientos (variante_id, creado)",
  "CREATE INDEX IF NOT EXISTS inv_mov_creado ON inv_movimientos (creado)",
  "CREATE INDEX IF NOT EXISTS inv_fotos_producto ON inv_fotos (producto_id, orden)",
  "CREATE INDEX IF NOT EXISTS inv_ventas_creado ON inv_ventas (creado)",
  "CREATE INDEX IF NOT EXISTS inv_mov_venta ON inv_movimientos (venta_id)",
  "CREATE INDEX IF NOT EXISTS inv_libre_venta ON inv_venta_libre (venta_id)",
];

// Columnas que llegaron con la gestión del negocio (7-oct-2026, fase 2):
// una base que ya tenía las tablas de la fase 1 las recibe aquí, solas.
const COLUMNAS_NUEVAS = [
  ["inv_productos", "costo", "REAL"],
  ["inv_ventas", "cliente", "TEXT NOT NULL DEFAULT ''"],
  ["inv_ventas", "telefono", "TEXT NOT NULL DEFAULT ''"],
  ["inv_ventas", "fiado", "INTEGER NOT NULL DEFAULT 0"],
  ["inv_ventas", "anulada", "INTEGER NOT NULL DEFAULT 0"],
  ["inv_ventas", "nota", "TEXT NOT NULL DEFAULT ''"],
  ["inv_ventas", "costo", "REAL"],
  ["inv_movimientos", "precio", "REAL"],
  ["inv_movimientos", "costo", "REAL"],
  // "cashea" si la venta se cobró con el precio Cashea (EPICCELL).
  ["inv_ventas", "tarifa", "TEXT NOT NULL DEFAULT ''"],
];

export const TIPOS_DE_MOVIMIENTO = {
  entrada: "Entrada",
  venta: "Venta",
  devolucion: "Devolución",
  ajuste: "Ajuste",
  carga: "Carga inicial",
};

let listo = false;

export async function asegurarInventario(db) {
  if (listo) return;
  for (const sentencia of TABLAS_INVENTARIO) await db.prepare(sentencia).run();
  const { results: hay } = await db
    .prepare(
      "SELECT 'inv_productos' AS t, name FROM pragma_table_info('inv_productos') UNION ALL SELECT 'inv_ventas', name FROM pragma_table_info('inv_ventas') UNION ALL SELECT 'inv_movimientos', name FROM pragma_table_info('inv_movimientos')"
    )
    .all();
  const tiene = new Set((hay || []).map((c) => `${c.t}.${c.name}`));
  for (const [tabla, columna, tipo] of COLUMNAS_NUEVAS) {
    if (!tiene.has(`${tabla}.${columna}`)) await db.prepare(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${tipo}`).run();
  }
  // Toda tienda tiene al menos una sede. Las demás se añaden en el panel.
  await db
    .prepare("INSERT OR IGNORE INTO inv_locales (nombre, creado) SELECT 'Principal', ? WHERE NOT EXISTS (SELECT 1 FROM inv_locales)")
    .bind(Date.now())
    .run();
  listo = true;
}

// Solo para las pruebas: cada base de mentira empieza de cero.
export function olvidarQueEstaListo() {
  listo = false;
}

/* ── Los códigos de barras ───────────────────────────────────────────── */
//
// EAN-13 que empieza por 2: el rango que GS1 reserva para uso interno de
// una tienda, así que nunca choca con el código de un producto de marca.
// Después, el número de la variante con ceros a la izquierda (11 dígitos),
// y al final el dígito de control. Nadie lo escribe y no cambia nunca.

export function digitoDeControl(doce) {
  const d = String(doce);
  let suma = 0;
  for (let i = 0; i < 12; i++) suma += Number(d[i]) * (i % 2 ? 3 : 1);
  return String((10 - (suma % 10)) % 10);
}

export function codigoInterno(varianteId) {
  const doce = `2${String(Math.trunc(varianteId)).padStart(11, "0")}`;
  return doce + digitoDeControl(doce);
}

export function ean13Valido(codigo) {
  const c = String(codigo || "");
  return /^\d{13}$/.test(c) && digitoDeControl(c.slice(0, 12)) === c[12];
}

// Lo que llega del lector puede traer espacios, saltos de línea o (en
// algunos lectores configurados como UPC-A) un dígito menos.
export function limpiarCodigo(texto) {
  return String(texto ?? "").replace(/\s+/g, "").slice(0, 64);
}

// El dibujo del código, en SVG, para las etiquetas. Sin librerías: el
// EAN-13 es una tabla fija de barras.
const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const PARIDAD = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

export function barrasEan13(codigo) {
  const c = String(codigo);
  if (!ean13Valido(c)) return "";
  const paridad = PARIDAD[Number(c[0])];
  let bits = "101";
  for (let i = 1; i <= 6; i++) bits += (paridad[i - 1] === "L" ? L : G)[Number(c[i])];
  bits += "01010";
  for (let i = 7; i <= 12; i++) bits += R[Number(c[i])];
  return bits + "101";
}

export function svgEan13(codigo, { alto = 50 } = {}) {
  const bits = barrasEan13(codigo);
  if (!bits) return "";
  // 95 módulos de barras + 9 de margen a cada lado (zona blanca).
  const ancho = 113;
  let barras = "";
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] !== "1") continue;
    // Las guardas (inicio, centro y final) bajan un poco más, como en
    // cualquier código impreso.
    const guarda = i < 3 || (i >= 45 && i < 50) || i >= 92;
    barras += `<rect x="${9 + i}" y="0" width="1" height="${guarda ? alto + 5 : alto}"/>`;
  }
  const c = String(codigo);
  const texto =
    `<text x="4" y="${alto + 13}" font-size="10">${c[0]}</text>` +
    `<text x="31" y="${alto + 13}" font-size="10" text-anchor="middle" letter-spacing="1.5">${c.slice(1, 7)}</text>` +
    `<text x="78" y="${alto + 13}" font-size="10" text-anchor="middle" letter-spacing="1.5">${c.slice(7)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ancho} ${alto + 16}" class="ean" role="img" aria-label="${c}"><g fill="#000">${barras}</g><g fill="#000" font-family="monospace">${texto}</g></svg>`;
}

/* ── Leer ────────────────────────────────────────────────────────────── */

export async function sedes(db) {
  await asegurarInventario(db);
  const { results } = await db.prepare("SELECT id, nombre FROM inv_locales ORDER BY id").all();
  return results || [];
}

export async function crearSede(db, nombre) {
  await asegurarInventario(db);
  const limpio = String(nombre || "").trim().slice(0, 60);
  if (!limpio) return false;
  await db.prepare("INSERT OR IGNORE INTO inv_locales (nombre, creado) VALUES (?, ?)").bind(limpio, Date.now()).run();
  return true;
}

// Los modelos, con cuántas quedan en total. q busca en el título, la marca
// y los códigos. porReponer: los que tienen 2 o menos (también agotados).
// orden "ventas": primero lo que más se vendió en los últimos 30 días (la
// caja pone eso arriba). precio_min/max: las tallas o capacidades pueden
// tener precio propio (EPICCELL), y la lista dice "desde".
export const UMBRAL_DE_POCOS = 2;

export async function listarProductos(db, { q = "", limite = 200, soloConStock = false, agotados = false, porReponer = false, orden = "nombre" } = {}) {
  await asegurarInventario(db);
  const texto = String(q || "").trim().slice(0, 40);
  const donde = ["p.activo = 1"];
  const args = [];
  if (texto) {
    donde.push(
      "(p.titulo LIKE ? OR p.marca LIKE ? OR p.origen_id = ? OR EXISTS (SELECT 1 FROM inv_variantes v2 WHERE v2.producto_id = p.id AND (v2.codigo_barras = ? OR v2.codigo_fabricante = ?)))"
    );
    args.push(`%${texto}%`, `%${texto}%`, texto, texto, texto);
  }
  const tener = soloConStock ? "HAVING total > 0" : agotados ? "HAVING total = 0" : porReponer ? `HAVING total <= ${UMBRAL_DE_POCOS}` : "";
  const porVentas = orden === "ventas";
  const { results } = await db
    .prepare(
      `SELECT p.id, p.titulo, p.marca, p.gama, p.origen, p.origen_id, p.precio, p.precio_cashea, p.costo,
              COUNT(DISTINCT v.id) AS variantes,
              COALESCE(SUM(s.cantidad), 0) AS total,
              MIN(COALESCE(v.precio, p.precio)) AS precio_min, MAX(COALESCE(v.precio, p.precio)) AS precio_max,
              MIN(COALESCE(v.precio_cashea, p.precio_cashea)) AS cashea_min, MAX(COALESCE(v.precio_cashea, p.precio_cashea)) AS cashea_max,
              (SELECT url FROM inv_fotos f WHERE f.producto_id = p.id ORDER BY orden LIMIT 1) AS foto
              ${porVentas ? `, (SELECT COALESCE(SUM(-m.delta), 0) FROM inv_movimientos m JOIN inv_variantes v3 ON v3.id = m.variante_id WHERE v3.producto_id = p.id AND m.tipo = 'venta' AND m.creado > ?) AS vendidas` : ""}
         FROM inv_productos p
         LEFT JOIN inv_variantes v ON v.producto_id = p.id
         LEFT JOIN inv_stock s ON s.variante_id = v.id
        WHERE ${donde.join(" AND ")}
        GROUP BY p.id ${tener}
        ORDER BY ${porVentas ? "vendidas DESC, " : ""}p.titulo COLLATE NOCASE
        LIMIT ?`
    )
    .bind(...(porVentas ? [Date.now() - 30 * 86400000] : []), ...args, Math.max(1, Math.min(Number(limite) || 200, 1000)))
    .all();
  return results || [];
}

// Lo de arriba de la pantalla del inventario. Solo cuenta lo que sigue en
// el inventario (lo quitado no suma). valor: lo que vale lo que hay, a
// precio de venta; costo: lo que costó (solo de los modelos con costo).
export async function contarProductos(db) {
  await asegurarInventario(db);
  const fila = await db
    .prepare(
      `SELECT COUNT(*) AS modelos,
              COUNT(CASE WHEN t.total <= ${UMBRAL_DE_POCOS} THEN 1 END) AS por_reponer,
              COUNT(CASE WHEN t.total = 0 THEN 1 END) AS agotados,
              COALESCE(SUM(t.variantes), 0) AS variantes,
              COALESCE(SUM(t.total), 0) AS unidades,
              COALESCE(SUM(t.valor), 0) AS valor,
              COALESCE(SUM(t.costo), 0) AS costo,
              COUNT(CASE WHEN t.con_costo THEN 1 END) AS con_costo
         FROM (SELECT p.id,
                      (SELECT COUNT(*) FROM inv_variantes v0 WHERE v0.producto_id = p.id) AS variantes,
                      COALESCE(SUM(s.cantidad), 0) AS total,
                      COALESCE(SUM(s.cantidad * COALESCE(v.precio, p.precio, 0)), 0) AS valor,
                      COALESCE(SUM(s.cantidad * p.costo), 0) AS costo,
                      p.costo IS NOT NULL AS con_costo
                 FROM inv_productos p
                 LEFT JOIN inv_variantes v ON v.producto_id = p.id
                 LEFT JOIN inv_stock s ON s.variante_id = v.id
                WHERE p.activo = 1
                GROUP BY p.id) t`
    )
    .first();
  const n = (k) => Number(fila?.[k]) || 0;
  return { modelos: n("modelos"), variantes: n("variantes"), unidades: n("unidades"), porReponer: n("por_reponer"), agotados: n("agotados"), valor: n("valor"), costo: n("costo"), conCosto: n("con_costo") };
}

// Cada sede con cuántas unidades tiene.
export async function sedesConStock(db) {
  await asegurarInventario(db);
  const { results } = await db
    .prepare(
      `SELECT l.id, l.nombre, l.creado,
              COALESCE(SUM(CASE WHEN p.activo = 1 THEN s.cantidad END), 0) AS unidades,
              COUNT(DISTINCT CASE WHEN p.activo = 1 AND s.cantidad > 0 THEN v.producto_id END) AS modelos
         FROM inv_locales l
         LEFT JOIN inv_stock s ON s.local_id = l.id
         LEFT JOIN inv_variantes v ON v.id = s.variante_id
         LEFT JOIN inv_productos p ON p.id = v.producto_id
        GROUP BY l.id ORDER BY l.id`
    )
    .all();
  return (results || []).map((r) => ({ ...r, unidades: Number(r.unidades) || 0, modelos: Number(r.modelos) || 0 }));
}

// Un modelo entero: sus variantes, el stock de cada una por sede y sus fotos.
export async function verProducto(db, id) {
  await asegurarInventario(db);
  const producto = await db.prepare("SELECT * FROM inv_productos WHERE id = ?").bind(Number(id) || 0).first();
  if (!producto) return null;
  const { results: variantes } = await db
    .prepare("SELECT * FROM inv_variantes WHERE producto_id = ? ORDER BY CAST(opcion AS REAL), opcion, color")
    .bind(producto.id)
    .all();
  const { results: stock } = await db
    .prepare(
      `SELECT s.variante_id, s.local_id, s.cantidad FROM inv_stock s
         JOIN inv_variantes v ON v.id = s.variante_id WHERE v.producto_id = ?`
    )
    .bind(producto.id)
    .all();
  const { results: fotos } = await db
    .prepare("SELECT id, url FROM inv_fotos WHERE producto_id = ? ORDER BY orden, id")
    .bind(producto.id)
    .all();
  const porVariante = new Map();
  for (const s of stock || []) {
    if (!porVariante.has(s.variante_id)) porVariante.set(s.variante_id, {});
    porVariante.get(s.variante_id)[s.local_id] = Number(s.cantidad) || 0;
  }
  return {
    ...producto,
    extras: leerJson(producto.extras, {}),
    fotos: fotos || [],
    variantes: (variantes || []).map((v) => {
      const porSede = porVariante.get(v.id) || {};
      return { ...v, porSede, total: Object.values(porSede).reduce((a, b) => a + b, 0), precioCashea: v.precio_cashea ?? producto.precio_cashea ?? null };
    }),
  };
}

// Lo que lee la caja: por el código interno o por el de fábrica.
export async function buscarPorCodigo(db, codigo) {
  await asegurarInventario(db);
  const c = limpiarCodigo(codigo);
  if (!c) return null;
  const variante = await db
    .prepare(
      `SELECT v.*, p.titulo, p.marca, p.gama, p.precio AS precio_producto, p.precio_cashea AS precio_cashea_producto, p.costo AS costo_producto
         FROM inv_variantes v JOIN inv_productos p ON p.id = v.producto_id
        WHERE v.codigo_barras = ? OR v.codigo_fabricante = ?
        LIMIT 1`
    )
    .bind(c, c)
    .first();
  if (!variante) return null;
  return conStockPorSede(db, variante);
}

export async function verVariante(db, id) {
  await asegurarInventario(db);
  const variante = await db
    .prepare(
      `SELECT v.*, p.titulo, p.marca, p.gama, p.precio AS precio_producto, p.precio_cashea AS precio_cashea_producto, p.costo AS costo_producto
         FROM inv_variantes v JOIN inv_productos p ON p.id = v.producto_id WHERE v.id = ?`
    )
    .bind(Number(id) || 0)
    .first();
  return variante ? conStockPorSede(db, variante) : null;
}

async function conStockPorSede(db, variante) {
  const { results } = await db.prepare("SELECT local_id, cantidad FROM inv_stock WHERE variante_id = ?").bind(variante.id).all();
  const porSede = {};
  for (const s of results || []) porSede[s.local_id] = Number(s.cantidad) || 0;
  return {
    ...variante,
    precioFinal: variante.precio ?? variante.precio_producto ?? null,
    precioCashea: variante.precio_cashea ?? variante.precio_cashea_producto ?? null,
    porSede,
    total: Object.values(porSede).reduce((a, b) => a + b, 0),
  };
}

export async function movimientosRecientes(db, { productoId = 0, limite = 50 } = {}) {
  await asegurarInventario(db);
  const filtro = productoId ? "WHERE v.producto_id = ?" : "";
  const args = productoId ? [Number(productoId)] : [];
  const { results } = await db
    .prepare(
      `SELECT m.*, v.opcion, v.color, p.titulo, p.id AS producto_id, l.nombre AS sede
         FROM inv_movimientos m
         JOIN inv_variantes v ON v.id = m.variante_id
         JOIN inv_productos p ON p.id = v.producto_id
         LEFT JOIN inv_locales l ON l.id = m.local_id
         ${filtro}
        ORDER BY m.id DESC LIMIT ?`
    )
    .bind(...args, Math.max(1, Math.min(Number(limite) || 50, 500)))
    .all();
  return results || [];
}

/* ── Crear modelos y variantes ───────────────────────────────────────── */

function numero(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  // "$150", "150 USD", "1.250,50", "Bs 5.400": se queda el número.
  let t = String(valor).replace(/[^\d.,-]/g, "");
  if (!t) return null;
  if (t.includes(",") && t.includes(".")) {
    t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (t.includes(",")) {
    t = /,\d{1,2}$/.test(t) ? t.replace(",", ".") : t.replace(/,/g, "");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, "");
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
export { numero as leerNumero };

function leerJson(texto, porDefecto) {
  try {
    return JSON.parse(texto);
  } catch {
    return porDefecto;
  }
}

// Crea el modelo, o lo pone al día si ya existe (misma origen + origen_id).
// Solo se pisan los campos que vienen: lo que el dueño corrigió a mano en
// el panel no se borra al volver a traer el catálogo.
export async function guardarProducto(db, datos) {
  await asegurarInventario(db);
  const origen = String(datos.origen || "manual").slice(0, 20);
  const origenId = String(datos.origen_id || datos.origenId || "").trim().slice(0, 200) || `m-${crypto.randomUUID()}`;
  const titulo = String(datos.titulo || "").trim().slice(0, 300);
  if (!titulo) throw new Error("El modelo necesita un nombre.");
  const ahora = Date.now();
  await db
    .prepare(
      `INSERT INTO inv_productos (origen, origen_id, titulo, marca, gama, precio, precio_local, precio_cashea, enlace, extras, activo, actualizado, costo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (origen, origen_id) DO UPDATE SET
         titulo = excluded.titulo,
         marca = CASE WHEN excluded.marca <> '' THEN excluded.marca ELSE inv_productos.marca END,
         gama = CASE WHEN excluded.gama <> '' THEN excluded.gama ELSE inv_productos.gama END,
         precio = COALESCE(excluded.precio, inv_productos.precio),
         precio_local = COALESCE(excluded.precio_local, inv_productos.precio_local),
         precio_cashea = COALESCE(excluded.precio_cashea, inv_productos.precio_cashea),
         costo = COALESCE(excluded.costo, inv_productos.costo),
         enlace = CASE WHEN excluded.enlace <> '' THEN excluded.enlace ELSE inv_productos.enlace END,
         extras = CASE WHEN excluded.extras <> '{}' THEN excluded.extras ELSE inv_productos.extras END,
         -- Quitado del inventario en el panel: volver a importar no lo revive.
         activo = inv_productos.activo,
         actualizado = excluded.actualizado`
    )
    .bind(
      origen,
      origenId,
      titulo,
      String(datos.marca || "").trim().slice(0, 80),
      String(datos.gama || "").trim().slice(0, 20),
      numero(datos.precio),
      numero(datos.precio_local),
      numero(datos.precio_cashea),
      String(datos.enlace || "").trim().slice(0, 500),
      JSON.stringify(datos.extras && typeof datos.extras === "object" ? datos.extras : {}),
      datos.activo === false || datos.activo === 0 ? 0 : 1,
      ahora,
      numero(datos.costo)
    )
    .run();
  const fila = await db.prepare("SELECT id FROM inv_productos WHERE origen = ? AND origen_id = ?").bind(origen, origenId).first();
  return Number(fila.id);
}

export async function editarProducto(db, id, cambios) {
  await asegurarInventario(db);
  await db
    .prepare(
      `UPDATE inv_productos SET titulo = ?, marca = ?, gama = ?, precio = ?, precio_local = ?, precio_cashea = ?, costo = ?, actualizado = ?
        WHERE id = ?`
    )
    .bind(
      String(cambios.titulo || "").trim().slice(0, 300) || "Sin nombre",
      String(cambios.marca || "").trim().slice(0, 80),
      String(cambios.gama || "").trim().slice(0, 20),
      numero(cambios.precio),
      numero(cambios.precio_local),
      numero(cambios.precio_cashea),
      numero(cambios.costo),
      Date.now(),
      Number(id) || 0
    )
    .run();
}

export async function archivarProducto(db, id) {
  await asegurarInventario(db);
  await db.prepare("UPDATE inv_productos SET activo = 0, actualizado = ? WHERE id = ?").bind(Date.now(), Number(id) || 0).run();
}

export async function guardarFotos(db, productoId, urls) {
  const limpias = [...new Set((urls || []).map((u) => String(u || "").trim()).filter((u) => /^https:\/\//i.test(u)))].slice(0, 10);
  if (!limpias.length) return;
  const { results } = await db.prepare("SELECT url FROM inv_fotos WHERE producto_id = ?").bind(productoId).all();
  const ya = new Set((results || []).map((f) => f.url));
  let orden = ya.size;
  for (const url of limpias) {
    if (ya.has(url)) continue;
    await db.prepare("INSERT INTO inv_fotos (producto_id, url, orden) VALUES (?, ?, ?)").bind(productoId, url, orden++).run();
  }
}

// "40-45" → ["40","41",…,"45"]; "38, 39, 40" → ["38","39","40"]; "" → ["única"].
export function leerOpciones(texto) {
  const t = String(texto ?? "").trim();
  if (!t) return ["única"];
  const salida = [];
  for (const trozo of t.split(/[,;/\n]+/)) {
    const p = trozo.trim();
    if (!p) continue;
    const rango = p.match(/^(\d{1,2})\s*(?:-|–|a|al)\s*(\d{1,2})$/i);
    if (rango) {
      const a = Number(rango[1]);
      const b = Number(rango[2]);
      const [desde, hasta] = a <= b ? [a, b] : [b, a];
      if (hasta - desde <= 20) {
        for (let n = desde; n <= hasta; n++) salida.push(String(n));
        continue;
      }
    }
    salida.push(p.slice(0, 40));
  }
  return [...new Set(salida)].slice(0, 60);
}

// Crea la variante si no existe y le pone su código de barras. Devuelve
// su id. El código de fábrica (opcional) se guarda aparte: la caja
// reconoce los dos.
export async function guardarVariante(db, productoId, { opcion = "única", color = "", codigo_fabricante = "", precio = null, precio_cashea = null } = {}) {
  await asegurarInventario(db);
  const op = String(opcion || "única").trim().slice(0, 40) || "única";
  const col = String(color || "").trim().slice(0, 40);
  await db
    .prepare("INSERT OR IGNORE INTO inv_variantes (producto_id, opcion, color) VALUES (?, ?, ?)")
    .bind(productoId, op, col)
    .run();
  const fila = await db
    .prepare("SELECT id, codigo_barras FROM inv_variantes WHERE producto_id = ? AND opcion = ? AND color = ?")
    .bind(productoId, op, col)
    .first();
  const id = Number(fila.id);
  if (!fila.codigo_barras) {
    await db.prepare("UPDATE inv_variantes SET codigo_barras = ? WHERE id = ?").bind(codigoInterno(id), id).run();
  }
  const fab = limpiarCodigo(codigo_fabricante);
  if (fab) {
    // Si otro producto ya tiene ese código de fábrica, no se le quita: se
    // ignora aquí y el panel lo avisa al importar.
    await db
      .prepare("UPDATE inv_variantes SET codigo_fabricante = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM inv_variantes WHERE codigo_fabricante = ? AND id <> ?)")
      .bind(fab, id, fab, id)
      .run();
  }
  if (numero(precio) !== null || numero(precio_cashea) !== null) {
    await db
      .prepare("UPDATE inv_variantes SET precio = COALESCE(?, precio), precio_cashea = COALESCE(?, precio_cashea) WHERE id = ?")
      .bind(numero(precio), numero(precio_cashea), id)
      .run();
  }
  return id;
}

/* ── Mover stock ─────────────────────────────────────────────────────── */
//
// Todo cambio pasa por aquí. Stock y movimiento van en el MISMO batch, que
// en D1 es una transacción: o se escriben los dos o ninguno. Si el stock
// fuera a quedar en negativo, el CHECK de la tabla lo rechaza y no se
// escribe nada.

function sentenciasDeMovimiento(db, { variante, sede, tipo, delta, quien = "", nota = "", contacto = null, ventaRef = null, ahora, precio = null, costo = null }) {
  return [
    db.prepare("INSERT OR IGNORE INTO inv_stock (variante_id, local_id, cantidad, actualizado) VALUES (?, ?, 0, ?)").bind(variante, sede, ahora),
    db.prepare("UPDATE inv_stock SET cantidad = cantidad + ?, actualizado = ? WHERE variante_id = ? AND local_id = ?").bind(delta, ahora, variante, sede),
    db
      .prepare(
        `INSERT INTO inv_movimientos (variante_id, local_id, tipo, delta, queda, quien, nota, contacto_id, venta_id, creado, precio, costo)
         VALUES (?, ?, ?, ?, (SELECT cantidad FROM inv_stock WHERE variante_id = ? AND local_id = ?), ?, ?, ?,
                 (SELECT id FROM inv_ventas WHERE ref = ?), ?, ?, ?)`
      )
      .bind(variante, sede, tipo, delta, variante, sede, String(quien).slice(0, 60), String(nota).slice(0, 300), contacto, ventaRef, ahora, precio, costo),
  ];
}

export class SinStock extends Error {
  constructor(detalle) {
    super(detalle);
    this.name = "SinStock";
  }
}

function esFaltaDeStock(error) {
  return /CHECK constraint failed/i.test(String(error?.message || error));
}

async function cantidadActual(db, variante, sede) {
  const fila = await db.prepare("SELECT cantidad FROM inv_stock WHERE variante_id = ? AND local_id = ?").bind(variante, sede).first();
  return Number(fila?.cantidad) || 0;
}

// tipo: entrada (+), venta (-), devolucion (+). cantidad siempre positiva.
export async function moverStock(db, { varianteId, sedeId, tipo, cantidad, quien = "", nota = "", contactoId = null }) {
  await asegurarInventario(db);
  const signo = { entrada: 1, devolucion: 1, carga: 1, venta: -1 }[tipo];
  if (!signo) throw new Error(`Tipo de movimiento desconocido: ${tipo}`);
  const n = Math.trunc(Number(cantidad));
  if (!Number.isFinite(n) || n <= 0) throw new Error("La cantidad tiene que ser un número mayor que cero.");
  if (n > 100000) throw new Error("Esa cantidad no parece real.");
  const variante = Number(varianteId) || 0;
  const sede = Number(sedeId) || 0;
  if (!(await existe(db, variante, sede))) throw new Error("No encuentro ese producto o esa sede.");
  try {
    await db.batch(sentenciasDeMovimiento(db, { variante, sede, tipo, delta: signo * n, quien, nota, contacto: contactoId, ahora: Date.now() }));
  } catch (error) {
    if (esFaltaDeStock(error)) throw new SinStock(`En esa sede solo quedan ${await cantidadActual(db, variante, sede)}.`);
    throw error;
  }
  return cantidadActual(db, variante, sede);
}

// Pone la cantidad exacta que se contó. El movimiento guarda la diferencia.
export async function ajustarStock(db, { varianteId, sedeId, cantidad, quien = "", nota = "", tipo = "ajuste" }) {
  await asegurarInventario(db);
  const nueva = Math.trunc(Number(cantidad));
  if (!Number.isFinite(nueva) || nueva < 0) throw new Error("La cantidad contada tiene que ser 0 o más.");
  const variante = Number(varianteId) || 0;
  const sede = Number(sedeId) || 0;
  if (!(await existe(db, variante, sede))) throw new Error("No encuentro ese producto o esa sede.");
  // Todo en un batch y el cambio se calcula DENTRO de él: si una venta cae
  // justo mientras se ajusta, no se pierde (antes se leía y después se
  // escribía, y una venta en medio dejaba el conteo una unidad abajo).
  const ahora = Date.now();
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO inv_stock (variante_id, local_id, cantidad, actualizado) VALUES (?, ?, 0, ?)").bind(variante, sede, ahora),
    db
      .prepare(
        `INSERT INTO inv_movimientos (variante_id, local_id, tipo, delta, queda, quien, nota, creado)
         SELECT ?, ?, ?, ? - cantidad, ?, ?, ?, ? FROM inv_stock WHERE variante_id = ? AND local_id = ? AND cantidad <> ?`
      )
      .bind(variante, sede, tipo, nueva, nueva, String(quien).slice(0, 60), String(nota).slice(0, 300), ahora, variante, sede, nueva),
    db.prepare("UPDATE inv_stock SET cantidad = ?, actualizado = ? WHERE variante_id = ? AND local_id = ? AND cantidad <> ?").bind(nueva, ahora, variante, sede, nueva),
  ]);
  return nueva;
}

async function existe(db, variante, sede) {
  const fila = await db
    .prepare("SELECT (SELECT 1 FROM inv_variantes WHERE id = ?) AS v, (SELECT 1 FROM inv_locales WHERE id = ?) AS s")
    .bind(variante, sede)
    .first();
  return Boolean(fila?.v && fila?.s);
}

/* ── La caja ─────────────────────────────────────────────────────────── */
//
// Cobrar es la confirmación de que el cliente se lleva el producto (regla
// del dueño): aquí, y solo aquí o en "Vendí" del panel, baja el stock.
// La venta entera es UN batch: si un solo producto no alcanza, no se
// descuenta ninguno y la caja dice cuál falta.

// Además de los productos del inventario, una venta puede llevar "libres"
// ([{ descripcion, precio, cantidad }]: un servicio, algo que no se lleva en
// stock). Fiado: el cliente se lleva el producto y paga después (Fiados en
// el panel). Para fiar hace falta saber a quién.
// tarifa: "cashea" cobra el precio Cashea de cada producto (si lo tiene; si
// no, el normal). Lo decide la caja de la tienda (ver inventario-panel.js).
export async function cobrar(db, { sedeId, quien = "", metodoPago = "", items = [], libres = [], contactoId = null, cliente = "", telefono = "", fiado = false, nota = "", tarifa = "" }) {
  await asegurarInventario(db);
  const sede = Number(sedeId) || (await sedes(db))[0]?.id || 0;
  if (!(await db.prepare("SELECT 1 FROM inv_locales WHERE id = ?").bind(sede).first())) throw new Error("Esa sede no existe.");
  const nombreCliente = String(cliente || "").trim().slice(0, 80);
  const tel = String(telefono || "").replace(/[^\d+]/g, "").slice(0, 20);
  if (fiado && !nombreCliente) throw new Error("Para fiar hace falta el nombre del cliente.");
  const lineasLibres = [];
  for (const l of libres || []) {
    const descripcion = String(l?.descripcion || "").trim().slice(0, 120);
    const monto = numero(l?.precio);
    const n = Math.trunc(Number(l?.cantidad ?? 1));
    if (!descripcion && monto === null) continue;
    if (!descripcion) throw new Error("Cada cobro sin inventario necesita una descripción.");
    if (monto === null || monto < 0) throw new Error(`Falta el monto de «${descripcion}».`);
    if (!Number.isFinite(n) || n <= 0 || n > 10000) throw new Error(`La cantidad de «${descripcion}» no es válida.`);
    lineasLibres.push({ descripcion, precio: monto, cantidad: n });
  }
  const agrupados = new Map();
  for (const item of items || []) {
    const v = Number(item?.varianteId ?? item?.variante) || 0;
    const n = Math.trunc(Number(item?.cantidad) || 0);
    if (!v || n <= 0) continue;
    agrupados.set(v, (agrupados.get(v) || 0) + n);
  }
  if (!agrupados.size && !lineasLibres.length) throw new Error("La venta está vacía.");
  if (agrupados.size > 200) throw new Error("Demasiados productos en una sola venta.");

  // Primero se mira con calma, para poder decir CUÁL falta. El CHECK de la
  // tabla sigue siendo la red de verdad si dos cajas cobran a la vez.
  let total = lineasLibres.reduce((a, l) => a + l.precio * l.cantidad, 0);
  let totalConocido = true;
  let costoTotal = 0;
  const faltan = [];
  const datos = new Map();
  for (const [v, n] of agrupados) {
    const variante = await verVariante(db, v);
    if (!variante) throw new Error(`El producto ${v} ya no existe.`);
    const hay = variante.porSede[sede] || 0;
    if (hay < n) faltan.push(`${variante.titulo}${variante.opcion !== "única" ? ` (${variante.opcion})` : ""}: hay ${hay}, se cobran ${n}`);
    const precio = tarifa === "cashea" ? variante.precioCashea ?? variante.precioFinal ?? null : variante.precioFinal ?? null;
    if (precio === null) totalConocido = false;
    else total += Number(precio) * n;
    const costo = variante.costo_producto ?? null;
    if (costo !== null) costoTotal += Number(costo) * n;
    datos.set(v, { precio, costo });
  }
  if (faltan.length) throw new SinStock(`No alcanza en esta sede: ${faltan.join(" · ")}`);

  const ref = crypto.randomUUID();
  const ahora = Date.now();
  const sentencias = [
    db
      .prepare(
        "INSERT INTO inv_ventas (ref, local_id, quien, metodo_pago, total, contacto_id, creado, cliente, telefono, fiado, nota, costo, tarifa) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        ref,
        sede,
        String(quien).slice(0, 60),
        fiado ? "Fiado" : String(metodoPago).slice(0, 40),
        totalConocido ? Math.round(total * 100) / 100 : null,
        contactoId,
        ahora,
        nombreCliente,
        tel,
        fiado ? 1 : 0,
        String(nota || "").slice(0, 300),
        Math.round(costoTotal * 100) / 100,
        tarifa === "cashea" ? "cashea" : ""
      ),
  ];
  for (const [v, n] of agrupados) {
    const { precio, costo } = datos.get(v);
    sentencias.push(
      ...sentenciasDeMovimiento(db, { variante: v, sede, tipo: "venta", delta: -n, quien, nota: fiado ? "Caja · Fiado" : metodoPago ? `Caja · ${metodoPago}` : "Caja", contacto: contactoId, ventaRef: ref, ahora, precio, costo })
    );
  }
  for (const l of lineasLibres) {
    sentencias.push(
      db.prepare("INSERT INTO inv_venta_libre (venta_id, descripcion, cantidad, precio) VALUES ((SELECT id FROM inv_ventas WHERE ref = ?), ?, ?, ?)").bind(ref, l.descripcion, l.cantidad, l.precio)
    );
  }
  try {
    await db.batch(sentencias);
  } catch (error) {
    if (esFaltaDeStock(error)) throw new SinStock("Otra caja vendió lo último mientras cobrabas. Revisa y vuelve a cobrar.");
    throw error;
  }
  const venta = await db.prepare("SELECT id, total FROM inv_ventas WHERE ref = ?").bind(ref).first();
  return { ventaId: Number(venta.id), total: venta.total, unidades: [...agrupados.values()].reduce((a, b) => a + b, 0) + lineasLibres.reduce((a, l) => a + l.cantidad, 0) };
}

// ANULAR UNA VENTA (se cobró por error, o el cliente devolvió todo): el
// stock vuelve a la sede donde salió, con un movimiento "Devolución" por
// cada producto, y la venta queda marcada (no se borra). Todo en un batch.
export async function anularVenta(db, ventaId, { quien = "", motivo = "" } = {}) {
  await asegurarInventario(db);
  const venta = await db.prepare("SELECT * FROM inv_ventas WHERE id = ?").bind(Number(ventaId) || 0).first();
  if (!venta) throw new Error("Esa venta no existe.");
  if (venta.anulada) throw new Error("Esa venta ya estaba anulada.");
  const { results: lineas } = await db
    .prepare("SELECT variante_id, local_id, SUM(-delta) AS n FROM inv_movimientos WHERE venta_id = ? AND tipo = 'venta' GROUP BY variante_id, local_id")
    .bind(venta.id)
    .all();
  const ahora = Date.now();
  const nota = `Anulada la venta #${venta.id}${motivo ? `: ${String(motivo).slice(0, 200)}` : ""}`;
  const sentencias = [
    db.prepare("UPDATE inv_ventas SET anulada = 1, nota = CASE WHEN nota = '' THEN ? ELSE nota || ' · ' || ? END WHERE id = ? AND anulada = 0").bind(nota, nota, venta.id),
  ];
  for (const l of lineas || []) {
    if (Number(l.n) > 0) sentencias.push(...sentenciasDeMovimiento(db, { variante: l.variante_id, sede: l.local_id, tipo: "devolucion", delta: Number(l.n), quien, nota, ventaRef: venta.ref, ahora }));
  }
  await db.batch(sentencias);
  return { devueltas: (lineas || []).reduce((a, l) => a + (Number(l.n) || 0), 0) };
}

export async function ventasDelDia(db, desde) {
  await asegurarInventario(db);
  const { results } = await db
    .prepare(
      `SELECT ve.id, ve.creado, ve.quien, ve.metodo_pago, ve.total, l.nombre AS sede,
              (SELECT SUM(-delta) FROM inv_movimientos m WHERE m.venta_id = ve.id) AS unidades
         FROM inv_ventas ve LEFT JOIN inv_locales l ON l.id = ve.local_id
        WHERE ve.creado >= ? ORDER BY ve.id DESC LIMIT 200`
    )
    .bind(desde)
    .all();
  return results || [];
}

/* ── Importar ────────────────────────────────────────────────────────── */
//
// Del catálogo de la tienda (Shopify, Drive o la hoja): crea los modelos
// que faltan y pone al día los que ya están. Cada item:
//   { origen, origen_id, titulo, marca?, gama?, precio?, precio_local?,
//     precio_cashea?, enlace?, extras?, activo?, fotos?: [url],
//     variantes?: [{ opcion, color?, codigo_fabricante?, precio?, precio_cashea?, cantidad? }] }
// Una variante con "cantidad" carga ese stock en la sede indicada, como
// "Carga inicial" (solo si esa variante todavía no tenía stock: volver a
// importar no duplica nada).

export async function importarCatalogo(db, items, { sedeId = 0, quien = "" } = {}) {
  await asegurarInventario(db);
  const sede = Number(sedeId) || (await sedes(db))[0]?.id;
  const cuenta = { modelos: 0, variantes: 0, conStock: 0, juntadas: 0, errores: [] };
  const enEsteCatalogo = new Set((items || []).map((i) => `${i?.origen || "manual"}|${i?.origen_id || ""}`));
  for (const item of items || []) {
    try {
      await seguirPorCodigo(db, item, enEsteCatalogo);
      const productoId = await guardarProducto(db, item);
      cuenta.juntadas += Number(item.juntadas) || 0;
      cuenta.modelos++;
      if (item.fotos?.length) await guardarFotos(db, productoId, item.fotos);
      const variantes = item.variantes?.length ? item.variantes : [{ opcion: "única" }];
      for (const v of variantes) {
        const varianteId = await guardarVariante(db, productoId, v);
        cuenta.variantes++;
        const n = Math.trunc(Number(v.cantidad));
        if (Number.isFinite(n) && n > 0) {
          const yaTiene = await db.prepare("SELECT 1 FROM inv_movimientos WHERE variante_id = ? LIMIT 1").bind(varianteId).first();
          if (!yaTiene) {
            await ajustarStock(db, { varianteId, sedeId: sede, cantidad: n, quien, nota: "Importado del catálogo", tipo: "carga" });
            cuenta.conStock++;
          }
        }
      }
    } catch (error) {
      if (cuenta.errores.length < 20) cuenta.errores.push(`${item?.titulo || "(sin nombre)"}: ${error.message}`);
    }
  }
  return cuenta;
}

// EL MISMO MODELO CON OTRO ARCHIVO (El Emperador, 7-oct-2026). En Drive
// cada modelo es un archivo, y si le cambian la foto el archivo es otro (otro
// id). Si el modelo trae su código (el COD) y ya hay UNO con ese código que
// no está en este catálogo, es el mismo: se le pone el id nuevo en vez de
// crear otro (y su stock sigue donde estaba).
async function seguirPorCodigo(db, item, enEsteCatalogo) {
  const codigo = String(item?.extras?.codigo || "").trim();
  const origen = String(item?.origen || "");
  const origenId = String(item?.origen_id || "").trim();
  if (!codigo || !origen || !origenId) return;
  if (await db.prepare("SELECT 1 FROM inv_productos WHERE origen = ? AND origen_id = ?").bind(origen, origenId).first()) return;
  const { results } = await db
    .prepare("SELECT id, origen_id FROM inv_productos WHERE origen = ? AND json_extract(extras, '$.codigo') = ? COLLATE NOCASE LIMIT 2")
    .bind(origen, codigo)
    .all();
  if (results?.length !== 1 || enEsteCatalogo.has(`${origen}|${results[0].origen_id}`)) return;
  await db.prepare("UPDATE inv_productos SET origen_id = ? WHERE id = ?").bind(origenId, results[0].id).run();
}

// UN EXCEL O CSV DE STOCK (el del sistema viejo de la tienda, o uno hecho a
// mano). Excel se guarda como "CSV" y se sube. Se reconocen los encabezados
// de siempre, sin importar mayúsculas ni tildes:
//
//   código / codigo / cod / sku / barras / ean   → a qué producto va
//   producto / modelo / titulo / nombre / descripción
//   talla / opcion / capacidad / tamaño
//   color
//   cantidad / stock / existencia / unidades
//   precio, marca, sede
//
// La cantidad es la que se CONTÓ: queda tal cual (con un movimiento
// "Carga inicial" o "Ajuste" por la diferencia).

const ENCABEZADOS = {
  codigo: ["codigo", "cod", "sku", "barras", "codigodebarras", "ean", "referencia", "ref", "codigobarras"],
  titulo: ["producto", "modelo", "titulo", "nombre", "descripcion", "articulo"],
  opcion: ["talla", "tallas", "opcion", "capacidad", "tamano", "medida", "size"],
  color: ["color", "colores"],
  cantidad: ["cantidad", "stock", "existencia", "existencias", "unidades", "inventario", "cant"],
  precio: ["precio", "pvp", "precioventa", "preciousd", "valor"],
  costo: ["costo", "preciocosto", "preciodecosto", "costounitario", "preciocompra", "preciodecompra", "compra"],
  marca: ["marca", "fabricante"],
  sede: ["sede", "local", "tienda", "almacen", "sucursal"],
};

function normal(texto) {
  return String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function leerCsv(texto) {
  const limpio = String(texto || "").replace(/^﻿/, "");
  const primera = limpio.split(/\r?\n/, 1)[0] || "";
  // Excel en español guarda con punto y coma.
  const sep = (primera.match(/;/g) || []).length > (primera.match(/,/g) || []).length ? ";" : primera.includes("\t") ? "\t" : ",";
  const filas = [];
  let fila = [];
  let celda = "";
  let comillas = false;
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (comillas) {
      if (c === '"' && limpio[i + 1] === '"') {
        celda += '"';
        i++;
      } else if (c === '"') comillas = false;
      else celda += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) {
      fila.push(celda);
      celda = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && limpio[i + 1] === "\n") i++;
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = "";
    } else celda += c;
  }
  if (celda || fila.length) {
    fila.push(celda);
    filas.push(fila);
  }
  return filas.filter((f) => f.some((c) => String(c).trim()));
}

export function columnasDelCsv(encabezados) {
  const celdas = encabezados.map(normal);
  const indices = {};
  for (const [clave, nombres] of Object.entries(ENCABEZADOS)) {
    let i = celdas.findIndex((c) => nombres.includes(c));
    if (i === -1) i = celdas.findIndex((c) => c && nombres.some((n) => c.startsWith(n)));
    indices[clave] = i;
  }
  // "Precio de compra" es el costo, no el precio de venta.
  if (indices.precio !== -1 && indices.precio === indices.costo) indices.precio = -1;
  return indices;
}

export async function importarCsv(db, texto, { sedeId = 0, quien = "", aplicar = true } = {}) {
  await asegurarInventario(db);
  const filas = leerCsv(texto);
  if (filas.length < 2) throw new Error("El archivo llegó vacío o con una sola fila.");
  const col = columnasDelCsv(filas[0]);
  if (col.titulo === -1 && col.codigo === -1) {
    throw new Error("No encuentro ni la columna del producto ni la del código. Ponle encabezados como 'producto' y 'código'.");
  }
  if (col.cantidad === -1) throw new Error("No encuentro la columna de la cantidad. Ponle un encabezado como 'cantidad' o 'stock'.");

  const listaDeSedes = await sedes(db);
  const sedePorNombre = new Map(listaDeSedes.map((s) => [normal(s.nombre), s.id]));
  const sedeFija = Number(sedeId) || listaDeSedes[0].id;
  const celda = (fila, clave) => (col[clave] === -1 ? "" : String(fila[col[clave]] ?? "").trim());

  const informe = { filas: 0, nuevos: 0, actualizadas: 0, sinCambio: 0, errores: [] };
  for (const [n, fila] of filas.slice(1).entries()) {
    informe.filas++;
    const numeroDeFila = n + 2;
    try {
      const codigo = limpiarCodigo(celda(fila, "codigo"));
      const titulo = celda(fila, "titulo");
      const cantidadTexto = celda(fila, "cantidad");
      const cantidad = numero(cantidadTexto);
      if (cantidad === null || cantidad < 0) throw new Error(`cantidad "${cantidadTexto}" no es un número`);
      const nombreSede = celda(fila, "sede");
      let sede = sedeFija;
      if (nombreSede) {
        sede = sedePorNombre.get(normal(nombreSede));
        if (!sede) throw new Error(`no existe la sede "${nombreSede}" (créala primero en Sedes)`);
      }

      // 1. ¿El código ya es de una variante (el nuestro o el de fábrica)?
      let variante = codigo ? await buscarPorCodigo(db, codigo) : null;
      let productoDeLaFila = variante?.producto_id || 0;
      if (!variante) {
        if (!titulo && !codigo) throw new Error("fila sin producto ni código");
        // 2. Un modelo con ese código de origen (el COD de El Emperador) o
        //    con ese mismo nombre. Si no hay, se crea como manual.
        //    En El Emperador el COD vive en extras.codigo (el modelo se
        //    reconoce en Drive por su archivo): se busca en los dos.
        let producto = codigo
          ? await db
              .prepare("SELECT id FROM inv_productos WHERE activo = 1 AND (origen_id = ? OR json_extract(extras, '$.codigo') = ? COLLATE NOCASE) ORDER BY origen = 'manual' LIMIT 1")
              .bind(codigo, codigo)
              .first()
          : null;
        if (!producto && titulo) {
          producto = await db.prepare("SELECT id FROM inv_productos WHERE titulo = ? COLLATE NOCASE AND activo = 1 LIMIT 1").bind(titulo).first();
        }
        let productoId = producto?.id;
        if (!productoId) {
          if (!aplicar) {
            informe.nuevos++;
            continue;
          }
          productoId = await guardarProducto(db, {
            origen: "manual",
            origen_id: codigo || undefined,
            titulo: titulo || codigo,
            marca: celda(fila, "marca"),
            precio: celda(fila, "precio"),
            costo: celda(fila, "costo"),
          });
          informe.nuevos++;
        }
        productoDeLaFila = productoId;
        // Un código que parece de barras (8 o más dígitos) y no es de los
        // nuestros queda como "de fábrica": así las etiquetas del sistema
        // viejo siguen pasando en caja. Un código corto ("125") es el del
        // modelo, no el de cada talla, y no se guarda como de barras.
        const pareceDeBarras = /^\d{8,14}$/.test(codigo) && !/^2\d{12}$/.test(codigo);
        if (!aplicar) {
          informe.actualizadas++;
          continue;
        }
        const varianteId = await guardarVariante(db, productoId, {
          opcion: celda(fila, "opcion") || "única",
          color: celda(fila, "color"),
          codigo_fabricante: pareceDeBarras ? codigo : "",
        });
        variante = { id: varianteId };
      }
      if (!aplicar) {
        informe.actualizadas++;
        continue;
      }
      const costo = numero(celda(fila, "costo"));
      if (costo !== null && productoDeLaFila) await db.prepare("UPDATE inv_productos SET costo = ? WHERE id = ?").bind(costo, productoDeLaFila).run();
      const antes = await cantidadActual(db, variante.id, sede);
      const tieneHistoria = await db.prepare("SELECT 1 FROM inv_movimientos WHERE variante_id = ? LIMIT 1").bind(variante.id).first();
      if (antes === Math.trunc(cantidad) && tieneHistoria) {
        informe.sinCambio++;
        continue;
      }
      await ajustarStock(db, {
        varianteId: variante.id,
        sedeId: sede,
        cantidad,
        quien,
        nota: "Importado de Excel/CSV",
        tipo: tieneHistoria ? "ajuste" : "carga",
      });
      informe.actualizadas++;
    } catch (error) {
      if (informe.errores.length < 30) informe.errores.push(`Fila ${numeroDeFila}: ${error.message}`);
    }
  }
  return informe;
}

// Para bajar el inventario a Excel (CSV): una fila por variante y sede.
export async function filasParaExportar(db) {
  await asegurarInventario(db);
  const { results } = await db
    .prepare(
      `SELECT p.titulo, p.marca, p.gama, v.opcion, v.color, v.codigo_barras, v.codigo_fabricante,
              COALESCE(v.precio, p.precio) AS precio, p.costo, l.nombre AS sede, COALESCE(s.cantidad, 0) AS cantidad
         FROM inv_variantes v
         JOIN inv_productos p ON p.id = v.producto_id AND p.activo = 1
         CROSS JOIN inv_locales l
         LEFT JOIN inv_stock s ON s.variante_id = v.id AND s.local_id = l.id
        ORDER BY p.titulo COLLATE NOCASE, CAST(v.opcion AS REAL), v.opcion, l.id`
    )
    .all();
  return results || [];
}
