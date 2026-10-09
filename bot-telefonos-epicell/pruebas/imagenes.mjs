// "LA IA NO ESTÁ ENVIANDO IMÁGENES" (6-oct-2026, EPICCELL): llegaba el
// texto y nada debajo. La IA elegía "solo texto" porque esos equipos ya se
// le habían mostrado alguna vez, aunque el cliente pidiera las fotos o ella
// misma escribiera "mira 👇".
import { turno } from "./banco.mjs";

let fallos = 0;
const comprobar = (n, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};
const textos = (e) => e.filter((m) => m.text).map((m) => m.text);
const titulos = (e) => e.flatMap((m) => m.attachment?.payload?.elements || []).map((f) => f.title);
const YA_LO_VIO = { historial: "Ya di la bienvenida. Pidió Samsung A57. Ya busqué: Samsung A57.", mostrados: JSON.stringify(["Samsung A57"]), ultimos_productos: JSON.stringify(["Samsung A57"]) };

{
  const r = await turno({ texto: "mándame las fotos del A57", fila: YA_LO_VIO, respuestaDelModelo: { respuesta: "¡Claro! Aquí lo tienes", buscar: "Samsung A57", mostrar: "texto" } });
  comprobar("pide las fotos de uno que ya vio y la IA elige 'texto' → las fichas van igual", titulos(r.enviados), ["Samsung A57"]);
}
{
  const r = await turno({ texto: "y el precio?", fila: YA_LO_VIO, respuestaDelModelo: { respuesta: "Mira 👇", buscar: "Samsung A57", mostrar: "texto" } });
  comprobar("la IA escribe 'mira 👇' con 'texto' → las fichas van (lo prometió)", titulos(r.enviados), ["Samsung A57"]);
}
{
  const r = await turno({ texto: "cuánta batería tiene?", fila: YA_LO_VIO, respuestaDelModelo: { respuesta: "El que viste arriba 👇 trae batería de sobra", buscar: "Samsung A57", mostrar: "texto" } });
  comprobar("si la respuesta apunta abajo (👇) a lo que ya vio → las fichas van", titulos(r.enviados).length > 0, true);
}
{
  const r = await turno({ texto: "cuánta batería tiene?", fila: YA_LO_VIO, respuestaDelModelo: { respuesta: "Trae batería de sobra 🔋 Lo tienes en las fotos de arriba", buscar: "Samsung A57", mostrar: "texto" } });
  comprobar("sin pedirlas ni prometerlas, 'solo texto' sigue valiendo (no repite fichas)", titulos(r.enviados), []);
  comprobar("y ninguna flecha 👇 apunta a la nada", textos(r.enviados).some((t) => t.includes("👇")), false);
}

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
