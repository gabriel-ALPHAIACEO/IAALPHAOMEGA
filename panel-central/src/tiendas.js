// LAS TIENDAS DEL PANEL CENTRAL Y CÓMO SE HABLA CON ELLAS.
//
// Cada tienda es su propio Worker, con su propia base (decisión del
// 29-sep-2026: un Worker por tienda). Este panel no toca la base de nadie:
// le pide los datos a cada tienda por internet, a su puerta /api/central,
// con la clave que solo conocen los dos.
//
//   En wrangler.toml (TIENDAS):
//     [{"id":"epicell","nombre":"EPICELL","url":"https://bot-telefonos.xxx.workers.dev"}, …]
//   Y una clave por tienda, como secreto:
//     npx.cmd wrangler secret put CLAVE_EPICELL
//   (la misma que esa tienda tiene en su PANEL_API_CLAVE)

export function leerTiendas(env) {
  let lista = [];
  try {
    lista = JSON.parse(String(env?.TIENDAS || "[]"));
  } catch {
    console.error("TIENDAS en wrangler.toml no es una lista válida");
    return [];
  }
  return (Array.isArray(lista) ? lista : [])
    .map((t) => ({
      id: String(t?.id || "").toLowerCase().replace(/[^a-z0-9_-]/g, ""),
      nombre: String(t?.nombre || t?.id || ""),
      url: String(t?.url || "").replace(/\/+$/, ""),
    }))
    .filter((t) => t.id && /^https?:\/\//.test(t.url));
}

export function claveDe(env, id) {
  return String(env?.[`CLAVE_${String(id).toUpperCase().replace(/-/g, "_")}`] || "");
}

export function mismoTexto(a, b) {
  const x = String(a);
  const y = String(b);
  if (!x || x.length !== y.length) return false;
  let diferencia = 0;
  for (let i = 0; i < x.length; i++) diferencia |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diferencia === 0;
}

// ¿De qué tienda es esta clave? Así se reconoce quién manda una alerta,
// sin fiarse de lo que diga el cuerpo del mensaje.
export function tiendaDeLaClave(env, clave) {
  return leerTiendas(env).find((t) => mismoTexto(clave, claveDe(env, t.id))) || null;
}

// Le pide algo a una tienda. Devuelve { ok, datos, error, estado }.
export async function pedir(env, tienda, ruta, { metodo = "GET", cuerpo = null, espera = 8000 } = {}) {
  const clave = claveDe(env, tienda.id);
  if (!clave) return { ok: false, error: `Falta la clave CLAVE_${tienda.id.toUpperCase()} en el panel central` };
  try {
    const r = await fetch(`${tienda.url}/api/central/${ruta}`, {
      method: metodo,
      headers: { authorization: `Bearer ${clave}`, "content-type": "application/json" },
      body: cuerpo ? JSON.stringify(cuerpo) : null,
      signal: AbortSignal.timeout(espera),
    });
    const texto = await r.text().catch(() => "");
    let datos = null;
    try {
      datos = JSON.parse(texto);
    } catch {}
    if (!r.ok) {
      // Error 1042 de Cloudflare: un Worker no puede llamar por workers.dev a
      // otro de LA MISMA CUENTA. Pasó el 2-oct con Invictus (los dos en
      // invictusshoes.workers.dev) y parecía "versión vieja".
      const misma = /\b1042\b/.test(texto) || /error code: 1042/i.test(texto);
      const motivo = misma
        ? "Cloudflare no deja que dos Workers de la misma cuenta se hablen por workers.dev (error 1042): el panel tiene que estar en otra cuenta de Cloudflare (la de ALPHA IA), no en la de esta tienda"
        : r.status === 401
          ? "la clave no coincide con la PANEL_API_CLAVE de la tienda"
          : r.status === 403
            ? "la tienda no tiene puesta su PANEL_API_CLAVE"
            : r.status === 404 && !datos
              ? "la tienda no tiene la versión con el panel central (despliega la nueva)"
              : datos?.error || `respondió ${r.status}`;
      return { ok: false, estado: r.status, error: motivo, datos };
    }
    // Un 200 que no trae datos del panel (no es JSON) es una tienda con la
    // versión vieja: su respuesta genérica sale como "ok". Antes eso tumbaba
    // la página entera (2-oct); ahora se dice qué pasa.
    if (datos === null || typeof datos !== "object") {
      return { ok: false, estado: r.status, error: "la tienda respondió, pero sin los datos del panel: todavía tiene la versión vieja (despliega la nueva y mira su /estado)" };
    }
    return { ok: true, estado: r.status, datos };
  } catch (error) {
    return { ok: false, error: /timeout|abort/i.test(String(error?.name || error)) ? "no respondió a tiempo" : String(error?.message || error) };
  }
}

// La misma pregunta a todas las tiendas a la vez.
export async function pedirATodas(env, ruta, opciones) {
  const tiendas = leerTiendas(env);
  const respuestas = await Promise.all(tiendas.map((t) => pedir(env, t, ruta, opciones)));
  return tiendas.map((t, i) => ({ tienda: t, ...respuestas[i] }));
}
