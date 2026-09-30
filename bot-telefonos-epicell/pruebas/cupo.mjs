// SIN CUPO NO ES "NO ESTÁ": una ronda de cotejo que OpenAI rechazó por
// cupo no puede contar como mirada.
//
// QUÉ SE PROTEGE. Caso real en Invictus, 30-sep-2026: una historia con un
// producto que la tienda SÍ tenía. La ronda del índice se cayó por el
// límite de gpt-4o, el modelo no vio ni una foto... y esos candidatos se
// anotaban igual como "ya mirados", porque se anotaban ANTES de llamar.
// EPICELL tenía el mismo código, así que tenía el mismo fallo.
//
// Y el porcentaje de /indexar-catalogo: pasaba del 100% cuando el índice
// guardaba fotos que ya no están en la hoja, y ?rehacer=si daba la falsa
// alarma de "se están pisando".
//
// OpenAI, Google Sheets y las fotos son de mentira (se cambia fetch), así
// que se puede hacer que OpenAI conteste 429 justo cuando interesa.

import { prepararSrc, baseDeMentira, ok, titulo, terminar } from "./ayuda.mjs";

// 60 equipos en el índice. Todos comparten "telefono negro" con la foto,
// así que todos puntúan y hay ranking para dos rondas de 8.
const INDICE = Array.from({ length: 60 }, (_, i) => ({
  titulo: `Equipo ${i}`,
  imagen: `https://cdn.test/e${i}.jpg`,
  precio: "$150",
  url: "",
  visto: `telefono negro modelo${i} camara${i % 3}`,
}));

const FOTO = "data:image/jpeg;base64,AAAA";
const VISTO = "telefono negro camara triple";
const ENV_BASE = { OPENAI_API_KEY: "x", SHEET_ID: "hoja-de-prueba" };

// La hoja, en CSV, como la devuelve Google.
function csvDe(productos) {
  return ["titulo,precio,imagen", ...productos.map((p) => `${p.titulo},${p.precio},${p.imagen}`)].join("\n");
}

// "openai" es la lista de lo que contesta OpenAI, en orden: 429 (sin cupo)
// o un objeto que va como contenido de la respuesta.
function fetchDeMentira({ openai = [], hoja = INDICE }) {
  const llamadas = [];
  const cola = [...openai];

  const falso = async (url, opciones = {}) => {
    const u = String(url);

    if (u.includes("api.openai.com")) {
      llamadas.push(JSON.parse(opciones.body));
      const turno = cola.length ? cola.shift() : 429;
      if (turno === 429) {
        return new Response(
          JSON.stringify({
            error: {
              message:
                "Rate limit reached for gpt-4o on tokens per min (TPM): " +
                "Limit 30000, Used 25511, Requested 7819. Please try again in 1s.",
            },
          }),
          { status: 429, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(turno) } }],
          usage: { prompt_tokens: 100, completion_tokens: 10 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (u.includes("docs.google.com")) {
      return new Response(csvDe(hoja), { status: 200, headers: { "content-type": "text/csv" } });
    }

    // Cualquier otra cosa es una foto del catálogo.
    return new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    });
  };

  return { falso, llamadas };
}

function titulosDe(cuerpo) {
  if (!cuerpo) return [];
  return cuerpo.messages[1].content
    .filter((c) => c.type === "text" && /^\d+\. /.test(c.text))
    .map((c) => c.text.replace(/^\d+\. /, ""));
}

// Cada escenario con su copia de src/: el límite de OpenAI se recuerda en
// el módulo (ia.js) y no puede pasar de un escenario a otro.
async function escenario({ openai, hoja, indice = INDICE }) {
  const src = await prepararSrc();
  const I = await src.cargar("indice.js");
  const C = await src.cargar("cotejo.js");
  const base = baseDeMentira();
  if (indice.length) await I.guardarIndexados(base.DB, indice);

  const { falso, llamadas } = fetchDeMentira({ openai, hoja });
  const env = { ...ENV_BASE, DB: base.DB };
  const registro = [];
  const log = console.log;
  const error = console.error;

  return {
    I, C, env, base, llamadas, registro,
    async correr(fn) {
      const fetchReal = globalThis.fetch;
      globalThis.fetch = falso;
      console.log = (...a) => registro.push(a.join(" "));
      console.error = (...a) => registro.push(a.join(" "));
      try {
        return await fn();
      } finally {
        globalThis.fetch = fetchReal;
        console.log = log;
        console.error = error;
        src.limpiar();
      }
    },
  };
}

const NINGUNO = { eleccion: 0, confianza: "alta", porque: "ninguno coincide" };
const EL_PRIMERO = { eleccion: 1, confianza: "alta", porque: "mismo equipo" };

// ───────────────────────────────────────────────────────────────────────
titulo("429 en la ronda del índice, sin tiempo para esperar");
{
  const e = await escenario({ openai: [429] });
  const informe = {};
  const r = await e.correr(() =>
    e.C.cotejoPorImagen({
      env: e.env, foto: FOTO, textoCliente: "", productos: [], termino: "", visto: VISTO,
      informe, // sin recibidoEn: no se sabe cuánto queda, no se espera
    })
  );
  const todo = e.registro.join("\n");

  ok(r === null, "no inventa un resultado");
  ok(informe.sinCupo === true, "queda apuntado que algo se quedó SIN MIRAR por cupo");
  ok(e.llamadas.length === 1, "no machaca a OpenAI con la segunda ronda", `${e.llamadas.length} llamada(s)`);
  ok(/NO LO MIRÉ TODO/.test(todo), "el registro dice claramente que no pudo mirarlo todo");
}

// ───────────────────────────────────────────────────────────────────────
titulo("429 y SÍ da el tiempo: espera al cupo, reintenta y lo encuentra");
{
  const e = await escenario({ openai: [429, EL_PRIMERO] });
  const informe = {};
  const antes = Date.now();
  const r = await e.correr(() =>
    e.C.cotejoPorImagen({
      env: e.env, foto: FOTO, textoCliente: "", productos: [], termino: "", visto: VISTO,
      recibidoEn: Date.now(), informe,
    })
  );
  const tardo = Date.now() - antes;

  ok(r?.elegido, "encuentra el equipo en el reintento");
  ok(informe.sinCupo === false, "y no queda marcado como sin cupo");
  ok(e.llamadas.length === 2, "exactamente un reintento", `${e.llamadas.length} llamada(s)`);
  ok(
    e.llamadas.length === 2 &&
      JSON.stringify(titulosDe(e.llamadas[0])) === JSON.stringify(titulosDe(e.llamadas[1])),
    "el reintento es con LOS MISMOS candidatos que el cupo dejó sin mirar"
  );
  ok(tardo >= 1000 && tardo < 5000, "esperó lo que pidió OpenAI (1s), no más", `${tardo} ms`);
}

// ───────────────────────────────────────────────────────────────────────
titulo("429 con el reloj casi agotado: no espera, no se pasa de los 30 s");
{
  const e = await escenario({ openai: [429, EL_PRIMERO] });
  const informe = {};
  const antes = Date.now();
  const r = await e.correr(() =>
    e.C.cotejoPorImagen({
      env: e.env, foto: FOTO, textoCliente: "", productos: [], termino: "", visto: VISTO,
      // Llegó hace 18 s: quedan 7 para contestar, y una ronda son 7.
      recibidoEn: Date.now() - 18000, informe,
    })
  );

  ok(r === null && informe.sinCupo === true, "no reintenta y lo deja apuntado");
  ok(e.llamadas.length === 1, "una sola llamada", `${e.llamadas.length}`);
  ok(Date.now() - antes < 1000, "y no se quedó esperando", `${Date.now() - antes} ms`);
}

// ───────────────────────────────────────────────────────────────────────
titulo("el modelo SÍ miró y dijo que ninguno: eso sí cuenta como mirado");
{
  const e = await escenario({ openai: [NINGUNO, NINGUNO] });
  const informe = {};
  const r = await e.correr(() =>
    e.C.cotejoPorImagen({
      env: e.env, foto: FOTO, textoCliente: "", productos: [], termino: "", visto: VISTO, informe,
    })
  );
  const [uno, dos] = e.llamadas.map(titulosDe);

  ok(r === null && informe.sinCupo === false, "no es un problema de cupo: no se marca");
  ok(e.llamadas.length === 2, "baja a la segunda ronda del ranking", `${e.llamadas.length}`);
  ok(uno && dos && !uno.some((t) => dos.includes(t)), "y la segunda ronda NO repite ninguno de la primera");
}

// ───────────────────────────────────────────────────────────────────────
titulo("429 sobre los del NOMBRE: no se dan por rechazados");
{
  const e = await escenario({ openai: [429, 429, 429] });
  const productos = [0, 1, 2].map((i) => ({
    titulo: `Redmi Note 14 ${i}`, imagen: `https://cdn.test/rn14-${i}.jpg`, precio: "$200", url: "",
  }));
  const informe = {};
  const r = await e.correr(() =>
    e.C.cotejoPorImagen({
      env: e.env, foto: FOTO, textoCliente: "precio", productos, termino: "Redmi Note 14",
      visto: VISTO, nombreFiable: true, informe,
    })
  );

  ok(r === null, "devuelve null: se enseñan los 3 Redmi Note 14 que encontró la búsqueda");
  ok(e.llamadas.length === 1, "y no sigue al índice a buscar otro modelo", `${e.llamadas.length} llamada(s)`);
  ok(!/el nombre no es de fiar/.test(e.registro.join("\n")), 'el registro no dice "el nombre no es de fiar"');
}

// ───────────────────────────────────────────────────────────────────────
titulo("/indexar-catalogo: el porcentaje no pasa del 100%");
{
  // En el índice, 60. En la hoja, 50 de esos (10 se retiraron) y 5 nuevos.
  const hoja = [
    ...INDICE.slice(0, 50),
    ...[0, 1, 2, 3, 4].map((i) => ({ titulo: `Nuevo ${i}`, precio: "$99", imagen: `https://cdn.test/n${i}.jpg` })),
  ];
  const describe = { visto: "telefono azul" };
  const e = await escenario({ openai: Array(5).fill(describe), hoja });
  const r = await e.correr(() => e.I.indexarTanda(e.env, { cuantos: 40 }));
  const hecho = Math.round(((r.yaEstaban + r.indexados) * 100) / r.indexables);

  ok(r.indexados === 5, "indexa los 5 nuevos", `${r.indexados}`);
  ok(hecho === 100, "y el porcentaje es 100, no 118", `${hecho}%`);
  ok(!/se están pisando/i.test(e.registro.join("\n")), "sin falsa alarma");
}

{
  // ?rehacer=si reescribe filas que ya estaban: no suma ninguna, y eso no
  // es un pisotón.
  const describe = { visto: "telefono negro" };
  const e = await escenario({ openai: Array(40).fill(describe), hoja: INDICE });
  await e.correr(() => e.I.indexarTanda(e.env, { cuantos: 40, rehacer: true }));
  ok(!/se están pisando/i.test(e.registro.join("\n")), 'con ?rehacer=si no sale el falso "se están pisando"');
}

{
  // Y la alarma de verdad sigue sonando: dos productos nuevos con la misma
  // foto dejan una fila en vez de dos.
  const hoja = [
    { titulo: "Nuevo A", precio: "$1", imagen: "https://cdn.test/igual.jpg" },
    { titulo: "Nuevo B", precio: "$1", imagen: "https://cdn.test/igual.jpg" },
  ];
  const describe = { visto: "telefono" };
  const e = await escenario({ openai: [describe, describe], hoja, indice: [] });
  await e.correr(() => e.I.indexarTanda(e.env, { cuantos: 40 }));
  ok(/se están pisando/i.test(e.registro.join("\n")), "la alarma de verdad sigue sonando");
}

terminar();
