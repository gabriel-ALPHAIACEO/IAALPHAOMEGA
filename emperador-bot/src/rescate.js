// CUANDO EL CLIENTE DICE "NO ES ESE": DEJAR DE ADIVINAR Y LLAMAR A UNA PERSONA.
//
// EL CASO QUE LO PIDIÓ (30-sep-2026, cliente perdido). Respondió a una
// historia con unas Nike P6000 y preguntó el precio. El bot:
//
//   1. le mandó "Mira las Nike que tengo ¿Es alguna de estas?"
//   2. el cliente: "No ninguna de las q me estás mostrando"
//      → el bot le mandó unas Nike Trail, que no tenían nada que ver
//   3. el cliente volvió a la historia: "Estoy preguntando por este ☝️"
//      → el bot le repitió lo mismo del paso 1
//   4. el cliente: "Olvídalo, será que estás ciego"
//      → el bot le preguntó "¿qué modelo específico de Nike te gustaría ver?"
//
// A partir del paso 2 el bot ya había fallado, y cada mensaje más lo
// empeoraba: el cliente tenía el zapato delante, lo había señalado dos veces,
// y la máquina seguía adivinando. Lo que había que hacer en el paso 2 —lo
// que habría hecho cualquier vendedor— es: "Disculpa, ya te atiende una
// persona", y que una persona lo atendiera.
//
// ESTO NO ARREGLA EL RECONOCIMIENTO: eso es cotejo.js. Esto es la red para
// cuando el reconocimiento falla, que va a seguir pasando alguna vez. Un
// fallo de reconocimiento con rescate es un cliente atendido por un asesor;
// sin rescate, es un cliente perdido.

// "No es ese", "ninguna de esas", "no se parece". Se compara sin tildes.
const RECHAZA_LO_MOSTRADO =
  /\b(?:no\s+es\s+(?:ese|esa|este|esta|el\s+mismo|la\s+misma|igual|ninguno|ninguna)|no\s+son\s+(?:esos|esas|estos|estas|iguales|los\s+mismos|las\s+mismas)|no\s+ningun[oa]|ningun[oa]\s+(?:es|son|de\s+(?:esos|esas|estos|estas|los|las))|no\s+se\s+parece|no\s+se\s+parecen|(?:ese|esa|este|esta)\s+no\s+es|no\s+es\s+el\s+de\s+la\s+(?:foto|historia)|no\s+es\s+lo\s+que\s+(?:busco|te\s+pregunte|pregunte))\b/;

// "Estoy preguntando por este", "el de la historia", "ese mismo". Solo
// cuenta si ya se le enseñó algo (quien llama lo comprueba): la primera vez
// que lo dice es una pregunta normal.
const INSISTE_EN_LA_FOTO =
  /\b(?:(?:te\s+)?(?:estoy\s+)?pregunt\w*\s+(?:es\s+)?por\s+(?:este|esta|ese|esa|el\s+de|la\s+de)|(?:este|esta|ese|esa)\s+(?:de\s+la\s+(?:historia|foto)|mismo|misma|que\s+(?:te\s+)?mande)|el\s+de\s+la\s+(?:historia|foto)|la\s+de\s+la\s+(?:historia|foto))\b/;

// El cliente ya está molesto, o pide una persona. Esto vale siempre, se le
// haya enseñado algo o no: seguir contestando con la máquina es lo peor.
const SE_FRUSTRA_O_PIDE_PERSONA =
  /\b(?:ciego|ciega|no\s+entiendes|no\s+me\s+entiendes|no\s+sirves|no\s+sirve\s+(?:de\s+nada|esto)|olvidalo|olvidenlo|olvida\s+eso|dejalo\s+asi|que\s+fastidio|que\s+ladilla|eres\s+un\s+bot|eres\s+una\s+maquina|(?:hablar|habla)\s+con\s+(?:una\s+)?(?:persona|humano)|(?:pasame|comunicame|quiero)\s+(?:con\s+)?(?:un|una)\s+(?:asesor|asesora|persona|humano|vendedor|vendedora))\b/;

// ¿Hay que rescatar esta conversación? Devuelve el motivo, o "".
//
//   yaLeMostre  se le enseñó calzado hace poco en esta conversación
//   deUnaFoto   la conversación viene de una foto o una historia
// "No es ese color, quiero en negro", "no es esa talla": NO es que el bot se
// equivocara de zapato. Es un cliente pidiendo otra variante del MISMO, y
// eso lo contesta el modelo buscando ese color. Rescatarlo sería cortarle
// la venta a quien ya la tenía encaminada.
const PIDE_OTRA_VARIANTE =
  /\b(?:color|colores|talla|tallas|numero|size|negr[oa]s?|blanc[oa]s?|gris(?:es)?|azul(?:es)?|roj[oa]s?|rosad[oa]s?|rosas?|verdes?|beige|marron(?:es)?|morad[oa]s?|amarill[oa]s?|naranjas?|crema|plateado|dorado|celestes?|vinotinto)\b/;

export function hayQueRescatar(texto, { yaLeMostre = false, deUnaFoto = false } = {}) {
  const dice = sinTildes(texto);
  if (!dice) return "";

  if (SE_FRUSTRA_O_PIDE_PERSONA.test(dice)) return "se frustró o pidió una persona";
  if (!yaLeMostre) return "";
  if (PIDE_OTRA_VARIANTE.test(dice)) return "";
  if (RECHAZA_LO_MOSTRADO.test(dice)) return "dijo que lo que le mostré no es";
  if (deUnaFoto && INSISTE_EN_LA_FOTO.test(dice)) return "insiste en el zapato de la foto";
  return "";
}

// Lo que se le dice. Pide disculpas sin excusas, y le dice lo que va a pasar
// —una persona, con su foto— en vez de otra pregunta.
export const FRASE_DE_RESCATE =
  "¡Disculpa! 🙏 Ya le paso tu foto a un asesor para que te confirme exactamente " +
  "cuál es y su precio. Te escribe en un momento 😊";

export const MOTIVO_DE_RESCATE = "🚨 EL BOT NO ACERTÓ EL ZAPATO — ATENDER YA";

function sinTildes(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
