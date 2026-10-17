// EL PRECIO YA ESTÁ EN LA FOTO (2-oct-2026). El dueño: "no debe decir
// '¿quieres saber el precio?'; si ya le pregunté si tienen X calzado, en las
// fichas sale el precio. Debe explicar que los precios están en las fotos
// que le envió. No debe preguntar".
//
// Aquí se prueba la red de precio.js y que el prompt lo enseñe.

import { prepararSrc, prompt, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const P = await src.cargar("precio.js");
const log = console.log;
console.log = () => {};

titulo("con las fichas a la vista, NO pregunta por el precio");
for (const malo of [
  "¡Sí tenemos Retro 4! 👟 ¿Quieres saber el precio?",
  "¡Claro! Aquí están 😊 ¿Te gustaría saber cuánto cuestan?",
  "¡Sí tengo! ¿Te paso los precios?",
  "Mira estos modelos 👟 ¿Deseas conocer el precio de alguno?",
  "¡Claro que sí! ¿Quieres que te diga el precio?",
]) {
  const r = P.revisarPrecio(malo, { hayFichas: true });
  ok(r.corregido && !/\?/.test(r.respuesta) && /precios están en cada foto/i.test(r.respuesta), `corrige: "${malo}"`, r.respuesta);
}

titulo("lo útil se queda, y la explicación no se repite");
{
  const r = P.revisarPrecio("¡Sí tenemos Retro 4! 👟 ¿Quieres saber el precio?", { hayFichas: true });
  ok(r.respuesta === "¡Sí tenemos Retro 4! 👟 Los precios están en cada foto 👇", "queda el 'sí tenemos' y se explica dónde está el precio", r.respuesta);
  const s = P.revisarPrecio("¡Aquí las tienes con sus precios 👇 ¿Te paso los precios?", { hayFichas: true });
  ok(s.respuesta === "¡Aquí las tienes con sus precios 👇", "si ya dice 'con sus precios', no se añade otra frase", s.respuesta);
  const t = P.revisarPrecio("¡Sí! Mira estas 👇 ¿Quieres saber el precio?", { hayFichas: true });
  ok(t.respuesta.split("👇").length === 2, "una sola flecha por mensaje", t.respuesta);
}

titulo("si ya las vio (solo texto), le dice que están en las fotos que le mandó");
{
  const r = P.revisarPrecio("¡Claro! ¿Quieres saber el precio?", { yaLasVio: true });
  ok(/fotos que te mandé 👆/.test(r.respuesta), "apunta a las fotos de arriba", r.respuesta);
}

titulo("lo que NO se toca");
for (const [bueno, opciones, que] of [
  ["¿De cuál modelo quieres saber el precio? Dime cuál y te lo muestro 👟", { hayFichas: true }, "preguntar CUÁL zapato"],
  ["¿Te gusta alguno? 😊", { hayFichas: true }, "una pregunta que no es del precio"],
  ["Dime cuál te gustó y te paso el precio 👟", { hayFichas: true }, "una frase sin pregunta"],
  ["¿Quieres saber el precio?", {}, "sin fichas: ahí sí puede preguntar"],
]) {
  ok(!P.revisarPrecio(bueno, opciones).corregido, `pasa ${que}`);
}

titulo("el prompt lo enseña");
const texto = prompt("texto.txt");
ok(/EL PRECIO YA VA EN LAS FOTOS: NO LO OFREZCAS/.test(texto), "texto.txt tiene la regla");
ok(/Los precios están en cada foto 👇/.test(texto), "y el ejemplo de cómo decirlo");

console.log = log;
src.limpiar();
terminar();
