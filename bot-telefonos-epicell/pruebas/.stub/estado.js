// Memoria del bot: quién es cada cliente, qué se habló y si un asesor tomó
// la conversación. Vive en D1, la base de datos de Cloudflare.
//
// Antes esto quedaba sin usar: el historial vivía en los campos de
// ManyChat. Con ManyChat retirado (19-sep-2026), esta es la ÚNICA memoria
// del bot entre un mensaje y el siguiente — hace falta la tabla creada
// (ver migrations/0001_contactos.sql) y el binding "DB" en wrangler.toml.

const MAX_MIDS = 20;

// Cuántos títulos de producto se recuerdan por cliente. Con esto cubre una
// conversación larga sin repetirse; más que esto solo engorda la fila.
const MAX_MOSTRADOS = 40;

export async function cargarContacto(db, id) {
  const fila = await db
    .prepare("SELECT * FROM contactos WHERE id = ?")
    .bind(id)
    .first();

  if (!fila) {
    return {
      id,
      nombre: "",
      nombre_completo: "",
      usuario: "",
      historial: "",
      pausado_hasta: 0,
      mids_enviados: [],
      ultimo_envio: 0,
      mostrados: [],
      ultima_respuesta: "",
      ultimos_productos: [],
      ultimos_textos: [],
      publicacion: null,
    };
  }

  return {
    id: fila.id,
    // "nombre" es SOLO el primer nombre, el que se usa para saludar ("¡Hola,
    // María!"). Queda vacío si el perfil no trae un nombre de persona.
    // "nombre_completo" y "usuario" son para el dueño: Slack y /estado.
    nombre: fila.nombre || "",
    nombre_completo: fila.nombre_completo || "",
    usuario: fila.usuario || "",
    historial: fila.historial || "",
    pausado_hasta: Number(fila.pausado_hasta) || 0,
    mids_enviados: leerLista(fila.mids_enviados),
    ultimo_envio: Number(fila.ultimo_envio) || 0,
    // Los títulos que este cliente YA vio. Sin esto, pedir "más" le devuelve
    // el mismo carrusel (ver migrations/0003_mostrados.sql).
    mostrados: leerLista(fila.mostrados),
    // Lo último que se le dijo, tal cual salió. Es de donde se recupera
    // "muéstrame esos".
    ultima_respuesta: fila.ultima_respuesta || "",
    // Los títulos del ÚLTIMO carrusel que se le mandó. Es lo que permite
    // volver a enseñárselos sin buscar otra vez —"¿y en divisas?"— sin
    // depender de que el modelo acierte el término dos veces seguidas.
    ultimos_productos: leerLista(fila.ultimos_productos),
    // Los últimos mensajes de TEXTO que salieron de la cuenta por mano del
    // bot. Es la segunda forma de reconocer su propio eco, la que funciona
    // aunque el mid no cuadre (ver esEcoPorTexto).
    ultimos_textos: leerLista(fila.ultimos_textos),
    // La publicación del feed que acaba de compartir, si fue hace poco. Es
    // lo que une los DOS webhooks de "compartir + preguntar" en una sola
    // respuesta (ver publicacion.js).
    publicacion: leerPublicacion(fila.publicacion),
  };
}

/* ── La publicación que acaba de compartir ────────────────────────── */

// POR QUÉ ESTO VIVE EN LA BASE Y NO EN UNA VARIABLE.
//
// Compartir una publicación y escribir "precio?" son DOS mensajes, y Meta
// los manda como dos webhooks distintos que el Worker atiende en paralelo,
// cada uno en su propia petición. No comparten memoria: lo único que los
// dos ven es D1. Sin esto, el que atiende la publicación y el que atiende
// la pregunta contestan por separado — que es exactamente el mensaje
// repetido que se vio en producción.
//
// "atendida" es la bandera que impide la segunda respuesta. Se marca ANTES
// de llamar al modelo, no después: la llamada tarda segundos y en esa
// ventana es cuando el otro webhook está decidiendo si contesta.
export async function guardarPublicacion(db, id, publicacion) {
  const valor = JSON.stringify({
    url: publicacion.url || "",
    imagen: publicacion.imagen || "",
    titulo: publicacion.titulo || "",
    descripcion: publicacion.descripcion || "",
    enlace: publicacion.enlace || "",
    termino: publicacion.termino || "",
    cuando: Number(publicacion.cuando) || Date.now(),
    atendida: Boolean(publicacion.atendida),
  });

  const guardar = () =>
    db
      .prepare(
        `INSERT INTO contactos (id, nombre, historial, pausado_hasta, mids_enviados, publicacion)
         VALUES (?, '', '', 0, '[]', ?)
         ON CONFLICT(id) DO UPDATE SET publicacion = excluded.publicacion`
      )
      .bind(id, valor)
      .run();

  try {
    await guardar();
  } catch (error) {
    if (!faltaColumna(error)) throw error;
    await asegurarColumnas(db, { aunqueYaSeRevisara: true });
    await guardar();
  }
}

// ¿Sigue valiendo lo que compartió? Fuera de la ventana es una publicación
// vieja, y darle el precio de aquello a un "precio?" de hoy es el mismo
// fallo que historial.js pelea con el recorte.
export function publicacionVigente(contacto, ventanaMs, ahora = Date.now()) {
  const guardada = contacto.publicacion;
  if (!guardada) return null;
  if (ahora - (Number(guardada.cuando) || 0) > ventanaMs) return null;
  return guardada;
}

function leerPublicacion(valor) {
  if (!valor) return null;
  try {
    const datos = JSON.parse(valor);
    return datos && typeof datos === "object" ? datos : null;
  } catch {
    return null;
  }
}

// ¿Este producto ya se lo mandamos? Se compara sin tildes, sin mayúsculas y
// sin espacios de más: el mismo título vuelve de Shopify siempre igual, pero
// no cuesta nada blindarlo.
export function yaLoVio(mostrados, titulo) {
  const clave = normalizar(titulo);
  if (!clave) return false;
  return mostrados.some((visto) => normalizar(visto) === clave);
}

// Añade títulos sin duplicar y dejando los últimos.
export function conProductosMostrados(mostrados, productos) {
  const lista = [...mostrados];
  for (const producto of productos) {
    if (!yaLoVio(lista, producto.titulo)) lista.push(producto.titulo);
  }
  return lista.slice(-MAX_MOSTRADOS);
}

function cuantoFalta(ms) {
  const minutos = Math.round(ms / 60000);
  if (minutos < 60) return `le quedan ${minutos} min de pausa`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return `le quedan ${horas}h ${resto}min de pausa`;
}

function normalizar(titulo) {
  return String(titulo || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Deja constancia de que el bot ACABA de mandar algo, en el momento exacto
// en que lo mandó — no al final de atender el mensaje.
//
// POR QUÉ EXISTE ESTO APARTE. Meta devuelve un "eco" de cada mensaje que
// sale de la cuenta, y ese eco llega como una petición nueva al webhook,
// en paralelo. Si para cuando llega todavía no habíamos anotado el mid,
// el bot no reconoce su propio mensaje, cree que lo escribió un asesor
// humano y se pausa a sí mismo. Pasó en producción: cinco de siete
// conversaciones quedaron mudas. Por eso el mid se guarda inmediatamente
// después de enviar, antes de Slack y antes de cualquier otra cosa lenta.
export async function marcarEnvio(db, id, mids, cuando = Date.now(), textos = []) {
  const guardar = () =>
    db
      .prepare(
        `INSERT INTO contactos (id, nombre, historial, pausado_hasta, mids_enviados, ultimo_envio, ultimos_textos)
         VALUES (?, '', '', 0, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           mids_enviados = excluded.mids_enviados,
           ultimo_envio = excluded.ultimo_envio,
           ultimos_textos = excluded.ultimos_textos`
      )
      .bind(
        id,
        JSON.stringify(mids.slice(-MAX_MIDS)),
        cuando,
        JSON.stringify(textos.slice(-MAX_TEXTOS).map(huella))
      )
      .run();

  try {
    await guardar();
  } catch (error) {
    if (!faltaColumna(error)) throw error;
    await asegurarColumnas(db, { aunqueYaSeRevisara: true });
    await guardar();
  }
}

// EL ECO SE RECONOCE TAMBIÉN POR EL TEXTO (24-sep-2026).
//
// EL FALLO QUE ESTO ARREGLA. El bot se pausaba solo con clientes a los que
// ningún asesor había tocado, y desde esa pausa dejaba de responder aunque
// el cliente siguiera preguntando. La pausa la dispara el eco de un mensaje
// que salió de la cuenta y cuyo mid el bot no reconoce como suyo — y el mid
// falla más de lo que parecía: si el envío no devolvió identificador, si la
// escritura en D1 llegó tarde, o si Meta manda el eco con otro.
//
// El texto no falla. Si lo que rebota es palabra por palabra lo que el bot
// acaba de escribir, es suyo, y no hay más que discutir. Se guardan los
// últimos, no solo el último, porque un turno manda varios mensajes.
//
// Se compara por "huella": sin mayúsculas, sin tildes, sin espacios de más
// y recortado. Un asesor que copie y pegue EXACTAMENTE un mensaje del bot
// no pausaría; es un precio ridículo comparado con una hora de silencio
// con un cliente que está preguntando.
const MAX_TEXTOS = 6;
const LARGO_HUELLA = 160;

function huella(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LARGO_HUELLA);
}

export function esEcoPorTexto(contacto, texto) {
  const suya = huella(texto);
  if (!suya) return false;
  return (contacto.ultimos_textos || []).some((guardada) => guardada === suya);
}

// La red de seguridad del párrafo de arriba: aunque el mid no aparezca en
// la lista (porque el eco ganó la carrera de todas formas), si el bot
// mandó algo hace nada, ese eco es casi con certeza suyo. Un asesor humano
// que justo escribe en esa misma ventana solo retrasa la pausa hasta su
// mensaje siguiente; confundir el eco propio, en cambio, deja al cliente
// sin atención durante horas.
const VENTANA_ECO_PROPIO_MS = 90 * 1000;

export function envioReciente(contacto, ahora = Date.now(), ventana = VENTANA_ECO_PROPIO_MS) {
  const ultimo = Number(contacto.ultimo_envio) || 0;
  return ultimo > 0 && ahora - ultimo < ventana;
}

// UN ECO SIN TEXTO CASI SIEMPRE ES NUESTRO CARRUSEL.
//
// Las fichas de producto salen como adjunto, así que su eco vuelve sin una
// sola letra: no hay texto que comparar y, si además el mid no cuadró, lo
// único que queda es el reloj. Por eso aquí la ventana es más ancha que los
// 90 segundos: un turno que manda texto + fichas + botón puede tardar.
//
// Lo que se pierde: un asesor que mande una FOTO en esos minutos no pausa
// el bot. Lo que se gana: el carrusel del propio bot deja de pausarlo. En
// cuanto ese asesor escriba una línea, la pausa entra igual.
export const VENTANA_ECO_SIN_TEXTO_MS = 5 * 60 * 1000;

export async function guardarContacto(db, contacto) {
  // Solo guardamos los últimos: la lista existe para reconocer ecos recientes,
  // no para ser un archivo histórico.
  const mids = contacto.mids_enviados.slice(-MAX_MIDS);

  const mostrados = (contacto.mostrados || []).slice(-MAX_MOSTRADOS);

  const datos = [
    contacto.id,
    contacto.nombre || "",
    contacto.nombre_completo || "",
    contacto.usuario || "",
    contacto.historial || "",
    Number(contacto.pausado_hasta) || 0,
    JSON.stringify(mids),
    Number(contacto.ultimo_envio) || 0,
    JSON.stringify(mostrados),
    // Se recorta: es para volver sobre el último mensaje, no para
    // guardarse conversaciones enteras en cada fila.
    String(contacto.ultima_respuesta || "").slice(0, MAX_ULTIMA_RESPUESTA),
    JSON.stringify((contacto.ultimos_productos || []).slice(0, 10)),
  ];

  // Los tres campos del perfil NUNCA se borran desde aquí: si el que llama
  // no los trae (un objeto armado a mano, un contacto cargado antes de que
  // se buscara el perfil), se queda lo que ya había en la base. Así ningún
  // camino del código puede volver a dejar a un cliente "sin nombre".
  const guardar = () =>
    db
      .prepare(
        `INSERT INTO contactos (id, nombre, nombre_completo, usuario, historial, pausado_hasta, mids_enviados, ultimo_envio, mostrados, ultima_respuesta, ultimos_productos)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           nombre = COALESCE(NULLIF(excluded.nombre, ''), contactos.nombre),
           nombre_completo = COALESCE(NULLIF(excluded.nombre_completo, ''), contactos.nombre_completo),
           usuario = COALESCE(NULLIF(excluded.usuario, ''), contactos.usuario),
           historial = excluded.historial,
           pausado_hasta = excluded.pausado_hasta,
           mids_enviados = excluded.mids_enviados,
           ultimo_envio = excluded.ultimo_envio,
           mostrados = excluded.mostrados,
           ultima_respuesta = excluded.ultima_respuesta,
           ultimos_productos = excluded.ultimos_productos`
      )
      .bind(...datos)
      .run();

  try {
    await guardar();
  } catch (error) {
    // SI FALTA UNA COLUMNA, SE CREA Y SE SIGUE. NO SE PIDE NADA A NADIE.
    //
    // Los archivos se copian a mano a la carpeta de despliegue, así que el
    // código nuevo y la base vieja van a convivir SIEMPRE. Un arreglo que
    // depende de que alguien recuerde correr una migración no es un arreglo:
    // ya pasó con "mostrados", que quedó "arreglado" dos veces sobre el
    // papel mientras el bot seguía repitiendo carruseles.
    if (!faltaColumna(error)) throw error;
    await asegurarColumnas(db, { aunqueYaSeRevisara: true });
    await guardar();
  }
}

// LAS COLUMNAS QUE SE CREAN SOLAS.
//
// Todo lo que se añadió a la tabla después de 0001/0002 se crea desde el
// Worker, sin migración a mano: D1 acepta ALTER TABLE, cuesta una vez, y
// deja el sistema entero en el archivo que sí se copia.
//
//   mostrados        los productos que el cliente ya vio (no repetir carrusel)
//   nombre_completo  el nombre del perfil, tal cual ("María José Pérez")
//   usuario          el @ de Instagram ("mariajo.p") — para Slack y /estado
// LA TABLA TAMBIÉN SE CREA SOLA (22-sep-2026).
//
// Antes esto solo agregaba COLUMNAS: si la tabla no existía, se rendía y
// dejaba al bot sin memoria. Eso dependía de que alguien se acordara de
// correr `wrangler d1 migrations apply` a mano — y en el primer arranque
// de EPICELL no se corrió: la base estaba creada pero vacía, y cada
// mensaje moría con "D1_ERROR: no such table: contactos". El cliente
// escribía "Hola" y no recibía nada.
//
// Un paso manual que hay que recordar es un paso que algún día no se da.
// Así que la tabla se crea desde el código, igual que las columnas. Las
// migraciones siguen existiendo para quien prefiera correrlas, pero ya no
// son la única forma: CREATE TABLE IF NOT EXISTS no pisa nada si ya está.
const CREAR_TABLA = `
  CREATE TABLE IF NOT EXISTS contactos (
    id            TEXT PRIMARY KEY,
    nombre        TEXT    DEFAULT '',
    historial     TEXT    DEFAULT '',
    pausado_hasta INTEGER DEFAULT 0,
    mids_enviados TEXT    DEFAULT '[]',
    ultimo_envio  INTEGER NOT NULL DEFAULT 0
  )
`;

// Cuánto se guarda del último mensaje. Con esto sobra para recuperar los
// modelos que nombró; guardar más sería llenar la base de texto que nadie
// va a volver a leer.
const MAX_ULTIMA_RESPUESTA = 1000;

const COLUMNAS_SOLAS = [
  ["mostrados", "TEXT NOT NULL DEFAULT '[]'"],
  ["nombre_completo", "TEXT NOT NULL DEFAULT ''"],
  ["usuario", "TEXT NOT NULL DEFAULT ''"],
  // LO ÚLTIMO QUE EL BOT LE DIJO A ESTE CLIENTE, palabra por palabra.
  //
  // El historial es un RESUMEN que escribe el modelo ("pidió un Samsung
  // de 256"), y para casi todo alcanza. Pero hay una frase que lo rompe:
  // "muéstrame esos". Pasó en producción — el bot recitó cinco modelos de
  // 8/256 y, al pedirle verlos, buscó "Samsung" y mandó dos cargadores.
  // La lista que acababa de decir no estaba guardada en ninguna parte.
  //
  // Con el mensaje literal se puede volver sobre él y sacar los modelos
  // que nombró, que es exactamente lo que el cliente está pidiendo ver.
  ["ultima_respuesta", "TEXT NOT NULL DEFAULT ''"],
  // LOS TÍTULOS DEL ÚLTIMO CARRUSEL QUE SE LE MANDÓ.
  //
  // "¿Y en divisas?" no nombra ningún equipo: habla de los que acaba de
  // ver. Sin esta lista había que volver a adivinar el término de
  // búsqueda, y el bot terminaba mandándolo al asesor o enseñando otra
  // cosa. Con ella se le vuelven a mostrar LOS MISMOS, con el otro precio.
  ["ultimos_productos", "TEXT NOT NULL DEFAULT '[]'"],
  // Las huellas de los últimos textos que mandó el bot, para reconocer su
  // propio eco aunque el mid no cuadre (ver esEcoPorTexto).
  ["ultimos_textos", "TEXT NOT NULL DEFAULT '[]'"],
  // LA PUBLICACIÓN DEL FEED QUE ACABA DE COMPARTIR.
  //
  // Compartir y preguntar son dos mensajes, y llegan como dos webhooks en
  // paralelo. Aquí es donde el uno se entera del otro: sin esto, los dos
  // contestan y el cliente recibe el mismo mensaje dos veces.
  ["publicacion", "TEXT NOT NULL DEFAULT ''"],
];

// Una vez por instancia del Worker basta: después de la primera revisión,
// las columnas ya existen y no hace falta preguntar en cada mensaje.
let columnasRevisadas = false;

export async function asegurarColumnas(db, { aunqueYaSeRevisara = false } = {}) {
  if (!db || (columnasRevisadas && !aunqueYaSeRevisara)) return;

  let { results } = await db.prepare("PRAGMA table_info(contactos)").all();
  let hay = new Set((results || []).map((fila) => String(fila.name)));

  // Sin tabla, se crea. Es el primer arranque de este bot (o alguien no
  // corrió la migración) y no hay motivo para dejarlo sin memoria.
  if (!hay.size) {
    await db.prepare(CREAR_TABLA).run();
    console.log("Tabla \"contactos\" creada sola: primer arranque de esta base.");

    ({ results } = await db.prepare("PRAGMA table_info(contactos)").all());
    hay = new Set((results || []).map((fila) => String(fila.name)));

    // Si después de crearla sigue sin verse, algo más grave pasa con la
    // base y es mejor que se note en los registros que seguir en silencio.
    if (!hay.size) {
      console.error("Creé la tabla \"contactos\" pero la base sigue sin verla.");
      return;
    }
  }

  for (const [columna, tipo] of COLUMNAS_SOLAS) {
    if (hay.has(columna)) continue;
    try {
      await db.prepare(`ALTER TABLE contactos ADD COLUMN ${columna} ${tipo}`).run();
      console.log(`Columna "${columna}" creada sola.`);
    } catch (error) {
      // Dos peticiones en paralelo pueden intentarlo a la vez: la que llega
      // segunda se encuentra la columna hecha, que es justo lo que buscaba.
      if (/duplicate column/i.test(String(error?.message || ""))) continue;
      console.error(`No se pudo crear la columna "${columna}":`, error?.message || error);
      throw error;
    }
  }

  columnasRevisadas = true;
}

function faltaColumna(error) {
  return /no column named|no such column|has no column/i.test(String(error?.message || ""));
}

// El perfil de Instagram del cliente, guardado una sola vez.
//
// Toca SOLO estas tres columnas, y nunca pisa un dato bueno con uno vacío.
// Así se puede llamar desde el eco o desde la pausa sin miedo a borrar el
// historial o los mids que otra petición está escribiendo al mismo tiempo.
export async function guardarPerfil(db, id, { nombre = "", nombre_completo = "", usuario = "" }) {
  const guardar = () =>
    db
      .prepare(
        `INSERT INTO contactos (id, nombre, nombre_completo, usuario, historial, pausado_hasta, mids_enviados)
         VALUES (?, ?, ?, ?, '', 0, '[]')
         ON CONFLICT(id) DO UPDATE SET
           nombre = COALESCE(NULLIF(excluded.nombre, ''), contactos.nombre),
           nombre_completo = COALESCE(NULLIF(excluded.nombre_completo, ''), contactos.nombre_completo),
           usuario = COALESCE(NULLIF(excluded.usuario, ''), contactos.usuario)`
      )
      .bind(id, nombre, nombre_completo, usuario)
      .run();

  try {
    await guardar();
  } catch (error) {
    if (!faltaColumna(error)) throw error;
    await asegurarColumnas(db, { aunqueYaSeRevisara: true });
    await guardar();
  }
}

// Cómo se le presenta un cliente al dueño: "María José Pérez (@mariajo.p)".
// Con lo que haya; y si Instagram no compartió nada, se dice así.
export function comoSeLlama({ nombre_completo = "", usuario = "", nombre = "" } = {}) {
  const quien = nombre_completo || nombre;
  if (quien && usuario) return `${quien} (@${usuario})`;
  if (quien) return quien;
  if (usuario) return `@${usuario}`;
  return "";
}

// Cuando un asesor escribe desde la app de Instagram, el bot se aparta unas
// horas para no hablar por encima de él.
export async function pausar(db, id, horas) {
  const hasta = Date.now() + horas * 60 * 60 * 1000;
  await db
    .prepare(
      `INSERT INTO contactos (id, nombre, historial, pausado_hasta, mids_enviados)
       VALUES (?, '', '', ?, '[]')
       ON CONFLICT(id) DO UPDATE SET pausado_hasta = excluded.pausado_hasta`
    )
    .bind(id, hasta)
    .run();
}

// El asesor terminó y le devuelve la conversación al bot desde el propio
// chat (ver FRASE_DESPAUSAR en index.js). Deja una nota en el historial para
// que el bot sepa que alguien ya estuvo atendiendo y no salude de cero.
export async function despausar(db, id, nota = "") {
  await db
    .prepare(
      `UPDATE contactos SET
         pausado_hasta = 0,
         historial = CASE
           WHEN ? = '' OR historial LIKE '%' || ? THEN historial
           ELSE trim(historial || ' ' || ?)
         END
       WHERE id = ?`
    )
    .bind(nota, nota, nota, id)
    .run();
}

export function estaPausado(contacto) {
  return Number(contacto.pausado_hasta) > Date.now();
}

// Revisión de la base para /estado.
//
// POR QUÉ HACE FALTA. El binding puede estar puesto y aun así la tabla no
// existir, o existir sin las columnas que el código de hoy necesita —pasa
// cada vez que se despliega código nuevo sin correr la migración—. "DB
// conectada" no lo detecta, y el síntoma que ve el dueño es "el bot dejó
// de recordar" o "el bot no responde", que no se parecen en nada a la
// causa. Esto lo dice con nombre y apellido, y con el comando exacto.
const COLUMNAS = [
  ["id", "0001_contactos"],
  ["nombre", "0001_contactos"],
  ["historial", "0001_contactos"],
  ["pausado_hasta", "0001_contactos"],
  ["mids_enviados", "0001_contactos"],
  ["ultimo_envio", "0002_ultimo_envio"],
  ["mostrados", "0003_mostrados"],
  ["nombre_completo", "se crea sola"],
  ["usuario", "se crea sola"],
  ["ultimos_productos", "se crea sola"],
  ["ultimos_textos", "se crea sola"],
  ["publicacion", "se crea sola"],
];

// Las que el propio Worker crea en cuanto atiende un mensaje (ver
// COLUMNAS_SOLAS). Que falten en /estado no es algo que arreglar a mano.
const SE_CREAN_SOLAS = new Set(COLUMNAS_SOLAS.map(([columna]) => columna));

// "base" es el nombre de la base D1 de ESTE bot, para que los comandos
// que se imprimen se puedan copiar y pegar tal cual. Estaba escrito a
// mano ("invictus-bot-db") y este archivo es el MISMO en todos los bots:
// El Emperador habría leído que corriera la migración de Invictus.
export async function revisarBase(
  db,
  { fraseDespausar = "te dejo con la asistente", base = "tu-base-d1" } = {}
) {
  if (!db) {
    return {
      ok: false,
      lineas: [
        "  DB                  FALTA el binding",
        "  Sin esto el bot no recuerda nada de un mensaje al siguiente.",
        "  Revisa [[d1_databases]] en wrangler.toml.",
      ],
    };
  }

  let columnas;
  try {
    const { results } = await db.prepare("PRAGMA table_info(contactos)").all();
    columnas = (results || []).map((fila) => String(fila.name));
  } catch (error) {
    return {
      ok: false,
      lineas: [
        "  DB                  conectada, pero NO PUDE LEER LA TABLA",
        `  Error: ${error?.message || error}`,
        "  Corre la migración una sola vez:",
        `    npx wrangler d1 migrations apply ${base} --remote`,
      ],
    };
  }

  if (!columnas.length) {
    return {
      ok: false,
      lineas: [
        '  DB                  conectada, pero la tabla "contactos" NO EXISTE',
        "  El bot no puede recordar nada. Corre, una sola vez:",
        `    npx wrangler d1 migrations apply ${base} --remote`,
      ],
    };
  }

  const faltan = COLUMNAS.filter(([nombre]) => !columnas.includes(nombre));

  const lineas = ["  DB                  conectada", `  Tabla contactos     ${columnas.length} columnas`];

  if (faltan.length) {
    const nombres = faltan.map(([n]) => n);
    const migraciones = [...new Set(faltan.map(([, m]) => m))];

    lineas.push(`  FALTAN COLUMNAS     ${nombres.join(", ")}`);

    // Estas se crean solas en cuanto el bot atienda un mensaje, así que
    // verlas aquí no es un problema que haya que resolver a mano.
    if (nombres.every((n) => SE_CREAN_SOLAS.has(n))) {
      lineas.push(
        "  Esta se crea sola con el primer mensaje que atienda el bot.",
        "  No hay que hacer nada."
      );
    } else {
      lineas.push(
        `  Migración pendiente ${migraciones.join(", ")}`,
        "  Corre, una sola vez:",
        `    npx wrangler d1 migrations apply ${base} --remote`
      );
    }
  } else {
    lineas.push("  Migraciones         al día");
  }

  // UN BOT PAUSADO ATIENDE PERFECTAMENTE Y NO CONTESTA A NADIE.
  //
  // Es el fallo que más se parece a "está roto" sin estarlo, y el dueño ya
  // lo vivió dos veces: mandaba "Hola" desde otra cuenta, no pasaba nada, y
  // en los registros solo salía "Bot pausado: no respondo" — que hay que
  // estar mirando `wrangler tail` en ese momento para verlo.
  //
  // Así que se enseñan aquí, con NOMBRE —un número de 17 cifras no le dice
  // nada a nadie—, hasta cuándo, y cómo reanudar desde el propio chat.
  try {
    const ahora = Date.now();
    const conPerfil = columnas.includes("usuario") && columnas.includes("nombre_completo");
    const { results } = await db
      .prepare(
        `SELECT id, pausado_hasta, nombre${conPerfil ? ", nombre_completo, usuario" : ""}
         FROM contactos WHERE pausado_hasta > ? ORDER BY pausado_hasta DESC LIMIT 20`
      )
      .bind(ahora)
      .all();

    const pausados = results || [];

    if (!pausados.length) {
      lineas.push("  Pausados ahora      ninguno");
    } else {
      lineas.push(
        "",
        `  PAUSADOS AHORA      ${pausados.length} — a estos el bot NO les responde`,
        "  Pasa cuando un asesor escribe a mano desde Instagram. Es",
        "  a propósito: el bot se aparta para no hablar por encima."
      );

      for (const fila of pausados) {
        const quien = comoSeLlama(fila) || "sin nombre";
        lineas.push(`    ${quien}   ${cuantoFalta(Number(fila.pausado_hasta) - ahora)}   (id ${fila.id})`);
      }

      lineas.push(
        "",
        "  Para devolvérselo al bot, desde el MISMO chat de Instagram:",
        `  manda un mensaje que diga "${fraseDespausar}"`,
        "  (lo más cómodo es tenerlo como Respuesta guardada). El bot",
        "  vuelve a atender a ese cliente desde su siguiente mensaje.",
        "",
        "  O desde la terminal, para uno (copia y pega):",
        `    npx wrangler d1 execute ${base} --remote --command ` +
          `"UPDATE contactos SET pausado_hasta = 0 WHERE id = '${pausados[0].id}'"`,
        "",
        "  O para reanudarlos todos de golpe:",
        `    npx wrangler d1 execute ${base} --remote --command ` +
          '"UPDATE contactos SET pausado_hasta = 0"'
      );
    }
  } catch {
    // Si la tabla está a medias, lo de arriba ya lo dijo.
  }

  return { ok: !faltan.length, lineas };
}

// Instagram nos avisa de TODO mensaje que sale de la cuenta, incluidos los que
// mandó el propio bot. Si el identificador está en la lista, el eco es nuestro
// y hay que ignorarlo; si no lo está, lo escribió una persona.
export function esEcoPropio(contacto, mid) {
  if (!mid) return false;
  return contacto.mids_enviados.includes(mid);
}

function leerLista(valor) {
  if (!valor) return [];
  try {
    const lista = JSON.parse(valor);
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

// LOS CONTACTOS QUE EL BOT FUE GUARDANDO, para verlos o descargarlos.
//
// El bot los guarda solo: en cuanto un cliente escribe por primera vez, le
// pide el perfil a Instagram y anota su nombre, su nombre completo y su @.
// Pero hasta ahora eso vivía en D1 sin forma de mirarlo, y una lista de
// clientes que nadie puede abrir no le sirve a nadie (ver /contactos en
// index.js).
//
// Ojo con lo que NO hay y no puede haber: Instagram no da el teléfono ni
// el correo de nadie. Lo que hay es el @, que es con lo que se le escribe.
export async function listarContactos(db, { cuantos = 500 } = {}) {
  if (!db) return [];

  await asegurarColumnas(db);

  const { results } = await db
    .prepare(
      `SELECT id, nombre, nombre_completo, usuario, historial, ultimo_envio, pausado_hasta
         FROM contactos
        ORDER BY ultimo_envio DESC
        LIMIT ?`
    )
    .bind(cuantos)
    .all();

  return (results || []).map((fila) => ({
    id: String(fila.id || ""),
    nombre: fila.nombre || "",
    nombre_completo: fila.nombre_completo || "",
    usuario: fila.usuario || "",
    historial: fila.historial || "",
    ultimo_envio: Number(fila.ultimo_envio) || 0,
    pausado: Number(fila.pausado_hasta) > Date.now(),
  }));
}
