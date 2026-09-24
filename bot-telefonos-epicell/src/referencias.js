// CÓMO LO DICE LA GENTE → CÓMO SE LLAMA EN LA HOJA
//
// El cliente casi nunca sabe el nombre del producto. Dice "una pila para
// el teléfono", "el taco del cargador", "una corneta", "cascos". Nada de
// eso está escrito en ningún título de la hoja, así que la búsqueda
// devuelve cero y el cliente se va.
//
// Acá se traduce antes de buscar. Es una tabla, no un modelo: el mismo
// mensaje da siempre el mismo término, se puede leer entero de un vistazo
// y se arregla añadiendo una línea.
//
// REGLA AL AÑADIR: a la derecha va un término que EXISTE en la hoja, tal
// como está escrito ahí. Una traducción hacia algo que no se vende es
// peor que no traducir: el cliente recibe un "no hay" en vez de una
// pregunta, y se va creyendo que lo buscamos.
//
// Lo que NO se traduce es la marca ni el modelo. "Redmi" es "Redmi".
// Esto es solo para cuando el cliente describe en vez de nombrar.
//
// HASTA DÓNDE LLEGA: una tabla no cubre todas las formas de decir algo,
// y no pretende hacerlo. Quien entiende una frase nueva es el modelo,
// que ya tiene en su prompt la lista de tipos y la instrucción de buscar
// por tipo. Esto es la RED DEBAJO: entra solo cuando la búsqueda del
// modelo volvió vacía. Si aparece una forma de decirlo que se repite en
// los chats, se añade una línea acá y queda cubierta para siempre.
const REFERENCIAS = [
  // Cada entrada: [lo que puede escribir el cliente, lo que se busca]
  [["pila portatil", "pila para el telefono", "bateria portatil", "bateria externa",
    "cargador portatil", "power bank", "powerbank", "banco de energia",
    "cargar en la calle", "cargar el telefono en la calle", "cargar fuera de casa",
    "cargar sin enchufe", "bateria de respaldo", "para cargar en la calle",
    // Escrito como suena. El buscador perdona dos erratas, y estas pasan
    // de ahí: "paguerbank" está a tres letras de "powerbank". Una
    // palabra en inglés que se escribe de oído no es una errata, es otra
    // palabra, y por eso se lista en vez de dejársela al buscador.
    "paguer bank", "paguerbank", "pauer bank", "pauerbank",
    "poguer bank", "poguerbank", "poder bank"], "Powerbank"],

  [["taco", "bloque", "cubo", "adaptador de pared", "cargador de pared",
    "cargador de corriente", "enchufe"], "Cargador"],

  [["cargador del carro", "cargador para el carro", "cargador de carro",
    "encendedor", "para el carro"], "Cargador de carro"],

  [["cascos", "manos libres", "audifono", "auriculares inalambricos",
    "audifonos bluetooth", "earbuds", "airpods", "diadema", "auricular"], "Audifonos"],

  [["reloj inteligente", "smartwatch", "smart watch", "reloj de pulsera"], "Reloj"],
  [["pulsera de actividad", "pulsera inteligente", "manilla"], "Mi band"],

  [["cable de datos", "cable cargador", "cable de carga", "cablecito",
    "cable tipo c", "cable usb"], "Cable"],

  [["wifi", "wi fi", "modem", "internet", "repetidor", "extensor de señal"], "Router"],

  [["camara para la computadora", "camara para videollamadas", "webcam",
    "camara de video"], "Camara web"],

  [["microfono de solapa", "microfonos inalambricos", "mic"], "Microfono"],

  [["soporte", "soporte para el carro", "soporte de telefono", "porta telefono",
    "sujetador", "base para el carro", "base de moto", "agarradera",
    "poner el telefono en el carro", "sostener el telefono",
    "sujetar el telefono", "para llevar el telefono en el carro"], "Base"],

  [["ventilador para el telefono", "enfriador", "cooler"], "Fan Cooler"],
  [["palo de selfie", "palo para selfies", "monopod", "tripode"], "Selfie Stick"],
  [["bolso de agua", "bolsa de agua", "protector de agua", "funda de agua",
    "estuche de agua", "sumergible"], "Funda antiagua"],
  [["tableta", "ipad"], "Tablet"],
  [["teclado inalambrico"], "Teclado"],
  [["raton", "mouse inalambrico"], "Mouse"],
];

// Se compara sin tildes, sin mayúsculas y sin signos, igual que la
// búsqueda, para que "cámara" y "camara" sean lo mismo.
function llano(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Se recorren de la frase MÁS LARGA a la más corta. "cargador de carro"
// tiene que ganarle a "cargador": si gana el corto, el cliente que pide
// el del carro recibe tacos de pared.
const ORDENADAS = REFERENCIAS
  .flatMap(([frases, termino]) => frases.map((frase) => [llano(frase), termino]))
  .sort((a, b) => b[0].length - a[0].length);

// Devuelve el término del catálogo si el mensaje contiene una de estas
// formas de decirlo, o "" si no hay ninguna.
export function referenciaEnTexto(texto) {
  const plano = llano(texto);
  if (!plano) return "";

  for (const [frase, termino] of ORDENADAS) {
    // Con bordes de palabra, para que "mic" no salte dentro de "micro-
    // ondas" ni "base" dentro de "basecamp".
    if (new RegExp(`(^| )${frase}( |$)`).test(plano)) return termino;
  }

  return "";
}

// Para las pruebas y para /estado: cuántas formas de decirlo conoce.
export function cuantasReferencias() {
  return ORDENADAS.length;
}
