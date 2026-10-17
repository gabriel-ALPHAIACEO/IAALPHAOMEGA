// LA MEDICIÓN DEL GASTO DE OPENAI.
//
// QUÉ SE PROTEGE. Dos cosas, y la segunda importa más que la primera:
//
//   1. Que la cuenta esté bien. Un gasto mal medido es peor que no medirlo:
//      lleva a recortar lo que no hacía falta y a dejar suelto lo caro.
//   2. Que medir NUNCA deje a un cliente sin respuesta. Esto corre dentro
//      de cada llamada a OpenAI: si un fallo al anotar se propagara, una
//      base de datos con un problema tumbaría las ventas del día.

import { prepararSrc, baseDeMentira, baseCaida, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const { anotarGasto, gastoDelMes, costeDe } = await src.cargar("gasto.js");

// Las tarifas publicadas por OpenAI, por millón de tokens. Están repetidas
// acá a propósito: si alguien cambia la tabla de gasto.js por error, la
// prueba lo canta en vez de dar por bueno el número nuevo.
const MINI_ENTRADA = 0.15;
const CUATRO_ENTRADA = 2.5;
const CUATRO_SALIDA = 10;

titulo("la cuenta de una llamada");

ok(
  Math.abs(costeDe({ modelo: "gpt-4o", entrada: 10000, salida: 200 }) -
    (10000 * CUATRO_ENTRADA / 1e6 + 200 * CUATRO_SALIDA / 1e6)) < 1e-9,
  "4o: entrada a $2,50 y salida a $10,00 el millón"
);
ok(costeDe({ modelo: "gpt-4o-mini", entrada: 1e6 }) === MINI_ENTRADA, "mini: $0,15 el millón de entrada");
ok(costeDe({ modelo: "gpt-4o-mini-2024-07-18", entrada: 1e6 }) === MINI_ENTRADA, "una variante con fecha usa su tarifa");
ok(costeDe({ modelo: "un-modelo-que-no-existe", entrada: 1e6 }) === CUATRO_ENTRADA, "uno desconocido se cobra como el caro (prudente)");
ok(costeDe({}) === 0, "una llamada sin datos cuesta cero, no NaN");

titulo("el descuento de caché");

const entero = costeDe({ modelo: "gpt-4o", entrada: 10000 });
const mitad = costeDe({ modelo: "gpt-4o", entrada: 10000, cacheadas: 10000 });
ok(mitad === entero / 2, "todo cacheado cuesta la mitad", `$${entero.toFixed(4)} → $${mitad.toFixed(4)}`);
ok(costeDe({ modelo: "gpt-4o", entrada: 10000, cacheadas: 4000 }) > mitad, "cacheado a medias, algo en medio");
ok(
  costeDe({ modelo: "gpt-4o", entrada: 10000, cacheadas: 10000 }) < entero,
  "las cacheadas NO se cobran dos veces (vienen dentro de prompt_tokens)"
);
ok(costeDe({ modelo: "gpt-4o", entrada: 100, cacheadas: 500 }) >= 0, "más cacheadas que entrada no da negativo");

titulo("se suma por mes y por modelo");

const env = baseDeMentira();
// Una foto de verdad: identificar en 4o + dos cotejos en 4o + redactar en mini.
await anotarGasto(env, { modelo: "gpt-4o", entrada: 13583, salida: 200 });
await anotarGasto(env, { modelo: "gpt-4o", entrada: 2804, cacheadas: 896, salida: 300 });
await anotarGasto(env, { modelo: "gpt-4o", entrada: 2804, cacheadas: 896, salida: 300 });
await anotarGasto(env, { modelo: "gpt-4o-mini", entrada: 25027, salida: 150 });

const g = await gastoDelMes(env);
ok(g.filas.length === 2, "dos modelos en la tabla", g.filas.map((f) => f.modelo).join(" / "));
const cuatro = g.filas.find((f) => f.modelo === "gpt-4o");
ok(cuatro.llamadas === 3, "tres llamadas al 4o");
ok(cuatro.entrada === 13583 + 2804 * 2, "suma bien la entrada", String(cuatro.entrada));
ok(cuatro.cacheadas === 1792, "y las cacheadas");
ok(g.filas[0].modelo === "gpt-4o", "el más caro sale primero");
ok(g.total > 0.01 && g.total < 1, "un total creíble para una foto", `$${g.total.toFixed(4)}`);
ok(g.proyectado >= g.total, "el proyectado del mes nunca es menor que lo ya gastado");
ok(g.dias >= 1 && g.dias <= 31 && g.delMes >= 28, "los días del mes tienen sentido", `${g.dias} de ${g.delMes}`);

titulo("el 4o es donde está el dinero");

const porcentaje = (cuatro.dolares / g.total) * 100;
ok(porcentaje > 80, `el 4o se lleva el ${porcentaje.toFixed(0)}% de una foto`);

titulo("medir NO puede tumbar al bot");

let lanzo = false;
try {
  await anotarGasto(baseCaida(), { modelo: "gpt-4o", entrada: 10 });
} catch {
  lanzo = true;
}
ok(!lanzo, "con la base de datos caída, anotar no lanza");
ok((await gastoDelMes(baseCaida())) === null, "leer con la base caída devuelve null, no revienta");
ok((await gastoDelMes({})) === null, "sin DB devuelve null");
ok(typeof (await anotarGasto({}, { modelo: "gpt-4o", entrada: 10 })) === "number", "y sin DB igual calcula el coste");

src.limpiar();
terminar();
