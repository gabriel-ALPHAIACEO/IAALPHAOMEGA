// EL RASTRO DE INSTAGRAM (1-oct-2026).
//
// QUÉ SE PEDÍA. "Que responda en Instagram." Cuando el bot no contesta, el
// fallo puede estar en cinco sitios distintos y desde fuera se ven igual:
//
//   1. Meta no manda nada (la cuenta no está suscrita al webhook).
//   2. Meta manda, pero la firma no cuadra (la clave secreta equivocada).
//   3. Llega y la firma cuadra, pero se descarta (no era un mensaje).
//   4. Se atiende, pero Instagram rechaza el envío (el IG_TOKEN).
//   5. Todo bien.
//
// Este archivo guarda en D1 la ÚLTIMA vez que pasó cada cosa, y
// /probar-instagram lo enseña. Así se sabe en qué paso se corta sin tener
// que estar mirando `wrangler tail` cuando llega el mensaje.
//
// Una fila por paso (se pisa a sí misma): no crece nunca.

const TABLA = `
  CREATE TABLE IF NOT EXISTS rastro (
    paso TEXT PRIMARY KEY,
    cuando INTEGER NOT NULL,
    detalle TEXT NOT NULL DEFAULT ''
  )`;

let tablaLista = false;

async function asegurarTabla(db) {
  if (tablaLista) return;
  await db.prepare(TABLA).run();
  tablaLista = true;
}

// UNA ESCRITURA CADA 10 SEGUNDOS POR PASO, como mucho (5-oct-2026). El
// webhook es público: cualquiera puede mandarle avisos falsos, y cada uno
// escribía en D1 (el plan gratis tiene un tope de escrituras al día). Para
// saber "cuándo fue la última vez" sobra con eso, y de paso un turno con
// dos envíos gasta una escritura menos.
const CADA_MS = 10000;
const ultimaVez = new Map();

// Nunca rompe nada: si D1 falla, el bot sigue atendiendo igual.
export async function anotar(env, paso, detalle = "") {
  if (!env?.DB) return;
  const ahora = Date.now();
  if (ahora - (ultimaVez.get(paso) || 0) < CADA_MS) return;
  ultimaVez.set(paso, ahora);
  try {
    await asegurarTabla(env.DB);
    await env.DB.prepare(
      "INSERT INTO rastro (paso, cuando, detalle) VALUES (?, ?, ?) " +
        "ON CONFLICT(paso) DO UPDATE SET cuando = excluded.cuando, detalle = excluded.detalle"
    )
      .bind(paso, Date.now(), String(detalle).slice(0, 400))
      .run();
  } catch (error) {
    console.error("rastro:", error.message);
  }
}

export async function leerRastro(env) {
  if (!env?.DB) return {};
  try {
    await asegurarTabla(env.DB);
    const { results } = await env.DB.prepare("SELECT paso, cuando, detalle FROM rastro").all();
    return Object.fromEntries((results || []).map((f) => [f.paso, f]));
  } catch {
    return {};
  }
}

export function hace(cuando, ahora = Date.now()) {
  if (!cuando) return "nunca";
  const min = Math.round((ahora - cuando) / 60000);
  if (min < 1) return "hace menos de un minuto";
  if (min < 60) return `hace ${min} min`;
  const horas = Math.round(min / 60);
  if (horas < 48) return `hace ${horas} h`;
  return `hace ${Math.round(horas / 24)} días`;
}

// Solo para las pruebas.
export function olvidarTabla() {
  tablaLista = false;
  ultimaVez.clear();
}
