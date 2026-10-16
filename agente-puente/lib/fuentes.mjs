// DE DÓNDE SALE EL STOCK. Cualquier sistema instalado en una computadora tiene
// al menos una de estas tres salidas:
//
//   "archivo"  un archivo que el sistema exporta (CSV, TXT, Excel .xlsx o JSON)
//              "fuente": { "tipo": "archivo", "ruta": "C:\\exportes\\stock.xlsx" }
//   "carpeta"  una carpeta donde el sistema deja un archivo nuevo cada vez (con
//              la fecha en el nombre, por ejemplo): se toma el MÁS NUEVO
//              "fuente": { "tipo": "carpeta", "carpeta": "C:\\exportes", "patron": "stock_*.csv" }
//   "comando"  un comando que escribe el stock por pantalla (una consulta a su
//              base de datos: sqlcmd, mysql, psql, sqlite3, PowerShell/ODBC…)
//              "fuente": { "tipo": "comando", "comando": "C:\\agente-puente\\ejemplos\\sacar-stock-sqlserver.bat" }
//
// Opciones de todas: "codificacion" (auto, utf8, latin1, utf16le),
// "maximoMinutos" (un archivo más viejo no se manda: el sistema dejó de
// exportar), "hoja" (de un Excel; si no, la primera).
//
// Devuelve { tabla: { columnas, filas }, generado: ms, nombre }.

import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { decodificar, limpiarSalida, leerCsv, tablaDeJson } from "./tabla.mjs";
import { esXlsx, esXlsViejo, leerXlsx } from "./excel.mjs";
import { marcaDeTiempo } from "./registro.mjs";

const MINUTO = 60 * 1000;

// El error de un comando NUNCA lleva el comando (puede tener la contraseña de
// la base): solo el código y lo que el programa dijo.
export function correr(comando, { timeoutMs = 120000, codificacion = "auto" } = {}) {
  return new Promise((resolve, reject) => {
    exec(comando, { encoding: "buffer", maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs, windowsHide: true }, (error, salida, errores) => {
      if (error) {
        if (error.killed) {
          reject(new Error(`El comando tardó más de ${Math.round(timeoutMs / 1000)} s y se cortó (sube "fuente.timeoutSegundos" si la consulta es lenta).`));
          return;
        }
        const detalle = decodificar(errores || Buffer.alloc(0), codificacion).replace(/\s+/g, " ").trim().slice(0, 300);
        reject(new Error(`El comando falló (código ${error.code ?? "?"})${detalle ? `: ${detalle}` : ". No dijo por qué: pruébalo a mano en una ventana de comandos."}`));
        return;
      }
      resolve(salida);
    });
  });
}

// Un texto (CSV, salida de un comando, JSON) o los bytes de un Excel → tabla.
export function tablaDeBytes(bytes, { nombre = "", codificacion = "auto", hoja = "" } = {}) {
  if (esXlsViejo(bytes)) throw new Error(`${nombre || "El archivo"} es un .xls viejo y no se puede leer: en el sistema elige guardar como .xlsx o .csv.`);
  if (esXlsx(bytes) || /\.xlsx$/i.test(nombre)) return leerXlsx(bytes, { hoja });
  const texto = decodificar(bytes, codificacion).replace(/^\uFEFF/, "");
  if (/\.json$/i.test(nombre) || /^\s*[[{]/.test(texto)) {
    let datos;
    try {
      datos = JSON.parse(texto);
    } catch (error) {
      throw new Error(`El JSON no se entiende: ${error.message}`);
    }
    return tablaDeJson(datos);
  }
  return leerCsv(limpiarSalida(texto));
}

// Convierte un patrón como «stock_*.csv» en una expresión (sin mayúsculas).
function patronARegex(patron = "*") {
  const re = String(patron || "*").replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${re}$`, "i");
}

function abrir(ruta) {
  try {
    return fs.statSync(ruta);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`No encuentro ${ruta}. ¿El sistema lo está dejando ahí? (Si es una unidad de red, usa la ruta \\\\servidor\\carpeta: la tarea programada no ve las letras de unidad.)`);
    throw new Error(`No pude abrir ${ruta}: ${error.message}`);
  }
}

export async function leerFuente(config) {
  const f = config.fuente || {};
  const opciones = { codificacion: f.codificacion || "auto", hoja: f.hoja || "" };
  if (f.tipo === "archivo" || f.tipo === "carpeta") {
    let ruta = f.ruta;
    if (f.tipo === "carpeta") {
      if (!f.carpeta) throw new Error('Falta "fuente.carpeta".');
      abrir(f.carpeta);
      const re = patronARegex(f.patron || "*");
      const candidatos = fs
        .readdirSync(f.carpeta)
        .filter((n) => re.test(n) && !/^~\$/.test(n))
        .map((n) => ({ n, s: fs.statSync(path.join(f.carpeta, n)) }))
        .filter((x) => x.s.isFile())
        .sort((a, b) => b.s.mtimeMs - a.s.mtimeMs);
      if (!candidatos.length) throw new Error(`En ${f.carpeta} no hay ningún archivo «${f.patron || "*"}».`);
      ruta = path.join(f.carpeta, candidatos[0].n);
    } else if (!ruta) throw new Error('Falta "fuente.ruta".');
    const estado = abrir(ruta);
    if (f.maximoMinutos && Date.now() - estado.mtimeMs > f.maximoMinutos * MINUTO) {
      throw new Error(`El archivo es viejo (de ${marcaDeTiempo(estado.mtimeMs)}). Si el sistema ya no lo actualiza, no se manda.`);
    }
    // Si el sistema lo estaba escribiendo mientras se leía (cambió de tamaño o
    // de hora), se espera y se vuelve a leer: así no se manda un archivo a medias.
    let bytes = fs.readFileSync(ruta);
    let despues = abrir(ruta);
    if (despues.size !== bytes.length || despues.mtimeMs !== estado.mtimeMs) {
      await new Promise((r) => setTimeout(r, 3000));
      bytes = fs.readFileSync(ruta);
      despues = abrir(ruta);
    }
    return { tabla: tablaDeBytes(bytes, { ...opciones, nombre: ruta }), generado: despues.mtimeMs, nombre: path.basename(ruta) };
  }
  if (f.tipo === "comando") {
    if (!f.comando) throw new Error('Falta "fuente.comando".');
    const inicio = Date.now();
    const salida = await correr(f.comando, { timeoutMs: (f.timeoutSegundos || 120) * 1000, codificacion: opciones.codificacion });
    return { tabla: tablaDeBytes(salida, opciones), generado: inicio, nombre: "comando" };
  }
  throw new Error('"fuente.tipo" tiene que ser "archivo", "carpeta" o "comando".');
}
