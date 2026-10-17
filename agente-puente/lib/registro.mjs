// EL REGISTRO (puente.log): lo que hizo el agente, con la hora, sin secretos.
// Al pasar de «maximo» el viejo queda como puente.log.1 (uno solo: nunca llena
// el disco).

import fs from "node:fs";
import { sinSecretos } from "./secretos.mjs";

export function marcaDeTiempo(ms = Date.now()) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function crearRegistro({ archivo = "", consola = true, maximo = 1024 * 1024, secretos = [] } = {}) {
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
