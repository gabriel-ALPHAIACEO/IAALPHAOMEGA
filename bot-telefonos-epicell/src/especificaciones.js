// LAS ESPECIFICACIONES DE CADA TELÉFONO, EN LA BASE (6-oct-2026).
//
// El dueño: "Lo técnico no pasa a un asesor, la IA lo dice pero con
// información: vamos a colocarle en la base de datos toda la información".
//
// Hasta hoy la IA no sabía nada técnico: a "¿cuál es mejor, el 15 o el
// 17?" se inventó que el 17 tenía "un procesador más potente". Ahora:
//
//   · Cada teléfono tiene su fila en la tabla `especificaciones` de D1:
//     pantalla, procesador, memoria, cámara, frontal, batería, carga,
//     sistema, extras y la PÁGINA OFICIAL de la marca.
//   · En cada mensaje, la IA recibe la ficha técnica de los equipos de los
//     que se habla (los que vio, el del anuncio, los que nombra) y contesta
//     y compara CON ESOS DATOS. Lo que no esté ahí no lo inventa.
//   · Si pide "todas las especificaciones" / "la ficha técnica", se le
//     manda un botón a la página oficial (si está puesta).
//
// DE DÓNDE SALEN LOS DATOS: abajo, en SEMILLA, sacados el 6-oct-2026 de
// GSMArena y de las páginas de cada marca. Al arrancar se meten en la base
// SOLO los modelos que no estén (INSERT OR IGNORE): lo que el dueño edite
// en ALPHA IA › la tienda › Bases de datos › especificaciones NO se pisa.
// Un teléfono nuevo se añade ahí mismo (o se agrega aquí a la SEMILLA).
//
// La columna `modelo` es el nombre EXACTO de la hoja ("Samsung A57").

const CREAR = `
  CREATE TABLE IF NOT EXISTS especificaciones (
    modelo       TEXT PRIMARY KEY,
    pantalla     TEXT NOT NULL DEFAULT '',
    procesador   TEXT NOT NULL DEFAULT '',
    memoria      TEXT NOT NULL DEFAULT '',
    camara       TEXT NOT NULL DEFAULT '',
    frontal      TEXT NOT NULL DEFAULT '',
    bateria      TEXT NOT NULL DEFAULT '',
    carga        TEXT NOT NULL DEFAULT '',
    sistema      TEXT NOT NULL DEFAULT '',
    extras       TEXT NOT NULL DEFAULT '',
    pagina       TEXT NOT NULL DEFAULT '',
    fuente       TEXT NOT NULL DEFAULT ''
  )`;

const CAMPOS = ["pantalla", "procesador", "memoria", "camara", "frontal", "bateria", "carga", "sistema", "extras", "pagina", "fuente"];

// Cómo se nombra cada dato al pasárselo a la IA.
const ETIQUETAS = {
  pantalla: "Pantalla",
  procesador: "Procesador",
  memoria: "RAM / almacenamiento",
  camara: "Cámara trasera",
  frontal: "Cámara frontal",
  bateria: "Batería",
  carga: "Carga",
  sistema: "Sistema",
  extras: "Otros",
};

export const SEMILLA = [
  // ── Xiaomi / Redmi / Poco ──
  {
    modelo: "Redmi A7 pro",
    pantalla: '6,88" IPS LCD, 120 Hz, HD+ (720x1640)',
    procesador: "Unisoc T7250 (8 núcleos)",
    memoria: "4 o 6 GB RAM · 64 o 128 GB, ampliable con microSD",
    camara: "50 MP",
    frontal: "8 MP",
    bateria: "6000 mAh",
    carga: "15 W",
    sistema: "Android 15",
    extras: "4G",
    pagina: "https://www.mi.com/my/product/redmi-a7-pro/specs",
    fuente: "GSMArena / mi.com, 6-oct-2026",
  },
  {
    modelo: "Redmi 15c",
    pantalla: '6,9" IPS LCD, 120 Hz, HD+ (720x1600)',
    procesador: "MediaTek Helio G81 Ultra (versión 4G)",
    memoria: "4, 6 u 8 GB RAM · 128 o 256 GB, ampliable con microSD",
    camara: "50 MP",
    frontal: "8 MP",
    bateria: "6000 mAh",
    carga: "33 W",
    sistema: "Android 15 (HyperOS 2)",
    extras: "4G · IP64 (resiste polvo y salpicaduras)",
    pagina: "",
    fuente: "GSMArena, 6-oct-2026 (si es la versión 5G: Dimensity 6300)",
  },
  {
    modelo: "Redmi 15",
    pantalla: '6,9" IPS LCD, 144 Hz, Full HD+ (1080x2340)',
    procesador: "Qualcomm Snapdragon 685 (versión 4G)",
    memoria: "4, 6 u 8 GB RAM · 128 o 256 GB",
    camara: "50 MP",
    frontal: "8 MP",
    bateria: "7000 mAh",
    carga: "33 W",
    sistema: "Android 15 (HyperOS 2)",
    extras: "4G · NFC · IP64",
    pagina: "",
    fuente: "GSMArena, 6-oct-2026",
  },
  {
    modelo: "Redmi 17",
    pantalla: '6,9" IPS LCD, 120 Hz, HD+ · Gorilla Glass 7i',
    procesador: "MediaTek Helio G91 Ultra (versión 4G)",
    memoria: "4 o 6 GB RAM · 128 o 256 GB, ampliable",
    camara: "50 MP",
    frontal: "8 MP",
    bateria: "7500 mAh",
    carga: "45 W (y carga inversa 22,5 W)",
    sistema: "Android 16 (HyperOS 3)",
    extras: "4G · IP64 · luz de notificación RGB · conector de audífonos",
    pagina: "https://www.mi.com/ng/product/redmi-17/specs/",
    fuente: "unbox.ph / 91mobiles, 6-oct-2026",
  },
  {
    modelo: "Redmi Note 17",
    pantalla: '6,99" AMOLED, 120 Hz, Full HD+ (2396x1080), 1800 nits · Gorilla Glass 7i',
    procesador: "Qualcomm Snapdragon 6s 4G Gen 2",
    memoria: "4, 6 u 8 GB RAM · 128 o 256 GB",
    camara: "50 MP (f/1.8)",
    frontal: "16 MP",
    bateria: "7700 mAh",
    carga: "45 W",
    sistema: "Android 16 (HyperOS 3)",
    extras: "4G · IP65",
    pagina: "https://www.mi.com/my/product/redmi-note-17/specs/",
    fuente: "technave / smartprix, 6-oct-2026",
  },
  {
    modelo: "Redmi Note 17 Pro 5G",
    pantalla: '6,83" AMOLED 1.5K (1280x2772), 120 Hz, 3500 nits · Gorilla Glass Victus 2',
    procesador: "Qualcomm Snapdragon 6s Gen 4 (4 nm)",
    memoria: "8 GB RAM · 128 o 256 GB",
    camara: "50 MP + 8 MP gran angular",
    frontal: "16 MP",
    bateria: "9000 mAh (silicio-carbono)",
    carga: "67 W",
    sistema: "Android 16 (HyperOS)",
    extras: "5G · resistente al agua y al polvo",
    pagina: "",
    fuente: "91mobiles, 6-oct-2026",
  },
  {
    modelo: "Redmi Note 17 Pro Max 5G",
    pantalla: '6,83" AMOLED 1.5K (1280x2772), 120 Hz, 3500 nits, HDR10+ · Gorilla Glass Victus 2',
    procesador: "Qualcomm Snapdragon 6 Gen 5",
    memoria: "Hasta 12 GB RAM (LPDDR5x) · hasta 512 GB (UFS 4.1)",
    camara: "50 MP + 8 MP gran angular",
    frontal: "32 MP",
    bateria: "10000 mAh (silicio-carbono)",
    carga: "100 W HyperCharge",
    sistema: "Android 16 (HyperOS 3)",
    extras: "5G · IP66/IP68/IP69/IP69K (agua y polvo)",
    pagina: "https://www.mi.com/my/product/redmi-note-17-pro-max-5g/specs/",
    fuente: "mi.com / 91mobiles, 6-oct-2026",
  },
  {
    modelo: "Redmi Note 15 Pro 5G",
    pantalla: '6,83" AMOLED 1.5K (1280x2772), 120 Hz, 3200 nits, HDR10+ y Dolby Vision · Gorilla Glass Victus 2',
    procesador: "MediaTek Dimensity 7400 Ultra (4 nm)",
    memoria: "8 o 12 GB RAM",
    camara: "200 MP",
    frontal: "",
    bateria: "6580 mAh (silicio-carbono)",
    carga: "45 W",
    sistema: "Android (HyperOS)",
    extras: "5G · IP68/IP69K",
    pagina: "",
    fuente: "GSMArena (versión global), 6-oct-2026",
  },
  {
    modelo: "Redmi Note 15 pro + 5G",
    pantalla: '6,83" AMOLED 1.5K (1280x2772), 120 Hz, 3200 nits, HDR10+ y Dolby Vision · Gorilla Glass Victus 2',
    procesador: "Qualcomm Snapdragon 7s Gen 4 (4 nm)",
    memoria: "8 o 12 GB RAM · 256 o 512 GB",
    camara: "200 MP con estabilizador (OIS) + 8 MP gran angular",
    frontal: "",
    bateria: "6500 mAh",
    carga: "100 W",
    sistema: "Android 15 (HyperOS 2)",
    extras: "5G · IP68/IP69K",
    pagina: "",
    fuente: "GSMArena (versión global), 6-oct-2026",
  },
  {
    modelo: "Poco X8 pro 5G",
    pantalla: '6,59" AMOLED (1268x2756), 120 Hz, 3500 nits, Dolby Vision y HDR10+',
    procesador: "MediaTek Dimensity 8500 Ultra",
    memoria: "12 o 16 GB RAM",
    camara: "50 MP (Sony IMX882) + 8 MP gran angular",
    frontal: "20 MP",
    bateria: "6500 mAh",
    carga: "100 W",
    sistema: "Android 16 (HyperOS 3)",
    extras: "5G · IP69K · NFC · infrarrojo · huella en pantalla · marco de aluminio",
    pagina: "",
    fuente: "GSMArena, 6-oct-2026",
  },
  {
    modelo: "Poco M8 pro 5G",
    pantalla: '6,83" AMOLED 1.5K, 120 Hz, 3200 nits, Dolby Vision y HDR10+ · Gorilla Glass Victus 2',
    procesador: "Qualcomm Snapdragon 7s Gen 4",
    memoria: "8 o 12 GB RAM",
    camara: "50 MP con estabilizador (OIS) + 8 MP gran angular",
    frontal: "32 MP",
    bateria: "6500 mAh (silicio-carbono)",
    carga: "100 W",
    sistema: "Android 15 (HyperOS 2)",
    extras: "5G · Wi-Fi 6E",
    pagina: "",
    fuente: "GSMArena, 6-oct-2026",
  },
  {
    modelo: "Poco C81 pro",
    pantalla: '6,9" LCD, 120 Hz, HD+ (720x1600)',
    procesador: "Unisoc T7250 (8 núcleos)",
    memoria: "4 GB RAM · 64, 128 o 256 GB, ampliable con microSD",
    camara: "13 MP",
    frontal: "8 MP",
    bateria: "6000 mAh",
    carga: "15 W",
    sistema: "Android 15 (HyperOS)",
    extras: "4G · NFC · conector de audífonos · huella lateral",
    pagina: "",
    fuente: "91mobiles, 6-oct-2026",
  },
  {
    modelo: "Xiaomi Tablet Redmi Pad 2",
    pantalla: '11" LCD 2.5K (2560x1600), 90 Hz',
    procesador: "MediaTek Helio G100 Ultra",
    memoria: "4, 6 u 8 GB RAM · 128 o 256 GB, ampliable con microSD",
    camara: "8 MP",
    frontal: "5 MP",
    bateria: "9000 mAh",
    carga: "18 W",
    sistema: "Android 15 (HyperOS 2)",
    extras: "4 bocinas Dolby Atmos · conector de audífonos · admite lápiz",
    pagina: "https://www.mi.com/global/redmi-pad-2/specs",
    fuente: "GSMArena / mi.com, 6-oct-2026",
  },
  // ── Tecno ──
  {
    modelo: "Tecno Camon 50 Ultra",
    pantalla: '6,78" AMOLED (1208x2644), 144 Hz',
    procesador: "MediaTek Dimensity 7400 Ultimate (4 nm)",
    memoria: "8 GB RAM · 256 GB",
    camara: "50 MP + 50 MP teleobjetivo + 8 MP gran angular",
    frontal: "50 MP",
    bateria: "6500 mAh",
    carga: "45 W",
    sistema: "Android 16 (HiOS)",
    extras: "5G · IP68/IP69K",
    pagina: "",
    fuente: "GSMArena / 91mobiles, 6-oct-2026",
  },
  {
    modelo: "Tecno spark 50",
    pantalla: '6,78" IPS LCD, 120 Hz, HD+',
    procesador: "MediaTek Dimensity 6400 (6 nm)",
    memoria: "Hasta 6 GB RAM · 128 GB, ampliable con microSD",
    camara: "50 MP",
    frontal: "8 MP",
    bateria: "6500 mAh",
    carga: "45 W",
    sistema: "Android 16 (HiOS 16)",
    extras: "5G · IP64 · resistencia militar MIL-STD-810H · conector de audífonos",
    pagina: "",
    fuente: "GSMArena, 6-oct-2026",
  },
  {
    modelo: "Tecno spark go 3",
    pantalla: '6,74" LCD, 120 Hz, HD+',
    procesador: "Unisoc T7250 (8 núcleos)",
    memoria: "4 GB RAM · 64 GB, ampliable con microSD",
    camara: "13 MP",
    frontal: "8 MP",
    bateria: "5000 mAh",
    carga: "15 W",
    sistema: "Android 15",
    extras: "4G · IP64",
    pagina: "",
    fuente: "GSMArena, 6-oct-2026",
  },
  // ── Samsung ──
  {
    modelo: "Samsung A57",
    pantalla: '6,7" Super AMOLED+, 120 Hz, Full HD+, 1900 nits, HDR10+ · Gorilla Glass Victus+',
    procesador: "Samsung Exynos 1680 (4 nm)",
    memoria: "8 o 12 GB RAM · 128 o 256 GB",
    camara: "50 MP + 12 MP gran angular + 5 MP macro",
    frontal: "12 MP",
    bateria: "5000 mAh",
    carga: "45 W",
    sistema: "Android 16 (One UI)",
    extras: "5G · IP68 · marco de aluminio · NFC · 6,9 mm de grosor",
    pagina: "",
    fuente: "GSMArena, 6-oct-2026",
  },
  {
    modelo: "Samsung A37",
    pantalla: '6,7" Super AMOLED, 120 Hz, Full HD+, 1900 nits',
    procesador: "Samsung Exynos 1480 (4 nm)",
    memoria: "6, 8 o 12 GB RAM · 128 o 256 GB",
    camara: "50 MP con estabilizador (OIS) + 8 MP gran angular + 5 MP macro",
    frontal: "12 MP",
    bateria: "5000 mAh",
    carga: "45 W",
    sistema: "Android 16 (One UI)",
    extras: "5G · IP68",
    pagina: "",
    fuente: "GSMArena, 6-oct-2026",
  },
  {
    modelo: "Samsung A27",
    pantalla: '6,7" Super AMOLED, 120 Hz, Full HD+ · Gorilla Glass Victus+',
    procesador: "Qualcomm Snapdragon 6 Gen 3 (4 nm)",
    memoria: "6 u 8 GB RAM · 128 o 256 GB, ampliable con microSD",
    camara: "50 MP con estabilizador (OIS) + 5 MP gran angular + 2 MP macro",
    frontal: "12 MP",
    bateria: "5000 mAh",
    carga: "25 W",
    sistema: "Android 16 (One UI 8.5), hasta 6 actualizaciones",
    extras: "5G · IP64",
    pagina: "",
    fuente: "GSMArena, 6-oct-2026",
  },
  {
    modelo: "Samsung A17",
    pantalla: '6,7" Super AMOLED, 90 Hz, Full HD+ · Gorilla Glass Victus+',
    procesador: "MediaTek Helio G99 (versión 4G)",
    memoria: "4, 6 u 8 GB RAM · 128 o 256 GB",
    camara: "50 MP con estabilizador (OIS) + 5 MP gran angular + 2 MP macro",
    frontal: "13 MP",
    bateria: "5000 mAh",
    carga: "25 W",
    sistema: "Android 15 (One UI 7), 6 años de actualizaciones",
    extras: "4G · IP54",
    pagina: "",
    fuente: "GSMArena, 6-oct-2026",
  },
  {
    modelo: "Samsung A07",
    pantalla: '6,7" LCD, 90 Hz, HD+ (720x1600)',
    procesador: "MediaTek Helio G99 (versión 4G)",
    memoria: "4 a 8 GB RAM · 64, 128 o 256 GB, ampliable con microSD",
    camara: "50 MP",
    frontal: "",
    bateria: "5000 mAh",
    carga: "25 W",
    sistema: "Android 15 (One UI), hasta 6 actualizaciones",
    extras: "4G · IP54",
    pagina: "",
    fuente: "GSMArena, 6-oct-2026",
  },
  // ── Infinix ──
  {
    modelo: "Infinix Note 60 Pro",
    pantalla: '6,78" AMOLED (1208x2644), 144 Hz, 4500 nits · Gorilla Glass 7i',
    procesador: "Qualcomm Snapdragon 7s Gen 4",
    memoria: "Hasta 12 GB RAM · hasta 256 GB",
    camara: "50 MP con estabilizador (OIS) + 8 MP gran angular",
    frontal: "13 MP",
    bateria: "6500 mAh",
    carga: "90 W con cable y 30 W inalámbrica",
    sistema: "Android 16 (XOS 16)",
    extras: "5G · IP64 · cuerpo de aluminio · eSIM",
    pagina: "",
    fuente: "GSMArena, 6-oct-2026",
  },
  {
    modelo: "Infinix Hot 70",
    pantalla: '6,78" IPS LCD, 120 Hz, HD+',
    procesador: "MediaTek Helio G100 Ultimate (6 nm)",
    memoria: "",
    camara: "50 MP",
    frontal: "8 MP",
    bateria: "6000 mAh",
    carga: "45 W",
    sistema: "Android 16 (XOS 16)",
    extras: "4G · IP65 · NFC",
    pagina: "",
    fuente: "GSMArena, 6-oct-2026",
  },
  // ── Honor ──
  {
    modelo: "Honor play 10",
    pantalla: '6,74" LCD, HD+ (720x1600)',
    procesador: "MediaTek Helio G81 (versión 4G)",
    memoria: "3 GB + 64 GB o 4 GB + 128 GB, ampliable con microSD",
    camara: "13 MP",
    frontal: "5 MP",
    bateria: "5000 mAh",
    carga: "10 W",
    sistema: "Android 15 (Go)",
    extras: "4G · conector de audífonos · huella lateral",
    pagina: "",
    fuente: "GSMArena, 6-oct-2026",
  },
];

// ── La tabla ─────────────────────────────────────────────────────────
let lista = false;
async function asegurar(db) {
  if (lista || !db) return;
  await db.prepare(CREAR).run();
  // Solo los que faltan: lo que el dueño editó en el panel se queda.
  const sentencia = db.prepare(
    `INSERT OR IGNORE INTO especificaciones (modelo, ${CAMPOS.join(", ")}) VALUES (?, ${CAMPOS.map(() => "?").join(", ")})`
  );
  const filas = SEMILLA.map((f) => sentencia.bind(f.modelo, ...CAMPOS.map((c) => f[c] || "")));
  if (typeof db.batch === "function") await db.batch(filas);
  else for (const f of filas) await f.run();
  lista = true;
}

let cache = null;
const CACHE_MS = 5 * 60 * 1000;

export async function todasLasEspecificaciones(db) {
  if (!db) return [];
  if (cache && cache.vence > Date.now()) return cache.filas;
  try {
    await asegurar(db);
    const { results } = await db.prepare(`SELECT modelo, ${CAMPOS.join(", ")} FROM especificaciones`).all();
    cache = { filas: results || [], vence: Date.now() + CACHE_MS };
    return cache.filas;
  } catch (error) {
    console.error("ESPECIFICACIONES: no pude leer la tabla:", error?.message || error);
    return [];
  }
}

// ── Qué fila es la de un equipo ──────────────────────────────────────
// "Redmi Note 17 Pro Max 5G 12/512" y "Redmi Note 17 Pro Max 5G" son el
// mismo teléfono; "Redmi Note 17" y "Redmi Note 17 Pro 5G" NO.
export function clave(titulo) {
  return String(titulo || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b\d+\s*\/\s*\d+\b/g, " ")
    .replace(/\b\d+\s*(?:gb|tb)\b/g, " ")
    .replace(/[^a-z0-9+]+/g, " ")
    .replace(/\b(?:xiaomi|tablet|celular|telefono)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function fichaDe(titulo, filas) {
  const k = clave(titulo);
  if (!k) return null;
  return filas.find((f) => clave(f.modelo) === k) || null;
}

// Las fichas técnicas de los equipos de los que se habla, sin repetir.
//   titulos: los del carrusel, el anuncio, lo que vio, lo que nombró
//   texto:   lo que escribió (para "¿el 15 o el 17?": números sueltos de la
//            misma marca que lo que está viendo)
export function fichasDeLaCharla(filas, { titulos = [], texto = "" } = {}, maximo = 4) {
  const elegidas = [];
  const agregar = (f) => {
    if (f && !elegidas.includes(f) && elegidas.length < maximo) elegidas.push(f);
  };
  for (const t of titulos) agregar(fichaDe(t, filas));

  // Números sueltos: "el 15 o el 17". Se buscan en la marca/familia de lo
  // que está viendo ("Redmi Note"), y si no, en la marca ("Redmi").
  const numeros = [...String(texto || "").matchAll(/\b(\d{2,3})\b/g)].map((m) => m[1]);
  if (numeros.length) {
    const familias = titulos.map((t) => clave(t).split(" ").slice(0, 2).join(" ")).filter(Boolean);
    const marcas = titulos.map((t) => clave(t).split(" ")[0]).filter(Boolean);
    for (const n of numeros) {
      // Si ese número ya es el del equipo que nombró ("el Note 17 Pro Max"),
      // no se traen los otros 17: habla de ese.
      if (elegidas.some((f) => clave(f.modelo).split(" ").includes(n))) continue;
      const conNumero = filas.filter((f) => clave(f.modelo).split(" ").includes(n));
      const deLaFamilia = conNumero.filter((f) => familias.some((fam) => clave(f.modelo).startsWith(fam)));
      const deLaMarca = conNumero.filter((f) => marcas.includes(clave(f.modelo).split(" ")[0]));
      // Con varios del mismo número ("Redmi Note 15 Pro" y "Pro+") van todos.
      for (const f of (deLaFamilia.length ? deLaFamilia : deLaMarca).slice(0, 2)) agregar(f);
    }
  }
  return elegidas;
}

// Lo que lee la IA.
export function notaTecnica(fichas) {
  if (!fichas.length) return "";
  const lineas = fichas.map((f) => {
    const datos = Object.entries(ETIQUETAS)
      .filter(([c]) => String(f[c] || "").trim())
      .map(([c, nombre]) => `${nombre}: ${f[c]}`)
      .join(" · ");
    return `[FICHA TÉCNICA REAL de ${f.modelo}: ${datos}]`;
  });
  return [
    ...lineas,
    "[Si pregunta algo técnico (pantalla, procesador, cámara, batería, memoria, si es 5G, cuál es mejor), contesta",
    "y compara CON ESTOS DATOS, claro y corto, sin inventar nada que no esté aquí. Si el dato no está, di que",
    "ese dato no lo tienes a la mano]",
  ].join("\n");
}

// "Pásame todas las especificaciones", "la ficha técnica", "características".
export const PIDE_LA_FICHA_COMPLETA =
  /\b(?:especificaciones|ficha\s+t[eé]cnica|caracter[ií]sticas|specs|detalles\s+t[eé]cnicos|datos\s+t[eé]cnicos)\b/i;

// El botón a la página oficial: solo con UN equipo claro y su página puesta.
export function botonDeLaPagina(texto, fichas) {
  if (!PIDE_LA_FICHA_COMPLETA.test(String(texto || ""))) return null;
  const tienePagina = (f) => /^https?:\/\//i.test(String(f?.pagina || "").trim());
  // El primero es el equipo del que se habla (el del carrusel o el que
  // nombró). Si ese no tiene página, no hay botón: mandar la de otro
  // teléfono sería mandarle la ficha equivocada.
  const f = tienePagina(fichas[0]) ? fichas[0] : null;
  if (!f) return null;
  return {
    texto: `📄 Aquí tienes la ficha técnica completa del ${f.modelo}, en la página oficial de la marca 👇`,
    titulo: "Ver ficha técnica",
    url: String(f.pagina).trim(),
  };
}
