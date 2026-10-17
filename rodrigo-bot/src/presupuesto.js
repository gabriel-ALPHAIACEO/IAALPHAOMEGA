// CUÁNTAS CONEXIONES LE QUEDAN A ESTA PASADA DEL WORKER (1-oct-2026).
//
// QUÉ PASÓ. El registro de El Emperador se llenó de esto:
//
//   No se pudo llamar a DeepSeek: Too many subrequests by single Worker
//   invocation.
//
// Cloudflare deja que cada pasada del Worker (un mensaje, o una vuelta del
// cron) abra un número limitado de conexiones: 50 en el plan gratis, 1000
// en el de pago. Cada foto que se baja es una, cada llamada a DeepSeek otra,
// cada carpeta de Drive otra, cada mensaje a Instagram otra. Con DeepSeek el
// Worker tiene que BAJAR cada foto antes de mandarla (OpenAI las iba a
// buscar él), así que una tanda del índice de 40 fotos pedía más de 80.
//
// Y lo grave no es el índice: si un cliente manda una foto y el cotejo se
// come las 50, la respuesta al cliente ya no puede salir. Silencio.
//
// QUÉ HACE ESTO. Lleva la cuenta, por pasada, de cuántas conexiones se han
// abierto, y deja preguntar cuántas quedan. Así:
//   · el índice mira solo las fotos que caben, y sigue en la próxima pasada;
//   · el cotejo deja siempre una reserva para contestarle al cliente.
//
// CÓMO. AsyncLocalStorage separa la cuenta de cada pasada aunque el mismo
// Worker atienda varias a la vez (necesita compatibility_flags =
// ["nodejs_als"] en wrangler.toml). Se cuenta envolviendo fetch: todo lo que
// sale por la red pasa por ahí.

import { AsyncLocalStorage } from "node:async_hooks";

const pasadas = new AsyncLocalStorage();

// Plan gratis de Cloudflare. Con el de pago, en wrangler.toml:
//   SUBPETICIONES_MAXIMAS = "1000"
const LIMITE_POR_DEFECTO = 50;

// Lo que se deja siempre libre para contestar: leer el perfil, mandar el
// texto y el carrusel, el aviso a Slack, la llamada que redacta, y algún
// imprevisto.
export const RESERVA_PARA_CONTESTAR = 8;

export function limiteDeSubpeticiones(env) {
  const n = Number(env?.SUBPETICIONES_MAXIMAS);
  return Number.isFinite(n) && n > 0 ? n : LIMITE_POR_DEFECTO;
}

let fetchOriginal = null;

function instalar() {
  // Si alguien cambió fetch (las pruebas lo hacen), se vuelve a envolver el
  // que haya ahora.
  if (globalThis.fetch && globalThis.fetch.__cuenta) return;
  fetchOriginal = globalThis.fetch;
  const envuelto = function (...args) {
    const pasada = pasadas.getStore();
    if (pasada) pasada.usadas++;
    return fetchOriginal.apply(this, args);
  };
  envuelto.__cuenta = true;
  globalThis.fetch = envuelto;
}

// Corre fn como UNA pasada, con su propia cuenta.
export function conPresupuesto(env, fn) {
  instalar();
  return pasadas.run({ usadas: 0, limite: limiteDeSubpeticiones(env) }, fn);
}

// Cuántas conexiones quedan en esta pasada. Fuera de una pasada (pruebas
// sueltas), infinitas: no se limita nada.
export function quedan() {
  const pasada = pasadas.getStore();
  return pasada ? pasada.limite - pasada.usadas : Infinity;
}

export function usadas() {
  return pasadas.getStore()?.usadas ?? 0;
}

// ¿Caben n conexiones más, dejando la reserva para contestar?
export function caben(n, reserva = RESERVA_PARA_CONTESTAR) {
  return quedan() - reserva >= n;
}
