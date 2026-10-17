// WHATSAPP: EL MISMO BOT, OTRO CANAL (7-oct-2026)
//
// El dueño: "vamos a conectar todo esto también a WhatsApp", con el mismo
// número que usan hoy los asesores. Lo que se protege:
//   · lo que manda Meta por WhatsApp se entiende igual que lo de Instagram
//     (texto, foto, nota de voz, botones, anuncios, el eco del asesor);
//   · lo que sale va por la API de WhatsApp y con su forma (fotos con su
//     nombre y precio, botones de enlace y de respuesta);
//   · el asesor escribe desde el celular y el bot se calla;
//   · un aviso repetido no se contesta dos veces.
import { leerWhatsApp, perfilDeWhatsApp, enviarConOpciones, enviarConBoton } from "./.stub/whatsapp.js";
import { queAtender } from "./.stub/index.js";
import { mandarDesdeElPanel } from "./.stub/panel.js";
import { turno, baseFalsa } from "./banco.mjs";

let fallos = 0;
const comprobar = (n, real, esperado = true) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};

const NUMERO = "584121234567";
const CLIENTE = `wa:${NUMERO}`;
const ENV_WA = { WA_PHONE_ID: "999", WA_TOKEN: "t", REVISOR_IA: "no" };
const aviso = (value, field = "messages") => ({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA", changes: [{ field, value: { messaging_product: "whatsapp", metadata: { phone_number_id: "999" }, ...value } }] }],
});
const contactos = [{ profile: { name: "Perla Gómez" }, wa_id: NUMERO }];

// ── Lo que llega ───────────────────────────────────────────────────
{
  const [t] = leerWhatsApp(ENV_WA, aviso({ contacts: contactos, messages: [{ from: NUMERO, id: "wamid.1", type: "text", text: { body: "tienes poco?" } }] }));
  comprobar("un texto: el cliente es wa:+número y el texto llega", [t.tipo, t.igsid, t.mid, t.texto, t.canal], ["texto", CLIENTE, "wamid.1", "tienes poco?", "whatsapp"]);
  comprobar("el nombre sale del propio aviso", perfilDeWhatsApp(CLIENTE), { nombre_completo: "Perla Gómez", usuario: `+${NUMERO}` });

  const [f] = leerWhatsApp(ENV_WA, aviso({ messages: [{ from: NUMERO, id: "wamid.2", type: "image", image: { id: "M1", caption: "cuánto este?" } }] }));
  comprobar("una foto: con su pie como texto y el id para bajarla", [f.tipo, f.foto, f.texto], ["imagen", "wamedia:M1", "cuánto este?"]);

  const [a] = leerWhatsApp(ENV_WA, aviso({ messages: [{ from: NUMERO, id: "wamid.3", type: "audio", audio: { id: "A1", voice: true } }] }));
  comprobar("una nota de voz", [a.tipo, a.audio], ["audio", "wamedia:A1"]);

  const [b] = leerWhatsApp(ENV_WA, aviso({ messages: [{ from: NUMERO, id: "wamid.4", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "VER_SI", title: "¡Sí, claro!" } } }] }));
  comprobar("un botón tocado: su id va en 'opcion'", [b.opcion, b.texto], ["VER_SI", "¡Sí, claro!"]);

  const [ad] = leerWhatsApp(ENV_WA, aviso({ messages: [{ from: NUMERO, id: "wamid.5", type: "text", text: { body: "Hola, quiero info" }, referral: { source_type: "ad", source_id: "120", headline: "Poco X8 pro 5G 🔥" } }] }));
  comprobar("viene de un anuncio 'Clic a WhatsApp'", [ad.anuncio?.fuente, ad.anuncio?.id, ad.anuncio?.titulo], ["ADS", "120", "Poco X8 pro 5G 🔥"]);

  const [eco] = leerWhatsApp(ENV_WA, aviso({ message_echoes: [{ from: "5842200000", to: NUMERO, id: "wamid.E", type: "text", text: { body: "Hola, soy Carlos" } }] }, "smb_message_echoes"));
  comprobar("el asesor escribió desde la app del celular: es un eco", [eco.tipo, eco.igsid, eco.texto], ["eco", CLIENTE, "Hola, soy Carlos"]);

  comprobar("'entregado' y 'leído' no se atienden", leerWhatsApp(ENV_WA, aviso({ statuses: [{ id: "wamid.1", status: "read" }] })).length, 0);
  comprobar("un sticker o una reacción no se atienden", leerWhatsApp(ENV_WA, aviso({ messages: [{ from: NUMERO, id: "x", type: "sticker" }, { from: NUMERO, id: "y", type: "reaction" }] })).length, 0);
  comprobar("otro número de la misma cuenta no es de esta tienda", leerWhatsApp({ ...ENV_WA, WA_PHONE_ID: "111" }, aviso({ messages: [{ from: NUMERO, id: "z", type: "text", text: { body: "hola" } }] })).length, 0);

  const crudo = JSON.stringify(aviso({ messages: [{ from: NUMERO, id: "wamid.9", type: "text", text: { body: "hola" } }] }));
  comprobar("sin WA_PHONE_ID en wrangler.toml, WhatsApp no se atiende", queAtender({}, crudo).length, 0);
  comprobar("con WA_PHONE_ID, sí", queAtender(ENV_WA, crudo).length, 1);
}

// ── Lo que sale ────────────────────────────────────────────────────
{
  const salio = [];
  globalThis.fetch = async (url, op) => {
    salio.push({ url: String(url), cuerpo: JSON.parse(op.body) });
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.S" }] }) };
  };
  await enviarConOpciones(ENV_WA, CLIENTE, "¿Quieres ver las imágenes?", [{ titulo: "¡Sí, claro!", payload: "SI" }, { titulo: "No, gracias", payload: "NO" }]);
  const b = salio.at(-1);
  comprobar("va a la API de WhatsApp de ESE número, al cliente sin el 'wa:'", [b.url.endsWith("/999/messages"), b.cuerpo.to], [true, NUMERO]);
  comprobar("2 opciones: botones de respuesta", [b.cuerpo.interactive.type, b.cuerpo.interactive.action.buttons.map((x) => x.reply.id)], ["button", ["SI", "NO"]]);
  await enviarConOpciones(ENV_WA, CLIENTE, "¿Cuál?", ["A", "B", "C", "D", "E"].map((t) => ({ titulo: t })));
  comprobar("más de 3: una lista", salio.at(-1).cuerpo.interactive.type, "list");
  await enviarConBoton(ENV_WA, CLIENTE, "Aquí está la ficha técnica", { titulo: "Ver ficha técnica", url: "https://www.mi.com/x" });
  comprobar("un enlace: botón cta_url", [salio.at(-1).cuerpo.interactive.type, salio.at(-1).cuerpo.interactive.action.parameters.url], ["cta_url", "https://www.mi.com/x"]);
}

// ── El turno completo, por WhatsApp ────────────────────────────────
{
  const r = await turno({
    texto: "tienes poco?",
    mensaje: { igsid: CLIENTE, mid: "wamid.T1", canal: "whatsapp" },
    fila: { id: CLIENTE, historial: "Ya di la bienvenida." },
    env: ENV_WA,
    respuestaDelModelo: { buscar: "Poco", respuesta: "¡Claro! Mira los Poco que tengo 👇" },
    conRed: true,
  });
  const wa = r.enviados.filter((m) => m.WA);
  const fotos = wa.filter((m) => m.WA.type === "image");
  comprobar("todo sale por WhatsApp, nada por Instagram", r.enviados.every((m) => m.WA || m.WA_LEIDO), true);
  comprobar("le marca 'visto' con el 'escribiendo…'", r.enviados.some((m) => m.WA_LEIDO === "wamid.T1"));
  comprobar("el texto y, debajo, cada Poco como foto", wa[0]?.WA.type === "text" && fotos.length >= 2 && fotos.every((m) => /Poco/.test(m.WA.image.caption)), true);
  comprobar("cada foto lleva su nombre en negrita y su precio", /^\*Poco .+\*\n/.test(fotos[0]?.WA.image.caption || ""), true);
  const mids = JSON.parse(r.fila?.mids_enviados || "[]");
  const idsDeFotos = r.enviados.map((m, i) => (m.WA?.type === "image" ? `wamid.${i + 1}` : "")).filter(Boolean);
  comprobar("guarda los ids de TODAS las fotos (para reconocer su eco)", idsDeFotos.length > 1 && idsDeFotos.every((id) => mids.includes(id)), true);
  const alModelo = JSON.stringify(r.alModelo[0]?.messages || []);
  comprobar("la IA sabe que es WhatsApp (no le dice 'escríbenos por WhatsApp')", /CANAL: WhatsApp/.test(alModelo));
  comprobar("y se guarda con su nombre de WhatsApp", r.fila?.nombre_completo, "Perla Gómez");

  // El mismo aviso otra vez (Meta a veces repite): no se contesta dos veces.
  const db = baseFalsa({ id: CLIENTE, historial: "Ya di la bienvenida." });
  const una = await turno({ texto: "hola", mensaje: { igsid: CLIENTE, mid: "wamid.R", canal: "whatsapp" }, env: ENV_WA, db, conRed: true });
  const otra = await turno({ texto: "hola", mensaje: { igsid: CLIENTE, mid: "wamid.R", canal: "whatsapp" }, env: ENV_WA, db, conRed: true });
  comprobar("un aviso repetido no se contesta dos veces", [una.enviados.some((m) => m.WA), otra.enviados.some((m) => m.WA)], [true, false]);
}

// ── La foto del cliente, que no trae enlace público ────────────────
{
  const r = await turno({
    texto: "",
    mensaje: { igsid: CLIENTE, mid: "wamid.F", canal: "whatsapp", tipo: "imagen", foto: "wamedia:FOTO1" },
    fila: { id: CLIENTE, historial: "Ya di la bienvenida." },
    env: ENV_WA,
    apis: {
      "graph.facebook.com/v23.0/FOTO1": { url: "https://lookaside.fbsbx.com/foto1", mime_type: "image/jpeg" },
    },
    conRed: true,
  });
  const vision = JSON.stringify(r.alModelo.find((p) => JSON.stringify(p).includes("image_url")) || {});
  comprobar("la foto se baja con el token y la IA la ve (sin enlace público)", /data:image\/jpeg;base64,/.test(vision), true);
}

// ── La nota de voz ─────────────────────────────────────────────────
{
  const r = await turno({
    mensaje: { igsid: CLIENTE, mid: "wamid.V", canal: "whatsapp", tipo: "audio", audio: "wamedia:VOZ1" },
    fila: { id: CLIENTE, historial: "Ya di la bienvenida." },
    env: ENV_WA,
    apis: { "graph.facebook.com/v23.0/VOZ1": { url: "https://lookaside.fbsbx.com/nota1", mime_type: "audio/ogg" } },
    transcripcion: "tienes el samsung a57?",
    respuestaDelModelo: { buscar: "Samsung A57", respuesta: "¡Sí! Aquí lo tienes 👇" },
    conRed: true,
  });
  comprobar("la nota de voz se baja, se transcribe y le llega a la IA", /tienes el samsung a57/.test(JSON.stringify(r.alModelo[0]?.messages || [])));
  comprobar("y le contesta por WhatsApp", r.enviados.some((m) => m.WA), true);
}

// ── El asesor escribe desde el celular: el bot se calla ───────────
{
  const r = await turno({
    mensaje: { tipo: "eco", igsid: CLIENTE, mid: "wamid.ASESOR", texto: "Hola Perla, soy Carlos de EPICCELL", canal: "whatsapp" },
    fila: { id: CLIENTE, historial: "Ya di la bienvenida.", mids_enviados: JSON.stringify(["wamid.1"]) },
    env: ENV_WA,
  });
  comprobar("un eco que no es del bot: pausa", Number(r.fila?.pausado_hasta || 0) > Date.now(), true);
}

// ── El dueño escribe desde el panel a un cliente de WhatsApp ───────
{
  const salio = [];
  globalThis.fetch = async (url, op) => {
    salio.push({ url: String(url), cuerpo: JSON.parse(op?.body || "{}") });
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.P" }] }) };
  };
  const DB = baseFalsa({ id: CLIENTE });
  const r = await mandarDesdeElPanel({ ...ENV_WA, DB }, CLIENTE, "Hola, ya te atiendo");
  comprobar("sale por WhatsApp, no por Instagram", [r.ok, salio[0]?.url.includes("graph.facebook.com/v23.0/999/messages"), salio[0]?.cuerpo.text?.body], [true, true, "Hola, ya te atiendo"]);
  comprobar("y el bot se aparta (pausa)", Number(DB.filas.get(CLIENTE)?.pausado_hasta || 0) > Date.now(), true);
}

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
