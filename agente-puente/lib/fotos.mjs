// LAS FOTOS DEL SISTEMA (16-oct-2026, pedido del dueño: "que también envíe las
// fotos en caso de que tenga fotos el sistema de inventario").
//
// DE DÓNDE: el sistema puede tener las fotos de dos maneras, y sirven las dos:
//   1. Una COLUMNA con la foto de cada producto (se reconoce sola: foto, imagen,
//      image…): una dirección (https://…, o http://192.168.1.10/… de la red de
//      la oficina: el agente la baja desde la PC) o la ruta de un archivo
//      (C:\Sistema\Fotos\A1.jpg, o «A1.jpg» dentro de "fotos.carpeta"). Varias en
//      la misma celda, separadas por «|».
//   2. Una CARPETA con las fotos nombradas por el código (o el nombre) del
//      producto: A1.jpg, A1-2.jpg, A1_3.png, «A1 (2).jpg»… La primera es la principal.
//
//   "fotos": { "carpeta": "C:\\Sistema\\Fotos", "por": "codigo", "maximoPorVuelta": 30 }
//
// Se mandan solas si hay columna de fotos o "fotos.carpeta"; "fotos": { "activar": false } las apaga.
//
// A DÓNDE: a cada destino que recibió bien el stock.
//   · tienda ALPHA IA → POST /api/sync/foto (las fotos del panel mandan: ver
//     fotos-del-sistema.js en la tienda);
//   · otra plataforma → un POST JSON { tipo: "foto", …, datos: base64 } (PROTOCOLO.md),
//     a "urlFotos" del destino o a su misma "url";
//   · carpeta → <carpeta>/fotos/<código>-<n>.<ext>.
//
// SIN REPETIR: el agente recuerda en fotos-enviadas.json la huella de cada foto
// mandada a cada destino; solo vuelve a mandar una que CAMBIÓ. Un archivo se
// vuelve a leer solo si cambió su fecha o su tamaño; una dirección se revisa una
// vez al día. Y como mucho "maximoPorVuelta" (30) por vuelta: la primera vez,
// un catálogo de miles de fotos se completa en varias vueltas sin trabar el stock.
//
// Solo JPG, PNG o WEBP de hasta 1,5 MB (lo que guarda la tienda). En Windows,
// una más grande (o un BMP/GIF/TIFF) se achica a JPG de 1600 px con el propio
// Windows (PowerShell); si no se puede, se salta con su motivo.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { pedir, llamar, nombreDelDestino, firmar, errorDeLaTienda } from "./destinos.mjs";
import { expandirEntorno } from "./secretos.mjs";

export const MAXIMO_FOTO = 1_500_000;
export const FOTOS_POR_PRODUCTO = 10;
const DIA = 24 * 60 * 60 * 1000;
const EXTENSIONES = /\.(jpe?g|png|webp|gif|bmp|tiff?|jfif)$/i;
const TIPOS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export function tipoDeImagen(b) {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return "";
}

function huella(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

const normal = (t) => String(t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

export function fotosActivadas(config, indices) {
  const f = config.fotos || {};
  if (f.activar === false) return false;
  return f.activar === true || Boolean(f.carpeta) || indices.foto !== -1;
}

// Las fotos de cada producto: [{ codigo, producto, posicion, fuente: { url } | { archivo } }].
export function fotosDeLosProductos(config, { tabla, indices }) {
  const f = config.fotos || {};
  const carpeta = f.carpeta ? String(f.carpeta) : "";
  const por = f.por === "producto" ? "producto" : "codigo";
  // La carpeta, una sola vez: nombre sin extensión → archivos.
  let indice = null;
  const archivosDe = (clave) => {
    if (!carpeta || !clave) return [];
    if (!indice) {
      indice = new Map();
      let nombres = [];
      try {
        nombres = fs.readdirSync(carpeta);
      } catch {}
      for (const n of nombres.filter((x) => EXTENSIONES.test(x))) {
        const base = normal(n.replace(EXTENSIONES, ""));
        // A1, A1-2, A1_2, «A1 (2)», A1.2 → la clave A1 y el número 2.
        const m = base.match(/^(.*?)(?:[\s_.-]+\(?(\d{1,2})\)?|\s*\((\d{1,2})\))$/);
        const clave = m ? m[1] : base;
        const numero = m ? Number(m[2] || m[3]) : 0;
        for (const k of new Set([base, clave])) {
          if (!indice.has(k)) indice.set(k, []);
          indice.get(k).push({ ruta: path.join(carpeta, n), numero: k === base ? 0 : numero });
        }
      }
    }
    const lista = indice.get(normal(clave)) || [];
    return [...new Map(lista.sort((a, b) => a.numero - b.numero).map((x) => [x.ruta, x])).values()].map((x) => x.ruta);
  };
  const salida = [];
  for (const fila of tabla.filas) {
    const celda = (campo) => (indices[campo] === -1 ? "" : String(fila[indices[campo]] ?? "").trim());
    const codigo = celda("codigo");
    const producto = celda("producto");
    if (!codigo && !producto) continue;
    let fuentes = [];
    const enLaColumna = celda("foto");
    if (enLaColumna) {
      fuentes = enLaColumna
        .split(/\s*[|\n]\s*/)
        .filter(Boolean)
        .map((v) => (/^https?:\/\//i.test(v) ? { url: v } : { archivo: path.isAbsolute(v) || /^[a-z]:[\\/]/i.test(v) || v.startsWith("\\\\") ? v : path.join(carpeta || path.dirname(config.fuente?.ruta || config.fuente?.carpeta || "."), v) }));
    } else {
      fuentes = archivosDe(por === "producto" ? producto : codigo || producto).map((archivo) => ({ archivo }));
    }
    // Un producto con varias tallas sale en varias filas: sus fotos, una vez.
    const clave = `${codigo}|${producto}`;
    if (salida.some((x) => x.clave === clave)) continue;
    fuentes.slice(0, FOTOS_POR_PRODUCTO).forEach((fuente, posicion) => salida.push({ clave, codigo, producto, posicion, fuente }));
  }
  return salida;
}

// Achica una foto con el propio Windows (PowerShell + System.Drawing): JPG,
// 1600 px como mucho, calidad 82. Las rutas van por variables de entorno (sin
// comillas que se rompan). Devuelve los bytes, o null si no se pudo.
export function achicarConWindows(entrada) {
  if (process.platform !== "win32") return Promise.resolve(null);
  const salida = path.join(os.tmpdir(), `agente-puente-${process.pid}-${Date.now()}.jpg`);
  const script = [
    "Add-Type -AssemblyName System.Drawing",
    "$img = [System.Drawing.Image]::FromFile($env:PUENTE_ENTRADA)",
    "$r = [Math]::Min(1.0, [Math]::Min(1600 / $img.Width, 1600 / $img.Height))",
    "$w = [int]($img.Width * $r); $h = [int]($img.Height * $r)",
    "$bmp = New-Object System.Drawing.Bitmap $w, $h",
    "$g = [System.Drawing.Graphics]::FromImage($bmp)",
    "$g.InterpolationMode = 'HighQualityBicubic'",
    "$g.DrawImage($img, 0, 0, $w, $h)",
    "$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }",
    "$p = New-Object System.Drawing.Imaging.EncoderParameters 1",
    "$p.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]82)",
    "$bmp.Save($env:PUENTE_SALIDA, $enc, $p)",
    "$g.Dispose(); $bmp.Dispose(); $img.Dispose()",
  ].join("; ");
  return new Promise((resolve) => {
    execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, PUENTE_ENTRADA: entrada, PUENTE_SALIDA: salida }, timeout: 60000, windowsHide: true }, (error) => {
      try {
        const bytes = error ? null : fs.readFileSync(salida);
        fs.rmSync(salida, { force: true });
        resolve(bytes && tipoDeImagen(bytes) ? bytes : null);
      } catch {
        resolve(null);
      }
    });
  });
}

// Los bytes de una foto, listos para mandar: { bytes, tipo, huella } o { error }.
async function prepararBytes(bytes, nombre, { achicar, rutaParaAchicar }) {
  let b = bytes;
  let tipo = tipoDeImagen(b);
  if (!tipo || b.length > MAXIMO_FOTO) {
    let temporal = "";
    let ruta = rutaParaAchicar;
    if (!ruta) {
      temporal = path.join(os.tmpdir(), `agente-puente-foto-${process.pid}-${Date.now()}`);
      fs.writeFileSync(temporal, b);
      ruta = temporal;
    }
    const achicada = await achicar(ruta).catch(() => null);
    if (temporal) fs.rmSync(temporal, { force: true });
    if (!achicada) {
      return { error: !tipo ? `${nombre}: no es JPG, PNG o WEBP (guárdala en uno de esos)` : `${nombre}: pesa ${(b.length / 1e6).toFixed(1)} MB y el máximo es 1,5 MB (achícala)` };
    }
    b = achicada;
    tipo = tipoDeImagen(b);
    if (b.length > MAXIMO_FOTO) return { error: `${nombre}: sigue pesando más de 1,5 MB después de achicarla` };
  }
  return { bytes: b, tipo, huella: huella(b) };
}

function leerCache(config) {
  try {
    return JSON.parse(fs.readFileSync(path.join(config.carpeta, "fotos-enviadas.json"), "utf8"));
  } catch {
    return { archivos: {}, urls: {}, enviadas: {}, sinProducto: {} };
  }
}

function guardarCache(config, cache) {
  try {
    const ruta = path.join(config.carpeta, "fotos-enviadas.json");
    fs.writeFileSync(`${ruta}.tmp`, JSON.stringify(cache));
    fs.renameSync(`${ruta}.tmp`, ruta);
  } catch {}
}

function idDelDestino(d) {
  return `${d.tipo}:${d.url || d.carpeta || ""}`;
}

function nombreSeguro(t) {
  return String(t || "producto").replace(/[^\w.-]+/g, "_").slice(0, 80);
}

async function mandarUna(config, d, foto, listo, deps) {
  const { hacer, esperar, version } = deps;
  if (d.tipo === "alpha") {
    const consulta = new URLSearchParams({ codigo: foto.codigo, producto: foto.producto, posicion: String(foto.posicion) });
    const r = await llamar(d, `/api/sync/foto?${consulta}`, { method: "POST", headers: { "content-type": listo.tipo }, body: listo.bytes }, { hacer, esperar, version });
    if (r.estado === 404 && r.cuerpo?.estado === "sin-producto") return "sin-producto";
    if (r.estado === 404) throw new Error("la tienda todavía no recibe fotos (tiene una versión vieja del bot)");
    if (!r.cuerpo?.ok) throw errorDeLaTienda(r, "La tienda no aceptó la foto");
    return r.cuerpo.estado;
  }
  if (d.tipo === "webhook") {
    const cuerpo = JSON.stringify({
      tipo: "foto",
      agente: config.agente,
      origen: config.origen || "",
      codigo: foto.codigo || null,
      producto: foto.producto || null,
      posicion: foto.posicion,
      contentType: listo.tipo,
      huella: listo.huella,
      datos: listo.bytes.toString("base64"),
    });
    const tiempo = String(Date.now());
    const h = { "content-type": "application/json", "user-agent": `agente-puente/${version}`, "x-agente-puente": version, "x-puente-tipo": "foto", ...Object.fromEntries(Object.entries(d.cabeceras || {}).map(([k, v]) => [k, expandirEntorno(String(v))])) };
    const secreto = expandirEntorno(d.secretoFirma || "");
    if (secreto) Object.assign(h, { "x-puente-tiempo": tiempo, "x-puente-firma": firmar(secreto, tiempo, cuerpo) });
    const r = await pedir(d.urlFotos || d.url, { method: "POST", headers: h, body: cuerpo }, { hacer, esperar, segundos: Number(d.timeoutSegundos) || 60 });
    if (r.estado < 200 || r.estado >= 300) throw new Error(`no aceptó la foto (${r.estado}): ${r.cuerpo?.error || r.cuerpo?.message || String(r.texto || "").slice(0, 120)}`);
    return "nueva";
  }
  if (d.tipo === "carpeta") {
    const dir = path.join(d.carpeta, "fotos");
    fs.mkdirSync(dir, { recursive: true });
    const archivo = path.join(dir, `${nombreSeguro(foto.codigo || foto.producto)}-${foto.posicion + 1}.${TIPOS[listo.tipo]}`);
    fs.writeFileSync(`${archivo}.tmp`, listo.bytes);
    fs.renameSync(`${archivo}.tmp`, archivo);
    return "nueva";
  }
  return "nueva";
}

// Manda las fotos que hagan falta a los destinos que recibieron bien el stock.
// → { mandadas, iguales, pendientes, saltadas, errores: [texto] }
export async function mandarFotos(config, datos, destinos, { hacer = globalThis.fetch, esperar, registrar = () => {}, version = "", achicar = achicarConWindows, probar = false, ahora = Date.now() } = {}) {
  const r = { total: 0, mandadas: 0, iguales: 0, pendientes: 0, saltadas: 0, errores: [] };
  if (!destinos.length || !fotosActivadas(config, datos.indices)) return r;
  const fotos = fotosDeLosProductos(config, datos);
  r.total = fotos.length;
  if (probar || !fotos.length) return r;
  const maximo = Math.max(1, Number(config.fotos?.maximoPorVuelta) || 30);
  const cache = leerCache(config);
  cache.archivos ||= {};
  cache.urls ||= {};
  cache.enviadas ||= {};
  cache.sinProducto ||= {};
  const deps = { hacer, esperar, version };
  let presupuesto = maximo;
  for (const foto of fotos) {
    const nombre = foto.fuente.url ? foto.fuente.url.split("/").pop().slice(0, 60) : path.basename(foto.fuente.archivo);
    // ¿Qué huella tiene hoy? Sin leerla otra vez si no cambió.
    let sabida = "";
    let estado = null;
    if (foto.fuente.archivo) {
      try {
        estado = fs.statSync(foto.fuente.archivo);
      } catch {
        r.saltadas++;
        if (r.errores.length < 20) r.errores.push(`${nombre}: no está (${foto.codigo || foto.producto})`);
        continue;
      }
      const c = cache.archivos[foto.fuente.archivo];
      if (c && c.tamano === estado.size && c.fecha === estado.mtimeMs) sabida = c.huella;
    } else {
      const c = cache.urls[foto.fuente.url];
      if (c && ahora - c.en < DIA) sabida = c.huella;
    }
    const pendientesAqui = destinos.filter((d) => {
      const k = `${idDelDestino(d)}|${foto.clave}|${foto.posicion}`;
      if (cache.sinProducto[k] && ahora - cache.sinProducto[k] < 6 * 60 * 60 * 1000) return false;
      return !sabida || cache.enviadas[k] !== sabida;
    });
    if (!pendientesAqui.length) {
      r.iguales++;
      continue;
    }
    if (presupuesto <= 0) {
      r.pendientes++;
      continue;
    }
    // Leerla (o bajarla) y dejarla lista.
    let bytes;
    try {
      if (foto.fuente.archivo) bytes = fs.readFileSync(foto.fuente.archivo);
      else {
        const resp = await hacer(foto.fuente.url, { signal: AbortSignal.timeout(30000) });
        if (!resp.ok) throw new Error(`la dirección contestó ${resp.status}`);
        bytes = Buffer.from(await resp.arrayBuffer());
      }
    } catch (error) {
      r.saltadas++;
      if (r.errores.length < 20) r.errores.push(`${nombre}: no se pudo leer (${error.message})`);
      continue;
    }
    const listo = await prepararBytes(bytes, nombre, { achicar, rutaParaAchicar: foto.fuente.archivo || "" });
    if (listo.error) {
      r.saltadas++;
      if (r.errores.length < 20) r.errores.push(listo.error);
      continue;
    }
    if (foto.fuente.archivo) cache.archivos[foto.fuente.archivo] = { tamano: estado.size, fecha: estado.mtimeMs, huella: listo.huella };
    else cache.urls[foto.fuente.url] = { en: ahora, huella: listo.huella };
    let mandoAlgo = false;
    for (const d of destinos) {
      const k = `${idDelDestino(d)}|${foto.clave}|${foto.posicion}`;
      if (cache.enviadas[k] === listo.huella) continue;
      try {
        const e = await mandarUna(config, d, foto, listo, deps);
        if (e === "sin-producto") {
          cache.sinProducto[k] = ahora;
          continue;
        }
        delete cache.sinProducto[k];
        cache.enviadas[k] = listo.huella;
        if (e === "nueva" || e === "cambiada") mandoAlgo = true;
      } catch (error) {
        if (r.errores.length < 20) r.errores.push(`${nombre} → ${nombreDelDestino(d)}: ${error.message}`);
      }
    }
    presupuesto--;
    if (mandoAlgo) r.mandadas++;
    else r.iguales++;
  }
  guardarCache(config, cache);
  if (r.mandadas || r.pendientes) registrar(`Fotos: ${r.mandadas} mandadas${r.pendientes ? `, ${r.pendientes} para las próximas vueltas` : ""}${r.saltadas ? `, ${r.saltadas} con problemas` : ""}.`);
  for (const e of r.errores.slice(0, 5)) registrar(`  ⚠ ${e}`);
  return r;
}
