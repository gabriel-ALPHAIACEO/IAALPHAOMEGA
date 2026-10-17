import { sinListaPegada, fraseSinResultados, hayQueDecirQueHayMas } from "./.stub/index.js";

let fallos = 0;
const comprobar = (n, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};

// El caso de la captura, tal cual
const conLista = "Claro, aquí tienes los cables que tengo disponibles 👇\n\n🔹 Samsung Cable Tipo C 1Metro\n🔹 Samsung Cable Tipo C 2metros\n🔹 Yookie Cable 2 en 1 CB97\n🔹 Aorax M659 cable Usb a c 66w\n\n¿Hay alguno que te interese?";
const limpio = sinListaPegada(conLista);
comprobar("se van los nombres enumerados", /🔹/.test(limpio), false);
comprobar("se queda la frase de arriba", limpio.startsWith("Claro, aquí tienes los cables"), true);
comprobar("y la pregunta del final", limpio.endsWith("¿Hay alguno que te interese?"), true);
comprobar("sin líneas en blanco de más", /\n{3,}/.test(limpio), false);

// Otras formas de enumerar
comprobar("con guiones", /-/.test(sinListaPegada("Tengo estos 👇\n- Cable A\n- Cable B").replace("👇","")), false);
comprobar("numerados", sinListaPegada("Mira 👇\n1) Cable A\n2) Cable B"), "Mira 👇");

// Lo que NO se debe tocar
const normal = "¡Claro que sí! Aquí los tienes 👇";
comprobar("un texto normal no se toca", sinListaPegada(normal), normal);
const unaSola = "Te muestro el Samsung A57 👇\n🔹 Viene con cargador";
comprobar("una sola viñeta no es una lista", sinListaPegada(unaSola), unaSola);
comprobar("texto vacío no revienta", sinListaPegada(""), "");

// Si el mensaje ERA solo la lista, queda una frase que presenta las fotos
comprobar("solo lista → frase de presentación", sinListaPegada("🔹 Cable A\n🔹 Cable B\n🔹 Cable C"), "¡Aquí los tienes! 👇");

// Sin catálogo web, no se manda a nadie al catálogo
const sinWeb = { URL_CATALOGO: "https://CAMBIA-ESTO.com" };
const conWeb = { URL_CATALOGO: "https://epiccell.com" };
comprobar("sin web: no se manda el mensaje de debajo del carrusel", hayQueDecirQueHayMas(sinWeb), false);
comprobar("sin web: tampoco al no encontrar", /cat[aá]logo/i.test(fraseSinResultados(sinWeb)), false);
comprobar("sin web: sigue pasando al asesor", /asesor/i.test(fraseSinResultados(sinWeb)), true);
comprobar("con web: ese mensaje vuelve solo", hayQueDecirQueHayMas(conWeb), true);

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
