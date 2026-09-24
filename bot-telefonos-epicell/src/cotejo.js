// Cotejo visual: encontrar en el catálogo el equipo de la foto.
//
// QUÉ RESUELVE. Todo el reconocimiento por foto terminaba en un NOMBRE:
// la visión mira la imagen, dice "Redmi Note 14", y ese texto se busca en
// la hoja. Cuando el nombre falla, falla todo — y falla seguido, porque
// hay que acertar cómo se llama un equipo entre decenas, con una foto de
// historia con filtro y un sticker de precio encima. Es el fallo más caro
// del bot: quien responde a una historia ya vio el equipo y lo quiere, y
// se le contesta "¿sabes cómo se llama?".
//
// LA IDEA. La hoja ya trae la foto de cada producto. En vez de adivinar
// el nombre, se le ponen al modelo la foto del cliente y las fotos reales
// del catálogo, una al lado de la otra, y se le pregunta cuál es el mismo
// equipo. Comparar dos imágenes es mucho más fácil que recordar un
// nombre, y el resultado es un producto REAL de la tienda —con su título
// exacto, su precio y su enlace— en vez de un término que ojalá exista.
//
// NUNCA EMPEORA. Si el cotejo no está seguro, o el modelo falla, o la
// hoja no responde, se devuelve null y el bot sigue exactamente como
// seguiría sin este archivo.

import { buscarProductos } from "./sheets.js";
import { cotejarConCatalogo, estaLimitado, modeloDeVision } from "./ia.js";
import { leerIndice, mejoresPorDescripcion, palabrasDe, pesoDeLasPalabras, puntosDeDescripcion } from "./indice.js";

// Cuántas fotos del catálogo se le mandan al modelo de una vez. Con 8 se
// cubre de sobra una familia, y cada una en "detail: low" cuesta poco.
// Subirlo mucho además EMPEORA la comparación: cuantos más equipos mira,
// más fácil es que se conforme con el más parecido.
const MAXIMO_CANDIDATOS = 8;

// Cuántos del índice se miran por ronda.
const DESDE_EL_INDICE = 8;

// Cuántas rondas se bajan por el ranking antes de rendirse. Tres rondas
// son 24 equipos, los 24 que MÁS se parecen a la foto de todo el
// catálogo. Más que eso ya no son candidatos, son relleno.
const RONDAS_DEL_INDICE = 3;

// Cuántos del mismo modelo se enseñan detrás del de la foto.
const MAXIMO_HERMANOS = 9;

export async function cotejoPorImagen({
  env,
  foto,
  textoCliente,
  productos,
  termino,
  // La frase con lo que la IA VIO en la foto. Aquí es TODO lo que hay
  // para ordenar: no hay rasgos ni color (ver indice.js).
  visto = "",
  // La visión nombró un MODELO concreto, no solo la marca. Si además la
  // búsqueda por ese nombre devolvió producto, lo que hay que enseñar ya
  // está encontrado y el índice no pinta nada. Ver abajo.
  nombreFiable = false,
} = {}) {
  if (!foto) return null;

  // Un solo resultado: no hay elección que hacer, y descartarlo por una
  // duda del modelo sería cambiar un resultado bueno por ninguno.
  if (productos.length === 1) return null;

  const indice = await leerIndiceSeguro(env);

  // PRIMERO, LO QUE YA ENCONTRÓ LA BÚSQUEDA, ORDENADO.
  if (productos.length >= 2) {
    const elegido = await cotejar(
      env,
      foto,
      ordenar(productos, { visto, indice }),
      textoCliente,
      2
    );
    if (elegido) return resultado(elegido, productos, indice);
  }

  // EL ÍNDICE NO SUSTITUYE UN NOMBRE QUE YA ACERTÓ (crítico).
  //
  // Aprendido en el bot de calzado, con un caso real: una historia con
  // unos Jordan 40. La visión los nombró bien, la búsqueda devolvió los 5
  // del catálogo, el cotejo no llegó a "alta" sobre ninguno... y entonces
  // las rondas del índice encontraban un "Jordan Lukka" parecido y ESE se
  // le mandaba al cliente, descartando los 5 buenos.
  //
  // El índice existe para cuando el NOMBRE falla. Si el nombre acertó y
  // trajo producto, lo que se enseña son esos: como mucho hay que
  // ordenarlos, nunca cambiarlos por otro modelo.
  if (nombreFiable && productos.length) {
    console.log(
      `La búsqueda por "${termino}" trajo ${productos.length} producto(s) y la visión ` +
        "nombró el modelo: no toco el índice, esos son los que hay que enseñar"
    );
    return null;
  }

  // LA MARCA, cuando la búsqueda por nombre no dejó nada.
  const yaMirados = new Set(
    productos.length >= 2 ? ordenar(productos, { visto, indice }).slice(0, MAXIMO_CANDIDATOS).map(clave) : []
  );

  if (!productos.length) {
    const marca = primeraPalabra(termino);
    if (marca && marca.toLowerCase() !== String(termino).trim().toLowerCase()) {
      console.log(`Sin resultados para "${termino}": cotejo la foto contra "${marca}"`);
      const { productos: deLaMarca } = await buscarProductos(env, marca, MAXIMO_CANDIDATOS * 3);
      const candidatos = ordenar(deLaMarca, { visto, indice }).filter((p) => !yaMirados.has(clave(p)));
      const elegido = await cotejar(env, foto, candidatos, textoCliente, 2, yaMirados);
      if (elegido) return resultado(elegido, productos, indice);
    }
  }

  // EL ÍNDICE: TODO EL CATÁLOGO, ORDENADO POR PARECIDO.
  //
  // La descripción de la foto se compara contra las guardadas —en código,
  // sin gastar modelo ni cupo— y solo los mejores van a una llamada. Se
  // baja por el ranking: si la ronda 1 falla, van los 8 siguientes.
  for (let ronda = 1; ronda <= RONDAS_DEL_INDICE; ronda++) {
    const candidatos = mejoresPorDescripcion(indice, visto, DESDE_EL_INDICE + yaMirados.size)
      .filter((p) => !yaMirados.has(clave(p)))
      .slice(0, DESDE_EL_INDICE);

    if (!candidatos.length) break;

    console.log(
      `Índice (ronda ${ronda}): ${indice.length} productos guardados, ` +
        `miro los ${candidatos.length} más parecidos que aún no vi`
    );

    const elegido = await cotejar(env, foto, candidatos, textoCliente, 1, yaMirados, DESDE_EL_INDICE);
    if (elegido) return resultado(elegido, productos, indice);

    // Si OpenAI se quedó sin cupo, las rondas siguientes fallarían igual
    // y el cliente está esperando.
    if (estaLimitado(modeloDeVision(env))) {
      console.log("Índice: OpenAI sin cupo, corto aquí");
      break;
    }
  }

  return null;
}

// LOS DEL CATÁLOGO QUE MÁS SE PARECEN A LA FOTO, SIN GASTAR UN TOKEN.
//
// Esto NO es el cotejo: no le pregunta nada al modelo y no afirma que
// ninguno sea el de la foto. Para cuando el cotejo se abstiene y la
// búsqueda no dejó nada: en vez de preguntarle al cliente el nombre del
// equipo —que casi nunca sabe, si lo supiera lo habría escrito— se le
// enseñan los que más se parecen y se le pregunta cuál es.
export async function parecidosDeLaFoto(env, visto, cuantos = 6) {
  if (!env.DB || !visto) return [];

  const indice = await leerIndiceSeguro(env);
  if (!indice.length) return [];

  const mejores = mejoresPorDescripcion(indice, visto, cuantos).filter((p) => p.titulo && p.imagen);

  if (mejores.length) {
    console.log(
      `Parecidos del índice (sin gastar modelo): ${mejores.map((p) => p.titulo).join(" · ")}`
    );
  }

  return mejores;
}

// ORDENA LO QUE SE LE VA A ENSEÑAR AL CLIENTE.
//
// Aprendido en el bot de calzado, y fue el fallo más tonto y más caro de
// todos: el orden existía, pero se aplicaba SOLO a la copia que se le
// pasa al modelo para cotejar. Lo que salía por Instagram era la lista
// tal cual la devolvía la fuente. O sea: el bot sabía cuál era el bueno y
// lo mandaba en tercer lugar.
export async function ordenarPorLaFoto(env, productos, { visto } = {}) {
  if (productos.length < 2 || !visto) return productos;

  const indice = await leerIndiceSeguro(env);
  const ordenados = ordenar(productos, { visto, indice });

  if (ordenados[0] !== productos[0]) {
    console.log(`Reordeno para el cliente: primero "${ordenados[0].titulo}"`);
  }

  return ordenados;
}

/* ── Piezas ─────────────────────────────────────────────────────────── */

async function leerIndiceSeguro(env) {
  if (!env.DB) return [];
  try {
    return await leerIndice(env.DB);
  } catch (error) {
    console.error("No pude leer el índice del catálogo:", error?.message || error);
    return [];
  }
}

// Los productos que vienen de la hoja no traen descripción —eso vive en
// el índice—, así que se emparejan por la URL de su foto, que es la clave
// del índice. El que no esté indexado puntúa 0 y queda detrás: es lo
// correcto, de ese no sabemos nada.
function ordenar(productos, { visto, indice }) {
  if (!visto) return productos;

  const porFoto = new Map((indice || []).map((p) => [p.imagen, p]));
  const delaFoto = palabrasDe(visto);
  if (!delaFoto.size) return productos;

  const peso = pesoDeLasPalabras(indice || []);

  return [...productos]
    .map((producto, orden) => {
      const guardado = porFoto.get(producto.imagen);
      const puntos = guardado ? puntosDeDescripcion(guardado.visto, delaFoto, peso) : 0;
      // "orden" mantiene estable el orden original entre empatados.
      return { producto, puntos, orden };
    })
    .sort((a, b) => b.puntos - a.puntos || a.orden - b.orden)
    .map((x) => x.producto);
}

async function cotejar(env, foto, productos, textoCliente, minimo = 2, yaMirados = null, maximo = MAXIMO_CANDIDATOS) {
  // Un producto sin imagen dejaría al modelo eligiendo por el título, que
  // es justamente lo que este archivo evita.
  const candidatos = productos.filter((p) => p.imagen).slice(0, maximo);
  if (candidatos.length < minimo) return null;

  // Se anotan aunque el cotejo falle: no hay por qué volver a pagar por
  // unas fotos que el modelo ya descartó.
  if (yaMirados) candidatos.forEach((p) => yaMirados.add(clave(p)));

  return cotejarConCatalogo(env, foto, candidatos, textoCliente);
}

// Qué se le devuelve a quien llamó, según de dónde salió el elegido.
function resultado(elegido, productos, indice = []) {
  const estaba = productos.some((p) => p.titulo === elegido.titulo);

  // Salió de la búsqueda original: el cliente pidió ESE modelo y los
  // demás son del mismo, así que siguen sirviendo. Lo que cambia es el
  // orden — el de la foto va primero.
  if (estaba) {
    return {
      elegido,
      productos: [elegido, ...productos.filter((p) => p.titulo !== elegido.titulo)],
    };
  }

  // Salió del índice o de la marca. Los que comparten título son el mismo
  // equipo en otra capacidad o cargado dos veces: eso no es ruido, es lo
  // que el cliente quiere ver después del suyo. El de la foto va PRIMERO.
  const hermanos = indice.filter(
    (p) => p.titulo === elegido.titulo && p.imagen !== elegido.imagen && p.imagen
  );

  if (hermanos.length) {
    console.log(`Del mismo modelo hay ${hermanos.length} más: van detrás del de la foto`);
  }

  return { elegido, productos: [elegido, ...hermanos.slice(0, MAXIMO_HERMANOS)] };
}

function clave(producto) {
  return String(producto.titulo || "").toLowerCase();
}

function primeraPalabra(termino) {
  return String(termino || "").trim().split(/\s+/)[0] || "";
}
