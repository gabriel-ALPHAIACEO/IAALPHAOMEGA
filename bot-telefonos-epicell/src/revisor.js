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

import { anotarGasto } from "./gasto.js";
import { marcarTurno, alertarCentral } from "./registro.js";

const API = "https://api.openai.com/v1/chat/completions";

const VEREDICTOS = {
  alucino: "Alucinó",
  incoherente: "Incoherente",
  no_responde: "No contestó lo que le preguntaron",
  tono: "Tono indebido",
};

const INSTRUCCIONES = `Eres el supervisor de calidad de una asistente virtual de ventas por Instagram.
Revisas UNA respuesta que ya se le mandó a un cliente y dices si estuvo bien.

Te llegan: la conversación reciente, lo que escribió el cliente, lo que pensó la
asistente antes de responder, lo que respondió, y los productos que se le
enseñaron en fichas (con su precio) debajo de la respuesta.

Veredictos posibles:
- "bien": la respuesta es razonable para lo que pidió. ESTE ES EL NORMAL.
- "alucino": afirma algo concreto que no sale de ningún lado: un precio,
  modelo, talla, color, stock o política que no está en las fichas ni en la
  conversación, o dice que hay algo cuando las fichas muestran otra cosa.
- "incoherente": se contradice, contradice lo que pensó, o habla de un
  producto distinto del que el cliente está preguntando.
- "no_responde": ignora la pregunta concreta del cliente y contesta otra cosa.
- "tono": grosera, burlona, regañona o fuera de lugar con el cliente.

REGLAS PARA NO EQUIVOCARTE:
- Los datos fijos de la tienda (horario, dirección, métodos de pago, Cashea,
  envíos) los pone el sistema y son correctos: NO los marques.
- "Te lo confirma un asesor" es una respuesta correcta, no la marques.
- Decir que los precios están en las fotos es correcto.
- Si dudas, es "bien". Solo marcas lo que está CLARAMENTE mal.

Responde SOLO con este JSON:
{"veredicto":"bien|alucino|incoherente|no_responde|tono","explicacion":"una frase corta en español"}`;

export function revisorActivo(env) {
  return Boolean(env?.OPENAI_API_KEY) && !/^(no|off|false|0)$/i.test(String(env?.REVISOR_IA || "").trim());
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

// turno: { id, igsid, cliente, pienso, respuesta, productos: [títulos], fichas: [líneas con precio] }
export async function revisarTurno(env, turno) {
  if (!revisorActivo(env) || !turno?.id || !String(turno.respuesta || "").trim()) return null;

  const charla = await conversacionReciente(env.DB, turno.igsid);
  const contenido = [
    "CONVERSACIÓN RECIENTE:",
    charla || "(sin más mensajes)",
    "",
    `LO QUE ESCRIBIÓ EL CLIENTE: ${turno.cliente || "(sin texto)"}`,
    `LO QUE PENSÓ LA ASISTENTE: ${turno.pienso || "(nada)"}`,
    `LO QUE RESPONDIÓ: ${turno.respuesta}`,
    `LO QUE SE LE ENSEÑÓ EN FICHAS: ${(turno.fichas || turno.productos || []).join(" | ") || "(nada)"}`,
  ].join("\n");

  const modelo = env.REVISOR_MODELO || "gpt-4o-mini";
  let datos;
  try {
    const r = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: modelo,
        temperature: 0,
        max_completion_tokens: 150,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: INSTRUCCIONES },
          { role: "user", content: contenido },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      console.log(`REVISOR: OpenAI respondió ${r.status}, no reviso esta respuesta`);
      return null;
    }
    datos = await r.json();
  } catch (error) {
    console.log("REVISOR: no pude revisar esta respuesta:", error?.message || error);
    return null;
  }

  if (datos?.usage) {
    await anotarGasto(env, {
      modelo,
      entrada: datos.usage.prompt_tokens || 0,
      cacheadas: datos.usage.prompt_tokens_details?.cached_tokens || 0,
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
  if (!VEREDICTOS[clave]) {
    console.log(`REVISOR: bien${explicacion ? ` (${explicacion})` : ""}`);
    return { veredicto: "bien", explicacion };
  }

  const motivo = `${VEREDICTOS[clave]}${explicacion ? ` — ${explicacion}` : ""}`;
  console.log(`REVISOR: 🔴 ${motivo}`);
  await marcarTurno(env.DB, turno.id, "indebida", motivo);
  await alertarCentral(env, [
    { tipo: "indebida", texto: `${motivo}\nRespondió: "${String(turno.respuesta).slice(0, 200)}"`, igsid: turno.igsid },
  ]);
  return { veredicto: clave, explicacion };
}
