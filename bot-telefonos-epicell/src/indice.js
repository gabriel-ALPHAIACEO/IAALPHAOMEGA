// EL CATÁLOGO, MIRADO UNA VEZ Y GUARDADO EN D1.
//
// QUÉ RESUELVE. Todo el reconocimiento por foto terminaba en un NOMBRE:
// la visión miraba la imagen, decía "Redmi Note 14", y ese texto se
// buscaba en la hoja. Cuando el nombre falla, falla todo — y falla
// seguido, porque hay que acertar cómo se llama un equipo entre decenas,
// con una foto de historia con filtro y un sticker de precio encima.
//
// LA IDEA. La hoja ya trae la foto de cada producto. En vez de adivinar
// el nombre, se comparan las fotos. Pero mirar 82 fotos en cada mensaje
// son decenas de llamadas al modelo y el cupo por minuto de OpenAI no da.
//
// Así que ese trabajo se hace UNA vez: se le pasa el modelo de visión a
// cada producto, se guarda la frase con lo que se ve, y ya. Después,
// cuando llega una foto de un cliente, su descripción se compara con las
// guardadas EN CÓDIGO —sin gastar modelo, sin tocar el cupo— y solo los
// más parecidos van a una única llamada de cotejo.
//
// POR QUÉ AQUÍ NO HAY RASGOS NI COLOR (y en el bot de calzado sí).
//
//   · Los 15 rasgos de Invictus son de zapato: cámara de aire, swoosh,
//     jumpman, tres franjas. No hay equivalente que sirva aquí, y la
//     descripción sola ya distingue lo que importa en un teléfono —
//     cuántas cámaras, cómo están puestas, qué muesca tiene.
//
//   · El color se deja fuera A PROPÓSITO, por decisión del dueño. El
//     mismo equipo se vende en cinco colores, el vidrio refleja la luz de
//     la tienda y las historias llevan filtros: fiarse del color hace más
//     daño que bien. En calzado sí se usa, porque ahí el título dice el
//     color y el cliente lo pide.
//
// Se llena solo: ver el cron en wrangler.toml y scheduled() en index.js.

import { describirProducto, esperarCupo, modeloDeIndice } from "./ia.js";
import { catalogoCompleto } from "./sheets.js";

// LA CLAVE ES LA FOTO, NO EL TÍTULO.
//
// En la hoja puede haber dos filas con el mismo título y distinta foto —
// el mismo modelo en dos capacidades, o cargado dos veces. Con el título
// de clave se pisarían: el segundo borraría al primero, el primero
// volvería a salir como pendiente en la pasada siguiente, y la
// indexación no terminaría nunca. (Pasó en el bot de calzado, con 581
// productos y solo 347 títulos distintos.)
//
// La URL de la foto sí es única por fila. Y de regalo arregla el
// reindexado: si a un producto le cambian la imagen, es una clave nueva,
// entra sola, y la vieja la limpia limpiarLosQueYaNoEstan().
const TABLA = `
  CREATE TABLE IF NOT EXISTS catalogo (
    imagen      TEXT PRIMARY KEY,
    titulo      TEXT,
    precio      TEXT,
    url         TEXT,
    visto       TEXT,
    actualizado INTEGER
  )
`;

let tablaLista = false;

// La tabla se crea desde el código, no con una migración a mano: los
// archivos se pegan a mano en la carpeta de despliegue, y un paso extra
// que alguien tiene que acordarse de correr es un paso que no se corre.
export async function asegurarIndice(db) {
  if (!db || tablaLista) return;
  await db.prepare(TABLA).run();
  tablaLista = true;
}

export async function leerIndice(db) {
  if (!db) return [];
  await asegurarIndice(db);

  let results;
  try {
    ({ results } = await db
      .prepare("SELECT imagen, titulo, precio, url, visto FROM catalogo")
      .all());
  } catch (error) {
    // La tabla se daba por hecha y no estaba. Se apunta para que el
    // próximo intento vuelva a crearla en vez de fallar para siempre.
    tablaLista = false;
    throw error;
  }

  return (results || []).map((fila) => ({
    imagen: fila.imagen,
    titulo: fila.titulo || "",
    precio: fila.precio || "",
    url: fila.url || "",
    visto: fila.visto || "",
  }));
}

const POR_TANDA_D1 = 50;

export async function guardarIndexados(db, filas) {
  if (!db || !filas.length) return;
  await asegurarIndice(db);
  const ahora = Date.now();

  for (let i = 0; i < filas.length; i += POR_TANDA_D1) {
    await db.batch(
      filas.slice(i, i + POR_TANDA_D1).map((fila) =>
        db
          .prepare(
            `INSERT OR REPLACE INTO catalogo
               (imagen, titulo, precio, url, visto, actualizado)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .bind(
            fila.imagen,
            fila.titulo,
            fila.precio || "",
            fila.url || "",
            String(fila.visto || "").slice(0, 300),
            ahora
          )
      )
    );
  }
}

// Lo que ya no está en la hoja tiene que salir del índice: si no, el
// cotejo puede acabar enseñándole al cliente la ficha de algo que ya no
// se vende. Se compara por FOTO, igual que la clave.
export async function limpiarLosQueYaNoEstan(db, fotosActuales) {
  if (!db || !fotosActuales.length) return 0;

  const indice = await leerIndice(db);
  const vigentes = new Set(fotosActuales);
  const sobran = indice.filter((p) => !vigentes.has(p.imagen));
  if (!sobran.length) return 0;

  await db.batch(
    sobran.map((p) => db.prepare("DELETE FROM catalogo WHERE imagen = ?").bind(p.imagen))
  );

  console.log(`Índice: quité ${sobran.length} producto(s) que ya no están en la hoja`);
  return sobran.length;
}

/* ── Qué se parece a la foto del cliente ────────────────────────────── */

// LOS QUE MÁS SE PARECEN, SIN GASTAR UN TOKEN.
//
// Compara la frase que describe la foto del cliente con las guardadas de
// cada producto. Es aritmética: milisegundos y cero llamadas.
//
// LAS PALABRAS SE PESAN POR LO RARAS QUE SEAN. "telefono" y "camaras"
// salen en las 82 descripciones y no distinguen nada; "plegable",
// "cuatro", "isla" o "corneta" salen en pocas y valen mucho. Se calcula
// solo sobre el propio catálogo, así que no hay ninguna lista de palabras
// que mantener a mano.
export function mejoresPorDescripcion(indice, visto, cuantos = 10) {
  const delaFoto = palabrasDe(visto);
  if (!delaFoto.size) return [];

  const utiles = indice.filter((p) => p.imagen && p.visto);
  if (!utiles.length) return [];

  const peso = pesoDeLasPalabras(utiles);

  const conPuntos = utiles
    .map((producto) => ({
      producto,
      puntos: puntosDeDescripcion(producto.visto, delaFoto, peso),
    }))
    .sort((a, b) => b.puntos - a.puntos);

  // UNO POR TÍTULO, EL QUE MEJOR PUNTÚA. Si la hoja tiene el mismo modelo
  // en dos capacidades, enseñarle los dos al modelo desperdicia la mitad
  // de los candidatos.
  const vistos = new Set();
  const elegidos = [];
  for (const { producto } of conPuntos) {
    const clave = producto.titulo.toLowerCase();
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    elegidos.push(producto);
    if (elegidos.length >= cuantos) break;
  }

  return elegidos;
}

// Las palabras con contenido. Fuera los acentos, los signos y las de
// pegamento, que salen en todas y no dicen nada.
const VACIAS = new Set([
  "de","del","la","el","los","las","un","una","unos","unas","y","o","en","con",
  "sin","por","para","que","se","su","sus","al","es","son","tipo","estilo",
  "equipo","producto","aparato","color","ve","visible","tiene","lleva","parte",
  "lado","foto","imagen","fondo","blanco","negro","gris","azul","verde","rojo",
  "dorado","plateado","morado","rosado","celeste","beige",
]);

export function palabrasDe(texto) {
  return new Set(
    String(texto || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((p) => p.length > 2 && !VACIAS.has(p))
  );
}

// Los colores van en VACIAS a propósito: aunque la descripción los
// mencione, no deben puntuar. Es la misma decisión que arriba.

export function pesoDeLasPalabras(indice) {
  const enCuantas = new Map();
  for (const producto of indice) {
    for (const palabra of palabrasDe(producto.visto)) {
      enCuantas.set(palabra, (enCuantas.get(palabra) || 0) + 1);
    }
  }

  // log(1 + total/veces), NO log(total/veces).
  //
  // Con el segundo, una palabra que sale en TODOS los productos vale
  // exactamente 0 — y si la descripción de la foto solo trae palabras
  // comunes ("telefono con tres camaras"), el total da 0 y no puntúa
  // nadie. Lo encontró una prueba con un catálogo de dos equipos: devolvía
  // lista vacía en vez de ordenar.
  //
  // Con el +1, una palabra común sigue valiendo poco (0,69) pero no cero,
  // y una rara vale mucho más. El orden entre raras y comunes no cambia;
  // lo que cambia es que nunca se queda todo en empate a cero.
  const total = indice.length || 1;
  const peso = new Map();
  for (const [palabra, veces] of enCuantas) peso.set(palabra, Math.log(1 + total / veces));
  return peso;
}

export function puntosDeDescripcion(vistoDelCatalogo, delaFoto, peso) {
  if (!delaFoto.size) return 0;
  const delProducto = palabrasDe(vistoDelCatalogo);
  if (!delProducto.size) return 0;

  let compartido = 0;
  let maximo = 0;
  for (const palabra of delaFoto) {
    const vale = peso.get(palabra) || 0;
    maximo += vale;
    if (delProducto.has(palabra)) compartido += vale;
  }

  return maximo > 0 ? Math.round((compartido / maximo) * 100) : 0;
}

/* ── Una tanda de indexación ────────────────────────────────────────── */

// De a cuántos se miran a la vez. El techo es el cupo por minuto de
// OpenAI; pasarse solo hace que la tanda falle entera.
const DE_A_LA_VEZ = 4;

export async function indexarTanda(env, { cuantos = 40, rehacer = false } = {}) {
  if (!env.DB) return { ok: false, error: "No hay base de datos conectada, y el índice vive ahí." };

  const productos = await catalogoCompleto(env);
  if (!productos.length) {
    return { ok: false, error: "La hoja no devolvió productos. Mira /probar-hoja." };
  }

  const indice = await leerIndice(env.DB);
  const guardados = new Set(indice.map((p) => p.imagen));

  // Un producto sin foto no se puede catalogar: el cotejo compara
  // imágenes. Se cuentan aparte para que el porcentaje no mienta.
  const sinFoto = productos.filter((p) => !p.imagen).length;
  const indexables = productos.filter((p) => p.imagen);

  const pendientes = indexables.filter((p) => rehacer || !guardados.has(p.imagen));

  // EL PRECIO SE REFRESCA SIN GASTAR MODELO. Las fichas que se le mandan
  // al cliente pueden salir del índice, y un precio del día que se indexó
  // es un precio viejo — eso se descubre al cobrar, que es el peor
  // momento. Mirar la foto cuesta una llamada; copiar el precio no cuesta
  // nada, ya viene en la hoja que se acaba de leer.
  const refrescados = await refrescarDatos(env.DB, indice, indexables);

  const tanda = pendientes.slice(0, cuantos);
  const modelo = modeloDeIndice(env);
  const indexados = [];
  let fallados = 0;
  let corto = "";

  for (let i = 0; i < tanda.length; i += DE_A_LA_VEZ) {
    // Si se acaba el cupo NO se abandona: aquí no hay ningún cliente
    // esperando. Solo se corta si la espera es larga.
    if (!(await esperarCupo(modelo))) {
      corto = "Me quedé sin cupo de OpenAI a mitad de la tanda.";
      console.log("Indexación: sin cupo y la espera es larga, corto la tanda");
      break;
    }

    const resultados = await Promise.all(
      tanda.slice(i, i + DE_A_LA_VEZ).map(async (producto) => {
        const visto = await describirProducto(env, producto.imagen, { modelo });
        return visto ? { ...producto, visto: visto.visto } : null;
      })
    );

    indexados.push(...resultados.filter(Boolean));
    fallados += resultados.filter((r) => !r).length;
  }

  const ningunoSalio = tanda.length > 0 && indexados.length === 0;

  await guardarIndexados(env.DB, indexados);

  // RED DE SEGURIDAD. Si se guardaron productos y las filas no subieron lo
  // que debían, algo los está pisando — y lo peor de ese fallo, cuando
  // pasó en el bot de calzado, no fue el fallo: fue que no dijo nada.
  if (indexados.length) {
    const hayAhora = await contarFilas(env.DB);
    const nuevas = hayAhora - indice.length;
    if (nuevas < indexados.length) {
      console.error(
        `ÍNDICE: guardé ${indexados.length} producto(s) pero solo quedaron ${nuevas} ` +
          "fila(s) nuevas. Se están pisando y la indexación no va a terminar nunca. " +
          "Mira la clave primaria de la tabla en indice.js."
      );
    }
  }

  const faltan = pendientes.length - indexados.length;

  // Solo cuando ya no falta nada: limpiar a medio llenar haría que un
  // producto todavía sin mirar pareciera retirado.
  let quitados = 0;
  if (!faltan) {
    quitados = await limpiarLosQueYaNoEstan(env.DB, indexables.map((p) => p.imagen));
  }

  return {
    ok: true,
    catalogo: productos.length,
    indexables: indexables.length,
    sinFoto,
    yaEstaban: indice.length,
    intentados: tanda.length,
    indexados: indexados.length,
    fallados,
    pendientes: pendientes.length,
    faltan,
    quitados,
    refrescados,
    corto,
    modelo,
    ningunoSalio,
  };
}

// Copia precio, enlace y título de la hoja a las filas ya indexadas
// cuando cambiaron. No toca la descripción: eso es lo que costó mirar.
async function refrescarDatos(db, indice, productos) {
  const deLaHoja = new Map(productos.map((p) => [p.imagen, p]));

  const cambiados = indice.filter((fila) => {
    const hoy = deLaHoja.get(fila.imagen);
    return (
      hoy &&
      (String(hoy.precio || "") !== String(fila.precio || "") ||
        String(hoy.url || "") !== String(fila.url || "") ||
        String(hoy.titulo || "") !== String(fila.titulo || ""))
    );
  });

  if (!cambiados.length) return 0;

  for (let i = 0; i < cambiados.length; i += POR_TANDA_D1) {
    await db.batch(
      cambiados.slice(i, i + POR_TANDA_D1).map((fila) => {
        const hoy = deLaHoja.get(fila.imagen);
        return db
          .prepare("UPDATE catalogo SET precio = ?, url = ?, titulo = ? WHERE imagen = ?")
          .bind(hoy.precio || "", hoy.url || "", hoy.titulo, fila.imagen);
      })
    );
  }

  console.log(
    `Índice: actualicé precio, enlace o título de ${cambiados.length} producto(s), sin mirar ninguna foto`
  );
  return cambiados.length;
}

async function contarFilas(db) {
  try {
    const { results } = await db.prepare("SELECT COUNT(*) AS n FROM catalogo").all();
    return Number(results?.[0]?.n) || 0;
  } catch {
    return 0;
  }
}

// Qué tiene el índice ahora mismo, en líneas listas para /estado.
export async function revisarIndice(env) {
  if (!env.DB) {
    return ["  Índice              SIN BASE (falta el binding DB)"];
  }

  let total = 0;
  try {
    const { results } = await env.DB.prepare("SELECT COUNT(*) AS n FROM catalogo").all();
    total = Number(results?.[0]?.n) || 0;
  } catch {
    return [
      "  Índice              TODAVÍA NO SE HA HECHO",
      "  El cron lo llena solo. Mientras tanto el bot reconoce las fotos",
      "  solo por el nombre, y con eso falla seguido.",
    ];
  }

  if (!total) {
    return [
      "  Índice              VACÍO TODAVÍA",
      "  NO HACE FALTA QUE HAGAS NADA: el cron lo llena solo. Si tienes",
      "  prisa, abre /indexar-catalogo para adelantar una tanda.",
    ];
  }

  return [
    `  Índice              ${total} productos catalogados por su foto`,
    "  Se mantiene solo: los nuevos los recoge el cron (ver [triggers]",
    "  en wrangler.toml). Si el número lleva horas sin subir y sabes que",
    "  faltan, mira `wrangler tail`: casi siempre es saldo o cupo.",
  ];
}
