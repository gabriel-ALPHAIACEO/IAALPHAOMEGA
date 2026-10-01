// LAS 50 CONEXIONES POR PASADA DE CLOUDFLARE (1-oct-2026).
//
// QUÉ PASÓ. El registro de El Emperador se llenó de "Too many subrequests
// by single Worker invocation": con DeepSeek el Worker baja cada foto antes
// de mandarla, y una tanda del índice de 40 fotos pedía más de 80
// conexiones. El plan gratis de Cloudflare corta a las 50.
//
// AQUÍ CLOUDFLARE ES DE MENTIRA PERO ESTRICTO: la conexión número 51 de una
// pasada revienta con el mismo error que en producción. Se comprueba que:
//   · el índice se reparte en varias pasadas sin pasarse nunca;
//   · un cliente que manda una foto SIEMPRE recibe respuesta, aunque el
//     cotejo quiera mirar más fotos de las que caben.

import { prepararSrc, baseDeMentira, ok, titulo, terminar } from "./ayuda.mjs";
import crypto from "node:crypto";

const LIMITE = 50;

// Un Cloudflare de mentira: cuenta las conexiones de cada pasada y revienta
// en la 51, como el de verdad.
function cloudflare(responder) {
  const estado = { conexiones: 0, maximo: 0, revento: 0, limite: LIMITE };
  const fetchFalso = async (url, op = {}) => {
    estado.conexiones++;
    estado.maximo = Math.max(estado.maximo, estado.conexiones);
    if (estado.conexiones > estado.limite) {
      estado.revento++;
      throw new TypeError("Too many subrequests by single Worker invocation.");
    }
    return responder(String(url), op);
  };
  return { estado, fetchFalso, nuevaPasada: (limite = LIMITE) => { estado.conexiones = 0; estado.limite = limite; } };
}

const SIN_RASGOS = {
  camaraAireTalon: false, camaraAireCompleta: false, suelaTransparente: false,
  suelaRedondeadaSinAire: false, suelaPlanaPlacaDura: false, muescaLateralArco: false,
  suelaNubesHuecas: false, mallaPlasticaCuadros: false, alasPlasticasCordones: false,
  jumpman: false, swooshGrandeRecto: false, piezaMetalicaOjal: false, tresFranjas: false,
  punteraGamuzaT: false, punteraGomaConcha: false,
};
const IDENTIFICACION = { visto: "zapatilla deportiva", rasgos: SIN_RASGOS, buscar: "Modelo", color: "negro", variosProductos: false, pedirNombreExacto: false };

const jpeg = () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } });
const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });

// DeepSeek de mentira: contesta según lo que se le pide (la forma del JSON
// va escrita en el prompt de sistema).
function deepseek(op) {
  const cuerpo = JSON.parse(op.body);
  const sistema = cuerpo.messages[0].content;
  let contenido;
  if (/"eleccion"/.test(sistema)) contenido = { eleccion: 0, confianza: "baja", porque: "ninguno es" };
  else if (/"pedirNombreExacto"/.test(sistema)) contenido = IDENTIFICACION;
  else contenido = { respuesta: "¡Hola! Mira lo que tengo 👟", buscar: "NADA", historial: "Mandó una foto." };
  return json({ choices: [{ message: { content: JSON.stringify(contenido) }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
}

titulo("la cuenta de conexiones, por pasada");
{
  const src = await prepararSrc();
  const P = await src.cargar("presupuesto.js");
  ok(P.quedan() === Infinity, "fuera de una pasada no se limita nada");
  const real = globalThis.fetch;
  globalThis.fetch = async () => jpeg();
  const dentro = await P.conPresupuesto({}, async () => {
    await fetch("https://a.test/1");
    await fetch("https://a.test/2");
    return P.quedan();
  });
  const otra = await P.conPresupuesto({ SUBPETICIONES_MAXIMAS: "1000" }, async () => P.quedan());
  globalThis.fetch = real;
  ok(dentro === 48, "dos conexiones gastadas → quedan 48 de 50", dentro);
  ok(otra === 1000, "con el plan de pago (SUBPETICIONES_MAXIMAS = 1000), 1000; y cada pasada empieza de cero", otra);
  src.limpiar();
}

titulo("el índice: 40 fotos de Drive, repartidas en pasadas, sin pasarse nunca");
{
  const src = await prepararSrc();
  const { default: worker } = await src.cargar("index.js");
  const D = await src.cargar("drive.js");
  D.olvidarCatalogoDeDrive();
  const RAIZ = "1RaizDelCatalogoXXXXXX", LOTE = "1CntndUnoXXXXXXXXXXXX", CALZADOS = "1CalzadosXXXXXXXXXXXX";
  const entrada = (id, nombre, carpeta) =>
    `<div class="flip-entry" id="entry-${id}"><a href="https://drive.google.com/${carpeta ? "drive/folders" : "file/d"}/${id}"><div class="flip-entry-title">${nombre}</div></a></div>`;
  const paginas = {
    [RAIZ]: `<div class="flip-entries">${entrada(LOTE, "CNTND 1 (30/6/26)", true)}</div>`,
    [LOTE]: `<div class="flip-entries">${entrada(CALZADOS, "CALZADOS", true)}</div>`,
    [CALZADOS]: `<div class="flip-entries">${Array.from({ length: 40 }, (_, i) => entrada(`1Foto${String(i).padStart(15, "0")}`, `Zapato ${i} ${30 + i}$.jpg`)).join("")}</div>`,
  };
  const cf = cloudflare((u, op) => {
    if (u.startsWith("https://api.deepseek.com/")) return deepseek(op);
    if (u.startsWith("https://drive.google.com/embeddedfolderview")) return new Response(paginas[new URL(u).searchParams.get("id")] || "", { status: 200 });
    return jpeg();
  });
  const base = baseDeMentira();
  const env = { DB: base.DB, CATALOGO: "drive", DRIVE_CARPETA: RAIZ, DEEPSEEK_API_KEY: "x" };
  const real = globalThis.fetch, log = console.log, err = console.error;
  const registro = [];
  console.log = (...a) => registro.push(a.join(" "));
  console.error = (...a) => registro.push(a.join(" "));
  const indexados = [];
  try {
    for (let pasada = 1; pasada <= 4; pasada++) {
      globalThis.fetch = cf.fetchFalso;
      cf.nuevaPasada();
      const pendientes = [];
      await worker.scheduled({}, env, { waitUntil: (p) => pendientes.push(p) });
      await Promise.all(pendientes);
      const { results } = await base.DB.prepare("SELECT COUNT(*) AS n FROM catalogo").all();
      indexados.push(results[0].n);
    }
  } finally {
    globalThis.fetch = real; console.log = log; console.error = err;
  }
  ok(cf.estado.revento === 0, "Cloudflare NUNCA dijo 'Too many subrequests'", `${cf.estado.revento} veces`);
  ok(cf.estado.maximo <= LIMITE, `ninguna pasada abrió más de ${LIMITE} conexiones`, `máximo ${cf.estado.maximo}`);
  ok(indexados[0] > 10 && indexados[0] < 40, "la primera pasada indexa las que caben, no las 40", `${indexados[0]}`);
  ok(registro.some((l) => /conexiones de esta pasada/.test(l)), "y el registro dice que sigue en la próxima");
  ok(indexados[indexados.length - 1] === 40, "en unas pocas pasadas quedan las 40", indexados.join(" → "));
  src.limpiar();
}

titulo("un cliente manda una foto con poco margen: el cotejo se recorta, la respuesta SALE");
{
  const SECRETO = "secreto-de-prueba";
  const src = await prepararSrc();
  const { default: worker } = await src.cargar("index.js");
  const I = await src.cargar("indice.js");
  const base = baseDeMentira();
  // 250 productos en el índice: el cotejo usa sus rondas del índice.
  await I.guardarIndexados(base.DB, Array.from({ length: 250 }, (_, i) => ({
    titulo: `Modelo ${i}`, imagen: `https://cdn.test/p${i}.jpg`, precio: "$50,00", url: `/p/${i}`,
    visto: `zapato ${i}`, rasgos: SIN_RASGOS, color: i % 2 ? "blanco" : "negro",
  })));
  const enviados = [];
  const cf = cloudflare((u, op) => {
    if (u.startsWith("https://api.deepseek.com/")) return deepseek(op);
    if (u.includes("graph.instagram.com") && u.includes("/messages")) {
      enviados.push(JSON.parse(op.body).message);
      return json({ message_id: `mid-${enviados.length}` });
    }
    if (u.includes("graph.instagram.com")) return json({ name: "Ana", username: "ana" });
    if (u.includes("hooks.slack.com")) return new Response("ok", { status: 200 });
    if (u.includes("/graphql.json")) return json({ data: { products: { edges: [], pageInfo: { hasNextPage: false } } } });
    return jpeg();
  });
  const env = {
    DB: base.DB, META_APP_SECRET: SECRETO, META_MODO: "todo", IG_TOKEN: "x", DEEPSEEK_API_KEY: "x",
    SHOPIFY_TIENDA: "tienda.test", SHOPIFY_TOKEN: "x", SLACK_WEBHOOK: "https://hooks.slack.com/x", URL_CATALOGO: "https://tienda.test",
    // Un margen corto a propósito: el cotejo querría más de lo que cabe.
    SUBPETICIONES_MAXIMAS: "20",
  };
  const cuerpo = JSON.stringify({
    object: "instagram",
    entry: [{ id: "999", time: Date.now(), messaging: [{ sender: { id: "123" }, recipient: { id: "999" }, timestamp: Date.now(),
      message: { mid: "m-1", attachments: [{ type: "image", payload: { url: "https://cdn.test/cliente.jpg" } }] } }] }],
  });
  const firma = "sha256=" + crypto.createHmac("sha256", SECRETO).update(cuerpo).digest("hex");
  const real = globalThis.fetch, log = console.log, err = console.error;
  const registro = [];
  console.log = (...a) => registro.push(a.join(" "));
  console.error = (...a) => registro.push(a.join(" "));
  try {
    globalThis.fetch = cf.fetchFalso;
    cf.nuevaPasada(20);
    const pendientes = [];
    await worker.fetch(new Request("https://bot.test/webhook", { method: "POST", body: cuerpo, headers: { "x-hub-signature-256": firma } }), env, { waitUntil: (p) => pendientes.push(p) });
    await Promise.all(pendientes);
  } finally {
    globalThis.fetch = real; console.log = log; console.error = err;
  }
  ok(cf.estado.revento === 0, "Cloudflare nunca reventó, ni con 20 conexiones", `${cf.estado.revento} veces · máximo ${cf.estado.maximo}`);
  ok(enviados.length > 0, "el cliente RECIBIÓ respuesta", enviados.map((m) => (m.text || "ficha").slice(0, 40)).join(" | "));
  ok(registro.some((l) => /quedan pocas conexiones|no quedan conexiones/.test(l)), "el cotejo se recortó para dejar la reserva", registro.filter((l) => /Cotejo|conexiones/.test(l)).slice(0, 2).join(" | "));
  src.limpiar();
}

terminar();
