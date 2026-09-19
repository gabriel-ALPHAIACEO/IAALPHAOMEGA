# IAALPHAOMEGA — Chatbots IA (no-code)

Repositorio de trabajo para los chatbots de IA de los distintos clientes. Punto de partida: **Invictus Shoes**.

## Proyecto actual: Invictus Shoes

Chatbot vendedor de calzado por Instagram (carrusel de productos vía Shopify).

- **Modelo IA:** GPT-4o-mini
- **Infraestructura:** Cloudflare Workers (sin n8n ni Make)
- **Integraciones:** Meta (Instagram DMs / Stories) + ManyChat + Shopify (búsqueda de catálogo)
- **App propia en Meta Developers:** provee visión a la IA (analiza fotos que el cliente envía) vía API key

### Prompts

- `prompts/prompt-texto.txt` — prompt principal de conversación/ventas. Devuelve JSON `{"respuesta":"...","buscar":"...","historial":"..."}`. Contiene la tabla de términos verificados para buscar en el catálogo de Shopify, reglas de tono (español neutro), reglas de bienvenida, manejo de historial, reglas para respuestas a Stories, etc.
- `prompts/prompt-vision.txt` — prompt de análisis de imágenes cuando el cliente manda una foto de un calzado por Instagram. Devuelve JSON `{"visto":"...","respuesta":"...","buscar":"...","historial":"..."}`. Usa "escalera de confianza" (4 niveles) y firmas visuales por marca/modelo para identificar el producto y evitar inventar modelos.

### Problemas conocidos (pendientes de resolver)

1. **Reconocimiento de calzado en fotos falla en producción.** El prompt de visión pide identificar el modelo por firmas visuales, pero a veces no reconoce el calzado y pregunta "¿qué calzado es ese?" en vez de identificarlo. A investigar: si es problema del prompt, de la calidad/resolución de imagen que llega, o del modelo.

2. **Mensaje duplicado en respuestas a Stories (Meta + ManyChat).** Cuando el cliente responde a una historia de Instagram, el bot manda el mensaje DOS veces: una viene del flujo de ManyChat y otra del flujo de la app de Meta Developers (la que da visión vía API key). Sospecha: ambos webhooks reciben el mismo evento de "story reply" y cada uno dispara su propia llamada al Worker de Cloudflare, sin deduplicación entre ellos.

### Pendiente de aportar

- Código del/los Cloudflare Worker(s) que orquestan el bot (webhooks de Meta y ManyChat, llamada a OpenAI, integración con Shopify).
- Configuración de la app de Meta Developers (webhooks suscritos, endpoints).
- Configuración de ManyChat (flujos, triggers de Stories).
