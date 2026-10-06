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
    if ((u.includes("api.openai.com") || u.includes("api.deepseek.com"))) {
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
    DEEPSEEK_API_KEY: "x",
    SHOPIFY_TIENDA: "tienda.test",
    SHOPIFY_TOKEN: "x",
    SLACK_WEBHOOK: "https://hooks.slack.com/x",
    URL_CATALOGO: "https://tienda.test",
    DIRECCION: "Estamos en la calle de prueba, local 1",
    MAPS_URL: "https://maps.app.goo.gl/PRUEBA",
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
  return { textos, todo: textos.join("\n---\n"), slack, registro: registro.join("\n") };
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
  ok(/calle de prueba/.test(u.todo), "la ubicación llega", u.todo.slice(0, 100));
  // El Emperador todavía no tiene sus métodos en pagos.txt: no se inventan,
  // contesta la IA (que manda al asesor).
  const m = await conversar("que metodos de pago tienen?", {
    respuestaModelo: { respuesta: "Eso te lo confirma un asesor en un momento 😊", buscar: "NADA", historial: "Preguntó métodos." },
  });
  ok(!/Pago Móvil|Zelle|Banesco/.test(m.todo) && /asesor/.test(m.todo), "sin métodos cargados, ninguno inventado: al asesor", m.todo.slice(0, 100));
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
  ok(!/Cashea|calle de prueba|métodos de pago|no hacemos|Nuestro horario/.test(r.todo),
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
  ok(/Respuesta del modelo/.test(r.todo) && !/no hacemos|Nuestro horario/.test(r.todo),
     `"${texto}" → contesta el modelo, no un atajo`, r.todo.slice(0, 80));
}

titulo("las preguntas de la tienda: las redacta la IA, personalizadas");
{
  // El Emperador NO hace delivery (dueño, 1-oct): la IA lo dice a su manera.
  const buena = "A Macanao por ahora no hacemos delivery 😊 ¿Te muestro los modelos que tenemos?";
  const r = await conversar("Tienes delivery para macanao?", {
    respuestaModelo: { respuesta: buena, buscar: "NADA", historial: "Preguntó delivery a Macanao." },
  });
  ok(r.todo.includes("A Macanao por ahora no hacemos delivery"), "le llega la respuesta personalizada (nombra Macanao)", r.todo.slice(0, 80));
  ok(/delivery/.test(r.registro) && /lo redacta el modelo/.test(r.registro), "y el registro dice que la redactó el modelo");
  const dom = await conversar("abren los domingos?", {
    respuestaModelo: { respuesta: "¡Sí! 🕘 Los domingos abrimos de 8:30am a 1:30pm", buscar: "NADA", historial: "Preguntó domingos." },
  });
  ok(dom.todo.includes("Los domingos abrimos de 8:30am a 1:30pm"), "el horario de El Emperador, personalizado, pasa", dom.todo.slice(0, 80));
}
titulo("…y si la IA inventa, sale el texto fijo de la tienda");
for (const [texto, inventa, espera] of [
  ["Tienes delivery para macanao?", "¡Sí! Hacemos delivery a Macanao 🛵", /no hacemos delivery/],
  ["hacen envios?", "¡Claro! Enviamos por Tealca, llega en 24 horas", /no hacemos envíos/],
  ["abren el sabado?", "Los sábados abrimos de 9am a 2pm", /Lunes a sábado — 8:30am a 5:30pm/],
]) {
  const r = await conversar(texto, { respuestaModelo: { respuesta: inventa, buscar: "NADA", historial: "x" } });
  ok(espera.test(r.todo) && !r.todo.includes(inventa), `"${texto}" con invento → texto fijo`, r.todo.slice(0, 60));
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
  // Cashea NO suena en Slack (dueño, 6-oct-2026: "todo menos preguntaron
  // por Cashea"), pero queda guardado: sale en el panel.
  ok(!r.slack.some((t) => /CASHEA/i.test(t)), "lo de Cashea NO suena en Slack", r.slack.join(" | ").slice(0, 120));
  const guardado = sesion.base.sql.prepare("SELECT motivo FROM avisos WHERE instr(motivo, 'CONFIRMARLE LOS MONTOS') > 0").get();
  ok(Boolean(guardado), "pero el aviso queda guardado para el panel", JSON.stringify(guardado));

  // Cashea + OTRA razón en el mismo mensaje: el aviso suena, por la otra.
  const r2 = await conversar("y talla 42 tienen? lo pago con cashea nivel 3", {
    sesion, ahora: DIA, productos: J40,
    respuestaModelo: { pienso: "Talla 42 y Cashea.", respuesta: "¡Claro! 🙌", buscar: "Jordan 40", historial: "Pidió Jordan 40 talla 42 y Cashea. Ya busqué: Jordan 40." },
  });
  ok(r2.slack.some((t) => /TALLAS/.test(t)) && !r2.slack.some((t) => /^\*CASHEA|CONFIRMARLE LOS MONTOS/.test(t)), "Cashea + talla en el mismo mensaje: suena, por la talla", r2.slack.join(" | ").slice(0, 160));
  ok(!/Habla del Jordan 40/.test(r.todo), "lo que la IA pensó NO le llega al cliente");
  sesion.src.limpiar();
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
