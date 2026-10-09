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
// whatsapp.js): va con 📱 en vez de @.
const arroba = (u) => (String(u || "").startsWith("+") ? "📱 " : "@");

export const ETAPAS = [
  ["nuevo", "🆕 Nuevo"],
  ["interesado", "👀 Interesado"],
  ["quiere_comprar", "🛒 Quiere comprar"],
  ["vendido", "✅ Vendido"],
  ["perdido", "✖️ Perdido"],
];
const NOMBRE_DE_ETAPA = Object.fromEntries(ETAPAS);

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
  return `<span class="etapa etapa-${esc(etapa)}">${esc(NOMBRE_DE_ETAPA[etapa] || etapa)}</span>`;
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
    `<a class="${!etapa ? "activa" : ""}" href="${esc(conEtapa(""))}"><b>${clientes.length}</b><span>Todos</span></a>`,
    ...ETAPAS.map(([e, nombre]) => `<a class="${etapa === e ? "activa" : ""}" href="${esc(conEtapa(e))}"><b>${cuenta[e] || 0}</b><span>${esc(nombre)}</span></a>`),
  ].join("");
  const todasLasEtiquetas = [...new Set(clientes.flatMap((c) => c.etiquetas))].sort((a, b) => a.localeCompare(b));
  const lista = filtrarClientes(clientes, { etapa, etiqueta, q });
  const filasHtml = lista
    .slice(0, 300)
    .map(
      (c) => `<tr data-k="c${esc(c.id)}">
<td><a href="/panel/c/${encodeURIComponent(c.id)}"><b>${esc(c.nombre || (c.usuario ? `${arroba(c.usuario)}${c.usuario}` : c.id))}</b></a>${c.usuario && c.nombre ? `<div class="suave">${arroba(c.usuario)}${esc(c.usuario)}</div>` : ""}${c.anuncio ? `<div class="suave">📣 ${esc(String(c.anuncio).slice(0, 40))}</div>` : ""}</td>
<td>${chipDeEtapa(c.etapa)}${c.etapaPuesta ? "" : '<div class="suave">sugerida</div>'}</td>
<td>${c.etiquetas.map((e) => `<span class="etiqueta-crm">${esc(e)}</span>`).join("") || '<span class="suave">—</span>'}</td>
<td class="num">${c.mensajes}</td>
<td>${c.productos.length ? `${c.productos.length} · <span class="suave">${esc(c.productos.slice(0, 2).join(", "))}${c.productos.length > 2 ? "…" : ""}</span>` : '<span class="suave">—</span>'}</td>
<td class="num">${c.compras ? `🛒 ${c.compras}` : "—"}</td>
<td>${esc(fecha(c.primero))}</td>
<td>${esc(fecha(c.ultimo))}</td>
</tr>`
    )
    .join("");
  const exportar = `/panel/clientes.csv?${new URLSearchParams({ ...(etapa ? { etapa } : {}), ...(etiqueta ? { etiqueta } : {}), ...(q ? { q } : {}) })}`;
  return `<h2>👥 Clientes</h2>
<div class="kpis">
<div class="kpi"><div class="v">${clientes.length}</div><div class="e">clientes en total</div></div>
<div class="kpi"><div class="v">${clientes.filter((c) => c.primero > semana).length}</div><div class="e">nuevos esta semana</div></div>
<div class="kpi"><div class="v">${cuenta.quiere_comprar || 0}</div><div class="e">🛒 quieren comprar</div></div>
<div class="kpi"><div class="v bien">${vendidos}</div><div class="e">✅ vendidos</div></div>
<div class="kpi"><div class="v">${clientes.length ? Math.round((vendidos / clientes.length) * 100) : 0}%</div><div class="e">de los clientes compró</div></div>
</div>
<div class="embudo">${embudo}</div>
<form class="filtros-crm" method="get" action="/panel/clientes">${etapa ? `<input type="hidden" name="etapa" value="${esc(etapa)}">` : ""}
<input name="q" value="${esc(q)}" placeholder="Buscar por nombre, @usuario, nota, etiqueta o producto">
<select name="etiqueta"><option value="">Todas las etiquetas</option>${todasLasEtiquetas.map((e) => `<option${e === etiqueta ? " selected" : ""}>${esc(e)}</option>`).join("")}</select>
<button>Filtrar</button><a class="suave" href="${esc(exportar)}">⬇️ Exportar a Excel</a></form>
<p class="suave">${lista.length} ${lista.length === 1 ? "cliente" : "clientes"}${lista.length > 300 ? " · se ven los 300 más recientes (el Excel trae todos)" : ""}. La etapa "sugerida" la pone el bot con lo que ve; la que marques en la ficha de cada cliente manda.</p>
<div class="tabla"><table><thead><tr><th>Cliente</th><th>Etapa</th><th>Etiquetas</th><th class="num">Mensajes</th><th>Productos que vio</th><th class="num">Quiso comprar</th><th>Primer contacto</th><th>Último</th></tr></thead>
<tbody>${filasHtml || '<tr><td colspan="8" class="suave">No hay clientes con eso.</td></tr>'}</tbody></table></div>`;
}

// La ficha, dentro de la conversación: datos y lo que edita la tienda.
export function htmlFichaDeCliente(c, { accion = "/panel/crm", id = "" } = {}) {
  const cliente = c || { id, mensajes: 0, productos: [], compras: 0, intenciones: [], etiquetas: [], notas: "", etapa: "nuevo", sugerida: "nuevo", etapaPuesta: "" };
  const opciones = [
    `<option value=""${cliente.etapaPuesta ? "" : " selected"}>Automática (el bot sugiere: ${esc(NOMBRE_DE_ETAPA[cliente.sugerida] || "Nuevo")})</option>`,
    ...ETAPAS.map(([e, nombre]) => `<option value="${esc(e)}"${cliente.etapaPuesta === e ? " selected" : ""}>${esc(nombre)}</option>`),
  ].join("");
  return `<details class="tarjeta" id="crm" open><summary><b>🗂 Ficha del cliente</b> · ${chipDeEtapa(cliente.etapa)}</summary>
<div class="ficha-crm">
<div><b>PRIMER CONTACTO</b>${esc(fecha(cliente.primero) || "—")}</div>
<div><b>ÚLTIMO MENSAJE</b>${esc(fecha(cliente.ultimo) || "—")}</div>
<div><b>MENSAJES SUYOS</b>${cliente.mensajes}</div>
<div><b>QUISO COMPRAR</b>${cliente.compras ? `🛒 ${cliente.compras} ${cliente.compras === 1 ? "vez" : "veces"}` : "todavía no"}</div>
${cliente.anuncio ? `<div><b>LLEGÓ POR</b>📣 ${esc(cliente.anuncio)}</div>` : ""}
</div>
${cliente.productos.length ? `<div class="suave"><b>Productos que vio:</b> ${esc(cliente.productos.slice(-12).join(" · "))}</div>` : ""}
${cliente.intenciones.length ? `<div class="suave"><b>Cuándo quiso comprar:</b> ${cliente.intenciones.map((i) => `${esc(fecha(i.cuando))}${i.productos.length ? ` (${esc(i.productos.slice(0, 2).join(", "))})` : ""}`).join(" · ")}</div>` : ""}
<form method="post" action="${esc(accion)}"><input type="hidden" name="id" value="${esc(cliente.id || id)}">
<div class="acciones"><label class="suave">Etapa <select name="etapa">${opciones}</select></label>
<label class="suave" style="flex:1;display:flex;gap:6px;align-items:center">Etiquetas <input style="flex:1" name="etiquetas" value="${esc(cliente.etiquetas.join(", "))}" placeholder="VIP, mayorista, Margarita… (separadas por coma)"></label></div>
<label class="suave" style="display:block;margin-top:8px">Notas</label>
<textarea name="notas" rows="4" maxlength="2000" style="width:100%;box-sizing:border-box" placeholder="Notas de este cliente (solo las ve la tienda)">${esc(cliente.notas)}</textarea>
<div class="acciones"><button class="principal">Guardar ficha</button>${cliente.actualizado ? `<span class="suave">Guardada ${esc(fecha(cliente.actualizado))}</span>` : ""}</div></form></details>`;
}

export function filasCsvDeClientes(clientes) {
  return {
    encabezados: ["Nombre", "Usuario", "Id", "Etapa", "Etapa puesta a mano", "Etiquetas", "Notas", "Mensajes", "Productos que vio", "Veces que quiso comprar", "Llegó por anuncio", "Primer contacto", "Último mensaje"],
    filas: clientes.map((c) => [
      c.nombre,
      c.usuario ? `${arroba(c.usuario)}${c.usuario}` : "",
      c.id,
      NOMBRE_DE_ETAPA[c.etapa]?.replace(/^\S+\s/, "") || c.etapa,
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
