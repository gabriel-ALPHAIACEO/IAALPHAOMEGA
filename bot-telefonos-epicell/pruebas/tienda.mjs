// EL PANEL DE LA TIENDA (/panel, 2-oct-2026): la clave, la lista de
// conversaciones, lo que pensó la IA debajo de cada respuesta, y pausar /
// devolver. Con una D1 de verdad (SQLite en memoria).
import { DatabaseSync } from "node:sqlite";
import worker from "./.stub/index.js";
import { turno } from "./banco.mjs";

let fallos = 0;
const comprobar = (n, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};

function d1() {
  const sql = new DatabaseSync(":memory:");
  return {
    async batch(lista) { for (const x of lista) await x.run(); return []; },
    prepare(consulta) {
      let args = [];
      return {
        bind(...a) { args = a; return this; },
        async run() { sql.prepare(consulta).run(...args); return { success: true }; },
        async all() { return { results: sql.prepare(consulta).all(...args) }; },
        async first() { return sql.prepare(consulta).get(...args) ?? null; },
      };
    },
  };
}

const DB = d1();
const CLAVE = "clave-secreta-123";
const ENV = { DB, PANEL_CLAVE: CLAVE, TIENDA_NOMBRE: "EPICCELL", PAUSA_HORAS: "1", SHEET_ID: "abc" };

// Una conversación de verdad, con lo que pensó la IA.
const silencio = (fn) => async (...a) => { const [l, e] = [console.log, console.error]; console.log = console.error = () => {}; try { return await fn(...a); } finally { console.log = l; console.error = e; } };
await silencio(turno)({
  db: DB, texto: "tienes el samsung a57?",
  respuestaDelModelo: { pienso: "Pide el Samsung A57. Está en la lista: lo busco.", mostrar: "texto_e_imagenes", respuesta: "¡Mira el Samsung A57! 👇", buscar: "Samsung A57" },
});

async function pedir(ruta, { metodo = "GET", cookie = "", cuerpo = null, origen = "" } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (origen) headers.origin = origen;
  const r = await silencio(worker.fetch)(new Request(`https://bot.test${ruta}`, { method: metodo, headers, body: cuerpo }), ENV, { waitUntil() {} });
  return { estado: r.status, texto: await r.text(), cookie: r.headers.get("set-cookie") || "", donde: r.headers.get("location") || "" };
}

let r = await pedir("/panel");
comprobar("sin sesión pide la clave", /Escribe la clave del panel/.test(r.texto), true);
comprobar("y no enseña ninguna conversación", /Samsung/.test(r.texto), false);

const mala = new FormData(); mala.set("clave", "otra");
r = await pedir("/panel/entrar", { metodo: "POST", cuerpo: mala });
comprobar("con la clave equivocada no entra", /Esa no es la clave/.test(r.texto) && !r.cookie, true);

const buena = new FormData(); buena.set("clave", CLAVE);
r = await pedir("/panel/entrar", { metodo: "POST", cuerpo: buena });
const cookie = r.cookie.split(";")[0];
comprobar("con la clave buena entra (cookie firmada, solo para /panel)", /HttpOnly/.test(r.cookie) && /Path=\/panel/.test(r.cookie) && r.donde === "/panel", true);

r = await pedir("/panel", { cookie });
comprobar("la lista enseña la conversación", /Perlita/.test(r.texto) && /Samsung A57/.test(r.texto), true);

r = await pedir("/panel/c/cliente1", { cookie });
comprobar("la conversación: lo que escribió el cliente", /tienes el samsung a57\?/.test(r.texto), true);
comprobar("lo que contestó el bot", /Mira el Samsung A57/.test(r.texto), true);
comprobar("y debajo, LO QUE PENSÓ LA IA", /Lo que pensó la IA/.test(r.texto) && /Está en la lista: lo busco/.test(r.texto), true);
// Las fichas, plegadas en la caja de lo que pensó (ya se ven en el carrusel).
comprobar("qué buscó y qué fichas mandó", /Buscó: “Samsung A57”/.test(r.texto) && /ficha\(s\)<\/summary>Samsung A57/.test(r.texto), true);
comprobar("y las fichas, en un carrusel con su foto (como en Instagram)", /class="carrusel"/.test(r.texto) && /class="ficha"/.test(r.texto), true);

const id = new FormData(); id.set("id", "cliente1");
r = await pedir("/panel/pausar", { metodo: "POST", cookie, cuerpo: id, origen: "https://otra-web.com" });
comprobar("una acción desde otra web se rechaza", r.estado, 403);

r = await pedir("/panel/pausar", { metodo: "POST", cookie, cuerpo: id, origen: "https://bot.test" });
r = await pedir("/panel/c/cliente1", { cookie });
comprobar("pausar desde el panel", /Bot en pausa hasta/.test(r.texto), true);

const id2 = new FormData(); id2.set("id", "cliente1");
await pedir("/panel/devolver", { metodo: "POST", cookie, cuerpo: id2, origen: "https://bot.test" });
r = await pedir("/panel/c/cliente1", { cookie });
comprobar("y devolverle la conversación al bot", /Pausar el bot 1 h/.test(r.texto), true);

r = await pedir("/panel/c/%3Cscript%3E", { cookie });
// La página trae su propio <script> (el de ponerse al día sola): lo que se
// mira es que el <script> de la URL salga escapado.
comprobar("lo que viene en la URL se escapa (nada de <script>)", !/Id <script>/.test(r.texto) && /Id &lt;script&gt;/.test(r.texto), true);

const sinClave = await silencio(worker.fetch)(new Request("https://bot.test/panel"), { DB }, { waitUntil() {} });
comprobar("sin PANEL_CLAVE el panel está apagado para todos", /El panel está apagado/.test(await sinClave.text()), true);

r = await pedir("/panel/estado", { cookie });
comprobar("el estado se ve dentro del panel", /CÓDIGO DESPLEGADO/.test(r.texto), true);

console.log(fallos ? `\n${fallos} fallo(s)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
