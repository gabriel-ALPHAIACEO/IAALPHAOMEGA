# Rodrigo — bot de Instagram (y WhatsApp) para una tienda de zapatos

**Tienda nueva (15-oct-2026).** Esta carpeta es el bot **completo**, hecho desde
la plantilla de El Emperador (la que ya está limpia de datos de Invictus):
DeepSeek para la IA, memoria en D1, pausa cuando habla un asesor, cotejo
visual de fotos, panel (`/panel`) con chats, CRM, métricas, inventario, caja,
gastos, reportes, ganancias y tienda web (`/tienda`), WhatsApp, comentarios de Instagram y
la puerta para conectar un sistema de inventario cerrado (`/api/sync`).

**Lo que cambia respecto a las otras tiendas:** Rodrigo vende **solo
calzado**, y **todavía no tiene datos propios cargados**. Lo que no sabe, lo
contesta un asesor (nunca se inventa): por eso el bot ya se puede probar, pero
no debe atender clientes de verdad hasta rellenar lo de abajo.

## Qué hace el bot mientras falten datos

| Tema | Qué contesta hoy | Dónde se llena |
|---|---|---|
| Horario, envíos, delivery, empleo | «Eso te lo confirma un asesor en un momento 😊» | `src/prompts/tienda.txt` |
| Métodos de pago y tasa | un asesor | `src/prompts/pagos.txt` (`[METODOS]`, `[TASA]`) |
| Cashea | un asesor | `src/prompts/pagos.txt` (`[CASHEA]`) |
| Dirección / «¿dónde están?» | un asesor | `wrangler.toml`: `DIRECCION`, `MAPS_URL`, `FOTO_LOCAL` |
| Calidad / originales | «La calidad te la confirma un asesor» | `src/prompts/texto.txt` (CALIDAD Y ORIGINALIDAD) |
| Productos y precios | **ninguno** (sin catálogo) | `wrangler.toml`: Shopify **o** Drive |
| Ropa, bolsos, gorras | «Por ahora solo manejamos calzado 😊» | — |

## LO QUE HACE FALTA QUE EL DUEÑO DÉ (la lista completa)

1. **El nombre exacto de la tienda** como quiere que lo diga el bot (hoy dice
   «Rodrigo»; si es «Rodrigo Shoes», se cambia `TIENDA_NOMBRE` y los prompts).
2. **De dónde sale el catálogo:** una tienda de **Shopify** (su dominio
   `xxxx.myshopify.com` y un token de la app) **o** una **carpeta de Google
   Drive** con una foto por modelo, con el nombre y el precio en el nombre del
   archivo (ver `wrangler.toml`).
3. **Horario**, **envíos** (¿con qué empresas, a dónde?), **delivery** (¿a qué
   zonas?) y si **contratan**.
4. **Métodos de pago** (solo cuáles, nunca los números de cuenta) y a qué
   **tasa** reciben.
5. **¿Acepta Cashea?** Si sí: la tabla de inicial por nivel, las cuotas y si
   hay promociones por fechas (se escribe en `pagos.txt`; ejemplos en las
   carpetas de El Emperador e Invictus).
6. **Dirección**, el **enlace de Google Maps** y, si quiere, una foto del local.
7. **¿Qué calidad vende?** (por ejemplo «1.1», «triple A», «original»). Hoy el
   bot no dice nada de eso: lo pasa a un asesor.
8. **Su número de WhatsApp** (el del botón «Comprar» de cada ficha).
9. **El logo** (opcional): hoy la tienda web muestra un monograma con la
   inicial. Ver `src/logo-tienda.js`.
10. **Las cuentas de Meta:** el Instagram de la tienda convertido en cuenta
    profesional, una **app de Meta propia** (o la suya) con el producto
    Instagram, y si va a usar **WhatsApp**, su número en la Cloud API
    (ver `WHATSAPP.md`).
11. **Una clave de DeepSeek con saldo** (platform.deepseek.com), propia de la
    tienda o la de las otras (la factura se junta).

## Puesta en marcha, en orden

> Todo se hace **dentro de la carpeta `rodrigo-bot`** (si no, se le cargan a otra tienda).

1. **Crear la base D1** (el `database_id` de `wrangler.toml` dice `PENDIENTE` a
   propósito, para que un despliegue sin hacer esto falle en vez de usar la base
   de otra tienda):
   ```
   npx.cmd wrangler d1 create rodrigo-bot-db
   ```
   Pega el `database_id` que imprime en `wrangler.toml`.
2. **Rellenar `wrangler.toml`** lo que diga `PENDIENTE` (catálogo, dirección,
   WhatsApp, enlace del catálogo). Y los textos de `src/prompts/tienda.txt` y
   `src/prompts/pagos.txt` con lo que dé el dueño.
3. **Los secretos** (uno por uno):
   ```
   npx.cmd wrangler secret put DEEPSEEK_API_KEY
   npx.cmd wrangler secret put META_APP_SECRET
   npx.cmd wrangler secret put META_APP_SECRET_IG
   npx.cmd wrangler secret put IG_TOKEN
   npx.cmd wrangler secret put SLACK_WEBHOOK
   npx.cmd wrangler secret put PANEL_CLAVE
   npx.cmd wrangler secret put SHOPIFY_TOKEN      (solo si el catálogo es Shopify)
   npx.cmd wrangler secret put PANEL_API_CLAVE    (para el panel central)
   ```
   `META_APP_SECRET_IG` es la clave del **producto Instagram**, no la de
   Configuración → Básica. El `IG_TOKEN` tiene que ser **de la cuenta de Rodrigo**
   (con el de otra tienda el bot contestaría desde otra cuenta).
4. **Desplegar:** `npx.cmd wrangler deploy`
5. **Comprobar** `https://rodrigo-bot.<tu-subdominio>.workers.dev/estado?clave=<PANEL_API_CLAVE>`:
   tiene que decir la versión **(1)** y «DB conectada».
6. **El webhook en Meta.** Antes de «Verificar y guardar», abrir en el navegador:
   ```
   https://rodrigo-bot.<tu-subdominio>.workers.dev/webhook?hub.mode=subscribe&hub.verify_token=rodrigo2026&hub.challenge=PRUEBA12345
   ```
   Tiene que devolver `PRUEBA12345` y nada más. Después, suscribir el webhook a
   **`messages`** y **`message_echoes`** (y **`comments`** si usa los comentarios).
7. **Indexar el catálogo:** abrir `/indexar-catalogo` y recargar hasta que diga
   LISTO (el cron lo mantiene solo después).
8. **Probar** sin clientes: `/probar-instagram`, `/probar-ubicacion`,
   `/probar-imagen?url=...`, `/probar-aviso`.
9. **Sumarlo al panel central** (opcional): en `panel-central`, el id `rodrigo`
   y el secreto `CLAVE_RODRIGO` (la misma `PANEL_API_CLAVE` de Rodrigo). Ver
   `panel-central/LEEME.md`.

## Rutas útiles

| Ruta | Para qué |
|---|---|
| `/estado` | Versión desplegada, secretos que faltan, estado de la base |
| `/panel` | El panel de la tienda (chats, CRM, inventario, caja…) |
| `/tienda` | La tienda web (con lo que haya en el inventario) |
| `/probar-imagen?url=...` | Probar la visión completa con una foto |
| `/indexar-catalogo` | Llenar el índice del catálogo (por tandas) |
| `/probar-aviso` | Mandar un aviso de prueba a Slack |
| `/api/sync/...` | Conectar un sistema de inventario cerrado (ver `agente-puente/LEEME.md`) |

## Lo que NUNCA se cruza entre tiendas

Cada tienda tiene **su carpeta, su Worker y su base de datos**. Los archivos de
`src/` son casi idénticos a propósito: un arreglo se pega en las carpetas que
correspondan. Lo que NUNCA se cruza: `wrangler.toml`, `src/prompts/`,
`src/logo-tienda.js` y los secretos. Ahí vive lo que hace que cada bot sea de su
tienda.

**Particularidades de esta carpeta** (para no confundirse al copiar archivos):
- `src/categorias.js` solo tiene **calzado** (El Emperador tiene cinco categorías).
- `src/prompts/vision.txt` y `texto.txt` hablan solo de calzado y mandan a un
  asesor lo de la calidad (no hay gama «doble A / triple A» aquí).
- Los demás archivos de `src/` son los de El Emperador, sin cambios.
