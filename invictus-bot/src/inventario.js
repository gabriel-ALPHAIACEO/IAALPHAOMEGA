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
  // Ajustes del inventario (clave → valor). Hoy: de dónde saca el bot lo
  // que ofrece ("inventario" o "hoja"; ver elBotLeeElInventario).
  `CREATE TABLE IF NOT EXISTS inv_ajustes (
    clave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
  )`,
  // IMPORTAR POR TANDAS (8-oct-2026): "Traer ahora" y "Subir un Excel" ya
  // no se hacen en una sola pasada del Worker (ver seguirImportacion). Lo
  // que hay que pasar se guarda aquí y se va pasando de a poco.
  //   estado: preparando → trabajando → listo (o cancelado)
  //   ocupado_hasta: mientras una pasada trabaja, ninguna otra lo toca
  //   (salvo la misma página, ocupado_por, si su pasada anterior murió).
  `CREATE TABLE IF NOT EXISTS inv_trabajos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo          TEXT NOT NULL,
    estado        TEXT NOT NULL,
    total         INTEGER NOT NULL DEFAULT 0,
    hechos        INTEGER NOT NULL DEFAULT 0,
    opciones      TEXT NOT NULL DEFAULT '{}',
    informe       TEXT NOT NULL DEFAULT '{}',
    ocupado_hasta INTEGER NOT NULL DEFAULT 0,
    ocupado_por   TEXT NOT NULL DEFAULT '',
    creado        INTEGER NOT NULL,
    actualizado   INTEGER NOT NULL,
    terminado     INTEGER
  )`,
  // Un paquete por fila: un modelo del catálogo, o un trozo de filas del
  // Excel. clave = origen|origen_id del modelo (para seguirPorCodigo).
  `CREATE TABLE IF NOT EXISTS inv_trabajo_items (
    trabajo_id INTEGER NOT NULL,
    n          INTEGER NOT NULL,
    clave      TEXT NOT NULL DEFAULT '',
    datos      TEXT NOT NULL,
    PRIMARY KEY (trabajo_id, n)
  )`,
  "CREATE INDEX IF NOT EXISTS inv_trabajo_clave ON inv_trabajo_items (trabajo_id, clave)",
  "CREATE INDEX IF NOT EXISTS inv_trabajos_estado ON inv_trabajos (estado, id)",
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
  // VENTAS DE OTRO DÍA (9-oct-2026): "creado" es el día de la venta (el que
  // cuentan Ventas, el balance y lo más vendido); "registrada" es cuándo se
  // anotó de verdad. Vacía en las ventas de siempre.
  ["inv_ventas", "registrada", "INTEGER"],
  // LA FILA ENTERA DE LA HOJA EN SU VARIANTE (EPICCELL, 7-oct-2026): cada
  // capacidad tiene su precio en Bs, su foto y sus columnas (RAM, estado…),
  // y "oculta" es el Activo = NO de la hoja: está en el inventario, pero
  // el bot no la ofrece.
  ["inv_variantes", "precio_local", "REAL"],
  ["inv_variantes", "foto", "TEXT NOT NULL DEFAULT ''"],
  ["inv_variantes", "extras", "TEXT NOT NULL DEFAULT '{}'"],
  ["inv_variantes", "oculta", "INTEGER NOT NULL DEFAULT 0"],
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
      "SELECT 'inv_productos' AS t, name FROM pragma_table_info('inv_productos') UNION ALL SELECT 'inv_ventas', name FROM pragma_table_info('inv_ventas') UNION ALL SELECT 'inv_movimientos', name FROM pragma_table_info('inv_movimientos') UNION ALL SELECT 'inv_variantes', name FROM pragma_table_info('inv_variantes')"
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
// Una variante con su PROPIO precio es otra fila de la hoja (otra
// capacidad): su Cashea y su precio en Bs son los suyos, y si no los tiene
// no hay, en vez de tomar los del modelo (que son los de OTRA capacidad y
// salían como suyos). Sin precio propio, todo es el del modelo.
function preciosDeLaVariante(v, p) {
  const propio = v.precio !== null && v.precio !== undefined;
  return {
    precio: propio ? v.precio : p.precio ?? null,
    precioCashea: v.precio_cashea ?? (propio ? null : p.precio_cashea ?? null),
    precioLocal: v.precio_local ?? (propio ? null : p.precio_local ?? null),
  };
}

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
      return {
        ...v,
        extras: leerJson(v.extras, {}),
        porSede,
        total: Object.values(porSede).reduce((a, b) => a + b, 0),
        // Sin ninguna fila de stock: nunca se contó (la hoja decía "SI").
        contada: porVariante.has(v.id),
        precioCashea: preciosDeLaVariante(v, producto).precioCashea,
      };
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
    precioCashea: preciosDeLaVariante(variante, { precio: variante.precio_producto, precio_cashea: variante.precio_cashea_producto }).precioCashea,
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
        ORDER BY m.creado DESC, m.id DESC LIMIT ?`
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
  const fila = await db
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
         actualizado = excluded.actualizado
       RETURNING id`
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
    .first();
  // RETURNING da el id tanto si lo creó como si lo puso al día: una
  // consulta menos por modelo al importar (8-oct-2026).
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
  // Las nuevas, juntas: una sola llamada a la base (8-oct-2026).
  const nuevas = limpias.filter((url) => !ya.has(url)).map((url) => db.prepare("INSERT INTO inv_fotos (producto_id, url, orden) VALUES (?, ?, ?)").bind(productoId, url, orden++));
  if (nuevas.length) await db.batch(nuevas);
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
export async function guardarVariante(db, productoId, { opcion = "única", color = "", codigo_fabricante = "", precio = null, precio_cashea = null, precio_local = null, foto = "", extras = null, oculta } = {}) {
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
  if (numero(precio) !== null || numero(precio_cashea) !== null || numero(precio_local) !== null) {
    await db
      .prepare("UPDATE inv_variantes SET precio = COALESCE(?, precio), precio_cashea = COALESCE(?, precio_cashea), precio_local = COALESCE(?, precio_local) WHERE id = ?")
      .bind(numero(precio), numero(precio_cashea), numero(precio_local), id)
      .run();
  }
  const laFoto = fotoValida(foto);
  if (laFoto) await db.prepare("UPDATE inv_variantes SET foto = ? WHERE id = ?").bind(laFoto, id).run();
  if (extras && typeof extras === "object" && Object.keys(extras).length) {
    await db.prepare("UPDATE inv_variantes SET extras = ? WHERE id = ?").bind(JSON.stringify(extras), id).run();
  }
  if (oculta !== undefined && oculta !== null) await db.prepare("UPDATE inv_variantes SET oculta = ? WHERE id = ?").bind(oculta ? 1 : 0, id).run();
  return id;
}

// LAS VARIANTES DE UN MODELO, TODAS JUNTAS (8-oct-2026). Hace lo mismo que
// guardarVariante una por una, pero en tres llamadas a la base en vez de
// tres o más por talla: un modelo de 40 a 45 costaba 18 llamadas, y
// Cloudflare corta a las 1000 por pasada. Devuelve los ids, en el orden
// de la lista.
export async function guardarVariantes(db, productoId, lista = []) {
  await asegurarInventario(db);
  const limpias = (lista || []).map((v) => ({
    ...v,
    op: String(v?.opcion || "única").trim().slice(0, 40) || "única",
    col: String(v?.color || "").trim().slice(0, 40),
  }));
  if (!limpias.length) return [];
  await db.batch(limpias.map((v) => db.prepare("INSERT OR IGNORE INTO inv_variantes (producto_id, opcion, color) VALUES (?, ?, ?)").bind(productoId, v.op, v.col)));
  const { results } = await db.prepare("SELECT id, opcion, color, codigo_barras FROM inv_variantes WHERE producto_id = ?").bind(productoId).all();
  const porNombre = new Map((results || []).map((f) => [`${f.opcion}\u0000${f.color}`, f]));
  const cambios = [];
  const ids = [];
  for (const v of limpias) {
    const fila = porNombre.get(`${v.op}\u0000${v.col}`);
    if (!fila) throw new Error(`No pude guardar la variante ${v.op}${v.col ? ` ${v.col}` : ""}.`);
    const id = Number(fila.id);
    ids.push(id);
    if (!fila.codigo_barras) {
      fila.codigo_barras = codigoInterno(id);
      cambios.push(db.prepare("UPDATE inv_variantes SET codigo_barras = ? WHERE id = ?").bind(fila.codigo_barras, id));
    }
    const fab = limpiarCodigo(v.codigo_fabricante);
    if (fab) {
      cambios.push(
        db
          .prepare("UPDATE inv_variantes SET codigo_fabricante = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM inv_variantes WHERE codigo_fabricante = ? AND id <> ?)")
          .bind(fab, id, fab, id)
      );
    }
    if (numero(v.precio) !== null || numero(v.precio_cashea) !== null || numero(v.precio_local) !== null) {
      cambios.push(
        db
          .prepare("UPDATE inv_variantes SET precio = COALESCE(?, precio), precio_cashea = COALESCE(?, precio_cashea), precio_local = COALESCE(?, precio_local) WHERE id = ?")
          .bind(numero(v.precio), numero(v.precio_cashea), numero(v.precio_local), id)
      );
    }
    const laFoto = fotoValida(v.foto);
    if (laFoto) cambios.push(db.prepare("UPDATE inv_variantes SET foto = ? WHERE id = ?").bind(laFoto, id));
    if (v.extras && typeof v.extras === "object" && Object.keys(v.extras).length) {
      cambios.push(db.prepare("UPDATE inv_variantes SET extras = ? WHERE id = ?").bind(JSON.stringify(v.extras), id));
    }
    if (v.oculta !== undefined && v.oculta !== null) cambios.push(db.prepare("UPDATE inv_variantes SET oculta = ? WHERE id = ?").bind(v.oculta ? 1 : 0, id));
  }
  if (cambios.length) await db.batch(cambios);
  return ids;
}

function fotoValida(url) {
  const u = String(url || "").trim();
  return /^https:\/\/\S+$/i.test(u) ? u.slice(0, 500) : "";
}

// EDITAR UNA VARIANTE desde el panel: su precio (vacío = el del modelo), su
// Cashea, su precio en Bs, su foto, su código de fábrica y si el bot la
// ofrece. La opción y el color no se cambian aquí (son su nombre).
export async function editarVariante(db, id, cambios = {}) {
  await asegurarInventario(db);
  const variante = await db.prepare("SELECT id FROM inv_variantes WHERE id = ?").bind(Number(id) || 0).first();
  if (!variante) throw new Error("Esa variante ya no existe.");
  const foto = String(cambios.foto ?? "").trim();
  if (foto && !fotoValida(foto)) throw new Error("La foto tiene que ser un enlace que empiece por https://");
  const fab = limpiarCodigo(cambios.codigo_fabricante);
  if (fab && (await db.prepare("SELECT 1 FROM inv_variantes WHERE codigo_fabricante = ? AND id <> ?").bind(fab, variante.id).first())) {
    throw new Error(`El código ${fab} ya es de otro producto.`);
  }
  await db
    .prepare("UPDATE inv_variantes SET precio = ?, precio_cashea = ?, precio_local = ?, foto = ?, codigo_fabricante = ?, oculta = COALESCE(?, oculta) WHERE id = ?")
    .bind(
      numero(cambios.precio),
      numero(cambios.precio_cashea),
      numero(cambios.precio_local),
      fotoValida(foto),
      fab || null,
      // Sin decir nada (una tienda cuyo bot no lee el inventario), se queda como está.
      cambios.oculta === undefined ? null : cambios.oculta ? 1 : 0,
      variante.id
    )
    .run();
}

/* ── Lo que ofrece el bot ────────────────────────────────────────────── */
//
// EPICCELL (decisión del dueño, 7-oct-2026): la hoja pasa entera al
// inventario y desde entonces MANDA EL INVENTARIO. El bot ofrece cada
// variante de un modelo activo que no esté oculta y que tenga stock. Una
// que nunca se contó (en la hoja decía "SI" o estaba vacía) se ofrece,
// como antes; una contada en 0, no.

export async function leerAjuste(db, clave) {
  try {
    const fila = await db.prepare("SELECT valor FROM inv_ajustes WHERE clave = ?").bind(String(clave)).first();
    return fila ? String(fila.valor) : null;
  } catch {
    // Sin tablas todavía: nadie ajustó nada.
    return null;
  }
}

export async function guardarAjuste(db, clave, valor) {
  await asegurarInventario(db);
  await db.prepare("INSERT INTO inv_ajustes (clave, valor) VALUES (?, ?) ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor").bind(String(clave), String(valor)).run();
}

// Hasta que se trae el catálogo al inventario (y no se dijo otra cosa en
// Importar), el bot sigue con la hoja.
export async function elBotLeeElInventario(db) {
  return (await leerAjuste(db, "catalogo_del_bot")) === "inventario";
}

export async function catalogoParaElBot(db) {
  const { results } = await db
    .prepare(
      `SELECT p.id AS producto_id, p.titulo, p.marca, p.precio AS p_precio, p.precio_local AS p_local, p.precio_cashea AS p_cashea, p.enlace, p.extras AS p_extras,
              v.id, v.opcion, v.color, v.precio, v.precio_local, v.precio_cashea, v.foto, v.extras,
              (SELECT url FROM inv_fotos f WHERE f.producto_id = p.id ORDER BY f.orden, f.id LIMIT 1) AS foto_del_modelo,
              (SELECT COUNT(*) FROM inv_stock s WHERE s.variante_id = v.id) AS contada,
              (SELECT COALESCE(SUM(s.cantidad), 0) FROM inv_stock s WHERE s.variante_id = v.id) AS hay
         FROM inv_variantes v JOIN inv_productos p ON p.id = v.producto_id
        WHERE p.activo = 1 AND v.oculta = 0
        ORDER BY p.id, v.id`
    )
    .all();
  return (results || [])
    .filter((f) => !Number(f.contada) || Number(f.hay) > 0)
    .map((f) => ({
      productoId: Number(f.producto_id),
      varianteId: Number(f.id),
      titulo: f.titulo,
      marca: f.marca || "",
      opcion: f.opcion === "única" ? "" : f.opcion,
      color: f.color || "",
      ...preciosDeLaVariante(f, { precio: f.p_precio, precio_cashea: f.p_cashea, precio_local: f.p_local }),
      foto: f.foto || f.foto_del_modelo || "",
      enlace: f.enlace || "",
      extras: { ...leerJson(f.p_extras, {}), ...leerJson(f.extras, {}) },
      hay: Number(f.contada) ? Number(f.hay) : null,
    }));
}

/* ── Mover stock ─────────────────────────────────────────────────────── */
//
// Todo cambio pasa por aquí. Stock y movimiento van en el MISMO batch, que
// en D1 es una transacción: o se escriben los dos o ninguno. Si el stock
// fuera a quedar en negativo, el CHECK de la tabla lo rechaza y no se
// escribe nada.

// "dia": cuándo cuenta el movimiento en el historial (una venta anotada
// después va en el día en que se hizo); el stock se actualiza "ahora".
function sentenciasDeMovimiento(db, { variante, sede, tipo, delta, quien = "", nota = "", contacto = null, ventaRef = null, ahora, dia = null, precio = null, costo = null }) {
  return [
    db.prepare("INSERT OR IGNORE INTO inv_stock (variante_id, local_id, cantidad, actualizado) VALUES (?, ?, 0, ?)").bind(variante, sede, ahora),
    db.prepare("UPDATE inv_stock SET cantidad = cantidad + ?, actualizado = ? WHERE variante_id = ? AND local_id = ?").bind(delta, ahora, variante, sede),
    db
      .prepare(
        `INSERT INTO inv_movimientos (variante_id, local_id, tipo, delta, queda, quien, nota, contacto_id, venta_id, creado, precio, costo)
         VALUES (?, ?, ?, ?, (SELECT cantidad FROM inv_stock WHERE variante_id = ? AND local_id = ?), ?, ?, ?,
                 (SELECT id FROM inv_ventas WHERE ref = ?), ?, ?, ?)`
      )
      .bind(variante, sede, tipo, delta, variante, sede, String(quien).slice(0, 60), String(nota).slice(0, 300), contacto, ventaRef, dia ?? ahora, precio, costo),
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
  await db.batch(sentenciasDeAjuste(db, { variante, sede, nueva, tipo, quien, nota, ahora: Date.now() }));
  return nueva;
}

// Las tres sentencias de un conteo (también las usa la importación por
// tandas, que junta las de varias tallas en un solo batch).
function sentenciasDeAjuste(db, { variante, sede, nueva, tipo, quien = "", nota = "", ahora }) {
  return [
    db.prepare("INSERT OR IGNORE INTO inv_stock (variante_id, local_id, cantidad, actualizado) VALUES (?, ?, 0, ?)").bind(variante, sede, ahora),
    db
      .prepare(
        `INSERT INTO inv_movimientos (variante_id, local_id, tipo, delta, queda, quien, nota, creado)
         SELECT ?, ?, ?, ? - cantidad, ?, ?, ?, ? FROM inv_stock WHERE variante_id = ? AND local_id = ? AND cantidad <> ?`
      )
      .bind(variante, sede, tipo, nueva, nueva, String(quien).slice(0, 60), String(nota).slice(0, 300), ahora, variante, sede, nueva),
    db.prepare("UPDATE inv_stock SET cantidad = ?, actualizado = ? WHERE variante_id = ? AND local_id = ? AND cantidad <> ?").bind(nueva, ahora, variante, sede, nueva),
  ];
}

async function existe(db, variante, sede) {
  const fila = await db
    .prepare("SELECT (SELECT 1 FROM inv_variantes WHERE id = ?) AS v, (SELECT 1 FROM inv_locales WHERE id = ?) AS s")
    .bind(variante, sede)
    .first();
  return Boolean(fila?.v && fila?.s);
}

// Una cantidad escrita en una casilla: vacía = 0; si no es un entero de 0 a
// 100000, error que dice de cuál talla.
export function leerCantidad(texto, nombre = "") {
  const t = String(texto ?? "").trim();
  const n = t === "" ? 0 : Number(t);
  const de = nombre ? ` de ${nombre}` : "";
  if (!Number.isInteger(n) || n < 0) throw new Error(`La cantidad${de} tiene que ser un número entero, 0 o más.`);
  if (n > 100000) throw new Error(`La cantidad${de} no parece real.`);
  return n;
}

// LAS CANTIDADES QUE SE ESCRIBEN AL CREAR UN PRODUCTO O AÑADIR TALLAS
// (9-oct-2026, pedido del dueño: cambiar los números directo, sin botones).
// Cada fila es { varianteId, cantidad }. Lo que se escribe SE SUMA: en una
// talla nueva es su carga inicial; en una que ya tenía stock, una entrada
// (nunca se pisa lo que había). Una casilla vacía o en 0 deja la talla contada
// en 0: "de esta no hay". Todo en UN batch (3 llamadas por talla como mucho,
// aunque sean 60 tallas).
export async function cargarCantidades(db, { sedeId, quien = "", nota = "Al crearlo", filas = [] } = {}) {
  await asegurarInventario(db);
  const sede = Number(sedeId) || (await sedes(db))[0]?.id || 0;
  if (!(await db.prepare("SELECT 1 FROM inv_locales WHERE id = ?").bind(sede).first())) throw new Error("Esa sede no existe.");
  const limpias = [];
  for (const f of filas || []) {
    const variante = Number(f?.varianteId) || 0;
    if (!variante) continue;
    limpias.push({ variante, n: leerCantidad(f?.cantidad, f?.nombre) });
  }
  if (!limpias.length) return { cargadas: 0, unidades: 0 };
  if (limpias.length > 200) throw new Error("Demasiadas tallas de una vez.");
  const { results } = await db
    .prepare(`SELECT variante_id FROM inv_stock WHERE local_id = ? AND variante_id IN (${limpias.map(() => "?").join(",")})`)
    .bind(sede, ...limpias.map((l) => l.variante))
    .all();
  const conFila = new Set((results || []).map((r) => Number(r.variante_id)));
  const ahora = Date.now();
  const sentencias = [];
  for (const { variante, n } of limpias) {
    if (n > 0) sentencias.push(...sentenciasDeMovimiento(db, { variante, sede, tipo: conFila.has(variante) ? "entrada" : "carga", delta: n, quien, nota, ahora }));
    else sentencias.push(db.prepare("INSERT OR IGNORE INTO inv_stock (variante_id, local_id, cantidad, actualizado) VALUES (?, ?, 0, ?)").bind(variante, sede, ahora));
  }
  await db.batch(sentencias);
  return { cargadas: limpias.filter((l) => l.n > 0).length, unidades: limpias.reduce((a, l) => a + l.n, 0) };
}

// CAMBIAR LA CANTIDAD ESCRIBIÉNDOLA EN LA FICHA (9-oct-2026): la persona ve
// "5", escribe "8" y se guarda sola. Se aplica la DIFERENCIA sobre lo que haya
// en ese momento, no el número a pelo: si una venta cayó mientras tanto, no
// se pierde. Sube = Entrada; baja = Ajuste (nunca una venta: eso es Vendí o la
// caja). Sin "vista", pone el número exacto (como Contar).
export async function cambiarCantidad(db, { varianteId, sedeId, nueva, vista = null, quien = "" } = {}) {
  await asegurarInventario(db);
  const variante = Number(varianteId) || 0;
  const sede = Number(sedeId) || 0;
  const n = Number(String(nueva ?? "").trim() === "" ? NaN : nueva);
  if (!Number.isInteger(n) || n < 0) throw new Error("La cantidad tiene que ser un número entero, 0 o más.");
  if (n > 100000) throw new Error("Esa cantidad no parece real.");
  if (!(await existe(db, variante, sede))) throw new Error("No encuentro ese producto o esa sede.");
  const antes = await db.prepare("SELECT cantidad FROM inv_stock WHERE variante_id = ? AND local_id = ?").bind(variante, sede).first();
  const veia = vista === null || vista === undefined || String(vista).trim() === "" ? null : Number(vista);
  if (veia !== null && (!Number.isInteger(veia) || veia < 0)) throw new Error("No entendí la cantidad anterior.");
  if (veia === null || !antes) {
    // Sin referencia (o nunca contada): el número escrito es el conteo.
    await ajustarStock(db, { varianteId: variante, sedeId: sede, cantidad: n, quien, nota: "Cantidad escrita en la ficha", tipo: antes ? "ajuste" : "carga" });
    return { queda: n, delta: n - (Number(antes?.cantidad) || 0), anterior: Number(antes?.cantidad) || 0 };
  }
  const delta = n - veia;
  if (delta === 0) return { queda: Number(antes.cantidad) || 0, delta: 0, anterior: veia };
  const nota = `Cambiada en la ficha: de ${veia} a ${n}`;
  try {
    await db.batch(sentenciasDeMovimiento(db, { variante, sede, tipo: delta > 0 ? "entrada" : "ajuste", delta, quien, nota, ahora: Date.now() }));
  } catch (error) {
    if (esFaltaDeStock(error)) throw new SinStock(`Mientras tanto se vendió y ese cambio dejaría el stock en negativo. Ahora quedan ${await cantidadActual(db, variante, sede)}.`);
    throw error;
  }
  return { queda: await cantidadActual(db, variante, sede), delta, anterior: veia };
}

/* ── La caja ─────────────────────────────────────────────────────────── */
//
// Cobrar es la confirmación de que el cliente se lleva el producto (regla
// del dueño): aquí, y solo aquí o en "Vendí" del panel, baja el stock.
// La venta entera es UN batch: si un solo producto no alcanza, no se
// descuenta ninguno y la caja dice cuál falta.

// VENTAS DE OTRO DÍA (9-oct-2026, pedido del dueño: "se le olvidó colocar la
// venta del día y quiere colocar todo lo que hizo ayer"). La fecha llega como
// día ("2026-10-08", hora de Venezuela). Devuelve el momento que se le pone a
// la venta, o null si es de hoy (cuenta desde ahora mismo). Un día pasado
// cuenta a mediodía, igual que los gastos. Ni del futuro ni de hace más de
// un año: una fecha así casi seguro es un error de dedo.
export const DIAS_HACIA_ATRAS = 400;
const DESFASE_VENEZUELA_MS = -4 * 60 * 60 * 1000;
const DIA_EN_MS = 24 * 60 * 60 * 1000;

export function momentoDeLaVenta(dia, ahora = Date.now()) {
  const texto = String(dia ?? "").trim();
  if (!texto) return null;
  const inicio = Date.parse(`${texto}T00:00:00Z`);
  // El 31 de febrero se corre solo al 3 de marzo: eso no es una fecha.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto) || !Number.isFinite(inicio) || new Date(inicio).toISOString().slice(0, 10) !== texto) {
    throw new Error("Esa fecha no es válida.");
  }
  const hoy = new Date(ahora + DESFASE_VENEZUELA_MS).toISOString().slice(0, 10);
  if (texto > hoy) throw new Error("Una venta no puede ser de un día que todavía no llega.");
  if (texto === hoy) return null;
  const cuando = inicio - DESFASE_VENEZUELA_MS + 12 * 60 * 60 * 1000;
  if (ahora - cuando > DIAS_HACIA_ATRAS * DIA_EN_MS) throw new Error("Esa fecha es de hace más de un año. Revísala.");
  return cuando;
}

// Además de los productos del inventario, una venta puede llevar "libres"
// ([{ descripcion, precio, cantidad }]: un servicio, algo que no se lleva en
// stock). Fiado: el cliente se lleva el producto y paga después (Fiados en
// el panel). Para fiar hace falta saber a quién.
// tarifa: "cashea" cobra el precio Cashea de cada producto (si lo tiene; si
// no, el normal). Lo decide la caja de la tienda (ver inventario-panel.js).
export async function cobrar(db, { sedeId, quien = "", metodoPago = "", items = [], libres = [], contactoId = null, cliente = "", telefono = "", fiado = false, nota = "", tarifa = "", fecha = "" }) {
  await asegurarInventario(db);
  const sede = Number(sedeId) || (await sedes(db))[0]?.id || 0;
  if (!(await db.prepare("SELECT 1 FROM inv_locales WHERE id = ?").bind(sede).first())) throw new Error("Esa sede no existe.");
  const nombreCliente = String(cliente || "").trim().slice(0, 80);
  const tel = String(telefono || "").replace(/[^\d+]/g, "").slice(0, 20);
  if (fiado && !nombreCliente) throw new Error("Para fiar hace falta el nombre del cliente.");
  const ahora = Date.now();
  // De otro día: cuenta en ese día; "registrada" guarda cuándo se anotó.
  const delDia = momentoDeLaVenta(fecha, ahora);
  const cuando = delDia ?? ahora;
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
    datos.set(v, { precio, costo, nombre: `${variante.titulo}${variante.opcion !== "única" ? ` (${variante.opcion})` : ""}` });
  }
  if (faltan.length) throw new SinStock(`No alcanza en esta sede: ${faltan.join(" · ")}`);

  const ref = crypto.randomUUID();
  const sentencias = [
    db
      .prepare(
        "INSERT INTO inv_ventas (ref, local_id, quien, metodo_pago, total, contacto_id, creado, cliente, telefono, fiado, nota, costo, tarifa, registrada) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        ref,
        sede,
        String(quien).slice(0, 60),
        fiado ? "Fiado" : String(metodoPago).slice(0, 40),
        totalConocido ? Math.round(total * 100) / 100 : null,
        contactoId,
        cuando,
        nombreCliente,
        tel,
        fiado ? 1 : 0,
        String(nota || "").slice(0, 300),
        Math.round(costoTotal * 100) / 100,
        tarifa === "cashea" ? "cashea" : "",
        delDia === null ? null : ahora
      ),
  ];
  const notaDeCaja = (fiado ? "Caja · Fiado" : metodoPago ? `Caja · ${metodoPago}` : "Caja") + (delDia === null ? "" : " · anotada después");
  for (const [v, n] of agrupados) {
    const { precio, costo } = datos.get(v);
    sentencias.push(...sentenciasDeMovimiento(db, { variante: v, sede, tipo: "venta", delta: -n, quien, nota: notaDeCaja, contacto: contactoId, ventaRef: ref, ahora, dia: cuando, precio, costo }));
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
  const contadasDespues = delDia === null ? [] : await contadasDespuesDe(db, { sede, desde: delDia, variantes: [...agrupados.keys()], datos });
  return {
    ventaId: Number(venta.id),
    total: venta.total,
    unidades: [...agrupados.values()].reduce((a, b) => a + b, 0) + lineasLibres.reduce((a, l) => a + l.cantidad, 0),
    fecha: cuando,
    deOtroDia: delDia !== null,
    contadasDespues,
  };
}

// Una venta de otro día baja el stock de hoy. Si alguien contó ese producto
// DESPUÉS de esa fecha, el conteo ya la traía descontada y quedaría
// descontada dos veces: se avisa cuáles para que la persona lo corrija.
async function contadasDespuesDe(db, { sede, desde, variantes, datos }) {
  if (!variantes.length) return [];
  try {
    const { results } = await db
      .prepare(
        `SELECT variante_id, MAX(creado) AS cuando FROM inv_movimientos
          WHERE local_id = ? AND tipo IN ('ajuste', 'carga') AND creado > ? AND variante_id IN (${variantes.map(() => "?").join(",")})
          GROUP BY variante_id`
      )
      .bind(sede, desde, ...variantes)
      .all();
    return (results || []).map((f) => {
      const d = datos.get(Number(f.variante_id));
      return { varianteId: Number(f.variante_id), nombre: d?.nombre || `producto ${f.variante_id}`, cuando: Number(f.cuando) };
    });
  } catch {
    return [];
  }
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
        WHERE ve.creado >= ? ORDER BY ve.creado DESC, ve.id DESC LIMIT 200`
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
//
// importarCatalogo pasa la lista entera de una vez (las pruebas, o una
// lista corta). Desde el panel se pasa POR TANDAS: ver empezarImportacion.

export async function importarCatalogo(db, items, { sedeId = 0, quien = "" } = {}) {
  await asegurarInventario(db);
  const sede = Number(sedeId) || (await sedes(db))[0]?.id;
  const cuenta = { modelos: 0, variantes: 0, conStock: 0, juntadas: 0, errores: [] };
  const enEsteCatalogo = new Set((items || []).map(claveDelModelo));
  const estaEnElCatalogo = async (clave) => enEsteCatalogo.has(clave);
  for (const item of items || []) {
    try {
      sumarAlInforme(cuenta, await importarUnModelo(db, item, { sede, quien, estaEnElCatalogo }));
    } catch (error) {
      if (cuenta.errores.length < 20) cuenta.errores.push(`${item?.titulo || "(sin nombre)"}: ${error.message}`);
    }
  }
  return cuenta;
}

function claveDelModelo(item) {
  return `${item?.origen || "manual"}|${String(item?.origen_id || "").trim()}`;
}

function sumarAlInforme(cuenta, parte) {
  cuenta.modelos += parte.modelos;
  cuenta.variantes += parte.variantes;
  cuenta.conStock += parte.conStock;
  cuenta.juntadas += parte.juntadas;
}

// UN MODELO DEL CATÁLOGO, con sus tallas y su stock inicial. Unas 6 a 8
// llamadas a la base por modelo, tenga las tallas que tenga (antes eran 3
// o más por talla).
async function importarUnModelo(db, item, { sede, quien = "", estaEnElCatalogo }) {
  await seguirPorCodigo(db, item, estaEnElCatalogo);
  const productoId = await guardarProducto(db, item);
  const parte = { modelos: 1, variantes: 0, conStock: 0, juntadas: Number(item.juntadas) || 0 };
  if (item.fotos?.length) await guardarFotos(db, productoId, item.fotos);
  const variantes = item.variantes?.length ? item.variantes : [{ opcion: "única" }];
  const ids = await guardarVariantes(db, productoId, variantes);
  parte.variantes = ids.length;

  // Sin número ("SI", vacío) no se inventa nada: queda sin contar. Un 0 de
  // verdad sí se anota: contada y agotada no es lo mismo que sin contar (el
  // bot ofrece la que no se contó, no la que está en 0).
  const conCantidad = [];
  variantes.forEach((v, i) => {
    const crudo = v.cantidad;
    const n = crudo === null || crudo === undefined || String(crudo).trim() === "" ? NaN : Math.trunc(Number(crudo));
    if (Number.isFinite(n) && n >= 0) conCantidad.push({ id: ids[i], n });
  });
  if (!conCantidad.length) return parte;

  // La carga va solo a la variante que todavía no tenía ningún movimiento.
  const conHistoria = new Set();
  const unicos = [...new Set(conCantidad.map((c) => c.id))];
  for (let i = 0; i < unicos.length; i += 90) {
    const trozo = unicos.slice(i, i + 90);
    const { results } = await db
      .prepare(`SELECT DISTINCT variante_id FROM inv_movimientos WHERE variante_id IN (${trozo.map(() => "?").join(", ")})`)
      .bind(...trozo)
      .all();
    for (const f of results || []) conHistoria.add(Number(f.variante_id));
  }
  const ahora = Date.now();
  const sentencias = [];
  for (const { id, n } of conCantidad) {
    if (conHistoria.has(id)) continue;
    conHistoria.add(id);
    sentencias.push(...sentenciasDeAjuste(db, { variante: id, sede, nueva: n, tipo: "carga", quien, nota: "Importado del catálogo", ahora }));
    if (n > 0) parte.conStock++;
  }
  if (sentencias.length) await db.batch(sentencias);
  return parte;
}

// EL MISMO MODELO CON OTRO ARCHIVO (El Emperador, 7-oct-2026). En Drive
// cada modelo es un archivo, y si le cambian la foto el archivo es otro (otro
// id). Si el modelo trae su código (el COD) y ya hay UNO con ese código que
// no está en este catálogo, es el mismo: se le pone el id nuevo en vez de
// crear otro (y su stock sigue donde estaba).
async function seguirPorCodigo(db, item, estaEnElCatalogo) {
  const codigo = String(item?.extras?.codigo || "").trim();
  const origen = String(item?.origen || "");
  const origenId = String(item?.origen_id || "").trim();
  if (!codigo || !origen || !origenId) return;
  if (await db.prepare("SELECT 1 FROM inv_productos WHERE origen = ? AND origen_id = ?").bind(origen, origenId).first()) return;
  const { results } = await db
    .prepare("SELECT id, origen_id FROM inv_productos WHERE origen = ? AND json_extract(extras, '$.codigo') = ? COLLATE NOCASE LIMIT 2")
    .bind(origen, codigo)
    .all();
  if (results?.length !== 1 || (await estaEnElCatalogo(`${origen}|${results[0].origen_id}`))) return;
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
  const { filas, col, sedeFija } = await prepararCsv(db, texto, { sedeId });
  const contexto = { col, sedeFija, sedePorNombre: await sedesPorNombre(db), quien, aplicar, subidoEn: Date.now() };
  const informe = { filas: 0, nuevos: 0, actualizadas: 0, sinCambio: 0, errores: [] };
  for (const [n, fila] of filas.entries()) await importarFilaCsv(db, fila, n + 2, contexto, informe);
  return informe;
}

// Lee el archivo y comprueba que se entiende (los encabezados). Devuelve
// las filas SIN el encabezado. Un error aquí se le dice al dueño enseguida,
// antes de empezar a pasar nada.
export async function prepararCsv(db, texto, { sedeId = 0 } = {}) {
  await asegurarInventario(db);
  const filas = leerCsv(texto);
  if (filas.length < 2) throw new Error("El archivo llegó vacío o con una sola fila.");
  const col = columnasDelCsv(filas[0]);
  if (col.titulo === -1 && col.codigo === -1) {
    throw new Error("No encuentro ni la columna del producto ni la del código. Ponle encabezados como 'producto' y 'código'.");
  }
  if (col.cantidad === -1) throw new Error("No encuentro la columna de la cantidad. Ponle un encabezado como 'cantidad' o 'stock'.");
  const listaDeSedes = await sedes(db);
  const sedeFija = Number(sedeId) || listaDeSedes[0].id;
  return { filas: filas.slice(1), col, sedeFija };
}

async function sedesPorNombre(db) {
  return Object.fromEntries((await sedes(db)).map((s) => [normal(s.nombre), s.id]));
}

// La nota de lo que pone un Excel (así se reconoce lo que puso).
const NOTA_DEL_EXCEL = "Importado de Excel/CSV";
// Lo que mueve el stock sin contarlo: una venta, su devolución, una entrada.
const MOVIMIENTOS_DE_FLUJO = "('venta', 'devolucion', 'entrada')";

// UNA FILA DEL EXCEL. Suma lo que hizo en informe (y el error, si lo hay).
// subidoEn: cuándo se subió el archivo (ver más abajo).
async function importarFilaCsv(db, fila, numeroDeFila, { col, sedeFija, sedePorNombre, quien = "", aplicar = true, subidoEn = 0 }, informe) {
  const celda = (clave) => (col[clave] === -1 ? "" : String(fila[col[clave]] ?? "").trim());
  informe.filas++;
  try {
    const codigo = limpiarCodigo(celda("codigo"));
    const titulo = celda("titulo");
    const cantidadTexto = celda("cantidad");
    const cantidad = numero(cantidadTexto);
    if (cantidad === null || cantidad < 0) throw new Error(`cantidad "${cantidadTexto}" no es un número`);
    const nombreSede = celda("sede");
    let sede = sedeFija;
    if (nombreSede) {
      sede = sedePorNombre[normal(nombreSede)];
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
          return;
        }
        productoId = await guardarProducto(db, {
          origen: "manual",
          origen_id: codigo || undefined,
          titulo: titulo || codigo,
          marca: celda("marca"),
          precio: celda("precio"),
          costo: celda("costo"),
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
        return;
      }
      const varianteId = await guardarVariante(db, productoId, {
        opcion: celda("opcion") || "única",
        color: celda("color"),
        codigo_fabricante: pareceDeBarras ? codigo : "",
      });
      variante = { id: varianteId };
    }
    if (!aplicar) {
      informe.actualizadas++;
      return;
    }
    const costo = numero(celda("costo"));
    if (costo !== null && productoDeLaFila) await db.prepare("UPDATE inv_productos SET costo = ? WHERE id = ?").bind(costo, productoDeLaFila).run();
    let nueva = Math.trunc(cantidad);
    let yaLaPuso = false;
    if (subidoEn) {
      // POR TANDAS (8-oct-2026): una fila puede pasarse un buen rato después
      // de subir el Excel (con la página cerrada, la pasa el cron). El Excel
      // es el conteo del momento en que se subió: lo que se vendió, se
      // devolvió o entró desde entonces se tiene en cuenta (una venta de la
      // caja NO se deshace). Si alguien la contó a mano después, manda su
      // conteo y la fila no se toca.
      const despues = await db
        .prepare(
          `SELECT COALESCE(SUM(CASE WHEN COALESCE(nota, '') <> ? AND tipo IN ${MOVIMIENTOS_DE_FLUJO} THEN delta ELSE 0 END), 0) AS neto,
                  COALESCE(MAX(CASE WHEN COALESCE(nota, '') <> ? AND tipo NOT IN ${MOVIMIENTOS_DE_FLUJO} THEN 1 ELSE 0 END), 0) AS contada,
                  COALESCE(MAX(CASE WHEN nota = ? THEN 1 ELSE 0 END), 0) AS puesta
             FROM inv_movimientos WHERE variante_id = ? AND local_id = ? AND creado >= ?`
        )
        .bind(NOTA_DEL_EXCEL, NOTA_DEL_EXCEL, NOTA_DEL_EXCEL, variante.id, sede, Number(subidoEn))
        .first();
      if (Number(despues?.contada)) throw new Error("se contó o se cargó a mano después de subir el Excel; se dejó como estaba");
      const neto = Number(despues?.neto) || 0;
      if (neto) {
        nueva = Math.max(0, nueva + neto);
        informe.conVentasEnMedio = (informe.conVentasEnMedio || 0) + 1;
      }
      // Ya la puso este mismo Excel: una tanda que Cloudflare cortó y se
      // repitió, o la misma talla dos veces en el archivo.
      yaLaPuso = Boolean(Number(despues?.puesta));
    }
    const antes = await cantidadActual(db, variante.id, sede);
    const tieneHistoria = await db.prepare("SELECT 1 FROM inv_movimientos WHERE variante_id = ? LIMIT 1").bind(variante.id).first();
    if (antes === nueva && tieneHistoria) {
      if (yaLaPuso) informe.actualizadas++;
      else informe.sinCambio++;
      return;
    }
    await ajustarStock(db, {
      varianteId: variante.id,
      sedeId: sede,
      cantidad: nueva,
      quien,
      nota: NOTA_DEL_EXCEL,
      tipo: tieneHistoria ? "ajuste" : "carga",
    });
    informe.actualizadas++;
  } catch (error) {
    if (esLimiteDeCloudflare(error)) throw error;
    if (informe.errores.length < 30) informe.errores.push(`Fila ${numeroDeFila}: ${error.message}`);
  }
}

/* ── IMPORTAR POR TANDAS (8-oct-2026) ─────────────────────────────────

   QUÉ PASÓ. "Traer ahora" pasaba el catálogo entero en UNA pasada del
   Worker, y Cloudflare corta cada pasada: a las 1000 llamadas a la base
   (en El Emperador, cada modelo con sus tallas costaba 20 o 30, y son
   cientos) y a los 10 ms de CPU en el plan gratis. Lo mismo un Excel
   grande. (Gabriel, 8-oct: "debe traerse así como la indexación".)

   AHORA, como la indexación:
     · "Traer ahora" (o "Subir") lee el catálogo o el archivo UNA vez y
       guarda lo que hay que pasar en inv_trabajo_items. Eso cuesta pocas
       llamadas.
     · Después se pasa POR TANDAS (seguirImportacion): los modelos que
       quepan en cada pasada, contando las llamadas a la base para no
       llegar al tope.
     · Mientras la página del progreso está abierta, ella pide la tanda
       siguiente en cuanto acaba una. Si se cierra, el cron sigue solo
       (avanzarImportacionesSolas, en Invictus y El Emperador cada 15
       minutos), y al volver a abrirla sigue rápido.
     · Pasar dos veces lo mismo no duplica nada (la carga de stock solo
       va a la variante que no tenía movimientos), así que una tanda que
       Cloudflare corte a medias se repite sin miedo.
   ─────────────────────────────────────────────────────────────────── */

// Cloudflare corta a las 1000 llamadas a la base por pasada (también en el
// plan gratis), y pasado el tope YA NO DEJA NI GUARDAR por dónde se iba: por
// eso cada tanda se queda muy por debajo, con sitio para lo demás de la
// pasada (comprobar la sesión, crear las tablas en una pasada nueva). Menos
// llamadas también es menos espera: cada una tarda lo suyo.
export const CONSULTAS_POR_TANDA = 300;
// Filas del Excel en cada paquete (una fila cuesta de 7 a 15 llamadas).
export const FILAS_POR_PAQUETE = 20;
// Lo que puede llegar a costar un paquete, como mucho, para no empezarlo
// si no cabe. Un modelo del catálogo cuesta de 6 a 11, tenga las tallas que
// tenga.
const COSTO_DE_UN_PAQUETE = { catalogo: 20, csv: FILAS_POR_PAQUETE * 16 };
// Mientras una pasada trabaja una importación, las demás esperan. Si esa
// pasada muere (Cloudflare la corta), pasado esto otra sigue donde iba; la
// misma página (su «llave») sigue enseguida.
const OCUPADO_MS = 60 * 1000;
// Las importaciones terminadas se guardan un mes (su informe).
const GUARDAR_MS = 30 * 24 * 60 * 60 * 1000;

export function esLimiteDeCloudflare(error) {
  return /too many (api )?(sub)?requests|exceeded (cpu|resource)|worker exceeded/i.test(String(error?.message || error));
}

// Cuenta las llamadas a la base de una tanda (un batch es UNA llamada).
function conCuenta(db) {
  const cuenta = { usadas: 0 };
  const envolver = (sentencia) => ({
    original: sentencia,
    bind: (...args) => envolver(sentencia.bind(...args)),
    run: (...a) => (cuenta.usadas++, sentencia.run(...a)),
    first: (...a) => (cuenta.usadas++, sentencia.first(...a)),
    all: (...a) => (cuenta.usadas++, sentencia.all(...a)),
    raw: (...a) => (cuenta.usadas++, sentencia.raw(...a)),
  });
  return {
    cuenta,
    db: {
      prepare: (consulta) => envolver(db.prepare(consulta)),
      batch: (lista) => (cuenta.usadas++, db.batch(lista.map((s) => s.original || s))),
      exec: (...a) => (cuenta.usadas++, db.exec(...a)),
    },
  };
}

function informeVacio(tipo) {
  return tipo === "csv"
    ? { filas: 0, nuevos: 0, actualizadas: 0, sinCambio: 0, errores: [] }
    : { modelos: 0, variantes: 0, conStock: 0, juntadas: 0, errores: [] };
}

function resumenDe(t) {
  return {
    id: Number(t.id),
    tipo: t.tipo,
    estado: t.estado,
    hechos: Number(t.hechos) || 0,
    total: Number(t.total) || 0,
    opciones: leerJson(t.opciones, {}),
    informe: { ...informeVacio(t.tipo), ...leerJson(t.informe, {}) },
    creado: Number(t.creado) || 0,
    actualizado: Number(t.actualizado) || 0,
    terminado: t.terminado ? Number(t.terminado) : null,
  };
}

// EMPIEZA una importación. tipo "catalogo": items son los modelos de
// traerCatalogo(). tipo "csv": items son las filas del Excel (sin el
// encabezado), y opciones lleva lo que dijo prepararCsv. Devuelve su id.
// Una del mismo tipo que quedó a medias se reemplaza: "Traer ahora" es
// traer lo de ahora.
export async function empezarImportacion(db, { tipo, items = [], opciones = {} } = {}) {
  if (tipo !== "catalogo" && tipo !== "csv") throw new Error(`No sé importar «${tipo}».`);
  await asegurarInventario(db);
  const ahora = Date.now();
  let paquetes;
  let guardadas;
  if (tipo === "catalogo") {
    paquetes = (items || []).filter(Boolean);
    const sede = Number(opciones.sedeId) || (await sedes(db))[0]?.id;
    if (!(await db.prepare("SELECT 1 FROM inv_locales WHERE id = ?").bind(Number(sede) || 0).first())) throw new Error("Esa sede ya no existe.");
    guardadas = { sede: Number(sede), quien: String(opciones.quien || "").slice(0, 60), botLeeInventario: Boolean(opciones.botLeeInventario) };
  } else {
    const filas = (items || []).map((fila, n) => ({ n, fila }));
    paquetes = [];
    for (let i = 0; i < filas.length; i += FILAS_POR_PAQUETE) paquetes.push({ filas: filas.slice(i, i + FILAS_POR_PAQUETE) });
    guardadas = { col: opciones.col, sedeFija: Number(opciones.sedeFija) || 0, quien: String(opciones.quien || "").slice(0, 60), aplicar: opciones.aplicar !== false, filas: filas.length };
  }
  if (!paquetes.length) throw new Error("No hay nada que importar.");
  if (tipo === "csv" && guardadas.aplicar) {
    // Un Excel de verdad a medias no se corta por subir otro (quedaría la
    // mitad del stock con un conteo y la mitad con otro): primero termina
    // o se detiene. Un «Solo probar» no guarda nada y convive con él.
    const otro = await db
      .prepare("SELECT hechos, opciones FROM inv_trabajos WHERE tipo = 'csv' AND estado IN ('preparando', 'trabajando') AND json_extract(opciones, '$.aplicar') <> 0 ORDER BY id LIMIT 1")
      .first();
    if (otro) {
      const filasDelOtro = Number(leerJson(otro.opciones, {}).filas) || 0;
      throw new Error(`Hay un Excel a medio subir (${Math.min(Number(otro.hechos) * FILAS_POR_PAQUETE, filasDelOtro)} de ${filasDelOtro} filas). Espera a que termine o detenlo antes de subir otro.`);
    }
    // Al terminar se cuentan en la base los productos que creó (ver
    // seguirImportacion): los de después de este.
    guardadas.ultimoProducto = Number((await db.prepare("SELECT COALESCE(MAX(id), 0) AS n FROM inv_productos").first())?.n) || 0;
  }

  await db.batch([
    // «Traer ahora» es traer lo de ahora: reemplaza al catálogo que iba a
    // medias. Un Excel solo reemplaza a otra prueba.
    tipo === "catalogo"
      ? db.prepare("UPDATE inv_trabajos SET estado = 'cancelado', actualizado = ? WHERE tipo = 'catalogo' AND estado IN ('preparando', 'trabajando')").bind(ahora)
      : db.prepare("UPDATE inv_trabajos SET estado = 'cancelado', actualizado = ? WHERE tipo = 'csv' AND estado IN ('preparando', 'trabajando') AND json_extract(opciones, '$.aplicar') = 0").bind(ahora),
    // Lo guardado de las que ya no siguen, salvo si una pasada todavía la
    // está trabajando (lo limpia ella misma al acabar, o la próxima vez).
    db.prepare("DELETE FROM inv_trabajo_items WHERE trabajo_id IN (SELECT id FROM inv_trabajos WHERE estado IN ('cancelado', 'listo') AND ocupado_hasta < ?)").bind(ahora),
    db.prepare("DELETE FROM inv_trabajos WHERE estado IN ('cancelado', 'listo') AND creado < ?").bind(ahora - GUARDAR_MS),
  ]);
  const fila = await db
    .prepare("INSERT INTO inv_trabajos (tipo, estado, total, hechos, opciones, informe, ocupado_hasta, creado, actualizado) VALUES (?, 'preparando', ?, 0, ?, ?, 0, ?, ?) RETURNING id")
    .bind(tipo, paquetes.length, JSON.stringify(guardadas), JSON.stringify(informeVacio(tipo)), ahora, ahora)
    .first();
  const id = Number(fila.id);
  // Lo que hay que pasar, de 100 en 100 por llamada.
  for (let i = 0; i < paquetes.length; i += 100) {
    await db.batch(
      paquetes
        .slice(i, i + 100)
        .map((p, j) => db.prepare("INSERT INTO inv_trabajo_items (trabajo_id, n, clave, datos) VALUES (?, ?, ?, ?)").bind(id, i + j, tipo === "catalogo" ? claveDelModelo(p) : "", JSON.stringify(p)))
    );
  }
  await db.prepare("UPDATE inv_trabajos SET estado = 'trabajando', actualizado = ? WHERE id = ? AND estado = 'preparando'").bind(Date.now(), id).run();
  return id;
}

// UNA TANDA: pasa los paquetes que quepan (como mucho «cuantos», y sin
// pasar de «consultas» llamadas a la base) y guarda por dónde va. Sin id,
// la importación en curso más vieja. Devuelve cómo va (o null si no hay).
// Si otra pasada la está trabajando ahora mismo, no la toca: ocupado.
export async function seguirImportacion(dbReal, { id = 0, cuantos = 25, consultas = CONSULTAS_POR_TANDA, llave = "" } = {}) {
  const { db, cuenta } = conCuenta(dbReal);
  await asegurarInventario(db);
  const trabajo = Number(id)
    ? await db.prepare("SELECT * FROM inv_trabajos WHERE id = ?").bind(Number(id)).first()
    : await db.prepare("SELECT * FROM inv_trabajos WHERE estado = 'trabajando' ORDER BY id LIMIT 1").first();
  if (!trabajo) return null;
  if (trabajo.estado !== "trabajando") return resumenDe(trabajo);
  const ahora = Date.now();
  const quien = String(llave || "").slice(0, 40);
  const tomado = await db
    .prepare("UPDATE inv_trabajos SET ocupado_hasta = ?, ocupado_por = ? WHERE id = ? AND estado = 'trabajando' AND (ocupado_hasta < ? OR (ocupado_por = ? AND ? <> '')) RETURNING hechos, informe")
    .bind(ahora + OCUPADO_MS, quien, trabajo.id, ahora, quien, quien)
    .first();
  if (!tomado) return { ...resumenDe(trabajo), ocupado: true };

  const opciones = leerJson(trabajo.opciones, {});
  let informe = { ...informeVacio(trabajo.tipo), ...leerJson(tomado.informe, {}) };
  const desde = Number(tomado.hechos) || 0;
  let hechos = desde;
  const tope = Math.max(1, Math.min(Math.trunc(Number(cuantos)) || 1, 200));
  const presupuesto = Math.max(40, Math.min(Math.trunc(Number(consultas)) || CONSULTAS_POR_TANDA, 900));
  const costo = COSTO_DE_UN_PAQUETE[trabajo.tipo] || 20;
  let guardado = false;
  try {
    const { results: paquetes } = await db
      .prepare("SELECT n, datos FROM inv_trabajo_items WHERE trabajo_id = ? AND n >= ? ORDER BY n LIMIT ?")
      .bind(trabajo.id, desde, tope)
      .all();
    const estaEnElCatalogo = async (clave) =>
      Boolean(await db.prepare("SELECT 1 FROM inv_trabajo_items WHERE trabajo_id = ? AND clave = ? LIMIT 1").bind(trabajo.id, clave).first());
    let contextoCsv = null;
    let cortado = false;
    for (const paquete of paquetes || []) {
      // Siempre al menos uno por tanda; los demás, si caben.
      if (hechos > desde && cuenta.usadas + costo > presupuesto) break;
      const antes = JSON.stringify(informe);
      const datos = leerJson(paquete.datos, null);
      try {
        if (trabajo.tipo === "catalogo") {
          try {
            sumarAlInforme(informe, await importarUnModelo(db, datos || {}, { sede: opciones.sede, quien: opciones.quien || "", estaEnElCatalogo }));
          } catch (error) {
            if (esLimiteDeCloudflare(error)) throw error;
            if (informe.errores.length < 20) informe.errores.push(`${datos?.titulo || "(sin nombre)"}: ${error.message}`);
          }
        } else {
          contextoCsv ??= { col: opciones.col, sedeFija: opciones.sedeFija, sedePorNombre: await sedesPorNombre(db), quien: opciones.quien || "", aplicar: opciones.aplicar !== false, subidoEn: Number(trabajo.creado) || 0 };
          for (const { n, fila } of datos?.filas || []) await importarFilaCsv(db, fila, n + 2, contextoCsv, informe);
        }
      } catch (error) {
        if (!esLimiteDeCloudflare(error)) throw error;
        // Cloudflare cortó en medio de este paquete: lo hecho antes queda,
        // y este se repite entero en la tanda siguiente.
        informe = JSON.parse(antes);
        cortado = true;
        console.error(`INVENTARIO: tanda cortada por Cloudflare (${error.message}); sigue en la próxima`);
        break;
      }
      hechos = Number(paquete.n) + 1;
    }
    if (!cortado && !(paquetes || []).length && hechos < Number(trabajo.total)) {
      // Lo que faltaba ya no está: la detuvieron (o se volvió a traer)
      // justo ahora. NO es que terminó: no se toca nada más.
      await db.prepare("UPDATE inv_trabajos SET estado = 'cancelado', ocupado_hasta = 0, actualizado = ? WHERE id = ?").bind(Date.now(), trabajo.id).run();
      guardado = true;
      const ahoraEs = await db.prepare("SELECT * FROM inv_trabajos WHERE id = ?").bind(trabajo.id).first();
      return ahoraEs ? resumenDe(ahoraEs) : null;
    }
    const termino = hechos >= Number(trabajo.total);
    if (termino && trabajo.tipo === "csv" && opciones.aplicar !== false && opciones.ultimoProducto !== undefined) {
      // Los productos nuevos, contados en la base: si Cloudflare cortó una
      // tanda y se repitió, la repetición ya los encuentra hechos.
      const fila = await db.prepare("SELECT COUNT(*) AS n FROM inv_productos WHERE id > ? AND origen = 'manual'").bind(Number(opciones.ultimoProducto) || 0).first();
      informe.nuevos = Number(fila?.n) || 0;
    }
    if (termino && trabajo.tipo === "catalogo") {
      // El stock que se cargó en ESTA importación, contado en la base: si
      // Cloudflare cortó una tanda después de cargar y antes de guardar la
      // cuenta, la tanda repetida ya no lo cuenta (la variante tiene
      // movimiento), pero aquí sí sale.
      const fila = await db
        .prepare("SELECT COUNT(DISTINCT variante_id) AS n FROM inv_movimientos WHERE tipo = 'carga' AND nota = 'Importado del catálogo' AND delta > 0 AND creado >= ?")
        .bind(Number(trabajo.creado) || 0)
        .first();
      informe.conStock = Number(fila?.n) || 0;
    }
    // EPICCELL (decisión del dueño): traído el catálogo ENTERO, manda el
    // inventario. Solo la primera vez: si después se volvió a la hoja, eso
    // se respeta. Va en el MISMO batch que lo da por terminado, y solo si
    // nadie la detuvo mientras tanto: o las dos cosas, o ninguna.
    const pasaAlInventario = termino && trabajo.tipo === "catalogo" && opciones.botLeeInventario && informe.modelos > 0 && (await leerAjuste(db, "catalogo_del_bot")) === null;
    if (pasaAlInventario) informe.pasoAlInventario = true;
    const final = Date.now();
    await db.batch([
      ...(pasaAlInventario
        ? [
            db
              .prepare("INSERT INTO inv_ajustes (clave, valor) SELECT 'catalogo_del_bot', 'inventario' WHERE NOT EXISTS (SELECT 1 FROM inv_ajustes WHERE clave = 'catalogo_del_bot') AND EXISTS (SELECT 1 FROM inv_trabajos WHERE id = ? AND estado = 'trabajando')")
              .bind(trabajo.id),
          ]
        : []),
      db
        .prepare("UPDATE inv_trabajos SET hechos = ?, informe = ?, estado = ?, terminado = ?, ocupado_hasta = 0, actualizado = ? WHERE id = ? AND estado = 'trabajando'")
        .bind(hechos, JSON.stringify(informe), termino ? "listo" : "trabajando", termino ? final : null, final, trabajo.id),
      ...(termino ? [db.prepare("DELETE FROM inv_trabajo_items WHERE trabajo_id = ?").bind(trabajo.id)] : []),
      // Si la detuvieron mientras esta tanda trabajaba: se suelta y se
      // limpia lo que quedó guardado.
      db.prepare("UPDATE inv_trabajos SET ocupado_hasta = 0 WHERE id = ? AND estado = 'cancelado'").bind(trabajo.id),
      db.prepare("DELETE FROM inv_trabajo_items WHERE trabajo_id = ? AND EXISTS (SELECT 1 FROM inv_trabajos WHERE id = ? AND estado = 'cancelado')").bind(trabajo.id, trabajo.id),
    ]);
    guardado = true;
    if (termino) {
      // ¿De verdad quedó terminada, o la detuvieron mientras tanto?
      const quedo = await db.prepare("SELECT * FROM inv_trabajos WHERE id = ?").bind(trabajo.id).first();
      if (quedo && quedo.estado !== "listo") return { ...resumenDe(quedo), consultas: cuenta.usadas };
    }
    if (pasaAlInventario) console.log("INVENTARIO: desde ahora el bot ofrece lo del inventario");
    return { ...resumenDe({ ...trabajo, hechos, informe: JSON.stringify(informe), estado: termino ? "listo" : "trabajando", terminado: termino ? final : null, actualizado: final }), consultas: cuenta.usadas };
  } finally {
    // Si algo falló, se suelta enseguida para que la próxima tanda siga.
    if (!guardado) await dbReal.prepare("UPDATE inv_trabajos SET ocupado_hasta = 0 WHERE id = ?").bind(trabajo.id).run().catch(() => {});
  }
}

export async function verImportacion(db, id) {
  try {
    const t = await db.prepare("SELECT * FROM inv_trabajos WHERE id = ?").bind(Number(id) || 0).first();
    return t ? resumenDe(t) : null;
  } catch {
    return null;
  }
}

// Las que van a medias (para el aviso del panel). Sin tablas: ninguna.
export async function importacionesEnCurso(db) {
  try {
    const { results } = await db.prepare("SELECT * FROM inv_trabajos WHERE estado = 'trabajando' ORDER BY id").all();
    return (results || []).map(resumenDe);
  } catch {
    return [];
  }
}

// Detener: lo que ya se pasó se queda. Si una tanda la está trabajando en
// este momento, lo guardado no se borra debajo de ella (lo limpia ella al
// acabar); y esa tanda ya no la puede dar por terminada.
export async function detenerImportacion(db, id) {
  await asegurarInventario(db);
  const ahora = Date.now();
  const n = Number(id) || 0;
  await db.batch([
    db.prepare("UPDATE inv_trabajos SET estado = 'cancelado', actualizado = ? WHERE id = ? AND estado IN ('preparando', 'trabajando')").bind(ahora, n),
    db.prepare("DELETE FROM inv_trabajo_items WHERE trabajo_id = ? AND NOT EXISTS (SELECT 1 FROM inv_trabajos WHERE id = ? AND ocupado_hasta >= ?)").bind(n, n, ahora),
  ]);
}

// EL CRON (Invictus y El Emperador, cada 15 minutos): si hay una
// importación a medias, una tanda. Sin nada pendiente cuesta una consulta, y
// en una tienda que nunca importó nada, ninguna escritura. Con dos a medias
// (un catálogo y un Excel), una vuelta cada una: la que lleva más tiempo
// sin avanzar, y nunca la que una página está trabajando.
// Tandas chicas: la pasada del cron también indexa, y comparte con eso los
// 10 ms de CPU del plan gratis.
export async function avanzarImportacionesSolas(db, { cuantos = 10, consultas = 150 } = {}) {
  if (!db) return null;
  let hay = null;
  try {
    hay = await db.prepare("SELECT id FROM inv_trabajos WHERE estado = 'trabajando' AND ocupado_hasta < ? ORDER BY actualizado, id LIMIT 1").bind(Date.now()).first();
  } catch {
    return null;
  }
  if (!hay) return null;
  try {
    const r = await seguirImportacion(db, { id: hay.id, cuantos, consultas, llave: "cron" });
    if (r && !r.ocupado) console.log(`INVENTARIO: importación por tandas (cron): ${r.hechos} de ${r.total}${r.estado === "listo" ? ", terminada" : ""}`);
    return r;
  } catch (error) {
    console.error("INVENTARIO: la tanda del cron falló:", error.message);
    return null;
  }
}

// Para bajar el inventario a Excel (CSV): una fila por variante y sede, en
// orden de nombre. El archivo entero de una vez.
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
        ORDER BY p.titulo COLLATE NOCASE, p.id, CAST(v.opcion AS REAL), v.opcion, v.id, l.id`
    )
    .all();
  return results || [];
}

// POR PARTES (8-oct-2026): armar el archivo entero de una vez pasaba los
// 10 ms de CPU de Cloudflare en una tienda grande. La página pide las
// partes una tras otra y las junta en UN archivo. Cada parte trae los
// modelos que van DESPUÉS del último de la anterior («tras»: su id y su
// nombre), no «del 100 al 200»: si mientras tanto entra o sale un modelo,
// no se repite ni se pierde ninguna fila de las que ya había.
// Devuelve las filas, cuántos modelos trajo y desde dónde sigue (o null).
export async function parteDelInventario(db, { tras = "", cuantos = 100 } = {}) {
  await asegurarInventario(db);
  const limite = Math.max(1, Math.min(Math.trunc(Number(cuantos)) || 100, 500));
  const texto = String(tras || "");
  const corte = texto.indexOf(":");
  const despues = corte > 0 ? { id: Math.trunc(Number(texto.slice(0, corte))) || 0, titulo: texto.slice(corte + 1) } : null;
  // UNA consulta (una foto coherente). Un modelo sin tallas también sale,
  // con la talla vacía, para saber dónde acabó la parte; no va al Excel.
  const { results } = await db
    .prepare(
      `WITH p AS (
         SELECT id, titulo, marca, gama, precio, costo FROM inv_productos
          WHERE activo = 1 ${despues ? "AND (titulo COLLATE NOCASE > ? OR (titulo COLLATE NOCASE = ? AND id > ?))" : ""}
          ORDER BY titulo COLLATE NOCASE, id LIMIT ?
       )
       SELECT p.id AS producto_id, p.titulo, p.marca, p.gama, v.id AS variante_id, v.opcion, v.color, v.codigo_barras, v.codigo_fabricante,
              COALESCE(v.precio, p.precio) AS precio, p.costo, l.nombre AS sede, COALESCE(s.cantidad, 0) AS cantidad
         FROM p
         LEFT JOIN inv_variantes v ON v.producto_id = p.id
         CROSS JOIN inv_locales l
         LEFT JOIN inv_stock s ON s.variante_id = v.id AND s.local_id = l.id
        ORDER BY p.titulo COLLATE NOCASE, p.id, CAST(v.opcion AS REAL), v.opcion, v.id, l.id`
    )
    .bind(...(despues ? [despues.titulo, despues.titulo, despues.id] : []), limite)
    .all();
  const lista = results || [];
  const modelos = new Set(lista.map((f) => f.producto_id)).size;
  const ultimo = lista[lista.length - 1];
  return {
    filas: lista.filter((f) => f.variante_id !== null && f.variante_id !== undefined),
    modelos,
    siguiente: modelos >= limite && ultimo ? `${ultimo.producto_id}:${ultimo.titulo}` : null,
  };
}

export async function contarModelosActivos(db) {
  await asegurarInventario(db);
  const fila = await db.prepare("SELECT COUNT(*) AS n FROM inv_productos WHERE activo = 1").first();
  return Number(fila?.n) || 0;
}
