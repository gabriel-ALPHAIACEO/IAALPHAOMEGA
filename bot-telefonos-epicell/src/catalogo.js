// "¿Tienen más?"
//
// Cuando el cliente pide ver más sin nombrar nada concreto, no hay término
// que buscar: quiere pasearse por la tienda. Se le responde aquí mismo, con
// ganas y con el botón al catálogo, sin pasar por el modelo.
//
// OJO CON LO QUE *NO* ENTRA AQUÍ. "¿Tienen más tallas?" no es pedir el
// catálogo, es una pregunta para el asesor, y quien llama a esto tiene que
// descartar antes las preguntas de ese tipo. "¿Tienen más iPhone?" tampoco:
// eso nombra un modelo y va al buscador como cualquier otra búsqueda.

// Con que aparezca una de estas, el cliente está pidiendo ver más.
const NUCLEO = new Set([
  "mas", "otro", "otros", "otra", "otras", "demas",
  "catalogo", "catalogos", "variedad", "surtido", "opciones",
  "disponible", "disponibles", "existencia", "existencias",
]);

// Palabras que acompañan al pedido sin cambiarlo: "¿qué más tienen?",
// "mándame el catálogo por favor", "quiero ver otros modelos".
const ACOMPANAN = new Set([
  "que", "cual", "cuales", "hay", "tienen", "tiene", "tienes", "tenes",
  "quiero", "quisiera", "deseo", "puedo", "puedes", "podes", "puede",
  "ver", "veo", "mostrar", "muestra", "muestras", "muestrame", "mostrarme",
  "ensenar", "ensename", "ensenas", "manda", "mandame", "mandar", "envia",
  "enviame", "enviar", "pasa", "pasame", "pasar", "dame", "tener",
  "modelo", "modelos", "cosa", "cosas", "articulo", "articulos", "producto",
  "productos", "tienda", "link", "enlace", "foto", "fotos",
  "algo", "todo", "todos", "toda", "todas", "completo", "completa",
  "por", "favor", "porfa", "porfavor", "gracias",
  "me", "te", "le", "lo", "los", "las", "la", "el", "un", "una", "unos",
  "unas", "de", "del", "y", "o", "en", "a", "con", "para", "su", "sus",
  "tu", "tus", "mi", "mis", "si", "no", "ahi", "ahora",
  // Referencias a lo que acaba de ver: "¿y solo tienen esos?", "¿eso es todo?"
  "es", "son", "eso", "esos", "esa", "esas", "esto", "estos", "ese",
  "ya", "queda", "quedan", "nada", "ninguno", "ninguna", "mismo", "mismos",
  "solo", "solamente", "unicamente", "nomas",
]);

// Más de esto y ya no es un "¿qué más tienen?", es alguien explicando algo.
const MAXIMO_DE_PALABRAS = 8;

// Pedir más también se dice desilusionado: "¿y solo tienen esos?", "¿eso es
// todo?", "¿no hay más?". Ahí el cliente no está pidiendo, está a punto de
// irse — y es justo cuando hay que enseñarle el catálogo. Estas formas no
// encajan en el reparto de palabras de arriba, así que van aparte.
//
// Se comparan contra el mensaje ya despejado: sin tildes y en minúscula.
const ESO_ES_TODO = [
  // "¿eso es todo?", "¿es todo lo que tienen?"
  /\bes\s+todo\b/,
  // "¿y solo tienen esos?", "¿solo eso?", "¿solo queda eso?"
  /\bsolo\s+(tienen|tienes|hay|queda|quedan|eso|esos|esto|estos|ese|esa|esas)\b/,
  // "¿no hay más?", "¿no tienen otros?", "¿no queda nada?"
  /\bno\s+(hay|tienen|tienes|queda|quedan)\s+(mas|otros|otras|nada|ninguno)\b/,
  /\bnada\s+mas\b/,
  // "¿ya no hay?", "¿ya no queda?"
  /\bya\s+no\s+(hay|tienen|tienes|queda|quedan)\b/,
];

// Se turnan para no sonar a grabación con quien pregunta varias veces.
//
// No son un "claro, aquí tienes": son el empujón al catálogo. Todas hacen
// lo mismo en tres pasos — le dicen que lo que vio es poco, le pican la
// curiosidad y lo mandan al catálogo. Cambia estas frases y cambias cómo
// vende tu tienda.
//
// Ninguna promete stock ni apartar nada: eso lo decide una persona.
const FRASES = [
  "Eso es apenas una parte 👀 En el catálogo está todo lo que tenemos, entra y míralo 👇",
  "Tenemos muchísimo más de lo que cabe por aquí 🔥 Date una vuelta por el catálogo completo 👇",
  "Lo bueno está en el catálogo 😍 Ahí ves todos los productos con sus precios 👇",
  "Te falta ver lo mejor 🛍️ Mira el catálogo completo y me dices cuál te gustó 👇",
  "Eso que viste es una muestra pequeña 😊 En el catálogo está el resto, te invito a verlo 👇",
  "Hay bastante más esperándote 🔥 Aquí tienes el catálogo completo, elige el tuyo 👇",
  "Lo que te mostré es apenas el comienzo 😍 Entra al catálogo y escoge con calma 👇",
  "Ahí está lo que buscas 👀 Este es el catálogo completo, dime cuál te llamó la atención 👇",
];

// Con nombre suena a que te están atendiendo a ti, no a cualquiera. Se usa
// con cuentagotas: index.js deja de pasarlo a las tres veces.
const FRASES_CON_NOMBRE = [
  "{n}, eso es apenas una parte 👀 En el catálogo está todo lo que tenemos 👇",
  "{n}, te falta ver lo mejor 🔥 Aquí tienes el catálogo completo 👇",
  "Hay mucho más, {n} 😍 Date una vuelta por el catálogo y me dices cuál te gustó 👇",
  "{n}, lo que te mostré es apenas el comienzo 🛍️ Mira el catálogo completo 👇",
];

// ¿Está pidiendo ver más, sin nombrar ningún producto?
export function pideVerMas(texto) {
  const palabras = despejar(texto);
  if (!palabras.length || palabras.length > MAXIMO_DE_PALABRAS) return false;

  // Esta es la condición que lo sostiene todo: TODAS las palabras tienen que
  // ser del pedido o de las que lo acompañan. En cuanto aparece una palabra
  // desconocida —el nombre de un modelo, un color— deja de ser un pedido de
  // catálogo y pasa a ser una búsqueda concreta.
  //
  // Va antes que nada, también antes de los patrones de "¿eso es todo?": si
  // no, "¿solo tienen el modelo X?" acabaría mandando el catálogo en vez de
  // buscar X, que es justo lo contrario de lo que pide el cliente.
  if (!palabras.every((p) => NUCLEO.has(p) || ACOMPANAN.has(p))) return false;

  // "¿Eso es todo?", "¿y solo tienen esos?": el cliente se está quedando
  // frío. No lo dice con un "más", pero pide exactamente lo mismo.
  if (ESO_ES_TODO.some((patron) => patron.test(palabras.join(" ")))) return true;

  // Y si no, al menos una palabra tiene que pedir "más" de verdad, para que
  // un "quiero ver" suelto no acabe mandando el catálogo.
  return palabras.some((p) => NUCLEO.has(p));
}

export function fraseDeCatalogo(nombre) {
  const lista = nombre ? FRASES_CON_NOMBRE : FRASES;
  const frase = lista[Math.floor(Math.random() * lista.length)];
  return frase.replace("{n}", nombre);
}

// Mismo despiece que en saludo.js: sin emojis, sin signos, sin tildes y sin
// las letras estiradas de "masss".
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
