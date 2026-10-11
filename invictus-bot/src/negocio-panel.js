// LAS PANTALLAS DEL NEGOCIO (fase 2, 7-oct-2026): Inicio, Ventas, Gastos,
// Fiados y el asistente. Los números y las reglas viven en negocio.js; aquí
// solo se pintan y se reciben los formularios.
//
//   /panel/inicio            cómo va el negocio hoy (o el período elegido),
//                            consejos de la IA y el asistente
//   /panel/ventas            todo lo cobrado, por día, con su recibo
//   /panel/ventas/<id>       el recibo: imprimir, WhatsApp, anular
//   /panel/gastos            lo que sale, por categoría
//   /panel/fiados            lo que deben los clientes y sus abonos
//   /panel/asistente         (POST) la pregunta al asistente
//   /panel/ventas.csv, /panel/gastos.csv, /panel/fiados.csv   para Excel
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
  listarFiados,
  abonar,
  resumen,
  seEstanAcabando,
  consejos,
  asistenteActivo,
  preguntarAlAsistente,
  claveDeCliente,
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
  return /^\/panel\/(inicio|ventas|gastos|fiados)(\/|\?|#|$)/.test(v) && !v.startsWith("//") ? v : porDefecto;
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
  if (m === "fiado") return "fiados";
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

function reparto(filas, { nombre, valor, ico, max = null }) {
  const tope = max ?? Math.max(1, ...filas.map(valor));
  return `<div class="reparto">${filas
    .map(
      (f, n) =>
        `<div class="reparto-fila" style="--n:${n}">${insignia(ico(f), "marca", "chica")}<span class="reparto-nombre">${esc(nombre(f))}</span><span class="reparto-valor">${esc(plata(valor(f), { siempre: true }))}</span><div class="reparto-barra"><i style="width:${Math.max(2, Math.round((valor(f) / tope) * 100))}%"></i></div></div>`
    )
    .join("")}</div>`;
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
  const [actual, anterior, acabando, fiados, pasos] = await Promise.all([
    resumen(env.DB, periodo),
    resumen(env.DB, anteriorDe(periodo)),
    seEstanAcabando(env.DB),
    listarFiados(env.DB),
    primerosPasos(env.DB),
  ]);
  const deben = fiados.reduce((a, f) => a + f.saldo, 0);
  const lista = consejos({ actual, anterior, acabando, fiados, periodo });

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
${dato("Te deben", cifra(deben), fiados.length ? `${fiados.length} ${fiados.length === 1 ? "cliente" : "clientes"}` : "nadie te debe", "fiados", deben > 0 ? "aviso" : "bien", "/panel/fiados")}
</div>`;

  const rapidos = `<div class="rapidos">
<a class="rapido principal" href="/panel/caja">${insignia("caja")}<span><b>Nueva venta</b><small>Cobrar en la caja</small></span></a>
<a class="rapido" href="/panel/gastos#nuevo">${insignia("gastos", "mal")}<span><b>Registrar gasto</b><small>Lo que salió hoy</small></span></a>
<a class="rapido" href="/panel/fiados">${insignia("fiados", "aviso")}<span><b>Cobrar un fiado</b><small>Anotar un abono</small></span></a>
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
<div class="dos" style="margin-top:22px"><div>${bienvenida}${asistente}${recomendaciones}</div><div>${masVendidos}${seAcaba}${metodos}</div></div>`;
}

// EL ASISTENTE en la página: la charla y su script viven en asistente.js
// (es la misma en la tarjeta de Inicio y en el botón flotante de todo el
// panel, y marco.js pone el script en cada página).

/* ── VENTAS ──────────────────────────────────────────────────────────── */

function filaDeVenta(v) {
  const metodo = v.fiado ? "Fiado" : v.metodo_pago || "Sin decir";
  const saldo = v.fiado && !v.anulada ? Math.max(0, (Number(v.total) || 0) - Number(v.abonado || 0)) : 0;
  const estado = v.anulada
    ? '<span class="chip mal">Anulada</span>'
    : v.fiado
      ? saldo > 0.009
        ? `<span class="chip aviso">Debe ${esc(plata(saldo))}</span>`
        : '<span class="chip bien">Fiado pagado</span>'
      : "";
  const sub = [`#${v.id}`, horaCorta(v.creado), anotadaDespues(v) ? "anotada después" : "", metodo, v.cliente].filter(Boolean).map(esc).join(" · ");
  return `<a class="fila${v.anulada ? " tachada" : ""}" href="/panel/ventas/${v.id}">${insignia(iconoDeMetodo(metodo), v.anulada ? "neutro" : v.fiado ? "aviso" : "marca")}<div class="fila-centro"><div class="fila-titulo">${esc(v.detalle || `Venta #${v.id}`)}</div><div class="fila-sub">${sub}</div></div><div class="fila-fin"><b>${v.total === null ? "—" : esc(plata(v.total, { siempre: true }))}</b>${estado ? `<small>${estado}</small>` : ""}</div></a>`;
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
<div class="mosaico">${dato("Vendido", cifra(r.ventas.total), "ventas", "marca", `${numero(r.ventas.cantidad)} ${r.ventas.cantidad === 1 ? "venta" : "ventas"}`)}${dato("Cobrado", cifra(r.cobrado), "efectivo", "bien", r.abonos ? `incluye ${esc(plata(r.abonos))} de abonos` : "de contado")}${dato("Ticket promedio", cifra(r.ventas.ticketPromedio), "recibo")}${dato("Fiado", cifra(r.ventas.fiado), "fiados", "aviso", "vendido a crédito")}</div>
<form class="herramientas" method="get" action="/panel/ventas"><input type="hidden" name="p" value="${esc(periodo.clave === "a-medida" ? "hoy" : periodo.clave)}">${periodo.clave === "a-medida" ? `<input type="hidden" name="desde" value="${esc(periodo.desdeDia)}"><input type="hidden" name="hasta" value="${esc(periodo.hastaDia)}">` : ""}<label class="buscador">${icono("buscar")}<input name="q" value="${esc(q)}" placeholder="Cliente, teléfono o número de venta"></label><button>Buscar</button></form>
${lista}`;
}

async function paginaDeRecibo(env, id, url, { tienda }) {
  const venta = await verVenta(env.DB, id);
  if (!venta) return null;
  const texto = textoDelRecibo(venta, tienda);
  const lineas = [
    ...venta.lineas.map((l) => `<div class="linea"><div><b>${esc(l.titulo)}</b><small>${numero(l.cantidad)} × ${l.precio === null ? "sin precio" : esc(plata(l.precio))}${l.opcion && l.opcion !== "única" ? ` · ${esc(l.opcion)}` : ""}</small></div><b>${l.precio === null ? "—" : esc(plata(l.precio * l.cantidad))}</b></div>`),
    ...venta.libres.map((l) => `<div class="linea"><div><b>${esc(l.descripcion)}</b><small>${numero(l.cantidad)} × ${esc(plata(l.precio))} · sin inventario</small></div><b>${esc(plata(l.precio * l.cantidad))}</b></div>`),
  ].join("");
  const recibo = `<div class="recibo" id="recibo">${venta.anulada ? '<div class="anulada-sello">ANULADA</div>' : ""}
<h2>${esc(tienda)}</h2><div class="recibo-sub">Recibo #${venta.id} · ${esc(fechaHora(venta.creado))}${anotadaDespues(venta) ? `<br>Anotada el ${esc(fechaHora(venta.registrada))}` : ""}${venta.cliente ? `<br>Cliente: ${esc(venta.cliente)}` : ""}</div>
${lineas || '<p class="recibo-sub">Sin productos.</p>'}
<div class="total"><span>Total</span><span>${venta.total === null ? "por confirmar" : esc(plata(venta.total, { siempre: true }))}</span></div>
${venta.tarifa === "cashea" ? '<div class="recibo-sub" style="margin:6px 0 0;text-align:right">Precio Cashea</div>' : ""}
${venta.fiado ? `<div class="linea" style="border:0"><span>Abonado</span><b>${esc(plata(venta.abonado, { siempre: true }))}</b></div><div class="linea" style="border:0"><span>Pendiente</span><b>${esc(plata(venta.saldo, { siempre: true }))}</b></div>` : ""}
<div class="pie">${serialDe(venta.nota) ? `${esc(serialDe(venta.nota))}<br>` : ""}${venta.fiado ? "Fiado" : esc(venta.metodo_pago || "")}${venta.sede ? ` · ${esc(venta.sede)}` : ""}<br>¡Gracias por tu compra!</div></div>`;

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

  const clave = venta.fiado ? claveDeCliente(venta.cliente, venta.telefono) : "";
  const detalles = `<section class="panel-tarjeta"><h2>${insignia("recibo", "marca", "chica")}Detalles</h2><div class="filas">
<div class="fila">${insignia(iconoDeMetodo(venta.fiado ? "Fiado" : venta.metodo_pago), "neutro", "chica")}<div class="fila-centro"><div class="fila-sub">Pago</div><div class="fila-titulo">${esc(venta.fiado ? "Fiado" : venta.metodo_pago || "Sin decir")}</div></div></div>
${venta.cliente || venta.telefono ? `<div class="fila">${avatar(venta.cliente || venta.telefono, { clase: "chico" })}<div class="fila-centro"><div class="fila-sub">Cliente</div><div class="fila-titulo">${esc(venta.cliente || "—")}${venta.telefono ? ` <span class="suave">${esc(venta.telefono)}</span>` : ""}</div></div></div>` : ""}
<div class="fila">${insignia("sede", "neutro", "chica")}<div class="fila-centro"><div class="fila-sub">Sede</div><div class="fila-titulo">${esc(venta.sede || "—")}</div></div></div>
${venta.quien ? `<div class="fila">${insignia("usuario", "neutro", "chica")}<div class="fila-centro"><div class="fila-sub">Cobró</div><div class="fila-titulo">${esc(venta.quien)}</div></div></div>` : ""}
${venta.nota ? `<div class="fila">${insignia("editar", "neutro", "chica")}<div class="fila-centro"><div class="fila-sub">Nota</div><div class="fila-titulo" style="white-space:normal">${esc(venta.nota)}</div></div></div>` : ""}
</div></section>
${
  venta.fiado && !venta.anulada
    ? `<section class="panel-tarjeta"><h2>${insignia("fiados", "aviso", "chica")}Abonos</h2>${
        venta.abonos.length
          ? `<div class="filas">${venta.abonos.map((a) => `<div class="fila"><div class="fila-centro"><div class="fila-titulo">${esc(plata(a.monto))}</div><div class="fila-sub">${esc(fechaHora(a.creado))}${a.metodo ? ` · ${esc(a.metodo)}` : ""}${a.quien ? ` · ${esc(a.quien)}` : ""}</div></div></div>`).join("")}</div>`
          : '<p class="suave">Todavía no ha abonado nada.</p>'
      }${venta.saldo > 0.009 ? formularioDeAbono({ clave, saldo: venta.saldo, volver: `/panel/ventas/${venta.id}` }) : '<p class="bien" style="margin:10px 0 0;font-weight:700">Pagada completa.</p>'}</section>`
    : ""
}`;

  return `${tostadaDesde(url)}${cabecera({
    volver: { href: "/panel/ventas", texto: "Ventas" },
    sobre: fechaHora(venta.creado),
    titulo: `Venta #${venta.id}`,
    acciones: `<div class="no-imprimir" style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" onclick="print()">${icono("imprimir")}Imprimir</button><a class="boton" href="${esc(enlaceWhatsapp(venta.telefono, texto))}" target="_blank" rel="noopener">${icono("enviar")}WhatsApp</a>${venta.anulada ? "" : `<button type="button" class="peligro" popovertarget="${idAnular}">${icono("deshacer")}Anular</button>`}</div>`,
  })}
<div class="dos"><div>${recibo}</div><div class="no-imprimir">${detalles}</div></div>${anular}`;
}

function formularioDeAbono({ clave, saldo, volver }) {
  return `<form method="post" action="/panel/fiados/abonar" class="abono-fila" data-quien><input type="hidden" name="clave" value="${esc(clave)}"><input type="hidden" name="volver" value="${esc(volver)}">
<label class="campo">Abona<div class="monto chico"><span>$</span><input name="monto" inputmode="decimal" value="${esc(String(saldo).replace(".", ","))}" required></div></label>
<label class="campo">Cómo pagó<select name="metodo">${METODOS_DE_PAGO.map((m) => `<option>${esc(m)}</option>`).join("")}</select></label>
<button class="principal">${icono("check")}Registrar abono</button></form>`;
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

/* ── FIADOS ──────────────────────────────────────────────────────────── */

async function paginaDeFiados(env, url, { tienda }) {
  const todos = url.searchParams.get("ver") === "todos";
  const fiados = await listarFiados(env.DB, { incluirPagados: todos });
  const deben = fiados.filter((f) => f.saldo > 0.009);
  const total = deben.reduce((a, f) => a + f.saldo, 0);
  const masViejo = deben.reduce((a, f) => (f.desde && (!a || f.desde < a) ? f.desde : a), 0);
  const ahora = Date.now();

  const tarjetas = fiados
    .map((f) => {
      const dias = f.desde ? Math.floor((ahora - f.desde) / DIA_MS) : 0;
      const recordatorio = `Hola${f.cliente ? ` ${f.cliente}` : ""}, te escribimos de ${tienda}. Te recordamos que tienes un saldo pendiente de ${plata(f.saldo)}. ¡Gracias!`;
      const pagado = f.saldo <= 0.009;
      return `<details class="panel-tarjeta fiado"${fiados.length === 1 ? " open" : ""}><summary class="fila" style="padding:0;list-style:none">${avatar(f.cliente || f.telefono)}<div class="fila-centro"><div class="fila-titulo">${esc(f.cliente || "Sin nombre")}</div><div class="fila-sub">${f.telefono ? `${esc(f.telefono)} · ` : ""}${pagado ? "Pagó todo" : `debe desde ${esc(fechaHora(f.desde).replace(/,.*$/, ""))}${dias ? ` · hace ${dias} ${dias === 1 ? "día" : "días"}` : ""}`}</div></div><div class="fila-fin"><b class="${pagado ? "bien" : dias > 15 ? "mal" : ""}">${esc(plata(f.saldo, { siempre: true }))}</b><small>de ${esc(plata(f.total, { siempre: true }))}</small></div></summary>
<div class="fiado-cuerpo">
<div class="filas" style="margin-top:14px">${f.ventas
        .map((v) => `<a class="fila" href="/panel/ventas/${v.id}">${insignia("recibo", "neutro", "chica")}<div class="fila-centro"><div class="fila-titulo">Venta #${v.id}</div><div class="fila-sub">${esc(fechaHora(v.creado))}</div></div><div class="fila-fin"><b>${esc(plata(v.total, { siempre: true }))}</b><small>${v.saldo > 0.009 ? `debe ${esc(plata(v.saldo))}` : "pagada"}</small></div></a>`)
        .join("")}</div>
${pagado ? "" : formularioDeAbono({ clave: f.clave, saldo: f.saldo, volver: `/panel/fiados${todos ? "?ver=todos" : ""}` })}
${pagado ? "" : `<div class="acciones"><a class="boton suave" href="${esc(enlaceWhatsapp(f.telefono, recordatorio))}" target="_blank" rel="noopener">${icono("enviar")}Recordarle por WhatsApp</a>${f.telefono ? "" : '<span class="suave">Sin teléfono: elige el contacto en WhatsApp.</span>'}</div>`}
</div></details>`;
    })
    .join("");

  return `${tostadaDesde(url)}${cabecera({
    sobre: "Tu negocio",
    titulo: "Fiados",
    texto: "Lo que te deben tus clientes. Anota cada abono y mándales un recordatorio por WhatsApp con un toque.",
    acciones: `<a class="boton suave" href="/panel/fiados.csv">${icono("bajar")}Excel</a><a class="boton suave" href="/panel/fiados${todos ? "" : "?ver=todos"}">${icono(todos ? "filtro" : "lista")}${todos ? "Solo los que deben" : "Incluir pagados"}</a>`,
  })}
<section class="heroe" style="margin-bottom:20px"><div class="heroe-fila"><div><div class="sobre">Te deben</div><div class="heroe-cifra">${cifra(total)}</div>
<div class="heroe-nota"><span>${deben.length ? `${deben.length} ${deben.length === 1 ? "cliente" : "clientes"}${masViejo ? ` · el más antiguo desde ${esc(fechaHora(masViejo).replace(/,.*$/, ""))}` : ""}` : "Nadie te debe nada."}</span></div></div>
<div class="heroe-pista">${icono("idea")}<span>Para fiar, en la Caja elige <b>Fiado</b> y escribe el nombre del cliente. Aquí lo verás al momento.</span></div></div></section>
${fiados.length ? `<div class="lista-fiados">${tarjetas}</div>` : vacio({ icono: "fiados", titulo: "Nadie te debe", texto: "Cuando vendas fiado en la Caja, aquí verás cuánto debe cada cliente y podrás anotar sus abonos.", acciones: `<a class="boton principal" href="/panel/caja">${icono("caja")}Abrir la caja</a>` })}`;
}

/* ── Las rutas ───────────────────────────────────────────────────────── */

export function esRutaDeNegocio(url) {
  const r = url.pathname;
  return (
    r === "/panel/inicio" ||
    r === "/panel/ventas" ||
    r.startsWith("/panel/ventas/") ||
    r === "/panel/ventas.csv" ||
    r === "/panel/gastos" ||
    r.startsWith("/panel/gastos/") ||
    r === "/panel/gastos.csv" ||
    r === "/panel/fiados" ||
    r.startsWith("/panel/fiados/") ||
    r === "/panel/fiados.csv" ||
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
  if (r === "/panel/gastos") return pagina("Gastos", await paginaDeGastos(env, url), { ruta: "gastos" });
  if (r === "/panel/fiados") return pagina("Fiados", await paginaDeFiados(env, url, { tienda }), { ruta: "fiados" });

  const fecha = diaDe(Date.now());
  if (r === "/panel/ventas.csv") {
    const periodo = periodoDe(url.searchParams);
    const ventas = await listarVentas(env.DB, { ...periodo, q: url.searchParams.get("q") || "", limite: 2000 });
    return respuestaCsv(
      `ventas-${periodo.desdeDia}-a-${periodo.hastaDia}.csv`,
      aCsv(
        ["Venta", "Fecha", "Hora", "Cliente", "Teléfono", "Productos", "Método de pago", "Total", "Fiado", "Abonado", "Debe", "Anulada", "Sede", "Cobró"],
        ventas.map((v) => [
          v.id,
          diaDe(v.creado),
          horaCorta(v.creado),
          v.cliente,
          v.telefono,
          v.detalle,
          v.fiado ? "Fiado" : v.metodo_pago,
          v.total ?? "",
          v.fiado ? "sí" : "no",
          v.abonado || 0,
          v.fiado && !v.anulada ? Math.max(0, (Number(v.total) || 0) - Number(v.abonado || 0)) : 0,
          v.anulada ? "sí" : "no",
          v.sede || "",
          v.quien,
        ])
      )
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
  if (r === "/panel/fiados.csv") {
    const fiados = await listarFiados(env.DB, { incluirPagados: true });
    return respuestaCsv(
      `fiados-${fecha}.csv`,
      aCsv(["Cliente", "Teléfono", "Debe", "Total fiado", "Abonado", "Debe desde"], fiados.map((f) => [f.cliente, f.telefono, f.saldo, f.total, f.abonado, f.desde ? diaDe(f.desde) : ""]))
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

  if (r === "/panel/fiados/abonar") {
    const volver = volverSeguro(datos.get("volver"), "/panel/fiados");
    try {
      const a = await abonar(env.DB, { clave: String(datos.get("clave") || ""), monto: datos.get("monto"), metodo: String(datos.get("metodo") || ""), quien, nota: String(datos.get("nota") || "") });
      console.log(`NEGOCIO: abono de ${a.abonado} de ${a.cliente} por ${quien || "—"}`);
      return responder(volver, { ok: `Abono de ${plata(a.abonado)} de ${a.cliente || "el cliente"} registrado${a.queda > 0.009 ? `. Todavía debe ${plata(a.queda)}` : ". Ya no debe nada"}` });
    } catch (error) {
      return responder(volver, { error: error.message });
    }
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
