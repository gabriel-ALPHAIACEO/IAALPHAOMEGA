// LA TIENDA WEB: EL INVENTARIO, EN UNA PÁGINA CON CATÁLOGO ESTILO SHOPIFY
// (12-oct-2026, pedido del dueño: "todo lo que está en el inventario, que se
// pase a una página web con catálogo estilo Shopify").
//
// QUÉ ES. Una página pública que sale de la MISMA base del inventario
// (inv_productos, inv_variantes, inv_fotos, inv_stock): lo que se cambia en
// el panel se ve en la web al recargar. No hay otra base ni otra copia.
//
//   /tienda                 el catálogo: buscador, filtros, orden, cuadrícula
//   /tienda/p/<id>          un producto: fotos, opciones (talla), precio
//   /tienda/carrito         el carrito (vive en el navegador de quien compra)
//   /tienda/api/carrito     los datos del carrito (precio y stock de verdad)
//   /tienda/pagar           pagar en la página: datos, método y comprobante
//   /tienda/api/pedido      (POST) guarda el pedido con su comprobante
//   /tienda/pedido/<código>?t=<clave>   cómo va el pedido (para el cliente)
//   /tienda/sitemap.xml     para Google
//
// CÓMO SE COMPRA. Dos caminos (12-oct-2026):
//   · PAGAR AQUÍ: el cliente elige cómo paga (Pago Móvil, Transferencia,
//     Zelle, Zinli… lo que la tienda cargó en el panel), ve los datos, paga
//     y SUBE EL COMPROBANTE. Queda "por revisar" en el panel (Pedidos web);
//     al aprobarlo se anota la venta. Ver pedidos-web.js.
//   · POR WHATSAPP: el carrito arma el pedido y lo manda por WhatsApp, como
//     siempre. Si la tienda no cargó ningún método con datos, es el único.
// En los dos, una persona confirma el pago y es QUIEN DESCUENTA EL STOCK
// (regla del dueño). La web nunca descuenta ni aparta nada.
//
// EL DISEÑO es el mismo de los paneles de ALPHA IA (fondo oscuro con brillos,
// vidrio, letra Manrope, íconos propios, animaciones y el interruptor ☀️/🌙
// para el tema claro), pero con la forma de una tienda tipo Shopify: portada,
// colecciones, cuadrícula de productos, ficha con tallas y carrito lateral.
// El logo sale de logo-tienda.js (el de cada tienda; vacío = monograma).
//
// QUÉ SE MUESTRA. Solo lo activo: un modelo quitado del inventario o una
// variante oculta no sale. NUNCA salen el costo, las ventas ni los
// movimientos. Una talla sin contar se ofrece (igual que el bot); una
// contada en 0 sale tachada, "Agotado".
//
// SE CONFIGURA EN wrangler.toml (todo opcional):
//   TIENDA_WEB       = "no"       apaga la web (por defecto está encendida)
//   TIENDA_RAIZ      = "si"       también en "/" (para un dominio propio)
//   TIENDA_COLOR     = "#d42a2d"  el color de la marca (botones, brillos)
//   TIENDA_LEMA      = "..."      la frase bajo el nombre, en la portada
//   TIENDA_ANUNCIO   = "..."      una franja de texto arriba (envíos, etc.)
//   TIENDA_INSTAGRAM = "usuario"  el botón de Instagram del pie
//   WHATSAPP         el número al que llegan los pedidos (el mismo del bot)
//   TIENDA_NOMBRE    el nombre que sale arriba

import { asegurarInventario } from "./inventario.js";
import { SPRITE_ICONOS, icono } from "./iconos.js";
import { botonDeTema, SCRIPT_TEMA } from "./alpha.js";
import { LOGO } from "./logo-tienda.js";
import { pagosParaLaWeb, metodosVisibles, crearPedido, pedidoPublico, PedidoInvalido, MAXIMO_COMPROBANTE, bolivares } from "./pedidos-web.js";
import { alertarCentral } from "./registro.js";
import { fotoSubida, RUTA_DE_FOTOS } from "./fotos.js";

const PREFIJO = "/tienda";
const POR_PAGINA = 24;


/* ── Utilidades ──────────────────────────────────────────────────── */

const esc = (t) =>
  String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function dinero(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  const entero = Math.abs(v - Math.round(v)) < 0.005;
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: entero ? 0 : 2, maximumFractionDigits: entero ? 0 : 2 });
}

function rangoDePrecio(min, max) {
  if (min == null || min === "") return "";
  if (max == null || Number(max) === Number(min)) return dinero(min);
  return `${dinero(min)} – ${dinero(max)}`;
}

// El color de la marca. Con logo (El Emperador) el rojo del casco; sin logo,
// el azul de ALPHA IA. TIENDA_COLOR manda sobre los dos.
function colorSeguro(env) {
  const c = String(env?.TIENDA_COLOR || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  return LOGO.oscuro ? "#d42a2d" : "#3d86ff";
}

function numeroDeWhatsApp(env) {
  return String(env?.WHATSAPP || "").replace(/\D/g, "");
}

function enlaceWhatsApp(env, texto) {
  const n = numeroDeWhatsApp(env);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(texto)}` : "";
}

// 38, 38.5, 39, … antes que "S", "M", "L"; lo demás, por orden de nombre.
function ordenDeOpcion(a, b) {
  const na = parseFloat(String(a.opcion).replace(",", "."));
  const nb = parseFloat(String(b.opcion).replace(",", "."));
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb || String(a.color).localeCompare(String(b.color));
  if (Number.isFinite(na)) return -1;
  if (Number.isFinite(nb)) return 1;
  return String(a.opcion).localeCompare(String(b.opcion), "es") || String(a.color).localeCompare(String(b.color));
}

const ES_UNICA = (v) => /^[uú]nica$/i.test(String(v.opcion).trim()) && !String(v.color || "").trim();

function etiquetaDeVariante(v) {
  return ES_UNICA(v) ? "" : [v.opcion, v.color].filter((x) => String(x || "").trim()).join(" · ");
}

// Una variante se ofrece si NUNCA se contó (igual que el bot) o si quedan.
const disponible = (v) => !Number(v.contada) || Number(v.stock) > 0;

const bonito = (t) => {
  const s = String(t || "").trim().toLowerCase();
  return s ? s[0].toUpperCase() + s.slice(1) : "";
};

/* ── El logo ─────────────────────────────────────────────────────── */

// La marca de la tienda: el logo si hay (en sus dos versiones, y el CSS deja
// ver la del tema activo), o un monograma con la inicial.
function marcaCompleta(tienda, base) {
  if (LOGO.oscuro) {
    return `<img class="lg lg-oscuro" src="${base}/logo/oscuro.png" alt="${esc(tienda)}" width="560" height="${Math.round(560 * LOGO.proporcion.oscuro)}"><img class="lg lg-claro" src="${base}/logo/claro.png" alt="" aria-hidden="true" width="560" height="${Math.round(560 * LOGO.proporcion.claro)}">`;
  }
  return `<span class="monograma grande">${esc(String(tienda).trim()[0] || "·")}</span>`;
}

function marcaCorta(tienda, base) {
  const simbolo = LOGO.casco
    ? `<img class="lg-casco" src="${base}/logo/casco.png" alt="" width="${Math.round(36 / LOGO.proporcion.casco)}" height="36">`
    : `<span class="monograma">${esc(String(tienda).trim()[0] || "·")}</span>`;
  return `${simbolo}<span class="marca-n">${esc(tienda)}</span>`;
}

function bytesDeBase64(b64) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

async function respuestaFoto(env, ruta) {
  const m = /^\/tienda\/img\/(\d+)\.(?:jpg|png|webp)$/.exec(ruta);
  const foto = m && env?.DB ? await fotoSubida(env.DB, m[1]) : null;
  if (!foto) return new Response("No existe esa foto", { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(foto.bytes, {
    headers: {
      "content-type": foto.tipo,
      // Una foto subida no cambia nunca (otra foto es otro número).
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
      "access-control-allow-origin": "*",
    },
  });
}

function respuestaLogo(cual) {
  const b64 = LOGO[cual];
  if (!b64 || !["oscuro", "claro", "casco", "icono"].includes(cual)) return new Response("No hay logo", { status: 404 });
  return new Response(bytesDeBase64(b64), { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400, s-maxage=86400" } });
}

/* ── La página (el marco de todas) ───────────────────────────────── */

function pagina({ env, tienda, titulo, descripcion = "", imagen = "", cuerpo, raiz, activo = "", categorias = [] }) {
  const color = colorSeguro(env);
  const base = raiz ? "" : PREFIJO;
  const anuncio = String(env?.TIENDA_ANUNCIO || "").trim();
  const ig = String(env?.TIENDA_INSTAGRAM || "").replace(/^@/, "").trim();
  const wa = enlaceWhatsApp(env, `Hola ${tienda} 👋`);
  const mapa = /^https:\/\//i.test(String(env?.MAPS_URL || "")) ? String(env.MAPS_URL) : "";
  const enlaces = categorias.slice(0, 4).map((c) => `<a href="${base || "/"}?cat=${encodeURIComponent(c.cat)}"${activo === `cat:${c.cat}` ? ' class="on"' : ""}>${esc(bonito(c.cat))}</a>`).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(titulo)}</title>
${descripcion ? `<meta name="description" content="${esc(descripcion)}">` : ""}
<meta property="og:title" content="${esc(titulo)}"><meta property="og:type" content="website"><meta property="og:site_name" content="${esc(tienda)}">
${descripcion ? `<meta property="og:description" content="${esc(descripcion)}">` : ""}
${imagen ? `<meta property="og:image" content="${esc(imagen)}">` : ""}
<meta name="theme-color" content="#05070d">
${LOGO.icono ? `<link rel="icon" type="image/png" sizes="192x192" href="${base}/logo/icono.png"><link rel="apple-touch-icon" href="${base}/logo/icono.png">` : LOGO.casco ? `<link rel="icon" type="image/png" href="${base}/logo/casco.png">` : ""}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400..800&display=swap">
<style>${ESTILO(color)}</style>${SCRIPT_TEMA}</head>
<body data-base="${esc(base)}" data-wa="${esc(numeroDeWhatsApp(env))}" data-tienda="${esc(tienda)}">
${SPRITE_ICONOS}
${anuncio ? `<div class="anuncio">${esc(anuncio)}</div>` : ""}
<header class="cab"><div class="cab-in">
<a class="marca" href="${base || "/"}" aria-label="${esc(tienda)}">${marcaCorta(tienda, base)}</a>
<nav class="nav" aria-label="Secciones"><a href="${base || "/"}"${activo === "inicio" ? ' class="on"' : ""}>Catálogo</a>${enlaces}</nav>
<form class="buscar" action="${base || "/"}" method="get" role="search">${icono("buscar")}<input type="search" name="q" placeholder="Buscar productos" aria-label="Buscar productos" autocomplete="off"></form>
<div class="cab-der">${botonDeTema()}<button type="button" class="carro" data-abrir aria-label="Abrir el carrito">${icono("carrito")}<span id="carro-n" hidden>0</span></button></div>
</div></header>
<main id="contenido">${cuerpo}</main>
<footer class="pie"><div class="pie-in">
<div class="pie-marca">${marcaCompleta(tienda, base)}<p>Los precios están en dólares. Un asesor confirma la disponibilidad y el pago antes de cerrar tu compra.</p></div>
<div class="pie-links"><b>${esc(tienda)}</b>${wa ? `<a href="${esc(wa)}" target="_blank" rel="noopener">${icono("chats", { clase: "chico" })} WhatsApp</a>` : ""}${ig ? `<a href="https://instagram.com/${esc(ig)}" target="_blank" rel="noopener">${icono("camara", { clase: "chico" })} Instagram</a>` : ""}${mapa ? `<a href="${esc(mapa)}" target="_blank" rel="noopener">${icono("sede", { clase: "chico" })} Cómo llegar</a>` : ""}</div>
</div></footer>
<div class="cajon" id="cajon" aria-hidden="true"><div class="cajon-velo" data-cerrar></div>
<aside class="cajon-panel" role="dialog" aria-label="Tu carrito"><div class="cajon-cab"><h2>Tu carrito</h2><button type="button" class="icono-btn" data-cerrar aria-label="Cerrar">${icono("cerrar")}</button></div>
<div class="cw-carro" data-vacio-texto="Tu carrito está vacío">${CARRO_HTML(base, true)}</div></aside></div>
<script>${SCRIPT_COMUN}</script>
</body></html>`;
}

function CARRO_HTML(base, cajon = false) {
  return `<div class="lineas" data-lineas><p class="suave">Cargando…</p></div>
<div class="resumen" data-resumen hidden>
<div class="total"><span>Total</span><b data-total>$0</b></div>
<p class="suave" data-nota-pedido>El pedido va por WhatsApp: un asesor te confirma disponibilidad, pago y envío.</p>
<a class="boton principal grande" data-pagar href="${base}/pagar" hidden>${icono("tarjeta")} Pagar aquí</a>
<a class="boton principal grande" data-pedir href="#" target="_blank" rel="noopener">${icono("chats")} Pedir por WhatsApp</a>
${cajon ? `<a class="boton" href="${base}/carrito">Ver el carrito completo</a>` : ""}
</div>
<div class="vacio-c" data-vacio hidden>${icono("carrito", { clase: "enorme" })}<p>Tu carrito está vacío</p><a class="boton" href="${base || "/"}" data-cerrar>Ver el catálogo</a></div>`;
}

function respuestaHtml(html, { estado = 200, cache = "public, max-age=30, s-maxage=30" } = {}) {
  return new Response(html, { status: estado, headers: { "content-type": "text/html; charset=utf-8", "cache-control": cache, "x-content-type-options": "nosniff" } });
}

function noEncontrado(env, tienda, raiz) {
  const base = raiz ? "" : PREFIJO;
  return respuestaHtml(
    pagina({ env, tienda, raiz, titulo: `No encontrado · ${tienda}`, cuerpo: `<section class="vacio"><h1>Esa página no existe</h1><p class="suave">Puede que el producto ya no esté.</p><a class="boton principal" href="${base || "/"}">Ver el catálogo</a></section>` }),
    { estado: 404, cache: "no-store" }
  );
}

/* ── El catálogo ─────────────────────────────────────────────────── */

const ORDENES = {
  "": { texto: "Destacados", sql: "(disp > 0) DESC, p.actualizado DESC, p.id DESC" },
  "nuevo": { texto: "Más nuevos", sql: "(disp > 0) DESC, p.id DESC" },
  "precio-asc": { texto: "Precio: menor a mayor", sql: "(disp > 0) DESC, (pmin IS NULL), pmin ASC, p.titulo COLLATE NOCASE" },
  "precio-desc": { texto: "Precio: mayor a menor", sql: "(disp > 0) DESC, (pmin IS NULL), pmin DESC, p.titulo COLLATE NOCASE" },
  "nombre": { texto: "Nombre: A a Z", sql: "(disp > 0) DESC, p.titulo COLLATE NOCASE" },
};

const SQL_TARJETA = `
  SELECT p.id, p.titulo, p.marca, p.actualizado,
    (SELECT url FROM inv_fotos f WHERE f.producto_id = p.id ORDER BY f.orden, f.id LIMIT 1) AS foto,
    (SELECT url FROM inv_fotos f WHERE f.producto_id = p.id ORDER BY f.orden, f.id LIMIT 1 OFFSET 1) AS foto2,
    (SELECT MIN(COALESCE(v.precio, p.precio)) FROM inv_variantes v WHERE v.producto_id = p.id AND v.oculta = 0) AS pmin_v,
    (SELECT MAX(COALESCE(v.precio, p.precio)) FROM inv_variantes v WHERE v.producto_id = p.id AND v.oculta = 0) AS pmax_v,
    p.precio AS precio_base,
    COALESCE((SELECT MIN(COALESCE(v.precio, p.precio)) FROM inv_variantes v WHERE v.producto_id = p.id AND v.oculta = 0), p.precio) AS pmin,
    (SELECT COUNT(*) FROM inv_variantes v WHERE v.producto_id = p.id AND v.oculta = 0
       AND (NOT EXISTS (SELECT 1 FROM inv_stock s WHERE s.variante_id = v.id)
            OR (SELECT SUM(s2.cantidad) FROM inv_stock s2 WHERE s2.variante_id = v.id) > 0)) AS disp
  FROM inv_productos p`;

// Las colecciones: la categoría de cada producto (El Emperador la trae de su
// carpeta de Drive). Solo se muestran si hay dos o más.
async function coleccionesDe(db) {
  try {
    const { results } = await db
      .prepare(
        `SELECT json_extract(p.extras, '$.categoria') AS cat, COUNT(*) AS n,
                (SELECT url FROM inv_fotos f WHERE f.producto_id = MIN(p.id) ORDER BY f.orden, f.id LIMIT 1) AS foto
           FROM inv_productos p WHERE p.activo = 1 GROUP BY cat HAVING cat IS NOT NULL AND cat <> '' ORDER BY n DESC`
      )
      .all();
    const lista = (results || []).filter((c) => c.cat);
    return lista.length >= 2 ? lista : [];
  } catch {
    return [];
  }
}

async function chipsDeBusqueda(db, rubro) {
  const chips = [];
  if (rubro === "calzado" || rubro === "moda") {
    for (const [texto, q] of [["Dama", "dama"], ["Caballero", "caballero"], ["Niños", "niñ"]]) chips.push({ texto, q });
  }
  try {
    const { results } = await db.prepare("SELECT titulo FROM inv_productos WHERE activo = 1").all();
    const cuenta = new Map();
    for (const f of results || []) {
      const palabra = String(f.titulo || "").trim().split(/\s+/)[0];
      if (palabra.length < 3 || /^\d/.test(palabra)) continue;
      const k = palabra.toLowerCase();
      const previo = cuenta.get(k) || { texto: palabra, n: 0 };
      previo.n++;
      cuenta.set(k, previo);
    }
    [...cuenta.values()]
      .filter((c) => c.n >= 3)
      .sort((a, b) => b.n - a.n)
      .slice(0, 8)
      .forEach((c) => chips.push({ texto: bonito(c.texto), q: c.texto.toLowerCase() }));
  } catch {}
  return chips;
}

function tarjeta(p, base, n = 0) {
  const agotado = !Number(p.disp);
  const precio = rangoDePrecio(p.pmin_v ?? p.precio_base, p.pmax_v ?? p.precio_base) || "Consultar";
  return `<a class="tarj rev${agotado ? " agotada" : ""}" style="--n:${Math.min(n, 12)}" href="${base}/p/${p.id}">
<div class="tarj-foto">${p.foto ? `<img class="f1" src="${esc(p.foto)}" alt="${esc(p.titulo)}" loading="lazy" onerror="this.remove()">` : `<span class="sin-foto">${icono("foto", { clase: "grande" })}</span>`}${p.foto2 ? `<img class="f2" src="${esc(p.foto2)}" alt="" loading="lazy" onerror="this.remove()">` : ""}${agotado ? '<span class="insignia">Agotado</span>' : ""}</div>
<div class="tarj-pie"><span class="tarj-nombre">${esc(p.titulo)}</span><span class="tarj-precio">${esc(precio)}</span></div></a>`;
}

async function paginaCatalogo(request, env, { tienda, rubro, raiz }) {
  await asegurarInventario(env.DB);
  const url = new URL(request.url);
  const base = raiz ? "" : PREFIJO;
  const q = (url.searchParams.get("q") || "").trim().slice(0, 60);
  const cat = (url.searchParams.get("cat") || "").trim().slice(0, 60);
  const orden = ORDENES[url.searchParams.get("orden") || ""] ? url.searchParams.get("orden") || "" : "";
  const solo = url.searchParams.get("disponibles") === "1";
  const pag = Math.max(1, Math.min(200, parseInt(url.searchParams.get("p") || "1", 10) || 1));

  const donde = ["p.activo = 1"];
  const args = [];
  for (const palabra of q.split(/\s+/).filter(Boolean).slice(0, 5)) {
    donde.push("(p.titulo LIKE ? OR p.marca LIKE ?)");
    args.push(`%${palabra}%`, `%${palabra}%`);
  }
  if (cat) {
    donde.push("json_extract(p.extras, '$.categoria') = ?");
    args.push(cat);
  }
  const fuera = solo ? "WHERE p.disp > 0" : "";

  const total = Number((await env.DB.prepare(`SELECT COUNT(*) AS n FROM (${SQL_TARJETA} WHERE ${donde.join(" AND ")}) p ${fuera}`).bind(...args).first())?.n) || 0;
  const { results } = await env.DB.prepare(
    `SELECT * FROM (${SQL_TARJETA} WHERE ${donde.join(" AND ")}) p ${fuera} ORDER BY ${ORDENES[orden].sql} LIMIT ? OFFSET ?`
  )
    .bind(...args, POR_PAGINA, (pag - 1) * POR_PAGINA)
    .all();
  const productos = results || [];
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  const portada = !q && !cat && pag === 1 && !solo && !orden;
  const colecciones = await coleccionesDe(env.DB);
  const chips = q || cat ? [] : await chipsDeBusqueda(env.DB, rubro);
  let enStock = 0;
  if (portada) {
    enStock = Number((await env.DB.prepare(`SELECT COUNT(*) AS n FROM (${SQL_TARJETA} WHERE p.activo = 1) p WHERE p.disp > 0`).first())?.n) || 0;
  }

  const enlace = (cambios) => {
    const u = new URLSearchParams();
    const val = { q, cat, orden, disponibles: solo ? "1" : "", p: "", ...cambios };
    for (const [k, v] of Object.entries(val)) if (v) u.set(k, String(v));
    const s = u.toString();
    return `${base || "/"}${s ? `?${s}` : ""}`;
  };

  const lema = String(env?.TIENDA_LEMA || "").trim() || "Elige, agrégalo al carrito y pídelo por WhatsApp. Un asesor confirma tu pedido.";
  const wa = enlaceWhatsApp(env, `Hola ${tienda} 👋`);
  const heroe = portada
    ? `<section class="heroe rev" style="--n:0"><div class="heroe-aurora" aria-hidden="true"><i></i><i></i></div>
<div class="heroe-texto"><p class="sobre">${icono("etiqueta", { clase: "chico" })} Catálogo en línea</p><h1>${esc(tienda)}</h1><p class="lema">${esc(lema)}</p>
${wa ? `<div class="heroe-cta"><a class="boton principal grande" href="${esc(wa)}" target="_blank" rel="noopener">${icono("chats")} Escríbenos</a></div>` : ""}
<div class="heroe-datos"><span><b>${total}</b> productos</span><span><b>${enStock}</b> disponibles</span></div></div>
<div class="heroe-logo">${marcaCompleta(tienda, base)}</div></section>`
    : "";

  const tiles = portada && colecciones.length
    ? `<section class="colecciones"><h2>Colecciones</h2><div class="col-rejilla">${colecciones
        .slice(0, 6)
        .map((c, i) => `<a class="col rev" style="--n:${i + 1}" href="${base || "/"}?cat=${encodeURIComponent(c.cat)}">${c.foto ? `<img src="${esc(c.foto)}" alt="" loading="lazy" onerror="this.remove()">` : ""}<span class="col-vel"></span><span class="col-txt"><b>${esc(bonito(c.cat))}</b><small>${c.n} ${c.n === 1 ? "producto" : "productos"}</small></span></a>`)
        .join("")}</div></section>`
    : "";

  const titulo = q ? `Resultados para «${esc(q)}»` : cat ? esc(bonito(cat)) : "Todo el catálogo";
  const cuerpo = `${heroe}${tiles}<section class="cat" id="catalogo">
<div class="cat-cab rev"><h2>${titulo}</h2><p class="suave">${total} ${total === 1 ? "producto" : "productos"}</p></div>
${chips.length ? `<nav class="chips rev" aria-label="Atajos">${chips.map((c) => `<a href="${esc(enlace({ q: c.q }))}">${esc(c.texto)}</a>`).join("")}</nav>` : ""}
${cat || q ? `<p class="quitar-f"><a href="${base || "/"}">${icono("cerrar", { clase: "chico" })} Quitar filtros</a></p>` : ""}
<form class="barra" method="get" action="${base || "/"}">
${q ? `<input type="hidden" name="q" value="${esc(q)}">` : ""}${cat ? `<input type="hidden" name="cat" value="${esc(cat)}">` : ""}
<label class="check"><input type="checkbox" name="disponibles" value="1"${solo ? " checked" : ""} onchange="this.form.submit()"><span class="caja"></span> Solo disponibles</label>
<label class="orden">Ordenar <select name="orden" onchange="this.form.submit()">${Object.entries(ORDENES).map(([k, o]) => `<option value="${k}"${k === orden ? " selected" : ""}>${esc(o.texto)}</option>`).join("")}</select></label>
<noscript><button class="boton">Aplicar</button></noscript></form>
${productos.length ? `<div class="rejilla">${productos.map((p, i) => tarjeta(p, base, i)).join("")}</div>` : `<section class="vacio"><h2>No encontramos nada${q ? ` para «${esc(q)}»` : ""}</h2><p class="suave">Prueba con otra palabra o mira todo el catálogo.</p><a class="boton principal" href="${base || "/"}">Ver todo</a></section>`}
${paginas > 1 ? `<nav class="paginas" aria-label="Páginas">${pag > 1 ? `<a class="boton" href="${esc(enlace({ p: pag - 1 }))}">${icono("atras", { clase: "chico" })} Anterior</a>` : "<span></span>"}<span>Página ${pag} de ${paginas}</span>${pag < paginas ? `<a class="boton" href="${esc(enlace({ p: pag + 1 }))}">Siguiente ${icono("adelante", { clase: "chico" })}</a>` : "<span></span>"}</nav>` : ""}
</section>`;

  return respuestaHtml(
    pagina({ env, tienda, raiz, activo: cat ? `cat:${cat}` : "inicio", categorias: colecciones, titulo: q ? `${q} · ${tienda}` : cat ? `${bonito(cat)} · ${tienda}` : `Catálogo · ${tienda}`, descripcion: `Catálogo de ${tienda}: ${total} productos.`, imagen: productos[0]?.foto || "", cuerpo })
  );
}

/* ── Un producto ─────────────────────────────────────────────────── */

async function cargarProducto(db, id) {
  const p = await db
    .prepare("SELECT id, titulo, marca, gama, precio, precio_cashea, extras, actualizado FROM inv_productos WHERE id = ? AND activo = 1")
    .bind(id)
    .first();
  if (!p) return null;
  const fotos = ((await db.prepare("SELECT url FROM inv_fotos WHERE producto_id = ? ORDER BY orden, id").bind(id).all()).results || []).map((f) => f.url);
  const vars = (
    (
      await db
        .prepare(
          `SELECT v.id, v.opcion, v.color, v.precio, v.precio_cashea, v.foto,
                  (SELECT COALESCE(SUM(s.cantidad), 0) FROM inv_stock s WHERE s.variante_id = v.id) AS stock,
                  (SELECT COUNT(*) FROM inv_stock s WHERE s.variante_id = v.id) AS contada
             FROM inv_variantes v WHERE v.producto_id = ? AND v.oculta = 0`
        )
        .bind(id)
        .all()
    ).results || []
  ).sort(ordenDeOpcion);
  return { ...p, fotos, variantes: vars };
}

function precioDe(p, v) {
  return v?.precio ?? p.precio ?? null;
}

// "También te puede gustar": de la misma colección, o de la misma línea
// (primera palabra del nombre), lo disponible primero.
async function parecidosA(db, p) {
  let cat = "";
  try {
    cat = String(JSON.parse(p.extras || "{}").categoria || "");
  } catch {}
  const palabra = String(p.titulo || "").trim().split(/\s+/)[0];
  const donde = ["p.activo = 1", "p.id <> ?"];
  const args = [p.id];
  const o = [];
  if (cat) o.push("json_extract(p.extras, '$.categoria') = ?"), args.push(cat);
  if (palabra.length >= 3) o.push("p.titulo LIKE ?"), args.push(`${palabra}%`);
  if (!o.length) return [];
  donde.push(`(${o.join(" OR ")})`);
  try {
    const { results } = await db
      .prepare(`SELECT * FROM (${SQL_TARJETA} WHERE ${donde.join(" AND ")}) p ORDER BY (p.disp > 0) DESC, p.actualizado DESC LIMIT 4`)
      .bind(...args)
      .all();
    return results || [];
  } catch {
    return [];
  }
}

async function paginaProducto(env, id, { tienda, rubro, raiz }) {
  await asegurarInventario(env.DB);
  const p = Number.isInteger(id) && id > 0 ? await cargarProducto(env.DB, id) : null;
  if (!p) return noEncontrado(env, tienda, raiz);
  const base = raiz ? "" : PREFIJO;

  const hay = p.variantes.filter(disponible);
  const unica = p.variantes.length === 1 && ES_UNICA(p.variantes[0]);
  const primera = hay[0] || p.variantes[0] || null;
  const precio = precioDe(p, primera);
  const fotos = p.fotos.length ? p.fotos : primera?.foto ? [primera.foto] : [];
  const agotado = !hay.length;
  const textoPedido = `Hola 👋 Me interesa ${p.titulo}${primera && !unica ? ` (${etiquetaDeVariante(primera)})` : ""}${precio != null ? ` — ${dinero(precio)}` : ""}`;
  const wa = enlaceWhatsApp(env, textoPedido);
  const parecidos = await parecidosA(env.DB, p);
  let cat = "";
  try {
    cat = String(JSON.parse(p.extras || "{}").categoria || "");
  } catch {}

  const opciones = unica
    ? ""
    : `<fieldset class="opciones"><legend>${rubro === "telefonos" ? "Capacidad" : rubro === "calzado" || rubro === "moda" ? "Talla" : "Opción"}</legend><div class="pildoras">${p.variantes
        .map((v) => {
          const ok = disponible(v);
          return `<label class="pil${ok ? "" : " agotada"}"><input type="radio" name="variante" value="${v.id}" data-precio="${esc(precioDe(p, v) ?? "")}" data-etiqueta="${esc(etiquetaDeVariante(v))}" data-max="${ok ? (Number(v.contada) ? Math.min(Number(v.stock), 20) : 20) : 0}"${ok ? "" : " disabled"}${primera && v.id === primera.id ? " checked" : ""}><span>${esc(etiquetaDeVariante(v))}</span></label>`;
        })
        .join("")}</div></fieldset>`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.titulo,
    image: fotos.slice(0, 4),
    ...(p.marca ? { brand: { "@type": "Brand", name: p.marca } } : {}),
    ...(precio != null ? { offers: { "@type": "Offer", priceCurrency: "USD", price: String(precio), availability: agotado ? "https://schema.org/OutOfStock" : "https://schema.org/InStock" } } : {}),
  };

  const cuerpo = `<nav class="migas"><a href="${base || "/"}">Catálogo</a>${cat ? ` <span>/</span> <a href="${base || "/"}?cat=${encodeURIComponent(cat)}">${esc(bonito(cat))}</a>` : ""} <span>/</span> <span>${esc(p.titulo)}</span></nav>
<article class="prod" data-producto="${p.id}" data-variante="${primera ? primera.id : ""}" data-titulo="${esc(p.titulo)}" data-wa="${esc(numeroDeWhatsApp(env))}">
<div class="galeria rev">
<div class="gal-grande">${fotos[0] ? `<img id="foto-grande" src="${esc(fotos[0])}" alt="${esc(p.titulo)}">` : `<div class="sin-foto">${icono("foto", { clase: "enorme" })}</div>`}${agotado ? '<span class="insignia">Agotado</span>' : ""}</div>
${fotos.length > 1 ? `<div class="gal-mini">${fotos.slice(0, 8).map((f, i) => `<button type="button" class="mini${i === 0 ? " on" : ""}" data-foto="${esc(f)}" aria-label="Foto ${i + 1}"><img src="${esc(f)}" alt="" loading="lazy"></button>`).join("")}</div>` : ""}
</div>
<div class="info rev" style="--n:2"><div class="info-caja">
${p.marca ? `<p class="marca-p">${esc(p.marca)}</p>` : ""}
<h1>${esc(p.titulo)}</h1>
<p class="precio" id="precio">${precio != null ? esc(dinero(precio)) : "Consultar precio"}</p>
${p.precio_cashea != null || primera?.precio_cashea != null ? `<p class="cashea">Con Cashea: ${esc(dinero(primera?.precio_cashea ?? p.precio_cashea))}</p>` : ""}
${agotado ? '<p class="aviso-c">Por ahora está agotado. Escríbenos y te avisamos cuando llegue.</p>' : `${opciones}
<div class="cant"><label>Cantidad</label><div class="mas-menos"><button type="button" id="menos" aria-label="Menos">${icono("menos", { clase: "chico" })}</button><input id="cantidad" type="number" value="1" min="1" max="20" inputmode="numeric" aria-label="Cantidad"><button type="button" id="mas" aria-label="Más">${icono("mas", { clase: "chico" })}</button></div></div>
<div class="acciones"><button type="button" class="boton principal grande" id="agregar">${icono("carrito")} Agregar al carrito</button>${wa ? `<a class="boton grande" id="pedir" href="${esc(wa)}" target="_blank" rel="noopener">${icono("chats")} Pedir por WhatsApp</a>` : ""}</div>`}
<ul class="garantias"><li>${icono("chats", { clase: "chico" })} Pides por WhatsApp, sin crear cuenta.</li><li>${icono("escudo", { clase: "chico" })} Un asesor confirma la disponibilidad y el pago.</li><li>${icono("etiqueta", { clase: "chico" })} El stock se descuenta cuando se confirma tu compra, no antes.</li></ul>
</div></div></article>
${parecidos.length ? `<section class="parecidos"><h2>También te puede gustar</h2><div class="rejilla">${parecidos.map((x, i) => tarjeta(x, base, i)).join("")}</div></section>` : ""}
${agotado ? "" : `<div class="compra-movil"><div><b id="precio-m">${precio != null ? esc(dinero(precio)) : ""}</b></div><button type="button" class="boton principal" id="agregar-m">${icono("carrito")} Agregar</button></div>`}
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>
<script>${SCRIPT_PRODUCTO}</script>`;

  return respuestaHtml(pagina({ env, tienda, raiz, activo: cat ? `cat:${cat}` : "inicio", titulo: `${p.titulo} · ${tienda}`, descripcion: `${p.titulo}${precio != null ? ` — ${dinero(precio)}` : ""}. ${tienda}.`, imagen: fotos[0] || "", cuerpo }));
}

/* ── El carrito ──────────────────────────────────────────────────── */

async function apiCarrito(request, env) {
  await asegurarInventario(env.DB);
  const pedidos = (new URL(request.url).searchParams.get("v") || "")
    .split(",")
    .map((t) => t.split("x"))
    .map(([v, n]) => ({ v: parseInt(v, 10), n: Math.max(1, Math.min(20, parseInt(n, 10) || 1)) }))
    .filter((t) => Number.isInteger(t.v) && t.v > 0)
    .slice(0, 40);
  const items = [];
  for (const t of pedidos) {
    const f = await env.DB
      .prepare(
        `SELECT v.id, v.opcion, v.color, v.precio, v.foto, p.id AS producto, p.titulo, p.precio AS precio_base,
                (SELECT url FROM inv_fotos x WHERE x.producto_id = p.id ORDER BY x.orden, x.id LIMIT 1) AS foto_p,
                (SELECT COALESCE(SUM(s.cantidad), 0) FROM inv_stock s WHERE s.variante_id = v.id) AS stock,
                (SELECT COUNT(*) FROM inv_stock s WHERE s.variante_id = v.id) AS contada
           FROM inv_variantes v JOIN inv_productos p ON p.id = v.producto_id
          WHERE v.id = ? AND v.oculta = 0 AND p.activo = 1`
      )
      .bind(t.v)
      .first();
    if (!f) continue;
    items.push({
      v: f.id,
      producto: f.producto,
      titulo: f.titulo,
      etiqueta: etiquetaDeVariante(f),
      foto: f.foto_p || f.foto || "",
      precio: f.precio ?? f.precio_base ?? null,
      max: disponible(f) ? (Number(f.contada) ? Math.min(Number(f.stock), 20) : 20) : 0,
      n: t.n,
    });
  }
  let pago = false;
  try {
    pago = metodosVisibles(await pagosParaLaWeb(env.DB)).length > 0;
  } catch {}
  return new Response(JSON.stringify({ items, pago }), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function paginaCarrito(env, { tienda, raiz }) {
  const base = raiz ? "" : PREFIJO;
  const cuerpo = `<section class="carrito"><h1>Tu carrito</h1><div class="cw-carro carro-pagina">${CARRO_HTML(base, false)}</div></section>`;
  return respuestaHtml(pagina({ env, tienda, raiz, titulo: `Carrito · ${tienda}`, cuerpo }), { cache: "no-store" });
}

async function sitemap(request, env, { raiz }) {
  await asegurarInventario(env.DB);
  const origen = new URL(request.url).origin;
  const base = raiz ? "" : PREFIJO;
  const { results } = await env.DB.prepare("SELECT id, actualizado FROM inv_productos WHERE activo = 1 ORDER BY id LIMIT 5000").all();
  const filas = [`<url><loc>${origen}${base || "/"}</loc></url>`].concat(
    (results || []).map((p) => `<url><loc>${origen}${base}/p/${p.id}</loc>${p.actualizado ? `<lastmod>${new Date(Number(p.actualizado)).toISOString().slice(0, 10)}</lastmod>` : ""}</url>`)
  );
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${filas.join("")}</urlset>`, {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}

/* ── Pagar en la página, con comprobante (12-oct-2026) ───────────── */

// La página de pago: datos del cliente, cómo paga (con los datos para
// pagar) y el comprobante. El resumen del pedido lo pinta el navegador con
// el carrito; el total que vale es el que calcula el servidor al recibirlo.
async function paginaPagar(env, { tienda, raiz }) {
  const base = raiz ? "" : PREFIJO;
  const pagos = await pagosParaLaWeb(env.DB);
  const metodos = metodosVisibles(pagos);
  const wa = enlaceWhatsApp(env, `Hola ${tienda} 👋 Quiero hacer un pedido`);
  if (!metodos.length) {
    const cuerpo = `<section class="vacio"><h1>Los pedidos van por WhatsApp</h1><p class="suave">Arma tu carrito y envíanos el pedido: un asesor te dice cómo pagar.</p><a class="boton principal" href="${base}/carrito">${icono("carrito")} Ir al carrito</a>${wa ? `<a class="boton" href="${esc(wa)}" target="_blank" rel="noopener">${icono("chats")} Escribir por WhatsApp</a>` : ""}</section>`;
    return respuestaHtml(pagina({ env, tienda, raiz, titulo: `Pagar · ${tienda}`, cuerpo }), { cache: "no-store" });
  }
  const tasa = pagos.tasa;
  const listaMetodos = metodos
    .map(
      (m, i) =>
        `<label class="metodo"><input type="radio" name="metodo" value="${esc(m.nombre)}" data-moneda="${m.moneda}" data-i="${i}" required><span class="metodo-c">${icono(m.moneda === "bs" ? "banco" : "tarjeta")}<b>${esc(m.nombre)}</b><small>${m.moneda === "bs" ? "Bolívares" : "Dólares"}</small></span></label>`
    )
    .join("");
  const datosMetodos = metodos
    .map(
      (m, i) =>
        `<div class="datos-pago" data-de="${i}" hidden><div class="datos-cab"><b>${icono("recibo", { clase: "chico" })} Datos para pagar con ${esc(m.nombre)}</b><button type="button" class="copiar" data-copiar>${icono("copia", { clase: "chico" })}<span>Copiar</span></button></div><pre>${esc(m.datos)}</pre><p class="monto" data-monto></p></div>`
    )
    .join("");
  const cuerpo = `<section class="pagar" data-tasa="${tasa ?? ""}">
<a class="volver" href="${base}/carrito">${icono("atras", { clase: "chico" })} Volver al carrito</a>
<h1>Pagar tu pedido</h1>
<p class="suave pagar-intro">Pagas por el método que prefieras, subes el comprobante y un asesor lo confirma. Te escribimos por WhatsApp.</p>
<div class="pagar-grid">
<form class="pagar-form" id="pagar" novalidate>
<div class="paso" role="group" aria-labelledby="paso1"><h2 class="paso-t" id="paso1"><span class="num">1</span> Tus datos</h2>
<label class="campo"><span class="campo-t">Nombre y apellido</span><input name="cliente" maxlength="80" autocomplete="name" required></label>
<div class="dos-c"><label class="campo"><span class="campo-t">Teléfono o WhatsApp</span><input name="telefono" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="0414 123 4567" required></label>
<label class="campo"><span class="campo-t">Cédula <small>(opcional)</small></span><input name="cedula" maxlength="20" placeholder="V-12.345.678"></label></div>
<div class="campo"><span class="campo-t">¿Cómo lo recibes?</span><div class="elegir"><label><input type="radio" name="entrega" value="retiro" checked><span>${icono("sede", { clase: "chico" })} Retiro en la tienda</span></label><label><input type="radio" name="entrega" value="envio"><span>${icono("camion", { clase: "chico" })} Envío</span></label></div></div>
<label class="campo" data-direccion hidden><span class="campo-t">Dirección para el envío</span><textarea name="direccion" rows="2" maxlength="300" placeholder="Ciudad, zona, calle y una referencia"></textarea></label>
</div>
<div class="paso" role="group" aria-labelledby="paso2"><h2 class="paso-t" id="paso2"><span class="num">2</span> Cómo pagas</h2>
<div class="metodos">${listaMetodos}</div>${datosMetodos}
${pagos.aviso ? `<p class="suave chico">${esc(pagos.aviso)}</p>` : ""}
</div>
<div class="paso" role="group" aria-labelledby="paso3"><h2 class="paso-t" id="paso3"><span class="num">3</span> Tu comprobante</h2>
<label class="subir" data-subir><input type="file" name="comprobante" accept="image/*,application/pdf" required><span class="subir-txt">${icono("subir", { clase: "grande" })}<b>Sube la captura o el PDF del pago</b><small>Foto JPG o PNG, o PDF</small></span><img data-vista alt="" hidden><span class="subir-nombre" data-nombre hidden></span></label>
<label class="campo"><span class="campo-t">Número de referencia <small>(opcional)</small></span><input name="referencia" maxlength="60" placeholder="Los últimos dígitos de la operación"></label>
<label class="campo"><span class="campo-t">Nota <small>(opcional)</small></span><textarea name="nota" rows="2" maxlength="300" placeholder="Algo que debamos saber"></textarea></label>
</div>
<p class="error-pago" data-error role="alert" hidden></p>
<button class="boton principal grande enviar" type="submit" data-enviar>${icono("check")} <span>Enviar comprobante</span></button>
<p class="suave chico">Tu pedido no se aparta hasta que confirmamos el pago. Si algo no cuadra, te escribimos.</p>
</form>
<aside class="pagar-resumen"><h2>Tu pedido</h2><div class="res-lineas" data-res-lineas><p class="suave">Cargando…</p></div>
<div class="total"><span>Total</span><b data-res-total>$0</b></div><p class="suave chico" data-res-bs></p></aside>
</div></section>
<script>${SCRIPT_PAGAR}</script>`;
  return respuestaHtml(pagina({ env, tienda, raiz, titulo: `Pagar · ${tienda}`, cuerpo }), { cache: "no-store" });
}

function json(datos, estado = 200) {
  return new Response(JSON.stringify(datos), { status: estado, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

// POST /tienda/api/pedido (multipart): crea el pedido "por revisar".
async function apiPedido(request, env, { tienda, raiz }) {
  const base = raiz ? "" : PREFIJO;
  const largo = Number(request.headers.get("content-length") || 0);
  if (largo > MAXIMO_COMPROBANTE + 200_000) return json({ ok: false, error: "El comprobante pesa demasiado. Manda una captura de pantalla o un PDF más liviano." }, 413);
  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "No pude leer el formulario. Intenta de nuevo." }, 400);
  }
  const archivo = form.get("comprobante");
  let bytes = null;
  if (archivo && typeof archivo === "object" && typeof archivo.arrayBuffer === "function") {
    if (archivo.size > MAXIMO_COMPROBANTE) return json({ ok: false, error: "El comprobante pesa demasiado. Manda una captura de pantalla o un PDF más liviano." }, 413);
    bytes = new Uint8Array(await archivo.arrayBuffer());
  }
  const campo = (k) => String(form.get(k) ?? "");
  try {
    const p = await crearPedido(env.DB, {
      carrito: campo("carrito"),
      cliente: campo("cliente"),
      telefono: campo("telefono"),
      cedula: campo("cedula"),
      entrega: campo("entrega"),
      direccion: campo("direccion"),
      nota: campo("nota"),
      metodo: campo("metodo"),
      referencia: campo("referencia"),
      archivo: bytes ? { bytes, nombre: String(archivo.name || "") } : null,
      ip: request.headers.get("cf-connecting-ip") || "",
    });
    await avisarDelPedido(env, request, { tienda, pedido: p, cliente: campo("cliente"), telefono: campo("telefono") });
    return json({ ok: true, codigo: p.codigo, url: `${base}/pedido/${p.codigo}?t=${p.token}` });
  } catch (error) {
    if (error instanceof PedidoInvalido || error?.name === "PedidoInvalido") return json({ ok: false, error: error.message }, error.estado || 400);
    console.error("TIENDA WEB: no se pudo guardar el pedido:", error?.stack || error?.message || error);
    return json({ ok: false, error: "No pudimos guardar tu pedido. Intenta de nuevo en un momento." }, 500);
  }
}

// Al asesor (Slack, si está) y al panel central: hay un pago por revisar.
// Nunca hace fallar el pedido: ya está guardado.
async function avisarDelPedido(env, request, { tienda, pedido, cliente, telefono }) {
  const origen = new URL(request.url).origin;
  const texto = `🛍️ Pedido web ${pedido.codigo} · ${dinero(pedido.total)}${pedido.totalBs ? ` (${bolivares(pedido.totalBs)})` : ""} · ${pedido.metodo} · ${String(cliente).trim().slice(0, 60)} ${String(telefono).trim().slice(0, 20)}`;
  const tareas = [alertarCentral(env, [{ tipo: "pedido", texto }])];
  if (env?.SLACK_WEBHOOK) {
    const lineas = [`*${texto}*`, ...pedido.lineas.map((l) => `• ${l.n}× ${l.titulo}${l.etiqueta ? ` (${l.etiqueta})` : ""} — ${dinero(l.precio * l.n)}`), `Revisa el comprobante y apruébalo: ${origen}/panel/pedidos`];
    tareas.push(
      fetch(env.SLACK_WEBHOOK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: lineas.join("\n") }), signal: AbortSignal.timeout(4000) }).catch((e) => console.error("Slack (pedido web):", e?.message || e))
    );
  }
  await Promise.allSettled(tareas);
}

const ESTADO_PARA_EL_CLIENTE = {
  revisar: { titulo: "Recibimos tu pago", texto: "Estamos revisando tu comprobante. Te escribimos por WhatsApp en cuanto lo confirmemos.", ico: "reloj", tono: "espera" },
  aprobando: { titulo: "Recibimos tu pago", texto: "Estamos revisando tu comprobante. Te escribimos por WhatsApp en cuanto lo confirmemos.", ico: "reloj", tono: "espera" },
  aprobado: { titulo: "¡Pago confirmado!", texto: "Tu pedido está confirmado. Te escribimos por WhatsApp para la entrega.", ico: "check", tono: "bien" },
  rechazado: { titulo: "No pudimos confirmar tu pago", texto: "Escríbenos por WhatsApp y lo resolvemos.", ico: "alerta", tono: "mal" },
};

// "Envío · <dirección>" o "Retiro en la tienda".
function entregaDelPedido(p) {
  if (p.entrega !== ENVIO) return "Retiro en la tienda";
  return p.direccion ? "Envío · " + p.direccion : "Envío";
}
const ENVIO = "envio";

async function paginaPedido(env, codigo, clave, { tienda, raiz }) {
  const base = raiz ? "" : PREFIJO;
  const p = await pedidoPublico(env.DB, codigo, clave);
  if (!p) return noEncontrado(env, tienda, raiz);
  const e = ESTADO_PARA_EL_CLIENTE[p.estado] || ESTADO_PARA_EL_CLIENTE.revisar;
  const wa = enlaceWhatsApp(env, `Hola ${tienda} 👋 Te escribo por mi pedido ${p.codigo}`);
  const fecha = new Date(p.creado - 4 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 16);
  const cuerpo = `<section class="estado-pedido ${e.tono}">
<div class="estado-ico">${icono(e.ico, { clase: "enorme" })}</div>
<h1>${esc(e.titulo)}</h1>
<p class="suave">Pedido <b class="codigo">${esc(p.codigo)}</b> · ${esc(fecha)}</p>
<p>${esc(e.texto)}</p>
${p.estado === "rechazado" && p.motivo ? `<p class="motivo">${icono("info", { clase: "chico" })} ${esc(p.motivo)}</p>` : ""}
<div class="estado-caja">
${p.items.map((l) => `<div class="estado-linea"><span>${l.n}× ${esc(l.titulo)}${l.etiqueta ? ` <small>(${esc(l.etiqueta)})</small>` : ""}</span><b>${esc(dinero(l.precio * l.n))}</b></div>`).join("")}
<div class="estado-linea total-l"><span>Total</span><b>${esc(dinero(p.total))}</b></div>
${p.total_bs ? `<div class="estado-linea"><span>En bolívares (tasa ${esc(String(p.tasa).replace(".", ","))})</span><b>${esc(bolivares(p.total_bs))}</b></div>` : ""}
<div class="estado-linea"><span>Pagado con</span><b>${esc(p.metodo)}${p.referencia ? ` · ref. ${esc(p.referencia)}` : ""}</b></div>
<div class="estado-linea"><span>Entrega</span><b>${esc(entregaDelPedido(p))}</b></div>
</div>
<div class="estado-acciones">${wa ? `<a class="boton principal grande" href="${esc(wa)}" target="_blank" rel="noopener">${icono("chats")} Escribir por WhatsApp</a>` : ""}<a class="boton grande" href="${base || "/"}">Seguir comprando</a></div>
<p class="suave chico">Guarda este enlace: aquí ves cómo va tu pedido.</p>
</section>`;
  const html = pagina({ env, tienda, raiz, titulo: `Pedido ${p.codigo} · ${tienda}`, cuerpo }).replace("<head>", '<head><meta name="robots" content="noindex">');
  return respuestaHtml(html, { cache: "no-store" });
}

/* ── La puerta de entrada ────────────────────────────────────────── */

// Devuelve la respuesta, o null si esta dirección no es de la tienda web
// (para que index.js siga con lo suyo).
export async function atenderCatalogoWeb(request, env, { tienda = "Tienda", rubro = "calzado" } = {}) {
  // Las fotos subidas desde el panel (fotos.js) se sirven SIEMPRE, también con
  // la tienda web apagada: el panel y el bot las usan igual.
  if ((request.method === "GET" || request.method === "HEAD") && new URL(request.url).pathname.startsWith(RUTA_DE_FOTOS)) return respuestaFoto(env, new URL(request.url).pathname);
  if (String(env?.TIENDA_WEB || "").trim().toLowerCase() === "no") return null;
  const esPost = request.method === "POST";
  if (request.method !== "GET" && request.method !== "HEAD" && !esPost) return null;

  const url = new URL(request.url);
  const raiz = String(env?.TIENDA_RAIZ || "").trim().toLowerCase() === "si";
  let ruta = url.pathname;
  const esDelPrefijo = ruta === PREFIJO || ruta.startsWith(PREFIJO + "/");
  if (!esDelPrefijo) {
    // Con un dominio propio, la tienda también vive en la raíz.
    if (!raiz || !(ruta === "/" || ruta === "/carrito" || ruta === "/pagar" || ruta === "/api/pedido" || /^\/pedido\/[A-Z0-9-]+$/i.test(ruta) || ruta === "/sitemap.xml" || /^\/p\/\d+\/?$/.test(ruta) || ruta === "/api/carrito" || /^\/logo\/(oscuro|claro|casco|icono)\.png$/.test(ruta))) return null;
  } else {
    ruta = ruta.slice(PREFIJO.length) || "/";
  }
  // Lo único que se manda con POST es el pedido con su comprobante.
  if (esPost && ruta !== "/api/pedido") return null;
  const enRaiz = raiz && !esDelPrefijo;

  const logo = /^\/logo\/(oscuro|claro|casco|icono)\.png$/.exec(ruta);
  if (logo) return respuestaLogo(logo[1]);
  if (!env?.DB) return respuestaHtml(`<p>La tienda no está lista todavía.</p>`, { estado: 503, cache: "no-store" });

  try {
    if (ruta === "/api/pedido") return esPost ? await apiPedido(request, env, { tienda, raiz: enRaiz }) : json({ ok: false, error: "Usa el formulario de pago." }, 405);
    if (ruta === "/" || ruta === "") return await paginaCatalogo(request, env, { tienda, rubro, raiz: enRaiz });
    if (ruta === "/pagar") return await paginaPagar(env, { tienda, raiz: enRaiz });
    const pedido = /^\/pedido\/([A-Z0-9-]{4,12})$/i.exec(ruta);
    if (pedido) return await paginaPedido(env, pedido[1], url.searchParams.get("t") || "", { tienda, raiz: enRaiz });
    const prod = /^\/p\/(\d+)\/?$/.exec(ruta);
    if (prod) return await paginaProducto(env, parseInt(prod[1], 10), { tienda, rubro, raiz: enRaiz });
    if (ruta === "/carrito") return paginaCarrito(env, { tienda, raiz: enRaiz });
    if (ruta === "/api/carrito") return await apiCarrito(request, env);
    if (ruta === "/sitemap.xml") return await sitemap(request, env, { raiz: enRaiz });
  } catch (error) {
    console.error("TIENDA WEB: falló:", error?.stack || error?.message || error);
    return respuestaHtml(pagina({ env, tienda, raiz: enRaiz, titulo: `Error · ${tienda}`, cuerpo: `<section class="vacio"><h1>Algo salió mal</h1><p class="suave">Intenta de nuevo en un momento.</p></section>` }), { estado: 500, cache: "no-store" });
  }
  return noEncontrado(env, tienda, enRaiz);
}

/* ── Lo que corre en el navegador ────────────────────────────────── */

// El carrito vive en el navegador de quien compra: [{ v: variante, n: cantidad }].
// El precio y el stock NO se guardan aquí: se piden al servidor cada vez.
const SCRIPT_COMUN = `(function(){
var K="cw_carrito",B=document.body,base=B.getAttribute("data-base")||"",wa=B.getAttribute("data-wa")||"",tienda=B.getAttribute("data-tienda")||"";
var datos=[],pago=false;
function leer(){try{var c=JSON.parse(localStorage.getItem(K)||"[]");return Array.isArray(c)?c:[]}catch(e){return[]}}
function poner(c){try{localStorage.setItem(K,JSON.stringify(c))}catch(e){}badge()}
function badge(){var n=leer().reduce(function(a,x){return a+(x.n||0)},0),el=document.getElementById("carro-n");if(el){el.textContent=n;el.hidden=!n}}
function dinero(n){n=Number(n);if(!isFinite(n))return"";var e=Math.abs(n-Math.round(n))<.005;return"$"+n.toLocaleString("en-US",{minimumFractionDigits:e?0:2,maximumFractionDigits:e?0:2})}
function esc(t){var d=document.createElement("div");d.textContent=t==null?"":t;return d.innerHTML}
function cargar(cb){var c=leer();if(!c.length){datos=[];return cb()}
 fetch(base+"/api/carrito?v="+c.map(function(x){return x.v+"x"+x.n}).join(",")).then(function(r){return r.json()}).then(function(j){
  datos=j.items||[];pago=!!j.pago;var vivos=datos.map(function(d){return d.v});
  var nuevo=c.filter(function(x){return vivos.indexOf(x.v)>-1});if(nuevo.length!==c.length)poner(nuevo);cb()}).catch(function(){cb(true)})}
function pintar(raiz,fallo){
 var lineas=raiz.querySelector("[data-lineas]"),resumen=raiz.querySelector("[data-resumen]"),vacio=raiz.querySelector("[data-vacio]"),total=raiz.querySelector("[data-total]"),pedir=raiz.querySelector("[data-pedir]");
 var c=leer();lineas.innerHTML="";
 if(fallo){lineas.innerHTML='<p class="aviso-c">No pude cargar el carrito. Intenta de nuevo.</p>';resumen.hidden=true;vacio.hidden=true;return}
 if(!c.length||!datos.length){resumen.hidden=true;vacio.hidden=false;lineas.hidden=true;return}
 vacio.hidden=true;lineas.hidden=false;resumen.hidden=false;
 var suma=0,texto="Hola "+tienda+" 👋 Quiero pedir:\\n";
 datos.forEach(function(d){var h=c.filter(function(x){return x.v===d.v})[0];if(!h)return;var q=Math.min(h.n,d.max||1);d.n=q;
  var sub=d.precio!=null?d.precio*q:null;if(sub!=null)suma+=sub;
  texto+="• "+q+"× "+d.titulo+(d.etiqueta?" ("+d.etiqueta+")":"")+(sub!=null?" — "+dinero(sub):"")+"\\n";
  var f=document.createElement("div");f.className="linea";
  f.innerHTML='<a href="'+base+'/p/'+d.producto+'" class="linea-foto">'+(d.foto?'<img src="'+esc(d.foto)+'" alt="">':"")+'</a><div class="linea-info"><a href="'+base+'/p/'+d.producto+'"><b>'+esc(d.titulo)+'</b></a>'+(d.etiqueta?'<span class="suave">'+esc(d.etiqueta)+'</span>':"")+(d.max===0?'<span class="aviso-c">Ya no está disponible</span>':"")+'<span class="linea-precio">'+(d.precio!=null?dinero(d.precio):"Consultar")+'</span></div><div class="mas-menos chico"><button type="button" data-a="menos" aria-label="Menos">−</button><span>'+q+'</span><button type="button" data-a="mas" aria-label="Más">+</button></div><button type="button" class="quitar" data-a="quitar" aria-label="Quitar">✕</button>';
  f.querySelectorAll("button").forEach(function(b){b.onclick=function(){var cc=leer(),g=cc.filter(function(x){return x.v===d.v})[0];if(!g)return;var a=b.getAttribute("data-a");
   if(a==="mas")g.n=Math.min(d.max||1,g.n+1);if(a==="menos")g.n=Math.max(1,g.n-1);if(a==="quitar")cc=cc.filter(function(x){return x.v!==d.v});
   poner(cc);datos=datos.filter(function(x){return cc.some(function(y){return y.v===x.v})});todos()}});
  lineas.appendChild(f)});
 total.textContent=dinero(suma);texto+="Total: "+dinero(suma);
 if(pedir){pedir.href=wa?"https://wa.me/"+wa+"?text="+encodeURIComponent(texto):"#";pedir.hidden=!wa;pedir.classList.toggle("principal",!pago)}
 var pagar=raiz.querySelector("[data-pagar]"),nota=raiz.querySelector("[data-nota-pedido]");if(pagar)pagar.hidden=!pago;
 if(nota)nota.textContent=pago?"Paga aquí y sube tu comprobante, o pide por WhatsApp. Un asesor confirma tu pago.":"El pedido va por WhatsApp: un asesor te confirma disponibilidad, pago y envío."}
function todos(fallo){document.querySelectorAll(".cw-carro").forEach(function(r){pintar(r,fallo)})}
function refrescar(){cargar(function(fallo){todos(fallo)})}
var cajon=document.getElementById("cajon");
function abrir(){if(!cajon)return;cajon.classList.add("abierto");cajon.setAttribute("aria-hidden","false");document.documentElement.classList.add("sin-scroll");refrescar()}
function cerrar(){if(!cajon)return;cajon.classList.remove("abierto");cajon.setAttribute("aria-hidden","true");document.documentElement.classList.remove("sin-scroll")}
document.addEventListener("click",function(e){var t=e.target.closest&&e.target.closest("[data-abrir],[data-cerrar]");if(!t)return;
 if(t.hasAttribute("data-abrir")){e.preventDefault();abrir()}else cerrar()});
document.addEventListener("keydown",function(e){if(e.key==="Escape")cerrar()});
window.cwCart={leer:leer,agregar:function(v,n){var c=leer(),h=c.filter(function(x){return x.v===v})[0];if(h)h.n=Math.min(20,h.n+n);else c.push({v:v,n:n});poner(c);abrir()}};
badge();if(document.querySelector(".carro-pagina"))refrescar();
// Aparece al hacer scroll (las tarjetas que no se ven todavía esperan su turno).
if("IntersectionObserver"in window){var io=new IntersectionObserver(function(es){es.forEach(function(x){if(x.isIntersecting){x.target.classList.add("ya");io.unobserve(x.target)}})},{rootMargin:"0px 0px -6% 0px"});
 document.querySelectorAll(".rev").forEach(function(el){io.observe(el)})}else document.querySelectorAll(".rev").forEach(function(el){el.classList.add("ya")});
})();`;

const SCRIPT_PRODUCTO = `(function(){
var a=document.querySelector(".prod");if(!a)return;
var precio=document.getElementById("precio"),precioM=document.getElementById("precio-m"),cant=document.getElementById("cantidad"),pedir=document.getElementById("pedir");
function sel(){return a.querySelector('input[name="variante"]:checked')}
function dinero(n){n=Number(n);if(!isFinite(n))return"";var e=Math.abs(n-Math.round(n))<.005;return"$"+n.toLocaleString("en-US",{minimumFractionDigits:e?0:2,maximumFractionDigits:e?0:2})}
function max(){var s=sel();return s?Number(s.getAttribute("data-max"))||1:20}
function refrescar(){var s=sel();if(s&&s.getAttribute("data-precio")!==""){if(precio)precio.textContent=dinero(s.getAttribute("data-precio"));if(precioM)precioM.textContent=dinero(s.getAttribute("data-precio"))}
 if(!cant)return;var m=max();cant.max=m;if(Number(cant.value)>m)cant.value=m;
 if(pedir){var t="Hola 👋 Me interesa "+a.getAttribute("data-titulo");if(s&&s.getAttribute("data-etiqueta"))t+=" ("+s.getAttribute("data-etiqueta")+")";if(precio&&precio.textContent)t+=" — "+precio.textContent;if(Number(cant.value)>1)t+=" x"+cant.value;pedir.href="https://wa.me/"+a.getAttribute("data-wa")+"?text="+encodeURIComponent(t)}}
a.addEventListener("change",refrescar);
var menos=document.getElementById("menos"),mas=document.getElementById("mas");
if(menos)menos.onclick=function(){cant.value=Math.max(1,Number(cant.value)-1);refrescar()};
if(mas)mas.onclick=function(){cant.value=Math.min(max(),Number(cant.value)+1);refrescar()};
if(cant)cant.addEventListener("input",refrescar);
function agregar(){var s=sel(),v=s?Number(s.value):Number(a.getAttribute("data-variante"));if(!v)return;cwCart.agregar(v,Math.max(1,Math.min(max(),Number(cant&&cant.value)||1)))}
["agregar","agregar-m"].forEach(function(id){var b=document.getElementById(id);if(b)b.onclick=agregar});
document.querySelectorAll(".mini").forEach(function(b){b.onclick=function(){var g=document.getElementById("foto-grande");if(g)g.src=b.getAttribute("data-foto");document.querySelectorAll(".mini").forEach(function(x){x.classList.toggle("on",x===b)})}});
refrescar()})();`;

// La página de pago, en el navegador: el resumen con el carrito, los datos
// del método elegido (con su monto, en Bs si hay tasa), el comprobante
// achicado y el envío. El servidor vuelve a calcular todo al recibirlo.
const SCRIPT_PAGAR = `(function(){
var f=document.getElementById("pagar");if(!f)return;
var B=document.body,base=B.getAttribute("data-base")||"",sec=document.querySelector(".pagar"),tasa=Number(sec.getAttribute("data-tasa"))||0;
var total=0,listo=false,archivo=null,nombreArchivo="";
function dinero(n){n=Number(n);if(!isFinite(n))return"";var e=Math.abs(n-Math.round(n))<.005;return"$"+n.toLocaleString("en-US",{minimumFractionDigits:e?0:2,maximumFractionDigits:e?0:2})}
function bs(n){var p=(Math.round(n*100)/100).toFixed(2).split(".");return"Bs "+p[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g,".")+","+p[1]}
function esc(t){var d=document.createElement("div");d.textContent=t==null?"":t;return d.innerHTML}
function leer(){try{var c=JSON.parse(localStorage.getItem("cw_carrito")||"[]");return Array.isArray(c)?c:[]}catch(e){return[]}}
var resL=document.querySelector("[data-res-lineas]"),resT=document.querySelector("[data-res-total]"),resB=document.querySelector("[data-res-bs]"),err=f.querySelector("[data-error]"),btn=f.querySelector("[data-enviar]");
function error(t){err.textContent=t||"";err.hidden=!t;if(t&&err.scrollIntoView)err.scrollIntoView({behavior:"smooth",block:"center"})}
var c=leer();
if(!c.length){resL.innerHTML='<p class="suave">Tu carrito está vacío.</p><a class="boton" href="'+(base||"/")+'">Ver el catálogo</a>';btn.disabled=true}
else fetch(base+"/api/carrito?v="+c.map(function(x){return x.v+"x"+x.n}).join(",")).then(function(r){return r.json()}).then(function(j){
 var it=j.items||[],h="";total=0;
 it.forEach(function(d){var g=c.filter(function(x){return x.v===d.v})[0];if(!g)return;var q=Math.min(g.n,d.max||0);if(!q)return;
  var sub=d.precio!=null?d.precio*q:0;total+=sub;
  h+='<div class="res-linea"><span class="res-foto">'+(d.foto?'<img src="'+esc(d.foto)+'" alt="">':"")+'<i>'+q+'</i></span><span class="res-n"><b>'+esc(d.titulo)+'</b>'+(d.etiqueta?'<small>'+esc(d.etiqueta)+'</small>':"")+'</span><b>'+dinero(sub)+'</b></div>'});
 if(!h){resL.innerHTML='<p class="suave">Lo de tu carrito ya no está disponible.</p>';btn.disabled=true;return}
 resL.innerHTML=h;resT.textContent=dinero(total);listo=true;montos()}).catch(function(){resL.innerHTML='<p class="suave">No pude cargar el carrito. Recarga la página.</p>'});
function elegido(){return f.querySelector('input[name="metodo"]:checked')}
function tasaTxt(){return String(tasa).replace(".",",")}
function montos(){var m=elegido();
 document.querySelectorAll(".datos-pago").forEach(function(d){d.hidden=!m||d.getAttribute("data-de")!==m.getAttribute("data-i")});
 resB.textContent=tasa&&total?"En bolívares: "+bs(total*tasa)+" (tasa "+tasaTxt()+" Bs/$)":"";
 if(!m)return;var caja=document.querySelector('.datos-pago[data-de="'+m.getAttribute("data-i")+'"] [data-monto]');if(!caja)return;
 if(m.getAttribute("data-moneda")==="bs")caja.innerHTML=tasa?"Monto a pagar: <b>"+bs(total*tasa)+"</b> <small>(tasa "+tasaTxt()+" Bs por dólar)</small>":"Monto a pagar: el equivalente de <b>"+dinero(total)+"</b> en bolívares a la tasa del día.";
 else caja.innerHTML="Monto a pagar: <b>"+dinero(total)+"</b>"}
f.addEventListener("change",function(e){var n=e.target.name;if(n==="metodo")montos();if(n==="entrega"){f.querySelector("[data-direccion]").hidden=e.target.value!=="envio"}});
document.querySelectorAll("[data-copiar]").forEach(function(b){b.onclick=function(){var t=b.closest(".datos-pago").querySelector("pre").textContent,s=b.querySelector("span");
 function hecho(){s.textContent="Copiado";b.classList.add("ok");setTimeout(function(){s.textContent="Copiar";b.classList.remove("ok")},1800)}
 if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(t).then(hecho,function(){});else{var a=document.createElement("textarea");a.value=t;document.body.appendChild(a);a.select();try{document.execCommand("copy");hecho()}catch(e){}a.remove()}}});
// El comprobante: la foto se achica aquí (sube rápido y cabe en la base).
var input=f.querySelector('input[name="comprobante"]'),vista=f.querySelector("[data-vista]"),nom=f.querySelector("[data-nombre]"),zona=f.querySelector("[data-subir]");
input.addEventListener("change",function(){var a=input.files&&input.files[0];archivo=null;vista.hidden=true;nom.hidden=true;zona.classList.remove("con");if(!a)return;
 nombreArchivo=a.name||"comprobante";zona.classList.add("con");
 if(/pdf$/i.test(a.type)||/\\.pdf$/i.test(a.name)){archivo=a;nom.textContent=a.name;nom.hidden=false;return}
 achicar(a,function(b){archivo=b||a;try{vista.src=URL.createObjectURL(archivo);vista.hidden=false}catch(e){nom.textContent=a.name;nom.hidden=false}})});
function achicar(a,cb){try{var url=URL.createObjectURL(a),img=new Image();img.onload=function(){var m=1600,w=img.naturalWidth,h=img.naturalHeight,k=Math.min(1,m/Math.max(w,h));
 var cv=document.createElement("canvas");cv.width=Math.round(w*k);cv.height=Math.round(h*k);var x=cv.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,cv.width,cv.height);x.drawImage(img,0,0,cv.width,cv.height);
 URL.revokeObjectURL(url);cv.toBlob(function(b){cb(b&&(b.size<a.size||a.size>1100000)?b:a)},"image/jpeg",.82)};img.onerror=function(){cb(null)};img.src=url}catch(e){cb(null)}}
f.addEventListener("submit",function(e){e.preventDefault();error("");
 function v(n){var el=f.elements[n];return el?String(el.value||"").trim():""}
 if(!listo)return error("Tu carrito está vacío.");
 if(v("cliente").length<3)return error("Escribe tu nombre y apellido.");
 if(v("telefono").replace(/\\D/g,"").length<7)return error("Escribe tu teléfono o WhatsApp.");
 var ent=f.querySelector('input[name="entrega"]:checked');if(ent&&ent.value==="envio"&&v("direccion").length<6)return error("Escribe la dirección para el envío.");
 if(!elegido())return error("Elige cómo vas a pagar.");
 if(!archivo)return error("Sube la captura o el PDF del comprobante.");
 if(archivo.size>1200000)return error("El comprobante pesa demasiado. Manda una captura de pantalla o un PDF más liviano.");
 var d=new FormData();["cliente","telefono","cedula","direccion","referencia","nota"].forEach(function(n){d.append(n,v(n))});
 d.append("entrega",ent?ent.value:"retiro");d.append("metodo",elegido().value);
 d.append("carrito",leer().map(function(x){return x.v+"x"+x.n}).join(","));
 d.append("comprobante",archivo,archivo.type==="application/pdf"?nombreArchivo:"comprobante.jpg");
 btn.disabled=true;btn.classList.add("cargando");btn.querySelector("span").textContent="Enviando…";
 fetch(base+"/api/pedido",{method:"POST",body:d}).then(function(r){return r.json()}).then(function(j){
  if(!j.ok)throw new Error(j.error||"No pudimos enviar tu pedido.");
  try{localStorage.removeItem("cw_carrito")}catch(e){}location.href=j.url})
 .catch(function(x){error(x&&x.message?x.message:"No pudimos enviar tu pedido. Revisa tu conexión e intenta de nuevo.");btn.disabled=false;btn.classList.remove("cargando");btn.querySelector("span").textContent="Enviar comprobante"})});
})();`;

/* ── El estilo: el de los paneles de ALPHA IA, en forma de tienda ── */

const ESTILO = (color) => `
:root{color-scheme:dark;
--marca:${color};--marca-fuerte:color-mix(in srgb,${color} 82%,#000);--cian:color-mix(in srgb,${color} 58%,#fff);
--grad:linear-gradient(135deg,color-mix(in srgb,${color} 78%,#fff) 0%,${color} 52%,color-mix(in srgb,${color} 72%,#000) 100%);
--fondo:#05070d;--tarjeta:rgba(255,255,255,.04);--tarjeta-s:#0c1220;--texto:#ecf1fb;--suave:#8f9ab3;--tenue:#5c6782;
--borde:rgba(148,163,194,.13);--borde-f:rgba(148,163,194,.26);--rejilla:rgba(148,163,194,.06);
--mal:#ff6b6b;--bien:#3ddc97;--aviso:#ffbf47;
--sombra:inset 0 1px 0 rgba(255,255,255,.05),0 24px 48px -30px rgba(0,0,0,.8);
--salida:cubic-bezier(.16,1,.3,1);--resorte:cubic-bezier(.34,1.4,.64,1);
--fuente:"Manrope",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif}
@supports (transition-timing-function:linear(0,1)){:root{--resorte:linear(0,.006,.025 2.8%,.101 6.1%,.539 18.9%,.721 25.3%,.849 31.5%,.937 38.1%,.968 41.8%,.991 45.7%,1.006 50.1%,1.015 55%,1.017 63.9%,1.001 85.9%,1)}}
:root[data-tema="claro"]{color-scheme:light;--fondo:#f3f5fa;--tarjeta:#fff;--tarjeta-s:#fff;--texto:#0d1526;--suave:#5a6479;--tenue:#8a93a7;
--borde:rgba(15,23,42,.09);--borde-f:rgba(15,23,42,.17);--rejilla:rgba(15,23,42,.045);--marca:color-mix(in srgb,${color} 88%,#000);--cian:${color};--bien:#0f8a55;--aviso:#b45309;--mal:#d92d2d;
--sombra:0 1px 2px rgba(15,23,42,.04),0 12px 32px -20px rgba(15,23,42,.25)}
[hidden]{display:none!important}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%;-webkit-tap-highlight-color:transparent;scroll-behavior:smooth}
html.sin-scroll{overflow:hidden}
body{margin:0;min-height:100vh;color:var(--texto);font:15px/1.55 var(--fuente);font-feature-settings:"ss01","cv11";-webkit-font-smoothing:antialiased;
background:radial-gradient(1100px 600px at 92% -14%,color-mix(in srgb,${color} 26%,transparent),transparent 62%),radial-gradient(900px 520px at -14% 6%,color-mix(in srgb,${color} 10%,transparent),transparent 60%),var(--fondo);background-attachment:fixed}
body::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;background-image:linear-gradient(var(--rejilla) 1px,transparent 1px),linear-gradient(90deg,var(--rejilla) 1px,transparent 1px);background-size:44px 44px;-webkit-mask-image:radial-gradient(ellipse 80% 55% at 50% 0%,#000,transparent 75%);mask-image:radial-gradient(ellipse 80% 55% at 50% 0%,#000,transparent 75%)}
a{color:inherit;text-decoration:none}img{max-width:100%;display:block}button{font:inherit;color:inherit}
::selection{background:color-mix(in srgb,${color} 40%,transparent)}
.ico{width:20px;height:20px;flex:none;display:inline-block;vertical-align:-4px}.ico.chico{width:16px;height:16px;vertical-align:-3px}.ico.grande{width:26px;height:26px}.ico.enorme{width:44px;height:44px}
.suave{color:var(--suave)}
h1{font-size:30px;line-height:1.12;font-weight:800;letter-spacing:-.03em;margin:0}h2{font-size:21px;font-weight:750;letter-spacing:-.02em;margin:0}
.anuncio{background:var(--grad);color:#fff;text-align:center;font-size:13px;font-weight:600;padding:8px 12px}
/* La barra de arriba: vidrio, con el hilo de luz que corre por debajo. */
.cab{position:sticky;top:0;z-index:30;background:rgba(5,7,13,.72);-webkit-backdrop-filter:saturate(170%) blur(18px);backdrop-filter:saturate(170%) blur(18px);border-bottom:1px solid var(--borde)}
:root[data-tema="claro"] .cab{background:rgba(255,255,255,.82)}
.cab::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:1px;background:linear-gradient(90deg,transparent,var(--marca),var(--cian),transparent);background-size:200% 100%;opacity:.55;animation:barrido 9s linear infinite}
@keyframes barrido{from{background-position:200% 0}to{background-position:-200% 0}}
.cab-in{max-width:1240px;margin:0 auto;padding:10px 20px;display:flex;align-items:center;gap:18px}
.marca{display:flex;align-items:center;gap:11px;min-width:0}.lg-casco{height:36px;width:auto;flex:none;object-fit:contain;aspect-ratio:auto;transition:transform .6s var(--resorte);filter:drop-shadow(0 0 14px color-mix(in srgb,${color} 55%,transparent))}.marca:hover .lg-casco{transform:translateY(-1px) scale(1.07)}
.marca-n{font-weight:800;letter-spacing:.2em;font-size:13.5px;text-transform:uppercase;white-space:nowrap}
.monograma{display:inline-grid;place-items:center;width:36px;height:36px;border-radius:11px;background:var(--grad);color:#fff;font-weight:800;box-shadow:0 8px 20px -10px ${color}}.monograma.grande{width:120px;height:120px;font-size:56px;border-radius:32px}
.nav{display:flex;gap:2px;margin-left:8px}.nav a{color:var(--suave);font-size:14px;font-weight:650;padding:7px 13px;border-radius:999px;transition:color .25s,background .25s}.nav a:hover{color:var(--texto);background:rgba(148,163,194,.12)}.nav a.on{color:var(--texto);background:rgba(148,163,194,.14)}
.buscar{flex:1;max-width:460px;margin-left:auto;display:flex;align-items:center;gap:8px;padding:0 14px;border:1px solid var(--borde-f);border-radius:999px;background:var(--tarjeta);color:var(--suave);transition:border-color .3s,box-shadow .3s}
.buscar:focus-within{border-color:var(--marca);box-shadow:0 0 0 4px color-mix(in srgb,${color} 18%,transparent)}.buscar input{flex:1;min-width:0;border:0;background:transparent;color:var(--texto);padding:10px 0;font:inherit;outline:none}
.cab-der{display:flex;align-items:center;gap:10px}
.tema{position:relative;display:inline-flex;align-items:center;width:64px;height:34px;padding:0 7px;justify-content:space-between;border-radius:999px;background:var(--tarjeta);border:1px solid var(--borde-f);color:var(--suave);cursor:pointer}
.tema .ico{width:16px;height:16px;position:relative;z-index:1;transition:color .35s}
.tema::before{content:"";position:absolute;top:3px;left:3px;width:26px;height:26px;border-radius:50%;background:var(--grad);box-shadow:0 4px 12px -4px ${color};transform:translateX(30px);transition:transform .6s var(--resorte)}
.tema .a-oscuro{color:#fff}.tema .a-claro{color:var(--suave)}
:root[data-tema="claro"] .tema::before{transform:translateX(0)}:root[data-tema="claro"] .tema .a-claro{color:#fff}:root[data-tema="claro"] .tema .a-oscuro{color:var(--suave)}
.cambiando-tema *{view-transition-name:none!important}.cambiando-tema::view-transition-old(root),.cambiando-tema::view-transition-new(root){animation:none;mix-blend-mode:normal}.cambiando-tema::view-transition-old(root){z-index:1}.cambiando-tema::view-transition-new(root){z-index:2}
.carro{position:relative;display:grid;place-items:center;width:42px;height:42px;border-radius:50%;border:1px solid var(--borde-f);background:var(--tarjeta);cursor:pointer;transition:transform .5s var(--resorte),border-color .3s}.carro:hover{transform:translateY(-1px) scale(1.06);border-color:var(--marca)}
.carro span{position:absolute;top:-4px;right:-4px;min-width:19px;height:19px;padding:0 5px;border-radius:999px;background:var(--grad);color:#fff;font-size:11px;font-weight:800;display:grid;place-items:center;box-shadow:0 4px 12px -4px ${color}}.carro span[hidden]{display:none}
main{max-width:1240px;margin:0 auto;padding:20px 20px 40px}
/* Entran al hacer scroll, una tras otra. */
.rev{opacity:0;transform:translateY(16px)}.rev.ya{opacity:1;transform:none;transition:opacity .7s var(--salida),transform .8s var(--salida);transition-delay:calc(var(--n,0)*55ms)}
/* La portada */
.heroe{position:relative;overflow:hidden;display:grid;grid-template-columns:1.15fr .85fr;gap:30px;align-items:center;padding:46px 44px;border:1px solid var(--borde);border-radius:30px;background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.02));box-shadow:var(--sombra)}
:root[data-tema="claro"] .heroe{background:linear-gradient(180deg,#fff,#fbfcff)}
.heroe-aurora{position:absolute;inset:0;overflow:hidden;border-radius:inherit;pointer-events:none}.heroe-aurora i{position:absolute;border-radius:50%;filter:blur(70px);opacity:.55;pointer-events:none}.heroe-aurora i:nth-child(1){width:420px;height:420px;right:-120px;top:-170px;background:radial-gradient(circle,${color},transparent 65%);animation:deriva 16s ease-in-out infinite alternate}
.heroe-aurora i:nth-child(2){width:340px;height:340px;left:-130px;bottom:-200px;background:radial-gradient(circle,color-mix(in srgb,${color} 55%,#8b7cff),transparent 65%);animation:deriva 20s ease-in-out -6s infinite alternate-reverse}
@keyframes deriva{0%{transform:translate(0,0) scale(1)}50%{transform:translate(-40px,30px) scale(1.12)}100%{transform:translate(30px,-20px) scale(.95)}}
.heroe-texto{position:relative;z-index:1}.sobre{display:inline-flex;align-items:center;gap:7px;margin:0 0 14px;padding:6px 13px;border-radius:999px;border:1px solid color-mix(in srgb,${color} 40%,transparent);background:color-mix(in srgb,${color} 12%,transparent);color:var(--cian);font-size:12.5px;font-weight:700;letter-spacing:.04em}
.heroe h1{font-size:46px;letter-spacing:-.035em;text-transform:uppercase;font-weight:800}.lema{max-width:520px;color:var(--suave);font-size:16.5px;margin:14px 0 24px}
.heroe-cta{display:flex;gap:12px;flex-wrap:wrap}.heroe-datos{display:flex;gap:26px;margin-top:26px;color:var(--suave);font-size:14px}.heroe-datos b{color:var(--texto);font-size:22px;font-weight:800;margin-right:4px}
.heroe-logo{position:relative;z-index:1;display:grid;place-items:center}.heroe-logo .lg{width:min(100%,430px);height:auto;filter:drop-shadow(0 18px 50px color-mix(in srgb,${color} 35%,transparent));animation:flotar 7s ease-in-out infinite}
@keyframes flotar{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
.lg-claro{display:none}:root[data-tema="claro"] .lg-claro{display:block}:root[data-tema="claro"] .lg-oscuro{display:none}
/* Colecciones */
.colecciones{margin-top:34px}.col-rejilla{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:14px}
.col{position:relative;overflow:hidden;aspect-ratio:16/10;border-radius:22px;border:1px solid var(--borde);background:var(--tarjeta-s);isolation:isolate;transition:transform .6s var(--resorte),border-color .3s,box-shadow .3s}
.col:hover{transform:translateY(-4px);border-color:color-mix(in srgb,${color} 55%,transparent);box-shadow:0 22px 50px -26px ${color}}
.col img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2;transition:transform 1s var(--salida)}.col:hover img{transform:scale(1.07)}
.col-vel{position:absolute;inset:0;z-index:-1;background:linear-gradient(180deg,transparent 30%,rgba(5,7,13,.85))}.col-txt{position:absolute;left:18px;bottom:14px;color:#fff;display:flex;flex-direction:column}.col-txt b{font-size:19px;letter-spacing:-.01em}.col-txt small{opacity:.8}
/* El catálogo */
.cat{margin-top:34px;scroll-margin-top:90px}.cat-cab{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}.cat-cab h2{font-size:26px}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 4px}.chips a{padding:8px 15px;border:1px solid var(--borde-f);border-radius:999px;font-size:14px;font-weight:600;background:var(--tarjeta);transition:all .3s var(--salida)}.chips a:hover{border-color:var(--marca);color:var(--cian);transform:translateY(-1px)}
.quitar-f{margin:10px 0 0}.quitar-f a{color:var(--cian);font-size:14px;font-weight:650}
.barra{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;padding:14px 0;border-bottom:1px solid var(--borde);margin-bottom:22px;font-size:14px}
.check{display:flex;gap:9px;align-items:center;cursor:pointer;color:var(--suave)}.check input{position:absolute;opacity:0}.caja{width:20px;height:20px;border-radius:7px;border:1.5px solid var(--borde-f);background:var(--tarjeta);display:inline-block;transition:all .3s var(--salida)}.check input:checked+.caja{background:var(--grad);border-color:transparent;box-shadow:0 6px 14px -6px ${color}}
.orden{color:var(--suave)}.orden select{border:1px solid var(--borde-f);border-radius:12px;padding:8px 12px;font:inherit;background:var(--tarjeta-s);color:var(--texto);margin-left:6px}
.rejilla{display:grid;grid-template-columns:repeat(4,1fr);gap:26px 18px}
.tarj{display:block}.tarj-foto{position:relative;aspect-ratio:4/5;background:var(--tarjeta-s);border:1px solid var(--borde);border-radius:20px;overflow:hidden;box-shadow:var(--sombra);transition:transform .6s var(--resorte),border-color .35s,box-shadow .35s}
.tarj:hover .tarj-foto{transform:translateY(-4px);border-color:color-mix(in srgb,${color} 50%,transparent);box-shadow:0 24px 50px -26px ${color}}
.tarj-foto img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:opacity .6s var(--salida),transform 1s var(--salida)}.tarj-foto .f2{opacity:0}.tarj:hover .f2{opacity:1}.tarj:hover .f1{transform:scale(1.05)}
.sin-foto{position:absolute;inset:0;display:grid;place-items:center;color:var(--tenue)}
.tarj-pie{display:flex;flex-direction:column;gap:2px;padding:12px 4px 0}.tarj-nombre{font-size:14.5px;font-weight:600;line-height:1.35}.tarj-precio{font-size:15px;font-weight:800;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.tarj.agotada .tarj-foto img{opacity:.5;filter:grayscale(.5)}
.insignia{position:absolute;top:12px;left:12px;z-index:2;background:rgba(5,7,13,.78);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);border:1px solid var(--borde-f);color:#fff;border-radius:999px;font-size:12px;font-weight:700;padding:4px 11px}.insignia.aviso{border-color:rgba(255,191,71,.5);color:var(--aviso)}
.paginas{display:flex;justify-content:space-between;align-items:center;margin:36px 0 10px;font-size:14px;color:var(--suave)}
/* Botones */
.boton{display:inline-flex;align-items:center;justify-content:center;gap:9px;padding:12px 20px;border:1px solid var(--borde-f);border-radius:14px;font-weight:700;cursor:pointer;background:var(--tarjeta);color:var(--texto);transition:transform .5s var(--resorte),border-color .3s,box-shadow .3s,filter .3s}
.boton:hover{transform:translateY(-2px);border-color:var(--marca)}.boton.grande{padding:15px 24px;font-size:15.5px}
.boton.principal{background:var(--grad);border-color:transparent;color:#fff;box-shadow:0 14px 32px -14px ${color}}.boton.principal:hover{filter:brightness(1.1);box-shadow:0 18px 40px -14px ${color}}
.icono-btn{display:grid;place-items:center;width:38px;height:38px;border-radius:50%;border:1px solid var(--borde-f);background:var(--tarjeta);cursor:pointer}
/* El producto */
.migas{display:flex;gap:8px;flex-wrap:wrap;padding:6px 0 18px;font-size:13px;color:var(--suave)}.migas a:hover{color:var(--cian)}.migas span:last-child{color:var(--texto)}
.prod{display:grid;grid-template-columns:1.1fr 1fr;gap:40px;align-items:start}
.galeria{position:sticky;top:90px}.gal-grande{position:relative;aspect-ratio:1/1;background:var(--tarjeta-s);border:1px solid var(--borde);border-radius:26px;overflow:hidden;box-shadow:var(--sombra)}.gal-grande img{width:100%;height:100%;object-fit:cover}
.gal-mini{display:flex;gap:10px;margin-top:12px;flex-wrap:wrap}.mini{width:70px;height:70px;border:2px solid transparent;border-radius:14px;overflow:hidden;padding:0;background:var(--tarjeta-s);cursor:pointer;opacity:.7;transition:all .3s var(--salida)}.mini.on,.mini:hover{border-color:var(--marca);opacity:1}.mini img{width:100%;height:100%;object-fit:cover}
.info-caja{background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.02));border:1px solid var(--borde);border-radius:26px;padding:28px;box-shadow:var(--sombra)}
:root[data-tema="claro"] .info-caja{background:#fff}
.marca-p{margin:0 0 4px;color:var(--cian);font-size:12.5px;font-weight:800;text-transform:uppercase;letter-spacing:.14em}.info h1{font-size:28px;margin-bottom:10px}
.precio{font-size:30px;font-weight:800;margin:0 0 4px;letter-spacing:-.02em;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent;display:inline-block}.cashea{margin:0 0 10px;color:var(--suave)}
.opciones{border:0;padding:0;margin:20px 0 4px}.opciones legend{font-size:13px;font-weight:800;margin-bottom:10px;padding:0;color:var(--suave);text-transform:uppercase;letter-spacing:.1em}
.pildoras{display:flex;gap:8px;flex-wrap:wrap}.pil{cursor:pointer}.pil input{position:absolute;opacity:0;pointer-events:none}
.pil span{display:inline-block;min-width:50px;text-align:center;padding:10px 15px;border:1px solid var(--borde-f);border-radius:14px;font-weight:700;background:var(--tarjeta);transition:all .35s var(--salida)}
.pil:hover span{border-color:var(--marca)}.pil input:checked+span{background:var(--grad);color:#fff;border-color:transparent;box-shadow:0 10px 22px -10px ${color};transform:translateY(-1px)}
.pil.agotada span{color:var(--tenue);text-decoration:line-through;cursor:not-allowed;opacity:.55}.pil input:focus-visible+span{outline:2px solid var(--cian);outline-offset:2px}
.cant{margin:18px 0}.cant label{display:block;font-size:13px;font-weight:800;margin-bottom:10px;color:var(--suave);text-transform:uppercase;letter-spacing:.1em}
.mas-menos{display:inline-flex;align-items:center;border:1px solid var(--borde-f);border-radius:14px;overflow:hidden;background:var(--tarjeta)}
.mas-menos button{border:0;background:transparent;width:42px;height:42px;font-size:18px;cursor:pointer;display:grid;place-items:center;transition:background .2s}.mas-menos button:hover{background:rgba(148,163,194,.14)}
.mas-menos input,.mas-menos>span{width:46px;text-align:center;border:0;font:inherit;font-weight:700;outline:none;background:transparent;color:var(--texto);-moz-appearance:textfield}.mas-menos input::-webkit-outer-spin-button,.mas-menos input::-webkit-inner-spin-button{-webkit-appearance:none}
.mas-menos.chico button{width:32px;height:32px}.mas-menos.chico>span{width:32px}
.acciones{display:flex;flex-direction:column;gap:10px;margin:22px 0}
.aviso-c{color:var(--aviso);font-weight:700}
.garantias{list-style:none;padding:18px 0 0;margin:20px 0 0;border-top:1px solid var(--borde);color:var(--suave);font-size:14px;display:grid;gap:10px}.garantias li{display:flex;gap:10px;align-items:flex-start}.garantias .ico{color:var(--cian);margin-top:2px}
.parecidos{margin-top:56px}.parecidos h2{margin-bottom:18px}
.compra-movil{display:none}
/* El carrito (lateral y página) */
.cajon{position:fixed;inset:0;z-index:60;visibility:hidden;pointer-events:none}.cajon.abierto{visibility:visible;pointer-events:auto}
.cajon-velo{position:absolute;inset:0;background:rgba(3,5,10,.62);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);opacity:0;transition:opacity .4s var(--salida)}.cajon.abierto .cajon-velo{opacity:1}
.cajon-panel{position:absolute;top:0;right:0;bottom:0;width:min(440px,100%);background:var(--fondo);border-left:1px solid var(--borde-f);padding:20px;display:flex;flex-direction:column;gap:14px;transform:translateX(100%);transition:transform .6s var(--resorte);box-shadow:-30px 0 80px -30px rgba(0,0,0,.8);overflow-y:auto}
:root[data-tema="claro"] .cajon-panel{background:#fff}.cajon.abierto .cajon-panel{transform:none}.cajon-cab{display:flex;justify-content:space-between;align-items:center}
.carrito{max-width:760px;margin:0 auto;padding:10px 0}.carrito h1{margin-bottom:18px}
.linea{display:grid;grid-template-columns:76px 1fr auto auto;gap:14px;align-items:center;padding:14px 0;border-bottom:1px solid var(--borde)}
.linea-foto{width:76px;height:76px;background:var(--tarjeta-s);border:1px solid var(--borde);border-radius:14px;overflow:hidden}.linea-foto img{width:100%;height:100%;object-fit:cover}
.linea-info{display:flex;flex-direction:column;gap:1px;min-width:0}.linea-info b{font-size:14.5px}.linea-precio{font-weight:800;color:var(--cian)}.quitar{border:0;background:transparent;cursor:pointer;color:var(--suave);font-size:15px;padding:6px}.quitar:hover{color:var(--mal)}
.resumen{margin-top:18px;display:grid;gap:12px}.total{display:flex;justify-content:space-between;align-items:baseline;font-size:20px}.total b{font-size:26px;letter-spacing:-.02em}
.vacio-c,.vacio{text-align:center;padding:44px 16px;color:var(--suave);display:grid;gap:12px;justify-items:center}.vacio{padding:70px 16px}.vacio-c .ico{color:var(--tenue)}
/* Pagar en la página */
.pagar{max-width:1100px;margin:0 auto}.volver{display:inline-flex;gap:6px;align-items:center;color:var(--suave);font-size:14px;font-weight:650;margin-bottom:12px}.volver:hover{color:var(--cian)}
.pagar-intro{margin:8px 0 22px;max-width:640px}
.pagar-grid{display:grid;grid-template-columns:1.35fr .9fr;gap:28px;align-items:start}
.paso{border:1px solid var(--borde);border-radius:24px;padding:22px;margin:0 0 16px;background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.02));box-shadow:var(--sombra);display:grid;gap:14px;min-width:0}
:root[data-tema="claro"] .paso,:root[data-tema="claro"] .pagar-resumen{background:#fff}
.paso-t{display:flex;align-items:center;gap:10px;font-size:17px;font-weight:800}
.num{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--grad);color:#fff;font-size:13.5px;box-shadow:0 6px 14px -6px ${color}}
.campo{display:grid;gap:6px;font-size:13.5px;font-weight:700;color:var(--suave)}.campo small{font-weight:600;color:var(--tenue)}.campo-t{display:block}
.campo input:not([type=radio]):not([type=checkbox]),.campo textarea,.campo select{width:100%;border:1px solid var(--borde-f);border-radius:13px;padding:12px 14px;font:inherit;font-weight:500;color:var(--texto);background:var(--tarjeta-s);outline:none;transition:border-color .3s,box-shadow .3s;resize:vertical}
.campo input:focus,.campo textarea:focus{border-color:var(--marca);box-shadow:0 0 0 4px color-mix(in srgb,${color} 18%,transparent)}
.dos-c{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.elegir{display:flex;gap:10px;flex-wrap:wrap}.elegir label{cursor:pointer;position:relative}.elegir input{position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;margin:0}
.elegir span{display:inline-flex;gap:8px;align-items:center;padding:10px 15px;border:1px solid var(--borde-f);border-radius:13px;font-weight:700;color:var(--texto);background:var(--tarjeta);transition:all .35s var(--salida)}
.elegir input:checked+span{background:var(--grad);color:#fff;border-color:transparent;box-shadow:0 10px 22px -10px ${color}}.elegir input:focus-visible+span{outline:2px solid var(--cian);outline-offset:2px}
.metodos{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.metodo{cursor:pointer;position:relative}.metodo input{position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;margin:0}
.metodo-c{display:grid;gap:3px;padding:14px;border:1px solid var(--borde-f);border-radius:16px;background:var(--tarjeta);transition:all .35s var(--salida);height:100%}.metodo-c .ico{color:var(--cian)}.metodo-c b{font-size:15px}.metodo-c small{color:var(--suave);font-size:12.5px}
.metodo:hover .metodo-c{border-color:var(--marca);transform:translateY(-1px)}
.metodo input:checked+.metodo-c{border-color:var(--marca);background:color-mix(in srgb,${color} 14%,var(--tarjeta-s));box-shadow:0 0 0 1px var(--marca),0 14px 30px -18px ${color}}.metodo input:focus-visible+.metodo-c{outline:2px solid var(--cian);outline-offset:2px}
.datos-pago{border:1px dashed color-mix(in srgb,${color} 55%,transparent);border-radius:16px;padding:14px 16px;background:color-mix(in srgb,${color} 7%,transparent);animation:entra .5s var(--salida)}
@keyframes entra{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.datos-cab{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:14px}
.datos-pago pre{margin:10px 0 6px;white-space:pre-wrap;word-break:break-word;font:600 15px/1.6 var(--fuente);color:var(--texto)}
.copiar{display:inline-flex;gap:6px;align-items:center;border:1px solid var(--borde-f);background:var(--tarjeta);border-radius:999px;padding:6px 12px;font-size:13px;font-weight:700;cursor:pointer;transition:all .3s var(--salida)}.copiar:hover{border-color:var(--marca)}.copiar.ok{background:var(--grad);color:#fff;border-color:transparent}
.monto{margin:4px 0 0;font-size:14.5px}.monto b{font-size:17px}
.subir{position:relative;display:grid;place-items:center;gap:8px;min-height:150px;padding:18px;border:1.5px dashed var(--borde-f);border-radius:18px;text-align:center;cursor:pointer;background:var(--tarjeta);transition:border-color .3s,background .3s}
.subir:hover,.subir.con{border-color:var(--marca)}.subir input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%}
.subir-txt{display:grid;gap:4px;justify-items:center;color:var(--suave)}.subir-txt b{color:var(--texto)}.subir-txt .ico{color:var(--cian)}
.subir img{max-height:220px;width:auto;border-radius:12px;border:1px solid var(--borde)}.subir.con .subir-txt small{display:none}.subir-nombre{font-weight:700;color:var(--cian)}
.error-pago{margin:0 0 12px;padding:12px 14px;border-radius:13px;border:1px solid color-mix(in srgb,var(--mal) 50%,transparent);background:color-mix(in srgb,var(--mal) 12%,transparent);color:var(--mal);font-weight:700}
.enviar{width:100%}.enviar.cargando{opacity:.8;cursor:progress}.boton[disabled]{opacity:.55;cursor:not-allowed;transform:none}
.chico{font-size:13px}
.pagar-resumen{position:sticky;top:90px;border:1px solid var(--borde);border-radius:24px;padding:22px;background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.02));box-shadow:var(--sombra);display:grid;gap:12px}
.res-lineas{display:grid;gap:12px}.res-linea{display:grid;grid-template-columns:56px 1fr auto;gap:12px;align-items:center;font-size:14px}
.res-foto{position:relative;width:56px;height:56px;border-radius:12px;background:var(--tarjeta-s);border:1px solid var(--borde)}.res-foto img{width:100%;height:100%;object-fit:cover;border-radius:inherit}
.res-foto i{position:absolute;top:-7px;right:-7px;min-width:20px;height:20px;border-radius:999px;background:var(--grad);color:#fff;font:800 11px/20px var(--fuente);text-align:center;padding:0 5px;font-style:normal}
.res-n{display:grid;min-width:0}.res-n small{color:var(--suave)}
/* Cómo va el pedido */
.estado-pedido{max-width:620px;margin:20px auto;text-align:center;display:grid;gap:12px;justify-items:center}
.estado-ico{width:84px;height:84px;border-radius:50%;display:grid;place-items:center;background:var(--grad);color:#fff;box-shadow:0 20px 50px -18px ${color};animation:latido 2.4s ease-in-out infinite}
.estado-pedido.bien .estado-ico{background:linear-gradient(135deg,#5ef0b0,#16a36a);box-shadow:0 20px 50px -18px #16a36a}.estado-pedido.mal .estado-ico{background:linear-gradient(135deg,#ff8f8f,#d92d2d);box-shadow:0 20px 50px -18px #d92d2d;animation:none}
@keyframes latido{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
.codigo{letter-spacing:.08em}.motivo{padding:10px 14px;border-radius:13px;background:color-mix(in srgb,var(--mal) 12%,transparent);color:var(--mal);font-weight:700}
.estado-caja{width:100%;text-align:left;border:1px solid var(--borde);border-radius:20px;padding:6px 18px;background:var(--tarjeta);box-shadow:var(--sombra)}
.estado-linea{display:flex;justify-content:space-between;gap:14px;padding:11px 0;border-bottom:1px solid var(--borde);font-size:14.5px}.estado-linea:last-child{border-bottom:0}.estado-linea span{color:var(--suave)}.estado-linea b{text-align:right}.total-l b{font-size:18px}
.estado-acciones{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:6px}
/* El pie */
.pie{margin-top:40px;border-top:1px solid var(--borde);background:linear-gradient(180deg,transparent,rgba(148,163,194,.05))}
.pie-in{max-width:1240px;margin:0 auto;padding:34px 20px 40px;display:flex;justify-content:space-between;gap:30px;flex-wrap:wrap;align-items:flex-start}
.pie-marca{display:grid;gap:12px;max-width:420px}.pie-marca .lg{width:200px;height:auto}.pie-marca p{margin:0;color:var(--suave);font-size:14px}.pie-marca .monograma.grande{width:64px;height:64px;font-size:30px;border-radius:18px}
.pie-links{display:grid;gap:10px;font-size:14px}.pie-links b{letter-spacing:.14em;text-transform:uppercase;font-size:12.5px;color:var(--suave)}.pie-links a{display:inline-flex;gap:8px;align-items:center;font-weight:650}.pie-links a:hover{color:var(--cian)}
@media(max-width:1000px){.pagar-grid{grid-template-columns:1fr}.pagar-resumen{position:static;order:-1}.rejilla{grid-template-columns:repeat(3,1fr)}.prod{grid-template-columns:1fr;gap:24px}.galeria{position:static}.heroe{grid-template-columns:1fr;padding:34px 26px}.heroe-logo{order:-1}.heroe-logo .lg{width:260px}.heroe h1{font-size:36px}.nav{display:none}}
@media(max-width:620px){.rejilla{grid-template-columns:repeat(2,1fr);gap:20px 12px}.col-rejilla{grid-template-columns:1fr 1fr}.cab-in{flex-wrap:wrap;gap:10px;padding:10px 14px}.buscar{order:3;flex:1 1 100%;max-width:none;margin:0}.marca{margin-right:auto}.marca-n{font-size:12px}
 main{padding:14px 14px 90px}.dos-c{grid-template-columns:1fr}.paso{padding:18px}.metodos{grid-template-columns:1fr 1fr}.cat-cab h2{font-size:22px}.heroe h1{font-size:30px}.info-caja{padding:20px}.info h1{font-size:23px}
 .linea{grid-template-columns:64px 1fr auto}.linea .mas-menos{grid-column:2}.linea-foto{width:64px;height:64px}
 .compra-movil{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:25;justify-content:space-between;align-items:center;gap:14px;padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:rgba(5,7,13,.86);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);border-top:1px solid var(--borde-f)}
 :root[data-tema="claro"] .compra-movil{background:rgba(255,255,255,.9)}.compra-movil b{font-size:22px}.compra-movil .boton{flex:1;max-width:220px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}.rev{opacity:1;transform:none}}
`;
