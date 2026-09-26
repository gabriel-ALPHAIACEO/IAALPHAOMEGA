// QUÉ CLASE DE PRODUCTO ES, Y CUÁL ESTÁ PIDIENDO EL CLIENTE.
//
// EL FALLO QUE ESTO ARREGLA (26-sep-2026, dicho por el dueño: "cuando
// preguntan por algún producto manda otra cosa nada que ver").
//
// El cliente escribía "forro para el Samsung A57" y recibía el Samsung
// A57: un teléfono de 310 dólares en respuesta a quien quería un forro de
// ocho. La razón es que la búsqueda exige TODAS las palabras, y cuando una
// no está en ningún título —esta tienda no maneja forros— se ignoraba para
// no dejar al cliente sin respuesta. Pero la palabra que se ignoraba era
// justo la que decía QUÉ quería; lo que quedaba ("samsung a57") era el
// teléfono.
//
// Un accesorio y un teléfono no son intercambiables por mucho que
// compartan la marca. Así que aquí se dice, una vez, qué tipos de producto
// existen y cómo los nombra la gente. Con eso:
//
//   · Si pide un tipo, SOLO se le enseñan cosas de ese tipo.
//   · Si de ese tipo no hay nada, se le dice que no hay — en vez de
//     enseñarle otra cosa que no pidió.
//
// CÓMO SE AMPLÍA: una línea más en la tabla. A la izquierda el nombre
// interno (da igual cuál), a la derecha TODAS las formas de decirlo, las
// del cliente y las que usa tu hoja en los títulos.

const TIPOS = [
  ["forro", ["forro", "forros", "funda", "fundas", "case", "cases", "cover", "covers",
    "estuche", "estuches", "carcasa", "carcasas", "silicona", "silicon"]],

  ["vidrio", ["vidrio", "vidrios", "mica", "micas", "lamina", "laminas", "glass",
    "templado", "templados", "hidrogel"]],

  ["cable", ["cable", "cables", "cablecito", "cablecitos"]],

  ["cargador", ["cargador", "cargadores", "taco", "tacos", "cubo", "adaptador",
    "adaptadores", "charger"]],

  ["audifonos", ["audifono", "audifonos", "auricular", "auriculares", "casco", "cascos",
    "buds", "earbuds", "airpods", "headset", "diadema", "diademas"]],

  ["powerbank", ["powerbank", "powerbanks", "pila", "pilas", "bateria", "baterias"]],

  ["reloj", ["reloj", "relojes", "smartwatch", "smartwatches", "watch", "band", "banda",
    "pulsera", "pulseras"]],

  ["memoria", ["memoria", "memorias", "microsd", "pendrive", "pendrives"]],

  ["corneta", ["corneta", "cornetas", "bocina", "bocinas", "parlante", "parlantes",
    "speaker", "speakers"]],

  ["soporte", ["soporte", "soportes", "tripode", "tripodes", "holder", "selfie"]],

  ["microfono", ["microfono", "microfonos"]],

  ["camara", ["camara", "camaras", "webcam"]],

  ["router", ["router", "routers", "modem", "repetidor"]],

  // El teléfono es el tipo por defecto de esta tienda, pero también se
  // nombra: "¿qué celulares tienen?", "teléfonos Xiaomi". Nombrarlo sirve
  // para lo contrario que los demás: para dejar los accesorios FUERA.
  ["telefono", ["telefono", "telefonos", "celular", "celulares", "equipo", "equipos",
    "movil", "moviles", "smartphone", "smartphones"]],
];

const DE_PALABRA = new Map();
for (const [tipo, palabras] of TIPOS) {
  for (const palabra of palabras) DE_PALABRA.set(palabra, tipo);
}

function palabras(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// QUÉ TIPO PIDIÓ EL CLIENTE. "" si no nombró ninguno —que es lo normal
// cuando pregunta por un modelo— y entonces no se filtra nada.
//
// Gana el PRIMERO que aparece en el texto: en "forro para el Note 17" el
// forro va delante, y es lo que quiere.
export function tipoQuePide(texto) {
  for (const palabra of palabras(texto)) {
    const tipo = DE_PALABRA.get(palabra);
    if (tipo) return tipo;
  }
  return "";
}

// QUÉ TIPO ES ESTE PRODUCTO, según su título. Lo que no nombra ningún
// accesorio es un teléfono: es lo que vende esta tienda.
export function tipoDelProducto(titulo) {
  for (const palabra of palabras(titulo)) {
    const tipo = DE_PALABRA.get(palabra);
    if (tipo && tipo !== "telefono") return tipo;
  }
  return "telefono";
}

// ¿Este producto sirve para lo que pidió?
export function sirveParaLoQuePide(titulo, tipo) {
  if (!tipo) return true;
  return tipoDelProducto(titulo) === tipo;
}

// Para decírselo al cliente con sus palabras: "forros", "cables"…
const COMO_SE_LLAMA = new Map([
  ["forro", "forros"],
  ["vidrio", "vidrios protectores"],
  ["cable", "cables"],
  ["cargador", "cargadores"],
  ["audifonos", "audífonos"],
  ["powerbank", "power banks"],
  ["reloj", "relojes"],
  ["memoria", "memorias"],
  ["corneta", "cornetas"],
  ["soporte", "soportes"],
  ["microfono", "micrófonos"],
  ["camara", "cámaras"],
  ["router", "routers"],
  ["telefono", "teléfonos"],
]);

export function comoSeLlama(tipo) {
  return COMO_SE_LLAMA.get(tipo) || tipo;
}
