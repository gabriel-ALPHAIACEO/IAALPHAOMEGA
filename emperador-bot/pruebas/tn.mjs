// LOS NIKE TN Y LOS NEW BALANCE (6-oct-2026, dueño: "los TN son muy
// importantes, y todos los New Balance también"). Que la IA de fotos sepa
// cómo se ven, que el índice los describa con LAS MISMAS palabras (así la
// foto del cliente encuentra la del catálogo), y una red por debajo que
// corrige lo que se contradice.

import { prepararSrc, prompt, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const I = await src.cargar("identificar.js");
const vision = prompt("vision.txt");
const indexar = prompt("indexar.txt");
const R = (o = {}) => Object.fromEntries(I.RASGOS_CLAVE.map((k) => [k, Boolean(o[k])]));

titulo("la IA de fotos sabe cómo se ve un TN");
for (const [seña, re] of [
  ["las ondas plásticas que suben por el lateral", /ONDAS PLÁSTICAS en el lateral/],
  ["el degradado de color", /DEGRADADO de color/],
  ["el aire en el talón y adelante", /Cámaras de aire visibles en el talón y también en la parte de adelante/],
  ["la cola de ballena bajo el arco", /cola de ballena/],
  ["el logo TN en el talón", /logo "TN"/],
  ["el swoosh pequeño (no el del Air Force)", /swoosh es PEQUEÑO/],
  ['"buscar": "TN" (salen las carpetas TN y TN PLUS)', /"buscar": "TN"\. En la tienda hay dos carpetas, TN y TN PLUS/],
  ["en qué se diferencia de la Air Max 97", /Air Max 97 \(líneas horizontales finas/],
]) ok(re.test(vision), seña);

titulo("y cada New Balance");
for (const [modelo, re] of [
  ["9060: suela escalonada con picos", /9060 {3}Suela MUY gruesa y escalonada/],
  ["530: capas plateadas", /530 {4}Corredora retro de los 2000/],
  ["550: retro de básquet", /550 {4}Retro de BÁSQUET/],
  ["2002R", /2002R {2}Corredora/],
  ["1906R", /1906R {2}Corredora técnica/],
  ["327: N gigante", /327 {4}N GIGANTE/],
  ["574", /574 {4}El clásico/],
  ["990", /990 {4}Gamuza gris/],
  ["si no lee el número ni cumple la firma: la familia", /"buscar": "Balance" \(la\s+familia\) con "pedirNombreExacto": true/],
]) ok(re.test(vision), modelo);

titulo("el índice los describe con las mismas palabras que la foto del cliente");
for (const palabra of ["ondas plásticas", "degradado", "cola de ballena", "letra N", "capas plateadas"]) {
  ok(indexar.includes(palabra) && vision.toLowerCase().includes(palabra.toLowerCase()), `"${palabra}" está en los dos`);
}
ok(/LOS TN: con ondas plásticas y el logo TN → "TN"/.test(indexar), 'al indexar, un TN queda con modelo "TN" (así lo encuentra la búsqueda)');

titulo("la red por debajo (identificar.js)");
ok(!I.validarIdentificacion({ buscar: "TN", rasgos: R({ camaraAireTalon: true }) }).corregido, "un TN con aire en el talón: se queda TN");
const conSwoosh = I.validarIdentificacion({ buscar: "TN", rasgos: R({ swooshGrandeRecto: true, piezaMetalicaOjal: true }) });
ok(conSwoosh.corregido && conSwoosh.buscar === "Nike", '"TN" con el swoosh grande de un Air Force → baja a Nike (y el cotejo decide)', conSwoosh.buscar);
ok(!I.validarIdentificacion({ buscar: "New Balance 9060", rasgos: R() }).corregido, "un New Balance sin nada raro: se queda");
for (const [buscar, rasgo] of [["Balance", "tresFranjas"], ["New Balance 530", "swooshGrandeRecto"], ["9060", "jumpman"]]) {
  const r = I.validarIdentificacion({ buscar, rasgos: R({ [rasgo]: true }) });
  ok(r.corregido && r.buscar === "NADA", `"${buscar}" con ${rasgo} → no es New Balance`, r.buscar);
}
ok(!I.terminosCompatibles(R()).some((t) => ["tn", "balance", "new balance", "9060"].includes(t)), "y nunca se proponen solos (no exigen ningún rasgo)");

terminar();
