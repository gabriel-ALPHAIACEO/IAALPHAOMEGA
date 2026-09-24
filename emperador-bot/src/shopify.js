// Búsqueda de productos en Shopify.
//
// Reproduce lo que hacía el módulo de Make: TODAS las palabras del término
// tienen que aparecer en el título. Por eso se unen con AND y cada una va
// entre asteriscos, que es el comodín de la búsqueda de Shopify.

const VERSION_API = "2026-01";

const CONSULTA = `
  query buscar($termino: String!, $cuantos: Int!) {
    products(first: $cuantos, query: $termino) {
      edges {
        node {
          title
          onlineStoreUrl
          featuredImage { url }
          priceRangeV2 { minVariantPrice { amount currencyCode } }
        }
      }
    }
  }
`;

// Devuelve { productos, hayMas }. "hayMas" es lo que permite distinguir
// "ya te mostré todo lo que hay de ese modelo" (de verdad son 10 o menos)
// de "hay más pero no caben en una ficha" (Instagram no admite más de 10
// elementos en un carrusel) — sin esto, el segundo caso se confundía con el
// primero y el cliente que preguntaba "¿solo tienes esos?" recibía marcas
// sin relación en vez del catálogo completo, que es donde sí estaban todos.
// TODO el catálogo, no una búsqueda.
//
// Existe para el barrido del cotejo visual (ver cotejo.js): cuando la
// búsqueda por nombre no da con el zapato de la foto, la única forma de
// encontrarlo es mirarlos todos. Shopify entrega hasta 250 por página,
// así que un catálogo de varios cientos son dos o tres llamadas — se
// hace en un segundo y no gasta nada de modelo.
//
// "maximo" es un tope de seguridad para que un catálogo enorme no se
// traiga entero sin querer. Devuelve { productos, completo }: "completo"
// dice si se llegó al final de verdad o si se cortó por el tope.
const POR_PAGINA = 250;

const CONSULTA_TODO = `
  query todo($cuantos: Int!, $cursor: String) {
    products(first: $cuantos, after: $cursor, query: "status:active") {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          title
          onlineStoreUrl
          featuredImage { url }
          priceRangeV2 { minVariantPrice { amount currencyCode } }
        }
      }
    }
  }
`;

export async function traerCatalogoCompleto(env, maximo = 1000) {
  const productos = [];
  let cursor = null;
  let completo = false;

  // Un tope duro de páginas: si algún día Shopify devolviera siempre
  // "hasNextPage", esto no se queda dando vueltas para siempre.
  for (let pagina = 0; pagina < 20; pagina++) {
    const datos = await consultar(env, CONSULTA_TODO, {
      cuantos: Math.min(POR_PAGINA, maximo - productos.length),
      cursor,
    });

    if (!datos) break;

    productos.push(...(datos.products?.edges || []).map(aProducto(env)));

    const info = datos.products?.pageInfo;
    if (!info?.hasNextPage) {
      completo = true;
      break;
    }

    if (productos.length >= maximo) break;
    cursor = info.endCursor;
  }

  console.log(
    `Catálogo completo: ${productos.length} productos` +
      (completo ? "" : ` (cortado en el tope de ${maximo})`)
  );

  return { productos, completo };
}

export async function buscarProductos(env, termino, cuantos = 10) {
  const palabras = String(termino || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);

  if (!palabras.length) return { productos: [], hayMas: false };

  // Las comillas dentro del término romperían la consulta de Shopify.
  // status:active deja fuera los borradores y los archivados: mostrarle a un
  // cliente algo que todavía no está publicado le hace pedir lo que no se le
  // puede vender.
  const consulta =
    palabras.map((p) => `title:*${p.replace(/["\\()]/g, "")}*`).join(" AND ") +
    " AND status:active";

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
          // Se pide uno de más a propósito: si vuelve, es la señal de que
          // el catálogo tiene más de los que caben en una ficha.
          variables: { termino: consulta, cuantos: cuantos + 1 },
        }),
      }
    );
  } catch (error) {
    console.error("No se pudo llamar a Shopify:", error.message);
    return { productos: [], hayMas: false };
  }

  if (!respuesta.ok) {
    console.error("Shopify respondió", respuesta.status, await respuesta.text());
    return { productos: [], hayMas: false };
  }

  const datos = await respuesta.json();
  if (datos.errors) {
    console.error("Shopify devolvió errores:", JSON.stringify(datos.errors));
    return { productos: [], hayMas: false };
  }

  const productos = (datos.data?.products?.edges || []).map(({ node }) => ({
    titulo: node.title,
    precio: formatearPrecio(node.priceRangeV2?.minVariantPrice),
    imagen: node.featuredImage?.url || "",
    url: node.onlineStoreUrl || env.URL_CATALOGO,
  }));

  const filtrados = sinFalsosPositivos(productos, palabras);
  const hayMas = filtrados.length > cuantos;

  return { productos: hayMas ? filtrados.slice(0, cuantos) : filtrados, hayMas };
}

// La búsqueda de Shopify es por subcadena, y con palabras cortas eso pesca
// cosas que no son. Dos casos reales de este catálogo:
//
//   "TN"        encuentra "Lebron WiTNess"    (9 de 12 resultados eran eso)
//   "Jordan 4"  encuentra "Jordan 40"         (y el Jordan 4 se llama Retro 4)
//
// Shopify no sabe buscar palabras completas, así que se comprueba aquí. Solo
// se aplica a las palabras cortas y a los números, que son las que fallan:
// con las largas la subcadena casi nunca se equivoca, y exigir palabra
// completa rompería los plurales.
const LARGO_SEGURO = 3;

function sinFalsosPositivos(productos, palabras) {
  const exigentes = palabras.filter(
    (p) => p.length <= LARGO_SEGURO || /^\d+$/.test(p)
  );
  if (!exigentes.length) return productos;

  const patrones = exigentes.map(
    (p) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapar(p)}([^\\p{L}\\p{N}]|$)`, "iu")
  );

  const buenos = productos.filter((producto) =>
    patrones.every((patron) => patron.test(producto.titulo))
  );

  if (buenos.length !== productos.length) {
    console.log(
      `Descarté ${productos.length - buenos.length} resultado(s) donde ` +
        `${exigentes.map((p) => `"${p}"`).join(", ")} estaba dentro de otra palabra`
    );
  }

  return buenos;
}

function escapar(texto) {
  return String(texto).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatearPrecio(precio) {
  if (!precio?.amount) return "";
  const cifra = Number(precio.amount);
  const redondo = Number.isInteger(cifra) ? String(cifra) : cifra.toFixed(2);
  return `${redondo} ${precio.currencyCode || ""}`.trim();
}

// Una llamada a la API de Shopify. Devuelve datos.data o null: quien
// llama decide qué hacer sin nada, pero nunca revienta por un fallo de
// red — un cliente esperando no se merece un error del sistema.
async function consultar(env, query, variables) {
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
        body: JSON.stringify({ query, variables }),
      }
    );
  } catch (error) {
    console.error("No se pudo llamar a Shopify:", error.message);
    return null;
  }

  if (!respuesta.ok) {
    console.error("Shopify respondió", respuesta.status, await respuesta.text());
    return null;
  }

  const datos = await respuesta.json();
  if (datos.errors) {
    console.error("Shopify devolvió errores:", JSON.stringify(datos.errors));
    return null;
  }

  return datos.data || null;
}

function aProducto(env) {
  return ({ node }) => ({
    titulo: node.title,
    precio: formatearPrecio(node.priceRangeV2?.minVariantPrice),
    imagen: node.featuredImage?.url || "",
    url: node.onlineStoreUrl || env.URL_CATALOGO,
  });
}
