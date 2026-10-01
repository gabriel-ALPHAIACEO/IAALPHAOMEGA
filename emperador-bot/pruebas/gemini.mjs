// EL ADAPTADOR DE GEMINI: que traduzca bien, y que no se active solo.
//
// QUÉ SE PROTEGE. Mover las fotos a otro proveedor toca el camino más caro
// y más delicado del bot. Tres cosas tienen que cumplirse siempre:
//
//   · Que sin PROVEEDOR_VISION no cambie NADA. Una tienda que no pidió
//     Gemini tiene que seguir hablando con OpenAI, exactamente igual.
//   · Que el esquema se traduzca bien. Si "additionalProperties" se cuela,
//     Gemini rechaza la llamada entera y el bot se queda sin visión.
//   · Que el orden de las partes se respete. En el cotejo, la foto del
//     cliente va ANTES que las del catálogo: si se mezclan, el modelo
//     compara contra lo que no es.

import { prepararSrc, ok, titulo, terminar, fuente } from "./ayuda.mjs";

const src = await prepararSrc();
const { modeloDeGemini } = await src.cargar("gemini.js");
const { costeDe } = await src.cargar("gasto.js");

titulo("qué modelo se usa");

ok(modeloDeGemini({}) === "gemini-3.1-flash-lite", "por defecto, el más barato y rápido", modeloDeGemini({}));
ok(modeloDeGemini({ GEMINI_MODELO: "gemini-3.5-flash" }) === "gemini-3.5-flash", "se puede cambiar desde wrangler.toml");
ok(
  !modeloDeGemini({}).includes("2.5"),
  "NO se usa 2.5 Flash-Lite por defecto: Google lo retira el 16-oct-2026"
);

titulo("la cuenta de Gemini, con sus tarifas");

ok(costeDe({ modelo: "gemini-3.1-flash-lite", entrada: 1e6 }) === 0.25, "Flash-Lite: $0,25 el millón de entrada");
ok(costeDe({ modelo: "gemini-3.1-flash-lite", salida: 1e6 }) === 1.5, "y $1,50 el de salida");
ok(costeDe({ modelo: "gemini-3.5-flash", entrada: 1e6 }) === 1.5, "3.5 Flash: $1,50 la entrada");

// El cargo por imagen es lo que decide si Gemini sale a cuenta o no.
const IMAGEN_GEMINI = 1120;
const IMAGEN_OPENAI_BAJA = 85;
const unaRonda = (img, tok) => 954 + img + 8 * img * 0 + 8 * tok + 70;

const rondaOpenAI = costeDe({ modelo: "gpt-4o", entrada: unaRonda(1100, IMAGEN_OPENAI_BAJA), salida: 300 });
const rondaGemini = costeDe({ modelo: "gemini-3.1-flash-lite", entrada: unaRonda(IMAGEN_GEMINI, IMAGEN_GEMINI), salida: 300 });

ok(rondaGemini < rondaOpenAI, "una ronda de cotejo sale más barata en Flash-Lite pese a las imágenes caras",
   `$${rondaOpenAI.toFixed(5)} → $${rondaGemini.toFixed(5)}`);

const ronda35 = costeDe({ modelo: "gemini-3.5-flash", entrada: unaRonda(IMAGEN_GEMINI, IMAGEN_GEMINI), salida: 300 });
ok(ronda35 > rondaOpenAI, "y en 3.5 Flash sale MÁS cara que en gpt-4o — subir de modelo no abarata",
   `$${ronda35.toFixed(5)}`);

titulo("los dos interruptores, y que ninguno se active solo");

const ia = fuente("ia.js");

// PROVEEDOR = "gemini"  → todo.  PROVEEDOR_VISION = "gemini" → solo fotos.
// Desde el 1-oct-2026, en El Emperador Gemini es lo normal: sin PROVEEDOR
// puesto, todo va a Gemini (pedido del dueño: "eliminar OpenAI").
ok(/String\(env\.PROVEEDOR \|\| "gemini"\)\.toLowerCase\(\)/.test(ia) && /if \(proveedor === "gemini"\) return true/.test(ia),
   'PROVEEDOR = "gemini" (o sin poner) manda TODO a Gemini');
ok(/\(tarea === "vision" \|\| tarea === "indice"\) && String\(env\.PROVEEDOR_VISION \|\| ""\)\.toLowerCase\(\) === "gemini"/.test(ia),
   'PROVEEDOR_VISION = "gemini" manda solo las fotos (y el índice)');
ok(/if \(porGemini\(env, tarea\)\)/.test(ia), "el desvío consulta esa decisión en un solo sitio");

// Lo más importante: sin ninguna de las dos variables, nada cambia.
const decision = (ia.split("function porGemini(env, tarea) {")[1] || "").split("\n}")[0];
ok(decision.length > 20, "encontré la función que decide");
ok(
  (decision.match(/env\.PROVEEDOR\b/g) || []).length === 1 &&
    (decision.match(/env\.PROVEEDOR_VISION\b/g) || []).length === 1,
  "decide SOLO por esas dos variables, nada más"
);
const devuelveTrue = decision.split("\n").filter((l) => /return true/.test(l));
ok(devuelveTrue.length > 0, "hay algún camino que sí activa Gemini");
ok(
  devuelveTrue.every((l) => /^\s*if \(/.test(l)),
  "y TODOS van detrás de un if: ninguno se activa solo",
  devuelveTrue.map((l) => l.trim()).join(" | ")
);

ok((ia.match(/tarea: "vision"/g) || []).length === 2 && (ia.match(/tarea: "indice"/g) || []).length === 1,
   "las tres llamadas con foto están marcadas: identificar y cotejo (fotos), indexar (índice)");
const cuerpoRedactar = (ia.split("export async function responderTexto")[1] || "").split("\n}")[0];
ok(cuerpoRedactar.length > 50, "encontré el cuerpo de responderTexto");
ok(!/tarea: "vision"/.test(cuerpoRedactar),
   "redactar no se marca como visión — con PROVEEDOR va a Gemini igual, con PROVEEDOR_VISION no");

titulo("la traducción del esquema");

const gem = fuente("gemini.js");
ok(/clave === "additionalProperties"/.test(gem), "additionalProperties se quita — Gemini rechaza la llamada si va");
ok(/String\(valor\)\.toUpperCase\(\)/.test(gem), "los tipos se pasan a mayúsculas");
ok(/clave === "properties"/.test(gem) && /clave === "items"/.test(gem), "properties e items se traducen hacia dentro");

titulo("las imágenes");

ok(/url\.startsWith\("data:"\)/.test(gem), "una foto que ya viene en data URI no se vuelve a bajar");
ok(/comoDataUri\(env, url\)/.test(gem), "y una URL de Shopify sí se baja: Gemini no sale a buscarla");
ok(/for \(const trozo of contenido\)/.test(gem), "las partes se recorren EN ORDEN (la foto del cliente va primero)");
ok(/inlineData: \{ mimeType/.test(gem), "se mandan como inlineData con su tipo");

titulo("que un fallo no deje al cliente colgado");

ok(/if \(!env\.GEMINI_API_KEY\)/.test(gem), "sin la clave avisa y devuelve null, no revienta");
ok(/npx\.cmd wrangler secret put GEMINI_API_KEY/.test(gem), "y el aviso dice el comando exacto para cargarla");
ok(/catch \(error\)/.test(gem), "un fallo de red se atrapa");
ok(/finishReason === "MAX_TOKENS"/.test(gem), "y si la respuesta se cortó, se dice por qué");
ok(/\} else if \(json\) \{/.test(gem),
   "una llamada que pida JSON sin esquema igual recibe JSON, no prosa");

src.limpiar();
// ───────────────────────────────────────────────────────────────────────
titulo("/estado dice la verdad: con todo en Gemini, texto Y fotos van a Gemini");
{
  const { baseDeMentira } = await import("./ayuda.mjs");
  const srcE = await prepararSrc();
  const { default: worker } = await srcE.cargar("index.js");
  const ia = await srcE.cargar("ia.js");
  const env = { DB: baseDeMentira().DB, PROVEEDOR: "gemini", GEMINI_MODELO: "gemini-3.1-flash-lite", GEMINI_API_KEY: "x" };
  ok(ia.quienAtiende(env, "texto").proveedor === "Gemini" && ia.quienAtiende(env, "vision").proveedor === "Gemini",
     "el texto y las fotos los atiende Gemini");
  ok(ia.quienAtiende(env, "texto").modelo !== ia.quienAtiende(env, "vision").modelo,
     "con DOS modelos distintos: uno redacta y otro mira");
  ok(ia.quienAtiende({ GEMINI_API_KEY: "x" }, "texto").proveedor === "Gemini",
     "sin PROVEEDOR puesto, también Gemini (OpenAI no se usa por defecto)");
  ok(ia.quienAtiende({ ...env, GEMINI_MODELO_VISION: "gemini-3.5-flash" }, "vision").modelo === "gemini-3.5-flash",
     "el de las fotos se cambia con GEMINI_MODELO_VISION");
  const log = console.log, error = console.error;
  console.log = () => {}; console.error = () => {};
  const pagina = await (await worker.fetch(new Request("https://bot.test/estado"), env, { waitUntil() {} })).text();
  console.log = log; console.error = error;
  ok(/Texto \(redactar las respuestas\)\s+→ Gemini, gemini-3\.1-flash-lite/.test(pagina), "dice: Texto → Gemini 3.1 Flash-Lite");
  ok(/Fotos \(mirar, cotejar\)\s+→ Gemini, gemini-3-flash/.test(pagina), "dice: Fotos → Gemini 3 Flash (otro modelo)");
  ok(/Índice \(catalogar el estante\)\s+→ Gemini, gemini-3-flash/.test(pagina), "dice: Índice → el de las imágenes");
  ok(ia.quienAtiende(env, "indice").modelo === ia.quienAtiende(env, "vision").modelo,
     "el índice y la foto del cliente, con el MISMO modelo de imágenes");
  ok(!/48%/.test(pagina), "ya no sale lo del '48% más barato' con dos proveedores");
  const openai = pagina.split("\n").filter((l) => /OpenAI/.test(l) && !/OpenAI no se usa/.test(l));
  ok(openai.length === 0, "y no nombra OpenAI en ningún otro sitio", openai.join(" | "));
  srcE.limpiar();
}

terminar();
