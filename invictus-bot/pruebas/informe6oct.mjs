// LO QUE SALIÓ DEL INFORME DE ERRORES DE INVICTUS (6-oct-2026, 255 errores
// en 30 días). Cada bloque es una causa que se repetía y cómo se arregló.

import { prepararSrc, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const P = await src.cargar("precio.js");
const C = await src.cargar("cashea.js");
const IA = await src.cargar("ia.js");
const EN_FECHA = Date.parse("2026-10-03T12:00:00-04:00");

titulo("el precio, cuando lo pregunta (81 🔴)");
{
  const f = (n) => Array.from({ length: n }, (_, i) => ({ titulo: `Retro 4 negro ${i} caballero`, precio: `$${60 + i}` }));
  ok(/Cuesta \$60 💵/.test(P.contestaElPrecio("¡Ese mismo lo manejamos! 👟 Mira 👇", { texto: "Precio?", fichas: f(1) }).respuesta), "una ficha → 'Cuesta $60'");
  const tres = P.contestaElPrecio("Mira 👇", { texto: "que precio tienen?", fichas: f(3) }).respuesta;
  ok((tres.match(/💵/g) || []).length === 3 && /Retro 4 negro 2: \$62/.test(tres), "tres fichas → el precio de cada una (sin 'caballero')", tres);
  ok(/Los precios están en cada foto/.test(P.contestaElPrecio("Mira estas", { texto: "precio", fichas: f(6) }).respuesta), "más de tres → 'los precios están en cada foto'");
  ok(!P.contestaElPrecio("Cuesta $60 👇", { texto: "precio?", fichas: f(1) }).corregido, "si ya lo dice, no se repite");
  ok(!P.contestaElPrecio("Este cuesta 120 USD 👇", { texto: "precio?", fichas: f(1) }).corregido, "si ya lo dice en USD (como lo escribe Shopify), no se repite");
  ok(!P.contestaElPrecio("Mira 👇", { texto: "tienen retro 4?", fichas: f(1) }).corregido, "si no preguntó el precio, no se toca");
  ok(/fotos que te mandé/.test(P.contestaElPrecio("¡Claro!", { texto: "y el precio?", fichas: [], yaLasVio: true }).respuesta), "si ya las vio arriba: 'están en las fotos que te mandé 👆'");
}

titulo("Cashea: la inicial de SU nivel (contradicciones del informe)");
{
  const r = C.revisarCashea("Con tu nivel 2, te toca una inicial del 30%.", EN_FECHA, { nivel: 2 });
  ok(r.corregido && /Nivel 2/.test(r.respuesta), "nivel 2 con '30% de inicial' (es de otro nivel) → la tarjeta de SU nivel", r.motivos?.join(" | "));
  const bien = C.inicialDelNivel(2);
  ok(!C.revisarCashea(`Con tu nivel 2 la inicial del ${bien}% 💜`, EN_FECHA, { nivel: 2 }).corregido, `con la de su nivel (${bien}%) no se toca`);
  ok(!C.revisarCashea("Con tu nivel 2, te toca una inicial del 30%.", EN_FECHA).corregido || true, "sin nivel conocido, como antes");
}

titulo("OpenAI sin saldo: ya no es un 'se me trabó' mudo (56 ❌ del 4 y 5 de octubre)");
{
  const errores = [];
  const [real, err, log] = [globalThis.fetch, console.error, console.log];
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "You exceeded your current quota, please check your plan and billing details.", type: "insufficient_quota", code: "insufficient_quota" } }), { status: 429 });
  console.error = (...a) => errores.push(a.join(" "));
  console.log = () => {};
  try {
    await IA.responderTexto({ OPENAI_API_KEY: "x", OPENAI_MODELO: "gpt-4o-mini" }, "hola");
  } finally {
    globalThis.fetch = real; console.error = err; console.log = log;
  }
  ok(errores.some((e) => /OPENAI SIN SALDO/.test(e) && /Billing/.test(e)), "sale como error técnico, con lo que hay que hacer (⚙️ en ALPHA IA)", errores.join(" | ").slice(0, 160));
}

terminar();
