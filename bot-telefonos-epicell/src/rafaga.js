// LOS MENSAJES REPETIDOS Y LOS MENSAJES SEGUIDOS (13-oct-2026, pedido del
// dueño: "vamos a hacer lo que sí vale la pena y sin cambiar la estructura").
//
// DOS COSAS, LAS DOS EN LA MISMA BASE D1 DE LA TIENDA (tabla
// mensajes_recibidos, creada por código):
//
// 1. UN MENSAJE SE ATIENDE UNA SOLA VEZ. Meta repite el aviso de un mensaje
//    cuando cree que no le llegó (un corte, una demora): el cliente recibía
//    dos respuestas y la IA se pagaba dos veces. Cada mensaje trae su
//    identificador (mid, o el id de WhatsApp); el segundo aviso del mismo
//    se descarta. Vale para Instagram, WhatsApp y los ecos.
//
// 2. LOS MENSAJES SEGUIDOS SE CONTESTAN JUNTOS. "hola" / "tienes" / "la
//    camisa roja?" en dos segundos eran tres respuestas y tres llamadas a la
//    IA, cada una sin saber de las otras. Ahora un mensaje de texto espera
//    unos segundos (JUNTAR_SEGUNDOS, 3 si no se pone): si en ese rato llegó
//    otro del mismo cliente, se calla y el último contesta todo junto
//    ("hola\ntienes\nla camisa roja?"). Una foto o una respuesta a una
//    historia no esperan (ya tardan lo suyo en mirarse), pero se llevan el
//    texto que el cliente escribió justo antes: "¿tienes este?" + la foto
//    es UNA pregunta.
//
// LO QUE NO SE JUNTA. Los ecos, las notas de voz, los botones (opcion), lo
// que viene de un anuncio y los comentarios siguen exactamente como antes.
//
// SE APAGA con JUNTAR_MENSAJES = "no" en wrangler.toml (vuelve a contestar
// cada mensaje por separado). Lo de no atender dos veces el mismo mensaje no
// se apaga: no tiene contra.
//
// SI LA BASE FALLA, SE CONTESTA COMO ANTES: mejor un posible doble que un
// cliente sin respuesta. Nada de esto toca el stock ni el contenido de la
// conversación: solo decide QUIÉN contesta.
//
// ESTE ARCHIVO ES IGUAL EN LAS TRES TIENDAS.

export const ESPERA_POR_DEFECTO_MS = 3000;
// Más de esto y el cliente piensa que nadie le contesta; además, los
// 30 s que da Cloudflare a cada turno se los come la espera.
const ESPERA_MAXIMA_MS = 8000;
// Solo se juntan los mensajes de los últimos dos minutos: uno más viejo que
// se quedó sin atender (el Worker se cortó) no se arrastra a otra charla.
const VENTANA_MS = 2 * 60 * 1000;
// Lo de hace más de 48 h ya no lo repite Meta: se borra.
const GUARDAR_MS = 48 * 60 * 60 * 1000;

const CREAR = `CREATE TABLE IF NOT EXISTS mensajes_recibidos (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  mid       TEXT NOT NULL UNIQUE,
  igsid     TEXT NOT NULL,
  tipo      TEXT NOT NULL,
  texto     TEXT NOT NULL DEFAULT '',
  llego     INTEGER NOT NULL,
  junta     INTEGER NOT NULL DEFAULT 0,
  atendido  INTEGER NOT NULL DEFAULT 0,
  repetidos INTEGER NOT NULL DEFAULT 0
)`;
const INDICE = "CREATE INDEX IF NOT EXISTS mensajes_recibidos_cliente ON mensajes_recibidos (igsid, id)";

let lista = false;

async function asegurar(db) {
  if (lista) return;
  await db.batch([db.prepare(CREAR), db.prepare(INDICE)]);
  lista = true;
}

export function olvidarQueRafagaEstaLista() {
  lista = false;
}

export function juntarActivado(env) {
  return !/^(no|off|false|0|apagado)$/i.test(String(env?.JUNTAR_MENSAJES ?? "").trim());
}

export function esperaDeRafaga(env) {
  const puesto = Number(String(env?.JUNTAR_SEGUNDOS ?? "").trim().replace(",", "."));
  if (!String(env?.JUNTAR_SEGUNDOS ?? "").trim() || !Number.isFinite(puesto) || puesto < 0) return ESPERA_POR_DEFECTO_MS;
  return Math.min(Math.round(puesto * 1000), ESPERA_MAXIMA_MS);
}

// Qué hace cada mensaje con los demás:
//   "espera"  texto suelto: espera, y el último de la ráfaga contesta.
//   "junta"   foto o historia: no espera, pero se lleva el texto de antes.
//   ""        lo demás: se atiende solo, como siempre.
function papel(mensaje) {
  if (mensaje.opcion || mensaje.anuncio) return "";
  if (mensaje.tipo === "texto") return "espera";
  if (mensaje.tipo === "imagen" || mensaje.tipo === "historia") return "junta";
  return "";
}

const esRepetido = (error) => /UNIQUE|PRIMARY KEY|constraint/i.test(String(error?.message || error || ""));

// Lo anota y dice si hay que atenderlo. Devuelve el mensaje (con el texto
// de la ráfaga, si se juntó con otros) o null si no hay que atenderlo: ya
// se atendió, o lo contesta otro que llegó detrás.
//
// opciones.dormir: para las pruebas.
export async function recibirMensaje(env, mensaje, { dormir = (ms) => new Promise((seguir) => setTimeout(seguir, ms)) } = {}) {
  const db = env?.DB;
  const mid = String(mensaje?.mid || "").trim();
  if (!db || !mid || !mensaje?.igsid || mensaje.tipo === "comentario") return mensaje;

  const juntar = juntarActivado(env);
  const rol = juntar ? papel(mensaje) : "";
  const ahora = Date.now();

  // 1. ¿YA LLEGÓ ANTES?
  let id = 0;
  try {
    const insertar = () =>
      db
        .prepare("INSERT INTO mensajes_recibidos (mid, igsid, tipo, texto, llego, junta) VALUES (?, ?, ?, ?, ?, ?) RETURNING id")
        .bind(mid.slice(0, 300), String(mensaje.igsid), String(mensaje.tipo || ""), String(mensaje.texto || "").slice(0, 2000), ahora, rol ? 1 : 0)
        .first();
    let fila;
    try {
      fila = await insertar();
    } catch (error) {
      if (!/no such table/i.test(String(error?.message || ""))) throw error;
      lista = false;
      await asegurar(db);
      fila = await insertar();
    }
    id = Number(fila?.id) || 0;
  } catch (error) {
    if (esRepetido(error)) {
      console.log(`Meta → el mensaje ${mid.slice(0, 40)} de ${mensaje.igsid} ya llegó antes: no lo atiendo dos veces`);
      await db
        .prepare("UPDATE mensajes_recibidos SET repetidos = repetidos + 1 WHERE mid = ?")
        .bind(mid.slice(0, 300))
        .run()
        .catch(() => {});
      return null;
    }
    console.error(`Mensajes recibidos: no pude anotar ${mid.slice(0, 40)} (${error?.message || error}); lo atiendo igual`);
    return mensaje;
  }

  // De vez en cuando, lo viejo fuera (uno de cada 50 mensajes, sin esperar).
  if (Math.random() < 0.02) {
    await db.prepare("DELETE FROM mensajes_recibidos WHERE llego < ?").bind(ahora - GUARDAR_MS).run().catch(() => {});
  }

  // Sin un id (una base que no devuelve RETURNING) no se puede juntar nada.
  if (!rol || !id) return mensaje;

  try {
    // 2. EL TEXTO ESPERA A VER SI EL CLIENTE SIGUE ESCRIBIENDO.
    if (rol === "espera") {
      await dormir(esperaDeRafaga(env));
      const detras = await db
        .prepare("SELECT id FROM mensajes_recibidos WHERE igsid = ? AND junta = 1 AND id > ? LIMIT 1")
        .bind(String(mensaje.igsid), id)
        .first();
      if (detras) {
        console.log(`Ráfaga de ${mensaje.igsid}: llegó otro mensaje detrás, contesta ese con todo junto`);
        return null;
      }
    }

    // 3. ESTE CONTESTA: se queda con todo lo que el cliente mandó antes y
    // nadie contestó todavía. Un solo UPDATE: dos que lleguen a la vez no
    // se quedan con el mismo mensaje.
    const tomados = (
      await db
        .prepare(
          "UPDATE mensajes_recibidos SET atendido = ? WHERE igsid = ? AND junta = 1 AND atendido = 0 AND id <= ? AND llego >= ? RETURNING id, tipo, texto"
        )
        .bind(id, String(mensaje.igsid), id, ahora - VENTANA_MS)
        .all()
    )?.results;
    if (!Array.isArray(tomados)) return mensaje;

    // El suyo se lo llevó otro (una foto que llegó detrás y no esperó).
    if (!tomados.some((t) => Number(t.id) === id)) {
      console.log(`Ráfaga de ${mensaje.igsid}: este mensaje ya lo contestó otro junto con el suyo`);
      return null;
    }

    const antes = tomados
      .filter((t) => Number(t.id) !== id && t.tipo === "texto")
      .sort((a, b) => Number(a.id) - Number(b.id))
      .map((t) => String(t.texto || "").trim())
      .filter(Boolean);
    if (!antes.length) return mensaje;

    const texto = [...antes, String(mensaje.texto || "").trim()].filter(Boolean).join("\n");
    console.log(`Ráfaga de ${mensaje.igsid}: junto ${antes.length + 1} mensajes en una sola respuesta → ${JSON.stringify(texto.slice(0, 120))}`);
    return { ...mensaje, texto, juntados: antes.length + 1 };
  } catch (error) {
    console.error(`Ráfaga de ${mensaje.igsid}: no pude mirar los mensajes de al lado (${error?.message || error}); contesto este solo`);
    return mensaje;
  }
}

// Para /estado: lo de las últimas 48 h.
export async function cuentaDeRafagas(db) {
  try {
    const f = await db
      .prepare(
        `SELECT COUNT(*) AS recibidos,
                COALESCE(SUM(repetidos), 0) AS repetidos,
                COALESCE(SUM(CASE WHEN junta = 1 AND atendido > 0 AND atendido <> id THEN 1 ELSE 0 END), 0) AS juntados
           FROM mensajes_recibidos WHERE llego >= ?`
      )
      .bind(Date.now() - GUARDAR_MS)
      .first();
    return { recibidos: Number(f?.recibidos) || 0, repetidos: Number(f?.repetidos) || 0, juntados: Number(f?.juntados) || 0 };
  } catch {
    return { recibidos: 0, repetidos: 0, juntados: 0 };
  }
}
