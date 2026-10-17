// LAS FOTOS SUBIDAS DESDE EL PANEL, LA CATEGORÍA Y EL PRECIO CASHEA
// OBLIGATORIO (13-oct-2026, pedido del dueño: "que puedas subir imágenes de
// los productos", "eso de usado o estado del producto no va con los negocios
// que llevo" y "el precio Cashea en Venezuela no es para nada opcional").
//
// QUÉ SE PROTEGE.
//   · Se suben fotos al crear el producto y desde su ficha; quedan en la base
//     y se ven en /tienda/img/<id>.jpg (también con la tienda web apagada).
//   · Solo fotos de verdad (JPG, PNG, WEBP por sus bytes), con tope de peso
//     y de cantidad. «Principal» elige la primera; «Quitar» la borra.
//   · Sin precio Cashea no se crea ni se guarda un producto.
//   · En teléfonos ya no sale "condición"; todas tienen "Categoría".

import { prepararSrc, baseDeMentira, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const inv = await src.cargar("inventario.js");
const web = await src.cargar("catalogo-web.js");
const { atenderPanel } = await src.cargar("panel.js");
const { DB, sql } = baseDeMentira();
await inv.sedes(DB);

const ENV = { DB, PANEL_CLAVE: "clave-de-prueba", TIENDA_NOMBRE: "Prueba" };
const entrar = new FormData();
entrar.set("clave", "clave-de-prueba");
const cookie = ((await atenderPanel(new Request("https://bot.test/panel/entrar", { method: "POST", body: entrar }), ENV, { tienda: "Prueba" })).headers.get("set-cookie") || "").split(";")[0];
const pedir = (ruta, opciones = {}, init = {}) => atenderPanel(new Request(`https://bot.test${ruta}`, { ...init, headers: { cookie, "sec-fetch-site": "same-origin", ...(init.headers || {}) } }), ENV, { tienda: "Prueba", ...opciones });
const enviar = (ruta, campos, archivos = [], opciones = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.append(k, String(v));
  for (const a of archivos) f.append("fotos", new File([a.bytes], a.nombre, { type: a.tipo || "image/jpeg" }));
  return pedir(ruta, opciones, { method: "POST", body: f });
};
const donde = (r) => decodeURIComponent(r.headers.get("location") || "");
const JPG = (n = 300, marca = 1) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, marca, ...new Array(n).fill(marca)]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(100).fill(3)]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
const productos = () => sql.prepare("SELECT COUNT(*) AS n FROM inv_productos").get().n;

// ───────────────────────────────────────────────────────────────────────
titulo("Nuevo producto: fotos, categoría y precio Cashea obligatorio");
let html = await (await pedir("/panel/inventario/nuevo", { rubro: "telefonos" })).text();
ok(/enctype="multipart\/form-data"/.test(html) && /type="file" name="fotos" accept="image\/\*" multiple/.test(html), "el formulario sube fotos (varias a la vez)");
ok(!/Condición|usado|reacondicionado/i.test(html), "en teléfonos ya no sale «condición» (nuevo/usado)");
ok(/Categoría<input name="categoria" list="categorias-sugeridas"/.test(html) && /<option value="Relojes">/.test(html), "sale «Categoría», con sugerencias del negocio (Teléfonos, Relojes…)");
ok(/Precio Cashea<div class="monto chico"><span>\$<\/span><input name="precio_cashea"[^>]*required/.test(html) && !/Precio Cashea \(opcional\)/.test(html), "el precio Cashea es obligatorio (ya no dice «opcional»)");
html = await (await pedir("/panel/inventario/nuevo", { rubro: "moda" })).text();
ok(/Calidad<input name="gama"/.test(html) && /<option value="Bolsos">/.test(html), "en moda sigue «Calidad» (AA, AAA) y sugiere Calzados, Bolsos…");

let r = await enviar("/panel/inventario/nuevo", { titulo: "Reloj sin Cashea", precio: "50", opciones: "" });
ok(/precio Cashea: es obligatorio/.test(donde(r)) && productos() === 0, "sin precio Cashea no se crea nada", donde(r));
r = await enviar("/panel/inventario/nuevo", { titulo: "Reloj mal", precio: "50", precio_cashea: "mucho", opciones: "" });
ok(/tiene que ser un número/.test(donde(r)) && productos() === 0, "un precio Cashea que no es número, tampoco");

r = await enviar(
  "/panel/inventario/nuevo",
  { titulo: "Apple Watch Serie 9", marca: "Apple", categoria: "  Relojes ", precio: "300", precio_cashea: "345,50", opciones: "" },
  [{ bytes: JPG(400, 1), nombre: "frente.jpg" }, { bytes: PNG, nombre: "lado.png", tipo: "image/png" }, { bytes: SVG, nombre: "truco.jpg" }],
  { rubro: "telefonos" }
);
const reloj = sql.prepare("SELECT id, precio_cashea, extras FROM inv_productos WHERE titulo = 'Apple Watch Serie 9'").get();
ok(reloj && reloj.precio_cashea === 345.5, "se crea con su precio Cashea (345,50 → 345.5)", JSON.stringify(reloj));
ok(JSON.parse(reloj.extras).categoria === "Relojes", "y su categoría, limpia", reloj.extras);
let fotos = sql.prepare("SELECT id, url, orden FROM inv_fotos WHERE producto_id = ? ORDER BY orden").all(reloj.id);
ok(fotos.length === 2 && /^https:\/\/bot\.test\/tienda\/img\/\d+\.jpg$/.test(fotos[0].url) && /\.png$/.test(fotos[1].url), "las 2 fotos de verdad quedan, con su dirección pública", fotos.map((f) => f.url).join(" "));
ok(/No se subieron: truco\.jpg: no es una foto/.test(donde(r)) && /y 2 fotos/.test(donde(r)), "el SVG disfrazado de .jpg no entra, y se dice cuál", donde(r));

titulo("la foto se ve en /tienda/img (también con la tienda web apagada)");
const idFoto = Number(/img\/(\d+)\./.exec(fotos[0].url)[1]);
let f = await web.atenderCatalogoWeb(new Request(`https://bot.test/tienda/img/${idFoto}.jpg`), ENV, { tienda: "Prueba" });
const bytes = new Uint8Array(await f.arrayBuffer());
ok(f.status === 200 && f.headers.get("content-type") === "image/jpeg" && bytes.length === JPG(400, 1).length && bytes[10] === 1, "sale la misma foto, como JPG");
ok(/immutable/.test(f.headers.get("cache-control")) && f.headers.get("x-content-type-options") === "nosniff", "con caché larga y sin adivinar el tipo");
f = await web.atenderCatalogoWeb(new Request(`https://bot.test/tienda/img/${idFoto}.jpg`), { ...ENV, TIENDA_WEB: "no" }, { tienda: "Prueba" });
ok(f?.status === 200, "con TIENDA_WEB = \"no\" la foto se sigue viendo (el panel y el bot la usan)");
f = await web.atenderCatalogoWeb(new Request("https://bot.test/tienda/img/99999.jpg"), ENV, { tienda: "Prueba" });
ok(f.status === 404, "una que no existe: 404");
html = await (await web.atenderCatalogoWeb(new Request(`https://bot.test/tienda/p/${reloj.id}`), ENV, { tienda: "Prueba" })).text();
ok(html.includes(fotos[0].url), "la tienda web enseña la foto subida");

titulo("en la ficha: principal, quitar y subir más");
html = await (await pedir(`/panel/inventario/p/${reloj.id}`, { rubro: "telefonos" })).text();
ok(/Fotos <span class="chip">2\/10<\/span>/.test(html) && /fotos\/principal/.test(html) && /fotos\/quitar/.test(html) && /data-fotos data-auto/.test(html), "la ficha trae sus fotos con «Principal», «Quitar» y «Subir fotos»");
ok(/name="precio_cashea" value="345.5"[^>]*required/.test(html) && /name="categoria" list="categorias-sugeridas" maxlength="40" value="Relojes"/.test(html), "Editar trae el Cashea (obligatorio) y la categoría");
r = await enviar("/panel/inventario/fotos/principal", { producto: reloj.id, foto: fotos[1].id });
fotos = sql.prepare("SELECT id, url FROM inv_fotos WHERE producto_id = ? ORDER BY orden, id").all(reloj.id);
ok(/\.png$/.test(fotos[0].url) && /sale primero/.test(donde(r)), "«Principal»: la PNG sale primero ahora");
r = await enviar("/panel/inventario/fotos/quitar", { producto: reloj.id, foto: fotos[1].id });
ok(sql.prepare("SELECT COUNT(*) AS n FROM inv_fotos WHERE producto_id = ?").get(reloj.id).n === 1 && !sql.prepare("SELECT 1 FROM inv_imagenes WHERE id = ?").get(idFoto), "«Quitar»: sale del producto y se borra de la base");
r = await enviar("/panel/inventario/fotos/quitar", { producto: 999, foto: fotos[0].id });
ok(/ya no está/.test(donde(r)) && sql.prepare("SELECT COUNT(*) AS n FROM inv_fotos WHERE producto_id = ?").get(reloj.id).n === 1, "no se quita la foto de otro producto");
r = await enviar("/panel/inventario/fotos", { producto: reloj.id }, [{ bytes: JPG(1_600_000, 9), nombre: "enorme.jpg" }]);
ok(/enorme\.jpg: pesa demasiado/.test(donde(r)) && sql.prepare("SELECT COUNT(*) AS n FROM inv_fotos WHERE producto_id = ?").get(reloj.id).n === 1, "una foto de más de 1,5 MB no entra", donde(r));
r = await enviar("/panel/inventario/fotos", { producto: reloj.id }, Array.from({ length: 11 }, (_, i) => ({ bytes: JPG(50, i + 2), nombre: `f${i}.jpg` })));
ok(sql.prepare("SELECT COUNT(*) AS n FROM inv_fotos WHERE producto_id = ?").get(reloj.id).n === 10 && /ya tiene 10 fotos/.test(donde(r)), "como mucho 10 fotos por producto", donde(r).slice(0, 120));
r = await enviar("/panel/inventario/fotos", { producto: reloj.id }, []);
ok(/Elige al menos una foto/.test(donde(r)), "sin elegir fotos lo dice");
const fuera = await pedir("/panel/inventario/fotos", {}, { method: "POST", body: new FormData(), headers: { "sec-fetch-site": "cross-site" } });
ok(fuera.status === 403, "desde otra página no se puede subir nada");

titulo("Editar: Cashea obligatorio y la categoría");
r = await enviar("/panel/inventario/editar", { producto: reloj.id, titulo: "Apple Watch Serie 9", precio: "300", precio_cashea: "", categoria: "Relojes" });
ok(/es obligatorio/.test(donde(r)) && sql.prepare("SELECT precio_cashea FROM inv_productos WHERE id = ?").get(reloj.id).precio_cashea === 345.5, "sin Cashea no se guarda (queda el de antes)");
r = await enviar("/panel/inventario/editar", { producto: reloj.id, titulo: "Apple Watch Serie 9", precio: "300", precio_cashea: "350", categoria: "Accesorios" });
let fila = sql.prepare("SELECT precio_cashea, extras FROM inv_productos WHERE id = ?").get(reloj.id);
ok(fila.precio_cashea === 350 && JSON.parse(fila.extras).categoria === "Accesorios", "con Cashea se guarda, y cambia la categoría");
r = await enviar("/panel/inventario/editar", { producto: reloj.id, titulo: "Apple Watch Serie 9", precio: "300", precio_cashea: "350", categoria: "" });
ok(JSON.parse(sql.prepare("SELECT extras FROM inv_productos WHERE id = ?").get(reloj.id).extras).categoria === undefined, "vacía, la categoría se quita");
html = await (await pedir(`/panel/inventario/p/${reloj.id}`, { rubro: "calzado" })).text();
ok(/name="precio_cashea" inputmode="decimal" placeholder="El del modelo: \$350"/.test(html), "en una talla, el Cashea vacío usa el del modelo (y lo dice)");

terminar();
