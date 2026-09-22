# EPICELL — lo que falta (22-sep-2026)

Este proyecto está **incompleto en el repo**: solo llegaron `wrangler.toml` y
los prompts. Falta `src/` (los `.js`), así que lo que se puede cambiar desde
acá son los prompts y nada más.

## 1. El webhook de Meta NO valida — y no puede validar

Probado en vivo el 22-sep. Pidiéndole la verificación exacta que manda Meta:

```
https://bot-telefonos.arizatecnologia.workers.dev/webhook?hub.mode=subscribe&hub.verify_token=epiccell2026&hub.challenge=PRUEBA12345
```

devuelve su cartel de siempre:

```
bot activo · 2026-09-22 · búsqueda exacta de números + colores de teléfonos + más de 10 → catálogo
```

Meta exige que la respuesta sea **exactamente** `PRUEBA12345`, con 200 y nada
más. Como recibe otra cosa, dice "No se ha podido validar la URL de
devolución de llamada ni el identificador de verificación".

**No es un problema de configuración, es de arquitectura:** este bot está
escrito para ManyChat. Su `/webhook` no es un webhook de Meta, y el
`wrangler.toml` no tiene `META_VERIFY_TOKEN`, `META_MODO`,
`META_APP_SECRET_IG` ni `IG_TOKEN` — los secretos que nombra son
`MANYCHAT_SECRET` y compañía.

Para conectarlo a Meta directo hay que portarle lo de Invictus: la
verificación del `hub.challenge`, la firma HMAC del webhook, el envío por la
Graph API y la memoria en D1. **Hace falta el `src/` de EPICELL.**

## 2. Los colores van al asesor (hecho en los prompts, falta en el código)

Decisión del dueño: la IA no opina de colores, los confirma un asesor. El
catálogo dice qué modelos hay, no qué colores quedan en la tienda hoy, y un
color afirmado de más es una venta que se cae en el mostrador.

Ya cambiado en `src/prompts/texto.txt` y `vision.txt`: el color sale del
término de búsqueda, se muestra el equipo igual, y el color se deriva.

**Falta en el código.** El propio cartel del Worker dice "búsqueda exacta de
números + **colores de teléfonos** + más de 10 → catálogo", así que hay un
módulo de color (el equivalente al `color.js` de Invictus) que sigue
filtrando por color. Hace falta el `src/` para quitarlo.

## 3. Marcadores sin llenar en los prompts

- `texto.txt` — `{{TUS HORARIOS}}` (aparece dos veces) y
  `{{ADAPTA ESTE BLOQUE A LO QUE VENDES Y BORRA LO QUE NO}}` (el bloque de
  nuevo/usado/reacondicionado).
- `vision.txt` — `{{COPIA AQUÍ LA MISMA TABLA DE TÉRMINOS DEL PROMPT DE TEXTO}}`.

## 4. Marcadores sin llenar en wrangler.toml

`SHEET_ID`, `URL_CATALOGO` y `WHATSAPP` siguen con `PEGA_AQUI...`,
`CAMBIA-ESTO` y `PON_AQUI_TU_NUMERO`.
