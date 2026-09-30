// CASHEA: CUÁNTO DA DE INICIAL ESTE CLIENTE, CON SU NIVEL Y SU ZAPATO.
//
// QUÉ SE PEDÍA (30-sep-2026). Que cuando pregunten por Cashea el bot no
// pegue una tabla y ya, sino que responda PERSONALIZADO: si el cliente dice
// "soy nivel 3" y está mirando unos Jordan de 90 USD, que le diga "tu
// inicial son 27 USD y el resto en cuotas". Bien armado, bonito y que
// enganche.
//
// QUIÉN HACE QUÉ.
//
//   · Los datos —la promoción y el porcentaje de cada nivel— salen de la
//     sección [CASHEA] de prompts/pagos.txt. Si cambia la promoción, se
//     cambia allí y nada más.
//   · LAS CUENTAS LAS HACE ESTE ARCHIVO, NO LA IA. Es dinero: un 30% de
//     85,50 mal calculado es un cliente que llega a la tienda esperando
//     pagar otra cosa. El modelo de texto es bueno conversando y malo
//     garantizando una multiplicación.
//   · La IA sí decide DE QUÉ ZAPATO se habla: si el cliente escribe "¿y con
//     Cashea cuánto doy por esos?", el prompt le pide que vuelva a buscar
//     ese producto, igual que con cualquier pregunta de precio. Lo que
//     encuentra la búsqueda llega aquí con su precio real de Shopify.
//
// Y NUNCA EMPEORA. Sin la sección [CASHEA] cargada, nada de esto se activa y
// Cashea sigue yendo a un asesor, como antes.

import listaPagos from "./prompts/pagos.txt";

let leido = null;

function leer() {
  if (!leido) {
    leido = {
      titular: "",
      niveles: new Map(),
      desde: 0,
      hasta: 0,
      fechas: "",
      empieza: "",
      cuotas: 0,
      detalleCuotas: "",
      minimo: 0,
      minimoAlCero: false,
    };
    let seccion = "";

    for (const cruda of String(listaPagos || "").split("\n")) {
      const linea = cruda.trim();
      if (!linea || linea.startsWith("#")) continue;

      const marca = linea.match(/^\[(\w+)\]$/);
      if (marca) {
        seccion = marca[1].toUpperCase();
        continue;
      }
      if (seccion !== "CASHEA") continue;

      // "Vigencia: 2026-10-01 al 2026-10-06"
      const vigencia = linea.match(/^vigencia\s*:\s*(\d{4}-\d{2}-\d{2})\s*(?:al|a|hasta|-|–)\s*(\d{4}-\d{2}-\d{2})/i);
      if (vigencia) {
        // Hora de Venezuela (UTC-4, sin horario de verano): el día empieza a
        // las 00:00 de allá y termina a las 23:59:59 de allá.
        leido.desde = Date.parse(`${vigencia[1]}T00:00:00-04:00`);
        leido.hasta = Date.parse(`${vigencia[2]}T23:59:59-04:00`);
        leido.fechas = rangoLegible(vigencia[1], vigencia[2]);
        leido.empieza = diaLegible(vigencia[1]);
        continue;
      }

      // "Mínimo para las cuotas: 100" — desde qué monto aplica el modo de
      // cuotas (en la moneda de los precios de la tienda).
      const minimo = linea.match(/^(m[ií]nimo[^:]*):\s*\$?\s*(\d+(?:[.,]\d+)?)/i);
      if (minimo) {
        leido.minimo = Number(minimo[2].replace(",", "."));
        // Si la línea nombra el 0% ("Mínimo para el 0% y las 6 cuotas"), el
        // mínimo vale también para el 0% de inicial. Si no, solo para las
        // cuotas —que es lo que decidió el dueño el 30-sep—.
        leido.minimoAlCero = /0\s*%|cero/i.test(minimo[1]);
        continue;
      }

      // "Cuotas: 6" (o "Cuotas: 6 sin interés": lo de después sale tal cual)
      const cuotas = linea.match(/^cuotas\s*:\s*(\d+)\s*(.*)$/i);
      if (cuotas) {
        leido.cuotas = Number(cuotas[1]);
        leido.detalleCuotas = cuotas[2].trim();
        continue;
      }

      // "Nivel 3: 30%"
      const nivel = linea.match(/^nivel\s*(\d+)\s*[:=\-–—]?\s*(\d+(?:[.,]\d+)?)\s*%/i);
      if (nivel) {
        leido.niveles.set(Number(nivel[1]), Number(nivel[2].replace(",", ".")));
      } else if (!leido.titular) {
        leido.titular = linea;
      }
    }
  }
  return leido;
}

// ¿Hay algo de Cashea cargado? (Aunque esté fuera de fecha.)
export function hayCashea() {
  return leer().niveles.size > 0;
}

// ¿En qué momento de la promoción estamos? "antes" (todavía no empezó),
// "vigente", "despues" (ya terminó), o "siempre" (sin línea de vigencia). Se
// pregunta en cada mensaje —no al arrancar— porque un Worker puede seguir
// vivo de un día para otro, y la promoción tiene que cambiar sola a la
// medianoche.
export function momentoDeLaPromocion(ahora = Date.now()) {
  const { desde, hasta } = leer();
  if (!desde || !hasta) return "siempre";
  if (ahora < desde) return "antes";
  if (ahora > hasta) return "despues";
  return "vigente";
}

// ¿Se contesta Cashea con la tabla y las cuentas? SÍ mientras está en fecha
// Y TAMBIÉN ANTES DE QUE EMPIECE (pedido del dueño, 30-sep-2026: "que
// responda la IA, no que como no está activa no responda"): antes, se
// anuncia —"arranca el 1 de octubre"— con sus cuentas. Solo cuando YA
// TERMINÓ pasa al asesor, que no se promete una promoción vencida.
export function casheaVigente(ahora = Date.now()) {
  if (!leer().niveles.size) return false;
  return momentoDeLaPromocion(ahora) !== "despues";
}

// Lo que se contesta a una pregunta de Cashea fuera de fecha. Lleva "en un
// momento" a propósito: así hayEscalada() avisa al asesor, que es quien
// sabe qué condiciones hay ese día.
export const CASHEA_FUERA_DE_FECHA = "Lo de Cashea te lo confirma un asesor en un momento 😊";

// Las fechas de la promoción en palabras ("del 1 al 6 de octubre"), o "".
export function fechasDeLaPromocion() {
  return leer().fechas;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
  "septiembre", "octubre", "noviembre", "diciembre"];

// "2026-10-01" → "el 1 de octubre".
function diaLegible(a) {
  const [, m, d] = a.split("-").map(Number);
  return `el ${d} de ${MESES[m - 1]}`;
}

// "2026-10-01", "2026-10-06" → "del 1 al 6 de octubre".
function rangoLegible(a, b) {
  const [, ma, da] = a.split("-").map(Number);
  const [, mb, db] = b.split("-").map(Number);
  return ma === mb
    ? `del ${da} al ${db} de ${MESES[mb - 1]}`
    : `del ${da} de ${MESES[ma - 1]} al ${db} de ${MESES[mb - 1]}`;
}

// El porcentaje de inicial de un nivel, o null si ese nivel no existe.
export function inicialDelNivel(nivel) {
  const pct = leer().niveles.get(Number(nivel));
  return pct === undefined ? null : pct;
}

/* ── ¿Pregunta por Cashea? ─────────────────────────────────────────── */

// Cashea escrito como se escribe en un chat: "cashea", "casheа", "kashea",
// "cachea". Y las otras formas de preguntar lo mismo: las cuotas, el
// financiamiento, la inicial, o decir su nivel.
const HABLA_DE_CASHEA =
  /\b(?:c|k)a(?:s|c)?hea\b|\bcuotas?\b|\bfinanci\w*|\binicial\b|\bnivel\s*(?:\d|uno|dos|tres|cuatro|cinco|seis)\b|\ba\s+cr[eé]dito\b|\bpor\s+partes\b/i;

export function preguntaPorCashea(texto) {
  return HABLA_DE_CASHEA.test(sinTildes(texto));
}

const NUMEROS = { uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9 };

// "soy nivel 3", "nivel tres", "tengo nivel 4 en cashea".
export function nivelDelCliente(texto) {
  const m = sinTildes(texto).match(/\bnivel\s*(\d+|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)\b/i);
  if (!m) return null;
  const valor = m[1].toLowerCase();
  return /^\d+$/.test(valor) ? Number(valor) : NUMEROS[valor];
}

// EL NIVEL SE RECUERDA. Quien dijo "soy nivel 3" hace dos mensajes no tiene
// por qué repetirlo al preguntar por otro zapato. Se guarda como nota en el
// historial —la única memoria de texto que hay— con esta forma exacta.
export function notaDeNivel(nivel) {
  return `Nivel Cashea: ${nivel}.`;
}

export function nivelEnElHistorial(historial) {
  const todos = [...String(historial || "").matchAll(/Nivel Cashea:\s*(\d+)/gi)];
  return todos.length ? Number(todos[todos.length - 1][1]) : null;
}

/* ── Las cuentas ───────────────────────────────────────────────────── */

// "90 USD", "85.50 USD", "$85,00" → la cifra, y cómo volver a escribirla
// con el mismo formato. Devuelve null si no hay un número que entender.
export function leerPrecio(precio) {
  const texto = String(precio || "");
  const token = texto.match(/\d[\d.,]*/)?.[0];
  if (!token) return null;

  // Decimales con coma ("85,50") o con punto ("85.50"). Un separador seguido
  // de exactamente 1-2 cifras al final es el decimal; lo demás, miles.
  const conComa = /,\d{1,2}$/.test(token);
  const limpio = conComa
    ? token.replace(/\./g, "").replace(",", ".")
    : token.replace(/,(?=\d{3}\b)/g, "");
  const cifra = Number(limpio);
  if (!Number.isFinite(cifra) || cifra <= 0) return null;

  const escribir = (valor) => {
    const redondo = Math.round(valor * 100) / 100;
    let numero = Number.isInteger(redondo) ? String(redondo) : redondo.toFixed(2);
    if (conComa) numero = numero.replace(".", ",");
    return texto.replace(token, numero).trim();
  };

  return { cifra, escribir };
}

// La inicial y el resto de un precio, con un porcentaje. Todo redondeado a
// céntimos, y el resto es precio - inicial: así las dos partes suman
// EXACTAMENTE el precio, sin un céntimo perdido por el redondeo.
export function cuentaCashea(precio, porcentaje) {
  const leido = leerPrecio(precio);
  if (!leido || porcentaje === null || porcentaje === undefined) return null;

  // EL 0% DE INICIAL TAMBIÉN TIENE MÍNIMO (dueño, 30-sep-2026: "a partir de
  // 100$ es que se admite el 0% de inicial"). Por debajo no se hace la
  // cuenta con 0%: se avisa, y la inicial de ese par la confirma un asesor.
  const { minimo: minimoCero, minimoAlCero } = leer();
  if (porcentaje === 0 && minimoAlCero && minimoCero && leido.cifra < minimoCero) {
    return {
      precio: leido.escribir(leido.cifra),
      ceroSinMinimo: true,
      alcanzaMinimo: false,
      cuotas: null,
    };
  }

  const inicial = Math.round(leido.cifra * porcentaje) / 100;
  const resto = Math.round((leido.cifra - inicial) * 100) / 100;

  // LAS CUOTAS, EXACTAS. 63 entre 6 son 10,50 justos. Pero 59,85 entre 6 son
  // 9,975: redondeando a 9,98 las seis sumarían 59,88 — tres céntimos que no
  // existen. Así que se dicen como son: cinco de 9,98 y la última de 9,95.
  // EL MODO DE CUOTAS TIENE UN MÍNIMO ("la compra debe ser 100$ en
  // adelante"). Por debajo no se le reparte en cuotas: se le dice.
  const { cuotas: n, minimo } = leer();
  const alcanzaMinimo = !minimo || leido.cifra >= minimo;
  let cuotas = null;
  if (n > 0 && resto > 0 && alcanzaMinimo) {
    const cada = Math.round((resto / n) * 100) / 100;
    const ultima = Math.round((resto - cada * (n - 1)) * 100) / 100;
    cuotas = {
      cuantas: n,
      cada: leido.escribir(cada),
      ultima: leido.escribir(ultima),
      iguales: Math.abs(ultima - cada) < 0.005,
      cadaCifra: cada,
      ultimaCifra: ultima,
    };
  }

  return {
    precio: leido.escribir(leido.cifra),
    inicial: leido.escribir(inicial),
    resto: leido.escribir(resto),
    inicialCifra: inicial,
    restoCifra: resto,
    cuotas,
    alcanzaMinimo,
  };
}

// "compras desde 100$", o "" si no hay mínimo.
export function textoDelMinimo() {
  const { minimo } = leer();
  return minimo ? `compras desde ${minimo}$` : "";
}

// La condición, con las palabras del dueño: "para optar por las 6 cuotas la
// compra debe ser de 100$ en adelante".
export function fraseDelMinimo() {
  const { minimo, minimoAlCero } = leer();
  if (!minimo) return "";
  const cuotas = "las " + (nombreDeLasCuotas() || "cuotas");
  const que = minimoAlCero ? "el cero por ciento de inicial y " + cuotas : cuotas;
  return "para optar por " + que + " la compra debe ser de " + minimo + "$ en adelante";
}

// "6 cuotas", o "6 cuotas sin interés" si pagos.txt lo dice. "" sin dato.
export function nombreDeLasCuotas() {
  const { cuotas, detalleCuotas } = leer();
  if (!cuotas) return "";
  return `${cuotas} cuotas${detalleCuotas ? ` ${detalleCuotas}` : ""}`;
}

// "en 6 cuotas de 10.50 USD", o "en 6 cuotas: 5 de 9.98 USD y la última de
// 9.95 USD". Sin cuotas cargadas: "en cuotas".
function enCuotas(cuenta) {
  const nombre = nombreDeLasCuotas();
  if (!cuenta.alcanzaMinimo) {
    return `en cuotas con Cashea (${fraseDelMinimo()})`;
  }
  if (!cuenta.cuotas) return nombre ? `en ${nombre}` : "en cuotas";
  const c = cuenta.cuotas;
  return c.iguales
    ? `en ${nombre} de ${c.cada}`
    : `en ${nombre}: ${c.cuantas - 1} de ${c.cada} y la última de ${c.ultima}`;
}

/* ── El mensaje ────────────────────────────────────────────────────── */

// Cuántos zapatos se desglosan como mucho. Más de tres y el mensaje deja de
// leerse en la pantalla de un teléfono.
const MAXIMO_EN_LA_CUENTA = 3;

// El mensaje de Cashea, armado para ESTE cliente:
//
//   · con su nivel y los zapatos que está mirando → la cuenta de cada uno
//   · con su nivel y sin zapato → su porcentaje, y le pide el modelo
//   · sin nivel → la promoción y la tabla, y le pregunta su nivel (y, si
//     está mirando un zapato, le promete la cuenta de ESE zapato)
//
// Devuelve "" si Cashea no está cargado.
export function tarjetaCashea({ nivel = null, productos = [], ahora = Date.now() } = {}) {
  if (!hayCashea()) return "";

  const { titular, niveles, fechas, empieza } = leer();
  const pct = nivel ? inicialDelNivel(nivel) : null;
  const momento = momentoDeLaPromocion(ahora);

  // La línea de las fechas: la urgencia de verdad. Antes de empezar, se
  // anuncia ("¡Arranca el 1 de octubre!"); en fecha, cuándo termina.
  const cuando =
    momento === "antes"
      ? `⏳ ¡Arranca ${empieza}! Promoción por tiempo limitado ${fechas}.`
      : fechas
        ? `⏳ Promoción por tiempo limitado ${fechas}.`
        : "";

  const conCuenta = (productos || [])
    .map((p) => ({ p, cuenta: cuentaCashea(p.precio, pct ?? 0) }))
    .filter((x) => x.p?.titulo && x.cuenta)
    .slice(0, MAXIMO_EN_LA_CUENTA);

  const lasCuotas = nombreDeLasCuotas();
  const minimo = textoDelMinimo();
  const lineaCuotas = lasCuotas
    ? minimo
      ? `🗓️ El resto, en ${lasCuotas}.\n💲 ${mayuscula(fraseDelMinimo())}.`
      : `🗓️ El resto, en ${lasCuotas}.`
    : "";

  // ── Sin nivel (o uno que no existe): la promoción, la tabla y la pregunta.
  if (pct === null) {
    // Del nivel más alto al más bajo: el 0% primero, que es el gancho.
    const marcaDelCero = minimo && leer().minimoAlCero ? " 🎉 (" + minimo + ")" : " 🎉";
    const tabla = [...niveles.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([n, v]) => `• Nivel ${n} → ${formatoPct(v)} de inicial${v === 0 ? marcaDelCero : ""}`)
      .join("\n");

    const aviso = nivel ? `No tengo el Nivel ${nivel} en la tabla de Cashea. ` : "";
    const cierre = conCuenta.length
      ? `¿Qué nivel tienes en Cashea? Dímelo y te digo exactamente cuánto das de inicial por ${nombreCorto(conCuenta[0].p.titulo)} 😉`
      : "¿Qué nivel tienes en Cashea? Dímelo y te saco la cuenta exacta 😉";

    return [
      titular ? (/🔥/.test(titular) ? titular : `🔥 ${titular}`) : "💜 ¡Sí, trabajamos con Cashea!",
      cuando,
      "",
      "Bajada de inicial ⬇️",
      tabla,
      "",
      lineaCuotas,
      lineaCuotas ? "" : null,
      aviso + cierre,
    ]
      .filter((l) => l !== null && l !== undefined)
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^\n+/, "");
  }

  // ── Con nivel.
  const condicionDelCero = minimo && leer().minimoAlCero ? " en " + minimo : "";
  const encabezado =
    pct === 0
      ? `🎉 ¡Con tu Nivel ${nivel} en Cashea te lo llevas con 0% de inicial${condicionDelCero}!`
      : `💜 Con tu Nivel ${nivel} en Cashea pagas solo el ${formatoPct(pct)} de inicial`;

  if (!conCuenta.length) {
    return [
      `${encabezado} 🙌`,
      lineaCuotas,
      cuando,
      "",
      "¿Qué modelo te gustó? Dime cuál y te saco la cuenta exacta 😉",
    ]
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");
  }

  const lineas = conCuenta.map(({ p, cuenta }) =>
    cuenta.ceroSinMinimo
      ? `👟 ${p.titulo} — ${cuenta.precio}\n` +
        `   ⚠️ El 0% de inicial es para ${minimo}: la inicial de este par te la confirma un asesor`
      : `👟 ${p.titulo} — ${cuenta.precio}\n` +
        `   ✅ Inicial: ${cuenta.inicial}\n` +
        (pct === 0
          ? `   🗓️ Todo (${cuenta.resto}) ${enCuotas(cuenta)}`
          : `   🗓️ El resto (${cuenta.resto}) ${enCuotas(cuenta)}`)
  );

  const cierre = conCuenta.length > 1 ? "¿Con cuál te quedas? 😊" : "¿Te animas? 😊";

  return [pct === 0 ? encabezado : `${encabezado}:`, "", lineas.join("\n\n"), "", cuando, "", cierre]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function cuotasSueltas() {
  const nombre = nombreDeLasCuotas();
  return nombre ? `en ${nombre}` : "en cuotas";
}

function mayuscula(texto) {
  return texto ? texto[0].toUpperCase() + texto.slice(1) : "";
}

function formatoPct(v) {
  return `${Number.isInteger(v) ? v : String(v).replace(".", ",")}%`;
}

// "Air Jordan 4 Retro Negro Caballero" se lee mejor como "el Air Jordan 4
// Retro Negro Caballero" que sin artículo, y cabe en la frase.
function nombreCorto(titulo) {
  return `el ${String(titulo).trim()}`;
}

/* ── La red de seguridad ───────────────────────────────────────────── */

// "nivel 3 ... 25%": el nivel con un porcentaje pegado.
const NIVEL_CON_PORCENTAJE = /\bnivel\s*(\d+)\b[^.!?\n%]{0,25}?(\d+(?:[.,]\d+)?)\s*%/gi;
// "30% de inicial", "inicial del 30%", "inicial de 30 %".
const INICIAL_CON_PORCENTAJE =
  /(\d+(?:[.,]\d+)?)\s*%\s*(?:de\s+)?inicial|\binicial\s+(?:de\s+|del\s+)?(\d+(?:[.,]\d+)?)\s*%/gi;

// Revisa lo que el modelo quiere mandar. El prompt le dice que no escriba
// porcentajes de Cashea —la cuenta la manda este archivo aparte—, pero si
// escribe uno, tiene que ser uno de la tabla y del nivel correcto. Un "nivel
// 3: 20%" inventado es dinero: se cambia por la tabla de verdad.
export function revisarCashea(respuesta, ahora = Date.now()) {
  const texto = String(respuesta || "");
  if (!hayCashea() || !/%/.test(texto)) return { respuesta: texto, corregido: false };

  // Fuera de fecha, CUALQUIER porcentaje de Cashea es una promoción vencida.
  if (!casheaVigente(ahora)) {
    if (/\b(?:c|k)a(?:s|c)?hea\b|\binicial\b|\bnivel\s*\d/i.test(texto)) {
      console.error("CASHEA: ofreció porcentajes con la promoción fuera de fecha. Lo paso al asesor.");
      return { respuesta: CASHEA_FUERA_DE_FECHA, corregido: true, motivos: ["promoción fuera de fecha"] };
    }
    return { respuesta: texto, corregido: false };
  }

  const motivos = [];

  for (const m of texto.matchAll(NIVEL_CON_PORCENTAJE)) {
    const esperado = inicialDelNivel(m[1]);
    const dicho = Number(m[2].replace(",", "."));
    if (esperado === null) motivos.push(`habló de un Nivel ${m[1]} que no existe`);
    else if (dicho !== esperado) {
      motivos.push(`dijo ${dicho}% para el Nivel ${m[1]} (es ${esperado}%)`);
    }
  }

  const validos = new Set(leer().niveles.values());
  for (const m of texto.matchAll(INICIAL_CON_PORCENTAJE)) {
    const dicho = Number((m[1] || m[2]).replace(",", "."));
    if (!validos.has(dicho)) motivos.push(`inventó una inicial de ${dicho}%`);
  }

  if (!motivos.length) return { respuesta: texto, corregido: false };

  console.error(`CASHEA: ${motivos.join(" y ")}. Lo cambio por la tabla de verdad.`);
  return { respuesta: tarjetaCashea(), corregido: true, motivos };
}

function sinTildes(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}
