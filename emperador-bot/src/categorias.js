// LO QUE VENDE EL EMPERADOR, POR CATEGORÍAS (5-oct-2026): calzado, bolsos,
// camisas (FRANELAS), pantalones, shorts, uniformes y gorras.
//
// QUÉ SE PEDÍA. El dueño: "El Emperador tiene bolsos, camisas, pantalones,
// gorras y zapatos. Que la IA identifique cuándo es cada cosa y mande bien
// las cosas, por imagen y por texto."
//
// EL FALLO QUE ARREGLA. El bot nació para calzado. Si alguien escribía
// "tienes bolsos Nike?", la IA buscaba "Nike" y le llegaban zapatos Nike;
// con una foto de una gorra, si la búsqueda por la marca devolvía zapatos,
// le llegaban zapatos. La categoría se perdía por el camino.
//
// CÓMO. Todo lo de "qué tipo de producto es" sale de aquí, en un solo sitio:
//
//   · categoriaDelTexto("tienes bolsos nike?")  → "bolso"
//   · categoriaDeProducto(producto)             → por la carpeta de Drive
//     (CALZADOS, BOLSOS…) o, si no, por el título
//   · categoriaDelTipo("franela")               → "camisa" (lo que dice la
//     IA de visión, llevado a las categorías del dueño)
//   · filtrarPorCategoria(productos, "bolso")   → solo los bolsos
//
// La búsqueda filtra por la categoría ANTES de recortar al carrusel (si no,
// los 10 primeros podían ser zapatos y los bolsos quedarse fuera).
//
// AÑADIR UNA PALABRA. Si los clientes dicen algo que no está ("koala",
// "canguro"…), se añade en "palabras" de su categoría. Si una carpeta de
// Drive se llama distinto, en "carpeta".

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
  bolso: {
    nombre: "bolso",
    plural: "bolsos",
    unidad: "bolso",
    emoji: "👜",
    carpeta: /bols|carter|morral|mochil|koala|ri[ñn]oner|bandoler|cartucher|maletin|bag/i,
    palabras: /\b(bols\w*|carteras?|morral\w*|mochil\w*|koalas?|rinoner\w*|bandoler\w*|cartucher\w*|maletin\w*|bags?|tote|crossbody)\b/,
    tallas: "",
  },
  camisa: {
    nombre: "camisa",
    plural: "camisas",
    unidad: "camisa",
    emoji: "👕",
    carpeta: /camis|franel|chemise|polo|su[eé]ter|hoodie|sudader|blusa|t-?shirt/i,
    palabras: /\b(camis\w*|franel\w*|chemise\w*|polos?|sueter\w*|hoodies?|sudader\w*|blusas?|t-?shirts?|playeras?|remeras?)\b/,
    tallas: "S, M, L, XL",
  },
  pantalon: {
    nombre: "pantalón",
    plural: "pantalones",
    unidad: "pantalón",
    emoji: "👖",
    carpeta: /pantal|jean|jogger|\bmonos?\b|leggin/i,
    palabras: /\b(pantal\w*|jeans?|blue\s?jeans?|joggers?|monos?|leggins?)\b/,
    tallas: "cintura o S, M, L, XL",
  },
  // Los shorts y los uniformes tienen su propia carpeta en el Drive del
  // dueño (SHORT, UNIFORMES): son categorías aparte (5-oct-2026).
  short: {
    nombre: "short",
    plural: "shorts",
    unidad: "short",
    emoji: "🩳",
    carpeta: /short|bermud/i,
    palabras: /\b(shorts?|bermudas?|pantalon(es)?\s+cortos?|pantaloneta\w*)\b/,
    tallas: "S, M, L, XL",
  },
  uniforme: {
    nombre: "uniforme",
    plural: "uniformes",
    unidad: "uniforme",
    emoji: "👕",
    carpeta: /uniform/i,
    palabras: /\b(uniformes?|conjuntos?\s+deportivos?|equipaci\w*)\b/,
    tallas: "S, M, L, XL",
  },
  gorra: {
    nombre: "gorra",
    plural: "gorras",
    unidad: "gorra",
    emoji: "🧢",
    carpeta: /gorr|cachucha|visera|snapback|trucker|\bcaps?\b|sombrer/i,
    palabras: /\b(gorras?|gorros?|cachuchas?|viseras?|snapbacks?|truckers?|caps?|sombreros?)\b/,
    // Dato del dueño (5-oct-2026): todas las gorras son ajustables.
    tallas: "ajustables, una sola talla para todos",
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
  bolso: "bolso",
  gorra: "gorra",
  franela: "camisa",
  camisa: "camisa",
  uniforme: "uniforme",
  pantalon: "pantalon",
  short: "short",
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
