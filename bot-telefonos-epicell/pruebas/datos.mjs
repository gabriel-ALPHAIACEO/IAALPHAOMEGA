// Lo que la tienda sabe de sí misma: horarios, envíos, delivery, tasa,
// pagos, empleo y ubicación.
import { turno } from "./banco.mjs";
import { queDatoPide, RESPUESTAS, ubicacionDe } from "./.stub/datos.js";

let fallos = 0;
const comprobar = (n, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};
const textos = (e) => e.filter((m) => m.text).map((m) => m.text);

// ── A quién le toca cada respuesta ─────────────────────────────
comprobar("«a que hora abren?»", queDatoPide("a que hora abren?"), "horarios");
comprobar("«cual es su horario»", queDatoPide("cual es su horario"), "horarios");
comprobar("«donde estan ubicados?»", queDatoPide("donde estan ubicados?"), "ubicacion");
comprobar("«como llego a la tienda»", queDatoPide("como llego a la tienda"), "ubicacion");
comprobar("«hacen envios?»", queDatoPide("hacen envios?"), "envios");
comprobar("«envian por mrw?»", queDatoPide("envian por mrw?"), "envios");
comprobar("«hacen delivery?»", queDatoPide("hacen delivery?"), "delivery");
comprobar("«a que tasa reciben?»", queDatoPide("a que tasa reciben?"), "tasa");
comprobar("«aceptan zelle?»", queDatoPide("aceptan zelle?"), "pagos");
comprobar("«metodos de pago»", queDatoPide("metodos de pago"), "pagos");
comprobar("«estan contratando?»", queDatoPide("estan contratando?"), "trabajo");
comprobar("«busco trabajo, aceptan curriculum?»", queDatoPide("busco trabajo, aceptan curriculum?"), "trabajo");

// Lo que NO es una de estas
comprobar("«tienes el a57?» no es ninguna", queDatoPide("tienes el a57?"), "");
comprobar("«me mandas las fotos?» tampoco", queDatoPide("me mandas las fotos?"), "");
comprobar("las cuotas son de Cashea, no de aquí", queDatoPide("puedo pagar a cuotas con cashea?"), "");
comprobar("«cuanto cuesta?» tampoco", queDatoPide("cuanto cuesta?"), "");

// ── Los textos ─────────────────────────────────────────────────
for (const [tema, texto] of Object.entries(RESPUESTAS)) {
  comprobar(`${tema}: cabe en un mensaje`, [...texto].length <= 1000, true);
}
comprobar("horarios: los tres tramos", /lunes a viernes/i.test(RESPUESTAS.horarios) && /domingos/i.test(RESPUESTAS.horarios) && /feriados/i.test(RESPUESTAS.horarios), true);
comprobar("envíos: ZOOM y MRW", /ZOOM/.test(RESPUESTAS.envios) && /MRW/.test(RESPUESTAS.envios), true);
comprobar("pagos: los nueve métodos", ["Pago Móvil","Transferencia","Punto de venta","Zelle","PayPal","Zinli","Binance","Mercantil Panamá","Banesco Panamá"].every((m) => RESPUESTAS.pagos.includes(m)), true);
comprobar("pagos: no promete pasar los datos él solo", /asesor|en un momento/i.test(RESPUESTAS.pagos), true);

// ── La ubicación, con y sin datos puestos ──────────────────────
const sinPoner = ubicacionDe({ DIRECCION: "PENDIENTE: la direccion completa", MAPS_URL: "PENDIENTE: el enlace de Google Maps" });
comprobar("sin dirección puesta, no la inventa", sinPoner.completa, false);
comprobar("y no manda un botón a ninguna parte", sinPoner.maps, "");

const puesta = ubicacionDe({ DIRECCION: "CC Mercado La Isla, local 5", MAPS_URL: "https://maps.app.goo.gl/abc", FOTO_LOCAL: "https://x/local.jpg" });
comprobar("con dirección, sale escrita", puesta.texto.includes("CC Mercado La Isla, local 5"), true);
comprobar("con su enlace de maps", puesta.maps, "https://maps.app.goo.gl/abc");

// ── El turno completo ──────────────────────────────────────────
let r = await turno({ texto: "a que hora abren?", fila: { historial: "Ya di la bienvenida." } });
comprobar("horarios: contesta él, sin asesor", /9:00am a 7:00pm/.test(textos(r.enviados)[0]), true);
comprobar("y sin pasar por el modelo ni buscar nada", r.enviados.length, 1);

r = await turno({ texto: "hacen delivery?", fila: { historial: "Ya di la bienvenida." } });
comprobar("delivery: contesta y pregunta la zona", /isla de Margarita/i.test(textos(r.enviados)[0]), true);

r = await turno({ texto: "metodos de pago", fila: { historial: "Ya di la bienvenida." } });
comprobar("pagos: manda la lista entera", /Banesco Panamá/.test(textos(r.enviados)[0]), true);

// Mezclada con un equipo: contesta el modelo, y salen las fichas
r = await turno({
  texto: "tienen el Samsung A57 y hacen envios?",
  respuestaDelModelo: { respuesta: "¡Sí hacemos envíos por ZOOM y MRW! 📦 Y mira el A57 👇", buscar: "Samsung A57" },
  fila: { historial: "Ya di la bienvenida." },
});
comprobar("mezclada: el dato NO secuestra la venta", r.enviados.some((m) => m.attachment?.payload?.elements?.length), true);
comprobar("y la respuesta habla de los envíos", /env[ií]os/i.test(textos(r.enviados)[0]), true);

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
