// LAS ESPECIFICACIONES EN LA BASE (6-oct-2026, ver src/especificaciones.js).
// Con SQLite de verdad (node:sqlite, Node 22+) para que las consultas sean
// las mismas que corre D1.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { turno } from "./banco.mjs";
import {
  SEMILLA, todasLasEspecificaciones, fichaDe, fichasDeLaCharla, notaTecnica, botonDeLaPagina, clave,
} from "./.stub/especificaciones.js";

let fallos = 0;
const comprobar = (n, real, esperado = true) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};

// Una D1 mínima sobre SQLite de verdad.
function d1() {
  const db = new DatabaseSync(":memory:");
  const preparada = (sql, args = []) => ({
    bind: (...a) => preparada(sql, a),
    run: async () => db.prepare(sql).run(...args),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) ?? null,
  });
  return {
    sqlite: db,
    prepare: (sql) => preparada(sql),
    batch: async (lista) => { for (const p of lista) await p.run(); },
  };
}

// ── La semilla ───────────────────────────────────────────────────────
{
  const catalogo = fs.readFileSync(new URL("../src/prompts/catalogo.txt", import.meta.url), "utf8")
    .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const sinPareja = SEMILLA.filter((f) => !catalogo.some((t) => clave(t) === clave(f.modelo)));
  comprobar("cada modelo de la semilla está escrito como en el catálogo de la hoja", sinPareja.map((f) => f.modelo), []);
  comprobar("ningún modelo repetido", new Set(SEMILLA.map((f) => clave(f.modelo))).size, SEMILLA.length);
  comprobar("todos traen pantalla, procesador, cámara y batería", SEMILLA.filter((f) => !f.pantalla || !f.procesador || !f.camara || !f.bateria).map((f) => f.modelo), []);
  comprobar("las páginas puestas son enlaces https", SEMILLA.filter((f) => f.pagina && !/^https:\/\//.test(f.pagina)).map((f) => f.modelo), []);
}

// ── La base: se crea sola y NO pisa lo que el dueño editó ───────────
{
  const db = d1();
  const filas = await todasLasEspecificaciones(db);
  comprobar("la tabla se crea sola con toda la semilla", filas.length, SEMILLA.length);
  db.sqlite.prepare("UPDATE especificaciones SET bateria = 'EDITADO' WHERE modelo = 'Samsung A57'").run();
  db.sqlite.prepare("INSERT INTO especificaciones (modelo, pantalla) VALUES ('Samsung A99', '7 pulgadas')").run();
  // Otro arranque (otro isolate) vuelve a sembrar: lo editado se queda.
  const { todasLasEspecificaciones: otraVez } = await import(`./.stub/especificaciones.js?otra=${Date.now()}`);
  const despues = await otraVez(db);
  comprobar("al volver a arrancar, lo que editó el dueño se queda", despues.find((f) => f.modelo === "Samsung A57")?.bateria, "EDITADO");
  comprobar("y un teléfono que agregó él también", despues.some((f) => f.modelo === "Samsung A99"), true);
}

const filas = SEMILLA;

// ── Qué fila es de qué equipo ───────────────────────────────────────
{
  comprobar("'Redmi Note 17 Pro Max 5G 12/512' → la del Pro Max", fichaDe("Redmi Note 17 Pro Max 5G 12/512", filas)?.modelo, "Redmi Note 17 Pro Max 5G");
  comprobar("'Redmi Note 17' NO es el 'Redmi Note 17 Pro 5G'", fichaDe("Redmi Note 17", filas)?.modelo, "Redmi Note 17");
  comprobar("'Samsung A57 256GB' → Samsung A57", fichaDe("Samsung A57 256GB", filas)?.modelo, "Samsung A57");
  comprobar("un cable no tiene ficha técnica", fichaDe("Samsung Cable Tipo C 1Metro", filas), null);
}

// ── El caso del informe: "¿Cuál es mejor el 15 o el 17?" ───────────
{
  const f = fichasDeLaCharla(filas, { titulos: ["Redmi Note 17 Pro Max 5G"], texto: "Cuál es mejor el 15 o el 17 ?" });
  const modelos = f.map((x) => x.modelo);
  comprobar("viendo el Note 17 Pro Max, '¿el 15 o el 17?' trae la ficha del 17 Pro Max y de los Note 15", modelos.includes("Redmi Note 17 Pro Max 5G") && modelos.some((m) => /Note 15/.test(m)), true, );
  comprobar("nunca más de 4 fichas", f.length <= 4);
  const nota = notaTecnica(f);
  comprobar("la IA recibe los datos reales (10000 mAh del Pro Max)", /FICHA TÉCNICA REAL de Redmi Note 17 Pro Max 5G:.*10000 mAh/.test(nota));
  comprobar("y la orden de no inventar lo que no está", /sin inventar nada que no esté aquí/.test(nota));
  comprobar("sin equipos de los que se hable, no va nada", notaTecnica(fichasDeLaCharla(filas, { titulos: [], texto: "hola" })), "");
}

// ── "Pásame todas las especificaciones": botón a la página oficial ─
{
  const pm = filas.find((f) => f.modelo === "Redmi Note 17 Pro Max 5G");
  const b = botonDeLaPagina("pásame todas las especificaciones", [pm]);
  comprobar("con UN equipo y su página → botón 'Ver ficha técnica' a la página oficial", b?.url, pm.pagina);
  comprobar("si no lo pidió, no hay botón", botonDeLaPagina("qué batería tiene?", [pm]), null);
  comprobar("sin página puesta, no hay botón", botonDeLaPagina("ficha técnica", [filas.find((f) => f.modelo === "Samsung A57")]), null);
}

// ── El turno completo: la IA recibe la ficha del que está viendo ────
{
  const r = await turno({
    texto: "Cuál es mejor el 15 o el 17 ?",
    fila: { historial: "Ya di la bienvenida. Pidió Redmi Note 17 Pro Max 5G.", ultimos_productos: JSON.stringify(["Samsung A57"]) },
    respuestaDelModelo: { respuesta: "El A57 trae 5000 mAh 🔋", buscar: "NADA", mostrar: "texto" },
  });
  const loQueLeyo = JSON.stringify(r.alModelo.find((x) => !x.redaccion)?.messages || []);
  comprobar("turno: la IA recibe la FICHA TÉCNICA REAL del equipo que vio", /FICHA TÉCNICA REAL de Samsung A57/.test(loQueLeyo));
  const r2 = await turno({
    texto: "pásame todas las especificaciones del Redmi Note 17 Pro Max 5G",
    fila: { historial: "Ya di la bienvenida." },
    respuestaDelModelo: { respuesta: "¡Claro! Mira 👇", buscar: "Redmi Note 17 Pro Max 5G" },
    hoja: `Nombre,Precio Divisas ($),Precio Cashea,Foto\nRedmi Note 17 Pro Max 5G,400,130,https://x/pm.jpg`,
  });
  const boton = r2.enviados.find((m) => m.attachment?.payload?.buttons?.some((b) => b.url));
  comprobar("turno: 'todas las especificaciones' → botón a la página oficial", boton?.attachment?.payload?.buttons?.[0]?.url, SEMILLA.find((f) => f.modelo === "Redmi Note 17 Pro Max 5G").pagina);
}

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
