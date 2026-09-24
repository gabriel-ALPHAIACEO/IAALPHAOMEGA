import { PAGOS_CASHEA, PAGOS_KRECE } from "./.stub/index.js";

let fallos = 0;
const comprobar = (n, real, esperado = true) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n} (real: ${JSON.stringify(real)})`); }
  else console.log(`✓ ${n}`);
};

for (const [nombre, texto] of [["Cashea", PAGOS_CASHEA], ["Krece", PAGOS_KRECE]]) {
  comprobar(`${nombre}: cabe en un mensaje de Instagram`, [...texto].length <= 1000);
  comprobar(`${nombre}: tiene bloques separados por una línea en blanco`, texto.includes("\n\n"));
  comprobar(`${nombre}: ninguna línea va sangrada con espacios`, texto.split("\n").every((l) => !l.startsWith(" ")));
  comprobar(`${nombre}: cada nivel en su propia línea`, texto.split("\n").filter((l) => /—/.test(l)).length >= 4);
  comprobar(`${nombre}: cada nivel empieza con un emoji`, texto.split("\n").filter((l) => /—/.test(l)).every((l) => /^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(l)));
}

comprobar("Cashea: los 6 niveles", PAGOS_CASHEA.match(/Nivel \d/g)?.length, 6);
comprobar("Cashea: dice 3 cuotas y 14 días", /3 cuotas/.test(PAGOS_CASHEA) && /14 días/.test(PAGOS_CASHEA));
comprobar("Krece: los 4 niveles por color", ["Azul","Plata","Oro","Platino"].every((n) => PAGOS_KRECE.includes(n)));
comprobar("Krece: cierra preguntando", /¿Con cuál/.test(PAGOS_KRECE));
comprobar("no se cruzan las dos plataformas", !PAGOS_CASHEA.includes("Krece") && !PAGOS_KRECE.includes("Nivel 1"));

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
