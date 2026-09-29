// QUIEN LLEGA DESDE UN ANUNCIO.
//
// Meta manda el aviso SIN mensaje dentro, y por eso se caía por el "evento
// que no lleva mensaje": la persona pulsaba "Enviar mensaje" en la
// publicidad y del otro lado no contestaba nadie, después de que la tienda
// pagara por ese clic.
import { leerMensaje } from "./.stub/instagram.js";
import { turno, HOJA } from "./banco.mjs";

let fallos = 0;
const comprobar = (n, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};

const textos = (enviados) => enviados.filter((m) => m.text).map((m) => m.text).join(" ");
const fichas = (enviados) =>
  (enviados.find((m) => m.attachment)?.attachment?.payload?.elements || []).map((e) => e.title);

// ── Leerlo del webhook, en los tres sitios donde Meta lo pone ──
const soloAviso = leerMensaje({ entry: [{ messaging: [{
  sender: { id: "u1" },
  referral: { source: "ADS", type: "OPEN_THREAD", ad_id: "120",
    ads_context_data: { ad_title: "Samsung A57 en oferta", photo_url: "https://cdn/a.jpg", post_id: "18099" } },
}] }] });
comprobar("el aviso suelto se atiende", soloAviso?.tipo, "anuncio");
comprobar("con el título del anuncio", soloAviso?.anuncio?.titulo, "Samsung A57 en oferta");
comprobar("y el post del que salió", soloAviso?.anuncio?.publicacion, "18099");

const conMensaje = leerMensaje({ entry: [{ messaging: [{
  sender: { id: "u1" },
  message: { mid: "m1", text: "hola, precio?", referral: { source: "ADS", ads_context_data: { ad_title: "Poco X8 pro 5G" } } },
}] }] });
comprobar("el primer mensaje trae su anuncio", conMensaje?.anuncio?.titulo, "Poco X8 pro 5G");
comprobar("y sigue siendo un mensaje de texto", conMensaje?.tipo, "texto");

const porBoton = leerMensaje({ entry: [{ messaging: [{
  sender: { id: "u1" },
  postback: { payload: "VER", referral: { source: "ADS", ad_id: "77" } },
}] }] });
comprobar("el botón de un anuncio tampoco se tira", porBoton?.tipo, "anuncio");

// Un evento normal sin nada sigue descartándose.
comprobar("un 'visto' se sigue ignorando", leerMensaje({ entry: [{ messaging: [{ read: {} }] }] }), null);

// ── El turno completo ──────────────────────────────────────────
let r = await turno({
  mensaje: { tipo: "anuncio", texto: "", anuncio: { fuente: "ADS", id: "120", titulo: "Samsung A57 — llévatelo hoy", foto: "", publicacion: "" } },
  respuestaDelModelo: { buscar: "Samsung A57", respuesta: "¡Hola! Soy la asistente de EPICELL 👋 Te muestro 👇" },
});
comprobar("le contesta al que viene del anuncio", r.enviados.length > 0, true);
comprobar("y con el equipo del anuncio", fichas(r.enviados).includes("Samsung A57"), true);

// El anuncio del que Meta no cuenta nada: se le saluda igual.
r = await turno({
  mensaje: { tipo: "anuncio", texto: "", anuncio: { fuente: "ADS", id: "999", titulo: "", foto: "", publicacion: "" } },
});
comprobar("sin datos del anuncio, lo saluda y le pregunta", /qu[eé] (equipo|est[aá]s)/i.test(textos(r.enviados)), true);
comprobar("y no le dice que no pudo abrir nada", /no pude abrir|no me lleg[oó]/i.test(textos(r.enviados)), false);

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
