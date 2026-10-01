// EL wrangler.toml DE EL EMPERADOR: completo, con Gemini, sin OpenAI.
//
// Lee el wrangler.toml de AL LADO de pruebas/: en la carpeta del dueño,
// revisa SU archivo, el que de verdad va a Cloudflare. Pasado de Invictus
// (30-sep-2026), donde al wrangler.toml desplegado le faltaba el cron.

import fs from "node:fs";
import path from "node:path";
import { ok, titulo, terminar, listaDeFuentes, fuente } from "./ayuda.mjs";

const ARCHIVO = path.join(import.meta.dirname, "..", "wrangler.toml");
const toml = fs.existsSync(ARCHIVO) ? fs.readFileSync(ARCHIVO, "utf8") : "";

titulo("el archivo");
ok(toml.length > 0, "hay un wrangler.toml al lado de src/");
ok(/^name\s*=\s*"emperador-bot"/m.test(toml), 'el Worker se llama "emperador-bot" (no pisa a Invictus)');

const vistas = new Map();
const repetidas = [];
let seccion = "";
toml.split("\n").forEach((cruda, i) => {
  const linea = cruda.trim();
  if (!linea || linea.startsWith("#")) return;
  if (linea.startsWith("[")) {
    if (!linea.startsWith("[[")) {
      if (vistas.has(linea)) repetidas.push(`${linea} (líneas ${vistas.get(linea)} y ${i + 1})`);
      vistas.set(linea, i + 1);
    }
    seccion = linea;
    return;
  }
  const clave = linea.match(/^([A-Za-z0-9_]+)\s*=/)?.[1];
  if (!clave) return;
  const id = `${seccion}::${clave}`;
  if (vistas.has(id)) repetidas.push(`${clave} (líneas ${vistas.get(id)} y ${i + 1})`);
  vistas.set(id, i + 1);
});
ok(repetidas.length === 0, "nada repetido (el error de pegar el nuevo debajo del viejo)", repetidas.join(" · "));

titulo("lo que no puede faltar");
ok(/^\[triggers\]\s*$/m.test(toml) && /^crons\s*=\s*\[.*\*\/15/m.test(toml), "el cron [triggers] que llena el índice cada 15 minutos");
ok(/binding\s*=\s*"DB"/.test(toml) && /database_id\s*=\s*"[0-9a-f-]{36}"/.test(toml), "la base D1 con su database_id");

const bloque = toml.split(/^\[vars\]\s*$/m)[1]?.split(/^\[/m)[0] || "";
const vars = new Map([...bloque.matchAll(/^([A-Z0-9_]+)\s*=\s*"([^"]*)"/gm)].map((m) => [m[1], m[2]]));

titulo("la IA: todo con Gemini, dos modelos, nada de OpenAI");
ok((vars.get("PROVEEDOR") || "gemini") === "gemini", "PROVEEDOR es gemini");
ok(vars.get("GEMINI_MODELO"), "GEMINI_MODELO (el de texto) está puesto", vars.get("GEMINI_MODELO"));
ok(vars.get("GEMINI_MODELO_VISION"), "GEMINI_MODELO_VISION (el de imágenes) está puesto", vars.get("GEMINI_MODELO_VISION"));
ok(vars.get("GEMINI_MODELO") !== vars.get("GEMINI_MODELO_VISION"), "son DOS modelos distintos");
const deOpenAI = [...vars.keys()].filter((v) => /^OPENAI_/.test(v));
ok(deOpenAI.length === 0, "ninguna variable de OpenAI", deOpenAI.join(", "));
ok(!/secret put OPENAI_API_KEY/.test(toml) && /secret put GEMINI_API_KEY/.test(toml), "la clave que se pide cargar es la de Gemini");

titulo("ninguna variable de más");
const leidas = new Set();
for (const f of listaDeFuentes()) for (const m of fuente(f).matchAll(/env\.([A-Z][A-Z0-9_]+)/g)) leidas.add(m[1]);
const sobran = [...vars.keys()].filter((v) => !leidas.has(v));
ok(sobran.length === 0, "no hay variables que el código no lee (TIENDA, por ejemplo)", sobran.join(", "));
const SECRETOS = ["GEMINI_API_KEY", "OPENAI_API_KEY", "SHOPIFY_TOKEN", "SLACK_WEBHOOK", "META_APP_SECRET", "META_APP_SECRET_IG", "IG_TOKEN"];
const secretosAqui = [...vars.keys()].filter((v) => SECRETOS.includes(v));
ok(secretosAqui.length === 0, "ningún secreto escrito en el archivo", secretosAqui.join(", "));

titulo("lo que todavía falta rellenar (no es un fallo: es un aviso)");
for (const v of ["SHOPIFY_TIENDA", "URL_CATALOGO"]) {
  const pendiente = /PENDIENTE|CAMBIA-ESTO/i.test(vars.get(v) || "");
  console.log(`  ${pendiente ? "PENDIENTE" : "listo    "}  ${v} = ${vars.get(v) || "(vacío)"}`);
}

terminar();
