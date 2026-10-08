// Una generacion = una modelo + una escena -> imagenes. Quien genera de
// verdad lo decide GENERADOR en wrangler.toml: "local" (tu SwarmUI, con tus
// modelos y LoRA, via puente/) o "fal" (GPU en la nube).
// Se pide solo la
// escena; la identidad (LoRA, rostro, cuerpo) la pone la ficha de la modelo
// (ver modelos.js). Todo queda guardado (escena, prompt completo, LoRA,
// escala, semilla, imagenes) para repetir lo que funciono y, mas adelante,
// cruzarlo con las ventas.

import { firmar } from "./auth.js";
import { encolar, consultar } from "./fal.js";
import { buscarLora, urlParaFal } from "./loras.js";
import { buscarModelo, armarPrompt } from "./modelos.js";

const TAMANOS = ["square_hd", "square", "portrait_4_3", "portrait_16_9", "landscape_4_3", "landscape_16_9"];

// Si fal no avisa en este tiempo, GET /generaciones/<id> le pregunta a mano.
const ESPERA_ANTES_DE_CONSULTAR_MS = 60_000;

export async function generar(env, origen, pedido) {
  const escena = String(pedido.escena || "").trim();
  if (!escena) throw new Error('Falta "escena": que hace la modelo y donde');
  const modelo = await buscarModelo(env, String(pedido.modelo || ""));
  if (!modelo) throw new Error(`No existe la modelo "${pedido.modelo}": creala con POST /modelos`);
  const generador = env.GENERADOR === "fal" ? "fal" : "local";

  // Primero SIEMPRE el LoRA de la modelo (si tiene), con su escala. Los
  // extra (estilo, ropa, lugar) van detras y no pueden reemplazarlo.
  const loras = [];
  if (modelo.lora_id) loras.push({ lora: await loraPorId(env, modelo.lora_id), escala: Number(modelo.escala) });
  for (const p of Array.isArray(pedido.loras_extra) ? pedido.loras_extra : []) {
    const lora = await buscarLora(env, p.nombre);
    if (!lora) throw new Error(`No existe el LoRA "${p.nombre}"`);
    if (lora.id === modelo.lora_id) continue;
    loras.push({ lora, escala: Number(p.escala ?? lora.escala) });
  }
  if (generador === "fal" && !loras.length) throw new Error("Con fal la modelo necesita un LoRA");
  if (generador === "local") {
    const sinArchivo = loras.find(({ lora }) => !lora.archivo_local);
    if (sinArchivo) {
      throw new Error(`El LoRA "${sinArchivo.lora.nombre}" no tiene archivo_local: como se llama en tu carpeta de LoRA`);
    }
  }

  const extras = loras.filter(({ lora }) => lora.id !== modelo.lora_id).map(({ lora }) => lora.palabra_clave);
  const prompt = armarPrompt(modelo, escena, { conSegmento: generador === "local", extras });
  const cantidad = Math.min(Math.max(Number(pedido.cantidad) || 1, 1), generador === "local" ? 10 : 4);
  const semilla = pedido.semilla ?? modelo.semilla;

  // Los mismos nombres que usa cada generador, para mandarlos tal cual.
  const parametros = generador === "local"
    ? {
        model: modelo.checkpoint,
        images: cantidad,
        steps: Number(pedido.pasos) || modelo.pasos,
        cfgscale: Number(pedido.guia) || modelo.cfg,
        width: modelo.ancho,
        height: modelo.alto,
        seed: semilla != null ? Number(semilla) : -1,
      }
    : {
        image_size: TAMANOS.includes(pedido.tamano) ? pedido.tamano
          : TAMANOS.includes(modelo.tamano) ? modelo.tamano : "portrait_4_3",
        num_images: cantidad,
        num_inference_steps: Number(pedido.pasos) || 28,
        guidance_scale: Number(pedido.guia) || 3.5,
        enable_safety_checker: pedido.filtro_seguridad !== false,
        output_format: "jpeg",
        ...(semilla != null ? { seed: Number(semilla) } : {}),
      };
  if (generador === "local" && !parametros.model) {
    throw new Error(`La modelo "${modelo.nombre}" no tiene checkpoint: con que modelo de SwarmUI se genera`);
  }

  const id = crypto.randomUUID();
  // Se guarda ANTES de encolar: si fal contesta muy rapido, el aviso tiene
  // que encontrar la fila ya escrita. Con el generador local, guardarla ES
  // encolarla: el puente de tu equipo la toma de aca (ver trabajos.js).
  await env.DB.prepare(
    `INSERT INTO generaciones (id, modelo_id, escena, loras, prompt, parametros, generador, creado)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  )
    .bind(id, modelo.id, escena,
      JSON.stringify(loras.map(({ lora, escala }) => ({ nombre: lora.nombre, escala, archivo: lora.archivo_local }))),
      prompt, JSON.stringify(parametros), generador, Date.now())
    .run();
  if (generador === "local") return leerGeneracion(env, id);

  const entrada = {
    ...parametros,
    prompt,
    loras: await Promise.all(
      loras.map(async ({ lora, escala }) => ({ path: await urlParaFal(env, origen, lora), scale: escala })),
    ),
  };
  const webhook = `${origen}/fal/aviso/${id}?firma=${await firmar(env, `aviso:${id}`)}`;
  try {
    const cola = await encolar(env, entrada, webhook);
    await env.DB.prepare("UPDATE generaciones SET request_id = ?2, fal_urls = ?3 WHERE id = ?1")
      .bind(id, cola.request_id,
        JSON.stringify({ status_url: cola.status_url, response_url: cola.response_url }))
      .run();
  } catch (e) {
    await terminarConError(env, id, e.message);
    throw e;
  }
  return leerGeneracion(env, id);
}

function loraPorId(env, id) {
  return env.DB.prepare("SELECT * FROM loras WHERE id = ?1").bind(id).first();
}

// POST /fal/aviso/<id>?firma=..  (sin token: lo llama fal)
// La firma ya la comprobo index.js antes de llegar aca.
export async function recibirAviso(env, id, cuerpo) {
  if (cuerpo.status === "OK") await guardarResultado(env, id, cuerpo.payload);
  else await terminarConError(env, id, JSON.stringify(cuerpo.error || cuerpo.payload || "error de fal"));
}

export async function leerGeneracion(env, id) {
  let fila = await env.DB.prepare("SELECT * FROM generaciones WHERE id = ?1").bind(id).first();
  if (fila?.generador === "fal" && fila.estado === "pendiente" && Date.now() - fila.creado > ESPERA_ANTES_DE_CONSULTAR_MS) {
    const urls = JSON.parse(fila.fal_urls);
    // Si fal falla al contestar, se devuelve la fila como esta: leer el
    // historial no puede romperse porque fal tenga un mal momento.
    const r = urls.status_url ? await consultar(env, urls).catch(() => null) : null;
    if (r?.ok) await guardarResultado(env, id, r.salida);
    else if (r) await terminarConError(env, id, r.error);
    if (r) fila = await env.DB.prepare("SELECT * FROM generaciones WHERE id = ?1").bind(id).first();
  }
  return fila && formatear(fila);
}

export async function listarGeneraciones(env, { modelo, limite }) {
  const n = Math.min(Number(limite) || 20, 100);
  const consulta = modelo
    ? env.DB.prepare(
        `SELECT generaciones.* FROM generaciones JOIN modelos ON modelos.id = generaciones.modelo_id
         WHERE modelos.nombre = ?1 ORDER BY generaciones.creado DESC LIMIT ?2`,
      ).bind(modelo, n)
    : env.DB.prepare("SELECT * FROM generaciones ORDER BY creado DESC LIMIT ?1").bind(n);
  const { results } = await consulta.all();
  return results.map(formatear);
}

// Las URL de fal caducan: cada imagen se copia al bucket en el momento.
async function guardarResultado(env, id, salida) {
  // fal puede repetir el aviso: si ya se guardo, no se vuelve a copiar.
  const fila = await env.DB.prepare("SELECT estado FROM generaciones WHERE id = ?1").bind(id).first();
  if (!fila || fila.estado !== "pendiente") return;

  const claves = [];
  for (const [i, imagen] of (salida?.images || []).entries()) {
    const res = await fetch(imagen.url);
    if (!res.ok) continue;
    const tipo = imagen.content_type || "image/jpeg";
    const clave = `imagenes/${id}/${i}.${tipo.includes("png") ? "png" : "jpg"}`;
    // arrayBuffer y no res.body: R2 rechaza un stream sin largo conocido, y
    // fal no siempre manda Content-Length. Una imagen cabe de sobra en memoria.
    await env.ARCHIVOS.put(clave, await res.arrayBuffer(), { httpMetadata: { contentType: tipo } });
    claves.push(clave);
  }
  if (!claves.length) return terminarConError(env, id, "fal termino pero no devolvio imagenes");
  await env.DB.prepare(
    `UPDATE generaciones SET estado = 'lista', imagenes = ?2, semilla = ?3, terminado = ?4
     WHERE id = ?1 AND estado = 'pendiente'`,
  )
    .bind(id, JSON.stringify(claves), salida.seed ?? null, Date.now())
    .run();
}

export function terminarConError(env, id, error) {
  return env.DB.prepare(
    `UPDATE generaciones SET estado = 'error', error = ?2, terminado = ?3
     WHERE id = ?1 AND estado IN ('pendiente', 'tomado')`,
  )
    .bind(id, String(error).slice(0, 2000), Date.now())
    .run();
}

export function formatear(fila) {
  return {
    ...fila,
    loras: JSON.parse(fila.loras),
    parametros: JSON.parse(fila.parametros),
    imagenes: JSON.parse(fila.imagenes).map((clave) => `/${clave}`),
    fal_urls: undefined,
  };
}
