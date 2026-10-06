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
// falta que diga Krece, "nivel" o "soy".
export function nivelDeKrece(texto) {
  const t = String(texto || "");
  const color = t.match(COLOR_KRECE)?.[1]?.toLowerCase();
  if (!color) return null;
  const esNivel = NOMBRA_KRECE.test(t) || new RegExp(`\\b(?:nivel|soy|estoy\\s+en)\\s+(?:el\\s+)?${color}\\b`, "i").test(t);
  return esNivel ? color : null;
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
export function contestarCuotas({ texto = "", historial = "", equipo = null } = {}) {
  const t = String(texto || "");
  const krece = nivelDeKrece(t);
  const nivelAhora = nivelDeCashea(t);
  const hablaDeCashea = NOMBRA_CASHEA.test(t);
  const pide = PIDE_LA_CUENTA.test(t) || nivelAhora !== null || krece !== null || (hablaDeCashea && COMO_QUEDA.test(t));
  if (!pide || !equipo?.titulo) return null;
  if (/\b(divisas?|d[oó]lares?|usd|contado|efectivo|bol[ií]vares|bs)\b/i.test(t)) return null;

  if (krece) {
    const k = KRECE[krece];
    return {
      respuesta:
        `Con Krece nivel ${k.nombre} ${k.emoji} la inicial es del ${k.inicial}% y el resto en ${k.cuotas} cuotas.\n\n` +
        `El monto exacto del ${equipo.titulo} con Krece te lo confirma un asesor en un momento 😊`,
      asesor: true,
      motivo: `Krece nivel ${k.nombre}: % y cuotas; el monto, al asesor`,
    };
  }

  // Sin Cashea nombrado ni nivel numérico ni Krece: "¿cuántas cuotas?" a
  // secas también es Cashea (es el precio que ve en la ficha).
  if (NOMBRA_KRECE.test(t) && !hablaDeCashea) return null;

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
        "El monto exacto lo ves en tu app de Cashea al comprar 😊 ¿Te lo aparto?",
      asesor: false,
      motivo: `Cashea nivel ${nivel}: inicial y cuotas calculadas por el código`,
    };
  }

  const lineas = Object.keys(INICIAL_CASHEA).map((n) => {
    const p = planCashea(precio, Number(n));
    return `🔹 Nivel ${n} — inicial ${dinero(p.inicial)} + ${CUOTAS_CASHEA} cuotas de ${dinero(p.cuota)}`;
  });
  return {
    respuesta:
      `El ${equipo.titulo} está en ${dinero(precio)} con Cashea 📱 Te queda así según tu nivel 👇\n\n` +
      `${lineas.join("\n")}\n\n` +
      "Las cuotas van cada 14 días, sin intereses. ¿Cuál es tu nivel? 😊",
    asesor: false,
    motivo: "Cashea sin nivel: los 6 niveles con su monto, calculados por el código",
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
