// LAS PANTALLAS DEL NEGOCIO (fase 2, 7-oct-2026): Inicio, Ventas, Gastos,
// Reportes, Ganancias y el asistente. Los números y las reglas viven en negocio.js; aquí
// solo se pintan y se reciben los formularios.
//
//   /panel/inicio            cómo va el negocio hoy (o el período elegido),
//                            consejos de la IA y el asistente
//   /panel/ventas            todo lo cobrado, por día, con su recibo
//   /panel/ventas/<id>       el recibo: imprimir, WhatsApp, anular
//   /panel/gastos            lo que sale, por categoría
//   /panel/asistente         (POST) la pregunta al asistente
//   /panel/ventas.csv, /panel/gastos.csv,  para Excel
//
// ESTE ARCHIVO ES IGUAL EN LAS TRES TIENDAS. panel.js lo llama con la sesión
// ya comprobada.

import {
  CATEGORIAS_DE_GASTO,
  METODOS_DE_PAGO,
  asegurarNegocio,
  diaDe,
  periodoDe,
  registrarGasto,
  borrarGasto,
  listarGastos,
  listarVentas,
  verVenta,
  anotadaDespues,
  textoDelRecibo,
  serialDe,
  casheaDe,
  detalleDeLinea,
  resumen,
  reporteDelPeriodo,
  gananciasDelPeriodo,
  textoDelReporte,
  seEstanAcabando,
  consejos,
  asistenteActivo,
  preguntarAlAsistente,
} from "./negocio.js";
import { anularVenta } from "./inventario.js";
import { aCsv, respuestaCsv } from "./alpha.js";
import {
  esc,
  cabecera,
  segmento,
  vacio,
  insignia,
  avatar,
  cifra,
  plata,
  numero,
  horaCorta,
  fechaHora,
  fechaLarga,
  diaBonito,
  saludo,
  tostadaDesde,
  ventana,
  botonCerrarVentana,
  icono,
  pastillaDeStock,
} from "./marco.js";

const DIA_MS = 24 * 60 * 60 * 1000;

function json(datos, estado = 200) {
  return new Response(JSON.stringify(datos), { status: estado, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function quiereJson(request) {
  return /application\/json/.test(request.headers.get("accept") || "") || /application\/json/.test(request.headers.get("content-type") || "");
}

function conAviso(ruta, { ok = "", error = "" } = {}) {
  const [camino, hash = ""] = String(ruta).split("#");
  const sep = camino.includes("?") ? "&" : "?";
  const extra = error ? `error=${encodeURIComponent(error)}` : ok ? `ok=${encodeURIComponent(ok)}` : "";
  return `${camino}${extra ? sep + extra : ""}${hash ? `#${hash}` : ""}`;
}

function volverSeguro(valor, porDefecto) {
  const v = String(valor || "");
  return /^\/panel\/(inicio|ventas|gastos|reportes|ganancias)(\/|\?|#|$)/.test(v) && !v.startsWith("//") ? v : porDefecto;
}

// 0414-123.45.67 → 584141234567 (para wa.me). Vacío si no parece teléfono.
export function telefonoParaWhatsapp(texto) {
  let d = String(texto || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = `58${d.slice(1)}`;
  else if (d.length === 10 && d.startsWith("4")) d = `58${d}`;
  return d.length >= 10 && d.length <= 15 ? d : "";
}

export function enlaceWhatsapp(telefono, texto) {
  const tel = telefonoParaWhatsapp(telefono);
  return `https://wa.me/${tel}?text=${encodeURIComponent(texto)}`;
}

/* ── Los íconos de cada cosa ─────────────────────────────────────────── */

const ICONO_DE_CATEGORIA = {
  Mercancía: "inventario",
  Alquiler: "sede",
  Sueldos: "clientes",
  "Servicios (luz, agua, internet)": "rayo",
  Transporte: "camion",
  Publicidad: "anuncios",
  Comisiones: "porcentaje",
  Mantenimiento: "herramienta",
  Impuestos: "recibo",
  Otros: "puntos",
};

export function iconoDeMetodo(metodo) {
  const m = String(metodo || "").toLowerCase();
  if (m.includes("efectivo")) return "efectivo";
  if (m.includes("móvil") || m.includes("movil")) return "telefono";
  if (m.includes("transferencia")) return "banco";
  if (m.includes("punto")) return "tarjeta";
  if (m.includes("zelle")) return "enviar";
  if (m.includes("cashea")) return "calendario";
  return "recibo";
}

/* ── El período (Hoy, Ayer, 7 días…) ─────────────────────────────────── */

const PERIODOS = [
  ["hoy", "Hoy"],
  ["ayer", "Ayer"],
  ["7", "7 días"],
  ["30", "30 días"],
  ["mes", "Este mes"],
  ["mes-pasado", "Mes pasado"],
];

function selectorDePeriodo(ruta, periodo, extra = {}) {
  const opciones = PERIODOS.map(([clave, nombre]) => [clave, nombre, `${ruta}?${new URLSearchParams({ ...extra, p: clave })}`]);
  const id = `fechas-${ruta.split("/").pop()}`;
  const fechas = ventana(id, {
    titulo: "Elegir las fechas",
    icono: "calendario",
    cuerpo: `<form method="get" action="${esc(ruta)}" class="campos" style="margin-top:14px">${Object.entries(extra)
      .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
      .join("")}<label class="campo">Desde<input type="date" name="desde" value="${esc(periodo.desdeDia)}" max="${esc(diaDe(Date.now()))}" required></label><label class="campo">Hasta<input type="date" name="hasta" value="${esc(periodo.hastaDia)}" max="${esc(diaDe(Date.now()))}" required></label><div class="acciones campo ancho">${botonCerrarVentana(id)}<button class="principal">Ver</button></div></form>`,
  });
  return `<div class="periodo-app">${segmento(opciones, periodo.clave, { nombre: "Período" })}<button type="button" class="icono${periodo.clave === "a-medida" ? " principal" : ""}" popovertarget="${id}" title="Elegir las fechas" aria-label="Elegir las fechas">${icono("calendario")}</button></div>${fechas}`;
}

function anteriorDe(periodo) {
  const largo = periodo.hasta - periodo.desde;
  return { desde: periodo.desde - largo, hasta: periodo.desde };
}

function frenteA(periodo) {
  return { hoy: "que ayer", ayer: "que anteayer", 7: "que los 7 días anteriores", 30: "que los 30 días anteriores" }[periodo.clave] || "que el período anterior";
}

function cambioEnVentas(actual, anterior, periodo) {
  const a = actual.ventas.total;
  const b = anterior.ventas.total;
  if (!a && !b) return `<span>Todavía sin ventas ${esc(periodo.nombre)}</span>`;
  if (!b) return `<span class="cambio sube">${icono("sube")}Nuevo</span><span>${periodo.clave === "hoy" ? "ayer no hubo ventas" : "en el período anterior no hubo ventas"}</span>`;
  const pct = Math.round(((a - b) / b) * 100);
  if (pct === 0) return `<span class="cambio igual">${icono("menos")}0%</span><span>igual ${esc(frenteA(periodo))}</span>`;
  return `<span class="cambio ${pct > 0 ? "sube" : "baja"}">${icono(pct > 0 ? "sube" : "baja")}${Math.abs(pct)}%</span><span>${pct > 0 ? "más" : "menos"} ventas ${esc(frenteA(periodo))}</span>`;
}

/* ── Gráficos ────────────────────────────────────────────────────────── */

// Columnas de UNA serie (ventas por día): sin leyenda, el título la nombra.
// Al pasar el dedo o el ratón, el globo dice el monto y cuántas ventas.
function columnas(dias, hoy) {
  const max = Math.max(1, ...dias.map((d) => d.ventas));
  const hueco = dias.length > 20 ? 3 : dias.length > 10 ? 5 : 8;
  const cuerpo = dias
    .map((d, n) => {
      const alto = d.ventas ? Math.max(4, Math.round((d.ventas / max) * 100)) : 2;
      return `<div class="columna${d.ventas ? "" : " vacia"}${d.dia === hoy ? " hoy" : ""}" tabindex="0" style="--n:${n};--alto:${alto}%"><i style="height:${alto}%"></i><span class="globo">${esc(plata(d.ventas, { siempre: true }))}<small>${esc(diaBonito(d.dia, hoy))} · ${d.cantidad} ${d.cantidad === 1 ? "venta" : "ventas"}</small></span></div>`;
    })
    .join("");
  return `<div class="columnas" style="--hueco:${hueco}px" role="img" aria-label="Ventas por día">${cuerpo}</div><div class="columnas-ejes"><span>${esc(diaBonito(dias[0]?.dia, hoy))}</span><span>${esc(diaBonito(dias.at(-1)?.dia, hoy))}</span></div>`;
}

// VENTAS POR CATEGORÍA (13-oct-2026): cuánto vendió cada sección del
// inventario en el período. Sale cuando al menos un producto vendido tiene
// categoría; si no, en Ventas se explica cómo tenerla.
function tarjetaDeCategorias(porCategoria, { conPista = false } = {}) {
  const conCategoria = (porCategoria || []).some((c) => !c.sinCategoria);
  if (!conCategoria) {
    return conPista && (porCategoria || []).length
      ? `<section class="panel-tarjeta" style="margin:18px 0"><h2>${insignia("etiqueta", "neutro", "chica")}Ventas por categoría</h2><p class="suave" style="margin:0">Ponle categoría a tus productos (Relojes, Calzados…) en Inventario › Editar y aquí verás cuánto vende cada sección.</p></section>`
      : "";
  }
  const nombre = (c) => `${c.categoria} · ${numero(c.unidades)} ${c.unidades === 1 ? "unidad" : "unidades"}`;
  const ico = (c) => (c.libre ? "libre" : c.sinCategoria ? "puntos" : "etiqueta");
  return `<section class="panel-tarjeta categorias-tarjeta"><div class="seccion"><h2>${insignia("etiqueta", "marca", "chica")}Ventas por categoría</h2><a href="/panel/inventario">Inventario${icono("adelante", { clase: "chico" })}</a></div>${reparto(porCategoria.slice(0, 8), { nombre, valor: (c) => c.monto, ico })}</section>`;
}

function reparto(filas, { nombre, valor, ico, max = null }) {
  const tope = max ?? Math.max(1, ...filas.map(valor));
  return `<div class="reparto">${filas
    .map(
      (f, n) =>
        `<div class="reparto-fila" style="--n:${n}">${insignia(ico(f), "marca", "chica")}<span class="reparto-nombre">${esc(nombre(f))}</span><span class="reparto-valor">${esc(plata(valor(f), { siempre: true }))}</span><div class="reparto-barra"><i style="width:${Math.max(2, Math.round((valor(f) / tope) * 100))}%"></i></div></div>`
    )
    .join("")}</div>`;
}

// Cashea del período: ventas, inicial cobrada (y con qué se pagó) y monto financiado.
// Sale en Inicio, Ventas y Reportes cuando hubo ventas con Cashea.
function tarjetaDeCashea(c, { enlace = true } = {}) {
  if (!c || !c.ventas) return "";
  const metodos = c.porMetodo.length
    ? `<div class="filas" style="margin-top:10px">${c.porMetodo.map((m) => `<div class="fila">${insignia(iconoDeMetodo(m.metodo), "neutro", "chica")}<div class="fila-centro"><div class="fila-titulo">Inicial por ${esc(m.metodo)}</div><div class="fila-sub">${numero(m.cantidad)} ${m.cantidad === 1 ? "venta" : "ventas"}</div></div><b>${esc(plata(m.monto, { siempre: true }))}</b></div>`).join("")}</div>`
    : "";
  return `<section class="panel-tarjeta cashea-tarjeta" style="margin:18px 0"><div class="seccion"><h2>${insignia("calendario", "marca", "chica")}Cashea</h2>${enlace ? `<a href="/panel/reportes">Reporte${icono("adelante", { clase: "chico" })}</a>` : ""}</div>
<div class="mosaico"><div class="dato"><div class="dato-cima"><span class="dato-nombre">Ventas con Cashea</span></div><div class="dato-valor">${cifra(c.total)}</div><div class="dato-pie">${numero(c.ventas)} ${c.ventas === 1 ? "venta" : "ventas"}</div></div><div class="dato"><div class="dato-cima"><span class="dato-nombre">Inicial cobrada</span></div><div class="dato-valor">${cifra(c.inicial)}</div></div><div class="dato"><div class="dato-cima"><span class="dato-nombre">Monto financiado</span></div><div class="dato-valor">${cifra(c.financiado)}</div><div class="dato-pie">lo paga Cashea en cuotas</div></div></div>${metodos}</section>`;
}

/* ── REPORTES ────────────────────────────────────────────────────────── */
// EL REPORTE IMPRESO (17-oct-2026, pedido del dueño: "estilo factura fiscal, tipo carta, donde
// especifica cada movimiento"): una hoja carta en blanco y negro con el encabezado de la tienda,
// cada venta con sus productos (talla y color), cada gasto, el detalle de Cashea, los totales y
// las firmas. En pantalla no se ve; al imprimir es lo único que sale. Es un documento de control
// interno: no sustituye una factura fiscal.
const ESTILO_DOCUMENTO = `<style>
.doc-fiscal{display:none}
@media print{
 @page{size:letter portrait;margin:12mm 12mm 14mm}
 .reporte-pantalla{display:none!important}
 .doc-fiscal{display:block!important;color:#000;background:#fff;font:11px/1.35 "Courier New",Courier,monospace;-webkit-print-color-adjust:exact;print-color-adjust:exact}
 .doc-fiscal *{color:#000!important;background:none!important;box-shadow:none!important;text-shadow:none!important;animation:none!important}
 .doc-fiscal h1{margin:0;font:700 17px/1.2 "Courier New",monospace;text-align:center;letter-spacing:.04em;text-transform:uppercase}
 .doc-fiscal h2{margin:14px 0 4px;padding:3px 0;font:700 11.5px "Courier New",monospace;text-transform:uppercase;border-top:2px solid #000;border-bottom:1px solid #000}
 .doc-fiscal .centro{text-align:center}.doc-fiscal .der{text-align:right}
 .doc-fiscal .caja-datos{margin:8px 0;padding:6px 8px;border:1px solid #000;display:grid;grid-template-columns:1fr 1fr;gap:2px 18px}
 .doc-fiscal .caja-datos div{display:flex;justify-content:space-between;gap:8px}
 .doc-fiscal table{width:100%;border-collapse:collapse;margin:0}
 .doc-fiscal th{padding:3px 4px;text-align:left;font-weight:700;border-bottom:1px solid #000;font-size:10px;text-transform:uppercase}
 .doc-fiscal td{padding:3px 4px;vertical-align:top;border-bottom:1px dotted #777}
 .doc-fiscal td.num,.doc-fiscal th.num{text-align:right;white-space:nowrap}
 .doc-fiscal tr{break-inside:avoid}
 .doc-fiscal .sub td{padding-top:0;font-size:10px}
 .doc-fiscal .anulada td{text-decoration:line-through}
 .doc-fiscal .totales{margin:8px 0 0 auto;width:62%}
 .doc-fiscal .totales div{display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px dotted #777}
 .doc-fiscal .totales .gran{margin-top:3px;padding:4px 0;font-weight:700;font-size:13px;border-top:2px solid #000;border-bottom:2px solid #000}
 .doc-fiscal .firmas{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:46px;break-inside:avoid}
 .doc-fiscal .firmas div{padding-top:4px;text-align:center;border-top:1px solid #000}
 .doc-fiscal .nota{margin-top:14px;font-size:9.5px;text-align:center}
}
</style>`;

function documentoFiscal({ r, ventas, gastos, periodo, tienda }) {
  const m = (n) => esc(plata(n, { siempre: true }));
  const emitido = `${diaDe(Date.now())} ${horaCorta(Date.now())}`;
  const rango = periodo.desdeDia === periodo.hastaDia ? periodo.desdeDia : `${periodo.desdeDia} al ${periodo.hastaDia}`;
  const vigentes = ventas.filter((v) => !v.anulada);
  const anuladas = ventas.length - vigentes.length;
  const lineasDeVenta = (v) =>
    (v.items || []).length
      ? v.items.map((i) => `${numero(i.cantidad)} × ${esc(i.titulo)}${i.opcion ? ` · ${esc(i.opcion)}` : ""}${i.color ? ` · ${esc(i.color)}` : ""}${i.precio !== null ? ` @ ${m(i.precio)}` : ""}`).join("<br>")
      : esc(v.detalle || "—");
  const filaVenta = (v) => {
    const casheaV = v.cashea_nivel
      ? `<tr class="sub${v.anulada ? " anulada" : ""}"><td></td><td colspan="5">&nbsp;&nbsp;↳ CASHEA ${v.cashea_nivel === "libre" ? "inicial libre" : `nivel ${esc(v.cashea_nivel)}`} (${esc(String(v.cashea_pct))} %): inicial ${m(v.cashea_inicial)}${v.cashea_inicial_por ? ` por ${esc(v.cashea_inicial_por)}` : ""} · financiado ${m(v.cashea_financiado)} en ${esc(String(v.cashea_cuotas))} ${v.cashea_cuotas === 1 ? "cuota" : "cuotas"}</td></tr>`
      : "";
    return `<tr class="${v.anulada ? "anulada" : ""}"><td>${v.id}</td><td>${esc(diaDe(v.creado))}<br>${esc(horaCorta(v.creado))}</td><td>${esc(v.cliente || "—")}</td><td>${lineasDeVenta(v)}${v.anulada ? "<br>(ANULADA)" : ""}</td><td>${esc(v.metodo_pago || "—")}</td><td class="num">${v.total === null ? "—" : m(v.total)}</td></tr>${casheaV}`;
  };
  const ventasTabla = ventas.length
    ? `<table><thead><tr><th>N°</th><th>Fecha / hora</th><th>Cliente</th><th>Descripción</th><th>Pago</th><th class="num">Total</th></tr></thead><tbody>${ventas.map(filaVenta).join("")}</tbody></table>`
    : '<p class="centro">Sin ventas en este período.</p>';
  const c = r.cashea;
  const casheaSeccion = c.ventas
    ? `<table><thead><tr><th>N°</th><th>Cliente</th><th>Nivel</th><th class="num">%</th><th class="num">Total</th><th class="num">Inicial</th><th>Pagó con</th><th class="num">Financiado</th><th class="num">Cuotas</th></tr></thead><tbody>${c.lista.map((v) => `<tr><td>${v.id}</td><td>${esc(v.cliente || "—")}</td><td>${v.nivel === "libre" ? "Libre" : esc(v.nivel)}</td><td class="num">${esc(String(v.pct))}</td><td class="num">${m(v.total)}</td><td class="num">${m(v.inicial)}</td><td>${esc(v.inicial_por || "—")}</td><td class="num">${m(v.financiado)}</td><td class="num">${esc(String(v.cuotas))}</td></tr>`).join("")}<tr><td colspan="4"><b>TOTAL CASHEA (${numero(c.ventas)})</b></td><td class="num"><b>${m(c.total)}</b></td><td class="num"><b>${m(c.inicial)}</b></td><td></td><td class="num"><b>${m(c.financiado)}</b></td><td></td></tr></tbody></table>`
    : '<p class="centro">Sin ventas con Cashea en este período.</p>';
  const gastosSeccion = gastos.length
    ? `<table><thead><tr><th>Fecha</th><th>Categoría</th><th>Detalle</th><th>Método</th><th class="num">Monto</th></tr></thead><tbody>${gastos.map((g) => `<tr><td>${esc(diaDe(g.fecha))}</td><td>${esc(g.categoria)}</td><td>${esc(g.descripcion || "—")}</td><td>${esc(g.metodo || "—")}</td><td class="num">${m(g.monto)}</td></tr>`).join("")}</tbody></table>`
    : '<p class="centro">Sin gastos en este período.</p>';
  const metodos = r.porMetodo.length
    ? `<table><thead><tr><th>Método de pago</th><th class="num">Ventas</th><th class="num">Monto</th></tr></thead><tbody>${r.porMetodo.map((x) => `<tr><td>${esc(x.metodo)}</td><td class="num">${numero(x.cantidad)}</td><td class="num">${m(x.total)}</td></tr>`).join("")}</tbody></table>`
    : "";
  return `${ESTILO_DOCUMENTO}<div class="doc-fiscal" aria-hidden="true">
<h1>${esc(tienda)}</h1>
<div class="centro"><b>REPORTE DE VENTAS Y MOVIMIENTOS</b></div>
<div class="centro">Período: ${esc(rango)} (${esc(periodo.nombre)}) · Emitido: ${esc(emitido)}</div>
<div class="caja-datos"><div><span>Ventas registradas</span><b>${numero(vigentes.length)}</b></div><div><span>Ventas anuladas</span><b>${numero(anuladas)}</b></div><div><span>Total vendido</span><b>${m(r.ventas.total)}</b></div><div><span>Ganancia</span><b>${m(r.ganancia.monto)}</b></div></div>
<h2>I. Detalle de ventas</h2>${ventasTabla}
<h2>II. Detalle de Cashea (inicial cobrada y monto financiado)</h2>${casheaSeccion}
<h2>III. Detalle de gastos</h2>${gastosSeccion}
<h2>IV. Resumen por método de pago</h2>${metodos}
<h2>V. Totales</h2>
<div class="totales">
<div><span>Total vendido (${numero(vigentes.length)} ventas)</span><b>${m(r.ventas.total)}</b></div>
<div><span>Cashea: inicial cobrada</span><span>${m(c.inicial)}</span></div>
<div><span>Cashea: monto financiado</span><span>${m(c.financiado)}</span></div>
<div><span>Cobrado</span><b>${m(r.cobrado)}</b></div>
<div><span>Gastos</span><span>${m(r.gastos.total)}</span></div>
<div><span>Ganancia (productos con costo)</span><span>${m(r.ganancia.monto)}</span></div>
<div class="gran"><span>BALANCE (cobrado − gastos)</span><span>${m(r.balance)}</span></div>
</div>
<div class="firmas"><div>Elaborado por</div><div>Revisado por</div></div>
<p class="nota">Documento de control interno generado por ALPHA IA. No sustituye una factura fiscal.</p>
</div>`;
}


async function paginaDeReporte(env, url, { tienda }) {
  const periodo = periodoDe(url.searchParams);
  const [r, ventasDelPeriodo, gastosDelPeriodo] = await Promise.all([
    reporteDelPeriodo(env.DB, periodo),
    listarVentas(env.DB, { ...periodo, limite: 2000 }),
    listarGastos(env.DB, { ...periodo, limite: 2000 }),
  ]);
  const hoy = diaDe(Date.now());
  const fechas = periodo.desdeDia === periodo.hastaDia ? diaBonito(periodo.desdeDia, hoy) : `${periodo.desdeDia} al ${periodo.hastaDia}`;
  const texto = textoDelReporte(r, { tienda, nombre: periodo.nombre, fechas: periodo.desdeDia === periodo.hastaDia ? periodo.desdeDia : fechas });
  const dato = (nombre, valor, ico, tono = "marca", pie = "") => `<div class="dato"><div class="dato-cima"><span class="dato-nombre">${esc(nombre)}</span>${insignia(ico, tono, "chica")}</div><div class="dato-valor">${valor}</div>${pie ? `<div class="dato-pie">${pie}</div>` : ""}</div>`;
  const consulta = new URLSearchParams({ ...Object.fromEntries(url.searchParams) });
  consulta.delete("ok");
  consulta.delete("error");
  const metodos = r.porMetodo.length
    ? `<div class="filas">${r.porMetodo.map((m) => `<div class="fila">${insignia(iconoDeMetodo(m.metodo), "neutro", "chica")}<div class="fila-centro"><div class="fila-titulo">${esc(m.metodo)}</div><div class="fila-sub">${numero(m.cantidad)} ${m.cantidad === 1 ? "venta" : "ventas"}</div></div><b>${esc(plata(m.total, { siempre: true }))}</b></div>`).join("")}</div>`
    : '<p class="suave" style="margin:0">Sin ventas en este período.</p>';
  const c = r.cashea;
  const niveles = c.porNivel.length
    ? `<div class="tabla-envoltura"><table class="tabla"><thead><tr><th>Nivel</th><th>Ventas</th><th>Vendido</th><th>Inicial</th><th>Financiado</th></tr></thead><tbody>${c.porNivel.map((n) => `<tr><td>${n.nivel === "libre" ? "Inicial libre" : `Nivel ${esc(n.nivel)}`}</td><td>${numero(n.cantidad)}</td><td>${esc(plata(n.total, { siempre: true }))}</td><td>${esc(plata(n.inicial, { siempre: true }))}</td><td>${esc(plata(n.financiado, { siempre: true }))}</td></tr>`).join("")}</tbody></table></div>`
    : "";
  const lista = c.lista.length
    ? `<div class="filas" style="margin-top:12px">${c.lista.map((v) => `<a class="fila" href="/panel/ventas/${v.id}">${insignia("calendario", "marca")}<div class="fila-centro"><div class="fila-titulo">#${v.id} · ${esc(v.cliente || "Sin nombre")}</div><div class="fila-sub" style="white-space:normal">${esc(horaCorta(v.creado))} · ${v.nivel === "libre" ? "inicial libre" : `nivel ${esc(v.nivel)}`} (${esc(String(v.pct))} %) · inicial ${esc(plata(v.inicial, { siempre: true }))}${v.inicial_por ? ` por ${esc(v.inicial_por)}` : ""} · financiado ${esc(plata(v.financiado, { siempre: true }))}</div></div><b>${esc(plata(v.total, { siempre: true }))}</b></a>`).join("")}</div>`
    : "";
  const documento = documentoFiscal({ r, ventas: ventasDelPeriodo, gastos: gastosDelPeriodo, periodo, tienda });
  return `${tostadaDesde(url)}<div class="reporte-pantalla">${cabecera({
    sobre: "Tu negocio",
    titulo: "Reportes",
    texto: `El reporte de ${esc(periodo.nombre)} para cerrar la caja: ventas, cómo se pagó, Cashea (inicial cobrada y monto financiado), gastos y balance.`,
    acciones: `<div class="no-imprimir" style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" onclick="print()">${icono("imprimir")}Imprimir</button><a class="boton" href="${esc(enlaceWhatsapp("", texto))}" target="_blank" rel="noopener">${icono("enviar")}WhatsApp</a><a class="boton suave" href="/panel/reportes.csv?${esc(consulta.toString())}">${icono("bajar")}Excel</a></div>`,
  })}
<div class="herramientas no-imprimir">${selectorDePeriodo("/panel/reportes", periodo)}</div>
<div class="mosaico">${dato("Vendido", cifra(r.ventas.total), "ventas", "marca", `${numero(r.ventas.cantidad)} ${r.ventas.cantidad === 1 ? "venta" : "ventas"}`)}${dato("Cobrado", cifra(r.cobrado), "efectivo", "bien", ["de contado", r.cashea.financiado ? `y ${esc(plata(r.cashea.financiado))} financiados por Cashea` : ""].filter(Boolean).join(" · "))}${dato("Ganancia", cifra(r.ganancia.monto), "sube", "bien", `<a href="/panel/ganancias">Ver todas las ganancias</a>`)}${dato("Gastos", cifra(r.gastos.total), "gastos", "aviso")}${dato("Balance", cifra(r.balance), "grafica", r.balance >= 0 ? "bien" : "mal", "cobrado − gastos")}</div>
<section class="panel-tarjeta" style="margin:18px 0"><h2>${insignia("recibo", "marca", "chica")}Cómo se pagó</h2>${metodos}</section>
<section class="panel-tarjeta cashea-tarjeta" style="margin:18px 0"><h2>${insignia("calendario", "marca", "chica")}Cashea</h2>${
    c.ventas
      ? `<div class="mosaico">${dato("Ventas con Cashea", cifra(c.total), "ventas", "marca", `${numero(c.ventas)} ${c.ventas === 1 ? "venta" : "ventas"}`)}${dato("Inicial cobrada", cifra(c.inicial), "efectivo", "bien")}${dato("Monto financiado", cifra(c.financiado), "calendario", "aviso", "lo paga Cashea en cuotas")}</div>${
          c.porMetodo.length ? `<h3 style="margin:16px 0 6px;font-size:14px">Con qué se pagó la inicial</h3><div class="filas">${c.porMetodo.map((m) => `<div class="fila">${insignia(iconoDeMetodo(m.metodo), "neutro", "chica")}<div class="fila-centro"><div class="fila-titulo">${esc(m.metodo)}</div><div class="fila-sub">${numero(m.cantidad)} ${m.cantidad === 1 ? "venta" : "ventas"}</div></div><b>${esc(plata(m.monto, { siempre: true }))}</b></div>`).join("")}</div>` : ""
        }<h3 style="margin:16px 0 6px;font-size:14px">Por nivel</h3>${niveles}<h3 style="margin:16px 0 0;font-size:14px">Cada venta</h3>${lista}`
      : '<p class="suave" style="margin:0">Sin ventas con Cashea en este período. Cuando cobres con Cashea en la Caja, aquí verás la inicial cobrada y el monto financiado.</p>'
  }</section>
<section class="panel-tarjeta no-imprimir" style="margin:18px 0"><div class="seccion"><h2>${insignia("enviar", "neutro", "chica")}El reporte en texto</h2><button type="button" onclick="navigator.clipboard&amp;&amp;navigator.clipboard.writeText(document.getElementById('reporte-texto').textContent).then(function(){this.textContent='Copiado'}.bind(this))">Copiar</button></div><pre id="reporte-texto" style="white-space:pre-wrap;margin:0;font:inherit;font-size:13.5px;line-height:1.55">${esc(texto)}</pre></section></div>${documento}`;
}

/* ── GANANCIAS ───────────────────────────────────────────────────────── */

async function paginaDeGanancias(env, url) {
  const periodo = periodoDe(url.searchParams);
  const g = await gananciasDelPeriodo(env.DB, periodo);
  const hoy = diaDe(Date.now());
  const dato = (nombre, valor, ico, tono = "marca", pie = "") => `<div class="dato"><div class="dato-cima"><span class="dato-nombre">${esc(nombre)}</span>${insignia(ico, tono, "chica")}</div><div class="dato-valor">${valor}</div>${pie ? `<div class="dato-pie">${pie}</div>` : ""}</div>`;
  const consulta = new URLSearchParams({ ...Object.fromEntries(url.searchParams) });
  consulta.delete("ok");
  consulta.delete("error");
  const aviso = g.lineasSinCosto
    ? `<section class="panel-tarjeta" style="margin:18px 0;display:flex;gap:14px;align-items:flex-start">${insignia("alerta", "aviso")}<div><b>Hay ventas sin costo</b><p class="suave" style="margin:4px 0 0;line-height:1.5">${numero(g.lineasSinCosto)} ${g.lineasSinCosto === 1 ? "producto vendido no tiene" : "productos vendidos no tienen"} costo, así que su ganancia no se cuenta (solo se cuenta el ${g.cobertura} % de lo vendido). Ponle el costo (Inventario › Editar) y se suma solo, también a las ventas de antes.</p>${
        g.productos.some((p) => p.sin_costo)
          ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">${g.productos.filter((p) => p.sin_costo).map((p) => `<a class="boton suave" href="/panel/inventario/p/${p.id}">${esc(p.titulo)} · poner el costo</a>`).join("")}</div>`
          : ""
      }</div></section>`
    : "";
  const porDia = new Map();
  for (const v of g.ventas) {
    const d = diaDe(v.creado);
    if (!porDia.has(d)) porDia.set(d, []);
    porDia.get(d).push(v);
  }
  const fila = (v) => `<a class="fila" href="/panel/ventas/${v.id}">${insignia("sube", v.ganancia > 0 ? "bien" : "neutro")}<div class="fila-centro"><div class="fila-titulo">Venta #${v.id}${v.cliente ? ` · ${esc(v.cliente)}` : ""}</div><div class="fila-sub" style="white-space:normal">${esc(horaCorta(v.creado))} · ${numero(v.unidades)} ${v.unidades === 1 ? "unidad" : "unidades"} · vendida por ${v.total === null ? "—" : esc(plata(v.total, { siempre: true }))}${v.sin_costo ? " · sin costo cargado" : ""}</div></div><b class="${v.ganancia > 0 ? "bien" : ""}">${v.sin_costo && !v.ganancia ? "—" : esc(plata(v.ganancia, { siempre: true }))}</b></a>`;
  const lista = g.ventas.length
    ? [...porDia.entries()]
        .map(([dia, ventas]) => `<div class="dia-titulo"><b>${esc(diaBonito(dia, hoy))}</b><span>${esc(plata(ventas.reduce((a, v) => a + v.ganancia, 0), { siempre: true }))} de ganancia · ${ventas.length} ${ventas.length === 1 ? "venta" : "ventas"}</span></div><div class="filas">${ventas.map(fila).join("")}</div>`)
        .join("")
    : vacio({ icono: "sube", titulo: `Sin ventas ${periodo.nombre}`, texto: "Cada venta que cobres en la Caja aparece aquí con lo que ganaste.", acciones: `<a class="boton principal" href="/panel/caja">${icono("caja")}Abrir la caja</a>` });
  const productos = g.productos.length
    ? `<section class="panel-tarjeta" style="margin:18px 0"><h2>${insignia("etiqueta", "marca", "chica")}Lo que más ganancia deja</h2>${reparto(g.productos.slice(0, 8), { nombre: (p) => `${p.titulo} · ${numero(p.unidades)} ${p.unidades === 1 ? "unidad" : "unidades"}${p.sin_costo ? " (sin costo)" : ""}`, valor: (p) => Math.max(0, p.ganancia), ico: () => "sube" })}</section>`
    : "";
  return `${tostadaDesde(url)}${cabecera({
    volver: { href: "/panel/reportes", texto: "Reportes" },
    sobre: "Tu negocio",
    titulo: "Ganancias",
    texto: `Lo que ganaste ${esc(periodo.nombre)}: el precio de venta menos el costo de cada producto, venta por venta.`,
    acciones: `<a class="boton suave" href="/panel/ganancias.csv?${esc(consulta.toString())}">${icono("bajar")}Excel</a>`,
  })}
<div class="herramientas">${selectorDePeriodo("/panel/ganancias", periodo)}</div>
<div class="mosaico">${dato("Ganancia total", cifra(g.ganancia), "sube", "bien", `${numero(g.ventas.length)} ${g.ventas.length === 1 ? "venta" : "ventas"}${g.lineasSinCosto ? ` · falta el costo de ${numero(g.lineasSinCosto)} ${g.lineasSinCosto === 1 ? "producto" : "productos"}` : " · todo con costo"}`)}${dato("Vendido", cifra(g.vendido), "ventas", "marca")}${dato("Margen", `${esc(String(g.margen).replace(".", ","))} %`, "porcentaje", "marca", "ganancia sobre lo vendido con costo")}</div>
${aviso}${productos}${lista}`;
}

/* ── INICIO ──────────────────────────────────────────────────────────── */

async function primerosPasos(db) {
  const fila = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM inv_productos WHERE activo = 1) AS productos,
              (SELECT COUNT(*) FROM inv_ventas) AS ventas,
              (SELECT COUNT(*) FROM neg_gastos WHERE borrado = 0) AS gastos`
    )
    .first();
  return { productos: Number(fila?.productos) || 0, ventas: Number(fila?.ventas) || 0, gastos: Number(fila?.gastos) || 0 };
}

async function paginaDeInicio(env, url, { tienda }) {
  await asegurarNegocio(env.DB);
  const periodo = periodoDe(url.searchParams);
  const hoy = diaDe(Date.now());
  const [actual, anterior, acabando, pasos] = await Promise.all([
    resumen(env.DB, periodo),
    resumen(env.DB, anteriorDe(periodo)),
    seEstanAcabando(env.DB),
    primerosPasos(env.DB),
  ]);
  const lista = consejos({ actual, anterior, acabando, periodo });

  const variosDias = periodo.dias > 1;
  const derechaDelHeroe = variosDias
    ? `<div><div class="sobre" style="color:var(--suave)">Ventas por día</div>${columnas(actual.dias, hoy)}</div>`
    : actual.porMetodo.length
      ? `<div><div class="sobre" style="color:var(--suave)">Cómo te pagaron</div>${reparto(actual.porMetodo.slice(0, 4), { nombre: (m) => m.metodo, valor: (m) => m.total, ico: (m) => iconoDeMetodo(m.metodo) })}</div>`
      : `<div class="heroe-nota" style="justify-content:flex-end"><a class="boton principal" href="/panel/caja">${icono("caja")}Abrir la caja</a></div>`;
  const ganancia = actual.ganancia.cobertura > 0 ? cifra(actual.ganancia.monto) : "—";

  const heroe = `<section class="heroe">
<div class="heroe-fila"><div><div class="sobre">Balance de ${esc(periodo.nombre)}</div>
<div class="heroe-cifra${actual.balance < 0 ? " negativo" : ""}">${cifra(actual.balance)}</div>
<div class="heroe-nota">${cambioEnVentas(actual, anterior, periodo)}</div></div>${derechaDelHeroe}</div>
<div class="heroe-datos">
<div><span><i style="background:#8cc6ff"></i>Cobrado</span><b>${cifra(actual.cobrado)}</b></div>
<div><span><i style="background:#ff9d9d"></i>Gastos</span><b>${cifra(actual.gastos.total)}</b></div>
<div title="${actual.ganancia.cobertura && actual.ganancia.cobertura < 100 ? `Calculada con el ${actual.ganancia.cobertura}% de lo vendido: el resto no tiene costo cargado.` : "Precio de venta menos costo de lo vendido."}"><span><i style="background:#5cf0b0"></i>Ganancia</span><b>${ganancia}</b></div>
</div></section>`;

  const dato = (nombre, valor, pie, ico, tono = "marca", href = "") =>
    `<${href ? `a href="${href}"` : "div"} class="dato"><div class="dato-cima"><span class="dato-nombre">${esc(nombre)}</span>${insignia(ico, tono, "chica")}</div><div class="dato-valor">${valor}</div>${pie ? `<div class="dato-pie">${pie}</div>` : ""}</${href ? "a" : "div"}>`;
  const datos = `<div class="mosaico" style="margin-top:18px">
${dato("Ventas", cifra(actual.ventas.cantidad, { tipo: "numero" }), `${esc(plata(actual.ventas.total, { siempre: true }))} vendido`, "ventas", "marca", `/panel/ventas?p=${periodo.clave === "a-medida" ? "hoy" : periodo.clave}`)}
${dato("Ticket promedio", cifra(actual.ventas.ticketPromedio), "por venta", "recibo")}
${dato("Unidades", cifra(actual.ventas.unidades, { tipo: "numero" }), "productos que salieron", "inventario")}
${dato("Ganancia", cifra(actual.ganancia.monto), "ver todas las ganancias", "sube", "bien", "/panel/ganancias")}
</div>`;

  const rapidos = `<div class="rapidos">
<a class="rapido principal" href="/panel/caja">${insignia("caja")}<span><b>Nueva venta</b><small>Cobrar en la caja</small></span></a>
<a class="rapido" href="/panel/gastos#nuevo">${insignia("gastos", "mal")}<span><b>Registrar gasto</b><small>Lo que salió hoy</small></span></a>
<a class="rapido" href="/panel/reportes">${insignia("recibo", "aviso")}<span><b>Reporte del día</b><small>Para cerrar la caja</small></span></a>
<a class="rapido" href="/panel/inventario/nuevo">${insignia("inventario", "bien")}<span><b>Nuevo producto</b><small>Con su código</small></span></a>
</div>`;

  const faltan = [
    !pasos.productos && ["inventario", "Carga tus productos", "Tráelos del catálogo o de un Excel, y cada uno recibe su código de barras.", "/panel/inventario/importar"],
    !pasos.ventas && ["caja", "Cobra tu primera venta", "En la Caja, con un lector, la cámara del teléfono o escribiendo el nombre.", "/panel/caja"],
    !pasos.gastos && ["gastos", "Anota un gasto", "Así el balance dice cuánto te queda de verdad.", "/panel/gastos#nuevo"],
  ].filter(Boolean);
  const bienvenida = faltan.length
    ? `<section class="panel-tarjeta"><h2>${insignia("rayo", "ia", "chica")}Primeros pasos</h2><div class="filas">${faltan
        .map(([ico, titulo, texto, href]) => `<a class="fila" href="${href}">${insignia(ico)}<div class="fila-centro"><div class="fila-titulo">${esc(titulo)}</div><div class="fila-sub" style="white-space:normal">${esc(texto)}</div></div>${icono("adelante", { clase: "flecha" })}</a>`)
        .join("")}</div></section>`
    : "";

  const sugerencias = ["¿Cuánto vendí esta semana?", "¿Qué se está acabando?", "¿Quién me debe más?", "Dame una idea para vender más"];
  const asistente = `<section class="ia-tarjeta" id="asistente">
<div class="ia-cabeza"><span class="ia-marca">${icono("ia")}</span><div><h2>Pregúntale a tu negocio</h2><p>Lee tus números de verdad y sabe cómo se hace todo en el panel. Si le pides anotar un gasto o un abono, te lo deja listo para que lo confirmes. También lo tienes en el botón <b>Asistente</b> de cada pantalla.</p></div></div>
<div class="ia-charla" id="ia-charla" data-ia-charla aria-live="polite"></div>
${
  asistenteActivo(env)
    ? `<div class="ia-sugerencias">${sugerencias.map((t) => `<button type="button" data-pregunta="${esc(t)}">${esc(t)}</button>`).join("")}</div>
<form class="ia-preguntar" id="ia-form" data-ia-form method="post" action="/panel/asistente"><input name="pregunta" placeholder="Pregunta o pide algo: «gasté 20 en transporte»" autocomplete="off" maxlength="500" required><button class="principal" aria-label="Preguntar">${icono("enviar")}</button></form>`
    : `<p class="suave">El asistente usa la misma IA del bot. Falta su clave en esta tienda.</p>`
}
</section>`;

  const recomendaciones = lista.length
    ? `<section class="panel-tarjeta"><h2>${insignia("idea", "ia", "chica")}ALPHA IA te recomienda</h2><div class="consejos">${lista
        .map((c) => {
          const cuerpo = `${insignia(c.icono || "info", c.tono || "marca")}<span>${esc(c.texto)}</span>`;
          return c.enlace ? `<a class="consejo" href="${esc(c.enlace)}">${cuerpo}${icono("adelante", { clase: "flecha" })}</a>` : `<div class="consejo">${cuerpo}</div>`;
        })
        .join("")}</div></section>`
    : "";

  const maxUnidades = Math.max(1, ...actual.masVendidos.map((m) => m.unidades));
  const masVendidos = `<section class="panel-tarjeta"><div class="seccion"><h2>${insignia("ganadores", "bien", "chica")}Lo más vendido</h2><a href="/panel/ventas?p=${esc(periodo.clave === "a-medida" ? "30" : periodo.clave)}">Ventas${icono("adelante", { clase: "chico" })}</a></div>${
    actual.masVendidos.length
      ? `<div class="filas">${actual.masVendidos
          .slice(0, 5)
          .map(
            (m, i) =>
              `<a class="fila" href="/panel/inventario/p/${m.id}"><span class="puesto${i < 3 ? ` p${i + 1}` : ""}">${i + 1}</span><div class="fila-centro"><div class="fila-titulo">${esc(m.titulo)}</div><div class="progreso"><i style="width:${Math.round((m.unidades / maxUnidades) * 100)}%"></i></div></div><div class="fila-fin"><b>${numero(m.unidades)}</b><small>${esc(plata(m.monto, { siempre: true }))}</small></div></a>`
          )
          .join("")}</div>`
      : `<p class="suave" style="margin:0">Cuando vendas en la Caja, aquí verás lo que más sale ${esc(periodo.nombre)}.</p>`
  }</section>`;

  const seAcaba = acabando.length
    ? `<section class="panel-tarjeta"><div class="seccion"><h2>${insignia("inventario", "aviso", "chica")}Se está acabando</h2><a href="/panel/inventario?f=pocos">Inventario${icono("adelante", { clase: "chico" })}</a></div><div class="filas">${acabando
        .slice(0, 5)
        .map(
          (a) =>
            `<a class="fila" href="/panel/inventario/p/${a.producto_id}"><div class="fila-centro"><div class="fila-titulo">${esc(a.titulo)}${a.opcion && a.opcion !== "única" ? ` <span class="suave">${esc(a.opcion)}</span>` : ""}</div><div class="fila-sub">Vendiste ${numero(a.vendidas)} en 30 días</div></div>${pastillaDeStock(a.quedan)}</a>`
        )
        .join("")}</div></section>`
    : "";

  const metodos =
    variosDias && actual.porMetodo.length
      ? `<section class="panel-tarjeta"><h2>${insignia("efectivo", "marca", "chica")}Cómo te pagaron</h2>${reparto(actual.porMetodo.slice(0, 6), { nombre: (m) => m.metodo, valor: (m) => m.total, ico: (m) => iconoDeMetodo(m.metodo) })}</section>`
      : "";

  return `${tostadaDesde(url)}${cabecera({ sobre: fechaLarga(), titulo: saludo(), texto: `Así va <b>${esc(tienda)}</b> ${esc(periodo.nombre)}.`, acciones: selectorDePeriodo("/panel/inicio", periodo) })}
${heroe}
${datos}
${rapidos}
<div class="dos" style="margin-top:22px"><div>${bienvenida}${asistente}${recomendaciones}</div><div>${masVendidos}${tarjetaDeCategorias(actual.porCategoria)}${tarjetaDeCashea(actual.cashea)}${seAcaba}${metodos}</div></div>`;
}

// EL ASISTENTE en la página: la charla y su script viven en asistente.js
// (es la misma en la tarjeta de Inicio y en el botón flotante de todo el
// panel, y marco.js pone el script en cada página).

/* ── VENTAS ──────────────────────────────────────────────────────────── */

function filaDeVenta(v) {
  const metodo = v.metodo_pago || "Sin decir";
  const estado = v.anulada ? '<span class="chip mal">Anulada</span>' : "";
  const sub = [`#${v.id}`, horaCorta(v.creado), anotadaDespues(v) ? "anotada después" : "", metodo, v.cliente].filter(Boolean).map(esc).join(" · ");
  return `<a class="fila${v.anulada ? " tachada" : ""}" href="/panel/ventas/${v.id}">${insignia(iconoDeMetodo(metodo), v.anulada ? "neutro" : "marca")}<div class="fila-centro"><div class="fila-titulo">${esc(v.detalle || `Venta #${v.id}`)}</div><div class="fila-sub">${sub}</div></div><div class="fila-fin"><b>${v.total === null ? "—" : esc(plata(v.total, { siempre: true }))}</b>${estado ? `<small>${estado}</small>` : ""}</div></a>`;
}

async function paginaDeVentas(env, url) {
  const periodo = periodoDe(url.searchParams);
  const q = String(url.searchParams.get("q") || "").slice(0, 40);
  const [ventas, r] = await Promise.all([listarVentas(env.DB, { ...periodo, q }), resumen(env.DB, periodo)]);
  const hoy = diaDe(Date.now());
  const porDia = new Map();
  for (const v of ventas) {
    const d = diaDe(v.creado);
    if (!porDia.has(d)) porDia.set(d, []);
    porDia.get(d).push(v);
  }
  const extra = q ? { q } : {};
  const consulta = new URLSearchParams({ ...Object.fromEntries(url.searchParams) });
  consulta.delete("ok");
  consulta.delete("error");
  const lista = ventas.length
    ? [...porDia.entries()]
        .map(([dia, lista]) => {
          const total = lista.filter((v) => !v.anulada).reduce((a, v) => a + (Number(v.total) || 0), 0);
          return `<div class="dia-titulo"><b>${esc(diaBonito(dia, hoy))}</b><span>${esc(plata(total, { siempre: true }))} · ${lista.length} ${lista.length === 1 ? "venta" : "ventas"}</span></div><div class="filas">${lista.map(filaDeVenta).join("")}</div>`;
        })
        .join("")
    : vacio({
        icono: "ventas",
        titulo: q ? "No encontré ventas con eso" : `Sin ventas ${periodo.nombre}`,
        texto: q ? "Busca por el nombre del cliente, su teléfono o el número de la venta." : "Cada venta que cobres en la Caja aparece aquí, con su recibo.",
        acciones: q ? "" : `<a class="boton principal" href="/panel/caja">${icono("caja")}Abrir la caja</a>`,
      });
  const dato = (nombre, valor, ico, tono = "marca", pie = "") => `<div class="dato"><div class="dato-cima"><span class="dato-nombre">${esc(nombre)}</span>${insignia(ico, tono, "chica")}</div><div class="dato-valor">${valor}</div>${pie ? `<div class="dato-pie">${pie}</div>` : ""}</div>`;
  return `${tostadaDesde(url)}${cabecera({
    sobre: "Tu negocio",
    titulo: "Ventas",
    texto: "Todo lo que cobraste en la Caja, con su recibo para imprimir o mandar por WhatsApp.",
    acciones: `<a class="boton suave" href="/panel/ventas.csv?${esc(consulta.toString())}">${icono("bajar")}Excel</a><a class="boton principal" href="/panel/caja">${icono("mas")}Nueva venta</a>`,
  })}
<div class="herramientas">${selectorDePeriodo("/panel/ventas", periodo, extra)}</div>
<div class="mosaico">${dato("Vendido", cifra(r.ventas.total), "ventas", "marca", `${numero(r.ventas.cantidad)} ${r.ventas.cantidad === 1 ? "venta" : "ventas"}`)}${dato("Cobrado", cifra(r.cobrado), "efectivo", "bien", "de contado")}${dato("Ticket promedio", cifra(r.ventas.ticketPromedio), "recibo")}</div>
${q ? "" : tarjetaDeCategorias(r.porCategoria, { conPista: true })}${q ? "" : tarjetaDeCashea(r.cashea)}
<form class="herramientas" method="get" action="/panel/ventas"><input type="hidden" name="p" value="${esc(periodo.clave === "a-medida" ? "hoy" : periodo.clave)}">${periodo.clave === "a-medida" ? `<input type="hidden" name="desde" value="${esc(periodo.desdeDia)}"><input type="hidden" name="hasta" value="${esc(periodo.hastaDia)}">` : ""}<label class="buscador">${icono("buscar")}<input name="q" value="${esc(q)}" placeholder="Cliente, teléfono o número de venta"></label><button>Buscar</button></form>
${lista}`;
}

async function paginaDeRecibo(env, id, url, { tienda }) {
  const venta = await verVenta(env.DB, id);
  if (!venta) return null;
  const texto = textoDelRecibo(venta, tienda);
  const lineas = [
    ...venta.lineas.map((l) => `<div class="linea"><div><b>${esc(l.titulo)}</b><small>${numero(l.cantidad)} × ${l.precio === null ? "sin precio" : esc(plata(l.precio))}${detalleDeLinea(l) ? ` · ${esc(detalleDeLinea(l))}` : ""}</small></div><b>${l.precio === null ? "—" : esc(plata(l.precio * l.cantidad))}</b></div>`),
    ...venta.libres.map((l) => `<div class="linea"><div><b>${esc(l.descripcion)}</b><small>${numero(l.cantidad)} × ${esc(plata(l.precio))} · sin inventario</small></div><b>${esc(plata(l.precio * l.cantidad))}</b></div>`),
  ].join("");
  const recibo = `<div class="recibo" id="recibo">${venta.anulada ? '<div class="anulada-sello">ANULADA</div>' : ""}
<h2>${esc(tienda)}</h2><div class="recibo-sub">Recibo #${venta.id} · ${esc(fechaHora(venta.creado))}${anotadaDespues(venta) ? `<br>Anotada el ${esc(fechaHora(venta.registrada))}` : ""}${venta.cliente ? `<br>Cliente: ${esc(venta.cliente)}` : ""}</div>
${lineas || '<p class="recibo-sub">Sin productos.</p>'}
<div class="total"><span>Total</span><span>${venta.total === null ? "por confirmar" : esc(plata(venta.total, { siempre: true }))}</span></div>
${venta.tarifa === "cashea" ? '<div class="recibo-sub" style="margin:6px 0 0;text-align:right">Precio Cashea</div>' : ""}
<div class="pie">${serialDe(venta.nota) ? `${esc(serialDe(venta.nota))}<br>` : ""}${casheaDe(venta.nota) ? `${esc(casheaDe(venta.nota))}<br>` : ""}${esc(venta.metodo_pago || "")}${venta.sede ? ` · ${esc(venta.sede)}` : ""}<br>¡Gracias por tu compra!</div></div>`;

  const idAnular = "anular-venta";
  const anular = venta.anulada
    ? ""
    : ventana(idAnular, {
        titulo: `¿Anular la venta #${venta.id}?`,
        icono: "deshacer",
        tono: "mal",
        texto: "Los productos vuelven al stock de la sede donde salieron y la venta deja de sumar. No se borra: queda marcada como anulada.",
        cuerpo: `<form method="post" action="/panel/ventas/anular" data-quien><input type="hidden" name="venta" value="${venta.id}"><label class="campo" style="margin-top:14px">Motivo (opcional)<input name="motivo" maxlength="200" placeholder="Se cobró dos veces, devolvió todo…"></label><div class="acciones">${botonCerrarVentana(idAnular)}<button class="peligro">${icono("deshacer")}Anular venta</button></div></form>`,
      });

  const detalles = `<section class="panel-tarjeta"><h2>${insignia("recibo", "marca", "chica")}Detalles</h2><div class="filas">
<div class="fila">${insignia(iconoDeMetodo(venta.metodo_pago), "neutro", "chica")}<div class="fila-centro"><div class="fila-sub">Pago</div><div class="fila-titulo">${esc(venta.metodo_pago || "Sin decir")}</div></div></div>
${venta.cliente || venta.telefono ? `<div class="fila">${avatar(venta.cliente || venta.telefono, { clase: "chico" })}<div class="fila-centro"><div class="fila-sub">Cliente</div><div class="fila-titulo">${esc(venta.cliente || "—")}${venta.telefono ? ` <span class="suave">${esc(venta.telefono)}</span>` : ""}</div></div></div>` : ""}
<div class="fila">${insignia("sede", "neutro", "chica")}<div class="fila-centro"><div class="fila-sub">Sede</div><div class="fila-titulo">${esc(venta.sede || "—")}</div></div></div>
${venta.quien ? `<div class="fila">${insignia("usuario", "neutro", "chica")}<div class="fila-centro"><div class="fila-sub">Cobró</div><div class="fila-titulo">${esc(venta.quien)}</div></div></div>` : ""}
${venta.nota ? `<div class="fila">${insignia("editar", "neutro", "chica")}<div class="fila-centro"><div class="fila-sub">Nota</div><div class="fila-titulo" style="white-space:normal">${esc(venta.nota)}</div></div></div>` : ""}
</div></section>`;

  return `${tostadaDesde(url)}${cabecera({
    volver: { href: "/panel/ventas", texto: "Ventas" },
    sobre: fechaHora(venta.creado),
    titulo: `Venta #${venta.id}`,
    acciones: `<div class="no-imprimir" style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" onclick="print()">${icono("imprimir")}Imprimir</button><a class="boton" href="${esc(enlaceWhatsapp(venta.telefono, texto))}" target="_blank" rel="noopener">${icono("enviar")}WhatsApp</a>${venta.anulada ? "" : `<button type="button" class="peligro" popovertarget="${idAnular}">${icono("deshacer")}Anular</button>`}</div>`,
  })}
<div class="dos"><div>${recibo}</div><div class="no-imprimir">${detalles}</div></div>${anular}`;
}

/* ── GASTOS ──────────────────────────────────────────────────────────── */

async function paginaDeGastos(env, url) {
  const periodo = periodoDe(url.searchParams);
  const [gastos, r] = await Promise.all([listarGastos(env.DB, periodo), resumen(env.DB, periodo)]);
  const hoy = diaDe(Date.now());
  const porDia = new Map();
  for (const g of gastos) {
    const d = diaDe(g.fecha);
    if (!porDia.has(d)) porDia.set(d, []);
    porDia.get(d).push(g);
  }
  const consulta = new URLSearchParams({ ...Object.fromEntries(url.searchParams) });
  consulta.delete("ok");
  consulta.delete("error");
  const volver = `/panel/gastos?${consulta.toString()}`;
  const formulario = `<section class="panel-tarjeta" id="nuevo"><h2>${insignia("mas", "marca", "chica")}Registrar un gasto</h2>
<form method="post" action="/panel/gastos/nuevo" data-quien><input type="hidden" name="volver" value="${esc(volver)}">
<label class="campo">Cuánto<div class="monto"><span>$</span><input name="monto" inputmode="decimal" placeholder="0" required autocomplete="off"></div></label>
<div class="campo" style="margin-top:16px">En qué<div class="opciones">${CATEGORIAS_DE_GASTO.map(
    (c, i) => `<label class="opcion"><input type="radio" name="categoria" value="${esc(c)}"${i === 0 ? " checked" : ""}>${icono(ICONO_DE_CATEGORIA[c] || "puntos")}${esc(c.replace(/\s*\(.*\)$/, ""))}</label>`
  ).join("")}</div></div>
<div class="campos" style="margin-top:16px"><label class="campo">Detalle (opcional)<input name="descripcion" maxlength="200" placeholder="Taxi al proveedor, recibo de luz…"></label>
<label class="campo">Cómo se pagó<select name="metodo"><option value="">Sin especificar</option>${METODOS_DE_PAGO.map((m) => `<option>${esc(m)}</option>`).join("")}</select></label>
<label class="campo">Fecha<input type="date" name="fecha" value="${esc(hoy)}" max="${esc(hoy)}"></label></div>
<div class="acciones" style="margin-top:18px"><button class="principal" style="min-width:200px">${icono("check")}Guardar gasto</button></div></form></section>`;

  const resumenGastos = `<section class="heroe" style="margin-bottom:18px"><div class="sobre">Gastaste ${esc(periodo.nombre)}</div><div class="heroe-cifra">${cifra(r.gastos.total)}</div>
<div class="heroe-nota" style="margin-bottom:${r.gastos.porCategoria.length ? "20px" : "0"}">${r.cobrado ? `<span>Cobraste ${esc(plata(r.cobrado))}: te ${r.balance >= 0 ? "quedan" : "faltan"} <b style="color:#fff">${esc(plata(Math.abs(r.balance), { siempre: true }))}</b></span>` : "<span>Sin cobros en este período.</span>"}</div>
${r.gastos.porCategoria.length ? reparto(r.gastos.porCategoria, { nombre: (g) => g.categoria, valor: (g) => g.total, ico: (g) => ICONO_DE_CATEGORIA[g.categoria] || "puntos" }) : ""}</section>`;

  const lista = gastos.length
    ? [...porDia.entries()]
        .map(([dia, lista]) => {
          const total = lista.reduce((a, g) => a + Number(g.monto), 0);
          return `<div class="dia-titulo"><b>${esc(diaBonito(dia, hoy))}</b><span>${esc(plata(total, { siempre: true }))}</span></div><div class="filas">${lista
            .map(
              (g) =>
                `<div class="fila">${insignia(ICONO_DE_CATEGORIA[g.categoria] || "puntos", "neutro")}<div class="fila-centro"><div class="fila-titulo">${esc(g.descripcion || g.categoria)}</div><div class="fila-sub">${[g.descripcion ? g.categoria : "", g.metodo, g.quien].filter(Boolean).map(esc).join(" · ") || "&nbsp;"}</div></div><div class="fila-fin"><b>${esc(plata(g.monto))}</b></div>
<form method="post" action="/panel/gastos/borrar" data-confirmar="¿Borrar este gasto de ${esc(plata(g.monto))}?" data-confirmar-boton="Borrar" data-peligro><input type="hidden" name="id" value="${g.id}"><input type="hidden" name="volver" value="${esc(volver)}"><button class="borrar-mini fantasma icono chico" title="Borrar" aria-label="Borrar">${icono("borrar")}</button></form></div>`
            )
            .join("")}</div>`;
        })
        .join("")
    : vacio({ icono: "gastos", titulo: `Sin gastos ${periodo.nombre}`, texto: "Anota lo que sale (alquiler, mercancía, transporte…) y el balance del Inicio dirá cuánto te queda de verdad." });

  return `${tostadaDesde(url)}${cabecera({
    sobre: "Tu negocio",
    titulo: "Gastos",
    texto: "Lo que sale del negocio. Se anota en segundos y aquí ves en qué se va.",
    acciones: `<a class="boton suave" href="/panel/gastos.csv?${esc(consulta.toString())}">${icono("bajar")}Excel</a>`,
  })}
<div class="herramientas">${selectorDePeriodo("/panel/gastos", periodo)}</div>
<div class="dos"><div>${formulario}</div><div>${resumenGastos}</div></div>
<div class="seccion"><h2>${icono("lista")}Lo que salió</h2></div>
${lista}`;
}

export function esRutaDeNegocio(url) {
  const r = url.pathname;
  return (
    r === "/panel/inicio" ||
    r === "/panel/ventas" ||
    r.startsWith("/panel/ventas/") ||
    r === "/panel/ventas.csv" ||
    r === "/panel/reportes" ||
    r === "/panel/ganancias" ||
    r === "/panel/ganancias.csv" ||
    r === "/panel/reportes.csv" ||
    r === "/panel/gastos" ||
    r.startsWith("/panel/gastos/") ||
    r === "/panel/gastos.csv" ||
    r === "/panel/asistente"
  );
}

// helpers: { pagina(titulo, cuerpo, extra), vieneDelPanel(request, url), redirigir(a) }
export async function atenderNegocio(request, env, url, helpers, opciones = {}) {
  const { pagina, vieneDelPanel, redirigir } = helpers;
  const tienda = opciones.tienda || "La tienda";
  const r = url.pathname;
  await asegurarNegocio(env.DB);

  if (request.method === "POST") {
    if (!vieneDelPanel(request, url)) return new Response("No", { status: 403 });
    return atenderPost(request, env, url, { redirigir, tienda, rubro: opciones.rubro || "", tarifaDeCaja: opciones.tarifaDeCaja || "", conAnuncios: opciones.conAnuncios !== false });
  }

  if (r === "/panel/inicio") return pagina("Inicio", await paginaDeInicio(env, url, { tienda }), { ruta: "inicio" });
  if (r === "/panel/ventas") return pagina("Ventas", await paginaDeVentas(env, url), { ruta: "ventas" });
  if (r.startsWith("/panel/ventas/")) {
    const cuerpo = await paginaDeRecibo(env, r.slice("/panel/ventas/".length), url, { tienda });
    return cuerpo ? pagina("Recibo", cuerpo, { ruta: "ventas" }) : redirigir(conAviso("/panel/ventas", { error: "Esa venta no existe." }));
  }
  if (r === "/panel/ganancias") return pagina("Ganancias", await paginaDeGanancias(env, url), { ruta: "ganancias" });
  if (r === "/panel/reportes") return pagina("Reportes", await paginaDeReporte(env, url, { tienda }), { ruta: "reportes" });
  if (r === "/panel/gastos") return pagina("Gastos", await paginaDeGastos(env, url), { ruta: "gastos" });

  const fecha = diaDe(Date.now());
  if (r === "/panel/ventas.csv") {
    const periodo = periodoDe(url.searchParams);
    const ventas = await listarVentas(env.DB, { ...periodo, q: url.searchParams.get("q") || "", limite: 2000 });
    return respuestaCsv(
      `ventas-${periodo.desdeDia}-a-${periodo.hastaDia}.csv`,
      aCsv(
        ["Venta", "Fecha", "Hora", "Cliente", "Teléfono", "Productos", "Método de pago", "Total", "Anulada", "Sede", "Cobró"],
        ventas.map((v) => [
          v.id,
          diaDe(v.creado),
          horaCorta(v.creado),
          v.cliente,
          v.telefono,
          v.detalle,
          v.metodo_pago,
          v.total ?? "",
          v.anulada ? "sí" : "no",
          v.sede || "",
          v.quien,
        ])
      )
    );
  }
  if (r === "/panel/ganancias.csv") {
    const periodo = periodoDe(url.searchParams);
    const g = await gananciasDelPeriodo(env.DB, periodo);
    return respuestaCsv(
      `ganancias-${periodo.desdeDia}-a-${periodo.hastaDia}.csv`,
      aCsv(["Venta", "Fecha", "Hora", "Cliente", "Unidades", "Vendido", "Ganancia", "Productos sin costo"], g.ventas.map((v) => [v.id, diaDe(v.creado), horaCorta(v.creado), v.cliente, v.unidades, v.total ?? "", v.ganancia, v.sin_costo]))
    );
  }
  if (r === "/panel/reportes.csv") {
    const periodo = periodoDe(url.searchParams);
    const rep = await reporteDelPeriodo(env.DB, periodo);
    const filas = [
      ["Ventas", rep.ventas.cantidad, rep.ventas.total],
      ["Cobrado", "", rep.cobrado],
      ["Gastos", "", rep.gastos.total],
      ["Balance", "", rep.balance],
      ...rep.porMetodo.map((m) => [`Pago: ${m.metodo}`, m.cantidad, m.total]),
      ["Cashea: ventas", rep.cashea.ventas, rep.cashea.total],
      ["Cashea: inicial cobrada", "", rep.cashea.inicial],
      ...rep.cashea.porMetodo.map((m) => [`Cashea inicial por ${m.metodo}`, m.cantidad, m.monto]),
      ["Cashea: monto financiado", "", rep.cashea.financiado],
    ];
    const ventasCashea = rep.cashea.lista.map((v) => [`Venta #${v.id}`, diaDe(v.creado), v.cliente, v.nivel === "libre" ? "Inicial libre" : `Nivel ${v.nivel}`, v.pct, v.total, v.inicial, v.inicial_por, v.financiado, v.cuotas]);
    return respuestaCsv(
      `reporte-${periodo.desdeDia}-a-${periodo.hastaDia}.csv`,
      aCsv(["Concepto", "Cantidad", "Monto"], filas) + "\r\n" + aCsv(["Venta con Cashea", "Fecha", "Cliente", "Nivel", "% inicial", "Total", "Inicial cobrada", "Inicial pagada con", "Monto financiado", "Cuotas"], ventasCashea).replace("\uFEFF", "")
    );
  }
  if (r === "/panel/gastos.csv") {
    const periodo = periodoDe(url.searchParams);
    const gastos = await listarGastos(env.DB, { ...periodo, limite: 2000 });
    return respuestaCsv(
      `gastos-${periodo.desdeDia}-a-${periodo.hastaDia}.csv`,
      aCsv(["Fecha", "Categoría", "Detalle", "Método", "Monto", "Quién"], gastos.map((g) => [diaDe(g.fecha), g.categoria, g.descripcion, g.metodo, g.monto, g.quien]))
    );
  }
  return redirigir("/panel/inicio");
}

async function leerDatos(request) {
  if (/application\/json/.test(request.headers.get("content-type") || "")) {
    const d = await request.json().catch(() => ({}));
    return { get: (k) => (d?.[k] === undefined || d?.[k] === null ? null : d[k]), crudo: d };
  }
  const f = await request.formData().catch(() => null);
  return { get: (k) => f?.get(k) ?? null, crudo: null };
}

async function atenderPost(request, env, url, { redirigir, tienda, rubro = "", tarifaDeCaja = "", conAnuncios = true }) {
  const r = url.pathname;
  const datos = await leerDatos(request);
  const enJson = quiereJson(request);
  const quien = String(datos.get("quien") || "").trim().slice(0, 60);
  const responder = (volver, { ok = "", error = "" }) =>
    enJson ? json(error ? { ok: false, error } : { ok: true, mensaje: ok }, error ? 400 : 200) : redirigir(conAviso(volver, error ? { error } : { ok }));

  if (r === "/panel/asistente") {
    const pregunta = String(datos.get("pregunta") || "");
    const historial = Array.isArray(datos.crudo?.historial) ? datos.crudo.historial.slice(-6) : [];
    try {
      const pantalla = String(datos.get("pantalla") || "").slice(0, 30);
      const respuesta = await preguntarAlAsistente(env, pregunta, { tienda, historial, rubro, pantalla, tarifaDeCaja, conAnuncios });
      return json({ ok: true, ...respuesta });
    } catch (error) {
      return json({ ok: false, error: error.message }, 400);
    }
  }

  if (r === "/panel/gastos/nuevo") {
    const volver = volverSeguro(datos.get("volver"), "/panel/gastos");
    try {
      const monto = await registrarGasto(env.DB, {
        categoria: String(datos.get("categoria") || ""),
        descripcion: String(datos.get("descripcion") || ""),
        monto: datos.get("monto"),
        metodo: String(datos.get("metodo") || ""),
        quien,
        fecha: datos.get("fecha"),
      });
      console.log(`NEGOCIO: gasto de ${monto} (${datos.get("categoria")}) por ${quien || "—"}`);
      return responder(volver, { ok: `Gasto de ${plata(monto)} guardado` });
    } catch (error) {
      return responder(volver, { error: error.message });
    }
  }

  if (r === "/panel/gastos/borrar") {
    const volver = volverSeguro(datos.get("volver"), "/panel/gastos");
    await borrarGasto(env.DB, datos.get("id"));
    return responder(volver, { ok: "Gasto borrado" });
  }

  if (r === "/panel/ventas/anular") {
    const id = Number(datos.get("venta")) || 0;
    const volver = `/panel/ventas/${id}`;
    try {
      await anularVenta(env.DB, id, { quien, motivo: String(datos.get("motivo") || "") });
      console.log(`NEGOCIO: venta ${id} anulada por ${quien || "—"}`);
      return responder(volver, { ok: "Venta anulada. Los productos volvieron al stock" });
    } catch (error) {
      return responder(volver, { error: error.message });
    }
  }

  return redirigir("/panel/inicio");
}
