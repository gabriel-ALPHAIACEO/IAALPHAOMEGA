// CASHEA Y LA UBICACIÓN: las cuentas, las fechas y qué cuenta como pregunta.
//
// QUÉ SE PROTEGE (30-sep-2026).
//
//   · Las cuentas de Cashea son dinero. 30% de 90 USD son 27 USD, y la
//     inicial más el resto tienen que sumar EXACTAMENTE el precio.
//   · La promoción tiene fecha (del 1 al 6 de octubre). Antes y después, el
//     bot no puede ofrecer esos porcentajes.
//   · La ubicación sale TAL CUAL, con su botón, y solo cuando preguntan por
//     la tienda — no cuando el cliente da SU dirección para un envío, ni
//     cuando pide la tienda online.
//
// Las pruebas no saben de qué tienda son: leen la tabla de pagos.txt y el
// texto de ubicacion.txt, y comprueban contra eso.

import { prepararSrc, prompt, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const C = await src.cargar("cashea.js");
const U = await src.cargar("ubicacion.js");

const EN_FECHA = Date.parse("2026-10-03T12:00:00-04:00");

// ───────────────────────────────────────────────────────────────────────
titulo("la tabla se lee de pagos.txt");

ok(C.hayCashea(), "Cashea está cargado");
ok(C.inicialDelNivel(1) === 50 && C.inicialDelNivel(3) === 30 && C.inicialDelNivel(6) === 0,
   "Nivel 1 → 50%, Nivel 3 → 30%, Nivel 6 → 0%");
ok(C.inicialDelNivel(7) === null, "un nivel que no existe no se inventa");

// ───────────────────────────────────────────────────────────────────────
titulo("la vigencia: del 1 al 6 de octubre, hora de Venezuela");

const hora = (iso) => Date.parse(iso);
ok(!C.casheaVigente(hora("2026-09-30T23:59:00-04:00")), "el 30 de septiembre a las 23:59 todavía NO");
ok(C.casheaVigente(hora("2026-10-01T00:00:00-04:00")), "el 1 de octubre a las 00:00 SÍ");
ok(C.casheaVigente(hora("2026-10-06T23:59:00-04:00")), "el 6 de octubre a las 23:59 todavía SÍ");
ok(!C.casheaVigente(hora("2026-10-07T00:00:01-04:00")), "el 7 de octubre ya NO");

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

ok(C.cuentaCashea("90 USD", 0).inicial === "0 USD", "Nivel 6: 0 de inicial");
ok(C.cuentaCashea("", 30) === null && C.cuentaCashea("consultar", 30) === null,
   "sin precio no hay cuenta (no se inventa)");

// ───────────────────────────────────────────────────────────────────────
titulo("las 6 cuotas");

ok(C.nombreDeLasCuotas() === "6 cuotas", "pagos.txt dice 6 cuotas", C.nombreDeLasCuotas());

const q1 = C.cuentaCashea("90 USD", 30).cuotas;
ok(q1.cuantas === 6 && q1.cada === "10.50 USD" && q1.iguales, "63 USD en 6 cuotas → 6 de 10.50 USD justas", q1.cada);

const q2 = C.cuentaCashea("85.50 USD", 30).cuotas;
ok(!q2.iguales && q2.cada === "9.98 USD" && q2.ultima === "9.95 USD",
   "59.85 USD en 6 → 5 de 9.98 y la última de 9.95 (no se inventan céntimos)", `${q2.cada} / ${q2.ultima}`);
ok(Math.round((q2.cadaCifra * 5 + q2.ultimaCifra) * 100) === 5985, "las 6 suman EXACTAMENTE el resto");

const q3 = C.cuentaCashea("90 USD", 0).cuotas;
ok(q3.cada === "15 USD", "Nivel 6 (0%): los 90 USD en 6 cuotas de 15 USD", q3.cada);

// ───────────────────────────────────────────────────────────────────────
titulo("la tarjeta, personalizada");

const jordan = { titulo: "Jordan 4 Retro", precio: "90 USD" };
const samba = { titulo: "Adidas Samba", precio: "70 USD" };

const sinNivel = C.tarjetaCashea({});
ok(/Nivel 1 → 50%/.test(sinNivel) && /Nivel 6 → 0%/.test(sinNivel), "sin nivel: enseña la tabla entera");
ok(/Promoción por tiempo limitado \(del 1 al 6 de octubre\)/.test(sinNivel), "con la promoción y sus fechas");
ok(/¿Qué nivel tienes en Cashea\?/.test(sinNivel), "y le pregunta su nivel");
ok(/el resto lo pagas en 6 cuotas/i.test(sinNivel), "y dice que el resto va en 6 cuotas");

const sinNivelConZapato = C.tarjetaCashea({ productos: [jordan] });
ok(/por el Jordan 4 Retro/.test(sinNivelConZapato), "sin nivel pero mirando un zapato: le promete la cuenta de ESE");

const n3 = C.tarjetaCashea({ nivel: 3, productos: [jordan] });
ok(/Nivel 3/.test(n3) && /30% de inicial/.test(n3), "con Nivel 3: su porcentaje");
ok(/Inicial: 27 USD/.test(n3) && /El resto \(63 USD\) en 6 cuotas de 10.50 USD/.test(n3),
   "y la cuenta de su zapato: 27 de inicial + 6 cuotas de 10.50");

const n6 = C.tarjetaCashea({ nivel: 6, productos: [jordan, samba] });
ok(/0% de inicial/.test(n6) && /Todo \(90 USD\)/.test(n6) && /Todo \(70 USD\)/.test(n6),
   "Nivel 6: sin inicial, todo en cuotas, para cada zapato");
ok(/¿Con cuál te quedas\?/.test(n6), "con varios zapatos, le pregunta con cuál se queda");

const nivelSinZapato = C.tarjetaCashea({ nivel: 2 });
ok(/40% de inicial/.test(nivelSinZapato) && /¿Qué modelo te gustó\?/.test(nivelSinZapato),
   "con nivel y sin zapato: su porcentaje, y le pide el modelo");

const nivelRaro = C.tarjetaCashea({ nivel: 9, productos: [jordan] });
ok(/No tengo el Nivel 9/.test(nivelRaro) && /Nivel 1 → 50%/.test(nivelRaro),
   "un nivel que no existe: lo dice y enseña la tabla");

const muchos = C.tarjetaCashea({ nivel: 3, productos: [jordan, samba, jordan, samba, jordan] });
ok((muchos.match(/👟/g) || []).length === 3, "desglosa 3 zapatos como mucho");
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
titulo("la ubicación: tal cual, con su botón");

const lugar = U.mensajeDeUbicacion();
const delArchivo = prompt("ubicacion.txt")
  .split(/\[TEXTO\]/)[1]
  .split(/\[BOTON\]/)[0]
  .split("\n")
  .filter((l) => l.trim() && !l.trim().startsWith("#"))
  .join("\n")
  .trim();
ok(lugar.texto === delArchivo, "el texto sale EXACTAMENTE como está en ubicacion.txt");
ok(lugar.boton === "MAPS/GOOGLE", "el botón dice MAPS/GOOGLE");
ok(lugar.enlace === "" || /^https?:\/\//.test(lugar.enlace),
   "sin enlace de verdad, no hay botón (nunca un botón a un enlace roto)", lugar.enlace || "(sin enlace todavía)");

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
