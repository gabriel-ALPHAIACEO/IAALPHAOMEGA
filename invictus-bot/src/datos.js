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

const HORARIO =
  /\b(horarios?|a\s+qu[eé]\s+hora|hasta\s+qu[eé]\s+hora|desde\s+qu[eé]\s+hora|abren|cierran|abiertos?|est[aá]n\s+abierto)\b/i;

const ENVIO =
  /\b(env[ií]os?|env[ií]an|env[ií]as|enviar|zoom|mrw|encomienda|domesa|tealca)\b/i;

const DELIVERY_PIDE = /\b(delivery|deliveri|domicilio|a\s+mi\s+casa|reparto|llevan\s+a)\b/i;

const TRABAJO_PIDE =
  /\b(trabajo|empleo|vacantes?|curr[ií]cul[uo]m|contratan(do)?|necesitan\s+personal|solicito\s+empleo|busco\s+trabajo|est[aá]n\s+empleando)\b/i;

// Devuelve el tema que pregunta, o "" si no es ninguno de estos.
//
// El orden importa donde dos temas se pisan: "¿hacen delivery a mi casa o
// tengo que ir a la tienda?" habla de delivery, no de ubicación.
export function queDatoPide(texto) {
  const limpio = String(texto || "");
  if (!limpio.trim()) return "";

  if (DELIVERY_PIDE.test(limpio)) return "delivery";
  if (ENVIO.test(limpio)) return "envios";
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
