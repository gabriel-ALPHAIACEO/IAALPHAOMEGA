// LO QUE HAY Y LO QUE NO HAY, SACADO DE LA HOJA (2-oct-2026).
//
// QUÉ PASÓ. EPICELL no tiene iPhone. El dueño le mandó una nota de voz
// preguntando por uno, y la IA le habló como si hubiera. El dueño: "debe
// saber todo lo que está disponible en el sheet, debe pensar antes de
// hablar".
//
// Dos cosas:
//
//   1. resumenDeMarcas(): una línea, hecha con TODA la hoja (no con la lista
//      recortada que ve el modelo), que dice qué marcas de teléfono hay y
//      cuáles NO. Va arriba del catálogo en cada mensaje. Así la IA no tiene
//      que deducir de 200 títulos que no hay ningún iPhone: se lo dice el
//      sistema con todas las letras.
//
//   2. revisarDisponibilidad(): la red por debajo. Si la IA igual escribe
//      una frase que habla de una marca que la hoja NO tiene ("Déjame
//      revisar los iPhone 15", "¡Sí tenemos iPhone!"), esa frase se quita y
//      se le dice la verdad, ofreciendo lo que sí hay.
//
// Las marcas se reconocen en los TÍTULOS de la hoja. Si la hoja no se pudo
// leer (lista vacía), aquí no se toca nada: sin hoja no se sabe qué falta.

// Nombre que se le dice al cliente, y cómo se reconoce (en títulos y en lo
// que escribe el cliente, con sus erratas de siempre).
const MARCAS = [
  ["iPhone", /\b(?:iphone|iphones|ip?hon|aifon|ayfon|ifone|apple)\b/i],
  ["Samsung", /\b(?:samsung|samsum|sansung|sansum|galaxy|galaxi)\b/i],
  ["Xiaomi", /\b(?:xiaomi|xaomi|shaomi|xiomi)\b/i],
  ["Redmi", /\b(?:redmi|redmy)\b/i],
  ["Poco", /\bpoco\s+(?:[a-z]?\d|x\d|f\d|m\d|c\d)/i],
  ["Infinix", /\b(?:infinix|infinis)\b/i],
  ["Tecno", /\btecno\s+(?:spark|camon|pova|pop|phantom)\b|\btecno\b(?!\w)/i],
  ["Honor", /\bhonor\s+(?:x?\d|magic|play)/i],
  ["Motorola", /\b(?:motorola|moto\s+[geg]\d*)\b/i],
  ["Realme", /\brealme\b/i],
  ["Huawei", /\b(?:huawei|huawey)\b/i],
  ["Oppo", /\boppo\b/i],
  ["ZTE", /\bzte\b/i],
  ["Nokia", /\bnokia\b/i],
  ["Google Pixel", /\bpixel\s*\d/i],
  ["OnePlus", /\bone\s?plus\b/i],
  ["Itel", /\bitel\b/i],
  ["Alcatel", /\balcatel\b/i],
];

// Un forro de iPhone no es un iPhone: para contar TELÉFONOS, los
// accesorios no cuentan.
const ACCESORIO =
  /\b(?:forros?|estuches?|case|fundas?|cargador(?:es)?|cables?|vidrios?|protector(?:es)?|micas?|aud[ií]fonos?|aud[ií]fono|aud[ií]fonos|buds|airpods|cornetas?|smartwatch|reloj|correas?|adaptador(?:es)?|soportes?|power\s*bank|bater[ií]as?\s+externas?)\b/i;

// soloTelefonos: true para el resumen (cuántos TELÉFONOS de cada marca);
// false para la red (cualquier producto que lleve la marca en el título).
export function marcasQueHay(productos = [], { soloTelefonos = false } = {}) {
  const cuenta = new Map();
  for (const p of productos) {
    const titulo = String(p?.titulo || "");
    if (soloTelefonos && ACCESORIO.test(titulo)) continue;
    for (const [nombre, patron] of MARCAS) {
      if (patron.test(titulo)) {
        cuenta.set(nombre, (cuenta.get(nombre) || 0) + 1);
        break;
      }
    }
  }
  return cuenta;
}

// Las marcas que nombra un texto (lo del cliente o lo de la IA).
export function marcasNombradas(texto) {
  const t = String(texto || "");
  return MARCAS.filter(([, patron]) => patron.test(t)).map(([nombre]) => nombre);
}

export function resumenDeMarcas(productos = []) {
  if (!productos.length) return "";
  const hay = marcasQueHay(productos, { soloTelefonos: true });
  const conAlgo = marcasQueHay(productos);
  const no = MARCAS.map(([nombre]) => nombre).filter((n) => !hay.has(n) && !conAlgo.has(n));
  const soloAccesorios = MARCAS.map(([nombre]) => nombre).filter((n) => !hay.has(n) && conAlgo.has(n));
  const lineas = [];
  if (hay.size) {
    lineas.push(
      "MARCAS DE TELÉFONO QUE HAY HOY (contadas en TODA la hoja): " +
        [...hay.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} (${c})`).join(" · ")
    );
  }
  if (no.length) {
    lineas.push(`NO HAY NINGÚN equipo de: ${no.join(", ")}. De esas marcas no digas que hay, ni que lo vas a revisar.`);
  }
  if (soloAccesorios.length) {
    lineas.push(`De ${soloAccesorios.join(", ")} hay SOLO accesorios (forros, cargadores…), ningún teléfono.`);
  }
  return lineas.join("\n");
}

const NEGACION = /\bno\s+(?:tengo|tenemos|hay|manejo|manejamos|contamos|trabajamos|vendemos|nos\s+queda|me\s+queda|lo\s+tengo|la\s+tengo|los\s+tengo|est[aá]\s+disponible)|\bpor\s+ahora\s+no\b|\bsin\s+stock\b|\bno\s+\w+\s+disponible/i;

function frases(texto) {
  return String(texto || "").split(/(?<=[.!?😊😅🙌👇📱🙏😔👋])\s+/);
}

// "En este momento no tengo iPhone 😔 Pero tengo Samsung y Redmi, ¿te
// muestro alguno?"
export function fraseDeMarcaQueNoHay(ausentes, productos = []) {
  const hay = [...marcasQueHay(productos, { soloTelefonos: true }).entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n).slice(0, 3);
  const nombres = (lista) => (lista.length > 1 ? `${lista.slice(0, -1).join(", ")} y ${lista.at(-1)}` : lista[0]);
  // Como dice el prompt de EPICELL: es tecnología, así que nunca "no
  // vendemos", sino "ahora mismo no lo tengo", y un asesor confirma si se
  // puede conseguir.
  const base = `Ahora mismo no tengo ${nombres(ausentes)} disponible 😊 Un asesor te confirma si podemos conseguirlo.`;
  return hay.length ? `${base} Mientras, tengo ${nombres(hay)}, ¿te muestro alguno?` : `${base} ¿Te muestro lo que tengo mientras?`;
}

export function revisarDisponibilidad(respuesta, productos = []) {
  const texto = String(respuesta || "");
  if (!texto.trim() || !productos.length) return { corregido: false, respuesta: texto };

  // Solo las marcas de las que la hoja no tiene NADA. Si de esa marca hay
  // algo —aunque sean accesorios: "de Apple hoy hay cargadores y AirPods"—
  // la búsqueda y las frases de "ese no, pero mira este" ya se encargan.
  const deTodo = marcasQueHay(productos);
  const ausentes = new Set();
  for (const frase of frases(texto)) {
    if (NEGACION.test(frase)) continue; // ya dice que no hay
    marcasNombradas(frase).filter((m) => !deTodo.has(m)).forEach((m) => ausentes.add(m));
  }
  if (!ausentes.size) return { corregido: false, respuesta: texto };

  // Si habló de algo que no hay, el resto de lo que escribió suele ir en
  // la misma línea ("déjame revisar", "mira 👇") y ya no vale. Se queda solo
  // la bienvenida, si la había, y se le dice la verdad.
  const lista = [...ausentes];
  const todas = frases(texto);
  const hasta = todas.findIndex((f) => /asistente virtual/i.test(f));
  const bienvenida = hasta >= 0 ? todas.slice(0, hasta + 1).join(" ") : "";
  const limpia = [bienvenida, fraseDeMarcaQueNoHay(lista, productos)].filter(Boolean).join(" ");
  console.log(`DISPONIBLE: la IA habló de ${lista.join(", ")}, que NO está en la hoja. Lo corrijo.`);
  return { corregido: true, respuesta: limpia, motivos: lista.map((m) => `habló de ${m}, que no hay`) };
}
