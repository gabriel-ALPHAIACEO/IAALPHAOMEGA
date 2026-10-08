// Habla con fal.ai, que es quien tiene la GPU y corre los LoRA.
// Se usa la cola (queue.fal.run) y no la llamada directa porque una imagen
// con LoRA tarda de 5 a 30 segundos: en vez de esperar, fal avisa al
// terminar llamando a fal_webhook.
//
// Doc: https://fal.ai/models/fal-ai/flux-lora/api

const COLA = "https://queue.fal.run";

export async function encolar(env, entrada, webhook) {
  const url = `${env.FAL_COLA || COLA}/${env.FAL_MODELO}?fal_webhook=${encodeURIComponent(webhook)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Key ${env.FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(entrada),
  });
  if (!res.ok) throw new Error(`fal rechazo el pedido (${res.status}): ${await res.text()}`);
  // { request_id, status_url, response_url, cancel_url, queue_position }
  return res.json();
}

// Red de seguridad por si el aviso de fal nunca llega: se pregunta a mano.
// Devuelve null mientras sigue en cola o en proceso.
export async function consultar(env, urls) {
  const cabeceras = { Authorization: `Key ${env.FAL_KEY}` };
  const estado = await (await fetch(urls.status_url, { headers: cabeceras })).json();
  if (estado.status !== "COMPLETED") return null;
  if (estado.error) return { ok: false, error: String(estado.error) };
  const res = await fetch(urls.response_url, { headers: cabeceras });
  if (!res.ok) return { ok: false, error: `fal ${res.status}: ${await res.text()}` };
  return { ok: true, salida: await res.json() };
}
