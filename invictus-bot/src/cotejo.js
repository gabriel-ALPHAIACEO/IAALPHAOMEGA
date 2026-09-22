// Cotejo visual: encontrar en el catálogo el zapato de la foto.
//
// EL PROBLEMA QUE RESUELVE. Todo el reconocimiento por foto termina en un
// NOMBRE: identificarEnImagen() mira la imagen, dice "Vapormax", y ese
// texto se busca en Shopify. Cuando el nombre falla, falla todo — y falla
// seguido, porque hay que acertar cómo se llama un modelo entre cientos,
// con una foto de historia con filtro y un sticker de precio encima. Es
// el fallo más caro del bot: quien responde a una historia ya vio el
// zapato y lo quiere, y se le contesta "¿sabes cómo se llama?".
//
// LA IDEA. El catálogo de Shopify ya trae la foto de cada producto. En
// vez de adivinar el nombre, se le ponen al modelo la foto del cliente y
// las fotos reales del catálogo, una al lado de la otra, y se le
// pregunta cuál es el mismo par. Comparar dos imágenes es mucho más
// fácil que recordar un nombre, y el resultado es un producto REAL de la
// tienda —con su título exacto, su precio y su enlace— en vez de un
// término de búsqueda que ojalá exista.
//
// CUÁNDO CORRE, Y CUÁNDO NO. Cada cotejo es una llamada de visión más,
// así que no corre en cada mensaje: solo cuando la vía normal no dejó
// una respuesta buena y hay fotos con las que comparar.
//
//   · La búsqueda por nombre no devolvió NADA  → se busca por la marca y
//     se cotejan esos. Es el caso que más duele y el que más gana.
//   · Devolvió VARIOS (típico de cuando identificar.js dejó
//     pedirNombreExacto: se reconoció "Nike" y eso trae diez)  → se
//     cotejan y el acertado va primero.
//   · Devolvió UNO SOLO  → no corre. No hay nada que elegir, y
//     descartarlo por una duda del modelo sería cambiar un resultado
//     bueno por ninguno.
//
// NUNCA EMPEORA. Si el cotejo no está seguro, o el modelo falla, o
// Shopify no responde, se devuelve null y el bot sigue exactamente como
// seguiría sin este archivo.

import { buscarProductos } from "./shopify.js";
import { cotejarConCatalogo } from "./ia.js";
import { terminosCompatibles } from "./identificar.js";

// Cuántas fotos del catálogo se le mandan al modelo. Con 8 se cubre de
// sobra una marca del catálogo, y cada una en "detail: low" cuesta poco.
// Subirlo mucho además empeora la comparación: cuantos más pares mira,
// más fácil es que se conforme con el más parecido.
const MAXIMO_CANDIDATOS = 8;

// Cuántos términos sacados de los rasgos se buscan en Shopify. Cada uno
// es una llamada más —baratas y rápidas, no son al modelo— pero más de
// dos casi nunca aporta: la tabla de rasgos rara vez deja tantos
// compatibles a la vez.
const MAXIMO_TERMINOS = 2;

export async function cotejoPorImagen({ env, foto, textoCliente, productos, termino, rasgos }) {
  if (!foto) return null;

  // Un solo resultado: no hay elección que hacer.
  if (productos.length === 1) return null;

  // LOS CANDIDATOS SE ELIGEN POR LOS RASGOS, NO POR EL ORDEN DEL
  // CATÁLOGO (esto es lo que decide si el cotejo sirve o no).
  //
  // Caso real del 22-sep: historia + "Precio". La IA dijo "Air Force
  // One", la verificación lo bajó a "Nike" por no verse la pieza
  // metálica del ojal, y el cotejo comparó la foto contra los primeros 8
  // Nike que devolvió Shopify — ocho pares cualesquiera. Se abstuvo, con
  // razón, sin haber visto nunca un candidato de la familia correcta.
  //
  // Los rasgos que la IA marcó (swoosh grande y recto sí, pieza metálica
  // no) apuntaban a "dunk". Buscar ESO y no la marca entera es la
  // diferencia entre ocho fotos al azar y ocho del estante correcto.
  const porRasgos = await buscarPorRasgos(env, rasgos, termino);

  // Primero los del rasgo, después los que ya había: si el cupo de 8 se
  // llena, que lo llenen los que tienen motivo para parecerse.
  const pila = unir(porRasgos, productos);

  if (pila.length >= 2) {
    const elegido = await cotejar(env, foto, pila, textoCliente);
    if (elegido) return resultado(elegido, productos);
  }

  // Ni los rasgos ni la búsqueda dejaron con qué comparar. Queda la
  // marca, que es lo poco que se puede dar por seguro cuando el modelo
  // concreto no se acertó.
  if (productos.length) return null;

  const marca = primeraPalabra(termino);
  if (!marca || marca.toLowerCase() === String(termino).trim().toLowerCase()) {
    // El término YA era una sola palabra: buscar "Nike" otra vez
    // devolvería lo mismo que acaba de devolver cero.
    return null;
  }

  console.log(`Sin resultados para "${termino}": cotejo la foto contra "${marca}"`);
  const { productos: deLaMarca } = await buscarProductos(env, marca, MAXIMO_CANDIDATOS);
  const elegido = await cotejar(env, foto, unir(pila, deLaMarca), textoCliente);
  if (!elegido) return null;

  return resultado(elegido, productos);
}

// Qué se le devuelve a decidir() según de dónde salió el par elegido.
function resultado(elegido, productos) {
  const estaba = productos.some((p) => p.titulo === elegido.titulo);

  // Salió de la búsqueda original: el cliente pidió ESE modelo y los
  // demás son del mismo, así que siguen sirviendo como alternativas. Lo
  // que cambia es el orden — el par de la foto va primero.
  if (estaba) {
    return {
      elegido,
      productos: [elegido, ...productos.filter((p) => p.titulo !== elegido.titulo)],
    };
  }

  // Salió de otro lado (los rasgos, o la marca), así que lo demás no
  // tiene que ver con la foto: mandarlo sería enterrar el que pidió
  // entre siete que no.
  return { elegido, productos: [elegido] };
}

// Busca en Shopify los modelos que encajan con lo que la IA dijo VER.
async function buscarPorRasgos(env, rasgos, termino) {
  const yaBuscado = String(termino || "").trim().toLowerCase();
  const terminos = terminosCompatibles(rasgos)
    // Si el término compatible es justo el que ya se buscó, no aporta:
    // sus resultados son los que ya están en "productos".
    .filter((t) => t !== yaBuscado)
    .slice(0, MAXIMO_TERMINOS);

  if (!terminos.length) return [];

  console.log(`Los rasgos de la foto encajan con: ${terminos.join(", ")}`);

  const encontrados = [];
  for (const t of terminos) {
    const { productos } = await buscarProductos(env, t, MAXIMO_CANDIDATOS);
    encontrados.push(...productos);
  }

  return encontrados;
}

// Junta listas de productos sin repetir títulos, respetando el orden.
function unir(...listas) {
  const vistos = new Set();
  const juntos = [];

  for (const producto of listas.flat()) {
    const clave = String(producto.titulo || "").toLowerCase();
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    juntos.push(producto);
  }

  return juntos;
}

async function cotejar(env, foto, productos, textoCliente) {
  // Sin foto no hay nada que comparar, y un producto sin imagen en el
  // catálogo dejaría al modelo eligiendo por el título — que es
  // justamente lo que este archivo evita.
  const candidatos = productos.filter((p) => p.imagen).slice(0, MAXIMO_CANDIDATOS);
  if (candidatos.length < 2) return null;

  return cotejarConCatalogo(env, foto, candidatos, textoCliente);
}

function primeraPalabra(termino) {
  return String(termino || "").trim().split(/\s+/)[0] || "";
}
