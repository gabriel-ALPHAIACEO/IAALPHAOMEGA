import { buscarProductos } from "./.stub/sheets.js";
import { NO_ESE_PERO_MIRA } from "./.stub/index.js";

const HOJA = `Nombre,Precio Divisas ($),Foto
Samsung Cable Tipo C 1Metro,8,https://x/1.jpg
Samsung Cable Tipo C 2metros,10,https://x/2.jpg
Skydolphing cable 4 en 1 S40E,10,https://x/3.jpg
Skydolphing S13T cable c a c 36w,9,https://x/4.jpg
Skydolphing Sr26 cable lightning,9,https://x/5.jpg
Yookie Cable 2 en 1 CB97,7,https://x/6.jpg
Samsung A57,310,https://x/7.jpg
Poco M8 pro 5G,185,https://x/8.jpg`;

globalThis.fetch = async () => ({ ok: true, text: async () => HOJA, status: 200 });

const env = { SHEET_ID: "abc", SHEET_NOMBRE: "Hoja 1" };

let fallos = 0;
const comprobar = (n, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};
const titulos = async (t) => (await buscarProductos(env, t)).productos.map((p) => p.titulo);

// EL CASO DE LA CAPTURA: "dophin" tiene que encontrar los Skydolphing
const dophin = await titulos("dophin");
comprobar("«dophin» encuentra los Skydolphing", dophin.length, 3);
comprobar("y son los correctos", dophin.every((t) => /Skydolphing/i.test(t)), true);

comprobar("«dolphin» bien escrito también", (await titulos("dolphin")).length, 3);
comprobar("«skydolphing» tal cual, claro", (await titulos("skydolphing")).length, 3);

// Lo que ya funcionaba, que siga
comprobar("«cable» los trae todos", (await titulos("cable")).length, 6);
comprobar("«samsung cable» filtra bien", (await titulos("samsung cable")).length, 2);
comprobar("un modelo concreto", await titulos("Poco M8"), ["Poco M8 pro 5G"]);

// Y que no se vuelva loca: palabras cortas no pescan de más
comprobar("«s40» no trae media tienda", (await titulos("s40")).length <= 1, true);
comprobar("algo que no existe sigue sin existir", await titulos("nokia"), []);
comprobar("«cables dophin» junto: ya encuentra", (await titulos("cables dophin")).length, 3);

// Las frases del rescate por categoría
comprobar("hay frases para «no ese, pero mira»", NO_ESE_PERO_MIRA.length >= 3, true);
comprobar("ninguna promete lo que no hay", NO_ESE_PERO_MIRA.every((f) => !/no tengo ningun|no hay nada/i.test(f)), true);

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
