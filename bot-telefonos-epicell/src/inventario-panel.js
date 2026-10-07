// LAS PANTALLAS DEL INVENTARIO Y LA CAJA, dentro del /panel de la tienda
// (fase 1, 7-oct-2026). Los datos y las reglas viven en inventario.js;
// aquí solo se pintan y se reciben los formularios. Las piezas de la cara
// (cabeceras, tarjetas, ventanitas, íconos) salen de marco.js.
//
// ESTE ARCHIVO ES IGUAL EN LAS TRES TIENDAS. panel.js lo llama con la
// sesión ya comprobada (misma clave del panel) y le pasa cómo pintar una
// página. Lo propio de cada tienda llega en opciones, desde index.js:
//   traerCatalogo()   de dónde salen sus modelos (Shopify, Drive o la hoja)
//   rubro             "calzado", "moda" o "telefonos" (marco.js): tallas o
//                     capacidades, gama o condición, IMEI en la caja
//   tarifaDeCaja      "cashea" en EPICCELL: la caja muestra y cobra el
//                     precio Cashea, salvo que el cliente pague en divisas
//                     en efectivo; ahí va el precio en dólares (Gabriel,
//                     7-oct-2026).
//
//   /panel/inventario                 los productos, buscador, filtros
//   /panel/inventario/p/<id>          un producto: tallas, stock por sede,
//                                     mover (entrada / vendí / devolución / contar)
//   /panel/inventario/nuevo           crear un producto a mano
//   /panel/inventario/importar        traer del catálogo, o subir un Excel/CSV
//   /panel/inventario/sedes           las sedes de la tienda
//   /panel/inventario/movimientos     todo lo que se movió, quién y cuándo
//   /panel/inventario/etiquetas       hoja de etiquetas con código de barras
//   /panel/inventario.csv             todo el inventario para Excel
//   /panel/caja                       cobrar con lector, cámara o tocando

import {
  sedes,
  sedesConStock,
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
  editarVariante,
  leerAjuste,
  guardarAjuste,
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
import { verVenta, textoDelRecibo, METODOS_DE_PAGO, diaDe } from "./negocio.js";
import { iconoDeMetodo, enlaceWhatsapp } from "./negocio-panel.js";
import { aCsv, respuestaCsv } from "./alpha.js";
import { iconoSuelto } from "./iconos.js";
import {
  esc,
  plata,
  numero,
  cifra,
  fechaHora,
  horaCorta,
  diaBonito,
  icono,
  cabecera,
  segmento,
  vacio,
  insignia,
  dato,
  rubroDe,
  mayuscula,
  pastillaDeStock,
  tostadaDesde,
  ventana,
  botonCerrarVentana,
} from "./marco.js";

const MAXIMO_CSV = 2 * 1024 * 1024;
const DESFASE_MS = -4 * 60 * 60 * 1000; // hora de Venezuela
const DIVISAS = "Divisas (efectivo)";

function json(datos, estado = 200) {
  return new Response(JSON.stringify(datos), { status: estado, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

// La regla de la caja de EPICCELL, en un solo lugar: precio Cashea salvo
// en divisas en efectivo.
export function tarifaDeLaVenta(tarifaDeCaja, metodo) {
  return tarifaDeCaja === "cashea" && metodo !== DIVISAS ? "cashea" : "";
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

function opcionesDeSedes(lista, elegida = 0) {
  return lista.map((s) => `<option value="${s.id}"${Number(elegida) === s.id ? " selected" : ""}>${esc(s.nombre)}</option>`).join("");
}

function nombreDeVariante(v) {
  const partes = [v.opcion !== "única" ? v.opcion : "", v.color].filter(Boolean);
  return partes.length ? partes.join(" · ") : "Única";
}

// Un color propio para cada producto sin foto (el mismo nombre, el mismo color).
function tonoDe(texto) {
  let h = 0;
  for (const c of String(texto || "")) h = (h * 31 + c.codePointAt(0)) % 360;
  return h;
}

function inicialesDe(titulo) {
  const palabras = String(titulo || "?").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  return ((palabras[0]?.[0] || "?") + (palabras[1]?.[0] || "")).toUpperCase();
}

function fotoDe(url, titulo) {
  return url
    ? `<img src="${esc(url)}" alt="" loading="lazy" decoding="async">`
    : `<span class="foto-vacia" style="--h:${tonoDe(titulo)}" aria-hidden="true"><b>${esc(inicialesDe(titulo))}</b></span>`;
}

function precioDeLista(min, max) {
  if (min === null || min === undefined) return "";
  return Number(max) > Number(min) + 0.009 ? `desde ${plata(min, { siempre: true })}` : plata(min, { siempre: true });
}

const ORIGENES = { shopify: "Shopify", drive: "Google Drive", sheets: "la hoja de Google", manual: "el panel" };

const ICONO_DE_MOVIMIENTO = {
  entrada: ["mas", "bien"],
  venta: ["carrito", "marca"],
  devolucion: ["deshacer", "aviso"],
  ajuste: ["lista", "neutro"],
  carga: ["inventario", "neutro"],
};

const TEXTO_DE_MOVIMIENTO = {
  entrada: "Llegó mercancía",
  venta: "Vendí",
  devolucion: "Devolución",
  ajuste: "Contar",
};

/* ── El estilo propio de estas pantallas ─────────────────────────────── */

const ESTILO = `<style>
.inv-atajos{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 20px}
.inv-atajos a{display:inline-flex;align-items:center;gap:8px;padding:8px 15px 8px 11px;border-radius:999px;background:var(--velo);border:1px solid var(--borde);color:var(--suave);font-size:13.5px;font-weight:700;transition:transform .55s var(--resorte),color .25s,border-color .25s,background .25s}
.inv-atajos a:hover{color:var(--texto);border-color:rgba(61,134,255,.45);transform:translateY(-2px)}
.inv-atajos .ico{width:18px;height:18px;color:var(--cian);--ico-opacidad:.3}
.foto-vacia{position:absolute;inset:0;display:grid;place-items:center;background:radial-gradient(120% 100% at 15% 0%,hsl(var(--h) 75% 58% / .4),transparent 62%),linear-gradient(140deg,hsl(var(--h) 55% 28% / .55),hsl(calc(var(--h) + 50) 55% 16% / .45))}
.foto-vacia b{font-size:40px;font-weight:800;letter-spacing:-.05em;color:hsl(var(--h) 90% 88% / .92);text-shadow:0 10px 30px hsl(var(--h) 80% 20% / .55)}
[data-tema="claro"] .foto-vacia{background:radial-gradient(120% 100% at 15% 0%,hsl(var(--h) 85% 78% / .6),transparent 62%),linear-gradient(140deg,hsl(var(--h) 70% 91%),hsl(calc(var(--h) + 50) 60% 85%))}
[data-tema="claro"] .foto-vacia b{color:hsl(var(--h) 55% 32%);text-shadow:none}
.producto-pie .producto-cashea{font-size:12px;font-weight:750;color:var(--violeta)}
.ficha-producto{display:grid;grid-template-columns:minmax(0,.85fr) minmax(0,1.35fr);gap:18px;align-items:start}
@media (max-width:1000px){.ficha-producto{grid-template-columns:1fr}}
.ficha-foto{position:relative;aspect-ratio:1/1;border-radius:28px;overflow:hidden;border:1px solid var(--borde);background:var(--velo);box-shadow:var(--sombra)}
.ficha-foto img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:opacity .35s var(--salida),transform .9s var(--salida)}
.ficha-foto:hover img{transform:scale(1.03)}
.ficha-foto .foto-vacia b{font-size:76px}
@media (max-width:1000px){.ficha-foto{aspect-ratio:16/10}}
.miniaturas{display:flex;gap:8px;margin-top:10px;overflow-x:auto;scrollbar-width:none;padding:2px}
.miniaturas button{flex:none;width:64px;height:64px;min-height:0;padding:0;border-radius:18px;overflow:hidden;border:2px solid transparent;background:var(--velo);transition:border-color .25s,transform .5s var(--resorte)}
.miniaturas button:hover{transform:translateY(-2px)}
.miniaturas button.activa{border-color:var(--cian)}
.miniaturas img{width:100%;height:100%;object-fit:cover;display:block}
.datos-lista{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:14px}
.datos-lista>div{padding:13px 15px;border-radius:18px;background:var(--velo);border:1px solid var(--borde);min-width:0}
.datos-lista span{display:block;font-size:12px;font-weight:700;color:var(--suave)}
.datos-lista b{display:block;font-size:19px;font-weight:800;letter-spacing:-.025em;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.datos-lista small{display:block;font-size:12px;color:var(--suave);font-weight:600;margin-top:1px}
.datos-lista .ancho{grid-column:1/-1}
.stock-cima{display:flex;align-items:center;justify-content:space-between;gap:10px 14px;flex-wrap:wrap;margin-bottom:14px}
.stock-cima h2{margin:0}
.variante-mover{min-height:40px;padding:8px 15px;font-size:13.5px}
.variante-cantidad b.cero{color:var(--mal)}.variante-cantidad b.poco{color:var(--aviso)}
.paso-cantidad{display:flex;align-items:center;gap:8px}
.paso-cantidad input{flex:1;min-width:0;text-align:center;font-size:28px;font-weight:800;letter-spacing:-.03em;min-height:58px;border-radius:20px;-moz-appearance:textfield;appearance:textfield}
.paso-cantidad input::-webkit-inner-spin-button,.paso-cantidad input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
.paso-cantidad button{width:58px;height:58px;min-height:0;padding:0;border-radius:20px;flex:none}
.ventana form{display:flex;flex-direction:column;gap:12px;margin-top:14px}
.ventana .mover-tipos{margin:0}
.mover-ayuda{margin:0;font-size:13px;line-height:1.5;color:var(--suave);min-height:3em}
.solo-venta{display:none!important}
.ventana form:has(input[name="tipo"][value="venta"]:checked) .solo-venta{display:flex!important}
.ventana .acciones{justify-content:flex-end;margin:6px 0 0}
.ventana-ancha{width:min(620px,calc(100vw - 32px))}
.pasos-importar{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px;align-items:start}
.pasos-importar p{color:var(--suave);font-size:14px;line-height:1.55}
.archivo{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:28px 16px;border-radius:22px;border:1.5px dashed var(--borde-fuerte);background:var(--velo);text-align:center;color:var(--suave);font-size:13.5px;font-weight:650;cursor:pointer;transition:border-color .25s,background .25s,transform .55s var(--resorte)}
.archivo:hover,.archivo.encima{border-color:var(--cian);background:var(--marca-fondo)}
.archivo.encima{transform:scale(1.015)}
.archivo.listo{border-style:solid;border-color:rgba(61,220,151,.45);background:var(--bien-fondo)}
.archivo input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer}
.archivo .ico{width:32px;height:32px;color:var(--cian);--ico-opacidad:.3;margin-bottom:4px}
.archivo.listo .ico{color:var(--bien)}
.archivo b{color:var(--texto);font-size:15px}
.encabezados{display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 16px}
.formulario-pie{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:16px}
.aviso-grande{display:flex;align-items:flex-start;gap:14px;padding:18px;border-radius:22px;margin-bottom:18px;border:1px solid var(--borde)}
.aviso-grande.bien{background:var(--bien-fondo);border-color:rgba(61,220,151,.3)}
.aviso-grande.aviso{background:var(--aviso-fondo);border-color:rgba(255,191,71,.3)}
.aviso-grande b{display:block;font-size:16px;margin-bottom:2px}.aviso-grande p{margin:0;color:var(--suave);font-size:14px}
.aviso-grande .acciones{margin:12px 0 0}
.lista-errores{margin:0;padding-left:20px;color:var(--suave);font-size:13.5px;line-height:1.7}
.pos-campo{position:relative;display:flex;align-items:center;flex:1 1 180px;min-width:0}
.pos-campo>.ico{position:absolute;left:15px;width:18px;height:18px;color:var(--tenue);pointer-events:none;z-index:1}
.pos-campo input,.pos-campo select{width:100%;padding-left:42px;border-radius:999px;min-height:46px}
.pos-productos{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:10px}
.pos-producto{position:relative;display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start;gap:0;padding:0;min-height:0;border-radius:20px;overflow:hidden;text-align:left;white-space:normal;background:var(--capa);border:1px solid var(--borde);color:var(--texto);font-weight:600;box-shadow:var(--sombra);animation:entrar .55s var(--salida) both;animation-delay:calc(var(--n,0) * 18ms)}
.pos-producto:hover{background:var(--capa);border-color:rgba(61,134,255,.45);transform:translateY(-3px)}
.pos-producto:active{transform:scale(.95);transition-duration:.12s}
.pos-producto[hidden]{display:none}
.pos-producto.tocado{animation:tocar .55s var(--resorte)}
@keyframes tocar{35%{transform:scale(.93)}100%{transform:none}}
.pos-foto{position:relative;display:block;aspect-ratio:16/10;overflow:hidden;background:var(--velo)}
.pos-foto img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.pos-foto .foto-vacia b{font-size:24px}
.pos-cuantos{position:absolute;right:8px;top:8px;min-width:24px;height:24px;padding:0 7px;display:grid;place-items:center;border-radius:999px;font-size:12px;font-weight:800;color:#fff;background:rgba(5,9,18,.62);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.pos-cuantos.poco{color:#ffcf70}
.pos-info{display:flex;flex-direction:column;gap:3px;padding:9px 11px 11px}
.pos-info b{font-size:13px;line-height:1.28;font-weight:750;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pos-info .precio{font-size:13.5px;font-weight:800;color:var(--texto);font-variant-numeric:tabular-nums}
.pos-sin-coincidencias{grid-column:1/-1;padding:18px;text-align:center;color:var(--suave);font-size:14px;border-radius:18px;border:1px dashed var(--borde-fuerte)}
.resultados-titulo{grid-column:1/-1;margin:0;font-size:13px;font-weight:700;color:var(--suave)}
.resultado .stock{margin-top:2px}
.resultados.tallas{grid-template-columns:repeat(auto-fill,minmax(104px,1fr))}
.resultados.tallas .resultado{align-items:center;text-align:center;padding:12px 8px}
.resultados.tallas .resultado b{font-size:20px;font-weight:800;letter-spacing:-.02em}
.resultado:disabled{opacity:.45}
@media (max-width:640px){.resultados{grid-template-columns:repeat(2,minmax(0,1fr))}.resultados.tallas{grid-template-columns:repeat(3,minmax(0,1fr))}}
.tarifa-nota{display:inline-flex;margin-left:8px;font-style:normal;font-size:11.5px;font-weight:800;padding:3px 9px;border-radius:999px;color:var(--violeta);background:rgba(139,124,255,.14);vertical-align:2px;transition:color .3s,background .3s}
.tarifa-nota.divisas{color:var(--bien);background:var(--bien-fondo)}
.tarifa-nota:empty{display:none}
.ticket-linea.quieta{animation:none}.ticket-linea.quieta.destello{animation:destello-linea .9s var(--salida)}
.ticket-linea .chip{margin-left:6px}
.pos-ticket h2{flex-wrap:wrap}
.pos-ticket h2 .vaciar{margin-left:auto}
.pos-ticket h2 .chip{font-size:12px}
.boton-cobrar b{font-variant-numeric:tabular-nums}
.boton-cobrar.cargando{pointer-events:none;filter:saturate(.7)}
.boton-cobrar.cargando .ico{animation:girar .9s linear infinite}
@keyframes girar{to{transform:rotate(360deg)}}
.campo-titulo{font-size:13px;font-weight:700;color:var(--suave);margin:2px 2px 8px}
.enlace-chico{display:inline-flex;align-items:center;gap:6px;background:none!important;border:0;padding:4px 2px;min-height:0;color:var(--cian);font-size:13px;font-weight:700;margin:0 0 12px;box-shadow:none}
.enlace-chico:hover{color:var(--texto)}
.libre-form{display:grid;grid-template-columns:minmax(0,1fr) 110px;gap:8px;margin:10px 0 0;padding:12px;border-radius:18px;background:var(--velo);border:1px dashed var(--borde-fuerte);animation:entrar .45s var(--salida)}
.libre-form[hidden]{display:none}
.libre-form .acciones{grid-column:1/-1;margin:0;justify-content:flex-end}
.pos-nota{font-size:12.5px;margin:12px 2px 0;line-height:1.5}
.metodos.sacude,.fiado-datos.sacude{animation:sacudir .45s}
.camara-marco{display:none;position:relative;margin-top:12px;border-radius:22px;overflow:hidden;background:#000}
.camara-marco.encendida{display:block;animation:crecer-suave .5s var(--resorte)}
.camara-marco.encendida #camara{display:block;margin:0;border-radius:0}
.camara-mira{position:absolute;inset:22% 14%;border-radius:18px;box-shadow:0 0 0 999px rgba(0,0,0,.38);border:2px solid rgba(255,255,255,.85);pointer-events:none}
.camara-mira::after{content:"";position:absolute;left:6%;right:6%;top:50%;height:2px;border-radius:2px;background:linear-gradient(90deg,transparent,#ff6b6b,transparent);box-shadow:0 0 12px #ff6b6b;animation:barrer 1.8s ease-in-out infinite}
@keyframes barrer{0%,100%{transform:translateY(-26px)}50%{transform:translateY(26px)}}
.pos-flotante{display:none}
@media (max-width:1000px){
.pos-flotante:not([hidden]){position:fixed;z-index:19;left:12px;right:12px;bottom:calc(88px + env(safe-area-inset-bottom));display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 10px 10px 18px;border-radius:24px;background:var(--tarjeta-alta);border:1px solid var(--borde-fuerte);box-shadow:var(--sombra-alta);animation:subir-flotante .6s var(--resorte)}
.pos-flotante b{display:block;font-size:20px;font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums}.pos-flotante small{font-size:12px;color:var(--suave);font-weight:650}
.pos-flotante .boton{min-height:46px}}
@keyframes subir-flotante{from{transform:translateY(30px);opacity:0}}
.pos-flotante{transition:transform .5s var(--resorte),opacity .3s}.pos-flotante.oculto{transform:translateY(24px);opacity:0;pointer-events:none}
.sede-uni{font-size:22px!important}
</style>`;

/* ── Las piezas ──────────────────────────────────────────────────────── */

function tarjetaDeProducto(p, n, r) {
  const precio = precioDeLista(p.precio_min ?? p.precio, p.precio_max ?? p.precio);
  const cashea = p.cashea_min !== null && p.cashea_min !== undefined ? precioDeLista(p.cashea_min, p.cashea_max) : "";
  const detalle = [p.marca, p.gama, Number(p.variantes) > 1 ? `${p.variantes} ${r.variantes}` : ""].filter(Boolean).join(" · ");
  return `<a class="producto" href="/panel/inventario/p/${p.id}" style="--n:${Math.min(n, 30)}"><div class="producto-foto">${fotoDe(p.foto, p.titulo)}${pastillaDeStock(p.total)}</div>
<div class="producto-pie"><b>${esc(p.titulo)}</b>${detalle ? `<small>${esc(detalle)}</small>` : ""}<span class="producto-precio">${precio ? esc(precio) : '<span class="suave">Sin precio</span>'}</span>${cashea ? `<span class="producto-cashea">Cashea ${esc(cashea)}</span>` : ""}</div></a>`;
}

function filaDeMovimiento(m, { conModelo = true } = {}) {
  const [ico, tono] = ICONO_DE_MOVIMIENTO[m.tipo] || ["movimientos", "neutro"];
  const que = TIPOS_DE_MOVIMIENTO[m.tipo] || m.tipo;
  const variante = nombreDeVariante(m);
  const titulo = conModelo ? `${m.titulo}${variante !== "Única" ? ` · ${variante}` : ""}` : `${que}${variante !== "Única" ? ` · ${variante}` : ""}`;
  const sub = [conModelo ? que : "", horaCorta(m.creado), m.sede, m.quien, m.venta_id ? `venta #${m.venta_id}` : "", m.nota].filter(Boolean).map(esc).join(" · ");
  const delta = Number(m.delta) || 0;
  const href = m.venta_id ? `/panel/ventas/${m.venta_id}` : conModelo ? `/panel/inventario/p/${m.producto_id}` : "";
  const etiqueta = href ? `a class="fila" href="${href}"` : 'div class="fila"';
  return `<${etiqueta}>${insignia(ico, tono, "chica")}<div class="fila-centro"><div class="fila-titulo">${esc(titulo)}</div><div class="fila-sub">${sub}</div></div><div class="fila-fin"><b class="${delta > 0 ? "bien" : ""}">${delta > 0 ? "+" : delta < 0 ? "−" : ""}${Math.abs(delta)}</b><small>quedan ${esc(m.queda)}</small></div></${href ? "a" : "div"}>`;
}

function listaDeMovimientos(lista, { conModelo = true } = {}) {
  if (!lista.length) return vacio({ icono: "movimientos", titulo: "Sin movimientos todavía", texto: "Cada entrada, venta, devolución o conteo queda aquí con quién lo hizo y cuántos quedaron." });
  const hoy = diaDe(Date.now());
  const porDia = new Map();
  for (const m of lista) {
    const d = diaDe(m.creado);
    if (!porDia.has(d)) porDia.set(d, []);
    porDia.get(d).push(m);
  }
  return [...porDia.entries()]
    .map(([dia, filas]) => `<div class="dia-titulo"><b>${esc(diaBonito(dia, hoy))}</b><span>${filas.length} ${filas.length === 1 ? "movimiento" : "movimientos"}</span></div><div class="filas">${filas.map((m) => filaDeMovimiento(m, { conModelo })).join("")}</div>`)
    .join("");
}

function selectorDeSede(lista, elegida, nombre = "sede") {
  return lista.length > 1
    ? `<label class="campo">Sede<select name="${nombre}">${opcionesDeSedes(lista, elegida)}</select></label>`
    : `<input type="hidden" name="${nombre}" value="${lista[0]?.id || ""}">`;
}

const volverAlInventario = { href: "/panel/inventario", texto: "Inventario" };

/* ── Las pantallas ───────────────────────────────────────────────────── */

async function paginaDeLista(env, url, r) {
  const q = String(url.searchParams.get("q") || "").slice(0, 40);
  const filtro = ["con-stock", "pocos", "agotados"].includes(url.searchParams.get("f")) ? url.searchParams.get("f") : "";
  const [productos, cuenta] = await Promise.all([
    listarProductos(env.DB, { q, agotados: filtro === "agotados", soloConStock: filtro === "con-stock", porReponer: filtro === "pocos" }),
    contarProductos(env.DB),
  ]);
  const enlace = (f) => {
    const p = new URLSearchParams({ ...(f ? { f } : {}), ...(q ? { q } : {}) }).toString();
    return `/panel/inventario${p ? `?${p}` : ""}`;
  };
  const filtros = segmento(
    [
      ["", "Todos", enlace("")],
      ["con-stock", "Con stock", enlace("con-stock")],
      ["pocos", "Por reponer", enlace("pocos")],
      ["agotados", "Agotados", enlace("agotados")],
    ],
    filtro,
    { nombre: "Filtrar el inventario" }
  );
  const nadaTodavia = !cuenta.modelos;
  return `${ESTILO}${tostadaDesde(url)}${cabecera({
    sobre: "Tu negocio",
    titulo: "Inventario",
    texto: "Cada producto con su código de barras, cuántos quedan en cada sede y todo lo que se movió.",
    acciones: `<a class="boton suave" href="/panel/inventario/importar">${icono("subir")}Importar</a><a class="boton principal" href="/panel/inventario/nuevo">${icono("mas")}Nuevo producto</a>`,
  })}
${
  nadaTodavia
    ? ""
    : `<div class="mosaico">
${dato({ nombre: "Productos", valor: cifra(cuenta.modelos, { tipo: "numero" }), icono: "inventario", pie: `${numero(cuenta.variantes)} ${cuenta.variantes === 1 ? r.variante : r.variantes}` })}
${dato({ nombre: "Unidades", valor: cifra(cuenta.unidades, { tipo: "numero" }), icono: "rejilla", pie: "entre todas las sedes" })}
${dato({ nombre: "Lo que tienes vale", valor: cifra(cuenta.valor), icono: "efectivo", tono: "bien", pie: cuenta.conCosto ? `te costó ${esc(plata(cuenta.costo, { siempre: true }))}` : "a precio de venta" })}
${dato({ nombre: "Por reponer", valor: cifra(cuenta.porReponer, { tipo: "numero" }), icono: "alerta", tono: cuenta.porReponer ? "aviso" : "neutro", pie: cuenta.agotados ? `${cuenta.agotados} ${cuenta.agotados === 1 ? "agotado" : "agotados"}` : "nada agotado", href: "/panel/inventario?f=pocos" })}
</div>`
}
<nav class="inv-atajos" aria-label="Más del inventario"><a href="/panel/caja">${icono("caja")}Caja</a><a href="/panel/inventario/movimientos">${icono("movimientos")}Movimientos</a><a href="/panel/inventario/sedes">${icono("sede")}Sedes</a><a href="/panel/inventario/etiquetas">${icono("etiqueta")}Etiquetas</a><a href="/panel/inventario.csv">${icono("bajar")}Excel</a></nav>
${
  nadaTodavia
    ? vacio({
        icono: "inventario",
        titulo: "Tu inventario está vacío",
        texto: `Trae los productos del catálogo de la tienda o de un Excel, o crea el primero a mano. Cada ${r.variante} recibe su código de barras sola.`,
        acciones: `<a class="boton principal" href="/panel/inventario/importar">${icono("subir")}Importar</a><a class="boton suave" href="/panel/inventario/nuevo">${icono("mas")}Crear uno a mano</a>`,
      })
    : `<div class="herramientas"><form class="buscador" method="get" action="/panel/inventario" role="search">${filtro ? `<input type="hidden" name="f" value="${esc(filtro)}">` : ""}${icono("buscar")}<input name="q" value="${esc(q)}" placeholder="Nombre, marca o código de barras" aria-label="Buscar en el inventario"></form>${filtros}</div>
${
  productos.length
    ? `<div class="productos">${productos.map((p, n) => tarjetaDeProducto(p, n, r)).join("")}</div>`
    : vacio({
        icono: q ? "buscar" : filtro === "agotados" || filtro === "pocos" ? "check" : "filtro",
        titulo: q ? `Nada con «${q}»` : filtro === "agotados" ? "No hay nada agotado" : filtro === "pocos" ? "No hay nada por reponer" : "Nada con este filtro",
        texto: q ? "Prueba con otra palabra, la marca o escanea el código." : "",
        acciones: `<a class="boton suave" href="/panel/inventario">Ver todo</a>`,
      })
}`
}`;
}

async function paginaDeProducto(env, id, url, opciones = {}) {
  const r = rubroDe(opciones.rubro);
  const p = await verProducto(env.DB, id);
  if (!p) return null;
  const listaDeSedes = await sedes(env.DB);
  const sedeElegida = listaDeSedes.some((s) => s.id === Number(url.searchParams.get("sede"))) ? Number(url.searchParams.get("sede")) : listaDeSedes[0]?.id;
  const nombreSede = listaDeSedes.find((s) => s.id === sedeElegida)?.nombre || "la sede";
  const volver = `/panel/inventario/p/${p.id}?sede=${sedeElegida}`;
  const total = p.variantes.reduce((a, v) => a + v.total, 0);
  const enSede = p.variantes.reduce((a, v) => a + (v.porSede[sedeElegida] || 0), 0);
  const precios = p.variantes.map((v) => v.precio ?? p.precio).filter((x) => x !== null && x !== undefined);
  const precioTexto = precios.length ? precioDeLista(Math.min(...precios), Math.max(...precios)) : "";
  const cashea = p.variantes.map((v) => v.precioCashea).filter((x) => x !== null && x !== undefined);
  const casheaTexto = cashea.length ? precioDeLista(Math.min(...cashea), Math.max(...cashea)) : "";
  const margen = p.costo !== null && p.costo !== undefined && precios.length ? Math.min(...precios) - Number(p.costo) : null;

  const fotos = p.fotos.slice(0, 8);
  const galeria = `<div class="ficha-foto" id="foto-grande">${fotoDe(fotos[0]?.url, p.titulo)}</div>${
    fotos.length > 1 ? `<div class="miniaturas">${fotos.map((f, i) => `<button type="button" class="${i ? "" : "activa"}" data-foto="${esc(f.url)}" aria-label="Foto ${i + 1}"><img src="${esc(f.url)}" alt="" loading="lazy"></button>`).join("")}</div>` : ""
  }`;

  const cuadros = [
    `<span>Precio</span><b>${precioTexto ? esc(precioTexto) : "—"}</b>${p.precio_local ? `<small>Bs ${esc(numero(p.precio_local))}</small>` : ""}`,
    casheaTexto ? `<span>Precio Cashea</span><b>${esc(casheaTexto)}</b>` : "",
    `<span>Te costó</span><b>${p.costo !== null && p.costo !== undefined ? esc(plata(p.costo, { siempre: true })) : "—"}</b>${margen !== null ? `<small>ganas ${esc(plata(margen, { siempre: true }))} por unidad</small>` : "<small>ponlo en Editar para ver la ganancia</small>"}`,
    p.variantes.length && !p.variantes.some((v) => v.contada)
      ? `<span>Quedan</span><b>—</b><small>sin contar: usa Mover › Contar</small>`
      : `<span>Quedan</span><b>${esc(numero(total))}</b><small>${listaDeSedes.length > 1 ? "entre todas las sedes" : esc(nombreSede)}</small>`,
  ].filter(Boolean);
  // Si quedan impares, el último ocupa la fila entera (sin huecos).
  const datos = `<div class="datos-lista">
${cuadros.map((c, i) => `<div${cuadros.length % 2 && i === cuadros.length - 1 ? ' class="ancho"' : ""}>${c}</div>`).join("")}
<div class="ancho"><span>Viene de</span><b style="font-size:15px">${esc(ORIGENES[p.origen] || p.origen)}</b>${p.origen !== "manual" ? "<small>Al volver a traer el catálogo se pone al día el nombre, el precio y las fotos. El stock no se toca.</small>" : ""}</div>
</div>`;

  const sedesSegmento =
    listaDeSedes.length > 1
      ? segmento(
          listaDeSedes.map((s) => [s.id, s.nombre, `/panel/inventario/p/${p.id}?sede=${s.id}`]),
          sedeElegida,
          { nombre: "Sede" }
        )
      : "";

  const filas = p.variantes
    .map((v) => {
      const aqui = v.porSede[sedeElegida] || 0;
      const otras = listaDeSedes
        .filter((s) => s.id !== sedeElegida && v.porSede[s.id])
        .map((s) => `${s.nombre}: ${v.porSede[s.id]}`)
        .join(" · ");
      const sub = [v.codigo_fabricante ? `Fábrica ${v.codigo_fabricante}` : "", v.precio !== null && v.precio !== undefined && v.precio !== p.precio ? plata(v.precio, { siempre: true }) : "", otras].filter(Boolean).join(" · ");
      const datosMover = esc(JSON.stringify({ id: v.id, nombre: nombreDeVariante(v), hay: aqui }));
      const datosEditar = esc(
        JSON.stringify({ id: v.id, nombre: nombreDeVariante(v), precio: v.precio ?? "", precio_cashea: v.precio_cashea ?? "", precio_local: v.precio_local ?? "", foto: v.foto || "", codigo_fabricante: v.codigo_fabricante || "", al_bot: !v.oculta })
      );
      const marcas = [
        opciones.botLeeInventario && v.oculta ? `<span class="chip aviso">${icono("ojo", { clase: "chico" })}El bot no la ofrece</span>` : "",
      ].join("");
      const sinContar = !v.contada && !aqui;
      return `<div class="variante"><button type="button" class="variante-nombre" popovertarget="editar-variante" data-variante="${datosEditar}" title="Editar precio, foto y código"><b>${esc(nombreDeVariante(v))}${icono("editar", { clase: "chico" })}</b>${sub ? `<small>${esc(sub)}</small>` : ""}${marcas ? `<span class="variante-marcas">${marcas}</span>` : ""}</button>
<a class="codigo-mini" href="/panel/inventario/etiquetas?variante=${v.id}" title="Imprimir etiquetas de ${esc(v.codigo_barras)}">${svgEan13(v.codigo_barras, { alto: 30 })}</a>
<div class="variante-cantidad"><b class="${sinContar ? "" : aqui <= 0 ? "cero" : aqui <= 2 ? "poco" : ""}">${sinContar ? "—" : aqui}</b><small>${sinContar ? "sin contar" : aqui === 1 ? "queda" : "quedan"}</small></div>
<button type="button" class="variante-mover" popovertarget="mover" data-mover="${datosMover}">${icono("movimientos")}Mover</button></div>`;
    })
    .join("");

  const ayudas = {
    entrada: "Suma al stock de esta sede. Úsalo cuando llega mercancía.",
    venta: "El cliente se lo llevó: baja el stock y queda como venta en Ventas e Inicio.",
    devolucion: "Vuelve al stock. Si fue una venta de la caja, mejor anúlala desde Ventas: así no cuenta como vendida.",
    ajuste: "Escribe cuántas contaste: el stock queda exacto y la diferencia se guarda en el historial.",
  };
  const formMover = `<form method="post" action="/panel/inventario/mover" data-quien id="mover-form">
<input type="hidden" name="variante" value=""><input type="hidden" name="sede" value="${sedeElegida}"><input type="hidden" name="volver" value="${esc(volver)}">
<div class="opciones mover-tipos">${Object.entries(TEXTO_DE_MOVIMIENTO)
    .map(([tipo, texto], i) => `<label class="opcion"><input type="radio" name="tipo" value="${tipo}"${i ? "" : " checked"} data-ayuda="${esc(ayudas[tipo])}">${icono(ICONO_DE_MOVIMIENTO[tipo][0])}${esc(texto)}</label>`)
    .join("")}</div>
<p class="mover-ayuda" id="mover-ayuda">${esc(ayudas.entrada)}</p>
<label class="campo"><span id="mover-cuantas">Cuántas</span><div class="paso-cantidad"><button type="button" data-paso="-1" aria-label="Una menos">${icono("menos")}</button><input name="cantidad" type="number" inputmode="numeric" min="0" max="100000" value="1" required><button type="button" data-paso="1" aria-label="Una más">${icono("mas")}</button></div></label>
<label class="campo solo-venta">Cómo pagó<select name="metodo"><option value="">Sin especificar</option>${METODOS_DE_PAGO.map((m) => `<option>${esc(m)}</option>`).join("")}</select>${opciones.tarifaDeCaja === "cashea" ? "<small>Con divisas en efectivo se cobra el precio en dólares; con lo demás, el precio Cashea.</small>" : ""}</label>
<div class="campos"><label class="campo">Nota (opcional)<input name="nota" maxlength="200" placeholder="Factura, proveedor, cliente…"></label><label class="campo">Quién<input name="quien" maxlength="60" placeholder="Tu nombre" autocomplete="name"></label></div>
<div class="acciones">${botonCerrarVentana("mover")}<button class="principal">${icono("check")}Guardar</button></div></form>`;

  const formEditar = `<form method="post" action="/panel/inventario/editar"><input type="hidden" name="producto" value="${p.id}">
<div class="campos"><label class="campo ancho">Nombre<input name="titulo" value="${esc(p.titulo)}" required maxlength="300"></label>
<label class="campo">Marca<input name="marca" value="${esc(p.marca)}" maxlength="80"></label>
<label class="campo">${esc(r.gama)}<input name="gama" value="${esc(p.gama)}" placeholder="${esc(r.ejemploGama)}" maxlength="20"></label>
<label class="campo">Precio (divisas)<input name="precio" value="${esc(p.precio ?? "")}" inputmode="decimal"></label>
<label class="campo">Precio Cashea<input name="precio_cashea" value="${esc(p.precio_cashea ?? "")}" inputmode="decimal"></label>
<label class="campo">Precio en Bs<input name="precio_local" value="${esc(p.precio_local ?? "")}" inputmode="decimal"></label>
<label class="campo">Te costó<input name="costo" value="${esc(p.costo ?? "")}" inputmode="decimal" placeholder="Para saber cuánto ganas"></label></div>
<div class="acciones">${botonCerrarVentana("editar")}<button class="principal">${icono("check")}Guardar cambios</button></div></form>
<form method="post" action="/panel/inventario/archivar" data-confirmar="¿Quitar «${esc(p.titulo)}» del inventario? Su historial y sus ventas se guardan, y volver a traer el catálogo no lo revive." data-confirmar-boton="Quitar" data-peligro style="margin-top:4px"><input type="hidden" name="producto" value="${p.id}"><button class="fantasma peligro chico">${icono("archivar")}Quitar del inventario</button></form>`;

  const delModelo = (n) => (n === null || n === undefined ? "" : `El del modelo: ${plata(n, { siempre: true })}`);
  const formVariante = `<form method="post" action="/panel/inventario/variante/editar" id="variante-form"><input type="hidden" name="producto" value="${p.id}"><input type="hidden" name="variante" value="">
<div class="campos"><label class="campo">Precio (divisas)<input name="precio" inputmode="decimal" placeholder="${esc(delModelo(p.precio))}"></label>
<label class="campo">Precio Cashea<input name="precio_cashea" inputmode="decimal" placeholder="Opcional"></label>
<label class="campo">Precio en Bs<input name="precio_local" inputmode="decimal" placeholder="Opcional"></label>
<label class="campo">Código de fábrica<input name="codigo_fabricante" maxlength="40" placeholder="El que trae la caja"></label>
<label class="campo ancho">Foto<input name="foto" inputmode="url" maxlength="500" placeholder="https://… (vacío: la del modelo)"></label></div>
${opciones.botLeeInventario ? `<input type="hidden" name="con_bot" value="1"><label class="interruptor" style="margin:4px 0 14px"><input type="checkbox" name="al_bot" value="si">El bot la ofrece a los clientes</label>` : ""}
<p class="suave" style="font-size:13px;margin:0 0 12px">Sin precio, usa los del modelo (también su Cashea y sus Bs).${opciones.botLeeInventario ? " El bot nunca ofrece lo que está en 0." : ""}</p>
<div class="acciones">${botonCerrarVentana("editar-variante")}<button class="principal">${icono("check")}Guardar</button></div></form>`;

  const movimientos = await movimientosRecientes(env.DB, { productoId: p.id, limite: 15 });

  return `${ESTILO}${tostadaDesde(url)}${cabecera({
    volver: volverAlInventario,
    sobre: [p.marca, p.gama].filter(Boolean).join(" · ") || "Producto",
    titulo: p.titulo,
    acciones: `<a class="boton suave" href="/panel/inventario/etiquetas?producto=${p.id}">${icono("etiqueta")}Etiquetas</a><button type="button" class="boton suave" popovertarget="editar">${icono("editar")}Editar</button>`,
  })}
<div class="ficha-producto">
<div>${galeria}${datos}</div>
<div>
<section class="panel-tarjeta"><div class="stock-cima"><h2>${insignia("inventario", "marca", "chica")}Stock${listaDeSedes.length > 1 ? "" : ` <span class="chip">${esc(numero(enSede))} en total</span>`}</h2>${sedesSegmento}</div>
${p.variantes.length ? `<div class="variantes">${filas}</div>` : vacio({ icono: "etiqueta", titulo: `Todavía no tiene ${r.variantes}`, texto: "Añádelas abajo: cada una recibe su código de barras sola." })}
${listaDeSedes.length > 1 ? `<p class="suave" style="margin:12px 2px 0;font-size:13px">Mostrando ${esc(nombreSede)}: ${esc(numero(enSede))} ${enSede === 1 ? "unidad" : "unidades"}. Entre todas las sedes quedan ${esc(numero(total))}.</p>` : ""}
</section>
<section class="panel-tarjeta" style="margin-top:18px"><h2>${insignia("mas", "marca", "chica")}Añadir ${esc(r.variantes)}</h2>
<form method="post" action="/panel/inventario/variante" class="campos"><input type="hidden" name="producto" value="${p.id}">
<label class="campo">${esc(mayuscula(r.variantes))}<input name="opciones" placeholder="${esc(r.ejemploVariantes)}"></label>
<label class="campo">Color (opcional)<input name="color" maxlength="40"></label>
<label class="campo">Código de fábrica (opcional)<input name="codigo_fabricante" placeholder="El que trae la caja" maxlength="40"></label>
<div class="campo ancho"><button class="principal">${icono("mas")}Añadir</button><small>Cada ${esc(r.variante)} nueva recibe su código de barras. Sin ${esc(r.variantes)}, deja la primera casilla vacía y queda una sola.</small></div></form></section>
</div></div>
<div class="seccion"><h2>${insignia("movimientos", "neutro", "chica")}Lo que se movió</h2><a href="/panel/inventario/movimientos">Todo el inventario${icono("adelante", { clase: "chico" })}</a></div>
${listaDeMovimientos(movimientos, { conModelo: false })}
${ventana("mover", { titulo: "Mover stock", texto: `<span id="mover-texto">En ${esc(nombreSede)}</span>`, icono: "movimientos", cuerpo: formMover })}
${ventana("editar", { titulo: "Editar producto", icono: "editar", cuerpo: formEditar }).replace('class="ventana"', 'class="ventana ventana-ancha"')}
${ventana("editar-variante", { titulo: `Editar ${r.laVariante}`, icono: "etiqueta", cuerpo: formVariante }).replace('class="ventana"', 'class="ventana ventana-ancha"')}
<script>
(function(){
var grande=document.getElementById("foto-grande");
document.querySelectorAll("[data-foto]").forEach(function(b){b.addEventListener("click",function(){var img=grande.querySelector("img");if(!img)return;img.style.opacity=0;setTimeout(function(){img.src=b.getAttribute("data-foto");img.style.opacity=1},160);document.querySelectorAll("[data-foto]").forEach(function(o){o.classList.toggle("activa",o===b)})})});
var fv=document.getElementById("variante-form");
document.addEventListener("click",function(e){var b=e.target.closest("[data-variante]");if(!b||!fv)return;var d={};try{d=JSON.parse(b.getAttribute("data-variante"))}catch(x){}
 ["variante","precio","precio_cashea","precio_local","foto","codigo_fabricante"].forEach(function(k){var i=fv.querySelector('[name="'+k+'"]');if(i)i.value=k==="variante"?d.id:(d[k]===null||d[k]===undefined?"":d[k])});
 var ab=fv.querySelector('[name="al_bot"]');if(ab)ab.checked=!!d.al_bot;
 document.querySelector("#editar-variante h3").textContent=d.nombre&&d.nombre!=="Única"?"Editar "+d.nombre:"Editar";});
var f=document.getElementById("mover-form");if(!f)return;
var cantidad=f.querySelector('[name="cantidad"]'),hay=0,laVariante=${JSON.stringify(r.laVariante)},nombreSede=${JSON.stringify(nombreSede).replace(/</g, "\\u003c")};
function tipo(){var r=f.querySelector('[name="tipo"]:checked');return r?r.value:"entrada"}
function poner(){var t=tipo(),r=f.querySelector('[name="tipo"]:checked');document.getElementById("mover-ayuda").textContent=r?r.getAttribute("data-ayuda"):"";document.getElementById("mover-cuantas").textContent=t==="ajuste"?"Cuántas contaste":t==="venta"?"Cuántas se llevó":"Cuántas";cantidad.min=t==="ajuste"?"0":"1";if(t==="ajuste"&&cantidad.dataset.tocada!=="1")cantidad.value=hay;if(t!=="ajuste"&&cantidad.dataset.tocada!=="1")cantidad.value=1}
f.addEventListener("change",function(e){if(e.target.name==="tipo")poner()});
cantidad.addEventListener("input",function(){cantidad.dataset.tocada="1"});
f.addEventListener("click",function(e){var b=e.target.closest("[data-paso]");if(!b)return;var v=(parseInt(cantidad.value,10)||0)+Number(b.getAttribute("data-paso"));cantidad.value=Math.max(Number(cantidad.min)||0,v);cantidad.dataset.tocada="1"});
document.addEventListener("click",function(e){var b=e.target.closest("[data-mover]");if(!b)return;var d={};try{d=JSON.parse(b.getAttribute("data-mover"))}catch(x){}
 hay=Number(d.hay)||0;f.querySelector('[name="variante"]').value=d.id;cantidad.dataset.tocada="";
 document.querySelector("#mover h3").textContent=d.nombre&&d.nombre!=="Única"?"Mover "+(/\\d/.test(d.nombre)&&laVariante!=="la variante"?laVariante+" ":"")+d.nombre:"Mover stock";
 document.getElementById("mover-texto").textContent="Quedan "+hay+" en "+nombreSede+".";poner()});
})();
</script>`;
}

async function paginaDeNuevo(env, url, r) {
  const listaDeSedes = await sedes(env.DB);
  return `${ESTILO}${tostadaDesde(url)}${cabecera({ volver: volverAlInventario, sobre: "Inventario", titulo: "Nuevo producto", texto: `Lo básico basta: el nombre. Cada ${r.variante} recibe su código de barras sola, y si dices cuántas hay, quedan cargadas.` })}
<div class="dos">
<section class="panel-tarjeta"><form method="post" action="/panel/inventario/nuevo" data-quien>
<div class="campos">
<label class="campo ancho">Nombre<input name="titulo" required maxlength="300" placeholder="${esc(r.ejemploProducto)}" autofocus></label>
<label class="campo">Marca<input name="marca" maxlength="80"></label>
<label class="campo">${esc(r.gama)}<input name="gama" maxlength="20" placeholder="${esc(r.ejemploGama)}"></label>
<label class="campo">${esc(mayuscula(r.variantes))}<input name="opciones" placeholder="${esc(r.ejemploVariantes)}, o vacío"></label>
<label class="campo">Color (opcional)<input name="color" maxlength="40"></label>
<label class="campo">Precio (divisas)<div class="monto chico"><span>$</span><input name="precio" inputmode="decimal" placeholder="0"></div></label>
<label class="campo">Te costó<div class="monto chico"><span>$</span><input name="costo" inputmode="decimal" placeholder="0"></div></label>
<label class="campo">Precio Cashea (opcional)<input name="precio_cashea" inputmode="decimal"></label>
<label class="campo">Código de fábrica (opcional)<input name="codigo_fabricante" maxlength="40" placeholder="El que trae la caja"></label>
<label class="campo">Cuántas hay de cada una<input name="cantidad" type="number" inputmode="numeric" min="0" max="100000" placeholder="0"></label>
${selectorDeSede(listaDeSedes, listaDeSedes[0]?.id)}
</div>
<div class="formulario-pie"><span class="suave" style="font-size:13px">Lo que no sepas ahora lo pones después en Editar.</span><button class="principal">${icono("check")}Crear producto</button></div>
</form></section>
<section class="panel-tarjeta ia-tarjeta"><h2>${insignia("etiqueta", "ia", "chica")}Así funcionan los códigos</h2>
<div class="consejos">
<div class="consejo">${insignia("escanear", "marca")}<span>Cada ${esc(r.variante)} recibe un código EAN-13 que empieza por 2. Lo lee cualquier lector y la cámara del teléfono.</span></div>
<div class="consejo">${insignia("etiqueta", "marca")}<span>Imprime las etiquetas en hoja carta o en impresora de rollo (50 × 25 mm) desde el producto.</span></div>
<div class="consejo">${insignia("enlace", "marca")}<span>Si la caja ya trae un código de fábrica, escríbelo: también pasa en la caja.</span></div>
</div></section>
</div>`;
}

async function paginaDeImportar(env, url, opciones = {}) {
  const { traerCatalogo, nombreDelCatalogo } = opciones;
  const listaDeSedes = await sedes(env.DB);
  const fuente = opciones.botLeeInventario ? ((await leerAjuste(env.DB, "catalogo_del_bot")) === "inventario" ? "inventario" : "hoja") : "";
  const nombreCorto = String(nombreDelCatalogo || "la hoja").split(" (")[0];
  const tarjetaDelBot = fuente
    ? `<section class="panel-tarjeta fuente-del-bot"><h2>${insignia("chats", "marca", "chica")}Lo que ofrece el bot</h2>
<p>${fuente === "inventario" ? `Lo del <b>inventario</b>: lo que tiene stock, con los precios y las fotos de aquí. ${esc(mayuscula(nombreCorto))} ya no se lee.` : `Todavía lee ${esc(nombreCorto)}. Al traer el catálogo aquí abajo, pasa a ofrecer lo del inventario.`}</p>
<form method="post" action="/panel/inventario/fuente-del-bot" class="opciones">
<button name="fuente" value="inventario" class="${fuente === "inventario" ? "principal" : "suave"}"${fuente === "inventario" ? ' aria-pressed="true"' : ""}>${icono("inventario")}El inventario</button>
<button name="fuente" value="hoja" class="${fuente === "hoja" ? "principal" : "suave"}"${fuente === "hoja" ? ' aria-pressed="true"' : ""}>${icono("lista")}${esc(mayuscula(nombreCorto))}</button></form></section>`
    : "";
  const columnas = ["código", "producto", rubroDe(opciones.rubro).variante, "color", "cantidad", "precio", "costo", "marca", "sede"];
  return `${ESTILO}${tostadaDesde(url)}${cabecera({ volver: volverAlInventario, sobre: "Inventario", titulo: "Importar", texto: "Pasa al inventario lo que ya tienes: el catálogo de la tienda o el Excel del sistema viejo. Volver a importar no duplica nada." })}
<div class="pasos-importar">
${tarjetaDelBot}${
  traerCatalogo
    ? `<section class="panel-tarjeta"><h2>${insignia("enlace", "marca", "chica")}Traer del catálogo</h2>
<p>Lee ${esc(nombreDelCatalogo || "el catálogo de la tienda")} y crea los productos que falten. Los que ya están se ponen al día (nombre, precio, fotos) sin tocar su stock.</p>
<form method="post" action="/panel/inventario/importar/catalogo" data-quien><div class="campos">${selectorDeSede(listaDeSedes, listaDeSedes[0]?.id)}</div>
<div class="formulario-pie"><span class="suave" style="font-size:13px">Si trae cantidades, se cargan solo la primera vez.</span><button class="principal">${icono("bajar")}Traer ahora</button></div></form></section>`
    : ""
}
<section class="panel-tarjeta"><h2>${insignia("subir", "marca", "chica")}Subir un Excel</h2>
<p>En Excel: <b>Archivo › Guardar como › CSV</b>. Se reconocen estas columnas, en cualquier orden:</p>
<div class="encabezados">${columnas.map((c) => `<span class="chip marca">${esc(c)}</span>`).join("")}</div>
<form method="post" action="/panel/inventario/importar/csv" enctype="multipart/form-data" data-quien>
<label class="archivo" id="archivo">${icono("subir")}<b id="archivo-nombre">Toca para elegir el archivo</b><span>o arrástralo aquí · CSV de hasta 2 MB</span><input type="file" name="archivo" accept=".csv,text/csv,.txt" required></label>
<div class="campos" style="margin-top:14px">${selectorDeSede(listaDeSedes, listaDeSedes[0]?.id)}</div>
<div class="formulario-pie"><label class="interruptor"><input type="checkbox" name="probar" value="si" checked>Solo probar, sin guardar</label><button class="principal">${icono("subir")}Subir</button></div>
</form>
<p style="font-size:13px;margin:16px 0 0">La cantidad de cada fila es la que se contó: queda tal cual y la diferencia se guarda como movimiento. Un código de barras viejo se guarda como «de fábrica» y sigue pasando en la caja.</p></section>
</div>
<script>
(function(){var c=document.getElementById("archivo");if(!c)return;var i=c.querySelector("input"),n=document.getElementById("archivo-nombre");
i.addEventListener("change",function(){var f=i.files&&i.files[0];c.classList.toggle("listo",!!f);n.textContent=f?f.name:"Toca para elegir el archivo"});
["dragenter","dragover"].forEach(function(t){c.addEventListener(t,function(){c.classList.add("encima")})});["dragleave","drop"].forEach(function(t){c.addEventListener(t,function(){c.classList.remove("encima")})});})();
</script>`;
}

function informeDeImportacion(titulo, cifras, errores = [], { probando = false, r = rubroDe(""), extra = "" } = {}) {
  const datos = cifras
    .filter(([, , valor, siempre]) => siempre || Number(valor))
    .map(([nombre, ico, valor, , pie]) => dato({ nombre, valor: cifra(valor, { tipo: "numero" }), icono: ico, pie: pie || "" }))
    .join("");
  return `${ESTILO}${cabecera({ volver: { href: "/panel/inventario/importar", texto: "Importar" }, sobre: "Importar", titulo })}
${
  probando
    ? `<div class="aviso-grande aviso">${insignia("ojo", "aviso")}<div><b>Fue una prueba: no se guardó nada</b><p>Si los números se ven bien, vuelve y desmarca «Solo probar».</p><div class="acciones"><a class="boton principal" href="/panel/inventario/importar">${icono("atras")}Volver a subirlo</a></div></div></div>`
    : `<div class="aviso-grande bien">${insignia("check", "bien")}<div><b>Listo, ya está en el inventario</b><p>Cada ${esc(r.variante)} nueva ya tiene su código de barras.</p><div class="acciones"><a class="boton principal" href="/panel/inventario">${icono("inventario")}Ver el inventario</a></div></div></div>`
}
${extra}<div class="mosaico">${datos}</div>
${errores?.length ? `<section class="panel-tarjeta" style="margin-top:18px"><h2>${insignia("alerta", "aviso", "chica")}Filas con problemas <span class="chip aviso">${errores.length}</span></h2><ul class="lista-errores">${errores.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></section>` : ""}`;
}

async function paginaDeSedes(env, url) {
  const lista = await sedesConStock(env.DB);
  return `${ESTILO}${tostadaDesde(url)}${cabecera({ volver: volverAlInventario, sobre: "Inventario", titulo: "Sedes", texto: "Cada venta y cada movimiento dice en qué sede pasó. El bot suma todas las sedes para saber si hay." })}
<div class="dos">
<div class="filas">${lista
    .map(
      (s) => `<div class="fila">${insignia("sede", "marca")}<div class="fila-centro"><div class="fila-titulo">${esc(s.nombre)}</div><div class="fila-sub">${s.modelos} ${s.modelos === 1 ? "producto" : "productos"} con stock</div></div><div class="fila-fin"><b class="sede-uni">${esc(numero(s.unidades))}</b><small>${s.unidades === 1 ? "unidad" : "unidades"}</small></div></div>`
    )
    .join("")}</div>
<section class="panel-tarjeta"><h2>${insignia("mas", "marca", "chica")}Añadir una sede</h2>
<form method="post" action="/panel/inventario/sedes" class="campos"><label class="campo ancho">Nombre<input name="nombre" required maxlength="60" placeholder="Sambil, Centro, Depósito…"></label><div class="campo ancho"><button class="principal">${icono("mas")}Añadir sede</button></div></form></section>
</div>`;
}

async function paginaDeMovimientos(env, url) {
  const lista = await movimientosRecientes(env.DB, { limite: 300 });
  const desde = new Date(new Date(Date.now() + DESFASE_MS).toISOString().slice(0, 10)).getTime() - DESFASE_MS;
  const ventas = (await ventasDelDia(env.DB, desde)).filter((v) => !v.anulada);
  const total = ventas.reduce((a, v) => a + (Number(v.total) || 0), 0);
  const unidades = ventas.reduce((a, v) => a + (Number(v.unidades) || 0), 0);
  return `${ESTILO}${tostadaDesde(url)}${cabecera({
    volver: volverAlInventario,
    sobre: "Inventario",
    titulo: "Movimientos",
    texto: "Todo lo que entró y salió, quién lo hizo y cuántos quedaron. No se puede borrar: es el historial de la tienda.",
    acciones: `<a class="boton suave" href="/panel/inventario.csv">${icono("bajar")}Excel del stock</a>`,
  })}
<div class="mosaico">
${dato({ nombre: "Ventas de hoy", valor: cifra(ventas.length, { tipo: "numero" }), icono: "ventas", href: "/panel/ventas?p=hoy" })}
${dato({ nombre: "Unidades que salieron", valor: cifra(unidades, { tipo: "numero" }), icono: "inventario" })}
${dato({ nombre: "Cobrado hoy", valor: cifra(total), icono: "efectivo", tono: "bien" })}
</div>
${listaDeMovimientos(lista)}`;
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
    const codigo = String(url.searchParams.get("codigo") || "").trim();
    if (codigo) {
      const v = await buscarPorCodigo(env.DB, codigo);
      if (v) return { redirigir: `/panel/inventario/etiquetas?variante=${v.id}` };
    }
    return `${ESTILO}${codigo ? tostadaDesde(new URL(`https://x/?error=${encodeURIComponent(`No encuentro el código ${codigo}.`)}`)) : ""}${cabecera({ volver: volverAlInventario, sobre: "Inventario", titulo: "Etiquetas", texto: "Abre un producto y toca su código de barras, o «Etiquetas» para todo el modelo. También puedes escanear uno aquí." })}
${vacio({
  icono: "etiqueta",
  titulo: "¿De qué producto?",
  texto: "Escanea el código con el lector o escríbelo.",
  acciones: `<form method="get" action="/panel/inventario/etiquetas" class="herramientas" style="margin:0;justify-content:center"><label class="buscador" style="min-width:min(320px,80vw)">${icono("escanear")}<input name="codigo" value="${esc(codigo)}" autofocus autocomplete="off" placeholder="Código de barras"></label><button class="principal">Buscar</button></form>`,
})}`;
  }
  const una = (v) =>
    `<div class="etq"><div class="etq-t">${esc(String(v.titulo).slice(0, 48))}</div><div class="etq-o">${esc(nombreDeVariante(v))}${conPrecio && v.precioFinal !== null && v.precioFinal !== undefined ? ` · <b>${esc(plata(v.precioFinal, { siempre: true }))}</b>` : ""}</div>${svgEan13(v.codigo_barras, { alto: 40 })}</div>`;
  const todas = variantes.flatMap((v) => Array.from({ length: copias }, () => una(v))).join("");
  const params = (cambio) => `/panel/inventario/etiquetas?${new URLSearchParams({ ...Object.fromEntries(url.searchParams), ...cambio })}`;
  const ico = (n) => iconoSuelto(n, { clase: "chico" });
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Etiquetas · ${esc(tienda)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&display=swap" rel="stylesheet">
<style>
body{font-family:Manrope,system-ui,sans-serif;margin:0;color:#0d1526;background:#eef2f9}
.barra{position:sticky;top:0;z-index:2;display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:14px 18px;background:rgba(255,255,255,.88);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);border-bottom:1px solid #dfe5f0}
.barra a,.barra button{display:inline-flex;align-items:center;gap:7px;min-height:40px;padding:0 15px;border:1px solid #d6deeb;border-radius:999px;background:#fff;color:#0d1526;text-decoration:none;font:700 13.5px Manrope,system-ui,sans-serif;cursor:pointer;transition:transform .4s cubic-bezier(.16,1,.3,1),border-color .2s}
.barra a:hover,.barra button:hover{border-color:#0a5cf5;transform:translateY(-1px)}
.barra a.activo{background:#0d1526;color:#fff;border-color:#0d1526}
.barra .imprimir{margin-left:auto;background:linear-gradient(135deg,#3d86ff,#0a5cf5);color:#fff;border-color:transparent;box-shadow:0 10px 24px -12px rgba(10,92,245,.9)}
.barra form{display:inline-flex;gap:6px;align-items:center;font-size:13.5px;font-weight:700}
.barra input{width:62px;min-height:38px;border:1px solid #d6deeb;border-radius:12px;padding:0 10px;font:700 14px Manrope,system-ui,sans-serif}
.ico{width:16px;height:16px;flex:none}
.papel{max-width:900px;margin:22px auto;padding:22px;background:#fff;border-radius:22px;box-shadow:0 30px 70px -40px rgba(13,30,70,.45)}
.termica .papel{display:flex;flex-wrap:wrap;gap:10px;justify-content:center}
.etq{box-sizing:border-box;overflow:hidden;text-align:center;page-break-inside:avoid;break-inside:avoid;color:#000;font-family:system-ui,sans-serif}
.etq svg{width:100%;height:auto;display:block}
.etq-t{font-size:10px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.etq-o{font-size:10px}
.hoja .etiquetas{display:grid;grid-template-columns:repeat(4,1fr);gap:4mm}
.hoja .etq{border:1px dashed #c4ccda;border-radius:6px;padding:2mm}
.termica .etq{width:50mm;height:25mm;padding:1mm 2mm;border:1px dashed #c4ccda;border-radius:6px;page-break-after:always;break-after:page}
.termica .etq svg{height:13mm;width:auto;margin:0 auto}
@media print{.barra{display:none}body{margin:0;background:#fff}.papel{margin:0;padding:0;box-shadow:none;border-radius:0;max-width:none}.hoja .etiquetas{gap:2mm}.etq{border-color:#ddd}.termica .etq{border:0}
${formato === "termica" ? "@page{size:50mm 25mm;margin:0}" : "@page{size:letter;margin:8mm}"}}
</style></head><body class="${formato}">
<div class="barra"><a href="/panel/inventario${productoId ? `/p/${productoId}` : ""}">${ico("atras")}Volver</a>
<a class="${formato === "hoja" ? "activo" : ""}" href="${esc(params({ formato: "hoja" }))}">Hoja carta</a>
<a class="${formato === "termica" ? "activo" : ""}" href="${esc(params({ formato: "termica" }))}">Rollo 50 × 25 mm</a>
<form method="get">${[...url.searchParams].filter(([k]) => k !== "n").map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("")}Copias <input type="number" name="n" value="${copias}" min="1" max="200" onchange="this.form.submit()"></form>
<a href="${esc(params({ precio: conPrecio ? "no" : "si" }))}">${conPrecio ? "Sin precio" : "Con precio"}</a>
<button class="imprimir" onclick="print()">${ico("imprimir")}Imprimir</button></div>
<div class="papel"><div class="etiquetas">${todas}</div></div></body></html>`;
}

/* ── La caja ─────────────────────────────────────────────────────────── */
//
// Un lector de códigos (USB, Bluetooth, láser, infrarrojo o de imagen)
// escribe el código y pulsa Enter, como un teclado: no hay que instalar
// nada. Sin lector, el botón de la cámara lee con el teléfono. Y lo que más
// se vende está abajo para tocarlo.

const METODOS_CORTOS = { "Divisas (efectivo)": "Divisas", "Bolívares (efectivo)": "Bolívares", "Punto de venta": "Punto" };

async function paginaDeCaja(env, url, opciones = {}) {
  const listaDeSedes = await sedes(env.DB);
  const productos = await listarProductos(env.DB, { soloConStock: true, orden: "ventas", limite: 60 });
  const tarifa = opciones.tarifaDeCaja === "cashea" ? "cashea" : "";
  const r = rubroDe(opciones.rubro);
  const iconos = { mas: icono("mas", { clase: "chico" }), menos: icono("menos", { clase: "chico" }), borrar: icono("borrar", { clase: "chico" }), escanear: icono("escanear"), alerta: icono("alerta"), check: icono("check"), cerrar: icono("cerrar", { clase: "chico" }) };
  const tiles = productos
    .map((p, n) => {
      const precio = p.precio_min ?? p.precio;
      const cashea = p.cashea_min ?? p.precio_cashea;
      const desde = (Number(p.precio_max) || 0) > (Number(p.precio_min) || 0) + 0.009 ? "1" : "";
      const total = Number(p.total) || 0;
      return `<button type="button" class="pos-producto" data-producto="${p.id}" data-buscar="${esc(`${p.titulo} ${p.marca || ""}`.toLowerCase())}" style="--n:${Math.min(n, 30)}"><span class="pos-foto">${fotoDe(p.foto, p.titulo)}<span class="pos-cuantos${total <= 2 ? " poco" : ""}" data-cuantos="${total}">${total}</span></span><span class="pos-info"><b>${esc(p.titulo)}</b><span class="precio" data-precio="${precio ?? ""}" data-cashea="${cashea ?? ""}" data-desde="${desde}">${precio !== null && precio !== undefined ? esc(`${desde ? "desde " : ""}${plata(precio, { siempre: true })}`) : "Sin precio"}</span></span></button>`;
    })
    .join("");
  const metodos = [...METODOS_DE_PAGO, "Fiado"]
    .map((m) => `<label class="opcion"><input type="radio" name="metodo" value="${esc(m)}">${icono(iconoDeMetodo(m))}${esc(METODOS_CORTOS[m] || m)}</label>`)
    .join("");
  return `${ESTILO}${tostadaDesde(url)}${cabecera({
    sobre: "Tu negocio",
    titulo: "Caja",
    texto: "Escanea con el lector o la cámara, o toca un producto. Al cobrar baja el stock de la sede.",
    acciones: `<a class="boton suave" href="/panel/ventas?p=hoy">${icono("ventas")}Ventas de hoy</a>`,
  })}
<div class="pos">
<section class="pos-izquierda">
<div class="pos-arriba">${
    listaDeSedes.length > 1
      ? `<label class="pos-campo">${icono("sede")}<select id="sede" aria-label="Sede">${opcionesDeSedes(listaDeSedes)}</select></label>`
      : `<input type="hidden" id="sede" value="${listaDeSedes[0]?.id || ""}">`
  }<label class="pos-campo">${icono("usuario")}<input name="quien" id="quien" maxlength="60" placeholder="Quién cobra" autocomplete="name" aria-label="Quién cobra"></label></div>
<div class="lector">${icono("escanear")}<input id="lector" autofocus autocomplete="off" inputmode="none" enterkeyhint="search" placeholder="Escanea o busca" aria-label="Código o nombre del producto"><div class="lector-botones"><button type="button" id="btn-teclado" title="Escribir con el teclado" aria-label="Escribir con el teclado">${icono("teclado")}</button><button type="button" id="btn-camara" title="Leer con la cámara" aria-label="Leer con la cámara">${icono("camara")}</button></div></div>
<div class="camara-marco" id="camara-marco"><video id="camara" playsinline muted></video><div class="camara-mira"></div></div>
<div class="resultados" id="resultados"></div>
<div class="seccion"><h2>${insignia("rayo", "marca", "chica")}Toca para vender</h2><button type="button" class="enlace-chico" id="btn-libre" style="margin:0">${icono("libre", { clase: "chico" })}Cobro sin inventario</button></div>
${
  productos.length
    ? `<div class="pos-productos" id="pos-productos">${tiles}<div class="pos-sin-coincidencias" id="sin-coincidencias" hidden>Nada con ese nombre aquí. Pulsa Enter para buscar en todo el inventario.</div></div>`
    : vacio({ icono: "inventario", titulo: "No hay productos con stock", texto: "Carga el inventario para vender tocando. El lector y la cámara buscan igual en todo lo que haya.", acciones: `<a class="boton suave" href="/panel/inventario">${icono("inventario")}Ir al inventario</a>` })
}
</section>
<aside class="pos-ticket panel-tarjeta" id="ticket">
<h2>${insignia("recibo", "marca", "chica")}Venta actual<span class="chip" id="cuenta">0</span><button type="button" class="fantasma chico vaciar" id="vaciar" hidden>${icono("borrar", { clase: "chico" })}Vaciar</button></h2>
<div class="ticket-lineas" id="lineas"></div>
<form class="libre-form" id="libre-form" hidden><label class="campo">Qué es<input id="libre-que" maxlength="120" placeholder="Servicio, envío, algo sin código…"></label><label class="campo">Cuánto<input id="libre-cuanto" inputmode="decimal" placeholder="$0"></label><div class="acciones"><button type="button" class="fantasma chico" id="libre-cancelar">Cancelar</button><button class="principal chico">${icono("mas", { clase: "chico" })}Añadir</button></div></form>
<div class="ticket-total"><span>Total<em class="tarifa-nota" id="tarifa-nota"></em></span><b id="total">$0</b></div>
<div class="campo-titulo">Cómo pagó</div>
<div class="metodos opciones" id="metodos">${metodos}</div>
<div class="fiado-datos" id="fiado-datos"><label class="campo">Cliente<input id="cliente" maxlength="80" placeholder="Nombre" autocomplete="off"></label><label class="campo">Teléfono<input id="telefono" maxlength="20" inputmode="tel" placeholder="0414…" autocomplete="off"></label></div>
${r.conSerial ? `<label class="campo" style="margin:0 0 12px">IMEI o serial (opcional)<input id="serial" maxlength="60" inputmode="numeric" autocomplete="off" placeholder="Para la garantía: sale en el recibo"></label>` : ""}
<button type="button" class="enlace-chico" id="btn-cliente">${icono("usuario", { clase: "chico" })}Añadir cliente al recibo</button>
<button type="button" class="principal boton-cobrar" id="cobrar" title="Cobrar (F9)">${icono("check")}<span>Cobrar</span><b id="total-boton"></b></button>
<p class="suave pos-nota">Al cobrar se descuenta el stock de la sede: es la confirmación de que el cliente se lo lleva. Si algo no alcanza, no se descuenta nada.</p>
</aside>
</div>
<div class="pos-flotante" id="pos-flotante" hidden><span><b id="flotante-total">$0</b><small id="flotante-cuenta"></small></span><a class="boton principal" href="#ticket">${icono("recibo")}Cobrar</a></div>
<div class="exito" id="exito" hidden><div class="exito-caja" role="dialog" aria-modal="true" aria-labelledby="exito-titulo">
<svg class="exito-check" viewBox="0 0 88 88" aria-hidden="true"><circle class="relleno" cx="44" cy="44" r="40"/><circle cx="44" cy="44" r="40"/><path d="M28 45l11 11 21-23"/></svg>
<h2 id="exito-titulo">Venta registrada</h2><div class="exito-total" id="exito-total"></div><p class="suave" id="exito-detalle"></p>
<div class="acciones"><button type="button" class="principal" id="exito-nueva">${icono("mas")}Nueva venta</button><a class="boton suave" id="exito-whatsapp" target="_blank" rel="noopener">${icono("enviar")}Mandar el recibo por WhatsApp</a><a class="boton fantasma" id="exito-recibo">${icono("recibo")}Ver el recibo</a></div>
</div></div>
<script>
(function(){
var TARIFA=${JSON.stringify(tarifa)},LA_VARIANTE=${JSON.stringify(r.laVariante)},DIVISAS=${JSON.stringify(DIVISAS)},I=${JSON.stringify(iconos).replace(/</g, "\\u003c")};
var lineas=[],libres=[],ocupado=false;
function $(s){return document.querySelector(s)}
// La ventana del éxito va directo en el body: dentro del contenido quedaría
// debajo de la barra lateral.
document.body.appendChild($("#exito"));
var lector=$("#lector"),cajaLineas=$("#lineas"),totalEl=$("#total"),resultados=$("#resultados"),tiles=$("#pos-productos");
function esc(t){return String(t==null?"":t).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function dinero(v){v=Number(v)||0;var e=Math.abs(v-Math.round(v))<.005;return(v<0?"\\u2212":"")+"$"+Math.abs(v).toLocaleString("es-VE",{minimumFractionDigits:e?0:2,maximumFractionDigits:e?0:2})}
function sede(){return $("#sede").value}
function metodo(){var r=document.querySelector('input[name="metodo"]:checked');return r?r.value:""}
function tarifa(){return TARIFA==="cashea"&&metodo()!==DIVISAS?"cashea":""}
function precioDe(l){return tarifa()==="cashea"&&l.precioCashea!=null?l.precioCashea:l.precio}
function pitido(ok){try{var a=new(window.AudioContext||window.webkitAudioContext)(),o=a.createOscillator(),g=a.createGain();o.type="sine";o.frequency.value=ok?1046:220;g.gain.setValueAtTime(.0001,a.currentTime);g.gain.exponentialRampToValueAtTime(.18,a.currentTime+.01);g.gain.exponentialRampToValueAtTime(.0001,a.currentTime+(ok?.12:.3));o.connect(g);g.connect(a.destination);o.start();o.stop(a.currentTime+(ok?.13:.32))}catch(e){}if(navigator.vibrate)try{navigator.vibrate(ok?30:[60,40,60])}catch(e){}}
function avisar(texto,tono){var c=document.createElement("div");c.className="tostadas";c.setAttribute("aria-live","polite");c.innerHTML='<div class="tostada tono-'+(tono||"mal")+'" role="status"><span class="insignia tono-'+(tono||"mal")+'">'+(tono==="bien"?I.check:I.alerta)+'</span><span>'+esc(texto)+'</span><button type="button" class="tostada-cerrar" aria-label="Cerrar" data-cerrar-tostada>'+I.cerrar+'</button></div>';document.querySelectorAll(".tostadas").forEach(function(v){v.remove()});document.body.appendChild(c);if(tono!=="bien")pitido(false);setTimeout(function(){var t=c.querySelector(".tostada");if(t)t.classList.add("cerrada");setTimeout(function(){c.remove()},500)},5200)}
function pintar(animar){
 var n=0,total=0,sinPrecio=false,html="";
 lineas.forEach(function(l,i){var hay=l.porSede[sede()]||0,p=precioDe(l);n+=l.cantidad;if(p==null)sinPrecio=true;else total+=p*l.cantidad;
  var falta=hay<l.cantidad;
  html+='<div class="ticket-linea'+(l.vista?" quieta":"")+(l.destello?" destello":"")+'"><div><b>'+esc(l.titulo)+'</b><small>'+esc(l.variante!=="Única"?l.variante+" · ":"")+(p!=null?dinero(p)+" c/u":"sin precio")+'</small></div><div class="importe">'+(p!=null?dinero(p*l.cantidad):"—")+'</div><div class="control"><span class="stock '+(falta?"cero":hay-l.cantidad<=2?"poco":"hay")+'"><i></i>'+(falta?"Solo hay "+hay:"Quedan "+(hay-l.cantidad))+'</span><span class="contador"><button type="button" data-menos="'+i+'" aria-label="Uno menos">'+(l.cantidad>1?I.menos:I.borrar)+'</button><span>'+l.cantidad+'</span><button type="button" data-mas="'+i+'" aria-label="Uno más">'+I.mas+'</button></span></div></div>';
  l.vista=true;l.destello=false});
 libres.forEach(function(l,i){n+=l.cantidad;total+=l.precio*l.cantidad;
  html+='<div class="ticket-linea'+(l.vista?" quieta":"")+'"><div><b>'+esc(l.descripcion)+'</b><small>'+dinero(l.precio)+' c/u<span class="chip">sin inventario</span></small></div><div class="importe">'+dinero(l.precio*l.cantidad)+'</div><div class="control"><span></span><span class="contador"><button type="button" data-menos-libre="'+i+'" aria-label="Uno menos">'+(l.cantidad>1?I.menos:I.borrar)+'</button><span>'+l.cantidad+'</span><button type="button" data-mas-libre="'+i+'" aria-label="Uno más">'+I.mas+'</button></span></div></div>';
  l.vista=true});
 cajaLineas.innerHTML=html||'<div class="ticket-vacio">'+I.escanear+'Escanea o toca un producto para empezar.</div>';
 var texto=dinero(total)+(sinPrecio?" +":"");
 totalEl.textContent=texto;$("#total-boton").textContent=n?texto:"";
 if(animar){totalEl.classList.remove("salta");void totalEl.offsetWidth;totalEl.classList.add("salta")}
 $("#cuenta").textContent=n;$("#vaciar").hidden=!n;
 var flo=$("#pos-flotante");flo.hidden=!n;$("#flotante-total").textContent=texto;$("#flotante-cuenta").textContent=n+(n===1?" producto":" productos");
 var nota=$("#tarifa-nota");if(TARIFA==="cashea"){var c=tarifa()==="cashea";nota.textContent=c?"Precio Cashea":"Precio en divisas";nota.classList.toggle("divisas",!c)}
 if(tiles)tiles.querySelectorAll(".precio").forEach(function(s){var p=s.getAttribute("data-precio"),c=s.getAttribute("data-cashea"),v=tarifa()==="cashea"&&c!==""?c:p;s.textContent=v===""?"Sin precio":(s.getAttribute("data-desde")?"desde ":"")+dinero(v)});
}
function agregar(v){
 var ya=null;lineas.forEach(function(l){if(l.id===v.id)ya=l});
 var hay=(v.porSede||{})[sede()]||0,lleva=ya?ya.cantidad:0;
 if(hay<=lleva){avisar(hay?"En esta sede solo hay "+hay+" de "+v.titulo+(v.variante!=="Única"?" ("+v.variante+")":"")+". Si llegó más, súmalo en Inventario.":v.titulo+(v.variante!=="Única"?" ("+v.variante+")":"")+" está agotado en esta sede.","mal");return}
 if(ya){ya.cantidad++;ya.porSede=v.porSede;ya.destello=true}else lineas.push({id:v.id,producto:v.producto,titulo:v.titulo,variante:v.variante,precio:v.precio,precioCashea:v.precioCashea,cantidad:1,porSede:v.porSede});
 resultados.innerHTML="";pintar(true);pitido(true);
}
function elegir(d,titulo){
 // Todas del mismo producto: solo las tallas, en botones pequeños.
 var uno=d.opciones.every(function(o){return o.titulo===d.opciones[0].titulo});
 resultados.classList.toggle("tallas",uno);
 resultados.innerHTML='<p class="resultados-titulo">'+esc(uno?"Elige "+LA_VARIANTE+" de "+d.opciones[0].titulo:titulo||"Elige cuál")+'</p>'+d.opciones.map(function(o,i){var hay=o.porSede[sede()]||0,p=tarifa()==="cashea"&&o.precioCashea!=null?o.precioCashea:o.precio;return '<button type="button" class="resultado" data-op="'+i+'"'+(hay?"":" disabled")+'><b>'+esc(uno?o.variante:o.titulo)+'</b><small>'+esc(uno?"":o.variante+" · ")+(p!=null?dinero(p):"sin precio")+'</small><span class="stock '+(hay?hay<=2?"poco":"hay":"cero")+'"><i></i>'+(hay?(uno?hay:"Hay "+hay):"Agotado")+'</span></button>'}).join("");
 resultados.onclick=function(e){var b=e.target.closest("[data-op]");if(b)agregar(d.opciones[Number(b.getAttribute("data-op"))])};
 resultados.scrollIntoView({behavior:"smooth",block:"nearest"});
}
function buscar(q,titulo){
 return fetch("/panel/caja/buscar?"+q,{credentials:"same-origin",headers:{accept:"application/json"}}).then(function(r){return r.json()}).then(function(d){
  if(d.variante){agregar(d.variante);return true}
  if(d.opciones&&d.opciones.length){elegir(d,titulo);pitido(true);return true}
  return false}).catch(function(){avisar("No pude buscar. ¿Hay internet?","mal");return true});
}
function leer(texto){texto=String(texto||"").trim();if(!texto)return;filtrar("");buscar("q="+encodeURIComponent(texto)).then(function(ok){if(!ok)avisar("No encuentro «"+texto+"» en el inventario.","mal")})}
function normal(t){return String(t||"").toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g,"")}
function filtrar(t){if(!tiles)return;t=normal(t).trim();var alguno=false;tiles.querySelectorAll(".pos-producto").forEach(function(b){var si=!t||normal(b.getAttribute("data-buscar")).indexOf(t)>=0;b.hidden=!si;if(si)alguno=true});var s=$("#sin-coincidencias");if(s)s.hidden=alguno||!t}
lector.addEventListener("keydown",function(e){if(e.key==="Enter"){e.preventDefault();var t=lector.value;lector.value="";leer(t)}});
lector.addEventListener("input",function(){filtrar(lector.value)});
$("#btn-teclado").onclick=function(){lector.setAttribute("inputmode","text");this.classList.add("encendida");lector.blur();setTimeout(function(){lector.focus()},30)};
if(tiles)tiles.addEventListener("click",function(e){var b=e.target.closest("[data-producto]");if(!b)return;b.classList.remove("tocado");void b.offsetWidth;b.classList.add("tocado");buscar("producto="+b.getAttribute("data-producto"),"Elige "+LA_VARIANTE+" de "+(b.querySelector("b")||{}).textContent).then(function(ok){if(!ok)avisar("Ese producto ya no tiene variantes.","mal")})});
cajaLineas.addEventListener("click",function(e){var b=e.target.closest("button");if(!b)return;var i;
 if((i=b.getAttribute("data-mas"))!=null){var l=lineas[i];if((l.porSede[sede()]||0)<=l.cantidad)return avisar("En esta sede solo hay "+(l.porSede[sede()]||0)+".","mal");l.cantidad++}
 else if((i=b.getAttribute("data-menos"))!=null){if(--lineas[i].cantidad<1)lineas.splice(i,1)}
 else if((i=b.getAttribute("data-mas-libre"))!=null)libres[i].cantidad++;
 else if((i=b.getAttribute("data-menos-libre"))!=null){if(--libres[i].cantidad<1)libres.splice(i,1)}
 pintar(true)});
$("#vaciar").onclick=function(){lineas=[];libres=[];pintar(true);lector.focus()};
var sedeSel=$("#sede");if(sedeSel.tagName==="SELECT")sedeSel.onchange=function(){pintar()};
var metodosEl=$("#metodos"),fiadoDatos=$("#fiado-datos"),conCliente=false;
function verCliente(){var f=metodo()==="Fiado";fiadoDatos.classList.toggle("visible",f||conCliente);$("#btn-cliente").hidden=f||conCliente}
metodosEl.addEventListener("change",function(){verCliente();pintar(true);if(metodo()==="Fiado")setTimeout(function(){$("#cliente").focus()},250)});
$("#btn-cliente").onclick=function(){conCliente=true;verCliente();setTimeout(function(){$("#cliente").focus()},250)};
var libreForm=$("#libre-form");
$("#btn-libre").onclick=function(){libreForm.hidden=false;$("#ticket").scrollIntoView({behavior:"smooth",block:"nearest"});setTimeout(function(){$("#libre-que").focus()},200)};
$("#libre-cancelar").onclick=function(){libreForm.hidden=true;lector.focus()};
libreForm.addEventListener("submit",function(e){e.preventDefault();var q=$("#libre-que").value.trim(),c=parseFloat(String($("#libre-cuanto").value).replace(/[^0-9,.-]/g,"").replace(/\\.(?=.*[.,])/g,"").replace(",","."));
 if(!q)return avisar("Escribe qué es.","mal");if(!(c>=0))return avisar("Escribe cuánto cuesta.","mal");
 libres.push({descripcion:q,precio:Math.round(c*100)/100,cantidad:1});$("#libre-que").value="";$("#libre-cuanto").value="";libreForm.hidden=true;pintar(true);pitido(true)});
function sacudir(el){el.classList.remove("sacude");void el.offsetWidth;el.classList.add("sacude")}
function cobrarYa(){
 if(ocupado)return;
 if(!lineas.length&&!libres.length)return avisar("La venta está vacía.","mal");
 var m=metodo();if(!m){sacudir(metodosEl);return avisar("Elige cómo pagó el cliente.","mal")}
 var fiado=m==="Fiado",cliente=$("#cliente").value.trim(),telefono=$("#telefono").value.trim();
 if(fiado&&!cliente){sacudir(fiadoDatos);$("#cliente").focus();return avisar("Para fiar hace falta el nombre del cliente.","mal")}
 var b=$("#cobrar");ocupado=true;b.classList.add("cargando");
 fetch("/panel/caja/cobrar",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify({sede:sede(),quien:($("#quien")||{}).value||"",nota:$("#serial")&&$("#serial").value.trim()?"IMEI/serial: "+$("#serial").value.trim():"",metodo:fiado?"":m,fiado:fiado,cliente:cliente,telefono:telefono,items:lineas.map(function(l){return{variante:l.id,cantidad:l.cantidad}}),libres:libres.map(function(l){return{descripcion:l.descripcion,precio:l.precio,cantidad:l.cantidad}})})})
 .then(function(r){return r.json()}).then(function(d){ocupado=false;b.classList.remove("cargando");
  if(!d.ok)return avisar(d.error||"No se pudo cobrar.","mal");
  if(tiles)lineas.forEach(function(l){var t=tiles.querySelector('[data-producto="'+l.producto+'"] [data-cuantos]');if(t){var q=Math.max(0,(Number(t.getAttribute("data-cuantos"))||0)-l.cantidad);t.setAttribute("data-cuantos",q);t.textContent=q;t.classList.toggle("poco",q<=2)}});
  $("#exito-total").textContent=d.total!=null?dinero(d.total):"";
  $("#exito-titulo").textContent="Venta #"+d.ventaId;
  $("#exito-detalle").textContent=d.unidades+(d.unidades===1?" producto":" productos")+" · "+(fiado?"Fiado a "+cliente:m)+(d.tarifa==="cashea"?" · precio Cashea":"");
  $("#exito-recibo").href=d.recibo;var w=$("#exito-whatsapp");w.href=d.whatsapp||"#";w.hidden=!d.whatsapp;
  document.querySelectorAll(".tostadas").forEach(function(v){v.remove()});
  $("#exito").hidden=false;pitido(true);setTimeout(function(){$("#exito-nueva").focus()},60);
  lineas=[];libres=[];conCliente=false;$("#cliente").value="";if($("#serial"))$("#serial").value="";$("#telefono").value="";var r=document.querySelector('input[name="metodo"]:checked');if(r)r.checked=false;verCliente();pintar();
 }).catch(function(){ocupado=false;b.classList.remove("cargando");avisar("Sin conexión: no se cobró nada ni se descontó stock.","mal")});
}
$("#cobrar").onclick=cobrarYa;
function cerrarExito(){$("#exito").hidden=true;lector.focus()}
$("#exito-nueva").onclick=cerrarExito;
$("#exito").addEventListener("click",function(e){if(e.target.id==="exito")cerrarExito()});
document.addEventListener("keydown",function(e){if(e.key==="F9"){e.preventDefault();cobrarYa()}else if(e.key==="Escape"&&!$("#exito").hidden)cerrarExito()});
// LA CÁMARA. BarcodeDetector viene en Chrome de Android; donde no está
// (iPhone), se carga ZXing, que hace lo mismo en cualquier navegador.
var leyendo=false,flujo=null,video=$("#camara"),marco=$("#camara-marco"),botonCam=$("#btn-camara"),lectorZ=null;
function parar(){leyendo=false;if(lectorZ)try{lectorZ.reset()}catch(e){}lectorZ=null;if(flujo)flujo.getTracks().forEach(function(t){t.stop()});flujo=null;marco.classList.remove("encendida");botonCam.classList.remove("encendida")}
function cargarZxing(){return new Promise(function(ok,mal){if(window.ZXing)return ok();var s=document.createElement("script");s.src="https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js";s.onload=ok;s.onerror=mal;document.head.appendChild(s)})}
var ultimo="",cuando=0;
function leido(c){var ahora=Date.now();if(c===ultimo&&ahora-cuando<2500)return;ultimo=c;cuando=ahora;leer(c)}
botonCam.onclick=function(){
 if(leyendo)return parar();
 if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)return avisar("Este navegador no deja usar la cámara.","mal");
 leyendo=true;botonCam.classList.add("encendida");marco.classList.add("encendida");
 if("BarcodeDetector" in window){
  navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}}).then(function(s){flujo=s;video.srcObject=s;video.play();
   var det=new BarcodeDetector({formats:["ean_13","ean_8","upc_a","upc_e","code_128","code_39","qr_code"]});
   (function mirar(){if(!leyendo)return;det.detect(video).then(function(r){if(r[0])leido(r[0].rawValue)}).catch(function(){}).then(function(){setTimeout(mirar,250)})})();
  }).catch(function(){parar();avisar("No me dieron permiso para la cámara.","mal")});
 } else {
  cargarZxing().then(function(){lectorZ=new ZXing.BrowserMultiFormatReader();
   lectorZ.decodeFromConstraints({video:{facingMode:"environment"}},video,function(r){if(r)leido(r.getText())}).then(function(){flujo=video.srcObject});
  }).catch(function(){parar();avisar("No pude cargar el lector de la cámara. Usa un lector o escribe el nombre.","mal")});
 }
};
var cobrarVisible=false;
if("IntersectionObserver" in window)new IntersectionObserver(function(e){cobrarVisible=e[0].isIntersecting;$("#pos-flotante").classList.toggle("oculto",cobrarVisible)}).observe($("#cobrar"));
verCliente();pintar();
})();
</script>`;
}

/* ── Las rutas ───────────────────────────────────────────────────────── */

// helpers: { pagina(titulo, cuerpo, { ruta }), vieneDelPanel(request, url), redirigir(a) }
// opciones: { tienda, traerCatalogo?, nombreDelCatalogo?, tarifaDeCaja? }
export function esRutaDeInventario(url) {
  return url.pathname === "/panel/inventario" || url.pathname.startsWith("/panel/inventario/") || url.pathname === "/panel/inventario.csv" || url.pathname === "/panel/caja" || url.pathname.startsWith("/panel/caja/");
}

export async function atenderInventario(request, env, url, helpers, opciones = {}) {
  const { vieneDelPanel, redirigir } = helpers;
  const ruta = url.pathname;
  const tienda = opciones.tienda || "La tienda";
  const pagina = (titulo, cuerpo, seccion = "inventario") => helpers.pagina(titulo, cuerpo, { ruta: seccion });

  if (request.method === "POST") {
    if (!vieneDelPanel(request, url)) return new Response("No", { status: 403 });
    return atenderPost(request, env, url, { redirigir, pagina, opciones, tienda });
  }

  if (ruta === "/panel/inventario") return pagina("Inventario", await paginaDeLista(env, url, rubroDe(opciones.rubro)));
  if (ruta === "/panel/inventario.csv") {
    const filas = await filasParaExportar(env.DB);
    return respuestaCsv(
      `inventario-${new Date(Date.now() + DESFASE_MS).toISOString().slice(0, 10)}.csv`,
      aCsv(
        ["Producto", "Marca", "Gama", mayuscula(rubroDe(opciones.rubro).variante), "Color", "Código de barras", "Código de fábrica", "Precio", "Sede", "Cantidad"],
        filas.map((f) => [f.titulo, f.marca, f.gama, f.opcion, f.color, f.codigo_barras, f.codigo_fabricante || "", f.precio ?? "", f.sede, f.cantidad])
      )
    );
  }
  if (ruta.startsWith("/panel/inventario/p/")) {
    const cuerpo = await paginaDeProducto(env, ruta.slice("/panel/inventario/p/".length), url, opciones);
    return cuerpo ? pagina("Producto", cuerpo) : redirigir(conAviso("/panel/inventario", { error: "Ese producto ya no existe." }));
  }
  if (ruta === "/panel/inventario/nuevo") return pagina("Nuevo producto", await paginaDeNuevo(env, url, rubroDe(opciones.rubro)));
  if (ruta === "/panel/inventario/importar") return pagina("Importar", await paginaDeImportar(env, url, opciones));
  if (ruta === "/panel/inventario/sedes") return pagina("Sedes", await paginaDeSedes(env, url));
  if (ruta === "/panel/inventario/movimientos") return pagina("Movimientos", await paginaDeMovimientos(env, url));
  if (ruta === "/panel/inventario/etiquetas") {
    const html = await paginaDeEtiquetas(env, url, tienda);
    if (html?.redirigir) return redirigir(html.redirigir);
    // La hoja de etiquetas es una página propia, en blanco, para imprimir.
    if (html.startsWith("<!doctype")) return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    return pagina("Etiquetas", html);
  }
  if (ruta === "/panel/caja") return pagina("Caja", await paginaDeCaja(env, url, opciones), "caja");
  if (ruta === "/panel/caja/buscar") return json(await buscarParaCaja(env, url.searchParams.get("q"), url.searchParams.get("producto")));
  return redirigir("/panel/inventario");
}

function paraCaja(v) {
  return {
    id: v.id,
    producto: v.producto_id,
    titulo: v.titulo,
    variante: nombreDeVariante(v),
    precio: v.precioFinal ?? v.precio ?? v.precio_producto ?? null,
    precioCashea: v.precioCashea ?? v.precio_cashea ?? v.precio_cashea_producto ?? null,
    porSede: v.porSede || {},
  };
}

// Lo que llega a la caja: un código (lector o cámara), un nombre escrito,
// o un producto tocado (todas sus tallas).
async function buscarParaCaja(env, texto, productoId) {
  if (Number(productoId)) {
    const p = await verProducto(env.DB, productoId);
    if (!p || !p.activo) return { variante: null, opciones: [] };
    const opciones = p.variantes.map((v) => paraCaja({ ...v, titulo: p.titulo, precioFinal: v.precio ?? p.precio }));
    return opciones.length === 1 ? { variante: opciones[0] } : { variante: null, opciones };
  }
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

async function atenderPost(request, env, url, { redirigir, pagina, opciones, tienda }) {
  const ruta = url.pathname;

  if (ruta === "/panel/caja/cobrar") {
    let datos = {};
    try {
      datos = await request.json();
    } catch {
      return json({ ok: false, error: "Pedido inválido." }, 400);
    }
    const metodo = String(datos.metodo || "");
    const tarifa = tarifaDeLaVenta(opciones.tarifaDeCaja, datos.fiado ? "Fiado" : metodo);
    try {
      const r = await cobrar(env.DB, {
        sedeId: datos.sede,
        quien: datos.quien,
        metodoPago: metodo,
        items: (datos.items || []).map((i) => ({ varianteId: i.variante, cantidad: i.cantidad })),
        libres: Array.isArray(datos.libres) ? datos.libres : [],
        fiado: Boolean(datos.fiado),
        cliente: datos.cliente || "",
        telefono: datos.telefono || "",
        nota: datos.nota || "",
        tarifa,
      });
      console.log(`CAJA: venta ${r.ventaId} (${r.unidades} u) por ${datos.quien || "—"}${tarifa ? ` · ${tarifa}` : ""}`);
      const venta = await verVenta(env.DB, r.ventaId).catch(() => null);
      const whatsapp = venta ? enlaceWhatsapp(datos.telefono, textoDelRecibo(venta, tienda)) : "";
      return json({ ok: true, ...r, tarifa, recibo: `/panel/ventas/${r.ventaId}`, whatsapp });
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
        informeDeImportacion(
          probando ? "Así quedaría el Excel" : "Excel importado",
          [
            ["Filas leídas", "lista", informe.filas, true],
            ["Productos nuevos", "mas", informe.nuevos, true],
            [`${mayuscula(rubroDe(opciones.rubro).variantes)} con stock puesto`, "inventario", informe.actualizadas, true],
            ["Sin cambios", "check", informe.sinCambio, false],
          ],
          informe.errores,
          { probando, r: rubroDe(opciones.rubro) }
        )
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
    // EPICCELL (decisión del dueño): traído el catálogo, MANDA EL INVENTARIO.
    // Solo la primera vez: si después se volvió a la hoja, eso se respeta.
    let pasoAlInventario = false;
    if (opciones.botLeeInventario && informe.modelos && (await leerAjuste(env.DB, "catalogo_del_bot")) === null) {
      await guardarAjuste(env.DB, "catalogo_del_bot", "inventario");
      pasoAlInventario = true;
      console.log("INVENTARIO: desde ahora el bot ofrece lo del inventario");
    }
    return pagina(
      "Importación",
      informeDeImportacion(
        "Catálogo traído",
        [
          ["Productos", "inventario", informe.modelos, true],
          [mayuscula(rubroDe(opciones.rubro).variantes), "etiqueta", informe.variantes, true],
          ["Con stock cargado", "check", informe.conStock, true],
          ["Filas repetidas juntadas", "lista", informe.juntadas, false, "mismo producto en varias filas: se sumaron"],
        ],
        informe.errores,
        {
          r: rubroDe(opciones.rubro),
          extra: pasoAlInventario
            ? `<div class="aviso-grande">${insignia("chats", "marca")}<div><b>Desde ahora el bot ofrece lo del inventario</b><p>Lo que tiene stock, con los precios y las fotos de aquí. Los cambios se hacen en el panel: ${esc(String(opciones.nombreDelCatalogo || "la hoja").split(" (")[0])} ya no se lee. Si algo no cuadra, en Importar puedes volver a ella.</p></div></div>`
            : "",
        }
      )
    );
  }

  if (ruta === "/panel/inventario/mover" || ruta === "/panel/inventario/ajustar") {
    const volver = volverSeguro(datos?.get("volver"), "/panel/inventario");
    const tipo = ruta === "/panel/inventario/ajustar" ? "ajuste" : String(datos?.get("tipo") || "");
    try {
      const args = { varianteId: datos.get("variante"), sedeId: datos.get("sede"), cantidad: datos.get("cantidad"), quien, nota: String(datos.get("nota") || "") };
      if (tipo === "ajuste") {
        if (String(args.cantidad ?? "").trim() === "") throw new Error("Escribe cuántas contaste.");
        const queda = await ajustarStock(env.DB, args);
        return redirigir(conAviso(volver, { ok: `Contado: quedan ${queda} en esa sede.` }));
      }
      if (tipo === "venta") {
        // "Vendí" es una venta de verdad: pasa por la caja, para que cuente
        // en Ventas, en el balance y en lo más vendido.
        const metodo = String(datos.get("metodo") || "");
        const r = await cobrar(env.DB, {
          sedeId: args.sedeId,
          quien,
          metodoPago: metodo,
          items: [{ varianteId: args.varianteId, cantidad: args.cantidad }],
          nota: args.nota,
          tarifa: tarifaDeLaVenta(opciones.tarifaDeCaja, metodo),
        });
        const v = await verVariante(env.DB, args.varianteId);
        const queda = v?.porSede?.[Number(args.sedeId)] ?? 0;
        return redirigir(conAviso(volver, { ok: `Venta #${r.ventaId} registrada${r.total !== null && r.total !== undefined ? ` por ${plata(r.total, { siempre: true })}` : ""}. Quedan ${queda}.` }));
      }
      const queda = await moverStock(env.DB, { ...args, tipo });
      return redirigir(conAviso(volver, { ok: `${TIPOS_DE_MOVIMIENTO[tipo] || "Movido"}. Quedan ${queda} en esa sede.` }));
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
        costo: datos.get("costo"),
      });
      const opcionesDeTalla = leerOpciones(datos.get("opciones"));
      const cantidad = Math.trunc(Number(datos.get("cantidad")) || 0);
      const sedeId = Number(datos.get("sede")) || (await sedes(env.DB))[0]?.id;
      for (const opcion of opcionesDeTalla) {
        const varianteId = await guardarVariante(env.DB, productoId, {
          opcion,
          color: datos.get("color"),
          codigo_fabricante: opcionesDeTalla.length === 1 ? datos.get("codigo_fabricante") : "",
        });
        if (cantidad > 0 && sedeId) await ajustarStock(env.DB, { varianteId, sedeId, cantidad, quien, nota: "Al crearlo", tipo: "carga" });
      }
      const n = opcionesDeTalla.length;
      return redirigir(conAviso(`/panel/inventario/p/${productoId}`, { ok: `Creado con ${n} ${n === 1 ? "variante" : "tallas"}, cada una con su código${cantidad > 0 ? ` y ${cantidad} en stock` : ""}.` }));
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
  if (ruta === "/panel/inventario/variante/editar") {
    try {
      await editarVariante(env.DB, datos.get("variante"), {
        ...Object.fromEntries(["precio", "precio_cashea", "precio_local", "foto", "codigo_fabricante"].map((k) => [k, datos.get(k)])),
        oculta: datos.get("con_bot") ? datos.get("al_bot") !== "si" : undefined,
      });
      return redirigir(conAviso(alProducto, { ok: "Guardado." }));
    } catch (error) {
      return redirigir(conAviso(alProducto, { error: error.message }));
    }
  }
  if (ruta === "/panel/inventario/fuente-del-bot") {
    const fuente = datos.get("fuente") === "hoja" ? "hoja" : "inventario";
    if (opciones.botLeeInventario) {
      await guardarAjuste(env.DB, "catalogo_del_bot", fuente);
      console.log(`INVENTARIO: el bot ofrece desde ahora lo de ${fuente === "hoja" ? "la hoja" : "el inventario"}`);
    }
    return redirigir(conAviso("/panel/inventario/importar", { ok: fuente === "hoja" ? `El bot vuelve a leer ${String(opciones.nombreDelCatalogo || "la hoja").split(" (")[0]}.` : "El bot ofrece lo del inventario." }));
  }
  if (ruta === "/panel/inventario/editar") {
    await editarProducto(env.DB, productoId, Object.fromEntries(["titulo", "marca", "gama", "precio", "precio_local", "precio_cashea", "costo"].map((k) => [k, datos.get(k)])));
    return redirigir(conAviso(alProducto, { ok: "Guardado." }));
  }
  if (ruta === "/panel/inventario/archivar") {
    await archivarProducto(env.DB, productoId);
    return redirigir(conAviso("/panel/inventario", { ok: "Producto quitado del inventario." }));
  }
  if (ruta === "/panel/inventario/sedes") {
    await crearSede(env.DB, datos?.get("nombre"));
    return redirigir(conAviso("/panel/inventario/sedes", { ok: "Sede añadida." }));
  }
  return redirigir("/panel/inventario");
}
