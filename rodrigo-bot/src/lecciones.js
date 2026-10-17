// LA IA APRENDE SOLA DE SUS ERRORES (6-oct-2026, pedido del dueño).
//
// "Que la IA aprenda sola, que se autoescriba, y si hace falta ponerlo en
// el código que me avise a mí y lo ponemos. Así nos ahorramos las
// notificaciones en rojo: que solo aparezcan cuando se tenga que mover el
// código."
//
// CÓMO FUNCIONA
//   1. El revisor (revisor.js, la IA potente que piensa) encuentra un error
//      en una respuesta ya enviada y escribe una REGLA general para no
//      repetirlo ("No confirmes una talla si ninguna ficha la dice").
//   2. Esa regla se guarda aquí, en la base (tabla lecciones). Hay dos
//      tipos: las de la IA de TEXTO y las de la IA de IMÁGENES.
//   3. En cada mensaje, la IA de texto (o la de imágenes, con una foto)
//      recibe sus reglas: "esto ya lo hiciste mal; así es como va".
//      No hace falta desplegar nada: aplica en el siguiente mensaje.
//   4. Si el mismo error se repite VECES_PARA_CODIGO veces pese a la regla,
//      o el revisor dice que eso no se arregla enseñándole (un dato que
//      falta, una búsqueda que no encuentra…), se avisa al dueño UNA vez:
//      🛠️ "hay que ponerlo en el código". Es la ÚNICA alerta del revisor.
//
// LO QUE NO HACE: escribir en los archivos del código. Un Worker no puede
// cambiar su propio código (se cambia al pegar y desplegar), y es mejor así:
// un error suyo no puede tumbar la tienda. Lo que aprende vive en la base,
// el dueño lo ve en su panel ALPHA IA y puede olvidar una regla equivocada.
//
// Se enciende por tienda con APRENDER = "si" en wrangler.toml.

import { alertarCentral } from "./registro.js";

const CREAR = `
  CREATE TABLE IF NOT EXISTS lecciones (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    cuando    INTEGER NOT NULL,
    ultima    INTEGER NOT NULL,
    tipo      TEXT NOT NULL DEFAULT 'texto',
    regla     TEXT NOT NULL DEFAULT '',
    cliente   TEXT NOT NULL DEFAULT '',
    dijo      TEXT NOT NULL DEFAULT '',
    correcto  TEXT NOT NULL DEFAULT '',
    veces     INTEGER NOT NULL DEFAULT 1,
    activa    INTEGER NOT NULL DEFAULT 1,
    codigo    TEXT NOT NULL DEFAULT '',
    avisado   INTEGER NOT NULL DEFAULT 0
  )`;

// Cuántas reglas recibe la IA en cada mensaje: las más recientes y las que
// más se repiten. Más que eso, el prompt crece y las reglas se diluyen.
const REGLAS_EN_EL_PROMPT = 12;
// Las reglas viejas se apagan solas: el catálogo y la tienda cambian.
const DIAS_QUE_DURA = 60;
// Si el mismo error vuelve tantas veces con la regla puesta, no se arregla
// enseñándole: hay que tocar el código.
export const VECES_PARA_CODIGO = 3;
// Dos reglas son "la misma" si comparten al menos esta parte de palabras.
const PARECIDO_MINIMO = 0.5;

let tablaLista = false;
async function asegurar(db) {
  if (tablaLista || !db) return;
  await db.prepare(CREAR).run();
  tablaLista = true;
}

export function aprendeActivo(env) {
  return /^(si|sí|true|1|on)$/i.test(String(env?.APRENDER || "").trim());
}

function palabras(texto) {
  return new Set(
    String(texto || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((p) => p.length > 2)
  );
}

export function parecido(a, b) {
  const x = palabras(a);
  const y = palabras(b);
  if (!x.size || !y.size) return 0;
  let comunes = 0;
  for (const p of x) if (y.has(p)) comunes++;
  return comunes / Math.min(x.size, y.size);
}

const corto = (t, n) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, n);

// Guarda lo que aprendió. Si ya tenía esa regla, cuenta una vez más. Avisa
// al dueño (una sola vez por regla) cuando hay que ponerlo en el código.
// Devuelve { id, veces, aviso } o null.
// CASHEA (Y KRECE) NO SE APRENDEN (9-oct-2026, caso real en Invictus). Los
// porcentajes, las cuotas y la tarjeta los pone el CÓDIGO con la tabla de
// cada tienda, y la tabla cambia: una regla aprendida con la tabla de la
// semana pasada ("Nivel 5 → 10%", "di que hay promoción vigente") le
// enseñaba a la IA justo lo que ya no es verdad. Ni se guardan nuevas, ni
// las que ya estaban le llegan a la IA (siguen viéndose en 🧠 Aprendido).
export const ES_DE_CASHEA = /\b(?:c|k)a(?:s|c)?hea\b|\bkrece\b|\bcuotas?\b|\b(?:la|de|su|una)\s+inicial\b/i;

export async function aprender(env, { tipo = "texto", regla, cliente = "", dijo = "", correcto = "", codigo = "" }) {
  if (!aprendeActivo(env) || !env?.DB || !String(regla || "").trim()) return null;
  if (ES_DE_CASHEA.test(`${regla} ${correcto}`)) {
    console.log(`APRENDER: no guardo una regla de Cashea (la maneja el código): ${String(regla).slice(0, 120)}`);
    return null;
  }
  try {
    await asegurar(env.DB);
    const ahora = Date.now();
    const { results } = await env.DB
      .prepare("SELECT id, regla, veces, avisado, codigo FROM lecciones WHERE tipo = ? AND activa = 1 AND ultima > ?")
      .bind(tipo, ahora - DIAS_QUE_DURA * 86400000)
      .all();
    const igual = (results || []).find((l) => parecido(l.regla, regla) >= PARECIDO_MINIMO);

    let id;
    let veces = 1;
    let avisado = 0;
    let porCodigo = corto(codigo, 300);
    if (igual) {
      id = Number(igual.id);
      veces = Number(igual.veces) + 1;
      avisado = Number(igual.avisado);
      porCodigo = porCodigo || igual.codigo || "";
      await env.DB
        .prepare("UPDATE lecciones SET veces = ?, ultima = ?, cliente = ?, dijo = ?, correcto = ?, codigo = ? WHERE id = ?")
        .bind(veces, ahora, corto(cliente, 300), corto(dijo, 400), corto(correcto, 400), porCodigo, id)
        .run();
    } else {
      const r = await env.DB
        .prepare("INSERT INTO lecciones (cuando, ultima, tipo, regla, cliente, dijo, correcto, codigo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(ahora, ahora, tipo, corto(regla, 300), corto(cliente, 300), corto(dijo, 400), corto(correcto, 400), porCodigo)
        .run();
      id = Number(r?.meta?.last_row_id) || Number((await env.DB.prepare("SELECT MAX(id) AS id FROM lecciones").first())?.id) || 0;
    }
    cache = null;

    // ¿HAY QUE PONERLO EN EL CÓDIGO? Solo entonces se avisa al dueño.
    const hayQueTocarCodigo = Boolean(porCodigo) || veces >= VECES_PARA_CODIGO;
    let aviso = false;
    if (hayQueTocarCodigo && !avisado) {
      const porque = porCodigo
        ? `el revisor dice que no se arregla enseñándole: ${porCodigo}`
        : `la IA lo repitió ${veces} veces aunque ya tenía la regla`;
      aviso = await alertarCentral(env, [
        {
          tipo: "codigo",
          texto: `🛠️ Hay que ponerlo en el código (IA de ${tipo === "imagen" ? "imágenes" : "texto"}): ${corto(regla, 200)}\nPor qué: ${porque}\nÚltimo caso: el cliente escribió "${corto(cliente, 120)}" y se respondió "${corto(dijo, 160)}"`,
        },
      ]);
      await env.DB.prepare("UPDATE lecciones SET avisado = 1 WHERE id = ?").bind(id).run();
      console.log(`APRENDIZAJE: 🛠️ hay que ponerlo en el código (${porque})`);
    } else {
      console.log(`APRENDIZAJE: regla ${igual ? `repetida (${veces} veces)` : "nueva"} para la IA de ${tipo}: ${corto(regla, 160)}`);
    }
    return { id, veces, aviso: hayQueTocarCodigo };
  } catch (error) {
    console.error("APRENDIZAJE: no pude guardar la regla:", error?.message || error);
    return null;
  }
}

// Las reglas activas de un tipo, de la más repetida a la menos (y de la
// más reciente a la más vieja).
export async function reglasActivas(db, tipo, cuantas = REGLAS_EN_EL_PROMPT) {
  if (!db) return [];
  try {
    await asegurar(db);
    const { results } = await db
      .prepare("SELECT id, regla, correcto, veces FROM lecciones WHERE tipo = ? AND activa = 1 AND ultima > ? ORDER BY veces DESC, ultima DESC LIMIT ?")
      .bind(tipo, Date.now() - DIAS_QUE_DURA * 86400000, cuantas * 3)
      .all();
    // Las de Cashea no le llegan a la IA (ver ES_DE_CASHEA).
    return (results || []).filter((l) => !ES_DE_CASHEA.test(`${l.regla} ${l.correcto || ""}`)).slice(0, cuantas);
  } catch {
    return [];
  }
}

// Lo que se le pega a la IA en cada mensaje. Se recuerda un minuto en
// memoria: cada mensaje no tiene por qué ir a la base a buscarlas.
let cache = null;
export async function reglasParaLaIA(env, tipo) {
  if (!aprendeActivo(env) || !env?.DB) return "";
  if (cache?.[tipo] && cache.vence > Date.now()) return cache[tipo];
  const lista = await reglasActivas(env.DB, tipo);
  const texto = lista.length
    ? [
        tipo === "imagen"
          ? "LO QUE YA APRENDISTE MIRANDO FOTOS (errores tuyos que encontró el revisor; no los repitas):"
          : "LO QUE YA APRENDISTE (errores tuyos que encontró el revisor; no los repitas):",
        ...lista.map((l, i) => `${i + 1}. ${l.regla}`),
      ].join("\n")
    : "";
  cache = { ...(cache && cache.vence > Date.now() ? cache : {}), [tipo]: texto, vence: Date.now() + 60 * 1000 };
  return texto;
}

// Para el panel ALPHA IA: todas, con las apagadas al final.
export async function listarLecciones(db) {
  if (!db) return [];
  try {
    await asegurar(db);
    const { results } = await db
      .prepare("SELECT id, cuando, ultima, tipo, regla, cliente, dijo, correcto, veces, activa, codigo, avisado FROM lecciones ORDER BY activa DESC, avisado DESC, veces DESC, ultima DESC LIMIT 200")
      .all();
    return (results || []).map((l) => ({
      ...l,
      id: Number(l.id),
      cuando: Number(l.cuando),
      ultima: Number(l.ultima),
      veces: Number(l.veces),
      activa: Boolean(Number(l.activa)),
      avisado: Boolean(Number(l.avisado)),
      hayQueTocarCodigo: Boolean(l.codigo) || Number(l.veces) >= VECES_PARA_CODIGO,
    }));
  } catch {
    return [];
  }
}

// El dueño la olvida (estaba mal, o ya se puso en el código).
export async function olvidarLeccion(db, id) {
  if (!db) return false;
  await asegurar(db);
  await db.prepare("UPDATE lecciones SET activa = 0 WHERE id = ?").bind(Number(id)).run();
  cache = null;
  return true;
}
