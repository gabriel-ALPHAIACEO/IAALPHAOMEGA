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

const src = await prepararSrc();
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
  ok((tarjeta.match(/Jordan 40/g) || []).length === 1 && /Jordan 40 — 120 USD/.test(tarjeta), "los tres colores al mismo precio: la cuenta UNA vez, como 'Jordan 40'", tarjeta.replace(/\n/g, " | "));
  ok(/6 cuotas/.test(tarjeta) && /20 USD/.test(tarjeta), "con las 6 cuotas de 20 USD");
  const distintos = C.tarjetaCashea({ nivel: 6, productos: [tres[0], { titulo: "Jordan 40 blanco dama", precio: "110 USD" }], ahora: DIA });
  ok((distintos.match(/Jordan 40/g) || []).length === 2, "si los precios son distintos, cada uno con su cuenta");
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
ok(/Para optar por las 6 cuotas sin interés la compra debe ser de 100\$ en adelante/.test(hoy),
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

const n3 = C.tarjetaCashea({ nivel: 3, productos: [jordan, samba], ahora: EN });
ok(/Nivel 3/.test(n3) && /30% de inicial/.test(n3), "con Nivel 3: su porcentaje");
ok(/Inicial: 36 USD/.test(n3) && /El resto \(84 USD\) en 6 cuotas sin interés de 14 USD/.test(n3),
   "los Jordan (120): 36 de inicial + 6 cuotas de 14");
ok(/Inicial: 22.50 USD/.test(n3) && /para optar por las 6 cuotas sin interés la compra debe ser de 100\$ en adelante/.test(n3),
   "las Samba (75): su inicial, y que las 6 cuotas son desde 100$");

const n6 = C.tarjetaCashea({ nivel: 6, productos: [jordan], ahora: EN });
ok(/0% de inicial!/.test(n6) && /Todo \(120 USD\) en 6 cuotas sin interés de 20 USD/.test(n6) && !/!:/.test(n6),
   "Nivel 6: sin inicial, todo en 6 cuotas de 20");

const n6Barato = C.tarjetaCashea({ nivel: 6, productos: [samba], ahora: EN });
ok(/Inicial: 0 USD/.test(n6Barato) && /Todo \(75 USD\) en cuotas con Cashea \(para optar por las 6 cuotas/.test(n6Barato),
   "Nivel 6 con las Samba (75): 0% de inicial, y que las 6 cuotas son desde 100$");

const nivelSinZapato = C.tarjetaCashea({ nivel: 2, ahora: HOY });
ok(/40% de inicial/.test(nivelSinZapato) && /¿Qué modelo te gustó\?/.test(nivelSinZapato) && /Arranca/.test(nivelSinZapato),
   "con nivel y sin zapato: su porcentaje, le pide el modelo, y hoy anuncia la fecha");

const nivelRaro = C.tarjetaCashea({ nivel: 9, productos: [jordan], ahora: EN });
ok(/No tengo el Nivel 9/.test(nivelRaro) && /Nivel 1 → 50%/.test(nivelRaro),
   "un nivel que no existe: lo dice y enseña la tabla");

const muchos = C.tarjetaCashea({ nivel: 3, productos: [jordan, samba, jordan, samba, jordan], ahora: EN });
ok((muchos.match(/🛍️/g) || []).length === 3, "desglosa 3 productos como mucho");
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
titulo("la ubicación: tal cual, con su botón, desde wrangler.toml");

// El Emperador todavía no tiene su dirección en wrangler.toml: se prueba con
// una de mentira. Lo que importa es que salga TAL CUAL y con su botón.
const ENV = { DIRECCION: "Estamos en la calle de prueba, local 1, frente a la plaza", MAPS_URL: "https://maps.app.goo.gl/PRUEBA", FOTO_LOCAL: "" };

const lugar = U.mensajeDeUbicacion(ENV);
ok(lugar.texto === ENV.DIRECCION && lugar.texto.length > 20, "el texto sale EXACTAMENTE como está en DIRECCION");
ok(lugar.boton === "MAPS/GOOGLE", "el botón dice MAPS/GOOGLE");
ok(/^https:\/\/maps\.app\.goo\.gl\//.test(lugar.enlace), "y abre el enlace de Maps", lugar.enlace);

// Así estaba un wrangler.toml de verdad (Invictus, 30-sep): el enlace en
// DIRECCION y en FOTO_LOCAL, y MAPS_URL con "PENDIENTE".
const cruzado = U.mensajeDeUbicacion({
  DIRECCION: "https://maps.app.goo.gl/PRUEBA",
  MAPS_URL: "PENDIENTE: el enlace de Google Maps",
  FOTO_LOCAL: "https://maps.app.goo.gl/PRUEBA",
});
ok(cruzado.enlace === "https://maps.app.goo.gl/PRUEBA" && cruzado.texto === "",
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
