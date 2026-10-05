// EL PANEL CENTRAL, DE PUNTA A PUNTA.
//
// No hay tiendas de mentira: se levantan DOS copias del Invictus de verdad
// (invictus-bot/src), cada una con su propia base SQLite, y una tercera
// tienda que no responde. El panel central habla con ellas por un fetch
// que enruta cada dirección a su Worker, igual que haría internet. Así se
// prueba lo que importa: que lo que pide el central es lo que la tienda
// contesta, y que lo que la tienda avisa le llega al central.
//
// Instagram, OpenAI y Shopify sí son de mentira.
//
//   node pruebas/central.mjs      (desde panel-central/, Node 22+)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { prepararSrc, baseDeMentira, ok, titulo, terminar } from "../../invictus-bot/pruebas/ayuda.mjs";

// El panel central se copia aparte con su package.json (ver ayuda.mjs).
const copia = fs.mkdtempSync(path.join(os.tmpdir(), "pruebas-central-"));
fs.writeFileSync(path.join(copia, "package.json"), '{"type":"module"}');
for (const f of fs.readdirSync(path.join(import.meta.dirname, "..", "src"))) {
  fs.copyFileSync(path.join(import.meta.dirname, "..", "src", f), path.join(copia, f));
}
const C = await import(pathToFileURL(path.join(copia, "index.js")).href);
const central = C.default;

const SECRETO = "secreto-de-prueba";
const K1 = "clave-larga-de-invictus-1234";
const K2 = "clave-larga-de-la-otra-5678";
const K3 = "clave-larga-de-la-caida-9012";
const CLAVE = "clave-central-de-prueba";

const tienda1 = await prepararSrc();
const tienda2 = await prepararSrc();
const W1 = (await tienda1.cargar("index.js")).default;
const W2 = (await tienda2.cargar("index.js")).default;
const BASE1 = baseDeMentira();
const BASE2 = baseDeMentira();
const BASE_C = baseDeMentira();

const comun = {
  META_APP_SECRET: SECRETO, META_MODO: "todo", IG_TOKEN: "x", OPENAI_API_KEY: "x",
  SHOPIFY_TIENDA: "tienda.test", SHOPIFY_TOKEN: "x", URL_CATALOGO: "https://tienda.test",
  PAUSA_HORAS: "1", REVISOR_IA: "no", PANEL_CENTRAL_URL: "https://central.test",
};
const ENV1 = { ...comun, DB: BASE1.DB, TIENDA_NOMBRE: "Invictus Shoes", PANEL_API_CLAVE: K1, TIENDA_ID: "invictus" };
const ENV2 = { ...comun, DB: BASE2.DB, TIENDA_NOMBRE: "Otra", PANEL_API_CLAVE: K2, TIENDA_ID: "otra" };
const ENV_C = {
  DB: BASE_C.DB,
  PANEL_CLAVE: CLAVE,
  TIENDAS: JSON.stringify([
    { id: "invictus", nombre: "Invictus", url: "https://invictus.test" },
    { id: "otra", nombre: "Otra tienda", url: "https://otra.test/" },
    { id: "caida", nombre: "La Caída", url: "https://caida.test" },
  ]),
  CLAVE_INVICTUS: K1,
  CLAVE_OTRA: K2,
  CLAVE_CAIDA: K3,
};

let caidaViva = false;
let caidaVieja = false; // la tienda con la versión vieja: a todo responde 200 "ok"
let caida1042 = false; // lo que contesta Cloudflare a un Worker que llama a otro de su misma cuenta
let modelo = { pienso: "", mostrar: "texto", voz: false, respuesta: "Hola", buscar: "NADA", historial: "" };
const tareas = [];
const ctx = { waitUntil: (p) => tareas.push(p) };

globalThis.fetch = async (url, op = {}) => {
  const u = new URL(String(url?.url || url));
  const pedido = () => new Request(u, { method: op.method || "GET", headers: op.headers, body: op.body });
  if (u.host === "invictus.test") return W1.fetch(pedido(), ENV1, ctx);
  if (u.host === "otra.test") return W2.fetch(pedido(), ENV2, ctx);
  if (u.host === "caida.test") {
    if (caidaVieja) return new Response("ok", { status: 200 });
    if (caida1042) return new Response("error code: 1042", { status: 404 });
    if (!caidaViva) throw new TypeError("fetch failed");
    return new Response(JSON.stringify({ ok: true, version: "2026-10-02 (9) · volvió" }), { status: 200 });
  }
  if (u.host === "central.test") return central.fetch(pedido(), ENV_C, ctx);
  if (u.host === "api.openai.com") {
    const contenido = typeof modelo === "string" ? modelo : JSON.stringify(modelo);
    return new Response(JSON.stringify({ choices: [{ message: { content: contenido } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
  }
  if (u.host === "graph.instagram.com" && u.pathname.includes("/messages")) return new Response(JSON.stringify({ message_id: `mid-${Math.random()}` }), { status: 200 });
  if (u.host === "graph.instagram.com") return new Response(JSON.stringify({ name: "Ana Pérez", username: "ana" }), { status: 200 });
  if (u.pathname.endsWith("/graphql.json")) return new Response(JSON.stringify({ data: { products: { edges: [], pageInfo: { hasNextPage: false } } } }), { status: 200 });
  return new Response("ok", { status: 200 });
};

async function callado(fn) {
  const [l, e] = [console.log, console.error];
  console.log = console.error = () => {};
  try {
    return await fn();
  } finally {
    console.log = l;
    console.error = e;
  }
}

async function esperarTareas() {
  while (tareas.length) await Promise.all(tareas.splice(0));
}

// Un cliente le escribe a Invictus por Instagram.
async function escribe(texto, respuesta, igsid = "123") {
  modelo = respuesta;
  const cuerpo = JSON.stringify({ object: "instagram", entry: [{ id: "999", time: Date.now(), messaging: [{ sender: { id: igsid }, recipient: { id: "999" }, timestamp: Date.now(), message: { mid: `m-${Math.random()}`, text: texto } }] }] });
  const firma = "sha256=" + crypto.createHmac("sha256", SECRETO).update(cuerpo).digest("hex");
  await callado(async () => {
    await W1.fetch(new Request("https://invictus.test/webhook", { method: "POST", headers: { "x-hub-signature-256": firma }, body: cuerpo }), ENV1, ctx);
    await esperarTareas();
  });
}

// El dueño, desde el navegador.
let galleta = "";
async function abrir(ruta, { metodo = "GET", form = null, origen = "https://central.test", ip = "1.1.1.1", sinSesion = false } = {}) {
  const headers = { "cf-connecting-ip": ip };
  if (galleta && !sinSesion) headers.cookie = galleta;
  if (metodo === "POST" && origen) headers.origin = origen;
  let body = null;
  if (form) {
    body = new URLSearchParams(form).toString();
    headers["content-type"] = "application/x-www-form-urlencoded";
  }
  const r = await callado(async () => {
    const x = await central.fetch(new Request(`https://central.test${ruta}`, { method: metodo, headers, body }), ENV_C, ctx);
    await esperarTareas();
    return x;
  });
  const tipo = r.headers.get("content-type") || "";
  return { estado: r.status, r, html: tipo.includes("html") || tipo.includes("text/plain") ? await r.text() : "", datos: tipo.includes("json") ? await r.json() : null };
}

/* ─────────────────────────────────────────────────────────────────── */

titulo("entrar");
{
  const estado = await abrir("/estado", { sinSesion: true });
  ok(estado.estado === 200 && estado.html.includes(C.VERSION) && /Tiendas: 3/.test(estado.html), "/estado dice la versión, sin sesión", estado.html.split("\n")[0]);
  ok(!/clave-larga|clave-central/.test(estado.html), "/estado no enseña ninguna clave");

  const sin = await abrir("/", { sinSesion: true });
  ok(/clave del panel central/.test(sin.html) && !/Invictus/.test(sin.html), "sin sesión, solo la entrada (no se ve ninguna tienda)");
  ok((await abrir("/vivo", { sinSesion: true })).estado === 401, "/vivo sin sesión: 401");
  ok((await abrir("/t/invictus/bases", { sinSesion: true })).html.includes("clave del panel central"), "las bases, sin sesión: la entrada");

  const corta = await callado(() => central.fetch(new Request("https://central.test/"), { ...ENV_C, PANEL_CLAVE: "corta" }, ctx));
  ok(/falta su clave/.test(await corta.text()), "con una PANEL_CLAVE de menos de 12 letras, cerrado");

  for (let i = 0; i < 8; i++) await abrir("/entrar", { metodo: "POST", form: { clave: "no-es" }, ip: "6.6.6.6" });
  const frenado = await abrir("/entrar", { metodo: "POST", form: { clave: CLAVE }, ip: "6.6.6.6" });
  ok(/Demasiadas/.test(frenado.html) && !frenado.r.headers.get("set-cookie"), "tras 8 claves equivocadas, ni la buena entra durante 15 minutos");

  // Lo que manda Chrome de verdad desde la página de entrada (sin referrer):
  // Origin "null" y Sec-Fetch-Site same-origin. El 2-oct esto decía "No".
  const comoChrome = await callado(() => central.fetch(new Request("https://central.test/entrar", { method: "POST", headers: { origin: "null", "sec-fetch-site": "same-origin", "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": "2.2.2.2" }, body: `clave=${encodeURIComponent(CLAVE)}` }), ENV_C, ctx));
  ok(comoChrome.status === 303 && /central=/.test(comoChrome.headers.get("set-cookie") || ""), "entrar como lo hace Chrome (Origin null, same-origin) funciona", String(comoChrome.status));
  const cruzada = await callado(() => central.fetch(new Request("https://central.test/entrar", { method: "POST", headers: { origin: "null", "sec-fetch-site": "cross-site", "content-type": "application/x-www-form-urlencoded" }, body: `clave=${encodeURIComponent(CLAVE)}` }), ENV_C, ctx));
  ok(cruzada.status === 403, "pero desde otra web (cross-site), no");

  const ajena = await abrir("/entrar", { metodo: "POST", form: { clave: CLAVE }, origen: "https://malo.test" });
  ok(ajena.estado === 403, "entrar desde otra web: no");

  const bien = await abrir("/entrar", { metodo: "POST", form: { clave: CLAVE } });
  const cookie = bien.r.headers.get("set-cookie") || "";
  ok(bien.estado === 303 && /HttpOnly/.test(cookie) && /Secure/.test(cookie) && /SameSite=Strict/.test(cookie), "con la clave: cookie HttpOnly, Secure, SameSite=Strict", cookie.slice(0, 60));
  galleta = cookie.split(";")[0];

  const [nombre, valor] = galleta.split("=");
  const falsa = `${nombre}=${String(Date.now() + 9e9)}.${valor.split(".")[1]}`;
  const conFalsa = await callado(() => central.fetch(new Request("https://central.test/", { headers: { cookie: falsa } }), ENV_C, ctx));
  ok(/clave del panel central/.test(await conFalsa.text()), "una cookie con la fecha cambiada no vale (la firma no cuadra)");
}

titulo("inicio: todas las tiendas");
{
  await escribe("hola tienen jordan 4?", { pienso: "Pide Jordan 4: busco.", mostrar: "texto", voz: false, respuesta: "¡Hola! Déjame ver 👀", buscar: "NADA", historial: "Pidió Jordan 4." });
  await escribe("<script>alert(1)</script> y en negro?", { pienso: "Pregunta negro.", mostrar: "texto", voz: false, respuesta: "En negro también 👌", buscar: "NADA", historial: "Pidió negro." });

  const inicio = await abrir("/");
  ok(inicio.estado === 200 && /Invictus/.test(inicio.html) && /Otra tienda/.test(inicio.html), "salen las tiendas");
  ok(/🚨 La Caída/.test(inicio.html) && /no respondió|fetch failed/.test(inicio.html), "la que no responde sale con 🚨 y el motivo");
  ok(/tiendas funcionando/.test(inicio.html) && />2 \/ 3</.test(inicio.html), "2 de 3 funcionando");
  ok(/<b>1<\/b> clientes/.test(inicio.html), "los clientes de hoy de Invictus", (inicio.html.match(/Hoy:[^<]*<b>\d+<\/b>[^<]*/) || [""])[0]);
  const csp = inicio.r.headers.get("content-security-policy") || "";
  ok(/default-src 'none'/.test(csp) && /frame-ancestors 'none'/.test(csp), "con CSP: nada de fuera");
  ok(/id="sinleer"/.test(inicio.html) && /\/vivo\?desde=/.test(inicio.html), "la campana y el sondeo en tiempo real van en cada página");
}

titulo("alertas en tiempo real");
{
  const antes = (await abrir("/vivo?primera=1")).datos;
  ok(antes && antes.ultimo === 0 && antes.nuevas.length === 0, "la primera vez /vivo solo dice por dónde va (aún no hay ninguna)");

  // La IA no responde: la tienda marca ❌ y se lo dice al central.
  await escribe("y tienen crocs?", "esto no es json");
  const luego = (await abrir(`/vivo?desde=${antes.ultimo}`)).datos;
  const error = luego.nuevas.find((a) => a.simbolo === "❌");
  ok(error && error.tienda === "Invictus" && error.enlace === "/t/invictus/c/123", "un fallo en la tienda llega al central al momento, con enlace al chat", JSON.stringify(luego.nuevas));
  ok(luego.sinLeer >= 1, "la campana cuenta las no leídas");

  // Una queja del cliente: 👎
  await escribe("no es eso lo que te pregunté", { pienso: "Se queja.", mostrar: "texto", voz: false, respuesta: "Disculpa 🙏 ¿Qué estás buscando?", buscar: "NADA", historial: "Se quejó." });
  const queja = (await abrir(`/vivo?desde=${luego.ultimo}`)).datos;
  ok(queja.nuevas.some((a) => a.simbolo === "👎"), "una queja también llega", JSON.stringify(queja.nuevas.map((a) => a.simbolo)));

  // Por la clave se sabe la tienda, diga lo que diga el mensaje.
  const enviar = (clave, cuerpo) => callado(() => central.fetch(new Request("https://central.test/api/alerta", { method: "POST", headers: { authorization: `Bearer ${clave}` }, body: JSON.stringify(cuerpo) }), ENV_C, ctx));
  const mala = await enviar("clave-inventada-que-no-existe", { alertas: [{ tipo: "error", texto: "hola" }] });
  ok(mala.status === 401, "una alerta con una clave que no es de ninguna tienda: 401");
  await enviar(K2, { tienda: "invictus", alertas: [{ tipo: "indebida", texto: "Alucinó — un precio" }] });
  await enviar(K2, { tienda: "invictus", alertas: [{ tipo: "indebida", texto: "Alucinó — un precio" }] });
  const fila = BASE_C.sql.prepare("SELECT tienda, veces FROM alertas WHERE texto LIKE 'Alucinó — un precio%'").get();
  ok(fila?.tienda === "otra", "la alerta queda en la tienda de la clave, no en la que dice el cuerpo");
  ok(fila?.veces === 2, "la misma alerta dos veces en 10 minutos no se duplica: ×2");

  const lista = await abrir("/alertas");
  ok(/❌/.test(lista.html) && /👎/.test(lista.html) && /🔴/.test(lista.html) && /×2/.test(lista.html), "/alertas las enseña con su símbolo");
  ok((await abrir("/vivo")).datos.sinLeer === 0, "verlas las da por leídas");
}

titulo("en vivo: los mensajes entrando");
{
  const primera = (await abrir("/en-vivo/datos?c=%7B%7D")).datos;
  ok(primera.eventos.some((e) => e.tipo === "mensaje" && e.de === "cliente" && /jordan 4/.test(e.texto)), "la primera vez: los últimos mensajes de todas las tiendas");
  ok(primera.eventos.some((e) => e.tipo === "turno" && /Jordan 4/.test(e.pienso)), "con lo que pensó la IA");
  ok(primera.eventos.every((e) => e.tiendaNombre && e.nombre && e.enlace.startsWith("/t/")), "cada uno con su tienda, el nombre del cliente y el enlace");
  ok(primera.eventos.some((e) => e.nombre === "Ana Pérez"), "el nombre del cliente sale de la base de la tienda");
  ok(primera.caidas.includes("La Caída") && !primera.cursor.caida, "la tienda caída no frena a las demás");
  ok(primera.eventos.every((e, i, a) => !i || a[i - 1].cuando <= e.cuando), "ordenados del más viejo al más nuevo");
  ok(primera.eventos.some((e) => e.tipo === "turno" && e.marca === "error"), "un turno ❌ trae su marca");

  const c = encodeURIComponent(JSON.stringify(primera.cursor));
  const nada = (await abrir(`/en-vivo/datos?c=${c}`)).datos;
  ok(nada.eventos.length === 0, "sin nada nuevo, no repite nada");

  await escribe("tienen talla 42?", { pienso: "Pide talla 42.", mostrar: "texto", voz: false, respuesta: "Sí, hay en 42 👟", buscar: "NADA", historial: "Talla 42." }, "456");
  const nuevo = (await abrir(`/en-vivo/datos?c=${c}`)).datos;
  ok(nuevo.eventos.length >= 3 && nuevo.eventos.every((e) => e.tiendaNombre === "Invictus"), "llega solo lo nuevo", JSON.stringify(nuevo.eventos.map((e) => e.texto || e.pienso)));
  ok(nuevo.eventos[0].tipo === "mensaje" && nuevo.eventos[0].de === "cliente", "primero lo que escribió el cliente");

  const turno = nuevo.eventos.find((e) => e.tipo === "turno");
  const id = Number(turno.clave.split(":")[1]);
  BASE1.sql.prepare("UPDATE turnos SET marca = 'indebida', motivo = 'Incoherente — prueba' WHERE id = ?").run(id);
  const marca = (await abrir(`/en-vivo/datos?c=${encodeURIComponent(JSON.stringify(nuevo.cursor))}`)).datos;
  ok(marca.marcas.some((m) => m.clave === turno.clave && m.marca === "indebida"), "el 🔴 del revisor, que llega después, se le pone al turno ya enseñado");

  const solo = (await abrir(`/en-vivo/datos?tienda=otra&c=%7B%7D`)).datos;
  ok(solo.eventos.length === 0 && Object.keys(solo.cursor).join() === "otra", "filtrado por tienda");

  const pagina = await abrir("/en-vivo");
  ok(/id="vivo-lista"/.test(pagina.html) && /textContent/.test(pagina.html) && /visibilityState/.test(pagina.html), "la página: se llena sola, con textContent, y solo con la pestaña a la vista");
  ok(/🟢 En vivo/.test((await abrir("/t/invictus/en-vivo")).html), "y la pestaña En vivo de cada tienda");
}

titulo("una tienda: chats y conversación");
{
  const chats = await abrir("/t/invictus/chats");
  ok(/Ana Pérez/.test(chats.html) && /\/t\/invictus\/c\/123/.test(chats.html), "la lista de chats");
  ok(/❌/.test(chats.html) && /👎/.test(chats.html), "con los símbolos de los problemas");

  const conv = await abrir("/t/invictus/c/123");
  ok(/Lo que pensó la IA/.test(conv.html) && /Pide Jordan 4/.test(conv.html), "la conversación, con lo que pensó la IA");
  ok(/class="recorrido"/.test(conv.html) && /🔎/.test(conv.html), "y el recorrido de cada respuesta");
  ok(!conv.html.includes("<script>alert(1)") && conv.html.includes("&lt;script&gt;alert(1)"), "lo que escribe un cliente nunca sale como HTML");
  ok(/data-marca="\/t\/invictus\/marca"/.test(conv.html) && /data-zona="conversacion"/.test(conv.html), "abierta, se pone al día sola en cuanto hay un mensaje nuevo (solo la zona de la conversación)");
  const m1 = (await abrir("/t/invictus/marca")).datos;
  ok(m1 && /^invictus:\d+-\d+$/.test(m1.marca), "la marca de novedades: el último mensaje y turno de la tienda", JSON.stringify(m1));
  await escribe("y tienen en blanco?", { pienso: "Blanco.", mostrar: "texto", voz: false, respuesta: "¡Sí! 👟", buscar: "NADA", historial: "Blanco." });
  const m2 = (await abrir("/t/invictus/marca")).datos;
  ok(m2.marca !== m1.marca, "llega un mensaje: la marca cambia (y la página se pone al día)", `${m1.marca} → ${m2.marca}`);
  const todas = (await abrir("/marca")).datos;
  ok(/invictus:\d+-\d+/.test(todas.marca) && /caida:x/.test(todas.marca), "la marca de todas las tiendas (para el inicio)", todas.marca);
  ok((await abrir("/t/invictus/marca", { sinSesion: true })).estado !== 200 || !(await abrir("/t/invictus/marca", { sinSesion: true })).datos, "sin sesión, la marca no se da");

  const ajena = await abrir("/t/invictus/pausar", { metodo: "POST", form: { id: "123" }, origen: "https://malo.test" });
  ok(ajena.estado === 403, "pausar desde otra web: no");
  const pausa = await abrir("/t/invictus/pausar", { metodo: "POST", form: { id: "123" } });
  const fila = BASE1.sql.prepare("SELECT pausado_hasta FROM contactos WHERE id = '123'").get();
  ok(pausa.estado === 303 && fila.pausado_hasta > Date.now(), "pausar el bot desde el central pausa la tienda de verdad");
  await abrir("/t/invictus/devolver", { metodo: "POST", form: { id: "123" } });
  ok(BASE1.sql.prepare("SELECT pausado_hasta FROM contactos WHERE id = '123'").get().pausado_hasta <= Date.now(), "y devolvérselo");
}

titulo("despausar: en pausa, desde la lista y todas de una vez");
{
  await abrir("/t/invictus/pausar", { metodo: "POST", form: { id: "123" } });
  await abrir("/t/invictus/pausar", { metodo: "POST", form: { id: "456" } });
  const pausa = BASE1.sql.prepare("SELECT COUNT(*) AS n FROM contactos WHERE pausado_hasta > ?").get(Date.now()).n;
  ok(pausa === 2, "dos personas en pausa en Invictus");

  const lista = await abrir("/en-pausa");
  ok(/⏸️ En pausa/.test(lista.html) && /Invictus <span class="suave">· 2 en pausa/.test(lista.html), "/en-pausa: las personas en pausa de todas las tiendas");
  ok(/Otra tienda <span class="suave">· 0 en pausa/.test(lista.html) && /Nadie en pausa ✅/.test(lista.html), "las tiendas sin nadie en pausa lo dicen");
  ok((lista.html.match(/Devolverle la conversación al bot/g) || []).length === 2 && /Devolverle todas al bot \(2\)/.test(lista.html), "cada una con su botón, y devolver todas");
  ok(/⏸️ bot en pausa hasta/.test(lista.html), "con hasta cuándo");

  const chats = await abrir("/t/invictus/chats?f=pausados");
  ok(/name="volver" value="\/t\/invictus\/chats\?f=pausados"/.test(chats.html), "en la lista de chats de la tienda también, y vuelve a la misma lista");

  const una = await abrir("/t/invictus/devolver", { metodo: "POST", form: { id: "456", volver: "/en-pausa" } });
  ok(una.estado === 303 && una.r.headers.get("location") === "/en-pausa", "devolver una vuelve a /en-pausa");
  ok(BASE1.sql.prepare("SELECT pausado_hasta FROM contactos WHERE id = '456'").get().pausado_hasta <= Date.now(), "y la tienda la despausa de verdad");

  await abrir("/t/invictus/pausar", { metodo: "POST", form: { id: "456" } });
  const otraWeb = await abrir("/t/invictus/devolver", { metodo: "POST", form: { id: "456", volver: "//malo.test/x" } });
  ok(otraWeb.r.headers.get("location") === "/t/invictus/c/456", "un 'volver' a otra web no se sigue", otraWeb.r.headers.get("location"));

  const todas = await abrir("/t/invictus/devolver-todos", { metodo: "POST", form: { volver: "/en-pausa" } });
  ok(todas.r.headers.get("location") === "/en-pausa" && BASE1.sql.prepare("SELECT COUNT(*) AS n FROM contactos WHERE pausado_hasta > ?").get(Date.now()).n === 0, "devolver todas de una vez");
  ok(/devolvió la conversación al bot desde el panel central/.test(BASE1.sql.prepare("SELECT historial FROM contactos WHERE id = '123'").get().historial), "con la nota en el historial");
  ok((await abrir("/t/invictus/devolver-todos", { metodo: "POST", origen: "https://malo.test" })).estado === 403, "devolver todas desde otra web: no");
  ok(/⏸️ en pausa · ver y devolver al bot/.test((await abrir("/")).html), "el inicio dice cuántos hay en pausa y lleva a la página");

  const nadie = await abrir("/t/no-existe");
  ok(/No hay ninguna tienda/.test(nadie.html), "una tienda que no está en TIENDAS");
  const caida = await abrir("/t/caida");
  ok(/No pude leer esta tienda/.test(caida.html), "la tienda caída explica qué pasa");
}

titulo("escribirle al cliente desde el panel central");
{
  BASE1.sql.prepare("UPDATE contactos SET pausado_hasta = 0 WHERE id = '123'").run();
  const conv = await abrir("/t/invictus/c/123");
  ok(/Escribirle tú/.test(conv.html) && /action="\/t\/invictus\/enviar"/.test(conv.html), "la conversación trae el cuadro para escribir");
  const r = await abrir("/t/invictus/enviar", { metodo: "POST", form: { id: "123", texto: "Hola, te escribe el dueño desde el panel 😊" } });
  ok(r.estado === 303 && /aviso=ok/.test(r.r.headers.get("location") || ""), "se manda y vuelve con el aviso", r.r.headers.get("location"));
  ok(BASE1.sql.prepare("SELECT pausado_hasta FROM contactos WHERE id = '123'").get().pausado_hasta > Date.now(), "en la tienda, el bot queda en pausa con ese cliente");
  ok(BASE1.sql.prepare("SELECT COUNT(*) AS n FROM mensajes WHERE igsid = '123' AND de = 'asesor' AND texto LIKE '%desde el panel%'").get().n === 1, "y el mensaje queda en la conversación (como asesor)");
  const vista = await abrir("/t/invictus/c/123?aviso=ok");
  ok(/✅ Enviado/.test(vista.html) && vista.html.indexOf("✅ Enviado") > vista.html.indexOf('data-zona="conversacion"') && vista.html.indexOf("Escribirle tú") > vista.html.lastIndexOf("</div>\n<h3 id=\"escribir\""), "con el aviso, fuera de la zona que se actualiza (no se borra)");
  const ajena = await abrir("/t/invictus/enviar", { metodo: "POST", form: { id: "123", texto: "x" }, origen: "https://malo.test" });
  ok(ajena.estado === 403, "desde otra web: no");
  BASE1.sql.prepare("UPDATE contactos SET pausado_hasta = 0 WHERE id = '123'").run();
}

titulo("borrar mensajes y conversaciones desde el panel central");
{
  const conv = await abrir("/t/invictus/c/456");
  ok(/action="\/t\/invictus\/borrar-mensaje"/.test(conv.html) && /Borrar esta conversación del panel/.test(conv.html), "cada mensaje con su 🗑️, y borrar la conversación");
  const fila = BASE1.sql.prepare("SELECT id FROM mensajes WHERE igsid = '456' ORDER BY id LIMIT 1").get();
  const antes = BASE1.sql.prepare("SELECT COUNT(*) AS n FROM mensajes WHERE igsid = '456'").get().n;
  const r = await abrir("/t/invictus/borrar-mensaje", { metodo: "POST", form: { igsid: "456", mensaje: String(fila.id) } });
  ok(r.estado === 303 && BASE1.sql.prepare("SELECT COUNT(*) AS n FROM mensajes WHERE igsid = '456'").get().n === antes - 1, "borra un mensaje en la tienda de verdad");
  const r2 = await abrir("/t/invictus/borrar-conversacion", { metodo: "POST", form: { id: "456" } });
  ok(r2.estado === 303 && BASE1.sql.prepare("SELECT COUNT(*) AS n FROM mensajes WHERE igsid = '456'").get().n === 0, "y la conversación entera");
  const historial = await abrir("/t/invictus/cambios");
  ok(/borrar conversación en mensajes/.test(historial.html), "queda en el historial de cambios, para deshacer");
  const ultimo = BASE1.sql.prepare("SELECT id FROM cambios_panel WHERE accion = 'borrar-conversacion' ORDER BY id DESC LIMIT 1").get().id;
  await abrir("/t/invictus/deshacer", { metodo: "POST", form: { id: String(ultimo) } });
  ok(BASE1.sql.prepare("SELECT COUNT(*) AS n FROM mensajes WHERE igsid = '456'").get().n === antes - 1, "deshacer: la conversación vuelve");
  ok((await abrir("/t/invictus/borrar-conversacion", { metodo: "POST", form: { id: "456" }, origen: "https://malo.test" })).estado === 403, "desde otra web: no");
}

titulo("métricas, ganadores, errores y gastos");
{
  const m = await abrir("/metricas?dias=7");
  ok(/Clientes por día/.test(m.html) && /Tienda por tienda/.test(m.html), "métricas de todas, con la comparación");
  ok(/role="img"/.test(m.html) && /class="tip"/.test(m.html) && /Ver la tabla día por día/.test(m.html), "barras con su valor al pasar el dedo y la tabla");
  const unidas = C.juntarMetricas([
    { ok: true, datos: { dias: [{ dia: "2026-10-01", clientes: 2, mensajes: 5 }, { dia: "2026-10-02", clientes: 1 }], totales: { clientes: 3, mensajes: 5 }, gasto: { total: 1.5 } } },
    { ok: true, datos: { dias: [{ dia: "2026-10-02", clientes: 4, mensajes: 2 }], totales: { clientes: 4, mensajes: 2 }, gasto: { total: 0.5 } } },
    { ok: false, error: "caída" },
  ]);
  ok(unidas.dias.length === 2 && unidas.dias[1].clientes === 5 && unidas.totales.clientes === 7 && unidas.gasto.total === 2, "los números de varias tiendas se suman día por día", JSON.stringify(unidas.dias));

  const mt = await abrir("/t/invictus/metricas");
  ok(/Últimos 14 días/.test(mt.html) && /❌ Respuestas con error por día/.test(mt.html) && /⚙️ Errores técnicos por día/.test(mt.html), "métricas de una tienda (❌ respuestas con error y ⚙️ errores técnicos, por separado)");

  ok(/Productos ganadores/.test((await abrir("/ganadores")).html), "ganadores de todas");
  const errores = await abrir("/errores");
  ok(/Errores de todas las tiendas/.test(errores.html), "errores de todas");
  const gastos = await abrir("/gastos");
  ok(/Gastos de OpenAI/.test(gastos.html) && /Invictus/.test(gastos.html), "gastos de todas");
  ok(/13\. Panel central/.test((await abrir("/como-funciona")).html), "el diagrama de cómo funciona");
}

titulo("las bases de datos: ver y editar desde el central");
{
  const tablas = await abrir("/t/invictus/bases");
  ok(/contactos/.test(tablas.html) && /mensajes/.test(tablas.html) && /turnos/.test(tablas.html), "las tablas de la tienda");
  ok(/Ana Pérez/.test((await abrir("/t/invictus/bases/contactos")).html), "una tabla con sus filas");

  BASE1.sql.prepare("UPDATE contactos SET historial = ? WHERE id = '123'").run("línea uno\nlínea dos");
  const rowid = BASE1.sql.prepare("SELECT rowid AS r FROM contactos WHERE id = '123'").get().r;
  const form = await abrir(`/t/invictus/bases/contactos/${rowid}`);
  ok(/<textarea name="c:historial">\nlínea uno\nlínea dos<\/textarea>/.test(form.html), "el formulario de la fila (con el salto de línea de regalo para el navegador)");

  // El navegador manda \r\n: no cuenta como cambio.
  const guardado = await abrir(`/t/invictus/bases/contactos/${rowid}`, { metodo: "POST", form: { "c:historial": "línea uno\r\nlínea dos", "c:nombre": "Ana María" } });
  const ahora = BASE1.sql.prepare("SELECT nombre, historial FROM contactos WHERE id = '123'").get();
  ok(/Guardado: nombre\./.test(guardado.html), "solo se manda lo que cambió", (guardado.html.match(/Guardado[^<]*/) || [""])[0]);
  ok(ahora.nombre === "Ana María" && ahora.historial === "línea uno\nlínea dos", "y en la tienda queda cambiado de verdad, sin tocar lo demás");

  const ajeno = await abrir(`/t/invictus/bases/contactos/${rowid}`, { metodo: "POST", form: { "c:nombre": "Hackeado" }, origen: "https://malo.test" });
  ok(ajeno.estado === 403 && BASE1.sql.prepare("SELECT nombre FROM contactos WHERE id = '123'").get().nombre === "Ana María", "editar desde otra web: no");

  const errorRow = BASE1.sql.prepare("SELECT rowid AS r FROM mensajes ORDER BY rowid LIMIT 1").get().r;
  const borrar = await abrir(`/t/invictus/bases/mensajes/${errorRow}/borrar`, { metodo: "POST" });
  ok(borrar.estado === 303 && !BASE1.sql.prepare("SELECT 1 FROM mensajes WHERE rowid = ?").get(errorRow), "borrar una fila");
  const historial = await abrir("/t/invictus/cambios");
  ok(/borrar en mensajes/.test(historial.html) && /Deshacer/.test(historial.html), "el historial de cambios");
  const ultimo = BASE1.sql.prepare("SELECT id FROM cambios_panel ORDER BY id DESC LIMIT 1").get().id;
  await abrir("/t/invictus/deshacer", { metodo: "POST", form: { id: String(ultimo) } });
  ok(BASE1.sql.prepare("SELECT 1 FROM mensajes WHERE rowid = ?").get(errorRow), "y deshacer el borrado");

  const sql = await abrir("/t/invictus/sql", { metodo: "POST", form: { sql: "SELECT id, nombre FROM contactos ORDER BY id" } });
  ok(/Ana María/.test(sql.html) && /fila\(s\)/.test(sql.html), "consola SQL: leer");
  const malo = await abrir("/t/invictus/sql", { metodo: "POST", form: { sql: "SELEC mal" } });
  ok(/❌/.test(malo.html) && /syntax/i.test(malo.html), "un SQL mal escrito enseña el error");
}

titulo("¿siguen vivas? (el cron de cada 2 minutos)");
{
  await callado(() => C.comprobarTiendas(ENV_C));
  const caidas = BASE_C.sql.prepare("SELECT tienda, tipo FROM alertas WHERE tipo = 'caida'").all();
  ok(caidas.length === 1 && caidas[0].tienda === "caida", "la que no responde: una alerta 🚨 (y las demás, ninguna)", JSON.stringify(caidas));
  const salud = BASE_C.sql.prepare("SELECT tienda, bien, detalle FROM salud ORDER BY tienda").all();
  ok(salud.find((s) => s.tienda === "invictus")?.bien === 1 && /\(\d+\)/.test(salud.find((s) => s.tienda === "invictus").detalle), "las vivas quedan con su versión", JSON.stringify(salud));

  await callado(() => C.comprobarTiendas(ENV_C));
  ok(BASE_C.sql.prepare("SELECT COUNT(*) AS n FROM alertas WHERE tipo = 'caida'").get().n === 1, "si sigue caída, no se repite la alerta");

  caidaViva = true;
  await callado(() => C.comprobarTiendas(ENV_C));
  ok(BASE_C.sql.prepare("SELECT COUNT(*) AS n FROM alertas WHERE tipo = 'volvio' AND tienda = 'caida'").get().n === 1, "cuando vuelve: ✅");

  const pagina = await abrir("/salud");
  ok(/✅ Responde/.test(pagina.html) && /Comprobar ahora/.test(pagina.html), "la página de estado");

  const sinClave = await callado(() => central.fetch(new Request("https://central.test/estado"), { ...ENV_C, CLAVE_OTRA: "" }, ctx));
  ok(/faltan claves: CLAVE_OTRA/.test(await sinClave.text()), "/estado avisa si falta la clave de una tienda");
  const equivocada = await callado(() => central.fetch(new Request("https://central.test/t/otra", { headers: { cookie: galleta } }), { ...ENV_C, CLAVE_OTRA: "otra-clave-que-no-es-la-buena" }, ctx));
  ok(/la clave no coincide/.test(await equivocada.text()), "con la clave equivocada, lo dice claro");
}

titulo("una tienda con la versión vieja (responde 200 'ok' a todo)");
{
  // Pasó el 2-oct: el panel entero dio error porque una tienda contestaba
  // "ok" en vez de los datos. Ninguna página puede caerse por eso.
  caidaVieja = true;
  for (const ruta of ["/", "/gastos", "/metricas", "/ganadores", "/errores", "/en-pausa", "/en-vivo/datos?c=%7B%7D", "/t/caida", "/t/caida/chats", "/t/caida/metricas", "/t/caida/ganadores", "/t/caida/errores", "/t/caida/c/123", "/t/caida/bases", "/t/caida/cambios"]) {
    const r = await abrir(ruta);
    ok(r.estado === 200, `${ruta} no se cae`, String(r.estado));
  }
  const inicio = await abrir("/");
  ok(/versión vieja/.test(inicio.html) && /Invictus/.test(inicio.html), "el inicio dice que esa tienda tiene la versión vieja, y enseña las demás");
  caidaVieja = false;
}

titulo("una tienda en la misma cuenta de Cloudflare (error 1042)");
{
  caida1042 = true;
  const r = await abrir("/t/caida");
  ok(r.estado === 200 && /error 1042/.test(r.html) && /otra cuenta de Cloudflare/.test(r.html), "lo dice claro y con el arreglo (no 'versión vieja')");
  caida1042 = false;
}

fs.rmSync(copia, { recursive: true, force: true });
tienda1.limpiar();
tienda2.limpiar();
terminar();
