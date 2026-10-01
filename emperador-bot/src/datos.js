import listaCatalogo from "./prompts/catalogo.txt";
import textoTienda from "./prompts/tienda.txt";

// LO QUE LA TIENDA SABE DE SÍ MISMA: horarios, envíos, delivery, empleo.
//
// HISTORIA. Nació en Invictus con sus datos escritos aquí dentro. El 1-oct
// se trajo a El Emperador, y esos datos NO podían venir con él: son de otra
// tienda ("todo es distinto", dijo el dueño). Así que aquí los textos ya no
// están en el código: salen de prompts/tienda.txt, que es de cada tienda
// como pagos.txt.
//
// POR QUÉ HAY UN TEXTO FIJO Y NO SOLO EL PROMPT. Son datos exactos. La IA
// los redacta a la medida del cliente, pero lo que escribe se revisa
// (revisarDatoDeLaTienda) y si inventa algo sale el texto fijo de la tienda.
//
// UN TEMA SIN TEXTO EN tienda.txt NO SE CONTESTA DESDE AQUÍ: la pregunta
// sigue su camino normal y la IA, que tampoco tiene el dato, la pasa al
// asesor. Nunca se inventa un horario para no dejar callado al bot.
//
// SOLO SALTA CUANDO LA PREGUNTA VA SOLA. Mezclada con un producto —"¿tienen
// las Air Force y a qué hora abren?"— contesta el modelo las dos cosas y las
// fichas salen igual: un dato de la tienda no puede costar una venta.

/* ── Los textos, de prompts/tienda.txt ──────────────────────────── */

const TEMAS = ["horarios", "envios", "delivery", "trabajo"];

// Separa el archivo por [SECCIONES]. Las líneas con # son notas. Se
// conservan los saltos de línea del texto (es lo que verá el cliente).
export function leerTienda(texto) {
  const secciones = Object.fromEntries(TEMAS.map((t) => [t, ""]));
  let actual = "";
  const lineas = {};
  for (const cruda of String(texto || "").split("\n")) {
    const linea = cruda.replace(/\r$/, "");
    if (linea.trimStart().startsWith("#")) continue;
    const titulo = linea.trim().match(/^\[([A-ZÁÉÍÓÚÑ]+)\]$/i);
    if (titulo) {
      const nombre = titulo[1]
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");
      actual = TEMAS.includes(nombre) ? nombre : "";
      continue;
    }
    if (actual) (lineas[actual] ||= []).push(linea);
  }
  for (const t of TEMAS) {
    secciones[t] = (lineas[t] || [])
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  return secciones;
}

let tienda = leerTienda(textoTienda);

// Solo para las pruebas: probar con los datos de otra tienda.
export function usarDatosDeTienda(texto) {
  tienda = leerTienda(texto);
  for (const t of TEMAS) RESPUESTAS[t] = tienda[t];
}

export const RESPUESTAS = { ...tienda };
export const HORARIOS = tienda.horarios;
export const ENVIOS = tienda.envios;
export const DELIVERY = tienda.delivery;
export const TRABAJO = tienda.trabajo;

export function hayDato(tema) {
  return Boolean(RESPUESTAS[tema]);
}

// Para el prompt: lo que la IA sabe de la tienda, o que no sabe nada.
export function datosParaElPrompt() {
  const nombres = { horarios: "🕘 Horario", envios: "📦 Envíos", delivery: "🛵 Delivery", trabajo: "💼 Empleo" };
  const hay = TEMAS.filter(hayDato);
  const faltan = TEMAS.filter((t) => !hayDato(t));
  const partes = [];
  if (hay.length) {
    partes.push(
      "Estos los SABES y los contestas tú (personalizados, ver abajo):\n\n" +
        hay.map((t) => `${nombres[t]}:\n${RESPUESTAS[t]}`).join("\n\n")
    );
  }
  if (faltan.length) {
    partes.push(
      `Estos NO los sabes (la tienda todavía no los cargó): ${faltan.map((t) => nombres[t].slice(2).trim()).join(", ")}. ` +
        'Si te preguntan por ellos: "Eso te lo confirma un asesor en un momento 😊". ' +
        "Nunca los inventes: ni un horario, ni una empresa de envíos, ni una zona."
    );
  }
  return partes.join("\n\n");
}

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

// Devuelve el tema que pregunta, o "" si no es ninguno de estos. Si la
// tienda no tiene ese dato cargado, también "": que lo pase la IA al asesor.
//
// El orden importa donde dos temas se pisan: "¿hacen delivery a mi casa o
// tengo que ir a la tienda?" habla de delivery, no de ubicación.
export function queDatoPide(texto) {
  const limpio = String(texto || "");
  if (!limpio.trim()) return "";

  let tema = "";
  if (DELIVERY_PIDE.test(limpio)) tema = "delivery";
  else if (ENVIO.test(limpio) && !EL_QUE_ENVIA_ES_EL.test(limpio)) tema = "envios";
  else if (HORARIO.test(limpio)) tema = "horarios";
  else if (TRABAJO_PIDE.test(limpio)) tema = "trabajo";

  return tema && hayDato(tema) ? tema : "";
}

/* ── ¿El mensaje nombra algún producto del catálogo? ───────────────
   Se usa para una sola decisión, y equivocarse cuesta una venta: si la
   pregunta viene MEZCLADA con un producto el dato de la tienda NO puede
   quedarse con el turno. Se mira el título entero dentro del mensaje y
   también sus primeras palabras: el cliente escribe "las Air Force" y en
   el catálogo están como "Air Force One blancas".

   Con el catálogo en Drive, los títulos son los de la carpeta: index.js
   se los pasa (titulosExtra), porque catalogo.txt está vacío.
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

export function nombraUnProducto(texto, titulosExtra = []) {
  const donde = despejar(texto);
  if (!donde) return "";

  for (const titulo of [...titulosDelCatalogo(), ...titulosExtra]) {
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

/* ── La IA redacta; esto comprueba que no invente ──────────────────
   Pedido del dueño (30-sep): "que la IA tenga más libertad para
   personalizar los mensajes, pero con la información clara y que no
   alucine". La IA redacta con los datos de tienda.txt, y esto revisa lo que
   escribió contra ESOS datos. Si inventa algo sale el texto fijo de
   tienda.txt. Nunca queda peor que antes: en el peor caso, es lo de antes.

   Todo lo que se comprueba se SACA de los textos de la tienda, no está
   escrito aquí: las horas, las empresas, las ciudades, el "gratis".
   ───────────────────────────────────────────────────────────────── */

const EMPRESAS_DE_ENVIO = [
  ["zoom", /\bzoom\b/i],
  ["mrw", /\bmrw\b/i],
  ["tealca", /\btealca\b/i],
  ["domesa", /\bdomesa\b/i],
  ["liberty express", /\bliberty\s*express\b/i],
  ["dhl", /\bdhl\b/i],
  ["fedex", /\bfedex\b/i],
  ["ups", /\bups\b/i],
  ["ipostel", /\bipostel\b/i],
  ["mail boxes", /\bmail\s*boxes\b/i],
];

const CIUDADES = [
  "caracas", "valencia", "maracay", "barquisimeto", "maracaibo", "puerto la cruz", "barcelona",
  "merida", "san cristobal", "maturin", "cumana", "ciudad bolivar", "puerto ordaz", "margarita",
  "porlamar", "pampatar", "los teques", "guarenas", "barinas", "coro", "punto fijo", "acarigua",
];

const DIAS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];

// Un precio o un número pegado al envío o al delivery ("el envío sale en
// 5$", "delivery de 3 dólares"). Lo que cuesta lo dice un asesor.
const PRECIO_DEL_ENVIO =
  /\b(env[ií]os?|delivery|flete)\b[^.!?\n]{0,35}(\$|usd|bs\.?\b|bol[ií]var|d[oó]lar|\d)|(\$|usd|d[oó]lar|bs\.?\b)[^.!?\n]{0,20}\b(de\s+)?(env[ií]o|delivery)\b/i;

// Plazos inventados: "te llega mañana", "entregamos en 24 horas".
const PLAZO =
  /\b(llega|llegan|llegar[ií]a|entrega\w*|sale|despacha\w*)\b[^.!?\n]{0,25}\b(hoy|ma[ñn]ana|mismo\s+d[ií]a|en\s+\d+|\d+\s*(?:h|horas|d[ií]as))\b/i;

const GRATIS = /\b(gratis|sin\s+costo|gratuito|free)\b/i;
const EN_ALGUNAS_ZONAS = /\balgunas\s+zonas\b/i;

const UNA_HORA = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)/gi;

// La tienda dice que NO (El Emperador, 1-oct: "no hay envíos ni delivery"). Entonces
// la IA no puede decir que sí, ni ofrecerlo de otra forma.
const DICE_QUE_NO = /\bno\s+(?:hacemos|tenemos|realizamos|contamos\s+con|ofrecemos|hay)\b/i;
const AFIRMA_ENVIO = /\b(?:hacemos|tenemos|realizamos|ofrecemos|enviamos|llevamos)\b[^.!?\n]{0,20}\benv[ií]os?\b|\benviamos\b|\bte\s+lo\s+(?:enviamos|mandamos)\b/i;
const AFIRMA_DELIVERY = /\b(?:hacemos|tenemos|realizamos|ofrecemos)\b[^.!?\n]{0,20}\bdelivery\b|\bte\s+lo\s+llevamos\b/i;

function afirmaSinNegar(texto, patron) {
  for (const frase of String(texto).split(/[.!?\n]+/)) {
    if (patron.test(frase) && !/\bno\b/i.test(frase)) return true;
  }
  return false;
}

const CONTRATANDO =
  /\b(s[ií]\s+estamos\s+contratando|estamos\s+contratando|estamos\s+buscando\s+personal|hay\s+vacantes?|tenemos\s+vacantes?|env[ií]a(?:me|nos)?\s+tu\s+(?:cv|curr[ií]cul))/i;

function horaNormal(m) {
  const minutos = m[2] && m[2] !== "00" ? `:${m[2]}` : "";
  return `${Number(m[1])}${minutos}${m[3].replace(/[.\s]/g, "").toLowerCase()}`;
}

function sinAcentos(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function revisarDatoDeLaTienda(respuesta, tema = "") {
  const texto = String(respuesta || "").trim();
  const fijo = RESPUESTAS[tema] || "";
  if (!texto) return { corregido: true, motivos: ["respuesta vacía"], respuesta: fijo };

  const envios = RESPUESTAS.envios || "";
  const delivery = RESPUESTAS.delivery || "";
  const horarios = RESPUESTAS.horarios || "";
  const trabajo = RESPUESTAS.trabajo || "";
  const llano = sinAcentos(texto);

  const motivos = [];

  // Empresas de envío que la tienda no nombra.
  const otra = EMPRESAS_DE_ENVIO.find(([, re]) => re.test(texto) && !re.test(envios));
  if (otra) motivos.push(`nombró una empresa de envíos que la tienda no usa (${otra[0]})`);

  if (DICE_QUE_NO.test(envios) && afirmaSinNegar(texto, AFIRMA_ENVIO)) motivos.push(`dijo que hacen envíos y la tienda no hace`);
  if (DICE_QUE_NO.test(delivery) && afirmaSinNegar(texto, AFIRMA_DELIVERY)) motivos.push(`dijo que hacen delivery y la tienda no hace`);

  if (PRECIO_DEL_ENVIO.test(texto)) motivos.push(`puso un precio o un número al envío/delivery`);
  if (PLAZO.test(texto)) motivos.push(`prometió un plazo de entrega`);

  // "Gratis": solo si la tienda lo dice, y con su misma salvedad.
  if (GRATIS.test(texto)) {
    if (!GRATIS.test(delivery) && !GRATIS.test(envios)) motivos.push(`dijo gratis y la tienda no lo dice`);
    else if (EN_ALGUNAS_ZONAS.test(delivery) && !EN_ALGUNAS_ZONAS.test(texto)) motivos.push(`dijo gratis sin el 'en algunas zonas'`);
  }

  // Delivery a una ciudad que no está en la zona de delivery de la tienda.
  if (/\bdelivery\b/i.test(texto) && delivery) {
    const zona = sinAcentos(delivery);
    const fuera = CIUDADES.find((c) => new RegExp(`\\bdelivery\\b[^.!?\\n]{0,40}\\b${c}\\b`).test(llano) && !zona.includes(c));
    if (fuera) motivos.push(`ofreció delivery fuera de la zona de la tienda (${fuera})`);
  }

  // Horas: solo las que están en el horario de la tienda. Y un día que el
  // horario no nombra no tiene hora.
  const horasValidas = new Set([...horarios.matchAll(UNA_HORA)].map(horaNormal));
  for (const m of texto.matchAll(UNA_HORA)) {
    if (!horasValidas.has(horaNormal(m))) {
      motivos.push(`dio una hora que no es del horario (${m[0].trim()})`);
      break;
    }
  }
  const horarioLlano = sinAcentos(horarios);
  for (const dia of DIAS) {
    if (horarioLlano.includes(dia)) continue;
    if (/\ba\s+(viernes|domingo|sabado)\b/.test(horarioLlano) && dia !== "domingo" && dia !== "sabado") continue; // "lunes a viernes" cubre martes-jueves
    const conHora = new RegExp(`\\b${dia}s?\\b[^.!?\\n]{0,40}\\d|\\d[^.!?\\n]{0,40}\\b${dia}s?\\b|\\babrimos\\s+(?:el|los)\\s+${dia}s?\\b`);
    if (conHora.test(llano)) {
      motivos.push(`dio un horario para el ${dia} (no hay dato)`);
      break;
    }
  }

  if (/complet/i.test(trabajo) && CONTRATANDO.test(texto)) motivos.push(`dijo que están contratando`);

  return motivos.length
    ? { corregido: true, motivos, respuesta: fijo || texto }
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
