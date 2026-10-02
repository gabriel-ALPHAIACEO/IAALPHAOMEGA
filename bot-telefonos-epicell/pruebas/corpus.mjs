// QUE LAS REDES DE SEGURIDAD NO SE METAN DONDE NO LAS LLAMAN.
//
// POR QUÉ ESTA PRUEBA ES LA MÁS IMPORTANTE DE TODAS. El bot tiene varias
// capas de código que revisan lo que la IA quiere mandar y lo corrigen
// (cuotas.js, tono.js, precio.js, catalogo.js, y las que vengan). El riesgo de una capa así NO es que se
// le escape algo malo: es que atrape algo bueno.
//
// Un guardián demasiado ancho no da error en ninguna parte. Simplemente un
// día empieza a cambiar respuestas correctas por otra cosa, y nadie se
// entera hasta que un cliente se queja.
//
// LA IDEA. Las respuestas que el bot escribe de verdad ya están escritas en
// dos sitios: los ejemplos del prompt —que son literalmente lo que el
// modelo aprende a contestar— y las frases fijas del código. Se saca todo
// eso y se le pasa por encima a cada guardián. Si toca una sola, es un
// falso positivo y hay que afinar el guardián antes de entregar.
//
// Crece solo: cada ejemplo nuevo que se añada al prompt entra en la prueba
// sin tocar este archivo.

import { prepararSrc, prompt, fuente, listaDeFuentes, ok, titulo, terminar } from "./ayuda.mjs";

// ── LO QUE EL BOT DICE DE VERDAD ───────────────────────────────────────

// Los ejemplos del prompt: {"respuesta":"...","buscar":"...",...}
function respuestasDelPrompt() {
  const salida = [];
  for (const linea of prompt("texto.txt").split("\n")) {
    const t = linea.trim();
    if (!t.startsWith('{"') || !t.includes('"respuesta"')) continue;
    try {
      const o = JSON.parse(t);
      if (o.respuesta) salida.push(o.respuesta);
    } catch {}
  }
  return salida;
}

// Las frases que el código manda tal cual, sin pasar por el modelo: los
// saludos, "ya te mostré todo", la escalada al asesor, los fallos técnicos.
function frasesDelCodigo() {
  const salida = new Set();
  for (const archivo of listaDeFuentes()) {
    // FUERA LOS COMENTARIOS Y EL REGISTRO, y el motivo importa:
    //
    //   · Los comentarios de una red de seguridad están LLENOS de ejemplos
    //     de lo que atrapa ("ya te paso el número de cuenta"). Si se
    //     scrapean, la prueba se acusa a sí misma de falsos positivos.
    //   · console.log y console.error no le hablan a ningún cliente. Que un
    //     guardián "corrija" un mensaje de registro no le importa a nadie, y
    //     metido en el corpus solo produce alarmas falsas.
    const limpio = fuente(archivo)
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return false;
        if (/console\.(log|error|warn)\(/.test(t)) return false;
        return true;
      })
      .join("\n");

    for (const [, frase] of limpio.matchAll(/"([^"\\]{20,160})"/g)) {
      // Se queda con lo que parece una frase para una persona, no un SQL ni
      // una URL ni un nombre de campo.
      if (/^(https?:|SELECT|INSERT|CREATE|UPDATE|DELETE|[\w./-]+$)/i.test(frase)) continue;
      if (!/\s/.test(frase)) continue;
      // Un "trozo" que cruza líneas es código entre dos comillas, no una frase.
      if (/\n/.test(frase)) continue;
      if (/[áéíóúñ¿!😊📱👋🕘💳]|\b(te|que|tu|el|la|los|las|un|una|de)\b/.test(frase)) salida.add(frase);
    }
  }
  return [...salida];
}

const delPrompt = respuestasDelPrompt();
const delCodigo = frasesDelCodigo();

const src = await prepararSrc();

// Cada guardián que revise lo que se le manda al cliente se añade acá.
const { revisarCuotas } = await src.cargar("cuotas.js");
const { revisarTono } = await src.cargar("tono.js");
const { revisarPrecio } = await src.cargar("precio.js");
const { niegaElCatalogo, sinNegarElCatalogo } = await src.cargar("catalogo.js");
const { revisarDisponibilidad } = await src.cargar("disponible.js");

// Una hoja con un teléfono de cada marca de los ejemplos: con todo
// disponible, la red de "lo que no hay" no puede tocar ninguna respuesta.
const HOJA_CON_TODO = ["iPhone 15 128GB", "Samsung Galaxy S24", "Redmi Note 14", "Xiaomi 14", "Poco X6", "Infinix Hot 50",
  "Tecno Spark 20", "Honor X8", "Motorola Moto G84", "Realme 12", "Huawei Nova 12", "Oppo A79", "ZTE Blade", "Nokia G42",
  "Pixel 8", "OnePlus 12", "Itel A70", "Alcatel 1"].map((titulo) => ({ titulo }));

const GUARDIANES = [
  ["cuotas.js (porcentajes de Cashea y Krece)", revisarCuotas],
  // Las redes del 2-oct (portadas de Invictus).
  ["tono.js (groserías, insultos, regaños)", revisarTono],
  ["catalogo.js (que no niegue el catálogo)", (t) => ({ corregido: niegaElCatalogo(t), respuesta: sinNegarElCatalogo(t) })],
  ["disponible.js (lo que no hay en la hoja)", (t) => revisarDisponibilidad(t, HOJA_CON_TODO)],
  ["precio.js (con fichas)", (t) => revisarPrecio(t, { hayFichas: true })],
  ["precio.js (ya las vio)", (t) => revisarPrecio(t, { yaLasVio: true })],
];

titulo("hay corpus de dónde sacar");

ok(delPrompt.length > 25, `${delPrompt.length} respuestas de ejemplo en el prompt`);
ok(delCodigo.length > 50, `${delCodigo.length} frases fijas en el código`);

for (const [nombre, guardian] of GUARDIANES) {
  titulo(`${nombre}: ninguna respuesta buena debe alterarse`);

  for (const [origen, lista] of [["prompt", delPrompt], ["código", delCodigo]]) {
    const tocadas = [];
    for (const texto of lista) {
      const r = guardian(texto);
      if (r?.corregido) tocadas.push({ texto, motivos: r.motivos });
    }

    for (const t of tocadas) {
      console.log(`\n        FALSO POSITIVO (${origen})`);
      console.log(`        iba a decir: ${t.texto.slice(0, 110)}`);
      console.log(`        motivo:      ${(t.motivos || []).join("; ")}`);
    }

    ok(
      tocadas.length === 0,
      `${lista.length} respuestas del ${origen}, ninguna alterada`,
      tocadas.length ? `${tocadas.length} ALTERADAS` : ""
    );
  }
}

titulo("y sí atrapa lo que tiene que atrapar");

// El contrapeso: si el guardián no corrigiera NADA nunca, todo lo de arriba
// pasaría igual y la prueba no valdría para nada.
ok(revisarCuotas("Con Cashea pagas 0% de inicial").corregido, "cuotas.js sigue vivo y corrige lo malo");
ok(revisarTono("No seas bruto").corregido, "tono.js sigue vivo");
ok(revisarPrecio("¿Quieres saber el precio?", { hayFichas: true }).corregido, "precio.js sigue vivo");
ok(niegaElCatalogo("No tenemos catálogo"), "catalogo.js sigue vivo");
ok(revisarDisponibilidad("¡Sí tenemos iPhone!", [{ titulo: "Samsung A57" }]).corregido, "disponible.js sigue vivo");

src.limpiar();
terminar();
