// LA LISTA DE PRODUCTOS DEL DUEÑO: que esté entera y que llegue al prompt.
//
// QUÉ SE PROTEGE. El 11-oct el dueño mandó sus 535 nombres de productos
// (copia en pruebas/datos/productos-invictus.txt). Viven en
// src/prompts/catalogo.txt y ia.js los pega en {{CATALOGO}}. Un nombre que
// se pierde al actualizar no da error: ese zapato simplemente deja de
// encontrarse. Por eso se comprueba uno por uno.

import { readFileSync } from "node:fs";
import { prepararSrc, prompt, ok, titulo, terminar } from "./ayuda.mjs";

const lineas = (t) =>
  String(t)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

const delDueno = lineas(readFileSync(new URL("./datos/productos-invictus.txt", import.meta.url), "utf8"));
const enCatalogo = new Set(lineas(prompt("catalogo.txt")));

titulo("catalogo.txt tiene la lista del dueño entera");
ok(delDueno.length === 535, "la copia del dueño trae 535 nombres", `${delDueno.length}`);
const faltan = delDueno.filter((n) => !enCatalogo.has(n));
ok(faltan.length === 0, "todos están en catalogo.txt, escritos igual (erratas incluidas)", faltan.slice(0, 5).join(" | "));

titulo("y llegan de verdad al prompt del modelo");
const src = await prepararSrc();
const ia = await src.cargar("ia.js");

let sistema = "";
const fetchReal = globalThis.fetch;
const logReal = console.log;
globalThis.fetch = async (_url, op) => {
  try {
    const cuerpo = JSON.parse(op?.body || "{}");
    sistema ||= (cuerpo.messages || []).filter((m) => m.role === "system").map((m) => String(m.content)).join("\n");
  } catch {}
  throw new Error("sin red en las pruebas");
};
console.log = () => {};
try {
  await ia.responderTexto({ OPENAI_API_KEY: "x" }, "hola");
} catch {}
globalThis.fetch = fetchReal;
console.log = logReal;

ok(sistema.length > 0, "se capturó el prompt que se manda al modelo");
ok(!sistema.includes("{{CATALOGO}}"), "el marcador {{CATALOGO}} quedó rellenado");
const noLlegan = delDueno.filter((n) => !sistema.includes(n));
ok(noLlegan.length === 0, `los ${delDueno.length} nombres están en el prompt`, noLlegan.slice(0, 5).join(" | "));

terminar();
