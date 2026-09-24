# IAALPHAOMEGA — Chatbots IA (no-code)

Repositorio de trabajo para los chatbots de IA de los distintos clientes. Punto de partida: **Invictus Shoes**.

## Dónde está cada cosa (22-sep-2026)

| Carpeta | Qué es |
|---|---|
| `invictus-bot/` | **Producción.** El código que atiende clientes hoy. Todo cambio para Invictus va acá. |
| `worker/` | Rama **multi-tienda sin fusionar** (`tienda.js`, `tiendas/*.js`, prompts con `{{TIENDA}}`). Base más vieja: sin visión en dos pasos, sin `hayMas`, sin despausar, sin nombres de clientes. No copiar sus archivos a la carpeta de despliegue. |

Lo que sigue describe el bot en general; donde hay diferencia, manda `invictus-bot/`.

### Reconocimiento por foto: cómo quedó (lo más importante)

Tres capas, y cada una arregla el fallo de la anterior:

1. **`identificarEnImagen` (gpt-4o)** mira la foto y devuelve el modelo + 15 rasgos sí/no de lo que VE. Schema estricto: los rasgos no pueden faltar.
2. **`identificar.js`** verifica ese nombre contra esos rasgos, sin IA de por medio. Y desde el 22-sep distingue dos cosas que antes trataba igual:
   - **Un rasgo lo CONTRADICE** (la IA dijo "Air Max 270" y ella misma marcó suela redondeada sin cámara de aire) → se rechaza y se baja a la marca. Es el caso del Uplift, el fallo que originó todo esto.
   - **Falta el rasgo que lo CONFIRMA, pero nada lo contradice** (dijo "Air Force One" y no marcó la pieza metálica del ojal, que es diminuta y en media foto no se ve) → **ya no se tira el nombre**. Se busca igual, marcado como *sin confirmar*, y lo verifica la capa 3. Tirar un nombre correcto por un detalle invisible era la contradicción que se veía a simple vista: "si sabe que es un AF1, ¿por qué no lo buscó?".
3. **`cotejo.js` (cotejo visual)** compara la foto del cliente contra las fotos reales del catálogo de Shopify. Tiene dos modos:
   - **Desempatar** — hay varios candidatos y hay que saber cuál es. Los candidatos se eligen **por los rasgos** (`terminosCompatibles`, la tabla de `identificar.js` leída al revés), no por el orden del catálogo.
   - **Verificar** — la identificación venía sin confirmar. Ahí corre **aunque haya un solo resultado**, porque la pregunta no es "cuál" sino "¿es este?".

   Y si con eso no aparece, **barre el catálogo** (`traerCatalogoCompleto` en `shopify.js`): trae todos los productos activos de Shopify —250 por llamada, un par de llamadas— y compara la foto contra todos, en lotes de 20 imágenes, de a 4 lotes en paralelo, parando en cuanto uno acierta. Los títulos que comparten palabra con lo que se buscó van primero, así que lo normal es que caiga en el primer lote. Es el único paso caro del bot y solo corre cuando lo barato ya falló; se apaga con `COTEJO_BARRIDO = "no"`.

   **El techo del barrido no es el catálogo: es el cupo de OpenAI.** Primera prueba real (22-sep): catálogo de 400+, lotes de 20 fotos, y OpenAI devolvió `429 — Limit 30000 TPM, Used 13868, Requested 16908` desde el segundo lote. El cliente se quedó **sin respuesta**, porque Cloudflare cortó la tarea en segundo plano. La cuenta: un lote de 20 fotos son ~17.000 tokens y el cupo son 30.000 por minuto — no entran ni dos seguidos, y barrer 400 productos tardaría once minutos.

   Por eso el barrido es ahora una pasada **corta y con presupuesto**: lotes de 10, de a 2, un tope de lotes por mensaje (`COTEJO_LOTES`, por defecto 2 = 20 productos) y un reloj de 15 s. Si OpenAI devuelve 429, `ia.js` lo anota y el barrido **se corta solo** en vez de insistir. La respuesta al cliente sale siempre.

   **Para barrer el catálogo COMPLETO de verdad hay dos caminos, los dos fuera de este código:**
   - **Subir de tier en OpenAI.** Es la solución de cinco minutos: con más TPM, `COTEJO_LOTES` se sube y el barrido cubre todo. El código ya está listo.
   - **Indexar el catálogo una sola vez** ← **esto es lo que se hizo.** Ver abajo.

### El color de la foto manda (24-sep-2026)

Reportado por el dueño: *"pregunté por un calzado, en la historia sale en color negro y me mostró otro color nada que ver; con los Tommy igual"*. Y el otro síntoma: *"a veces dice ¿son adidas? ¿me dices cómo se llama? y muestra algo nada que ver"*.

**Por qué pasaba.** El ranking del índice solo miraba los 15 rasgos — y entre dos colores del MISMO modelo esos rasgos son **idénticos**. Así que el desempate lo hacía el orden en que D1 devolviera las filas. Con 17 `New Balance 9060 Dama` en el catálogo, acertar el color era una lotería de 1 entre 17. Lo mismo con los resultados de marca: diez Adidas sin ordenar, y el modelo solo ve los 8 primeros.

**Qué cambió:**

1. **La visión devuelve el color** en su propio campo del JSON (`color`), no enterrado en la frase libre de `visto` — ahí *"suela blanca"* convertía un zapato negro en uno blanco. El prompt es explícito: el color del CUERPO del zapato, no el de la suela ni el del swoosh; vacío si el filtro no deja verlo.
2. **El color pesa en el ranking, y pesa más que los rasgos.** Coincidir suma 60; llevar OTRO color escrito en el título resta 25; un título que no nombra color (`Tommy caballero`) ni suma ni resta — no contradice nada. El máximo por los 15 rasgos son 45 puntos, así que el color gana los empates, que es justo donde se perdía.
3. **Los resultados de marca también se ordenan.** Se piden 3x candidatos a Shopify y se ordenan por color + rasgos antes de enseñárselos al modelo, que solo mira 8.
4. **El prompt del cotejo desempata por color.** Sigue diciendo que un color distinto no descarta un modelo — eso es correcto y evita perder ventas por un filtro de Instagram— pero ahora añade: si varios candidatos son el mismo modelo y solo cambian de color, elige el de la foto.
5. **Detrás del elegido van sus hermanos.** Antes, cuando el par salía del índice o de la marca, se mandaba SOLO. Pero en este catálogo el mismo título se repite una vez por color, así que los que comparten título son el mismo zapato en otros colores — que es exactamente lo que el cliente quiere ver después del suyo. **El de la foto va primero** y detrás hasta 9 más.

### El barrido a Shopify ya no corre con el catálogo indexado (24-sep-2026)

Capturado en producción por el dueño, en `wrangler tail`. Una respuesta a una historia con `"Precio"`:

```
Índice: 581 productos guardados, los 10 más parecidos a la foto van al cotejo
Cotejo visual: ninguno del catálogo es el de la foto
Catálogo completo: 581 productos                      ← llamada a Shopify
Barrido del catálogo: miro 20 de 539 sin mirar (2 lotes de 10)
Cotejo visual: ninguno ...
Barrido: no encontré el de la foto entre los 20 que miré
```

**El índice se consultaba y acto seguido se ignoraba.** Con los 581 ya indexados, el bot miraba los 10 mejores, fallaba, y entonces pedía el catálogo ENTERO a Shopify para barrer 20 productos elegidos por **parecido de título** — con un término que en ese mensaje era `"NADA"`. Dos llamadas más al modelo, medio minuto del cliente, y **peores candidatos que los que acababa de descartar**: el índice ordena por los rasgos de la foto; el barrido, por palabras de un título que no existía. El comentario del código ya decía *"solo hace falta si el catálogo NO está indexado"* — pero el código no lo comprobaba.

**Ahora:**

- **Se baja por el ranking del índice**, hasta 3 rondas de 10 (`RONDAS_DEL_INDICE`). Son los 30 productos que más se parecen a la foto de todo el catálogo, no veinte cualesquiera. Si acierta en la ronda 1, no gasta las otras.
- **Con el índice por encima de 200 filas (`INDICE_SUFICIENTE`), el barrido no corre.** Lo que había que mirar ya se miró.
- **Por debajo de eso el barrido sigue siendo la red** — indexación a medias, tienda recién desplegada, o una tienda sin índice como El Emperador. Y `COTEJO_BARRIDO = "no"` lo sigue apagando.
- Si OpenAI se queda sin cupo entre rondas, corta ahí en vez de encadenar llamadas que ya se sabe que fallan.

### Con una foto, el bot enseña — no pregunta (24-sep-2026)

Con el catálogo ya indexado, pedirle al cliente el nombre del modelo es absurdo por dos razones: **el bot sí sabe qué hay**, y **quien manda una foto casi nunca sabe el nombre** — si lo supiera, lo habría escrito. Aun así el bot terminaba en `"No logro identificar bien ese modelo 😅 ¿Sabes cómo se llama?"` cada vez que el cotejo se abstenía.

**Qué pasaba.** El cotejo visual solo muestra producto con confianza `alta` (y está bien: lo que sale de ahí es una ficha con precio y botón de compra). Cuando decía `media`, y la búsqueda por nombre tampoco había dejado nada, no quedaba nada que mostrar y la respuesta que el modelo de texto ya había escrito —"no sé, ¿cómo se llama?"— salía tal cual.

**Qué hace ahora.** `parecidosDeLaFoto()` en `cotejo.js`: compara los 15 rasgos de la foto contra los del índice **en código, sin una sola llamada al modelo ni un token del cupo**, y devuelve los 6 que más puntúan. El bot los enseña con un `"Mira, ¿es alguno de estos? 👇"`.

- **No afirma nada.** Esa es la diferencia con el cotejo, que sí afirma y por eso exige confianza alta. Aquí se enseña y se pregunta *cuál*, que es lo que hace una vendedora con el zapato delante.
- **Elegir sí puede; nombrar no.** La rama de "reconocí la marca pero no el modelo" también cambió: antes pedía el nombre exacto, ahora muestra lo de esa marca y pregunta cuál de esos es.
- **Los prompts dejaron de enseñar la respuesta mala.** En `texto.txt` ya no está `"No logro identificar"` ni `"¿Sabes cómo se llaman?"`, y la instrucción es explícita: prohibido decir que no lo reconoces, prohibido pedir el nombre del modelo, prohibido pedir otra foto.
- **Cuando la historia es un vídeo y no hay imagen, sigue preguntando** — y debe: ahí no hay rasgos contra los que comparar, así que no hay nada que enseñar. Eso no se tocó.

**Los precios del índice se refrescan solos.** Como ahora se mandan fichas que salen del índice, un precio guardado el día que se indexó sería un precio viejo en pantalla. Mirar la foto cuesta una llamada al modelo; copiar el precio no cuesta nada —ya viene en la respuesta de Shopify que el cron acaba de pedir—, así que `indexarTanda()` actualiza precio, enlace y título de **todas** las filas en cada pasada, sin volver a mirar ninguna imagen. Sale en `/indexar-catalogo` como `Precio o enlace actualizados: N`.

### Las dos listas de productos: `catalogo.txt` y `modelos.txt`

| Archivo | Qué trae | A qué prompt va | Peso |
|---|---|---|---|
| `prompts/catalogo.txt` | Los **347 títulos** completos, tal cual están en Shopify (`Nike Metcon 7 negro blanco dama/caballero`) | `texto.txt`, vía `{{CATALOGO}}` | ~2.400 tokens, una vez por arranque |
| `prompts/modelos.txt` | Los **163 modelos**, sin género ni color (`Nike Metcon 7`) | `vision.txt`, vía `{{MODELOS}}` | ~584 tokens |

**Por qué son dos y no una (24-sep-2026).** El 22-sep se le quitaron al prompt de visión los 347 títulos porque costaban **~3.100 tokens en cada foto** contra el cupo de 30.000/min de OpenAI — el mismo cupo del que vive el cotejo visual. El recorte estaba bien, pero dejó al modelo de visión sin saber qué se vende aquí, justo mientras el prompt le exige escribir `buscar` *"como aparece en los títulos del catálogo"*. `modelos.txt` es el término medio: **+584 tokens en vez de +2.399, 4 veces más barato**. Que haya 17 `New Balance 9060` por color no le hace falta saberlo a la visión — de elegir el color se encarga el cotejo, que para eso mira la foto.

**La regla que hace que la lista sirva:** cada nombre tiene que aparecer **literalmente dentro de algún título real**. Si no, el modelo lo escribiría en `buscar` y la búsqueda devolvería cero. Está comprobado sobre los 581 títulos del export: los 163 pasan.

**Las erratas no se corrigen, en ninguna de las dos listas.** `New Balamce 9060`, `Adidas Gallangher`, `Kirie Irving 4`, `Onitsuka Tiguer`, `Dolce Gabanna` están así en Shopify y la búsqueda es literal: corregirlas es perder el producto. Cuando existen las dos formas, van las dos.

**Cómo rehacer `modelos.txt`:** de los títulos del export se quitan género y colores, y se queda lo que **siga apareciendo literalmente** en algún título. El encabezado del archivo lo explica.

**Nota sobre el export del 24-09-2026:** 581 filas, 347 nombres — **idéntico** al que ya estaba cargado. La columna `Available` viene en 0 en las 581 filas, así que ese export no sirve para saber stock.

### El índice del catálogo (`indice.js` + `/indexar-catalogo`)

El trabajo de mirar el catálogo no hace falta repetirlo en cada mensaje: el catálogo no cambia entre un cliente y el siguiente. Así que se mira **una vez**, se guardan los 15 rasgos de cada producto en D1, y cuando llega una foto sus rasgos se comparan con los guardados **en código, sin gastar una sola llamada ni un token de cupo**. Solo los 10 más parecidos van a un único cotejo.

**De 20 llamadas por mensaje a 1**, y el cliente espera segundos en vez de minutos.

- **Se indexaba por título y se pisaba a sí mismo — corregido el 24-sep-2026.** Capturado en producción: la indexación subía, se paraba en seco alrededor del 24% y `FALTAN N` no bajaba de ahí, **sin un solo error en el registro**. La tabla tenía `titulo TEXT PRIMARY KEY`, y el catálogo tiene **581 productos pero solo 347 títulos distintos** (el mismo nombre para varios colores): 234 productos se borraban unos a otros al guardarse.
  - **Por qué no terminaba nunca.** Al guardar, el último de cada título pisa al anterior. En la pasada siguiente el pisado vuelve a salir como pendiente —su foto no coincide con la guardada—, se vuelve a mirar, y se vuelve a pisar. El índice no puede pasar del número de títulos y `faltan` no llega nunca a cero. Cada pasada tiraba 40 llamadas de visión para nada, en bucle.
  - **La clave ahora es la URL de la foto**, que sí es única por producto (el CDN de Shopify le mete el id de la imagen). De regalo arregla el reindexado: si a un producto le cambian la foto es una clave nueva, entra sola, y la vieja la limpia `limpiarLosQueYaNoEstan()` — que también pasó a comparar por foto, porque por título un color retirado seguía pareciendo vigente.
  - **La tabla vieja se migra sola y no se pierde lo ya indexado.** `asegurarIndice()` mira la clave primaria con `PRAGMA table_info`; si es la vieja, copia las filas a la tabla nueva usando su foto como clave y renombra. Lo que ya se le pagó al modelo por esos productos sigue valiendo: no se vuelve a mirar ni uno.
  - **Y ahora grita si vuelve a pasar.** Tras guardar, se compara cuántas filas nuevas quedaron contra cuántas se guardaron; si no cuadra, sale un `console.error` diciendo que se están pisando. Lo peor de este fallo no fue el fallo: fue que no dijo nada.
  - **El porcentaje ya no miente.** Se cuenta sobre los productos **indexables** (los que tienen foto), no sobre los 581. Los que no tienen `featuredImage` no se pueden indexar —el cotejo compara imágenes— y ahora salen contados aparte en `/indexar-catalogo`.
  - **`mejoresPorRasgos()` devuelve un candidato por título**, el color cuyos rasgos más se parecen a la foto. Antes, con varias filas del mismo modelo, media lista de candidatos se iba en repetidos que `cotejo.js` colapsaba después.
- **Cómo se llena: solo (24-sep-2026).** `[triggers] crons` en `wrangler.toml` llama al Worker cada 15 minutos y el handler `scheduled()` indexa lo que falte, por tandas de 40, con un presupuesto de 60 s y un tope de 5 tandas por pasada. Desde vacío tarda un par de horas; después se mantiene solo, y los productos nuevos los recoge en la siguiente pasada. **Cuando ya no falta nada, la pasada no gasta ni una llamada al modelo.**
  - **Por qué hubo que cambiarlo.** Antes era abrir `/indexar-catalogo` y recargar ~15 veces (581 productos, tandas de 40). Una tarea que depende de que alguien recargue quince veces no se hace: el índice se quedaba vacío y el cotejo, sin su vía buena, caía al barrido corto — 20 productos de 581. Misma lección que la columna `mostrados`: lo que se pueda resolver desde el archivo que sí se copia, se resuelve ahí.
  - **La ruta sigue existiendo** para mirar cómo va o adelantar una tanda a mano (`?cuantos=N`, `?rehacer=si`). La lógica de la tanda vive ahora en `indexarTanda()` dentro de `indice.js`, y la usan tanto la ruta como el cron.
  - **Si algo va mal no insiste:** sin saldo o sin permiso para el modelo, la pasada lo anota en `wrangler tail` y corta; si se acaba el cupo por minuto, guarda lo que alcanzó y sigue en la próxima.
- **Con qué modelo:** `OPENAI_MODELO_INDICE` (por defecto `gpt-4o-mini`), que tiene un cupo por minuto mucho más alto y para una foto de producto limpia alcanza. La foto del **cliente** sigue yendo al modelo bueno.
- **Cómo puntúa:** compartir un rasgo **presente** ("los dos tienen cámara de aire en el talón") vale 3; compartir uno ausente vale 1, porque casi todos los pares no tienen casi ningún rasgo y los "no" coinciden por defecto sin distinguir nada; diferir resta 2, porque un rasgo que uno tiene y el otro no es justo lo que descarta un modelo.
- **Se mantiene solo:** un producto se reindexa si le cambió la foto (la URL del CDN de Shopify cambia con la imagen), y los que desaparecen de Shopify se borran del índice al terminar una pasada completa — si no, el bot podría enseñar la ficha de algo que ya no se vende.
- **El cupo se cuenta por modelo.** Esto empezó siendo un solo número y estaba mal: OpenAI da un cupo por minuto **a cada modelo por separado**. Con un número compartido, un 429 de `gpt-4o` —que en esta cuenta pasa seguido— apagaba también la indexación, que corre con el mini y tenía cupo de sobra: la primera indexación real guardó **cero productos** sin que se entendiera por qué. Ahora cada modelo lleva su propia cuenta, y la indexación **espera** a que vuelva el cupo en vez de rendirse (puede hacerlo: no hay ningún cliente del otro lado). La respuesta a un cliente nunca espera.
- **`/estado` dice cuántos hay indexados.** Si dice `VACÍO`, el cotejo se queda sin su vía buena y cae al barrido corto.

   Solo la confianza **"alta"** llega al cliente. Si no confirma, no descarta nada: el bot muestra lo que encontró preguntando si es ese, que es lo honesto.

## Proyecto actual: Invictus Shoes

Chatbot vendedor de calzado por Instagram (carrusel de productos vía Shopify).

- **Modelo IA:** GPT-4o-mini (vía OpenAI). Visión con `response_format: json_schema` (estricto); texto con `json_object`.
- **Infraestructura:** Cloudflare Workers + D1 (sin n8n, sin Make, **sin ManyChat**)
- **Integraciones:** Meta/Instagram (Graph API, único canal) + Shopify (búsqueda de catálogo, GraphQL Admin API) + Slack (aviso a asesor)

### 19-sep-2026 — se retiró ManyChat, este Worker es el único canal

**Por qué.** Con ManyChat, dos apps distintas recibían el mismo webhook de Meta (la de ManyChat y la propia de este proyecto) y cada una le contestaba al cliente por su cuenta → mensaje duplicado. Se intentó coordinarlas —que la app de Meta le avisara a ManyChat en vez de responder ella misma— pero la API de ManyChat no acepta el `igsid` de Instagram para identificar a un subscriber (usa un `contact_id` propio, sin endpoint público para traducir uno al otro — confirmado en la [comunidad de ManyChat](https://community.manychat.com/general-q-a-43/contact-id-and-psid-6008)), así que no había forma confiable de que una app le avisara a la otra "ya contesté yo". La solución de fondo: que haya una sola app. Sin un segundo sistema, el problema del duplicado deja de existir por diseño, no por parche.

**Qué cambió:**
- `atenderMeta()` en `index.js` es ahora el bot completo, de punta a punta: recibe el mensaje, busca/guarda memoria en D1, llama a la IA, busca en Shopify, manda la respuesta por la Graph API de Instagram.
- El webhook ya atiende **texto suelto** también (antes se descartaba a propósito, "eso es trabajo de ManyChat").
- La memoria de cada conversación (`historial`, `nombre`) ya no vive en los campos de otro sistema — vive en D1 (`estado.js`, que existía pero estaba desconectado; ver tabla `contactos` en `migrations/0001_contactos.sql`).
- Pausa automática cuando un asesor responde a mano desde la app de Instagram: se detecta por el **eco** del mensaje (Meta avisa de todo lo que sale de la cuenta) — si el `mid` no es de los que mandó el bot, fue una persona, y el bot se aparta `PAUSA_HORAS` (por defecto 4h). Antes esto era solo una intención en los comentarios de `estado.js`; ahora está conectado.
- `manychat.js` y `manychat-campo.js` se borraron el 21-sep-2026, ya sin uso; `index.js` tampoco expone `/manychat`.
- Se resolvió de paso el bloqueo de `src/nombre.js` (nunca llegó a este repo): la lógica que dependía de él —no repetir el nombre del cliente en cada mensaje, con un marcador pegado al historial de ManyChat— ya no hace falta, porque ahora el nombre vive en su propia columna de D1 en vez de mezclado con el historial como texto. El prompt ya le pide al modelo no repetir el nombre después del saludo; se confía en eso.

**Qué se pierde, y qué no:**
- Tu equipo deja de ver las conversaciones en la bandeja de ManyChat — pasa a usar la bandeja nativa de Instagram (la app o Business Suite). Confirmado con el dueño que está bien.
- Las respuestas a video no cambian: siguen sin poder verse (Meta no entrega el fotograma), y el bot sigue preguntando el modelo con naturalidad en vez de decir que hubo un error.
- El reconocimiento por foto en respuestas a historias **debería funcionar mejor que antes**, no peor: ya no depende de ningún relevo entre sistemas — la imagen llega directo del webhook de Meta a la IA, siempre.

### ⚠️ Existe una versión bifurcada de ESTE MISMO bot (21-sep-2026)

En paralelo a este repo, el dueño trabajó el mismo bot en otra cuenta de Claude, sobre el repo **`estherzzerpa/challenge-javascript`**, carpeta `invictus-bot/`, rama `claude/shopify-make-manychat-json-63v9hl` (con ~45 commits locales sin subir). Un resumen de esa sesión afirmaba que era "un codebase completamente distinto, no relacionado" — **es falso**: mismo Worker (`invictus-bot`), misma tienda, mismos nombres de archivo, mismos quirks documentados (sensibilidad a mayúsculas de ManyChat, los dos secretos de Meta, el 403 del CDN en `imagen.js`, "nunca devolver 401", `META_MODO`).

Las dos ramas divergieron a arquitecturas **incompatibles**:

| | Esa rama | Esta rama (la buena) |
|---|---|---|
| Canal | ManyChat + Meta como apoyo | Meta directo, único canal |
| Memoria | Cloudflare KV (`memoria.js`) | D1 (`estado.js`) |
| Nombre del cliente | `nombre.js` + marca de tiempo oculta en el campo de ManyChat | columna propia en D1 |
| Reconocimiento por foto | solo prompt | prompt + `identificar.js` + JSON schema estricto |

**Decisión del dueño (21-sep-2026): se queda esta rama.** La otra se descarta.

**Riesgo concreto a vigilar:** hay UNA sola carpeta de despliegue (`C:\Users\ivoo\Documents\invictus-bot`) y UN solo Worker, y las dos sesiones le mandaron archivos para pegar ahí. Si aparecen `memoria.js`, `nombre.js` o un `index.js` que los importe, son de la otra rama y rompen el arranque de esta. Mezclar las dos es la hipótesis principal de por qué una prueba de respuesta a historia no devolvió nada después del despliegue del 19-sep.

### Setup que falta para desplegar esto (no es código, es configuración)

1. **Crear la base de datos D1 y correr la migración:**
   ```
   npx wrangler d1 create invictus-bot-db
   ```
   Copiar el `database_id` que imprime ese comando dentro de `worker/wrangler.toml` (busca `PENDIENTE`), y luego:
   ```
   npx wrangler d1 migrations apply invictus-bot-db --remote
   ```
2. **Desconectar ManyChat de la cuenta de Instagram** (Meta Business Suite → Configuración → Integraciones, o desde el propio ManyChat → Configuración → Instagram → Desconectar). Esto es importante: si ManyChat se queda conectado, su app puede seguir recibiendo el mismo webhook e intentar su propia automatización aunque este Worker ya no dependa de ella — desconectarla es lo que cierra el tema del todo. El endpoint `/manychat` ya no existe en el código, así que cualquier llamada suya a partir de ahora simplemente no hace nada útil.
3. **Confirmar en el panel de Meta Developers** que el webhook de Instagram está suscrito al campo `message_echoes` además de `messages` — sin eso, la pausa automática cuando un asesor responde a mano no funciona (nunca le llega el eco al Worker).
4. Revisar `GET /estado` después de desplegar: tiene que decir "DB conectada". Si dice "FALTA", el paso 1 no se completó.

### Multi-tienda (22-sep-2026)

El mismo código atiende a varias tiendas. Lo que cambia por tienda son dos archivos: `wrangler.toml` (credenciales, Shopify, WhatsApp, y `TIENDA = "..."`) y `src/tiendas/<tienda>.js` (nombre, horarios, calidad, catálogo, términos de búsqueda). **Todo lo que hay en `src/` es idéntico en las dos carpetas de despliegue**, así que un arreglo se aplica pegando los mismos archivos en las dos.

- `src/tienda.js` — elige la tienda según `env.TIENDA` y rellena los marcadores de los prompts. Si `TIENDA` no existe, **lanza** en vez de seguir: con la tienda equivocada el bot se presentaría con el nombre de otro negocio y buscaría en el catálogo que no es.
- `src/tiendas/invictus.js`, `src/tiendas/emperador.js` — los datos de cada una.
- Los prompts (`texto.txt`, `vision.txt`) quedaron **sin marca**: `{{TIENDA}}`, `{{CALIDAD}}`, `{{CATALOGO}}`, `{{TERMINOS}}`, `{{HORARIOS}}`. Se rellenan una vez por arranque en `ia.js` y se guardan en memoria. Así las ~1000 líneas de tono, reglas y ejemplos —lo que más costó afinar— valen para cualquier tienda.
- **Comprobado que Invictus no cambia:** el prompt reconstruido difiere del anterior en 8 líneas, todas intencionales (el nombre fijo que se quitó, un salto de línea y un ejemplo con la frase de calidad completa).
- Una tienda **sin catálogo todavía** no rompe: `tienda.js` mete en su lugar un texto que le dice al modelo que use las palabras exactas del cliente y no invente nombres de modelos. Conversa y vende; busca peor hasta que se cargue la lista.
- `parecidos.js` se comparte a propósito: el parecido entre un Vapormax y un TN es de los zapatos, no de quién los venda. Si una tienda no maneja un término, la búsqueda devuelve cero y se pasa a la siguiente alternativa.
- **El Emperador vende doble A y triple A**, no 1.1 como Invictus. Como son dos gamas y el bot no puede saber de cuál es un par concreto (ve el título y la foto, no la gama), su sección de calidad nombra las dos y manda al asesor cuando preguntan por un modelo en particular. Decir "triple A" de un par que es doble A es la equivocación más cara que podría cometer.
- Guía de montaje paso a paso: `MONTAR-OTRA-TIENDA.md`.

### Cotejo visual contra el catálogo (22-sep-2026)

Hasta ahora **todo** el reconocimiento por foto terminaba en un nombre: la IA miraba la imagen, decía "Vapormax", y ese texto se buscaba en Shopify. Cuando el nombre no acertaba, no había búsqueda que valiera — y fallaba seguido (el Uplift saliendo como "Air Max 270", tres veces documentadas arriba). Es el fallo más caro del bot: quien responde a una historia ya vio el zapato y lo quiere, y recibía un "¿sabes cómo se llama?".

`src/cotejo.js` + `src/prompts/cotejo.txt` cambian la pregunta. En vez de adivinar el nombre, se le ponen al modelo **la foto del cliente al lado de las fotos reales del catálogo** (Shopify ya devuelve `featuredImage` en cada resultado) y se le pregunta cuál es el mismo par. Comparar dos imágenes es mucho más fácil que recordar un nombre, y lo que sale es un producto REAL de la tienda —título exacto, precio y enlace— en vez de un término que ojalá exista.

**Cuándo corre.** Cada cotejo es una llamada de visión más, así que no corre en cada mensaje. Solo con foto, y solo cuando la vía normal no dejó una respuesta buena:

| Lo que devolvió la búsqueda por nombre | Qué hace el cotejo |
|---|---|
| **Nada** | Busca por la marca (la primera palabra del término) y cotea esos. Es el caso que más duele y el que más gana. |
| **Varios** (típico cuando `identificar.js` bajó a nivel marca: "Nike" trae diez) | Los cotea y pone el acertado **primero**, sin descartar el resto. |
| **Uno solo** | No corre. No hay nada que elegir, y descartarlo por una duda sería cambiar un resultado bueno por ninguno. |

**Las decisiones que lo hacen seguro:**
- **Se elige por número, no por título.** Si se le pidiera el nombre, el modelo lo parafrasearía ("Air Max 97 plateadas" por el título real) y habría que adivinar a cuál se refería. Con un índice, o es uno de los que se le mandaron o es 0. Garantizado con `json_schema` + `strict`, igual que la visión.
- **Solo pasa la confianza "alta".** Lo que sale de aquí se convierte en una ficha con precio y botón de compra: con una corazonada no se manda. El prompt dice explícitamente que **"ninguno" (eleccion 0) es una respuesta correcta**, y prohíbe elegir "el más parecido" por no quedarse sin respuesta.
- **El color se mira el último.** El mismo modelo existe en veinte colores, y una historia trae filtro, luz de tienda y stickers encima. Decide la suela, después el corte.
- **Nunca empeora.** Si no está seguro, si el modelo falla o si Shopify no responde, devuelve `null` y el bot sigue exactamente igual que sin este archivo.

**Costo.** La foto del cliente va en `detail:"high"` (hay que leerla al detalle); las del catálogo en `detail:"low"`, porque son fotos de producto limpias sobre fondo liso donde la silueta y la suela se leen igual de bien. Máximo 8 candidatos — subirlo además empeora la comparación: cuantos más pares mira, más fácil es que se conforme con el más parecido.

**Pendiente de prueba real:** no hay acceso a la tienda desde este entorno, así que el cotejo está comprobado en su lógica de ramas (cuándo corre, cuándo no, qué manda) pero **no contra fotos reales del catálogo**. La primera prueba en vivo debería ser una respuesta a una historia de un modelo que el bot venía fallando.

### La tabla de D1 se crea sola (22-sep-2026)

`asegurarColumnas` en `estado.js` agregaba columnas, pero si la tabla **no existía** se rendía — y eso dejaba el arranque dependiendo de que alguien se acordara de correr `wrangler d1 migrations apply` a mano. En el primer arranque de EPICELL no se corrió: la base estaba creada pero vacía, y cada mensaje moría con `D1_ERROR: no such table: contactos`. El cliente escribió "Hola" y no recibió nada.

Ahora la tabla se crea desde el código igual que las columnas (`CREATE TABLE IF NOT EXISTS`, que no pisa nada si ya está). Las migraciones siguen existiendo para quien prefiera correrlas, pero ya no son la única forma. Es la regla 3 del `CLAUDE.md`, que hasta ahora se cumplía a medias.

### Estructura

```
worker/
  wrangler.toml          configuración del Worker (vars, binding de D1, binding de prompts .txt)
  migrations/
    0001_contactos.sql   crea la tabla de memoria en D1
    0002_ultimo_envio.sql  cuándo mandó el bot su último mensaje
    0003_mostrados.sql     qué productos ya vio cada cliente
  src/
    index.js             entrypoint y bot completo: /webhook (Meta, único canal), /estado, /probar-imagen, /probar-aviso
    ia.js                 llamadas a OpenAI (texto y visión; la visión usa JSON schema estricto)
    imagen.js             descarga la foto de Instagram y la convierte a data URI
    instagram.js           firma del webhook, envío de mensajes/fichas, lectura de eventos (incluye ecos)
    estado.js               memoria en D1: historial, nombre, pausa por asesor humano
    identificar.js          red de seguridad determinista para lo que identifica la IA en una foto
    cotejo.js               compara la foto del cliente con las fotos del catálogo y saca el par exacto
    indice.js               el catálogo mirado una vez y guardado en D1: rasgos por producto
    shopify.js              búsqueda de productos (Admin GraphQL API)
    color.js                separa el color del término de búsqueda y filtra por color
    historial.js            arma el contexto que ve el modelo (separa pasado/presente, recorta historial)
    catalogo.js              detecta que piden el catálogo POR SU NOMBRE, y que piden ver algo distinto de lo ya visto
    parecidos.js            tabla de modelos parecidos: qué ofrecer cuando ya vio todo lo de uno
    saludo.js                detecta saludos sueltos de clientes que ya escribieron antes
    aviso.js                 notificación a Slack cuando hay que escalar a un asesor
    prompts/
      texto.txt              prompt de conversación/ventas
      vision.txt              prompt de análisis de fotos (respuestas a historias / fotos directas)
      cotejo.txt              prompt del cotejo visual: cuál del catálogo es el de la foto
```

### Prompts

- `worker/src/prompts/texto.txt` — prompt principal de conversación/ventas. Devuelve JSON `{"respuesta":"...","buscar":"...","historial":"..."}`. Tabla de términos verificados para el catálogo de Shopify, reglas de tono (español neutro), bienvenida, manejo de historial, divisas, tallas, precios, etc.
  - **21-sep-2026 — vendedor, no repartidor de enlaces.** Se eliminó la contradicción entre "CATÁLOGO GENERAL" (elige una marca y búscala) y "MÁS MODELOS" (no busques, manda a la tienda): ganó la primera. "¿Qué más tienen?", "¿eso es todo?" y "¿solo tienen esos?" ahora se responden mostrando OTRA marca del catálogo. Sección nueva **"SI NO SABE QUÉ QUIERE, OFRÉCELE TÚ"**, con una tabla de pista→búsqueda ("para el gym" → `metcon`, "algo elegante" → `Superstar`, "para mi novia" → `dama`). Punto 7 nuevo en el repaso final: si la respuesta manda al catálogo, se reescribe. Se arregló además un ejemplo cortado a la mitad ("PEDIR MÁS — variantes del mismo producto" no tenía ni mensaje del cliente ni JSON).
  - **21-sep-2026 — historias reales.** Toda la sección "RESPUESTAS A HISTORIAS" describía un marcador `[PRODUCTO DE LA HISTORIA: X]` que el código dejó de mandar al retirar ManyChat: eran ~70 líneas y 6 ejemplos enseñando un contrato inexistente. Reescrita con los marcadores que `index.js` sí manda (historia en vídeo / imagen que no se pudo ver), y con la regla que faltaba: si el mensaje del cliente ya nombra marca, color o tipo, se busca en vez de preguntar.
  - **21-sep-2026 — se resolvió la contradicción del "¡sí tenemos!".** El prompt lo prohibía en una sección y lo pedía como ejemplo correcto en otras tres. Ahora la regla es una sola y tiene condición verificable: el entusiasmo vale **si en el mismo mensaje `buscar` no es "NADA"** — si la búsqueda no devuelve nada, `decidir()` sustituye la respuesta entera por la del asesor antes de que llegue al cliente, así que nunca se afirma en falso.
- `worker/src/prompts/vision.txt` — prompt de análisis de imágenes. Devuelve JSON `{"visto":"...","rasgos":{...},"respuesta":"...","buscar":"...","historial":"..."}`. Usa "escalera de confianza" (4 niveles) y firmas visuales por marca/modelo.
  - **19-sep-2026 (1):** ampliado con firmas visuales para ~30 marcas más (LV, Dior, Hermès, Golden Goose, Off White, Bape, Asics, Salomon, firmas de jugadores NBA, etc. — antes solo cubría ~12 modelos de Nike/Adidas/On Cloud/Vans/Puma) y con una "regla de marca única" que evita exigir dos rasgos en marcas donde el catálogo solo tiene un modelo. También se suavizó el sesgo hacia "no reconozco nada" en la escalera de confianza.
  - **19-sep-2026 (2):** una foto de prueba real (Nike Uplift, verde menta) salió identificada como "Air Max 270" — mal, porque no había firma para Uplift ni para el propio Air Max 270. Se agregaron esas dos, más Huarache, Cortez, Vapormax, M2K Tekno, Waffle Trainer, Wildhorse, Total 90, Puma Palermo, Adidas SL 72, Adidas Bad Bunny (Forum) y NB 530 Miu Miu — y una regla nueva, "NO FUERCES EL AJUSTE AL MODELO MÁS PARECIDO".
  - **19-sep-2026 (3):** firma completa para Metcon 6/7 (suela plana con placa dura, muesca lateral para trepar cuerda) — antes solo tenía una línea suelta. Se aclaró que Metcon 6 y 7 buscan igual (`metcon`).
  - **19-sep-2026 (4) — capa de código determinista.** La MISMA foto del Uplift volvió a salir "Air Max 270" pese a (2): afinar el texto no bastaba. Se cambió el contrato — la IA ya no decide sola. El JSON ahora incluye `"rasgos":{...}`, 15 sí/no sobre lo que se VE, independientes de qué modelo vaya a nombrar. `identificar.js` (código puro, sin IA) revisa si "buscar" es coherente con esos rasgos contra una tabla de reglas fija, y si no, la respuesta se descarta y se baja a nivel marca — sin excepciones. Cubre los grupos con fallos reales o alto riesgo de confusión (suelas altas de Nike, Metcon, AF1/Dunk/Retro 4/Jordan 40, On Cloud, Samba/Campus/Superstar).
  - **19-sep-2026 (5) — schema JSON estricto.** Con (4) desplegado, la MISMA foto volvió a salir "Air Max 270", sin cambio. Causa: `json_object` (modo suelto) solo garantiza JSON válido, no que traiga las claves que el prompt pide — "rasgos" se podía quedar afuera sin aviso, dejando a `identificar.js` sin nada que verificar. Se cambió a `response_format: json_schema` con `strict:true` en la llamada de visión: la API de OpenAI ahora garantiza que "rasgos" viene siempre con las 15 claves exactas. `identificar.js` exporta `RASGOS_CLAVE` como fuente única de verdad; `ia.js` la importa para armar el schema.
  - **21-sep-2026 (6) — el prompt de visión no sabía qué era una historia.** `index.js` le manda `[EL CLIENTE RESPONDIÓ A UNA HISTORIA — la imagen que ves ES la historia]` desde que se retiró ManyChat, pero `vision.txt` nunca mencionaba ese marcador: el modelo recibía una instrucción que no estaba entrenado a leer, justo en el mensaje más valioso que llega (quien responde a una historia ya vio el zapato y lo quiere). Sección nueva **"CUANDO LA FOTO ES UNA HISTORIA"**: la imagen es de la tienda y no del cliente, hay que ignorar precios y stickers superpuestos, con varios pares se elige por lo que escribió el cliente ("las negras", "la segunda") y si no dice nada el que sale más grande, y está prohibido pedir otra foto o decir que no se ve la historia. El nivel 4 cambia en historias: en vez de "¿me mandas una foto?", se pregunta cuál le gustó. Tres ejemplos nuevos.
  - **Cobertura del catálogo — pendiente de fotos reales.** Sin acceso a la tienda (`8vds1e-jw.myshopify.com` bloqueada por la política de red de este entorno), las firmas se escribieron con conocimiento general de sneakers bien documentados. ~10 nombres del catálogo no se reconocen con confianza y se dejaron sin firma a propósito (mejor sin firma que con una inventada): `Adidas Gallagher/Gallangher`, `Adidas Swicth/Switch`, `Jordan Lukka`, `Nike ava Rover`, `Nike bailleli`, `Nike Hiperset`, `Nike Hiperdunk`, `Nike Alpha`, `Nike DN/DN 8`, `DC shoes acsed/ascend`, `Adidas Adistar XLG`, `nike a'ja wilson a'one`. Si el dueño manda 1-2 fotos reales de cada uno, se completan. Los títulos genéricos sin silueta propia ("Adidas caballero", "Nike Dama", "X promoción", "Nike react/zoom/pulse") se dejaron sin firma a propósito.

### Problemas conocidos / pendientes

1. **Reconocimiento por foto — en buen estado, pendiente de una prueba limpia.** Ver el historial de cambios de `vision.txt` arriba. El último test real seguía fallando por dos motivos que YA NO deberían aplicar: (a) el contacto de prueba tenía el historial contaminado con "Air Max 270" de un test viejo (revisar que esté limpio antes de la próxima prueba), y (b) el duplicado enmascaraba cuál de las dos respuestas contradictorias reflejaba el estado real del código. Con ManyChat fuera, ya no hay ambigüedad: solo hay una respuesta, y viene siempre de la IA con el schema estricto + `identificar.js`.

2. **Migración a "solo Meta" — VERIFICADA en producción (21-sep-2026).** Confirmado con datos reales de D1: el historial se acumula entre mensajes (`"Pidió Adidas en negro. Ya busqué: Adidas en negro. Pidió Jordan 40 rojas."` — conversación de varios turnos), el filtro de color funciona, `ultimo_envio` se escribe en el momento del envío, y hay clientes reales atendidos. El pipeline completo (Meta → Worker → D1 → OpenAI → Shopify → Instagram → D1) está funcionando.

3b. **La pausa era invisible, y eso costó dos diagnósticos falsos (21-sep-2026).** El bot dejó de responder a una conversación de prueba. En `/estado` todo salía en verde y en el panel de Meta también, porque el webhook responde 200 igual. `wrangler tail` lo resolvió en un mensaje: `Bot pausado para 1592511162282699: no respondo` — estaba haciendo exactamente su trabajo. El problema es que no había forma de saberlo sin estar mirando los registros en ese preciso momento. Ahora: (a) al pausar sale un aviso a Slack diciendo qué conversación y por cuántas horas; (b) `/estado` lista los pausados, cuánto les queda, y **el comando de reanudar ya escrito** para copiar y pegar — el dueño no escribe SQL.
   - **Nota de diagnóstico, para la próxima.** Antes del `wrangler tail` yo señalé `META_APP_SECRET_IG FALTA` en `/estado` como la causa. Era falso: el log dijo `Firma válida con META_APP_SECRET`, o sea que para esta app la clave de Facebook SÍ es la que firma los webhooks de Instagram, y la de Instagram nunca hizo falta. **No borres `META_APP_SECRET` pensando que es la equivocada.** El texto de `/estado` que dice "la de Instagram ← es esta" induce a ese error y conviene reescribirlo.
   - **La ventana de 90 s de `envioReciente()` se dejó como estaba.** Se valoró ampliarla para reducir pausas falsas, y se descartó: un asesor que ve el aviso de Slack y contesta a los dos minutos es un caso real y frecuente, y con una ventana más ancha el bot le seguiría hablando por encima. 90 s cubre la carrera del eco propio sin tragarse a una persona.

3a. **La pausa falsa NO estaba corregida: seguía saltando con cada respuesta que mostraba producto (21-sep-2026).** El dueño lo acotó él solo, y su observación era la pista entera: *"cuando coloco me recomiendas algún calzado, el bot me pausa"*. Un mensaje del cliente no puede pausar nada — solo lo hace un eco. Lo que pasaba es que el bot se pausaba **por su propio mensaje**:

   ```
   enviarTexto(...)    ← sale el texto, su eco ya viene de camino
   enviarFichas(...)   ← uno o dos segundos armando el carrusel
   marcarEnvio(...)    ← recién AQUÍ se guardaba el mid del primero
   ```

   El eco del texto llegaba en esa ventana, como petición nueva y en paralelo, no encontraba su mid en D1, y como `ultimo_envio` era el del turno anterior tampoco lo salvaba `envioReciente()`. Resultado: el bot se tomaba por un asesor humano y se pausaba solo. **Por eso pasaba con las preguntas que muestran producto y no con un "hola": son las únicas que mandan DOS mensajes seguidos.** El arreglo del 21-sep había movido `marcarEnvio` "antes de Slack", que era la ventana equivocada — la de verdad estaba entre los dos envíos.

   Dos arreglos, y cada uno cierra la carrera por su cuenta (comprobado simulando las dos peticiones en paralelo):
   - **`mandar()`**: enviar y anotar son ahora una sola operación. Cada mid se guarda en el momento, antes de hacer nada más. Son dos escrituras en D1 por turno en vez de una.
   - **Segundo vistazo antes de pausar**: si el eco no se reconoce, se esperan 4 s y se vuelve a leer el contacto. Retrasar una pausa legítima 4 s no le cuesta nada al asesor; pausar de más cuesta una hora de silencio.

3c. **La pausa bajó de 4 h a 1 h, y el cliente ya no se queda a oscuras (21-sep-2026).** El dueño preguntó por qué no bajarla a "1 o 2 minutos" y avisar al cliente. Lo segundo era buena idea y está hecho; lo primero no, y conviene dejar escrito el motivo:
   - **La pausa se cuenta desde el ÚLTIMO mensaje del asesor, no desde el primero.** `pausar()` reescribe `pausado_hasta` en cada eco suyo, así que el reloj se reinicia cada vez que escribe. Una conversación activa sigue protegida por mucho que dure — el dato que hacía parecer que 4 h era una eternidad fija.
   - **Con dos minutos el bot se mete en medio del cierre.** El asesor está hablando de tallas, envíos, pagos y descuentos, que es exactamente lo que el bot tiene prohibido responder. Aparecer ahí con un carrusel no es un detalle feo: rompe la venta que una persona estaba cerrando.
   - **Lo que sí se arregló es el silencio.** Si el cliente escribe durante la pausa, ahora recibe "un asesor ya está viendo tu mensaje y te responde en un momento" — como máximo una vez cada 10 minutos, para no parecer un robot trabado. No contesta lo que preguntó: eso sigue siendo del asesor.
   - **Y si el asesor se distrae, se le llama.** Cuando el cliente vuelve a escribir y el asesor lleva más de 15 minutos callado, sale un aviso a Slack ("TE ESTÁN ESPERANDO") con cuánto lleva la conversación parada. Mientras el asesor esté contestando ahí mismo no sale nada: avisarle de algo que está viendo solo entrena a ignorar los avisos.
   - `PAUSA_HORAS` vive en `wrangler.toml` y admite decimales (`0.5` = 30 min). **Ojo: si no se pega el `wrangler.toml` nuevo, sigue en 4.**

3. **Pausa automática — funciona, pero pausaba de más; corregido el 21-sep-2026.** Se confirmó de rebote que el webhook SÍ está suscrito a `message_echoes` (si no, las pausas falsas nunca habrían ocurrido). El bug y su arreglo están descritos en el commit "Stop the bot from pausing itself on its own echo" y en los comentarios de `estado.js`. **Lo que falta validar:** que siga pausando cuando un asesor humano SÍ escribe. Probar: un asesor responde a mano desde la app de Instagram, esperar >90s desde el último mensaje del bot, y confirmar en `wrangler tail` que sale `"Asesor humano le escribió a ... bot pausado"`.

4. **Vigilar: la columna `nombre` sale vacía.** En las filas de prueba del 21-sep, `nombre` estaba en blanco. Puede ser correcto — `primerNombre()` descarta a propósito los usuarios de Instagram que parecen handle ("jonathan.rodri982") porque saludar así es peor que no saludar. Pero si el bot nunca usa el nombre de NADIE, revisar `obtenerNombre()` (llamada a la Graph API) y los filtros de `primerNombre()`.

5. **Respuestas a historias — sin verificar después del arreglo.** El síntoma original ("respondí a una historia y no llegó nada") es consistente con la pausa falsa, que ya está corregida, pero no se volvió a probar ese caso específicamente. El 21-sep se le añadió además a `vision.txt` la sección que le explica qué es una historia (ver arriba); eso también está sin probar contra una historia real.

6b. **El carrusel repetido volvió, y la culpa fue del arreglo (22-sep-2026).** Reaparecido tal cual: `"Recomiendame otro"` → Yeezy 700; `"No hay mas?"` → **las mismas** Yeezy 700. El código de deduplicación estaba bien y desplegado; lo que no existía era la columna `mostrados`, porque la migración nunca se corrió. Y el rescate que yo mismo había puesto para ese caso —guardar sin la columna y dejar un aviso en el registro— es lo que convirtió un fallo ruidoso en uno silencioso: el bot seguía atendiendo, nadie leía `wrangler tail`, y el bug volvió intacto después de darlo por cerrado dos veces.
   - **Ahora la columna se crea sola.** Al primer guardado que falle por eso, `crearColumnaMostrados()` ejecuta el `ALTER TABLE` desde el propio Worker y reintenta. D1 lo permite, cuesta una vez, y si dos peticiones lo intentan a la vez la segunda recibe `duplicate column` y sigue. Comprobado simulando una base sin la columna: se crea, no se pierde el historial, y el filtro funciona desde ese mismo mensaje.
   - **La lección, para lo que venga.** Los archivos se copian a mano, así que el código nuevo y la base vieja van a convivir siempre. Un arreglo que depende de que alguien recuerde un comando no es un arreglo: lo que se pueda resolver desde el archivo que sí se copia, se resuelve ahí. La migración `0003` se mantiene para instalaciones limpias, pero ya no es un requisito.

6. **Carrusel repetido — corregido el 21-sep-2026, requiere migración.** Capturado en producción por el propio cliente: `"Nike vapormax"` → 2 fichas; `"no mas mas de esos?"` → **las mismas 2 fichas**; `"son los mismos"` → mensaje de asesor + catálogo. La búsqueda hacía lo correcto (de ese modelo había dos y devolvía los dos); lo que faltaba era memoria de lo ya enseñado. Se agregó la columna `mostrados` (`migrations/0003_mostrados.sql`), y cuando el cliente pide algo distinto se descartan los títulos que ya vio. Si no queda ninguno nuevo, el bot lo dice de frente y le busca un modelo parecido con `parecidos.js` (tabla determinista de términos que existen en el catálogo — una alternativa inventada por la IA devolvería cero productos). Solo si tampoco hay parecidos nuevos aparece el catálogo. **Antes de desplegar hace falta correr `npx wrangler d1 migrations apply invictus-bot-db --remote`.**
   - **El filtro solo se aplica cuando el cliente pide variedad** (`pideMasVariedad()` en `catalogo.js`: "más", "otros", "son los mismos", "ya los vi", "eso es todo"). A propósito: un `"¿cuánto cuestan?"` sobre el mismo zapato TIENE que volver a mostrarlo.
   - **`seAcabaron` no es `buscoSinExito`.** Se separaron porque el mensaje honesto solo se puede dar en el primer caso: ahí sabemos que el producto existe porque lo mandamos nosotros. Cuando la búsqueda vuelve vacía no sabemos si es que no hay o si el término estaba mal armado, y por eso ese caso sigue diciendo "déjame confirmarte con un asesor" en vez de "no tenemos".

7. **El botón del catálogo ya no se pega a todas las respuestas — a probar en conversación real (21-sep-2026).** Antes, TODA respuesta sin productos salía con el botón de la tienda debajo: una pregunta de vendedora ("¿es para ti o para regalo?") llegaba con un empujón a irse del chat. Ahora el botón sale en un solo caso, `buscoSinExito` (buscamos lo que pidió y no apareció), más cuando el cliente pide el catálogo por su nombre. Y `catalogo.js` dejó de interceptar "¿qué más tienen?" / "¿eso es todo?": eso va al modelo, que ofrece otra marca y muestra calzado. **Qué mirar en la prueba:** que "¿qué más tienen?" devuelva fichas de producto y no un enlace; que "mándame el catálogo" siga devolviendo el botón; que una pregunta suelta ("¿son cómodas?") llegue como texto limpio, sin botón.
