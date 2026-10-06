// LA IA APRENDE SOLA (6-oct-2026, pedido del dueño): el revisor (la IA que
// piensa) encuentra el error y escribe una REGLA; la IA de texto o la de
// imágenes la recibe en cada mensaje. Las alertas rojas no suenan: solo
// llega 🛠️ cuando hay que ponerlo en el código. El código no se reescribe
// solo: lo aprendido vive en la base y el dueño lo ve y lo olvida en ALPHA IA.

import { prepararSrc, baseDeMentira, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const V = await src.cargar("revisor.js");
const L = await src.cargar("lecciones.js");
const IA = await src.cargar("ia.js");
const R = await src.cargar("registro.js");
const { default: worker } = await src.cargar("index.js");
const { DB, sql } = baseDeMentira();
const API = "clave-larga-del-panel-central-123";
const ENV = { DB, OPENAI_API_KEY: "x", REVISOR_MODELO: "gpt-5", REVISOR_TOPE_MES: "no", APRENDER: "si", PANEL_CENTRAL_URL: "https://central.test", PANEL_API_CLAVE: API, TIENDA_ID: "invictus" };

let alertas = [];
let pedidos = [];
let veredicto = {};
const real = globalThis.fetch;
function falso() {
  globalThis.fetch = async (u, op = {}) => {
    const url = String(u?.url || u);
    if (url.startsWith("https://central.test/api/alerta")) {
      alertas.push(...JSON.parse(op.body).alertas);
      return new Response("{}", { status: 200 });
    }
    const cuerpo = JSON.parse(op.body || "{}");
    pedidos.push(cuerpo);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(veredicto) } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }), { status: 200 });
  };
}
async function callado(fn) {
  const [l, e] = [console.log, console.error];
  console.log = console.error = () => {};
  try { return await fn(); } finally { console.log = l; console.error = e; }
}
sql.exec("CREATE TABLE IF NOT EXISTS turnos (id INTEGER PRIMARY KEY AUTOINCREMENT, igsid TEXT, cuando INTEGER, cliente TEXT DEFAULT '', pienso TEXT DEFAULT '', buscar TEXT DEFAULT '', mostrar TEXT DEFAULT '', respuesta TEXT DEFAULT '', productos TEXT DEFAULT '[]', notas TEXT DEFAULT '[]', marca TEXT DEFAULT '', motivo TEXT DEFAULT '')");
const turno = (o = {}) => {
  const r = sql.prepare("INSERT INTO turnos (igsid, cuando, cliente, respuesta) VALUES ('77', ?, ?, ?)").run(Date.now(), o.cliente || "tienen la 44?", o.respuesta || "Sí tenemos la 44");
  return { id: Number(r.lastInsertRowid), igsid: "77", cliente: o.cliente || "tienen la 44?", respuesta: o.respuesta || "Sí tenemos la 44", ...o };
};

titulo("el revisor encuentra el error y la IA de texto lo aprende, en silencio");
{
  falso();
  alertas = [];
  veredicto = { veredicto: "alucino", confianza: "alta", cita: "Sí tenemos la 44", explicacion: "confirmó una talla sin fichas", correccion: "Eso te lo confirma un asesor en un momento 😊", ia: "texto", regla: "No confirmes una talla si ninguna ficha la dice: pásaselo a un asesor.", necesitaCodigo: "" };
  const v = await callado(() => V.revisarTurno(ENV, turno()));
  globalThis.fetch = real;
  ok(v?.aprendido?.id > 0 && v.aprendido.veces === 1, "guarda la regla", JSON.stringify(v?.aprendido));
  ok(alertas.length === 0, "y NO manda la alerta roja al panel (de eso se encarga la IA)", JSON.stringify(alertas));
  const marca = sql.prepare("SELECT marca FROM turnos ORDER BY id DESC LIMIT 1").get();
  ok(marca.marca === "indebida", "la respuesta queda marcada 🔴 igual (sale en Errores IA y en el informe)");
  const reglas = await L.reglasParaLaIA(ENV, "texto");
  ok(/LO QUE YA APRENDISTE/.test(reglas) && /No confirmes una talla/.test(reglas), "la IA de texto la recibe", reglas);
  ok((await L.reglasParaLaIA(ENV, "imagen")) === "", "la de imágenes no (no es suya)");
}

titulo("la IA de texto la lee en cada mensaje");
{
  pedidos = [];
  veredicto = { respuesta: "ok", buscar: "NADA", historial: "x", pienso: "x", mostrar: "texto", voz: false };
  falso();
  await callado(() => IA.responderTexto({ ...ENV, OPENAI_MODELO: "gpt-4o-mini" }, "Cliente: hola"));
  globalThis.fetch = real;
  const usuario = JSON.stringify(pedidos[0]?.messages?.slice(-1));
  ok(/No confirmes una talla/.test(usuario) && /Cliente: hola/.test(usuario), "las reglas van en el mensaje (el prompt fijo no cambia: sigue cacheado)");
  ok(!/No confirmes una talla/.test(String(pedidos[0]?.messages?.[0]?.content)), "y no en el prompt del sistema");
}

titulo("si lo repite pese a la regla: 🛠️ hay que ponerlo en el código (una sola vez)");
{
  falso();
  alertas = [];
  veredicto = { veredicto: "alucino", confianza: "alta", cita: "Sí hay la 45", explicacion: "otra talla sin fichas", correccion: "", ia: "texto", regla: "No confirmes una talla si ninguna ficha la dice.", necesitaCodigo: "" };
  await callado(() => V.revisarTurno(ENV, turno({ respuesta: "Sí hay la 45" })));
  ok(alertas.length === 0, "la segunda vez todavía no avisa (cuenta 2)");
  const tercera = await callado(() => V.revisarTurno(ENV, turno({ respuesta: "Sí, la 46 está" })));
  ok(tercera?.aprendido?.veces === 3 && alertas.length === 1 && alertas[0].tipo === "codigo" && /Hay que ponerlo en el código/.test(alertas[0].texto), "a la tercera: 🛠️ al panel", JSON.stringify(alertas[0] || {}).slice(0, 160));
  await callado(() => V.revisarTurno(ENV, turno({ respuesta: "Sí, la 47" })));
  globalThis.fetch = real;
  ok(alertas.length === 1, "y no vuelve a avisar por la misma regla");
}

titulo("si el revisor dice que no se arregla enseñándole: 🛠️ enseguida");
{
  falso();
  alertas = [];
  veredicto = { veredicto: "incoherente", confianza: "alta", cita: "Te muestro los Jordan", explicacion: "las fichas eran bolsos", ia: "texto", regla: "Enseña solo lo que pidió.", necesitaCodigo: "la búsqueda devolvió bolsos para 'Jordan': es el catálogo/la búsqueda, no la IA" };
  await callado(() => V.revisarTurno(ENV, turno({ respuesta: "Te muestro los Jordan" })));
  globalThis.fetch = real;
  ok(alertas.length === 1 && alertas[0].tipo === "codigo" && /la búsqueda devolvió bolsos/.test(alertas[0].texto), "avisa a la primera, con el porqué", JSON.stringify(alertas[0] || {}).slice(0, 160));
}

titulo("la IA de imágenes también: el revisor mira la foto y las fichas");
{
  falso();
  pedidos = [];
  alertas = [];
  veredicto = { veredicto: "foto_equivocada", confianza: "alta", cita: "", explicacion: "la foto es un TN y se enseñaron Air Max 270", ia: "imagen", regla: "Ondas de plástico que suben por el lateral con el logo TN en el talón son TN, no Air Max 270.", necesitaCodigo: "" };
  const v = await callado(() => V.revisarTurno(ENV, turno({ cliente: "(mandó una foto)", respuesta: "¡Ese lo tenemos! 👇", foto: "data:image/jpeg;base64,AAAA", imagenes: ["https://cdn.shopify.com/a.jpg"], vision: 'vio "ondas plásticas" y buscó "Air Max 270"' })));
  globalThis.fetch = real;
  const partes = pedidos[0]?.messages?.[1]?.content;
  ok(Array.isArray(partes) && partes.some((p) => p.type === "image_url" && p.image_url.url.startsWith("data:image")) && partes.some((p) => p.type === "image_url" && /cdn\.shopify/.test(p.image_url.url)), "el revisor recibe la foto del cliente y la de la ficha");
  ok(JSON.stringify(partes).includes("LO QUE HIZO LA IA DE IMÁGENES"), "y lo que la IA de imágenes vio y buscó");
  ok(v?.ia === "imagen" && v.aprendido?.id > 0 && alertas.length === 0, "guarda la regla para la IA de IMÁGENES, sin alerta roja");
  const reglas = await L.reglasParaLaIA(ENV, "imagen");
  ok(/MIRANDO FOTOS/.test(reglas) && /son TN, no Air Max 270/.test(reglas), "la IA de imágenes la recibe", reglas);
  pedidos = [];
  veredicto = { tipo: "calzado", visto: "x", rasgos: {}, buscar: "TN", color: "negro", variosProductos: false, pedirNombreExacto: false };
  falso();
  await callado(() => IA.identificarEnImagen({ ...ENV, OPENAI_MODELO_VISION: "gpt-4o" }, "data:image/jpeg;base64,AAAA"));
  globalThis.fetch = real;
  ok(JSON.stringify(pedidos[0]?.messages?.slice(-1)).includes("son TN, no Air Max 270"), "y la lee cuando mira la foto de un cliente");
}

titulo("sin APRENDER, todo como antes (alerta roja, sin reglas)");
{
  falso();
  alertas = [];
  veredicto = { veredicto: "alucino", confianza: "alta", cita: "x", explicacion: "y", regla: "z" };
  await callado(() => V.revisarTurno({ ...ENV, APRENDER: "no" }, turno()));
  globalThis.fetch = real;
  ok(alertas.length === 1 && alertas[0].tipo === "indebida", "manda la 🔴 como siempre");
  ok((await L.reglasParaLaIA({ ...ENV, APRENDER: "no" }, "texto")) === "", "y la IA no recibe reglas");
  falso();
  alertas = [];
  await R.alertarCentral(ENV, [{ tipo: "error", texto: "Shopify 500" }, { tipo: "queja", texto: "no es eso" }, { tipo: "corregida", texto: "precio" }]);
  globalThis.fetch = real;
  ok(alertas.map((a) => a.tipo).join(",") === "error", "con APRENDER: los fallos técnicos ❌ sí llegan; las quejas y correcciones no", alertas.map((a) => a.tipo).join(","));
}

titulo("el panel ALPHA IA: ver lo aprendido y olvidar una regla");
{
  const api = async (ruta, cuerpo = null) => {
    const r = await callado(() => worker.fetch(new Request(`https://bot.test/api/central/${ruta}`, { method: cuerpo ? "POST" : "GET", headers: { authorization: `Bearer ${API}`, "content-type": "application/json" }, body: cuerpo ? JSON.stringify(cuerpo) : null }), { ...ENV, IG_TOKEN: "x", META_APP_SECRET: "s" }, { waitUntil() {} }));
    return r.json();
  };
  const d = await api("lecciones");
  ok(d.activo === true && d.lecciones.length >= 3, "la tienda da sus reglas", `${d.lecciones?.length}`);
  const conCodigo = d.lecciones.filter((l) => l.hayQueTocarCodigo);
  ok(conCodigo.length === 2, "con las 2 que hay que poner en el código marcadas", conCodigo.map((l) => l.regla).join(" | "));
  const unaDeFoto = d.lecciones.find((l) => l.tipo === "imagen");
  await api("olvidar-leccion", { id: unaDeFoto.id });
  ok(!/son TN, no Air Max 270/.test(await L.reglasParaLaIA(ENV, "imagen")), "olvidada: la IA ya no la recibe");
}

titulo("dos reglas dichas con otras palabras son la misma");
ok(L.parecido("No confirmes una talla si ninguna ficha la dice.", "No confirmes tallas si ninguna ficha las dice: pásaselo a un asesor.") >= 0.5, "parecidas → se cuentan juntas");
ok(L.parecido("No confirmes una talla si ninguna ficha la dice.", "Ondas de plástico con logo TN son TN.") < 0.5, "distintas → reglas aparte");

terminar();
