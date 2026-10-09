// La cola para tu equipo. Cloudflare no puede entrar a tu computadora, asi
// que es al reves: el puente (puente/puente_swarm.py) corre en tu equipo y
// cada pocos segundos pregunta "¿hay algo para generar?". Si hay, lo genera
// en tu SwarmUI, sube las imagenes y avisa que termino.
//
//   POST /trabajos/tomar                el siguiente pendiente (o null)
//   PUT  /trabajos/<id>/imagen/<n>      sube una imagen (cuerpo = bytes)
//   POST /trabajos/<id>/terminar        { semilla, rutas_locales? } o { error }
//
// R2 es opcional. Sin bucket (cuenta de Cloudflare sin R2 activado) las
// imagenes no se suben: se quedan en tu PC, en la carpeta de salida de
// SwarmUI, y aca se guarda la direccion con la que SwarmUI las muestra.

import { formatear, terminarConError } from "./generaciones.js";

// Si el puente toma un trabajo y se cae (apagaste la PC, se colgo
// ComfyUI), pasado este tiempo el trabajo vuelve a la cola.
const TOMADO_MAXIMO_MS = 15 * 60_000;

export async function tomarTrabajo(env) {
  const ahora = Date.now();
  await env.DB.prepare(
    `UPDATE generaciones SET estado = 'pendiente', tomado = NULL
     WHERE generador = 'local' AND estado = 'tomado' AND tomado < ?1`,
  ).bind(ahora - TOMADO_MAXIMO_MS).run();

  // Un solo UPDATE: si hubiera dos puentes, nunca toman el mismo trabajo.
  const fila = await env.DB.prepare(
    `UPDATE generaciones SET estado = 'tomado', tomado = ?1
     WHERE id = (SELECT id FROM generaciones WHERE generador = 'local' AND estado = 'pendiente'
                 ORDER BY creado LIMIT 1)
       AND estado = 'pendiente'
     RETURNING *`,
  ).bind(ahora).first();
  // El puente mira esto para saber si sube las imagenes o solo las rutas.
  return fila ? { ...formatear(fila), subir_imagenes: Boolean(env.ARCHIVOS) } : null;
}

export async function subirImagen(env, id, n, request) {
  const fila = await tomada(env, id);
  if (!env.ARCHIVOS) throw new Error("Este Worker no tiene bucket R2: las imagenes se quedan en tu PC");
  const tipo = request.headers.get("Content-Type") || "image/png";
  const clave = `imagenes/${id}/${n}.${tipo.includes("jpeg") ? "jpg" : "png"}`;
  await env.ARCHIVOS.put(clave, await request.arrayBuffer(), { httpMetadata: { contentType: tipo } });
  const imagenes = JSON.parse(fila.imagenes);
  if (!imagenes.includes(clave)) imagenes.push(clave);
  await env.DB.prepare("UPDATE generaciones SET imagenes = ?2 WHERE id = ?1")
    .bind(id, JSON.stringify(imagenes)).run();
  return { ok: true, imagen: `/${clave}` };
}

export async function terminarTrabajo(env, id, datos) {
  const fila = await tomada(env, id);
  let imagenes = JSON.parse(fila.imagenes);
  if (!datos.error && imagenes.length === 0 && Array.isArray(datos.rutas_locales)) {
    imagenes = datos.rutas_locales.map(String).filter((r) => /^https?:\/\//.test(r));
    await env.DB.prepare("UPDATE generaciones SET imagenes = ?2 WHERE id = ?1")
      .bind(id, JSON.stringify(imagenes)).run();
  }
  if (datos.error) {
    await terminarConError(env, id, datos.error);
  } else if (imagenes.length === 0) {
    await terminarConError(env, id, "El puente termino sin subir imagenes");
  } else {
    await env.DB.prepare(
      `UPDATE generaciones SET estado = 'lista', semilla = ?2, terminado = ?3 WHERE id = ?1 AND estado = 'tomado'`,
    ).bind(id, datos.semilla ?? null, Date.now()).run();
  }
  return formatear(await env.DB.prepare("SELECT * FROM generaciones WHERE id = ?1").bind(id).first());
}

async function tomada(env, id) {
  const fila = await env.DB.prepare("SELECT * FROM generaciones WHERE id = ?1").bind(id).first();
  if (!fila) throw new Error("No existe ese trabajo");
  if (fila.estado !== "tomado") throw new Error(`Ese trabajo esta "${fila.estado}", no "tomado"`);
  return fila;
}
