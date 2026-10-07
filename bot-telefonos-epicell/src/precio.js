// EL PRECIO YA ESTÁ EN LA FOTO: NO SE PREGUNTA (2-oct-2026).
//
// QUÉ PASÓ. El cliente preguntaba "¿tienen Retro 4?", le llegaban las
// fichas —cada una con su precio— y la IA cerraba con "¿Quieres saber el
// precio?". El dueño: "si ya le pregunté si tienen X calzado, en las fichas
// sale el precio; en vez de preguntar, debe explicar que los precios están
// en las fotos que le envió. No debe preguntar".
//
// El prompt ya lo dice (texto.txt, PRECIOS). Esto es la red por debajo:
// cuando van fichas (o el cliente ya las vio), la frase que le ofrece o le
// pregunta por el precio se quita y, en su lugar, se le dice dónde está.
//
// No se toca "¿De cuál modelo quieres saber el precio?": ahí la IA pregunta
// QUÉ zapato, no si quiere el precio.

// Le ofrece o le pregunta si quiere el precio: "¿quieres saber el precio?",
// "¿te paso los precios?", "¿te gustaría saber cuánto cuestan?".
const PREGUNTA_EL_PRECIO =
  /\b(?:quieres|quieren|quisieras|deseas|desea|necesitas|te\s+gustar[ií]a|le\s+gustar[ií]a|te\s+interesa|te\s+(?:paso|digo|doy|mando|env[ií]o|indico|comparto))\b/i;

const HABLA_DE_PRECIO = /precio|cu[aá]nto\s+(?:cuesta|cuestan|sale|salen|valen?)|costo/i;
const PREGUNTA_CUAL = /\b(?:cu[aá]l|qu[eé]\s+modelo|de\s+cu[aá]l)\b/i;

export const PRECIOS_EN_LAS_FOTOS = "Los precios están en cada foto 👇";
export const PRECIOS_EN_LAS_FOTOS_YA_ENVIADAS = "Los precios están en las fotos que te mandé 👆";

function frases(texto) {
  return String(texto || "").split(/(?<=[.!?😊😅🙌👇👆👟🙏])\s+/);
}

export function preguntaPorElPrecio(frase) {
  const f = String(frase || "");
  if (!/\?/.test(f) || !HABLA_DE_PRECIO.test(f) || PREGUNTA_CUAL.test(f)) return false;
  return PREGUNTA_EL_PRECIO.test(f);
}

// hayFichas: van fichas con este mensaje (los precios van DEBAJO, 👇).
// yaLasVio: no van fichas ahora, pero ya las vio (los precios están ARRIBA).
export function revisarPrecio(respuesta, { hayFichas = false, yaLasVio = false } = {}) {
  const texto = String(respuesta || "");
  if (!texto.trim() || (!hayFichas && !yaLasVio)) return { corregido: false, respuesta: texto };

  const motivos = [];
  const quedan = frases(texto).filter((frase) => {
    if (preguntaPorElPrecio(frase)) {
      motivos.push(`preguntó por el precio ("${frase.slice(0, 50)}")`);
      return false;
    }
    return true;
  });
  if (!motivos.length) return { corregido: false, respuesta: texto };

  let explicacion = hayFichas ? PRECIOS_EN_LAS_FOTOS : PRECIOS_EN_LAS_FOTOS_YA_ENVIADAS;
  let limpia = quedan.join(" ").trim();
  // Una sola flecha por mensaje: "Mira estas 👇 Los precios están en cada
  // foto 👇" se ve torpe.
  if (hayFichas && limpia.includes("👇")) explicacion = explicacion.replace("👇", "😊");
  // Si lo que queda ya dice dónde están los precios, no se repite.
  if (!/precios?\s+(?:est[aá]n|van|salen|aparecen)|con\s+sus?\s+precios?/i.test(limpia)) {
    limpia = limpia ? `${limpia} ${explicacion}` : explicacion;
  }

  console.log(`PRECIO: la IA ${motivos.join(" y ")} con las fichas a la vista. Lo cambio por "${explicacion}".`);
  return { corregido: true, respuesta: limpia, motivos };
}

// PREGUNTÓ EL PRECIO: SE LE ESCRIBE (6-oct-2026, informe de errores).
//
// "Buenas tardes, ¿qué precio sale el Samsung A57?" recibía "Aquí tienes
// el precio del Samsung A57: ¿Cuál de estos te interesa más?" y las fichas.
// El precio estaba debajo de cada foto, pero a una pregunta directa se le
// contesta directo: con 1 a 3 fichas, su precio va escrito en el mensaje
// (el MISMO que la ficha: un solo precio, el que toca). Con más, se le dice
// que está en cada foto. Si la respuesta ya dice una cifra, no se toca.
// (7-oct-2026) Con las erratas de siempre: "prexio", "presio", "precion".
const PIDE_PRECIO = /\b(?:pre[cxs]i[oa]n?s?|cu[aá]nto\s+(?:cuesta|cuestan|sale|salen|vale|valen|es)|costo|valor)\b/i;
const YA_DICE_PRECIO = /\$\s*\d|\d\s*\$|\d\s*(?:usd|d[oó]lares)\b|precios?\s+(?:est[aá]n?|va[n]?|salen?|aparecen?)/i;
const MAXIMO_ESCRITOS = 3;

export function contestaElPrecio(respuesta, { texto = "", fichas = [] } = {}) {
  const r = String(respuesta || "").trim();
  if (!PIDE_PRECIO.test(String(texto || "")) || !fichas.length || YA_DICE_PRECIO.test(r)) {
    return { corregido: false, respuesta: r };
  }
  const conPrecio = fichas.filter((f) => /\d/.test(String(f.precio || "")));
  if (!conPrecio.length) return { corregido: false, respuesta: r };

  let agregado;
  if (fichas.length <= MAXIMO_ESCRITOS) {
    agregado = conPrecio.map((f) => `💵 ${f.titulo}: ${f.precio}`).join("\n");
  } else {
    agregado = r.includes("👇") ? PRECIOS_EN_LAS_FOTOS.replace("👇", "😊") : PRECIOS_EN_LAS_FOTOS;
  }
  // "Aquí tienes el precio del Samsung A57:" — los dos puntos ya anuncian
  // lo que viene: se pone justo detrás.
  const base = r.replace(/:\s*(?=[¿¡]|$)/, ":\n" + agregado + "\n").trim();
  const final = base.includes(agregado) ? base : `${r}\n${agregado}`;
  console.log(`PRECIO: preguntó el precio y no estaba escrito; se le pone el de ${conPrecio.length} ficha(s)`);
  return { corregido: true, respuesta: final.replace(/\n{3,}/g, "\n\n") };
}
