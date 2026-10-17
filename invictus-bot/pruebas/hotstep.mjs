// LA NIKE NOCTA HOT STEP 2 (11-oct-2026): la blanca de una historia salió
// como "Nike 270 beige". Se protege en las tres capas: el prompt de visión
// la describe, el código corrige si la IA dice otro Nike habiendo visto el
// charol con líneas en relieve, y el revisor sabe marcarlo como error.

import { prepararSrc, prompt, fuente, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const { validarIdentificacion: validar, RASGOS_CLAVE, terminosCompatibles } = await src.cargar("identificar.js");

const base = Object.fromEntries(RASGOS_CLAVE.map((k) => [k, false]));
const hotStep = { ...base, camaraAireTalon: true, charolLineasRelieve: true };
const log = console.log;
console.log = () => {};
const corre = (buscar, rasgos) => validar({ buscar, rasgos, pedirNombreExacto: false });

titulo("el código");
ok(RASGOS_CLAVE.length === 16 && RASGOS_CLAVE.includes("charolLineasRelieve"), "hay 16 rasgos, con charolLineasRelieve");
for (const dijo of ["Nike 270", "Air Max 270", "270", "Nike", "Nocta", ""]) {
  const r = corre(dijo, hotStep);
  ok(r.buscar === "Nocta hot step" && r.confirmar, `charol + relieve y la IA dijo "${dijo}" → Nocta hot step`, r.buscar);
}
const bien = corre("Nocta hot step", hotStep);
ok(bien.buscar === "Nocta hot step" && !bien.corregido, "si ya dijo Nocta hot step, se deja");
const sinCharol = corre("Nocta hot step", { ...base, camaraAireTalon: true });
ok(sinCharol.buscar === "Nocta hot step" && sinCharol.confirmar, "sin el charol marcado, no se tira: se busca sin confirmar");
const un270 = corre("Nike 270", { ...base, camaraAireTalon: true });
ok(un270.buscar === "Nike 270" && !un270.corregido, "un 270 de verdad (malla, sin charol) sigue siendo 270");
ok(corre("Superstar", { ...base, punteraGomaConcha: true, charolLineasRelieve: true }).buscar === "Superstar", "un Adidas de charol no se toca");
ok(corre("Retro 4", { ...base, jumpman: true, mallaPlasticaCuadros: true, alasPlasticasCordones: true, charolLineasRelieve: true }).buscar === "Retro 4", "un Jordan de charol no se toca");
ok(terminosCompatibles(hotStep).includes("nocta hot step"), "con esos rasgos se propone nocta hot step");
console.log = log;

titulo("los prompts");
const vision = prompt("vision.txt");
ok(/NIKE NOCTA HOT STEP 2/.test(vision) && /CHAROL/.test(vision) && /LÍNEAS EN RELIEVE/.test(vision), "vision.txt describe la Hot Step 2 (charol, líneas en relieve)");
ok(/Nocta Hot Step 2 \(Drake\)\s+Nocta hot step/.test(vision), "y dice cómo buscarla");
ok(/16 claves/.test(vision) && vision.includes('"charolLineasRelieve":false}'), "vision.txt pide las 16 claves");
ok(/charolLineasRelieve/.test(prompt("indexar.txt")) && /16 claves/.test(prompt("indexar.txt")), "indexar.txt también (las fichas del catálogo llevan el rasgo)");
ok(/hot step/.test(prompt("texto.txt")), "texto.txt traduce \"hot step\" a la búsqueda");
ok(/Nocta Hot Step 2/.test(prompt("modelos.txt")), "modelos.txt la tiene como familia");
const titulos = prompt("catalogo.txt").split("\n").filter((l) => !l.startsWith("#") && /nocta hot step/i.test(l));
ok(titulos.length >= 3, `"Nocta hot step" encuentra ${titulos.length} títulos del catálogo`);

titulo("el revisor");
ok(/NOCTA HOT STEP 2/.test(fuente("revisor.js")) && /foto_equivocada/.test(fuente("revisor.js")), "el revisor conoce el caso y lo marca foto_equivocada");

terminar();
