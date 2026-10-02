// DE PUNTA A PUNTA: un mensaje de Instagram entra por el webhook, igual que
// lo manda Meta (firmado), y se mira qué le llega al cliente.
//
// POR QUÉ EXISTE (30-sep-2026). Las demás pruebas miran piezas sueltas —la
// tarjeta de Cashea, el detector de ubicación—. Todas daban verde y el
// dueño seguía viendo "Lo de Cashea te lo confirma un asesor". Una pieza que
// funciona sola puede no llegar nunca al cliente si el camino que la llama
// se desvía antes. Esto recorre el camino entero: webhook → atenderMeta →
// decidir → lo que sale por Instagram.
//
// OpenAI, Shopify, Instagram y Slack son de mentira (se cambia fetch); D1 es
// SQLite de verdad en memoria.

import { prepararSrc, baseDeMentira, ok, titulo, terminar } from "./ayuda.mjs";
import crypto from "node:crypto";

const SECRETO = "secreto-de-prueba";

// Lo que contestaría el modelo de texto. Por defecto, una frase corta.
function fetchDeMentira({ respuestaModelo, productos = [] }) {
  const enviados = [];
  const slack = [];
  const falso = async (url, opciones = {}) => {
    const u = String(url);
    if (u.includes("api.openai.com")) {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(respuestaModelo) } }],
          usage: { prompt_tokens: 100, completion_tokens: 10 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (u.includes("graph.instagram.com") && u.includes("/messages")) {
      enviados.push(JSON.parse(opciones.body).message);
      return new Response(JSON.stringify({ message_id: `mid-${enviados.length}` }), { status: 200 });
    }
    if (u.includes("graph.instagram.com")) {
      return new Response(JSON.stringify({ name: "Antonio Marín", username: "antonio" }), { status: 200 });
    }
    if (u.includes("hooks.slack.com")) {
      slack.push(JSON.parse(opciones.body).text || "");
      return new Response("ok", { status: 200 });
    }
    if (u.includes("/graphql.json")) {
      const edges = productos.map((p) => ({
        node: {
          title: p.titulo,
          featuredImage: { url: p.imagen },
          onlineStoreUrl: p.url || "https://tienda.test/p",
          priceRangeV2: { minVariantPrice: { amount: String(p.precio), currencyCode: "USD" } },
        },
      }));
      return new Response(JSON.stringify({ data: { products: { edges, pageInfo: { hasNextPage: false } } } }), {
        status: 200,
      });
    }
    return new Response("", { status: 404 });
  };
  return { falso, enviados, slack };
}

// Una conversación de VARIOS mensajes comparte base (la memoria del bot):
// conversar(texto, { sesion }) con la misma sesión sigue la charla.
export function nuevaSesion() {
  return { base: baseDeMentira(), src: null };
}

async function conversar(texto, { respuestaModelo, ahora, productos = [], sesion = null } = {}) {
  const propia = !sesion;
  sesion = sesion || nuevaSesion();
  if (!sesion.src) sesion.src = await prepararSrc();
  const src = sesion.src;
  const { default: worker } = await src.cargar("index.js");
  const base = sesion.base;
  const env = {
    DB: base.DB,
    META_APP_SECRET: SECRETO,
    META_MODO: "todo",
    IG_TOKEN: "x",
    OPENAI_API_KEY: "x",
    SHOPIFY_TIENDA: "tienda.test",
    SHOPIFY_TOKEN: "x",
    SLACK_WEBHOOK: "https://hooks.slack.com/x",
    URL_CATALOGO: "https://tienda.test",
    DIRECCION: "Estamos ubicados en el centro comercial mercado la isla",
    MAPS_URL: "https://maps.app.goo.gl/H1UF1f5CjcJc1LeWA",
  };

  const cuerpo = JSON.stringify({
    object: "instagram",
    entry: [
      {
        id: "999",
        time: Date.now(),
        messaging: [
          {
            sender: { id: "123" },
            recipient: { id: "999" },
            timestamp: Date.now(),
            message: { mid: `m-${Math.random()}`, text: texto },
          },
        ],
      },
    ],
  });
  const firma = "sha256=" + crypto.createHmac("sha256", SECRETO).update(cuerpo).digest("hex");

  const { falso, enviados, slack } = fetchDeMentira({
    productos,
    respuestaModelo: respuestaModelo || { respuesta: "¡Claro que sí! 🙌 Mira cómo te queda 👇", buscar: "NADA", historial: "Preguntó por Cashea." },
  });

  const registro = [];
  const [fetchReal, log, error, DateNow] = [globalThis.fetch, console.log, console.error, Date.now];
  globalThis.fetch = falso;
  console.log = (...a) => registro.push(a.join(" "));
  console.error = (...a) => registro.push(a.join(" "));
  if (ahora) Date.now = () => ahora;
  const tareas = [];
  try {
    await worker.fetch(
      new Request("https://bot.test/webhook", {
        method: "POST",
        headers: { "x-hub-signature-256": firma, "content-type": "application/json" },
        body: cuerpo,
      }),
      env,
      { waitUntil: (p) => tareas.push(p) }
    );
    await Promise.all(tareas);
  } finally {
    globalThis.fetch = fetchReal;
    console.log = log;
    console.error = error;
    Date.now = DateNow;
    if (propia) src.limpiar();
  }

  const textos = enviados.map((m) => m.text || m.attachment?.payload?.text || JSON.stringify(m.attachment?.payload || m));
  const botones = enviados.flatMap((m) => m.attachment?.payload?.buttons || []).map((b) => `${b.title} → ${b.url || ""}`);
  return { textos, todo: textos.join("\n---\n"), slack, registro: registro.join("\n"), botones };
}

const HOY = Date.parse("2026-09-30T19:00:00-04:00");
const EN_FECHA = Date.parse("2026-10-03T12:00:00-04:00");
const PASADA = Date.parse("2026-10-08T12:00:00-04:00");

titulo('"Tienes cashea?" HOY 30-sep (antes de que empiece)');
{
  const r = await conversar("Tienes cashea?", { ahora: HOY });
  ok(r.textos.length >= 1, "le llega respuesta", `${r.textos.length} mensaje(s)`);
  ok(/Bajada de inicial/.test(r.todo) && /Nivel 6 → 0%/.test(r.todo), "le llega la tabla de Cashea", r.todo.slice(0, 120));
  ok(/Arranca el 1 de octubre/.test(r.todo), "anunciando que arranca el 1 de octubre");
  ok(!/confirma un asesor/.test(r.todo), 'NO le dice "te lo confirma un asesor"', r.todo.slice(0, 160));
}

titulo('"Tienes cashea?" el 3 de octubre (en fecha)');
{
  const r = await conversar("Tienes cashea?", { ahora: EN_FECHA });
  ok(/Bajada de inicial/.test(r.todo) && !/confirma un asesor/.test(r.todo), "la tabla, sin asesor", r.todo.slice(0, 120));
}

titulo('"soy nivel 3" en fecha');
{
  const r = await conversar("soy nivel 3", {
    ahora: EN_FECHA,
    respuestaModelo: { respuesta: "¡Perfecto! 🙌", buscar: "NADA", historial: "Nivel Cashea: 3." },
  });
  ok(/Nivel 3/.test(r.todo) && /30% de inicial/.test(r.todo), "le dice su porcentaje", r.todo.slice(0, 160));
}

titulo("después del 6 de octubre");
{
  const r = await conversar("Tienes cashea?", { ahora: PASADA });
  ok(/confirma un asesor/.test(r.todo) && !/Bajada de inicial/.test(r.todo), "ahí sí, al asesor (promoción vencida)");
}

titulo("aunque el modelo se equivoque y diga 'asesor', la tabla llega");
{
  const r = await conversar("aceptan cashea?", {
    ahora: HOY,
    respuestaModelo: { respuesta: "Eso te lo confirma un asesor en un momento 😊", buscar: "NADA", historial: "Preguntó por Cashea." },
  });
  ok(/Bajada de inicial/.test(r.todo), "la tabla llega igual", r.todo.slice(0, 160));
  ok(!/confirma un asesor/.test(r.todo), "y la frase del asesor NO sale delante de la tabla", r.todo.slice(0, 160));
}

titulo("la ubicación y los métodos, por el camino real");
{
  const u = await conversar("donde estan ubicados?");
  ok(/mercado la isla/.test(u.todo), "la ubicación llega", u.todo.slice(0, 100));
  const m = await conversar("que metodos de pago tienen?");
  ok(/Pago Móvil/.test(m.todo) && /Zelle/.test(m.todo) && /Banesco Panamá/.test(m.todo), "los métodos, todos", m.todo.slice(0, 100));
  ok(m.slack.length === 0, "y sin avisar a nadie");
  const d = await conversar("pasame los datos para pagar", {
    respuestaModelo: { respuesta: "Eso te lo confirma un asesor en un momento 😊", buscar: "NADA", historial: "Pidió los datos." },
  });
  ok(d.slack.some((t) => /PIDE LOS DATOS PARA PAGAR/.test(t)), "pedir los datos sí avisa al asesor", d.slack.join(" | ").slice(0, 120));
}

// ───────────────────────────────────────────────────────────────────────
titulo("LO DE SIEMPRE SIGUE IGUAL: buscar un zapato manda las fichas");
const JORDAN = [
  { titulo: "Retro 4 negro caballero", precio: 120, imagen: "https://cdn.test/r4n.jpg" },
  { titulo: "Retro 4 blanco caballero", precio: 120, imagen: "https://cdn.test/r4b.jpg" },
];
{
  const r = await conversar("tienes jordan 4?", {
    productos: JORDAN,
    respuestaModelo: { respuesta: "¡Sí tengo! Mira 👇", buscar: "Retro 4", historial: "Pidió Retro 4. Ya busqué: Retro 4." },
  });
  const fichas = r.textos.find((t) => /Retro 4 negro caballero/.test(t));
  ok(/Sí tengo/.test(r.todo) && fichas, "texto + carrusel con los Retro 4", r.todo.slice(0, 120));
  ok(!/Cashea|mercado la isla|métodos de pago|personal completo|envíos nacionales/.test(r.todo),
     "sin nada de Cashea, ubicación, pagos, empleo ni envíos colado");
  ok(r.slack.length === 0, "y sin avisos a Slack");
}

titulo("frases normales que NO deben secuestrar los atajos nuevos");
for (const [texto, buscar] of [
  ["zapatos para el trabajo", "Nike"],
  ["te envío la foto del que quiero", "NADA"],
  ["los tienen abiertos?", "NADA"],
]) {
  const r = await conversar(texto, {
    productos: JORDAN,
    respuestaModelo: { respuesta: "Respuesta del modelo 👟", buscar, historial: "x" },
  });
  ok(/Respuesta del modelo/.test(r.todo) && !/personal completo|envíos nacionales|Nuestro horario/.test(r.todo),
     `"${texto}" → contesta el modelo, no un atajo`, r.todo.slice(0, 80));
}

titulo("las preguntas de la tienda: las redacta la IA, personalizadas");
{
  const buena = "¡Sí! 🛵 Hacemos delivery a toda la isla de Margarita, así que a Macanao te llega. En algunas zonas es gratis 😊";
  const r = await conversar("Tienes delivery para macanao?", {
    respuestaModelo: { respuesta: buena, buscar: "NADA", historial: "Preguntó delivery a Macanao." },
  });
  ok(r.todo.includes("a Macanao te llega"), "le llega la respuesta personalizada (nombra Macanao)", r.todo.slice(0, 80));
  ok(/delivery/.test(r.registro) && /lo redacta el modelo/.test(r.registro), "y el registro dice que la redactó el modelo");
}
titulo("…y si la IA inventa, sale el texto fijo de la tienda");
for (const [texto, inventa, espera] of [
  ["Tienes delivery para macanao?", "¡Sí! A Macanao el delivery es gratis 🛵", /isla de Margarita/],
  ["hacen envios?", "Enviamos por Tealca, llega en 24 horas", /ZOOM y MRW/],
  ["abren el sabado?", "Los sábados abrimos de 9am a 2pm", /Lunes a viernes/],
  ["estan contratando?", "¡Sí, estamos contratando!", /personal completo/],
]) {
  const r = await conversar(texto, { respuestaModelo: { respuesta: inventa, buscar: "NADA", historial: "x" } });
  ok(espera.test(r.todo) && !r.todo.includes(inventa), `"${texto}" con invento → texto fijo`, r.todo.slice(0, 60));
}

titulo('"¿tienen catálogo de dama?": la IA ya no dice que no hay catálogo (2-oct)');
{
  const r = await conversar("hola, tienen catalogo de zapatos de dama?", {
    respuestaModelo: { respuesta: "¡Hola! No tengo un catálogo para enviarte, pero dime qué modelo buscas 😊", buscar: "NADA", historial: "Pidió catálogo de dama." },
  });
  ok(!/No tengo un catálogo/.test(r.todo), "la frase 'no tengo un catálogo' NO le llega", r.todo.slice(0, 100));
  ok(r.botones.some((b) => /Ver catálogo → https:\/\/tienda\.test/.test(b)), "le llega el botón 'Ver catálogo' con el enlace de la tienda", r.botones.join(" | "));

  const bien = await conversar("me pasas el catalogo de cholas porfa", {
    respuestaModelo: { respuesta: "¡Claro! Aquí tienes el catálogo 👇", buscar: "NADA", historial: "Pidió catálogo de cholas." },
  });
  ok(/Aquí tienes el catálogo/.test(bien.todo) && bien.botones.some((b) => /Ver catálogo/.test(b)), "si lo pide con más palabras, la IA contesta y el botón sale debajo", bien.botones.join(" | "));

  const normal = await conversar("tienen jordan 4?", {
    productos: JORDAN,
    respuestaModelo: { respuesta: "¡Sí tengo! Mira 👇", buscar: "Retro 4", historial: "Pidió Retro 4." },
  });
  ok(!normal.botones.some((b) => /Ver catálogo/.test(b)), "y una búsqueda normal sigue SIN botón de catálogo (regla 6)", normal.botones.join(" | "));

  const src = await prepararSrc();
  const K = await src.cargar("catalogo.js");
  for (const t of ["tienen catalogo?", "hola, tienen catálogo de dama", "pásame el link de la tienda", "tienen página web?", "catalogo de cholas"]) {
    ok(K.nombraElCatalogo(t), `"${t}" → nombra el catálogo`);
  }
  for (const t of ["me pasas el link de pago", "tienen jordan 4?", "te mando el enlace del comprobante", "cuánto cuesta"]) {
    ok(!K.nombraElCatalogo(t), `"${t}" → no es pedir el catálogo`);
  }
  for (const t of ["No tengo un catálogo para enviarte", "Lo siento, no tenemos catálogo", "No puedo enviarte el catálogo", "no hay catálogo por ahora", "No tengo link de la tienda"]) {
    ok(K.niegaElCatalogo(t), `atrapa "${t}"`);
  }
  for (const t of ["¡Claro! Aquí tienes el catálogo 👇", "Mira el catálogo completo 👇", "No tengo ese modelo, pero mira estos 👟"]) {
    ok(!K.niegaElCatalogo(t), `deja pasar "${t}"`);
  }
  src.limpiar();
}

titulo("el cliente grosero: la IA no le contesta igual (2-oct)");
{
  const r = await conversar("esta mrd de tienda no responde, tienen las jordan o no?", {
    productos: JORDAN,
    respuestaModelo: { respuesta: "Verga, perdón. ¡Sí tengo Jordan, mira 👇", buscar: "Retro 4", historial: "Pidió Jordan, molesto." },
  });
  ok(!/verga/i.test(r.todo) && /Sí tengo Jordan/.test(r.todo), "la grosería no sale; lo útil sí, con los zapatos", r.todo.slice(0, 100));
}

titulo('"X cuanto me lo dejan en cashea soy level 6" después de ver los Jordan 40 (2-oct)');
{
  const DIA = Date.parse("2026-10-02T12:00:00-04:00");
  const J40 = [
    { titulo: "Jordan 40 negro caballero", precio: 120, imagen: "https://cdn.test/j40n.jpg" },
    { titulo: "Jordan 40 blanco caballero", precio: 120, imagen: "https://cdn.test/j40b.jpg" },
  ];
  const sesion = nuevaSesion();
  await conversar("tienes el jordan 40?", {
    sesion, ahora: DIA, productos: J40,
    respuestaModelo: { pienso: "Pide Jordan 40.", respuesta: "¡Sí tengo! Mira 👇", buscar: "Jordan 40", historial: "Pidió Jordan 40. Ya busqué: Jordan 40." },
  });
  const r = await conversar("X cuanto me lo dejan en cashea soy level 6", {
    sesion, ahora: DIA, productos: J40,
    respuestaModelo: { pienso: "Habla del Jordan 40; Cashea nivel 6.", respuesta: "¡Claro! 🙌 Mira cómo te queda 👇", buscar: "Jordan 40", historial: "Pidió Jordan 40. Preguntó Cashea. Nivel Cashea: 6. Ya busqué: Jordan 40." },
  });
  ok(/Nivel 6/.test(r.todo) && !/Bajada de inicial/.test(r.todo), "le contesta con su Nivel 6, sin el párrafo de la tabla", r.todo.slice(0, 160));
  const deCashea = r.textos.filter((t) => /Cashea/.test(t)).join(" ");
  ok(deCashea && !/\d+\s*USD|Inicial:\s*\d|cuotas? de \d/.test(deCashea), "la tarjeta de Cashea va sin montos de dinero", deCashea.slice(0, 200));
  ok(r.slack.some((t) => /CONFIRMARLE LOS MONTOS/.test(t)), "y el asesor recibe el aviso para confirmar los montos", r.slack.join(" | ").slice(0, 120));
  ok(!/Habla del Jordan 40/.test(r.todo), "lo que la IA pensó NO le llega al cliente");
  sesion.src.limpiar();
}

titulo("los 3 casos: solo texto, texto con fotos, fotos con poco texto (2-oct)");
{
  const DIA = Date.parse("2026-10-02T12:00:00-04:00");
  const J40 = [
    { titulo: "Jordan 40 negro caballero", precio: 120, imagen: "https://cdn.test/j40n.jpg" },
    { titulo: "Jordan 40 blanco caballero", precio: 120, imagen: "https://cdn.test/j40b.jpg" },
  ];
  const carrusel = (r) => r.textos.filter((t) => /"template_type":"generic"/.test(t)).length;
  const sesion = nuevaSesion();

  const primero = await conversar("tienes el jordan 40?", {
    sesion, ahora: DIA, productos: J40,
    respuestaModelo: { pienso: "Pide Jordan 40, no lo ha visto.", mostrar: "texto_e_imagenes", respuesta: "¡Sí tengo! Mira 👇", buscar: "Jordan 40", historial: "Pidió Jordan 40. Ya busqué: Jordan 40." },
  });
  ok(carrusel(primero) === 1 && /Sí tengo/.test(primero.todo), "TEXTO E IMÁGENES: algo nuevo → el texto y las fotos");

  const cashea = await conversar("X cuanto me lo dejan en cashea soy level 6", {
    sesion, ahora: DIA, productos: J40,
    respuestaModelo: { pienso: "Ya vio el Jordan 40; Cashea nivel 6. Solo texto.", mostrar: "texto", respuesta: "¡Claro que sí! 🙌", buscar: "Jordan 40", historial: "Preguntó Cashea. Nivel Cashea: 6. Ya busqué: Jordan 40." },
  });
  ok(carrusel(cashea) === 0, "SOLO TEXTO: pregunta de Cashea sobre los Jordan que ya vio → NO se le mandan las fotos otra vez", cashea.todo.slice(0, 120));
  ok(/Nivel 6/.test(cashea.todo) && /Jordan 40/.test(cashea.todo), "pero la tarjeta de Cashea sí sabe que es el Jordan 40");

  const otraVez = await conversar("mandamelos otra vez porfa", {
    sesion, ahora: DIA, productos: J40,
    respuestaModelo: { pienso: "Quiere volver a verlos.", mostrar: "imagenes", respuesta: "¡Claro! Aquí los tienes otra vez 👇 Son los Jordan 40 en negro y en blanco, con su precio, y cualquiera de los dos te lo puedo apartar con un asesor si te decides hoy mismo.", buscar: "Jordan 40", historial: "Pidió verlos otra vez. Ya busqué: Jordan 40." },
  });
  const textoCorto = otraVez.textos.find((t) => !/template_type/.test(t)) || "";
  ok(carrusel(otraVez) === 1 && textoCorto.length <= 60, "IMÁGENES: las fotos con un texto corto", textoCorto);
  sesion.src.limpiar();

  const contradiccion = await conversar("tienes jordan 40?", {
    productos: J40,
    respuestaModelo: { pienso: "x", mostrar: "texto", respuesta: "¡Sí! Mira estas 👇", buscar: "Jordan 40", historial: "x" },
  });
  ok(carrusel(contradiccion) === 1, "si dice 'mira estas 👇' de algo que no ha visto, las fotos van aunque haya marcado 'texto'");
  const nuevo = await conversar("hola tienes retro 4?", {
    productos: J40,
    respuestaModelo: { pienso: "x", mostrar: "texto", respuesta: "¡Sí, claro que tengo!", buscar: "Jordan 40", historial: "x" },
  });
  ok(carrusel(nuevo) === 1, "caso real (2-oct): marcó 'texto' pero los productos son NUEVOS para él → las fotos van igual");
}

titulo('"¿tienen retro 4?": el precio ya va en la foto, no se pregunta (2-oct)');
{
  const R4 = [
    { titulo: "Retro 4 negro caballero", precio: 95, imagen: "https://cdn.test/r4n.jpg" },
    { titulo: "Retro 4 blanco caballero", precio: 95, imagen: "https://cdn.test/r4b.jpg" },
  ];
  const carrusel = (r) => r.textos.filter((t) => /"template_type":"generic"/.test(t)).length;
  const r = await conversar("tienen retro 4?", {
    productos: R4,
    respuestaModelo: { pienso: "x", mostrar: "texto_e_imagenes", respuesta: "¡Sí tenemos Retro 4! 👟 ¿Quieres saber el precio?", buscar: "Retro 4", historial: "x" },
  });
  const texto = r.textos.find((t) => !/template_type/.test(t)) || "";
  ok(carrusel(r) === 1, "las fichas (con su precio) van");
  ok(!/quieres saber el precio/i.test(r.todo), "no le pregunta si quiere saber el precio", texto);
  ok(/precios están en cada foto/i.test(texto) && /Sí tenemos Retro 4/.test(texto), "le dice que los precios están en cada foto", texto);
}

titulo("la talla sigue yendo al asesor");
{
  const r = await conversar("tienen talla 42?", {
    respuestaModelo: { respuesta: "Eso te lo confirma un asesor en un momento 😊", buscar: "NADA", historial: "Preguntó talla 42." },
  });
  ok(/asesor/.test(r.todo) && r.slack.some((t) => /TALLAS/.test(t)), "contesta asesor y avisa PREGUNTO POR TALLAS");
}

titulo('el rescate, en una conversación real de dos mensajes');
{
  const sesion = nuevaSesion();
  await conversar("precio de estos", {
    sesion,
    productos: JORDAN,
    respuestaModelo: { respuesta: "Mira los que tengo 👟", buscar: "Retro 4", historial: "Respondió a una historia. Ya busqué: Retro 4." },
  });
  const r = await conversar("No ninguna de las q me estás mostrando", {
    sesion,
    respuestaModelo: { respuesta: "Te busco otras Nike 👟", buscar: "Nike", historial: "x" },
  });
  ok(/le paso tu foto a un asesor/.test(r.todo) && !/otras Nike/.test(r.todo), "se disculpa y lo pasa a una persona (no busca otras Nike)", r.todo.slice(0, 80));
  ok(r.slack.some((t) => /NO ACERTÓ EL ZAPATO/.test(t)), "y el asesor recibe el aviso");
  const despues = await conversar("hola?", { sesion });
  ok(!/Te busco|Mira los que tengo/.test(despues.todo), "después, el bot se queda apartado (no habla por encima del asesor)", despues.todo.slice(0, 60));

  const variante = nuevaSesion();
  await conversar("precio de estos", {
    sesion: variante,
    productos: JORDAN,
    respuestaModelo: { respuesta: "Mira los que tengo 👟", buscar: "Retro 4", historial: "Respondió a una historia. Ya busqué: Retro 4." },
  });
  const v = await conversar("no es ese color, quiero en blanco", {
    sesion: variante,
    productos: JORDAN,
    respuestaModelo: { respuesta: "¡Claro! En blanco 👇", buscar: "Retro 4 blanco", historial: "Pide Retro 4 blanco." },
  });
  ok(/En blanco/.test(v.todo) && !/asesor/.test(v.todo), '"no es ese color, quiero en blanco" sigue la venta (no rescata)', v.todo.slice(0, 60));
  sesion.src.limpiar();
  variante.src.limpiar();
}

terminar();
