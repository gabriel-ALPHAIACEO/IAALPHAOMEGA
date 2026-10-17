// NINGÚN SECRETO POR ESCRITO. Todo lo que el agente escribe (pantalla,
// puente.log, latido, avisos) pasa por sinSecretos().
//
// En config.json un valor puede venir de una variable de entorno de la PC en
// vez de escribirse ahí: "${ENV:NOMBRE}". Así la clave no queda en el archivo.

export function expandirEntorno(valor, entorno = process.env) {
  if (typeof valor !== "string") return valor;
  return valor.replace(/\$\{ENV:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, n) => String(entorno[n] ?? ""));
}

// Quita claves, contraseñas y tokens de un texto. «secretos» son valores
// concretos (la clave, las contraseñas del comando) que se tapan donde estén.
export function sinSecretos(texto, secretos = []) {
  let t = String(texto ?? "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***")
    .replace(/(hooks\.slack\.com\/services\/)\S+/gi, "$1***")
    .replace(/(webhook\.office\.com\/\S*?\/)[^\s/]{20,}/gi, "$1***")
    .replace(/((?:clave|contrase[ñn]a|password|passwd|pwd|token|secret|secreto|api[_-]?key)\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s;]+)/gi, "$1***")
    .replace(/(\s-P\s+)("[^"]*"|'[^']*'|\S+)/g, "$1***")
    .replace(/(\s-p)(?!\s)(\S+)/g, "$1***");
  for (const s of secretos) {
    const v = String(s || "");
    if (v.length >= 4) t = t.split(v).join("***");
  }
  return t;
}

// Todos los valores secretos de una configuración: las claves de cada destino,
// sus cabeceras, la clave de firma, la dirección de los avisos y las
// contraseñas que vengan escritas en el comando.
export function secretosDe(config = {}) {
  const lista = [process.env.SYNC_CLAVE, config.clave, config.secretoFirma, config.avisos?.webhook];
  for (const d of [].concat(config.destinos || [], config.destino || [])) {
    if (!d || typeof d !== "object") continue;
    lista.push(d.clave, d.secretoFirma);
    for (const v of Object.values(d.cabeceras || {})) lista.push(v);
  }
  const comando = String(config.fuente?.comando || "");
  const sacar = (re) => {
    for (const m of comando.matchAll(re)) lista.push(String(m[1]).replace(/^["']|["']$/g, ""));
  };
  sacar(/\s-P\s+("[^"]*"|'[^']*'|\S+)/g);
  sacar(/\s-p(?!\s)(\S+)/g);
  sacar(/(?:password|passwd|pwd)\s*=\s*("[^"]*"|'[^']*'|[^\s;]+)/gi);
  return [...new Set(lista.map((s) => expandirEntorno(s)).filter((s) => typeof s === "string" && s.length >= 4))];
}
