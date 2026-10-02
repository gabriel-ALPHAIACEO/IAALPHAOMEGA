// EL PANEL CENTRAL: TODAS LAS TIENDAS EN UN SOLO SITIO (2-oct-2026).
//
// Este Worker NO atiende clientes. Cada tienda sigue siendo su propio
// Worker con su propia base (decisión del 29-sep-2026: un Worker por
// tienda). Este solo MIRA: le pide los datos a cada tienda por su puerta
// /api/central, con una clave que solo conocen los dos, y lo junta todo.
//
// Lo que hay:
//   /                    todas las tiendas de un vistazo y las últimas alertas
//   /en-vivo             los mensajes de todas las tiendas, entrando solos
//   /en-pausa            las personas con el bot en pausa, para devolvérselas
//   /alertas             las alertas (❌ 🔴 ⚠️ 👎 🚨), en tiempo real
//   /metricas            los números día por día, de todas juntas
//   /ganadores           los productos que más venden, de todas
//   /errores             los errores de todas
//   /gastos              lo que gasta cada una en OpenAI
//   /salud               si cada tienda responde (se mira cada 2 minutos)
//   /como-funciona       el diagrama de los pasos que sigue el bot
//   /t/<tienda>/...      una tienda: chats con lo que pensó la IA,
//                        métricas, ganadores, errores, sus bases de datos
//                        (ver y editar) y su estado
//
//   POST /api/alerta     por aquí avisan las tiendas en el momento
//   /vivo                lo que pregunta el panel abierto cada 8 segundos
//   /estado              la versión (para comprobar que se desplegó)
//
// Secretos (npx.cmd wrangler secret put NOMBRE):
//   PANEL_CLAVE          la clave para entrar (12 letras o más)
//   CLAVE_<TIENDA>       una por tienda: la misma que esa tienda tiene en
//                        su PANEL_API_CLAVE (p. ej. CLAVE_EPICELL)

import { leerTiendas, claveDe, pedir, pedirATodas, tiendaDeLaClave, mismoTexto } from "./tiendas.js";
import { TIPOS, guardarAlerta, listarAlertas, sinLeer, marcarLeidas, anotarSalud, leerSalud } from "./alertas.js";
import { claveLista, cookieNueva, COOKIE_FUERA, sesionValida, vieneDelPanel, demasiadosIntentos, anotarIntento, olvidarIntentos } from "./sesion.js";
import {
  esc,
  pagina,
  entrada,
  pestanasDeTienda,
  vistaInicio,
  listaDeAlertas,
  vistaResumenTienda,
  vistaMetricas,
  vistaGanadores,
  vistaErrores,
  vistaGastos,
  vistaSalud,
  vistaChats,
  vistaConversacion,
  vistaTablas,
  vistaTabla,
  vistaFila,
  vistaSql,
  vistaCambios,
  vistaComoFunciona,
  vistaEnVivo,
  vistaEnPausa,
} from "./vistas.js";

const VERSION = "2026-10-02 (5) · ALPHA IA: conecta con las tiendas de la misma cuenta de Cloudflare";

function nombreDelPanel(env) {
  return String(env.PANEL_NOMBRE || "ALPHA IA");
}

function json(datos, estado = 200) {
  return new Response(JSON.stringify(datos), { status: estado, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function redirigir(a, cookie = "") {
  const headers = { location: a, "cache-control": "no-store" };
  if (cookie) headers["set-cookie"] = cookie;
  return new Response(null, { status: 303, headers });
}

function dias(url, porDefecto) {
  return Math.min(Math.max(Number(url.searchParams.get("dias")) || porDefecto, 1), 90);
}

// El resumen de una tienda, comprobado: si le falta lo básico, se trata
// como una tienda que no responde (nunca tumba la página).
function resumenValido(r) {
  if (r.ok && (!r.datos?.hoy || !r.datos?.semana)) {
    return { ...r, ok: false, error: "la tienda respondió con un resumen incompleto: despliega su versión nueva" };
  }
  return r;
}

async function resumenes(env) {
  return (await pedirATodas(env, "resumen")).map(resumenValido);
}

function nombres(env) {
  return Object.fromEntries(leerTiendas(env).map((t) => [t.id, t.nombre]));
}

/* ── Las alertas que llegan de las tiendas ───────────────────────── */

async function recibirAlerta(request, env) {
  const clave = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  // La tienda se reconoce por SU clave, no por lo que diga el mensaje.
  const tienda = clave ? tiendaDeLaClave(env, clave) : null;
  if (!tienda) {
    console.error("ALERTA: llegó una alerta con una clave que no es de ninguna tienda");
    return json({ error: "Clave equivocada" }, 401);
  }
  const cuerpo = await request.json().catch(() => null);
  const alertas = Array.isArray(cuerpo?.alertas) ? cuerpo.alertas.slice(0, 20) : [];
  for (const a of alertas) {
    await guardarAlerta(env.DB, { tienda: tienda.id, tipo: String(a?.tipo || "error"), texto: String(a?.texto || ""), igsid: String(a?.igsid || "") });
  }
  console.log(`ALERTA: ${alertas.length} de ${tienda.nombre}`);
  return json({ ok: true, recibidas: alertas.length });
}

async function vivo(env, url) {
  const desde = Number(url.searchParams.get("desde")) || 0;
  // La primera vez de la página (primera=1) solo se dice por dónde va: no
  // se avisa de lo viejo. Después, todo lo que haya desde "desde", aunque
  // sea 0 (si no, la primera alerta de la vida del panel nunca sonaría).
  const primera = url.searchParams.get("primera") === "1";
  const lista = primera ? await listarAlertas(env.DB, { limite: 1 }) : await listarAlertas(env.DB, { desdeId: desde, limite: 20 });
  const n = nombres(env);
  const ultimo = Math.max(desde, ...lista.map((a) => Number(a.id) || 0));
  return json({
    sinLeer: await sinLeer(env.DB),
    ultimo,
    nuevas: !primera
      ? lista
          .filter((a) => TIPOS[a.tipo]?.avisar)
          .map((a) => ({
            simbolo: TIPOS[a.tipo].simbolo,
            nombre: TIPOS[a.tipo].nombre,
            tienda: n[a.tienda] || a.tienda,
            texto: String(a.texto).slice(0, 240),
            enlace: a.igsid ? `/t/${encodeURIComponent(a.tienda)}/c/${encodeURIComponent(a.igsid)}` : `/t/${encodeURIComponent(a.tienda)}`,
          }))
      : [],
  });
}

/* ── El chequeo de cada 2 minutos (el cron de wrangler.toml) ──────── */

async function comprobarTiendas(env) {
  const tiendas = leerTiendas(env);
  for (const t of tiendas) {
    let r = await pedir(env, t, "ping", { espera: 10000 });
    // Un tropiezo de red no es una caída: se prueba otra vez antes de avisar.
    if (!r.ok) {
      await new Promise((listo) => setTimeout(listo, 3000));
      r = await pedir(env, t, "ping", { espera: 10000 });
    }
    const salud = await anotarSalud(env.DB, t.id, r.ok, r.ok ? r.datos?.version || "" : r.error);
    if (!salud?.cambio) continue;
    if (!r.ok && salud.antes !== false) {
      console.error(`SALUD: ${t.nombre} no responde: ${r.error}`);
      await guardarAlerta(env.DB, { tienda: t.id, tipo: "caida", texto: `${t.nombre} no responde: ${r.error}` });
    } else if (r.ok && salud.antes === false) {
      console.log(`SALUD: ${t.nombre} volvió`);
      await guardarAlerta(env.DB, { tienda: t.id, tipo: "volvio", texto: `${t.nombre} vuelve a responder (${r.datos?.version || "sin versión"})` });
    }
  }
}

/* ── En vivo ─────────────────────────────────────────────────────── */

// El navegador manda por dónde va en cada tienda ({"epicell":[mensaje, turno]})
// y recibe solo lo nuevo, ya ordenado. Una tienda que no responde no frena a
// las demás: se queda con su cursor y se vuelve a probar en la siguiente.
async function enVivo(env, url) {
  let cursor = {};
  try {
    cursor = JSON.parse(url.searchParams.get("c") || "{}") || {};
  } catch {}
  const filtro = url.searchParams.get("tienda") || "";
  const tiendas = leerTiendas(env).filter((t) => !filtro || t.id === filtro);
  const respuestas = await Promise.all(
    tiendas.map((t) => {
      const [m, tu] = Array.isArray(cursor[t.id]) ? cursor[t.id] : [0, 0];
      return pedir(env, t, `vivo?desde=${Number(m) || 0}&turno=${Number(tu) || 0}`, { espera: 6000 });
    })
  );
  const eventos = [];
  const marcas = [];
  const nuevo = {};
  const caidas = [];
  tiendas.forEach((t, i) => {
    const r = respuestas[i];
    if (!r.ok) {
      caidas.push(t.nombre);
      if (cursor[t.id]) nuevo[t.id] = cursor[t.id];
      return;
    }
    const d = r.datos;
    const quien = (igsid) => {
      const n = d.nombres?.[igsid];
      return n?.nombre || (n?.usuario ? `@${n.usuario}` : `cliente ${String(igsid).slice(-4)}`);
    };
    const enlace = (igsid) => `/t/${encodeURIComponent(t.id)}/c/${encodeURIComponent(igsid)}`;
    for (const m of d.mensajes || []) {
      eventos.push({
        tipo: "mensaje",
        clave: `${t.id}:m${m.id}`,
        de: ["cliente", "bot", "asesor"].includes(m.de) ? m.de : "cliente",
        texto: String(m.texto || "").slice(0, 1500),
        cuando: Number(m.cuando) || 0,
        nombre: quien(m.igsid),
        tiendaNombre: t.nombre,
        enlace: enlace(m.igsid),
      });
    }
    for (const x of d.turnos || []) {
      if (!x.pienso && !x.marca && !(x.productos || []).length && !(x.notas || []).length) continue;
      eventos.push({
        tipo: "turno",
        clave: `${t.id}:${x.id}`,
        pienso: String(x.pienso || "").slice(0, 1500),
        productos: (x.productos || []).slice(0, 12).map(String),
        notas: (x.notas || []).slice(0, 8).map(String),
        marca: x.marca || "",
        motivo: String(x.motivo || "").slice(0, 300),
        cuando: Number(x.cuando) || 0,
        nombre: quien(x.igsid),
        tiendaNombre: t.nombre,
        enlace: enlace(x.igsid),
      });
    }
    for (const m of d.marcas || []) marcas.push({ clave: `${t.id}:${m.id}`, marca: m.marca, motivo: String(m.motivo || "").slice(0, 300) });
    nuevo[t.id] = [Number(d.ultimo) || 0, Number(d.ultimoTurno) || 0];
  });
  // Del más viejo al más nuevo (la página los va poniendo arriba); a la
  // misma hora, primero el mensaje y luego lo que pensó.
  eventos.sort((a, b) => a.cuando - b.cuando || (a.tipo === b.tipo ? 0 : a.tipo === "mensaje" ? -1 : 1));
  return json({ eventos: eventos.slice(-200), marcas, cursor: nuevo, caidas });
}

/* ── Juntar los números de todas ─────────────────────────────────── */

const CAMPOS = ["clientes", "mensajes", "respuestas", "fichas", "voz", "avisos", "ventas", "errores", "correcciones", "anuncios", "indebidas", "corregidas", "quejas", "fallos"];

function sumar(a, b) {
  const s = { ...a };
  for (const c of CAMPOS) s[c] = (Number(a?.[c]) || 0) + (Number(b?.[c]) || 0);
  return s;
}

function juntarMetricas(respuestas) {
  const porDia = new Map();
  let totales = {};
  let gasto = 0;
  for (const r of respuestas.filter((x) => x.ok)) {
    for (const d of r.datos.dias || []) porDia.set(d.dia, sumar(porDia.get(d.dia) || { dia: d.dia }, d));
    totales = sumar(totales, r.datos.totales);
    gasto += Number(r.datos.gasto?.total) || 0;
  }
  const lista = [...porDia.values()].sort((a, b) => a.dia.localeCompare(b.dia));
  return {
    dias: lista,
    totales,
    tasas: {
      conFichas: totales.respuestas ? totales.fichas / totales.respuestas : 0,
      ventasPorCliente: totales.clientes ? totales.ventas / totales.clientes : 0,
    },
    gasto: { total: gasto },
  };
}

function comparacion(respuestas) {
  const filas = respuestas
    .map((r) =>
      r.ok
        ? `<tr><td><a href="/t/${esc(r.tienda.id)}/metricas">${esc(r.tienda.nombre)}</a></td>${["clientes", "mensajes", "respuestas", "ventas", "avisos", "fallos", "indebidas", "corregidas", "quejas", "errores"]
            .map((c) => `<td class="num">${Number(r.datos.totales?.[c]) || 0}</td>`)
            .join("")}</tr>`
        : `<tr><td>${esc(r.tienda.nombre)}</td><td colspan="10" class="mal">🚨 ${esc(r.error)}</td></tr>`
    )
    .join("");
  return `<h3>Tienda por tienda</h3><div class="tabla"><table><tr><th>Tienda</th><th class="num">Clientes</th><th class="num">Mensajes</th><th class="num">Respuestas</th><th class="num">Ventas</th><th class="num">Asesor</th><th class="num">❌</th><th class="num">🔴</th><th class="num">⚠️</th><th class="num">👎</th><th class="num">⚙️</th></tr>${filas}</table></div>`;
}

/* ── Una tienda ──────────────────────────────────────────────────── */

// A dónde volver después de un botón de la lista: solo a una página de
// este mismo panel (nunca a otra web).
function volverA(formulario, porDefecto) {
  const v = String(formulario?.get("volver") || "");
  return /^\/(t\/|en-pausa)/.test(v) && !v.startsWith("//") && !v.includes("\\") ? v : porDefecto;
}

async function atenderTienda(request, env, url, t, resto, opciones) {
  const p = (titulo, cuerpo, extra = {}) => pagina(`${titulo} · ${t.nombre}`, cuerpo, { ...opciones, ...extra });
  const errorDe = (r) => `<div class="tarjeta mal">❌ ${esc(r.error || "la tienda mandó algo inesperado: despliega su versión nueva y mira su /estado")}</div>`;
  const esPost = request.method === "POST";
  if (esPost && !vieneDelPanel(request)) return new Response("No", { status: 403 });
  const formulario = esPost ? await request.formData().catch(() => null) : null;

  if (resto === "") {
    return p("Resumen", vistaResumenTienda(t, resumenValido(await pedir(env, t, "resumen"))), { vivo: true });
  }

  if (resto === "chats") {
    const q = url.searchParams.get("q") || "";
    const f = url.searchParams.get("f") || "";
    const r = await pedir(env, t, `chats?q=${encodeURIComponent(q)}&f=${encodeURIComponent(f)}`);
    return p("Chats", r.ok && Array.isArray(r.datos) ? vistaChats(t, r.datos, { q, f }) : pestanasDeTienda(t, "chats") + errorDe(r), { vivo: !q });
  }

  if (resto === "en-vivo") return p("En vivo", vistaEnVivo([], { tienda: t }));

  if (resto.startsWith("c/")) {
    const id = decodeURIComponent(resto.slice(2));
    const r = await pedir(env, t, `chat?id=${encodeURIComponent(id)}`);
    // Abierta, la conversación se pone al día sola cada 6 segundos.
    return p("Conversación", r.ok && r.datos?.contacto ? vistaConversacion(t, r.datos) : errorDe(r), { vivo: 6000 });
  }

  if ((resto === "pausar" || resto === "devolver") && esPost) {
    const id = String(formulario?.get("id") || "").trim();
    if (id) {
      const r = await pedir(env, t, resto, { metodo: "POST", cuerpo: { id } });
      if (!r.ok) return p("No se pudo", errorDe(r));
      console.log(`PANEL CENTRAL: ${resto} ${id} en ${t.nombre}`);
    }
    return redirigir(volverA(formulario, `/t/${encodeURIComponent(t.id)}/c/${encodeURIComponent(id)}`));
  }

  if (resto === "devolver-todos" && esPost) {
    const r = await pedir(env, t, "devolver-todos", { metodo: "POST" });
    if (!r.ok) return p("No se pudo", errorDe(r));
    console.log(`PANEL CENTRAL: devueltas al bot ${r.datos?.cuantos} conversaciones de ${t.nombre}`);
    return redirigir(volverA(formulario, `/t/${encodeURIComponent(t.id)}/chats?f=pausados`));
  }

  if (resto === "metricas") {
    const n = dias(url, 14);
    const r = await pedir(env, t, `metricas?dias=${n}`, { espera: 15000 });
    if (!r.ok || !Array.isArray(r.datos?.dias)) return p("Métricas", pestanasDeTienda(t, "metricas") + errorDe(r.ok ? { error: "la tienda no mandó sus métricas: despliega su versión nueva" } : r));
    return p("Métricas", vistaMetricas(`Últimos ${n} días`, r.datos.dias, r.datos, { conAnuncios: r.datos.dias.some((d) => d.anuncios > 0), cabecera: pestanasDeTienda(t, "metricas") }));
  }

  if (resto === "ganadores") {
    const n = dias(url, 30);
    const r = await pedir(env, t, `ganadores?dias=${n}`, { espera: 15000 });
    const cabecera = `${pestanasDeTienda(t, "ganadores")}<div class="suave">Ver: ${[7, 30, 90].map((x) => `<a href="?dias=${x}">${x} días</a>`).join(" · ")}</div>`;
    return p("Ganadores", r.ok && Array.isArray(r.datos) ? vistaGanadores(r.datos, { cabecera }) : cabecera + errorDe(r));
  }

  if (resto === "errores") {
    const n = Math.min(dias(url, 7), 30);
    const r = await pedir(env, t, `errores?dias=${n}`);
    const cabecera = pestanasDeTienda(t, "errores");
    return p("Errores", r.ok && Array.isArray(r.datos) ? vistaErrores(r.datos, cabecera, { soloErrores: url.searchParams.get("solo") === "1" }) : cabecera + errorDe(r));
  }

  if (resto === "alertas") {
    return p("Alertas", pestanasDeTienda(t, "alertas") + listaDeAlertas(await listarAlertas(env.DB, { tienda: t.id, limite: 100 }), nombres(env)));
  }

  if (resto === "estado") {
    const r = await pedir(env, t, "estado", { espera: 15000 });
    return p("Estado", pestanasDeTienda(t, "estado") + (r.ok ? `<div class="tarjeta"><pre>${esc(r.datos.texto || "(sin texto)")}</pre></div>` : errorDe(r)));
  }

  /* Las bases de datos */

  if (resto === "bases") {
    const r = await pedir(env, t, "tablas", { espera: 15000 });
    return p("Bases de datos", r.ok && Array.isArray(r.datos) ? vistaTablas(t, r.datos) : pestanasDeTienda(t, "bases") + errorDe(r));
  }

  if (resto === "sql") {
    if (!esPost) return p("Consola SQL", vistaSql(t));
    const sql = String(formulario?.get("sql") || "").trim();
    const r = await pedir(env, t, "sql", { metodo: "POST", cuerpo: { sql }, espera: 20000 });
    if (r.ok && r.datos?.ok) console.log(`PANEL CENTRAL: SQL en ${t.nombre}: ${sql.slice(0, 120)}`);
    return p("Consola SQL", vistaSql(t, sql, r.ok ? r.datos : { error: r.error }));
  }

  if (resto === "cambios") {
    const r = await pedir(env, t, "cambios");
    return p("Historial", r.ok && Array.isArray(r.datos) ? vistaCambios(t, r.datos) : pestanasDeTienda(t, "bases") + errorDe(r));
  }

  if (resto === "deshacer" && esPost) {
    const r = await pedir(env, t, "deshacer", { metodo: "POST", cuerpo: { id: Number(formulario?.get("id")) } });
    if (!r.ok) return p("No se pudo deshacer", pestanasDeTienda(t, "bases") + errorDe(r));
    return redirigir(`/t/${encodeURIComponent(t.id)}/cambios`);
  }

  const enBases = resto.match(/^bases\/([^/]+)(?:\/(\d+)(\/borrar)?)?$/);
  if (enBases) {
    const tabla = decodeURIComponent(enBases[1]);
    const rowid = enBases[2] ? Number(enBases[2]) : null;
    const base = `/t/${encodeURIComponent(t.id)}/bases/${encodeURIComponent(tabla)}`;

    if (rowid == null) {
      const q = url.searchParams.get("q") || "";
      const pag = Math.max(Number(url.searchParams.get("pagina")) || 1, 1);
      const r = await pedir(env, t, `tabla?nombre=${encodeURIComponent(tabla)}&pagina=${pag}&q=${encodeURIComponent(q)}`, { espera: 15000 });
      return p(tabla, r.ok ? vistaTabla(t, r.datos, q) : pestanasDeTienda(t, "bases") + errorDe(r));
    }

    if (enBases[3] && esPost) {
      const r = await pedir(env, t, "borrar", { metodo: "POST", cuerpo: { tabla, rowid } });
      if (!r.ok) return p("No se pudo borrar", pestanasDeTienda(t, "bases") + errorDe(r));
      console.log(`PANEL CENTRAL: borrada la fila ${rowid} de ${tabla} en ${t.nombre}`);
      return redirigir(base);
    }

    const actual = await pedir(env, t, `fila?tabla=${encodeURIComponent(tabla)}&rowid=${rowid}`);
    if (!actual.ok) return p(tabla, pestanasDeTienda(t, "bases") + errorDe(actual));
    if (!esPost) return p(tabla, vistaFila(t, actual.datos));

    // Solo se manda lo que de verdad cambió. Los saltos de línea del
    // navegador (\r\n) se dejan como estaban (\n), si no cada guardado
    // "cambiaría" todos los textos largos.
    const cambios = {};
    for (const c of actual.datos.columnas) {
      const valor = formulario?.get(`c:${c.nombre}`);
      if (valor == null) continue;
      const nuevo = String(valor).replace(/\r\n/g, "\n");
      const antes = actual.datos.fila[c.nombre];
      if (nuevo !== String(antes ?? "")) cambios[c.nombre] = nuevo;
    }
    if (!Object.keys(cambios).length) return p(tabla, vistaFila(t, actual.datos, "No había nada distinto: no se cambió nada."));
    const r = await pedir(env, t, "fila", { metodo: "POST", cuerpo: { tabla, rowid, cambios } });
    if (!r.ok) return p(tabla, pestanasDeTienda(t, "bases") + errorDe(r) + `<p><a href="${base}/${rowid}">Volver a la fila</a></p>`);
    console.log(`PANEL CENTRAL: editada la fila ${rowid} de ${tabla} en ${t.nombre} (${Object.keys(cambios).join(", ")})`);
    return p(tabla, vistaFila(t, { ...actual.datos, fila: r.datos.fila }, `Guardado: ${Object.keys(cambios).join(", ")}. Se puede deshacer desde el historial.`));
  }

  return p("No existe", `${pestanasDeTienda(t, "")}<div class="tarjeta">Esa página no existe.</div>`);
}

/* ── La puerta ───────────────────────────────────────────────────── */

async function atender(request, env) {
  const url = new URL(request.url);
  const nombre = nombreDelPanel(env);

  if (url.pathname === "/estado") {
    const tiendas = leerTiendas(env);
    const faltan = tiendas.filter((t) => !claveDe(env, t.id)).map((t) => `CLAVE_${t.id.toUpperCase().replace(/-/g, "_")}`);
    return new Response(
      [
        `Panel central · versión ${VERSION}`,
        `PANEL_CLAVE: ${claveLista(env) ? "puesta" : "FALTA (12 letras o más)"}`,
        `Base D1: ${env.DB ? "conectada" : "FALTA (wrangler.toml, [[d1_databases]])"}`,
        `Tiendas: ${tiendas.length}${faltan.length ? ` · faltan claves: ${faltan.join(", ")}` : ""}`,
      ].join("\n"),
      { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } }
    );
  }

  if (url.pathname === "/api/alerta" && request.method === "POST") return recibirAlerta(request, env);

  if (!claveLista(env)) {
    return pagina(
      "Falta la clave",
      `<div class="tarjeta"><p>El panel está cerrado: falta su clave.</p><p>En la carpeta <code>panel-central</code>, una vez:</p>
<pre>npx.cmd wrangler secret put PANEL_CLAVE</pre><p class="suave">Escribe una clave de 12 letras o más (este panel puede editar las bases de todas las tiendas). Después abre esta página otra vez.</p></div>`,
      { conMenu: false, nombre }
    );
  }

  if (url.pathname === "/entrar" && request.method === "POST") {
    if (!vieneDelPanel(request)) return new Response("No", { status: 403 });
    if (await demasiadosIntentos(env.DB, request)) return entrada(nombre, "Demasiadas claves equivocadas. Espera 15 minutos.");
    const datos = await request.formData().catch(() => null);
    const clave = String(datos?.get("clave") || "");
    if (!mismoTexto(clave, env.PANEL_CLAVE)) {
      await anotarIntento(env.DB, request);
      console.error("PANEL CENTRAL: alguien probó una clave equivocada");
      return entrada(nombre, "Esa no es la clave.");
    }
    await olvidarIntentos(env.DB, request);
    return redirigir("/", await cookieNueva(env));
  }

  if (!(await sesionValida(request, env))) {
    if (url.pathname === "/vivo") return json({ error: "Sin sesión" }, 401);
    return entrada(nombre);
  }

  if (url.pathname === "/salir") return redirigir("/", COOKIE_FUERA);
  if (url.pathname === "/vivo") return vivo(env, url);

  const opciones = { nombre, sinLeer: await sinLeer(env.DB) };
  const tiendas = leerTiendas(env);

  if (url.pathname === "/") {
    const respuestas = await resumenes(env);
    return pagina("Inicio", vistaInicio(respuestas, await listarAlertas(env.DB, { limite: 8 }), nombres(env)), { ...opciones, vivo: true });
  }

  if (url.pathname === "/en-vivo") return pagina("En vivo", vistaEnVivo(tiendas), opciones);
  if (url.pathname === "/en-pausa") return pagina("En pausa", vistaEnPausa((await pedirATodas(env, "chats?f=pausados")).map((r) => (r.ok && !Array.isArray(r.datos) ? { ...r, ok: false, error: "respuesta rara de la tienda: despliega su versión nueva" } : r))), { ...opciones, vivo: true });
  if (url.pathname === "/en-vivo/datos") return enVivo(env, url);

  if (url.pathname === "/alertas") {
    if (request.method === "POST") {
      if (!vieneDelPanel(request)) return new Response("No", { status: 403 });
      await marcarLeidas(env.DB);
      return redirigir("/alertas");
    }
    const tipo = TIPOS[url.searchParams.get("tipo")] ? url.searchParams.get("tipo") : "";
    const lista = await listarAlertas(env.DB, { tipo, limite: 200 });
    // Lo que se ve, se da por leído (la lista de esta vez aún lo enseña
    // con la raya roja, para distinguir lo nuevo).
    await marcarLeidas(env.DB);
    const filtros = [["", "Todas"], ...Object.entries(TIPOS).map(([k, v]) => [k, `${v.simbolo} ${v.nombre}`])]
      .map(([k, v]) => `<a class="${tipo === k ? "activa" : ""}" href="/alertas${k ? `?tipo=${k}` : ""}">${esc(v)}</a>`)
      .join("");
    return pagina(
      "Alertas",
      `<h2>🔔 Alertas</h2><p class="suave">Llegan solas, en el momento: con el panel abierto suena un pitido, sale un aviso y (si lo activas) una notificación del navegador.</p>
<div class="pestanas">${filtros}</div>${listaDeAlertas(lista, nombres(env))}`,
      { ...opciones, sinLeer: 0, vivo: true }
    );
  }

  if (url.pathname === "/metricas") {
    const n = dias(url, 14);
    const respuestas = await pedirATodas(env, `metricas?dias=${n}`, { espera: 15000 });
    const datos = juntarMetricas(respuestas);
    return pagina(
      "Métricas",
      vistaMetricas(`Todas las tiendas · últimos ${n} días`, datos.dias, datos, {
        conAnuncios: datos.dias.some((d) => d.anuncios > 0),
        cabecera: "<h2>Métricas</h2>",
      }) + comparacion(respuestas),
      opciones
    );
  }

  if (url.pathname === "/ganadores") {
    const n = dias(url, 30);
    const respuestas = await pedirATodas(env, `ganadores?dias=${n}`, { espera: 15000 });
    const filas = respuestas
      .filter((r) => r.ok && Array.isArray(r.datos))
      .flatMap((r) => r.datos.map((f) => ({ ...f, tiendaNombre: r.tienda.nombre })))
      .sort((a, b) => b.ventas - a.ventas || b.clientes - a.clientes || b.mostrado - a.mostrado)
      .slice(0, 60);
    const caidas = respuestas.filter((r) => !r.ok).map((r) => `<div class="tarjeta mal">🚨 ${esc(r.tienda.nombre)}: ${esc(r.error)}</div>`).join("");
    const cabecera = `<h2>Productos ganadores</h2><div class="suave">Ver: ${[7, 30, 90].map((x) => `<a href="?dias=${x}">${x} días</a>`).join(" · ")}</div>${caidas}`;
    return pagina("Ganadores", vistaGanadores(filas, { conTienda: true, cabecera }), opciones);
  }

  if (url.pathname === "/errores") {
    const n = Math.min(dias(url, 7), 30);
    const respuestas = await pedirATodas(env, `errores?dias=${n}`);
    const filas = respuestas
      .filter((r) => r.ok && Array.isArray(r.datos))
      .flatMap((r) => r.datos.map((e) => ({ ...e, tiendaNombre: r.tienda.nombre })))
      .sort((a, b) => b.cuando - a.cuando)
      .slice(0, 300);
    const caidas = respuestas.filter((r) => !r.ok).map((r) => `<div class="tarjeta mal">🚨 ${esc(r.tienda.nombre)}: ${esc(r.error)}</div>`).join("");
    return pagina("Errores", vistaErrores(filas, `<h2>Errores de todas las tiendas</h2>${caidas}`, { soloErrores: url.searchParams.get("solo") === "1" }), opciones);
  }

  if (url.pathname === "/gastos") {
    return pagina("Gastos", vistaGastos(await resumenes(env)), opciones);
  }

  if (url.pathname === "/salud") {
    const faltan = tiendas.filter((t) => !claveDe(env, t.id)).map((t) => `CLAVE_${t.id.toUpperCase().replace(/-/g, "_")}`);
    if (request.method === "POST") {
      if (!vieneDelPanel(request)) return new Response("No", { status: 403 });
      await comprobarTiendas(env);
      return redirigir("/salud");
    }
    return pagina(
      "Estado",
      vistaSalud(tiendas, await leerSalud(env.DB), VERSION, faltan) + `<form method="post" action="/salud"><button>Comprobar ahora</button></form>`,
      { ...opciones, vivo: true }
    );
  }

  if (url.pathname === "/como-funciona") return pagina("Cómo funciona", vistaComoFunciona(), opciones);

  const enTienda = url.pathname.match(/^\/t\/([a-z0-9_-]+)(?:\/(.*))?$/);
  if (enTienda) {
    const t = tiendas.find((x) => x.id === enTienda[1]);
    if (!t) return pagina("No existe", `<div class="tarjeta">No hay ninguna tienda «${esc(enTienda[1])}» en TIENDAS.</div>`, opciones);
    return atenderTienda(request, env, url, t, (enTienda[2] || "").replace(/\/+$/, ""), opciones);
  }

  return pagina("No existe", '<div class="tarjeta">Esa página no existe. <a href="/">Ir al inicio</a></div>', opciones);
}

const trabajador = {
  async fetch(request, env) {
    try {
      return await atender(request, env);
    } catch (error) {
      console.error("PANEL CENTRAL falló:", error?.stack || error);
      return new Response("El panel central tuvo un error. Mira los registros con: npx.cmd wrangler tail", { status: 500 });
    }
  },
  async scheduled(evento, env, ctx) {
    ctx.waitUntil(comprobarTiendas(env));
  },
};

export default trabajador;
export { VERSION, comprobarTiendas, juntarMetricas };
