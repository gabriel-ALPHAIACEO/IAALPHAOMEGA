// Llamadas al modelo de OpenAI. Dos prompts: uno para texto y otro para fotos.

import promptTexto from "./prompts/texto.txt";
import promptVision from "./prompts/vision.txt";

const API = "https://api.openai.com/v1/chat/completions";

// Se puede cambiar desde wrangler.toml sin tocar el código.
const MODELO_POR_DEFECTO = "gpt-4o-mini";

async function llamar(env, sistema, contenido, { maxTokens = 1024, json = true } = {}) {
  const cuerpo = {
    model: env.OPENAI_MODELO || MODELO_POR_DEFECTO,
    max_completion_tokens: maxTokens,
    messages: [
      { role: "system", content: sistema },
      { role: "user", content: contenido },
    ],
  };

  // Obliga a OpenAI a devolver un objeto JSON válido. Quita de raíz el fallo
  // de que el modelo envuelva la respuesta en ```json y el cliente no reciba
  // nada. Solo funciona porque el prompt dice explícitamente que es JSON.
  if (json) cuerpo.response_format = { type: "json_object" };

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

export async function responderImagen(env, urlImagen, entrada) {
  const salida = await llamar(env, promptVision, [
    // detail:"high" fuerza la resolución máxima que admite el modelo. Sin
    // esto, OpenAI decide solo ("auto") y en fotos de producto —donde hay
    // que distinguir el dibujo de una suela o los ojales de los cordones—
    // vale la pena pagar los tokens de más para no perder el detalle fino.
    { type: "image_url", image_url: { url: urlImagen, detail: "high" } },
    { type: "text", text: entrada },
  ]);
  return normalizar(salida);
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
