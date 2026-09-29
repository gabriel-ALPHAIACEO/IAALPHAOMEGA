// LA MEMORIA DE LA CONVERSACIÓN.
//
// Hasta el 29-sep-2026 la memoria del bot era el "historial": un RESUMEN de
// 200 caracteres que escribía el propio modelo. Con eso se perdía todo lo
// que hace que una venta avance —para quién es el equipo, cuánto quiere
// gastar, qué ya descartó— y el bot volvía a preguntar lo que el cliente
// acababa de responder.
//
// Ahora se guarda lo que de verdad se dijeron, turno por turno, y eso es lo
// que viaja al modelo en cada mensaje.
import { turno } from "./banco.mjs";
import { contextoParaElModelo } from "./.stub/historial.js";
import { conLoDicho } from "./.stub/estado.js";

let fallos = 0;
const comprobar = (n, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};

// ── Lo que se guarda ───────────────────────────────────────────
let conversacion = [];
conversacion = conLoDicho(conversacion, "cliente", "hola");
conversacion = conLoDicho(conversacion, "bot", "¡Hola! ¿Qué buscas?");
comprobar("guarda quién dijo cada cosa", conversacion, [
  { de: "cliente", texto: "hola" },
  { de: "bot", texto: "¡Hola! ¿Qué buscas?" },
]);

comprobar("un vacío no ensucia la conversación", conLoDicho(conversacion, "cliente", "   ").length, 2);
comprobar(
  "el mismo mensaje dos veces (reintento de Meta) no se duplica",
  conLoDicho(conversacion, "bot", "¡Hola! ¿Qué buscas?").length,
  2
);

// Se queda con los últimos turnos, no crece para siempre.
let larga = [];
for (let i = 0; i < 40; i++) larga = conLoDicho(larga, i % 2 ? "bot" : "cliente", `mensaje ${i}`);
comprobar("no crece sin límite", larga.length <= 12, true);
comprobar("y lo que queda es lo ÚLTIMO", larga[larga.length - 1].texto, "mensaje 39");

// ── Lo que recibe el modelo ────────────────────────────────────
const entrada = contextoParaElModelo({
  nombre: "Ana",
  historial: "Ya di la bienvenida.",
  texto: "y de 256?",
  conversacion: [
    { de: "cliente", texto: "busco un telefono para mi mama" },
    { de: "bot", texto: "¿Tienes un presupuesto?" },
    { de: "cliente", texto: "como 150 dolares" },
  ],
});

comprobar("el modelo recibe la conversación", /LA CONVERSACIÓN, TAL COMO PASÓ/.test(entrada), true);
comprobar("con lo que dijo el cliente", /Cliente: como 150 dolares/.test(entrada), true);
comprobar("y con lo que contestó el bot", /Tú: ¿Tienes un presupuesto\?/.test(entrada), true);
comprobar("en orden, de arriba abajo", entrada.indexOf("mi mama") < entrada.indexOf("150 dolares"), true);
comprobar("se le dice que la lea entera", /L[eé]ela entera antes de contestar/.test(entrada), true);
comprobar("y el mensaje de ahora sigue aparte", /Cliente: y de 256\?/.test(entrada), true);

// Sin conversación guardada (un cliente nuevo) no aparece el bloque.
const primera = contextoParaElModelo({ nombre: "", historial: "", texto: "hola" });
comprobar("un cliente nuevo no trae conversación", /LA CONVERSACIÓN/.test(primera), false);

// ── El turno completo, de punta a punta ────────────────────────
let fila = {};
const decir = async (texto, respuesta) => {
  const r = await turno({ texto, fila, respuestaDelModelo: { respuesta, buscar: "NADA", historial: "Ya di la bienvenida." } });
  fila = { ...r.fila };
  return r;
};

await decir("hola", "¡Hola! ¿Qué equipo buscas?");
await decir("uno para mi mama, como de 150", "¿Te muestro opciones en ese rango?");
await decir("si por favor", "¡Claro! Te muestro 👇");

const guardada = JSON.parse(fila.conversacion);
comprobar("el turno completo lo va anotando", guardada.length, 6);
comprobar("se acuerda de para quién es", guardada.some((t) => /mi mama/.test(t.texto)), true);
comprobar("y de cuánto quería gastar", guardada.some((t) => /150/.test(t.texto)), true);

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
