// El historial: lo justo para entender, sin arrastrar lo viejo.
//
// EL PROBLEMA QUE RESUELVE. El historial crece en cada mensaje, y el modelo
// lo lee entero. Cuando alguien que preguntó por un producto hace tres días
// responde a una historia nueva con un "precio", el modelo tiene delante un
// "Ya busqué: X" y contesta el precio del producto equivocado.
//
// Aquí se hacen dos cosas contra eso:
//
//   1. RECORTAR. Se queda con lo último, que es lo que sigue valiendo, y
//      suelta lo de más atrás.
//   2. SEPARAR. Se le entrega al modelo con una cabecera que dice a las
//      claras que eso es pasado y no es lo que el cliente pide ahora.
//
// Lo que NO se hace es borrarlo: sin historial el bot vuelve a saludar y
// pierde el hilo de "y ese otro?".

// Con esto caben unas dos frases: suficiente para entender un "y ese otro?"
// y poco para arrastrar una conversación de la semana pasada. Subirlo hace
// que el bot mezcle productos; bajarlo, que pierda el hilo.
const MAXIMO_CARACTERES = 200;

// Sin esta frase el bot cree que cada mensaje es de un cliente nuevo y
// vuelve a dar la bienvenida. Sobrevive al recorte pase lo que pase.
const BIENVENIDA = "Ya di la bienvenida.";

export function recortarHistorial(historial, limite = MAXIMO_CARACTERES) {
  const texto = String(historial || "").trim();
  if (texto.length <= limite) return texto;

  const dioBienvenida = texto.includes(BIENVENIDA);

  // Se corta por frases y se conservan las ÚLTIMAS, que son las recientes.
  const frases = texto.split(/(?<=[.!?])\s+/).filter(Boolean);
  const guardadas = [];
  let largo = 0;

  for (let i = frases.length - 1; i >= 0; i--) {
    const frase = frases[i];
    if (largo + frase.length + 1 > limite) break;
    guardadas.unshift(frase);
    largo += frase.length + 1;
  }

  // Si una sola frase ya pasaba del límite, al menos queda su final.
  if (!guardadas.length) guardadas.push(texto.slice(-limite));

  // Un "Ya busqué: X" de primero, sin la frase que decía qué pidió, es un
  // huérfano: apunta a una búsqueda cuyo motivo ya se soltó. Es exactamente
  // el rastro que hace que el bot conteste con el producto equivocado.
  while (guardadas.length > 1 && /^ya busqu[ée]/i.test(guardadas[0].trim())) {
    guardadas.shift();
  }

  let recortado = guardadas.join(" ").trim();

  // Y la bienvenida se repone si el recorte se la llevó por delante.
  if (dioBienvenida && !recortado.includes(BIENVENIDA)) {
    recortado = `${BIENVENIDA} ${recortado}`.trim();
  }

  console.log(`Historial recortado: ${texto.length} → ${recortado.length} caracteres`);
  return recortado;
}

// Lo que ve el modelo antes del mensaje del cliente.
//
// El orden y las cabeceras importan más de lo que parece: puesto así, con el
// pasado separado y etiquetado, el modelo deja de mezclar el producto de
// ayer con la pregunta de hoy.
// Un mensaje que no nombra ningún producto y se apoya en lo anterior:
// "precio", "cuánto", "y eso", "me interesa". Solos no dicen nada; con el
// historial al lado el modelo los rellena, y ahí es donde se equivoca de
// producto cuando el historial es viejo.
const NO_DICE_QUE_PRODUCTO =
  /^(\s*(precio|precios|cuanto|cu[áa]nto|cuesta|vale|valor|costo|info|informaci[óo]n|me interesa|eso|ese|esa|esos|dime|hola)\b[\s\S]{0,20})$/i;

export function contextoParaElModelo({
  nombre,
  historial,
  texto,
  marca = "",
  esHistoriaNueva = false,
  esPublicacionNueva = false,
  minutosDesdeElUltimo = 0,
  minutosParaSerViejo = 30,
  // El catálogo actual, ya como texto listo para pegar (ver listaDeTitulos
  // en sheets.js, si tu tienda lo usa). Si tu catálogo no lo genera, se deja
  // vacío y este bloque simplemente no aparece.
  catalogo = "",
  // Lo que se dijeron, turno por turno (ver estado.js). Es lo que hace que
  // el modelo pueda LEER el chat en vez de recordarlo.
  conversacion = [],
}) {
  const previo = recortarHistorial(historial);
  const partes = [];

  if (nombre) partes.push(`Nombre del cliente: ${nombre}`);

  // LA CONVERSACIÓN ENTERA, ANTES QUE NADA MÁS.
  //
  // Pedido del dueño (29-sep-2026): "que entienda el contexto de los
  // chats, que pueda leer los chats completos, de arriba abajo, principio
  // y fin".
  //
  // Hasta ahora lo único que viajaba era el resumen de abajo: 200
  // caracteres que escribe el propio modelo. Con eso se pierde el tono, lo
  // que el cliente ya descartó, para quién es el equipo, cuánto quiere
  // gastar — y el bot vuelve a preguntar lo que ya le respondieron, que es
  // lo que más cansa a quien está comprando.
  //
  // Aquí va lo que de verdad se dijeron, en orden, con sus palabras.
  if (conversacion.length) {
    partes.push(
      "───────── LA CONVERSACIÓN, TAL COMO PASÓ ─────────",
      "Léela entera antes de contestar, de arriba abajo. Es lo que YA se",
      "dijeron: no vuelvas a preguntar algo que él ya respondió, no repitas",
      "lo que ya le dijiste, y usa lo que contó (para quién es, qué",
      "descartó, cuánto quiere gastar) para que tu respuesta encaje.",
      ...conversacion.map(
        (turno) => `${turno.de === "bot" ? "Tú" : "Cliente"}: ${turno.texto}`
      ),
      "─────────────────────────────────────────────────"
    );
  }

  if (previo) {
    partes.push(
      conversacion.length
        ? "───────── TUS APUNTES DE ANTES (lo que ya no cabe arriba) ─────────"
        : "───────── DE QUÉ HABLARON ANTES ─────────",
      "Esto ya pasó. Sirve para entender referencias como \"y el otro?\" o",
      "\"dame ese\". NO es lo que el cliente pide ahora, y NO hay que volver a",
      "buscar lo que diga \"Ya busqué\" salvo que el mensaje de ahora lo pida.",
      previo
    );

    // Si ha pasado un rato largo, lo de arriba ya no es "la conversación":
    // es otra conversación. Y si encima el mensaje de ahora no nombra ningún
    // producto —un "precio" suelto—, suponer de qué habla es apostar.
    const viejo = minutosDesdeElUltimo >= minutosParaSerViejo;
    const noDiceQue = NO_DICE_QUE_PRODUCTO.test(String(texto || "").trim());

    if (viejo) {
      const cuanto =
        minutosDesdeElUltimo >= 1440
          ? `${Math.round(minutosDesdeElUltimo / 1440)} día(s)`
          : `${Math.round(minutosDesdeElUltimo / 60)} hora(s)`;
      partes.push(
        `[HAN PASADO ${cuanto} DESDE EL ÚLTIMO MENSAJE. Lo de arriba es de`,
        "otra conversación: sirve para reconocerlo, no para dar por hecho que",
        "sigue hablando de eso]"
      );
    }

    // Con una publicación compartida delante, un "precio?" suelto SÍ dice
    // de qué habla: lo dice la publicación. Pedirle al modelo que pregunte
    // "¿de cuál?" ahí sería justo lo que el cliente no entiende — acaba de
    // señalarlo. Por eso esta protección se desactiva en ese caso, y solo
    // en ese.
    if (noDiceQue && (viejo || esHistoriaNueva) && !esPublicacionNueva) {
      partes.push(
        // (Sin "ofrécele el catálogo": EPICCELL no tiene tienda online, y
        // el modelo le ofrecía un catálogo que no existe.)
        "[SU MENSAJE NO DICE DE QUÉ PRODUCTO HABLA. No lo adivines con lo de",
        "arriba: PREGÚNTASELO con amabilidad (\"¿de cuál equipo me hablas?\").",
        "Dar el precio del producto equivocado es peor que preguntar]"
      );
    }

    // Igual que con una historia: lo de antes no es de lo que habla ahora.
    if (esPublicacionNueva) {
      partes.push(
        "[OJO: el cliente ACABA DE COMPARTIR UNA PUBLICACIÓN. Está preguntando",
        "por el equipo que sale en ELLA, no por lo de arriba]"
      );
    }

    // Cuando llega por una historia, lo de antes es todavía menos relevante:
    // el cliente está mirando otra cosa, no aquello.
    if (esHistoriaNueva) {
      partes.push(
        "[OJO: el cliente viene de una HISTORIA NUEVA. Está preguntando por lo",
        "que sale en ESA historia, no por lo de arriba. Si no sabes qué es,",
        "pregúntaselo: no supongas que es el mismo producto de antes]"
      );
    }
  }

  partes.push(
    "───────── LO QUE PIDE AHORA ─────────",
    previo
      ? "[YA SE CONOCEN: NO saludes, NO te presentes, NO uses su nombre]"
      : "[PRIMER MENSAJE: saluda una vez y preséntate]"
  );

  // El catálogo va aquí, en cada mensaje, y no pegado una vez en el prompt:
  // así es como la IA "lee" el catálogo de verdad, sin adivinar qué existe.
  if (catalogo) {
    partes.push(
      "───────── CATÁLOGO ACTUAL DE LA TIENDA ─────────",
      // LO MISMO QUE DICE EL PROMPT, NO LO CONTRARIO (30-sep-2026).
      //
      // Aquí decía "si no está en la lista, no lo busques y ofrece el
      // catálogo", y el prompt dice "si se parece a algo, búscalo; el
      // sistema dice si no está". Dos órdenes opuestas en cada mensaje, y
      // el modelo elegía una al azar: de ahí buena parte de las respuestas
      // incoherentes. Y el catálogo que ofrecía no existe: EPICCELL no
      // tiene tienda online.
      "Esto es lo que hay disponible HOY. En \"buscar\" usa las palabras de",
      "esta lista. Si lo que pide SE PARECE a algo de aquí (aunque lo escriba",
      "distinto), BÚSCALO: el sistema ve el resultado y, si justo ese no está,",
      "él mismo le dice \"ese no, pero mira estos\". Si no hay NADA parecido,",
      "dile que ahora mismo no lo tienes disponible y que un asesor le",
      "confirma si se puede conseguir. Nunca \"no vendemos\".",
      catalogo,
      "─────────────────────────────────────────────────"
    );
  }

  if (marca) partes.push(marca);
  partes.push(`Cliente: ${texto}`);

  return partes.join("\n");
}
