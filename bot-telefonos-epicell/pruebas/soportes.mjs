// LOS SOPORTES PARA CARRO Y MOTO (6-oct-2026, pedido del dueño: "que pueda
// enviar bien los soportes para carros, que los reconozca por marca").
// En la hoja se llaman "Base para carro"; el cliente dice soporte, holder,
// porta celular… Antes una base contaba como TELÉFONO y no salía ninguna.
import { turno } from "./banco.mjs";
import { tipoDelProducto, tipoQuePide, usoQuePide, esDeOtroNegocio } from "./.stub/tipos.js";

let fallos = 0;
const comprobar = (n, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};
const titulos = (e) => e.flatMap((m) => m.attachment?.payload?.elements || []).map((f) => f.title);

const HOJA = `Nombre,Precio Divisas ($),Precio Cashea,Foto
Samsung A57,310,95,https://x/a57.jpg
Xbyte Base para carro  Xb-4978,12,,https://x/b1.jpg
xbyte Base para carro XB-4796,10,,https://x/b2.jpg
xbyte Base para telefono metalica Xb-4797,9,,https://x/b3.jpg
Base Metálica para moto YC28,8,,https://x/b4.jpg
Selfie Stick Yc38,7,,https://x/s.jpg
Samsung Cargador de carro,15,,https://x/c.jpg`;
const CARRO = ["Xbyte Base para carro  Xb-4978", "xbyte Base para carro XB-4796"];

comprobar("una 'Base para carro' es un soporte, no un teléfono", tipoDelProducto("Xbyte Base para carro  Xb-4978"), "soporte");
comprobar("'holder' y 'porta celular' piden un soporte", [tipoQuePide("un holder"), tipoQuePide("porta celular")], ["soporte", "soporte"]);
comprobar("'para la moto' → moto · 'para el carro' → carro", [usoQuePide("soporte para la moto"), usoQuePide("para el carro")], ["moto", "carro"]);
comprobar("'soporte para carro' NO es 'otro negocio' (vehículos)", esDeOtroNegocio("soporte para carro"), "");

for (const [texto, buscar, esperado] of [
  ["tienen soporte para carro?", "soporte para carro", CARRO],
  ["tienen soporte para carro?", "Base para carro", CARRO],
  ["un holder para el carro", "holder", CARRO],
  ["porta celular para el carro", "porta celular carro", CARRO],
  ["soporte para moto", "soporte moto", ["Base Metálica para moto YC28"]],
  ["algo para poner el telefono en la moto", "NADA", ["Base Metálica para moto YC28"]],
  ["soportes xbyte", "xbyte", [...CARRO, "xbyte Base para telefono metalica Xb-4797"]],
  ["soporte x byte para carro", "x byte base para carro", CARRO],
]) {
  const r = await turno({ texto, fila: { historial: "Ya di la bienvenida." }, respuestaDelModelo: { respuesta: "¡Claro! Mira 👇", buscar }, hoja: HOJA });
  comprobar(`"${texto}" (busca "${buscar}") → ${esperado.length} ficha(s)`, titulos(r.enviados), esperado);
}
{
  const r = await turno({ texto: "tienen soportes?", fila: { historial: "Ya di la bienvenida." }, respuestaDelModelo: { respuesta: "¡Claro! Mira 👇", buscar: "soporte" }, hoja: HOJA });
  const t = titulos(r.enviados);
  comprobar("'¿tienen soportes?' a secas → todos los soportes (ningún título dice 'soporte')", t.length === 5 && !t.includes("Samsung A57") && !t.includes("Samsung Cargador de carro"), true);
}
{
  const r = await turno({ texto: "cargador para el carro", fila: { historial: "Ya di la bienvenida." }, respuestaDelModelo: { respuesta: "¡Claro! Mira 👇", buscar: "cargador de carro" }, hoja: HOJA });
  comprobar("y el cargador de carro sigue siendo un cargador", titulos(r.enviados), ["Samsung Cargador de carro"]);
}

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
