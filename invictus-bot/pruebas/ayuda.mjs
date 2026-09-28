// LO QUE NECESITAN TODAS LAS PRUEBAS PARA PODER CORRER.
//
// EL PROBLEMA QUE RESUELVE. El código de src/ no se puede importar desde
// Node tal cual, por dos motivos:
//
//   1. Importa los prompts como texto (import promptTexto from
//      "./prompts/texto.txt"). Eso lo hace Cloudflare al empaquetar, y
//      Node no sabe qué hacer con un .txt.
//   2. Usa D1, la base de datos de Cloudflare, que aquí no existe.
//
// Así que antes de cada prueba se arma una copia de src/ en una carpeta
// temporal con los .txt ya resueltos a texto, y se importa de ahí. La copia
// se tira al terminar. NUNCA se escribe nada dentro de src/.
//
// Y para D1 se usa node:sqlite (Node 22+), que es SQLite de verdad en
// memoria: las consultas que pasan aquí son las mismas que va a correr
// Cloudflare, no una imitación.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const AQUI = import.meta.dirname;
const SRC = path.join(AQUI, "..", "src");

// ── AFIRMAR ────────────────────────────────────────────────────────────
//
// Se lleva la cuenta en el módulo para que cada prueba termine con
// terminar() y el corredor sepa si pasó por el código de salida.
let fallos = 0;
let revisadas = 0;

export function ok(condicion, nombre, extra = "") {
  revisadas++;
  if (!condicion) fallos++;
  console.log(`${condicion ? "  ok  " : " FALLA"} ${nombre}${extra ? "  — " + extra : ""}`);
}

export function titulo(texto) {
  console.log(`\n── ${texto} ──`);
}

export function terminar() {
  console.log(
    fallos
      ? `\n${fallos} FALLOS de ${revisadas} comprobaciones\n`
      : `\n${revisadas} comprobaciones, todo verde\n`
  );
  process.exit(fallos ? 1 : 0);
}

// ── CARGAR UN MÓDULO DE src/ ───────────────────────────────────────────
//
// Se copia TODO src/ y no solo el archivo que se prueba, porque un módulo
// importa a otros y esos tienen que estar al lado para que resuelvan.
//
// "txt" permite cambiar el contenido de un prompt para esa prueba — así se
// comprueba qué hace el bot con pagos.txt vacío sin tener que vaciar el de
// verdad. Lo que no se nombre se lee del archivo real.
export async function prepararSrc({ txt = {} } = {}) {
  const destino = fs.mkdtempSync(path.join(os.tmpdir(), "pruebas-invictus-"));

  // Node decide si un .js es módulo o no por el package.json de al lado.
  // Sin esto, según la versión, lo trata como CommonJS y falla al ver
  // "export".
  fs.writeFileSync(path.join(destino, "package.json"), '{"type":"module"}');

  const leerPrompt = (ruta) => {
    if (Object.prototype.hasOwnProperty.call(txt, ruta)) return txt[ruta];
    return fs.readFileSync(path.join(SRC, ruta), "utf8");
  };

  for (const archivo of fs.readdirSync(SRC).filter((f) => f.endsWith(".js"))) {
    const original = fs.readFileSync(path.join(SRC, archivo), "utf8");

    // import promptTexto from "./prompts/texto.txt"
    //   →  const promptTexto = "...";
    const resuelto = original.replace(
      /import\s+(\w+)\s+from\s*"\.\/(prompts\/[\w.-]+\.txt)";/g,
      (_, nombre, ruta) => `const ${nombre} = ${JSON.stringify(leerPrompt(ruta))};`
    );

    fs.writeFileSync(path.join(destino, archivo), resuelto);
  }

  return {
    // Importa un módulo de esa copia. Se le cuelga la ruta para que dos
    // preparaciones distintas no compartan el caché de módulos de Node.
    async cargar(archivo) {
      return import(path.join(destino, archivo));
    },
    ruta: destino,
    limpiar() {
      fs.rmSync(destino, { recursive: true, force: true });
    },
  };
}

// Lee un prompt real de src/prompts, para las pruebas que comprueban el
// texto del prompt en sí.
export function prompt(nombre) {
  return fs.readFileSync(path.join(SRC, "prompts", nombre), "utf8");
}

export function fuente(nombre) {
  return fs.readFileSync(path.join(SRC, nombre), "utf8");
}

export function listaDeFuentes() {
  return fs.readdirSync(SRC).filter((f) => f.endsWith(".js"));
}

// ── D1 DE MENTIRA, SQLITE DE VERDAD ────────────────────────────────────
//
// Imita lo poco de la forma de D1 que usa el bot: prepare().bind().run() y
// .all(). Debajo hay SQLite real en memoria, así que un SQL mal escrito
// falla aquí igual que fallaría en Cloudflare.
export function baseDeMentira() {
  const sql = new DatabaseSync(":memory:");

  return {
    DB: {
      prepare(consulta) {
        let args = [];
        return {
          bind(...a) {
            args = a;
            return this;
          },
          async run() {
            sql.prepare(consulta).run(...args);
            return { success: true };
          },
          async all() {
            return { results: sql.prepare(consulta).all(...args) };
          },
          async first() {
            return sql.prepare(consulta).get(...args) ?? null;
          },
        };
      },
    },
    sql,
  };
}

// Una base que se cae a la primera. Sirve para comprobar que medir o
// anotar algo NUNCA deja a un cliente sin respuesta.
export function baseCaida() {
  return {
    DB: {
      prepare() {
        throw new Error("base caída (a propósito, es una prueba)");
      },
    },
  };
}
