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

titulo("sin PROVEEDOR_VISION no cambia nada");

const ia = fuente("ia.js");
ok(/tarea === "vision" && fotosPorGemini\(env\)/.test(ia), "el desvío pide las DOS cosas: que sea foto y que la tienda lo haya pedido");
ok(/String\(env\.PROVEEDOR_VISION \|\| ""\)\.toLowerCase\(\) === "gemini"/.test(ia), "y sin la variable puesta, se queda en OpenAI");
ok((ia.match(/tarea: "vision"/g) || []).length === 3, "las tres llamadas con foto están marcadas: identificar, cotejo e indexar");
const cuerpoRedactar = (ia.split("export async function responderTexto")[1] || "").split("\n}")[0];
ok(cuerpoRedactar.length > 50, "encontré el cuerpo de responderTexto");
ok(!/tarea:/.test(cuerpoRedactar), "y redactar NO lleva tarea: el texto se queda en OpenAI, que es más barato");

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

src.limpiar();
terminar();
