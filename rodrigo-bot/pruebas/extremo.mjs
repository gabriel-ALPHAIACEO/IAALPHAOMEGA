// RODRIGO (tienda nueva, 15-oct-2026): lo que de verdad le llega al cliente
// cuando la tienda todavía NO tiene datos propios cargados. Todo lo que no
// sabe lo contesta un asesor, y no aparece nada de otra tienda.
//
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
  const prompts = [];
  const falso = async (url, opciones = {}) => {
    const u = String(url);
    if ((u.includes("api.openai.com") || u.includes("api.deepseek.com"))) {
      try {
        const cuerpoModelo = JSON.parse(opciones.body || "{}");
        const sistema = (cuerpoModelo.messages || []).find((m) => m.role === "system")?.content;
        if (sistema) prompts.push(String(sistema));
      } catch {}
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
  return { falso, enviados, slack, prompts };
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
    META_APP_SECRET: SECRETO, JUNTAR_SEGUNDOS: "0",
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

  const { falso, enviados, slack, prompts } = fetchDeMentira({
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
  return { textos, todo: textos.join("\n---\n"), slack, prompts, registro: registro.join("\n") };
}

const AHORA = Date.parse("2026-10-16T12:00:00-04:00");
const JORDAN = [
  { titulo: "Jordan 4 negro caballero", precio: 120, imagen: "https://cdn.test/j4n.jpg" },
  { titulo: "Jordan 4 blanco caballero", precio: 120, imagen: "https://cdn.test/j4b.jpg" },
];
const DE_OTRA_TIENDA = /Emperador|Invictus|doble A|triple A|1\.1 top|ZOOM|MRW|Margarita|Porlamar|Boulevard|8:30|Cancha Fray|Mercado la Isla/i;

titulo("un saludo: contesta lo que dice el modelo y no sale nada de otra tienda");
{
  const r = await conversar("hola", { ahora: AHORA, respuestaModelo: { respuesta: "¡Hola! Soy la asistente virtual de Rodrigo 👋 ¿Qué modelo estás buscando?", buscar: "NADA", historial: "Saludó." } });
  ok(r.textos.length === 1 && /asistente virtual de Rodrigo/.test(r.todo), "un solo mensaje, de Rodrigo", r.todo.slice(0, 120));
  ok(!DE_OTRA_TIENDA.test(r.todo), "sin nada de otra tienda", r.todo.slice(0, 120));
}

titulo("buscar un zapato manda las fichas");
{
  const r = await conversar("tienes jordan 4?", {
    ahora: AHORA, productos: JORDAN,
    respuestaModelo: { respuesta: "¡Sí tengo! Mira 👇", buscar: "Jordan 4", categoria: "calzado", historial: "Pidió Jordan 4. Ya busqué: Jordan 4." },
  });
  ok(/Sí tengo/.test(r.todo) && r.textos.some((t) => /Jordan 4 negro caballero/.test(t)), "texto + carrusel con los Jordan 4", r.todo.slice(0, 160));
  ok(r.slack.length === 0, "y sin avisos a Slack");
}

titulo("lo que Rodrigo todavía no cargó NO se inventa: el prompt manda al asesor");
{
  const r = await conversar("a que hora abren?", { ahora: AHORA, respuestaModelo: { respuesta: "Eso te lo confirma un asesor en un momento 😊", buscar: "NADA", historial: "Preguntó el horario." } });
  ok(/confirma un asesor/.test(r.todo) && !/\d\s*(am|pm)/i.test(r.todo), "el horario va al asesor", r.todo.slice(0, 120));
  const p = r.prompts[0] || "";
  ok(p.length > 1000, "se armó el prompt de texto", `${p.length} caracteres`);
  ok(/Estos NO los sabes \(la tienda todavía no los cargó\): Horario, Envíos, Delivery, Empleo/.test(p), "el prompt dice que NO sabe el horario, los envíos, el delivery ni el empleo");
  ok(!/\{\{\w+\}\}/.test(p), "y no queda ningún {{MARCADOR}} sin rellenar", (p.match(/\{\{\w+\}\}/g) || []).join(" "));
  ok(/Rodrigo/.test(p) && !DE_OTRA_TIENDA.test(p), "habla de Rodrigo y no trae ni un dato de otra tienda", (p.match(DE_OTRA_TIENDA) || []).join(" "));
  ok(/La calidad te la confirma un asesor/.test(p) && !/doble A|triple A/i.test(p), "la calidad la confirma un asesor (no hay gama inventada)");
  ok(/La tienda vende CALZADO\./.test(p) && !/gorra|bolso|franela/i.test(p.split("QUÉ VENDE LA TIENDA")[1]?.slice(0, 900) || ""), "y dice que solo vende calzado");
}

titulo("Cashea sin cargar: no sale ninguna tarjeta ni promesa");
{
  const r = await conversar("Tienes cashea?", { ahora: AHORA, respuestaModelo: { respuesta: "Eso te lo confirma un asesor en un momento 😊", buscar: "NADA", historial: "Preguntó por Cashea." } });
  ok(!/• Nivel|de inicial|cuotas/i.test(r.todo), "ninguna tabla de niveles ni cuotas", r.todo.slice(0, 120));
  ok(/confirma un asesor/.test(r.todo), "lo contesta un asesor", r.todo.slice(0, 120));
  ok(!/trabaja con Cashea|CASHEA \(crítico\)[^]{0,200}Nivel 1/.test(r.prompts[0] || ""), "y el prompt no le enseña ninguna tabla de Cashea");
}

titulo("la dirección sin cargar va al asesor (no se inventa)");
{
  const r = await conversar("donde estan ubicados?", { ahora: AHORA, respuestaModelo: { respuesta: "Eso te lo confirma un asesor en un momento 😊", buscar: "NADA", historial: "Preguntó la ubicación." } });
  ok(!DE_OTRA_TIENDA.test(r.todo), "no sale la dirección de otra tienda", r.todo.slice(0, 160));
}

terminar();
