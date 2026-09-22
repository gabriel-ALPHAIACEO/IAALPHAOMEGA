// Catálogo en una hoja de Google Sheets.
//
// No hace falta cuenta de Google Cloud ni clave de API: basta con compartir
// la hoja como "cualquier persona con el enlace puede ver". Google sirve el
// contenido en CSV por una dirección pública y aquí se lee y se filtra.
//
// NO HACE FALTA QUE RENOMBRES TUS COLUMNAS. Se reconocen los nombres que se
// usan normalmente en una hoja de inventario (ver SINONIMOS aquí abajo), y
// la fila de encabezados se busca en las primeras filas, así que da igual
// que arriba tengas un título o una fila en blanco.
//
// Lo único imprescindible es una columna con el nombre del producto y otra
// con el precio. Si algo no cuadra, abre /probar-hoja en tu Worker: te dice
// exactamente qué columnas encontró y qué entendió.

// La respuesta se guarda en caché unos minutos: si no, cada mensaje de cada
// cliente se descargaría la hoja entera.
const MINUTOS_DE_CACHE = 5;

// Cuántas filas se miran, desde arriba, buscando la de los encabezados.
const FILAS_PARA_BUSCAR_ENCABEZADOS = 10;

// Nombres que puede tener cada columna en tu hoja. Se comparan sin tildes,
// sin mayúsculas y sin espacios, así que "Descripción" y "descripcion" son
// lo mismo. Si tu columna se llama de otra forma, añádela a la lista.
const SINONIMOS = {
  titulo: [
    "titulo", "título", "producto", "modelo", "equipo", "articulo",
    "artículo", "descripcion", "descripción", "nombre", "item", "detalle",
  ],
  precio: [
    "precio", "precios", "pvp", "valor", "costo", "coste", "monto",
    "preciousd", "preciodolares", "precioventa", "venta", "preciodivisas",
  ],
  // La segunda moneda del precio en divisas: "$150 · Bs 5.400". Si tu hoja
  // no tiene esta columna, no pasa nada, el precio sale solo en la primera.
  precioLocal: [
    "preciobs", "preciolocal", "bolivares", "bolívares", "preciobolivares",
    "precio2", "preciopesos", "preciosoles", "preciolempiras",
  ],
  // El precio a crédito con Cashea. Es el que la ficha muestra POR DEFECTO;
  // el de divisas sale cuando el cliente lo pide (ver manychat.js).
  precioCashea: [
    "cashea", "preciocashea", "precioconcashea", "casheausd",
  ],
  imagen: ["imagen", "imagenes", "foto", "fotos", "img", "urlimagen", "linkimagen"],
  enlace: ["enlace", "link", "url", "enlaceproducto", "linkproducto"],
  activo: ["activo", "activa", "estado", "publicado", "visible", "disponible"],
  stock: ["stock", "cantidad", "existencia", "existencias", "unidades", "inventario"],
};

// Devuelve { productos, hayMas }. "hayMas" dice si había MÁS de los que se
// devuelven: un carrusel de Instagram admite 10, y si de ese modelo hay 14,
// el cliente tiene que saber que en el catálogo están los otros 4 (ver
// index.js). Sin esto, "¿solo tienes esos?" no tiene respuesta honesta.
export async function buscarProductos(env, termino, cuantos = 10) {
  const palabras = palabrasDeBusqueda(termino).slice(0, 5);
  if (!palabras.length) return { productos: [], hayMas: false };

  const { productos } = await leerHoja(env);
  if (!productos.length) return { productos: [], hayMas: false };

  // TODAS las palabras del término tienen que estar en el título. Es más
  // estricto, pero evita que pedir un modelo concreto devuelva media tienda.
  const encontrados = productos.filter((p) =>
    palabras.every((palabra) => coincide(palabra, p.busqueda))
  );

  return {
    productos: encontrados.slice(0, cuantos).map(({ busqueda, ...producto }) => producto),
    hayMas: encontrados.length > cuantos,
  };
}

// CÓMO SE COMPARA UNA PALABRA CON UN TÍTULO (crítico en teléfonos).
//
// Antes se buscaba la palabra como texto suelto dentro del título, y con
// números eso falla feo: "iPhone 12" traía también el "iPhone 11 512GB",
// porque "512" contiene "12". Y "128gb" no encontraba "128 GB" por el
// espacio. Ahora:
//
//   · Los números valen como número ENTERO: "12" encuentra "12" y "12GB",
//     pero no "512" ni "120".
//   · Las palabras valen desde el principio: "samsu" encuentra "Samsung", y
//     "negr" encuentra "negro" y "negra" (lo usa la búsqueda por color).
//   · "iphone15" (todo junto, como escribe mucha gente) encuentra "iPhone 15".
//   · Sin tildes ni mayúsculas, y "128 GB" = "128GB".
function coincide(palabra, { piezas, junto }) {
  if (/^\d+$/.test(palabra)) {
    return piezas.some(
      (pieza) => pieza === palabra || (pieza.startsWith(palabra) && /^[a-z]/.test(pieza.slice(palabra.length)))
    );
  }
  if (piezas.some((pieza) => pieza.startsWith(palabra))) return true;
  // Letras y números pegados: "iphone15", "s24ultra".
  return /\d/.test(palabra) && /[a-z]/.test(palabra) && junto.includes(palabra);
}

function paraBuscar(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    // "128 GB" → "128gb", "5000 mAh" → "5000mah": la unidad va pegada.
    .replace(/(\d)\s+(gb|tb|mb|mah|mp|hz|w)\b/g, "$1$2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function palabrasDeBusqueda(termino) {
  return paraBuscar(termino).split(" ").filter(Boolean);
}

function indiceDeBusqueda(titulo) {
  const piezas = palabrasDeBusqueda(titulo);
  return { piezas, junto: piezas.join("") };
}

// La lista de títulos, lista para pegarla en el prompt del modelo. Es lo que
// conecta la IA con la hoja: sin esto, el modelo elige el término de
// búsqueda a ciegas, sin saber qué existe de verdad en el catálogo.
//
// Se recorta por CARACTERES, no por cantidad de filas: una hoja de 2000
// productos no cabe entera en un mensaje sin disparar el costo y el tiempo
// de cada respuesta. El recorte es por tamaño de texto, así que da igual si
// los títulos son cortos o largos.
const MAXIMO_CARACTERES_CATALOGO = 6000;

export async function listaDeTitulos(env, limite = MAXIMO_CARACTERES_CATALOGO) {
  const { productos, aviso } = await leerHoja(env);

  if (aviso) {
    // Mismo motivo que ve /probar-hoja: si la hoja no carga, mejor que el
    // modelo lo sepa y no se invente que el catálogo está vacío.
    return `(No pude leer el catálogo: ${aviso})`;
  }

  if (!productos.length) return "(El catálogo está vacío ahora mismo.)";

  const lineas = [];
  let usados = 0;
  let cuantos = 0;

  for (const p of productos) {
    const linea = p.titulo;
    // +1 por el salto de línea que separa cada título.
    if (usados + linea.length + 1 > limite) break;
    lineas.push(linea);
    usados += linea.length + 1;
    cuantos++;
  }

  if (cuantos < productos.length) {
    lineas.push(`… y ${productos.length - cuantos} equipos más en el catálogo.`);
  }

  return lineas.join("\n");
}

// Lo que ve el Worker cuando mira tu hoja, en texto plano. Lo usa la ruta
// /probar-hoja para que no haya que adivinar qué está fallando.
export async function diagnosticoHoja(env) {
  const { productos, aviso, encabezados, filasLeidas, columnas } = await leerHoja(env);

  const lineas = [
    `SHEET_ID:     ${env.SHEET_ID || "(sin definir)"}`,
    `SHEET_NOMBRE: ${env.SHEET_NOMBRE || "(sin definir, se usa 'Hoja 1')"}`,
    "",
  ];

  if (aviso) {
    lineas.push(`PROBLEMA: ${aviso}`);
    if (encabezados?.length) {
      lineas.push("", `La primera fila de la hoja dice: ${encabezados.join(" | ")}`);
    }
    return lineas.join("\n") + "\n";
  }

  lineas.push(
    `Filas leídas de la hoja: ${filasLeidas}`,
    `Encabezados encontrados: ${encabezados.join(" | ")}`,
    "",
    "Columnas que el bot entendió:",
    `  nombre del producto -> ${columnas.titulo}`,
    `  precio              -> ${columnas.precio}`,
    `  precio 2ª moneda    -> ${columnas.precioLocal}`,
    `  precio Cashea       -> ${columnas.precioCashea}`,
    `  imagen              -> ${columnas.imagen}`,
    `  enlace              -> ${columnas.enlace}`,
    `  activo/estado       -> ${columnas.activo}`,
    `  stock/cantidad      -> ${columnas.stock}`,
    "",
    `Productos visibles para el cliente: ${productos.length}`,
    ""
  );

  if (!productos.length) {
    lineas.push(
      "No quedó ningún producto. Suele ser una de estas:",
      "  - la columna de estado dice NO / 0 / borrador en todas las filas",
      "  - la columna de cantidad está en 0 en todas las filas",
      "  - los productos empiezan más abajo de la fila 10 y arriba no hay",
      "    encabezados reconocibles",
      ""
    );
    return lineas.join("\n") + "\n";
  }

  lineas.push("Los primeros 5, tal como los ve el bot:");
  for (const p of productos.slice(0, 5)) {
    lineas.push(
      `  ${p.titulo}  —  ${p.precio || "(sin precio)"}` +
        `${p.precioCashea ? `  (Cashea: ${p.precioCashea})` : ""}` +
        `${p.imagen ? "  [con foto]" : ""}`
    );
  }
  lineas.push(
    "",
    "Si un cliente escribe 'iphone 15', el bot busca esas dos palabras dentro",
    "del nombre del producto. Compruébalo arriba: si tus nombres no las",
    "llevan tal cual, la búsqueda no encontrará nada."
  );

  return lineas.join("\n") + "\n";
}

// Caché EN MEMORIA del propio Worker, además del caché HTTP de más abajo.
//
// EL PROBLEMA QUE RESUELVE: en un mismo mensaje, listaDeTitulos() Y
// buscarProductos() llaman cada una a leerHoja() por su cuenta. Sin esto,
// eso son DOS descargas completas de la hoja de Google por cada mensaje del
// cliente —además de la llamada a OpenAI—, y esa duplicación es la primera
// sospechosa cuando el bot se siente lento.
//
// Cloudflare puede mantener esta variable viva entre mensajes distintos
// mientras el Worker siga "caliente" (no siempre, pero ayuda cuando hay
// varios clientes escribiendo seguido). El caché HTTP de más abajo es el
// respaldo para cuando esta memoria se pierde.
let cacheEnMemoria = null; // { clave, vencido, datos }

async function leerHoja(env) {
  const clave = `${env.SHEET_ID}::${env.SHEET_NOMBRE || "Hoja 1"}`;

  if (
    cacheEnMemoria &&
    cacheEnMemoria.clave === clave &&
    cacheEnMemoria.vencido > Date.now()
  ) {
    return cacheEnMemoria.datos;
  }

  const datos = await leerHojaDeVerdad(env);

  // Solo se guarda el camino feliz. Un fallo (hoja no pública, id malo) no
  // se cachea: si se cachea, el bot se queda diciendo "no hay productos"
  // durante 5 minutos aunque el fallo dure un segundo.
  if (!datos.aviso) {
    cacheEnMemoria = { clave, vencido: Date.now() + MINUTOS_DE_CACHE * 60 * 1000, datos };
  }

  return datos;
}

async function leerHojaDeVerdad(env) {
  const vacio = { productos: [], encabezados: [], filasLeidas: 0, columnas: {} };

  if (!env.SHEET_ID || /^PEGA_AQUI/i.test(env.SHEET_ID)) {
    const aviso = "falta SHEET_ID en wrangler.toml, o sigue con el texto de ejemplo.";
    console.error(aviso);
    return { ...vacio, aviso };
  }

  const hoja = encodeURIComponent(env.SHEET_NOMBRE || "Hoja 1");
  const url =
    `https://docs.google.com/spreadsheets/d/${env.SHEET_ID}` +
    `/gviz/tq?tqx=out:csv&sheet=${hoja}`;

  let respuesta;
  try {
    respuesta = await fetch(url, {
      cf: { cacheTtl: MINUTOS_DE_CACHE * 60, cacheEverything: true },
    });
  } catch (error) {
    const aviso = `no se pudo conectar con Google: ${error.message}`;
    console.error(aviso);
    return { ...vacio, aviso };
  }

  if (!respuesta.ok) {
    // 404 casi siempre es el nombre de la pestaña mal escrito; 400, el id.
    const aviso =
      `Google respondió ${respuesta.status}. ` +
      (respuesta.status === 404
        ? "Revisa SHEET_NOMBRE: tiene que ser el nombre exacto de la pestaña, " +
          "tal como se lee en la parte de abajo de la hoja."
        : "Revisa SHEET_ID: es el trozo de la dirección entre /d/ y /edit.");
    console.error(aviso);
    return { ...vacio, aviso };
  }

  const texto = await respuesta.text();

  // Si la hoja no es pública, Google devuelve una página de inicio de sesión
  // en vez del CSV. Sin esta comprobación el bot diría que no hay productos.
  if (texto.trimStart().startsWith("<")) {
    const aviso =
      "la hoja no es pública. Ábrela, botón Compartir → Acceso general → " +
      "'Cualquier persona con el enlace' → Lector.";
    console.error(aviso);
    return { ...vacio, aviso };
  }

  return convertir(leerCsv(texto), env);
}

// Quita tildes, mayúsculas, espacios y signos para comparar nombres de
// columna: "Precio (USD)" y "precio usd" acaban siendo lo mismo.
function normalizar(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function convertir(filas, env) {
  const vacio = { productos: [], encabezados: [], filasLeidas: filas.length, columnas: {} };

  if (filas.length < 2) {
    const aviso = "la hoja llegó vacía o con una sola fila.";
    console.error(aviso);
    return { ...vacio, aviso };
  }

  // Los encabezados no siempre están en la primera fila: muchas hojas de
  // inventario llevan arriba un título o una fila en blanco. Se busca la
  // primera fila que tenga algo reconocible como nombre de producto.
  let filaEncabezados = -1;
  let indices = null;

  const tope = Math.min(FILAS_PARA_BUSCAR_ENCABEZADOS, filas.length);
  for (let i = 0; i < tope; i++) {
    const candidatos = ubicarColumnas(filas[i]);
    if (candidatos.titulo !== -1) {
      filaEncabezados = i;
      indices = candidatos;
      break;
    }
  }

  if (!indices) {
    const aviso =
      "no encontré la columna con el nombre del producto. Ponle a esa " +
      "columna un encabezado como 'titulo', 'modelo', 'producto' o " +
      "'descripcion', dentro de las primeras filas de la hoja.";
    console.error(aviso);
    return {
      ...vacio,
      aviso,
      encabezados: (filas[0] || []).map((c) => String(c).trim()),
    };
  }

  const encabezados = filas[filaEncabezados].map((c) => String(c).trim());
  const nombreDe = (i) => (i === -1 ? "(no encontrada)" : `"${encabezados[i]}"`);

  const columnas = {
    titulo: nombreDe(indices.titulo),
    precio: nombreDe(indices.precio),
    precioLocal: nombreDe(indices.precioLocal),
    precioCashea: nombreDe(indices.precioCashea),
    imagen: nombreDe(indices.imagen),
    enlace: nombreDe(indices.enlace),
    activo: nombreDe(indices.activo),
    stock: nombreDe(indices.stock),
  };

  const productos = [];

  for (const fila of filas.slice(filaEncabezados + 1)) {
    const titulo = String(fila[indices.titulo] || "").trim();
    if (!titulo) continue;

    // Solo se esconde con un NO explícito: una celda vacía se toma como
    // activo, para que no haya que rellenar la columna producto a producto.
    if (indices.activo !== -1) {
      const estado = normalizar(fila[indices.activo]);
      if (["no", "0", "false", "borrador", "inactivo", "agotado", "vendido"].includes(estado)) {
        continue;
      }
    }

    // Igual con el stock: vacío no esconde nada, solo un 0 de verdad. Se
    // limpian puntos y comas por si viene escrito como "1.000".
    if (indices.stock !== -1) {
      const bruto = String(fila[indices.stock] || "").trim();
      const numero = Number(bruto.replace(/[.,\s]/g, ""));
      if (bruto && Number.isFinite(numero) && numero === 0) continue;
    }

    const precioPrincipal = indices.precio === -1 ? "" : String(fila[indices.precio] || "").trim();
    const precioLocal =
      indices.precioLocal === -1 ? "" : String(fila[indices.precioLocal] || "").trim();

    productos.push({
      titulo,
      // El precio "en divisas": si hay una segunda moneda en la hoja, las
      // dos se muestran juntas. En la ficha sale solo cuando el cliente
      // pregunta por divisas o por Cashea (ver precioParaMostrar en
      // manychat.js); por defecto se ve el de Cashea.
      precio: combinarPrecio(precioPrincipal, precioLocal),
      // El de Cashea es el que se ve POR DEFECTO en la ficha. Si un equipo
      // no lo tiene cargado, la ficha usa el precio en divisas.
      precioCashea:
        indices.precioCashea === -1 ? "" : String(fila[indices.precioCashea] || "").trim(),
      imagen: enlaceDeImagen(indices.imagen === -1 ? "" : fila[indices.imagen]),
      url:
        (indices.enlace === -1 ? "" : String(fila[indices.enlace] || "").trim()) ||
        env.URL_CATALOGO ||
        "",
      busqueda: indiceDeBusqueda(titulo),
    });
  }

  console.log(
    `Hoja → ${productos.length} productos visibles; ` +
      `columna de nombre: ${columnas.titulo}, precio: ${columnas.precio}`
  );

  return { productos, encabezados, filasLeidas: filas.length, columnas };
}

// Devuelve en qué posición está cada columna dentro de una fila, o -1.
function ubicarColumnas(fila) {
  const celdas = (fila || []).map(normalizar);

  const buscar = (clave) => {
    const nombres = SINONIMOS[clave].map(normalizar);
    // Primero el nombre exacto; si no, uno que empiece igual, para aguantar
    // encabezados como "precio usd" o "cantidad disponible".
    const exacta = celdas.findIndex((c) => c && nombres.includes(c));
    if (exacta !== -1) return exacta;
    return celdas.findIndex((c) => c && nombres.some((n) => c.startsWith(n)));
  };

  return {
    titulo: buscar("titulo"),
    precio: buscar("precio"),
    precioLocal: buscar("precioLocal"),
    precioCashea: buscar("precioCashea"),
    imagen: buscar("imagen"),
    enlace: buscar("enlace"),
    activo: buscar("activo"),
    stock: buscar("stock"),
  };
}

// El precio en divisas: si la hoja trae una segunda moneda, se muestran las
// dos juntas, separadas por " · ". No se les añade ningún símbolo: lo que
// escribas en la celda —"$150", "150 USD", "Bs 5.400"— sale tal cual.
function combinarPrecio(principal, local) {
  if (principal && local) return `${principal} · ${local}`;
  return principal || local || "";
}

// La columna "imagen" con fotos de Google Drive.
//
// Lo que se pega ahí es el enlace de "Compartir" tal cual lo da Drive, del
// tipo:
//   https://drive.google.com/file/d/1AbCdEfGhIJKlmNoPQrs/view?usp=sharing
//
// Eso es una PÁGINA de Drive, no la imagen: puesta directo en una ficha
// del bot, sale rota. Aquí se reconoce el id del archivo y se arma la URL
// que sí sirve la imagen en bruto.
//
// OJO — dos cosas que hay que saber usando Drive para esto:
//   1. El archivo tiene que estar compartido como "Cualquier persona con
//      el enlace" (Lector), igual que la hoja. Si no, la foto no carga.
//   2. Drive no está pensado para ser un servidor de imágenes: si una
//      misma foto se pide muchísimas veces en poco tiempo, Drive puede
//      bloquearla unas horas. Para un catálogo normal no debería notarse,
//      pero si un día ves fotos rotas sin motivo, puede ser eso.
const PATRONES_DRIVE = [
  /drive\.google\.com\/file\/d\/([\w-]{20,})/, // .../file/d/ID/view
  /drive\.google\.com\/open\?id=([\w-]{20,})/, // .../open?id=ID
  /drive\.google\.com\/uc\?.*[?&]id=([\w-]{20,})/, // .../uc?export=view&id=ID
  /[?&]id=([\w-]{20,})/, // cualquier otro enlace de Drive con ?id=
];

function enlaceDeImagen(valor) {
  const texto = String(valor || "").trim();
  if (!texto) return "";

  for (const patron of PATRONES_DRIVE) {
    const encontrado = texto.match(patron);
    if (encontrado) {
      // Formato que Google sirve como imagen en bruto, no como página.
      // "=w1000" limita el ancho a 1000px: de sobra para una ficha de
      // producto, y bastante más rápido que la foto original sin recortar.
      return `https://lh3.googleusercontent.com/d/${encontrado[1]}=w1000`;
    }
  }

  // No es un enlace de Drive: se deja tal cual (una URL normal de imagen).
  return texto;
}

// CSV con comillas: un campo entre comillas puede llevar comas, saltos de
// línea y comillas dobladas ("") que valen por una sola.
function leerCsv(texto) {
  const filas = [];
  let fila = [];
  let campo = "";
  let entreComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];

    if (entreComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          entreComillas = false;
        }
      } else {
        campo += c;
      }
      continue;
    }

    if (c === '"') {
      entreComillas = true;
    } else if (c === ",") {
      fila.push(campo);
      campo = "";
    } else if (c === "\n") {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else if (c !== "\r") {
      campo += c;
    }
  }

  if (campo || fila.length) {
    fila.push(campo);
    filas.push(fila);
  }

  return filas;
}
