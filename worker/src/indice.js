// EL CATÁLOGO, SACADO DE SHOPIFY EN VEZ DE ESCRITO A MANO.
//
// EL PROBLEMA QUE RESUELVE. El modelo solo puede vender lo que sabe que
// existe: si el cliente pide "Salomon" y ese nombre no está en el prompt,
// la IA no lo ofrece, y si se inventa un término la búsqueda devuelve cero
// y el cliente se va creyendo que no hay. Hasta hoy esa lista de nombres
// vivía escrita a mano en tiendas/<tienda>.js, y había que pegarla de nuevo
// cada vez que entraba mercancía. Entre una pegada y la siguiente, TODO lo
// nuevo era invisible para el bot.
//
// LO QUE HACE AHORA. El Worker le pregunta a Shopify por sus productos, se
// guarda los títulos en D1 y arma con ellos el bloque de catálogo del
// prompt. Se refresca solo (cron en wrangler.toml) y a mano en /indice.
//
// POR QUÉ SE GUARDA EN D1 Y NO SE PREGUNTA EN CADA MENSAJE. Recorrer el
// catálogo entero son varias llamadas a Shopify; hacerlo por cada cliente
// que escribe sería lento y caro. Se hace una vez cada varias horas, se
// deja en la base, y atender un mensaje es una sola lectura.
//
// LO QUE ESTE ÍNDICE **NO** TOCA. La tabla de TÉRMINOS VERIFICADOS
// (tiendas/<tienda>.js) sigue siendo a mano, y así debe ser: es lo que
// traduce lo que dice el cliente ("tn", "jordan 4") al término que de
// verdad encuentra producto en ESTE catálogo. Eso no se deduce de los
// títulos. El índice dice QUÉ HAY; los términos dicen CÓMO SE BUSCA. Para
// ver qué entró nuevo y todavía no tiene término, está /indice.

import { tiendaDe } from "./tienda.js";

const VERSION_API = "2026-01";

// Lo máximo que admite la API de Shopify por página.
const POR_PAGINA = 250;

// Tope de seguridad. 20 páginas son 5000 productos: mucho más de lo que
// tiene ninguna de estas tiendas. Existe para que un fallo de paginación
// (un cursor que no avanza) no deje al Worker dando vueltas para siempre.
const MAX_PAGINAS = 20;

// Cuántos títulos caben en el prompt. Cada título son ~10 tokens y el
// prompt ya trae mil líneas de reglas; pasarse de aquí encarece CADA
// mensaje del día. Si una tienda crece tanto, /indice lo avisa.
const MAX_EN_PROMPT = 1500;

// Cuánto vale la lista en memoria antes de volver a leer D1. El catálogo
// cambia cada varias horas, no cada minuto: leerlo en cada mensaje sería
// una consulta regalada.
const CACHE_MS = 10 * 60 * 1000;

// MISMO FILTRO QUE LA BÚSQUEDA (shopify.js). Crítico: el índice tiene que
// enseñar EXACTAMENTE lo que la búsqueda puede encontrar. Si aquí entraran
// los borradores, el bot ofrecería modelos que luego no aparecen, que es
// peor que no ofrecerlos.
const FILTRO = "status:active";

const CONSULTA = `
  query indexar($cuantos: Int!, $cursor: String, $filtro: String!) {
    products(first: $cuantos, after: $cursor, query: $filtro, sortKey: TITLE) {
      pageInfo { hasNextPage endCursor }
      edges { node { title } }
    }
  }
`;

// La lista viva de este isolate. Se reinicia solo con el Worker.
let memoria = { titulos: null, huella: "", cuando: 0 };

/* ── Leer el índice ─────────────────────────────────────────────────── */

// Los títulos indexados, o [] si todavía no se ha indexado nada.
//
// NUNCA lanza: si D1 no está o la tabla no existe, devuelve lista vacía y
// quien llama se queda con el catálogo escrito a mano. Un índice caído no
// puede dejar al bot sin atender.
export async function titulosIndexados(env, { frescos = false } = {}) {
  // Sin base no hay índice, y la lista que se haya quedado en memoria no
  // vale: se comprueba ANTES del cache para que la respuesta dependa de
  // este env y no de la última llamada que pasó por aquí.
  if (!env.DB) return [];

  const ahora = Date.now();

  if (!frescos && memoria.titulos && ahora - memoria.cuando < CACHE_MS) {
    return memoria.titulos;
  }

  let titulos = [];
  try {
    const { results } = await env.DB.prepare(
      "SELECT titulo FROM catalogo ORDER BY titulo"
    ).all();
    titulos = (results || []).map((fila) => String(fila.titulo)).filter(Boolean);
  } catch (error) {
    // La tabla no existe todavía (nadie ha indexado aún). No es un fallo:
    // es el estado normal antes de la primera sincronización.
    console.log("El índice todavía no se puede leer:", error?.message || error);
    titulos = [];
  }

  memoria = { titulos, huella: huellaDe(titulos), cuando: ahora };
  return titulos;
}

// Los dos bloques de catálogo del prompt, armados con el índice.
//
// Devuelve {} cuando no hay índice. Ese {} es lo que hace que tienda.js
// siga usando la lista escrita a mano: el bot nunca se queda sin catálogo
// por culpa de este archivo.
export async function bloquesDeCatalogo(env) {
  const titulos = await titulosIndexados(env);
  if (!titulos.length) return {};

  if (titulos.length > MAX_EN_PROMPT) {
    console.warn(
      `El índice tiene ${titulos.length} títulos y solo caben ${MAX_EN_PROMPT} ` +
        "en el prompt. Se usan los primeros por orden alfabético."
    );
  }

  const lista = titulos.slice(0, MAX_EN_PROMPT).join("\n");

  return {
    huella: memoria.huella,
    CATALOGO: `CATÁLOGO — NOMBRES REALES

Estos son los productos que existen en la tienda, escritos EXACTAMENTE como
aparecen en los títulos:

${lista}`,
    CATALOGO_VISION: `Estos son los productos de la tienda. Solo puedes identificar modelos que
estén aquí:

${lista}`,
  };
}

/* ── Rehacer el índice ──────────────────────────────────────────────── */

// Recorre TODO el catálogo de Shopify y deja la tabla igual a lo que hay
// publicado ahora mismo. Devuelve un resumen para /indice y para el cron.
export async function sincronizarIndice(env) {
  if (!env.DB) {
    return { ok: false, error: "Falta el binding DB. Revisa [[d1_databases]] en wrangler.toml." };
  }
  if (!env.SHOPIFY_TIENDA || !env.SHOPIFY_TOKEN) {
    return {
      ok: false,
      error:
        "Falta SHOPIFY_TIENDA (wrangler.toml) o SHOPIFY_TOKEN (npx wrangler secret put SHOPIFY_TOKEN).",
    };
  }

  const traidos = await traerTodo(env);
  if (!traidos.ok) return traidos;

  // SI SHOPIFY DEVUELVE CERO, NO SE BORRA NADA. Un token caducado, un
  // permiso retirado o un mal día de la API contestan "no hay productos"
  // sin dar error, y hacerle caso dejaría al bot sin catálogo y sin saber
  // por qué. Ante la duda, se conserva lo que ya había.
  if (!traidos.titulos.length) {
    return {
      ok: false,
      error:
        "Shopify no devolvió ni un producto. No se tocó el índice anterior. " +
        "Revisa SHOPIFY_TOKEN y que la app tenga permiso de lectura de productos.",
    };
  }

  const ahora = Date.now();

  try {
    await asegurarTabla(env.DB);

    const antes = new Set(
      (
        (await env.DB.prepare("SELECT titulo FROM catalogo").all()).results || []
      ).map((fila) => String(fila.titulo))
    );

    await guardar(env.DB, traidos.titulos, ahora);

    // Lo que no vino en esta pasada ya no está publicado: fuera. Así el bot
    // deja de ofrecer lo que la tienda retiró, que es la otra mitad de estar
    // al día.
    const borrado = await env.DB.prepare("DELETE FROM catalogo WHERE ultimo < ?")
      .bind(ahora)
      .run();

    const nuevos = traidos.titulos.filter((t) => !antes.has(t));

    // La lista en memoria acaba de quedar vieja.
    memoria = { titulos: null, huella: "", cuando: 0 };

    const resumen = {
      ok: true,
      total: traidos.titulos.length,
      paginas: traidos.paginas,
      nuevos,
      retirados: borrado?.meta?.changes ?? 0,
      cuando: ahora,
    };

    console.log(
      `Índice al día: ${resumen.total} productos ` +
        `(${nuevos.length} nuevos, ${resumen.retirados} retirados)`
    );

    return resumen;
  } catch (error) {
    return { ok: false, error: `No se pudo guardar el índice: ${error?.message || error}` };
  }
}

async function traerTodo(env) {
  const titulos = [];
  const vistos = new Set();
  let cursor = null;
  let paginas = 0;

  while (paginas < MAX_PAGINAS) {
    let respuesta;
    try {
      respuesta = await fetch(
        `https://${env.SHOPIFY_TIENDA}/admin/api/${VERSION_API}/graphql.json`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Shopify-Access-Token": env.SHOPIFY_TOKEN,
          },
          body: JSON.stringify({
            query: CONSULTA,
            variables: { cuantos: POR_PAGINA, cursor, filtro: FILTRO },
          }),
        }
      );
    } catch (error) {
      return { ok: false, error: `No se pudo llamar a Shopify: ${error?.message || error}` };
    }

    if (!respuesta.ok) {
      return {
        ok: false,
        error: `Shopify respondió ${respuesta.status}: ${(await respuesta.text()).slice(0, 300)}`,
      };
    }

    const datos = await respuesta.json();
    if (datos.errors) {
      return { ok: false, error: `Shopify devolvió errores: ${JSON.stringify(datos.errors).slice(0, 300)}` };
    }

    paginas++;
    const pagina = datos.data?.products;

    for (const { node } of pagina?.edges || []) {
      const titulo = String(node?.title || "").trim();
      // Shopify permite dos productos con el mismo título, y en este
      // catálogo los hay. En el prompt sobran: son el mismo nombre.
      if (titulo && !vistos.has(titulo)) {
        vistos.add(titulo);
        titulos.push(titulo);
      }
    }

    if (!pagina?.pageInfo?.hasNextPage) break;

    const siguiente = pagina.pageInfo.endCursor;
    // Un cursor que no avanza sería un bucle infinito disfrazado de paginación.
    if (!siguiente || siguiente === cursor) break;
    cursor = siguiente;
  }

  if (paginas >= MAX_PAGINAS) {
    console.warn(`Me planté en ${MAX_PAGINAS} páginas. Puede que el catálogo esté incompleto.`);
  }

  return { ok: true, titulos, paginas };
}

// LA TABLA SE CREA SOLA, a propósito.
//
// El dueño despliega copiando archivos a mano, así que pedirle que además
// corra una migración es pedirle que se acuerde de algo el día que menos
// tiempo tiene. La migración 0004 existe para quien quiera correrla, pero
// no hace falta: con esto, el índice funciona desde el primer despliegue.
async function asegurarTabla(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS catalogo (
         titulo  TEXT PRIMARY KEY,
         primero INTEGER NOT NULL,
         ultimo  INTEGER NOT NULL
       )`
    )
    .run();
}

// De a tandas: D1 no acepta una sentencia por producto en una sola llamada,
// y tampoco hace falta mandarlas de una en una.
const POR_TANDA = 50;

async function guardar(db, titulos, ahora) {
  const sentencia = db.prepare(
    `INSERT INTO catalogo (titulo, primero, ultimo)
     VALUES (?, ?, ?)
     ON CONFLICT(titulo) DO UPDATE SET ultimo = excluded.ultimo`
  );

  for (let i = 0; i < titulos.length; i += POR_TANDA) {
    await db.batch(
      titulos.slice(i, i + POR_TANDA).map((titulo) => sentencia.bind(titulo, ahora, ahora))
    );
  }
}

/* ── Para /estado y /indice ─────────────────────────────────────────── */

// Qué tiene el índice ahora mismo, en líneas listas para imprimir.
export async function revisarIndice(env) {
  const tienda = tiendaDe(env);
  const aMano = contarTitulos(tienda.catalogo);

  if (!env.DB) {
    return [
      "  Índice              SIN BASE (falta el binding DB)",
      `  Se usa la lista escrita a mano: ${aMano} títulos.`,
    ];
  }

  let fila;
  try {
    fila = await env.DB.prepare(
      "SELECT COUNT(*) AS total, MAX(ultimo) AS ultimo, MAX(primero) AS primero FROM catalogo"
    ).first();
  } catch {
    return [
      "  Índice              TODAVÍA NO SE HA HECHO",
      `  Mientras tanto se usa la lista escrita a mano: ${aMano} títulos.`,
      "  Para hacerlo ahora:  https://<tu-worker>/indice?sincronizar=1",
    ];
  }

  const total = Number(fila?.total) || 0;
  if (!total) {
    return [
      "  Índice              VACÍO",
      `  Mientras tanto se usa la lista escrita a mano: ${aMano} títulos.`,
      "  Para llenarlo ahora: https://<tu-worker>/indice?sincronizar=1",
    ];
  }

  return [
    `  Índice              ${total} productos (manda este, no la lista a mano)`,
    `  Última pasada       ${hace(Number(fila?.ultimo) || 0)}`,
    `  Lista a mano        ${aMano} títulos (queda de respaldo, por si el índice falla)`,
  ];
}

// Cuántos títulos trae el bloque escrito a mano. Los bloques empiezan con
// un encabezado que termina en ":" y luego vienen los títulos, uno por
// línea; se cuenta lo que hay DESPUÉS de esos dos puntos.
function contarTitulos(bloque) {
  if (!bloque) return 0;
  const lineas = String(bloque).split("\n");
  const finDelEncabezado = lineas.map((l) => l.trimEnd().endsWith(":")).lastIndexOf(true);
  return lineas.slice(finDelEncabezado + 1).filter((linea) => linea.trim()).length;
}

function hace(cuando) {
  if (!cuando) return "nunca";
  const minutos = Math.round((Date.now() - cuando) / 60000);
  if (minutos < 1) return "hace un momento";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 48) return `hace ${horas} h`;
  return `hace ${Math.round(horas / 24)} días`;
}

// Una firma corta de la lista, para saber si cambió sin comparar mil
// títulos. Sirve para tirar el prompt armado cuando entra mercancía nueva.
function huellaDe(titulos) {
  let suma = 0;
  for (const titulo of titulos) {
    for (let i = 0; i < titulo.length; i++) {
      suma = (suma * 31 + titulo.charCodeAt(i)) >>> 0;
    }
  }
  return `${titulos.length}-${suma.toString(36)}`;
}
