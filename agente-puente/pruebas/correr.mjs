// Corre todas las pruebas del agente puente. Devuelve 1 si alguna falla.
//   node pruebas/correr.mjs      (desde la carpeta agente-puente)
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
let mal = 0;
for (const archivo of ["agente.mjs", "abierto.mjs"]) {
  const r = spawnSync(process.execPath, [path.join(AQUI, archivo)], { encoding: "utf8" });
  const ultima = (r.stdout || "").trim().split("\n").at(-1);
  console.log(`${r.status === 0 ? "✅" : "❌"} ${archivo}: ${ultima}`);
  if (r.status !== 0) {
    mal++;
    console.log((r.stdout || "").split("\n").filter((l) => l.includes("❌")).join("\n"), r.stderr || "");
  }
}
process.exitCode = mal ? 1 : 0;
