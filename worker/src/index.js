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
// OJO si aparecen archivos extraños en la carpeta de despliegue: existió en
// paralelo otra versión de ESTE MISMO bot (repo estherzzerpa/
// challenge-javascript) donde ManyChat seguía siendo el canal y la memoria
// vivía en KV. Si ves un memoria.js o un nombre.js sueltos, son de esa otra
// versión y NO van con este código — mezclarlos rompe el arranque.

import { responderTexto, responderImagen } from "./ia.js";
import { buscarProductos } from "./shopify.js";
import { avisarAsesor } from "./aviso.js";
import { esSoloSaludo, saludoDeVuelta } from "./saludo.js";
import { pideElCatalogo, fraseDeCatalogo } from "./catalogo.js";
import { separarColor, filtrarPorColor, terminoDeColor } from "./color.js";
import { comoDataUri } from "./imagen.js";
import { validarIdentificacion } from "./identificar.js";
import { contextoParaElModelo, recortarHistorial } from "./historial.js";
import {
  cargarContacto,
  guardarContacto,
  marcarEnvio,
  pausar,
  estaPausado,
  esEcoPropio,
  envioReciente,
} from "./estado.js";
import {
  firmaValida,
  leerMensaje,
  enviarTexto,
  enviarFichas,
  enviarBotonCatalogo,
  obtenerNombre,
} from "./instagram.js";

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
          `  PAUSA_HORAS         ${env.PAUSA_HORAS || "4 (por defecto)"}`,
          "",
          "BASE DE DATOS (D1) — la memoria del bot entre mensajes",
          `  DB                  ${env.DB ? "conectada" : "FALTA — sin esto el bot no recuerda nada de un mensaje al siguiente"}`,
          "",
          "ManyChat está retirado. Este Worker es el único canal: habla",
          "directo con la API de Instagram y guarda su propia memoria en D1.",
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

async function atenderMeta(env, mensaje) {
  // El eco de un mensaje que salió de la cuenta: el nuestro (el bot
  // respondiendo) o el de un asesor escribiendo a mano desde la app de
  // Instagram. Si el mid no es de los que mandó el bot, fue una persona —
  // y el bot se aparta unas horas para no hablar por encima de ella.
  if (mensaje.tipo === "eco") {
    if (!mensaje.igsid || !mensaje.mid) return;
    const contacto = await cargarContacto(env.DB, mensaje.igsid);

    if (esEcoPropio(contacto, mensaje.mid)) return; // eco nuestro, ya anotado

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

    const horas = Number(env.PAUSA_HORAS) || 4;
    await pausar(env.DB, mensaje.igsid, horas);
    console.log(`Asesor humano le escribió a ${mensaje.igsid}: bot pausado ${horas}h`);
    return;
  }

  console.log(
    `Meta → ATIENDO ${mensaje.tipo} de:${mensaje.igsid} ` +
      `texto:${JSON.stringify(mensaje.texto.slice(0, 60))}`
  );

  const contacto = await cargarContacto(env.DB, mensaje.igsid);

  if (estaPausado(contacto)) {
    console.log(`Bot pausado para ${mensaje.igsid}: no respondo`);
    return;
  }

  const esHistoria = mensaje.tipo === "historia";
  const imagenCruda = mensaje.historia.url || mensaje.foto || "";

  // El nombre se busca una sola vez por cliente y se guarda: no hace falta
  // gastar una llamada a la Graph API en cada mensaje.
  let nombre = contacto.nombre;
  if (!nombre) {
    nombre = primerNombre(await obtenerNombre(env, mensaje.igsid));
  }

  const historialPrevio = contacto.historial;
  const textoCliente =
    mensaje.texto || (imagenCruda ? (esHistoria ? "(respondió a una historia)" : "(mandó una foto)") : "");

  // Quien ya escribió antes y vuelve con un "hola" suelto no necesita al
  // modelo: no hay nada que buscar. La primera vez de cada cliente NO entra
  // aquí: esa bienvenida la escribe el modelo con el tono del prompt.
  if (historialPrevio && !imagenCruda && esSoloSaludo(mensaje.texto)) {
    const respuesta = saludoDeVuelta(nombre, mensaje.texto);
    console.log(`Saludo de vuelta → ${JSON.stringify(respuesta)}`);
    const mid = await enviarTexto(env, mensaje.igsid, respuesta);
    await guardarContacto(env.DB, {
      ...contacto,
      nombre,
      mids_enviados: agregarMid(contacto.mids_enviados, mid),
      ultimo_envio: Date.now(),
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
    const mid = await enviarBotonCatalogo(env, mensaje.igsid, respuesta);
    await guardarContacto(env.DB, {
      ...contacto,
      nombre,
      historial: conNota(historialPrevio, "Pidió el catálogo y se lo pasé."),
      mids_enviados: agregarMid(contacto.mids_enviados, mid),
      ultimo_envio: Date.now(),
    });
    return;
  }

  const minutosCallado = minutosDesde(contacto.ultimo_envio);

  const entrada = contexto(
    nombre,
    historialPrevio,
    textoCliente,
    esHistoria ? "[EL CLIENTE RESPONDIÓ A UNA HISTORIA — la imagen que ves ES la historia]" : "",
    esHistoria,
    minutosCallado
  );

  // La foto se descarga aquí y viaja dentro de la petición. Pasarle a
  // OpenAI el enlace del CDN de Instagram no funciona: le responde 403.
  let foto = "";
  let porQueNo = "";
  if (imagenCruda) {
    ({ uri: foto, motivo: porQueNo } = await comoDataUri(env, imagenCruda));
  }

  // Si no se puede mirar, NO es el final del camino. La mayoría de las
  // historias son vídeo, y el cliente que responde a una historia es el que
  // más cerca está de comprar: se le atiende por lo que escribió.
  const salida = foto
    ? await responderImagen(env, foto, entrada)
    : imagenCruda
      ? await responderTexto(
          env,
          contexto(
            nombre,
            historialPrevio,
            textoCliente,
            marcarSinVer(porQueNo),
            esHistoria,
            minutosCallado
          )
        )
      : await responderTexto(env, entrada);

  // Y si además el modelo falla, la pregunta se la hacemos nosotros, que es
  // infinitamente mejor que decirle que el sistema se trabó.
  if (!salida && imagenCruda && !foto) {
    const frase = HISTORIA_SIN_VER[Math.floor(Math.random() * HISTORIA_SIN_VER.length)];
    console.log(`Historia sin ver (${porQueNo}) → pregunto: ${JSON.stringify(frase)}`);
    const mid = await enviarTexto(env, mensaje.igsid, frase);
    await guardarContacto(env.DB, {
      ...contacto,
      nombre,
      mids_enviados: agregarMid(contacto.mids_enviados, mid),
      ultimo_envio: Date.now(),
    });
    return;
  }

  if (!salida) {
    const mid = await enviarTexto(env, mensaje.igsid, FALLO_TECNICO);
    await guardarContacto(env.DB, {
      ...contacto,
      nombre,
      mids_enviados: agregarMid(contacto.mids_enviados, mid),
      ultimo_envio: Date.now(),
    });
    await avisarAsesor(env, {
      nombre,
      igsid: mensaje.igsid,
      mensaje: textoCliente,
      respuesta: "EL MODELO FALLÓ — nadie le respondió",
      motivo: "EL MODELO NO RESPONDIÓ",
      historia: esHistoria ? "respuesta a una historia" : "",
    });
    return;
  }

  const { productos, respuestaCliente, termino, preguntoTalla, buscoSinExito } =
    await decidir({ env, salida, texto: mensaje.texto, historialPrevio });

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
  let mids = contacto.mids_enviados;
  if (productos.length) {
    mids = agregarMid(mids, await enviarTexto(env, mensaje.igsid, respuestaCliente));
    mids = agregarMid(mids, await enviarFichas(env, mensaje.igsid, productos));
  } else if (buscoSinExito) {
    mids = agregarMid(mids, await enviarBotonCatalogo(env, mensaje.igsid, respuestaCliente));
  } else {
    // Conversación: preguntas, dudas, cortesías. Texto limpio, sin botón.
    mids = agregarMid(mids, await enviarTexto(env, mensaje.igsid, respuestaCliente));
  }

  // AQUÍ, y no al final. Entre el envío y el guardado solía haber una
  // llamada a Slack, y en esa ventana llegaba el eco de lo que acabábamos
  // de mandar: el bot no reconocía su propio mid, lo tomaba por un asesor
  // humano y se pausaba solo durante horas. Anotar el envío de inmediato
  // cierra esa carrera; envioReciente() en estado.js la cubre por si el
  // eco llega igual de rápido.
  const enviadoEn = Date.now();
  await marcarEnvio(env.DB, mensaje.igsid, mids, enviadoEn);

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
    historial: recortarHistorial(salida.historial || historialPrevio),
    pausado_hasta: contacto.pausado_hasta,
    mids_enviados: mids,
    ultimo_envio: enviadoEn,
  });
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

// Lo que ve el modelo antes del mensaje del cliente. La construcción vive en
// historial.js, que es donde está la regla de separar pasado y presente.
//
// "minutosCallado" es cuánto tiempo pasó desde que el bot le escribió por
// última vez a esta persona. historial.js lo usa para avisarle al modelo
// que no dé por hecho que se sigue hablando del mismo producto. Estuvo sin
// conectar hasta el 21-sep-2026: el parámetro existía en historial.js pero
// nadie se lo pasaba, así que siempre valía 0 y esa protección nunca se
// activaba — el cliente que volvía a los tres días recibía el precio del
// zapato de la vez pasada.
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
  if (!recortado) return "¡Hola! ¿Qué andas buscando? 😊";
  return recortado.charAt(0).toUpperCase() + recortado.slice(1);
}

// De lo que escribió el modelo a lo que se le manda al cliente: se le quita
// la talla al término, se separa el color, se busca en Shopify y se decide
// si la respuesta del modelo sirve o hay que sustituirla.
async function decidir({ env, salida, texto, historialPrevio }) {
  const preguntoTalla = PREGUNTA_TALLA.test(texto);

  // Antes que nada: si esto vino de una foto, se revisa que "buscar" sea
  // coherente con los rasgos que la propia IA marcó. Si dijo "Air Max 270"
  // pero ella misma marcó que no hay cámara de aire, esto lo corrige ACÁ
  // —determinístico, sin IA de por medio— antes de que el resto del
  // código llegue a buscarlo en Shopify o a mandarlo. Se modifica "salida"
  // en el momento para que tanto lo que sigue en esta función como lo que
  // el llamador guarda después (salida.respuesta, salida.historial) ya
  // vean la versión corregida.
  const verificacion = validarIdentificacion(salida);
  if (verificacion.corregido) {
    salida.buscar = verificacion.buscar;
    salida.respuesta = verificacion.respuesta;
    salida.historial = verificacion.historial;
  }

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
