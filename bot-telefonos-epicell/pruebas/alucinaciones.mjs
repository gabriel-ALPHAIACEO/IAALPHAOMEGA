// LO QUE EL MODELO NO PUEDE SABER, NO LLEGA AL CLIENTE.
//
// El modelo NUNCA ve un precio: la hoja le manda el título y la capacidad,
// nada más (listaDeTitulos en sheets.js). Así que toda cifra de dinero que
// escriba está inventada. El prompt se lo prohíbe desde siempre; esto es lo
// que lo garantiza cuando se lo salta.
import { turno } from "./banco.mjs";

let fallos = 0;
function comprobar(que, obtenido, esperado) {
  const bien = JSON.stringify(obtenido) === JSON.stringify(esperado);
  if (!bien) {
    fallos++;
    console.log(`✗ ${que}\n   esperaba: ${JSON.stringify(esperado)}\n   recibí:   ${JSON.stringify(obtenido)}`);
  } else {
    console.log(`✓ ${que}`);
  }
}

const textos = (enviados) => enviados.filter((m) => m.text).map((m) => m.text).join("\n");
const fichas = (enviados) =>
  (enviados.find((m) => m.attachment)?.attachment?.payload?.elements || []).map((e) => e.title);

const yaSeConocen = { historial: "Ya di la bienvenida." };

// ── Un precio inventado, con fichas debajo ─────────────────────
// La hoja dice que el Samsung A57 está en 95 (Cashea) y 310 (divisas).
let r = await turno({
  texto: "cuanto cuesta el samsung a57?",
  respuestaDelModelo: {
    respuesta: "El Samsung A57 está en $180 😊",
    buscar: "Samsung A57",
  },
  fila: yaSeConocen,
});

comprobar("la cifra inventada NO se le manda", /180/.test(textos(r.enviados)), false);
comprobar("pero las fichas sí van, con el precio de verdad", fichas(r.enviados), ["Samsung A57"]);
comprobar("y se le dice que ahí están los precios", /precios/i.test(textos(r.enviados)), true);

// ── El precio correcto SÍ se respeta ───────────────────────────
r = await turno({
  texto: "cuanto cuesta el samsung a57?",
  respuestaDelModelo: {
    respuesta: "El Samsung A57 te queda en $95 con Cashea 😊",
    buscar: "Samsung A57",
  },
  fila: yaSeConocen,
});
comprobar("un precio que SÍ es el de la hoja se queda", /95/.test(textos(r.enviados)), true);

// ── Sin fichas que mandar, va al asesor ────────────────────────
r = await turno({
  texto: "cuanto cuesta el nokia 3310?",
  respuestaDelModelo: { respuesta: "Ese te sale en 45 dolares 😊", buscar: "Nokia 3310" },
  fila: yaSeConocen,
});
comprobar("sin fichas, la cifra inventada tampoco sale", /45/.test(textos(r.enviados)), false);
comprobar("y se lo pasa a un asesor", /asesor/i.test(textos(r.enviados)), true);

// ── Las otras formas de escribir dinero ────────────────────────
for (const dicho of ["Te queda en 250 dólares", "Son 250$ nada más", "Está en Bs 250", "Vale 250 usd"]) {
  r = await turno({
    texto: "precio del a57?",
    respuestaDelModelo: { respuesta: dicho, buscar: "Samsung A57" },
    fila: yaSeConocen,
  });
  comprobar(`«${dicho}» no llega`, /250/.test(textos(r.enviados)), false);
}

// ── Un porcentaje NO es un precio (la tabla de Cashea) ─────────
r = await turno({
  texto: "tienen cashea?",
  respuestaDelModelo: {
    respuesta: "¡Sí! Con nivel 4 la inicial es el 25% del precio 👌",
    buscar: "NADA",
  },
  fila: yaSeConocen,
});
comprobar("el 25% de Cashea se respeta", /25%/.test(textos(r.enviados)), true);

// ── Y en el historial tampoco se guarda una cifra ──────────────
r = await turno({
  texto: "cuanto cuesta el samsung a57?",
  respuestaDelModelo: {
    respuesta: "Te muestro los precios 👇",
    buscar: "Samsung A57",
    historial: "Pidió el Samsung A57. Le dije que cuesta $180.",
  },
  fila: yaSeConocen,
});
comprobar("el historial no se queda con la cifra", /180/.test(r.fila.historial || ""), false);

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
