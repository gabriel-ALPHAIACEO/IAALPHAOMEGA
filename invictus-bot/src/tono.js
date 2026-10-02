// EL TONO: NUNCA UNA GROSERÍA, NUNCA UN REGAÑO (2-oct-2026).
//
// QUÉ SE PEDÍA. "Enseñémosle a tratar con personas ignorantes y brutas,
// personas detestables y personas que no entienden nada, que entienda a
// todo tipo de personas". El prompt (TODO TIPO DE CLIENTES, en texto.txt)
// le enseña a la IA a entender al que escribe mal, a tenerle paciencia al
// que no entiende y a no entrarle al trapo al grosero.
//
// ESTO ES LA RED POR DEBAJO. Un modelo de lenguaje tiende a imitar el tono
// de quien le escribe: si el cliente insulta, puede contestar con la misma
// palabra; si pregunta tres veces lo mismo, puede soltar un "como ya te
// dije". Eso, en el Instagram de la tienda, es un cliente perdido y una
// captura que circula. Así que lo que escribió la IA se revisa antes de
// salir, y la frase que tenga una grosería, un insulto o un regaño se borra.
//
// No se toca nada del cliente: esto mira SOLO lo que va a mandar el bot.

// Groserías e insultos. Algunas son cariño en Venezuela ("verga qué
// bonitos", "marico"), pero en boca de la tienda no van nunca.
const GROSERIA =
  /\b(mierda|mrd|verga|vrg|co[ñn]o|marico|marica|maric[oó]n|pendej\w*|huev[oó]n|g[uü]ev[oó]n|mamag[uü]ev\w*|idiota|est[uú]pid\w*|imb[eé]cil|bruto|bruta|brutos|ignorante|ignorantes|burro|burra|tarad\w*|carajo|puta|puto|hdp|joder|jodid\w*|arrech\w*|ladilla)\b/i;

// Regaños y aires de superioridad: hacen sentir tonto al cliente.
const REGANO =
  /\b(como\s+(?:ya\s+)?te\s+(?:dije|expliqu[eé]|coment[eé])|ya\s+te\s+(?:lo\s+)?(?:dije|expliqu[eé])|te\s+lo\s+repito|lee\s+bien|lee\s+(?:lo\s+que|el\s+mensaje)|presta\s+atenci[oó]n|es\s+(?:muy\s+)?f[aá]cil|no\s+entiendes|no\s+sabes\s+leer|aprende\s+a\s+escribir|escribe\s+bien|as[ií]\s+no\s+se\s+habla|resp[eé]tame|resp[eé]teme|no\s+(?:hace\s+falta|es\s+necesario)\s+(?:insultar|ser\s+grosero|la\s+grosería)|con\s+respeto\s+por\s+favor)\b/i;

// "No entiendo tu mensaje": deja al cliente sin nada. Se cambia por una
// pregunta que lo ayuda a seguir.
const NO_ENTIENDO =
  /\bno\s+(?:te\s+)?(?:entiendo|entend[ií]|comprendo)\s+(?:tu\s+mensaje|lo\s+que\s+(?:dices|escribiste|quieres)|bien)\b|\b(?:puedes|podr[ií]as)\s+escribirlo\s+(?:mejor|bien|de\s+nuevo)/i;

export const AYUDA_NEUTRA = "¿Qué estás buscando? 😊 Dime la marca o el modelo y te lo muestro";

function frases(texto) {
  return String(texto || "").split(/(?<=[.!?😊😅🙌👇👟🙏])\s+/);
}

export function revisarTono(respuesta) {
  const texto = String(respuesta || "");
  if (!texto.trim()) return { corregido: false, respuesta: texto };

  const motivos = [];
  let cambioPorNoEntiendo = false;
  const quedan = frases(texto).filter((frase) => {
    if (GROSERIA.test(frase)) {
      motivos.push(`grosería o insulto ("${frase.slice(0, 40)}")`);
      return false;
    }
    if (REGANO.test(frase)) {
      motivos.push(`regaño ("${frase.slice(0, 40)}")`);
      return false;
    }
    if (NO_ENTIENDO.test(frase)) {
      motivos.push(`"no entiendo" ("${frase.slice(0, 40)}")`);
      cambioPorNoEntiendo = true;
      return false;
    }
    return true;
  });

  if (!motivos.length) return { corregido: false, respuesta: texto };

  let limpia = quedan.join(" ").trim();
  if (cambioPorNoEntiendo && !/\?/.test(limpia)) limpia = limpia ? `${limpia} ${AYUDA_NEUTRA}` : AYUDA_NEUTRA;
  if (!limpia) limpia = AYUDA_NEUTRA;

  console.error(`TONO: la IA escribió ${motivos.join(" y ")}. Lo quito.`);
  return { corregido: true, respuesta: limpia, motivos };
}
