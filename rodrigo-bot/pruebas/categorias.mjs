// RODRIGO VENDE SOLO CALZADO (15-oct-2026). La plantilla de El Emperador sabe
// de cinco categorías; aquí queda UNA: calzado. Lo que no es calzado no se
// reconoce como categoría (se busca sin filtro y, si no hay, no hay) y la
// visión lo marca como «otro».

import { prepararSrc, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const C = await src.cargar("categorias.js");

titulo("una sola categoría: calzado");
ok(JSON.stringify(C.NOMBRES) === JSON.stringify(["calzado"]), "NOMBRES es solo calzado", JSON.stringify(C.NOMBRES));
ok(C.esCategoria("calzado") && !C.esCategoria("bolso") && !C.esCategoria("gorra") && !C.esCategoria("camisa"), "bolso, gorra y camisa no son categorías de esta tienda");

titulo("qué pide el cliente, por sus palabras");
for (const [texto, esperada] of [
  ["tienes zapatos casuales?", "calzado"],
  ["quiero unas cholas", "calzado"],
  ["busco tenis nike", "calzado"],
  ["botas de cuero", "calzado"],
  ["tienes bolsos nike?", ""],
  ["gorras new era", ""],
  ["una franela blanca", ""],
  ["tienes nike?", ""],
  ["hola buenas", ""],
]) {
  ok(C.categoriaDelTexto(texto) === esperada, `"${texto}" → ${esperada || "ninguna"}`, C.categoriaDelTexto(texto) || "ninguna");
}

titulo("lo que ve la IA de visión");
ok(C.categoriaDelTipo("calzado") === "calzado", "calzado → calzado");
ok(["gorra", "bolso", "franela", "otro", ""].every((t) => C.categoriaDelTipo(t) === ""), "gorra, bolso, franela y «otro» → ninguna categoría");

titulo("el filtro y el prompt");
const lista = [{ titulo: "Nike Air Force One blanco" }, { titulo: "Puma Suede" }];
ok(C.filtrarPorCategoria(lista, "calzado").length === 2, "sin saber la categoría de cada producto, no se descarta ninguno");
ok(C.filtrarPorCategoria(lista, "bolso").length === 2, "una categoría que no existe no filtra nada");
ok(C.categoriaDeLaBusqueda({ texto: "tienes zapatos?" }) === "calzado" && C.categoriaDeLaBusqueda({ texto: "tienes bolsos?" }) === "", "la búsqueda por texto: zapatos sí, bolsos no");
ok(C.categoriaDeLaBusqueda({ salida: { categoria: "calzado" }, texto: "y en negro?" }) === "calzado", "y lo que dice la IA de texto en «categoria» manda");
const p = C.categoriasParaElPrompt();
ok(/calzado/.test(p) && !/bolso|gorra|camisa|pantal/i.test(p), "el prompt dice que solo vende calzado", p);

terminar();
