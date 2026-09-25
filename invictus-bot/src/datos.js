import listaCatalogo from "./prompts/catalogo.txt";

// LO QUE LA TIENDA SABE DE SÍ MISMA.
//
// Dónde está, a qué hora abre, si hace envíos, cómo se paga. Son las
// preguntas que más se repiten después del precio, y hasta hoy el bot no
// tenía NINGUNA: las mandaba todas al asesor, y la de horarios era peor —
// el prompt traía un marcador, {{TUS HORARIOS}}, que nadie rellenaba
// nunca, con un ejemplo que se lo mandaba al cliente tal cual.
//
// POR QUÉ ESTO ES CÓDIGO Y NO PROMPT. Son datos exactos: nueve métodos de
// pago, dos empresas de envío, unos horarios. Si los redacta el modelo,
// tarde o temprano se deja uno fuera o añade el que no es — y un método de
// pago inventado es un cliente que intenta pagar por donde no puede.
//
// El prompt SÍ los conoce, en corto (ver "DATOS DE LA TIENDA" en
// texto.txt), para cuando la pregunta viene mezclada con otra cosa:
// "¿tienen las Air Force y hacen envíos?". Ahí contesta el modelo las
// dos, y esto no se mete: solo salta cuando la pregunta va sola.

// Lo que hay que rellenar en wrangler.toml para que la ubicación salga
// completa. Sin ellos el bot contesta igual, pero sin foto y sin botón.
const SIN_PONER = /^$|CAMBIA-ESTO|PENDIENTE|PON_AQUI|ejemplo\.com/i;

function puesto(valor) {
  const texto = String(valor || "").trim();
  return texto && !SIN_PONER.test(texto) ? texto : "";
}

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

export const TASA =
  "💱 Recibimos a la tasa del Banco Central de Venezuela (BCV) 😊";

export const TRABAJO =
  "¡Gracias por tu interés! 😊\n" +
  "\n" +
  "Por ahora tenemos el personal completo. Cuando necesitemos gente lo " +
  "publicamos en las historias, así que mantente pendiente 👀";

// EL BOT NO PROMETE MANDAR LOS DATOS DE PAGO (25-sep-2026, decisión del
// dueño). Enumera los métodos y se aparta: pasar la cuenta, confirmar el
// monto y cerrar es trabajo de un asesor, y una promesa del bot que
// después cumple una persona a destiempo es un cliente esperando con el
// dinero en la mano.
//
// Quien pregunta esto está a un paso de pagar, así que index.js avisa al
// asesor por Slack en el mismo momento ("PREGUNTÓ CÓMO PAGAR"). El aviso
// NO depende de cómo esté redactada esta frase.
export const PAGOS =
  "💳 MÉTODOS DE PAGO DISPONIBLES\n" +
  "\n" +
  "🇻🇪 EN BOLÍVARES\n" +
  "🔹 Pago Móvil\n" +
  "🔹 Transferencia bancaria\n" +
  "🔹 Punto de venta\n" +
  "\n" +
  "🌎 INTERNACIONAL 💲\n" +
  "🔹 Zelle\n" +
  "🔹 PayPal\n" +
  "🔹 Zinli\n" +
  "🔹 Binance (USDT)\n" +
  "🔹 Mercantil Panamá\n" +
  "🔹 Banesco Panamá\n" +
  "\n" +
  "✅ Elige el que más te convenga 😊";

// La ubicación se arma con lo que haya en wrangler.toml: la dirección
// escrita, la foto del local y el enlace de Google Maps. Los tres se
// pueden dejar vacíos y el mensaje sigue saliendo, más corto.
// LA FOTO SALE ROTA CUANDO EL ENLACE NO ES LA IMAGEN.
//
// Instagram no abre el enlace en un navegador: se descarga el archivo él
// mismo, desde sus servidores y sin sesión. Así que solo sirve una
// dirección que devuelva LA IMAGEN, sin pantalla de por medio. Lo que la
// gente pega casi siempre —y sale roto— es:
//
//   · un enlace de "Compartir" de Google Drive (abre un visor, no la foto)
//   · Google Fotos (photos.app.goo.gl: es una página)
//   · una publicación de Instagram o Facebook
//   · algo que pide contraseña o está en "solo yo"
//
// Los de Drive se pueden arreglar solos: del enlace se saca el id del
// archivo y se arma la dirección que sí devuelve la imagen. Los demás no
// hay forma; se descartan, y entonces el mensaje sale SIN foto —pero con
// su dirección y su botón— en vez de salir con un cuadro roto.
const DRIVE = /drive\.google\.com\/(?:file\/d\/([\w-]{20,})|open\?id=([\w-]{20,})|uc\?[^ ]*id=([\w-]{20,}))/i;

const NO_ES_UNA_IMAGEN =
  /photos\.app\.goo\.gl|photos\.google\.com|instagram\.com|facebook\.com|fb\.watch|dropbox\.com\/scl|\/folders\//i;

export function fotoUtilizable(url) {
  const enlace = puesto(url);
  if (!enlace) return { foto: "", motivo: "" };

  const drive = enlace.match(DRIVE);
  if (drive) {
    const id = drive[1] || drive[2] || drive[3];
    return {
      foto: `https://drive.google.com/uc?export=view&id=${id}`,
      motivo: "",
      arreglada: true,
    };
  }

  if (NO_ES_UNA_IMAGEN.test(enlace)) {
    return {
      foto: "",
      motivo:
        "ese enlace abre una página, no la imagen. Instagram descarga el " +
        "archivo él mismo y no puede entrar a ver nada.",
    };
  }

  if (!/^https?:\/\//i.test(enlace)) {
    return { foto: "", motivo: "no es una direccion http." };
  }

  return { foto: enlace, motivo: "" };
}

export function ubicacionDe(env) {
  const direccion = puesto(env.DIRECCION);
  const { foto, motivo: porQueNoLaFoto } = fotoUtilizable(env.FOTO_LOCAL);

  if (porQueNoLaFoto) {
    console.error(`FOTO_LOCAL no sirve: ${porQueNoLaFoto} Mando la ubicación sin foto.`);
  }

  // EL BOTÓN NO PUEDE DEPENDER DE QUE ALGUIEN PEGUE UN ENLACE.
  //
  // Lo suyo es poner MAPS_URL, que apunta al local exacto con su ficha en
  // Google. Pero si no está —y el dueño tiene una tienda que atender, no
  // un formulario que rellenar— se arma un enlace de búsqueda con la
  // dirección escrita. Google abre el mapa igual, buscándola.
  //
  // Así el cliente SIEMPRE recibe un botón, que es lo que pidió el dueño:
  // "que quede como un botón, como estaba con ManyChat".
  const maps =
    puesto(env.MAPS_URL) ||
    (direccion
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccion)}`
      : "");

  const texto = direccion
    ? `📍 Aquí nos encuentras:\n\n${direccion}\n\n¡Te esperamos! 😊`
    : "📍 Un asesor te pasa la dirección exacta en un momento 😊";

  // CABE TODO EN UN SOLO MENSAJE cuando la dirección entra en el título de
  // la tarjeta (80 caracteres, que es lo que deja Instagram). Solo cuando
  // no cabe hacen falta dos: la dirección en texto y la tarjeta detrás.
  const enUnMensaje = !foto || [...direccion].length <= 80;

  return { texto, maps, foto, direccion, enUnMensaje, completa: Boolean(direccion) };
}

/* ── Quién pregunta qué ───────────────────────────────────────────
   Una expresión por tema. Van sueltas y no en una sola: así se lee cuál
   falló cuando algo no se reconoce, y se amplía sin tocar las demás.
   ───────────────────────────────────────────────────────────────── */

const UBICACION =
  /\b(ubicaci[oó]n|ubicados?|direcci[oó]n|d[oó]nde\s+(est[aá]n|queda|los?\s+consigo|puedo\s+ir)|c[oó]mo\s+llego|tienda\s+f[ií]sica|local\s+f[ií]sico|sucursal|maps)\b/i;

const HORARIO =
  /\b(horarios?|a\s+qu[eé]\s+hora|hasta\s+qu[eé]\s+hora|desde\s+qu[eé]\s+hora|abren|cierran|abiertos?|est[aá]n\s+abierto)\b/i;

const ENVIO =
  /\b(env[ií]os?|env[ií]an|env[ií]as|enviar|zoom|mrw|encomienda|domesa)\b/i;

const DELIVERY_PIDE = /\b(delivery|domicilio|a\s+mi\s+casa|reparto|llevan\s+a)\b/i;

const TASA_PIDE =
  /\b(tasa|bcv|banco\s+central|a\s+c[oó]mo\s+(est[aá]|tienen|toman)\s+el\s+d[oó]lar|cambio\s+del\s+d[oó]lar)\b/i;

const TRABAJO_PIDE =
  /\b(trabajo|empleo|vacantes?|curr[ií]cul[uo]m|contratan(do)?|necesitan\s+personal|solicito\s+empleo|busco\s+trabajo|est[aá]n\s+empleando)\b/i;

const PAGOS_PIDE =
  /\b(m[eé]todos?\s+de\s+pago|formas?\s+de\s+pago|c[oó]mo\s+(puedo\s+)?pag(o|ar)|qu[eé]\s+pagos?\s+aceptan|aceptan\s+(zelle|paypal|binance|zinli|pago\s+m[oó]vil|punto)|zelle|paypal|zinli|binance|usdt|pago\s+m[oó]vil|punto\s+de\s+venta|transferencia)\b/i;

// Las cuotas NO son esto: Cashea y Krece tienen su propia respuesta, con
// sus porcentajes. Si el mensaje las nombra, esto se aparta.
const ES_DE_CUOTAS =
  /\b(cashea|casea|cashe|cachea|krece|crece|kreze|krese|cuotas?|financiamiento|cr[ée]dito|a\s+plazos?)\b/i;

// Devuelve el tema que pregunta, o "" si no es ninguno de estos.
//
// El orden importa donde dos temas se pisan: "¿hacen delivery a mi casa o
// tengo que ir a la tienda?" habla de delivery, no de ubicación.
export function queDatoPide(texto) {
  const limpio = String(texto || "");
  if (!limpio.trim()) return "";

  if (DELIVERY_PIDE.test(limpio)) return "delivery";
  if (ENVIO.test(limpio)) return "envios";
  if (UBICACION.test(limpio)) return "ubicacion";
  if (HORARIO.test(limpio)) return "horarios";
  if (TASA_PIDE.test(limpio)) return "tasa";
  if (TRABAJO_PIDE.test(limpio)) return "trabajo";
  if (PAGOS_PIDE.test(limpio) && !ES_DE_CUOTAS.test(limpio)) return "pagos";

  return "";
}

export const RESPUESTAS = {
  horarios: HORARIOS,
  envios: ENVIOS,
  delivery: DELIVERY,
  tasa: TASA,
  trabajo: TRABAJO,
  pagos: PAGOS,
};


/* ── ¿El mensaje nombra algún calzado del catálogo? ────────────────
   Se usa para una sola decisión, y equivocarse cuesta una venta: si la
   pregunta viene MEZCLADA con un producto —"¿tienen las Air Force y
   hacen envíos?"— el dato de la tienda NO puede quedarse con el turno.
   Ahí contesta el modelo las dos cosas y salen las fichas.

   La lista sale de prompts/catalogo.txt, que es donde ya vive (ia.js la
   mete en el prompt al arrancar). Se mira el título entero dentro del
   mensaje y también sus primeras palabras: el cliente escribe "las Air
   Force" y en Shopify están como "Air Force One blancas".
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
    .replace(/[\u0300-\u036f]/g, "")
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
