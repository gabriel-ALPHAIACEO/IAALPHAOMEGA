// LA MEMORIA DE LA CONVERSACIÓN (7-oct-2026)
//
// El dueño: "si lo último que hablaron fue de X cosa, que siga hablando de
// eso, no de algo random; que tenga memoria es lo más importante".
//
// Tres cosas:
//   1. La memoria anota QUÉ fichas vio, no solo "Aquí tienes 👇".
//   2. La IA recibe en una línea de qué vienen hablando.
//   3. Se recuerdan 20 intervenciones, no 12.
import { conLasFichas, conLoDicho } from "./.stub/estado.js";
import { contextoParaElModelo } from "./.stub/historial.js";
import { temaDeLaCharla } from "./.stub/index.js";
import { turno } from "./banco.mjs";

let fallos = 0;
const comprobar = (n, real, esperado = true) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};

// ── 1. Las fichas quedan en la memoria ─────────────────────────────
{
  let c = conLoDicho([], "cliente", "tienes samsung?");
  c = conLoDicho(c, "bot", "¡Claro! Aquí tienes 👇");
  c = conLasFichas(c, ["Samsung A57", "Samsung A17"]);
  comprobar("las fichas se pegan a la línea del bot", c[c.length - 1].texto, "¡Claro! Aquí tienes 👇 [le enseñé: Samsung A57, Samsung A17]");
  comprobar("sin añadir otra intervención", c.length, 2);

  const otra = conLasFichas(c, ["Poco M8 pro 5G"]);
  comprobar("unas fichas más sin texto van en su propia línea", otra[otra.length - 1].texto, "[le enseñé: Poco M8 pro 5G]");

  const largo = conLasFichas(conLoDicho([], "bot", "x".repeat(400)), ["Redmi Pad 2"]);
  comprobar("si no cabe, se recorta la frase, no los equipos", /\[le enseñé: Redmi Pad 2\]$/.test(largo[0].texto) && largo[0].texto.length <= 400);
  comprobar("sin fichas no cambia nada", conLasFichas(c, []), c);

  let mucho = [];
  for (let i = 0; i < 30; i++) mucho = conLoDicho(mucho, i % 2 ? "bot" : "cliente", `mensaje ${i}`);
  comprobar("se recuerdan las últimas 20 intervenciones", mucho.length, 20);
}

// ── 2. De qué vienen hablando ──────────────────────────────────────
{
  comprobar("un equipo", temaDeLaCharla([{ titulo: "Samsung A57" }]), "teléfonos (Samsung A57)");
  comprobar("relojes", /^relojes \(/.test(temaDeLaCharla([{ titulo: "Xiaomi Smart Band 9" }, { titulo: "Redmi Watch 5 Active" }])));
  comprobar("nada visto, sin tema", temaDeLaCharla([]), "");

  const con = (extra) => contextoParaElModelo({ historial: "Ya di la bienvenida.", texto: "¿y tiene buena cámara?", tema: "teléfonos (Samsung A57)", ...extra });
  comprobar("la línea va encima de lo que pide ahora", /DE QUÉ VIENEN HABLANDO: teléfonos \(Samsung A57\)[\s\S]*LO QUE PIDE AHORA/.test(con({})));
  comprobar("no si pasó un rato largo (es otra conversación)", /DE QUÉ VIENEN HABLANDO/.test(con({ minutosDesdeElUltimo: 120 })), false);
  comprobar("no si viene de una historia nueva", /DE QUÉ VIENEN HABLANDO/.test(con({ esHistoriaNueva: true })), false);
  comprobar("no si acaba de compartir una publicación", /DE QUÉ VIENEN HABLANDO/.test(con({ esPublicacionNueva: true })), false);
}

// ── 3. El turno completo ───────────────────────────────────────────
{
  const hace = Date.now() - 2 * 60000;
  const charla = [
    { de: "cliente", texto: "tienes el A57?" },
    { de: "bot", texto: "¡Sí! Aquí lo tienes 👇 [le enseñé: Samsung A57]" },
  ];
  const r = await turno({
    texto: "y tiene buena cámara?",
    fila: { historial: "Ya di la bienvenida. Ya busqué: Samsung A57.", ultimos_productos: JSON.stringify(["Samsung A57"]), conversacion: JSON.stringify(charla), ultimo_envio: hace },
    respuestaDelModelo: { buscar: "", respuesta: "¡Sí! El Samsung A57 tiene muy buena cámara 📸" },
  });
  const alModelo = JSON.stringify(r.alModelo[0]?.messages || []);
  comprobar("turno: la IA sabe de qué vienen hablando", /DE QUÉ VIENEN HABLANDO: teléfonos \(Samsung A57\)/.test(alModelo));
  comprobar("turno: y lee qué fichas vio antes", /le enseñé: Samsung A57/.test(alModelo));

  const r2 = await turno({
    texto: "tienes poco?",
    fila: { historial: "Ya di la bienvenida.", ultimo_envio: hace },
    respuestaDelModelo: { buscar: "Poco", respuesta: "¡Claro! Mira los Poco que tengo 👇" },
  });
  const guardada = JSON.parse(r2.fila?.conversacion || "[]");
  comprobar("turno: tras mandar fichas, la memoria dice cuáles fueron", guardada.some((l) => l.de === "bot" && /\[le enseñé: Poco/.test(l.texto)));
}

// ── La nota de la memoria nunca le llega al cliente ────────────────
{
  const r = await turno({
    texto: "y tiene buena cámara?",
    fila: { historial: "Ya di la bienvenida.", ultimos_productos: JSON.stringify(["Samsung A57"]), ultimo_envio: Date.now() - 60000 },
    respuestaDelModelo: { buscar: "", respuesta: "¡Sí! El Samsung A57 tiene muy buena cámara 📸 [le enseñé: Samsung A57]" },
  });
  const dicho = r.enviados.filter((m) => m.text).map((m) => m.text).join(" ");
  comprobar("si la IA copia \"[le enseñé: …]\", se quita antes de mandarlo", /le enseñé/.test(dicho), false);
  comprobar("…y el resto de la respuesta sí sale", /muy buena cámara/.test(dicho));
}

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
