// EL COLOR EN EL COTEJO: que el zapato del color correcto llegue al modelo.
//
// QUÉ SE PROTEGE. Medido con el inventario real de Invictus (30-sep-2026):
// el 57% del catálogo comparte título con otro producto —diecisiete "New
// Balance 9060 Dama", uno por color— y el título no dice el color. El
// índice elegía el color leyendo el título, así que entre diecisiete
// títulos idénticos se quedaba con uno cualquiera.
//
//   Antes:   el correcto llegaba al modelo el 18% de las veces
//   Después: el 96%. Los 17 New Balance 9060 Dama, de 0 a 17.
//
// Y una trampa que cuesta dinero: una foto cuyo color no se pudo leer NO
// puede volver a indexarse en cada pasada del cron. Eso sería pagar la
// misma foto cada quince minutos, para siempre.

import { prepararSrc, baseDeMentira, ok, titulo, terminar, fuente } from "./ayuda.mjs";

const src = await prepararSrc();
const I = await src.cargar("indice.js");

const SIN = {
  camaraAireTalon: false, camaraAireCompleta: false, suelaTransparente: false,
  suelaRedondeadaSinAire: false, suelaPlanaPlacaDura: false, muescaLateralArco: false,
  suelaNubesHuecas: false, mallaPlasticaCuadros: false, alasPlasticasCordones: false,
  jumpman: false, swooshGrandeRecto: false, piezaMetalicaOjal: false, tresFranjas: false,
  punteraGamuzaT: false, punteraGomaConcha: false,
};

// ───────────────────────────────────────────────────────────────────────
titulo("puntosDeColor: lo que se VIO manda sobre lo que dice el título");

ok(I.puntosDeColor("New Balance 9060 Dama", "rosado", "rosado") > 0, "mismo color visto → suma");
ok(I.puntosDeColor("New Balance 9060 Dama", "rosado", "gris") < 0, "otro color visto → resta");
ok(I.puntosDeColor("New Balance 9060 Dama", "rosado", "") === 0,
   "sin color guardado y título sin color → neutro, como antes");
ok(I.puntosDeColor("Air Force One Negro", "negro", "") > 0,
   "sin color guardado, el título que sí lo dice sigue sirviendo");
ok(I.puntosDeColor("Air Force One Negro", "blanco", "blanco") > 0,
   "si el título y la foto no coinciden, gana la FOTO");
ok(I.puntosDeColor("New Balance 9060 Dama", "", "rosado") === 0,
   "si no se sabe el color de la foto del cliente, no se ordena por color");

// ───────────────────────────────────────────────────────────────────────
titulo("diecisiete con el mismo título: llega el del color de la foto");

const COLORES = ["negro","blanco","gris","beige","azul","verde","marrón","rojo","rosado",
                 "morado","crema","celeste","amarillo","naranja","dorado","plateado","turquesa"];
const visto = "N grande en el lateral, suela gruesa con cápsulas, malla y gamuza";
const indice = [
  ...COLORES.map((c, i) => ({
    titulo: "New Balance 9060 Dama", imagen: `https://cdn/nb9060-${i}.jpg`,
    precio: "$85,00", url: `/p/nb9060-${i}`, visto, rasgos: { ...SIN }, color: c,
  })),
  // Otros modelos, para que haya competencia de verdad.
  ...["Air Force One", "Retro 4", "Adidas Campus", "On Cloud", "Samba"].map((t, i) => ({
    titulo: t, imagen: `https://cdn/otro-${i}.jpg`, precio: "$60,00", url: `/p/o${i}`,
    visto: `modelo ${t}`, rasgos: { ...SIN, jumpman: i === 1 }, color: COLORES[i],
  })),
];

let llegan = 0;
for (const p of indice.filter((x) => x.titulo === "New Balance 9060 Dama")) {
  const top = I.mejoresPorRasgos(indice, p.rasgos, 8, p.color, p.visto);
  if (top[0]?.imagen === p.imagen) llegan++;
}
ok(llegan === 17, "los 17 colores: cada uno sale PRIMERO cuando la foto es de ese color", `${llegan} de 17`);

const sinColorEnIndice = indice.map((p) => ({ ...p, color: null }));
let antes = 0;
for (const p of indice.filter((x) => x.titulo === "New Balance 9060 Dama")) {
  const top = I.mejoresPorRasgos(sinColorEnIndice, p.rasgos, 8, p.color, p.visto);
  if (top.some((x) => x.imagen === p.imagen)) antes++;
}
ok(antes <= 2, "y sin el color guardado se ve el fallo de antes (1 de 17)", `${antes} de 17`);

// ───────────────────────────────────────────────────────────────────────
titulo("la columna color se crea sola, también en un índice viejo");

const env = baseDeMentira();
// Un índice de antes de hoy: sin columna color.
env.sql.exec(`CREATE TABLE catalogo (imagen TEXT PRIMARY KEY, titulo TEXT, precio TEXT,
  url TEXT, visto TEXT, rasgos TEXT, actualizado INTEGER)`);
for (let i = 0; i < 3; i++) {
  env.sql.prepare("INSERT INTO catalogo VALUES (?,?,?,?,?,?,?)")
    .run(`https://cdn/viejo-${i}.jpg`, "New Balance 9060 Dama", "$85", "/p", visto, "{}", 1);
}

const leido = await I.leerIndice(env.DB);
const columnas = env.sql.prepare("PRAGMA table_info(catalogo)").all().map((c) => c.name);
ok(columnas.includes("color"), "la columna color se añadió sola al índice viejo");
ok(leido.length === 3, "sin perder ni una fila de las que ya había");
ok(leido.every((p) => p.color === null), "y las viejas quedan en NULL: nunca se miraron buscando el color");

// ───────────────────────────────────────────────────────────────────────
titulo("NULL y \"\" no son lo mismo: sin esto, el cron pagaría para siempre");

await I.guardarIndexados(env.DB, [
  { imagen: "https://cdn/viejo-0.jpg", titulo: "New Balance 9060 Dama", visto, rasgos: SIN, color: "rosado" },
  { imagen: "https://cdn/viejo-1.jpg", titulo: "New Balance 9060 Dama", visto, rasgos: SIN, color: "" },
]);
const despues = await I.leerIndice(env.DB);
const de = (i) => despues.find((p) => p.imagen === `https://cdn/viejo-${i}.jpg`);

ok(de(0).color === "rosado", "la que se leyó guarda su color");
ok(de(1).color === "", "la que la IA no se atrevió a nombrar guarda \"\", NO null");
ok(de(2).color === null, "la que todavía no se reindexó sigue en null");

// El mismo criterio que usa indexarTanda para decidir qué falta.
const pendientes = despues.filter((p) => p.color === null).map((p) => p.imagen);
ok(pendientes.length === 1 && pendientes[0].endsWith("viejo-2.jpg"),
   "solo queda pendiente la que NUNCA se miró — la del color ilegible no vuelve",
   pendientes.join(", "));
ok(/indice\.filter\(\(p\) => p\.color !== null && p\.modelo !== null\)/.test(fuente("indice.js")),
   "y indexarTanda usa exactamente ese criterio (y lo mismo con el modelo, desde el 6-oct)");

// Guardar sin color no puede dejar un null: se volvería a indexar en bucle.
await I.guardarIndexados(env.DB, [
  { imagen: "https://cdn/viejo-2.jpg", titulo: "New Balance 9060 Dama", visto, rasgos: SIN },
]);
const tras = (await I.leerIndice(env.DB)).find((p) => p.imagen.endsWith("viejo-2.jpg"));
ok(tras.color === "", "una fila recién indexada NUNCA queda en null, aunque no traiga color");

// ───────────────────────────────────────────────────────────────────────
titulo("refrescar precios no borra el color");

const refresco = fuente("indice.js").match(/UPDATE catalogo SET [^"]+/)?.[0] || "";
ok(refresco.length > 0, "encontré el UPDATE que refresca precios");
ok(!/color/.test(refresco) && !/INSERT OR REPLACE/.test(refresco),
   "solo toca precio, url y título: si pisara el color, TODO el catálogo se reindexaría cada pasada");

// ───────────────────────────────────────────────────────────────────────
titulo("lo que ve el cliente: el del color de la foto va primero");

// Módulo nuevo para una base nueva: asegurarIndice() recuerda en memoria
// que la tabla ya existe —en producción hay UNA base por Worker y está
// bien—, así que con el mismo módulo esta segunda base nunca tendría tabla.
const src2 = await prepararSrc();
const I2 = await src2.cargar("indice.js");
const C = await src2.cargar("cotejo.js");
const envO = baseDeMentira();
await I2.guardarIndexados(envO.DB, indice);
// Así llegan de Shopify: mismo título, en el orden que le dé la gana.
const deShopify = indice
  .filter((p) => p.titulo === "New Balance 9060 Dama")
  .map(({ titulo, imagen, precio, url }) => ({ titulo, imagen, precio, url }));

const ordenados = await C.ordenarPorLaFoto(envO, deShopify, { color: "rosado", rasgos: SIN, visto });
const rosado = indice.find((p) => p.color === "rosado" && p.titulo === "New Balance 9060 Dama");
ok(ordenados[0].imagen === rosado.imagen, "con la foto rosada, el rosado sale primero en el carrusel");

const gris = await C.ordenarPorLaFoto(envO, deShopify, { color: "gris", rasgos: SIN, visto });
ok(gris[0].imagen === indice.find((p) => p.color === "gris").imagen, "y con la gris, el gris");

// ───────────────────────────────────────────────────────────────────────
titulo("ordenar ANTES de colapsar por título");

const cot = fuente("cotejo.js");
ok(/const pila = unir\(ordenar\(\[\.\.\.porRasgos, \.\.\.productos\]/.test(cot),
   "la pila se ordena y DESPUÉS se queda con uno por título");
ok(!/ordenar\(unir\(/.test(cot),
   "y no queda ningún sitio donde se colapse antes de ordenar");

// ───────────────────────────────────────────────────────────────────────
titulo("el PRIMER color del título es el del zapato (caso Uplift, 30-sep)");

const UPLIFT = ["Nike uplift azul dama", "Nike uplift blanco dama", "Nike uplift blanco negro caballero",
  "Nike uplift blanco negro det morado dama", "Nike uplift negro blanco caballero", "Nike uplift negro gris caballero",
  "Nike uplift negro rosado dama", "Nike uplift todo blanco caballero/dama"];
const porColor = (color) => [...UPLIFT].sort((a, b) => I.puntosDeColor(b, color) - I.puntosDeColor(a, color));
const negros = porColor("negro");
ok(negros.slice(0, 3).every((t) => /uplift negro/.test(t)), "foto negra: primero los que son NEGROS de cuerpo", negros.slice(0, 3).join(" · "));
ok(negros.indexOf("Nike uplift blanco negro det morado dama") > 2, "el 'blanco negro det morado' (blanco con detalles) ya no va primero");
ok(/uplift blanco/.test(porColor("blanco")[0]), "foto blanca: primero uno blanco");
ok(I.puntosDeColor("Nike uplift blanco negro caballero", "negro") > 0, "el color de detalle sigue sumando algo (mejor que otro color)");
ok(I.puntosDeColor("Nike uplift blanco negro caballero", "negro", "blanco") < 0,
   "y cuando el índice YA guardó el color de la foto, manda ese (blanco ≠ negro)");

src.limpiar();
src2.limpiar();
terminar();
