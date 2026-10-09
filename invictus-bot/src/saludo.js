// El saludo de quien ya escribió antes.
//
// Cuando alguien que ya habló contigo vuelve y escribe solo "hola", no hay
// nada que buscar ni nada que razonar: el mensaje no lleva información. Se
// le devuelve el saludo aquí mismo, sin pasar por el modelo. Tres ventajas:
//
//   · Suena como una persona que te reconoce, no como un robot que arranca
//     de cero ni como uno que contesta seco porque le prohibimos saludar.
//   · Nunca se presenta dos veces, porque el modelo ni llega a opinar.
//   · No gasta una llamada a OpenAI en un "hola".
//
// La primera vez que alguien escribe NO pasa por aquí: esa bienvenida la
// escribe el modelo siguiendo el prompt, que es donde vive el tono de la
// tienda.

// Las que de verdad son un saludo. Con que aparezca una de estas, el mensaje
// cuenta como saludo.
const NUCLEO = new Set([
  "hola", "ola", "holis", "holap", "hla", "alo", "halo",
  "buenas", "buenos", "buen", "wenas", "wena",
  "hey", "ey", "epa", "hi", "hello", "helo", "saludos", "klk",
]);

// Palabras que suelen acompañar al saludo y no cambian lo que pide el
// cliente: "hola buenas tardes", "hola, cómo estás?", "hey qué tal".
const ACOMPANAN = new Set([
  "dia", "dias", "tarde", "tardes", "noche", "noches", "bueno", "buena",
  "que", "tal", "como", "estas", "esta", "estan", "andas", "va",
  "todo", "bien", "ahi", "por", "alli", "aqui",
  // "hola de nuevo", "hola otra vez": el cliente ya sabe que volvió.
  "nuevo", "nueva", "otra", "otro", "vez", "volvi", "regrese",
  "amigo", "amiga", "pana", "hermano", "hermana", "disculpa", "disculpe",
  "senor", "senora", "senorita", "chico", "chica", "gente",
  "y", "el", "la", "un", "una", "de", "mi", "me", "te", "se", "a",
]);

// Más de esto y ya no es un saludo suelto, aunque todas las palabras lo
// parezcan: es alguien contando algo.
const MAXIMO_DE_PALABRAS = 6;

// Se turnan para que no conteste siempre igual a quien escribe a diario.
// Cambia estas frases y cambias el tono del bot: son las únicas respuestas
// de todo el sistema que no pasan por el modelo.
const CON_NOMBRE = [
  "¡Hola, {n}! ¿En qué te puedo ayudar hoy? 😊",
  "¡Hola otra vez, {n}! ¿Qué estás buscando?",
  "¡{n}! Qué bueno leerte de nuevo 😊 ¿En qué te ayudo?",
  "¡Hola de nuevo, {n}! ¿Seguimos donde quedamos o buscas algo nuevo?",
  "¡Qué gusto leerte, {n}! ¿En qué te puedo ayudar hoy? 😊",
  "¡Hola, {n}! Por aquí andamos 😊 ¿Qué necesitas?",
];

const SIN_NOMBRE = [
  "¡Hola otra vez! ¿En qué te puedo ayudar? 😊",
  "¡Hola de nuevo! ¿Qué estás buscando?",
  "¡Aquí estamos! 😊 ¿En qué te puedo ayudar?",
  "¡Hola! ¿En qué te puedo ayudar hoy? 😊",
  "¡Hola otra vez! ¿Seguimos donde quedamos o buscas algo nuevo?",
];

// A quien saluda con la hora del día se le devuelve la cortesía con la
// misma hora. Contestar "¡Hola otra vez!" a un "buenas noches" no está mal,
// pero suena a que no lo leíste.
//
// LA HORA SE COPIA DEL CLIENTE, NO SE CALCULA. El Worker corre en UTC y no
// sabe en qué país está quien escribe: si lo adivináramos, acabaríamos
// dando los buenos días a alguien a medianoche.
const POR_MOMENTO = {
  dias: {
    conNombre: [
      "¡Buenos días, {n}! ¿En qué te puedo ayudar hoy? 😊",
      "¡Buenos días, {n}! ¿Qué estás buscando?",
      "¡Muy buenos días, {n}! Por aquí andamos 😊 ¿Qué necesitas?",
    ],
    sinNombre: [
      "¡Buenos días! ¿En qué te puedo ayudar hoy? 😊",
      "¡Muy buenos días! ¿Qué estás buscando?",
      "¡Buenos días! Aquí estamos 😊 ¿En qué te ayudo?",
    ],
  },
  tardes: {
    conNombre: [
      "¡Buenas tardes, {n}! ¿En qué te puedo ayudar? 😊",
      "¡Buenas tardes, {n}! ¿Qué estás buscando?",
      "¡Muy buenas tardes, {n}! Por aquí andamos 😊 ¿Qué necesitas?",
    ],
    sinNombre: [
      "¡Buenas tardes! ¿En qué te puedo ayudar? 😊",
      "¡Muy buenas tardes! ¿Qué estás buscando?",
      "¡Buenas tardes! Aquí estamos 😊 ¿En qué te ayudo?",
    ],
  },
  noches: {
    conNombre: [
      "¡Buenas noches, {n}! ¿En qué te puedo ayudar? 😊",
      "¡Buenas noches, {n}! ¿Qué estás buscando?",
      "¡Muy buenas noches, {n}! Aquí seguimos 😊 ¿Qué necesitas?",
    ],
    sinNombre: [
      "¡Buenas noches! ¿En qué te puedo ayudar? 😊",
      "¡Muy buenas noches! ¿Qué estás buscando?",
      "¡Buenas noches! Aquí seguimos 😊 ¿En qué te ayudo?",
    ],
  },
  // "Buenas" a secas, sin decir de qué: se le devuelve igual de suelto.
  buenas: {
    conNombre: [
      "¡Buenas, {n}! ¿En qué te puedo ayudar? 😊",
      "¡Buenas, {n}! ¿Qué estás buscando?",
    ],
    sinNombre: [
      "¡Buenas! ¿En qué te puedo ayudar? 😊",
      "¡Buenas! ¿Qué estás buscando?",
    ],
  },
};

// ¿El mensaje es solo un saludo, sin pregunta dentro?
//
// "hola" sí. "hola buenas tardes" sí. "hola, tienen el iphone 15?" no —
// ese lleva una pregunta y tiene que ir al modelo como cualquier otro.
export function esSoloSaludo(texto) {
  const palabras = despejar(texto);
  if (!palabras.length || palabras.length > MAXIMO_DE_PALABRAS) return false;

  // Todas las palabras tienen que ser de saludo o de las que lo acompañan…
  const todasEncajan = palabras.every((p) => NUCLEO.has(p) || ACOMPANAN.has(p));
  // …y al menos una tiene que ser un saludo de verdad, para que un "que" o
  // un "todo bien" suelto no se cuenten como saludo.
  const hayUnSaludo = palabras.some((p) => NUCLEO.has(p));

  return todasEncajan && hayUnSaludo;
}

// Devuelve el saludo, con el nombre si lo tenemos y con la hora del día si
// el cliente la dijo. El nombre llega ya limpio desde index.js: si era un
// usuario de Instagram o ya se gastó el cupo de tres, viene vacío.
export function saludoDeVuelta(nombre, texto = "") {
  const momento = POR_MOMENTO[momentoDelDia(texto)];
  const lista = momento
    ? nombre
      ? momento.conNombre
      : momento.sinNombre
    : nombre
      ? CON_NOMBRE
      : SIN_NOMBRE;

  const frase = lista[Math.floor(Math.random() * lista.length)];
  return frase.replace("{n}", nombre);
}

// Qué hora del día nombró el cliente, si es que nombró alguna. Se mira de
// la más concreta a la menos: "hola buenas tardes" es tarde, no un "buenas"
// suelto.
function momentoDelDia(texto) {
  const palabras = despejar(texto);
  if (palabras.some((p) => p === "dia" || p === "dias")) return "dias";
  if (palabras.some((p) => p === "tarde" || p === "tardes")) return "tardes";
  if (palabras.some((p) => p === "noche" || p === "noches")) return "noches";
  if (palabras.some((p) => p === "buenas" || p === "wenas")) return "buenas";
  return "";
}

// Deja el mensaje en palabras comparables: sin emojis, sin signos, sin
// tildes y sin las letras estiradas de "holaaaa", "hooola" o "heyy".
function despejar(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((palabra) =>
      palabra
        // Tres letras iguales o más nunca son de verdad: "hooola" -> "hola".
        .replace(/(.)\1{2,}/g, "$1")
        // Y las del final se estiran mucho: "holaa" -> "hola", "heyy" -> "hey".
        // Solo al final, para no romper la "ll" de "allí" ni la "rr".
        .replace(/(.)\1+$/, "$1")
    );
}
