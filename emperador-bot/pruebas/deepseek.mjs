// DEEPSEEK: el que atiende TODO en El Emperador, con dos modelos —uno para
// el texto y otro para las imágenes—, igual que antes estaba con Gemini.
//
// DeepSeek es de mentira (se cambia fetch). Se prueba lo nuestro: a qué
// modelo va cada cosa, que no se ponga a "pensar", que pida JSON con la
// forma escrita, que las fotos vayan dentro de la llamada, los errores en
// palabras claras, el gasto y lo que enseñan /estado y /probar-texto.

import { prepararSrc, baseDeMentira, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const DS = await src.cargar("deepseek.js");
const ia = await src.cargar("ia.js");
const { costeDe } = await src.cargar("gasto.js");
const { default: worker } = await src.cargar("index.js");

const ENV = { DB: baseDeMentira().DB, PROVEEDOR: "deepseek", DEEPSEEK_API_KEY: "sk-x", DEEPSEEK_MODELO: "deepseek-v4-pro", DEEPSEEK_MODELO_VISION: "deepseek-flash" };

titulo("quién atiende: DeepSeek, un modelo para el texto y otro para las imágenes");
ok(ia.quienAtiende(ENV, "texto").proveedor === "DeepSeek" && ia.quienAtiende(ENV, "vision").proveedor === "DeepSeek", "texto y fotos → DeepSeek");
ok(ia.quienAtiende(ENV, "texto").modelo === "deepseek-v4-pro", "el texto → deepseek-v4-pro", ia.quienAtiende(ENV, "texto").modelo);
ok(ia.quienAtiende(ENV, "vision").modelo === "deepseek-flash", "las fotos → deepseek-flash", ia.quienAtiende(ENV, "vision").modelo);
ok(ia.quienAtiende(ENV, "indice").modelo === "deepseek-flash", "el índice → el de las imágenes");
ok(ia.quienAtiende({}, "texto").proveedor === "DeepSeek" && ia.quienAtiende({}, "vision").modelo === "deepseek-flash",
   "sin nada puesto en wrangler.toml, también DeepSeek con sus dos modelos");
ok(ia.quienAtiende({ PROVEEDOR: "gemini" }, "texto").proveedor === "DeepSeek", 'un PROVEEDOR = "gemini" que quedó viejo → DeepSeek igual (Gemini ya no existe aquí)');
ok(ia.claveDe(ENV, "texto") === "DEEPSEEK_API_KEY" && ia.claveDe(ENV, "vision") === "DEEPSEEK_API_KEY", "una sola clave: DEEPSEEK_API_KEY");

// ── DeepSeek de mentira ───────────────────────────────────────────────
function deepseekDeMentira({ contenido = '{"respuesta":"¡Hola! ¿Qué estás buscando? 👟","buscar":"NADA","historial":"Saludó."}', estado = 200, rechazaThinking = false, error = "" } = {}) {
  const llamadas = [];
  const f = async (url, op = {}) => {
    const u = String(url);
    if (u.startsWith("https://api.deepseek.com/")) {
      const cuerpo = JSON.parse(op.body);
      llamadas.push({ url: u, cuerpo, auth: op.headers?.authorization });
      if (rechazaThinking && cuerpo.thinking) return new Response('{"error":{"message":"Unknown parameter: thinking"}}', { status: 400 });
      if (estado !== 200) return new Response(error, { status: estado });
      return Response.json({
        choices: [{ message: { content: contenido }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1000, prompt_cache_hit_tokens: 800, prompt_cache_miss_tokens: 200, completion_tokens: 50 },
      });
    }
    if (/foto\.jpg$/.test(u)) return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } });
    return new Response("", { status: 404 });
  };
  return { llamadas, f };
}
async function con(m, fn) {
  const real = globalThis.fetch, log = console.log, err = console.error;
  const errores = [];
  globalThis.fetch = m.f; console.log = () => {}; console.error = (...a) => errores.push(a.join(" "));
  DS.olvidarComoNoPensar();
  try { return { valor: await fn(), errores }; } finally { globalThis.fetch = real; console.log = log; console.error = err; }
}

titulo("la llamada de texto");
{
  const m = deepseekDeMentira();
  const { valor } = await con(m, () => ia.responderTexto(ENV, "Cliente: hola"));
  const c = m.llamadas[0]?.cuerpo || {};
  ok(m.llamadas.length === 1 && m.llamadas[0].url === "https://api.deepseek.com/chat/completions", "va a api.deepseek.com/chat/completions");
  ok(c.model === "deepseek-v4-pro", "con el modelo de TEXTO", c.model);
  ok(m.llamadas[0].auth === "Bearer sk-x", "con la DEEPSEEK_API_KEY");
  ok(c.thinking?.type === "disabled", 'sin "pensar" (más rápido y más barato para un chat)');
  ok(c.response_format?.type === "json_object", "pide JSON");
  ok(/FORMATO DE SALIDA[\s\S]*"respuesta"/.test(c.messages?.[0]?.content || ""), "y la forma exacta del JSON va escrita en el prompt de sistema");
  ok(typeof c.messages?.[1]?.content === "string", "sin fotos, el mensaje va como texto simple");
  ok(/Qué estás buscando/.test(JSON.stringify(valor)), "y la respuesta vuelve normal al resto del bot");
}

titulo("la llamada con foto: al modelo de IMÁGENES, con la foto dentro");
{
  const m = deepseekDeMentira({ contenido: '{"visto":"zapatilla","rasgos":[],"buscar":"jordan 4","color":"negro","variosProductos":false,"pedirNombreExacto":false}' });
  await con(m, () => ia.identificarEnImagen(ENV, "https://cdn.test/foto.jpg"));
  const c = m.llamadas[0]?.cuerpo || {};
  ok(c.model === "deepseek-flash", "con el modelo de IMÁGENES", c.model);
  const imagen = (c.messages?.[1]?.content || []).find?.((p) => p.type === "image_url");
  ok(/^data:image\/jpeg;base64,/.test(imagen?.image_url?.url || ""), "la foto va dentro de la llamada (DeepSeek no tiene que ir a buscarla)");
  ok(imagen?.image_url?.detail === "high", 'y conserva el detail "high"');
}

titulo('si DeepSeek no conoce "thinking", prueba la otra forma y la recuerda');
{
  const m = deepseekDeMentira({ rechazaThinking: true });
  const { valor } = await con(m, async () => {
    const r = await ia.responderTexto(ENV, "Cliente: hola");
    await ia.responderTexto(ENV, "Cliente: hola otra vez");
    return r;
  });
  ok(valor && m.llamadas[1]?.cuerpo?.reasoning_effort === "none", 'segunda forma: reasoning_effort "none"');
  ok(m.llamadas.length === 3 && !m.llamadas[2].cuerpo.thinking, "y la siguiente llamada ya va directo con la que funcionó", `${m.llamadas.length} llamadas`);
}

titulo("si DeepSeek piensa aunque se le pidió que no, la próxima vez prueba la otra forma");
{
  const m = deepseekDeMentira();
  const base = m.f;
  let vez = 0;
  m.f = async (url, op) => {
    const r = await base(url, op);
    if (!String(url).startsWith("https://api.deepseek.com/") || vez++ > 0) return r;
    const d = await r.json();
    d.choices[0].message.reasoning_content = "pensando...";
    return Response.json(d);
  };
  await con(m, async () => { await ia.responderTexto(ENV, "Cliente: hola"); await ia.responderTexto(ENV, "Cliente: hola"); });
  ok(m.llamadas[0].cuerpo.thinking && m.llamadas[1].cuerpo.reasoning_effort === "none", "la segunda llamada ya va con la otra forma");
}

titulo("los errores, en palabras que se puedan arreglar");
ok(/no tiene saldo/.test(DS.explicarFalloDeDeepSeek(402, '{"error":{"message":"Insufficient Balance"}}')), "402 → sin saldo, dónde recargar");
ok(/secret put DEEPSEEK_API_KEY/.test(DS.explicarFalloDeDeepSeek(401, "Authentication Fails")), "401 → la clave, con el comando");
ok(/caído u ocupado/.test(DS.explicarFalloDeDeepSeek(503, "")), "503 → caído, vuelve solo");
{
  const m = deepseekDeMentira({ estado: 402, error: '{"error":{"message":"Insufficient Balance"}}' });
  const { valor, errores } = await con(m, () => ia.responderTexto(ENV, "Cliente: hola"));
  ok(!/Qué estás buscando/.test(JSON.stringify(valor ?? "")), "sin saldo no inventa respuesta ni revienta");
  ok(errores.some((e) => /no tiene saldo/.test(e)), "y el registro dice que falta saldo");
  const sinClave = await con(deepseekDeMentira(), () => DS.llamarDeepSeek({}, "s", [{ type: "text", text: "hola" }]));
  ok(sinClave.valor === null && sinClave.errores.some((e) => /secret put DEEPSEEK_API_KEY/.test(e)), "sin clave avisa con el comando y devuelve null");
}

titulo("el gasto");
ok(costeDe({ modelo: "deepseek-flash", entrada: 1e6 }) > 0 && costeDe({ modelo: "deepseek-flash", entrada: 1e6 }) < 0.5, "deepseek-flash tiene su tarifa (no se cobra como gpt-4o)");
ok(costeDe({ modelo: "deepseek-v4-pro", entrada: 1e6 }) > costeDe({ modelo: "deepseek-flash", entrada: 1e6 }), "el pro cuesta más que el flash");
ok(costeDe({ modelo: "deepseek-flash", entrada: 1e6, cacheadas: 1e6 }) < costeDe({ modelo: "deepseek-flash", entrada: 1e6 }) / 10, "lo cacheado (los prompts fijos) sale casi gratis");

titulo("/estado y /probar-texto hablan de DeepSeek, y de Gemini nada");
{
  const m = deepseekDeMentira();
  const { valor: pagina } = await con(m, async () => (await worker.fetch(new Request("https://bot.test/estado"), ENV, { waitUntil() {} })).text());
  ok(/DEEPSEEK_API_KEY\s+cargado/.test(pagina), "la clave que enseña es la de DeepSeek");
  ok(/Texto \(redactar las respuestas\)\s+→ DeepSeek, deepseek-v4-pro/.test(pagina), "Texto → DeepSeek, deepseek-v4-pro");
  ok(/Fotos \(mirar, cotejar\)\s+→ DeepSeek, deepseek-flash/.test(pagina), "Fotos → DeepSeek, deepseek-flash");
  ok(!/gemini/i.test(pagina), "ni una palabra de Gemini");
  ok(!/OPENAI_API_KEY/.test(pagina), "ni la clave de OpenAI (no se usa: sería una alarma falsa)");

  const m2 = deepseekDeMentira();
  const { valor: prueba } = await con(m2, async () => (await worker.fetch(new Request("https://bot.test/probar-texto?mensaje=hola"), ENV, { waitUntil() {} })).text());
  ok(/El bot contestaría:\s+¡Hola! ¿Qué estás buscando\?/.test(prueba), "/probar-texto enseña lo que contestaría", prueba.split("\n")[2]);
  ok(/Modelo de texto: DeepSeek, deepseek-v4-pro/.test(prueba), "y con qué modelo");
  ok(m2.llamadas.length === 1 && m2.llamadas[0].cuerpo.model === "deepseek-v4-pro", "la llamada fue al modelo de TEXTO");
}

titulo("en src/ no queda nada de Gemini");
{
  const fs = await import("node:fs");
  const path = await import("node:path");
  const dir = path.join(import.meta.dirname, "..", "src");
  const con_ = fs.readdirSync(dir).filter((f) => f.endsWith(".js") && /gemini/i.test(fs.readFileSync(path.join(dir, f), "utf8")) && f !== "index.js");
  ok(!fs.existsSync(path.join(dir, "gemini.js")), "gemini.js ya no existe");
  ok(con_.length === 0, "ningún archivo lo nombra", con_.join(", "));
}

src.limpiar();
terminar();
