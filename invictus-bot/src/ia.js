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
import promptCotejo from "./prompts/cotejo.txt";
import { RASGOS_CLAVE } from "./identificar.js";

const API = "https://api.openai.com/v1/chat/completions";

// HASTA CUÁNDO NO VALE LA PENA VOLVER A PEDIRLE NADA AL MODELO DE VISIÓN.
//
// OpenAI limita los tokens por minuto de cada organización (TPM). Cuando
// se pasa, responde 429 — y seguir mandando llamadas que ya se sabe que
// van a fallar solo gasta tiempo del cliente, que está esperando.
//
// El barrido del catálogo (cotejo.js) es lo único que consulta esto: en
// cuanto ve que hay límite, deja de barrer y devuelve lo que tenga. Las
// llamadas imprescindibles —identificar la foto y redactar la respuesta—
// se intentan SIEMPRE, con límite o sin él: mejor un 429 en una de ellas
// que dejar al cliente sin respuesta por prudencia.
let limitadoHasta = 0;

export function estaLimitado() {
  return Date.now() < limitadoHasta;
}

// Del mensaje de OpenAI ("Please try again in 22.538s") sale cuánto
// esperar. Si no se puede leer, 30 segundos, que es la ventana del
// límite por minuto.
function anotarLimite(texto) {
  const segundos = Number(/try again in ([\d.]+)s/i.exec(texto || "")?.[1]);
  const espera = Number.isFinite(segundos) ? Math.ceil(segundos) * 1000 : 30000;
  limitadoHasta = Date.now() + espera;
  console.error(
    `OpenAI puso límite de tokens por minuto: no insisto por ${Math.round(espera / 1000)}s`
  );
}

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

// SCHEMA ESTRICTO PARA EL COTEJO VISUAL.
//
// Se elige por NÚMERO, no por título. Si se le pidiera devolver el
// nombre del producto, el modelo lo parafrasearía ("Nike Air Max 97
// plateadas" por "NIKE AIR MAX 97 SILVER BULLET") y después habría que
// adivinar a cuál se refería. Con un índice no hay nada que interpretar:
// o es uno de los que se le mandaron, o es 0.
const ESQUEMA_COTEJO = {
  name: "cotejo_catalogo",
  strict: true,
  schema: {
    type: "object",
    properties: {
      eleccion: { type: "integer" },
      confianza: { type: "string", enum: ["alta", "media", "baja"] },
      porque: { type: "string" },
    },
    required: ["eleccion", "confianza", "porque"],
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
    const detalle = await respuesta.text();

    // 429 = límite de tokens por minuto de la organización. No es un
    // fallo del código ni de la petición: es que no queda cupo en este
    // minuto. Se anota para que el barrido no siga machacando.
    if (respuesta.status === 429) {
      anotarLimite(detalle);
    } else {
      console.error("El modelo respondió", respuesta.status, detalle);
    }

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

// COTEJO VISUAL CONTRA EL CATÁLOGO.
//
// identificarEnImagen() le pone un NOMBRE al zapato, y ese nombre se
// busca por texto en Shopify. Si el nombre no acierta —el fallo
// recurrente de este bot: el Uplift saliendo como "Air Max 270"— no hay
// búsqueda que valga.
//
// Esto no adivina el nombre: le pone al modelo la foto del cliente al
// lado de las fotos reales del catálogo y le pregunta cuál es el mismo
// par. El acierto ya no depende de que sepa cómo se llama.
//
// Corre en OPENAI_MODELO_VISION, el mismo que identifica: es trabajo de
// mirar, no de redactar.
//
// Devuelve el producto elegido, o null si no hay ninguno con confianza
// alta. Cualquier fallo (el modelo no responde, un índice fuera de
// rango) devuelve null: esto es una mejora oportunista, nunca puede
// dejar peor al cliente de lo que estaba sin ella.
export async function cotejarConCatalogo(env, foto, candidatos, textoCliente) {
  if (!foto || !candidatos?.length) return null;

  const contenido = [
    // La foto del cliente en alta: es la que hay que leer al detalle, y
    // suele venir con filtros, lejos o con stickers encima.
    { type: "image_url", image_url: { url: foto, detail: "high" } },
    { type: "text", text: "↑ ESTA es la foto del cliente. Abajo, el catálogo:" },
  ];

  candidatos.forEach((producto, i) => {
    contenido.push({ type: "text", text: `${i + 1}. ${producto.titulo}` });
    // Las del catálogo en baja: son fotos de producto limpias, con el
    // zapato centrado y sobre fondo liso. La silueta y la suela se leen
    // igual de bien, y así una comparación contra 8 productos cuesta una
    // fracción de lo que costaría en alta.
    contenido.push({
      type: "image_url",
      image_url: { url: producto.imagen, detail: "low" },
    });
  });

  contenido.push({
    type: "text",
    text: `El cliente escribió: ${textoCliente ? `"${textoCliente}"` : "(nada, solo mandó la foto)"}`,
  });

  const salida = await llamar(env, promptCotejo, contenido, {
    maxTokens: 300,
    schema: ESQUEMA_COTEJO,
    modelo: env.OPENAI_MODELO_VISION || MODELO_VISION_POR_DEFECTO,
  });

  const datos = extraerJson(salida);
  if (!datos) {
    // Si fue el límite de tokens, ya se avisó arriba con el motivo real.
    // Repetir "no devolvió JSON válido" por cada lote solo llena el
    // registro de ruido y esconde la causa.
    if (!estaLimitado()) console.error("El cotejo visual no devolvió JSON válido");
    return null;
  }

  const indice = Number(datos.eleccion);
  const confianza = String(datos.confianza || "").toLowerCase();
  const porque = String(datos.porque || "").slice(0, 200);

  if (!indice) {
    console.log(`Cotejo visual: ninguno del catálogo es el de la foto (${porque})`);
    return null;
  }

  if (!Number.isInteger(indice) || indice < 1 || indice > candidatos.length) {
    console.error(`Cotejo visual: índice fuera de rango (${datos.eleccion})`);
    return null;
  }

  const elegido = candidatos[indice - 1];

  // SOLO "ALTA" LLEGA AL CLIENTE. Lo que sale de aquí se convierte en una
  // ficha con precio y botón de compra; con una corazonada no se manda.
  if (confianza !== "alta") {
    console.log(
      `Cotejo visual: "${elegido.titulo}" con confianza ${confianza} — no lo uso (${porque})`
    );
    return null;
  }

  console.log(`Cotejo visual: la foto es "${elegido.titulo}" (${porque})`);
  return elegido;
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
