// HABLARLE A GEMINI CON LA MISMA FORMA QUE SE LE HABLA A OPENAI.
//
// POR QUÉ EXISTE. Una foto en gpt-4o cuesta ~$0,060 y el 93% de eso es el
// modelo de visión. En Gemini 3.1 Flash-Lite la misma foto sale en ~$0,014:
// un 77% menos. Con un presupuesto de 10 a 20 dólares al mes, eso es pasar
// de 6 conversaciones al día a 15.
//
// EL DETALLE QUE CASI TUMBA LA IDEA, y conviene tenerlo escrito. El cotejo
// manda ocho fotos del catálogo en cada ronda, y en OpenAI van con
// detail:"low", que cuesta 85 tokens fijos cada una. GEMINI NO TIENE ESE
// CONTROL: cobra ~1.120 tokens por imagen, pase lo que pase. Trece veces
// más. Pero su token cuesta diez veces menos, así que la cuenta sigue
// ganando — por poco margen en el cotejo, y por goleada en identificar.
//
// De ahí sale una advertencia práctica: en Gemini, SUBIR el modelo no
// siempre abarata. Con 3.5 Flash la misma foto cuesta MÁS que en gpt-4o,
// porque el cargo por imagen se multiplica por un precio mayor.
//
// QUÉ HACE ESTE ARCHIVO. Traduce, y nada más. Recibe lo que ia.js ya arma
// para OpenAI y lo convierte a lo que espera Gemini:
//
//   system + user            →  systemInstruction + contents
//   {type:"image_url"}       →  {inlineData:{mimeType, data}}
//   json_schema (strict)     →  responseSchema
//   choices[0].message       →  candidates[0].content.parts
//   usage.prompt_tokens      →  usageMetadata.promptTokenCount
//
// Así el resto del bot —los prompts, identificar.js, el cotejo, gasto.js—
// no se entera de con quién está hablando.

import { comoDataUri } from "./imagen.js";

const API = "https://generativelanguage.googleapis.com/v1beta/models";

// El más barato y más rápido que sirve para esto. Se cambia desde
// wrangler.toml con GEMINI_MODELO.
//
// NO se pone 2.5 Flash-Lite aunque sea más barato: Google lo retira el
// 16-oct-2026 y dejaría al bot mudo de un día para otro.
const MODELO_POR_DEFECTO = "gemini-3.1-flash-lite";

export function modeloDeGemini(env) {
  return env.GEMINI_MODELO || MODELO_POR_DEFECTO;
}

// EL ESQUEMA DE OPENAI NO LE SIRVE A GEMINI TAL CUAL.
//
// Los dos piden JSON con una forma exacta, pero no escriben igual:
// "additionalProperties" no existe en Gemini y la llamada falla si va, y
// los tipos se escriben en mayúsculas. El resto —properties, required,
// items, enum— se llama igual.
//
// Se traduce en vez de mantener dos esquemas escritos a mano, que es la
// forma segura de que un día digan cosas distintas.
function traducirEsquema(nodo) {
  if (!nodo || typeof nodo !== "object") return nodo;

  const salida = {};

  for (const [clave, valor] of Object.entries(nodo)) {
    if (clave === "additionalProperties" || clave === "strict") continue;

    if (clave === "type") {
      salida.type = String(valor).toUpperCase();
      continue;
    }

    if (clave === "properties") {
      salida.properties = {};
      for (const [campo, def] of Object.entries(valor)) {
        salida.properties[campo] = traducirEsquema(def);
      }
      continue;
    }

    if (clave === "items") {
      salida.items = traducirEsquema(valor);
      continue;
    }

    salida[clave] = valor;
  }

  return salida;
}

// LAS IMÁGENES VAN DENTRO DE LA LLAMADA, EN BASE64.
//
// Gemini no sale a Internet a buscar una URL como sí hacía OpenAI. Casi
// todas las fotos ya llegan como data URI porque el Worker las baja —fue
// el arreglo del invalid_image_url— pero la indexación todavía pasa la URL
// de Shopify directa. Esa se baja acá, para que el que llama no tenga que
// saber con qué proveedor está hablando.
async function comoParteDeImagen(env, url) {
  const dataUri = url.startsWith("data:") ? url : await comoDataUri(env, url);
  if (!dataUri) return null;

  const coma = dataUri.indexOf(",");
  const cabecera = dataUri.slice(5, coma); // "image/jpeg;base64"
  const tipo = cabecera.split(";")[0] || "image/jpeg";

  return { inlineData: { mimeType: tipo, data: dataUri.slice(coma + 1) } };
}

// Convierte el "contenido" de OpenAI en las "parts" de Gemini, respetando
// el orden: en el cotejo, que la foto del cliente vaya ANTES de las del
// catálogo es justo lo que hace que la comparación funcione.
async function comoPartes(env, contenido) {
  const partes = [];

  for (const trozo of contenido) {
    if (trozo.type === "text") {
      partes.push({ text: trozo.text });
      continue;
    }

    if (trozo.type === "image_url") {
      // detail ("high"/"low") se pierde acá, y no es un descuido: Gemini no
      // tiene ese control. Ver la nota de arriba sobre lo que cuesta.
      const parte = await comoParteDeImagen(env, trozo.image_url?.url || "");
      if (parte) partes.push(parte);
      else console.error("Gemini: no pude convertir una imagen, sigo sin ella");
    }
  }

  return partes;
}

// Llama a Gemini y devuelve lo mismo que devolvería la de OpenAI: el texto
// de la respuesta, o null. El gasto se anota igual, con los números que
// Gemini informa de verdad.
export async function llamarGemini(
  env,
  sistema,
  contenido,
  { maxTokens = 1024, schema = null, modelo = "", alFallar = null, anotar = null } = {}
) {
  const cual = modelo || modeloDeGemini(env);

  if (!env.GEMINI_API_KEY) {
    console.error(
      "Falta GEMINI_API_KEY. Cárgala con: npx.cmd wrangler secret put GEMINI_API_KEY"
    );
    return null;
  }

  const partes = await comoPartes(env, contenido);
  if (!partes.length) {
    console.error("Gemini: no quedó nada que mandar");
    return null;
  }

  const cuerpo = {
    systemInstruction: { parts: [{ text: sistema }] },
    contents: [{ role: "user", parts: partes }],
    generationConfig: { maxOutputTokens: maxTokens },
  };

  // El equivalente de json_schema + strict. Sin esto, Gemini contesta en
  // prosa y extraerJson se queda sin nada que sacar.
  if (schema) {
    cuerpo.generationConfig.responseMimeType = "application/json";
    cuerpo.generationConfig.responseSchema = traducirEsquema(schema.schema || schema);
  }

  let respuesta;
  try {
    respuesta = await fetch(`${API}/${cual}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify(cuerpo),
    });
  } catch (error) {
    console.error("No se pudo llamar a Gemini:", error.message);
    return null;
  }

  if (!respuesta.ok) {
    const detalle = await respuesta.text();

    if (typeof alFallar === "function") {
      alFallar({
        estado: respuesta.status,
        // Con las imágenes ya convertidas a base64, Gemini no sale a bajar
        // nada: este fallo no puede ser de una foto que no se descargó.
        deImagen: false,
      });
    }

    console.error("Gemini respondió", respuesta.status, detalle.slice(0, 400));
    return null;
  }

  const datos = await respuesta.json();

  // El gasto se anota igual que con OpenAI, para que /estado sume los dos
  // sin saber de quién es cada línea.
  if (datos.usageMetadata && typeof anotar === "function") {
    await anotar({
      modelo: cual,
      entrada: datos.usageMetadata.promptTokenCount || 0,
      cacheadas: datos.usageMetadata.cachedContentTokenCount || 0,
      salida: datos.usageMetadata.candidatesTokenCount || 0,
    });
  }

  const salida = datos.candidates?.[0];

  // MAX_TOKENS significa que la respuesta se cortó a la mitad: el JSON
  // llega roto y es mejor decirlo que dejar que falle más adelante sin
  // motivo aparente.
  if (salida?.finishReason === "MAX_TOKENS") {
    console.error(`Gemini cortó la respuesta por el límite de ${maxTokens} tokens`);
  }

  return salida?.content?.parts?.map((p) => p.text || "").join("") || null;
}
