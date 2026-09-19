// Cerebro del bot de ventas de INVICTUS SHOES.
//
// ManyChat es el canal y llama aquí por contenido dinámico. La memoria de
// cada conversación vive en los campos de ManyChat, no aquí: el Worker no
// guarda nada entre mensajes, solo recibe el historial, responde y devuelve
// el historial actualizado.

import { responderTexto, responderImagen } from "./ia.js";
import { buscarProductos } from "./shopify.js";
import { avisarAsesor } from "./aviso.js";
import { respuestaManyChat } from "./manychat.js";
import { esSoloSaludo, saludoDeVuelta } from "./saludo.js";
import { pideVerMas, fraseDeCatalogo } from "./catalogo.js";
import { separarColor, filtrarPorColor, terminoDeColor } from "./color.js";
import { comoDataUri } from "./imagen.js";
import { ponerCampoManyChat } from "./manychat-campo.js";
import { contextoParaElModelo, recortarHistorial } from "./historial.js";
import {
  firmaValida,
  leerMensaje,
  enviarTexto,
  enviarFichas,
  enviarBotonCatalogo,
  obtenerNombre,
} from "./instagram.js";
import {
  MAXIMO_DE_VECES,
  vecesUsado,
  sinMarca,
  conMarca,
  contarEn,
} from "./nombre.js";

// Lo que se dice cuando la búsqueda no devuelve nada. No afirma que el
// producto no exista ni promete reposición: eso era lo que hacía el módulo
// "no disponible" de Make. Y como lleva "en un momento", dispara el aviso.
const SIN_RESULTADOS =
  "Déjame confirmarte ese modelo con un asesor y te escribo en un momento 😊 " +
  "Mientras, aquí tienes el catálogo completo";

// La talla la confirma una persona: el catálogo no guarda qué tallas quedan.
const SOLO_TALLA = "Eso te lo confirma un asesor en un momento 😊";

// Cuando la historia es un vídeo no se puede mirar, y eso pasa a diario: la
// mayoría de las historias son vídeo. NO es una avería, así que el cliente
// no puede recibir el mensaje de avería. Se le pregunta como preguntaría una
// vendedora, y se le deja el catálogo a mano.
//
// Solo se usan si el modelo tampoco responde: mientras haya modelo, la
// pregunta la escribe él con el contexto de lo que dijo el cliente.
const HISTORIA_SIN_VER = [
  "¡Claro que sí! 😊 Dime cuál de los que salen en la historia te gustó y te paso el precio 👇",
  "¡Con gusto! ¿Cuál te llamó la atención de la historia? Dime el modelo y te cuento todo 😊",
  "¡Por supuesto! 👟 Dime cuál te gustó y te paso precio y fotos enseguida",
  "¡Claro! ¿De cuál quieres saber? Dime el modelo o mira el catálogo completo aquí 👇",
];

// Si el modelo falla, el cliente no se queda sin nada y el asesor se entera.
const FALLO_TECNICO =
  "Disculpa, se me trabó el sistema 😅 Un asesor te atiende en un momento";

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

    if (url.pathname === "/manychat") {
      if (request.method !== "POST") {
        return new Response("método no permitido", { status: 405 });
      }
      return atenderManyChat(env, request);
    }

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

    // Prueba el relevo a ManyChat sin esperar a que llegue una historia de
    // verdad: /probar-manychat-campo?igsid=123456&url=https://ejemplo.com/foto.jpg
    // Sirve para confirmar el token y el nombre del campo ANTES de confiar
    // en que el camino de las historias se calle y deje responder a
    // ManyChat. Si esto falla, el bug de los dos mensajes sigue ahí.
    if (url.pathname === "/probar-manychat-campo") {
      const igsid = url.searchParams.get("igsid") || "";
      const imagen = url.searchParams.get("url") || "";

      if (!igsid || !urlValida(imagen)) {
        return texto200(
          "Pásame un igsid real y una imagen así:\n" +
            "  /probar-manychat-campo?igsid=123456789&url=https://ejemplo.com/foto.jpg\n"
        );
      }

      if (!env.MANYCHAT_API_TOKEN || !env.MANYCHAT_CAMPO_IMAGEN) {
        return texto200(
          "Falta configurar el relevo:\n" +
            `  MANYCHAT_API_TOKEN   ${env.MANYCHAT_API_TOKEN ? "cargado" : "FALTA — npx wrangler secret put MANYCHAT_API_TOKEN"}\n` +
            `  MANYCHAT_CAMPO_IMAGEN ${env.MANYCHAT_CAMPO_IMAGEN || "FALTA — ponlo en wrangler.toml"}\n`
        );
      }

      const puesto = await ponerCampoManyChat(env, igsid, imagen);
      return texto200(
        puesto
          ? `Listo: el campo "${env.MANYCHAT_CAMPO_IMAGEN}" del subscriber ${igsid} quedó con esa URL.\n` +
              "Revísalo en ManyChat (pestaña del contacto) para confirmar que llegó.\n"
          : "ManyChat rechazó la llamada. El motivo exacto sale en `wrangler tail`: \n" +
              "casi siempre es el token vencido, el nombre del campo mal escrito\n" +
              "(sensible a mayúsculas) o un igsid que no es subscriber de ManyChat.\n"
      );
    }

    /* ── El camino directo con Meta ─────────────────────────────────
       ManyChat sigue llevando la conversación. Esto es solo para lo que
       ManyChat no puede dar: la IMAGEN de la historia a la que el cliente
       respondió. Meta la adjunta al mensaje; ManyChat no la reenvía.

       Y por eso el webhook SOLO atiende imágenes y respuestas a historias.
       Todo lo demás —los "visto", las reacciones, los ecos de nuestros
       propios mensajes, el texto suelto— se descarta sin gastar nada. Ese
       aluvión fue el que se comió los créditos de Make: pagaba una
       operación por cada aviso, y Meta manda cientos al día.
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
        // evento, agota la cuota del Worker y tumba también a ManyChat.
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
      if (mensaje) ctx.waitUntil(atenderMeta(env, mensaje));
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

      return texto200(
        [
          "SECRETOS",
          `  OPENAI_API_KEY      ${secreto("OPENAI_API_KEY")}`,
          `  SHOPIFY_TOKEN       ${secreto("SHOPIFY_TOKEN")}`,
          `  MANYCHAT_SECRET     ${secreto("MANYCHAT_SECRET")}`,
          `  SLACK_WEBHOOK       ${secreto("SLACK_WEBHOOK")}`,
          `  META_APP_SECRET     ${secreto("META_APP_SECRET")}   (la de Facebook)`,
          `  META_APP_SECRET_IG  ${secreto("META_APP_SECRET_IG")}   (la de Instagram ← es esta)`,
          `  IG_TOKEN            ${secreto("IG_TOKEN")}`,
          `  MANYCHAT_API_TOKEN  ${secreto("MANYCHAT_API_TOKEN")}   (para el relevo de imágenes de historia)`,
          "",
          "CONFIGURACIÓN (wrangler.toml)",
          `  META_MODO           ${env.META_MODO || "imagenes (por defecto)"}`,
          `  META_VERIFY_TOKEN   ${env.META_VERIFY_TOKEN ? "puesto" : "FALTA"}`,
          `  SHOPIFY_TIENDA      ${env.SHOPIFY_TIENDA || "FALTA"}`,
          `  URL_CATALOGO        ${env.URL_CATALOGO || "FALTA"}`,
          `  WHATSAPP            ${String(env.WHATSAPP || "").replace(/\D/g, "") ? "puesto" : "sin poner (no sale el botón Comprar)"}`,
          `  MANYCHAT_CAMPO_IMAGEN ${env.MANYCHAT_CAMPO_IMAGEN || "sin poner"}`,
          "",
          env.MANYCHAT_API_TOKEN && env.MANYCHAT_CAMPO_IMAGEN
            ? "Relevo a ManyChat: ACTIVO. Las respuestas a historias con imagen\n" +
              "ya NO las contesta esta app — se las pasa a ManyChat por el campo\n" +
              `"${env.MANYCHAT_CAMPO_IMAGEN}" y se calla. Pruébalo con /probar-manychat-campo`
            : "Relevo a ManyChat: APAGADO (falta MANYCHAT_API_TOKEN o\n" +
              "MANYCHAT_CAMPO_IMAGEN). Mientras tanto esta app sigue respondiendo\n" +
              "directo a las historias — y por eso puede seguir el mensaje duplicado.",
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
    // ManyChat ni de Meta: /probar-imagen?url=https://...
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

      const salida = await responderImagen(
        env,
        descargada,
        contexto("", "", "(mandó una foto)", "")
      );
      if (!salida) {
        return texto200(
          "El modelo no pudo con esa imagen.\n\n" +
            "Casi siempre es una de estas:\n" +
            "  · el enlace caducó (los de Instagram duran horas)\n" +
            "  · no es una imagen, es una página\n" +
            "  · no queda saldo en OpenAI\n\n" +
            "En `wrangler tail` sale el motivo exacto.\n"
        );
      }

      const { productos, respuestaCliente, termino } = await decidir({
        env,
        salida,
        texto: "",
        historialPrevio: "",
      });

      return texto200(
        `El modelo vio: ${salida.buscar}\n` +
          `Le diría al cliente: ${respuestaCliente}\n` +
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
   Webhook de Meta
   ════════════════════════════════════════════════════════════════════ */

// Decide si un webhook merece trabajo, sin hacer ninguno. Es lo que frena
// la inundación: todo lo que devuelva null no cuesta absolutamente nada.
//
// META_MODO dice qué se acepta:
//   "imagenes"  fotos del cliente y respuestas a historias   (por defecto)
//   "historias" solo las respuestas a historias
//   "off"       nada; el webhook queda desactivado
//
// El texto suelto NUNCA se atiende por aquí: es de ManyChat. Atenderlo
// significaría responder dos veces al mismo cliente.
function queAtender(env, crudo) {
  const modo = (env.META_MODO || "imagenes").toLowerCase();
  if (modo === "off") return null;

  let cuerpo;
  try {
    cuerpo = JSON.parse(crudo);
  } catch {
    console.error("Meta mandó algo que no es JSON");
    return null;
  }

  const aceptar =
    modo === "historias" ? new Set(["historia"]) : new Set(["historia", "imagen"]);

  return leerMensaje(cuerpo, { aceptar });
}

async function atenderMeta(env, mensaje) {
  const esHistoria = mensaje.tipo === "historia";

  // Aquí ya solo llegan imágenes e historias: queAtender() descartó el
  // resto sin gastar nada. Así que siempre hay algo que mirar.
  const imagen = mensaje.historia.url || mensaje.foto;
  console.log(
    `Meta → ATIENDO ${mensaje.tipo} de:${mensaje.igsid} ` +
      `texto:${JSON.stringify(mensaje.texto.slice(0, 60))}`
  );

  if (!imagen) return;

  // ── EL RELEVO: le paso la imagen a ManyChat y me callo ──────────────
  //
  // Meta manda este MISMO webhook a dos apps: la de ManyChat y esta. Si
  // las dos le responden al cliente, recibe el mensaje duplicado — que es
  // justo el bug que esto arregla. ManyChat ya está llevando la
  // conversación y ya llama a /manychat con cada mensaje, así que la
  // solución no es que esta app conteste mejor: es que deje de contestar,
  // y en su lugar le pase la URL de la imagen a ManyChat por un campo del
  // subscriber. Cuando ManyChat llame a /manychat con esa imagen, entra
  // por el camino normal de abajo (atenderManyChat) como si el cliente la
  // hubiera mandado directo — y esa es la ÚNICA respuesta que sale.
  //
  // Ver manychat-campo.js para el setup que hace falta en ManyChat.
  if (env.MANYCHAT_API_TOKEN && env.MANYCHAT_CAMPO_IMAGEN) {
    const puesto = await ponerCampoManyChat(env, mensaje.igsid, imagen);
    if (puesto) {
      console.log(
        `Imagen pasada a ManyChat (campo "${env.MANYCHAT_CAMPO_IMAGEN}"): ` +
          "me callo, responde ManyChat."
      );
      return;
    }
    console.error(
      "No pude pasarle la imagen a ManyChat: respondo yo directo, como " +
        "respaldo. Revisa MANYCHAT_API_TOKEN y MANYCHAT_CAMPO_IMAGEN."
    );
  }

  // ── CAMINO DE RESPALDO: si el relevo no está configurado o falló ────
  //
  // Sin esto, un token vencido o un campo mal escrito dejaría al cliente
  // sin ninguna respuesta, que es peor que una duplicada. Responder acá
  // directo es el comportamiento de antes de este arreglo.
  const nombre = primerNombre(await obtenerNombre(env, mensaje.igsid));

  // Sin base de datos no hay historial que recuperar: para el Worker esta
  // es la primera vez que habla con esta persona. Da igual, porque la
  // respuesta a una historia SIEMPRE abre la conversación.
  const entrada = contexto(
    nombre,
    "",
    mensaje.texto || "(respondió a una historia)",
    esHistoria ? "[EL CLIENTE RESPONDIÓ A UNA HISTORIA — la imagen que ves ES la historia]" : "",
    esHistoria
  );

  // La foto se descarga aquí y viaja dentro de la petición. Pasarle a
  // OpenAI el enlace del CDN de Instagram no funciona: le responde 403.
  const { uri: foto, motivo: porQueNo } = await comoDataUri(env, imagen);

  // SI NO PUDIMOS VER LA HISTORIA, AQUÍ NO HAY NADA QUE APORTAR.
  //
  // Lo único que este camino tiene y ManyChat no es la imagen de la historia.
  // Sin ella, los dos tenemos exactamente el mismo texto del cliente… salvo
  // que ManyChat además tiene su historial y su nombre. Su respuesta es
  // mejor que la nuestra.
  //
  // Y si contestamos igual, el cliente recibe DOS respuestas: la suya y la
  // nuestra. Así que nos callamos y le dejamos el turno.
  if (!foto && env.MANYCHAT_SECRET) {
    console.log(
      `Historia sin imagen (${porQueNo}): se la dejo a ManyChat, que tiene el historial`
    );
    return;
  }

  // Si no se puede mirar, NO es el final del camino. La mayoría de las
  // historias son vídeo, y el cliente que responde a una historia es el que
  // más cerca está de comprar: se le atiende por lo que escribió.
  const salida = foto
    ? await responderImagen(env, foto, entrada)
    : await responderTexto(
        env,
        contexto(
          nombre,
          "",
          mensaje.texto || "(respondió a una historia)",
          marcarSinVer(porQueNo),
          esHistoria
        )
      );

  // Y si además el modelo falla, la pregunta se la hacemos nosotros, que es
  // infinitamente mejor que decirle que el sistema se trabó.
  if (!salida && !foto && !env.MANYCHAT_SECRET) {
    const frase = HISTORIA_SIN_VER[Math.floor(Math.random() * HISTORIA_SIN_VER.length)];
    console.log(`Historia sin ver (${porQueNo}) → pregunto: ${JSON.stringify(frase)}`);
    await enviarBotonCatalogo(env, mensaje.igsid, frase);
    return;
  }

  if (!salida) {
    await enviarTexto(env, mensaje.igsid, FALLO_TECNICO);
    await avisarAsesor(env, {
      nombre,
      igsid: mensaje.igsid,
      mensaje: mensaje.texto || "(respondió a una historia)",
      respuesta: "EL MODELO FALLÓ — nadie le respondió",
      motivo: "EL MODELO NO RESPONDIÓ",
      historia: esHistoria ? "respuesta a una historia" : "",
    });
    return;
  }

  const { productos, respuestaCliente, termino, preguntoTalla, buscoSinExito } =
    await decidir({ env, salida, texto: mensaje.texto, historialPrevio: "" });

  if (productos.length) {
    await enviarTexto(env, mensaje.igsid, respuestaCliente);
    await enviarFichas(env, mensaje.igsid, productos);
  } else {
    await enviarBotonCatalogo(env, mensaje.igsid, respuestaCliente);
  }

  const escalada = hayEscalada({
    respuesta: respuestaCliente,
    productos,
    preguntoTalla,
    buscoSinExito,
  });

  if (escalada) {
    await avisarAsesor(env, {
      nombre,
      igsid: mensaje.igsid,
      mensaje: mensaje.texto || "(respondió a una historia)",
      respuesta: respuestaCliente,
      motivo: motivo({ preguntoTalla }),
      historial: salida.historial,
      busco: termino,
      productos,
      historia: esHistoria ? "respuesta a una historia" : "",
    });
  }
}

function texto200(cuerpo) {
  return new Response(cuerpo, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

async function atenderManyChat(env, request) {
  // Si defines el secreto, exigimos la cabecera. Si no, se salta el control.
  if (env.MANYCHAT_SECRET) {
    const cabecera = request.headers.get("authorization") || "";
    if (cabecera !== `Bearer ${env.MANYCHAT_SECRET}`) {
      return json({ version: "v2", content: { type: "instagram", messages: [] } }, 401);
    }
  }

  const datos = await request.json().catch(() => null);
  if (!datos) return json(fallo(env), 200);

  // ManyChat nombra los campos como quien los creó: unas veces "historial",
  // otras "Historial", y la foto puede llegar como image_url o img_url. Se
  // acepta cualquiera de las formas en vez de romperse por una mayúscula.
  const texto = leer(datos, ["product_query", "last_input_text", "mensaje", "texto"]);
  // Cuando ManyChat no resuelve una variable, manda el texto literal
  // "{{cuf_...}}". Si lo tratáramos como foto, el modelo fallaría y el cliente
  // recibiría el mensaje de avería en vez de una respuesta.
  const foto = urlValida(leer(datos, ["image_url", "img_url", "imagen", "foto"]));
  const historialCrudo = leer(datos, ["historial", "Historial"]);
  const nombre = leer(datos, ["nombre_cliente", "Nombre", "nombre", "first_name"]);
  const historia = leer(datos, ["origen_historia", "Origen_historia", "origen"]);

  // El historial trae pegada al final la cuenta de cuántas veces le hemos
  // dicho su nombre. Se separa aquí: el modelo y el asesor ven el historial
  // limpio, y la marca se vuelve a poner al guardar.
  const vecesNombre = vecesUsado(historialCrudo);
  const historialPrevio = sinMarca(historialCrudo);

  // El nombre solo se le pasa a las frases mientras no se haya gastado el
  // cupo. Al llegar al tope, saludo.js y catalogo.js usan sus variantes sin
  // nombre, que dicen lo mismo sin sonar a insistencia.
  const nombreCorto = primerNombre(nombre);
  const nombreUsable = vecesNombre < MAXIMO_DE_VECES ? nombreCorto : "";

  // Con esto, un vistazo a `wrangler tail` dice si ManyChat está mandando el
  // historial o llega vacío, que es de donde salen casi todos los fallos.
  console.log(
    `ManyChat → texto:${JSON.stringify(texto.slice(0, 60))} ` +
      `historial:${resumir(historialPrevio)} ` +
      `nombre:${JSON.stringify(nombre)} ` +
      `foto:${foto ? "si" : "no"} historia:${JSON.stringify(historia)}`
  );

  if (!texto && !foto) return json(fallo(env), 200);

  // Quien ya escribió antes y vuelve con un "hola" suelto no necesita al
  // modelo: no hay nada que buscar. Se le devuelve el saludo con su nombre,
  // variando la frase. La primera vez de cada cliente NO entra aquí: esa
  // bienvenida la escribe el modelo con el tono del prompt.
  if (historialPrevio && !foto && esSoloSaludo(texto)) {
    const respuesta = saludoDeVuelta(nombreUsable, texto);
    console.log(`Saludo de vuelta → ${JSON.stringify(respuesta)}`);
    return responder(env, {
      respuesta,
      // El historial se devuelve igual que vino: un "hola" no añade nada
      // que valga la pena recordar.
      historial: historialPrevio,
      // Sin botón: es un saludo, no un empujón a comprar.
      conBoton: false,
      nombreCorto,
      vecesNombre,
    });
  }

  // "¿Qué más tienen?" no lleva nada que buscar: quiere pasearse por la
  // tienda. Se le manda el catálogo con ganas, sin gastar una llamada al
  // modelo para que redacte lo mismo.
  //
  // La talla va PRIMERO a propósito: "¿tienen más tallas?" lleva un "más",
  // pero no es un paseo por el catálogo, es una pregunta para el asesor y
  // tiene que seguir su camino.
  if (!foto && !PREGUNTA_TALLA.test(texto) && pideVerMas(texto)) {
    const respuesta = fraseDeCatalogo(nombreUsable);
    console.log(`Pidió ver más → ${JSON.stringify(respuesta)}`);
    return responder(env, {
      respuesta,
      historial: conNota(historialPrevio, "Pidió ver más y le pasé el catálogo."),
      nombreCorto,
      vecesNombre,
    });
  }

  // Se le pasa nombreUsable, no el nombre a secas: pasado el tope, el modelo
  // recibe el nombre vacío y no puede escribirlo aunque quiera.
  const entrada = contexto(
    nombreUsable,
    historialPrevio,
    texto || "(mandó una foto)",
    marcarHistoria(historia),
    Boolean(historia) // viene de una historia nueva: lo de antes ya no manda
  );

  // Igual que en el camino de Meta: si viene foto, se descarga aquí. Las
  // de ManyChat salen del mismo CDN protegido.
  const { uri: fotoLista } = foto ? await comoDataUri(env, foto) : { uri: "" };
  if (foto && !fotoLista) {
    console.error("Llegó una foto pero no se pudo descargar: sigo solo con el texto");
  }

  const salida = fotoLista
    ? await responderImagen(env, fotoLista, entrada)
    : await responderTexto(env, entrada);

  if (!salida) {
    await avisarAsesor(env, {
      nombre,
      igsid: datos.subscriber_id || "",
      mensaje: texto || "(mandó una foto)",
      respuesta: "EL MODELO FALLÓ — nadie le respondió",
      historial: historialPrevio,
      historia,
    });
    return json(fallo(env), 200);
  }

  const {
    preguntoTalla,
    termino,
    productos,
    buscoSinExito,
    respuestaCliente,
  } = await decidir({ env, salida, texto, historialPrevio });

  const escalada = hayEscalada({
    respuesta: respuestaCliente,
    productos,
    preguntoTalla,
    buscoSinExito,
  });

  if (escalada) {
    await avisarAsesor(env, {
      nombre,
      igsid: datos.subscriber_id || "",
      mensaje: texto || "(mandó una foto)",
      respuesta: respuestaCliente,
      motivo: motivo({ preguntoTalla }),
      // El historial que acaba de escribir el modelo, que ya incluye este
      // mensaje: es el resumen de la conversación hasta ahora.
      historial: salida.historial || historialPrevio,
      busco: termino,
      productos,
      historia,
    });
  }

  return responder(env, {
    respuesta: respuestaCliente,
    productos,
    historial: salida.historial || historialPrevio,
    escalada,
    nombreCorto,
    vecesNombre,
  });
}

// Toda respuesta al cliente sale por aquí. Cuenta los nombres que lleva de
// verdad el texto —los que puso el código y los que puso el modelo por su
// cuenta— y guarda el total pegado al historial.
function responder(env, { respuesta, productos = [], historial, escalada = false, conBoton = true, nombreCorto, vecesNombre }) {
  const veces = vecesNombre + contarEn(respuesta, nombreCorto);
  if (veces !== vecesNombre) {
    console.log(`Nombre usado ${veces}/${MAXIMO_DE_VECES}`);
  }
  return json(
    respuestaManyChat({
      respuesta,
      productos,
      historial: conMarca(recortarHistorial(historial), veces),
      escalada,
      conBoton,
      urlCatalogo: env.URL_CATALOGO,
      whatsapp: env.WHATSAPP,
    }),
    200
  );
}

function fallo(env) {
  return respuestaManyChat({
    respuesta: FALLO_TECNICO,
    historial: "",
    escalada: true,
    urlCatalogo: env.URL_CATALOGO,
  });
}

// Añade una nota al historial sin repetirla si ya está al final: si alguien
// escribe "más" cinco veces seguidas, el campo de ManyChat no se llena de
// copias de la misma frase.
function conNota(historial, nota) {
  const previo = String(historial || "").trim();
  if (!previo) return nota;
  if (previo.endsWith(nota)) return previo;
  return `${previo} ${nota}`;
}

function json(objeto, status) {
  return new Response(JSON.stringify(objeto), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Para el registro: corta por palabras y lo dice, en vez de partir una a la
// mitad y parecer que el dato llegó roto.
function resumir(texto, limite = 80) {
  const limpio = String(texto || "").trim();
  if (!limpio) return "VACIO";
  if (limpio.length <= limite) return JSON.stringify(limpio);
  const corte = limpio.slice(0, limite);
  const hastaPalabra = corte.slice(0, corte.lastIndexOf(" "));
  return JSON.stringify(`${hastaPalabra}…`) + ` (+${limpio.length - hastaPalabra.length} car.)`;
}

// Primer nombre de la lista que traiga algo. Descarta las variables que
// ManyChat no resolvió: llegan como el texto literal "{{algo}}".
function leer(datos, nombres) {
  for (const nombre of nombres) {
    const valor = String(datos?.[nombre] ?? "").trim();
    if (valor && !/^\{\{.*\}\}$/.test(valor)) return valor;
  }
  return "";
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

// El producto de la historia viene ya escrito en el campo, puesto por la
// automatización de cada historia en ManyChat.
function marcarHistoria(valor) {
  if (!valor || valor.toLowerCase() === "generico") return "";
  return `[EL CLIENTE RESPONDIÓ A UNA HISTORIA]\n[PRODUCTO DE LA HISTORIA: ${valor}]`;
}

// Lo que ve el modelo antes del mensaje del cliente.
// Lo que ve el modelo antes del mensaje del cliente. La construcción vive en
// historial.js, que es donde está la regla de separar pasado y presente.
function contexto(nombre, historial, texto, marca = "", esHistoriaNueva = false) {
  return contextoParaElModelo({
    nombre: primerNombre(nombre),
    historial,
    texto,
    marca,
    esHistoriaNueva,
  });
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
  if (!recortado) return "¡Hola! ¿Qué andas buscando? 😊";
  return recortado.charAt(0).toUpperCase() + recortado.slice(1);
}

// De lo que escribió el modelo a lo que se le manda al cliente: se le quita
// la talla al término, se separa el color, se busca en Shopify y se decide
// si la respuesta del modelo sirve o hay que sustituirla.
//
// Vive aparte porque la usan los dos caminos de entrada: el de ManyChat y el
// del webhook de Meta. Si se cambia aquí, cambia en los dos.
async function decidir({ env, salida, texto, historialPrevio }) {
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
  if (aBuscar) {
    productos = await buscarProductos(env, aBuscar);
    habiaDelModelo = productos.length;

    // Solo se filtra cuando el color no ES la búsqueda: si ya buscamos
    // "negr" en Shopify, volver a filtrar por negro no aporta nada.
    if (colores.length && sinColor) {
      productos = filtrarPorColor(productos, colores);
      console.log(
        `Del modelo había ${habiaDelModelo}; en ${colores.join(" + ")} quedan ${productos.length}`
      );
    }

    if (!productos.length) {
      console.log(`Sin resultados para "${aBuscar}"`);
    }
  }

  // Si buscó y no encontró nada, no le damos la respuesta optimista del
  // modelo: pasamos al asesor sin afirmar que el producto no existe. Vale
  // igual si el modelo sí estaba pero no en ese color: el cliente pidió ese
  // color, y decirle que sí mostrándole otro es engañarlo.
  const buscoSinExito = Boolean(aBuscar) && !productos.length;

  // Preguntó la talla y no quedó nada que buscar: la talla la confirma una
  // persona, así que no se le da largas ni se le muestra el catálogo entero.
  const soloTalla = preguntoTalla && !termino;

  // Si ya se conocen, se le quita la bienvenida aunque el modelo la haya
  // escrito. Es el fallo que más se nota: saludar dos veces.
  const respuestaFinal = historialPrevio
    ? sinBienvenida(salida.respuesta)
    : salida.respuesta;

  const respuestaCliente = soloTalla
    ? SOLO_TALLA
    : buscoSinExito
      ? SIN_RESULTADOS
      : respuestaFinal;


  return {
    preguntoTalla,
    termino,
    aBuscar,
    colores,
    productos,
    buscoSinExito,
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
//     Antes esto miraba el historial, que arrastra "Escalado a asesor" para
//     siempre, y por eso avisaba en todos los mensajes posteriores.
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
