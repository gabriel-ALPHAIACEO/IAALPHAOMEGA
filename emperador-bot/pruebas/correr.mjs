// CORRE TODO. Es lo único que hay que ejecutar antes de entregar:
//
//     node pruebas/correr.mjs
//
// Hace las dos cosas que pide CLAUDE.md —node --check en cada .js y las
// pruebas— y devuelve 1 si algo falla, para que se note.
//
// Cada suite va en su propio proceso a propósito: así una que se caiga con
// un error de verdad no se lleva por delante a las demás, y se ve el
// panorama completo en una sola pasada.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const AQUI = import.meta.dirname;
const SRC = path.join(AQUI, "..", "src");

const SUITES = [
  ["asesor.mjs", "la IA se calla cuando habla el asesor (también a mitad del turno)"],
  ["pagos.mjs", "los métodos de pago, la tasa y el guardián de los datos"],
  ["gasto.mjs", "la medición del gasto de OpenAI"],
  ["prompt.mjs", "que los prompts se armen y las reglas sigan escritas"],
  ["corpus.mjs", "que los guardianes no alteren respuestas buenas"],
  ["deepseek.mjs", "DeepSeek: dos modelos (texto e imágenes), sin pensar de más, JSON, fotos, errores y /estado"],
  ["cotejo.mjs", "que llegue al modelo el zapato del color correcto"],
  ["config.mjs", "que el wrangler.toml esté completo: cron, DeepSeek con dos modelos"],
  ["drive.mjs", "el catálogo desde Google Drive: nombres, códigos, precios y búsqueda"],
  ["categorias.mjs", "calzado, bolsos, camisas, pantalones y gorras: por texto y por foto llega lo que pidió"],
  ["instagram.mjs", "/probar-instagram: en qué paso se corta la respuesta y qué hacer"],
  ["cashea.mjs", "las cuentas de Cashea (con 0%), sus fechas, y la ubicación tal cual"],
  ["datos.mjs", "horario, envíos y delivery de El Emperador: que estén, que no se inventen"],
  ["botas.mjs", "que las botas de básquet no busquen las tácticas"],
  ["carpetas.mjs", "los modelos son las carpetas de Drive: la IA de texto y la de fotos los conocen, y la búsqueda los encuentra"],
  ["mind.mjs", "Mind 002 es Mind 002 y Mind 001 es la chola: la foto manda sobre la carpeta, y el número no se suelta"],
  ["tn.mjs", "los Nike TN y los New Balance: cómo se ven, las mismas palabras en el índice, y la red que corrige"],
  ["cercano.mjs", "si no hay lo que pidió, lo más cercano (otro color, sin la palabra que sobra, un parecido) y no diez cualquiera; el precio que la ficha no trae, al asesor"],
  ["tallas.mjs", "las tallas del nombre (36-45): sí hay → asesor; no hay → uno parecido que sí la trae"],
  ["drake.mjs", "los Drake son los AF1, y las fotos \"IMG 3212\" se encuentran por el modelo del índice"],
  ["tono.mjs", "todo tipo de clientes: ni groserías ni regaños del bot, y el prompt que lo enseña"],
  ["rescate.mjs", "que un \"no es ese\" pase a una persona en vez de seguir adivinando"],
  ["extremo.mjs", "de punta a punta: lo que de verdad le llega al cliente"],
  ["cupo.mjs", "que sin cupo de la IA no se cuente como \"miré y no está\""],
  ["conexiones.mjs", "las 50 conexiones por pasada de Cloudflare: el índice se reparte y el cliente siempre recibe respuesta"],
  ["inventario.mjs", "el inventario y la caja: stock que nunca baja de 0, códigos de barras, importar sin duplicar"],
  ["negocio.mjs", "gastos, fiados, anular, el balance, Cashea en la caja, cada tienda con su negocio y la sesión abierta"],
  ["tandas.mjs", "Traer ahora, el Excel y el Excel del inventario por tandas: ninguna pasada llega al tope de Cloudflare y queda igual que de una vez"],
];

let roto = false;

// ── 1. node --check en cada archivo ────────────────────────────────────
console.log("\n=== node --check ===\n");

const archivos = fs.readdirSync(SRC).filter((f) => f.endsWith(".js"));
let malos = 0;
for (const f of archivos) {
  const r = spawnSync(process.execPath, ["--check", path.join(SRC, f)], { encoding: "utf8" });
  if (r.status !== 0) {
    malos++;
    console.log(` ROTO  src/${f}\n${r.stderr}`);
  }
}
if (malos) roto = true;
console.log(malos ? ` ${malos} de ${archivos.length} archivos NO compilan` : `  ok   los ${archivos.length} archivos de src/ compilan`);

// ── 2. Las suites ──────────────────────────────────────────────────────
const resumen = [];

for (const [archivo, queCubre] of SUITES) {
  console.log(`\n=== ${archivo} — ${queCubre} ===`);

  // --disable-warning esconde SOLO el aviso de que node:sqlite es
  // experimental. Sale en cada suite que usa la base y no significa nada,
  // pero asusta y tapa los resultados. Los demás avisos siguen saliendo.
  const r = spawnSync(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", path.join(AQUI, archivo)],
    { encoding: "utf8" }
  );
  const salida = (r.stdout || "") + (r.stderr || "");

  // Las líneas de registro del propio bot (GASTO, PAGOS, avisos) se
  // esconden: en una pasada completa son ruido y tapan los resultados.
  console.log(
    salida
      .split("\n")
      .filter((l) => !/^(GASTO|PAGOS|No pude|Cat[aá]logo pegado|M[eé]todos de pago|Tasa pegada|Sin (m[eé]todos|tasa|cat[aá]logo)|El modelo respondió)/.test(l))
      .join("\n")
      .trim()
  );

  const ok = (salida.match(/^  ok/gm) || []).length;
  const fallos = (salida.match(/^ FALLA/gm) || []).length;
  resumen.push({ archivo, ok, fallos, estado: r.status === 0 && !fallos });
  if (r.status !== 0 || fallos) roto = true;
}

// ── 3. El resumen ──────────────────────────────────────────────────────
console.log("\n=== RESUMEN ===\n");

let total = 0;
for (const s of resumen) {
  total += s.ok;
  console.log(
    `  ${s.estado ? "ok  " : "FALLA"}  ${s.archivo.padEnd(12)} ${String(s.ok).padStart(3)} comprobaciones` +
      (s.fallos ? `, ${s.fallos} FALLOS` : "")
  );
}

console.log(
  roto
    ? `\n  HAY FALLOS. No entregues hasta que estén en verde.\n`
    : `\n  ${total} comprobaciones en verde. Listo para entregar.\n`
);

process.exit(roto ? 1 : 0);
