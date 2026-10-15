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
//
// CASHEA SIN TABLA (El Emperador, 1-oct-2026: "ellos no tienen 0%, con
// Cashea"). Una tienda puede aceptar Cashea sin tener cargada su tabla de
// niveles. Entonces el bot dice que SÍ se acepta, explica que la inicial
// depende del nivel, y la inicial la confirma un asesor (que recibe el
// aviso). Lo que NUNCA hace es inventar un porcentaje, y menos un 0%.

import listaPagos from "./prompts/pagos.txt";

let crudo = null;

// Una promoción puede ser de UN rango de fechas ("Vigencia: 2026-10-01 al
// 2026-10-06") o REPETIRSE CADA MES (Días del Club de Cashea, 12-oct-2026:
// "días 1 al 6, 6 cuotas" y "días 15 al 20, Casheálo con menos", de octubre
// a diciembre). Para lo segundo, cada bloque empieza con "Días: 1 al 6" y
// trae su titular, sus cuotas, su mínimo y su tabla; la "Vigencia" de arriba
// es la de toda la campaña. Lo de antes del primer "Días:" vale como
// promoción de siempre (y su tabla la heredan los bloques que no traen una).
// Un bloque puede valer solo en algunos meses con "Meses: 10 al 11" o
// "Mes: 12" (13-oct-2026: en diciembre la promoción es del 1 al 31).
function tramoVacio(dias = null) {
  return { dias, meses: null, titular: "", niveles: new Map(), cuotas: 0, hastaCuotas: false, detalleCuotas: "", minimo: 0, minimoAlCero: false };
}

function leerCrudo() {
  if (!crudo) {
    crudo = { acepta: false, desde: 0, hasta: 0, desdeDia: "", hastaDia: "", tramos: [tramoVacio()] };
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
      crudo.acepta = true;
      const tramo = crudo.tramos[crudo.tramos.length - 1];

      // "Vigencia: 2026-10-01 al 2026-10-06"
      const vigencia = linea.match(/^vigencia\s*:\s*(\d{4}-\d{2}-\d{2})\s*(?:al|a|hasta|-|–)\s*(\d{4}-\d{2}-\d{2})/i);
      if (vigencia) {
        // Hora de Venezuela (UTC-4, sin horario de verano): el día empieza a
        // las 00:00 de allá y termina a las 23:59:59 de allá.
        crudo.desde = Date.parse(`${vigencia[1]}T00:00:00-04:00`);
        crudo.hasta = Date.parse(`${vigencia[2]}T23:59:59-04:00`);
        crudo.desdeDia = vigencia[1];
        crudo.hastaDia = vigencia[2];
        continue;
      }

      // "Días: 1 al 6" — un bloque nuevo que se repite cada mes.
      const dias = sinTildes(linea).match(/^dias\s*:?\s*(?:del\s+)?(\d{1,2})\s*(?:al|a|hasta|-|–)\s*(\d{1,2})\b/i);
      if (dias) {
        const de = Number(dias[1]), a = Number(dias[2]);
        if (de >= 1 && a >= de && a <= 31) crudo.tramos.push(tramoVacio([de, a]));
        continue;
      }

      // "Meses: 10 al 11", "Mes: 12", "Meses: 10, 11" — el bloque vale SOLO
      // en esos meses (diciembre es otra cosa: del 1 al 31).
      const meses = linea.match(/^mes(?:es)?\s*:\s*(.+)$/i);
      if (meses && tramo.dias) {
        const set = new Set();
        for (const parte of meses[1].split(",")) {
          const rango = parte.trim().match(/^(\d{1,2})(?:\s*(?:al|a|hasta|-|–)\s*(\d{1,2}))?$/i);
          if (!rango) continue;
          const de = Number(rango[1]), a = Number(rango[2] || rango[1]);
          for (let m = de; m <= a && m <= 12; m++) if (m >= 1) set.add(m);
        }
        if (set.size) tramo.meses = set;
        continue;
      }

      // "Mínimo para las cuotas: 100" — desde qué monto aplica el modo de
      // cuotas (en la moneda de los precios de la tienda).
      const minimo = linea.match(/^(m[ií]nimo[^:]*):\s*\$?\s*(\d+(?:[.,]\d+)?)/i);
      if (minimo) {
        tramo.minimo = Number(minimo[2].replace(",", "."));
        // Si la línea nombra el 0% ("Mínimo para el 0% y las 6 cuotas"), el
        // mínimo vale también para el 0% de inicial. Si no, solo para las
        // cuotas —que es lo que decidió el dueño el 30-sep—.
        tramo.minimoAlCero = /0\s*%|cero/i.test(minimo[1]);
        continue;
      }

      // "Cuotas: 6", "Cuotas: hasta 3" (o "Cuotas: 6 sin interés": lo de
      // después sale tal cual junto a "cuotas")
      const cuotas = linea.match(/^cuotas\s*:\s*(hasta\s+)?(\d+)\s*(.*)$/i);
      if (cuotas) {
        tramo.hastaCuotas = !!cuotas[1];
        tramo.cuotas = Number(cuotas[2]);
        tramo.detalleCuotas = cuotas[3].trim();
        continue;
      }

      // "Nivel 3: 30%"
      const nivel = linea.match(/^nivel\s*(\d+)\s*[:=\-–—]?\s*(\d+(?:[.,]\d+)?)\s*%/i);
      if (nivel) {
        tramo.niveles.set(Number(nivel[1]), Number(nivel[2].replace(",", ".")));
      } else if (!tramo.titular) {
        tramo.titular = linea;
      }
    }
  }
  return crudo;
}

// El momento con el que se mira la promoción. tarjetaCashea y revisarCashea
// lo fijan mientras arman su mensaje, para que todo lo que llaman vea la
// MISMA promoción (a las 23:59:59 del día 6 no puede salir medio mensaje de
// una y medio de otra).
let fijado = null;

const DOS = (n) => String(n).padStart(2, "0");
const diasDelMes = (anio, mes) => new Date(Date.UTC(anio, mes, 0)).getUTCDate();

// Las ventanas concretas de los bloques que se repiten: una por bloque y por
// mes, recortadas a la vigencia de la campaña, en orden.
function ventanas(c, ahora) {
  const repetidos = c.tramos.filter((t) => t.dias);
  const lista = [];
  let anio, mes, finAnio, finMes;
  if (c.desde && c.hasta) {
    [anio, mes] = c.desdeDia.split("-").map(Number);
    [finAnio, finMes] = c.hastaDia.split("-").map(Number);
  } else {
    // Sin vigencia, se repite siempre: basta mirar alrededor de hoy.
    const hoy = new Date(ahora - 4 * 3600 * 1000);
    anio = hoy.getUTCFullYear();
    mes = hoy.getUTCMonth(); // el mes anterior (getUTCMonth es 0-based)
    if (mes === 0) { anio -= 1; mes = 12; }
    finAnio = anio + 1;
    finMes = mes;
  }
  for (let vueltas = 0; vueltas < 60 && (anio < finAnio || (anio === finAnio && mes <= finMes)); vueltas++) {
    for (const t of repetidos) {
      if (t.meses && !t.meses.has(mes)) continue;
      const tope = diasDelMes(anio, mes);
      if (t.dias[0] > tope) continue;
      const deDia = `${anio}-${DOS(mes)}-${DOS(t.dias[0])}`;
      const aDia = `${anio}-${DOS(mes)}-${DOS(Math.min(t.dias[1], tope))}`;
      let desde = Date.parse(`${deDia}T00:00:00-04:00`);
      let hasta = Date.parse(`${aDia}T23:59:59-04:00`);
      let d1 = deDia, d2 = aDia;
      if (c.desde && desde < c.desde) { desde = c.desde; d1 = c.desdeDia; }
      if (c.hasta && hasta > c.hasta) { hasta = c.hasta; d2 = c.hastaDia; }
      if (desde > hasta) continue;
      lista.push({ tramo: t, desde, hasta, d1, d2 });
    }
    mes += 1;
    if (mes > 12) { mes = 1; anio += 1; }
  }
  return lista.sort((x, y) => x.desde - y.desde);
}

// La promoción tal como está EN ESTE MOMENTO: la de hoy, o la próxima (que
// se anuncia), o la última si ya terminó todo.
function leer(ahora) {
  const c = leerCrudo();
  const t = ahora ?? fijado ?? Date.now();
  const base = c.tramos[0];
  const repetida = c.tramos.length > 1;
  let tramo = base, desde = c.desde, hasta = c.hasta, d1 = c.desdeDia, d2 = c.hastaDia;

  // ENTRE PROMOCIONES, EL ESQUEMA NORMAL (14-oct-2026, dueño: "las fechas
  // entre promos son: Nivel 1 50% de inicial + 3 cuotas sin interés…"). Si
  // lo de antes del primer "Días:" trae su tabla, ESE es el de los días sin
  // promoción dentro de la campaña, y se anuncia la próxima.
  let proxima = null;
  let enBase = false;
  if (repetida) {
    const lista = ventanas(c, t);
    const actual = lista.find((v) => v.desde <= t && t <= v.hasta);
    const siguiente = lista.find((v) => v.desde > t);
    const dentroDeLaCampana = (!c.desde || t >= c.desde) && (!c.hasta || t <= c.hasta);
    if (!actual && base.niveles.size && dentroDeLaCampana) {
      enBase = true;
      desde = c.desde;
      hasta = c.hasta;
      d1 = "";
      d2 = "";
      if (siguiente) proxima = { titular: siguiente.tramo.titular, fechas: rangoLegible(siguiente.d1, siguiente.d2), empieza: diaLegible(siguiente.d1) };
    } else {
      const elegida = actual || siguiente || lista[lista.length - 1];
      if (elegida) ({ tramo, desde, hasta, d1, d2 } = elegida);
    }
  }

  // PASADA LA CAMPAÑA, SIGUE EL ESQUEMA NORMAL (14-oct-2026, dueño: "cuando es
  // fuera de fecha, que no hay ninguna promoción, es normal"): Cashea no se
  // acaba el 31 de diciembre, solo se acaba la promo. Si lo de antes del primer
  // "Días:" trae su tabla (Nivel 1 50% … Nivel 6 0% + 3 cuotas sin interés), ese
  // es el de ahí en adelante, sin anunciar ninguna próxima promo.
  if (c.hasta && t > c.hasta && base.niveles.size) {
    enBase = true;
    tramo = base;
    desde = c.desde;
    hasta = c.hasta;
    d1 = "";
    d2 = "";
    proxima = null;
  }

  const niveles = tramo.niveles.size ? tramo.niveles : base.niveles;
  return {
    acepta: c.acepta,
    repetida,
    titular: tramo.titular || (tramo === base ? "" : base.titular),
    niveles,
    cuotas: tramo.cuotas,
    hastaCuotas: tramo.hastaCuotas,
    detalleCuotas: tramo.detalleCuotas,
    minimo: tramo.minimo,
    minimoAlCero: tramo.minimoAlCero,
    desde,
    hasta,
    fechas: d1 && d2 ? rangoLegible(d1, d2) : "",
    empieza: d1 ? diaLegible(d1) : "",
    enBase,
    proxima,
  };
}

// ¿La tienda acepta Cashea? (Aunque esté fuera de fecha, y aunque no tenga
// la tabla de niveles cargada.)
export function hayCashea() {
  return leerCrudo().acepta;
}

// ¿Tiene la tabla de niveles? Sin ella no se hace ninguna cuenta.
export function hayTablaCashea(ahora) {
  return leer(ahora).niveles.size > 0;
}

// ¿En qué momento de la promoción estamos? "antes" (todavía no empezó),
// "vigente", "despues" (ya terminó), o "siempre" (sin línea de vigencia). Se
// pregunta en cada mensaje —no al arrancar— porque un Worker puede seguir
// vivo de un día para otro, y la promoción tiene que cambiar sola a la
// medianoche.
export function momentoDeLaPromocion(ahora = fijado ?? Date.now()) {
  const { desde, hasta } = leer(ahora);
  if (!desde || !hasta) return "siempre";
  if (ahora < desde) return "antes";
  if (ahora > hasta) return "despues";
  return "vigente";
}

// ¿Se contesta Cashea con la tabla y las cuentas? SÍ mientras está en fecha
// Y TAMBIÉN ANTES DE QUE EMPIECE (pedido del dueño, 30-sep-2026: "que
// responda la IA, no que como no está activa no responda"): antes, se
// anuncia —"arranca el 1 de octubre"— con sus cuentas. Cuando YA
// TERMINÓ sigue el esquema normal si está cargado; sin él, pasa al asesor, que
// no se promete una promoción vencida.
export function casheaVigente(ahora = fijado ?? Date.now()) {
  if (!hayCashea()) return false;
  // Terminada la promo, con el esquema normal cargado se sigue contestando.
  if (momentoDeLaPromocion(ahora) === "despues") return leer(ahora).enBase;
  return true;
}

// Lo que se contesta a una pregunta de Cashea fuera de fecha. Lleva "en un
// momento" a propósito: así hayEscalada() avisa al asesor, que es quien
// sabe qué condiciones hay ese día.
export const CASHEA_FUERA_DE_FECHA = "Lo de Cashea te lo confirma un asesor en un momento 😊";

// Las fechas de la promoción en palabras ("del 1 al 6 de octubre"), o "".
export function fechasDeLaPromocion(ahora) {
  return leer(ahora).fechas;
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
export function inicialDelNivel(nivel, ahora) {
  const pct = leer(ahora).niveles.get(Number(nivel));
  return pct === undefined ? null : pct;
}

/* ── ¿Pregunta por Cashea? ─────────────────────────────────────────── */

// Cashea escrito como se escribe en un chat: "cashea", "casheа", "kashea",
// "cachea". Y las otras formas de preguntar lo mismo: las cuotas, el
// financiamiento, la inicial, o decir su nivel.
const HABLA_DE_CASHEA =
  /\b(?:c|k)a(?:s|c)?hea\b|\bcuotas?\b|\bfinanci\w*|\binicial\b|\b(?:nivel|level|lvl|niv|nv)\s*(?:\d|uno|dos|tres|cuatro|cinco|seis)\b|\ba\s+cr[eé]dito\b|\bpor\s+partes\b/i;

export function preguntaPorCashea(texto) {
  return HABLA_DE_CASHEA.test(sinTildes(texto));
}

const NUMEROS = { uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9 };

// "soy nivel 3", "nivel tres", "tengo nivel 4 en cashea".
export function nivelDelCliente(texto) {
  // "nivel 6", y como lo escribe la gente: "level 6", "lvl6", "nv 6", "niv 6"
  // (2-oct-2026: "soy level 6" no se entendía y salía la tabla entera).
  const m = sinTildes(texto).match(/\b(?:nivel|level|lvl|niv|nv)\s*(\d+|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)\b/i);
  if (!m) return null;
  const valor = m[1].toLowerCase();
  return /^\d+$/.test(valor) ? Number(valor) : NUMEROS[valor];
}

// SOLO PREGUNTA SI HAY CASHEA (15-oct-2026, caso real en producción): "¿Tienes
// cashea??" a un cliente que ya había dicho "soy nivel 3" salía con SU nivel
// ("Con tu Nivel 3 te lo llevas con el 30%…") en vez del "¡Sí, trabajamos con
// Cashea!" con el mensaje completo que pidió el dueño (8-oct). El nivel del
// historial solo se usa cuando el cliente pide algo que depende de él: cuánto
// paga, la inicial, las cuotas, el precio, o si lo dice en este mensaje.
export function soloPreguntaSiHay(texto) {
  const t = sinTildes(texto);
  if (!/\b(?:c|k)a(?:s|c)?hea\b/i.test(t)) return false;
  if (nivelDelCliente(texto) !== null) return false;
  return !/\b(?:cuanto|cuantas?|queda|quedaria|inicial|cuotas?|pago|pagar|pagaria|monto|precio|cuenta|nivel|level|descuento|calcula\w*)\b|\d/i.test(t);
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
export function cuentaCashea(precio, porcentaje, ahora) {
  const leido = leerPrecio(precio);
  if (!leido || porcentaje === null || porcentaje === undefined) return null;

  // EL 0% DE INICIAL TAMBIÉN TIENE MÍNIMO (dueño, 30-sep-2026: "a partir de
  // 100$ es que se admite el 0% de inicial"). Por debajo no se hace la
  // cuenta con 0%: se avisa, y la inicial de ese par la confirma un asesor.
  const { minimo: minimoCero, minimoAlCero } = leer(ahora);
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
  const { cuotas: n, minimo } = leer(ahora);
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
export function textoDelMinimo(ahora) {
  const { minimo } = leer(ahora);
  return minimo ? `compras desde ${minimo}$` : "";
}

// La condición, con las palabras del dueño: "para optar por las 6 cuotas la
// compra debe ser de 100$ en adelante".
export function fraseDelMinimo(ahora) {
  const { minimo, minimoAlCero } = leer(ahora);
  if (!minimo) return "";
  const cuotas = "las " + (nombreDeLasCuotas(ahora) || "cuotas");
  const que = minimoAlCero ? "el cero por ciento de inicial y " + cuotas : cuotas;
  return "para optar por " + que + " la compra debe ser de " + minimo + "$ en adelante";
}

// "6 cuotas", o "6 cuotas sin interés" si pagos.txt lo dice. "" sin dato.
export function nombreDeLasCuotas(ahora) {
  const { cuotas, hastaCuotas, detalleCuotas } = leer(ahora);
  if (!cuotas) return "";
  return `${hastaCuotas ? "hasta " : ""}${cuotas} cuotas${detalleCuotas ? ` ${detalleCuotas}` : ""}`;
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
  const antes = fijado;
  fijado = ahora;
  try {
    return armarTarjeta({ nivel, productos, ahora });
  } finally {
    fijado = antes;
  }
}

function armarTarjeta({ nivel, productos, ahora }) {
  if (!hayCashea()) return "";
  if (!hayTablaCashea()) return tarjetaSinTabla(nivel);

  // CÓMO SUENA (14-oct-2026, dueño: "debe quedar más lógico y humano, se ve
  // muy robótico"). Como lo diría una vendedora: primero el sí, después la
  // promo en una frase (o, entre promos, las 3 cuotas una sola vez), los
  // niveles, la próxima promo como un aviso, y la pregunta del nivel. Sin
  // títulos sueltos ni la misma frase en cada renglón.
  const { titular, niveles, fechas, empieza, enBase, proxima } = leer();
  const pct = nivel ? inicialDelNivel(nivel) : null;
  const momento = momentoDeLaPromocion(ahora);
  const lasCuotas = nombreDeLasCuotas();
  const minimo = leer().minimo;
  const promo = String(titular || "").replace(/\s*🔥\s*$/, "").trim();
  // La condición del mínimo, solo si el titular no la dice ya.
  const condicion = minimo && lasCuotas && !promo.includes(String(minimo))
    ? `Para las ${lasCuotas}, la compra debe ser de ${minimo}$ o más.`
    : "";
  // "Y del 15 al 20 de octubre tenemos promo: …" (entre promos).
  const avisoDeLaProxima = enBase && proxima?.titular
    ? `👀 Y ${proxima.fechas} tenemos promo: ${String(proxima.titular).replace(/\s*🔥\s*$/, "")} 🔥`
    : "";
  // La de hoy, en una frase; o la que viene, si todavía no arranca.
  const laPromo = enBase || !promo
    ? ""
    : momento === "antes"
      ? `Y ojo 👀 ${fechas} tenemos promo: ${promo} 🔥 (arranca ${empieza})`
      : `Y llegaste en buen momento: ${fechas} tenemos promo, ${promo} 🔥`;

  // ── Sin nivel: el sí, la promo o las cuotas, los niveles y la pregunta.
  if (pct === null) {
    const tabla = [...niveles.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([n, v]) => `• Nivel ${n} → ${formatoPct(v)} de inicial${v === 0 ? " 🎉" : ""}`)
      .join("\n");
    const entrada = enBase
      ? `¡Sí, trabajamos con Cashea! 💜 Pagas una inicial según tu nivel${lasCuotas ? ` y el resto en ${lasCuotas}` : ""}:`
      : `¡Sí, trabajamos con Cashea! 💜 ${laPromo}`.trim();
    const aviso = nivel ? `No tengo el Nivel ${nivel} en la tabla de Cashea. ` : "";
    return [
      entrada,
      "",
      enBase ? null : "Tu inicial según tu nivel:",
      tabla,
      "",
      enBase ? null : condicion || null,
      enBase || !condicion ? null : "",
      avisoDeLaProxima || null,
      avisoDeLaProxima ? "" : null,
      aviso + "¿Qué nivel tienes en Cashea? Dímelo y te digo cuánto te toca de inicial 😉",
    ]
      .filter((l) => l !== null && l !== undefined)
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");
  }

  // ── Con nivel: LA CUENTA EN DINERO (14-oct-2026, dueño: "que saque las
  // cuentas de Cashea, a todos los clientes; quitemos esa restricción").
  // La hace ESTE código con el precio real del producto (cuentaCashea), no
  // la IA a ojo: es dinero. Antes se decía solo el porcentaje y "los montos
  // te los confirma un asesor".
  const condicionDelCero = minimo && leer().minimoAlCero ? ` en compras desde ${minimo}$` : "";
  // Los del mismo precio van en UNA cuenta con su nombre común ("Jordan 40"
  // en negro, blanco y rojo, a 120: una sola cuenta, no tres iguales).
  const porPrecio = new Map();
  for (const p of productos || []) {
    const cuenta = p?.titulo ? cuentaCashea(p.precio, pct ?? 0) : null;
    if (!cuenta) continue;
    const g = porPrecio.get(cuenta.precio) || { titulos: [], cuenta };
    g.titulos.push(String(p.titulo).trim());
    porPrecio.set(cuenta.precio, g);
  }
  const conCuenta = [...porPrecio.values()]
    .map(({ titulos, cuenta }) => ({ p: { titulo: titulos.length > 1 ? nombreComun(titulos) || titulos[0] : titulos[0] }, cuenta }))
    .slice(0, MAXIMO_EN_LA_CUENTA);
  const cuando = momento === "antes" && fechas ? ` ${mayuscula(fechas)},` : "";
  const hasta = !enBase && fechas && momento !== "antes" ? `⏳ La promo es ${fechas}, aprovéchala.` : "";
  const hoyNormal = !enBase && momento === "antes" ? "Y si lo quieres hoy, también puedes con Cashea, con la inicial normal de tu nivel 💜" : "";
  const { hastaCuotas, detalleCuotas } = leer();

  // Las cuotas de una cuenta, como se dicen: "3 cuotas sin interés de 28$",
  // "5 cuotas de 9.98$ y la última de 9.95$".
  const lasCuotasDe = (c) => {
    const extra = detalleCuotas ? ` ${detalleCuotas}` : "";
    const menos = hastaCuotas ? " (o en menos cuotas, si prefieres)" : "";
    return c.iguales
      ? `${c.cuantas} cuotas${extra} de ${c.cada}${menos}`
      : `${c.cuantas - 1} cuotas${extra} de ${c.cada} y la última de ${c.ultima}${menos}`;
  };
  const renglones = ({ p, cuenta }) => {
    if (cuenta.ceroSinMinimo) {
      return [`🛍️ ${p.titulo} — ${cuenta.precio}`, `• El 0% de inicial es en compras desde ${minimo}$: esta no llega todavía 😕`];
    }
    const lineas = [
      `🛍️ ${p.titulo} — ${cuenta.precio}`,
      pct === 0 ? "• Sin inicial (0%) 🎉" : `• Inicial (${formatoPct(pct)}): ${cuenta.inicial}`,
    ];
    if (!cuenta.alcanzaMinimo) {
      lineas.push(`• Las ${lasCuotas} son en compras desde ${minimo}$, y esta no llega todavía. Si le sumas otro producto, entra 😉`);
    } else if (cuenta.cuotas) {
      lineas.push(`• ${pct === 0 ? "Pagas" : "Luego"} ${lasCuotasDe(cuenta.cuotas)}`);
    } else if (cuenta.restoCifra > 0) {
      lineas.push(`• El resto, ${cuenta.resto}, en cuotas`);
    }
    return lineas;
  };

  // Sin producto a la vista: su porcentaje y le pide cuál, para la cuenta.
  if (!conCuenta.length) {
    const elResto = lasCuotas ? ` y el resto en ${lasCuotas}` : "";
    const encabezado =
      pct === 0
        ? `🎉 ¡Buenas noticias!${cuando} Con tu Nivel ${nivel} en Cashea pagas 0% de inicial${condicionDelCero}${elResto} 🙌`
        : `💜 ¡Perfecto!${cuando} Con tu Nivel ${nivel} en Cashea pagas el ${formatoPct(pct)} de inicial${elResto} 🙌`;
    return [
      encabezado,
      minimo && lasCuotas ? `Solo ten en cuenta que para las ${lasCuotas} la compra debe ser de ${minimo}$ o más.` : null,
      hasta || null,
      hoyNormal || null,
      avisoDeLaProxima ? "" : null,
      avisoDeLaProxima || null,
      "",
      "Dime cuál te gusta y te saco la cuenta exacta 😉",
    ]
      .filter((l) => l !== null)
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");
  }

  const encabezado =
    pct === 0
      ? `🎉 ¡Buenas noticias!${cuando} Con tu Nivel ${nivel} en Cashea no pagas inicial. Te queda así:`
      : `💜 ¡Perfecto!${cuando} Con tu Nivel ${nivel} en Cashea te queda así:`;
  const bloques = conCuenta.map((x) => renglones(x).join("\n"));
  return [
    encabezado,
    "",
    bloques.join("\n\n"),
    "",
    hasta || null,
    hoyNormal || null,
    avisoDeLaProxima || null,
    hasta || hoyNormal || avisoDeLaProxima ? "" : null,
    "¿Qué te parece? 😉",
  ]
    .filter((l) => l !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Lleva "en un momento" a propósito: así hayEscalada() avisa al asesor.
export const ASESOR_CONFIRMA_MONTOS = "los montos exactos de la inicial y de cada cuota te los confirma un asesor en un momento 😊";

const MARCA_PRODUCTO = "🛍️";

// Las palabras con las que empiezan TODOS los títulos: "Jordan 40 negro" y
// "Jordan 40 blanco" → "Jordan 40". Vacío si no comparten nada.
function nombreComun(titulos) {
  const partidos = titulos.map((t) => String(t).trim().split(/\s+/));
  const comun = [];
  for (let i = 0; i < partidos[0].length; i++) {
    const palabra = partidos[0][i];
    if (!partidos.every((p) => (p[i] || "").toLowerCase() === palabra.toLowerCase())) break;
    comun.push(palabra);
  }
  return comun.join(" ");
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
// Sin tabla, CUALQUIER porcentaje o "sin inicial" hablando de Cashea es
// inventado: esta tienda no tiene 0% (ni ningún otro número cargado).
const SIN_INICIAL = /\b(?:sin|0|cero)\s*%?\s*(?:de\s+)?inicial\b|\binicial\s+(?:de\s+)?(?:0|cero)\b/i;

// Un monto de dinero pegado a la inicial o a las cuotas ("inicial de 36$",
// "6 cuotas de 20 USD", "pagas 14$ por cuota"). La IA no los escribe a ojo:
// la cuenta la saca el sistema con el precio real (14-oct-2026).
const MONTO_DE_CASHEA =
  /\b(?:inicial|cuotas?)\b[^.!?\n]{0,30}?(?:\$\s*\d|\d+(?:[.,]\d+)?\s*(?:\$|usd|d[oó]lares?|bs\.?|bol[ií]vares))|(?:\$\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*(?:\$|usd|d[oó]lares?))[^.!?\n]{0,25}?\b(?:de\s+inicial|por\s+cuota|cada\s+cuota|en\s+cuotas|mensual|quincenal)/i;

export function revisarCashea(respuesta, ahora = Date.now()) {
  const antes = fijado;
  fijado = ahora;
  try {
    return revisar(respuesta, ahora);
  } finally {
    fijado = antes;
  }
}

function revisar(respuesta, ahora) {
  const texto = String(respuesta || "");
  // La condición de la promoción ("la compra debe ser de 100$ en adelante")
  // no es un monto que se le promete: se quita antes de mirar.
  const sinCondicion = texto.replace(
    /(?:la\s+compra\s+)?debe\s+ser\s+de\s+\d+\s*\$?\s*(?:usd\s*)?en\s+adelante|\b(?:desde|a\s+partir\s+de)\s+\d+\s*(?:\$|usd|d[oó]lares)|\bde\s+\d+\s*\$\s+en\s+adelante/gi,
    ""
  );
  if (hayCashea() && MONTO_DE_CASHEA.test(sinCondicion) && /\b(?:c|k)a(?:s|c)?hea\b|\binicial\b|\bcuotas?\b/i.test(texto)) {
    // Las cuentas las saca el sistema con el precio real (14-oct-2026): la
    // frase de la IA con cifras se quita y va la tarjeta con la cuenta de
    // verdad (index.js la arma con su nivel y sus productos: conCuenta).
    console.error("CASHEA: la IA escribió montos de la inicial o las cuotas. Va la cuenta que saca el sistema.");
    return { respuesta: "¡Claro que sí! 🙌", corregido: true, conCuenta: true, motivos: ["monto de dinero de Cashea: va la cuenta del sistema"] };
  }
  if (hayCashea() && !hayTablaCashea()) {
    const hablaDeCashea = /\b(?:c|k)a(?:s|c)?hea\b|\binicial\b|\bnivel\s*\d/i.test(texto);
    if (hablaDeCashea && (/\d\s*%/.test(texto) || SIN_INICIAL.test(texto))) {
      console.error("CASHEA: escribió un porcentaje o un 'sin inicial' y esta tienda no tiene tabla. Va la tarjeta.");
      return { respuesta: tarjetaCashea(), corregido: true, motivos: ["porcentaje de Cashea sin tabla"] };
    }
    return { respuesta: texto, corregido: false };
  }
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
