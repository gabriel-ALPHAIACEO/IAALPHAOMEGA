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
    prompts/
      texto.txt            prompt de conversación/ventas
      vision.txt            prompt de análisis de fotos (respuestas a historias / fotos directas)
```

**Falta en este repo:** `src/nombre.js` — `index.js` lo importa (`MAXIMO_DE_VECES`, `vecesUsado`, `sinMarca`, `conMarca`, `contarEn`, para no repetir el nombre del cliente en cada mensaje) pero no se subió. Hace falta para que el Worker corra.

### Prompts

- `worker/src/prompts/texto.txt` — prompt principal de conversación/ventas. Devuelve JSON `{"respuesta":"...","buscar":"...","historial":"..."}`. Tabla de términos verificados para el catálogo de Shopify, reglas de tono (español neutro), bienvenida, manejo de historial, reglas para respuestas a historias, divisas, tallas, precios, etc.
- `worker/src/prompts/vision.txt` — prompt de análisis de imágenes. Devuelve JSON `{"visto":"...","respuesta":"...","buscar":"...","historial":"..."}`. Usa "escalera de confianza" (4 niveles) y firmas visuales por marca/modelo.
  - **19-sep-2026:** ampliado con firmas visuales para ~30 marcas más (LV, Dior, Hermès, Golden Goose, Off White, Bape, Asics, Salomon, firmas de jugadores NBA, etc. — antes solo cubría ~12 modelos de Nike/Adidas/On Cloud/Vans/Puma) y con una "regla de marca única" que evita exigir dos rasgos en marcas donde el catálogo solo tiene un modelo. También se suavizó el sesgo hacia "no reconozco nada" en la escalera de confianza. Ver commits para el detalle.

### Problemas conocidos

1. **Reconocimiento de calzado en fotos (en progreso).** Causa raíz identificada: `FIRMAS VISUALES` en `vision.txt` solo cubría un subconjunto pequeño del catálogo (Nike/Adidas/On Cloud/Vans/Puma), así que cualquier foto de las otras ~30 marcas caía por defecto en "no reconozco, pídele el nombre". Se amplió la sección — pendiente de probar en producción con fotos reales. También se agregó `detail:"high"` en la llamada a OpenAI en `ia.js` (antes no se especificaba, quedaba en "auto"; no era la causa raíz pero no había razón para no forzar la máxima resolución en fotos de producto).

2. **Mensaje duplicado en respuestas a historias (Meta + ManyChat) — arreglado en código, falta configurar ManyChat y probar.**

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
