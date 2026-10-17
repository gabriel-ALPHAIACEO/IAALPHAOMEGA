# La IA de respaldo (IA sin costo) — guía rápida

**Qué hace.** Cuando OpenAI no responde —se acabó el saldo (el 4 y 5 de octubre fueron 56 mensajes mudos), el límite del minuto, una caída— el cliente ya **no recibe «se me trabó el sistema»**: contesta una segunda IA, sin pagar clave, con el mismo prompt de la tienda y ejemplos de cómo contesta la de pago.

- Su respuesta pasa por **las mismas redes de seguridad** de siempre (tono, precios, Cashea, datos de la tienda): un «envío gratis» inventado no le llega al cliente.
- El panel marca el turno: **«respondió la IA de RESPALDO»**.
- El dueño recibe **un aviso** (en el panel central, cada 30 minutos como mucho): «La IA de pago no está respondiendo… revisa platform.openai.com → Billing».
- Si el respaldo tampoco puede (sin cupo, caída, tope del día), pasa lo de siempre: el aviso de «se me trabó el sistema». Nadie se queda sin respuesta peor que antes.
- Nunca contesta con nota de voz (la voz también es de OpenAI).

**Mientras OpenAI funciona, el respaldo no gasta nada** (ya no corre en paralelo). Pero va guardando las respuestas buenas de la IA de pago como ejemplos —las que el revisor marca mal, no—, y cuando le toca contestar recibe los 3 más parecidos a lo que escribió el cliente. Así sabe cómo contesta la tienda.

## Para encenderla (una vez)

1. Pega `src/` entero y `wrangler.toml` de Invictus (trae `[ai] binding = "AI"` y los ajustes `SOMBRA_*`).
2. `npx.cmd wrangler deploy` y comprueba en `/estado?clave=<PANEL_API_CLAVE>` que la versión es **109**.
3. **Comprueba el modelo**: abre `https://<tu-worker>/sombra/probar?clave=<PANEL_API_CLAVE>`. Hace UNA llamada real y dice si el modelo existe, si le cabe el prompt (~25.000 tokens), cuántos tokens gasta y si devolvió un JSON entendible. Si falla, te dice qué cambiar en `SOMBRA_MODELO` (uno del catálogo de Workers AI con ventana de **100.000 tokens o más**).
4. Mira cuántas veces ha entrado en `https://<tu-worker>/sombra?clave=<PANEL_API_CLAVE>`.

No hay secretos que cargar con Workers AI.

## Lo que cuesta

- **Cuenta gratis de Cloudflare**: 10.000 «neuronas» al día (se reinician a las 00:00 UTC). Cada respuesta gasta unas 700 por el prompt largo: caben **~12 respaldos al día**; después, el aviso de siempre. Si se acaba, descansa 30 minutos y vuelve a intentar.
- **Cuando paguen Workers** (plan de pago de Cloudflare): ya no hay ese límite y el respaldo entra al 100 %. Lo que pase de la cuota gratis se cobra (~$0,011 por 1.000 neuronas, unos **$0,008 por respuesta**). El techo es `RESPALDO_MAX_DIA` (400 al día ≈ $3 si OpenAI estuviera caído un día entero). Súbelo o bájalo en `wrangler.toml`.
- Las cifras de neuronas son estimadas: `/sombra` y `/sombra/probar` te dicen los tokens reales por llamada.

## Modos (`SOMBRA_MODO`)

- `respaldo` (por defecto): solo entra cuando la de pago falla.
- `sombra`: además compara en paralelo cada respuesta con la de pago (gasta cuota midiendo; hasta `SOMBRA_MAX_DIA`). Hoy no aporta, pero sirve el día que se quiera decidir si el respaldo ya es tan bueno como la de pago.
- `ambos`: las dos cosas.

## Si el modelo de Cloudflare no sirve

Usar otra IA con plan gratis (Gemini, por ejemplo; admite prompts largos). En `wrangler.toml`:
```
SOMBRA_PROVEEDOR = "compatible"
SOMBRA_URL    = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
SOMBRA_MODELO = "gemini-2.0-flash"
```
y la clave: `npx.cmd wrangler secret put SOMBRA_CLAVE`. Los límites de ese plan los pone el proveedor.

## Apagarla

`SOMBRA = "no"` en `wrangler.toml` y desplegar. Lo guardado (tablas `ia_ejemplos`, `ia_sombra`, `ia_respaldo`) se queda.

## Privacidad

Los ejemplos y los respaldos guardan lo que escribieron los clientes, en la base D1 de Invictus (como ya hacen los mensajes). Solo se ven con la clave del panel central. `/sombra/ejemplos.jsonl` baja los ejemplos.

## Lo que todavía no cubre

- Solo la IA de **texto**. Si OpenAI se cae, **las fotos** (la IA de imágenes) y el **revisor** siguen dependiendo de OpenAI: el cliente que manda una foto se atiende por lo que escribió (como cuando no se puede mirar una historia).
