// EL PANEL DE LA TIENDA: /panel (2-oct-2026).
//
// QUÉ SE PEDÍA. "Un panel donde pueda ver los mensajes de las personas y
// todo lo que pensamos, de una vez". Hasta hoy, para saber qué le dijo el
// bot a un cliente —y POR QUÉ— había que tener `wrangler tail` abierto en
// el momento justo. Ahora queda guardado y se ve desde el teléfono:
//
//   · /panel                 las conversaciones, la más reciente arriba,
//                            con buscador y filtros (pausadas, de anuncio)
//   · /panel/c/<id>          una conversación entera, y debajo de cada
//                            respuesta del bot LO QUE PENSÓ LA IA: qué
//                            entendió, qué buscó, qué fichas mandó y qué
//                            corrigieron las redes. Con botones para
//                            pausar el bot o devolverle la conversación.
//   · /panel/anuncios        el panel de anuncios (el mismo de /anuncios)
//   · /panel/estado          el estado del bot (el mismo de /estado)
//
// CON CLAVE, SIEMPRE. Aquí están los mensajes de los clientes: no se abre
// sin la clave del secreto PANEL_CLAVE (npx.cmd wrangler secret put
// PANEL_CLAVE). Sin ese secreto, el panel no se abre para nadie. La sesión
// es una cookie firmada que dura 30 días; la clave nunca va en la URL.
//
// LO QUE PENSÓ LA IA se guarda en la tabla "turnos" de D1 (se crea sola),
// una fila por respuesta del modelo, y se borra a los 60 días.
//
// LOS MENSAJES se guardan en la tabla "mensajes" (se crea sola, 90 días):
// lo que escribe el cliente, lo que contesta el bot y lo que escribe un
// asesor a mano desde Instagram. Una tienda que ya guarda la conversación
// en el contacto (EPICELL, columna "conversacion") se ve igual: si no hay
// mensajes en la tabla, se lee de ahí.

import { cargarContacto, pausar, despausar, asegurarColumnas } from "./estado.js";
import { gastoDelMes } from "./gasto.js";
import { TABLAS, leerTabla, tipoDeError, esIntencionDeCompra, asegurarTurnos, MARCAS } from "./registro.js";

// Se reexporta para que index.js lo siga importando desde aquí.
export { anotarTurno } from "./registro.js";

const COOKIE = "panel_tienda";
const SESION_MS = 30 * 24 * 60 * 60 * 1000;
const TURNOS_DIAS = 60;
const MENSAJES_DIAS = 90;

/* ── La clave y la sesión ─────────────────────────────────────────── */

export function panelActivo(env) {
  return String(env?.PANEL_CLAVE || "").length >= 6;
}

async function firmar(env, texto) {
  const llave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(env.PANEL_CLAVE)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const firma = await crypto.subtle.sign("HMAC", llave, new TextEncoder().encode(texto));
  return [...new Uint8Array(firma)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function mismoTexto(a, b) {
  const x = String(a);
  const y = String(b);
  if (x.length !== y.length) return false;
  let diferencia = 0;
  for (let i = 0; i < x.length; i++) diferencia |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diferencia === 0;
}

async function sesionValida(request, env) {
  const galletas = request.headers.get("cookie") || "";
  const valor = galletas.split(/;\s*/).find((g) => g.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || "";
  const [expira, firma] = valor.split(".");
  if (!expira || !firma || Number(expira) < Date.now()) return false;
  return mismoTexto(firma, await firmar(env, `panel:${expira}`));
}

// Las acciones (pausar, devolver) solo valen si vienen de una página del
// propio panel: así otra web no puede mandarlas en nombre del dueño.
// Sec-Fetch-Site lo pone el navegador y otra web no lo puede falsificar.
// Si no viene, se mira el Origin, pero "null" (lo que manda Chrome desde una
// página sin referrer) no es otra web: por eso el 2-oct los botones decían "No".
function vieneDelPanel(request, url) {
  const sitio = request.headers.get("sec-fetch-site");
  if (sitio) return sitio === "same-origin" || sitio === "none";
  const origen = request.headers.get("origin") || "";
  return !origen || origen === "null" || origen === url.origin;
}

/* ── Los mensajes, uno a uno ───────────────────────────────────────── */

const CREAR_MENSAJES = `
  CREATE TABLE IF NOT EXISTS mensajes (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    igsid  TEXT NOT NULL,
    cuando INTEGER NOT NULL,
    de     TEXT NOT NULL,
    texto  TEXT NOT NULL
  )
`;

// Los índices hacen que abrir un chat, contar el día o mirar "en vivo"
// lea solo las filas que hacen falta y no la tabla entera (D1 cobra por
// fila leída). Se crean solos, una vez (regla: todo cambio en la base, desde
// el código).
let mensajesListos = false;
async function asegurarMensajes(db) {
  if (mensajesListos) return;
  await db.prepare(CREAR_MENSAJES).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS mensajes_igsid ON mensajes (igsid, cuando)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS mensajes_cuando ON mensajes (cuando)").run();
  mensajesListos = true;
}

// de: "cliente", "bot" o "asesor".
export async function anotarMensaje(db, igsid, de, texto) {
  const limpio = String(texto || "").trim();
  if (!db || !igsid || !limpio) return;
  try {
    await asegurarMensajes(db);
    await db
      .prepare("INSERT INTO mensajes (igsid, cuando, de, texto) VALUES (?, ?, ?, ?)")
      .bind(String(igsid), Date.now(), ["cliente", "bot", "asesor"].includes(de) ? de : "cliente", limpio.slice(0, 2000))
      .run();
    if (Math.random() < 0.01) {
      await db.prepare("DELETE FROM mensajes WHERE cuando < ?").bind(Date.now() - MENSAJES_DIAS * 86400000).run();
    }
  } catch (error) {
    console.error("No pude guardar el mensaje para el panel:", error?.message || error);
  }
}

async function mensajesDe(db, igsid) {
  try {
    await asegurarMensajes(db);
    const r = await db
      .prepare("SELECT de, texto, cuando FROM mensajes WHERE igsid = ? ORDER BY cuando DESC, id DESC LIMIT 200")
      .bind(String(igsid))
      .all();
    return (r?.results || []).reverse().map((m) => ({ de: m.de, texto: m.texto, cuando: Number(m.cuando) || 0 }));
  } catch {
    return [];
  }
}

/* ── Lo que pensó la IA, turno a turno ──────────────────────────────
   Se guarda en registro.js (anotarTurno, con su marca: error, alucinó,
   corregida, queja). Aquí solo se lee. */

async function turnosDe(db, igsid) {
  try {
    await asegurarTurnos(db);
    const r = await db
      .prepare("SELECT * FROM turnos WHERE igsid = ? ORDER BY cuando DESC LIMIT 60")
      .bind(String(igsid))
      .all();
    return (r?.results || []).reverse().map((t) => ({
      ...t,
      cuando: Number(t.cuando) || 0,
      productos: leer(t.productos),
      notas: leer(t.notas),
    }));
  } catch {
    return [];
  }
}

function leer(json) {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// Le devuelve al bot TODAS las conversaciones en pausa (el botón "Devolver
// todas" de la lista). Cada una con su nota en el historial, igual que una
// por una, para que el bot no salude de cero.
const NOTA_DEVUELTO = "Un asesor lo atendió y le devolvió la conversación al bot desde el panel.";
async function despausarTodos(db, nota = NOTA_DEVUELTO) {
  const r = await db.prepare("SELECT id FROM contactos WHERE pausado_hasta > ?").bind(Date.now()).all();
  const ids = (r?.results || []).map((f) => String(f.id));
  for (const id of ids) await despausar(db, id, nota);
  return ids.length;
}

// Después de devolver una conversación desde la lista, se vuelve a la
// lista (y no a la conversación). Solo a una página del propio panel.
function volverA(datos, porDefecto) {
  const v = String(datos?.get("volver") || "");
  return /^\/panel(\/|\?|$)/.test(v) && !v.startsWith("//") ? v : porDefecto;
}

/* ── El HTML ──────────────────────────────────────────────────────── */

function esc(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cuandoFue(ms) {
  if (!ms) return "—";
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  if (min < 24 * 60) return `hace ${Math.round(min / 60)} h`;
  return new Date(ms).toLocaleDateString("es-VE", { day: "numeric", month: "short", timeZone: "America/Caracas" });
}

function horaExacta(ms) {
  if (!ms) return "";
  return new Date(ms).toLocaleString("es-VE", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Caracas",
  });
}

const ESTILO = `
:root{--fondo:#f6f7f9;--tarjeta:#fff;--texto:#1c1f24;--suave:#5f6773;--borde:#e3e6ea;--marca:#2f6fed;
--cliente:#eef1f5;--bot:#e6efff;--pienso:#fff8e6;--pienso-borde:#f0d48a;--alerta:#b42318;--bien:#137333;}
@media (prefers-color-scheme:dark){:root{--fondo:#111418;--tarjeta:#1a1e24;--texto:#e8eaed;--suave:#9aa3ad;
--borde:#2b3139;--marca:#7aa7ff;--cliente:#232a33;--bot:#1d2a44;--pienso:#2b2616;--pienso-borde:#6b5a22;--alerta:#ff8a80;--bien:#81c995;}}
*{box-sizing:border-box}body{margin:0;background:var(--fondo);color:var(--texto);
font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
a{color:var(--marca);text-decoration:none}
header{position:sticky;top:0;background:var(--tarjeta);border-bottom:1px solid var(--borde);padding:10px 16px;z-index:2}
header .fila{display:flex;gap:14px;align-items:center;flex-wrap:wrap;max-width:880px;margin:0 auto}
header b{font-size:16px;margin-right:auto}
main{max-width:880px;margin:0 auto;padding:16px}
.tarjeta{background:var(--tarjeta);border:1px solid var(--borde);border-radius:12px;padding:12px 14px;margin-bottom:10px}
.lista a.tarjeta,.lista a.dentro{display:block;color:inherit}.lista form.acciones{margin:8px 0 0}
.nombre{font-weight:600}.suave{color:var(--suave);font-size:13px}
.etiqueta{display:inline-block;font-size:12px;border-radius:999px;padding:1px 8px;margin-left:6px;border:1px solid var(--borde)}
.pausa{color:var(--alerta);border-color:var(--alerta)}.anuncio{color:var(--marca);border-color:var(--marca)}
.chat{display:flex;flex-direction:column;gap:8px}
.burbuja{max-width:85%;padding:8px 12px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word}
.de-cliente{align-self:flex-start;background:var(--cliente)}.de-bot{align-self:flex-end;background:var(--bot)}
.de-asesor{align-self:flex-end;background:var(--tarjeta);border:1px solid var(--marca)}
.quien{display:block;font-size:11px;color:var(--suave);margin-bottom:2px}
.sello{font-weight:600;margin-bottom:4px}.sello-error,.sello-indebida{color:var(--alerta)}
.leyenda{font-size:13px;color:var(--suave);margin:6px 0 12px}.leyenda span{margin-right:10px;white-space:nowrap}
.pienso{align-self:flex-end;max-width:85%;background:var(--pienso);border:1px dashed var(--pienso-borde);
border-radius:10px;padding:8px 12px;font-size:13px}
.pienso b{display:block;margin-bottom:2px}
form.buscar{display:flex;gap:8px;margin-bottom:12px}
input,button{font:inherit;padding:8px 12px;border-radius:8px;border:1px solid var(--borde);background:var(--tarjeta);color:var(--texto)}
input{flex:1;min-width:0}button{cursor:pointer}button.principal{background:var(--marca);color:#fff;border-color:var(--marca)}
.filtros a{margin-right:12px;font-size:14px}.filtros a.activo{font-weight:700}
.acciones{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
pre{white-space:pre-wrap;word-wrap:break-word;font:13px/1.45 ui-monospace,Menlo,Consolas,monospace;margin:0}
`;

function pagina(titulo, cuerpo, { tienda = "La tienda", conMenu = true, conAnuncios = true } = {}) {
  const menu = conMenu
    ? `<a href="/panel">Chats</a>${conAnuncios ? '<a href="/panel/anuncios">Anuncios</a>' : ""}<a href="/panel/estado">Estado</a><a href="/panel/salir">Salir</a>`
    : "";
  return new Response(
    `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(titulo)} · ${esc(tienda)}</title><style>${ESTILO}</style></head>
<body><header><div class="fila"><b>${esc(tienda)}</b>${menu}</div></header><main>${cuerpo}</main></body></html>`,
    {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-frame-options": "DENY",
        "referrer-policy": "same-origin",
      },
    }
  );
}

function redirigir(a, cookie = "") {
  const headers = { location: a, "cache-control": "no-store" };
  if (cookie) headers["set-cookie"] = cookie;
  return new Response(null, { status: 303, headers });
}

function paginaDeEntrada(tienda, error = "") {
  return pagina(
    "Entrar",
    `<div class="tarjeta"><form method="post" action="/panel/entrar">
<p>Escribe la clave del panel.</p>
${error ? `<p style="color:var(--alerta)">${esc(error)}</p>` : ""}
<div class="acciones"><input type="password" name="clave" autocomplete="current-password" autofocus>
<button class="principal">Entrar</button></div></form></div>`,
    { tienda, conMenu: false }
  );
}

/* ── Las páginas ─────────────────────────────────────────────────── */

async function contactosParaLista(db, { q = "", filtro = "" } = {}) {
  await asegurarColumnas(db);
  // Cada tienda tiene sus columnas: se pide solo lo que existe.
  const { results: columnas } = await db.prepare("PRAGMA table_info(contactos)").all();
  const hay = new Set((columnas || []).map((c) => String(c.name)));
  const pedir = ["id", "nombre", "nombre_completo", "usuario", "ultimo_envio", "pausado_hasta", "conversacion", "publicacion"].filter((c) => hay.has(c));
  const r = await db.prepare(`SELECT ${pedir.join(", ")} FROM contactos ORDER BY ultimo_envio DESC LIMIT 300`).all();

  // El último mensaje de cada uno, de la tabla de mensajes.
  const ultimos = new Map();
  let conLaPalabra = null;
  try {
    await asegurarMensajes(db);
    const u = await db.prepare("SELECT igsid, de, texto, MAX(cuando) AS cuando FROM mensajes GROUP BY igsid").all();
    for (const m of u?.results || []) ultimos.set(String(m.igsid), { de: m.de, texto: m.texto, cuando: Number(m.cuando) || 0 });
    if (String(q || "").trim()) {
      const b = await db
        .prepare("SELECT DISTINCT igsid FROM mensajes WHERE lower(texto) LIKE ?")
        .bind(`%${String(q).toLowerCase().trim()}%`)
        .all();
      conLaPalabra = new Set((b?.results || []).map((m) => String(m.igsid)));
    }
  } catch {}

  // Los problemas de la última semana, por cliente: salen como símbolos en
  // la lista para ver de un vistazo dónde mirar.
  const problemas = new Map();
  try {
    await asegurarTurnos(db);
    const m = await db
      .prepare("SELECT igsid, marca, COUNT(*) AS n FROM turnos WHERE marca != '' AND cuando > ? GROUP BY igsid, marca")
      .bind(Date.now() - 7 * 86400000)
      .all();
    for (const f of m?.results || []) {
      if (!problemas.has(String(f.igsid))) problemas.set(String(f.igsid), {});
      problemas.get(String(f.igsid))[f.marca] = Number(f.n) || 0;
    }
  } catch {}

  const busca = String(q || "").toLowerCase().trim();
  return (r?.results || [])
    .map((f) => {
      const charla = leer(f.conversacion);
      const ultima = ultimos.get(String(f.id)) || charla[charla.length - 1];
      let pub = null;
      try {
        pub = f.publicacion ? JSON.parse(f.publicacion) : null;
      } catch {}
      return {
        id: String(f.id),
        nombre: f.nombre_completo || f.nombre || "",
        usuario: f.usuario || "",
        ultimo: Math.max(Number(f.ultimo_envio) || 0, ultima?.cuando || 0),
        pausado: Number(f.pausado_hasta) > Date.now(),
        pausadoHasta: Number(f.pausado_hasta) || 0,
        ultima,
        charla,
        anuncio: pub?.deAnuncio ? pub.equipo || pub.titulo || "anuncio" : "",
        problemas: problemas.get(String(f.id)) || {},
      };
    })
    .filter((c) =>
      filtro === "pausados" ? c.pausado : filtro === "anuncios" ? Boolean(c.anuncio) : filtro === "problemas" ? Object.keys(c.problemas).length > 0 : true
    )
    .filter((c) => {
      if (!busca) return true;
      const enTexto = conLaPalabra?.has(c.id) || c.charla.some((l) => String(l.texto || "").toLowerCase().includes(busca));
      return enTexto || `${c.nombre} ${c.usuario} ${c.id}`.toLowerCase().includes(busca);
    })
    .sort((a, b) => b.ultimo - a.ultimo)
    .slice(0, 100);
}

async function paginaDeLista(env, url, tienda, conAnuncios = true) {
  const q = url.searchParams.get("q") || "";
  const filtro = url.searchParams.get("f") || "";
  const contactos = await contactosParaLista(env.DB, { q, filtro });
  const enlaceFiltro = (f, nombre) =>
    `<a class="${filtro === f ? "activo" : ""}" href="/panel${f ? `?f=${f}` : ""}">${nombre}</a>`;

  const aqui = `/panel${filtro || q ? `?${new URLSearchParams({ ...(filtro ? { f: filtro } : {}), ...(q ? { q } : {}) })}` : ""}`;
  const filas = contactos
    .map((c) => {
      const enlace = `<a class="${c.pausado ? "dentro" : "tarjeta"}" href="/panel/c/${encodeURIComponent(c.id)}">
<span class="nombre">${esc(c.nombre || c.usuario || c.id)}</span>${c.usuario ? ` <span class="suave">@${esc(c.usuario)}</span>` : ""}
${Object.entries(c.problemas).map(([m, n]) => `<span class="etiqueta pausa" title="${esc(MARCAS[m]?.nombre || m)}">${MARCAS[m]?.simbolo || "!"} ${n}</span>`).join("")}${c.pausado ? `<span class="etiqueta pausa">⏸️ bot en pausa hasta ${esc(horaExacta(c.pausadoHasta))}</span>` : ""}${c.anuncio ? `<span class="etiqueta anuncio">anuncio · ${esc(String(c.anuncio).slice(0, 30))}</span>` : ""}
<div class="suave">${esc(cuandoFue(c.ultimo))}${c.ultima ? ` · ${c.ultima.de === "bot" ? "Bot: " : c.ultima.de === "asesor" ? "Asesor: " : ""}${esc(String(c.ultima.texto || "").slice(0, 90))}` : ""}</div></a>`;
      if (!c.pausado) return enlace;
      // En pausa: el botón para devolvérsela al bot, sin tener que abrirla.
      return `<div class="tarjeta">${enlace}<form class="acciones" method="post" action="/panel/devolver"><input type="hidden" name="id" value="${esc(c.id)}"><input type="hidden" name="volver" value="${esc(aqui)}"><button class="principal">▶️ Devolverle la conversación al bot</button></form></div>`;
    })
    .join("");
  const enPausa = contactos.filter((c) => c.pausado).length;
  const todas =
    filtro === "pausados" && enPausa
      ? `<form class="acciones" method="post" action="/panel/devolver-todos" onsubmit="return confirm('¿Devolverle al bot las ${enPausa} conversaciones en pausa?')"><button>▶️ Devolverle todas al bot (${enPausa})</button></form>`
      : "";

  return pagina(
    "Conversaciones",
    `<form class="buscar" method="get" action="/panel"><input name="q" value="${esc(q)}" placeholder="Buscar por nombre, @usuario o lo que escribió">
${filtro ? `<input type="hidden" name="f" value="${esc(filtro)}">` : ""}<button>Buscar</button></form>
<div class="leyenda">${Object.values(MARCAS).map((m) => `<span>${m.simbolo} ${esc(m.nombre)}</span>`).join("")}</div>
<div class="filtros">${enlaceFiltro("", "Todas")}${enlaceFiltro("problemas", "Con problemas")}${enlaceFiltro("pausados", "Con el bot en pausa")}${conAnuncios ? enlaceFiltro("anuncios", "Vinieron de un anuncio") : ""}</div><br>
${todas}<div class="lista">${filas || `<p class="suave">${filtro === "pausados" ? "Nadie en pausa: el bot está atendiendo a todos ✅" : "No hay conversaciones con eso."}</p>`}</div>`,
    { tienda, conAnuncios }
  );
}

// La marca del turno, con su símbolo: ❌ 🔴 ⚠️ 👎 (ver registro.js).
function sello(t) {
  const m = MARCAS[t?.marca];
  return m ? `<div class="sello sello-${esc(t.marca)}">${m.simbolo} ${esc(m.nombre)}${t.motivo ? `: ${esc(t.motivo)}` : ""}</div>` : "";
}

function cajaDePienso(t) {
  const partes = [sello(t)];
  if (t.pienso) partes.push(`<b>🧠 Lo que pensó la IA</b>${esc(t.pienso)}`);
  const hizo = [
    t.buscar && t.buscar.toUpperCase() !== "NADA" ? `Buscó: “${esc(t.buscar)}”` : "No buscó nada",
    t.mostrar ? `Eligió: ${esc({ texto: "solo texto", texto_e_imagenes: "texto con fichas", imagenes: "fichas" }[t.mostrar] || t.mostrar)}` : "",
    t.productos.length ? `Fichas: ${t.productos.map(esc).join(", ")}` : "",
  ].filter(Boolean);
  partes.push(`<div>${hizo.join(" · ")}</div>`);
  if (t.notas.length) partes.push(`<div>🛠 ${t.notas.map(esc).join(" · ")}</div>`);
  return `<div class="pienso">${partes.join("")}<div class="suave">${esc(horaExacta(t.cuando))}</div></div>`;
}

async function paginaDeConversacion(env, id, tienda, { horasDePausa = 1, conAnuncios = true } = {}) {
  const contacto = await cargarContacto(env.DB, id);
  const guardados = await mensajesDe(env.DB, id);
  const charla = guardados.length ? guardados : contacto.conversacion || [];
  const turnos = await turnosDe(env.DB, id);
  const usados = new Set();

  // Cada respuesta del bot se empareja con el turno que la produjo (por
  // su texto), y debajo va lo que pensó la IA.
  const normal = (t) => String(t || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const burbujas = charla
    .map((linea) => {
      const quien = linea.de === "asesor" ? "Asesor (a mano)" : linea.de === "bot" ? "Bot" : "Cliente";
      const caja =
        `<div class="burbuja de-${linea.de === "asesor" ? "asesor" : linea.de === "bot" ? "bot" : "cliente"}">` +
        `<span class="quien">${quien}${linea.cuando ? ` · ${esc(horaExacta(linea.cuando))}` : ""}</span>${esc(linea.texto)}</div>`;
      if (linea.de !== "bot") return caja;
      const i = turnos.findIndex((t, n) => !usados.has(n) && normal(t.respuesta) && normal(t.respuesta) === normal(linea.texto));
      if (i === -1) return caja;
      usados.add(i);
      const marca = MARCAS[turnos[i].marca];
      // La burbuja misma lleva el símbolo: se ve sin leer la caja de abajo.
      const conSimbolo = marca ? caja.replace('<span class="quien">', `<span class="quien">${marca.simbolo} `) : caja;
      return conSimbolo + cajaDePienso(turnos[i]);
    })
    .join("");

  // Lo pensado que no se pudo emparejar (mensajes viejos que ya no están
  // en la conversación guardada, o textos que cambió una red).
  const sueltos = turnos.filter((_, n) => !usados.has(n));

  const pausado = Number(contacto.pausado_hasta) > Date.now();
  const nombre = contacto.nombre_completo || contacto.nombre || contacto.usuario || id;
  const pub = contacto.publicacion;

  return pagina(
    nombre,
    `<p><a href="/panel">← Conversaciones</a></p>
<div class="tarjeta"><span class="nombre">${esc(nombre)}</span>${contacto.usuario ? ` <span class="suave">@${esc(contacto.usuario)}</span>` : ""}
<div class="suave">Id ${esc(id)} · último mensaje del bot ${esc(cuandoFue(contacto.ultimo_envio))}</div>
${pub?.deAnuncio ? `<div>📣 Llegó por un anuncio${pub.equipo ? ` del <b>${esc(pub.equipo)}</b>` : ""} · ${esc(cuandoFue(pub.cuando))}</div>` : ""}
${contacto.historial ? `<div class="suave">Resumen: ${esc(contacto.historial)}</div>` : ""}
<div class="acciones">${
      pausado
        ? `<span class="etiqueta pausa">Bot en pausa hasta ${esc(horaExacta(Number(contacto.pausado_hasta)))}</span>
<form method="post" action="/panel/devolver"><input type="hidden" name="id" value="${esc(id)}"><button class="principal">Devolverle la conversación al bot</button></form>`
        : `<form method="post" action="/panel/pausar"><input type="hidden" name="id" value="${esc(id)}"><button>Pausar el bot ${esc(horasDePausa)} h (la atiendo yo)</button></form>`
    }</div></div>
<div class="chat">${burbujas || '<p class="suave">Todavía no hay mensajes guardados de esta persona.</p>'}</div>
${sueltos.length ? `<h3>Más de lo que pensó la IA</h3><div class="chat">${sueltos.map((t) => `${t.cliente ? `<div class="burbuja de-cliente">${esc(t.cliente)}</div>` : ""}<div class="burbuja de-bot">${esc(t.respuesta)}</div>${cajaDePienso(t)}`).join("")}</div>` : ""}`,
    { tienda, conAnuncios }
  );
}

/* ── La puerta de entrada ────────────────────────────────────────── */

// verTexto(ruta) devuelve el texto de /estado o /anuncios, para no tener
// dos copias de lo mismo.
// conAnuncios: false en las tiendas que no tienen el panel de anuncios.
export async function atenderPanel(request, env, { verTexto, tienda = "La tienda", horasDePausa = 1, conAnuncios = true } = {}) {
  const url = new URL(request.url);

  if (!panelActivo(env)) {
    return pagina(
      "Panel apagado",
      `<div class="tarjeta"><p>El panel está apagado: falta su clave.</p>
<p>En la carpeta del bot, una vez:</p><pre>npx.cmd wrangler secret put PANEL_CLAVE</pre>
<p class="suave">Escribe una clave de al menos 6 letras. Después, abre esta página otra vez.</p></div>`,
      { tienda, conMenu: false }
    );
  }

  if (url.pathname === "/panel/entrar" && request.method === "POST") {
    const datos = await request.formData().catch(() => null);
    const clave = String(datos?.get("clave") || "");
    if (!mismoTexto(clave, env.PANEL_CLAVE)) {
      console.error("PANEL: alguien probó una clave equivocada");
      return paginaDeEntrada(tienda, "Esa no es la clave.");
    }
    const expira = Date.now() + SESION_MS;
    const valor = `${expira}.${await firmar(env, `panel:${expira}`)}`;
    return redirigir(
      "/panel",
      `${COOKIE}=${valor}; Path=/panel; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(SESION_MS / 1000)}`
    );
  }

  if (!(await sesionValida(request, env))) return paginaDeEntrada(tienda);

  if (url.pathname === "/panel/salir") {
    return redirigir("/panel", `${COOKIE}=; Path=/panel; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
  }

  if ((url.pathname === "/panel/pausar" || url.pathname === "/panel/devolver") && request.method === "POST") {
    if (!vieneDelPanel(request, url)) return new Response("No", { status: 403 });
    const datos = await request.formData().catch(() => null);
    const id = String(datos?.get("id") || "").trim();
    if (id) {
      if (url.pathname === "/panel/pausar") {
        await pausar(env.DB, id, horasDePausa);
        console.log(`PANEL: el dueño pausó el bot para ${id} (${horasDePausa} h)`);
      } else {
        await despausar(env.DB, id, NOTA_DEVUELTO);
        console.log(`PANEL: el dueño le devolvió ${id} al bot`);
      }
    }
    return redirigir(volverA(datos, `/panel/c/${encodeURIComponent(id)}`));
  }

  if (url.pathname === "/panel/devolver-todos" && request.method === "POST") {
    if (!vieneDelPanel(request, url)) return new Response("No", { status: 403 });
    const cuantos = await despausarTodos(env.DB);
    console.log(`PANEL: el dueño le devolvió al bot las ${cuantos} conversaciones en pausa`);
    return redirigir("/panel?f=pausados");
  }

  if (url.pathname.startsWith("/panel/c/")) {
    const id = decodeURIComponent(url.pathname.slice("/panel/c/".length));
    return paginaDeConversacion(env, id, tienda, { horasDePausa, conAnuncios });
  }

  if ((url.pathname === "/panel/anuncios" && conAnuncios) || url.pathname === "/panel/estado") {
    const texto = verTexto ? await verTexto(url.pathname === "/panel/anuncios" ? "/anuncios" : "/estado") : "";
    return pagina(
      url.pathname === "/panel/anuncios" ? "Anuncios" : "Estado",
      `<div class="tarjeta"><pre>${esc(texto)}</pre></div>`,
      { tienda, conAnuncios }
    );
  }

  return paginaDeLista(env, url, tienda, conAnuncios);
}


/* ── LA PUERTA PARA EL PANEL CENTRAL: /api/central (2-oct-2026) ───────
   El dueño tiene un Worker suyo, "panel-central", que junta todas las
   tiendas en un solo sitio. Ese Worker no toca la base de nadie: le pide
   los datos a cada tienda por aquí, por internet, con una clave larga que
   solo conocen los dos (PANEL_API_CLAVE en la tienda; la misma en el
   panel central). Así funciona aunque cada tienda esté en una cuenta de
   Cloudflare distinta.

     GET  /api/central/ping              ¿estás viva? (el chequeo de cada 5 min)
     GET  /api/central/resumen           los números de hoy y de la semana
     GET  /api/central/metricas?dias=14  los números día por día
     GET  /api/central/chats?q=&f=       las conversaciones
     GET  /api/central/chat?id=          una conversación, con lo pensado
     GET  /api/central/vivo?desde=&turno=  los mensajes y lo pensado NUEVOS
                                         desde el último id que vio el panel
     GET  /api/central/errores?dias=7    errores y correcciones del bot
     GET  /api/central/ganadores?dias=30 los productos que más venden
     GET  /api/central/estado            el texto de /estado
     POST /api/central/pausar|devolver   {"id": "..."}
     POST /api/central/devolver-todos    todas las conversaciones en pausa, al bot

   LAS BASES DE DATOS (el dueño: "quiero ver y editar todas las bases de
   la IA, yo soy el experto"):
     GET  /api/central/tablas                 las tablas, sus columnas y filas
     GET  /api/central/tabla?nombre=&pagina=&q=  las filas (50 por página)
     GET  /api/central/fila?tabla=&rowid=     una fila entera
     POST /api/central/fila    {tabla, rowid, cambios: {columna: valor}}
     POST /api/central/borrar  {tabla, rowid}
     POST /api/central/sql     {sql}          cualquier consulta
     GET  /api/central/cambios                el historial de cambios
     POST /api/central/deshacer {id}          deshace un cambio
   Cada cambio guarda antes cómo estaba la fila (tabla "cambios_panel"),
   para poder deshacerlo.

   Sin PANEL_API_CLAVE (o con menos de 16 letras) la puerta está cerrada.
   ───────────────────────────────────────────────────────────────────── */

const DIA_MS = 24 * 60 * 60 * 1000;
// Los días se cuentan en hora de Venezuela (UTC-4).
const DESFASE_MS = -4 * 60 * 60 * 1000;

function diaDe(ms) {
  return new Date(ms + DESFASE_MS).toISOString().slice(0, 10);
}

function inicioDeHoy() {
  const ahora = Date.now();
  return ahora - ((ahora + DESFASE_MS) % DIA_MS + DIA_MS) % DIA_MS;
}

function json(datos, estado = 200) {
  return new Response(JSON.stringify(datos), {
    status: estado,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export function apiCentralActiva(env) {
  return String(env?.PANEL_API_CLAVE || "").length >= 16;
}

function autorizadoCentral(request, env) {
  if (!apiCentralActiva(env)) return false;
  const dada = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return mismoTexto(dada, env.PANEL_API_CLAVE);
}

async function filasDesde(db, crear, consulta, desde) {
  return leerTabla(db, crear, consulta, desde);
}

// Todo lo que pasó desde "desde", en bruto, para contar.
async function lodelPeriodo(db, desde) {
  try {
    await asegurarTurnos(db);
    await asegurarMensajes(db);
  } catch {}
  const [mensajes, turnos, avisos, errores, anuncios] = await Promise.all([
    filasDesde(db, CREAR_MENSAJES, "SELECT igsid, cuando, de, substr(texto, 1, 4) AS inicio FROM mensajes WHERE cuando > ? LIMIT 50000", desde),
    filasDesde(db, TABLAS.CREAR_TURNOS, "SELECT igsid, cuando, productos, notas, marca FROM turnos WHERE cuando > ? LIMIT 20000", desde),
    filasDesde(db, TABLAS.CREAR_AVISOS, "SELECT igsid, cuando, motivo, productos, busco FROM avisos WHERE cuando > ? LIMIT 20000", desde),
    filasDesde(db, TABLAS.CREAR_ERRORES, "SELECT cuando, texto FROM errores WHERE cuando > ? ORDER BY cuando DESC LIMIT 5000", desde),
    // Solo existe en las tiendas con panel de anuncios (EPICELL).
    db
      .prepare("SELECT anuncio, igsid, primera AS cuando FROM anuncios_clientes WHERE primera > ? LIMIT 20000")
      .bind(desde)
      .all()
      .then((r) => r?.results || [])
      .catch(() => []),
  ]);
  return { mensajes, turnos, avisos, errores, anuncios };
}

function contar(periodo, desde = 0, hasta = Infinity) {
  const dentro = (x) => x.cuando > desde && x.cuando <= hasta;
  const delCliente = periodo.mensajes.filter((m) => m.de === "cliente" && dentro(m));
  const turnos = periodo.turnos.filter(dentro);
  const avisos = periodo.avisos.filter(dentro);
  const errores = periodo.errores.filter(dentro);
  return {
    clientes: new Set(delCliente.map((m) => m.igsid)).size,
    mensajes: delCliente.length,
    respuestas: turnos.length,
    fichas: turnos.filter((t) => leer(t.productos).length > 0).length,
    voz: delCliente.filter((m) => String(m.inicio || "").startsWith("🎤")).length,
    avisos: avisos.length,
    ventas: avisos.filter((a) => esIntencionDeCompra(a.motivo)).length,
    errores: errores.filter((e) => tipoDeError(e.texto) === "error").length,
    correcciones: errores.filter((e) => tipoDeError(e.texto) === "correccion").length,
    anuncios: periodo.anuncios.filter(dentro).length,
    // Las respuestas señaladas (ver registro.js, MARCAS).
    indebidas: turnos.filter((t) => t.marca === "indebida").length,
    corregidas: turnos.filter((t) => t.marca === "corregida").length,
    quejas: turnos.filter((t) => t.marca === "queja").length,
    fallos: turnos.filter((t) => t.marca === "error").length,
  };
}

async function resumenCentral(env, opciones) {
  const hoy = inicioDeHoy();
  const periodo = await lodelPeriodo(env.DB, Date.now() - 7 * DIA_MS);
  const pausados = await env.DB.prepare("SELECT COUNT(*) AS n FROM contactos WHERE pausado_hasta > ?")
    .bind(Date.now())
    .first()
    .catch(() => null);
  const ultimoError = periodo.errores.find((e) => tipoDeError(e.texto) === "error") || null;
  return {
    tienda: opciones.tienda,
    version: opciones.version || "",
    ahora: Date.now(),
    hoy: contar(periodo, hoy),
    semana: contar(periodo),
    pausados: Number(pausados?.n) || 0,
    ultimoError,
    gasto: await gastoDelMes(env),
    conAnuncios: Boolean(opciones.conAnuncios),
  };
}

async function metricasCentral(env, dias) {
  const n = Math.min(Math.max(Number(dias) || 14, 1), 90);
  const hoy = inicioDeHoy();
  const desde = hoy - (n - 1) * DIA_MS;
  const periodo = await lodelPeriodo(env.DB, desde);
  const serie = [];
  for (let i = 0; i < n; i++) {
    const inicio = desde + i * DIA_MS;
    serie.push({ dia: diaDe(inicio), ...contar(periodo, inicio, inicio + DIA_MS) });
  }
  const totales = contar(periodo, desde);
  return {
    dias: serie,
    totales,
    tasas: {
      conFichas: totales.respuestas ? totales.fichas / totales.respuestas : 0,
      aAsesor: totales.clientes ? totales.avisos / totales.clientes : 0,
      ventasPorCliente: totales.clientes ? totales.ventas / totales.clientes : 0,
    },
    gasto: await gastoDelMes(env),
  };
}

async function ganadoresCentral(env, dias) {
  const desde = Date.now() - Math.min(Math.max(Number(dias) || 30, 1), 90) * DIA_MS;
  const periodo = await lodelPeriodo(env.DB, desde);
  const tabla = new Map();
  const de = (titulo) => {
    if (!tabla.has(titulo)) tabla.set(titulo, { titulo, mostrado: 0, ventas: 0, avisos: 0, clientes: new Set() });
    return tabla.get(titulo);
  };
  for (const t of periodo.turnos) {
    for (const titulo of leer(t.productos)) {
      const fila = de(titulo);
      fila.mostrado++;
      fila.clientes.add(t.igsid);
    }
  }
  for (const a of periodo.avisos) {
    for (const titulo of leer(a.productos)) {
      const fila = de(titulo);
      fila.avisos++;
      if (esIntencionDeCompra(a.motivo)) fila.ventas++;
    }
  }
  return [...tabla.values()]
    .map((f) => ({ titulo: f.titulo, mostrado: f.mostrado, clientes: f.clientes.size, ventas: f.ventas, avisos: f.avisos }))
    .sort((a, b) => b.ventas - a.ventas || b.clientes - a.clientes || b.mostrado - a.mostrado)
    .slice(0, 30);
}

/* ── En vivo: lo nuevo desde la última vez ────────────────────────
   El panel central pregunta cada pocos segundos (solo mientras alguien lo
   está mirando) "¿qué hay después del mensaje N y del turno M?". Con los
   ids, la base lee solo lo nuevo. La primera vez (desde = 0) se dan los
   últimos, para que la pantalla no empiece vacía. */

async function nombresDe(db, ids) {
  const unicos = [...new Set(ids.map(String))].slice(0, 200);
  if (!unicos.length) return {};
  try {
    const { results: columnas } = await db.prepare("PRAGMA table_info(contactos)").all();
    const hay = new Set((columnas || []).map((c) => String(c.name)));
    const pedir = ["id", "nombre", "nombre_completo", "usuario"].filter((c) => hay.has(c));
    if (!pedir.includes("id")) return {};
    const r = await db
      .prepare(`SELECT ${pedir.join(", ")} FROM contactos WHERE id IN (${unicos.map(() => "?").join(", ")})`)
      .bind(...unicos)
      .all();
    return Object.fromEntries(
      (r?.results || []).map((f) => [String(f.id), { nombre: f.nombre_completo || f.nombre || "", usuario: f.usuario || "" }])
    );
  } catch {
    return {};
  }
}

async function vivoCentral(env, url) {
  const db = env.DB;
  await asegurarMensajes(db);
  try {
    await asegurarTurnos(db);
  } catch {}
  const desde = Math.max(Number(url.searchParams.get("desde")) || 0, 0);
  const desdeTurno = Math.max(Number(url.searchParams.get("turno")) || 0, 0);
  const igsid = String(url.searchParams.get("id") || "");
  const deUno = igsid ? " AND igsid = ?" : "";
  const conUno = (args) => (igsid ? [...args, igsid] : args);

  const ultimos = async (consulta, cursor, primeros) => {
    const r = cursor
      ? await db.prepare(`${consulta} WHERE id > ?${deUno} ORDER BY id LIMIT 100`).bind(...conUno([cursor])).all()
      : await db.prepare(`${consulta} WHERE id > 0${deUno} ORDER BY id DESC LIMIT ?`).bind(...conUno([]), primeros).all();
    const filas = r?.results || [];
    return cursor ? filas : filas.reverse();
  };

  const mensajes = await ultimos("SELECT id, igsid, cuando, de, texto FROM mensajes", desde, 40);
  const turnos = await ultimos(
    "SELECT id, igsid, cuando, cliente, pienso, respuesta, productos, notas, marca, motivo FROM turnos",
    desdeTurno,
    20
  ).catch(() => []);

  // Las marcas que llegaron DESPUÉS (el revisor 🔴 o una queja 👎 marcan un
  // turno que ya se había enseñado): se mandan para ponerle el símbolo.
  const marcas = desdeTurno
    ? await db
        .prepare(`SELECT id, marca, motivo FROM turnos WHERE id > ? AND id <= ? AND marca != ''${deUno}`)
        .bind(...conUno([Math.max(desdeTurno - 40, 0), desdeTurno]))
        .all()
        .then((r) => r?.results || [])
        .catch(() => [])
    : [];

  return {
    mensajes: mensajes.map((m) => ({ ...m, cuando: Number(m.cuando) || 0 })),
    turnos: turnos.map((t) => ({ ...t, cuando: Number(t.cuando) || 0, productos: leer(t.productos), notas: leer(t.notas) })),
    marcas,
    ultimo: Math.max(desde, ...mensajes.map((m) => Number(m.id) || 0)),
    ultimoTurno: Math.max(desdeTurno, ...turnos.map((t) => Number(t.id) || 0)),
    nombres: await nombresDe(db, [...mensajes, ...turnos].map((x) => x.igsid)),
  };
}

/* ── Las bases de datos: ver y editar ─────────────────────────────── */

const CREAR_CAMBIOS = `
  CREATE TABLE IF NOT EXISTS cambios_panel (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    cuando INTEGER NOT NULL,
    tabla  TEXT NOT NULL DEFAULT '',
    accion TEXT NOT NULL,
    fila   INTEGER,
    antes  TEXT NOT NULL DEFAULT '',
    despues TEXT NOT NULL DEFAULT '',
    deshecho INTEGER NOT NULL DEFAULT 0
  )
`;

const POR_PAGINA = 50;

// Solo tablas que existen de verdad: el nombre nunca se pega en el SQL sin
// haberlo encontrado antes en sqlite_master.
async function tablasDeLaBase(db) {
  const r = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name")
    .all();
  return (r?.results || []).map((f) => String(f.name));
}

async function columnasDe(db, tabla) {
  const r = await db.prepare(`PRAGMA table_info("${tabla}")`).all();
  return (r?.results || []).map((c) => ({ nombre: String(c.name), tipo: String(c.type || ""), clave: Boolean(c.pk), nulo: !c.notnull }));
}

async function tablaValida(db, nombre) {
  const todas = await tablasDeLaBase(db);
  return todas.includes(String(nombre)) ? String(nombre) : "";
}

async function anotarCambio(db, { tabla = "", accion, fila = null, antes = null, despues = null }) {
  await db.prepare(CREAR_CAMBIOS).run();
  await db
    .prepare("INSERT INTO cambios_panel (cuando, tabla, accion, fila, antes, despues) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(Date.now(), tabla, accion, fila, antes == null ? "" : JSON.stringify(antes), despues == null ? "" : JSON.stringify(despues))
    .run();
}

async function leerFila(db, tabla, rowid) {
  return db.prepare(`SELECT rowid AS _rowid, * FROM "${tabla}" WHERE rowid = ?`).bind(Number(rowid)).first();
}

async function apiBases(ruta, request, env, url) {
  const db = env.DB;

  if (ruta === "tablas") {
    const lista = [];
    for (const nombre of await tablasDeLaBase(db)) {
      const n = await db.prepare(`SELECT COUNT(*) AS n FROM "${nombre}"`).first().catch(() => null);
      lista.push({ nombre, filas: Number(n?.n) || 0, columnas: await columnasDe(db, nombre) });
    }
    return json(lista);
  }

  if (ruta === "tabla") {
    const tabla = await tablaValida(db, url.searchParams.get("nombre"));
    if (!tabla) return json({ error: "Esa tabla no existe" }, 404);
    const columnas = await columnasDe(db, tabla);
    const pagina = Math.max(Number(url.searchParams.get("pagina")) || 1, 1);
    const q = String(url.searchParams.get("q") || "").trim();
    // Buscar en todas las columnas a la vez, como texto.
    const donde = q ? `WHERE ${columnas.map((c) => `CAST("${c.nombre}" AS TEXT) LIKE ?`).join(" OR ")}` : "";
    const args = q ? columnas.map(() => `%${q}%`) : [];
    const total = await db.prepare(`SELECT COUNT(*) AS n FROM "${tabla}" ${donde}`).bind(...args).first();
    const r = await db
      .prepare(`SELECT rowid AS _rowid, * FROM "${tabla}" ${donde} ORDER BY rowid DESC LIMIT ? OFFSET ?`)
      .bind(...args, POR_PAGINA, (pagina - 1) * POR_PAGINA)
      .all();
    return json({ tabla, columnas, filas: r?.results || [], total: Number(total?.n) || 0, pagina, porPagina: POR_PAGINA });
  }

  if (ruta === "fila" && request.method === "GET") {
    const tabla = await tablaValida(db, url.searchParams.get("tabla"));
    if (!tabla) return json({ error: "Esa tabla no existe" }, 404);
    const fila = await leerFila(db, tabla, url.searchParams.get("rowid"));
    return fila ? json({ tabla, columnas: await columnasDe(db, tabla), fila }) : json({ error: "No existe esa fila" }, 404);
  }

  if (request.method !== "POST") return null;
  const cuerpo = await request.json().catch(() => ({}));

  if (ruta === "fila") {
    const tabla = await tablaValida(db, cuerpo.tabla);
    if (!tabla) return json({ error: "Esa tabla no existe" }, 404);
    const columnas = await columnasDe(db, tabla);
    const nombres = columnas.map((c) => c.nombre);
    const cambios = Object.entries(cuerpo.cambios || {}).filter(([c]) => nombres.includes(c));
    if (!cambios.length) return json({ error: "No hay nada que cambiar" }, 400);
    const antes = await leerFila(db, tabla, cuerpo.rowid);
    if (!antes) return json({ error: "No existe esa fila" }, 404);
    await db
      .prepare(`UPDATE "${tabla}" SET ${cambios.map(([c]) => `"${c}" = ?`).join(", ")} WHERE rowid = ?`)
      // Un campo vaciado queda NULL solo si la columna lo admite; si no, "".
      .bind(...cambios.map(([c, v]) => (v === "" || v === undefined ? (columnas.find((x) => x.nombre === c).nulo ? null : "") : v)), Number(cuerpo.rowid))
      .run();
    const despues = await leerFila(db, tabla, cuerpo.rowid);
    await anotarCambio(db, { tabla, accion: "editar", fila: Number(cuerpo.rowid), antes, despues });
    console.log(`BASE: editada la fila ${cuerpo.rowid} de ${tabla} desde el panel central`);
    return json({ ok: true, fila: despues });
  }

  if (ruta === "borrar") {
    const tabla = await tablaValida(db, cuerpo.tabla);
    if (!tabla) return json({ error: "Esa tabla no existe" }, 404);
    const antes = await leerFila(db, tabla, cuerpo.rowid);
    if (!antes) return json({ error: "No existe esa fila" }, 404);
    await db.prepare(`DELETE FROM "${tabla}" WHERE rowid = ?`).bind(Number(cuerpo.rowid)).run();
    await anotarCambio(db, { tabla, accion: "borrar", fila: Number(cuerpo.rowid), antes });
    console.log(`BASE: borrada la fila ${cuerpo.rowid} de ${tabla} desde el panel central`);
    return json({ ok: true });
  }

  if (ruta === "sql") {
    const sql = String(cuerpo.sql || "").trim();
    if (!sql) return json({ error: "Escribe una consulta" }, 400);
    const esLectura = /^(select|pragma|with|explain)\b/i.test(sql);
    try {
      if (esLectura) {
        const r = await db.prepare(sql).all();
        return json({ filas: (r?.results || []).slice(0, 500), total: (r?.results || []).length });
      }
      const r = await db.prepare(sql).run();
      await anotarCambio(db, { accion: "sql", despues: { sql } });
      console.log(`BASE: SQL desde el panel central: ${sql.slice(0, 120)}`);
      return json({ ok: true, cambios: r?.meta?.changes ?? null });
    } catch (error) {
      return json({ error: String(error?.message || error) }, 400);
    }
  }

  if (ruta === "deshacer") {
    await db.prepare(CREAR_CAMBIOS).run();
    const c = await db.prepare("SELECT * FROM cambios_panel WHERE id = ?").bind(Number(cuerpo.id)).first();
    if (!c || c.deshecho) return json({ error: "Ese cambio no existe o ya se deshizo" }, 404);
    if (c.accion === "sql") return json({ error: "Un SQL no se puede deshacer solo: mira el historial y escribe el contrario" }, 400);
    const tabla = await tablaValida(db, c.tabla);
    if (!tabla) return json({ error: "Esa tabla ya no existe" }, 404);
    const antes = JSON.parse(c.antes || "{}");
    const { _rowid, ...valores } = antes;
    const columnas = Object.keys(valores);
    if (c.accion === "editar") {
      await db
        .prepare(`UPDATE "${tabla}" SET ${columnas.map((k) => `"${k}" = ?`).join(", ")} WHERE rowid = ?`)
        .bind(...columnas.map((k) => valores[k]), Number(c.fila))
        .run();
    } else if (c.accion === "borrar") {
      await db
        .prepare(`INSERT INTO "${tabla}" (rowid, ${columnas.map((k) => `"${k}"`).join(", ")}) VALUES (?, ${columnas.map(() => "?").join(", ")})`)
        .bind(Number(c.fila), ...columnas.map((k) => valores[k]))
        .run();
    }
    await db.prepare("UPDATE cambios_panel SET deshecho = 1 WHERE id = ?").bind(Number(c.id)).run();
    console.log(`BASE: deshecho el cambio ${c.id} (${c.accion} en ${tabla})`);
    return json({ ok: true });
  }

  return null;
}

export async function atenderApiCentral(request, env, opciones = {}) {
  if (!apiCentralActiva(env)) return json({ error: "La puerta del panel central está cerrada: falta PANEL_API_CLAVE (16 letras o más)." }, 403);
  if (!autorizadoCentral(request, env)) {
    console.error("API CENTRAL: alguien probó una clave equivocada");
    return json({ error: "Clave equivocada" }, 401);
  }

  const url = new URL(request.url);
  const ruta = url.pathname.replace(/^\/api\/central\/?/, "");

  try {
    if (ruta === "vivo") return json(await vivoCentral(env, url));
    if (ruta === "ping") return json({ ok: true, tienda: opciones.tienda, version: opciones.version || "", ahora: Date.now() });
    if (ruta === "resumen") return json(await resumenCentral(env, opciones));
    if (ruta === "metricas") return json(await metricasCentral(env, url.searchParams.get("dias")));
    if (ruta === "ganadores") return json(await ganadoresCentral(env, url.searchParams.get("dias")));

    if (ruta === "chats") {
      const lista = await contactosParaLista(env.DB, { q: url.searchParams.get("q") || "", filtro: url.searchParams.get("f") || "" });
      return json(lista.map(({ charla, ...resto }) => resto));
    }

    if (ruta === "chat") {
      const id = String(url.searchParams.get("id") || "");
      const contacto = await cargarContacto(env.DB, id);
      const guardados = await mensajesDe(env.DB, id);
      return json({
        contacto: {
          id,
          nombre: contacto.nombre_completo || contacto.nombre || "",
          usuario: contacto.usuario || "",
          historial: contacto.historial || "",
          pausado_hasta: Number(contacto.pausado_hasta) || 0,
          ultimo_envio: Number(contacto.ultimo_envio) || 0,
          anuncio: contacto.publicacion?.deAnuncio
            ? { equipo: contacto.publicacion.equipo || "", cuando: contacto.publicacion.cuando || 0 }
            : null,
        },
        mensajes: guardados.length ? guardados : contacto.conversacion || [],
        turnos: await turnosDe(env.DB, id),
        horasDePausa: opciones.horasDePausa || 1,
      });
    }

    if (ruta === "errores") {
      const desde = Date.now() - Math.min(Math.max(Number(url.searchParams.get("dias")) || 7, 1), 30) * DIA_MS;
      const filas = await leerTabla(env.DB, TABLAS.CREAR_ERRORES, "SELECT cuando, texto FROM errores WHERE cuando > ? ORDER BY cuando DESC LIMIT 300", desde);
      return json(filas.map((e) => ({ cuando: Number(e.cuando), texto: e.texto, tipo: tipoDeError(e.texto) })));
    }

    if (ruta === "estado") {
      return json({ texto: opciones.verTexto ? await opciones.verTexto("/estado") : "" });
    }

    if (ruta === "cambios") {
      const filas = await leerTabla(env.DB, CREAR_CAMBIOS, "SELECT * FROM cambios_panel WHERE id > ? ORDER BY id DESC LIMIT 100", 0);
      return json(filas);
    }

    if (["tablas", "tabla", "fila", "borrar", "sql", "deshacer"].includes(ruta)) {
      const respuesta = await apiBases(ruta, request, env, url);
      if (respuesta) return respuesta;
    }

    if (ruta === "devolver-todos" && request.method === "POST") {
      const cuantos = await despausarTodos(env.DB, "Un asesor lo atendió y le devolvió la conversación al bot desde el panel central.");
      console.log(`API CENTRAL: devueltas al bot ${cuantos} conversaciones en pausa`);
      return json({ ok: true, cuantos });
    }

    if ((ruta === "pausar" || ruta === "devolver") && request.method === "POST") {
      const { id } = await request.json().catch(() => ({}));
      if (!id) return json({ error: "Falta el id" }, 400);
      if (ruta === "pausar") await pausar(env.DB, String(id), opciones.horasDePausa || 1);
      else await despausar(env.DB, String(id), "Un asesor lo atendió y le devolvió la conversación al bot desde el panel central.");
      console.log(`API CENTRAL: ${ruta} ${id}`);
      return json({ ok: true });
    }

    return json({ error: "No existe" }, 404);
  } catch (error) {
    console.error("API CENTRAL falló:", error?.message || error);
    return json({ error: String(error?.message || error) }, 500);
  }
}
