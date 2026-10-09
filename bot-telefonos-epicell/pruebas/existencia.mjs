// LA COLUMNA "EXISTENCIA" (6-oct-2026, pedido del dueño: "que entienda
// existencia así esté en mayúscula o minúscula, valen por igual").
import { turno } from "./banco.mjs";
import { sinExistencia } from "./.stub/sheets.js";

let fallos = 0;
const comprobar = (n, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};
const titulos = (e) => e.flatMap((m) => m.attachment?.payload?.elements || []).map((f) => f.title);

comprobar("'0', 'NO', 'No', 'no hay', 'AGOTADO', 'Sin existencia' → no hay",
  ["0", "0.0", "NO", "No", "no hay", "NO HAY", "AGOTADO", "Agotada", "Sin existencia", "SIN STOCK"].map(sinExistencia),
  Array(10).fill(true));
comprobar("'3', 'SI', 'Sí', 'si', 'HAY', 'Disponible', vacía → hay",
  ["3", "SI", "Sí", "si", "HAY", "Disponible", "", "1.000"].map(sinExistencia),
  Array(8).fill(false));

const buscar = async (hoja) => {
  const r = await turno({ texto: "samsung", fila: { historial: "Ya di la bienvenida." }, respuestaDelModelo: { respuesta: "Mira 👇", buscar: "Samsung" }, hoja });
  return titulos(r.enviados).sort();
};

for (const encabezado of ["EXISTENCIA", "Existencia", "existencia", "Existencias"]) {
  const hoja = `Nombre,${encabezado},Precio Cashea,Foto
Samsung A57,SI,95,https://x/1.jpg
Samsung A37,no,80,https://x/2.jpg
Samsung A27,AGOTADO,70,https://x/3.jpg
Samsung A17,3,60,https://x/4.jpg
Samsung A07,0,50,https://x/5.jpg
Samsung A99,,40,https://x/6.jpg`;
  comprobar(`columna "${encabezado}": salen solo los que hay`, await buscar(hoja), ["Samsung A17", "Samsung A57", "Samsung A99"]);
}

{
  const hoja = `Nombre,Cantidad,Existencia,Precio Cashea,Foto
Samsung A57,2,Si,95,https://x/1.jpg
Samsung A37,2,NO,80,https://x/2.jpg
Samsung A27,0,SI,70,https://x/3.jpg`;
  comprobar("con 'Cantidad' y 'Existencia' a la vez, cualquiera en 0 o NO lo esconde", await buscar(hoja), ["Samsung A57"]);
}

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
