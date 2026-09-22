# EPICELL — estado y lo que falta (22-sep-2026)

## Hecho: Meta directo, sin ManyChat

El webhook no validaba, y no era configuración: era arquitectura. Pedida la
verificación exacta que manda Meta, el Worker contestaba su cartel:

```
bot activo · 2026-09-22 · búsqueda exacta de números + colores...
```

Meta exige recibir **exactamente** el `hub.challenge` y nada más. Como el bot
estaba escrito para ManyChat, no tenía esa ruta ni las variables `META_*`.

Ahora el `index.js` es el bot completo de punta a punta, con la misma capa de
Meta que corre en Invictus (los archivos `instagram.js`, `estado.js` e
`imagen.js` están copiados de producción **sin una línea cambiada**):

- `/webhook` GET → responde el desafío de Meta.
- `/webhook` POST → valida la firma HMAC, descarta lo que no hay que atender y
  responde 200 siempre y rápido; el trabajo va en `ctx.waitUntil`.
- La memoria de cada conversación vive en **D1**, no en los campos de otro
  sistema: historial, nombre, pausa.
- **Pausa automática** cuando un asesor contesta a mano desde la app de
  Instagram, detectada por el eco del mensaje. Se le devuelve la conversación
  al bot escribiendo `FRASE_DESPAUSAR` en el mismo chat.
- `/estado` nuevo: versión desplegada, secretos que faltan, estado de la base.

**Se borraron `manychat.js` y `nombre.js`.** El segundo contaba cuántas veces
se había dicho el nombre del cliente con una marca pegada al historial; ahora
el nombre tiene su columna en D1 y esa gimnasia sobra.

Todo lo demás de EPICELL quedó igual: Cashea, precios en divisas, la hoja de
Google, los términos de búsqueda, el catálogo en el prompt, la escalada al
asesor.

## Hecho: los colores van al asesor

El catálogo dice qué **modelos** hay, no qué colores quedan en la tienda hoy.
Un color afirmado de más es una venta que se cae en el mostrador.

- El prompt ya no le permite hablar de colores (antes decía "SÍ puedes:
  mostrar equipos, modelos, capacidades **y colores**").
- El color **sale del término de búsqueda** y ya no se filtra por color sobre
  los títulos: filtrar daba por hecho que el color del título es el que hay en
  stock, que es justo lo que no se sabe.
- Si el cliente nombra un color, **se le muestra el equipo igual** y el color
  se deriva. "El iPhone 15 blanco" busca "iPhone 15": mostrarle el equipo es
  ayudarlo, callarse el color es no mentirle.
- El color se detecta en lo que escribió **el cliente**, no en el término del
  modelo, usando la misma tabla de `color.js`. Perseguirlo con frases hechas
  se quedaba corto: "¿tienen el iPhone 15 en blanco?" no encajaba en ninguna.

`filtrarPorColor` y `terminoDeColor` siguen en `color.js` pero ya no se usan.

## Hecho: los gigas se responden, con el catálogo delante

La capacidad está escrita en el **título** del catálogo ("iPhone 15 128GB"),
así que es un dato real — al revés que el color, que el título no sabe. Por
eso los gigas SÍ se contestan.

Lo que resuelve, que era una venta perdida por mensaje: *"¿tienen el 15 de
256?"* cuando no había ese exacto devolvía cero, el bot decía "déjame
confirmarte con un asesor" y el cliente se iba — **con el mismo modelo ahí,
en 128 y en 512**.

Ahora, si la búsqueda traía una capacidad y no dio nada, se busca el modelo
**sin ella**. Si aparece, no es que no lo tengamos: es que no lo tenemos en
esos gigas, y eso se dice con el dato delante:

> En 256GB no lo tengo ahora mismo 😅 Pero me queda en 128GB y 512GB, mira 👇

Y *"¿qué capacidades tienen del 15?"* se responde leyendo los títulos que
volvieron, ordenados de menor a mayor.

**La frase la escribe el código, no el modelo**, y por un motivo: el modelo
redacta ANTES de que se haga la búsqueda, así que no puede saber en qué
capacidades quedó el equipo. El prompt ahora se lo dice explícitamente —
nunca adelantar capacidades, nunca decir que una no la hay, solo buscar.

Cuidado con los números: `capacidad.js` acepta "256" suelto como capacidad
pero **nunca** 12, 13 o 16, que son nombres de modelo ("iPhone 16" no es
dieciséis gigas). Con unidad escrita —"16GB"— sí vale.

## Falta: configuración (no es código)

1. **Crear la base de datos y correr la migración:**
   ```
   npx wrangler d1 create bot-telefonos-db
   ```
   Copiar el `database_id` que imprime dentro de `wrangler.toml` (busca
   `PENDIENTE`), y después:
   ```
   npx wrangler d1 migrations apply bot-telefonos-db --remote
   ```
2. **Los dos secretos nuevos:**
   ```
   npx wrangler secret put META_APP_SECRET_IG
   npx wrangler secret put IG_TOKEN
   ```
   `META_APP_SECRET_IG` es la clave del **producto Instagram**, no la de
   Configuración → Básica. Las dos miden 32 caracteres y no se distinguen a
   ojo; si el registro dice que la firma no cuadra, está cargada la otra.
3. **En el panel de Meta**, suscribir el webhook a `messages` **y a
   `message_echoes`**. Sin el segundo no funciona la pausa automática.
4. **Desconectar ManyChat** de la cuenta de Instagram. Si se queda conectado,
   su app puede seguir recibiendo el mismo webhook e intentar su propia
   automatización — que es exactamente el mensaje duplicado que esto viene a
   evitar.
5. Los marcadores de `wrangler.toml`: `SHEET_ID`, `URL_CATALOGO`, `WHATSAPP`.

## Falta: datos para los prompts

- `texto.txt` — `{{TUS HORARIOS}}` (aparece dos veces) y
  `{{ADAPTA ESTE BLOQUE A LO QUE VENDES Y BORRA LO QUE NO}}` (el bloque de
  nuevo / usado / reacondicionado: hay que decir cuál de los tres vende
  EPICELL).
- `vision.txt` — `{{COPIA AQUÍ LA MISMA TABLA DE TÉRMINOS DEL PROMPT DE TEXTO}}`.

## Cómo comprobar que quedó bien

Antes de apretar "Verificar y guardar" en Meta, abrir esto en el navegador:

```
https://bot-telefonos.arizatecnologia.workers.dev/webhook?hub.mode=subscribe&hub.verify_token=epiccell2026&hub.challenge=PRUEBA12345
```

Tiene que salir **`PRUEBA12345`** y nada más. Si sale el cartel del bot, el
despliegue no llegó.

Y `/estado` tiene que decir la versión nueva y "DB conectada".
