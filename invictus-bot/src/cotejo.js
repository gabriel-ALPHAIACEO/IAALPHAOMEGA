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

import { buscarProductos, traerCatalogoCompleto } from "./shopify.js";
import { cotejarConCatalogo, estaLimitado, modeloDeVision } from "./ia.js";
import { terminosCompatibles } from "./identificar.js";
import { leerIndice, mejoresPorRasgos, parecidoDeRasgos, puntosDeColor } from "./indice.js";

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

// --- El barrido del catálogo completo -------------------------------
//
// Cuando la ronda dirigida no encuentra el zapato, la única forma de
// saber si está en la tienda es mirarlos TODOS. Caso real que lo pidió:
// un cliente respondió a una historia preguntando el precio, el cotejo
// comparó contra los 10 que había devuelto la búsqueda y contestó
// "ninguno coincide en suela ondulada y corte bajo". Tenía razón sobre
// esos diez — pero el par estaba en el catálogo, en otro estante.
//
// Se hace en lotes porque meter cientos de fotos en una sola llamada
// castiga la precisión: cuantas más mira el modelo de un tirón, más
// fácil es que se conforme con la más parecida. Los lotes van de a
// varios en paralelo para que el cliente no espere dos minutos, y en
// cuanto uno dice "alta" se para: los demás ya no hacen falta.
// EL LÍMITE REAL NO ES EL CATÁLOGO: ES EL CUPO DE OPENAI.
//
// Primera prueba en producción del barrido, 22-sep: catálogo de 400+
// productos, 20 lotes de 20 fotos. OpenAI empezó a devolver 429 en el
// segundo lote —"Limit 30000 TPM, Used 13868, Requested 16908"— y el
// cliente se quedó SIN RESPUESTA, porque el Worker se pasó del tiempo
// que Cloudflare le da a las tareas en segundo plano.
//
// La cuenta que importa: cada lote de 20 fotos son ~17.000 tokens para
// el contador de OpenAI, y el cupo de esta organización son 30.000 por
// minuto. O sea que no entran ni dos lotes seguidos. Barrer 400
// productos así tardaría once minutos; ningún cliente espera eso.
//
// Así que el barrido pasa a ser una pasada CORTA y con presupuesto:
// lotes más chicos, de a dos, un tope de lotes por mensaje y un reloj.
// Se mira lo más prometedor y se contesta. Si hace falta barrer el
// catálogo entero de verdad, la solución no es insistir acá — es subir
// de tier en OpenAI o indexar el catálogo una sola vez (ver README).
const POR_LOTE = 10;
const LOTES_EN_PARALELO = 2;

// Cuántos lotes como máximo por mensaje. Con 2 lotes de 10 el barrido
// entra en el cupo aun contando la identificación de la foto. Se sube
// desde wrangler.toml con COTEJO_LOTES cuando la cuenta de OpenAI
// aguante más.
const LOTES_POR_MENSAJE = 2;

// Cuánto se le permite tardar al barrido, en total. Cloudflare corta las
// tareas en segundo plano, y una respuesta tarde es una venta perdida:
// pasado esto se contesta con lo que haya.
const PRESUPUESTO_MS = 15000;

// Cuántos productos se traen de Shopify para ordenarlos y elegir a quién
// mirar. Traerlos es barato (no gasta modelo), así que conviene tenerlos
// todos aunque después solo se miren los primeros.
const MAXIMO_CATALOGO = 600;

// Cuántos productos del índice se miran. Son los que MÁS se parecen a la
// foto según sus rasgos guardados, así que con 10 sobra: si no está
// entre los diez más parecidos de todo el catálogo, mirar veinte no lo
// va a arreglar.
const DESDE_EL_INDICE = 10;

// Cuántas rondas se bajan por el ranking del índice antes de rendirse.
// Tres rondas son 30 productos, los 30 que MÁS se parecen a la foto de
// todo el catálogo. Más que eso ya no son candidatos, son relleno.
const RONDAS_DEL_INDICE = 3;

// A partir de cuántas filas se considera que el índice ES el catálogo, y
// barrer Shopify deja de tener sentido. Por debajo de esto la indexación
// va a medias y el barrido todavía puede encontrar lo que al índice le
// falta.
const INDICE_SUFICIENTE = 200;

export async function cotejoPorImagen({
  env,
  foto,
  textoCliente,
  productos,
  termino,
  rasgos,
  // El color del zapato de la foto, en una palabra. Es lo que evita
  // mandarle el mismo modelo en otro color — la queja número uno.
  color = "",
  // La frase con lo que la IA VIO en la foto ("cuero blanco, corte bajo,
  // suela plana, sin logo"). Desempata los zapatos lisos, que en los 15
  // rasgos empatan todos entre sí.
  visto = "",
  // El modelo se nombró pero su detalle distintivo no se ve en la foto
  // (ver identificar.js). Entonces el cotejo ya no está desempatando
  // entre varios: está VERIFICANDO que el que se encontró sea el de la
  // foto. Por eso corre aunque haya uno solo — es justo el caso en que
  // hace falta una segunda opinión.
  verificar = false,
  // El barrido del catálogo completo. Se puede apagar desde
  // wrangler.toml con COTEJO_BARRIDO = "no".
  barrer = true,
} = {}) {
  if (!foto) return null;

  // Un solo resultado y nada que verificar: no hay elección que hacer, y
  // descartarlo por una duda del modelo sería cambiar un resultado bueno
  // por ninguno.
  if (productos.length === 1 && !verificar) return null;

  // Cuántos candidatos hacen falta para que valga la pena la llamada.
  const minimo = verificar ? 1 : 2;

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

  // El índice se lee UNA vez, al principio: hace falta para ordenar (trae
  // los rasgos de cada producto del catálogo) y no solo para elegir
  // candidatos al final.
  const indice = await leerIndiceSeguro(env);

  // Primero los del rasgo, después los que ya había: si el cupo de 8 se
  // llena, que lo llenen los que tienen motivo para parecerse.
  //
  // Y ORDENADOS POR COLOR Y RASGOS, que es lo que arregla el "me mostró
  // otro color": diez Adidas sin ordenar son diez tiros al aire, y el
  // modelo solo ve los 8 primeros.
  const pila = ordenar(unir(porRasgos, productos), { color, rasgos, indice });

  // Todo lo que ya se le puso delante al modelo. Lo que descartó no se
  // le vuelve a mostrar en el barrido: sería pagar dos veces por la
  // misma respuesta.
  const yaMirados = new Set();

  if (pila.length >= minimo) {
    const elegido = await cotejar(env, foto, pila, textoCliente, minimo, yaMirados);
    if (elegido) return resultado(elegido, productos, indice);
  }

  // Ni los rasgos ni la búsqueda dieron con él. Queda la marca, que es lo
  // poco que se puede dar por seguro cuando el modelo concreto no se
  // acertó — y solo tiene sentido si la búsqueda no devolvió nada.
  if (!productos.length) {
    const marca = primeraPalabra(termino);

    // Si el término YA era una sola palabra, buscar "Nike" otra vez
    // devolvería lo mismo que acaba de devolver cero.
    if (marca && marca.toLowerCase() !== String(termino).trim().toLowerCase()) {
      console.log(`Sin resultados para "${termino}": cotejo la foto contra "${marca}"`);
      // Se piden más de los que caben: con el orden por color y rasgos,
      // los 8 que se le enseñan al modelo salen de un grupo más grande.
      const { productos: deLaMarca } = await buscarProductos(env, marca, MAXIMO_CANDIDATOS * 3);
      const elegido = await cotejar(
        env,
        foto,
        ordenar(unir(pila, deLaMarca), { color, rasgos, indice }),
        textoCliente,
        minimo,
        yaMirados
      );
      if (elegido) return resultado(elegido, productos, indice);
    }
  }

  // EL ÍNDICE: TODO EL CATÁLOGO, ORDENADO POR PARECIDO.
  //
  // Los rasgos de la foto se comparan contra los de los cientos de
  // productos guardados —en código, sin gastar modelo ni cupo— y solo los
  // mejores van a una llamada de cotejo. Es la forma de mirar el catálogo
  // entero sin las veinte llamadas que el cupo de OpenAI no aguanta.
  //
  // SE BAJA POR EL RANKING, NO SE MIRA UNA VEZ Y YA (24-sep-2026). Antes
  // era una sola ronda de 10: si el par no estaba entre esos diez, se
  // pasaba al barrido a ciegas. Ahora, si la primera ronda falla, van los
  // diez siguientes, y los diez siguientes. Son candidatos ordenados por
  // parecido real, así que la ronda 2 sigue siendo mejor apuesta que
  // veinte productos cualesquiera de Shopify.
  if (indice.length) {
    for (let ronda = 1; ronda <= RONDAS_DEL_INDICE; ronda++) {
      const candidatos = mejoresPorRasgos(indice, rasgos, DESDE_EL_INDICE + yaMirados.size, color, visto)
        .filter((p) => !yaMirados.has(clave(p)))
        .slice(0, DESDE_EL_INDICE);

      if (!candidatos.length) break;

      console.log(
        `Índice (ronda ${ronda}): ${indice.length} productos guardados, ` +
          `miro los ${candidatos.length} más parecidos que aún no vi` +
          (color ? ` (color de la foto: ${color})` : "")
      );

      const elegido = await cotejar(env, foto, candidatos, textoCliente, 1, yaMirados, DESDE_EL_INDICE);
      if (elegido) return resultado(elegido, productos, indice);

      // Si OpenAI se quedó sin cupo, las rondas siguientes fallarían
      // igual y el cliente está esperando.
      if (estaLimitado(modeloDeVision(env))) {
        console.log("Índice: OpenAI sin cupo, corto aquí");
        break;
      }
    }

    // EL BARRIDO NO CORRE CON EL CATÁLOGO INDEXADO (crítico — esto era un
    // gasto puro).
    //
    // Capturado en producción el 24-sep: con los 581 ya indexados, el bot
    // miraba los 10 del índice, fallaba, y acto seguido pedía el catálogo
    // ENTERO a Shopify para barrer "20 de 539" elegidos por parecido de
    // TÍTULO. Dos llamadas más al modelo, medio minuto del cliente, y
    // peores candidatos que los que ya había descartado: el índice ordena
    // por los rasgos de la foto, el barrido por palabras del título de un
    // término que en este caso era "NADA".
    //
    // Si el índice cubre el catálogo, lo que hay que mirar ya se miró.
    if (indice.length >= INDICE_SUFICIENTE) {
      console.log(
        `No barro Shopify: el índice ya cubre el catálogo (${indice.length} productos) ` +
          `y ya miré los ${yaMirados.size} más parecidos a esta foto`
      );
      return null;
    }
  }

  // ÚLTIMO RECURSO: MIRARLOS TODOS, A CIEGAS.
  //
  // Solo se llega aquí si el catálogo NO está indexado —recién desplegado,
  // o una tienda que todavía no corrió su indexación—. Es caro y el cupo
  // de OpenAI apenas deja mirar unos pocos por mensaje: es una red por si
  // acaso, no la vía principal.
  if (!barrer) return null;
  console.log(
    indice.length
      ? `Índice con solo ${indice.length} productos: no cubre el catálogo, barro Shopify`
      : "Sin índice: barro Shopify a ciegas"
  );

  const elegido = await barrerCatalogo(env, foto, textoCliente, { termino, yaMirados });
  if (!elegido) return null;

  return resultado(elegido, productos, indice);
}

// El índice entero, una sola vez. Sin él el bot sigue funcionando: solo
// se queda sin su mejor atajo y cae al barrido.
async function leerIndiceSeguro(env) {
  if (!env.DB) return [];
  try {
    return await leerIndice(env.DB);
  } catch (error) {
    console.error("No pude leer el índice del catálogo:", error?.message || error);
    return [];
  }
}

// Compara la foto contra TODO el catálogo, en lotes y en paralelo.
async function barrerCatalogo(env, foto, textoCliente, { termino, yaMirados }) {
  // Si OpenAI ya dijo que no hay cupo, ni se empieza: serían llamadas
  // que se sabe que van a fallar, y el cliente esperando.
  if (estaLimitado(modeloDeVision(env))) {
    console.log("Barrido: OpenAI sin cupo en este minuto, no lo intento");
    return null;
  }

  const maximo = Number(env.COTEJO_MAXIMO) || MAXIMO_CATALOGO;
  const { productos } = await traerCatalogoCompleto(env, maximo);

  const pendientes = productos.filter(
    (p) => p.imagen && !yaMirados.has(clave(p))
  );

  if (pendientes.length < 1) return null;

  // Los que comparten alguna palabra con lo que se buscó van primero.
  // No es una apuesta: si el término acierta la marca, el par está ahí, y
  // encontrarlo en el primer lote ahorra todos los demás.
  const ordenados = porParecidoDeTitulo(pendientes, termino);
  const tope = Number(env.COTEJO_LOTES) || LOTES_POR_MENSAJE;
  const lotes = enLotes(ordenados, POR_LOTE).slice(0, tope);
  const mirados = lotes.flat().length;

  console.log(
    `Barrido del catálogo: miro ${mirados} de ${ordenados.length} sin mirar ` +
      `(${lotes.length} lote(s) de ${POR_LOTE}; el resto no entra en el cupo de OpenAI)`
  );

  const hasta = Date.now() + PRESUPUESTO_MS;

  // De a dos lotes a la vez, y se corta en cuanto uno acierta.
  for (let i = 0; i < lotes.length; i += LOTES_EN_PARALELO) {
    if (Date.now() > hasta) {
      console.log("Barrido: se acabó el tiempo, contesto con lo que hay");
      break;
    }

    const tanda = lotes.slice(i, i + LOTES_EN_PARALELO);
    const resultados = await Promise.all(
      tanda.map((lote) => cotejarConCatalogo(env, foto, lote, textoCliente))
    );

    // El primero de la tanda, no "cualquiera": el orden de los lotes es
    // el del parecido de título, así que el de más abajo es el que menos
    // motivos tiene para ser.
    const elegido = resultados.find(Boolean);
    if (elegido) {
      console.log(`Barrido: encontrado en el lote ${i + resultados.indexOf(elegido) + 1}`);
      return elegido;
    }

    // Se quedó sin cupo a mitad del barrido: lo que siga va a fallar
    // igual, así que se corta acá y se contesta.
    if (estaLimitado(modeloDeVision(env))) {
      console.log("Barrido: OpenAI se quedó sin cupo, corto el barrido");
      break;
    }
  }

  console.log(`Barrido: no encontré el de la foto entre los ${mirados} que miré`);
  return null;
}

// Ordena dejando delante los títulos que comparten palabra con lo que se
// buscó. Las palabras de menos de 3 letras se ignoran: "de", "la" y los
// números sueltos emparejan con cualquier cosa.
function porParecidoDeTitulo(productos, termino) {
  const palabras = String(termino || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((p) => p.length > 3);

  if (!palabras.length) return productos;

  const puntos = (producto) => {
    const titulo = String(producto.titulo || "").toLowerCase();
    return palabras.filter((p) => titulo.includes(p)).length;
  };

  return [...productos].sort((a, b) => puntos(b) - puntos(a));
}

function enLotes(productos, tamano) {
  const lotes = [];
  for (let i = 0; i < productos.length; i += tamano) {
    lotes.push(productos.slice(i, i + tamano));
  }
  return lotes;
}

function clave(producto) {
  return String(producto.titulo || "").toLowerCase();
}

// Qué se le devuelve a decidir() según de dónde salió el par elegido.
function resultado(elegido, productos, indice = []) {
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

  // SALIÓ DEL ÍNDICE O DE LA MARCA: SE LE ENSEÑA CON SUS HERMANOS.
  //
  // Antes aquí se mandaba el elegido SOLO, para no enterrarlo entre siete
  // que no tienen que ver. Pero en este catálogo el mismo título se
  // repite una vez por color —hay 17 "New Balance 9060 Dama"—, así que
  // los que comparten título son EL MISMO ZAPATO en otros colores. Eso no
  // es ruido: es exactamente lo que el cliente quiere ver después del
  // suyo.
  //
  // El de la foto va PRIMERO y los demás detrás.
  const hermanos = indice.filter(
    (p) => p.titulo === elegido.titulo && p.imagen !== elegido.imagen && p.imagen
  );

  if (hermanos.length) {
    console.log(`Del mismo modelo hay ${hermanos.length} más: van detrás del de la foto`);
  }

  return { elegido, productos: [elegido, ...hermanos.slice(0, MAXIMO_HERMANOS)] };
}

// Cuántos del mismo modelo se enseñan detrás del de la foto. El carrusel
// de Instagram admite 10, y el primero ya está ocupado.
const MAXIMO_HERMANOS = 9;

// ORDENA POR LO QUE DE VERDAD DISTINGUE UN ZAPATO DE OTRO: el color que
// se ve en la foto, y después los rasgos.
//
// Los productos que llegan de Shopify no traen rasgos —eso vive en el
// índice—, así que se emparejan por la URL de su foto, que es la clave
// del índice. El que no esté indexado puntúa solo por color, y queda
// detrás de los que sí: es lo correcto, de ese no sabemos nada.
function ordenar(productos, { color, rasgos, indice }) {
  if (!color && !rasgos) return productos;

  const porFoto = new Map((indice || []).map((p) => [p.imagen, p]));

  return [...productos]
    .map((producto, orden) => {
      const guardado = porFoto.get(producto.imagen);
      const puntos =
        puntosDeColor(producto.titulo, color) +
        (guardado ? parecidoDeRasgos(guardado.rasgos, rasgos) : 0);
      // "orden" mantiene estable el orden original entre empatados.
      return { producto, puntos, orden };
    })
    .sort((a, b) => b.puntos - a.puntos || a.orden - b.orden)
    .map((x) => x.producto);
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

async function cotejar(
  env,
  foto,
  productos,
  textoCliente,
  minimo = 2,
  yaMirados = null,
  // Cuántos se le mandan como mucho. Los del índice pueden ser más que
  // los de una ronda dirigida: vienen ya ordenados por parecido, así que
  // los últimos siguen siendo candidatos con motivo.
  maximo = MAXIMO_CANDIDATOS
) {
  // Sin foto no hay nada que comparar, y un producto sin imagen en el
  // catálogo dejaría al modelo eligiendo por el título — que es
  // justamente lo que este archivo evita.
  const candidatos = productos.filter((p) => p.imagen).slice(0, maximo);
  if (candidatos.length < minimo) return null;

  // Se anotan aunque el cotejo falle: el barrido no tiene por qué volver
  // a pagar por unas fotos que el modelo ya descartó.
  if (yaMirados) candidatos.forEach((p) => yaMirados.add(clave(p)));

  return cotejarConCatalogo(env, foto, candidatos, textoCliente);
}

function primeraPalabra(termino) {
  return String(termino || "").trim().split(/\s+/)[0] || "";
}


// LOS DEL CATÁLOGO QUE MÁS SE PARECEN A LA FOTO, SIN GASTAR UN TOKEN.
//
// Esto NO es el cotejo: no le pregunta nada al modelo y no afirma que
// ninguno sea el de la foto. Compara los 15 rasgos contra los del índice
// —aritmética, milisegundos, cero llamadas— y devuelve los que más
// puntúan.
//
// Para qué. Cuando el cotejo se abstiene y la búsqueda por nombre no dejó
// nada, el bot se quedaba preguntando "¿sabes cómo se llama?". Teniendo
// el catálogo entero indexado eso es absurdo: sabe qué hay y sabe a qué
// se parece la foto. Enseñarle cinco y preguntarle cuál es vende; pedirle
// el nombre de un zapato que no sabe nombrar, no.
export async function parecidosDeLaFoto(env, rasgos, cuantos = 6, color = "", visto = "") {
  if (!env.DB || !rasgos) return [];

  let indice = [];
  try {
    indice = await leerIndice(env.DB);
  } catch (error) {
    console.error("No pude leer el índice para buscar parecidos:", error?.message || error);
    return [];
  }

  if (!indice.length) return [];

  const mejores = mejoresPorRasgos(indice, rasgos, cuantos, color, visto).filter((p) => p.titulo && p.imagen);

  if (mejores.length) {
    console.log(
      `Parecidos del índice (sin gastar modelo): ${mejores.map((p) => p.titulo).join(" · ")}`
    );
  }

  return mejores;
}
