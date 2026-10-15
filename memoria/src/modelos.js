// La ficha fija de cada modelo. Es lo que hace que sea "la misma" en cada
// imagen aunque cambie el prompt:
//
//   prompt = palabra clave del LoRA + rostro + cuerpo + rasgos fijos
//            + ESCENA (lo unico que se escribe al generar) + estilo
//            + <segment:yolo-face...> refuerzo_rostro   (solo en SwarmUI)
//
// Es la misma forma que ya tenian los prompts de Camila e Ines en SwarmUI:
// descripcion de la persona, ropa/escena, y al final el segmento que repinta
// la cara con la descripcion del rostro.
//
// La identidad va delante de la escena a proposito: lo primero del prompt
// pesa mas. Y la escena NO puede pisarla: si la ficha dice "pelo negro" y
// la escena pide "rubia", sale una mezcla. Para cambiar algo de la
// identidad se edita la ficha, no la escena.

import { buscarLora } from "./loras.js";

const CAMPOS_TEXTO = ["rostro", "cuerpo", "rasgos_fijos", "estilo", "refuerzo_rostro", "checkpoint", "tamano", "notas"];
const CAMPOS_NUMERO = { escala: 1, pasos: 40, cfg: 7, ancho: 1024, alto: 1024 };

// El detector de caras que usa SwarmUI para el segmento. Los numeros son
// los mismos que tenian los prompts originales (indice, umbral, creatividad).
const SEGMENTO_CARA = "<segment:yolo-face_yolov9c.pt-1,0.7,0.5>";

export async function registrarModelo(env, datos) {
  const nombre = String(datos.nombre || "").trim();
  if (!nombre) throw new Error("Falta el nombre de la modelo");
  const existente = await buscarModelo(env, nombre);

  // "lora": null la deja sin LoRA; no mandarlo deja el que tenia.
  let lora_id = existente?.lora_id ?? null;
  if (datos.lora === null) lora_id = null;
  else if (datos.lora) {
    const lora = await buscarLora(env, datos.lora);
    if (!lora) throw new Error(`No existe el LoRA "${datos.lora}": registralo primero con POST /loras`);
    lora_id = lora.id;
  }

  const fila = { id: existente?.id || crypto.randomUUID(), nombre, lora_id };
  for (const campo of CAMPOS_TEXTO) fila[campo] = String(datos[campo] ?? existente?.[campo] ?? "");
  for (const [campo, defecto] of Object.entries(CAMPOS_NUMERO)) {
    fila[campo] = Number(datos[campo] ?? existente?.[campo] ?? defecto);
  }
  if (!fila.tamano) fila.tamano = "portrait_4_3";
  // "semilla": null la suelta; no mandarla deja la que habia.
  fila.semilla = datos.semilla === undefined ? existente?.semilla ?? null
    : datos.semilla === null ? null : Number(datos.semilla);

  await env.DB.prepare(
    `INSERT INTO modelos (id, nombre, lora_id, escala, rostro, cuerpo, rasgos_fijos, estilo, refuerzo_rostro,
       checkpoint, pasos, cfg, ancho, alto, semilla, tamano, notas, creado)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
     ON CONFLICT(id) DO UPDATE SET nombre = ?2, lora_id = ?3, escala = ?4, rostro = ?5, cuerpo = ?6,
       rasgos_fijos = ?7, estilo = ?8, refuerzo_rostro = ?9, checkpoint = ?10, pasos = ?11, cfg = ?12,
       ancho = ?13, alto = ?14, semilla = ?15, tamano = ?16, notas = ?17`,
  )
    .bind(fila.id, fila.nombre, fila.lora_id, fila.escala, fila.rostro, fila.cuerpo, fila.rasgos_fijos,
      fila.estilo, fila.refuerzo_rostro, fila.checkpoint, fila.pasos, fila.cfg, fila.ancho, fila.alto,
      fila.semilla, fila.tamano, fila.notas, Date.now())
    .run();
  return buscarModelo(env, nombre);
}

const CON_LORA = `SELECT modelos.*, loras.nombre AS lora, loras.palabra_clave
  FROM modelos LEFT JOIN loras ON loras.id = modelos.lora_id`;

export function buscarModelo(env, nombre) {
  return env.DB.prepare(`${CON_LORA} WHERE modelos.nombre = ?1`).bind(nombre).first();
}

export async function listarModelos(env) {
  const { results } = await env.DB.prepare(`${CON_LORA} ORDER BY modelos.nombre`).all();
  return results;
}

// conSegmento: solo SwarmUI entiende <segment:...>; fal lo tomaria como texto.
export function armarPrompt(modelo, escena, { conSegmento = false, extras = [] } = {}) {
  const principal = [modelo.palabra_clave, modelo.rostro, modelo.cuerpo, modelo.rasgos_fijos, escena,
    ...extras, modelo.estilo]
    .map((parte) => String(parte || "").trim().replace(/[,.\s]+$/, ""))
    .filter(Boolean)
    .join(", ");
  const refuerzo = String(modelo.refuerzo_rostro || "").trim();
  return conSegmento && refuerzo ? `${principal} ${SEGMENTO_CARA} ${refuerzo}` : principal;
}
