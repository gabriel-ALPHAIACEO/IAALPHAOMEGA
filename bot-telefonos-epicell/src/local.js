// LA UBICACIÓN DE EPICCELL, CON SU PROPIO DISEÑO (5-oct-2026).
//
// QUÉ SE PEDÍA. El dueño: "a EPICCELL vamos a añadirle la dirección con un
// botón hacia Maps". Y: "no usemos lo mismo; la ubicación de cada una es
// distinta". Así que esto es SOLO de EPICCELL: su dirección, su mapa, su
// forma de mostrarse. No es el ubicacion.js de Invictus ni de El Emperador.
//
// CÓMO SE VE (como lo hacía ManyChat): una tarjeta con LA FOTO del local,
// el texto debajo y UN botón que abre Google Maps.
//
//   [ foto del local ]
//   📍 Centro Comercial Mercado La Isla · Local L-04
//   Isla de Margarita, entre Circunvalación y Terranova
//   [ 🗺️ Cómo llegar ]
//
// Sin foto (o con un enlace que no es una imagen), sale el texto completo
// con el mismo botón: nunca una tarjeta con un cuadro roto.
//
// DE DÓNDE SALE: wrangler.toml, [vars]. Cambiar algo es tocar solo eso:
//   LOCAL_TEXTO      el texto completo (cuando no hay foto), tal cual
//   LOCAL_TITULO     la línea grande de la tarjeta (80 letras como mucho)
//   LOCAL_SUBTITULO  la de abajo (80 letras como mucho)
//   LOCAL_FOTO       el enlace de LA IMAGEN del local (Drive o .jpg/.png)
//   LOCAL_MAPA       el enlace de Google Maps para llegar
//
// No pasa por la IA: si el mensaje es SOLO la pregunta, ni se la llama. Si
// además pide otra cosa ("¿dónde están y tienen el A57?"), la ubicación
// sale primero y el resto sigue como siempre.

const SIN_PONER = /^$|CAMBIA-ESTO|PENDIENTE|PON_AQUI|PEGA_AQUI|ejemplo\.com/i;

function puesto(valor) {
  const texto = String(valor ?? "").trim();
  return texto && !SIN_PONER.test(texto) ? texto : "";
}

function enlace(valor) {
  const v = puesto(valor);
  return /^https:\/\/\S+$/i.test(v) ? v : "";
}

// El botón: Instagram corta a 20 letras, este cabe.
export const BOTON_MAPA = "🗺️ Cómo llegar";

// LA FOTO TIENE QUE SER LA IMAGEN, no una página. Instagram se descarga el
// archivo él mismo: un enlace de Google Maps, Google Fotos o Instagram abre
// una página y sale roto. Los de Drive se arreglan solos (se arma la
// dirección que devuelve la imagen).
const DRIVE = /drive\.google\.com\/(?:file\/d\/([\w-]{20,})|open\?id=([\w-]{20,})|uc\?[^ ]*id=([\w-]{20,}))/i;
const NO_ES_IMAGEN = /maps\.app\.goo\.gl|goo\.gl\/maps|google\.[a-z.]+\/maps|photos\.app\.goo\.gl|photos\.google\.com|instagram\.com|facebook\.com|\/folders\//i;

export function fotoDelLocal(valor) {
  const v = puesto(valor);
  if (!v) return { foto: "", motivo: "" };
  const d = v.match(DRIVE);
  if (d) return { foto: `https://drive.google.com/uc?export=view&id=${d[1] || d[2] || d[3]}`, motivo: "" };
  if (NO_ES_IMAGEN.test(v)) return { foto: "", motivo: "ese enlace abre una página (un mapa o una galería), no la imagen" };
  if (!/^https:\/\//i.test(v)) return { foto: "", motivo: "no es un enlace https" };
  return { foto: v, motivo: "" };
}

// { texto, titulo, subtitulo, foto, mapa }. Sin texto, no hay ubicación.
export function elLocal(env = {}) {
  const texto = puesto(env.LOCAL_TEXTO).replace(/\\n/g, "\n");
  const lineas = texto.split("\n").map((l) => l.trim()).filter(Boolean);
  const { foto, motivo } = fotoDelLocal(env.LOCAL_FOTO);
  if (motivo) console.error(`LOCAL_FOTO no sirve: ${motivo}. Mando la ubicación sin foto.`);
  return {
    texto,
    titulo: (puesto(env.LOCAL_TITULO) || lineas[0] || "").slice(0, 80),
    subtitulo: (puesto(env.LOCAL_SUBTITULO) || lineas.slice(1).join(" · ")).slice(0, 80),
    foto,
    mapa: enlace(env.LOCAL_MAPA),
  };
}

export function hayLocal(env = {}) {
  return Boolean(elLocal(env).texto);
}

const SIN_TILDES = (t) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

// Las formas de preguntar dónde está la tienda (sin tildes, en minúsculas).
const PREGUNTA = new RegExp(
  [
    "\\bdonde\\s+(?:estan|esta|queda|quedan|es|son|se\\s+encuentran?|los\\s+consigo|los\\s+ubico|puedo\\s+ir|tienen\\s+(?:la\\s+)?tienda|es\\s+la\\s+tienda)",
    "\\b(?:estan|esta)\\s+ubicad[oa]s?",
    "\\bubicacion\\b",
    "\\bubicados?\\b",
    "\\bdireccion\\b",
    "\\bcomo\\s+(?:llego|hago\\s+para\\s+llegar|llegar)",
    "\\b(?:tienen|hay)\\s+(?:tienda|local)(?:\\s+fisic[ao])?",
    "\\btienda\\s+fisica\\b",
    "\\bpasame\\s+(?:la\\s+)?(?:ubicacion|direccion)",
    "\\ben\\s+que\\s+parte\\s+(?:estan|quedan)",
    "\\bmapa\\b",
  ].join("|")
);

export function preguntaPorElLocal(texto) {
  return PREGUNTA.test(SIN_TILDES(texto));
}

// ¿Pregunta SOLO eso? Se quita lo que es de la ubicación y los saludos;
// si no queda nada con sustancia, era solo la pregunta.
export function soloPreguntaPorElLocal(texto) {
  if (!preguntaPorElLocal(texto)) return false;
  const resto = SIN_TILDES(texto)
    .replace(new RegExp(PREGUNTA.source, "g"), " ")
    .replace(/\b(hola|buenas?|buenos\s+dias|buenas\s+tardes|buenas\s+noches|amig[oa]|por\s+favor|porfa|gracias|disculpa|una\s+pregunta|y|la|el|los|las|de|del|su|sus|me|pasas|pasame|dime|donde|tienda|local|ustedes|exactamente|ahi|alla|ahora)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return resto.length === 0;
}

// Para la IA, cuando el mensaje traía algo más: que no la repita.
export const NOTA_LOCAL_ENVIADA =
  "[YA LE MANDÉ LA UBICACIÓN DE LA TIENDA con su botón de Maps: no la repitas ni digas que la confirma un asesor. Contesta solo lo demás.]";
