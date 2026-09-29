// LO QUE SE ESTÁ GASTANDO EN OPENAI, MEDIDO DE VERDAD.
//
// POR QUÉ EXISTE ESTE ARCHIVO. Se puso un presupuesto: que el mes entero
// salga por 10 a 20 dólares. Eso no se puede administrar a ojo, porque las
// dos cosas que cuestan son invisibles desde fuera:
//
//   · Un mensaje de texto y una foto NO cuestan lo mismo. Una foto cuesta
//     como dieciséis mensajes de texto, porque va al modelo grande.
//   · Los prompts son lo caro, no los mensajes del cliente. vision.txt son
//     ~10.800 tokens que entran en CADA foto, y el cliente escribe veinte.
//
// OpenAI devuelve en cada respuesta cuántos tokens gastó de verdad (el
// campo "usage"). Hasta ahora se tiraba a la basura. Acá se guarda, se
// convierte a dólares con la tarifa de cada modelo, y se suma por mes.
//
// LO QUE SE VE EN /estado: los tokens y los dólares del mes en curso,
// partidos por modelo, y a qué ritmo va — "llevas $4,10 en 9 días, el mes
// te sale en $13,70". Eso es lo que permite decidir con datos si hace falta
// bajar algo, y cuál.
//
// TAMBIÉN SALE EN wrangler tail, una línea por llamada, con los tokens que
// costó y si OpenAI los cobró con descuento de caché. Sirve para ver al
// momento qué parte de una foto se come el presupuesto.

// LAS TARIFAS, EN DÓLARES POR MILLÓN DE TOKENS.
//
// Están acá y no en wrangler.toml a propósito: no son configuración de la
// tienda, son el precio de lista de OpenAI. Cuando OpenAI los cambie, se
// cambian acá y se vuelve a pegar el archivo.
//
// "cacheada" es la entrada que OpenAI cobra a mitad de precio porque ya
// vio ese mismo principio de prompt hace poco. Con prompts fijos y grandes
// —los nuestros— es la mayor parte de la entrada cuando hay movimiento.
const TARIFAS = {
  "gpt-4o": { entrada: 2.5, cacheada: 1.25, salida: 10 },
  "gpt-4o-mini": { entrada: 0.15, cacheada: 0.075, salida: 0.6 },

  // GEMINI (precios consultados el 29-sep-2026).
  //
  // "cacheada" va igual que "entrada" a propósito: Gemini sí tiene caché de
  // contexto con descuento, pero no se confirmó cuánto. Cobrarlo entero es
  // la suposición prudente — el gasto real será igual o MENOR que el que
  // enseña /estado, nunca mayor. Es preferible a que la cuenta se quede
  // corta y el presupuesto se pase sin avisar.
  //
  // OJO: en Gemini, un modelo más caro NO es solo "un poco más caro". Cada
  // imagen cuesta ~1.120 tokens pase lo que pase, así que el salto de
  // precio se multiplica por todas las fotos del cotejo. Con 3.5 Flash una
  // foto sale MÁS cara que en gpt-4o. Ver gemini.js.
  "gemini-3.1-flash-lite": { entrada: 0.25, cacheada: 0.25, salida: 1.5 },
  "gemini-3.5-flash": { entrada: 1.5, cacheada: 1.5, salida: 9 },
  "gemini-3-flash": { entrada: 0.5, cacheada: 0.5, salida: 3 },
  // Google lo retira el 16-oct-2026. Está por si alguna tienda lo tenía
  // puesto, no para empezar a usarlo.
  "gemini-2.5-flash-lite": { entrada: 0.1, cacheada: 0.1, salida: 0.4 },
};

// Un modelo que no esté en la tabla se cobra como el grande. Es la
// suposición prudente: así una tarifa que falta no esconde el gasto.
const POR_DEFECTO = TARIFAS["gpt-4o"];

function tarifaDe(modelo) {
  const nombre = String(modelo || "");
  if (TARIFAS[nombre]) return TARIFAS[nombre];

  // "gpt-4o-mini-2024-07-18" y demás variantes con fecha.
  const base = Object.keys(TARIFAS)
    .sort((a, b) => b.length - a.length)
    .find((clave) => nombre.startsWith(clave));

  return base ? TARIFAS[base] : POR_DEFECTO;
}

// Cuánto costó una llamada, en dólares. Se exporta porque sirve para
// enseñarlo en el registro sin tocar la base de datos.
export function costeDe({ modelo, entrada = 0, cacheadas = 0, salida = 0 }) {
  const t = tarifaDe(modelo);

  // Las cacheadas VIENEN INCLUIDAS en prompt_tokens, así que se restan
  // antes de cobrarlas a precio entero. Sin esto se cobraría dos veces.
  const enteras = Math.max(0, entrada - cacheadas);

  return (
    (enteras * t.entrada) / 1e6 + (cacheadas * t.cacheada) / 1e6 + (salida * t.salida) / 1e6
  );
}

// La tabla se crea desde el código, como todo lo demás de la base (ver
// asegurarColumnas en estado.js). Nadie tiene que correr una migración a
// mano para que esto empiece a medir.
const CREAR_TABLA = `
  CREATE TABLE IF NOT EXISTS gasto (
    mes       TEXT NOT NULL,
    modelo    TEXT NOT NULL,
    llamadas  INTEGER NOT NULL DEFAULT 0,
    entrada   INTEGER NOT NULL DEFAULT 0,
    cacheadas INTEGER NOT NULL DEFAULT 0,
    salida    INTEGER NOT NULL DEFAULT 0,
    dolares   REAL    NOT NULL DEFAULT 0,
    PRIMARY KEY (mes, modelo)
  )
`;

let tablaLista = false;

async function asegurarTabla(db) {
  if (tablaLista) return;
  await db.prepare(CREAR_TABLA).run();
  tablaLista = true;
}

function mesDeHoy() {
  return new Date().toISOString().slice(0, 7); // "2026-09"
}

// Anota una llamada. NUNCA lanza: medir el gasto no puede ser el motivo de
// que un cliente se quede sin respuesta.
export async function anotarGasto(env, { modelo, entrada = 0, cacheadas = 0, salida = 0 }) {
  const dolares = costeDe({ modelo, entrada, cacheadas, salida });

  // En el registro se ve al momento, sin esperar a /estado.
  console.log(
    `GASTO ${modelo}: ${entrada.toLocaleString()} entrada` +
      (cacheadas ? ` (${cacheadas.toLocaleString()} con descuento de caché)` : "") +
      ` + ${salida} salida = $${dolares.toFixed(5)}`
  );

  if (!env?.DB) return dolares;

  try {
    await asegurarTabla(env.DB);
    await env.DB.prepare(
      `INSERT INTO gasto (mes, modelo, llamadas, entrada, cacheadas, salida, dolares)
       VALUES (?, ?, 1, ?, ?, ?, ?)
       ON CONFLICT(mes, modelo) DO UPDATE SET
         llamadas  = llamadas  + 1,
         entrada   = entrada   + excluded.entrada,
         cacheadas = cacheadas + excluded.cacheadas,
         salida    = salida    + excluded.salida,
         dolares   = dolares   + excluded.dolares`
    )
      .bind(mesDeHoy(), String(modelo || "?"), entrada, cacheadas, salida, dolares)
      .run();
  } catch (error) {
    console.error("No pude anotar el gasto (sigo igual):", error.message);
  }

  return dolares;
}

// Lo del mes en curso, para /estado. Devuelve las filas por modelo, el
// total, y a cuánto va a salir el mes al ritmo que lleva.
export async function gastoDelMes(env) {
  if (!env?.DB) return null;

  try {
    await asegurarTabla(env.DB);
    const { results } = await env.DB.prepare(
      "SELECT modelo, llamadas, entrada, cacheadas, salida, dolares FROM gasto WHERE mes = ? ORDER BY dolares DESC"
    )
      .bind(mesDeHoy())
      .all();

    const filas = results || [];
    const total = filas.reduce((suma, f) => suma + (f.dolares || 0), 0);

    // El ritmo se saca de los días que van del mes, contando el de hoy: es
    // una regla de tres, no una predicción fina, y sirve para lo único que
    // hace falta saber —si a este paso el presupuesto aguanta o no—.
    const hoy = new Date();
    const dias = hoy.getUTCDate();
    const delMes = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + 1, 0)).getUTCDate();

    return { filas, total, dias, delMes, proyectado: (total / dias) * delMes };
  } catch (error) {
    console.error("No pude leer el gasto:", error.message);
    return null;
  }
}
