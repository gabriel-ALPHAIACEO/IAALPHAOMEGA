// RODRIGO ES UNA TIENDA NUEVA (15-oct-2026): hecha desde la plantilla de El
// Emperador, pero sin NADA de otra tienda. Esta prueba mira que no se haya
// colado un dato ajeno (un teléfono, una dirección, una empresa de envíos, un
// id de base de datos) en los archivos que son de la tienda —wrangler.toml,
// los prompts, el logo y las páginas legales— y que lo básico arranque.

import fs from "node:fs";
import path from "node:path";
import { prepararSrc, baseDeMentira, ok, titulo, terminar } from "./ayuda.mjs";

const RAIZ = path.join(import.meta.dirname, "..");
const leer = (ruta) => fs.readFileSync(path.join(RAIZ, ruta), "utf8");
// Sin las líneas de nota (# … o // …): ahí se puede nombrar a otra tienda como ejemplo.
const sinNotas = (t) => t.split("\n").filter((l) => !/^\s*(#|\/\/|\*|\/\*)/.test(l)).join("\n");

const AJENO = /Emperador|Invictus|doble A|triple A|1\.1 top|por ZOOM|ZOOM y MRW|MRW|Margarita|Porlamar|Boulevard|Cancha Fray|Mercado la Isla|8dae7a41|b7cc27df|elemperadorca1992|invictusshoes|4224848573|4262992111|14lvw1gxxkZSMEdtZbvJ|8vds1e-jw/i;

titulo("los archivos de la tienda no traen nada de otra tienda");
for (const archivo of ["wrangler.toml", "src/prompts/texto.txt", "src/prompts/vision.txt", "src/prompts/comentarios.txt", "src/prompts/catalogo.txt", "src/prompts/modelos.txt", "src/prompts/indexar.txt", "src/prompts/cotejo.txt", "src/prompts/tienda.txt", "src/prompts/pagos.txt", "src/legal.js"]) {
  const t = sinNotas(leer(archivo));
  const hallado = t.match(AJENO);
  ok(!hallado, archivo, hallado ? `trae «${hallado[0]}»` : "");
}
const logo = leer("src/logo-tienda.js");
ok(!/iVBORw0KGgo/.test(logo) && /oscuro: ""/.test(logo), "el logo está vacío (la web usa un monograma, no el logo de otra tienda)");

titulo("el wrangler.toml es de Rodrigo");
{
  const toml = leer("wrangler.toml");
  ok(/^name\s*=\s*"rodrigo-bot"/m.test(toml) && /TIENDA_NOMBRE\s*=\s*"Rodrigo"/.test(toml), "Worker rodrigo-bot, tienda Rodrigo");
  ok(/database_name\s*=\s*"rodrigo-bot-db"/.test(toml) && /D1_NOMBRE\s*=\s*"rodrigo-bot-db"/.test(toml), "su propia base de datos");
  ok(/database_id\s*=\s*"PENDIENTE"/.test(toml), "database_id PENDIENTE: hay que crear la base antes de desplegar (así no usa la de otra tienda)");
  ok(/^WHATSAPP\s*=\s*""/m.test(toml) && /^DIRECCION\s*=\s*""/m.test(toml) && /^MAPS_URL\s*=\s*""/m.test(toml), "WhatsApp, dirección y mapa vacíos (los confirma un asesor)");
  ok(/META_VERIFY_TOKEN\s*=\s*"rodrigo2026"/.test(toml), "su propio token de verificación del webhook");
  ok(/CLAVE_RODRIGO/.test(toml), "el panel central lo conoce como CLAVE_RODRIGO");
}

titulo("lo básico arranca");
{
  const src = await prepararSrc();
  const { default: worker } = await src.cargar("index.js");
  const base = baseDeMentira();
  const env = { DB: base.DB, META_VERIFY_TOKEN: "rodrigo2026", META_APP_SECRET: "x", IG_TOKEN: "x", DEEPSEEK_API_KEY: "x", TIENDA_NOMBRE: "Rodrigo" };
  const ctx = { waitUntil: () => {} };
  const apreton = await worker.fetch(new Request("https://bot.test/webhook?hub.mode=subscribe&hub.verify_token=rodrigo2026&hub.challenge=PRUEBA12345"), env, ctx);
  ok(apreton.status === 200 && (await apreton.text()) === "PRUEBA12345", "el webhook contesta el reto de Meta con su token");
  const malo = await worker.fetch(new Request("https://bot.test/webhook?hub.mode=subscribe&hub.verify_token=emperador2026&hub.challenge=X"), env, ctx);
  ok(malo.status !== 200, "y el token de otra tienda NO sirve");
  const raiz = await worker.fetch(new Request("https://bot.test/"), env, ctx);
  ok((await raiz.text()) === "rodrigo-bot", "la raíz dice rodrigo-bot");
  const privacidad = await worker.fetch(new Request("https://bot.test/privacidad"), env, ctx);
  const texto = await privacidad.text();
  ok(privacidad.status === 200 && /Rodrigo/.test(texto) && !/Emperador/.test(texto), "la política de privacidad es de Rodrigo");
  const tienda = await worker.fetch(new Request("https://bot.test/tienda"), env, ctx);
  const web = await tienda.text();
  ok(tienda.status === 200 && /Rodrigo/.test(web) && !/Emperador|Invictus/.test(web), "la tienda web abre, con su nombre y sin el logo de otra tienda");
  src.limpiar();
}

terminar();
