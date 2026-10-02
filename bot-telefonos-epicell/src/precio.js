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
