// ¿ES EL MISMO TELÉFONO, UN PARIENTE, O SOLO LA MISMA MARCA?
//
// EL FALLO QUE ESTO ARREGLA (29-sep-2026, visto en producción). Un cliente
// preguntó "¿Tienes redmi 17?". El Redmi 17 estaba agotado (Cantidad 0) y
// el bot contestó "¡Claro! Te muestro los Redmi Note 17 que tengo" — como
// si fueran el mismo teléfono. No lo son: el Note es otra línea, otro
// precio. Lo que tocaba era "el Redmi 17 no lo tengo disponible ahora,
// pero de la misma familia tengo el Note 17".
//
// Para decir eso hay que saber, comparando lo que escribió el cliente con
// un título de la hoja, cuál de estas tres cosas es:
//
//   · EL MISMO MODELO: "note 17" y "Redmi Note 17 Pro 5G". Coinciden la
//     línea (Note) y el número (17). Lo que venga detrás —Pro, 5G, la
//     capacidad— son versiones del mismo.
//   · UN PARIENTE: "redmi 17" y "Redmi Note 17" (mismo número, otra
//     línea), o "note 20" y "Redmi Note 17" (misma línea, otro número).
//   · SOLO LA MARCA: "poco z99" y "Poco M8 pro". Nada más en común.
//
// La forma de un título de teléfono es casi siempre la misma:
//
//     MARCA  [LÍNEA]  NÚMERO  [VARIANTE]
//     Redmi   Note     17      Pro Max 5G
//     Samsung          A57
//     Tecno   spark    50
//
// El número es la primera palabra con cifras que no sea una capacidad.

// Capacidades: dicen cuánto guarda, no qué teléfono es. "256", "8gb", "1tb".
const ES_CAPACIDAD = /^(?:\d+(?:gb|tb|mb)|16|32|64|128|256|512|1024)$/;

// Palabras que el cliente usa alrededor del modelo y que no son modelo.
const NO_SON_MODELO = new Set([
  "tienes", "tienen", "tenes", "hay", "precio", "cuanto", "cuesta", "vale", "el", "la",
  "los", "las", "un", "una", "de", "del", "en", "y", "o", "me", "quiero", "busco",
  "telefono", "celular", "equipo", "disponible", "que", "por", "favor",
]);

// RAM / almacenamiento escritos juntos: "8/256", "12+512", "8gb/256gb".
// Van fuera ANTES de partir en palabras: partidos, el "8" de la RAM parece
// un número de modelo ("Redmi 8"), y el texto de casi todos los anuncios
// lo lleva ("Poco X8 pro 5G 8/256").
const RAM_Y_MEMORIA = /\b\d{1,2}\s*(?:gb)?\s*[/+]\s*\d{2,4}\s*(?:gb|tb)?\b/gi;

// La red: "5G", "4G". Es una versión del equipo, no su número de modelo.
const ES_RED = /^\d+g$/;

// Las mismas palabras, para quien las necesite comparar afuera (index.js
// cuenta con ellas cuántos teléfonos nombra un anuncio).
export function palabrasDe(texto) {
  return palabras(texto);
}

// CÓMO SE ESCRIBE UN MODELO (7-oct-2026, informe de errores):
//   "Pro+"  = "Pro Plus"  ("Redmi Note 15 pro + 5G" de la hoja)
//   "15 C"  = "15C"       ("¿cuánto cuesta el redmi 15 C?" → "no me queda")
//   "A 57"  = "A57"       ("Samsumg A 57")
export function juntarModelo(texto) {
  return String(texto || "")
    .replace(/\+/g, " plus ")
    .replace(/\b(\d{1,3})\s+([cC])\b/g, "$1$2")
    .replace(/\b([aAmMsS])\s+(\d{2})\b/g, "$1$2");
}

function palabras(texto) {
  return juntarModelo(texto)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(RAM_Y_MEMORIA, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

const tieneCifras = (palabra) => /\d/.test(palabra);

// Las partes de un TÍTULO de la hoja. Si no tiene número de modelo (un
// cargador, un cable) no es un teléfono con esta forma, y se devuelve null.
export function partesDelTitulo(titulo) {
  const todas = palabras(titulo);
  const donde = todas.findIndex(
    (p, i) => i > 0 && tieneCifras(p) && !ES_CAPACIDAD.test(p) && !ES_RED.test(p)
  );
  if (donde === -1) return null;

  return {
    marca: todas[0],
    linea: todas.slice(1, donde),
    numero: todas[donde],
  };
}

// Los números de modelo que escribió el CLIENTE, sin las capacidades.
function numerosDelCliente(texto) {
  return palabras(texto).filter(
    (p) => tieneCifras(p) && !ES_CAPACIDAD.test(p) && !ES_RED.test(p) && !NO_SON_MODELO.has(p)
  );
}

// "mismo" | "familia" | "marca" | ""
export function parentesco(texto, titulo) {
  const partes = partesDelTitulo(titulo);
  if (!partes) return "";

  const suyas = new Set(palabras(texto));
  const numeros = numerosDelCliente(texto);

  const mismoNumero = suyas.has(partes.numero);
  const mismaLinea = partes.linea.length > 0 && partes.linea.every((p) => suyas.has(p));
  const lineaCompatible = partes.linea.every((p) => suyas.has(p));

  // Si escribió OTRO número de modelo, no es el mismo aunque todo lo demás
  // coincida: un 20 no es un 17.
  // (Lo que está en el propio título no cuenta como "otro": una variante
  // con cifras que el cliente copió tal cual.)
  const delTitulo = new Set(palabras(titulo));
  const dijoOtroNumero = numeros.some((n) => n !== partes.numero && !delTitulo.has(n));

  // LAS VARIANTES TIENEN QUE SER LAS MISMAS (7-oct-2026): "Redmi Note 15"
  // no es el "Redmi Note 15 Pro+": le sobran el Pro y el Plus. Antes se
  // daba por el mismo y le llegaba "¡Aquí lo tienes!" con otro teléfono.
  const variantesDelTitulo = palabras(titulo)
    .slice(palabras(titulo).indexOf(partes.numero) + 1)
    .filter((p) => VARIANTES.has(p));
  const variantesSuyas = [...suyas].filter((p) => VARIANTES.has(p));
  const mismasVariantesQueElTitulo =
    variantesDelTitulo.length === new Set(variantesSuyas).size && variantesSuyas.every((v) => variantesDelTitulo.includes(v));

  if (mismoNumero && lineaCompatible && !dijoOtroNumero && mismasVariantesQueElTitulo) return "mismo";
  if (mismoNumero && lineaCompatible && !dijoOtroNumero) return "familia";

  // "REDMI 17 PRO MAX" ES EL "REDMI NOTE 17 PRO MAX 5G" (6-oct-2026, dueño:
  // "dice que no hay y sí hay"). La gente se come el "Note". Si lo único
  // que le falta es eso, y escribió sus variantes (pro, max…) igual que el
  // título, es el mismo teléfono. Sin variantes no: "Redmi 17" a secas es
  // otro equipo que el "Redmi Note 17".
  const leFalta = partes.linea.filter((p) => !suyas.has(p));
  const susVariantes = [...suyas].filter((p) => VARIANTES.has(p));
  const sinElNote = leFalta.length > 0 && leFalta.every((p) => SE_LO_COMEN.has(p));
  if (mismoNumero && !dijoOtroNumero && sinElNote && susVariantes.length && susVariantes.every((v) => delTitulo.has(v))) {
    return "mismo";
  }
  if ((mismoNumero && !lineaCompatible) || (mismaLinea && !mismoNumero)) return "familia";
  if (suyas.has(partes.marca)) return "marca";
  return "";
}

// ¿El cliente nombró un modelo concreto? Hace falta un número de modelo:
// "tienes redmi?" es la marca y se atiende como marca; "tienes redmi 17?"
// es un teléfono en particular.
export function nombraUnModelo(texto) {
  return numerosDelCliente(texto).length > 0;
}

// Cómo se le dice al cliente lo que pidió: con sus palabras, en limpio y
// sin el relleno. "tienes el redmi 17?" -> "Redmi 17".
export function loQuePidioDicho(texto) {
  const limpias = palabras(texto).filter((p) => !NO_SON_MODELO.has(p) && !ES_CAPACIDAD.test(p));
  return comoSeDice(limpias);
}

function comoSeDice(lista) {
  return lista
    .filter(Boolean)
    .map((p) => (tieneCifras(p) ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
    .join(" ");
}

// Las palabras de la línea que el cliente casi nunca escribe.
const SE_LO_COMEN = new Set(["note", "galaxy"]);

// Lo que un anuncio pone delante del modelo y no es su nombre.
const RELLENO = new Set(["nuevo", "nueva", "nuevos", "oferta", "gran", "super", "llego", "llegaron", "ya", "con", "tu"]);

// Lo que viene detrás del número y sigue siendo el mismo nombre.
const VARIANTES = new Set([
  "pro", "max", "plus", "ultra", "lite", "mini", "se", "fe", "prime", "neo", "active", "c",
]);

// EL MODELO QUE NOMBRA UN TEXTO LARGO (30-sep-2026).
//
// Un anuncio no dice "Poco X8 pro 5G": dice "🔥 Poco X8 pro 5G 8/256 —
// ¡llévatelo hoy con Cashea!". Para decirle al cliente "el Poco X8 Pro 5G
// no lo tengo ahora" hace falta sacar de ahí el nombre y solo el nombre:
// desde la marca hasta el número, con las variantes que lo siguen.
export function modeloNombrado(texto, marca = "") {
  const todas = palabras(texto);
  const esNumero = (p) => tieneCifras(p) && !ES_CAPACIDAD.test(p) && !ES_RED.test(p);

  let desde = marca ? todas.indexOf(marca) : -1;
  const numero = todas.findIndex((p, i) => i >= Math.max(desde, 0) && esNumero(p));
  if (numero === -1) return loQuePidioDicho(texto);

  // Sin la marca escrita ("El nuevo Note 17 Pro"), la palabra de la línea
  // que va justo delante del número ("Note"), si no es relleno.
  if (desde === -1) {
    const antes = todas[numero - 1];
    desde = antes && !NO_SON_MODELO.has(antes) && !RELLENO.has(antes) && !tieneCifras(antes) ? numero - 1 : numero;
  }

  let hasta = numero + 1;
  while (hasta < todas.length && (VARIANTES.has(todas[hasta]) || ES_RED.test(todas[hasta]))) hasta++;

  return comoSeDice(todas.slice(desde, hasta));
}

// Lo que hay que buscar para enseñarle la familia de un pariente: si lo que
// comparten es la línea ("note"), toda la línea; si es el número ("17"),
// ese modelo con sus versiones.
export function raizDeLaFamilia(texto, titulo) {
  const partes = partesDelTitulo(titulo);
  if (!partes) return "";

  const suyas = new Set(palabras(texto));
  const mismaLinea = partes.linea.length > 0 && partes.linea.every((p) => suyas.has(p));

  return mismaLinea
    ? [partes.marca, ...partes.linea].join(" ")
    : [partes.marca, ...partes.linea, partes.numero].join(" ");
}

// LAS VARIANTES QUE ESCRIBIÓ (pro, max, plus…) CONTRA LAS DEL TÍTULO
// (6-oct-2026). "Redmi 17 pro max" no es el "Redmi Note 17 Pro 5G": le
// falta el Max. Devuelve true si el título trae exactamente las variantes
// que escribió el cliente; null si el cliente no escribió ninguna.
export function mismasVariantes(texto, titulo) {
  const suyas = palabras(texto).filter((p) => VARIANTES.has(p));
  if (!suyas.length) return null;
  const partes = partesDelTitulo(titulo);
  if (!partes) return null;
  const todas = palabras(titulo);
  const delTitulo = todas.slice(todas.indexOf(partes.numero) + 1).filter((p) => VARIANTES.has(p));
  return new Set(suyas).size === new Set(delTitulo).size && suyas.every((v) => delTitulo.includes(v));
}
