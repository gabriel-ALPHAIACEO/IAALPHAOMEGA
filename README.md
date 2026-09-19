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
    estado.js               memoria en D1 (solo para el modo Instagram directo; ManyChat guarda la suya)
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

2. **Mensaje duplicado en respuestas a historias (Meta + ManyChat) — pendiente.** Confirmado en el código: `META_MODO = "imagenes"` (wrangler.toml) hace que el webhook directo de Meta responda tanto a fotos como a respuestas a historias. En `index.js` → `atenderMeta()`, cuando la imagen SÍ se puede descargar, el Worker responde directamente al cliente por la Graph API de Instagram (`enviarTexto` + `enviarFichas`), sin pasar por ManyChat. Si ManyChat tiene su propia automatización para respuestas a historias (lo que indican los campos `origen_historia` / `PRODUCTO DE LA HISTORIA`), Meta entrega el mismo evento a las dos apps (la de ManyChat y la propia) y las dos responden por separado → mensaje duplicado. El código ya contempla esto parcialmente: si la imagen NO se puede descargar y hay `MANYCHAT_SECRET`, el Worker se queda callado y deja que responda ManyChat — pero esa protección no cubre el caso donde la imagen SÍ se descarga, que es el más común. Solución más probable: que el camino directo de Meta deje de responder al cliente y en su lugar solo guarde el resultado de la visión (p. ej. en KV) para que `/manychat` lo recoja cuando ManyChat llame momentos después — pendiente de decidir e implementar.
