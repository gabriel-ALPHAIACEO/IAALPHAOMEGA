// Qué tienda atiende este Worker.
//
// EL MISMO CÓDIGO SIRVE PARA LAS DOS TIENDAS. Los archivos de src/ son
// idénticos en las dos carpetas de despliegue; lo único que cambia es
// wrangler.toml, donde una dice TIENDA = "invictus" y la otra TIENDA =
// "emperador". Así, cuando se arregla un fallo, se arregla para las dos:
// se pegan los mismos archivos en las dos carpetas y listo.
//
// Lo de antes —copiar el proyecto entero y editarlo— ya se probó en este
// mismo bot (el fork de estherzzerpa) y terminó en dos versiones que se
// fueron separando hasta que ninguna de las dos era la buena.
//
// PARA AGREGAR UNA TERCERA TIENDA: se crea tiendas/loquesea.js copiando
// uno de los dos, se añade aquí abajo, y se despliega con TIENDA =
// "loquesea". Ni una línea más de código.

import { invictus } from "./tiendas/invictus.js";
import { emperador } from "./tiendas/emperador.js";

const TIENDAS = { invictus, emperador };

const POR_DEFECTO = "invictus";

export function tiendaDe(env) {
  const clave = String(env.TIENDA || POR_DEFECTO).trim().toLowerCase();
  const tienda = TIENDAS[clave];

  if (!tienda) {
    // Que falle ruidosamente y no en silencio: con la tienda equivocada el
    // bot se presentaría con el nombre de otro negocio y buscaría en un
    // catálogo que no es. Mejor que no arranque.
    throw new Error(
      `TIENDA = "${clave}" no existe. Las que hay: ${Object.keys(TIENDAS).join(", ")}. ` +
        "Revisa la variable TIENDA en wrangler.toml."
    );
  }

  return tienda;
}

// Rellena los marcadores {{...}} de un prompt con los datos de la tienda.
//
// Los prompts viven sin marca: donde antes decía "INVICTUS SHOES" ahora
// dice {{TIENDA_MAYUSCULAS}}. Así el mismo texto de 1000 líneas —con todo
// el tono, las reglas y los ejemplos que costaron tanto afinar— vale para
// cualquier tienda, y lo único que se cambia por tienda son los datos.
export function rellenar(prompt, tienda, delIndice = {}) {
  const valores = {
    TIENDA: tienda.nombre,
    TIENDA_MAYUSCULAS: tienda.nombreMayusculas,
    HORARIOS: tienda.horarios,
    HORARIOS_FRASE: tienda.horariosFrase,
    CALIDAD: tienda.calidad,
    CALIDAD_FRASE: tienda.calidadFrase,
    CALIDAD_FRASE_CORTA: tienda.calidadFraseCorta,
    CALIDAD_FRASE_TABLA: tienda.calidadFraseTabla,
    TERMINOS: tienda.terminos || SIN_TERMINOS,
    CATALOGO: tienda.catalogo || SIN_CATALOGO,
    CATALOGO_VISION: tienda.catalogoVision || SIN_CATALOGO_VISION,
  };

  // EL ÍNDICE MANDA SOBRE LA LISTA ESCRITA A MANO.
  //
  // indice.js saca los títulos de Shopify cada pocas horas, así que sabe de
  // la mercancía que entró ayer y la lista de abajo no. Cuando el índice
  // trae algo, gana él; cuando está vacío —primer despliegue, D1 caída, el
  // cron todavía sin correr— se queda la lista de la tienda, que es vieja
  // pero cierta. El bot nunca se queda sin catálogo por esto.
  for (const clave of ["CATALOGO", "CATALOGO_VISION"]) {
    if (delIndice[clave]) valores[clave] = delIndice[clave];
  }

  return prompt.replace(/\{\{([A-Z_]+)\}\}/g, (entero, clave) =>
    clave in valores ? valores[clave] : entero
  );
}

// QUÉ SE LE DICE AL MODELO CUANDO LA TIENDA TODAVÍA NO TIENE CATÁLOGO.
//
// Una tienda recién montada no tiene la lista de títulos ni la tabla de
// términos: hay que sacarlas de su Shopify. Mientras tanto el bot tiene
// que seguir atendiendo, y lo importante es que NO se invente nombres —
// un término inventado devuelve cero productos y el cliente cree que no
// hay stock de algo que sí está.
const SIN_TERMINOS = `TÉRMINOS VERIFICADOS

Esta tienda todavía no tiene tabla de términos comprobados.

MIENTRAS TANTO, LA REGLA ES UNA SOLA: usa las palabras EXACTAS del
cliente, sin corregirlas, completarlas ni "mejorarlas". Si dice "air
force", busca "air force" — no "Air Force One Nike".

Y usa el término MÁS CORTO que identifique el producto: máximo 2 o 3
palabras. La búsqueda exige que TODAS las palabras estén en el título,
así que una palabra de más devuelve cero resultados.

NUNCA inventes el nombre completo u oficial de un modelo. Menos palabras
siempre es más seguro que la palabra equivocada.`;

const SIN_CATALOGO = `CATÁLOGO

Todavía no tienes la lista de productos de esta tienda.

Eso significa que NO SABES qué modelos existen aquí. No supongas que hay
algo por ser una marca conocida, y no nombres modelos concretos que no te
haya dicho el cliente. Busca con sus palabras y deja que el catálogo
responda.`;

const SIN_CATALOGO_VISION = `Todavía no tienes la lista de productos de esta tienda.

Identifica el calzado de la foto por lo que VES, y pon en "buscar" el
nombre del modelo tal como se conoce, en el término más corto posible
(la marca y el modelo, sin adornos). Si no reconoces el modelo con
seguridad, quédate en la marca: es preferible a nombrar algo que esta
tienda quizá no maneja.`;
