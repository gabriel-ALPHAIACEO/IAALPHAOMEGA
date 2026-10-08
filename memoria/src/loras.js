// Registro de LoRA. Cada LoRA vive en uno de dos lugares:
//  - en el bucket R2 (lo normal): se sube con PUT /loras/<nombre>/archivo,
//    o con wrangler si pesa mas de 100 MB (ver README).
//  - afuera (Hugging Face, Civitai, fal storage...): solo se guarda la URL.
//
// fal no puede leer el bucket, que es privado. Para cada generacion se le
// da un enlace firmado que caduca en ENLACE_MINUTOS: lo descarga y listo.

import { firmar, firmaValida } from "./auth.js";

export async function registrarLora(env, datos) {
  const nombre = String(datos.nombre || "").trim();
  if (!nombre) throw new Error("Falta el nombre del LoRA");
  const existente = await buscarLora(env, nombre);
  const fila = {
    id: existente?.id || crypto.randomUUID(),
    nombre,
    palabra_clave: String(datos.palabra_clave ?? existente?.palabra_clave ?? ""),
    modelo_base: String(datos.modelo_base ?? existente?.modelo_base ?? "flux-dev"),
    escala: Number(datos.escala ?? existente?.escala ?? 1),
    r2_key: String(datos.r2_key ?? existente?.r2_key ?? ""),
    url_externa: String(datos.url_externa ?? existente?.url_externa ?? ""),
    notas: String(datos.notas ?? existente?.notas ?? ""),
  };
  await env.DB.prepare(
    `INSERT INTO loras (id, nombre, palabra_clave, modelo_base, escala, r2_key, url_externa, notas, creado)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
     ON CONFLICT(id) DO UPDATE SET nombre = ?2, palabra_clave = ?3, modelo_base = ?4,
       escala = ?5, r2_key = ?6, url_externa = ?7, notas = ?8`,
  )
    .bind(fila.id, fila.nombre, fila.palabra_clave, fila.modelo_base,
      fila.escala, fila.r2_key, fila.url_externa, fila.notas, Date.now())
    .run();
  return buscarLora(env, nombre);
}

export async function subirArchivo(env, nombre, cuerpo) {
  const lora = await buscarLora(env, nombre);
  if (!lora) throw new Error(`No existe el LoRA "${nombre}": registralo primero con POST /loras`);
  const r2_key = `loras/${lora.id}.safetensors`;
  await env.ARCHIVOS.put(r2_key, cuerpo, {
    httpMetadata: { contentType: "application/octet-stream" },
  });
  return registrarLora(env, { nombre, r2_key });
}

export function buscarLora(env, nombre) {
  return env.DB.prepare("SELECT * FROM loras WHERE nombre = ?1").bind(nombre).first();
}

export async function listarLoras(env) {
  const { results } = await env.DB.prepare("SELECT * FROM loras ORDER BY creado DESC").all();
  return results;
}

// La URL que se le pasa a fal en "loras[].path".
export async function urlParaFal(env, origen, lora) {
  if (lora.url_externa) return lora.url_externa;
  if (!lora.r2_key) throw new Error(`El LoRA "${lora.nombre}" no tiene archivo todavia`);
  const vence = Date.now() + Number(env.ENLACE_MINUTOS || 30) * 60_000;
  const firma = await firmar(env, `lora:${lora.id}:${vence}`);
  return `${origen}/archivo-lora/${lora.id}?vence=${vence}&firma=${firma}`;
}

// GET /archivo-lora/<id>?vence=..&firma=..  (sin token: lo pide fal)
export async function servirArchivo(env, id, url) {
  const vence = Number(url.searchParams.get("vence"));
  const firma = url.searchParams.get("firma");
  if (!vence || vence < Date.now() || !(await firmaValida(env, `lora:${id}:${vence}`, firma))) {
    return new Response("Enlace vencido o invalido", { status: 403 });
  }
  const lora = await env.DB.prepare("SELECT r2_key FROM loras WHERE id = ?1").bind(id).first();
  const objeto = lora?.r2_key && (await env.ARCHIVOS.get(lora.r2_key));
  if (!objeto) return new Response("No encontrado", { status: 404 });
  return new Response(objeto.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(objeto.size),
      "Content-Disposition": `attachment; filename="${id}.safetensors"`,
    },
  });
}
