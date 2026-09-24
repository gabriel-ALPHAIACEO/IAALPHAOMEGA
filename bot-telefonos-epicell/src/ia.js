// Llamadas al modelo de OpenAI: texto, e identificación de fotos.
//
// 22-sep-2026: se separó la visión en dos pasos (antes una sola llamada
// hacía dos trabajos a la vez: describir la foto Y redactar la respuesta
// para el cliente).
//
//   1. identificarEnImagen() SOLO mira la foto: describe lo que ve y
//      elige "buscar" + "pedirNombreExacto". No escribe nada para el
//      cliente. Puede correr en un modelo más fuerte (OPENAI_MODELO_VISION)
//      porque ya no tiene que además redactar una respuesta de venta.
//   2. Lo que identifica se le entrega a responderTexto() como un dato más
//      del contexto —igual que el nombre del cliente o el historial—, y es
//      ELLA quien decide qué decir y cómo seguir la conversación, con el
//      mismo tono que usa siempre. Ver marcarIdentificacion() en index.js.

import promptTexto from "./prompts/texto.txt";
import listaCatalogo from "./prompts/catalogo.txt";
import promptVision from "./prompts/vision.txt";

// La lista de nombres vive en un archivo aparte (prompts/catalogo.txt) y se
// pega dentro de texto.txt al arrancar, donde dice {{CATALOGO}}. Así hay UN
// solo sitio que actualizar cuando entra mercancía nueva.
//
// Se arma una vez por isolate, no en cada mensaje: es la misma cadena
// siempre y rearmarla por cliente no cambia nada salvo el gasto.
let promptTextoArmado = "";

// Lo que se le dice al modelo si el archivo está vacío. Es mejor que dejar
// el marcador crudo: "{{CATALOGO}}" en medio del prompt el modelo lo lee
// como si fuera un producto.
const SIN_CATALOGO = `(Todavía no está cargada la lista de nombres de la
tienda. Busca con lo que diga el cliente, tal cual: la hoja es la que
manda y la búsqueda funciona igual sin esta lista.)`;

function textoConCatalogo() {
  if (promptTextoArmado) return promptTextoArmado;

  // Fuera los comentarios del archivo: son para quien lo mantiene, no
  // para el modelo, y ocupan tokens en cada mensaje.
  const lista = listaCatalogo
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n")
    .trim();

  promptTextoArmado = promptTexto.replace("{{CATALOGO}}", lista || SIN_CATALOGO);
  return promptTextoArmado;
}

const API = "https://api.openai.com/v1/chat/completions";

// Se puede cambiar desde wrangler.toml sin tocar el código.
const MODELO_POR_DEFECTO = "gpt-4o-mini";

// La identificación corre en un modelo aparte, normalmente más fuerte que
// el de texto: ya no tiene que redactar nada, solo mirar bien la foto.
const MODELO_VISION_POR_DEFECTO = "gpt-4o";

// SCHEMA ESTRICTO PARA LA IDENTIFICACIÓN.
//
// Con "json_schema" + strict:true, OpenAI garantiza a nivel de API —no de
// prompt— que la respuesta trae EXACTAMENTE estas claves, con estos tipos.
// Es la diferencia entre pedirlo en el texto del prompt y que sea imposible
// que falte.
const ESQUEMA_IDENTIFICACION = {
  name: "identificacion_equipo",
  strict: true,
  schema: {
    type: "object",
    properties: {
      visto: { type: "string" },
      buscar: { type: "string" },
      // true = solo se reconoce la marca o familia, no el modelo exacto.
      // Con esto la IA de texto sabe si, además de mostrar la marca, tiene
      // que pedirle al cliente el modelo exacto en el mismo mensaje.
      pedirNombreExacto: { type: "boolean" },
    },
    required: ["visto", "buscar", "pedirNombreExacto"],
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
  // válido. Se usa nada más para la identificación; el texto sigue en modo
  // suelto porque su forma es simple.
  if (schema) {
    cuerpo.response_format = { type: "json_schema", json_schema: schema };
  } else if (json) {
    // Obliga a OpenAI a devolver un objeto JSON válido. Quita de raíz el
    // fallo de que el modelo envuelva la respuesta en ```json y el cliente
    // no reciba nada.
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
    const detalle = await respuesta.text();

    // 429 = se acabó el cupo de tokens por minuto de la cuenta de OpenAI.
    // No es un fallo del código ni de la petición, y conviene que se lea
    // distinto en el registro: un 429 se arregla esperando, un 401 se
    // arregla con la clave, y confundirlos cuesta media hora.
    //
    // El mensaje de OpenAI trae el cupo y lo gastado ("Limit 200000, Used
    // 199431"). Ese dato se deja a la vista: en Invictus diagnostiqué mal
    // un 429 dos veces por no leerlo, teniéndolo en el propio error.
    if (respuesta.status === 429) {
      const cupo = /Limit \d+[^.]*/i.exec(detalle)?.[0] || "";
      const segundos = /try again in ([\d.]+)s/i.exec(detalle)?.[1] || "";
      console.error(
        `OpenAI se quedó sin cupo por minuto (${cuerpo.model})` +
          (cupo ? ` · ${cupo}` : "") +
          (segundos ? ` · vuelve en ${Math.ceil(Number(segundos))}s` : "")
      );
    } else {
      console.error("El modelo respondió", respuesta.status, detalle);
    }

    return null;
  }

  const datos = await respuesta.json();
  return datos.choices?.[0]?.message?.content || null;
}

export async function responderTexto(env, entrada) {
  const salida = await llamar(env, textoConCatalogo(), [{ type: "text", text: entrada }]);
  return normalizar(salida);
}

// SOLO identifica: no redacta nada para el cliente. Devuelve
// { visto, buscar, pedirNombreExacto } o null si algo falló.
//
// "catalogo" es la misma lista de listaDeTitulos() (sheets.js) que ya
// recibe la IA de texto: sin ella, la IA de visión no sabría qué modelos
// existen de verdad y podría nombrar uno que la tienda no vende.
export async function identificarEnImagen(env, urlImagen, catalogo = "", { esPublicacion = false } = {}) {
  // UNA PUBLICACIÓN NUESTRA NO ES UNA FOTO DE UN CLIENTE.
  //
  // Es un montaje de publicidad, y casi siempre trae el nombre del equipo
  // ESCRITO encima, con su capacidad. Leerlo es infinitamente más seguro
  // que deducir el modelo por las cámaras, que es para lo que está hecho
  // el resto del prompt de visión.
  const encabezado = esPublicacion
    ? "Esta imagen es una PUBLICACIÓN DE NUESTRO PROPIO FEED que el cliente " +
      "compartió por el chat, no una foto suya.\n" +
      "Es un arte promocional: si el nombre del equipo está ESCRITO en la " +
      "imagen, léelo y ponlo en \"buscar\" tal cual, sin deducir nada por las " +
      "cámaras. Solo si no hay ningún nombre escrito, identifícalo mirando.\n\n" +
      "Identifica el equipo de esta publicación."
    : "Identifica el equipo de esta foto.";

  const texto = catalogo
    ? `${encabezado}\n\n` +
      "───────── CATÁLOGO ACTUAL DE LA TIENDA ─────────\n" +
      `${catalogo}\n` +
      "─────────────────────────────────────────────────"
    : encabezado;

  const salida = await llamar(
    env,
    promptVision,
    [
      // detail:"high" fuerza la resolución máxima que admite el modelo. En
      // fotos de producto —donde hay que contar cámaras o distinguir una
      // isla dinámica de una muesca— vale la pena pagar los tokens de más.
      { type: "image_url", image_url: { url: urlImagen, detail: "high" } },
      { type: "text", text: texto },
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

  return {
    visto: String(datos.visto || "").trim(),
    buscar: String(datos.buscar || "NADA").trim(),
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
