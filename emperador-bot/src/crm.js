// EL CRM DEL CLIENTE (5-oct-2026). IGUAL EN LAS TRES TIENDAS.
//
// QUÉ SE PEDÍA. El dueño: "colocarle a los clientes las métricas de los
// productos ganadores, las métricas de sus clientes, un CRM completo; lo
// demás es confidencial". Confidencial (solo en el panel ALPHA IA): los
// gastos, el estado técnico y sus errores, y las bases de datos. Todo lo
// demás lo ve la tienda en su /panel.
//
// QUÉ TRAE:
//   · La lista de clientes (/panel/clientes): cada persona con su etapa,
//     etiquetas, primer y último contacto, mensajes, productos que vio, si
//     quiso comprar y si llegó por un anuncio. Con filtros y a Excel.
//   · La ficha de cada uno, en su conversación: los mismos datos, y la
//     etapa, las notas y las etiquetas, que la tienda edita.
//
// LA ETAPA. La que marca la tienda manda. Si no marcó ninguna, el bot
// sugiere una con lo que ve: quiso comprar → "Quiere comprar"; vio
// productos o escribió varias veces → "Interesado"; si no, "Nuevo".
// "Vendido" y "Perdido" solo los pone una persona: el bot no lo sabe.
//
// LOS DATOS. Los de siempre (mensajes, turnos, avisos, contactos) y una
// tabla nueva, "crm", con lo que escribe la tienda. Se crea sola.

import { esIntencionDeCompra } from "./registro.js";

// El "usuario" de un cliente de WhatsApp es su teléfono ("+58…", ver
// whatsapp.js): sale tal cual, sin la @ de Instagram.
const arroba = (u) => (String(u || "").startsWith("+") ? "" : "@");
import { icono } from "./iconos.js";

export const ETAPAS = [
  ["nuevo", "Nuevo"],
  ["interesado", "Interesado"],
  ["quiere_comprar", "Quiere comprar"],
  ["vendido", "Vendido"],
  ["perdido", "Perdido"],
];
const NOMBRE_DE_ETAPA = Object.fromEntries(ETAPAS);
// Cada etapa con su ícono (7-oct-2026: sin emojis).
const ICONO_DE_ETAPA = { nuevo: "usuario", interesado: "ojo", quiere_comprar: "carrito", vendido: "check", perdido: "cerrar" };

function esc(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const DESFASE_MS = -4 * 60 * 60 * 1000; // hora de Venezuela
function fecha(ms) {
  if (!ms) return "";
  return new Date(Number(ms)).toLocaleString("es-VE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Caracas" });
}
function dia(ms) {
  return ms ? new Date(Number(ms) + DESFASE_MS).toISOString().slice(0, 10) : "";
}

/* ── La tabla de lo que escribe la tienda ────────────────────────── */

const CREAR_CRM = `
  CREATE TABLE IF NOT EXISTS crm (
    igsid       TEXT PRIMARY KEY,
    etapa       TEXT NOT NULL DEFAULT '',
    notas       TEXT NOT NULL DEFAULT '',
    etiquetas   TEXT NOT NULL DEFAULT '[]',
    actualizado INTEGER NOT NULL DEFAULT 0
  )`;

let crmLista = false;
async function asegurarCrm(db) {
  if (crmLista) return;
  await db.prepare(CREAR_CRM).run();
  crmLista = true;
}

function leerEtiquetas(valor) {
  try {
    const v = JSON.parse(valor || "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

// "VIP, mayorista ,  vip" → ["VIP", "mayorista"]
export function limpiarEtiquetas(texto) {
  const vistas = new Set();
  return String(texto || "")
    .split(/[,;\n]/)
    .map((e) => e.trim().replace(/\s+/g, " ").slice(0, 30))
    .filter((e) => e && !vistas.has(e.toLowerCase()) && vistas.add(e.toLowerCase()))
    .slice(0, 12);
}

export async function guardarCrm(db, igsid, { etapa = "", notas = "", etiquetas = "" } = {}) {
  if (!db || !igsid) return false;
  await asegurarCrm(db);
  const laEtapa = NOMBRE_DE_ETAPA[etapa] ? etapa : "";
  await db
    .prepare(
      `INSERT INTO crm (igsid, etapa, notas, etiquetas, actualizado) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(igsid) DO UPDATE SET etapa = excluded.etapa, notas = excluded.notas,
         etiquetas = excluded.etiquetas, actualizado = excluded.actualizado`
    )
    .bind(String(igsid), laEtapa, String(notas || "").slice(0, 2000), JSON.stringify(limpiarEtiquetas(etiquetas)), Date.now())
    .run();
  return true;
}

/* ── Juntar lo que se sabe de cada persona ───────────────────────── */

async function filas(db, consulta, ...args) {
  try {
    const r = await db.prepare(consulta).bind(...args).all();
    return r?.results || [];
  } catch {
    return []; // la tabla todavía no existe: no hay nada que contar
  }
}

function leerLista(json) {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function etapaSugerida(c) {
  if (c.compras > 0) return "quiere_comprar";
  if (c.productos.length > 0 || c.mensajes >= 3) return "interesado";
  return "nuevo";
}

// Todos los clientes (o uno, con "soloId"), con lo que se sabe de cada uno.
export async function clientesDelCrm(db, { soloId = "" } = {}) {
  if (!db) return [];
  await asegurarCrm(db).catch(() => {});
  const uno = soloId ? " WHERE igsid = ?" : "";
  const args = soloId ? [String(soloId)] : [];

  const columnas = new Set((await filas(db, "PRAGMA table_info(contactos)")).map((c) => String(c.name)));
  const pedir = ["id", "nombre", "nombre_completo", "usuario", "publicacion", "pausado_hasta"].filter((c) => columnas.has(c));
  const contactos = pedir.includes("id")
    ? await filas(db, `SELECT ${pedir.join(", ")} FROM contactos${soloId ? " WHERE id = ?" : ""} LIMIT 3000`, ...args)
    : [];
  const mensajes = await filas(
    db,
    `SELECT igsid, MIN(cuando) AS primero, MAX(cuando) AS ultimo, SUM(CASE WHEN de = 'cliente' THEN 1 ELSE 0 END) AS n FROM mensajes${uno} GROUP BY igsid`,
    ...args
  );
  const turnos = await filas(db, `SELECT igsid, productos FROM turnos${uno ? `${uno} AND` : " WHERE"} productos IS NOT NULL AND productos != '' AND productos != '[]'`, ...args);
  const avisos = await filas(db, `SELECT igsid, motivo, productos, cuando FROM avisos${uno} ORDER BY cuando DESC`, ...args);
  const crm = await filas(db, `SELECT igsid, etapa, notas, etiquetas, actualizado FROM crm${uno}`, ...args);

  const porId = new Map();
  const de = (id) => {
    const clave = String(id);
    if (!porId.has(clave)) {
      porId.set(clave, { id: clave, nombre: "", usuario: "", anuncio: "", pausado: false, primero: 0, ultimo: 0, mensajes: 0, productos: [], compras: 0, intenciones: [], etapaPuesta: "", notas: "", etiquetas: [], actualizado: 0 });
    }
    return porId.get(clave);
  };

  for (const f of contactos) {
    const c = de(f.id);
    c.nombre = f.nombre_completo || f.nombre || "";
    c.usuario = f.usuario || "";
    c.pausado = Number(f.pausado_hasta) > Date.now();
    try {
      const pub = f.publicacion ? JSON.parse(f.publicacion) : null;
      if (pub?.deAnuncio) c.anuncio = pub.equipo || pub.titulo || "anuncio";
    } catch {}
  }
  for (const f of mensajes) {
    const c = de(f.igsid);
    c.primero = Number(f.primero) || 0;
    c.ultimo = Number(f.ultimo) || 0;
    c.mensajes = Number(f.n) || 0;
  }
  const vistos = new Map();
  for (const f of turnos) {
    if (!vistos.has(String(f.igsid))) vistos.set(String(f.igsid), new Set());
    for (const titulo of leerLista(f.productos)) vistos.get(String(f.igsid)).add(titulo);
  }
  for (const [id, set] of vistos) de(id).productos = [...set];
  for (const f of avisos) {
    if (!esIntencionDeCompra(f.motivo)) continue;
    const c = de(f.igsid);
    c.compras++;
    if (c.intenciones.length < 5) c.intenciones.push({ cuando: Number(f.cuando) || 0, motivo: String(f.motivo || ""), productos: leerLista(f.productos) });
  }
  for (const f of crm) {
    const c = de(f.igsid);
    c.etapaPuesta = NOMBRE_DE_ETAPA[f.etapa] ? f.etapa : "";
    c.notas = f.notas || "";
    c.etiquetas = leerEtiquetas(f.etiquetas);
    c.actualizado = Number(f.actualizado) || 0;
  }

  return [...porId.values()]
    .filter((c) => c.mensajes > 0 || c.nombre || c.etapaPuesta || c.notas)
    .map((c) => ({ ...c, sugerida: etapaSugerida(c), etapa: c.etapaPuesta || etapaSugerida(c) }))
    .sort((a, b) => b.ultimo - a.ultimo);
}

/* ── Lo que se ve ────────────────────────────────────────────────── */

export function chipDeEtapa(etapa) {
  return `<span class="etapa etapa-${esc(etapa)}">${icono(ICONO_DE_ETAPA[etapa] || "usuario")}${esc(NOMBRE_DE_ETAPA[etapa] || etapa)}</span>`;
}

// Los filtros de la lista: etapa, etiqueta y búsqueda.
export function filtrarClientes(clientes, { etapa = "", etiqueta = "", q = "" } = {}) {
  const busca = String(q || "").toLowerCase().trim();
  const etq = String(etiqueta || "").toLowerCase();
  return clientes.filter(
    (c) =>
      (!etapa || c.etapa === etapa) &&
      (!etq || c.etiquetas.some((e) => e.toLowerCase() === etq)) &&
      (!busca || `${c.nombre} ${c.usuario} ${c.id} ${c.notas} ${c.etiquetas.join(" ")} ${c.productos.join(" ")}`.toLowerCase().includes(busca))
  );
}

export function htmlListaDeClientes(clientes, { etapa = "", etiqueta = "", q = "" } = {}) {
  const semana = Date.now() - 7 * 864e5;
  const cuenta = Object.fromEntries(ETAPAS.map(([e]) => [e, clientes.filter((c) => c.etapa === e).length]));
  const vendidos = cuenta.vendido || 0;
  const conEtapa = (e) => `/panel/clientes?${new URLSearchParams({ ...(e ? { etapa: e } : {}), ...(etiqueta ? { etiqueta } : {}), ...(q ? { q } : {}) })}`;
  const embudo = [
    `<a class="${!etapa ? "activa" : ""}" href="${esc(conEtapa(""))}"><b>${clientes.length}</b><span>${icono("clientes", { clase: "chico" })}Todos</span></a>`,
    ...ETAPAS.map(([e, nombre]) => `<a class="${etapa === e ? "activa" : ""}" href="${esc(conEtapa(e))}"><b>${cuenta[e] || 0}</b><span>${icono(ICONO_DE_ETAPA[e], { clase: "chico" })}${esc(nombre)}</span></a>`),
  ].join("");
  const todasLasEtiquetas = [...new Set(clientes.flatMap((c) => c.etiquetas))].sort((a, b) => a.localeCompare(b));
  const lista = filtrarClientes(clientes, { etapa, etiqueta, q });
  const filasHtml = lista
    .slice(0, 300)
    .map((c) => {
      const nombre = c.nombre || (c.usuario ? `${arroba(c.usuario)}${c.usuario}` : c.id);
      const sub = [
        c.usuario && c.nombre ? `${arroba(c.usuario)}${esc(c.usuario)}` : "",
        `${c.mensajes} ${c.mensajes === 1 ? "mensaje" : "mensajes"}`,
        c.productos.length ? `vio ${c.productos.length} ${c.productos.length === 1 ? "producto" : "productos"}` : "",
        c.ultimo ? `último ${esc(fecha(c.ultimo))}` : "",
      ].filter(Boolean).join(" · ");
      const extras = [
        c.anuncio ? `<span class="chip marca">${icono("anuncios")}${esc(String(c.anuncio).slice(0, 30))}</span>` : "",
        ...c.etiquetas.map((e) => `<span class="etiqueta-crm">${esc(e)}</span>`),
      ].join("");
      return `<a class="fila" data-k="c${esc(c.id)}" href="/panel/c/${encodeURIComponent(c.id)}">${avatarDe(nombre)}<div class="fila-centro"><div class="fila-titulo">${esc(nombre)}</div><div class="fila-sub">${sub}</div>${extras ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">${extras}</div>` : ""}</div>
<div class="fila-fin">${chipDeEtapa(c.etapa)}${c.etapaPuesta ? "" : '<small>sugerida</small>'}${c.compras ? `<small>${icono("carrito", { clase: "chico" })} quiso comprar ${c.compras}</small>` : ""}</div></a>`;
    })
    .join("");
  const exportar = `/panel/clientes.csv?${new URLSearchParams({ ...(etapa ? { etapa } : {}), ...(etiqueta ? { etiqueta } : {}), ...(q ? { q } : {}) })}`;
  const dato = (valor, nombre, ico, clase = "") => `<div class="dato"><div class="dato-cima"><span class="dato-nombre">${esc(nombre)}</span><span class="insignia chica${clase ? ` ${clase}` : ""}">${icono(ico)}</span></div><div class="dato-valor">${esc(valor)}</div></div>`;
  return `<div class="cabeza"><div class="cabeza-texto"><div class="sobre">Ventas con IA</div><h1>Clientes</h1><p>Todas las personas que le escribieron al bot, en qué etapa están y qué vieron. La etapa "sugerida" la pone el bot; la que marques en la ficha de cada cliente manda.</p></div><div class="cabeza-acciones"><a class="boton suave" href="${esc(exportar)}">${icono("bajar")}Excel</a></div></div>
<div class="mosaico">${dato(clientes.length, "Clientes en total", "clientes")}${dato(clientes.filter((c) => c.primero > semana).length, "Nuevos esta semana", "usuario")}${dato(cuenta.quiere_comprar || 0, "Quieren comprar", "carrito", "tono-aviso")}${dato(vendidos, "Vendidos", "check", "tono-bien")}${dato(`${clientes.length ? Math.round((vendidos / clientes.length) * 100) : 0}%`, "De los clientes compró", "sube", "tono-bien")}</div>
<div class="embudo">${embudo}</div>
<form class="herramientas" method="get" action="/panel/clientes">${etapa ? `<input type="hidden" name="etapa" value="${esc(etapa)}">` : ""}
<label class="buscador">${icono("buscar")}<input name="q" value="${esc(q)}" placeholder="Buscar por nombre, @usuario, nota, etiqueta o producto"></label>
<select name="etiqueta"><option value="">Todas las etiquetas</option>${todasLasEtiquetas.map((e) => `<option${e === etiqueta ? " selected" : ""}>${esc(e)}</option>`).join("")}</select>
<button>Filtrar</button></form>
<p class="suave">${lista.length} ${lista.length === 1 ? "cliente" : "clientes"}${lista.length > 300 ? " · se ven los 300 más recientes (el Excel trae todos)" : ""}</p>
${filasHtml ? `<div class="filas">${filasHtml}</div>` : '<div class="vacio"><h3>No hay clientes con eso</h3><p>Prueba con otra etapa o quita la búsqueda.</p></div>'}`;
}

// Las iniciales en un círculo con un color propio (igual que marco.js;
// aquí suelto para no depender del marco).
function avatarDe(nombre) {
  const limpio = String(nombre || "?").trim();
  const partes = limpio.replace(/^@/, "").split(/\s+/).filter(Boolean);
  const iniciales = ((partes[0]?.[0] || "?") + (partes.length > 1 ? partes.at(-1)[0] : partes[0]?.[1] || "")).toUpperCase();
  let h = 0;
  for (const c of limpio) h = (h * 31 + c.codePointAt(0)) % 360;
  return `<span class="avatar" style="--h:${h}" aria-hidden="true">${esc(iniciales)}</span>`;
}

// La ficha, dentro de la conversación: datos y lo que edita la tienda.
export function htmlFichaDeCliente(c, { accion = "/panel/crm", id = "" } = {}) {
  const cliente = c || { id, mensajes: 0, productos: [], compras: 0, intenciones: [], etiquetas: [], notas: "", etapa: "nuevo", sugerida: "nuevo", etapaPuesta: "" };
  const opciones = [
    `<option value=""${cliente.etapaPuesta ? "" : " selected"}>Automática (el bot sugiere: ${esc(NOMBRE_DE_ETAPA[cliente.sugerida] || "Nuevo")})</option>`,
    ...ETAPAS.map(([e, nombre]) => `<option value="${esc(e)}"${cliente.etapaPuesta === e ? " selected" : ""}>${esc(nombre)}</option>`),
  ].join("");
  return `<details class="tarjeta" id="crm" open><summary><b>Ficha del cliente</b> · ${chipDeEtapa(cliente.etapa)}</summary>
<div class="ficha-crm">
<div><b>PRIMER CONTACTO</b>${esc(fecha(cliente.primero) || "—")}</div>
<div><b>ÚLTIMO MENSAJE</b>${esc(fecha(cliente.ultimo) || "—")}</div>
<div><b>MENSAJES SUYOS</b>${cliente.mensajes}</div>
<div><b>QUISO COMPRAR</b>${cliente.compras ? `${cliente.compras} ${cliente.compras === 1 ? "vez" : "veces"}` : "todavía no"}</div>
${cliente.anuncio ? `<div><b>LLEGÓ POR</b>${esc(cliente.anuncio)}</div>` : ""}
</div>
${cliente.productos.length ? `<div class="suave"><b>Productos que vio:</b> ${esc(cliente.productos.slice(-12).join(" · "))}</div>` : ""}
${cliente.intenciones.length ? `<div class="suave"><b>Cuándo quiso comprar:</b> ${cliente.intenciones.map((i) => `${esc(fecha(i.cuando))}${i.productos.length ? ` (${esc(i.productos.slice(0, 2).join(", "))})` : ""}`).join(" · ")}</div>` : ""}
<form method="post" action="${esc(accion)}"><input type="hidden" name="id" value="${esc(cliente.id || id)}">
<div class="campos" style="margin-top:14px"><label class="campo">Etapa<select name="etapa">${opciones}</select></label>
<label class="campo">Etiquetas<input name="etiquetas" value="${esc(cliente.etiquetas.join(", "))}" placeholder="VIP, mayorista, Margarita… (separadas por coma)"></label>
<label class="campo ancho">Notas<textarea name="notas" rows="4" maxlength="2000" placeholder="Notas de este cliente (solo las ve la tienda)">${esc(cliente.notas)}</textarea></label></div>
<div class="acciones"><button class="principal">Guardar ficha</button>${cliente.actualizado ? `<span class="suave">Guardada ${esc(fecha(cliente.actualizado))}</span>` : ""}</div></form></details>`;
}

export function filasCsvDeClientes(clientes) {
  return {
    encabezados: ["Nombre", "Usuario", "Id", "Etapa", "Etapa puesta a mano", "Etiquetas", "Notas", "Mensajes", "Productos que vio", "Veces que quiso comprar", "Llegó por anuncio", "Primer contacto", "Último mensaje"],
    filas: clientes.map((c) => [
      c.nombre,
      c.usuario ? `${arroba(c.usuario)}${c.usuario}` : "",
      c.id,
      NOMBRE_DE_ETAPA[c.etapa] || c.etapa,
      c.etapaPuesta ? "sí" : "no (sugerida)",
      c.etiquetas.join(", "),
      c.notas,
      c.mensajes,
      c.productos.join(" | "),
      c.compras,
      c.anuncio || "",
      dia(c.primero),
      dia(c.ultimo),
    ]),
  };
}
