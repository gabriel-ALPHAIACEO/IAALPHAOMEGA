// EL EMPERADOR — todo lo que es de ESTA tienda y de ninguna otra.
//
// Mismo formato que invictus.js. El código es idéntico en las dos tiendas;
// lo único que cambia es este archivo y el wrangler.toml.
//
// ⚠️ FALTA EL CATÁLOGO. Los dos campos de abajo marcados con PENDIENTE son
// los que hacen que la búsqueda encuentre productos. Mientras estén vacíos
// el bot funciona, conversa y vende, pero adivina los términos de búsqueda
// y va a fallar más de la cuenta. Cómo llenarlos, al final del archivo.

export const emperador = {
  nombre: "El Emperador",
  nombreMayusculas: "EL EMPERADOR",

  // PENDIENTE: confirmar los horarios reales de esta tienda.
  horarios: "lunes a sábado de 9:00am a 7:00pm, domingos de 10:00am a 3:00pm",
  horariosFrase:
    "Abrimos de lunes a sábado de 9am a 7pm, y domingos de 10am a 3pm 🕘",

  // LA CALIDAD AQUÍ ES DISTINTA A INVICTUS, Y ESTO IMPORTA.
  //
  // Invictus vende una sola gama (1.1) y por eso puede contestar con una
  // frase fija. El Emperador maneja DOS —doble A y triple A—, así que la
  // pregunta "¿qué calidad es?" ya no tiene una respuesta única: depende
  // del par concreto, y eso el bot no lo ve. El catálogo le da un título y
  // una foto, no la gama.
  //
  // Inventarla sería lo peor que podría hacer: el cliente paga esperando
  // una cosa y recibe otra. Así que dice las dos con naturalidad, y si le
  // preguntan por un par concreto, eso lo confirma una persona.
  calidad: `CALIDAD DEL CALZADO

La tienda maneja calidad doble A (AA) y triple A (AAA). No es producto
original de la marca, y cuando preguntan se dice claro. No lo escondas ni
le des vueltas: quien pregunta ya sabe lo que está preguntando, y una
respuesta directa vende más que una evasiva.

Cuando pregunten en general por originalidad, calidad, si son réplicas o
si son de fábrica, responde:

"Manejamos calidad doble A y triple A 😊"

Y sigue vendiendo con una pregunta corta:
"¿Te gusta alguno o te muestro otros modelos?"

DE QUÉ GAMA ES UN PAR CONCRETO: NO LO SABES (crítico).

Tú ves el título y la foto del producto, no su gama. Si el cliente
pregunta de qué calidad es UN modelo en particular —"¿estas son AAA?",
"¿el Jordan cuál es?"— NO lo adivines ni lo supongas por el precio:

"Esa te la confirma un asesor en un momento 😊"

Decir "triple A" de un par que es doble A es la peor equivocación
posible: el cliente paga esperando una cosa y recibe otra.

NUNCA digas que son originales, auténticos ni "de la marca".
NUNCA inventes nada sobre materiales, fábrica, garantía o procedencia.

"buscar" es "NADA", salvo que en el mismo mensaje también pidan un producto
— entonces búscalo y responde las dos cosas.`,

  calidadFrase: "Manejamos calidad doble A y triple A 😊",
  calidadFraseCorta: "Manejamos calidad doble A y triple A.",
  calidadFraseTabla: '"manejamos doble A y triple A"',

  // PENDIENTE — la tabla que traduce lo que dice el cliente al término que
  // SÍ encuentra productos en la Shopify de El Emperador.
  //
  // NO se puede copiar la de Invictus: esa tabla está hecha a la medida de
  // los títulos de la otra tienda, erratas incluidas ("New Balamce", "Ok
  // cloud", los Jordan titulados "Retro 4"). Aplicarla aquí haría que la
  // búsqueda devolviera cero en productos que sí existen — que es
  // exactamente el fallo que hace creer al cliente que no hay stock.
  //
  // Mientras esté vacío, el prompt le dice al modelo que use las palabras
  // del cliente tal cual, que es lo más seguro sin la tabla.
  terminos: "",

  // PENDIENTE — los títulos tal cual están en la Shopify de El Emperador.
  catalogo: "",
  catalogoVision: "",
};

// ─────────────────────────────────────────────────────────────────────
// CÓMO LLENAR LOS TRES PENDIENTES
//
// 1. Saca los títulos de la Shopify de El Emperador. En el panel:
//    Productos → Exportar → CSV. La columna que importa es "Title".
//
// 2. Pégalos en "catalogo", uno por línea, EXACTAMENTE como están
//    escritos, erratas incluidas. Las erratas no se corrigen: la búsqueda
//    es literal contra el título, así que si en Shopify dice "New Balamce",
//    aquí tiene que decir "New Balamce".
//
// 3. "catalogoVision" lleva lo mismo, precedido de esta línea:
//      Estos son los productos de la tienda. Solo puedes identificar
//      modelos que estén en esta lista.
//
// 4. "terminos" se arma mirando esos títulos: por cada modelo, cuál es la
//    palabra más corta que aparece en TODAS sus variantes. Eso es lo que
//    va en la columna derecha. Pásame el CSV y lo genero.
// ─────────────────────────────────────────────────────────────────────
