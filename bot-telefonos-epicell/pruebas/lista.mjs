import { pideLista, marcasDelCatalogo, marcaEnTexto, mensajesDeLista } from "./.stub/lista.js";
import { enviarFichas, enviarConOpciones, enviarBotonCatalogo, hayCatalogo, leerMensaje } from "./.stub/instagram.js";

let fallos = 0;
const comprobar = (n, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};

// ── Quién pide una lista ───────────────────────────────────────
comprobar("«mándame la lista de samsung»", pideLista("mandame la lista de samsung"), true);
comprobar("«tienes listado de iphone?»", pideLista("tienes listado de iphone?"), true);
comprobar("«qué modelos de poco tienen?»", pideLista("que modelos de poco tienen?"), true);
comprobar("«todos los equipos que tengan»", pideLista("todos los equipos que tengan"), true);
comprobar("una búsqueda normal NO es una lista", pideLista("tienes el iphone 15?"), false);
comprobar("«precio del samsung a57» tampoco", pideLista("precio del samsung a57"), false);
comprobar("vacío tampoco", pideLista(""), false);

// ── Las marcas salen de la hoja ────────────────────────────────
const catalogo = [
  { titulo: "Samsung A57", capacidad: "12GB/512GB", precio: "$310", precioCashea: "$95" },
  { titulo: "Samsung A17", capacidad: "8GB/256GB", precio: "$180", precioCashea: "$60" },
  { titulo: "Poco M8 pro 5G", capacidad: "8GB/256GB", precio: "$185", precioCashea: "$62" },
  { titulo: "iPhone 15 128GB", capacidad: "128GB", precio: "$690", precioCashea: "$210" },
];
const marcas = marcasDelCatalogo(catalogo);
comprobar("las marcas, la que más tiene primero", marcas.map((m) => m.nombre), ["Samsung", "Poco", "iPhone"]);
comprobar("cuenta cuántos hay de cada una", marcas[0].cuantos, 2);
comprobar("reconoce la marca en el mensaje", marcaEnTexto("la lista de samsung porfa", marcas), "Samsung");
comprobar("y respeta cómo se escribe en la hoja", marcaEnTexto("lista de IPHONE", marcas), "iPhone");
comprobar("si no nombra ninguna, vacío", marcaEnTexto("mandame la lista", marcas), "");

// ── La lista escrita ───────────────────────────────────────────
const { mensajes, puestas, faltan } = mensajesDeLista(catalogo.filter((p) => p.titulo.startsWith("Samsung")), {
  cabecera: "Estos son los Samsung que tenemos 👇",
  precioDe: (p) => p.precioCashea,
});
comprobar("cabe en un solo mensaje", mensajes.length, 1);
comprobar("entraron los dos", puestas, 2);
comprobar("no falta ninguno", faltan, 0);
comprobar("una línea por equipo, con su emoji", mensajes[0].split("\n").filter((l) => l.startsWith("🔹")).length, 2);
comprobar("con su precio", mensajes[0].includes("Samsung A57 — $95"), true);
comprobar("y cabe en un mensaje de Instagram", [...mensajes[0]].length <= 1000, true);

// Una marca con muchos equipos: se parte y dice cuántos quedan fuera
const muchos = Array.from({ length: 60 }, (_, i) => ({ titulo: `Samsung Galaxy modelo numero ${i + 1}`, precio: "$100" }));
const larga = mensajesDeLista(muchos, { cabecera: "Estos son 👇", precioDe: (p) => p.precio });
comprobar("nunca más de dos mensajes", larga.mensajes.length <= 2, true);
comprobar("ninguno pasa del límite", larga.mensajes.every((m) => [...m].length <= 1000), true);
comprobar("y dice cuántos quedaron fuera", larga.faltan > 0, true);
comprobar("la cuenta cuadra", larga.puestas + larga.faltan, 60);

// ── Los botones ────────────────────────────────────────────────
let enviado = null;
globalThis.fetch = async (url, opciones) => {
  enviado = JSON.parse(opciones.body);
  return { ok: true, json: async () => ({ message_id: "m1" }) };
};

await enviarConOpciones({ IG_TOKEN: "x" }, "1", "¿Quieres ver las imágenes de esta lista? 📸", [
  { titulo: "¡Sí, claro!", payload: "LISTA_VER_IMAGENES_SI" },
  { titulo: "No, gracias", payload: "LISTA_VER_IMAGENES_NO" },
]);
comprobar("el mensaje lleva sus dos botones", enviado.message.quick_replies.map((q) => q.title), ["¡Sí, claro!", "No, gracias"]);
comprobar("con su payload", enviado.message.quick_replies[0].payload, "LISTA_VER_IMAGENES_SI");
comprobar("ningún título pasa de 20 caracteres", enviado.message.quick_replies.every((q) => q.title.length <= 20), true);

// El botón "Ver producto" ya no sale
await enviarFichas({ IG_TOKEN: "x", WHATSAPP: "584121234567" }, "1", [{ titulo: "Samsung A57", precio: "$95", imagen: "https://x/1.jpg", url: "https://tienda/x" }]);
const ficha = enviado.message.attachment.payload.elements[0];
comprobar("la ficha ya no lleva «Ver producto»", (ficha.buttons || []).some((b) => b.title === "Ver producto"), false);
comprobar("pero sigue el de comprar por WhatsApp", ficha.buttons[0].title, "Comprar");

// Sin WhatsApp puesto, la ficha sale sin botones (y no rompe)
await enviarFichas({ IG_TOKEN: "x", WHATSAPP: "PON_AQUI_TU_NUMERO" }, "1", [{ titulo: "Samsung A57", precio: "$95", imagen: "https://x/1.jpg", url: "https://tienda/x" }]);
comprobar("sin WhatsApp, ficha sin botones", enviado.message.attachment.payload.elements[0].buttons, undefined);

// El botón del catálogo solo si hay catálogo de verdad
comprobar("el marcador de relleno no es un catálogo", hayCatalogo({ URL_CATALOGO: "https://CAMBIA-ESTO.com" }), false);
comprobar("vacío tampoco", hayCatalogo({}), false);
comprobar("una dirección de verdad sí", hayCatalogo({ URL_CATALOGO: "https://epiccell.com" }), true);

await enviarBotonCatalogo({ IG_TOKEN: "x", URL_CATALOGO: "https://CAMBIA-ESTO.com" }, "1", "Mira el catálogo");
comprobar("sin catálogo, va como texto suelto", enviado.message.text, "Mira el catálogo");
comprobar("y sin botón a ninguna parte", enviado.message.attachment, undefined);

// ── El botón que toca el cliente llega identificado ────────────
const m = leerMensaje({ entry: [{ messaging: [{ sender: { id: "1" }, message: { mid: "x", text: "¡Sí, claro!", quick_reply: { payload: "LISTA_VER_IMAGENES_SI" } } }] }] });
comprobar("se sabe qué botón tocó", m.opcion, "LISTA_VER_IMAGENES_SI");
comprobar("y el texto sigue siendo el del botón", m.texto, "¡Sí, claro!");

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
