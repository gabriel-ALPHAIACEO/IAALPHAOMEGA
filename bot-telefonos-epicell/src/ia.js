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

// Lo que va donde antes iba la lista fija.
const LA_LISTA_ES_LA_DEL_MENSAJE = `(La lista de lo que hay HOY te llega
en cada mensaje, en el bloque "CATÁLOGO ACTUAL DE LA TIENDA". Esa es la
única que vale: lo que no esté ahí no está disponible ahora, aunque lo
hayas visto en otro mensaje.)`;

// LOS HORARIOS: UN DATO QUE EL MODELO NO PUEDE SABER (26-sep-2026).
//
// EL FALLO QUE ESTO ARREGLA. En el prompt había escrito, tal cual:
//
//   Horarios: {{TUS HORARIOS}}
//
// Un marcador de la plantilla que nadie rellenó. El modelo lo leía como si
// fuera el horario de la tienda, y a quien preguntaba "¿a qué hora abren?"
// le contestaba con esas llaves — o, peor, se inventaba un horario, que es
// lo que hace un modelo cuando le falta un dato y nadie le dijo qué hacer.
// Un horario inventado es un cliente en la puerta de un local cerrado.
//
// Ahora el horario se pone en wrangler.toml (HORARIOS) y entra aquí. Y si
// está vacío, no queda ningún hueco: entra una frase que manda la pregunta
// al asesor, que es la verdad mientras no haya horario cargado.
const SIN_HORARIOS =
  "NO SABES el horario de la tienda (no está cargado). Si lo preguntan, " +
  "dile que se lo confirma un asesor en un momento. NUNCA te inventes una " +
  "hora ni un día";

// LAS FORMAS DE PAGO, IGUAL QUE EL HORARIO (29-sep-2026).
//
// Si preguntan SOLO eso, contesta el código con METODOS_PAGO tal cual (ver
// datos.js). Pero "¿el A57 lo puedo pagar con Zelle?" nombra un equipo y
// va por el modelo: ahí el modelo tiene que saber cuáles son, o se los
// inventa. Entra la misma lista, y si no está cargada, que no la sabe.
const SIN_METODOS_PAGO =
  "NO SABES las formas de pago (no están cargadas). Si las preguntan, " +
  "dile que se las confirma un asesor. NUNCA digas que aceptas una";

// El prompt armado y los datos con los que se armó: si cambian (un
// despliegue nuevo), hay que volver a armarlo.
let horariosArmados = null;

function textoConCatalogo(env) {
  const horarios = String(env?.HORARIOS || "").trim();
  const metodosPago = String(env?.METODOS_PAGO || "").replace(/\\n/g, "\n").trim();
  const llave = `${horarios}\u0000${metodosPago}`;

  if (promptTextoArmado && horariosArmados === llave) return promptTextoArmado;

  // Fuera los comentarios del archivo: son para quien lo mantiene, no
  // para el modelo, y ocupan tokens en cada mensaje.
  const lista = listaCatalogo
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n")
    .trim();

  // EL CATÁLOGO FIJO YA NO ENTRA EN EL PROMPT (29-sep-2026).
  //
  // Aquí se pegaba catalogo.txt: una lista escrita a mano con TODOS los
  // nombres, agotados incluidos. Y en cada mensaje llega además la lista
  // EN VIVO de la hoja (ver listaDeTitulos), sin los que tienen Cantidad
  // 0. El modelo veía las dos: el Redmi 17 en una y no en la otra. Con
  // eso delante, un modelo pequeño ofrece lo que se agotó — que es justo
  // lo que pasó en producción.
  //
  // La lista en vivo es la única que dice la verdad, y ya va en cada
  // mensaje. La fija sobraba: eran mil tokens de datos que podían estar
  // viejos. catalogo.txt se queda en el proyecto porque comprobar-prompt.py
  // la usa para vigilar que los ejemplos del prompt hablen de productos
  // reales.
  void lista;
  promptTextoArmado = promptTexto
    .replace("{{CATALOGO}}", LA_LISTA_ES_LA_DEL_MENSAJE)
    .replaceAll("{{TUS HORARIOS}}", horarios || SIN_HORARIOS)
    .replaceAll("{{METODOS DE PAGO}}", metodosPago || SIN_METODOS_PAGO);

  horariosArmados = llave;

  if (!horarios) {
    console.log(
      "HORARIOS sin poner en wrangler.toml: el bot manda esa pregunta al " +
        "asesor en vez de inventarse una hora."
    );
  }

  return promptTextoArmado;
}

const API = "https://api.openai.com/v1/chat/completions";

// Ver llamar(): baja = se ciñe a lo que tiene delante.
const TEMPERATURA_POR_DEFECTO = 0.3;

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
  const elModelo = modelo || env.OPENAI_MODELO || MODELO_POR_DEFECTO;

  const cuerpo = {
    model: elModelo,
    max_completion_tokens: maxTokens,
    messages: [
      { role: "system", content: sistema },
      { role: "user", content: contenido },
    ],
  };

  // LA TEMPERATURA (29-sep-2026).
  //
  // No se mandaba, y entonces OpenAI usa 1.0: el modo más "creativo" que
  // tiene. Para escribir un cuento está bien; para un vendedor que tiene
  // que decir lo que hay y nada más, es invitarlo a improvisar. De ahí
  // salen las respuestas raras que no vienen de ningún sitio —"no tengo
  // langostas"—: el modelo rellenando con lo primero que se le ocurre.
  //
  // Con 0.3 sigue sonando natural y variado, pero se ciñe a lo que tiene
  // delante. Se puede cambiar en wrangler.toml (OPENAI_TEMPERATURA).
  //
  // Solo a los modelos gpt-4 y gpt-3: los de razonamiento (o1, o3, gpt-5)
  // rechazan el parámetro, y mandárselo tumbaría la llamada.
  if (/^gpt-(4|3)/i.test(elModelo)) {
    const pedida = Number(env.OPENAI_TEMPERATURA);
    cuerpo.temperature = Number.isFinite(pedida) && env.OPENAI_TEMPERATURA !== undefined && env.OPENAI_TEMPERATURA !== ""
      ? pedida
      : TEMPERATURA_POR_DEFECTO;
  }

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
  const salida = await llamar(env, textoConCatalogo(env), [{ type: "text", text: entrada }]);
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
