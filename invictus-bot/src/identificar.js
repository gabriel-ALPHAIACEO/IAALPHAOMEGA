// Red de seguridad determinista para lo que identifica la IA de visión en
// una foto.
//
// EL PROBLEMA QUE RESUELVE. Un modelo "mini" —o incluso uno fuerte— a veces
// se contradice: describe una suela SIN cámara de aire y en la misma
// respuesta nombra un "Air Max 270" — que sin cámara de aire no es nada.
// Pasó de verdad con una foto de Nike Uplift, dos veces seguidas, aunque
// el prompt ya traía la firma visual correcta y una regla explícita
// contra "forzar el ajuste". Afinar el texto no alcanza: la decisión
// final seguía siendo un salto creativo del modelo, no algo verificable.
//
// LA IDEA. La IA sigue describiendo lo que ve — eso se le da bien:
// contestar sí/no sobre un rasgo puntual de la foto. Pero la decisión de
// si "buscar" es COHERENTE con esos rasgos ya no la toma la IA: la toma
// este código, con una tabla de reglas fija. Si el modelo nombra un
// producto que exige un rasgo que él mismo marcó ausente (o prohíbe uno
// que marcó presente), la respuesta se corrige aquí y se baja a nivel
// marca. No hay forma de que un producto que ni la propia IA puede
// sostener con lo que reportó llegue al cliente.
//
// 22-sep-2026: esta verificación ahora corre ENTRE la IA de visión y la
// IA de texto, no adentro de una sola llamada que hacía las dos cosas.
// Por eso ya no reescribe "respuesta" ni "historial" — esos los escribe
// la IA de texto, con su propio tono, a partir del dato ya corregido que
// sale de aquí. Esta función solo corrige el DATO.
//
// NO ES EXHAUSTIVO A PROPÓSITO. Cubre los grupos donde YA hubo fallos
// reales o alto riesgo de confusión (las suelas altas de Nike, Metcon,
// AF1/Dunk/Retro 4/Jordan 40, On Cloud, Samba/Campus/Superstar). El resto
// de marcas sigue dependiendo del prompt solo. Se amplía esta tabla según
// vayan apareciendo más casos reales.

// Las 15 claves que tiene que traer "rasgos". Única fuente de verdad:
// ia.js la importa para armar el schema JSON estricto que le exige a
// OpenAI esta forma exacta — así el prompt y el código nunca se desalinean.
export const RASGOS_CLAVE = [
  "camaraAireTalon",
  "camaraAireCompleta",
  "suelaTransparente",
  "suelaRedondeadaSinAire",
  "suelaPlanaPlacaDura",
  "muescaLateralArco",
  "suelaNubesHuecas",
  "mallaPlasticaCuadros",
  "alasPlasticasCordones",
  "jumpman",
  "swooshGrandeRecto",
  "piezaMetalicaOjal",
  "tresFranjas",
  "punteraGamuzaT",
  "punteraGomaConcha",
];

// term: con qué tiene que EMPEZAR "buscar" (sin distinguir mayúsculas)
//   para que esta regla aplique.
// requiere: rasgos que la IA tiene que haber marcado en true.
// prohibe: rasgos que la IA tiene que haber marcado en false.
// marcaFallback: a qué se baja "buscar" si la regla no se cumple.
//   "NADA" cuando ni siquiera la marca es segura (caso On Cloud: si no
//   hay nubes huecas, no hay nada más en el catálogo que se le parezca).
const REGLAS = [
  {
    term: "air max 270",
    requiere: ["camaraAireTalon"],
    prohibe: ["camaraAireCompleta", "suelaTransparente", "suelaRedondeadaSinAire"],
    marcaFallback: "Nike",
  },
  {
    term: "air max 90",
    requiere: ["camaraAireTalon"],
    prohibe: ["camaraAireCompleta", "suelaTransparente"],
    marcaFallback: "Nike",
  },
  {
    term: "air max 97",
    requiere: ["camaraAireCompleta"],
    prohibe: ["suelaTransparente"],
    marcaFallback: "Nike",
  },
  {
    term: "vapormax",
    requiere: ["suelaTransparente"],
    prohibe: [],
    marcaFallback: "Nike",
  },
  {
    term: "uplift",
    requiere: ["suelaRedondeadaSinAire"],
    prohibe: ["camaraAireTalon", "camaraAireCompleta", "suelaTransparente"],
    marcaFallback: "Nike",
  },
  {
    term: "metcon",
    requiere: ["suelaPlanaPlacaDura", "muescaLateralArco"],
    prohibe: [],
    marcaFallback: "Nike",
  },
  {
    term: "retro 4",
    requiere: ["mallaPlasticaCuadros", "alasPlasticasCordones"],
    prohibe: [],
    marcaFallback: "Nike",
  },
  {
    term: "jordan 40",
    requiere: ["jumpman"],
    prohibe: ["alasPlasticasCordones"],
    marcaFallback: "Nike",
  },
  {
    term: "air force one",
    requiere: ["swooshGrandeRecto", "piezaMetalicaOjal"],
    prohibe: ["mallaPlasticaCuadros"],
    marcaFallback: "Nike",
  },
  {
    term: "dunk",
    requiere: ["swooshGrandeRecto"],
    prohibe: ["piezaMetalicaOjal"],
    marcaFallback: "Nike",
  },
  {
    term: "cloud",
    requiere: ["suelaNubesHuecas"],
    // 21-sep-2026: caso real en producción — una Adidas negra con las TRES
    // FRANJAS bien visibles se identificó como "Cloud". El modelo marcó
    // "suelaNubesHuecas":true quien sabe por qué, y como esa era la única
    // condición de esta regla, no había nada que la contradijera. Las tres
    // franjas de Adidas son una seña que On Cloud nunca tiene — ninguna
    // zapatilla puede ser las dos cosas a la vez — así que ahora esta regla
    // también se dispara si el modelo marcó tresFranjas, sin importar qué
    // dijo sobre la suela.
    prohibe: ["tresFranjas"],
    marcaFallback: "NADA",
  },
  {
    term: "samba",
    requiere: ["tresFranjas", "punteraGamuzaT"],
    prohibe: [],
    marcaFallback: "Adidas",
  },
  {
    term: "campus",
    requiere: ["tresFranjas"],
    prohibe: ["punteraGamuzaT"],
    marcaFallback: "Adidas",
  },
  {
    term: "superstar",
    requiere: ["punteraGomaConcha"],
    prohibe: [],
    marcaFallback: "Adidas",
  },
];

// Recibe lo que devolvió la IA de visión ya normalizado (buscar, rasgos,
// pedirNombreExacto) y devuelve la versión corregida —igual a la original
// si no hay nada que corregir.
export function validarIdentificacion({ buscar, rasgos, pedirNombreExacto }) {
  if (!rasgos || typeof rasgos !== "object") {
    // Sin rasgos no hay con qué verificar: pasa tal cual. Así un cambio
    // de modelo de OpenAI que deje de mandar "rasgos" no rompe nada, solo
    // apaga esta red de seguridad hasta que se note en los registros.
    return {
      buscar,
      pedirNombreExacto: Boolean(pedirNombreExacto),
      corregido: false,
      confirmar: false,
    };
  }

  const buscarNormalizado = String(buscar || "").trim().toLowerCase();
  const regla = REGLAS.find((r) => buscarNormalizado.startsWith(r.term));
  if (!regla) {
    return {
      buscar,
      pedirNombreExacto: Boolean(pedirNombreExacto),
      corregido: false,
      confirmar: false,
    };
  }

  const faltantes = regla.requiere.filter((r) => rasgos[r] !== true);
  const sobrantes = regla.prohibe.filter((r) => rasgos[r] === true);

  if (!faltantes.length && !sobrantes.length) {
    return {
      buscar,
      pedirNombreExacto: Boolean(pedirNombreExacto),
      corregido: false,
      confirmar: false,
    };
  }

  // NO ES LO MISMO "FALTA LO QUE LO CONFIRMA" QUE "HAY ALGO QUE LO
  // CONTRADICE" (22-sep-2026, a raíz de un caso real).
  //
  // Un cliente respondió a una historia preguntando el precio. La IA dijo
  // "Air Force One" y esto lo bajó a "Nike" porque no había marcado la
  // pieza metálica del ojal. Pero la pieza metálica de un AF1 es diminuta
  // y en media foto no se ve: que NO se vea no significa que no esté.
  // Tirar el nombre entero por un detalle invisible es exactamente la
  // contradicción que saltaba a la vista — "si sabe que es un AF1, ¿por
  // qué no lo buscó?".
  //
  // Los dos casos que la tabla detecta son muy distintos:
  //
  //   · SOBRANTES — la IA marcó un rasgo que ese modelo NO puede tener.
  //     Es el caso del Uplift que salía como "Air Max 270": suela
  //     redondeada sin cámara de aire Y "Air Max 270" no pueden ser
  //     verdad a la vez. Eso es una contradicción y se rechaza, igual
  //     que antes.
  //
  //   · SOLO FALTANTES — el rasgo que lo confirmaría no se marcó. Puede
  //     ser que no esté... o que no se vea. Es una duda, no una
  //     contradicción, y ahora se trata como tal: se conserva el nombre
  //     y se BUSCA, pero marcado como "sin confirmar" para que el cotejo
  //     visual lo verifique contra las fotos reales del catálogo y el
  //     cliente confirme si es ese. Comparar la foto con el producto es
  //     mejor juez que la ausencia de un detalle.
  if (!sobrantes.length) {
    console.log(
      `Sin confirmar: la IA dijo "buscar":"${buscar}" y no se ve lo que lo ` +
        `confirmaría (${faltantes.join(", ")}), pero nada lo contradice. ` +
        "Lo busco igual y que lo verifique el cotejo visual."
    );

    return {
      buscar,
      pedirNombreExacto: Boolean(pedirNombreExacto),
      corregido: false,
      // Lo que cambia el resto del flujo: el cotejo visual verifica
      // aunque haya un solo resultado, y la respuesta se escribe
      // preguntando si es ese en vez de afirmándolo.
      confirmar: true,
    };
  }

  const marca = regla.marcaFallback;
  const esNada = marca.toUpperCase() === "NADA";

  console.log(
    `Corrección determinista: la IA dijo "buscar":"${buscar}" pero ella ` +
      `misma marcó un rasgo que ese modelo NO puede tener ` +
      `(${sobrantes.join(", ")}). Bajo a "${esNada ? "NADA" : marca}".`
  );

  return {
    buscar: esNada ? "NADA" : marca,
    // Al bajar a solo la marca, siempre hace falta que el cliente confirme
    // el modelo exacto — por eso se fuerza en true.
    pedirNombreExacto: !esNada,
    corregido: true,
    confirmar: false,
  };
}

// QUÉ MODELOS DEL CATÁLOGO ENCAJAN CON LO QUE SE VIO EN LA FOTO.
//
// Es la tabla de REGLAS leída al revés. validarIdentificacion() la usa
// para descartar ("dijiste Air Force One pero no hay pieza metálica");
// esto la usa para PROPONER: dados los rasgos que la IA marcó, ¿qué
// términos del catálogo son compatibles con ellos?
//
// Nació de un caso real. Un cliente respondió a una historia preguntando
// el precio; la IA dijo "Air Force One", la verificación lo bajó a
// "Nike" porque no se veía la pieza metálica del ojal, y el cotejo
// visual terminó comparando la foto contra los primeros 8 Nike que
// devolvió Shopify — ocho pares cualesquiera, elegidos por el orden del
// catálogo y no por parecerse a la foto. El cotejo se abstuvo, con razón
// ("la suela de la foto es plana, distinta a las del catálogo"), pero
// nunca llegó a ver un solo candidato de la familia correcta.
//
// Con los mismos rasgos —swoosh grande y recto SÍ, pieza metálica en el
// ojal NO— esta función devuelve "dunk": la única regla que los dos
// rasgos satisfacen. Esos son los candidatos que valía la pena mirar.
//
// Solo se proponen términos cuyos rasgos EXIGIDOS estén todos
// presentes. Como ninguna regla tiene la lista de exigidos vacía, un
// término nunca aparece "gratis": hace falta que se haya visto algo
// distintivo suyo.
export function terminosCompatibles(rasgos) {
  if (!rasgos || typeof rasgos !== "object") return [];

  return REGLAS.filter(
    (regla) =>
      regla.requiere.length &&
      regla.requiere.every((clave) => rasgos[clave] === true) &&
      regla.prohibe.every((clave) => rasgos[clave] !== true)
  ).map((regla) => regla.term);
}
