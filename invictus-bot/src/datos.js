import listaCatalogo from "./prompts/catalogo.txt";

// LO QUE LA TIENDA SABE DE SÍ MISMA: horarios, envíos, delivery, empleo.
//
// HISTORIA. Esto se escribió el 25-sep-2026 en otra rama de trabajo, con
// los datos que dio el dueño, y nunca llegó a la rama que se desplegaba. El
// 30-sep el dueño preguntó dónde estaba "lo del delivery, los envíos
// nacionales y la respuesta para los que buscan trabajo". Se trae aquí tal
// cual se aprobó; la ubicación vive aparte (ubicacion.js) y los métodos de
// pago y la tasa ya los contesta pagos.js.
//
// POR QUÉ ESTO ES CÓDIGO Y NO PROMPT. Son datos exactos: dos empresas de
// envío, unos horarios, una zona de delivery. Si los redacta el modelo,
// tarde o temprano se deja uno fuera o añade el que no es.
//
// SOLO SALTA CUANDO LA PREGUNTA VA SOLA. Mezclada con un calzado —"¿tienen
// las Air Force y hacen envíos?"— contesta el modelo las dos cosas (el
// prompt conoce estos datos, ver DATOS DE LA TIENDA en texto.txt) y las
// fichas salen igual: un dato de la tienda no puede costar una venta.

/* ── Los textos ───────────────────────────────────────────────────
   Se cambian aquí y en ningún otro sitio. Cada uno cabe de sobra en un
   mensaje de Instagram (1000 caracteres).
   ───────────────────────────────────────────────────────────────── */

export const HORARIOS =
  "🕘 Nuestro horario:\n" +
  "\n" +
  "🔹 Lunes a viernes — 9:00am a 7:00pm\n" +
  "🔹 Domingos — 9:00am a 5:00pm\n" +
  "🔹 Feriados — igual que los domingos\n" +
  "\n" +
  "¡Te esperamos! 😊";

export const ENVIOS =
  "📦 ¡Sí hacemos envíos nacionales!\n" +
  "\n" +
  "Trabajamos con ZOOM y MRW, a todo el territorio nacional 🇻🇪\n" +
  "\n" +
  "¿Para qué ciudad sería? 😊";

export const DELIVERY =
  "🛵 ¡Sí hacemos delivery!\n" +
  "\n" +
  "Llegamos a toda la isla de Margarita, y en algunas zonas es GRATIS 🙌\n" +
  "\n" +
  "¿Para qué zona sería? Así te confirmo 😊";

export const TRABAJO =
  "¡Gracias por tu interés! 😊\n" +
  "\n" +
  "Por ahora tenemos el personal completo. Cuando necesitemos gente lo " +
  "publicamos en las historias, así que mantente pendiente 👀";

export const RESPUESTAS = {
  horarios: HORARIOS,
  envios: ENVIOS,
  delivery: DELIVERY,
  trabajo: TRABAJO,
};

/* ── Quién pregunta qué ───────────────────────────────────────────
   Una expresión por tema. Van sueltas y no en una sola: así se lee cuál
   falló cuando algo no se reconoce, y se amplía sin tocar las demás.
   ───────────────────────────────────────────────────────────────── */

// "abiertos" suelto NO: "¿los tienen abiertos?" habla de un zapato. Solo
// "¿están abiertos?", que sí es el horario.
const HORARIO =
  /\b(horarios?|a\s+qu[eé]\s+hora|hasta\s+qu[eé]\s+hora|desde\s+qu[eé]\s+hora|abren|cierran|est[aá]n\s+abiertos?|abierto\s+hoy)\b/i;

const ENVIO =
  /\b(env[ií]os?|env[ií]an|env[ií]as|enviar|zoom|mrw|encomienda|domesa|tealca)\b/i;

// "Te envío la foto", "te lo envío por aquí", "ya te envié el comprobante":
// es el CLIENTE mandando algo, no preguntando por los envíos de la tienda.
const EL_QUE_ENVIA_ES_EL =
  /\b(?:te|se|le|les|ya)\s+(?:lo\s+|la\s+|los\s+|las\s+)?env[ií](?:o|e)\b|\bte\s+(?:lo\s+|la\s+)?voy\s+a\s+enviar\b/i;

const DELIVERY_PIDE = /\b(delivery|deliveri|domicilio|a\s+mi\s+casa|reparto|llevan\s+a)\b/i;

// "trabajo" suelto NO: "zapatos para el trabajo" es un cliente comprando.
// Solo cuando se busca EMPLEO.
const TRABAJO_PIDE =
  /\b(empleo|vacantes?|curr[ií]cul[uo]m|contratan(do)?|necesitan\s+personal|solicito\s+empleo|busco\s+(?:trabajo|empleo|chamba)|(?:hay|tienen|ofrecen)\s+(?:trabajo|empleo|chamba)|(?:trabajar|laborar)\s+(?:con\s+ustedes|ah[ií]|aqu[ií]|en\s+la\s+tienda)|est[aá]n\s+empleando)\b/i;

// Devuelve el tema que pregunta, o "" si no es ninguno de estos.
//
// El orden importa donde dos temas se pisan: "¿hacen delivery a mi casa o
// tengo que ir a la tienda?" habla de delivery, no de ubicación.
export function queDatoPide(texto) {
  const limpio = String(texto || "");
  if (!limpio.trim()) return "";

  if (DELIVERY_PIDE.test(limpio)) return "delivery";
  if (ENVIO.test(limpio) && !EL_QUE_ENVIA_ES_EL.test(limpio)) return "envios";
  if (HORARIO.test(limpio)) return "horarios";
  if (TRABAJO_PIDE.test(limpio)) return "trabajo";

  return "";
}

/* ── ¿El mensaje nombra algún calzado del catálogo? ────────────────
   Se usa para una sola decisión, y equivocarse cuesta una venta: si la
   pregunta viene MEZCLADA con un producto el dato de la tienda NO puede
   quedarse con el turno. Se mira el título entero dentro del mensaje y
   también sus primeras palabras: el cliente escribe "las Air Force" y en
   Shopify están como "Air Force One blancas".
   ───────────────────────────────────────────────────────────────── */
let titulos = null;

function titulosDelCatalogo() {
  if (titulos) return titulos;

  titulos = String(listaCatalogo || "")
    .split("\n")
    .map((linea) => linea.trim())
    .filter((linea) => linea && !linea.startsWith("#"));

  return titulos;
}

function despejar(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function nombraUnProducto(texto) {
  const donde = despejar(texto);
  if (!donde) return "";

  for (const titulo of titulosDelCatalogo()) {
    const limpio = despejar(titulo);
    if (limpio.length >= 4 && donde.includes(limpio)) return titulo;

    const palabras = limpio.split(" ");
    for (const cuantas of [3, 2]) {
      const principio = palabras.slice(0, cuantas).join(" ");
      if (principio.length >= 6 && donde.includes(principio)) return titulo;
    }
  }

  return "";
}

/* ── La IA redacta; esto comprueba que no invente (30-sep-2026) ────
   Pedido del dueño: "que la IA tenga más libertad para personalizar los
   mensajes, pero con la información clara y que no alucine". Caso real:
   "¿Tienes delivery para Macanao?" recibía el texto fijo, sin nombrar
   Macanao. Ahora lo redacta el modelo con los DATOS DE LA TIENDA del
   prompt —"¡Sí! A Macanao te llega 🛵"— y esto revisa lo que escribió.

   Si inventa algo —un precio de envío, que su zona es gratis, un plazo de
   entrega, otra empresa de envíos, un horario que no es, que están
   contratando— se descarta y sale el texto fijo de arriba. Nunca queda
   peor que antes: en el peor caso, es lo de antes.
   ───────────────────────────────────────────────────────────────── */

// Empresas de envío que NO son las nuestras (ZOOM y MRW).
const OTRA_EMPRESA = /\b(tealca|domesa|liberty\s*express|dhl|fedex|ups|ipostel|mail\s*boxes)\b/i;

// Un precio o un número pegado al envío o al delivery ("el envío sale en
// 5$", "delivery de 3 dólares"). Lo que cuesta lo dice un asesor.
const PRECIO_DEL_ENVIO =
  /\b(env[ií]os?|delivery|flete)\b[^.!?\n]{0,35}(\$|usd|bs\.?\b|bol[ií]var|d[oó]lar|\d)|(\$|usd|d[oó]lar|bs\.?\b)[^.!?\n]{0,20}\b(de\s+)?(env[ií]o|delivery)\b/i;

// Plazos inventados: "te llega mañana", "entregamos en 24 horas".
const PLAZO =
  /\b(llega|llegan|llegar[ií]a|entrega\w*|sale|despacha\w*)\b[^.!?\n]{0,25}\b(hoy|ma[ñn]ana|mismo\s+d[ií]a|en\s+\d+|\d+\s*(?:h|horas|d[ií]as))\b/i;

// "Gratis" solo se puede decir como está: "en algunas zonas". Que SU zona
// sea gratis no lo sabe nadie más que el asesor.
const GRATIS = /\b(gratis|sin\s+costo|gratuito|free)\b/i;
const EN_ALGUNAS_ZONAS = /\balgunas\s+zonas\b/i;

// Delivery fuera de la isla: eso no es delivery, son los envíos nacionales.
const FUERA_DE_LA_ISLA =
  /\bdelivery\b[^.!?\n]{0,40}\b(caracas|valencia|maracay|barquisimeto|maracaibo|puerto\s+la\s+cruz|barcelona|m[eé]rida|san\s+crist[oó]bal|maturin|cuman[aá]|ciudad\s+bol[ií]var|puerto\s+ordaz)\b/i;

// Horas: solo las del horario (9am, 7pm, 5pm). Y del sábado no hay dato.
const HORAS_VALIDAS = new Set(["9am", "7pm", "5pm"]);
const UNA_HORA = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)/gi;
const SABADO_CON_HORA = /s[aá]bados?\b[^.!?\n]{0,40}\d|\d[^.!?\n]{0,40}s[aá]bados?\b|\babrimos\s+(?:el|los)\s+s[aá]bados?\b/i;

// Que están contratando, o que manden el CV: el personal está completo.
const CONTRATANDO =
  /\b(s[ií]\s+estamos\s+contratando|estamos\s+contratando|estamos\s+buscando\s+personal|hay\s+vacantes?|tenemos\s+vacantes?|env[ií]a(?:me|nos)?\s+tu\s+(?:cv|curr[ií]cul))/i;

export function revisarDatoDeLaTienda(respuesta, tema = "") {
  const texto = String(respuesta || "").trim();
  if (!texto) return { corregido: true, motivos: ["respuesta vacía"], respuesta: RESPUESTAS[tema] || "" };

  const motivos = [];
  if (OTRA_EMPRESA.test(texto)) motivos.push(`nombró una empresa de envíos que no es ZOOM ni MRW`);
  if (PRECIO_DEL_ENVIO.test(texto)) motivos.push(`puso un precio o un número al envío/delivery`);
  if (PLAZO.test(texto)) motivos.push(`prometió un plazo de entrega`);
  if (GRATIS.test(texto) && !EN_ALGUNAS_ZONAS.test(texto)) motivos.push(`dijo gratis sin el 'en algunas zonas'`);
  if (FUERA_DE_LA_ISLA.test(texto)) motivos.push(`ofreció delivery fuera de Margarita`);
  if (SABADO_CON_HORA.test(texto)) motivos.push(`dio un horario para el sábado (no hay dato)`);
  for (const m of texto.matchAll(UNA_HORA)) {
    const h = `${Number(m[1])}${m[3].replace(/[.\s]/g, "").toLowerCase()}`;
    if ((m[2] && m[2] !== "00") || !HORAS_VALIDAS.has(h)) {
      motivos.push(`dio una hora que no es del horario (${m[0].trim()})`);
      break;
    }
  }
  if (CONTRATANDO.test(texto)) motivos.push(`dijo que están contratando`);

  return motivos.length
    ? { corregido: true, motivos, respuesta: RESPUESTAS[tema] || texto }
    : { corregido: false, respuesta: texto };
}

// La nota que acompaña a la pregunta cuando el modelo la va a contestar.
export function notaDeDatoDeLaTienda(tema) {
  const que = { delivery: "el DELIVERY", envios: "los ENVÍOS", horarios: "el HORARIO", trabajo: "el EMPLEO" }[tema] || tema;
  return (
    `[PREGUNTA POR ${que} DE LA TIENDA. Contéstala TÚ con los DATOS DE LA TIENDA, ` +
    "personalizada a lo que escribió: si nombra su zona, su ciudad o un día, nómbralos. " +
    "Cálida y corta. SIN inventar nada que no esté en esos datos: ni precios de envío, " +
    "ni si su zona paga o no el delivery, ni plazos, ni horas que no estén, ni otras empresas de envío]"
  );
}
