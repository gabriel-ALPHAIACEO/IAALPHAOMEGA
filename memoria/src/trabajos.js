// La cola para tu equipo. Cloudflare no puede entrar a tu computadora, asi
// que es al reves: el puente (puente/puente_comfyui.py) corre en tu equipo
// y cada pocos segundos pregunta "¿hay algo para generar?". Si hay, lo
// genera con ComfyUI y tus LoRA, sube las imagenes y avisa que termino.
//
//   POST /trabajos/tomar                el siguiente pendiente (o null)
//   PUT  /trabajos/<id>/imagen/<n>      sube una imagen (cuerpo = bytes)
//   POST /trabajos/<id>/terminar        { semilla, imagenes } o { error }

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
  return fila ? formatear(fila) : null;
}

export async function subirImagen(env, id, n, request) {
  const fila = await tomada(env, id);
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
  if (datos.error) {
    await terminarConError(env, id, datos.error);
  } else if (JSON.parse(fila.imagenes).length === 0) {
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
