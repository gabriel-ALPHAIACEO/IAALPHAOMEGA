// El catálogo, mirado UNA vez y guardado en D1.
//
// EL PROBLEMA QUE RESUELVE. El cotejo visual compara la foto del cliente
// contra las fotos del catálogo, y para encontrar un zapato que la
// búsqueda por nombre no encuentra hay que mirarlos todos. Pero mirar
// 400 productos cuesta unas 20 llamadas al modelo de visión, y la cuenta
// de OpenAI tiene 30.000 tokens por minuto: no entran. El 22-sep se
// intentó y OpenAI devolvió 429 desde el segundo lote — un cliente se
// quedó sin respuesta.
//
// LA IDEA. Ese trabajo no hace falta hacerlo en cada mensaje. El
// catálogo no cambia entre un cliente y el siguiente, así que se mira
// UNA vez: se le pasa el modelo de visión a cada producto, se guardan
// sus 15 rasgos en D1, y ya está. Después, cuando llega una foto, sus
// rasgos se comparan con los guardados EN CÓDIGO —sin gastar modelo, sin
// tocar el cupo— y solo los 10 más parecidos van a una única llamada de
// cotejo.
//
// De 20 llamadas por mensaje a 1. Y el cliente espera segundos, no
// minutos.
//
// La indexación se dispara a mano desde /indexar-catalogo, por tandas.
// Hay que volver a correrla cuando se agregan productos nuevos; los que
// ya están no se vuelven a mirar, así que reindexar es barato.

import { RASGOS_CLAVE } from "./identificar.js";
import { modeloDeIndice, rasgosDeProducto, esperarCupo } from "./ia.js";
import { traerCatalogoCompleto } from "./shopify.js";
import { tituloEsDelColor, tituloNombraColor } from "./color.js";

// LA CLAVE ES LA FOTO, NO EL TÍTULO (24-sep-2026 — esto tenía parada la
// indexación en seco).
//
// La tabla tenía "titulo TEXT PRIMARY KEY". Parecía razonable y era un
// fallo grave: el catálogo tiene 581 productos pero solo 347 títulos
// distintos —el mismo nombre para varios colores— así que 234 productos
// se pisaban unos a otros al guardarse.
//
// Lo que se veía desde fuera: la indexación subía, se paraba en seco y
// "FALTAN N" nunca bajaba de ahí, sin un solo error en el registro. Y lo
// peor, cada pasada volvía a mirar los mismos duplicados: 40 llamadas de
// visión tiradas, una y otra vez, para siempre.
//
// La cuenta de por qué se estanca: al guardar, el último de cada título
// borra al anterior. En la pasada siguiente el que fue borrado vuelve a
// salir como pendiente —su foto no coincide con la que quedó guardada—,
// se vuelve a mirar, y vuelve a pisarse. El índice no puede pasar nunca
// del número de títulos, y "faltan" no puede llegar nunca a cero.
//
// La URL de la foto sí es única por producto (el CDN de Shopify le mete
// el id de la imagen), así que es la clave correcta. Y de regalo arregla
// el reindexado: si a un producto le cambian la foto, es una clave nueva,
// entra sola, y la vieja la limpia limpiarLosQueYaNoEstan().
//
// Dos productos que compartan LA MISMA foto sí se colapsan en una fila.
// Da igual: son idénticos para lo único que hace este índice, que es
// comparar imágenes.
const TABLA = `
  CREATE TABLE IF NOT EXISTS catalogo (
    imagen TEXT PRIMARY KEY,
    titulo TEXT,
    precio TEXT,
    url TEXT,
    visto TEXT,
    rasgos TEXT,
    actualizado INTEGER
  )
`;

let tablaLista = false;

// La tabla se crea desde el código, no con una migración a mano: los
// archivos se pegan a mano en la carpeta de despliegue y un paso extra
// que alguien tiene que acordarse de correr es un paso que no se corre.
//
// Y por lo mismo, la tabla vieja se migra sola. Lo ya indexado NO se
// tira: cada fila vieja ya guardaba su foto, así que se copia tal cual a
// la tabla nueva con la foto de clave. Lo que se pagó al modelo por esos
// productos sigue valiendo.
export async function asegurarIndice(db) {
  if (!db || tablaLista) return;

  await db.prepare(TABLA).run();
  await migrarDeTituloAFoto(db);

  tablaLista = true;
}

async function migrarDeTituloAFoto(db) {
  let columnas;
  try {
    const { results } = await db.prepare("PRAGMA table_info(catalogo)").all();
    columnas = (results || []).map((f) => ({ nombre: String(f.name), clave: Number(f.pk) > 0 }));
  } catch {
    return; // sin tabla no hay nada que migrar
  }

  const clave = columnas.find((c) => c.clave);
  // Ya está en el esquema nuevo (o la tabla se acaba de crear).
  if (!clave || clave.nombre === "imagen") return;

  console.log("Índice: la tabla estaba indexada por título; la paso a indexar por foto.");

  // Se rescata lo que ya se miró. Las filas sin foto no sirven para el
  // cotejo (se compara contra imágenes), así que esas sí se van.
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS catalogo_nuevo (
         imagen TEXT PRIMARY KEY,
         titulo TEXT,
         precio TEXT,
         url TEXT,
         visto TEXT,
         rasgos TEXT,
         actualizado INTEGER
       )`
    )
    .run();

  await db
    .prepare(
      `INSERT OR REPLACE INTO catalogo_nuevo
         (imagen, titulo, precio, url, visto, rasgos, actualizado)
       SELECT imagen, titulo, precio, url, visto, rasgos, actualizado
         FROM catalogo
        WHERE imagen IS NOT NULL AND imagen <> ''`
    )
    .run();

  await db.prepare("DROP TABLE catalogo").run();
  await db.prepare("ALTER TABLE catalogo_nuevo RENAME TO catalogo").run();

  const { results } = await db.prepare("SELECT COUNT(*) AS n FROM catalogo").all();
  console.log(`Índice migrado: ${results?.[0]?.n ?? "?"} producto(s) rescatados, sin volver a mirarlos.`);
}

export async function leerIndice(db) {
  if (!db) return [];

  await asegurarIndice(db);

  let results;
  try {
    ({ results } = await db
      .prepare("SELECT titulo, imagen, precio, url, visto, rasgos FROM catalogo")
      .all());
  } catch (error) {
    // La tabla se daba por hecha y no estaba. Se apunta para que el
    // próximo intento vuelva a crearla en vez de fallar para siempre.
    tablaLista = false;
    throw error;
  }

  return (results || []).map((fila) => ({
    titulo: fila.titulo,
    imagen: fila.imagen || "",
    precio: fila.precio || "",
    url: fila.url || "",
    visto: fila.visto || "",
    rasgos: leerRasgos(fila.rasgos),
  }));
}

export async function guardarIndexados(db, filas) {
  if (!db || !filas.length) return;

  await asegurarIndice(db);
  const ahora = Date.now();

  await db.batch(
    filas.map((fila) =>
      db
        .prepare(
          `INSERT OR REPLACE INTO catalogo
             (imagen, titulo, precio, url, visto, rasgos, actualizado)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          fila.imagen || "",
          fila.titulo,
          fila.precio || "",
          fila.url || "",
          String(fila.visto || "").slice(0, 300),
          JSON.stringify(fila.rasgos || {}),
          ahora
        )
    )
  );
}

// Los productos que ya no están en Shopify tienen que salir del índice:
// si no, el cotejo puede acabar enseñándole al cliente una ficha de algo
// que ya no se vende.
// Se compara por FOTO, igual que la clave. Por título no valdría: con 347
// títulos para 581 productos, un título sigue vigente aunque el color
// concreto que guardamos ya no se venda.
export async function limpiarLosQueYaNoEstan(db, fotosActuales) {
  if (!db || !fotosActuales.length) return 0;

  const indice = await leerIndice(db);
  const vigentes = new Set(fotosActuales);
  const sobran = indice.filter((p) => !vigentes.has(p.imagen));

  if (!sobran.length) return 0;

  await db.batch(
    sobran.map((p) => db.prepare("DELETE FROM catalogo WHERE imagen = ?").bind(p.imagen))
  );

  console.log(`Índice: quité ${sobran.length} producto(s) que ya no están en Shopify`);
  return sobran.length;
}

// LOS 10 DEL CATÁLOGO QUE MÁS SE PARECEN A LA FOTO, SIN GASTAR MODELO.
//
// Esta es la pieza que hace que todo entre en el cupo. Comparar 15
// booleanos contra 400 filas es trabajo de milisegundos y de cero
// tokens; lo caro —mirar fotos— queda para los pocos que valen la pena.
//
// Los pesos no son arbitrarios. Que dos zapatos compartan un rasgo
// PRESENTE ("los dos tienen cámara de aire en el talón") dice mucho más
// que compartir uno ausente: casi todos los pares del catálogo no tienen
// casi ninguno de los 15 rasgos, así que los "no" coinciden por defecto
// y no distinguen nada. Y una diferencia pesa en contra más de lo que un
// "no" común pesa a favor, porque un rasgo que uno tiene y el otro no es
// justo lo que descarta un modelo.
const PUNTOS_COINCIDE_PRESENTE = 3;
const PUNTOS_COINCIDE_AUSENTE = 1;
const PUNTOS_DIFIERE = -2;

// EL COLOR PESA, Y PESA MÁS QUE LOS RASGOS (24-sep-2026).
//
// Queja número uno de la tienda: la historia enseña el zapato negro y el
// bot manda el mismo modelo en blanco. Pasaba porque el ranking solo
// miraba los 15 rasgos, y entre dos colores del MISMO modelo esos rasgos
// son idénticos — así que salía primero el que la base devolviera antes.
//
// Coincidir en color vale más que cualquier rasgo suelto (el máximo por
// rasgos son 45 puntos: 15 por 3). Y llevar OTRO color escrito en el
// título resta, porque ahí el título sí está contradiciendo a la foto.
// Un título que no nombra color no suma ni resta: "Tommy caballero" no
// dice nada, y no por eso es peor candidato.
const PUNTOS_MISMO_COLOR = 60;
const PUNTOS_OTRO_COLOR = -25;

export function mejoresPorRasgos(indice, rasgos, cuantos = 10, color = "") {
  if (!rasgos || typeof rasgos !== "object") return [];

  const conPuntos = indice
    .filter((producto) => producto.imagen && producto.rasgos)
    .map((producto) => ({
      producto,
      puntos: puntuar(producto.rasgos, rasgos) + puntosDeColor(producto.titulo, color),
    }));

  if (!conPuntos.length) return [];

  const ordenados = conPuntos.sort((a, b) => b.puntos - a.puntos);

  // UNO POR TÍTULO, EL QUE MEJOR PUNTÚA.
  //
  // Desde que el índice guarda una fila por foto, el mismo modelo aparece
  // varias veces —un color por fila—. Mandarle al modelo cinco fotos que
  // se llaman igual desperdicia la mitad de los candidatos, y cotejo.js
  // los colapsa por título después de todas formas. Así que se elige aquí
  // el color cuyos rasgos más se parecen a los de la foto del cliente, que
  // es justo el que hay que enseñar.
  const porTitulo = new Set();
  const elegidos = [];

  for (const { producto } of ordenados) {
    const clave = String(producto.titulo || "").toLowerCase();
    if (porTitulo.has(clave)) continue;
    porTitulo.add(clave);
    elegidos.push(producto);
    if (elegidos.length >= cuantos) break;
  }

  return elegidos;
}

export function puntosDeColor(titulo, color) {
  if (!color) return 0;
  if (tituloEsDelColor(titulo, color)) return PUNTOS_MISMO_COLOR;
  return tituloNombraColor(titulo) ? PUNTOS_OTRO_COLOR : 0;
}

// El parecido entre los rasgos de un producto y los de la foto. Se
// exporta para que cotejo.js pueda ordenar con el mismo criterio los
// productos que le llegan de Shopify.
export function parecidoDeRasgos(delCatalogo, deLaFoto) {
  if (!delCatalogo || !deLaFoto) return 0;
  return puntuar(delCatalogo, deLaFoto);
}

function puntuar(delCatalogo, deLaFoto) {
  let puntos = 0;

  for (const clave of RASGOS_CLAVE) {
    const a = delCatalogo[clave] === true;
    const b = deLaFoto[clave] === true;

    if (a !== b) puntos += PUNTOS_DIFIERE;
    else if (a) puntos += PUNTOS_COINCIDE_PRESENTE;
    else puntos += PUNTOS_COINCIDE_AUSENTE;
  }

  return puntos;
}

function leerRasgos(texto) {
  try {
    const datos = JSON.parse(texto || "{}");
    return datos && typeof datos === "object" ? datos : null;
  } catch {
    return null;
  }
}


/* ── Una tanda de indexación ────────────────────────────────────────── */
//
// ESTO ESTABA METIDO DENTRO DE LA RUTA /indexar-catalogo, Y POR ESO SOLO
// PASABA CUANDO ALGUIEN ABRÍA LA PÁGINA.
//
// El cotejo visual depende del índice: sin él no puede comparar la foto
// contra el catálogo entero y cae al barrido corto, que mira 20 productos
// de 581. Pero llenar el índice eran ~15 recargas a mano, y una tarea que
// depende de que alguien recargue quince veces es una tarea que no se
// hace. El índice se quedaba vacío y el cotejo, cojo.
//
// Sacado aquí, lo usan los dos: la ruta (para verlo y forzarlo) y el cron
// de scheduled() en index.js (para que se llene solo).

// De a cuántos se miran a la vez. El techo es el cupo por minuto de
// OpenAI; pasarse solo hace que la tanda falle entera.
const DE_A_LA_VEZ = 4;

export async function indexarTanda(env, { cuantos = 40, rehacer = false } = {}) {
  if (!env.DB) return { ok: false, error: "No hay base de datos conectada, y el índice vive ahí." };

  const { productos } = await traerCatalogoCompleto(env, Number(env.COTEJO_MAXIMO) || 600);
  if (!productos.length) return { ok: false, error: "Shopify no devolvió productos." };

  const indice = await leerIndice(env.DB);

  // Pendiente es el que no está guardado POR SU FOTO. Si le cambian la
  // imagen a un producto, su URL cambia, así que entra solo como nuevo.
  const guardados = new Set(indice.map((p) => p.imagen));

  // Un producto sin featuredImage no se puede indexar: el cotejo compara
  // imágenes y aquí no hay ninguna. Se cuentan aparte para que el
  // porcentaje no mienta y para que se vea cuántos son.
  const sinFoto = productos.filter((p) => !p.imagen).length;
  const indexables = productos.filter((p) => p.imagen);

  const pendientes = indexables.filter((p) => rehacer || !guardados.has(p.imagen));

  // EL PRECIO SE REFRESCA SIN GASTAR MODELO.
  //
  // Las fichas que se le mandan al cliente pueden salir del índice (el
  // cotejo elige de ahí, y también los parecidos que se enseñan cuando no
  // se puede afirmar cuál es). Si el precio guardado es el del día que se
  // indexó, el cliente ve un precio que ya no es — y eso se descubre al
  // cobrar, que es el peor momento.
  //
  // Mirar la foto cuesta una llamada al modelo; copiar el precio no cuesta
  // nada: ya viene en la respuesta de Shopify que se acaba de pedir. Así
  // que se actualiza en cada pasada, aunque el producto ya esté indexado.
  const refrescados = await refrescarPrecios(env.DB, indice, indexables);

  const tanda = pendientes.slice(0, cuantos);
  const modelo = modeloDeIndice(env);
  const indexados = [];
  let fallados = 0;
  let corto = "";

  // Si se acaba el cupo NO se abandona: aquí no hay ningún cliente
  // esperando, así que se espera a que vuelva y se sigue. Solo se corta
  // si la espera es tan larga que no vale la pena seguir en esta pasada.
  for (let i = 0; i < tanda.length; i += DE_A_LA_VEZ) {
    if (!(await esperarCupo(modelo))) {
      corto = "Me quedé sin cupo de OpenAI a mitad de la tanda.";
      console.log("Indexación: sin cupo y la espera es larga, corto la tanda");
      break;
    }

    const resultados = await Promise.all(
      tanda.slice(i, i + DE_A_LA_VEZ).map(async (producto) => {
        // Prompt propio, no el de visión completo: ver rasgosDeProducto().
        const visto = await rasgosDeProducto(env, producto.imagen, { modelo });
        return visto ? { ...producto, visto: visto.visto, rasgos: visto.rasgos } : null;
      })
    );

    indexados.push(...resultados.filter(Boolean));
    fallados += resultados.filter((r) => !r).length;
  }

  // Ni uno solo de los que se intentaron. Casi siempre es la clave de
  // OpenAI (sin saldo o sin permiso para este modelo), y quien llama
  // necesita distinguirlo de "ya estaba todo hecho".
  const ningunoSalio = tanda.length > 0 && indexados.length === 0;

  await guardarIndexados(env.DB, indexados);

  // RED DE SEGURIDAD CONTRA EL FALLO QUE NOS TUVO PARADOS.
  //
  // Se cuenta AQUÍ, justo después de guardar y antes de limpiar: si se
  // contara después, quitar una foto vieja restaría y la cuenta no
  // cuadraría aunque todo estuviera bien.
  //
  // Si se guardaron productos y las filas no subieron lo que debían, algo
  // los está pisando. Eso fue exactamente lo que pasó con la clave por
  // título, y lo peor no fue el fallo: fue que no dijo nada. Aquí grita.
  if (indexados.length) {
    const hayAhora = await contarFilas(env.DB);
    const nuevas = hayAhora - indice.length;
    if (nuevas < indexados.length) {
      console.error(
        `ÍNDICE: guardé ${indexados.length} producto(s) pero solo quedaron ${nuevas} ` +
          "fila(s) nuevas. Se están pisando entre ellos y la indexación no va a " +
          "terminar nunca. Mira la clave primaria de la tabla en indice.js."
      );
    }
  }

  const faltan = pendientes.length - indexados.length;

  // Solo cuando ya no falta nada: si se limpiara a mitad de la carga, un
  // producto todavía sin mirar parecería retirado.
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


async function contarFilas(db) {
  try {
    const { results } = await db.prepare("SELECT COUNT(*) AS n FROM catalogo").all();
    return Number(results?.[0]?.n) || 0;
  } catch {
    return 0;
  }
}


// De a cuántas filas se actualizan por llamada a D1. Son escrituras
// baratas, pero mandar 581 en una sola tanda es pedir un fallo.
const REFRESCO_POR_TANDA = 50;

// Copia el precio y el enlace de Shopify a las filas ya indexadas cuando
// cambiaron. No toca los rasgos ni la foto: eso es lo que costó mirar.
async function refrescarPrecios(db, indice, productos) {
  const deShopify = new Map(productos.map((p) => [p.imagen, p]));

  const cambiados = indice.filter((fila) => {
    const hoy = deShopify.get(fila.imagen);
    return hoy && (String(hoy.precio || "") !== String(fila.precio || "") ||
                   String(hoy.url || "") !== String(fila.url || ""));
  });

  if (!cambiados.length) return 0;

  for (let i = 0; i < cambiados.length; i += REFRESCO_POR_TANDA) {
    await db.batch(
      cambiados.slice(i, i + REFRESCO_POR_TANDA).map((fila) => {
        const hoy = deShopify.get(fila.imagen);
        return db
          .prepare("UPDATE catalogo SET precio = ?, url = ?, titulo = ? WHERE imagen = ?")
          .bind(hoy.precio || "", hoy.url || "", hoy.titulo, fila.imagen);
      })
    );
  }

  console.log(`Índice: actualicé precio o enlace de ${cambiados.length} producto(s), sin mirar ninguna foto`);
  return cambiados.length;
}
