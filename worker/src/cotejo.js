// Cotejo visual: encontrar en el catálogo el zapato de la foto.
//
// EL PROBLEMA QUE RESUELVE. Hasta ahora todo el reconocimiento por foto
// terminaba en un NOMBRE: la IA mira la imagen, dice "Vapormax", y ese
// texto se busca en Shopify. Cuando el nombre falla, falla todo — y
// falla seguido, porque hay que acertar cómo se llama un modelo entre
// cientos, con una foto de historia con filtro y un sticker de precio
// encima. Es el fallo más caro del bot: quien responde a una historia ya
// vio el zapato y lo quiere, y se le contesta "¿sabes cómo se llama?".
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
//   · Devolvió VARIOS (típico de cuando identificar.js bajó a nivel
//     marca: "Nike" trae diez)  → se cotejan y el acertado va primero.
//   · Devolvió UNO SOLO  → no corre. No hay nada que elegir, y
//     descartarlo por una duda del modelo sería cambiar un resultado
//     bueno por ninguno.
//
// NUNCA EMPEORA. Si el cotejo no está seguro, o el modelo falla, o
// Shopify no responde, se devuelve null y el bot sigue exactamente como
// seguiría sin este archivo.

import { buscarProductos } from "./shopify.js";
import { cotejarConCatalogo } from "./ia.js";

// Cuántas fotos del catálogo se le mandan al modelo. Con 8 se cubre de
// sobra una marca del catálogo, y cada una en "detail: low" cuesta poco.
// Subirlo mucho además empeora la comparación: cuantos más pares mira,
// más fácil es que se conforme con el más parecido.
const MAXIMO_CANDIDATOS = 8;

export async function cotejoPorImagen({ env, foto, textoCliente, productos, termino }) {
  if (!foto) return null;

  // Un solo resultado: no hay elección que hacer.
  if (productos.length === 1) return null;

  if (productos.length > 1) {
    const elegido = await cotejar(env, foto, productos, textoCliente);
    if (!elegido) return null;

    // No se descarta el resto: el cliente pidió ESE modelo y los demás
    // son del mismo, así que siguen sirviendo como alternativas. Lo que
    // cambia es el orden — el par de la foto va primero, que es el que
    // vino a ver.
    return {
      elegido,
      productos: [elegido, ...productos.filter((p) => p !== elegido)],
    };
  }

  // No hubo resultados. Se prueba con la marca, que es lo poco que se
  // puede dar por seguro cuando el modelo concreto no se acertó.
  const marca = primeraPalabra(termino);
  if (!marca || marca.toLowerCase() === String(termino).trim().toLowerCase()) {
    // El término YA era una sola palabra: buscar "Nike" otra vez
    // devolvería lo mismo que acaba de devolver cero.
    return null;
  }

  console.log(`Sin resultados para "${termino}": cotejo la foto contra "${marca}"`);
  const candidatos = await buscarProductos(env, marca, MAXIMO_CANDIDATOS);
  const elegido = await cotejar(env, foto, candidatos, textoCliente);
  if (!elegido) return null;

  // Aquí sí se manda uno solo. El resto son pares distintos que salieron
  // por compartir la marca, no por parecerse a la foto: mandarlos sería
  // enterrar el que pidió entre siete que no.
  return { elegido, productos: [elegido] };
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
