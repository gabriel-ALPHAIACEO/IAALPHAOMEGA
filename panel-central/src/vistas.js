// LAS PANTALLAS DEL PANEL CENTRAL. HTML hecho en el Worker, sin librerías:
// carga rápido en el teléfono y no depende de nada externo.
//
// Todo lo que viene de las tiendas (lo que escriben los clientes, lo que
// guardan las bases) pasa por esc() antes de salir: aquí no se pinta nada
// crudo.

import { TIPOS } from "./alertas.js";

export function esc(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ZONA = "America/Caracas";

export function cuandoFue(ms) {
  if (!ms) return "—";
  const min = Math.round((Date.now() - Number(ms)) / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  if (min < 24 * 60) return `hace ${Math.round(min / 60)} h`;
  return new Date(Number(ms)).toLocaleDateString("es-VE", { day: "numeric", month: "short", timeZone: ZONA });
}

export function horaExacta(ms) {
  if (!ms) return "";
  return new Date(Number(ms)).toLocaleString("es-VE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: ZONA });
}

function dolares(n) {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

// Las marcas de cada respuesta (las mismas de registro.js en las tiendas).
export const MARCAS = {
  error: { simbolo: "❌", nombre: "Respuesta con error (la IA no respondió)" },
  indebida: { simbolo: "🔴", nombre: "Respuesta indebida (alucinó o incoherente)" },
  corregida: { simbolo: "⚠️", nombre: "La IA inventó algo y se corrigió" },
  queja: { simbolo: "👎", nombre: "El cliente se quejó" },
};

/* ── El estilo ───────────────────────────────────────────────────────
   Colores como tokens, con su versión oscura. La serie de los gráficos es
   una sola (azul, el primer color de la paleta de referencia); los estados
   (error, bien) van siempre con su símbolo, nunca solo con color. */
const ESTILO = `
:root{color-scheme:light;--sobre-marca:#fff;--fondo:#f6f7f9;--tarjeta:#fff;--texto:#1c1f24;--suave:#5f6773;--borde:#e3e6ea;
--marca:#2a78d6;--serie:#2a78d6;--cliente:#eef1f5;--bot:#e6efff;--pienso:#fff8e6;--pienso-borde:#f0d48a;
--mal:#b42318;--bien:#137333;--aviso:#9a6700;--rejilla:#e9ecef}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--sobre-marca:#0b1220;--fondo:#111418;--tarjeta:#1a1e24;--texto:#e8eaed;--suave:#9aa3ad;
--borde:#2b3139;--marca:#7aa7ff;--serie:#3987e5;--cliente:#232a33;--bot:#1d2a44;--pienso:#2b2616;--pienso-borde:#6b5a22;
--mal:#ff8a80;--bien:#81c995;--aviso:#e3b341;--rejilla:#262c33}}
*{box-sizing:border-box}body{margin:0;background:var(--fondo);color:var(--texto);font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
a{color:var(--marca);text-decoration:none}
header{position:sticky;top:0;background:var(--tarjeta);border-bottom:1px solid var(--borde);padding:10px 16px;z-index:5}
header .fila{display:flex;gap:4px 14px;align-items:center;flex-wrap:wrap;max-width:1100px;margin:0 auto}
header b{font-size:16px;margin-right:auto}
.menu{display:flex;gap:14px;align-items:center;overflow-x:auto;white-space:nowrap;max-width:100%;padding:8px 14px 4px 0;scrollbar-width:none}
.menu::-webkit-scrollbar{display:none}
.campana{position:relative}.campana .n{position:absolute;top:-8px;right:-12px;background:var(--mal);color:#fff;border-radius:999px;font-size:11px;padding:0 6px;min-width:18px;text-align:center}
main{max-width:1100px;margin:0 auto;padding:16px}
h2{font-size:18px;margin:18px 0 8px}h3{font-size:15px;margin:14px 0 6px}
.tarjeta{background:var(--tarjeta);border:1px solid var(--borde);border-radius:12px;padding:12px 14px;margin-bottom:10px}
a.tarjeta,a.dentro{display:block;color:inherit}form.dentro{margin:8px 0 0}
.rejilla{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}
.kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:10px}
.kpi{background:var(--tarjeta);border:1px solid var(--borde);border-radius:12px;padding:10px 12px}
.kpi .v{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums}.kpi .e{font-size:12px;color:var(--suave)}
.nombre{font-weight:600}.suave{color:var(--suave);font-size:13px}
.etiqueta{display:inline-block;font-size:12px;border-radius:999px;padding:1px 8px;margin:0 6px 0 0;border:1px solid var(--borde)}
.mal{color:var(--mal)}.bien{color:var(--bien)}.aviso{color:var(--aviso)}
.pestanas{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 14px}.pestanas a{padding:6px 10px;border-radius:8px;border:1px solid var(--borde);background:var(--tarjeta);font-size:14px}
.pestanas a.activa{background:var(--marca);color:var(--sobre-marca);border-color:var(--marca)}
.chat{display:flex;flex-direction:column;gap:8px}
.burbuja{max-width:85%;padding:8px 12px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word}
.de-cliente{align-self:flex-start;background:var(--cliente)}.de-bot{align-self:flex-end;background:var(--bot)}
.de-asesor{align-self:flex-end;background:var(--tarjeta);border:1px solid var(--marca)}
.quien{display:block;font-size:11px;color:var(--suave);margin-bottom:2px}
.pienso{align-self:flex-end;max-width:85%;background:var(--pienso);border:1px dashed var(--pienso-borde);border-radius:10px;padding:8px 12px;font-size:13px}
.recorrido{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0}.paso{font-size:12px;border:1px solid var(--borde);border-radius:6px;padding:1px 6px;background:var(--tarjeta)}
.sello{font-weight:600;margin-bottom:4px}
.leyenda{font-size:13px;color:var(--suave);margin:6px 0 12px;display:flex;flex-wrap:wrap;gap:2px 14px}
form.fila,.acciones{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}
input,button,select,textarea{font:inherit;padding:8px 12px;border-radius:8px;border:1px solid var(--borde);background:var(--tarjeta);color:var(--texto)}
input{min-width:0;flex:1}textarea{width:100%;min-height:90px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px}
button{cursor:pointer}button.principal{background:var(--marca);color:var(--sobre-marca);border-color:var(--marca)}button.peligro{color:var(--mal);border-color:var(--mal)}
pre{white-space:pre-wrap;word-wrap:break-word;font:13px/1.45 ui-monospace,Menlo,Consolas,monospace;margin:0}
.tabla{overflow-x:auto;border:1px solid var(--borde);border-radius:10px;background:var(--tarjeta)}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:6px 8px;border-bottom:1px solid var(--borde);text-align:left;vertical-align:top}
th{position:sticky;top:0;background:var(--tarjeta);font-weight:600}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
td .corto{max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block}
.grafico{display:flex;flex-direction:column}.grafico .barras{margin-top:auto}.grafico .nombre{margin-bottom:6px}.grafico .suave{display:block;font-weight:400;font-size:12px}
.barras{display:flex;align-items:flex-end;gap:2px;height:120px;padding:4px 0;border-bottom:1px solid var(--suave)}
.barra{flex:1;min-width:6px;display:flex;align-items:flex-end;height:100%;position:relative}
.barra i{display:block;width:100%;background:var(--serie);border-radius:4px 4px 0 0}
.barra:hover i{opacity:.8}.barra .tip{display:none;position:absolute;bottom:100%;left:50%;transform:translateX(-50%);background:var(--texto);color:var(--fondo);font-size:12px;padding:2px 6px;border-radius:6px;white-space:nowrap;z-index:3}
.barra:hover .tip{display:block}
.ejes{display:flex;justify-content:space-between;font-size:11px;color:var(--suave);margin-top:2px}
.flujo{display:flex;flex-direction:column;align-items:stretch;gap:0;max-width:720px}
.nodo{background:var(--tarjeta);border:1px solid var(--borde);border-radius:12px;padding:10px 14px}
.nodo b{display:block}.nodo.decision{border-style:dashed}.nodo.red{border-color:var(--aviso)}
.flecha{text-align:center;color:var(--suave);font-size:18px;line-height:22px}
.rama{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px}
.vivo-lista{display:flex;flex-direction:column;gap:8px}.vivo-lista a.tarjeta{margin:0;border-left:4px solid var(--borde)}
.vivo-lista .de-bot{border-left-color:var(--marca)}.vivo-lista .de-asesor{border-left-color:var(--aviso)}
.vivo-lista .es-turno{background:var(--pienso);border-style:dashed;border-color:var(--pienso-borde);border-left:4px solid var(--pienso-borde);font-size:14px}
.vivo-lista .cuerpo{white-space:pre-wrap;word-wrap:break-word}.vivo-lista .cuando{display:block;font-size:12px}.vivo-lista .nuevo{animation:llegar 3s ease-out}
@keyframes llegar{from{box-shadow:0 0 0 3px var(--marca)}to{box-shadow:none}}
#avisos{position:fixed;right:12px;bottom:12px;display:flex;flex-direction:column;gap:8px;z-index:9;max-width:340px}
.toast{background:var(--tarjeta);border:1px solid var(--borde);border-left:4px solid var(--mal);border-radius:10px;padding:10px 12px;box-shadow:0 4px 18px rgba(0,0,0,.15);font-size:14px}
`;

// EN TIEMPO REAL (lado del navegador). Cada 8 segundos pregunta si hay
// alertas nuevas: campana, aviso en pantalla, notificación y un pitido.
// Los avisos se arman con textContent: lo que venga de una tienda nunca se
// interpreta como HTML.
// Las páginas marcadas "vivo" además se refrescan solas cada minuto, pero
// solo con la pestaña a la vista (cada refresco le pide datos a las
// tiendas, y eso gasta lecturas de su base).
const VIVO = `
<div id="avisos"></div>
<script>
(function(){
  var ultimo = 0, primera = true;
  try { ultimo = Number(sessionStorage.getItem("ultimaAlerta") || "0"); primera = !ultimo; } catch (e) {}
  function pitido(){try{var c=new (window.AudioContext||window.webkitAudioContext)();var o=c.createOscillator();var g=c.createGain();o.frequency.value=880;g.gain.value=0.08;o.connect(g);g.connect(c.destination);o.start();setTimeout(function(){o.stop();c.close()},180)}catch(e){}}
  function aviso(a){
    var d=document.createElement("div");d.className="toast";
    var t=document.createElement("b");t.textContent=a.simbolo+" "+a.tienda+" · "+a.nombre;d.appendChild(t);
    var x=document.createElement("div");x.textContent=a.texto;d.appendChild(x);
    if(a.enlace&&a.enlace.charAt(0)==="/"){var l=document.createElement("a");l.href=a.enlace;l.textContent="Ver";d.appendChild(l)}
    document.getElementById("avisos").appendChild(d);setTimeout(function(){d.remove()},15000);
    if(window.Notification&&Notification.permission==="granted"){try{new Notification(a.simbolo+" "+a.tienda+": "+a.nombre,{body:a.texto})}catch(e){}}
  }
  function revisar(){
    fetch("/vivo?desde="+ultimo+(primera?"&primera=1":""),{credentials:"same-origin"}).then(function(r){return r.ok?r.json():null}).then(function(d){
      if(!d)return;
      var n=document.getElementById("sinleer");if(n){n.textContent=d.sinLeer||"";n.style.display=d.sinLeer?"":"none"}
      if(!primera&&d.nuevas&&d.nuevas.length){d.nuevas.slice(0,5).forEach(aviso);pitido()}
      primera=false;if(d.ultimo>ultimo){ultimo=d.ultimo;try{sessionStorage.setItem("ultimaAlerta",String(ultimo))}catch(e){}}
    }).catch(function(){})
  }
  revisar();setInterval(revisar,8000);
  var b=document.getElementById("notificar");
  if(b&&window.Notification&&Notification.permission!=="granted"){b.style.display="";b.onclick=function(){Notification.requestPermission().then(function(){b.style.display="none"})}}
  if(document.body.dataset.vivo){
    var cada=Number(document.body.dataset.vivo)||60000;
    setInterval(function(){
      if(document.visibilityState!=="visible")return;
      if(document.activeElement&&/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))return;
      fetch(location.href,{credentials:"same-origin"}).then(function(r){return r.ok?r.text():null}).then(function(h){
        if(!h)return;
        var nuevo=new DOMParser().parseFromString(h,"text/html").getElementById("contenido");
        var actual=document.getElementById("contenido");
        if(nuevo&&actual&&nuevo.innerHTML!==actual.innerHTML){actual.innerHTML=nuevo.innerHTML}
      }).catch(function(){})
    },cada)
  }
})();
</script>`;

export function pagina(titulo, cuerpo, { conMenu = true, vivo = false, sinLeer = 0, nombre = "Panel central" } = {}) {
  const menu = conMenu
    ? `<nav class="menu"><a href="/">Inicio</a><a href="/en-vivo">🟢 En vivo</a><a class="campana" href="/alertas">🔔 Alertas<span class="n" id="sinleer" style="${sinLeer ? "" : "display:none"}">${sinLeer || ""}</span></a>
<a href="/en-pausa">⏸️ En pausa</a><a href="/metricas">Métricas</a><a href="/ganadores">Ganadores</a><a href="/errores">Errores</a><a href="/gastos">Gastos</a><a href="/salud">Estado</a><a href="/como-funciona">Cómo funciona</a><a href="/salir">Salir</a>
<button id="notificar" style="display:none">Activar avisos</button></nav>`
    : "";
  return new Response(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(titulo)} · ${esc(nombre)}</title><style>${ESTILO}</style></head>
<body${vivo ? ` data-vivo="${typeof vivo === "number" ? vivo : 60000}"` : ""}><header><div class="fila"><b>${esc(nombre)}</b>${menu}</div></header>
<main id="contenido">${cuerpo}</main>${conMenu ? VIVO : ""}</body></html>`,
    {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-frame-options": "DENY",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        // Nada de fuera: ni scripts, ni imágenes, ni a dónde mandar datos.
        "content-security-policy":
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      },
    }
  );
}

export function entrada(nombre, error = "") {
  return pagina(
    "Entrar",
    `<div class="tarjeta" style="max-width:420px"><form method="post" action="/entrar">
<p>Escribe la clave del panel central.</p>${error ? `<p class="mal">${esc(error)}</p>` : ""}
<div class="acciones"><input type="password" name="clave" autocomplete="current-password" autofocus><button class="principal">Entrar</button></div></form></div>`,
    { conMenu: false, nombre }
  );
}

/* ── Piezas ──────────────────────────────────────────────────────── */

function kpi(valor, etiqueta, { clase = "", titulo = "" } = {}) {
  return `<div class="kpi" title="${esc(titulo)}"><div class="v ${clase}">${esc(valor)}</div><div class="e">${esc(etiqueta)}</div></div>`;
}

// Un gráfico de barras de UNA serie (sin leyenda: el título la nombra),
// con el valor de cada día al pasar el dedo o el ratón.
function barras(titulo, dias, campo) {
  const max = Math.max(1, ...dias.map((d) => Number(d[campo]) || 0));
  const total = dias.reduce((s, d) => s + (Number(d[campo]) || 0), 0);
  const cuerpo = dias
    .map((d) => {
      const v = Number(d[campo]) || 0;
      return `<div class="barra"><i style="height:${Math.round((v / max) * 100)}%"></i><span class="tip">${esc(d.dia.slice(5))}: ${v}</span></div>`;
    })
    .join("");
  return `<div class="tarjeta grafico"><div class="nombre">${esc(titulo)}<span class="suave">${total} en total · máximo ${max === 1 && !total ? 0 : max} en un día</span></div>
<div class="barras" role="img" aria-label="${esc(titulo)} por día">${cuerpo}</div>
<div class="ejes"><span>${esc(dias[0]?.dia.slice(5) || "")}</span><span>${esc(dias.at(-1)?.dia.slice(5) || "")}</span></div></div>`;
}

export function pestanasDeTienda(t, activa) {
  const p = [
    ["", "Resumen"],
    ["en-vivo", "🟢 En vivo"],
    ["chats", "Chats"],
    ["metricas", "Métricas"],
    ["ganadores", "Ganadores"],
    ["errores", "Errores"],
    ["alertas", "Alertas"],
    ["bases", "Bases de datos"],
    ["estado", "Estado"],
  ];
  return `<h2>${esc(t.nombre)}</h2><div class="pestanas">${p
    .map(([ruta, nombre]) => `<a class="${activa === ruta ? "activa" : ""}" href="/t/${esc(t.id)}${ruta ? `/${ruta}` : ""}">${esc(nombre)}</a>`)
    .join("")}</div>`;
}

function falla(error) {
  return `<div class="tarjeta mal">❌ No pude leer esta tienda: ${esc(error)}</div>`;
}

/* ── Inicio: todas las tiendas ───────────────────────────────────── */

export function vistaInicio(respuestas, alertas, nombresDeTiendas) {
  const suma = (campo, periodo = "hoy") => respuestas.reduce((s, r) => s + (r.ok ? Number(r.datos?.[periodo]?.[campo]) || 0 : 0), 0);
  const gasto = respuestas.reduce((s, r) => s + (r.ok ? Number(r.datos?.gasto?.total) || 0 : 0), 0);
  const proyectado = respuestas.reduce((s, r) => s + (r.ok ? Number(r.datos?.gasto?.proyectado) || 0 : 0), 0);
  const caidas = respuestas.filter((r) => !r.ok).length;
  // ❌ es una RESPUESTA que falló (el turno quedó marcado); ⚙️ es una línea
  // de error del registro (Slack, Meta, la base…). Un mismo fallo puede dar
  // las dos, así que no se suman.
  const problemasHoy = suma("fallos") + suma("indebidas") + suma("quejas");

  const tarjetas = respuestas
    .map((r) => {
      if (!r.ok) {
        return `<a class="tarjeta" href="/t/${esc(r.tienda.id)}"><div class="nombre">🚨 ${esc(r.tienda.nombre)}</div><div class="mal">No responde: ${esc(r.error)}</div></a>`;
      }
      const d = r.datos;
      const malas = (d.hoy.errores || 0) + (d.hoy.indebidas || 0) + (d.hoy.fallos || 0) + (d.hoy.quejas || 0);
      return `<a class="tarjeta" href="/t/${esc(r.tienda.id)}"><div class="nombre">${malas ? "⚠️" : "✅"} ${esc(r.tienda.nombre)}</div>
<div class="suave">${esc(d.version)}</div>
<div>Hoy: <b>${d.hoy.clientes}</b> clientes · <b>${d.hoy.mensajes}</b> mensajes · <b>${d.hoy.ventas}</b> ventas por cerrar</div>
<div>${d.hoy.fallos ? `<span class="mal">❌ ${d.hoy.fallos}</span> · ` : ""}${d.hoy.errores ? `<span class="mal">⚙️ ${d.hoy.errores} errores técnicos</span> · ` : ""}${d.hoy.indebidas ? `<span class="mal">🔴 ${d.hoy.indebidas}</span> · ` : ""}${d.hoy.corregidas ? `<span class="aviso">⚠️ ${d.hoy.corregidas}</span> · ` : ""}${d.hoy.quejas ? `👎 ${d.hoy.quejas} · ` : ""}${d.pausados ? `${d.pausados} en pausa · ` : ""}gasto del mes ${dolares(d.gasto?.total)}</div></a>`;
    })
    .join("");

  return `<h2>Todas las tiendas</h2>
<div class="kpis">${kpi(respuestas.length - caidas + " / " + respuestas.length, "tiendas funcionando", { clase: caidas ? "mal" : "bien" })}
${kpi(suma("clientes"), "clientes hoy")}${kpi(suma("mensajes"), "mensajes hoy")}${kpi(suma("respuestas"), "respuestas de la IA hoy")}
${kpi(suma("ventas"), "ventas por cerrar hoy")}${kpi(problemasHoy, "respuestas con problema hoy (❌ 🔴 👎)", { clase: problemasHoy ? "mal" : "" })}${kpi(suma("errores"), "⚙️ errores técnicos hoy", { clase: suma("errores") ? "mal" : "" })}
${kpi(dolares(gasto), "gasto OpenAI del mes")}${kpi(dolares(proyectado), "el mes saldrá en")}
<a class="kpi" href="/en-pausa" style="color:inherit"><div class="v">${respuestas.reduce((s, r) => s + (r.ok ? Number(r.datos?.pausados) || 0 : 0), 0)}</div><div class="e">⏸️ en pausa · ver y devolver al bot</div></a></div>
<div class="rejilla">${tarjetas || '<div class="tarjeta">No hay tiendas: añádelas en TIENDAS (wrangler.toml).</div>'}</div>
<h2>Últimas alertas</h2>${listaDeAlertas(alertas, nombresDeTiendas)}`;
}

export function listaDeAlertas(alertas, nombres) {
  if (!alertas.length) return '<div class="tarjeta suave">Sin alertas. Todo tranquilo ✅</div>';
  return alertas
    .map((a) => {
      const t = TIPOS[a.tipo] || TIPOS.error;
      const enlace = a.igsid ? `/t/${esc(a.tienda)}/c/${encodeURIComponent(a.igsid)}` : `/t/${esc(a.tienda)}`;
      return `<a class="tarjeta" href="${enlace}" style="${a.leida ? "" : "border-left:4px solid var(--mal)"}"><b>${t.simbolo} ${esc(nombres[a.tienda] || a.tienda)} · ${esc(t.nombre)}</b>${a.veces > 1 ? ` <span class="etiqueta">×${a.veces}</span>` : ""}
<div style="white-space:pre-wrap">${esc(String(a.texto).slice(0, 400))}</div><div class="suave">${esc(horaExacta(a.cuando))}</div></a>`;
    })
    .join("");
}

/* ── Una tienda ──────────────────────────────────────────────────── */

export function vistaResumenTienda(t, r) {
  if (!r.ok) return pestanasDeTienda(t, "") + falla(r.error);
  const d = r.datos;
  const fila = (p) =>
    `${kpi(d[p].clientes, "clientes")}${kpi(d[p].mensajes, "mensajes del cliente")}${kpi(d[p].respuestas, "respuestas de la IA")}${kpi(d[p].fichas, "respuestas con fichas")}
${kpi(d[p].voz, "notas de voz")}${kpi(d[p].ventas, "ventas por cerrar")}${kpi(d[p].avisos, "pasados al asesor")}${d.conAnuncios ? kpi(d[p].anuncios, "llegaron por anuncios") : ""}
${kpi(d[p].fallos, "❌ respuestas con error", { clase: d[p].fallos ? "mal" : "" })}${kpi(d[p].indebidas, "🔴 indebidas", { clase: d[p].indebidas ? "mal" : "" })}${kpi(d[p].corregidas, "⚠️ corregidas")}${kpi(d[p].quejas, "👎 quejas")}${kpi(d[p].errores, "⚙️ errores técnicos", { clase: d[p].errores ? "mal" : "" })}`;
  return `${pestanasDeTienda(t, "")}<div class="suave">${esc(d.version)} · ${d.pausados} conversación(es) con el bot en pausa</div>
<h3>Hoy</h3><div class="kpis">${fila("hoy")}</div><h3>Últimos 7 días</h3><div class="kpis">${fila("semana")}</div>
<h3>Gasto de OpenAI este mes</h3><div class="kpis">${kpi(dolares(d.gasto?.total), "gastado")}${kpi(dolares(d.gasto?.proyectado), "el mes saldrá en")}${kpi(`${d.gasto?.dias || 0}/${d.gasto?.delMes || 0}`, "días del mes")}</div>
${(d.gasto?.filas || []).length ? `<div class="tabla"><table><tr><th>Modelo</th><th class="num">Llamadas</th><th class="num">Dólares</th></tr>${d.gasto.filas.map((f) => `<tr><td>${esc(f.modelo)}</td><td class="num">${esc(f.llamadas)}</td><td class="num">${dolares(f.dolares)}</td></tr>`).join("")}</table></div>` : ""}
${d.ultimoError ? `<h3>Último error</h3><div class="tarjeta mal">${esc(horaExacta(d.ultimoError.cuando))} · ${esc(d.ultimoError.texto)}</div>` : ""}`;
}

export function vistaMetricas(titulo, dias, datos, { conAnuncios = false, cabecera = "" } = {}) {
  if (!dias.length) return `${cabecera}<div class="tarjeta">Sin datos todavía.</div>`;
  const tot = datos.totales;
  const pct = (x) => `${Math.round((Number(x) || 0) * 100)}%`;
  const enlaces = [7, 14, 30, 90].map((n) => `<a href="?dias=${n}">${n} días</a>`).join(" · ");
  return `${cabecera}<h3>${esc(titulo)}</h3><div class="suave">Ver: ${enlaces}</div>
<div class="kpis">${kpi(tot.clientes, "clientes")}${kpi(tot.mensajes, "mensajes")}${kpi(tot.respuestas, "respuestas de la IA")}${kpi(pct(datos.tasas?.conFichas), "respuestas con fichas")}
${kpi(tot.ventas, "ventas por cerrar")}${kpi(pct(datos.tasas?.ventasPorCliente), "clientes que quieren comprar")}${kpi(tot.avisos, "pasados al asesor")}${kpi(tot.voz, "notas de voz")}
${conAnuncios ? kpi(tot.anuncios, "llegaron por anuncios") : ""}${kpi(tot.fallos, "❌ respuestas con error", { clase: tot.fallos ? "mal" : "" })}${kpi(tot.indebidas, "🔴 indebidas", { clase: tot.indebidas ? "mal" : "" })}${kpi(tot.corregidas, "⚠️ corregidas")}${kpi(tot.quejas, "👎 quejas")}${kpi(tot.errores, "⚙️ errores técnicos", { clase: tot.errores ? "mal" : "" })}
${datos.gasto ? kpi(dolares(datos.gasto.total), "gasto OpenAI del mes") : ""}</div>
<div class="rejilla">${barras("Clientes por día", dias, "clientes")}${barras("Mensajes de clientes por día", dias, "mensajes")}
${barras("Respuestas de la IA por día", dias, "respuestas")}${barras("Ventas por cerrar por día", dias, "ventas")}
${barras("❌ Respuestas con error por día", dias, "fallos")}${barras("🔴 Respuestas indebidas por día", dias, "indebidas")}
${barras("⚙️ Errores técnicos por día", dias, "errores")}${conAnuncios ? barras("Llegadas por anuncios por día", dias, "anuncios") : ""}</div>
<details><summary>Ver la tabla día por día</summary><div class="tabla"><table><tr><th>Día</th><th class="num">Clientes</th><th class="num">Mensajes</th><th class="num">Respuestas</th><th class="num">Con fichas</th><th class="num">Voz</th><th class="num">Ventas</th><th class="num">Asesor</th><th class="num">❌</th><th class="num">🔴</th><th class="num">⚠️</th><th class="num">👎</th><th class="num">⚙️</th></tr>
${dias.map((d) => `<tr><td>${esc(d.dia)}</td>${["clientes", "mensajes", "respuestas", "fichas", "voz", "ventas", "avisos", "fallos", "indebidas", "corregidas", "quejas", "errores"].map((c) => `<td class="num">${Number(d[c]) || 0}</td>`).join("")}</tr>`).join("")}</table></div></details>`;
}

export function vistaGanadores(filas, { conTienda = false, cabecera = "" } = {}) {
  if (!filas.length) return `${cabecera}<div class="tarjeta suave">Todavía no hay productos con movimiento en este período.</div>`;
  return `${cabecera}<p class="suave">Ordenados por <b>ventas por cerrar</b> (avisos de compra con ese producto delante), después por cuántos clientes distintos lo vieron.</p>
<div class="tabla"><table><tr>${conTienda ? "<th>Tienda</th>" : ""}<th>Producto</th><th class="num">🛒 Ventas por cerrar</th><th class="num">Clientes que lo vieron</th><th class="num">Veces mostrado</th><th class="num">Pasados al asesor</th></tr>
${filas.map((f, i) => `<tr>${conTienda ? `<td>${esc(f.tiendaNombre)}</td>` : ""}<td>${i < 3 ? ["🥇", "🥈", "🥉"][i] + " " : ""}${esc(f.titulo)}</td><td class="num">${f.ventas}</td><td class="num">${f.clientes}</td><td class="num">${f.mostrado}</td><td class="num">${f.avisos}</td></tr>`).join("")}</table></div>`;
}

export function vistaErrores(filas, cabecera = "", { soloErrores = false } = {}) {
  const enlaces = [1, 7, 14, 30].map((n) => `<a href="?dias=${n}${soloErrores ? "&solo=1" : ""}">${n === 1 ? "hoy y ayer" : `${n} días`}</a>`).join(" · ");
  const otro = soloErrores ? `<a href="?">ver también las correcciones 🛡️</a>` : `<a href="?solo=1">ver solo los errores ⚙️</a>`;
  const lista = soloErrores ? filas.filter((e) => e.tipo === "error") : filas;
  const arriba = `${cabecera}<p class="suave">⚙️ = un error técnico del registro (Meta, OpenAI, Slack, la base…). 🛡️ = una red de seguridad que corrigió a la IA (es bueno saberlo, pero no es una avería).</p><p class="suave">Ver: ${enlaces} · ${otro}</p>`;
  if (!lista.length) return `${arriba}<div class="tarjeta suave">Sin errores en estos días ✅</div>`;
  return `${arriba}${lista
    .map((e) => `<div class="tarjeta"><b class="${e.tipo === "error" ? "mal" : "aviso"}">${e.tipo === "error" ? "⚙️" : "🛡️"} ${e.tiendaNombre ? `${esc(e.tiendaNombre)} · ` : ""}${esc(horaExacta(e.cuando))}</b><pre>${esc(e.texto)}</pre></div>`)
    .join("")}`;
}

/* ── Gastos de todas las tiendas ─────────────────────────────────── */

export function vistaGastos(respuestas) {
  const buenas = respuestas.filter((r) => r.ok && r.datos?.gasto);
  const total = buenas.reduce((s, r) => s + (Number(r.datos.gasto.total) || 0), 0);
  const proyectado = buenas.reduce((s, r) => s + (Number(r.datos.gasto.proyectado) || 0), 0);
  const mensajes = respuestas.reduce((s, r) => s + (r.ok ? Number(r.datos?.semana?.respuestas) || 0 : 0), 0);
  const filas = respuestas
    .map((r) => {
      if (!r.ok) return `<tr><td>${esc(r.tienda.nombre)}</td><td colspan="4" class="mal">🚨 ${esc(r.error)}</td></tr>`;
      const g = r.datos.gasto || {};
      const porRespuesta = r.datos.semana?.respuestas ? (Number(g.total) || 0) / Math.max(1, Number(g.dias) || 1) / Math.max(1, r.datos.semana.respuestas / 7) : 0;
      return `<tr><td><a href="/t/${esc(r.tienda.id)}">${esc(r.tienda.nombre)}</a></td><td class="num">${dolares(g.total)}</td><td class="num">${dolares(g.proyectado)}</td><td class="num">${r.datos.semana?.respuestas || 0}</td><td class="num">${porRespuesta ? `$${porRespuesta.toFixed(4)}` : "—"}</td></tr>`;
    })
    .join("");
  const modelos = new Map();
  for (const r of buenas) {
    for (const f of r.datos.gasto.filas || []) {
      const m = modelos.get(f.modelo) || { modelo: f.modelo, llamadas: 0, dolares: 0 };
      m.llamadas += Number(f.llamadas) || 0;
      m.dolares += Number(f.dolares) || 0;
      modelos.set(f.modelo, m);
    }
  }
  return `<h2>Gastos de OpenAI</h2><p class="suave">Lo que lleva cada tienda este mes, contado por cada llamada a OpenAI (texto, visión, voz y el revisor). "El mes saldrá en" es una regla de tres con los días que van.</p>
<div class="kpis">${kpi(dolares(total), "gastado este mes")}${kpi(dolares(proyectado), "el mes saldrá en")}${kpi(mensajes, "respuestas de la IA (7 días)")}</div>
<div class="tabla"><table><tr><th>Tienda</th><th class="num">Este mes</th><th class="num">El mes saldrá en</th><th class="num">Respuestas (7 días)</th><th class="num">Por respuesta (aprox.)</th></tr>${filas}</table></div>
<h3>Por modelo, todas las tiendas</h3>${
    modelos.size
      ? `<div class="tabla"><table><tr><th>Modelo</th><th class="num">Llamadas</th><th class="num">Dólares</th></tr>${[...modelos.values()]
          .sort((a, b) => b.dolares - a.dolares)
          .map((m) => `<tr><td>${esc(m.modelo)}</td><td class="num">${m.llamadas}</td><td class="num">${dolares(m.dolares)}</td></tr>`)
          .join("")}</table></div>`
      : '<div class="tarjeta suave">Todavía sin gasto este mes.</div>'
  }`;
}

/* ── Estado: ¿responde cada tienda? ──────────────────────────────── */

export function vistaSalud(tiendas, salud, version, faltan = []) {
  const filas = tiendas
    .map((t) => {
      const s = salud[t.id];
      if (!s) return `<tr><td>${esc(t.nombre)}</td><td>⏳ Sin comprobar todavía</td><td></td><td class="suave">${esc(t.url)}</td></tr>`;
      return `<tr><td><a href="/t/${esc(t.id)}">${esc(t.nombre)}</a></td><td class="${s.bien ? "bien" : "mal"}">${s.bien ? "✅ Responde" : "🚨 No responde"} desde ${esc(horaExacta(s.desde))}</td><td>${esc(s.detalle)}</td><td class="suave">comprobado ${esc(cuandoFue(s.visto))}</td></tr>`;
    })
    .join("");
  return `<h2>Estado de las tiendas</h2><p class="suave">Cada 2 minutos el panel le pregunta a cada tienda si está viva. Si deja de responder, salta una alerta 🚨; cuando vuelve, otra ✅.</p>
${faltan.length ? `<div class="tarjeta mal">Faltan claves: ${faltan.map((f) => `<code>${esc(f)}</code>`).join(", ")}. Ponlas con <code>npx.cmd wrangler secret put NOMBRE</code>.</div>` : ""}
<div class="tabla"><table><tr><th>Tienda</th><th>Estado</th><th>Versión o motivo</th><th></th></tr>${filas || '<tr><td colspan="4">No hay tiendas en TIENDAS (wrangler.toml).</td></tr>'}</table></div>
<p class="suave">Panel central: ${esc(version)}</p>`;
}

export function vistaChats(t, lista, { q = "", f = "" } = {}) {
  const filtro = (clave, nombre) => `<a class="${f === clave ? "activa" : ""}" href="/t/${esc(t.id)}/chats${clave ? `?f=${clave}` : ""}">${esc(nombre)}</a>`;
  return `${pestanasDeTienda(t, "chats")}
<form class="fila" method="get"><input name="q" value="${esc(q)}" placeholder="Buscar por nombre, @usuario o lo que escribió">${f ? `<input type="hidden" name="f" value="${esc(f)}">` : ""}<button>Buscar</button></form>
<div class="leyenda">${Object.values(MARCAS).map((m) => `<span>${m.simbolo} ${esc(m.nombre)}</span>`).join("")}</div>
<div class="pestanas">${filtro("", "Todas")}${filtro("problemas", "Con problemas")}${filtro("pausados", "Bot en pausa")}${filtro("anuncios", "Vinieron de un anuncio")}</div>
${f === "pausados" && lista.some((c) => c.pausado) ? botonDevolverTodas(t, lista.filter((c) => c.pausado).length, `/t/${t.id}/chats?f=pausados`) : ""}
${lista.length ? lista.map((c) => tarjetaDeChat(t, c, `/t/${t.id}/chats${f || q ? `?${new URLSearchParams({ ...(f ? { f } : {}), ...(q ? { q } : {}) })}` : ""}`)).join("") : `<div class="tarjeta suave">${f === "pausados" ? "Nadie en pausa: el bot está atendiendo a todos ✅" : "No hay conversaciones con eso."}</div>`}`;
}

// Una persona en la lista. Si el bot está en pausa con ella, lleva el botón
// para devolvérsela al bot ahí mismo, sin abrir la conversación.
function tarjetaDeChat(t, c, volver, { conTienda = false } = {}) {
  const enlace = `<a class="${c.pausado ? "dentro" : "tarjeta"}" href="/t/${esc(t.id)}/c/${encodeURIComponent(c.id)}"><span class="nombre">${esc(c.nombre || c.usuario || c.id)}</span>${c.usuario ? ` <span class="suave">@${esc(c.usuario)}</span>` : ""}${conTienda ? ` <span class="etiqueta">${esc(t.nombre)}</span>` : ""}
${Object.entries(c.problemas || {}).map(([m, n]) => `<span class="etiqueta mal">${MARCAS[m]?.simbolo || "!"} ${n}</span>`).join("")}${c.pausado ? `<span class="etiqueta mal">⏸️ bot en pausa${c.pausadoHasta ? ` hasta ${esc(horaExacta(c.pausadoHasta))}` : ""}</span>` : ""}${c.anuncio ? `<span class="etiqueta">📣 ${esc(String(c.anuncio).slice(0, 30))}</span>` : ""}
<div class="suave">${esc(cuandoFue(c.ultimo))}${c.ultima ? ` · ${c.ultima.de === "bot" ? "Bot: " : c.ultima.de === "asesor" ? "Asesor: " : ""}${esc(String(c.ultima.texto || "").slice(0, 90))}` : ""}</div></a>`;
  if (!c.pausado) return enlace;
  return `<div class="tarjeta">${enlace}<form class="dentro" method="post" action="/t/${esc(t.id)}/devolver"><input type="hidden" name="id" value="${esc(c.id)}"><input type="hidden" name="volver" value="${esc(volver)}"><button class="principal">▶️ Devolverle la conversación al bot</button></form></div>`;
}

function botonDevolverTodas(t, cuantas, volver) {
  return `<form class="acciones" method="post" action="/t/${esc(t.id)}/devolver-todos" onsubmit="return confirm('¿Devolverle al bot las ${cuantas} conversaciones en pausa de ${esc(t.nombre)}?')"><input type="hidden" name="volver" value="${esc(volver)}"><button>▶️ Devolverle todas al bot (${cuantas})</button></form>`;
}

// TODAS LAS PERSONAS EN PAUSA, DE TODAS LAS TIENDAS. El bot no les habla
// mientras un asesor las atiende; aquí se ven juntas y se devuelven al bot.
export function vistaEnPausa(respuestas) {
  const total = respuestas.reduce((s, r) => s + (r.ok ? r.datos.filter((c) => c.pausado).length : 0), 0);
  const bloques = respuestas
    .map((r) => {
      if (!r.ok) return `<h3>${esc(r.tienda.nombre)}</h3><div class="tarjeta mal">🚨 No pude leer esta tienda: ${esc(r.error)}</div>`;
      const pausados = r.datos.filter((c) => c.pausado);
      return `<h3>${esc(r.tienda.nombre)} <span class="suave">· ${pausados.length} en pausa</span></h3>${
        pausados.length
          ? botonDevolverTodas(r.tienda, pausados.length, "/en-pausa") + pausados.map((c) => tarjetaDeChat(r.tienda, c, "/en-pausa")).join("")
          : '<div class="tarjeta suave">Nadie en pausa ✅</div>'
      }`;
    })
    .join("");
  return `<h2>⏸️ En pausa</h2><p class="suave">Personas con las que el bot está callado porque las atiende un asesor (o porque se pausó a mano). La pausa se quita sola a las horas de PAUSA_HORAS; aquí se puede quitar ya. Al devolverla, el bot sabe que alguien ya estuvo atendiendo y no saluda de cero.</p>
<div class="kpis">${kpi(total, "conversaciones en pausa")}</div>${bloques}`;
}

// EL RECORRIDO DE UNA RESPUESTA: por qué pasos pasó (ver "Cómo funciona").
function recorrido(turno) {
  const notas = (turno.notas || []).join(" · ");
  const pasos = [];
  pasos.push(/nota de voz/i.test(notas) || String(turno.cliente || "").startsWith("🎤") ? "🎤 Escuchó la nota de voz" : "📩 Leyó el mensaje");
  if (/anuncio/i.test(notas)) pasos.push("📣 Venía de un anuncio");
  if (turno.pienso) pasos.push("🧠 Pensó");
  pasos.push(turno.buscar && String(turno.buscar).toUpperCase() !== "NADA" ? `🔎 Buscó “${turno.buscar}”` : "🔎 No buscó");
  if ((turno.productos || []).length) pasos.push(`🗂 ${turno.productos.length} ficha(s)`);
  for (const n of turno.notas || []) {
    if (/grosería|regaño|marca que no hay|Cashea|catálogo|precio|inventad/i.test(n)) pasos.push(`🛡 ${n}`);
  }
  if (/borrador era/i.test(notas)) pasos.push("✍️ Redactó viendo los resultados");
  pasos.push(/contestó con nota de voz/i.test(notas) ? "📤🎤 Respondió con voz" : "📤 Respondió");
  pasos.push(MARCAS[turno.marca] ? `${MARCAS[turno.marca].simbolo} ${MARCAS[turno.marca].nombre}` : "✅ Sin problemas");
  return `<div class="recorrido">${pasos.map((p) => `<span class="paso">${esc(p)}</span>`).join("→")}</div>`;
}

function cajaDeTurno(t) {
  const m = MARCAS[t.marca];
  return `<div class="pienso">${m ? `<div class="sello ${t.marca === "error" || t.marca === "indebida" ? "mal" : "aviso"}">${m.simbolo} ${esc(m.nombre)}${t.motivo ? `: ${esc(t.motivo)}` : ""}</div>` : ""}
${t.pienso ? `<b>🧠 Lo que pensó la IA</b><div>${esc(t.pienso)}</div>` : ""}${recorrido(t)}
${(t.productos || []).length ? `<div>Fichas: ${t.productos.map(esc).join(", ")}</div>` : ""}${(t.notas || []).length ? `<div class="suave">🛠 ${t.notas.map(esc).join(" · ")}</div>` : ""}
<div class="suave">${esc(horaExacta(t.cuando))}</div></div>`;
}

export function vistaConversacion(t, datos) {
  const { contacto, mensajes = [], turnos = [], horasDePausa = 1 } = datos;
  const usados = new Set();
  const normal = (x) => String(x || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const burbujas = mensajes
    .map((l) => {
      const quien = l.de === "asesor" ? "Asesor (a mano)" : l.de === "bot" ? "Bot" : "Cliente";
      let caja = `<div class="burbuja de-${l.de === "asesor" ? "asesor" : l.de === "bot" ? "bot" : "cliente"}"><span class="quien">${quien}${l.cuando ? ` · ${esc(horaExacta(l.cuando))}` : ""}</span>${esc(l.texto)}</div>`;
      if (l.de !== "bot") return caja;
      const i = turnos.findIndex((x, n) => !usados.has(n) && normal(x.respuesta) && normal(x.respuesta) === normal(l.texto));
      if (i === -1) return caja;
      usados.add(i);
      const m = MARCAS[turnos[i].marca];
      if (m) caja = caja.replace('<span class="quien">', `<span class="quien">${m.simbolo} `);
      return caja + cajaDeTurno(turnos[i]);
    })
    .join("");
  const sueltos = turnos.filter((_, n) => !usados.has(n));
  const pausado = Number(contacto.pausado_hasta) > Date.now();
  const id = encodeURIComponent(contacto.id);
  return `<p><a href="/t/${esc(t.id)}/chats">← Chats de ${esc(t.nombre)}</a></p>
<div class="tarjeta"><span class="nombre">${esc(contacto.nombre || contacto.usuario || contacto.id)}</span>${contacto.usuario ? ` <span class="suave">@${esc(contacto.usuario)}</span>` : ""}
<div class="suave">Id ${esc(contacto.id)} · último mensaje del bot ${esc(cuandoFue(contacto.ultimo_envio))}</div>
${contacto.anuncio ? `<div>📣 Llegó por un anuncio${contacto.anuncio.equipo ? ` del <b>${esc(contacto.anuncio.equipo)}</b>` : ""}</div>` : ""}
${contacto.historial ? `<div class="suave">Resumen: ${esc(contacto.historial)}</div>` : ""}
<form class="acciones" method="post" action="/t/${esc(t.id)}/${pausado ? "devolver" : "pausar"}"><input type="hidden" name="id" value="${esc(contacto.id)}">
${pausado ? `<span class="etiqueta mal">Bot en pausa hasta ${esc(horaExacta(contacto.pausado_hasta))}</span><button class="principal">Devolverle la conversación al bot</button>` : `<button>Pausar el bot ${esc(horasDePausa)} h (la atiendo yo)</button>`}</form></div>
<div class="leyenda">${Object.values(MARCAS).map((m) => `<span>${m.simbolo} ${esc(m.nombre)}</span>`).join("")}</div>
<div class="chat">${burbujas || '<p class="suave">Todavía no hay mensajes guardados de esta persona.</p>'}</div>
${sueltos.length ? `<h3>Más de lo que pensó la IA</h3><div class="chat">${sueltos.map((x) => `${x.cliente ? `<div class="burbuja de-cliente">${esc(x.cliente)}</div>` : ""}<div class="burbuja de-bot">${esc(x.respuesta)}</div>${cajaDeTurno(x)}`).join("")}</div>` : ""}
<p class="suave">Ver también: <a href="/t/${esc(t.id)}/bases/mensajes?q=${id}">sus filas en la base</a></p>`;
}

/* ── En vivo: los mensajes entrando ──────────────────────────────── */

// La página llega vacía y se llena sola: pregunta cada 4 segundos (solo con
// la pestaña a la vista) qué hay de nuevo en cada tienda. Todo se pinta con
// textContent: lo que escriben los clientes nunca se interpreta como HTML.
const SCRIPT_EN_VIVO = `<script>
(function(){
  var lista=document.getElementById("vivo-lista"),estado=document.getElementById("vivo-estado"),boton=document.getElementById("vivo-pausa");
  var filtro=lista.dataset.tienda||"",cursor=null,pausado=false,ocupado=false;
  var MARCAS={error:["❌","Error del bot"],indebida:["🔴","Respuesta indebida"],corregida:["⚠️","La IA inventó algo y se corrigió"],queja:["👎","El cliente se quejó"]};
  var QUIEN={cliente:["👤","Cliente"],bot:["🤖","Bot"],asesor:["🧑‍💼","Asesor (a mano)"]};
  function hora(ms){try{return new Date(ms).toLocaleTimeString("es-VE",{hour:"2-digit",minute:"2-digit",second:"2-digit",timeZone:"America/Caracas"})}catch(e){return ""}}
  function linea(padre,clase,texto){var d=document.createElement("div");if(clase)d.className=clase;d.textContent=texto;padre.appendChild(d);return d}
  function sello(e){var m=MARCAS[e.marca];return m?m[0]+" "+m[1]+(e.motivo?": "+e.motivo:""):""}
  function item(e){
    var a=document.createElement("a");a.href=e.enlace;a.className="tarjeta";
    var cabeza=document.createElement("div");var b=document.createElement("b");
    if(e.tipo==="turno"){a.className+=" es-turno";a.dataset.turno=e.clave;b.textContent="🧠 Lo que pensó la IA · "+e.nombre}
    else{var q=QUIEN[e.de]||QUIEN.cliente;a.className+=" de-"+e.de;b.textContent=q[0]+" "+q[1]+" · "+e.nombre}
    cabeza.appendChild(b);var s=document.createElement("span");s.className="suave cuando";s.textContent=e.tiendaNombre+" · "+hora(e.cuando);cabeza.appendChild(s);a.appendChild(cabeza);
    if(e.tipo==="turno"){
      var m=linea(a,"sello mal",sello(e));if(!e.marca)m.style.display="none";
      if(e.pienso)linea(a,"cuerpo",e.pienso);
      if(e.productos&&e.productos.length)linea(a,"suave","🗂 Fichas: "+e.productos.join(", "));
      if(e.notas&&e.notas.length)linea(a,"suave","🛠 "+e.notas.join(" · "));
    }else linea(a,"cuerpo",e.texto);
    return a;
  }
  function vacio(){if(!lista.children.length){var p=document.createElement("div");p.className="tarjeta suave";p.id="vivo-vacio";p.textContent="Esperando mensajes… en cuanto escriba alguien, sale aquí.";lista.appendChild(p)}}
  function pedir(){
    if(pausado||ocupado||document.visibilityState!=="visible")return;
    ocupado=true;
    fetch("/en-vivo/datos?tienda="+encodeURIComponent(filtro)+"&c="+encodeURIComponent(JSON.stringify(cursor||{})),{credentials:"same-origin"})
    .then(function(r){return r.ok?r.json():null}).then(function(d){
      ocupado=false;if(!d)return;
      var primera=!cursor;cursor=d.cursor||{};
      if(d.eventos.length){var v=document.getElementById("vivo-vacio");if(v)v.remove()}
      d.eventos.forEach(function(e){var n=item(e);if(!primera)n.classList.add("nuevo");lista.insertBefore(n,lista.firstChild)});
      (d.marcas||[]).forEach(function(m){
        var n=lista.querySelector('[data-turno="'+(window.CSS&&CSS.escape?CSS.escape(m.clave):m.clave)+'"]');
        if(n){var x=n.querySelector(".sello");if(x){x.textContent=sello(m);x.style.display=""}}
      });
      while(lista.children.length>300)lista.removeChild(lista.lastChild);
      vacio();
      estado.textContent="🟢 En vivo · revisado a las "+hora(Date.now())+(d.caidas&&d.caidas.length?" · 🚨 sin respuesta: "+d.caidas.join(", "):"");
    }).catch(function(){ocupado=false;estado.textContent="⚠️ Sin conexión con el panel, reintentando…"})
  }
  boton.onclick=function(){pausado=!pausado;boton.textContent=pausado?"▶️ Seguir":"⏸ Pausar";estado.textContent=pausado?"⏸ En pausa":"🟢 En vivo";if(!pausado)pedir()};
  document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible")pedir()});
  pedir();setInterval(pedir,4000);
})();
</script>`;

export function vistaEnVivo(tiendas, { tienda = null } = {}) {
  const arriba = tienda
    ? pestanasDeTienda(tienda, "en-vivo")
    : `<h2>🟢 En vivo</h2><div class="pestanas"><a class="activa" href="/en-vivo">Todas</a>${tiendas.map((t) => `<a href="/t/${esc(t.id)}/en-vivo">${esc(t.nombre)}</a>`).join("")}</div>`;
  return `${arriba}<p class="suave">Los mensajes van entrando solos, el más nuevo arriba: 👤 cliente, 🤖 bot, 🧑‍💼 asesor y 🧠 lo que pensó la IA antes de responder. Toca uno para abrir la conversación entera.</p>
<div class="leyenda">${Object.values(MARCAS).map((m) => `<span>${m.simbolo} ${esc(m.nombre)}</span>`).join("")}</div>
<div class="acciones"><span id="vivo-estado" class="suave">Conectando…</span><button id="vivo-pausa">⏸ Pausar</button></div>
<div id="vivo-lista" class="vivo-lista" data-tienda="${esc(tienda?.id || "")}"></div>${SCRIPT_EN_VIVO}`;
}

/* ── Las bases de datos ──────────────────────────────────────────── */

export function vistaTablas(t, tablas) {
  return `${pestanasDeTienda(t, "bases")}
<p class="suave">Todas las tablas que usa el bot de ${esc(t.nombre)}. Puedes ver, buscar, editar y borrar filas: cada cambio queda en el <a href="/t/${esc(t.id)}/cambios">historial</a> y se puede deshacer.</p>
<p><a href="/t/${esc(t.id)}/sql">⌨️ Consola SQL</a> · <a href="/t/${esc(t.id)}/cambios">🕓 Historial de cambios</a></p>
<div class="tabla"><table><tr><th>Tabla</th><th class="num">Filas</th><th>Columnas</th></tr>
${tablas.map((x) => `<tr><td><a href="/t/${esc(t.id)}/bases/${encodeURIComponent(x.nombre)}">${esc(x.nombre)}</a></td><td class="num">${x.filas}</td><td class="suave">${x.columnas.map((c) => esc(c.nombre)).join(", ")}</td></tr>`).join("")}</table></div>`;
}

export function vistaTabla(t, datos, q = "") {
  const { tabla, columnas, filas, total, pagina, porPagina } = datos;
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const base = `/t/${esc(t.id)}/bases/${encodeURIComponent(tabla)}`;
  const navegar = `${pagina > 1 ? `<a href="${base}?pagina=${pagina - 1}&q=${encodeURIComponent(q)}">← Anterior</a>` : ""} Página ${pagina} de ${paginas} · ${total} filas ${pagina < paginas ? `<a href="${base}?pagina=${pagina + 1}&q=${encodeURIComponent(q)}">Siguiente →</a>` : ""}`;
  return `${pestanasDeTienda(t, "bases")}<p><a href="/t/${esc(t.id)}/bases">← Tablas</a></p><h3>${esc(tabla)}</h3>
<form class="fila" method="get"><input name="q" value="${esc(q)}" placeholder="Buscar en todas las columnas"><button>Buscar</button></form>
<p class="suave">${navegar}</p>
<div class="tabla"><table><tr><th></th><th>rowid</th>${columnas.map((c) => `<th>${esc(c.nombre)}${c.clave ? " 🔑" : ""}</th>`).join("")}</tr>
${filas.map((f) => `<tr><td><a href="${base}/${f._rowid}">✏️</a></td><td class="num">${esc(f._rowid)}</td>${columnas.map((c) => `<td><span class="corto" title="${esc(String(f[c.nombre] ?? "").slice(0, 500))}">${esc(String(f[c.nombre] ?? "").slice(0, 120))}</span></td>`).join("")}</tr>`).join("")}</table></div>
<p class="suave">${navegar}</p>`;
}

export function vistaFila(t, datos, mensaje = "") {
  const { tabla, columnas, fila } = datos;
  const base = `/t/${esc(t.id)}/bases/${encodeURIComponent(tabla)}`;
  return `${pestanasDeTienda(t, "bases")}<p><a href="${base}">← ${esc(tabla)}</a></p><h3>${esc(tabla)} · fila ${esc(fila._rowid)}</h3>
${mensaje ? `<div class="tarjeta bien">${esc(mensaje)}</div>` : ""}
<form method="post" action="${base}/${esc(fila._rowid)}">
${columnas.map((c) => `<div class="tarjeta"><label><b>${esc(c.nombre)}</b> <span class="suave">${esc(c.tipo)}${c.clave ? " · clave" : ""}</span><br>
<textarea name="c:${esc(c.nombre)}">\n${esc(fila[c.nombre] ?? "")}</textarea></label></div>`).join("")}
<div class="acciones"><button class="principal">Guardar cambios</button></div></form>
<form method="post" action="${base}/${esc(fila._rowid)}/borrar" onsubmit="return confirm('¿Borrar esta fila? Queda en el historial y se puede deshacer.')">
<button class="peligro">Borrar esta fila</button></form>`;
}

export function vistaSql(t, sql = "", resultado = null) {
  let salida = "";
  if (resultado?.error) salida = `<div class="tarjeta mal">❌ ${esc(resultado.error)}</div>`;
  else if (resultado?.filas) {
    const cols = Object.keys(resultado.filas[0] || {});
    salida = `<p class="suave">${resultado.total} fila(s)${resultado.total > 500 ? " (se enseñan 500)" : ""}</p><div class="tabla"><table><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>
${resultado.filas.map((f) => `<tr>${cols.map((c) => `<td><span class="corto" title="${esc(String(f[c] ?? "").slice(0, 500))}">${esc(String(f[c] ?? "").slice(0, 120))}</span></td>`).join("")}</tr>`).join("")}</table></div>`;
  } else if (resultado?.ok) salida = `<div class="tarjeta bien">✅ Hecho${resultado.cambios != null ? `: ${resultado.cambios} fila(s) cambiada(s)` : ""}. Quedó en el historial.</div>`;
  return `${pestanasDeTienda(t, "bases")}<p><a href="/t/${esc(t.id)}/bases">← Tablas</a></p><h3>⌨️ Consola SQL</h3>
<p class="suave">SELECT, PRAGMA y WITH solo leen. UPDATE, DELETE, INSERT y demás cambian la base de verdad: un SQL no se deshace solo, así que revisa antes de ejecutar (queda anotado en el historial).</p>
<form method="post" action="/t/${esc(t.id)}/sql"><textarea name="sql" placeholder="SELECT * FROM contactos ORDER BY ultimo_envio DESC LIMIT 20">${esc(sql)}</textarea>
<div class="acciones"><button class="principal">Ejecutar</button></div></form>${salida}`;
}

export function vistaCambios(t, cambios) {
  return `${pestanasDeTienda(t, "bases")}<p><a href="/t/${esc(t.id)}/bases">← Tablas</a></p><h3>🕓 Historial de cambios</h3>
${cambios.length ? cambios.map((c) => `<div class="tarjeta"><b>${esc(horaExacta(c.cuando))} · ${esc(c.accion)}${c.tabla ? ` en ${esc(c.tabla)}` : ""}${c.fila != null ? ` (fila ${esc(c.fila)})` : ""}</b>${c.deshecho ? ' <span class="etiqueta">deshecho</span>' : ""}
${c.antes ? `<details><summary>Cómo estaba</summary><pre>${esc(c.antes)}</pre></details>` : ""}${c.despues ? `<details><summary>Cómo quedó</summary><pre>${esc(c.despues)}</pre></details>` : ""}
${!c.deshecho && c.accion !== "sql" ? `<form method="post" action="/t/${esc(t.id)}/deshacer" onsubmit="return confirm('¿Deshacer este cambio?')"><input type="hidden" name="id" value="${esc(c.id)}"><button>↩️ Deshacer</button></form>` : ""}</div>`).join("") : '<div class="tarjeta suave">Todavía no se ha cambiado nada desde el panel.</div>'}`;
}

/* ── Cómo funciona: el diagrama de flujo ─────────────────────────── */

function nodo(icono, titulo, texto, clase = "") {
  return `<div class="nodo ${clase}"><b>${icono} ${esc(titulo)}</b><span class="suave">${texto}</span></div>`;
}
const F = '<div class="flecha">↓</div>';

export function vistaComoFunciona() {
  return `<h2>Cómo funciona el bot, paso a paso</h2>
<p class="suave">Esto es lo que hace cada tienda con cada mensaje de Instagram. En cada conversación, debajo de cada respuesta, ves su <b>recorrido</b>: por cuáles de estos pasos pasó de verdad.</p>
<div class="flujo">
${nodo("📩", "1. Llega el mensaje", "Instagram avisa al Worker de la tienda: texto, foto, nota de voz, respuesta a una historia, publicación compartida, comentario o alguien que viene de un anuncio. Se le contesta a Meta al instante y el trabajo sigue aparte.")}${F}
${nodo("❓", "2. ¿Lo escribió un asesor a mano?", "Si el mensaje salió de la cuenta y no fue el bot, es una persona: el bot se pone en pausa con ese cliente para no hablarle encima.", "decision")}${F}
${nodo("⏸️", "3. ¿El bot está en pausa con este cliente?", "Si un asesor lo está atendiendo, el bot solo le dice que ya lo atienden. Si el asesor lleva rato callado, el bot vuelve solo.", "decision")}${F}
${nodo("🎤", "4. Nota de voz → texto", "Se baja el audio y OpenAI lo transcribe. Desde aquí se atiende como si lo hubiera escrito. (Invictus puede contestar con voz; EPICELL siempre por escrito.)")}${F}
${nodo("⚡", "5. Atajos sin IA", "Lo que tiene una respuesta exacta no pasa por la IA: horario, métodos de pago, ubicación, la lista de una marca, \"muéstrame esos\", divisas, un saludo suelto. Así no se inventa.")}${F}
${nodo("👁", "6. Foto, publicación o anuncio", "Una IA de visión mira la imagen y dice qué producto es. Si viene de un anuncio, el bot sabe de qué equipo es y lo recuerda 7 días, con sus precios.")}${F}
${nodo("🧠", "7. La IA piensa", "Lee la conversación entera, el catálogo actual y lo que sabe de la tienda. Escribe lo que piensa (\"pienso\"), decide qué buscar y si responde con texto, con fichas o solo fichas.")}${F}
${nodo("🔎", "8. Busca en el catálogo", "Shopify (Invictus) o la hoja de Google (EPICELL). Si no hay justo eso, rescata: la misma familia, otra capacidad, o lo más parecido.")}${F}
${nodo("🛡️", "9. Las redes de seguridad", "Antes de salir, el código revisa lo que escribió la IA: precios inventados, groserías o regaños, marcas que no hay, porcentajes de Cashea, que niegue el catálogo, \"¿quieres saber el precio?\". Si atrapa algo, lo corrige y la respuesta queda marcada ⚠️.", "red")}${F}
${nodo("✍️", "10. Redacta viendo los resultados (EPICELL)", "Con las fichas que de verdad salieron delante, la IA escribe la respuesta final. Las redes vuelven a pasar por encima.")}${F}
${nodo("📤", "11. Responde", "Texto, fichas con foto y precio, nota de voz o el botón del catálogo. Cada mensaje queda guardado para los paneles.")}${F}
<div class="rama">${nodo("🧑‍💼", "12a. ¿Hace falta una persona?", "Si va a comprar, pregunta algo que solo sabe una persona (color, garantía) o hubo un fallo: aviso al asesor por Slack. Esos avisos son los que hacen \"ganador\" a un producto.", "decision")}
${nodo("🧐", "12b. El revisor", "Con todo ya enviado, otra IA lee la respuesta y la marca 🔴 si alucinó, fue incoherente o no contestó lo que le preguntaron.", "red")}</div>${F}
${nodo("🔔", "13. Panel central, en tiempo real", "Cada error ❌, respuesta indebida 🔴, corrección ⚠️ o queja del cliente 👎 llega aquí en el momento: campana, aviso en pantalla y notificación. Cada 2 minutos, además, se comprueba que cada tienda responda. Y en 🟢 En vivo ves entrar cada mensaje, con lo que pensó la IA.")}
</div>
<h3>Los símbolos</h3><div class="leyenda">${Object.values(MARCAS).map((m) => `<span>${m.simbolo} ${esc(m.nombre)}</span>`).join("")}<span>✅ Sin problemas</span></div>`;
}
