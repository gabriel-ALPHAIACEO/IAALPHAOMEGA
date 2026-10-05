// Hablar con Instagram: comprobar que el webhook es auténtico y mandar
// mensajes. Es el único canal del bot (19-sep-2026: se retiró ManyChat,
// ver README — el problema de fondo era que dos apps atendían el mismo
// webhook de Meta por separado; con una sola app ese problema no existe).

import { leerAdjuntoCompartido } from "./publicacion.js";

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

// CUÁNTO SE ESPERA A INSTAGRAM (30-sep-2026).
//
// Cloudflare le da a cada mensaje del cliente 30 segundos EN TOTAL —leer
// la hoja, pensar la respuesta, mandarla—, y al llegar a 30 corta sin
// avisar. Sin un tope aquí, un envío que se cuelga se come ese tiempo y el
// turno muere a medias: el cliente recibe "aquí lo tienes 👇" y nunca las
// fotos. Con el tope, el envío falla a tiempo y queda margen para el plan B.
//
// Las fichas llevan más porque Instagram descarga las fotos ANTES de
// contestar: diez fotos de Drive pueden tardar sus segundos.
const ESPERA_ENVIO_MS = 8000;
const ESPERA_FICHAS_MS = 12000;

// Devuelve { mid, ventanaCerrada, tiempoAgotado, detalle }: quien manda
// fichas necesita saber POR QUÉ falló para decidir si vale la pena
// reintentar (ver enviarFichas). El resto usa enviar(), que da solo el mid.
async function enviarDetallado(env, igsid, mensaje, esperaMs = ESPERA_ENVIO_MS) {
  let respuesta;
  try {
    respuesta = await fetch(`${GRAFO}/me/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.IG_TOKEN}`,
      },
      body: JSON.stringify({ recipient: { id: igsid }, message: mensaje }),
      signal: AbortSignal.timeout(esperaMs),
    });
  } catch (error) {
    const tiempoAgotado = error?.name === "TimeoutError" || error?.name === "AbortError";
    console.error(
      tiempoAgotado
        ? `Instagram no contestó en ${esperaMs / 1000}s (${resumirEnvio(mensaje)}). ` +
            "Puede que haya llegado igual: no se repite, para no mandarlo dos veces."
        : `No se pudo enviar a Instagram: ${error?.message || error}`
    );
    return { mid: "", ventanaCerrada: false, tiempoAgotado, detalle: String(error?.message || error) };
  }

  if (!respuesta.ok) {
    const detalle = await respuesta.text();

    // LA VENTANA CERRADA NO ES UNA AVERÍA (26-sep-2026).
    //
    //   403 "This message is sent outside of allowed window."
    //   (IGApiException, code 10, error_subcode 2534022)
    //
    // Es la regla de Instagram: a quien no te ha escrito en las últimas 24
    // horas no se le puede mandar un mensaje suelto. Pasa siempre con quien
    // solo comentó en una publicación, y hasta ahora salía en el registro
    // como un error rojo entre otros errores de verdad, que es lo que hace
    // perder una tarde buscando una avería que no existe.
    //
    // Se explica en una línea y se sigue. Quien llama decide qué hacer: en
    // los comentarios, el precio ya va dentro del único mensaje permitido.
    if (/outside of allowed window|2534022/i.test(detalle)) {
      console.log(
        "Instagram no acepta este mensaje: la ventana de 24 h está cerrada " +
          "(esa persona no nos ha escrito). No es un fallo del bot ni del token."
      );
      return { mid: "", ventanaCerrada: true, tiempoAgotado: false, detalle };
    }

    console.error("Instagram rechazó el envío:", respuesta.status, detalle);
    return { mid: "", ventanaCerrada: false, tiempoAgotado: false, detalle };
  }

  // Si Instagram dijo que sí (200) pero la respuesta llega cortada, el
  // mensaje SALIÓ: se da por enviado, solo que sin su mid.
  let datos = {};
  try {
    datos = await respuesta.json();
  } catch (error) {
    console.error(`Instagram aceptó el envío pero su respuesta llegó cortada: ${error?.message || error}`);
  }

  // QUÉ SE LE MANDÓ AL CLIENTE, en el registro.
  //
  // Sin esta línea, `wrangler tail` cuenta lo que el bot PENSÓ pero no lo
  // que SALIÓ, y "el bot no respondió" es imposible de distinguir de "el
  // bot respondió algo que no servía". Con un cliente esperando, esa
  // diferencia es media hora de tail a ciegas. Un fallo al enviar ya se
  // veía; un envío correcto, no.
  console.log(`Meta ← mandé: ${resumirEnvio(mensaje)}`);

  // El mid se guarda para reconocer nuestro propio eco.
  // Sin mid pero con un 200, el mensaje salió: "sin-id" lo dice, para que
  // nadie lo reintente y el cliente no lo reciba dos veces.
  return { mid: datos.message_id || "sin-id", ventanaCerrada: false, tiempoAgotado: false, detalle: "" };
}

async function enviar(env, igsid, mensaje) {
  return (await enviarDetallado(env, igsid, mensaje)).mid;
}

// Lo justo para reconocerlo de un vistazo, sin volcar el JSON entero.
function resumirEnvio(mensaje) {
  if (mensaje?.text) return `"${recortar(mensaje.text, 90)}"`;

  const elementos = mensaje?.attachment?.payload?.elements;
  if (elementos?.length) {
    return `${elementos.length} ficha(s): ${elementos.map((e) => e.title).join(" · ")}`;
  }

  if (mensaje?.attachment?.payload?.buttons) return "botón del catálogo";
  return "adjunto";
}

export function enviarTexto(env, igsid, texto) {
  return enviar(env, igsid, { text: recortar(texto, 1000) });
}

// Las fichas con foto son lo que en Make mandaba el módulo de plantilla
// genérica. Instagram admite 10 como máximo.
//
// "¡AQUÍ LO TIENES! 👇" Y NINGUNA FOTO DEBAJO (30-sep-2026).
//
// Las fichas van en UN solo mensaje, y Instagram lo acepta o lo rechaza
// entero: si no puede descargar la foto de UNA ficha —un archivo de Drive
// que no está compartido, un enlace que ya no existe—, no llega ninguna.
// El texto de arriba ya había salido, así que el cliente leía "aquí lo
// tienes 👇" y debajo no había nada. Y nadie se enteraba: solo quedaba
// una línea roja en el registro.
//
// Ahora hay plan B y plan C:
//   1. Si Instagram lo rechaza, se prueba cuál foto no carga y se vuelve a
//      mandar SIN esa foto (la ficha sale igual, con su nombre y precio).
//   2. Si aun así no sale, va la lista escrita: nombre y precio, que es lo
//      que el cliente preguntó.
// Y en el registro queda, con nombre, qué foto hay que arreglar en la hoja.
export async function enviarFichas(env, igsid, productos) {
  const lista = productos.slice(0, 10);
  const armar = (sinFoto = new Set()) => ({
    attachment: {
      type: "template",
      payload: {
        template_type: "generic",
        elements: lista.map((p) => ficha(env, p, sinFoto.has(p.imagen))),
      },
    },
  });

  const primero = await enviarDetallado(env, igsid, armar(), ESPERA_FICHAS_MS);
  if (primero.mid) return primero.mid;

  // La ventana cerrada no se arregla reintentando. Y si Instagram no
  // contestó a tiempo, pudo haberlas entregado igual: repetir sería
  // mandarlas dos veces.
  if (primero.ventanaCerrada || primero.tiempoAgotado) return "";

  const rotas = await fotosQueNoCargan(lista);
  for (const p of lista.filter((p) => rotas.has(p.imagen))) {
    console.error(
      `LA FOTO DE "${p.titulo}" NO CARGA: ${p.imagen} — revisa en la hoja ese enlace ` +
        "(si es de Drive, que esté compartido como «Cualquier persona con el enlace»)."
    );
  }

  if (rotas.size) {
    const segundo = await enviarDetallado(env, igsid, armar(rotas), ESPERA_FICHAS_MS);
    if (segundo.mid) {
      console.log(`Las fichas salieron sin ${rotas.size} foto(s) que no cargan`);
      return segundo.mid;
    }
    if (segundo.tiempoAgotado) return "";
  }

  console.error("Las fichas no salieron: mando la lista escrita, con nombre y precio");
  return enviar(env, igsid, { text: recortar(listaEscrita(lista), 1000) });
}

function ficha(env, p, sinFoto) {
  const ficha = {
    title: recortar(p.titulo, 80),
    subtitle: p.precio || "",
  };

  // Sin foto, el campo NO va: un image_url vacío es un valor inválido y
  // Instagram rechaza el carrusel entero por él.
  if (p.imagen && !sinFoto) ficha.image_url = p.imagen;

  // EL BOTÓN "VER PRODUCTO" ESTÁ APAGADO (24-sep-2026, decisión del dueño).
  //
  // Llevaba al cliente a la ficha del producto, y EPICCELL no tiene tienda
  // online: ese botón no lleva a ninguna parte. Un botón que no cumple lo
  // que promete cuesta más que no tener botón.
  //
  // PARA VOLVER A PONERLO, apuntando a donde haga falta: pon esto en true
  // y, en la línea de abajo, cambia "p.url" por la dirección que toque y
  // "Ver producto" por su nombre nuevo. El resto del sistema no se entera.
  const VER_PRODUCTO = false;

  const botones = [];
  if (VER_PRODUCTO && p.url) {
    botones.push({ type: "web_url", url: p.url, title: "Ver producto" });
  }

  const comprar = enlaceWhatsapp(env.WHATSAPP, p.titulo);
  if (comprar) botones.push({ type: "web_url", url: comprar, title: "Comprar" });

  // Una lista de botones vacía es un valor inválido.
  if (botones.length) ficha.buttons = botones;

  return ficha;
}

// Las fotos que no se pueden descargar, probadas todas a la vez y con un
// tope corto: esto corre dentro de los mismos 30 segundos del turno.
const ESPERA_FOTO_MS = 4000;

async function fotosQueNoCargan(lista) {
  const enlaces = [...new Set(lista.map((p) => p.imagen).filter(Boolean))];
  const rotas = new Set();

  await Promise.all(
    enlaces.map(async (enlace) => {
      try {
        const r = await fetch(enlace, { redirect: "follow", signal: AbortSignal.timeout(ESPERA_FOTO_MS) });
        const tipo = r.headers?.get?.("content-type") || "";
        // Solo interesa si carga y si es una imagen: el cuerpo no se lee.
        try {
          await r.body?.cancel?.();
        } catch {
          // Si no se puede cancelar, da igual: ya se sabe lo que hacía falta.
        }
        if (!r.ok || !/^image\//i.test(tipo)) rotas.add(enlace);
      } catch {
        rotas.add(enlace);
      }
    })
  );

  return rotas;
}

// El plan C: lo mismo que decían las fichas, escrito.
function listaEscrita(lista) {
  return lista.map((p) => `🔹 ${p.titulo}${p.precio ? ` — ${p.precio}` : ""}`).join("\n");
}

// UN BOTÓN A UNA DIRECCIÓN QUE NO EXISTE ES PEOR QUE NINGÚN BOTÓN.
//
// URL_CATALOGO viene con un marcador de relleno en el wrangler.toml
// ("https://CAMBIA-ESTO.com"). Si nadie lo cambió —que es el caso de
// EPICCELL, que no tiene tienda online— el bot estaba mandando a sus
// clientes un botón "Ver catálogo" que abre una página inventada.
//
// Así que el botón sale SOLO si hay una dirección de verdad. Si no, se
// manda el mismo texto sin botón: el cliente recibe la respuesta igual y
// nadie acaba en una página que no existe.
const SIN_PONER = /^$|CAMBIA-ESTO|PENDIENTE|PON_AQUI|TU-CUENTA|ejemplo\.com|localhost/i;

export function hayCatalogo(env) {
  const url = String(env?.URL_CATALOGO || "").trim();
  return /^https?:\/\//i.test(url) && !SIN_PONER.test(url);
}

export function enviarBotonCatalogo(env, igsid, texto) {
  if (!hayCatalogo(env)) {
    console.log("URL_CATALOGO sin poner: mando el texto sin el botón del catálogo");
    return enviarTexto(env, igsid, texto);
  }

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

// UN TEXTO CON UN BOTÓN QUE ABRE UNA DIRECCIÓN: "Cómo llegar" → Google
// Maps (30-sep-2026, igual que en Invictus). Un enlace pegado en el texto
// también sirve, pero un botón se toca sin pensar y no se ve como spam.
// Si la dirección no es un enlace de verdad, sale el texto solo.
export function enviarConBoton(env, igsid, texto, { titulo, url } = {}) {
  if (!/^https?:\/\//i.test(String(url || "")) || SIN_PONER.test(url)) {
    return enviarTexto(env, igsid, texto);
  }

  return enviar(env, igsid, {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text: recortar(texto, 640),
        buttons: [{ type: "web_url", url, title: recortar(titulo || "Abrir", 20) }],
      },
    },
  });
}

// UN MENSAJE CON SUS BOTONES DE RESPUESTA (quick replies).
//
// Son los botones que Instagram pinta DEBAJO del mensaje y que el cliente
// toca en vez de escribir. Se usan para la lista de productos: "¿Quieres
// ver las imágenes de esta lista?" con "¡Sí, claro!" y "No, gracias".
//
// Cuando el cliente toca uno, llega un mensaje normal cuyo texto es el
// título del botón, y además con el "payload" que pusimos aquí — que es lo
// que el bot mira para saber qué tocó, sin depender de cómo esté escrito
// el título (ver leerMensaje).
//
// Instagram admite 13 como máximo y recorta los títulos largos: 20
// caracteres, y eso contando los emojis.
export function enviarConOpciones(env, igsid, texto, opciones) {
  const botones = (opciones || []).slice(0, 13).map(({ titulo, payload }) => ({
    content_type: "text",
    title: recortar(String(titulo || ""), 20),
    payload: String(payload || titulo || "").slice(0, 1000),
  }));

  if (!botones.length) return enviarTexto(env, igsid, texto);

  return enviar(env, igsid, {
    text: recortar(texto, 1000),
    quick_replies: botones,
  });
}

/* ── Comentarios ─────────────────────────────────────────────────── */

// QUIÉN SOY. El id y el usuario de la propia cuenta, para reconocer los
// comentarios propios y no responderse a sí mismo en bucle.
//
// Se pregunta una vez por arranque: no cambia nunca.
let yo = null;

export async function quienSoy(env) {
  if (yo) return yo;

  try {
    const respuesta = await fetch(`${GRAFO}/me?fields=id,username&access_token=${env.IG_TOKEN}`, {
      signal: AbortSignal.timeout(ESPERA_ENVIO_MS),
    });
    if (!respuesta.ok) {
      console.error("No pude leer quién soy:", respuesta.status, (await respuesta.text()).slice(0, 200));
      return { id: "", usuario: "" };
    }
    const datos = await respuesta.json();
    yo = { id: String(datos.id || ""), usuario: String(datos.username || "") };
    console.log(`Soy @${yo.usuario} (${yo.id})`);
    return yo;
  } catch (error) {
    console.error("No pude leer quién soy:", error?.message || error);
    return { id: "", usuario: "" };
  }
}

// La respuesta PÚBLICA, colgada del comentario del cliente.
export async function responderComentario(env, comentarioId, texto) {
  try {
    const respuesta = await fetch(`${GRAFO}/${comentarioId}/replies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: recortar(texto, 300), access_token: env.IG_TOKEN }),
      signal: AbortSignal.timeout(ESPERA_ENVIO_MS),
    });

    if (!respuesta.ok) {
      const detalle = (await respuesta.text()).slice(0, 300);
      console.error(
        `No pude responder el comentario ${comentarioId}: ${respuesta.status} ${detalle}` +
          (respuesta.status === 403 || /permission/i.test(detalle)
            ? " · CAUSA PROBABLE: al IG_TOKEN le falta el permiso de " +
              "gestionar comentarios (instagram_business_manage_comments)."
            : "")
      );
      return "";
    }

    const datos = await respuesta.json();
    return String(datos.id || "");
  } catch (error) {
    console.error("No pude responder el comentario:", error?.message || error);
    return "";
  }
}

// EL MENSAJE PRIVADO QUE ABRE LA CONVERSACIÓN.
//
// Meta deja mandar UN mensaje directo por comentario, aunque esa persona
// nunca te haya escrito: se manda al "comment_id" en vez de a un usuario.
// Es la única forma de pasar de un comentario público a un chat, y a
// partir de ahí la conversación sigue como cualquier otra.
//
// Devuelve el igsid del cliente, que es lo que hace falta para seguir
// mandándole cosas (las fichas, por ejemplo).
export async function privadoPorComentario(env, comentarioId, texto) {
  let respuesta;
  try {
    respuesta = await fetch(`${GRAFO}/me/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.IG_TOKEN}`,
      },
      body: JSON.stringify({
        recipient: { comment_id: comentarioId },
        message: { text: recortar(texto, 1000) },
      }),
      signal: AbortSignal.timeout(ESPERA_ENVIO_MS),
    });
  } catch (error) {
    console.error("No pude abrir el privado desde el comentario:", error?.message || error);
    return { igsid: "", mid: "" };
  }

  if (!respuesta.ok) {
    const detalle = (await respuesta.text()).slice(0, 300);
    console.error(
      `No pude abrir el privado del comentario ${comentarioId}: ${respuesta.status} ${detalle}` +
        (/10|permission|not authorized/i.test(detalle)
          ? " · CAUSA PROBABLE: el cliente no acepta mensajes de quien no " +
            "sigue, o al IG_TOKEN le falta permiso. Se le contesta en público."
          : "")
    );
    return { igsid: "", mid: "" };
  }

  const datos = await respuesta.json();
  return {
    igsid: String(datos.recipient_id || ""),
    mid: String(datos.message_id || ""),
  };
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
      `${GRAFO}/${igsid}?fields=name,username&access_token=${env.IG_TOKEN}`,
      { signal: AbortSignal.timeout(ESPERA_ENVIO_MS) }
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
// "publicacion" es el cliente compartiendo un post o un reel del feed por
// el chat. Antes no existía: ese mensaje caía en "texto", y como no lleva
// texto, al modelo le llegaba la nada y contestaba la bienvenida genérica
// a alguien que acababa de señalar un equipo con el dedo (ver
// publicacion.js).
// "anuncio" es quien llega desde una publicidad. Meta manda ese aviso SIN
// mensaje dentro, y por eso se caía por el "evento que no lleva mensaje":
// el cliente pulsaba "Enviar mensaje" en el anuncio y del otro lado no
// contestaba nadie (ver leerAnuncio).
const ACEPTADOS = new Set(["historia", "imagen", "texto", "eco", "publicacion", "anuncio", "audio"]);

/* ── QUIEN LLEGA DESDE UN ANUNCIO ──────────────────────────────────

   EL FALLO QUE ESTO ARREGLA (29-sep-2026, dicho por el dueño: "no
   responde a las personas que vienen de los anuncios").

   Cuando alguien pulsa "Enviar mensaje" en una publicidad, Meta abre el
   chat y manda un aviso de referencia. Ese aviso NO lleva "message"
   dentro, así que se descartaba con un "evento que no lleva mensaje" — y
   la persona se quedaba mirando un chat vacío, después de que la tienda
   pagara por ese clic.

   Y trae lo más valioso que puede traer un primer contacto: DE QUÉ
   ANUNCIO viene. El título del anuncio y su foto dicen qué equipo estaba
   mirando, igual que el pie de una publicación compartida.

   Meta lo pone en tres sitios distintos según cómo llegue —el aviso
   suelto, dentro del primer mensaje, o en un botón— así que se miran los
   tres.

   HACE FALTA EN EL PANEL DE META: suscribirse al campo
   "messaging_referral" (además de "messages"). Sin eso, el aviso suelto
   no llega nunca.
   ───────────────────────────────────────────────────────────────── */
function leerAnuncio(evento) {
  const referencia = evento?.referral || evento?.message?.referral || evento?.postback?.referral;
  if (!referencia) return null;

  // Lo que Meta cuenta del anuncio: su título, su foto y el post del que
  // salió. No siempre viene todo, y a veces no viene nada más que el id.
  const datos = referencia.ads_context_data || {};

  const anuncio = {
    // "ADS" cuando viene de una publicidad pagada; también existe
    // "SHORTLINK" (un ig.me/m/...) y "CUSTOMER_CHAT_PLUGIN".
    fuente: String(referencia.source || "").trim(),
    // La referencia que TÚ pones al crear el anuncio, si pusiste alguna.
    ref: String(referencia.ref || "").trim(),
    id: String(referencia.ad_id || referencia.ads_context_data?.ad_id || "").trim(),
    titulo: String(datos.ad_title || "").trim(),
    foto: urlBuena(datos.photo_url || ""),
    video: urlBuena(datos.video_url || ""),
    // El post del feed desde el que se hizo el anuncio. Con él se puede
    // leer el pie completo por la API, igual que con un comentario.
    publicacion: String(datos.post_id || "").trim(),
  };

  return anuncio.fuente || anuncio.id || anuncio.titulo || anuncio.ref ? anuncio : null;
}

export function leerMensaje(cuerpo, { aceptar = ACEPTADOS } = {}) {
  const entrada = cuerpo?.entry?.[0];

  // "changes" son los comentarios y las menciones en publicaciones. Los
  // comentarios SÍ se atienden, pero por otro camino: los lee
  // comentarios.js y los reparte index.js. Aquí solo se apartan.
  if (entrada?.changes) return descartar("un evento de publicación (lo mira comentarios.js)");

  const evento = entrada?.messaging?.[0];
  if (!evento) return descartar("un evento sin mensaje");

  // Los tres que más ruido hacen, y que Meta manda aunque no los pidas.
  if (evento.read) return descartar("un 'visto'");
  if (evento.delivery) return descartar("un 'entregado'");
  if (evento.reaction) return descartar("una reacción");
  const anuncio = leerAnuncio(evento);

  if (anuncio) {
    console.log(
      `Meta → VIENE DE UN ANUNCIO (${anuncio.fuente || "sin fuente"})` +
        (anuncio.titulo ? `: "${anuncio.titulo.slice(0, 80)}"` : "") +
        (anuncio.id ? ` · anuncio ${anuncio.id}` : "") +
        (anuncio.publicacion ? ` · publicación ${anuncio.publicacion}` : "")
    );
  }

  if (evento.postback && !anuncio) return descartar("un botón de plantilla");

  const mensaje = evento.message;

  // Sin mensaje pero con anuncio: es el aviso de que alguien acaba de
  // llegar desde una publicidad. Se atiende, que para eso se pagó.
  if (!mensaje && anuncio) {
    if (!aceptar.has("anuncio")) return descartar("un aviso de anuncio");

    return {
      tipo: "anuncio",
      igsid: evento.sender?.id || "",
      mid: "",
      texto: "",
      foto: "",
      historia: { url: "", id: "" },
      publicacion: { url: "", titulo: "", enlace: "" },
      opcion: String(evento.postback?.payload || "").trim(),
      anuncio,
    };
  }

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
      publicacion: { url: "", titulo: "", enlace: "" },
      opcion: "",
    };
  }
  if (mensaje.is_deleted) return descartar("un mensaje borrado");
  if (mensaje.is_unsupported) return descartar("un mensaje que Meta no entiende");

  const adjuntos = Array.isArray(mensaje.attachments) ? mensaje.attachments : [];

  // QUÉ TRAE EL MENSAJE, TAL CUAL LO MANDA META.
  //
  // Meta no documenta con qué forma llega cada cosa —un post compartido, un
  // reel, una publicación con varias fotos— y cambia de una versión a otra.
  // Sin esta línea, averiguarlo es adivinar; con ella, `wrangler tail` lo
  // dice en el momento y se ajusta lo que haga falta en una tarde.
  if (adjuntos.length) {
    console.log(
      `Meta → adjuntos: ${adjuntos
        .map((a) => `${a?.type || "?"}${a?.payload?.url ? ` (${String(a.payload.url).slice(0, 60)}…)` : ""}`)
        .join(" · ")}`
    );
  }

  const historia = leerHistoria(mensaje, adjuntos);
  const publicacion = leerAdjuntoCompartido(adjuntos);
  const foto = primeraImagen(adjuntos);
  // Las notas de voz (2-oct-2026): se transcriben en index.js (ver voz.js).
  const audio = urlBuena(adjuntos.find((a) => a?.type === "audio")?.payload?.url);

  // La historia va primero porque es más concreta: responder a una historia
  // también llega con adjunto, y ahí ya sabemos de qué publicación se trata.
  const tipo = historia.url
    ? "historia"
    : publicacion.url || publicacion.enlace
      ? "publicacion"
      : foto
        ? "imagen"
        : audio
          ? "audio"
          : "texto";

  if (!aceptar.has(tipo)) return descartar(`un mensaje de ${tipo}`);

  return {
    tipo,
    igsid: evento.sender?.id || "",
    mid: mensaje.mid || "",
    texto: String(mensaje.text || "").trim(),
    foto,
    historia,
    publicacion,
    audio: tipo === "audio" ? audio : "",
    // Qué botón de respuesta tocó, si tocó uno. Va aparte del texto a
    // propósito: el texto es lo que se lee en la conversación, esto es lo
    // que el bot puede reconocer sin ambigüedad.
    opcion: String(mensaje.quick_reply?.payload || "").trim(),
    // De qué anuncio viene, si viene de uno. El primer mensaje de quien
    // llega por publicidad lo trae dentro.
    anuncio,
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
