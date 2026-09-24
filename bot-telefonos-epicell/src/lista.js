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

// Con que aparezca una de estas, es un pedido de lista.
const PIDE_LISTA = /\b(listas?|listados?)\b/i;

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
    const primera = String(producto?.titulo || "").trim().split(/\s+/)[0];
    if (!primera || primera.length < 2) continue;

    const clave = despejar(primera);
    const antes = cuenta.get(clave);
    // Se queda la forma en que está escrita en la hoja, no la normalizada:
    // al cliente se le enseña "iPhone", no "iphone".
    cuenta.set(clave, { nombre: antes?.nombre || primera, cuantos: (antes?.cuantos || 0) + 1 });
  }

  return [...cuenta.values()]
    .sort((a, b) => b.cuantos - a.cuantos)
    .map(({ nombre, cuantos }) => ({ nombre, cuantos }));
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
