#!/usr/bin/env node
// AGENTE PUENTE v2 (16-oct-2026). Funciona solo, aparte de los bots: no
// necesita ningún archivo de ellos, solo Node 18 o más y esta carpeta.
//
// Es el programa que corre en la PC o el servidor del cliente, junto a su
// sistema de inventario CERRADO (el que no tiene API), y le pasa el stock al
// bot de la tienda.
//
// QUÉ HACE, en cada vuelta:
//   1. LATIDO: le avisa a la tienda «estoy vivo» (POST /api/sync/latido) y, de
//      paso, pregunta si desde el panel pidieron «Sincronizar ahora».
//   2. Si toca (pasaron «cadaMinutos» o se lo pidieron), SACA EL STOCK del
//      sistema de una de dos formas (ver config.json):
//        · "archivo": lee el CSV que el sistema exporta a una carpeta;
//        · "comando": corre un comando que escribe el stock por pantalla
//          (sqlcmd para SQL Server, mysql, psql, sqlite3, PowerShell con ODBC…).
//   3. Lo MANDA a  <url>/api/sync/inventario  con la clave; si es grande, pide
//      las tandas hasta que termine.
//   4. (Opcional) BAJA LAS VENTAS de la tienda a una carpeta, en CSV, para
//      cargarlas en el sistema cerrado con su importador.
//   5. Le dice a la tienda cómo le fue (otro latido: «ok» o «error» con el
//      motivo). Si falla, en el panel sale «Con error» y llega un aviso.
//
// CÓMO SE USA (todo desde esta carpeta):
//   node agente-puente.mjs --configurar     preguntas paso a paso; escribe config.json
//   node agente-puente.mjs --doctor         revisa todo y dice qué falla y cómo arreglarlo
//   node agente-puente.mjs --probar         manda con ?probar=1: dice qué haría, NO guarda nada
//   node agente-puente.mjs --instalar       lo deja corriendo solo cada minuto (Programador de
//                                           tareas en Windows, cron en Linux/Mac). --usuario NOMBRE
//                                           para correrlo con esa cuenta en vez de SYSTEM
//   node agente-puente.mjs --desinstalar    lo quita
//   node agente-puente.mjs --estado         cómo le fue la última vez y las últimas líneas del registro
//   node agente-puente.mjs --una-vez        sincroniza YA (aunque no toque) y sale
//   node agente-puente.mjs --vuelta         una vuelta normal (lo que corre la tarea programada)
//   node agente-puente.mjs                  corre para siempre en esta ventana (una vuelta por minuto)
//   --config otra.json                      con otro archivo de configuración
//
// LA CLAVE (SYNC_CLAVE de la tienda) va en config.json o en la variable de
// entorno SYNC_CLAVE. NUNCA sale por pantalla, en el registro ni en el latido:
// todo lo que se escribe pasa por sinSecretos(), que también tapa las
// contraseñas que vayan en el comando (-P, -p, password=, pwd=).
//
// LO QUE NO HACE: no acepta comandos de afuera (la única orden que entiende es
// «sincronizar», y sincronizar es lo mismo que haría solo), no borra nada del
// sistema del cliente, no toca su base (solo lee) y no crea ventas en la tienda.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { exec, spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const VERSION = "2.0.0";
export const NOMBRE_DE_LA_TAREA = "Agente puente";
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MINUTO = 60 * 1000;
// Pasado este tiempo, un candado (otra vuelta corriendo) se da por muerto.
const CANDADO_VIEJO_MS = 30 * MINUTO;
// El registro (puente.log) se rota al pasar de este tamaño.
const REGISTRO_MAXIMO = 1024 * 1024;

export function pausa(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ── Nunca un secreto por escrito ───────────────────────────────────── */

// Quita claves, contraseñas y tokens de un texto. «secretos» son valores
// concretos (la clave, las contraseñas del comando) que se tapan donde estén.
export function sinSecretos(texto, secretos = []) {
  let t = String(texto ?? "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***")
    .replace(/((?:clave|contrase[ñn]a|password|passwd|pwd|token|secret|secreto|api[_-]?key)\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s;]+)/gi, "$1***")
    .replace(/(\s-P\s+)("[^"]*"|'[^']*'|\S+)/g, "$1***")
    .replace(/(\s-p)(?!\s)(\S+)/g, "$1***");
  for (const s of secretos) {
    const v = String(s || "");
    if (v.length >= 4) t = t.split(v).join("***");
  }
  return t;
}

// Las contraseñas que vienen escritas en el comando de la fuente (para taparlas
// también si el programa las repite en su error).
export function secretosDe(config = {}) {
  const lista = [claveDe(config)];
  const comando = String(config.fuente?.comando || "");
  const sacar = (re) => {
    for (const m of comando.matchAll(re)) lista.push(String(m[1]).replace(/^["']|["']$/g, ""));
  };
  sacar(/\s-P\s+("[^"]*"|'[^']*'|\S+)/g);
  sacar(/\s-p(?!\s)(\S+)/g);
  sacar(/(?:password|passwd|pwd)\s*=\s*("[^"]*"|'[^']*'|[^\s;]+)/gi);
  return lista.filter((s) => String(s || "").length >= 4);
}

/* ── El registro (puente.log), con rotación ─────────────────────────── */

function marcaDeTiempo(ms = Date.now()) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Devuelve registrar(mensaje). Escribe en pantalla (si «consola») y en el
// archivo, siempre sin secretos. Si el archivo pasa de «maximo», el viejo
// queda como puente.log.1 (uno solo: nunca llena el disco).
export function crearRegistro({ archivo = "", consola = true, maximo = REGISTRO_MAXIMO, secretos = [] } = {}) {
  return (mensaje, { error = false } = {}) => {
    const linea = `[${marcaDeTiempo()}] ${sinSecretos(mensaje, secretos)}`;
    if (consola) (error ? console.error : console.log)(linea);
    if (!archivo) return;
    try {
      if (fs.existsSync(archivo) && fs.statSync(archivo).size > maximo) fs.renameSync(archivo, `${archivo}.1`);
      fs.appendFileSync(archivo, `${linea}\n`);
    } catch {
      // Sin poder escribir el registro se sigue igual: lo importante es el stock.
    }
  };
}

/* ── La configuración ───────────────────────────────────────────────── */

function claveDe(config) {
  return String(process.env.SYNC_CLAVE || config.clave || "");
}

export function leerConfig(ruta) {
  let config;
  try {
    config = JSON.parse(fs.readFileSync(ruta, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    const motivo = error.code === "ENOENT" ? "no existe" : error.message;
    throw new Error(`No pude leer ${ruta} (${motivo}). Corre «node agente-puente.mjs --configurar» o copia config.ejemplo.json como config.json y complétalo.`);
  }
  return completarConfig(config, path.dirname(path.resolve(ruta)));
}

// Lo que no venga en config.json toma su valor normal.
export function completarConfig(config, carpeta = AQUI) {
  return {
    cadaMinutos: 15,
    latidoSegundos: 60,
    timeoutSegundos: 60,
    ...config,
    agente: String(config.agente || os.hostname() || "puente"),
    equipo: String(config.equipo || os.hostname() || ""),
    carpeta: config.carpeta || carpeta,
  };
}

// Lo que falta o está mal en la configuración (vacío = todo bien).
export function problemasDeConfig(config) {
  const p = [];
  const url = String(config.url || "");
  if (!url) p.push('Falta "url": la dirección del bot, por ejemplo https://invictus-bot.tu-cuenta.workers.dev');
  else if (!/^https:\/\//i.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(url)) p.push('"url" tiene que empezar por https:// (la clave no puede viajar sin cifrar).');
  else if (/\/api\/sync/i.test(url)) p.push('"url" es solo la dirección del bot, sin /api/sync al final.');
  if (!claveDe(config)) p.push('Falta la clave: ponla en "clave" o en la variable de entorno SYNC_CLAVE (es la SYNC_CLAVE que se cargó en la tienda).');
  const f = config.fuente || {};
  if (f.tipo === "archivo") {
    if (!f.ruta) p.push('Falta "fuente.ruta": dónde deja el sistema el archivo con el stock.');
  } else if (f.tipo === "comando") {
    if (!f.comando) p.push('Falta "fuente.comando": el comando que escribe el stock por pantalla.');
  } else p.push('"fuente.tipo" tiene que ser "archivo" o "comando".');
  if (config.ventas?.activar && !config.ventas.carpeta) p.push('Las ventas están activadas pero falta "ventas.carpeta".');
  return p;
}

/* ── Sacar el stock del sistema ─────────────────────────────────────── */

function decodificar(buffer, codificacion = "utf8") {
  const c = String(codificacion || "utf8").toLowerCase();
  if (c === "latin1" || c === "windows-1252" || c === "cp1252" || c === "ansi") return new TextDecoder("windows-1252").decode(buffer);
  if (c === "utf16le" || c === "utf-16le" || c === "utf16") return new TextDecoder("utf-16le").decode(buffer);
  return new TextDecoder("utf-8").decode(buffer);
}

// La salida de sqlcmd y parecidos trae una línea de rayas debajo del encabezado
// y un "(123 filas afectadas)" al final: se limpian. Un CSV normal queda igual.
export function limpiarSalida(texto) {
  const lineas = String(texto || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .filter((l) => !/^[-=;,\s|+]+$/.test(l))
    .filter((l) => !/^\(\d+\s+(rows?|filas?)[^)]*\)$/i.test(l.trim()));
  return lineas.join("\n");
}

// Corre el comando de la fuente. El error NUNCA lleva el comando (puede tener
// la contraseña de la base): solo el código y lo que el programa dijo.
function correr(comando, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    exec(comando, { encoding: "buffer", maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs, windowsHide: true }, (error, salida, errores) => {
      if (error) {
        if (error.killed) {
          reject(new Error(`El comando tardó más de ${Math.round(timeoutMs / 1000)} s y se cortó (sube "fuente.timeoutSegundos" si la consulta es lenta).`));
          return;
        }
        const detalle = decodificar(errores || Buffer.alloc(0)).replace(/\s+/g, " ").trim().slice(0, 300);
        reject(new Error(`El comando falló (código ${error.code ?? "?"})${detalle ? `: ${detalle}` : ". No dijo por qué: pruébalo a mano en una ventana de comandos."}`));
        return;
      }
      resolve(salida);
    });
  });
}

// Saca el stock de la fuente configurada. Devuelve { texto, generado }.
export async function leerFuente(config) {
  const f = config.fuente || {};
  if (f.tipo === "archivo") {
    if (!f.ruta) throw new Error('Falta "fuente.ruta".');
    let estado;
    try {
      estado = fs.statSync(f.ruta);
    } catch (error) {
      throw new Error(error.code === "ENOENT" ? `No encuentro el archivo ${f.ruta}. ¿El sistema lo está exportando ahí? (Si es una unidad de red, usa la ruta \\\\servidor\\carpeta: la tarea programada no ve las letras de unidad.)` : `No pude abrir ${f.ruta}: ${error.message}`);
    }
    if (f.maximoMinutos && Date.now() - estado.mtimeMs > f.maximoMinutos * MINUTO) {
      throw new Error(`El archivo es viejo (de ${marcaDeTiempo(estado.mtimeMs)}). Si el sistema ya no lo actualiza, no se manda.`);
    }
    return { texto: limpiarSalida(decodificar(fs.readFileSync(f.ruta), f.codificacion)), generado: estado.mtimeMs };
  }
  if (f.tipo === "comando") {
    if (!f.comando) throw new Error('Falta "fuente.comando".');
    const inicio = Date.now();
    const salida = await correr(f.comando, { timeoutMs: (f.timeoutSegundos || 120) * 1000 });
    return { texto: limpiarSalida(decodificar(salida, f.codificacion)), generado: inicio };
  }
  throw new Error('"fuente.tipo" tiene que ser "archivo" o "comando".');
}

/* ── Hablar con la tienda ───────────────────────────────────────────── */

// Una llamada a la tienda, con su tiempo máximo y hasta 3 intentos si la red
// falla o la tienda contesta 5xx (repetir no duplica nada: así está hecha la
// puerta). Un 4xx no se repite: es un problema de datos o de clave.
export async function llamar(config, ruta, opciones = {}, { hacer = globalThis.fetch, esperar = pausa, intentos = 3 } = {}) {
  const base = String(config.url || "").replace(/\/+$/, "");
  if (!base) throw new Error('Falta "url" (la dirección del bot, sin barra final).');
  const clave = claveDe(config);
  if (!clave) throw new Error('Falta la clave: ponla en "clave" o en la variable SYNC_CLAVE.');
  const tiempo = (Number(config.timeoutSegundos) || 60) * 1000;
  let ultimo = null;
  for (let i = 0; i < intentos; i++) {
    if (i) await esperar(2000 * 2 ** (i - 1));
    try {
      const respuesta = await hacer(`${base}${ruta}`, {
        ...opciones,
        headers: { authorization: `Bearer ${clave}`, "user-agent": `agente-puente/${VERSION}`, ...(opciones.headers || {}) },
        signal: AbortSignal.timeout(tiempo),
      });
      const texto = await respuesta.text();
      let cuerpo = null;
      try {
        cuerpo = JSON.parse(texto);
      } catch {}
      if (respuesta.status >= 500 && i < intentos - 1) {
        ultimo = new Error(`La tienda contestó ${respuesta.status}`);
        continue;
      }
      return { estado: respuesta.status, cuerpo, texto };
    } catch (error) {
      const causa = error?.name === "TimeoutError" ? `no contestó en ${tiempo / 1000} s` : error?.cause?.code || error?.cause?.message || error?.message || "error de red";
      ultimo = new Error(`No pude llegar a la tienda (${new URL(base).host}): ${causa}. ¿Hay internet en esta PC?`);
    }
  }
  throw ultimo;
}

function errorDeLaTienda(r, que) {
  const motivo =
    r.estado === 401
      ? "la clave no es la de la tienda (revisa «clave» en config.json; tiene que ser la misma SYNC_CLAVE que se cargó con wrangler)"
      : r.estado === 503
      ? "la conexión está apagada en la tienda (falta cargar SYNC_CLAVE con wrangler y volver a desplegar)"
      : r.cuerpo?.error || String(r.texto || "").slice(0, 200);
  return new Error(`${que} (${r.estado}): ${motivo}`);
}

// Un ciclo: saca el stock, lo manda, y espera a que termine.
export async function ciclo(config, { probar = false, hacer = globalThis.fetch, registrar = console.log, esperar = pausa } = {}) {
  const { texto, generado } = await leerFuente(config);
  const filas = texto.split("\n").length - 1;
  if (filas < 1) throw new Error("La fuente no devolvió ninguna fila (¿el comando o el archivo están bien?).");
  const consulta = new URLSearchParams({ origen: config.origen || "", generado: String(Math.round(generado)) });
  if (config.sede) consulta.set("sede", config.sede);
  if (probar) consulta.set("probar", "1");
  if (config.precios === false) consulta.set("precios", "no");
  registrar(`Mandando ${filas} filas${probar ? " (solo probar)" : ""}…`);

  let r;
  for (let intento = 0; intento < 30; intento++) {
    r = await llamar(config, `/api/sync/inventario?${consulta}`, { method: "POST", headers: { "content-type": "text/csv; charset=utf-8" }, body: texto }, { hacer, esperar });
    if (r.estado !== 409) break;
    registrar("Hay otro conteo a medias en la tienda; espero un minuto…");
    await esperar(60000);
  }
  if (!r.cuerpo?.ok) throw errorDeLaTienda(r, "La tienda no lo aceptó");
  let c = { filasLeidas: filas, ...r.cuerpo };
  if (c.sinCambios && !c.trabajo) {
    registrar(`Nada cambió (${c.sinCambios} filas iguales).`);
    return c;
  }
  // Por tandas: se pide la siguiente hasta que termine.
  for (let vuelta = 0; c.estado === "trabajando" && vuelta < 2000; vuelta++) {
    registrar(`  …${c.hechos} de ${c.total} partes`);
    const a = await llamar(config, `/api/sync/avanzar?trabajo=${c.trabajo}`, { method: "POST" }, { hacer, esperar });
    if (!a.cuerpo?.ok) throw errorDeLaTienda(a, "No pude avanzar");
    c = { ...c, ...a.cuerpo };
    if (c.estado === "trabajando") await esperar(500);
  }
  const i = c.informe || {};
  registrar(`Listo: ${c.filas ?? filas} filas leídas${c.sinCambios ? `, ${c.sinCambios} sin cambios` : ""}${i.nuevos ? `, ${i.nuevos} productos nuevos` : ""}${i.errores?.length ? `, ${i.errores.length} con problemas` : ""}.`);
  for (const e of (i.errores || []).slice(0, 10)) registrar(`  ⚠ ${e}`);
  return c;
}

// Las ventas de la tienda, a una carpeta, para cargarlas en el sistema cerrado.
export async function bajarVentas(config, { hacer = globalThis.fetch, registrar = console.log, esperar = pausa } = {}) {
  const v = config.ventas;
  if (!v?.activar) return null;
  if (!v.carpeta) throw new Error('Falta "ventas.carpeta".');
  fs.mkdirSync(v.carpeta, { recursive: true });
  const archivoDeEstado = path.join(v.carpeta, "ultima-venta.json");
  let ultimo = 0;
  try {
    ultimo = Number(JSON.parse(fs.readFileSync(archivoDeEstado, "utf8")).ultimoId) || 0;
  } catch {}
  // Las nuevas desde la última que ya bajaste…
  const nuevas = await llamar(config, `/api/sync/ventas?formato=json&desde_id=${ultimo}`, {}, { hacer, esperar });
  if (!nuevas.cuerpo?.ok) throw errorDeLaTienda(nuevas, "No pude bajar las ventas");
  if (nuevas.cuerpo.ventas.length) {
    const csv = await llamar(config, `/api/sync/ventas?desde_id=${ultimo}`, {}, { hacer, esperar });
    const maximo = Math.max(...nuevas.cuerpo.ventas.map((x) => x.id));
    fs.writeFileSync(path.join(v.carpeta, `ventas-nuevas-${maximo}.csv`), csv.texto);
    fs.writeFileSync(archivoDeEstado, JSON.stringify({ ultimoId: maximo }));
    registrar(`Ventas: ${nuevas.cuerpo.ventas.length} líneas nuevas en ventas-nuevas-${maximo}.csv`);
  }
  // …y siempre los últimos 3 días completos (ahí se ven las ANULADAS).
  const recientes = await llamar(config, "/api/sync/ventas", {}, { hacer, esperar });
  if (recientes.estado === 200) fs.writeFileSync(path.join(v.carpeta, "ventas-ultimos-3-dias.csv"), recientes.texto);
  return nuevas.cuerpo.ventas.length;
}

/* ── El latido ──────────────────────────────────────────────────────── */

// Le dice a la tienda cómo está. Nunca rompe la vuelta: si no llega, devuelve
// null (la tienda, al no oírlo, avisará sola que no hay señal).
export async function latido(config, datos = {}, { hacer = globalThis.fetch, esperar = pausa, registrar = () => {} } = {}) {
  const cuerpo = {
    agente: config.agente,
    origen: config.origen || "",
    equipo: config.equipo || "",
    version: VERSION,
    modo: datos.modo || "continuo",
    cadaMinutos: Number(config.cadaMinutos) || 15,
    estado: datos.estado || "espera",
    ...datos,
  };
  if (cuerpo.mensaje) cuerpo.mensaje = sinSecretos(cuerpo.mensaje, secretosDe(config)).slice(0, 300);
  try {
    const r = await llamar(config, "/api/sync/latido", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) }, { hacer, esperar, intentos: 2 });
    if (r.estado === 404) {
      registrar("La tienda todavía no entiende el latido (tiene una versión vieja del bot). El stock se pasa igual.");
      return null;
    }
    if (!r.cuerpo?.ok) {
      registrar(`El latido no entró: ${errorDeLaTienda(r, "latido").message}`);
      return null;
    }
    return r.cuerpo;
  } catch (error) {
    registrar(`El latido no llegó: ${error.message}`);
    return null;
  }
}

/* ── Lo que el agente recuerda entre vueltas ────────────────────────── */

export function rutaDe(config, nombre) {
  return path.join(config.carpeta || AQUI, nombre);
}

export function leerEstado(config) {
  try {
    return JSON.parse(fs.readFileSync(rutaDe(config, "estado-puente.json"), "utf8"));
  } catch {
    return {};
  }
}

function guardarEstado(config, estado) {
  try {
    fs.writeFileSync(rutaDe(config, "estado-puente.json"), JSON.stringify(estado, null, 2));
  } catch {}
}

// Para que dos vueltas no corran a la vez (si un conteo tarda más de un minuto).
export function tomarCandado(config, ahora = Date.now()) {
  const ruta = rutaDe(config, "puente.lock");
  try {
    fs.writeFileSync(ruta, JSON.stringify({ pid: process.pid, desde: ahora }), { flag: "wx" });
    return true;
  } catch {
    let desde = 0;
    try {
      desde = Number(JSON.parse(fs.readFileSync(ruta, "utf8")).desde) || 0;
    } catch {}
    if (ahora - desde < CANDADO_VIEJO_MS) return false;
    // El de antes se murió a la mitad: se toma.
    fs.writeFileSync(ruta, JSON.stringify({ pid: process.pid, desde: ahora }));
    return true;
  }
}

// El que corre siempre lo renueva en cada vuelta: así nunca parece «muerto»
// y la tarea programada no arranca otro al lado.
export function renovarCandado(config, ahora = Date.now()) {
  try {
    fs.writeFileSync(rutaDe(config, "puente.lock"), JSON.stringify({ pid: process.pid, desde: ahora }));
  } catch {}
}

export function soltarCandado(config) {
  try {
    fs.unlinkSync(rutaDe(config, "puente.lock"));
  } catch {}
}

/* ── Una vuelta ─────────────────────────────────────────────────────── */

function resumenDelCiclo(c) {
  const i = c.informe || {};
  const partes = [`${c.filas ?? c.filasLeidas ?? 0} filas`];
  if (c.sinCambios) partes.push(`${c.sinCambios} sin cambios`);
  if (i.nuevos) partes.push(`${i.nuevos} productos nuevos`);
  if (i.errores?.length) partes.push(`${i.errores.length} filas con problemas`);
  return partes.join(", ");
}

// Latido → (si toca) conteo → latido con el resultado. «forzar» = sincroniza
// aunque no toque (--una-vez). Devuelve { sincronizo, ok, error? }.
export async function vuelta(config, { forzar = false, modo = "continuo", hacer = globalThis.fetch, esperar = pausa, registrar = console.log, ahora = Date.now } = {}) {
  const estado = leerEstado(config);
  const cada = Math.max(1, Number(config.cadaMinutos) || 15) * MINUTO;
  const tocaPorTiempo = forzar || !estado.proximaSync || ahora() >= Number(estado.proximaSync);
  const primero = !estado.encendido;
  const resp = await latido(config, { modo, estado: primero ? "inicio" : tocaPorTiempo ? "trabajando" : "espera" }, { hacer, esperar, registrar });
  if (primero) {
    estado.encendido = ahora();
    guardarEstado(config, estado);
  }
  const orden = Number(resp?.ordenEn) || 0;
  if (orden) registrar("Desde el panel pidieron sincronizar ahora.");
  if (!tocaPorTiempo && !orden) return { sincronizo: false, ok: true };

  const inicio = ahora();
  try {
    const c = await ciclo(config, { hacer, registrar, esperar });
    let mensaje = resumenDelCiclo(c);
    try {
      const ventas = await bajarVentas(config, { hacer, registrar, esperar });
      if (ventas) mensaje += `; ${ventas} ventas bajadas`;
    } catch (error) {
      // Las ventas fallaron pero el stock entró: se dice, sin marcar el conteo como malo.
      registrar(`⚠ Ventas: ${error.message}`, { error: true });
      mensaje += `; las ventas no se pudieron bajar: ${error.message}`;
    }
    Object.assign(estado, { ultimaSync: inicio, proximaSync: inicio + cada, ultimoOk: inicio, filas: c.filas ?? c.filasLeidas, sinCambios: c.sinCambios || 0, ultimoMensaje: mensaje, errorSeguido: 0 });
    guardarEstado(config, estado);
    await latido(config, { modo, estado: "ok", ciclo: true, mensaje, filas: c.filas ?? c.filasLeidas ?? 0, sinCambios: c.sinCambios || 0, ordenHecha: orden || undefined }, { hacer, esperar, registrar });
    return { sincronizo: true, ok: true, resultado: c };
  } catch (error) {
    const mensaje = sinSecretos(error.message, secretosDe(config));
    registrar(`❌ ${mensaje}`, { error: true });
    // Tras un error se vuelve a intentar antes (5 min, o cadaMinutos si es menos).
    const seguidos = (Number(estado.errorSeguido) || 0) + 1;
    Object.assign(estado, { ultimaSync: inicio, proximaSync: inicio + Math.min(cada, 5 * MINUTO), ultimoError: mensaje, ultimoErrorEn: inicio, errorSeguido: seguidos });
    guardarEstado(config, estado);
    // La orden se da por atendida aunque haya fallado: el error sale en el
    // panel y no se reintenta cada minuto.
    await latido(config, { modo, estado: "error", ciclo: true, mensaje, ordenHecha: orden || undefined }, { hacer, esperar, registrar });
    return { sincronizo: true, ok: false, error: mensaje };
  }
}

// Corre para siempre: una vuelta por minuto (latidoSegundos).
export async function correrSiempre(config, opciones = {}) {
  const { registrar = console.log, esperar = pausa, vueltas = Infinity } = opciones;
  registrar(`Agente puente ${VERSION} corriendo. Sincroniza cada ${config.cadaMinutos} min y avisa a la tienda cada ${config.latidoSegundos} s. Ctrl+C para parar.`);
  for (let n = 0; n < vueltas; n++) {
    opciones.alEmpezar?.();
    try {
      await vuelta(config, { ...opciones, modo: "continuo" });
    } catch (error) {
      registrar(`❌ ${sinSecretos(error.message, secretosDe(config))}`, { error: true });
    }
    if (n + 1 < vueltas) await esperar(Math.max(15, Number(config.latidoSegundos) || 60) * 1000);
  }
}

/* ── Configurar (las preguntas) ─────────────────────────────────────── */

// «preguntar(texto, porDefecto)» devuelve la respuesta (se puede cambiar en
// las pruebas). Escribe config.json en «ruta» y devuelve la configuración.
export async function configurar({ ruta, preguntar, escribir = console.log, anterior = {} } = {}) {
  escribir("\nVamos a configurar el agente puente. Enter deja lo que está entre corchetes.\n");
  const p = async (texto, porDefecto = "") => String((await preguntar(`${texto}${porDefecto !== "" ? ` [${porDefecto}]` : ""}: `, porDefecto)) ?? "").trim() || String(porDefecto);
  let url = "";
  for (;;) {
    url = (await p("1. Dirección del bot de la tienda (https://…workers.dev)", anterior.url || "")).replace(/\/+$/, "").replace(/\/api\/sync.*$/i, "");
    if (/^https:\/\//i.test(url) || /^http:\/\/(127\.0\.0\.1|localhost)/i.test(url)) break;
    escribir("   Tiene que empezar por https://");
  }
  const clave = await p("2. La clave de la conexión (la SYNC_CLAVE de la tienda; si la dejas vacía, se lee de la variable SYNC_CLAVE)", anterior.clave ? "(la de antes)" : "");
  const origen = await p("3. Nombre de tu sistema de inventario (sale en los movimientos)", anterior.origen || "Mi sistema");
  const equipo = await p("4. Nombre de esta PC (para reconocerla en el panel)", anterior.equipo || os.hostname());
  const sede = await p("5. Sede de la tienda a la que va este stock (vacío = la que diga el archivo, o la principal)", anterior.sede || "");
  let tipo = "";
  for (;;) {
    tipo = (await p("6. ¿De dónde sale el stock? 1 = un archivo que exporta el sistema, 2 = un comando o consulta", anterior.fuente?.tipo === "comando" ? "2" : "1")).toLowerCase();
    if (["1", "2", "archivo", "comando"].includes(tipo)) break;
  }
  const fuente = {};
  if (tipo === "1" || tipo === "archivo") {
    fuente.tipo = "archivo";
    fuente.ruta = await p("   Ruta del archivo (por ejemplo C:\\exportes\\stock.csv)", anterior.fuente?.ruta || "");
    fuente.codificacion = await p("   Codificación (latin1 en casi todos los sistemas viejos de Windows; utf8 si es nuevo)", anterior.fuente?.codificacion || "latin1");
    const maximo = Number(await p("   Si el archivo tiene más de estos minutos sin cambiar, no se manda (0 = sin límite)", anterior.fuente?.maximoMinutos ?? 180));
    if (maximo > 0) fuente.maximoMinutos = maximo;
  } else {
    fuente.tipo = "comando";
    fuente.comando = await p("   El comando (o la ruta de un .bat que lo corra; ver la carpeta ejemplos)", anterior.fuente?.comando || "");
    fuente.codificacion = await p("   Codificación de lo que escribe", anterior.fuente?.codificacion || "latin1");
    fuente.timeoutSegundos = Number(await p("   Segundos como máximo que puede tardar", anterior.fuente?.timeoutSegundos || 120)) || 120;
  }
  const cadaMinutos = Math.max(1, Number(await p("7. Cada cuántos minutos se manda el stock", anterior.cadaMinutos || 15)) || 15);
  const ventasSi = /^s/i.test(await p("8. ¿Bajar las ventas de la tienda a una carpeta, para cargarlas en tu sistema? (s/n)", anterior.ventas?.activar ? "s" : "n"));
  const config = { url, clave: clave === "(la de antes)" ? anterior.clave : clave, origen, equipo, sede, cadaMinutos, fuente };
  if (ventasSi) config.ventas = { activar: true, carpeta: await p("   Carpeta para las ventas", anterior.ventas?.carpeta || "C:\\ventas-de-la-tienda") };
  else config.ventas = { activar: false, carpeta: "" };
  fs.writeFileSync(ruta, JSON.stringify(config, null, 2));
  escribir(`\nGuardado en ${ruta}. Ahora corre «node agente-puente.mjs --doctor» para revisar que todo funcione.`);
  if (config.clave) escribir("La clave quedó en ese archivo: no lo compartas ni lo mandes por chat.");
  return config;
}

function preguntarPorConsola() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const preguntar = (texto) => new Promise((r) => rl.question(texto, r));
  return { preguntar, cerrar: () => rl.close() };
}

/* ── Doctor: revisa todo y dice qué falla ───────────────────────────── */

const COLUMNA_CANTIDAD = /cant|stock|exist|qty|quantity|unidades|disponible|saldo/i;
const COLUMNA_NOMBRE = /produ|descrip|nombre|art[ií]culo|item|modelo|t[ií]tulo|c[oó]d|sku|ref|barra|ean/i;

// Devuelve [{ ok: true|false|null, nombre, detalle }]. null = aviso, no error.
export async function doctor(config, { hacer = globalThis.fetch, esperar = pausa, ejecutar = ejecutarPrograma, plataforma = process.platform } = {}) {
  const r = [];
  const anotar = (ok, nombre, detalle = "") => r.push({ ok, nombre, detalle: sinSecretos(detalle, secretosDe(config)) });
  const mayor = Number(process.versions.node.split(".")[0]);
  anotar(mayor >= 18, `Node.js ${process.versions.node}`, mayor >= 18 ? "" : "Hace falta Node 18 o más: instálalo desde https://nodejs.org (la versión LTS).");
  const problemas = problemasDeConfig(config);
  anotar(!problemas.length, "La configuración (config.json)", problemas.join(" "));
  try {
    fs.accessSync(config.carpeta, fs.constants.W_OK);
    anotar(true, "Puede escribir su registro en esta carpeta");
  } catch {
    anotar(false, "Puede escribir su registro en esta carpeta", `No puede escribir en ${config.carpeta}: mueve la carpeta a un sitio propio, por ejemplo C:\\agente-puente.`);
  }
  if (problemas.length) return r;

  // La tienda.
  let tiendaBien = false;
  try {
    const e = await llamar(config, "/api/sync/estado", {}, { hacer, esperar, intentos: 1 });
    tiendaBien = e.estado === 200 && e.cuerpo?.ok;
    anotar(tiendaBien, `La tienda contesta (${new URL(config.url).host})`, tiendaBien ? `${e.cuerpo.productos} productos en su inventario` : errorDeLaTienda(e, "No").message);
  } catch (error) {
    anotar(false, "La tienda contesta", error.message);
  }

  // La fuente.
  let leido = null;
  try {
    leido = await leerFuente(config);
    const lineas = leido.texto.split("\n");
    const encabezado = lineas[0] || "";
    anotar(lineas.length > 1, "Se puede leer el stock del sistema", lineas.length > 1 ? `${lineas.length - 1} filas; columnas: ${encabezado.slice(0, 160)}` : "No trajo ninguna fila.");
    const columnas = encabezado.split(/[;,\t|]/).map((c) => c.trim());
    if (!columnas.some((c) => COLUMNA_CANTIDAD.test(c))) anotar(null, "Columna de la cantidad", "No veo una columna de cantidad (cantidad, stock, existencia…). La tienda la necesita para saber cuánto hay.");
    if (!columnas.some((c) => COLUMNA_NOMBRE.test(c))) anotar(null, "Columna del producto", "No veo una columna con el código o el nombre del producto.");
    if (/\uFFFD/.test(leido.texto)) anotar(null, "Las tildes", 'Hay letras raras (�): prueba con "codificacion": "latin1" (o "utf8" si ya estaba en latin1).');
  } catch (error) {
    anotar(false, "Se puede leer el stock del sistema", error.message);
  }

  // Una prueba de verdad, sin guardar nada.
  if (tiendaBien && leido) {
    try {
      const c = await ciclo(config, { probar: true, hacer, esperar, registrar: () => {} });
      const i = c.informe || {};
      anotar(true, "Prueba completa (sin guardar nada)", `la tienda entendió ${c.filas ?? c.filasLeidas} filas${i.nuevos ? `; crearía ${i.nuevos} productos nuevos` : ""}${i.errores?.length ? `; ${i.errores.length} con problemas, por ejemplo: ${i.errores[0]}` : ""}`);
    } catch (error) {
      anotar(false, "Prueba completa (sin guardar nada)", error.message);
    }
  }

  // ¿Está instalado para correr solo?
  const instalado = await estaInstalado({ ejecutar, plataforma });
  anotar(instalado ? true : null, "Corre solo (tarea programada)", instalado ? "" : "Todavía no: corre «node agente-puente.mjs --instalar» (en Windows, como administrador).");
  return r;
}

export function textoDelDoctor(resultado) {
  const lineas = resultado.map((x) => `${x.ok === true ? "✅" : x.ok === false ? "❌" : "⚠️ "} ${x.nombre}${x.detalle ? `\n     ${x.detalle}` : ""}`);
  const malos = resultado.filter((x) => x.ok === false).length;
  lineas.push("", malos ? `Hay ${malos} cosa(s) que arreglar (las ❌).` : "Todo bien. ✔");
  return lineas.join("\n");
}

/* ── Instalar para que corra solo ───────────────────────────────────── */

function ejecutarPrograma(programa, args = [], { heredar = false } = {}) {
  return new Promise((resolve) => {
    const hijo = spawn(programa, args, { stdio: heredar ? "inherit" : "pipe", windowsHide: true });
    let salida = "";
    hijo.stdout?.on("data", (d) => (salida += d));
    hijo.stderr?.on("data", (d) => (salida += d));
    hijo.on("error", (error) => resolve({ codigo: -1, salida: error.message }));
    hijo.on("close", (codigo) => resolve({ codigo, salida }));
  });
}

function xml(texto) {
  return String(texto).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// La tarea de Windows en XML: cada minuto, para siempre, sin pararse con la
// batería, sin ventana, una sola a la vez, y cortada si pasa de 30 min.
export function tareaDeWindows({ node = process.execPath, script = path.join(AQUI, "agente-puente.mjs"), config = path.join(AQUI, "config.json"), usuario = "" } = {}) {
  const principal = usuario
    ? `<UserId>${xml(usuario)}</UserId><LogonType>Password</LogonType><RunLevel>HighestAvailable</RunLevel>`
    : `<UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel>`;
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Agente puente: le pasa el stock del sistema de inventario al bot de la tienda.</Description></RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <Repetition><Interval>PT1M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition>
      <StartBoundary>2026-01-01T00:00:00</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals><Principal id="Author">${principal}</Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <ExecutionTimeLimit>PT30M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xml(node)}</Command>
      <Arguments>${xml(`"${script}" --vuelta --config "${config}"`)}</Arguments>
      <WorkingDirectory>${xml(path.dirname(script))}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

// La línea de cron (Linux y Mac): cada minuto.
export function lineaDeCron({ node = process.execPath, script = path.join(AQUI, "agente-puente.mjs"), config = path.join(AQUI, "config.json") } = {}) {
  const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
  return `* * * * * ${q(node)} ${q(script)} --vuelta --config ${q(config)} >/dev/null 2>&1 # agente-puente`;
}

export async function estaInstalado({ ejecutar = ejecutarPrograma, plataforma = process.platform } = {}) {
  if (plataforma === "win32") return (await ejecutar("schtasks", ["/Query", "/TN", NOMBRE_DE_LA_TAREA])).codigo === 0;
  const r = await ejecutar("crontab", ["-l"]);
  return r.codigo === 0 && /# agente-puente/.test(r.salida);
}

export async function instalar({ rutaConfig, usuario = "", ejecutar = ejecutarPrograma, plataforma = process.platform, escribir = console.log, carpetaTemporal = os.tmpdir() } = {}) {
  const script = path.join(AQUI, "agente-puente.mjs");
  const config = path.resolve(rutaConfig);
  if (plataforma === "win32") {
    const archivo = path.join(carpetaTemporal, "agente-puente-tarea.xml");
    // schtasks lee bien el XML en UTF-16 con su marca (BOM).
    fs.writeFileSync(archivo, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(tareaDeWindows({ script, config, usuario }), "utf16le")]));
    const args = ["/Create", "/F", "/TN", NOMBRE_DE_LA_TAREA, "/XML", archivo];
    if (usuario) args.push("/RU", usuario, "/RP", "*");
    const r = await ejecutar("schtasks", args, { heredar: Boolean(usuario) });
    try {
      fs.unlinkSync(archivo);
    } catch {}
    if (r.codigo !== 0) {
      escribir(`No se pudo crear la tarea: ${String(r.salida || "").trim()}\n¿Abriste la ventana como administrador? (clic derecho › Ejecutar como administrador)`);
      return false;
    }
    escribir(`Listo: la tarea «${NOMBRE_DE_LA_TAREA}» corre cada minuto${usuario ? ` con la cuenta ${usuario}` : " como SYSTEM"}, aunque nadie inicie sesión y aunque se reinicie la PC.`);
    if (!usuario) escribir("Ojo: como SYSTEM no ve las unidades de red con letra (Z:\\…). Si tu archivo está en una, usa la ruta \\\\servidor\\carpeta o instala con --usuario TU_USUARIO.");
    await ejecutar("schtasks", ["/Run", "/TN", NOMBRE_DE_LA_TAREA]);
    return true;
  }
  const actual = await ejecutar("crontab", ["-l"]);
  const lineas = (actual.codigo === 0 ? actual.salida : "").split("\n").filter((l) => l.trim() && !/# agente-puente/.test(l));
  lineas.push(lineaDeCron({ script, config }));
  const r = await escribirCrontab(lineas.join("\n") + "\n", ejecutar);
  if (r.codigo !== 0) {
    escribir(`No se pudo instalar en cron: ${r.salida}. Añade a mano esta línea con «crontab -e»:\n${lineaDeCron({ script, config })}`);
    return false;
  }
  escribir("Listo: quedó en cron, cada minuto.");
  return true;
}

function escribirCrontab(contenido, ejecutar) {
  if (ejecutar !== ejecutarPrograma) return ejecutar("crontab", ["-"], { entrada: contenido });
  return new Promise((resolve) => {
    const hijo = spawn("crontab", ["-"], { stdio: ["pipe", "pipe", "pipe"] });
    let salida = "";
    hijo.stderr.on("data", (d) => (salida += d));
    hijo.on("error", (error) => resolve({ codigo: -1, salida: error.message }));
    hijo.on("close", (codigo) => resolve({ codigo, salida }));
    hijo.stdin.end(contenido);
  });
}

export async function desinstalar({ ejecutar = ejecutarPrograma, plataforma = process.platform, escribir = console.log } = {}) {
  if (plataforma === "win32") {
    const r = await ejecutar("schtasks", ["/Delete", "/F", "/TN", NOMBRE_DE_LA_TAREA]);
    escribir(r.codigo === 0 ? `Listo: se quitó la tarea «${NOMBRE_DE_LA_TAREA}».` : `No estaba instalada o no se pudo quitar: ${String(r.salida || "").trim()}`);
    return r.codigo === 0;
  }
  const actual = await ejecutar("crontab", ["-l"]);
  const lineas = (actual.codigo === 0 ? actual.salida : "").split("\n").filter((l) => l.trim() && !/# agente-puente/.test(l));
  const r = await escribirCrontab(lineas.length ? lineas.join("\n") + "\n" : "", ejecutar);
  escribir(r.codigo === 0 ? "Listo: se quitó de cron." : `No se pudo: ${r.salida}`);
  return r.codigo === 0;
}

/* ── --estado ───────────────────────────────────────────────────────── */

export function textoDelEstado(config) {
  const e = leerEstado(config);
  const l = [];
  l.push(`Agente puente ${VERSION} · ${config.agente} · tienda ${config.url || "(sin configurar)"}`);
  l.push(e.ultimoOk ? `Último conteo bueno: ${marcaDeTiempo(e.ultimoOk)} (${e.ultimoMensaje || `${e.filas} filas`})` : "Todavía no hay ningún conteo bueno.");
  if (e.ultimoErrorEn && (!e.ultimoOk || e.ultimoErrorEn > e.ultimoOk)) l.push(`Último error: ${marcaDeTiempo(e.ultimoErrorEn)} — ${e.ultimoError}`);
  if (e.proximaSync) l.push(`Próximo conteo: ${marcaDeTiempo(e.proximaSync)}`);
  try {
    const registro = fs.readFileSync(rutaDe(config, "puente.log"), "utf8").trim().split("\n").slice(-15);
    l.push("", "Últimas líneas del registro (puente.log):", ...registro);
  } catch {}
  return l.join("\n");
}

/* ── Arranque ───────────────────────────────────────────────────────── */

async function principal() {
  const args = process.argv.slice(2);
  const valor = (n) => {
    const i = args.indexOf(n);
    return i !== -1 ? args[i + 1] : undefined;
  };
  const ruta = path.resolve(valor("--config") || path.join(AQUI, "config.json"));
  const tiene = (n) => args.includes(n);

  if (tiene("--version")) return console.log(VERSION);
  if (tiene("--ayuda") || tiene("--help") || tiene("-h")) {
    const cabecera = fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).slice(0, 42);
    return console.log(cabecera.map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  }
  if (tiene("--configurar")) {
    let anterior = {};
    try {
      anterior = JSON.parse(fs.readFileSync(ruta, "utf8"));
    } catch {}
    const consola = preguntarPorConsola();
    try {
      await configurar({ ruta, preguntar: consola.preguntar, anterior });
    } finally {
      consola.cerrar();
    }
    return;
  }
  if (tiene("--desinstalar")) {
    if (!(await desinstalar())) process.exitCode = 1;
    return;
  }

  const config = leerConfig(ruta);
  const registrar = crearRegistro({ archivo: rutaDe(config, "puente.log"), secretos: secretosDe(config) });

  if (tiene("--estado")) return console.log(textoDelEstado(config));
  if (tiene("--doctor") || tiene("--diagnostico")) {
    console.log(`Agente puente ${VERSION}: revisando…\n`);
    const resultado = await doctor(config);
    console.log(textoDelDoctor(resultado));
    if (resultado.some((x) => x.ok === false)) process.exitCode = 1;
    return;
  }
  if (tiene("--instalar")) {
    const problemas = problemasDeConfig(config);
    if (problemas.length) {
      console.error(`Antes de instalar, arregla config.json:\n- ${problemas.join("\n- ")}`);
      process.exitCode = 1;
      return;
    }
    if (!(await instalar({ rutaConfig: ruta, usuario: valor("--usuario") || "" }))) process.exitCode = 1;
    return;
  }
  const problemas = problemasDeConfig(config);
  if (problemas.length) {
    registrar(`La configuración tiene problemas: ${problemas.join(" ")}`, { error: true });
    process.exitCode = 1;
    return;
  }
  if (tiene("--probar")) {
    try {
      const c = await ciclo(config, { probar: true, registrar });
      console.log(JSON.stringify(c.informe || c, null, 2));
    } catch (error) {
      registrar(`❌ ${error.message}`, { error: true });
      process.exitCode = 1;
    }
    return;
  }
  if (tiene("--una-vez") || tiene("--vuelta")) {
    if (!tomarCandado(config)) {
      registrar("Otra vuelta sigue corriendo; esta se salta.");
      return;
    }
    try {
      const r = await vuelta(config, { forzar: tiene("--una-vez"), modo: tiene("--vuelta") ? "continuo" : "una-vez", registrar });
      if (!r.ok && tiene("--una-vez")) process.exitCode = 1;
    } finally {
      soltarCandado(config);
    }
    return;
  }
  // Sin nada: corre para siempre en esta ventana.
  if (!tomarCandado(config)) {
    registrar("Ya hay un agente corriendo en esta carpeta (la tarea programada u otra ventana). Si no, borra puente.lock.");
    process.exitCode = 1;
    return;
  }
  const soltar = () => {
    soltarCandado(config);
    process.exit(0);
  };
  process.on("SIGINT", soltar);
  process.on("SIGTERM", soltar);
  await correrSiempre(config, { registrar, alEmpezar: () => renovarCandado(config) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal().catch((error) => {
    console.error(`❌ ${sinSecretos(error.message)}`);
    process.exitCode = 1;
  });
}
