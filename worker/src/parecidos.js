// "De ese ya te mostré todo" — ¿y ahora qué le enseño?
//
// PARA QUÉ EXISTE. Cuando el cliente pide ver más y el catálogo ya no
// tiene nada nuevo de ese modelo, hay dos formas de contestar:
//
//   Mala:  mandarle el enlace de la tienda. El cliente se va del chat.
//   Buena: sacarle otro par parecido, como haría un vendedor.
//
// Esta tabla es la que permite lo segundo. Es código, no IA: el modelo no
// decide esto, porque una alternativa inventada ("te muestro unas Yeezy
// Boost 350 V2") devuelve cero productos y queda peor que no ofrecer nada.
// Aquí solo hay términos que EXISTEN en los títulos del catálogo.
//
// CÓMO SE ELIGIERON. Por parecido real de silueta y de uso, que es lo que
// hace que el cliente diga "ah, esas también me gustan":
//   · Suela de aire visible entre sí (Vapormax, TN, Air Max, Shox).
//   · Clásicos de lona/cuero entre sí (Air Force One, Dunk, Superstar).
//   · Los Jordan numerados entre sí.
//   · Correr y gimnasio entre sí; montaña entre sí.
//   · Las marcas de lujo entre sí, que es un cliente que compra por marca.
//
// SI AGREGAS UNA ENTRADA: la clave va en minúscula y sin tildes (así llega
// después de normalizar); los valores van escritos como en la TABLA DE
// TÉRMINOS VERIFICADOS del prompt, porque van directos a Shopify.
//
// ESTA TABLA LA COMPARTEN TODAS LAS TIENDAS, y a propósito: el parecido
// entre un Vapormax y un TN es de los zapatos, no de quién los venda. Lo
// que sí es de cada tienda son los TÉRMINOS de la derecha, que tienen que
// existir en SU catálogo. Si una tienda no maneja "Campus", esa búsqueda
// devuelve cero y el bot pasa a la siguiente alternativa o al catálogo —
// se degrada bien, no se rompe. Aun así, cuando una tienda nueva ya tenga
// su lista de productos, conviene repasar que estos nombres existan ahí.

const PARECIDOS = {
  // Suela de aire a la vista
  "vapormax": ["TN", "Air Max", "Shox"],
  "tn": ["Vapormax", "Air Max", "Shox"],
  "air max 270": ["Air Max", "TN", "Vapormax"],
  "air max": ["TN", "Vapormax", "Shox"],
  "shox": ["TN", "Air Max", "Vapormax"],
  "dn": ["Vapormax", "TN", "Air Max"],

  // Clásicos de calle
  "air force one": ["dunk", "Superstar", "Retro 1"],
  "dunk": ["Air Force One", "Retro 1", "Superstar"],
  "cortez": ["Huarache", "Vans", "Nike M2K"],
  "huarache": ["Cortez", "Nike M2K", "P6000"],
  "m2k": ["P6000", "Huarache", "uplift"],

  // Jordan
  "retro 1": ["Retro 4", "dunk", "Air Force One"],
  "retro 3": ["Retro 4", "Retro 5", "Retro 1"],
  "retro 4": ["Retro 5", "Retro 3", "Jordan 40"],
  "retro 5": ["Retro 4", "Retro 3", "Jordan 40"],
  "retro 13": ["Retro 4", "Retro 5", "Jordan 40"],
  "jordan 40": ["Retro 4", "Lebron", "Irving"],
  "retro": ["Jordan 40", "Air Force One", "dunk"],

  // Correr y gimnasio
  "uplift": ["Vomero", "P6000", "Cloud"],
  "vomero": ["uplift", "P6000", "Cloud"],
  "p6000": ["Vomero", "uplift", "Nike M2K"],
  "metcon": ["Alpha", "Nike react", "Reebok"],
  "alpha": ["metcon", "Nike react", "Nike zoom"],
  "nocta": ["Nike zoom", "uplift", "Vomero"],
  "cloud": ["Balance", "Asics", "uplift"],
  "balance": ["Cloud", "Asics", "9060"],
  "9060": ["Balance", "Cloud", "Asics"],
  "asics": ["Balance", "Cloud", "Mizuno"],
  "mizuno": ["Asics", "Balance", "Reebok"],
  "adizero": ["adistar", "Balance", "Nike zoom"],
  "adistar": ["Adizero", "Balance", "Cloud"],

  // Adidas de calle
  "campus": ["samba", "Superstar", "Adidas SL 72"],
  "samba": ["Campus", "Superstar", "Adidas SL 72"],
  "superstar": ["Campus", "samba", "Air Force One"],
  "yeezy": ["Bad Bunny", "Campus", "Adidas"],
  "bad bunny": ["Campus", "Yeezy", "samba"],

  // Montaña y exterior
  "terrex": ["Salomon", "Wildhorse", "Merrell"],
  "salomon": ["terrex", "trail", "Merrell"],
  "merrell": ["Salomon", "terrex", "trail"],
  "trail": ["Wildhorse", "terrex", "Salomon"],
  "wildhorse": ["trail", "terrex", "Salomon"],
  "north face": ["terrex", "Salomon", "Merrell"],
  "tactica": ["Merrell", "terrex", "Salomon"],

  // Jugadores de la NBA — quien pide uno suele mirar los demás
  "lebron": ["Irving", "Kobe", "Morant"],
  "irving": ["Lebron", "Kobe", "Curry"],
  "kobe": ["Lebron", "Irving", "Paul George"],
  "morant": ["Lebron", "Irving", "Giannis"],
  "curry": ["Irving", "Lebron", "Giannis"],
  "giannis": ["Lebron", "Morant", "Curry"],
  "paul george": ["Kobe", "Irving", "Lebron"],
  "lillard": ["Giannis", "Curry", "Morant"],
  "barkley": ["Lebron", "Kobe", "Irving"],

  // Lujo — aquí el cliente compra por marca, no por silueta
  "dior": ["LV", "Hermes", "Dolce"],
  "lv": ["Dior", "Hermes", "Golden"],
  "louis vuitton": ["Dior", "Hermes", "Golden"],
  "hermes": ["Dior", "LV", "Golden"],
  "dolce": ["Dior", "LV", "Armani"],
  "golden": ["Dior", "LV", "Off white"],
  "off white": ["Bape", "Golden", "dunk"],
  "bape": ["Off white", "dunk", "Golden"],
  "armani": ["Calvin", "Hugo", "Dior"],
  "calvin": ["Armani", "Hugo", "LV"],
  "hugo": ["Armani", "Calvin", "Dior"],

  // Cholas — una chola no se sustituye por un zapato
  "chola": ["Mind 001", "Chola Nike", "Chola dama"],
  "mind 001": ["Chola Nike", "Chola dama", "Chola quiksilver"],
  "mind 002": ["uplift", "P6000", "Vomero"],

  // Marcas sueltas
  "puma": ["Adidas", "Reebok", "Vans"],
  "vans": ["Puma", "Skechers", "Cortez"],
  "skechers": ["Vans", "Puma", "Reebok"],
  "reebok": ["Puma", "Skechers", "Mizuno"],
  "alo": ["Puma", "Cloud", "Nike Dama"],
  "veja": ["Vans", "Campus", "Superstar"],
};

// Si el término no está en la tabla, al menos se respeta la marca: a quien
// pide Nike no se le ofrecen Adidas de primeras.
const POR_MARCA = {
  "nike": ["Air Force One", "Air Max", "TN"],
  "adidas": ["Campus", "samba", "Superstar"],
  "jordan": ["Retro 4", "Jordan 40", "Retro 5"],
  "new balance": ["Balance", "9060", "Cloud"],
  "on cloud": ["Cloud", "Balance", "Asics"],
};

// Y si no se reconoce ni la marca —"algo en azul", "dama"— se ofrece lo que
// más se mueve. Nunca se devuelve la lista vacía: quedarse sin nada que
// enseñar es justo lo que hay que evitar.
const LOS_QUE_MAS_SALEN = ["Air Force One", "Adidas Campus", "Cloud", "Retro 4"];

// Términos que valen la pena probar cuando ya no hay nada nuevo de lo que
// pidió. Van en orden: el primero es el más parecido.
export function alternativasPara(termino) {
  const limpio = normalizar(termino);
  if (!limpio) return [...LOS_QUE_MAS_SALEN];

  // La clave MÁS LARGA que aparezca dentro del término gana: así "air max
  // 270" no se queda con la entrada de "air max", que es más genérica.
  const claves = Object.keys(PARECIDOS)
    .filter((clave) => limpio.includes(clave))
    .sort((a, b) => b.length - a.length);

  if (claves.length) return [...PARECIDOS[claves[0]]];

  const marca = Object.keys(POR_MARCA)
    .filter((nombre) => limpio.includes(nombre))
    .sort((a, b) => b.length - a.length)[0];

  if (marca) return [...POR_MARCA[marca]];

  return [...LOS_QUE_MAS_SALEN];
}

function normalizar(termino) {
  return String(termino || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
