#!/usr/bin/env node
// AGENTE PUENTE (15-oct-2026): el programita que corre en la PC o el servidor
// del cliente, junto a su sistema de inventario CERRADO (el que no tiene API),
// y le pasa el stock al bot de la tienda. Sin instalar nada: solo Node 18 o más.
//
// Qué hace, cada N minutos:
//   1. Saca el stock del sistema de una de dos formas (ver config.json):
//        · "archivo": lee el CSV/Excel-CSV que el sistema exporta (a mano o
//          programado) a una carpeta;
//        · "comando": corre un comando que escribe el stock por pantalla
//          (sqlcmd para SQL Server, mysql, psql, sqlite3, PowerShell con ODBC…).
//   2. Lo manda a  <url>/api/sync/inventario  con la clave (SYNC_CLAVE).
//   3. Si es grande, pide las tandas hasta que termine.
//   4. (Opcional) baja las ventas de la tienda a una carpeta, en CSV, para
//      cargarlas en el sistema cerrado con su importador de Excel.
//
// Uso:
//   node agente-puente.mjs                  corre para siempre, cada "cadaMinutos"
//   node agente-puente.mjs --una-vez        una sola vez y sale (para el Programador de tareas)
//   node agente-puente.mjs --probar         manda con ?probar=1: dice qué haría y NO guarda nada
//   node agente-puente.mjs --config otro.json
//
// La clave NUNCA va en el archivo si no quieres: puede ir en la variable de
// entorno SYNC_CLAVE. El agente no la imprime en ninguna parte.

import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { pathToFileURL } from "node:url";

const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

function pausa(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .filter((l) => !/^[-=;,\s|+]+$/.test(l))
    .filter((l) => !/^\(\d+\s+(rows?|filas?)[^)]*\)$/i.test(l.trim()));
  return lineas.join("\n");
}

function correr(comando, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    exec(comando, { encoding: "buffer", maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs, windowsHide: true }, (error, salida, errores) => {
      if (error) {
        const detalle = decodificar(errores || Buffer.alloc(0)).trim().slice(0, 300);
        reject(new Error(`El comando falló (${error.code ?? "?"}): ${detalle || error.message}`));
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
    const estado = fs.statSync(f.ruta);
    if (f.maximoMinutos && Date.now() - estado.mtimeMs > f.maximoMinutos * 60000) {
      throw new Error(`El archivo es viejo (de ${new Date(estado.mtimeMs).toLocaleString()}). Si el sistema ya no lo actualiza, no se manda.`);
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

function claveDe(config) {
  return String(process.env.SYNC_CLAVE || config.clave || "");
}

async function llamar(config, ruta, opciones = {}, hacer = globalThis.fetch) {
  const base = String(config.url || "").replace(/\/+$/, "");
  if (!base) throw new Error('Falta "url" (la dirección del bot, sin barra final).');
  const clave = claveDe(config);
  if (!clave) throw new Error('Falta la clave: ponla en "clave" o en la variable SYNC_CLAVE.');
  const respuesta = await hacer(`${base}${ruta}`, { ...opciones, headers: { authorization: `Bearer ${clave}`, ...(opciones.headers || {}) } });
  const texto = await respuesta.text();
  let cuerpo = null;
  try {
    cuerpo = JSON.parse(texto);
  } catch {}
  return { estado: respuesta.status, cuerpo, texto };
}

// Un ciclo: saca el stock, lo manda, y espera a que termine.
export async function ciclo(config, { probar = false, hacer = globalThis.fetch, registrar = console.log, esperar = pausa } = {}) {
  const { texto, generado } = await leerFuente(config);
  const filas = texto.split("\n").length - 1;
  if (filas < 1) throw new Error("La fuente no devolvió ninguna fila (¿el comando o el archivo están bien?).");
  const consulta = new URLSearchParams({ origen: config.origen || "", generado: String(Math.round(generado)) });
  if (config.sede) consulta.set("sede", config.sede);
  if (probar) consulta.set("probar", "1");
  registrar(`Mandando ${filas} filas${probar ? " (solo probar)" : ""}…`);

  let r;
  for (let intento = 0; intento < 30; intento++) {
    r = await llamar(config, `/api/sync/inventario?${consulta}`, { method: "POST", headers: { "content-type": "text/csv; charset=utf-8" }, body: texto }, hacer);
    if (r.estado !== 409) break;
    registrar("Hay otro conteo a medias en la tienda; espero un minuto…");
    await esperar(60000);
  }
  if (!r.cuerpo?.ok) throw new Error(`La tienda no lo aceptó (${r.estado}): ${r.cuerpo?.error || r.texto.slice(0, 200)}`);
  let c = r.cuerpo;
  if (c.sinCambios && !c.trabajo) {
    registrar(`Nada cambió (${c.sinCambios} filas iguales).`);
    return c;
  }
  // Por tandas: se pide la siguiente hasta que termine.
  for (let vuelta = 0; c.estado === "trabajando" && vuelta < 2000; vuelta++) {
    registrar(`  …${c.hechos} de ${c.total} partes`);
    const a = await llamar(config, `/api/sync/avanzar?trabajo=${c.trabajo}`, { method: "POST" }, hacer);
    if (!a.cuerpo?.ok) throw new Error(`No pude avanzar (${a.estado}): ${a.cuerpo?.error || a.texto.slice(0, 200)}`);
    c = { ...c, ...a.cuerpo };
    if (c.estado === "trabajando") await esperar(500);
  }
  const i = c.informe || {};
  registrar(`Listo: ${c.filas ?? filas} filas leídas${c.sinCambios ? `, ${c.sinCambios} sin cambios` : ""}${i.nuevos ? `, ${i.nuevos} productos nuevos` : ""}${i.errores?.length ? `, ${i.errores.length} con problemas` : ""}.`);
  for (const e of (i.errores || []).slice(0, 10)) registrar(`  ⚠ ${e}`);
  return c;
}

// Las ventas de la tienda, a una carpeta, para cargarlas en el sistema cerrado.
export async function bajarVentas(config, { hacer = globalThis.fetch, registrar = console.log } = {}) {
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
  const nuevas = await llamar(config, `/api/sync/ventas?formato=json&desde_id=${ultimo}`, {}, hacer);
  if (!nuevas.cuerpo?.ok) throw new Error(`No pude bajar las ventas (${nuevas.estado}): ${nuevas.cuerpo?.error || ""}`);
  if (nuevas.cuerpo.ventas.length) {
    const csv = await llamar(config, `/api/sync/ventas?desde_id=${ultimo}`, {}, hacer);
    const maximo = Math.max(...nuevas.cuerpo.ventas.map((x) => x.id));
    fs.writeFileSync(path.join(v.carpeta, `ventas-nuevas-${maximo}.csv`), csv.texto);
    fs.writeFileSync(archivoDeEstado, JSON.stringify({ ultimoId: maximo }));
    registrar(`Ventas: ${nuevas.cuerpo.ventas.length} líneas nuevas en ventas-nuevas-${maximo}.csv`);
  }
  // …y siempre los últimos 3 días completos (ahí se ven las ANULADAS).
  const recientes = await llamar(config, "/api/sync/ventas", {}, hacer);
  if (recientes.estado === 200) fs.writeFileSync(path.join(v.carpeta, "ventas-ultimos-3-dias.csv"), recientes.texto);
  return nuevas.cuerpo.ventas.length;
}

function leerConfig(ruta) {
  try {
    return JSON.parse(fs.readFileSync(ruta, "utf8").replace(/^﻿/, ""));
  } catch (error) {
    throw new Error(`No pude leer ${ruta}: ${error.message}. Copia config.ejemplo.json como config.json y complétalo.`);
  }
}

async function principal() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--config");
  const ruta = i !== -1 ? args[i + 1] : path.join(AQUI, "config.json");
  const unaVez = args.includes("--una-vez");
  const probar = args.includes("--probar");
  const config = leerConfig(ruta);
  const cada = Math.max(1, Number(config.cadaMinutos) || 15);
  const hora = () => new Date().toLocaleTimeString();
  const registrar = (m) => console.log(`[${hora()}] ${m}`);
  do {
    try {
      await ciclo(config, { probar, registrar });
      if (!probar) await bajarVentas(config, { registrar });
    } catch (error) {
      console.error(`[${hora()}] ❌ ${error.message}`);
      if (unaVez) process.exitCode = 1;
    }
    if (unaVez) break;
    await pausa(cada * 60000);
  } while (true);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await principal();
