// LA HOJA PASA ENTERA AL INVENTARIO (7-oct-2026, decisión del dueño: "en
// EPICCELL todo pasa, hasta precios y fotos, absolutamente todo").
// También lo agotado y lo inactivo; la misma fila de dos capacidades es un
// modelo con dos variantes; y la cantidad de la hoja es el stock inicial.
// Dos filas iguales (mismo nombre, capacidad y color) son la MISMA variante:
// se suman sus cantidades (antes la segunda se perdía) y el informe lo dice.
import { catalogoParaInventario, juntarParaInventario } from "./.stub/sheets.js";

let fallos = 0;
const comprobar = (n, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};

const HOJA = `Nombre,Marca,Capacidad,Precio Divisas,Precio Bs,Precio Cashea,Cantidad,Activo,Foto,RAM
iPhone 13,Apple,128GB,$420,Bs 15.000,470,3,,https://x/13.jpg,4GB
iPhone 13,Apple,256GB,$480,,530,0,,https://x/13b.jpg,4GB
Samsung A17,Samsung,,$150,,170,SI,no,https://x/a17.jpg,6GB
,,,,,,,,,
iphone 13,Apple,128GB,$420,,470,2,,https://x/13.jpg,4GB`;

const real = globalThis.fetch;
globalThis.fetch = async () => new Response(HOJA, { status: 200 });
const log = console.log;
console.log = () => {};
const items = await catalogoParaInventario({ SHEET_ID: "x", SHEET_NOMBRE: "Hoja 1" });
console.log = log;
globalThis.fetch = real;

comprobar("dos modelos: el iPhone (dos capacidades) y el Samsung", items.map((i) => i.titulo), ["iPhone 13", "Samsung A17"]);
const iphone = items[0];
comprobar("las capacidades son sus variantes, con su precio y su cantidad (también la agotada)",
  iphone.variantes, [
    { opcion: "128GB", color: "", precio: "$420", precio_cashea: "470", precio_local: "Bs 15.000", foto: "https://x/13.jpg", extras: { RAM: "4GB" }, oculta: false, cantidad: 5 },
    { opcion: "256GB", color: "", precio: "$480", precio_cashea: "530", precio_local: "", foto: "https://x/13b.jpg", extras: { RAM: "4GB" }, oculta: false, cantidad: 0 },
  ]);
comprobar("lo inactivo pasa, pero el bot no lo ofrece (oculta)", items[1].variantes[0].oculta, true);
comprobar("la fila repetida del iPhone 13 de 128GB se suma (3 + 2 = 5) y se cuenta", iphone.juntadas, 1);
comprobar("los precios en divisas, Bs y Cashea, y la marca", [iphone.precio, iphone.precio_local, iphone.precio_cashea, iphone.marca], ["$420", "Bs 15.000", "470", "Apple"]);
comprobar("las fotos de las dos filas", iphone.fotos, ["https://x/13.jpg", "https://x/13b.jpg"]);
comprobar("las demás columnas también pasan", iphone.extras.RAM, "4GB");
comprobar("lo inactivo pasa igual, y 'SI' no inventa una cantidad", [items[1].variantes[0].opcion, items[1].variantes[0].cantidad], ["única", null]);

const conColor = juntarParaInventario([
  { titulo: "iPhone 15", capacidad: "128GB", precioDivisas: 800, precioCashea: 900, cantidad: 2, extras: { Color: "Negro" } },
  { titulo: "iPhone 15", capacidad: "128GB", precioDivisas: 800, precioCashea: 900, cantidad: 1, extras: { Color: "Azul" } },
  { titulo: "iPhone 15", capacidad: "128GB", precioDivisas: 800, precioCashea: 900, cantidad: 4, extras: { Color: "negro" } },
]);
comprobar("con columna de color: cada color es su variante, y el mismo color se suma",
  conColor[0].variantes.map((v) => [v.color, v.cantidad]), [["Negro", 6], ["Azul", 1]]);
comprobar("una fila repetida sin cantidad no borra la que había",
  juntarParaInventario([{ titulo: "A", capacidad: "", cantidad: 3, extras: {} }, { titulo: "A", capacidad: "", cantidad: null, extras: {} }])[0].variantes[0].cantidad, 3);

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
