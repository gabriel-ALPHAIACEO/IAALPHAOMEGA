// LA ENTRADA AL PANEL CENTRAL.
//
// Este panel puede leer y EDITAR las bases de todas las tiendas, así que
// se cuida más que el panel de cada tienda:
//
//   · La clave (secreto PANEL_CLAVE) tiene que tener 12 letras o más.
//   · La sesión es una cookie firmada (HMAC) que dura 30 días. La clave
//     nunca viaja en la URL ni se guarda en el navegador.
//   · Tras 8 claves equivocadas desde la misma conexión en 15 minutos, se
//     deja de probar hasta que pasen. Así no se puede adivinar a lo bruto.
//   · Los botones que cambian algo (pausar, editar, borrar, SQL) solo valen
//     si vienen de una página del propio panel, no de otra web.

import { mismoTexto } from "./tiendas.js";

export const COOKIE = "central";
const SESION_MS = 30 * 24 * 60 * 60 * 1000;
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

export async function cookieNueva(env) {
  const expira = Date.now() + SESION_MS;
  const valor = `${expira}.${await firmar(env, `central:${expira}`)}`;
  return `${COOKIE}=${valor}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(SESION_MS / 1000)}`;
}

export const COOKIE_FUERA = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export async function sesionValida(request, env) {
  if (!claveLista(env)) return false;
  const galletas = request.headers.get("cookie") || "";
  const valor = galletas.split(/;\s*/).find((g) => g.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || "";
  const [expira, firma] = valor.split(".");
  if (!expira || !firma || Number(expira) < Date.now()) return false;
  return mismoTexto(firma, await firmar(env, `central:${expira}`));
}

// ¿El formulario salió de una página de este mismo panel?
export function vieneDelPanel(request) {
  const url = new URL(request.url);
  const origen = request.headers.get("origin");
  if (origen) return origen === url.origin;
  const sitio = request.headers.get("sec-fetch-site");
  return !sitio || sitio === "same-origin" || sitio === "none";
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
