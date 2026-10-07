// LAS PANTALLAS DEL INVENTARIO Y LA CAJA, dentro del /panel de la tienda
// (fase 1, 7-oct-2026). Los datos y las reglas viven en inventario.js;
// aquí solo se pintan y se reciben los formularios.
//
// ESTE ARCHIVO ES IGUAL EN LAS TRES TIENDAS. panel.js lo llama con la
// sesión ya comprobada (misma clave del panel) y le pasa cómo pintar una
// página. Lo único propio de cada tienda es traerCatalogo(), que llega de
// index.js: de dónde salen sus modelos (Shopify, Drive o la hoja).
//
//   /panel/inventario                 los modelos, buscador, agotados
//   /panel/inventario/p/<id>          un modelo: tallas, stock por sede,
//                                     entrada / vendí / devolución / ajuste
//   /panel/inventario/nuevo           crear un modelo a mano
//   /panel/inventario/importar        traer del catálogo, o subir un Excel/CSV
//   /panel/inventario/sedes           las sedes de la tienda
//   /panel/inventario/movimientos     todo lo que se movió, quién y cuándo
//   /panel/inventario/etiquetas       hoja de etiquetas con código de barras
//   /panel/inventario.csv             todo el inventario para Excel
//   /panel/caja                       cobrar con lector o con la cámara

import {
  sedes,
  crearSede,
  listarProductos,
  contarProductos,
  verProducto,
  verVariante,
  buscarPorCodigo,
  movimientosRecientes,
  guardarProducto,
  editarProducto,
  archivarProducto,
  guardarVariante,
  leerOpciones,
  moverStock,
  ajustarStock,
  cobrar,
  ventasDelDia,
  importarCatalogo,
  importarCsv,
  filasParaExportar,
  svgEan13,
  TIPOS_DE_MOVIMIENTO,
} from "./inventario.js";
import { aCsv, respuestaCsv } from "./alpha.js";

const MAXIMO_CSV = 2 * 1024 * 1024;
const DESFASE_MS = -4 * 60 * 60 * 1000; // hora de Venezuela

function esc(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function horaExacta(ms) {
  if (!ms) return "";
  return new Date(ms).toLocaleString("es-VE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Caracas" });
}

function dinero(n) {
  if (n === null || n === undefined || n === "") return "";
  const v = Number(n);
  return Number.isFinite(v) ? `$${Number.isInteger(v) ? v : v.toFixed(2)}` : "";
}

function json(datos, estado = 200) {
  return new Response(JSON.stringify(datos), { status: estado, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

const ESTILO = `<style>
.inv-acciones{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 14px}
.inv-acciones a,.inv-acciones button{font-size:14px}
.inv-lista td{vertical-align:middle}.inv-lista img{width:44px;height:44px;object-fit:cover;border-radius:8px}
.cero{color:#ff6b6b;font-weight:600}.poco{color:#ffb547;font-weight:600}
.inv-mover{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:0}
.inv-mover input[type=number]{width:72px;flex:none}.inv-mover select{max-width:150px}
.inv-codigo svg{height:34px;width:auto;background:#fff;border-radius:4px;padding:2px}
.inv-aviso{padding:10px 14px;border-radius:10px;margin:8px 0 14px;border:1px solid var(--borde-fuerte)}
.inv-aviso.ok{border-color:rgba(46,204,113,.5)}.inv-aviso.error{border-color:rgba(255,107,107,.6)}
.caja-total{font-size:28px;font-weight:700}
.caja-lineas td{vertical-align:middle}
#lector{font-size:20px;padding:14px;width:100%}
#camara{width:100%;max-width:420px;border-radius:12px;display:none;margin:8px 0}
.form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
.form-grid label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--suave)}
</style>`;

// Quién hizo el movimiento. Cada navegador recuerda el suyo, para no
// escribirlo en cada botón.
const SCRIPT_QUIEN = `<script>
(function(){var k="inv_quien",v="";try{v=localStorage.getItem(k)||""}catch(e){}
document.querySelectorAll('input[name="quien"]').forEach(function(i){if(!i.value)i.value=v;i.addEventListener("change",function(){try{localStorage.setItem(k,i.value)}catch(e){}});});
document.querySelectorAll("form[data-quien]").forEach(function(f){f.addEventListener("submit",function(){var q=document.querySelector('input[name="quien"]');if(q&&!f.querySelector('input[name="quien"]')){var h=document.createElement("input");h.type="hidden";h.name="quien";h.value=q.value;f.appendChild(h)}})});})();
</script>`;

function aviso(url) {
  const ok = url.searchParams.get("ok");
  const error = url.searchParams.get("error");
  if (error) return `<div class="inv-aviso error">❌ ${esc(error.slice(0, 400))}</div>`;
  if (ok) return `<div class="inv-aviso ok">✅ ${esc(ok.slice(0, 400))}</div>`;
  return "";
}

function conAviso(ruta, { ok = "", error = "" } = {}) {
  const [camino, hash = ""] = ruta.split("#");
  const sep = camino.includes("?") ? "&" : "?";
  const extra = error ? `error=${encodeURIComponent(error)}` : ok ? `ok=${encodeURIComponent(ok)}` : "";
  return `${camino}${extra ? sep + extra : ""}${hash ? `#${hash}` : ""}`;
}

function volverSeguro(valor, porDefecto) {
  const v = String(valor || "");
  return /^\/panel\/(inventario|caja)(\/|\?|#|$)/.test(v) && !v.startsWith("//") ? v : porDefecto;
}

function campoQuien() {
  return `<label class="suave" style="display:inline-flex;gap:6px;align-items:center">Quién registra: <input name="quien" placeholder="Tu nombre" style="max-width:160px"></label>`;
}

function opcionesDeSedes(lista, elegida = 0) {
  return lista.map((s) => `<option value="${s.id}"${Number(elegida) === s.id ? " selected" : ""}>${esc(s.nombre)}</option>`).join("");
}

function nombreDeVariante(v) {
  const partes = [v.opcion !== "única" ? v.opcion : "", v.color].filter(Boolean);
  return partes.length ? partes.join(" · ") : "Única";
}

/* ── Las pantallas ───────────────────────────────────────────────────── */

async function paginaDeLista(env, url) {
  const q = String(url.searchParams.get("q") || "").slice(0, 40);
  const filtro = url.searchParams.get("f") || "";
  const [productos, cuenta] = await Promise.all([
    listarProductos(env.DB, { q, agotados: filtro === "agotados", soloConStock: filtro === "con-stock" }),
    contarProductos(env.DB),
  ]);
  const filtroLink = (f, nombre) => `<a class="${filtro === f ? "activo" : ""}" href="/panel/inventario?${new URLSearchParams({ ...(f ? { f } : {}), ...(q ? { q } : {}) })}">${nombre}</a>`;
  const filas = productos
    .map(
      (p) => `<tr>
<td>${p.foto ? `<img src="${esc(p.foto)}" alt="" loading="lazy">` : ""}</td>
<td><a href="/panel/inventario/p/${p.id}"><b>${esc(p.titulo)}</b></a>${p.marca ? `<div class="suave">${esc(p.marca)}${p.gama ? ` · ${esc(p.gama)}` : ""}</div>` : p.gama ? `<div class="suave">${esc(p.gama)}</div>` : ""}</td>
<td class="num">${p.variantes}</td>
<td class="num ${Number(p.total) === 0 ? "cero" : Number(p.total) <= 2 ? "poco" : ""}">${p.total}</td>
<td class="num">${esc(dinero(p.precio))}</td>
</tr>`
    )
    .join("");
  return `${ESTILO}<h2>📦 Inventario</h2>${aviso(url)}
<div class="kpis">
<div class="kpi"><div class="v">${cuenta.modelos}</div><div class="e">modelos</div></div>
<div class="kpi"><div class="v">${cuenta.variantes}</div><div class="e">tallas / variantes</div></div>
<div class="kpi"><div class="v">${cuenta.unidades}</div><div class="e">unidades en total</div></div>
</div>
<div class="inv-acciones"><a class="boton principal" href="/panel/caja">🧾 Abrir la caja</a><a class="boton" href="/panel/inventario/nuevo">➕ Nuevo modelo</a><a class="boton" href="/panel/inventario/importar">⬆️ Importar</a><a class="boton" href="/panel/inventario/movimientos">📜 Movimientos</a><a class="boton" href="/panel/inventario/sedes">🏬 Sedes</a><a class="boton" href="/panel/inventario/etiquetas">🏷️ Etiquetas</a><a class="boton" href="/panel/inventario.csv">⬇️ Excel</a></div>
<form class="buscar" method="get" action="/panel/inventario">${filtro ? `<input type="hidden" name="f" value="${esc(filtro)}">` : ""}<input name="q" value="${esc(q)}" placeholder="Buscar por nombre, marca o código de barras"><button>Buscar</button></form>
<div class="filtros">${filtroLink("", "Todos")}${filtroLink("con-stock", "Con stock")}${filtroLink("agotados", "Agotados")}</div>
${
  productos.length
    ? `<table class="tabla inv-lista"><thead><tr><th></th><th>Modelo</th><th class="num">Tallas</th><th class="num">Quedan</th><th class="num">Precio</th></tr></thead><tbody>${filas}</tbody></table>`
    : `<div class="tarjeta"><p>${q || filtro ? "No hay modelos con ese filtro." : "Todavía no hay nada en el inventario."}</p>${q || filtro ? "" : `<p>Empieza por <a href="/panel/inventario/importar">importar</a> el catálogo o un Excel, o crea un <a href="/panel/inventario/nuevo">modelo a mano</a>.</p>`}</div>`
}`;
}

async function paginaDeProducto(env, id, url) {
  const p = await verProducto(env.DB, id);
  if (!p) return null;
  const listaDeSedes = await sedes(env.DB);
  const sedeElegida = Number(url.searchParams.get("sede")) || listaDeSedes[0]?.id;
  const volver = `/panel/inventario/p/${p.id}`;
  const variantes = p.variantes
    .map((v) => {
      const enSede = v.porSede[sedeElegida] || 0;
      const otras = listaDeSedes
        .filter((s) => s.id !== sedeElegida && v.porSede[s.id])
        .map((s) => `${esc(s.nombre)}: ${v.porSede[s.id]}`)
        .join(" · ");
      return `<tr>
<td><b>${esc(nombreDeVariante(v))}</b>${v.codigo_fabricante ? `<div class="suave">Fábrica: ${esc(v.codigo_fabricante)}</div>` : ""}</td>
<td class="inv-codigo"><a href="/panel/inventario/etiquetas?variante=${v.id}" title="Imprimir etiquetas">${svgEan13(v.codigo_barras, { alto: 30 })}</a></td>
<td class="num ${enSede === 0 ? "cero" : enSede <= 2 ? "poco" : ""}">${enSede}${otras ? `<div class="suave">${otras}</div>` : ""}</td>
<td><form class="inv-mover" method="post" action="/panel/inventario/mover" data-quien>
<input type="hidden" name="variante" value="${v.id}"><input type="hidden" name="sede" value="${sedeElegida}"><input type="hidden" name="volver" value="${esc(volver)}?sede=${sedeElegida}">
<input type="number" name="cantidad" value="1" min="1" max="100000" aria-label="Cantidad">
<button name="tipo" value="entrada" title="Llegó mercancía">➕ Entrada</button>
<button name="tipo" value="venta" title="El cliente se lo llevó">🛒 Vendí</button>
<button name="tipo" value="devolucion" title="Lo devolvieron">↩️ Devolución</button>
</form>
<form class="inv-mover" method="post" action="/panel/inventario/ajustar" data-quien style="margin-top:6px">
<input type="hidden" name="variante" value="${v.id}"><input type="hidden" name="sede" value="${sedeElegida}"><input type="hidden" name="volver" value="${esc(volver)}?sede=${sedeElegida}">
<input type="number" name="cantidad" min="0" max="100000" placeholder="Contadas" aria-label="Cantidad contada">
<input name="nota" placeholder="Nota (opcional)" style="max-width:150px">
<button title="Pon la cantidad exacta que contaste">🔢 Ajustar</button>
</form></td>
</tr>`;
    })
    .join("");
  const movimientos = await movimientosRecientes(env.DB, { productoId: p.id, limite: 30 });
  return `${ESTILO}<p><a href="/panel/inventario">← Inventario</a></p>${aviso(url)}
<h2>${esc(p.titulo)}</h2>
<p class="suave">${[p.marca, p.gama, p.origen !== "manual" ? `del catálogo (${p.origen})` : "creado en el panel", dinero(p.precio) ? `precio ${dinero(p.precio)}` : "", dinero(p.precio_cashea) ? `Cashea ${dinero(p.precio_cashea)}` : ""].filter(Boolean).map(esc).join(" · ")}</p>
${p.fotos.length ? `<div class="inv-acciones">${p.fotos.slice(0, 6).map((f) => `<img src="${esc(f.url)}" alt="" loading="lazy" style="width:90px;height:90px;object-fit:cover;border-radius:10px">`).join("")}</div>` : ""}
<div class="tarjeta">
<form method="get" action="${volver}" class="inv-mover"><span class="suave">Sede:</span><select name="sede" onchange="this.form.submit()">${opcionesDeSedes(listaDeSedes, sedeElegida)}</select>${campoQuien()}</form>
${
  p.variantes.length
    ? `<table class="tabla"><thead><tr><th>Talla / variante</th><th>Código</th><th class="num">Quedan</th><th>Mover stock</th></tr></thead><tbody>${variantes}</tbody></table>`
    : `<p>Este modelo todavía no tiene tallas. Añádelas abajo.</p>`
}
<div class="inv-acciones"><a class="boton" href="/panel/inventario/etiquetas?producto=${p.id}">🏷️ Etiquetas de todo el modelo</a></div>
</div>
<div class="tarjeta"><h3>Añadir tallas o variantes</h3>
<form method="post" action="/panel/inventario/variante" class="form-grid"><input type="hidden" name="producto" value="${p.id}">
<label>Tallas o capacidades<input name="opciones" placeholder="40-45, o 38, 39, o 128GB"></label>
<label>Color (opcional)<input name="color"></label>
<label>Código de fábrica (opcional)<input name="codigo_fabricante" placeholder="El que trae la caja"></label>
<label>&nbsp;<button class="principal">Añadir</button></label></form>
<p class="suave">Cada talla nueva recibe su código de barras sola. Sin tallas (como en Invictus), deja la primera casilla vacía y se crea una variante "única".</p></div>
<div class="tarjeta"><h3>Datos del modelo</h3>
<form method="post" action="/panel/inventario/editar" class="form-grid"><input type="hidden" name="producto" value="${p.id}">
<label>Nombre<input name="titulo" value="${esc(p.titulo)}" required></label>
<label>Marca<input name="marca" value="${esc(p.marca)}"></label>
<label>Gama / calidad<input name="gama" value="${esc(p.gama)}" placeholder="1.1, AA, AAA"></label>
<label>Precio (divisas)<input name="precio" value="${esc(p.precio ?? "")}" inputmode="decimal"></label>
<label>Precio en Bs<input name="precio_local" value="${esc(p.precio_local ?? "")}" inputmode="decimal"></label>
<label>Precio Cashea<input name="precio_cashea" value="${esc(p.precio_cashea ?? "")}" inputmode="decimal"></label>
<label>&nbsp;<button>Guardar</button></label></form>
<form method="post" action="/panel/inventario/archivar" onsubmit="return confirm('¿Quitar este modelo del inventario? Su historial se guarda.')" style="margin-top:10px"><input type="hidden" name="producto" value="${p.id}"><button class="peligro">Quitar del inventario</button></form></div>
<h3>Últimos movimientos</h3>${tablaDeMovimientos(movimientos, { conModelo: false })}
${SCRIPT_QUIEN}`;
}

function tablaDeMovimientos(lista, { conModelo = true } = {}) {
  if (!lista.length) return `<p class="suave">Sin movimientos todavía.</p>`;
  return `<table class="tabla"><thead><tr><th>Cuándo</th>${conModelo ? "<th>Modelo</th>" : ""}<th>Talla</th><th>Sede</th><th>Qué</th><th class="num">Cambio</th><th class="num">Quedan</th><th>Quién</th><th>Nota</th></tr></thead><tbody>${lista
    .map(
      (m) => `<tr><td>${esc(horaExacta(m.creado))}</td>${conModelo ? `<td><a href="/panel/inventario/p/${m.producto_id}">${esc(m.titulo)}</a></td>` : ""}<td>${esc(nombreDeVariante(m))}</td><td>${esc(m.sede || "")}</td><td>${esc(TIPOS_DE_MOVIMIENTO[m.tipo] || m.tipo)}${m.venta_id ? ` <span class="suave">#${m.venta_id}</span>` : ""}</td><td class="num">${m.delta > 0 ? `+${m.delta}` : m.delta}</td><td class="num">${m.queda}</td><td>${esc(m.quien)}</td><td class="suave">${esc(m.nota)}</td></tr>`
    )
    .join("")}</tbody></table>`;
}

function paginaDeNuevo(url) {
  return `${ESTILO}<p><a href="/panel/inventario">← Inventario</a></p>${aviso(url)}<h2>➕ Nuevo modelo</h2>
<div class="tarjeta"><form method="post" action="/panel/inventario/nuevo" class="form-grid">
<label>Nombre<input name="titulo" required placeholder="Nike Air Force One blanco"></label>
<label>Marca<input name="marca"></label>
<label>Gama / calidad<input name="gama" placeholder="1.1, AA, AAA"></label>
<label>Tallas o capacidades<input name="opciones" placeholder="36-45, o vacío si no maneja tallas"></label>
<label>Color (opcional)<input name="color"></label>
<label>Precio (divisas)<input name="precio" inputmode="decimal"></label>
<label>Precio Cashea<input name="precio_cashea" inputmode="decimal"></label>
<label>Código de fábrica (opcional)<input name="codigo_fabricante"></label>
<label>&nbsp;<button class="principal">Crear</button></label>
</form><p class="suave">Cada talla recibe su código de barras automático. Después cargas cuántas hay con "Entrada" o "Ajustar".</p></div>`;
}

async function paginaDeImportar(env, url, { traerCatalogo, nombreDelCatalogo }) {
  const listaDeSedes = await sedes(env.DB);
  return `${ESTILO}<p><a href="/panel/inventario">← Inventario</a></p>${aviso(url)}<h2>⬆️ Importar</h2>
${
  traerCatalogo
    ? `<div class="tarjeta"><h3>1. Traer los modelos del catálogo</h3>
<p>Lee ${esc(nombreDelCatalogo || "el catálogo de la tienda")} y crea en el inventario los modelos que falten. Los que ya están se ponen al día (nombre, precio, fotos) sin tocar su stock.</p>
<form method="post" action="/panel/inventario/importar/catalogo" data-quien class="inv-mover"><select name="sede">${opcionesDeSedes(listaDeSedes)}</select><button class="principal">Traer del catálogo</button></form>
<p class="suave">Si el catálogo trae cantidades (como la hoja de EPICCELL), se cargan en la sede elegida solo la primera vez. Volver a traerlo no duplica nada.</p></div>`
    : ""
}
<div class="tarjeta"><h3>${traerCatalogo ? "2. " : ""}Subir un Excel o CSV de stock</h3>
<p>Sirve para pasar el inventario del sistema viejo. En Excel: <b>Archivo → Guardar como → CSV</b>. Encabezados que se reconocen: <b>código</b>, <b>producto</b>, <b>talla</b>, <b>color</b>, <b>cantidad</b>, <b>precio</b>, <b>marca</b> y <b>sede</b>.</p>
<form method="post" action="/panel/inventario/importar/csv" enctype="multipart/form-data" data-quien class="form-grid">
<label>Archivo CSV<input type="file" name="archivo" accept=".csv,text/csv,.txt" required></label>
<label>Sede (si el archivo no dice)<select name="sede">${opcionesDeSedes(listaDeSedes)}</select></label>
<label><span><input type="checkbox" name="probar" value="si" checked> Solo probar, sin guardar</span></label>
<label>&nbsp;<button class="principal">Subir</button></label>
</form>
<p class="suave">La cantidad de cada fila es la que se contó: queda tal cual, y la diferencia se guarda como movimiento. Un código de barras viejo se guarda como "de fábrica" y sigue pasando en caja. Si el producto no existe, se crea.</p></div>
${campoQuien()}${SCRIPT_QUIEN}`;
}

function informeDeImportacion(titulo, informe, { probando = false } = {}) {
  const lineas = Object.entries(informe)
    .filter(([k]) => k !== "errores")
    .map(([k, v]) => `<li>${esc(k)}: <b>${esc(v)}</b></li>`)
    .join("");
  return `${ESTILO}<p><a href="/panel/inventario/importar">← Importar</a> · <a href="/panel/inventario">Inventario</a></p>
<h2>${esc(titulo)}</h2>${probando ? `<div class="inv-aviso">🧪 Fue una prueba: no se guardó nada. Si está bien, vuelve y desmarca "Solo probar".</div>` : `<div class="inv-aviso ok">✅ Listo.</div>`}
<div class="tarjeta"><ul>${lineas}</ul>${informe.errores?.length ? `<h3>Filas con problemas</h3><ul>${informe.errores.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}</div>`;
}

async function paginaDeSedes(env, url) {
  const lista = await sedes(env.DB);
  return `${ESTILO}<p><a href="/panel/inventario">← Inventario</a></p>${aviso(url)}<h2>🏬 Sedes</h2>
<div class="tarjeta"><ul>${lista.map((s) => `<li>${esc(s.nombre)}</li>`).join("")}</ul>
<form method="post" action="/panel/inventario/sedes" class="inv-mover"><input name="nombre" placeholder="Nombre de la sede nueva" required><button class="principal">Añadir sede</button></form>
<p class="suave">Cada movimiento y cada venta de caja dice en qué sede pasó. El bot suma todas las sedes para saber si hay.</p></div>`;
}

async function paginaDeMovimientos(env, url) {
  const lista = await movimientosRecientes(env.DB, { limite: 300 });
  const desde = new Date(new Date(Date.now() + DESFASE_MS).toISOString().slice(0, 10)).getTime() - DESFASE_MS;
  const ventas = await ventasDelDia(env.DB, desde);
  const total = ventas.reduce((a, v) => a + (Number(v.total) || 0), 0);
  return `${ESTILO}<p><a href="/panel/inventario">← Inventario</a></p>${aviso(url)}<h2>📜 Movimientos</h2>
<div class="kpis"><div class="kpi"><div class="v">${ventas.length}</div><div class="e">ventas de caja hoy</div></div><div class="kpi"><div class="v">${ventas.reduce((a, v) => a + (Number(v.unidades) || 0), 0)}</div><div class="e">unidades vendidas hoy</div></div><div class="kpi"><div class="v">${esc(dinero(total) || "$0")}</div><div class="e">cobrado hoy (con precio cargado)</div></div></div>
${tablaDeMovimientos(lista)}`;
}

// LAS ETIQUETAS. Dos formatos: "termica" (una por etiqueta, 50 × 25 mm,
// para impresoras de rollo) y "hoja" (rejilla en carta para impresora
// normal). Se imprime con el botón del navegador.
async function paginaDeEtiquetas(env, url, tienda) {
  const formato = url.searchParams.get("formato") === "termica" ? "termica" : "hoja";
  const copias = Math.max(1, Math.min(Number(url.searchParams.get("n")) || 1, 200));
  const conPrecio = url.searchParams.get("precio") !== "no";
  let variantes = [];
  const varianteId = Number(url.searchParams.get("variante")) || 0;
  const productoId = Number(url.searchParams.get("producto")) || 0;
  if (varianteId) {
    const v = await verVariante(env.DB, varianteId);
    if (v) variantes = [v];
  } else if (productoId) {
    const p = await verProducto(env.DB, productoId);
    if (p) variantes = p.variantes.map((v) => ({ ...v, titulo: p.titulo, precioFinal: v.precio ?? p.precio }));
  }
  if (!variantes.length) {
    return `${ESTILO}<p><a href="/panel/inventario">← Inventario</a></p><h2>🏷️ Etiquetas</h2>
<div class="tarjeta"><p>Abre un modelo del inventario y toca 🏷️ en una talla (o "Etiquetas de todo el modelo").</p>
<form method="get" action="/panel/inventario/etiquetas" class="inv-mover"><input name="codigo" placeholder="O escanea / escribe un código"><button>Buscar</button></form></div>
${url.searchParams.get("codigo") ? await (async () => {
      const v = await buscarPorCodigo(env.DB, url.searchParams.get("codigo"));
      return v ? `<script>location.replace("/panel/inventario/etiquetas?variante=${v.id}")</script>` : `<div class="inv-aviso error">No encuentro ese código.</div>`;
    })() : ""}`;
  }
  const una = (v) => `<div class="etq"><div class="etq-t">${esc(String(v.titulo).slice(0, 48))}</div><div class="etq-o">${esc(nombreDeVariante(v))}${conPrecio && dinero(v.precioFinal) ? ` · <b>${esc(dinero(v.precioFinal))}</b>` : ""}</div>${svgEan13(v.codigo_barras, { alto: 40 })}</div>`;
  const todas = variantes.flatMap((v) => Array.from({ length: copias }, () => una(v))).join("");
  const params = (cambio) => `/panel/inventario/etiquetas?${new URLSearchParams({ ...Object.fromEntries(url.searchParams), ...cambio })}`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Etiquetas · ${esc(tienda)}</title>
<style>
body{font-family:system-ui,sans-serif;margin:16px;color:#000;background:#fff}
.barra{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
.barra a,.barra button{padding:8px 12px;border:1px solid #999;border-radius:8px;background:#f4f4f4;color:#000;text-decoration:none;font-size:14px}
.barra a.activo{background:#0a5cf5;color:#fff;border-color:#0a5cf5}
.etq{box-sizing:border-box;overflow:hidden;text-align:center;page-break-inside:avoid;break-inside:avoid}
.etq svg{width:100%;height:auto;display:block}
.etq-t{font-size:10px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.etq-o{font-size:10px}
.hoja .etiquetas{display:grid;grid-template-columns:repeat(4,1fr);gap:4mm}
.hoja .etq{border:1px dashed #bbb;padding:2mm}
.termica .etq{width:50mm;height:25mm;padding:1mm 2mm;page-break-after:always;break-after:page}
.termica .etq svg{height:13mm;width:auto;margin:0 auto}
@media print{.barra{display:none}body{margin:0}.hoja .etiquetas{gap:2mm}
${formato === "termica" ? "@page{size:50mm 25mm;margin:0}" : "@page{size:letter;margin:8mm}"}}
</style></head><body class="${formato}">
<div class="barra"><a href="/panel/inventario${productoId ? `/p/${productoId}` : ""}">← Volver</a>
<a class="${formato === "hoja" ? "activo" : ""}" href="${esc(params({ formato: "hoja" }))}">Hoja carta</a>
<a class="${formato === "termica" ? "activo" : ""}" href="${esc(params({ formato: "termica" }))}">Impresora de etiquetas (50×25 mm)</a>
<form method="get" style="display:inline-flex;gap:6px;align-items:center">${[...url.searchParams].filter(([k]) => k !== "n").map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("")}Copias de cada una: <input type="number" name="n" value="${copias}" min="1" max="200" style="width:60px"><button>OK</button></form>
<a href="${esc(params({ precio: conPrecio ? "no" : "si" }))}">${conPrecio ? "Sin precio" : "Con precio"}</a>
<button onclick="print()">🖨️ Imprimir</button></div>
<div class="etiquetas">${todas}</div></body></html>`;
}

// LA CAJA. Un lector de códigos (USB, Bluetooth, láser, infrarrojo o de
// imagen) escribe el código y pulsa Enter, como un teclado: no hay que
// instalar nada. Sin lector, el botón 📷 lee con la cámara del celular.
async function paginaDeCaja(env, url) {
  const listaDeSedes = await sedes(env.DB);
  return `${ESTILO}<h2>🧾 Caja</h2>${aviso(url)}
<div class="tarjeta">
<div class="inv-mover" style="margin-bottom:10px"><span class="suave">Sede:</span><select id="sede">${opcionesDeSedes(listaDeSedes)}</select>${campoQuien()}</div>
<input id="lector" autofocus autocomplete="off" inputmode="none" placeholder="Escanea el código o escribe el nombre y Enter">
<div class="inv-acciones" style="margin-top:8px"><button type="button" id="btn-camara">📷 Leer con la cámara</button><button type="button" id="btn-teclado" title="Para escribir a mano en el celular">⌨️ Teclado</button></div>
<video id="camara" playsinline muted></video>
<div id="resultados"></div>
</div>
<div class="tarjeta"><table class="tabla caja-lineas"><thead><tr><th>Producto</th><th class="num">Precio</th><th class="num">Cant.</th><th class="num">Hay</th><th></th></tr></thead><tbody id="lineas"><tr><td colspan="5" class="suave">Escanea el primer producto.</td></tr></tbody></table>
<div class="inv-mover" style="justify-content:space-between;margin-top:12px"><div class="caja-total" id="total">$0</div>
<div class="inv-mover"><select id="metodo"><option value="">Método de pago</option><option>Divisas (efectivo)</option><option>Pago móvil</option><option>Transferencia</option><option>Punto de venta</option><option>Zelle</option><option>Cashea</option><option>Bolívares (efectivo)</option><option>Otro</option></select>
<button class="principal" id="cobrar">✅ Cobrar</button><button id="vaciar">Vaciar</button></div></div>
<div id="mensaje"></div></div>
<p class="suave">Al cobrar se descuenta el stock de la sede elegida: es la confirmación de que el cliente se lleva el producto. Si algo no alcanza, no se descuenta nada.</p>
${SCRIPT_QUIEN}
<script>
(function(){
var lineas=[],lector=document.getElementById("lector"),tb=document.getElementById("lineas"),msg=document.getElementById("mensaje");
function $(s){return document.querySelector(s)}
function esc(t){return String(t==null?"":t).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function dinero(n){return n==null?"":"$"+(Math.round(n*100)/100)}
function sede(){return $("#sede").value}
function pitido(ok){try{var a=new (window.AudioContext||window.webkitAudioContext)(),o=a.createOscillator();o.frequency.value=ok?880:220;o.connect(a.destination);o.start();o.stop(a.currentTime+(ok?.08:.25))}catch(e){}}
function pintar(){
 if(!lineas.length){tb.innerHTML='<tr><td colspan="5" class="suave">Escanea el primer producto.</td></tr>';$("#total").textContent="$0";return}
 var total=0,sinPrecio=false;
 tb.innerHTML=lineas.map(function(l,i){var hay=l.porSede[sede()]||0;if(l.precio==null)sinPrecio=true;else total+=l.precio*l.cantidad;
  return '<tr><td><b>'+esc(l.titulo)+'</b><div class="suave">'+esc(l.variante)+'</div></td><td class="num">'+esc(dinero(l.precio))+'</td><td class="num"><button data-menos="'+i+'">−</button> '+l.cantidad+' <button data-mas="'+i+'">+</button></td><td class="num '+(hay<l.cantidad?"cero":"")+'">'+hay+'</td><td><button data-quitar="'+i+'">✕</button></td></tr>'}).join("");
 $("#total").textContent=dinero(total)+(sinPrecio?" + sin precio":"");
}
tb.addEventListener("click",function(e){var t=e.target,i;
 if((i=t.getAttribute("data-mas"))!=null)lineas[i].cantidad++;
 else if((i=t.getAttribute("data-menos"))!=null){if(--lineas[i].cantidad<1)lineas.splice(i,1)}
 else if((i=t.getAttribute("data-quitar"))!=null)lineas.splice(i,1);
 pintar();lector.focus()});
function agregar(v){
 var ya=lineas.find(function(l){return l.id===v.id});
 if(ya)ya.cantidad++;else lineas.push({id:v.id,titulo:v.titulo,variante:v.variante,precio:v.precio,cantidad:1,porSede:v.porSede});
 pintar();pitido(true);$("#resultados").innerHTML="";
}
function aviso(t,ok){msg.innerHTML='<div class="inv-aviso '+(ok?"ok":"error")+'">'+esc(t)+"</div>";if(!ok)pitido(false)}
function leer(texto){
 texto=String(texto||"").trim();if(!texto)return;msg.innerHTML="";
 fetch("/panel/caja/buscar?q="+encodeURIComponent(texto),{credentials:"same-origin"}).then(function(r){return r.json()}).then(function(d){
  if(d.variante)return agregar(d.variante);
  if(d.opciones&&d.opciones.length){$("#resultados").innerHTML='<p class="suave">Elige cuál:</p>'+d.opciones.map(function(o,i){return '<button data-op="'+i+'" style="margin:3px">'+esc(o.titulo)+" · "+esc(o.variante)+" ("+(o.porSede[sede()]||0)+")</button>"}).join("");
   $("#resultados").onclick=function(e){var i=e.target.getAttribute("data-op");if(i!=null)agregar(d.opciones[i])};return}
  aviso("No encuentro «"+texto+"» en el inventario.",false);
 }).catch(function(){aviso("No pude buscar. ¿Hay internet?",false)});
}
lector.addEventListener("keydown",function(e){if(e.key==="Enter"){e.preventDefault();var t=lector.value;lector.value="";leer(t)}});
$("#btn-teclado").onclick=function(){lector.setAttribute("inputmode","text");lector.focus()};
$("#sede").onchange=pintar;
$("#vaciar").onclick=function(){lineas=[];pintar();lector.focus()};
$("#cobrar").onclick=function(){
 if(!lineas.length)return aviso("La venta está vacía.",false);
 var b=this;b.disabled=true;
 fetch("/panel/caja/cobrar",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({sede:sede(),quien:($('input[name="quien"]')||{}).value||"",metodo:$("#metodo").value,items:lineas.map(function(l){return{variante:l.id,cantidad:l.cantidad}})})})
 .then(function(r){return r.json()}).then(function(d){b.disabled=false;
  if(!d.ok)return aviso(d.error||"No se pudo cobrar.",false);
  aviso("Venta #"+d.ventaId+" registrada: "+d.unidades+" unidad(es)"+(d.total!=null?" · "+dinero(d.total):"")+". El stock ya se descontó.",true);pitido(true);lineas=[];pintar();lector.focus();
 }).catch(function(){b.disabled=false;aviso("No se pudo cobrar: sin conexión. No se descontó nada.",false)});
};
// LA CÁMARA. BarcodeDetector viene en Chrome de Android; donde no está
// (iPhone), se carga ZXing, que hace lo mismo en cualquier navegador.
var leyendo=false,flujo=null,video=$("#camara");
function parar(){leyendo=false;if(flujo)flujo.getTracks().forEach(function(t){t.stop()});flujo=null;video.style.display="none";$("#btn-camara").textContent="📷 Leer con la cámara"}
function cargarZxing(){return new Promise(function(ok,mal){if(window.ZXing)return ok();var s=document.createElement("script");s.src="https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js";s.onload=ok;s.onerror=mal;document.head.appendChild(s)})}
var ultimo="",cuando=0;
function leido(c){var ahora=Date.now();if(c===ultimo&&ahora-cuando<2500)return;ultimo=c;cuando=ahora;leer(c)}
$("#btn-camara").onclick=function(){
 if(leyendo)return parar();
 if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)return aviso("Este navegador no deja usar la cámara.",false);
 leyendo=true;this.textContent="⏹️ Apagar la cámara";video.style.display="block";
 if("BarcodeDetector" in window){
  navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}}).then(function(s){flujo=s;video.srcObject=s;video.play();
   var det=new BarcodeDetector({formats:["ean_13","ean_8","upc_a","upc_e","code_128","code_39","qr_code"]});
   (function mirar(){if(!leyendo)return;det.detect(video).then(function(r){if(r[0])leido(r[0].rawValue)}).catch(function(){}).then(function(){setTimeout(mirar,250)})})();
  }).catch(function(){parar();aviso("No me dieron permiso para la cámara.",false)});
 } else {
  cargarZxing().then(function(){var lectorZ=new ZXing.BrowserMultiFormatReader();
   lectorZ.decodeFromConstraints({video:{facingMode:"environment"}},video,function(r){if(r)leido(r.getText())}).then(function(){flujo=video.srcObject});
   var parar0=parar;parar=function(){try{lectorZ.reset()}catch(e){}parar0()};
  }).catch(function(){parar();aviso("No pude cargar el lector de la cámara. Usa un lector o escribe el nombre.",false)});
 }
};
})();
</script>`;
}

/* ── Las rutas ───────────────────────────────────────────────────────── */

// helpers: { pagina(titulo, cuerpo), vieneDelPanel(request, url), redirigir(a) }
// opciones: { tienda, traerCatalogo?, nombreDelCatalogo? }
export function esRutaDeInventario(url) {
  return url.pathname === "/panel/inventario" || url.pathname.startsWith("/panel/inventario/") || url.pathname === "/panel/inventario.csv" || url.pathname === "/panel/caja" || url.pathname.startsWith("/panel/caja/");
}

export async function atenderInventario(request, env, url, helpers, opciones = {}) {
  const { pagina, vieneDelPanel, redirigir } = helpers;
  const ruta = url.pathname;
  const tienda = opciones.tienda || "La tienda";

  if (request.method === "POST") {
    if (!vieneDelPanel(request, url)) return new Response("No", { status: 403 });
    return atenderPost(request, env, url, { redirigir, pagina, opciones });
  }

  if (ruta === "/panel/inventario") return pagina("Inventario", await paginaDeLista(env, url));
  if (ruta === "/panel/inventario.csv") {
    const filas = await filasParaExportar(env.DB);
    return respuestaCsv(
      `inventario-${new Date(Date.now() + DESFASE_MS).toISOString().slice(0, 10)}.csv`,
      aCsv(
        ["Producto", "Marca", "Gama", "Talla", "Color", "Código de barras", "Código de fábrica", "Precio", "Sede", "Cantidad"],
        filas.map((f) => [f.titulo, f.marca, f.gama, f.opcion, f.color, f.codigo_barras, f.codigo_fabricante || "", f.precio ?? "", f.sede, f.cantidad])
      )
    );
  }
  if (ruta.startsWith("/panel/inventario/p/")) {
    const cuerpo = await paginaDeProducto(env, ruta.slice("/panel/inventario/p/".length), url);
    return cuerpo ? pagina("Modelo", cuerpo) : redirigir(conAviso("/panel/inventario", { error: "Ese modelo ya no existe." }));
  }
  if (ruta === "/panel/inventario/nuevo") return pagina("Nuevo modelo", paginaDeNuevo(url));
  if (ruta === "/panel/inventario/importar") return pagina("Importar", await paginaDeImportar(env, url, opciones));
  if (ruta === "/panel/inventario/sedes") return pagina("Sedes", await paginaDeSedes(env, url));
  if (ruta === "/panel/inventario/movimientos") return pagina("Movimientos", await paginaDeMovimientos(env, url));
  if (ruta === "/panel/inventario/etiquetas") {
    const html = await paginaDeEtiquetas(env, url, tienda);
    // La hoja de etiquetas es una página propia, en blanco, para imprimir.
    if (html.startsWith("<!doctype")) return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    return pagina("Etiquetas", html);
  }
  if (ruta === "/panel/caja") return pagina("Caja", await paginaDeCaja(env, url));
  if (ruta === "/panel/caja/buscar") return json(await buscarParaCaja(env, url.searchParams.get("q")));
  return redirigir("/panel/inventario");
}

function paraCaja(v) {
  return {
    id: v.id,
    titulo: v.titulo,
    variante: nombreDeVariante(v),
    precio: v.precioFinal ?? v.precio ?? v.precio_producto ?? null,
    porSede: v.porSede || {},
  };
}

// Lo que llega a la caja: un código (lector o cámara) o un nombre escrito.
async function buscarParaCaja(env, texto) {
  const q = String(texto || "").trim().slice(0, 64);
  if (!q) return { variante: null, opciones: [] };
  const exacta = await buscarPorCodigo(env.DB, q);
  if (exacta) return { variante: paraCaja(exacta) };
  if (/^\d{6,}$/.test(q)) return { variante: null, opciones: [] };
  const modelos = await listarProductos(env.DB, { q, limite: 8 });
  const opciones = [];
  for (const m of modelos) {
    const p = await verProducto(env.DB, m.id);
    for (const v of p?.variantes || []) {
      opciones.push(paraCaja({ ...v, titulo: p.titulo, precioFinal: v.precio ?? p.precio }));
      if (opciones.length >= 24) break;
    }
    if (opciones.length >= 24) break;
  }
  if (opciones.length === 1) return { variante: opciones[0] };
  return { variante: null, opciones };
}

async function atenderPost(request, env, url, { redirigir, pagina, opciones }) {
  const ruta = url.pathname;

  if (ruta === "/panel/caja/cobrar") {
    let datos = {};
    try {
      datos = await request.json();
    } catch {
      return json({ ok: false, error: "Pedido inválido." }, 400);
    }
    try {
      const r = await cobrar(env.DB, {
        sedeId: datos.sede,
        quien: datos.quien,
        metodoPago: datos.metodo,
        items: (datos.items || []).map((i) => ({ varianteId: i.variante, cantidad: i.cantidad })),
      });
      console.log(`CAJA: venta ${r.ventaId} (${r.unidades} u) por ${datos.quien || "—"}`);
      return json({ ok: true, ...r });
    } catch (error) {
      return json({ ok: false, error: error.message }, error.name === "SinStock" ? 409 : 400);
    }
  }

  if (ruta === "/panel/inventario/importar/csv") {
    const datos = await request.formData().catch(() => null);
    const archivo = datos?.get("archivo");
    if (!archivo || typeof archivo === "string") return redirigir(conAviso("/panel/inventario/importar", { error: "Elige un archivo CSV." }));
    if (archivo.size > MAXIMO_CSV) return redirigir(conAviso("/panel/inventario/importar", { error: "El archivo pasa de 2 MB. Pártelo en dos." }));
    const probando = datos.get("probar") === "si";
    try {
      const informe = await importarCsv(env.DB, await archivo.text(), { sedeId: datos.get("sede"), quien: datos.get("quien") || "", aplicar: !probando });
      return pagina(
        "Importación",
        informeDeImportacion("Importación del Excel/CSV", { "Filas leídas": informe.filas, "Productos nuevos": informe.nuevos, "Tallas con stock puesto": informe.actualizadas, "Sin cambios": informe.sinCambio, errores: informe.errores }, { probando })
      );
    } catch (error) {
      return redirigir(conAviso("/panel/inventario/importar", { error: error.message }));
    }
  }

  const datos = await request.formData().catch(() => null);
  const quien = String(datos?.get("quien") || "").trim();

  if (ruta === "/panel/inventario/importar/catalogo") {
    if (!opciones.traerCatalogo) return redirigir("/panel/inventario/importar");
    let items;
    try {
      items = await opciones.traerCatalogo();
    } catch (error) {
      return redirigir(conAviso("/panel/inventario/importar", { error: `No pude leer el catálogo: ${error.message}` }));
    }
    if (!items?.length) return redirigir(conAviso("/panel/inventario/importar", { error: "El catálogo llegó vacío. Revisa que la fuente se pueda leer." }));
    const informe = await importarCatalogo(env.DB, items, { sedeId: datos?.get("sede"), quien });
    console.log(`INVENTARIO: catálogo importado (${informe.modelos} modelos, ${informe.variantes} variantes)`);
    return pagina(
      "Importación",
      informeDeImportacion("Modelos traídos del catálogo", { "Modelos": informe.modelos, "Tallas / variantes": informe.variantes, "Con stock cargado": informe.conStock, errores: informe.errores })
    );
  }

  if (ruta === "/panel/inventario/mover" || ruta === "/panel/inventario/ajustar") {
    const volver = volverSeguro(datos?.get("volver"), "/panel/inventario");
    try {
      const args = { varianteId: datos.get("variante"), sedeId: datos.get("sede"), cantidad: datos.get("cantidad"), quien, nota: String(datos.get("nota") || "") };
      const queda =
        ruta === "/panel/inventario/ajustar"
          ? await ajustarStock(env.DB, args)
          : await moverStock(env.DB, { ...args, tipo: String(datos.get("tipo") || "") });
      const tipo = ruta === "/panel/inventario/ajustar" ? "Ajustado" : TIPOS_DE_MOVIMIENTO[datos.get("tipo")] || "Movido";
      return redirigir(conAviso(volver, { ok: `${tipo}. Quedan ${queda} en esa sede.` }));
    } catch (error) {
      return redirigir(conAviso(volver, { error: error.message }));
    }
  }

  if (ruta === "/panel/inventario/nuevo") {
    try {
      const productoId = await guardarProducto(env.DB, {
        origen: "manual",
        titulo: datos.get("titulo"),
        marca: datos.get("marca"),
        gama: datos.get("gama"),
        precio: datos.get("precio"),
        precio_cashea: datos.get("precio_cashea"),
      });
      const opcionesDeTalla = leerOpciones(datos.get("opciones"));
      for (const opcion of opcionesDeTalla) {
        await guardarVariante(env.DB, productoId, {
          opcion,
          color: datos.get("color"),
          codigo_fabricante: opcionesDeTalla.length === 1 ? datos.get("codigo_fabricante") : "",
        });
      }
      return redirigir(conAviso(`/panel/inventario/p/${productoId}`, { ok: `Creado con ${opcionesDeTalla.length} ${opcionesDeTalla.length === 1 ? "variante" : "tallas"}, cada una con su código.` }));
    } catch (error) {
      return redirigir(conAviso("/panel/inventario/nuevo", { error: error.message }));
    }
  }

  const productoId = Number(datos?.get("producto")) || 0;
  const alProducto = `/panel/inventario/p/${productoId}`;

  if (ruta === "/panel/inventario/variante") {
    const lista = leerOpciones(datos.get("opciones"));
    for (const opcion of lista) {
      await guardarVariante(env.DB, productoId, { opcion, color: datos.get("color"), codigo_fabricante: lista.length === 1 ? datos.get("codigo_fabricante") : "" });
    }
    return redirigir(conAviso(alProducto, { ok: `${lista.length} ${lista.length === 1 ? "variante añadida" : "tallas añadidas"}.` }));
  }
  if (ruta === "/panel/inventario/editar") {
    await editarProducto(env.DB, productoId, Object.fromEntries(["titulo", "marca", "gama", "precio", "precio_local", "precio_cashea"].map((k) => [k, datos.get(k)])));
    return redirigir(conAviso(alProducto, { ok: "Guardado." }));
  }
  if (ruta === "/panel/inventario/archivar") {
    await archivarProducto(env.DB, productoId);
    return redirigir(conAviso("/panel/inventario", { ok: "Modelo quitado del inventario." }));
  }
  if (ruta === "/panel/inventario/sedes") {
    await crearSede(env.DB, datos?.get("nombre"));
    return redirigir(conAviso("/panel/inventario/sedes", { ok: "Sede añadida." }));
  }
  return redirigir("/panel/inventario");
}
