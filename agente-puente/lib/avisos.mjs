// LOS AVISOS DEL PROPIO AGENTE. Una tienda con ALPHA IA ya avisa sola (por el
// latido). Pero si el stock va a otra plataforma, nadie más se entera de un
// error: el agente puede avisar él mismo a Slack, Teams, Google Chat, Discord o
// cualquier dirección que reciba un JSON.
//
//   "avisos": { "webhook": "${ENV:SLACK_WEBHOOK}", "formato": "slack" }
//
// formato "slack" (también sirve para Google Chat y Mattermost): { "text": "…" }
// formato "teams": { "text": "…" } · "discord": { "content": "…" } ·
// "json": { agente, origen, equipo, estado, mensaje, cuando }.
//
// Igual que en la tienda: un error se avisa una vez (el mismo, a las 6 horas;
// uno distinto, enseguida) y cuando vuelve a funcionar, también. Lo recuerda en
// estado-puente.json. Un agente APAGADO no puede avisar de sí mismo: eso solo lo
// ve una tienda con ALPHA IA (que nota que no le llega el latido).

import { expandirEntorno } from "./secretos.mjs";
import { pedir } from "./destinos.mjs";

export const REPETIR_AVISO_MS = 6 * 60 * 60 * 1000;

function cuerpoDelAviso(formato, texto, datos) {
  if (formato === "discord") return { content: texto };
  if (formato === "json") return { ...datos, mensaje: texto };
  return { text: texto };
}

// estado: el de estado-puente.json (se modifica). resultado: { ok, mensaje }.
// Devuelve el texto avisado, o "" si no tocaba avisar.
export async function avisarSiHaceFalta(config, estado, resultado, { hacer = globalThis.fetch, registrar = () => {}, ahora = Date.now() } = {}) {
  const url = expandirEntorno(config.avisos?.webhook || "");
  if (!url) return "";
  const nombre = `${config.origen || config.agente}${config.equipo ? ` (${config.equipo})` : ""}`;
  let texto = "";
  if (!resultado.ok) {
    const antes = estado.aviso || null;
    const mismo = antes && String(antes.texto || "").slice(0, 60) === String(resultado.mensaje || "").slice(0, 60);
    if (!antes || !mismo || ahora - Number(antes.en) > REPETIR_AVISO_MS) {
      texto = `🔌 El agente puente de ${nombre} tiene un error: ${resultado.mensaje}. El stock no se pudo pasar.`;
      estado.aviso = { en: ahora, texto: String(resultado.mensaje || "") };
    }
  } else if (estado.aviso) {
    texto = `✅ El agente puente de ${nombre} volvió a funcionar${resultado.mensaje ? `: ${resultado.mensaje}` : ""}.`;
    delete estado.aviso;
  }
  if (!texto) return "";
  const formato = String(config.avisos?.formato || "slack").toLowerCase();
  const datos = { agente: config.agente, origen: config.origen || "", equipo: config.equipo || "", estado: resultado.ok ? "ok" : "error", cuando: new Date(ahora).toISOString() };
  try {
    const r = await pedir(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpoDelAviso(formato, texto, datos)) }, { hacer, intentos: 2, segundos: 15, quien: "la dirección de los avisos" });
    if (r.estado >= 300) registrar(`El aviso no entró (${r.estado}).`);
  } catch (error) {
    registrar(`El aviso no salió: ${error.message}`);
  }
  return texto;
}
