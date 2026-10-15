// LO QUE VENDE RODRIGO, POR CATEGORÍAS: SOLO CALZADO (15-oct-2026).
//
// Este archivo viene de El Emperador, que vende calzado, bolsos, camisas,
// pantalones, shorts, uniformes y gorras (cada uno con su categoría: palabras,
// carpeta de Drive y tallas). Rodrigo solo vende zapatos, así que aquí queda
// UNA categoría. Todo lo demás del bot (la búsqueda, el prompt, la visión)
// sigue funcionando igual: simplemente no hay otra categoría que reconocer, y
// quien pida un bolso se queda sin filtro y sin resultados ("por ahora solo
// manejamos calzado").
//
// SI RODRIGO AMPLÍA lo que vende, se copia la categoría que haga falta de
// emperador-bot/src/categorias.js (con su entrada en DEL_TIPO) y se ajusta
// el prompt: prompts/texto.txt (QUÉ VENDE LA TIENDA) y prompts/vision.txt.
//
//   · categoriaDelTexto("tienes zapatos nike?")  → "calzado"
//   · categoriaDeProducto(producto)             → por la carpeta de Drive o
//     por el título
//   · filtrarPorCategoria(productos, "calzado") → solo el calzado

const SIN_ACENTOS = (texto) =>
  String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export const CATEGORIAS = {
  calzado: {
    nombre: "calzado",
    plural: "calzados",
    unidad: "calzado",
    emoji: "👟",
    // Nombres de carpeta de Drive (o tipos de producto) que son calzado.
    carpeta: /calzad|zapat|tenis|bota|sandal|chola|crocs|sneaker|footwear|shoe/i,
    // Lo que escribe la gente, sin acentos y en minúsculas.
    palabras: /\b(zapat\w*|calzad\w*|tenis|zapatill\w*|sneakers?|botas?|botin\w*|sandalias?|cholas?|crocs|mocasin\w*|shoes?)\b/,
    tallas: "número (por ejemplo 38, 40, 42)",
  },
};

export const NOMBRES = Object.keys(CATEGORIAS);

export function esCategoria(valor) {
  return NOMBRES.includes(String(valor || ""));
}

// Lo que dice la IA de visión llevado a las categorías del dueño
// ("franela" es camisa; "short" y "uniforme" tienen la suya).
const DEL_TIPO = {
  calzado: "calzado",
};

export function categoriaDelTipo(tipo) {
  return DEL_TIPO[String(tipo || "").toLowerCase()] || "";
}

// ¿De qué categoría habla el cliente? Solo si nombra UNA: "zapatos y
// gorras" no es ninguna en concreto (se busca sin filtrar).
export function categoriasDelTexto(texto) {
  const limpio = SIN_ACENTOS(texto);
  return NOMBRES.filter((c) => CATEGORIAS[c].palabras.test(limpio));
}

export function categoriaDelTexto(texto) {
  const halladas = categoriasDelTexto(texto);
  return halladas.length === 1 ? halladas[0] : "";
}

// La categoría de un nombre de carpeta (o tipo de producto de Shopify).
export function categoriaDeCarpeta(carpeta) {
  const texto = String(carpeta || "");
  if (!texto) return "";
  return NOMBRES.find((c) => CATEGORIAS[c].carpeta.test(texto)) || "";
}

// La categoría de un producto: su carpeta manda (así lo ordenó el dueño);
// si no tiene, el título ("Bolso Michael Kors negro").
export function categoriaDeProducto(producto) {
  if (!producto) return "";
  return categoriaDeCarpeta(producto.categoria) || categoriaDelTexto(producto.titulo) || "";
}

// Solo los de esa categoría. Un producto sin categoría conocida se queda
// fuera SOLO si hay otros que sí la tienen: en un catálogo sin carpetas,
// filtrar lo dejaría todo vacío.
export function filtrarPorCategoria(productos, categoria) {
  if (!esCategoria(categoria) || !productos?.length) return productos || [];
  const conocida = productos.filter((p) => categoriaDeProducto(p));
  if (!conocida.length) return productos;
  return productos.filter((p) => categoriaDeProducto(p) === categoria);
}

// "mochila Nike" → "Nike". Para volver a buscar dentro de la categoría
// cuando los títulos no traen esa palabra (la carpeta se llama BOLSOS).
export function quitarPalabrasDeCategoria(termino) {
  return String(termino || "")
    .split(/\s+/)
    .filter((p) => p && !NOMBRES.some((c) => CATEGORIAS[c].palabras.test(SIN_ACENTOS(p))))
    .join(" ")
    .trim();
}

export function emojiDe(categoria) {
  return CATEGORIAS[categoria]?.emoji || "😊";
}

// Para el prompt: qué vende la tienda y cómo se nombran las tallas.
export function categoriasParaElPrompt() {
  return NOMBRES.map((c) => {
    const k = CATEGORIAS[c];
    return `${k.emoji} ${k.nombre}${k.tallas ? ` (tallas: ${k.tallas})` : ""}`;
  }).join("\n");
}

// ¿De qué tipo de producto es esta búsqueda? En este orden:
//   1. Una FOTO: lo que vio la IA de visión (una gorra es una gorra, diga lo
//      que diga el texto).
//   2. Lo que dijo la IA de texto en "categoria": ella ve el historial, y
//      sabe que "y en negro?" sigue hablando de las gorras.
//   3. Lo que escribió el cliente ("tienes bolsos?"), por si la IA no lo dijo.
//   4. La palabra que la IA puso en "buscar" ("bolso Nike").
// Vacío si no se sabe: entonces se busca como siempre, sin filtrar.
export function categoriaDeLaBusqueda({ salida = {}, texto = "", tipoFoto = "", termino = "" } = {}) {
  if (tipoFoto) return categoriaDelTipo(tipoFoto);
  if (esCategoria(salida.categoria)) return salida.categoria;
  return categoriaDelTexto(texto) || categoriaDelTexto(termino) || "";
}
