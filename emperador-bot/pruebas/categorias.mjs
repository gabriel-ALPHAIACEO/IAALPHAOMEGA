// LAS CINCO CATEGORÍAS DE EL EMPERADOR (5-oct-2026): calzado, bolsos,
// camisas, pantalones y gorras. Por TEXTO y por FOTO, al cliente le llega lo
// que pidió, aunque la marca sea la misma ("bolsos Nike" no trae zapatos
// Nike).
//
// La carpeta de Drive es de mentira, ordenada como la del dueño
// (CATALOGO › CNTND 1 › CALZADOS / BOLSOS / GORRAS…), con Nike en casi todas.
// DeepSeek también es de mentira; la base es SQLite de verdad.

import { prepararSrc, baseDeMentira, ok, titulo, terminar } from "./ayuda.mjs";
import crypto from "node:crypto";

const src = await prepararSrc();
const C = await src.cargar("categorias.js");
const D = await src.cargar("drive.js");
const S = await src.cargar("shopify.js");
const { default: worker } = await src.cargar("index.js");

titulo("qué pide el cliente, por sus palabras");
for (const [texto, esperada] of [
  ["tienes bolsos nike?", "bolso"],
  ["busco una mochila", "bolso"],
  ["tienen carteras?", "bolso"],
  ["franelas oversize", "camisa"],
  ["una chemise blanca", "camisa"],
  ["jean azul", "pantalon"],
  ["shorts deportivos", "short"],
  ["uniformes del madrid", "uniforme"],
  ["gorras new era", "gorra"],
  ["cachucha negra", "gorra"],
  ["quiero unas cholas", "calzado"],
  ["tienes zapatos casuales?", "calzado"],
  ["zapatos y gorras", ""],
  ["tienes nike?", ""],
  ["hola buenas", ""],
]) {
  ok(C.categoriaDelTexto(texto) === esperada, `"${texto}" → ${esperada || "ninguna"}`, C.categoriaDelTexto(texto) || "ninguna");
}

titulo("la categoría de cada carpeta y de lo que ve la IA de visión");
for (const [carpeta, esperada] of [["CALZADOS", "calzado"], ["BOLSOS", "bolso"], ["GORRAS", "gorra"], ["FRANELAS", "camisa"], ["CAMISAS", "camisa"], ["PANTALONES", "pantalon"], ["SHORT", "short"], ["UNIFORMES", "uniforme"]]) {
  ok(C.categoriaDeCarpeta(carpeta) === esperada, `carpeta ${carpeta} → ${esperada}`);
}
for (const [tipo, esperada] of [["franela", "camisa"], ["short", "short"], ["uniforme", "uniforme"], ["bolso", "bolso"], ["otro", ""]]) {
  ok(C.categoriaDelTipo(tipo) === esperada, `la visión dice "${tipo}" → ${esperada || "ninguna"}`);
}
ok(C.quitarPalabrasDeCategoria("mochila Nike negra") === "Nike negra", '"mochila Nike negra" → "Nike negra" para buscar dentro de los bolsos');

titulo("de dónde sale la categoría de la búsqueda");
ok(C.categoriaDeLaBusqueda({ tipoFoto: "gorra", salida: { categoria: "calzado" } }) === "gorra", "con foto manda lo que se VE (una gorra es una gorra)");
ok(C.categoriaDeLaBusqueda({ salida: { categoria: "gorra" }, texto: "y en negro?" }) === "gorra", '"y en negro?" sigue con la categoría que dijo la IA (ella ve el historial)');
ok(C.categoriaDeLaBusqueda({ salida: { categoria: "" }, texto: "tienes bolsos?" }) === "bolso", "si la IA no la dijo, de lo que escribió el cliente");
ok(C.categoriaDeLaBusqueda({ salida: {}, texto: "tienes de esos?", termino: "bolso Nike" }) === "bolso", "o de la palabra que la IA puso en buscar");
ok(C.categoriaDeLaBusqueda({ salida: {}, texto: "tienes nike?" }) === "", "sin pista: sin filtro (se busca como siempre)");

// ── La carpeta de Drive de mentira ─────────────────────────────────────
const RAIZ = "14lvw1gxxkZSMEdtZbvJ_fIuaCcCcZykA";
const carpeta = (id, name) => ({ id, name, mimeType: "application/vnd.google-apps.folder" });
const foto = (id, name) => ({ id, name, mimeType: "image/jpeg" });
const ARCHIVOS = {
  [RAIZ]: [carpeta("lote", "CNTND 1 (30/6/26)")],
  lote: [carpeta("cal", "CALZADOS"), carpeta("bol", "BOLSOS"), carpeta("gor", "GORRAS"), carpeta("fra", "FRANELAS"), carpeta("pan", "PANTALONES"), carpeta("sho", "SHORT"), carpeta("uni", "UNIFORMES")],
  cal: [carpeta("calnike", "Nike"), foto("z3", "Adidas Campus gris 40$.jpg")],
  calnike: [foto("z1", "Nike Air Force One blanco 45$.jpg"), foto("z2", "Nike Dunk Low panda 50$.jpg")],
  bol: [foto("b1", "Nike Heritage negro 25$.jpg"), foto("b2", "Michael Kors Jet Set marrón 60$.jpg")],
  gor: [foto("g1", "Nike Jordan cap negra 15$.jpg"), foto("g2", "New Era Yankees azul 20$.jpg")],
  fra: [foto("f1", "Nike Sportswear blanca 18$.jpg")],
  pan: [foto("p1", "Jogger Nike Tech gris 35$.jpg"), foto("p2", "Jean Levis 501 azul 40$.jpg")],
  sho: [foto("s1", "Nike Dri-Fit negro 20$.jpg")],
  uni: [foto("u1", "Real Madrid local 2026 45$.jpg")],
};
function driveDeMentira(url) {
  const u = new URL(String(url));
  const padre = u.searchParams.get("q")?.match(/'([^']+)' in parents/)?.[1];
  return new Response(JSON.stringify({ files: ARCHIVOS[padre] || [] }), { status: 200 });
}
const envDrive = { CATALOGO: "drive", DRIVE_CARPETA: `https://drive.google.com/drive/folders/${RAIZ}`, DRIVE_API_KEY: "x" };

async function callado(fn, responder = driveDeMentira) {
  const real = globalThis.fetch, log = console.log, err = console.error;
  globalThis.fetch = async (url, op) => responder(String(url), op);
  console.log = () => {}; console.error = () => {};
  try { return await fn(); } finally { globalThis.fetch = real; console.log = log; console.error = err; }
}
const titulos = (r) => r.productos.map((p) => p.titulo).join(" · ");

titulo("la búsqueda respeta la categoría (antes de recortar)");
{
  D.olvidarCatalogoDeDrive();
  const sinFiltro = await callado(() => S.buscarProductos(envDrive, "Nike", 10));
  ok(sinFiltro.productos.length >= 5, "sin categoría, 'Nike' trae de todo (así era antes)", titulos(sinFiltro));

  const bolsos = await callado(() => S.buscarProductos(envDrive, "Nike", 10, { categoria: "bolso" }));
  ok(bolsos.productos.length === 1 && /Heritage/.test(bolsos.productos[0].titulo), "'Nike' + bolso → solo el bolso Nike, ningún zapato", titulos(bolsos));

  const gorras = await callado(() => S.buscarProductos(envDrive, "gorras", 10, { categoria: "gorra" }));
  ok(gorras.productos.length === 2 && gorras.productos.every((p) => C.categoriaDeProducto(p) === "gorra"), "'gorras' → las dos gorras", titulos(gorras));

  const mochila = await callado(() => S.buscarProductos(envDrive, "mochila Nike", 10, { categoria: "bolso" }));
  ok(mochila.productos.length === 1 && /Heritage/.test(mochila.productos[0].titulo), "'mochila Nike' (la carpeta se llama BOLSOS y el título no dice mochila) → el bolso Nike", titulos(mochila));

  const camisas = await callado(() => S.buscarProductos(envDrive, "camisa", 10, { categoria: "camisa" }));
  ok(camisas.productos.length === 1 && /Sportswear/.test(camisas.productos[0].titulo), "'camisa' → lo de FRANELAS (es lo mismo)", titulos(camisas));

  const jeans = await callado(() => S.buscarProductos(envDrive, "jean", 10, { categoria: "pantalon" }));
  ok(jeans.productos.length === 1 && /Levis/.test(jeans.productos[0].titulo), "'jean' → el jean (no el jogger)", titulos(jeans));

  const calzadoNike = await callado(() => S.buscarProductos(envDrive, "Nike", 10, { categoria: "calzado" }));
  ok(calzadoNike.productos.length === 2 && calzadoNike.productos.every((p) => C.categoriaDeProducto(p) === "calzado"), "'Nike' + calzado → solo los zapatos Nike", titulos(calzadoNike));

  const shorts = await callado(() => S.buscarProductos(envDrive, "Nike", 10, { categoria: "short" }));
  ok(shorts.productos.length === 1 && /Dri-Fit/.test(shorts.productos[0].titulo), "'Nike' + short → el short (carpeta SHORT), no el jogger de PANTALONES", titulos(shorts));
  const uniformes = await callado(() => S.buscarProductos(envDrive, "uniformes", 10, { categoria: "uniforme" }));
  ok(uniformes.productos.length === 1 && /Madrid/.test(uniformes.productos[0].titulo), "'uniformes' → lo de UNIFORMES", titulos(uniformes));

  const nada = await callado(() => S.buscarProductos(envDrive, "Gucci", 10, { categoria: "bolso" }));
  ok(nada.productos.length === 0, "'Gucci' + bolso → nada (no inventa)");
  ok(bolsos.productos[0].categoria === "BOLSOS", "cada ficha lleva su carpeta (categoría)");
}

// ── De punta a punta: un mensaje de Instagram entra por el webhook ─────
const SECRETO = "secreto-de-prueba";
const SIN_RASGOS = Object.fromEntries(["camaraAireTalon", "camaraAireCompleta", "suelaTransparente", "suelaRedondeadaSinAire", "suelaPlanaPlacaDura", "muescaLateralArco", "suelaNubesHuecas", "mallaPlasticaCuadros", "alasPlasticasCordones", "jumpman", "swooshGrandeRecto", "piezaMetalicaOjal", "tresFranjas", "punteraGamuzaT", "punteraGomaConcha"].map((k) => [k, false]));
const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
const jpeg = () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } });

// Una sola base para todas (el bot recuerda en memoria que ya creó sus
// tablas); cada conversación con un cliente distinto.
const BASE = baseDeMentira();
let cliente = 100;
let llamadasAlRevisor = 0;
async function conversacion(mensaje, { texto, vision = null, cotejo = null, revisor = null, extraEnv = {} }) {
  const base = BASE;
  const igsid = String(++cliente);
  const enviados = [];
  const registro = [];
  const responder = (u, op) => {
    if (u.startsWith("https://www.googleapis.com/")) return driveDeMentira(u);
    if (u.startsWith("https://api.deepseek.com/")) {
      const sistema = JSON.parse(op.body).messages[0].content;
      if (/supervisor de calidad/.test(sistema)) {
        llamadasAlRevisor++;
        return json({ choices: [{ message: { content: JSON.stringify(revisor || { veredicto: "bien", explicacion: "ok" }) }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
      }
      const contenido = /"eleccion"/.test(sistema) ? cotejo || { eleccion: 0, confianza: "baja", porque: "ninguno es" } : /"pedirNombreExacto"/.test(sistema) ? vision : texto;
      return json({ choices: [{ message: { content: JSON.stringify(contenido) }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    }
    if (u.includes("graph.instagram.com") && u.includes("/messages")) {
      enviados.push(JSON.parse(op.body).message);
      return json({ message_id: `mid-${enviados.length}` });
    }
    if (u.includes("graph.instagram.com")) return json({ name: "Ana", username: "ana" });
    if (u.includes("hooks.slack.com")) return new Response("ok", { status: 200 });
    return jpeg();
  };
  const env = {
    ...envDrive, DB: base.DB, META_APP_SECRET: SECRETO, META_MODO: "todo", IG_TOKEN: "x", DEEPSEEK_API_KEY: "x",
    SLACK_WEBHOOK: "https://hooks.slack.com/x", URL_CATALOGO: "https://drive.test", COTEJO_BARRIDO: "no",
    ...extraEnv,
  };
  const cuerpo = JSON.stringify({ object: "instagram", entry: [{ id: "999", time: Date.now(), messaging: [{ sender: { id: igsid }, recipient: { id: "999" }, timestamp: Date.now(), message: { mid: `m-${Math.random()}`, ...mensaje } }] }] });
  const firma = "sha256=" + crypto.createHmac("sha256", SECRETO).update(cuerpo).digest("hex");
  const real = globalThis.fetch, log = console.log, err = console.error;
  console.log = (...a) => registro.push(a.join(" "));
  console.error = (...a) => registro.push(a.join(" "));
  D.olvidarCatalogoDeDrive();
  try {
    globalThis.fetch = async (url, op = {}) => responder(String(url), op);
    const pendientes = [];
    await worker.fetch(new Request("https://bot.test/webhook", { method: "POST", body: cuerpo, headers: { "x-hub-signature-256": firma } }), env, { waitUntil: (p) => pendientes.push(p) });
    await Promise.all(pendientes);
  } finally {
    globalThis.fetch = real; console.log = log; console.error = err;
  }
  const fichas = enviados.flatMap((m) => m.attachment?.payload?.elements || []).map((e) => e.title);
  const textos = enviados.map((m) => m.text).filter(Boolean);
  return { fichas, textos, registro };
}

const ZAPATOS = /Air Force|Dunk|Campus/;

titulo("por TEXTO: 'tienes bolsos nike?'");
{
  const r = await conversacion({ text: "tienes bolsos nike?" }, {
    texto: { pienso: "Bolsos Nike.", respuesta: "¡Sí! Mira los bolsos Nike 👇", buscar: "bolso Nike", categoria: "bolso", historial: "Pidió bolsos Nike." },
  });
  ok(r.fichas.length === 1 && /Heritage/.test(r.fichas[0]), "le llega el bolso Nike", r.fichas.join(" · ") || r.textos.join(" | "));
  ok(!r.fichas.some((t) => ZAPATOS.test(t)), "y ningún zapato Nike");
}

titulo("por TEXTO, aunque la IA busque solo la marca");
{
  const r = await conversacion({ text: "tienes bolsos nike?" }, {
    texto: { pienso: "Nike.", respuesta: "¡Mira! 👇", buscar: "Nike", categoria: "bolso", historial: "Pidió Nike." },
  });
  ok(r.fichas.length === 1 && /Heritage/.test(r.fichas[0]), "buscar 'Nike' con categoría bolso → el bolso, no los zapatos", r.fichas.join(" · "));
}

titulo("por TEXTO, aunque la IA no diga la categoría");
{
  const r = await conversacion({ text: "quiero ver gorras" }, {
    texto: { pienso: "Gorras.", respuesta: "¡Claro! 👇", buscar: "Nike", historial: "Pidió gorras." },
  });
  ok(r.fichas.length >= 1 && r.fichas.every((t) => /cap|Yankees/.test(t)), "la categoría sale de lo que escribió el cliente: solo gorras", r.fichas.join(" · "));
}

titulo("por TEXTO: pide algo que no hay, pero sí hay de esa categoría");
{
  const r = await conversacion({ text: "tienes bolsos gucci?" }, {
    texto: { pienso: "Bolsos Gucci.", respuesta: "¡Sí tenemos bolsos Gucci! 👇", buscar: "bolso Gucci", categoria: "bolso", historial: "Pidió bolsos Gucci." },
  });
  ok(r.fichas.length === 2 && r.fichas.every((t) => /Heritage|Michael Kors/.test(t)), "le enseña los bolsos que SÍ hay", r.fichas.join(" · "));
  ok(r.textos.some((t) => /no (tengo|me queda|hay)/i.test(t) && /bolsos/.test(t) && /👜/.test(t)), "diciéndole la verdad (no 'sí tenemos Gucci'), con 👜", r.textos.join(" | "));
  ok(!r.textos.some((t) => /Sí tenemos bolsos Gucci/.test(t)), "lo que inventó la IA no sale");
}

titulo("por FOTO: un bolso Nike");
{
  const r = await conversacion({ attachments: [{ type: "image", payload: { url: "https://cdn.test/cliente.jpg" } }] }, {
    vision: { tipo: "bolso", visto: "bolso negro con swoosh de Nike", rasgos: SIN_RASGOS, buscar: "Nike", color: "negro", variosProductos: false, pedirNombreExacto: false },
    texto: { pienso: "Foto de un bolso Nike.", respuesta: "¡Mira este! 👟", buscar: "Nike", categoria: "calzado", historial: "Mandó foto de un bolso Nike." },
  });
  ok(r.fichas.length >= 1 && r.fichas.every((t) => /Heritage/.test(t)), "le llega el bolso, aunque la IA de texto se equivocara de categoría (manda la foto)", r.fichas.join(" · ") || r.textos.join(" | "));
  ok(!r.fichas.some((t) => ZAPATOS.test(t)), "ningún zapato");
  ok(!r.textos.some((t) => t.includes("👟")), "y sin 👟 en lo que se le dice", r.textos.join(" | "));
}

titulo("por FOTO: una gorra");
{
  const r = await conversacion({ attachments: [{ type: "image", payload: { url: "https://cdn.test/gorra.jpg" } }] }, {
    vision: { tipo: "gorra", visto: "gorra negra con el jumpman", rasgos: SIN_RASGOS, buscar: "gorra Nike", color: "negro", variosProductos: false, pedirNombreExacto: false },
    texto: { pienso: "Foto de una gorra Nike.", respuesta: "¡Esa la tenemos! 👇", buscar: "gorra Nike", categoria: "gorra", historial: "Mandó foto de una gorra." },
  });
  ok(r.fichas.length >= 1 && r.fichas.every((t) => /cap/.test(t)), "le llega la gorra Nike", r.fichas.join(" · ") || r.textos.join(" | "));
}

titulo("calzado sigue igual que siempre");
{
  const r = await conversacion({ text: "tienes air force?" }, {
    texto: { pienso: "Air Force.", respuesta: "¡Claro! 👟👇", buscar: "Air Force", categoria: "calzado", historial: "Pidió Air Force." },
  });
  ok(r.fichas.length === 1 && /Air Force/.test(r.fichas[0]), "Air Force → el Air Force", r.fichas.join(" · ") || r.registro.filter((l) => /FALL|Error|error/.test(l)).slice(0, 3).join(" | "));
  ok(r.textos.some((t) => t.includes("👟")), "con su 👟");
}

titulo("el revisor, con DeepSeek: apagado hasta que el dueño lo encienda");
{
  const antes = llamadasAlRevisor;
  await conversacion({ text: "tienes air force?" }, {
    texto: { pienso: "Air Force.", respuesta: "¡Claro! 👟👇", buscar: "Air Force", categoria: "calzado", historial: "Pidió Air Force." },
    extraEnv: { PROVEEDOR: "deepseek", REVISOR_IA: "no" },
  });
  ok(llamadasAlRevisor === antes, 'con REVISOR_IA = "no" no se le pregunta a nadie (no gasta)');

  await conversacion({ text: "cuanto cuesta el air force?" }, {
    texto: { pienso: "Precio del Air Force.", respuesta: "Cuesta 10$ y viene con un regalo 🎁", buscar: "Air Force", categoria: "calzado", historial: "Preguntó el precio." },
    revisor: { veredicto: "alucino", explicacion: "inventó un precio y un regalo" },
    extraEnv: { PROVEEDOR: "deepseek", REVISOR_IA: "si", REVISOR_MODELO: "deepseek-flash" },
  });
  ok(llamadasAlRevisor === antes + 1, "encendido, revisa con DeepSeek después de responder");
  const marcado = BASE.sql.prepare("SELECT marca, motivo FROM turnos WHERE pienso = 'Precio del Air Force.'").get();
  ok(marcado?.marca === "indebida" && /Alucinó/.test(marcado.motivo), "y marca 🔴 la respuesta que alucinó, con el porqué", JSON.stringify(marcado));
}

titulo("el panel: mensajes, lo que pensó la IA y la puerta del panel central");
{
  const mensajes = BASE.sql.prepare("SELECT de, texto FROM mensajes").all();
  ok(mensajes.some((m) => m.de === "cliente" && /bolsos nike/.test(m.texto)) && mensajes.some((m) => m.de === "bot" && /Fichas: .*Heritage/.test(m.texto)), "se guardan los mensajes del cliente y del bot (con las fichas)", `${mensajes.length} mensajes`);
  const turno = BASE.sql.prepare("SELECT pienso, notas, productos FROM turnos WHERE pienso = 'Bolsos Nike.'").get();
  ok(turno && /categoría: bolso/.test(turno.notas) && /Heritage/.test(turno.productos), "y lo que pensó la IA, con la categoría y las fichas", JSON.stringify(turno));

  const CLAVE = "clave-larga-del-panel-central-123";
  const env = { ...envDrive, DB: BASE.DB, PANEL_API_CLAVE: CLAVE, TIENDA_NOMBRE: "El Emperador" };
  const api = async (ruta) => {
    const r = await callado(() => worker.fetch(new Request(`https://bot.test/api/central/${ruta}`, { headers: { authorization: `Bearer ${CLAVE}` } }), env, { waitUntil() {} }));
    return { estado: r.status, datos: await r.json().catch(() => null) };
  };
  const ping = await api("ping");
  ok(ping.estado === 200 && ping.datos.tienda === "El Emperador" && /\(\d+\)/.test(ping.datos.version), "/api/central/ping: la tienda y su versión", JSON.stringify(ping.datos));
  const resumen = await api("resumen");
  ok(resumen.datos?.hoy?.clientes >= 5 && resumen.datos.hoy.respuestas >= 5, "/api/central/resumen: los números de hoy", JSON.stringify(resumen.datos?.hoy));
  const sinClave = await callado(() => worker.fetch(new Request("https://bot.test/api/central/resumen"), env, { waitUntil() {} }));
  ok(sinClave.status === 401, "sin la clave, no entra nadie");
  const estado = await callado(async () => (await worker.fetch(new Request("https://bot.test/estado"), env, { waitUntil() {} })).text());
  ok(/PANEL_API_CLAVE/.test(estado) && /PANEL_CENTRAL_URL/.test(estado), "/estado dice si están las claves del panel");
}

src.limpiar();
terminar();
