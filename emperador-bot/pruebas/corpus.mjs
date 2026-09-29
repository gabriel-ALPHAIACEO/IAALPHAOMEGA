// QUE LAS REDES DE SEGURIDAD NO SE METAN DONDE NO LAS LLAMAN.
//
// POR QUÉ ESTA PRUEBA ES LA MÁS IMPORTANTE DE TODAS. El bot tiene varias
// capas de código que revisan lo que la IA quiere mandar y lo corrigen
// (pagos.js hoy, y las que vengan). El riesgo de una capa así NO es que se
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
    if (!t.startsWith('{"respuesta"')) continue;
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
      if (/[áéíóúñ¿!😊👟👋🕘💳]|\b(te|que|tu|el|la|los|las|un|una|de)\b/.test(frase)) salida.add(frase);
    }
  }
  return [...salida];
}

const delPrompt = respuestasDelPrompt();
const delCodigo = frasesDelCodigo();

const src = await prepararSrc();
const { revisarPagos } = await src.cargar("pagos.js");

// Cada guardián que revise lo que se le manda al cliente se añade acá.
const GUARDIANES = [["pagos.js", revisarPagos]];

titulo("hay corpus de dónde sacar");

ok(delPrompt.length > 40, `${delPrompt.length} respuestas de ejemplo en el prompt`);
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
ok(revisarPagos("Ya te paso los datos de la cuenta").corregido, "pagos.js sigue vivo y corrige lo malo");

src.limpiar();
terminar();
