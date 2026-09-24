// "¿Me pasas el catálogo?"
//
// Este archivo cubre el caso en que el cliente pide el catálogo o el enlace
// de la tienda — sea por su nombre, o preguntando en general si hay más de
// lo que ya vio. Ahí no hay nada que buscar ni nada que conversar — quiere
// el link — y se le responde aquí mismo, sin gastar una llamada al modelo.
//
// HISTORIA DE ESTA DECISIÓN (para no dar vueltas en círculo).
//
// 21-sep-2026: se sacó de aquí "¿qué más tienen?", "¿hay otros?", "¿eso es
// todo?" — se mandaban al catálogo, y el dueño lo vivió como el peor error
// de venta del bot: el cliente pedía ver MÁS ZAPATOS y recibía un enlace.
// Esos casos pasaron a ir al modelo, que elegía una marca y mostraba
// producto en vez de mandar el link.
//
// 22-sep-2026: el dueño pidió volver a mandar el link en ese caso —lo
// probó en producción y prefiere que "¿hay más? ¿o son solo esos?" reciba
// el catálogo completo, no otro par sacado por el bot—. Así que esas frases
// vuelven a entrar aquí. Lo que SÍ sigue protegido: en cuanto el mensaje
// nombra algo concreto —una marca, un modelo, un color— dejan de ser un
// "pásame el catálogo" y pasan a ser una búsqueda, porque entonces ya no
// todas las palabras son conocidas (ver la condición de abajo). "¿Tienen
// más Jordan?" sigue sin disparar esto.
//
// OJO CON LO QUE TAMPOCO ENTRA AQUÍ. "¿Tienen más tallas?" no es pedir el
// catálogo, es una pregunta para el asesor, y quien llama a esto tiene que
// descartar antes las preguntas de talla.

// Tiene que aparecer una de estas, o no es un pedido de catálogo. Son las
// palabras con las que se nombra la tienda online, o con las que se
// pregunta en general si hay más / si eso es todo.
const NUCLEO = new Set([
  "catalogo", "catalogos",
  "link", "enlace", "url",
  "tienda", "pagina", "web", "sitio", "online",
  "mas", "otro", "otros", "otra", "otras", "demas",
  "variedad", "surtido", "opciones",
  "disponible", "disponibles", "existencia", "existencias",
]);

// Palabras que acompañan al pedido sin cambiarlo: "mándame el catálogo por
// favor", "¿tienes el link de la tienda?", "¿hay más modelos?".
const ACOMPANAN = new Set([
  "que", "cual", "cuales", "hay", "tienen", "tiene", "tienes", "tenes",
  "quiero", "quisiera", "deseo", "puedo", "puedes", "podes", "puede",
  "ver", "veo", "mostrar", "muestra", "muestras", "muestrame", "mostrarme",
  "ensenar", "ensename", "ensenas", "manda", "mandame", "mandar", "envia",
  "enviame", "enviar", "pasa", "pasame", "pasas", "pasar", "dame", "tener",
  "modelo", "modelos", "zapato", "zapatos", "calzado", "calzados",
  "par", "pares", "cosa", "cosas", "articulo", "articulos", "producto",
  "productos", "foto", "fotos",
  "algo", "todo", "todos", "toda", "todas", "completo", "completa",
  "por", "favor", "porfa", "porfavor", "gracias",
  "me", "te", "le", "lo", "los", "las", "la", "el", "un", "una", "unos",
  "unas", "de", "del", "y", "o", "en", "a", "con", "para", "su", "sus",
  "tu", "tus", "mi", "mis", "si", "no", "ahi", "ahora",
  "es", "son", "eso", "esos", "esa", "esas", "esto", "estos", "ese",
  "ya", "queda", "quedan", "nada", "ninguno", "ninguna", "mismo", "mismos",
  "solo", "solamente", "unicamente", "nomas",
]);

// Más de esto y ya no es un "pásame el catálogo", es alguien explicando algo.
const MAXIMO_DE_PALABRAS = 8;

// Se turnan para no sonar a grabación con quien pregunta varias veces.
//
// Son una entrega, no un empujón: el cliente pidió el enlace y se le da,
// pero la última frase deja la puerta abierta para que vuelva a escribir.
// Ahí es donde se cierra la venta, no en la tienda online.
const FRASES = [
  "¡Claro que sí! Aquí tienes el catálogo completo 👇 Cuando veas uno que te guste, dime cuál y te cuento todo 😊",
  "¡Con gusto! Este es el catálogo con todo lo que tenemos 👇 Dime cuál te llamó la atención y seguimos por aquí",
  "¡Por supuesto! Aquí lo tienes 👇 Si ves alguno que te guste, escríbeme el nombre y te lo muestro mejor 😊",
  "Aquí está el catálogo completo 👇 Échale un ojo con calma y me dices cuál te gustó 👟",
  "¡Enseguida! Este es el catálogo 👇 Cualquier modelo que te llame la atención, me lo dices y te ayudo 😊",
];

// Con nombre suena a que te están atendiendo a ti, no a cualquiera. Se usa
// con cuentagotas: index.js deja de pasarlo a las tres veces.
const FRASES_CON_NOMBRE = [
  "¡Claro, {n}! Aquí tienes el catálogo completo 👇 Dime cuál te gustó y te cuento todo 😊",
  "Con gusto, {n} 👇 Este es el catálogo entero, y si ves alguno que te guste me lo dices",
  "Aquí lo tienes, {n} 👇 Échale un ojo y me dices cuál te llamó la atención 👟",
];

// Palabras con las que se pide VARIEDAD: otra cosa, algo distinto, más.
//
// No sirven para mandar el catálogo —eso se acabó— sino para saber que hay
// que descartar lo que el cliente YA vio antes de enseñarle nada. Repetirle
// el mismo carrusel es lo que le hizo escribir "son los mismos".
const PEDIR_MAS = new Set([
  "mas", "otro", "otros", "otra", "otras", "demas",
  "distinto", "distintos", "distinta", "distintas",
  "diferente", "diferentes", "nuevo", "nuevos", "nueva", "nuevas",
  "variedad", "surtido", "opciones",
]);

// Y las formas en que se dice sin usar ninguna de esas palabras. Van por
// separado porque son frases hechas, no palabras sueltas. Se comparan contra
// el mensaje ya despejado: sin tildes y en minúscula.
const PEDIR_MAS_EN_FRASE = [
  // "son los mismos", "es el mismo", "ya los vi", "están repetidos"
  /\b(son|es|estan|esta)\s+(los\s+|las\s+|el\s+|la\s+)?mism/,
  /\bya\s+(los|las|lo|la)\s+(vi|viste|mostraste|habias|mande)/,
  /\brepetid/,
  /\blo\s+mismo\b/,
  // "¿eso es todo?", "¿es todo lo que tienen?"
  /\bes\s+todo\b/,
  // "¿y solo tienen esos?", "¿solo eso?"
  /\bsolo\s+(tienen|tienes|hay|queda|quedan|eso|esos|esto|estos|ese|esa|esas)\b/,
  // "¿no hay más?", "¿no tienen otros?"
  /\bno\s+(hay|tienen|tienes|queda|quedan)\s+(mas|otros|otras|nada|ninguno)\b/,
  /\bnada\s+mas\b/,
  /\bya\s+no\s+(hay|tienen|tienes|queda|quedan)\b/,
];

// ¿Está pidiendo ver algo DISTINTO de lo que ya le enseñamos?
//
// Se usa para una sola cosa: activar el filtro de repetidos. Cuando da
// false no se filtra nada, y eso es a propósito — "¿cuánto cuestan?" sobre
// el mismo zapato TIENE que volver a mostrarlo, no decirle que ya lo vio.
export function pideMasVariedad(texto) {
  const palabras = despejar(texto);
  if (!palabras.length) return false;

  if (palabras.some((p) => PEDIR_MAS.has(p))) return true;
  return PEDIR_MAS_EN_FRASE.some((patron) => patron.test(palabras.join(" ")));
}

// ¿Está pidiendo el catálogo o el enlace de la tienda — por su nombre, o
// preguntando en general si hay más / si eso es todo?
export function pideElCatalogo(texto) {
  const palabras = despejar(texto);
  if (!palabras.length || palabras.length > MAXIMO_DE_PALABRAS) return false;

  // Esta es la condición que lo sostiene todo: TODAS las palabras tienen que
  // ser del pedido o de las que lo acompañan. En cuanto aparece una palabra
  // desconocida —"Jordan", "negras", "gym"— deja de ser un pedido de
  // catálogo y pasa a ser una búsqueda concreta, que es trabajo del modelo.
  // Esto es lo que protege "¿tienen más Jordan?": "jordan" no está en
  // ninguna de las dos listas, así que esa frase nunca llega aquí.
  if (!palabras.every((p) => NUCLEO.has(p) || ACOMPANAN.has(p))) return false;

  // "¿Y solo tienen esos?", "¿eso es todo?": el cliente pregunta si hay más
  // sin usar la palabra "más". Se compara contra el mensaje ya despejado.
  if (PEDIR_MAS_EN_FRASE.some((patron) => patron.test(palabras.join(" ")))) {
    return true;
  }

  // Y si no, tiene que nombrar el catálogo o pedir "más" de verdad — un
  // "quiero ver" suelto, sin ninguna de las dos cosas, no cuenta.
  return palabras.some((p) => NUCLEO.has(p));
}

export function fraseDeCatalogo(nombre) {
  const lista = nombre ? FRASES_CON_NOMBRE : FRASES;
  const frase = lista[Math.floor(Math.random() * lista.length)];
  return frase.replace("{n}", nombre);
}

// Mismo despiece que en saludo.js: sin emojis, sin signos, sin tildes y sin
// las letras estiradas de "catalogooo".
function despejar(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((palabra) =>
      palabra.replace(/(.)\1{2,}/g, "$1").replace(/(.)\1+$/, "$1")
    );
}
