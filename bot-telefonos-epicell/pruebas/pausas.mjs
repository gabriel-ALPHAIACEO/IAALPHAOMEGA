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

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
