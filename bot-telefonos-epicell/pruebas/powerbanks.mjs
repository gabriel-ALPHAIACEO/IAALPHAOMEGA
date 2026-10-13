// LOS POWER BANKS (13-oct-2026, informe de errores de EPICCELL: Alberto
// Leon venía mirando el Powerbank 20.000mAh GAr 158, escribió "Powerbanks"
// y la IA volvió a buscar ESE modelo: le salió uno solo y le dijo "aquí
// tienes el que ya hemos visto". En la tienda había más — dueño: "si hay
// más powerbanks, ¿por qué dice que no?").
//
// Lo que no se puede romper:
//   · un mensaje que es SOLO un tipo ("Powerbanks", "¿tienen power banks?",
//     "más relojes") enseña TODOS los de ese tipo, primero los que no vio;
//   · "Power Bank" separado, "batería portátil" o "banco de energía" son
//     power banks;
//   · si de verdad hay uno solo y ya lo vio, se le dice claro que es el
//     único (sin inventar "más opciones");
//   · la lista que lee la IA va una línea por modelo, para que quepa todo.
import { turno } from "./banco.mjs";
import { tipoDelProducto, soloNombraUnTipo, tipoQuePide } from "./.stub/tipos.js";
import { listaDeTitulos } from "./.stub/sheets.js";

let fallos = 0;
const comprobar = (n, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};
const textos = (e) => e.filter((m) => m.text).map((m) => m.text).join(" ");
const titulos = (e) => e.flatMap((m) => m.attachment?.payload?.elements || []).map((f) => f.title);

const GAR = "Powerbank 20.000mAh GAr 158";
const AORAX = "Aorax Power Bank 10.000 mAh";
const XIAOMI = "Xiaomi Bateria portatil 20000";
const VARIOS = `Nombre,Cantidad,Precio Cashea,Precio Divisas ($),Foto
Redmi 15c,4,182,145,https://x/2.jpg
${GAR},3,38,30,https://x/gar.jpg
${AORAX},2,25,20,https://x/aorax.jpg
${XIAOMI},1,45,35,https://x/xi.jpg
Reloj Xiaomi Mi band 10,2,70,55,https://x/31.jpg
Reloj Honor choice watch 2i,3,50,38,https://x/29.jpg`;
const UNO = `Nombre,Cantidad,Precio Cashea,Precio Divisas ($),Foto
Redmi 15c,4,182,145,https://x/2.jpg
${GAR},3,38,30,https://x/gar.jpg`;

const yaVio = (titulos) => ({ historial: "Ya di la bienvenida. Le mostré power banks.", ultimos_productos: JSON.stringify(titulos), mostrados: JSON.stringify(titulos) });

console.log("— los tipos");
comprobar('"Aorax Power Bank" (separado) es un power bank', tipoDelProducto(AORAX), "powerbank");
comprobar('"Bateria portatil" es un power bank', tipoDelProducto(XIAOMI), "powerbank");
comprobar('"banco de energía" se entiende', tipoQuePide("tienen banco de energía?"), "powerbank");
for (const [t, e] of [["Powerbanks", "powerbank"], ["¿Tienen power banks?", "powerbank"], ["más relojes", "reloj"], ["Powerbank", "powerbank"], ["powerbank de 20000", ""], ["powerbank xiaomi", ""], ["hola", ""]]) {
  comprobar(`"${t}" ${e ? `es solo el tipo ${e}` : "no es solo un tipo"}`, soloNombraUnTipo(t), e);
}

console.log("— el caso real: 'Powerbanks' después de ver uno");
{
  const r = await turno({ texto: "Powerbanks", fila: yaVio([GAR]), respuestaDelModelo: { respuesta: "Aquí tienes el Powerbank de 20.000mAh GAr 158 que ya hemos visto. ¿Te gustaría saber algo más?", buscar: GAR }, hoja: VARIOS });
  const t = titulos(r.enviados);
  comprobar("le enseña los 3 power banks (no solo el que vio)", [...t].sort(), [AORAX, GAR, XIAOMI].sort());
  comprobar("primero los que no había visto", t.slice(0, 2).sort(), [AORAX, XIAOMI].sort());
  comprobar("ninguno que no sea power bank", t.every((x) => tipoDelProducto(x) === "powerbank"), true);
  comprobar("y no le dice que es el único", /[uú]nico/i.test(textos(r.enviados)), false);
}
{
  const r = await turno({ texto: "Powerbank", fila: yaVio([GAR, AORAX, XIAOMI]), respuestaDelModelo: { respuesta: "El Powerbank de 20.000mAh GAr 158 es ideal.", buscar: GAR }, hoja: VARIOS });
  comprobar("'Powerbank' (singular, ya los vio todos): siguen saliendo los 3", titulos(r.enviados).length, 3);
}

console.log("— cuando de verdad hay uno solo");
{
  const r = await turno({ texto: "Powerbanks", fila: yaVio([GAR]), respuestaDelModelo: { respuesta: "Aquí tienes el Powerbank de 20.000mAh GAr 158 que ya hemos visto. ¿Te gustaría saber algo más?", buscar: GAR }, hoja: UNO });
  const dice = textos(r.enviados);
  comprobar("le dice claro que es el único", /Por ahora es el único que tenemos/.test(dice), true);
  comprobar("sin 'aquí tienes el que ya hemos visto'", /ya hemos visto/i.test(dice), false);
  comprobar("ni promete más opciones", /m[aá]s opciones|otros modelos/i.test(dice), false);
}
{
  const r = await turno({ texto: "tienen power banks?", fila: { historial: "Ya di la bienvenida." }, respuestaDelModelo: { respuesta: "¡Claro! Mira 👇", buscar: "power bank" }, hoja: UNO });
  comprobar("la primera vez que pregunta (no lo había visto) NO se dice 'único'", /[uú]nico/i.test(textos(r.enviados)), false);
  comprobar("…y se le enseña", titulos(r.enviados), [GAR]);
}

console.log("— 'relojes' después de ver uno");
{
  const r = await turno({ texto: "relojes", fila: { ...yaVio(["Reloj Xiaomi Mi band 10"]), historial: "Ya di la bienvenida. Le mostré relojes." }, respuestaDelModelo: { respuesta: "¡Claro! 👇", buscar: "Reloj Xiaomi Mi band 10" }, hoja: VARIOS });
  comprobar("salen los relojes que hay, primero el que no vio", titulos(r.enviados), ["Reloj Honor choice watch 2i", "Reloj Xiaomi Mi band 10"]);
}

console.log("— la lista que lee la IA");
{
  const muchas = ["Nombre,Capacidad,Cantidad,Precio Cashea,Precio Divisas ($),Foto"];
  for (let i = 0; i < 200; i++) for (const cap of ["128GB", "256GB", "512GB"]) muchas.push(`Telefono modelo largo numero ${i},${cap},2,100,80,https://x/${i}.jpg`);
  muchas.push(`${AORAX},,2,25,20,https://x/a.jpg`);
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => muchas.join("\n") });
  const log = console.log;
  console.log = () => {};
  const lista = await listaDeTitulos({ SHEET_ID: "x", SHEET_NOMBRE: "Hoja 1" });
  console.log = log;
  comprobar("una línea por modelo, con sus capacidades juntas", /Telefono modelo largo numero 7 — 128GB, 256GB, 512GB/.test(lista), true);
  comprobar("y el power bank del final llega a la IA", lista.includes(AORAX), true);
}

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
