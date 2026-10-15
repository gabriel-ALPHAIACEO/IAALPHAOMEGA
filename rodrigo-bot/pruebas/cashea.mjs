// CASHEA EN RODRIGO (15-oct-2026): todavía no la ha cargado. Con la sección
// [CASHEA] de pagos.txt vacía, el bot no promete nada: pasa Cashea a un
// asesor y no sale ninguna tarjeta ni cuenta. El código de las cuentas es el
// de El Emperador (probado allá): el día que Rodrigo llene la sección,
// funciona igual. Aquí se prueba que, vacía, no inventa nada, y que llenarla
// la enciende.

import { prepararSrc, ok, titulo, terminar } from "./ayuda.mjs";

titulo("la sección [CASHEA] vacía: nada que prometer");
{
  const src = await prepararSrc();
  const C = await src.cargar("cashea.js");
  ok(C.hayCashea() === false, "no hay Cashea cargada");
  ok(C.casheaVigente() === false, "no está vigente");
  ok(C.tarjetaCashea({}) === "" && C.tarjetaCashea({ nivel: 3 }) === "", "ninguna tarjeta, con o sin nivel");
  ok(C.revisarCashea("Con Cashea pagas solo el 10% de inicial 😊").corregido === false, "la red no toca lo que escriba el modelo (no hay tabla con la que compararlo)");
  ok(C.preguntaPorCashea("tienes cashea?") === true && C.nivelDelCliente("soy nivel 3") === 3, "pero sí entiende cuándo le preguntan por Cashea y su nivel");
  src.limpiar();
}

titulo("llenarla la enciende (con el mismo código de El Emperador)");
{
  const PAGOS = "[METODOS]\n\n[TASA]\n\n[CASHEA]\nCuotas: 3 sin interés\nNivel 1: 50%\nNivel 2: 40%\nNivel 3: 30%\nNivel 4: 20%\nNivel 5: 10%\nNivel 6: 0%\n";
  const src = await prepararSrc({ txt: { "prompts/pagos.txt": PAGOS } });
  const C = await src.cargar("cashea.js");
  ok(C.hayCashea() && C.casheaVigente(), "con la tabla puesta, hay Cashea (sin fechas: vale siempre)");
  ok(C.inicialDelNivel(3) === 30 && C.inicialDelNivel(6) === 0, "Nivel 3 → 30%, Nivel 6 → 0%");
  const t = C.tarjetaCashea({});
  ok(/trabajamos con Cashea/.test(t) && /Nivel 1 → 50% de inicial/.test(t) && /Nivel 6 → 0% de inicial/.test(t), "la tarjeta sin nivel dice que sí y enseña la tabla", t.slice(0, 160));
  const r = C.tarjetaCashea({ nivel: 3, productos: [{ titulo: "Jordan 4 Retro", precio: 120 }] });
  ok(/Inicial \(30%\): 36/.test(r) && /3 cuotas/.test(r), "con nivel y producto, la cuenta en dinero (120$ al 30% → 36$)", r.slice(0, 200));
  ok(C.revisarCashea("Con Nivel 3 pagas el 50% de inicial", Date.now(), { nivel: 3 }).corregido, "y la red corrige un porcentaje que no es el del nivel");
  src.limpiar();
}

terminar();
