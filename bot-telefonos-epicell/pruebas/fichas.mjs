// "¡AQUÍ LO TIENES! 👇" Y NINGUNA FOTO DEBAJO.
//
// El dueño, 30-sep-2026: "dice que aquí está pero no muestra la imagen".
// Las fichas van en un solo mensaje y Instagram lo rechaza ENTERO si no
// puede descargar la foto de una. Aquí se comprueba el plan B (reenviar
// sin la foto rota) y el plan C (la lista escrita), y que una ficha sin
// foto no lleve un image_url vacío, que Instagram también rechaza.
import { turno } from "./banco.mjs";

let fallos = 0;
const comprobar = (n, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};

const carrusel = (enviados) => enviados.find((m) => m.attachment)?.attachment?.payload?.elements || [];
const textos = (enviados) => enviados.filter((m) => m.text).map((m) => m.text).join("\n");
const pideSamsung = {
  texto: "tienen samsung?",
  fila: { historial: "Ya di la bienvenida." },
  respuestaDelModelo: { buscar: "Samsung", respuesta: "¡Claro que sí! Aquí los tienes 👇" },
};

// ── Todo bien: el carrusel sale tal cual ──────────────────────
let r = await turno({ ...pideSamsung, fotosRotas: [] });
comprobar("con las fotos bien, sale el carrusel", carrusel(r.enviados).length > 0, true);

// ── Una foto rota: sale el carrusel SIN esa foto ──────────────
r = await turno({ ...pideSamsung, fotosRotas: ["https://x/a57.jpg"] });
const elA57 = carrusel(r.enviados).find((e) => e.title === "Samsung A57");
comprobar("con una foto rota, el carrusel sale igual", carrusel(r.enviados).length > 0, true);
comprobar("el A57 va, con su nombre y precio", Boolean(elA57?.subtitle), true);
comprobar("pero sin la foto que no carga", elA57 && "image_url" in elA57, false);
comprobar(
  "las demás llevan su foto",
  carrusel(r.enviados).filter((e) => e.title !== "Samsung A57").every((e) => e.image_url),
  true
);

// ── Nada sale como carrusel: la lista escrita ─────────────────
// (Todas las fotos rotas y además Instagram rechaza el carrusel sin fotos:
// se simula con una hoja cuyas fotos son todas malas.)
r = await turno({
  ...pideSamsung,
  hoja: `Nombre,Precio Divisas ($),Precio Cashea,Foto
Samsung A57,310,95,https://x/rota1.jpg
Samsung A17,180,60,https://x/rota2.jpg`,
  fotosRotas: ["https://x/rota1.jpg", "https://x/rota2.jpg"],
});
comprobar("sin fotos que carguen, el carrusel sale sin fotos", carrusel(r.enviados).length, 2);

// Instagram rechaza el carrusel por otra cosa: va la lista escrita.
r = await turno({ ...pideSamsung, fotosRotas: ["https://x/a57.jpg"], rechazarCarrusel: true });
comprobar("si el carrusel no sale de ninguna forma, no sale", carrusel(r.enviados).length, 0);
comprobar("pero le llega la lista escrita con nombre y precio", /🔹 Samsung A57 — .+/.test(textos(r.enviados)), true);
comprobar("ni un 'aquí lo tienes' solo: el texto va seguido de la lista", r.enviados.length >= 2, true);

// ── Un producto sin foto en la hoja: sin image_url vacío ──────
r = await turno({
  ...pideSamsung,
  hoja: `Nombre,Precio Divisas ($),Precio Cashea,Foto
Samsung A57,310,95,
Samsung A17,180,60,https://x/a17.jpg`,
  fotosRotas: [],
});
const sinFoto = carrusel(r.enviados).find((e) => e.title === "Samsung A57");
comprobar("sin foto en la hoja, la ficha no lleva image_url vacío", sinFoto && "image_url" in sinFoto, false);

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
