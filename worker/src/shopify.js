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

export async function buscarProductos(env, termino, cuantos = 10) {
  const palabras = String(termino || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);

  if (!palabras.length) return [];

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
          variables: { termino: consulta, cuantos },
        }),
      }
    );
  } catch (error) {
    console.error("No se pudo llamar a Shopify:", error.message);
    return [];
  }

  if (!respuesta.ok) {
    console.error("Shopify respondió", respuesta.status, await respuesta.text());
    return [];
  }

  const datos = await respuesta.json();
  if (datos.errors) {
    console.error("Shopify devolvió errores:", JSON.stringify(datos.errors));
    return [];
  }

  const productos = (datos.data?.products?.edges || []).map(({ node }) => ({
    titulo: node.title,
    precio: formatearPrecio(node.priceRangeV2?.minVariantPrice),
    imagen: node.featuredImage?.url || "",
    url: node.onlineStoreUrl || env.URL_CATALOGO,
  }));

  return sinFalsosPositivos(productos, palabras);
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
