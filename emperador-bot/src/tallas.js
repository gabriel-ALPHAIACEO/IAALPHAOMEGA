// LAS TALLAS, LEÍDAS DEL NOMBRE (6-oct-2026, pedido del dueño).
//
// En la carpeta de Drive de El Emperador cada foto dice qué tallas trae:
// "A3-2 / 40-45 /", "K6066 Tallas 36-40", "329/36-44/". Hasta hoy el bot no
// lo miraba: a "¿tienen talla 46?" contestaba "eso te lo confirma un asesor"
// aunque el nombre dijera 36-45, y el 5-oct a una clienta que pidió talla
// 33 de niño le dijo "¡ese sí lo tenemos!" con zapatos de 36-40.
//
// La regla del dueño:
//   · La talla está dentro del rango  → "sí tenemos; los detalles te los
//     comunica un asesor" (y se avisa al asesor).
//   · Está fuera                      → "de ese no tenemos esa talla, pero
//     tenemos este que te puede gustar", con uno PARECIDO que sí la traiga.
//   · El nombre no dice tallas        → como antes: lo confirma un asesor.
//
// Esto es código, no IA: el número está escrito en el nombre y se compara.

// Lo que dice que habla de una talla: "talla", "calzo", "número"...
const HABLA_DE_TALLA = /\b(?:tallas?|tallaje|size|calzo|calza|calzas|n[uú]mero|nro)\b/i;

// Las tallas de calzado que se venden (de niño a adulto). Fuera de esto, un
// número no es una talla: "40$" es un precio y "2" son dos pares.
const TALLA_MINIMA = 16;
const TALLA_MAXIMA = 50;

const esTalla = (n) => Number.isFinite(n) && n >= TALLA_MINIMA && n <= TALLA_MAXIMA;

// La talla que pide el cliente, o null si no pide ninguna concreta.
//   "tienen talla 46?"     → 46
//   "y en 38?"             → 38   (con "en" delante, sin decir "talla")
//   "Talla 33 de niño"     → 33
//   "precio de los Retro 4" → null (4 no es una talla)
//   "cuánto, 45$?"         → null (es un precio)
export function tallaPedida(texto) {
  const t = String(texto || "").toLowerCase();
  if (/\$|d[oó]lar|bs\b|bol[ií]var|precio|cu[aá]nto/.test(t) && !HABLA_DE_TALLA.test(t)) return null;

  // "talla 46", "calzo 42", "número 40", "talla: 38.5"
  const conPalabra = t.match(/\b(?:tallas?|size|calzo|calza|calzas|n[uú]mero|nro)\s*[:#]?\s*(?:el\s+|la\s+|de\s+)?(\d{2}(?:[.,]5)?)\b/);
  if (conPalabra) {
    const n = Number(conPalabra[1].replace(",", "."));
    return esTalla(n) ? n : null;
  }
  // "46 de talla", "un 42"
  const detras = t.match(/\b(\d{2}(?:[.,]5)?)\s+de\s+talla\b/);
  if (detras) {
    const n = Number(detras[1].replace(",", "."));
    return esTalla(n) ? n : null;
  }
  // "y en 38?", "tienes en 46" — solo con "en" delante y en un mensaje
  // corto: en uno largo, "en 40" puede ser cualquier cosa.
  if (t.length <= 60) {
    const conEn = t.match(/\ben\s+(?:el\s+|la\s+|talla\s+)?(\d{2}(?:[.,]5)?)\b(?!\s*(?:\$|d[oó]lar|bs|%))/);
    if (conEn) {
      const n = Number(conEn[1].replace(",", "."));
      if (esTalla(n) && n >= 30) return n;
    }
  }
  return null;
}

// El rango de tallas escrito en el nombre de la foto, o null.
//   "A3-2 / 40-45 /"      → { desde: 40, hasta: 45 }
//   "329/ 44-36 /"        → { desde: 36, hasta: 44 }  (al revés también)
//   "329/36-54/"          → { desde: 36, hasta: 45 }  (54 es un 45 al revés)
//   "K6066 Tallas 36-40"  → { desde: 36, hasta: 40 }
//   "A3-1"                → null (eso es el código, no tallas)
export function rangoDeTallas(titulo) {
  const t = String(titulo || "");
  const re = /(?<![\w.])(\d{2})\s*(?:-|–|—|al|a)\s*(\d{2})(?![\d])/gi;
  for (const m of t.matchAll(re)) {
    let a = Number(m[1]);
    let b = Number(m[2]);
    // Un dígito cambiado de orden al escribir el nombre ("36-54").
    if (b > TALLA_MAXIMA && esTalla(Number(String(b).split("").reverse().join("")))) b = Number(String(b).split("").reverse().join(""));
    if (a > TALLA_MAXIMA && esTalla(Number(String(a).split("").reverse().join("")))) a = Number(String(a).split("").reverse().join(""));
    if (!esTalla(a) || !esTalla(b) || a === b) continue;
    const desde = Math.min(a, b);
    const hasta = Math.max(a, b);
    // Un rango de calzado no pasa de ~15 números (26-40 de niño, 36-46…).
    if (hasta - desde > 16) continue;
    return { desde, hasta };
  }
  return null;
}

// true: la trae · false: no la trae · null: el nombre no dice tallas.
export function traeLaTalla(titulo, talla) {
  const rango = rangoDeTallas(titulo);
  if (!rango || !Number.isFinite(talla)) return null;
  return talla >= rango.desde && talla <= rango.hasta;
}

// Lo que se puede decir con los productos de los que habla el cliente.
//   { estado: "hay",     con: [...] }  alguno la trae
//   { estado: "no_hay",  sin: [...] }  ninguno la trae (y al menos uno lo dice)
//   { estado: "no_se" }                ningún nombre dice tallas
export function revisarTalla(productos, talla) {
  const lista = Array.isArray(productos) ? productos : [];
  const con = lista.filter((p) => traeLaTalla(p.titulo, talla) === true);
  if (con.length) return { estado: "hay", con };
  const sin = lista.filter((p) => traeLaTalla(p.titulo, talla) === false);
  if (sin.length) return { estado: "no_hay", sin };
  return { estado: "no_se" };
}

export function fraseHayTalla(talla) {
  return `¡Sí tenemos talla ${talla}! 🙌 Los detalles te los comunica un asesor en un momento 😊`;
}

export function fraseNoHayTalla(talla, conParecido) {
  return conParecido
    ? `De ese no tenemos talla ${talla} 😕 Pero tenemos este que te puede gustar 👇`
    : `De ese no tenemos talla ${talla} 😕 ¿Quieres que te muestre otro modelo?`;
}
