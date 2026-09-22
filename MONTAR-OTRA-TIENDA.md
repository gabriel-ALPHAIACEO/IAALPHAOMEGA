# Montar el bot para otra tienda

Guía de principio a fin. Está escrita para El Emperador, pero sirve igual
para cualquier tienda que venga después.

## Lo que hay que entender antes de empezar

**El código es el mismo para todas las tiendas.** Todo lo que hay en `src/`
es idéntico en las dos carpetas: los mismos archivos, sin tocar una línea.

Lo único que cambia son dos cosas:

| Archivo | Qué lleva |
|---|---|
| `wrangler.toml` | credenciales, dominio de Shopify, WhatsApp, y `TIENDA = "emperador"` |
| `src/tiendas/emperador.js` | nombre, horarios, calidad, catálogo y términos de búsqueda |

Cuando arregle un fallo, pegas los mismos archivos de `src/` en las dos
carpetas y las dos quedan arregladas. Esa es toda la gracia de hacerlo así.

---

## Paso 1 — La carpeta

Copia la carpeta entera de Invictus a una nueva, por ejemplo
`C:\Users\ivoo\Documents\emperador-bot`.

Dentro de la carpeta nueva:

1. Borra `wrangler.toml`.
2. Renombra `wrangler.emperador.toml` → `wrangler.toml`.

`src/` se queda exactamente como está. No se toca.

---

## Paso 2 — Shopify

Necesitas dos cosas de la tienda de El Emperador:

**El dominio**, el que termina en `.myshopify.com`. Va en `wrangler.toml`,
en `SHOPIFY_TIENDA` y en `URL_CATALOGO`.

**Un token de Admin API**, para que el bot pueda buscar productos:

1. En el panel de Shopify: **Configuración → Aplicaciones y canales de
   ventas → Desarrollar aplicaciones → Crear una aplicación**.
2. En **Configuración de Admin API**, marca el permiso
   `read_products`. Con ese basta: el bot solo lee, nunca escribe.
3. **Instalar aplicación**, y copia el token que empieza por `shpat_`.

Ese token es un secreto, así que **no va en `wrangler.toml`**. Se carga
aparte (paso 5).

---

## Paso 3 — Meta / Instagram

Esta es la parte más larga, y es la misma que hiciste para Invictus.

1. En <https://developers.facebook.com> crea una app nueva, tipo
   **Negocios**.
2. Añade el producto **Instagram** → *API con inicio de sesión de
   Instagram*.
3. Conecta la cuenta de Instagram de El Emperador (tiene que ser
   **profesional**, no personal).
4. Genera el **token de acceso** de esa cuenta. Es el `IG_TOKEN`.
5. Copia la **clave secreta de la app**. Es el `META_APP_SECRET`.
6. En **Webhooks**, da de alta la URL del Worker nuevo:
   `https://emperador-bot.TU-CUENTA.workers.dev/webhook`
   con el token de verificación que pusiste en `wrangler.toml`
   (`META_VERIFY_TOKEN`).
7. Suscríbete a los campos **`messages`** y **`message_echoes`**.

> `message_echoes` no es opcional. Es lo que hace que el bot se calle
> cuando un asesor toma la conversación a mano. Sin eso, el bot habla por
> encima de tus vendedores.

**La URL del webhook solo se puede dar de alta cuando el Worker ya
existe.** Así que el orden real es: paso 4 y 5 primero, desplegar, y luego
volver aquí al punto 6.

---

## Paso 4 — La base de datos

Desde la carpeta de El Emperador:

```
npx.cmd wrangler d1 create emperador-bot-db
```

Imprime un `database_id`. Pégalo en `wrangler.toml`, en `database_id`.

**No hace falta correr migraciones.** La tabla y las columnas se crean
solas con el primer mensaje que atienda el bot.

> Tiene que ser una base **propia**. Si la compartes con Invictus se
> mezclan las conversaciones: un cliente vería el historial de la otra
> tienda y las pausas de asesor se pisarían entre sí.

---

## Paso 5 — Los secretos

**Desde dentro de la carpeta de El Emperador** (esto importa: los secretos
se cargan al Worker de la carpeta donde estás):

```
npx.cmd wrangler secret put OPENAI_API_KEY
npx.cmd wrangler secret put SLACK_WEBHOOK
npx.cmd wrangler secret put SHOPIFY_TOKEN
npx.cmd wrangler secret put META_APP_SECRET
npx.cmd wrangler secret put IG_TOKEN
```

`OPENAI_API_KEY` y `SLACK_WEBHOOK` pueden ser los mismos de Invictus. Los
otros tres son **propios de esta tienda**.

---

## Paso 6 — Desplegar

```
npx.cmd wrangler deploy
```

Y abre `https://emperador-bot.TU-CUENTA.workers.dev/estado`. Tiene que
decir:

```
TIENDA              El Emperador   (TIENDA = "emperador")
```

Si dice *Invictus Shoes*, falta `TIENDA = "emperador"` en `wrangler.toml`.
Eso es grave: el bot se presentaría con el nombre del otro negocio.

Con el Worker ya desplegado, vuelve al **paso 3, punto 6** y da de alta el
webhook en Meta.

---

## Paso 7 — El catálogo (lo que hace que de verdad funcione)

Hasta aquí el bot conversa, reconoce zapatos por foto y vende. Pero busca
a ciegas: no sabe qué productos existen en esta tienda.

En `src/tiendas/emperador.js` hay tres campos vacíos:

- `catalogo` — los títulos de los productos, tal cual están en Shopify
- `catalogoVision` — los mismos, para el prompt de las fotos
- `terminos` — la tabla que traduce lo que dice el cliente al término que
  sí encuentra productos

Para llenarlos:

1. En Shopify: **Productos → Exportar → CSV**.
2. Mándame el archivo y te devuelvo el `emperador.js` completo.

**Los títulos van tal cual, erratas incluidas.** La búsqueda es literal
contra el título: si en Shopify dice "New Balamce", aquí tiene que decir
"New Balamce". Corregirlo haría que esa búsqueda no encontrara nada.

**No se puede copiar la tabla de Invictus.** Está hecha a la medida de los
títulos de la otra tienda. Aplicarla aquí haría que búsquedas de productos
que sí existen devolvieran cero — y el cliente creería que no hay stock.

---

## Resumen de qué es propio y qué se comparte

| | Invictus | El Emperador |
|---|---|---|
| Archivos de `src/` | los mismos | los mismos |
| Worker | `invictus-bot` | `emperador-bot` |
| Base D1 | propia | propia |
| App de Meta + `IG_TOKEN` | propia | propia |
| Shopify + `SHOPIFY_TOKEN` | propia | propia |
| `OPENAI_API_KEY` | se puede compartir | se puede compartir |
| `SLACK_WEBHOOK` | se puede compartir | se puede compartir |

---

## Si algo no funciona

Abre `/estado` **antes de tocar nada**. Te dice la tienda, la versión
desplegada, qué secretos faltan, si la base está bien y qué conversaciones
están pausadas.

Si `/estado` ni siquiera carga, el Worker no arranca: casi siempre es un
archivo que no se copió. Comprueba que existan `src/tienda.js` y la
carpeta `src/tiendas/` con los dos archivos dentro.

Y si sigue sin salir, `npx.cmd wrangler tail` y mándame lo que imprima.
