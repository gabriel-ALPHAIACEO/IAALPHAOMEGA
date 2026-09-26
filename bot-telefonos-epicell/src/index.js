// Cerebro del bot de ventas de EPICELL por Instagram.
//
// El catálogo vive en una hoja de Google Sheets: se lee, se filtra y se
// muestra. No hace falta Shopify.
//
// 22-sep-2026: SE RETIRÓ MANYCHAT. Este Worker es el único canal y habla
// directo con la API de Instagram, igual que el bot de Invictus.
//
// Por qué. Con ManyChat había DOS apps recibiendo el mismo webhook de Meta
// —la de ManyChat y la propia— y cada una le contestaba al cliente por su
// cuenta: mensaje duplicado. Coordinarlas no se pudo, porque la API de
// ManyChat no acepta el igsid de Instagram para identificar a un
// subscriber (usa un contact_id propio y no hay endpoint público para
// traducir uno al otro). La solución de fondo es que haya UNA sola app:
// sin un segundo sistema, el duplicado deja de existir por diseño.
//
// Qué cambió respecto de la versión de ManyChat:
//   · La memoria de cada conversación ya no viaja en los campos de otro
//     sistema — vive en D1 (estado.js): historial, nombre, pausa.
//   · Pausa automática cuando un asesor responde a mano desde la app de
//     Instagram, detectada por el ECO del mensaje.
//   · Se borraron manychat.js y nombre.js. El nombre del cliente ya no se
//     cuenta con una marca pegada al historial: tiene su columna en D1.
//
// ──────────────────────────────────────────────────────────────────────
// PARA ADAPTARLO A OTRA TIENDA, lo único que se toca de este archivo es el
// bloque "LO QUE CAMBIA SEGÚN LA TIENDA". El resto sirve igual para
// cualquier catálogo.
// ──────────────────────────────────────────────────────────────────────

import { responderTexto, identificarEnImagen } from "./ia.js";
import { referenciaEnTexto } from "./referencias.js";
// "comoSeLlama" ya existe aquí para el nombre del CLIENTE (estado.js), así
// que el de los tipos entra con su propio nombre.
import { tipoQuePide, tipoDelProducto, comoSeLlama as nombreDelTipo } from "./tipos.js";
import {
  buscarProductos,
  catalogoCompleto,
  diagnosticoHoja,
  listaDeTitulos,
} from "./sheets.js";
import { avisarAsesor } from "./aviso.js";
import { esSoloSaludo, saludoDeVuelta } from "./saludo.js";
import { pideVerMas, fraseDeCatalogo } from "./catalogo.js";
import {
  pideLista,
  marcasDelCatalogo,
  marcaEnTexto,
  mensajesDeLista,
} from "./lista.js";
import { pideVerLoRecomendado, productosRecomendados } from "./recomendados.js";
import { separarColor } from "./color.js";
import {
  separarCapacidad,
  capacidadesDe,
  capacidadDe,
  noLlevaCapacidad,
  comoSeDicen,
  preguntaPorCapacidad,
} from "./capacidad.js";
import { comoDataUri } from "./imagen.js";
import { contextoParaElModelo, recortarHistorial } from "./historial.js";
import {
  leerComentarios,
  esNuestro,
  respuestaPublica,
  respuestaPublicaSinPrivado,
  respuestaPublicaYaAtendido,
  saludoPrivado,
} from "./comentarios.js";
import {
  buscarEnNuestroFeed,
  publicacionPorId,
  terminoDeTitulo,
  enlaceEnTexto,
  esEnlaceDeInstagram,
  leerEnlace,
  marcaDePublicacion,
  PUBLICACION_FRESCA_MS,
} from "./publicacion.js";
import {
  cargarContacto,
  guardarContacto,
  guardarPublicacion,
  publicacionVigente,
  marcarEnvio,
  pausar,
  despausar,
  estaPausado,
  esEcoPropio,
  comentarioNuevo,
  olvidarComentario,
  esEcoPorTexto,
  envioReciente,
  VENTANA_ECO_SIN_TEXTO_MS,
  asegurarColumnas,
  guardarPerfil,
  comoSeLlama,
  revisarBase,
  listarContactos,
} from "./estado.js";
import {
  firmaValida,
  leerMensaje,
  enviarTexto,
  enviarFichas,
  enviarBotonCatalogo,
  enviarConOpciones,
  hayCatalogo,
  quienSoy,
  responderComentario,
  privadoPorComentario,
  obtenerPerfil,
} from "./instagram.js";

// Se sube a mano en cada entrega y sale en /estado: los archivos se copian
// a mano, así que "ya lo pegué" y "ya está desplegado" no son lo mismo.
const VERSION = "2026-09-24 (9) · publicaciones compartidas del feed";

/* ════════════════════════════════════════════════════════════════════
   LO QUE CAMBIA SEGÚN LA TIENDA
   ════════════════════════════════════════════════════════════════════ */

// Lo que se dice cuando la búsqueda no devuelve nada. No afirma que el
// producto no exista ni promete reposición: el bot escribe antes de ver el
// resultado, así que no sabe si hay stock.
const SIN_RESULTADOS =
  "Déjame confirmarte ese modelo con un asesor y te escribo en un momento 😊 " +
  "Mientras, aquí tienes el catálogo completo";

// LAS FORMAS DE PAGO, PALABRA POR PALABRA.
//
// Esto NO lo redacta el modelo, y es a propósito. Son diez números que
// tienen que salir exactos: si el modelo escribe 25% donde va 20%, el
// cliente llega a la tienda con una cuenta que no es y la culpa es del
// bot. Un modelo de lenguaje parafrasea; una constante no.
//
// El prompt sigue sabiendo los niveles —los necesita para contestar "soy
// oro, cuánto pago"— pero cuando la pregunta es "qué formas de pago hay",
// sale esto tal cual.
// LAS DOS FORMAS DE PAGO, EN DOS MENSAJES (24-sep-2026).
//
// Antes era UN solo mensaje con las dos tablas pegadas: diez líneas de
// porcentajes seguidas, sangradas con espacios que Instagram aplasta, y el
// cliente tenía que leerlo entero para encontrar su nivel. Un muro.
//
// Ahora va una plataforma por mensaje, con su título, su emoji y una línea
// por nivel. Se lee de un vistazo y, sobre todo, se distingue de un vistazo
// cuál es cuál — que es el error que más caro sale aquí: cruzar los niveles
// de Cashea (números) con los de Krece (colores).
//
// DOS MENSAJES Y NO TRES: cada uno es una notificación en el teléfono del
// cliente. Dos es una tabla partida en dos; tres ya es el bot hablando solo.
const PAGOS_CASHEA =
  "¡Sí trabajamos con cuotas! 🙌 Tenemos dos opciones 👇\n" +
  "\n" +
  "💳 CASHEA\n" +
  "3 cuotas sin intereses, una cada 14 días 🗓️\n" +
  "\n" +
  "Tu inicial según tu nivel:\n" +
  "🔹 Nivel 1 — 60%\n" +
  "🔹 Nivel 2 — 50%\n" +
  "🔹 Nivel 3 — 30%\n" +
  "🔹 Nivel 4 — 25%\n" +
  "🔹 Nivel 5 — 20%\n" +
  "🔹 Nivel 6 — 20%";

const PAGOS_KRECE =
  "💰 KRECE\n" +
  "Aquí la inicial Y las cuotas van por nivel 👇\n" +
  "\n" +
  "🔵 Azul — 30% inicial · 6 cuotas\n" +
  "⚪ Plata — 25% inicial · 8 cuotas\n" +
  "🟡 Oro — 20% inicial · 8 cuotas\n" +
  "💎 Platino — 15% inicial · 10 cuotas\n" +
  "\n" +
  "¿Con cuál de las dos quieres comprar? 😊\n" +
  "Dime tu nivel y te digo cuánto te queda de inicial 👌";

// Cuándo sale ese mensaje: cuando preguntan por las formas de pago EN
// GENERAL. Si el cliente ya dijo su nivel ("soy oro, cuánto pago"), no
// sale: eso lo contesta el modelo, que sabe leer la frase entera y no
// tiene sentido mandarle la tabla completa a quien ya dijo dónde está.
// Las faltas van ESCRITAS UNA A UNA, no con un patrón que las abarque.
// Lo intenté con un patrón corto y hacía las dos cosas que no debe: se
// dejaba fuera "crece" (la forma más común de escribir Krece) y a la vez
// habría pescado palabras que no vienen al caso. Con nombres de marca no
// hay atajo: se listan.
//
// Van acá y no en el buscador porque esto ni siquiera pasa por él: es la
// pregunta la que se reconoce, no un producto.
//
// "crece" es también una palabra normal en español, pero en un chat de
// venta de teléfonos nadie escribe "crece" hablando de otra cosa. Y si lo
// hiciera, lo que recibe es la tabla de formas de pago: sobra, no miente.
const PREGUNTA_POR_PAGOS = new RegExp(
  "\\b(" +
    [
      "cashea", "cashe", "kashea", "cachea", "casheas",
      "krece", "kreze", "crece", "creze", "kresce", "kreces",
      "cuotas?", "credito", "cr[ée]dito", "financia\\w*",
      "inicial", "abonos?", "plazos?",
    ].join("|") +
    ")\\b",
  "i"
);

// Las señales de que YA sabe de qué habla: su nivel, o un equipo concreto
// en la misma frase. Ahí la tabla entera estorba.
const YA_DIJO_SU_NIVEL =
  /\b(nivel\s*[1-6]|azul|plata|oro|platino|soy\s+\w+)\b/i;

// Lo que se responde cuando preguntan un dato que solo sabe una persona.
const SOLO_ASESOR = "Eso te lo confirma un asesor en un momento 😊";

// Si el modelo falla, el cliente no se queda sin nada y el asesor se entera.
const FALLO_TECNICO =
  "Disculpa, se me trabó el sistema 😅 Un asesor te atiende en un momento";

// LA CAPACIDAD SÍ SE RESPONDE (al revés que el color).
//
// Está escrita en el TÍTULO del catálogo —"iPhone 15 128GB"—, así que el
// bot la sabe de verdad: la lee, no la supone. El color no: el título
// puede decir "Medianoche" y eso no dice qué hay en la tienda hoy.
//
// Estas dos frases las escribe el CÓDIGO, no el modelo, porque el modelo
// redacta antes de ver el resultado de la búsqueda: él no sabe en qué
// capacidades quedó el equipo. Las de aquí sí, porque salen de los
// títulos que volvieron.
const SIN_ESA_CAPACIDAD = [
  "En {pedida} no lo tengo ahora mismo 😅 Pero me queda en {otras}, mira 👇",
  "De ese no me queda en {pedida}, pero sí en {otras} 😊 Míralos 👇",
  "Justo en {pedida} no lo tengo 😅 Lo que sí tengo es en {otras} 👇",
];

// EL TÍTULO NO DICE LOS GIGAS (crítico).
//
// Caso real: el cliente preguntó "¿me dices la capacidad?" sobre un
// Samsung A57 y el bot contestó "tienen 128GB de almacenamiento". El
// título del catálogo dice "Samsung A57" y NADA más — esos 128GB los
// puso el modelo de su propia cosecha, porque es lo que sabe de ese
// equipo por fuera de esta tienda.
//
// Y ahí está el problema: no vendemos "un A57 en general", vendemos el
// que está en la hoja. Si el título no dice la capacidad, no la sabemos
// — igual que no sabemos el color. Decirla es la misma equivocación que
// con los colores, con el mismo final: el cliente llega al mostrador
// esperando algo que nadie le prometió de verdad.
//
// Así que cuando los títulos no traen gigas, esto NO deja hablar al
// modelo: responde el código y se avisa a un asesor.
// El equipo no lleva almacenamiento porque no le corresponde: un reloj,
// unos audífonos, una afeitadora. La hoja lo dice con "N/A", así que no
// es un dato que falte y no hay por qué molestar a un asesor con esto.
const NO_LLEVA_CAPACIDAD = [
  "Ese no maneja almacenamiento 😊 ¿Te ayudo con algo más de él?",
  "Ese equipo no lleva memoria de almacenamiento 😊",
  "Ese no tiene almacenamiento, es otro tipo de equipo 😊",
];

const SIN_DATO_DE_CAPACIDAD = [
  "La capacidad exacta te la confirma un asesor en un momento 😊",
  "Déjame que un asesor te confirme la capacidad exacta en un momento 😊",
  "Eso te lo confirma un asesor en un momento, para no darte un dato equivocado 😊",
];

const CAPACIDADES_QUE_HAY = [
  "De ese lo tengo en {otras} 😊 Mira 👇",
  "Me queda en {otras} 👇",
  "Lo manejo en {otras} 😊 Aquí te los muestro 👇",
];

// Cuando el cliente pide ver los que el bot acaba de nombrar. La lista ya
// existe, así que no hay nada que preguntar ni que redactar.
const AQUI_LOS_TIENES = [
  "¡Claro! Aquí los tienes 👇",
  "¡Con gusto! Míralos 👇",
  "¡Listo! Estos son 👇",
  "Aquí te los muestro 😊 👇",
];

// Había MÁS de los 10 que caben en un carrusel: se le dice y se le pasa el
// catálogo, que es donde sí están todos.
const HAY_MAS_EN_CATALOGO =
  "Tengo más de ese modelo 😊 En el catálogo los ves todos 👇";

// SIN TIENDA ONLINE, ESE MENSAJE NO SE MANDA (24-sep-2026, decisión del
// dueño).
//
// Iba pegado debajo del carrusel —"Tengo más de ese modelo 😊 En el
// catálogo los ves todos 👇"— y manda a una tienda que EPICELL no tiene.
// No se sustituye por otra frase: se quita. Un tercer mensaje detrás de
// las fotos es una notificación más para no decir nada.
//
// Cuando haya catálogo de verdad (URL_CATALOGO puesto), vuelve solo con su
// botón, sin tocar el código.

// Lo que sí se queda, porque no habla de ninguna tienda: cuando no se
// encuentra el modelo, la respuesta sigue siendo el asesor.
const SIN_RESULTADOS_SIN_CATALOGO =
  "Déjame confirmarte ese modelo con un asesor y te escribo en un momento 😊";

// Y CUANDO LO QUE NO HAY ES UN TIPO ENTERO, SE DICE ASÍ.
//
// "Forros no manejo ahora mismo" es una respuesta; "déjame confirmarte ese
// modelo con un asesor" no lo es, porque no se trataba de ningún modelo.
// Al cliente que pide un accesorio que esta tienda no vende hay que
// decírselo claro, y seguir vendiendo.
const NO_HAY_DE_ESE_TIPO = [
  "{tipo} no manejo ahora mismo 😊 ¿Te ayudo con algún equipo?",
  "De {tipo} no tengo por ahora 😅 ¿Buscas algún teléfono?",
  "Ahorita no tengo {tipo} 😊 Dime qué equipo te interesa y te ayudo",
];

function fraseSinResultados(env, tipo = "") {
  if (tipo && tipo !== "telefono") {
    return alAzar(NO_HAY_DE_ESE_TIPO).replace("{tipo}", nombreDelTipo(tipo));
  }
  return hayCatalogo(env) ? SIN_RESULTADOS : SIN_RESULTADOS_SIN_CATALOGO;
}

// ¿Se le dice que hay más de ese modelo? Solo si hay una tienda a la que
// mandarlo. Vive aparte para poder comprobarlo sin levantar el bot entero.
function hayQueDecirQueHayMas(env) {
  return hayCatalogo(env);
}

// Los datos que el catálogo NO guarda y que decide una persona. Cuando el
// cliente pregunta por uno, se avisa al asesor aunque el bot le esté
// mostrando producto, porque suele ser la última pregunta antes de comprar.
//
// Ojo con las tildes: van las dos formas, porque los clientes escriben sin
// acentos.
//
// "Cuotas", "crédito" y "financiamiento" NO están aquí: el bot conoce
// Cashea y Krece y las contesta él. Lo que de esas dos no se sabe lo
// decide el prompt, no esta lista.
const CONSULTA_DE_ASESOR =
  /\b(garant[ií]a|permuta|parte de pago|factura|repara\w*|liberad[oa]|liberaci[óo]n|seguro|bater[ií]a|ciclos)\b/i;

// LAS FORMAS DE PAGO A CUOTAS YA NO ESCALAN (23-sep-2026).
//
// Aquí vivía CONSULTA_DE_CREDITO_GENERICO, que mandaba al asesor todo lo
// que dijera "cuotas", "crédito" o "financiamiento". Estaba bien mientras
// el bot no tenía el dato: prometer un plan de pago que no conoces es la
// peor forma de perder una venta.
//
// Ya lo tiene. El dueño pasó las dos formas completas —Cashea (inicial
// por nivel, 3 cuotas cada 14 días) y Krece (inicial y cuotas por nivel)—
// y están escritas en texto.txt. Escalar una pregunta que el bot sabe
// responder es hacer esperar al cliente por nada.
//
// Lo que sigue siendo del asesor ya no lo decide una lista de palabras
// sueltas, sino el prompt, que enumera lo que NO se sabe: montos mínimos,
// cómo se sube de nivel, qué pasa si el cliente se atrasa, y cada cuánto
// se pagan las cuotas de Krece. Una lista de palabras no sabe distinguir
// "¿puedo pagar a cuotas?" de "¿y si me atraso en una cuota?"; el prompt
// sí, porque lee la frase entera.
//
// Si algún día aparece una tercera forma de pago sin datos, esto vuelve:
// una constante acá y una condición en esConsultaDeAsesor.

/* ── "MÁNDAME LA LISTA DE SAMSUNG" ────────────────────────────────
   El cliente que pide una lista está mirando qué hay, no buscando un
   modelo. Se le manda la lista ESCRITA —que se lee de un vistazo y cabe
   entera— y las fotos se le ofrecen después, con dos botones. Ver
   lista.js para el porqué.
   ───────────────────────────────────────────────────────────────── */

// Lo que viaja en el botón. El bot mira ESTO, no el título: así el
// título se puede cambiar cuando se quiera sin romper nada.
// Y el de cada marca cuando se le preguntan cuál quiere: "LISTA_Samsung".
const OPCION_MARCA = "LISTA_MARCA_";

const OPCION_VER_SI = "LISTA_VER_IMAGENES_SI";
const OPCION_VER_NO = "LISTA_VER_IMAGENES_NO";

const TITULO_VER_SI = "¡Sí, claro!";
const TITULO_VER_NO = "No, gracias";

const PREGUNTA_IMAGENES = "¿Quieres ver las imágenes de esta lista? 📸";

const AQUI_LAS_IMAGENES = [
  "¡Aquí las tienes! 👇",
  "¡Listo! Mira 👇",
  "¡Con gusto! Te las muestro 👇",
];

const SIN_IMAGENES = [
  "¡Listo! 😊 Si quieres ver alguno en particular, dime cuál y te lo muestro",
  "¡De acuerdo! 😊 Cualquier equipo de esos que te interese, dime el nombre",
  "¡Perfecto! Si te llama la atención alguno, dímelo y te paso los detalles 😊",
];

// El cliente contesta que sí sin tocar el botón: "si", "dale", "claro".
// Solo cuenta cuando lo ÚLTIMO que se le preguntó fue justamente eso.
const DICE_QUE_SI = /^\s*(s[ií]|s[ií]\s*(claro|porfa|por favor|please)|claro|dale|ok|oka|okay|va|bueno|de una|obvio|perfecto|mu[eé]strame\w*|ens[eé][ñn]a\w*)\s*[.!]*\s*$/i;
const DICE_QUE_NO = /^\s*(no|nop|no gracias|no, gracias|as[ií] est[aá] bien|despu[eé]s|luego|ahorita no)\s*[.!]*\s*$/i;

function leOfrecimosLasImagenes(contacto) {
  return String(contacto?.ultima_respuesta || "").includes("las imágenes de esta lista");
}

// DECIR "NO TENGO" DE ALGO QUE SÍ ESTÁ (crítico).
//
// EL FALLO QUE ESTO ARREGLA, del registro del dueño:
//
//   Cliente:  "Tienes Poco X8 pro?"
//   Buscó:    "Poco" → 4 resultados
//   Mandó:    "No tengo el Poco X8 Pro en este momento 😊 Pero te muestro
//              los equipos de la marca Poco..."
//   Fichas:   Poco X8 pro 5G · Poco M8 pro 5G · Poco M8 pro 5G · Poco C81
//
// El primer equipo del carrusel ERA el que decía no tener. El cliente lee
// "no tengo" y se va; la foto de lo que pidió le pasa por delante sin que
// la mire.
//
// El modelo escribe ANTES de ver el resultado de la búsqueda, así que esa
// frase es siempre una apuesta. Aquí ya no: si entre lo que se le va a
// enseñar está lo que pidió, la negación se cambia por un sí, y se cambia
// en código, que es lo único que ve las dos cosas a la vez.
const AFIRMA_QUE_NO_HAY =
  /\bno\s+(?:lo\s+|la\s+|los\s+|las\s+|me\s+|te\s+)?(?:tengo|tenemos|manejo|manejamos|hay|queda|quedan|contamos|dispongo)\b|\bno\s+(?:est[aá]|est[aá]n)\s+disponible|\bagotad[oa]/i;

const SI_LO_TENGO = [
  "¡Claro que sí! Aquí lo tienes 👇",
  "¡Sí lo tengo! Mira 👇",
  "¡Por supuesto! Te lo muestro 👇",
  "¡Claro! Este es 👇",
];

// NO TENGO ESE, PERO MIRA ESTOS.
//
// EL FALLO QUE ESTO ARREGLA (24-sep-2026). "Precio de los cables dophin" y
// el bot contestó, en texto y sin una sola foto: "No tengo cables Dophin
// por ahora. Si te interesa, aquí están los cables que tengo disponibles:"
// y seis nombres escritos.
//
// Eso es un inventario, no una venta. El cliente pidió cables: hay que
// enseñarle cables, con su foto y su precio, que es lo que hace que elija
// uno. La lista escrita no vende nada.
const NO_ESE_PERO_MIRA = [
  "Ese exacto no lo tengo ahora 😊 Pero mira estos, que te pueden servir 👇",
  "De ese no me queda 😅 Te muestro los que sí tengo 👇",
  "Justo ese no lo manejo 😊 Pero estos van por la misma línea, míralos 👇",
];

// Lo que se le dice cuando vuelve a pedir lo mismo en divisas. No hace
// falta buscar nada: son los equipos que acaba de ver.
const PRECIOS_EN_DIVISAS = [
  "¡Claro que sí! 💵 Estos son los precios en divisas 👇",
  "¡Con gusto! 💵 Aquí te van en divisas 👇",
  "¡Por supuesto! Te los paso en divisas 💵 👇",
];

// Compartió una publicación y no hay forma de saber qué equipo es: ni la
// imagen, ni su pie de foto, ni lo que escribió el cliente lo nombran.
//
// Se le PREGUNTA. Lo que no se hace nunca es contestar con el equipo del
// que se venía hablando: pasó en producción —un cliente mandó el enlace
// de una publicación del POCO M8 PRO y el bot le contestó con el Samsung
// A57, que era el de la conversación anterior—. Enseñar el equipo
// equivocado con seguridad es peor que preguntar.
// LLEGÓ ALGO QUE NO SE PUEDE LEER: NI TEXTO, NI FOTO, NI PUBLICACIÓN.
//
// EL FALLO QUE ESTO ARREGLA (24-sep-2026, visto en el registro). Un cliente
// compartió un post y Meta lo mandó con un adjunto que el código no sabía
// leer. El mensaje llegó EN BLANCO, y el modelo —que no puede contestar la
// nada— rellenó con lo último del historial: le mandó cuatro Poco
// cualesquiera a alguien que había señalado uno concreto.
//
// Un mensaje vacío no se contesta con el pasado. Se dice que no llegó y se
// pregunta, que es lo que haría cualquiera. Sin saludo: esto también le
// pasa a clientes que ya vienen hablando.
const NO_PUDE_ABRIRLO = [
  "Eso no me llegó completo 😅 Dime cuál equipo te interesa y te lo muestro",
  "No pude abrir lo que me mandaste 😅 ¿Cuál equipo estás buscando?",
  "Se me trabó eso que mandaste 😅 Dime el modelo y te paso el precio enseguida",
];

const PUBLICACION_SIN_IDENTIFICAR = [
  "¡Claro que sí! 😊 Dime cuál de los equipos de esa publicación te interesa y te paso el precio",
  "¡Con gusto! ¿Cuál viste en esa publicación? Dime el modelo y te lo muestro enseguida",
  "¡Por supuesto! 😊 Dime el nombre del equipo que viste ahí y te doy toda la información",
];

// La plataforma de compra a crédito. Cuando el cliente la nombra, se le
// muestra el precio Cashea de la ficha junto al precio normal.
const PREGUNTA_CASHEA = /\bcashea\b/i;

// El precio en divisas solo sale cuando el cliente lo pide con estas
// palabras; por defecto la ficha muestra el precio Cashea.
const PREGUNTA_DIVISAS = /\b(divisas?|d[oó]lares?|usd)\b/i;

// ¿PIDIÓ EL PRECIO EN DIVISAS DE LO MISMO, O DE OTRA COSA?
//
// EL FALLO QUE ESTO ARREGLA (25-sep-2026). El atajo de divisas vuelve a
// mandar los equipos del último carrusel, y para saber si el cliente
// hablaba de OTRO producto solo miraba si nombraba un título completo del
// catálogo. Así que "¿y los cables en divisas?", justo después de ver dos
// Samsung A57, le devolvía los dos Samsung otra vez con el precio en
// divisas. Es el mismo error de fondo que el del enlace del Poco: darle un
// precio correcto del producto equivocado.
//
// La pregunta no se le hace a una lista de palabras, se le hace a la hoja:
// si alguna palabra del mensaje aparece en los títulos del catálogo, está
// nombrando algo que vendemos, y eso hay que buscarlo. Si no —"¿y en
// divisas?", "¿cuánto en dólares, amigo?"— habla de lo que acaba de ver.
//
// Se piden 4 letras y se descartan las de relleno porque "de", "con",
// "pro" o "plus" están en medio catálogo y no nombran nada.
const DEMASIADO_GENERICAS = new Set([
  "para",
  "plus",
  "mini",
  "dual",
  "nuevo",
  "nueva",
  "nuevos",
  "original",
  "originales",
  "sellado",
  "sellada",
  "sellados",
  "precio",
  "precios",
]);

function palabrasDeProducto(texto) {
  return despejar(texto)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((palabra) => palabra.length >= 4 && !DEMASIADO_GENERICAS.has(palabra));
}

// EL CLIENTE ESCRIBE EN PLURAL LO QUE LA HOJA TIENE EN SINGULAR.
//
// Pide "cables" y el título dice "Cable Tipo C"; pide "cargadores" y dice
// "Cargador". Comparar las palabras enteras falla en los dos casos, y
// recortar la S tampoco cuadra ("cables" da "cabl", "cargadores" da
// "cargadore"). Así que basta con que una empiece por la otra, con cuatro
// letras de por medio: "cable" está dentro de "cables", y "cargador"
// dentro de "cargadores", sin inventar reglas de gramática.
function mismaPalabra(una, otra) {
  return una === otra || una.startsWith(otra) || otra.startsWith(una);
}

function nombraAlgoDeLaHoja(texto, catalogo) {
  const enLaHoja = new Set();

  for (const producto of catalogo) {
    for (const palabra of palabrasDeProducto(producto.titulo)) enLaHoja.add(palabra);
  }

  const deLaHoja = [...enLaHoja];
  return palabrasDeProducto(texto).some((palabra) =>
    deLaHoja.some((suya) => mismaPalabra(palabra, suya))
  );
}

// LOS COLORES SON DEL ASESOR (22-sep-2026, decisión del dueño).
//
// El catálogo dice qué MODELOS hay, no qué colores quedan en la tienda
// hoy. Un color afirmado de más es una venta que se cae en el mostrador,
// con el cliente ya convencido. Así que el bot no opina de colores: ni
// para confirmar, ni para descartar.
//
// No es lo mismo preguntar POR el color que nombrar uno de paso. "¿de qué
// colores hay?" es una pregunta para el asesor; "el iPhone 15 blanco" es
// un cliente pidiendo un iPhone 15, y a ese hay que mostrárselo — sin el
// color, que lo confirma una persona. Por eso el color se le quita al
// término de búsqueda SIEMPRE (ver separarColor más abajo), pero solo se
// escala cuando la pregunta es sobre el color en sí.
// Se detecta de dos formas, porque el cliente pregunta de dos formas:
//
//   · Nombrando un color — "el iPhone 15 blanco", "lo tienen en negro".
//     Eso NO se persigue con una lista de frases hechas, que siempre se
//     queda corta: se busca si en su mensaje aparece un color, usando la
//     misma tabla con la que se limpia el término (color.js).
//   · Preguntando POR los colores sin nombrar ninguno — "¿de qué colores
//     hay?". Ahí no hay color que detectar, así que esto sí va por frase.
const PREGUNTA_POR_COLOR =
  /\b(colores?|color)\b/i;

// Palabras que el cliente usa pero que NO existen en los títulos del
// catálogo, así que hay que quitarlas del término antes de buscar. Si se
// cuelan, la búsqueda devuelve cero productos y el cliente cree que no
// tienes el modelo.
//
// OJO: la capacidad (128GB, 256GB, 1TB) NO se quita — sí aparece en los
// títulos de tecnología, al revés que las tallas de ropa.
const RUIDO_EN_BUSQUEDA =
  /\b(baratos?|econ[óo]micos?|en oferta|de segunda|usados?)\b/gi;

/* ════════════════════════════════════════════════════════════════════
   DE AQUÍ ABAJO NO HACE FALTA TOCAR NADA
   ════════════════════════════════════════════════════════════════════ */

// Lo que se le dice al cliente mientras un asesor lleva la conversación.
const YA_TE_ATIENDEN = [
  "¡Hola! Un asesor ya está viendo tu mensaje y te responde en un momento 😊",
  "Un asesor tiene tu conversación y te escribe enseguida 😊",
  "¡Gracias por escribir! Un asesor te atiende en un momento 😊",
  "Ya un asesor está pendiente de ti, te responde enseguida 😊",
];

// Cada cuánto se le puede repetir. Si escribe cinco mensajes seguidos no
// recibe cinco veces lo mismo: eso sí parecería un robot averiado.
const AVISO_PAUSA_CADA_MS = 10 * 60 * 1000;

function alAzar(frases) {
  return frases[Math.floor(Math.random() * frases.length)];
}

function limpiarTermino(termino) {
  return String(termino || "")
    .replace(RUIDO_EN_BUSQUEDA, " ")
    .replace(/\s+/g, " ")
    .trim();
}
// Con una pausa muy corta el bot se mete en medio de la venta. Y justo en
// lo que no puede: el asesor está hablando de garantía, financiamiento,
// permutas y envíos —lo único que el bot tiene PROHIBIDO responder— así
// que aparecer ahí con un carrusel no es un detalle feo, es reventar el
// cierre.
//
// Una hora después del último mensaje del asesor es tiempo de sobra para
// que termine, y poco para que el cliente se quede tirado. Se puede tocar
// en wrangler.toml sin tocar el código, y admite decimales: 0.5 = 30 min.
const PAUSA_HORAS_POR_DEFECTO = 1;
//
// El asesor terminó y quiere que el bot siga. Antes había que esperar a que
// venciera la pausa o pegar un comando en la terminal. Ahora basta con que
// el asesor mande, en ese mismo chat, un mensaje que contenga esta frase:
//
//   "Te dejo con la asistente virtual, ella te sigue ayudando 😊"
//
// Lo cómodo es tenerlo como RESPUESTA GUARDADA de Instagram: sale como un
// botón justo encima del teclado del chat y se manda con un toque. El
// cliente lo lee como una despedida normal del asesor —que es lo que es—
// y el bot vuelve a atenderlo desde su siguiente mensaje.
//
// Se compara sin tildes, sin mayúsculas y sin signos, y basta con que la
// frase aparezca DENTRO del mensaje: "Listo! te dejo con la asistente 👋"
// también vale. Se cambia en wrangler.toml (FRASE_DESPAUSAR) sin tocar código.
const FRASE_DESPAUSAR_POR_DEFECTO = "te dejo con la asistente";

// Lo que el bot anota en el historial al recibir la conversación de vuelta,
// para no saludar de cero a alguien con quien un asesor ya estuvo hablando.
const NOTA_DESPAUSADO = "Un asesor lo atendió a mano y me devolvió la conversación.";

function fraseDespausar(env) {
  return String(env.FRASE_DESPAUSAR || FRASE_DESPAUSAR_POR_DEFECTO).trim();
}

function esFraseDeDespausar(env, texto) {
  const frase = sinSignos(fraseDespausar(env));
  return Boolean(frase) && sinSignos(texto).includes(frase);
}

function sinSignos(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Cuánto se espera antes de dar por bueno que un eco no es nuestro. Es el
// tiempo que le damos a la otra petición —la que está respondiendo al
// cliente en paralelo— para terminar de anotar sus mids en D1.
const ESPERA_ANTES_DE_PAUSAR_MS = 4000;

// Y a partir de cuánto silencio del asesor se entiende que se distrajo y
// hay que llamarlo por Slack. Si está contestando ahí mismo, avisarle de
// que "hay un cliente esperando" sobra y molesta.
const ASESOR_CALLADO_MS = 15 * 60 * 1000;

// CUÁNTO SE ESPERA A QUE LLEGUE LA PREGUNTA DETRÁS DE LA PUBLICACIÓN.
//
// El cliente comparte el post y escribe acto seguido: "precio?", "¿cuánto
// cuesta?", "¿lo tienen?". Son dos mensajes, y Meta los manda como dos
// webhooks que se atienden en paralelo. Si la publicación contesta sola y
// al segundo después contesta la pregunta, el cliente recibe dos mensajes
// por una sola cosa — que es lo que pasó.
//
// Así que cuando la publicación llega SIN texto, se le dan unos segundos a
// la pregunta. Si llega, ella contesta por las dos (con la publicación
// delante, que para eso quedó guardada en D1). Si no llega, contesta la
// publicación. Esta espera solo ocurre en ese caso; ningún otro mensaje se
// retrasa ni un milisegundo.
const ESPERA_POR_LA_PREGUNTA_MS = 5000;

// CUANTO AGUANTA UNA PAUSA CON EL ASESOR CALLADO (24-sep-2026).
//
// EL PROBLEMA QUE ESTO RESUELVE, dicho por el dueno: "pausa a los clientes
// sin razon y si siguen preguntando deja de responder".
//
// Las dos mitades importan. Una pausa falsa se puede colar por varios
// caminos —un eco con un mid que no cuadra, una escritura en D1 que llego
// tarde— y taparlos uno por uno no garantiza que no aparezca el siguiente.
// Lo que si se puede garantizar es el DANO: que una pausa no sobreviva si
// del otro lado no hay nadie.
//
// Asi que la pausa deja de ser un cheque en blanco de una hora. Si el
// cliente vuelve a escribir y el asesor lleva este rato sin decir una
// palabra, el bot retoma la conversacion y contesta. Un asesor que esta
// atendiendo escribe, y cada mensaje suyo reinicia el reloj: a ese no se
// le pisa nunca.
//
// Se cambia en wrangler.toml (PAUSA_VUELVE_MIN) sin tocar el codigo.
const VUELVE_SI_EL_ASESOR_CALLA_MIN = 10;

function minutosParaVolver(env) {
  const puesto = Number(env.PAUSA_VUELVE_MIN);
  return puesto > 0 ? puesto : VUELVE_SI_EL_ASESOR_CALLA_MIN;
}

const NOTA_VOLVI_SOLO =
  "El asesor dejo de escribir y el cliente seguia preguntando: volvi a atender.";


export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Meta comprueba que la URL es tuya antes de mandarte nada: te pide el
    // token que pusiste en el panel y espera que le devuelvas su desafío.
    //
    // ESTO ES LO QUE FALTABA cuando el panel decía "No se ha podido validar
    // la URL de devolución de llamada": el Worker contestaba su cartel de
    // "bot activo" a todo, y Meta necesita recibir el desafío y NADA más.
    if (url.pathname === "/webhook" && request.method === "GET") {
      const modo = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const desafio = url.searchParams.get("hub.challenge");

      if (modo === "subscribe" && token && token === env.META_VERIFY_TOKEN) {
        console.log("Meta verificó el webhook");
        return new Response(desafio || "", { status: 200 });
      }
      console.error("Meta intentó verificar con un token que no coincide");
      return new Response("token incorrecto", { status: 403 });
    }

    if (url.pathname === "/webhook" && request.method === "POST") {
      // Se lee el cuerpo CRUDO: la firma se calcula sobre los bytes tal
      // como llegaron, así que volver a serializar el JSON la rompería.
      const crudo = await request.text();
      const cabecera = request.headers.get("x-hub-signature-256");

      // Meta tiene DOS claves secretas y las dos miden 32 caracteres, así
      // que no se distinguen a ojo:
      //
      //   · la de la app de Facebook   → Configuración → Básica
      //   · la de Instagram            → producto Instagram → Configuración
      //                                   de la API con inicio de sesión
      //
      // Los webhooks de Instagram se firman con la SEGUNDA. Como acertar a
      // la primera es cuestión de suerte, se prueban las dos y el registro
      // dice cuál funcionó: así se carga esa y se borra la otra.
      const claves = [
        ["META_APP_SECRET", env.META_APP_SECRET],
        ["META_APP_SECRET_IG", env.META_APP_SECRET_IG],
      ].filter(([, valor]) => valor);

      let cualFuncionó = "";
      for (const [nombre, valor] of claves) {
        if (await firmaValida(valor, cabecera, crudo)) {
          cualFuncionó = nombre;
          break;
        }
      }

      if (!cualFuncionó) {
        // A Meta se le responde 200 IGUAL. Parece raro, pero es lo correcto:
        // un 401 le dice "no te llegó" y lo reintenta, y el reintento vuelve
        // a fallar, y otra vez. El mensaje se descarta igual; solo se le
        // quita a Meta el motivo para insistir.
        console.error(
          "Webhook con firma inválida: lo ignoro. " +
            (!claves.length
              ? "CAUSA: no hay ninguna clave cargada. Ejecuta: " +
                "wrangler secret put META_APP_SECRET_IG"
              : !cabecera
                ? "CAUSA: la petición no trae la cabecera x-hub-signature-256. " +
                  "¿Seguro que viene de Meta?"
                : `CAUSA: ninguna de las claves cargadas (${claves
                    .map(([n]) => n)
                    .join(", ")}) firma este mensaje. Los webhooks de ` +
                  "Instagram se firman con la clave del producto Instagram, " +
                  "NO con la de Configuración → Básica. Cárgala con: " +
                  "wrangler secret put META_APP_SECRET_IG")
        );
        return new Response("ok", { status: 200 });
      }

      console.log(`Firma válida con ${cualFuncionó}`);

      // El descarte va AQUÍ, antes de nada. Meta manda cientos de avisos al
      // día que no necesitan respuesta, y esto hace que cada uno cueste
      // exactamente cero: ni OpenAI, ni Google Sheets, ni un envío.
      // Una lista, porque Meta junta varios comentarios en un solo aviso.
      const porAtender = queAtender(env, crudo);

      // A Meta se le responde 200 siempre y rápido. Si tarda o falla, lo
      // reintenta y el cliente acaba recibiendo la misma respuesta varias
      // veces; y si falla mucho, Meta desactiva el webhook.
      for (const uno of porAtender) ctx.waitUntil(atenderConRed(env, uno));
      return new Response("ok", { status: 200 });
    }

    // Todo lo que hace falta saber para arreglar un despliegue: qué versión
    // está puesta, qué secretos faltan y si la base responde.
    if (url.pathname === "/estado") {
      const secreto = (nombre) => {
        const valor = env[nombre];
        return valor ? `cargado (${String(valor).length} caracteres)` : "FALTA";
      };

      const base = await revisarBase(env.DB, {
        fraseDespausar: fraseDespausar(env),
        // Para que los comandos que imprime se puedan copiar tal cual:
        // cada bot tiene SU base, y estado.js es el mismo archivo en todos.
        base: env.D1_NOMBRE || "tu-base-d1",
      });

      return texto200(
        [
          `CÓDIGO DESPLEGADO   ${VERSION}`,
          "  Si esta línea no coincide con la última versión que pegaste,",
          "  el despliegue no llegó: vuelve a correr `wrangler deploy`.",
          "",
          "SECRETOS",
          `  OPENAI_API_KEY      ${secreto("OPENAI_API_KEY")}`,
          `  SLACK_WEBHOOK       ${secreto("SLACK_WEBHOOK")}`,
          `  META_APP_SECRET     ${secreto("META_APP_SECRET")}   (la de Facebook)`,
          `  META_APP_SECRET_IG  ${secreto("META_APP_SECRET_IG")}   (la de Instagram ← es esta)`,
          `  IG_TOKEN            ${secreto("IG_TOKEN")}`,
          "",
          "CONFIGURACIÓN (wrangler.toml)",
          `  META_MODO           ${env.META_MODO || "todo (por defecto)"}`,
          `  META_VERIFY_TOKEN   ${env.META_VERIFY_TOKEN ? "puesto" : "FALTA"}`,
          `  SHEET_ID            ${env.SHEET_ID && !/PEGA_AQUI/i.test(env.SHEET_ID) ? "puesto" : "FALTA"}`,
          `  SHEET_NOMBRE        ${env.SHEET_NOMBRE || "FALTA"}`,
          `  URL_CATALOGO        ${env.URL_CATALOGO && !/CAMBIA-ESTO/i.test(env.URL_CATALOGO) ? env.URL_CATALOGO : "FALTA"}`,
          `  WHATSAPP            ${String(env.WHATSAPP || "").replace(/\D/g, "") ? "puesto" : "sin poner (no sale el botón Comprar)"}`,
          `  PAUSA_HORAS         ${env.PAUSA_HORAS || `${PAUSA_HORAS_POR_DEFECTO} (por defecto)`}`,
          `  PAUSA_VUELVE_MIN    ${minutosParaVolver(env)} min   (si el asesor calla ese rato y el cliente escribe, el bot retoma)`,
          `  FRASE_DESPAUSAR     "${fraseDespausar(env)}"   (el asesor la manda en el chat y el bot vuelve)`,
          `  OPENAI_MODELO       ${env.OPENAI_MODELO || "gpt-4o-mini (por defecto)"}   (el que redacta)`,
          `  OPENAI_MODELO_VISION ${env.OPENAI_MODELO_VISION || "gpt-4o (por defecto)"}   (el que mira las fotos)`,
          "",
          "BASE DE DATOS (D1) — la memoria del bot entre mensajes",
          ...base.lineas,
          "",
          "ManyChat está retirado. Este Worker es el único canal: habla",
          "directo con la API de Instagram y guarda su propia memoria en D1.",
          "",
          "El webhook de Instagram tiene que estar suscrito a `messages` Y a",
          "`message_echoes`. Sin el segundo no funciona la pausa automática",
          "cuando un asesor responde a mano desde la app.",
          "",
          "Los webhooks se firman con la clave del producto Instagram, no con",
          "la de Configuración → Básica. Si el registro dice que la firma no",
          "cuadra, carga la otra:",
          "  npx wrangler secret put META_APP_SECRET_IG",
          "",
        ].join("\n")
      );
    }

    // LOS CONTACTOS QUE EL BOT FUE GUARDANDO.
    //
    // No hay que hacer nada para que se guarden: en cuanto un cliente
    // escribe por primera vez, el bot le pide el perfil a Instagram y lo
    // anota. Esta ruta es para VERLOS, que es lo que faltaba.
    //
    //   /contactos             la lista, para leerla
    //   /contactos?csv=si      el mismo archivo para abrir en Excel o
    //                          subir a donde lleves tus clientes
    //
    // Lo que Instagram NO da, y por lo tanto aquí no está: el teléfono y
    // el correo. Lo que sí está es el @, que es con lo que se le escribe.
    if (url.pathname === "/contactos") {
      if (!env.DB) {
        return texto200("No hay base de datos conectada: mira /estado.\n");
      }

      const contactos = await listarContactos(env.DB, {
        cuantos: Math.min(Number(url.searchParams.get("cuantos")) || 500, 2000),
      });

      if (!contactos.length) {
        return texto200(
          "Todavía no hay contactos guardados.\n\n" +
            "Se guardan solos: el primero aparecerá en cuanto un cliente\n" +
            "escriba por Instagram.\n"
        );
      }

      if (url.searchParams.get("csv") === "si") {
        const filas = [
          "usuario,nombre,nombre_completo,id_instagram,ultimo_contacto,pausado",
          ...contactos.map((c) =>
            [
              c.usuario ? `@${c.usuario}` : "",
              c.nombre,
              c.nombre_completo,
              c.id,
              c.ultimo_envio ? new Date(c.ultimo_envio).toISOString() : "",
              c.pausado ? "si" : "no",
            ]
              .map(paraCsv)
              .join(",")
          ),
        ];

        return new Response(filas.join("\n"), {
          status: 200,
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": 'attachment; filename="contactos.csv"',
          },
        });
      }

      const lineas = contactos.map((c) => {
        const quien = comoSeLlama(c) || "(sin nombre)";
        const arroba = c.usuario ? `@${c.usuario}` : "(sin @)";
        const cuando = c.ultimo_envio
          ? `hace ${minutosDesde(c.ultimo_envio)} min`
          : "todavía sin respuesta";
        return `  ${quien}  ·  ${arroba}  ·  ${cuando}${c.pausado ? "  ·  EN PAUSA (lo lleva un asesor)" : ""}`;
      });

      return texto200(
        [
          `CONTACTOS GUARDADOS: ${contactos.length}`,
          "  Del más reciente al más antiguo.",
          "",
          ...lineas,
          "",
          "Para descargarlos y abrirlos en Excel:",
          "  /contactos?csv=si",
          "",
          "Instagram no entrega el teléfono ni el correo de nadie, así que",
          "eso no está y no puede estar. Con el @ sí les puedes escribir.",
          "",
        ].join("\n")
      );
    }

    // Dispara un aviso de prueba y enseña lo que respondió Slack. Sirve para
    // saber si el problema está en el aviso o en lo que pasa antes.
    if (url.pathname === "/probar-aviso") {
      const resultado = await avisarAsesor(env, {
        nombre: "Prueba",
        mensaje: "mensaje de prueba",
        respuesta: SOLO_ASESOR,
        motivo: "PRUEBA MANUAL",
      });
      return texto200(`${resultado}\n`);
    }

    // Enseña qué ve el Worker cuando lee tu hoja: si la alcanza, qué
    // columnas reconoció y cuántos productos quedan visibles. Con
    // ?buscar=iphone 15 prueba además una búsqueda concreta.
    if (url.pathname === "/probar-hoja") {
      let informe = `CÓDIGO DESPLEGADO: ${VERSION}\n\n` + (await diagnosticoHoja(env));

      const termino = url.searchParams.get("buscar");
      if (termino) {
        const { productos: encontrados, hayMas } = await buscarProductos(
          env,
          limpiarTermino(termino)
        );
        informe +=
          `\n─────────────────────────────\n` +
          `Búsqueda de "${termino}": ${encontrados.length} resultado(s)` +
          `${hayMas ? " (y hay más: saldría el botón del catálogo)" : ""}\n` +
          encontrados
            .map(
              (p) =>
                `  ${p.titulo}  —  ${p.precio}${p.precioCashea ? `  (Cashea: ${p.precioCashea})` : ""}`
            )
            .join("\n") +
          (encontrados.length ? "\n" : "");
      }

      return texto200(informe);
    }

    // Prueba de lectura de un enlace, sin esperar a que lo mande un cliente:
    //   /probar-enlace?url=https://www.instagram.com/p/XXXX/
    //
    // Dice exactamente lo que el bot saca de ese enlace. Sirve sobre todo
    // para lo que NO se ve desde fuera: Instagram a veces deja leer la
    // publicación y a veces no, y esto lo responde en diez segundos en vez
    // de a base de suponer.
    if (url.pathname === "/probar-enlace") {
      const enlace = url.searchParams.get("url") || "";
      if (!urlValida(enlace)) {
        return texto200(
          "Pasame un enlace asi:\n" +
            "  /probar-enlace?url=https://www.instagram.com/p/XXXX/\n"
        );
      }

      const delFeed = await buscarEnNuestroFeed(env, enlace);
      const leido = delFeed || (await leerEnlace(enlace));
      const algo = leido.imagen || leido.titulo || leido.descripcion || leido.termino;

      return texto200(
        [
          `Enlace        ${enlace}`,
          `Como se leyo  ${delFeed ? "por la API (es una publicacion nuestra)" : "raspando la pagina (etiquetas og:)"}`,
          `Titulo        ${leido.titulo || "(no se pudo leer)"}`,
          `Descripcion   ${(leido.descripcion || "(no se pudo leer)").slice(0, 200)}`,
          `Imagen        ${leido.imagen || "(no se pudo leer)"}`,
          `Ficha         ${leido.termino || "(no es la ficha de un producto)"}`,
          "",
          algo
            ? "Con esto el bot ya puede contestar por el equipo de la publicacion.\n"
            : "No se pudo sacar nada de ese enlace. Si es de Instagram, el bot\n" +
              "igual sabe que es una publicacion nuestra y le pregunta al cliente\n" +
              "cual le gusto, en vez de saludarlo como si no hubiera mandado nada.\n",
        ].join("\n")
      );
    }

    return texto200(`bot activo · ${VERSION}\n`);
  },
};

// Devuelve LO QUE HAY QUE ATENDER, siempre como lista: un mensaje suelto,
// varios comentarios que llegaron juntos, o nada.
function queAtender(env, crudo) {
  const modo = (env.META_MODO || "todo").toLowerCase();
  if (modo === "off") return [];

  let cuerpo;
  try {
    cuerpo = JSON.parse(crudo);
  } catch {
    console.error("Meta mandó algo que no es JSON");
    return [];
  }

  // UN COMENTARIO EN UNA PUBLICACIÓN. Llega por otro camino que los
  // mensajes ("changes" en vez de "messaging") y se atiende distinto: una
  // línea en público y la respuesta de verdad por privado.
  //
  // Se apaga desde wrangler.toml con COMENTARIOS = "off" sin tocar el
  // resto: los mensajes directos siguen igual.
  const comentarios = leerComentarios(cuerpo);
  if (comentarios.length) {
    if (modoComentarios(env) === "off") {
      console.log("Llegó un comentario pero COMENTARIOS está en off: lo ignoro");
      return [];
    }
    if (comentarios.length > 1) {
      console.log(`Meta mandó ${comentarios.length} comentarios juntos: atiendo todos`);
    }
    return comentarios;
  }

  const mensaje = leerMensaje(cuerpo);
  return mensaje ? [mensaje] : [];
}

// Qué se hace con los comentarios. Se cambia en wrangler.toml:
//
//   "todo"     responde en público Y abre el privado  <- por defecto
//   "privado"  solo el privado, sin contestar en público
//   "publico"  solo la respuesta pública
//   "off"      no toca los comentarios
function modoComentarios(env) {
  const puesto = String(env.COMENTARIOS || "todo").trim().toLowerCase();
  return ["todo", "privado", "publico", "off"].includes(puesto) ? puesto : "todo";
}

// EL CLIENTE NUNCA SE QUEDA EN SILENCIO (crítico).
//
// atenderMeta corre dentro de ctx.waitUntil, fuera de la respuesta a Meta.
// Si algo revienta ahí —la base sin migrar, la hoja caída, un fallo de
// red— la excepción se la traga el runtime: Meta ya recibió su 200, el
// Worker no se entera y el cliente se queda mirando la pantalla. Es el
// peor de los fallos porque NO SE VE: no hay mensaje de error, no hay
// aviso, solo una conversación muerta. Pasó, y el dueño lo describió
// como "ahora no responde".
//
// Así que el fallo se convierte en dos cosas visibles: un mensaje para el
// cliente y un aviso al asesor. Y solo se le escribe al cliente si NO le
// había llegado nada todavía, para no soltarle un "se me trabó el sistema"
// justo debajo del carrusel que sí recibió.
async function atenderConRed(env, mensaje) {
  const rastro = { respondio: false };

  try {
    if (mensaje.tipo === "comentario") {
      await atenderComentario(env, mensaje, rastro);
    } else {
      await atenderMeta(env, mensaje, rastro);
    }
  } catch (error) {
    const detalle = error?.stack || error?.message || String(error);
    console.error(`ATENDER FALLÓ para ${mensaje.igsid}:`, detalle);

    // Un eco es un mensaje NUESTRO que nos rebota: el cliente no escribió
    // nada y no está esperando respuesta. Si falla el manejo del eco, lo
    // último que hay que hacer es escribirle "se me trabó el sistema" de la
    // nada, cuando él no ha dicho ni hola.
    // Ni a un eco ni a un comentario se les contesta "se me trabó el
    // sistema": el eco es un mensaje nuestro que rebota, y un comentario
    // no tiene chat abierto al que escribirle.
    if (!rastro.respondio && mensaje.tipo !== "eco" && mensaje.tipo !== "comentario") {
      try {
        await enviarTexto(env, mensaje.igsid, FALLO_TECNICO);
      } catch (otro) {
        console.error("Tampoco se pudo avisar al cliente:", otro?.message || otro);
      }
    }

    // El nombre, si ya lo teníamos. Si la base es justo lo que falló, el
    // aviso sale igual, solo que con el ID.
    const cliente = await cargarContacto(env.DB, mensaje.igsid)
      .then(paraElAviso)
      .catch(() => ({}));

    await avisarAsesor(env, {
      ...cliente,
      igsid: mensaje.igsid,
      mensaje: mensaje.texto || "(sin texto)",
      respuesta: rastro.respondio
        ? "Se le respondió, pero algo falló después"
        : "EL BOT NO PUDO RESPONDER — nadie le escribió",
      motivo: "FALLO TÉCNICO",
      historial: detalle.slice(0, 400),
    }).catch((otro) => console.error("Ni el aviso salió:", otro?.message || otro));
  }
}


// EL ÚNICO MENSAJE QUE INSTAGRAM DEJA MANDAR, CON TODO DENTRO.
//
// Un saludo que promete información y no la trae vale menos que nada. Así
// que aquí va el equipo, su precio, y una invitación a contestar —que es
// lo que abre la ventana para poder mandarle las fotos después.
//
// Y VA LA FAMILIA ENTERA, NO UNA VERSIÓN SUELTA (26-sep-2026, el dueño).
// Quien comenta "precio" debajo de un Redmi Note 17 está preguntando por
// ESE modelo, y ese modelo son varias cosas: el de 256, el Pro de 512, y
// el forro que le sirve. Mandarle una sola línea le obliga a preguntar
// otra vez —y con la ventana cerrada, esa segunda pregunta puede no
// llegar nunca. Mejor que lo vea todo de una: es la información completa
// del modelo, que es lo que pidió.
//
// Los accesorios van APARTE y con su título, porque un forro de 8 dólares
// metido entre teléfonos de 240 se lee como si fuera un teléfono de 8.
const LINEAS_EN_EL_PRIVADO = 8;
const ACCESORIOS_EN_EL_PRIVADO = 3;

// Qué es un accesorio y qué es un equipo. Se mira el título, que es lo
// único que la hoja garantiza; una palabra de estas dentro y ya no es un
// teléfono.
const PALABRAS_DE_ACCESORIO = new Set([
  "forro", "forros", "funda", "fundas", "case", "cover", "estuche",
  "vidrio", "vidrios", "mica", "micas", "lamina", "glass", "protector",
  "cable", "cables", "cargador", "cargadores", "adaptador", "taco",
  "audifono", "audifonos", "auricular", "auriculares", "cascos",
  "corneta", "cornetas", "bocina", "parlante", "powerbank", "pila",
  "bateria", "reloj", "smartwatch", "banda", "memoria", "pendrive",
  "soporte", "tripode", "microfono", "aro", "teclado", "mouse",
  "combo", "silicona", "popsocket", "cargadorinalambrico",
]);

function esAccesorio(titulo) {
  return despejar(titulo)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .some((palabra) => PALABRAS_DE_ACCESORIO.has(palabra));
}

// En la ficha, el precio va debajo de la foto y se entiende solo. En una
// línea de texto, un "95" pelado no dice nada: si la hoja trae el número
// sin símbolo, se le pone aquí. (Solo aquí: las fichas siguen mostrando
// exactamente lo que dice la hoja.)
function conMoneda(precio) {
  const limpio = String(precio || "").trim();
  if (!limpio) return "";
  return /^[\d.,]+$/.test(limpio) ? `$${limpio}` : limpio;
}

function unaLinea(producto) {
  const precio = conMoneda(precioParaMostrar(producto, false, false));
  const capacidad = capacidadDe(producto);

  // Si el título ya dice los gigas, repetirlos al lado sobra.
  const yaEnElTitulo = capacidad && despejar(producto.titulo).includes(despejar(capacidad));
  const detalle = [yaEnElTitulo ? "" : capacidad, precio].filter(Boolean).join(" · ");

  return `• ${producto.titulo}${detalle ? ` — ${detalle}` : ""}`;
}

function conLosPrecios(saludo, productos) {
  const accesorios = productos.filter((p) => esAccesorio(p.titulo));
  const equipos = productos.filter((p) => !esAccesorio(p.titulo));

  // El sitio es para los equipos; los accesorios entran con lo que sobre.
  const cuantosAccesorios = Math.min(
    accesorios.length,
    ACCESORIOS_EN_EL_PRIVADO,
    Math.max(0, LINEAS_EN_EL_PRIVADO - Math.min(equipos.length, LINEAS_EN_EL_PRIVADO - 1))
  );
  const cuantosEquipos = Math.min(equipos.length, LINEAS_EN_EL_PRIVADO - cuantosAccesorios);

  const bloques = [];

  if (equipos.length) {
    const puestos = equipos.slice(0, cuantosEquipos).map(unaLinea);
    const faltan = equipos.length - puestos.length;
    if (faltan > 0) puestos.push(`…y ${faltan} más de este modelo`);
    // El título solo hace falta cuando hay dos bloques que separar.
    bloques.push((accesorios.length ? "📱 EQUIPOS\n" : "") + puestos.join("\n"));
  }

  if (cuantosAccesorios) {
    const puestos = accesorios.slice(0, cuantosAccesorios).map(unaLinea);
    const faltan = accesorios.length - puestos.length;
    if (faltan > 0) puestos.push(`…y ${faltan} más`);
    bloques.push(
      (equipos.length ? "🎧 ACCESORIOS PARA ESE MODELO\n" : "") + puestos.join("\n")
    );
  }

  return `${saludo}\n\n${bloques.join("\n\n")}\n\n¿Quieres ver las fotos? Escríbeme por aquí 😊`;
}

/* ── UN COMENTARIO EN UNA PUBLICACIÓN ──────────────────────────────
   Dos respuestas, y cada una hace algo distinto:

     · EN PÚBLICO, una línea. Lo ve todo el que entre a la publicación, y
       un "precio?" sin contestar le dice a cada uno de ellos que aquí no
       atienden. No lleva precio ni modelo: eso va por privado, que es
       donde el cliente puede seguir preguntando.

     · POR PRIVADO, la venta. Meta deja abrir UN chat por comentario
       aunque esa persona nunca haya escrito. Ahí van el equipo, su foto y
       su precio — y de ahí en adelante la conversación sigue como
       cualquier otra, con todo lo que el bot ya sabe hacer.
   ───────────────────────────────────────────────────────────────── */
async function atenderComentario(env, comentario, rastro = {}) {
  // Meta reintenta los webhooks: sin esto, el mismo comentario se
  // contestaría dos y tres veces, en público y delante de todos.
  await prepararBase(env);

  // Sin base no hay forma de saber qué comentarios ya se contestaron, y
  // Meta reintenta cada webhook: contestar aquí sería soltarle al cliente
  // la misma respuesta pública tres o cuatro veces, debajo de la
  // publicación y a la vista de todos. Se dice en el registro por qué no se
  // contestó, que es lo que hacía falta para poder arreglarlo.
  if (!env.DB) {
    console.error(
      "COMENTARIO SIN ATENDER: no hay base D1 (revisa database_id en wrangler.toml). " +
        "Sin ella no puedo llevar la cuenta de lo ya contestado y Meta reintenta."
    );
    return;
  }

  if (!(await comentarioNuevo(env.DB, comentario.id))) {
    console.log(`El comentario ${comentario.id} ya estaba contestado: no repito`);
    return;
  }

  // Y sin esto el bot se responde a sí mismo: su respuesta pública genera
  // otro comentario, que genera otro webhook, que genera otra respuesta.
  const yo = await quienSoy(env);
  if (esNuestro(comentario, yo)) {
    console.log("El comentario es nuestro: no me respondo a mí mismo");
    return;
  }

  console.log(
    `Comentario de @${comentario.usuario || "?"}: ` +
      `${JSON.stringify(comentario.texto.slice(0, 60))} (publicación ${comentario.media})`
  );

  const modo = modoComentarios(env);

  // DE QUÉ EQUIPO HABLA — Y NUNCA DE OTRO (crítico).
  //
  // EL FALLO QUE ESTO EVITA, dicho por el dueño: "alguien colocó precio en
  // una publicación X y respondió otra cosa nada que ver". Un cliente que
  // comenta debajo de una foto está preguntando por LO QUE SALE EN ESA
  // FOTO. Contestarle con otro equipo es peor que no contestarle: le dice
  // que del otro lado no miraron nada.
  //
  // Así que se busca en este orden, y solo se contesta con producto si
  // alguno de los tres da algo:
  //
  //   1. LO QUE ESCRIBIÓ ÉL. Si nombra un equipo —"¿y el A17?"— manda eso,
  //      aunque la publicación sea de otro: está preguntando por ese.
  //   2. EL PIE DE LA PUBLICACIÓN. Casi siempre trae el nombre completo
  //      con su capacidad.
  //   3. LA IMAGEN DE LA PUBLICACIÓN. Es un arte promocional: el nombre
  //      suele ir escrito encima, y la IA de visión lo lee. Es el mismo
  //      camino que cuando el cliente comparte el post por el chat.
  //
  // Y si después de los tres no se sabe, NO se inventa: se le pregunta
  // cuál de los que salen ahí le interesa. Preguntar es coherente;
  // adivinar, no.
  const enElCatalogo = await catalogoCompleto(env);
  const publicacion = comentario.media ? await publicacionPorId(env, comentario.media) : null;

  const delComentario = equipoQueNombra(comentario.texto, enElCatalogo);
  const dePublicacion = publicacion ? equipoQueNombra(publicacion.titulo, enElCatalogo) : "";

  let cual = delComentario || dePublicacion;
  let deDonde = delComentario ? "lo escribió él" : dePublicacion ? "lo dice el pie de la publicación" : "";

  if (!cual && publicacion?.imagen) {
    const { uri: foto } = await comoDataUri(env, publicacion.imagen);

    if (!foto) {
      console.log(`No pude descargar la imagen de la publicación: ${publicacion.imagen}`);
    }

    if (foto) {
      const catalogo = await listaDeTitulos(env);
      const identificacion = await identificarEnImagen(env, foto, catalogo, {
        esPublicacion: true,
      });

      const visto = String(identificacion?.visto || "").trim();
      const buscar = String(identificacion?.buscar || "").trim();

      // Queda en el registro SIEMPRE, acierte o no: es lo único que dice
      // por qué el bot preguntó en vez de enseñar, y sin esto hay que
      // adivinarlo desde fuera.
      console.log(
        identificacion
          ? `La IA de visión vio: "${visto}" → busca: "${buscar}"`
          : "La IA de visión no respondió a la imagen de la publicación"
      );

      const leido = buscar && buscar.toUpperCase() !== "NADA" ? buscar : "";

      // LO QUE LEE EN EL ARTE NO ESTÁ ESCRITO COMO LA HOJA.
      //
      // Lee "GALAXY S25 FE" de la imagen y en la hoja está "Samsung Galaxy
      // S25 FE 256GB". Antes eso se buscaba tal cual y, si la búsqueda no
      // acertaba, se descartaba. Ahora lo que leyó se ancla primero al
      // catálogo, que es lo que convierte una lectura en un producto con
      // su foto y su precio.
      const delCatalogo = equipoQueNombra(`${leido} ${visto}`, enElCatalogo);

      cual = delCatalogo || leido;
      if (cual) deDonde = "lo leyó en la imagen de la publicación";
    }
  }

  // LA FAMILIA DEL MODELO, NO UNA VERSIÓN SUELTA (26-sep-2026, el dueño).
  //
  // El pie dice "Redmi Note 17" y en la hoja eso son varias filas: el de
  // 256, el Pro de 512, el de 8/128, y los accesorios de ese modelo. Si se
  // busca con la capacidad pegada ("Redmi Note 17 256GB") vuelve UNA, y el
  // cliente que comentó "precio" se queda sin saber que hay otras —con la
  // ventana cerrada, puede que no pueda preguntarlo.
  //
  // Se le quita la capacidad al término y se busca el modelo: eso trae la
  // familia completa, que es la información que pidió.
  const familia = cual ? separarCapacidad(terminoDeTitulo(cual)).termino || terminoDeTitulo(cual) : "";

  // Y SI ÉL DICE QUÉ QUIERE, ESO ES LO QUE VA.
  //
  // "¿Tienen forro de este?" debajo de la publicación de un teléfono: el
  // modelo lo dice la publicación, pero lo que pide lo dice él. Si de ese
  // modelo hay forros, van los forros y nada más.
  const tipoEnElComentario = tipoQuePide(comentario.texto);

  // conAccesorios: sin tipo pedido van juntos a propósito. Es el único
  // mensaje que Instagram permite, así que el cliente tiene que ver el
  // modelo entero de una vez —sus versiones y lo que le sirve— porque
  // igual no puede volver a preguntar.
  let productos = familia
    ? (await buscarProductos(env, familia, 10, { conAccesorios: true })).productos
    : [];

  if (tipoEnElComentario && productos.length) {
    const suyos = productos.filter(
      (producto) => tipoDelProducto(producto.titulo) === tipoEnElComentario
    );

    if (suyos.length) {
      console.log(`Pidió ${tipoEnElComentario} de ese modelo: le mando solo eso`);
      productos = suyos;
    } else {
      // De ese modelo no hay lo que pidió. Se le manda el modelo, que es
      // por donde entró, en vez de dejarlo sin nada.
      console.log(
        `Pidió ${tipoEnElComentario} y de "${familia}" no hay: le mando el modelo`
      );
    }
  }

  console.log(
    cual
      ? `El comentario habla de "${cual}" (${deDonde}): ${productos.length} ficha(s)`
      : "No pude saber de qué equipo habla la publicación: le pregunto, no le invento otro"
  );

  // Y si lo que se identificó no existe en el catálogo, tampoco se le
  // manda otra cosa: se le pregunta. Mejor una pregunta que un equipo que
  // no tiene nada que ver con lo que estaba mirando.
  if (cual && !productos.length) {
    console.log(`"${cual}" no devolvió productos: le pregunto en vez de enseñarle otra cosa`);
    cual = "";
  }

  // ¿YA LO ESTÁ ATENDIENDO UN ASESOR? ENTONCES NO SE LE ESCRIBE (crítico).
  //
  // EL FALLO QUE ESTO EVITA. Un cliente escribe por privado, un asesor le
  // contesta a mano (y el bot se calla, es la pausa de siempre), y el mismo
  // cliente comenta "precio?" debajo de una publicación. Sin esto, el bot
  // le abre el privado y le suelta su saludo automático y un carrusel
  // ENCIMA de la conversación que el asesor está teniendo con él. Es
  // exactamente lo que la pausa existe para evitar, entrando por la otra
  // puerta.
  //
  // El id del que comenta es el mismo con el que se le escribe por privado,
  // así que basta con mirar su ficha: si no hay ficha, es alguien nuevo y
  // no hay ninguna pausa que respetar.
  const yaAtendido = comentario.de ? estaPausado(await cargarContacto(env.DB, comentario.de)) : false;

  if (yaAtendido) {
    console.log(
      `A @${comentario.usuario || comentario.de} lo está atendiendo un asesor por privado: ` +
        "no le escribo por encima, solo le contesto en público"
    );
  }

  // 1. El privado, que es donde se vende.
  let igsid = "";
  let fotosEnviadas = false;
  if (!yaAtendido && (modo === "todo" || modo === "privado")) {
    const saludo = saludoPrivado(comentario.usuario, productos.length ? familia : "");

    // INSTAGRAM DEJA MANDAR UN SOLO MENSAJE, ASÍ QUE EL PRECIO VA EN ÉL.
    //
    // EL FALLO QUE ESTO ARREGLA (26-sep-2026, visto en producción). El bot
    // abría el privado con el saludo y mandaba las fichas en un SEGUNDO
    // mensaje. Ese segundo mensaje lo rechazaba Meta:
    //
    //   403 "This message is sent outside of allowed window."
    //   (IGApiException, code 10, error_subcode 2534022)
    //
    // No es un fallo del token ni del código: es la regla de Instagram. A
    // quien solo comentó se le puede escribir UNA vez —la respuesta
    // privada al comentario— y nada más hasta que esa persona conteste. El
    // cliente recibía "te paso la info 👇" y debajo, nada. Lo peor posible:
    // la promesa sin la información.
    //
    // Así que el equipo y su precio van DENTRO de ese único mensaje, en
    // texto. Las fotos se intentan igual —si esa persona ya venía
    // escribiendo, la ventana está abierta y llegan— pero ya no son lo que
    // sostiene la respuesta.
    const mensajePrivado = productos.length ? conLosPrecios(saludo, productos) : saludo;

    const abierto = await privadoPorComentario(env, comentario.id, mensajePrivado);
    igsid = abierto.igsid;

    if (igsid) {
      rastro.respondio = true;

      const contacto = await cargarContacto(env.DB, igsid);
      let mids = agregarMid(contacto.mids_enviados, abierto.mid);
      let enviadoEn = Date.now();
      await marcarEnvio(env.DB, igsid, mids, enviadoEn, [mensajePrivado]);

      if (productos.length) {
        const fichas = productos.map((producto) => ({
          ...producto,
          precio: subtituloDeFicha(producto, false, false),
        }));

        const mid = await enviarFichas(env, igsid, fichas);
        if (mid) {
          fotosEnviadas = true;
          mids = agregarMid(mids, mid);
          enviadoEn = Date.now();
          await marcarEnvio(env.DB, igsid, mids, enviadoEn, [mensajePrivado]);
        } else {
          // Lo esperable: la ventana está cerrada porque esta persona solo
          // comentó. No es un error que haya que arreglar, y el cliente ya
          // tiene su precio en el mensaje de arriba.
          console.log(
            "Instagram no dejó mandar las fotos (solo se permite un mensaje " +
              "por comentario): el precio ya va escrito en el privado. Las " +
              "fichas salen en cuanto el cliente conteste."
          );
        }

        await guardarContacto(env.DB, {
          ...contacto,
          historial: conNota(
            contacto.historial,
            `Ya di la bienvenida. Vino de un comentario en una publicación. Ya busqué: ${cual}. ` +
              (fotosEnviadas
                ? "Le mandé las fichas."
                : "Le pasé los precios por escrito; si pide fotos, mándaselas.")
          ),
          mids_enviados: mids,
          ultimo_envio: enviadoEn,
          ultima_respuesta: mensajePrivado,
          ultimos_productos: productos.map((producto) => producto.titulo),
        });
      } else {
        await guardarContacto(env.DB, {
          ...contacto,
          historial: conNota(
            contacto.historial,
            "Ya di la bienvenida. Vino de un comentario; le pregunté cuál equipo le interesa."
          ),
          mids_enviados: mids,
          ultimo_envio: enviadoEn,
          ultima_respuesta: mensajePrivado,
        });
      }
    }
  }

  // 2. La línea en público. Si el privado no se pudo abrir —hay quien
  // tiene cerrados los mensajes de desconocidos— se le dice que escriba
  // él, que es lo único que queda.
  let enPublicoPuesto = false;
  if (modo === "todo" || modo === "publico" || (!igsid && modo === "privado")) {
    // LO QUE SE LE DICE EN PÚBLICO TIENE QUE SER VERDAD (25-sep-2026).
    //
    // Antes salía "¡Respondido al DM!" también con COMENTARIOS = "publico",
    // donde el privado no se manda nunca: el cliente iba a su bandeja, no
    // encontraba nada y se quedaba peor que antes de preguntar. Ahora esa
    // frase sale solo si el privado salió de verdad; si no, se le pide que
    // escriba él, y si ya lo atiende un asesor, se le dice eso.
    const enPublico = yaAtendido
      ? respuestaPublicaYaAtendido()
      : igsid
        ? respuestaPublica()
        : respuestaPublicaSinPrivado();
    const puesto = await responderComentario(env, comentario.id, enPublico);
    if (puesto) {
      rastro.respondio = true;
      enPublicoPuesto = true;
    }
  }

  // NO SE LE PUDO DECIR NADA, NI EN PÚBLICO NI EN PRIVADO. Se suelta la
  // marca de "ya contestado" para que el reintento de Meta valga.
  if (!igsid && !enPublicoPuesto) {
    await olvidarComentario(env.DB, comentario.id);
  }

  // 3. Y al asesor, porque un comentario es alguien mirando el producto
  // ahora mismo.
  if (productos.length || igsid) {
    await avisarAsesor(env, {
      nombre: comentario.usuario ? `@${comentario.usuario}` : "",
      igsid,
      mensaje: `(comentario) ${comentario.texto}`,
      respuesta: yaAtendido
        ? "Comentó en una publicación mientras un asesor lo atiende por privado: NO le escribí nada."
        : igsid
          ? `Le abrí el privado${productos.length ? ` con ${productos.length} equipo(s)` : ""}.` +
            (productos.length && !fotosEnviadas
              ? " Las fotos no salieron: Instagram solo permite un mensaje hasta que él conteste."
              : "")
          : "No pude abrirle el privado: le contesté en público que escriba.",
      motivo: "COMENTÓ EN UNA PUBLICACIÓN",
      historial: publicacion?.titulo ? `Publicación: ${publicacion.titulo.slice(0, 120)}` : "",
      productos,
    });
  }
}

async function atenderMeta(env, mensaje, rastro = {}) {
  // ENVIAR Y ANOTAR TIENEN QUE SER UNA SOLA COSA (crítico).
  //
  // EL FALLO QUE ESTO ARREGLA. Meta devuelve un eco de cada mensaje que
  // sale de la cuenta, y ese eco llega como una petición NUEVA al webhook,
  // atendida en paralelo. El eco solo se reconoce como nuestro si su mid ya
  // está guardado en D1. Y antes se guardaban todos juntos, al final:
  //
  //     enviarTexto(...)      ← sale el mensaje, su eco ya viene de camino
  //     enviarFichas(...)     ← un segundo o dos armando el carrusel
  //     marcarEnvio(...)      ← recién AQUÍ se guardaba el mid del primero
  //
  // En esa ventana el eco del texto llegaba, no encontraba su mid, lo
  // tomaba por un asesor humano y pausaba el bot. Por eso pasaba justo con
  // las preguntas que muestran producto —"¿qué iPhone me recomiendas?"—
  // y no con un "hola": son las únicas que mandan DOS mensajes seguidos.
  //
  // Ahora cada envío se guarda en el momento, antes de hacer nada más. Son
  // dos escrituras en D1 por turno en vez de una; una pausa falsa cuesta
  // una hora de silencio con un cliente.
  // Se rellena en cuanto se carga el contacto, más abajo: el eco se atiende
  // antes y no manda nada.
  let mids = [];
  let enviadoEn = 0;
  // Y los textos que salieron, que es la otra forma de reconocer el eco
  // propio: el mid falla a veces, el texto no (ver esEcoPorTexto).
  let textos = [];

  const mandar = async (hacer, texto = "") => {
    const mid = await hacer();
    if (!mid) return "";

    rastro.respondio = true;
    mids = agregarMid(mids, mid);
    if (texto) textos = [...textos, texto];
    enviadoEn = Date.now();
    await marcarEnvio(env.DB, mensaje.igsid, mids, enviadoEn, textos);
    return mid;
  };
  // El eco de un mensaje que salió de la cuenta: el nuestro (el bot
  // respondiendo) o el de un asesor escribiendo a mano desde la app de
  // Instagram. Si el mid no es de los que mandó el bot, fue una persona —
  // y el bot se aparta unas horas para no hablar por encima de ella.
  if (mensaje.tipo === "eco") {
    if (!mensaje.igsid || !mensaje.mid) return;
    await prepararBase(env);
    const contacto = await cargarContacto(env.DB, mensaje.igsid);

    if (esEcoPropio(contacto, mensaje.mid)) return; // eco nuestro, ya anotado

    // EL MID NO ES LA UNICA PRUEBA, Y NO ES LA MEJOR.
    //
    // Si lo que rebota dice palabra por palabra lo que el bot acaba de
    // escribir, es del bot. Da igual que el mid no cuadre —el envio pudo no
    // devolverlo, o la escritura en D1 llegar tarde—: un asesor no escribe
    // por casualidad la misma frase con los mismos emojis.
    if (esEcoPorTexto(contacto, mensaje.texto)) {
      console.log(
        `Eco de ${mensaje.igsid} con mid desconocido, pero el texto es el que ` +
          "mando el bot: es suyo, no pauso."
      );
      return;
    }

    // EL ASESOR LE DEVUELVE LA CONVERSACIÓN AL BOT (ver FRASE_DESPAUSAR).
    //
    // Va ANTES de la red de envioReciente a propósito: si el bot acaba de
    // mandar el "ya te atienden" y el asesor contesta con la frase en ese
    // mismo minuto, esa red se tragaría el eco y el bot seguiría callado.
    //
    // Se espera un poco más que la otra rama: si el asesor mandó otro
    // mensaje justo antes, su pausa todavía está en camino (tarda
    // ESPERA_ANTES_DE_PAUSAR_MS) y no puede aterrizar DESPUÉS de esto.
    if (esFraseDeDespausar(env, mensaje.texto)) {
      await new Promise((seguir) => setTimeout(seguir, ESPERA_ANTES_DE_PAUSAR_MS + 1000));
      await despausar(env.DB, mensaje.igsid, NOTA_DESPAUSADO);
      console.log(`El asesor le devolvió ${mensaje.igsid} al bot: vuelvo a atender`);
      return;
    }

    // El mid no aparece, pero el bot acaba de mandar algo: es su propio eco
    // que ganó la carrera contra el guardado. Pausar aquí sería dejar al
    // cliente sin atención durante horas por un mensaje que mandamos
    // nosotros — pasó en producción, ver estado.js.
    if (envioReciente(contacto)) {
      console.log(
        `Eco sin mid conocido de ${mensaje.igsid}, pero el bot envió hace ` +
          "un momento: lo cuento como propio, no pauso."
      );
      return;
    }

    // UN ECO SIN UNA SOLA LETRA es casi siempre nuestro carrusel de fichas,
    // que sale como adjunto y vuelve sin texto que comparar. Con una
    // ventana mas ancha que la de arriba, porque un turno que manda texto +
    // fichas + boton tarda unos segundos mas.
    if (!mensaje.texto && envioReciente(contacto, Date.now(), VENTANA_ECO_SIN_TEXTO_MS)) {
      console.log(
        `Eco sin texto de ${mensaje.igsid} justo despues de un envio del bot: ` +
          "es el carrusel propio, no pauso."
      );
      return;
    }

    // ÚLTIMA OPORTUNIDAD ANTES DE PAUSAR.
    //
    // Nada de lo de arriba es concluyente cuando el bot está a mitad de
    // responder: el mid puede no estar guardado TODAVÍA y ultimo_envio
    // puede ser el del turno anterior. Esta lectura se hace unos segundos
    // después, cuando al otro lado ya terminó de escribir en D1.
    //
    // Retrasar la pausa unos segundos no cuesta nada: el asesor sigue
    // escribiendo igual. Pausar de más cuesta una hora de silencio.
    await new Promise((seguir) => setTimeout(seguir, ESPERA_ANTES_DE_PAUSAR_MS));
    const alSegundoVistazo = await cargarContacto(env.DB, mensaje.igsid);

    if (
      esEcoPropio(alSegundoVistazo, mensaje.mid) ||
      esEcoPorTexto(alSegundoVistazo, mensaje.texto) ||
      envioReciente(alSegundoVistazo) ||
      (!mensaje.texto && envioReciente(alSegundoVistazo, Date.now(), VENTANA_ECO_SIN_TEXTO_MS))
    ) {
      console.log(
        `Eco de ${mensaje.igsid}: al segundo vistazo era del propio bot, no pauso.`
      );
      return;
    }

    const horas = Number(env.PAUSA_HORAS) || PAUSA_HORAS_POR_DEFECTO;
    await pausar(env.DB, mensaje.igsid, horas);

    // CON EL TEXTO DELANTE. Una pausa que no se explica son treinta minutos
    // de suposiciones cuando el dueno dice "el bot no responde"; con esta
    // linea, `wrangler tail` dice que mensaje la provoco y se ve en el acto
    // si de verdad lo escribio una persona.
    console.log(
      `PAUSO ${mensaje.igsid} ${horas}h — eco ajeno mid:${mensaje.mid} ` +
        `texto:${JSON.stringify(String(mensaje.texto || "(sin texto)").slice(0, 80))} ` +
        `(vuelvo solo si el asesor calla ${minutosParaVolver(env)} min)`
    );

    // Sin aviso a Slack. Antes salía un "BOT EN PAUSA — la conversación es
    // tuya" con cada mensaje del asesor, y no le decía nada que no supiera:
    // él mismo acababa de escribir. Lo que sí sirve se queda: el "ya te
    // atienden" al cliente y el "TE ESTÁN ESPERANDO" si el asesor se
    // distrae (ver avisarQueYaLoAtienden).
    //
    // Lo que se aprovecha es para guardar su nombre, que así sale en
    // /estado y en ese aviso aunque el cliente no vuelva a escribir.
    await asegurarPerfil(env, alSegundoVistazo);
    return;
  }

  console.log(
    `Meta → ATIENDO ${mensaje.tipo} de:${mensaje.igsid} ` +
      `texto:${JSON.stringify(mensaje.texto.slice(0, 60))}`
  );

  await prepararBase(env);

  // El perfil se busca UNA vez por cliente y queda guardado: su nombre para
  // saludarlo, y nombre completo + @ para que el asesor sepa quién es en
  // Slack y en /estado. Se hace antes de mirar la pausa para que el aviso
  // "TE ESTÁN ESPERANDO" también salga con nombre.
  const contacto = await asegurarPerfil(env, await cargarContacto(env.DB, mensaje.igsid));
  mids = contacto.mids_enviados;

  textos = contacto.ultimos_textos;

  if (estaPausado(contacto)) {
    // ¿SIGUE HABIENDO ALGUIEN DEL OTRO LADO?
    //
    // pausado_hasta se fija en "ahora + horas" con CADA mensaje del asesor,
    // asi que restando las horas se sabe cuando escribio por ultima vez. Si
    // lleva un buen rato callado y el cliente sigue preguntando, la pausa ya
    // no protege a nadie: solo deja al cliente hablando solo.
    const horasDePausa = Number(env.PAUSA_HORAS) || PAUSA_HORAS_POR_DEFECTO;
    const calladoMin =
      (Date.now() - (Number(contacto.pausado_hasta) - horasDePausa * 60 * 60 * 1000)) / 60000;

    if (calladoMin >= minutosParaVolver(env)) {
      await despausar(env.DB, mensaje.igsid, NOTA_VOLVI_SOLO);
      contacto.pausado_hasta = 0;
      console.log(
        `El asesor lleva ${Math.round(calladoMin)} min callado y ${mensaje.igsid} ` +
          "volvio a escribir: retomo la conversacion."
      );

      await avisarAsesor(env, {
        ...paraElAviso(contacto),
        igsid: mensaje.igsid,
        mensaje: mensaje.texto || "(mandó una foto)",
        respuesta: "El bot volvió a atender esta conversación.",
        motivo: "EL BOT RETOMA",
        historial:
          `Llevabas ${Math.round(calladoMin)} min sin escribir y el cliente seguía ` +
          "preguntando. Si la quieres de vuelta, escríbele: el bot se aparta solo.",
      });
    } else {
      console.log(
        `Bot pausado para ${mensaje.igsid} (el asesor escribió hace ` +
          `${Math.round(calladoMin)} min): no respondo`
      );
      await avisarQueYaLoAtienden(env, mensaje, contacto, mandar);
      return;
    }
  }

  // LA PUBLICACIÓN QUE COMPARTIÓ DESDE EL FEED.
  //
  // Va aquí, antes de los atajos: quien señala un equipo con el dedo no
  // está saludando ni pidiendo el catálogo, y contestarle con cualquiera de
  // las dos cosas es lo que hacía el bot antes de esto.
  const publicacion = await publicacionDelTurno(env, mensaje, contacto);

  // Otro webhook —la pregunta que venía detrás— ya contestó por esta
  // publicación. Callarse aquí es la única forma de que el cliente reciba
  // una sola respuesta.
  if (publicacion?.yaContestaron) {
    console.log(`La pregunta de ${mensaje.igsid} ya atendió su publicación: no repito`);
    return;
  }

  const esHistoria = mensaje.tipo === "historia";
  const imagenCruda = publicacion?.imagen || mensaje.historia.url || mensaje.foto || "";

  // Solo el primer nombre, y solo si es un nombre de persona (ver
  // primerNombre). Si no lo es, se le atiende sin nombre: mejor eso que un
  // "¡Hola, jonathanrodric982101!".
  const nombre = contacto.nombre;
  const historialPrevio = contacto.historial;
  const textoCliente =
    mensaje.texto ||
    (publicacion
      ? "(compartió una publicación de la tienda)"
      : imagenCruda
        ? "(mandó una foto)"
        : "");

  console.log(
    `Meta → ATIENDO ${mensaje.tipo} de:${mensaje.igsid} ` +
      `texto:${JSON.stringify(String(mensaje.texto).slice(0, 60))}`
  );

  // UN MENSAJE VACÍO NO SE CONTESTA CON EL HISTORIAL (crítico).
  //
  // Si no hay texto, ni foto, ni publicación, no hay NADA que atender: un
  // adjunto que Meta manda con una forma que no sabemos leer, una nota de
  // voz, un sticker. Pasarle eso al modelo es pedirle que adivine, y
  // adivina con lo único que tiene: la conversación anterior. Así se le
  // mandaron cuatro Poco a quien había compartido un post de uno solo.
  //
  // El adjunto que llegó queda en el registro (ver instagram.js), que es
  // por donde se arregla el caso siguiente.
  if (!mensaje.texto && !imagenCruda && !publicacion) {
    const frase = alAzar(NO_PUDE_ABRIRLO);
    console.log(
      `Mensaje sin nada que atender de ${mensaje.igsid} (tipo ${mensaje.tipo}): ` +
        "pregunto en vez de suponer con el historial"
    );
    await mandar(() => enviarTexto(env, mensaje.igsid, frase), frase);
    await guardarContacto(env.DB, {
      ...contacto,
      nombre,
      mids_enviados: mids,
      ultimo_envio: enviadoEn || Date.now(),
      ultima_respuesta: frase,
    });
    return;
  }

  // ── ¿QUIERE LAS IMÁGENES DE LA LISTA QUE ACABA DE RECIBIR? ──────
  //
  // Llega por el botón (mensaje.opcion) o escrito a mano ("dale", "sí").
  // Lo escrito solo cuenta si lo último que le preguntamos fue eso: un
  // "dale" suelto en otra parte de la conversación no es esto.
  const respondeALaLista = !mensaje.opcion && leOfrecimosLasImagenes(contacto);

  if (mensaje.opcion === OPCION_VER_SI || (respondeALaLista && DICE_QUE_SI.test(mensaje.texto))) {
    const enElCatalogo = await catalogoCompleto(env);
    const previos = enElCatalogo.filter((p) =>
      contacto.ultimos_productos.some((titulo) => despejar(titulo) === despejar(p.titulo))
    );

    if (previos.length) {
      const respuesta = alAzar(AQUI_LAS_IMAGENES);
      console.log(`Quiere las imágenes de la lista: ${previos.length} ficha(s)`);

      await mandar(() => enviarTexto(env, mensaje.igsid, respuesta), respuesta);
      await mandar(() =>
        enviarFichas(
          env,
          mensaje.igsid,
          previos.map((p) => ({ ...p, precio: subtituloDeFicha(p, false, false) }))
        )
      );

      await guardarContacto(env.DB, {
        ...contacto,
        nombre,
        historial: conNota(historialPrevio, "Le mostré las imágenes de la lista."),
        mids_enviados: mids,
        ultimo_envio: enviadoEn || Date.now(),
        ultima_respuesta: respuesta,
      });
      return;
    }

    console.log("Dijo que sí a las imágenes, pero no queda lista guardada: sigo normal");
  }

  if (mensaje.opcion === OPCION_VER_NO || (respondeALaLista && DICE_QUE_NO.test(mensaje.texto))) {
    const respuesta = alAzar(SIN_IMAGENES);
    await mandar(() => enviarTexto(env, mensaje.igsid, respuesta), respuesta);
    await guardarContacto(env.DB, {
      ...contacto,
      nombre,
      historial: conNota(historialPrevio, "No quiso ver las imágenes de la lista."),
      mids_enviados: mids,
      ultimo_envio: enviadoEn || Date.now(),
      ultima_respuesta: respuesta,
    });
    return;
  }

  // ── "MÁNDAME LA LISTA DE X" ─────────────────────────────────────
  //
  // Va antes del modelo por lo mismo que "muéstrame esos": no hay nada que
  // redactar. La hoja dice qué hay, y el modelo, con veinte equipos
  // delante, acaba eligiendo diez y quedándose corto.
  // Si tocó el botón de una marca, ya sabemos cuál es: no hace falta que
  // el mensaje diga "lista" — el botón ES el pedido de lista.
  const marcaDelBoton = mensaje.opcion.startsWith(OPCION_MARCA)
    ? mensaje.opcion.slice(OPCION_MARCA.length)
    : "";

  // Y SIN TIENDA ONLINE, "¿QUÉ MÁS TIENEN?" TAMBIÉN ES UNA LISTA.
  //
  // Con catálogo web, ese mensaje se resuelve con el enlace (más abajo).
  // Sin él, mandarlo a ninguna parte sería la peor respuesta: se le
  // enseñan las marcas que hay y elige, que es lo que haría un vendedor.
  const quiereVerMasSinCatalogo = !hayCatalogo(env) && pideVerMas(mensaje.texto);

  if (
    !imagenCruda &&
    !publicacion &&
    (marcaDelBoton || pideLista(mensaje.texto) || quiereVerMasSinCatalogo)
  ) {
    const enElCatalogo = await catalogoCompleto(env);
    const marcas = marcasDelCatalogo(enElCatalogo);
    const marca =
      marcaDelBoton ||
      marcaEnTexto(mensaje.texto, marcas) ||
      nombraDelCatalogo(mensaje.texto, enElCatalogo);

    // Pidió "la lista" a secas: no se elige por él. Se le enseñan las
    // marcas que hay, con un botón por marca para que no tenga ni que
    // escribir.
    if (!marca) {
      const pregunta = "¡Claro que sí! 😊 ¿De cuál marca te mando la lista? 👇";
      console.log(`Pidió lista sin marca: ofrezco ${marcas.length} marca(s)`);

      await mandar(
        () =>
          enviarConOpciones(
            env,
            mensaje.igsid,
            pregunta,
            marcas
              .slice(0, 11)
              .map(({ nombre: m }) => ({ titulo: m, payload: `${OPCION_MARCA}${m}` }))
          ),
        pregunta
      );

      await guardarContacto(env.DB, {
        ...contacto,
        nombre,
        historial: conNota(historialPrevio, "Pidió una lista; le pregunté de cuál marca."),
        mids_enviados: mids,
        ultimo_envio: enviadoEn || Date.now(),
        ultima_respuesta: pregunta,
      });
      return;
    }

    // 60 es de sobra para la marca más grande de la hoja, y lo que no
    // quepa en los dos mensajes se dice con su número.
    // Una lista de marca se pide para VER QUÉ HAY: ahí entran los
    // accesorios de la marca igual que los equipos.
    const { productos: deLaMarca } = await buscarProductos(env, marca, 60, {
      conAccesorios: true,
    });

    if (deLaMarca.length) {
      const conCasheaAhora = PREGUNTA_CASHEA.test(mensaje.texto);
      const conDivisasAhora = PREGUNTA_DIVISAS.test(mensaje.texto);

      const { mensajes, puestas, faltan } = mensajesDeLista(deLaMarca, {
        cabecera: `Estos son los ${marca} que tenemos 👇`,
        precioDe: (producto) => precioParaMostrar(producto, conCasheaAhora, conDivisasAhora),
      });

      console.log(
        `Lista de "${marca}": ${deLaMarca.length} equipo(s), ${puestas} en el mensaje` +
          (faltan ? `, ${faltan} fuera` : "")
      );

      for (const parte of mensajes) {
        await mandar(() => enviarTexto(env, mensaje.igsid, parte), parte);
      }

      const pregunta =
        (faltan ? `Y me quedan ${faltan} más de esa marca 😊\n\n` : "") + PREGUNTA_IMAGENES;

      await mandar(
        () =>
          enviarConOpciones(env, mensaje.igsid, pregunta, [
            { titulo: TITULO_VER_SI, payload: OPCION_VER_SI },
            { titulo: TITULO_VER_NO, payload: OPCION_VER_NO },
          ]),
        pregunta
      );

      await guardarContacto(env.DB, {
        ...contacto,
        nombre,
        historial: conNota(historialPrevio, `Le mandé la lista de ${marca}. Ya busqué: ${marca}.`),
        mids_enviados: mids,
        ultimo_envio: enviadoEn || Date.now(),
        ultima_respuesta: pregunta,
        // Las diez primeras son las que caben en un carrusel: son las que
        // se le enseñan si dice que sí.
        ultimos_productos: deLaMarca.slice(0, 10).map((producto) => producto.titulo),
      });
      return;
    }

    console.log(`Pidió la lista de "${marca}" y no hay nada: sigo por el camino normal`);
  }

  // Quien ya escribió antes y vuelve con un "hola" suelto no necesita al
  // modelo: no hay nada que buscar. La primera vez de cada cliente NO entra
  // aquí: esa bienvenida la escribe el modelo con el tono del prompt.
  if (historialPrevio && !imagenCruda && !publicacion && esSoloSaludo(mensaje.texto)) {
    const respuesta = saludoDeVuelta(nombre, mensaje.texto);
    console.log(`Saludo de vuelta → ${JSON.stringify(respuesta)}`);
    await mandar(() => enviarTexto(env, mensaje.igsid, respuesta), respuesta);
    await guardarContacto(env.DB, {
      ...contacto,
      nombre,
      mids_enviados: mids,
      ultimo_envio: enviadoEn || Date.now(),
      ultima_respuesta: respuesta,
    });
    return;
  }

  // "¿Qué más tienen?" no lleva nada que buscar: quiere pasearse por la
  // tienda. Se le manda el catálogo con ganas, sin gastar una llamada al
  // modelo para que redacte lo mismo.
  //
  // Se descarta primero si lo que pregunta es de asesor ("¿tienen más
  // garantía?"): eso no es pasear por el catálogo, es una pregunta que
  // tiene que seguir su camino normal.
  if (
    !imagenCruda &&
    !publicacion &&
    !CONSULTA_DE_ASESOR.test(mensaje.texto) &&
    pideVerMas(mensaje.texto)
  ) {
    const respuesta = fraseDeCatalogo(nombre);
    console.log(`Pidió ver más → ${JSON.stringify(respuesta)}`);
    await mandar(() => enviarBotonCatalogo(env, mensaje.igsid, respuesta), respuesta);
    await guardarContacto(env.DB, {
      ...contacto,
      nombre,
      historial: conNota(historialPrevio, "Pidió ver más y le pasé el catálogo."),
      mids_enviados: mids,
      ultimo_envio: enviadoEn || Date.now(),
      ultima_respuesta: respuesta,
    });
    return;
  }

  // "MUÉSTRAME ESOS": los que el bot acaba de nombrar, no otros.
  //
  // Va ANTES del modelo a propósito. El modelo ya demostró que aquí se
  // pierde: recitó cinco teléfonos de 8/256 y, al pedirle verlos, buscó
  // "Samsung" y mandó dos cargadores. No hay nada que redactar — el
  // cliente quiere ver una lista que ya existe, escrita en el mensaje
  // anterior. Se lee de ahí y se muestra.
  if (
    !imagenCruda &&
    !publicacion &&
    pideVerLoRecomendado(mensaje.texto) &&
    contacto.ultima_respuesta
  ) {
    const recomendados = productosRecomendados(
      await catalogoCompleto(env),
      contacto.ultima_respuesta
    );

    if (recomendados.length) {
      console.log(
        `Pidió ver lo recomendado: ${recomendados.map((p) => p.titulo).join(", ")}`
      );

      const respuesta = alAzar(AQUI_LOS_TIENES);
      const fichas = recomendados.map((p) => ({
        ...p,
        precio: subtituloDeFicha(p, false, false),
      }));

      await mandar(() => enviarTexto(env, mensaje.igsid, respuesta), respuesta);
      await mandar(() => enviarFichas(env, mensaje.igsid, fichas));

      await guardarContacto(env.DB, {
        ...contacto,
        nombre,
        historial: conNota(
          historialPrevio,
          `Le mostré los que le había recomendado: ${recomendados
            .map((p) => p.titulo)
            .join(", ")}.`
        ),
        mids_enviados: mids,
        ultimo_envio: enviadoEn || Date.now(),
        ultima_respuesta: respuesta,
        ultimos_productos: recomendados.map((p) => p.titulo),
      });
      return;
    }

    console.log(
      "Pidió ver lo recomendado, pero en el último mensaje no reconocí " +
        "ningún producto del catálogo: sigo por el camino normal."
    );
  }

  // "¿Y EN DIVISAS?" — LOS MISMOS EQUIPOS, CON EL OTRO PRECIO.
  //
  // EL FALLO QUE ESTO ARREGLA (24-sep-2026). El bot le mostró dos Samsung
  // A57, el cliente preguntó "Precio en divisas?" y recibió "Eso te lo
  // confirma un asesor en un momento 😊". Ni buscó ni mostró nada: ese
  // mensaje no nombra ningún equipo, así que no había término de búsqueda,
  // y el modelo —que no tenía nada dicho sobre divisas— tiró por el asesor.
  //
  // Pero el dato sí lo tenemos: los precios de la hoja YA están en divisas.
  // Lo único que faltaba era saber DE QUÉ equipos habla, y eso no hay que
  // adivinarlo: son los del último carrusel, guardados en D1.
  //
  // Va antes del modelo, como "muéstrame esos", por la misma razón: no hay
  // nada que redactar ni que buscar, hay que volver a enseñar lo mismo.
  if (!imagenCruda && !publicacion && PREGUNTA_DIVISAS.test(mensaje.texto)) {
    const enElCatalogo = await catalogoCompleto(env);

    // Si nombra un equipo —"¿cuánto es el iPhone 15 en divisas?"— no está
    // hablando de los de antes: que siga el camino normal y se busque lo
    // que pidió. La ficha saldrá en divisas igual.
    const nombraProducto = nombraAlgoDeLaHoja(mensaje.texto, enElCatalogo);

    if (nombraProducto) {
      console.log(
        "Pidió divisas pero nombró algo de la hoja que no es lo que acaba " +
          "de ver: lo busco en vez de repetirle el último carrusel"
      );
    }

    if (!nombraProducto && !nombraDelCatalogo(mensaje.texto, enElCatalogo)) {
      // DE DÓNDE SALE "LO QUE ACABA DE VER". Dos caminos, y hacen falta
      // los dos:
      //
      //   1. La columna "ultimos_productos", que es exacta.
      //   2. El último mensaje del bot, leyendo de él los títulos del
      //      catálogo que nombró (lo mismo que hace "muéstrame esos").
      //
      // El segundo existe porque el primero empieza vacío: una conversación
      // que venía de antes de que existiera esa columna —o que recibió su
      // carrusel con la versión anterior del bot— no tiene nada guardado, y
      // entonces esto no se disparaba y el cliente se quedaba sin su
      // respuesta. Con el segundo camino, funciona desde el primer día.
      const guardados = enElCatalogo.filter((p) =>
        contacto.ultimos_productos.some((titulo) => despejar(titulo) === despejar(p.titulo))
      );

      const previos = guardados.length
        ? guardados
        : productosRecomendados(enElCatalogo, contacto.ultima_respuesta);

      if (previos.length) {
        if (!guardados.length) {
          console.log(
            "Pidió divisas y no había lista guardada: saco los equipos del " +
              "último mensaje que le mandé"
          );
        }
        const respuesta = alAzar(PRECIOS_EN_DIVISAS);
        console.log(
          `Pidió divisas: le repito ${previos.map((p) => p.titulo).join(", ")} con el precio en divisas`
        );

        await mandar(() => enviarTexto(env, mensaje.igsid, respuesta), respuesta);
        await mandar(() =>
          enviarFichas(
            env,
            mensaje.igsid,
            previos.map((p) => ({ ...p, precio: subtituloDeFicha(p, false, true) }))
          )
        );

        await guardarContacto(env.DB, {
          ...contacto,
          nombre,
          historial: conNota(
            historialPrevio,
            `Le repetí en divisas: ${previos.map((p) => p.titulo).join(", ")}.`
          ),
          mids_enviados: mids,
          ultimo_envio: enviadoEn || Date.now(),
          ultima_respuesta: respuesta,
          ultimos_productos: previos.map((p) => p.titulo),
        });
        return;
      }

      console.log(
        "Pidió divisas, pero no sé de qué equipos habla (ni lista guardada " +
          "ni nombres en el último mensaje): sigo por el camino normal."
      );
    }
  }

  const minutosCallado = minutosDesde(contacto.ultimo_envio);

  // Esto es lo que conecta la IA con la hoja: sin el catálogo delante, el
  // modelo elegiría el término de búsqueda a ciegas. Se lee cacheado (ver
  // MINUTOS_DE_CACHE en sheets.js), así que preguntar en cada mensaje no
  // dispara una descarga nueva de Google cada vez.
  const catalogo = await listaDeTitulos(env);

  // Las fotos de Instagram salen de un CDN protegido que le da 403 a
  // OpenAI si intenta descargarlas él mismo. Se descargan aquí, en el
  // Worker, y se le pasan ya como data URI.
  let foto = "";
  let porQueNo = "";
  if (imagenCruda) {
    ({ uri: foto, motivo: porQueNo } = await comoDataUri(env, imagenCruda));
  }

  // Si hay foto, primero se identifica con la IA de visión —dedicada,
  // normalmente un modelo más fuerte porque ya no tiene que redactar
  // nada— y el resultado se le entrega a la IA de texto como un dato más
  // del contexto: es ELLA quien decide qué decirle al cliente.
  let marcaFoto = "";
  // Lo que la IA de visión sacó de la imagen, si sacó algo. Se guarda
  // aparte porque más abajo hay una decisión que depende de si de verdad
  // SABEMOS qué equipo es, y no de si el modelo escribió algo.
  let equipoDeLaPublicacion = "";
  if (foto) {
    const identificacion = await identificarEnImagen(env, foto, catalogo, {
      esPublicacion: Boolean(publicacion),
    });
    if (identificacion) {
      console.log(
        `La IA de visión vio: "${identificacion.visto || ""}" → busco: "${identificacion.buscar}"`
      );
      marcaFoto = marcarIdentificacion(
        identificacion.buscar,
        identificacion.pedirNombreExacto,
        esHistoria,
        Boolean(publicacion)
      );

      if (String(identificacion.buscar).toUpperCase() !== "NADA") {
        equipoDeLaPublicacion = identificacion.buscar;
      }
    } else {
      console.error("La IA de visión no respondió: sigo solo con el texto");
      foto = "";
      porQueNo = porQueNo || "otro";
    }
  }

  // EL PIE DE LA PUBLICACIÓN, CUANDO LA IMAGEN NO BASTA.
  //
  // Es el mismo arreglo que el de los comentarios (ver mejorDelCatalogo):
  // el pie casi siempre nombra el equipo, pero escrito como se escribe en
  // Instagram ("El Galaxy S25 FE"), no como está en la hoja ("Samsung
  // Galaxy S25 FE 256GB"). Contando palabras sí se reconoce, y entonces el
  // modelo recibe el nombre exacto de la hoja en vez de tener que
  // adivinarlo del texto de venta.
  if (publicacion && !equipoDeLaPublicacion) {
    const delPie = equipoQueNombra(
      `${publicacion.titulo || ""} ${publicacion.descripcion || ""}`,
      await catalogoCompleto(env)
    );

    if (delPie) {
      equipoDeLaPublicacion = delPie;
      marcaFoto = marcarIdentificacion(delPie, false, esHistoria, true);
      console.log(`El pie de la publicación nombra "${delPie}": eso es lo que busco`);
    }
  }

  // Si no se puede mirar, NO es el final del camino. La mayoría de las
  // historias son vídeo, y el cliente que responde a una historia es el que
  // más cerca está de comprar: se le atiende por lo que escribió.
  //
  // Con una publicación compartida se juntan dos cosas: lo que la IA de
  // visión sacó de la imagen (o el aviso de que no se pudo mirar) y lo que
  // solo sabe la publicación — su pie de foto y, si venía de un enlace de
  // ficha, el nombre exacto del producto.
  const marca = publicacion
    ? [
        foto ? marcaFoto : marcarPublicacionSinVer(porQueNo),
        marcaDePublicacion({
          titulo: publicacion.titulo,
          descripcion: publicacion.descripcion,
          termino: publicacion.termino,
        }),
      ]
        .filter(Boolean)
        .join("\n")
    : imagenCruda
      ? foto
        ? marcaFoto
        : marcarSinVer(porQueNo, esHistoria)
      : "";

  const entrada = contexto(
    nombre,
    historialPrevio,
    textoCliente,
    marca,
    esHistoria,
    minutosCallado,
    catalogo,
    Boolean(publicacion)
  );

  const salida = await responderTexto(env, entrada);

  if (!salida) {
    await mandar(() => enviarTexto(env, mensaje.igsid, FALLO_TECNICO), FALLO_TECNICO);
    await guardarContacto(env.DB, {
      ...contacto,
      nombre,
      mids_enviados: mids,
      ultimo_envio: enviadoEn || Date.now(),
    });
    await avisarAsesor(env, {
      ...paraElAviso(contacto),
      igsid: mensaje.igsid,
      mensaje: textoCliente,
      respuesta: "EL MODELO FALLÓ — nadie le respondió",
      motivo: "EL MODELO NO RESPONDIÓ",
      historia: esHistoria ? "respuesta a una historia" : "",
    });
    return;
  }

  const {
    productos,
    respuestaCliente,
    segundoMensaje,
    termino,
    esConsultaDeAsesor,
    buscoSinExito,
    hayMas,
    porCategoria,
  } = await decidir({ env, salida, texto: mensaje.texto, historialPrevio });

  // El precio que va en cada ficha depende de lo que preguntó el cliente
  // (Cashea, divisas, o el de por defecto). Se resuelve ACÁ y las fichas
  // salen con el precio ya escrito: así instagram.js no necesita saber
  // nada de Cashea y sigue sirviendo igual para cualquier tienda.
  const conCashea = PREGUNTA_CASHEA.test(mensaje.texto);
  const conDivisas = PREGUNTA_DIVISAS.test(mensaje.texto);
  const fichas = productos.map((p) => ({
    ...p,
    precio: subtituloDeFicha(p, conCashea, conDivisas),
  }));

  // NO SABEMOS QUÉ EQUIPO ES EL DE LA PUBLICACIÓN: SE PREGUNTA (crítico).
  //
  // EL FALLO QUE ESTO ARREGLA (24-sep-2026). Un cliente mandó el enlace de
  // una publicación del POCO M8 PRO y el bot le contestó con el Samsung
  // A57 — el equipo del que se venía hablando en esa conversación. El
  // enlace no se pudo abrir, la imagen no estaba, y el modelo rellenó el
  // hueco con lo único que tenía delante: el historial.
  //
  // Un hueco no se rellena con el pasado. Si ni la visión, ni la ficha del
  // enlace, ni el pie de la publicación, ni lo que escribió el cliente
  // nombran un equipo, entonces NO SE SABE — y se pregunta. Esto es código,
  // no una instrucción del prompt, justamente porque el modelo ya demostró
  // que ahí se deja llevar.
  const sinSaberQueEs =
    Boolean(publicacion) &&
    !publicacion.soloContexto &&
    !equipoDeLaPublicacion &&
    !publicacion.termino &&
    !equipoQueNombra(
      `${publicacion.titulo || ""} ${publicacion.descripcion || ""} ${mensaje.texto}`,
      await catalogoCompleto(env)
    );

  if (sinSaberQueEs) {
    console.log(
      `Publicación de ${mensaje.igsid} sin identificar: pregunto cuál es en vez ` +
        `de contestar con el equipo anterior${termino ? ` (el modelo iba a buscar "${termino}")` : ""}`
    );
  }

  const paraMostrar = sinSaberQueEs ? [] : fichas;
  const leDigo = sinSaberQueEs
    ? alAzar(PUBLICACION_SIN_IDENTIFICAR)
    : paraMostrar.length
      ? sinListaPegada(respuestaCliente)
      : respuestaCliente;

  // EL CATÁLOGO NO ES LA RESPUESTA POR DEFECTO. El botón sale en dos casos:
  // buscamos lo que pidió y no apareció, o hay más de los que caben en el
  // carrusel. Una pregunta de vendedora —"¿lo quieres nuevo o usado?"— sale
  // como texto limpio: el cliente que se va al catálogo se va de la
  // conversación.
  if (paraMostrar.length) {
    await mandar(() => enviarTexto(env, mensaje.igsid, leDigo), leDigo);
    await mandar(() => enviarFichas(env, mensaje.igsid, paraMostrar));
    // Solo si hay una tienda de verdad a la que mandarlo. Sin catálogo no
    // sale nada: el cliente se queda con sus fotos y su pregunta.
    if (hayMas && hayQueDecirQueHayMas(env)) {
      await mandar(
        () => enviarBotonCatalogo(env, mensaje.igsid, HAY_MAS_EN_CATALOGO),
        HAY_MAS_EN_CATALOGO
      );
    }
  } else if (buscoSinExito && !sinSaberQueEs) {
    await mandar(() => enviarBotonCatalogo(env, mensaje.igsid, leDigo), leDigo);
  } else {
    await mandar(() => enviarTexto(env, mensaje.igsid, leDigo), leDigo);
  }

  // El segundo mensaje de la tabla de pagos (Krece). Sale detrás del
  // primero, nunca solo, y nunca cuando no sabemos de qué equipo hablamos.
  const segundo = sinSaberQueEs ? "" : segundoMensaje;
  if (segundo) {
    await mandar(() => enviarTexto(env, mensaje.igsid, segundo), segundo);
  }

  const escalada = hayEscalada({
    respuesta: leDigo,
    productos: paraMostrar,
    esConsultaDeAsesor: esConsultaDeAsesor && !sinSaberQueEs,
    buscoSinExito: buscoSinExito && !sinSaberQueEs,
  });

  if (escalada) {
    await avisarAsesor(env, {
      ...paraElAviso(contacto),
      igsid: mensaje.igsid,
      mensaje: textoCliente,
      respuesta: leDigo,
      motivo: motivo({ esConsultaDeAsesor }),
      historial: salida.historial || historialPrevio,
      busco: termino,
      productos,
      historia: esHistoria ? "respuesta a una historia" : "",
    });
  }

  await guardarContacto(env.DB, {
    id: mensaje.igsid,
    nombre,
    // Si no supimos qué equipo era el de la publicación, el historial NO
    // puede quedarse con lo que el modelo había escrito —hablaba del
    // equipo anterior— o el próximo mensaje volvería al mismo error.
    historial: recortarHistorial(
      sinSaberQueEs
        ? conNota(historialPrevio, "Compartió una publicación que no pude identificar: le pregunté cuál es.")
        : porCategoria
          ? conNota(
              salida.historial || historialPrevio,
              `No había "${termino}": le mostré los de "${porCategoria}". Ya busqué: ${porCategoria}.`
            )
          : salida.historial || historialPrevio
    ),
    pausado_hasta: contacto.pausado_hasta,
    mids_enviados: mids,
    // Lo que se le acaba de decir, tal cual. Es lo que hace posible el
    // "muéstrame esos" del próximo mensaje (ver recomendados.js).
    ultima_respuesta: leDigo,
    // Y los títulos de lo que acaba de ver, para el "¿y en divisas?" que
    // viene detrás. Si este turno no mostró nada, se queda lo de antes:
    // una pregunta suelta no borra el carrusel del que está hablando.
    ultimos_productos: paraMostrar.length
      ? paraMostrar.map((p) => p.titulo)
      : contacto.ultimos_productos,
    // Si TODOS los envíos fallaron, enviadoEn sigue en 0 y no hay que pisar
    // la marca anterior con un cero.
    ultimo_envio: enviadoEn || contacto.ultimo_envio,
  });
}

/* ── La publicación del feed que compartió el cliente ──────────────
   Devuelve lo que hay que atender en ESTE turno:

     null                    no hay ninguna publicación en juego
     { yaContestaron: true } la pregunta que venía detrás ya contestó por
                             ella: este turno se calla
     { imagen, titulo, ... } la publicación que hay que atender

   Los dos caminos por los que llega son el botón de compartir (un adjunto
   en el webhook) y el enlace pegado a mano en el texto. Los dos acaban
   aquí y salen iguales.
   ───────────────────────────────────────────────────────────────── */
async function publicacionDelTurno(env, mensaje, contacto) {
  const compartida = mensaje.tipo === "publicacion";
  const enlaceEscrito = compartida ? "" : enlaceEnTexto(mensaje.texto);

  if (compartida || enlaceEscrito) {
    const cruda = compartida
      ? mensaje.publicacion
      : { url: "", titulo: "", enlace: enlaceEscrito };

    // Si lo que llegó es un enlace, hay dos formas de leerlo, y el orden
    // importa:
    //
    //   1. POR LA API, si es una publicación NUESTRA. Es la buena: devuelve
    //      el pie de foto y la imagen de verdad, sin depender de que
    //      Instagram nos deje entrar por la puerta de la calle.
    //   2. Raspando la página (etiquetas og:), para todo lo demás — la
    //      ficha de un producto, otra web. Instagram casi siempre devuelve
    //      un muro de inicio de sesión por este camino, y por eso es el
    //      segundo.
    const leido = cruda.enlace
      ? (await buscarEnNuestroFeed(env, cruda.enlace)) || (await leerEnlace(cruda.enlace))
      : { imagen: "", titulo: "", descripcion: "", termino: "" };

    // UN ENLACE DEL QUE NO SE SACÓ NADA NO ES UNA PUBLICACIÓN. Si el
    // cliente pegó una dirección cualquiera y no se pudo leer ni la foto ni
    // el título, tratarla como publicación solo serviría para decirle al
    // modelo que hay algo que no hay. Se sigue como un mensaje normal.
    //
    // La excepción es Instagram, que a ratos no se deja leer desde fuera:
    // ahí sí sabemos que es una publicación nuestra, y eso ya cambia la
    // respuesta —le preguntamos cuál le gustó en vez de qué busca.
    const algoUtil = Boolean(
      cruda.url || leido.imagen || leido.titulo || leido.descripcion || leido.termino
    );
    if (!compartida && !algoUtil && !esEnlaceDeInstagram(enlaceEscrito)) {
      console.log(`El enlace de ${mensaje.igsid} no dio nada: sigo como mensaje normal`);
      return null;
    }

    const nueva = {
      url: cruda.url || "",
      imagen: cruda.url || leido.imagen || "",
      titulo: cruda.titulo || leido.titulo || "",
      descripcion: leido.descripcion || "",
      enlace: cruda.enlace || "",
      termino: leido.termino || "",
      cuando: Date.now(),
      // Si el mismo mensaje ya trae la pregunta, no hay nada que esperar:
      // este turno contesta, y queda marcada para que nadie la repita.
      atendida: Boolean(mensaje.texto),
    };

    await guardarPublicacion(env.DB, mensaje.igsid, nueva);
    console.log(
      `Publicación compartida por ${mensaje.igsid} · imagen: ${nueva.imagen ? "sí" : "no"} · ` +
        `ficha: ${nueva.termino || "—"}`
    );

    if (mensaje.texto) return nueva;

    // Sin texto: lo más probable es que la pregunta venga en camino, un
    // segundo detrás. Se le da tiempo a llegar. Si llega, contesta ella —
    // con esta publicación ya guardada delante— y este turno se calla.
    await new Promise((seguir) => setTimeout(seguir, ESPERA_POR_LA_PREGUNTA_MS));

    const alSegundoVistazo = await cargarContacto(env.DB, mensaje.igsid);
    const yaAtendida = alSegundoVistazo.publicacion?.atendida;
    const yaRespondimos = Number(alSegundoVistazo.ultimo_envio) > nueva.cuando;
    // Y si mientras tanto compartió OTRA publicación, la que vale es la
    // suya, no esta: contesta ese turno y este se aparta.
    const hayUnaMasNueva =
      Number(alSegundoVistazo.publicacion?.cuando || 0) > nueva.cuando;

    if (yaAtendida || yaRespondimos || hayUnaMasNueva) return { yaContestaron: true };

    await guardarPublicacion(env.DB, mensaje.igsid, { ...nueva, atendida: true });
    return nueva;
  }

  // Un mensaje normal con una publicación recién compartida detrás: el
  // "precio?" que llega un segundo después del post. Esta es la otra mitad
  // de la unión, y la que de verdad contesta en el caso de las capturas.
  const guardada = publicacionVigente(contacto, PUBLICACION_FRESCA_MS);
  if (!guardada) return null;

  // Si además mandó una foto suya o respondió a una historia, esa imagen
  // manda: la publicación se queda solo como contexto.
  const suPropiaImagen = Boolean(mensaje.foto || mensaje.historia?.url);

  if (guardada.atendida || suPropiaImagen) {
    // Ya se contestó por ella, o el cliente mandó algo suyo que manda más.
    // Sigue sirviendo de contexto —"¿y ese cuánto sale?" habla de eso— pero
    // no vuelve a mirarse la imagen, y NO entra en el guardián de "no sé
    // qué equipo es": eso es para la publicación que llega ahora, no para
    // una conversación que ya iba por buen camino.
    return { ...guardada, imagen: "", soloContexto: true };
  }

  // Se marca ANTES de llamar al modelo: la llamada tarda segundos, y es en
  // esa ventana cuando el otro webhook decide si contesta o se calla.
  await guardarPublicacion(env.DB, mensaje.igsid, { ...guardada, atendida: true });
  console.log(
    `Uno la publicación de ${mensaje.igsid} con su pregunta: ` +
      JSON.stringify(mensaje.texto.slice(0, 60))
  );
  return guardada;
}

async function avisarQueYaLoAtienden(env, mensaje, contacto, mandar) {
  // Se deduce de la propia pausa: pausado_hasta se fijó en "ahora + horas"
  // en el momento en que el asesor escribió, y se vuelve a fijar con cada
  // mensaje suyo. Restando las horas se sabe cuándo fue el último.
  const horas = Number(env.PAUSA_HORAS) || PAUSA_HORAS_POR_DEFECTO;
  const ultimoDelAsesor = Number(contacto.pausado_hasta) - horas * 60 * 60 * 1000;

  // ultimo_envio, durante una pausa, solo lo mueve este mismo aviso: el bot
  // no manda nada más. Así que sirve de reloj para no repetirse.
  const desdeElUltimoAviso = Date.now() - (Number(contacto.ultimo_envio) || 0);
  if (desdeElUltimoAviso < AVISO_PAUSA_CADA_MS) {
    console.log(`Ya le avisé hace poco a ${mensaje.igsid}: no repito`);
    return;
  }

  // mandar() ya lo anota en D1 en el momento: el eco de este mismo aviso
  // no puede volver y parecer el mensaje de otro asesor.
  const aviso = alAzar(YA_TE_ATIENDEN);
  await mandar(() => enviarTexto(env, mensaje.igsid, aviso), aviso);

  const silencio = Date.now() - ultimoDelAsesor;
  if (silencio < ASESOR_CALLADO_MS) return;

  await avisarAsesor(env, {
    ...paraElAviso(contacto),
    igsid: mensaje.igsid,
    mensaje: mensaje.texto || "(mandó una foto)",
    respuesta: "El bot está en pausa: solo le dijo que ya lo atienden.",
    motivo: "TE ESTÁN ESPERANDO",
    historial: `Tomaste esta conversación hace ${Math.round(silencio / 60000)} min y el cliente volvió a escribir.`,
  });
}

// Las columnas nuevas (nombre_completo, usuario) se crean solas
// la primera vez. Si la revisión falla, se sigue igual: guardarContacto
// tiene su propio rescate, y /estado dice qué pasa con la base.
async function prepararBase(env) {
  try {
    await asegurarColumnas(env.DB);
  } catch (error) {
    console.error("No pude revisar las columnas de la base:", error?.message || error);
  }
}

// Busca el perfil de Instagram del cliente si todavía no lo tenemos, y lo
// guarda. Devuelve el contacto con los datos puestos.
//
// Se considera "ya buscado" en cuanto hay nombre completo o @: con eso ya no
// se vuelve a gastar una llamada. Si Instagram no devolvió nada (token sin
// permiso, perfil restringido), se reintenta en el mensaje siguiente.
async function asegurarPerfil(env, contacto) {
  if (contacto.nombre_completo || contacto.usuario) return contacto;

  const perfil = await obtenerPerfil(env, contacto.id);
  if (!perfil.nombre_completo && !perfil.usuario) return contacto;

  const conPerfil = {
    ...contacto,
    ...perfil,
    nombre: contacto.nombre || primerNombre(perfil.nombre_completo),
  };

  try {
    await guardarPerfil(env.DB, contacto.id, conPerfil);
    console.log(`Perfil guardado: ${comoSeLlama(conPerfil)} (${contacto.id})`);
  } catch (error) {
    console.error("No se pudo guardar el perfil:", error?.message || error);
  }
  return conPerfil;
}

// Lo que el aviso de Slack necesita para decir QUIÉN es el cliente.
function paraElAviso(contacto = {}) {
  return {
    nombre: contacto.nombre || "",
    nombreCompleto: contacto.nombre_completo || "",
    usuario: contacto.usuario || "",
  };
}

function agregarMid(lista, mid) {
  return mid ? [...lista, mid] : lista;
}

function texto200(cuerpo) {
  return new Response(cuerpo, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

// Añade una nota al historial sin repetirla si ya está al final: si alguien
// escribe "más" cinco veces seguidas, el historial no se llena de copias.
function conNota(historial, nota) {
  const previo = String(historial || "").trim();
  if (!previo) return nota;
  if (previo.endsWith(nota)) return previo;
  return `${previo} ${nota}`;
}

function urlValida(valor) {
  const texto = String(valor || "").trim();
  return /^https?:\/\//i.test(texto) ? texto : "";
}

// Lo que se le dice al modelo cuando la foto no se pudo mirar. Es la
// diferencia entre que el cliente reciba una pregunta de vendedora o un
// mensaje de avería. La mayoría de las historias son vídeo, y Meta no
// entrega el fotograma: pasa a diario y NO es un error.
function marcarSinVer(motivo, esHistoria) {
  const donde = esHistoria
    ? "EL CLIENTE RESPONDIÓ A UNA HISTORIA"
    : "EL CLIENTE MANDÓ UNA FOTO";

  if (motivo === "video") {
    return (
      `[${donde} QUE ES UN VÍDEO Y NO PUEDES VERLA]\n` +
      "[NO digas que hubo un error. Pregúntale con naturalidad qué modelo " +
      "le interesa, y si en su mensaje ya nombra uno, búscalo directamente]"
    );
  }

  return (
    `[${donde} PERO NO PUDISTE VER LA IMAGEN]\n` +
    "[NO digas que hubo un error ni le pidas otra foto. Pregúntale qué " +
    "modelo le interesa, y si ya lo nombra, búscalo directamente]"
  );
}

// Lo mismo, cuando lo que no se pudo mirar es una publicación compartida.
// La mayoría son reels, o sea vídeo: no es una avería y el cliente no puede
// recibir un mensaje de avería. Y aquí hay algo que en una foto suelta no
// hay: el pie de la publicación, que muchas veces nombra el equipo.
function marcarPublicacionSinVer(motivo) {
  const que =
    motivo === "video"
      ? "LA PUBLICACIÓN ES UN VÍDEO Y NO PUEDES VERLO"
      : "NO PUDISTE ABRIR LA IMAGEN DE LA PUBLICACIÓN";

  return (
    `[EL CLIENTE COMPARTIÓ UNA PUBLICACIÓN DE NUESTRO PROPIO FEED, PERO ${que}]\n` +
    "[NO digas que hubo un error ni le pidas una foto. Guíate por el texto de " +
    "la publicación y por lo que escribió él; si aun así no sabes qué equipo " +
    "es, pregúntale cuál le interesa — nunca \"¿qué buscas?\", que acaba de " +
    "señalártelo]"
  );
}

// El bloque de contexto que le dice a la IA de texto qué encontró la IA de
// visión en la foto. La IA de texto no ve la imagen, solo este resumen, y
// es ella quien redacta con su propio tono.
function marcarIdentificacion(buscar, pedirNombreExacto, esHistoria, esPublicacion = false) {
  const encabezado = esPublicacion
    ? "[EL CLIENTE COMPARTIÓ UNA PUBLICACIÓN DE NUESTRO PROPIO FEED. Está " +
      "preguntando por el equipo que sale ahí, así que NO le preguntes qué " +
      "busca: ya te lo señaló. "
    : esHistoria
      ? "[EL CLIENTE RESPONDIÓ A UNA HISTORIA — la imagen que ves ES la historia. "
      : "[EL CLIENTE MANDÓ UNA FOTO DE UN EQUIPO. ";

  if (String(buscar).toUpperCase() === "NADA") {
    return (
      encabezado +
      "NO SE PUDO IDENTIFICAR NINGÚN MODELO NI MARCA CON SEGURIDAD. " +
      "Pregúntale con naturalidad cuál le interesa, como preguntaría una " +
      "vendedora. NUNCA le pidas que mande otra foto" +
      (esHistoria || esPublicacion ? ": ya tienes la imagen delante." : ".") +
      "]"
    );
  }

  if (pedirNombreExacto) {
    return (
      encabezado +
      `SE RECONOCIÓ LA MARCA "${buscar}", PERO NO EL MODELO EXACTO. ` +
      "Muéstrale esa marca Y pídele el modelo exacto, las dos cosas en el " +
      "mismo mensaje.]"
    );
  }

  return (
    encabezado +
    `SE IDENTIFICÓ: "${buscar}". Muéstraselo con naturalidad, como si el ` +
    "cliente lo hubiera escrito él mismo.]"
  );
}

// Lo que ve el modelo antes del mensaje del cliente. La construcción vive en
// historial.js, que es donde está la regla de separar pasado y presente.
function contexto(
  nombre,
  historial,
  texto,
  marca = "",
  esHistoriaNueva = false,
  minutos = 0,
  catalogo = "",
  esPublicacionNueva = false
) {
  return contextoParaElModelo({
    nombre: primerNombre(nombre),
    historial,
    texto,
    marca,
    esHistoriaNueva,
    esPublicacionNueva,
    minutosDesdeElUltimo: minutos,
    catalogo,
  });
}

// LA LISTA ESCRITA ES PARA LAS LISTAS, NO PARA LAS FOTOS.
//
// EL FALLO QUE ESTO ARREGLA (24-sep-2026, visto por el dueño). El cliente
// pidió "las fotos de los cables" y recibió las fotos... con los siete
// nombres escritos encima:
//
//   Claro, aquí tienes los cables que tengo disponibles 👇
//   🔹 Samsung Cable Tipo C 1Metro
//   🔹 Samsung Cable Tipo C 2metros
//   ... y debajo, el carrusel con esas mismas fotos y esos mismos nombres
//
// Es decir dos veces lo mismo, y encima empuja las fotos media pantalla
// hacia abajo. Cada ficha ya lleva su nombre y su precio debajo de la
// imagen: enumerarlos antes no aporta nada.
//
// Cuándo SÍ va la lista escrita: cuando el cliente pide una lista y no hay
// fotos de por medio (ver lista.js). Por eso esto solo se aplica en el
// momento de mandar fichas.
const LINEA_DE_LISTA = /^\s*(?:[🔹🔸🔵⚪🟡💎▪️▫️•·]|[-*]\s|\d+[.)])\s*/u;

function sinListaPegada(texto) {
  const lineas = String(texto || "").split("\n");
  const cuantas = lineas.filter((linea) => LINEA_DE_LISTA.test(linea)).length;

  // Una línea suelta con viñeta no es una lista: puede ser parte de la
  // frase. Con dos ya está enumerando.
  if (cuantas < 2) return texto;

  const limpio = lineas
    .filter((linea) => !LINEA_DE_LISTA.test(linea))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  console.log(`Quité ${cuantas} línea(s) de lista del texto: van las fichas debajo`);

  // Si al quitar la lista no queda nada que decir, es que el mensaje ERA
  // la lista: se sustituye por la frase que presenta el carrusel.
  return limpio || "¡Aquí los tienes! 👇";
}

// ¿ESTE TEXTO NOMBRA ALGÚN EQUIPO DEL CATÁLOGO?
//
// Se usa para dos decisiones donde equivocarse cuesta caro:
//
//   · "¿y en divisas?" — si NO nombra nada, habla de lo que acaba de ver,
//     y hay que volver a mostrarle eso mismo.
//   · una publicación compartida que no se pudo identificar — si ni la
//     publicación ni el cliente nombran un equipo, se pregunta; nunca se
//     contesta con el equipo de la conversación anterior.
//
// Se mira en los dos sentidos: el título entero dentro del texto ("Poco
// M8 Pro 8/256" cuando el cliente escribió justo eso) y las primeras
// palabras del título ("Poco M8 Pro" dentro de un texto que dice "POCO M8
// PRO", aunque el título del catálogo siga con la capacidad).
function nombraDelCatalogo(texto, productos) {
  const donde = despejar(texto);
  if (!donde || !productos?.length) return "";

  for (const producto of productos) {
    const titulo = despejar(producto.titulo);
    if (titulo.length >= 4 && donde.includes(titulo)) return producto.titulo;

    // Y POR EL PRINCIPIO DEL TÍTULO, DE MÁS LARGO A MÁS CORTO.
    //
    // El cliente no escribe el título entero. Dice "el Poco M8 en divisas"
    // y en la hoja está como "Poco M8 pro 5G": ni el título completo ni
    // sus tres primeras palabras ("poco m8 pro") aparecen en su mensaje,
    // pero "poco m8" sí.
    //
    // Esto lo pilló el banco de pruebas: sin las dos palabras, un "¿y el
    // Poco M8 en divisas?" se tomaba por "los de antes en divisas" y el
    // cliente recibía otra vez el equipo anterior.
    //
    // Dos palabras es el mínimo, y solo si juntas miden 6 letras o más:
    // con una sola bastaría un "samsung" suelto para pescar cualquier cosa.
    const palabras = titulo.split(" ");
    for (const cuantas of [3, 2]) {
      const principio = palabras.slice(0, cuantas).join(" ");
      if (principio.length >= 6 && donde.includes(principio)) return producto.titulo;
    }
  }

  return "";
}

/* ── EL PIE DE LA PUBLICACIÓN NO ESTÁ ESCRITO COMO LA HOJA ─────────

   EL FALLO QUE ESTO ARREGLA (26-sep-2026, visto en producción). Alguien
   comentó "Precio por favor" debajo de una publicación cuyo pie decía:

     "🔥 ¿Buscas alta gama sin pagar una fortuna? El Galaxy S25 FE"

   y el bot contestó que no sabía de qué equipo hablaba. El equipo estaba
   en la hoja, con su foto y su precio, entre los 93 productos.

   ¿Por qué falló? Porque nombraDelCatalogo mira el título de la hoja
   DESDE EL PRINCIPIO: si ahí está como "Samsung Galaxy S25 FE", busca
   "samsung galaxy" dentro del pie. Y ningún pie de Instagram empieza
   nombrando la marca: empieza vendiendo. "El Galaxy S25 FE" no contiene
   "samsung galaxy", así que no hubo coincidencia.

   Esto lo resuelve al revés: en vez de exigir que el texto contenga el
   principio del título, mira CUÁNTAS palabras del título aparecen en el
   texto, estén donde estén, y se queda con el que más acierte.

   La trampa de contar palabras es "samsung": está en medio catálogo y no
   distingue nada. Así que se cuenta en cuántos títulos aparece cada
   palabra, y solo valen los aciertos que incluyan al menos una palabra
   POCO común ("s25", "a57", "skydolphing"). Sin eso, un pie que dijera
   "los mejores Samsung" pescaría cualquier Samsung.
   ───────────────────────────────────────────────────────────────── */

// Palabras que aparecen en cualquier frase y no nombran ningún equipo.
const NO_NOMBRAN_NADA = new Set([
  "de", "del", "la", "el", "los", "las", "un", "una", "unos", "unas",
  "con", "sin", "por", "para", "en", "al", "y", "o", "su", "tu", "mi",
  "new", "nuevo", "nueva", "nuevos", "nuevas", "original", "sellado",
  "sellada", "disponible", "disponibles", "oferta", "ofertas", "precio",
  "precios", "tienda", "envio", "envios",
  // Estas van en medio catálogo y no señalan a ningún equipo: sirven de
  // adorno en el título, no de nombre.
  "5g", "4g", "lte", "gb", "tb", "ram", "dual", "sim",
]);

// UNA FICHA TÉCNICA NO ES UN NOMBRE (26-sep-2026).
//
// "128gb", "256", "25w", "8340mah", "200mp": son lo que el equipo TIENE,
// no cómo se llama. Y los pies de Instagram están llenos de ellas, porque
// es con lo que se vende: "Carga rápida de 25w", "Batería de 8,340 mAh".
//
// EL FALLO QUE ESTO ARREGLA. Ese pie —de una publicación de un TELÉFONO—
// hacía que el bot contestara con el "Cargador Samsung 25w" del catálogo:
// coincidía el 25w y nada más. El cliente comentaba en un teléfono y
// recibía un cargador.
const ES_ESPECIFICACION = /^\d+([.,]\d+)?(gb|tb|mb|w|kw|mah|mp|hz|mm|cm|ml|v|k|x|pulgadas)?$/;

// Y TAMPOCO IDENTIFICA UNA PALABRA QUE SOLO DICE LA CLASE DE PRODUCTO.
//
// "batería", "cámara", "carga", "memoria" son las palabras con las que se
// anuncia un teléfono, y a la vez son el título de un accesorio ("Batería
// externa Powerbank"). Una sola de esas no puede decidir: hace falta que
// coincida algo más —la marca, el modelo, la capacidad—, y entonces sí.
function soloDiceLaClase(palabra) {
  return Boolean(tipoQuePide(palabra));
}

// "a57", "m8", "s25", "s40e": una letra y un número pegados. Son cortos
// pero son EL nombre del equipo, así que valen aunque vengan solos.
function pareceCodigoDeModelo(palabra) {
  return /[a-z]/.test(palabra) && /\d/.test(palabra) && !ES_ESPECIFICACION.test(palabra);
}

function palabrasDeTitulo(texto) {
  return despejar(texto)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((palabra) => palabra.length >= 2 && !NO_NOMBRAN_NADA.has(palabra));
}

function mejorDelCatalogo(texto, productos) {
  const enElTexto = new Set(palabrasDeTitulo(texto));
  if (!enElTexto.size || !productos?.length) return "";

  // En cuántos títulos aparece cada palabra. Lo que está en muchos no
  // distingue nada; lo que está en pocos lo dice todo.
  const cuantosLaUsan = new Map();
  for (const producto of productos) {
    for (const palabra of new Set(palabrasDeTitulo(producto.titulo))) {
      cuantosLaUsan.set(palabra, (cuantosLaUsan.get(palabra) || 0) + 1);
    }
  }

  // "Poco común" es estar en un cuarto del catálogo o menos. El mínimo de
  // 3 es para catálogos pequeños, donde un cuarto puede ser menos de uno.
  const comun = Math.max(3, Math.round(productos.length * 0.25));

  let mejor = null;

  for (const producto of productos) {
    const suyas = [...new Set(palabrasDeTitulo(producto.titulo))];
    if (!suyas.length) continue;

    const acertadas = suyas.filter((palabra) => enElTexto.has(palabra));
    if (!acertadas.length) continue;

    const propias = acertadas.filter((palabra) => (cuantosLaUsan.get(palabra) || 0) <= comun);

    // Con dos palabras basta, si alguna es de las que distinguen. Con una
    // sola se pide que sea poco común y que NOMBRE algo: una palabra con
    // cuerpo ("skydolphing") o un código de modelo ("a57"). Nunca una
    // capacidad suelta: "¿cuánto el de 128gb?" no dice qué equipo es.
    const sola = acertadas[0];
    const suficiente =
      acertadas.length >= 2
        ? propias.length >= 1
        : propias.length === 1 &&
          !ES_ESPECIFICACION.test(sola) &&
          !soloDiceLaClase(sola) &&
          (sola.length >= 4 || pareceCodigoDeModelo(sola));

    if (!suficiente) continue;

    // Gana el que más palabras acierte; a igualdad, el que las tenga más
    // repartidas por su título (un título de tres palabras acertado entero
    // vale más que dos palabras de uno de seis).
    const punto = acertadas.length + propias.length + acertadas.length / suyas.length;
    if (!mejor || punto > mejor.punto) mejor = { punto, producto, acertadas };
  }

  if (!mejor) return "";

  console.log(
    `El texto nombra "${mejor.producto.titulo}" por ${mejor.acertadas.join(", ")}`
  );
  return mejor.producto.titulo;
}

// El estricto primero (el título tal cual, o su principio) y el de contar
// palabras después: así una coincidencia exacta nunca la pisa una parecida.
function equipoQueNombra(texto, productos) {
  return nombraDelCatalogo(texto, productos) || mejorDelCatalogo(texto, productos);
}

function despejar(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// De la marca de tiempo del último envío a minutos, para contexto().
function minutosDesde(ultimoEnvio) {
  const ultimo = Number(ultimoEnvio) || 0;
  if (!ultimo) return 0;
  return Math.max(0, Math.round((Date.now() - ultimo) / 60000));
}

// Deja solo el primer nombre, y lo descarta si parece un usuario de
// Instagram en vez de un nombre. El prompt ya lo pide, pero aquí es una
// certeza: un "¡Hola jonathanrodric982101!" no puede llegarle a un cliente.
function primerNombre(nombre) {
  const limpio = String(nombre || "").trim();
  if (!limpio) return "";

  const primero = limpio.split(/\s+/)[0];
  if (primero.length < 2 || primero.length > 20) return "";
  if (/[0-9._\-@]/.test(primero)) return "";
  if (!/^[\p{L}][\p{L}'´]*$/u.test(primero)) return ""; // emojis, símbolos

  return primero.charAt(0).toUpperCase() + primero.slice(1);
}

// Red de seguridad: si ya se conocen y el modelo saluda igualmente, se le
// quita la presentación antes de que salga hacia el cliente. Solo se aplica
// cuando hay historial, así que nunca toca la bienvenida de verdad.
const PRESENTACION =
  /^\s*[¡!]*\s*hola\b[^\n]{0,25}?\bsoy\s+(la|el)\s+asistente(\s+virtual)?(\s+de\s+[^\n]{0,30}?)?\s*[👋😊🙌]*\s*[.!,]*\s*/i;

function sinBienvenida(respuesta) {
  const recortado = respuesta.replace(PRESENTACION, "").trim();
  // Si al quitarla no queda nada que decir, es que el mensaje era solo el
  // saludo: se sustituye por el saludo corto en vez de dejarlo vacío.
  if (!recortado) return "¡Hola! ¿Qué estás buscando? 😊";
  return recortado.charAt(0).toUpperCase() + recortado.slice(1);
}

// De lo que escribió el modelo a lo que se le manda al cliente: se limpia el
// término, se le quita el color, se busca en la hoja y se decide si la
// respuesta del modelo sirve o hay que sustituirla.
async function decidir({ env, salida, texto, historialPrevio }) {
  // El color se busca en lo que escribió EL CLIENTE, no en el término que
  // escribió el modelo: si el modelo ya lo quitó por su cuenta, el cliente
  // igual lo preguntó y el asesor tiene que enterarse.
  const coloresQueNombro = separarColor(texto).colores;
  const preguntoPorColor = PREGUNTA_POR_COLOR.test(texto) || coloresQueNombro.length > 0;

  if (preguntoPorColor) {
    console.log(
      coloresQueNombro.length
        ? `Preguntó por ${coloresQueNombro.join(" + ")}: el color lo confirma un asesor`
        : "Preguntó por colores: eso lo confirma un asesor"
    );
  }

  const esConsultaDeAsesor = CONSULTA_DE_ASESOR.test(texto) || preguntoPorColor;

  const terminoBruto = salida.buscar.toUpperCase() === "NADA" ? "" : limpiarTermino(salida.buscar);
  if (salida.buscar !== terminoBruto && terminoBruto) {
    console.log(`Limpié el término: "${salida.buscar}" -> "${terminoBruto}"`);
  }

  // EL COLOR SALE DEL TÉRMINO Y NO VUELVE.
  //
  // Antes se buscaba sin color y después se filtraba por color sobre los
  // títulos. Eso daba por hecho algo que la hoja no sabe: que el color del
  // título es el que hay en la tienda hoy. Ahora el color solo se le quita
  // al término —para que "el iPhone 15 blanco" encuentre los iPhone 15— y
  // quién tiene qué color lo dice un asesor.
  const { termino: sinColor, colores } = separarColor(terminoBruto);
  // No es const porque el rescate por referencia puede cambiarlo: si el
  // cliente describió el producto en vez de nombrarlo, el término bueno
  // aparece más abajo, después de que la búsqueda normal falle.
  let termino = sinColor;
  if (colores.length) {
    console.log(
      `El cliente nombró ${colores.join(" + ")}: lo saco del término y busco "${termino}". ` +
        "El color lo confirma un asesor."
    );
  }

  let productos = [];
  let hayMas = false;
  if (termino) {
    ({ productos, hayMas } = await buscarProductos(env, termino));
    console.log(
      productos.length
        ? `Busqué "${termino}": ${productos.length} resultado(s)${hayMas ? " (y hay más)" : ""}`
        : `Sin resultados para "${termino}"`
    );
  }

  // EL CLIENTE DESCRIBIÓ EN VEZ DE NOMBRAR.
  //
  // "Una pila para el teléfono", "el taco del cargador", "cascos". Nada de
  // eso está escrito en un título, así que la búsqueda vuelve vacía —o el
  // modelo ni busca— y el cliente se va con un "no hay" teniéndolo en la
  // tienda. referencias.js traduce eso a un término del catálogo.
  //
  // Se intenta DESPUÉS de la búsqueda normal, nunca antes: si el cliente
  // nombró el producto, manda lo que nombró. Esto es el rescate, no el
  // primer camino.
  if (!productos.length) {
    const referencia = referenciaEnTexto(texto);

    if (referencia && referencia.toLowerCase() !== termino.toLowerCase()) {
      const porReferencia = await buscarProductos(env, referencia);
      // La tabla de referencias traduce a un tipo ("cascos" → "Audifonos"),
      // así que lo que devuelve YA es del tipo que pidió.

      if (porReferencia.productos.length) {
        console.log(
          `Lo describió sin nombrarlo${termino ? ` ("${termino}" no dio nada)` : ""}: ` +
            `lo busco como "${referencia}"`
        );
        productos = porReferencia.productos;
        hayMas = porReferencia.hayMas;
        termino = referencia;
      }
    }
  }

  // PIDIÓ UNA CAPACIDAD QUE NO HAY (crítico para no perder la venta).
  //
  // "¿Tienen el 15 de 256?" terminaba mal cuando no había ese exacto: cero
  // resultados, "déjame confirmarte con un asesor", y el cliente se iba —
  // con el mismo modelo ahí, en 128 y en 512.
  //
  // Así que si la búsqueda traía una capacidad y no dio nada, se vuelve a
  // buscar el modelo SIN ella. Si aparece, no es que no lo tengamos: es que
  // no lo tenemos en esos gigas, y eso se puede decir con el dato delante.
  const { termino: sinCapacidad, capacidades: pedidas } = separarCapacidad(termino);
  let otrasCapacidades = [];

  if (termino && !productos.length && pedidas.length && sinCapacidad) {
    console.log(
      `Sin "${comoSeDicen(pedidas)}": busco "${sinCapacidad}" a ver en qué capacidades está`
    );
    const reintento = await buscarProductos(env, sinCapacidad);

    if (reintento.productos.length) {
      productos = reintento.productos;
      hayMas = reintento.hayMas;
      otrasCapacidades = capacidadesDe(productos);
      console.log(
        `El modelo SÍ está, en ${comoSeDicen(otrasCapacidades) || "capacidades que el título no dice"}`
      );
    }
  }

  // EL ORDEN IMPORTA, Y ESTE ES EL QUE VALE (25-sep-2026).
  //
  // La capacidad va ANTES que la categoría, y no al revés. Con el orden
  // anterior, "¿tienen el iPhone 15 de 256?" —sin 256 en la hoja— caía
  // primero en la categoría: partía el término, encontraba "iphone" y se
  // iba con un "de ese no me queda" y una fila de iPhones cualesquiera.
  // El rescate de la capacidad, que es el que sabe decir lo único que
  // cierra esa venta ("en 256 no, pero lo tengo en 128 y en 512"), ya no
  // se ejecutaba nunca: exige que no haya productos, y la categoría
  // acababa de llenarlos.
  //
  // De lo más preciso a lo más vago, siempre: el modelo exacto, la
  // descripción, la capacidad, y de última la categoría.
  // RESCATE 3 — LA CATEGORÍA.
  //
  // "cables dophin", "cargador anker", "forro de iphone 20": el cliente
  // nombra una marca o un modelo que esta tienda no maneja. La búsqueda
  // exige TODAS las palabras, así que devuelve cero — y ahí el bot se
  // quedaba diciendo "no tengo eso" y, en el peor de los casos, recitando
  // de memoria una lista sin fotos.
  //
  // Pero una de esas palabras SÍ existe en la tienda: "cables". Se prueban
  // las palabras del término por separado y, con la primera que devuelva
  // algo, se le enseña eso — con sus fotos y sus precios, que es lo que
  // hace que el cliente elija uno.
  //
  // Y RESPETA EL TIPO. "Forro para el Samsung A57" sin forros en la
  // tienda: partir el término y quedarse con "samsung" devolvía
  // teléfonos, que es exactamente lo que el cliente NO pidió. Si nombró un
  // tipo, el rescate solo puede traer cosas de ese tipo; si de ese tipo no
  // hay nada, no hay rescate que valga y se le dice que no hay.
  const tipoPedido = tipoQuePide(`${texto} ${termino}`);

  let porCategoria = "";
  if (!productos.length && /\s/.test(termino)) {
    for (const palabra of termino.split(/\s+/).filter((p) => p.length >= 3)) {
      const intento = await buscarProductos(env, palabra, 10, { tipo: tipoPedido });
      if (intento.productos.length) {
        productos = intento.productos;
        hayMas = intento.hayMas;
        porCategoria = palabra;
        console.log(
          `Sin resultados para "${termino}": le enseño los de "${palabra}" ` +
            `(${productos.length}), con foto y precio`
        );
        break;
      }
    }
  }

  // Preguntó por los gigas sin pedir unos concretos ("¿qué capacidades
  // tienen del 15?"). Se responde con lo que dicen los títulos que
  // volvieron, no con lo que el modelo haya supuesto antes de buscar.
  const quiereSaberCapacidades =
    preguntaPorCapacidad(texto) && !pedidas.length && productos.length;

  if (quiereSaberCapacidades && !otrasCapacidades.length) {
    otrasCapacidades = capacidadesDe(productos);
  }

  // Preguntó por los gigas y los títulos no los dicen. El modelo sí
  // "sabe" cuántos trae un A57 de fábrica, y por eso hay que quitarle la
  // palabra: lo que sabe no es de ESTA tienda.
  // La hoja dice "N/A": no es que falte el dato, es que no aplica.
  const capacidadNoAplica =
    Boolean(quiereSaberCapacidades) && !otrasCapacidades.length && noLlevaCapacidad(productos);

  const capacidadSinDato =
    Boolean(quiereSaberCapacidades) && !otrasCapacidades.length && !capacidadNoAplica;

  if (capacidadSinDato) {
    console.log(
      `Preguntó por la capacidad y ningún título de "${termino}" la trae: ` +
        "no dejo que el modelo la invente, va al asesor."
    );
  }

  // Si buscó y no encontró nada, no le damos la respuesta optimista del
  // modelo: no afirmamos que el producto no existe.
  const buscoSinExito = Boolean(termino) && !productos.length;

  // Preguntó algo de asesor y no quedó nada que mostrarle.
  const soloAsesor = esConsultaDeAsesor && !termino;

  // PREGUNTÓ POR LAS FORMAS DE PAGO, en general. Sale la tabla entera de
  // Cashea y Krece, escrita en el código, para que los diez porcentajes
  // salgan exactos y no parafraseados.
  //
  // No sale si ya dijo su nivel —"soy oro, cuánto pago"—: a ese no hay
  // que darle la tabla, hay que contestarle, y eso lo hace el modelo.
  // Tampoco si le estamos mostrando producto: ahí la venta va por otro
  // lado y la tabla se le cruza en medio.
  const preguntoPorPagos =
    PREGUNTA_POR_PAGOS.test(texto) && !YA_DIJO_SU_NIVEL.test(texto) && !productos.length;

  if (preguntoPorPagos) {
    console.log("Preguntó por las formas de pago: mando Cashea y Krece tal cual");
  }

  // ¿ENTRE LO QUE LE VAMOS A ENSEÑAR ESTÁ LO QUE PIDIÓ?
  //
  // Se mira contra los productos que de verdad van a salir, con las
  // palabras del cliente: si pidió "Poco X8 pro" y en el carrusel está
  // "Poco X8 pro 5G", entonces lo tenemos, y cualquier "no tengo" que haya
  // escrito el modelo es falso.
  //
  // Cuando NO está —pidió un modelo que no existe y se le enseñan otros de
  // la marca— la frase del modelo se respeta: ahí decir "ese no lo tengo"
  // es la verdad, y es lo que toca.
  const loQuePidio = productos.length ? nombraDelCatalogo(texto, productos) : "";

  // Y TAMBIÉN CUANDO ÉL LO DICE DE OTRA FORMA QUE LA HOJA.
  //
  // "¿Tienen Xiaomi Note?" y en la hoja están como "Redmi Note 17". El
  // carrusel trae justo lo que pidió, pero su mensaje no contiene ningún
  // título del catálogo, así que la comprobación de arriba decía que no, y
  // un "no manejo Xiaomi" del modelo se quedaba tal cual encima de seis
  // Xiaomi.
  //
  // La pregunta no es qué buscó el modelo —puede haber buscado de menos:
  // con "¿tienes el Poco Z99 ultra?" buscó "Poco" y encontró tres, y ese
  // Z99 no existe— sino si LO QUE ESCRIBIÓ EL CLIENTE encuentra estos
  // mismos productos. Eso se responde buscando su propio texto: la
  // búsqueda ya sabe de submarcas ("xiaomi" vale por "redmi"), ya perdona
  // erratas y ya ignora el relleno, pero NO perdona un número que no
  // existe. Si su texto los encuentra, el carrusel es lo que pidió.
  let acertoLaBusqueda = false;

  if (productos.length && !porCategoria) {
    const { productos: porSuTexto } = await buscarProductos(env, texto, 20);
    const encontrados = new Set(porSuTexto.map((p) => despejar(p.titulo)));
    acertoLaBusqueda = productos.some((p) => encontrados.has(despejar(p.titulo)));
  }

  const leMuestroLoQuePidio = Boolean(loQuePidio) || acertoLaBusqueda;

  if (leMuestroLoQuePidio && AFIRMA_QUE_NO_HAY.test(salida.respuesta)) {
    console.log(
      `El modelo dijo que no hay, y "${loQuePidio}" está en el carrusel: le cambio la respuesta`
    );
  }

  // Si ya se conocen, se le quita la bienvenida aunque el modelo la haya
  // escrito. Es el fallo que más se nota: saludar dos veces.
  const respuestaFinal = historialPrevio ? sinBienvenida(salida.respuesta) : salida.respuesta;

  // El orden va de lo más concreto a lo más general. La respuesta que
  // escribió el modelo queda última porque él no vio el resultado de la
  // búsqueda: no sabe en qué capacidades quedó el equipo ni si hubo algo.
  let respuestaCliente = respuestaFinal;

  if (preguntoPorPagos) {
    respuestaCliente = PAGOS_CASHEA;
  } else if (soloAsesor) {
    respuestaCliente = SOLO_ASESOR;
  } else if (otrasCapacidades.length && pedidas.length) {
    // Pidió unos gigas que no hay, pero el modelo está en otros.
    respuestaCliente = alAzar(SIN_ESA_CAPACIDAD)
      .replace("{pedida}", comoSeDicen(pedidas))
      .replace("{otras}", comoSeDicen(otrasCapacidades));
  } else if (quiereSaberCapacidades && otrasCapacidades.length) {
    respuestaCliente = alAzar(CAPACIDADES_QUE_HAY).replace(
      "{otras}",
      comoSeDicen(otrasCapacidades)
    );
  } else if (capacidadNoAplica) {
    respuestaCliente = alAzar(NO_LLEVA_CAPACIDAD);
  } else if (capacidadSinDato) {
    // Los equipos se le muestran igual: lo único que no sabemos es la
    // capacidad, no el producto.
    respuestaCliente = alAzar(SIN_DATO_DE_CAPACIDAD);
  } else if (leMuestroLoQuePidio && (AFIRMA_QUE_NO_HAY.test(respuestaFinal) || porCategoria)) {
    // DIJO QUE NO HAY ALGO QUE SÍ ESTÁ EN EL CARRUSEL QUE VA DEBAJO.
    //
    // Y el rescate por categoría cuenta como lo mismo (25-sep-2026): que
    // la búsqueda exacta fallara no significa que no lo tengamos.
    // "¿Tienes el Samsung A57 sellado?" no encuentra nada —"sellado" no
    // está en ningún título—, lo rescata la palabra "samsung", y el A57
    // sale como primera ficha. Contestar ahí "justo ese no lo manejo" es
    // decirle que no a un cliente que lo está viendo en la pantalla: es
    // el fallo que ya costó una venta en producción.
    respuestaCliente = alAzar(SI_LO_TENGO);
  } else if (porCategoria) {
    // Lo que escribió el modelo no vale aquí: él creía que no había nada
    // que enseñar, o peor, iba a recitar la lista. Hay fotos que mandar.
    respuestaCliente = alAzar(NO_ESE_PERO_MIRA);
  } else if (buscoSinExito) {
    respuestaCliente = fraseSinResultados(env, tipoPedido);
  }

  return {
    productos,
    respuestaCliente,
    // La tabla de pagos va en DOS mensajes, uno por plataforma. Este es el
    // segundo; va vacío en cualquier otro caso.
    segundoMensaje: preguntoPorPagos ? PAGOS_KRECE : "",
    termino,
    // Una capacidad que el catálogo no trae es un dato que solo sabe una
    // persona, igual que la garantía: va al asesor.
    esConsultaDeAsesor: esConsultaDeAsesor || capacidadSinDato,
    buscoSinExito,
    hayMas,
    // Con qué palabra se rescató la búsqueda, si hubo que rescatarla.
    porCategoria,
  };
}

// Decide qué precio va en la ficha, según lo que haya preguntado el cliente.
//
//   · Preguntó por Cashea → precio en divisas y precio Cashea, los dos
//     juntos (así ve la diferencia sin tener que preguntar dos veces).
//   · Preguntó el precio "en divisas" / "dólares" → SOLO ese precio.
//   · Ninguna de las dos → precio Cashea solo, que es el que se muestra
//     primero por defecto. Si el producto no tiene precio Cashea cargado en
//     la hoja, se usa el de divisas para no dejar la ficha sin precio.
// La etiqueta que va PEGADA al monto cuando el cliente pidió divisas.
// Sin ella son dos cifras sueltas —la de la hoja y la de Cashea— y el
// cliente no sabe cuál acaba de pedir.
const ETIQUETA_DIVISA = "Precio DIVISA";

function precioParaMostrar(producto, conCashea, conDivisas) {
  if (conDivisas) {
    return producto.precio ? `${producto.precio} · ${ETIQUETA_DIVISA}` : "Precio: consúltalo";
  }

  // Los DOS precios juntos: aquí sí van con su nombre. Sin etiqueta
  // serían dos cifras seguidas y el cliente no sabría cuál es cuál —
  // justo cuando preguntó para comparar.
  if (conCashea && producto.precioCashea) {
    return `${producto.precio || "Precio: consúltalo"} en divisas · ${producto.precioCashea} con Cashea`;
  }

  // El precio de siempre, solo. Sin el "Con Cashea:" delante: es el que
  // se muestra por defecto, así que decirlo en cada ficha no aporta y le
  // roba espacio al título, que es lo que el cliente está leyendo.
  if (producto.precioCashea) return producto.precioCashea;

  return producto.precio || "";
}

// El texto que va bajo el título de la ficha: la capacidad delante del
// precio, cuando la hoja la trae.
//
// Así el cliente la ve SIN tener que preguntar — que es mejor que
// contestarla bien: la pregunta que no hace falta hacer es la que no se
// responde mal.
function subtituloDeFicha(producto, conCashea, conDivisas) {
  const precio = precioParaMostrar(producto, conCashea, conDivisas);
  const capacidad = capacidadDe(producto);

  if (!capacidad) return precio;
  return precio ? `${capacidad} · ${precio}` : capacidad;
}

// Se avisa en dos situaciones, y solo en esas dos.
//
//   · Preguntó algo que solo sabe una persona (garantía, financiamiento,
//     COLORES…). Suele ser la última pregunta antes de comprar, así que va
//     al asesor aunque el bot le esté mostrando producto en ese mensaje.
//
//   · Va a cerrar la compra. Lo dice la respuesta de ESTE mensaje: las
//     frases de cierre del prompt llevan "en un momento". No mires el
//     historial para esto: arrastra la marca de escalada para siempre y
//     acabarías avisando en todos los mensajes.
//
// No se avisa mientras el bot esté mostrando producto: la venta sigue viva.
function hayEscalada({ respuesta, productos, esConsultaDeAsesor, buscoSinExito }) {
  if (esConsultaDeAsesor) return true;
  if (buscoSinExito || productos.length) return false;
  return respuesta.toLowerCase().includes("en un momento");
}

// Primera línea de la notificación: le dice al asesor qué tiene que
// contestar antes de abrir la conversación.
function motivo({ esConsultaDeAsesor }) {
  return esConsultaDeAsesor ? "PREGUNTA PARA EL ASESOR" : "QUIERE CERRAR LA COMPRA";
}

// Una celda de CSV: si trae comas, comillas o saltos de línea, va entre
// comillas y las comillas de dentro se duplican. Sin esto, un nombre como
// "Ana, la de Valencia" parte la fila en dos columnas.
function paraCsv(valor) {
  const texto = String(valor ?? "");
  if (!/[",\n]/.test(texto)) return texto;
  return `"${texto.replace(/"/g, '""')}"`;
}
