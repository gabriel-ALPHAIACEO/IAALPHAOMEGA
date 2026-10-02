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

// EL FORMATO DE VERDAD, MIRANDO LOS PRIMEROS BYTES (2-oct-2026). El CDN de
// Meta a veces dice "application/octet-stream" o "video/mp4" de una nota de
// voz, y OpenAI decide cómo leer el archivo por su extensión: con la
// extensión equivocada lo rechaza ("Invalid file format"). Así que no se
// confía en lo que dice el CDN: se mira el archivo.
export function formatoDelAudio(datos, tipoDeclarado = "") {
  const b = new Uint8Array(datos.slice ? datos.slice(0, 16) : datos);
  const texto = (desde, n) => String.fromCharCode(...b.slice(desde, desde + n));
  if (texto(4, 4) === "ftyp") return { extension: "m4a", tipo: "audio/mp4" };
  if (texto(0, 4) === "OggS") return { extension: "ogg", tipo: "audio/ogg" };
  if (texto(0, 4) === "RIFF") return { extension: "wav", tipo: "audio/wav" };
  if (texto(0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe6) === 0xe2)) return { extension: "mp3", tipo: "audio/mpeg" };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { extension: "webm", tipo: "audio/webm" };
  if (texto(0, 4) === "fLaC") return { extension: "flac", tipo: "audio/flac" };
  // AAC "suelto" (ADTS): OpenAI no lo lista, pero suele leerlo como mp3/mpga.
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return { extension: "mp3", tipo: "audio/mpeg", aacSuelto: true };
  const declarado = String(tipoDeclarado || "").toLowerCase();
  return { extension: EXTENSIONES[declarado] || "mp4", tipo: declarado.startsWith("audio/") ? declarado : "audio/mp4", desconocido: true };
}

async function bajarAudio(env, url) {
  // Con un agente de navegador: sin él, algunos CDN contestan 403.
  const agente = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36" };
  let respuesta = await fetch(url, { headers: agente });
  // Algunos enlaces del CDN de Meta solo se sirven con el token.
  if ((respuesta.status === 403 || respuesta.status === 401) && env.IG_TOKEN) {
    respuesta = await fetch(url, { headers: { ...agente, authorization: `Bearer ${env.IG_TOKEN}` } });
  }
  if (!respuesta.ok) throw new Error(`no pude bajar el audio de Instagram (${respuesta.status}). El enlace pudo caducar.`);
  const declarado = (respuesta.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const datos = await respuesta.arrayBuffer();
  if (!datos.byteLength) throw new Error("Instagram mandó el audio vacío");
  if (datos.byteLength / (1024 * 1024) > MAXIMO_MB) throw new Error("el audio es demasiado largo");
  if (/text\/html|application\/json/.test(declarado)) throw new Error(`Instagram no mandó un audio sino ${declarado} (¿enlace caducado o protegido?)`);
  const formato = formatoDelAudio(datos, declarado);
  const kb = Math.round(datos.byteLength / 1024);
  console.log(`Voz: audio bajado — ${kb} KB, Instagram dice "${declarado || "(nada)"}", es ${formato.extension}${formato.desconocido ? " (formato no reconocido, pruebo así)" : ""}`);
  return { datos, tipo: formato.tipo, extension: formato.extension, declarado, kb };
}

// Lo que dice OpenAI, en palabras que el dueño pueda arreglar.
function explicarFalloDeOpenAI(estado, detalle) {
  if (estado === 401 && /insufficient permissions|missing scopes|api\.model\.audio/i.test(detalle)) {
    return "la clave de OpenAI no tiene permiso para AUDIO. En platform.openai.com → API keys, edita la clave y dale permiso a 'Model capabilities → Audio' (o crea una con permisos 'All').";
  }
  if (estado === 401) return "la clave de OpenAI no es válida (OPENAI_API_KEY).";
  if (estado === 429 && /quota|billing/i.test(detalle)) return "la cuenta de OpenAI no tiene saldo.";
  if (/invalid file format|unsupported|could not be decoded|audio file/i.test(detalle)) return `OpenAI no pudo leer el audio: ${detalle.slice(0, 160)}`;
  return `OpenAI respondió ${estado}: ${detalle.slice(0, 200)}`;
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
  let primerFallo = "";
  try {
    respuesta = await pedirTranscripcion(env, audio, modelo);
    // Cualquier rechazo que no sea de la clave o del saldo: se prueba con el
    // de siempre (whisper-1), que lee más formatos y está en todas las
    // cuentas.
    if (!respuesta.ok && ![401, 429].includes(respuesta.status) && modelo !== MODELO_DE_RESPALDO) {
      primerFallo = `${modelo}: ${explicarFalloDeOpenAI(respuesta.status, await respuesta.text())}`;
      console.error(`Voz: ${primerFallo} — pruebo con ${MODELO_DE_RESPALDO}`);
      modelo = MODELO_DE_RESPALDO;
      respuesta = await pedirTranscripcion(env, audio, modelo);
    }
  } catch (error) {
    return { texto: "", error: `no se pudo llamar a OpenAI: ${error.message}` };
  }

  if (!respuesta.ok) {
    const detalle = await respuesta.text();
    const motivo = explicarFalloDeOpenAI(respuesta.status, detalle);
    return {
      texto: "",
      error: `${motivo} [audio: ${audio.kb} KB, ${audio.extension}, Instagram dijo "${audio.declarado || "nada"}"]` + (primerFallo ? ` (antes, ${primerFallo})` : ""),
    };
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
   /voz/<id>.aac. Se borran solos al día siguiente.

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
        // AAC por defecto (2-oct-2026): el WAV pesaba ~10 veces más y servirlo
        // pasaba el límite de CPU de Cloudflare ("Exceeded CPU Limit"), así
        // que Instagram no lo podía bajar. VOZ_FORMATO lo cambia si hiciera
        // falta ("mp3", "wav").
        response_format: formatoDeVoz(env).openai,
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
  const f = formatoDeVoz(env);
  return { datos: await respuesta.arrayBuffer(), tipo: f.tipo, extension: f.extension, texto: decir };
}

const FORMATOS_DE_VOZ = {
  aac: { openai: "aac", tipo: "audio/aac", extension: "aac" },
  mp3: { openai: "mp3", tipo: "audio/mpeg", extension: "mp3" },
  wav: { openai: "wav", tipo: "audio/wav", extension: "wav" },
};

export function formatoDeVoz(env = {}) {
  return FORMATOS_DE_VOZ[String(env.VOZ_FORMATO || "aac").toLowerCase()] || FORMATOS_DE_VOZ.aac;
}

// EL AUDIO SE GUARDA EN BASE64 (TEXTO), NO COMO BLOB (2-oct-2026). D1
// devuelve los BLOB como una lista de números, y convertir cientos de miles
// de números en bytes al servirlo se comía el límite de CPU. Un texto en
// base64 se decodifica de una vez.
const TABLA_VOZ = `
  CREATE TABLE IF NOT EXISTS notas_de_voz_b64 (
    id TEXT PRIMARY KEY,
    datos TEXT NOT NULL,
    tipo TEXT NOT NULL,
    creada INTEGER NOT NULL
  )`;

function aBase64(datos) {
  const bytes = new Uint8Array(datos);
  let binario = "";
  const trozo = 0x8000;
  for (let i = 0; i < bytes.length; i += trozo) binario += String.fromCharCode(...bytes.subarray(i, i + trozo));
  return btoa(binario);
}

function deBase64(texto) {
  const binario = atob(texto);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}
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
    .prepare("INSERT INTO notas_de_voz_b64 (id, datos, tipo, creada) VALUES (?, ?, ?, ?)")
    .bind(id, aBase64(datos), tipo, Date.now())
    .run();
  await db.prepare("DELETE FROM notas_de_voz_b64 WHERE creada < ?").bind(Date.now() - 24 * 3600 * 1000).run();
  return id;
}

export async function leerNotaDeVoz(db, id) {
  await asegurarTablaVoz(db);
  const fila = await db.prepare("SELECT datos, tipo FROM notas_de_voz_b64 WHERE id = ?").bind(String(id)).first();
  return fila ? { bytes: deBase64(fila.datos), tipo: fila.tipo } : null;
}

// Solo para las pruebas.
export function olvidarTablaVoz() {
  tablaVozLista = false;
}
