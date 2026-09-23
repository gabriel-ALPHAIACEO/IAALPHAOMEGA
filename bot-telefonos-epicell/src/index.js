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
import {
  buscarProductos,
  catalogoCompleto,
  diagnosticoHoja,
  listaDeTitulos,
} from "./sheets.js";
import { avisarAsesor } from "./aviso.js";
import { esSoloSaludo, saludoDeVuelta } from "./saludo.js";
import { pideVerMas, fraseDeCatalogo } from "./catalogo.js";
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
  cargarContacto,
  guardarContacto,
  marcarEnvio,
  pausar,
  despausar,
  estaPausado,
  esEcoPropio,
  envioReciente,
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
  obtenerPerfil,
} from "./instagram.js";

// Se sube a mano en cada entrega y sale en /estado: los archivos se copian
// a mano, así que "ya lo pegué" y "ya está desplegado" no son lo mismo.
const VERSION = "2026-09-23 (2) · Cashea por niveles + el 429 se lee en el registro";

/* ════════════════════════════════════════════════════════════════════
   LO QUE CAMBIA SEGÚN LA TIENDA
   ════════════════════════════════════════════════════════════════════ */

// Lo que se dice cuando la búsqueda no devuelve nada. No afirma que el
// producto no exista ni promete reposición: el bot escribe antes de ver el
// resultado, así que no sabe si hay stock.
const SIN_RESULTADOS =
  "Déjame confirmarte ese modelo con un asesor y te escribo en un momento 😊 " +
  "Mientras, aquí tienes el catálogo completo";

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

// Los datos que el catálogo NO guarda y que decide una persona. Cuando el
// cliente pregunta por uno, se avisa al asesor aunque el bot le esté
// mostrando producto, porque suele ser la última pregunta antes de comprar.
//
// Ojo con las tildes: van las dos formas, porque los clientes escriben sin
// acentos.
//
// "Cuotas", "crédito" y "financiamiento" NO están aquí: cuando el cliente
// pregunta por pagar a crédito CON CASHEA, el precio ya lo tenemos en la
// hoja y el bot lo da directo. Solo se escala el crédito que NO es de
// Cashea, y eso vive en CONSULTA_DE_CREDITO_GENERICO.
const CONSULTA_DE_ASESOR =
  /\b(garant[ií]a|permuta|parte de pago|factura|repara\w*|liberad[oa]|liberaci[óo]n|seguro|bater[ií]a|ciclos)\b/i;

const CONSULTA_DE_CREDITO_GENERICO = /\b(cuotas?|credito|cr[ée]dito|financia\w*)\b/i;

// La plataforma de compra a crédito. Cuando el cliente la nombra, se le
// muestra el precio Cashea de la ficha junto al precio normal.
const PREGUNTA_CASHEA = /\bcashea\b/i;

// El precio en divisas solo sale cuando el cliente lo pide con estas
// palabras; por defecto la ficha muestra el precio Cashea.
const PREGUNTA_DIVISAS = /\b(divisas?|d[oó]lares?|usd)\b/i;

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
      const mensaje = queAtender(env, crudo);

      // A Meta se le responde 200 siempre y rápido. Si tarda o falla, lo
      // reintenta y el cliente acaba recibiendo la misma respuesta varias
      // veces; y si falla mucho, Meta desactiva el webhook.
      if (mensaje) ctx.waitUntil(atenderConRed(env, mensaje));
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

    return texto200(`bot activo · ${VERSION}\n`);
  },
};

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
  const textoCliente = mensaje.texto || (imagenCruda ? "(mandó una foto)" : "");

  console.log(
    `Meta → ATIENDO ${mensaje.tipo} de:${mensaje.igsid} ` +
      `texto:${JSON.stringify(String(mensaje.texto).slice(0, 60))}`
  );

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
  if (!imagenCruda && !CONSULTA_DE_ASESOR.test(mensaje.texto) && pideVerMas(mensaje.texto)) {
    const respuesta = fraseDeCatalogo(nombre);
    console.log(`Pidió ver más → ${JSON.stringify(respuesta)}`);
    await mandar(() => enviarBotonCatalogo(env, mensaje.igsid, respuesta));
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
  if (!imagenCruda && pideVerLoRecomendado(mensaje.texto) && contacto.ultima_respuesta) {
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

      await mandar(() => enviarTexto(env, mensaje.igsid, respuesta));
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
      });
      return;
    }

    console.log(
      "Pidió ver lo recomendado, pero en el último mensaje no reconocí " +
        "ningún producto del catálogo: sigo por el camino normal."
    );
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
  if (foto) {
    const identificacion = await identificarEnImagen(env, foto, catalogo);
    if (identificacion) {
      console.log(
        `La IA de visión vio: "${identificacion.visto || ""}" → busco: "${identificacion.buscar}"`
      );
      marcaFoto = marcarIdentificacion(
        identificacion.buscar,
        identificacion.pedirNombreExacto,
        esHistoria
      );
    } else {
      console.error("La IA de visión no respondió: sigo solo con el texto");
      foto = "";
      porQueNo = porQueNo || "otro";
    }
  }

  // Si no se puede mirar, NO es el final del camino. La mayoría de las
  // historias son vídeo, y el cliente que responde a una historia es el que
  // más cerca está de comprar: se le atiende por lo que escribió.
  const marca = imagenCruda ? (foto ? marcaFoto : marcarSinVer(porQueNo, esHistoria)) : "";

  const entrada = contexto(
    nombre,
    historialPrevio,
    textoCliente,
    marca,
    esHistoria,
    minutosCallado,
    catalogo
  );

  const salida = await responderTexto(env, entrada);

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

  const { productos, respuestaCliente, termino, esConsultaDeAsesor, buscoSinExito, hayMas } =
    await decidir({ env, salida, texto: mensaje.texto, historialPrevio });

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

  // EL CATÁLOGO NO ES LA RESPUESTA POR DEFECTO. El botón sale en dos casos:
  // buscamos lo que pidió y no apareció, o hay más de los que caben en el
  // carrusel. Una pregunta de vendedora —"¿lo quieres nuevo o usado?"— sale
  // como texto limpio: el cliente que se va al catálogo se va de la
  // conversación.
  if (fichas.length) {
    await mandar(() => enviarTexto(env, mensaje.igsid, respuestaCliente));
    await mandar(() => enviarFichas(env, mensaje.igsid, fichas));
    if (hayMas) {
      await mandar(() => enviarBotonCatalogo(env, mensaje.igsid, HAY_MAS_EN_CATALOGO));
    }
  } else if (buscoSinExito) {
    await mandar(() => enviarBotonCatalogo(env, mensaje.igsid, respuestaCliente));
  } else {
    await mandar(() => enviarTexto(env, mensaje.igsid, respuestaCliente));
  }

  const escalada = hayEscalada({
    respuesta: respuestaCliente,
    productos,
    esConsultaDeAsesor,
    buscoSinExito,
  });

  if (escalada) {
    await avisarAsesor(env, {
      ...paraElAviso(contacto),
      igsid: mensaje.igsid,
      mensaje: textoCliente,
      respuesta: respuestaCliente,
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
    historial: recortarHistorial(salida.historial || historialPrevio),
    pausado_hasta: contacto.pausado_hasta,
    mids_enviados: mids,
    // Lo que se le acaba de decir, tal cual. Es lo que hace posible el
    // "muéstrame esos" del próximo mensaje (ver recomendados.js).
    ultima_respuesta: respuestaCliente,
    // Si TODOS los envíos fallaron, enviadoEn sigue en 0 y no hay que pisar
    // la marca anterior con un cero.
    ultimo_envio: enviadoEn || contacto.ultimo_envio,
  });
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

// El bloque de contexto que le dice a la IA de texto qué encontró la IA de
// visión en la foto. La IA de texto no ve la imagen, solo este resumen, y
// es ella quien redacta con su propio tono.
function marcarIdentificacion(buscar, pedirNombreExacto, esHistoria) {
  const encabezado = esHistoria
    ? "[EL CLIENTE RESPONDIÓ A UNA HISTORIA — la imagen que ves ES la historia. "
    : "[EL CLIENTE MANDÓ UNA FOTO DE UN EQUIPO. ";

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
function contexto(nombre, historial, texto, marca = "", esHistoriaNueva = false, minutos = 0, catalogo = "") {
  return contextoParaElModelo({
    nombre: primerNombre(nombre),
    historial,
    texto,
    marca,
    esHistoriaNueva,
    minutosDesdeElUltimo: minutos,
    catalogo,
  });
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

  // El crédito genérico escala; el de Cashea no, porque el precio ya lo
  // tenemos. Si el cliente menciona Cashea, esa mención no cuenta como
  // "consulta de asesor" aunque también diga "crédito" o "cuotas" en la
  // misma frase.
  const preguntoCashea = PREGUNTA_CASHEA.test(texto);
  const esConsultaDeAsesor =
    CONSULTA_DE_ASESOR.test(texto) ||
    preguntoPorColor ||
    (CONSULTA_DE_CREDITO_GENERICO.test(texto) && !preguntoCashea);

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
  const termino = sinColor;
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

  // Si ya se conocen, se le quita la bienvenida aunque el modelo la haya
  // escrito. Es el fallo que más se nota: saludar dos veces.
  const respuestaFinal = historialPrevio ? sinBienvenida(salida.respuesta) : salida.respuesta;

  // El orden va de lo más concreto a lo más general. La respuesta que
  // escribió el modelo queda última porque él no vio el resultado de la
  // búsqueda: no sabe en qué capacidades quedó el equipo ni si hubo algo.
  let respuestaCliente = respuestaFinal;

  if (soloAsesor) {
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
  } else if (buscoSinExito) {
    respuestaCliente = SIN_RESULTADOS;
  }

  return {
    productos,
    respuestaCliente,
    termino,
    // Una capacidad que el catálogo no trae es un dato que solo sabe una
    // persona, igual que la garantía: va al asesor.
    esConsultaDeAsesor: esConsultaDeAsesor || capacidadSinDato,
    buscoSinExito,
    hayMas,
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
function precioParaMostrar(producto, conCashea, conDivisas) {
  if (conDivisas) return producto.precio || "Precio: consúltalo";

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
