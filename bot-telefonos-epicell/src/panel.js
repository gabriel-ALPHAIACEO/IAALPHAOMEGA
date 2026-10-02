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

import { cargarContacto, pausar, despausar, asegurarColumnas } from "./estado.js";

const COOKIE = "panel_tienda";
const SESION_MS = 30 * 24 * 60 * 60 * 1000;
const TURNOS_DIAS = 60;

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
function vieneDelPanel(request, url) {
  const origen = request.headers.get("origin") || "";
  return !origen || origen === url.origin;
}

/* ── Lo que pensó la IA, turno a turno ────────────────────────────── */

const CREAR_TURNOS = `
  CREATE TABLE IF NOT EXISTS turnos (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    igsid     TEXT NOT NULL,
    cuando    INTEGER NOT NULL,
    cliente   TEXT NOT NULL DEFAULT '',
    pienso    TEXT NOT NULL DEFAULT '',
    buscar    TEXT NOT NULL DEFAULT '',
    mostrar   TEXT NOT NULL DEFAULT '',
    respuesta TEXT NOT NULL DEFAULT '',
    productos TEXT NOT NULL DEFAULT '[]',
    notas     TEXT NOT NULL DEFAULT '[]'
  )
`;

export async function anotarTurno(db, turno) {
  if (!db || !turno?.igsid) return;
  try {
    await db.prepare(CREAR_TURNOS).run();
    await db
      .prepare(
        "INSERT INTO turnos (igsid, cuando, cliente, pienso, buscar, mostrar, respuesta, productos, notas) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        String(turno.igsid),
        Date.now(),
        String(turno.cliente || "").slice(0, 1000),
        String(turno.pienso || "").slice(0, 1000),
        String(turno.buscar || "").slice(0, 200),
        String(turno.mostrar || ""),
        String(turno.respuesta || "").slice(0, 2000),
        JSON.stringify((turno.productos || []).slice(0, 10)),
        JSON.stringify((turno.notas || []).filter(Boolean).slice(0, 12))
      )
      .run();
    // De vez en cuando se barre lo viejo: no hace falta hacerlo siempre.
    if (Math.random() < 0.02) {
      await db.prepare("DELETE FROM turnos WHERE cuando < ?").bind(Date.now() - TURNOS_DIAS * 86400000).run();
    }
  } catch (error) {
    // Guardar esto es un extra: nunca deja a un cliente sin respuesta.
    console.error("No pude anotar el turno para el panel:", error?.message || error);
  }
}

async function turnosDe(db, igsid) {
  try {
    await db.prepare(CREAR_TURNOS).run();
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
.lista a.tarjeta{display:block;color:inherit}
.nombre{font-weight:600}.suave{color:var(--suave);font-size:13px}
.etiqueta{display:inline-block;font-size:12px;border-radius:999px;padding:1px 8px;margin-left:6px;border:1px solid var(--borde)}
.pausa{color:var(--alerta);border-color:var(--alerta)}.anuncio{color:var(--marca);border-color:var(--marca)}
.chat{display:flex;flex-direction:column;gap:8px}
.burbuja{max-width:85%;padding:8px 12px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word}
.de-cliente{align-self:flex-start;background:var(--cliente)}.de-bot{align-self:flex-end;background:var(--bot)}
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

function pagina(titulo, cuerpo, { tienda = "La tienda", conMenu = true } = {}) {
  const menu = conMenu
    ? `<a href="/panel">Chats</a><a href="/panel/anuncios">Anuncios</a><a href="/panel/estado">Estado</a><a href="/panel/salir">Salir</a>`
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
        "referrer-policy": "no-referrer",
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
  const r = await db
    .prepare(
      `SELECT id, nombre, nombre_completo, usuario, ultimo_envio, pausado_hasta, conversacion, publicacion
         FROM contactos ORDER BY ultimo_envio DESC LIMIT 300`
    )
    .all();
  const busca = String(q || "").toLowerCase().trim();
  return (r?.results || [])
    .map((f) => {
      const charla = leer(f.conversacion);
      const ultima = charla[charla.length - 1];
      let pub = null;
      try {
        pub = f.publicacion ? JSON.parse(f.publicacion) : null;
      } catch {}
      return {
        id: String(f.id),
        nombre: f.nombre_completo || f.nombre || "",
        usuario: f.usuario || "",
        ultimo: Number(f.ultimo_envio) || 0,
        pausado: Number(f.pausado_hasta) > Date.now(),
        ultima,
        charla,
        anuncio: pub?.deAnuncio ? pub.equipo || pub.titulo || "anuncio" : "",
      };
    })
    .filter((c) => (filtro === "pausados" ? c.pausado : filtro === "anuncios" ? Boolean(c.anuncio) : true))
    .filter((c) => {
      if (!busca) return true;
      const enTexto = c.charla.some((l) => String(l.texto || "").toLowerCase().includes(busca));
      return enTexto || `${c.nombre} ${c.usuario} ${c.id}`.toLowerCase().includes(busca);
    })
    .slice(0, 100);
}

async function paginaDeLista(env, url, tienda) {
  const q = url.searchParams.get("q") || "";
  const filtro = url.searchParams.get("f") || "";
  const contactos = await contactosParaLista(env.DB, { q, filtro });
  const enlaceFiltro = (f, nombre) =>
    `<a class="${filtro === f ? "activo" : ""}" href="/panel${f ? `?f=${f}` : ""}">${nombre}</a>`;

  const filas = contactos
    .map(
      (c) => `<a class="tarjeta" href="/panel/c/${encodeURIComponent(c.id)}">
<span class="nombre">${esc(c.nombre || c.usuario || c.id)}</span>${c.usuario ? ` <span class="suave">@${esc(c.usuario)}</span>` : ""}
${c.pausado ? '<span class="etiqueta pausa">bot en pausa</span>' : ""}${c.anuncio ? `<span class="etiqueta anuncio">anuncio · ${esc(String(c.anuncio).slice(0, 30))}</span>` : ""}
<div class="suave">${esc(cuandoFue(c.ultimo))}${c.ultima ? ` · ${c.ultima.de === "bot" ? "Bot: " : ""}${esc(String(c.ultima.texto || "").slice(0, 90))}` : ""}</div></a>`
    )
    .join("");

  return pagina(
    "Conversaciones",
    `<form class="buscar" method="get" action="/panel"><input name="q" value="${esc(q)}" placeholder="Buscar por nombre, @usuario o lo que escribió">
${filtro ? `<input type="hidden" name="f" value="${esc(filtro)}">` : ""}<button>Buscar</button></form>
<div class="filtros">${enlaceFiltro("", "Todas")}${enlaceFiltro("pausados", "Con el bot en pausa")}${enlaceFiltro("anuncios", "Vinieron de un anuncio")}</div><br>
<div class="lista">${filas || '<p class="suave">No hay conversaciones con eso.</p>'}</div>`,
    { tienda }
  );
}

function cajaDePienso(t) {
  const partes = [];
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

async function paginaDeConversacion(env, id, tienda, { horasDePausa = 1 } = {}) {
  const contacto = await cargarContacto(env.DB, id);
  const charla = contacto.conversacion || [];
  const turnos = await turnosDe(env.DB, id);
  const usados = new Set();

  // Cada respuesta del bot se empareja con el turno que la produjo (por
  // su texto), y debajo va lo que pensó la IA.
  const normal = (t) => String(t || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const burbujas = charla
    .map((linea) => {
      const caja = `<div class="burbuja ${linea.de === "bot" ? "de-bot" : "de-cliente"}">${esc(linea.texto)}</div>`;
      if (linea.de !== "bot") return caja;
      const i = turnos.findIndex((t, n) => !usados.has(n) && normal(t.respuesta) && normal(t.respuesta) === normal(linea.texto));
      if (i === -1) return caja;
      usados.add(i);
      return caja + cajaDePienso(turnos[i]);
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
    { tienda }
  );
}

/* ── La puerta de entrada ────────────────────────────────────────── */

// verTexto(ruta) devuelve el texto de /estado o /anuncios, para no tener
// dos copias de lo mismo.
export async function atenderPanel(request, env, { verTexto, tienda = "La tienda", horasDePausa = 1 } = {}) {
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
        await despausar(env.DB, id, "Un asesor lo atendió y le devolvió la conversación al bot desde el panel.");
        console.log(`PANEL: el dueño le devolvió ${id} al bot`);
      }
    }
    return redirigir(`/panel/c/${encodeURIComponent(id)}`);
  }

  if (url.pathname.startsWith("/panel/c/")) {
    const id = decodeURIComponent(url.pathname.slice("/panel/c/".length));
    return paginaDeConversacion(env, id, tienda, { horasDePausa });
  }

  if (url.pathname === "/panel/anuncios" || url.pathname === "/panel/estado") {
    const texto = verTexto ? await verTexto(url.pathname === "/panel/anuncios" ? "/anuncios" : "/estado") : "";
    return pagina(
      url.pathname === "/panel/anuncios" ? "Anuncios" : "Estado",
      `<div class="tarjeta"><pre>${esc(texto)}</pre></div>`,
      { tienda }
    );
  }

  return paginaDeLista(env, url, tienda);
}
