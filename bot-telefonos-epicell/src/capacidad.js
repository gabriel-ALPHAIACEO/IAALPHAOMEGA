// La capacidad del equipo: los "gigas".
//
// POR QUÉ ESTO SÍ SE PUEDE RESPONDER, Y LOS COLORES NO. La capacidad está
// escrita EN EL TÍTULO del catálogo —"iPhone 15 128GB"—, así que el bot la
// sabe de verdad: la lee, no la supone. El color no: el título puede decir
// "Medianoche" y eso no dice qué hay en la tienda hoy. Por eso el color va
// al asesor y la capacidad se contesta.
//
// LO QUE RESUELVE. "¿Tienen el 15 de 256?" era una pregunta que terminaba
// mal: si no había ese exacto, la búsqueda devolvía cero, el bot decía
// "déjame confirmarte con un asesor" y el cliente se iba — cuando el mismo
// modelo estaba ahí en 128 y en 512. Ahora, cuando la capacidad pedida no
// aparece, se busca el modelo sin ella y se le dice en cuáles SÍ está.
//
// Es la diferencia entre "no tengo" y "de ese tengo estas".

// Cuánto ocupa cada unidad, para ordenar de menor a mayor.
const UNIDADES = { mb: 1, gb: 1024, tb: 1024 * 1024 };

// Con unidad pegada o separada: "256GB", "256 gb", "1TB", "1 tb".
const CON_UNIDAD = /\b(\d{1,4})\s*(gb|tb|mb)\b/gi;

// Sin unidad, el cliente dice "el de 256" o "dame el de 128".
//
// OJO CON LOS NÚMEROS SUELTOS. No vale cualquiera: "el 16" es un iPhone 16,
// no dieciséis gigas, y "el 12" es un iPhone 12. Por eso solo se aceptan
// los valores que SON capacidades y no son nombres de modelo. 64, 128, 256
// y 512 no existen como número de modelo en ninguna marca; 16 y 32 sí, así
// que quedan fuera a propósito — el que tenga un equipo de 32GB va a tener
// que escribir "32GB" y está bien.
const CAPACIDADES_SIN_UNIDAD = new Set([64, 128, 256, 512]);
const NUMERO_SUELTO = /\b(\d{2,4})\b/g;

// "¿De cuántos gigas?", "¿qué capacidades tienen?", "¿viene en más
// memoria?". Lo que se pregunta SIN nombrar una capacidad concreta.
const PREGUNTA_CAPACIDAD =
  /\b(gigas?|gb|capacidad(es)?|memoria|almacenamiento|espacio)\b/i;

export function preguntaPorCapacidad(texto) {
  return PREGUNTA_CAPACIDAD.test(String(texto || ""));
}

// Saca del término las capacidades que traiga, y las devuelve aparte.
// "iPhone 15 256GB" → { termino: "iPhone 15", capacidades: ["256GB"] }
export function separarCapacidad(termino) {
  const texto = String(termino || "");
  const capacidades = [];

  let limpio = texto.replace(CON_UNIDAD, (entero, numero, unidad) => {
    capacidades.push(normalizar(numero, unidad));
    return " ";
  });

  limpio = limpio.replace(NUMERO_SUELTO, (entero, numero) => {
    if (!CAPACIDADES_SIN_UNIDAD.has(Number(numero))) return entero;
    capacidades.push(normalizar(numero, "gb"));
    return " ";
  });

  return {
    termino: limpio.replace(/\s+/g, " ").trim(),
    capacidades: unicas(capacidades),
  };
}

// Qué capacidades hay entre los productos que devolvió la hoja, leídas de
// sus títulos y ordenadas de menor a mayor.
export function capacidadesDe(productos) {
  const encontradas = [];

  for (const producto of productos || []) {
    const { capacidades } = separarCapacidad(producto.titulo);
    encontradas.push(...capacidades);
  }

  return unicas(encontradas).sort((a, b) => enBytes(a) - enBytes(b));
}

// "128GB, 256GB y 512GB" — como lo diría una persona, no como una lista.
export function comoSeDicen(capacidades) {
  const lista = capacidades.filter(Boolean);
  if (!lista.length) return "";
  if (lista.length === 1) return lista[0];
  return `${lista.slice(0, -1).join(", ")} y ${lista[lista.length - 1]}`;
}

function normalizar(numero, unidad) {
  return `${Number(numero)}${String(unidad).toUpperCase()}`;
}

function enBytes(capacidad) {
  const [, numero, unidad] = /^(\d+)([A-Z]+)$/.exec(capacidad) || [];
  return Number(numero || 0) * (UNIDADES[String(unidad).toLowerCase()] || 1);
}

function unicas(lista) {
  return [...new Set(lista)];
}
