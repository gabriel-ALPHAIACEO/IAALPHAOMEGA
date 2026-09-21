# IAALPHAOMEGA — Chatbots IA (no-code)

Repositorio de trabajo para los chatbots de IA de los distintos clientes. Punto de partida: **Invictus Shoes**.

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

3. **Pausa automática — funciona, pero pausaba de más; corregido el 21-sep-2026.** Se confirmó de rebote que el webhook SÍ está suscrito a `message_echoes` (si no, las pausas falsas nunca habrían ocurrido). El bug y su arreglo están descritos en el commit "Stop the bot from pausing itself on its own echo" y en los comentarios de `estado.js`. **Lo que falta validar:** que siga pausando cuando un asesor humano SÍ escribe. Probar: un asesor responde a mano desde la app de Instagram, esperar >90s desde el último mensaje del bot, y confirmar en `wrangler tail` que sale `"Asesor humano le escribió a ... bot pausado"`.

4. **Vigilar: la columna `nombre` sale vacía.** En las filas de prueba del 21-sep, `nombre` estaba en blanco. Puede ser correcto — `primerNombre()` descarta a propósito los usuarios de Instagram que parecen handle ("jonathan.rodri982") porque saludar así es peor que no saludar. Pero si el bot nunca usa el nombre de NADIE, revisar `obtenerNombre()` (llamada a la Graph API) y los filtros de `primerNombre()`.

5. **Respuestas a historias — sin verificar después del arreglo.** El síntoma original ("respondí a una historia y no llegó nada") es consistente con la pausa falsa, que ya está corregida, pero no se volvió a probar ese caso específicamente. El 21-sep se le añadió además a `vision.txt` la sección que le explica qué es una historia (ver arriba); eso también está sin probar contra una historia real.

6. **Carrusel repetido — corregido el 21-sep-2026, requiere migración.** Capturado en producción por el propio cliente: `"Nike vapormax"` → 2 fichas; `"no mas mas de esos?"` → **las mismas 2 fichas**; `"son los mismos"` → mensaje de asesor + catálogo. La búsqueda hacía lo correcto (de ese modelo había dos y devolvía los dos); lo que faltaba era memoria de lo ya enseñado. Se agregó la columna `mostrados` (`migrations/0003_mostrados.sql`), y cuando el cliente pide algo distinto se descartan los títulos que ya vio. Si no queda ninguno nuevo, el bot lo dice de frente y le busca un modelo parecido con `parecidos.js` (tabla determinista de términos que existen en el catálogo — una alternativa inventada por la IA devolvería cero productos). Solo si tampoco hay parecidos nuevos aparece el catálogo. **Antes de desplegar hace falta correr `npx wrangler d1 migrations apply invictus-bot-db --remote`.**
   - **El filtro solo se aplica cuando el cliente pide variedad** (`pideMasVariedad()` en `catalogo.js`: "más", "otros", "son los mismos", "ya los vi", "eso es todo"). A propósito: un `"¿cuánto cuestan?"` sobre el mismo zapato TIENE que volver a mostrarlo.
   - **`seAcabaron` no es `buscoSinExito`.** Se separaron porque el mensaje honesto solo se puede dar en el primer caso: ahí sabemos que el producto existe porque lo mandamos nosotros. Cuando la búsqueda vuelve vacía no sabemos si es que no hay o si el término estaba mal armado, y por eso ese caso sigue diciendo "déjame confirmarte con un asesor" en vez de "no tenemos".

7. **El botón del catálogo ya no se pega a todas las respuestas — a probar en conversación real (21-sep-2026).** Antes, TODA respuesta sin productos salía con el botón de la tienda debajo: una pregunta de vendedora ("¿es para ti o para regalo?") llegaba con un empujón a irse del chat. Ahora el botón sale en un solo caso, `buscoSinExito` (buscamos lo que pidió y no apareció), más cuando el cliente pide el catálogo por su nombre. Y `catalogo.js` dejó de interceptar "¿qué más tienen?" / "¿eso es todo?": eso va al modelo, que ofrece otra marca y muestra calzado. **Qué mirar en la prueba:** que "¿qué más tienen?" devuelva fichas de producto y no un enlace; que "mándame el catálogo" siga devolviendo el botón; que una pregunta suelta ("¿son cómodas?") llegue como texto limpio, sin botón.
