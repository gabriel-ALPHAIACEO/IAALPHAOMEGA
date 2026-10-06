// SIGUE EL TEMA (6-oct-2026, dueño: "si le estoy pidiendo relojes y le digo
// '¿y los redmi?', seguimos hablando de los relojes").
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
Samsung A57,1,563,450,https://x/18.jpg
Honor play 10,2,156,125,https://x/28.jpg
Reloj Honor choice watch 2i,3,50,38,https://x/29.jpg
Reloj Xiaomi Mi band 10,2,70,55,https://x/31.jpg
Samsung Cargador original 45w Samsung,6,40,30,https://x/36.jpg
Apple cargador de 20w certificado,3,10,10,https://x/94.jpg`;
const BAND = "Reloj Xiaomi Mi band 10";
const WATCH = "Reloj Honor choice watch 2i";
const RELOJES = JSON.stringify([WATCH, BAND]);
const pedir = (texto, buscar, vistos) =>
  turno({ texto, fila: { historial: "Ya di la bienvenida.", ultimos_productos: vistos, mostrados: vistos }, respuestaDelModelo: { respuesta: "¡Claro! Mira 👇", buscar }, hoja: HOJA });

for (const buscar of ["Redmi", "reloj redmi", "NADA"]) {
  const r = await pedir("y los redmi?", buscar, RELOJES);
  comprobar(`viendo relojes, "¿y los redmi?" (la IA busca "${buscar}") → el reloj Xiaomi, no teléfonos`, titulos(r.enviados), [BAND]);
  comprobar("…y le explica que Redmi es de la casa Xiaomi", /Relojes Redmi como tal no tengo, pero de Xiaomi/.test(textos(r.enviados)), true);
}
{
  const r = await pedir("y los honor?", "Honor", RELOJES);
  comprobar("viendo relojes, '¿y los honor?' → el reloj Honor (no el Honor Play 10)", titulos(r.enviados), [WATCH]);
  comprobar("…sin hablar de 'teléfonos de esa marca'", /tel[eé]fonos/i.test(textos(r.enviados)), false);
}
{
  const r = await pedir("y de samsung?", "Samsung", RELOJES);
  comprobar("viendo relojes, '¿y de samsung?' → 'Relojes Samsung no tengo' + los relojes que hay", /Relojes Samsung no tengo/.test(textos(r.enviados)) && titulos(r.enviados).length === 2, true);
}
{
  const r = await pedir("y de apple?", "Apple", JSON.stringify(["Samsung Cargador original 45w Samsung"]));
  comprobar("viendo cargadores, '¿y de apple?' → cargadores Apple", titulos(r.enviados), ["Apple cargador de 20w certificado"]);
}
{
  const r = await pedir("y los redmi?", "Redmi", JSON.stringify(["Samsung A57"]));
  comprobar("viendo teléfonos, '¿y los redmi?' → teléfonos Redmi (como siempre)", titulos(r.enviados).every((t) => /^Redmi/.test(t)) && titulos(r.enviados).length > 0, true);
}
{
  const r = await pedir("y teléfonos redmi?", "Redmi", RELOJES);
  comprobar("si nombra otra clase ('teléfonos redmi'), cambia de tema", titulos(r.enviados).includes(BAND), false);
}

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
