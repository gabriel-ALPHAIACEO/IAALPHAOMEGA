// HABLARLE A DEEPSEEK (1-oct-2026).
//
// POR QUÉ. DeepSeek es el que aceptó la tarjeta del dueño.
// El Emperador pasa a DeepSeek para TODO: el texto y las fotos.
//
// DeepSeek habla casi igual que OpenAI (mismo /chat/completions, mismos
// mensajes, mismas partes "image_url"), así que este archivo traduce poco:
//
//   · La URL y la clave:   api.deepseek.com, DEEPSEEK_API_KEY.
//   · El "pensar":         DeepSeek PIENSA por defecto antes de contestar.
//                          Eso tarda y se cobra. Para un vendedor por chat
//                          no hace falta, así que se apaga (ver abajo).
//   · El JSON:             DeepSeek tiene modo JSON pero no "json_schema"
//                          estricto. La forma exacta se le escribe en el
//                          prompt de sistema, y extraerJson/normalizar de
//                          ia.js ya revisan lo que vuelva.
//   · Las fotos:           se mandan dentro de la llamada (data URI). El
//                          Worker las baja; así DeepSeek no tiene que salir
//                          a buscar una foto de Instagram o de Drive que
//                          desde sus servidores quizá no pueda abrir.
//
// LOS DOS MODELOS (dueño, 1-oct: "uno para texto y otro
// para imagen"):
//   DEEPSEEK_MODELO          el que REDACTA   deepseek-v4-pro (el más capaz)
//   DEEPSEEK_MODELO_VISION   el que MIRA      deepseek-flash  (el único de
//                                             DeepSeek que ve fotos)
// El índice del catálogo va con el de las fotos.

import { comoDataUri } from "./imagen.js";

const API = "https://api.deepseek.com/chat/completions";

const MODELO_POR_DEFECTO = "deepseek-v4-pro";
const MODELO_VISION_POR_DEFECTO = "deepseek-flash";

export function modeloDeDeepSeek(env, tarea = "texto") {
  if (tarea === "vision") return env.DEEPSEEK_MODELO_VISION || MODELO_VISION_POR_DEFECTO;
  if (tarea === "indice") return env.DEEPSEEK_MODELO_INDICE || env.DEEPSEEK_MODELO_VISION || MODELO_VISION_POR_DEFECTO;
  return env.DEEPSEEK_MODELO || MODELO_POR_DEFECTO;
}

// APAGAR EL "PENSAR". La documentación lo ofrece de dos formas; se prueba la
// primera y, si DeepSeek la rechaza por no conocerla, la siguiente. La que
// funcione se recuerda para no volver a fallar en cada mensaje.
const SIN_PENSAR = [{ thinking: { type: "disabled" } }, { reasoning_effort: "none" }, {}];
let comoNoPensar = 0;

// Las fotos, dentro de la llamada, EN ORDEN (en el cotejo la del cliente va
// primero). Si todo es texto, va como texto simple.
async function comoContenido(env, contenido) {
  const partes = [];
  for (const trozo of contenido) {
    if (trozo.type !== "image_url") {
      partes.push(trozo);
      continue;
    }
    const url = trozo.image_url?.url || "";
    // comoDataUri devuelve { uri, motivo }; las del catálogo, sin llenar el registro.
    const dataUri = url.startsWith("data:") ? url : (await comoDataUri(env, url, { silencioso: true })).uri;
    if (!dataUri) {
      console.error("DeepSeek: no pude bajar una imagen, sigo sin ella");
      continue;
    }
    partes.push({
      type: "image_url",
      image_url: { url: dataUri, ...(trozo.image_url?.detail ? { detail: trozo.image_url.detail } : {}) },
    });
  }
  if (partes.every((p) => p.type === "text")) return partes.map((p) => p.text).join("\n\n");
  return partes;
}

function conFormaJson(sistema, schema, json) {
  if (schema) {
    return (
      `${sistema}\n\nFORMATO DE SALIDA: responde SOLO con un objeto JSON válido, sin nada antes ni ` +
      `después, que cumpla exactamente este esquema (JSON Schema):\n${JSON.stringify(schema.schema || schema)}`
    );
  }
  // El modo JSON de DeepSeek exige que la palabra "json" esté en el prompt.
  if (json && !/json/i.test(sistema)) return `${sistema}\n\nResponde SOLO con un objeto JSON válido.`;
  return sistema;
}

// Lo que dice DeepSeek, en palabras que el dueño pueda arreglar.
export function explicarFalloDeDeepSeek(estado, detalle = "") {
  if (estado === 401 || /authentication|api key/i.test(detalle)) {
    return "la clave de DeepSeek no es válida. Cárgala de nuevo: npx.cmd wrangler secret put DEEPSEEK_API_KEY";
  }
  if (estado === 402 || /insufficient balance/i.test(detalle)) {
    return "la cuenta de DeepSeek no tiene saldo. Recarga en platform.deepseek.com → Top up.";
  }
  if (estado === 429) return "DeepSeek pidió ir más despacio (demasiadas llamadas a la vez).";
  if (estado >= 500) return `DeepSeek está caído u ocupado (${estado}). Suele volver solo en minutos.`;
  return `DeepSeek respondió ${estado}: ${String(detalle).slice(0, 300)}`;
}

// Llama a DeepSeek y devuelve lo mismo que la de OpenAI: el texto de la
// respuesta, o null. El gasto se anota con los números que da DeepSeek.
export async function llamarDeepSeek(
  env,
  sistema,
  contenido,
  { maxTokens = 1024, schema = null, json = true, modelo = "", alFallar = null, anotar = null, alLimite = null } = {}
) {
  const cual = modelo || modeloDeDeepSeek(env);

  if (!env.DEEPSEEK_API_KEY) {
    console.error("Falta DEEPSEEK_API_KEY. Cárgala con: npx.cmd wrangler secret put DEEPSEEK_API_KEY");
    return null;
  }

  const base = {
    model: cual,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: conFormaJson(sistema, schema, json) },
      { role: "user", content: await comoContenido(env, contenido) },
    ],
  };
  if (schema || json) base.response_format = { type: "json_object" };

  let respuesta, detalle = "";
  for (let i = comoNoPensar; i < SIN_PENSAR.length; i++) {
    try {
      respuesta = await fetch(API, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
        body: JSON.stringify({ ...base, ...SIN_PENSAR[i] }),
      });
    } catch (error) {
      console.error("No se pudo llamar a DeepSeek:", error.message);
      return null;
    }
    if (respuesta.ok) {
      comoNoPensar = i;
      break;
    }
    detalle = await respuesta.text();
    // Rechazó la forma de apagar el "pensar": se prueba la siguiente.
    if (respuesta.status === 400 && /thinking|reasoning/i.test(detalle) && i + 1 < SIN_PENSAR.length) continue;
    break;
  }

  if (!respuesta.ok) {
    if (typeof alFallar === "function") alFallar({ estado: respuesta.status, deImagen: false });
    if (respuesta.status === 429 && typeof alLimite === "function") alLimite(cual, detalle);
    console.error("DeepSeek:", explicarFalloDeDeepSeek(respuesta.status, detalle));
    return null;
  }

  const datos = await respuesta.json();

  if (datos.usage && typeof anotar === "function") {
    await anotar({
      modelo: cual,
      entrada: datos.usage.prompt_tokens || 0,
      cacheadas: datos.usage.prompt_cache_hit_tokens || datos.usage.prompt_tokens_details?.cached_tokens || 0,
      salida: datos.usage.completion_tokens || 0,
    });
  }

  const eleccion = datos.choices?.[0];
  if (eleccion?.finish_reason === "length") {
    console.error(`DeepSeek cortó la respuesta por el límite de ${maxTokens} tokens`);
  }
  return eleccion?.message?.content || null;
}

// Solo para las pruebas.
export function olvidarComoNoPensar() {
  comoNoPensar = 0;
}
