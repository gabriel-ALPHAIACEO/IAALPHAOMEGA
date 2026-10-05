// Cerebro del bot de ventas de EL EMPERADOR (calzado).
//
// 19-sep-2026: se retiró ManyChat. Antes había DOS apps recibiendo el mismo
// webhook de Meta —la de ManyChat y esta— y cada una respondía por su
// cuenta, lo que mandaba el mensaje duplicado al cliente. Intentar
// coordinarlas (que una le pasara datos a la otra) chocó con que la API de
// ManyChat no acepta el igsid de Instagram para identificar a un
// subscriber, así que no había forma confiable de avisarle "ya contesté
// yo". La solución de fondo es que haya una sola app: este Worker habla
// directo con la API de Instagram, de punta a punta, y guarda su propia
// memoria de cada conversación en D1 (ver estado.js) en vez de depender de
// los campos de otro sistema.
//
// 21-sep-2026: se borraron manychat.js y manychat-campo.js, ya sin uso.
//
// 22-sep-2026: la identificación de fotos se separó en dos pasos. Antes
// una sola llamada de visión describía la foto Y redactaba la respuesta
// para el cliente. Ahora identificarEnImagen() (ia.js) SOLO identifica —
// rasgos y "buscar"—, esa identificación se verifica en identificar.js, y
// lo que sale de ahí se le entrega a la IA de texto como un dato más del
// contexto: es ella quien redacta, con el mismo tono que usa siempre. Por
// eso ya no existe responderImagen(): todo mensaje, tenga foto o no, pasa
// por responderTexto().
//
// OJO si aparecen archivos extraños en la carpeta de despliegue: existió en
// paralelo otra versión de ESTE MISMO bot (repo estherzzerpa/
// challenge-javascript) donde ManyChat seguía siendo el canal y la memoria
// vivía en KV. Si ves un memoria.js o un nombre.js sueltos, son de esa otra
// versión y NO van con este código — mezclarlos rompe el arranque.

import { responderTexto, identificarEnImagen, quienAtiende, claveDe } from "./ia.js";
import {
  revisarPagos,
  metodosDePago,
  bloqueDeMetodos,
  tasaDePago,
  hayMetodosDePago,
  listaDeMetodos,
  preguntaPorMetodos,
  pideDatosDePago,
} from "./pagos.js";
import {
  hayCashea,
  preguntaPorCashea,
  casheaVigente,
  CASHEA_FUERA_DE_FECHA,
  fechasDeLaPromocion,
  nivelDelCliente,
  nivelEnElHistorial,
  notaDeNivel,
  tarjetaCashea,
  revisarCashea,
  ASESOR_CONFIRMA_MONTOS,
  hayTablaCashea,
} from "./cashea.js";
import {
  queDatoPide,
  RESPUESTAS,
  nombraUnProducto,
  revisarDatoDeLaTienda,
  notaDeDatoDeLaTienda,
  datosParaElPrompt,
} from "./datos.js";
import { hayQueRescatar, FRASE_DE_RESCATE, MOTIVO_DE_RESCATE } from "./rescate.js";
import { revisarTono } from "./tono.js";
import {
  hayUbicacion,
  mensajeDeUbicacion,
  preguntaPorUbicacion,
  soloPreguntaUbicacion,
  NOTA_UBICACION_ENVIADA,
} from "./ubicacion.js";
import { gastoDelMes } from "./gasto.js";
import { buscarProductos } from "./shopify.js";
import { categoriaDeLaBusqueda, CATEGORIAS, emojiDe, categoriasParaElPrompt } from "./categorias.js";
import { atenderPanel, anotarTurno, anotarMensaje, atenderApiCentral } from "./panel.js";
import { vigilarErrores, guardarErrores, vigilarQueja } from "./registro.js";
import { revisarTurno } from "./revisor.js";

// Los errores que salgan de aquí en adelante quedan guardados para el panel
// central (ver registro.js).
vigilarErrores();
import { usaDrive, catalogoDeDrive, idDeCarpeta, leerUnTrozoDeDrive } from "./drive.js";
import { avisarAsesor } from "./aviso.js";
import { anotar, leerRastro, hace } from "./rastro.js";
import { conPresupuesto, limiteDeSubpeticiones } from "./presupuesto.js";
import { paginaDePrivacidad, paginaDeEliminacion, html200 } from "./legal.js";
import { esSoloSaludo, saludoDeVuelta } from "./saludo.js";
import { pideElCatalogo, pideMasVariedad, fraseDeCatalogo, corregirBusquedaDeBotas } from "./catalogo.js";
import { alternativasPara } from "./parecidos.js";
import { separarColor, filtrarPorColor, terminoDeColor, nombreDeColor } from "./color.js";
import { comoDataUri } from "./imagen.js";
import { validarIdentificacion } from "./identificar.js";
import { cotejoPorImagen, ordenarPorLaFoto } from "./cotejo.js";
import { leerIndice, indexarTanda } from "./indice.js";
import { contextoParaElModelo, recortarHistorial } from "./historial.js";
import {
  cargarContacto,
  guardarContacto,
  marcarEnvio,
  pausar,
  despausar,
  estaPausado,
  esEcoPropio,
  envioReciente,
  yaLoVio,
  conProductosMostrados,
  revisarBase,
  asegurarColumnas,
  guardarPerfil,
  comoSeLlama,
} from "./estado.js";
import {
  firmaValida,
  leerMensaje,
  enviarTexto,
  enviarFichas,
  enviarBotonCatalogo,
  enviarBotonEnlace,
  enviarTarjeta,
  revisarImagen,
  obtenerPerfil,
  fotogramaDeHistoria,
  cuentaDelToken,
  suscripcionDeLaCuenta,
  suscribirLaCuenta,
  CAMPOS_DEL_WEBHOOK,
} from "./instagram.js";

// Se sube a mano en cada entrega, y sale en /estado. Existe por una razón
// muy concreta: los archivos se copian a mano a la carpeta de despliegue,
// así que "ya lo pegué" y "ya está desplegado" no son lo mismo. Con esto se
// comprueba en diez segundos cuál de las dos cosas pasó.
const VERSION = "2026-10-05 (39) · ALPHA IA: diseño nuevo, logo, fotos y carrusel en el panel (y precios de Drive con talla 40-45)";

// Lo que se dice cuando la búsqueda no devuelve nada. No afirma que el
// producto no exista ni promete reposición: eso era lo que hacía el módulo
// "no disponible" de Make. Y como lleva "en un momento", dispara el aviso.
const SIN_RESULTADOS =
  "Déjame confirmarte ese modelo con un asesor y te escribo en un momento 😊 " +
  "Mientras, aquí tienes el catálogo completo";

// Pidió algo concreto de una categoría ("bolsos Gucci") que no hay, pero sí
// hay otros de esa categoría: se le enseñan, diciéndole la verdad.
const OTROS_DE_LA_CATEGORIA = [
  "De ese no tengo ahora mismo 😕 Pero mira estos {cosa} que sí tenemos {emoji}👇",
  "Ese justo no me queda, pero te muestro los {cosa} que hay {emoji}👇",
  "De ese no hay por ahora 😅 Échale un ojo a estos {cosa} {emoji}👇",
];

// La talla la confirma una persona: el catálogo no guarda qué tallas quedan.
const SOLO_TALLA = "Eso te lo confirma un asesor en un momento 😊";

// Cuando el cotejo visual encontró en el catálogo el zapato de la foto.
//
// Sustituye a lo que escribió la IA de texto, que en este punto casi
// siempre es una pregunta ("¿sabes cómo se llama?") o un "mira esta
// marca": la marcaFoto que recibió decía que no se reconoció el modelo,
// porque el cotejo corre DESPUÉS de que ella redactó. La foto ya nos lo
// dijo, así que se lo enseñamos en vez de preguntárselo.
//
// Ninguna afirma el modelo por su nombre —el título va en la ficha,
// debajo— ni promete talla o stock, que eso no lo sabemos.
const ENCONTRE_EL_DE_LA_FOTO = [
  "¡Ese sí lo tenemos! 😍 Mira 👇",
  "¡Claro que sí! Es este 👟 Te lo muestro 👇",
  "¡Lo encontré! 😊 Aquí lo tienes 👇",
  "¡Ese mismo lo manejamos! 👟 Mira 👇",
];

// NO SE RECONOCIÓ EL CALZADO DE LA FOTO.
//
// Ninguna dice "no sé" ni le pide el nombre: le abren el catálogo, que es
// lo que puede mirar él mismo. Antes aquí se le enseñaban los seis del
// índice que más se parecían, y acababan siendo siempre los mismos seis
// —ninguno el suyo—. Seis fichas equivocadas parecen una respuesta, y por
// eso son peores que mandarlo a mirar.
const NO_SE_CUAL_ES = [
  "Ese no lo tengo a mano ahora mismo 😅 Pero mira el catálogo completo 👇 y dime cuál es",
  "Échale un ojo al catálogo completo 👇 Cuando lo veas, dime cuál y te paso el precio 😊",
  "Aquí tienes todo lo que manejamos 👇 Búscalo con calma y me dices cuál es 👟",
  "Mira el catálogo entero 👇 Dime cuál de esos es y te lo muestro con su precio",
];

// LA FOTO ERA LA TIENDA ENTERA, NO UN ZAPATO.
//
// El dueño publica historias enseñando el local: estantes llenos, mesas
// con veinte pares, vídeos recorriendo la tienda. El bot elegía uno "el
// que sale más grande" y le mandaba al cliente calzados que no tenían
// nada que ver con lo que estaba mirando.
//
// Aquí el catálogo completo SÍ es la respuesta correcta, y es de los
// pocos sitios donde lo es: el cliente está pidiendo ver lo que hay.
const ERA_LA_VITRINA = [
  "¡Tenemos todo eso y más! 😍 Mira el catálogo completo 👇 y dime cuál te gustó",
  "Ahí sale buena parte de la tienda 🙌 Aquí lo tienes todo 👇 Dime cuál te llamó la atención",
  "¡Esa es la tienda! 😊 Échale un ojo al catálogo completo 👇 y me dices cuál quieres ver de cerca",
  "Mira todo lo que tenemos aquí 👇 Cuando veas uno que te guste, dime cuál y te lo muestro 👟",
];

// Lo que cabe en un carrusel de Instagram.
const MAXIMO_EN_CARRUSEL = 10;

// Cuántos se le piden a Shopify cuando después hay que filtrar por color.
// Tiene que cubrir con holgura el modelo más repetido del catálogo: hay
// trece "Air Force One" y diecisiete "New Balance 9060 Dama", y si el
// color pedido cae fuera de lo que se pidió, el bot dice que no hay algo
// que sí tiene.
const CUANTOS_PARA_FILTRAR = 60;

// Hay un modelo parecido que enseñarle: van con fichas debajo.
const TE_OFREZCO_PARECIDOS = [
  "Esos son todos los que tengo de ese modelo 😊 Pero mira estos, que se parecen mucho 👇",
  "De ese ya te mostré todo lo que hay 👟 Échale un ojo a estos, que te pueden gustar 👇",
  "Ya te enseñé todos los de ese 😊 Te muestro otros parecidos, a ver qué te parecen 👇",
  "No me queda ninguno más de ese modelo 👀 Pero estos van por el mismo estilo, mira 👇",
];

// 22-sep-2026: caso real en producción — el cliente pidió "On Cloud", vio
// 10 fichas (el máximo que admite un carrusel de Instagram), preguntó
// "¿solo tienes esos?" y el bot le ofreció Salomon en vez del catálogo,
// porque de los 10 que ya había mostrado ninguno era "nuevo". El problema
// no era que ya hubiera visto todo — es que SÍ había más de ese modelo,
// solo que nunca se llegaron a buscar porque el carrusel tiene tope de 10.
// Con "hayMas" (ver shopify.js) el código ahora distingue los dos casos.
const HAY_MAS_EN_CATALOGO = [
  "¡Tengo bastantes más de esos! 😊 Aquí tienes el catálogo completo, ahí los ves todos 👇",
  "¡Claro que hay más! 👟 Te dejo el catálogo completo, ahí están todos los que tengo",
  "¡Sí, hay varios más! 😊 Mira el catálogo completo, ahí los ves todos 👇",
];

// No quedó nada nuevo ni parecido: ahí sí el catálogo ayuda de verdad.
const YA_TE_MOSTRE_TODO = [
  "Esos son todos los que tengo de ese modelo 😊 En el catálogo completo está todo lo demás 👇",
  "De ese ya te mostré todo lo que hay 👟 Aquí tienes el catálogo completo por si quieres ver otra cosa 👇",
  "Ya te enseñé todo lo de ese modelo 😊 Mira el catálogo completo y dime cuál te gusta 👇",
];

// Cuántos términos parecidos se prueban antes de rendirse. Cada uno es una
// llamada más a Shopify: con dos ya se cubren casi todos los casos.
const MAXIMO_ALTERNATIVAS = 2;

function alAzar(frases) {
  return frases[Math.floor(Math.random() * frases.length)];
}

// Cuando la historia es un vídeo no se puede mirar, y eso pasa a diario: la
// mayoría de las historias son vídeo. NO es una avería, así que el cliente
// no puede recibir el mensaje de avería. Se le pregunta como preguntaría una
// vendedora: en corto y pidiendo UN dato, para seguir la conversación.
//
// Sin catálogo. El cliente que responde a una historia es el que más cerca
// está de comprar; mandarlo a la tienda online en ese momento es soltarle
// la mano justo cuando más atención pide.
//
// Solo se usan si el modelo tampoco responde: mientras haya modelo, la
// pregunta la escribe él con el contexto de lo que dijo el cliente.
const HISTORIA_SIN_VER = [
  "¡Claro que sí! 😊 Dime cuál de los que salen en la historia te gustó y te lo muestro",
  "¡Con gusto! ¿Cuál te llamó la atención? Dime el modelo y te lo enseño enseguida 👟",
  "¡Por supuesto! 👟 Dime cuál te gustó y te lo muestro con todo",
  "¡Claro! ¿De cuál quieres saber? Dime el modelo o la marca y te enseño lo que tengo 😊",
];

// Si el modelo falla, el cliente no se queda sin nada y el asesor se entera.
const FALLO_TECNICO =
  "Disculpa, se me trabó el sistema 😅 Un asesor te atiende en un momento";

// EL CLIENTE NO TIENE POR QUÉ NOTAR LA PAUSA.
//
// Mientras un asesor lleva la conversación, el bot se calla. Bien. Pero
// hasta hoy se callaba del todo: el cliente escribía y no pasaba NADA, ni
// un "ya te leo". Desde su lado eso no se distingue de que lo estén
// ignorando, y es cuando la gente se va.
//
// Esto no contesta lo que preguntó —eso es del asesor, y meterse ahí es
// justo lo que la pausa evita— pero le confirma que alguien lo tiene.
const YA_TE_ATIENDEN = [
  "¡Hola! Un asesor ya está viendo tu mensaje y te responde en un momento 😊",
  "Un asesor tiene tu conversación y te escribe enseguida 😊",
  "¡Gracias por escribir! Un asesor te atiende en un momento 😊",
  "Ya un asesor está pendiente de ti, te responde enseguida 😊",
];

// Cada cuánto se le puede repetir. Si escribe cinco mensajes seguidos no
// recibe cinco veces lo mismo: eso sí parecería un robot averiado.
const AVISO_PAUSA_CADA_MS = 10 * 60 * 1000;

// CUÁNTO DURA LA PAUSA, Y POR QUÉ NO SON DOS MINUTOS.
//
// Se cuenta desde el ÚLTIMO mensaje del asesor, no desde el primero: cada
// vez que escribe, el reloj vuelve a empezar. Así que mientras esté
// atendiendo, la conversación sigue siendo suya por más que dure.
//
// Con una pausa muy corta el bot se mete en medio de la venta. Y justo en
// lo que no puede: el asesor está hablando de tallas, envíos, pagos y
// descuentos —lo único que el bot tiene PROHIBIDO responder— así que
// aparecer ahí con un carrusel no es un detalle feo, es reventar el cierre.
//
// Una hora después del último mensaje del asesor es tiempo de sobra para
// que termine, y poco para que el cliente se quede tirado. Se puede tocar
// en wrangler.toml sin tocar el código, y admite decimales: 0.5 = 30 min.
const PAUSA_HORAS_POR_DEFECTO = 1;

// DEVOLVERLE LA CONVERSACIÓN AL BOT DESDE EL MISMO CHAT.
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

// Las tallas las confirma una persona, y es de lo que más se pregunta justo
// antes de comprar. Se detecta en el mensaje del cliente y no en la respuesta
// del modelo: el aviso tiene que salir aunque el modelo redacte distinto.
const PREGUNTA_TALLA =
  /\b(talla|tallas|tallaje|size|sizes|calzo|mi\s+n[uú]mero|n[uú]mero\s+de\s+(calzado|zapato|pie))\b/i;

// Ningún título del catálogo lleva la talla, así que colarla en la búsqueda
// devuelve cero productos. Solo se quita el número cuando va detrás de
// "talla" o "size": si no, nos cargaríamos nombres como "Jordan 40".
// Tallas de calzado ("talla 42") y de ropa ("talla M", "talla XL", "talla 32").
const TALLA_EN_BUSQUEDA = /\b(tallas?|sizes?)\s*:?\s*(?:xxs|xs|s|m|l|xl|xxl|xxxl|[2-5]xl)\b|\b(tallas?|sizes?|n[uú]mero)\s*:?\s*\d{1,2}(\.\d)?\b|\b(tallas?|sizes?)\b/gi;

// ¿El cliente NOMBRÓ algo concreto, o solo mandó la foto con un "precio"?
//
// Decide si una vitrina se trata como vitrina. Si escribió "las Nike
// blancas", eso manda aunque la foto sea un estante lleno; si escribió
// "cuánto?" o nada, no hay nada que buscar y toca el catálogo.
//
// ANTE LA DUDA, NO PIDIÓ NADA. Mandar el catálogo cuando el cliente sí
// había nombrado algo es un fallo menor —lo ve todo igual—; adivinar un
// zapato cuando no nombró nada es el fallo que hay que evitar.
const PALABRAS_SIN_PRODUCTO = new Set([
  "hola", "buenas", "buenos", "dias", "tardes", "noches", "saludos",
  "precio", "precios", "cuanto", "cuanta", "cuesta", "cuestan", "vale",
  "valen", "info", "informacion", "disponible", "disponibles", "hay",
  "tienen", "tiene", "tienes", "queda", "quedan", "eso", "esos", "esas",
  "esa", "este", "esta", "estos", "estas", "ese", "me", "interesa",
  "quiero", "quisiera", "gusta", "gustan", "gustaron", "gustó", "gusto",
  "encanta", "encantan", "busco", "buscando", "necesito", "ando",
  "muestra", "muestrame", "muéstrame", "mostrar", "ensename", "enseñame",
  "manda", "mandame", "pasa", "pasame", "dame",
  "por", "favor", "porfa", "gracias", "si", "no",
  "y", "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del",
  "que", "a", "al", "con", "para", "mi", "tu", "su",
  "ver", "verlo", "verlos", "mas", "todo", "todos", "ok", "dale",
  // Genéricas de calzado. "¿Cuánto cuestan esos zapatos?" sobre una foto
  // del estante NO es nombrar un modelo: es justo el mensaje que llega con
  // una vitrina. Si cuentan como "pidió algo concreto", el bot vuelve a
  // adivinar un par entre veinte, que es lo que esto vino a evitar.
  "zapato", "zapatos", "calzado", "calzados", "tenis", "zapatilla",
  "zapatillas", "par", "pares", "modelo", "modelos", "botas", "bota",
]);

function textoPideAlgo(texto) {
  const palabras = String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  return palabras.some((p) => p.length > 1 && !PALABRAS_SIN_PRODUCTO.has(p));
}

function sinTalla(termino) {
  return String(termino || "")
    .replace(TALLA_EN_BUSQUEDA, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// CADA PASADA CON SU CUENTA DE CONEXIONES (ver presupuesto.js): Cloudflare
// corta a las 50 por pasada en el plan gratis, y con DeepSeek se llegaba.
export default {
  fetch(request, env, ctx) {
    return conPresupuesto(env, () => atenderPeticion(request, env, ctx));
  },

  scheduled(evento, env, ctx) {
    ctx.waitUntil(conPresupuesto(env, () => indexarLoQueFalte(env)).finally(() => guardarErrores(env.DB, env)));
  },
};

async function atenderPeticion(request, env, ctx) {
  {
    const url = new URL(request.url);

    // EL PANEL DE LA TIENDA (/panel) y LA PUERTA DEL PANEL CENTRAL
    // (/api/central), 5-oct-2026: lo mismo que Invictus y EPICELL (ver
    // panel.js). Con clave: PANEL_CLAVE y PANEL_API_CLAVE.
    const datosDelPanel = {
      tienda: String(env.TIENDA_NOMBRE || "El Emperador"),
      version: VERSION,
      horasDePausa: Number(env.PAUSA_HORAS) || PAUSA_HORAS_POR_DEFECTO,
      conAnuncios: false,
      verTexto: async (ruta) => (await atenderPeticion(new Request(new URL(ruta, url)), env, ctx)).text(),
    };
    if (url.pathname.startsWith("/api/central")) return atenderApiCentral(request, env, datosDelPanel);
    if (url.pathname === "/panel" || url.pathname.startsWith("/panel/")) return atenderPanel(request, env, datosDelPanel);

    // Dispara un aviso de prueba y enseña lo que respondió Slack. Sirve para
    // saber si el problema está en el aviso o en lo que pasa antes.
    if (url.pathname === "/probar-aviso") {
      const resultado = await avisarAsesor(env, {
        nombre: "Prueba",
        mensaje: "tienen talla 42?",
        respuesta: "Eso te lo confirma un asesor en un momento",
        motivo: "PRUEBA MANUAL",
      });
      return new Response(`${resultado}\n`, {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    /* ── El único camino: Meta directo ──────────────────────────────
       El webhook atiende texto, fotos y respuestas a historias, además de
       los ecos (para la pausa automática cuando un asesor toma la
       conversación a mano). Todo lo demás —los "visto", las reacciones,
       los comentarios— se descarta sin gastar nada. Ese aluvión fue el
       que se comió los créditos de Make: pagaba una operación por cada
       aviso, y Meta manda cientos al día.
       ──────────────────────────────────────────────────────────────── */

    // Meta comprueba que la URL es tuya antes de mandarte nada: te pide el
    // token que pusiste en el panel y espera que le devuelvas su desafío.
    if (url.pathname === "/webhook" && request.method === "GET") {
      const modo = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const desafio = url.searchParams.get("hub.challenge");

      if (modo === "subscribe" && token && token === env.META_VERIFY_TOKEN) {
        console.log("Meta verificó el webhook");
        ctx.waitUntil(anotar(env, "verificado", desafio === "PRUEBA12345" ? "prueba a mano" : "Meta"));
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
      ctx.waitUntil(anotar(env, "llegada", queTraia(crudo)));

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
        // a fallar, y otra vez. Eso multiplica por tres o por diez cada
        // evento y agota la cuota del Worker.
        //
        // El mensaje se descarta igual: no se mira, no se responde. Solo se
        // le quita a Meta el motivo para insistir.
        ctx.waitUntil(
          anotar(env, "firma_mala", !claves.length ? "no hay ninguna clave cargada" : !cabecera ? "sin cabecera de firma" : `no firma ninguna: ${claves.map(([n]) => n).join(", ")}`)
        );
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
      // exactamente cero: ni OpenAI, ni Shopify, ni un envío.
      const mensaje = queAtender(env, crudo);
      ctx.waitUntil(
        mensaje
          ? anotar(env, "atendido", `${mensaje.tipo} de ${mensaje.igsid} (firma: ${cualFuncionó})`)
          : anotar(env, "descartado", `${queTraia(crudo)} (META_MODO: ${env.META_MODO || "todo"})`)
      );

      // A Meta se le responde 200 siempre y rápido. Si tarda o falla, lo
      // reintenta y el cliente acaba recibiendo la misma respuesta varias
      // veces; y si falla mucho, Meta desactiva el webhook.
      //
      // La hora de llegada viaja con el mensaje: Cloudflare da 30 segundos
      // de trabajo desde esta respuesta, y el cotejo la usa para saber si
      // le da el tiempo de esperar el cupo de OpenAI (ver cotejo.js).
      if (mensaje) {
        mensaje.recibidoEn = Date.now();
        ctx.waitUntil(atenderConRed(env, mensaje));
      }
      return new Response("ok", { status: 200 });
    }

    // Dice qué hay cargado y qué falta, SIN enseñar ningún secreto: solo si
    // está y cuánto mide. Con esto se sabe en diez segundos si el problema
    // es un secreto que falta o una configuración mal puesta.
    if (url.pathname === "/estado") {
      const secreto = (nombre) => {
        const valor = env[nombre];
        return valor ? `cargado (${String(valor).length} caracteres)` : "FALTA";
      };

      // Que el binding esté puesto no significa que la tabla exista ni que
      // tenga las columnas de hoy. Eso se comprueba de verdad, aquí.
      const base = await revisarBase(env.DB, {
        fraseDespausar: fraseDespausar(env),
        // Para que los comandos que imprime se puedan copiar tal cual:
        // cada bot tiene SU base, y estado.js es el mismo archivo en todos.
        base: env.D1_NOMBRE || "tu-base-d1",
      });

      // Cuántos productos tiene el índice del catálogo. Sin índice, el
      // cotejo visual se queda sin su vía buena y cae al barrido corto,
      // que con el cupo de OpenAI apenas mira unos pocos por mensaje.
      let indexados = 0;
      try {
        indexados = (await leerIndice(env.DB)).length;
      } catch {
        indexados = -1;
      }

      // LA CLAVE Y LOS MODELOS DEL QUE DE VERDAD ATIENDE. Enseñar
      // "OPENAI_API_KEY FALTA" en un bot que no usa OpenAI es una alarma
      // falsa: da un susto y esconde lo que sí importa mirar.
      const tareas = ["texto", "vision", "indice"];
      const clavesIA = [...new Set(tareas.map((t) => claveDe(env, t)))];
      const deTexto = quienAtiende(env, "texto").proveedor;
      const deFotos = quienAtiende(env, "vision").proveedor;

      const gasto = await gastoDelMes(env);

      return texto200(
        [
          `CÓDIGO DESPLEGADO   ${VERSION}`,
          "  Si esta línea no coincide con la última versión que pegaste,",
          "  el despliegue no llegó: vuelve a correr `wrangler deploy`.",
          "",
          "SECRETOS",
          // LA CLAVE DEL QUE DE VERDAD ATIENDE. Enseñar "OPENAI_API_KEY
          // FALTA" en un bot que corre entero con DeepSeek es una alarma
          // falsa: da un susto y esconde lo que sí importa mirar.
          ...clavesIA.map((c) => `  ${c.padEnd(19)} ${secreto(c)}`),
          `  SHOPIFY_TOKEN       ${secreto("SHOPIFY_TOKEN")}`,
          `  SLACK_WEBHOOK       ${secreto("SLACK_WEBHOOK")}`,
          `  META_APP_SECRET     ${secreto("META_APP_SECRET")}   (la de Facebook)`,
          `  META_APP_SECRET_IG  ${secreto("META_APP_SECRET_IG")}   (la de Instagram ← es esta)`,
          `  IG_TOKEN            ${secreto("IG_TOKEN")}`,
          `  PANEL_CLAVE         ${secreto("PANEL_CLAVE")}   (la clave del panel de la tienda: /panel)`,
          `  PANEL_API_CLAVE     ${secreto("PANEL_API_CLAVE")}   (la del panel central: la misma va en el panel como CLAVE_EMPERADOR)`,
          `  PANEL_CENTRAL_URL   ${env.PANEL_CENTRAL_URL ? "puesto (avisos en tiempo real al panel central)" : "sin poner (sin avisos en tiempo real)"}`,
          "  ¿No responde en Instagram? Abre /probar-instagram: dice en qué paso se corta.",
          "",
          "CONFIGURACIÓN (wrangler.toml)",
          `  META_MODO           ${env.META_MODO || "todo (por defecto)"}`,
          `  META_VERIFY_TOKEN   ${env.META_VERIFY_TOKEN ? "puesto" : "FALTA"}`,
          `  SHOPIFY_TIENDA      ${env.SHOPIFY_TIENDA || "FALTA"}`,
          `  URL_CATALOGO        ${env.URL_CATALOGO || "FALTA"}`,
          `  CATALOGO            ${usaDrive(env) ? `Google Drive (${idDeCarpeta(env.DRIVE_CARPETA) ? "carpeta puesta" : "FALTA DRIVE_CARPETA"}) — míralo en /probar-drive` : "Shopify"}`,
          ...(usaDrive(env) ? [`  DRIVE_API_KEY       ${env.DRIVE_API_KEY ? secreto("DRIVE_API_KEY") : "no hace falta: se lee la carpeta pública"}`] : []),
          `  WHATSAPP            ${String(env.WHATSAPP || "").replace(/\D/g, "") ? "puesto" : "sin poner (no sale el botón Comprar)"}`,
          `  PAUSA_HORAS         ${env.PAUSA_HORAS || `${PAUSA_HORAS_POR_DEFECTO} (por defecto)`}   (se cuenta desde el ULTIMO mensaje del asesor)`,
          `  FRASE_DESPAUSAR     "${fraseDespausar(env)}"   (el asesor la manda en el chat y el bot vuelve)`,
          `  PROVEEDOR           ${deTexto === deFotos ? `${deTexto}  ← TODO (texto y fotos) va a ${deTexto}` : `${deTexto} el texto, pero las FOTOS van a ${deFotos}`}`,
          "    Quién hace cada cosa:",
          `      Texto (redactar las respuestas)    → ${deTexto}, ${quienAtiende(env, "texto").modelo}`,
          `      Fotos (mirar, cotejar)             → ${deFotos}, ${quienAtiende(env, "vision").modelo}`,
          `      Índice (catalogar el estante)      → ${quienAtiende(env, "indice").proveedor}, ${quienAtiende(env, "indice").modelo}`,
          "    Los modelos se cambian en wrangler.toml, sin tocar el código.",
          `  COTEJO_BARRIDO      ${env.COTEJO_BARRIDO === "no" ? "no (apagado)" : "si"}   (mirar el catálogo cuando el nombre no acierta)`,
          `  CONEXIONES          ${limiteDeSubpeticiones(env)} por pasada (${limiteDeSubpeticiones(env) > 50 ? "plan de pago" : "plan básico de Cloudflare"}); el bot las reparte y guarda siempre para contestar`,
          "",
          `GASTO DE IA ESTE MES (${[...new Set([deTexto, deFotos])].join(" + ")}) — medido, no estimado`,
          ...(gasto
            ? [
                ...gasto.filas.map(
                  (f) =>
                    `  ${String(f.modelo).padEnd(20)} $${(f.dolares || 0).toFixed(2)}   ` +
                    `${(f.llamadas || 0).toLocaleString()} llamadas, ` +
                    `${(f.entrada || 0).toLocaleString()} tok de entrada` +
                    (f.cacheadas
                      ? ` (${Math.round(((f.cacheadas || 0) / (f.entrada || 1)) * 100)}% con descuento de caché)`
                      : "")
                ),
                gasto.filas.length
                  ? `  ${"TOTAL".padEnd(20)} $${gasto.total.toFixed(2)} en ${gasto.dias} día(s) → ` +
                    `el mes va a salir en unos $${gasto.proyectado.toFixed(2)}`
                  : "  Todavía no hay ninguna llamada medida este mes.",
                "  Una foto cuesta como 16 mensajes de texto: casi todo el gasto",
                "  son fotos. Si el proyectado se pasa, eso es lo que hay que bajar.",
              ]
            : ["  (no pude leer la tabla de gasto)"]),
          "",
          "CÓMO SE PAGA (src/prompts/pagos.txt)",
          metodosDePago().length
            ? `  Métodos             ${metodosDePago().length} cargados:\n` +
              bloqueDeMetodos()
                .split("\n")
                .map((l) => `                      ${l}`)
                .join("\n")
            : "  Métodos             NINGUNO CARGADO. Esa pregunta sigue yendo\n" +
              "                      al asesor. Se llenan en la sección [METODOS]\n" +
              "                      de src/prompts/pagos.txt, uno por línea.",
          tasaDePago()
            ? `  Tasa                ${tasaDePago()}`
            : "  Tasa                SIN CARGAR. Esa pregunta sigue yendo al asesor.",
          "  El bot dice CON QUÉ se paga y CUÁL es la tasa. Los datos de la",
          "  cuenta y la cifra del día no: eso es del asesor, siempre.",
          "",
          "ÍNDICE DEL CATÁLOGO — lo que hace que el cotejo mire TODO",
          indexados > 0
            ? `  ${indexados} productos indexados.`
            : indexados === 0
              ? "  VACÍO TODAVÍA. Mientras tanto el cotejo visual solo puede\n" +
                `  mirar unos pocos productos por mensaje (el cupo de ${quienAtiende(env, "vision").proveedor}\n` +
                "  no da para más a ciegas).\n" +
                "  NO HACE FALTA QUE HAGAS NADA: el cron lo llena solo, en\n" +
                "  un par de horas desde cero. Si tienes prisa, abre\n" +
                "  /indexar-catalogo para adelantar una tanda."
              : "  No se pudo leer (¿falta la base de datos?).",
          indexados > 0
            ? "  Se mantiene solo: los productos nuevos los recoge el cron\n" +
              "  (cada 15 min, ver [triggers] en wrangler.toml). Si aquí\n" +
              "  el número lleva horas sin subir y sabes que faltan, mira\n" +
              `  \`wrangler tail\`: casi siempre es saldo o cupo de ${quienAtiende(env, "vision").proveedor}.`
            : "",
          "",
          "BASE DE DATOS (D1) — la memoria del bot entre mensajes",
          ...base.lineas,
          "",
          "ManyChat está retirado. Este Worker es el único canal: habla",
          "directo con la API de Instagram y guarda su propia memoria en D1.",
          "",
          "Las fotos se identifican en dos pasos: primero la IA de visión",
          `(${quienAtiende(env, "vision").proveedor}, ${quienAtiende(env, "vision").modelo}) describe y verifica`,
          "rasgos, y luego la IA de texto redacta la respuesta al cliente",
          "con ese dato ya corregido (ver identificar.js).",
          "",
          "Los webhooks de Instagram se firman con la clave del producto",
          "Instagram, no con la de Configuración → Básica. Si el registro",
          "dice que la firma no cuadra, carga la otra:",
          "  npx wrangler secret put META_APP_SECRET_IG",
          "",
        ].join("\n")
      );
    }

    // Prueba la vista del bot con una imagen cualquiera, sin depender de
    // un webhook real: /probar-imagen?url=https://...
    // INDEXAR EL CATÁLOGO. Se corre a mano desde el navegador, por
    // tandas, y hay que volver a correrlo cuando se agregan productos.
    //
    // Mira cada foto del catálogo UNA vez con el modelo de visión y
    // guarda sus 15 rasgos en D1 (ver indice.js). Después, cuando un
    // cliente manda una foto, sus rasgos se comparan con los guardados
    // sin gastar una sola llamada, y solo los 10 más parecidos van al
    // cotejo. Es lo que permite mirar el catálogo entero con el cupo de
    // OpenAI que hay.
    if (url.pathname === "/indexar-catalogo") {
      const cuantos = Math.min(Number(url.searchParams.get("cuantos")) || 40, 100);
      const r = await indexarTanda(env, {
        cuantos,
        rehacer: url.searchParams.get("rehacer") === "si",
      });

      if (!r.ok) {
        return texto200(
          `${r.error}\n\n` +
            "Revisa SHOPIFY_TIENDA, el secreto SHOPIFY_TOKEN y el binding DB\n" +
            "(mira /estado); el motivo exacto sale en `wrangler tail`.\n"
        );
      }

      if (r.sinConexiones && !r.indexados) {
      console.log(`Indexación automática: ${r.corto}`);
      return;
    }
    if (r.ningunoSalio) {
        return texto200(
          `No pude indexar NINGUNO de los ${r.intentados} que intenté, con ${r.modelo}.\n\n` +
            (r.corto ? `${r.corto}\n\n` : "") +
            "El motivo exacto sale en `wrangler tail`. Los dos habituales:\n" +
            `  · la cuenta de ${quienAtiende(env, "vision").proveedor} se quedó sin saldo\n` +
            `  · la clave no tiene permiso para "${r.modelo}"\n\n` +
            "Si en el registro ves 429 con \"tokens per min\", es solo cupo:\n" +
            "espera un minuto y vuelve a abrir esta dirección.\n"
        );
      }

      // El porcentaje se cuenta sobre los que SE PUEDEN indexar, no sobre
      // los 581. Contar los que no tienen foto hacía que no llegara nunca
      // al 100% por mucho que estuviera todo hecho.
      const hecho = r.indexables
        ? Math.round(((r.yaEstaban + r.indexados) * 100) / r.indexables)
        : 0;

      return texto200(
        `Catálogo en ${r.fuente}: ${r.catalogo} productos\n` +
          (r.carpetasTotal
            ? `  carpetas de Drive leídas: ${r.carpetasLeidas} de ${r.carpetasTotal}` +
              (r.carpetasLeidas < r.carpetasTotal
                ? " — TODAVÍA LEYENDO la carpeta: lo que falte entra solo (o abre /probar-drive)\n"
                : " (completa)\n")
            : "") +
          (r.sinFoto
            ? `  de los cuales ${r.sinFoto} NO tienen foto y no se pueden indexar\n` +
              `  (el cotejo compara imágenes). Quedan ${r.indexables} indexables.\n`
            : "") +
          `Ya estaban indexados: ${r.yaEstaban}\n` +
          (r.sinColor
            ? `Indexados de antes, a los que solo les falta el color: ${r.sinColor}\n` +
              "  (se completan solos, de a una tanda; el cotejo ya los usa)\n"
            : "") +
          `Indexados en esta tanda: ${r.indexados} (con ${r.modelo})\n` +
          (r.fallados
            ? `No se pudieron catalogar: ${r.fallados} — el motivo exacto sale\n` +
              "en `wrangler tail`. Si son 429, es cupo: espera un minuto.\n"
            : "") +
          (r.refrescados
            ? `Precio, enlace o título actualizados: ${r.refrescados} (sin mirar ninguna foto)\n`
            : "") +
          (r.quitados ? `Quitados del índice (ya no están en ${r.fuente}): ${r.quitados}\n` : "") +
          "\n" +
          (r.faltan > 0
            ? `FALTAN ${r.faltan} de ${r.indexables} (${hecho}% hecho).\n\n` +
              "NO HACE FALTA QUE HAGAS NADA: el cron indexa lo que queda\n" +
              "solo, en las próximas pasadas (ver [triggers] en\n" +
              "wrangler.toml). Recarga esta dirección solo si tienes prisa.\n"
            : r.carpetasTotal && r.carpetasLeidas < r.carpetasTotal
              ? "Indexado todo lo que se ha leído de Drive hasta ahora. Falta leer\n" +
                "parte de la carpeta: el cron lo lee y lo indexa solo.\n\n"
              : "LISTO: el catálogo está indexado entero.\n\n" +
              "Los productos nuevos los recoge el cron solo. Esta dirección\n" +
              "queda para mirar cómo va o para forzar una pasada.\n")
      );
    }

    // PROBAR EL TEXTO SIN ESCRIBIRLE AL BOT POR INSTAGRAM (1-oct-2026).
    //   /probar-texto?mensaje=hola, tienen jordan 4?
    // Enseña qué le contestaría al cliente, qué buscó, qué encontró, con
    // qué modelo y cuánto tardó. No manda nada a Instagram ni toca la
    // memoria de ningún cliente.
    if (url.pathname === "/probar-texto") {
      const mensaje = (url.searchParams.get("mensaje") || "").trim();
      if (!mensaje) {
        return texto200(
          "Escríbele algo al bot en la dirección, así:\n" +
            "  /probar-texto?mensaje=hola, tienen jordan 4?\n\n" +
            "Te enseña qué le contestaría al cliente, sin mandarle nada a nadie.\n"
        );
      }

      // El catálogo de Drive se lee ANTES y aparte, para que el tiempo de la
      // IA no incluya el de Drive: si algo tarda, se ve cuál de los dos.
      let lineaDrive = "";
      if (usaDrive(env)) {
        const t0 = Date.now();
        const drive = await catalogoDeDrive(env);
        const tardoDrive = Date.now() - t0;
        lineaDrive = drive.error
          ? `Catálogo de Drive: NO SE PUDO LEER — ${drive.error}\n   (míralo en /probar-drive)\n`
          : `Catálogo de Drive: ${drive.productos.length} productos (tardó ${(tardoDrive / 1000).toFixed(1)} s` +
            `${tardoDrive < 50 ? ", ya estaba en memoria" : ""})\n`;
      }

      const empezo = Date.now();
      const salida = await responderTexto(env, contexto("", "", mensaje, ""));
      const tardoTexto = Date.now() - empezo;
      if (!salida) {
        return texto200(
          `La IA de texto (${quienAtiende(env, "texto").proveedor}, ${quienAtiende(env, "texto").modelo}) no respondió.\n\n` +
            `Casi siempre es la clave (${claveDe(env, "texto")}), el saldo, o un nombre de\n` +
            "modelo que tu cuenta no tiene. En `wrangler tail` sale el motivo exacto.\n"
        );
      }

      const { productos, respuestaCliente, termino } = await decidir({
        env,
        salida,
        texto: mensaje,
        historialPrevio: "",
      });

      return texto200(
        lineaDrive +
          `Modelo de texto: ${quienAtiende(env, "texto").proveedor}, ${quienAtiende(env, "texto").modelo} ` +
          `(tardó ${(tardoTexto / 1000).toFixed(1)} s)\n\n` +
          `El cliente escribe:  ${mensaje}\n` +
          `El bot contestaría:  ${revisarPagos(respuestaCliente).respuesta}\n\n` +
          `Buscó: ${termino || "(nada)"}\n` +
          `Encontró: ${productos.length}` +
          (productos.length ? "\n" + productos.map((p) => `   ${p.titulo}  —  ${p.precio}`).join("\n") : "") +
          (!productos.length && termino && !usaDrive(env) && /PENDIENTE|CAMBIA-ESTO/i.test(String(env.SHOPIFY_TIENDA || ""))
            ? "\n   (no hay catálogo conectado: SHOPIFY_TIENDA sigue en PENDIENTE)"
            : "") +
          "\n"
      );
    }

    // POR QUÉ NO RESPONDE EN INSTAGRAM (1-oct-2026).
    //   /probar-instagram              revisa todo y dice qué hacer
    //   /probar-instagram?suscribir=si suscribe la cuenta al webhook
    // LAS DOS PÁGINAS QUE META PIDE PARA PUBLICAR LA APP (ver legal.js).
    if (url.pathname === "/privacidad") return html200(paginaDePrivacidad(env));
    if (url.pathname === "/eliminar-datos") return html200(paginaDeEliminacion(env));

    if (url.pathname === "/probar-instagram") {
      return texto200(await diagnosticoDeInstagram(env, url));
    }

    // EL CATÁLOGO DE DRIVE, TAL COMO LO LEE EL BOT (1-oct-2026).
    //   /probar-drive
    // Para ver ANTES de que lo vea un cliente qué nombre, código y precio
    // sacó de cada foto, y arreglar en Drive lo que salga mal.
    if (url.pathname === "/probar-drive") {
      if (!usaDrive(env)) {
        return texto200(
          "El catálogo NO está en Drive: en wrangler.toml falta CATALOGO = \"drive\".\n"
        );
      }
      // Cada vez que se abre, lee otro trozo de la carpeta (lo que quepa en
      // las conexiones de esta pasada) y enseña cómo va.
      const trozo = env.DB ? await leerUnTrozoDeDrive(env, { maximo: 35 }) : null;
      const { productos, error, via, aviso, carpetasLeidas, carpetasTotal } = await catalogoDeDrive(env);
      if (error) return texto200(`No pude leer la carpeta de Drive: ${error}\n`);

      const sinPrecio = productos.filter((p) => !p.precio);
      const sinCodigo = productos.filter((p) => !p.codigo);
      return texto200(
        [
          `CARPETA  ${idDeCarpeta(env.DRIVE_CARPETA)}`,
          `LEÍDA    ${via}`,
          ...(carpetasTotal
            ? [
                `CARPETAS ${carpetasLeidas} de ${carpetasTotal} leídas` +
                  (trozo?.leidas ? ` (${trozo.leidas} ahora mismo)` : "") +
                  (carpetasLeidas < carpetasTotal ? " — recarga esta página para leer más, o espera al cron (cada 15 min)" : " — completa"),
                ...(trozo?.error ? [`ERROR    ${trozo.error}`] : []),
              ]
            : []),
          ...(aviso ? [`AVISO    ${aviso}`] : []),
          `CATEGORÍAS ${[...new Set(productos.map((p) => p.categoria).filter(Boolean))].join(", ") || "(ninguna: las fotos están sueltas)"}`,
          `${productos.length} productos leídos` +
            (sinPrecio.length ? ` · ${sinPrecio.length} SIN PRECIO` : "") +
            (sinCodigo.length ? ` · ${sinCodigo.length} sin código` : ""),
          "",
          "NOMBRE (lo que verá el cliente)                               PRECIO",
          ...productos.map(
            (p) =>
              `  ${p.titulo.slice(0, 60).padEnd(60)} ${p.precio || "— SIN PRECIO"}${p.categoria ? `   [${p.categoria}]` : ""}\n` +
              `      archivo: ${p.nombre}`
          ),
          "",
          sinPrecio.length
            ? "Los que dicen SIN PRECIO: el nombre (o la descripción) de esa foto en\n" +
              "Drive no trae un precio que se entienda. Escríbelo como \"45$\" o \"$45\"."
            : "",
          `Para ver una foto: /probar-imagen?url=${productos[0]?.imagen || ""}`,
          "",
        ].join("\n")
      );
    }

    // Cómo queda la ubicación ANTES de que la vea un cliente, y por qué sale
    // rota la foto si sale rota (25-sep-2026).
    if (url.pathname === "/probar-ubicacion") {
      const u = mensajeDeUbicacion(env);
      const original = String(env.FOTO_LOCAL || "").trim();
      const foto = u.foto ? await revisarImagen(u.foto) : null;

      return texto200(
        [
          "UBICACION (sale de wrangler.toml: DIRECCION, MAPS_URL, FOTO_LOCAL)",
          "",
          `  Texto   ${u.texto || "SIN PONER: el bot no manda la ubicacion (DIRECCION vacia)"}`,
          `  Boton   ${u.enlace ? `${u.boton} -> ${u.enlace}` : "NO SALE (falta MAPS_URL)"}`,
          "",
          "FOTO",
          `  En wrangler  ${original || "(vacio)"}`,
          `  Se usa       ${u.foto || "NINGUNA"}`,
          u.foto && u.foto !== original ? "               ^ se arreglo sola (enlace de Drive)" : "",
          `  Se descarga  ${foto ? (foto.ok ? "SI - " + foto.detalle : "NO - " + foto.detalle) : "no hay foto que probar"}`,
          original && !u.foto
            ? "  ^ ese enlace NO es una imagen (un mapa, Google Fotos, Instagram...).\n" +
              "    Tiene que ser la direccion de LA FOTO, la que termina en .jpg o .png."
            : "",
          "",
          "COMO LE LLEGA AL CLIENTE",
          !u.texto
            ? "  No le llega: sin DIRECCION, la pregunta la contesta la IA o un asesor."
            : u.foto && u.enlace
              ? [...u.texto].length <= 78
                ? "  UN mensaje: foto + direccion + boton"
                : "  DOS mensajes: la direccion en texto, y la foto con el boton"
              : u.enlace
                ? "  UN mensaje: la direccion con el boton debajo"
                : "  UN mensaje: la direccion, sin boton",
          "",
        ]
          .filter((linea) => linea !== "")
          .join("\n") + "\n"
      );
    }

    if (url.pathname === "/probar-imagen") {
      const imagen = url.searchParams.get("url") || "";
      if (!urlValida(imagen)) {
        return texto200(
          "Pásame una imagen así:\n" +
            "  /probar-imagen?url=https://ejemplo.com/foto.jpg\n\n" +
            "Tiene que empezar por http:// o https:// y ser accesible sin\n" +
            "contraseña. Una foto de Instagram con enlace caducado no vale.\n"
        );
      }

      const { uri: descargada, motivo: porQue } = await comoDataUri(env, imagen);
      if (!descargada) {
        return texto200(
          `No pude usar esa imagen (${porQue}).\n\n` +
            "El motivo exacto sale en `wrangler tail`. Los enlaces del CDN\n" +
            "de Instagram caducan en unas horas; prueba con una foto de tu\n" +
            "tienda o de cualquier web abierta.\n"
        );
      }

      const empezoVision = Date.now();
      const identificacion = await identificarEnImagen(env, descargada);
      const tardoVision = Date.now() - empezoVision;
      if (!identificacion) {
        return texto200(
          "La IA de visión no pudo con esa imagen.\n\n" +
            "Casi siempre es una de estas:\n" +
            `  · no queda saldo en ${quienAtiende(env, "vision").proveedor}\n` +
            `  · el modelo ${quienAtiende(env, "vision").modelo} no existe o no admite imágenes\n\n` +
            "En `wrangler tail` sale el motivo exacto.\n"
        );
      }

      const { buscar, pedirNombreExacto, corregido, confirmar } =
        validarIdentificacion(identificacion);
      const marca = marcarIdentificacion(buscar, pedirNombreExacto, false, confirmar);

      const salida = await responderTexto(env, contexto("", "", "(mandó una foto)", marca));
      if (!salida) {
        return texto200(
          "La IA de visión sí identificó algo, pero la IA de texto no pudo\n" +
            "redactar la respuesta. Revisa `wrangler tail` para el motivo.\n"
        );
      }

      // Con la foto y los rasgos, para que esta ruta pruebe TAMBIÉN el
      // cotejo visual y no solo la identificación: es la única forma de
      // ver qué elige sin tener que escribirle al bot por Instagram.
      const { productos, respuestaCliente, termino } = await decidir({
        env,
        salida,
        texto: "",
        historialPrevio: "",
        foto: descargada,
        rasgos: identificacion.rasgos,
        colorFoto: nombreDeColor(identificacion.color),
        vistoFoto: identificacion.visto || "",
        tipoFoto: identificacion.tipo || "calzado",
        modeloNombrado: !pedirNombreExacto && String(buscar).toUpperCase() !== "NADA",
        porConfirmar: Boolean(confirmar),
      });

      return texto200(
        `Modelo de imágenes: ${quienAtiende(env, "vision").proveedor}, ${quienAtiende(env, "vision").modelo} ` +
          `(identificar tardó ${(tardoVision / 1000).toFixed(1)} s)\n` +
          `Modelo de texto:    ${quienAtiende(env, "texto").proveedor}, ${quienAtiende(env, "texto").modelo}\n\n` +
          `La IA de visión vio: ${identificacion.buscar}` +
          (corregido ? ` (corregido a "${buscar}" porque sus rasgos lo contradecían)` : "") +
          (confirmar ? " (sin confirmar: falta ver un detalle, lo verifica el cotejo)" : "") +
          `\nLe diría al cliente: ${revisarPagos(respuestaCliente).respuesta}\n` +
          `Buscó: ${termino || "(nada)"}\n` +
          `Encontró: ${productos.length}\n` +
          productos.map((p) => `   ${p.titulo}  —  ${p.precio}`).join("\n") +
          "\n"
      );
    }

    return new Response("emperador-bot", { status: 200 });
  }

  // EL ÍNDICE SE LLENA SOLO.
  //
  // POR QUÉ ESTO TENÍA QUE EXISTIR. Todo el cotejo visual depende del
  // índice: con él, los rasgos de la foto del cliente se comparan contra
  // los de los cientos de productos EN CÓDIGO, sin gastar un token, y
  // solo los 10 más parecidos van a una llamada. Sin él, el cotejo cae al
  // barrido corto, que mira 20 productos de 581 — el zapato casi nunca
  // está entre esos veinte.
  //
  // Y llenarlo eran ~15 recargas a mano de /indexar-catalogo. Una tarea
  // que depende de que alguien recargue quince veces no se hace nunca: el
  // índice se quedaba vacío y la mejor parte del bot, apagada. Es la
  // misma lección que dejó la columna "mostrados" — lo que se pueda
  // resolver desde el archivo que sí se copia, se resuelve ahí.
  //
  // Cloudflare llama aquí según [triggers] en wrangler.toml. Cada pasada
  // mira lo que falte dentro de un presupuesto de tiempo, y cuando ya no
  // falta nada no gasta ni una llamada al modelo: solo comprueba si
  // entraron productos nuevos, y esos los recoge sola.
}

// Cuánto se le permite tardar a una pasada. Cloudflare corta las tareas
// largas, y no hace falta terminar en una sola: lo que quede lo agarra la
// siguiente.
const PRESUPUESTO_CRON_MS = 60000;

// Los mismos 40 por tanda que usa la ruta a mano: la foto va en
// detail:"low", así que entran sin reventar el cupo de OpenAI.
const POR_TANDA_CRON = 40;

// Tope de tandas por pasada, por si el presupuesto de tiempo no llegara a
// cortar. Con 40 por tanda son 200 productos en una pasada.
const MAXIMO_TANDAS = 5;

async function indexarLoQueFalte(env) {
  // Sin tienda conectada no hay nada que catalogar. Antes de esto, el cron
  // probaba Shopify cada 15 minutos y llenaba el registro de errores.
  if (!usaDrive(env) && (!env.SHOPIFY_TIENDA || /PENDIENTE|CAMBIA-ESTO/i.test(String(env.SHOPIFY_TIENDA)))) {
    console.log("Indexación automática: SHOPIFY_TIENDA sigue en PENDIENTE, no hay catálogo que mirar");
    return;
  }

  const hasta = Date.now() + PRESUPUESTO_CRON_MS;

  // La carpeta de Drive se lee por partes: primero un trozo (lo que quepa),
  // y con lo que sobre de conexiones, el índice.
  if (usaDrive(env)) {
    const t = await leerUnTrozoDeDrive(env);
    if (t.error) console.error("Drive:", t.error);
  }

  for (let tanda = 1; tanda <= MAXIMO_TANDAS; tanda++) {
    const r = await indexarTanda(env, { cuantos: POR_TANDA_CRON });

    if (!r.ok) {
      console.error("Indexación automática: no pude arrancar —", r.error);
      return;
    }

    // Ya estaba todo mirado. Es el caso normal una vez lleno el índice, y
    // no cuesta ni una llamada al modelo.
    if (!r.pendientes) {
      if (r.quitados) console.log(`Índice: quité ${r.quitados} producto(s) que ya no están`);
      return;
    }

    console.log(
      `Indexación automática: ${r.indexados} de ${r.intentados} en esta tanda; ` +
        `faltan ${r.faltan} de ${r.catalogo}`
    );

    // Ni uno salió: no es que falte trabajo, es que algo está mal (sin
    // saldo, sin permiso para el modelo, o el cupo agotado). Insistir
    // solo gasta.
    if (r.ningunoSalio) {
      console.error(
        `Indexación automática: no salió ninguno de ${r.intentados} con ${r.modelo}. ` +
          (r.corto || `Revisa saldo y permisos de ${quienAtiende(env, "vision").proveedor} en \`wrangler tail\`.`)
      );
      return;
    }

    if (!r.faltan) {
      console.log("Índice completo: el cotejo visual ya puede mirar el catálogo entero.");
      return;
    }

    // Se quedó sin cupo a mitad, o se acabó el tiempo de esta pasada. En
    // los dos casos, lo que falta lo recoge la próxima.
    if (r.corto || Date.now() >= hasta) {
      console.log(
        `Indexación automática: corto aquí, faltan ${r.faltan}. Sigo en la próxima pasada.`
      );
      return;
    }
  }
}

/* ════════════════════════════════════════════════════════════════════
   Webhook de Meta — es el bot entero, de punta a punta
   ════════════════════════════════════════════════════════════════════ */

// Decide si un webhook merece trabajo, sin hacer ninguno. Es lo que frena
// la inundación: todo lo que devuelva null no cuesta absolutamente nada.
//
// META_MODO:
//   "todo"  (por defecto) atiende texto, fotos, historias y ecos — el bot
//           completo, sin ningún otro sistema de por medio.
//   "off"   nada; el webhook queda desactivado.
// LA PÁGINA /probar-instagram. Recorre el camino de un mensaje —token,
// suscripción, llegada, firma, envío— y dice el PRIMER paso que falla, con
// lo que hay que hacer. Ver rastro.js.
export async function diagnosticoDeInstagram(env, url) {
  const lineas = ["INSTAGRAM — por qué responde o no responde", `Código: ${VERSION}`, ""];
  const hacer = [];

  // 1. El token.
  let cuentaId = "";
  lineas.push("1. EL TOKEN (IG_TOKEN)");
  if (!env.IG_TOKEN) {
    lineas.push("   ✘ NO está cargado.");
    hacer.push("Carga el token de la cuenta de El Emperador: npx.cmd wrangler secret put IG_TOKEN");
  } else {
    const yo = await cuentaDelToken(env);
    if (yo.ok && yo.datos) {
      cuentaId = String(yo.datos.user_id || yo.datos.id || "");
      lineas.push(
        `   ✔ es de @${yo.datos.username || "?"}${yo.datos.name ? ` (${yo.datos.name})` : ""}, ` +
          `cuenta ${yo.datos.account_type || "?"}, id ${cuentaId || "?"}`,
        "     ¿Es la cuenta de El Emperador? Si es la de otra tienda, el token está cambiado."
      );
    } else {
      lineas.push(`   ✘ Instagram lo rechaza (${yo.estado}): ${yo.texto}`);
      hacer.push(
        "El IG_TOKEN no sirve (caducado, o de otra app). Genera uno nuevo en Meta → tu app → " +
          "Instagram → Configuración de la API con inicio de sesión de Instagram → " +
          "Generar token (con la cuenta de El Emperador) y cárgalo: npx.cmd wrangler secret put IG_TOKEN"
      );
    }
  }
  lineas.push("");

  // 2. La suscripción de la cuenta (sin ella Meta no manda nada).
  lineas.push("2. LA CUENTA, SUSCRITA AL WEBHOOK");
  if (env.IG_TOKEN) {
    if (url.searchParams.get("suscribir") === "si") {
      const r = await suscribirLaCuenta(env);
      lineas.push(r.ok ? `   → La suscribí ahora (${CAMPOS_DEL_WEBHOOK}).` : `   ✘ No pude suscribirla (${r.estado}): ${r.texto}`);
    }
    const sub = await suscripcionDeLaCuenta(env);
    const campos = sub.ok ? [...new Set((sub.datos?.data || []).flatMap((d) => d.subscribed_fields || []))] : [];
    if (!sub.ok) {
      lineas.push(`   ? No pude preguntarlo (${sub.estado}): ${sub.texto}`);
    } else if (campos.includes("messages")) {
      lineas.push(`   ✔ suscrita a: ${campos.join(", ")}`);
    } else {
      lineas.push(`   ✘ NO está suscrita a los mensajes${campos.length ? ` (solo a: ${campos.join(", ")})` : ""}.`);
      hacer.push(`Abre ${url.origin}/probar-instagram?suscribir=si (suscribe la cuenta; se hace una sola vez).`);
    }
  } else {
    lineas.push("   (sin IG_TOKEN no se puede mirar)");
  }
  lineas.push("");

  // 3. Lo que pasó de verdad, según el rastro.
  const r = await leerRastro(env);
  const fila = (paso, nombre) =>
    `   ${nombre.padEnd(30)} ${hace(r[paso]?.cuando)}${r[paso]?.detalle ? ` — ${r[paso].detalle}` : ""}`;
  lineas.push(
    "3. LO ÚLTIMO QUE PASÓ (se apunta solo)",
    fila("verificado", "Webhook verificado"),
    fila("llegada", "Último aviso de Meta"),
    fila("firma_mala", "Firma que NO cuadró"),
    fila("descartado", "Descartado (no era mensaje)"),
    fila("atendido", "Mensaje atendido"),
    fila("envio_ok", "Respuesta enviada"),
    fila("envio_fallido", "Envío RECHAZADO"),
    ""
  );

  const despues = (a, b) => (r[a]?.cuando || 0) > (r[b]?.cuando || 0);
  if (!r.llegada) {
    hacer.push(
      "Meta todavía NO ha mandado nada a este Worker. En developers.facebook.com → tu app → " +
        `Instagram → Webhooks: la URL tiene que ser ${url.origin}/webhook y el token de verificación ` +
        `"${env.META_VERIFY_TOKEN || "(FALTA META_VERIFY_TOKEN)"}", con el campo "messages" activado. ` +
        "Y la app tiene que estar PUBLICADA (modo Live): en modo desarrollo Meta solo manda los " +
        "mensajes de las personas que tienen un rol en la app."
    );
  } else {
    const deOtra = (r.llegada.detalle.match(/cuenta (\d+)/) || [])[1];
    if (deOtra && cuentaId && deOtra !== cuentaId) {
      hacer.push(
        `Los avisos llegan de la cuenta ${deOtra} pero el IG_TOKEN es de la ${cuentaId}: ` +
          "el token es de otra cuenta. Genera el de la cuenta de El Emperador."
      );
    }
    if (despues("firma_mala", "atendido") && despues("firma_mala", "descartado")) {
      hacer.push(
        "Llegan avisos pero la firma no cuadra: carga la clave del producto Instagram " +
          "(Meta → Instagram → Configuración de la API con inicio de sesión → Clave secreta de la app de Instagram): " +
          "npx.cmd wrangler secret put META_APP_SECRET_IG"
      );
    }
    if (r.descartado && !r.atendido && /META_MODO: off/.test(r.descartado.detalle)) {
      hacer.push('META_MODO está en "off": ponlo en "todo" en wrangler.toml.');
    }
  }

  if (despues("envio_fallido", "envio_ok")) {
    hacer.push(`Se atiende pero Instagram rechaza la respuesta: ${r.envio_fallido.detalle.slice(0, 200)}. Casi siempre es el IG_TOKEN.`);
  }

  lineas.push("4. QUÉ HACER");
  if (hacer.length) hacer.forEach((h, i) => lineas.push(`   ${i + 1}. ${h}`, ""));
  else lineas.push("   Nada: el camino está completo. Escríbele a la cuenta desde otro perfil y recarga esta página.", "");
  lineas.push(
    "DATOS PARA EL PANEL DE META",
    `   URL de devolución de llamada   ${url.origin}/webhook`,
    `   Token de verificación          ${env.META_VERIFY_TOKEN || "FALTA (META_VERIFY_TOKEN en wrangler.toml)"}`,
    ""
  );
  return lineas.join("\n");
}

// En pocas palabras, qué mandó Meta (para el rastro, sin el texto del cliente).
function queTraia(crudo) {
  try {
    const cuerpo = JSON.parse(crudo);
    const entrada = cuerpo?.entry?.[0] || {};
    const evento = entrada.messaging?.[0] || {};
    const que = entrada.changes
      ? `cambio "${entrada.changes[0]?.field || "?"}"`
      : evento.message
        ? evento.message.is_echo
          ? "eco de un mensaje enviado"
          : evento.message.attachments
            ? `mensaje con ${evento.message.attachments.map((a) => a?.type).join(", ")}`
            : "mensaje de texto"
        : Object.keys(evento).filter((k) => !["sender", "recipient", "timestamp"].includes(k)).join(", ") || "evento vacío";
    return `${cuerpo.object || "?"}: ${que} · cuenta ${entrada.id || "?"}`;
  } catch {
    return "algo que no es JSON";
  }
}

function queAtender(env, crudo) {
  const modo = (env.META_MODO || "todo").toLowerCase();
  if (modo === "off") return null;

  let cuerpo;
  try {
    cuerpo = JSON.parse(crudo);
  } catch {
    console.error("Meta mandó algo que no es JSON");
    return null;
  }

  return leerMensaje(cuerpo);
}

// EL CLIENTE NUNCA SE QUEDA EN SILENCIO (crítico).
//
// atenderMeta corre dentro de ctx.waitUntil, fuera de la respuesta a Meta.
// Si algo revienta ahí —la base sin migrar, Shopify caído, un fallo de
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
    await atenderMeta(env, mensaje, rastro);
    // ¿Contestó bien? Con todo ya enviado: el cliente no espera esto.
    if (rastro.turno?.id) await revisarTurno(env, rastro.turno);
    await guardarErrores(env.DB, env);
  } catch (error) {
    const detalle = error?.stack || error?.message || String(error);
    console.error(`ATENDER FALLÓ para ${mensaje.igsid}:`, detalle);

    // Un eco es un mensaje NUESTRO que nos rebota: el cliente no escribió
    // nada y no está esperando respuesta. Si falla el manejo del eco, lo
    // último que hay que hacer es escribirle "se me trabó el sistema" de la
    // nada, cuando él no ha dicho ni hola.
    if (!rastro.respondio && mensaje.tipo !== "eco") {
      try {
        await enviarTexto(env, mensaje.igsid, FALLO_TECNICO);
      } catch (otro) {
        console.error("Tampoco se pudo avisar al cliente:", otro?.message || otro);
      }
    }

    // ❌ en el panel: el turno que se cayó. DESPUÉS de escribirle al cliente:
    // avisar al panel central puede tardar y el cliente no espera eso.
    if (mensaje.tipo !== "eco") {
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
  // las preguntas que muestran producto —"¿me recomiendas algún calzado?"—
  // y no con un "hola": son las únicas que mandan DOS mensajes seguidos.
  //
  // Ahora cada envío se guarda en el momento, antes de hacer nada más. Son
  // dos escrituras en D1 por turno en vez de una; una pausa falsa cuesta
  // una hora de silencio con un cliente.
  // Se rellena en cuanto se carga el contacto, más abajo: el eco se atiende
  // antes y no manda nada.
  let mids = [];
  let enviadoEn = 0;

  // "texto" es lo que se le mandó, tal cual: va al panel (ver panel.js).
  // "adjuntos": las fichas que se mandaron, para verlas en el panel como
  // carrusel (ver alpha.js).
  const mandar = async (hacer, texto = "", adjuntos = null) => {
    const mid = await hacer();
    if (!mid) return "";

    rastro.respondio = true;
    mids = agregarMid(mids, mid);
    enviadoEn = Date.now();
    await marcarEnvio(env.DB, mensaje.igsid, mids, enviadoEn);
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

    if (esEcoPropio(alSegundoVistazo, mensaje.mid) || envioReciente(alSegundoVistazo)) {
      console.log(
        `Eco de ${mensaje.igsid}: al segundo vistazo era del propio bot, no pauso.`
      );
      return;
    }

    const horas = Number(env.PAUSA_HORAS) || PAUSA_HORAS_POR_DEFECTO;
    await pausar(env.DB, mensaje.igsid, horas);
    console.log(`Asesor humano le escribió a ${mensaje.igsid}: bot pausado ${horas}h`);
    // Lo que escribió el asesor también sale en el panel.
    await anotarMensaje(env.DB, mensaje.igsid, "asesor", mensaje.texto || "(mandó algo que no es texto)");

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

  // LO QUE ESCRIBIÓ, PARA EL PANEL (ver panel.js). Se guarda antes de mirar
  // la pausa: el dueño tiene que verlo aunque el bot no conteste.
  await anotarMensaje(
    env.DB,
    mensaje.igsid,
    "cliente",
    [mensaje.texto, mensaje.historia?.url ? "(respondió a una historia)" : mensaje.foto ? "(mandó una foto)" : ""].filter(Boolean).join(" "),
    // La foto que mandó (o la historia a la que respondió), para verla en el panel.
    { fotos: [mensaje.historia?.url || mensaje.foto], historia: Boolean(mensaje.historia?.url) }
  );
  // ¿Se está quejando de la respuesta? Al panel central, en el momento.
  await vigilarQueja(env, mensaje.igsid, mensaje.texto);

  if (estaPausado(contacto)) {
    console.log(`Bot pausado para ${mensaje.igsid}: no respondo`);
    await avisarQueYaLoAtienden(env, mensaje, contacto, mandar);
    return;
  }

  const esHistoria = mensaje.tipo === "historia";
  const imagenCruda = mensaje.historia.url || mensaje.foto || "";

  // Solo el primer nombre, y solo si es un nombre de persona (ver
  // primerNombre). Si no lo es, se le atiende sin nombre: mejor eso que un
  // "¡Hola, jonathanrodric982101!".
  const nombre = contacto.nombre;

  const historialPrevio = contacto.historial;
  const textoCliente =
    mensaje.texto || (imagenCruda ? (esHistoria ? "(respondió a una historia)" : "(mandó una foto)") : "");

  // "NO ES ESE": DEJAR DE ADIVINAR Y LLAMAR A UNA PERSONA (30-sep-2026).
  //
  // Caso real, cliente perdido: respondió a una historia con unas Nike
  // Waffle, el bot le enseñó P6000, el cliente dijo "no, ninguna", el bot le
  // mandó Nike Trail, el cliente volvió a señalar la historia, el bot repitió
  // lo mismo, y el cliente se fue con un "¿estás ciego?". Desde el primer
  // "no" había que pasárselo a una persona. Ver rescate.js.
  //
  // Se disculpa, avisa al asesor con la historia, y el bot se aparta como
  // cuando un asesor escribe: si el asesor tarda, sale el "TE ESTÁN
  // ESPERANDO" de siempre.
  const motivoDeRescate = hayQueRescatar(mensaje.texto, {
    yaLeMostre: (contacto.mostrados || []).length > 0 && minutosDesde(contacto.ultimo_envio) < 180,
    deUnaFoto: esHistoria || Boolean(mensaje.foto) || /\b(historia|foto)\b/i.test(historialPrevio || ""),
  });
  if (motivoDeRescate) {
    console.log(`Rescate: el cliente ${motivoDeRescate} → a un asesor, y el bot se aparta`);
    await mandar(() => enviarTexto(env, mensaje.igsid, FRASE_DE_RESCATE), FRASE_DE_RESCATE);
    await avisarAsesor(env, {
      ...paraElAviso(contacto),
      igsid: mensaje.igsid,
      mensaje: textoCliente,
      respuesta: FRASE_DE_RESCATE,
      motivo: `${MOTIVO_DE_RESCATE} (${motivoDeRescate})`,
      historial: historialPrevio,
      historia: mensaje.historia?.url || (esHistoria ? "respuesta a una historia" : ""),
    });
    const horas = Number(env.PAUSA_HORAS) || PAUSA_HORAS_POR_DEFECTO;
    await guardarContacto(env.DB, {
      ...contacto,
      nombre,
      historial: conNota(historialPrevio, `El cliente ${motivoDeRescate}: se lo pasé a un asesor.`),
      mids_enviados: mids,
      ultimo_envio: enviadoEn || Date.now(),
      pausado_hasta: Date.now() + horas * 60 * 60 * 1000,
    });
    return;
  }

  // Quien ya escribió antes y vuelve con un "hola" suelto no necesita al
  // modelo: no hay nada que buscar. La primera vez de cada cliente NO entra
  // aquí: esa bienvenida la escribe el modelo con el tono del prompt.
  if (historialPrevio && !imagenCruda && esSoloSaludo(mensaje.texto)) {
    const respuesta = saludoDeVuelta(nombre, mensaje.texto);
    console.log(`Saludo de vuelta → ${JSON.stringify(respuesta)}`);
    await mandar(() => enviarTexto(env, mensaje.igsid, respuesta), respuesta);
    await guardarContacto(env.DB, {
      ...contacto,
      nombre,
      mids_enviados: mids,
      ultimo_envio: enviadoEn || Date.now(),
    });
    return;
  }

  // "¿DÓNDE ESTÁN?": LA DIRECCIÓN TAL CUAL, CON EL BOTÓN DE GOOGLE MAPS.
  //
  // Sale del código, no del modelo: DIRECCION de wrangler.toml letra por
  // letra, como lo mandaba la automatización de ManyChat. Si el mensaje
  // es SOLO eso, aquí termina y no se gasta ni una llamada. Si además pide
  // otra cosa —"¿dónde están y tienen Jordan?"— la ubicación sale primero y
  // el resto sigue al modelo, avisado de que no la repita. Ver ubicacion.js.
  let notaUbicacion = "";
  if (!imagenCruda && hayUbicacion(env) && preguntaPorUbicacion(mensaje.texto)) {
    const lugar = mensajeDeUbicacion(env);
    console.log(
      "Preguntó la ubicación → la mando" +
        (lugar.enlace ? " con el botón de Maps" : " (sin botón: falta MAPS_URL en wrangler.toml)") +
        (lugar.foto ? " y la foto del local" : "")
    );

    if (lugar.foto && lugar.enlace) {
      // CON FOTO. La dirección entra en el título de la tarjeta si cabe (80
      // letras); si no, va entera en un mensaje y la tarjeta —foto y botón—
      // detrás. Cortarla sería peor: el cliente leería media calle.
      const cabe = [...lugar.texto].length <= 78;
      if (!cabe) await mandar(() => enviarTexto(env, mensaje.igsid, lugar.texto), lugar.texto);
      await mandar(() =>
        enviarTarjeta(env, mensaje.igsid, {
          titulo: cabe ? `📍 ${lugar.texto}` : `📍 ${String(env.TIENDA_NOMBRE || "EL EMPERADOR").toUpperCase()}`,
          texto: lugar.texto,
          resumen: "Toca el botón y te abre el mapa 👇",
          imagen: lugar.foto,
          boton: { url: lugar.enlace, title: lugar.boton },
        }),
        `📍 ${lugar.texto}`
      );
    } else {
      await mandar(() => enviarBotonEnlace(env, mensaje.igsid, lugar.texto, lugar.boton, lugar.enlace), `📍 ${lugar.texto}`);
    }

    if (soloPreguntaUbicacion(mensaje.texto)) {
      await guardarContacto(env.DB, {
        ...contacto,
        nombre,
        historial: conNota(historialPrevio, "Preguntó la ubicación y se la pasé."),
        mids_enviados: mids,
        ultimo_envio: enviadoEn || Date.now(),
      });
      return;
    }
    notaUbicacion = NOTA_UBICACION_ENVIADA;
  }

  // HORARIOS, ENVÍOS, DELIVERY, EMPLEO: EL TEXTO EXACTO DE LA TIENDA.
  //
  // Hecho el 25-sep en otra rama y traído el 30-sep (ver datos.js). Solo
  // salta cuando la pregunta VA SOLA: si nombra un calzado, o habla de
  // Cashea, sigue el camino normal y el modelo contesta las dos cosas con
  // las fichas debajo. Ni una llamada a OpenAI cuando va sola.
  //
  // AHORA LO REDACTA EL MODELO, PERSONALIZADO (30-sep-2026, pedido del
  // dueño: "más libertad para personalizar, pero con la información clara y
  // sin que alucine"). "¿Tienes delivery para Macanao?" recibía el texto
  // fijo sin nombrar Macanao. El modelo contesta con los DATOS DE LA TIENDA
  // del prompt, y revisarDatoDeLaTienda() comprueba que no se haya
  // inventado nada; si se inventó algo, sale el texto fijo de siempre.
  const datoQuePide = !imagenCruda ? queDatoPide(mensaje.texto) : "";

  // Con el catálogo en Drive, catalogo.txt está vacío: los nombres de los
  // productos son los de la carpeta (ya en memoria, no cuesta otra lectura).
  const titulosDeLaTienda =
    usaDrive(env) && !imagenCruda && (datoQuePide || preguntaPorMetodos(mensaje.texto))
      ? (await catalogoDeDrive(env)).productos.map((p) => p.titulo)
      : [];

  const datoDeLaTienda =
    datoQuePide &&
    !nombraUnProducto(mensaje.texto, titulosDeLaTienda) &&
    !preguntaPorCashea(mensaje.texto) &&
    !preguntaPorMetodos(mensaje.texto) &&
    !pideDatosDePago(mensaje.texto)
      ? datoQuePide
      : "";
  if (datoDeLaTienda) console.log(`Preguntó por ${datoDeLaTienda}: lo redacta el modelo con los datos de la tienda`);

  // "¿QUÉ MÉTODOS DE PAGO TIENEN?": TODOS, DESDE EL CÓDIGO (30-sep-2026).
  //
  // Pedido del dueño: "cuando preguntan métodos de pago envía todos los
  // métodos disponibles". La lista sale de prompts/pagos.txt, entera, y no
  // se avisa a nadie. Solo cuando va sola: si nombra un calzado o habla de
  // Cashea, contesta el modelo las dos cosas. Si PIDE LOS DATOS, tampoco
  // entra aquí: eso lo contesta el modelo con el asesor, y avisa.
  if (
    !imagenCruda &&
    hayMetodosDePago() &&
    preguntaPorMetodos(mensaje.texto) &&
    !pideDatosDePago(mensaje.texto) &&
    !nombraUnProducto(mensaje.texto, titulosDeLaTienda) &&
    !preguntaPorCashea(mensaje.texto) &&
    !queDatoPide(mensaje.texto)
  ) {
    console.log("Preguntó los métodos de pago: le mando la lista completa");
    const metodos = listaDeMetodos();
    await mandar(() => enviarTexto(env, mensaje.igsid, metodos), metodos);
    await guardarContacto(env.DB, {
      ...contacto,
      nombre,
      historial: conNota(historialPrevio, "Preguntó los métodos de pago y se los mandé todos."),
      mids_enviados: mids,
      ultimo_envio: enviadoEn || Date.now(),
    });
    return;
  }

  // El cliente PIDIÓ el catálogo por su nombre: "mándame el catálogo", "¿me
  // pasas el link de la tienda?". Eso sí es un atajo legítimo — quiere el
  // enlace, no una conversación — y se resuelve sin gastar una llamada al
  // modelo.
  //
  // OJO CON LO QUE YA NO ENTRA AQUÍ. "¿Qué más tienen?", "¿eso es todo?",
  // "¿no hay otros?" ANTES caían aquí y se llevaban el catálogo de vuelta.
  // Era el error que hacía que el bot pareciera un repartidor de enlaces en
  // vez de un vendedor: el cliente pedía ver más zapatos y recibía un link.
  // Ahora eso va al modelo, que ofrece una marca y le MUESTRA calzado.
  //
  // La talla va PRIMERO a propósito: "¿tienen más tallas?" es una pregunta
  // para el asesor, no un pedido de catálogo.
  if (!imagenCruda && !PREGUNTA_TALLA.test(mensaje.texto) && pideElCatalogo(mensaje.texto)) {
    const respuesta = fraseDeCatalogo(nombre);
    console.log(`Pidió el catálogo → ${JSON.stringify(respuesta)}`);
    await mandar(() => enviarBotonCatalogo(env, mensaje.igsid, respuesta), `${respuesta} [botón del catálogo]`);
    await guardarContacto(env.DB, {
      ...contacto,
      nombre,
      historial: conNota(historialPrevio, "Pidió el catálogo y se lo pasé."),
      mids_enviados: mids,
      ultimo_envio: enviadoEn || Date.now(),
    });
    return;
  }

  const minutosCallado = minutosDesde(contacto.ultimo_envio);

  // La foto se descarga aquí y viaja dentro de la petición. Pasarle a
  // OpenAI el enlace del CDN de Instagram no funciona: le responde 403.
  let foto = "";
  let porQueNo = "";
  if (imagenCruda) {
    ({ uri: foto, motivo: porQueNo } = await comoDataUri(env, imagenCruda));

    // LA HISTORIA ERA UN VÍDEO: ÚLTIMO INTENTO ANTES DE RENDIRSE.
    //
    // Es el caso más común de todos —la mayoría de las historias son
    // vídeo— y el más caro: quien responde a una historia está mirando
    // el zapato mientras escribe. Preguntarle "¿cuál te gustó?" cuando
    // lo tiene delante es perder la venta por un formato de archivo.
    //
    // Meta guarda una miniatura de cada vídeo. Si la da para historias,
    // es una imagen normal y el bot la mira como cualquier otra foto.
    // Si no la da, no pasa nada: se sigue exactamente como antes.
    if (!foto && porQueNo === "video" && mensaje.historia.id) {
      const miniatura = await fotogramaDeHistoria(env, mensaje.historia.id);
      if (miniatura) {
        ({ uri: foto, motivo: porQueNo } = await comoDataUri(env, miniatura));
      }
    }
  }

  // Si hay foto, primero se identifica con la IA de visión —dedicada,
  // normalmente un modelo más fuerte porque ya no tiene que redactar
  // nada— y se verifica contra sus propios rasgos (ver identificar.js).
  // El resultado se le entrega a la IA de texto como un dato más del
  // contexto: es ELLA quien decide qué decirle al cliente y cómo seguir
  // la conversación, con el mismo tono variado que usa para cualquier
  // otro mensaje. Antes una sola llamada hacía las dos cosas a la vez —
  // mirar y redactar—, y competían por la atención del modelo.
  let marcaFoto = "";
  // Los rasgos que la IA marcó en la foto siguen vivos después de
  // identificar: el cotejo visual los usa para elegir contra QUÉ
  // productos comparar, en vez de contra los primeros que devuelva
  // Shopify (ver cotejo.js).
  let rasgosFoto = null;
  // El color que la IA vio en el zapato. Ordena los candidatos para que
  // no se le mande el mismo modelo en otro color.
  let colorFoto = "";
  // La frase de lo que la IA vio. Desempata los zapatos sin logo.
  let vistoFoto = "";
  // La visión llegó al MODELO, no se quedó en la marca.
  let modeloNombrado = false;
  // La foto era una vitrina: la tienda entera, un estante, muchos pares.
  let eraLaVitrina = false;
  // El modelo se nombró pero el detalle que lo confirmaría no se ve en la
  // foto (ver identificar.js). Se busca igual, y el cotejo visual lo
  // verifica contra la foto real del catálogo — incluso si hay un solo
  // resultado, que es cuando más falta hace.
  let porConfirmar = false;
  // Qué TIPO de producto es lo de la foto: calzado, gorra, bolso, ropa.
  let tipoFoto = "";
  if (foto) {
    const identificacion = await identificarEnImagen(env, foto);
    if (identificacion) {
      const { buscar, pedirNombreExacto, confirmar } = validarIdentificacion(identificacion);

      // SIN ESTA LÍNEA NO SE PUEDE DEPURAR NADA. Un barrido que no
      // encuentra y un nombre mal identificado se ven igual en los
      // registros si no queda escrito qué vio y qué va a buscar.
      // La descripción se registra entera a propósito: en los zapatos sin
      // logo es lo ÚNICO que los distingue, así que si uno falla hay que
      // poder leer qué vio exactamente.
      console.log(
        `La IA de visión vio (${identificacion.tipo || "calzado"}): "${identificacion.visto}"` +
          (identificacion.color ? ` · color: ${identificacion.color}` : " · color: no lo distingue") +
          ` → busco: "${buscar}"` +
          (confirmar ? " (sin confirmar)" : "")
      );

      tipoFoto = identificacion.tipo || "calzado";
      marcaFoto = marcarIdentificacion(buscar, pedirNombreExacto, esHistoria, confirmar, tipoFoto);
      rasgosFoto = identificacion.rasgos;
      colorFoto = nombreDeColor(identificacion.color);
      vistoFoto = identificacion.visto || "";
      modeloNombrado = !pedirNombreExacto && String(buscar).toUpperCase() !== "NADA";

      // UNA VITRINA NO SE ADIVINA. Solo cuenta si el cliente no nombró
      // nada: si escribió "las Nike blancas", eso manda aunque la foto
      // sea un estante lleno.
      eraLaVitrina =
        Boolean(identificacion.variosProductos) && !textoPideAlgo(mensaje.texto);

      if (eraLaVitrina) {
        console.log(
          "La foto es la tienda entera, no un zapato: le mando el catálogo " +
            "completo en vez de adivinar cuál miraba"
        );
      }
      porConfirmar = Boolean(confirmar);
    } else {
      console.error(
        "La IA de visión no respondió: trato la foto como si no se hubiera podido ver"
      );
      foto = "";
      porQueNo = porQueNo || "otro";
    }
  }

  // Si no se puede mirar, NO es el final del camino. La mayoría de las
  // historias son vídeo, y el cliente que responde a una historia es el que
  // más cerca está de comprar: se le atiende por lo que escribió.
  const marca = imagenCruda ? (foto ? marcaFoto : marcarSinVer(porQueNo)) : "";

  const entrada = contexto(
    nombre,
    historialPrevio,
    textoCliente,
    [marca, notaUbicacion, datoDeLaTienda ? notaDeDatoDeLaTienda(datoDeLaTienda) : ""].filter(Boolean).join("\n"),
    esHistoria,
    minutosCallado
  );

  let salida = await responderTexto(env, entrada);

  // LA RED DE LOS DATOS DE LA TIENDA. Si el modelo no respondió, o se
  // inventó algo (un precio de envío, una zona gratis, una hora), sale el
  // texto fijo: exactamente lo que salía antes de darle libertad.
  if (datoDeLaTienda) {
    const revision = revisarDatoDeLaTienda(salida?.respuesta, datoDeLaTienda);
    if (!salida || revision.corregido) {
      console.log(
        `Datos de la tienda (${datoDeLaTienda}): ` +
          (salida ? `el modelo ${revision.motivos.join(" y ")}` : "el modelo no respondió") +
          " → mando el texto fijo"
      );
      salida = {
        respuesta: RESPUESTAS[datoDeLaTienda],
        buscar: "NADA",
        historial: conNota(historialPrevio, `Preguntó por ${datoDeLaTienda} y se lo respondí.`),
      };
    }
  }

  // Y si además el modelo falla, la pregunta se la hacemos nosotros, que es
  // infinitamente mejor que decirle que el sistema se trabó.
  if (!salida && imagenCruda && !foto) {
    const frase = HISTORIA_SIN_VER[Math.floor(Math.random() * HISTORIA_SIN_VER.length)];
    console.log(`Historia sin ver (${porQueNo}) → pregunto: ${JSON.stringify(frase)}`);
    await mandar(() => enviarTexto(env, mensaje.igsid, frase), frase);
    await guardarContacto(env.DB, {
      ...contacto,
      nombre,
      mids_enviados: mids,
      ultimo_envio: enviadoEn || Date.now(),
    });
    return;
  }

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
      { igsid: mensaje.igsid, cliente: textoCliente, respuesta: FALLO_TECNICO, marca: "error", motivo: "La IA no respondió (DeepSeek falló o tardó demasiado)" },
      env
    );
    return;
  }

  let {
    productos,
    respuestaCliente,
    termino,
    preguntoTalla,
    buscoSinExito,
    seAcabaron,
    hayMasDelCatalogo,
    noReconociLaFoto,
    sinCupo,
    alternativa,
    categoria,
  } = await decidir({
    env,
    salida,
    texto: mensaje.texto,
    historialPrevio,
    mostrados: contacto.mostrados,
    // Solo si pide algo DISTINTO se descarta lo que ya vio. Una foto no
    // cuenta: quien manda una foto está pidiendo ESE zapato, no otro.
    pideMas: !imagenCruda && pideMasVariedad(mensaje.texto),
    foto,
    rasgos: rasgosFoto,
    colorFoto,
    vistoFoto,
    tipoFoto,
    modeloNombrado,
    eraLaVitrina,
    porConfirmar,
    recibidoEn: mensaje.recibidoEn,
  });

  // LOS DATOS PARA PAGAR NO SALEN DE ACÁ (crítico).
  //
  // El bot enumera los métodos de pago —eso lo sabe, está en
  // prompts/pagos.txt— pero no tiene ni un número de cuenta, y prometer que
  // los manda deja al cliente esperando un mensaje que no llega. Peor:
  // escribir una cuenta inventada es mandar a alguien a transferirle dinero
  // a nadie. El prompt ya lo prohíbe con todas las letras; esto es la red
  // debajo, por lo mismo que cuotas.js en el bot de teléfonos. Ver pagos.js.
  const revisionDePagos = revisarPagos(respuestaCliente);
  let avisePorLosPagos = false;
  if (revisionDePagos.corregido) {
    // AL ASESOR SE LE MANDA LO QUE EL BOT IBA A DECIR, no lo corregido: el
    // aviso existe para que una persona vea el invento y le dé al cliente
    // el dato bueno.
    const loQueIbaADecir = respuestaCliente;
    respuestaCliente = revisionDePagos.respuesta;
    avisePorLosPagos = true;

    await avisarAsesor(env, {
      ...paraElAviso(contacto),
      igsid: mensaje.igsid,
      mensaje: textoCliente,
      respuesta: loQueIbaADecir,
      motivo: `IBA A DAR DATOS DE PAGO — ${revisionDePagos.motivos.join("; ")}`,
      historial: salida.historial,
      busco: termino,
      productos,
      historia: esHistoria ? "respuesta a una historia" : "",
    });
  }

  // CASHEA: LA CUENTA DE ESTE CLIENTE, CON SU NIVEL Y SU ZAPATO.
  //
  // Primero la red: si el modelo escribió un porcentaje de Cashea que no es
  // el de la tabla —o cualquiera, con la promoción fuera de fecha—, se
  // cambia por lo de verdad. Después, si el cliente preguntó por Cashea, va
  // la tarjeta armada por cashea.js: las cuentas las hace el código, no el
  // modelo. Ver cashea.js.
  // EL TONO (2-oct-2026, ver tono.js): ni una grosería, ni un insulto, ni
  // un regaño salen del bot, por mucho que el cliente provoque.
  const revisionDeTono = revisarTono(respuestaCliente);
  if (revisionDeTono.corregido) respuestaCliente = revisionDeTono.respuesta;

  const revisionDeCashea = revisarCashea(respuestaCliente);
  if (revisionDeCashea.corregido) respuestaCliente = revisionDeCashea.respuesta;

  const nivelCashea = nivelDelCliente(mensaje.texto) ?? nivelEnElHistorial(historialPrevio);
  if (nivelDelCliente(mensaje.texto) !== null) {
    salida.historial = conNota(salida.historial || historialPrevio, notaDeNivel(nivelCashea));
  }

  let tarjetaDeCashea = "";
  let casheaFueraDeFecha = false;
  // La tarjeta dice que los MONTOS los confirma un asesor (2-oct-2026): se
  // le avisa siempre, aunque la tarjeta vaya detrás de los zapatos.
  let casheaMontosAlAsesor = false;
  // Cashea sin tabla de niveles (El Emperador): la inicial la da un asesor,
  // así que se le avisa aunque la tarjeta vaya detrás de los zapatos.
  let casheaSinTabla = false;
  if (!revisionDeCashea.corregido && preguntaPorCashea(mensaje.texto)) {
    if (casheaVigente()) {
      tarjetaDeCashea = tarjetaCashea({ nivel: nivelCashea, productos });
      casheaMontosAlAsesor = tarjetaDeCashea.toLowerCase().includes(ASESOR_CONFIRMA_MONTOS.toLowerCase());
      casheaSinTabla = !hayTablaCashea();
      console.log(
        `Preguntó por Cashea → tarjeta ` +
          (nivelCashea ? `con su Nivel ${nivelCashea}` : "con la tabla") +
          (productos.length ? ` y la cuenta de ${Math.min(productos.length, 3)} zapato(s)` : "")
      );
    } else if (hayCashea()) {
      // Cargado pero fuera de fecha: al asesor, sin prometer nada.
      console.log("Preguntó por Cashea con la promoción fuera de fecha → al asesor");
      casheaFueraDeFecha = true;
      if (productos.length) tarjetaDeCashea = CASHEA_FUERA_DE_FECHA;
      else respuestaCliente = CASHEA_FUERA_DE_FECHA;
    }
  }

  // LA TARJETA NO VA DETRÁS DE UN "TE LO CONFIRMA UN ASESOR" (30-sep-2026).
  //
  // El dueño lo vio en producción: el cliente preguntaba "¿tienes Cashea?",
  // el modelo —por su regla general de mandar al asesor lo que no sabe—
  // escribía "Eso te lo confirma un asesor en un momento 😊", y la tabla
  // salía DEBAJO. El cliente leía "asesor" primero, y encima esa frase
  // disparaba un aviso a Slack. Si va la tarjeta, lo del asesor sobra: se
  // quita, y si no queda nada, la tarjeta va sola.
  if (tarjetaDeCashea && tarjetaDeCashea !== CASHEA_FUERA_DE_FECHA) {
    const sinAsesor = respuestaCliente
      .split(/(?<=[.!?😊🙌])\s+/)
      .filter((frase) => !/\basesor/i.test(frase))
      .join(" ")
      .trim();
    if (sinAsesor !== respuestaCliente.trim()) {
      console.log("Cashea: quito el 'te lo confirma un asesor' del modelo, va la tarjeta");
    }
    // Con zapatos, el texto va solo antes del carrusel: nunca vacío.
    respuestaCliente = sinAsesor || (productos.length ? "¡Claro que sí! 🙌 Mira 👇" : "");
  }

  // Sin zapatos que enseñar, la tarjeta va en el MISMO mensaje que la frase
  // del modelo ("¡Claro que sí! Mira cómo te queda 👇"): un solo mensaje se
  // lee mejor que dos seguidos. Con zapatos, va detrás del carrusel.
  if (tarjetaDeCashea && !productos.length && !buscoSinExito && !seAcabaron && !hayMasDelCatalogo) {
    respuestaCliente = respuestaCliente ? `${respuestaCliente}\n\n${tarjetaDeCashea}` : tarjetaDeCashea;
    tarjetaDeCashea = "";
  }

  // EL CATÁLOGO NO ES LA RESPUESTA POR DEFECTO (crítico).
  //
  // Antes, TODA respuesta sin productos salía con el botón del catálogo
  // pegado debajo. Eso convertía cada pregunta de vendedora —"¿es para ti o
  // para regalo?", "¿lo prefieres deportivo o casual?"— en un empujón a la
  // tienda online, que es justo lo contrario de vender: el cliente que se
  // va al catálogo se va de la conversación.
  //
  // El botón sale en UN solo caso: buscamos lo que pidió y no apareció. Ahí
  // sí ayuda, porque el cliente no encontró lo suyo y el catálogo es la
  // alternativa honesta mientras el asesor confirma.
  //
  // ESTE es el bloque donde nacía la pausa falsa: manda DOS mensajes
  // seguidos —el texto y luego el carrusel— y antes el mid del primero no
  // se guardaba hasta después del segundo. Su eco llegaba en medio y el bot
  // se pausaba solo. Por eso pasaba con "¿me recomiendas algún calzado?" y
  // no con un "hola": solo estas respuestas mandan dos cosas. mandar()
  // guarda cada envío en el momento y cierra esa ventana.
  if (productos.length) {
    await mandar(() => enviarTexto(env, mensaje.igsid, respuestaCliente), respuestaCliente);
    await mandar(() => enviarFichas(env, mensaje.igsid, productos), `📷 Fichas: ${productos.map((p) => p.titulo).join(" · ")}`, { fichas: productos });
  } else if (buscoSinExito || seAcabaron || hayMasDelCatalogo) {
    // Tres motivos distintos, misma salida: el cliente quería ver algo y no
    // hay nada (más) que enseñarle en una ficha. Ahí el enlace de la tienda
    // sí es una ayuda — incluido cuando SÍ hay más, pero no caben en un
    // carrusel de 10 (hayMasDelCatalogo, ver decidir()).
    await mandar(() => enviarBotonCatalogo(env, mensaje.igsid, respuestaCliente), `${respuestaCliente} [botón del catálogo]`);
  } else {
    // Conversación: preguntas, dudas, cortesías. Texto limpio, sin botón.
    await mandar(() => enviarTexto(env, mensaje.igsid, respuestaCliente), respuestaCliente);
  }

  // LO QUE PENSÓ LA IA, PARA EL PANEL (ver panel.js): qué entendió, qué
  // buscó, de qué categoría, qué fichas salieron y qué corrigieron las redes.
  const turnoDelPanel = {
    igsid: mensaje.igsid,
    cliente: textoCliente,
    pienso: salida.pienso,
    buscar: salida.buscar,
    mostrar: productos.length ? "texto_e_imagenes" : "texto",
    respuesta: respuestaCliente,
    productos: productos.map((p) => p.titulo),
    notas: [
      categoria && `categoría: ${categoria}`,
      revisionDeTono.corregido && "se quitó una grosería o un regaño",
      revisionDeCashea.corregido && "Cashea: se corrigió lo que escribió",
      revisionDePagos.corregido && "iba a dar datos de pago: se corrigió",
      tarjetaDeCashea && "fue la tarjeta de Cashea",
      (buscoSinExito || seAcabaron || hayMasDelCatalogo) && "fue el botón del catálogo",
    ],
  };
  // El revisor lo mira cuando todo ya salió (ver atenderConRed y revisor.js).
  rastro.turno = {
    ...turnoDelPanel,
    id: await anotarTurno(env.DB, turnoDelPanel, env),
    fichas: productos.map((p) => `${p.titulo}${p.precio ? ` · ${p.precio}` : ""}`),
    // Para el revisor: con qué comparar lo que dijo (ver revisor.js).
    categoria,
    contexto: datosParaElRevisor(env),
  };

  // La tarjeta de Cashea, cuando no fue dentro del mensaje de arriba: va
  // DETRÁS de los zapatos, que es donde se lee "y con tu nivel, esto".
  if (tarjetaDeCashea) {
    await mandar(() => enviarTexto(env, mensaje.igsid, tarjetaDeCashea), tarjetaDeCashea);
  }

  // Cashea fuera de fecha avisa SIEMPRE, aunque se le hayan enseñado
  // zapatos: el cliente quiere pagar así y alguien le tiene que contestar.
  //
  // Y quien PIDE LOS DATOS para pagar —número de cuenta, "¿a dónde
  // transfiero?"—, también, aunque se le estén enseñando zapatos: es lo
  // único de pagos que va al asesor (pedido del dueño, 30-sep-2026).
  const pidioDatos = pideDatosDePago(mensaje.texto);
  const escalada =
    casheaFueraDeFecha ||
    casheaMontosAlAsesor ||
    casheaSinTabla ||
    pidioDatos ||
    hayEscalada({
      respuesta: respuestaCliente,
      productos,
      preguntoTalla,
      buscoSinExito,
      noReconociLaFoto,
    });

  // Si ya se avisó por los datos de pago, no se avisa otra vez: la frase
  // con la que se corrigió lleva "en un momento" y hayEscalada la leería
  // como una escalada nueva.
  if (escalada && !avisePorLosPagos) {
    await avisarAsesor(env, {
      ...paraElAviso(contacto),
      igsid: mensaje.igsid,
      mensaje: textoCliente,
      respuesta: respuestaCliente,
      motivo: casheaFueraDeFecha
        ? `PREGUNTO POR CASHEA FUERA DE LA PROMOCION${fechasDeLaPromocion() ? ` (${fechasDeLaPromocion().toUpperCase()})` : ""}`
        : casheaMontosAlAsesor
          ? `CASHEA${nivelCashea ? ` NIVEL ${nivelCashea}` : ""}: CONFIRMARLE LOS MONTOS DE LA INICIAL Y LAS CUOTAS`
        : casheaSinTabla
          ? `QUIERE PAGAR CON CASHEA${nivelCashea ? ` (NIVEL ${nivelCashea})` : ""}: CONFIRMARLE LA INICIAL`
        : pidioDatos && !preguntoTalla
          ? "PIDE LOS DATOS PARA PAGAR"
          : motivoDeLaEscalada({ preguntoTalla, noReconociLaFoto, sinCupo, categoria }),
      historial: salida.historial,
      busco: termino,
      productos,
      historia: esHistoria ? "respuesta a una historia" : "",
    });
  }

  await guardarContacto(env.DB, {
    id: mensaje.igsid,
    nombre,
    // Si al final le enseñamos un modelo distinto del que escribió el
    // modelo en "buscar", el historial tiene que decirlo: si no, el próximo
    // "¿cuánto cuestan?" le da el precio del zapato que NO está viendo.
    historial: recortarHistorial(
      alternativa
        ? conNota(salida.historial || historialPrevio, `Ya busqué: ${alternativa}.`)
        : salida.historial || historialPrevio
    ),
    pausado_hasta: contacto.pausado_hasta,
    mids_enviados: mids,
    // Si TODOS los envíos fallaron, enviadoEn sigue en 0 y no hay que pisar
    // la marca anterior con un cero: eso apagaría la red de envioReciente().
    ultimo_envio: enviadoEn || contacto.ultimo_envio,
    // Lo que acaba de ver queda anotado para no volver a mandárselo cuando
    // pida más. Es lo que evita el "son los mismos".
    mostrados: conProductosMostrados(contacto.mostrados, productos),
  });
}

// El cliente escribió mientras un asesor lleva la conversación.
//
// Se le confirma que lo tienen, sin contestar lo que preguntó. Y si el
// asesor lleva un rato largo sin decir nada, se le da un toque por Slack:
// un cliente esperando con el asesor distraído es una venta que se enfría.
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
  const yaTeAtienden = alAzar(YA_TE_ATIENDEN);
  await mandar(() => enviarTexto(env, mensaje.igsid, yaTeAtienden), yaTeAtienden);

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

// Las columnas nuevas (nombre_completo, usuario, mostrados) se crean solas
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

// Lo que se le dice al modelo cuando la historia no se pudo mirar. Es la
// diferencia entre que el cliente reciba una pregunta de vendedora o un
// mensaje de avería.
function marcarSinVer(motivo) {
  if (motivo === "video") {
    return (
      "[EL CLIENTE RESPONDIÓ A UNA HISTORIA QUE ES UN VÍDEO Y NO PUEDES VERLA]\n" +
      "[NO digas que hubo un error ni que no puedes ver vídeos. Pregúntale con " +
      "naturalidad cuál de los modelos de la historia le interesa, y si en su " +
      "mensaje ya nombra uno, búscalo directamente]"
    );
  }
  return (
    "[EL CLIENTE RESPONDIÓ A UNA HISTORIA PERO NO PUDISTE VER LA IMAGEN]\n" +
    "[NO digas que hubo un error. Pregúntale cuál modelo le interesa]"
  );
}

// El bloque de contexto que le dice a la IA de texto qué encontró la IA de
// visión en la foto. Reemplaza a la vieja responderImagen(): la
// identificación ya pasó por identificar.js antes de llegar aquí, así que
// lo que se le pasa a la IA de texto es el dato ya corregido — ella no
// tiene que desconfiar de él, solo redactar con su propio tono, exactamente
// como con cualquier otro mensaje.
const NOMBRE_DEL_TIPO = {
  calzado: "UN CALZADO", gorra: "UNA GORRA", bolso: "UN BOLSO", franela: "UNA FRANELA",
  pantalon: "UN PANTALÓN", short: "UN SHORT", uniforme: "UN UNIFORME", otro: "UN PRODUCTO",
};

function marcarIdentificacion(buscar, pedirNombreExacto, esHistoria, confirmar = false, tipo = "calzado") {
  const queEs = NOMBRE_DEL_TIPO[tipo] || "UN PRODUCTO";
  const encabezado = esHistoria
    ? `[EL CLIENTE RESPONDIÓ A UNA HISTORIA — la imagen que ves ES la historia (es ${queEs}). `
    : `[EL CLIENTE MANDÓ UNA FOTO DE ${queEs}. `;

  if (String(buscar).toUpperCase() === "NADA") {
    return (
      encabezado +
      "NO SE PUDO PONERLE NOMBRE AL MODELO. Se le van a enseñar los del " +
      "catálogo que más se parecen a su foto, así que escribe una frase " +
      "corta y cálida que lo invite a mirarlos y decir cuál es. " +
      "PROHIBIDO decir que no lo reconoces, que no sabes o que no se ve; " +
      "PROHIBIDO pedirle el nombre del modelo —si lo supiera lo habría " +
      "escrito en vez de mandar una foto— y PROHIBIDO pedirle otra foto" +
      (esHistoria ? ": ya tienes la imagen delante." : ".") +
      "]"
    );
  }

  // Se reconoció el modelo pero un detalle suyo no se alcanza a ver, así
  // que no se afirma: se le muestra y se le pregunta si es ese. Si el
  // cotejo visual lo confirma después contra la foto del catálogo, esta
  // respuesta se reemplaza por una segura antes de salir.
  if (confirmar) {
    return (
      encabezado +
      `SE VE UN "${buscar}", PERO NO SE PUDO CONFIRMAR DEL TODO: un detalle ` +
      "del modelo no se alcanza a ver en la foto. Muéstraselo Y pregúntale " +
      "si es ese el que le gustó, las dos cosas en el mismo mensaje. NO " +
      "afirmes con seguridad que es ese.]"
    );
  }

  if (pedirNombreExacto) {
    return (
      encabezado +
      `SE RECONOCIÓ LA MARCA "${buscar}", PERO NO EL MODELO EXACTO. ` +
      "Muéstrale lo que hay de esa marca y pregúntale CUÁL DE ESOS es el " +
      "suyo. No le pidas el nombre del modelo: el cliente que manda una " +
      "foto casi nunca lo sabe, y preguntárselo lo deja sin salida. " +
      "Elegir entre lo que tiene delante sí puede.]"
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
//
// "minutosCallado" es cuánto tiempo pasó desde que el bot le escribió por
// última vez a esta persona. historial.js lo usa para avisarle al modelo
// que no dé por hecho que se sigue hablando del mismo producto.
function contexto(nombre, historial, texto, marca = "", esHistoriaNueva = false, minutosCallado = 0) {
  return contextoParaElModelo({
    nombre: primerNombre(nombre),
    historial,
    texto,
    marca,
    esHistoriaNueva,
    minutosDesdeElUltimo: minutosCallado,
  });
}

// De la marca de tiempo del último envío a minutos, para contexto().
function minutosDesde(ultimoEnvio) {
  const ultimo = Number(ultimoEnvio) || 0;
  if (!ultimo) return 0;
  return Math.max(0, Math.round((Date.now() - ultimo) / 60000));
}

// Deja solo el primer nombre, y lo descarta si parece un usuario de Instagram
// en vez de un nombre. El prompt ya lo pide, pero aquí es una certeza: un
// "¡Hola jonathanrodric982101!" no puede llegarle a un cliente.
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
  /^\s*[¡!]*\s*hola\b[^\n]{0,25}?\bsoy\s+la\s+asistente(\s+virtual)?(\s+de\s+[^\n]{0,30}?)?\s*[👋😊🙌]*\s*[.!,]*\s*/i;

function sinBienvenida(respuesta) {
  const recortado = respuesta.replace(PRESENTACION, "").trim();
  // Si al quitarla no queda nada que decir, es que el mensaje era solo el
  // saludo: se sustituye por el saludo corto en vez de dejarlo vacío.
  if (!recortado) return "¡Hola! ¿Qué estás buscando? 😊";
  return recortado.charAt(0).toUpperCase() + recortado.slice(1);
}

// De lo que escribió el modelo a lo que se le manda al cliente: se le quita
// la talla al término, se separa el color, se busca en Shopify y se decide
// si la respuesta del modelo sirve o hay que sustituirla.
async function decidir({
  env,
  salida,
  texto,
  historialPrevio,
  mostrados = [],
  pideMas = false,
  // La foto del cliente, ya en data URI. Solo viene en mensajes con
  // imagen, y es lo que habilita el cotejo visual contra el catálogo.
  foto = "",
  // Lo que la IA de visión marcó que VE en esa foto. El cotejo elige por
  // ahí contra qué productos comparar.
  rasgos = null,
  // El color del zapato de la foto, en una palabra. Ordena los candidatos
  // para que no se le mande el mismo modelo en otro color.
  colorFoto = "",
  // Lo que la IA describió de la foto. Es lo único que distingue un
  // zapato liso de otro: en los 15 rasgos, todos los lisos empatan.
  vistoFoto = "",
  // Qué TIPO de producto es lo de la foto (calzado, gorra, bolso, ropa).
  tipoFoto = "",
  // La visión nombró un MODELO concreto, no solo la marca. Si además la
  // búsqueda encontró producto, el índice no debe cambiarlo por otro.
  modeloNombrado = false,
  // La foto era la tienda entera. No hay nada que buscar: toca el catálogo.
  eraLaVitrina = false,
  // El modelo se identificó pero sin confirmar del todo: el cotejo pasa a
  // verificar, no solo a desempatar.
  porConfirmar = false,
  // Cuándo llegó el mensaje. El cotejo lo usa para saber si le da el
  // tiempo de esperar el cupo de OpenAI.
  recibidoEn = 0,
}) {
  const preguntoTalla = PREGUNTA_TALLA.test(texto);

  // LA FOTO ERA LA VITRINA: NI SE BUSCA.
  //
  // No hay un zapato que encontrar, así que buscar es gastar llamadas
  // para acabar adivinando. Se le manda el catálogo completo, que es
  // exactamente lo que estaba pidiendo al mirar la tienda entera.
  if (eraLaVitrina) {
    salida.respuesta = alAzar(ERA_LA_VITRINA);
    salida.historial = conNota(
      salida.historial,
      "Mandó una foto de la tienda entera; le pasé el catálogo completo."
    );
    // hayMasDelCatalogo es lo que hace salir el botón del catálogo (ver
    // dónde se decide el envío). Los demás campos van en su forma normal
    // para que quien llama no tenga que saber de este caso.
    return {
      preguntoTalla,
      termino: "",
      aBuscar: "",
      colores: [],
      productos: [],
      buscoSinExito: false,
      seAcabaron: false,
      hayMasDelCatalogo: true,
      alternativa: "",
      respuestaCliente: salida.respuesta,
    };
  }

  // El modelo cuela la talla en el término cuando el cliente la nombra, y eso
  // devuelve cero productos siempre. Se le quita antes de buscar.
  // BOTAS TÁCTICAS vs. BÁSQUET: si el cliente habla de básquet, la búsqueda
  // no puede ser la de las tácticas (y al revés). Ver catalogo.js.
  const botas = corregirBusquedaDeBotas(texto, salida.buscar, historialPrevio);
  if (botas.corregido) {
    console.log(`Botas: "${salida.buscar}" no es lo que pidió → busco "${botas.buscar}"`);
    salida.buscar = botas.buscar;
    salida.respuesta = botas.respuesta;
    salida.historial = conNota(salida.historial || historialPrevio, botas.nota);
  }

  const termino = salida.buscar.toUpperCase() === "NADA" ? "" : sinTalla(salida.buscar);

  // QUÉ TIPO DE PRODUCTO (5-oct-2026): calzado, bolso, camisa, pantalón o
  // gorra. Solo se enseñan de ese tipo. Ver categoriaDeLaBusqueda().
  const categoria = categoriaDeLaBusqueda({ salida, texto, tipoFoto, termino });
  if (categoria) console.log(`Categoría de la búsqueda: ${categoria}`);
  if (salida.buscar !== termino && termino) {
    console.log(`Quité la talla del término: "${salida.buscar}" -> "${termino}"`);
  }

  // El color se saca del término y se aplica DESPUÉS, sobre los títulos que
  // devolvió Shopify. Buscarlo dentro de la consulta fallaría: tus títulos
  // mezclan idiomas ("full Black" junto a "Negro dama") y géneros ("blanca",
  // "blancos"), y Shopify no sabe que café y marrón son lo mismo.
  const { termino: sinColor, colores } = separarColor(termino);

  // Si solo dijo el color, sin modelo, el color pasa a ser la búsqueda.
  const aBuscar = sinColor || terminoDeColor(colores);

  if (colores.length) {
    console.log(`Color pedido: ${colores.join(" + ")} · busco: "${aBuscar}"`);
  }

  let productos = [];
  let habiaDelModelo = 0;
  // "hayMasEnCatalogo": Shopify tenía más de los 10 que caben en un
  // carrusel de Instagram. Solo es de fiar cuando NO se filtra por color
  // después: filtrar por color puede bajar el conteo por debajo de 10 sin
  // que eso signifique que ya no hay más — y sin volver a consultar
  // Shopify no hay forma honesta de saber cuántos habría de ESE color.
  let hayMasEnCatalogo = false;
  if (aBuscar) {
    // CUANDO HAY QUE FILTRAR POR COLOR, SE PIDEN MUCHOS MÁS (24-sep-2026).
    //
    // Capturado en producción. El cliente escribió "Air Force One marrón
    // blanco", que EXISTE en el catálogo — y el bot contestó que no hay:
    //
    //   Color pedido: blanco + marrón · busco: "Air Force One"
    //   Del modelo había 10; en blanco + marrón quedan 0
    //   Sin resultados para "Air Force One"
    //
    // El catálogo tiene TRECE "Air Force One" y la búsqueda pedía diez.
    // El filtro de color corre aquí, sobre lo que llegó, así que se
    // aplicaba a una lista ya recortada: el marrón y blanco estaba en los
    // tres que nunca se pidieron.
    //
    // El filtro tiene que ser lo último que recorte, nunca lo segundo. Se
    // pide un grupo grande, se filtra por color, y lo que quede se recorta
    // después al tamaño del carrusel.
    const cuantosPedir = colores.length && sinColor ? CUANTOS_PARA_FILTRAR : undefined;
    const resultado = await buscarProductos(env, aBuscar, cuantosPedir, { categoria });
    productos = resultado.productos;
    habiaDelModelo = productos.length;

    // Solo se filtra cuando el color no ES la búsqueda: si ya buscamos
    // "negr" en Shopify, volver a filtrar por negro no aporta nada.
    if (colores.length && sinColor) {
      productos = filtrarPorColor(productos, colores);
      console.log(
        `Del modelo había ${habiaDelModelo}; en ${colores.join(" + ")} quedan ${productos.length}`
      );
      // Ahora sí, al tamaño del carrusel.
      if (productos.length > MAXIMO_EN_CARRUSEL) {
        hayMasEnCatalogo = true;
        productos = productos.slice(0, MAXIMO_EN_CARRUSEL);
      }
    } else {
      hayMasEnCatalogo = resultado.hayMas;
    }

    console.log(
      productos.length
        ? `Busqué "${aBuscar}": ${productos.length} resultado(s)`
        : `Sin resultados para "${aBuscar}"`
    );
  }

  // NO HAY DE ESO, PERO SÍ DE ESA CATEGORÍA (5-oct-2026). "Bolsos Gucci" sin
  // ningún bolso Gucci: un vendedor no dice "no hay" y se cruza de brazos,
  // saca los bolsos que sí tiene. Solo por texto (con una foto manda el
  // cotejo) y solo si lo pedido era más que la categoría.
  let otrosDeLaCategoria = false;
  if (!foto && categoria && aBuscar && !productos.length) {
    const deLaCategoria = await buscarProductos(env, "", MAXIMO_EN_CARRUSEL, { categoria });
    if (deLaCategoria.productos.length) {
      productos = deLaCategoria.productos;
      otrosDeLaCategoria = true;
      hayMasEnCatalogo = deLaCategoria.hayMas;
      const k = CATEGORIAS[categoria];
      salida.respuesta = alAzar(OTROS_DE_LA_CATEGORIA).replaceAll("{cosa}", k.plural).replaceAll("{emoji}", k.emoji);
      salida.historial = conNota(salida.historial || historialPrevio, `No había "${aBuscar}"; le enseñé otros de ${k.nombre}.`);
      console.log(`No había "${aBuscar}": le enseño ${productos.length} de la categoría ${categoria}`);
    }
  }

  // COTEJO VISUAL (solo si esto vino de una foto).
  //
  // Hasta aquí el reconocimiento pasó por un NOMBRE: la IA de visión dijo
  // "Vapormax" y se buscó esa palabra. Si el nombre no acertó, no hay
  // productos — o hay diez de la marca, sin saber cuál es el de la foto.
  //
  // Esto compara la foto del cliente contra las fotos REALES del
  // catálogo y saca el par que es. Ver ./cotejo.js: no corre siempre, y
  // cuando no está seguro devuelve null y todo sigue igual que sin él.
  let cotejoAcerto = false;
  // Lo rellena el cotejo: sinCupo = true si algo se quedó sin mirar porque
  // OpenAI no tenía cupo.
  const informeCotejo = {};
  if (foto) {
    const cotejo = await cotejoPorImagen({
      env,
      foto,
      textoCliente: texto,
      productos,
      termino: aBuscar,
      rasgos,
      color: colorFoto,
      visto: vistoFoto,
      nombreFiable: modeloNombrado,
      verificar: porConfirmar,
      // El barrido del catálogo completo es el último recurso y el único
      // paso caro de todo esto. Se apaga con COTEJO_BARRIDO = "no".
      barrer: env.COTEJO_BARRIDO !== "no",
      recibidoEn,
      informe: informeCotejo,
      tipo: tipoFoto,
    });

    if (cotejo) {
      cotejoAcerto = true;
      productos = cotejo.productos;
      habiaDelModelo = productos.length;

      // Se sabe cuál es el par exacto, así que "hay más de los que caben
      // en el carrusel" deja de aplicar: mandarlo al catálogo completo
      // ahora sería alejarlo del zapato que acabamos de encontrarle.
      hayMasEnCatalogo = false;

      // La IA de texto redactó ANTES del cotejo, con una marcaFoto que
      // decía que no se reconocía el modelo. Lo que escribió ya no vale.
      salida.respuesta = alAzar(ENCONTRE_EL_DE_LA_FOTO);
      salida.historial = conNota(
        salida.historial,
        `Le mostré ${cotejo.elegido.titulo} (identificado por la foto).`
      );
    }
  }

  // LO QUE SE LE ENSEÑA AL CLIENTE VA EN EL ORDEN DE LA FOTO (crítico).
  //
  // Caso real (24-sep): una historia con unos Adidas Adistar XLG blancos,
  // y el cliente recibió el beige. El orden por color YA existía, pero se
  // aplicaba solo a la copia que se le pasa al modelo para cotejar; lo que
  // sale por Instagram era la lista tal cual la devolvió Shopify.
  //
  // O sea: el bot sabía cuál era el bueno y lo mandaba en tercer lugar.
  //
  // Esto corre cuando el cotejo no afirmó nada —el caso más frecuente— y
  // la búsqueda sí trajo producto. Si el cotejo SÍ acertó, no hace falta:
  // ese ya viene primero de cotejo.js.
  if (foto && productos.length > 1 && !cotejoAcerto) {
    productos = await ordenarPorLaFoto(env, productos, {
      color: colorFoto,
      rasgos,
      visto: vistoFoto,
    });
  }

  // LA PISTA DEL COTEJO VA PRIMERO (30-sep-2026). Si el cotejo no se atrevió
  // a afirmar ninguno pero apuntó a uno con confianza "media", ese va el
  // PRIMERO del "¿es alguna de estas?" —sin decirle al cliente "es este"—.
  // Caso real: unas Nike Waffle respondidas con P6000; si el cotejo llegó a
  // sospechar de las Waffle, tenían que ir delante.
  if (foto && !cotejoAcerto && informeCotejo.mejorMedia) {
    const pista = informeCotejo.mejorMedia;
    console.log(`Cotejo: "${pista.titulo}" (confianza media) va primero en lo que le enseño`);
    const habiaOtros = productos.length > 0;
    productos = [pista, ...productos.filter((p) => p.titulo !== pista.titulo)].slice(0, 10);
    // Si es lo único que hay, la frase tiene que ser una pregunta honesta:
    // el modelo pudo haber escrito cualquier cosa pensando que no había nada.
    if (!habiaOtros) {
      salida.respuesta = "¿Es este? 👟 Si no es, dime y te paso con un asesor para encontrarlo 😊";
      salida.historial = conNota(salida.historial, `Le pregunté si era ${pista.titulo} (sin confirmar).`);
    }
  }

  // NO SE RECONOCIÓ LA FOTO: EL CATÁLOGO COMPLETO (26-sep-2026).
  //
  // LO QUE HABÍA AQUÍ Y POR QUÉ SE QUITÓ. Cuando el cotejo se abstenía, se
  // le enseñaban los 6 del índice que más se parecían a la foto, con un
  // "¿es alguno de estos?". La idea era no preguntarle el nombre a quien
  // no lo sabe, y eso sigue siendo cierto — pero en producción salió mal:
  //
  //   "siempre manda cuando no sabe qué es, manda Nike Trail y otros ahí"
  //
  // Y tenía razón. Cuando la descripción de la foto es pobre —un zapato
  // liso, mala luz, lejos— el parecido por palabras da CASI EMPATE entre
  // cientos, y desempata siempre igual. Al cliente le llegaban los mismos
  // seis zapatos una y otra vez, ninguno el suyo. Seis fichas equivocadas
  // no son mejores que una pregunta: son peores, porque parecen una
  // respuesta.
  //
  // Cuando de verdad no se sabe, la respuesta honesta y la más útil es la
  // misma: el catálogo entero, que es lo que el cliente puede mirar él.
  if (foto && !productos.length) {
    salida.respuesta = alAzar(NO_SE_CUAL_ES);
    salida.historial = conNota(
      salida.historial,
      `No se reconoció ${categoria && categoria !== "calzado" ? `el/la ${CATEGORIAS[categoria].nombre}` : "el calzado"} de la foto; le pasé el catálogo completo.`
    );
    console.log("No reconocí la foto: aviso al asesor y le mando el catálogo completo");

    return {
      preguntoTalla,
      termino: "",
      aBuscar,
      colores,
      productos: [],
      buscoSinExito: false,
      seAcabaron: false,
      hayMasDelCatalogo: true,
      // El asesor tiene que enterarse: hay un cliente con una foto en la
      // mano que el bot no supo leer, y ese es de los que más cerca están
      // de comprar. Ver hayEscalada().
      noReconociLaFoto: true,
      // No es lo mismo "miré y no está" que "no pude mirar": con OpenAI
      // sin cupo, el par puede estar en la tienda. El asesor lo tiene que
      // saber antes de contestar "no lo tenemos".
      sinCupo: Boolean(informeCotejo.sinCupo),
      alternativa: "",
      categoria,
      respuestaCliente: conEmojiDe(salida.respuesta, categoria),
    };
  }

  // NO LE MANDES DOS VECES EL MISMO CARRUSEL (crítico).
  //
  // Pasó en producción, y el propio cliente lo dijo:
  //
  //   "Nike vapormax"        →  le mandó 2 Vapormax
  //   "no mas mas de esos?"  →  le mandó los MISMOS 2 Vapormax
  //   "son los mismos"
  //
  // La búsqueda no tiene la culpa: de ese modelo había dos y devolvió los
  // dos, las dos veces. Lo que faltaba era memoria de lo ya enseñado.
  //
  // OJO CON EL "pideMas". Esto SOLO se aplica cuando el cliente pide algo
  // distinto. Si pregunta "¿cuánto cuestan?" sobre lo mismo, hay que
  // volver a mostrárselo: ahí repetir es la respuesta correcta.
  let repetidos = false;
  let alternativa = "";
  // 22-sep-2026: caso real — pidió "On Cloud", vio los 10 que caben en el
  // carrusel, preguntó "¿solo tienes esos?" y el bot le ofreció Salomon.
  // El problema no era "ya vio todo": Shopify SÍ tenía más de 10, solo que
  // nunca se llegaron a pedir porque el carrusel tiene ese tope. Con
  // hayMasEnCatalogo se distingue de "de verdad son todos los que hay".
  let hayMasDelCatalogo = false;
  if (pideMas && productos.length) {
    const nuevos = productos.filter((p) => !yaLoVio(mostrados, p.titulo));

    if (nuevos.length) {
      console.log(`Pidió más: de ${productos.length} le quedan ${nuevos.length} sin ver`);
      productos = nuevos;
    } else if (hayMasEnCatalogo) {
      // No hace falta ir a buscar una marca parecida: lo que el cliente
      // pidió TODAVÍA existe en el catálogo, solo no cupo en la ficha. El
      // catálogo completo es donde de verdad están todos.
      hayMasDelCatalogo = true;
      productos = [];
      console.log(`"${aBuscar}" tiene más de 10 en Shopify: mando el catálogo en vez de otra marca`);
    } else {
      // Ahora sí, de verdad ya vio todo lo que hay de eso. En vez de
      // repetirse o de soltarle el enlace, se le busca un modelo parecido —
      // que es lo que haría un vendedor: sacar otro par del estante.
      repetidos = true;
      console.log(`Ya vio los ${productos.length} de "${aBuscar}"; busco parecidos`);

      for (const otro of alternativasPara(aBuscar).slice(0, MAXIMO_ALTERNATIVAS)) {
        const encontrados = await buscarProductos(env, otro, undefined, { categoria });
        const sinVer = encontrados.productos.filter((p) => !yaLoVio(mostrados, p.titulo));
        if (sinVer.length) {
          productos = sinVer;
          alternativa = otro;
          console.log(`Le ofrezco "${otro}" (${sinVer.length} sin ver)`);
          break;
        }
      }

      if (!alternativa) {
        productos = [];
        console.log(`Sin alternativas nuevas para "${aBuscar}"`);
      }
    }
  }

  // Ya vio todo lo de ese modelo y tampoco quedaba nada nuevo parecido.
  // NO es lo mismo que "no encontré nada", y por eso se separa: aquí SÍ
  // sabemos que el producto existe —se lo mandamos nosotros— y podemos
  // decírselo de frente sin inventar nada.
  const seAcabaron = repetidos && !alternativa;

  // Si buscó y no encontró nada, no le damos la respuesta optimista del
  // modelo: pasamos al asesor sin afirmar que el producto no existe. Vale
  // igual si el modelo sí estaba pero no en ese color: el cliente pidió ese
  // color, y decirle que sí mostrándole otro es engañarlo.
  const buscoSinExito = Boolean(aBuscar) && !productos.length && !seAcabaron && !hayMasDelCatalogo;

  // Preguntó la talla y no quedó nada que buscar: la talla la confirma una
  // persona, así que no se le da largas ni se le muestra el catálogo entero.
  const soloTalla = preguntoTalla && !termino;

  // Si ya se conocen, se le quita la bienvenida aunque el modelo la haya
  // escrito. Es el fallo que más se nota: saludar dos veces.
  const respuestaFinal = historialPrevio
    ? sinBienvenida(salida.respuesta)
    : salida.respuesta;

  // El orden importa: de lo más concreto a lo más general. La respuesta que
  // escribió el modelo es la última opción porque él no vio el resultado de
  // la búsqueda — no sabe que se repitió ni que no había nada.
  let respuestaCliente = respuestaFinal;
  if (soloTalla) {
    respuestaCliente = SOLO_TALLA;
  } else if (hayMasDelCatalogo) {
    respuestaCliente = alAzar(HAY_MAS_EN_CATALOGO);
  } else if (seAcabaron) {
    respuestaCliente = alAzar(YA_TE_MOSTRE_TODO);
  } else if (repetidos && alternativa) {
    respuestaCliente = alAzar(TE_OFREZCO_PARECIDOS);
  } else if (buscoSinExito) {
    respuestaCliente = SIN_RESULTADOS;
  }

  return {
    preguntoTalla,
    termino,
    aBuscar,
    colores,
    productos,
    buscoSinExito,
    seAcabaron,
    hayMasDelCatalogo,
    noReconociLaFoto: false,
    alternativa: alternativa || (otrosDeLaCategoria ? categoria : ""),
    categoria,
    respuestaCliente: conEmojiDe(respuestaCliente, categoria),
  };
}

// LO QUE ES VERDAD EN ESTA TIENDA, para que el revisor compare (ver
// revisor.js): si el bot dice otro horario, un envío que no hay u otra
// dirección, el revisor lo atrapa.
function datosParaElRevisor(env) {
  const lugar = mensajeDeUbicacion(env);
  let pagos = "";
  try {
    pagos = listaDeMetodos();
  } catch {}
  return [
    datosParaElPrompt(),
    `📍 Ubicación: ${lugar.texto || "(no cargada: la confirma un asesor)"}`,
    pagos ? `💳 Métodos de pago:\n${pagos}` : "",
    `Lo que vende, y cómo van las tallas (que haya una talla concreta lo confirma un asesor; las gorras SÍ se puede decir que son ajustables):\n${categoriasParaElPrompt()}`,
    "Calidad: doble A y triple A según el par; la de un par concreto la confirma un asesor.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

// Las frases fijas nacieron para zapatos (👟). Con un bolso, 👜.
function conEmojiDe(frase, categoria) {
  if (!frase || !categoria || categoria === "calzado") return frase;
  return String(frase).replaceAll("👟", emojiDe(categoria));
}

// Se avisa en dos situaciones, y solo en esas dos.
//
//   · Preguntó por la talla. Es la última pregunta antes de comprar y el
//     catálogo no sabe qué tallas quedan, así que va al asesor aunque el bot
//     le esté mostrando el producto en ese mismo mensaje.
//
//   · Va a cerrar la compra. Lo dice la respuesta de ESTE mensaje: las
//     frases de cierre del prompt llevan "en un momento", y la oferta "¿Te
//     paso con un asesor?" no, porque el cliente aún no ha dicho que sí.
//
//   · Mandó una FOTO y el bot no supo qué calzado era. Este se añadió el
//     26-sep-2026, a pedido del dueño. Quien manda una foto ya vio el
//     zapato y lo quiere: es de los mensajes que más cerca están de una
//     venta, y si la máquina no lo reconoció, una persona sí va a poder.
//     Al cliente se le manda el catálogo completo mientras tanto, así que
//     no se queda esperando.
//
// No se avisa mientras el bot esté mostrando calzados: la venta sigue viva.
// Tampoco cuando una búsqueda por texto no da resultados — eso queda en los
// registros, no es trabajo para el asesor. La foto sin reconocer sí lo es:
// ahí hay una imagen concreta que alguien puede mirar.
function hayEscalada({ respuesta, productos, preguntoTalla, buscoSinExito, noReconociLaFoto }) {
  if (preguntoTalla) return true;
  if (noReconociLaFoto) return true;
  if (buscoSinExito || productos.length) return false;
  return respuesta.toLowerCase().includes("en un momento");
}

// Primera línea de la notificación: le dice al asesor qué tiene que
// contestar antes de abrir la conversación.
function motivoDeLaEscalada({ preguntoTalla, noReconociLaFoto, sinCupo = false, categoria = "" }) {
  const queEs = categoria ? CATEGORIAS[categoria]?.nombre.toUpperCase() : "PRODUCTO";
  if (preguntoTalla) return "PREGUNTO POR TALLAS";
  if (noReconociLaFoto && sinCupo) {
    return "MANDO UNA FOTO Y NO LA PUDE COMPARAR CON TODO EL CATALOGO (SIN CUPO O SIN CONEXIONES) — PUEDE QUE SI LO TENGAMOS";
  }
  if (noReconociLaFoto) return `MANDO UNA FOTO Y NO SUPE QUE ${queEs || "PRODUCTO"} ES`;
  return "QUIERE CERRAR LA COMPRA";
}


