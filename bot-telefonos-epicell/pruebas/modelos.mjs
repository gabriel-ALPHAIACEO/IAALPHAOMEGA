// ¿ES EL MISMO TELÉFONO, UN PARIENTE, O SOLO LA MISMA MARCA?
//
// El caso real del 29-sep-2026: "¿Tienes redmi 17?" con el Redmi 17
// agotado. El bot contestó "¡Claro! Te muestro los Redmi Note 17", como si
// fueran el mismo. Tocaba decir que el Redmi 17 no está y ofrecer el Note
// 17 como lo que es: un pariente.
import { parentesco, loQuePidioDicho, raizDeLaFamilia } from "./.stub/modelo.js";
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
comprobar("«note 17» y Note 17 Pro: el mismo (Pro es una versión)", parentesco("tienes el note 17?", "Redmi Note 17 Pro 5G"), "mismo");
comprobar("«note 20» y Note 17: pariente (misma línea)", parentesco("tienen el redmi note 20?", "Redmi Note 17"), "familia");
comprobar("«poco z99» y Poco M8: solo la marca", parentesco("tienes poco z99?", "Poco M8 pro 5G"), "marca");
comprobar("la capacidad no cambia el modelo", parentesco("samsung a57 de 256", "Samsung A57 128GB"), "mismo");
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
