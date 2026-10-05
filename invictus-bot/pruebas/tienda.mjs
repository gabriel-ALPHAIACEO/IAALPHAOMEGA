// EL PANEL DE LA TIENDA (/panel, 2-oct-2026): la clave, la lista de
// conversaciones, los mensajes guardados (cliente, bot y asesor), lo que
// pensó la IA debajo de cada respuesta, y pausar / devolver.
//
// Instagram, OpenAI y Shopify son de mentira; la base es SQLite de verdad.

import { prepararSrc, baseDeMentira, ok, titulo, terminar } from "./ayuda.mjs";
import crypto from "node:crypto";
import vm from "node:vm";

const SECRETO = "secreto-de-prueba";
const CLAVE = "clave-del-panel-123";
const src = await prepararSrc();
const { default: worker } = await src.cargar("index.js");
const P = await src.cargar("panel.js");
const E = await src.cargar("estado.js");
const { DB } = baseDeMentira();
const ENV = {
  DB, META_APP_SECRET: SECRETO, META_MODO: "todo", IG_TOKEN: "x", OPENAI_API_KEY: "x",
  SHOPIFY_TIENDA: "tienda.test", SHOPIFY_TOKEN: "x", URL_CATALOGO: "https://tienda.test",
  PANEL_CLAVE: CLAVE, TIENDA_NOMBRE: "Invictus Shoes", PAUSA_HORAS: "1",
};

function falso(modelo) {
  return async (url, op = {}) => {
    const u = String(url);
    if (u.includes("api.openai.com")) {
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(modelo) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
    }
    if (u.includes("graph.instagram.com") && u.includes("/messages")) return new Response(JSON.stringify({ message_id: `mid-${Math.random()}` }), { status: 200 });
    if (u.includes("graph.instagram.com")) return new Response(JSON.stringify({ name: "Ana Pérez", username: "ana" }), { status: 200 });
    if (u.includes("/graphql.json")) return new Response(JSON.stringify({ data: { products: { edges: [], pageInfo: { hasNextPage: false } } } }), { status: 200 });
    return new Response("ok", { status: 200 });
  };
}

async function callado(fn) {
  const [l, e] = [console.log, console.error];
  console.log = console.error = () => {};
  try { return await fn(); } finally { console.log = l; console.error = e; }
}

async function escribe(texto, modelo) {
  const cuerpo = JSON.stringify({ object: "instagram", entry: [{ id: "999", time: Date.now(), messaging: [{ sender: { id: "123" }, recipient: { id: "999" }, timestamp: Date.now(), message: { mid: `m-${Math.random()}`, text: texto } }] }] });
  const firma = "sha256=" + crypto.createHmac("sha256", SECRETO).update(cuerpo).digest("hex");
  const real = globalThis.fetch;
  globalThis.fetch = falso(modelo);
  const tareas = [];
  try {
    await callado(async () => {
      await worker.fetch(new Request("https://bot.test/webhook", { method: "POST", headers: { "x-hub-signature-256": firma }, body: cuerpo }), ENV, { waitUntil: (p) => tareas.push(p) });
      await Promise.all(tareas);
    });
  } finally {
    globalThis.fetch = real;
  }
}

async function pedir(ruta, { metodo = "GET", cookie = "", cuerpo = null, origen = "", env = ENV } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (origen) headers.origin = origen;
  const real = globalThis.fetch;
  globalThis.fetch = falso({});
  try {
    const r = await callado(() => worker.fetch(new Request(`https://bot.test${ruta}`, { method: metodo, headers, body: cuerpo }), env, { waitUntil() {} }));
    return { estado: r.status, texto: await r.text(), cookie: r.headers.get("set-cookie") || "", donde: r.headers.get("location") || "" };
  } finally {
    globalThis.fetch = real;
  }
}

await escribe("hola, tienen jordan 4?", { pienso: "Saluda y pide Jordan 4: primer mensaje, bienvenida y busco Retro 4.", mostrar: "texto_e_imagenes", voz: false, respuesta: "¡Hola! Soy la asistente virtual de Invictus Shoes 👋 Déjame revisar los Jordan 4", buscar: "NADA", historial: "Ya di la bienvenida. Pidió Jordan 4." });
// Un asesor escribe a mano desde Instagram (lo guarda la rama del eco).
await callado(() => P.anotarMensaje(DB, "123", "asesor", "Hola Ana, te escribo yo 😊"));

titulo("la clave");
let r = await pedir("/panel");
ok(/Escribe la clave del panel/.test(r.texto) && !/Jordan/.test(r.texto), "sin sesión pide la clave y no enseña nada");
const mala = new FormData(); mala.set("clave", "otra");
r = await pedir("/panel/entrar", { metodo: "POST", cuerpo: mala });
ok(/Esa no es la clave/.test(r.texto) && !r.cookie, "con la clave equivocada no entra");
const buena = new FormData(); buena.set("clave", CLAVE);
r = await pedir("/panel/entrar", { metodo: "POST", cuerpo: buena });
const cookie = r.cookie.split(";")[0];
ok(/HttpOnly/.test(r.cookie) && /Path=\/panel/.test(r.cookie), "con la buena entra (cookie firmada, solo para /panel)");
const sinClave = await pedir("/panel", { env: { DB } });
ok(/El panel está apagado/.test(sinClave.texto), "sin PANEL_CLAVE el panel no abre para nadie");

titulo("la lista y la conversación");
r = await pedir("/panel", { cookie });
ok(/Ana Pérez/.test(r.texto) && /@ana/.test(r.texto), "la lista enseña a la clienta, con su @");
ok(!/Anuncios/.test(r.texto), "Invictus no tiene panel de anuncios: no sale en el menú");
r = await pedir("/panel?q=jordan", { cookie });
ok(/Ana Pérez/.test(r.texto), "el buscador encuentra por lo que escribió");
r = await pedir("/panel/c/123", { cookie });
ok(/hola, tienen jordan 4\?/.test(r.texto), "la conversación: lo que escribió la clienta");
ok(/Déjame revisar los Jordan 4/.test(r.texto), "lo que contestó el bot");
ok(/Asesor \(a mano\)/.test(r.texto) && /te escribo yo/.test(r.texto), "y lo que escribió un asesor a mano");
ok(/Lo que pensó la IA/.test(r.texto) && /busco Retro 4/.test(r.texto), "debajo de la respuesta, LO QUE PENSÓ LA IA");

titulo("pausar y devolver");
const id = new FormData(); id.set("id", "123");
r = await pedir("/panel/pausar", { metodo: "POST", cookie, cuerpo: id, origen: "https://otra-web.com" });
ok(r.estado === 403, "una acción que viene de otra web se rechaza");
await pedir("/panel/pausar", { metodo: "POST", cookie, cuerpo: id, origen: "https://bot.test" });
r = await pedir("/panel/c/123", { cookie });
ok(/Bot en pausa hasta/.test(r.texto), "pausar el bot desde el panel");
const id2 = new FormData(); id2.set("id", "123");
await pedir("/panel/devolver", { metodo: "POST", cookie, cuerpo: id2, origen: "https://bot.test" });
r = await pedir("/panel/c/123", { cookie });
ok(/Pausar el bot 1 h/.test(r.texto), "y devolverle la conversación");

// Como lo manda Chrome de verdad (Origin "null" + Sec-Fetch-Site): el
// 2-oct los botones decían "No" por esto.
{
  const f = new FormData(); f.set("id", "123");
  const real = await callado(() => worker.fetch(new Request("https://bot.test/panel/pausar", { method: "POST", headers: { cookie, origin: "null", "sec-fetch-site": "same-origin" }, body: f }), ENV, { waitUntil() {} }));
  ok(real.status === 303 && (await E.estaPausado(await E.cargarContacto(DB, "123"))), "pausar como lo manda Chrome (Origin null) funciona", String(real.status));
  const g = new FormData(); g.set("id", "123");
  const ajeno = await callado(() => worker.fetch(new Request("https://bot.test/panel/devolver", { method: "POST", headers: { cookie, origin: "null", "sec-fetch-site": "cross-site" }, body: g }), ENV, { waitUntil() {} }));
  ok(ajeno.status === 403, "pero desde otra web (cross-site), no");
  await E.despausar(DB, "123");
}

// Despausar desde la LISTA, sin abrir la conversación.
await pedir("/panel/pausar", { metodo: "POST", cookie, cuerpo: id, origen: "https://bot.test" });
r = await pedir("/panel?f=pausados", { cookie });
ok(/⏸️ bot en pausa hasta/.test(r.texto) && /Devolverle la conversación al bot/.test(r.texto) && /name="volver" value="\/panel\?f=pausados"/.test(r.texto), "en la lista, cada persona en pausa trae su botón para devolvérsela al bot");
ok(/Devolverle todas al bot \(1\)/.test(r.texto), "y en el filtro de pausados, devolverlas todas");
const id3 = new FormData(); id3.set("id", "123"); id3.set("volver", "/panel?f=pausados");
r = await pedir("/panel/devolver", { metodo: "POST", cookie, cuerpo: id3, origen: "https://bot.test" });
ok(r.donde === "/panel?f=pausados" && !(await E.estaPausado(await E.cargarContacto(DB, "123"))), "devolver desde la lista despausa y vuelve a la lista", r.donde);
const id4 = new FormData(); id4.set("id", "123"); id4.set("volver", "https://otra-web.com/robar");
await pedir("/panel/pausar", { metodo: "POST", cookie, cuerpo: id, origen: "https://bot.test" });
r = await pedir("/panel/devolver", { metodo: "POST", cookie, cuerpo: id4, origen: "https://bot.test" });
ok(r.donde === "/panel/c/123", "volver a otra web no: se queda en el panel", r.donde);
await E.pausar(DB, "123", 1);
await E.pausar(DB, "777", 1);
r = await pedir("/panel/devolver-todos", { metodo: "POST", cookie, cuerpo: new FormData(), origen: "https://bot.test" });
const quedan = await DB.prepare("SELECT COUNT(*) AS n FROM contactos WHERE pausado_hasta > ?").bind(Date.now()).first();
ok(r.donde === "/panel?f=pausados" && quedan.n === 0, "devolverlas todas de una vez");
const nota = await E.cargarContacto(DB, "123");
ok(/devolvió la conversación al bot/.test(nota.historial), "con su nota en el historial (el bot no saluda de cero)");
r = await pedir("/panel?f=pausados", { cookie });
ok(/Nadie en pausa/.test(r.texto), "sin nadie en pausa, lo dice");

titulo("escribirle al cliente desde el panel");
{
  await E.despausar(DB, "123");
  const f = new FormData(); f.set("id", "123"); f.set("texto", "Hola Ana, soy el dueño 😊 ¿te ayudo con la talla?");
  const r1 = await pedir("/panel/enviar", { metodo: "POST", cookie, cuerpo: f, origen: "https://bot.test" });
  ok(r1.estado === 303 && /aviso=ok/.test(r1.donde), "se manda y vuelve a la conversación con el aviso", r1.donde);
  ok(await E.estaPausado(await E.cargarContacto(DB, "123")), "el bot queda en pausa con ese cliente (habla una persona)");
  const guardados = (await DB.prepare("SELECT de, texto FROM mensajes WHERE igsid = '123' AND de = 'asesor' AND texto LIKE '%soy el dueño%'").all()).results;
  ok(guardados.length === 1, "queda en la conversación como mensaje del asesor");
  await P.anotarMensaje(DB, "123", "asesor", "Hola Ana, soy el dueño 😊 ¿te ayudo con la talla?");
  const tras = (await DB.prepare("SELECT COUNT(*) AS n FROM mensajes WHERE igsid = '123' AND texto LIKE '%soy el dueño%'").first()).n;
  ok(tras === 1, "el eco que devuelve Meta no lo repite");
  const pag = await pedir("/panel/c/123?aviso=ok", { cookie });
  ok(/Escribirle tú/.test(pag.texto) && /✅ Enviado/.test(pag.texto) && /action="\/panel\/enviar"/.test(pag.texto), "la conversación trae el cuadro para escribir y el aviso");

  // Fuera de las 24 horas, Instagram lo rechaza: se dice tal cual.
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "This message is sent outside of allowed window.", code: 10, error_subcode: 2534022 } }), { status: 400 });
  const r2 = await callado(() => P.mandarDesdeElPanel({ ...ENV, IG_TOKEN: "x" }, "123", "hola", 1));
  globalThis.fetch = real;
  ok(!r2.ok && /24 horas/.test(r2.error), "fuera de las 24 h: lo explica (no un error sin más)", r2.error);
  const vacio = await P.mandarDesdeElPanel(ENV, "123", "   ", 1);
  ok(!vacio.ok && /Escribe/.test(vacio.error), "un mensaje vacío no sale");
  const ajeno = new FormData(); ajeno.set("id", "123"); ajeno.set("texto", "hola");
  ok((await pedir("/panel/enviar", { metodo: "POST", cookie, cuerpo: ajeno, origen: "https://otra-web.com" })).estado === 403, "desde otra web: no");
  await E.despausar(DB, "123");
}

titulo("borrar mensajes y conversaciones del panel (y deshacer)");
{
  // Un cliente aparte, para no tocar lo de las otras pruebas.
  await P.anotarMensaje(DB, "900", "cliente", "hola, tienen crocs?");
  await P.anotarMensaje(DB, "900", "bot", "¡Sí! Mira 👇");
  await P.anotarMensaje(DB, "900", "cliente", "un mensaje para borrar");
  await E.pausar(DB, "900", 1);
  await DB.prepare("UPDATE contactos SET historial = 'Pidió crocs.' WHERE id = '900'").run();
  const pag = await pedir("/panel/c/900", { cookie });
  ok(/action="\/panel\/borrar-mensaje"/.test(pag.texto) && /Borrar esta conversación del panel/.test(pag.texto), "cada mensaje trae su 🗑️ y abajo, borrar la conversación");
  ok(/En Instagram no se borra/.test(pag.texto), "y dice claro que en Instagram no se borra");

  const fila = await DB.prepare("SELECT id FROM mensajes WHERE igsid = '900' AND texto = 'un mensaje para borrar'").first();
  const f = new FormData(); f.set("igsid", "900"); f.set("mensaje", String(fila.id));
  const r1 = await pedir("/panel/borrar-mensaje", { metodo: "POST", cookie, cuerpo: f, origen: "https://bot.test" });
  const quedan = (await DB.prepare("SELECT texto FROM mensajes WHERE igsid = '900'").all()).results.map((m) => m.texto);
  ok(r1.estado === 303 && !quedan.includes("un mensaje para borrar") && quedan.length === 2, "borrar UN mensaje: solo ese", quedan.join(" | "));
  const ajeno = new FormData(); ajeno.set("igsid", "900"); ajeno.set("mensaje", String(fila.id));
  ok((await pedir("/panel/borrar-mensaje", { metodo: "POST", cookie, cuerpo: ajeno, origen: "https://otra-web.com" })).estado === 403, "desde otra web: no");

  const g = new FormData(); g.set("id", "900"); g.set("olvidar", "si");
  const r2 = await pedir("/panel/borrar-conversacion", { metodo: "POST", cookie, cuerpo: g, origen: "https://bot.test" });
  const n = (await DB.prepare("SELECT COUNT(*) AS n FROM mensajes WHERE igsid = '900'").first()).n;
  const c = await E.cargarContacto(DB, "900");
  ok(r2.estado === 303 && n === 0, "borrar la conversación entera: sin mensajes");
  ok(c.historial === "" && (await E.estaPausado(c)), "con 'olvidar', el bot olvida lo hablado (la pausa no se toca)", JSON.stringify({ h: c.historial }));

  const API = "z".repeat(10) + "-clave-larga-del-central";
  const ENV_API = { ...ENV, PANEL_API_CLAVE: API };
  const api = async (ruta, cuerpo) => {
    const r = await callado(() => worker.fetch(new Request(`https://bot.test/api/central/${ruta}`, { method: cuerpo ? "POST" : "GET", headers: { authorization: `Bearer ${API}` }, body: cuerpo ? JSON.stringify(cuerpo) : null }), ENV_API, { waitUntil() {} }));
    return r.json();
  };
  const cambios = await api("cambios");
  const conv = cambios.find((x) => x.accion === "borrar-conversacion");
  ok(conv, "queda en el historial de cambios");
  await api("deshacer", { id: conv.id });
  const vuelven = (await DB.prepare("SELECT COUNT(*) AS n FROM mensajes WHERE igsid = '900'").first()).n;
  ok(vuelven === 2 && (await E.cargarContacto(DB, "900")).historial === "Pidió crocs.", "y se deshace: vuelven los mensajes y la memoria del bot");
  const uno = cambios.find((x) => x.accion === "borrar" && x.tabla === "mensajes");
  await api("deshacer", { id: uno.id });
  ok((await DB.prepare("SELECT COUNT(*) AS n FROM mensajes WHERE igsid = '900' AND texto = 'un mensaje para borrar'").first()).n === 1, "el mensaje suelto también se deshace");

  const porApi = await api("borrar-mensaje", { igsid: "900", id: Number(fila.id) });
  ok(porApi.ok, "también desde el panel central (API)");
  // Se deja la base como estaba: las pruebas de abajo cuentan clientes.
  await DB.prepare("DELETE FROM mensajes WHERE igsid = '900'").run();
  await DB.prepare("DELETE FROM turnos WHERE igsid = '900'").run();
  await DB.prepare("DELETE FROM contactos WHERE id = '900'").run();
  await DB.prepare("DELETE FROM cambios_panel").run();
}

titulo("en tiempo real: la página se pone al día sola");
{
  const conv = await pedir("/panel/c/123", { cookie });
  ok(/data-marca="\/panel\/marca"/.test(conv.texto) && /data-zona="conversacion"/.test(conv.texto) && /setInterval\(revisar,3000\)/.test(conv.texto), "la conversación pregunta cada 3 s si hay algo nuevo");
  ok(conv.texto.indexOf('data-zona="conversacion"') < conv.texto.indexOf("Escribirle tú") && conv.texto.indexOf("Escribirle tú") > conv.texto.indexOf("</div>\n<h3 id=\"escribir\"") - 1, "el cuadro para escribir queda FUERA de lo que se actualiza (no se borra lo que escribes)");
  const lista = await pedir("/panel", { cookie });
  ok(/data-marca="\/panel\/marca"/.test(lista.texto) && /data-zona="lista"/.test(lista.texto), "la lista de chats también");
  const m1 = JSON.parse((await pedir("/panel/marca", { cookie })).texto).marca;
  await P.anotarMensaje(DB, "123", "cliente", "un mensaje nuevo para la marca");
  const m2 = JSON.parse((await pedir("/panel/marca", { cookie })).texto).marca;
  ok(/^\d+-\d+$/.test(m1) && m1 !== m2, "llega un mensaje: la marca cambia", `${m1} → ${m2}`);
  ok(/Escribe la clave/.test((await pedir("/panel/marca")).texto), "sin sesión, la marca no se da");
  await DB.prepare("DELETE FROM mensajes WHERE texto = 'un mensaje nuevo para la marca'").run();
}

titulo("ALPHA IA: el logo, las fotos y las fichas (5-oct-2026)");
{
  const logo = await pedir("/panel/logo.png");
  const iso = await worker.fetch(new Request("https://bot.test/panel/isotipo.png"), ENV, { waitUntil() {} });
  ok(logo.estado === 200 && iso.headers.get("content-type") === "image/png" && (await iso.arrayBuffer()).byteLength > 1000, "el logo se sirve sin sesión (lo usa la pantalla de entrada)");
  const entrada = await pedir("/panel");
  ok(/\/panel\/logo\.png/.test(entrada.texto) && /Escribe la clave/.test(entrada.texto), "la pantalla de entrada lleva el logo de ALPHA IA");
  const conv0 = await pedir("/panel/c/123", { cookie });
  ok(/class="alpha"/.test(conv0.texto) && /\/panel\/isotipo\.png/.test(conv0.texto) && /ALPHA IA/.test(conv0.texto), "arriba, la marca ALPHA IA con la A del logo");

  await P.anotarMensaje(DB, "777", "cliente", "", { fotos: ["https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1&signature=x"] });
  await P.anotarMensaje(DB, "777", "cliente", "este pero en negro", { fotos: ["https://cdn.example.com/historia.jpg"], historia: true });
  await P.anotarMensaje(DB, "777", "bot", "📷 Fichas: Nike ACG · Crocs", {
    fichas: [
      { titulo: "Nike ACG", precio: "$60", imagen: "https://lh3.googleusercontent.com/d/abc=w1000", url: "https://x" },
      { titulo: "Crocs <b>", precio: "$25", imagen: "javascript:alert(1)" },
    ],
  });
  const filas = (await DB.prepare("SELECT texto, adjuntos FROM mensajes WHERE igsid = '777' ORDER BY id").all()).results;
  ok(filas[0].texto === "(mandó una foto)" && JSON.parse(filas[0].adjuntos).fotos.length === 1, "una foto sin texto se guarda con su enlace y un texto que la describe");
  ok(JSON.parse(filas[2].adjuntos).fichas.length === 2 && !/javascript/.test(filas[2].adjuntos) && !/"url"/.test(filas[2].adjuntos), "las fichas se guardan (título, precio e imagen) y un enlace que no es https no");
  const v = await pedir("/panel/c/777", { cookie });
  ok(/<img src="https:\/\/lookaside\.fbsbx\.com[^"]*"/.test(v.texto) && /class="foto"/.test(v.texto), "la foto del cliente se ve en la conversación");
  ok(/Respondió a una historia/.test(v.texto) && /este pero en negro/.test(v.texto) && !/\(respondió a una historia\)/.test(v.texto), "la historia se ve, con su texto y sin el '(respondió a una historia)'");
  ok(/class="carrusel"/.test(v.texto) && /class="carrusel-pista"/.test(v.texto) && (v.texto.match(/class="ficha"/g) || []).length === 2, "las fichas se ven en un carrusel que se desliza");
  ok(/\$60/.test(v.texto) && /Crocs &lt;b&gt;/.test(v.texto) && !/javascript:/.test(v.texto), "con su precio, y lo que viene de fuera, escapado");
  ok(/burbuja de-bot con-fichas/.test(v.texto) && !/📷 Fichas: Nike ACG/.test(v.texto.replace(/<div class="pienso"[\s\S]*?<\/div>/g, "")), "no se repite la lista de fichas escrita: se ve el carrusel");
  ok(/data-k="m\d+"/.test(v.texto), "cada mensaje lleva su clave (al ponerse al día, solo entra lo nuevo y las fotos no parpadean)");
  const malos = [];
  for (const html of [v.texto, (await pedir("/panel", { cookie })).texto]) {
    for (const [, codigo] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      try {
        new vm.Script(codigo);
      } catch (error) {
        malos.push(error.message);
      }
    }
  }
  ok(!malos.length && /<script>/.test(v.texto), "el JavaScript de la página compila (sin errores de sintaxis)", malos.join(" | "));
  const CLAVE_API = "w".repeat(10) + "-clave-larga-del-central";
  const api = async (ruta) => {
    const r = await callado(() => worker.fetch(new Request(`https://bot.test/api/central/${ruta}`, { headers: { authorization: `Bearer ${CLAVE_API}` } }), { ...ENV, PANEL_API_CLAVE: CLAVE_API }, { waitUntil() {} }));
    return r.json();
  };
  const chat = await api("chat?id=777");
  ok(chat.mensajes?.[2]?.adjuntos?.fichas?.length === 2, "el panel central recibe las fotos y las fichas (API chat)");
  const vivo = await api("vivo");
  ok((vivo.mensajes || []).some((m) => m.adjuntos?.fotos?.length), "y en vivo");
  await DB.prepare("DELETE FROM mensajes WHERE igsid = '777'").run();
}

titulo("seguridad y el resto");
r = await pedir("/panel/c/%3Cscript%3E", { cookie });
ok(!/Id <script>/.test(r.texto) && /Id &lt;script&gt;/.test(r.texto), "lo que viene en la URL se escapa");
r = await pedir("/panel/estado", { cookie });
ok(/PANEL_CLAVE/.test(r.texto), "el estado se ve dentro del panel");

titulo("la puerta del panel central (/api/central)");
{
  const API = "x".repeat(10) + "-clave-larga-del-central";
  const ENV_API = { ...ENV, PANEL_API_CLAVE: API };
  const A = await src.cargar("aviso.js");
  const R = await src.cargar("registro.js");
  // Una venta por cerrar con el Jordan 4 delante, y un error del bot.
  await callado(() => A.avisarAsesor({ DB }, { igsid: "123", motivo: "QUIERE COMPRAR", mensaje: "lo quiero", productos: [{ titulo: "Jordan 4 Retro negro" }] }));
  // console.error ya está vigilado desde que se cargó index.js (ver
  // registro.js): lo que se escribe ahí queda para guardarse.
  console.error("(prueba) No pude leer la hoja: 500");
  await R.guardarErrores(DB);

  const api = async (ruta, { clave = API, metodo = "GET", cuerpo = null, env = ENV_API } = {}) => {
    const headers = clave ? { authorization: `Bearer ${clave}` } : {};
    const real = globalThis.fetch;
    globalThis.fetch = falso({});
    try {
      const r = await callado(() => worker.fetch(new Request(`https://bot.test/api/central/${ruta}`, { method: metodo, headers, body: cuerpo }), env, { waitUntil() {} }));
      return { estado: r.status, datos: await r.json().catch(() => null) };
    } finally {
      globalThis.fetch = real;
    }
  };

  ok((await api("resumen", { env: ENV })).estado === 403, "sin PANEL_API_CLAVE la puerta está cerrada");
  ok((await api("resumen", { clave: "otra-clave-cualquiera-larga" })).estado === 401, "con otra clave, no");
  ok((await api("resumen", { clave: "" })).estado === 401, "sin clave, no");

  const res = (await api("resumen")).datos;
  ok(res?.tienda === "Invictus Shoes" && /\(\d+\)/.test(res.version), "resumen: la tienda y su versión", JSON.stringify(res).slice(0, 120));
  ok(res.hoy.clientes === 1 && res.hoy.mensajes >= 1 && res.hoy.respuestas >= 1, "resumen: clientes, mensajes y respuestas de hoy", JSON.stringify(res.hoy));
  ok(res.hoy.ventas === 1, "resumen: 1 venta por cerrar");
  ok(res.semana.errores >= 1, "resumen: los errores guardados se cuentan", JSON.stringify(res.semana));

  const met = (await api("metricas?dias=7")).datos;
  ok(met?.dias?.length === 7 && met.dias.at(-1).clientes === 1, "métricas: 7 días, hoy con 1 cliente", JSON.stringify(met?.dias?.at(-1)));
  ok(typeof met.tasas.conFichas === "number", "métricas: las tasas");

  const gan = (await api("ganadores")).datos;
  ok(gan?.[0]?.titulo === "Jordan 4 Retro negro" && gan[0].ventas === 1, "ganadores: el que llevó a 'lo quiero'", JSON.stringify(gan));

  const chat = (await api("chat?id=123")).datos;
  ok(chat?.mensajes?.some((m) => /jordan 4/.test(m.texto)) && chat.turnos.length >= 1, "una conversación, con lo que pensó la IA");

  const err = (await api("errores")).datos;
  ok(err?.some((e) => /No pude leer la hoja/.test(e.texto) && e.tipo === "error"), "los errores, con su texto", JSON.stringify(err).slice(0, 160));

  ok((await api("chats")).datos?.[0]?.id === "123", "la lista de chats");
  const p = await api("pausar", { metodo: "POST", cuerpo: JSON.stringify({ id: "123" }) });
  const tras = (await api("chat?id=123")).datos;
  ok(p.datos?.ok && tras.contacto.pausado_hasta > Date.now(), "pausar desde el panel central");
}

titulo("las respuestas señaladas: 🔴 ❌ 👎 (y el revisor)");
{
  const R = await src.cargar("registro.js");
  const V = await src.cargar("revisor.js");
  const real = globalThis.fetch;

  // El revisor dice que la última respuesta alucinó.
  const fila = await DB.prepare("SELECT id, respuesta FROM turnos WHERE igsid = '123' ORDER BY id DESC LIMIT 1").first();
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ veredicto: "alucino", explicacion: "dijo que había Jordan 4 sin buscarlos" }) } }], usage: { prompt_tokens: 300, completion_tokens: 20 } }), { status: 200 });
  const v = await callado(() => V.revisarTurno({ DB, OPENAI_API_KEY: "x" }, { id: fila.id, igsid: "123", cliente: "tienen jordan 4?", respuesta: fila.respuesta }));
  globalThis.fetch = real;
  ok(v?.veredicto === "alucino", "el revisor devuelve su veredicto");
  let marca = await DB.prepare("SELECT marca, motivo FROM turnos WHERE id = ?").bind(fila.id).first();
  ok(marca.marca === "indebida" && /Alucinó/.test(marca.motivo), "y la respuesta queda marcada 🔴", JSON.stringify(marca));

  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"veredicto":"bien"}' } }] }), { status: 200 });
  const bien = await callado(() => V.revisarTurno({ DB, OPENAI_API_KEY: "x" }, { id: fila.id, igsid: "123", cliente: "x", respuesta: "y" }));
  globalThis.fetch = real;
  ok(bien?.veredicto === "bien", "una respuesta bien no se marca");
  ok(V.revisorActivo({ OPENAI_API_KEY: "x", REVISOR_IA: "no" }) === false, "REVISOR_IA = no lo apaga");

  r = await pedir("/panel/c/123", { cookie });
  ok(/🔴 <|🔴 Respuesta indebida/.test(r.texto) && /dijo que había Jordan 4/.test(r.texto), "en el panel sale el 🔴 con el motivo");
  r = await pedir("/panel?f=problemas", { cookie });
  ok(/Ana Pérez/.test(r.texto) && /🔴 1/.test(r.texto), "la lista 'Con problemas' la enseña, con el símbolo");

  // (La prueba de la API la dejó en pausa: se le devuelve al bot.)
  const E = await src.cargar("estado.js");
  await E.despausar(DB, "123");

  // Una queja del cliente marca la respuesta anterior (sin pisar una más grave).
  await escribe("hola tienen cholas?", { pienso: "Pide cholas.", mostrar: "texto", voz: false, respuesta: "¡Claro! ¿De qué talla?", buscar: "NADA", historial: "Pidió cholas." });
  await escribe("no es eso lo que te pregunté", { pienso: "Se queja.", mostrar: "texto", voz: false, respuesta: "Disculpa 🙏 ¿Qué estás buscando?", buscar: "NADA", historial: "Se quejó." });
  const quejada = await DB.prepare("SELECT marca, motivo FROM turnos WHERE igsid = '123' AND respuesta LIKE '%De qué talla%'").first();
  ok(quejada?.marca === "queja" && /no es eso/.test(quejada.motivo), "una queja marca 👎 la respuesta que la provocó", JSON.stringify(quejada));

  // La IA no responde: ❌.
  await escribe("y tienen crocs?", "esto no es json");
  const fallida = await DB.prepare("SELECT marca FROM turnos WHERE igsid = '123' ORDER BY id DESC LIMIT 1").first();
  ok(fallida?.marca === "error", "si la IA no responde, el turno queda ❌", JSON.stringify(fallida));
  ok(R.MARCAS.error.simbolo === "❌" && R.MARCAS.corregida.simbolo === "⚠️", "los símbolos");
}

titulo("las bases de datos: ver, editar, borrar, SQL y deshacer");
{
  const API = "x".repeat(10) + "-clave-larga-del-central";
  const ENV_API = { ...ENV, PANEL_API_CLAVE: API };
  const api = async (ruta, { metodo = "GET", cuerpo = null } = {}) => {
    const r = await callado(() => worker.fetch(new Request(`https://bot.test/api/central/${ruta}`, { method: metodo, headers: { authorization: `Bearer ${API}` }, body: cuerpo ? JSON.stringify(cuerpo) : null }), ENV_API, { waitUntil() {} }));
    return { estado: r.status, datos: await r.json().catch(() => null) };
  };

  const tablas = (await api("tablas")).datos;
  const nombres = (tablas || []).map((t) => t.nombre);
  ok(["contactos", "mensajes", "turnos", "avisos", "errores"].every((n) => nombres.includes(n)), "se ven todas las tablas del bot", nombres.join(", "));
  ok(tablas.find((t) => t.nombre === "mensajes").filas > 0 && tablas.find((t) => t.nombre === "contactos").columnas.some((c) => c.nombre === "historial"), "con cuántas filas y sus columnas");

  const pag = (await api("tabla?nombre=mensajes&q=jordan")).datos;
  ok(pag?.filas?.length >= 1 && pag.filas.every((f) => /jordan/i.test(JSON.stringify(f))), "una tabla, con el buscador");
  ok((await api("tabla?nombre=contactos;DROP TABLE contactos")).estado === 404, "un nombre de tabla inventado no entra en el SQL");

  const c = (await api("tabla?nombre=contactos")).datos.filas[0];
  const ed = await api("fila", { metodo: "POST", cuerpo: { tabla: "contactos", rowid: c._rowid, cambios: { historial: "Editado a mano por el experto." } } });
  ok(ed.datos?.ok && ed.datos.fila.historial === "Editado a mano por el experto.", "editar un valor de una fila");
  const cambios = (await api("cambios")).datos;
  ok(cambios?.[0]?.accion === "editar" && /historial/.test(cambios[0].antes), "el cambio queda en el historial, con cómo estaba antes");
  await api("deshacer", { metodo: "POST", cuerpo: { id: cambios[0].id } });
  const vuelta = (await api(`fila?tabla=contactos&rowid=${c._rowid}`)).datos.fila;
  ok(vuelta.historial === c.historial, "y se puede deshacer");

  const e = (await api("tabla?nombre=errores")).datos.filas[0];
  await api("borrar", { metodo: "POST", cuerpo: { tabla: "errores", rowid: e._rowid } });
  ok((await api(`fila?tabla=errores&rowid=${e._rowid}`)).estado === 404, "borrar una fila");
  const borrado = (await api("cambios")).datos[0];
  await api("deshacer", { metodo: "POST", cuerpo: { id: borrado.id } });
  ok((await api(`fila?tabla=errores&rowid=${e._rowid}`)).datos?.fila?.texto === e.texto, "y deshacer el borrado (vuelve igual)");

  const sel = (await api("sql", { metodo: "POST", cuerpo: { sql: "SELECT COUNT(*) AS n FROM mensajes" } })).datos;
  ok(sel?.filas?.[0]?.n > 0, "consola SQL: leer");
  const upd = (await api("sql", { metodo: "POST", cuerpo: { sql: "UPDATE contactos SET nombre = 'Ana' WHERE id = '123'" } })).datos;
  ok(upd?.ok, "consola SQL: cambiar");
  const mal = await api("sql", { metodo: "POST", cuerpo: { sql: "SELEC mal escrito" } });
  ok(mal.estado === 400 && /syntax|error/i.test(mal.datos?.error || ""), "un SQL mal escrito devuelve el error, sin romper nada");

  // Vaciar un campo de una columna NOT NULL no rompe: queda "" (y uno que
  // admite NULL queda NULL).
  const t = (await api("tabla?nombre=turnos")).datos.filas[0];
  const vacio = await api("fila", { metodo: "POST", cuerpo: { tabla: "turnos", rowid: t._rowid, cambios: { motivo: "" } } });
  ok(vacio.datos?.ok && vacio.datos.fila.motivo === "", "vaciar un campo NOT NULL lo deja en blanco, sin error", JSON.stringify(vacio.datos).slice(0, 120));
}

titulo("el panel central: ping y en vivo");
{
  const API = "y".repeat(10) + "-clave-larga-del-central";
  const ENV_API = { ...ENV, PANEL_API_CLAVE: API };
  const api = async (ruta) => {
    const r = await callado(() => worker.fetch(new Request(`https://bot.test/api/central/${ruta}`, { headers: { authorization: `Bearer ${API}` } }), ENV_API, { waitUntil() {} }));
    return { estado: r.status, datos: await r.json().catch(() => null) };
  };

  const ping = (await api("ping")).datos;
  ok(ping?.ok && /\(\d+\)/.test(ping.version), "ping: responde con su versión, sin leer la base", JSON.stringify(ping));

  const primera = (await api("vivo")).datos;
  ok(primera?.mensajes?.length > 0 && primera.mensajes.length <= 40 && primera.ultimo > 0, "en vivo, la primera vez: los últimos mensajes y por dónde va");
  ok(primera.turnos.length > 0 && primera.turnos.length <= 20 && Array.isArray(primera.turnos[0].productos), "y los últimos turnos (lo que pensó), ya leídos");
  ok(primera.nombres?.["123"]?.nombre, "con el nombre de cada cliente", JSON.stringify(primera.nombres));
  const ordenados = primera.mensajes.every((m, i, a) => !i || a[i - 1].id < m.id);
  ok(ordenados, "del más viejo al más nuevo");

  const nada = (await api(`vivo?desde=${primera.ultimo}&turno=${primera.ultimoTurno}`)).datos;
  ok(nada.mensajes.length === 0 && nada.turnos.length === 0 && nada.ultimo === primera.ultimo, "si no hay nada nuevo, no repite nada");

  await escribe("tienen jordan 4?", { pienso: "Pide Jordan 4, busco.", mostrar: "texto", voz: false, respuesta: "Déjame ver 👀", buscar: "NADA", historial: "Pidió Jordan 4." });
  const nuevo = (await api(`vivo?desde=${primera.ultimo}&turno=${primera.ultimoTurno}`)).datos;
  ok(nuevo.mensajes.some((m) => m.de === "cliente" && /jordan 4/.test(m.texto)) && nuevo.mensajes.some((m) => m.de === "bot"), "llega lo nuevo: lo del cliente y lo del bot", JSON.stringify(nuevo.mensajes.map((m) => m.texto)));
  ok(nuevo.turnos.some((x) => /Jordan 4/.test(x.pienso)), "y lo que pensó la IA");

  // El revisor marca DESPUÉS un turno que ya se vio: la marca llega igual.
  const visto = nuevo.turnos.at(-1);
  await DB.prepare("UPDATE turnos SET marca = 'indebida', motivo = 'Alucinó — prueba' WHERE id = ?").bind(visto.id).run();
  const luego = (await api(`vivo?desde=${nuevo.ultimo}&turno=${nuevo.ultimoTurno}`)).datos;
  ok(luego.marcas.some((m) => m.id === visto.id && m.marca === "indebida"), "una marca que llega después (🔴 del revisor) se manda para ponerle el símbolo");

  const deOtro = (await api(`vivo?id=no-existe`)).datos;
  ok(deOtro.mensajes.length === 0 && deOtro.turnos.length === 0, "se puede pedir lo de un solo cliente");

  const indices = (await DB.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all()).results.map((f) => f.name);
  ok(["mensajes_igsid", "mensajes_cuando", "turnos_igsid", "turnos_cuando"].every((n) => indices.includes(n)), "los índices se crean solos (abrir un chat no lee la tabla entera)", indices.join(", "));
}

titulo("una base de antes (sin la columna de las fotos): se arregla sola");
{
  const otra = await prepararSrc();
  const P2 = await otra.cargar("panel.js");
  const { DB: vieja } = baseDeMentira();
  await vieja.prepare("CREATE TABLE mensajes (id INTEGER PRIMARY KEY AUTOINCREMENT, igsid TEXT NOT NULL, cuando INTEGER NOT NULL, de TEXT NOT NULL, texto TEXT NOT NULL)").run();
  await vieja.prepare("INSERT INTO mensajes (igsid, cuando, de, texto) VALUES ('1', 1, 'cliente', 'un mensaje de antes')").run();
  await P2.anotarMensaje(vieja, "1", "cliente", "", { fotos: ["https://cdn.example.com/a.jpg"] });
  const filas = (await vieja.prepare("SELECT texto, adjuntos FROM mensajes ORDER BY id").all()).results;
  ok(filas.length === 2 && filas[0].adjuntos === "" && /a\.jpg/.test(filas[1].adjuntos), "añade la columna, sin perder lo que había", JSON.stringify(filas));
  otra.limpiar();
}

src.limpiar();
terminar();
