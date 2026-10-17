// WHATSAPP EN EL EMPERADOR (12-oct-2026): el mismo bot, otro canal.
// Lo que se protege:
//   · lo que manda Meta por WhatsApp se entiende como un mensaje normal
//     (texto, foto, nota de voz, eco del asesor) con el cliente "wa:<número>";
//   · instagram.js desvía cada envío a WhatsApp si el id empieza por "wa:", y
//     un cliente de Instagram sigue yendo por Instagram;
//   · un aviso repetido se atiende una sola vez;
//   · index.js tiene todo conectado (firma, lectura, "visto", nota a la IA).

import { prepararSrc, fuente, ok as okReal, titulo as tituloReal, terminar, baseDeMentira } from "./ayuda.mjs";

const src = await prepararSrc();
const wa = await src.cargar("whatsapp.js");
const ig = await src.cargar("instagram.js");
const estado = await src.cargar("estado.js");

const NUMERO = "584121234567";
const CLIENTE = `wa:${NUMERO}`;
const ENV = { WA_PHONE_ID: "999", WA_TOKEN: "t", IG_TOKEN: "ig", URL_CATALOGO: "https://tienda.test" };
const aviso = (value, field = "messages") => ({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA", changes: [{ field, value: { messaging_product: "whatsapp", metadata: { phone_number_id: "999" }, ...value } }] }],
});
const contactos = [{ profile: { name: "Perla Gómez" }, wa_id: NUMERO }];

// El bot habla mucho por consola; aquí se calla, pero lo que cuenta la prueba
// (ok y titulo) se sigue viendo.
const log = console.log;
const err = console.error;
console.log = () => {};
console.error = () => {};
const ok = (...a) => { console.log = log; okReal(...a); console.log = () => {}; };
const titulo = (...a) => { console.log = log; tituloReal(...a); console.log = () => {}; };

titulo("lo que llega");
const texto = wa.leerWhatsApp(ENV, aviso({ contacts: contactos, messages: [{ from: NUMERO, id: "wamid.1", type: "text", text: { body: "hola, tienes bolsos?" } }] }));
ok(texto.length === 1 && texto[0].igsid === CLIENTE && texto[0].tipo === "texto" && texto[0].canal === "whatsapp", "un texto: cliente wa:<número>, canal whatsapp", JSON.stringify(texto[0] || {}).slice(0, 120));
ok(texto[0]?.texto === "hola, tienes bolsos?" && texto[0]?.mid === "wamid.1", "con su texto y su id");
const foto = wa.leerWhatsApp(ENV, aviso({ contacts: contactos, messages: [{ from: NUMERO, id: "wamid.2", type: "image", image: { id: "M1" } }] }));
ok(foto[0]?.tipo === "imagen" && /^wamedia:M1/.test(foto[0]?.foto || ""), "una foto: se baja luego con el token (wamedia:)");
const voz = wa.leerWhatsApp(ENV, aviso({ contacts: contactos, messages: [{ from: NUMERO, id: "wamid.3", type: "audio", audio: { id: "A1" } }] }));
ok(voz[0]?.tipo === "audio", "una nota de voz llega como audio");
const eco = wa.leerWhatsApp(ENV, aviso({ message_echoes: [{ to: NUMERO, id: "wamid.9", type: "text", text: { body: "ya te atiendo" } }] }, "smb_message_echoes"));
ok(eco[0]?.tipo === "eco" && eco[0]?.igsid === CLIENTE, "lo que escribe el asesor desde el celular llega como eco");
ok(wa.leerWhatsApp(ENV, aviso({ statuses: [{ id: "x", status: "read" }] })).length === 0, "un 'leído' no es un mensaje");
ok(wa.leerWhatsApp({ ...ENV, WA_PHONE_ID: "111" }, aviso({ messages: [{ from: NUMERO, id: "w", type: "text", text: { body: "x" } }] })).length === 0, "el aviso de otro número no se atiende");

titulo("lo que sale: cada envío va por su canal");
const llamadas = [];
const fetchReal = globalThis.fetch;
globalThis.fetch = async (url, op) => {
  llamadas.push({ url: String(url), cuerpo: JSON.parse(op?.body || "{}") });
  return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.sale" }], message_id: "mid.ig" }), text: async () => "" };
};
await ig.enviarTexto(ENV, CLIENTE, "Hola 😊");
ok(/graph\.facebook\.com\/.+\/999\/messages/.test(llamadas[0]?.url || "") && llamadas[0]?.cuerpo.messaging_product === "whatsapp" && llamadas[0]?.cuerpo.to === NUMERO, "texto a un cliente de WhatsApp → API de WhatsApp", llamadas[0]?.url);
llamadas.length = 0;
await ig.enviarTexto(ENV, "1234567890", "Hola 😊");
ok(/\/me\/messages/.test(llamadas[0]?.url || "") && !llamadas[0]?.cuerpo.messaging_product, "texto a un cliente de Instagram → sigue por Instagram", llamadas[0]?.url);
llamadas.length = 0;
const mids = await ig.enviarFichas(ENV, CLIENTE, [{ titulo: "Bolso Gucci negro", precio: "85 USD", imagen: "https://cdn.test/a.jpg" }, { titulo: "Gorra NY", precio: "20 USD", imagen: "https://cdn.test/b.jpg" }]);
ok(llamadas.length === 2 && llamadas.every((l) => l.cuerpo.type === "image") && /\*Bolso Gucci negro\*/.test(llamadas[0].cuerpo.image.caption) && /85 USD/.test(llamadas[0].cuerpo.image.caption), "las fichas: una foto por producto, nombre en negrita y precio");
ok(String(mids).split(",").length === 2, "los ids de todas las fotos vuelven juntos (para reconocer el eco)", String(mids));
llamadas.length = 0;
await ig.enviarBotonCatalogo(ENV, CLIENTE, "Mira el catálogo");
ok(llamadas[0]?.cuerpo.interactive?.type === "cta_url" && llamadas[0]?.cuerpo.interactive.action.parameters.url === "https://tienda.test", "el botón del catálogo: botón de enlace de WhatsApp");
llamadas.length = 0;
await ig.enviarBotonEnlace(ENV, CLIENTE, "Estamos aquí", "Cómo llegar", "https://maps.test/x");
ok(llamadas[0]?.cuerpo.interactive?.type === "cta_url", "la ubicación con su botón de Maps");
llamadas.length = 0;
const perfil = await ig.obtenerPerfil(ENV, CLIENTE);
ok(llamadas.length === 0 && perfil.usuario === `+${NUMERO}`, "el perfil de WhatsApp sale del aviso, sin llamar a nadie", JSON.stringify(perfil));
globalThis.fetch = fetchReal;

titulo("un aviso repetido se atiende una vez");
const { DB } = baseDeMentira();
ok((await estado.comentarioNuevo(DB, "wa:wamid.1")) === true, "la primera vez, se atiende");
ok((await estado.comentarioNuevo(DB, "wa:wamid.1")) === false, "la segunda (Meta reintenta), no");

console.log = log;
console.error = err;

titulo("está conectado en index.js");
const idx = fuente("index.js");
ok(/esAvisoDeWhatsApp\(cuerpo\)/.test(idx) && /leerWhatsApp\(env, cuerpo\)/.test(idx), "el webhook lee los avisos de WhatsApp");
ok(/\["WA_APP_SECRET", env\.WA_APP_SECRET\]/.test(idx), "la firma acepta la clave de la app de WhatsApp");
ok(/marcarLeido\(env, mensaje\.mid\)/.test(idx) && /fotoComoDataUri/.test(idx) && /comentarioNuevo\(env\.DB, `wa:/.test(idx), "marca 'visto', baja la foto y no contesta dos veces");
ok(/mensaje\.canal === "whatsapp" \? NOTA_WHATSAPP/.test(idx), "la IA sabe que el cliente está en WhatsApp");
ok(/split\(","\)/.test(idx), "guarda todos los ids de las fichas de WhatsApp");
ok(/tipo === "audio"/.test(idx), "una nota de voz recibe respuesta por escrito (no se escucha)");

terminar();
