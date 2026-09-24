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
      historial: "",
      pausado_hasta: 0,
      mids_enviados: [],
      ultimo_envio: 0,
      mostrados: [],
      publicacion: null,
    };
  }

  return {
    id: fila.id,
    nombre: fila.nombre || "",
    historial: fila.historial || "",
    pausado_hasta: Number(fila.pausado_hasta) || 0,
    mids_enviados: leerLista(fila.mids_enviados),
    ultimo_envio: Number(fila.ultimo_envio) || 0,
    // Los títulos que este cliente YA vio. Sin esto, pedir "más" le devuelve
    // el mismo carrusel (ver migrations/0003_mostrados.sql).
    mostrados: leerLista(fila.mostrados),
    // La última publicación del feed que compartió, si fue hace poco. Es lo
    // que une los DOS webhooks de "compartir + preguntar" en una sola
    // respuesta (ver publicacion.js y migrations/0004_publicacion.sql).
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

  const escribir = () =>
    db
      .prepare(
        `INSERT INTO contactos (id, nombre, historial, pausado_hasta, mids_enviados, publicacion)
         VALUES (?, '', '', 0, '[]', ?)
         ON CONFLICT(id) DO UPDATE SET publicacion = excluded.publicacion`
      )
      .bind(id, valor)
      .run();

  try {
    await escribir();
  } catch (error) {
    // Misma idea que con "mostrados": la columna se crea sola. Los archivos
    // se copian a mano a la carpeta de despliegue, así que el código nuevo y
    // la base vieja conviven siempre, y un arreglo que depende de que
    // alguien recuerde correr una migración no es un arreglo.
    if (!/publicacion/i.test(String(error?.message || ""))) throw error;

    console.log('Falta la columna "publicacion": la creo y sigo.');
    await crearColumna(db, "publicacion", "''");
    await escribir();
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
export async function marcarEnvio(db, id, mids, cuando = Date.now()) {
  await db
    .prepare(
      `INSERT INTO contactos (id, nombre, historial, pausado_hasta, mids_enviados, ultimo_envio)
       VALUES (?, '', '', 0, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         mids_enviados = excluded.mids_enviados,
         ultimo_envio = excluded.ultimo_envio`
    )
    .bind(id, JSON.stringify(mids.slice(-MAX_MIDS)), cuando)
    .run();
}

// La red de seguridad del párrafo de arriba: aunque el mid no aparezca en
// la lista (porque el eco ganó la carrera de todas formas), si el bot
// mandó algo hace nada, ese eco es casi con certeza suyo. Un asesor humano
// que justo escribe en esa misma ventana solo retrasa la pausa hasta su
// mensaje siguiente; confundir el eco propio, en cambio, deja al cliente
// sin atención durante horas.
const VENTANA_ECO_PROPIO_MS = 90 * 1000;

export function envioReciente(contacto, ahora = Date.now()) {
  const ultimo = Number(contacto.ultimo_envio) || 0;
  return ultimo > 0 && ahora - ultimo < VENTANA_ECO_PROPIO_MS;
}

export async function guardarContacto(db, contacto) {
  // Solo guardamos los últimos: la lista existe para reconocer ecos recientes,
  // no para ser un archivo histórico.
  const mids = contacto.mids_enviados.slice(-MAX_MIDS);

  const mostrados = (contacto.mostrados || []).slice(-MAX_MOSTRADOS);

  const datos = [
    contacto.id,
    contacto.nombre || "",
    contacto.historial || "",
    Number(contacto.pausado_hasta) || 0,
    JSON.stringify(mids),
    Number(contacto.ultimo_envio) || 0,
  ];

  try {
    await db
      .prepare(
        `INSERT INTO contactos (id, nombre, historial, pausado_hasta, mids_enviados, ultimo_envio, mostrados)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           nombre = excluded.nombre,
           historial = excluded.historial,
           pausado_hasta = excluded.pausado_hasta,
           mids_enviados = excluded.mids_enviados,
           ultimo_envio = excluded.ultimo_envio,
           mostrados = excluded.mostrados`
      )
      .bind(...datos, JSON.stringify(mostrados))
      .run();
    return;
  } catch (error) {
    // SI FALTA LA COLUMNA, SE CREA Y SE SIGUE. NO SE PIDE NADA A NADIE.
    //
    // La versión anterior de esto se limitaba a guardar sin la columna y a
    // dejar un aviso en el registro diciendo "corre la migración". Eso
    // parecía prudente y fue peor que inútil: el bot seguía funcionando,
    // nadie leía el registro, y el fallo que la columna venía a arreglar
    // —mandar dos veces el mismo carrusel— volvió tal cual, ya "arreglado"
    // dos veces sobre el papel. Un arreglo que depende de que alguien
    // recuerde un comando no es un arreglo.
    //
    // Los archivos se copian a mano a la carpeta de despliegue, así que el
    // código nuevo y la base vieja van a convivir SIEMPRE. Que el código se
    // encargue: D1 acepta ALTER TABLE desde el Worker, cuesta una vez, y
    // deja el sistema entero en el archivo que sí se copia.
    if (!/mostrados/i.test(String(error?.message || ""))) throw error;

    console.log('Falta la columna "mostrados": la creo y sigo.');
    await crearColumna(db, "mostrados", "'[]'");

    await db
      .prepare(
        `INSERT INTO contactos (id, nombre, historial, pausado_hasta, mids_enviados, ultimo_envio, mostrados)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           nombre = excluded.nombre,
           historial = excluded.historial,
           pausado_hasta = excluded.pausado_hasta,
           mids_enviados = excluded.mids_enviados,
           ultimo_envio = excluded.ultimo_envio,
           mostrados = excluded.mostrados`
      )
      .bind(...datos, JSON.stringify(mostrados))
      .run();
  }
}

// Crea la columna que falta. Se llama sola, desde los rescates de arriba.
//
// Dos peticiones en paralelo pueden intentarlo a la vez y una de las dos se
// va a encontrar con que ya existe. Eso no es un fallo: es exactamente el
// resultado que buscábamos, así que se traga y se sigue.
async function crearColumna(db, nombre, porDefecto) {
  try {
    await db
      .prepare(
        `ALTER TABLE contactos ADD COLUMN ${nombre} TEXT NOT NULL DEFAULT ${porDefecto}`
      )
      .run();
    console.log(`Columna "${nombre}" creada.`);
  } catch (error) {
    const mensaje = String(error?.message || "");
    if (/duplicate column/i.test(mensaje)) return; // se nos adelantó otra petición
    console.error(`No se pudo crear la columna "${nombre}":`, mensaje);
    throw error;
  }
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
  ["publicacion", "0004_publicacion"],
];

// Estas dos se crean solas en cuanto el bot atienda un mensaje: verlas
// como "faltantes" no es un problema que haya que resolver a mano.
const SE_CREAN_SOLAS = new Set(["mostrados", "publicacion"]);

export async function revisarBase(db, base = "tu-base-d1") {
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

    if (nombres.every((nombre) => SE_CREAN_SOLAS.has(nombre))) {
      lineas.push(
        nombres.length === 1
          ? "  Esta se crea sola con el primer mensaje que atienda el bot."
          : "  Estas se crean solas con el primer mensaje que atienda el bot.",
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
  // Así que se enseñan aquí, con quién, hasta cuándo, y CON EL COMANDO YA
  // ESCRITO para reanudar. El dueño no escribe SQL: se lo copia y lo pega.
  try {
    const ahora = Date.now();
    const { results } = await db
      .prepare(
        "SELECT id, pausado_hasta FROM contactos WHERE pausado_hasta > ? ORDER BY pausado_hasta DESC LIMIT 20"
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
        lineas.push(`    ${fila.id}   ${cuantoFalta(Number(fila.pausado_hasta) - ahora)}`);
      }

      lineas.push(
        "",
        "  Para que el bot vuelva a atender AHORA (copia y pega):",
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
