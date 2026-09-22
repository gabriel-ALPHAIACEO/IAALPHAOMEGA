// Llamadas al modelo de OpenAI. Dos prompts: uno para texto y otro para fotos.

import promptTexto from "./prompts/texto.txt";
import promptVision from "./prompts/vision.txt";
import { RASGOS_CLAVE } from "./identificar.js";
import { tiendaDe, rellenar } from "./tienda.js";

// Los prompts vienen con marcadores ({{TIENDA}}, {{CATALOGO}}...) y aquí se
// rellenan con los datos de la tienda que atiende este Worker.
//
// SE GUARDA EL RESULTADO. Son mil líneas de texto y el reemplazo daría
// igual en cada mensaje, porque la tienda no cambia mientras el Worker
// viva. Se hace una vez por arranque y ya.
const armados = new Map();

function prompt(env, plantilla, clave) {
  const tienda = tiendaDe(env);
  const cache = `${tienda.nombre}:${clave}`;

  if (!armados.has(cache)) {
    armados.set(cache, rellenar(plantilla, tienda));
    console.log(`Prompt "${clave}" armado para ${tienda.nombre}`);
  }

  return armados.get(cache);
}

const API = "https://api.openai.com/v1/chat/completions";

// Se puede cambiar desde wrangler.toml sin tocar el código.
const MODELO_POR_DEFECTO = "gpt-4o-mini";

// SCHEMA ESTRICTO PARA LA VISIÓN (crítico).
//
// Antes esto solo se le PEDÍA al modelo en el texto del prompt ("rasgos"
// va con estas 15 claves...). El problema: con "response_format:
// json_object" (modo suelto) OpenAI solo garantiza que el JSON sea
// válido, no que traiga las claves que el prompt pide. Con un prompt tan
// largo, "rasgos" se podía quedar afuera o venir incompleto sin que nada
// lo avisara — y sin "rasgos", identificar.js no tiene nada que
// verificar y deja pasar lo que sea que haya dicho "buscar", exactamente
// como si la capa de código no existiera.
//
// Con "json_schema" + strict:true, OpenAI garantiza a nivel de API —no de
// prompt— que la respuesta trae EXACTAMENTE estas claves, con estos
// tipos. Es la diferencia entre pedirlo y que sea imposible que falte.
const ESQUEMA_VISION = {
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
      respuesta: { type: "string" },
      buscar: { type: "string" },
      historial: { type: "string" },
    },
    required: ["visto", "rasgos", "respuesta", "buscar", "historial"],
    additionalProperties: false,
  },
};

async function llamar(env, sistema, contenido, { maxTokens = 1024, json = true, schema = null } = {}) {
  const cuerpo = {
    model: env.OPENAI_MODELO || MODELO_POR_DEFECTO,
    max_completion_tokens: maxTokens,
    messages: [
      { role: "system", content: sistema },
      { role: "user", content: contenido },
    ],
  };

  // "schema" (json_schema + strict) manda sobre "json" (json_object) — es
  // la versión que además obliga la FORMA exacta, no solo que sea JSON
  // válido. Se usa nada más para la visión; el texto sigue en modo suelto
  // porque su forma es simple y no depende de que el modelo "recuerde"
  // incluir un objeto anidado grande.
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
  const salida = await llamar(env, prompt(env, promptTexto, "texto"), [{ type: "text", text: entrada }]);
  return normalizar(salida);
}

export async function responderImagen(env, urlImagen, entrada) {
  const salida = await llamar(
    env,
    prompt(env, promptVision, "vision"),
    [
      // detail:"high" fuerza la resolución máxima que admite el modelo. Sin
      // esto, OpenAI decide solo ("auto") y en fotos de producto —donde hay
      // que distinguir el dibujo de una suela o los ojales de los cordones—
      // vale la pena pagar los tokens de más para no perder el detalle fino.
      { type: "image_url", image_url: { url: urlImagen, detail: "high" } },
      { type: "text", text: entrada },
    ],
    // schema, no json: esta es la llamada que identificar.js necesita
    // verificar, así que "rasgos" tiene que venir garantizado.
    { schema: ESQUEMA_VISION }
  );
  const resultado = normalizar(salida);

  // Con json_schema + strict esto NO debería pasar nunca — es justo lo
  // que ese modo evita. Si sale en `wrangler tail`, algo más grave está
  // fallando (OpenAI ignorando el schema, un cambio de modelo, etc.) y la
  // red de seguridad de identificar.js se está quedando ciega otra vez.
  if (resultado && !resultado.rasgos) {
    console.error(
      "ALERTA: la respuesta de visión no trajo \"rasgos\" pese al schema " +
        "estricto. identificar.js no puede verificar nada en este mensaje."
    );
  }

  return resultado;
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
    // Solo lo manda el prompt de visión. Sin esto, identificar.js no
    // tiene con qué verificar y deja pasar "buscar" tal cual llegó.
    rasgos: datos.rasgos && typeof datos.rasgos === "object" ? datos.rasgos : null,
  };
}
