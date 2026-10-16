# La IA sombra (IA gratis en paralelo) — guía rápida

**Qué es.** Una segunda IA, sin pagar clave, que lee cada conversación junto a la de OpenAI y escribe en secreto qué habría contestado. **Nunca le habla al cliente**: el cliente recibe exactamente lo mismo que antes. Corre *después* de enviar la respuesta.

**Cómo aprende de la de pago** (sin entrenar nada):
1. Cada respuesta buena de la de pago se guarda como **ejemplo** (las que el revisor marca mal, no).
2. Cuando la gratis va a contestar, recibe los 3 ejemplos más parecidos a lo que escribió el cliente.
3. Se **comparan** las dos: ¿buscó lo mismo?, ¿decidió igual enseñar fotos o solo texto?, ¿se parece?, ¿inventó algún número?
4. Cuando hay 50 comparaciones y coincide en 90 % de lo que busca, no inventa datos y se parece, `/sombra` dice **«Lista para tomar el mando»**. Hasta entonces la de pago sigue sola.

## Para encenderla (una vez)

1. Pega `src/` entero y `wrangler.toml` de Invictus (trae `[ai] binding = "AI"` y los ajustes `SOMBRA_*`).
2. `npx.cmd wrangler deploy` y comprueba en `/estado?clave=<PANEL_API_CLAVE>` que la versión es **108**.
3. **Comprueba el modelo**: abre `https://<tu-worker>/sombra/probar?clave=<PANEL_API_CLAVE>`. Hace UNA llamada real y dice si el modelo existe, cuántos tokens gasta y si devolvió un JSON entendible. Si dice que el modelo no existe o que el prompt no cabe, cambia `SOMBRA_MODELO` en `wrangler.toml` por otro del catálogo de Workers AI con ventana de **100.000 tokens o más** y vuelve a desplegar.
4. Mira cómo va en `https://<tu-worker>/sombra?clave=<PANEL_API_CLAVE>` (cada comparación: lo que dijo cada una).

No hay secretos que cargar con Workers AI.

## Lo que cuesta (importante)

- Cloudflare regala **10.000 «neuronas» al día** (se reinician a las 00:00 UTC). El prompt de Invictus pesa ~25.000 tokens, así que **cada llamada gasta unas 700 neuronas**: caben ~12 al día. Por eso `SOMBRA_MAX_DIA = "12"`.
- Con la cuenta **gratis** de Cloudflare, si se acaba la cuota las llamadas fallan y no se cobra nada; la sombra descansa hasta el día siguiente.
- Con la cuenta **de pago** de Cloudflare, lo que pase de la cuota se cobra (~$0,011 por 1.000 neuronas). El tope de llamadas lo limita a centavos al día.
- `/sombra` y `/sombra/probar` te dicen cuántos tokens gasta cada llamada para que saques la cuenta con el precio del modelo que elijas.
- Los ejemplos del maestro se juntan en **cada** mensaje, aunque la cuota ya se haya acabado: lo que aprende no depende de la cuota; la cuota solo limita cuántas comparaciones se miden por día.

## Si 12 comparaciones al día no alcanzan

Usar otra IA gratis con clave (Gemini, por ejemplo; tiene un plan gratis y admite prompts largos). En `wrangler.toml`:
```
SOMBRA_PROVEEDOR = "compatible"
SOMBRA_URL    = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
SOMBRA_MODELO = "gemini-2.0-flash"
```
y la clave: `npx.cmd wrangler secret put SOMBRA_CLAVE`. Los límites de ese plan los pone el proveedor: compruébalos en su página.

## Apagarla

`SOMBRA = "no"` en `wrangler.toml` y desplegar. Lo que ya guardó (tablas `ia_ejemplos` e `ia_sombra`) se queda.

## Privacidad

Los ejemplos y las comparaciones guardan lo que escribieron los clientes, en la base D1 de Invictus (como ya hacen los mensajes). Solo se ven con la clave del panel central. `/sombra/ejemplos.jsonl` baja los ejemplos por si algún día se quiere afinar un modelo propio.

## Lo que todavía no hace

- Solo la IA de **texto**. La de imágenes y el revisor siguen con OpenAI.
- La gratis nunca contesta de verdad: no hay modo «respaldo» (cuando OpenAI se queda sin saldo). Se puede añadir cuando la sombra demuestre que está lista.
