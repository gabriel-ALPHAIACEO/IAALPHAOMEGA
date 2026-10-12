// LO DE INVICTUS DEL 11-OCT, EN EL EMPERADOR: la Nike Nocta Hot Step 2
// (rasgo charolLineasRelieve; aquí se busca "Nocta", que es como se llama en
// Drive) y las redes de faltas.js (talla, catálogo prometido, fotos que no
// se mandaron, marcas negadas que sí hay).

import { prepararSrc, prompt, fuente, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const { validarIdentificacion: validar, RASGOS_CLAVE } = await src.cargar("identificar.js");
const F = await src.cargar("faltas.js");

const base = Object.fromEntries(RASGOS_CLAVE.map((k) => [k, false]));
const hotStep = { ...base, camaraAireTalon: true, charolLineasRelieve: true };
const log = console.log;
console.log = () => {};

titulo("la Nocta Hot Step 2");
ok(RASGOS_CLAVE.length === 16 && RASGOS_CLAVE.includes("charolLineasRelieve"), "16 rasgos, con charolLineasRelieve");
for (const dijo of ["Nike 270", "Air Max 270", "Nike"]) {
  const r = validar({ buscar: dijo, rasgos: hotStep });
  ok(r.buscar === "Nocta" && r.confirmar, `charol + relieve y dijo "${dijo}" → Nocta`, r.buscar);
}
ok(validar({ buscar: "Nike 270", rasgos: { ...base, camaraAireTalon: true } }).buscar === "Nike 270", "un 270 de verdad sigue siendo 270");
ok(validar({ buscar: "Nike", rasgos: hotStep, tipo: "gorra" }).buscar === "Nike", "una gorra no se toca");
ok(/NIKE NOCTA HOT STEP 2/.test(prompt("vision.txt")) && /16 claves/.test(prompt("vision.txt")), "vision.txt la describe y pide 16 claves");
ok(/charolLineasRelieve/.test(prompt("indexar.txt")), "indexar.txt también");
ok(/NOCTA HOT STEP 2/.test(fuente("revisor.js")), "el revisor conoce el caso");

titulo("las redes de faltas.js");
ok(F.contestaLaTalla("Mira 👇", "tienes talla 42?").corregido, "talla → la confirma un asesor");
ok(F.prometeElCatalogo("Aquí tienes todo lo que manejamos 👇"), "catálogo prometido → va el botón");
ok(F.sinNegarLoQueHay("No tengo Samba, pero mira estos", { titulos: ["ADIDAS SAMBA TALLAS 36-40"] }).corregido, "niega una marca que está en Drive → se quita");
ok(!F.sinNegarLoQueHay("No tengo Balenciaga", { titulos: ["ADIDAS SAMBA"] }).corregido, "una que no está, se deja");
ok(typeof F.contestaLosBolivares === "undefined", "lo de los bolívares ya no está");
const idx = fuente("index.js");
for (const f of ["contestaLaTalla", "prometeElCatalogo", "sinFotosQueNoHay", "sinNegarLoQueHay", "darUnoALosSinContar"]) ok(idx.includes(`${f}(`), `index.js usa ${f}`);
console.log = log;
terminar();
