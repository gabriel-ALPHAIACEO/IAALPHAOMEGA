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

/* ── LAS MARCAS Y LAS FAMILIAS ─────────────────────────────────────
   En la hoja los Xiaomi están como "Redmi" y "Poco": la palabra "Xiaomi"
   no aparece en ningún título. El cliente pregunta por la marca con la
   que le vendieron el teléfono y recibía "no tengo ninguno".
   ───────────────────────────────────────────────────────────────── */
const XIAOMI = `Nombre,Precio Divisas ($),Foto
Redmi Note 17 256GB,240,https://x/a.jpg
Redmi Note 17 Pro 512GB,300,https://x/b.jpg
Redmi Note 14 128GB,190,https://x/c.jpg
Redmi A5 64GB,90,https://x/d.jpg
Poco X8 pro 5G,210,https://x/e.jpg
Samsung Galaxy A57 128GB,310,https://x/f.jpg
Infinix Note 40,150,https://x/g.jpg
Forro Redmi Note 17,8,https://x/h.jpg`;

globalThis.fetch = async () => ({ ok: true, text: async () => XIAOMI, status: 200 });
// Cada búsqueda con su propio id: la hoja se cachea por SHEET_ID.
let cuantas = 0;
const enXiaomi = async (t) =>
  (await buscarProductos({ SHEET_ID: `xiaomi${++cuantas}`, SHEET_NOMBRE: "Hoja 1" }, t)).productos.map(
    (p) => p.titulo
  );

const xiaomi = await enXiaomi("xiaomi");
comprobar("«xiaomi» encuentra los Redmi y los Poco", xiaomi.length > 0, true);
comprobar("y NO se cuela un Samsung", xiaomi.some((t) => /Samsung/.test(t)), false);

const xiaomiNote = await enXiaomi("xiaomi note");
comprobar("«xiaomi note» trae la familia Note entera", xiaomiNote.filter((t) => /Redmi Note/.test(t)).length, 3);
comprobar("y NO el Note de otra marca", xiaomiNote.some((t) => /Infinix/.test(t)), false);
// Preguntó por teléfonos, no por forros: el accesorio se aparta.
comprobar("ni el forro, que no es lo que preguntó", xiaomiNote.some((t) => /Forro/.test(t)), false);

comprobar("«celulares note» también encuentra", (await enXiaomi("celulares note")).length > 0, true);
comprobar("«telefonos xiaomi» también", (await enXiaomi("telefonos xiaomi")).length > 0, true);

// Un número que no existe TIENE que dar vacío: si no, el bot enseñaría
// los Note que sí hay como si fueran el que pidió.
comprobar("«note 20» no existe: vacío", await enXiaomi("note 20"), []);
comprobar("«redmi note 17» trae sus dos versiones, sin el forro", await enXiaomi("redmi note 17"), ["Redmi Note 17 256GB", "Redmi Note 17 Pro 512GB"]);
comprobar("y «forro note 17» trae el forro, no el teléfono", await enXiaomi("forro note 17"), ["Forro Redmi Note 17"]);
comprobar("«galaxy a57» encuentra el Samsung", await enXiaomi("galaxy a57"), ["Samsung Galaxy A57 128GB"]);

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
