// LOS PEDIDOS DE LA TIENDA WEB EN EL PANEL (12-oct-2026): los pagos que los
// clientes mandaron con su comprobante, para aprobarlos o rechazarlos, y los
// métodos de pago con sus datos (lo que la web le enseña al cliente).
//
//   /panel/pedidos                      por revisar · aprobados · rechazados
//   /panel/pedidos/<id>/comprobante     la foto o el PDF (solo con sesión)
//   /panel/pedidos/pagos                los métodos de pago y la tasa del día
//   POST /panel/pedidos/aprobar         anota la venta (baja el stock) y lo aprueba
//   POST /panel/pedidos/rechazar        con el motivo (el cliente lo ve)
//   POST /panel/pedidos/pagos           guarda los métodos y la tasa
//
// Las reglas viven en pedidos-web.js. ESTE ARCHIVO ES IGUAL EN LAS TRES
// TIENDAS. panel.js lo llama con la sesión ya comprobada.

import {
  asegurarPedidos,
  listarPedidos,
  contarPorEstado,
  comprobanteDe,
  aprobarPedido,
  rechazarPedido,
  leerPagos,
  guardarPagos,
  metodosVisibles,
  bolivares,
  ESTADOS,
} from "./pedidos-web.js";
import { esc, cabecera, segmento, vacio, insignia, avatar, plata, fechaHora, tostadaDesde, icono } from "./marco.js";

export function esRutaDePedidos(url) {
  return url.pathname === "/panel/pedidos" || url.pathname.startsWith("/panel/pedidos/");
}

function conAviso(ruta, { ok = "", error = "" } = {}) {
  const sep = ruta.includes("?") ? "&" : "?";
  return `${ruta}${error ? `${sep}error=${encodeURIComponent(error)}` : ok ? `${sep}ok=${encodeURIComponent(ok)}` : ""}`;
}

const volverSeguro = (v, defecto) => (/^\/panel\/pedidos(?:[/?#]|$)/.test(String(v || "")) ? String(v) : defecto);

export async function atenderPedidos(request, env, url, helpers, opciones = {}) {
  const { pagina, vieneDelPanel, redirigir } = helpers;
  const r = url.pathname;
  await asegurarPedidos(env.DB);

  if (request.method === "POST") {
    if (!vieneDelPanel(request, url)) return new Response("No", { status: 403 });
    const form = await request.formData();
    const quien = String(form.get("quien") || "").trim().slice(0, 60);
    if (r === "/panel/pedidos/aprobar") {
      const volver = volverSeguro(form.get("volver"), "/panel/pedidos");
      try {
        const hecho = await aprobarPedido(env.DB, form.get("id"), { quien, sinVenta: form.get("sinVenta") === "1" });
        return redirigir(conAviso(volver, { ok: hecho.ventaId ? `Pedido ${hecho.codigo} aprobado: la venta quedó anotada y el stock bajó.` : `Pedido ${hecho.codigo} aprobado (sin anotar venta).` }));
      } catch (error) {
        return redirigir(conAviso(`${volver}${volver.includes("#") ? "" : `#pedido-${Number(form.get("id")) || 0}`}`, { error: error.message || "No se pudo aprobar." }));
      }
    }
    if (r === "/panel/pedidos/rechazar") {
      const volver = volverSeguro(form.get("volver"), "/panel/pedidos");
      try {
        const hecho = await rechazarPedido(env.DB, form.get("id"), { quien, motivo: form.get("motivo") });
        return redirigir(conAviso(volver, { ok: `Pedido ${hecho.codigo} rechazado. El cliente ve el motivo en su enlace.` }));
      } catch (error) {
        return redirigir(conAviso(volver, { error: error.message || "No se pudo rechazar." }));
      }
    }
    if (r === "/panel/pedidos/pagos") {
      const nombres = form.getAll("m_nombre");
      const datos = form.getAll("m_datos");
      const monedas = form.getAll("m_moneda");
      const activos = new Set(form.getAll("m_activo").map(String));
      const metodos = nombres.map((nombre, i) => ({ nombre, datos: datos[i] || "", moneda: monedas[i] || "usd", activo: activos.has(String(i)) }));
      try {
        const g = await guardarPagos(env.DB, { metodos, tasa: form.get("tasa"), aviso: form.get("aviso") });
        const n = metodosVisibles(g).length;
        return redirigir(conAviso("/panel/pedidos/pagos", { ok: n ? `Guardado. La tienda web ofrece ${n} ${n === 1 ? "método" : "métodos"} de pago.` : "Guardado. Ningún método tiene datos: la web sigue solo con WhatsApp." }));
      } catch (error) {
        return redirigir(conAviso("/panel/pedidos/pagos", { error: error.message || "No se pudo guardar." }));
      }
    }
    return new Response("No existe", { status: 404 });
  }

  const comp = /^\/panel\/pedidos\/(\d+)\/comprobante$/.exec(r);
  if (comp) {
    const c = await comprobanteDe(env.DB, comp[1]);
    if (!c) return new Response("Ese comprobante no existe.", { status: 404 });
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" }[c.tipo] || "bin";
    return new Response(c.bytes, {
      headers: {
        "content-type": c.tipo,
        "content-disposition": `inline; filename="comprobante-${comp[1]}.${ext}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        // Un archivo que subió un desconocido: se ve, pero no puede correr nada.
        "content-security-policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; object-src 'self'",
      },
    });
  }

  if (r === "/panel/pedidos/pagos") return pagina("Métodos de pago", await paginaDePagos(env, url), { ruta: "pedidos" });
  if (r === "/panel/pedidos") return pagina("Pedidos web", await paginaDePedidos(env, url, opciones), { ruta: "pedidos" });
  return redirigir("/panel/pedidos");
}

/* ── La lista ────────────────────────────────────────────────────────── */

const TONO = { revisar: "aviso", aprobando: "aviso", aprobado: "bien", rechazado: "mal" };
const ICONO = { revisar: "reloj", aprobando: "reloj", aprobado: "check", rechazado: "alerta" };

async function paginaDePedidos(env, url) {
  const pedido = url.searchParams.get("estado") || "revisar";
  const estado = ESTADOS[pedido] || pedido === "todos" ? pedido : "revisar";
  const [lista, cuenta, pagos] = await Promise.all([listarPedidos(env.DB, { estado: estado === "todos" ? "" : estado }), contarPorEstado(env.DB), leerPagos(env.DB)]);
  const visibles = metodosVisibles(pagos);
  const volver = `/panel/pedidos?estado=${estado}`;
  const pestanas = segmento(
    [
      ["revisar", `Por revisar${cuenta.revisar ? ` (${cuenta.revisar})` : ""}`, "/panel/pedidos?estado=revisar"],
      ["aprobado", "Aprobados", "/panel/pedidos?estado=aprobado"],
      ["rechazado", "Rechazados", "/panel/pedidos?estado=rechazado"],
      ["todos", "Todos", "/panel/pedidos?estado=todos"],
    ],
    estado,
    { nombre: "Qué pedidos ver" }
  );
  const sinMetodos = visibles.length
    ? ""
    : `<section class="panel-tarjeta aviso-pedidos">${insignia("info", "aviso")}<div><b>La tienda web todavía no cobra en la página.</b><p class="suave">Escribe los datos de tus métodos de pago (Pago Móvil, Zelle, Zinli…) y aparece el botón «Pagar aquí» en el carrito.</p></div><a class="boton principal" href="/panel/pedidos/pagos">${icono("tarjeta")}Poner los datos de pago</a></section>`;

  const tarjetas = lista.length
    ? lista.map((p) => tarjetaDePedido(p, volver)).join("")
    : vacio({
        icono: "carrito",
        titulo: estado === "revisar" ? "No hay pagos por revisar" : "Nada por aquí",
        texto: estado === "revisar" ? "Cuando un cliente pague en la tienda web y suba su comprobante, aparece aquí para que lo apruebes." : "",
      });

  return `${tostadaDesde(url)}${cabecera({
    sobre: "Tu negocio",
    titulo: "Pedidos web",
    texto: "Los pagos de la tienda web, con su comprobante. Al aprobar uno se anota la venta y baja el stock.",
    acciones: `<a class="boton suave" href="/panel/pedidos/pagos">${icono("tarjeta")}Métodos de pago</a><a class="boton suave" href="/tienda" target="_blank" rel="noopener">${icono("enlace")}Ver la tienda</a>`,
  })}
${sinMetodos}
<div class="herramientas">${pestanas}</div>
<div class="pedidos">${tarjetas}</div>`;
}

function tarjetaDePedido(p, volver) {
  const lineas = p.items
    .map((l) => `<div class="ped-linea"><span>${l.n}× ${esc(l.titulo)}${l.etiqueta ? ` <small>(${esc(l.etiqueta)})</small>` : ""}</span><b>${esc(plata(l.precio * l.n))}</b></div>`)
    .join("");
  const tel = String(p.telefono || "").replace(/\D/g, "");
  const wa = tel ? `https://wa.me/${tel.startsWith("0") ? `58${tel.slice(1)}` : tel}?text=${encodeURIComponent(`Hola ${p.cliente.split(" ")[0]} 👋 Te escribo por tu pedido ${p.codigo}`)}` : "";
  const comprobante = p.comprobante_tipo
    ? p.comprobante_tipo === "application/pdf"
      ? `<a class="ped-comp pdf" href="/panel/pedidos/${p.id}/comprobante" target="_blank" rel="noopener">${icono("recibo", { clase: "grande" })}<span>Ver el PDF del comprobante</span></a>`
      : `<a class="ped-comp" href="/panel/pedidos/${p.id}/comprobante" target="_blank" rel="noopener" title="Abrir el comprobante"><img src="/panel/pedidos/${p.id}/comprobante" alt="Comprobante del pedido ${esc(p.codigo)}" loading="lazy"></a>`
    : `<div class="ped-comp vacio-comp">Sin comprobante</div>`;
  const montoBs = p.total_bs ? `<div class="ped-linea"><span>En bolívares (tasa ${esc(String(p.tasa).replace(".", ","))})</span><b>${esc(bolivares(p.total_bs))}</b></div>` : "";
  const acciones =
    p.estado === "revisar"
      ? `<div class="ped-acciones">
<form method="post" action="/panel/pedidos/aprobar" data-quien data-una-vez data-confirmar="¿El pago de ${esc(plata(p.total))} llegó? Se anota la venta y baja el stock." data-confirmar-boton="Sí, aprobar"><input type="hidden" name="id" value="${p.id}"><input type="hidden" name="volver" value="${esc(volver)}"><button class="principal">${icono("check")}Aprobar y anotar la venta</button></form>
<button type="button" class="fantasma" popovertarget="rechazar-${p.id}">${icono("cerrar")}Rechazar</button>
<details class="ped-mas"><summary>Más</summary><form method="post" action="/panel/pedidos/aprobar" data-quien data-una-vez data-confirmar="Se marca aprobado SIN anotar la venta (el stock no baja). Úsalo si ya lo cobraste en la caja." data-confirmar-boton="Aprobar sin venta"><input type="hidden" name="id" value="${p.id}"><input type="hidden" name="sinVenta" value="1"><input type="hidden" name="volver" value="${esc(volver)}"><button class="fantasma">Aprobar sin anotar la venta</button></form></details>
</div>
<div popover id="rechazar-${p.id}" class="ventana"><div class="ventana-asa"></div>${insignia("alerta", "mal", "grande")}<h3>Rechazar el pedido ${esc(p.codigo)}</h3><p class="suave">El cliente ve el motivo en el enlace de su pedido. El stock no se toca.</p>
<form method="post" action="/panel/pedidos/rechazar" data-quien data-una-vez><input type="hidden" name="id" value="${p.id}"><input type="hidden" name="volver" value="${esc(volver)}">
<label class="campo">Motivo<input name="motivo" maxlength="200" required placeholder="El pago no llegó, el monto no coincide…" autocomplete="off"></label>
<div class="acciones" style="margin-top:14px"><button type="button" class="fantasma" popovertarget="rechazar-${p.id}" popovertargetaction="hide">Cancelar</button><button class="peligro">Rechazar</button></div></form></div>`
      : p.estado === "aprobado"
        ? `<div class="ped-final bien">${icono("check", { clase: "chico" })} Aprobado ${p.revisado ? esc(fechaHora(p.revisado)) : ""}${p.quien ? ` por ${esc(p.quien)}` : ""}${p.venta_id ? ` · <a href="/panel/ventas/${p.venta_id}">Ver la venta</a>` : " · sin venta anotada"}</div>`
        : p.estado === "rechazado"
          ? `<div class="ped-final mal">${icono("alerta", { clase: "chico" })} Rechazado ${p.revisado ? esc(fechaHora(p.revisado)) : ""}${p.quien ? ` por ${esc(p.quien)}` : ""}${p.motivo ? ` · «${esc(p.motivo)}»` : ""}</div>`
          : `<div class="ped-final">${icono("reloj", { clase: "chico" })} Se está aprobando…</div>`;

  return `<article class="panel-tarjeta pedido" id="pedido-${p.id}">
<div class="ped-cab">${avatar(p.cliente)}<div class="ped-quien"><b>${esc(p.cliente)}</b><span class="suave">${esc(p.codigo)} · ${esc(fechaHora(p.creado))}</span></div><span class="ped-estado tono-${TONO[p.estado] || "neutro"}">${icono(ICONO[p.estado] || "info", { clase: "chico" })}${esc(ESTADOS[p.estado] || "En proceso")}</span></div>
<div class="ped-cuerpo">
<div class="ped-datos">
${lineas}
<div class="ped-linea ped-total"><span>Total</span><b>${esc(plata(p.total))}</b></div>
${montoBs}
<div class="ped-linea"><span>Pagó con</span><b>${esc(p.metodo)}${p.referencia ? ` · ref. ${esc(p.referencia)}` : ""}</b></div>
<div class="ped-linea"><span>Teléfono</span><b>${wa ? `<a href="${esc(wa)}" target="_blank" rel="noopener">${esc(p.telefono)} ${icono("chats", { clase: "chico" })}</a>` : esc(p.telefono)}</b></div>
${p.cedula ? `<div class="ped-linea"><span>Cédula</span><b>${esc(p.cedula)}</b></div>` : ""}
<div class="ped-linea"><span>Entrega</span><b>${esc(entregaDe(p))}</b></div>
${p.nota ? `<div class="ped-linea"><span>Nota</span><b>${esc(p.nota)}</b></div>` : ""}
</div>
${comprobante}
</div>
${acciones}
</article>`;
}

// "Envío · <dirección>" o "Retira en la tienda".
function entregaDe(p) {
  if (p.entrega !== ENVIO) return "Retira en la tienda";
  return p.direccion ? "Envío · " + p.direccion : "Envío";
}
const ENVIO = "envio";

/* ── Los métodos de pago ─────────────────────────────────────────────── */

async function paginaDePagos(env, url) {
  const pagos = await leerPagos(env.DB);
  // Dos filas vacías para añadir otros métodos ("y otros", dueño 12-oct).
  const filas = [...pagos.metodos, { nombre: "", datos: "", moneda: "usd", activo: true }, { nombre: "", datos: "", moneda: "usd", activo: true }];
  const fila = (m, i) => `<div class="metodo-fila${m.nombre && !m.datos ? " sin-datos" : ""}">
<div class="metodo-fila-cab"><label class="campo">Método<input name="m_nombre" value="${esc(m.nombre)}" maxlength="40" placeholder="${m.nombre || i >= pagos.metodos.length ? "Otro (Binance, PayPal, efectivo…)" : ""}" autocomplete="off"></label>
<label class="campo">Se paga en<select name="m_moneda"><option value="usd"${m.moneda !== "bs" ? " selected" : ""}>Dólares</option><option value="bs"${m.moneda === "bs" ? " selected" : ""}>Bolívares</option></select></label>
<label class="interruptor"><input type="checkbox" name="m_activo" value="${i}"${m.activo ? " checked" : ""}>Se ofrece</label></div>
<label class="campo">Datos para pagar <small>(lo que ve el cliente; una línea por dato)</small><textarea name="m_datos" rows="3" maxlength="600" placeholder="${esc(ejemplo(m.nombre))}">${esc(m.datos)}</textarea></label>
</div>`;
  const tasa = pagos.tasa ? String(pagos.tasa).replace(".", ",") : "";
  return `${tostadaDesde(url)}${cabecera({
    sobre: "Pedidos web",
    titulo: "Métodos de pago",
    texto: "Lo que ve el cliente al pagar en la tienda web. Un método sin datos, o apagado, no sale.",
    volver: { href: "/panel/pedidos", texto: "Pedidos web" },
  })}
<form method="post" action="/panel/pedidos/pagos" class="pagos-form" data-una-vez>
<section class="panel-tarjeta"><h2>${insignia("banco", "marca", "chica")}Tasa del día <small class="suave">(opcional)</small></h2>
<p class="suave">Con la tasa, la web le dice al cliente cuánto pagar en bolívares. Sin ella, le dice «el equivalente a la tasa del día».${pagos.tasaFecha ? ` (Cambiada: ${esc(fechaHora(pagos.tasaFecha))})` : ""}</p>
<label class="campo" style="max-width:260px">Bs por cada dólar<input name="tasa" value="${esc(tasa)}" inputmode="decimal" placeholder="Ej.: 36,50" autocomplete="off"></label></section>
<section class="panel-tarjeta"><h2>${insignia("tarjeta", "marca", "chica")}Tus métodos</h2>
<div class="metodos-lista">${filas.map(fila).join("")}</div></section>
<section class="panel-tarjeta"><h2>${insignia("info", "neutro", "chica")}Una nota para el cliente <small class="suave">(opcional)</small></h2>
<label class="campo">Sale debajo de los métodos<input name="aviso" value="${esc(pagos.aviso)}" maxlength="300" placeholder="Ej.: Envía el monto exacto. Los pagos se confirman en horario de tienda." autocomplete="off"></label></section>
<div class="acciones"><button class="principal" style="min-width:220px">${icono("check")}Guardar</button></div>
</form>`;
}

function ejemplo(nombre) {
  const n = String(nombre || "").toLowerCase();
  if (/m[oó]vil/.test(n)) return "Banco: Banesco (0134)\nTeléfono: 0414-1234567\nCédula: V-12.345.678";
  if (/transfer/.test(n)) return "Banco: Mercantil\nCuenta: 0105-0000-00-0000000000\nTitular: Nombre Apellido\nCédula/RIF: V-12.345.678";
  if (/zelle/.test(n)) return "Correo: pagos@tutienda.com\nTitular: Nombre Apellido";
  if (/zinli/.test(n)) return "Correo: pagos@tutienda.com\nTitular: Nombre Apellido";
  if (/binance/.test(n)) return "Pay ID: 123456789\nCorreo: pagos@tutienda.com";
  return "Los datos que el cliente necesita para pagarte";
}

// El estilo de esta pantalla, encima del marco del panel.
export const ESTILO_PEDIDOS = `
.aviso-pedidos{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:18px}.aviso-pedidos>div{flex:1;min-width:220px}.aviso-pedidos p{margin:4px 0 0}
.pedidos{display:grid;gap:16px}
.pedido{display:grid;gap:14px}
.ped-cab{display:flex;align-items:center;gap:12px}.ped-quien{display:grid;flex:1;min-width:0}.ped-quien b{font-size:16px}
.ped-estado{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:999px;font-size:12.5px;font-weight:750;border:1px solid var(--borde-fuerte)}
.ped-estado.tono-aviso{color:var(--aviso,#ffbf47);border-color:color-mix(in srgb,var(--aviso,#ffbf47) 45%,transparent)}.ped-estado.tono-bien{color:var(--bien,#3ddc97);border-color:color-mix(in srgb,var(--bien,#3ddc97) 45%,transparent)}.ped-estado.tono-mal{color:var(--mal,#ff6b6b);border-color:color-mix(in srgb,var(--mal,#ff6b6b) 45%,transparent)}
.ped-cuerpo{display:grid;grid-template-columns:1fr 220px;gap:18px;align-items:start}
.ped-datos{display:grid}
.ped-linea{display:flex;justify-content:space-between;gap:14px;padding:8px 0;border-bottom:1px solid var(--borde);font-size:14px}.ped-linea span{color:var(--suave)}.ped-linea b{text-align:right;font-weight:650}.ped-linea a{color:inherit;text-decoration:underline;text-underline-offset:3px}
.ped-total b{font-size:18px;font-weight:800}
.ped-comp{display:block;border:1px solid var(--borde-fuerte);border-radius:16px;overflow:hidden;background:var(--velo-2,rgba(255,255,255,.04));transition:transform .4s var(--resorte),border-color .3s}.ped-comp:hover{transform:translateY(-2px);border-color:var(--marca)}
.ped-comp img{width:100%;max-height:300px;object-fit:contain;display:block;background:#fff}
.ped-comp.pdf,.vacio-comp{display:grid;place-items:center;gap:8px;padding:28px 14px;text-align:center;font-weight:700;color:var(--suave)}
.ped-acciones{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.ped-acciones form{margin:0}
.ped-mas summary{cursor:pointer;color:var(--suave);font-size:13.5px;font-weight:650;list-style:none;padding:8px 10px}.ped-mas summary::-webkit-details-marker{display:none}.ped-mas[open] summary{margin-bottom:6px}
.ped-final{font-size:14px;color:var(--suave);display:flex;gap:6px;align-items:center;flex-wrap:wrap}.ped-final.bien{color:var(--bien,#3ddc97)}.ped-final.mal{color:var(--mal,#ff6b6b)}.ped-final a{color:inherit;text-decoration:underline}
.pagos-form{display:grid;gap:16px}.pagos-form h2{display:flex;align-items:center;gap:10px;font-size:17px;margin:0 0 6px}.pagos-form h2 small{font-weight:600;font-size:13px}
.metodos-lista{display:grid;gap:14px;margin-top:8px}
.metodo-fila{display:grid;gap:10px;padding:14px;border:1px solid var(--borde);border-radius:16px}.metodo-fila.sin-datos{border-style:dashed}
.metodo-fila-cab{display:grid;grid-template-columns:1.4fr 1fr auto;gap:12px;align-items:end}
@media(max-width:760px){.ped-cuerpo{grid-template-columns:1fr}.metodo-fila-cab{grid-template-columns:1fr 1fr}.metodo-fila-cab .interruptor{grid-column:1/-1}}
`;
