// CUÁNTO LE QUEDA CON CASHEA, HECHO POR EL CÓDIGO (6-oct-2026).
//
// EL FALLO (informe de errores del 6-oct, 4 casos). La tabla de pagos
// termina con "Dime tu nivel y te digo cuánto te queda de inicial 👌". El
// cliente lo decía —"estoy en nivel 3, ¿en cuánto me quedan las cuotas?"—
// y la IA, que tiene prohibido hacer la cuenta (y bien prohibido: un 30%
// mal calculado es una venta que se cae en caja), escribía las cifras de
// todos modos. La red de precios las veía inventadas y dejaba "¡Con gusto!
// Mira los precios 👇". Es decir: se le prometió la cuenta y no se le dio.
//
// La IA sigue SIN hacer cuentas. La hace el código, que no se equivoca:
//   · el precio es el de Cashea de la hoja (el que sale en la ficha);
//   · la inicial es el % de su nivel (la misma tabla que PAGOS_CASHEA);
//   · el resto, en 3 cuotas iguales, una cada 14 días.
// Sin nivel, se le dan los 6 niveles con su monto y se le pregunta cuál es.
//
// KRECE NO SE CALCULA: la hoja no dice sobre qué precio va la inicial de
// Krece ni si las cuotas llevan recargo. Ahí se dice el % y las cuotas de
// su nivel, y el monto lo confirma un asesor (y se le avisa).

export const INICIAL_CASHEA = { 1: 60, 2: 50, 3: 30, 4: 25, 5: 20, 6: 20 };
export const CUOTAS_CASHEA = 3;

export const KRECE = {
  azul: { nombre: "Azul", emoji: "🔵", inicial: 30, cuotas: 6 },
  plata: { nombre: "Plata", emoji: "⚪", inicial: 25, cuotas: 8 },
  oro: { nombre: "Oro", emoji: "🟡", inicial: 20, cuotas: 8 },
  platino: { nombre: "Platino", emoji: "💎", inicial: 15, cuotas: 10 },
};

const NOMBRA_KRECE = /\b(krece|kreze|crece|creze|kresce)\b/i;
const NOMBRA_CASHEA = /\b(cashea|cashe|kashea|cachea)\b/i;
const COLOR_KRECE = /\b(azul|plata|oro|platino)\b/i;

// Pregunta por cuánto le queda: la inicial, las cuotas. Un "¿cuánto
// sale?" a secas NO: eso es el precio, y va en la ficha.
const PIDE_LA_CUENTA = /\b(?:inicial|cuotas?)\b/i;
const COMO_QUEDA = /\b(?:c[oó]mo\s+(?:me\s+)?queda|cu[aá]nto\s+(?:me\s+)?(?:queda|quedan|pago|pagar[ií]a|ser[ií]a)|precio\s+con)\b/i;

// Nivel de Cashea: "nivel 3", "lvl 3", "soy nivel 3 de cashea", "nv3".
// Los números son de Cashea; los colores, de Krece (ver texto.txt).
export function nivelDeCashea(texto) {
  const t = String(texto || "");
  if (NOMBRA_KRECE.test(t) && !NOMBRA_CASHEA.test(t)) return null;
  const m = t.match(/\b(?:nivel|level|lvl|niv|nv)\s*([1-6])\b/i);
  return m ? Number(m[1]) : null;
}

// Nivel de Krece: un color dicho como nivel ("platino de krece", "soy oro",
// "nivel plata"). Un "azul" suelto puede ser el color del teléfono: hace
// falta que diga Krece, "nivel" o "soy". Y el "nivel inicial / básico /
// primer nivel" de Krece es el Azul (7-oct-2026, caso real).
export function nivelDeKrece(texto) {
  const t = String(texto || "");
  const color = t.match(COLOR_KRECE)?.[1]?.toLowerCase();
  if (color) {
    const esNivel = NOMBRA_KRECE.test(t) || new RegExp(`\\b(?:nivel|soy|estoy\\s+en)\\s+(?:el\\s+)?${color}\\b`, "i").test(t);
    if (esNivel) return color;
  }
  if (NOMBRA_KRECE.test(t) && /\b(?:nivel\s+(?:inicial|b[aá]sico|1|uno)|primer\s+nivel|reci[eé]n\s+empiezo|nuevo\s+en)\b/i.test(t)) return "azul";
  return null;
}

// El nivel de Cashea que ya dijo antes, si la conversación lo guarda
// ("Es nivel 3 de Cashea").
export function nivelEnElHistorial(historial) {
  const t = String(historial || "");
  if (!NOMBRA_CASHEA.test(t)) return null;
  const todos = [...t.matchAll(/\bnivel\s*([1-6])\b/gi)];
  return todos.length ? Number(todos[todos.length - 1][1]) : null;
}

export function precioComoNumero(precio) {
  const limpio = String(precio || "").replace(/[^\d.,]/g, "");
  if (!limpio) return null;
  // "1.250,50" y "1,250.50" → 1250.5; "182.00" → 182; "182" → 182.
  const normal = limpio.replace(/[.,](?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const n = Number(normal);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// $54.60 — siempre con dos decimales: son montos que se pagan.
export function dinero(n) {
  return `$${(Math.round(n * 100) / 100).toFixed(2)}`;
}

export function planCashea(precio, nivel) {
  const pct = INICIAL_CASHEA[nivel];
  if (!pct || !Number.isFinite(precio)) return null;
  const inicial = Math.round(precio * pct) / 100;
  const cuota = Math.round(((precio - inicial) / CUOTAS_CASHEA) * 100) / 100;
  return { nivel, pct, inicial, cuota };
}

// Lo que contesta el código, o null si no le toca (no pide la cuenta, no se
// sabe de qué equipo habla, o el equipo no tiene precio Cashea en la hoja).
//   texto:     lo que escribió ahora
//   historial: la conversación guardada (para un nivel dicho antes)
//   equipo:    el producto del que habla ({ titulo, precioCashea })
// LO QUE SE LE DICE DE KRECE: su nivel, o la tabla entera. El monto con
// Krece lo confirma un asesor: la hoja no dice sobre qué precio va.
function respuestaKrece(equipo, color) {
  const delEquipo = equipo?.titulo ? ` del ${equipo.titulo}` : "";
  if (color) {
    const k = KRECE[color];
    return {
      respuesta:
        `Con Krece nivel ${k.nombre} ${k.emoji} la inicial es del ${k.inicial}% y el resto en ${k.cuotas} cuotas.\n\n` +
        `El monto exacto${delEquipo} con Krece te lo confirma un asesor en un momento 😊`,
      asesor: true,
      motivo: `Krece nivel ${k.nombre}: % y cuotas; el monto, al asesor`,
    };
  }
  const tabla = Object.values(KRECE).map((k) => `${k.emoji} ${k.nombre} — ${k.inicial}% inicial · ${k.cuotas} cuotas`).join("\n");
  return {
    respuesta:
      `Con Krece la inicial y las cuotas van por nivel 👇\n\n${tabla}\n\n` +
      `El monto exacto${delEquipo} con Krece te lo confirma un asesor en un momento 😊 ¿En qué nivel estás?`,
    asesor: true,
    motivo: "Krece sin nivel: la tabla; el monto, al asesor",
  };
}

// ¿Está PREGUNTANDO (o diciendo su nivel)? "Gracias… aún no tengo la
// inicial" o "esperaré a 6 cuotas" no piden ninguna cuenta (7-oct-2026:
// a las dos se les mandó la tabla de Cashea).
const PREGUNTA = /\?|\b(?:cu[aá]nto|cu[aá]nta|cu[aá]ntas|c[oó]mo|cu[aá]l|qu[eé]|precio|pre[cxs]io|monto|sale|saldr[ií]a|queda|quedan|quedar[ií]a)\b/i;
const NO_PREGUNTA = /\b(?:gracias|me\s+pondr[eé]|esperar[eé]|luego\s+te|despu[eé]s\s+te|lo\s+pienso|ok|listo|dale)\b/i;

// ¿De qué plataforma viene hablando? La última que nombró la charla.
function plataformaDeLaCharla(historial) {
  const t = String(historial || "").toLowerCase();
  const k = Math.max(t.lastIndexOf("krece"), t.lastIndexOf("crece"));
  const c = t.lastIndexOf("cashea");
  if (k < 0 && c < 0) return "";
  return k > c ? "krece" : "cashea";
}

export function contestarCuotas({ texto = "", historial = "", equipo = null } = {}) {
  const t = String(texto || "");
  if (/\b(divisas?|d[oó]lares?|usd|contado|efectivo|bol[ií]vares|bs)\b/i.test(t)) return null;

  const hablaDeCashea = NOMBRA_CASHEA.test(t);
  const hablaDeKrece = NOMBRA_KRECE.test(t);
  const krece = nivelDeKrece(t);
  const nivelAhora = nivelDeCashea(t);
  const palabras = t.trim().split(/\s+/).filter(Boolean);
  // "Cashea" o "¿y Krece?" a secas, con un equipo delante: cómo le queda.
  const soloLaPlataforma = (hablaDeCashea || hablaDeKrece) && palabras.length <= 3;
  const diceSuNivel = nivelAhora !== null || krece !== null;
  const pregunta = PREGUNTA.test(t) && !(NO_PREGUNTA.test(t) && !/\?/.test(t));
  const pide =
    diceSuNivel ||
    soloLaPlataforma ||
    (pregunta && (PIDE_LA_CUENTA.test(t) || ((hablaDeCashea || hablaDeKrece) && (COMO_QUEDA.test(t) || PREGUNTA.test(t)))));
  if (!pide) return null;

  // KRECE: si lo nombra (o pide más de 3 cuotas, que solo da Krece).
  const cuotasPedidas = Number(t.match(/\b(\d{1,2})\s+cuotas\b/i)?.[1]) || 0;
  const esKrece = krece !== null || (hablaDeKrece && !hablaDeCashea) || (cuotasPedidas > CUOTAS_CASHEA && !hablaDeCashea);
  // Con su nivel de Krece se le contesta aunque no se sepa el equipo.
  if (esKrece && (equipo?.titulo || krece)) return respuestaKrece(equipo, krece);
  if (!equipo?.titulo) return null;
  if (esKrece) return respuestaKrece(equipo, krece);

  // "Nivel 6" a secas: los niveles con NÚMERO son solo de Cashea (Krece
  // va por colores y no tiene nivel 6). Se contesta con Cashea, que es lo
  // correcto (7-oct-2026, dueño: "está bien respondido, déjalo"). Si venía
  // hablando de Krece, se le aclara en una línea, sin dejar de contestarle.
  const aclaraKrece =
    nivelAhora !== null && !hablaDeCashea && plataformaDeLaCharla(historial) === "krece"
      ? "\n\n(Los niveles con número son de Cashea; en Krece van por color: 🔵 Azul, ⚪ Plata, 🟡 Oro y 💎 Platino.)"
      : "";

  const precio = precioComoNumero(equipo.precioCashea);
  if (!precio) return null;
  const nivel = nivelAhora ?? nivelEnElHistorial(historial);

  if (nivel) {
    const p = planCashea(precio, nivel);
    return {
      respuesta:
        `Con nivel ${nivel} de Cashea, el ${equipo.titulo} (${dinero(precio)}) te queda así 👇\n\n` +
        `🔹 Inicial (${p.pct}%): ${dinero(p.inicial)}\n` +
        `🔹 ${CUOTAS_CASHEA} cuotas de ${dinero(p.cuota)}, una cada 14 días, sin intereses\n\n` +
        "El monto exacto lo ves en tu app de Cashea al comprar 😊 ¿Te lo aparto?" +
        aclaraKrece,
      asesor: false,
      motivo: `Cashea nivel ${nivel}: inicial y cuotas calculadas por el código`,
    };
  }

  const lineas = Object.keys(INICIAL_CASHEA).map((n) => {
    const p = planCashea(precio, Number(n));
    return `🔹 Nivel ${n} — inicial ${dinero(p.inicial)} + ${CUOTAS_CASHEA} cuotas de ${dinero(p.cuota)}`;
  });
  // Preguntó por las dos ("¿por Cashea o Krece?"): las dos.
  const yKrece = hablaDeKrece
    ? `\n\nY con Krece: ${Object.values(KRECE).map((k) => `${k.emoji} ${k.nombre} ${k.inicial}%·${k.cuotas} cuotas`).join(" · ")}. El monto con Krece te lo confirma un asesor 😊`
    : "";
  return {
    respuesta:
      `El ${equipo.titulo} está en ${dinero(precio)} con Cashea 📱 Te queda así según tu nivel 👇\n\n` +
      `${lineas.join("\n")}\n\n` +
      `Las cuotas van cada 14 días, sin intereses.${yKrece} ¿Cuál es tu nivel? 😊`,
    asesor: Boolean(yKrece),
    motivo: `Cashea sin nivel: los 6 niveles con su monto, calculados por el código${yKrece ? " (y Krece, al asesor)" : ""}`,
  };
}

// De qué equipo habla, para la cuenta: UNO solo. El del carrusel de este
// mensaje; si no hay, el del anuncio; si no, el último que vio (si fue uno).
export function equipoDeLaCuenta({ productos = [], productoAnuncio = null, recientes = [] } = {}) {
  const distintos = (lista) => [...new Map(lista.filter(Boolean).map((p) => [String(p.titulo).toLowerCase(), p])).values()];
  const ahora = distintos(productos);
  if (ahora.length === 1) return ahora[0];
  if (ahora.length > 1) return null;
  if (productoAnuncio) return productoAnuncio;
  const antes = distintos(recientes);
  return antes.length === 1 ? antes[0] : null;
}
