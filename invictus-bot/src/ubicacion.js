// "¿DÓNDE ESTÁN?": LA DIRECCIÓN, TAL CUAL, CON FOTO Y BOTÓN DE GOOGLE MAPS.
//
// QUÉ SE PEDÍA (30-sep-2026). Lo mismo que hacía la automatización de
// ManyChat "Ubicación MAPS": el texto exacto de la dirección y un botón
// "MAPS/GOOGLE" que abre el mapa. Y con la foto del local, si la hay.
//
// DE DÓNDE SALE: de wrangler.toml, [vars] — como se armó el 25-sep:
//
//   DIRECCION   el texto exacto que lee el cliente (tal cual, sin retoques)
//   MAPS_URL    el enlace de Google Maps (Compartir → Copiar vínculo)
//   FOTO_LOCAL  el enlace http de UNA IMAGEN del local (opcional)
//
// Esto NO pasa por el modelo. Cuando el mensaje es SOLO la pregunta de la
// ubicación, ni se llama a OpenAI (cero tokens). Cuando además pide otra
// cosa —"¿dónde están y tienen Jordan?"— se manda la ubicación y el resto
// sigue al modelo como siempre, avisado de que la dirección ya salió.

// Lo que dice el botón. Instagram corta a 20 letras.
export const BOTON_MAPS = "MAPS/GOOGLE";

// Lo que se deja en wrangler.toml cuando todavía no se sabe el dato.
const SIN_PONER = /^$|CAMBIA-ESTO|PENDIENTE|PON_AQUI|PEGA_AQUI|ejemplo\.com/i;

function puesto(valor) {
  const texto = String(valor || "").trim();
  return texto && !SIN_PONER.test(texto) ? texto : "";
}

// LA FOTO SALE ROTA CUANDO EL ENLACE NO ES LA IMAGEN (25-sep-2026).
//
// Instagram no abre el enlace en un navegador: se descarga el archivo él
// mismo, desde sus servidores y sin sesión. Así que solo sirve una
// dirección que devuelva LA IMAGEN. Lo que la gente pega casi siempre —y
// sale roto— es un "Compartir" de Google Drive, Google Fotos, una
// publicación de Instagram o Facebook, o un enlace de Google Maps.
//
// Los de Drive se arreglan solos: del enlace se saca el id del archivo y se
// arma la dirección que sí devuelve la imagen. Los demás se descartan, y el
// mensaje sale SIN foto —pero con su dirección y su botón— en vez de salir
// con un cuadro roto.
const DRIVE = /drive\.google\.com\/(?:file\/d\/([\w-]{20,})|open\?id=([\w-]{20,})|uc\?[^ ]*id=([\w-]{20,}))/i;

const NO_ES_UNA_IMAGEN =
  /photos\.app\.goo\.gl|photos\.google\.com|instagram\.com|facebook\.com|fb\.watch|dropbox\.com\/scl|\/folders\/|maps\.app\.goo\.gl|google\.[a-z.]+\/maps|goo\.gl\/maps/i;

export function fotoUtilizable(url) {
  const enlace = puesto(url);
  if (!enlace) return { foto: "", motivo: "" };

  const drive = enlace.match(DRIVE);
  if (drive) {
    const id = drive[1] || drive[2] || drive[3];
    return { foto: `https://drive.google.com/uc?export=view&id=${id}`, motivo: "", arreglada: true };
  }

  if (NO_ES_UNA_IMAGEN.test(enlace)) {
    return {
      foto: "",
      motivo:
        "ese enlace abre una página (o un mapa), no la imagen. Instagram descarga el " +
        "archivo él mismo y no puede entrar a ver nada.",
    };
  }

  if (!/^https?:\/\//i.test(enlace)) return { foto: "", motivo: "no es una dirección http." };

  return { foto: enlace, motivo: "" };
}

// { texto, boton, enlace, foto }. Sin enlace, sale el texto solo; sin foto,
// texto y botón en un mensaje.
export function mensajeDeUbicacion(env = {}) {
  let texto = puesto(env.DIRECCION);
  let enlace = puesto(env.MAPS_URL);

  // LOS DATOS PEGADOS EN LA CASILLA EQUIVOCADA SE ACOMODAN SOLOS. En el
  // wrangler.toml del 30-sep el enlace de Maps estaba en DIRECCION (y en
  // FOTO_LOCAL), y MAPS_URL decía "PENDIENTE". Un enlace en DIRECCION es
  // el botón, no el texto: se usa como tal y no se le manda al cliente
  // una dirección que es una URL.
  if (/^https?:\/\/\S+$/i.test(texto)) {
    if (!enlace) enlace = texto;
    texto = "";
  }

  if (!/^https?:\/\/\S+$/i.test(enlace)) enlace = "";

  const { foto, motivo } = fotoUtilizable(env.FOTO_LOCAL);
  if (motivo) console.error(`FOTO_LOCAL no sirve: ${motivo} Mando la ubicación sin foto.`);

  return { texto, boton: BOTON_MAPS, enlace, foto };
}

export function hayUbicacion(env = {}) {
  return Boolean(mensajeDeUbicacion(env).texto);
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
