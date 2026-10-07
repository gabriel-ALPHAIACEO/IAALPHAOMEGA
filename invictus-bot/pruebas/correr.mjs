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
  ["pagos.mjs", "los métodos de pago, la tasa y el guardián de los datos"],
  ["gasto.mjs", "la medición del gasto de OpenAI"],
  ["prompt.mjs", "que los prompts se armen y las reglas sigan escritas"],
  ["corpus.mjs", "que los guardianes no alteren respuestas buenas"],
  ["cotejo.mjs", "que llegue al modelo el zapato del color correcto"],
  ["cashea.mjs", "las cuentas de Cashea, sus fechas, y la ubicación tal cual"],
  ["config.mjs", "que el wrangler.toml esté completo (cron, ubicación) y sin duplicados"],
  ["datos.mjs", "horarios, envíos, delivery y empleo: que estén y salten solos"],
  ["botas.mjs", "que las botas de básquet no busquen las tácticas"],
  ["voz.mjs", "las notas de voz: las escucha, contesta, y si le hablan con voz contesta con voz"],
  ["precio.mjs", "con las fichas a la vista no pregunta por el precio: dice que está en cada foto"],
  ["tono.mjs", "todo tipo de clientes: ni groserías ni regaños del bot, y el prompt que lo enseña"],
  ["rescate.mjs", "que un \"no es ese\" pase a una persona en vez de seguir adivinando"],
  ["extremo.mjs", "de punta a punta: lo que de verdad le llega al cliente"],
  ["asesor.mjs", "la IA se calla cuando habla el asesor (también a mitad del turno)"],
  ["informe6oct.mjs", "lo que salió del informe de errores del 6-oct: el precio cuando lo pregunta, Cashea de su nivel, OpenAI sin saldo"],
  ["aprende.mjs", "la IA aprende sola: el revisor (que piensa) escribe la regla, la IA de texto o de imágenes la recibe, y solo avisa 🛠️ cuando hay que tocar el código"],
  ["tienda.mjs", "el panel /panel: la clave, los mensajes, lo que pensó la IA, pausar y devolver"],
  ["instagram.mjs", "/probar-instagram: en qué paso se corta (token, suscripción, firma, envío)"],
  ["cupo.mjs", "que sin cupo de OpenAI no se cuente como \"miré y no está\""],
  ["inventario.mjs", "el inventario y la caja: stock que nunca baja de 0, códigos de barras, importar sin duplicar"],
  ["negocio.mjs", "gastos, fiados, anular, el balance, Cashea en la caja, cada tienda con su negocio y la sesión abierta"],
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
