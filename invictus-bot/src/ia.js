// Llamadas al modelo de OpenAI: texto, e identificación de fotos.
//
// 22-sep-2026: se separó la visión en dos pasos (antes era una sola
// llamada que hacía dos trabajos a la vez).
//
//   1. identificarEnImagen() SOLO mira la foto: rasgos + "buscar" +
//      "pedirNombreExacto". No escribe nada para el cliente. Puede correr
//      en un modelo más fuerte (OPENAI_MODELO_VISION) porque ya no tiene
//      que además redactar una respuesta de venta.
//   2. Lo que identifica —ya corregido por identificar.js— se le entrega
//      a responderTexto() como un dato más del contexto, igual que el
//      nombre del cliente o el historial. Es ELLA quien decide qué decir
//      y cómo seguir la conversación, con el mismo tono que usa siempre.
//
// Antes de esto, una sola llamada de visión describía Y redactaba, y esas
// dos cosas competían por la atención del modelo. Separarlas deja que cada
// IA se concentre en lo suyo: una en mirar bien, la otra en vender bien.

import promptTexto from "./prompts/texto.txt";
import promptVision from "./prompts/vision.txt";
import { RASGOS_CLAVE } from "./identificar.js";

const API = "https://api.openai.com/v1/chat/completions";

// Se puede cambiar desde wrangler.toml sin tocar el código.
const MODELO_POR_DEFECTO = "gpt-4o-mini";

// La identificación corre en un modelo aparte, normalmente más fuerte que
// el de texto: ya no tiene que redactar nada, solo mirar bien la foto.
const MODELO_VISION_POR_DEFECTO = "gpt-4o";

// SCHEMA ESTRICTO PARA LA IDENTIFICACIÓN (crítico).
//
// Con "json_schema" + strict:true, OpenAI garantiza a nivel de API —no de
// prompt— que la respuesta trae EXACTAMENTE estas claves, con estos
// tipos. Es la diferencia entre pedirlo en el texto del prompt y que sea
// imposible que falte. Sin esto, "rasgos" se podía quedar afuera o venir
// incompleto sin que nada lo avisara, y sin "rasgos" identificar.js no
// tiene nada que verificar.
const ESQUEMA_IDENTIFICACION = {
  name: "identificacion_calzado",
  strict: true,
  schema: {
    type: "object",
    properties: {
      visto: { type: "string" },
      rasgos: {
        type: "object",
        properties: Object.fromEntries(
          RASGOS_CLAVE.map((clave) => [clave, { type: "boolean" }])
        ),
        required: RASGOS_CLAVE,
        additionalProperties: false,
      },
      buscar: { type: "string" },
      // true = solo se reconoce la marca o familia, no el modelo exacto.
      // Con esto la IA de texto sabe si, además de mostrar la marca, tiene
      // que pedirle al cliente el nombre exacto en el mismo mensaje.
      pedirNombreExacto: { type: "boolean" },
    },
    required: ["visto", "rasgos", "buscar", "pedirNombreExacto"],
    additionalProperties: false,
  },
};

async function llamar(
  env,
  sistema,
  contenido,
  { maxTokens = 1024, json = true, schema = null, modelo = "" } = {}
) {
  const cuerpo = {
    model: modelo || env.OPENAI_MODELO || MODELO_POR_DEFECTO,
    max_completion_tokens: maxTokens,
    messages: [
      { role: "system", content: sistema },
      { role: "user", content: contenido },
    ],
  };

  // "schema" (json_schema + strict) manda sobre "json" (json_object) — es
  // la versión que además obliga la FORMA exacta, no solo que sea JSON
  // válido. Se usa nada más para la identificación; el texto sigue en
  // modo suelto porque su forma es simple y no depende de que el modelo
  // "recuerde" incluir un objeto anidado grande.
  if (schema) {
    cuerpo.response_format = { type: "json_schema", json_schema: schema };
  } else if (json) {
    // Obliga a OpenAI a devolver un objeto JSON válido. Quita de raíz el
    // fallo de que el modelo envuelva la respuesta en ```json y el
    // cliente no reciba nada.
    cuerpo.response_format = { type: "json_object" };
  }

  let respuesta;
  try {
    respuesta = await fetch(API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(cuerpo),
    });
  } catch (error) {
    console.error("No se pudo llamar al modelo:", error.message);
    return null;
  }

  if (!respuesta.ok) {
    console.error("El modelo respondió", respuesta.status, await respuesta.text());
    return null;
  }

  const datos = await respuesta.json();
  return datos.choices?.[0]?.message?.content || null;
}

export async function responderTexto(env, entrada) {
  const salida = await llamar(env, promptTexto, [{ type: "text", text: entrada }]);
  return normalizar(salida);
}

// SOLO identifica: no redacta nada para el cliente. Devuelve
// { visto, rasgos, buscar, pedirNombreExacto } o null si algo falló.
export async function identificarEnImagen(env, urlImagen) {
  const salida = await llamar(
    env,
    promptVision,
    [
      // detail:"high" fuerza la resolución máxima que admite el modelo. Sin
      // esto, OpenAI decide solo ("auto") y en fotos de producto —donde hay
      // que distinguir el dibujo de una suela o los ojales de los
      // cordones— vale la pena pagar los tokens de más para no perder el
      // detalle fino.
      { type: "image_url", image_url: { url: urlImagen, detail: "high" } },
      { type: "text", text: "Identifica el calzado de esta foto." },
    ],
    {
      schema: ESQUEMA_IDENTIFICACION,
      modelo: env.OPENAI_MODELO_VISION || MODELO_VISION_POR_DEFECTO,
    }
  );

  const datos = extraerJson(salida);
  if (!datos) {
    if (salida) console.error("La IA de visión no devolvió JSON válido:", salida.slice(0, 300));
    return null;
  }

  // Con json_schema + strict esto NO debería pasar nunca — es justo lo
  // que ese modo evita. Si sale en wrangler tail, algo más grave está
  // fallando (OpenAI ignorando el schema, un cambio de modelo, etc.) y la
  // red de seguridad de identificar.js se está quedando ciega otra vez.
  if (!datos.rasgos || typeof datos.rasgos !== "object") {
    console.error(
      'ALERTA: la identificación no trajo "rasgos" pese al schema estricto. ' +
        "identificar.js no puede verificar nada en este mensaje."
    );
  }

  return {
    visto: String(datos.visto || "").trim(),
    buscar: String(datos.buscar || "NADA").trim(),
    rasgos: datos.rasgos && typeof datos.rasgos === "object" ? datos.rasgos : null,
    pedirNombreExacto: Boolean(datos.pedirNombreExacto),
  };
}

// Con response_format el JSON ya viene limpio, pero si algún día se cambia de
// modelo y deja de respetarlo, rescatamos lo que haya entre la primera { y la
// última } antes de rendirnos.
function extraerJson(texto) {
  if (!texto) return null;
  try {
    return JSON.parse(texto);
  } catch {
    const inicio = texto.indexOf("{");
    const fin = texto.lastIndexOf("}");
    if (inicio === -1 || fin <= inicio) return null;
    try {
      return JSON.parse(texto.slice(inicio, fin + 1));
    } catch {
      return null;
    }
  }
}

function normalizar(salida) {
  const datos = extraerJson(salida);
  if (!datos) {
    if (salida) console.error("El modelo no devolvió JSON válido:", salida.slice(0, 300));
    return null;
  }

  const respuesta = String(datos.respuesta || "").trim();
  if (!respuesta) return null; // sin texto no hay nada que mandarle al cliente

  return {
    respuesta,
    buscar: String(datos.buscar || "NADA").trim(),
    historial: String(datos.historial || "").trim(),
  };
}
