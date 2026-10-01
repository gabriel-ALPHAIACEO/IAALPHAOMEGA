// QUE RESPONDA EN INSTAGRAM: /probar-instagram tiene que decir en qué paso
// se corta el camino —token, suscripción, llegada, firma, envío— y qué hacer.
//
// Instagram es de mentira (se cambia fetch). Lo que se prueba es lo nuestro:
// que cada paso quede apuntado y que el diagnóstico señale el correcto.

import { prepararSrc, baseDeMentira, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const { default: worker } = await src.cargar("index.js");
const R = await src.cargar("rastro.js");

const SECRETO = "secreto-instagram-de-prueba-123";
const CUENTA = "17841400000000001";

// Instagram de mentira: qué cuenta es la del token, si está suscrita, y si
// acepta los envíos.
function instagramDeMentira({ tokenMalo = false, suscrita = true, envioMalo = false } = {}) {
  const estado = { suscrita, pedidas: [] };
  const fetchFalso = async (url, opciones = {}) => {
    const u = new URL(String(url));
    const metodo = opciones.method || "GET";
    estado.pedidas.push(`${metodo} ${u.pathname}`);
    if (u.hostname !== "graph.instagram.com") return new Response("{}", { status: 200 });
    if (tokenMalo) return new Response(JSON.stringify({ error: { message: "Invalid OAuth access token", code: 190 } }), { status: 400 });
    if (u.pathname.endsWith("/me") && metodo === "GET")
      return Response.json({ user_id: CUENTA, username: "elemperador", name: "El Emperador", account_type: "BUSINESS", id: "999" });
    if (u.pathname.endsWith("/me/subscribed_apps")) {
      if (metodo === "POST") { estado.suscrita = true; return Response.json({ success: true }); }
      return Response.json({ data: estado.suscrita ? [{ subscribed_fields: ["messages", "messaging_postbacks"] }] : [] });
    }
    if (u.pathname.endsWith("/me/messages")) {
      if (envioMalo) return new Response(JSON.stringify({ error: { message: "Error validating access token", code: 190 } }), { status: 400 });
      return Response.json({ message_id: "mid.bot" });
    }
    return Response.json({});
  };
  return { estado, fetchFalso };
}

async function firmar(cuerpo) {
  const clave = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRETO), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(cuerpo));
  return "sha256=" + [...new Uint8Array(firma)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function llamar(env, ruta, { metodo = "GET", cuerpo, firma } = {}, mentira) {
  const real = globalThis.fetch, log = console.log, err = console.error;
  globalThis.fetch = mentira.fetchFalso;
  console.log = () => {}; console.error = () => {};
  const pendientes = [];
  try {
    const headers = firma ? { "x-hub-signature-256": firma } : {};
    const r = await worker.fetch(new Request(`https://emperador.test${ruta}`, { method: metodo, body: cuerpo, headers }), env, { waitUntil: (p) => pendientes.push(p) });
    const texto = await r.text();
    await Promise.allSettled(pendientes);
    return { estado: r.status, texto };
  } finally { globalThis.fetch = real; console.log = log; console.error = err; }
}

function entorno(extra = {}) {
  R.olvidarTabla();
  return { DB: baseDeMentira().DB, IG_TOKEN: "token", META_APP_SECRET_IG: SECRETO, META_VERIFY_TOKEN: "emperador2026", META_MODO: "todo", ...extra };
}

const visto = JSON.stringify({ object: "instagram", entry: [{ id: CUENTA, messaging: [{ sender: { id: "1" }, recipient: { id: CUENTA }, read: { mid: "x" } }] }] });

titulo("sin IG_TOKEN: lo dice y da el comando");
{
  const m = instagramDeMentira();
  const { texto } = await llamar(entorno({ IG_TOKEN: "" }), "/probar-instagram", {}, m);
  ok(/IG_TOKEN[\s\S]*NO está cargado/.test(texto) && /wrangler secret put IG_TOKEN/.test(texto), "dice que falta y cómo cargarlo");
}

titulo("token rechazado: dice que hay que generarlo de nuevo");
{
  const m = instagramDeMentira({ tokenMalo: true });
  const { texto } = await llamar(entorno(), "/probar-instagram", {}, m);
  ok(/Instagram lo rechaza/.test(texto) && /Generar token/.test(texto), "explica dónde se genera");
}

titulo("token bueno: enseña de qué cuenta es");
{
  const m = instagramDeMentira();
  const { texto } = await llamar(entorno(), "/probar-instagram", {}, m);
  ok(/@elemperador/.test(texto) && texto.includes(CUENTA), "sale el @ y el id de la cuenta");
  ok(/suscrita a: messages/.test(texto), "y que está suscrita a los mensajes");
  ok(/todavía NO ha mandado nada/.test(texto) && /emperador\.test\/webhook/.test(texto) && /modo Live/.test(texto),
     "si Meta no ha mandado nada: la URL exacta del webhook y lo del modo Live");
}

titulo("cuenta sin suscribir: lo detecta y ?suscribir=si la suscribe");
{
  const m = instagramDeMentira({ suscrita: false });
  const env = entorno();
  const antes = await llamar(env, "/probar-instagram", {}, m);
  ok(/NO está suscrita/.test(antes.texto) && /suscribir=si/.test(antes.texto), "dice que no lo está y el enlace para arreglarlo");
  ok(!m.estado.pedidas.includes("POST /v23.0/me/subscribed_apps"), "mirar la página NO suscribe nada por su cuenta");
  const despues = await llamar(env, "/probar-instagram?suscribir=si", {}, m);
  ok(/La suscribí ahora/.test(despues.texto) && /suscrita a: messages/.test(despues.texto), "con ?suscribir=si queda suscrita");
}

titulo("llega un aviso con la firma equivocada: apunta y dice qué clave cargar");
{
  const m = instagramDeMentira();
  const env = entorno();
  const r = await llamar(env, "/webhook", { metodo: "POST", cuerpo: visto, firma: "sha256=" + "0".repeat(64) }, m);
  ok(r.estado === 200, "a Meta se le sigue respondiendo 200");
  const { texto } = await llamar(env, "/probar-instagram", {}, m);
  ok(/Último aviso de Meta\s+hace menos de un minuto/.test(texto), "apunta que llegó el aviso");
  ok(/firma no cuadra/.test(texto) && /META_APP_SECRET_IG/.test(texto), "y que la firma no cuadra, con el comando");
}

titulo("firma buena pero era un 'visto': descartado, sin alarma");
{
  const m = instagramDeMentira();
  const env = entorno();
  await llamar(env, "/webhook", { metodo: "POST", cuerpo: visto, firma: await firmar(visto) }, m);
  const { texto } = await llamar(env, "/probar-instagram", {}, m);
  ok(/Descartado \(no era mensaje\)\s+hace menos de un minuto — instagram: read · cuenta/.test(texto), "apunta el descarte y qué era", (texto.match(/Descartado.*/) || [""])[0]);
  ok(!/firma no cuadra/.test(texto), "no dice que la firma falle");
}

titulo("avisos de OTRA cuenta que la del token: lo señala");
{
  const m = instagramDeMentira();
  const env = entorno();
  const otro = visto.replaceAll(CUENTA, "17841499999999999");
  await llamar(env, "/webhook", { metodo: "POST", cuerpo: otro, firma: await firmar(otro) }, m);
  const { texto } = await llamar(env, "/probar-instagram", {}, m);
  ok(/el token es de otra cuenta/.test(texto), "dice que el token es de otra cuenta");
}

titulo("Instagram rechaza la respuesta: apunta el motivo");
{
  const m = instagramDeMentira({ envioMalo: true });
  const env = entorno();
  const I = await src.cargar("instagram.js");
  const real = globalThis.fetch, err = console.error;
  globalThis.fetch = m.fetchFalso; console.error = () => {};
  await I.enviarTexto(env, "123", "hola");
  globalThis.fetch = real; console.error = err;
  const { texto } = await llamar(env, "/probar-instagram", {}, instagramDeMentira());
  ok(/Envío RECHAZADO\s+hace menos de un minuto — Instagram respondió 400/.test(texto), "apunta el rechazo con lo que dijo Instagram");
  ok(/rechaza la respuesta/.test(texto), "y lo pone en QUÉ HACER");
}

titulo("el rastro nunca rompe al bot");
{
  const caida = { prepare() { throw new Error("D1 caída"); } };
  R.olvidarTabla();
  const err = console.error; console.error = () => {};
  let rompio = false;
  try { await R.anotar({ DB: caida }, "llegada", "x"); } catch { rompio = true; }
  console.error = err;
  ok(!rompio, "con la base caída, anotar no lanza");
  ok(R.hace(0) === "nunca" && R.hace(Date.now() - 3 * 3600e3) === "hace 3 h", "y las horas se leen bien");
}

src.limpiar();
terminar();
