# IAALPHAOMEGA — Chatbots IA (no-code)

Repositorio de trabajo para los chatbots de IA de los distintos clientes. Punto de partida: **Invictus Shoes**.

## Proyecto actual: Invictus Shoes

Chatbot vendedor de calzado por Instagram (carrusel de productos vía Shopify).

- **Modelo IA:** GPT-4o-mini (vía OpenAI, `response_format: json_object`)
- **Infraestructura:** Cloudflare Workers (sin n8n ni Make)
- **Integraciones:** Meta/Instagram (webhook directo) + ManyChat (canal principal) + Shopify (búsqueda de catálogo, GraphQL Admin API) + Slack (aviso a asesor)
- **App propia en Meta Developers:** además de ManyChat, hay una app de Meta Developers propia que recibe el webhook de Instagram directamente — su único propósito es traer la IMAGEN de las respuestas a historias, porque ManyChat no la reenvía.

### Estructura

```
worker/
  wrangler.toml          configuración del Worker (nombre, vars, binding de prompts .txt)
  src/
    index.js             entrypoint: /manychat, /webhook (Meta), /estado, /probar-imagen, /probar-aviso
    ia.js                llamadas a OpenAI (texto y visión)
    imagen.js            descarga la foto de Instagram y la convierte a data URI
    instagram.js         firma del webhook de Meta, envío de mensajes/fichas, filtro de eventos
    manychat.js           formato de respuesta v2 (Contenido Dinámico) para ManyChat
    shopify.js            búsqueda de productos (Admin GraphQL API)
    color.js              separa el color del término de búsqueda y filtra por color
    historial.js          arma el contexto que ve el modelo (separa pasado/presente, recorta historial)
    catalogo.js            detecta "quiero ver más" y responde con el catálogo sin pasar por el modelo
    saludo.js              detecta saludos sueltos de clientes que ya escribieron antes
    aviso.js               notificación a Slack cuando hay que escalar a un asesor
    estado.js               memoria en D1 (código sin usar hoy: no está importado en index.js ni hay binding D1 en wrangler.toml)
    manychat-campo.js       llama a la API de ManyChat para escribirle un campo al subscriber (el arreglo del mensaje duplicado)
    identificar.js          red de seguridad determinista: revisa que "buscar" (lo que dijo la IA de visión) sea coherente con los "rasgos" que ella misma marcó, y lo corrige por código si no
    prompts/
      texto.txt            prompt de conversación/ventas
      vision.txt            prompt de análisis de fotos (respuestas a historias / fotos directas)
```

**Falta en este repo:** `src/nombre.js` — `index.js` lo importa (`MAXIMO_DE_VECES`, `vecesUsado`, `sinMarca`, `conMarca`, `contarEn`, para no repetir el nombre del cliente en cada mensaje) pero no se subió. Hace falta para que el Worker corra.

### Prompts

- `worker/src/prompts/texto.txt` — prompt principal de conversación/ventas. Devuelve JSON `{"respuesta":"...","buscar":"...","historial":"..."}`. Tabla de términos verificados para el catálogo de Shopify, reglas de tono (español neutro), bienvenida, manejo de historial, reglas para respuestas a historias, divisas, tallas, precios, etc.
- `worker/src/prompts/vision.txt` — prompt de análisis de imágenes. Devuelve JSON `{"visto":"...","rasgos":{...},"respuesta":"...","buscar":"...","historial":"..."}`. Usa "escalera de confianza" (4 niveles) y firmas visuales por marca/modelo.
  - **19-sep-2026 (1):** ampliado con firmas visuales para ~30 marcas más (LV, Dior, Hermès, Golden Goose, Off White, Bape, Asics, Salomon, firmas de jugadores NBA, etc. — antes solo cubría ~12 modelos de Nike/Adidas/On Cloud/Vans/Puma) y con una "regla de marca única" que evita exigir dos rasgos en marcas donde el catálogo solo tiene un modelo. También se suavizó el sesgo hacia "no reconozco nada" en la escalera de confianza.
  - **19-sep-2026 (2):** una foto de prueba real (Nike Uplift, verde menta) salió identificada como "Air Max 270" — mal, porque no había firma para Uplift ni para el propio Air Max 270. Se agregaron esas dos, más Huarache, Cortez, Vapormax, M2K Tekno, Waffle Trainer, Wildhorse, Total 90, Puma Palermo, Adidas SL 72, Adidas Bad Bunny (Forum) y NB 530 Miu Miu — y una regla nueva, "NO FUERCES EL AJUSTE AL MODELO MÁS PARECIDO", que le prohíbe encajar una foto en el modelo más parecido cuando en realidad ninguno calza (que fue exactamente lo que pasó con el Uplift).
  - **19-sep-2026 (3):** los Metcon 7 no se reconocían bien — solo tenían una línea suelta ("zapatilla de gimnasio, plana, talón ancho") sin entrar en detalle, y con 13 variantes de Metcon 7 en catálogo (más 5 de Metcon 6) es de los modelos más vendidos. Se agregó una firma completa (suela plana con placa dura, muesca lateral para trepar cuerda, franja de goma en el talón) y se aclaró que Metcon 6 y 7 buscan igual (`metcon`), así que no hace falta distinguir cuál es — solo reconocer la familia.
  - **19-sep-2026 (4) — capa de código determinista.** Después de (2) y (3), la MISMA foto del Uplift volvió a salir "Air Max 270" en producción: afinar el texto del prompt no bastaba, el modelo seguía "saltando" a un producto sin que sus propios rasgos lo sostuvieran. Se cambió el contrato: la IA ya no decide sola. Ahora el JSON incluye `"rasgos":{...}` — 15 sí/no sobre lo que se VE (cámara de aire, muesca lateral, tres franjas, etc.), independientes de qué modelo vaya a nombrar. `worker/src/identificar.js` (código puro, sin IA) revisa después si "buscar" es coherente con esos rasgos, usando una tabla de reglas fija (qué rasgos exige y cuáles prohíbe cada modelo). Si no coincide, la respuesta se descarta automáticamente y se baja a nivel marca — sin excepciones, sin que la IA pueda "convencer" al código de lo contrario. Cubre los grupos donde ya hubo fallos o alto riesgo de confusión (las suelas altas de Nike, Metcon, AF1/Dunk/Retro 4/Jordan 40, On Cloud, Samba/Campus/Superstar); el resto de marcas sigue dependiendo solo del prompt. Se prueba con `node --check` + un script de casos en `identificar.js` (ver commit) — los 6 casos, incluido el fallo real de Uplift/Air Max 270, pasan.
  - **19-sep-2026 (5) — schema JSON estricto para "rasgos".** Con (4) desplegado, la MISMA foto de Uplift volvió a salir "Air Max 270", sin ningún cambio. Causa probable: `response_format: json_object` (modo suelto) solo garantiza JSON válido, no que traiga las claves que el prompt pide — con un prompt tan largo, "rasgos" se podía quedar afuera o incompleto sin aviso, y sin "rasgos" `identificar.js` no tenía nada que verificar (pasaba todo de largo, como si la capa de código no existiera). Se cambió `ia.js` para usar `response_format: json_schema` con `strict:true` SOLO en la llamada de visión: OpenAI ahora garantiza a nivel de API que "rasgos" viene con las 15 claves exactas, siempre. La lista de claves vive en un solo lugar (`identificar.js` exporta `RASGOS_CLAVE`, `ia.js` la importa para armar el schema) para que el prompt, el schema y las reglas nunca se desalineen. Si por algún motivo "rasgos" igual llegara vacío, ahora sale una `ALERTA` explícita en `wrangler tail` en vez de fallar en silencio. **Pendiente de confirmar con logs reales** que esto resuelve el caso — el dueño va a revisar `wrangler tail` en la próxima prueba.
  - **Cobertura del catálogo — pendiente de fotos reales.** No tengo acceso a la tienda (`8vds1e-jw.myshopify.com` está bloqueada por la política de red de este entorno), así que las firmas de arriba se escribieron con conocimiento general de sneakers bien documentados — no viendo tus productos reales. Hay ~10 nombres del catálogo que no reconozco con confianza y preferí NO inventarles una descripción (mejor sin firma que con una falsa): `Adidas Gallagher/Gallangher`, `Adidas Swicth/Switch`, `Jordan Lukka`, `Nike ava Rover`, `Nike bailleli`, `Nike Hiperset`, `Nike Hiperdunk`, `Nike Alpha`, `Nike DN/DN 8`, `DC shoes acsed/ascend`, `Adidas Adistar XLG`, `nike a'ja wilson a'one`. Si el dueño manda 1-2 fotos reales de cada uno, se completan con la misma calidad que el resto. Los títulos genéricos sin silueta propia ("Adidas caballero", "Nike Dama", "X promoción", "Nike react/zoom/pulse" — son plataformas de tecnología, no un modelo único) se dejaron sin firma a propósito: ahí no hay nada que distinguir, y el nivel de marca es la respuesta correcta.

### Problemas conocidos

1. **Reconocimiento de calzado en fotos (en progreso).** Causa raíz identificada: `FIRMAS VISUALES` en `vision.txt` solo cubría un subconjunto pequeño del catálogo (Nike/Adidas/On Cloud/Vans/Puma), así que cualquier foto de las otras ~30 marcas caía por defecto en "no reconozco, pídele el nombre". Se amplió la sección — pendiente de probar en producción con fotos reales. También se agregó `detail:"high"` en la llamada a OpenAI en `ia.js` (antes no se especificaba, quedaba en "auto"; no era la causa raíz pero no había razón para no forzar la máxima resolución en fotos de producto).

2. **Mensaje duplicado en respuestas a historias (Meta + ManyChat) — resuelto de raíz el 19-sep-2026 (3).**

   **Diagnóstico con logs reales (`wrangler tail`):** el intento de relevo (`ponerCampoManyChat`) fallaba siempre con `400 "Subscriber does not exist"`. Causa: la API de ManyChat pide su **contact_id interno** para escribir un campo (`setCustomFieldByName`), y ese NO es el mismo número que el `igsid` que entrega el webhook de Meta — confirmado también por [la comunidad de ManyChat](https://community.manychat.com/general-q-a-43/contact-id-and-psid-6008): *"ManyChat's API doesn't accept a PSID as subscriber_id; both getInfo and setCustomFieldByName require the internal contact_id... the Manychat Contact ID is not the same thing as the Instagram IGSIDs."* No hay endpoint público para traducir uno al otro directamente. Como el relevo fallaba siempre, `atenderMeta()` caía a su "respaldo" (responder directo) en el 100% de los casos — es decir, ese respaldo terminó siendo el comportamiento de SIEMPRE, y por eso el duplicado nunca se fue con el primer arreglo.

   **La causa real de fondo, y el arreglo de una vez:** el error de diseño era que hubiera un "respaldo" que responde directo. Mientras ManyChat sea el canal (`MANYCHAT_SECRET` cargado), NINGUNA circunstancia justifica que esta app le conteste también al cliente — ManyChat ya lo va a hacer, con o sin imagen. Se quitó el respaldo: ahora, si `MANYCHAT_SECRET` está cargado, `atenderMeta()` se calla siempre después de intentar el relevo (le salga o no), sin excepción. El camino que responde directo por la Graph API de Instagram solo corre si este Worker es el ÚNICO canal (sin ManyChat de por medio).

   **Costo de este arreglo, temporal:** mientras no se resuelva el mapeo de IDs (ver abajo), las respuestas a HISTORIAS pierden la identificación automática por imagen — ManyChat le pregunta el modelo al cliente en vez de reconocerlo solo, igual que antes de que existiera este relevo. Las fotos mandadas DIRECTO por DM (no como respuesta a una historia) no deberían verse afectadas: esas ManyChat ya las recibe por su cuenta.

   **Pendiente — recuperar la visión en historias (mapeo de IDs):** según la comunidad de ManyChat, el camino es crear un campo personalizado que guarde el IGSID de cada subscriber y usar el endpoint `findByUserField` de su API para resolver el contact_id a partir de ahí — sin verificar todavía contra la documentación oficial (bloqueada por la política de red de este entorno). Queda para una siguiente vuelta, con pruebas reales antes de confiar en ella (la lección de este mismo arreglo).

   **Setup en ManyChat que sigue haciendo falta** (para cuando se resuelva el mapeo de IDs):
   1. Campo personalizado de texto, ej. `imagen_historia_url` — ya está usado en el intento de relevo.
   2. Token de ManyChat → Configuración → API, cargado con `npx wrangler secret put MANYCHAT_API_TOKEN`.
   3. El flow de ManyChat tiene que pasar ese campo como parámetro `image_url` en el External Request que llama a `POST /manychat`.

   Detalle completo del razonamiento en los comentarios de `worker/src/manychat-campo.js` y `worker/src/index.js` (función `atenderMeta`).

3. **Historial contaminado en el contacto de pruebas.** El campo `historial` de ManyChat para el contacto usado en las pruebas ("Gabriel Zerpa") quedó con `"Ya busqué: Air Max 270"` desde el primer test fallido, y como ese dato se arrastra en cada mensaje siguiente, contaminó los tests posteriores independientemente de si la visión ya estaba arreglada o no. Hay que limpiar ese campo (o probar con un contacto nuevo) antes de evaluar si el reconocimiento por foto funciona bien.
