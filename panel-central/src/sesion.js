// LA ENTRADA AL PANEL CENTRAL.
//
// Este panel puede leer y EDITAR las bases de todas las tiendas, así que
// se cuida más que el panel de cada tienda:
//
//   · La clave (secreto PANEL_CLAVE) tiene que tener 12 letras o más.
//   · La sesión es una cookie firmada (HMAC). La clave nunca viaja en la
//     URL ni se guarda en el navegador. Al entrar se pregunta si dejarla
//     abierta (7-oct-2026): abierta dura 90 días y se renueva sola al usar
//     el panel; si no, se cierra con el navegador (o a las 12 horas).
//   · Tras 8 claves equivocadas desde la misma conexión en 15 minutos, se
//     deja de probar hasta que pasen. Así no se puede adivinar a lo bruto.
//   · Los botones que cambian algo (pausar, editar, borrar, SQL) solo valen
//     si vienen de una página del propio panel, no de otra web.

import { mismoTexto } from "./tiendas.js";

export const COOKIE = "central";
const DIA_MS = 24 * 60 * 60 * 1000;
const SESION_LARGA_MS = 90 * DIA_MS;
const SESION_CORTA_MS = 12 * 60 * 60 * 1000;
const RENOVAR_TRAS_MS = 10 * DIA_MS;
const INTENTOS_MAX = 8;
const VENTANA_MS = 15 * 60 * 1000;

export function claveLista(env) {
  return String(env?.PANEL_CLAVE || "").length >= 12;
}

async function firmar(env, texto) {
  const llave = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(env.PANEL_CLAVE)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = await crypto.subtle.sign("HMAC", llave, new TextEncoder().encode(texto));
  return [...new Uint8Array(firma)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// La cookie: "<expira>.<modo>.<firma>", modo "r" (abierta) o "s" (solo
// esta vez). Las de antes ("<expira>.<firma>") siguen valiendo.
export async function cookieNueva(env, { abierta = true } = {}) {
  const modo = abierta ? "r" : "s";
  const expira = Date.now() + (abierta ? SESION_LARGA_MS : SESION_CORTA_MS);
  const valor = `${expira}.${modo}.${await firmar(env, `central:${expira}:${modo}`)}`;
  return `${COOKIE}=${valor}; Path=/; HttpOnly; Secure; SameSite=Strict${abierta ? `; Max-Age=${Math.floor(SESION_LARGA_MS / 1000)}` : ""}`;
}

export const COOKIE_FUERA = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

async function leerSesion(request, env) {
  if (!claveLista(env)) return null;
  const galletas = request.headers.get("cookie") || "";
  const valor = galletas.split(/;\s*/).find((g) => g.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || "";
  const partes = valor.split(".");
  const [expira, modo, firma] = partes.length === 3 ? partes : partes.length === 2 ? [partes[0], "", partes[1]] : [];
  if (!expira || !firma || !["", "r", "s"].includes(modo) || Number(expira) < Date.now()) return null;
  if (!mismoTexto(firma, await firmar(env, modo ? `central:${expira}:${modo}` : `central:${expira}`))) return null;
  return { expira: Number(expira), abierta: modo !== "s" };
}

export async function sesionValida(request, env) {
  return Boolean(await leerSesion(request, env));
}

// Quien la dejó abierta y sigue entrando no la ve vencer: pasados 10 días,
// la respuesta lleva una cookie nueva.
export async function conSesionRenovada(request, env, respuesta) {
  if (request.method !== "GET" || respuesta.headers.has("set-cookie")) return respuesta;
  const sesion = await leerSesion(request, env).catch(() => null);
  if (!sesion?.abierta || sesion.expira - Date.now() > SESION_LARGA_MS - RENOVAR_TRAS_MS) return respuesta;
  const galleta = await cookieNueva(env, { abierta: true });
  try {
    respuesta.headers.append("set-cookie", galleta);
    return respuesta;
  } catch {
    const copia = new Response(respuesta.body, respuesta);
    copia.headers.append("set-cookie", galleta);
    return copia;
  }
}

// ¿El formulario salió de una página de este mismo panel?
// Sec-Fetch-Site lo dice el navegador y una web no lo puede falsificar. Si
// no viene (navegadores viejos), se mira el Origin. OJO: Chrome manda
// Origin "null" en formularios de páginas sin referrer; eso NO es otra web
// (por eso falló la entrada el 2-oct: el formulario propio salía como ajeno).
export function vieneDelPanel(request) {
  const sitio = request.headers.get("sec-fetch-site");
  if (sitio) return sitio === "same-origin" || sitio === "none";
  const origen = request.headers.get("origin");
  if (origen && origen !== "null") return origen === new URL(request.url).origin;
  return true;
}

/* ── El freno a los intentos ─────────────────────────────────────── */

const CREAR_INTENTOS = `
  CREATE TABLE IF NOT EXISTS intentos (
    ip     TEXT NOT NULL,
    cuando INTEGER NOT NULL
  )
`;

function ipDe(request) {
  return request.headers.get("cf-connecting-ip") || "sin-ip";
}

export async function demasiadosIntentos(db, request) {
  if (!db) return false;
  await db.prepare(CREAR_INTENTOS).run();
  const r = await db.prepare("SELECT COUNT(*) AS n FROM intentos WHERE ip = ? AND cuando > ?").bind(ipDe(request), Date.now() - VENTANA_MS).first();
  return (Number(r?.n) || 0) >= INTENTOS_MAX;
}

export async function anotarIntento(db, request) {
  if (!db) return;
  await db.prepare(CREAR_INTENTOS).run();
  await db.prepare("INSERT INTO intentos (ip, cuando) VALUES (?, ?)").bind(ipDe(request), Date.now()).run();
  await db.prepare("DELETE FROM intentos WHERE cuando < ?").bind(Date.now() - VENTANA_MS).run();
}

export async function olvidarIntentos(db, request) {
  if (!db) return;
  await db.prepare(CREAR_INTENTOS).run();
  await db.prepare("DELETE FROM intentos WHERE ip = ?").bind(ipDe(request)).run();
}
