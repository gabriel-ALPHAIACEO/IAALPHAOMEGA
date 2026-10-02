// TODO TIPO DE CLIENTES (2-oct-2026): el bot entiende al que escribe mal, le
// tiene paciencia al que no entiende, y NUNCA le contesta mal al grosero.
//
// Aquí se prueba la red de tono.js (lo que la IA escribió, antes de salir)
// y que el prompt tenga la sección que lo enseña.

import { prepararSrc, prompt, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const T = await src.cargar("tono.js");
const err = console.error;
console.error = () => {};

titulo("lo que la IA NUNCA puede mandar: groserías, insultos, regaños");
for (const [malo, que] of [
  ["Verga, tienes razón. Mira estos iPhone 👇", "una grosería (aunque el cliente la usó)"],
  ["No seas bruto, ya te mostré los Samsung 📱", "un insulto"],
  ["Como ya te dije, la talla la confirma un asesor 😊", "un regaño"],
  ["Lee bien el mensaje anterior. Ahí están los precios", "un regaño"],
  ["Así no se habla. ¿Qué modelo buscas?", "un sermón"],
  ["No entiendo tu mensaje, ¿puedes escribirlo mejor?", "un 'no entiendo'"],
]) {
  const r = T.revisarTono(malo);
  ok(r.corregido && !/verga|bruto|como ya te dije|lee bien|así no se habla|no entiendo/i.test(r.respuesta), `atrapa ${que}`, r.respuesta);
}

titulo("lo que queda después de quitarlo sigue vendiendo");
{
  const r = T.revisarTono("Verga, tienes razón. Mira estos iPhone 👇");
  ok(/Mira estos iPhone/.test(r.respuesta), "se borra solo la frase mala; lo útil se queda", r.respuesta);
  const s = T.revisarTono("No entiendo tu mensaje.");
  ok(s.respuesta === T.AYUDA_NEUTRA, "un 'no entiendo' a secas se cambia por una pregunta que ayuda", s.respuesta);
}

titulo("lo bueno pasa sin tocar");
for (const bueno of [
  "¡Aquí estoy! 😊 Sí tengo iPhone 15, mira 👇",
  "Lamento eso 🙏 Un asesor te escribe en un momento para resolverlo",
  "Aquí estoy para ayudarte cuando quieras 😊",
  "¿Te refieres al iPhone 15 Pro? 📱",
  "¡Claro! Te las muestro otra vez, mira 👇",
  "Precio especial en Samsung esta semana 🔥",
]) {
  ok(!T.revisarTono(bueno).corregido, `pasa: "${bueno}"`);
}

titulo("el prompt lo enseña");
const texto = prompt("texto.txt");
ok(/TODO TIPO DE CLIENTES/.test(texto), "texto.txt tiene la sección TODO TIPO DE CLIENTES");
ok(/aifon · ayfon/.test(texto) && /NUNCA le corrijas la ortografía/.test(texto), "el que escribe mal: se le entiende y no se le corrige");
ok(/UNA sola pregunta/.test(texto) && /como te dije/.test(texto), "el que no entiende: frases cortas, sin 'como te dije'");
ok(/Ignora el insulto/.test(texto) && /NO son insultos sino cariño/.test(texto), "el grosero: se ignora el insulto; y las palabras fuertes venezolanas no siempre son insulto");
ok(!/andas buscando/i.test(texto), "español neutro: '¿Qué estás buscando?', nunca '¿Qué andas buscando?'");

console.error = err;
src.limpiar();
terminar();
