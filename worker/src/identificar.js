// Red de seguridad determinista para lo que identifica la IA en una foto.
//
// EL PROBLEMA QUE RESUELVE. El prompt de visión le pide a la IA que mire
// la foto y decida el modelo en la misma pasada. Un modelo "mini" a veces
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
// que marcó presente), la respuesta se rechaza aquí y se baja a nivel
// marca. No hay forma de que un producto que ni la propia IA puede
// sostener con lo que reportó llegue al cliente.
//
// NO ES EXHAUSTIVO A PROPÓSITO. Cubre los grupos donde YA hubo fallos
// reales o alto riesgo de confusión (las suelas altas de Nike, Metcon,
// AF1/Dunk/Retro 4/Jordan 40, On Cloud, Samba/Campus/Superstar). El resto
// de marcas sigue dependiendo del prompt solo. Se amplía esta tabla según
// vayan apareciendo más casos reales — igual que se fue ampliando el
// prompt hasta ahora.

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
    prohibe: [],
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

// Varias, para no sonar a robot repitiendo la misma frase cada vez que
// esto corrige algo. "{marca}" se reemplaza por la marca de respaldo.
const FRASES_DE_BAJADA = [
  "Déjame revisar qué {marca} parecidas tenemos 👟 ¿Sabes cómo se llaman?",
  "Con gusto te muestro opciones de {marca} 👟 ¿Sabes el nombre exacto?",
  "Te busco {marca} parecidas 👟 ¿Recuerdas cómo se llama el modelo?",
];

const SIN_MARCA_SEGURA = "No logro identificar bien ese modelo 😅 ¿Sabes cómo se llama?";

// Recibe lo que devolvió el modelo de visión ya normalizado (buscar,
// rasgos, respuesta, historial) y devuelve la versión corregida —igual a
// la original si no hay nada que corregir.
export function validarIdentificacion({ buscar, rasgos, respuesta, historial }) {
  if (!rasgos || typeof rasgos !== "object") {
    // Sin rasgos no hay con qué verificar: pasa tal cual. Así un cambio
    // de modelo de OpenAI que deje de mandar "rasgos" no rompe nada, solo
    // apaga esta red de seguridad hasta que se note en los registros.
    return { buscar, respuesta, historial, corregido: false };
  }

  const buscarNormalizado = String(buscar || "").trim().toLowerCase();
  const regla = REGLAS.find((r) => buscarNormalizado.startsWith(r.term));
  if (!regla) return { buscar, respuesta, historial, corregido: false };

  const faltantes = regla.requiere.filter((r) => rasgos[r] !== true);
  const sobrantes = regla.prohibe.filter((r) => rasgos[r] === true);

  if (!faltantes.length && !sobrantes.length) {
    return { buscar, respuesta, historial, corregido: false };
  }

  const marca = regla.marcaFallback;
  const esNada = marca.toUpperCase() === "NADA";
  const nuevoBuscar = esNada ? "NADA" : marca;
  const frase = FRASES_DE_BAJADA[Math.floor(Math.random() * FRASES_DE_BAJADA.length)];
  const nuevaRespuesta = esNada ? SIN_MARCA_SEGURA : frase.replace("{marca}", marca);

  console.log(
    `Corrección determinista: la IA dijo "buscar":"${buscar}" pero sus ` +
      `propios rasgos lo contradicen (faltan: ${faltantes.join(", ") || "—"}; ` +
      `sobran: ${sobrantes.join(", ") || "—"}). Bajo a "${nuevoBuscar}".`
  );

  const notaHistorial = `Corrección automática: la foto no calzaba con "${buscar}" según sus propios rasgos. Bajé a ${nuevoBuscar === "NADA" ? "preguntar" : "marca"}.`;

  return {
    buscar: nuevoBuscar,
    respuesta: nuevaRespuesta,
    historial: historial ? `${historial} ${notaHistorial}` : notaHistorial,
    corregido: true,
  };
}
