// "AHORA DICE QUE NO HAY Y SÍ HAY REDMI 17 PRO MAX" (6-oct-2026). El
// cliente se come el "Note", y en la hoja hay a la vez un "Redmi 17 4G" y
// un "Redmi Note 17 Pro Max 5G". Con el inventario real del 6-oct.
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
Redmi A7 pro,1,170,135,https://x/1.jpg
Redmi 15c,4,182,145,https://x/2.jpg
Redmi 17 4G,1,268,215,https://x/4.jpg
Redmi Note 17,1,307,245,https://x/5.jpg
Redmi Note 17 Pro 5G,1,435,345,https://x/6.jpg
Redmi Note 17 Pro Max 5G,1,613,490,https://x/7.jpg
Redmi Note 15 pro + 5G,1,560,445,https://x/9.jpg
Xbyte Base para carro  Xb-4978,3,25,20,https://x/68.jpg
xbyte Base para carro XB-4796,3,10,10,https://x/75.jpg
Base Metálica para moto YC28,0,15,10,`;
const pedir = (texto, buscar) => turno({ texto, fila: { historial: "Ya di la bienvenida." }, respuestaDelModelo: { respuesta: "¡Claro! Mira 👇", buscar }, hoja: HOJA });

for (const buscar of ["Redmi 17 Pro Max", "Redmi Note 17 Pro Max"]) {
  const r = await pedir("tienen redmi 17 pro max?", buscar);
  comprobar(`"redmi 17 pro max" (la IA busca "${buscar}") → SOLO el Note 17 Pro Max`, titulos(r.enviados), ["Redmi Note 17 Pro Max 5G"]);
  comprobar("…y no dice que no hay", /no (?:tengo|me queda)/i.test(textos(r.enviados)), false);
}
{
  const r = await pedir("tienen el redmi 17?", "Redmi 17");
  comprobar("'redmi 17' a secas sigue siendo el Redmi 17 4G (no el Note)", titulos(r.enviados), ["Redmi 17 4G"]);
}
{
  const r = await pedir("soporte para moto", "Base para moto");
  comprobar("la de moto con Cantidad 0 → se le dice, y ve las que hay", /para moto no me quedan/.test(textos(r.enviados)) && titulos(r.enviados).length === 2, true);
}

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
