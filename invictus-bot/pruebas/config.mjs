// EL wrangler.toml: que esté completo y sin duplicados, ANTES de desplegar.
//
// POR QUÉ EXISTE (30-sep-2026). El wrangler.toml que tenía desplegado el
// dueño NO traía el bloque [triggers]: el cron que llena el índice del
// catálogo cada 15 minutos no corría, y nadie lo sabía. Y traía la
// ubicación en variables cruzadas (el enlace de Maps en DIRECCION). Nada de
// eso da error en ninguna parte: simplemente el bot funciona peor.
//
// Como esta prueba lee el wrangler.toml de AL LADO de pruebas/, cuando se
// corre en la carpeta del dueño revisa SU archivo, el que de verdad va a
// Cloudflare.
//
// Basado en comprobar-config.py (25-sep-2026), que se quedó en otra rama.

import fs from "node:fs";
import path from "node:path";
import { ok, titulo, terminar, listaDeFuentes, fuente } from "./ayuda.mjs";

const ARCHIVO = path.join(import.meta.dirname, "..", "wrangler.toml");
const toml = fs.existsSync(ARCHIVO) ? fs.readFileSync(ARCHIVO, "utf8") : "";

titulo("el archivo");
ok(toml.length > 0, "hay un wrangler.toml al lado de src/");

// ── Claves y tablas repetidas: el fallo de pegar el nuevo DEBAJO del viejo.
const vistas = new Map();
const repetidas = [];
let seccion = "";
toml.split("\n").forEach((cruda, i) => {
  const linea = cruda.trim();
  if (!linea || linea.startsWith("#")) return;
  if (linea.startsWith("[")) {
    // [[d1_databases]] y [[rules]] se pueden repetir; [vars] dos veces no.
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

ok(/^\[triggers\]\s*$/m.test(toml) && /^crons\s*=\s*\[.*\*\/15/m.test(toml),
   "el cron [triggers] que llena el índice cada 15 minutos");
ok(/^\[\[d1_databases\]\][\s\S]*?binding\s*=\s*"DB"/m.test(toml), "la base D1 con binding DB");

const vars = new Map();
const bloque = toml.split(/^\[vars\]\s*$/m)[1]?.split(/^\[/m)[0] || "";
for (const m of bloque.matchAll(/^([A-Z0-9_]+)\s*=\s*"([^"]*)"/gm)) vars.set(m[1], m[2]);

for (const nombre of ["URL_CATALOGO", "SHOPIFY_TIENDA", "META_VERIFY_TOKEN", "OPENAI_MODELO", "OPENAI_MODELO_VISION"]) {
  ok(vars.get(nombre), `${nombre} está puesto`);
}

titulo("la ubicación");

const direccion = vars.get("DIRECCION") || "";
const maps = vars.get("MAPS_URL") || "";
const foto = vars.get("FOTO_LOCAL") || "";
ok(direccion && !/^https?:\/\//.test(direccion) && !/PENDIENTE/i.test(direccion),
   "DIRECCION es el TEXTO de la dirección (no un enlace, no PENDIENTE)", direccion.slice(0, 50));
ok(/^https?:\/\//.test(maps), "MAPS_URL es un enlace de Google Maps", maps || "(vacío)");
ok(!foto || !/maps\.app\.goo\.gl|google\.[a-z.]+\/maps|photos\.app\.goo\.gl|instagram\.com/.test(foto),
   "FOTO_LOCAL, si está, no es un mapa ni una página (saldría una foto rota)", foto || "(vacío: sin foto)");

titulo("ninguna variable de más ni de menos");

// Lo que lee el código: env.ALGO en cualquier .js de src/.
const leidas = new Set();
for (const f of listaDeFuentes()) for (const m of fuente(f).matchAll(/env\??\.([A-Z][A-Z0-9_]+)/g)) leidas.add(m[1]);
const SECRETOS = new Set(["OPENAI_API_KEY", "SHOPIFY_TOKEN", "SLACK_WEBHOOK", "META_APP_SECRET_IG", "META_APP_SECRET", "IG_TOKEN"]);

const sobran = [...vars.keys()].filter((v) => !leidas.has(v));
ok(sobran.length === 0, "no hay variables que el código ya no lee", sobran.join(", "));

const secretosEnElArchivo = [...vars.keys()].filter((v) => SECRETOS.has(v));
ok(secretosEnElArchivo.length === 0, "ningún SECRETO escrito en el archivo (van con wrangler secret put)",
   secretosEnElArchivo.join(", "));

terminar();
