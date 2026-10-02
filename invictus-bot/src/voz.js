// LAS NOTAS DE VOZ DEL CLIENTE (2-oct-2026).
//
// QUÉ SE PEDÍA. "¿Y que reconozca nota de voz?". Mucha gente en Venezuela
// no escribe: manda un audio —"hola, ¿tienes las Jordan 4 en negro?"— y
// hasta hoy el bot no lo entendía, así que ese cliente se quedaba sin
// respuesta.
//
// CÓMO. El audio se baja de Instagram y se manda a OpenAI para pasarlo a
// texto (OPENAI_MODELO_AUDIO, por defecto gpt-4o-mini-transcribe; si esa
// cuenta no lo tiene, whisper-1). Lo transcrito entra al bot como si el
// cliente lo hubiera escrito: busca, enseña fotos, Cashea, todo igual.
//
// CUESTA POCO: unos $0,003 por minuto de audio, y las notas de voz de un
// cliente suelen durar segundos.
//
// SI NO SE PUEDE ESCUCHAR (el enlace caducó, OpenAI falló), no se queda
// callado: le pide con amabilidad que lo escriba (ver PEDIR_QUE_ESCRIBA).

const API = "https://api.openai.com/v1/audio/transcriptions";
const MODELO_POR_DEFECTO = "gpt-4o-mini-transcribe";
const MODELO_DE_RESPALDO = "whisper-1";

// OpenAI acepta hasta 25 MB; una nota de voz de Instagram pesa mucho menos.
const MAXIMO_MB = 20;

// Las palabras de la tienda, para que la transcripción no escriba "Yordan"
// o "Kashea": se le pasan como pista.
const PISTA =
  "Cliente de una tienda de zapatos en Venezuela (Invictus Shoes). Marcas y palabras: " +
  "Nike, Adidas, Jordan, Air Force One, Air Max, New Balance, Puma, Vans, Crocs, " +
  "Yeezy, Samba, Campus, Cashea, talla, precio, dama, caballero, cholas, delivery.";

export const PEDIR_QUE_ESCRIBA =
  "¡Hola! 😊 Ahorita no logré escuchar tu nota de voz. ¿Me escribes qué estás buscando? Así te ayudo enseguida";

// La nota que le dice a la IA de texto que esto vino por voz: la
// transcripción puede traer alguna palabra mal entendida.
export function notaDeVoz() {
  return (
    "[EL CLIENTE MANDÓ UNA NOTA DE VOZ: su mensaje es la transcripción. Si una " +
    "palabra no cuadra, es un error al transcribir: entiende lo que quiso decir " +
    "(como con quien escribe mal) y NO le digas que no se entiende]"
  );
}

const EXTENSIONES = {
  "audio/mp4": "mp4",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/aac": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "video/mp4": "mp4",
};

async function bajarAudio(env, url) {
  let respuesta = await fetch(url);
  // Algunos enlaces del CDN de Meta solo se sirven con el token.
  if (respuesta.status === 403 && env.IG_TOKEN) {
    respuesta = await fetch(url, { headers: { authorization: `Bearer ${env.IG_TOKEN}` } });
  }
  if (!respuesta.ok) throw new Error(`no pude bajar el audio (${respuesta.status})`);
  const tipo = (respuesta.headers.get("content-type") || "audio/mp4").split(";")[0].trim().toLowerCase();
  const datos = await respuesta.arrayBuffer();
  if (datos.byteLength / (1024 * 1024) > MAXIMO_MB) throw new Error("el audio es demasiado largo");
  return { datos, tipo, extension: EXTENSIONES[tipo] || "mp4" };
}

async function pedirTranscripcion(env, audio, modelo) {
  const formulario = new FormData();
  formulario.append("file", new Blob([audio.datos], { type: audio.tipo }), `nota.${audio.extension}`);
  formulario.append("model", modelo);
  formulario.append("language", "es");
  formulario.append("prompt", PISTA);
  return fetch(API, {
    method: "POST",
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: formulario,
  });
}

// Devuelve { texto, modelo } o { texto: "", error }.
export async function transcribirAudio(env, url, { anotar = null } = {}) {
  if (!url) return { texto: "", error: "no hay audio" };
  if (!env.OPENAI_API_KEY) return { texto: "", error: "falta OPENAI_API_KEY" };

  let audio;
  try {
    audio = await bajarAudio(env, url);
  } catch (error) {
    return { texto: "", error: error.message };
  }

  const preferido = env.OPENAI_MODELO_AUDIO || MODELO_POR_DEFECTO;
  let modelo = preferido;
  let respuesta;
  try {
    respuesta = await pedirTranscripcion(env, audio, modelo);
    // La cuenta no tiene ese modelo: se prueba con el de siempre.
    if (!respuesta.ok && (respuesta.status === 400 || respuesta.status === 404) && modelo !== MODELO_DE_RESPALDO) {
      console.error(`Voz: ${modelo} no disponible (${respuesta.status}), pruebo con ${MODELO_DE_RESPALDO}`);
      modelo = MODELO_DE_RESPALDO;
      respuesta = await pedirTranscripcion(env, audio, modelo);
    }
  } catch (error) {
    return { texto: "", error: `no se pudo llamar a OpenAI: ${error.message}` };
  }

  if (!respuesta.ok) {
    const detalle = await respuesta.text();
    return { texto: "", error: `OpenAI respondió ${respuesta.status}: ${detalle.slice(0, 200)}` };
  }

  const datos = await respuesta.json();
  const texto = String(datos.text || "").trim();

  if (datos.usage && typeof anotar === "function") {
    await anotar({
      modelo,
      entrada: datos.usage.input_tokens || 0,
      cacheadas: 0,
      salida: datos.usage.output_tokens || 0,
    });
  }

  return texto ? { texto, modelo } : { texto: "", error: "el audio no tenía palabras" };
}

/* ── Y CONTESTAR CON VOZ (2-oct-2026, dueño: "claro que sí") ─────────────
   Cuando el cliente HABLÓ con voz, el bot le contesta también con una nota
   de voz, además del texto de siempre (por si no puede escucharla ahora).

   QUÉ SE DICE POR VOZ: solo la frase de la IA. Nunca precios, Cashea,
   métodos de pago ni la dirección: eso va por escrito, como siempre, para
   que quede y se pueda copiar. Las fotos siguen saliendo igual.

   CÓMO: OpenAI convierte el texto en voz (OPENAI_MODELO_VOZ, por defecto
   gpt-4o-mini-tts; voz OPENAI_VOZ, por defecto "nova"). Instagram necesita
   un ENLACE al audio, así que se guarda en D1 y lo sirve el propio Worker en
   /voz/<id>.wav. Se borran solos al día siguiente.

   Si algo falla, no pasa nada: el texto ya le llegó.
   ───────────────────────────────────────────────────────────────────── */

const API_VOZ = "https://api.openai.com/v1/audio/speech";
const MODELO_VOZ_POR_DEFECTO = "gpt-4o-mini-tts";
const VOZ_POR_DEFECTO = "nova";
const INSTRUCCIONES_VOZ =
  "Habla en español latinoamericano, con acento venezolano suave y neutro. " +
  "Tono cálido, alegre y cercano, como una vendedora amable de una tienda de zapatos. " +
  "Ritmo natural, sin prisa, como una nota de voz de WhatsApp.";

// Lo que va por voz: sin emojis, sin enlaces, y corto (una nota de voz de
// 20 segundos como mucho).
const MAXIMO_LETRAS_VOZ = 350;

export function textoParaVoz(texto) {
  const limpio = String(texto || "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\p{Extended_Pictographic}|️|‍/gu, "")
    .replace(/[*_#•🔹]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (limpio.length <= MAXIMO_LETRAS_VOZ) return limpio;
  // Se corta en la última frase completa que quepa.
  const corte = limpio.slice(0, MAXIMO_LETRAS_VOZ);
  const fin = Math.max(corte.lastIndexOf(". "), corte.lastIndexOf("? "), corte.lastIndexOf("! "));
  return (fin > 80 ? corte.slice(0, fin + 1) : corte).trim();
}

export async function sintetizarVoz(env, texto) {
  const decir = textoParaVoz(texto);
  if (!decir || !env.OPENAI_API_KEY) return null;
  let respuesta;
  try {
    respuesta = await fetch(API_VOZ, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: env.OPENAI_MODELO_VOZ || MODELO_VOZ_POR_DEFECTO,
        voice: env.OPENAI_VOZ || VOZ_POR_DEFECTO,
        input: decir,
        instructions: INSTRUCCIONES_VOZ,
        // WAV: es el formato que Instagram acepta sin sorpresas.
        response_format: "wav",
      }),
    });
  } catch (error) {
    console.error("Voz: no se pudo llamar a OpenAI para hablar:", error.message);
    return null;
  }
  if (!respuesta.ok) {
    console.error("Voz: OpenAI no generó el audio:", respuesta.status, (await respuesta.text()).slice(0, 200));
    return null;
  }
  return { datos: await respuesta.arrayBuffer(), tipo: "audio/wav", texto: decir };
}

const TABLA_VOZ = `
  CREATE TABLE IF NOT EXISTS notas_de_voz (
    id TEXT PRIMARY KEY,
    datos BLOB NOT NULL,
    tipo TEXT NOT NULL,
    creada INTEGER NOT NULL
  )`;
let tablaVozLista = false;

async function asegurarTablaVoz(db) {
  if (tablaVozLista) return;
  await db.prepare(TABLA_VOZ).run();
  tablaVozLista = true;
}

// Guarda el audio y devuelve su id. Los de hace más de un día se borran.
export async function guardarNotaDeVoz(db, { datos, tipo }) {
  await asegurarTablaVoz(db);
  const id = crypto.randomUUID().replace(/-/g, "");
  await db
    .prepare("INSERT INTO notas_de_voz (id, datos, tipo, creada) VALUES (?, ?, ?, ?)")
    .bind(id, new Uint8Array(datos), tipo, Date.now())
    .run();
  await db.prepare("DELETE FROM notas_de_voz WHERE creada < ?").bind(Date.now() - 24 * 3600 * 1000).run();
  return id;
}

export async function leerNotaDeVoz(db, id) {
  await asegurarTablaVoz(db);
  const fila = await db.prepare("SELECT datos, tipo FROM notas_de_voz WHERE id = ?").bind(String(id)).first();
  return fila ? { datos: fila.datos, tipo: fila.tipo } : null;
}

// Solo para las pruebas.
export function olvidarTablaVoz() {
  tablaVozLista = false;
}
