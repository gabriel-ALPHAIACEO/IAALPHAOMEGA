// WHATSAPP: EL MISMO BOT, OTRO CANAL (7-oct-2026).
//
// El dueño: "vamos a conectar todo esto también a WhatsApp", con el MISMO
// número que usan hoy los asesores (la "coexistencia" de Meta: la app de
// WhatsApp Business del celular y la API comparten número; los asesores
// siguen contestando desde el celular).
//
// CÓMO ENCAJA SIN DUPLICAR NADA. Todo el bot —la memoria, Cashea, las
// fichas, el revisor, el panel— trabaja con un "igsid" por cliente. Un
// cliente de WhatsApp es "wa:" + su número ("wa:584121234567"):
//
//   · AQUÍ se lee lo que manda Meta por WhatsApp y se convierte en el MISMO
//     mensaje que sale de leerMensaje() para Instagram.
//   · instagram.js, al enviar, mira el id: si empieza por "wa:", lo manda
//     por aquí. index.js no se entera de por dónde habla.
//
// LO QUE CAMBIA RESPECTO A INSTAGRAM.
//   · No hay carrusel: cada equipo va como una foto con su nombre y precio
//     debajo (hasta 10, como el carrusel).
//   · Los botones de un enlace (Maps, ficha técnica, catálogo) son botones
//     "cta_url"; las opciones ("¡Sí, claro!" / "No, gracias") son botones
//     de respuesta (hasta 3) o una lista (hasta 10).
//   · Las fotos y las notas de voz no vienen con un enlace público: vienen
//     con un id y se bajan con el token (ver bajarMedio).
//   · Cuando escribe el asesor desde la app del celular, Meta lo avisa como
//     "smb_message_echoes": es el mismo eco de Instagram, y el bot se calla
//     igual (la pausa automática no cambia).
//
// LO QUE HACE FALTA (ver WHATSAPP.md):
//   · WA_PHONE_ID   en wrangler.toml: el id del número (no es secreto)
//   · WA_TOKEN      secreto: el token permanente del usuario del sistema
//   · WA_APP_SECRET secreto, solo si la app de WhatsApp NO es la misma app
//                   de Meta que la de Instagram (firma los webhooks)
//   · El webhook de la app suscrito a "messages" y "smb_message_echoes".

const VERSION_API = "v23.0";
const GRAFO = `https://graph.facebook.com/${VERSION_API}`;
const ESPERA_ENVIO_MS = 8000;
// Las fotos de los equipos van una por una: si se pasa de esto, las que
// faltan van escritas (el turno entero tiene 30 s, ver index.js).
const PRESUPUESTO_FICHAS_MS = 14000;

export const PREFIJO = "wa:";

export function esDeWhatsApp(id) {
  return String(id || "").startsWith(PREFIJO);
}

export function numeroDe(id) {
  return String(id || "").slice(PREFIJO.length);
}

export function whatsappConectado(env) {
  return Boolean(env?.WA_PHONE_ID && env?.WA_TOKEN);
}

// El nombre que trae el propio aviso de Meta ("contacts[].profile.name").
// WhatsApp no tiene una API de perfil como Instagram: o viene aquí, o no
// viene. Se guarda mientras dura el turno y obtenerPerfil lo recoge.
const nombres = new Map();

export function perfilDeWhatsApp(id) {
  return { nombre_completo: nombres.get(id) || "", usuario: `+${numeroDe(id)}` };
}

/* ── Lo que llega ──────────────────────────────────────────────── */

export function esAvisoDeWhatsApp(cuerpo) {
  return cuerpo?.object === "whatsapp_business_account";
}

// Devuelve una LISTA de mensajes (Meta puede juntar varios en un aviso),
// con la misma forma que leerMensaje() de instagram.js.
export function leerWhatsApp(env, cuerpo) {
  const lista = [];
  for (const entrada of cuerpo?.entry || []) {
    for (const cambio of entrada?.changes || []) {
      const valor = cambio?.value || {};
      const numeroId = String(valor?.metadata?.phone_number_id || "");

      // Otro número de la misma cuenta de Meta: no es el de esta tienda.
      if (env?.WA_PHONE_ID && numeroId && numeroId !== String(env.WA_PHONE_ID)) {
        console.log(`WhatsApp → ignoro un aviso del número ${numeroId} (esta tienda es ${env.WA_PHONE_ID})`);
        continue;
      }

      for (const c of valor.contacts || []) {
        const nombre = String(c?.profile?.name || "").trim();
        if (c?.wa_id && nombre) nombres.set(PREFIJO + c.wa_id, nombre);
      }

      if (cambio.field === "smb_message_echoes" || valor.message_echoes) {
        for (const e of valor.message_echoes || []) {
          if (!e?.to) continue;
          lista.push(base({ tipo: "eco", igsid: PREFIJO + e.to, mid: e.id, texto: textoDe(e) }));
        }
        continue;
      }

      if (valor.statuses && !valor.messages) {
        console.log("WhatsApp → ignoro un 'enviado/entregado/leído'");
        continue;
      }

      for (const m of valor.messages || []) {
        const uno = leerUno(m);
        if (uno) lista.push(uno);
      }
    }
  }
  return lista;
}

function base(campos) {
  return {
    tipo: "texto",
    igsid: "",
    mid: "",
    texto: "",
    foto: "",
    historia: { url: "", id: "" },
    publicacion: { url: "", titulo: "", enlace: "" },
    audio: "",
    opcion: "",
    anuncio: null,
    canal: "whatsapp",
    ...campos,
  };
}

function textoDe(m) {
  return String(
    m?.text?.body || m?.image?.caption || m?.video?.caption || m?.document?.caption || m?.button?.text || ""
  ).trim();
}

function leerUno(m) {
  const igsid = PREFIJO + String(m?.from || "");
  if (!m?.from) return null;
  const anuncio = leerAnuncio(m.referral);
  const comun = { igsid, mid: String(m.id || ""), anuncio };

  switch (m.type) {
    case "text":
      return base({ ...comun, texto: textoDe(m) });
    case "image":
      return base({ ...comun, tipo: "imagen", texto: textoDe(m), foto: m.image?.id ? `wamedia:${m.image.id}` : "" });
    case "audio":
      return base({ ...comun, tipo: "audio", audio: m.audio?.id ? `wamedia:${m.audio.id}` : "" });
    case "interactive": {
      const r = m.interactive?.button_reply || m.interactive?.list_reply || {};
      return base({ ...comun, texto: String(r.title || "").trim(), opcion: String(r.id || "").trim() });
    }
    case "button":
      return base({ ...comun, texto: String(m.button?.text || "").trim(), opcion: String(m.button?.payload || "").trim() });
    case "location": {
      const l = m.location || {};
      return base({ ...comun, texto: `(mandó su ubicación${l.name ? `: ${l.name}` : ""}${l.address ? `, ${l.address}` : ""})` });
    }
    case "video":
    case "document":
      return base({ ...comun, texto: textoDe(m) || `(mandó un ${m.type === "video" ? "video" : "archivo"} que no puedo abrir)` });
    case "reaction":
      console.log("WhatsApp → ignoro una reacción");
      return null;
    case "sticker":
      console.log("WhatsApp → ignoro un sticker");
      return null;
    default:
      console.log(`WhatsApp → ignoro un mensaje de tipo ${m.type || "desconocido"}`);
      return null;
  }
}

// Quien llega desde un anuncio "Clic a WhatsApp". Misma forma que el
// anuncio de Instagram (ver leerAnuncio en instagram.js).
function leerAnuncio(r) {
  if (!r) return null;
  const anuncio = {
    fuente: String(r.source_type || "").toLowerCase() === "ad" ? "ADS" : String(r.source_type || "").toUpperCase(),
    ref: String(r.ctwa_clid || "").trim(),
    id: String(r.source_id || "").trim(),
    titulo: String(r.headline || r.body || "").trim(),
    foto: /^https:\/\//i.test(String(r.image_url || r.thumbnail_url || "")) ? String(r.image_url || r.thumbnail_url) : "",
    video: /^https:\/\//i.test(String(r.video_url || "")) ? String(r.video_url) : "",
    publicacion: "",
  };
  return anuncio.fuente || anuncio.id || anuncio.titulo ? anuncio : null;
}

/* ── Las fotos y las notas de voz ──────────────────────────────── */

// "wamedia:123" → { datos (ArrayBuffer), tipo }. WhatsApp no da un enlace
// público: primero se pide el enlace con el id, y se baja con el token.
export async function bajarMedio(env, referencia) {
  const id = String(referencia || "").replace(/^wamedia:/, "");
  if (!id) throw new Error("sin id de WhatsApp");
  if (!env?.WA_TOKEN) throw new Error("falta WA_TOKEN");
  const auth = { authorization: `Bearer ${env.WA_TOKEN}` };
  const info = await fetch(`${GRAFO}/${id}`, { headers: auth, signal: AbortSignal.timeout(ESPERA_ENVIO_MS) });
  if (!info.ok) throw new Error(`WhatsApp no dio el enlace del archivo (${info.status})`);
  const { url, mime_type: tipo } = await info.json();
  if (!url) throw new Error("WhatsApp no dio el enlace del archivo");
  const r = await fetch(url, { headers: auth, signal: AbortSignal.timeout(ESPERA_ENVIO_MS) });
  if (!r.ok) throw new Error(`no pude bajar el archivo de WhatsApp (${r.status})`);
  const datos = await r.arrayBuffer();
  return { datos, tipo: String(tipo || r.headers.get("content-type") || "").split(";")[0].trim() };
}

// Una foto del cliente como "data:image/jpeg;base64,…": es lo que la IA de
// imágenes acepta sin un enlace público.
export async function fotoComoDataUri(env, referencia) {
  const { datos, tipo } = await bajarMedio(env, referencia);
  const bytes = new Uint8Array(datos);
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${tipo || "image/jpeg"};base64,${btoa(binario)}`;
}

/* ── Lo que sale ───────────────────────────────────────────────── */

function recortar(texto, limite) {
  const limpio = String(texto || "");
  return limpio.length > limite ? limpio.slice(0, limite - 1) + "…" : limpio;
}

// Devuelve { mid, ventanaCerrada, detalle }.
async function enviarDetallado(env, id, mensaje, esperaMs = ESPERA_ENVIO_MS) {
  if (!whatsappConectado(env)) {
    console.error("WhatsApp sin conectar (faltan WA_PHONE_ID o WA_TOKEN): no puedo contestar");
    return { mid: "", ventanaCerrada: false, detalle: "sin conectar" };
  }
  let r;
  try {
    r = await fetch(`${GRAFO}/${env.WA_PHONE_ID}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.WA_TOKEN}` },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: numeroDe(id), ...mensaje }),
      signal: AbortSignal.timeout(esperaMs),
    });
  } catch (error) {
    console.error(`WhatsApp no contestó a tiempo: ${error?.message || error}`);
    return { mid: "", ventanaCerrada: false, detalle: String(error?.message || error) };
  }
  if (!r.ok) {
    const detalle = await r.text().catch(() => "");
    // 131047: pasaron más de 24 h desde el último mensaje del cliente. Como
    // en Instagram, no es una avería: es la regla de Meta.
    if (/131047|re-engagement/i.test(detalle)) {
      console.log("WhatsApp no acepta este mensaje: la ventana de 24 h está cerrada (el cliente no ha escrito).");
      return { mid: "", ventanaCerrada: true, detalle };
    }
    console.error("WhatsApp rechazó el envío:", r.status, detalle.slice(0, 300));
    return { mid: "", ventanaCerrada: false, detalle };
  }
  const datos = await r.json().catch(() => ({}));
  console.log(`WhatsApp ← mandé: ${resumir(mensaje)}`);
  return { mid: datos?.messages?.[0]?.id || "sin-id", ventanaCerrada: false, detalle: "" };
}

async function enviar(env, id, mensaje) {
  return (await enviarDetallado(env, id, mensaje)).mid;
}

function resumir(m) {
  if (m.type === "text") return `"${recortar(m.text?.body, 90)}"`;
  if (m.type === "image") return `foto: ${recortar(m.image?.caption, 60)}`;
  if (m.type === "interactive") return `${m.interactive?.type}: "${recortar(m.interactive?.body?.text, 70)}"`;
  return m.type;
}

export function enviarTexto(env, id, texto) {
  return enviar(env, id, { type: "text", text: { body: recortar(texto, 4096), preview_url: false } });
}

// Un texto con un botón que abre un enlace (Maps, ficha técnica, catálogo).
export function enviarConBoton(env, id, texto, { titulo, url, foto } = {}) {
  if (!/^https?:\/\//i.test(String(url || ""))) return enviarTexto(env, id, texto);
  return enviar(env, id, {
    type: "interactive",
    interactive: {
      type: "cta_url",
      ...(/^https:\/\//i.test(String(foto || "")) ? { header: { type: "image", image: { link: foto } } } : {}),
      body: { text: recortar(texto, 1024) },
      action: { name: "cta_url", parameters: { display_text: recortar(titulo || "Abrir", 20), url } },
    },
  });
}

// Las opciones: hasta 3, botones; hasta 10, una lista.
export function enviarConOpciones(env, id, texto, opciones) {
  const lista = (opciones || []).filter((o) => o?.titulo).slice(0, 10);
  if (!lista.length) return enviarTexto(env, id, texto);
  const idDe = (o) => String(o.payload || o.titulo).slice(0, 200);
  if (lista.length <= 3) {
    return enviar(env, id, {
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: recortar(texto, 1024) },
        action: { buttons: lista.map((o) => ({ type: "reply", reply: { id: idDe(o), title: recortar(o.titulo, 20) } })) },
      },
    });
  }
  return enviar(env, id, {
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: recortar(texto, 1024) },
      action: { button: "Ver opciones", sections: [{ title: "Opciones", rows: lista.map((o) => ({ id: idDe(o), title: recortar(o.titulo, 24) })) }] },
    },
  });
}

// LAS FICHAS. WhatsApp no tiene carrusel: cada equipo va como una foto con
// su nombre en negrita y el precio debajo. Devuelve los ids de todas,
// separados por comas (index.js los guarda todos para reconocer su eco).
export async function enviarFichas(env, id, productos) {
  const lista = (productos || []).slice(0, 10);
  const inicio = Date.now();
  const mids = [];
  const sinSalir = [];
  for (const p of lista) {
    if (Date.now() - inicio > PRESUPUESTO_FICHAS_MS) {
      sinSalir.push(p);
      continue;
    }
    const pie = `*${recortar(p.titulo, 200)}*${p.precio ? `\n${p.precio}` : ""}`;
    let mid = "";
    if (/^https:\/\//i.test(String(p.imagen || ""))) {
      const r = await enviarDetallado(env, id, { type: "image", image: { link: p.imagen, caption: recortar(pie, 1024) } });
      if (r.ventanaCerrada) return mids.join(",");
      mid = r.mid;
      if (!mid) console.error(`LA FOTO DE "${p.titulo}" NO SALIÓ POR WHATSAPP: ${p.imagen} — va escrita`);
    }
    if (!mid) mid = await enviar(env, id, { type: "text", text: { body: pie } });
    if (mid) mids.push(mid);
  }
  if (sinSalir.length) {
    const escrita = sinSalir.map((p) => `🔹 ${p.titulo}${p.precio ? ` — ${p.precio}` : ""}`).join("\n");
    const mid = await enviarTexto(env, id, escrita);
    if (mid) mids.push(mid);
  }
  return mids.join(",");
}

// La ubicación del local: la foto, el texto y el botón de Maps.
export function enviarLocal(env, id, { texto, foto, mapa, boton }) {
  return enviarConBoton(env, id, texto, { titulo: boton || "Cómo llegar", url: mapa, foto });
}

// "Visto" y "escribiendo…" en cuanto llega el mensaje: el cliente sabe que
// alguien lo está leyendo mientras la IA piensa (dura hasta 25 s o hasta
// que sale la respuesta).
export async function marcarLeido(env, mid) {
  if (!whatsappConectado(env) || !mid) return;
  try {
    await fetch(`${GRAFO}/${env.WA_PHONE_ID}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.WA_TOKEN}` },
      body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: mid, typing_indicator: { type: "text" } }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    // Si no sale el "escribiendo…", da igual: la respuesta sale igual.
  }
}

// Desde el panel (ver mandarDesdeElPanel en panel.js): { ok, mid, error }.
export async function textoDesdeElPanel(env, id, texto) {
  if (!whatsappConectado(env)) return { ok: false, error: "La tienda no tiene WhatsApp conectado (WA_PHONE_ID y WA_TOKEN)." };
  const r = await enviarDetallado(env, id, { type: "text", text: { body: recortar(texto, 4096) } }, 10000);
  if (r.mid) return { ok: true, mid: r.mid };
  return {
    ok: false,
    error: r.ventanaCerrada
      ? "Pasaron más de 24 horas desde el último mensaje del cliente: WhatsApp no deja escribirle hasta que él vuelva a escribir."
      : `WhatsApp no lo dejó pasar${r.detalle ? `: ${recortar(r.detalle, 160)}` : ""}.`,
  };
}
