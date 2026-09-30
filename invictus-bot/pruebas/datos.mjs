// LO QUE LA TIENDA SABE DE SÍ MISMA: horarios, envíos, delivery, empleo.
//
// Se hizo el 25-sep-2026 en otra rama, se perdió, y el 30-sep el dueño lo
// echó en falta. Esto protege que no se vuelva a perder sin que nadie se
// entere, y que salte SOLO cuando la pregunta va sola.

import { prepararSrc, prompt, fuente, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const D = await src.cargar("datos.js");

titulo("los textos de la tienda");

ok(/ZOOM y MRW/.test(D.ENVIOS) && /territorio nacional/.test(D.ENVIOS), "envíos: nacionales, por ZOOM y MRW");
ok(/isla de Margarita/.test(D.DELIVERY) && /GRATIS/.test(D.DELIVERY), "delivery: toda la isla, gratis en algunas zonas");
ok(/personal completo/.test(D.TRABAJO) && /historias/.test(D.TRABAJO), "empleo: personal completo, se publica en historias");
ok(/Lunes a viernes — 9:00am a 7:00pm/.test(D.HORARIOS) && /Domingos — 9:00am a 5:00pm/.test(D.HORARIOS), "horario");
for (const [k, t] of Object.entries(D.RESPUESTAS)) ok(t.length < 1000, `${k} cabe en un mensaje de Instagram`);

titulo("qué pregunta cada uno");

const casos = [
  ["hacen envios?", "envios"],
  ["envían a Caracas?", "envios"],
  ["trabajan con zoom?", "envios"],
  ["tienen delivery?", "delivery"],
  ["me lo llevan a mi casa?", "delivery"],
  ["a qué hora abren?", "horarios"],
  ["hasta qué hora están abiertos", "horarios"],
  ["están contratando?", "trabajo"],
  ["busco trabajo", "trabajo"],
  ["tienen vacantes", "trabajo"],
  ["hola", ""],
  ["tienen jordan 4?", ""],
];
for (const [texto, tema] of casos) ok(D.queDatoPide(texto) === tema, `"${texto}" → ${tema || "(ninguno)"}`, D.queDatoPide(texto));

titulo("mezclado con un calzado, NO se queda con el turno");

ok(D.nombraUnProducto("tienen las air force one y hacen envios?"), '"las air force one y hacen envíos" nombra un calzado');
ok(!D.nombraUnProducto("hacen envios a valencia?"), '"hacen envíos a Valencia" no nombra ninguno');

titulo("métodos de pago: la lista entera; datos: al asesor");

const P = await src.cargar("pagos.js");
for (const t of ["qué métodos de pago tienen?", "formas de pago", "cómo puedo pagar?", "aceptan zelle?",
                 "reciben pago móvil?", "con qué puedo pagar"]) {
  ok(P.preguntaPorMetodos(t) && !P.pideDatosDePago(t), `"${t}" → la lista completa, sin avisar`);
}
for (const t of ["pásame los datos", "mándame el número de cuenta", "a dónde transfiero?",
                 "cuál es el correo de zelle", "dame los datos para pagar", "datos de pago móvil"]) {
  ok(P.pideDatosDePago(t), `"${t}" → pide los DATOS: avisa al asesor`);
}
for (const t of ["hola", "tienen jordan 4?", "hacen envios?", "cuanto cuesta"]) {
  ok(!P.preguntaPorMetodos(t) && !P.pideDatosDePago(t), `"${t}" → nada de pagos`);
}
const lista = P.listaDeMetodos();
ok(P.metodosDePago().every((m) => lista.includes(m)), "la lista lleva TODOS los métodos de pagos.txt", `${P.metodosDePago().length}`);
ok(!/te (paso|env[ií]o|mando) (los )?datos/i.test(lista), "y no promete mandar los datos");

const indice = fuente("index.js");
ok(!/PREGUNTÓ CÓMO PAGAR/.test(indice), 'ya no se avisa al asesor solo por preguntar los métodos');
ok(/PIDE LOS DATOS PARA PAGAR/.test(indice), "sí se avisa cuando pide los datos");

titulo("el prompt los conoce, para las preguntas mezcladas");

const texto = prompt("texto.txt");
ok(/DATOS DE LA TIENDA/.test(texto) && /ZOOM y MRW/.test(texto) && /isla de Margarita/.test(texto), "texto.txt tiene los datos");
ok(!/lunes a sábado de 9/.test(texto), "y ya no el horario viejo (lunes a sábado)");
ok(!/NO puedes: envíos/.test(texto), "envíos ya no está en la lista de lo que no puede contestar");

src.limpiar();
terminar();
