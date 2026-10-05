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

const API = "https://api.openai.com/v1/chat/completions";
const API_DEEPSEEK = "https://api.deepseek.com/chat/completions";

const VEREDICTOS = {
  alucino: "Alucinó",
  incoherente: "Incoherente",
  no_responde: "No contestó lo que le preguntaron",
  tono: "Tono indebido",
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

ESTO ESTÁ BIEN (no lo marques nunca):
  · "Eso te lo confirma un asesor en un momento 😊" (o parecido).
  · Decir que el precio está en la foto o en la ficha.
  · Un saludo, una despedida, una pregunta para entender qué busca.
  · "De ese no tengo, pero mira estos 👇" con fichas de lo que sí hay.
  · El botón del catálogo cuando no se encontró lo que pidió.
  · Los datos de la tienda dichos con otras palabras (mismo contenido).
  · Ofrecer pasarlo con un asesor, o decir que un asesor lo atiende.
  · Una respuesta corta o sencilla: corta no es mala.

CONFIANZA:
  · "alta": lo puedes señalar con el dedo (citas la frase y sabes por qué
    está mal).
  · "media": te parece mal, pero podría estar bien con algo que no ves.
  · "baja": dudas.
Si es "bien", la confianza da igual.

Responde SOLO con este JSON:
{"pienso":"2 o 3 frases: qué pidió, qué datos dio y de dónde salen","veredicto":"bien|alucino|incoherente|no_responde|tono","confianza":"alta|media|baja","cita":"la frase EXACTA de la respuesta que está mal (vacío si está bien)","explicacion":"una frase corta en español: qué está mal y por qué"}`;

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

export function modeloDelRevisor(env) {
  return env?.REVISOR_MODELO || (conDeepSeek(env) ? env?.DEEPSEEK_MODELO_VISION || "deepseek-chat" : "gpt-4o-mini");
}

export function revisorActivo(env) {
  if (/^(no|off|false|0)$/i.test(String(env?.REVISOR_IA || "").trim())) return false;
  return conDeepSeek(env) ? Boolean(env?.DEEPSEEK_API_KEY) : Boolean(env?.OPENAI_API_KEY);
}

// La llamada, a OpenAI o a DeepSeek (las dos hablan igual). Devuelve el
// JSON de la respuesta, o null.
async function preguntar(env, modelo, mensajes) {
  const deepseek = conDeepSeek(env);
  const cuerpo = {
    model: modelo,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: mensajes,
    ...(deepseek ? { max_tokens: 400, thinking: { type: "disabled" } } : { max_completion_tokens: 400 }),
  };
  const enviar = (c) =>
    fetch(deepseek ? API_DEEPSEEK : API, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${deepseek ? env.DEEPSEEK_API_KEY : env.OPENAI_API_KEY}` },
      body: JSON.stringify(c),
      signal: AbortSignal.timeout(12000),
    });
  let r = await enviar(cuerpo);
  // Un modelo de DeepSeek que no entiende "thinking": sin él.
  if (deepseek && r.status === 400) {
    const { thinking, ...sinThinking } = cuerpo;
    r = await enviar(sinThinking);
  }
  if (!r.ok) {
    console.log(`REVISOR: ${deepseek ? "DeepSeek" : "OpenAI"} respondió ${r.status}, no reviso esta respuesta`);
    return null;
  }
  return r.json();
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
    turno.categoria ? `LA CATEGORÍA QUE PIDIÓ: ${turno.categoria}` : "",
    turno.contexto ? `\nLOS DATOS DE LA TIENDA (la verdad):\n${String(turno.contexto).slice(0, 3000)}` : "",
  ]
    .filter((linea) => linea !== "")
    .join("\n");

  const modelo = modeloDelRevisor(env);
  let datos;
  try {
    datos = await preguntar(env, modelo, [
      { role: "system", content: INSTRUCCIONES },
      { role: "user", content: contenido },
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
      modelo: `${modelo} (revisor)`,
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

  const motivo = `${VEREDICTOS[clave]}${explicacion ? ` — ${explicacion}` : ""}${cita ? ` · «${cita}»` : ""}`;
  console.log(`REVISOR: 🔴 ${motivo}`);
  await marcarTurno(env.DB, turno.id, "indebida", motivo);
  await alertarCentral(env, [
    { tipo: "indebida", texto: `${motivo}\nRespondió: "${String(turno.respuesta).slice(0, 200)}"`, igsid: turno.igsid },
  ]);
  return { veredicto: clave, explicacion, cita, confianza };
}

const NIVELES = { baja: 0, media: 1, alta: 2 };
function confianzaSuficiente(confianza, minima) {
  const piso = NIVELES[String(minima || "alta").toLowerCase()] ?? NIVELES.alta;
  return (NIVELES[confianza] ?? NIVELES.alta) >= piso;
}
