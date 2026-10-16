// CONECTAR EL INVENTARIO CON UN SISTEMA CERRADO (15-oct-2026, pedido del dueño:
// "cómo conectamos todo con sistemas de inventario de código cerrado"; y "hay
// como treinta que no tienen API").
//
// LA IDEA. Casi ningún sistema cerrado ofrece una API, pero casi todos pueden
// sacar un Excel/CSV, y casi todos viven sobre una base de datos que un
// programita local puede leer. Por eso la entrada es UNA SOLA puerta que
// entiende archivos, y todas las vías llegan a ella:
//
//   1. Un CSV o un JSON empujado a  POST /api/sync/inventario  (con clave).
//      Lo empuja el AGENTE PUENTE (conectores/agente-puente.mjs, en la PC o el
//      servidor del cliente: lee la base del sistema o su carpeta de
//      exportación), o Zapier/Make/un script, o quien sea.
//   2. Una dirección (CONECTOR_URL) que el Worker lee solo cada 15 minutos
//      (una carpeta compartida de Drive/OneDrive/Dropbox con el CSV que el
//      sistema exporta, o la API del sistema si la tiene).
//   3. El Excel subido a mano en el panel (ya existía).
//
// Todas pasan por el MISMO camino que el Excel del panel (prepararCsv →
// empezarImportacion → seguirImportacion en inventario.js): la cantidad de
// cada fila es la que se CONTÓ, queda tal cual con su movimiento, lo vendido
// en la caja desde el corte se tiene en cuenta, y repetir no duplica nada.
//
// Y DE VUELTA: GET /api/sync/ventas entrega las ventas de la tienda (CSV o
// JSON) para cargarlas en el sistema cerrado (a mano, con su importador de
// Excel, o con el agente).
//
// REGLAS QUE NO CAMBIAN:
//   · Todo con clave (SYNC_CLAVE, un secreto: nunca en archivos). Sin la
//     clave puesta, esta puerta está cerrada.
//   · La IA nunca descuenta ni aparta. Aquí tampoco: solo se pone el conteo
//     que dice el sistema, y las ventas las confirma una persona.
//   · Nunca sale el costo ni nada de otras tiendas.

import {
  asegurarInventario,
  avanzarImportacionesSolas,
  empezarImportacion,
  importacionesEnCurso,
  prepararCsv,
  seguirImportacion,
  FILAS_POR_PAQUETE,
} from "./inventario.js";
import { recibirLatido, vigilarAgentes, listarAgentes, ordenPendiente, pedirSincronizacion, MAXIMO_DEL_LATIDO } from "./agentes.js";

const MAXIMO_BYTES = 2 * 1024 * 1024;
const MAXIMO_FILAS = 20000;
const FILAS_DE_UNA_VEZ = 40;
// Desde cuántas filas se compara con el conteo anterior (con menos, se pasan todas).
const FILAS_PARA_COMPARAR = 60;
// Cuántas llamadas a la base puede gastar una pasada de estas (Cloudflare corta a 1000).
const CONSULTAS_DE_UNA_PASADA = 800;
const DIA_MS = 24 * 60 * 60 * 1000;

function json(cuerpo, estado = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function texto(cuerpo, tipo = "text/csv; charset=utf-8", nombre = "") {
  return new Response(cuerpo, {
    headers: {
      "content-type": tipo,
      "cache-control": "no-store",
      ...(nombre ? { "content-disposition": `attachment; filename="${nombre}"` } : {}),
    },
  });
}

/* ── La clave ────────────────────────────────────────────────────────── */

async function huella(valor) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(valor))));
}

// Comparación sin atajos: se comparan las huellas, byte a byte, sin cortar.
export async function claveCorrecta(request, env) {
  const esperada = String(env.SYNC_CLAVE || "");
  if (!esperada) return false;
  const cabecera = request.headers.get("authorization") || "";
  const dada = /^bearer\s+/i.test(cabecera) ? cabecera.replace(/^bearer\s+/i, "").trim() : request.headers.get("x-clave") || "";
  if (!dada) return false;
  const [a, b] = await Promise.all([huella(esperada), huella(dada)]);
  let distinto = 0;
  for (let i = 0; i < a.length; i++) distinto |= a[i] ^ b[i];
  return distinto === 0;
}

/* ── De objetos (JSON) a las filas de siempre (CSV) ──────────────────── */

function textoDeCelda(valor) {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "object") return "";
  return String(valor);
}

// Cada elemento puede traer sus tallas/variantes dentro ("variantes": [...]):
// se aplana a una fila por variante, con lo del modelo repetido.
export function aplanar(cuerpo) {
  let lista = cuerpo;
  if (!Array.isArray(lista)) {
    lista = cuerpo?.productos ?? cuerpo?.items ?? cuerpo?.inventario ?? cuerpo?.filas ?? cuerpo?.data ?? null;
  }
  if (!Array.isArray(lista)) throw new Error("Mándame una lista de productos: un arreglo, o un objeto con «productos» (o «items»).");
  const filas = [];
  for (const elemento of lista) {
    if (!elemento || typeof elemento !== "object") continue;
    const { variantes, tallas, ...padre } = elemento;
    const hijas = Array.isArray(variantes) ? variantes : Array.isArray(tallas) ? tallas : null;
    if (hijas?.length) for (const v of hijas) filas.push({ ...padre, ...(v && typeof v === "object" ? v : {}) });
    else filas.push(padre);
    if (filas.length > MAXIMO_FILAS) throw new Error(`Son demasiadas filas de una vez (más de ${MAXIMO_FILAS}). Mándalo en partes.`);
  }
  return filas;
}

function celdaCsv(valor) {
  const t = textoDeCelda(valor);
  return /[",\n\r;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export function aCsv(filas, fijos = null) {
  const encabezados = fijos ? [...fijos] : [];
  if (!fijos) for (const f of filas) for (const k of Object.keys(f)) if (!encabezados.includes(k) && typeof f[k] !== "object") encabezados.push(k);
  const lineas = [encabezados.map(celdaCsv).join(",")];
  for (const f of filas) lineas.push(encabezados.map((k) => celdaCsv(f[k])).join(","));
  return lineas.join("\n");
}

/* ── Solo lo que cambió ──────────────────────────────────────────────── */
//
// Un catálogo de miles de filas no se puede volver a pasar entero cada 15
// minutos (cada fila cuesta unas 12 llamadas a la base y cada pasada del Worker
// tiene tope). Por eso, de cada fila se guarda una huella, y en el conteo
// siguiente solo se pasa lo que cambió (una fila nueva, o con otra cantidad,
// precio, etc.). Una huella solo vale si el conteo que la guardó TERMINÓ (si
// se detuvo o se perdió, esas filas se vuelven a pasar), y cuando un conteo
// viejo se borra de la base (inventario.js, GUARDAR_MS), sus filas se pasan
// otra vez: así, de paso, el sistema y la tienda se reconcilian cada tanto.

const TABLA_DE_HUELLAS = `CREATE TABLE IF NOT EXISTS sync_filas (
  clave      TEXT PRIMARY KEY,
  huella     TEXT NOT NULL,
  trabajo_id INTEGER NOT NULL,
  creado     INTEGER NOT NULL
)`;
let tablaLista = false;
async function asegurarHuellas(db) {
  if (tablaLista) return;
  await db.prepare(TABLA_DE_HUELLAS).run();
  tablaLista = true;
}

// FNV-1a de 32 bits con dos semillas: corto, rápido, sin pedirle nada a crypto.
function huellaDe(texto) {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x85ebca6b) >>> 0;
  }
  return `${a.toString(36)}${b.toString(36)}${texto.length.toString(36)}`;
}

const normal = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// Devuelve { cambiadas, iguales, huellas: [{clave, huella}] }.
export async function soloLasCambiadas(db, filas, col, origen = "") {
  await asegurarHuellas(db);
  const celda = (fila, clave) => (col[clave] === -1 || col[clave] === undefined ? "" : String(fila[col[clave]] ?? ""));
  const huellas = filas.map((fila) => ({
    clave: `${normal(origen)}|${huellaDe([celda(fila, "codigo"), celda(fila, "titulo"), celda(fila, "opcion"), celda(fila, "color"), celda(fila, "sede")].map(normal).join("\u0001"))}`,
    huella: huellaDe(fila.map((c) => String(c ?? "").trim()).join("\u0001")),
  }));
  const sabidas = new Map();
  for (let i = 0; i < huellas.length; i += 90) {
    const trozo = huellas.slice(i, i + 90);
    const { results } = await db
      .prepare(`SELECT s.clave, s.huella FROM sync_filas s JOIN inv_trabajos t ON t.id = s.trabajo_id WHERE t.estado = 'listo' AND s.clave IN (${trozo.map(() => "?").join(", ")})`)
      .bind(...trozo.map((h) => h.clave))
      .all();
    for (const f of results || []) sabidas.set(f.clave, f.huella);
  }
  const cambiadas = [];
  const paraGuardar = [];
  filas.forEach((fila, n) => {
    if (sabidas.get(huellas[n].clave) === huellas[n].huella) return;
    cambiadas.push(fila);
    paraGuardar.push(huellas[n]);
  });
  return { cambiadas, iguales: filas.length - cambiadas.length, huellas: paraGuardar };
}

async function guardarHuellas(db, huellas, trabajoId) {
  const ahora = Date.now();
  for (let i = 0; i < huellas.length; i += 100) {
    await db.batch(
      huellas
        .slice(i, i + 100)
        .map((h) => db.prepare("INSERT OR REPLACE INTO sync_filas (clave, huella, trabajo_id, creado) VALUES (?, ?, ?, ?)").bind(h.clave, h.huella, trabajoId, ahora))
    );
  }
}

/* ── Recibir el stock ────────────────────────────────────────────────── */

function momentoDelCorte(valor, ahora = Date.now()) {
  if (valor === null || valor === undefined || valor === "") return 0;
  const n = /^\d{10,}$/.test(String(valor).trim()) ? Number(valor) : Date.parse(String(valor));
  // Solo se cree un corte razonable: ni del futuro ni de hace más de un día.
  if (!Number.isFinite(n) || n > ahora + 60_000 || n < ahora - DIA_MS) return 0;
  return n;
}

function nombreDelOrigen(valor) {
  const limpio = String(valor || "").replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, 40);
  return limpio ? `Sistema: ${limpio}` : "Sistema externo";
}

// El stock que manda el sistema → una importación por tandas. Devuelve
// { estado, ... } y el estado HTTP. «texto» es un CSV completo.
export async function recibirStock(db, { texto: csv, origen = "", sede = "", generado = "", probar = false, precios = true } = {}) {
  await asegurarInventario(db);
  let preparado;
  try {
    preparado = await prepararCsv(db, csv, { sedeId: 0 });
  } catch (error) {
    return { estado: 400, cuerpo: { ok: false, error: error.message } };
  }
  const { filas, col, sedeFija } = preparado;
  if (filas.length > MAXIMO_FILAS) return { estado: 413, cuerpo: { ok: false, error: `Son más de ${MAXIMO_FILAS} filas. Mándalo en partes.` } };
  let sedeDeTodas = sedeFija;
  if (sede) {
    const buscada = String(sede).trim().toLowerCase();
    const { results } = await db.prepare("SELECT id, nombre FROM inv_locales").all();
    const hallada = (results || []).find((s) => String(s.nombre).trim().toLowerCase() === buscada);
    if (!hallada) return { estado: 400, cuerpo: { ok: false, error: `No existe la sede «${sede}». Créala primero en Sedes del panel.` } };
    sedeDeTodas = Number(hallada.id);
  }
  // Lo que no cambió desde el último conteo terminado no se vuelve a pasar.
  let aPasar = filas;
  let iguales = 0;
  let huellas = [];
  if (!probar && filas.length >= FILAS_PARA_COMPARAR) {
    const c = await soloLasCambiadas(db, filas, col, origen);
    aPasar = c.cambiadas;
    iguales = c.iguales;
    huellas = c.huellas;
    if (!aPasar.length) return { estado: 200, cuerpo: { ok: true, estado: "listo", filas: filas.length, sinCambios: iguales, mensaje: "Nada cambió desde el último conteo." } };
  }
  let id;
  try {
    id = await empezarImportacion(db, {
      tipo: "csv",
      items: aPasar,
      opciones: { col, sedeFija: sedeDeTodas, quien: nombreDelOrigen(origen), aplicar: !probar, corteEn: momentoDelCorte(generado), precios },
    });
    if (huellas.length) await guardarHuellas(db, huellas, id);
  } catch (error) {
    // Hay otro conteo a medias: se espera (no se mezclan dos conteos).
    const ocupado = /a medio subir/i.test(error.message);
    return { estado: ocupado ? 409 : 400, cuerpo: { ok: false, ocupado, error: error.message, reintenta_en_segundos: ocupado ? 60 : undefined } };
  }
  let r = null;
  if (aPasar.length <= FILAS_DE_UNA_VEZ) {
    r = await seguirImportacion(db, { id, cuantos: Math.ceil(FILAS_DE_UNA_VEZ / FILAS_POR_PAQUETE), consultas: 120 });
  }
  const cuerpo = resumen(id, r, filas.length, probar);
  if (iguales) cuerpo.sinCambios = iguales;
  return { estado: r?.estado === "listo" ? 200 : 202, cuerpo, id };
}

function resumen(id, r, filas, probar = false) {
  return {
    ok: true,
    trabajo: id,
    estado: r?.estado || "trabajando",
    filas,
    probando: Boolean(probar),
    hechos: r?.hechos ?? 0,
    total: r?.total ?? Math.ceil(filas / FILAS_POR_PAQUETE),
    informe: r?.informe || undefined,
  };
}

/* ── Las puertas ─────────────────────────────────────────────────────── */

async function ultimosTrabajos(db, cuantos = 5) {
  const { results } = await db
    .prepare("SELECT id, tipo, estado, total, hechos, informe, creado, terminado FROM inv_trabajos WHERE tipo = 'csv' ORDER BY id DESC LIMIT ?")
    .bind(cuantos)
    .all();
  return (results || []).map((t) => {
    let informe = {};
    try {
      informe = JSON.parse(t.informe || "{}");
    } catch {}
    return { id: t.id, estado: t.estado, hechos: t.hechos, total: t.total, creado: t.creado, terminado: t.terminado || null, informe };
  });
}

function diaYHora(ms) {
  // Hora de Venezuela (UTC-4, sin horario de verano).
  const d = new Date(Number(ms) - 4 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function desdeMs(valor, ahora = Date.now()) {
  if (!valor) return ahora - 3 * DIA_MS;
  if (/^\d{10,}$/.test(String(valor))) return Number(valor);
  const m = String(valor).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00-04:00`);
  return ahora - 3 * DIA_MS;
}

export const COLUMNAS_DE_VENTAS = ["venta", "id", "fecha", "sede", "codigo", "codigo_modelo", "producto", "marca", "talla", "color", "cantidad", "precio_unitario", "total_linea", "metodo_pago", "cliente", "telefono", "fiado", "anulada", "nota"];

// Una fila por producto vendido (y por cobro sin inventario). Sin costos.
export async function ventasParaElSistema(db, { desde = 0, desdeId = 0 } = {}) {
  await asegurarInventario(db);
  const filtro = desdeId ? "ve.id > ?" : "ve.creado >= ?";
  const dato = desdeId ? Number(desdeId) : Number(desde);
  const { results: lineas } = await db
    .prepare(
      `SELECT ve.id, ve.ref, ve.creado, ve.metodo_pago, ve.cliente, ve.telefono, ve.fiado, ve.anulada, ve.nota, l.nombre AS sede,
              -m.delta AS cantidad, m.precio AS precio, v.opcion, v.color, v.codigo_barras, v.codigo_fabricante, p.titulo, p.marca, p.origen, p.origen_id
         FROM inv_ventas ve
         LEFT JOIN inv_locales l ON l.id = ve.local_id
         LEFT JOIN inv_movimientos m ON m.venta_id = ve.id AND m.tipo = 'venta'
         LEFT JOIN inv_variantes v ON v.id = m.variante_id
         LEFT JOIN inv_productos p ON p.id = v.producto_id
        WHERE ${filtro} ORDER BY ve.id, m.id LIMIT 5000`
    )
    .bind(dato)
    .all();
  const { results: libres } = await db
    .prepare(
      `SELECT ve.id, ve.ref, ve.creado, ve.metodo_pago, ve.cliente, ve.telefono, ve.fiado, ve.anulada, ve.nota, l.nombre AS sede,
              vl.descripcion, vl.cantidad, vl.precio
         FROM inv_venta_libre vl JOIN inv_ventas ve ON ve.id = vl.venta_id LEFT JOIN inv_locales l ON l.id = ve.local_id
        WHERE ${filtro} ORDER BY ve.id, vl.id LIMIT 2000`
    )
    .bind(dato)
    .all();
  const comun = (f) => ({
    venta: f.ref || String(f.id),
    id: f.id,
    fecha: diaYHora(f.creado),
    sede: f.sede || "",
    metodo_pago: f.metodo_pago || "",
    cliente: f.cliente || "",
    telefono: f.telefono || "",
    fiado: f.fiado ? "si" : "no",
    anulada: f.anulada ? "si" : "no",
    nota: f.nota || "",
  });
  const filas = [];
  for (const f of lineas || []) {
    if (f.cantidad === null || f.cantidad === undefined) continue; // venta sin productos de inventario
    const cantidad = Number(f.cantidad) || 0;
    const precio = f.precio === null || f.precio === undefined ? "" : Number(f.precio);
    filas.push({
      ...comun(f),
      codigo: f.codigo_fabricante || f.codigo_barras || "",
      // El código del modelo en el sistema de afuera (el que llegó en su
      // conteo), no el que la tienda se inventa solo.
      codigo_modelo: f.origen === "manual" && f.origen_id && !/^m-[0-9a-f-]{36}$/i.test(f.origen_id) ? f.origen_id : "",
      producto: f.titulo || "",
      marca: f.marca || "",
      talla: f.opcion || "",
      color: f.color || "",
      cantidad,
      precio_unitario: precio,
      total_linea: precio === "" ? "" : Math.round(precio * cantidad * 100) / 100,
    });
  }
  for (const f of libres || []) {
    const cantidad = Number(f.cantidad) || 1;
    const precio = Number(f.precio) || 0;
    filas.push({
      ...comun(f),
      codigo: "",
      codigo_modelo: "",
      producto: f.descripcion || "",
      marca: "",
      talla: "",
      color: "",
      cantidad,
      precio_unitario: precio,
      total_linea: Math.round(precio * cantidad * 100) / 100,
    });
  }
  filas.sort((a, b) => a.id - b.id);
  return filas;
}

// Atiende /api/sync/*. Devuelve null si la ruta no es suya.
//   POST /api/sync/inventario   CSV (text/csv) o JSON; ?origen= ?sede= ?generado= ?probar=1
//   POST /api/sync/avanzar      pasa otra tanda de lo que quedó a medias (?trabajo=)
//   GET  /api/sync/estado       cómo va lo último
//   GET  /api/sync/ventas       ?desde=AAAA-MM-DD | ?desde_id=N | ?formato=json
//   POST /api/sync/latido       el agente puente dice «estoy vivo» (agentes.js)
//   POST /api/sync/orden        pide que el agente sincronice ya (lo mismo que el botón del panel)
export async function atenderSync(request, env, url, ctx = null) {
  if (!url.pathname.startsWith("/api/sync/") && url.pathname !== "/api/sync") return null;
  if (!env.SYNC_CLAVE) {
    return json({ ok: false, error: "La conexión con otros sistemas está apagada: falta cargar SYNC_CLAVE (npx.cmd wrangler secret put SYNC_CLAVE)." }, 503);
  }
  if (!(await claveCorrecta(request, env))) return json({ ok: false, error: "Clave incorrecta." }, 401);
  if (!env.DB) return json({ ok: false, error: "La tienda no tiene base de datos." }, 500);
  const ruta = url.pathname.replace(/\/+$/, "");
  const db = env.DB;

  try {
    if (ruta === "/api/sync/inventario") {
      if (request.method !== "POST") return json({ ok: false, error: "Esta ruta es POST." }, 405);
      const largo = Number(request.headers.get("content-length")) || 0;
      if (largo > MAXIMO_BYTES) return json({ ok: false, error: "El archivo pasa de 2 MB. Mándalo en partes." }, 413);
      const crudo = await request.text();
      if (crudo.length > MAXIMO_BYTES) return json({ ok: false, error: "El archivo pasa de 2 MB. Mándalo en partes." }, 413);
      const tipo = (request.headers.get("content-type") || "").toLowerCase();
      let csv = crudo;
      let generado = url.searchParams.get("generado") || "";
      let origen = url.searchParams.get("origen") || "";
      let sede = url.searchParams.get("sede") || "";
      if (tipo.includes("json") || /^\s*[[{]/.test(crudo)) {
        let cuerpo;
        try {
          cuerpo = JSON.parse(crudo);
        } catch {
          return json({ ok: false, error: "El JSON no se entiende." }, 400);
        }
        if (cuerpo && !Array.isArray(cuerpo)) {
          generado ||= cuerpo.generado || "";
          origen ||= cuerpo.origen || cuerpo.sistema || "";
          sede ||= cuerpo.sede || "";
        }
        try {
          csv = aCsv(aplanar(cuerpo));
        } catch (error) {
          return json({ ok: false, error: error.message }, 400);
        }
      }
      const r = await recibirStock(db, { texto: csv, origen, sede, generado, probar: ["1", "si", "true"].includes(String(url.searchParams.get("probar") || "").toLowerCase()), precios: !/^(no|0|false)$/i.test(url.searchParams.get("precios") || "") });
      // Lo que no cupo en esta pasada sigue en el fondo (y luego, en el cron).
      if (r.estado === 202 && ctx?.waitUntil) ctx.waitUntil(seguirImportacion(db, { id: r.id, cuantos: 15, consultas: CONSULTAS_DE_UNA_PASADA }).catch(() => {}));
      return json(r.cuerpo, r.estado);
    }

    if (ruta === "/api/sync/avanzar") {
      const id = Number(url.searchParams.get("trabajo")) || 0;
      const r = await seguirImportacion(db, { id, cuantos: 15, consultas: CONSULTAS_DE_UNA_PASADA });
      if (!r) return json({ ok: true, estado: "sin trabajo", pendientes: 0 });
      return json({ ok: true, trabajo: r.id ?? id, estado: r.estado, hechos: r.hechos, total: r.total, informe: r.estado === "listo" ? r.informe : undefined });
    }

    if (ruta === "/api/sync/estado") {
      await asegurarInventario(db);
      const [enCurso, ultimos, cuenta] = await Promise.all([
        importacionesEnCurso(db),
        ultimosTrabajos(db),
        db.prepare("SELECT (SELECT COUNT(*) FROM inv_productos WHERE activo = 1) AS productos, (SELECT COUNT(*) FROM inv_variantes) AS variantes").first(),
      ]);
      const ahora = Date.now();
      const agentes = (await listarAgentes(db, ahora, env)).map((a) => ({
        agente: a.id,
        origen: a.origen,
        equipo: a.equipo,
        version: a.version,
        estado: a.estadoActual.clave,
        ultimoLatido: a.ultimo_latido,
        ultimoOk: a.ultimo_ok || null,
        ultimoError: a.ultimo_error || null,
      }));
      return json({ ok: true, productos: Number(cuenta?.productos) || 0, variantes: Number(cuenta?.variantes) || 0, enCurso: enCurso.length, ultimos, agentes, ordenPendiente: Boolean(await ordenPendiente(db)) });
    }

    if (ruta === "/api/sync/latido") {
      if (request.method !== "POST") return json({ ok: false, error: "Esta ruta es POST." }, 405);
      const crudo = await request.text();
      if (crudo.length > MAXIMO_DEL_LATIDO) return json({ ok: false, error: "El latido es demasiado largo." }, 413);
      let cuerpo;
      try {
        cuerpo = JSON.parse(crudo || "{}");
      } catch {
        return json({ ok: false, error: "El JSON no se entiende." }, 400);
      }
      const r = await recibirLatido(env, cuerpo);
      return json(r.cuerpo, r.estado);
    }

    if (ruta === "/api/sync/orden") {
      if (request.method !== "POST") return json({ ok: false, error: "Esta ruta es POST." }, 405);
      const marca = await pedirSincronizacion(db);
      return json({ ok: true, orden: "sincronizar", ordenEn: marca });
    }

    if (ruta === "/api/sync/ventas") {
      const filas = await ventasParaElSistema(db, { desde: desdeMs(url.searchParams.get("desde")), desdeId: url.searchParams.get("desde_id") });
      if ((url.searchParams.get("formato") || "").toLowerCase() === "json") return json({ ok: true, ventas: filas });
      return texto(aCsv(filas, COLUMNAS_DE_VENTAS), "text/csv; charset=utf-8", "ventas.csv");
    }
  } catch (error) {
    console.error("SYNC:", error.message);
    return json({ ok: false, error: "No se pudo con esto. Intenta otra vez." }, 500);
  }
  return json({ ok: false, error: "Esa ruta no existe." }, 404);
}

/* ── Leer solo desde una dirección (el cron) ─────────────────────────── */

// CONECTOR_URL: un CSV o un JSON en una dirección (una carpeta compartida
// con el archivo que exporta el sistema, o su API si la tiene).
//   CONECTOR_CLAVE       secreto: lo que se manda como clave (opcional)
//   CONECTOR_CABECERA    en qué cabecera ("Authorization" por defecto; con
//                        "Authorization" se manda "Bearer <clave>")
//   CONECTOR_ORIGEN      cómo se llama el sistema (sale en los movimientos)
// Lo llama el cron (cada 15 min) en Invictus y El Emperador.
export async function sincronizarDelSistema(env) {
  const direccion = String(env.CONECTOR_URL || "").trim();
  if (!direccion || !env.DB) return { hizo: false };
  const db = env.DB;
  const enCurso = await importacionesEnCurso(db).catch(() => []);
  if (enCurso.some((t) => t.tipo === "csv")) return { hizo: false, motivo: "hay un conteo a medias" };
  const cabecera = String(env.CONECTOR_CABECERA || "Authorization");
  const cabeceras = { accept: "text/csv, application/json;q=0.9, */*;q=0.5" };
  if (env.CONECTOR_CLAVE) cabeceras[cabecera] = /^authorization$/i.test(cabecera) ? `Bearer ${env.CONECTOR_CLAVE}` : String(env.CONECTOR_CLAVE);
  let respuesta;
  try {
    respuesta = await fetch(direccion, { headers: cabeceras, redirect: "follow" });
  } catch (error) {
    console.error(`CONECTOR: no se pudo leer ${new URL(direccion).host}: ${error.message}`);
    return { hizo: false, motivo: "no se pudo leer" };
  }
  if (!respuesta.ok) {
    console.error(`CONECTOR: el sistema contestó ${respuesta.status}`);
    return { hizo: false, motivo: `contestó ${respuesta.status}` };
  }
  const crudo = await respuesta.text();
  if (crudo.length > MAXIMO_BYTES) {
    console.error("CONECTOR: el archivo pasa de 2 MB; no se lee.");
    return { hizo: false, motivo: "pasa de 2 MB" };
  }
  let csv = crudo;
  let generado = respuesta.headers.get("last-modified") || "";
  if ((respuesta.headers.get("content-type") || "").includes("json") || /^\s*[[{]/.test(crudo)) {
    try {
      const cuerpo = JSON.parse(crudo);
      generado = (!Array.isArray(cuerpo) && cuerpo?.generado) || generado;
      csv = aCsv(aplanar(cuerpo));
    } catch (error) {
      console.error(`CONECTOR: el JSON no se entiende: ${error.message}`);
      return { hizo: false, motivo: "JSON inválido" };
    }
  }
  const r = await recibirStock(db, { texto: csv, origen: env.CONECTOR_ORIGEN || "", sede: env.CONECTOR_SEDE || "", generado });
  if (r.cuerpo?.ok) console.log(`CONECTOR: leídas ${r.cuerpo.filas} filas de ${new URL(direccion).host}`);
  else console.error(`CONECTOR: ${r.cuerpo?.error || "no se pudo pasar"}`);
  return { hizo: Boolean(r.cuerpo?.ok), ...r.cuerpo };
}

// El cron lo llama: lee la dirección (si hay), avanza lo que quedó a medias y
// avisa si algún agente puente dejó de dar señal.
export async function trabajoDelConector(env) {
  if (!env.DB) return;
  await sincronizarDelSistema(env).catch((error) => console.error(`CONECTOR: ${error.message}`));
  await avanzarImportacionesSolas(env.DB, { cuantos: 15, consultas: CONSULTAS_DE_UNA_PASADA }).catch(() => {});
  await vigilarAgentes(env).catch((error) => console.error(`PUENTE: ${error.message}`));
}
