// EL INFORME DE ERRORES DEL 12-SEP AL 11-OCT: los fallos que se repetían y
// que se arreglan sin pensar (ver src/faltas.js). Cada caso es una frase
// real del informe.

import { prepararSrc, fuente, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const F = await src.cargar("faltas.js");

titulo("la talla");
ok(F.contestaLaTalla("¡Ese mismo lo manejamos! 👟 Es el primero 👇", "Que precio y talla de hombre tienes 12 talla americana").corregido, "\"talla 12 americana\" → se le dice que la confirma un asesor");
ok(F.contestaLaTalla("¡Lo encontré! 😊", "Así no tienen todos en blanco y qué precio ? Talla 9 US").corregido, "\"Talla 9 US\" también");
ok(F.contestaLaTalla("Échale un ojo al catálogo", "Buen dia estos son tallas de niñ@s??").corregido, "\"¿son tallas de niños?\" también");
ok(!F.contestaLaTalla("Esa talla te la confirma un asesor 😊", "tienes talla 40?").corregido, "si ya habló de la talla, no se repite");
ok(!F.contestaLaTalla("Mira 👇", "tienes las TN negras?").corregido, "sin talla en la pregunta, nada");

titulo("no promete lo que no manda");
ok(F.prometeElCatalogo("Aquí tienes todo lo que manejamos 👇 Búscalo con calma y me dices cuál es 👟"), "\"todo lo que manejamos\" → va el botón");
ok(F.prometeElCatalogo("Mientras, aquí tienes el catálogo completo"), "\"catálogo completo\" → va el botón");
const vap = F.sinFotosQueNoHay("Eso te lo confirma un asesor en un momento 😊 Y aquí tienes el precio en dólares de las Vapormax 👇 Los precios están en las fotos que te mandé 👆");
ok(vap.corregido && vap.respuesta === "Eso te lo confirma un asesor en un momento 😊", "sin fotos, se quita \"las fotos que te mandé\"", vap.respuesta);
ok(!F.sinFotosQueNoHay("Los precios están en las fotos que te mandé 👆", { yaLasVio: true }).corregido, "si las vio antes, se deja");

titulo("no niega lo que hay");
const mcq = F.sinNegarLoQueHay("No tengo Alexander McQueen, pero puedo mostrarte algunas opciones más económicas.");
ok(mcq.corregido && !/no tengo/i.test(mcq.respuesta), "\"No tengo Alexander McQueen\" se quita (está en el catálogo)", mcq.respuesta);
ok(!F.sinNegarLoQueHay("No tengo Balenciaga, pero mira estos").corregido, "una marca que no está se deja");
ok(!F.sinNegarLoQueHay("De ese en negro no tengo ahora 😕").corregido, "el aviso de color no se toca");

titulo("está conectado");
const idx = fuente("index.js");
for (const f of ["contestaLaTalla", "prometeElCatalogo", "sinFotosQueNoHay", "sinNegarLoQueHay"]) ok(idx.includes(`${f}(`), `index.js usa ${f}`);
ok(/Con el color en la consulta/.test(idx), "el color se busca otra vez antes de decir que no hay");
ok(!/contestaLosBolivares/.test(idx), "lo de los bolívares ya no está (12-oct, pedido del dueño)");
ok(/calidad 1\.1 top quality/.test(idx), "el revisor sabe que la calidad 1.1 es dato de la tienda");

terminar();
