// LOS MENSAJES REPETIDOS Y LOS MENSAJES SEGUIDOS (13-oct-2026, ver rafaga.js,
// igual en las tres tiendas; sus pruebas enteras están en Invictus y El
// Emperador). Aquí: que EPICCELL lo use de verdad, por atenderConRed, en
// Instagram y en WhatsApp.
//
//   python3 pruebas/preparar.py && node pruebas/rafaga.mjs
import { DatabaseSync } from "node:sqlite";
import { turno, baseFalsa } from "./banco.mjs";
import { cuentaDeRafagas } from "./.stub/rafaga.js";

let fallos = 0;
const comprobar = (n, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};

// La D1 de mentira del banco para todo, y SQLite de verdad para la tabla
// de los mensajes recibidos (la que lleva RETURNING y UNIQUE).
function base() {
  const sql = new DatabaseSync(":memory:");
  const preparada = (consulta, args = []) => ({
    bind: (...a) => preparada(consulta, a),
    run: async () => (sql.prepare(consulta).run(...args), { success: true }),
    all: async () => ({ results: sql.prepare(consulta).all(...args) }),
    first: async () => sql.prepare(consulta).get(...args) ?? null,
  });
  const falsa = baseFalsa({ id: "cliente1" });
  return {
    filas: falsa.filas,
    batch: async (lista) => { for (const p of lista) await p.run(); },
    prepare: (consulta) => (/mensajes_recibidos/.test(consulta) ? preparada(consulta) : falsa.prepare(consulta)),
  };
}

const log = console.log;
const callar = () => { console.log = () => {}; console.error = () => {}; };
const hablar = () => { console.log = log; console.error = log; };
const entorno = { JUNTAR_SEGUNDOS: "0.3" };

// 1. Meta repite el aviso: una sola respuesta.
{
  const DB = base();
  callar();
  const a = await turno({ texto: "hola, tienen el poco x8?", mensaje: { mid: "mid-igual" }, db: DB, conRed: true, env: entorno });
  const b = await turno({ texto: "hola, tienen el poco x8?", mensaje: { mid: "mid-igual" }, db: DB, conRed: true, env: entorno });
  hablar();
  comprobar("Instagram: el primero se contesta", a.enviados.length > 0 && a.alModelo.length > 0, true);
  comprobar("el mismo mensaje otra vez: ni respuesta ni IA", [b.enviados.length, b.alModelo.length], [0, 0]);
  const c = await cuentaDeRafagas(DB);
  comprobar("/estado lo cuenta", [c.recibidos, c.repetidos], [1, 1]);
}

// 2. Tres mensajes seguidos: una respuesta, una llamada con los tres.
{
  const DB = base();
  callar();
  const uno = turno({ texto: "hola", mensaje: { mid: "r1" }, db: DB, conRed: true, env: entorno });
  await new Promise((s) => setTimeout(s, 60));
  const dos = turno({ texto: "tienen", mensaje: { mid: "r2" }, db: DB, conRed: true, env: entorno });
  await new Promise((s) => setTimeout(s, 60));
  const tres = turno({ texto: "el poco x8?", mensaje: { mid: "r3" }, db: DB, conRed: true, env: entorno });
  const [r1, r2, r3] = await Promise.all([uno, dos, tres]);
  hablar();
  // El banco cambia fetch en cada turno: lo que salió va al último que lo puso.
  const todasLasLlamadas = [...r1.alModelo, ...r2.alModelo, ...r3.alModelo];
  comprobar("una sola llamada a la IA", todasLasLlamadas.filter((m) => !m.redaccion).length, 1);
  comprobar("con los tres mensajes, en orden", JSON.stringify(todasLasLlamadas[0] || {}).includes("hola\\ntienen\\nel poco x8?"), true);
  comprobar("y una sola respuesta", [...r1.enviados, ...r2.enviados, ...r3.enviados].filter((e) => e.text).length, 1);
}

// 3. Por WhatsApp también se juntan.
{
  const DB = base();
  const wa = (texto, mid) => turno({ texto, mensaje: { mid, canal: "whatsapp", igsid: "wa:584121112233" }, db: DB, conRed: true, env: { ...entorno, WA_PHONE_ID: "1", WA_TOKEN: "t" } });
  callar();
  const p1 = wa("buenas", "wamid.A");
  await new Promise((s) => setTimeout(s, 60));
  const p2 = wa("precio del a17", "wamid.B");
  const [w1, w2] = await Promise.all([p1, p2]);
  hablar();
  const llamadas = [...w1.alModelo, ...w2.alModelo].filter((m) => !m.redaccion);
  comprobar("WhatsApp: una llamada con los dos", [llamadas.length, JSON.stringify(llamadas[0] || {}).includes("buenas\\nprecio del a17")], [1, true]);
  comprobar("WhatsApp: los dos quedan como leídos (el «visto» sale igual)", [...w1.enviados, ...w2.enviados].filter((e) => e.WA_LEIDO).length, 2);
}

// 4. Apagado: cada uno por separado.
{
  const DB = base();
  callar();
  const p1 = turno({ texto: "hola", mensaje: { mid: "s1" }, db: DB, conRed: true, env: { JUNTAR_MENSAJES: "no" } });
  const p2 = turno({ texto: "tienen el poco x8?", mensaje: { mid: "s2" }, db: DB, conRed: true, env: { JUNTAR_MENSAJES: "no" } });
  const [x1, x2] = await Promise.all([p1, p2]);
  hablar();
  comprobar("JUNTAR_MENSAJES = \"no\": dos llamadas", [...x1.alModelo, ...x2.alModelo].filter((m) => !m.redaccion).length, 2);
}

console.log(fallos ? `\n${fallos} FALLOS` : "\nTodo verde");
process.exit(fallos ? 1 : 0);
