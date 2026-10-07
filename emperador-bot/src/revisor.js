// EL REVISOR: ¿LA IA CONTESTÓ BIEN? (2-oct-2026)
//
// QUÉ SE PEDÍA. El dueño: "que aparezca señalado el símbolo de error o de
// respuesta no debida, no coherente, o que alucinó la IA". Las redes de
// seguridad (precio, tono, marcas, Cashea…) atrapan los inventos que se
// pueden reconocer con reglas. Lo demás —contestar otra cosa de la que le
// preguntaron, contradecirse, afirmar algo que no sale de ningún lado— no
// tiene regla. Para eso está esto.
//
// CÓMO. Después de cada respuesta, YA ENVIADA (el cliente no espera nada),
// una segunda IA barata (gpt-4o-mini) lee la conversación, lo que preguntó
// el cliente, lo que pensó la IA, lo que se le contestó y lo que se le
// enseñó, y da un veredicto. Si no está bien, el turno queda marcado 🔴
// "Respuesta indebida" en los paneles y el panel central avisa en el
// momento.
//
// ES PRUDENTE A PROPÓSITO: solo marca lo que está claramente mal. Un
// revisor que ve fantasmas en todas partes es uno que se deja de mirar.
//
// CUESTA unos $0,0002 por respuesta. Se apaga con REVISOR_IA = "no" en
// wrangler.toml.
//
// MÁS PRECISO (5-oct-2026): piensa antes de decidir (compara cada dato de
// la respuesta contra las fichas, la conversación y los datos de la tienda),
// dice qué tan seguro está y cita la frase exacta. Solo marca 🔴 con
// confianza "alta" (REVISOR_CONFIANZA = "media" para marcar también las
// dudas). Si la tienda le pasa sus datos (turno.contexto) y la categoría
// pedida, atrapa también horarios, envíos o categorías equivocadas.
//
// CON DEEPSEEK (5-oct-2026, El Emperador): si la tienda va con DeepSeek
// (PROVEEDOR = "deepseek"), el revisor también. Modelo: REVISOR_MODELO, o si
// no el de las fotos (DEEPSEEK_MODELO_VISION), que es el barato. Sin pensar
// de más: un veredicto de una línea no necesita razonar 20 segundos.

import { anotarGasto } from "./gasto.js";
import { marcarTurno, alertarCentral } from "./registro.js";
import { aprendeActivo, aprender } from "./lecciones.js";

const API = "https://api.openai.com/v1/chat/completions";
const API_DEEPSEEK = "https://api.deepseek.com/chat/completions";

const VEREDICTOS = {
  alucino: "Alucinó",
  incoherente: "Incoherente",
  no_responde: "No contestó lo que le preguntaron",
  tono: "Tono indebido",
  // La IA de imágenes se equivocó de zapato: lo que se le enseñó no es lo
  // de la foto (6-oct-2026: el revisor mira la foto y las fichas).
  foto_equivocada: "La IA de imágenes se equivocó de zapato",
};

const INSTRUCCIONES = `Eres el supervisor de calidad de una asistente virtual de ventas por Instagram.
Revisas UNA respuesta que ya se le mandó a un cliente y dices si estuvo bien.
Tu trabajo es ser PRECISO: marcar lo que de verdad está mal y nada más. Una
falsa alarma le hace perder tiempo al dueño; un error real que dejas pasar,
le cuesta un cliente.

TE LLEGA:
  · LA CONVERSACIÓN RECIENTE (los últimos mensajes).
  · LO QUE ESCRIBIÓ EL CLIENTE en este mensaje.
  · LO QUE PENSÓ LA ASISTENTE antes de responder.
  · LO QUE RESPONDIÓ.
  · LAS FICHAS que se le enseñaron debajo (título y precio). Si no hay
    fichas, no se le enseñó ningún producto.
  · A veces, LA CATEGORÍA que pidió (calzado, bolso, gorra…) y LOS DATOS DE
    LA TIENDA (horario, envíos, ubicación, pagos, tallas). Esos datos son
    la verdad: lo que los contradiga, está mal.

CÓMO REVISAS (en "pienso", antes de decidir):
  1. ¿Qué preguntó o pidió el cliente, exactamente?
  2. Toma CADA dato concreto de la respuesta —precio, talla, color, stock,
     modelo, horario, envío, dirección, regalo, descuento, plazo— y busca
     de dónde sale: las fichas, la conversación o los datos de la tienda.
     Un dato que no sale de ningún lado es inventado.
  3. ¿Contesta lo que preguntó? ¿Se contradice? ¿El tono es respetuoso?
  4. Decide, y di qué tan seguro estás.

VEREDICTOS:
  · "bien": razonable para lo que pidió. ES EL NORMAL.
  · "alucino": afirma un dato concreto que no sale de ningún lado, o que
    contradice las fichas o los datos de la tienda (un precio distinto al
    de la ficha, un regalo, un descuento, un envío que la tienda no hace,
    un horario distinto, una talla o un color que nadie confirmó, "sí hay"
    de algo que no se le enseñó).
  · "incoherente": se contradice, contradice lo que pensó, habla de otro
    producto, o le enseña algo de OTRA categoría (pidió bolsos y le salen
    zapatos).
  · "no_responde": ignora la pregunta concreta y contesta otra cosa.
  · "tono": grosera, burlona, regañona o fuera de lugar.
  · "foto_equivocada": SOLO si te llegan imágenes: el cliente mandó la foto
    de un zapato y lo que se le enseñó en las fichas NO es ese zapato (otro
    modelo, otra marca). Otro color del mismo modelo NO es equivocarse.

ESTO ESTÁ BIEN (no lo marques nunca):
  · "Eso te lo confirma un asesor en un momento 😊" (o parecido).
  · Decir que el precio está en la foto o en la ficha.
  · Un saludo, una despedida, una pregunta para entender qué busca.
  · "De ese no tengo, pero mira estos 👇" con fichas de lo que sí hay.
  · El botón del catálogo cuando no se encontró lo que pidió.
  · Los datos de la tienda dichos con otras palabras (mismo contenido).
  · Ofrecer pasarlo con un asesor, o decir que un asesor lo atiende.
  · Una respuesta corta o sencilla: corta no es mala.
  · A una pregunta de TALLA: "La talla 42 te la confirma un asesor" (o
    "eso te lo confirma un asesor") ES LA RESPUESTA CORRECTA: en esta
    tienda las tallas las confirma una persona. No es "no_responde".
  · A una pregunta de PRECIO con fichas que llevan su precio: el precio va
    debajo de cada foto, así que está contestado (más aún si la respuesta
    dice el precio o que está en las fotos).
  · "Aquí tienes el catálogo" cuando en "LO QUE SE LE MANDÓ ADEMÁS" dice
    que fue el botón del catálogo: se le mandó de verdad.
  · Un mensaje del cliente VACÍO (sin texto ni foto): saludar o preguntar
    qué busca está bien; no hay ninguna pregunta que contestar.
  · Un "ok", "👍", "gracias", "listo" del cliente: no pregunta nada, así
    que una respuesta corta de cortesía está bien. No es "no_responde".
  · El cliente pregunta el precio o si está disponible SIN decir de qué
    producto, y en la conversación no hay ninguno: preguntarle cuál es (o
    pedirle que mande la publicación) ES la respuesta correcta.
  · LO QUE PENSÓ LA ASISTENTE puede estar equivocado: juzga la respuesta
    por lo que escribió el cliente y por LOS DATOS DE LA TIENDA, no por lo
    que ella pensó (si pensó mal y respondió bien, la respuesta está bien).
  · Un precio, un monto o una cuenta que está en LOS DATOS DE LA TIENDA (o
    que ahí dice que calculó el código) es de verdad, aunque no haya
    fichas en este mensaje.
  · Un dato que la tienda NO tiene y manda al asesor (precio en bolívares,
    tasa del día, garantía): "te lo confirma un asesor" ES la respuesta. No
    es "no_responde".

CONFIANZA:
  · "alta": lo puedes señalar con el dedo (citas la frase y sabes por qué
    está mal).
  · "media": te parece mal, pero podría estar bien con algo que no ves.
  · "baja": dudas.
Si es "bien", la confianza da igual.

LAS IMÁGENES: a veces te llegan la FOTO DEL CLIENTE y las fotos de las
FICHAS que se le enseñaron. Míralas: ¿es el mismo zapato? Fíjate en lo que
separa un modelo de otro (la suela, los logos, las piezas de plástico, lo
que lleva escrito), no en el color.

QUÉ IA SE EQUIVOCÓ ("ia"): "imagen" si el error fue reconocer mal el
zapato de la foto; "texto" en todo lo demás.

LA REGLA ("regla"): si NO está bien, una regla GENERAL, en una frase y en
imperativo, para que esa IA no lo vuelva a hacer con NINGÚN cliente. No el
caso concreto: la lección. Ej.: "No confirmes una talla si ninguna ficha la
dice: pásaselo a un asesor." / "Unas ondas de plástico que suben por el
lateral con el logo TN en el talón son TN, no Air Max 270."

¿HACE FALTA TOCAR EL CÓDIGO? ("necesitaCodigo"): casi siempre va vacío.
Escribe ahí por qué SOLO si una regla no puede arreglarlo: el catálogo
tiene un dato mal o le falta (precio, nombre, foto), la búsqueda trajo
productos que no son, el bot repitió un mensaje, se mandó algo cortado.
Eso no lo arregla enseñarle a la IA: lo arregla una persona en el código.

LA CORRECCIÓN: si NO está bien, escribe en "correccion" lo que la
asistente DEBIÓ responder: una respuesta corta, en español neutro, lista
para mandarla al cliente, que use SOLO datos de las fichas, la conversación
o los datos de la tienda. Si el dato no está en ningún lado, la corrección
es pasárselo a un asesor ("Eso te lo confirma un asesor en un momento 😊").
Si está bien, "correccion" va vacío.

Responde SOLO con este JSON:
{"pienso":"2 o 3 frases: qué pidió, qué datos dio y de dónde salen","veredicto":"bien|alucino|incoherente|no_responde|tono","confianza":"alta|media|baja","cita":"la frase EXACTA de la respuesta que está mal (vacío si está bien)","explicacion":"una frase corta en español: qué está mal y por qué","correccion":"lo que debió responder (vacío si está bien)","ia":"texto|imagen","regla":"la regla general (vacía si está bien)","necesitaCodigo":"por qué hay que tocar el código (casi siempre vacío)"}`;

function conDeepSeek(env) {
  return String(env?.PROVEEDOR || "").toLowerCase() === "deepseek";
}

// EL TOPE DEL MES (5-oct-2026). El dueño: "si esto no nos va a gastar
// todo". REVISOR_TOPE_MES, en dólares (por defecto 10): cuando lo que gastó
// el revisor este mes llega ahí, deja de revisar hasta el mes que viene. El
// bot sigue respondiendo igual; solo se apaga la segunda opinión. Con "no"
// no hay tope.
const TOPE_POR_DEFECTO = 10;

export function topeDelRevisor(env) {
  const valor = String(env?.REVISOR_TOPE_MES ?? "").trim().toLowerCase();
  if (!valor) return TOPE_POR_DEFECTO;
  if (/^(no|sin tope|ninguno)$/.test(valor)) return Infinity;
  const n = Number(valor.replace(",", ".").replace(/[$\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : TOPE_POR_DEFECTO;
}

// Lo que gastó el revisor este mes: sus filas en la tabla gasto llevan
// "(revisor)" detrás del modelo (ver más abajo). Sin tabla, cero.
export async function gastoDelRevisor(db) {
  if (!db) return 0;
  try {
    const fila = await db
      .prepare("SELECT COALESCE(SUM(dolares), 0) AS d FROM gasto WHERE mes = ? AND instr(modelo, '(revisor)') > 0")
      .bind(new Date().toISOString().slice(0, 7))
      .first();
    return Number(fila?.d) || 0;
  } catch {
    return 0;
  }
}

// LOS MODELOS QUE PIENSAN (6-oct-2026, dueño: "una IA potente, inteligente,
// que pueda pensar bien las cosas y corregir absolutamente todo"). Los de la
// familia gpt-5 y los "o" (o3, o4-mini) razonan por dentro antes de
// contestar: más lentos, pero mucho más finos para encontrar lo que está
// mal. Se llaman distinto: sin "temperature", con espacio para pensar
// ("max_completion_tokens" grande) y con "reasoning_effort".
//   REVISOR_ESFUERZO   "low", "medium" (por defecto) o "high"
//   REVISOR_RESPALDO   si el modelo no está disponible en la cuenta, este
//                      (por defecto "gpt-4o"): el revisor no se apaga.
export function piensaPorDentro(modelo) {
  return /^(?:o\d|gpt-5)/i.test(String(modelo || ""));
}

function esfuerzoDelRevisor(env) {
  const e = String(env?.REVISOR_ESFUERZO || "medium").trim().toLowerCase();
  return ["minimal", "low", "medium", "high"].includes(e) ? e : "medium";
}

// El revisor corre después de que el cliente ya tiene su respuesta, dentro
// del tiempo que Cloudflare le da al mensaje (~30 s en total). Uno que
// piensa puede tardar: se le dan 25 s y, si no llega, esa respuesta queda
// sin revisar (el cliente no nota nada).
const ESPERA_NORMAL_MS = 12000;
const ESPERA_PENSANDO_MS = 25000;

export function modeloDelRevisor(env) {
  return env?.REVISOR_MODELO || (conDeepSeek(env) ? env?.DEEPSEEK_MODELO_VISION || "deepseek-chat" : "gpt-4o-mini");
}

export function revisorActivo(env) {
  if (/^(no|off|false|0)$/i.test(String(env?.REVISOR_IA || "").trim())) return false;
  return conDeepSeek(env) ? Boolean(env?.DEEPSEEK_API_KEY) : Boolean(env?.OPENAI_API_KEY);
}

// La llamada, a OpenAI o a DeepSeek (las dos hablan igual). Devuelve el
// JSON de la respuesta, o null.
// CON DEEPSEEK TAMBIÉN PIENSA (7-oct-2026). Con REVISOR_PIENSA = "si", el
// revisor de DeepSeek razona antes de decidir (como gpt-5 en Invictus). Si
// el modelo no lo acepta, se repite sin pensar: el revisor nunca se apaga.
function deepseekPiensa(env) {
  return conDeepSeek(env) && /^(si|sí|true|1|on)$/i.test(String(env?.REVISOR_PIENSA || "").trim());
}

async function preguntar(env, modelo, mensajes) {
  const deepseek = conDeepSeek(env);
  const piensa = !deepseek && piensaPorDentro(modelo);
  const dsPiensa = deepseekPiensa(env);
  const cuerpoPara = (m) =>
    piensaPorDentro(m) && !deepseek
      ? {
          model: m,
          response_format: { type: "json_object" },
          messages: mensajes,
          // Lo que piensa por dentro sale de aquí: 400 no le alcanzaba ni
          // para empezar y devolvía vacío.
          max_completion_tokens: 8000,
          reasoning_effort: esfuerzoDelRevisor(env),
        }
      : {
          model: m,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: mensajes,
          ...(deepseek
            ? dsPiensa
              ? { max_tokens: 8000, thinking: { type: "enabled" } }
              : { max_tokens: 400, thinking: { type: "disabled" } }
            : { max_completion_tokens: 600 }),
        };
  const enviar = (c) =>
    fetch(deepseek ? API_DEEPSEEK : API, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${deepseek ? env.DEEPSEEK_API_KEY : env.OPENAI_API_KEY}` },
      body: JSON.stringify(c),
      signal: AbortSignal.timeout((piensaPorDentro(c.model) && !deepseek) || c.thinking?.type === "enabled" ? ESPERA_PENSANDO_MS : ESPERA_NORMAL_MS),
    });
  const cuerpo = cuerpoPara(modelo);
  let usado = modelo;
  let r = await enviar(cuerpo);
  // Un modelo de DeepSeek que no entiende "thinking": sin él.
  if (deepseek && r.status === 400) {
    const { thinking, ...sinThinking } = cuerpo;
    r = await enviar(sinThinking);
  }
  // El modelo que piensa no está en esta cuenta de OpenAI (o no acepta algo):
  // el de respaldo. Así el revisor nunca se apaga por el nombre de un modelo.
  if (piensa && (r.status === 400 || r.status === 404 || r.status === 403)) {
    const detalle = (await r.text().catch(() => "")).slice(0, 200);
    usado = env?.REVISOR_RESPALDO || "gpt-4o";
    console.log(`REVISOR: ${modelo} no respondió (${r.status}: ${detalle}); reviso con ${usado}`);
    r = await enviar(cuerpoPara(usado));
  }
  if (!r.ok) {
    console.log(`REVISOR: ${deepseek ? "DeepSeek" : "OpenAI"} respondió ${r.status}, no reviso esta respuesta`);
    return null;
  }
  const datos = await r.json();
  return { ...datos, usado };
}

async function conversacionReciente(db, igsid) {
  try {
    const r = await db
      .prepare("SELECT de, texto FROM mensajes WHERE igsid = ? ORDER BY cuando DESC, id DESC LIMIT 8")
      .bind(String(igsid))
      .all();
    return (r?.results || [])
      .reverse()
      .map((m) => `${m.de === "bot" ? "Asistente" : m.de === "asesor" ? "Asesor" : "Cliente"}: ${String(m.texto).slice(0, 300)}`)
      .join("\n");
  } catch {
    return "";
  }
}

// turno: { id, igsid, cliente, pienso, respuesta, productos: [títulos], fichas: [líneas con precio],
//          categoria?: "bolso"…, contexto?: los datos de la tienda (horario, envíos, ubicación, pagos) }
export async function revisarTurno(env, turno) {
  if (!revisorActivo(env) || !turno?.id || !String(turno.respuesta || "").trim()) return null;
  const tope = topeDelRevisor(env);
  if (tope !== Infinity) {
    const gastado = await gastoDelRevisor(env.DB);
    if (gastado >= tope) {
      console.log(`REVISOR: llegó al tope del mes ($${gastado.toFixed(2)} de $${tope}): no reviso hasta el mes que viene`);
      return null;
    }
  }

  const charla = await conversacionReciente(env.DB, turno.igsid);
  const contenido = [
    "CONVERSACIÓN RECIENTE:",
    charla || "(sin más mensajes)",
    "",
    `LO QUE ESCRIBIÓ EL CLIENTE: ${turno.cliente || "(sin texto)"}`,
    `LO QUE PENSÓ LA ASISTENTE: ${turno.pienso || "(nada)"}`,
    `LO QUE RESPONDIÓ: ${turno.respuesta}`,
    `LO QUE SE LE ENSEÑÓ EN FICHAS: ${(turno.fichas || turno.productos || []).join(" | ") || "(nada)"}`,
    // El botón del catálogo, la tarjeta de Cashea, la nota de voz… (6-oct:
    // sin esto, "aquí tienes el catálogo" se marcaba 🔴 aunque se mandó).
    (turno.notas || []).filter(Boolean).length ? `LO QUE SE LE MANDÓ ADEMÁS / LO QUE HIZO EL CÓDIGO: ${(turno.notas || []).filter(Boolean).join(" · ")}` : "",
    // Solo en la tienda que guarda fichas técnicas en su base (hoy EPICCELL):
    // en las demás esta línea no sale nunca.
    (turno.notas || []).some((n) => /FICHA TÉCNICA REAL/.test(String(n || "")))
      ? "OJO: los datos que coinciden con la FICHA TÉCNICA REAL de arriba vienen de la base de la tienda: no son inventados."
      : "",
    turno.categoria ? `LA CATEGORÍA QUE PIDIÓ: ${turno.categoria}` : "",
    turno.vision ? `LO QUE HIZO LA IA DE IMÁGENES CON LA FOTO: ${turno.vision}` : "",
    turno.contexto ? `\nLOS DATOS DE LA TIENDA (la verdad):\n${String(turno.contexto).slice(0, 6000)}` : "",
  ]
    .filter((linea) => linea !== "")
    .join("\n");

  const modelo = modeloDelRevisor(env);
  // LA FOTO DEL CLIENTE Y LAS DE LAS FICHAS (6-oct-2026): así el revisor
  // también corrige a la IA de imágenes. Solo con OpenAI (DeepSeek no ve
  // fotos) y en baja resolución: es para comparar modelos, no detalles.
  const fotos = !conDeepSeek(env) && turno.foto
    ? [
        { type: "text", text: "LA FOTO DEL CLIENTE:" },
        { type: "image_url", image_url: { url: turno.foto, detail: "low" } },
        ...(turno.imagenes || []).slice(0, 3).flatMap((url, i) => [
          { type: "text", text: `FICHA ${i + 1} QUE SE LE ENSEÑÓ:` },
          { type: "image_url", image_url: { url, detail: "low" } },
        ]),
      ]
    : [];
  let datos;
  try {
    datos = await preguntar(env, modelo, [
      { role: "system", content: INSTRUCCIONES },
      { role: "user", content: fotos.length ? [{ type: "text", text: contenido }, ...fotos] : contenido },
    ]);
    if (!datos) return null;
  } catch (error) {
    console.log("REVISOR: no pude revisar esta respuesta:", error?.message || error);
    return null;
  }

  if (datos?.usage) {
    await anotarGasto(env, {
      // Aparte del que conversa: así se ve en /estado y cuenta para el tope.
      // (La tarifa se busca por el comienzo del nombre: es la del modelo.)
      modelo: `${datos.usado || modelo} (revisor)`,
      entrada: datos.usage.prompt_tokens || 0,
      cacheadas: datos.usage.prompt_cache_hit_tokens || datos.usage.prompt_tokens_details?.cached_tokens || 0,
      salida: datos.usage.completion_tokens || 0,
    });
  }

  let veredicto;
  try {
    veredicto = JSON.parse(datos?.choices?.[0]?.message?.content || "{}");
  } catch {
    return null;
  }

  const clave = String(veredicto?.veredicto || "bien").toLowerCase();
  const explicacion = String(veredicto?.explicacion || "").slice(0, 240);
  const cita = String(veredicto?.cita || "").trim().slice(0, 160);
  const correccion = String(veredicto?.correccion || "").trim().slice(0, 400);
  // Sin "confianza" (un modelo que no la mandó): se toma como segura, que es
  // como funcionaba antes de pedirla.
  const confianza = ["alta", "media", "baja"].includes(String(veredicto?.confianza || "").toLowerCase())
    ? String(veredicto.confianza).toLowerCase()
    : "alta";
  if (veredicto?.pienso) console.log(`REVISOR pensó: ${String(veredicto.pienso).slice(0, 300)}`);
  if (!VEREDICTOS[clave]) {
    console.log(`REVISOR: bien${explicacion ? ` (${explicacion})` : ""}`);
    return { veredicto: "bien", explicacion };
  }
  // PRECISO: solo se marca lo que está seguro. Con REVISOR_CONFIANZA =
  // "media" se marcan también las dudas razonables (más avisos, más falsas
  // alarmas). Lo que no llega, queda en el registro igual.
  if (!confianzaSuficiente(confianza, env.REVISOR_CONFIANZA)) {
    console.log(`REVISOR: posible ${clave} con confianza ${confianza}, no lo marco: ${explicacion}`);
    return { veredicto: "bien", explicacion, dudoso: clave, confianza };
  }

  const motivo = `${VEREDICTOS[clave]}${explicacion ? ` — ${explicacion}` : ""}${cita ? ` · «${cita}»` : ""}${correccion ? ` → Debió decir: «${correccion}»` : ""}`;
  console.log(`REVISOR: 🔴 ${motivo}`);
  await marcarTurno(env.DB, turno.id, "indebida", motivo);

  // LA IA APRENDE (ver lecciones.js). Con APRENDER = "si", el error se
  // guarda como regla y NO suena la alerta roja: solo se avisa al dueño
  // cuando hay que tocar el código. Sin aprender, como siempre: alerta 🔴.
  const ia = clave === "foto_equivocada" || String(veredicto?.ia || "").toLowerCase() === "imagen" ? "imagen" : "texto";
  const regla = String(veredicto?.regla || "").trim();
  const necesitaCodigo = String(veredicto?.necesitaCodigo || "").trim();
  if (aprendeActivo(env)) {
    const aprendido = await aprender(env, {
      tipo: ia,
      regla: regla || explicacion,
      cliente: turno.cliente,
      dijo: cita || turno.respuesta,
      correcto: correccion,
      codigo: necesitaCodigo,
    });
    return { veredicto: clave, explicacion, cita, confianza, correccion, ia, regla, necesitaCodigo, aprendido };
  }
  await alertarCentral(env, [
    { tipo: "indebida", texto: `${motivo}\nRespondió: "${String(turno.respuesta).slice(0, 200)}"`, igsid: turno.igsid },
  ]);
  return { veredicto: clave, explicacion, cita, confianza, correccion, ia, regla, necesitaCodigo };
}

const NIVELES = { baja: 0, media: 1, alta: 2 };
function confianzaSuficiente(confianza, minima) {
  const piso = NIVELES[String(minima || "alta").toLowerCase()] ?? NIVELES.alta;
  return (NIVELES[confianza] ?? NIVELES.alta) >= piso;
}
