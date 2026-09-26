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
import listaCatalogo from "./prompts/catalogo.txt";
import listaModelos from "./prompts/modelos.txt";
import promptIndexar from "./prompts/indexar.txt";
import { RASGOS_CLAVE } from "./identificar.js";
import { urlPequena } from "./shopify.js";
import { comoDataUri } from "./imagen.js";

// EL CATÁLOGO SE PEGA AL PROMPT AL ARRANCAR, NO EN CADA MENSAJE.
//
// La lista de títulos vive en un archivo aparte (prompts/catalogo.txt)
// porque estaba copiada DOS veces —dentro de texto.txt y dentro de
// vision.txt—, con 315 de 317 títulos idénticos. Dos listas para
// mantener a mano y ninguna forma de saber cuál estaba vieja.
//
// El reemplazo se hace UNA vez y se guarda: son 9 KB y el resultado sería
// idéntico en cada mensaje, porque el catálogo no cambia mientras el
// Worker viva.
let promptTextoArmado = "";

// Lo que se le dice al modelo cuando catalogo.txt está vacío.
const SIN_CATALOGO = `(Todavía no está cargada la lista de productos de esta tienda.

Eso significa que NO SABES qué modelos existen aquí. No supongas que hay
algo por ser una marca conocida, y no nombres modelos concretos que no te
haya dicho el cliente: usa sus palabras exactas y deja que el catálogo
responda. Si existe, aparece.)`;

const SIN_MODELOS = `(Todavía no está cargada la lista de modelos de esta tienda.
Identifica por lo que VES y quédate en la marca si no estás seguro.)`;

function textoConCatalogo() {
  if (!promptTextoArmado) {
    // Las líneas que empiezan con # son notas para quien mantiene el
    // archivo, no para el modelo.
    const lista = listaCatalogo
      .split("\n")
      .filter((linea) => !linea.trimStart().startsWith("#"))
      .join("\n")
      .trim();

    // UNA TIENDA SIN CATÁLOGO TODAVÍA NO SE ROMPE. Es el caso de una
    // tienda recién montada: el bot conversa y vende igual, solo busca
    // peor, y lo que NO puede hacer es inventarse nombres de modelos.
    if (!lista) {
      promptTextoArmado = promptTexto.replace("{{CATALOGO}}", SIN_CATALOGO);
      console.log("Sin catálogo cargado: el modelo usará las palabras del cliente");
    } else {
      promptTextoArmado = promptTexto.replace("{{CATALOGO}}", lista);
      console.log(
        `Catálogo pegado al prompt: ${lista.split("\n").filter(Boolean).length} títulos`
      );
    }
  }

  return promptTextoArmado;
}

// LA VISIÓN TAMBIÉN NECESITA SABER QUÉ EXISTE, PERO NO LA LISTA ENTERA.
//
// El 22-sep se le quitaron al prompt de visión los 347 títulos porque
// costaban ~3.100 tokens en CADA foto, contra el cupo de 30.000 por
// minuto de OpenAI — el mismo del que vive el cotejo visual. El recorte
// estaba bien, pero dejó al modelo sin saber qué se vende aquí, justo
// mientras el prompt le exige escribir "buscar" como aparece en los
// títulos.
//
// prompts/modelos.txt es el término medio: los modelos sin género ni
// color, ~640 tokens. Que hay 17 "New Balance 9060" por color no le hace
// falta saberlo; de elegir el color se encarga el cotejo, que mira la foto.
let promptVisionArmado = "";

function visionConModelos() {
  if (!promptVisionArmado) {
    const lista = listaModelos
      .split("\n")
      .filter((linea) => !linea.trimStart().startsWith("#"))
      .join("\n")
      .trim();

    // Sin lista, el prompt sigue sirviendo: se queda con sus firmas
    // visuales y su tabla de términos. Es el estado de una tienda recién
    // montada, igual que con el catálogo.
    if (!lista) {
      promptVisionArmado = promptVision.replace("{{MODELOS}}", SIN_MODELOS);
      console.log("Sin lista de modelos: la visión irá solo con sus firmas visuales");
    } else {
      promptVisionArmado = promptVision.replace("{{MODELOS}}", lista);
      console.log(
        `Modelos pegados al prompt de visión: ${lista.split("\n").filter(Boolean).length}`
      );
    }
  }

  return promptVisionArmado;
}

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
// Se puede cambiar desde wrangler.toml sin tocar el código.
const MODELO_POR_DEFECTO = "gpt-4o-mini";

// La identificación corre en un modelo aparte, normalmente más fuerte que
// el de texto: ya no tiene que redactar nada, solo mirar bien la foto.
const MODELO_VISION_POR_DEFECTO = "gpt-4o";

// Con el que se indexa el catálogo. Son cientos de fotos, así que va el
// mini: su cupo por minuto es mucho más alto y para una foto de producto
// limpia, sobre fondo liso, alcanza de sobra.
const MODELO_INDICE_POR_DEFECTO = "gpt-4o-mini";

// EL LÍMITE ES DE CADA MODELO, NO DE LA CUENTA ENTERA.
//
// Esto empezó siendo un solo número y estaba mal: OpenAI da un cupo por
// minuto A CADA MODELO por separado. gpt-4o anda justo (30.000 tokens) y
// gpt-4o-mini tiene muchísimo más. Con un número compartido, un 429 del
// modelo grande apagaba también la indexación, que corre con el mini y
// tenía cupo de sobra — y la indexación terminaba guardando CERO
// productos sin que se entendiera por qué.
const limitados = new Map();

export function estaLimitado(modelo) {
  return Date.now() < (limitados.get(modelo) || 0);
}

// Espera a que vuelva el cupo de ese modelo, hasta un máximo. Devuelve
// true si hay cupo al salir. Lo usa la indexación del catálogo, que no
// tiene a nadie esperando del otro lado y puede permitirse esperar unos
// segundos en vez de rendirse. En cambio la respuesta a un cliente NUNCA
// espera: ahí se contesta con lo que haya.
export async function esperarCupo(modelo, maximoMs = 25000) {
  const hasta = limitados.get(modelo) || 0;
  const falta = hasta - Date.now();

  if (falta <= 0) return true;
  if (falta > maximoMs) return false;

  console.log(`Espero ${Math.ceil(falta / 1000)}s a que vuelva el cupo de ${modelo}`);
  await new Promise((seguir) => setTimeout(seguir, falta + 250));
  return true;
}

// Los nombres de modelo en un solo lugar, para que quien pregunta por el
// límite pregunte por el mismo modelo con el que después va a llamar.
export function modeloDeVision(env) {
  return env.OPENAI_MODELO_VISION || MODELO_VISION_POR_DEFECTO;
}

export function modeloDeIndice(env) {
  return env.OPENAI_MODELO_INDICE || MODELO_INDICE_POR_DEFECTO;
}

// Del mensaje de OpenAI ("Please try again in 22.538s") sale cuánto
// esperar. Si no se puede leer, 30 segundos, que es la ventana del
// límite por minuto.
function anotarLimite(modelo, texto) {
  const segundos = Number(/try again in ([\d.]+)s/i.exec(texto || "")?.[1]);
  const espera = Number.isFinite(segundos) ? Math.ceil(segundos) * 1000 : 30000;
  limitados.set(modelo, Date.now() + espera);
  // El mensaje de OpenAI trae el cupo y lo ya gastado ("Limit 200000,
  // Used 199431"). Sin eso en el registro, un 429 no se distingue de
  // otro y se diagnostica a ciegas: yo mismo culpé al prompt cuando el
  // que se comía el cupo era el tamaño de la imagen.
  const cupo = /Limit \d+[^.]*/i.exec(texto || "")?.[0] || "";
  console.error(
    `OpenAI puso límite de tokens por minuto en ${modelo}: ` +
      `no insisto por ${Math.round(espera / 1000)}s` +
      (cupo ? ` · ${cupo}` : "")
  );
}


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
      // EL COLOR DEL ZAPATO, en una palabra ("negro", "blanco", "azul"...)
      // o "" si no se distingue.
      //
      // Va aparte de "visto" a propósito. Antes había que sacarlo de esa
      // frase libre, y ahí "suela blanca" convertía un zapato negro en uno
      // blanco. Con su propio campo, el modelo contesta por el zapato
      // entero y el código no tiene que adivinar.
      //
      // Es lo que evita el fallo que más duele: la historia enseña el
      // negro y el bot manda el blanco.
      color: { type: "string" },
      // LA FOTO ES UNA VITRINA, NO UN PRODUCTO.
      //
      // El dueño publica historias enseñando la tienda entera: estantes
      // llenos, mesas con veinte pares, vídeos recorriendo el local. Ahí
      // no hay un zapato que identificar, y elegir "el que sale más
      // grande" es adivinar — le llegaron al cliente calzados que no
      // tenían nada que ver con lo que él miraba.
      //
      // Con esto el bot deja de adivinar y le manda el catálogo completo,
      // que es lo que de verdad responde a "quiero ver lo que tienen".
      variosProductos: { type: "boolean" },
      // true = solo se reconoce la marca o familia, no el modelo exacto.
      // Con esto la IA de texto sabe si, además de mostrar la marca, tiene
      // que pedirle al cliente el nombre exacto en el mismo mensaje.
      pedirNombreExacto: { type: "boolean" },
    },
    required: ["visto", "rasgos", "buscar", "color", "variosProductos", "pedirNombreExacto"],
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

// SCHEMA ESTRICTO PARA LA RESPUESTA DE TEXTO.
//
// Es el mismo arreglo que ya se le hizo a la visión en septiembre, por el
// mismo motivo. Con "json_object" (modo suelto) OpenAI garantiza que el
// JSON sea válido, NO que traiga las claves que el prompt pide. Y este
// prompt es largo: que se quede sin "buscar" es cuestión de tiempo.
//
// Cuando eso pasa no se nota. normalizar() rellena "buscar" con "NADA",
// el bot no busca nada, y el cliente recibe una respuesta amable sin un
// solo zapato debajo. Ningún error en los registros, ninguna alarma: una
// venta perdida que parece una conversación normal.
//
// Con "json_schema" + strict:true eso es imposible a nivel de API.
const ESQUEMA_RESPUESTA = {
  name: "respuesta_vendedora",
  strict: true,
  schema: {
    type: "object",
    properties: {
      // Lo que ve el cliente.
      respuesta: { type: "string" },
      // El término de búsqueda, o "NADA" si no hay que buscar.
      buscar: { type: "string" },
      // La memoria para el mensaje siguiente.
      historial: { type: "string" },
    },
    required: ["respuesta", "buscar", "historial"],
    additionalProperties: false,
  },
};

async function llamar(
  env,
  sistema,
  contenido,
  { maxTokens = 1024, json = true, schema = null, modelo = "", alFallar = null } = {}
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

    // Se avisa del MOTIVO a quien llamó, para que pueda reaccionar. El
    // caso que lo pidió: una foto del catálogo que OpenAI no consigue
    // descargar tumba la llamada entera y con ella los 10 candidatos de
    // esa ronda. Quien llama puede reintentar con menos.
    if (typeof alFallar === "function") {
      alFallar({
        estado: respuesta.status,
        deImagen: /invalid_image_url|Unable to download|Timeout while downloading/i.test(detalle),
      });
    }

    // 429 = límite de tokens por minuto de la organización. No es un
    // fallo del código ni de la petición: es que no queda cupo en este
    // minuto. Se anota para que el barrido no siga machacando.
    if (respuesta.status === 429) {
      anotarLimite(cuerpo.model, detalle);
    } else {
      console.error("El modelo respondió", respuesta.status, detalle);
    }

    return null;
  }

  const datos = await respuesta.json();
  return datos.choices?.[0]?.message?.content || null;
}

export async function responderTexto(env, entrada) {
  const salida = await llamar(
    env,
    textoConCatalogo(),
    [{ type: "text", text: entrada }],
    { schema: ESQUEMA_RESPUESTA }
  );
  return normalizar(salida);
}

// SOLO identifica: no redacta nada para el cliente. Devuelve
// { visto, rasgos, buscar, color, variosProductos, pedirNombreExacto } o null.
export async function identificarEnImagen(env, urlImagen, { modelo = "" } = {}) {
  const salida = await llamar(
    env,
    visionConModelos(),
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
      // "modelo" lo usa la indexación del catálogo: son cientos de
      // fotos y el cupo por minuto del modelo grande no da, así que se
      // indexa con el mini —que tiene un cupo mucho más alto— mientras
      // que la foto del cliente, que es una sola y decide la venta,
      // sigue yendo al modelo bueno.
      modelo: modelo || modeloDeVision(env),
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
    color: String(datos.color || "").trim().toLowerCase(),
    variosProductos: Boolean(datos.variosProductos),
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
// UNA FOTO QUE NO SE PUEDE DESCARGAR NO PUEDE COSTAR LA RONDA ENTERA.
//
// Pasó en producción: OpenAI devolvió 400 "invalid_image_url" en la
// tercera ronda y se perdieron los 10 candidatos, no solo el de la foto
// mala. Ahora, cuando el fallo es de imagen, se reintenta UNA vez con la
// primera mitad — que además son los más parecidos, porque vienen
// ordenados. Si la foto rota estaba en la segunda mitad, la ronda se
// salva entera.
//
// Solo un reintento, y solo partiendo por la mitad: buscar cuál de los
// diez es la mala costaría más llamadas de las que vale la pena.
export async function cotejarConCatalogo(env, foto, candidatos, textoCliente) {
  const elegido = await unCotejo(env, foto, candidatos, textoCliente);
  if (elegido !== FALLO_DE_IMAGEN) return elegido;

  if (candidatos.length < 2) {
    console.error("Cotejo visual: no pude descargar la foto del catálogo y no queda con qué reintentar");
    return null;
  }

  const mitad = candidatos.slice(0, Math.ceil(candidatos.length / 2));
  console.log(
    `Cotejo visual: OpenAI no pudo bajar alguna foto del catálogo; ` +
      `reintento con los ${mitad.length} más parecidos`
  );

  const segundo = await unCotejo(env, foto, mitad, textoCliente);
  return segundo === FALLO_DE_IMAGEN ? null : segundo;
}

// Marca interna: distingue "no es ninguno" (null) de "la llamada se cayó
// por una foto que no se pudo bajar", que sí merece reintento.
const FALLO_DE_IMAGEN = Symbol("fallo de imagen");

async function unCotejo(env, foto, candidatos, textoCliente) {
  if (!foto || !candidatos?.length) return null;

  const contenido = [
    // La foto del cliente en alta: es la que hay que leer al detalle, y
    // suele venir con filtros, lejos o con stickers encima.
    { type: "image_url", image_url: { url: foto, detail: "high" } },
    { type: "text", text: "↑ ESTA es la foto del cliente. Abajo, el catálogo:" },
  ];

  // LAS FOTOS DEL CATÁLOGO VIAJAN DENTRO DE LA LLAMADA (24-sep-2026).
  //
  // Antes se le pasaba a OpenAI la URL de Shopify y ERA ELLA quien tenía
  // que descargarla. Eso se rompía una y otra vez:
  //
  //   400 · "Unable to download content from the provided URL before the
  //          timeout" · code: invalid_image_url
  //
  // Y cuando pasa, no falla una foto: falla la llamada entera y se pierden
  // los diez candidatos de esa ronda. Encima el reintento vuelve a gastar.
  //
  // Ahora las baja el Worker —que está al lado del CDN, tarda
  // milisegundos y tiene la caché de Cloudflare delante— y las manda ya
  // convertidas. OpenAI no sale a Internet a buscar nada, así que ese
  // error desaparece de raíz.
  //
  // Se bajan las PEQUEÑAS (urlPequena) y van en "detail: low": son fotos
  // de producto limpias, con el zapato centrado sobre fondo liso, y a esa
  // resolución la silueta y la suela se leen igual.
  const fotos = await Promise.all(
    candidatos.map((producto) => fotoDelCatalogo(env, producto.imagen))
  );

  const conFoto = [];
  candidatos.forEach((producto, i) => {
    // Una foto que no se pudo bajar se queda fuera, y ya está: antes esa
    // sola tumbaba la ronda entera.
    if (!fotos[i]) return;
    conFoto.push(producto);
    contenido.push({ type: "text", text: `${conFoto.length}. ${producto.titulo}` });
    contenido.push({ type: "image_url", image_url: { url: fotos[i], detail: "low" } });
  });

  if (!conFoto.length) {
    console.error("Cotejo visual: no pude bajar NINGUNA foto del catálogo");
    return null;
  }

  if (conFoto.length < candidatos.length) {
    console.log(
      `Cotejo visual: ${candidatos.length - conFoto.length} foto(s) del catálogo no se ` +
        `pudieron bajar; sigo con las otras ${conFoto.length}`
    );
  }

  // A partir de aquí los números que ve el modelo son los de "conFoto".
  candidatos = conFoto;

  contenido.push({
    type: "text",
    text: `El cliente escribió: ${textoCliente ? `"${textoCliente}"` : "(nada, solo mandó la foto)"}`,
  });

  let falloDeImagen = false;
  const salida = await llamar(env, promptCotejo, contenido, {
    maxTokens: 300,
    schema: ESQUEMA_COTEJO,
    modelo: modeloDeVision(env),
    alFallar: ({ deImagen }) => {
      falloDeImagen = deImagen;
    },
  });

  if (falloDeImagen) return FALLO_DE_IMAGEN;

  const datos = extraerJson(salida);
  if (!datos) {
    // Si fue el límite de tokens, ya se avisó arriba con el motivo real.
    // Repetir "no devolvió JSON válido" por cada lote solo llena el
    // registro de ruido y esconde la causa.
    if (!estaLimitado(modeloDeVision(env))) {
      console.error("El cotejo visual no devolvió JSON válido");
    }
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

// CATALOGAR UN PRODUCTO: los 15 rasgos de su foto, y nada más.
//
// Esto lo usa /indexar-catalogo, y tiene prompt propio porque reutilizar
// identificarEnImagen() mandaba el prompt COMPLETO de visión —8.300
// tokens de firmas de marca y ejemplos— para sacar 15 booleanos de una
// foto de producto sobre fondo blanco. El prompt corto son 587.
//
// Pero el prompt NUNCA fue el techo, y conviene dejarlo escrito porque
// me costó dos intentos entenderlo. Con el prompt corto la tanda de 40
// seguía muriendo en 429 en las PRIMERAS CUATRO llamadas, y 4 × 587 son
// 2.300 tokens: imposible que eso reviente un cupo de 200.000.
//
// Lo caro era la IMAGEN. gpt-4o-mini no cuenta las fotos como el modelo
// grande: las cobra muchísimo más caro, y con detail:"high" una foto de
// Shopify sale por decenas de miles de tokens ella sola. La cuenta que
// lo confirma es la tanda que entregó 7: 200.000 de cupo entre 7 fotos
// son ~28.000 tokens por foto, y el texto eran 587. Todo lo demás era
// la imagen.
//
// Por eso va detail:"low". La foto se manda a 512×512, que es de sobra
// para lo que se le pregunta acá: si tiene swoosh, si es bota, si la
// suela es de aire. No se le pide leer la letra chica de la lengüeta.
// El cotejo contra la foto DEL CLIENTE sigue en "high" —ahí sí hay que
// mirar fino—; esto es solo catalogar el estante.
const DETALLE_INDICE = "low";

export async function rasgosDeProducto(env, urlImagen, { modelo = "" } = {}) {
  const salida = await llamar(
    env,
    promptIndexar,
    [
      { type: "image_url", image_url: { url: urlPequena(urlImagen), detail: DETALLE_INDICE } },
      { type: "text", text: "Cataloga este producto." },
    ],
    {
      schema: ESQUEMA_IDENTIFICACION,
      modelo: modelo || modeloDeIndice(env),
      maxTokens: 400,
    }
  );

  const datos = extraerJson(salida);
  if (!datos?.rasgos) return null;

  return {
    visto: String(datos.visto || "").trim(),
    rasgos: datos.rasgos,
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


// LAS FOTOS DEL CATÁLOGO, BAJADAS UNA SOLA VEZ.
//
// El mismo producto sale en varias rondas y en varios mensajes, y su foto
// no cambia. Guardarla mientras viva el Worker ahorra descargas y hace
// que la ronda 2 y la 3 salgan casi instantáneas.
//
// El tope existe porque un isolate no puede crecer sin freno: con 40
// fotos de 512px son unos pocos MB, de sobra para una conversación.
const MAXIMO_FOTOS_GUARDADAS = 40;
const fotosDelCatalogo = new Map();

async function fotoDelCatalogo(env, url) {
  if (!url) return "";
  if (fotosDelCatalogo.has(url)) return fotosDelCatalogo.get(url);

  const { uri } = await comoDataUri(env, urlPequena(url), { silencioso: true });

  // SOLO SE GUARDAN LAS QUE SÍ BAJARON.
  //
  // La primera versión guardaba también el fallo, para no reintentar. Pero
  // un tropiezo de un momento —el CDN lento, un corte de red— dejaba ese
  // producto fuera del cotejo durante toda la vida del Worker, que son
  // minutos y muchos clientes. Reintentar una descarga que falla rápido
  // cuesta mucho menos que perder un producto del catálogo.
  if (uri) {
    if (fotosDelCatalogo.size >= MAXIMO_FOTOS_GUARDADAS) fotosDelCatalogo.clear();
    fotosDelCatalogo.set(url, uri);
  }

  return uri;
}
