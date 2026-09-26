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
  // La capacidad del equipo, si tu hoja la tiene en su propia columna. Es
  // el dato que más se pregunta después del precio, y el que el modelo
  // más se tienta de inventar: un "Samsung A57" sin gigas en el título
  // hacía que contestara "128GB" de memoria suya (ver index.js). Con la
  // columna, deja de ser una suposición.
  capacidad: [
    "capacidad", "almacenamiento", "memoria", "gb", "rom", "storage",
    "capacidadgb", "memoriainterna", "espacio",
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
  const pedidas = palabrasDeBusqueda(termino).slice(0, 5);
  if (!pedidas.length) return { productos: [], hayMas: false };

  const { productos } = await leerHoja(env);
  if (!productos.length) return { productos: [], hayMas: false };

  // Cada palabra, con las otras formas de decirla ("xiaomi" vale por
  // "redmi" y por "poco"), y sin las que la hoja no conoce.
  const grupos = comoLasDiceLaHoja(pedidas, productos);
  const palabras = grupos.map((grupo) => grupo[0]);

  if (!grupos.length) return { productos: [], hayMas: false };

  // TODAS las palabras del término tienen que estar en el título. Es más
  // estricto, pero evita que pedir un modelo concreto devuelva media tienda.
  let encontrados = productos.filter((p) =>
    grupos.every((grupo) => grupo.some((palabra) => coincide(palabra, p.busqueda)))
  );

  // RESCATE 1 — LAS PALABRAS PEGADAS O PARTIDAS.
  //
  // Los espacios no caen donde el título los tiene, y va en las dos
  // direcciones:
  //
  //   PARTE lo que va junto   "power bank"  por  "Powerbank"
  //   PEGA lo que va aparte   "RedmiNote"   por  "Redmi Note"
  //
  // La primera versión de esto solo arreglaba la de arriba, y al probar
  // los 82 productos con erratas se vio que la de abajo es igual de
  // común: "Pocopro", "Tecnospark", "Redmipro".
  //
  // Se compara el término SIN ESPACIOS contra trozos del título también
  // sin espacios: cada palabra, cada dos seguidas y cada tres seguidas.
  // Con eso "redminote" encuentra "Redmi Note 17" sin que "note17" deje
  // de encontrarse tampoco.
  //
  // Y perdona erratas, porque las dos cosas pasan a la vez: "powe bank",
  // "pawer bank", "RedmixNote". Cada mitad suelta es demasiado corta
  // para perdonarle nada; pegadas son una palabra larga que sí se puede
  // comparar.
  //
  // Solo se intenta cuando la búsqueda estricta vino vacía, así que no
  // afloja nada de lo que ya funciona.
  if (!encontrados.length) {
    const pegado = palabras.join("");
    const margen = erratasQueSePerdonan(pegado);

    encontrados = productos.filter(({ busqueda }) => {
      if (busqueda.junto.includes(pegado)) return true;
      if (margen && trozosPegados(busqueda.piezas).some((t) => seParecen(pegado, t, margen))) {
        return true;
      }
      // Y al revés: partir el pegado en dos y que cada mitad esté en el
      // título, aunque en el título no vayan seguidas. "Pocopro" es
      // "Poco X8 pro 5G" con un "X8" en medio, y "Aoraxcable" es "Aorax
      // M659 cable": pegar dos palabras que el título tiene separadas
      // por una tercera es de lo más normal cuando el cliente escribe de
      // memoria.
      return partirEnDos(pegado).some(
        ([izquierda, derecha]) => coincide(izquierda, busqueda) && coincide(derecha, busqueda)
      );
    });

    if (encontrados.length) {
      console.log(`Sin resultados con "${palabras.join(" ")}", pero sí pegado: "${pegado}"`);
    }
  }

  // RESCATE 2 — LA ERRATA.
  //
  // "powerbanck", "aurifonos", "cargadro". Se le perdona UNA letra por
  // palabra —cambiada, sobrante o que falta— en palabras de 5 letras o
  // más. En las cortas no: con 3 letras, perdonar una es perdonarlo todo
  // y "A17" acabaría encontrando "A07".
  //
  // Los números NO se tocan nunca, ni siquiera acá: un 512 no es un 128
  // por mucho que se escriban parecido, y mandarle el equipo equivocado
  // al cliente es peor que no encontrarlo.
  if (!encontrados.length) {
    encontrados = productos.filter((p) =>
      grupos.every((grupo) =>
        grupo.some((palabra) => coincide(palabra, p.busqueda) || casiCoincide(palabra, p.busqueda))
      )
    );
    if (encontrados.length) {
      console.log(`Sin resultados exactos con "${palabras.join(" ")}": lo tomo como errata`);
    }
  }

  return {
    productos: encontrados.slice(0, cuantos).map(({ busqueda, ...producto }) => producto),
    hayMas: encontrados.length > cuantos,
  };
}

/* ── LA MARCA QUE DICE EL CLIENTE NO ES LA QUE DICE LA HOJA ────────

   EL FALLO QUE ESTO ARREGLA (26-sep-2026). En la hoja los teléfonos de
   Xiaomi están como "Redmi Note 17" y "Poco X8 pro": la palabra "Xiaomi"
   no aparece en NINGÚN título. Así que:

     "xiaomi"        → NADA
     "xiaomi note"   → NADA

   El cliente pregunta por la marca con la que le vendieron el teléfono y
   el bot le dice que no tiene ninguno, con la tienda llena de Xiaomi.

   Son submarcas de la misma casa, y el cliente no tiene por qué saberlo.
   Aquí se dice una vez y vale para el chat, para los comentarios y para
   las listas.
   ───────────────────────────────────────────────────────────────── */
const OTRAS_FORMAS = new Map([
  ["xiaomi", ["xiaomi", "redmi", "poco"]],
  ["redmi", ["redmi", "xiaomi"]],
  ["poco", ["poco", "xiaomi"]],
  ["apple", ["apple", "iphone"]],
  ["iphone", ["iphone", "apple"]],
  ["samsung", ["samsung", "galaxy"]],
  ["galaxy", ["galaxy", "samsung"]],
]);

// Palabras que el cliente usa para decir "teléfono" y que no nombran
// ningún producto de la hoja. No se buscan, pero tampoco tumban la
// búsqueda: "celulares note" tiene que encontrar los Note igual.
function comoLasDiceLaHoja(pedidas, productos) {
  const grupos = [];

  for (const palabra of pedidas) {
    const formas = OTRAS_FORMAS.get(palabra) || [palabra];

    // "La hoja la conoce" incluye las erratas y las palabras metidas
    // dentro de otra ("dophin" dentro de "Skydolphing"): si no, una
    // palabra bien escrita de otra manera se daría por desconocida y se
    // tiraría, que es justo lo contrario de lo que hace falta.
    const sirve = formas.filter((forma) =>
      productos.some((p) => coincide(forma, p.busqueda) || casiCoincide(forma, p.busqueda))
    );

    if (sirve.length) {
      grupos.push(sirve);
      continue;
    }

    // NINGUNA FORMA DE ESA PALABRA ESTÁ EN LA HOJA.
    //
    // Si lleva números, se respeta y la búsqueda vuelve vacía: pedir un
    // "Note 20" que no existe TIENE que dar vacío, para que el bot diga
    // que ese no lo tiene en vez de enseñar los Note que sí hay como si
    // fueran el que pidió. Un número equivocado es el equipo equivocado.
    if (/\d/.test(palabra)) {
      grupos.push([palabra]);
      continue;
    }

    // Sin números es una palabra de relleno —"celulares", "telefonos",
    // "equipos", "marca"— o algo que esta tienda no maneja. Exigirla
    // dejaba la búsqueda en cero y al cliente sin respuesta.
    console.log(`"${palabra}" no está en ningún título de la hoja: no la exijo`);
  }

  return grupos;
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

// La misma comparación, perdonando erratas. Se usa solo cuando la
// búsqueda de verdad ya falló: es el último intento antes de decirle al
// cliente que no hay.
//
// CUÁNTAS SE PERDONAN, Y POR QUÉ NO SIEMPRE UNA:
//
//   menos de 4 letras  ·  ninguna. Con 3 letras, perdonar una es
//                         perdonarlo todo. Ahí se prefiere no encontrar.
//   de 4 a 7 letras    ·  una.  ("Remi" por Redmi, "Cale" por Cable)
//   8 o más            ·  dos.  Cuanto más larga la palabra, más sitios
//                         hay donde equivocarse y menos posibilidad de
//                         chocar con otro producto.
//
// El 4 salió midiendo, no a ojo: con 5 se perdían "Remi" y "Cale", que
// son erratas normales; con 4 se recuperan y los 12 pares que no pueden
// confundirse siguen sin confundirse. Con 3 ya no se probó: "A17" y
// "A07" están a una letra, y mandar el teléfono equivocado es peor que
// no encontrarlo.
//
// LO QUE HACE QUE ESTO SEA SEGURO no es el número, es DÓNDE corre: los
// rescates solo se intentan cuando la búsqueda estricta volvió VACÍA.
// Una búsqueda que ya encontró algo no se toca nunca, así que aflojar
// acá no puede ensuciar un resultado bueno — solo puede rescatar uno
// que iba a ser un "no hay".
//
// Los números NO se tocan nunca, en ninguna longitud: un 512 no es un
// 128 por mucho que se parezcan, y mandarle el equipo equivocado al
// cliente es peor que no encontrárselo.
function erratasQueSePerdonan(palabra) {
  if (palabra.length < 4 || /\d/.test(palabra)) return 0;
  return palabra.length >= 8 ? 2 : 1;
}

// Cada palabra del título, cada dos seguidas y cada tres seguidas, sin
// espacios. Para "Redmi Note 17 Pro": redmi, note, 17, pro, redminote,
// note17, 17pro, redminote17, note17pro.
//
// Hasta tres y no más: un término de búsqueda son 3 palabras como mucho
// (lo dice el prompt), así que pasar de ahí es trabajo que no se usa, en
// cada producto y en cada mensaje.
function trozosPegados(piezas) {
  const trozos = [];
  for (let i = 0; i < piezas.length; i++) {
    let junto = "";
    for (let n = 0; n < 3 && i + n < piezas.length; n++) {
      junto += piezas[i + n];
      trozos.push(junto);
    }
  }
  return trozos;
}

// Todas las formas de cortar una palabra en dos trozos de 3 letras o
// más. "pocopro" da poc/opro, poco/pro, pocop/ro... y solo "poco"+"pro"
// encuentra las dos en el título.
//
// Se corta a 3 letras porque por debajo de eso cualquier trozo está en
// cualquier sitio, y esto acabaría devolviendo media tienda.
function partirEnDos(palabra) {
  const cortes = [];
  for (let i = 3; i <= palabra.length - 3; i++) {
    cortes.push([palabra.slice(0, i), palabra.slice(i)]);
  }
  return cortes;
}

function casiCoincide(palabra, { piezas }) {
  const margen = erratasQueSePerdonan(palabra);
  if (!margen) return false;
  return piezas.some(
    (pieza) =>
      (pieza.length >= 4 && seParecen(palabra, pieza, margen)) ||
      casiDentro(palabra, pieza, margen)
  );
}

// LA PALABRA VA DENTRO DE OTRA MÁS LARGA (24-sep-2026).
//
// EL CASO REAL. El cliente escribió "precio de los cables dophin" y no
// encontró nada, teniendo seis en la tienda: en la hoja se llaman
// "Skydolphing". Ni el prefijo servía —"skydolphing" no empieza por
// "dophin"— ni el parecido entre palabras enteras, que son de 6 y 11
// letras.
//
// Pero "dolphin" SÍ está dentro de "skydolphing", y lo que el cliente
// escribió se parece a eso con una letra de diferencia. Así que se compara
// contra los TROZOS de la palabra larga, del tamaño del término, con el
// mismo margen de erratas de siempre.
//
// Solo con palabras de 5 letras o más: con menos, cualquier cosa está
// dentro de cualquier cosa y la búsqueda devolvería media tienda.
const MINIMO_PARA_BUSCAR_DENTRO = 5;

function casiDentro(palabra, pieza, margen) {
  if (palabra.length < MINIMO_PARA_BUSCAR_DENTRO) return false;
  if (pieza.length <= palabra.length) return false;

  for (let largo = palabra.length - margen; largo <= palabra.length + margen; largo++) {
    if (largo < MINIMO_PARA_BUSCAR_DENTRO) continue;
    for (let desde = 0; desde + largo <= pieza.length; desde++) {
      if (seParecen(palabra, pieza.slice(desde, desde + largo), margen)) return true;
    }
  }

  return false;
}

// ¿Se llega de "a" a "b" con "margen" deslices o menos? Cuenta como uno:
// una letra cambiada, una de más, una que falta, o DOS LETRAS CAMBIADAS
// DE SITIO ("cargadro" por "cargador"), que es de las erratas más
// comunes que hay: dedos que llegan en el orden equivocado.
//
// Se compara contra el PRINCIPIO de la palabra del título, para que
// "powerbanck" encuentre "powerbank 10.000 mah".
//
// Es la distancia de siempre, con dos cambios: se corta en cuanto se
// pasa del margen, y no hay tabla entera, solo dos filas. Acá se compara
// una palabra contra 83 productos en cada mensaje, con un cliente
// esperando.
function seParecen(a, b, margen) {
  if (b.length > a.length + margen) b = b.slice(0, a.length + margen);
  if (Math.abs(a.length - b.length) > margen) return false;

  let anterior = [];
  let fila = Array.from({ length: b.length + 1 }, (_, j) => j);

  for (let i = 1; i <= a.length; i++) {
    const previa = fila;
    fila = [i];
    let mejor = i;

    for (let j = 1; j <= b.length; j++) {
      const cuesta = a[i - 1] === b[j - 1] ? 0 : 1;
      let valor = Math.min(
        previa[j] + 1,          // sobra una letra en "a"
        fila[j - 1] + 1,        // falta una letra en "a"
        previa[j - 1] + cuesta  // letra cambiada
      );

      // Dos letras cambiadas de sitio: cuesta uno, no dos.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        valor = Math.min(valor, anterior[j - 2] + 1);
      }

      fila[j] = valor;
      if (valor < mejor) mejor = valor;
    }

    // Toda la fila se pasó del margen: no hay forma de arreglarlo más
    // abajo, y seguir es gastar tiempo del cliente.
    if (mejor > margen) return false;
    anterior = previa;
  }

  return fila[b.length] <= margen;
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

// LA BÚSQUEDA MIRA TODA LA FILA, NO SOLO EL TÍTULO.
//
// "Samsung A57 128GB" no encontraba nada cuando el título era "Samsung
// A57" y los gigas vivían en su propia columna: la búsqueda solo leía el
// título. Ahora el índice se arma con el título Y con las columnas que
// describen el equipo.
//
// Los PRECIOS quedan fuera a propósito. Un precio de "$128.00" haría que
// buscar "128GB" pescara equipos que no tienen nada que ver, y el cliente
// vería una lista sin sentido. Las imágenes y los enlaces tampoco entran:
// son direcciones web, no palabras que alguien escriba en un chat.
function indiceDeBusqueda(titulo, fila, encabezados, indices) {
  const fuera = new Set(
    ["precio", "precioLocal", "precioCashea", "imagen", "enlace", "activo", "stock"]
      .map((clave) => indices[clave])
      .filter((i) => i !== undefined && i !== -1)
  );

  const textos = [titulo];

  for (let i = 0; i < (fila || []).length; i++) {
    if (i === indices.titulo || fuera.has(i)) continue;
    const valor = String(fila[i] ?? "").trim();
    if (valor) textos.push(valor);
  }

  const piezas = palabrasDeBusqueda(textos.join(" "));
  return { piezas, junto: piezas.join("") };
}

// Las columnas que no son ninguna de las conocidas, con su nombre tal
// como está escrito en la hoja. Es lo que permite que el bot hable de lo
// que TÚ cargaste sin que nadie tenga que tocar el código.
function otrasColumnas(fila, encabezados, indices) {
  const conocidas = new Set(Object.values(indices).filter((i) => i !== -1));
  const extras = {};

  for (let i = 0; i < (fila || []).length; i++) {
    if (conocidas.has(i)) continue;

    const nombre = String((encabezados || [])[i] ?? "").trim();
    const valor = String(fila[i] ?? "").trim();
    if (!nombre || !valor) continue;

    extras[nombre] = valor;
  }

  return extras;
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

// TODO el catálogo, sin buscar nada.
//
// Lo usa "muéstrame esos" (ver recomendados.js): para reconocer qué
// modelos nombró el bot en su último mensaje hay que tener delante la
// lista de los que existen. La hoja viene cacheada, así que esto no
// dispara una descarga nueva en cada mensaje.
export async function catalogoCompleto(env) {
  const { productos } = await leerHoja(env);
  return productos || [];
}

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
    // Con la capacidad pegada al título, el modelo la ve al elegir el
    // término de búsqueda y no tiene que suponerla.
    const linea = p.capacidad ? `${p.titulo} — ${p.capacidad}` : p.titulo;
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
    `  capacidad           -> ${columnas.capacidad}`,
    `  imagen              -> ${columnas.imagen}`,
    `  enlace              -> ${columnas.enlace}`,
    `  activo/estado       -> ${columnas.activo}`,
    `  stock/cantidad      -> ${columnas.stock}`,
    "",
    `Productos visibles para el cliente: ${productos.length}`,
    "",
    // Lo que no encaja en ninguna columna conocida ya no se tira: entra en
    // la búsqueda y queda guardado. Verlo aquí evita la sorpresa de
    // "¿por qué encuentra por marca si la marca no está en el título?".
    ...columnasExtra(productos),
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
    capacidad: nombreDe(indices.capacidad),
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
      capacidad: indices.capacidad === -1 ? "" : String(fila[indices.capacidad] || "").trim(),
      imagen: enlaceDeImagen(indices.imagen === -1 ? "" : fila[indices.imagen]),
      url:
        (indices.enlace === -1 ? "" : String(fila[indices.enlace] || "").trim()) ||
        env.URL_CATALOGO ||
        "",
      // TODO LO DEMÁS DE LA FILA, sin descartar nada.
      //
      // Antes esto se quedaba con ocho columnas conocidas y tiraba el
      // resto. Si la hoja traía RAM, cámara, estado del equipo o
      // cualquier otra cosa, el bot no se enteraba — y el modelo
      // terminaba respondiendo esas preguntas de memoria propia, que es
      // de donde salió el "128GB" inventado de un A57.
      //
      // Ahora se guardan tal cual vienen, con el nombre que les pusiste
      // en la hoja. Así el bot puede decir lo que TU catálogo dice, y no
      // lo que el modelo cree saber de ese teléfono.
      extras: otrasColumnas(fila, encabezados, indices),
      busqueda: indiceDeBusqueda(titulo, fila, encabezados, indices),
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
    capacidad: buscar("capacidad"),
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

// Los encabezados que no son ninguna de las columnas conocidas. No se
// descartan: entran en el índice de búsqueda y se guardan con el producto
// (ver otrasColumnas), así que el cliente puede buscar por ellos.
function columnasExtra(productos) {
  const nombres = new Set();
  for (const producto of productos) {
    for (const nombre of Object.keys(producto.extras || {})) nombres.add(nombre);
  }

  if (!nombres.size) return [];

  return [
    "Otras columnas de tu hoja (se buscan igual, aunque el bot no las",
    "muestre en la ficha):",
    `  ${[...nombres].join(" | ")}`,
  ];
}
