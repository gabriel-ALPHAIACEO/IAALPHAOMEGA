import { esEcoPorTexto, envioReciente, VENTANA_ECO_SIN_TEXTO_MS, estaPausado } from "./.stub/estado.js";
import { minutosParaVolver } from "./.stub/index.js";

let fallos = 0;
const comprobar = (n, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};

// La huella se guarda normalizada (sin tildes, en minúsculas): así es
// exactamente como la escribe marcarEnvio en D1.
const contacto = {
  ultimos_textos: [
    "te muestro el samsung a57 que identificaste 🔢 ¿te gustaria saber algo mas sobre el?",
    "eso te lo confirma un asesor en un momento 😊",
  ],
  ultimo_envio: Date.now() - 30 * 1000,
  pausado_hasta: 0,
};

// 1. El eco propio se reconoce por el texto, aunque el mid no cuadre
comprobar("eco propio, mismo texto", esEcoPorTexto(contacto, "Te muestro el Samsung A57 que identificaste 🔢 ¿Te gustaría saber algo más sobre él?"), true);
comprobar("con tildes y mayúsculas distintas", esEcoPorTexto(contacto, "ESO TE LO CONFIRMA UN ASESOR EN UN MOMENTO 😊"), true);
comprobar("con espacios de más", esEcoPorTexto(contacto, "  Eso te lo confirma   un asesor en un momento 😊 "), true);
comprobar("un asesor de verdad NO se confunde", esEcoPorTexto(contacto, "hola, te llamo en 5 min"), false);
comprobar("eco vacío no cuenta", esEcoPorTexto(contacto, ""), false);
comprobar("contacto nuevo no revienta", esEcoPorTexto({}, "hola"), false);

// 2. La ventana ancha para el eco del carrusel (que llega sin texto)
comprobar("90s: el carrusel de hace 2 min ya no entra por la ventana corta", envioReciente(contacto, Date.now()), true);
const viejito = { ultimo_envio: Date.now() - 3 * 60 * 1000 };
comprobar("ventana corta: hace 3 min ya no", envioReciente(viejito), false);
comprobar("ventana del carrusel: hace 3 min sí", envioReciente(viejito, Date.now(), VENTANA_ECO_SIN_TEXTO_MS), true);
comprobar("pero no eternamente", envioReciente({ ultimo_envio: Date.now() - 10 * 60 * 1000 }, Date.now(), VENTANA_ECO_SIN_TEXTO_MS), false);
comprobar("sin envíos previos, nada", envioReciente({ ultimo_envio: 0 }, Date.now(), VENTANA_ECO_SIN_TEXTO_MS), false);

// 3. Cuánto aguanta la pausa con el asesor callado
comprobar("por defecto, 10 min", minutosParaVolver({}), 10);
comprobar("se puede cambiar en wrangler.toml", minutosParaVolver({ PAUSA_VUELVE_MIN: "25" }), 25);
comprobar("un valor absurdo no lo apaga", minutosParaVolver({ PAUSA_VUELVE_MIN: "0" }), 10);

// 4. La cuenta de "hace cuánto escribió el asesor", tal como la hace index.js
const horas = 4;
const calladoMin = (pausadoHasta) => (Date.now() - (pausadoHasta - horas * 3600 * 1000)) / 60000;
const asesorEscribioHace = (min) => Date.now() - min * 60000 + horas * 3600 * 1000;

comprobar("asesor escribiendo ahora: sigue pausado", Math.round(calladoMin(asesorEscribioHace(2))) >= 10, false);
comprobar("asesor callado 20 min: el bot retoma", Math.round(calladoMin(asesorEscribioHace(20))) >= 10, true);
comprobar("y la pausa seguía vigente", estaPausado({ pausado_hasta: asesorEscribioHace(20) }), true);

/* ── EL ASESOR QUE CONTESTA RÁPIDO SÍ PAUSA EL BOT ─────────────────
   El fallo que reportó el dueño: "cuando el asesor está hablando con el
   cliente la IA se interpone y responde". Había una red de 90 segundos
   que contaba CUALQUIER eco como propio del bot si acababa de enviar
   algo — y el asesor que se mete en una conversación viva escribe justo
   ahí. Ahora, con texto, manda la comparación de texto.
   ───────────────────────────────────────────────────────────────── */
const { turno } = await import("./banco.mjs");

// El bot acaba de escribir (hace 30 segundos) y el asesor contesta.
let r = await turno({
  fila: {
    historial: "Ya di la bienvenida.",
    ultimo_envio: Date.now() - 30 * 1000,
    ultimos_textos: JSON.stringify(["te muestro el samsung a57 👇"]),
  },
  mensaje: { tipo: "eco", texto: "Hola! Soy Luis, un asesor. Ya te ayudo con eso 😊", mid: "otro-mid" },
});
comprobar("el asesor escribe 30s después del bot: SÍ pausa", Number(r.fila.pausado_hasta) > Date.now(), true);

// Y el eco del PROPIO bot, en la misma ventana, sigue sin pausar.
r = await turno({
  fila: {
    historial: "Ya di la bienvenida.",
    ultimo_envio: Date.now() - 30 * 1000,
    ultimos_textos: JSON.stringify(["te muestro el samsung a57 👇"]),
  },
  mensaje: { tipo: "eco", texto: "Te muestro el Samsung A57 👇", mid: "otro-mid" },
});
comprobar("su propio eco NO lo pausa", Number(r.fila.pausado_hasta || 0) > Date.now(), false);

// El "botón" para devolverle la conversación: la frase y el código corto.
for (const dicho of ["Te dejo con la asistente, ella te sigue ayudando 😊", "#bot"]) {
  r = await turno({
    fila: { historial: "Ya di la bienvenida.", pausado_hasta: Date.now() + 60 * 60 * 1000 },
    mensaje: { tipo: "eco", texto: dicho, mid: "otro-mid" },
  });
  comprobar(`«${dicho.slice(0, 22)}…» devuelve la conversación`, Number(r.fila.pausado_hasta || 0), 0);
}

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
