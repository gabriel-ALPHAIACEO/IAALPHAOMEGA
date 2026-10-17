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
// LA COLUMNA DE LA HOJA TRAE DOS COSAS, NO UNA.
//
// En el inventario real la columna "Almacenamiento" dice "4GB / 128GB":
// lo de la izquierda es la RAM y lo de la derecha el almacenamiento. Si
// se leyera como dos capacidades sueltas, el bot contestaría "lo tengo
// en 4GB y 128GB", que no significa nada para un cliente.
//
// Cuando hay dos valores, el PRIMERO es RAM y el ÚLTIMO almacenamiento —
// es como se escribe siempre en este rubro ("8/256", "12GB/512GB"). Con
// uno solo, es el almacenamiento.
//
// Los accesorios —relojes, audífonos, una afeitadora— llevan "N/A". Eso
// NO es un dato que falte: es que la pregunta no aplica, y responderlo
// así es mejor que mandar al cliente con un asesor a preguntar cuántos
// gigas tiene un par de audífonos.
const NO_APLICA = /^(n\/?\s?a|no aplica|no|ninguna?|sin|-{1,2})$/i;

export function leerColumnaCapacidad(valor) {
  const texto = String(valor || "").trim();
  const vacio = { ram: "", almacenamiento: "", noAplica: false };

  if (!texto) return vacio;
  if (NO_APLICA.test(texto)) return { ...vacio, noAplica: true };

  const partes = texto
    .split(/[\/+·|,]/)
    .map((parte) => separarCapacidad(parte).capacidades[0] || "")
    .filter(Boolean);

  if (!partes.length) return vacio;
  if (partes.length === 1) return { ...vacio, almacenamiento: partes[0] };

  return { ram: partes[0], almacenamiento: partes[partes.length - 1], noAplica: false };
}

// PRIMERO LA COLUMNA DE LA HOJA, DESPUÉS EL TÍTULO.
//
// Muchos catálogos llevan la capacidad en su propia columna y el título
// limpio ("Samsung A57"). Ese fue el caso que hizo que el bot inventara
// "128GB": leyendo solo títulos, no había nada que leer. La columna es
// el dato bueno; el título es el respaldo para las hojas que la meten
// ahí ("iPhone 15 128GB").
export function capacidadesDe(productos) {
  const encontradas = [];

  for (const producto of productos || []) {
    const { almacenamiento } = leerColumnaCapacidad(producto.capacidad);
    if (almacenamiento) {
      encontradas.push(almacenamiento);
      continue;
    }

    encontradas.push(...separarCapacidad(producto.titulo).capacidades);
  }

  return unicas(encontradas).sort((a, b) => enBytes(a) - enBytes(b));
}

// La capacidad de UN producto, tal como va escrita en su ficha:
// "4GB RAM · 128GB". La RAM se nombra para que no se confunda con el
// almacenamiento — dos números sueltos juntos no se entienden.
export function capacidadDe(producto) {
  const { ram, almacenamiento } = leerColumnaCapacidad(producto?.capacidad);

  if (almacenamiento) {
    return ram ? `${ram} RAM · ${almacenamiento}` : almacenamiento;
  }

  const [delTitulo] = separarCapacidad(producto?.titulo).capacidades;
  return delTitulo || "";
}

// El producto no lleva almacenamiento porque no le corresponde: un reloj,
// unos audífonos. La hoja lo dice con "N/A".
export function noLlevaCapacidad(productos) {
  const conDato = (productos || []).filter((p) => p?.capacidad);
  if (!conDato.length) return false;
  return conDato.every((p) => leerColumnaCapacidad(p.capacidad).noAplica);
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
