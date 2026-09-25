# EPICELL — estado y lo que falta (22-sep-2026)

## Hecho: nunca más "no tengo" de algo que sí está (24-sep-2026)

Del registro del dueño, y es el peor error que puede cometer este bot:

```
Cliente: "Tienes Poco X8 pro?"
Buscó:   "Poco" → 4 resultados
Mandó:   "No tengo el Poco X8 Pro en este momento 😊 Pero te muestro los
          equipos de la marca Poco..."
Fichas:  Poco X8 pro 5G · Poco M8 pro 5G · Poco M8 pro 5G · Poco C81 pro
```

**El primer equipo del carrusel era el que decía no tener.** El cliente lee
"no tengo" y se va, con la foto de lo suyo pasándole por delante.

La causa fue la sección que se añadió el mismo día sobre buscar la
categoría: le enseñó al modelo a decir "ese no lo manejo, pero mira estos".
Arreglado por los dos lados:

- **En el código:** antes de mandar, se mira si entre los productos que van
  a salir está lo que el cliente nombró. Si está y la respuesta dice "no
  tengo" (o "no hay", "no me queda", "agotado"…), la frase se cambia por un
  sí. Si NO está —pidió un modelo que no existe y se le enseñan otros de la
  marca—, la frase del modelo se respeta: ahí es la verdad.
- **En el prompt:** prohibido decir que no hay algo, en cualquiera de sus
  formas. El modelo escribe ANTES de que se haga la búsqueda, así que esa
  frase es siempre una apuesta — y la lista que tiene delante está llena de
  erratas y nombres raros. Si de verdad no hay nada, el sistema lo ve y
  responde por él pasando al asesor.

**Y de paso, buscar lo que le pidieron.** El cliente dijo "Poco X8 pro" y
la búsqueda se hizo con "Poco" a secas: por eso salieron cuatro equipos en
vez del suyo. El prompt ahora dice que la marca sola es para cuando el
cliente no nombra más que la marca.

## Hecho: fotos y precio en vez de un inventario escrito (24-sep-2026)

```
Cliente: "Precio de los cables dophin"
Bot:     "No tengo cables Dophin por ahora. Si te interesa, aquí están
          los cables que tengo disponibles:
          🔹 Samsung Cable Tipo C 1Metro
          🔹 Skydolphing cable 4 en 1 S40E
          ..."
```

Seis nombres escritos, ni una foto, ni un precio. Eso es un inventario, no
una venta. Y además **era mentira**: sí hay cables "dolphin" — en la hoja
se llaman **Skydolphing**.

Tres arreglos, de lo más de fondo a lo más de superficie:

1. **La búsqueda ahora encuentra una palabra DENTRO de otra más larga.**
   "dophin" no era prefijo de "skydolphing" ni se le parecía como palabra
   entera (6 letras contra 11), así que la búsqueda devolvía cero. Ahora se
   compara contra los trozos de la palabra larga, con el mismo margen de
   erratas de siempre: "dolphin" está dentro de "Skydolphing", y "dophin"
   se le parece en una letra. Solo con palabras de 5 letras o más, para que
   no pesque media tienda.
2. **Rescate por categoría.** Si aun así no hay resultados —"cargador
   anker", "forro de iphone 20"— se prueban las palabras del término por
   separado y con la primera que devuelva algo se le enseña ESO, con sus
   fotos y sus precios: "Ese exacto no lo tengo, pero mira estos 👇".
3. **El prompt tiene prohibido recitar el catálogo.** Sección nueva: si no
   tiene lo que piden, pone en "buscar" la CATEGORÍA (cable, cargador,
   audífonos) y deja que salgan las fichas. Y se le advierte que los
   nombres de la hoja están llenos de erratas y marcas raras, así que no
   afirme que algo no existe por no verlo escrito igual.

## Hecho: la lista escrita no se pega encima de las fotos (24-sep-2026)

El cliente pidió *"me mandas las fotos de los cables?"* y recibió las fotos
con los siete nombres escritos encima:

```
Claro, aquí tienes los cables que tengo disponibles 👇
🔹 Samsung Cable Tipo C 1Metro
🔹 Yookie Cable 2 en 1 CB97
...
```

…y debajo, el carrusel con esas mismas fotos y esos mismos nombres. Dos
veces lo mismo, y las fotos empujadas media pantalla hacia abajo.

Lo escribía el modelo, que desde que aprendió a dar formato a las listas
las usa también donde no tocan. Se corta por los dos lados:

- **En el código:** cuando el turno va a mandar fichas, las líneas
  enumeradas del texto se quitan antes de enviarlo. Se queda la frase de
  arriba y la pregunta del final; si el mensaje era solo la lista, se
  sustituye por "¡Aquí los tienes! 👇".
- **En el prompt:** sección nueva **CUÁNDO NO VA UNA LISTA**. Si va a
  buscar, no enumera — y además no puede saber qué va a encontrar, así que
  una lista escrita por él puede nombrar equipos que luego no aparecen.

La lista escrita sigue existiendo, pero solo donde toca: cuando el cliente
pide una lista, y la manda el sistema desde la hoja.

**Y ya que EPICELL no tiene tienda online:** el mensaje que iba pegado
debajo del carrusel —"Tengo más de ese modelo 😊 En el catálogo los ves
todos 👇"— **ya no se manda**. No se sustituyó por otra frase: un tercer
mensaje detrás de las fotos es una notificación más para no decir nada.
Cuando `URL_CATALOGO` tenga una dirección de verdad, vuelve solo con su
botón, sin tocar el código.

Igual con el resto: "¿qué más tienen?" ahora abre la lista por marcas, con
un botón por marca, en vez de mandar a nadie a ninguna parte; y cuando no
se encuentra un modelo, la respuesta se queda en el asesor, sin la coletilla
del catálogo.

## Hecho: la lista de productos, con sus botones (24-sep-2026)

Quien pide una lista no está buscando un modelo: está mirando qué hay. Y el
carrusel es lo peor para eso — entran diez, hay que deslizar uno por uno y
de una marca con veinte el cliente ve diez sin saber que hay más.

Ahora:

1. **"Mándame la lista de Samsung"** → la lista **escrita**, una línea por
   equipo con su precio, en uno o dos mensajes como mucho. Si no caben
   todos, dice cuántos quedaron fuera.
2. Debajo, **"¿Quieres ver las imágenes de esta lista? 📸"** con dos
   botones: **¡Sí, claro!** y **No, gracias**.
3. Si dice que sí —tocando el botón o escribiendo "dale"—, van las fichas
   con foto de esos mismos equipos. Si dice que no, se le ofrece seguir por
   el que le interese.

**Si pide "la lista" sin decir marca**, no se elige por él: se le enseñan
las marcas que hay en la hoja, **un botón por marca**, y al tocar una llega
su lista. Las marcas salen de la propia hoja (la primera palabra del
título), así que entra una marca nueva sin tocar el código.

Nada de esto pasa por el modelo: la hoja dice qué hay, y el modelo con
veinte equipos delante acaba eligiendo diez y quedándose corto.

## Hecho: fuera el botón "Ver producto" (24-sep-2026)

EPICELL no tiene tienda online, así que ese botón de las fichas no llevaba
a ninguna parte. Se apagó con una línea (`const VER_PRODUCTO = false` en
`instagram.js`), con las instrucciones al lado para volver a encenderlo
apuntando a donde haga falta.

**Y de paso, uno peor:** `URL_CATALOGO` seguía con el marcador de relleno
del wrangler.toml (`https://CAMBIA-ESTO.com`), así que cada vez que el bot
mandaba el botón "Ver catálogo" —cuando no encuentra algo, cuando piden ver
más— estaba mandando a sus clientes a una página inventada. Ahora ese botón
**solo sale si hay una dirección de verdad**; si no, va el mismo texto sin
botón.

Queda pendiente decidir algo de producto: sin catálogo web, las frases que
dicen "aquí tienes el catálogo completo" suenan raras aunque ya no lleven
botón. Se pueden reescribir para que ofrezcan seguir buscando en el chat.

## Hecho: el post compartido no llegaba como "share" (24-sep-2026)

**La prueba, en el propio registro del dueño:**

```
(log) Meta → ATIENDO texto de:1391... texto:""
(log) Busqué "Poco": 4 resultado(s)
(log) Meta ← mandé: 4 ficha(s): Poco X8 pro 5G · Poco M8 pro 5G · ...
```

`texto`, no `publicacion`, y **sin una sola letra**. Meta mandó el post
compartido con un tipo de adjunto que el código no reconocía, así que no
era ni foto, ni historia, ni publicación: llegó un mensaje en blanco. Y el
modelo, al que no se le puede pedir que conteste la nada, rellenó con lo
último del historial — cuatro Poco cualesquiera a alguien que había
señalado uno concreto.

Se cerró por los dos lados:

1. **Más tipos reconocidos, y un cajón de sastre.** Además de `share`,
   `ig_reel` y compañía entran `fallback` (el más común cuando lo
   compartido lleva enlace), `link`, `template`, `video` y `file`; y
   cualquier adjunto **desconocido que traiga una URL** se atiende como
   publicación. Quedan fuera a propósito las notas de voz y las fotos, que
   no son publicaciones. Así un nombre nuevo de Meta no vuelve a costar un
   cliente.
2. **Los enlaces envueltos se desenvuelven.** Meta manda muchas veces su
   redirector (`l.instagram.com/?u=...`) en vez de la dirección real; así
   tal cual no se reconoce como publicación nuestra ni se puede leer.
3. **Un mensaje vacío ya no se contesta con el historial.** Si no hay
   texto, ni foto, ni publicación, el bot dice que no le llegó y pregunta
   qué equipo busca. Sin saludo, porque también le pasa a quien ya viene
   hablando. Esto cubre de una vez las notas de voz, los stickers y
   cualquier adjunto que Meta invente mañana.

## Hecho: las publicaciones se leen por la API, no raspando la página (24-sep-2026)

Cuando lo que llega es el **enlace** de una publicación —o cuando Meta manda
el permalink en vez del archivo— abrir esa dirección desde el Worker casi
nunca funciona: Instagram devuelve un muro de inicio de sesión a cualquiera
que no sea un navegador con sesión. De ahí no sale ni la foto ni el pie, y
el bot se quedaba sin saber de qué equipo le hablan.

Pero esa publicación **es nuestra**, así que no hace falta entrar por la
puerta de la calle: con el mismo `IG_TOKEN` con el que el bot contesta los
mensajes se lee nuestro propio feed (`/me/media`). Del enlace se saca el
código de la publicación, se busca entre las últimas 150, y de ahí salen el
**pie de foto** —que casi siempre nombra el equipo con su capacidad— y la
**imagen** (la miniatura, si es un reel).

- Se intenta **primero** la API y solo después las etiquetas `og:`.
- El feed se guarda en memoria 10 minutos: no se pide en cada mensaje.
- Si el token no tiene permiso para leer publicaciones, el registro lo dice
  con su código de error y el bot sigue igual que antes — no se rompe nada.
- `/probar-enlace` ahora dice **por qué camino** se leyó el enlace.

**Y para poder diagnosticar lo que falte:** cada mensaje con adjuntos deja
en el registro el tipo tal cual lo manda Meta (`Meta → adjuntos: share
(https://…)`). Meta no documenta con qué forma llega cada cosa y cambia de
una versión a otra; sin esa línea es adivinar.

## Hecho: Cashea y Krece se leen de un vistazo (24-sep-2026)

Los porcentajes llegaban en un solo mensaje con las dos tablas pegadas: diez
líneas seguidas, sangradas con espacios que Instagram aplasta, y el cliente
teniendo que leerlo entero para encontrar su nivel.

- **Una plataforma por mensaje**, cada una con su título, su emoji y una
  línea por nivel. Dos mensajes, no tres: cada uno es una notificación en el
  teléfono del cliente.
- **Los niveles de Krece llevan el emoji de su color** (🔵 Azul, ⚪ Plata,
  🟡 Oro, 💎 Platino), así se encuentra el suyo sin leer los cuatro. Y se
  distingue de un vistazo cuál tabla es cuál, que es el error más caro aquí:
  cruzar los niveles de Cashea (números) con los de Krece (colores).

**Y la causa de fondo, que afectaba a TODAS las respuestas del bot:** el
prompt le prohibía los saltos de línea. Lo decía dos veces —en el formato de
salida y en el repaso final— sin distinguir entre un salto de línea de
verdad (que rompe el JSON) y un `\n` escrito (que no). Con esa regla, el
modelo no tenía forma de separar nada: todo lo que escribía salía pegado.

Ahora el prompt dice lo contrario y lo enseña: `\n` para una línea nueva,
`\n\n` para una línea en blanco, sección nueva **CÓMO SE ESCRIBE UNA
LISTA**, la excepción al "un emoji por mensaje" (en una lista, cada línea
lleva el suyo), los ejemplos de Cashea y Krece reescritos con ese formato, y
un punto 5 en el repaso final: *si tu respuesta enumera tres cosas o más, no
pueden ir seguidas en el párrafo*.

## Hecho: las pausas falsas dejan de costar horas (24-sep-2026)

**El síntoma, dicho por el dueño:** *"pausa a los clientes sin razón y si
siguen preguntando deja de responder"*.

Lo primero, para que quede escrito: **la pausa de EPICELL ya era idéntica a
la de Invictus** — el bloque del eco, `envioReciente`, la segunda mirada a
los 4 s, `avisarQueYaLoAtienden`, `FRASE_DESPAUSAR`, los pausados en
`/estado`. Se comparó línea por línea. Copiar Invictus no arreglaba nada:
el fallo está en el diseño que comparten los dos.

Una pausa nace de un eco cuyo `mid` el bot no reconoce como suyo, y ese
`mid` falla por varios caminos: un envío que no devolvió identificador, una
escritura en D1 que llegó tarde, un eco que Meta manda con otro. Taparlos de
uno en uno no garantiza que no aparezca el siguiente. Así que se atacó por
los dos lados:

**Que la pausa falsa sea mucho más difícil.**

- **El eco se reconoce también por el TEXTO.** Si lo que rebota dice palabra
  por palabra lo que el bot acaba de escribir, es suyo, aunque el `mid` no
  cuadre. Se guardan las huellas de los últimos 6 mensajes (columna nueva
  `ultimos_textos`, se crea sola), normalizadas: sin tildes, sin mayúsculas
  y recortadas.
- **El eco del carrusel ya no pausa.** Las fichas salen como adjunto y su
  eco vuelve sin una sola letra: no hay texto que comparar. Para ese caso la
  ventana del "lo acabo de mandar yo" pasa de 90 s a 5 min. Lo que se
  pierde: un asesor que mande una FOTO en esos minutos no pausa el bot; en
  cuanto escriba una línea, la pausa entra igual.

**Que, si aun así ocurre, no cueste horas.**

- **El bot retoma solo.** Si el cliente vuelve a escribir y el asesor lleva
  `PAUSA_VUELVE_MIN` minutos (10 por defecto) sin decir una palabra, el bot
  contesta en vez de dejarlo hablando solo, y avisa por Slack. Cada mensaje
  del asesor reinicia el reloj, así que al que está atendiendo no se le pisa
  nunca — y si quiere el silencio de vuelta, le basta con escribir una línea.
- Con `PAUSA_HORAS = "4"`, esto es la diferencia entre que una pausa
  equivocada cueste **cuatro horas** o **diez minutos**.

**Y que la próxima se diagnostique en diez segundos.** Cuando el bot pausa
de verdad, el registro ya no dice solo "bot pausado": dice `PAUSO <id> 4h —
eco ajeno mid:... texto:"..."`. Con el texto delante se ve en el acto si lo
escribió una persona o era el propio bot.

## Hecho: el precio en divisas se responde (24-sep-2026)

**El fallo.** El bot le mostró dos Samsung A57, el cliente escribió *"Precio
en divisas?"* y recibió *"Eso te lo confirma un asesor en un momento 😊"*.
Ni buscó ni mostró nada.

Dos causas, las dos arregladas:

1. **El prompt no decía nada de divisas.** Los precios de la hoja YA están
   en divisas (la columna que usa es `Precio Divisas ($)`), pero el modelo
   no lo sabía, y ante la duda tiró por el asesor. Sección nueva en
   `texto.txt`: **LOS PRECIOS EN DIVISAS SÍ LOS DAS**.
2. **"¿Y en divisas?" no nombra ningún equipo**, así que no había término de
   búsqueda y no había nada que mostrar. Ahora los títulos del último
   carrusel quedan guardados en D1 (columna `ultimos_productos`, se crea
   sola) y esa pregunta **vuelve a mostrar los mismos equipos**, sin buscar
   otra vez y sin pasar por el modelo — igual que "muéstrame esos".

Y en la ficha, el monto va con su etiqueta: **`$310 · Precio DIVISA`**. Solo
cuando el cliente pregunta por divisas; por defecto la ficha sigue con el
precio Cashea, y si pregunta por Cashea siguen saliendo los dos.

Si nombra un equipo —"¿cuánto el iPhone 15 en divisas?"— no se repite nada:
se busca lo que pidió, y la ficha sale igual con la etiqueta.

## Hecho: una publicación sin identificar se pregunta, no se supone (24-sep-2026)

**El fallo.** Un cliente mandó el enlace de una publicación del **POCO M8
PRO** y el bot contestó con el **Samsung A57** — el equipo del que se venía
hablando antes en esa conversación. El enlace no se pudo abrir, la imagen no
estaba, y el modelo rellenó el hueco con lo único que tenía delante: el
historial.

**Un hueco no se rellena con el pasado.** Ahora hay un guardián en el código
—no una instrucción del prompt, que ya demostró que ahí se deja llevar—: si
ni la IA de visión, ni la ficha del enlace, ni el pie de la publicación, ni
lo que escribió el cliente nombran un equipo del catálogo, el bot **pregunta
cuál es** y no muestra nada. El historial de ese turno tampoco se queda con
lo que el modelo había escrito, para que el mensaje siguiente no vuelva al
mismo error.

El reconocimiento se hace contra el catálogo en los dos sentidos: el título
entero dentro del texto, y las primeras palabras del título — así "POCO M8
PRO" encuentra el "Poco M8 Pro 8/256" de la hoja.

## Hecho: las publicaciones compartidas del feed (24-sep-2026)

**El fallo.** Un cliente compartió por el chat la publicación del SAMSUNG
A57 5G y escribió *"Feliz noche, precio?"*. Recibió **dos veces** la misma
bienvenida — *"¡Hola! Soy la asistente virtual de EPICELL 👋 ¿Qué equipo
estás buscando?"* — preguntándole qué busca a quien acababa de señalarlo con
el dedo. Dos causas distintas:

1. **La publicación no se leía.** `instagram.js` reconocía fotos sueltas y
   respuestas a historias, pero un adjunto `share` o `ig_reel` caía en el
   saco de "texto"; como ese mensaje no lleva texto, al modelo le llegaba la
   nada y contestaba la bienvenida genérica.
2. **El mensaje repetido.** Compartir y preguntar son **dos mensajes**, y
   Meta los manda como dos webhooks que el Worker atiende en paralelo, cada
   uno en su propia petición. Sin memoria compartida, cada uno contestaba
   por su cuenta.

**Cómo quedó.** `src/publicacion.js` (nuevo) es la parte de leer: del adjunto
saca la imagen de la publicación y su pie de foto; de un enlace —compartido
o pegado a mano en el texto— saca la foto, el título y la descripción con
las etiquetas `og:`, y si apunta a la ficha de un producto se la pide en
JSON y se queda con su título exacto. A partir de ahí la publicación entra
por el mismo camino que una foto: la IA de visión la mira —avisada de que es
un arte promocional, donde el nombre del equipo suele estar **escrito**, y
eso manda sobre deducirlo por las cámaras— y la IA de texto recibe lo
identificado **más el texto de la publicación**, que muchas veces nombra el
equipo mejor que la imagen.

- **La unión de los dos webhooks vive en D1**, en la columna `publicacion`,
  que se crea sola como las demás (`COLUMNAS_SOLAS` en `estado.js`). El turno
  de la publicación la guarda y espera 5 s a la pregunta que viene detrás; si
  llega, contesta ella —con la publicación delante— y el otro turno se calla.
  Si no llega, contesta la publicación. Es la única espera del sistema y solo
  ocurre cuando la publicación llega sin texto.
- **Un "precio?" suelto detrás de una publicación ya no dispara el "no sabes
  de qué habla"** de `historial.js`: sí se sabe, lo dice la publicación.
- **Si la publicación es un reel (vídeo) o el enlace no se deja abrir**, no
  hay mensaje de avería: se usa el pie de foto y, si no alcanza, se le
  pregunta cuál le gustó — nunca "¿qué buscas?" ni "mándame una foto".
- **Diagnóstico:** `/probar-enlace?url=...` dice exactamente qué saca el bot
  de un enlace, sin esperar a que lo mande un cliente.
- Los prompts llevan su sección: **PUBLICACIONES COMPARTIDAS DEL FEED** en
  `texto.txt` y **CUANDO LA IMAGEN ES UNA PUBLICACIÓN NUESTRA** en
  `vision.txt`.

## Hecho: Meta directo, sin ManyChat

El webhook no validaba, y no era configuración: era arquitectura. Pedida la
verificación exacta que manda Meta, el Worker contestaba su cartel:

```
bot activo · 2026-09-22 · búsqueda exacta de números + colores...
```

Meta exige recibir **exactamente** el `hub.challenge` y nada más. Como el bot
estaba escrito para ManyChat, no tenía esa ruta ni las variables `META_*`.

Ahora el `index.js` es el bot completo de punta a punta, con la misma capa de
Meta que corre en Invictus (los archivos `instagram.js`, `estado.js` e
`imagen.js` están copiados de producción **sin una línea cambiada**):

- `/webhook` GET → responde el desafío de Meta.
- `/webhook` POST → valida la firma HMAC, descarta lo que no hay que atender y
  responde 200 siempre y rápido; el trabajo va en `ctx.waitUntil`.
- La memoria de cada conversación vive en **D1**, no en los campos de otro
  sistema: historial, nombre, pausa.
- **Pausa automática** cuando un asesor contesta a mano desde la app de
  Instagram, detectada por el eco del mensaje. Se le devuelve la conversación
  al bot escribiendo `FRASE_DESPAUSAR` en el mismo chat.
- `/estado` nuevo: versión desplegada, secretos que faltan, estado de la base.

**Se borraron `manychat.js` y `nombre.js`.** El segundo contaba cuántas veces
se había dicho el nombre del cliente con una marca pegada al historial; ahora
el nombre tiene su columna en D1 y esa gimnasia sobra.

Todo lo demás de EPICELL quedó igual: Cashea, precios en divisas, la hoja de
Google, los términos de búsqueda, el catálogo en el prompt, la escalada al
asesor.

## Hecho: los colores van al asesor

El catálogo dice qué **modelos** hay, no qué colores quedan en la tienda hoy.
Un color afirmado de más es una venta que se cae en el mostrador.

- El prompt ya no le permite hablar de colores (antes decía "SÍ puedes:
  mostrar equipos, modelos, capacidades **y colores**").
- El color **sale del término de búsqueda** y ya no se filtra por color sobre
  los títulos: filtrar daba por hecho que el color del título es el que hay en
  stock, que es justo lo que no se sabe.
- Si el cliente nombra un color, **se le muestra el equipo igual** y el color
  se deriva. "El iPhone 15 blanco" busca "iPhone 15": mostrarle el equipo es
  ayudarlo, callarse el color es no mentirle.
- El color se detecta en lo que escribió **el cliente**, no en el término del
  modelo, usando la misma tabla de `color.js`. Perseguirlo con frases hechas
  se quedaba corto: "¿tienen el iPhone 15 en blanco?" no encajaba en ninguna.

`filtrarPorColor` y `terminoDeColor` siguen en `color.js` pero ya no se usan.

## Hecho: los gigas se responden, con el catálogo delante

La capacidad está escrita en el **título** del catálogo ("iPhone 15 128GB"),
así que es un dato real — al revés que el color, que el título no sabe. Por
eso los gigas SÍ se contestan.

Lo que resuelve, que era una venta perdida por mensaje: *"¿tienen el 15 de
256?"* cuando no había ese exacto devolvía cero, el bot decía "déjame
confirmarte con un asesor" y el cliente se iba — **con el mismo modelo ahí,
en 128 y en 512**.

Ahora, si la búsqueda traía una capacidad y no dio nada, se busca el modelo
**sin ella**. Si aparece, no es que no lo tengamos: es que no lo tenemos en
esos gigas, y eso se dice con el dato delante:

> En 256GB no lo tengo ahora mismo 😅 Pero me queda en 128GB y 512GB, mira 👇

Y *"¿qué capacidades tienen del 15?"* se responde leyendo los títulos que
volvieron, ordenados de menor a mayor.

**La frase la escribe el código, no el modelo**, y por un motivo: el modelo
redacta ANTES de que se haga la búsqueda, así que no puede saber en qué
capacidades quedó el equipo. El prompt ahora se lo dice explícitamente —
nunca adelantar capacidades, nunca decir que una no la hay, solo buscar.

Cuidado con los números: `capacidad.js` acepta "256" suelto como capacidad
pero **nunca** 12, 13 o 16, que son nombres de modelo ("iPhone 16" no es
dieciséis gigas). Con unidad escrita —"16GB"— sí vale.

## Los campos del webhook en Meta (22-sep-2026)

**Solo hacen falta DOS**, y los dos están en el producto **Instagram**, no en
el de WhatsApp Business:

| Campo | Para qué | ¿Obligatorio? |
|---|---|---|
| `messages` | Que lleguen los mensajes y las respuestas a historias | **Sí**, sin esto el bot no recibe nada |
| `message_echoes` | La pausa automática cuando un asesor contesta a mano | **Sí**, sin esto el bot habla encima del asesor |

Todo lo demás se deja **sin suscribir**. Cada campo suscrito son cientos de
avisos al día que el Worker tiene que recibir y descartar: se paga por cada
uno y no aportan nada. El bot ya descarta los "visto", las reacciones y los
comentarios en cuanto llegan.

Cuidado con la pantalla de **WhatsApp Business** (la que tiene
`phone_number_quality_update`, `template_category_update`,
`smb_message_echoes`…). Esos campos son de otro producto y no los usa este
bot. `smb_message_echoes` **no** es el `message_echoes` de Instagram.

## Los contactos se guardan solos

No hay que configurar nada. En cuanto un cliente escribe por primera vez, el
bot le pide el perfil a Instagram y guarda en D1 su nombre, su nombre
completo y su @.

Para verlos:

```
/contactos          la lista, del más reciente al más antiguo
/contactos?csv=si   el archivo para abrir en Excel
```

**Lo que Instagram no entrega, y por lo tanto no está: el teléfono y el
correo.** Con el @ sí se les puede escribir.

## Falta: configuración (no es código)

1. **Crear la base de datos y correr la migración:**
   ```
   npx wrangler d1 create bot-telefonos-db
   ```
   Copiar el `database_id` que imprime dentro de `wrangler.toml` (busca
   `PENDIENTE`), y después:
   ```
   npx wrangler d1 migrations apply bot-telefonos-db --remote
   ```
2. **Los dos secretos nuevos:**
   ```
   npx wrangler secret put META_APP_SECRET_IG
   npx wrangler secret put IG_TOKEN
   ```
   `META_APP_SECRET_IG` es la clave del **producto Instagram**, no la de
   Configuración → Básica. Las dos miden 32 caracteres y no se distinguen a
   ojo; si el registro dice que la firma no cuadra, está cargada la otra.
3. **En el panel de Meta**, suscribir el webhook a `messages` **y a
   `message_echoes`**. Sin el segundo no funciona la pausa automática.
4. **Desconectar ManyChat** de la cuenta de Instagram. Si se queda conectado,
   su app puede seguir recibiendo el mismo webhook e intentar su propia
   automatización — que es exactamente el mensaje duplicado que esto viene a
   evitar.
5. Los marcadores de `wrangler.toml`: `SHEET_ID`, `URL_CATALOGO`, `WHATSAPP`.

## Falta: datos para los prompts

- `texto.txt` — `{{TUS HORARIOS}}` (aparece dos veces) y
  `{{ADAPTA ESTE BLOQUE A LO QUE VENDES Y BORRA LO QUE NO}}` (el bloque de
  nuevo / usado / reacondicionado: hay que decir cuál de los tres vende
  EPICELL).
- `vision.txt` — `{{COPIA AQUÍ LA MISMA TABLA DE TÉRMINOS DEL PROMPT DE TEXTO}}`.

## Cómo comprobar que quedó bien

Antes de apretar "Verificar y guardar" en Meta, abrir esto en el navegador:

```
https://bot-telefonos.arizatecnologia.workers.dev/webhook?hub.mode=subscribe&hub.verify_token=epiccell2026&hub.challenge=PRUEBA12345
```

Tiene que salir **`PRUEBA12345`** y nada más. Si sale el cartel del bot, el
despliegue no llegó.

Y `/estado` tiene que decir la versión nueva y "DB conectada".
