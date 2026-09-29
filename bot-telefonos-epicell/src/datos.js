// LOS DATOS DE LA TIENDA: SE CONTESTAN CON CÓDIGO, NO CON EL MODELO.
//
// POR QUÉ (29-sep-2026, revisión de código pedida por el dueño: "está
// respondiendo malísimo"). Pasándole al bot treinta preguntas reales, las
// que salieron peor no fueron de productos: fueron de la TIENDA.
//
//   "¿a qué hora abren?"  -> "Abrimos de 8 a 5"          (son 9am a 7pm)
//   "¿hacen envíos?"      -> "Sí, a todo el país"         (nadie lo dijo)
//
// El modelo no tiene esos datos, y un modelo sin un dato no se calla: lo
// rellena con lo que le suena más probable. Un horario inventado es un
// cliente en la puerta de un local cerrado; un envío prometido que no
// existe es una venta que se cae después de pagar.
//
// Es lo mismo que se hizo en el bot de Invictus (datos.js), y por la misma
// razón. La diferencia: ahí se conocían todos los datos; aquí solo el
// horario. Así que cada dato se lee de wrangler.toml y, si está VACÍO, la
// respuesta es que un asesor lo confirma — nunca una suposición. Cuando el
// dueño rellene un dato, el bot lo empieza a decir solo, sin tocar código.

/* ── Quién pregunta qué ───────────────────────────────────────────── */

const UBICACION =
  /\b(ubicaci[oó]n|ubicados?|direcci[oó]n|d[oó]nde\s+(est[aá]n|quedan?|los?\s+consigo|puedo\s+ir)|c[oó]mo\s+llego|tienda\s+f[ií]sica|local\s+f[ií]sico|sucursal|maps)\b/i;

const HORARIO =
  /\b(horarios?|a\s+qu[eé]\s+hora|hasta\s+qu[eé]\s+hora|desde\s+qu[eé]\s+hora|abren|cierran|abiertos?|est[aá]n\s+abiertos?|atienden\s+(hoy|el|los))\b/i;

const ENVIO = /\b(env[ií]os?|env[ií]an|env[ií]as|enviar|zoom|mrw|encomienda|domesa|tealca)\b/i;

const DELIVERY = /\b(delivery|domicilio|a\s+mi\s+casa|reparto|llevan\s+a)\b/i;

const TASA =
  /\b(tasa|bcv|banco\s+central|a\s+c[oó]mo\s+(est[aá]|tienen|toman)\s+el\s+d[oó]lar|cambio\s+del\s+d[oó]lar)\b/i;

const TRABAJO =
  /\b(empleo|vacantes?|curr[ií]cul[uo]m|contratan(do)?|necesitan\s+personal|solicito\s+empleo|busco\s+trabajo|est[aá]n\s+empleando)\b/i;

const PAGOS =
  /\b(m[eé]todos?\s+de\s+pago|formas?\s+de\s+pago|c[oó]mo\s+(puedo\s+)?pag(o|ar)|qu[eé]\s+pagos?\s+aceptan|aceptan\s+(zelle|paypal|binance|zinli|pago\s+m[oó]vil|punto)|zelle|paypal|zinli|binance|usdt|pago\s+m[oó]vil|punto\s+de\s+venta|transferencia)\b/i;

// Cashea y Krece NO son esto: tienen su propia respuesta, con sus
// porcentajes (ver PAGOS_CASHEA en index.js). Si el mensaje las nombra, se
// aparta.
const ES_DE_CUOTAS =
  /\b(cashea|casea|cashe|cachea|krece|crece|kreze|krese|cuotas?|financiamiento|cr[ée]dito|a\s+plazos?)\b/i;

// "Ya te hice la transferencia", "te mando el comprobante del Zelle": ese
// cliente YA PAGÓ. Mandarle la lista de formas de pago es no haberle
// leído; eso sigue el camino normal, que lo pasa al asesor. (Al final no
// va \b: detrás de una "é" no funciona, porque para JS la é no es letra.)
const YA_PAGO =
  /\b(ya\s+(te\s+|les?\s+)?(hice|realic[eé]|mand[eé]|envi[eé]|pagu[eé]|transfer[ií]|deposit[eé])|comprobante|capture|captura|referencia\s+(del?|de\s+la)?\s*pago|te\s+(pagu[eé]|transfer[ií]))(?![a-záéíóúñ])/i;

// El tema que pregunta, o "" si no es ninguno. El orden importa donde dos
// se pisan: "¿hacen delivery o tengo que ir a la tienda?" es de delivery.
export function queDatoPide(texto) {
  const limpio = String(texto || "");
  if (!limpio.trim()) return "";

  if (DELIVERY.test(limpio)) return "delivery";
  if (ENVIO.test(limpio)) return "envios";
  if (UBICACION.test(limpio)) return "ubicacion";
  if (HORARIO.test(limpio)) return "horarios";
  if (TASA.test(limpio)) return "tasa";
  if (TRABAJO.test(limpio)) return "trabajo";
  if (PAGOS.test(limpio) && !ES_DE_CUOTAS.test(limpio) && !YA_PAGO.test(limpio)) return "pagos";

  return "";
}

/* ── Qué se contesta ──────────────────────────────────────────────── */

// Un dato "sin poner": vacío, o con el relleno de la plantilla.
const SIN_PONER = /^$|CAMBIA-ESTO|PENDIENTE|PON_AQUI|ejemplo\.com/i;

function puesto(valor) {
  const limpio = String(valor || "").trim();
  return SIN_PONER.test(limpio) ? "" : limpio;
}

// Cómo se dice que ese dato lo confirma una persona. Uno por tema, para que
// suene a que se entendió la pregunta y no a una respuesta de relleno.
const LO_CONFIRMA_UN_ASESOR = {
  ubicacion: "La dirección exacta te la pasa un asesor en un momento 😊 ¿Te ayudo con algún equipo mientras?",
  horarios: "El horario te lo confirma un asesor en un momento 😊",
  envios: "Los envíos te los confirma un asesor en un momento 😊 ¿Qué equipo te interesa?",
  delivery: "El delivery te lo confirma un asesor en un momento 😊 ¿Qué equipo te interesa?",
  tasa: "La tasa del día te la confirma un asesor en un momento 😊",
  trabajo: "Eso te lo responde el equipo de la tienda en un momento 😊 ¡Gracias por tu interés!",
  pagos: "Las formas de pago te las confirma un asesor en un momento 😊 Y si quieres a cuotas, tenemos Cashea y Krece 🙌",
};

// Devuelve { texto, alAsesor }. alAsesor dice si hay que avisar a una
// persona: lo hay cuando el dato no está cargado y se le prometió que
// alguien se lo confirma.
export function respuestaDeDato(tema, env = {}) {
  if (tema === "ubicacion") {
    const direccion = puesto(env.DIRECCION);
    const mapa = puesto(env.MAPS_URL);

    if (!direccion) return { texto: LO_CONFIRMA_UN_ASESOR.ubicacion, alAsesor: true };

    return {
      texto: `📍 Estamos en ${direccion}` + (mapa ? `\n\nAquí te dejo cómo llegar 👇\n${mapa}` : ""),
      alAsesor: false,
    };
  }

  const variable = {
    horarios: "HORARIOS",
    envios: "ENVIOS",
    delivery: "DELIVERY",
    tasa: "TASA",
    trabajo: "TRABAJO",
    pagos: "METODOS_PAGO",
  }[tema];

  const dato = variable ? puesto(env[variable]) : "";

  // En wrangler.toml no se pueden escribir saltos de línea dentro de un
  // valor, así que se escribe "\n" y aquí se convierte.
  if (dato) return { texto: dato.replace(/\\n/g, "\n"), alAsesor: false };

  return { texto: LO_CONFIRMA_UN_ASESOR[tema] || "", alAsesor: true };
}
