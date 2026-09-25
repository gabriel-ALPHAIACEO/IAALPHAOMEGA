// Cashea y Krece en Invictus: que salgan enteros, ordenados y en dos
// mensajes, y que una pregunta de cuotas NO acabe en el asesor.
import { atenderMeta, PAGOS_CASHEA, SIN_KRECE, PREGUNTA_POR_PAGOS, YA_DIJO_SU_NIVEL } from "./.stub/index.js";

let fallos = 0;
const comprobar = (n, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};

// ── Las dos tablas ─────────────────────────────────────────────
for (const [nombre, texto] of [["Cashea", PAGOS_CASHEA]]) {
  comprobar(`${nombre}: cabe en un mensaje de Instagram`, [...texto].length <= 1000, true);
  comprobar(`${nombre}: separa los bloques con una línea en blanco`, texto.includes("\n\n"), true);
  comprobar(`${nombre}: una línea por nivel`, texto.split("\n").filter((l) => /—/.test(l)).length >= 4, true);
  comprobar(`${nombre}: cada nivel con su emoji`, texto.split("\n").filter((l) => /—/.test(l)).every((l) => /^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(l)), true);
}
comprobar("Cashea: los 6 niveles", PAGOS_CASHEA.match(/Nivel \d/g)?.length, 6);
comprobar("Cashea: 3 cuotas cada 14 días", /3 cuotas/.test(PAGOS_CASHEA) && /14 días/.test(PAGOS_CASHEA), true);
comprobar("la tabla NO menciona Krece", /krece/i.test(PAGOS_CASHEA), false);
comprobar("y cierra preguntando el nivel", /¿Qué nivel tienes/.test(PAGOS_CASHEA), true);
comprobar("si preguntan por Krece, se dice que no", /no trabajamos/i.test(SIN_KRECE), true);
comprobar("y se ofrece Cashea en la misma frase", /Cashea/.test(SIN_KRECE), true);

// ── A quién le sale ────────────────────────────────────────────
comprobar("«tienen cashea?»", PREGUNTA_POR_PAGOS.test("tienen cashea?"), true);
comprobar("«puedo pagar a cuotas?»", PREGUNTA_POR_PAGOS.test("puedo pagar a cuotas?"), true);
comprobar("«trabajan con crece?» (así lo escriben)", PREGUNTA_POR_PAGOS.test("trabajan con crece?"), true);
comprobar("«tienen el air force?» no", PREGUNTA_POR_PAGOS.test("tienen el air force?"), false);
comprobar("quien ya dijo su nivel no recibe la tabla", YA_DIJO_SU_NIVEL.test("soy nivel 4, cuanto pago"), true);
comprobar("«soy nivel 2» también", YA_DIJO_SU_NIVEL.test("soy nivel 2 cuanto seria"), true);

// ── El turno completo ──────────────────────────────────────────
const enviados = [];
globalThis.fetch = async (url, opciones = {}) => {
  const donde = String(url);
  if (donde.includes("myshopify.com")) {
    return { ok: true, status: 200, json: async () => ({ data: { products: { edges: [] } } }) };
  }
  if (donde.includes("api.openai.com")) {
    const cuerpo = JSON.stringify({ respuesta: "Con gusto 😊", buscar: "NADA", historial: "Ya di la bienvenida." });
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: cuerpo } }] }) };
  }
  if (donde.includes("graph.instagram.com")) {
    if (donde.includes("/me/messages")) {
      enviados.push(JSON.parse(opciones.body).message);
      return { ok: true, status: 200, json: async () => ({ message_id: `m${enviados.length}` }) };
    }
    return { ok: true, status: 200, json: async () => ({ name: "Ana", username: "ana" }) };
  }
  return { ok: false, status: 404, text: async () => "", json: async () => ({}) };
};

const fila = { id: "c1", nombre: "Ana", historial: "Ya di la bienvenida.", pausado_hasta: 0, mids_enviados: "[]", ultimo_envio: 0, mostrados: "[]" };
const DB = {
  prepare(sql) {
    return {
      bind() {
        const correr = async () => {
          if (/^SELECT \* FROM contactos/i.test(sql.trim())) return fila;
          if (/PRAGMA table_info/i.test(sql)) return { results: Object.keys(fila).concat(["nombre_completo", "usuario"]).map((name) => ({ name })) };
          return;
        };
        return { first: correr, run: correr, all: correr };
      },
      async first() { return null; },
      async all() { return { results: [] }; },
      async run() {},
    };
  },
};

await atenderMeta(
  { DB, SHOPIFY_TIENDA: "x.myshopify.com", SHOPIFY_TOKEN: "t", IG_TOKEN: "t", OPENAI_API_KEY: "k", URL_CATALOGO: "https://invictus.com" },
  { tipo: "texto", igsid: "c1", mid: "in1", texto: "puedo pagar a cuotas?", foto: "", historia: { url: "", id: "" } }
);

const textos = enviados.filter((m) => m.text).map((m) => m.text);
comprobar("sale UN solo mensaje", textos.length, 1);
comprobar("con la tabla de Cashea", textos[0].includes("💳 CASHEA"), true);
comprobar("sin nombrar Krece", /krece/i.test(textos[0]), false);
comprobar("y no acaba en el asesor", textos.some((t) => /asesor/i.test(t)), false);

// Preguntan por Krece, que no se maneja
enviados.length = 0;
await atenderMeta(
  { DB, SHOPIFY_TIENDA: "x.myshopify.com", SHOPIFY_TOKEN: "t", IG_TOKEN: "t", OPENAI_API_KEY: "k", URL_CATALOGO: "https://invictus.com" },
  { tipo: "texto", igsid: "c1", mid: "in2", texto: "trabajan con krece?", foto: "", historia: { url: "", id: "" } }
);
const conKrece = enviados.filter((m) => m.text).map((m) => m.text);
comprobar("Krece: un solo mensaje", conKrece.length, 1);
comprobar("dice que no la manejan", /Con Krece no trabajamos/.test(conKrece[0]), true);
comprobar("y le pasa Cashea igual", conKrece[0].includes("💳 CASHEA"), true);
comprobar("sin inventarse porcentajes de Krece", /Azul|Plata|Platino/.test(conKrece[0]), false);

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
