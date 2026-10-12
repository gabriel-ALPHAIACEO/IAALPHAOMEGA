// LA TIENDA WEB (12-oct-2026): el inventario como una página con catálogo
// estilo Shopify. Lo que se protege:
//   · sale lo que está en el inventario, y solo lo activo;
//   · NUNCA sale el costo ni nada interno;
//   · un modelo agotado sale marcado, una talla sin contar se ofrece;
//   · el buscador, el orden y la paginación funcionan;
//   · el producto trae sus opciones, su precio y su botón de WhatsApp;
//   · el carrito devuelve precio y stock de verdad (no los del navegador);
//   · la web NO descuenta stock;
//   · TIENDA_WEB = "no" la apaga, y las demás direcciones no se tocan.

import { prepararSrc, baseDeMentira, fuente, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const inv = await src.cargar("inventario.js");
const web = await src.cargar("catalogo-web.js");
const { DB } = baseDeMentira();
const [sede] = await inv.sedes(DB);

const idDe = (r) => r?.id ?? r;
async function crear(titulo, { precio, costo, foto, tallas = [["única", null]], marca = "", activo = true } = {}) {
  const id = idDe(await inv.guardarProducto(DB, { titulo, origen: "manual", origen_id: titulo, precio, costo, marca }));
  if (foto) await inv.guardarFotos(DB, id, [foto]);
  const ids = [];
  for (const [opcion, cantidad] of tallas) {
    const v = idDe(await inv.guardarVariante(DB, id, { opcion }));
    ids.push(v);
    if (cantidad != null) await inv.ajustarStock(DB, { varianteId: v, sedeId: sede.id, cantidad });
  }
  if (!activo) await DB.prepare("UPDATE inv_productos SET activo = 0 WHERE id = ?").bind(id).run();
  return { id, variantes: ids };
}

for (let i = 1; i <= 30; i++) await crear(`Nike Dunk modelo ${i} caballero`, { precio: 50 + i, tallas: [["única", 1]] });
const af1 = await crear("Nike Air Force One blanca caballero", { precio: 85, costo: 41.37, foto: "https://cdn.test/af1.jpg", tallas: [["40", 2], ["41", 0], ["42", null], ["43", 1]], marca: "Nike" });
const samba = await crear("Adidas Samba negra dama", { precio: 75, costo: 33.11, foto: "https://cdn.test/samba.jpg", tallas: [["única", 3]] });
const agotado = await crear("Retro 4 negro caballero", { precio: 120, costo: 70, tallas: [["única", 0]] });
const quitado = await crear("Producto quitado del inventario", { precio: 10, tallas: [["única", 5]], activo: false });

const env = { DB, WHATSAPP: "+584262992111", TIENDA_NOMBRE: "Invictus Shoes", TIENDA_INSTAGRAM: "@invictusmgta", TIENDA_COLOR: "#0a5cf5" };
const pedir = async (ruta, e = env, metodo = "GET") => {
  const r = await web.atenderCatalogoWeb(new Request(`https://tienda.test${ruta}`, { method: metodo }), e, { tienda: "Invictus Shoes", rubro: "calzado" });
  return r ? { estado: r.status, html: await r.text(), tipo: r.headers.get("content-type") || "" } : null;
};

titulo("el catálogo");
let c = await pedir("/tienda");
ok(c?.estado === 200 && /text\/html/.test(c.tipo), "responde 200 con una página");
ok(/Nike Air Force One blanca caballero/.test(c.html) && /Adidas Samba negra dama/.test(c.html), "salen los productos del inventario");
ok(/cdn\.test\/af1\.jpg/.test(c.html), "con su foto");
ok(/\$85/.test(c.html) && /\$75/.test(c.html), "con su precio");
ok(!/Producto quitado del inventario/.test(c.html), "lo quitado del inventario NO sale");
ok(!/41\.37|33\.11|\bcosto\b/i.test(c.html), "el costo NUNCA sale");
ok(/Invictus Shoes/.test(c.html) && /#0a5cf5/.test(c.html), "lleva el nombre y el color de la tienda");
ok(/instagram\.com\/invictusmgta/.test(c.html) && /wa\.me\/584262992111/.test(c.html), "y los botones de Instagram y WhatsApp");
ok(!/Retro 4 negro caballero/.test(c.html), "lo disponible va primero: el agotado no está en la primera página");
const ultima = await pedir("/tienda?p=2");
ok(/Retro 4 negro caballero/.test(ultima.html) && /Agotado/.test(ultima.html), "el agotado sale al final, marcado «Agotado»");
ok(/43 productos|33 productos/.test(c.html) || /\d+ productos/.test(c.html), "dice cuántos productos hay");

titulo("buscar, ordenar y paginar");
c = await pedir("/tienda?q=samba");
ok(/Adidas Samba negra dama/.test(c.html) && !/Nike Air Force One/.test(c.html), "el buscador filtra");
c = await pedir("/tienda?q=zzzz");
ok(/No encontramos nada/.test(c.html), "una búsqueda sin resultados lo dice");
c = await pedir("/tienda?q=nike+caballero");
ok(/Nike Air Force One/.test(c.html) && /Nike Dunk modelo/.test(c.html), "varias palabras: todas tienen que estar");
c = await pedir("/tienda?orden=precio-desc");
ok(c.html.indexOf("Nike Air Force One") < c.html.indexOf("Adidas Samba"), "orden por precio de mayor a menor");
c = await pedir("/tienda?orden=precio-asc");
const precios = [...c.html.matchAll(/class="tarj-precio">([^<]*)</g)].map((m) => Number(m[1].replace(/[^\d.]/g, "")));
ok(precios.length > 5 && precios.every((v, i) => i === 0 || v >= precios[i - 1]) && precios[0] === 51, "y de menor a mayor (arranca con el más barato, $51)", precios.slice(0, 5).join(","));
const p1 = await pedir("/tienda");
const p2 = await pedir("/tienda?p=2");
ok((p1.html.match(/class="tarj[ "]/g) || []).length === 24, "24 productos por página", String((p1.html.match(/class="tarj[ "]/g) || []).length));
ok(/Página 1 de 2/.test(p1.html) && /Siguiente/.test(p1.html) && /Página 2 de 2/.test(p2.html), "la paginación");
c = await pedir("/tienda?disponibles=1");
ok(!/Retro 4 negro caballero/.test(c.html), "«Solo disponibles» esconde los agotados");
c = await pedir("/tienda?q=%3Cscript%3Ealert(1)%3C/script%3E");
ok(!/<script>alert\(1\)/.test(c.html), "lo que se escribe en el buscador no se ejecuta");

titulo("un producto");
c = await pedir(`/tienda/p/${af1.id}`);
ok(c?.estado === 200 && /<h1>Nike Air Force One blanca caballero<\/h1>/.test(c.html), "la página del producto");
ok(/\$85/.test(c.html) && /name="variante"/.test(c.html), "con precio y sus opciones");
ok(/value="\d+" [^>]*disabled/.test(c.html), "la talla en 0 sale deshabilitada");
const habilitadas = (c.html.match(/name="variante" value="\d+"[^>]*>/g) || []).filter((x) => !/disabled/.test(x));
ok(habilitadas.length === 3, "la sin contar (42) sí se ofrece: 40, 42 y 43", String(habilitadas.length));
ok(/wa\.me\/584262992111\?text=/.test(c.html), "el botón de pedir por WhatsApp");
ok(/application\/ld\+json/.test(c.html) && /"price":"85"/.test(c.html) && /InStock/.test(c.html), "datos para Google (precio y disponibilidad)");
ok(!/41\.37/.test(c.html), "sin el costo");
c = await pedir(`/tienda/p/${samba.id}`);
ok(!/<fieldset class="opciones"/.test(c.html) && /id="agregar"/.test(c.html) && /data-variante="\d+"/.test(c.html), "un modelo de una sola opción no pide elegir talla");
c = await pedir(`/tienda/p/${agotado.id}`);
ok(/Agotado/.test(c.html) && !/id="agregar"/.test(c.html), "uno agotado no se puede agregar");
c = await pedir(`/tienda/p/${quitado.id}`);
ok(c?.estado === 404, "un producto quitado da 404");
c = await pedir("/tienda/p/999999");
ok(c?.estado === 404 && /no existe/.test(c.html), "uno que no existe da 404");

titulo("el carrito");
c = await pedir(`/tienda/api/carrito?v=${af1.variantes[0]}x2,${af1.variantes[1]}x1,999999x1`);
const j = JSON.parse(c.html);
ok(j.items.length === 2, "lo que no existe se descarta", String(j.items.length));
ok(j.items[0].precio === 85 && j.items[0].titulo.includes("Air Force") && j.items[0].etiqueta === "40" && j.items[0].max === 2, "precio, nombre, talla y tope de stock de verdad");
ok(j.items[1].max === 0, "una talla agotada llega con tope 0");
ok(!JSON.stringify(j).includes("41.37"), "sin el costo");
c = await pedir("/tienda/carrito");
ok(c?.estado === 200 && /Tu carrito/.test(c.html) && /pedir-todo/.test(c.html), "la página del carrito");

titulo("la web NO descuenta stock");
const antes = JSON.stringify((await DB.prepare("SELECT variante_id, cantidad FROM inv_stock ORDER BY variante_id").all()).results);
await pedir(`/tienda/p/${af1.id}`); await pedir("/tienda"); await pedir(`/tienda/api/carrito?v=${af1.variantes[0]}x2`);
const despues = JSON.stringify((await DB.prepare("SELECT variante_id, cantidad FROM inv_stock ORDER BY variante_id").all()).results);
ok(antes === despues, "después de navegar y pedir el carrito, el stock es el mismo");
const movs = (await DB.prepare("SELECT COUNT(*) AS n FROM inv_movimientos WHERE tipo = 'venta'").first()).n;
ok(Number(movs) === 0, "y no hay ninguna venta registrada");

titulo("direcciones y apagado");
ok((await pedir("/panel")) === null && (await pedir("/webhook")) === null && (await pedir("/")) === null, "las direcciones que no son de la tienda no se tocan");
ok((await pedir("/tienda", { ...env, TIENDA_WEB: "no" })) === null, "TIENDA_WEB = \"no\" la apaga");
const raiz = await pedir("/", { ...env, TIENDA_RAIZ: "si" });
ok(raiz?.estado === 200 && /Nike Air Force One/.test(raiz.html) && /href="\/p\/\d+"/.test(raiz.html), "con TIENDA_RAIZ = \"si\" también vive en / (dominio propio)");
c = await pedir("/tienda/sitemap.xml");
ok(/<urlset/.test(c.html) && new RegExp(`/tienda/p/${af1.id}<`).test(c.html) && !new RegExp(`/tienda/p/${quitado.id}<`).test(c.html), "el sitemap lista los productos activos");
ok((await pedir("/tienda", env, "POST")) === null, "solo responde a GET");
ok(!/SELECT[\s\S]{0,80}costo/i.test(fuente("catalogo-web.js").replace(/\/\/.*$/gm, "")), "el código de la web nunca consulta el costo");

titulo("está conectado en index.js");
ok(/atenderCatalogoWeb\(request, env,/.test(fuente("index.js")) && /from "\.\/catalogo-web\.js"/.test(fuente("index.js")), "index.js le da las direcciones /tienda");
ok(fuente("index.js").indexOf("atenderCatalogoWeb(request") < fuente("index.js").indexOf('url.pathname === "/panel"'), "y las mira antes que el panel");

terminar();
