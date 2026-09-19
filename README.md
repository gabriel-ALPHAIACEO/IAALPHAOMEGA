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

2. **Mensaje duplicado en respuestas a historias (Meta + ManyChat) — arreglado en código, falta configurar ManyChat y probar.** Captura de prueba del 19-sep-2026 muestra el duplicado TODAVÍA activo en producción (dos respuestas contradictorias a la misma "Precio") — lo más probable es que los pasos de configuración de ManyChat de abajo (campo personalizado + `MANYCHAT_API_TOKEN` + parámetro en el flow) no se hayan completado todavía, así que `atenderMeta()` sigue cayendo al comportamiento viejo. Falta confirmar con el dueño y verificar `GET /estado`.

   **Causa confirmada:** `META_MODO = "imagenes"` hace que el webhook directo de Meta responda tanto a fotos como a respuestas a historias. Cuando la imagen SÍ se podía descargar, `atenderMeta()` le respondía al cliente directo por la Graph API de Instagram — y por lo que se ve en el código (los campos `origen_historia` / `PRODUCTO DE LA HISTORIA`, aunque `origen_historia` en la práctica **siempre llega vacío**, confirmado con el dueño del bot — es un campo que quedó de adorno), ManyChat corre su propio flujo general de "cualquier mensaje" y también responde. Meta entrega el mismo webhook a las dos apps, cada una responde por su cuenta → mensaje duplicado.

   **El arreglo (ya en el código):** `atenderMeta()` deja de contestarle al cliente. En vez de eso llama a la API de ManyChat (`manychat-campo.js` → `ponerCampoManyChat()`) y le escribe al subscriber un campo personalizado con la URL de la imagen de la historia. ManyChat, que ya llama a `/manychat` en cada mensaje (incluidas las respuestas a historias), manda esa URL como si el cliente la hubiera adjuntado directo — y el código de `atenderManyChat()` ya sabe manejar eso sin ningún cambio, porque ya busca la foto en los campos `image_url` / `img_url` / `imagen` / `foto`. Resultado: responde una sola vez, y esa respuesta además tiene visión (antes ManyChat solo, sin la imagen, no podía identificar el calzado en historias genéricas).

   Si la llamada a ManyChat falla (token no cargado, campo mal escrito) o `MANYCHAT_API_TOKEN`/`MANYCHAT_CAMPO_IMAGEN` no están configurados todavía, `atenderMeta()` cae al comportamiento viejo (responder él mismo) como respaldo — así el despliegue de este cambio es seguro incluso antes de terminar la configuración en ManyChat.

   **Lo que falta hacer, del lado de ManyChat (no es código, es configuración en la plataforma):**
   1. Crear un campo personalizado de texto en ManyChat, por ejemplo `imagen_historia_url`.
   2. Copiar el token de ManyChat → Configuración → API, y cargarlo: `npx wrangler secret put MANYCHAT_API_TOKEN`.
   3. Confirmar en `worker/wrangler.toml` que `MANYCHAT_CAMPO_IMAGEN` tiene el nombre EXACTO del campo creado (sensible a mayúsculas).
   4. En el flow de ManyChat, en el External Request que ya llama a `POST /manychat`, agregar ese campo como parámetro `image_url` (o `img_url`/`imagen`/`foto`).
   5. Opcional pero recomendado: un paso de espera de 1-2s antes de ese External Request, para darle tiempo al webhook de Meta a escribir el campo primero.
   6. Probar con `GET /probar-manychat-campo?igsid=<un_igsid_real>&url=https://ejemplo.com/foto.jpg` antes de confiar en que ya funciona en producción.
   7. Confirmar en `GET /estado` que dice "Relevo a ManyChat: ACTIVO".

   Detalle completo del razonamiento en los comentarios de `worker/src/manychat-campo.js`.
