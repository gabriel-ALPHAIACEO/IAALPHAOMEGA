// EL MARCO DE LA APP (7-oct-2026): la barra lateral, las pestañas del
// teléfono, la cabecera de cada pantalla y las piezas que se repiten
// (cifras, avisos, listas, estados vacíos).
//
// QUÉ SE PEDÍA. El dueño: "nada genérico, algo único que se vea bien hecho
// al abrirse; sin los emojis de Android; animaciones naturales y fluidas,
// nada cuadrado, una interfaz más amigable". Esto es esa cara:
//
//   · En la computadora, una barra lateral con dos grupos (Tu negocio y
//     Ventas con IA). La pastilla de la sección activa se DESLIZA a la
//     nueva cuando se cambia de pantalla (View Transitions: el navegador
//     anima entre una página y la otra; donde no lo sabe hacer, cambia sin
//     animación y todo funciona igual).
//   · En el teléfono, una isla flotante abajo con Inicio, Caja, Inventario,
//     Chats y "Más" (una hoja que sube desde abajo con el resto).
//   · Los números grandes cuentan desde cero al abrir; los avisos ("Venta
//     registrada") bajan desde arriba y se van solos.
//   · Todo respeta "reducir movimiento" del teléfono.
//
// ESTE ARCHIVO ES IGUAL EN LAS TRES TIENDAS. El panel central tiene el suyo
// (vistas.js) y comparte con este solo alpha.js e iconos.js.

import { ESTILO_ALPHA, SCRIPT_ALPHA, etiquetasDeApp, scriptDeApp, botonDeTema, SCRIPT_TEMA } from "./alpha.js";
import { SPRITE_ICONOS, icono } from "./iconos.js";

export function esc(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ── Números y fechas, como se dicen en Venezuela ────────────────────── */

const ZONA = "America/Caracas";

// 1234.5 → "$1.234,50"; 45 → "$45". null → "" (no se inventa un 0).
export function plata(n, { siempre = false } = {}) {
  if (n === null || n === undefined || n === "") return siempre ? "$0" : "";
  const v = Number(n);
  if (!Number.isFinite(v)) return siempre ? "$0" : "";
  const entero = Math.abs(v - Math.round(v)) < 0.005;
  const texto = Math.abs(v).toLocaleString("es-VE", { minimumFractionDigits: entero ? 0 : 2, maximumFractionDigits: entero ? 0 : 2 });
  return `${v < 0 ? "−" : ""}$${texto}`;
}

export function numero(n) {
  return (Number(n) || 0).toLocaleString("es-VE", { maximumFractionDigits: 2 });
}

// Una cifra que cuenta desde cero al abrir la página (sin JS, ya se ve el
// número final: el script solo la anima).
export function cifra(n, { tipo = "plata", clase = "" } = {}) {
  const v = Number(n) || 0;
  const texto = tipo === "plata" ? plata(v, { siempre: true }) : tipo === "porcentaje" ? `${Math.round(v)}%` : numero(v);
  return `<span class="cifra${clase ? ` ${clase}` : ""}" data-contar="${v}" data-tipo="${esc(tipo)}">${esc(texto)}</span>`;
}

export function horaCorta(ms) {
  if (!ms) return "";
  return new Date(Number(ms)).toLocaleTimeString("es-VE", { hour: "numeric", minute: "2-digit", timeZone: ZONA }).replace(/\s?a\.\s?m\./i, " a. m.").replace(/\s?p\.\s?m\./i, " p. m.");
}

export function fechaHora(ms) {
  if (!ms) return "";
  return new Date(Number(ms)).toLocaleString("es-VE", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: ZONA });
}

// "martes, 7 de octubre"
export function fechaLarga(ms = Date.now()) {
  return new Date(Number(ms)).toLocaleDateString("es-VE", { weekday: "long", day: "numeric", month: "long", timeZone: ZONA });
}

// "2026-10-07" → "Hoy", "Ayer" o "lun 5 oct"
export function diaBonito(dia, hoy) {
  const ms = Date.parse(`${dia}T12:00:00Z`);
  if (!Number.isFinite(ms)) return String(dia || "");
  if (hoy && dia === hoy) return "Hoy";
  if (hoy && Date.parse(`${hoy}T12:00:00Z`) - ms === 86400000) return "Ayer";
  return new Date(ms).toLocaleDateString("es-VE", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).replace(/\./g, "");
}

export function saludo(ms = Date.now()) {
  const hora = Number(new Date(Number(ms)).toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: ZONA })) % 24;
  return hora < 12 ? "Buenos días" : hora < 19 ? "Buenas tardes" : "Buenas noches";
}

/* ── El rubro de la tienda ────────────────────────────────────────── */
//
// Cada tienda funciona según su negocio (Gabriel, 7-oct-2026: "cuando es
// tienda de teléfono es de teléfono y cuando es de zapatos es de zapatos").
// Cada index.js dice el suyo (rubro: "calzado", "moda" o "telefonos") y
// aquí está cómo se llaman las cosas en cada uno: tallas o capacidades,
// gama o condición, y si la caja pide el IMEI.
export const RUBROS = {
  general: { clave: "general", variante: "variante", variantes: "variantes", laVariante: "la variante", ejemploVariantes: "S, M, L, o 38-44", ejemploProducto: "Camisa azul manga larga", gama: "Gama o calidad", ejemploGama: "", conSerial: false },
  calzado: { clave: "calzado", variante: "talla", variantes: "tallas", laVariante: "la talla", ejemploVariantes: "38-44, o 38, 39, 40", ejemploProducto: "Nike Air Force One blanco", gama: "Gama o calidad", ejemploGama: "1.1, AA, AAA", conSerial: false },
  moda: { clave: "moda", variante: "talla", variantes: "tallas", laVariante: "la talla", ejemploVariantes: "38-44, o S, M, L", ejemploProducto: "Gorra New Era negra", gama: "Calidad", ejemploGama: "AA, AAA", conSerial: false },
  telefonos: { clave: "telefonos", variante: "capacidad", variantes: "capacidades", laVariante: "la capacidad", ejemploVariantes: "128GB, 256GB", ejemploProducto: "iPhone 15 Pro Max", gama: "Condición", ejemploGama: "Nuevo, usado, reacondicionado", conSerial: true },
};

export function rubroDe(nombre) {
  return RUBROS[nombre] || RUBROS.general;
}

export function mayuscula(texto) {
  const t = String(texto || "");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/* ── Piezas ──────────────────────────────────────────────────────────── */

export { icono };

// La cabecera de una pantalla: una línea pequeña arriba, el título, una
// frase y, a la derecha, sus botones.
export function cabecera({ sobre = "", titulo, texto = "", acciones = "", volver = null }) {
  const atras = volver ? `<a class="volver" href="${esc(volver.href)}">${icono("atras", { clase: "chico" })}${esc(volver.texto)}</a>` : "";
  return `<div class="cabeza">${atras ? `<div class="cabeza-volver">${atras}</div>` : ""}<div class="cabeza-texto">${sobre ? `<div class="sobre">${esc(sobre)}</div>` : ""}<h1>${esc(titulo)}</h1>${texto ? `<p>${texto}</p>` : ""}</div>${acciones ? `<div class="cabeza-acciones">${acciones}</div>` : ""}</div>`;
}

// Un control segmentado de enlaces (Hoy · Ayer · 7 días…). La pastilla de
// la opción elegida se desliza a la nueva al cambiar.
export function segmento(opciones, activo, { nombre = "segmento" } = {}) {
  return `<nav class="segmento" aria-label="${esc(nombre)}">${opciones
    .map(([valor, texto, href]) => `<a href="${esc(href)}"${valor === activo ? ' class="activo" aria-current="true"' : ""}>${valor === activo ? '<span class="segmento-fondo"></span>' : ""}<span>${esc(texto)}</span></a>`)
    .join("")}</nav>`;
}

// Un número grande con su nombre y su ícono (los cuadritos de arriba).
// Con href se puede tocar.
export function dato({ nombre, valor, icono: nombreIcono = "info", tono = "marca", pie = "", href = "" }) {
  const etiqueta = href ? `a href="${esc(href)}"` : "div";
  return `<${etiqueta} class="dato"><div class="dato-cima"><span class="dato-nombre">${esc(nombre)}</span>${insignia(nombreIcono, tono, "chica")}</div><div class="dato-valor">${valor}</div>${pie ? `<div class="dato-pie">${pie}</div>` : ""}</${href ? "a" : "div"}>`;
}

// Lo que se ve cuando no hay nada: un dibujo, qué pasa y qué hacer.
export function vacio({ icono: nombre = "info", titulo, texto = "", acciones = "" }) {
  return `<div class="vacio"><div class="vacio-dibujo"><span></span>${icono(nombre, { clase: "enorme" })}</div><h3>${esc(titulo)}</h3>${texto ? `<p>${texto}</p>` : ""}${acciones ? `<div class="acciones">${acciones}</div>` : ""}</div>`;
}

// Un ícono dentro de un círculo de color. tono: marca, bien, aviso, mal, ia, neutro.
export function insignia(nombre, tono = "marca", clase = "") {
  return `<span class="insignia tono-${esc(tono)}${clase ? ` ${clase}` : ""}">${icono(nombre)}</span>`;
}

// Las iniciales de una persona en un círculo, con un color propio que sale
// de su nombre (la misma persona, siempre el mismo color).
export function avatar(nombre, { clase = "" } = {}) {
  const limpio = String(nombre || "?").trim();
  const partes = limpio.replace(/^@/, "").split(/\s+/).filter(Boolean);
  const iniciales = ((partes[0]?.[0] || "?") + (partes.length > 1 ? partes.at(-1)[0] : partes[0]?.[1] || "")).toUpperCase();
  let h = 0;
  for (const c of limpio) h = (h * 31 + c.codePointAt(0)) % 360;
  return `<span class="avatar${clase ? ` ${clase}` : ""}" style="--h:${h}" aria-hidden="true">${esc(iniciales)}</span>`;
}

// Cuánto queda, con su color: verde hay, ámbar poco, rojo agotado.
export function pastillaDeStock(n, { umbral = 2 } = {}) {
  const v = Number(n) || 0;
  const clase = v <= 0 ? "cero" : v <= umbral ? "poco" : "hay";
  const texto = v <= 0 ? "Agotado" : v === 1 ? "Queda 1" : v <= umbral ? `Quedan ${v}` : `${numero(v)} en stock`;
  return `<span class="stock ${clase}"><i></i>${esc(texto)}</span>`;
}

// Los avisos que llegan en la dirección (?ok=… o ?error=…) bajan desde
// arriba y se van solos. El script limpia la dirección para que al
// recargar no vuelvan a salir.
export function tostadaDesde(url) {
  const ok = url?.searchParams?.get("ok");
  const error = url?.searchParams?.get("error");
  if (error) return tostada(error, "mal");
  if (ok) return tostada(ok, "bien");
  return "";
}

export function tostada(texto, tono = "bien") {
  return `<div class="tostadas" aria-live="polite"><div class="tostada tono-${esc(tono)}" role="status">${insignia(tono === "mal" ? "alerta" : "check", tono)}<span>${esc(String(texto).slice(0, 400))}</span><button type="button" class="tostada-cerrar" aria-label="Cerrar" data-cerrar-tostada>${icono("cerrar", { clase: "chico" })}</button></div></div>`;
}

// Una ventanita (para confirmar o para un formulario corto). Se abre con
// un botón que lleva popovertarget="<id>". En el teléfono sube desde abajo.
export function ventana(id, { titulo, texto = "", cuerpo = "", icono: nombre = "", tono = "marca" }) {
  return `<div popover id="${esc(id)}" class="ventana"><div class="ventana-asa"></div>${nombre ? insignia(nombre, tono, "grande") : ""}<h3>${esc(titulo)}</h3>${texto ? `<p class="suave">${texto}</p>` : ""}${cuerpo}</div>`;
}

export function botonCerrarVentana(id, texto = "Cancelar") {
  return `<button type="button" class="fantasma" popovertarget="${esc(id)}" popovertargetaction="hide">${esc(texto)}</button>`;
}

/* ── La navegación ───────────────────────────────────────────────────── */

const NEGOCIO = [
  ["inicio", "/panel/inicio", "Inicio", "inicio"],
  ["caja", "/panel/caja", "Caja", "caja"],
  ["ventas", "/panel/ventas", "Ventas", "ventas"],
  ["inventario", "/panel/inventario", "Inventario", "inventario"],
  ["gastos", "/panel/gastos", "Gastos", "gastos"],
  ["fiados", "/panel/fiados", "Fiados", "fiados"],
];

function conIa(conAnuncios) {
  return [
    ["chats", "/panel", "Chats", "chats"],
    ["clientes", "/panel/clientes", "Clientes", "clientes"],
    ["metricas", "/panel/metricas", "Métricas", "metricas"],
    ["ganadores", "/panel/ganadores", "Ganadores", "ganadores"],
    ["errores", "/panel/errores", "Errores IA", "errores"],
    ...(conAnuncios ? [["anuncios", "/panel/anuncios", "Anuncios", "anuncios"]] : []),
  ];
}

const PESTANAS = ["inicio", "caja", "inventario", "chats"];

function enlaceLateral([clave, href, texto, ico], ruta) {
  const activo = clave === ruta;
  return `<a href="${href}"${activo ? ' class="activo" aria-current="page"' : ""}>${activo ? '<span class="pastilla"></span>' : ""}${icono(ico)}<span>${esc(texto)}</span></a>`;
}

function barraLateral({ tienda, ruta, conAnuncios }) {
  return `<aside class="lado" aria-label="Menú">
<a class="lado-marca" href="/panel/inicio"><img src="/panel/isotipo.png?v=1" alt="" width="40" height="28"><span><b>ALPHA <i>IA</i></b><small>${esc(tienda)}</small></span></a>
<nav class="lado-nav"><div class="lado-grupo">Tu negocio</div>${NEGOCIO.map((e) => enlaceLateral(e, ruta)).join("")}
<div class="lado-grupo">Ventas con IA</div>${conIa(conAnuncios).map((e) => enlaceLateral(e, ruta)).join("")}</nav>
<div class="lado-pie">
<button type="button" class="lado-boton instalar-app" data-instalar hidden>${icono("instalar")}<span>Instalar la app</span></button>
<div class="lado-tema"><span>Tema</span>${botonDeTema()}</div>
<a class="lado-boton" href="/panel/salir">${icono("salir")}<span>Salir</span></a>
</div></aside>`;
}

function pestanas({ ruta, conAnuncios }) {
  const todos = [...NEGOCIO, ...conIa(conAnuncios)];
  const enMas = !PESTANAS.includes(ruta) && ruta;
  const una = (clave) => {
    const [, href, texto, ico] = todos.find((e) => e[0] === clave);
    const activo = clave === ruta;
    return `<a href="${href}"${activo ? ' class="activo" aria-current="page"' : ""}><span class="pestana-ico">${activo ? '<span class="pestana-fondo"></span>' : ""}${icono(ico)}</span><span>${esc(texto)}</span></a>`;
  };
  const resto = todos.filter((e) => !PESTANAS.includes(e[0]));
  return `<nav class="pestanas" aria-label="Menú">${PESTANAS.map(una).join("")}<button type="button" popovertarget="hoja-mas"${enMas ? ' class="activo"' : ""}><span class="pestana-ico">${enMas ? '<span class="pestana-fondo"></span>' : ""}${icono("rejilla")}</span><span>Más</span></button></nav>
<div popover id="hoja-mas" class="ventana hoja-mas"><div class="ventana-asa"></div>
<div class="hoja-grupo">Tu negocio</div><div class="hoja-rejilla">${resto
    .filter((e) => NEGOCIO.includes(e))
    .map(([clave, href, texto, ico]) => `<a href="${href}"${clave === ruta ? ' class="activo"' : ""}>${insignia(ico, clave === ruta ? "marca" : "neutro")}<span>${esc(texto)}</span></a>`)
    .join("")}</div>
<div class="hoja-grupo">Ventas con IA</div><div class="hoja-rejilla">${resto
    .filter((e) => !NEGOCIO.includes(e))
    .map(([clave, href, texto, ico]) => `<a href="${href}"${clave === ruta ? ' class="activo"' : ""}>${insignia(ico, clave === ruta ? "marca" : "neutro")}<span>${esc(texto)}</span></a>`)
    .join("")}</div>
<div class="hoja-pie"><button type="button" class="instalar-app" data-instalar hidden>${icono("instalar")}Instalar la app</button><a class="boton fantasma" href="/panel/salir">${icono("salir")}Salir</a></div></div>`;
}

/* ── La página entera ────────────────────────────────────────────────── */

const FUENTES = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400..800&display=swap">';

// ruta: qué sección está activa (inicio, caja, ventas, inventario, gastos,
// fiados, chats, clientes, metricas, ganadores, errores, anuncios).
export function documento({ titulo, cuerpo, tienda = "La tienda", ruta = "", conAnuncios = true, enVivo = false, entrada = false, extraCabeza = "" }) {
  const vivo = enVivo ? '<span class="en-vivo" title="Se pone al día sola en cuanto llega un mensaje"><i></i>en vivo</span>' : "";
  const html = entrada
    ? `<body class="pantalla-entrada"><div class="entrada-instalar"><button type="button" class="instalar-app" data-instalar hidden>${icono("instalar")}Instalar</button></div>${cuerpo}${scriptDeApp("/panel")}${SCRIPT_APP}</body>`
    : `<body class="app"${enVivo ? ' data-marca="/panel/marca"' : ""}>
${barraLateral({ tienda, ruta, conAnuncios })}
<div class="lienzo">
<header class="barra-app"><a class="barra-marca" href="/panel/inicio"><img src="/panel/isotipo.png?v=1" alt="" width="34" height="24"><span>${esc(tienda)}</span></a><div class="barra-derecha">${vivo}${botonDeTema()}</div></header>
${vivo ? `<div class="vivo-flotante">${vivo}</div>` : ""}
<main class="contenido" id="contenido">${cuerpo}</main>
</div>
${pestanas({ ruta, conAnuncios })}
${SCRIPT_ALPHA}${scriptDeApp("/panel")}${SCRIPT_APP}</body>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex"><meta name="theme-color" content="#05070d">
<link rel="icon" href="/panel/isotipo.png?v=1">${etiquetasDeApp("/panel")}${FUENTES}
<title>${esc(titulo)} · ${esc(tienda)} · ALPHA IA</title><style>${ESTILO_ALPHA}${ESTILO_APP}</style>${SCRIPT_TEMA}${extraCabeza}</head>
${SPRITE_ICONOS}${html}</html>`;
}

/* ── El estilo de la app ─────────────────────────────────────────────── */

export const ESTILO_APP = `
@view-transition{navigation:auto}
[hidden]{display:none!important}
/* Velos: lo que en oscuro es un brillo blanco, en claro es una sombra azul muy suave */
:root{--velo:rgba(255,255,255,.04);--velo-2:rgba(255,255,255,.06);--velo-3:rgba(255,255,255,.1);--capa:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.02))}
:root[data-tema="claro"]{--velo:rgba(17,35,74,.04);--velo-2:rgba(17,35,74,.06);--velo-3:rgba(17,35,74,.1);--capa:linear-gradient(180deg,#fff,#fbfcff)}
html{scroll-padding-top:80px}
body.app{display:grid;grid-template-columns:268px minmax(0,1fr);min-height:100vh;min-height:100dvh}
.lienzo{min-width:0;display:flex;flex-direction:column}
main.contenido{width:100%;max-width:1240px;margin:0 auto;padding:30px 36px 90px;view-transition-name:contenido}
main.contenido>*{animation:subir .8s var(--salida) both}
main.contenido>:nth-child(2){animation-delay:.04s}main.contenido>:nth-child(3){animation-delay:.08s}main.contenido>:nth-child(4){animation-delay:.12s}
main.contenido>:nth-child(5){animation-delay:.16s}main.contenido>:nth-child(6){animation-delay:.2s}main.contenido>:nth-child(n+7){animation-delay:.24s}
@keyframes subir{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
::view-transition-old(contenido){animation:.16s ease-in both desvanecer}
::view-transition-new(contenido){animation:none}
::view-transition-group(contenido){animation-duration:0s}
::view-transition-old(lado),::view-transition-new(lado),::view-transition-old(pestanas),::view-transition-new(pestanas){animation:none;mix-blend-mode:normal}
::view-transition-group(pastilla),::view-transition-group(pestana-activa),::view-transition-group(segmento-activo){animation-duration:.6s;animation-timing-function:var(--resorte)}
@keyframes desvanecer{to{opacity:0;transform:translateY(-6px)}}
/* La barra lateral */
.lado{position:sticky;top:0;height:100vh;height:100dvh;display:flex;flex-direction:column;padding:22px 14px 16px;border-right:1px solid var(--borde);background:linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,.008));overflow-y:auto;scrollbar-width:none;view-transition-name:lado}
.lado::-webkit-scrollbar{display:none}
.lado-marca{display:flex;align-items:center;gap:12px;padding:2px 10px 14px;color:var(--plata)}
.lado-marca:hover{color:var(--texto)}
.lado-marca img{width:40px;height:auto;filter:drop-shadow(0 4px 14px rgba(61,134,255,.55));transition:transform .7s var(--resorte)}
.lado-marca:hover img{transform:rotate(-6deg) scale(1.06)}
.lado-marca b{display:block;font-size:14px;font-weight:800;letter-spacing:.18em;line-height:1.2}
.lado-marca b i{font-style:normal;background:var(--grad-ia);-webkit-background-clip:text;background-clip:text;color:transparent}
.lado-marca small{display:block;font-size:12.5px;font-weight:600;color:var(--suave);max-width:170px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lado-grupo{font-size:10.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--tenue);padding:18px 12px 8px}
.lado-nav{display:flex;flex-direction:column;gap:2px}
.lado-nav a{position:relative;isolation:isolate;display:flex;align-items:center;gap:12px;min-height:42px;padding:0 12px;border-radius:14px;color:var(--suave);font-size:14.5px;font-weight:650;transition:color .3s var(--salida),background .3s var(--salida)}
.lado-nav a .ico{width:21px;height:21px;transition:transform .6s var(--resorte),color .3s}
.lado-nav a:hover{color:var(--texto);background:var(--velo)}
.lado-nav a:hover .ico{transform:scale(1.1) rotate(-4deg)}
.lado-nav a:active .ico{transform:scale(.9)}
.lado-nav a.activo{color:#fff;background:none}
.lado-nav a.activo .ico{--ico-acento:var(--cian);--ico-opacidad:.6}
.pastilla{position:absolute;inset:0;z-index:-1;border-radius:14px;background:linear-gradient(135deg,rgba(61,134,255,.34),rgba(61,134,255,.12) 70%);box-shadow:inset 0 0 0 1px rgba(107,184,255,.3),inset 0 1px 0 rgba(255,255,255,.08),0 10px 26px -14px rgba(10,92,245,.9);view-transition-name:pastilla}
.lado-pie{margin-top:auto;padding-top:18px;display:flex;flex-direction:column;gap:4px}
.lado-boton{display:flex;align-items:center;gap:12px;width:100%;min-height:42px;padding:0 12px;border-radius:14px;border:0;background:none;color:var(--suave);font-size:14.5px;font-weight:650;justify-content:flex-start}
.lado-boton:hover{color:var(--texto);background:var(--velo)}
.lado-boton[data-instalar]{color:var(--cian)}
.lado-boton[hidden]{display:none}
.lado-tema{display:flex;align-items:center;justify-content:space-between;padding:6px 8px 6px 12px;margin-bottom:2px;font-size:14.5px;font-weight:650;color:var(--suave)}
/* La barra de arriba (solo en el teléfono) */
.barra-app{display:none}
.vivo-flotante{position:fixed;top:18px;right:22px;z-index:8}
/* Las pestañas del teléfono */
.pestanas{display:none}
@media (max-width:999px){
body.app{display:block}
.lado,.vivo-flotante{display:none}
.barra-app{position:sticky;top:0;z-index:15;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:calc(10px + env(safe-area-inset-top)) 16px 10px;background:rgba(5,7,13,.6);-webkit-backdrop-filter:saturate(180%) blur(20px);backdrop-filter:saturate(180%) blur(20px);border-bottom:1px solid transparent;transition:border-color .3s,background .3s}
.barra-app.con-sombra{border-bottom-color:var(--borde);background:rgba(5,7,13,.82)}
.barra-marca{display:flex;align-items:center;gap:10px;color:var(--texto);font-weight:750;font-size:15px;min-width:0}
.barra-marca img{width:34px;height:auto;filter:drop-shadow(0 3px 10px rgba(61,134,255,.5))}
.barra-marca span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.barra-derecha{display:flex;align-items:center;gap:8px}
main.contenido{padding:14px 16px calc(120px + env(safe-area-inset-bottom))}
.pestanas{position:fixed;z-index:20;left:12px;right:12px;bottom:calc(10px + env(safe-area-inset-bottom));display:grid;grid-template-columns:repeat(5,1fr);height:68px;padding:6px;border-radius:26px;
background:rgba(12,18,32,.8);-webkit-backdrop-filter:saturate(180%) blur(22px);backdrop-filter:saturate(180%) blur(22px);border:1px solid var(--borde-fuerte);box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 24px 50px -18px rgba(0,0,0,.95);view-transition-name:pestanas;max-width:560px;margin:0 auto}
.pestanas a,.pestanas button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-height:0;height:100%;padding:0;border:0;border-radius:20px;background:none;box-shadow:none;color:var(--suave);font-size:10.5px;font-weight:750;letter-spacing:.01em;transition:color .3s}
.pestanas a:active,.pestanas button:active{transform:scale(.92)}
.pestanas button:hover{background:none}
.pestana-ico{position:relative;isolation:isolate;display:grid;place-items:center;width:52px;height:32px;border-radius:999px}
.pestana-ico .ico{width:22px;height:22px;transition:transform .6s var(--resorte)}
.pestanas .activo{color:var(--texto)}
.pestanas .activo .pestana-ico .ico{color:#fff;--ico-acento:#fff;--ico-opacidad:.35}
.pestana-fondo{position:absolute;inset:0;z-index:-1;border-radius:inherit;background:var(--grad);box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 8px 20px -8px rgba(10,92,245,.95);view-transition-name:pestana-activa}
}
@media (max-width:999px) and (min-width:600px){main.contenido{padding-left:28px;padding-right:28px}}
/* Las ventanitas (confirmar, formularios cortos, la hoja de "Más") */
[popover]{display:none}
[popover]:popover-open{display:block}
[popover].abierto{display:block}
.ventana{position:fixed;inset:0;margin:auto;width:min(440px,calc(100vw - 32px));height:fit-content;max-height:calc(100dvh - 40px);overflow:auto;padding:26px 24px 22px;border-radius:28px;border:1px solid var(--borde-fuerte);
background:var(--tarjeta-alta);color:var(--texto);box-shadow:var(--sombra-alta);text-align:left;
opacity:0;transform:translateY(16px) scale(.96);transition:opacity .3s var(--salida),transform .55s var(--resorte),display .55s allow-discrete,overlay .55s allow-discrete}
.ventana:popover-open{opacity:1;transform:none}
@starting-style{.ventana:popover-open{opacity:0;transform:translateY(16px) scale(.96)}}
.ventana.abierto{opacity:1;transform:none;z-index:60}
.ventana::backdrop{background:rgba(3,5,10,.55);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);opacity:0;transition:opacity .35s,display .35s allow-discrete,overlay .35s allow-discrete}
.ventana:popover-open::backdrop{opacity:1}
@starting-style{.ventana:popover-open::backdrop{opacity:0}}
.ventana h3{font-size:19px;margin:12px 0 6px}
.ventana .insignia.grande{width:52px;height:52px;border-radius:18px}
.ventana .acciones{justify-content:flex-end;margin:20px 0 0}
.ventana-asa{display:none}
@media (max-width:640px){
.ventana{inset:auto 0 0 0;margin:0;width:100%;max-width:none;max-height:88dvh;border-radius:28px 28px 0 0;border-bottom:0;padding:10px 20px calc(24px + env(safe-area-inset-bottom));transform:translateY(100%);opacity:1}
.ventana:popover-open{transform:none}
@starting-style{.ventana:popover-open{transform:translateY(100%)}}
.ventana-asa{display:block;width:42px;height:5px;border-radius:999px;background:var(--borde-fuerte);margin:0 auto 14px}
.ventana .acciones{flex-direction:column-reverse;align-items:stretch}
.ventana .acciones>*{width:100%}
}
.hoja-mas .hoja-grupo{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--tenue);margin:10px 4px 10px}
.hoja-rejilla{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.hoja-rejilla a{display:flex;flex-direction:column;align-items:center;gap:8px;padding:14px 6px 12px;border-radius:20px;background:var(--velo);border:1px solid var(--borde);color:var(--texto);font-size:12.5px;font-weight:700;text-align:center;transition:transform .5s var(--resorte),border-color .3s}
.hoja-rejilla a:active{transform:scale(.95)}
.hoja-rejilla a.activo{border-color:rgba(61,134,255,.5);background:var(--marca-fondo)}
.hoja-pie{display:flex;gap:8px;justify-content:space-between;margin-top:18px;padding-top:14px;border-top:1px solid var(--borde)}
.hoja-pie .instalar-app[hidden]{display:none}
/* La cabecera de cada pantalla */
.cabeza{display:flex;align-items:flex-end;justify-content:space-between;gap:14px 20px;flex-wrap:wrap;margin:0 0 24px}
.cabeza-volver{flex-basis:100%}
.cabeza-texto{min-width:0;flex:1 1 320px}
.cabeza h1{font-size:34px;line-height:1.08;font-weight:800;letter-spacing:-.035em;margin:0}
.cabeza p{margin:8px 0 0;color:var(--suave);font-size:14.5px;max-width:640px}
.cabeza-acciones{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.sobre{font-size:11.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--cian);margin-bottom:8px}
.volver{display:inline-flex;align-items:center;gap:4px;font-size:13.5px;font-weight:700;color:var(--suave);padding:6px 14px 6px 8px;border-radius:999px;background:var(--velo);border:1px solid var(--borde);transition:color .25s,transform .5s var(--resorte),border-color .25s}
.volver:hover{color:var(--texto);border-color:var(--borde-fuerte);transform:translateX(-2px)}
@media (max-width:640px){.cabeza{margin-bottom:18px}.cabeza h1{font-size:27px}.cabeza-acciones{width:100%}.cabeza-acciones>.boton,.cabeza-acciones>button{flex:1 1 auto;min-height:42px;padding:8px 14px;font-size:13.5px}}
.seccion{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:30px 0 14px}
.seccion h2{margin:0;font-size:18px;display:flex;align-items:center;gap:10px}
.seccion a{font-size:13.5px;font-weight:700;display:inline-flex;align-items:center;gap:2px}
/* El control segmentado */
.segmento{position:relative;display:inline-flex;gap:2px;padding:4px;border-radius:999px;background:var(--velo);border:1px solid var(--borde);max-width:100%;overflow-x:auto;scrollbar-width:none}
.segmento::-webkit-scrollbar{display:none}
.segmento a{position:relative;isolation:isolate;flex:none;padding:8px 16px;border-radius:999px;font-size:13.5px;font-weight:700;color:var(--suave);white-space:nowrap;transition:color .3s}
.segmento a:hover{color:var(--texto)}
@media (max-width:640px){.segmento.desborda{-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 34px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 34px),transparent)}.segmento.desborda.al-final{-webkit-mask-image:linear-gradient(90deg,transparent,#000 34px);mask-image:linear-gradient(90deg,transparent,#000 34px)}}
.segmento a.activo{color:#fff}
.segmento-fondo{position:absolute;inset:0;z-index:-1;border-radius:inherit;background:var(--grad);box-shadow:inset 0 1px 0 rgba(255,255,255,.25),0 6px 18px -8px rgba(10,92,245,.9);view-transition-name:segmento-activo}
/* Las cifras */
.cifra{font-variant-numeric:tabular-nums}
.mosaico{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:8px}
.dato{position:relative;overflow:hidden;display:flex;flex-direction:column;gap:12px;justify-content:space-between;padding:18px;border-radius:22px;background:var(--capa);border:1px solid var(--borde);box-shadow:var(--sombra);transition:transform .6s var(--resorte),border-color .3s}
a.dato{color:inherit}a.dato:hover{transform:translateY(-3px);border-color:rgba(61,134,255,.4)}
.dato-cima{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dato-nombre{font-size:13px;font-weight:700;color:var(--suave)}
.dato-valor{font-size:28px;font-weight:800;letter-spacing:-.035em;line-height:1}
.dato-pie{font-size:12.5px;font-weight:600;color:var(--suave)}
@media (max-width:640px){.mosaico{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.dato{padding:14px;gap:10px;border-radius:20px}.dato-valor{font-size:22px}}
.insignia{display:inline-grid;place-items:center;flex:none;width:40px;height:40px;border-radius:14px;color:var(--cian);background:var(--marca-fondo);box-shadow:inset 0 0 0 1px rgba(107,184,255,.16)}
.insignia .ico{width:21px;height:21px;--ico-opacidad:.35}
.insignia.chica{width:32px;height:32px;border-radius:11px}.insignia.chica .ico{width:17px;height:17px}
.tono-bien{color:var(--bien);background:var(--bien-fondo);box-shadow:inset 0 0 0 1px rgba(61,220,151,.18)}
.tono-aviso{color:var(--aviso);background:var(--aviso-fondo);box-shadow:inset 0 0 0 1px rgba(255,191,71,.2)}
.tono-mal{color:var(--mal);background:var(--mal-fondo);box-shadow:inset 0 0 0 1px rgba(255,107,107,.2)}
.tono-ia{color:#fff;background:var(--grad-ia);box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 8px 20px -10px rgba(139,124,255,.9)}
.tono-ia .ico{--ico-acento:#fff;--ico-opacidad:.45}
.tono-neutro{color:var(--suave);background:var(--velo-2);box-shadow:inset 0 0 0 1px var(--borde)}
.tono-marca.solido{color:#fff;background:var(--grad)}
.cambio{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;font-weight:800;padding:4px 10px 4px 8px;border-radius:999px;white-space:nowrap}
.cambio .ico{width:15px;height:15px}
.cambio.sube{color:var(--bien);background:var(--bien-fondo)}.cambio.baja{color:var(--mal);background:var(--mal-fondo)}.cambio.igual{color:var(--suave);background:var(--velo-2)}
/* La tarjeta grande de arriba: siempre oscura, con una aurora que se mueve despacio */
.heroe{position:relative;isolation:isolate;overflow:hidden;border-radius:30px;padding:28px 30px;color:#f3f6ff;
background:linear-gradient(155deg,#11244d 0%,#0a1430 48%,#080d1d 100%);border:1px solid rgba(107,184,255,.2);
box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 40px 80px -40px rgba(10,92,245,.65);--texto:#f3f6ff;--suave:#a8b5d4;--tenue:#7b89aa;--borde:rgba(255,255,255,.1)}
.heroe::before,.heroe::after{content:"";position:absolute;z-index:-1;border-radius:50%;filter:blur(50px);pointer-events:none}
.heroe::before{width:420px;height:420px;right:-120px;top:-180px;background:radial-gradient(circle,rgba(61,134,255,.7),transparent 65%);animation:deriva 16s ease-in-out infinite alternate}
.heroe::after{width:360px;height:360px;left:-140px;bottom:-220px;background:radial-gradient(circle,rgba(139,124,255,.5),transparent 65%);animation:deriva 20s ease-in-out -6s infinite alternate-reverse}
@keyframes deriva{0%{transform:translate(0,0) scale(1)}50%{transform:translate(-40px,30px) scale(1.12)}100%{transform:translate(30px,-20px) scale(.95)}}
.heroe .sobre{color:#9cc8ff}
.heroe-fila{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:28px;align-items:end}
.heroe-cifra{font-size:clamp(46px,6.4vw,68px);font-weight:800;letter-spacing:-.05em;line-height:1;margin:6px 0 12px;background:linear-gradient(180deg,#fff 30%,#c6dbff);-webkit-background-clip:text;background-clip:text;color:transparent}
.heroe-cifra.negativo{background:linear-gradient(180deg,#ffd0d0 20%,#ff8f8f);-webkit-background-clip:text;background-clip:text}
.heroe-pista{justify-self:end;align-self:center;display:flex;align-items:flex-start;gap:10px;max-width:380px;padding:14px 16px;border-radius:18px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);font-size:13.5px;line-height:1.5;color:rgba(255,255,255,.78);backdrop-filter:blur(8px)}
.heroe-pista .ico{flex:none;width:20px;height:20px;color:#ffd27a;--ico-opacidad:.3}.heroe-pista b{color:#fff}
.abono-fila{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:12px;align-items:end;margin-top:16px}
.abono-fila>button{min-height:50px}
.monto.chico input{min-height:50px;font-size:20px}.monto.chico span{font-size:18px}
@media (max-width:640px){.abono-fila{grid-template-columns:1fr 1fr}.abono-fila>button{grid-column:1/-1}.heroe-pista{justify-self:stretch;max-width:none}}
.heroe-nota{font-size:13.5px;color:var(--suave);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.heroe-datos{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin-top:24px;padding-top:18px;border-top:1px solid rgba(255,255,255,.1)}
.heroe-datos>div{padding:0 16px;min-width:0}.heroe-datos>div:first-child{padding-left:0}.heroe-datos>div+div{border-left:1px solid rgba(255,255,255,.1)}
.heroe-datos b{display:block;font-size:21px;font-weight:800;letter-spacing:-.03em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.heroe-datos>div>span{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:var(--suave);margin-bottom:4px}
.heroe-datos>div>span i{width:8px;height:8px;border-radius:3px;flex:none}
.heroe .cambio.sube{color:#5cf0b0;background:rgba(61,220,151,.14)}.heroe .cambio.baja{color:#ff9d9d;background:rgba(255,107,107,.14)}.heroe .cambio.igual{color:#c3cde4;background:rgba(255,255,255,.08)}
@media (max-width:820px){.heroe{padding:22px 20px;border-radius:26px}.heroe-fila{grid-template-columns:1fr;gap:18px}.heroe-datos>div{padding:0 10px}.heroe-datos b{font-size:17px}}
/* El gráfico de columnas */
.columnas{position:relative;display:flex;align-items:flex-end;gap:var(--hueco,6px);height:170px;padding-top:26px}
.columnas::before{content:"";position:absolute;left:0;right:0;bottom:0;height:1px;background:var(--borde)}
.columna{position:relative;flex:1;min-width:0;height:100%;display:flex;align-items:flex-end;justify-content:center;cursor:default}
.columna i{display:block;width:100%;max-width:24px;min-height:3px;border-radius:7px 7px 3px 3px;background:linear-gradient(180deg,#8cc6ff,#3d86ff 60%,#2a5cf0);transform-origin:bottom;animation:crecer-columna 1s var(--resorte) both;animation-delay:calc(var(--n,0) * 28ms + .15s);transition:filter .25s,transform .3s}
.columna.vacia i{background:var(--velo-3)}
.columna.hoy i{box-shadow:0 0 0 2px rgba(140,198,255,.5),0 10px 24px -6px rgba(61,134,255,.9)}
@keyframes crecer-columna{from{transform:scaleY(0)}to{transform:scaleY(1)}}
.columna:hover i{filter:brightness(1.25)}
.columna .globo{position:absolute;bottom:calc(var(--alto,0%) + 10px);left:50%;transform:translate(-50%,6px) scale(.92);opacity:0;pointer-events:none;z-index:4;white-space:nowrap;padding:7px 11px;border-radius:12px;background:#f3f6ff;color:#0b1222;font-size:12px;font-weight:700;line-height:1.3;box-shadow:0 14px 30px -10px rgba(0,0,0,.6);transition:opacity .2s,transform .4s var(--resorte)}
.columna .globo small{display:block;font-weight:600;color:#55627d}
.columna:hover .globo,.columna:focus .globo{opacity:1;transform:translate(-50%,0) scale(1)}
.columnas-ejes{display:flex;justify-content:space-between;margin-top:10px;font-size:11.5px;font-weight:700;color:var(--tenue)}
.heroe .columnas::before{background:rgba(255,255,255,.12)}.heroe .columnas-ejes{color:var(--tenue)}
/* Barras de reparto (por categoría, por método) */
.reparto{display:flex;flex-direction:column;gap:14px}
.reparto-fila{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:4px 12px;align-items:center}
.reparto-fila .insignia{grid-row:span 2}
.reparto-nombre{font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.reparto-valor{font-size:14px;font-weight:800;text-align:right;font-variant-numeric:tabular-nums}
.reparto-barra{grid-column:2/4;height:8px;border-radius:999px;background:var(--velo-2);overflow:hidden}
.reparto-barra i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#3d86ff,#8cc6ff);transform-origin:left;animation:crecer-barra 1.1s var(--salida) both;animation-delay:calc(var(--n,0) * 60ms + .2s)}
@keyframes crecer-barra{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.heroe .reparto-barra{background:rgba(255,255,255,.1)}
/* Atajos grandes */
.rapidos{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:18px 0 6px}
.rapido{position:relative;display:flex;align-items:center;gap:14px;padding:16px;border-radius:22px;background:var(--capa);border:1px solid var(--borde);color:var(--texto);box-shadow:var(--sombra);transition:transform .6s var(--resorte),border-color .3s,box-shadow .3s}
.rapido:hover{color:var(--texto);transform:translateY(-3px);border-color:rgba(61,134,255,.45);box-shadow:var(--brillo)}
.rapido:active{transform:scale(.97);transition-duration:.15s}
.rapido b{display:block;font-size:14.5px;font-weight:750;line-height:1.25}
.rapido small{display:block;font-size:12.5px;color:var(--suave);font-weight:600;margin-top:2px}
.rapido.principal{background:var(--grad);border-color:transparent;color:#fff;box-shadow:inset 0 1px 0 rgba(255,255,255,.25),0 18px 40px -18px rgba(10,92,245,.95)}
.rapido.principal small{color:rgba(255,255,255,.78)}
.rapido.principal .insignia{color:#fff;background:rgba(255,255,255,.18);box-shadow:inset 0 0 0 1px rgba(255,255,255,.25)}
.rapido.principal .insignia .ico{--ico-acento:#fff;--ico-opacidad:.35}
@media (max-width:900px){.rapidos{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.rapido{flex-direction:column;align-items:flex-start;gap:10px;padding:14px}}
/* Dos columnas en la computadora */
.dos{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:18px;align-items:start}
.dos>*{min-width:0}
@media (max-width:1100px){.dos{grid-template-columns:1fr}}
.panel-tarjeta{position:relative;border-radius:24px;padding:20px;background:var(--capa);border:1px solid var(--borde);box-shadow:var(--sombra);margin-bottom:18px}
.panel-tarjeta>h2:first-child,.panel-tarjeta>.seccion:first-child{margin-top:0}
.panel-tarjeta h2{font-size:17px;margin:0 0 14px;display:flex;align-items:center;gap:10px}
@media (max-width:640px){.panel-tarjeta{padding:16px;border-radius:22px}}
/* Listas de filas */
.filas{display:flex;flex-direction:column;border-radius:24px;background:var(--capa);border:1px solid var(--borde);box-shadow:var(--sombra);overflow:hidden}
.panel-tarjeta .filas{border:0;background:none;box-shadow:none;border-radius:0;margin:0 -8px}
.fila{display:flex;align-items:center;gap:14px;padding:14px 18px;color:var(--texto);transition:background .25s}
.fila+.fila{border-top:1px solid var(--borde)}
a.fila:hover{background:rgba(61,134,255,.06);color:var(--texto)}
a.fila:active{background:rgba(61,134,255,.1)}
.fila-centro{flex:1;min-width:0}
.fila-titulo{font-size:14.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fila-sub{font-size:12.8px;color:var(--suave);font-weight:550;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.fila-fin{text-align:right;flex:none}
.fila-fin b{display:block;font-size:15px;font-weight:800;font-variant-numeric:tabular-nums}
.fila-fin small{display:block;font-size:12px;color:var(--suave);font-weight:600}
.fila .flecha{color:var(--tenue);flex:none;transition:transform .5s var(--resorte)}
a.fila:hover .flecha{transform:translateX(3px);color:var(--suave)}
.panel-tarjeta .fila{padding:12px 8px;border-radius:14px}
.panel-tarjeta .fila+.fila{border-top:0}
.dia-titulo{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin:22px 4px 10px;font-size:13px;font-weight:800;color:var(--suave);letter-spacing:.02em}
.dia-titulo b{color:var(--texto);font-size:14px}
.tachada .fila-titulo,.tachada .fila-fin b{text-decoration:line-through;color:var(--tenue)}
.chip{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:800;padding:3px 9px;border-radius:999px;background:var(--velo-2);color:var(--suave);white-space:nowrap;vertical-align:1px}
.chip .ico{width:13px;height:13px}
.chip.bien{color:var(--bien);background:var(--bien-fondo)}.chip.aviso{color:var(--aviso);background:var(--aviso-fondo)}.chip.mal{color:var(--mal);background:var(--mal-fondo)}.chip.marca{color:var(--cian);background:var(--marca-fondo)}.chip.ia{color:#c9c0ff;background:rgba(139,124,255,.14)}
/* Personas */
.avatar{display:inline-grid;place-items:center;flex:none;width:42px;height:42px;border-radius:50%;font-size:14px;font-weight:800;letter-spacing:.02em;color:#fff;
background:linear-gradient(135deg,hsl(var(--h) 85% 64%),hsl(calc(var(--h) + 50) 75% 46%));box-shadow:inset 0 1px 0 rgba(255,255,255,.35),0 6px 16px -8px hsl(var(--h) 80% 40%)}
.avatar.chico{width:34px;height:34px;font-size:12px}
/* Stock */
.stock{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:800;padding:4px 10px;border-radius:999px;white-space:nowrap}
.stock i{width:7px;height:7px;border-radius:50%;background:currentColor}
.stock.hay{color:var(--bien);background:var(--bien-fondo)}.stock.poco{color:var(--aviso);background:var(--aviso-fondo)}.stock.cero{color:var(--mal);background:var(--mal-fondo)}
.stock.poco i{animation:latido-aviso 2s infinite}
@keyframes latido-aviso{0%{box-shadow:0 0 0 0 rgba(255,191,71,.6)}70%{box-shadow:0 0 0 6px rgba(255,191,71,0)}100%{box-shadow:0 0 0 0 rgba(255,191,71,0)}}
/* Vacío */
.vacio{display:flex;flex-direction:column;align-items:center;text-align:center;padding:42px 20px 38px;border-radius:26px;border:1px dashed var(--borde-fuerte);background:rgba(255,255,255,.015)}
.vacio-dibujo{position:relative;display:grid;place-items:center;width:96px;height:96px;margin-bottom:16px;color:var(--cian)}
.vacio-dibujo span{position:absolute;inset:0;border-radius:32px;background:linear-gradient(135deg,rgba(61,134,255,.22),rgba(139,124,255,.12));transform:rotate(-8deg);animation:mecer 6s ease-in-out infinite}
.vacio-dibujo::after{content:"";position:absolute;inset:-12px;border-radius:40px;border:1px dashed rgba(107,184,255,.25);animation:mecer 6s ease-in-out -3s infinite reverse}
.vacio-dibujo .ico{position:relative;--ico-opacidad:.35}
@keyframes mecer{0%,100%{transform:rotate(-8deg)}50%{transform:rotate(6deg)}}
.vacio h3{font-size:18px;margin:4px 0 6px}
.vacio p{margin:0;color:var(--suave);max-width:420px}
.vacio .acciones{justify-content:center;margin-top:18px}
/* Los avisos que bajan */
.tostadas{position:fixed;z-index:70;top:calc(14px + env(safe-area-inset-top));left:0;right:0;display:flex;justify-content:center;pointer-events:none;padding:0 16px}
.tostada{pointer-events:auto;display:flex;align-items:center;gap:12px;max-width:560px;padding:10px 10px 10px 10px;border-radius:20px;background:rgba(17,26,44,.92);-webkit-backdrop-filter:saturate(180%) blur(18px);backdrop-filter:saturate(180%) blur(18px);border:1px solid var(--borde-fuerte);box-shadow:0 24px 50px -16px rgba(0,0,0,.8);font-size:14px;font-weight:650;
animation:tostada-entra .7s var(--resorte) both,tostada-sale .4s var(--salida) 5.5s forwards}
.tostada.tono-mal{animation:tostada-entra .7s var(--resorte) both,tostada-sale .4s var(--salida) 10s forwards}
.tostada>span:not(.insignia){flex:1;min-width:0;color:var(--texto);font-weight:600;font-size:14px;line-height:1.4}
.tostada .insignia{width:34px;height:34px;border-radius:12px}.tostada .insignia .ico{width:18px;height:18px}
.tostada-cerrar{width:32px;height:32px;min-height:0;padding:0;border:0;background:none;color:var(--suave)}
.tostada.cerrada{animation:tostada-sale .35s var(--salida) forwards}
@keyframes tostada-entra{from{opacity:0;transform:translateY(-24px) scale(.94)}to{opacity:1;transform:none}}
@keyframes tostada-sale{to{opacity:0;transform:translateY(-14px) scale(.97);visibility:hidden;pointer-events:none}}
/* Formularios */
.campos{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px}
.campo{display:flex;flex-direction:column;gap:7px;font-size:13px;font-weight:700;color:var(--suave);min-width:0}
.campo input,.campo select,.campo textarea{width:100%;color:var(--texto);font-weight:550}
.campo small{font-weight:550;color:var(--tenue)}
.campo.ancho{grid-column:1/-1}
.campo>button{align-self:flex-start}
.monto{position:relative;display:flex;align-items:center}
.monto span{position:absolute;left:18px;font-size:26px;font-weight:800;color:var(--suave);pointer-events:none}
.monto input{width:100%;min-height:64px;padding-left:44px;font-size:30px;font-weight:800;letter-spacing:-.03em;border-radius:20px}
.opciones{display:flex;flex-wrap:wrap;gap:8px}
.opcion{position:relative;display:inline-flex;align-items:center;gap:8px;padding:9px 14px 9px 10px;border-radius:999px;border:1px solid var(--borde-fuerte);background:var(--velo);color:var(--suave);font-size:13.5px;font-weight:700;cursor:pointer;transition:all .3s var(--salida),transform .5s var(--resorte);user-select:none}
.opcion input{position:absolute;opacity:0;pointer-events:none}
.opcion .ico{width:18px;height:18px}
.opcion:hover{color:var(--texto);border-color:rgba(148,163,194,.45)}
.opcion:active{transform:scale(.95)}
.opcion:has(input:checked){color:#fff;background:var(--grad);border-color:transparent;box-shadow:inset 0 1px 0 rgba(255,255,255,.25),0 8px 20px -10px rgba(10,92,245,.9)}
.opcion:has(input:checked) .ico{--ico-acento:#fff;--ico-opacidad:.35}
.opcion:has(input:focus-visible){outline:2px solid var(--marca);outline-offset:2px}
.interruptor{display:inline-flex;align-items:center;gap:10px;font-size:14px;font-weight:650;color:var(--texto);cursor:pointer}
.interruptor input{appearance:none;-webkit-appearance:none;position:relative;width:46px;height:28px;min-height:0;padding:0;border-radius:999px;background:var(--velo-3);border:1px solid var(--borde-fuerte);cursor:pointer;transition:background .3s}
.interruptor input::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.35);transition:transform .5s var(--resorte)}
.interruptor input:checked{background:var(--marca);border-color:transparent}
.interruptor input:checked::after{transform:translateX(18px)}
.buscador{position:relative;display:flex;align-items:center;flex:1;min-width:200px}
.buscador .ico{position:absolute;left:16px;color:var(--tenue);pointer-events:none}
.buscador input{width:100%;padding-left:46px;border-radius:999px;min-height:48px}
.herramientas{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:0 0 18px}
/* La IA */
.ia-tarjeta{position:relative;border-radius:26px;padding:22px;margin-bottom:18px;
background:linear-gradient(var(--tarjeta-solida),var(--tarjeta-solida)) padding-box,linear-gradient(135deg,rgba(107,184,255,.65),rgba(139,124,255,.55) 45%,rgba(61,134,255,.12) 80%) border-box;border:1px solid transparent;box-shadow:0 30px 70px -40px rgba(139,124,255,.6)}
.ia-tarjeta::before{content:"";position:absolute;inset:0;border-radius:inherit;background:radial-gradient(500px 200px at 0% 0%,rgba(139,124,255,.12),transparent 70%),radial-gradient(400px 200px at 100% 0%,rgba(61,134,255,.1),transparent 70%);pointer-events:none}
.ia-cabeza{position:relative;display:flex;align-items:center;gap:14px;margin-bottom:14px}
.ia-cabeza h2{margin:0;font-size:17px}
.ia-cabeza p{margin:2px 0 0;font-size:13px;color:var(--suave)}
.ia-marca{position:relative;flex:none;display:grid;place-items:center;width:44px;height:44px;border-radius:16px;color:#fff;background:var(--grad-ia);box-shadow:inset 0 1px 0 rgba(255,255,255,.35),0 10px 24px -10px rgba(139,124,255,.95)}
.ia-marca .ico{width:24px;height:24px;--ico-acento:#fff;--ico-opacidad:.45;animation:destello 4s var(--salida) infinite}
.ia-marca::after{content:"";position:absolute;inset:-4px;border-radius:19px;border:1.5px solid rgba(139,124,255,.5);animation:aro 3s var(--salida) infinite}
@keyframes destello{0%,70%,100%{transform:none}80%{transform:rotate(18deg) scale(1.12)}90%{transform:rotate(-6deg) scale(.96)}}
@keyframes aro{0%{opacity:.9;transform:scale(.92)}80%,100%{opacity:0;transform:scale(1.25)}}
.ia-charla{position:relative;display:flex;flex-direction:column;gap:10px;max-height:380px;overflow-y:auto;margin:0 -4px 12px;padding:0 4px;scroll-behavior:smooth}
.ia-charla:empty{display:none}
.ia-yo,.ia-ella{max-width:88%;padding:10px 14px;border-radius:18px;font-size:14px;line-height:1.5;white-space:pre-wrap;animation:entrar .5s var(--resorte) both}
.ia-yo{align-self:flex-end;color:#fff;background:var(--grad);border-bottom-right-radius:6px}
.ia-ella{align-self:flex-start;background:var(--velo-2);border:1px solid var(--borde);border-bottom-left-radius:6px}
.ia-escribiendo{display:inline-flex;gap:4px;padding:14px 16px}
.ia-escribiendo i{width:7px;height:7px;border-radius:50%;background:var(--suave);animation:saltito 1.2s var(--salida) infinite}
.ia-escribiendo i:nth-child(2){animation-delay:.15s}.ia-escribiendo i:nth-child(3){animation-delay:.3s}
@keyframes saltito{0%,60%,100%{transform:none;opacity:.5}30%{transform:translateY(-5px);opacity:1}}
.ia-propuesta{align-self:stretch;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 14px;border-radius:18px;border:1px dashed rgba(139,124,255,.5);background:rgba(139,124,255,.07);font-size:13.5px;font-weight:650;animation:entrar .5s var(--resorte) both}
.ia-propuesta>span{flex:1;min-width:180px}
.ia-sugerencias{position:relative;display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.ia-sugerencias button{min-height:34px;padding:6px 13px;font-size:12.8px;font-weight:700;color:var(--suave);background:var(--velo)}
.ia-sugerencias button:hover{color:var(--texto)}
.ia-preguntar{position:relative;display:flex;gap:8px;align-items:center}
.ia-preguntar input{flex:1;min-width:0;border-radius:999px;min-height:50px;padding-left:20px}
.ia-preguntar button{width:50px;height:50px;padding:0;flex:none}
.consejos{display:flex;flex-direction:column;gap:10px}
.consejo{display:flex;align-items:flex-start;gap:12px;padding:14px;border-radius:18px;background:var(--velo);border:1px solid var(--borde);color:var(--texto);font-size:14px;line-height:1.5;transition:transform .5s var(--resorte),border-color .3s}
a.consejo:hover{color:var(--texto);border-color:rgba(61,134,255,.4);transform:translateX(3px)}
.consejo>span:not(.insignia){flex:1;padding-top:8px}
.consejo .flecha{margin-top:10px;color:var(--tenue)}
/* El puesto en una lista (1, 2, 3) */
.puesto{display:inline-grid;place-items:center;flex:none;width:30px;height:30px;border-radius:10px;font-size:13px;font-weight:800;color:var(--suave);background:var(--velo-2)}
.puesto.p1{color:#3b2a00;background:linear-gradient(135deg,#ffe08a,#f2b33d)}.puesto.p2{color:#1d2433;background:linear-gradient(135deg,#f1f4fa,#b9c3d6)}.puesto.p3{color:#3a1d06;background:linear-gradient(135deg,#f6c39a,#c9864f)}
.progreso{height:6px;border-radius:999px;background:var(--velo-2);overflow:hidden;margin-top:7px}
.progreso i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#3d86ff,#8cc6ff);transform-origin:left;animation:crecer-barra 1s var(--salida) both}
/* El recibo: un papel de verdad */
.recibo{position:relative;max-width:420px;margin:0 auto;padding:30px 28px 40px;color:#0d1526;background:#fbfcff;border-radius:22px 22px 0 0;box-shadow:0 40px 80px -30px rgba(0,0,0,.7);font-size:14px;
-webkit-mask:linear-gradient(#000 0 0) top/100% calc(100% - 10px) no-repeat,conic-gradient(from -45deg at bottom,#0000,#000 1deg 89deg,#0000 90deg) bottom/20px 10px repeat-x;mask:linear-gradient(#000 0 0) top/100% calc(100% - 10px) no-repeat,conic-gradient(from -45deg at bottom,#0000,#000 1deg 89deg,#0000 90deg) bottom/20px 10px repeat-x;animation:imprimir-recibo .9s var(--salida) both}
@keyframes imprimir-recibo{from{opacity:0;transform:translateY(-18px);clip-path:inset(0 0 100% 0)}to{opacity:1;transform:none;clip-path:inset(0 0 0 0)}}
.recibo h2{margin:0;font-size:20px;text-align:center;letter-spacing:-.02em}
.recibo .recibo-sub{text-align:center;color:#5a6479;font-size:13px;margin:4px 0 18px}
.recibo .linea{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px dashed #d5dae6}
.recibo .linea small{display:block;color:#5a6479;font-size:12px}
.recibo .total{display:flex;justify-content:space-between;align-items:baseline;margin-top:14px;font-size:22px;font-weight:800;letter-spacing:-.02em}
.recibo .pie{margin-top:16px;text-align:center;color:#5a6479;font-size:13px}
.recibo a{color:#0a5cf5}
.recibo .chip{background:#eef2f9;color:#334155}
.anulada-sello{position:absolute;top:38%;left:50%;transform:translate(-50%,-50%) rotate(-14deg);padding:8px 18px;border:3px solid #d92d2d;border-radius:12px;color:#d92d2d;font-size:28px;font-weight:800;letter-spacing:.12em;opacity:.85;background:rgba(251,252,255,.7);animation:estampar .6s var(--resorte) .4s both}
@keyframes estampar{from{opacity:0;transform:translate(-50%,-50%) rotate(-14deg) scale(1.6)}to{opacity:.85;transform:translate(-50%,-50%) rotate(-14deg) scale(1)}}
@media print{body.app{display:block}.lado,.pestanas,.barra-app,.vivo-flotante,.no-imprimir,.tostadas{display:none!important}main.contenido{padding:0}.recibo{box-shadow:none;-webkit-mask:none;mask:none;animation:none}body{background:#fff}body::before{display:none}}
/* La caja */
.pos{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(340px,1fr);gap:20px;align-items:start}
.pos-ticket{position:sticky;top:24px}
@media (max-width:1000px){.pos{grid-template-columns:1fr}.pos-ticket{position:static}}
.lector{position:relative;display:flex;align-items:center}
.lector>.ico{position:absolute;left:20px;width:26px;height:26px;color:var(--cian);pointer-events:none}
.lector input{width:100%;min-height:66px;padding:0 120px 0 60px;border-radius:22px;font-size:18px;font-weight:650}
.lector-botones{position:absolute;right:8px;display:flex;gap:6px}
.lector-botones button{width:50px;height:50px;padding:0;border-radius:16px}
.lector-botones button.encendida{color:#fff;background:var(--grad);border-color:transparent}
#camara{display:none;width:100%;max-height:300px;object-fit:cover;border-radius:22px;margin-top:12px;background:#000}
.camara-marco{position:relative}
.resultados{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-top:14px}
.resultados:empty{display:none}
.resultado{display:flex;flex-direction:column;align-items:flex-start;gap:6px;min-height:0;padding:14px;border-radius:18px;text-align:left;white-space:normal;background:var(--velo);font-weight:600;animation:entrar .5s var(--resorte) both}
.resultado b{font-size:14px;line-height:1.3}.resultado small{font-size:12.5px;color:var(--suave)}
.ticket-lineas{display:flex;flex-direction:column;gap:8px;min-height:120px}
.ticket-linea{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;align-items:center;padding:12px 14px;border-radius:18px;background:var(--velo);border:1px solid var(--borde);animation:entrar-linea .6s var(--resorte) both}
.ticket-linea.destello{animation:destello-linea .9s var(--salida)}
@keyframes entrar-linea{from{opacity:0;transform:translateX(18px) scale(.97)}to{opacity:1;transform:none}}
@keyframes destello-linea{0%{background:rgba(61,134,255,.25);border-color:rgba(61,134,255,.6)}100%{background:var(--velo)}}
.ticket-linea b{font-size:14px;font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ticket-linea small{display:block;font-size:12.5px;color:var(--suave);font-weight:600}
.ticket-linea .importe{font-weight:800;font-variant-numeric:tabular-nums;text-align:right}
.ticket-linea .control{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:8px}
.contador{display:inline-flex;align-items:center;gap:2px;padding:3px;border-radius:999px;background:var(--velo-2);border:1px solid var(--borde)}
.contador button{width:32px;height:32px;min-height:0;padding:0;border:0;background:none}
.contador button:hover{background:var(--velo-3)}
.contador span{min-width:26px;text-align:center;font-weight:800;font-variant-numeric:tabular-nums}
.ticket-vacio{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:26px 10px;color:var(--suave);font-size:14px;text-align:center;border-radius:18px;border:1px dashed var(--borde-fuerte)}
.ticket-vacio .ico{width:34px;height:34px;color:var(--tenue)}
.ticket-total{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:16px 2px 14px}
.ticket-total span{font-size:14px;font-weight:700;color:var(--suave)}
.ticket-total b{font-size:38px;font-weight:800;letter-spacing:-.045em;font-variant-numeric:tabular-nums;transition:transform .5s var(--resorte)}
.ticket-total b.salta{animation:saltar .5s var(--resorte)}
@keyframes saltar{0%{transform:scale(1)}40%{transform:scale(1.07)}100%{transform:scale(1)}}
.metodos{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:6px 0 12px}
.metodos .opcion{flex-direction:column;justify-content:center;gap:6px;padding:12px 6px;border-radius:16px;font-size:12px;text-align:center;line-height:1.2}
.metodos .opcion .ico{width:22px;height:22px}
.fiado-datos{display:grid;grid-template-columns:1fr 1fr;gap:10px;overflow:hidden;max-height:0;opacity:0;transition:max-height .6s var(--salida),opacity .4s,margin .4s;margin:0}
.fiado-datos.visible{max-height:200px;opacity:1;margin:0 0 12px}
.boton-cobrar{width:100%;min-height:62px;font-size:17px;border-radius:20px;letter-spacing:-.01em}
.boton-cobrar .ico{width:22px;height:22px}
.pos-arriba{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
.pos-arriba select{min-width:150px}
.pos-arriba input{max-width:200px}
/* El éxito al cobrar */
.exito{position:fixed;inset:0;z-index:65;display:grid;place-items:center;padding:20px;background:rgba(3,5,10,.6);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);animation:aparecer .3s var(--salida)}
.exito[hidden]{display:none}
.exito-caja{width:min(420px,100%);padding:30px 26px 24px;border-radius:30px;text-align:center;background:var(--tarjeta-alta);border:1px solid var(--borde-fuerte);box-shadow:var(--sombra-alta);animation:crecer-suave .7s var(--resorte) both}
.exito-check{width:88px;height:88px;margin:0 auto 14px}
.exito-check circle{fill:none;stroke:var(--bien);stroke-width:3;stroke-dasharray:252;stroke-dashoffset:252;animation:trazar .8s var(--salida) .1s forwards}
.exito-check path{fill:none;stroke:var(--bien);stroke-width:4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:60;stroke-dashoffset:60;animation:trazar .5s var(--salida) .6s forwards}
.exito-check .relleno{fill:var(--bien-fondo);stroke:none;stroke-dasharray:none;animation:none}
@keyframes trazar{to{stroke-dashoffset:0}}
.exito-caja h2{margin:0 0 4px;font-size:22px}
.exito-caja .exito-total{font-size:40px;font-weight:800;letter-spacing:-.04em;margin:6px 0 4px}
.exito-caja .acciones{flex-direction:column;align-items:stretch;margin-top:20px}
/* El inventario */
.productos{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px}
.producto{display:flex;flex-direction:column;border-radius:22px;overflow:hidden;background:var(--capa);border:1px solid var(--borde);color:var(--texto);box-shadow:var(--sombra);transition:transform .6s var(--resorte),border-color .3s,box-shadow .3s;animation:entrar .6s var(--salida) both;animation-delay:calc(var(--n,0) * 30ms)}
.producto:hover{color:var(--texto);transform:translateY(-4px);border-color:rgba(61,134,255,.45);box-shadow:var(--brillo)}
.producto:active{transform:scale(.98)}
.producto-foto{position:relative;aspect-ratio:4/3;background:linear-gradient(135deg,rgba(61,134,255,.14),rgba(139,124,255,.08));overflow:hidden;display:grid;place-items:center;color:var(--tenue)}
.producto-foto img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:transform .9s var(--salida)}
.producto:hover .producto-foto img{transform:scale(1.06)}
.producto-foto .ico{width:38px;height:38px}
.producto-foto .stock{position:absolute;left:10px;top:10px;-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
.producto-foto .stock.hay{background:rgba(8,40,26,.72);color:#5cf0b0}.producto-foto .stock.poco{background:rgba(48,32,4,.72);color:#ffcf70}.producto-foto .stock.cero{background:rgba(52,10,10,.75);color:#ff9d9d}
.producto-pie{display:flex;flex-direction:column;gap:3px;padding:12px 14px 14px;flex:1}
.producto-pie b{font-size:14px;font-weight:750;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.producto-pie small{font-size:12.5px;color:var(--suave);font-weight:600}
.producto-pie .producto-precio{margin-top:auto;padding-top:6px;font-size:16px;font-weight:800;letter-spacing:-.02em}
@media (max-width:640px){.productos{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.producto{border-radius:20px}.producto-pie{padding:10px 12px 12px}}
.galeria{display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:6px;scrollbar-width:none}
.galeria::-webkit-scrollbar{display:none}
.galeria img{flex:none;width:150px;height:150px;object-fit:cover;border-radius:20px;scroll-snap-align:start;border:1px solid var(--borde)}
.variantes{display:flex;flex-direction:column;gap:10px}
.variante{display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;gap:10px 16px;align-items:center;padding:14px 16px;border-radius:20px;background:var(--velo);border:1px solid var(--borde)}
.variante-nombre b{font-size:15px;font-weight:800}
.variante-nombre small{display:block;font-size:12px;color:var(--suave);font-weight:600}
.variante-cantidad{text-align:right}
.variante-cantidad b{display:block;font-size:24px;font-weight:800;letter-spacing:-.03em;line-height:1}
.variante-cantidad small{font-size:11.5px;color:var(--suave);font-weight:700}
.codigo-mini{display:inline-flex;padding:4px 6px;border-radius:8px;background:#fff;transition:transform .5s var(--resorte)}
.codigo-mini:hover{transform:scale(1.04)}
.codigo-mini svg{height:30px;width:auto;display:block}
@media (max-width:640px){.variante{grid-template-columns:minmax(0,1fr) auto}.variante .codigo-mini{grid-row:2;justify-self:start}.variante .variante-mover{grid-row:2;justify-self:end}}
.mover-tipos{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:16px 0 12px}
.mover-tipos .opcion{justify-content:center;border-radius:16px;padding:12px 8px}
.tabla-suave{width:100%;font-size:13.5px}
.tabla-suave td,.tabla-suave th{padding:11px 12px}
/* El período */
.periodo-app{display:flex;align-items:center;gap:8px;max-width:100%;min-width:0}
.periodo-app .segmento{flex:0 1 auto;min-width:0}
.periodo-app>button.icono{width:44px;height:44px;flex:none}
/* Fiados */
details.fiado>summary::before{display:none}
details.fiado>summary{cursor:pointer;display:flex}
details.fiado>summary:hover{background:none}
details.fiado[open]>summary .fila-titulo{color:var(--cian)}
.fiado-cuerpo{animation:entrar .5s var(--salida) both}
.fila-fin b.mal{color:var(--mal)}.fila-fin b.bien{color:var(--bien)}
/* El login */
body.pantalla-entrada{display:block}
.entrada-instalar{position:fixed;top:16px;left:16px;z-index:6}
.entrada-instalar .instalar-app[hidden]{display:none}
/* ── Tema claro: lo que no se arregla solo con los velos ── */
[data-tema="claro"] .heroe{--velo:rgba(255,255,255,.04);--velo-2:rgba(255,255,255,.06);--velo-3:rgba(255,255,255,.1);--capa:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.02));box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 34px 70px -34px rgba(10,60,180,.55)}
[data-tema="claro"] .lado{background:rgba(255,255,255,.62)}
[data-tema="claro"] .lado-nav a.activo{color:#0a3a9c}
[data-tema="claro"] .lado-nav a.activo .ico{--ico-acento:#0a5cf5;--ico-opacidad:.3}
[data-tema="claro"] .pastilla{background:linear-gradient(135deg,rgba(61,134,255,.17),rgba(61,134,255,.06) 70%);box-shadow:inset 0 0 0 1px rgba(10,92,245,.2),0 10px 24px -16px rgba(10,92,245,.55)}
[data-tema="claro"] .barra-app{background:rgba(243,245,250,.72)}[data-tema="claro"] .barra-app.con-sombra{background:rgba(255,255,255,.88)}
[data-tema="claro"] .pestanas{background:rgba(255,255,255,.86);box-shadow:inset 0 1px 0 #fff,0 22px 46px -18px rgba(13,30,70,.4)}
[data-tema="claro"] .tostada{background:rgba(255,255,255,.95);box-shadow:0 22px 50px -20px rgba(13,30,70,.4)}
[data-tema="claro"] .dato,[data-tema="claro"] .rapido:not(.principal),[data-tema="claro"] .panel-tarjeta,[data-tema="claro"] .filas,[data-tema="claro"] .producto{box-shadow:0 1px 0 rgba(255,255,255,.9) inset,0 14px 34px -24px rgba(13,30,70,.35)}
[data-tema="claro"] .vacio{background:rgba(255,255,255,.55)}
[data-tema="claro"] .columna .globo{background:#0d1526;color:#fff}
[data-tema="claro"] .recibo{box-shadow:0 30px 70px -30px rgba(13,30,70,.45)}
[data-tema="claro"] .exito{background:rgba(243,245,250,.7)}
[data-tema="claro"] .producto-foto .stock.hay{background:rgba(235,252,244,.92);color:#0b7a4b}[data-tema="claro"] .producto-foto .stock.poco{background:rgba(255,246,224,.94);color:#9a5b00}[data-tema="claro"] .producto-foto .stock.cero{background:rgba(255,236,236,.94);color:#c02626}
[data-tema="claro"] .ia-tarjeta{box-shadow:0 20px 50px -30px rgba(109,94,255,.45)}

`;

/* ── El script de la app ─────────────────────────────────────────────── */
//
// Sin librerías. Hace cosas pequeñas:
//   1. Las cifras con data-contar cuentan desde cero al abrir.
//   2. Los avisos (?ok / ?error) se pueden cerrar y salen de la dirección.
//   3. Las ventanitas (popover) funcionan también en navegadores viejos.
//   4. "¿Seguro?" con nuestra ventanita (form data-confirmar="…").
//   5. Recuerda quién registra (el nombre) en este navegador.
//   6. La barra de arriba del teléfono toma sombra al bajar.

export const SCRIPT_APP = `<script>
(function(){
var quieto=window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches;
var formato={plata:function(v){var e=Math.abs(v-Math.round(v))<.005;return(v<0?"\\u2212":"")+"$"+Math.abs(v).toLocaleString("es-VE",{minimumFractionDigits:e?0:2,maximumFractionDigits:e?0:2})},numero:function(v){return Math.round(v).toLocaleString("es-VE")},porcentaje:function(v){return Math.round(v)+"%"}};
function contar(el){var fin=parseFloat(el.getAttribute("data-contar"))||0,tipo=el.getAttribute("data-tipo")||"numero",f=formato[tipo]||formato.numero;
 if(quieto||!fin){el.textContent=tipo==="plata"?formato.plata(fin):f(fin);return}
 var t0=null,dur=1100;function paso(t){if(!t0)t0=t;var p=Math.min(1,(t-t0)/dur),e=p===1?1:1-Math.pow(2,-10*p),v=fin*e;el.textContent=tipo==="plata"?(p===1?formato.plata(fin):formato.plata(Math.round(v))):f(v);if(p<1)requestAnimationFrame(paso)}requestAnimationFrame(paso)}
window.alphaContar=function(raiz){(raiz||document).querySelectorAll("[data-contar]:not([data-contado])").forEach(function(el){el.setAttribute("data-contado","1");contar(el)})};
alphaContar();
document.querySelectorAll(".segmento").forEach(function(sg){function mira(){var d=sg.scrollWidth>sg.clientWidth+2;sg.classList.toggle("desborda",d);sg.classList.toggle("al-final",d&&sg.scrollLeft+sg.clientWidth>=sg.scrollWidth-4)}var a=sg.querySelector("a.activo");if(a&&sg.scrollWidth>sg.clientWidth){sg.scrollLeft=Math.max(0,a.offsetLeft-(sg.clientWidth-a.offsetWidth)/2)}mira();sg.addEventListener("scroll",mira,{passive:true});addEventListener("resize",mira)});
document.addEventListener("click",function(e){var b=e.target.closest&&e.target.closest("[data-cerrar-tostada]");if(b){var t=b.closest(".tostada");if(t)t.classList.add("cerrada")}});
try{var u=new URL(location.href);if(u.searchParams.has("ok")||u.searchParams.has("error")){u.searchParams.delete("ok");u.searchParams.delete("error");history.replaceState(history.state,"",u.pathname+(u.search?u.search:"")+u.hash)}}catch(e){}
if(!HTMLElement.prototype.hasOwnProperty("popover")){document.addEventListener("click",function(e){var b=e.target.closest&&e.target.closest("[popovertarget]");if(b){var v=document.getElementById(b.getAttribute("popovertarget"));if(v){e.preventDefault();var a=b.getAttribute("popovertargetaction");if(a==="hide")v.classList.remove("abierto");else if(a==="show")v.classList.add("abierto");else v.classList.toggle("abierto")}return}
 document.querySelectorAll("[popover].abierto").forEach(function(v){if(!v.contains(e.target))v.classList.remove("abierto")})})}
// "¿Seguro?" con nuestra ventanita (form data-confirmar="…"). Sin popover, el del navegador.
function confirmar(texto,boton,peligro){return new Promise(function(ok){
 if(!HTMLElement.prototype.hasOwnProperty("popover"))return ok(confirm(texto));
 var v=document.createElement("div");v.setAttribute("popover","");v.className="ventana";
 v.innerHTML='<div class="ventana-asa"></div><h3></h3><div class="acciones"><button type="button" class="fantasma" data-no>Cancelar</button><button type="button" class="'+(peligro?"peligro":"principal")+'" data-si></button></div>';
 v.querySelector("h3").textContent=texto;v.querySelector("[data-si]").textContent=boton||"Sí, seguir";document.body.appendChild(v);
 var hecho=false;function fin(si){if(hecho)return;hecho=true;try{v.hidePopover()}catch(e){}setTimeout(function(){v.remove()},400);ok(si)}
 v.querySelector("[data-no]").onclick=function(){fin(false)};v.querySelector("[data-si]").onclick=function(){fin(true)};
 v.addEventListener("toggle",function(e){if(e.newState==="closed")fin(false)});v.showPopover();v.querySelector("[data-si]").focus()})}
window.alphaConfirmar=confirmar;
document.addEventListener("submit",function(e){var f=e.target;var t=f.getAttribute&&f.getAttribute("data-confirmar");if(!t||f.__seguro)return;e.preventDefault();var quien=e.submitter;
 confirmar(t,f.getAttribute("data-confirmar-boton"),f.hasAttribute("data-peligro")).then(function(si){if(!si)return;f.__seguro=1;if(f.requestSubmit)f.requestSubmit(quien||undefined);else f.submit()})},true);
// Quién registra: cada navegador recuerda el nombre (inv_quien) y lo pone en los formularios con data-quien.
var nombre="";try{nombre=localStorage.getItem("inv_quien")||""}catch(e){}
document.querySelectorAll('input[name="quien"]').forEach(function(i){if(!i.value)i.value=nombre;i.addEventListener("change",function(){try{localStorage.setItem("inv_quien",i.value.trim())}catch(e){}})});
document.addEventListener("submit",function(e){var f=e.target;if(!f.hasAttribute||!f.hasAttribute("data-quien")||f.querySelector('[name="quien"]'))return;var q="";try{q=localStorage.getItem("inv_quien")||""}catch(x){}var h=document.createElement("input");h.type="hidden";h.name="quien";h.value=q;f.appendChild(h)});
var barra=document.querySelector(".barra-app");if(barra){var sombra=function(){barra.classList.toggle("con-sombra",scrollY>4)};addEventListener("scroll",sombra,{passive:true});sombra()}
})();
</script>`;
