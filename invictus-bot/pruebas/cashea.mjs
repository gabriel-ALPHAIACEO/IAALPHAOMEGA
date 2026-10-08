// CASHEA Y LA UBICACIÓN: las cuentas, las fechas y qué cuenta como pregunta.
//
// QUÉ SE PROTEGE (30-sep-2026).
//
//   · Las cuentas de Cashea son dinero. 30% de 90 USD son 27 USD, y la
//     inicial más el resto tienen que sumar EXACTAMENTE el precio.
//   · La promoción tiene fecha (del 1 al 6 de octubre). Antes, se anuncia; después, el
//     bot no puede ofrecer esos porcentajes.
//   · La ubicación sale TAL CUAL, con su botón, y solo cuando preguntan por
//     la tienda — no cuando el cliente da SU dirección para un envío, ni
//     cuando pide la tienda online.
//
// Las pruebas no saben de qué tienda son: leen la tabla de pagos.txt y el
// texto de ubicacion.txt, y comprueban contra eso.

import fs from "node:fs";
import path from "node:path";
import { prepararSrc, ok, titulo, terminar } from "./ayuda.mjs";

// (7-oct-2026) La promoción del 1 al 6 de octubre terminó y pagos.txt
// tiene ahora la tabla normal. Estas pruebas siguen probando la MÁQUINA de
// las promociones (fechas, 0%, mínimo, 6 cuotas) con aquella promoción
// guardada en pruebas/datos/: si vuelve una, tiene que funcionar igual.
// La tabla de hoy se prueba al final, con el pagos.txt de verdad.
const PROMO = fs.readFileSync(path.join(import.meta.dirname, "datos", "pagos-promo-oct.txt"), "utf8");
const src = await prepararSrc({ txt: { "prompts/pagos.txt": PROMO } });
const C = await src.cargar("cashea.js");
const U = await src.cargar("ubicacion.js");

const EN_FECHA = Date.parse("2026-10-03T12:00:00-04:00");

// ───────────────────────────────────────────────────────────────────────
titulo('"X cuanto me lo dejan en cashea soy level 6" (caso real, 2-oct)');
{
  const t = "X cuanto me lo dejan en cashea soy level 6";
  ok(C.preguntaPorCashea(t), "es una pregunta de Cashea");
  ok(C.nivelDelCliente(t) === 6, '"level 6" es el Nivel 6', String(C.nivelDelCliente(t)));
  for (const [frase, n] of [["lvl 4", 4], ["nv 5", 5], ["niv 3", 3], ["nivel6", 6], ["soy nivel tres", 3]]) {
    ok(C.nivelDelCliente(frase) === n, `"${frase}" → Nivel ${n}`);
  }
  const DIA = Date.parse("2026-10-02T12:00:00-04:00");
  const tres = [
    { titulo: "Jordan 40 negro caballero", precio: "120 USD" },
    { titulo: "Jordan 40 blanco caballero", precio: "120 USD" },
    { titulo: "Jordan 40 rojo caballero", precio: "120 USD" },
  ];
  const tarjeta = C.tarjetaCashea({ nivel: 6, productos: tres, ahora: DIA });
  ok(/Nivel 6/.test(tarjeta) && /0% de inicial/.test(tarjeta), "le contesta con SU nivel (0% de inicial), no con la tabla", tarjeta.split("\n")[0]);
  ok(!/Bajada de inicial/.test(tarjeta), "sin la tabla entera de niveles");
  ok((tarjeta.match(/Jordan 40/g) || []).length === 1 && !/\d+\s*USD/.test(tarjeta), "nombra el Jordan 40 UNA vez, y sin montos de dinero", tarjeta.replace(/\n/g, " | "));
  ok(/6 cuotas/.test(tarjeta) && /asesor/.test(tarjeta), "las 6 cuotas sí; los montos, el asesor");
}

titulo("la tabla se lee de pagos.txt");

ok(C.hayCashea(), "Cashea está cargado");
ok(C.inicialDelNivel(1) === 50 && C.inicialDelNivel(3) === 30 && C.inicialDelNivel(6) === 0,
   "Nivel 1 → 50%, Nivel 3 → 30%, Nivel 6 → 0%");
ok(C.inicialDelNivel(7) === null, "un nivel que no existe no se inventa");

// ───────────────────────────────────────────────────────────────────────
titulo("la vigencia: del 1 al 6 de octubre, hora de Venezuela — y ANTES también contesta");

const hora = (iso) => Date.parse(iso);
const HOY = hora("2026-09-30T19:00:00-04:00");
const EN = hora("2026-10-03T12:00:00-04:00");
ok(C.momentoDeLaPromocion(hora("2026-09-30T23:59:00-04:00")) === "antes", "el 30 de septiembre a las 23:59: todavía no empezó");
ok(C.momentoDeLaPromocion(hora("2026-10-01T00:00:00-04:00")) === "vigente", "el 1 de octubre a las 00:00: en fecha");
ok(C.momentoDeLaPromocion(hora("2026-10-06T23:59:00-04:00")) === "vigente", "el 6 de octubre a las 23:59: todavía en fecha");
ok(C.momentoDeLaPromocion(hora("2026-10-07T00:00:01-04:00")) === "despues", "el 7 de octubre: ya terminó");
ok(C.casheaVigente(HOY), "HOY (antes de empezar) el bot SÍ contesta Cashea (pedido del dueño)");
ok(!C.casheaVigente(hora("2026-10-07T00:00:01-04:00")), "después del 6, al asesor");

// ───────────────────────────────────────────────────────────────────────
titulo("las cuentas");

const c1 = C.cuentaCashea("90 USD", 30);
ok(c1.inicial === "27 USD" && c1.resto === "63 USD", "90 USD al 30% → 27 USD + 63 USD", `${c1.inicial} + ${c1.resto}`);

const c2 = C.cuentaCashea("85.50 USD", 30);
ok(c2.inicial === "25.65 USD" && c2.resto === "59.85 USD", "85.50 USD al 30% → 25.65 + 59.85", `${c2.inicial} + ${c2.resto}`);

const c3 = C.cuentaCashea("$85,00", 40);
ok(c3.inicial === "$34" && c3.resto === "$51", "con coma decimal también: $85,00 al 40% → $34 + $51", `${c3.inicial} + ${c3.resto}`);

const c4 = C.cuentaCashea("99.99 USD", 10);
ok(Math.round((c4.inicialCifra + c4.restoCifra) * 100) === 9999,
   "la inicial y el resto suman EXACTAMENTE el precio, sin perder un céntimo", `${c4.inicial} + ${c4.resto}`);

ok(C.cuentaCashea("120 USD", 0).inicial === "0 USD", "Nivel 6 con 120 USD: 0 de inicial");
const cero90 = C.cuentaCashea("90 USD", 0);
ok(cero90.inicial === "0 USD" && cero90.cuotas === null,
   "Nivel 6 con 90 USD: 0% de inicial sí, pero sin las 6 cuotas (son desde 100$)");
ok(C.cuentaCashea("", 30) === null && C.cuentaCashea("consultar", 30) === null,
   "sin precio no hay cuenta (no se inventa)");

// ───────────────────────────────────────────────────────────────────────
titulo("las 6 cuotas sin interés, desde 100$");

ok(C.nombreDeLasCuotas() === "6 cuotas sin interés", "pagos.txt dice 6 cuotas sin interés", C.nombreDeLasCuotas());
ok(C.textoDelMinimo() === "compras desde 100$", "y el mínimo de 100$", C.textoDelMinimo());

const q1 = C.cuentaCashea("120 USD", 30).cuotas;
ok(q1.cuantas === 6 && q1.cada === "14 USD" && q1.iguales, "120 USD al 30% → 84 en 6 cuotas de 14 USD justas", q1.cada);

const q2 = C.cuentaCashea("135.50 USD", 30).cuotas;
ok(!q2.iguales && q2.cada === "15.81 USD" && q2.ultima === "15.80 USD",
   "94.85 en 6 → 5 de 15.81 y la última de 15.80 (no se inventan céntimos)", `${q2.cada} / ${q2.ultima}`);
ok(Math.round((q2.cadaCifra * 5 + q2.ultimaCifra) * 100) === 9485, "las 6 suman EXACTAMENTE el resto");

const q3 = C.cuentaCashea("120 USD", 0).cuotas;
ok(q3.cada === "20 USD", "Nivel 6 (0%): los 120 USD en 6 cuotas de 20 USD", q3.cada);

const barato = C.cuentaCashea("90 USD", 30);
ok(barato.cuotas === null && barato.alcanzaMinimo === false, "90 USD no llega a 100$: NO se reparte en 6 cuotas");
ok(C.cuentaCashea("100 USD", 30).alcanzaMinimo, "100 USD justos sí");

// ───────────────────────────────────────────────────────────────────────
titulo("la tarjeta, personalizada");

const jordan = { titulo: "Jordan 4 Retro", precio: "120 USD" };
const samba = { titulo: "Adidas Samba", precio: "75 USD" };

const hoy = C.tarjetaCashea({ ahora: HOY });
ok(/6 cuotas \+ 0% de inicial en Cashea/.test(hoy), "arriba, el titular de la promoción");
ok(/¡Arranca el 1 de octubre!/.test(hoy), "HOY la anuncia: arranca el 1 de octubre");
ok(/Bajada de inicial/.test(hoy) && /Nivel 6 → 0% de inicial/.test(hoy) && /Nivel 1 → 50% de inicial/.test(hoy),
   "la bajada de inicial, los 6 niveles");
ok(hoy.indexOf("Nivel 6") < hoy.indexOf("Nivel 1"), "del 6 al 1: el 0% primero");
ok(/Para optar por el modo 6 cuotas sin interés la compra debe ser de 100\$ o más/.test(hoy),
   "dice, con las palabras del dueño, que las 6 cuotas son desde 100$");
ok(/Nivel 6 → 0% de inicial 🎉\n/.test(hoy) && !/0% de inicial y las 6/.test(hoy),
   "y el 0% del Nivel 6 NO lleva mínimo");
ok(/¿Qué nivel tienes en Cashea\?/.test(hoy), "y le pregunta su nivel");
ok(!/🔥.*🔥.*🔥/.test(hoy.split("\n")[0]), "sin fuegos repetidos en el titular");

const enFecha = C.tarjetaCashea({ ahora: EN });
ok(/Promoción por tiempo limitado del 1 al 6 de octubre/.test(enFecha) && !/Arranca/.test(enFecha),
   "en fecha ya no dice 'arranca', dice hasta cuándo");

const sinNivelConZapato = C.tarjetaCashea({ productos: [jordan], ahora: EN });
ok(/por el Jordan 4 Retro/.test(sinNivelConZapato), "sin nivel pero mirando un zapato: le promete la cuenta de ESE");

// SIN MONTOS (dueño, 2-oct-2026): el porcentaje de su nivel y las cuotas,
// sí; cuánto dinero es la inicial o cada cuota, NO — eso, el asesor.
const SIN_DINERO = /\d+(?:[.,]\d+)?\s*USD|Inicial:\s*\d|cuotas? de \d/;

const n3 = C.tarjetaCashea({ nivel: 3, productos: [jordan], ahora: EN });
ok(/Nivel 3/.test(n3) && /30% de inicial/.test(n3) && /Jordan 4 Retro/.test(n3), "con Nivel 3: su porcentaje, y de qué producto habla", n3.split("\n")[0]);
ok(!SIN_DINERO.test(n3), "SIN montos de dinero (ni inicial ni cuotas)", n3.replace(/\n/g, " | "));
ok(/montos exactos de la inicial y de cada cuota te los confirma un asesor en un momento/.test(n3), "los montos, un asesor (y 'en un momento' avisa)");
ok(/6 cuotas sin interés/.test(n3) && /debe ser de 100\$ o más/.test(n3), "sí dice las 6 cuotas y la condición de la promoción (desde 100$)");

const n6 = C.tarjetaCashea({ nivel: 6, productos: [jordan], ahora: EN });
ok(/0% de inicial!/.test(n6) && !SIN_DINERO.test(n6) && !/!:/.test(n6), "Nivel 6: 0% de inicial, sin montos", n6.split("\n")[0]);

const nivelSinZapato = C.tarjetaCashea({ nivel: 2, ahora: HOY });
ok(/40% de inicial/.test(nivelSinZapato) && /Arranca/.test(nivelSinZapato) && !SIN_DINERO.test(nivelSinZapato),
   "con nivel y sin zapato: su porcentaje y la fecha, sin montos");

const nivelRaro = C.tarjetaCashea({ nivel: 9, productos: [jordan], ahora: EN });
ok(/No tengo el Nivel 9/.test(nivelRaro) && /Nivel 1 → 50%/.test(nivelRaro),
   "un nivel que no existe: lo dice y enseña la tabla");

const muchos = C.tarjetaCashea({ nivel: 3, productos: [jordan, samba, jordan, samba, jordan], ahora: EN });
ok(!SIN_DINERO.test(muchos), "con varios productos, tampoco montos");

titulo("la red: si la IA escribe montos de Cashea, se cambian por la tarjeta sin montos");
for (const malo of ["Con tu nivel 3 das 36$ de inicial y el resto en cuotas", "Te quedan 6 cuotas de 20 USD 😊", "Pagas 14$ por cuota con Cashea"]) {
  const r = C.revisarCashea(malo, EN);
  ok(r.corregido && !SIN_DINERO.test(r.respuesta), `atrapa: "${malo}"`, r.respuesta.split("\n")[0]);
}
for (const bueno of ["¡Claro que sí! 🙌 Mira cómo te queda con Cashea 👇", "Para optar por las 6 cuotas la compra debe ser de 100$ en adelante", "Estos Jordan cuestan 120$ 👟"]) {
  ok(!C.revisarCashea(bueno, EN).corregido, `deja pasar: "${bueno}"`);
}
ok(muchos.length <= 1000, "y cabe en un mensaje de Instagram (1000 letras)", `${muchos.length}`);

// ───────────────────────────────────────────────────────────────────────
titulo("¿pregunta por Cashea? ¿dice su nivel?");

for (const t of ["aceptan cashea?", "trabajan con Cashea", "se puede pagar en cuotas?", "cuanto es la inicial",
                 "soy nivel 3", "tengo nivel cuatro", "kashea", "lo puedo financiar?"]) {
  ok(C.preguntaPorCashea(t), `"${t}" → sí`);
}
for (const t of ["hola", "tienen jordan 4?", "precio", "qué métodos de pago tienen?", "dónde están?"]) {
  ok(!C.preguntaPorCashea(t), `"${t}" → no`);
}
ok(C.nivelDelCliente("soy nivel 3 en cashea") === 3, 'nivel de "soy nivel 3"');
ok(C.nivelDelCliente("tengo nivel cuatro") === 4, 'nivel de "tengo nivel cuatro"');
ok(C.nivelDelCliente("aceptan cashea?") === null, "sin nivel, null");
ok(C.nivelEnElHistorial("Pidió Retro 4. Nivel Cashea: 5. Ya busqué: Retro 4.") === 5,
   "el nivel se recuerda desde el historial");

// ───────────────────────────────────────────────────────────────────────
titulo("la red de seguridad de Cashea");

const bien = C.revisarCashea("¡Claro que sí! Con tu Nivel 3 pagas el 30% de inicial 🙌", EN_FECHA);
ok(!bien.corregido, "un porcentaje correcto no se toca");

const mal = C.revisarCashea("Con Nivel 3 pagas solo el 20% de inicial", EN_FECHA);
ok(mal.corregido && /Nivel 1 → 50%/.test(mal.respuesta), "Nivel 3 con 20% (es 30%): se cambia por la tabla");

const inventada = C.revisarCashea("Con Cashea das solo 15% de inicial", EN_FECHA);
ok(inventada.corregido, "una inicial de 15% que no está en la tabla: se corrige");

const vencida = C.revisarCashea("Con Nivel 3 pagas el 30% de inicial", Date.parse("2026-10-08T10:00:00-04:00"));
ok(vencida.corregido && vencida.respuesta === C.CASHEA_FUERA_DE_FECHA,
   "fuera de fecha, hasta el porcentaje correcto se pasa al asesor");

ok(!C.revisarCashea("Tenemos 20% de descuento en Nike", EN_FECHA).corregido,
   "un descuento que no es de Cashea no se toca");

// ───────────────────────────────────────────────────────────────────────
titulo("LA TABLA DE HOY (8-oct-2026): 6 cuotas + 0% exclusivo del Nivel 6, y la tarjeta tal cual");
{
  const H = await (await prepararSrc()).cargar("cashea.js");
  const DESPUES = Date.parse("2026-10-08T12:00:00-04:00");
  ok(H.hayCashea() && H.momentoDeLaPromocion(DESPUES) === "siempre" && H.casheaVigente(DESPUES), "sin fechas: vale siempre (no pasa al asesor)");
  const tabla = { 1: 60, 2: 50, 3: 30, 4: 25, 5: 20, 6: 0 };
  ok(Object.entries(tabla).every(([n, v]) => H.inicialDelNivel(n) === v), "Nivel 1 60% · 2 50% · 3 30% · 4 25% · 5 20% · 6 0%");
  ok(H.nombreDeLasCuotas() === "6 cuotas" && H.textoDelMinimo() === "compras desde 100$", "6 cuotas, desde 100$", `${H.nombreDeLasCuotas()} / ${H.textoDelMinimo()}`);
  ok(H.tieneLasCuotas(6) && !H.tieneLasCuotas(5) && !H.tieneLasCuotas(1), "las 6 cuotas son SOLO del Nivel 6");

  // La tarjeta, palabra por palabra como la escribió el dueño.
  const COMO_LA_PIDIO = [
    "💜 ¡Sí, trabajamos con Cashea!",
    "",
    "6 cuotas + 0% de inicial (Beneficio exclusivo para nivel 6)",
    "",
    "• Nivel 5 → 20% de inicial",
    "• Nivel 4 → 25% de inicial",
    "• Nivel 3 → 30% de inicial",
    "• Nivel 2 → 50% de inicial",
    "• Nivel 1 → 60% de inicial",
    "",
    "‘’ Para optar por el modo 6 cuotas la compra debe ser de 100$ o más ‘’",
    "",
    "¿Qué nivel tienes en Cashea? Dímelo y te digo qué inicial te toca 😉",
  ].join("\n");
  const t = H.tarjetaCashea({ ahora: DESPUES });
  ok(t === COMO_LA_PIDIO, "sin nivel: la tarjeta sale EXACTAMENTE como la pidió el dueño", t.replace(/\n/g, " | "));
  ok(H.tarjetaCashea({ productos: [{ titulo: "Jordan 4 Retro", precio: "120 USD" }], ahora: DESPUES }) === COMO_LA_PIDIO, "también mirando un zapato");
  // Si alguien cambia un porcentaje en la tabla y no en la tarjeta, que se note.
  for (const [, n, v] of t.matchAll(/Nivel (\d) → (\d+)% de inicial/g)) {
    ok(H.inicialDelNivel(n) === Number(v), `la tarjeta y la tabla dicen lo mismo del Nivel ${n} (${v}%)`);
  }
  ok(/^No tengo el Nivel 9 en la tabla de Cashea\.\n\n💜/.test(H.tarjetaCashea({ nivel: 9, ahora: DESPUES })), "un nivel que no existe: lo dice, y la tarjeta");

  const JORDAN = [{ titulo: "Jordan 4 Retro", precio: "120 USD" }];
  const n6 = H.tarjetaCashea({ nivel: 6, productos: JORDAN, ahora: DESPUES });
  ok(/Nivel 6/.test(n6) && /0% de inicial/.test(n6) && /El resto, en 6 cuotas/.test(n6) && /Para optar por el modo 6 cuotas la compra debe ser de 100\$ o más/.test(n6) && !/\d+\s*USD/.test(n6),
     "Nivel 6: 0% de inicial, 6 cuotas y la condición de los 100$, sin montos", n6.replace(/\n/g, " | "));
  for (const [n, pct] of [[5, 20], [3, 30], [1, 60]]) {
    const r = H.tarjetaCashea({ nivel: n, productos: JORDAN, ahora: DESPUES });
    ok(new RegExp(`Nivel ${n}.*${pct}% de inicial`).test(r) && !/6 cuotas|100\$/.test(r) && /confirma un asesor/.test(r),
       `Nivel ${n}: su ${pct}% de inicial, SIN las 6 cuotas (son del Nivel 6); los montos, el asesor`, r.replace(/\n/g, " | "));
  }
  ok(!H.revisarCashea("Con tu Nivel 1 pagas el 60% de inicial", DESPUES).corregido, "un 60% del Nivel 1 está bien");
  ok(!H.revisarCashea("Con tu Nivel 6 pagas el 0% de inicial", DESPUES).corregido, "el 0% del Nivel 6 está bien");
  ok(H.revisarCashea("Con tu Nivel 6 pagas el 20% de inicial", DESPUES).corregido, "un 20% al Nivel 6 (la tabla de ayer) se corrige");
  ok(!H.revisarCashea("Para optar por el modo 6 cuotas la compra debe ser de 100$ o más", DESPUES).corregido, "la condición de los 100$ no es un monto prometido");
}

// ───────────────────────────────────────────────────────────────────────
titulo("la ubicación: tal cual, con su botón, desde wrangler.toml");

const TOML = fs.readFileSync(path.join(import.meta.dirname, "..", "wrangler.toml"), "utf8");
const deToml = (nombre) => TOML.match(new RegExp(`^${nombre}\\s*=\\s*"([^"]*)"`, "m"))?.[1] ?? "";
const ENV = { DIRECCION: deToml("DIRECCION"), MAPS_URL: deToml("MAPS_URL"), FOTO_LOCAL: deToml("FOTO_LOCAL") };

const lugar = U.mensajeDeUbicacion(ENV);
ok(lugar.texto === ENV.DIRECCION && lugar.texto.length > 20, "el texto sale EXACTAMENTE como está en DIRECCION");
ok(lugar.boton === "MAPS/GOOGLE", "el botón dice MAPS/GOOGLE");
ok(/^https:\/\/maps\.app\.goo\.gl\//.test(lugar.enlace), "y abre el enlace de Maps", lugar.enlace);

// Así estaba el wrangler.toml del dueño el 30-sep: el enlace en DIRECCION y
// en FOTO_LOCAL, y MAPS_URL con "PENDIENTE".
const cruzado = U.mensajeDeUbicacion({
  DIRECCION: "https://maps.app.goo.gl/H1UF1f5CjcJc1LeWA",
  MAPS_URL: "PENDIENTE: el enlace de Google Maps",
  FOTO_LOCAL: "https://maps.app.goo.gl/H1UF1f5CjcJc1LeWA",
});
ok(cruzado.enlace === "https://maps.app.goo.gl/H1UF1f5CjcJc1LeWA" && cruzado.texto === "",
   "un enlace pegado en DIRECCION se usa de botón, nunca se le manda al cliente como dirección");
ok(cruzado.foto === "", "un enlace de Maps en FOTO_LOCAL se descarta: no es una imagen (no sale un cuadro roto)");

const drive = U.fotoUtilizable("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view?usp=sharing");
ok(drive.foto === "https://drive.google.com/uc?export=view&id=1AbCdEfGhIjKlMnOpQrStUvWxYz012345",
   "un 'Compartir' de Google Drive se arregla solo");
ok(U.fotoUtilizable("https://ejemplo.net/local.jpg").foto === "https://ejemplo.net/local.jpg", "una imagen normal vale tal cual");
ok(!U.hayUbicacion({}), "sin DIRECCION no hay ubicación que mandar (no se inventa)");

for (const t of ["dónde están ubicados?", "Donde queda la tienda", "tienen tienda física?", "ubicación",
                 "me pasas la dirección por favor", "cómo llego?", "google maps", "hola buenas, donde estan?"]) {
  ok(U.preguntaPorUbicacion(t), `"${t}" → sí`);
}
for (const t of ["tienen tienda online?", "te paso mi dirección", "hacen envíos a mi dirección?",
                 "mándame el link de la tienda", "tienen jordan 4?", "precio"]) {
  ok(!U.preguntaPorUbicacion(t), `"${t}" → no`);
}

ok(U.soloPreguntaUbicacion("hola, dónde están ubicados?"), "\"hola, dónde están ubicados?\" es SOLO la ubicación: ni se llama al modelo");
ok(!U.soloPreguntaUbicacion("dónde están y tienen jordan 4?"),
   "\"dónde están y tienen jordan 4?\" pide algo más: el resto va al modelo");

src.limpiar();
terminar();
