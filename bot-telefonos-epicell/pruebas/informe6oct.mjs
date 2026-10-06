// EL INFORME DE ERRORES DE EPICCELL DEL 6-OCT-2026 (16 🔴 en 30 días).
// Cada bloque es un caso del informe y lo que el cliente recibe ahora.
import { turno } from "./banco.mjs";
import { contestarCuotas, equipoDeLaCuenta, nivelDeCashea, nivelDeKrece, planCashea } from "./.stub/cuotas.js";
import { contestaElPrecio } from "./.stub/precio.js";
import { casiElMismo, noEsePeroMira, sinPreciosInventados, PRECIO_A_SECAS } from "./.stub/index.js";

let fallos = 0;
const comprobar = (n, real, esperado = true) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};
const textos = (e) => e.filter((m) => m.text).map((m) => m.text);
const titulos = (e) => e.flatMap((m) => m.attachment?.payload?.elements || []).map((f) => f.title);
const REDMI = { titulo: "Redmi 15c", precioCashea: "182" };

// ── 1. Cashea con su nivel: la cuenta la hace el código ─────────────
{
  comprobar("'estoy en nivel 3' → nivel 3 de Cashea", nivelDeCashea("En cuanto me quedan las cuotas y cuántas son? Cuanto sería la inicial, estoy en nivel 3"), 3);
  comprobar("'platino de krece' → Krece platino", nivelDeKrece("Precio con platino de krece"), "platino");
  comprobar("'el azul' a secas NO es nivel de Krece (puede ser el color)", nivelDeKrece("lo tienes en azul?"), null);
  const p = planCashea(182, 3);
  comprobar("nivel 3 sobre $182: inicial $54.60 y 3 cuotas de $42.47", [p.inicial, p.cuota], [54.6, 42.47]);

  const r = contestarCuotas({ texto: "En cuanto me quedan las cuotas y cuántas son? Cuanto sería la inicial, estoy en nivel 3", equipo: REDMI });
  comprobar("Dorismar: le da la inicial y las cuotas exactas", /Inicial \(30%\): \$54\.60/.test(r?.respuesta) && /3 cuotas de \$42\.47/.test(r?.respuesta));

  const sin = contestarCuotas({ texto: "y con cashea como queda?", equipo: REDMI });
  comprobar("Wendy ('y con cashea cómo queda?'): los 6 niveles con su monto y le pregunta el suyo", (sin?.respuesta.match(/🔹 Nivel \d — inicial \$/g) || []).length === 6 && /¿Cuál es tu nivel\?/.test(sin?.respuesta));

  const antes = contestarCuotas({ texto: "y la inicial?", historial: "Pidió Redmi 15c. Es nivel 2 de Cashea.", equipo: REDMI });
  comprobar("el nivel dicho antes (en el historial) también vale", /nivel 2 de Cashea/.test(antes?.respuesta) && /Inicial \(50%\): \$91\.00/.test(antes?.respuesta));

  const k = contestarCuotas({ texto: "Precio con platino de krece", equipo: { titulo: "Samsung A57", precioCashea: "95" } });
  comprobar("Krece: el % y las cuotas de su nivel, y el monto al asesor (sin inventar)", /15%/.test(k?.respuesta) && /10 cuotas/.test(k?.respuesta) && k?.asesor === true && !/\$/.test(k?.respuesta));

  comprobar("'¿cuánto cuesta?' NO es pedir la cuenta (eso va en la ficha)", contestarCuotas({ texto: "cuánto cuesta?", equipo: REDMI }), null);
  comprobar("en bolívares no se calcula (lo confirma un asesor)", contestarCuotas({ texto: "Cuanto seria el 15% en Bolivares", equipo: REDMI }), null);
  comprobar("con dos equipos distintos delante no se adivina cuál", equipoDeLaCuenta({ productos: [REDMI, { titulo: "Samsung A57" }] }), null);
  comprobar("sin carrusel, el del anuncio", equipoDeLaCuenta({ productoAnuncio: REDMI })?.titulo, "Redmi 15c");
}

// ── 1b. Lo mismo, en el turno completo ──────────────────────────────
{
  const r = await turno({
    texto: "Soy nivel 3 de cashea",
    fila: { historial: "Ya di la bienvenida. Pidió Samsung A57.", ultimos_productos: JSON.stringify(["Samsung A57"]) },
    respuestaDelModelo: { respuesta: "Con nivel 3 en Cashea, tu inicial es del 30%, o sea $28.50 📱 Aquí tienes la ficha 👇", buscar: "NADA" },
  });
  const t = textos(r.enviados).join("\n");
  comprobar("turno: 'Soy nivel 3 de cashea' con el A57 visto → inicial $28.50 y 3 cuotas de $22.17", /Inicial \(30%\): \$28\.50/.test(t) && /3 cuotas de \$22\.17/.test(t), true);
  comprobar("turno: ya no promete una ficha que no va", /Aquí tienes la ficha/.test(t), false);
}

// ── 2. "¿Cuánto cuesta?" y nada más, de alguien nuevo ───────────────
{
  comprobar("'¿Cuánto cuesta?' es preguntar el precio a secas", PRECIO_A_SECAS.test("¿Cuánto cuesta?"));
  comprobar("'¿Cuánto cuesta el A57?' no es a secas", PRECIO_A_SECAS.test("¿Cuánto cuesta el A57?"), false);
  const r = await turno({
    texto: "¿Cuánto cuesta?",
    respuestaDelModelo: { respuesta: "¡Hola Fabian! Soy la asistente virtual de EPICCELL 👋 ¿Qué equipo estás buscando? 😊", buscar: "NADA" },
  });
  const t = textos(r.enviados).join("\n");
  comprobar("contesta a SU pregunta: con gusto el precio, ¿de cuál equipo?", /te digo el precio/.test(t) && /¿De cuál equipo es\?/.test(t));
  comprobar("y conserva el saludo con su nombre", /¡Hola Fabian!/.test(t));
}

// ── 3. Preguntó el precio: se le escribe el de la ficha ─────────────
{
  const una = contestaElPrecio("¡Hola! Aquí tienes el precio del Samsung A57: ¿Cuál de estos te interesa más?", {
    texto: "Buenas tardes que precio sale el Samsumg A 57...por favor",
    fichas: [{ titulo: "Samsung A57", precio: "8/256 · $95" }, { titulo: "Samsung A57", precio: "12/512 · $120" }],
  });
  comprobar("Yris: los dos A57 con su precio, detrás de los dos puntos", /:\n💵 Samsung A57: 8\/256 · \$95\n💵 Samsung A57: 12\/512 · \$120\n¿Cuál/.test(una.respuesta), true);
  comprobar("si ya dice el precio, no se repite", contestaElPrecio("Está en $95 👇", { texto: "precio?", fichas: [{ titulo: "Samsung A57", precio: "$95" }] }).corregido, false);
  comprobar("si no preguntó el precio, no se toca", contestaElPrecio("Mira 👇", { texto: "tienes el A57?", fichas: [{ titulo: "Samsung A57", precio: "$95" }] }).corregido, false);
}

// ── 4. "Redmi 7 pro" y el primero es el "Redmi A7 pro" ──────────────
{
  comprobar("'Redmi 7 pro' ≈ 'Redmi A7 pro'", casiElMismo("Redmi 7 pro", "Redmi A7 pro"));
  comprobar("'Redmi Note 15' NO ≈ 'Redmi Note 17'", casiElMismo("Redmi Note 15", "Redmi Note 17"), false);
  comprobar("'Redmi 7' NO ≈ 'Redmi Note 17 Pro Max'", casiElMismo("Redmi 7", "Redmi Note 17 Pro Max"), false);
  const f = noEsePeroMira("Redmi 7 pro", [{ titulo: "Redmi A7 pro" }, { titulo: "Redmi 15c" }], "Redmi");
  comprobar("le pregunta si es el A7 Pro en vez de decirle que no lo hay", /^¿Te refieres al Redmi A7 pro\?/.test(f), true);
}

// ── 5. Una cifra sin fichas: se quita esa frase, no toda la respuesta ──
{
  const r = sinPreciosInventados("¡Qué lindo detalle! 🎁 El Redmi 15c está en $999. ¿Quieres que te lo aparte?", [], {});
  comprobar("'Es un regalo' ya no recibe 'déjame confirmarte ese precio'", r, "¡Qué lindo detalle! 🎁 ¿Quieres que te lo aparte?");
  comprobar("el precio de lo que ya vio es de verdad (no se borra)", sinPreciosInventados("El Redmi 15c está en $182 🎁", [], { tambien: [{ titulo: "Redmi 15c", precioCashea: "182" }] }), "El Redmi 15c está en $182 🎁");
  comprobar("si no queda nada, la frase del asesor", /asesor/.test(sinPreciosInventados("Está en $999.", [], {})), true);
}

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
