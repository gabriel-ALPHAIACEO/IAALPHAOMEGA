// EL ASISTENTE DEL PANEL (8-oct-2026): asistente.js y la parte del
// asistente de negocio.js y negocio-panel.js.
//
// Lo que no se puede romper:
//   · preguntar funciona (antes cada pregunta fallaba con "opciones is not
//     defined");
//   · el botón "Asistente" sale en todas las páginas del panel;
//   · la IA recibe la guía del panel con las palabras de SU negocio, la
//     pantalla en la que está la persona y el stock del producto que nombra;
//   · el botón "Abrir …" solo para una pantalla que existe;
//   · la IA no registra nada sola: un gasto llega como propuesta.

import { prepararSrc, baseDeMentira, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const inv = await src.cargar("inventario.js");
const neg = await src.cargar("negocio.js");
const asis = await src.cargar("asistente.js");
const { rubroDe } = await src.cargar("marco.js");
const { atenderPanel } = await src.cargar("panel.js");

const { DB } = baseDeMentira();
const [sede] = await inv.sedes(DB);
const samba = await inv.guardarProducto(DB, { origen: "manual", titulo: "Adidas Samba OG", precio: 50 });
const t40 = await inv.guardarVariante(DB, samba, { opcion: "40" });
const t41 = await inv.guardarVariante(DB, samba, { opcion: "41" });
await inv.ajustarStock(DB, { varianteId: t40, sedeId: sede.id, cantidad: 3, tipo: "carga" });
await inv.ajustarStock(DB, { varianteId: t41, sedeId: sede.id, cantidad: 1, tipo: "carga" });
await inv.guardarProducto(DB, { origen: "manual", titulo: "Nike Air Force One", precio: 60 });

titulo("la guía del panel");
const guiaZapatos = asis.guiaDelPanel(rubroDe("calzado"));
const guiaTelefonos = asis.guiaDelPanel(rubroDe("telefonos"), { tarifaDeCaja: "cashea", conAnuncios: false });
ok(/tallas/.test(guiaZapatos) && !/IMEI/.test(guiaZapatos), "zapatería: habla de tallas, sin IMEI");
ok(/capacidades/.test(guiaTelefonos) && /IMEI/.test(guiaTelefonos) && /PRECIO CASHEA/.test(guiaTelefonos), "teléfonos: capacidades, IMEI y la regla de Cashea en la caja");
ok(!/\/panel\/anuncios/.test(guiaTelefonos) && /\/panel\/anuncios/.test(guiaZapatos), "Anuncios solo donde la tienda los tiene");
for (const [, [href]] of Object.entries(asis.PANTALLAS)) {
  if (href === "/panel/anuncios") continue;
  ok(guiaZapatos.includes(`(${href})`), `la guía explica ${href}`);
}

titulo("el botón Abrir …");
ok(asis.pantallaValida("/panel/inventario/etiquetas")?.nombre === "Etiquetas", "una dirección de la guía");
ok(asis.pantallaValida("inventario")?.href === "/panel/inventario", "o su clave");
ok(asis.pantallaValida("/panel/inventario?f=pocos")?.href === "/panel/inventario", "sin lo de después del ?");
ok(asis.pantallaValida("https://malo.example/") === null && asis.pantallaValida("/panel/inventado") === null, "nada que no sea del panel");
ok(asis.pantallaValida("/panel/anuncios", { conAnuncios: false }) === null, "Anuncios no, si la tienda no los tiene");

titulo("los productos que nombra");
let nombrados = await neg.productosQueNombra(DB, "¿cuántas samba me quedan en talla 40?");
ok(nombrados.length === 1 && nombrados[0].titulo === "Adidas Samba OG", "encuentra el Samba", JSON.stringify(nombrados.map((p) => p.titulo)));
ok(nombrados[0]?.quedanEnTotal === 4 && nombrados[0].variantes.find((v) => v.opcion === "40")?.quedan === 3, "con su stock talla por talla");
ok(nombrados[0]?.variantes[0].porSede[sede.nombre] !== undefined, "y por sede, con el nombre de la sede");
ok((await neg.productosQueNombra(DB, "¿cuánto vendí hoy?")).length === 0, "una pregunta sin producto no trae nada");

titulo("preguntar desde el panel");
const llamadas = [];
let respuestaDeLaIa = { respuesta: "Te quedan 3 en talla 40 y 1 en la 41.", ir: "/panel/inventario", accion: null };
globalThis.fetch = async (url, init) => {
  llamadas.push({ url: String(url), cuerpo: JSON.parse(init.body) });
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(respuestaDeLaIa) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
};

const ENV = { DB, PANEL_CLAVE: "clave-de-prueba", TIENDA_NOMBRE: "Prueba", OPENAI_API_KEY: "sk-prueba" };
const entrar = new FormData();
entrar.set("clave", "clave-de-prueba");
const cookie = ((await atenderPanel(new Request("https://bot.test/panel/entrar", { method: "POST", body: entrar }), ENV, { tienda: "Prueba" })).headers.get("set-cookie") || "").split(";")[0];
const pedir = (ruta, opciones = {}, init = {}) =>
  atenderPanel(new Request(`https://bot.test${ruta}`, { ...init, headers: { cookie, "sec-fetch-site": "same-origin", ...(init.headers || {}) } }), ENV, { tienda: "Prueba", rubro: "calzado", ...opciones });
const preguntar = (cuerpo, opciones) =>
  pedir("/panel/asistente", opciones, { method: "POST", body: JSON.stringify(cuerpo), headers: { "content-type": "application/json", accept: "application/json" } }).then((r) => r.json());

let r = await preguntar({ pregunta: "¿Cuántas Samba me quedan?", pantalla: "caja", historial: [] });
ok(r.ok === true, "contesta (antes: \"opciones is not defined\")", r.error || "");
ok(r.respuesta === respuestaDeLaIa.respuesta, "con lo que dijo la IA");
ok(r.ir?.href === "/panel/inventario" && r.ir?.nombre === "Inventario", "y el botón para abrir Inventario");
const sistema = llamadas.at(-1)?.cuerpo.messages[0].content || "";
ok(/GUÍA DEL PANEL/.test(sistema) && /tallas/.test(sistema), "la IA recibe la guía del panel con las palabras de la zapatería");
ok(/PANTALLA EN LA QUE ESTÁ: Caja/.test(sistema), "y sabe que está en la Caja");
ok(/"productosQueNombra":\[\{"titulo":"Adidas Samba OG"/.test(sistema), "y el stock del Samba que nombró");
ok(/"chat":\{/.test(sistema), "y los números del chat");

respuestaDeLaIa = { respuesta: "Ya estás en Inventario.", ir: "/panel/inventario", accion: null };
r = await preguntar({ pregunta: "¿qué hago aquí?", pantalla: "inventario" });
ok(r.ok && r.ir === null, "no ofrece abrir la pantalla en la que ya está");

respuestaDeLaIa = { respuesta: "Mira aquí", ir: "https://otro.sitio/", accion: null };
r = await preguntar({ pregunta: "¿dónde veo eso?", pantalla: "inicio" });
ok(r.ok && r.ir === null, "un enlace de fuera no sale como botón");

respuestaDeLaIa = { respuesta: "Te lo dejo listo.", ir: null, accion: { tipo: "gasto", monto: 20, categoria: "Transporte", descripcion: "taxi" } };
r = await preguntar({ pregunta: "gasté 20 en taxi", pantalla: "gastos" });
const gastos = (await DB.prepare("SELECT COUNT(*) AS n FROM neg_gastos").first().catch(() => ({ n: 0 })))?.n || 0;
ok(r.ok && r.accion?.tipo === "gasto" && r.accion.monto === 20 && gastos === 0, "un gasto llega como propuesta y NO se registra solo");

r = await preguntar({ pregunta: "¿cuánto vendí?" }, { rubro: "telefonos", tarifaDeCaja: "cashea", conAnuncios: false });
const sistemaTelefonos = llamadas.at(-1)?.cuerpo.messages[0].content || "";
ok(r.ok && /capacidades/.test(sistemaTelefonos) && /PRECIO CASHEA/.test(sistemaTelefonos), "en la tienda de teléfonos, su guía (capacidades, Cashea)");

r = await preguntar({ pregunta: "hola" }, {});
ok(r.ok, "sin pantalla también contesta");

titulo("el botón en todas las páginas");
for (const ruta of ["/panel/inicio", "/panel/caja", "/panel/inventario", "/panel/gastos", "/panel/clientes", "/panel"]) {
  const html = await (await pedir(ruta)).text();
  ok(html.includes('class="asis-boton') && html.includes('id="asis-ventana"') && (html.match(/if\(window\.__alphaAsistente\)/g) || []).length === 1, `${ruta}: botón Asistente, su ventana y un solo script`);
}
const inicio = await (await pedir("/panel/inicio")).text();
ok(/data-ia-charla[\s\S]*data-ia-form/.test(inicio) && (inicio.match(/data-ia-charla(?=[\s>])/g) || []).length === 2, "Inicio: la tarjeta y el botón comparten la misma charla");
const caja = await (await pedir("/panel/caja")).text();
ok(/data-pantalla="caja"/.test(caja) && /¿Cómo cobro con la cámara\?/.test(caja), "en la Caja, preguntas de la Caja");
const entrada = await (await atenderPanel(new Request("https://bot.test/panel/inicio"), ENV, { tienda: "Prueba" })).text();
ok(!entrada.includes('class="asis-boton'), "en la pantalla de la clave no sale");

terminar();
