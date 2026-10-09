// LA UBICACIÓN DE EPICCELL (5-oct-2026): su texto, con "Cómo llegar" y
// "Ver el local", sin pasar por la IA cuando solo preguntan eso.
import { turno } from "./banco.mjs";
import { preguntaPorElLocal, soloPreguntaPorElLocal, elLocal, fotoDelLocal } from "../src/local.js";

let fallos = 0;
const comprobar = (n, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};
const ENV = {
  LOCAL_TEXTO: "📍 ¡Te esperamos en EPICCELL!\n\n🏝️ Isla de Margarita, entre Circunvalación y Terranova\n🏬 Centro Comercial Mercado La Isla · Local L-04",
  LOCAL_MAPA: "https://maps.app.goo.gl/fUxvG6M97TDQy7R66",
  LOCAL_TITULO: "📍 Centro Comercial Mercado La Isla · Local L-04",
  LOCAL_SUBTITULO: "Isla de Margarita, entre Circunvalación y Terranova",
  LOCAL_FOTO: "PENDIENTE: el enlace de Drive de la foto del local",
};
const FOTO_DRIVE = "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view?usp=sharing";
const tarjeta = (e) => e.flatMap((m) => (m.attachment?.payload?.template_type === "generic" ? m.attachment.payload.elements : []));
const conBotones = (e) => e.find((m) => m.attachment?.payload?.template_type === "button");
const fichas = (e) => e.flatMap((m) => m.attachment?.payload?.elements || []);

// ── las preguntas ──
for (const t of ["donde estan ubicados?", "Dónde queda la tienda?", "pasame la ubicacion", "cual es la direccion", "como llego?", "tienen tienda fisica?", "en que parte estan?"]) {
  comprobar(`"${t}" pregunta por el local`, preguntaPorElLocal(t), true);
}
for (const t of ["tienes el samsung a57?", "precio en divisas?", "cuanto con cashea", "gracias!"]) {
  comprobar(`"${t}" NO pregunta por el local`, preguntaPorElLocal(t), false);
}
comprobar("'hola, donde estan?' es solo eso", soloPreguntaPorElLocal("hola, donde estan?"), true);
comprobar("'donde estan y tienen el a57?' trae algo más", soloPreguntaPorElLocal("donde estan y tienen el a57?"), false);
comprobar("sin LOCAL_TEXTO no hay ubicación", elLocal({}).texto, "");

// ── la foto: tiene que ser la imagen ──
comprobar("un enlace de Google Maps NO sirve de foto", fotoDelLocal("https://maps.app.goo.gl/ssoarYbPfdNy3BUM8").foto, "");
comprobar("uno de Drive se arregla solo", fotoDelLocal(FOTO_DRIVE).foto, "https://drive.google.com/uc?export=view&id=1AbCdEfGhIjKlMnOpQrStUvWxYz012345");

// ── sin foto todavía: el texto completo con el botón de Maps, sin la IA ──
let r = await turno({ texto: "hola, donde estan ubicados?", fila: { historial: "Ya di la bienvenida." }, env: ENV });
const msg = conBotones(r.enviados);
comprobar("sin foto: manda el texto del local tal cual", msg?.attachment?.payload?.text, ENV.LOCAL_TEXTO);
comprobar("con UN botón: Cómo llegar, a Maps", msg?.attachment?.payload?.buttons?.map((b) => [b.title, b.url]), [["🗺️ Cómo llegar", ENV.LOCAL_MAPA]]);
comprobar("y no gasta ni una llamada a la IA", r.alModelo.length, 0);

// ── con foto: la tarjeta como en ManyChat (foto, texto y botón) ──
r = await turno({ texto: "donde queda la tienda?", fila: { historial: "Ya di la bienvenida." }, env: { ...ENV, LOCAL_FOTO: FOTO_DRIVE } });
const t = tarjeta(r.enviados)[0];
comprobar("con foto: la tarjeta lleva la foto", t?.image_url, "https://drive.google.com/uc?export=view&id=1AbCdEfGhIjKlMnOpQrStUvWxYz012345");
comprobar("el texto (título y debajo)", [t?.title, t?.subtitle], [ENV.LOCAL_TITULO, ENV.LOCAL_SUBTITULO]);
comprobar("y UN botón de Maps", t?.buttons?.map((b) => [b.title, b.url]), [["🗺️ Cómo llegar", ENV.LOCAL_MAPA]]);

// ── la pregunta y algo más: la ubicación primero, y la IA avisada ──
r = await turno({ texto: "donde estan y tienen el samsung a57?", fila: { historial: "Ya di la bienvenida." }, env: ENV, respuestaDelModelo: { respuesta: "¡Sí! Mira 👇", buscar: "Samsung A57" } });
comprobar("la ubicación sale primero", r.enviados.findIndex((m) => m.attachment?.payload?.template_type === "button"), 0);
comprobar("y después el A57", fichas(r.enviados).map((f) => f.title), ["Samsung A57"]);
comprobar("la IA sabe que ya se mandó (no la repite)", JSON.stringify(r.alModelo[0]?.messages || []).includes("YA LE MANDÉ LA UBICACIÓN"), true);

// ── sin preguntar, no sale ──
r = await turno({ texto: "tienes el samsung a57?", fila: { historial: "Ya di la bienvenida." }, env: ENV, respuestaDelModelo: { respuesta: "¡Sí! Mira 👇", buscar: "Samsung A57" } });
comprobar("sin preguntar por el local, no sale la ubicación", Boolean(conBotones(r.enviados)), false);

if (fallos) { console.log(`\n${fallos} fallo(s)`); process.exit(1); }
console.log("\nTodo bien");
