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

// BOTAS: TÁCTICAS O DE BÁSQUET (30-sep-2026).
//
// EL FALLO. En este catálogo "bota" solo aparece en "Bota táctica" (y en
// dos On Cloud). Lo que la gente llama "botas de básquet" son zapatillas de
// básquet —Lebron, Kyrie, Giannis, Curry, Jordan 40— y ninguna lleva
// "básquet" en el título. Así que "botas de básquet" terminaba buscando
// "bota táctica", y el cliente tuvo que escribir "botas de basquet no de
// policía".
//
// El prompt ya lo explica; esto es la red por debajo, por si el modelo
// igual se equivoca: si el cliente habla de BÁSQUET, la búsqueda no puede
// ser la de las tácticas. Y si habla de tácticas / militares / de policía
// SIN nombrar el básquet, la búsqueda es "táctica". Cuando dice las dos
// cosas ("de básquet, no de policía") gana el básquet: la otra va negada.
const HABLA_DE_BASQUET = /\b(?:basquet\w*|basket\w*|baloncesto|basquetbol|nba)\b/;
const HABLA_DE_TACTICAS = /\b(?:tactic\w*|militar\w*|polic\w*|seguridad|combate|swat|guardia)\b/;

// Las líneas de básquet del catálogo, en el orden en que se ofrecen. Se
// busca la primera que no se haya buscado ya en esta conversación.
const LINEAS_DE_BASQUET = ["Lebron", "Irving", "Giannis", "Curry", "Jordan 40"];

export function corregirBusquedaDeBotas(texto, buscar, historial = "") {
  const dice = despejarConNumeros(texto);
  const busca = despejarConNumeros(buscar);
  const nada = !busca || busca === "nada";

  if (HABLA_DE_BASQUET.test(dice)) {
    // La búsqueda ya es un modelo de básquet: está bien.
    if (LINEAS_DE_BASQUET.some((l) => busca.includes(despejarConNumeros(l)))) {
      return { corregido: false, buscar };
    }
    // Solo se corrige lo que seguro está mal: las tácticas, "bota" suelta,
    // o la palabra "básquet" (ningún título la tiene: daría cero).
    if (nada || !/\b(?:tactic\w*|botas?|basquet\w*|basket\w*|baloncesto|zapat\w*|deportiv\w*)\b/.test(busca)) {
      return { corregido: false, buscar };
    }
    const yaBuscado = despejarConNumeros(historial);
    const linea =
      LINEAS_DE_BASQUET.find((l) => !yaBuscado.includes(`ya busque ${despejarConNumeros(l)}`)) ||
      LINEAS_DE_BASQUET[0];
    return {
      corregido: true,
      buscar: linea,
      respuesta: "¡Entendido! Te muestro unas de básquet 🏀👇",
      nota: `Busca calzado de básquet (no botas tácticas). Ya busqué: ${linea}.`,
    };
  }

  if (HABLA_DE_TACTICAS.test(dice) && /\bbotas?\b/.test(dice)) {
    if (busca.includes("tactic")) return { corregido: false, buscar };
    if (!nada && !/^botas?$/.test(busca)) return { corregido: false, buscar };
    return {
      corregido: true,
      buscar: "táctica",
      respuesta: "¡Claro! Te muestro las botas tácticas 👇",
      nota: "Busca botas tácticas. Ya busqué: táctica.",
    };
  }

  return { corregido: false, buscar };
}

// LOS DRAKE SON LOS AF1 (6-oct-2026, dueño). El 5-oct cinco clientes
// pidieron "los AF1 Drake" y no vieron ninguno. El prompt ya lo enseña; esto
// es la red por debajo: si el cliente nombra a Drake y la IA no buscó nada,
// o buscó otra cosa que no es un Air Force, se buscan las Air Force One
// Drake (y si ninguna foto dice "Drake", drive.js enseña las AF1).
const DICE_DRAKE = /\b(?:drake|drakes|dreik|dreak|certified lover boy|love you forever)\b/;
const ES_AF1 = /\b(?:air ?force|af ?0?1)\b/;
const GENERO = /\b(?:dama|caballero|nino|nina|unisex)\b/g;

export function corregirBusquedaDeApodos(texto, buscar) {
  const dice = despejarConNumeros(texto);
  if (!DICE_DRAKE.test(dice)) return { corregido: false, buscar };
  const busca = despejarConNumeros(buscar);
  const nada = !busca || busca === "nada";
  if (!nada && busca.includes("drake")) return { corregido: false, buscar };
  // Otro modelo con nombre ("Retro 4"): el cliente puede estar pidiendo
  // dos cosas. Solo se corrige lo vacío, lo genérico o un AF1 sin Drake.
  if (!nada && !ES_AF1.test(busca) && !/^(?:nike|calzado|zapatos?|tenis|nocta)\b/.test(busca)) {
    return { corregido: false, buscar };
  }
  const genero = [...new Set(busca.match(GENERO) || [])].join(" ");
  const nuevo = `Air Force One Drake${genero ? ` ${genero}` : ""}`;
  return {
    corregido: true,
    buscar: nuevo,
    // La frase solo cambia si la IA no iba a enseñar nada (estaba
    // preguntando "¿qué estás buscando?" a alguien que ya lo dijo).
    respuesta: nada ? "¡Claro! Te muestro las Air Force One 👟👇" : "",
    nota: `Pidió las Drake (Air Force One). Ya busqué: ${nuevo}.`,
  };
}

function despejarConNumeros(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
