// LAS FOTOS QUE MANDA EL SISTEMA DE INVENTARIO (16-oct-2026, pedido del
// dueño: "que también envíe las fotos en caso de que tenga fotos el sistema").
// ESTE ARCHIVO ES IGUAL EN LAS CUATRO TIENDAS.
//
// El agente puente (agente-puente/) manda cada foto a  POST /api/sync/foto
// (con la clave SYNC_CLAVE), una por pedido, con el código o el nombre del
// producto y su posición (0 = la principal). Aquí se guarda como una foto
// subida en el panel (fotos.js: inv_imagenes + inv_fotos), y se apunta en
// `sync_fotos` que vino del sistema.
//
// LAS REGLAS:
//   · LAS FOTOS DEL PANEL MANDAN. Si el producto ya tiene fotos puestas por
//     una persona, el sistema no añade ni cambia ninguna («del-panel»).
//   · La misma foto otra vez no hace nada («igual»): se compara su huella.
//   · Si el sistema cambió la foto de esa posición, se cambia («cambiada»).
//   · Si alguien QUITÓ en el panel una foto que vino del sistema, la misma no
//     vuelve a entrar (quitarla fue a propósito). Una distinta, sí.
//   · Sin producto con ese código o nombre todavía: 404 («sin-producto»); el
//     agente la vuelve a intentar más tarde (primero tiene que llegar el stock).
//   · Solo JPG, PNG o WEBP (por sus bytes) y hasta 1,5 MB, como en el panel.

import { asegurarInventario, limpiarCodigo } from "./inventario.js";
import { asegurarImagenes, subirFotos, tipoDeImagen, idDeFotoSubida, MAXIMO_FOTO, FOTOS_POR_PRODUCTO, RUTA_DE_FOTOS } from "./fotos.js";

const TABLA = `CREATE TABLE IF NOT EXISTS sync_fotos (
  producto_id INTEGER NOT NULL,
  posicion    INTEGER NOT NULL,
  huella      TEXT NOT NULL,
  foto_id     INTEGER NOT NULL DEFAULT 0,
  actualizado INTEGER NOT NULL,
  PRIMARY KEY (producto_id, posicion)
)`;

const listas = new WeakSet();
export async function asegurarFotosDelSistema(db) {
  await asegurarImagenes(db);
  if (listas.has(db)) return;
  await db.prepare(TABLA).run();
  listas.add(db);
}

async function huellaDe(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function aBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// El producto de esa foto: por el código (de una talla, del modelo o el del
// sistema de afuera) y, si no, por el nombre.
export async function productoDeLaFoto(db, { codigo = "", producto = "" } = {}) {
  await asegurarInventario(db);
  const c = limpiarCodigo(codigo);
  if (c) {
    const v = await db.prepare("SELECT v.producto_id AS id FROM inv_variantes v JOIN inv_productos p ON p.id = v.producto_id WHERE p.activo = 1 AND (v.codigo_barras = ? OR v.codigo_fabricante = ?) LIMIT 1").bind(c, c).first();
    if (v) return Number(v.id);
    const p = await db
      .prepare("SELECT id FROM inv_productos WHERE activo = 1 AND (origen_id = ? OR json_extract(extras, '$.codigo') = ? COLLATE NOCASE) ORDER BY origen = 'manual' LIMIT 1")
      .bind(c, c)
      .first();
    if (p) return Number(p.id);
  }
  const nombre = String(producto || "").trim();
  if (nombre) {
    const p = await db.prepare("SELECT id FROM inv_productos WHERE activo = 1 AND titulo = ? COLLATE NOCASE LIMIT 1").bind(nombre).first();
    if (p) return Number(p.id);
  }
  return 0;
}

// Una foto del sistema. origen: la dirección de la tienda (para la URL de la foto).
// → { estado: http, cuerpo: { ok, estado: "nueva"|"cambiada"|"igual"|"del-panel"|"sin-producto", … } }
export async function recibirFoto(db, { codigo = "", producto = "", posicion = 0, bytes, origen }) {
  await asegurarFotosDelSistema(db);
  const pos = Math.max(0, Math.min(FOTOS_POR_PRODUCTO - 1, Math.trunc(Number(posicion)) || 0));
  if (!(bytes instanceof Uint8Array) || !bytes.length) return { estado: 400, cuerpo: { ok: false, error: "La foto llegó vacía." } };
  if (bytes.length > MAXIMO_FOTO) return { estado: 413, cuerpo: { ok: false, error: `La foto pesa más de ${MAXIMO_FOTO / 1e6} MB: hay que achicarla.` } };
  const tipo = tipoDeImagen(bytes);
  if (!tipo) return { estado: 415, cuerpo: { ok: false, error: "No es una foto JPG, PNG o WEBP." } };
  if (!String(codigo).trim() && !String(producto).trim()) return { estado: 400, cuerpo: { ok: false, error: "Falta el código o el nombre del producto." } };

  const id = await productoDeLaFoto(db, { codigo, producto });
  if (!id) return { estado: 404, cuerpo: { ok: false, estado: "sin-producto", error: "No hay ningún producto con ese código o nombre (primero tiene que llegar en el stock)." } };
  const huella = await huellaDe(bytes);
  const antes = await db.prepare("SELECT * FROM sync_fotos WHERE producto_id = ? AND posicion = ?").bind(id, pos).first();
  if (antes && antes.huella === huella) return { estado: 200, cuerpo: { ok: true, estado: "igual", producto: id } };

  // ¿Tiene fotos puestas por una persona? Entonces mandan esas.
  const { results: suyas } = await db.prepare("SELECT foto_id FROM sync_fotos WHERE producto_id = ?").bind(id).all();
  const delSistema = new Set((suyas || []).map((s) => Number(s.foto_id)));
  const { results: fotos } = await db.prepare("SELECT id, url FROM inv_fotos WHERE producto_id = ?").bind(id).all();
  if ((fotos || []).some((f) => !delSistema.has(Number(f.id)))) return { estado: 200, cuerpo: { ok: true, estado: "del-panel", producto: id } };

  const ahora = Date.now();
  const vieja = antes ? (fotos || []).find((f) => Number(f.id) === Number(antes.foto_id)) : null;
  let fotoId = 0;
  if (vieja) {
    // La misma posición, otra foto: se cambia la imagen y se borra la vieja.
    const base = String(origen || "").replace(/\/+$/, "");
    const nueva = await db.prepare("INSERT INTO inv_imagenes (producto_id, tipo, tamano, datos, creado) VALUES (?, ?, ?, ?, ?) RETURNING id").bind(id, tipo, bytes.length, aBase64(bytes), ahora).first();
    const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[tipo];
    const sentencias = [
      db.prepare("UPDATE inv_fotos SET url = ? WHERE id = ?").bind(`${base}${RUTA_DE_FOTOS}${Number(nueva.id)}.${extension}`, vieja.id),
      db.prepare("UPDATE inv_productos SET actualizado = ? WHERE id = ?").bind(ahora, id),
    ];
    const imagenVieja = idDeFotoSubida(vieja.url);
    if (imagenVieja) sentencias.push(db.prepare("DELETE FROM inv_imagenes WHERE id = ? AND NOT EXISTS (SELECT 1 FROM inv_variantes WHERE foto = ?)").bind(imagenVieja, vieja.url));
    await db.batch(sentencias);
    fotoId = Number(vieja.id);
  } else {
    const r = await subirFotos(db, id, [{ bytes, nombre: `sistema-${pos}` }], { origen });
    if (!r.subidas) return { estado: 409, cuerpo: { ok: false, error: r.errores[0] || "No se pudo guardar la foto." } };
    fotoId = Number((await db.prepare("SELECT id FROM inv_fotos WHERE producto_id = ? ORDER BY id DESC LIMIT 1").bind(id).first())?.id) || 0;
    // La principal del sistema va primero.
    if (pos === 0 && fotoId) await db.prepare("UPDATE inv_fotos SET orden = CASE WHEN id = ? THEN 0 ELSE orden + 1 END WHERE producto_id = ?").bind(fotoId, id).run();
  }
  await db
    .prepare("INSERT INTO sync_fotos (producto_id, posicion, huella, foto_id, actualizado) VALUES (?, ?, ?, ?, ?) ON CONFLICT (producto_id, posicion) DO UPDATE SET huella = excluded.huella, foto_id = excluded.foto_id, actualizado = excluded.actualizado")
    .bind(id, pos, huella, fotoId, ahora)
    .run();
  return { estado: 200, cuerpo: { ok: true, estado: vieja ? "cambiada" : "nueva", producto: id } };
}

// Cuántas fotos llegaron del sistema (para la tarjeta del panel).
export async function contarFotosDelSistema(db) {
  try {
    await asegurarFotosDelSistema(db);
    const f = await db.prepare("SELECT COUNT(*) AS n FROM sync_fotos s JOIN inv_fotos f ON f.id = s.foto_id").first();
    return Number(f?.n) || 0;
  } catch {
    return 0;
  }
}
