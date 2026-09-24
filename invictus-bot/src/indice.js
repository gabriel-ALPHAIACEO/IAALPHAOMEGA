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

const TABLA = `
  CREATE TABLE IF NOT EXISTS catalogo (
    titulo TEXT PRIMARY KEY,
    imagen TEXT,
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
             (titulo, imagen, precio, url, visto, rasgos, actualizado)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          fila.titulo,
          fila.imagen || "",
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
export async function limpiarLosQueYaNoEstan(db, titulosActuales) {
  if (!db || !titulosActuales.length) return 0;

  const indice = await leerIndice(db);
  const vigentes = new Set(titulosActuales);
  const sobran = indice.filter((p) => !vigentes.has(p.titulo));

  if (!sobran.length) return 0;

  await db.batch(
    sobran.map((p) => db.prepare("DELETE FROM catalogo WHERE titulo = ?").bind(p.titulo))
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

export function mejoresPorRasgos(indice, rasgos, cuantos = 10) {
  if (!rasgos || typeof rasgos !== "object") return [];

  const conPuntos = indice
    .filter((producto) => producto.imagen && producto.rasgos)
    .map((producto) => ({ producto, puntos: puntuar(producto.rasgos, rasgos) }));

  if (!conPuntos.length) return [];

  return conPuntos
    .sort((a, b) => b.puntos - a.puntos)
    .slice(0, cuantos)
    .map(({ producto }) => producto);
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

  // Se reindexa un producto si nunca se miró o si le cambiaron la foto: la
  // URL del CDN de Shopify cambia con la imagen, así que comparar la URL
  // alcanza para saberlo.
  const guardados = new Map(indice.map((p) => [p.titulo, p]));
  const pendientes = productos.filter((p) => {
    if (!p.imagen) return false;
    if (rehacer) return true;
    const antes = guardados.get(p.titulo);
    return !antes || antes.imagen !== p.imagen;
  });

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

  const faltan = pendientes.length - indexados.length;

  // Solo cuando ya no falta nada: si se limpiara a mitad de la carga, un
  // producto todavía sin mirar parecería retirado.
  let quitados = 0;
  if (!faltan) {
    quitados = await limpiarLosQueYaNoEstan(env.DB, productos.map((p) => p.titulo));
  }

  return {
    ok: true,
    catalogo: productos.length,
    yaEstaban: indice.length,
    intentados: tanda.length,
    indexados: indexados.length,
    fallados,
    pendientes: pendientes.length,
    faltan,
    quitados,
    corto,
    modelo,
    ningunoSalio,
  };
}
