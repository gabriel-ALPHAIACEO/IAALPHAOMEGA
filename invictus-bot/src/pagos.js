// CÓMO SE PAGA: LA LISTA, LA TASA, Y LA RED DE SEGURIDAD ALREDEDOR.
//
// QUÉ SE PEDÍA. Que cuando el cliente pregunte qué métodos de pago hay, el
// bot los conteste TODOS de una vez —no que los mande a un asesor— pero sin
// decirle nunca que le va a mandar los datos ni pedirle que los mande él. Y
// que a la pregunta de la tasa conteste que se recibe a la del BCV.
//
// Son tres cosas distintas y conviene tenerlas separadas:
//
//   · LOS MÉTODOS —pago móvil, transferencia, efectivo…— son un dato de la
//     tienda, igual que los horarios. Se contestan.
//   · LA TASA es un dato de la tienda en cuanto a CUÁL se usa: la del BCV.
//     Cuánto vale hoy NO lo es: cambia todos los días y el bot no lo sabe.
//   · LOS DATOS PARA PAGAR —número de cuenta, cédula, correo de Zelle— los
//     da un asesor cuando se cierra la venta, nunca el bot, y menos
//     todavía inventados.
//
// De dónde sale todo: prompts/pagos.txt, en dos secciones. Este archivo lo
// lee y el prompt de texto recibe lo mismo pegado en {{PAGOS}} y {{TASA}}
// (ver ia.js), así que hay UNA sola fuente que mantener.
//
// SI pagos.txt ESTÁ VACÍO no pasa nada malo: el prompt recibe la
// instrucción de siempre —pasar la pregunta a un asesor— y este archivo no
// corrige nada que no pueda corregir.
//
// POR QUÉ ADEMÁS HAY CÓDIGO Y NO SOLO PROMPT. Por lo mismo que cuotas.js en
// el bot de teléfonos: un dato de pago inventado es dinero. El prompt ya se
// lo prohíbe con todas las letras, pero si un día el modelo se descuida y
// escribe "ya te paso el número de cuenta" o "la tasa está en 45", el
// cliente se lo cree. Eso no puede depender de que se acuerde.

import listaPagos from "./prompts/pagos.txt";

let leido = null;

// prompts/pagos.txt son dos secciones marcadas con [CORCHETES]. Lo de antes
// del primer corchete, y las líneas con #, son notas para quien mantiene el
// archivo: no se leen.
function leer() {
  if (!leido) {
    leido = { metodos: [], tasa: "" };
    let seccion = "";

    for (const cruda of String(listaPagos || "").split("\n")) {
      const linea = cruda.trim();
      if (!linea || linea.startsWith("#")) continue;

      const marca = linea.match(/^\[(\w+)\]$/);
      if (marca) {
        seccion = marca[1].toUpperCase();
        continue;
      }

      if (seccion === "METODOS") leido.metodos.push(linea);
      // La tasa es UNA línea. Si hay varias se queda con la primera, que es
      // más seguro que pegarlas y decirle al cliente dos tasas distintas.
      else if (seccion === "TASA" && !leido.tasa) leido.tasa = linea;
    }
  }

  return leido;
}

export function metodosDePago() {
  return leer().metodos;
}

export function hayMetodosDePago() {
  return leer().metodos.length > 0;
}

// A qué tasa se recibe, en palabras y sin números. Ejemplo: "la tasa del
// BCV (Banco Central de Venezuela)".
export function tasaDePago() {
  return leer().tasa;
}

export function hayTasa() {
  return Boolean(leer().tasa);
}

// Cómo se le escriben los métodos al cliente: una lista corta, sin
// florituras. No se añade "escríbeme para los datos" ni nada parecido —
// eso es justo lo que se pidió quitar.
export function listaDeMetodos() {
  const { metodos } = leer();
  if (!metodos.length) return "";

  return (
    "Puedes pagar con:\n" +
    metodos.map((m) => `• ${m}`).join("\n") +
    "\n\n¿Cuál te sirve mejor? 😊"
  );
}

// Y cómo se contesta la tasa: cuál se usa, que eso sí se sabe, y que el
// número del día lo confirma un asesor, que es la verdad.
export function fraseDeLaTasa() {
  const tasa = tasaDePago();
  if (!tasa) return "";

  return (
    `Recibimos a ${tasa}. ` +
    "La del día te la confirma un asesor en un momento 😊"
  );
}

// Cuando no hay nada cargado, lo de siempre: a un asesor. Es la misma frase
// que usa el prompt para todo lo que el bot no sabe.
const MEJOR_UN_ASESOR = "Eso te lo confirma un asesor en un momento 😊";

// Solo se revisa la respuesta si habla de pagar. Un "te paso las fotos" en
// cualquier otra frase no es asunto de este archivo.
//
// El filtro es GENEROSO a propósito: colar una frase que no era de pagos no
// cuesta nada, porque los patrones de abajo tienen que dar además. Lo que sí
// costaba era quedarse corto — "te mando el número de cuenta" no lleva la
// palabra "pago" en ninguna parte y se escapaba entero.
const HABLA_DE_PAGOS =
  /\b(pago|pagos|pagar|pagas|pagu\w*|transferenc\w*|transfier\w*|zelle|efectivo|dep[oó]sito|cuentas?|comprobante|referencia|tarjeta|punto de venta|binance|zinli|paypal|c[eé]dula|rif|tasa|bcv|bol[ií]vares?|bs)\b/i;

// "te paso los datos", "ya te mando el número de cuenta", "te doy la cuenta".
// El verbo de mandar tiene que traer detrás un objeto de pago: "te paso con
// un asesor" es correcto y no debe caer acá.
const PROMETE_DATOS =
  /\b(?:te|le)\s+(?:los\s+|las\s+|el\s+|la\s+|mis\s+|nuestros?\s+)?(?:paso|pasar[ée]|mando|mandar[ée]|env[ií]o|enviar[ée]|doy|dar[ée]|comparto|compartir[ée]|facilito|escribo)\b[^.!?\n]{0,40}\b(?:datos|n[uú]mero de cuenta|cuenta|cuentas|informaci[oó]n de pago|correo de zelle|c[eé]dula|rif)\b/i;

// "mándame los datos", "envíame el comprobante", "pásame la referencia".
// A propósito NO entran "foto", "imagen", "captura" ni "pantallazo": el bot
// sí le pide fotos de zapatos, y eso es correcto.
const PIDE_DATOS =
  /\b(?:m[aá]ndame|env[ií]ame|p[aá]same|manda|env[ií]a|pasa|sube|adjunta)\b[^.!?\n]{0,30}\b(?:datos|comprobante|referencia|transferencia|dep[oó]sito|n[uú]mero de cuenta)\b/i;

// Un número largo en una respuesta de venta no es un precio: es una cuenta
// que el modelo se sacó de la manga. Los precios llevan punto o coma y no
// llegan a ocho cifras seguidas.
const PARECE_UNA_CUENTA = /\d{8,}/;

// LA TASA CON UN NÚMERO PEGADO. "la tasa está en 45,50", "son 1.800 Bs".
// El valor del día cambia todos los días: cualquier cifra que el modelo
// escriba acá es inventada, aunque suene razonable.
const INVENTA_LA_TASA = /\btasa\b[^.!?\n]{0,30}\d|\d[\d.,]*\s*(?:bs\b|bol[ií]var)/i;

// Y LA TASA QUE NO ES LA NUESTRA. Se recibe a la del BCV; ofrecer la
// paralela o la del monitor es prometer un precio que la tienda no da.
// El "de" y el "del" van en medio porque así se dice: "la tasa DE Binance",
// "la tasa DEL monitor". Sin ellos se escapaban las dos. "Tasa del BCV" no
// cae acá: BCV no está en la lista, que es justo la nuestra.
const OTRA_TASA =
  /\btasa\s+(?:de\s+|del\s+)?(?:paralel\w*|binance|negra|libre|monitor)\b|\bmonitor\s+d[oó]lar\b|\bd[oó]lar\s+paralelo\b/i;

// Revisa lo que el modelo quiere mandar. Devuelve la respuesta tal cual si
// está bien, o una segura si prometió datos, los pidió, se inventó una
// cuenta, o se inventó la tasa.
export function revisarPagos(respuesta) {
  const texto = String(respuesta || "");

  if (!HABLA_DE_PAGOS.test(texto)) {
    return { respuesta: texto, corregido: false };
  }

  const motivos = [];
  if (PROMETE_DATOS.test(texto)) motivos.push("prometió mandar los datos de pago");
  if (PIDE_DATOS.test(texto)) motivos.push("le pidió al cliente que mandara datos de pago");
  if (PARECE_UNA_CUENTA.test(texto)) motivos.push("escribió algo que parece un número de cuenta");

  // La tasa se cuenta aparte porque la respuesta segura es otra: no es
  // "estos son los métodos", es "recibimos a la del BCV".
  const esDeLaTasa = INVENTA_LA_TASA.test(texto) || OTRA_TASA.test(texto);
  if (INVENTA_LA_TASA.test(texto)) motivos.push("se inventó el valor de la tasa");
  if (OTRA_TASA.test(texto)) motivos.push("ofreció una tasa que no es la de la tienda");

  if (!motivos.length) return { respuesta: texto, corregido: false };

  // Con el dato cargado se le contesta lo que sí es verdad —los métodos, o
  // cuál es la tasa— en vez de pasarlo a un asesor: era exactamente lo que
  // se pidió. Sin el dato, a un asesor, que es lo que hace el bot hoy.
  let enSuLugar = MEJOR_UN_ASESOR;
  if (esDeLaTasa && hayTasa()) enSuLugar = fraseDeLaTasa();
  else if (!esDeLaTasa && hayMetodosDePago()) enSuLugar = listaDeMetodos();

  console.error(
    `PAGOS: ${motivos.join(" y ")}. Lo cambio por ` +
      (enSuLugar === MEJOR_UN_ASESOR
        ? "pasar a un asesor."
        : esDeLaTasa
          ? "la tasa de la tienda."
          : "la lista de métodos.")
  );

  return { respuesta: enSuLugar, corregido: true, motivos };
}
