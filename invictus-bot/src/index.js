// Cerebro del bot de ventas de INVICTUS SHOES.
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

import { responderTexto, identificarEnImagen } from "./ia.js";
import { buscarProductos } from "./shopify.js";
import { avisarAsesor } from "./aviso.js";
import { esSoloSaludo, saludoDeVuelta } from "./saludo.js";
import { pideElCatalogo, pideMasVariedad, fraseDeCatalogo } from "./catalogo.js";
import { alternativasPara } from "./parecidos.js";
import { separarColor, filtrarPorColor, terminoDeColor } from "./color.js";
import { comoDataUri } from "./imagen.js";
import { validarIdentificacion } from "./identificar.js";
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
  obtenerPerfil,
} from "./instagram.js";

// Se sube a mano en cada entrega, y sale en /estado. Existe por una razón
// muy concreta: los archivos se copian a mano a la carpeta de despliegue,
// así que "ya lo pegué" y "ya está desplegado" no son lo mismo. Con esto se
// comprueba en diez segundos cuál de las dos cosas pasó.
const VERSION = "2026-09-22 · despausar desde el chat + nombres de clientes";

// Lo que se dice cuando la búsqueda no devuelve nada. No afirma que el
// producto no exista ni promete reposición: eso era lo que hacía el módulo
// "no disponible" de Make. Y como lleva "en un momento", dispara el aviso.
const SIN_RESULTADOS =
  "Déjame confirmarte ese modelo con un asesor y te escribo en un momento 😊 " +
  "Mientras, aquí tienes el catálogo completo";

// La talla la confirma una persona: el catálogo no guarda qué tallas quedan.
const SOLO_TALLA = "Eso te lo confirma un asesor en un momento 😊";

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
const TALLA_EN_BUSQUEDA = /\b(tallas?|sizes?|n[uú]mero)\s*:?\s*\d{1,2}(\.\d)?\b|\b(tallas?|sizes?)\b/gi;

function sinTalla(termino) {
  return String(termino || "")
    .replace(TALLA_EN_BUSQUEDA, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

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
        // a fallar, y otra vez. Eso multiplica por tres o por diez cada
        // evento y agota la cuota del Worker.
        //
        // El mensaje se descarta igual: no se mira, no se responde. Solo se
        // le quita a Meta el motivo para insistir.
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

      // A Meta se le responde 200 siempre y rápido. Si tarda o falla, lo
      // reintenta y el cliente acaba recibiendo la misma respuesta varias
      // veces; y si falla mucho, Meta desactiva el webhook.
      if (mensaje) ctx.waitUntil(atenderConRed(env, mensaje));
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
      const base = await revisarBase(env.DB, { fraseDespausar: fraseDespausar(env) });

      return texto200(
        [
          `CÓDIGO DESPLEGADO   ${VERSION}`,
          "  Si esta línea no coincide con la última versión que pegaste,",
          "  el despliegue no llegó: vuelve a correr `wrangler deploy`.",
          "",
          "SECRETOS",
          `  OPENAI_API_KEY      ${secreto("OPENAI_API_KEY")}`,
          `  SHOPIFY_TOKEN       ${secreto("SHOPIFY_TOKEN")}`,
          `  SLACK_WEBHOOK       ${secreto("SLACK_WEBHOOK")}`,
          `  META_APP_SECRET     ${secreto("META_APP_SECRET")}   (la de Facebook)`,
          `  META_APP_SECRET_IG  ${secreto("META_APP_SECRET_IG")}   (la de Instagram ← es esta)`,
          `  IG_TOKEN            ${secreto("IG_TOKEN")}`,
          "",
          "CONFIGURACIÓN (wrangler.toml)",
          `  META_MODO           ${env.META_MODO || "todo (por defecto)"}`,
          `  META_VERIFY_TOKEN   ${env.META_VERIFY_TOKEN ? "puesto" : "FALTA"}`,
          `  SHOPIFY_TIENDA      ${env.SHOPIFY_TIENDA || "FALTA"}`,
          `  URL_CATALOGO        ${env.URL_CATALOGO || "FALTA"}`,
          `  WHATSAPP            ${String(env.WHATSAPP || "").replace(/\D/g, "") ? "puesto" : "sin poner (no sale el botón Comprar)"}`,
          `  PAUSA_HORAS         ${env.PAUSA_HORAS || `${PAUSA_HORAS_POR_DEFECTO} (por defecto)`}   (se cuenta desde el ULTIMO mensaje del asesor)`,
          `  FRASE_DESPAUSAR     "${fraseDespausar(env)}"   (el asesor la manda en el chat y el bot vuelve)`,
          `  OPENAI_MODELO       ${env.OPENAI_MODELO || "gpt-4o-mini (por defecto)"}   (el que redacta las respuestas)`,
          `  OPENAI_MODELO_VISION ${env.OPENAI_MODELO_VISION || "gpt-4o (por defecto)"}   (el que identifica las fotos)`,
          "",
          "BASE DE DATOS (D1) — la memoria del bot entre mensajes",
          ...base.lineas,
          "",
          "ManyChat está retirado. Este Worker es el único canal: habla",
          "directo con la API de Instagram y guarda su propia memoria en D1.",
          "",
          "Las fotos se identifican en dos pasos: primero una IA de visión",
          "dedicada (OPENAI_MODELO_VISION) que solo describe y verifica",
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

      const identificacion = await identificarEnImagen(env, descargada);
      if (!identificacion) {
        return texto200(
          "La IA de visión no pudo con esa imagen.\n\n" +
            "Casi siempre es una de estas:\n" +
            "  · no queda saldo en OpenAI\n" +
            "  · OPENAI_MODELO_VISION no existe o no admite imágenes\n\n" +
            "En `wrangler tail` sale el motivo exacto.\n"
        );
      }

      const { buscar, pedirNombreExacto, corregido } = validarIdentificacion(identificacion);
      const marca = marcarIdentificacion(buscar, pedirNombreExacto, false);

      const salida = await responderTexto(env, contexto("", "", "(mandó una foto)", marca));
      if (!salida) {
        return texto200(
          "La IA de visión sí identificó algo, pero la IA de texto no pudo\n" +
            "redactar la respuesta. Revisa `wrangler tail` para el motivo.\n"
        );
      }

      const { productos, respuestaCliente, termino } = await decidir({
        env,
        salida,
        texto: "",
        historialPrevio: "",
      });

      return texto200(
        `La IA de visión vio: ${identificacion.buscar}` +
          (corregido ? ` (corregido a "${buscar}" porque sus rasgos no cuadraban)` : "") +
          `\nLe diría al cliente: ${respuestaCliente}\n` +
          `Buscó: ${termino || "(nada)"}\n` +
          `Encontró: ${productos.length}\n` +
          productos.map((p) => `   ${p.titulo}  —  ${p.precio}`).join("\n") +
          "\n"
      );
    }

    return new Response("invictus-bot", { status: 200 });
  },
};

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

  const mandar = async (hacer) => {
    const mid = await hacer();
    if (!mid) return "";

    rastro.respondio = true;
    mids = agregarMid(mids, mid);
    enviadoEn = Date.now();
    await marcarEnvio(env.DB, mensaje.igsid, mids, enviadoEn);
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

  // Quien ya escribió antes y vuelve con un "hola" suelto no necesita al
  // modelo: no hay nada que buscar. La primera vez de cada cliente NO entra
  // aquí: esa bienvenida la escribe el modelo con el tono del prompt.
  if (historialPrevio && !imagenCruda && esSoloSaludo(mensaje.texto)) {
    const respuesta = saludoDeVuelta(nombre, mensaje.texto);
    console.log(`Saludo de vuelta → ${JSON.stringify(respuesta)}`);
    await mandar(() => enviarTexto(env, mensaje.igsid, respuesta));
    await guardarContacto(env.DB, {
      ...contacto,
      nombre,
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
    await mandar(() => enviarBotonCatalogo(env, mensaje.igsid, respuesta));
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
  if (foto) {
    const identificacion = await identificarEnImagen(env, foto);
    if (identificacion) {
      const { buscar, pedirNombreExacto } = validarIdentificacion(identificacion);
      marcaFoto = marcarIdentificacion(buscar, pedirNombreExacto, esHistoria);
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

  const entrada = contexto(nombre, historialPrevio, textoCliente, marca, esHistoria, minutosCallado);

  const salida = await responderTexto(env, entrada);

  // Y si además el modelo falla, la pregunta se la hacemos nosotros, que es
  // infinitamente mejor que decirle que el sistema se trabó.
  if (!salida && imagenCruda && !foto) {
    const frase = HISTORIA_SIN_VER[Math.floor(Math.random() * HISTORIA_SIN_VER.length)];
    console.log(`Historia sin ver (${porQueNo}) → pregunto: ${JSON.stringify(frase)}`);
    await mandar(() => enviarTexto(env, mensaje.igsid, frase));
    await guardarContacto(env.DB, {
      ...contacto,
      nombre,
      mids_enviados: mids,
      ultimo_envio: enviadoEn || Date.now(),
    });
    return;
  }

  if (!salida) {
    await mandar(() => enviarTexto(env, mensaje.igsid, FALLO_TECNICO));
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
    termino,
    preguntoTalla,
    buscoSinExito,
    seAcabaron,
    hayMasDelCatalogo,
    alternativa,
  } = await decidir({
    env,
    salida,
    texto: mensaje.texto,
    historialPrevio,
    mostrados: contacto.mostrados,
    // Solo si pide algo DISTINTO se descarta lo que ya vio. Una foto no
    // cuenta: quien manda una foto está pidiendo ESE zapato, no otro.
    pideMas: !imagenCruda && pideMasVariedad(mensaje.texto),
  });

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
    await mandar(() => enviarTexto(env, mensaje.igsid, respuestaCliente));
    await mandar(() => enviarFichas(env, mensaje.igsid, productos));
  } else if (buscoSinExito || seAcabaron || hayMasDelCatalogo) {
    // Tres motivos distintos, misma salida: el cliente quería ver algo y no
    // hay nada (más) que enseñarle en una ficha. Ahí el enlace de la tienda
    // sí es una ayuda — incluido cuando SÍ hay más, pero no caben en un
    // carrusel de 10 (hayMasDelCatalogo, ver decidir()).
    await mandar(() => enviarBotonCatalogo(env, mensaje.igsid, respuestaCliente));
  } else {
    // Conversación: preguntas, dudas, cortesías. Texto limpio, sin botón.
    await mandar(() => enviarTexto(env, mensaje.igsid, respuestaCliente));
  }

  const escalada = hayEscalada({
    respuesta: respuestaCliente,
    productos,
    preguntoTalla,
    buscoSinExito,
  });

  if (escalada) {
    await avisarAsesor(env, {
      ...paraElAviso(contacto),
      igsid: mensaje.igsid,
      mensaje: textoCliente,
      respuesta: respuestaCliente,
      motivo: motivo({ preguntoTalla }),
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
  await mandar(() => enviarTexto(env, mensaje.igsid, alAzar(YA_TE_ATIENDEN)));

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
function marcarIdentificacion(buscar, pedirNombreExacto, esHistoria) {
  const encabezado = esHistoria
    ? "[EL CLIENTE RESPONDIÓ A UNA HISTORIA — la imagen que ves ES la historia. "
    : "[EL CLIENTE MANDÓ UNA FOTO DE UN CALZADO. ";

  if (String(buscar).toUpperCase() === "NADA") {
    return (
      encabezado +
      "NO SE PUDO IDENTIFICAR NINGÚN MODELO NI MARCA CON SEGURIDAD. " +
      "Pregúntale con naturalidad cuál le interesa, como preguntaría una " +
      "vendedora. NUNCA le pidas que mande otra foto" +
      (esHistoria ? ": ya tienes la imagen delante." : ".") +
      "]"
    );
  }

  if (pedirNombreExacto) {
    return (
      encabezado +
      `SE RECONOCIÓ LA MARCA "${buscar}", PERO NO EL MODELO EXACTO. ` +
      "Muéstrale esa marca Y pídele el nombre exacto del modelo, las dos " +
      "cosas en el mismo mensaje.]"
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
  /^\s*[¡!]*\s*hola\b[^\n]{0,25}?\bsoy\s+la\s+asistente(\s+virtual)?(\s+de\s+la\s+tienda|\s+de\s+invictus(\s+shoes)?)?\s*[👋😊🙌]*\s*[.!,]*\s*/i;

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
async function decidir({ env, salida, texto, historialPrevio, mostrados = [], pideMas = false }) {
  const preguntoTalla = PREGUNTA_TALLA.test(texto);

  // El modelo cuela la talla en el término cuando el cliente la nombra, y eso
  // devuelve cero productos siempre. Se le quita antes de buscar.
  const termino = salida.buscar.toUpperCase() === "NADA" ? "" : sinTalla(salida.buscar);
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
    const resultado = await buscarProductos(env, aBuscar);
    productos = resultado.productos;
    habiaDelModelo = productos.length;

    // Solo se filtra cuando el color no ES la búsqueda: si ya buscamos
    // "negr" en Shopify, volver a filtrar por negro no aporta nada.
    if (colores.length && sinColor) {
      productos = filtrarPorColor(productos, colores);
      console.log(
        `Del modelo había ${habiaDelModelo}; en ${colores.join(" + ")} quedan ${productos.length}`
      );
    } else {
      hayMasEnCatalogo = resultado.hayMas;
    }

    if (!productos.length) {
      console.log(`Sin resultados para "${aBuscar}"`);
    }
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
        const encontrados = await buscarProductos(env, otro);
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
    alternativa,
    respuestaCliente,
  };
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
// No se avisa mientras el bot esté mostrando calzados: la venta sigue viva.
// Tampoco cuando una búsqueda no da resultados — eso queda en los registros,
// no es trabajo para el asesor.
function hayEscalada({ respuesta, productos, preguntoTalla, buscoSinExito }) {
  if (preguntoTalla) return true;
  if (buscoSinExito || productos.length) return false;
  return respuesta.toLowerCase().includes("en un momento");
}

// Primera línea de la notificación: le dice al asesor qué tiene que contestar
// antes de abrir la conversación.
function motivo({ preguntoTalla }) {
  return preguntoTalla ? "PREGUNTO POR TALLAS" : "QUIERE CERRAR LA COMPRA";
}
