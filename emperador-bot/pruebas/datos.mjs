// LO QUE EL EMPERADOR SABE DE SÍ MISMA: horario, envíos, delivery, empleo.
//
// Traído de Invictus el 1-oct-2026, SIN sus datos ("todo es distinto", dijo
// el dueño). Los textos salen de prompts/tienda.txt, que es de esta tienda:
//   · horario: 8:30am a 5:30pm; domingos y feriados de 8:30am a 1:30pm
//   · NO hay envíos ni delivery
//   · empleo: sin dato todavía (va al asesor)

import { prepararSrc, prompt, fuente, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const D = await src.cargar("datos.js");

titulo("los textos de El Emperador (de prompts/tienda.txt)");

ok(/8:30am a 5:30pm/.test(D.HORARIOS) && /Domingos y feriados — 8:30am a 1:30pm/.test(D.HORARIOS), "horario: 8:30 a 5:30, domingos y feriados 8:30 a 1:30");
ok(/no hacemos envíos/.test(D.ENVIOS), "envíos: NO", D.ENVIOS);
ok(/no hacemos delivery/.test(D.DELIVERY), "delivery: NO", D.DELIVERY);
ok(D.TRABAJO === "", "empleo: vacío (no se inventa)");
ok(!/ZOOM|MRW|Margarita|9:00am|7:00pm|personal completo/i.test(Object.values(D.RESPUESTAS).join(" ")), "NADA de los datos de Invictus");
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
  ["están abiertos hoy?", "horarios"],
  // Sin dato de empleo: NO salta aquí (la IA lo pasa al asesor).
  ["están contratando?", ""],
  ["busco trabajo", ""],
  ["hola", ""],
  ["tienen jordan 4?", ""],
  // Frases normales que NO son preguntas de la tienda.
  ["zapatos para el trabajo", ""],
  ["te envío la foto", ""],
  ["ya te envié el comprobante", ""],
  ["los tienen abiertos?", ""],
];
for (const [texto, tema] of casos) ok(D.queDatoPide(texto) === tema, `"${texto}" → ${tema || "(ninguno)"}`, D.queDatoPide(texto));

titulo("mezclado con un producto de Drive, NO se queda con el turno");

const DRIVE = ["Air Force One blanco · Cód. 125", "Gorra New Era negra"];
ok(D.nombraUnProducto("tienen las air force one y hacen envios?", DRIVE), '"las air force one y hacen envíos" nombra un producto de Drive');
ok(!D.nombraUnProducto("hacen envios a valencia?", DRIVE), '"hacen envíos a Valencia" no nombra ninguno');

titulo("la IA redacta, personalizado: lo bueno pasa");

for (const [tema, t] of [
  ["delivery", "A Macanao por ahora no hacemos delivery 😊 ¿Te muestro los modelos?"],
  ["envios", "A Valencia por ahora no hacemos envíos 😊 ¿Quieres ver lo que tenemos?"],
  ["envios", "No hacemos envíos por ahora, pero te espero en la tienda 😊"],
  ["horarios", "¡Sí! 🕘 Los domingos abrimos de 8:30am a 1:30pm."],
  ["horarios", "Abrimos de lunes a sábado de 8:30am a 5:30pm 😊"],
  ["horarios", "El sábado sí abrimos, de 8:30am a 5:30pm 🕘"],
  ["horarios", "Los feriados abrimos de 8:30 am a 1:30 pm"],
]) {
  ok(!D.revisarDatoDeLaTienda(t, tema).corregido, `pasa: "${t.slice(0, 60)}…"`, (D.revisarDatoDeLaTienda(t, tema).motivos || []).join("; "));
}

titulo("…y lo inventado se descarta (sale el texto fijo)");

for (const [tema, t, que] of [
  ["delivery", "¡Sí! Hacemos delivery a Macanao 🛵", "delivery que no hay"],
  ["delivery", "¡Claro! Te lo llevamos a tu casa 🛵", "delivery que no hay (otra forma)"],
  ["envios", "¡Sí! Hacemos envíos a todo el país 📦", "envíos que no hay"],
  ["envios", "Enviamos por Tealca a todo el país", "envíos que no hay, y otra empresa"],
  ["envios", "El envío a Caracas cuesta 8 dólares", "un precio"],
  ["horarios", "Abrimos de 9am a 7pm", "las horas de otra tienda"],
  ["horarios", "Los domingos abrimos de 10am a 3pm", "horas que no son"],
  ["delivery", "¡Sí! El delivery es gratis 🛵", "gratis que no existe"],
  ["delivery", "", "respuesta vacía"],
]) {
  const r = D.revisarDatoDeLaTienda(t, tema);
  ok(r.corregido && r.respuesta === D.RESPUESTAS[tema], `atrapa ${que}: "${t.slice(0, 50)}"`, (r.motivos || []).join("; "));
}

titulo("el prompt sabe lo que hay y lo que NO hay");

const datos = D.datosParaElPrompt();
ok(/8:30am a 5:30pm/.test(datos) && /no hacemos envíos/.test(datos) && /no hacemos delivery/.test(datos), "el horario y el 'no' de envíos y delivery");
ok(/NO los sabes/.test(datos) && /Empleo/.test(datos), "y que el empleo NO lo sabe (asesor)");

const texto = prompt("texto.txt");
ok(/\{\{DATOS_TIENDA\}\}/.test(texto), "texto.txt los recibe por {{DATOS_TIENDA}}");
ok(!/9:00am a 7:00pm|10:00am a 3:00pm|9am a 7pm|ZOOM y MRW|Margarita/.test(texto), "texto.txt no tiene horarios ni envíos de otra tienda");
ok(!/NO puedes: envíos/.test(texto), "envíos ya no está en la lista de lo que no puede contestar");

titulo("funciona con los datos de cualquier tienda (todo sale del archivo)");
{
  const otra = await prepararSrc({
    txt: {
      "prompts/tienda.txt":
        "[HORARIOS]\nLunes a viernes — 9:00am a 7:00pm\n\n[ENVIOS]\n📦 Sí, por ZOOM y MRW\n\n[DELIVERY]\nSí, en toda la ciudad; en algunas zonas es GRATIS\n\n[TRABAJO]\nEl personal está completo.",
    },
  });
  const O = await otra.cargar("datos.js");
  ok(!O.revisarDatoDeLaTienda("¡Sí! Hacemos envíos por ZOOM 📦", "envios").corregido, "si la tienda SÍ envía, decir que sí pasa");
  ok(O.revisarDatoDeLaTienda("Enviamos por Tealca", "envios").corregido, "pero no con otra empresa");
  ok(O.revisarDatoDeLaTienda("¡Sí, estamos contratando!", "trabajo").corregido, "personal completo → no puede decir que contratan");
  ok(O.revisarDatoDeLaTienda("El delivery es gratis", "delivery").corregido, "gratis sin el 'en algunas zonas' → no");
  ok(O.queDatoPide("están contratando?") === "trabajo", "con dato de empleo, sí salta");
  otra.limpiar();
}

titulo("métodos de pago: la lista entera; datos: al asesor");

const P = await src.cargar("pagos.js");
for (const t of ["qué métodos de pago tienen?", "formas de pago", "cómo puedo pagar?", "aceptan zelle?", "con qué puedo pagar"]) {
  ok(P.preguntaPorMetodos(t) && !P.pideDatosDePago(t), `"${t}" → pregunta por los métodos`);
}
for (const t of ["pásame los datos", "mándame el número de cuenta", "a dónde transfiero?", "dame los datos para pagar"]) {
  ok(P.pideDatosDePago(t), `"${t}" → pide los DATOS: avisa al asesor`);
}
const indice = fuente("index.js");
ok(/PIDE LOS DATOS PARA PAGAR/.test(indice), "se avisa cuando pide los datos");

src.limpiar();
terminar();
