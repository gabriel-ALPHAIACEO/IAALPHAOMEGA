// LAS FOTOS DE LOS PRODUCTOS, SUBIDAS DESDE EL PANEL (13-oct-2026, pedido del
// dueño: "que puedas subir imágenes de los productos").
//
// QUÉ HACE. En «Nuevo producto» y en la ficha de cada producto se suben fotos
// desde el teléfono o la computadora. El navegador las achica antes de
// mandarlas (1600 px, JPG): suben rápido y caben en la base.
//
// DÓNDE VIVEN. En la MISMA base D1 de la tienda (tabla inv_imagenes, en
// base64), sin R2 ni nada que configurar. Cada foto queda en inv_fotos con
// su dirección pública, https://<worker>/tienda/img/<id>.jpg, igual que una
// foto de Shopify o de Drive: la tienda web, la ficha del panel y el bot
// (donde lee del inventario) la usan sin saber de dónde salió. La sirve
// catalogo-web.js, también con la tienda web apagada.
//
// REGLAS. Solo JPG, PNG o WEBP de verdad (se miran los primeros bytes, no el
// nombre), de hasta MAXIMO_FOTO cada una, y FOTOS_POR_PRODUCTO como mucho.
// Quitar una foto subida la borra de la base; quitar una de Shopify o Drive
// solo la quita del producto (volver a traer el catálogo la pone otra vez).
//
// ESTE ARCHIVO ES IGUAL EN LAS TRES TIENDAS.

import { asegurarInventario } from "./inventario.js";

export const MAXIMO_FOTO = 1_500_000;
export const FOTOS_POR_PRODUCTO = 10;
export const RUTA_DE_FOTOS = "/tienda/img/";

const TABLA = `CREATE TABLE IF NOT EXISTS inv_imagenes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  producto_id INTEGER NOT NULL,
  tipo        TEXT NOT NULL,
  tamano      INTEGER NOT NULL DEFAULT 0,
  datos       TEXT NOT NULL,
  creado      INTEGER NOT NULL
)`;

let lista = false;

export async function asegurarImagenes(db) {
  await asegurarInventario(db);
  if (lista) return;
  await db.prepare(TABLA).run();
  lista = true;
}

export function olvidarQueImagenesEstaLista() {
  lista = false;
}

const EXTENSION = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

// Por los primeros bytes. Nada de SVG ni HTML: podrían llevar código.
export function tipoDeImagen(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
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

// "https://x.workers.dev/tienda/img/12.jpg" → 12 (solo las nuestras).
export function idDeFotoSubida(url) {
  const m = /\/tienda\/img\/(\d+)\.(?:jpg|png|webp)(?:[?#]|$)/i.exec(String(url || ""));
  return m ? Number(m[1]) : null;
}

// Lo que mandó un formulario (input type="file" multiple) → [{ bytes, nombre }].
export async function archivosDelFormulario(datos, campo = "fotos") {
  const salida = [];
  for (const a of datos?.getAll?.(campo) || []) {
    if (!a || typeof a !== "object" || typeof a.arrayBuffer !== "function" || !a.size) continue;
    if (a.size > MAXIMO_FOTO) {
      salida.push({ bytes: null, nombre: String(a.name || "foto"), grande: true });
      continue;
    }
    salida.push({ bytes: new Uint8Array(await a.arrayBuffer()), nombre: String(a.name || "foto") });
  }
  return salida;
}

// Guarda las fotos y las pone al final del producto. origen: la dirección del
// Worker ("https://x.workers.dev"), para que la foto tenga una dirección
// completa que sirva en la web, en el panel y para el bot.
// → { subidas, errores: ["foto.heic: …"] }
export async function subirFotos(db, productoId, archivos, { origen }) {
  await asegurarImagenes(db);
  const id = Number(productoId) || 0;
  if (!(await db.prepare("SELECT 1 FROM inv_productos WHERE id = ?").bind(id).first())) throw new Error("Ese producto no existe.");
  const base = String(origen || "").replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) throw new Error("No sé la dirección de la tienda para guardar la foto.");
  const fila = await db.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(orden), -1) AS ultimo FROM inv_fotos WHERE producto_id = ?").bind(id).first();
  let hay = Number(fila?.n) || 0;
  let orden = Number(fila?.ultimo ?? -1) + 1;
  let subidas = 0;
  const errores = [];
  for (const a of archivos || []) {
    const nombre = String(a?.nombre || "foto").slice(0, 60);
    if (a?.grande) {
      errores.push(`${nombre}: pesa demasiado (máximo ${Math.round(MAXIMO_FOTO / 100000) / 10} MB)`);
      continue;
    }
    const bytes = a?.bytes instanceof Uint8Array ? a.bytes : null;
    if (!bytes || !bytes.length) continue;
    if (hay >= FOTOS_POR_PRODUCTO) {
      errores.push(`${nombre}: ya tiene ${FOTOS_POR_PRODUCTO} fotos (quita alguna para subir otra)`);
      continue;
    }
    if (bytes.length > MAXIMO_FOTO) {
      errores.push(`${nombre}: pesa demasiado (máximo ${Math.round(MAXIMO_FOTO / 100000) / 10} MB)`);
      continue;
    }
    const tipo = tipoDeImagen(bytes);
    if (!tipo) {
      errores.push(`${nombre}: no es una foto JPG, PNG o WEBP`);
      continue;
    }
    const nueva = await db
      .prepare("INSERT INTO inv_imagenes (producto_id, tipo, tamano, datos, creado) VALUES (?, ?, ?, ?, ?) RETURNING id")
      .bind(id, tipo, bytes.length, aBase64(bytes), Date.now())
      .first();
    const url = `${base}${RUTA_DE_FOTOS}${Number(nueva.id)}.${EXTENSION[tipo]}`;
    await db.batch([
      db.prepare("INSERT INTO inv_fotos (producto_id, url, orden) VALUES (?, ?, ?)").bind(id, url, orden++),
      db.prepare("UPDATE inv_productos SET actualizado = ? WHERE id = ?").bind(Date.now(), id),
    ]);
    hay++;
    subidas++;
  }
  return { subidas, errores };
}

// La foto pública (/tienda/img/<id>.jpg). null si no existe.
export async function fotoSubida(db, id) {
  try {
    const f = await db.prepare("SELECT tipo, datos FROM inv_imagenes WHERE id = ?").bind(Number(id) || 0).first();
    return f ? { tipo: String(f.tipo), bytes: deBase64(f.datos) } : null;
  } catch {
    // Sin la tabla todavía: no hay ninguna.
    return null;
  }
}

// Quita una foto del producto. Si es de las subidas aquí y ya nadie la usa
// (ni otra foto ni una talla), se borra también de la base.
export async function quitarFoto(db, productoId, fotoId) {
  await asegurarImagenes(db);
  const f = await db.prepare("SELECT id, url FROM inv_fotos WHERE id = ? AND producto_id = ?").bind(Number(fotoId) || 0, Number(productoId) || 0).first();
  if (!f) throw new Error("Esa foto ya no está.");
  const sentencias = [db.prepare("DELETE FROM inv_fotos WHERE id = ?").bind(f.id), db.prepare("UPDATE inv_productos SET actualizado = ? WHERE id = ?").bind(Date.now(), Number(productoId) || 0)];
  const propia = idDeFotoSubida(f.url);
  if (propia) {
    const usada = await db
      .prepare("SELECT (SELECT COUNT(*) FROM inv_fotos WHERE url = ? AND id <> ?) + (SELECT COUNT(*) FROM inv_variantes WHERE foto = ?) AS n")
      .bind(f.url, f.id, f.url)
      .first();
    if (!Number(usada?.n)) sentencias.push(db.prepare("DELETE FROM inv_imagenes WHERE id = ?").bind(propia));
  }
  await db.batch(sentencias);
}

// La que sale primero: en la tienda web, en la ficha y en el bot.
export async function hacerPrincipal(db, productoId, fotoId) {
  await asegurarImagenes(db);
  const p = Number(productoId) || 0;
  const f = await db.prepare("SELECT id FROM inv_fotos WHERE id = ? AND producto_id = ?").bind(Number(fotoId) || 0, p).first();
  if (!f) throw new Error("Esa foto ya no está.");
  await db.batch([
    db.prepare("UPDATE inv_fotos SET orden = orden + 1 WHERE producto_id = ?").bind(p),
    db.prepare("UPDATE inv_fotos SET orden = 0 WHERE id = ?").bind(f.id),
    db.prepare("UPDATE inv_productos SET actualizado = ? WHERE id = ?").bind(Date.now(), p),
  ]);
}
