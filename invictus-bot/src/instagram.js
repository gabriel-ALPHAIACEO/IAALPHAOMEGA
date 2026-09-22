// Hablar con Instagram: comprobar que el webhook es auténtico y mandar
// mensajes. Es el único canal del bot (19-sep-2026: se retiró ManyChat,
// ver README — el problema de fondo era que dos apps atendían el mismo
// webhook de Meta por separado; con una sola app ese problema no existe).

const GRAFO = "https://graph.instagram.com/v23.0";

/* ── Firma ───────────────────────────────────────────────────────── */

// Meta firma cada webhook con el secreto de la app. Sin esta comprobación,
// cualquiera que descubra la URL puede hacer que el bot escriba a clientes.
export async function firmaValida(secreto, cabecera, cuerpoCrudo) {
  if (!secreto || !cabecera) return false;
  if (!cabecera.startsWith("sha256=")) return false;

  const clave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secreto),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const firma = await crypto.subtle.sign(
    "HMAC",
    clave,
    new TextEncoder().encode(cuerpoCrudo)
  );

  const esperado = [...new Uint8Array(firma)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return igualesSinFiltrar(esperado, cabecera.slice(7));
}

// Comparación de tiempo constante: comparar con === deja escapar, por lo que
// tarda, pistas sobre cuántos caracteres acertó quien lo esté intentando.
function igualesSinFiltrar(a, b) {
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) {
    diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diferencia === 0;
}

/* ── Envío ───────────────────────────────────────────────────────── */

async function enviar(env, igsid, mensaje) {
  let respuesta;
  try {
    respuesta = await fetch(`${GRAFO}/me/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.IG_TOKEN}`,
      },
      body: JSON.stringify({ recipient: { id: igsid }, message: mensaje }),
    });
  } catch (error) {
    console.error("No se pudo enviar a Instagram:", error.message);
    return "";
  }

  if (!respuesta.ok) {
    console.error("Instagram rechazó el envío:", respuesta.status, await respuesta.text());
    return "";
  }

  const datos = await respuesta.json();
  return datos.message_id || ""; // lo guardamos para reconocer nuestro propio eco
}

export function enviarTexto(env, igsid, texto) {
  return enviar(env, igsid, { text: recortar(texto, 1000) });
}

// Las fichas con foto son lo que en Make mandaba el módulo de plantilla
// genérica. Instagram admite 10 como máximo.
export function enviarFichas(env, igsid, productos) {
  const elementos = productos.slice(0, 10).map((p) => {
    const ficha = {
      title: recortar(p.titulo, 80),
      subtitle: p.precio || "",
      image_url: p.imagen || "",
    };

    // Los mismos dos botones que por ManyChat: ver el producto y, debajo,
    // comprar por WhatsApp con el mensaje ya escrito. Si no se muestran
    // iguales por los dos caminos, el cliente ve una tienda distinta según
    // por dónde le escriba.
    const botones = [];
    if (p.url) botones.push({ type: "web_url", url: p.url, title: "Ver producto" });

    const comprar = enlaceWhatsapp(env.WHATSAPP, p.titulo);
    if (comprar) botones.push({ type: "web_url", url: comprar, title: "Comprar" });

    // Una lista de botones vacía es un valor inválido.
    if (botones.length) ficha.buttons = botones;

    return ficha;
  });

  return enviar(env, igsid, {
    attachment: {
      type: "template",
      payload: { template_type: "generic", elements: elementos },
    },
  });
}

export function enviarBotonCatalogo(env, igsid, texto) {
  return enviar(env, igsid, {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text: recortar(texto, 640),
        buttons: [{ type: "web_url", url: env.URL_CATALOGO, title: "Ver catálogo" }],
      },
    },
  });
}

/* ── Perfil ──────────────────────────────────────────────────────── */

// El perfil del cliente: su nombre tal como lo puso en Instagram y su @.
//
// Se devuelven POR SEPARADO a propósito. Antes solo salía "name || username"
// mezclado, y como el saludo descarta los usuarios con números
// ("jonathanrodric982101"), a muchos clientes se les quedaba el nombre
// vacío: se volvía a pedir en cada mensaje y en Slack salía "sin nombre".
// Ahora el @ se guarda siempre, aunque no sirva para saludar.
export async function obtenerPerfil(env, igsid) {
  try {
    const respuesta = await fetch(
      `${GRAFO}/${igsid}?fields=name,username&access_token=${env.IG_TOKEN}`
    );
    if (!respuesta.ok) {
      // Sale en `wrangler tail`. Si pasa con todos los clientes, casi
      // siempre es el IG_TOKEN (caducado o sin permiso de mensajes).
      console.error(
        `No se pudo leer el perfil de ${igsid}:`,
        respuesta.status,
        (await respuesta.text()).slice(0, 200)
      );
      return { nombre_completo: "", usuario: "" };
    }
    const datos = await respuesta.json();
    return {
      nombre_completo: String(datos.name || "").trim(),
      usuario: String(datos.username || "").trim().replace(/^@/, ""),
    };
  } catch (error) {
    console.error("No se pudo leer el perfil:", error.message);
    return { nombre_completo: "", usuario: "" };
  }
}

// El enlace de WhatsApp con el mensaje ya escrito. El número va en formato
// internacional y SIN el +; aquí se limpian los signos por si acaso.
function enlaceWhatsapp(numero, titulo) {
  const limpio = String(numero || "").replace(/\D/g, "");
  if (!limpio) return "";

  const mensaje = `Hola, me interesa ${recortar(titulo, 80)} 😊`;
  return `https://wa.me/${limpio}?text=${encodeURIComponent(mensaje)}`;
}

function recortar(texto, limite) {
  const limpio = String(texto || "");
  return limpio.length > limite ? limpio.slice(0, limite - 1) + "…" : limpio;
}

/* ── Lo que trae un mensaje ──────────────────────────────────────── */

// AQUÍ SE CORTA LA INUNDACIÓN.
//
// Meta manda un webhook por CADA cosa que ocurre en la cuenta: cada "visto",
// cada "está escribiendo", cada reacción con un corazón, cada comentario. En
// un día normal eso son cientos de avisos, y ninguno necesita respuesta. Eso
// fue lo que se comió los créditos de Make: pagaba una operación por cada uno.
//
// Esta función devuelve null para todo lo que no sea (a) una persona
// mandándonos texto, una imagen o respondiendo a una historia, o (b) el eco
// de un mensaje que salió de la cuenta —el nuestro o el de un asesor
// escribiendo a mano—, que se usa para la pausa automática. Devolver null
// aquí significa que el Worker no llama a OpenAI, no llama a Shopify y no
// manda nada: solo responde 200 y se olvida.

// Ahora que esta es la única app que atiende el webhook (sin ManyChat de
// por medio), el texto suelto SÍ se atiende aquí: ya no hay un segundo
// sistema que lo reciba y responda por su cuenta.
const ACEPTADOS = new Set(["historia", "imagen", "texto", "eco"]);

export function leerMensaje(cuerpo, { aceptar = ACEPTADOS } = {}) {
  const entrada = cuerpo?.entry?.[0];

  // "changes" son los comentarios y las menciones en publicaciones. No es
  // un mensaje directo y no es asunto nuestro.
  if (entrada?.changes) return descartar("un comentario o una mención");

  const evento = entrada?.messaging?.[0];
  if (!evento) return descartar("un evento sin mensaje");

  // Los tres que más ruido hacen, y que Meta manda aunque no los pidas.
  if (evento.read) return descartar("un 'visto'");
  if (evento.delivery) return descartar("un 'entregado'");
  if (evento.reaction) return descartar("una reacción");
  if (evento.postback) return descartar("un botón de plantilla");

  const mensaje = evento.message;
  if (!mensaje) return descartar("un evento que no lleva mensaje");

  // El eco es la copia de CUALQUIER mensaje que sale de la cuenta: el
  // nuestro (el bot respondiendo) o el de un asesor escribiendo a mano
  // desde la app de Instagram. Ya no se descarta sin más: index.js lo usa
  // para la pausa automática —si el mid no es de los que mandó el bot,
  // fue una persona, y hay que apartarse—. Ojo: en un eco el cliente es
  // el "recipient", no el "sender" (el sender ahí es la propia cuenta).
  if (mensaje.is_echo) {
    if (!aceptar.has("eco")) return descartar("el eco de un mensaje nuestro");
    return {
      tipo: "eco",
      igsid: evento.recipient?.id || "",
      mid: mensaje.mid || "",
      // El texto del eco hace falta para una sola cosa: reconocer la frase
      // con la que el asesor le devuelve la conversación al bot.
      texto: String(mensaje.text || "").trim(),
      foto: "",
      historia: { url: "", id: "" },
    };
  }
  if (mensaje.is_deleted) return descartar("un mensaje borrado");
  if (mensaje.is_unsupported) return descartar("un mensaje que Meta no entiende");

  const adjuntos = Array.isArray(mensaje.attachments) ? mensaje.attachments : [];
  const historia = leerHistoria(mensaje, adjuntos);
  const foto = primeraImagen(adjuntos);

  const tipo = historia.url ? "historia" : foto ? "imagen" : "texto";
  if (!aceptar.has(tipo)) return descartar(`un mensaje de ${tipo}`);

  return {
    tipo,
    igsid: evento.sender?.id || "",
    mid: mensaje.mid || "",
    texto: String(mensaje.text || "").trim(),
    foto,
    historia,
  };
}

// Una línea por descarte, para que en `wrangler tail` se vea la inundación
// siendo frenada en vez de tener que suponerlo.
function descartar(queEra) {
  console.log(`Meta → ignoro ${queEra}`);
  return null;
}

function primeraImagen(adjuntos) {
  const imagen = adjuntos.find((a) => a?.type === "image");
  return urlBuena(imagen?.payload?.url);
}

// Meta ha ido cambiando dónde pone la historia según la versión, así que se
// miran los tres sitios en vez de confiar en uno.
function leerHistoria(mensaje, adjuntos) {
  const respondeA = mensaje.reply_to || {};
  const url = urlBuena(
    respondeA.story?.url ||
      respondeA.story?.link ||
      adjuntos.find((a) => a?.type === "story_mention")?.payload?.url
  );

  return url ? { url, id: respondeA.story?.id || "" } : { url: "", id: "" };
}

function urlBuena(valor) {
  const texto = String(valor || "").trim();
  return /^https?:\/\//i.test(texto) ? texto : "";
}
