// QUIEN LLEGA DESDE UN ANUNCIO.
//
// Meta manda el aviso SIN mensaje dentro, y por eso se caía por el "evento
// que no lleva mensaje": la persona pulsaba "Enviar mensaje" en la
// publicidad y del otro lado no contestaba nadie, después de que la tienda
// pagara por ese clic.
import { leerMensaje } from "./.stub/instagram.js";
import { turno, HOJA } from "./banco.mjs";

let fallos = 0;
const comprobar = (n, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};

const textos = (enviados) => enviados.filter((m) => m.text).map((m) => m.text).join(" ");
const fichas = (enviados) =>
  (enviados.find((m) => m.attachment)?.attachment?.payload?.elements || []).map((e) => e.title);

// ── Leerlo del webhook, en los tres sitios donde Meta lo pone ──
const soloAviso = leerMensaje({ entry: [{ messaging: [{
  sender: { id: "u1" },
  referral: { source: "ADS", type: "OPEN_THREAD", ad_id: "120",
    ads_context_data: { ad_title: "Samsung A57 en oferta", photo_url: "https://cdn/a.jpg", post_id: "18099" } },
}] }] });
comprobar("el aviso suelto se atiende", soloAviso?.tipo, "anuncio");
comprobar("con el título del anuncio", soloAviso?.anuncio?.titulo, "Samsung A57 en oferta");
comprobar("y el post del que salió", soloAviso?.anuncio?.publicacion, "18099");

const conMensaje = leerMensaje({ entry: [{ messaging: [{
  sender: { id: "u1" },
  message: { mid: "m1", text: "hola, precio?", referral: { source: "ADS", ads_context_data: { ad_title: "Poco X8 pro 5G" } } },
}] }] });
comprobar("el primer mensaje trae su anuncio", conMensaje?.anuncio?.titulo, "Poco X8 pro 5G");
comprobar("y sigue siendo un mensaje de texto", conMensaje?.tipo, "texto");

const porBoton = leerMensaje({ entry: [{ messaging: [{
  sender: { id: "u1" },
  postback: { payload: "VER", referral: { source: "ADS", ad_id: "77" } },
}] }] });
comprobar("el botón de un anuncio tampoco se tira", porBoton?.tipo, "anuncio");

// Un evento normal sin nada sigue descartándose.
comprobar("un 'visto' se sigue ignorando", leerMensaje({ entry: [{ messaging: [{ read: {} }] }] }), null);

// ── El turno completo ──────────────────────────────────────────
let r = await turno({
  mensaje: { tipo: "anuncio", texto: "", anuncio: { fuente: "ADS", id: "120", titulo: "Samsung A57 — llévatelo hoy", foto: "", publicacion: "" } },
  respuestaDelModelo: { buscar: "Samsung A57", respuesta: "¡Hola! Soy la asistente de EPICCELL 👋 Te muestro 👇" },
});
comprobar("le contesta al que viene del anuncio", r.enviados.length > 0, true);
comprobar("y con el equipo del anuncio", fichas(r.enviados).includes("Samsung A57"), true);

// El anuncio del que Meta no cuenta nada: se le saluda igual.
r = await turno({
  mensaje: { tipo: "anuncio", texto: "", anuncio: { fuente: "ADS", id: "999", titulo: "", foto: "", publicacion: "" } },
});
comprobar("sin datos del anuncio, lo saluda y le pregunta", /qu[eé] (equipo|est[aá]s)/i.test(textos(r.enviados)), true);
comprobar("y no le dice que no pudo abrir nada", /no pude abrir|no me lleg[oó]/i.test(textos(r.enviados)), false);

// ── LAS IMÁGENES EXACTAS DEL ANUNCIO (30-sep-2026) ─────────────
//
// El dueño: "las personas que vienen de los anuncios no responde bien, no
// manda las imágenes exactas". El anuncio era de UN equipo y el cliente
// recibía la marca entera, porque el mensaje con el que llega ("Quiero
// más información") no nombra nada y el modelo buscaba a lo ancho.
const anuncioDelX8 = {
  fuente: "ADS", id: "", titulo: "Poco X8 pro 5G 8/256 — ¡llévatelo hoy!", foto: "", publicacion: "",
};

r = await turno({
  texto: "¡Hola! Quiero más información",
  mensaje: { anuncio: anuncioDelX8 },
  respuestaDelModelo: { buscar: "Poco", respuesta: "¡Hola! Soy la asistente virtual de EPICCELL 👋 Mira 👇" },
});
comprobar("del anuncio del Poco X8 sale el Poco X8, no todos los Poco", fichas(r.enviados), ["Poco X8 pro 5G"]);

r = await turno({
  texto: "precio?",
  mensaje: { anuncio: anuncioDelX8 },
  respuestaDelModelo: { buscar: "NADA", respuesta: "¡Hola! Soy la asistente virtual de EPICCELL 👋 ¿Qué equipo buscas?" },
});
comprobar("aunque el modelo no busque nada, sale el del anuncio", fichas(r.enviados), ["Poco X8 pro 5G"]);
comprobar("y no le pregunta qué equipo busca", /qu[eé] equipo buscas/i.test(textos(r.enviados)), false);

// Pero si el cliente nombra OTRO, manda el cliente.
r = await turno({
  texto: "tienes el samsung a57?",
  mensaje: { anuncio: anuncioDelX8 },
  respuestaDelModelo: { buscar: "Samsung A57", respuesta: "¡Hola! Soy la asistente virtual de EPICCELL 👋 Déjame revisar 👇" },
});
comprobar("si pide otro equipo, sale el que pidió", fichas(r.enviados), ["Samsung A57"]);

// Y si el equipo del anuncio se agotó, no se inventa: sale su familia.
const sinElX8 = HOJA.split("\n").filter((l) => !l.startsWith("Poco X8")).join("\n");
r = await turno({
  texto: "info",
  hoja: sinElX8,
  mensaje: { anuncio: anuncioDelX8 },
  respuestaDelModelo: { buscar: "Poco X8 pro 5G", respuesta: "¡Hola! Soy la asistente virtual de EPICCELL 👋 Déjame revisar 👇" },
});
comprobar("agotado el del anuncio, no sale como si estuviera", fichas(r.enviados).includes("Poco X8 pro 5G"), false);
comprobar("y le muestra otros Poco", fichas(r.enviados).some((t) => /^Poco/.test(t)), true);
comprobar("diciéndole que ESE no está, por su nombre", /Poco X8 Pro 5G/i.test(textos(r.enviados)) && /no\b/i.test(textos(r.enviados)), true);
comprobar("sin decirle que lo tiene", /aqu[ií] lo tienes|s[ií] lo tengo|este es/i.test(textos(r.enviados)), false);
comprobar("y con la bienvenida, que es su primer mensaje", /asistente virtual de EPICCELL/.test(textos(r.enviados)), true);

// Un anuncio que nombra DOS equipos no señala uno: no se impone ninguno.
r = await turno({
  texto: "info",
  mensaje: { anuncio: { ...anuncioDelX8, titulo: "Samsung A57 y Samsung A17 con Cashea" } },
  respuestaDelModelo: { buscar: "Samsung", respuesta: "¡Hola! Soy la asistente virtual de EPICCELL 👋 Mira 👇" },
});
comprobar("anuncio de dos equipos: salen los dos", ["Samsung A57", "Samsung A17"].every((t) => fichas(r.enviados).includes(t)), true);

// Y el que escribe el nombre completo, con "5G", no es "otro modelo".
r = await turno({
  texto: "tienes el poco x8 pro 5g?",
  respuestaDelModelo: { buscar: "Poco X8 pro 5G", respuesta: "¡Hola! Soy la asistente virtual de EPICCELL 👋 Déjame revisar 👇" },
});
comprobar("\"poco x8 pro 5g\" en la hoja: no le dice que no está", /no (lo )?tengo|no est[aá]/i.test(textos(r.enviados)), false);
comprobar("y sale el X8", fichas(r.enviados)[0], "Poco X8 pro 5G");

// ── ANUNCIOS DE VERDAD: LARGOS Y LLENOS DE NÚMEROS ─────────────
//
// "3 cuotas", "$210", "20%": nada de eso es otro modelo.
const largo = {
  ...anuncioDelX8,
  titulo: "🔥 ¡Llegó el Poco X8 pro 5G 8/256! Llévatelo por $210 o con Cashea en 3 cuotas, inicial desde el 20% 💥",
};
r = await turno({
  texto: "¡Hola! Quiero más información",
  mensaje: { anuncio: largo },
  respuestaDelModelo: { buscar: "Poco", respuesta: "¡Hola! Soy la asistente virtual de EPICCELL 👋 Mira 👇" },
});
comprobar("anuncio largo con precio y cuotas: sale el Poco X8", fichas(r.enviados), ["Poco X8 pro 5G"]);
comprobar("y no le dice que no está", /no (lo )?tengo|no me queda|no est[aá]/i.test(textos(r.enviados)), false);

// Un accesorio: "45w" no es un número de modelo de teléfono.
const hojaConCargador = HOJA + "\nSamsung Cargador original 45w Samsung,25,,https://x/carg.jpg";
r = await turno({
  texto: "precio?",
  hoja: hojaConCargador,
  mensaje: { anuncio: { ...anuncioDelX8, titulo: "Cargador Samsung original de 45W, carga súper rápida ⚡" } },
  respuestaDelModelo: { buscar: "cargador", respuesta: "¡Hola! Soy la asistente virtual de EPICCELL 👋 Mira 👇" },
});
comprobar("anuncio de un cargador: sale ese cargador", fichas(r.enviados), ["Samsung Cargador original 45w Samsung"]);

// Meta manda la FOTO pero no el título: el texto se lee de la API.
r = await turno({
  texto: "info",
  env: { ADS_TOKEN: "t" },
  apis: { "graph.facebook.com": { creative: { title: "Samsung A17 al mejor precio", image_url: "https://cdn/a17.jpg" } } },
  mensaje: { anuncio: { fuente: "ADS", id: "555", titulo: "", foto: "https://cdn/foto-del-anuncio.jpg", publicacion: "" } },
  respuestaDelModelo: { buscar: "Samsung", respuesta: "¡Hola! Soy la asistente virtual de EPICCELL 👋 Mira 👇" },
});
comprobar("con foto y sin título, lee el anuncio y manda el A17", fichas(r.enviados), ["Samsung A17"]);

// Si en ese primer mensaje pide OTROS, no se le impone el del anuncio.
r = await turno({
  texto: "hola, tienes otros modelos?",
  mensaje: { anuncio: anuncioDelX8 },
  respuestaDelModelo: { buscar: "Poco", respuesta: "¡Hola! Soy la asistente virtual de EPICCELL 👋 Mira estos 👇" },
});
comprobar("pide otros: no se queda solo con el del anuncio", fichas(r.enviados).length > 1, true);

// ── EL AVISO QUE LLEGA PELADO ─────────────────────────────────
//
// Meta no siempre manda el titulo y la foto del anuncio: hay avisos con el
// id y nada mas. Con ADS_TOKEN el bot va a buscar el anuncio a la API.
const { detallesDelAnuncio } = await import("./.stub/anuncio.js");

const comoResponderiaMeta = {
  name: "CAMPAÑA SEPT - Note 17",
  creative: {
    title: "Redmi Note 17 en oferta",
    body: "Llévatelo con Cashea, cuotas sin intereses",
    image_url: "https://cdn/ad.jpg",
    effective_object_story_id: "17841_18099",
  },
};

globalThis.fetch = async (url) => {
  if (String(url).includes("graph.facebook.com")) {
    return { ok: true, status: 200, json: async () => comoResponderiaMeta };
  }
  return { ok: false, status: 404, text: async () => "", json: async () => ({}) };
};

let leido = await detallesDelAnuncio({ ADS_TOKEN: "t" }, "120212345678901234");
comprobar("lee el título del anuncio", leido?.titulo, "Redmi Note 17 en oferta");
comprobar("y su texto", /Cashea/.test(leido?.texto || ""), true);
comprobar("y su imagen", leido?.imagen, "https://cdn/ad.jpg");
comprobar("y el post del que salió", leido?.publicacion, "17841_18099");

// Sin el secreto no se intenta siquiera: el bot sigue funcionando con lo
// que traiga el aviso.
comprobar("sin ADS_TOKEN no llama a Meta", await detallesDelAnuncio({}, "120"), null);

// Los anuncios dinámicos ponen lo mismo en otro sitio.
const dinamico = {
  creative: {
    asset_feed_spec: {
      titles: [{ text: "Poco X8 pro 5G" }],
      bodies: [{ text: "Potencia pura" }],
      images: [{ url: "https://cdn/px8.jpg" }],
    },
  },
};
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => dinamico });
leido = await detallesDelAnuncio({ ADS_TOKEN: "t" }, "otro-anuncio");
comprobar("un anuncio dinámico también se lee", leido?.titulo, "Poco X8 pro 5G");

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
