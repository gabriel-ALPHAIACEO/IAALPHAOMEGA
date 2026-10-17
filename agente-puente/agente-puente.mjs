#!/usr/bin/env node
// AGENTE PUENTE v2.2 (16-oct-2026). ABIERTO A CUALQUIER TIENDA Y A CUALQUIER
// SISTEMA DE INVENTARIO que esté instalado en una computadora. Funciona solo,
// aparte de los bots: necesita Node 18 o más y esta carpeta, nada más.
//
// DE DÓNDE LEE (fuente, ver lib/fuentes.mjs): un archivo que exporta el
// sistema (CSV, TXT, Excel .xlsx o JSON), el más nuevo de una carpeta, o un
// comando que consulta su base de datos (SQL Server, MySQL, PostgreSQL,
// SQLite, Access/DBF/Firebird por ODBC…). Las columnas se reconocen solas
// («Existencia», «Stock», «Qty»…) o se dicen en "columnas" (lib/columnas.mjs).
//
// A DÓNDE MANDA (destinos, ver lib/destinos.mjs), a uno o a varios a la vez:
//   · una tienda con ALPHA IA (el bot y su panel), con latido, «Sincronizar
//     ahora» desde el panel, ventas de vuelta y avisos;
//   · CUALQUIER otra plataforma que reciba datos en una dirección (JSON o CSV,
//     con su clave y firma opcional: ver PROTOCOLO.md);
//   · una carpeta (un stock.csv / stock.json limpio, siempre igual).
//
// LAS FOTOS (lib/fotos.mjs): si el sistema las tiene (una columna con la
// dirección o el archivo, o una carpeta con las fotos nombradas por el código),
// se mandan también: solo las nuevas o cambiadas, como mucho 30 por vuelta.
//
// EN CADA VUELTA: latido a las tiendas ALPHA IA (y preguntar si pidieron
// sincronizar) → si toca, leer el stock → mandarlo a cada destino → las fotos →
// bajar las ventas → contar cómo le fue (latido «ok»/«error», y aviso propio si se
// configuró). Tras un error, reintenta a los 5 minutos.
//
// CÓMO SE USA (todo desde esta carpeta):
//   node agente-puente.mjs --configurar     preguntas paso a paso; escribe config.json
//   node agente-puente.mjs --doctor         revisa todo y dice qué falla y cómo arreglarlo
//   node agente-puente.mjs --probar         dice qué mandaría a cada destino, SIN mandar ni guardar nada
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
// LOS SECRETOS (la clave de la tienda, las de las plataformas, la firma, la
// dirección de los avisos) van en config.json o, mejor, en variables de
// entorno de la PC: "${ENV:NOMBRE}". NUNCA salen por pantalla, en el registro,
// en el latido ni en los avisos (lib/secretos.mjs).
//
// LO QUE NO HACE: no acepta comandos de afuera (la única orden que entiende es
// «sincronizar», y sincronizar es lo mismo que haría solo), no escribe ni borra
// nada en el sistema del cliente (solo lee) y no crea ventas en ninguna tienda.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sinSecretos, secretosDe } from "./lib/secretos.mjs";
import { crearRegistro, marcaDeTiempo } from "./lib/registro.mjs";
import { leerFuente } from "./lib/fuentes.mjs";
import { detectarColumnas, textoDeLasColumnas, NOMBRES_DE_CAMPOS, productosDe } from "./lib/columnas.mjs";
import { listaDeDestinos, nombreDelDestino, problemasDelDestino, enviarA, latido as latidoA, bajarVentas as bajarVentasDe, llamar as llamarA, pedir, pausa, errorDeLaTienda, claveDe } from "./lib/destinos.mjs";
import { avisarSiHaceFalta } from "./lib/avisos.mjs";
import { mandarFotos, fotosActivadas, fotosDeLosProductos } from "./lib/fotos.mjs";
import { ejecutarPrograma, estaInstalado, instalar, desinstalar } from "./lib/instalar.mjs";

export * from "./lib/secretos.mjs";
export * from "./lib/registro.mjs";
export * from "./lib/tabla.mjs";
export * from "./lib/excel.mjs";
export * from "./lib/columnas.mjs";
export * from "./lib/fuentes.mjs";
export { listaDeDestinos, nombreDelDestino, problemasDelDestino, enviarA, firmar, enviarWebhook, escribirCarpeta, enviarAlpha, pedir, pausa } from "./lib/destinos.mjs";
export * from "./lib/avisos.mjs";
export * from "./lib/fotos.mjs";
export * from "./lib/instalar.mjs";

export const VERSION = "2.2.0";
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MINUTO = 60 * 1000;
// Pasado este tiempo, un candado (otra vuelta corriendo) se da por muerto.
const CANDADO_VIEJO_MS = 30 * MINUTO;

/* ── La configuración ───────────────────────────────────────────────── */

export function leerConfig(ruta) {
  let config;
  try {
    config = JSON.parse(fs.readFileSync(ruta, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    const motivo = error.code === "ENOENT" ? "no existe" : error.message;
    throw new Error(`No pude leer ${ruta} (${motivo}). Corre «node agente-puente.mjs --configurar» o copia uno de los ejemplos (config.ejemplo.json) como config.json y complétalo.`);
  }
  return completarConfig(config, path.dirname(path.resolve(ruta)));
}

// Lo que no venga en config.json toma su valor normal.
export function completarConfig(config, carpeta = AQUI) {
  return {
    cadaMinutos: 15,
    latidoSegundos: 60,
    ...config,
    agente: String(config.agente || os.hostname() || "puente"),
    equipo: String(config.equipo || os.hostname() || ""),
    carpeta: config.carpeta || carpeta,
  };
}

// Lo que falta o está mal en la configuración (vacío = todo bien).
export function problemasDeConfig(config) {
  const p = [];
  const destinos = listaDeDestinos(config);
  if (!destinos.length) p.push('Falta a dónde mandar el stock: "url" + "clave" (una tienda con ALPHA IA) o "destinos" (cualquier otra plataforma o una carpeta). Ver LEEME.md.');
  for (const d of destinos) p.push(...problemasDelDestino(d));
  const f = config.fuente || {};
  if (f.tipo === "archivo") {
    if (!f.ruta) p.push('Falta "fuente.ruta": dónde deja el sistema el archivo con el stock.');
  } else if (f.tipo === "carpeta") {
    if (!f.carpeta) p.push('Falta "fuente.carpeta": dónde deja el sistema sus archivos.');
  } else if (f.tipo === "comando") {
    if (!f.comando) p.push('Falta "fuente.comando": el comando que escribe el stock por pantalla.');
  } else p.push('"fuente.tipo" tiene que ser "archivo", "carpeta" o "comando".');
  if (config.columnas !== undefined && (typeof config.columnas !== "object" || Array.isArray(config.columnas) || !config.columnas)) p.push('"columnas" tiene que ser un objeto: { "cantidad": "Existencia", "codigo": "Ref" }.');
  else for (const k of Object.keys(config.columnas || {})) if (!NOMBRES_DE_CAMPOS.includes(k)) p.push(`En "columnas", «${k}» no es un campo. Los que hay: ${NOMBRES_DE_CAMPOS.join(", ")}.`);
  for (const d of destinos) if (d.ventas?.activar && !d.ventas.carpeta) p.push(`Las ventas de ${nombreDelDestino(d)} están activadas pero falta "ventas.carpeta".`);
  return p;
}

/* ── Leer el stock y entenderlo ─────────────────────────────────────── */

// La fuente leída y sus columnas reconocidas. Lanza un error claro si no se
// entiende (sin filas, sin cantidad, sin código ni nombre…).
export async function leerStock(config) {
  const { tabla, generado, nombre } = await leerFuente(config);
  if (!tabla.filas.length) throw new Error("La fuente no devolvió ninguna fila (¿el comando o el archivo están bien?).");
  const { indices, problemas, comoSeLeyo } = detectarColumnas(tabla.columnas, config.columnas || {});
  if (problemas.length) throw new Error(problemas.join(" "));
  return { tabla, generado, nombre, indices, comoSeLeyo };
}

// UN CICLO hacia el primer destino (lo de siempre: una tienda ALPHA IA).
// Se queda por compatibilidad: lo usan las pruebas de las tiendas.
export async function ciclo(config, { probar = false, hacer = globalThis.fetch, registrar = console.log, esperar = pausa } = {}) {
  const datos = await leerStock(config);
  const [d] = listaDeDestinos(config);
  if (!d) throw new Error("No hay ningún destino.");
  registrar(`Mandando ${datos.tabla.filas.length} filas a ${nombreDelDestino(d)}${probar ? " (solo probar)" : ""}…`);
  return enviarA(config, d, datos, { probar, hacer, registrar, esperar, version: VERSION });
}

// Compatibilidad: las ventas del primer destino ALPHA IA.
export async function bajarVentas(config, opciones = {}) {
  const d = listaDeDestinos(config).find((x) => x.tipo === "alpha");
  return d ? bajarVentasDe(d, { version: VERSION, ...opciones }) : null;
}

// Compatibilidad: llamar a la tienda de la configuración.
export function llamar(config, ruta, opciones = {}, deps = {}) {
  const d = listaDeDestinos(config).find((x) => x.tipo === "alpha") || { url: config.url, clave: config.clave };
  return llamarA(d, ruta, opciones, { version: VERSION, ...deps });
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
    fs.writeFileSync(ruta, JSON.stringify({ pid: process.pid, desde: ahora }));
    return true;
  }
}

// El que corre siempre lo renueva en cada vuelta: así nunca parece «muerto».
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

function resumen(c) {
  if (c.mensaje && c.probando) return c.mensaje;
  const i = c.informe || {};
  const partes = [`${c.filas ?? c.filasLeidas ?? 0} ${c.informe || c.sinCambios !== undefined || c.trabajo ? "filas" : "productos"}`];
  if (c.sinCambios) partes.push(`${c.sinCambios} sin cambios`);
  if (i.nuevos) partes.push(`${i.nuevos} productos nuevos`);
  if (i.errores?.length) partes.push(`${i.errores.length} filas con problemas`);
  if (c.saltadas) partes.push(`${c.saltadas} filas sin código ni nombre`);
  return partes.join(", ");
}

export function textoDeFotos(f) {
  if (!f || !(f.mandadas || f.pendientes || f.saltadas)) return "";
  const partes = [];
  if (f.mandadas) partes.push(`${f.mandadas} ${f.mandadas === 1 ? "foto mandada" : "fotos mandadas"}`);
  if (f.pendientes) partes.push(`${f.pendientes} fotos para las próximas vueltas`);
  if (f.saltadas) partes.push(`${f.saltadas} ${f.saltadas === 1 ? "foto" : "fotos"} con problemas${f.errores[0] ? ` (${f.errores[0]})` : ""}`);
  return partes.join(", ");
}

// Latido → (si toca) leer el stock → mandarlo a cada destino → latido con el
// resultado de cada tienda ALPHA IA. «forzar» = sincroniza aunque no toque.
// Devuelve { sincronizo, ok, error?, resultados: [{ destino, ok, mensaje }] }.
export async function vuelta(config, { forzar = false, modo = "continuo", hacer = globalThis.fetch, esperar = pausa, registrar = console.log, ahora = Date.now, achicar } = {}) {
  const estado = leerEstado(config);
  const secretos = secretosDe(config);
  const destinos = listaDeDestinos(config);
  const tiendas = destinos.filter((d) => d.tipo === "alpha");
  const cada = Math.max(1, Number(config.cadaMinutos) || 15) * MINUTO;
  const tocaPorTiempo = forzar || !estado.proximaSync || ahora() >= Number(estado.proximaSync);
  const primero = !estado.encendido;
  const deps = { hacer, esperar, registrar, version: VERSION };

  // 1. El latido a cada tienda ALPHA IA (y sus órdenes).
  const ordenes = await Promise.all(
    tiendas.map(async (d) => {
      const r = await latidoA(config, d, { modo, estado: primero ? "inicio" : tocaPorTiempo ? "trabajando" : "espera" }, deps);
      return Number(r?.ordenEn) || 0;
    })
  );
  if (primero) {
    estado.encendido = ahora();
    guardarEstado(config, estado);
  }
  const hayOrden = ordenes.some(Boolean);
  if (hayOrden) registrar("Desde el panel pidieron sincronizar ahora.");
  if (!tocaPorTiempo && !hayOrden) return { sincronizo: false, ok: true, resultados: [] };

  // 2. El stock, una sola vez para todos los destinos.
  const inicio = ahora();
  const resultados = [];
  let datos = null;
  let errorDeLectura = "";
  try {
    datos = await leerStock(config);
    registrar(`Leídas ${datos.tabla.filas.length} filas de ${datos.nombre} (${textoDeLasColumnas(datos.comoSeLeyo)}).`);
  } catch (error) {
    errorDeLectura = sinSecretos(error.message, secretos);
    registrar(`❌ ${errorDeLectura}`, { error: true });
  }

  // 3. A cada destino. Si uno falla, los demás siguen.
  for (const d of destinos) {
    if (!datos) {
      resultados.push({ destino: d, ok: false, mensaje: errorDeLectura });
      continue;
    }
    try {
      const c = await enviarA(config, d, datos, deps);
      let mensaje = resumen(c);
      if (d.tipo === "alpha" && d.ventas?.activar) {
        try {
          const ventas = await bajarVentasDe(d, deps);
          if (ventas) mensaje += `; ${ventas} ventas bajadas`;
        } catch (error) {
          // Las ventas fallaron pero el stock entró: se dice, sin marcar el conteo como malo.
          registrar(`⚠ Ventas: ${error.message}`, { error: true });
          mensaje += `; las ventas no se pudieron bajar: ${error.message}`;
        }
      }
      resultados.push({ destino: d, ok: true, mensaje, filas: c.filas ?? c.filasLeidas ?? 0, sinCambios: c.sinCambios || 0 });
    } catch (error) {
      const mensaje = sinSecretos(error.message, secretos);
      registrar(`❌ ${nombreDelDestino(d)}: ${mensaje}`, { error: true });
      resultados.push({ destino: d, ok: false, mensaje });
    }
  }

  // 3b. Las fotos (si el sistema las tiene), a los destinos que recibieron bien
  //     el stock. Un problema con una foto no hace malo el conteo: se cuenta.
  if (datos) {
    try {
      const f = await mandarFotos(config, datos, resultados.filter((x) => x.ok).map((x) => x.destino), { ...deps, ahora: ahora(), ...(achicar ? { achicar } : {}) });
      const texto = textoDeFotos(f);
      if (texto) for (const x of resultados) if (x.ok) x.mensaje += `; ${texto}`;
    } catch (error) {
      registrar(`⚠ Fotos: ${sinSecretos(error.message, secretos)}`, { error: true });
    }
  }

  // 4. Cómo le fue, a cada tienda ALPHA IA (la orden se da por atendida aunque
  //    haya fallado: el error sale en el panel y no se reintenta cada minuto).
  for (const [n, d] of tiendas.entries()) {
    const r = resultados.find((x) => x.destino === d);
    await latidoA(
      config,
      d,
      r.ok
        ? { modo, estado: "ok", ciclo: true, mensaje: r.mensaje.slice(0, 300), filas: r.filas, sinCambios: r.sinCambios, ordenHecha: ordenes[n] || undefined }
        : { modo, estado: "error", ciclo: true, mensaje: sinSecretos(r.mensaje, secretos).slice(0, 300), ordenHecha: ordenes[n] || undefined },
      deps
    );
  }

  const malos = resultados.filter((r) => !r.ok);
  const ok = !malos.length;
  // Con un solo destino que no es una tienda ALPHA IA, el error también dice
  // a quién (el de la tienda ya lo dice: «La tienda no lo aceptó…»).
  const conQuien = (r) => (resultados.length > 1 || r.destino.tipo !== "alpha" ? `${nombreDelDestino(r.destino)}: ${r.mensaje}` : r.mensaje);
  const textoDelError = malos.map(conQuien).join(" · ");
  const textoBueno = resultados.map((r) => (resultados.length > 1 ? `${nombreDelDestino(r.destino)}: ${r.mensaje}` : r.mensaje)).join(" · ");
  if (ok) Object.assign(estado, { ultimaSync: inicio, proximaSync: inicio + cada, ultimoOk: inicio, ultimoMensaje: textoBueno, errorSeguido: 0 });
  else Object.assign(estado, { ultimaSync: inicio, proximaSync: inicio + Math.min(cada, 5 * MINUTO), ultimoError: textoDelError, ultimoErrorEn: inicio, errorSeguido: (Number(estado.errorSeguido) || 0) + 1 });
  // 5. El aviso propio (si se configuró): para las plataformas que no avisan solas.
  await avisarSiHaceFalta(config, estado, ok ? { ok, mensaje: textoBueno } : { ok, mensaje: textoDelError }, { hacer, registrar, ahora: ahora() });
  guardarEstado(config, estado);
  return ok ? { sincronizo: true, ok, resultados } : { sincronizo: true, ok, error: textoDelError, resultados };
}

// Corre para siempre: una vuelta por minuto (latidoSegundos).
export async function correrSiempre(config, opciones = {}) {
  const { registrar = console.log, esperar = pausa, vueltas = Infinity } = opciones;
  registrar(`Agente puente ${VERSION} corriendo. Manda el stock cada ${config.cadaMinutos} min a ${listaDeDestinos(config).map(nombreDelDestino).join(", ")}. Ctrl+C para parar.`);
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

// «preguntar(texto, porDefecto)» devuelve la respuesta (se puede cambiar en las
// pruebas). Escribe config.json en «ruta» y devuelve la configuración.
export async function configurar({ ruta, preguntar, escribir = console.log, anterior = {} } = {}) {
  escribir("\nVamos a configurar el agente puente. Enter deja lo que está entre corchetes.\n");
  const p = async (texto, porDefecto = "") => String((await preguntar(`${texto}${porDefecto !== "" ? ` [${porDefecto}]` : ""}: `, porDefecto)) ?? "").trim() || String(porDefecto);
  const elegir = async (texto, opciones, porDefecto) => {
    for (;;) {
      const r = (await p(texto, porDefecto)).toLowerCase();
      if (opciones.includes(r)) return r;
      escribir(`   Contesta ${opciones.join(", ")}.`);
    }
  };
  const direccion = async (texto, porDefecto) => {
    for (;;) {
      const u = (await p(texto, porDefecto)).replace(/\/+$/, "");
      if (/^https:\/\//i.test(u) || /^http:\/\/(127\.0\.0\.1|localhost)/i.test(u)) return u;
      escribir("   Tiene que empezar por https://");
    }
  };
  const config = {};
  const antes = listaDeDestinos(anterior)[0] || {};

  // 1. A dónde.
  const destino = await elegir(
    "1. ¿A dónde va el stock?\n   1 = una tienda con ALPHA IA (el bot y su panel)\n   2 = otra plataforma o tienda (una dirección que recibe los datos: su API, Zapier, Make, n8n…)\n   3 = solo dejar un archivo en una carpeta\n  ",
    ["1", "2", "3"],
    antes.tipo === "webhook" ? "2" : antes.tipo === "carpeta" ? "3" : "1"
  );
  if (destino === "1") {
    config.url = (await direccion("   Dirección de la tienda (https://…workers.dev)", antes.url || "")).replace(/\/api\/sync.*$/i, "");
    const clave = await p("   La clave de la conexión (la SYNC_CLAVE de la tienda; vacío = se lee de la variable SYNC_CLAVE de esta PC)", anterior.clave ? "(la de antes)" : "");
    config.clave = clave === "(la de antes)" ? anterior.clave : clave;
  } else if (destino === "2") {
    const d = { tipo: "webhook" };
    d.url = await direccion("   La dirección que recibe los datos", antes.url || "");
    d.formato = await elegir("   ¿En qué formato? json o csv", ["json", "csv"], antes.formato || "json");
    const cabecera = await p("   Nombre de la cabecera para la clave de esa plataforma (por ejemplo Authorization o X-Api-Key; vacío = ninguna)", Object.keys(antes.cabeceras || {})[0] || "");
    if (cabecera) {
      const valor = await p(`   Valor de ${cabecera} (mejor como \${ENV:NOMBRE_DE_LA_VARIABLE} para no dejarlo escrito aquí)`, antes.cabeceras?.[cabecera] || "");
      d.cabeceras = { [cabecera]: valor };
    }
    const firma = await p("   Clave para firmar cada envío (opcional; la plataforma la usa para comprobar que viene de aquí — ver PROTOCOLO.md)", antes.secretoFirma || "");
    if (firma) d.secretoFirma = firma;
    config.destinos = [d];
  } else {
    const d = { tipo: "carpeta" };
    d.carpeta = await p("   La carpeta donde dejar el archivo", antes.carpeta || "C:\\stock-para-la-tienda");
    d.formato = await elegir("   ¿En qué formato? csv o json", ["csv", "json"], antes.formato || "csv");
    config.destinos = [d];
  }

  // 2. Quién es.
  config.origen = await p("2. Nombre de tu sistema de inventario (sale en los movimientos y los avisos)", anterior.origen || "Mi sistema");
  config.equipo = await p("3. Nombre de esta PC (para reconocerla)", anterior.equipo || os.hostname());
  if (destino === "1") config.sede = await p("4. Sede de la tienda a la que va este stock (vacío = la que diga el archivo, o la principal)", anterior.sede || "");

  // 3. De dónde.
  const tipo = await elegir(
    "5. ¿De dónde sale el stock?\n   1 = un archivo que exporta el sistema (CSV, TXT, Excel .xlsx o JSON)\n   2 = una carpeta donde deja un archivo nuevo cada vez (se toma el más nuevo)\n   3 = un comando o consulta a su base de datos\n  ",
    ["1", "2", "3"],
    anterior.fuente?.tipo === "carpeta" ? "2" : anterior.fuente?.tipo === "comando" ? "3" : "1"
  );
  const fuente = {};
  if (tipo === "1") {
    fuente.tipo = "archivo";
    fuente.ruta = await p("   Ruta del archivo (por ejemplo C:\\exportes\\stock.xlsx)", anterior.fuente?.ruta || "");
    if (/\.xlsx$/i.test(fuente.ruta)) {
      const hoja = await p("   ¿Qué hoja del Excel? (vacío = la primera)", anterior.fuente?.hoja || "");
      if (hoja) fuente.hoja = hoja;
    }
  } else if (tipo === "2") {
    fuente.tipo = "carpeta";
    fuente.carpeta = await p("   La carpeta", anterior.fuente?.carpeta || "");
    fuente.patron = await p("   Qué archivos (por ejemplo *.csv o stock_*.xlsx)", anterior.fuente?.patron || "*.csv");
  } else {
    fuente.tipo = "comando";
    fuente.comando = await p("   El comando (o la ruta de un .bat que lo corra; ver la carpeta ejemplos)", anterior.fuente?.comando || "");
    fuente.timeoutSegundos = Number(await p("   Segundos como máximo que puede tardar", anterior.fuente?.timeoutSegundos || 120)) || 120;
  }
  if (tipo !== "3") {
    const maximo = Number(await p("   Si el archivo tiene más de estos minutos sin cambiar, no se manda (0 = sin límite)", anterior.fuente?.maximoMinutos ?? 180));
    if (maximo > 0) fuente.maximoMinutos = maximo;
  }
  config.fuente = fuente;

  // 4. Las columnas: se lee una vez para enseñar cómo se entendió.
  config.columnas = { ...(anterior.columnas || {}) };
  try {
    const { tabla } = await leerFuente(config);
    const { indices, comoSeLeyo } = detectarColumnas(tabla.columnas, config.columnas);
    escribir(`\n   Leí ${tabla.filas.length} filas. Columnas: ${tabla.columnas.join(", ")}`);
    escribir(`   Así las entendí: ${textoDeLasColumnas(comoSeLeyo) || "(ninguna)"}`);
    const bien = indices.cantidad !== -1 && (indices.codigo !== -1 || indices.producto !== -1) && /^s/i.test(await p("   ¿Está bien? (s/n)", "s"));
    if (!bien) {
      for (const campo of ["cantidad", "codigo", "producto", "precio", "talla", "color"]) {
        const actual = indices[campo] === -1 ? "" : tabla.columnas[indices[campo]];
        const r = await p(`   ¿Qué columna es «${campo}»? (vacío = ${actual ? `«${actual}»` : "ninguna"}; «-» = no usarla)`, "");
        if (r === "-") config.columnas[campo] = "";
        else if (r) config.columnas[campo] = r;
      }
    }
  } catch (error) {
    escribir(`\n   Todavía no pude leer el stock (${sinSecretos(error.message, secretosDe(config))}). Las columnas se pueden ajustar después en config.json ("columnas").`);
  }
  if (!Object.keys(config.columnas).length) delete config.columnas;

  // 5. Cada cuánto, las ventas y los avisos.
  config.cadaMinutos = Math.max(1, Number(await p("6. Cada cuántos minutos se manda el stock", anterior.cadaMinutos || 15)) || 15);
  if (destino === "1") {
    const ventasSi = /^s/i.test(await p("7. ¿Bajar las ventas de la tienda a una carpeta, para cargarlas en tu sistema? (s/n)", anterior.ventas?.activar ? "s" : "n"));
    config.ventas = ventasSi ? { activar: true, carpeta: await p("   Carpeta para las ventas", anterior.ventas?.carpeta || "C:\\ventas-de-la-tienda") } : { activar: false, carpeta: "" };
  } else {
    const aviso = await p("7. Si falla, ¿a qué dirección aviso? (un webhook de Slack, Teams, Google Chat o Discord; vacío = no avisar)", anterior.avisos?.webhook || "");
    if (aviso) config.avisos = { webhook: aviso, formato: /discord/i.test(aviso) ? "discord" : "slack" };
  }

  fs.writeFileSync(ruta, JSON.stringify(config, null, 2));
  escribir(`\nGuardado en ${ruta}. Ahora corre «node agente-puente.mjs --doctor» para revisar que todo funcione.`);
  if (config.clave || config.destinos?.some((d) => d.cabeceras || d.secretoFirma) || config.avisos) escribir("Ese archivo tiene claves: no lo compartas ni lo mandes por chat.");
  return config;
}

function preguntarPorConsola() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const preguntar = (texto) => new Promise((r) => rl.question(texto, r));
  return { preguntar, cerrar: () => rl.close() };
}

/* ── Doctor: revisa todo y dice qué falla ───────────────────────────── */

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
  const destinos = listaDeDestinos(config);
  const deps = { hacer, esperar, version: VERSION };

  // Cada destino.
  const destinosBien = new Set();
  for (const d of destinos) {
    const nombre = nombreDelDestino(d);
    try {
      if (d.tipo === "alpha") {
        const e = await llamarA(d, "/api/sync/estado", {}, { ...deps, intentos: 1 });
        const bien = e.estado === 200 && e.cuerpo?.ok;
        anotar(bien, `Contesta la ${nombre}`, bien ? `${e.cuerpo.productos} productos en su inventario` : errorDeLaTienda(e, "No").message);
        if (bien) destinosBien.add(d);
      } else if (d.tipo === "webhook") {
        // Sin mandar datos: solo que la dirección conteste algo.
        const e = await pedir(d.url, { method: "HEAD" }, { hacer, esperar, intentos: 1, segundos: 20 });
        anotar(true, `Contesta ${nombre}`, `contestó ${e.estado}. (Los datos de verdad no se mandan en esta prueba: usa --una-vez.)`);
        destinosBien.add(d);
      } else if (d.tipo === "carpeta") {
        fs.mkdirSync(d.carpeta, { recursive: true });
        const prueba = path.join(d.carpeta, `.agente-puente-prueba-${process.pid}`);
        fs.writeFileSync(prueba, "ok");
        fs.unlinkSync(prueba);
        anotar(true, `Puede escribir en la ${nombre}`);
        destinosBien.add(d);
      }
    } catch (error) {
      anotar(false, d.tipo === "carpeta" ? `Puede escribir en la ${nombre}` : `Contesta ${d.tipo === "alpha" ? "la " : ""}${nombre}`, error.message);
    }
  }

  // La fuente y sus columnas.
  let datos = null;
  try {
    const { tabla, nombre } = await leerFuente(config);
    anotar(tabla.filas.length > 0, "Se puede leer el stock del sistema", tabla.filas.length ? `${tabla.filas.length} filas de ${nombre}; columnas: ${tabla.columnas.join(", ").slice(0, 200)}` : "No trajo ninguna fila.");
    const { indices, problemas: malas, comoSeLeyo } = detectarColumnas(tabla.columnas, config.columnas || {});
    anotar(!malas.length, "Se entienden las columnas", malas.length ? malas.join(" ") : textoDeLasColumnas(comoSeLeyo));
    if (tabla.filas.some((f) => f.some((c) => c.includes("\uFFFD")))) anotar(null, "Las tildes", 'Hay letras raras (�): prueba con "codificacion": "latin1" (o "utf8") en "fuente".');
    if (!malas.length && tabla.filas.length) {
      datos = { tabla, indices, generado: Date.now() };
      const { productos, saltadas } = productosDe(tabla, indices);
      const sinCantidad = productos.filter((x) => x.cantidad === null).length;
      if (sinCantidad) anotar(null, "Las cantidades", `${sinCantidad} filas no tienen una cantidad que sea un número.`);
      if (saltadas) anotar(null, "Filas sin código ni nombre", `${saltadas} filas se van a saltar.`);
      if (fotosActivadas(config, indices)) {
        const fotos = fotosDeLosProductos(config, { tabla, indices });
        const locales = fotos.filter((x) => x.fuente.archivo);
        const faltan = locales.filter((x) => !fs.existsSync(x.fuente.archivo));
        const conFoto = new Set(fotos.map((x) => x.clave)).size;
        anotar(fotos.length ? (faltan.length ? null : true) : null, "Fotos del sistema", fotos.length ? `${fotos.length} fotos de ${conFoto} productos (${indices.foto !== -1 ? `columna «${tabla.columnas[indices.foto]}»` : `carpeta ${config.fotos.carpeta}`})${faltan.length ? `; ${faltan.length} no están, por ejemplo ${faltan[0].fuente.archivo}` : ""}. Se mandan ${Number(config.fotos?.maximoPorVuelta) || 30} por vuelta como mucho, y solo las nuevas o cambiadas.` : `Están activadas pero no encontré ninguna${config.fotos?.carpeta ? ` en ${config.fotos.carpeta} (los archivos se tienen que llamar como el código: A1.jpg, A1-2.jpg…)` : ""}.`);
      } else anotar(null, "Fotos", "El sistema no trae fotos: se suben en el panel de la tienda (Inventario › Sin foto) y un conteo del sistema nunca las borra. Si las tiene en una carpeta, ponla en \"fotos\": { \"carpeta\": \"…\" }.");
    }
  } catch (error) {
    anotar(false, "Se puede leer el stock del sistema", error.message);
  }

  // Una prueba de verdad, sin guardar nada.
  if (datos) {
    for (const d of destinos.filter((x) => destinosBien.has(x))) {
      try {
        const c = await enviarA(config, d, datos, { ...deps, probar: true });
        const i = c.informe || {};
        anotar(true, `Prueba con ${nombreDelDestino(d)} (sin guardar nada)`, d.tipo === "alpha" ? `la tienda entendió ${c.filas ?? c.filasLeidas} filas${i.nuevos ? `; crearía ${i.nuevos} productos nuevos` : ""}${i.errores?.length ? `; ${i.errores.length} con problemas, por ejemplo: ${i.errores[0]}` : ""}` : `${c.mensaje}. El primero: ${JSON.stringify(c.ejemplo).slice(0, 200)}`);
      } catch (error) {
        anotar(false, `Prueba con ${nombreDelDestino(d)} (sin guardar nada)`, error.message);
      }
    }
  }

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

/* ── --probar ───────────────────────────────────────────────────────── */

export async function probar(config, deps = {}) {
  const datos = await leerStock(config);
  const salida = [`Leídas ${datos.tabla.filas.length} filas de ${datos.nombre}.`, `Columnas: ${textoDeLasColumnas(datos.comoSeLeyo)}`];
  if (fotosActivadas(config, datos.indices)) {
    const fotos = fotosDeLosProductos(config, datos);
    salida.push(`Fotos: ${fotos.length} encontradas (se mandan ${Number(config.fotos?.maximoPorVuelta) || 30} por vuelta como mucho, solo las nuevas o cambiadas).`);
  }
  for (const d of listaDeDestinos(config)) {
    try {
      const c = await enviarA(config, d, datos, { version: VERSION, ...deps, probar: true });
      salida.push(`• ${nombreDelDestino(d)}: ${d.tipo === "alpha" ? `la tienda entendió ${c.filas} filas${c.informe?.nuevos ? `, crearía ${c.informe.nuevos} productos nuevos` : ""}${c.informe?.errores?.length ? `, ${c.informe.errores.length} con problemas: ${c.informe.errores.slice(0, 3).join(" | ")}` : ""}` : `${c.mensaje}. El primero: ${JSON.stringify(c.ejemplo)}`}`);
    } catch (error) {
      salida.push(`• ${nombreDelDestino(d)}: ❌ ${error.message}`);
    }
  }
  return sinSecretos(salida.join("\n"), secretosDe(config));
}

/* ── --estado ───────────────────────────────────────────────────────── */

export function textoDelEstado(config) {
  const e = leerEstado(config);
  const l = [];
  l.push(`Agente puente ${VERSION} · ${config.agente} · manda a: ${listaDeDestinos(config).map(nombreDelDestino).join(", ") || "(sin configurar)"}`);
  l.push(e.ultimoOk ? `Último conteo bueno: ${marcaDeTiempo(e.ultimoOk)} (${e.ultimoMensaje || ""})` : "Todavía no hay ningún conteo bueno.");
  if (e.ultimoErrorEn && (!e.ultimoOk || e.ultimoErrorEn > e.ultimoOk)) l.push(`Último error: ${marcaDeTiempo(e.ultimoErrorEn)} — ${e.ultimoError}`);
  if (e.proximaSync) l.push(`Próximo conteo: ${marcaDeTiempo(e.proximaSync)}`);
  try {
    const registro = fs.readFileSync(rutaDe(config, "puente.log"), "utf8").trim().split("\n").slice(-15);
    l.push("", "Últimas líneas del registro (puente.log):", ...registro);
  } catch {}
  return sinSecretos(l.join("\n"), secretosDe(config));
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
    const cabecera = fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//"));
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
  const problemas = problemasDeConfig(config);
  if (tiene("--instalar")) {
    if (problemas.length) {
      console.error(`Antes de instalar, arregla config.json:\n- ${problemas.join("\n- ")}`);
      process.exitCode = 1;
      return;
    }
    if (!(await instalar({ rutaConfig: ruta, usuario: valor("--usuario") || "" }))) process.exitCode = 1;
    return;
  }
  if (problemas.length) {
    registrar(`La configuración tiene problemas: ${problemas.join(" ")}`, { error: true });
    process.exitCode = 1;
    return;
  }
  if (tiene("--probar")) {
    try {
      console.log(await probar(config));
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
