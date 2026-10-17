// "MÁNDAME LA LISTA DE SAMSUNG".
//
// QUÉ PIDE ESE CLIENTE, Y POR QUÉ NO ES LO MISMO QUE UNA BÚSQUEDA.
//
// El que pide una lista no está buscando un modelo: está mirando qué hay.
// Y el carrusel de fichas, que es lo mejor para enseñar UN equipo, es lo
// peor para eso: entran diez como máximo, ocupa media pantalla y hay que
// deslizar uno por uno para leer los nombres. De una marca con veinte
// equipos, el cliente ve diez y no sabe que hay más.
//
// Una lista escrita se lee de un vistazo, cabe entera y se puede volver a
// ella para releerla. Así que primero va la lista, y las fotos se ofrecen
// después — que es exactamente como lo pidió el dueño: la lista, y debajo
// "¿Quieres ver las imágenes de esta lista?" con sus dos botones.
//
// Nada de esto pasa por el modelo. No hay nada que redactar: la hoja dice
// qué hay, y adivinar el término de búsqueda dos veces seguidas es
// justamente donde el modelo falla (ver recomendados.js).

// "LISTA" TAMBIÉN ES UN ADJETIVO, Y AHÍ NO PIDE NADA (25-sep-2026).
//
// EL FALLO QUE ESTO ARREGLA. Bastaba la palabra "lista" en cualquier
// sitio, así que "¿cuando esté lista mi compra me avisas?" —o "ya está
// lista?"— le contestaba con los botones de las marcas, como si hubiera
// pedido el catálogo. Una pregunta sobre SU pedido contestada con un menú
// es de las cosas que más cantan a robot.
//
// Así que se piden las formas en que se pide una lista de verdad:
//
//   · con artículo:  "mándame LA lista", "tienes UNA lista?"
//   · con la marca:  "lista DE samsung", "listado DE precios"
//   · con el verbo:  "manda lista", "pasame lista", "hay lista?"
//   · o "listado", que solo es sustantivo.
//
// "esté lista", "está lista", "cuando esté lista" no entran por ninguna,
// que es todo lo que hacía falta.
import { tipoDelProducto } from "./tipos.js";

const PIDE_LISTA = new RegExp(
  [
    "\\blistados?\\b",
    // "esa lista" vale; "esta lista" NO, porque el cliente escribe "esta
    // lista" queriendo decir "está lista" (sin la tilde), y eso es una
    // pregunta por su pedido, no por el catálogo.
    "\\b(el|la|una|unas|los|las|mi|tu|su|esa)\\s+listas?\\b",
    "\\blistas?\\s+(de|del|completa|completas)\\b",
    "\\b(manda|mandame|mandas|envia|enviame|env[ií]as|pasa|pasame|pasas|muestra|muestrame|" +
      "quiero|dame|tienes|tienen|tenes|hay|ver)\\b[^.?!¿¡]{0,20}\\blistas?\\b",
  ].join("|"),
  "i"
);

// "todos los modelos", "todas las marcas que tienen", "todos los equipos".
const TODOS_LOS_MODELOS =
  /\b(todos?|todas?)\s+(los|las)\s+(modelos?|equipos?|tel[eé]fonos?|celulares?|marcas?)\b/i;

// "¿qué modelos de Samsung tienen?", "¿qué equipos manejan?"
const QUE_MODELOS =
  /\bqu[eé]\s+(modelos?|equipos?|tel[eé]fonos?|celulares?|marcas?)\b[^?]{0,30}\b(tienen|tienes|tenes|hay|manejan|manejas|quedan)\b/i;

export function pideLista(texto) {
  const limpio = String(texto || "");
  return PIDE_LISTA.test(limpio) || TODOS_LOS_MODELOS.test(limpio) || QUE_MODELOS.test(limpio);
}

/* ── Las marcas que hay en la hoja ────────────────────────────────── */

// La marca es la PRIMERA palabra del título, que es como están escritos
// los títulos de esta tienda ("Samsung A57", "Poco M8 pro 5G", "iPhone
// 15"). No hay una columna de marca y no hace falta inventarla: si algún
// día la hay, se cambia aquí y ya.
export function marcasDelCatalogo(productos) {
  const cuenta = new Map();

  for (const producto of productos || []) {
    // LA COLUMNA "MARCA" MANDA, Y SI NO HAY, LA PRIMERA PALABRA.
    //
    // EL FALLO QUE ESTO ARREGLA (29-sep-2026, dicho por el dueño: "no
    // muestra más cosas cuando preguntan sobre más modelos"). Adivinar la
    // marca con la primera palabra del título funcionaba con ocho
    // productos de prueba; con el inventario de verdad daba 25 "marcas",
    // y de los once botones que caben en Instagram, cuatro eran "Audifonos",
    // "Reloj", "Base" y "Fan" — mientras Infinix y Honor se quedaban fuera,
    // y Xiaomi no aparecía nunca porque sus títulos empiezan por "Redmi".
    //
    // La hoja tiene una columna Marca. Con ella, las marcas son las que el
    // cliente reconoce.
    const suya = String(producto?.marca || "").trim();
    const nombre = suya || String(producto?.titulo || "").trim().split(/\s+/)[0];
    if (!nombre || nombre.length < 2) continue;

    const clave = despejar(nombre);
    const antes = cuenta.get(clave);

    // Se queda la forma MEJOR ESCRITA de las que hay en la hoja: el mismo
    // inventario trae "Samsung" y "samsung", "Xbyte" y "xbyte", y al
    // cliente se le enseña la que empieza por mayúscula.
    const mejor =
      antes?.nombre && !/^[a-z]/.test(antes.nombre) ? antes.nombre : nombre;

    cuenta.set(clave, {
      nombre: mejor,
      cuantos: (antes?.cuantos || 0) + 1,
      // Cuántos TELÉFONOS tiene esa marca. Las marcas de teléfonos van
      // primero en los botones: es lo que la tienda vende, y en Instagram
      // solo caben once.
      equipos: (antes?.equipos || 0) + (esEquipo(producto) ? 1 : 0),
    });
  }

  return [...cuenta.values()]
    .sort((a, b) => b.equipos - a.equipos || b.cuantos - a.cuantos)
    .map(({ nombre, cuantos }) => ({ nombre: comoSeEnsena(nombre), cuantos }));
}

// ¿ES UN TELÉFONO O UN ACCESORIO?
//
// Para ordenar los botones hace falta saberlo, y la hoja lo dice mejor que
// cualquier lista de palabras: los teléfonos llevan almacenamiento
// ("8GB / 256GB") y los accesorios no, o dicen "N/A". Un cargador no tiene
// gigas.
//
// Si la hoja no trae esa columna, se cae a tipos.js, que lo adivina por el
// título. Ahí un "Game TV Stick" pasa por teléfono —no lleva ninguna
// palabra de accesorio— y por eso la columna manda cuando existe.
function esEquipo(producto) {
  const capacidad = String(producto?.capacidad || "").trim();

  if (capacidad) return !/^n\s*\/?\s*a$/i.test(capacidad);

  return tipoDelProducto(producto?.titulo || "") === "telefono";
}

// "xbyte" en la hoja, "Xbyte" para el cliente. Si la marca viene entera en
// minúscula se le pone la inicial: es un botón que va a ver una persona.
function comoSeEnsena(nombre) {
  return nombre === nombre.toLowerCase() ? nombre[0].toUpperCase() + nombre.slice(1) : nombre;
}

// ¿El cliente nombró alguna de esas marcas? Devuelve la marca tal como
// está escrita en la hoja, para buscarla con esa misma palabra.
export function marcaEnTexto(texto, marcas) {
  const donde = despejar(texto);
  if (!donde) return "";

  // Las largas primero: si escribe "Redmi Note", que gane "Redmi" sobre
  // una marca de dos letras que aparezca dentro de otra palabra.
  const porLargo = [...(marcas || [])].sort((a, b) => b.nombre.length - a.nombre.length);

  for (const { nombre } of porLargo) {
    const suelta = new RegExp(`(^|[^a-z0-9])${escapar(despejar(nombre))}([^a-z0-9]|$)`, "i");
    if (suelta.test(donde)) return nombre;
  }

  return "";
}

/* ── La lista, ya escrita ─────────────────────────────────────────── */

// Un mensaje de Instagram admite 1000 caracteres. Se corta antes para
// dejar sitio a la cabecera y a la pregunta del final.
const POR_MENSAJE = 900;

// Y como mucho dos mensajes de lista. Con más, el cliente deja de leer y
// solo ha recibido notificaciones.
const MAXIMO_MENSAJES = 2;

// Devuelve los mensajes ya escritos y cuántos equipos no cupieron.
//
// "precioDe" lo pone quien llama: así la lista usa el MISMO precio que
// saldría en la ficha (el de Cashea por defecto, el de divisas si lo
// preguntó) y el cliente no ve dos cifras distintas del mismo equipo.
export function mensajesDeLista(productos, { cabecera = "", precioDe = () => "" } = {}) {
  const lineas = (productos || []).map((producto) => {
    const precio = String(precioDe(producto) || "").trim();
    return `🔹 ${producto.titulo}${precio ? ` — ${precio}` : ""}`;
  });

  const mensajes = [];
  let actual = cabecera ? `${cabecera}\n\n` : "";
  let puestas = 0;

  for (const linea of lineas) {
    if (actual.length + linea.length + 1 > POR_MENSAJE) {
      if (mensajes.length + 1 >= MAXIMO_MENSAJES && actual) break;
      mensajes.push(actual.trimEnd());
      actual = "";
      if (mensajes.length >= MAXIMO_MENSAJES) break;
    }
    actual += `${linea}\n`;
    puestas++;
  }

  if (actual.trim() && mensajes.length < MAXIMO_MENSAJES) mensajes.push(actual.trimEnd());

  return { mensajes, puestas, faltan: Math.max(0, lineas.length - puestas) };
}

function despejar(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function escapar(texto) {
  return String(texto).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
