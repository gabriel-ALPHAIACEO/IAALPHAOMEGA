// LOS MÉTODOS DE PAGO Y LA TASA: que se contesten, y que los DATOS no salgan.
//
// QUÉ SE PROTEGE. Dos cosas que cuestan dinero de verdad:
//
//   · Que el bot conteste los métodos cuando se los piden, en vez de mandar
//     la pregunta a un asesor como hacía antes.
//   · Que NUNCA prometa mandar los datos de la cuenta, ni los pida, ni se
//     invente un número o una cifra de tasa. Un dato de pago inventado manda
//     a un cliente a transferirle dinero a nadie.
//
// Y una tercera, la más fácil de romper sin darse cuenta: que el guardián NO
// se meta donde no lo llaman. Ver corpus.mjs, que le pasa las respuestas
// reales del bot.
//
// ESTA PRUEBA NO SABE DE QUÉ TIENDA ES. Lee los métodos y la tasa del
// pagos.txt que tenga al lado, así que la misma sirve para Invictus, El
// Emperador y el que venga. Si estuvieran escritos a mano, cada tienda
// necesitaría su copia — que es justo el problema de las tres copias de src/
// que estamos tratando de no repetir.
//
// Y cubre los DOS estados: con los datos cargados y sin ellos. El segundo no
// es un caso raro, es como nace cada tienda nueva.

import { prepararSrc, ok, titulo, terminar, prompt } from "./ayuda.mjs";

// La versión vacía del archivo: se le quitan los datos y se dejan los
// comentarios y las secciones.
const PAGOS_VACIO = prompt("pagos.txt").replace(/^(?!#|\[|\s*$).*$/gm, "");

const cargado = await prepararSrc();
const vacio = await prepararSrc({ txt: { "prompts/pagos.txt": PAGOS_VACIO } });

const P = await cargado.cargar("pagos.js");
const V = await vacio.cargar("pagos.js");

const METODOS = P.metodosDePago();
const HAY_METODOS = METODOS.length > 0;
const HAY_TASA = P.hayTasa();

// ───────────────────────────────────────────────────────────────────────
titulo(`los métodos de esta tienda (${METODOS.length} cargados)`);

ok(P.hayMetodosDePago() === HAY_METODOS, "hayMetodosDePago() coincide con el archivo");
ok(!METODOS.some((m) => m.endsWith(":")), "ningún título de grupo se colvió método");
ok(!METODOS.some((m) => m.startsWith("#")), "ningún comentario se colvió método");

if (HAY_METODOS) {
  console.log(`        ${METODOS.join(" · ")}`);

  const bloque = P.bloqueDeMetodos();
  ok((bloque.match(/^• /gm) || []).length === METODOS.length, "una viñeta por método");
  ok(!/^• .*:$/m.test(bloque), "los títulos de grupo NO llevan viñeta");
  for (const m of METODOS) ok(bloque.includes(m), `el bloque nombra ${m}`);

  // Si el archivo usa grupos, cada método tiene que quedar bajo el suyo.
  const titulos = bloque.split("\n").filter((l) => l.endsWith(":"));
  if (titulos.length > 1) {
    ok(bloque.indexOf(titulos[1]) > bloque.indexOf(titulos[0]), "los grupos salen en orden");
    const primeroDelSegundo = bloque.split(titulos[1])[1].split("\n")[1];
    ok(Boolean(primeroDelSegundo), "el segundo grupo tiene métodos debajo", primeroDelSegundo || "");
  }

  titulo("la respuesta que le sale al cliente");
  const respuesta = P.listaDeMetodos();
  for (const m of METODOS) ok(respuesta.includes(m), `la nombra: ${m}`);
  ok(/¿Cuál te sirve mejor/.test(respuesta), "cierra preguntando cuál le sirve");
  ok(!/\d{8,}/.test(respuesta), "no lleva ningún número de cuenta");
  ok(!P.revisarPagos(respuesta).corregido, "y su propia respuesta pasa el guardián");
} else {
  titulo("sin métodos cargados: la pregunta va al asesor");
  ok(P.bloqueDeMetodos() === "", "no arma bloque");
  ok(P.listaDeMetodos() === "", "no arma respuesta");
}

ok(
  !/escr[ií]beme|m[aá]ndame|enviarte los datos|te env[ií]o los datos|te paso los datos/i.test(
    P.listaDeMetodos()
  ),
  "la respuesta NUNCA ofrece mandar los datos"
);

// ───────────────────────────────────────────────────────────────────────
titulo("LA TASA: cuál se usa sí, cuánto vale hoy no");

if (HAY_TASA) {
  ok(!/\d/.test(P.tasaDePago()), "la tasa se nombra sin ninguna cifra", P.tasaDePago());
  const frase = P.fraseDeLaTasa();
  ok(frase.includes(P.tasaDePago()), "la frase nombra esa misma tasa");
  ok(/asesor/i.test(frase), "y dice que el asesor da la del día");
  ok(!/\d/.test(frase), "sin cifra");
  ok(!P.revisarPagos(frase).corregido, "su propia frase pasa el guardián");
} else {
  ok(P.fraseDeLaTasa() === "", "sin tasa cargada no arma frase");
  ok(/asesor/i.test(P.revisarPagos("La tasa está en 45").respuesta), "y la pregunta va al asesor");
}

// ───────────────────────────────────────────────────────────────────────
// A PARTIR DE ACÁ, LO QUE VALE PARA CUALQUIER TIENDA, con datos o sin ellos:
// lo que el bot NO puede decir nunca.

// Lo que tiene que salir en lugar de lo malo, según lo que tenga la tienda.
const esperado = (deTasa) => {
  if (deTasa) return HAY_TASA ? P.tasaDePago() : "asesor";
  return HAY_METODOS ? METODOS[0] : "asesor";
};
const cambiaBien = (r, deTasa = false) => r.respuesta.includes(esperado(deTasa));

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
  ok(cambiaBien(r), "   → lo cambia por algo que sí es verdad");
}

titulo("pedirle datos al cliente: atrapado");

for (const malo of [
  "Mándame los datos de la transferencia",
  "Envíame el comprobante del pago",
  "Pásame la referencia del pago móvil",
  "Sube el comprobante para procesar tu pago",
]) ok(P.revisarPagos(malo).corregido, `atrapa: ${malo}`);

titulo("inventarse una cuenta: atrapado");

for (const malo of [
  "Puedes pagar por transferencia a la cuenta 01021234567890123456",
  "Pago móvil al 04121234567, cédula 12345678",
]) {
  const r = P.revisarPagos(malo);
  ok(r.corregido, `atrapa: ${malo.slice(0, 42)}`);
  ok(!/\d{8,}/.test(r.respuesta), "   → y el número no sale");
}

titulo("inventarse la tasa o cambiarla por otra: atrapado");

for (const malo of [
  "La tasa está en 45,50 hoy",
  "Recibimos a la tasa de 50 bolívares por dólar",
  "Serían 1.800 Bs al cambio",
  "La tasa de hoy es 46",
  "Te puedo recibir a tasa paralela si quieres",
  "Trabajamos con la tasa de Binance",
  "Usamos la tasa del monitor dólar",
  "Te recibo a tasa libre",
]) {
  const r = P.revisarPagos(malo);
  ok(r.corregido, `atrapa: ${malo.slice(0, 44)}`);
  ok(cambiaBien(r, true), "   → lo cambia por la tasa de la tienda, o por el asesor");
  ok(!/\d/.test(r.respuesta) || !HAY_TASA, "   → sin cifra");
}

titulo("lo que TIENE que pasar tal cual");

for (const [nombre, texto] of [
  ["contestar por un método concreto", "¡Sí! Aceptamos pago móvil, y también transferencia 😊"],
  ["decir que uno no está", "Con tarjeta de crédito no por ahora, pero puedes pagar con pago móvil 😊"],
  ["pasar al asesor por los datos", "Eso te lo confirma un asesor en un momento 😊"],
  ["el precio no es una cuenta", "Esas están en $45,00 y puedes pagar con transferencia 👟"],
  ["'te paso con un asesor'", "Te paso con un asesor para lo del pago en un momento 😊"],
  ["pedir una FOTO sigue permitido", "¿Me mandas una foto del modelo que viste? 😊"],
  ["y una captura de la historia", "Pásame la captura de la historia y te digo cuál es 😊"],
  ["hablar de envíos no es pagar", "Te paso los datos del envío"],
  ["el saludo", "¡Hola! Soy la asistente virtual 👋"],
  ["los horarios", "Abrimos de lunes a sábado de 9am a 7pm 🕘"],
]) {
  const r = P.revisarPagos(texto);
  ok(!r.corregido, nombre, r.corregido ? `SE CORRIGIÓ MAL: ${r.motivos?.join("; ")}` : "");
}

titulo("una tienda recién montada se comporta como antes de que esto existiera");

ok(!V.hayMetodosDePago(), "no hay métodos");
ok(V.bloqueDeMetodos() === "" && V.listaDeMetodos() === "", "no arma bloque ni respuesta");
ok(!V.hayTasa() && V.fraseDeLaTasa() === "", "no hay tasa ni frase");
const sinNada = V.revisarPagos("Ya te paso los datos para el pago 😊");
ok(sinNada.corregido, "igual atrapa la promesa de datos");
ok(/asesor/i.test(sinNada.respuesta), "y pasa a un asesor, como hacía el bot antes");
ok(
  !/pago m[oó]vil|zelle|transferenc|paypal|binance|bcv/i.test(sinNada.respuesta),
  "sin inventar ni un método ni una tasa"
);

cargado.limpiar();
vacio.limpiar();
terminar();
