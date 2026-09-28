// LOS MÉTODOS DE PAGO Y LA TASA: que se contesten, y que los DATOS no salgan.
//
// QUÉ SE PROTEGE ACÁ. Dos cosas que cuestan dinero de verdad:
//
//   · Que el bot conteste los nueve métodos cuando se los piden, en vez de
//     mandar la pregunta a un asesor como hacía antes.
//   · Que NUNCA prometa mandar los datos de la cuenta, ni los pida, ni se
//     invente un número o una cifra de tasa. Un dato de pago inventado
//     manda a un cliente a transferirle dinero a nadie.
//
// Y una tercera, la más fácil de romper sin darse cuenta: que el guardián
// NO se meta donde no lo llaman. Ver regresion-corpus.mjs, que le pasa las
// respuestas reales del bot.

import { prepararSrc, ok, titulo, terminar, prompt } from "./ayuda.mjs";

const LOS_NUEVE = [
  "Pago Móvil",
  "Transferencia bancaria",
  "Punto de venta",
  "Zelle",
  "PayPal",
  "Zinli",
  "Binance (USDT)",
  "Mercantil Panamá",
  "Banesco Panamá",
];

// La versión vacía del archivo: se le quitan los métodos y la tasa y se
// dejan los comentarios. Es el estado de una tienda recién montada.
const PAGOS_VACIO = prompt("pagos.txt").replace(/^(?!#|\[|\s*$).*$/gm, "");

const lleno = await prepararSrc();
const vacio = await prepararSrc({ txt: { "prompts/pagos.txt": PAGOS_VACIO } });

const P = await lleno.cargar("pagos.js");
const V = await vacio.cargar("pagos.js");

// ───────────────────────────────────────────────────────────────────────
titulo("los nueve métodos de la tienda");

ok(P.metodosDePago().length === 9, "son nueve, sin títulos ni comentarios", String(P.metodosDePago().length));
for (const m of LOS_NUEVE) ok(P.metodosDePago().includes(m), `está ${m}`);
ok(!P.metodosDePago().some((m) => m.endsWith(":")), "ningún título de grupo se colvió método");
ok(P.hayMetodosDePago(), "hayMetodosDePago() dice que sí");

// ───────────────────────────────────────────────────────────────────────
titulo("los dos grupos, en su orden");

const bloque = P.bloqueDeMetodos();
ok(/En bolívares:/.test(bloque) && /Internacional:/.test(bloque), "salen los dos títulos");
ok(bloque.indexOf("Pago Móvil") > bloque.indexOf("En bolívares:"), "Pago Móvil va bajo bolívares");
ok(bloque.indexOf("Punto de venta") < bloque.indexOf("Internacional:"), "y no se pasa al otro grupo");
ok(bloque.indexOf("Zelle") > bloque.indexOf("Internacional:"), "Zelle va bajo internacional");
ok((bloque.match(/^• /gm) || []).length === 9, "nueve viñetas, una por método");
ok(!/^• .*:$/m.test(bloque), "los títulos NO llevan viñeta");

// ───────────────────────────────────────────────────────────────────────
titulo("la respuesta que le sale al cliente");

const respuesta = P.listaDeMetodos();
for (const m of LOS_NUEVE) ok(respuesta.includes(m), `la nombra: ${m}`);
ok(
  !/escr[ií]beme|m[aá]ndame|enviarte los datos|te env[ií]o los datos|te paso los datos/i.test(respuesta),
  "NO dice 'escríbeme para enviarte los datos' — es lo que se pidió quitar"
);
ok(/¿Cuál te sirve mejor/.test(respuesta), "cierra preguntando cuál le sirve");
ok(!/\d{8,}/.test(respuesta), "no lleva ningún número de cuenta");
ok(!P.revisarPagos(respuesta).corregido, "y su propia respuesta pasa el guardián");

// ───────────────────────────────────────────────────────────────────────
titulo("LA TASA: cuál se usa sí, cuánto vale hoy no");

ok(P.hayTasa(), "hay tasa cargada");
ok(/BCV/.test(P.tasaDePago()), "y es la del BCV", P.tasaDePago());
ok(!/\d/.test(P.tasaDePago()), "sin ninguna cifra dentro");
const frase = P.fraseDeLaTasa();
ok(/BCV/.test(frase) && /asesor/i.test(frase), "la frase dice cuál es y que el asesor da la del día");
ok(!/\d/.test(frase), "y no lleva cifra");
ok(!P.revisarPagos(frase).corregido, "su propia frase pasa el guardián");

// ───────────────────────────────────────────────────────────────────────
titulo("prometer los datos: atrapado");

for (const malo of [
  "¡Claro! Ya te paso los datos de pago 😊",
  "Te mando el número de cuenta por aquí",
  "Perfecto, te envío los datos para la transferencia",
  "Te comparto la cuenta para el pago móvil",
  "Ya te doy los datos de Zelle",
  "Te escribo los datos del pago enseguida",
]) {
  const r = P.revisarPagos(malo);
  ok(r.corregido, `atrapa: ${malo.slice(0, 44)}`);
  ok(r.respuesta.includes("Pago Móvil") && r.respuesta.includes("Zelle"), "   → lo cambia por la lista");
}

// ───────────────────────────────────────────────────────────────────────
titulo("pedirle datos al cliente: atrapado");

for (const malo of [
  "Mándame los datos de la transferencia",
  "Envíame el comprobante del pago",
  "Pásame la referencia del pago móvil",
  "Sube el comprobante para procesar tu pago",
]) ok(P.revisarPagos(malo).corregido, `atrapa: ${malo}`);

// ───────────────────────────────────────────────────────────────────────
titulo("inventarse una cuenta: atrapado");

for (const malo of [
  "Puedes pagar por transferencia a la cuenta 01021234567890123456",
  "Pago móvil al 04121234567, cédula 12345678",
]) {
  const r = P.revisarPagos(malo);
  ok(r.corregido, `atrapa: ${malo.slice(0, 42)}`);
  ok(!/\d{8,}/.test(r.respuesta), "   → y el número no sale");
}

// ───────────────────────────────────────────────────────────────────────
titulo("inventarse la tasa: atrapado");

for (const malo of [
  "La tasa está en 45,50 hoy",
  "Recibimos a la tasa de 50 bolívares por dólar",
  "Serían 1.800 Bs al cambio",
  "La tasa de hoy es 46",
]) {
  const r = P.revisarPagos(malo);
  ok(r.corregido, `atrapa: ${malo}`);
  ok(/BCV/.test(r.respuesta) && !/\d/.test(r.respuesta), "   → lo cambia por la del BCV, sin cifra");
}

titulo("ofrecer una tasa que no es la de la tienda: atrapado");

for (const malo of [
  "Te puedo recibir a tasa paralela si quieres",
  "Trabajamos con la tasa de Binance",
  "Usamos la tasa del monitor dólar",
  "Te recibo a tasa libre",
]) ok(P.revisarPagos(malo).corregido, `atrapa: ${malo}`);

// ───────────────────────────────────────────────────────────────────────
titulo("que Binance sea un MÉTODO no rompe la regla de la TASA");

ok(!P.revisarPagos("Puedes pagar con Binance (USDT) o Zelle 😊").corregido, "pagar con Binance, permitido");
ok(
  !P.revisarPagos("Recibimos a la tasa del BCV. También puedes pagar con Binance (USDT) 😊").corregido,
  "BCV y Binance en la misma frase, permitido"
);
ok(P.revisarPagos("Te recibo a la tasa de Binance").corregido, "pero la TASA de Binance sigue atrapada");

// ───────────────────────────────────────────────────────────────────────
titulo("lo que TIENE que pasar tal cual");

for (const [nombre, texto] of [
  ["contestar por un método concreto", "¡Sí! Aceptamos pago móvil, y también transferencia, Zelle y PayPal 😊"],
  ["decir que uno no está", "Con tarjeta de crédito no por ahora, pero puedes pagar con pago móvil o Zelle 😊"],
  ["pasar al asesor por los datos", "Eso te lo confirma un asesor en un momento 😊"],
  ["el precio no es una cuenta", "Esas están en $45,00 y puedes pagar con transferencia 👟"],
  ["'te paso con un asesor'", "Te paso con un asesor para lo del pago en un momento 😊"],
  ["pedir una FOTO sigue permitido", "¿Me mandas una foto del modelo que viste? 😊"],
  ["y una captura de la historia", "Pásame la captura de la historia y te digo cuál es 😊"],
  ["hablar de envíos no es pagar", "Te paso los datos del envío"],
  ["el saludo", "¡Hola! Soy la asistente virtual de Invictus Shoes 👋"],
  ["los horarios", "Abrimos de lunes a sábado de 9am a 7pm 🕘"],
]) {
  const r = P.revisarPagos(texto);
  ok(!r.corregido, nombre, r.corregido ? `SE CORRIGIÓ MAL: ${r.motivos?.join("; ")}` : "");
}

// ───────────────────────────────────────────────────────────────────────
titulo("sin nada cargado: se comporta como antes de existir esto");

ok(!V.hayMetodosDePago(), "no hay métodos");
ok(V.bloqueDeMetodos() === "", "no arma bloque");
ok(V.listaDeMetodos() === "", "no arma respuesta");
ok(!V.hayTasa() && V.fraseDeLaTasa() === "", "no hay tasa ni frase");
const sinNada = V.revisarPagos("Ya te paso los datos para el pago 😊");
ok(sinNada.corregido, "igual atrapa la promesa de datos");
ok(/asesor/i.test(sinNada.respuesta), "y pasa a un asesor, como hacía el bot antes");
ok(
  !/pago m[oó]vil|zelle|transferenc|paypal|binance|bcv/i.test(sinNada.respuesta),
  "sin inventar ni un método ni una tasa"
);

lleno.limpiar();
vacio.limpiar();
terminar();
