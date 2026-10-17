// LOS RELOJES (6-oct-2026, dueño: "los relojes xiaomi debe reconocerlos,
// mi band y muchos más"). Con los nombres del inventario real.
import { turno } from "./banco.mjs";

let fallos = 0;
const comprobar = (n, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};
const textos = (e) => e.filter((m) => m.text).map((m) => m.text).join(" ");
const titulos = (e) => e.flatMap((m) => m.attachment?.payload?.elements || []).map((f) => f.title);

const HOJA = `Nombre,Cantidad,Precio Cashea,Precio Divisas ($),Foto
Redmi 15c,4,182,145,https://x/2.jpg
Redmi Note 17,1,307,245,https://x/5.jpg
Honor play 10,2,156,125,https://x/28.jpg
Reloj Honor choice watch 2i,3,50,38,https://x/29.jpg
Reloj Xiaomi Mi band 10,2,70,55,https://x/31.jpg
Apple Airpods 4,5,25,20,https://x/96.jpg
Samsung Cargador original 45w Samsung,6,40,30,https://x/36.jpg
Samsung Cargador certificado 45w,5,12,10,https://x/38.jpg`;
const BAND = "Reloj Xiaomi Mi band 10";
const WATCH = "Reloj Honor choice watch 2i";
const pedir = (texto, buscar) => turno({ texto, fila: { historial: "Ya di la bienvenida." }, respuestaDelModelo: { respuesta: "¡Claro! Mira 👇", buscar }, hoja: HOJA });

for (const [texto, buscar, esperado, noDice] of [
  ["tienen relojes xiaomi?", "xiaomi", [BAND], true],
  ["miband 10", "miband 10", [BAND], true],
  ["band 10", "band 10", [BAND], true],
  ["xiaomi smart band 10", "xiaomi smart band 10", [BAND], true],
  ["smartband", "smartband", [BAND], true],
  ["tienen reloj?", "NADA", [WATCH, BAND], true],
  ["smartwatch", "smartwatch", [WATCH, BAND], true],
  ["honor watch", "honor watch", [WATCH], true],
  ["cargador samsung 45w", "cargador samsung 45w", ["Samsung Cargador original 45w Samsung", "Samsung Cargador certificado 45w"], true],
]) {
  const r = await pedir(texto, buscar);
  comprobar(`"${texto}" → ${esperado.join(" + ")}`, titulos(r.enviados), esperado);
  if (noDice) comprobar(`…sin decir que no lo hay`, /no (?:tengo|me queda)/i.test(textos(r.enviados)), false);
}
{
  const r = await pedir("tienen mi band 9?", "mi band 9");
  comprobar("'mi band 9' → 'esa no, pero tengo la 10'", titulos(r.enviados).includes(BAND) && /no me queda|no tengo/i.test(textos(r.enviados)), true);
}
{
  const r = await pedir("apple watch", "apple watch");
  comprobar("'apple watch' → nunca unos AirPods", titulos(r.enviados).includes("Apple Airpods 4"), false);
  comprobar("…y le dice que ese no lo tiene", /no tengo/i.test(textos(r.enviados)), true);
}

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
