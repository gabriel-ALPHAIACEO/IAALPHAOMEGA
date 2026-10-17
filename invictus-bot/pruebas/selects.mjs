// LAS LISTAS DESPLEGABLES (17-oct-2026, bug real del panel de Rodrigo): en el tema oscuro, el desplegable de
// «Cómo se pagó» se veía con fondo claro y letra casi blanca (ilegible). El select tiene fondo translúcido
// (cristal), el navegador pinta la lista sobre blanco y las opciones heredaban la letra clara del tema.
// Arreglo: las <option> llevan fondo SÓLIDO del tema y su propia letra. Esta prueba vigila que no vuelva.

import { ok, titulo, terminar, fuente } from "./ayuda.mjs";

const alpha = fuente("alpha.js");
const web = fuente("catalogo-web.js");

titulo("El panel (alpha.js)");
ok(/select option,select optgroup\{background-color:var\(--tarjeta-solida\);color:var\(--texto\)\}/.test(alpha), "las opciones de un select llevan fondo sólido del tema y su propia letra");
const oscuro = alpha.match(/--tarjeta-solida:(#[0-9a-fA-F]{3,8});/g) || [];
ok(oscuro.length >= 2, "--tarjeta-solida es un color SÓLIDO (no rgba) en el tema oscuro y en el claro", oscuro.join(" "));
ok(!/--tarjeta-solida:rgba/.test(alpha), "--tarjeta-solida nunca es translúcido");
ok(/input,button,select,textarea\{[^}]*background:rgba\(255,255,255,\.04\)/.test(alpha), "(el select sigue con su fondo de cristal: por eso las opciones necesitan el suyo)");

titulo("La tienda web (catalogo-web.js)");
ok(/select option,select optgroup\{background-color:var\(--tarjeta-s\);color:var\(--texto\)\}/.test(web), "las opciones del desplegable de la tienda web también");
ok(/--tarjeta-s:#0c1220/.test(web) && /--tarjeta-s:#fff;/.test(web), "--tarjeta-s es sólido en los dos temas");

terminar();
