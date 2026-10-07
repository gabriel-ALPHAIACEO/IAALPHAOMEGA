// Cerebro del bot de ventas de EPICCELL por Instagram.
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

import { responderTexto, identificarEnImagen, redactarConResultados } from "./ia.js";
import { transcribirAudio, notaDeVoz, PEDIR_QUE_ESCRIBA } from "./voz.js";
import { estadoDeLaClaveApi, esTextoDelBot, pausadoAhora, atenderPanel, anotarTurno, anotarMensaje, atenderApiCentral, estadoCompletoPermitido, estadoPublico, pedidoInterno } from "./panel.js";
import { vigilarErrores, guardarErrores, vigilarQueja } from "./registro.js";
import { elLocal, hayLocal, preguntaPorElLocal, soloPreguntaPorElLocal, NOTA_LOCAL_ENVIADA, BOTON_MAPA } from "./local.js";
import { revisarTurno, revisorActivo, topeDelRevisor, gastoDelRevisor, modeloDelRevisor } from "./revisor.js";
import { anotarGasto } from "./gasto.js";

// Lo que el bot escribe como error queda guardado para el panel central
// (ver registro.js), además de salir en el registro como siempre.
vigilarErrores();
import { revisarTono } from "./tono.js";
import { revisarPrecio, contestaElPrecio } from "./precio.js";
import { contestarCuotas, equipoDeLaCuenta } from "./cuotas.js";
import { todasLasEspecificaciones, fichasDeLaCharla, notaTecnica, botonDeLaPagina } from "./especificaciones.js";
import { revisarDisponibilidad, marcasNombradas, marcasQueHay, fraseDeMarcaQueNoHay } from "./disponible.js";
import { referenciaEnTexto } from "./referencias.js";
import {
  detallesDelAnuncio,
  revisarTokenDeAnuncios,
  anunciosActivos,
  equipoAsignado,
  equiposAsignados,
  anotarLlegada,
  llegadasPorAnuncio,
} from "./anuncio.js";
import { queDatoPide, respuestaDeDato } from "./datos.js";
import {
  parentesco,
  mismasVariantes,
  partesDelTitulo,
  nombraUnModelo,
  loQuePidioDicho,
  raizDeLaFamilia,
  modeloNombrado,
  palabrasDe,
} from "./modelo.js";
// "comoSeLlama" ya existe aquí para el nombre del CLIENTE (estado.js), así
// que el de los tipos entra con su propio nombre.
import {
  tipoQuePide,
  tipoDelProducto,
  usoQuePide,
  sirveParaElUso,
  esDeOtroNegocio,
  comoSeLlama as nombreDelTipo,
} from "./tipos.js";
import {
  buscarProductos,
  catalogoCompleto,
  diagnosticoHoja,
  listaDeTitulos,
  catalogoParaInventario,
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
  conLoDicho,
  VENTANA_ECO_SIN_TEXTO_MS,
  asegurarColumnas,
  guardarPerfil,
  comoSeLlama,
  revisarBase,
  listarContactos,
  yaLoVio,
  conProductosMostrados,
} from "./estado.js";
import {
  firmaValida,
  leerMensaje,
  enviarTexto,
  enviarLocal,
  enviarFichas,
  enviarBotonCatalogo,
  enviarConBoton,
  enviarConOpciones,
  hayCatalogo,
  quienSoy,
  responderComentario,
  privadoPorComentario,
  obtenerPerfil,
  revisarFotos,
} from "./instagram.js";

// Se sube a mano en cada entrega y sale en /estado: los archivos se copian
// a mano, así que "ya lo pegué" y "ya está desplegado" no son lo mismo.
const VERSION = "2026-10-07 (53) · 📲 el panel se instala como programa (Windows, Android, iPhone) · 📦 Inventario y 🧾 Caja en el panel: stock por sede y talla, códigos de barras automáticos, etiquetas, importar del catálogo o del Excel viejo";

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
  /\b((?:nivel|level|lvl|niv|nv)\s*[1-6]|azul|plata|oro|platino|soy\s+\w+)\b/i;

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
// catálogo los ves todos 👇"— y manda a una tienda que EPICCELL no tiene.
// No se sustituye por otra frase: se quita. Un tercer mensaje detrás de
// las fotos es una notificación más para no decir nada.
//
// Cuando haya catálogo de verdad (URL_CATALOGO puesto), vuelve solo con su
// botón, sin tocar el código.

// Lo que sí se queda, porque no habla de ninguna tienda: cuando no se
// encuentra el modelo, la respuesta sigue siendo el asesor.
// Lo que se dice en su lugar cuando NO hay nada que enseñarle.
const HOY_NO_DISPONIBLE = [
  "Ahora mismo no lo tengo disponible 😊 Un asesor te confirma si podemos conseguírtelo. ¿Te muestro lo que tengo mientras?",
  "Justo ese no lo tengo disponible hoy 😅 Déjame confirmarte con un asesor si se puede conseguir. ¿Te enseño otras opciones?",
  "Por ahora no me queda disponible 😊 Un asesor te dice si entra pronto. ¿Quieres ver lo que tengo?",
];

// SE BUSCÓ Y NO HAY. Es el momento más delicado de la conversación: el
// cliente preguntó por algo concreto y no está.
//
// Lo que NO se dice: que no lo vendemos. Eso es cerrar la puerta con un
// dato que el bot no tiene (ver sinCerrarLaPuerta). Lo que sí: que hoy no
// está disponible, que un asesor confirma si se consigue, y una pregunta
// para que la conversación siga.
const SIN_RESULTADOS_SIN_CATALOGO = HOY_NO_DISPONIBLE;

// Y CUANDO LO QUE NO HAY ES UN TIPO ENTERO, SE DICE ASÍ.
//
// "Forros ahora mismo no tengo" es una respuesta; "déjame confirmarte ese
// modelo con un asesor" no lo es, porque no se trataba de ningún modelo.
//
// SE HABLA DE DISPONIBILIDAD, NUNCA DE LO QUE LA TIENDA VENDE (28-sep-2026,
// el dueño). EPICCELL es una tienda de tecnología: lo que hoy no está puede
// conseguirse, entrar la semana que viene o estar en el otro local. Un "no
// manejamos eso" le cierra la puerta al cliente con un dato que el bot no
// tiene, y encima suele ser mentira. "Hoy no lo tengo disponible" es la
// verdad, y deja la venta viva.
const NO_HAY_DE_ESE_TIPO = [
  "De {tipo} ahora mismo no tengo disponibles 😊 Un asesor te confirma si podemos conseguirlo. ¿Te ayudo con algo más?",
  "{tipo} no tengo disponibles por ahora 😅 Si quieres, un asesor te confirma si entra pronto",
  "Ahorita no me quedan {tipo} 😊 Un asesor te dice si podemos conseguírtelo. ¿Buscas algo más?",
];

function fraseSinResultados(env, tipo = "") {
  if (tipo && tipo !== "telefono") {
    const frase = alAzar(NO_HAY_DE_ESE_TIPO);
    const nombre = nombreDelTipo(tipo);
    // Si la frase empieza por el tipo, va en mayúscula: "forros no tengo"
    // escrito así, en minúscula, se lee como si faltara algo delante.
    return frase.replace(
      "{tipo}",
      frase.startsWith("{tipo}") ? nombre[0].toUpperCase() + nombre.slice(1) : nombre
    );
  }
  return hayCatalogo(env) ? SIN_RESULTADOS : alAzar(SIN_RESULTADOS_SIN_CATALOGO);
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
  /\b(garant[ií]a|permuta|parte de pago|factura|repara\w*|liberad[oa]|liberaci[óo]n|seguro|(?:salud|condici[oó]n|estado|desgaste)\s+de\s+(?:la\s+)?bater[ií]a|ciclos)\b/i;

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
// PIDE UN TELÉFONO DE UNA MARCA DE LA QUE SOLO HAY ACCESORIOS.
//
// EL CASO REAL (28-sep-2026, al revisar el inventario). En la hoja hay
// nueve productos Apple —cargadores certificados, cables y AirPods— y
// ningún teléfono DISPONIBLE HOY. Como esos títulos llevan la palabra
// "iphone" dentro ("Apple cargador iphone 20w"), a quien preguntara
// "¿tienen iPhone?" la búsqueda le devolvía tres cargadores, y el bot se
// los enseñaba como si fueran el teléfono.
//
// Se habla de lo que hay HOY, nunca de lo que la tienda vende: es una
// tienda de tecnología y consigue lo que le pidan (ver NO_HAY_DE_ESE_TIPO).
const SOLO_ACCESORIOS_DE_ESO = [
  "De esa marca ahora tengo accesorios 😊 Teléfonos no me quedan disponibles, pero mira esto 👇",
  "Ahorita de esa marca tengo estos accesorios 😊 Teléfonos no tengo disponibles por ahora 👇",
  "De teléfonos de esa marca no me queda disponible ahora 😅 Accesorios sí, míralos 👇",
];

// NO TENGO ESE, PERO TENGO ESTE — Y SE DICEN LOS DOS NOMBRES.
//
// Pedido del dueño (29-sep-2026): "cuando no tenemos disponible que
// mencione que no tenemos ese pero tenemos este que es parecido, con
// coherencia".
//
// Decir "ese no lo tengo, mira estos" obliga al cliente a comparar solo,
// deslizando fichas. Nombrar las DOS cosas —lo que pidió y lo que se le
// ofrece en su lugar— es lo que hace un vendedor: "el Note 20 no lo tengo
// disponible, pero tengo el Note 17, que va por la misma línea".
//
// {pedido} es lo que él nombró; {alternativa}, la primera ficha que va
// debajo. Si por lo que sea no se sabe alguna de las dos, se usan las
// frases de siempre, que no nombran ninguna.
// DE LA MISMA FAMILIA, O SOLO PARECIDOS: NO ES LO MISMO.
//
// Pedido del dueño (29-sep-2026): "que hable como vendedor, que no tiene
// disponible pero te muestro estos que son de la misma familia, o estos
// que se parecen, que sea coherente".
//
// Y la diferencia es real, no de palabras. Si pidió un Redmi Note 20 y se
// le enseña un Note 17, eso ES su familia: mismo nombre, misma línea, el
// cliente lo reconoce y la venta sigue viva. Si pidió un Poco F7 y se le
// enseñan otros Poco, no son su familia: son de la misma marca y se le
// parecen. Decir "familia" en ese segundo caso suena a vendedor que no
// sabe lo que vende.
//
// Cuál de las dos se usa lo decide con qué se rescató la búsqueda: con dos
// palabras o más ("redmi note") es la familia; con una ("poco"), la marca.
// Sin artículo delante de lo que pidió (30-sep-2026): {pedido} puede ser
// un teléfono ("Poco Z99 Ultra") o unos cables ("Cables Dophin"), y "El
// Cables Dophin no lo tengo" se lee mal. "No tengo Cables Dophin" y "no
// tengo Poco Z99 Ultra" se leen bien los dos.
const DE_LA_MISMA_FAMILIA = [
  "Ahora mismo no tengo {pedido} 😅 Pero de esa misma familia tengo el {alternativa} — te lo muestro 👇",
  "En este momento no tengo {pedido} 😊 De la misma familia me queda el {alternativa}, que es lo más cercano. Míralo 👇",
  "Justo ese no me queda 😅 Pero el {alternativa} es de la misma familia que el {pedido}, y ese sí lo tengo 👇",
];

const SE_LE_PARECEN = [
  "Ahora mismo no tengo {pedido} 😅 Pero mira estos {marca}, que se le parecen mucho 👇",
  "En este momento no tengo {pedido} 😊 Lo más parecido son estos {marca}, empezando por el {alternativa} 👇",
  "De momento no tengo {pedido} 😅 Te muestro los {marca} que sí tengo, que van por la misma línea 👇",
];

const NO_ESE_PERO_MIRA = [
  "Ese exacto no lo tengo ahora 😊 Pero mira estos, que te pueden servir 👇",
  "De ese no me queda 😅 Te muestro los que sí tengo 👇",
  "Justo ese no lo tengo disponible 😊 Pero estos van por la misma línea, míralos 👇",
];

// Lo que el cliente pidió, escrito como para leerlo en un mensaje: sin la
// palabra que rescató la búsqueda repetida y con la primera en mayúscula.
function comoLoPidio(termino) {
  const limpio = String(termino || "").trim();
  if (!limpio || limpio.length > 40) return "";
  return limpio[0].toUpperCase() + limpio.slice(1);
}

// Cuántas palabras del término pedido aparecen en el título. Es la misma
// idea que mejorDelCatalogo, pero aquí solo hace falta ordenar.
function ordenarPorParecido(productos, termino) {
  const pedidas = palabrasDeTitulo(termino);
  if (!pedidas.length) return productos;

  const puntos = (producto) => {
    const suyas = new Set(palabrasDeTitulo(producto.titulo));
    return pedidas.filter((palabra) => suyas.has(palabra)).length;
  };

  // Estable: a igualdad de parecido se queda el orden de la hoja, que es
  // el que eligió el dueño.
  return productos
    .map((producto, donde) => ({ producto, donde, punto: puntos(producto) }))
    .sort((a, b) => b.punto - a.punto || a.donde - b.donde)
    .map(({ producto }) => producto);
}

// "redmi 7 pro" y "Redmi A7 pro 5G": las mismas palabras, y el número con
// una letra delante. Nada más que eso (un 15 no es un 17).
function casiElMismo(pedido, titulo) {
  const partes = (t) => despejar(t).split(/\s+/).filter((w) => w && w !== "5g" && w !== "4g");
  const a = partes(pedido);
  const b = partes(titulo);
  if (a.length < 2 || !a.some((w) => /^\d+$/.test(w))) return false;
  let conLetra = false;
  for (const w of a) {
    if (b.includes(w)) continue;
    if (/^\d+$/.test(w) && b.some((x) => new RegExp(`^[a-z]${w}$`).test(x))) {
      conLetra = true;
      continue;
    }
    return false;
  }
  return conLetra && b.length <= a.length + 1;
}

function noEsePeroMira(termino, productos, porCategoria = "") {
  const pedido = comoLoPidio(termino);
  const alternativa = productos[0]?.titulo || "";

  // Si lo que pidió y lo que se le ofrece son lo mismo, nombrarlos los dos
  // suena a broma ("el A57 no lo tengo, pero tengo el A57").
  const distintos =
    pedido &&
    alternativa &&
    !despejar(alternativa).includes(despejar(pedido)) &&
    !despejar(pedido).includes(despejar(alternativa));

  if (!distintos) return alAzar(NO_ESE_PERO_MIRA);

  // CASI EL MISMO NOMBRE (6-oct-2026): pidió "Redmi 7 pro" y el primero es
  // el "Redmi A7 pro". Decirle "no tengo el Redmi 7 Pro" con el A7 Pro
  // delante es negarle lo que seguramente buscaba: se le pregunta si es ese.
  if (casiElMismo(pedido, alternativa)) {
    return `¿Te refieres al ${alternativa}? 😊 Te lo muestro 👇 y también otros que se le parecen`;
  }

  const esFamilia = String(porCategoria || "").trim().split(/\s+/).filter(Boolean).length >= 2;

  if (esFamilia) {
    return alAzar(DE_LA_MISMA_FAMILIA)
      .replaceAll("{pedido}", pedido)
      .replaceAll("{alternativa}", alternativa);
  }

  // La marca, escrita como la lee un cliente: "poco" → "Poco".
  const marca = comoLoPidio(porCategoria) || "equipos";

  return alAzar(SE_LE_PARECEN)
    .replaceAll("{pedido}", pedido)
    .replaceAll("{alternativa}", alternativa)
    .replaceAll("{marca}", marca);
}

const mayuscula = (t) => String(t || "").charAt(0).toUpperCase() + String(t || "").slice(1);

// Lo que sobra en "¿y los redmi?", "y de samsung?", "¿hay de xiaomi?".
const RELLENO_DEL_SEGUIMIENTO = new Set([
  "y", "e", "los", "las", "el", "la", "lo", "de", "del", "que", "hay", "tienes", "tienen",
  "tiene", "algun", "alguno", "alguna", "algunos", "algunas", "marca", "otro", "otros",
  "otra", "otras", "también", "tambien", "mas", "más", "unos", "unas", "un", "una", "y?",
]);

// Los usos que se escriben en un título ("para carro", "para moto").
const USOS_CON_NOMBRE = ["carro", "moto"];

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

// LO QUE NO ES DE ESTA TIENDA, DICHO COMO SE DICE (29-sep-2026).
//
// Pedido del dueño: "si no vendemos algo, que sea lógico".
//
// A quien pregunta por una nevera no se le puede contestar "ahora mismo no
// la tengo disponible, un asesor te confirma si podemos conseguirla": no
// se agotó, es que no es lo que se vende, y ese cliente se queda esperando
// una llamada que no va a llegar. Se le dice lo que es, con buena cara, y
// se le ofrece lo que sí hay.
//
// OJO: esto solo entra cuando la búsqueda no encontró NADA. Si pidió un
// "ventilador" y la tienda tiene un Fan Cooler, manda el Fan Cooler.
const ES_DE_OTRO_NEGOCIO = [
  "{eso} no manejamos 😊 Nosotros somos tienda de tecnología: teléfonos, accesorios y todo lo que va con ellos. ¿Te ayudo con algún equipo?",
  "Uy, {eso} no es lo nuestro 😅 Aquí vendemos teléfonos y accesorios. ¿Buscas algún equipo?",
  "{eso} no vendemos 😊 Lo nuestro son los teléfonos, los accesorios, relojes, audífonos… ¿Te muestro algo de eso?",
];

// LLEGA DESDE UN ANUNCIO Y NO SE SUPO DE QUÉ EQUIPO ERA.
//
// Pasa cuando el anuncio no trae título ni foto en el aviso de Meta. No se
// le puede enseñar un equipo —no sabemos cuál— pero tampoco se le puede
// dejar sin contestar: la tienda pagó por ese clic. Se le saluda y se le
// pregunta, que es lo que haría cualquiera en el mostrador.
const BIENVENIDA_DESDE_ANUNCIO = [
  "¡Hola! 😊 Soy la asistente de EPICCELL. Vi que vienes de nuestra publicidad. ¿Qué equipo estás buscando?",
  "¡Hola! 👋 Bienvenido a EPICCELL. ¿Qué equipo viste en la publicidad? Dime el modelo y te paso el precio",
  "¡Hola! 😊 Gracias por escribirnos. ¿Qué estás buscando? Dime el equipo y te muestro lo que tengo",
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

// EL "BOTÓN" PARA DEVOLVERLE LA CONVERSACIÓN AL BOT.
//
// Instagram no deja poner botones flotantes en la app del asesor: lo único
// que se puede es reconocer algo que él escriba. Así que hay dos caminos,
// y los dos valen siempre:
//
//   · La frase de FRASE_DESPAUSAR, que el cliente lee como una despedida
//     normal ("te dejo con la asistente"). Lo cómodo es guardarla como
//     RESPUESTA GUARDADA de Instagram: sale como un botón encima del
//     teclado y se manda con un toque. Ese es el botón.
//   · Un código corto, #bot, para cuando hay prisa. El cliente no lo
//     entiende, pero tampoco molesta.
//
// FRASE_DESPAUSAR admite VARIAS separadas por "|", por si cada asesor se
// despide a su manera.
const CODIGO_DESPAUSAR = "#bot";

function frasesDespausar(env) {
  return fraseDespausar(env)
    .split("|")
    .map((frase) => sinSignos(frase))
    .filter(Boolean);
}

function esFraseDeDespausar(env, texto) {
  const dicho = sinSignos(texto);
  if (!dicho) return false;

  if (dicho.includes(sinSignos(CODIGO_DESPAUSAR))) return true;

  return frasesDespausar(env).some((frase) => dicho.includes(frase));
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

// LOS 30 SEGUNDOS DE CLOUDFLARE (30-sep-2026).
//
// El dueño: "los mensajes a veces tardan en verse, o dice que aquí está
// pero no muestra la imagen". Una causa, y la más traicionera:
// Cloudflare le da a cada mensaje 30 segundos EN TOTAL desde que llega, y
// al cumplirse corta el trabajo sin avisar, esté donde esté. Un turno con
// foto o publicación —esperar la pregunta (5 s), mirar la imagen con
// gpt-4o, pensar la respuesta, mandar texto y fichas— podía pasarse. Y si
// se pasaba entre el texto y las fichas, el cliente leía "aquí lo tienes
// 👇" y nada más. Ni siquiera salía el aviso de error: el corte es desde
// fuera.
//
// Ahora cada llamada a OpenAI recibe SOLO el tiempo que queda, menos lo
// que hace falta para enviar. Si no le alcanza, falla a tiempo y el
// cliente recibe el aviso de siempre (y el asesor también), en vez de
// silencio.
const LIMITE_DEL_TURNO_MS = 30000;
// Lo que se guarda al final para mandar el texto y las fichas.
// 12 s y no 8 (6-oct-2026): Instagram tarda en aceptar un carrusel lo que
// tarda en bajar sus fotos, y con 8 s la segunda pasada de la IA se comía
// el tiempo y el turno se cortaba entre el texto y las fichas.
const PARA_ENVIAR_MS = 12000;

// Cuánto se le puede dar a una llamada a OpenAI ahora mismo. "despues" es
// lo que aún tiene que venir detrás (la IA de texto, detrás de la de
// visión). Nunca menos de 3 s: con menos no contesta nadie, y es mejor
// intentarlo que rendirse sin probar.
const REDACCION_MAXIMO_MS = 7000;

function tiempoParaLaIa(rastro, despues = 0) {
  const usado = Date.now() - (rastro?.llegoEn || Date.now());
  const queda = LIMITE_DEL_TURNO_MS - usado - PARA_ENVIAR_MS - despues;
  return Math.max(3000, Math.min(15000, queda));
}

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


const trabajador = {
  async fetch(request, env, ctx) {
    // Desde aquí corren los 30 segundos que Cloudflare le da a este mensaje
    // (ver LIMITE_DEL_TURNO_MS).
    const llegoEn = Date.now();
    const url = new URL(request.url);

    // EL PANEL DE LA TIENDA (2-oct-2026, ver panel.js): las conversaciones,
    // lo que pensó la IA en cada respuesta, los anuncios y el estado. Con
    // clave (PANEL_CLAVE).
    // LA PUERTA DEL PANEL CENTRAL (2-oct-2026, ver panel.js): los datos de
    // esta tienda para el Worker del dueño que junta todas. Con clave
    // (PANEL_API_CLAVE).
    if (url.pathname.startsWith("/api/central")) {
      return atenderApiCentral(request, env, {
        tienda: String(env.TIENDA_NOMBRE || "EPICCELL"),
        version: VERSION,
        horasDePausa: Number(env.PAUSA_HORAS) || PAUSA_HORAS_POR_DEFECTO,
        conAnuncios: true,
        verTexto: async (ruta) => (await trabajador.fetch(pedidoInterno(ruta, url, env), env, ctx)).text(),
      });
    }

    if (url.pathname === "/panel" || url.pathname.startsWith("/panel/")) {
      return atenderPanel(request, env, {
        tienda: String(env.TIENDA_NOMBRE || "EPICCELL"),
        horasDePausa: Number(env.PAUSA_HORAS) || PAUSA_HORAS_POR_DEFECTO,
        verTexto: async (ruta) => (await trabajador.fetch(pedidoInterno(ruta, url, env), env, ctx)).text(),
        traerCatalogo: () => catalogoParaInventario(env),
        nombreDelCatalogo: "la hoja de Google (todo: precios en divisas, Bs y Cashea, fotos, capacidad, las demás columnas y la cantidad)",
      });
    }

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
      for (const uno of porAtender) ctx.waitUntil(atenderConRed(env, uno, llegoEn));
      return new Response("ok", { status: 200 });
    }

    // Todo lo que hace falta saber para arreglar un despliegue: qué versión
    // está puesta, qué secretos faltan y si la base responde.
    if (url.pathname === "/estado") {
      // Confidencial (ver panel.js): sin la clave, solo "vivo" y la versión.
      if (!estadoCompletoPermitido(request, env)) return estadoPublico(VERSION);
      const secreto = (nombre) => {
        const valor = env[nombre];
        return valor ? `cargado (${String(valor).length} caracteres)` : "FALTA";
      };

      const delRevisor = await gastoDelRevisor(env.DB);
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
          `  ADS_TOKEN           ${secreto("ADS_TOKEN")}   (leer tus anuncios — el panel completo está en /anuncios)`,
          `  PANEL_CLAVE         ${secreto("PANEL_CLAVE")}   (la clave del panel de la tienda: /panel)`,
          `  PANEL_API_CLAVE     ${estadoDeLaClaveApi(env)}   (la del panel central: la misma va en tu Worker panel-central)`,
          `  PANEL_CENTRAL_URL   ${env.PANEL_CENTRAL_URL ? "puesto (avisos en tiempo real al panel central)" : "sin poner (sin avisos en tiempo real)"}`,
          "",
          "CONFIGURACIÓN (wrangler.toml)",
          `  META_MODO           ${env.META_MODO || "todo (por defecto)"}`,
          `  REVISOR_IA          ${revisorActivo(env) ? `si, con ${modeloDelRevisor(env)} · confianza ${env.REVISOR_CONFIANZA || "alta"} · este mes $${delRevisor.toFixed(2)} de un tope de ${topeDelRevisor(env) === Infinity ? "sin tope" : `$${topeDelRevisor(env)}`}` : "no (apagado)"}   (revisa cada respuesta ya enviada: 🔴 en el panel si alucinó)`,
          `  META_VERIFY_TOKEN   ${env.META_VERIFY_TOKEN ? "puesto" : "FALTA"}`,
          `  SHEET_ID            ${env.SHEET_ID && !/PEGA_AQUI/i.test(env.SHEET_ID) ? "puesto" : "FALTA"}`,
          `  SHEET_NOMBRE        ${env.SHEET_NOMBRE || "FALTA"}`,
          `  URL_CATALOGO        ${env.URL_CATALOGO && !/CAMBIA-ESTO/i.test(env.URL_CATALOGO) ? env.URL_CATALOGO : "FALTA"}`,
          `  WHATSAPP            ${String(env.WHATSAPP || "").replace(/\D/g, "") ? "puesto" : "sin poner (no sale el botón Comprar)"}`,
          `  REDACCION_LIBRE     ${redaccionLibre(env) ? "si (la IA redacta viendo los equipos que salieron)" : "no (frases de siempre)"}`,
          `  ANUNCIOS_EQUIPOS    ${equiposAsignados(env).size ? `${equiposAsignados(env).size} anuncio(s) con equipo puesto a mano` : "ninguno (ver /anuncios)"}`,
          `  HORARIOS            ${String(env.HORARIOS || "").trim() || "sin poner (lo confirma un asesor)"}`,
          `  METODOS_PAGO        ${String(env.METODOS_PAGO || "").trim() ? `puestos (${(String(env.METODOS_PAGO).replace(/\\n/g, "\n").match(/🔹|•/g) || []).length} métodos)` : "sin poner (lo confirma un asesor)"}`,
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
    // ¿Cargan las fotos de la hoja? (6-oct-2026) Si Instagram no puede bajar
    // una foto, el carrusel no llega. Esto las prueba todas y dice cuáles
    // arreglar (en Drive: compartir como «Cualquier persona con el enlace»).
    if (url.pathname === "/probar-fotos") {
      const { sinFoto, resultados } = await revisarFotos(await catalogoCompleto(env));
      const malas = resultados.filter((r) => !r.bien);
      const lentas = resultados.filter((r) => r.bien && r.ms > 4000);
      return texto200(
        [
          `CÓDIGO DESPLEGADO: ${VERSION}`,
          "",
          `${resultados.length} fotos probadas: ${resultados.length - malas.length} cargan, ${malas.length} NO cargan, ${lentas.length} lentas (más de 4 s).`,
          "",
          malas.length ? "NO CARGAN (arréglalas en la hoja o en Drive):" : "",
          ...malas.map((r) => `  ✗ ${r.titulo} — ${r.detalle}\n    ${r.imagen}`),
          lentas.length ? "\nLENTAS (Instagram puede rendirse esperándolas):" : "",
          ...lentas.map((r) => `  ⚠ ${r.titulo} — ${Math.round(r.ms / 100) / 10} s`),
          sinFoto.length ? `\nSIN FOTO EN LA HOJA (${sinFoto.length}): ${sinFoto.join(" · ")}` : "",
        ]
          .filter((l) => l !== "")
          .join("\n")
      );
    }

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

    // EL PANEL DE ANUNCIOS (2-oct-2026): el token, las cuentas, todos los
    // anuncios activos con el equipo que manda el bot en cada uno, y
    // cuántas personas llegaron por cada uno.
    if (url.pathname === "/anuncios") {
      return texto200(await panelDeAnuncios(env));
    }

    if (url.pathname === "/probar-anuncio") {
      const id = (url.searchParams.get("id") || "").trim();

      if (!id) {
        return texto200(
          [
            "TODOS tus anuncios activos, de una vez: /anuncios",
            "",
            "Para uno solo, pasame su id asi:",
            "  /probar-anuncio?id=120212345678901234",
            "",
            "El id sale en el Administrador de anuncios, en la columna",
            '"Identificacion" del anuncio (no del conjunto ni de la campana).',
            "",
            `ADS_TOKEN     ${env.ADS_TOKEN ? "cargado" : "FALTA — sin el no se puede leer ningun anuncio"}`,
            "",
          ].join("\n")
        );
      }

      if (!env.ADS_TOKEN) {
        return texto200(
          [
            "FALTA ADS_TOKEN.",
            "",
            "Es el permiso para leer tus anuncios. Se saca una vez:",
            "  1. En Meta, Configuracion del negocio -> Usuarios del sistema.",
            "  2. Genera un token con la APP y la CUENTA PUBLICITARIA",
            "     asignadas, y el permiso ads_read.",
            "  3. npx wrangler secret put ADS_TOKEN",
            "",
            "Sin esto el bot sigue atendiendo a quien viene de un anuncio:",
            "usa el titulo y la foto que Meta manda en el aviso. Esto es para",
            "los avisos que llegan sin nada de eso.",
            "",
          ].join("\n")
        );
      }

      const leido = await detallesDelAnuncio(env, id);

      if (!leido) {
        return texto200(
          [
            `No pude leer el anuncio ${id}.`,
            "",
            "Lo que suele fallar, por orden:",
            "  · La cuenta publicitaria no esta asignada a la APP en el",
            "    portafolio comercial (Business).",
            "  · Al token le falta el permiso ads_read.",
            "  · El id no es el del ANUNCIO (es el del conjunto o la campana).",
            "",
            "El motivo exacto sale en `npx wrangler tail` al abrir esta ruta.",
            "",
          ].join("\n")
        );
      }

      const enElCatalogo = await catalogoCompleto(env);
      const aMano = equipoAsignado(env, { id });
      const { estado, titulo: equipo, dicho } = queEquipoSenala(
        aMano || `${leido.titulo} ${leido.texto}`,
        enElCatalogo
      );
      const queHara = {
        exacto:
          `EQUIPO QUE RECONOCE: ${equipo}\n` +
          "A quien llegue por este anuncio se le manda ESE equipo, solo ese.\n",
        agotado:
          `EL ANUNCIO ES DEL "${dicho}", Y HOY NO ESTA EN LA HOJA.\n` +
          `Se le dice que ese no esta ahora y se le muestra lo mas parecido (${equipo}).\n`,
        varios:
          "EL ANUNCIO NOMBRA VARIOS TELEFONOS: no se impone ninguno.\n" +
          "El bot mira la imagen y lo que escriba el cliente.\n",
      }[estado];

      return texto200(
        [
          `Anuncio       ${id}`,
          `Titulo        ${leido.titulo || "(sin titulo)"}`,
          `Texto         ${(leido.texto || "(sin texto)").slice(0, 200)}`,
          `Imagen        ${leido.imagen || "(sin imagen)"}`,
          `Publicacion   ${leido.publicacion || "(no viene del feed)"}`,
          "",
          queHara ||
            "NO RECONOCE NINGUN EQUIPO en el texto del anuncio.\n" +
              "Si el anuncio es de un modelo concreto, ponle el nombre tal como\n" +
              "esta en la hoja (en el titulo o en el texto) y el bot lo pillara.\n" +
              "Mientras, saluda y pregunta, que es lo correcto.\n",
        ].join("\n")
      );
    }

    return texto200(`bot activo · ${VERSION}\n`);
  },
};

export default trabajador;

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
async function atenderConRed(env, mensaje, llegoEn = Date.now()) {
  const rastro = { respondio: false, llegoEn };

  try {
    if (mensaje.tipo === "comentario") {
      await atenderComentario(env, mensaje, rastro);
    } else {
      await atenderMeta(env, mensaje, rastro);
    }

    // ¿Contestó bien? Con todo ya enviado: el cliente no espera esto. Solo
    // si queda tiempo de los 30 s (ver revisor.js).
    if (rastro.turno?.id && Date.now() - llegoEn < LIMITE_DEL_TURNO_MS - 10000) {
      await revisarTurno(env, rastro.turno);
    }
    await guardarErrores(env.DB, env);

    // CUÁNTO TARDÓ. Un turno que se acerca a los 30 s es uno que otro día,
    // con OpenAI un poco más lento, se corta a medias. Con esta línea se ve
    // antes de que pase.
    if (mensaje.tipo !== "eco") {
      const segundos = (Date.now() - llegoEn) / 1000;
      const cerca = segundos * 1000 > LIMITE_DEL_TURNO_MS * 0.7;
      (cerca ? console.error : console.log)(
        `Turno de ${mensaje.igsid} terminado en ${segundos.toFixed(1)}s` +
          (cerca ? ` — CERCA DEL LÍMITE DE ${LIMITE_DEL_TURNO_MS / 1000}s de Cloudflare` : "")
      );
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

    // ❌ en el panel: el turno que se cayó. DESPUÉS de escribirle al cliente:
    // avisar al panel central puede tardar (hasta 4 s si está caído) y el
    // cliente no tiene por qué esperar eso.
    if (mensaje.tipo !== "eco" && mensaje.tipo !== "comentario") {
      await anotarTurno(
        env.DB,
        { igsid: mensaje.igsid, cliente: mensaje.texto || "", respuesta: rastro.respondio ? "(se le respondió, pero algo falló después)" : "(EL BOT NO PUDO RESPONDER)", marca: "error", motivo: String(error?.message || error).slice(0, 200) },
        env
      ).catch(() => {});
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
    await guardarErrores(env.DB, env);
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

// El número pelado de la hoja, con su símbolo. Ver precioParaMostrar.
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
        esperaMs: tiempoParaLaIa(rastro),
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

      // El comentario y lo que se le contestó son el PRINCIPIO de esta
      // conversación: si no se anotan, el bot llega al segundo mensaje sin
      // saber por qué está hablando con esta persona.
      let conversacion = conLoDicho(
        contacto.conversacion,
        "cliente",
        `(comentó en una publicación) ${comentario.texto}`
      );
      conversacion = conLoDicho(conversacion, "bot", mensajePrivado);

      await marcarEnvio(env.DB, igsid, mids, enviadoEn, [mensajePrivado], conversacion);

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
          await marcarEnvio(env.DB, igsid, mids, enviadoEn, [mensajePrivado], conversacion);
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
          conversacion,
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
          conversacion,
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
  // Lo que se dijeron, en orden. Se rellena con lo que ya había en cuanto
  // se carga el contacto, más abajo.
  let conversacion = [];

  // TODO LO QUE SALE PASA POR AQUÍ, así que este es el sitio donde anotar
  // lo que el bot dice: da igual por qué camino se haya respondido —la
  // lista de una marca, el precio en divisas, un comentario— queda escrito
  // igual. Lo mismo que se hace con los mids y con los textos.
  // "adjuntos": las fichas que se mandaron, para verlas en el panel como
  // carrusel (ver alpha.js). No entran en la memoria de la conversación.
  const mandar = async (hacer, texto = "", adjuntos = null) => {
    // CALLADO SI EL ASESOR ENTRÓ (5-oct-2026). El turno empezó sin pausa;
    // si mientras la IA pensaba un asesor escribió (y el bot quedó
    // pausado), no se manda nada más: ni el texto, ni las fichas, ni nada.
    if (await pausadoAhora(env.DB, mensaje.igsid)) {
      if (!rastro.calladoPorAsesor) console.log(`El asesor tomó la conversación con ${mensaje.igsid} a mitad del turno: no mando nada más`);
      rastro.calladoPorAsesor = true;
      return "";
    }
    const mid = await hacer();
    if (!mid) return "";

    rastro.respondio = true;
    mids = agregarMid(mids, mid);
    if (texto) {
      textos = [...textos, texto];
      conversacion = conLoDicho(conversacion, "bot", texto);
    }
    enviadoEn = Date.now();
    await marcarEnvio(env.DB, mensaje.igsid, mids, enviadoEn, textos, conversacion);
    if (texto || adjuntos) await anotarMensaje(env.DB, mensaje.igsid, "bot", texto, adjuntos);
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
      await anotarMensaje(env.DB, mensaje.igsid, "asesor", mensaje.texto);
      console.log(`El asesor le devolvió ${mensaje.igsid} al bot: vuelvo a atender`);
      return;
    }

    // EL RELOJ NO DECIDE CUANDO HAY TEXTO (29-sep-2026).
    //
    // EL FALLO QUE ESTO ARREGLA, dicho por el dueño: "cuando el asesor está
    // hablando con el cliente la IA se interpone y responde".
    //
    // Aquí había una red de 90 segundos: si el bot había enviado algo hace
    // menos de eso, CUALQUIER eco se contaba como suyo y no se pausaba. Y
    // el asesor que se mete en una conversación viva contesta justo ahí,
    // en los segundos siguientes a un mensaje del bot. Su mensaje se
    // tomaba por nuestro, la pausa no entraba, y el bot seguía
    // respondiendo por encima de él.
    //
    // Ya no hace falta adivinar con el reloj: los textos que manda el bot
    // quedan guardados (ultimos_textos) y se comparan arriba, con
    // esEcoPorTexto. Si el eco trae letras y no son las nuestras, es una
    // persona — por muy seguido que haya escrito.
    //
    // El reloj se queda solo para los ecos SIN texto, que es donde no hay
    // nada que comparar (el carrusel de fichas vuelve sin una letra).

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
      // Igual que arriba: con texto manda la comparación de texto, no el
      // reloj. Si no, el asesor que contesta rápido nunca pausa el bot.
      (!mensaje.texto && envioReciente(alSegundoVistazo, Date.now(), VENTANA_ECO_SIN_TEXTO_MS))
    ) {
      console.log(
        `Eco de ${mensaje.igsid}: al segundo vistazo era del propio bot, no pauso.`
      );
      return;
    }

    const horas = Number(env.PAUSA_HORAS) || PAUSA_HORAS_POR_DEFECTO;
    await pausar(env.DB, mensaje.igsid, horas);
    // Lo que escribió el asesor también sale en los paneles.
    await anotarMensaje(env.DB, mensaje.igsid, "asesor", mensaje.texto || "(mandó algo que no es texto)");

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

  // LA LÍNEA DEL CLIENTE SE ANOTA ANTES DE CONTESTAR, no después: así, si
  // el turno se cae a mitad, lo que él dijo no se pierde.
  conversacion = conLoDicho(
    contacto.conversacion,
    "cliente",
    mensaje.texto ||
      (mensaje.tipo === "imagen"
        ? "(mandó una foto)"
        : mensaje.tipo === "publicacion"
          ? "(compartió una publicación)"
          : mensaje.tipo === "historia"
            ? "(respondió a una historia)"
            : mensaje.anuncio
              ? "(llegó desde un anuncio)"
              : "")
  );

  textos = contacto.ultimos_textos;

  // LO QUE ESCRIBIÓ, PARA EL PANEL Y EL PANEL CENTRAL (ver panel.js). Antes
  // de mirar la pausa: el dueño tiene que verlo aunque el bot no conteste.
  // Una nota de voz se guarda ya transcrita, más abajo.
  if (!mensaje.audio || estaPausado(contacto)) {
    await anotarMensaje(
      env.DB,
      mensaje.igsid,
      "cliente",
      mensaje.audio
        ? "🎤 (mandó una nota de voz)"
        : mensaje.texto ||
            (mensaje.tipo === "imagen"
              ? "(mandó una foto)"
              : mensaje.tipo === "publicacion"
                ? "(compartió una publicación)"
                : mensaje.tipo === "historia"
                  ? "(respondió a una historia)"
                  : mensaje.anuncio
                    ? "(llegó desde un anuncio)"
                    : ""),
      // La foto que mandó (o la historia o publicación), para verla en el panel.
      {
        fotos: [mensaje.historia?.url || mensaje.foto || mensaje.publicacion?.url],
        historia: Boolean(mensaje.historia?.url),
      }
    );
    // ¿Se está quejando de la respuesta? Al panel central, en el momento.
    await vigilarQueja(env, mensaje.igsid, mensaje.texto);
  }

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

  // UNA NOTA DE VOZ SE ESCUCHA Y SE ATIENDE COMO TEXTO (2-oct-2026, ver
  // voz.js). Se le contesta POR ESCRITO: EPICCELL no manda notas de voz. Si
  // no se puede escuchar, se le pide con amabilidad que escriba.
  let notaVoz = "";
  if (mensaje.audio) {
    const oido = await transcribirAudio(env, mensaje.audio, { anotar: (d) => anotarGasto(env, d) });
    if (!oido.texto) {
      console.error(`Voz: no pude transcribir la nota de ${mensaje.igsid}: ${oido.error}`);
      await mandar(() => enviarTexto(env, mensaje.igsid, PEDIR_QUE_ESCRIBA), PEDIR_QUE_ESCRIBA);
      await guardarContacto(env.DB, {
        ...contacto,
        historial: conNota(contacto.historial, "Mandó una nota de voz que no se pudo escuchar: le pedí que escriba."),
        mids_enviados: mids,
        ultimo_envio: enviadoEn || Date.now(),
        ultima_respuesta: PEDIR_QUE_ESCRIBA,
        conversacion,
      });
      return;
    }
    console.log(`Voz: el cliente dijo (${oido.modelo}): ${JSON.stringify(oido.texto.slice(0, 200))}`);
    mensaje.texto = [mensaje.texto, oido.texto].filter(Boolean).join(" ");
    conversacion = conLoDicho(conversacion, "cliente", `(nota de voz) ${oido.texto}`);
    await anotarMensaje(env.DB, mensaje.igsid, "cliente", `🎤 ${oido.texto}`);
    await vigilarQueja(env, mensaje.igsid, oido.texto);
    notaVoz = notaDeVoz();
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
    // Quien viene de un anuncio no "mandó" nada que no se pudiera abrir:
    // pulsó un botón de una publicidad. Decirle "no pude abrir eso" es
    // recibirlo con un error. Se le da la bienvenida y se le pregunta.
    const frase = mensaje.anuncio ? alAzar(BIENVENIDA_DESDE_ANUNCIO) : alAzar(NO_PUDE_ABRIRLO);
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
      const fichas = previos.map((p) => ({ ...p, precio: subtituloDeFicha(p, false, false) }));
      await mandar(() => enviarFichas(env, mensaje.igsid, fichas), "", { fichas });

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
  // LOS DATOS DE LA TIENDA LOS CONTESTA EL CÓDIGO (29-sep-2026).
  //
  // Horario, dirección, envíos, delivery, formas de pago, tasa, empleo: el
  // modelo no los sabe, y un modelo sin un dato lo rellena. En la revisión
  // salió "abrimos de 8 a 5" (son 9 a 7) y "sí, enviamos a todo el país"
  // (nadie lo dijo). Aquí se contestan con lo que está en wrangler.toml, o
  // con que un asesor lo confirma — nunca con una suposición.
  //
  // Solo cuando el mensaje es SOBRE ESO. Si además nombra un equipo —"¿tienen
  // el A57 y hacen envíos?"— sigue el camino normal: ahí hay producto que
  // enseñar, y el prompt ya manda los envíos al asesor.
  // La ubicación, si está cargada (LOCAL_TEXTO), la manda su propio atajo
  // con la foto y el botón de Maps (ver local.js), más abajo.
  const datoPedido = !imagenCruda && !publicacion ? queDatoPide(mensaje.texto) : "";
  const datoQuePide = datoPedido === "ubicacion" && hayLocal(env) ? "" : datoPedido;
  const nombraEquipo = datoQuePide
    ? Boolean(equipoQueNombra(mensaje.texto, await catalogoCompleto(env)))
    : false;

  if (datoQuePide && !nombraEquipo) {
    const { texto: frase, alAsesor, boton } = respuestaDeDato(datoQuePide, env);

    if (frase) {
      console.log(
        `Preguntó por ${datoQuePide}: ` +
          (alAsesor ? "ese dato no está cargado, se lo confirma un asesor" : "contesto con el dato de la tienda")
      );

      await mandar(
        () => (boton ? enviarConBoton(env, mensaje.igsid, frase, boton) : enviarTexto(env, mensaje.igsid, frase)),
        frase
      );

      await guardarContacto(env.DB, {
        ...contacto,
        nombre,
        historial: conNota(historialPrevio, `Preguntó por ${datoQuePide}.`),
        mids_enviados: mids,
        ultimo_envio: enviadoEn || Date.now(),
        ultima_respuesta: frase,
        conversacion,
      });

      // Se le prometió que alguien se lo confirma: alguien tiene que
      // enterarse, o la promesa queda en el aire.
      if (alAsesor) {
        await avisarAsesor(env, {
          ...paraElAviso(contacto),
          igsid: mensaje.igsid,
          mensaje: mensaje.texto,
          respuesta: frase,
          motivo: `PREGUNTA POR ${datoQuePide.toUpperCase()}`,
        });
      }
      return;
    }
  }

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
      await mandar(() => enviarFichas(env, mensaje.igsid, fichas), "", { fichas });

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
  // "¿DÓNDE ESTÁN?": LA UBICACIÓN DE EPICCELL, CON SU BOTÓN DE MAPS (5-oct-2026).
  //
  // Sale del código, no de la IA: como en ManyChat, la foto del local, el
  // texto y el botón de Maps (sin foto, el texto con el botón). Si es SOLO eso, aquí
  // termina (cero llamadas a la IA). Si además pide otra cosa, la ubicación
  // sale primero y el resto sigue, con la IA avisada de que ya se mandó.
  // Ver local.js.
  let notaDelLocal = "";
  if (!imagenCruda && hayLocal(env) && preguntaPorElLocal(mensaje.texto)) {
    const local = elLocal(env);
    console.log(`Preguntó dónde estamos → le mando la ubicación${local.foto ? " con la foto" : ""}${local.mapa ? " y el botón de Maps" : " (sin botón: falta LOCAL_MAPA)"}`);
    await mandar(() => enviarLocal(env, mensaje.igsid, { ...local, boton: BOTON_MAPA }), local.texto, local.foto ? { fotos: [local.foto] } : null);
    if (soloPreguntaPorElLocal(mensaje.texto)) {
      await guardarContacto(env.DB, {
        ...contacto,
        nombre,
        historial: conNota(historialPrevio, "Preguntó la ubicación y se la pasé."),
        mids_enviados: mids,
        ultimo_envio: enviadoEn || Date.now(),
        ultima_respuesta: local.texto,
      });
      return;
    }
    notaDelLocal = NOTA_LOCAL_ENVIADA;
  }

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
        const fichas = previos.map((p) => ({ ...p, precio: subtituloDeFicha(p, false, true) }));
        await mandar(() => enviarFichas(env, mensaje.igsid, fichas), "", { fichas });

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
  // Y si ese equipo es UNO concreto (no solo la marca), se le pasa a
  // decidir() para que salga ese y no la marca entera.
  let equipoSenalado = "";

  // EL TEXTO DEL ANUNCIO VA ANTES QUE SU IMAGEN (30-sep-2026).
  //
  // Antes se miraba primero la imagen, y el texto solo si la imagen no
  // decía nada. Al revés de lo que conviene: el texto de un anuncio
  // ("Poco X8 pro 5G 8/256") nombra el modelo EXACTO, y la IA de visión,
  // mirando la foto de un teléfono, puede confundir un Note 15 con un Note
  // 17 —se parecen—, y entonces al cliente le llegaban las fotos de otro
  // equipo. Si el texto ya lo nombra, no hace falta mirar la imagen: una
  // llamada a gpt-4o menos, que además es la más cara.
  //
  // Solo con una publicación que llega AHORA: si ya se contestó por ella
  // (soloContexto), es conversación vieja y no se impone.
  //
  // Un texto que nombra VARIOS modelos ("Samsung A57 y A37") no señala uno:
  // ahí se sigue como antes, mirando la imagen.
  const pie = publicacion ? `${publicacion.titulo || ""} ${publicacion.descripcion || ""}`.trim() : "";

  // Si en ese mismo mensaje pide OTROS ("¿tienes otros modelos?"), se le
  // dice cuál es el del anuncio pero no se le impone.
  const pideOtros = PIDE_OTROS.test(mensaje.texto || "");

  if (pie && !publicacion.soloContexto) {
    const { estado, titulo: delPie, dicho } = queEquipoSenala(pie, await catalogoCompleto(env));

    if (estado === "exacto") {
      equipoDeLaPublicacion = delPie;
      equipoSenalado = pideOtros ? "" : dicho;
      marcaFoto = marcarIdentificacion(delPie, false, esHistoria, true);
      console.log(`El texto de la publicación nombra "${delPie}": eso es lo que busco, sin mirar la imagen`);
    } else if (estado === "agotado") {
      // Nombra un modelo que HOY NO ESTÁ (lo más cercano de la hoja es un
      // pariente o solo la marca). No se mira la imagen —la IA de visión,
      // con el catálogo delante, lo "encontraría" en el pariente— y se le
      // dice al modelo la verdad; decidir() arma el "ese no, pero mira".
      equipoDeLaPublicacion = dicho;
      equipoSenalado = pideOtros ? "" : dicho;
      marcaFoto =
        `[${publicacion.deAnuncio ? "EL ANUNCIO" : "LA PUBLICACIÓN"} ES DEL "${dicho}", QUE HOY NO ` +
        "ESTÁ DISPONIBLE. El sistema le muestra lo más parecido que hay. NO digas que lo " +
        "tienes: dile que ese no está ahora y que mire estos]";
      console.log(`La publicación es del "${dicho}" y no está en la hoja (lo más cercano: "${delPie}")`);
    }
  }

  // Con el equipo sabido por el texto, la imagen ya no aporta: no se gasta
  // la llamada de visión.
  if (foto && !equipoDeLaPublicacion) {
    const identificacion = await identificarEnImagen(env, foto, catalogo, {
      esPublicacion: Boolean(publicacion),
      // Detrás viene la IA de texto: se le deja su parte.
      esperaMs: tiempoParaLaIa(rastro, 6000),
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
        // Solo la marca ("Samsung") no señala un equipo: ahí se le enseña
        // la marca y se le pregunta el modelo, como siempre.
        if (publicacion && !identificacion.pedirNombreExacto && !pideOtros) {
          equipoSenalado = identificacion.buscar;
        }
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
  // (Si el texto nombraba UN modelo, ya se resolvió arriba. Esto queda
  // para los que nombran varios y para la publicación que sigue de
  // contexto.)
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
  // EL ANUNCIO POR EL QUE LLEGÓ, CON SUS PRECIOS DE VERDAD (2-oct-2026).
  //
  // El dueño: "que la IA vea a las personas que vienen de los anuncios para
  // que responda bien, no genérico, y si preguntan un precio específico
  // sepa qué responder". Antes la IA solo sabía del anuncio en el PRIMER
  // mensaje (3 minutos), sin precios. Ahora:
  //   · se recuerda durante días (ANUNCIO_RECORDADO_MS), mensaje a mensaje;
  //   · se le da el equipo del anuncio con su capacidad y sus precios
  //     reales de la hoja, para que conteste "¿cuánto?" con el número;
  //   · esos precios cuentan como verdaderos para la red de precios.
  const pubDelAnuncio = publicacion?.deAnuncio
    ? { ...publicacion, equipo: publicacion.equipo || equipoDeLaPublicacion || "" }
    : contacto.publicacion?.deAnuncio &&
        Date.now() - (Number(contacto.publicacion.cuando) || 0) < ANUNCIO_RECORDADO_MS
      ? contacto.publicacion
      : null;
  const hojaDelAnuncio = pubDelAnuncio ? await catalogoCompleto(env) : [];
  const productoDelAnuncio = pubDelAnuncio ? equipoDelAnuncio(pubDelAnuncio, hojaDelAnuncio) : null;
  const notaDelAnuncio = productoDelAnuncio ? marcaDelAnuncio(productoDelAnuncio, pubDelAnuncio, { divisas: PREGUNTA_DIVISAS.test(mensaje.texto) }) : "";
  if (productoDelAnuncio) {
    console.log(`Viene del anuncio del "${productoDelAnuncio.titulo}": la IA lo sabe, con sus precios`);
    // Se guarda qué equipo era: la próxima vez no hay que volver a deducirlo.
    if (publicacion?.deAnuncio && !publicacion.soloContexto && !publicacion.equipo) {
      await guardarPublicacion(env.DB, mensaje.igsid, { ...publicacion, atendida: true, equipo: productoDelAnuncio.titulo });
    }
  }

  const marca = publicacion
    ? [
        foto || equipoDeLaPublicacion ? marcaFoto : marcarPublicacionSinVer(porQueNo),
        marcaDePublicacion({
          titulo: publicacion.titulo,
          descripcion: publicacion.descripcion,
          termino: publicacion.termino,
          deAnuncio: Boolean(mensaje.anuncio),
        }),
      ]
        .filter(Boolean)
        .join("\n")
    : imagenCruda
      ? foto
        ? marcaFoto
        : marcarSinVer(porQueNo, esHistoria)
      : "";

  // LA FICHA TÉCNICA DE LO QUE SE HABLA (6-oct-2026, ver especificaciones.js).
  // "Lo técnico no pasa a un asesor: la IA lo dice, pero con información."
  // Van las de lo que nombra, el anuncio y lo último que vio (máximo 4).
  const especificaciones = await todasLasEspecificaciones(env.DB);
  const vioAntes = especificaciones.length ? await ultimosQueVio(env, contacto) : [];
  const nombraAhora = especificaciones.length ? nombraDelCatalogo(mensaje.texto, await catalogoCompleto(env)) : "";
  const titulosDeLaCharla = [nombraAhora, productoDelAnuncio?.titulo, ...vioAntes.map((p) => p.titulo)].filter(Boolean);
  const fichasTecnicas = fichasDeLaCharla(especificaciones, { titulos: titulosDeLaCharla, texto: mensaje.texto });
  if (fichasTecnicas.length) console.log(`Ficha técnica para la IA: ${fichasTecnicas.map((f) => f.modelo).join(", ")}`);

  const entrada = contexto(
    nombre,
    historialPrevio,
    textoCliente,
    [notaVoz, marca, notaDelAnuncio, notaTecnica(fichasTecnicas), notaDelLocal].filter(Boolean).join("\n"),
    esHistoria,
    minutosCallado,
    catalogo,
    Boolean(publicacion),
    // La conversación SIN la línea que él acaba de escribir: esa va abajo,
    // en "lo que pide ahora", y repetirla dos veces confunde al modelo.
    conversacion.slice(0, -1)
  );

  const salida = await responderTexto(env, entrada, { esperaMs: tiempoParaLaIa(rastro) });

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
    // ❌ en el panel, y aviso al central en el momento.
    await anotarTurno(
      env.DB,
      { igsid: mensaje.igsid, cliente: textoCliente, respuesta: FALLO_TECNICO, marca: "error", motivo: "La IA no respondió (OpenAI falló o tardó demasiado)" },
      env
    );
    return;
  }

  const {
    productos: productosDecididos,
    respuestaCliente: respuestaDecidida,
    segundoMensaje,
    termino,
    esConsultaDeAsesor,
    buscoSinExito,
    hayMas,
    porCategoria,
  } = await decidir({
    env,
    salida,
    texto: mensaje.texto,
    historialPrevio,
    senalado: equipoSenalado,
    productoAnuncio: productoDelAnuncio,
    recientes: await ultimosQueVio(env, contacto),
  });

  // No es const: las redes de abajo pueden cambiar lo que se le dice o lo
  // que se le enseña.
  let respuestaCliente = respuestaDecidida;
  let productos = productosDecididos;

  // EL TONO (2-oct-2026, ver tono.js): ni una grosería, ni un insulto, ni
  // un regaño salen del bot, por mucho que el cliente provoque.
  const revisionDeTono = revisarTono(respuestaCliente);
  if (revisionDeTono.corregido) respuestaCliente = revisionDeTono.respuesta;

  // LO QUE NO HAY EN LA HOJA NO SE OFRECE (2-oct-2026, ver disponible.js).
  // Caso real: EPICCELL no tiene iPhone, preguntaron por uno con una nota de
  // voz y la IA habló como si hubiera.
  const enLaHojaAhora = await catalogoCompleto(env);
  const revisionDeDisponible = revisarDisponibilidad(respuestaCliente, enLaHojaAhora);
  if (revisionDeDisponible.corregido) respuestaCliente = revisionDeDisponible.respuesta;

  // "TE LOS MUESTRO" TIENE QUE TRAER FOTOS (2-oct-2026, caso real).
  //
  // El cliente: "ahora muéstrame, quiero verlos" (nota de voz), "en
  // imágenes", "mándalos". La IA contestaba "¡Claro! Aquí tienes los
  // teléfonos que tengo disponibles 👇" con "buscar": "NADA", y no le
  // llegaba ni una foto, tres veces seguidas. Si la IA promete enseñar y no
  // va nada debajo:
  //   1. los equipos que nombra su propio texto (se escribió la lista);
  //   2. si no nombra ninguno, los del último mensaje del bot (lo que
  //      acaba de listar), o los del último carrusel;
  //   3. y si no hay de dónde sacarlos, se le pregunta de qué marca, con un
  //      botón por marca, en vez de prometerle algo que no llega.
  let preguntarMarca = false;
  if (
    !productos.length &&
    !revisionDeDisponible.corregido &&
    !termino &&
    !buscoSinExito &&
    !segundoMensaje &&
    !esConsultaDeAsesor &&
    !imagenCruda &&
    !publicacion &&
    prometeFotos(respuestaCliente, mensaje.texto)
  ) {
    const nombrados = productosRecomendados(enLaHojaAhora, respuestaCliente);
    const delUltimo = nombrados.length
      ? []
      : productosRecomendados(enLaHojaAhora, contacto.ultima_respuesta || "");
    const delCarrusel = nombrados.length || delUltimo.length
      ? []
      : enLaHojaAhora.filter((p) => (contacto.ultimos_productos || []).some((t) => despejar(t) === despejar(p.titulo)));
    const rescatados = nombrados.length ? nombrados : delUltimo.length ? delUltimo : delCarrusel;

    if (rescatados.length) {
      productos = rescatados.slice(0, 10);
      console.log(
        `La IA prometió fotos sin buscar nada: le mando ${productos.length} ficha(s) de ` +
          (nombrados.length ? "lo que nombró su texto" : delUltimo.length ? "lo que le acabo de listar" : "su último carrusel")
      );
    } else {
      preguntarMarca = true;
      console.log("La IA prometió fotos sin buscar nada y no hay de dónde sacarlas: le pregunto la marca");
    }
  }

  // CÓMO RESPONDE: SOLO TEXTO, TEXTO CON FICHAS, O FICHAS (2-oct-2026).
  // La IA lo elige en "mostrar". "Solo texto" sirve para NO REPETIR fichas
  // que ya vio; si lo encontrado es nuevo para él, las fichas van siempre.
  const modo = salida?.mostrar || "texto_e_imagenes";
  const vistos = [...(contacto.mostrados || []), ...(contacto.ultimos_productos || [])];
  const yaLosVio = productos.length > 0 && productos.every((p) => yaLoVio(vistos, p.titulo));
  // NUNCA SOLO TEXTO SI PIDE VERLAS O SE LE PROMETEN (6-oct-2026, dueño: "la
  // IA no está enviando imágenes": llegaba el texto y nada debajo). "Ya las
  // vio" mira TODO lo que se le mostró alguna vez, y la IA elegía "texto"
  // aunque el cliente pidiera "mándame las fotos" o ella escribiera "mira
  // 👇". Si las pide o se le prometen, las fichas van.
  const pideOPrometeFotos = prometeFotos(respuestaCliente, mensaje.texto);
  const soloTexto = modo === "texto" && productos.length > 0 && !imagenCruda && !publicacion && yaLosVio && !pideOPrometeFotos;
  if (modo === "texto" && productos.length > 0 && yaLosVio && pideOPrometeFotos) {
    console.log(`La IA eligió SOLO TEXTO, pero pide verlas o se le prometen (👇): le mando las ${productos.length} ficha(s)`);
  }
  if (modo === "texto" && productos.length > 0 && !yaLosVio) {
    console.log(`La IA eligió SOLO TEXTO, pero los ${productos.length} producto(s) son nuevos para él: se los mando igual`);
  }
  if (soloTexto) {
    console.log(`La IA eligió responder SOLO TEXTO: no le repito las ${productos.length} ficha(s) que ya vio`);
  }
  if (modo === "imagenes" && productos.length && respuestaCliente.length > 120) {
    // Las fichas hablan: el texto va corto, la primera frase.
    respuestaCliente = respuestaCliente.split(/(?<=[.!?👇😊🙌])\s+/)[0];
  }

  // El precio que va en cada ficha depende de lo que preguntó el cliente
  // (Cashea, divisas, o el de por defecto). Se resuelve ACÁ y las fichas
  // salen con el precio ya escrito: así instagram.js no necesita saber
  // nada de Cashea y sigue sirviendo igual para cualquier tienda.
  const conCashea = PREGUNTA_CASHEA.test(mensaje.texto);
  const conDivisas = PREGUNTA_DIVISAS.test(mensaje.texto);
  const fichas = (soloTexto ? [] : productos).map((p) => ({
    ...p,
    precio: subtituloDeFicha(p, conCashea, conDivisas),
  }));

  // EL PRECIO YA ESTÁ EN LA FICHA (2-oct-2026, ver precio.js): con las
  // fichas a la vista, nada de "¿quieres saber el precio?".
  const revisionDePrecio = revisarPrecio(respuestaCliente, { hayFichas: fichas.length > 0, yaLasVio: soloTexto });
  if (revisionDePrecio.corregido) respuestaCliente = revisionDePrecio.respuesta;

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

  // CUÁNTO LE QUEDA CON CASHEA: LA CUENTA LA HACE EL CÓDIGO (6-oct-2026,
  // ver cuotas.js). "Estoy en nivel 3, ¿en cuánto me quedan las cuotas?"
  // recibía "Mira los precios 👇": la IA no puede hacer la cuenta, y la red
  // de precios borraba la que hacía. Aquí sale exacta, del precio Cashea
  // de la hoja. No con la tabla general de pagos (ya va sola) ni cuando no
  // se sabe de qué equipo habla.
  const cuentaDeCuotas =
    segundoMensaje || sinSaberQueEs || imagenCruda
      ? null
      : contestarCuotas({
          texto: mensaje.texto,
          historial: historialPrevio,
          equipo: equipoDeLaCuenta({ productos, productoAnuncio: productoDelAnuncio, recientes: await ultimosQueVio(env, contacto) }),
        });
  // El saludo del modelo se queda si es el primer mensaje.
  const saludoDelModelo = historialPrevio ? "" : (String(salida.respuesta || "").match(SU_BIENVENIDA)?.[0] || "").trim();
  if (cuentaDeCuotas) {
    respuestaCliente = [saludoDelModelo, cuentaDeCuotas.respuesta].filter(Boolean).join(" ");
    console.log(`CUOTAS: ${cuentaDeCuotas.motivo}`);
  }

  // "¿CUÁNTO CUESTA?" Y NADA MÁS, DE ALGUIEN NUEVO (6-oct-2026, 4 casos
  // en un día). Es la pregunta que trae escrita el botón de un anuncio,
  // pero Meta no mandó de cuál: no hay equipo del que hablar. Antes salía
  // "¿Qué equipo estás buscando?", que ignora lo que preguntó. Ahora se le
  // contesta a SU pregunta: con gusto, ¿de cuál?, y cómo decírnoslo rápido.
  const precioSinEquipo =
    !cuentaDeCuotas &&
    !historialPrevio &&
    !paraMostrar.length &&
    !productoDelAnuncio &&
    !publicacion &&
    !imagenCruda &&
    !segundoMensaje &&
    PRECIO_A_SECAS.test(String(mensaje.texto || ""));
  if (precioSinEquipo) {
    respuestaCliente = [saludoDelModelo || "¡Hola! Soy la asistente virtual de EPICCELL 👋", PRECIO_DE_CUAL].join(" ");
    console.log(
      `"${mensaje.texto}" sin saber de qué equipo: le pregunto cuál${mensaje.anuncio ? " (llegó de un anuncio que no dice cuál: revisa ADS_TOKEN y ANUNCIOS_EQUIPOS)" : ""}`
    );
  }

  // LA IA REDACTA VIENDO LO QUE HAY (2-oct-2026, ver redactarConResultados
  // en ia.js). Cuando hay fichas que enseñar, o cuando el código tuvo que
  // cambiar lo que la IA había escrito a ciegas, se le pide la respuesta
  // final con los resultados delante. Lo de antes queda de respaldo.
  //
  // No se usa donde la respuesta tiene que salir EXACTA o avisa a una
  // persona: las tablas de pago, las preguntas de asesor (colores,
  // garantía…), la publicación que no se sabe cuál es, la pregunta de marca.
  // Con lo que salió en la búsqueda, la ficha técnica de ESO va primero.
  const fichasTecnicasFinal = fichasDeLaCharla(especificaciones, {
    titulos: [...paraMostrar.map((p) => p.titulo), ...titulosDeLaCharla],
    texto: mensaje.texto,
  });

  const cambioElCodigo = respuestaCliente.trim() !== String(salida.respuesta || "").trim();
  if (
    redaccionLibre(env) &&
    !sinSaberQueEs &&
    !segundoMensaje &&
    !esConsultaDeAsesor &&
    !preguntarMarca &&
    !cuentaDeCuotas &&
    !precioSinEquipo &&
    (paraMostrar.length > 0 || cambioElCodigo) &&
    tiempoParaLaIa(rastro) > 4000
  ) {
    const redactada = await redactarConResultados(
      env,
      contextoParaRedactar({
        // Sin su última línea: va aparte, en "lo que pide ahora".
        conversacion: conversacion.slice(0, -1),
        texto: textoCliente,
        // Los de la hoja; a la IA le llega UN precio, el que toca (ver precioParaLaIa).
        productos: productos.filter((p) => paraMostrar.some((f) => f.titulo === p.titulo)),
        anuncio: [notaDelAnuncio, notaTecnica(fichasTecnicasFinal)].filter(Boolean).join("\n"),
        queMostrar: soloTexto ? "texto" : modo,
        paso: cambioElCodigo ? respuestaCliente : "",
        borrador: salida.respuesta,
        yaSeConocen: Boolean(historialPrevio),
      }),
      // La segunda pasada es un pulido: nunca a costa de las fichas. Tope de
      // 7 s; si no le alcanza, sale la respuesta de la primera pasada.
      { esperaMs: Math.min(REDACCION_MAXIMO_MS, tiempoParaLaIa(rastro)) }
    );

    if (redactada) {
      // Las mismas redes que a la primera: el tono, lo que no hay, los
      // precios inventados, la puerta cerrada y la pregunta del precio.
      let revisada = revisarTono(redactada).respuesta;
      revisada = revisarDisponibilidad(revisada, enLaHojaAhora).respuesta;
      const conPrecioDeVerdad = productoDelAnuncio ? [...productos, productoDelAnuncio] : productos;
      revisada = sinCerrarLaPuerta(sinPreciosInventados(revisada, conPrecioDeVerdad, { divisas: PREGUNTA_DIVISAS.test(mensaje.texto), tambien: await ultimosQueVio(env, contacto) }), paraMostrar);
      revisada = revisarPrecio(revisada, { hayFichas: paraMostrar.length > 0, yaLasVio: soloTexto }).respuesta;
      if (historialPrevio) revisada = sinBienvenida(revisada);
      // Sin fichas debajo, una flecha que apunta a nada no puede salir.
      if (!paraMostrar.length) revisada = revisada.replace(/\s*👇/g, "").trim();

      // Lo que la redacción NO puede deshacer: lo que el código ya
      // comprobó. Si dice que no hay con las fichas debajo, o promete fotos
      // que no van, se queda la de siempre.
      const contradice =
        (paraMostrar.length > 0 && AFIRMA_QUE_NO_HAY.test(revisada) && !AFIRMA_QUE_NO_HAY.test(respuestaCliente)) ||
        (!paraMostrar.length && /\baqu[ií]\s+(?:los?|las?)\s+tienes\b|\bte\s+(?:los?|las?)\s+muestro\b/i.test(revisada));
      if (contradice) {
        console.log(`La redacción contradecía la búsqueda (${JSON.stringify(revisada.slice(0, 100))}): va la de siempre`);
      } else if (revisada) {
        console.log(`La IA redactó viendo los resultados: ${JSON.stringify(revisada.slice(0, 160))}`);
        respuestaCliente = revisada;
      }
    } else {
      console.log("La redacción con resultados no salió: va la respuesta de siempre");
    }
  }

  // PREGUNTÓ EL PRECIO: SE LE ESCRIBE (6-oct-2026, ver precio.js). "¿Qué
  // precio tiene el A57?" recibía "Aquí tienes el precio del Samsung A57:"
  // y nada más. Con 1 a 3 fichas, su precio va escrito (el mismo de la
  // ficha: un solo precio, el que toca).
  const precioEscrito = cuentaDeCuotas || sinSaberQueEs
    ? { corregido: false }
    : contestaElPrecio(respuestaCliente, { texto: mensaje.texto, fichas: paraMostrar });
  if (precioEscrito.corregido) respuestaCliente = precioEscrito.respuesta;

  const leDigo = sinSaberQueEs
    ? alAzar(PUBLICACION_SIN_IDENTIFICAR)
    : paraMostrar.length && !cuentaDeCuotas
      ? sinListaPegada(respuestaCliente)
      : soloTexto
        ? // Las fichas ya las vio ARRIBA: una flecha hacia abajo apunta a nada.
          respuestaCliente.replace(/👇/g, "👆")
        : respuestaCliente;

  // EL CATÁLOGO NO ES LA RESPUESTA POR DEFECTO. El botón sale en dos casos:
  // buscamos lo que pidió y no apareció, o hay más de los que caben en el
  // carrusel. Una pregunta de vendedora —"¿lo quieres nuevo o usado?"— sale
  // como texto limpio: el cliente que se va al catálogo se va de la
  // conversación.
  // Prometió fotos y no hay de dónde sacarlas: de qué marca, con botones.
  const marcasParaElegir = preguntarMarca && !sinSaberQueEs ? marcasDelCatalogo(enLaHojaAhora) : [];
  const preguntaDeMarca = "¡Claro que sí! 😊 ¿De cuál marca te muestro? 👇";

  if (marcasParaElegir.length) {
    await mandar(
      () =>
        enviarConOpciones(
          env,
          mensaje.igsid,
          preguntaDeMarca,
          marcasParaElegir.slice(0, 11).map(({ nombre: m }) => ({ titulo: m, payload: `${OPCION_MARCA}${m}` }))
        ),
      preguntaDeMarca
    );
  } else if (paraMostrar.length) {
    await mandar(() => enviarTexto(env, mensaje.igsid, leDigo), leDigo);
    // Si el turno ya va muy largo, que quede escrito: un corte de Cloudflare
    // aquí deja el texto sin las fichas y no avisa (ver LIMITE_DEL_TURNO_MS).
    const usado = Date.now() - (rastro?.llegoEn || Date.now());
    if (usado > LIMITE_DEL_TURNO_MS - PARA_ENVIAR_MS) {
      console.error(`FICHAS EN RIESGO: el turno lleva ${Math.round(usado / 1000)} s y quedan ${paraMostrar.length} ficha(s) por mandar`);
    }
    await mandar(() => enviarFichas(env, mensaje.igsid, paraMostrar), "", { fichas: paraMostrar });
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

  // "PÁSAME TODAS LAS ESPECIFICACIONES": un botón a la página oficial de la
  // marca (6-oct-2026), si el equipo la tiene puesta en la base.
  const botonFicha = sinSaberQueEs || marcasParaElegir.length ? null : botonDeLaPagina(mensaje.texto, fichasTecnicasFinal);
  if (botonFicha) {
    await mandar(() => enviarConBoton(env, mensaje.igsid, botonFicha.texto, { titulo: botonFicha.titulo, url: botonFicha.url }), botonFicha.texto);
  }

  // LO QUE PENSÓ LA IA, PARA EL PANEL (2-oct-2026, ver panel.js): qué
  // entendió, qué buscó, qué fichas salieron y qué corrigieron las redes.
  const turnoDelPanel = {
    igsid: mensaje.igsid,
    cliente: notaVoz ? `🎤 ${mensaje.texto}` : textoCliente,
    pienso: salida.pienso,
    buscar: salida.buscar,
    mostrar: soloTexto ? "texto" : modo,
    respuesta: marcasParaElegir.length ? preguntaDeMarca : leDigo,
    productos: paraMostrar.map((p) => p.titulo),
    notas: [
      notaVoz && "llegó por nota de voz",
      productoDelAnuncio && `viene del anuncio del ${productoDelAnuncio.titulo}`,
      revisionDeTono.corregido && "se quitó una grosería o un regaño",
      revisionDeDisponible.corregido && "habló de una marca que no hay: se corrigió",
      revisionDePrecio.corregido && "ofrecía el precio: se cambió por 'está en cada foto'",
      respuestaCliente !== String(salida.respuesta || "").trim() && !revisionDeTono.corregido && !revisionDeDisponible.corregido && !revisionDePrecio.corregido &&
        `su borrador era: "${String(salida.respuesta || "").slice(0, 140)}"`,
      preguntarMarca && "prometió fotos sin buscar: se le preguntó la marca",
      soloTexto && `respondió solo texto: ya había visto esas ${productos.length} ficha(s)`,
      sinSaberQueEs && "no se supo de qué equipo era la publicación",
      cuentaDeCuotas && `la cuenta de cuotas la hizo el código: ${cuentaDeCuotas.motivo}`,
      cuentaDeCuotas?.asesor && "se avisó al asesor para el monto",
      precioSinEquipo && "preguntó el precio sin decir de qué equipo (y no llegó anuncio que lo diga)",
      precioEscrito.corregido && "preguntó el precio: se le escribió el de la ficha",
      fichasTecnicasFinal.length &&
        `la IA tenía la FICHA TÉCNICA REAL (de la base) de: ${fichasTecnicasFinal
          .map((f) => `${f.modelo} [${["pantalla", "procesador", "memoria", "camara", "frontal", "bateria", "carga", "sistema", "extras"].map((c) => f[c]).filter(Boolean).join("; ")}]`)
          .join(" | ")
          .slice(0, 1500)}`,
      botonFicha && `se le mandó el botón a la página oficial (${botonFicha.url})`,
    ],
  };
  // El revisor lo mira cuando todo ya salió (ver atenderConRed y revisor.js).
  rastro.turno = {
    ...turnoDelPanel,
    id: await anotarTurno(env.DB, turnoDelPanel, env),
    fichas: paraMostrar.map((p) => `${p.titulo}${p.precio ? ` · ${p.precio}` : ""}`),
  };

  // El segundo mensaje de la tabla de pagos (Krece). Sale detrás del
  // primero, nunca solo, y nunca cuando no sabemos de qué equipo hablamos.
  const segundo = sinSaberQueEs ? "" : segundoMensaje;
  if (segundo) {
    await mandar(() => enviarTexto(env, mensaje.igsid, segundo), segundo);
  }

  const escalada = hayEscalada({
    respuesta: leDigo,
    productos: paraMostrar,
    esConsultaDeAsesor: (esConsultaDeAsesor || Boolean(cuentaDeCuotas?.asesor)) && !sinSaberQueEs,
    buscoSinExito: buscoSinExito && !sinSaberQueEs,
  });

  if (escalada) {
    await avisarAsesor(env, {
      ...paraElAviso(contacto),
      igsid: mensaje.igsid,
      mensaje: textoCliente,
      respuesta: leDigo,
      motivo: cuentaDeCuotas?.asesor ? "MONTO CON KRECE (el bot dio el % y las cuotas)" : motivo({ esConsultaDeAsesor }),
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
    // historialSinPrecios: lo que el modelo anota vuelve en el mensaje
    // siguiente, así que una cifra inventada ahí no se queda quieta.
    historial: historialSinPrecios(
      recortarHistorial(
        sinSaberQueEs
          ? conNota(historialPrevio, "Compartió una publicación que no pude identificar: le pregunté cuál es.")
          : porCategoria
            ? conNota(
                salida.historial || historialPrevio,
                `No había "${termino}": le mostré los de "${porCategoria}". Ya busqué: ${porCategoria}.`
              )
            : salida.historial || historialPrevio
      )
    ),
    pausado_hasta: contacto.pausado_hasta,
    mids_enviados: mids,
    // Lo que se le acaba de decir, tal cual. Es lo que hace posible el
    // "muéstrame esos" del próximo mensaje (ver recomendados.js).
    ultima_respuesta: marcasParaElegir.length ? preguntaDeMarca : leDigo,
    // Todo lo que ya vio en fichas: así "solo texto" sabe qué no repetir.
    mostrados: conProductosMostrados(contacto.mostrados || [], paraMostrar),
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

  // QUIEN VIENE DE UN ANUNCIO ESTÁ MIRANDO ESE ANUNCIO (29-sep-2026).
  //
  // Es exactamente el mismo caso que compartir una publicación: el cliente
  // señaló un equipo con el dedo y escribe "precio?". La diferencia es que
  // aquí lo señaló en una publicidad por la que la tienda pagó.
  //
  // El anuncio trae su título y su foto, y muchas veces el id del post del
  // que salió — con ese id se lee el pie completo por la API, igual que
  // con un comentario. Todo eso entra por el mismo camino que ya existe,
  // así que el bot identifica el equipo y contesta con ÉL, no con lo
  // último de la conversación.
  const anuncio = mensaje.anuncio || null;
  const enlaceEscrito = compartida || anuncio ? "" : enlaceEnTexto(mensaje.texto);

  if (compartida || enlaceEscrito || anuncio) {
    // EL AVISO NO SIEMPRE TRAE LO QUE EL CLIENTE VIO (29-sep-2026).
    //
    // Meta manda "ads_context_data" —título, foto, post— según el formato
    // del anuncio y la versión de la API. Hay avisos que llegan con el id
    // y nada más, y ahí el bot se quedaba preguntando "¿qué equipo viste?"
    // a alguien que acababa de verlo en pantalla, y que la tienda pagó por
    // traer.
    //
    // Con el id se va a buscar el anuncio entero a la API (ver anuncio.js).
    // Hace falta el secreto ADS_TOKEN; sin él, esto no se intenta siquiera
    // y todo sigue funcionando con lo que traiga el aviso.
    // "leido" ya está usado más abajo para lo que se saca de un enlace.
    //
    // Y no solo cuando el aviso llega pelado (30-sep-2026): muchas veces
    // trae la FOTO pero no el título, o un título que no nombra el equipo
    // ("¡Oferta!"). Con la foto sola el equipo lo adivina la IA de visión,
    // y un Note 15 y un Note 17 se parecen. El texto del anuncio lo dice
    // exacto. Se guarda 30 minutos por anuncio (ver anuncio.js), así que
    // cuesta una llamada por anuncio, no una por cliente.
    const delAnuncio = anuncio?.id ? await detallesDelAnuncio(env, anuncio.id) : null;

    // CUÁNTA GENTE TRAE CADA ANUNCIO (2-oct-2026): una persona por anuncio,
    // aunque escriba diez veces. Se ve en /anuncios.
    if (anuncio) await anotarLlegada(env.DB, anuncio, mensaje.igsid);

    // EL EQUIPO DEL ANUNCIO, PUESTO A MANO (ANUNCIOS_EQUIPOS en
    // wrangler.toml). Gana a todo lo demás: es el dueño diciendo "este
    // anuncio es del Samsung A57", para los anuncios que no lo nombran.
    const asignado = anuncio ? equipoAsignado(env, anuncio) : "";
    if (asignado) console.log(`Anuncio ${anuncio.id || anuncio.ref}: equipo puesto a mano → "${asignado}"`);

    const delPost = anuncio?.publicacion
      ? await publicacionPorId(env, anuncio.publicacion)
      : null;

    const cruda = compartida
      ? mensaje.publicacion
      : anuncio
        ? {
            url: anuncio.foto || delAnuncio?.imagen || delPost?.imagen || "",
            // El título del anuncio, su texto y el pie del post:
            // cualquiera de los tres puede ser el que nombre el equipo.
            titulo: asignado
              ? asignado
              : [...new Set([anuncio.titulo, delAnuncio?.titulo, delAnuncio?.texto, delPost?.titulo])]
                  .filter(Boolean)
                  .join(" · "),
            enlace: delPost?.permalink || "",
          }
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
    // El título cuenta tanto como la imagen: el de un anuncio ("Redmi Note
    // 17 — llévatelo en cuotas") nombra el equipo igual de bien que una
    // foto, y muchas veces es lo único que Meta manda.
    const algoUtil = Boolean(
      cruda.url || cruda.titulo || leido.imagen || leido.titulo || leido.descripcion || leido.termino
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
      deAnuncio: Boolean(anuncio),
    };

    await guardarPublicacion(env.DB, mensaje.igsid, nueva);
    console.log(
      `${anuncio ? "Anuncio" : "Publicación"} de ${mensaje.igsid} · imagen: ` +
        `${nueva.imagen ? "sí" : "no"} · texto: ${nueva.titulo ? `"${nueva.titulo.slice(0, 60)}"` : "—"}`
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
      ? "[EL CLIENTE RESPONDIÓ A UNA HISTORIA NUESTRA; esto es lo que sale en ella. "
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
  esPublicacionNueva = false,
  conversacion = []
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
    conversacion,
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
// Cuánto se recuerda el anuncio por el que llegó un cliente. Quien llega
// por una publicidad suele preguntar en varios mensajes, a veces al día
// siguiente ("¿y la inicial con Cashea?"): sigue hablando de ESE equipo.
const ANUNCIO_RECORDADO_MS = 7 * 24 * 60 * 60 * 1000;

// El equipo de la hoja del que es el anuncio: el que se guardó al llegar, o
// el que nombra su texto. Solo si es UNO y está hoy en la hoja.
function equipoDelAnuncio(pub, hoja) {
  if (!pub || !hoja.length) return null;
  const titulo =
    (pub.equipo && equipoQueNombra(pub.equipo, hoja)) ||
    (() => {
      const r = queEquipoSenala(`${pub.titulo || ""} ${pub.descripcion || ""}`, hoja);
      return r.estado === "exacto" ? r.titulo : "";
    })();
  if (!titulo) return null;
  return hoja.find((p) => despejar(p.titulo) === despejar(titulo)) || null;
}

// Lo que lee la IA: el equipo del anuncio con sus datos de verdad.
// UN SOLO PRECIO: a la IA solo le llega el que puede decir en este mensaje
// (el de Cashea, o el de divisas si lo pidió). El otro no lo ve, así que no
// puede decirlo.
function precioParaLaIa(producto, divisas) {
  if (divisas) return `Precio en divisas (lo pidió; es el ÚNICO que dices): ${producto.precio ? conMoneda(producto.precio) : "no está en la hoja, lo confirma un asesor"}`;
  return `Precio con Cashea (el ÚNICO que dices): ${producto.precioCashea ? conMoneda(producto.precioCashea) : "no está en la hoja, lo confirma un asesor"}`;
}

function marcaDelAnuncio(producto, pub, { divisas = false } = {}) {
  const datos = [
    `Nombre: ${producto.titulo}`,
    producto.capacidad && `Capacidad: ${producto.capacidad}`,
    precioParaLaIa(producto, divisas),
  ].filter(Boolean);
  const dice = [pub.titulo, pub.descripcion].filter(Boolean).join(" · ").slice(0, 200);
  return [
    `[ESTE CLIENTE LLEGÓ POR UN ANUNCIO DEL ${producto.titulo.toUpperCase()}` +
      (pub.cuando ? ` (${haceCuanto(Number(pub.cuando))})` : "") + "]",
    dice ? `[El anuncio dice: ${dice}]` : "",
    `[DATOS DE ESE EQUIPO EN LA HOJA, son reales y puedes decirlos tal cual: ${datos.join(" · ")}]`,
    "[Si pregunta precio, cuánto, la inicial o algo del equipo SIN nombrar otro, habla de ESTE: dale el",
    "precio que sale arriba y pon el equipo en \"buscar\" para que vea la ficha. NO le preguntes qué",
    "equipo busca. Si nombra otro equipo, atiende ese]",
  ]
    .filter(Boolean)
    .join("\n");
}

// LA REDACCIÓN CON RESULTADOS SE APAGA CON REDACCION_LIBRE = "no" en
// wrangler.toml (vuelven las frases de siempre). Por defecto, encendida.
function redaccionLibre(env) {
  return !/^(no|off|false|0)$/i.test(String(env?.REDACCION_LIBRE || "").trim());
}

// Lo que recibe la IA para redactar con los resultados delante.
function contextoParaRedactar({ conversacion = [], texto, productos, anuncio = "", queMostrar, paso, borrador, yaSeConocen }) {
  const charla = conversacion
    .slice(-8)
    .map((l) => `${l.de === "bot" ? "Tú" : "Cliente"}: ${String(l.texto || "").slice(0, 300)}`)
    .join("\n");
  const fichas = productos.length
    ? productos
        .slice(0, 10)
        .map(
          (p) =>
            `- ${p.titulo}${p.capacidad ? ` (${p.capacidad})` : ""}` +
            ` · ${precioParaLaIa(p, PREGUNTA_DIVISAS.test(texto))}`
        )
        .join("\n")
    : queMostrar === "texto"
      ? "(nada nuevo: ya las vio antes y esta vez la respuesta va solo en texto)"
      : "(nada: no van fichas debajo de tu mensaje)";
  return [
    "LA CONVERSACIÓN:",
    charla || "(es su primer mensaje)",
    "",
    `LO QUE PIDE AHORA: ${texto || "(sin texto)"}`,
    "",
    ...(anuncio ? [anuncio, ""] : []),
    "LO QUE SE LE VA A ENSEÑAR:",
    fichas,
    "",
    `LO QUE PASÓ CON LA BÚSQUEDA: ${paso || "Lo que se le enseña es lo que pidió."}`,
    "",
    `TU BORRADOR: ${borrador || "(vacío)"}`,
    "",
    yaSeConocen ? "[YA SE CONOCEN: no saludes]" : "[PRIMER MENSAJE: conserva la bienvenida del borrador]",
  ].join("\n");
}

// ¿La respuesta promete enseñar algo, o el cliente pidió verlo? (Ver "TE
// LOS MUESTRO TIENE QUE TRAER FOTOS" en atenderMeta.)
const PROMETE_FOTOS =
  /👇|\bte\s+(?:los?|las?)\s+(?:muestro|mando|env[ií]o|paso|enseño)\b|\bte\s+muestro\b|\baqu[ií]\s+(?:tienes|est[aá]n|van|te\s+dejo)\b|\bmira\s+(?:estos|estas|los|las)\b/i;
const PIDE_VER_FOTOS =
  /\b(?:mu[eé]str\w*|ens[eé][ñn]\w*|m[aá]nd(?:a|ame)?(?:los|las|melos|melas)|env[ií]a(?:me)?(?:los|las|melos|melas)|p[aá]sa(?:me)?(?:los|las|melos|melas)|quiero\s+ver\w*|ver(?:los|las)|im[aá]genes|fotos?)\b/i;

function prometeFotos(respuesta, textoDelCliente) {
  // "¿Te muestro alguno?" ofrece, no promete: las frases con pregunta no
  // cuentan.
  const afirma = String(respuesta || "")
    .split(/(?<=[.!?👇😊📱])\s+/)
    .filter((frase) => !frase.includes("?"))
    .join(" ");
  return PROMETE_FOTOS.test(afirma) || PIDE_VER_FOTOS.test(String(textoDelCliente || ""));
}

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

/* ── NINGÚN PRECIO INVENTADO LLEGA AL CLIENTE ──────────────────────

   EL MODELO NO CONOCE NI UN SOLO PRECIO. No es una opinión: los precios
   viven en la hoja y NUNCA se le mandan (ver listaDeTitulos en sheets.js,
   que le pasa el título y la capacidad, y nada más). Así que cualquier
   cifra de dinero que escriba está inventada por definición.

   El prompt se lo prohíbe desde el primer día —"Nunca escribas una cifra.
   Tú no conoces los precios"— pero una prohibición en el prompt es una
   petición, no una garantía: cuando el modelo se la salta, no había nada
   detrás. Y un precio inventado es de los errores más caros que existen:
   el cliente llega a la tienda con una cifra que nadie le va a cobrar.

   Esto es la garantía. Se miran las cifras de dinero del texto y se
   comparan con los precios REALES de lo que se le está mandando:

     · Si coinciden, se quedan (el bot puede repetir un precio correcto).
     · Si no, la frase del modelo se cambia entera por una segura. Las
       fichas van debajo con el precio de verdad, así que el cliente no
       se queda sin la información: se queda sin la mentira.

   Se reconocen "$310", "310$", "310 dólares", "310 usd", "310 bs". Los
   porcentajes NO son precios: la tabla de Cashea habla de porcentajes y
   esa sí la escribe el código.
   ───────────────────────────────────────────────────────────────── */
const CIFRA_DE_DINERO =
  /(?:\$|bs\.?|usd)\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+)|(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+)\s*(?:\$|d[oó]lares?|dolares|usd|bs\b)/gi;

// Lo que se le dice cuando se le quitó una cifra inventada y hay fichas
// debajo: el precio de verdad va en ellas.
const EL_PRECIO_EN_LAS_FICHAS = [
  "¡Claro! Aquí tienes los precios 👇",
  "¡Con gusto! Mira los precios 👇",
  "¡Listo! Te muestro los precios 👇",
];

// Y cuando NO hay fichas que mandar, no se le puede dar ningún precio.
const EL_PRECIO_LO_CONFIRMA_UN_ASESOR =
  "Déjame confirmarte ese precio con un asesor y te escribo en un momento 😊";

function comoNumero(cifra) {
  // "1.250,50" y "1,250.50" son lo mismo: se quita el separador de miles
  // y se deja el decimal en punto.
  const limpio = String(cifra).replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".");
  return Number(limpio);
}

function cifrasDeDinero(texto) {
  const halladas = [];
  for (const trozo of String(texto || "").matchAll(CIFRA_DE_DINERO)) {
    const cifra = trozo[1] ?? trozo[2];
    if (cifra !== undefined) halladas.push(comoNumero(cifra));
  }
  return halladas.filter((n) => Number.isFinite(n));
}

// Los precios que se pueden decir en ESTE mensaje: SOLO los de Cashea, o
// SOLO los de divisas si el cliente los pidió (5-oct-2026, un solo precio).
// El otro existe en la hoja, pero si el modelo lo escribe cuenta como un
// precio que no va, y la respuesta se cambia: así nunca salen los dos.
function preciosDeVerdad(productos, { divisas = false } = {}) {
  const buenos = new Set();

  for (const producto of productos) {
    for (const precio of [divisas ? producto.precio : producto.precioCashea]) {
      for (const numero of cifrasDeDinero(precio)) buenos.add(numero);
      // El precio puede venir sin símbolo en la hoja ("310"), y entonces
      // no lo reconoce el patrón de dinero: se toma el número tal cual.
      const pelado = Number(String(precio || "").replace(/[^\d.,]/g, "").replace(/[.,](?=\d{3}\b)/g, "").replace(",", "."));
      if (Number.isFinite(pelado) && pelado > 0) buenos.add(pelado);
    }
  }

  return buenos;
}

function sinPreciosInventados(texto, productos, { divisas = false, tambien = [] } = {}) {
  const dichas = cifrasDeDinero(texto);
  if (!dichas.length) return texto;

  const verdaderos = preciosDeVerdad([...productos, ...(tambien || [])], { divisas });
  const inventadas = dichas.filter((cifra) => !verdaderos.has(cifra));

  if (!inventadas.length) return texto;

  console.error(
    `PRECIO INVENTADO: el modelo escribió ${inventadas.join(", ")} y no es ` +
      `ninguno de los precios reales (${[...verdaderos].join(", ") || "no hay fichas"}). ` +
      "Le cambio la respuesta."
  );

  if (productos.length) return alAzar(EL_PRECIO_EN_LAS_FICHAS);

  // SIN FICHAS, SE QUITA SOLO LA FRASE DE LA CIFRA (6-oct-2026). "Es un
  // regalo" recibía "Déjame confirmarte ese precio con un asesor": no había
  // preguntado ningún precio. Lo demás que escribió se queda; si no queda
  // nada, la frase del asesor.
  const resto = String(texto)
    .split(/(?<=[.!?😊📱🎁👌🙌])\s+/)
    .filter((frase) => !cifrasDeDinero(frase).some((cifra) => !verdaderos.has(cifra)))
    .join(" ")
    .trim();
  return /[\p{L}]{3}/u.test(resto) ? resto : EL_PRECIO_LO_CONFIRMA_UN_ASESOR;
}

// Los equipos del último carrusel que vio, tal como están hoy en la hoja.
async function ultimosQueVio(env, contacto) {
  const vistos = contacto?.ultimos_productos || [];
  if (!vistos.length) return [];
  const hoja = await catalogoCompleto(env);
  return hoja.filter((p) => vistos.some((t) => despejar(t) === despejar(p.titulo)));
}

// "¿Cuánto cuesta?" y nada más (ver precioSinEquipo).
const PRECIO_A_SECAS = /^[\s¿¡]*(?:hola[\s,!.]*)?(?:(?:y\s+)?cu[aá]nto\s+(?:cuesta|cuestan|vale|valen|sale|salen|es)|(?:qu[eé]\s+)?precios?|cu[aá]l\s+es\s+el\s+precio)[\s?!.]*$/i;
const PRECIO_DE_CUAL =
  "¡Con gusto te digo el precio! 😊 ¿De cuál equipo es? Si lo viste en un anuncio o una publicación, mándamela por aquí y te lo digo al momento 📱";

/* ── EL BOT NO LE CIERRA LA PUERTA A NADIE ─────────────────────────

   Dicho por el dueño (28-sep-2026): "no limites nada con que no vendemos
   iPhone, sí vendemos, es una tienda de tecnología, solo que no lo
   tenemos disponible".

   Tiene razón, y la diferencia no es de tono: es de negocio. El catálogo
   que ve el bot es lo que hay HOY en la hoja, no lo que la tienda vende
   ni lo que puede conseguir. Cuando el modelo escribe "no vendemos eso"
   está afirmando algo que no sabe —y que casi siempre es falso— y con
   eso cierra una conversación que podía terminar en venta.

   El prompt ya se lo dice. Esto es la red: si aun así lo escribe, se le
   cambia por la verdad, que es que hoy no lo tiene disponible y que un
   asesor puede confirmar si se consigue.
   ───────────────────────────────────────────────────────────────── */
const CIERRA_LA_PUERTA =
  /\bno\s+(?:se\s+)?(?:los?\s+|las?\s+|lo\s+|le\s+)?(?:vendemos|vendo|manejamos|manejo|trabajamos|trabajo|distribuimos|comercializamos)\b/i;

function sinCerrarLaPuerta(texto, productos) {
  if (!CIERRA_LA_PUERTA.test(String(texto || ""))) return texto;

  console.error(
    `CERRABA LA PUERTA: el modelo escribió ${JSON.stringify(String(texto).slice(0, 80))}. ` +
      "La tienda vende tecnología: no se dice qué NO se vende, se dice qué no hay HOY."
  );

  // Con fichas debajo, la frase de "ese no, pero mira estos" encaja sola.
  return productos.length ? alAzar(NO_ESE_PERO_MIRA) : alAzar(HOY_NO_DISPONIBLE);
}

// Y EN EL HISTORIAL TAMPOCO.
//
// El historial lo escribe el modelo y se le devuelve en el mensaje
// siguiente, así que una cifra inventada ahí no se queda quieta: vuelve
// una y otra vez, y el modelo la lee como algo que ya dijo la tienda. El
// prompt también lo prohíbe ("Nunca guardes precios"); esto lo garantiza.
function historialSinPrecios(historial) {
  const limpio = String(historial || "").replace(CIFRA_DE_DINERO, "(el precio va en las fichas)");

  if (limpio !== String(historial || "")) {
    console.log("Le quité un precio al historial: ahí no se guardan cifras");
  }
  return limpio;
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
// Lo que, escrito justo DESPUÉS de un nombre, lo convierte en otro equipo:
// "Redmi 17" + "pro max" es otro teléfono que el "Redmi 17".
const OTRO_MODELO_SI_SIGUE = new Set(["pro", "max", "plus", "+", "ultra", "lite", "mini", "fe", "prime", "neo", "turbo", "note"]);

// ¿Dónde está "trozo" en "donde" como palabras enteras? -1 si no está.
function conBordes(donde, trozo) {
  let desde = 0;
  for (;;) {
    const i = donde.indexOf(trozo, desde);
    if (i < 0) return -1;
    const antes = donde[i - 1] || " ";
    const despues = donde[i + trozo.length] || " ";
    if (!/[a-z0-9]/.test(antes) && !/[a-z0-9]/.test(despues)) return i;
    desde = i + 1;
  }
}

function nombraDelCatalogo(texto, productos) {
  const donde = despejar(texto);
  if (!donde || !productos?.length) return "";

  // EL MÁS LARGO GANA, Y "REDMI 17" NO ES "REDMI 17 PRO MAX" (6-oct-2026).
  //
  // EL FALLO: "¿tienen redmi 17 pro max?" encontraba escrito "redmi 17"
  // —que en la hoja es otro teléfono— y se quedaba con ese: le llegaba el
  // Redmi 17, o un "no hay", teniendo el Redmi Note 17 Pro Max. Ahora:
  //   · el nombre tiene que estar como palabras enteras;
  //   · si justo detrás el cliente escribió "pro", "max", "plus"… y el
  //     título no sigue así, NO es ese equipo;
  //   · entre varios, gana el que más texto acierta.
  let mejor = "";
  let largo = 0;

  for (const producto of productos) {
    const titulo = despejar(producto.titulo);
    const palabras = titulo.split(" ");

    // El título entero, y si no, su principio (3 o 2 palabras).
    //
    // El cliente no escribe el título entero. Dice "el Poco M8 en divisas"
    // y en la hoja está como "Poco M8 pro 5G": ni el título completo ni
    // sus tres primeras palabras ("poco m8 pro") aparecen en su mensaje,
    // pero "poco m8" sí. Dos palabras es el mínimo, y solo si juntas miden
    // 6 letras o más: con una sola bastaría un "samsung" suelto para
    // pescar cualquier cosa.
    const intentos = [
      titulo.length >= 4 ? palabras.length : 0,
      ...[3, 2].filter((n) => n < palabras.length && palabras.slice(0, n).join(" ").length >= 6),
    ].filter(Boolean);

    for (const n of intentos) {
      const trozo = palabras.slice(0, n).join(" ");
      const i = conBordes(donde, trozo);
      if (i < 0) continue;
      const siguiente = (donde.slice(i + trozo.length).trim().split(/\s+/)[0] || "").replace(/[^a-z0-9+]/g, "");
      if (OTRO_MODELO_SI_SIGUE.has(siguiente) && siguiente !== (palabras[n] || "")) continue;
      if (trozo.length > largo) {
        mejor = producto.titulo;
        largo = trozo.length;
      }
      break;
    }
  }

  return mejor;
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

// "¿Tienes otros?", "¿qué más modelos hay?": no quiere solo ese.
const PIDE_OTROS = /\b(otros?|otras?|dem[aá]s|m[aá]s\s+(modelos|opciones|equipos|tel[eé]fonos))\b/i;

// ¿El título es EL MISMO equipo que nombra el texto, un pariente, o solo la
// marca? (ver modelo.js). Un producto sin número de modelo —un mouse, un
// cable— no tiene con qué contradecir al texto: si lo nombra, es ese.
//
// Y lo mismo un accesorio, aunque lleve cifras ("Cargador original 45w"):
// el parentesco de modelo.js es para teléfonos, y con un cargador daría
// "familia" por cualquier palabra de menos.
// Lo mismo para lo que escribió el cliente, pero con el número: "band 10"
// o "xiaomi smart band 10" ES el "Reloj Xiaomi Mi band 10" (le faltan
// palabras, no es otro), y "mi band 9" NO lo es (6-oct-2026). En los
// teléfonos manda modelo.js, como siempre.
function relacionDeLoQueEscribio(texto, titulo, hoja = []) {
  // Pidió OTRA clase de cosa ("apple watch" y lo más parecido son unos
  // AirPods): no es pariente de nada.
  const tipoDelTexto = tipoQuePide(texto);
  if (tipoDelProducto(titulo) === "telefono") return parentesco(texto, titulo);
  if (tipoDelTexto && tipoDelTexto !== "telefono" && tipoDelTexto !== tipoDelProducto(titulo)) return "";
  const trozos = (t) => despejar(t).split(/[^a-z0-9]+/).filter(Boolean);
  const delTitulo = new Set(trozos(titulo));
  const enLaHojaHay = new Set(hoja.flatMap((p) => trozos(p.titulo)));
  // Lo que escribió y la hoja conoce tiene que estar en ESTE título: "xiaomi
  // watch" no es la "Mi band 10" (el "watch" es de otro reloj).
  const leFalta = trozos(texto).filter((p) => !/^\d+$/.test(p) && p.length > 2 && enLaHojaHay.has(p) && !delTitulo.has(p));
  const numeros = trozos(texto).filter((p) => /^\d+$/.test(p));
  // No dijo QUÉ es ni un número ("¿tienen iphone?" y sale un cargador de
  // iPhone): eso no es pedir ESE accesorio. Como antes, lo decide modelo.js.
  if ((!tipoDelTexto || tipoDelTexto === "telefono") && !numeros.length) return parentesco(texto, titulo);
  // Dijo la clase y quizá la marca, pero ningún modelo ("soportes xbyte",
  // "cargador samsung 45w"): no es UNO, es la búsqueda de siempre.
  if (!numeros.length) return "";
  if (!partesDelTitulo(titulo)) return leFalta.length ? "familia" : "mismo";
  if (numeros.every((n) => delTitulo.has(n)) && !leFalta.length) return "mismo";
  // Otro número del mismo producto ("mi band 9" y la hoja tiene la 10): es
  // su familia, y se le dice "ese no, pero tengo este".
  return "familia";
}

function relacionConElTexto(texto, titulo) {
  if (!partesDelTitulo(titulo) || tipoDelProducto(titulo) !== "telefono") return "mismo";
  return parentesco(texto, titulo);
}

/* ── EL PANEL DE ANUNCIOS: /anuncios (2-oct-2026) ──────────────────
   Todo lo que hay que saber de los anuncios en una pantalla, en el orden
   en que se arregla: primero si el token sirve, después las alertas
   (anuncios que traen gente a un equipo AGOTADO o que el bot no sabe cuál
   es), y después cada anuncio activo con lo que el bot le manda a quien
   llega y cuántas personas llegaron.
   ───────────────────────────────────────────────────────────────── */
function haceCuanto(ms) {
  if (!ms) return "nunca";
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 60) return `hace ${min} min`;
  if (min < 48 * 60) return `hace ${Math.round(min / 60)} h`;
  return `hace ${Math.round(min / 1440)} días`;
}

const PASOS_DEL_TOKEN = [
  "CÓMO SE SACA EL ADS_TOKEN (una vez, y no caduca):",
  "  1. business.facebook.com → Configuración del negocio → Usuarios →",
  "     Usuarios del sistema → Agregar (rol: Administrador).",
  "  2. En ese usuario: Asignar activos → Cuentas publicitarias → tu cuenta",
  "     → 'Ver rendimiento'. Y también Apps → la app del bot.",
  "  3. Generar token → elige la app del bot → marca ads_read y",
  "     business_management → Caducidad: Nunca.",
  "  4. npx.cmd wrangler secret put ADS_TOKEN   (y pega el token)",
  "",
  "La app y la cuenta publicitaria tienen que estar en el MISMO portafolio",
  "comercial. Si el anuncio se creó desde la app de Instagram (Promocionar),",
  "la cuenta publicitaria igual existe: está en ese portafolio.",
];

async function panelDeAnuncios(env) {
  const lineas = [`ANUNCIOS DE LA TIENDA · ${VERSION}`, ""];
  const token = await revisarTokenDeAnuncios(env);

  lineas.push("EL TOKEN (ADS_TOKEN)");
  if (!token.ok) {
    lineas.push(`  ✗ ${token.problema}`, "", ...PASOS_DEL_TOKEN, "");
  } else {
    lineas.push(
      `  ✓ funciona (${token.quien})` + (token.permisos.length ? ` · permisos: ${token.permisos.join(", ")}` : ""),
      ""
    );
  }

  if (token.cuentas.length) {
    lineas.push("CUENTAS PUBLICITARIAS QUE VE");
    for (const c of token.cuentas) lineas.push(`  ${c.id}  ${c.nombre}${c.estado ? ` (${c.estado})` : ""}`);
    lineas.push("");
  }

  const llegadas = await llegadasPorAnuncio(env.DB);
  const aMano = equiposAsignados(env);
  const hoja = await catalogoCompleto(env);
  const { anuncios, errores } = token.cuentas.length ? await anunciosActivos(env, token.cuentas) : { anuncios: [], errores: [] };
  for (const e of errores) lineas.push(`  ✗ ${e}`);

  const alertas = [];
  const detalle = [];
  anuncios.forEach((a, i) => {
    const puesto = aMano.get(String(a.id).toLowerCase()) || "";
    const { estado, titulo: equipo, dicho } = queEquipoSenala(puesto || `${a.titulo} ${a.texto}`, hoja);
    const llego = llegadas.get(String(a.id));
    const queHace =
      estado === "exacto"
        ? `✓ manda el ${equipo}${puesto ? " (puesto a mano)" : ""}`
        : estado === "agotado"
          ? `⚠ es del "${dicho}", que HOY NO ESTÁ en la hoja: le dice que no está y le muestra ${equipo}`
          : estado === "varios"
            ? "· nombra varios teléfonos: no impone ninguno, mira la imagen y lo que escriba el cliente"
            : `⚠ NO RECONOCE EL EQUIPO: saluda y pregunta. Arréglalo en wrangler.toml:
        ANUNCIOS_EQUIPOS = "${a.id}=Nombre tal como está en la hoja"`;

    if (estado === "agotado") alertas.push(`"${a.nombre}" trae gente al ${dicho}, que está AGOTADO. Páusalo o cámbiale el equipo.`);
    if (!estado) alertas.push(`"${a.nombre}" (${a.id}): el bot no sabe de qué equipo es.`);
    if (puesto && estado !== "exacto") alertas.push(`"${a.nombre}": el equipo puesto a mano ("${puesto}") no está en la hoja.`);

    detalle.push(
      `${i + 1}. ${a.nombre || "(sin nombre)"}${a.campana ? `  ·  campaña: ${a.campana}` : ""}`,
      `     id ${a.id}`,
      `     Dice: ${[a.titulo, a.texto].filter(Boolean).join(" — ").replace(/\s+/g, " ").slice(0, 160) || "(sin texto: el bot mira la imagen)"}`,
      `     ${queHace}`,
      `     Llegaron: ${llego ? `${llego.personas} persona(s), ${llego.semana} esta semana · la última ${haceCuanto(llego.ultima)}` : "nadie todavía"}`,
      ""
    );
  });

  if (alertas.length) lineas.push("⚠ PARA REVISAR", ...alertas.map((x) => `  · ${x}`), "");
  if (token.ok) {
    lineas.push(`ANUNCIOS ACTIVOS (${anuncios.length})`, "");
    lineas.push(...(detalle.length ? detalle : ["  No hay ningún anuncio activo ahora mismo.", ""]));
  }

  // Lo que llegó por anuncios que no están en la lista: ya terminaron, o se
  // contaron por su "ref" o su título (sin token).
  const activos = new Set(anuncios.map((a) => String(a.id)));
  const otros = [...llegadas.entries()].filter(([clave]) => !activos.has(clave));
  if (otros.length) {
    lineas.push("LLEGADAS POR OTROS ANUNCIOS (terminados o sin id)");
    for (const [clave, l] of otros.sort((x, y) => y[1].ultima - x[1].ultima).slice(0, 20)) {
      lineas.push(`  ${clave}: ${l.personas} persona(s) · la última ${haceCuanto(l.ultima)}`);
    }
    lineas.push("");
  }

  lineas.push(
    "PARA PROBAR UNO SOLO: /probar-anuncio?id=ID_DEL_ANUNCIO",
    "EQUIPO A MANO: ANUNCIOS_EQUIPOS en wrangler.toml (id=Equipo | ref=Equipo)",
    ""
  );
  return lineas.join("\n");
}

// QUÉ EQUIPO SEÑALA EL TEXTO DE UN ANUNCIO O UNA PUBLICACIÓN.
//
//   · "exacto":  nombra un equipo que está en la hoja → ese y solo ese.
//   · "agotado": nombra UN modelo que hoy no está (lo más cercano es un
//                pariente o solo la marca) → "ese no, pero mira estos".
//   · "varios":  nombra más de un teléfono → no se impone ninguno.
//   · "":        no nombra nada reconocible.
//
// Lo usan el chat y /probar-anuncio, para que lo que ve el dueño al probar
// un anuncio sea exactamente lo que hará el bot.
function queEquipoSenala(texto, productos) {
  if (telefonosQueNombra(texto, productos) > 1) return { estado: "varios", titulo: "", dicho: "" };

  const titulo = equipoQueNombra(texto, productos);
  if (!titulo) return { estado: "", titulo: "", dicho: "" };

  // Solo el nombre del modelo, sin el resto del anuncio: "3 cuotas" o
  // "$250" no pueden pasar por otro número de modelo.
  const dicho = modeloNombrado(texto, partesDelTitulo(titulo)?.marca);
  if (relacionConElTexto(dicho, titulo) === "mismo") return { estado: "exacto", titulo, dicho };
  if (nombraUnModelo(dicho)) return { estado: "agotado", titulo, dicho };
  return { estado: "", titulo: "", dicho: "" };
}

// Cuántos teléfonos DISTINTOS de la hoja nombra un texto. Para saber si un
// anuncio es de UN equipo o de varios ("Llegaron el A17, el A27 y el A37").
//
// Cuenta el número de modelo de cada teléfono de la hoja cuando aparece en
// el texto con cara de modelo: con letra ("a57", "x8") o justo detrás de
// su marca o su línea ("note 17", "spark 50"). Así el "3" de "3 cuotas" o
// el "250" de un precio no cuentan como teléfonos.
function telefonosQueNombra(texto, productos) {
  const suyas = palabrasDe(texto);
  const vistos = new Set();

  for (const producto of productos) {
    if (tipoDelProducto(producto.titulo) !== "telefono") continue;
    const partes = partesDelTitulo(producto.titulo);
    if (!partes) continue;

    suyas.forEach((palabra, i) => {
      if (palabra !== partes.numero) return;
      const antes = suyas[i - 1];
      const conCara = /[a-z]/.test(palabra) || antes === partes.marca || partes.linea.includes(antes);
      if (conCara) vistos.add(`${partes.marca} ${palabra}`);
    });
  }

  return vistos.size;
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

// La bienvenida ENTERA, para conservarla: "¡Hola María! Soy la asistente
// virtual de EPICCELL 👋". (PRESENTACION sirve para quitarla, pero corta en
// "de" y se deja fuera el nombre de la tienda.)
const SU_BIENVENIDA =
  /^\s*[¡!]*\s*hola\b[^\n]{0,25}?\bsoy\s+(la|el)\s+asistente(\s+virtual)?(\s+de\s+(?:la\s+tienda|[\p{L}\d]+))?[\s.!,]*[👋😊🙌]?/iu;

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
async function decidir({ env, salida, texto, historialPrevio, senalado = "", productoAnuncio = null, recientes = [] }) {
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

  /* ── LO QUE ESCRIBIÓ EL CLIENTE MANDA SOBRE LO QUE ESCRIBIÓ EL MODELO

     Dos fallos vistos en producción el 29-sep-2026, los dos con la misma
     pregunta: "¿Tienes redmi 17?".

       1. Con el Redmi 17 en la hoja, el modelo buscó "Redmi Note 17" —la
          palabra que le sonaba— y el cliente recibió otro teléfono.
       2. Con el Redmi 17 AGOTADO, el bot contestó "¡Claro! Te muestro los
          Redmi Note 17", como si fueran el mismo. No lo son.

     Lo que el cliente escribió se compara con el equipo más cercano de la
     hoja (ver modelo.js) y sale una de tres cosas:

       · ES EL MISMO: se busca ese, aunque el modelo haya decidido otra
         cosa, y se enseña con sus versiones (Pro, Pro Max) pero sin los
         que solo se llaman parecido.
       · ES UN PARIENTE, o solo la misma marca, y él pidió un modelo
         concreto: lo que pidió NO ESTÁ. Se le dice, nombrando las dos
         cosas, y se le enseña la familia o la marca.
       · Nada: el camino de siempre.
     ───────────────────────────────────────────────────────────────── */
  const enLaHoja = await catalogoCompleto(env);
  const loQueEscribio = equipoQueNombra(texto, enLaHoja);

  // EL EQUIPO DEL ANUNCIO CUENTA COMO SI LO HUBIERA ESCRITO (30-sep-2026).
  //
  // El dueño: "las personas que vienen de los anuncios no responde bien,
  // no manda las imágenes exactas". El anuncio era del Poco X8 y el
  // cliente llega con el mensaje de Meta —"¡Hola! Quiero más
  // información"—, que no nombra nada. El modelo buscaba "Poco" (y salían
  // los tres Poco) o no buscaba nada y preguntaba "¿qué equipo buscas?" a
  // alguien que acababa de verlo en pantalla.
  //
  // Si el anuncio (o la publicación compartida) nombra un equipo de la
  // hoja, y el cliente NO nombró otro, es ESE. Si nombró otro, manda él.
  //
  // Y con él vale lo mismo que con lo que escribe el cliente: si el del
  // anuncio se agotó, se le dice por su nombre y se le enseña lo parecido.
  const textoDelAnuncio = !loQueEscribio && senalado ? senalado : "";
  const delAnuncio = textoDelAnuncio ? equipoQueNombra(textoDelAnuncio, enLaHoja) : "";
  const elQuePidio = loQueEscribio || delAnuncio;
  // Dónde se nombró: en su mensaje o en el anuncio.
  const dondeLoNombro = loQueEscribio ? texto : textoDelAnuncio;
  const relacion = loQueEscribio
    ? relacionDeLoQueEscribio(texto, loQueEscribio, enLaHoja)
    : delAnuncio
      ? relacionConElTexto(textoDelAnuncio, delAnuncio)
      : "";
  // El del anuncio, cuando está en la hoja: ese y solo ese.
  const elDelAnuncio = delAnuncio && relacion === "mismo" ? delAnuncio : "";

  // Si el modelo escribió el texto pensando en otro equipo, ese texto ya no
  // sirve: se le cambia por uno que no nombre ningún modelo.
  let elModeloHablabaDeOtro = false;
  // Lo que pidió, cuando no está y se le ofrece un pariente: "Redmi 17".
  let noEstaElQuePidio = "";
  // Y cómo se le llama a lo que se le ofrece: la familia ("redmi note 17",
  // dos palabras o más) o la marca ("poco").
  let loQueSeLeOfrece = "";

  if (relacion === "mismo") {
    const suyo = terminoDeTitulo(elQuePidio);

    // Vale lo del modelo SOLO si es igual o MÁS concreto que lo que
    // escribió el cliente ("Samsung A57 256GB" cuando dijo "Samsung A57").
    // Si es más vago —"Poco" cuando dijo "Poco C81"— o apunta a otro
    // equipo, gana el cliente.
    const partes = partesDelTitulo(elQuePidio);
    const raiz = partes ? [partes.marca, ...partes.linea, partes.numero].join(" ") : despejar(suyo);
    const valeElDelModelo = termino && despejar(termino).includes(raiz);

    if (!valeElDelModelo) {
      console.log(
        `El cliente nombró "${elQuePidio}" y el modelo iba a buscar ` +
          `"${termino || "nada"}": mando lo que él escribió.`
      );
      // Con el del anuncio, además, cuenta el "no buscar nada": su texto
      // ("¿qué equipo buscas?") no sirve si va el equipo debajo.
      elModeloHablabaDeOtro = Boolean(termino) || Boolean(elDelAnuncio);
      termino = suyo;
    }
  } else if ((relacion === "familia" || relacion === "marca") && nombraUnModelo(dondeLoNombro)) {
    // (El del anuncio ya llega como nombre limpio: "Poco X8 Pro 5G".)
    noEstaElQuePidio = loQueEscribio ? loQuePidioDicho(texto) : textoDelAnuncio;
    loQueSeLeOfrece =
      relacion === "familia" ? raizDeLaFamilia(dondeLoNombro, elQuePidio) : partesDelTitulo(elQuePidio).marca;

    console.log(
      `Pidió "${noEstaElQuePidio}" y no está: lo más cercano es "${elQuePidio}" ` +
        `(${relacion === "familia" ? "de su familia" : "de su marca"}). Se lo digo y le enseño "${loQueSeLeOfrece}".`
    );

    elModeloHablabaDeOtro = Boolean(termino);
    termino = loQueSeLeOfrece;
  }

  // SIGUE EL TEMA (6-oct-2026, dueño: "si le estoy pidiendo relojes y le
  // digo '¿y los redmi?', seguimos hablando de relojes"). Si lo último que
  // vio era UNA clase de accesorio (relojes, cargadores, soportes…) y ahora
  // escribe solo una marca, corto y sin decir qué es, se busca ESA clase de
  // esa marca. Si no hay, se le dice y se le enseña lo que hay de esa clase.
  const tipoDeLaCharla = (() => {
    const tipos = [...new Set((recientes || []).map((p) => tipoDelProducto(p.titulo)))];
    return tipos.length === 1 && tipos[0] !== "telefono" ? tipos[0] : "";
  })();
  const sigueElTema =
    Boolean(tipoDeLaCharla) &&
    !tipoQuePide(texto) &&
    !/\d/.test(texto) &&
    String(texto || "").trim().split(/\s+/).length <= 6;
  if (sigueElTema && !termino) {
    const marca = String(texto || "")
      .toLowerCase()
      .replace(/[^a-záéíóúñ0-9\s]/gi, " ")
      .split(/\s+/)
      .filter((p) => p && !RELLENO_DEL_SEGUIMIENTO.has(p))
      .join(" ");
    if (marca) termino = marca;
  }
  if (sigueElTema && termino) console.log(`Sigue hablando de ${tipoDeLaCharla}: "${texto}" se busca como ${tipoDeLaCharla} de "${termino}"`);
  // Lo que se le dice si de esa marca no hay de esa clase.
  let otraCasaDelTipo = "";
  let deEsaMarcaNoHay = "";

  let productos = [];
  let hayMas = false;
  if (termino) {
    // "¿Tienen relojes xiaomi?" y la IA busca "xiaomi": salían teléfonos.
    // Si el término es solo una marca y el cliente dijo QUÉ es (reloj,
    // cargador…), se buscan solo cosas de ese tipo (6-oct-2026).
    const tipoDelCliente = tipoQuePide(texto);
    const soloMarca = !tipoQuePide(termino) && !/\d/.test(termino);
    const conSuTipo =
      tipoDelCliente && tipoDelCliente !== "telefono" && soloMarca
        ? { tipo: tipoDelCliente }
        : sigueElTema && soloMarca
          ? { tipo: tipoDeLaCharla }
          : {};
    ({ productos, hayMas } = await buscarProductos(env, termino, 10, conSuTipo));
    if (conSuTipo.tipo) console.log(`Buscó "${termino}" y el cliente pidió ${conSuTipo.tipo}: solo eso`);

    // De esa marca no hay de esa clase. Redmi y Poco son de la casa Xiaomi:
    // un reloj "Redmi" que no hay puede ser un reloj Xiaomi que sí.
    const tipoBuscado = conSuTipo.tipo || (tipoQuePide(termino) !== "telefono" ? tipoQuePide(termino) : "");
    if (!productos.length && tipoBuscado) {
      const marcaPedida = palabrasDe(termino).find((p) => ["redmi", "poco"].includes(p));
      if (marcaPedida) {
        const deLaCasa = await buscarProductos(env, termino.replace(new RegExp(marcaPedida, "i"), "xiaomi"), 10, { tipo: tipoBuscado });
        if (deLaCasa.productos.length) {
          productos = deLaCasa.productos;
          hayMas = deLaCasa.hayMas;
          otraCasaDelTipo = `${nombreDelTipo(tipoBuscado)}|${marcaPedida}`;
          console.log(`No hay ${tipoBuscado} ${marcaPedida}: le enseño los de Xiaomi, la misma casa`);
        }
      }
      if (!productos.length && (sigueElTema || conSuTipo.tipo)) {
        const delTipo = (await catalogoCompleto(env)).filter((p) => tipoDelProducto(p.titulo) === tipoBuscado);
        if (delTipo.length) {
          productos = delTipo.slice(0, 10);
          hayMas = delTipo.length > 10;
          // La marca sola, sin la palabra de la clase: "Relojes Samsung", no
          // "Relojes Reloj Samsung".
          const soloLaMarca = termino.split(/\s+/).filter((p) => !tipoQuePide(p)).join(" ");
          deEsaMarcaNoHay = `${nombreDelTipo(tipoBuscado)}|${loQuePidioDicho(soloLaMarca) || soloLaMarca}`;
          console.log(`No hay ${tipoBuscado} de "${termino}": le digo y le enseño los ${delTipo.length} que hay`);
        }
      }
    }
    console.log(
      productos.length
        ? `Busqué "${termino}": ${productos.length} resultado(s)${hayMas ? " (y hay más)" : ""}`
        : `Sin resultados para "${termino}"`
    );
  }

  // Si lo que pidió no está, la familia se ordena por parecido: al que pidió
  // un Redmi 17 le va primero el Redmi Note 17, no el Redmi A7.
  if (noEstaElQuePidio && productos.length > 1) {
    productos = ordenarPorParecido(productos, dondeLoNombro);
  }

  // Y SI NOMBRÓ UN MODELO EXACTO, VA ESE — CON SUS VERSIONES, SIN LOS PARECIDOS.
  //
  // "Redmi 17" encuentra también "Redmi Note 17": las dos palabras están en
  // los dos títulos. Pero son teléfonos distintos, y quien escribió "Redmi
  // 17" no dijo "Note". Se quedan los que EMPIEZAN por el modelo que nombró
  // —el Redmi 17 y, si hubiera, el Redmi 17 de 256—, que es su familia de
  // verdad. Si el filtro dejara la búsqueda vacía, no se aplica.
  // (Solo en teléfonos: "cargador samsung 45w" son el original Y el
  // certificado, los dos de 45W, no "el que más se parece".)
  if (relacion === "mismo" && productos.length > 1 && tipoDelProducto(elQuePidio) === "telefono") {
    // La raíz es MARCA + LÍNEA + NÚMERO, sin la capacidad: el A57 de 128 y
    // el de 512 son el mismo modelo y los dos se quedan.
    const partes = partesDelTitulo(elQuePidio);
    const raiz = partes
      ? [partes.marca, ...partes.linea, partes.numero].join(" ")
      : despejar(elQuePidio);
    let suyos = productos.filter((p) => despejar(p.titulo).startsWith(raiz));
    // Y con SUS variantes: "pro max" es el Pro Max, no el Pro (6-oct-2026).
    const conSusVariantes = suyos.filter((p) => mismasVariantes(texto, p.titulo) !== false);
    if (conSusVariantes.length) suyos = conSusVariantes;

    if (suyos.length && suyos.length < productos.length) {
      console.log(
        `Pidió "${elQuePidio}": dejo ${suyos.length} y aparto ${productos.length - suyos.length} ` +
          "que se llaman parecido pero son otro modelo"
      );
      productos = suyos;
      hayMas = false;
    }
  }

  // DEL ANUNCIO, EL EQUIPO EXACTO: ni los Pro Max del Pro ni los demás de
  // la marca. Todas sus filas sí (el mismo equipo en 128 y en 256 es el
  // mismo anuncio). Si se agotó, esto no deja nada y se sigue con lo que
  // haya encontrado la búsqueda: su familia, con el "ese no, pero mira".
  if (elDelAnuncio && productos.length > 1) {
    // Sin la capacidad: si la hoja algún día trae "A57 256GB" y "A57
    // 512GB" como títulos aparte, son el mismo equipo del anuncio.
    const sinGigas = (t) => despejar(t).replace(/\b\d+\s*(gb|tb)\b/g, "").replace(/\s+/g, " ").trim();
    const exactos = productos.filter((p) => sinGigas(p.titulo) === sinGigas(elDelAnuncio));
    if (exactos.length && exactos.length < productos.length) {
      console.log(`Del anuncio: dejo solo "${elDelAnuncio}" (${exactos.length} de ${productos.length})`);
      productos = exactos;
      hayMas = false;
    }
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

    // Si dijo QUÉ es ("holder", "cargador"), la referencia no puede traer
    // otro tipo: "holder para el carro" no es un cargador de carro.
    // ("teléfono" no cuenta: "algo para poner el teléfono en la moto" pide
    // un accesorio PARA el teléfono.)
    const tipoDelTexto = tipoQuePide(texto) === "telefono" ? "" : tipoQuePide(texto);
    const otroTipo = referencia && tipoDelTexto && tipoQuePide(referencia) && tipoQuePide(referencia) !== tipoDelTexto;
    if (otroTipo) console.log(`"${referencia}" no es ${tipoDelTexto}, que es lo que pidió: no lo uso`);

    if (referencia && !otroTipo && referencia.toLowerCase() !== termino.toLowerCase()) {
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
  // (Y el de la charla, si sigue el tema: "¿y los honor?" después de los
  // relojes pide relojes, no "teléfonos de esa marca".)
  const tipoPedido = tipoQuePide(`${texto} ${termino}`) || (sigueElTema ? tipoDeLaCharla : "");

  //
  // PRIMERO LA FAMILIA, DESPUÉS LA MARCA (29-sep-2026, pedido del dueño:
  // "que muestre estos que son la misma familia, o estos que se parecen").
  //
  // Antes se probaban las palabras sueltas de izquierda a derecha, así que
  // "Redmi Note 20" se rescataba con "redmi" y traía TODOS los Redmi —el
  // Pad, la afeitadora— cuando lo que el cliente quería era un Note. Ahora
  // se prueba de lo más concreto a lo más general: primero el término sin
  // la última palabra ("redmi note", que es la familia), después sin las
  // dos últimas, y solo al final palabra por palabra.
  //
  // Lo que se rescató se guarda en porCategoria, y con cuántas palabras:
  // dos o más es "la misma familia"; una sola es "la misma marca". De ahí
  // sale lo que se le dice al cliente.
  let porCategoria = "";

  if (!productos.length && /\s/.test(termino)) {
    const palabras = termino.split(/\s+/).filter(Boolean);

    const candidatos = [];
    // "redmi note 20" → "redmi note" → "redmi"
    for (let cuantas = palabras.length - 1; cuantas >= 1; cuantas--) {
      candidatos.push(palabras.slice(0, cuantas).join(" "));
    }
    // Y al final, cada palabra por su cuenta: "forro samsung a57" no tiene
    // ningún prefijo que valga, pero "samsung" sí.
    for (const palabra of palabras) {
      if (palabra.length >= 3 && !candidatos.includes(palabra)) candidatos.push(palabra);
    }

    for (const candidato of candidatos) {
      const intento = await buscarProductos(env, candidato, 10, { tipo: tipoPedido });
      if (!intento.productos.length) continue;

      // LO MÁS PARECIDO, PRIMERO. Quien pide un "Redmi Note 20" tiene que
      // ver el Note 17 en la primera ficha, no el A7 pro.
      productos = ordenarPorParecido(intento.productos, termino);
      hayMas = intento.hayMas;
      porCategoria = candidato;
      console.log(
        `Sin resultados para "${termino}": le enseño los de "${candidato}" ` +
          `(${productos.length}), con foto y precio`
      );
      break;
    }
  }

  // PARA EL CARRO, PARA LA MOTO (6-oct-2026, ver usoQuePide en tipos.js).
  // "Soporte para moto" ya no trae las bases para carro: si el título dice
  // para qué es, va solo lo de su uso. Si ninguno lo dice, van todos.
  const uso = usoQuePide(`${texto} ${termino}`);
  // Y si de ese uso no queda ninguno (la de moto con Cantidad 0), se le dice
  // así, en vez de "¡claro, mira!" con las de carro.
  let noHayParaSuUso = "";
  if (uso && productos.length) {
    const paraEso = productos.filter((p) => sirveParaElUso(p.titulo, uso));
    if (paraEso.length && paraEso.length < productos.length) {
      console.log(`Lo quiere para ${uso}: dejo ${paraEso.length} de ${productos.length}`);
      productos = paraEso;
      hayMas = false;
    } else if (!paraEso.length && productos.some((p) => USOS_CON_NOMBRE.some((u) => sirveParaElUso(p.titulo, u)))) {
      noHayParaSuUso = uso;
      console.log(`Lo quiere para ${uso} y ahora no hay de eso: se lo digo y le enseño lo que hay`);
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

  // ¿Lo que pide es de otro rubro? Solo cuenta si no se encontró nada: con
  // producto delante, el producto manda.
  const deOtroNegocio = esDeOtroNegocio(texto);

  if (deOtroNegocio && !productos.length) {
    console.log(`"${deOtroNegocio}" no es de esta tienda: se lo digo, no lo mando al asesor`);
  }

  // No pidió ningún accesorio y todo lo que salió son accesorios: pidió un
  // teléfono de una marca de la que solo tenemos cosas para el teléfono.
  const soloAccesorios =
    !tipoPedido &&
    productos.length > 0 &&
    productos.every((producto) => tipoDelProducto(producto.titulo) !== "telefono");

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
  // SI HUBO QUE RESCATAR LA BÚSQUEDA, NO ES LO QUE PIDIÓ (29-sep-2026).
  //
  // EL FALLO: "¿tienen el Redmi Note 20?" contestaba "¡Por supuesto! Te lo
  // muestro 👇" con siete Redmi debajo, ninguno un Note 20. La culpa era
  // de este reconocimiento: "redmi note" —las dos primeras palabras del
  // título "Redmi Note 17"— aparecen en su mensaje, así que se daba por
  // hecho que el carrusel traía lo suyo. Pero el número es el equipo: un
  // 20 no es un 17.
  //
  // Cuando la búsqueda exacta falló y hubo que rescatarla por categoría,
  // lo que pidió NO está, por definición. Ahí manda la frase de "ese no,
  // pero tengo este".
  const loQuePidio = productos.length && !porCategoria ? nombraDelCatalogo(texto, productos) : "";

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

  // LAS CIFRAS QUE EL MODELO NO PUEDE CONOCER SE VAN AQUÍ, antes que nada
  // más: lo que se mira debajo (que no diga "no hay", la bienvenida
  // repetida) tiene que mirar el texto que de verdad va a salir.
  const sinInventos = sinCerrarLaPuerta(
    // Los precios del equipo del anuncio también son de verdad: la IA los
    // tiene delante y puede decirlos.
    // Y los del último carrusel que vio: puede repetir un precio que ya le
    // enseñamos ("el Redmi 15c que te mostré está en $182") sin fichas.
    sinPreciosInventados(salida.respuesta, productoAnuncio ? [...productos, productoAnuncio] : productos, { divisas: PREGUNTA_DIVISAS.test(texto), tambien: recientes }),
    productos
  );

  // Si ya se conocen, se le quita la bienvenida aunque el modelo la haya
  // escrito. Es el fallo que más se nota: saludar dos veces.
  const respuestaFinal = historialPrevio ? sinBienvenida(sinInventos) : sinInventos;

  // El orden va de lo más concreto a lo más general. La respuesta que
  // escribió el modelo queda última porque él no vio el resultado de la
  // búsqueda: no sabe en qué capacidades quedó el equipo ni si hubo algo.
  let respuestaCliente = respuestaFinal;

  // Cuando la frase del modelo se cambia por una del código, la bienvenida
  // que él escribió se queda si es el primer mensaje: a quien llega de un
  // anuncio se le saluda antes de enseñarle el equipo.
  const saludoDelModelo = historialPrevio ? "" : (respuestaFinal.match(SU_BIENVENIDA)?.[0] || "").trim();
  const conSuSaludo = (frase) => [saludoDelModelo, frase].filter(Boolean).join(" ");

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
  } else if (otraCasaDelTipo && productos.length) {
    const [clase, marca] = otraCasaDelTipo.split("|");
    respuestaCliente = conSuSaludo(`${mayuscula(clase)} ${mayuscula(marca)} como tal no tengo, pero de Xiaomi, que es la misma casa, mira lo que hay 👇`);
  } else if (deEsaMarcaNoHay && productos.length) {
    const [clase, marca] = deEsaMarcaNoHay.split("|");
    respuestaCliente = conSuSaludo(`${mayuscula(clase)} ${mayuscula(marca)} no tengo ahora mismo 😕 Pero mira los ${clase} que sí tengo 👇`);
  } else if (noHayParaSuUso && productos.length) {
    const queEs = nombreDelTipo(tipoPedido || tipoDelProducto(productos[0].titulo));
    respuestaCliente = conSuSaludo(`${queEs.charAt(0).toUpperCase()}${queEs.slice(1)} para ${noHayParaSuUso} no me quedan ahora mismo 😕 Pero mira estos que sí tengo 👇`);
  } else if (noEstaElQuePidio && productos.length) {
    // Lo que pidió no está: se le dice, nombrando las dos cosas, antes de
    // que ninguna otra frase le diga "¡claro, aquí lo tienes!".
    respuestaCliente = conSuSaludo(noEsePeroMira(noEstaElQuePidio, productos, loQueSeLeOfrece));
  } else if (elModeloHablabaDeOtro && productos.length) {
    // Escribió su respuesta para un equipo distinto del que pidió el
    // cliente ("te muestro los Redmi Note 17" cuando pidió el Redmi 17).
    // Las fichas de abajo ya dicen cuál es: arriba va una frase que no
    // nombre ningún modelo.
    //
    // Si es su primer mensaje, la bienvenida que escribió el modelo se
    // queda: a quien llega de un anuncio se le saluda antes del equipo.
    respuestaCliente = conSuSaludo(alAzar(SI_LO_TENGO));
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
  } else if (soloAccesorios) {
    respuestaCliente = alAzar(SOLO_ACCESORIOS_DE_ESO);
  } else if (porCategoria) {
    // Lo que escribió el modelo no vale aquí: él creía que no había nada
    // que enseñar, o peor, iba a recitar la lista. Hay fotos que mandar.
    respuestaCliente = noEsePeroMira(termino, productos, porCategoria);
  } else if (deOtroNegocio && !productos.length) {
    // No es que se haya agotado: no es de esta tienda.
    const frase = alAzar(ES_DE_OTRO_NEGOCIO);
    // Con mayúscula solo si abre la frase: "Uy, Neveras no es lo nuestro"
    // se lee mal.
    const eso = frase.startsWith("{eso}") ? comoLoPidio(deOtroNegocio) : deOtroNegocio;
    respuestaCliente = frase.replace("{eso}", eso);
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

// UN SOLO PRECIO (5-oct-2026, decisión del dueño: "solo da 1 precio, el de
// Cashea; en divisas solo si lo preguntan; no asumas cosas que no sabes").
//
//   · Por defecto → SOLO el precio con Cashea.
//   · Pidió el precio en divisas / dólares → SOLO el de divisas.
//   · NUNCA los dos juntos (antes, al preguntar por Cashea, salían los dos).
//   · Si el precio que toca no está en la hoja → "te lo confirma un asesor".
//     Nunca el otro en su lugar: sería dar un precio que no pidió.
// "conCashea" se acepta y no cambia nada: así ningún camino viejo puede
// volver a sacar los dos.
// La etiqueta que va PEGADA al monto cuando el cliente pidió divisas: sin
// ella, el cliente no sabe que es el precio que acaba de pedir.
const ETIQUETA_DIVISA = "Precio DIVISA";
const SIN_PRECIO = "Precio: te lo confirma un asesor";
const SIN_PRECIO_DIVISA = "Precio en divisas: te lo confirma un asesor";

function precioParaMostrar(producto, conCashea, conDivisas) {
  // EL SÍMBOLO LO PONE EL BOT, NO LA HOJA (28-sep-2026): en la hoja los
  // precios son números pelados ("170"); debajo de una foto, "$170". Si
  // algún día la hoja trae el símbolo, se respeta tal cual.
  if (conDivisas) {
    const enDivisas = conMoneda(producto?.precio);
    return enDivisas ? `${enDivisas} · ${ETIQUETA_DIVISA}` : SIN_PRECIO_DIVISA;
  }
  return conMoneda(producto?.precioCashea) || SIN_PRECIO;
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
