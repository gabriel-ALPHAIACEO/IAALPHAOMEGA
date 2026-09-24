// INVICTUS SHOES — todo lo que es de ESTA tienda y de ninguna otra.
//
// El resto del Worker no sabe nada de Invictus: los prompts vienen con
// marcadores ({{TIENDA}}, {{CATALOGO}}...) y aquí se rellenan. Para montar
// otra tienda se copia este archivo, se cambia el contenido, y ya — no se
// toca ni una línea de código.
//
// QUÉ ACTUALIZAR CUANDO CAMBIE LA TIENDA:
//   terminos   cuando un término de búsqueda no encuentre lo que debería
//   horarios   si cambian
//   calidad    si cambia lo que se vende
//
//   catalogo   YA NO HACE FALTA TOCARLO (24-sep-2026). Desde que existe
//              src/indice.js, la lista de productos sale sola de Shopify
//              varias veces al día y esa es la que ve la IA. Lo de abajo
//              quedó como respaldo: es lo que se usa si el índice todavía
//              no corrió, si D1 no responde o si Shopify falla. Se puede
//              dejar envejecer sin miedo. Para ver cuál de las dos está
//              usando el bot ahora mismo, entra a /estado.
//
//              Lo que SÍ sigue siendo a mano es "terminos": el índice dice
//              QUÉ HAY, y los términos dicen CÓMO LO PIDE EL CLIENTE
//              ("tn" → TN, "jordan 4" → Retro 4). Eso no se deduce de los
//              títulos. /indice?sincronizar=1 lista lo que entró nuevo,
//              justo para que revises si alguno necesita su término.

export const invictus = {
  // Como se nombra a si misma ante el cliente. Va en la bienvenida.
  nombre: "Invictus Shoes",
  nombreMayusculas: "INVICTUS SHOES",

  // Dos formas del mismo dato: una para la lista de lo que SI puede
  // responder, y otra para cuando le preguntan directamente.
  horarios: "lunes a sábado de 9:00am a 7:00pm, domingos de 10:00am a 3:00pm",
  horariosFrase:
    "Abrimos de lunes a sábado de 9am a 7pm, y domingos de 10am a 3pm 🕘",

  // La respuesta a "¿son originales?". Es la sección entera del prompt,
  // porque cada tienda vende una cosa distinta y lo que puede afirmar
  // cambia con ella.
  calidad: `CALIDAD DEL CALZADO

Todo lo que vende la tienda es calidad 1.1 top quality, la gama más alta. No
es producto original de la marca, y cuando preguntan se dice claro. No lo
escondas ni le des vueltas: quien pregunta ya sabe lo que está preguntando,
y una respuesta directa vende más que una evasiva.

Cuando pregunten por originalidad, calidad, si son réplicas, si son AAA, si
son de fábrica o si son clones, responde:

"Son calidad 1.1 top quality, la mejor que se consigue 😊"

Y sigue vendiendo con una pregunta corta:
"¿Te gusta alguno o te muestro otros modelos?"

NUNCA digas que son originales, auténticos ni "de la marca".
NUNCA inventes nada sobre materiales, fábrica, garantía o procedencia.
Si insisten con detalles técnicos, eso es de asesor:
"Eso te lo confirma un asesor en un momento 😊"

"buscar" es "NADA", salvo que en el mismo mensaje también pidan un producto
— entonces búscalo y responde las dos cosas.`,

  // La frase suelta, para los ejemplos del prompt.
  calidadFrase: "Son calidad 1.1 top quality, la mejor que se consigue 😊",
  calidadFraseCorta: "Todo lo que manejamos es calidad 1.1 top quality.",
  calidadFraseTabla: '"son calidad 1.1 top quality"',

  // La tabla que traduce lo que dice el cliente al término que SÍ encuentra
  // productos en esta Shopify. Está atada a los títulos reales, erratas
  // incluidas ("New Balamce", "Ok cloud"): no vale para otra tienda.
  terminos: `TÉRMINOS VERIFICADOS (crítico — consúltala SIEMPRE primero)

Esta tabla está comprobada contra los títulos reales. La columna derecha es
la palabra que SÍ encuentra productos. Úsala tal cual, aunque el cliente
escriba el nombre de otra forma. Si lo que pide está aquí, no improvises.

  Cliente dice                        Buscar
  ─────────────────────────────────── ──────────────────────
  af1 · air force · fuerza aérea      Air Force One
  air max                             Air Max
  air max 270 · 270                   Air Max 270
  tn · air max plus                   TN
  jordan (sin número)                 Retro
  jordan 4 · retro 4                  Retro 4
  jordan 3 · retro 3                  Retro 3
  jordan 5 · retro 5                  Retro 5
  jordan 1 · retro 1                  Retro 1
  jordan 40                           Jordan 40
  on cloud · oncloud                  Cloud
  new balance · nb                    Balance
  new balance 550                     New Balance 550
  9060                                9060
  yeezy                               Yeezy
  superstar                           Superstar
  campus                              Campus
  samba                               samba
  terrex                              terrex
  adizero                             Adizero
  adistar                             adistar
  bad bunny                           Bad Bunny
  metcon                              metcon
  shox · resortes                     Shox
  p6000 · p600                        P6000
  uplift                              uplift
  vomero                              Vomero
  nocta                               Nocta
  mind 001 · chola mind               Mind 001
  mind 002 · zapato mind              Mind 002
  mind (sin número)                   Mind
  chola · sandalia · chancla ·
  chancleta · slide                   Chola
  alpha                               Alpha
  huarache                            Huarache
  cortez                              Cortez
  vapormax                            Vapormax
  sb · sb dunk · dunk                 dunk
  lebron                              Lebron
  kyrie · kirie · kyrie irving        Irving
  kobe                                Kobe
  paul george · pg                    Paul George
  ja morant                           Morant
  curry                               Curry
  giannis                             Giannis
  lillard                             lillard
  dior · christian dior               Dior
  lv · louis vuitton                  LV
  dolce gabbana                       Dolce
  hermes                              Hermes
  off white                           Off white
  golden goose                        Golden
  bape                                Bape
  bota táctica                        táctica
  wildhorse                           Wildhorse
  trail                               trail
  puma                                Puma
  asics                               Asics
  vans                                Vans
  skechers                            Skechers
  reebok                              Reebok
  mizuno                              Mizuno
  merrell                             Merrell
  salomon                             Salomon
  veja                                Veja
  north face                          North Face
  alo                                 Alo
  armani                              Armani
  calvin klein                        Calvin
  hugo boss                           Hugo
  promoción · oferta · descuento      promoción

POR QUÉ ALGUNAS SE VEN RARAS
Los títulos del catálogo tienen errores de tipeo, y la columna derecha los
esquiva buscando la parte que sí es igual en todos:
  "AF1" no existe en ningún título: todos dicen "Air Force One".
  Hay "On cloud" y también "Ok cloud", por eso solo "Cloud".
  Hay "Kyrie Irving" y "Kirie Irving", por eso solo "Irving".
  Hay "New Balance" y "New Balamce", por eso solo "Balance".
  La mayoría de los Jordan están titulados "Retro 3", "Retro 4"… sin la
  palabra "Jordan", por eso "jordan" a secas busca "Retro".

MIND 001 Y MIND 002 — SON COSAS DISTINTAS (crítico)

  Mind 001  →  son CHOLAS (sandalias)
  Mind 002  →  son ZAPATOS (calzado deportivo)

El número no es un detalle: es lo que decide si le mandas una sandalia o un
zapato. Como la búsqueda exige que todas las palabras estén en el título,
buscar solo "Mind" devuelve los dos tipos mezclados y el cliente recibe
siempre lo mismo, pida lo que pida.

  Cliente dice                              buscar
  ───────────────────────────────────────   ──────────
  "mind 001" · "las 001" · "cholas mind"    Mind 001
  "chola mind" · "sandalias mind"           Mind 001
  "mind 002" · "las 002" · "zapatos mind"   Mind 002
  "mind" a secas                            Mind

SI DICE "MIND" SIN NÚMERO, PREGUNTA POR EL TIPO, NO POR EL NÚMERO.
El cliente no sabe qué significa 001 ni 002. Sí sabe si quiere una chola o
un zapato. Busca "Mind" para que vea las dos, y cierra preguntando:

  "¡Sí tenemos! Ya te las muestro 👟 ¿La quieres en chola o en zapato?"

Cuando conteste, vuelve a buscar CON el número que corresponde:
  dice "chola"  →  Mind 001
  dice "zapato" →  Mind 002

En el historial guarda siempre el número: "Ya busqué: Mind 002."
Si el historial dice que ya buscaste "Mind 002" y el cliente pide más
colores o variantes, repite "Mind 002" — nunca lo bajes a "Mind" a secas.


CHOLAS — NO SON ZAPATOS (crítico)

Una chola es una sandalia, no un calzado deportivo.

En el catálogo las cholas están repartidas en DOS grupos de títulos:
  · Las que dicen "Chola":  Chola Nike · Chola dama · Chola quiksilver ·
                            Chola Nike Ozuna
  · Las Mind 001:           NO llevan la palabra "Chola" en el título,
                            pero son cholas igual.

Por eso ninguna búsqueda sola las trae todas. Tienes que elegir una.

Reconoce como chola cualquiera de estas palabras:
  chola · cholas · sandalia · sandalias · chancla · chancleta · slide

  Cliente dice                        buscar
  ───────────────────────────────────  ─────────────────
  "tienen cholas?"                     Chola
  "cholas de dama"                     Chola dama
  "cholas de hombre / caballero"       Chola caballero
  "cholas Nike"                        Chola Nike
  "las de Ozuna"                       Chola Ozuna
  "cholas quiksilver"                  Chola quiksilver
  "cholas mind" · "chola mind"         Mind 001

SI PIDE CHOLAS EN GENERAL: busca "Chola" y menciona las Mind en la pregunta
de cierre, para que las cuatro Mind 001 no se queden invisibles:

  "¡Por supuesto! Aquí tienes las cholas 👇 También tengo las Mind, ¿te las
   muestro?"

Si dice que sí, la siguiente búsqueda es "Mind 001".

La palabra "Chola" SIEMPRE va primero y nunca se quita — salvo en las Mind,
que se buscan por "Mind 001". Buscar solo "Nike" o solo "dama" devuelve
zapatos, no cholas.

Y al revés: si el cliente pide zapatos, tenis o calzado deportivo, NUNCA
pongas "Chola" en la búsqueda. Si pide zapatos Mind, es "Mind 002".

ERRORES DE TIPEO DEL CLIENTE
Los clientes escriben rápido y con errores. Si lo que escribió se parece
mucho a una entrada de la tabla —le falta o le sobra una letra o un número—
usa la entrada de la tabla, no lo que escribió:
  "p600"          →  P6000
  "adiddas"       →  Adidas
  "superstart"    →  Superstar
  "jordam"        →  Retro
  "nuevo balance" →  Balance
Esto NO contradice la regla de no reescribir: corregir un typo evidente
hacia un término que YA está en la tabla es distinto de cambiar el producto
del cliente por otro que te parece mejor.

SI NO ESTÁ EN LA TABLA
Usa las palabras EXACTAS del cliente, sin corregirlas ni completarlas. Y si
sospechas que una palabra puede estar escrita distinto en el catálogo,
quítala y busca solo con la que sí es segura. Menos palabras siempre es más
seguro que la palabra equivocada.

PROHIBIDO REESCRIBIR:
Fuera de la tabla y de los typos evidentes, NUNCA cambies las palabras del
cliente por otras que te parezcan más correctas o más completas.
  "Retro 4"    →  buscar: "Retro 4"    NO "Jordan 4"
  "Adizero"    →  buscar: "Adizero"    NO "Adidas Adizero Evo"
  "superstar"  →  buscar: "Superstar"  NO "Adidas Superstar Originals"

NOMBRES DE JUGADORES: usa el nombre TAL CUAL, nunca lo conviertas a siglas.
  "Paul George"    →  buscar: "Paul George"
  "unas de LeBron" →  buscar: "Lebron"
  "Kobe"           →  buscar: "Kobe"

REGLA MADRE: ante cualquier duda entre las palabras del cliente y una
versión "más técnica" o "más oficial", SIEMPRE ganan las palabras del
cliente. Tu trabajo NO es corregir al cliente: es copiar lo que dijo,
quitando solo lo que no es parte del nombre del producto.

COLORES: si el cliente NOMBRA un color, PONLO en el término de búsqueda,
detrás de la marca y el modelo. Escríbelo en español y en masculino
singular: "negro", "blanco", "gris", "marrón", "azul". Da igual cómo esté
escrito en el título —"blanca", "full Black", "negro/blanco"—, el sistema
lo reconoce igual. Tú escribe el color normal.

  "air force negras"        →  buscar: "Air Force One negro"
  "el campus en marrón"     →  buscar: "Adidas Campus marrón"
  "terrex negro y blanco"   →  buscar: "Adidas terrex negro blanco"
  "tienen algo en azul?"    →  buscar: "azul"

Si NO hay de ese color, el sistema te lo resuelve solo: al cliente le sale
el mensaje de "déjame confirmarte con un asesor". Tú no tienes que
adivinarlo ni avisar de nada — escribe la respuesta normal.

CUIDADO, esto es distinto: preguntar POR LOS COLORES no es pedir un color.
Ahí no hay color que poner, porque quiere verlos todos.
  "¿qué colores tienen?"        →  buscar: "NADA"
  "¿hay más colores del TN?"    →  buscar: "TN"       (sin color)
  "¿de qué colores hay campus?" →  buscar: "Adidas Campus"  (sin color)

GÉNERO: los títulos SÍ llevan género, escrito "dama", "caballero" o "niño".
Si el cliente indica para quién es, agrégalo. Si pregunta en general por un
segmento sin marca ni modelo, "buscar" es solo esa palabra.
Ojo: no todas las marcas tienen todos los géneros. Si el cliente pide una
combinación que suena rara (una marca para niño, por ejemplo), busca solo
la marca o solo el género, nunca los dos.

PROMOCIONES: si pregunta por ofertas, descuentos o rebajas, busca
"promoción" (con acento, como está en el catálogo).

CATÁLOGO GENERAL: si pide ver lo que tienes en general, elige UNA marca de
la lista del catálogo y búscala. No repitas una marca ya usada en el
historial.

VER MÁS: si pide ver más, otros modelos u otra cosa —"¿qué más tienen?",
"¿hay otros?", "¿eso es todo?", "¿no tienen más?"— NO lo mandes a la tienda
online. Elige OTRA marca o modelo de la lista del catálogo, distinto de lo
que ya buscaste según el historial, y ponlo en "buscar". El cliente pidió
ver más zapatos: enséñaselos.

  Historial dice "Ya busqué: Nike"  →  buscar: "Adidas"
  Historial dice "Ya busqué: Retro 4"  →  buscar: "Air Force One"
  Historial vacío                   →  buscar: "Nike"

EL ENLACE DE LA TIENDA no lo escribes tú NUNCA, ni lo ofreces. Cuando el
cliente lo pide por su nombre —"mándame el catálogo", "¿me pasas el link?"—
otro mensaje se encarga y tú ni te enteras. Tu trabajo es el contrario:
mantener la conversación aquí, mostrando calzado.`,

  // Los títulos tal cual están en Shopify. Sin esto el modelo inventa
  // nombres y la búsqueda devuelve cero.
  catalogo: `CATÁLOGO — NOMBRES REALES

Estos son los productos que existen en la tienda, escritos EXACTAMENTE como
aparecen en los títulos:

Adidas Adistar XLG beige caballero
Adidas Adizero Evo SL Caballero
Adidas Adizero Evo SL Dama
Adidas Bad Bunny Benito caballero
Adidas Bad Bunny Dama
Adidas Bad Bunny caballero
Adidas Campus Dama
Adidas Campus Dama/Caballero
Adidas Campus gris caballero
Adidas Campus marrón caballero
Adidas Damian lillard X caballero
Adidas Gallagher dama y caballero
Adidas Gallangher caballero
Adidas SL 72 dama
Adidas SL72 dama
Adidas Superstar negro blanco dama
Adidas Swicth Dama/Caballero
Adidas Switch Dama
Adidas Terrex caballero
Adidas Yeezy 700 caballero
Adidas Yeezy 700 dama/caballero
Adidas adistar XLG caballero
Adidas adistar XLG gris caballero
Adidas caballero
Adidas caballero promoción
Adidas campus azul marino caballero
Adidas campus negro caballero
Adidas dama
Adidas dama promoción
Adidas promoción dama
Adidas samba clásicos dama
Adidas samba dama
Adidas super Nova dama
Adidas terrex azul marino caballero
Adidas terrex blanco/negro caballero
Adidas terrex gris caballero
Adidas terrex negro caballero
Adidas terrex negro gris caballero
Adidas terrex negro/blanco caballero
Adizero Evo SL caballero
Adizero caballero
Air Force One ED dama
Air Force One GLDDMY Gris Blanco Caballero
Air Force One Gucci caballero
Air Force One Kobe beige caballero
Air Force One Kobe morado caballero
Air Force One Kobe negro caballero
Air Force One Kobe rojo caballero
Air Force One Negro dama
Air Force One clásicos blancos dama
Air Force One marrón blanco Caballero
Air Force One negro gamuza Caballero
Air Force One suela Vibram caballero
Air Force One trenzas gruesas caballero
Air Max 270 New Caballero/ Dama
Air Max 270 New caballero
Air Max 270 caballero
Air Max Élite Caballero
Alo Caballero
Alo Dama
Armani Exchange Caballero
Asics Caballero
Asics Dama
Asics GT-2160 dama
Bape Sta caballero
Bota táctica caballero
Bota táctica dama
Calvin Klein caballero
Charles Barkley Caballero
Chola Nike Ozuna Caballero
Chola Nike caballero
Chola Nike dama
Chola dama
Chola quiksilver dama
Cristian Dior B27 caballero
Cristian Dior B30 caballero
Cristian Dior B30 dama
Cristian Dior caballero
Cristian Dior khrono Dama
DC shoes acsed caballero
Dc shoes ascend caballero
Dior B22 caballero
Dolce Gabanna caballero
Emporio Armani Caballero
Giannis caballero
Golden Goose
Golden Goose Dama
Hermes Bounccing Caballero
Hermes Gramme Caballero
Huarache negro dorado
Hugo Boss Caballero
Ja Morant 3 caballero
Ja Morant 3 negra azul caballero
Ja Morant 3 negro azul caballero
Ja Morant 3 roja caballero
Ja Morant 3 verde caballero
Jordan 40 Dorado tornasol Caballero
Jordan 40 blanca caballero
Jordan 40 caballero
Jordan 40 negro blanco caballero
Jordan 40 negro gris rojo caballero
Jordan Lukka caballero
Jordan Retro 5 azul university caballero
Jordan Retro 5 beige gris caballero
Jordan Retro 5 blanco vino verde caballero
Jordan Retro 5 gris caballero
Jordan Retro 5 negra caballero
Jordan Retro 5 negro gris caballero
Jordan Retro 5 roja caballero
Kirie Irving 4 caballero
Kirie Irving 4 dama/caballero
Kobe Bryant Caballero
Kyrie Irving 1 caballero
Kyrie Irving 1 dama
Kyrie Irving 2 caballero
Kyrie Irving 3 caballero
LV caballero
LV trainer caballero
Lebron 15 caballero
Lebron 4 caballero
Lebron Witness 5 Caballero/ Dama
Lebron Witness 5 Caballero/Dama
Lebron Witness 5 blanco caballero
Lebron Witness 9 azul turquesa caballero
Lebron Witness 9 blanco caballero
Lebron Witness 9 negro beige caballero
Lebron Witness 9 roja caballero
Lebron Witness 9 roja negro caballero
Lebron Witness 9 rosada beige caballero
Lebron soldier 9 gris amarillo naranja caballero
Louis Vuitton Caballero
Merrell Caballero
Metcon 6 dama
Metcon 7 dama
Mizuno caballero
Mizuno gris caballero
Mizuno negro caballero
NB 530 MIU MIU Dama
New Balamce 9060 dama
New Balance 1000 Dama
New Balance 2000 caballero
New Balance 2000 dama/caballero
New Balance 509 caballero
New Balance 550 dama
New Balance 9060 Caballero
New Balance 9060 marrón verde caballero
New Balance Caballero
New Balance Course Rebel Caballero
New Balance More Dama
New Balance More Dama/Caballero
New balance 2000 dama
New balance 530 dama
New balance 9060 verde caballero
Nike 12 resortes caballero
Nike 2k5 dama
Nike 4 resortes supreme Caballero
Nike Air Max TN plus Dama
Nike Air Max caballero
Nike Air Max liquitmax blanco caballero
Nike Air Max liquitmax gris caballero
Nike Air Max liquitmax negro caballero
Nike Alpha blanca roja negro caballero
Nike Alpha negro blanco caballero
Nike Alpha negro caballero
Nike Alpha roja gris blanco caballero
Nike Cortez Dama
Nike DN 8 Caballero
Nike DN 8 dama
Nike DN caballero
Nike Dama
Nike Hiperdunk caballero
Nike Hiperset Caballero
Nike Huarache caballero
Nike M2K caballero
Nike Metcon 6 Caballero
Nike Metcon 6 Dama/Caballero
Nike Mind 001 Caballero
Nike Mind 001 Dama/Caballero
Nike Mind 001 caballero/ dama
Nike Mind 001 caballero/dama
Nike Mind 002 Caballero
Nike Mind 002 Dama
Nike Mind 002 caballero/Dama
Nike Nocta 1 caballero
Nike Nocta 2 caballero
Nike P6000 caballero
Nike P6000 dama
Nike P6000 gris azul caballero
Nike P6000 negro dama/caballero
Nike P6000 nergro/gris/blanco caballero
Nike P6000 plateado caballero
Nike Pegasus 2K5 dama
Nike Pegasus Premium caballero
Nike Shox 12 resortes Caballero
Nike Shox 12 resortes dama
Nike Shox 4 resorte caballero
Nike Shox 4 resortes Caballero
Nike TN caballero
Nike Trail dama y caballero
Nike Vapormax plus caballero
Nike Vomero 5 caballero
Nike Vomero 5 dama
Nike Vomero 5 dama/caballero
Nike Waffle trainer 2 caballero
Nike Wildhorse 10 Caballero
Nike ava Rover beige dama
Nike ava Rover caballero
Nike ava Rover negro dama
Nike bailleli dama
Nike metcon 6 dama
Nike metcon 6 negro dama
Nike metcon 7 azul caballero
Nike metcon 7 azul celeste dama
Nike metcon 7 beige dama/caballero
Nike metcon 7 blanco dama/caballero
Nike metcon 7 blanco negro caballero
Nike metcon 7 blanco rosado dama
Nike metcon 7 gris blanco caballero
Nike metcon 7 negro beige dama
Nike metcon 7 negro blanco dama/caballero
Nike metcon 7 negro dama/caballero
Nike metcon 7 negro gris caballero
Nike metcon 7 negro rojo caballero
Nike metcon 7 rosado dama
Nike promoción
Nike promoción caballero
Nike promoción dama
Nike pulse dama
Nike react caballero
Nike renew negro blanco dama
Nike renew negro caballero
Nike retro 1 caballero
Nike shox 12 resortes dama/caballero
Nike total 90 caballero
Nike total 90 tacos de futbol gris vino caballero
Nike trail Dama
Nike trail wildhorse 10 dama
Nike uplift azul dama
Nike uplift azul suela blanca
Nike uplift blanco dama
Nike uplift blanco negro caballero
Nike uplift blanco negro det morado dama
Nike uplift negro blanco caballero
Nike uplift negro gris caballero
Nike uplift negro rosado dama
Nike uplift todo blanco caballero/dama
Nike zoom caballero
Nike zoom dama
Off white Dama/Juvenil
Ok Cloud Caballero
Ok cLoud blanco vinotinto ee caballero
On Cloud Dama
On Cloud Dama/Caballero
On Cloud niño
On cLoud Loewe blanco caballero
On cLoud gris caballero
On cloud Beige dama
On cloud Loewe gris suela blanca caballero
On cloud Monster dama/caballero
On cloud Monster new dama/caballero
On cloud beige blanco dama
On cloud beige caballero
On cloud beige crema negro caballero
On cloud beige gris caballero
On cloud blanco/negro caballero
On cloud bota beige caballero
On cloud bota caballero
On cloud casual negro caballero
On cloud gris dama/caballero
On cloud loewe blanco crema dama
On cloud loewe caballero
On cloud loewe negro dama
On cloud negro dama/caballero
On cloud negro naranja caballero
Paul George 2 caballero
Paul George caballero
Puma 180 caballero
Puma Dama
Puma Palermo Niño
Puma caballero
Reebok caballero
Reebok energy 4 caballero
Retro 1 Low Caballero
Retro 1 low Paris dama
Retro 1 low Travis Phantom caballero
Retro 1 low travis caballero
Retro 13 Caballero
Retro 3 dama/caballero
Retro 3 full black dama
Retro 3 niño
Retro 3 niños
Retro 4 caballero
Retro 4 dama
Retro 4 full Black Caballero
Retro 4 niño
SB Dunk Caballero
SB Dunk supreme caballero
Salomon XT-6 dama
Sb dunk play station verde caballero
Sb dunk supreme beige caballero
Skechers caballero
Skechers dama
Stephen Curry 4 caballero
Superstar Dama
Superstar azul blessd caballero
Superstar beige Ed dama
Superstar clasico blessd caballero
Superstar edición limitada dama
TN niño
The North Face Caballero
Vans Caballero
Veja Dama
Wildhorse Dama
Wildhorse caballero
Yeezy caballero
nike a'ja wilson a'one caballero`,

  // El mismo catálogo, con la cabecera que espera el prompt de visión.
  catalogoVision: `Estos son los productos de la tienda. Solo puedes identificar modelos que
estén aquí:

Adidas Adistar XLG beige caballero
Adidas Adizero Evo SL Caballero
Adidas Adizero Evo SL Dama
Adidas Bad Bunny Benito caballero
Adidas Bad Bunny Dama
Adidas Bad Bunny caballero
Adidas Campus Dama
Adidas Campus Dama/Caballero
Adidas Campus gris caballero
Adidas Campus marrón caballero
Adidas Damian lillard X caballero
Adidas Gallagher dama y caballero
Adidas Gallangher caballero
Adidas SL 72 dama
Adidas SL72 dama
Adidas Superstar negro blanco dama
Adidas Swicth Dama/Caballero
Adidas Switch Dama
Adidas Terrex caballero
Adidas Yeezy 700 caballero
Adidas Yeezy 700 dama/caballero
Adidas adistar XLG caballero
Adidas adistar XLG gris caballero
Adidas caballero
Adidas caballero promoción
Adidas campus azul marino caballero
Adidas campus negro caballero
Adidas dama
Adidas dama promoción
Adidas promoción dama
Adidas samba clásicos dama
Adidas samba dama
Adidas super Nova dama
Adidas terrex azul marino caballero
Adidas terrex blanco/negro caballero
Adidas terrex gris caballero
Adidas terrex negro caballero
Adidas terrex negro gris caballero
Adidas terrex negro/blanco caballero
Adizero Evo SL caballero
Adizero caballero
Air Force One ED dama
Air Force One GLDDMY Gris Blanco Caballero
Air Force One Gucci caballero
Air Force One Kobe beige caballero
Air Force One Kobe morado caballero
Air Force One Kobe negro caballero
Air Force One Kobe rojo caballero
Air Force One Negro dama
Air Force One clásicos blancos dama
Air Force One marrón blanco Caballero
Air Force One negro gamuza Caballero
Air Force One suela Vibram caballero
Air Force One trenzas gruesas caballero
Air Max 270 New Caballero/ Dama
Air Max 270 New caballero
Air Max 270 caballero
Air Max Élite Caballero
Alo Caballero
Alo Dama
Armani Exchange Caballero
Asics Caballero
Asics Dama
Asics GT-2160 dama
Bape Sta caballero
Bota táctica caballero
Bota táctica dama
Calvin Klein caballero
Charles Barkley Caballero
Chola Nike Ozuna Caballero
Chola Nike caballero
Chola Nike dama
Chola dama
Chola quiksilver dama
Cristian Dior B27 caballero
Cristian Dior B30 caballero
Cristian Dior B30 dama
Cristian Dior caballero
Cristian Dior khrono Dama
DC shoes acsed caballero
Dc shoes ascend caballero
Dior B22 caballero
Dolce Gabanna caballero
Emporio Armani Caballero
Giannis caballero
Golden Goose
Golden Goose Dama
Hermes Bounccing Caballero
Hermes Gramme Caballero
Huarache negro dorado
Hugo Boss Caballero
Ja Morant 3 caballero
Ja Morant 3 negra azul caballero
Ja Morant 3 negro azul caballero
Ja Morant 3 roja caballero
Ja Morant 3 verde caballero
Jordan 40 Dorado tornasol Caballero
Jordan 40 blanca caballero
Jordan 40 caballero
Jordan 40 negro blanco caballero
Jordan 40 negro gris rojo caballero
Jordan Lukka caballero
Jordan Retro 5 azul university caballero
Jordan Retro 5 beige gris caballero
Jordan Retro 5 blanco vino verde caballero
Jordan Retro 5 gris caballero
Jordan Retro 5 negra caballero
Jordan Retro 5 negro gris caballero
Jordan Retro 5 roja caballero
Kirie Irving 4 caballero
Kirie Irving 4 dama/caballero
Kobe Bryant Caballero
Kyrie Irving 1 caballero
Kyrie Irving 1 dama
Kyrie Irving 2 caballero
Kyrie Irving 3 caballero
LV caballero
LV trainer caballero
Lebron 15 caballero
Lebron 4 caballero
Lebron Witness 5 Caballero/ Dama
Lebron Witness 5 Caballero/Dama
Lebron Witness 5 blanco caballero
Lebron Witness 9 azul turquesa caballero
Lebron Witness 9 blanco caballero
Lebron Witness 9 negro beige caballero
Lebron Witness 9 roja caballero
Lebron Witness 9 roja negro caballero
Lebron Witness 9 rosada beige caballero
Lebron soldier 9 gris amarillo naranja caballero
Louis Vuitton Caballero
Merrell Caballero
Metcon 6 dama
Metcon 7 dama
Mizuno caballero
Mizuno gris caballero
Mizuno negro caballero
NB 530 MIU MIU Dama
New Balamce 9060 dama
New Balance 1000 Dama
New Balance 2000 caballero
New Balance 2000 dama/caballero
New Balance 509 caballero
New Balance 550 dama
New Balance 9060 Caballero
New Balance 9060 marrón verde caballero
New Balance Caballero
New Balance Course Rebel Caballero
New Balance More Dama
New Balance More Dama/Caballero
New balance 2000 dama
New balance 530 dama
New balance 9060 verde caballero
Nike 12 resortes caballero
Nike 2k5 dama
Nike 4 resortes supreme Caballero
Nike Air Max TN plus Dama
Nike Air Max caballero
Nike Air Max liquitmax blanco caballero
Nike Air Max liquitmax gris caballero
Nike Air Max liquitmax negro caballero
Nike Alpha blanca roja negro caballero
Nike Alpha negro blanco caballero
Nike Alpha negro caballero
Nike Alpha roja gris blanco caballero
Nike Cortez Dama
Nike DN 8 Caballero
Nike DN 8 dama
Nike DN caballero
Nike Dama
Nike Hiperdunk caballero
Nike Hiperset Caballero
Nike Huarache caballero
Nike M2K caballero
Nike Metcon 6 Caballero
Nike Metcon 6 Dama/Caballero
Nike Mind 001 Caballero
Nike Mind 001 Dama/Caballero
Nike Mind 001 caballero/ dama
Nike Mind 001 caballero/dama
Nike Mind 002 Caballero
Nike Mind 002 Dama
Nike Mind 002 caballero/Dama
Nike Nocta 1 caballero
Nike Nocta 2 caballero
Nike P6000 caballero
Nike P6000 dama
Nike P6000 gris azul caballero
Nike P6000 negro dama/caballero
Nike P6000 nergro/gris/blanco caballero
Nike P6000 plateado caballero
Nike Pegasus 2K5 dama
Nike Pegasus Premium caballero
Nike Shox 12 resortes Caballero
Nike Shox 12 resortes dama
Nike Shox 4 resorte caballero
Nike Shox 4 resortes Caballero
Nike TN caballero
Nike Trail dama y caballero
Nike Vapormax plus caballero
Nike Vomero 5 caballero
Nike Vomero 5 dama
Nike Vomero 5 dama/caballero
Nike Waffle trainer 2 caballero
Nike Wildhorse 10 Caballero
Nike ava Rover beige dama
Nike ava Rover caballero
Nike ava Rover negro dama
Nike bailleli dama
Nike metcon 6 dama
Nike metcon 6 negro dama
Nike metcon 7 azul caballero
Nike metcon 7 azul celeste dama
Nike metcon 7 beige dama/caballero
Nike metcon 7 blanco dama/caballero
Nike metcon 7 blanco negro caballero
Nike metcon 7 blanco rosado dama
Nike metcon 7 gris blanco caballero
Nike metcon 7 negro beige dama
Nike metcon 7 negro blanco dama/caballero
Nike metcon 7 negro dama/caballero
Nike metcon 7 negro gris caballero
Nike metcon 7 negro rojo caballero
Nike metcon 7 rosado dama
Nike promoción
Nike promoción caballero
Nike promoción dama
Nike pulse dama
Nike react caballero
Nike renew negro blanco dama
Nike renew negro caballero
Nike retro 1 caballero
Nike shox 12 resortes dama/caballero
Nike total 90 caballero
Nike total 90 tacos de futbol gris vino caballero
Nike trail Dama
Nike trail wildhorse 10 dama
Nike uplift azul dama
Nike uplift azul suela blanca
Nike uplift blanco dama
Nike uplift blanco negro caballero
Nike uplift blanco negro det morado dama
Nike uplift negro blanco caballero
Nike uplift negro gris caballero
Nike uplift negro rosado dama
Nike uplift todo blanco caballero/dama
Nike zoom caballero
Nike zoom dama
Off white Dama/Juvenil
Ok Cloud Caballero
Ok cLoud blanco vinotinto ee caballero
On Cloud Dama
On Cloud Dama/Caballero
On Cloud niño
On cLoud Loewe blanco caballero
On cLoud gris caballero
On cloud Beige dama
On cloud Loewe gris suela blanca caballero
On cloud Monster dama/caballero
On cloud Monster new dama/caballero
On cloud beige blanco dama
On cloud beige caballero
On cloud beige crema negro caballero
On cloud beige gris caballero
On cloud blanco/negro caballero
On cloud bota beige caballero
On cloud bota caballero
On cloud casual negro caballero
On cloud gris dama/caballero
On cloud loewe blanco crema dama
On cloud loewe caballero
On cloud loewe negro dama
On cloud negro dama/caballero
On cloud negro naranja caballero
Paul George 2 caballero
Paul George caballero
Puma 180 caballero
Puma Dama
Puma Palermo Niño
Puma caballero
Reebok caballero
Reebok energy 4 caballero
Retro 1 Low Caballero
Retro 1 low Paris dama
Retro 1 low Travis Phantom caballero
Retro 1 low travis caballero
Retro 13 Caballero
Retro 3 dama/caballero
Retro 3 full black dama
Retro 3 niño
Retro 3 niños
Retro 4 caballero
Retro 4 dama
Retro 4 full Black Caballero
Retro 4 niño
SB Dunk Caballero
SB Dunk supreme caballero
Salomon XT-6 dama
Sb dunk play station verde caballero
Sb dunk supreme beige caballero
Skechers caballero
Skechers dama
Stephen Curry 4 caballero
Superstar Dama
Superstar azul blessd caballero
Superstar beige Ed dama
Superstar clasico blessd caballero
Superstar edición limitada dama
TN niño
The North Face Caballero
Vans Caballero
Veja Dama
Wildhorse Dama
Wildhorse caballero
Yeezy caballero
nike a'ja wilson a'one caballero`,
};
