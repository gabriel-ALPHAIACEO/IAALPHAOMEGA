// A DÓNDE VA EL STOCK. El agente no está atado a ninguna tienda: puede mandar
// a una o a varias a la vez, de tres clases.
//
//   "alpha"    una tienda con ALPHA IA (el bot y su panel): la puerta /api/sync.
//              Es la única con latido, «Sincronizar ahora» desde el panel,
//              ventas de vuelta y aviso de «sin señal» desde la tienda.
//              { "tipo": "alpha", "url": "https://tienda.workers.dev", "clave": "${ENV:SYNC_CLAVE}" }
//
//   "webhook"  CUALQUIER otra plataforma o tienda que tenga una dirección para
//              recibir datos (su API, un Zapier/Make/n8n, un script en PHP…).
//              Recibe un JSON (o un CSV) con todos los productos; si son muchos,
//              en partes. Ver PROTOCOLO.md.
//              { "tipo": "webhook", "url": "https://…", "formato": "json",
//                "cabeceras": { "X-Api-Key": "${ENV:MI_CLAVE}" }, "secretoFirma": "${ENV:FIRMA}" }
//
//   "carpeta"  un archivo limpio y siempre igual (stock.csv o stock.json) en una
//              carpeta: para un programa que importa desde ahí, o una carpeta de
//              Google Drive / OneDrive / Dropbox que otra plataforma lee.
//              { "tipo": "carpeta", "carpeta": "C:\\salida", "formato": "csv" }

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { aCsv } from "./tabla.mjs";
import { tablaParaAlpha, productosDe } from "./columnas.mjs";
import { expandirEntorno } from "./secretos.mjs";

export function pausa(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// La lista de destinos de una configuración. Lo de siempre (url + clave arriba
// del todo) es una tienda ALPHA IA.
export function listaDeDestinos(config = {}) {
  let lista = Array.isArray(config.destinos) ? config.destinos : config.destino ? [config.destino] : [];
  if (!lista.length && config.url) lista = [{ tipo: "alpha" }];
  let yaHayAlpha = false;
  return lista.map((d0) => {
    const d = { ...d0 };
    d.tipo = d.tipo || (d.carpeta ? "carpeta" : d.url && !config.url ? "webhook" : "alpha");
    d.timeoutSegundos ??= config.timeoutSegundos;
    if (d.tipo === "alpha") {
      d.url = d.url || config.url;
      d.clave = d.clave ?? config.clave;
      d.sede = d.sede ?? config.sede;
      // Las ventas de arriba son de la primera tienda ALPHA IA.
      if (!yaHayAlpha && d.ventas === undefined) d.ventas = config.ventas;
      yaHayAlpha = true;
    }
    if (d.tipo === "webhook") d.formato = String(d.formato || "json").toLowerCase();
    if (d.tipo === "carpeta") d.formato = String(d.formato || "csv").toLowerCase();
    return d;
  });
}

export function nombreDelDestino(d) {
  if (d.nombre) return d.nombre;
  try {
    if (d.tipo === "alpha") return `tienda ${new URL(d.url).host}`;
    if (d.tipo === "webhook") return new URL(d.url).host;
  } catch {}
  return d.tipo === "carpeta" ? `carpeta ${d.carpeta}` : d.tipo;
}

const URL_SEGURA = (u) => /^https:\/\//i.test(u) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(u);

export function problemasDelDestino(d) {
  const p = [];
  const quien = nombreDelDestino(d);
  if (d.tipo === "alpha") {
    if (!d.url) p.push('Falta "url": la dirección de la tienda, por ejemplo https://invictus-bot.tu-cuenta.workers.dev');
    else if (!URL_SEGURA(d.url)) p.push(`${quien}: la dirección tiene que empezar por https:// (la clave no puede viajar sin cifrar).`);
    else if (/\/api\/sync/i.test(d.url)) p.push(`${quien}: la dirección es solo la de la tienda, sin /api/sync al final.`);
    if (!claveDe(d)) p.push(`${quien}: falta la clave ("clave", o la variable de entorno SYNC_CLAVE). Es la SYNC_CLAVE que se cargó en la tienda.`);
  } else if (d.tipo === "webhook") {
    if (!d.url) p.push('Un destino «webhook» necesita "url".');
    else if (!URL_SEGURA(d.url)) p.push(`${quien}: la dirección tiene que empezar por https://.`);
    if (!["json", "csv"].includes(d.formato)) p.push(`${quien}: "formato" tiene que ser "json" o "csv".`);
  } else if (d.tipo === "carpeta") {
    if (!d.carpeta) p.push('Un destino «carpeta» necesita "carpeta".');
    if (!["json", "csv"].includes(d.formato)) p.push(`carpeta: "formato" tiene que ser "json" o "csv".`);
  } else p.push(`«${d.tipo}» no es un destino: usa "alpha", "webhook" o "carpeta".`);
  return p;
}

/* ── Pedir algo por internet, con tiempo máximo y reintentos ─────────── */

// Hasta «intentos» veces si la red falla o contestan 5xx (repetir no duplica:
// el que recibe tiene que aguantarlo, ver PROTOCOLO.md). Un 4xx no se repite.
export async function pedir(url, opciones = {}, { hacer = globalThis.fetch, esperar = pausa, intentos = 3, segundos = 60, quien = "" } = {}) {
  let ultimo = null;
  for (let i = 0; i < intentos; i++) {
    if (i) await esperar(2000 * 2 ** (i - 1));
    try {
      const respuesta = await hacer(url, { ...opciones, signal: AbortSignal.timeout(segundos * 1000) });
      const texto = await respuesta.text();
      let cuerpo = null;
      try {
        cuerpo = JSON.parse(texto);
      } catch {}
      if (respuesta.status >= 500 && i < intentos - 1) {
        ultimo = new Error(`contestó ${respuesta.status}`);
        continue;
      }
      return { estado: respuesta.status, cuerpo, texto };
    } catch (error) {
      const causa = error?.name === "TimeoutError" ? `no contestó en ${segundos} s` : error?.cause?.code || error?.cause?.message || error?.message || "error de red";
      let host = url;
      try {
        host = new URL(url).host;
      } catch {}
      ultimo = new Error(`No pude llegar a ${quien || host}: ${causa}. ¿Hay internet en esta PC?`);
    }
  }
  throw ultimo;
}

/* ── Tienda ALPHA IA ────────────────────────────────────────────────── */

export function claveDe(d) {
  return String(process.env.SYNC_CLAVE || expandirEntorno(d?.clave) || "");
}

export async function llamar(d, ruta, opciones = {}, { hacer = globalThis.fetch, esperar = pausa, intentos = 3, version = "" } = {}) {
  const base = String(d.url || "").replace(/\/+$/, "");
  if (!base) throw new Error('Falta "url" (la dirección de la tienda, sin barra final).');
  const clave = claveDe(d);
  if (!clave) throw new Error('Falta la clave: ponla en "clave" o en la variable SYNC_CLAVE.');
  return pedir(
    `${base}${ruta}`,
    { ...opciones, headers: { authorization: `Bearer ${clave}`, "user-agent": `agente-puente/${version}`, ...(opciones.headers || {}) } },
    { hacer, esperar, intentos, segundos: Number(d.timeoutSegundos) || 60, quien: `la tienda (${new URL(base).host})` }
  );
}

export function errorDeLaTienda(r, que) {
  const motivo =
    r.estado === 401
      ? "la clave no es la de la tienda (revisa «clave» en config.json; tiene que ser la misma SYNC_CLAVE que se cargó con wrangler)"
      : r.estado === 503
      ? "la conexión está apagada en la tienda (falta cargar SYNC_CLAVE con wrangler y volver a desplegar)"
      : r.estado === 404
      ? "esa dirección no tiene la puerta /api/sync (¿es la dirección de una tienda con ALPHA IA? Si es otra plataforma, usa un destino «webhook»)"
      : r.cuerpo?.error || String(r.texto || "").slice(0, 200);
  return new Error(`${que} (${r.estado}): ${motivo}`);
}

// Manda el conteo a la tienda y pide las tandas hasta que termine.
export async function enviarAlpha(config, d, { tabla, indices, generado }, { probar = false, hacer = globalThis.fetch, registrar = () => {}, esperar = pausa, version = "" } = {}) {
  const estandar = tablaParaAlpha(tabla, indices);
  const texto = aCsv(estandar.columnas, estandar.filas);
  const consulta = new URLSearchParams({ origen: config.origen || "", generado: String(Math.round(generado || Date.now())) });
  if (d.sede) consulta.set("sede", d.sede);
  if (probar) consulta.set("probar", "1");
  if ((d.precios ?? config.precios) === false) consulta.set("precios", "no");
  const opciones = { hacer, esperar, version };
  let r;
  for (let intento = 0; intento < 30; intento++) {
    r = await llamar(d, `/api/sync/inventario?${consulta}`, { method: "POST", headers: { "content-type": "text/csv; charset=utf-8" }, body: texto }, opciones);
    if (r.estado !== 409) break;
    registrar("Hay otro conteo a medias en la tienda; espero un minuto…");
    await esperar(60000);
  }
  if (!r.cuerpo?.ok) throw errorDeLaTienda(r, "La tienda no lo aceptó");
  let c = { filasLeidas: estandar.filas.length, ...r.cuerpo };
  if (c.sinCambios && !c.trabajo) {
    registrar(`Nada cambió (${c.sinCambios} filas iguales).`);
    return c;
  }
  for (let vuelta = 0; c.estado === "trabajando" && vuelta < 2000; vuelta++) {
    registrar(`  …${c.hechos} de ${c.total} partes`);
    const a = await llamar(d, `/api/sync/avanzar?trabajo=${c.trabajo}`, { method: "POST" }, opciones);
    if (!a.cuerpo?.ok) throw errorDeLaTienda(a, "No pude avanzar");
    c = { ...c, ...a.cuerpo };
    if (c.estado === "trabajando") await esperar(500);
  }
  const i = c.informe || {};
  registrar(`Listo: ${c.filas ?? estandar.filas.length} filas leídas${c.sinCambios ? `, ${c.sinCambios} sin cambios` : ""}${i.nuevos ? `, ${i.nuevos} productos nuevos` : ""}${i.errores?.length ? `, ${i.errores.length} con problemas` : ""}.`);
  for (const e of (i.errores || []).slice(0, 10)) registrar(`  ⚠ ${e}`);
  return c;
}

// Le dice a la tienda cómo está. Nunca rompe la vuelta: si no llega, null.
export async function latido(config, d, datos = {}, { hacer = globalThis.fetch, esperar = pausa, registrar = () => {}, version = "" } = {}) {
  const cuerpo = {
    agente: config.agente,
    origen: config.origen || "",
    equipo: config.equipo || "",
    version,
    modo: datos.modo || "continuo",
    cadaMinutos: Number(config.cadaMinutos) || 15,
    estado: datos.estado || "espera",
    ...datos,
  };
  try {
    const r = await llamar(d, "/api/sync/latido", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) }, { hacer, esperar, intentos: 2, version });
    if (r.estado === 404) {
      registrar(`${nombreDelDestino(d)} todavía no entiende el latido (una versión vieja). El stock se pasa igual.`);
      return null;
    }
    if (!r.cuerpo?.ok) {
      registrar(`El latido no entró en ${nombreDelDestino(d)}: ${errorDeLaTienda(r, "latido").message}`);
      return null;
    }
    return r.cuerpo;
  } catch (error) {
    registrar(`El latido no llegó a ${nombreDelDestino(d)}: ${error.message}`);
    return null;
  }
}

// Las ventas de la tienda, a una carpeta, para cargarlas en el sistema cerrado.
export async function bajarVentas(d, { hacer = globalThis.fetch, registrar = () => {}, esperar = pausa, version = "" } = {}) {
  const v = d.ventas;
  if (!v?.activar) return null;
  if (!v.carpeta) throw new Error('Falta "ventas.carpeta".');
  fs.mkdirSync(v.carpeta, { recursive: true });
  const archivoDeEstado = path.join(v.carpeta, "ultima-venta.json");
  let ultimo = 0;
  try {
    ultimo = Number(JSON.parse(fs.readFileSync(archivoDeEstado, "utf8")).ultimoId) || 0;
  } catch {}
  const opciones = { hacer, esperar, version };
  const nuevas = await llamar(d, `/api/sync/ventas?formato=json&desde_id=${ultimo}`, {}, opciones);
  if (!nuevas.cuerpo?.ok) throw errorDeLaTienda(nuevas, "No pude bajar las ventas");
  if (nuevas.cuerpo.ventas.length) {
    const csv = await llamar(d, `/api/sync/ventas?desde_id=${ultimo}`, {}, opciones);
    const maximo = Math.max(...nuevas.cuerpo.ventas.map((x) => x.id));
    fs.writeFileSync(path.join(v.carpeta, `ventas-nuevas-${maximo}.csv`), csv.texto);
    fs.writeFileSync(archivoDeEstado, JSON.stringify({ ultimoId: maximo }));
    registrar(`Ventas: ${nuevas.cuerpo.ventas.length} líneas nuevas en ventas-nuevas-${maximo}.csv`);
  }
  // …y siempre los últimos 3 días completos (ahí se ven las ANULADAS).
  const recientes = await llamar(d, "/api/sync/ventas", {}, opciones);
  if (recientes.estado === 200) fs.writeFileSync(path.join(v.carpeta, "ventas-ultimos-3-dias.csv"), recientes.texto);
  return nuevas.cuerpo.ventas.length;
}

/* ── Cualquier otra plataforma (webhook) ────────────────────────────── */

// La firma: HMAC-SHA256 de «<tiempo>.<cuerpo>» con el secreto compartido. Así
// el que recibe sabe que viene de este agente y que nadie lo cambió por el
// camino (y por el tiempo, que no es uno viejo repetido). Ver PROTOCOLO.md.
export function firmar(secreto, tiempo, cuerpo) {
  return `sha256=${crypto.createHmac("sha256", String(secreto)).update(`${tiempo}.${cuerpo}`).digest("hex")}`;
}

const CAMPOS_CSV = ["codigo", "producto", "talla", "color", "cantidad", "precio", "costo", "marca", "sede", "categoria", "foto"];

function cuerposDelWebhook(config, d, productos, generado, version) {
  const lote = Math.max(1, Math.min(10000, Number(d.lote) || 1000));
  const partes = [];
  for (let i = 0; i < productos.length || (i === 0 && !productos.length); i += lote) partes.push(productos.slice(i, i + lote));
  const envio = `${config.agente}-${Math.round(generado)}`;
  return partes.map((parte, n) => {
    if (d.formato === "csv") {
      const columnas = CAMPOS_CSV.filter((c) => productos.some((p) => p[c] !== undefined && p[c] !== null));
      return { tipo: "text/csv; charset=utf-8", cuerpo: aCsv(columnas, parte.map((p) => columnas.map((c) => (p[c] ?? "")))), parte: n + 1, partes: partes.length, envio };
    }
    return {
      tipo: "application/json",
      cuerpo: JSON.stringify({ agente: config.agente, origen: config.origen || "", equipo: config.equipo || "", version, envio, generado: new Date(generado).toISOString(), parte: n + 1, partes: partes.length, total: productos.length, productos: parte }),
      parte: n + 1,
      partes: partes.length,
      envio,
    };
  });
}

export async function enviarWebhook(config, d, { tabla, indices, generado }, { probar = false, hacer = globalThis.fetch, registrar = () => {}, esperar = pausa, version = "" } = {}) {
  const { productos, saltadas } = productosDe(tabla, indices, { conCosto: Boolean(d.incluirCosto) });
  const cuerpos = cuerposDelWebhook(config, d, productos, generado || Date.now(), version);
  if (probar) {
    return { ok: true, probando: true, filas: productos.length, saltadas, partes: cuerpos.length, ejemplo: productos[0] || null, mensaje: `mandaría ${productos.length} productos a ${nombreDelDestino(d)} en ${cuerpos.length} ${cuerpos.length === 1 ? "parte" : "partes"}` };
  }
  const cabeceras = Object.fromEntries(Object.entries(d.cabeceras || {}).map(([k, v]) => [k, expandirEntorno(String(v))]));
  const secreto = expandirEntorno(d.secretoFirma || "");
  for (const c of cuerpos) {
    const tiempo = String(Date.now());
    const h = {
      "content-type": c.tipo,
      "user-agent": `agente-puente/${version}`,
      "x-agente-puente": version,
      "x-puente-envio": c.envio,
      "x-puente-parte": `${c.parte}/${c.partes}`,
      ...cabeceras,
    };
    if (secreto) Object.assign(h, { "x-puente-tiempo": tiempo, "x-puente-firma": firmar(secreto, tiempo, c.cuerpo) });
    const r = await pedir(d.url, { method: String(d.metodo || "POST").toUpperCase(), headers: h, body: c.cuerpo }, { hacer, esperar, segundos: Number(d.timeoutSegundos) || 60 });
    if (r.estado < 200 || r.estado >= 300) {
      const dijo = r.cuerpo?.error || r.cuerpo?.message || String(r.texto || "").slice(0, 200);
      const motivo = r.estado === 401 || r.estado === 403 ? `no aceptó la clave o la firma (revisa «cabeceras» y «secretoFirma» del destino)${dijo ? `: ${dijo}` : ""}` : dijo;
      throw new Error(`No lo aceptó (${r.estado}): ${motivo}${c.partes > 1 ? ` — en la parte ${c.parte} de ${c.partes}` : ""}`);
    }
    if (c.partes > 1) registrar(`  …parte ${c.parte} de ${c.partes} a ${nombreDelDestino(d)}`);
  }
  registrar(`Listo: ${productos.length} productos a ${nombreDelDestino(d)}${saltadas ? ` (${saltadas} filas sin código ni nombre, saltadas)` : ""}.`);
  return { ok: true, filas: productos.length, saltadas, partes: cuerpos.length };
}

/* ── Una carpeta ────────────────────────────────────────────────────── */

export async function escribirCarpeta(config, d, { tabla, indices, generado }, { probar = false, registrar = () => {}, version = "" } = {}) {
  const { productos, saltadas } = productosDe(tabla, indices, { conCosto: Boolean(d.incluirCosto) });
  const archivo = path.join(d.carpeta, d.archivo || `stock.${d.formato}`);
  if (probar) return { ok: true, probando: true, filas: productos.length, saltadas, ejemplo: productos[0] || null, mensaje: `escribiría ${productos.length} productos en ${archivo}` };
  fs.mkdirSync(d.carpeta, { recursive: true });
  let contenido;
  if (d.formato === "json") {
    contenido = JSON.stringify({ agente: config.agente, origen: config.origen || "", version, generado: new Date(generado || Date.now()).toISOString(), total: productos.length, productos }, null, 2);
  } else {
    const columnas = CAMPOS_CSV.filter((c) => productos.some((p) => p[c] !== undefined && p[c] !== null));
    contenido = aCsv(columnas, productos.map((p) => columnas.map((c) => p[c] ?? "")), d.separador || ";");
  }
  // Primero a un temporal y luego se cambia el nombre: el que lee nunca ve un
  // archivo a medio escribir.
  const temporal = `${archivo}.tmp`;
  fs.writeFileSync(temporal, d.formato === "csv" && d.conBom !== false ? `\uFEFF${contenido}` : contenido);
  fs.renameSync(temporal, archivo);
  registrar(`Listo: ${productos.length} productos en ${archivo}.`);
  return { ok: true, filas: productos.length, saltadas, archivo };
}

/* ── Mandar a un destino, sea cual sea ──────────────────────────────── */

export function enviarA(config, d, datos, opciones) {
  if (d.tipo === "alpha") return enviarAlpha(config, d, datos, opciones);
  if (d.tipo === "webhook") return enviarWebhook(config, d, datos, opciones);
  if (d.tipo === "carpeta") return escribirCarpeta(config, d, datos, opciones);
  throw new Error(`«${d.tipo}» no es un destino.`);
}
