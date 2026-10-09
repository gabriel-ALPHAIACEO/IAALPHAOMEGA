/* ══════════════════════════════════════════════════════════════════
   EL INFORME DE ERRORES (6-oct-2026)

   Junta TODO lo que salió mal en todas las tiendas y lo deja listo para
   arreglarlo después:
   - ⚙️ errores técnicos (Meta, OpenAI, la base…) y 🛡️ correcciones de las
     redes de seguridad, AGRUPADOS por problema: el mismo error mil veces es
     un solo arreglo (se cuentan las veces, cuándo empezó y cuándo fue el
     último);
   - ❌ 🔴 ⚠️ 👎 las respuestas señaladas, una por una y con su contexto:
     lo que escribió el cliente, lo que respondió el bot, lo que pensó la IA
     y el motivo.

   Se baja en dos formatos:
   - Excel (CSV): una fila por cada vez, con el número de problema para
     filtrar y ordenar;
   - texto (.md): el informe ordenado de lo más repetido a lo menos, para
     guardarlo o mandárselo a quien lo vaya a arreglar.

   Cada tienda lo da por /api/central/informe-errores (ver panel.js). Una
   tienda con la versión de antes solo tiene /errores: se usa eso y se avisa.
   ══════════════════════════════════════════════════════════════════ */

import { aCsv } from "./alpha.js";

export const INFORME_DIAS = [7, 14, 30, 60];
const ZONA = "America/Caracas";

export function fechaYHora(ms) {
  if (!ms) return "";
  return new Date(Number(ms)).toLocaleString("es-VE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: ZONA });
}

// La "huella" de un error: el texto sin lo que cambia de una vez a otra
// (números, ids, horas, enlaces, comillas), para que el mismo problema
// caiga en el mismo grupo.
export function huella(texto) {
  return String(texto || "")
    .split("\n")[0]
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/"[^"]{0,200}"|'[^']{0,200}'|«[^»]{0,200}»/g, "«…»")
    .replace(/\b[0-9a-f]{8,}\b/gi, "#")
    .replace(/\d+([.,:]\d+)*/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

// Lo que mandaron las tiendas → los casos sueltos, con su tienda.
export function casosDelInforme(respuestas) {
  const casos = [];
  const tiendas = [];
  for (const r of respuestas) {
    const t = r.tienda || {};
    if (!r.ok) {
      tiendas.push({ id: t.id, nombre: t.nombre, ok: false, error: r.error || "no respondió" });
      continue;
    }
    const d = r.datos || {};
    const viejo = Array.isArray(d);
    const errores = viejo ? d : d.errores || [];
    const senaladas = viejo ? [] : d.senaladas || [];
    tiendas.push({ id: t.id, nombre: t.nombre, ok: true, viejo, version: viejo ? "" : d.version || "", errores: errores.length, senaladas: senaladas.length });
    for (const e of errores) {
      casos.push({
        tienda: t.id,
        tiendaNombre: t.nombre,
        clase: e.tipo === "correccion" ? "correccion" : "tecnico",
        simbolo: e.tipo === "correccion" ? "🛡️" : "⚙️",
        tipo: e.tipo === "correccion" ? "Corrección de una red de seguridad" : "Error técnico",
        cuando: Number(e.cuando) || 0,
        texto: String(e.texto || ""),
        huella: huella(e.texto),
      });
    }
    for (const s of senaladas) {
      casos.push({
        tienda: t.id,
        tiendaNombre: t.nombre,
        clase: "senalada",
        simbolo: s.simbolo || "🔴",
        tipo: s.tipo || s.marca || "Respuesta señalada",
        marca: s.marca || "",
        cuando: Number(s.cuando) || 0,
        igsid: s.igsid || "",
        texto: s.motivo || "",
        motivo: s.motivo || "",
        cliente: s.cliente || "",
        respuesta: s.respuesta || "",
        pienso: s.pienso || "",
        productos: s.productos || [],
        notas: s.notas || [],
        // Las respuestas señaladas se agrupan por tipo (el motivo lo escribe
        // el revisor con sus palabras: casi nunca se repite igual).
        huella: s.marca || "senalada",
      });
    }
  }
  casos.sort((a, b) => b.cuando - a.cuando);
  return { casos, tiendas };
}

// Los casos → problemas (el mismo error, en la misma tienda o en varias,
// es un solo problema). Numerados de lo más repetido a lo menos; las
// respuestas señaladas van después, por tipo y tienda.
export function problemasDelInforme(casos) {
  const grupos = new Map();
  for (const c of casos) {
    const clave = c.clase === "senalada" ? `s|${c.tienda}|${c.huella}` : `${c.clase}|${c.huella}`;
    if (!grupos.has(clave)) {
      grupos.set(clave, { clave, clase: c.clase, simbolo: c.simbolo, tipo: c.tipo, huella: c.huella, ejemplo: c.texto, veces: 0, primera: c.cuando, ultima: c.cuando, tiendas: new Set(), casos: [] });
    }
    const g = grupos.get(clave);
    g.veces++;
    g.primera = Math.min(g.primera, c.cuando);
    g.ultima = Math.max(g.ultima, c.cuando);
    g.tiendas.add(c.tiendaNombre || c.tienda);
    g.casos.push(c);
  }
  const orden = { tecnico: 0, senalada: 1, correccion: 2 };
  const lista = [...grupos.values()]
    .map((g) => ({ ...g, tiendas: [...g.tiendas] }))
    .sort((a, b) => orden[a.clase] - orden[b.clase] || b.veces - a.veces || b.ultima - a.ultima);
  lista.forEach((g, i) => {
    g.numero = i + 1;
    for (const c of g.casos) c.problema = g.numero;
  });
  return lista;
}

export function informeDeErrores(respuestas, { dias = 30, base = "" } = {}) {
  const { casos, tiendas } = casosDelInforme(respuestas);
  const problemas = problemasDelInforme(casos);
  const cuenta = (clase) => casos.filter((c) => c.clase === clase).length;
  return {
    dias,
    base,
    generado: Date.now(),
    tiendas,
    casos,
    problemas,
    totales: { tecnicos: cuenta("tecnico"), senaladas: cuenta("senalada"), correcciones: cuenta("correccion"), problemas: problemas.length },
  };
}

const enlaceDe = (base, c) => (c.igsid ? `${base}/t/${c.tienda}/c/${encodeURIComponent(c.igsid)}` : "");

/* ── Excel: una fila por cada vez ───────────────────────────────── */

export function csvDelInforme(informe) {
  const encabezados = ["Problema #", "Veces (del problema)", "Tienda", "Tipo", "Cuándo", "Error / motivo", "Lo que escribió el cliente", "Lo que respondió el bot", "Lo que pensó la IA", "Productos que mostró", "Notas", "Conversación", "Arreglado"];
  const veces = new Map(informe.problemas.map((p) => [p.numero, p.veces]));
  const filas = [...informe.casos]
    .sort((a, b) => a.problema - b.problema || b.cuando - a.cuando)
    .map((c) => [
      c.problema,
      veces.get(c.problema) || 1,
      c.tiendaNombre || c.tienda,
      `${c.simbolo} ${c.tipo}`,
      fechaYHora(c.cuando),
      c.texto,
      c.cliente || "",
      c.respuesta || "",
      c.pienso || "",
      (c.productos || []).join(" · "),
      (c.notas || []).join(" · "),
      enlaceDe(informe.base, c),
      "",
    ]);
  return aCsv(encabezados, filas);
}

/* ── Texto: el informe para arreglar ────────────────────────────── */

const MAX_CASOS_POR_PROBLEMA = 3;
const MAX_SENALADAS_POR_GRUPO = 25;

function bloque(texto) {
  return "```\n" + String(texto || "").replace(/```/g, "ˋˋˋ").trim() + "\n```";
}

export function textoDelInforme(informe) {
  const t = informe.totales;
  const l = [];
  l.push(`# Informe de errores — ALPHA IA`);
  l.push("");
  l.push(`Generado: ${fechaYHora(informe.generado)} · Período: últimos ${informe.dias} días`);
  l.push("");
  l.push(`- ⚙️ Errores técnicos: **${t.tecnicos}**`);
  l.push(`- ❌🔴⚠️👎 Respuestas señaladas: **${t.senaladas}**`);
  l.push(`- 🛡️ Correcciones de las redes de seguridad: **${t.correcciones}** (no son averías: la IA iba a decir algo mal y se corrigió)`);
  l.push(`- Problemas distintos: **${t.problemas}**`);
  l.push("");
  l.push(`## Tiendas`);
  l.push("");
  for (const s of informe.tiendas) {
    if (!s.ok) l.push(`- 🚨 **${s.nombre}**: no se pudo leer (${s.error})`);
    else if (s.viejo) l.push(`- **${s.nombre}**: ${s.errores} errores · ⚠️ tiene la versión de antes: solo dio los errores técnicos de los últimos 30 días, sin las respuestas señaladas`);
    else l.push(`- **${s.nombre}** (versión ${s.version || "?"}): ${s.errores} en el registro de errores · ${s.senaladas} ${s.senaladas === 1 ? "respuesta señalada" : "respuestas señaladas"}`);
  }
  l.push("");
  l.push(`> Los errores técnicos se guardan 30 días en cada tienda y las respuestas señaladas 60. Lo que quieras conservar más tiempo, guárdalo con este archivo.`);

  const tecnicos = informe.problemas.filter((p) => p.clase === "tecnico");
  const senaladas = informe.problemas.filter((p) => p.clase === "senalada");
  const correcciones = informe.problemas.filter((p) => p.clase === "correccion");

  const problemaTecnico = (p) => {
    l.push("");
    l.push(`### #${p.numero} · ${p.simbolo} ${p.veces} ${p.veces === 1 ? "vez" : "veces"} · ${p.tiendas.join(", ")}`);
    l.push("");
    l.push(`Primera: ${fechaYHora(p.primera)} · Última: ${fechaYHora(p.ultima)}`);
    l.push("");
    const distintos = [...new Map(p.casos.map((c) => [c.texto, c])).values()].slice(0, MAX_CASOS_POR_PROBLEMA);
    for (const c of distintos) l.push(bloque(c.texto));
    if (p.casos.length > distintos.length) l.push(`_(${p.casos.length - distintos.length} veces más con el mismo error)_`);
  };

  l.push("");
  l.push(`## ⚙️ Errores técnicos (de lo más repetido a lo menos)`);
  if (!tecnicos.length) l.push("", "Ninguno ✅");
  tecnicos.forEach(problemaTecnico);

  l.push("");
  l.push(`## Respuestas señaladas (con su conversación)`);
  if (!senaladas.length) l.push("", "Ninguna ✅");
  for (const p of senaladas) {
    l.push("");
    l.push(`### #${p.numero} · ${p.simbolo} ${p.tipo} · ${p.tiendas.join(", ")} · ${p.veces} ${p.veces === 1 ? "vez" : "veces"}`);
    for (const c of p.casos.slice(0, MAX_SENALADAS_POR_GRUPO)) {
      l.push("");
      l.push(`**${fechaYHora(c.cuando)}**${c.igsid ? ` · cliente ${c.igsid}` : ""}${enlaceDe(informe.base, c) ? ` · ${enlaceDe(informe.base, c)}` : ""}`);
      if (c.motivo) l.push(`- Motivo: ${c.motivo}`);
      if (c.cliente) l.push(`- El cliente escribió: ${c.cliente.replace(/\s+/g, " ")}`);
      if (c.respuesta) l.push(`- El bot respondió: ${c.respuesta.replace(/\s+/g, " ")}`);
      if (c.pienso) l.push(`- La IA pensó: ${c.pienso.replace(/\s+/g, " ")}`);
      if (c.productos?.length) l.push(`- Productos que mostró: ${c.productos.join(" · ")}`);
      if (c.notas?.length) l.push(`- Notas: ${c.notas.join(" · ")}`);
    }
    if (p.casos.length > MAX_SENALADAS_POR_GRUPO) l.push("", `_(y ${p.casos.length - MAX_SENALADAS_POR_GRUPO} más: están todas en el Excel)_`);
  }

  l.push("");
  l.push(`## 🛡️ Correcciones de las redes de seguridad`);
  l.push("");
  l.push(`No son averías, pero si una se repite mucho, la IA está pidiendo un ajuste en su prompt.`);
  if (!correcciones.length) l.push("", "Ninguna.");
  for (const p of correcciones) {
    l.push("");
    l.push(`- #${p.numero} · ${p.veces} ${p.veces === 1 ? "vez" : "veces"} · ${p.tiendas.join(", ")} · última ${fechaYHora(p.ultima)}: ${p.ejemplo.split("\n")[0].slice(0, 300)}`);
  }
  l.push("");
  return l.join("\n");
}

export function respuestaTexto(nombre, contenido) {
  return new Response(contenido, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${String(nombre).replace(/[^\w.-]/g, "_")}"`,
      "cache-control": "no-store",
    },
  });
}

/* ── La página ──────────────────────────────────────────────────── */

const escHtml = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function vistaInforme(informe, { kpi = (v, e) => `<div class="kpi"><div class="v">${escHtml(v)}</div><div class="e">${escHtml(e)}</div></div>` } = {}) {
  const t = informe.totales;
  const n = informe.dias;
  const periodo = INFORME_DIAS.map((d) => `<a class="${d === n ? "activa" : ""}" href="?dias=${d}">${d} días</a>`).join("");
  const tiendas = informe.tiendas
    .map((s) =>
      !s.ok
        ? `<div class="tarjeta mal">🚨 ${escHtml(s.nombre)}: ${escHtml(s.error)}</div>`
        : s.viejo
          ? `<div class="tarjeta aviso">⚠️ ${escHtml(s.nombre)} tiene la versión de antes: solo da los errores técnicos (30 días), sin las respuestas señaladas. Despliega su versión nueva.</div>`
          : ""
    )
    .join("");
  const filas = informe.problemas
    .map(
      (p) => `<tr data-k="p${p.numero}"><td class="num">#${p.numero}</td><td>${p.simbolo} ${escHtml(p.tipo)}</td><td class="num"><b>${p.veces}</b></td><td>${escHtml(p.tiendas.join(", "))}</td><td>${escHtml(fechaYHora(p.ultima))}</td><td><details><summary>${escHtml(String(p.clase === "senalada" ? p.casos[0]?.motivo || p.huella : p.ejemplo).split("\n")[0].slice(0, 140))}</summary><pre>${escHtml(
        p.clase === "senalada"
          ? p.casos
              .slice(0, 5)
              .map((c) => `${fechaYHora(c.cuando)} · ${c.motivo}\nCliente: ${c.cliente}\nBot: ${c.respuesta}`)
              .join("\n\n")
          : p.ejemplo
      )}</pre></details></td></tr>`
    )
    .join("");
  return `<h2>🧾 Informe de errores</h2>
<p class="suave">Todo lo que salió mal en todas las tiendas, agrupado por problema (el mismo error repetido es un solo arreglo). Bájalo para guardarlo y arreglarlo después: los errores técnicos se borran solos de cada tienda a los 30 días y las respuestas señaladas a los 60.</p>
<div class="pestanas">${periodo}</div>${tiendas}
<div class="kpis">${kpi(t.problemas, "problemas distintos")}${kpi(t.tecnicos, "⚙️ errores técnicos")}${kpi(t.senaladas, "❌🔴⚠️👎 respuestas señaladas")}${kpi(t.correcciones, "🛡️ correcciones")}</div>
<p class="acciones"><a class="boton" href="/errores/informe.csv?dias=${n}">⬇️ Excel (una fila por cada vez)</a> <a class="boton" href="/errores/informe.md?dias=${n}">⬇️ Informe en texto (para arreglar)</a> <a href="/errores?dias=${Math.min(n, 30)}">ver la lista de errores</a></p>
${
    informe.problemas.length
      ? `<div class="tabla"><table><tr><th class="num">#</th><th>Tipo</th><th class="num">Veces</th><th>Tienda</th><th>Última vez</th><th>El problema</th></tr>${filas}</table></div>`
      : '<div class="tarjeta suave">Sin errores en este período ✅</div>'
  }`;
}
