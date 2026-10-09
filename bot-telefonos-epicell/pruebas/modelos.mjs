// ¿ES EL MISMO TELÉFONO, UN PARIENTE, O SOLO LA MISMA MARCA?
//
// El caso real del 29-sep-2026: "¿Tienes redmi 17?" con el Redmi 17
// agotado. El bot contestó "¡Claro! Te muestro los Redmi Note 17", como si
// fueran el mismo. Tocaba decir que el Redmi 17 no está y ofrecer el Note
// 17 como lo que es: un pariente.
import { parentesco, loQuePidioDicho, raizDeLaFamilia, modeloNombrado } from "./.stub/modelo.js";
import { turno } from "./banco.mjs";

let fallos = 0;
const comprobar = (n, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};

const textos = (enviados) => enviados.filter((m) => m.text).map((m) => m.text).join(" ");
const fichas = (enviados) =>
  (enviados.find((m) => m.attachment)?.attachment?.payload?.elements || []).map((e) => e.title);

// ── La comparación ─────────────────────────────────────────────
comprobar("«redmi 17» y Redmi 17: el mismo", parentesco("tienes redmi 17?", "Redmi 17"), "mismo");
comprobar("«redmi 17» y Redmi Note 17: pariente, NO el mismo", parentesco("tienes redmi 17?", "Redmi Note 17"), "familia");
// (7-oct-2026, informe de errores) El Pro es OTRO teléfono: "¿precio del
// redmi note 15?" recibía "¡Aquí lo tienes!" con el Note 15 Pro+.
comprobar("«note 17» y Note 17 Pro: familia (el Pro es otro equipo)", parentesco("tienes el note 17?", "Redmi Note 17 Pro 5G"), "familia");
comprobar("«note 17 pro» y Note 17 Pro: el mismo", parentesco("tienes el note 17 pro?", "Redmi Note 17 Pro 5G"), "mismo");
comprobar("«note 15 pro plus» y Note 15 pro + 5G: el mismo (+ = plus)", parentesco("redmi note 15 pro plus 5g", "Redmi Note 15 pro + 5G"), "mismo");
comprobar("«note 15 pro+» y Note 15 pro + 5G: el mismo", parentesco("redmi note 15 pro+", "Redmi Note 15 pro + 5G"), "mismo");
comprobar("«note 15 pro» y Note 15 pro + 5G: familia (le falta el Plus)", parentesco("redmi note 15 pro 5g", "Redmi Note 15 pro + 5G"), "familia");
comprobar("«redmi 15 C» y Redmi 15c: el mismo (15 C = 15C)", parentesco("cuánto cuesta el redmi 15 C?", "Redmi 15c"), "mismo");
comprobar("«samsumg A 57» y Samsung A57: el mismo (A 57 = A57)", parentesco("precio samsung A 57", "Samsung A57"), "mismo");
comprobar("«note 20» y Note 17: pariente (misma línea)", parentesco("tienen el redmi note 20?", "Redmi Note 17"), "familia");
comprobar("«poco z99» y Poco M8: solo la marca", parentesco("tienes poco z99?", "Poco M8 pro 5G"), "marca");
comprobar("la capacidad no cambia el modelo", parentesco("samsung a57 de 256", "Samsung A57 128GB"), "mismo");
// "5G" y "8/256" no son otro número de modelo (30-sep-2026): con ellos,
// "¿tienes el poco x8 pro 5g?" salía como "no lo tengo" teniéndolo.
comprobar("«poco x8 pro 5g» y Poco X8 pro 5G: el mismo", parentesco("tienes el poco x8 pro 5g?", "Poco X8 pro 5G"), "mismo");
comprobar("«a57 12/512» y Samsung A57: el mismo", parentesco("samsung a57 12/512", "Samsung A57"), "mismo");
comprobar("«x8» no es el M8 aunque los dos sean Poco pro 5G", parentesco("Poco X8 pro 5G 8/256", "Poco M8 pro 5G"), "marca");
comprobar("el nombre sale limpio de un anuncio", modeloNombrado("🔥 Poco X8 pro 5G 8/256 — ¡llévatelo hoy!", "poco"), "Poco X8 Pro 5G");
comprobar("sin el relleno de delante", modeloNombrado("El nuevo Note 17 Pro llegó", "redmi"), "Note 17 Pro");
comprobar("un cargador no es un teléfono con esta forma", parentesco("tienen iphone?", "Apple cargador iphone 20w"), "");

comprobar("se nombra con sus palabras", loQuePidioDicho("tienes el redmi 17?"), "Redmi 17");
comprobar("la familia del Note es toda la línea Note", raizDeLaFamilia("tienen el redmi note 20?", "Redmi Note 17"), "redmi note");

// ── El caso real, de punta a punta ─────────────────────────────
// Redmi 17 AGOTADO: en la hoja solo están los Note 17.
const SIN_REDMI_17 = `Nombre,Precio Divisas ($),Precio Cashea,Cantidad,Foto
Redmi 17,215,268,0,https://x/r17.jpg
Redmi Note 17,250,313,2,https://x/n17.jpg
Redmi Note 17 Pro 5G,345,435,1,https://x/n17p.jpg
Redmi A7 pro,135,170,1,https://x/a7.jpg`;

let r = await turno({
  texto: "Tienes redmi 17?",
  hoja: SIN_REDMI_17,
  respuestaDelModelo: { buscar: "Redmi Note 17", respuesta: "¡Claro! Te muestro los Redmi Note 17 que tengo disponibles 👇" },
  fila: { historial: "Ya di la bienvenida." },
});
let dicho = textos(r.enviados);
comprobar("agotado: NO dice «¡Claro!» como si lo tuviera", /^¡?claro/i.test(dicho.trim()), false);
comprobar("dice que el Redmi 17 no está", /redmi 17/i.test(dicho) && /no (lo )?tengo|no me queda|no est[aá]/i.test(dicho), true);
comprobar("y ofrece el Note 17 nombrándolo", /note 17/i.test(dicho), true);
comprobar("las fichas son los Note 17", fichas(r.enviados).every((t) => /Note 17/.test(t)), true);
comprobar("el Note 17 va primero, no el A7", fichas(r.enviados)[0], "Redmi Note 17");

// Con el Redmi 17 EN LA HOJA: va el Redmi 17, y solo él.
const CON_REDMI_17 = SIN_REDMI_17.replace("Redmi 17,215,268,0", "Redmi 17,215,268,1");
r = await turno({
  texto: "Tienes redmi 17?",
  hoja: CON_REDMI_17,
  respuestaDelModelo: { buscar: "Redmi Note 17", respuesta: "¡Claro! Te muestro los Redmi Note 17 👇" },
  fila: { historial: "Ya di la bienvenida." },
});
comprobar("disponible: le manda EL Redmi 17", fichas(r.enviados), ["Redmi 17"]);
comprobar("y el texto no le habla de los Note", /note/i.test(textos(r.enviados)), false);

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
