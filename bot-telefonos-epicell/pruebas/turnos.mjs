import { turno } from "./banco.mjs";

let fallos = 0;
const comprobar = (n, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};
const textos = (e) => e.filter((m) => m.text).map((m) => m.text);
const fichas = (e) => e.flatMap((m) => m.attachment?.payload?.elements || []);

// ── 1. UN SOLO PRECIO, EL DE CASHEA (5-oct-2026, decisión del dueño) ──
//
// "Precio en divisas?" ya no reenvía las fichas con ese precio: el bot da
// UN precio, el de Cashea, y el de divisas lo confirma un asesor.
let r = await turno({
  texto: "Precio en divisas?",
  fila: { historial: "Pidió Samsung A57.", ultima_respuesta: "Te muestro el Samsung A57 👇", ultimos_productos: JSON.stringify(["Samsung A57"]) },
});
comprobar("divisas: NO reenvía las fichas", fichas(r.enviados).length, 0);
comprobar("lo confirma un asesor", textos(r.enviados).some((t) => /divisas te lo confirma un asesor/i.test(t)), true);
comprobar("y no escribe el precio en divisas ($310)", textos(r.enviados).some((t) => /310/.test(t)), false);

r = await turno({ texto: "y en divisas?", fila: { historial: "Pidió Samsung A57.", ultimos_productos: JSON.stringify(["Samsung A57"]) } });
comprobar("«¿y en divisas?» a secas: también el asesor", /asesor/.test(textos(r.enviados).join(" ")), true);

// "¿Aceptan dólares?" es una forma de pago, no un precio: no va por ahí.
r = await turno({ texto: "aceptan dolares?", respuestaDelModelo: { respuesta: "Eso te lo confirma un asesor en un momento 😊", buscar: "NADA" }, fila: { historial: "Ya di la bienvenida." } });
comprobar("«¿aceptan dólares?» no es pedir el precio en divisas", /precio en divisas/i.test(textos(r.enviados).join(" ")), false);

// ── 2. La ficha lleva UN precio, aunque nombre Cashea ───────────
r = await turno({
  texto: "cuanto es el Poco M8 con cashea?",
  respuestaDelModelo: { respuesta: "¡Claro! Mira 👇", buscar: "Poco M8" },
  fila: { historial: "Ya di la bienvenida." },
});
comprobar("con «Cashea» en el mensaje: un solo precio en la ficha", fichas(r.enviados)[0].subtitle, "$62");

// ── 3. "¿Precio?" de lo que acaba de ver: escrito, sin repetir fotos ─
//
// El dueño: el bot reenviaba las fichas con "el precio lo tengo aquí 👇".
r = await turno({
  texto: "precio?",
  respuestaDelModelo: { respuesta: "¡Claro! El precio lo tengo aquí 👇", buscar: "Samsung A57" },
  fila: { historial: "Pidió Samsung A57.", ultimos_productos: JSON.stringify(["Samsung A57"]), ultimo_envio: Date.now() - 60000 },
});
comprobar("«¿precio?» después de las fichas: NO las reenvía", fichas(r.enviados).length, 0);
comprobar("le escribe el precio (el de Cashea)", /Samsung A57 — \$95/.test(textos(r.enviados).join(" ")), true);
comprobar("un solo precio: no el de divisas", /310/.test(textos(r.enviados).join(" ")), false);
comprobar("sin señalar la imagen", /lo tengo aqu[ií]|en la imagen|en la foto/i.test(textos(r.enviados).join(" ")), false);
comprobar("sin pasar por la IA", r.alModelo.length, 0);

// Si nombra otra cosa, eso se busca.
r = await turno({
  texto: "y el poco m8 cuanto?",
  respuestaDelModelo: { respuesta: "¡Claro! Mira 👇", buscar: "Poco M8" },
  fila: { historial: "Pidió Samsung A57.", ultimos_productos: JSON.stringify(["Samsung A57"]), ultimo_envio: Date.now() - 60000 },
});
comprobar("«¿y el Poco M8 cuánto?»: busca el Poco M8", fichas(r.enviados).map((f) => f.title), ["Poco M8 pro 5G"]);

// Y "¿cuánto es la inicial?" es de Cashea, no pedir el precio otra vez.
r = await turno({
  texto: "cuanto es la inicial?",
  fila: { historial: "Pidió Samsung A57.", ultimos_productos: JSON.stringify(["Samsung A57"]), ultimo_envio: Date.now() - 60000 },
});
comprobar("«¿cuánto es la inicial?» no recita precios", /Samsung A57 — /.test(textos(r.enviados).join(" ")), false);

// ── 4. Si el modelo dice "el precio está en la imagen", se cambia ─
r = await turno({
  texto: "tienes el samsung a57?",
  respuestaDelModelo: { respuesta: "¡Claro! El precio está en la imagen 👇", buscar: "Samsung A57" },
  fila: { historial: "Ya di la bienvenida." },
});
comprobar("«el precio está en la imagen» no le llega", /en la imagen/i.test(textos(r.enviados).join(" ")), false);
comprobar("y las fichas salen igual", fichas(r.enviados).length > 0, true);
comprobar("con un solo precio", fichas(r.enviados)[0].subtitle.includes("·"), false);
comprobar("y las fichas no llevan «Ver producto»", fichas(r.enviados)[0].buttons.map((b) => b.title), ["Comprar"]);
comprobar("no sale el mensaje del catálogo debajo", textos(r.enviados).some((t) => /cat[aá]logo/i.test(t)), false);

// ── 5. La lista, con sus botones ────────────────────────────────
r = await turno({ texto: "mandame la lista de samsung", fila: { historial: "Ya di la bienvenida." } });
const conBotones = r.enviados.find((m) => m.quick_replies);
comprobar("la lista va escrita", textos(r.enviados)[0].includes("🔹 Samsung A57"), true);
comprobar("y pregunta por las imágenes", conBotones.text.includes("las imágenes de esta lista"), true);
comprobar("con los dos botones", conBotones.quick_replies.map((q) => q.title), ["¡Sí, claro!", "No, gracias"]);
comprobar("sin mandar fichas todavía", fichas(r.enviados).length, 0);
comprobar("y guarda lo listado para el «sí»", JSON.parse(r.fila.ultimos_productos), ["Samsung A57", "Samsung A17", "Samsung Cable Tipo C 1Metro"]);

// ── 6. El "sí" de la lista trae las fotos ───────────────────────
r = await turno({
  texto: "¡Sí, claro!", opcion: "LISTA_VER_IMAGENES_SI",
  fila: { historial: "Le mandé la lista de Samsung.", ultima_respuesta: "¿Quieres ver las imágenes de esta lista? 📸", ultimos_productos: JSON.stringify(["Samsung A57", "Samsung A17"]) },
});
comprobar("el sí manda las fichas", fichas(r.enviados).map((f) => f.title), ["Samsung A57", "Samsung A17"]);

// ── 7. El "no" no manda nada más ────────────────────────────────
r = await turno({
  texto: "No, gracias", opcion: "LISTA_VER_IMAGENES_NO",
  fila: { historial: "Le mandé la lista.", ultima_respuesta: "¿Quieres ver las imágenes de esta lista? 📸", ultimos_productos: JSON.stringify(["Samsung A57"]) },
});
comprobar("el no: solo una frase, sin fichas", fichas(r.enviados).length, 0);
comprobar("y no se queda mudo", textos(r.enviados).length, 1);

// ── 8. Las formas de pago, en dos mensajes ──────────────────────
r = await turno({ texto: "puedo pagar a cuotas?", fila: { historial: "Ya di la bienvenida." } });
comprobar("Cashea y Krece van separados", textos(r.enviados).length, 2);
comprobar("primero Cashea", textos(r.enviados)[0].includes("💳 CASHEA"), true);
comprobar("después Krece", textos(r.enviados)[1].includes("💰 KRECE"), true);

// ── 9. El mensaje vacío no se contesta con el historial ─────────
r = await turno({ texto: "", fila: { historial: "Pidió Poco M8." } });
comprobar("mensaje vacío: ni busca ni inventa", fichas(r.enviados).length, 0);
comprobar("y avisa que no le llegó", /no me lleg|no pude abrir|se me trab/i.test(textos(r.enviados)[0]), true);

// ── 10. NUNCA decir "no tengo" de algo que sí está ──────────────
r = await turno({
  texto: "Tienes Poco X8 pro?",
  respuestaDelModelo: {
    respuesta: "No tengo el Poco X8 Pro en este momento 😊 Pero te muestro los equipos de la marca Poco 👇",
    buscar: "Poco",
  },
  fila: { historial: "Ya di la bienvenida." },
});
comprobar("el Poco X8 sale en el carrusel", fichas(r.enviados).some((f) => /X8/i.test(f.title)), true);
comprobar("y el texto ya NO dice que no hay", /no tengo/i.test(textos(r.enviados)[0]), false);
comprobar("dice que sí", /claro|s[ií] lo tengo|por supuesto/i.test(textos(r.enviados)[0]), true);

// Pero si de verdad no está, la frase del modelo se respeta
r = await turno({
  texto: "Tienes Poco Z99 ultra?",
  respuestaDelModelo: {
    respuesta: "Ese no lo manejo 😊 Pero te muestro los Poco que tengo 👇",
    buscar: "Poco",
  },
  fila: { historial: "Ya di la bienvenida." },
});
// Sigue diciendo que ESE no está —no se le promete lo que no hay— pero
// hablando de disponibilidad, no de lo que la tienda vende: EPICELL es una
// tienda de tecnología y consigue lo que le pidan.
comprobar("lo que NO existe se sigue diciendo", /no (lo )?tengo|no me queda|no est[aá] disponible/i.test(textos(r.enviados)[0]), true);
comprobar("pero sin cerrarle la puerta", /no (?:lo |los |las )?(?:vendemos|manejamos|trabajamos)/i.test(textos(r.enviados)[0]), false);
comprobar("y aun así le enseña alternativas", fichas(r.enviados).length > 0, true);

// LA MARCA QUE EL CLIENTE DICE NO ES LA QUE DICE LA HOJA.
// "Xiaomi" no aparece en ningún título: están como Redmi y Poco.
const XIAOMI = `Nombre,Precio Divisas ($),Precio Cashea,Foto
Redmi Note 17 256GB,240,75,https://x/n17.jpg
Redmi Note 14 128GB,190,60,https://x/n14.jpg
Poco X8 pro 5G,210,70,https://x/px8.jpg
Samsung Galaxy A57 128GB,310,95,https://x/a57.jpg`;

r = await turno({
  texto: "tienen xiaomi note?",
  hoja: XIAOMI,
  respuestaDelModelo: { respuesta: "Xiaomi no manejo 😊", buscar: "Xiaomi Note" },
  fila: { historial: "Ya di la bienvenida." },
});
comprobar("«xiaomi note» encuentra los Redmi Note", fichas(r.enviados).filter((f) => /Redmi Note/.test(f.title)).length, 2);
comprobar("y no se cuela el Samsung", fichas(r.enviados).some((f) => /Samsung/.test(f.title)), false);
comprobar("y NO le dice que no maneja Xiaomi", /no manejo/i.test(textos(r.enviados)[0]), false);

// SOLO LO QUE PIDE EL CLIENTE, NI UNA COSA MÁS.
// "Forro para el A57" en una tienda sin forros devolvía el TELÉFONO A57:
// un equipo de $310 a quien quería un forro de ocho.
const CON_ACCESORIOS = `Nombre,Precio Divisas ($),Precio Cashea,Foto
Samsung A57,310,95,https://x/a57.jpg
Cable Tipo C Samsung 1Metro,8,,https://x/c1.jpg
Audifonos Redmi Buds 6,22,,https://x/au.jpg`;

r = await turno({
  texto: "tienen forro para el a57?",
  hoja: CON_ACCESORIOS,
  respuestaDelModelo: { buscar: "Forro Samsung A57" },
  fila: { historial: "Ya di la bienvenida." },
});
comprobar("pide un forro que no hay: NO le manda el teléfono", fichas(r.enviados).length, 0);
comprobar("y se lo dice nombrando lo que pidió", /forros/i.test(textos(r.enviados)[0]), true);

r = await turno({
  texto: "precio del cable tipo c",
  hoja: CON_ACCESORIOS,
  respuestaDelModelo: { buscar: "Cable Tipo C" },
  fila: { historial: "Ya di la bienvenida." },
});
comprobar("pide un cable: le manda el cable", fichas(r.enviados).map((f) => f.title), ["Cable Tipo C Samsung 1Metro"]);

r = await turno({
  texto: "precio del samsung a57",
  hoja: CON_ACCESORIOS,
  respuestaDelModelo: { buscar: "Samsung A57" },
  fila: { historial: "Ya di la bienvenida." },
});
comprobar("pide el equipo: va el equipo, sin accesorios colados", fichas(r.enviados).map((f) => f.title), ["Samsung A57"]);

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
