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
//
// LOS MÉTODOS VAN EN GRUPOS porque esta tienda cobra de dos formas muy
// distintas —en bolívares y en divisas— y al cliente le importa la
// diferencia: no es lo mismo un punto de venta que un Zelle. Una línea que
// TERMINA EN DOS PUNTOS abre un grupo; lo que venga debajo cae dentro. Sin
// ninguna línea así, la lista sale suelta y todo sigue funcionando.
function leer() {
  if (!leido) {
    leido = { metodos: [], grupos: [], tasa: "" };
    let seccion = "";
    let grupo = null;

    for (const cruda of String(listaPagos || "").split("\n")) {
      const linea = cruda.trim();
      if (!linea || linea.startsWith("#")) continue;

      const marca = linea.match(/^\[(\w+)\]$/);
      if (marca) {
        seccion = marca[1].toUpperCase();
        grupo = null;
        continue;
      }

      if (seccion === "METODOS") {
        if (linea.endsWith(":")) {
          grupo = { titulo: linea, metodos: [] };
          leido.grupos.push(grupo);
          continue;
        }

        // Un método escrito antes de cualquier título va en un grupo sin
        // nombre, para que una lista suelta siga saliendo igual.
        if (!grupo) {
          grupo = { titulo: "", metodos: [] };
          leido.grupos.push(grupo);
        }

        grupo.metodos.push(linea);
        leido.metodos.push(linea);
      }
      // La tasa es UNA línea. Si hay varias se queda con la primera, que es
      // más seguro que pegarlas y decirle al cliente dos tasas distintas.
      else if (seccion === "TASA" && !leido.tasa) leido.tasa = linea;
    }
  }

  return leido;
}

// Los métodos en plano, sin los títulos de los grupos. Es lo que sirve para
// contarlos y para saber si hay algo cargado.
export function metodosDePago() {
  return leer().metodos;
}

// Y los métodos con sus grupos, ya escritos para leerse. Va igual al prompt
// y a la respuesta del cliente, para que no puedan decir cosas distintas.
export function bloqueDeMetodos() {
  const { grupos } = leer();
  if (!grupos.length) return "";

  return grupos
    .map((g) => (g.titulo ? `${g.titulo}\n` : "") + g.metodos.map((m) => `• ${m}`).join("\n"))
    .join("\n\n");
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
  const bloque = bloqueDeMetodos();
  if (!bloque) return "";

  // Termina preguntando cuál le sirve, NO ofreciendo mandarle los datos.
  // La plantilla que usaba la tienda cerraba con "escríbeme para enviarte
  // los datos" y eso es justo lo que se pidió quitar: los datos los da un
  // asesor, así que prometerlos acá deja al cliente esperando.
  return `💳 Estos son los métodos de pago:\n\n${bloque}\n\n¿Cuál te sirve mejor? 😊`;
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

// ¿PREGUNTA CON QUÉ SE PUEDE PAGAR? (30-sep-2026, pedido del dueño: "cuando
// preguntan métodos de pago envía TODOS los métodos disponibles"). Entonces
// se le manda la lista entera, desde el código —siempre completa, sin que
// el modelo se deje uno— y NO se avisa a nadie: es una pregunta, no un
// cierre.
const PREGUNTA_METODOS =
  /\b(m[eé]todos?\s+de\s+pagos?|formas?\s+de\s+pagos?|medios\s+de\s+pagos?|c[oó]mo\s+(?:puedo\s+|se\s+puede\s+)?pag(?:o|ar|a)|con\s+qu[eé]\s+(?:puedo\s+)?pag(?:o|ar)|qu[eé]\s+pagos?\s+(?:aceptan|reciben|tienen)|aceptan\s+(?:zelle|paypal|binance|zinli|pago\s+m[oó]vil|punto|transferencia|efectivo|d[oó]lares)|reciben\s+(?:zelle|paypal|binance|zinli|pago\s+m[oó]vil|transferencia|efectivo|d[oó]lares))\b/i;

export function preguntaPorMetodos(texto) {
  return PREGUNTA_METODOS.test(String(texto || ""));
}

// ¿PIDE LOS DATOS PARA PAGAR? Eso SÍ va al asesor, y es lo ÚNICO de pagos
// que avisa (pedido del dueño, 30-sep-2026): el bot no tiene ni un número
// de cuenta, y el cliente está a punto de mandar el dinero.
const PIDE_DATOS_DE_PAGO =
  /\b(?:(?:p[aá]same|m[aá]ndame|env[ií]ame|dame|p[aá]sa(?:me)?|manda(?:me)?|regálame|reg[aá]lame|comp[aá]rteme)\s+(?:los\s+|el\s+|la\s+|tus\s+|sus\s+)?(?:datos|n[uú]mero\s+de\s+cuenta|cuenta|pago\s+m[oó]vil|zelle|correo)|datos\s+(?:para|de)\s+(?:pag\w*|transferir|la\s+transferencia|pago\s+m[oó]vil|zelle|binance)|n[uú]mero\s+de\s+cuenta|a\s+d[oó]nde\s+(?:te\s+)?(?:transfiero|pago|deposito|env[ií]o\s+el\s+pago)|a\s+qu[eé]\s+(?:cuenta|n[uú]mero|correo)|cu[aá]l\s+es\s+(?:el|tu|su)\s+(?:zelle|correo|n[uú]mero|pago\s+m[oó]vil|binance)|correo\s+(?:de|del)\s+zelle)\b/i;

export function pideDatosDePago(texto) {
  return PIDE_DATOS_DE_PAGO.test(String(texto || ""));
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
