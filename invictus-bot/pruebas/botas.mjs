// BOTAS: TÁCTICAS O DE BÁSQUET.
//
// QUÉ SE PROTEGE. Caso real del 30-sep-2026: el cliente pidió botas de
// básquet, el bot buscó "bota táctica" y el cliente tuvo que escribir
// "Botas de basquet no de policía". En el catálogo "bota" solo es la
// táctica; lo de básquet son modelos de jugadores (Lebron, Kyrie...).

import { prepararSrc, prompt, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const { corregirBusquedaDeBotas: corregir } = await src.cargar("catalogo.js");

titulo("el caso real");

const real = corregir("Botas de basquet no de policía", "bota táctica");
ok(real.corregido && real.buscar === "Lebron", '"Botas de basquet no de policía" + "bota táctica" → Lebron', real.buscar);
ok(/básquet/.test(real.respuesta), "y la frase dice básquet, no tácticas", real.respuesta);

titulo("básquet: nunca las tácticas");

for (const [texto, buscar] of [
  ["tienes botas de basket?", "bota"],
  ["zapatos de baloncesto", "basquet"],
  ["quiero unas para jugar básquet", "táctica"],
  ["botas de básquet", "botas"],
]) {
  const r = corregir(texto, buscar);
  ok(r.corregido && r.buscar === "Lebron", `"${texto}" con buscar "${buscar}" → Lebron`, r.buscar);
}

ok(!corregir("botas de basket", "Irving").corregido, 'si ya busca un modelo de básquet ("Irving"), no se toca');
ok(!corregir("botas de basket", "NADA").corregido, "si el modelo no buscó nada (está preguntando), no se fuerza");

const otra = corregir("y otras de basket?", "bota", "Pidió básquet. Ya busqué: Lebron.");
ok(otra.buscar === "Irving", "si ya buscó Lebron, la siguiente vez ofrece Irving", otra.buscar);

titulo("tácticas: las tácticas");

const t1 = corregir("botas militares", "botas");
ok(t1.corregido && t1.buscar === "táctica", '"botas militares" con buscar "botas" → táctica', t1.buscar);
ok(!corregir("botas tácticas", "táctica").corregido, "si ya busca táctica, no se toca");
ok(!corregir("botas de policía", "Air Force One").corregido, "un modelo concreto que eligió el modelo no se pisa");

titulo("lo que no es de botas no se toca");

for (const [texto, buscar] of [["tienes jordan 4?", "Retro 4"], ["hola", "NADA"], ["on cloud bota", "Cloud"]]) {
  ok(!corregir(texto, buscar).corregido, `"${texto}" → sin cambios`);
}

titulo("el prompt lo explica");

const texto = prompt("texto.txt");
ok(/BOTAS: TÁCTICAS O DE BÁSQUET/.test(texto), "texto.txt tiene la regla de las botas");
ok(/NUNCA busques "táctica" ni "bota" cuando el cliente dijo básquet/.test(texto), "y la prohibición escrita");

src.limpiar();
terminar();
