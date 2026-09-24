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
import promptIndexar from "./prompts/indexar.txt";
import promptCotejo from "./prompts/cotejo.txt";
import { urlPequena } from "./sheets.js";
import { comoDataUri } from "./imagen.js";

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

// Con el que se cataloga la hoja. Son decenas de fotos, así que va el
// mini: su cupo por minuto es mucho más alto y para una foto de producto
// limpia, sobre fondo liso, alcanza de sobra.
const MODELO_INDICE_POR_DEFECTO = "gpt-4o-mini";

// HASTA CUÁNDO NO VALE LA PENA VOLVER A PEDIRLE NADA A UN MODELO.
//
// OpenAI limita los tokens por minuto (TPM) de cada modelo POR SEPARADO,
// no de la cuenta entera: gpt-4o anda justo y gpt-4o-mini tiene mucho
// más. Con un número compartido, un 429 del grande apagaba también al
// chico sin motivo.
//
// Solo lo consulta lo que puede esperar: la indexación y el barrido del
// cotejo. Identificar la foto del cliente y redactar su respuesta se
// intentan SIEMPRE — mejor un 429 en una de ellas que dejarlo sin
// respuesta por prudencia.
const limitados = new Map();

export function estaLimitado(modelo) {
  return Date.now() < (limitados.get(modelo) || 0);
}

// Espera a que vuelva el cupo, hasta un máximo. Devuelve true si al salir
// hay cupo. Lo usa la indexación, que no tiene a nadie esperando.
export async function esperarCupo(modelo, maximoMs = 25000) {
  const hasta = limitados.get(modelo) || 0;
  const falta = hasta - Date.now();

  if (falta <= 0) return true;
  if (falta > maximoMs) return false;

  console.log(`Espero ${Math.ceil(falta / 1000)}s a que vuelva el cupo de ${modelo}`);
  await new Promise((seguir) => setTimeout(seguir, falta + 250));
  return true;
}

// Los nombres de modelo en un solo sitio, para que quien pregunta por el
// límite pregunte por el mismo modelo con el que después va a llamar.
export function modeloDeVision(env) {
  return env.OPENAI_MODELO_VISION || MODELO_VISION_POR_DEFECTO;
}

export function modeloDeIndice(env) {
  return env.OPENAI_MODELO_INDICE || MODELO_INDICE_POR_DEFECTO;
}

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

      // Se apunta HASTA CUÁNDO no vale la pena insistir con ESTE modelo.
      // Sin esto, estaLimitado() no sabría nada y el barrido seguiría
      // mandando llamadas que ya se sabe que van a fallar.
      const espera = Math.min(Math.ceil(Number(segundos) || 20), 60);
      limitados.set(cuerpo.model, Date.now() + espera * 1000);
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
export async function identificarEnImagen(env, urlImagen, catalogo = "") {
  const texto = catalogo
    ? "Identifica el equipo de esta foto.\n\n" +
      "───────── CATÁLOGO ACTUAL DE LA TIENDA ─────────\n" +
      `${catalogo}\n` +
      "─────────────────────────────────────────────────"
    : "Identifica el equipo de esta foto.";

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

/* ── Catalogar la hoja y cotejar contra ella ────────────────────────── */

// SCHEMA ESTRICTO PARA EL COTEJO VISUAL.
//
// Se elige por NÚMERO, no por título. Si se le pidiera devolver el
// nombre, el modelo lo parafrasearía ("Redmi Note 14 Pro Plus" por
// "REDMI NOTE 14 PRO+ 8/256") y después habría que adivinar a cuál se
// refería. Con un índice no hay nada que interpretar: o es uno de los
// que se le mandaron, o es 0.
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

// Mira UNA foto de producto de la hoja y devuelve la frase con lo que se
// ve. Es lo que se guarda en el índice (ver indice.js).
//
// Usa su propio prompt, corto, no el de visión entero: para catalogar no
// hacen falta las reglas de venta ni la escalera de confianza, y mandarlas
// multiplicaba por diez el gasto de cada foto.
export async function describirProducto(env, urlImagen, { modelo = "" } = {}) {
  if (!urlImagen) return null;

  const salida = await llamar(
    env,
    promptIndexar,
    [
      // En baja: son fotos de producto limpias y lo que hay que leer —el
      // número de cámaras, la muesca, el acabado— se ve igual.
      { type: "image_url", image_url: { url: urlPequena(urlImagen), detail: "low" } },
      { type: "text", text: "Cataloga este producto." },
    ],
    { maxTokens: 200, schema: ESQUEMA_IDENTIFICACION, modelo: modelo || modeloDeIndice(env) }
  );

  const datos = extraerJson(salida);
  if (!datos) return null;

  const visto = String(datos.visto || "").trim();
  return visto ? { visto } : null;
}

// Le pone al modelo la foto del cliente al lado de las fotos reales del
// catálogo y le pregunta cuál es el mismo equipo. Devuelve el producto
// elegido, o null si no lo tiene claro.
export async function cotejarConCatalogo(env, foto, candidatos, textoCliente) {
  if (!foto || !candidatos?.length) return null;

  const contenido = [
    // La del cliente en alta: es la que hay que leer al detalle, y suele
    // venir con filtros, lejos o con stickers encima.
    { type: "image_url", image_url: { url: foto, detail: "high" } },
    { type: "text", text: "↑ ESTA es la foto del cliente. Abajo, el catálogo:" },
  ];

  // LAS FOTOS DEL CATÁLOGO VIAJAN DENTRO DE LA LLAMADA.
  //
  // Antes se le pasaba a OpenAI la URL de Drive y ERA ELLA quien tenía que
  // descargarla. Eso se rompía con un 400 "invalid_image_url", y cuando
  // pasa no falla una foto: falla la llamada entera y se pierden todos los
  // candidatos de esa ronda.
  //
  // Ahora las baja el Worker y las manda ya convertidas. OpenAI no sale a
  // Internet a buscar nada, así que ese error desaparece de raíz — y de
  // paso deja de importar si Drive va lento ese día.
  const fotos = await Promise.all(
    candidatos.map((producto) => fotoDelCatalogo(env, producto.imagen))
  );

  const conFoto = [];
  candidatos.forEach((producto, i) => {
    // Una foto que no se pudo bajar se queda fuera, y ya está.
    if (!fotos[i]) return;
    conFoto.push(producto);
    contenido.push({ type: "text", text: `${conFoto.length}. ${producto.titulo}` });
    contenido.push({ type: "image_url", image_url: { url: fotos[i], detail: "low" } });
  });

  if (!conFoto.length) {
    console.error(
      "Cotejo visual: no pude bajar NINGUNA foto del catálogo. " +
        "¿Están las de Drive en \"Cualquiera con el enlace\"?"
    );
    return null;
  }

  if (conFoto.length < candidatos.length) {
    console.log(
      `Cotejo visual: ${candidatos.length - conFoto.length} foto(s) no se pudieron bajar; ` +
        `sigo con las otras ${conFoto.length}`
    );
  }

  candidatos = conFoto;

  contenido.push({
    type: "text",
    text: `El cliente escribió: ${textoCliente ? `"${textoCliente}"` : "(nada, solo mandó la foto)"}`,
  });

  const salida = await llamar(env, promptCotejo, contenido, {
    maxTokens: 300,
    schema: ESQUEMA_COTEJO,
    modelo: modeloDeVision(env),
  });

  const datos = extraerJson(salida);
  if (!datos) {
    // Si fue el cupo, ya se avisó arriba con el motivo real. Repetirlo por
    // cada lote esconde la causa.
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


// Las fotos del catálogo, bajadas una sola vez. El mismo producto sale en
// varias rondas y en varios mensajes, y su foto no cambia.
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
