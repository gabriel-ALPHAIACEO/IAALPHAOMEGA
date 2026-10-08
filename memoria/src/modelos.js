// La ficha fija de cada modelo. Es lo que hace que sea "la misma" en cada
// imagen aunque cambie el prompt:
//
//   prompt final = palabra clave del LoRA + rostro + cuerpo + rasgos fijos
//                  + ESCENA (lo unico que se escribe al generar) + estilo
//
// La identidad va delante de la escena a proposito: en Flux lo primero del
// prompt pesa mas. Y la escena NO puede pisarla: si la ficha dice "pelo
// negro" y la escena pide "rubia", sale una mezcla. Para cambiar algo de
// la identidad se edita la ficha, no el prompt.

import { buscarLora } from "./loras.js";

const CAMPOS_TEXTO = ["rostro", "cuerpo", "rasgos_fijos", "estilo", "tamano", "notas"];

export async function registrarModelo(env, datos) {
  const nombre = String(datos.nombre || "").trim();
  if (!nombre) throw new Error("Falta el nombre de la modelo");
  const existente = await buscarModelo(env, nombre);

  let lora_id = existente?.lora_id;
  if (datos.lora) {
    const lora = await buscarLora(env, datos.lora);
    if (!lora) throw new Error(`No existe el LoRA "${datos.lora}": registralo primero con POST /loras`);
    lora_id = lora.id;
  }
  if (!lora_id) throw new Error('Falta "lora": el LoRA entrenado con esta modelo');

  const fila = { id: existente?.id || crypto.randomUUID(), nombre, lora_id };
  for (const campo of CAMPOS_TEXTO) fila[campo] = String(datos[campo] ?? existente?.[campo] ?? "");
  if (!fila.tamano) fila.tamano = "portrait_4_3";
  fila.escala = Number(datos.escala ?? existente?.escala ?? 1);
  // "semilla": null la suelta; no mandarla deja la que habia.
  fila.semilla = datos.semilla === undefined ? existente?.semilla ?? null
    : datos.semilla === null ? null : Number(datos.semilla);

  await env.DB.prepare(
    `INSERT INTO modelos (id, nombre, lora_id, escala, rostro, cuerpo, rasgos_fijos, estilo, semilla, tamano, notas, creado)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
     ON CONFLICT(id) DO UPDATE SET nombre = ?2, lora_id = ?3, escala = ?4, rostro = ?5, cuerpo = ?6,
       rasgos_fijos = ?7, estilo = ?8, semilla = ?9, tamano = ?10, notas = ?11`,
  )
    .bind(fila.id, fila.nombre, fila.lora_id, fila.escala, fila.rostro, fila.cuerpo,
      fila.rasgos_fijos, fila.estilo, fila.semilla, fila.tamano, fila.notas, Date.now())
    .run();
  return buscarModelo(env, nombre);
}

export function buscarModelo(env, nombre) {
  return env.DB.prepare(
    `SELECT modelos.*, loras.nombre AS lora, loras.palabra_clave
     FROM modelos JOIN loras ON loras.id = modelos.lora_id WHERE modelos.nombre = ?1`,
  ).bind(nombre).first();
}

export async function listarModelos(env) {
  const { results } = await env.DB.prepare(
    `SELECT modelos.*, loras.nombre AS lora, loras.palabra_clave
     FROM modelos JOIN loras ON loras.id = modelos.lora_id ORDER BY modelos.nombre`,
  ).all();
  return results;
}

export function armarPrompt(modelo, escena) {
  return [modelo.palabra_clave, modelo.rostro, modelo.cuerpo, modelo.rasgos_fijos, escena, modelo.estilo]
    .map((parte) => String(parte || "").trim().replace(/[,.\s]+$/, ""))
    .filter(Boolean)
    .join(", ");
}
