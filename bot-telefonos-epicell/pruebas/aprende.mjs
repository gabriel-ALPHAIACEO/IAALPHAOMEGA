// LO APRENDIDO LE LLEGA A LA IA (7-oct-2026)
//
// Con APRENDER = "si", el revisor guarda una regla por error (lecciones.js)
// y la IA la recibe en cada mensaje. En EPICCELL se guardaban pero no le
// llegaban: faltaba ponerlas delante del mensaje en ia.js.
import { DatabaseSync } from "node:sqlite";
import { aprender } from "./.stub/lecciones.js";
import { responderTexto } from "./.stub/ia.js";

let fallos = 0;
const comprobar = (n, real, esperado = true) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};

function base() {
  const db = new DatabaseSync(":memory:");
  const p = (sql, args = []) => ({
    bind: (...a) => p(sql, a),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) ?? null,
  });
  return { prepare: (sql) => p(sql), batch: async (l) => { for (const x of l) await x.run(); } };
}

const enviado = [];
globalThis.fetch = async (url, op) => {
  if (String(url).includes("openai")) {
    enviado.push(JSON.parse(op.body));
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ pienso: "Charla: x. Pide: y.", mostrar: "texto", respuesta: "¡Hola!", buscar: "NADA", historial: "Ya di la bienvenida." }) } }] }) };
  }
  return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
};

const REGLA = "Cuando pregunten por el Redmi Pad 2, no digas que trae lápiz.";
{
  const env = { APRENDER: "si", DB: base(), OPENAI_API_KEY: "k" };
  await aprender(env, { tipo: "texto", regla: REGLA, cliente: "trae lápiz?", dijo: "Sí, trae lápiz" });
  await responderTexto(env, "Cliente: hola");
  const texto = JSON.stringify(enviado.at(-1)?.messages || []);
  comprobar("con APRENDER = si, la regla le llega a la IA de texto", texto.includes(REGLA));
  comprobar("…con su encabezado", /LO QUE YA APRENDISTE/.test(texto));
}
{
  const env = { APRENDER: "no", DB: base(), OPENAI_API_KEY: "k" };
  await aprender({ ...env, APRENDER: "si" }, { tipo: "texto", regla: REGLA });
  await responderTexto(env, "Cliente: hola");
  comprobar("con APRENDER = no, no le llega nada", JSON.stringify(enviado.at(-1)?.messages || []).includes(REGLA), false);
}

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
