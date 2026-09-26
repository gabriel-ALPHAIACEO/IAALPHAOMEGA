// LOS RESCATES DE LA BÚSQUEDA, Y EL ORDEN EN QUE VAN.
//
// Cuando la búsqueda exacta no encuentra nada quedan tres salidas: la
// descripción ("una pila para el teléfono"), la capacidad ("de 256") y la
// categoría (partir el término y quedarse con "samsung"). Las tres acaban
// mandando fotos, así que la PRIMERA que acierte decide lo que el cliente
// lee — y ahí estaban dos fallos que le decían "no tengo" a alguien que
// tenía el equipo en la pantalla.
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

const fichas = (enviados) =>
  (enviados.find((m) => m.attachment)?.attachment?.payload?.elements || []).map((e) => e.title);
const textos = (enviados) => enviados.filter((m) => m.text).map((m) => m.text);

// Una hoja con capacidades en los títulos, que es como están en la de verdad.
const CON_CAPACIDADES = `Nombre,Precio Divisas ($),Precio Cashea,Foto
Samsung A57 128GB,310,95,https://x/a57-128.jpg
Samsung A57 512GB,390,120,https://x/a57-512.jpg
Samsung A17 128GB,180,60,https://x/a17.jpg`;

/* ── 1. LA CAPACIDAD VA ANTES QUE LA CATEGORÍA ─────────────────────
   "¿Tienen el A57 de 256?" y 256 no está. Lo que cierra esa venta es
   decirle en qué capacidades SÍ está. Con la categoría primero, el bot
   encontraba "samsung", le mandaba samsungs cualesquiera y le decía "de
   ese no me queda" — con el A57 delante, en 128 y en 512.
   ───────────────────────────────────────────────────────────────── */
let r = await turno({
  texto: "tienen el samsung a57 de 256?",
  hoja: CON_CAPACIDADES,
  respuestaDelModelo: { buscar: "Samsung A57 256GB" },
});

comprobar("pidió 256: le dice en qué capacidades sí está", /128|512/.test(textos(r.enviados).join(" ")), true);
// La frase de la capacidad nombra las DOS cosas: la que pidió y las que
// hay. La de la categoría ("de ese no me queda, mira estos") no nombra
// ninguna, y es la que salía antes.
comprobar("nombra la capacidad que pidió", /256/.test(textos(r.enviados).join(" ")), true);
comprobar("le muestra el A57, no otra cosa", fichas(r.enviados).every((t) => /A57/.test(t)), true);

/* ── 2. NUNCA "NO LO TENGO" DE ALGO QUE ESTÁ EN EL CARRUSEL ────────
   "¿Tienes el Samsung A57 sellado?" no encuentra nada —"sellado" no está
   en ningún título—, lo rescata la palabra "samsung", y el A57 sale como
   primera ficha. Decir ahí "justo ese no lo manejo" es el fallo que ya
   costó una venta.
   ───────────────────────────────────────────────────────────────── */
r = await turno({
  texto: "tienes el samsung a57 sellado?",
  respuestaDelModelo: { buscar: "Samsung A57 sellado", respuesta: "Ese no lo manejo 😊" },
});

comprobar("lo rescató por la marca y el A57 está en el carrusel", fichas(r.enviados).some((t) => /A57/.test(t)), true);
comprobar("así que NO le dice que no lo maneja", /no lo manejo|no me queda|no lo tengo/i.test(textos(r.enviados).join(" ")), false);
comprobar("le dice que sí", /claro|s[ií] lo tengo|por supuesto/i.test(textos(r.enviados).join(" ")), true);

/* ── 3. "¿Y EN DIVISAS?" ES DE LO MISMO; "¿Y LOS CABLES?" NO ───────
   El atajo de divisas vuelve a mandar el último carrusel. Si el cliente
   nombra otra cosa de la hoja, eso ya no es "lo mismo con otro precio":
   es otro producto, y hay que buscarlo.
   ───────────────────────────────────────────────────────────────── */
const yaVioElA57 = {
  historial: "Ya di la bienvenida.",
  ultimos_productos: JSON.stringify(["Samsung A57"]),
  ultima_respuesta: "Aquí lo tienes 👇",
};

r = await turno({ texto: "y en divisas?", fila: yaVioElA57 });
comprobar("«¿y en divisas?»: los mismos equipos otra vez", fichas(r.enviados), ["Samsung A57"]);
comprobar("con el precio en divisas anunciado", /divisa/i.test(textos(r.enviados).join(" ")), true);

r = await turno({
  texto: "y los cables en divisas?",
  fila: yaVioElA57,
  respuestaDelModelo: { buscar: "cable" },
});
comprobar("«¿y los cables en divisas?»: cables, no el Samsung", fichas(r.enviados).some((t) => /cable/i.test(t)), true);
comprobar("y NINGÚN Samsung colado", fichas(r.enviados).some((t) => /Samsung A57/.test(t)), false);

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
