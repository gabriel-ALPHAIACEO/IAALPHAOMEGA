// "¿DÓNDE ESTÁN?": LA DIRECCIÓN, TAL CUAL, CON EL BOTÓN DE GOOGLE MAPS.
//
// QUÉ SE PEDÍA (30-sep-2026). Lo mismo que hacía la automatización de
// ManyChat "Ubicación MAPS": el texto exacto de la dirección y, debajo, un
// botón "MAPS/GOOGLE" que abre el mapa. Tal cual, sin que la IA lo reescriba.
//
// Por eso esto NO pasa por el modelo: el texto sale de prompts/ubicacion.txt
// letra por letra. Cuando el mensaje es SOLO la pregunta de la ubicación, ni
// se llama a OpenAI (cero tokens). Cuando además pide otra cosa —"¿dónde
// están y tienen Jordan?"— se manda la ubicación y el resto sigue al modelo
// como siempre, avisado de que la dirección ya salió.
//
// Sin prompts/ubicacion.txt rellenado, nada de esto se activa.

import textoUbicacion from "./prompts/ubicacion.txt";

let leido = null;

function leer() {
  if (!leido) {
    const secciones = { TEXTO: [], BOTON: [], ENLACE: [] };
    let seccion = "";

    for (const cruda of String(textoUbicacion || "").split("\n")) {
      const linea = cruda.trim();
      if (linea.startsWith("#")) continue;

      const marca = linea.match(/^\[(\w+)\]$/);
      if (marca) {
        seccion = marca[1].toUpperCase();
        continue;
      }
      if (secciones[seccion]) secciones[seccion].push(cruda.trimEnd());
    }

    const enlace = secciones.ENLACE.map((l) => l.trim()).find(Boolean) || "";
    leido = {
      // Las líneas en blanco de dentro del texto se respetan; las de los
      // bordes, no.
      texto: secciones.TEXTO.join("\n").trim(),
      boton: (secciones.BOTON.map((l) => l.trim()).find(Boolean) || "Ver en el mapa").slice(0, 20),
      // Solo un enlace de verdad. Con el texto de ejemplo, sin botón.
      enlace: /^https?:\/\/\S+$/i.test(enlace) ? enlace : "",
    };
  }
  return leido;
}

export function hayUbicacion() {
  return Boolean(leer().texto);
}

// { texto, boton, enlace }. "enlace" vacío = mandar solo el texto.
export function mensajeDeUbicacion() {
  return leer();
}

// Las formas de preguntar dónde está la tienda. Se compara sin tildes.
const PREGUNTA_UBICACION = new RegExp(
  [
    "\\bdonde\\s+(?:estan|esta|quedan?|se\\s+ubican?|los\\s+consigo|las\\s+consigo|puedo\\s+ir|los\\s+encuentro|la\\s+tienda|el\\s+local|es\\s+la\\s+tienda)",
    "\\bubicaci(?:o|ó)n\\b",
    "\\bubicad[oa]s?\\b",
    "\\bdirecci(?:o|ó)n\\b",
    "\\btienda\\s+fisica\\b",
    "\\blocal\\s+fisico\\b",
    "\\btienen\\s+(?:local|tienda)\\b",
    "\\bcomo\\s+llego\\b",
    "\\b(?:google\\s+)?maps\\b",
    "\\ben\\s+que\\s+parte\\s+(?:estan|quedan?)\\b",
  ].join("|"),
  "i"
);

// Lo que parece ubicación y NO lo es:
//   · "¿tienen tienda online?", "el link de la tienda" → es el catálogo.
//   · "te paso mi dirección", "¿hacen envíos a mi dirección?" → es SU
//     dirección, para un envío: eso es del asesor, no de la nuestra.
const NO_ES_LA_TIENDA =
  /\b(?:online|web|virtual|pagina|link|enlace|catalogo)\b|\bmi\s+direccion\b|\benvi\w*|\bdelivery\b|\bdomicilio\b|\bmrw\b|\bzoom\b|\btealca\b/;

export function preguntaPorUbicacion(texto) {
  const limpio = despejar(texto).join(" ");
  return PREGUNTA_UBICACION.test(limpio) && !NO_ES_LA_TIENDA.test(limpio);
}

// ¿El mensaje es SOLO eso? Todas las palabras tienen que ser de la pregunta
// o de las que la acompañan —igual que en catalogo.js—. En cuanto aparece
// otra —"Jordan", "precio", "negras"— hay algo más que contestar, y eso es
// trabajo del modelo.
const DE_LA_PREGUNTA = new Set([
  "donde", "estan", "esta", "queda", "quedan", "ubican", "ubica", "ubicacion",
  "ubicados", "ubicadas", "ubicado", "ubicada", "direccion", "tienda", "tiendas",
  "fisica", "fisicas", "local", "locales", "fisico", "como", "llego", "llegar",
  "google", "maps", "mapa", "parte", "consigo", "encuentro", "ir", "puedo",
  "exacta", "exactamente",
]);

const ACOMPANAN = new Set([
  "hola", "buenas", "buenos", "dias", "tardes", "noches", "saludos",
  "que", "cual", "tienen", "tiene", "tienes", "me", "te", "le", "lo", "los",
  "la", "las", "el", "un", "una", "de", "del", "y", "o", "en", "a", "para",
  "su", "sus", "mi", "es", "son", "se", "por", "favor", "porfa", "porfavor",
  "gracias", "amigo", "amiga", "hermano", "pana", "mandame", "pasame", "dame",
  "enviame", "manda", "pasa", "podrias", "puedes", "quisiera", "saber",
  "ustedes", "tu", "exactamente", "si", "ya", "ahora", "bro", "disculpa",
]);

export function soloPreguntaUbicacion(texto) {
  const palabras = despejar(texto);
  if (!palabras.length || palabras.length > 14) return false;
  if (!preguntaPorUbicacion(texto)) return false;
  return palabras.every((p) => DE_LA_PREGUNTA.has(p) || ACOMPANAN.has(p));
}

// La nota que se le pasa al modelo cuando la ubicación ya salió y el
// mensaje traía algo más.
export const NOTA_UBICACION_ENVIADA =
  "[LA UBICACIÓN YA SE LA MANDÉ en un mensaje aparte, con la dirección exacta y el botón " +
  "de Google Maps. NO la repitas ni la resumas: contesta solo lo demás que pregunta]";

function despejar(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}
