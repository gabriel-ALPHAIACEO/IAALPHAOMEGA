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
function fetchDeMentira({ respuestaModelo }) {
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
      return new Response(JSON.stringify({ data: { products: { edges: [], pageInfo: { hasNextPage: false } } } }), {
        status: 200,
      });
    }
    return new Response("", { status: 404 });
  };
  return { falso, enviados, slack };
}

async function conversar(texto, { respuestaModelo, ahora } = {}) {
  const src = await prepararSrc();
  const { default: worker } = await src.cargar("index.js");
  const base = baseDeMentira();
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
    src.limpiar();
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
  ok(/mercado la isla/.test(u.todo), "la ubicación llega", u.todo.slice(0, 100));
  const m = await conversar("que metodos de pago tienen?");
  ok(/Pago Móvil/.test(m.todo) && /Zelle/.test(m.todo) && /Banesco Panamá/.test(m.todo), "los métodos, todos", m.todo.slice(0, 100));
  ok(m.slack.length === 0, "y sin avisar a nadie");
  const d = await conversar("pasame los datos para pagar", {
    respuestaModelo: { respuesta: "Eso te lo confirma un asesor en un momento 😊", buscar: "NADA", historial: "Pidió los datos." },
  });
  ok(d.slack.some((t) => /PIDE LOS DATOS PARA PAGAR/.test(t)), "pedir los datos sí avisa al asesor", d.slack.join(" | ").slice(0, 120));
}

terminar();
