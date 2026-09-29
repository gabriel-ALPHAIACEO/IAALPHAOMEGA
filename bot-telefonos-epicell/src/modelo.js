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

function palabras(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

const tieneCifras = (palabra) => /\d/.test(palabra);

// Las partes de un TÍTULO de la hoja. Si no tiene número de modelo (un
// cargador, un cable) no es un teléfono con esta forma, y se devuelve null.
export function partesDelTitulo(titulo) {
  const todas = palabras(titulo);
  const donde = todas.findIndex((p, i) => i > 0 && tieneCifras(p) && !ES_CAPACIDAD.test(p));
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
    (p) => tieneCifras(p) && !ES_CAPACIDAD.test(p) && !NO_SON_MODELO.has(p)
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
  const dijoOtroNumero = numeros.some((n) => n !== partes.numero);

  if (mismoNumero && lineaCompatible && !dijoOtroNumero) return "mismo";
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
  const frase = limpias.join(" ");
  if (!frase) return "";
  return frase
    .split(" ")
    .map((p) => (tieneCifras(p) ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
    .join(" ");
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
