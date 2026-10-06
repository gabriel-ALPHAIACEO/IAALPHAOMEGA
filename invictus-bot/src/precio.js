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

// CUANDO PREGUNTA EL PRECIO, SE LE DICE (6-oct-2026, informe de errores).
//
// QUÉ PASÓ. En el mes, 81 de las 197 respuestas marcadas 🔴 fueron un
// cliente preguntando "¿Precio?" —casi siempre tras una historia o una
// foto— y el bot contestando "¡Ese mismo lo manejamos! 👟 Mira 👇" con la
// ficha. El precio iba debajo de la foto, pero nadie se lo dijo, y muchos
// no lo ven ("No sé ve el precio").
//
// AHORA. Si pregunta el precio y van fichas:
//   · de 1 a 3 → se le escribe el precio de cada una, tal cual la ficha
//     (lo pone el código, no la IA: no hay forma de que se lo invente);
//   · más de 3 → "Los precios están en cada foto 👇".
// Si la respuesta ya dice un precio o dónde está, no se toca.
const PIDE_PRECIO = /\b(?:precios?|cu[aá]nto\s+(?:cuesta|cuestan|sale|salen|vale|valen|es)|cu[aá]nto|costo|valor)\b/i;
const YA_LO_DICE = /\$\s*\d|\d\s*\$|\d\s*(?:usd|d[oó]lares)\b|precios?\s+(?:est[aá]n?|va[n]?|salen?|aparecen?)|con\s+sus?\s+precios?\s+(?:debajo|abajo)/i;
const MAXIMO_PRECIOS_ESCRITOS = 3;

function nombreCorto(titulo) {
  return String(titulo || "")
    .replace(/\s+(?:dama|caballero|ni[ñn][oa]s?|unisex)(?:\s*\/\s*(?:dama|caballero))?\s*$/i, "")
    .trim()
    .slice(0, 40);
}

export function contestaElPrecio(respuesta, { texto = "", fichas = [], yaLasVio = false } = {}) {
  const r = String(respuesta || "").trim();
  if (!PIDE_PRECIO.test(String(texto || "")) || YA_LO_DICE.test(r)) return { corregido: false, respuesta: r };
  const conPrecio = (fichas || []).filter((p) => p?.precio);
  let agregado = "";
  if (conPrecio.length && conPrecio.length === fichas.length && fichas.length <= MAXIMO_PRECIOS_ESCRITOS) {
    agregado =
      fichas.length === 1
        ? `Cuesta ${conPrecio[0].precio} 💵`
        : conPrecio.map((p) => `💵 ${nombreCorto(p.titulo)}: ${p.precio}`).join("\n");
  } else if (fichas.length) {
    agregado = r.includes("👇") ? "Los precios están en cada foto 😊" : PRECIOS_EN_LAS_FOTOS;
  } else if (yaLasVio) {
    agregado = PRECIOS_EN_LAS_FOTOS_YA_ENVIADAS;
  }
  if (!agregado) return { corregido: false, respuesta: r };
  console.log(`PRECIO: preguntó el precio; se lo digo: ${agregado.replace(/\n/g, " · ")}`);
  return { corregido: true, respuesta: r ? `${r}\n${agregado}` : agregado };
}
