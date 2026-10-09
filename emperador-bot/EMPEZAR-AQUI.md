# El Emperador — bot de Instagram para calzado

Esta carpeta es el bot **completo**, al día con todo lo que se le hizo a
Invictus hasta el 23-sep-2026. No es una plantilla a medio hacer: es el mismo
código que atiende clientes, con los datos de El Emperador.

## Qué trae ya hecho

- **Meta directo.** Habla con la API de Instagram, sin ManyChat ni Make. Una
  sola app, así que no existe el problema del mensaje duplicado.
- **Memoria en D1.** Historial, nombre del cliente, qué productos ya vio.
- **Pausa automática** cuando un asesor contesta a mano desde la app de
  Instagram, y el asesor le devuelve la conversación escribiendo
  `FRASE_DESPAUSAR` en el mismo chat.
- **Reconocimiento por foto en dos pasos**: un modelo mira la foto y saca 15
  rasgos, y una red determinista (`identificar.js`) verifica que el modelo
  que nombró sea coherente con esos rasgos.
- **Cotejo visual** (`cotejo.js`): compara la foto del cliente con las fotos
  reales del catálogo de Shopify. Es lo que hace que una respuesta a historia
  termine en la ficha correcta.
- **Índice del catálogo** (`indice.js` + `/indexar-catalogo`): mira el
  catálogo UNA vez y guarda los rasgos de cada producto en D1, para poder
  compararlo entero con una sola llamada.
- **La tabla de D1 se crea sola.** No hay migración que correr a mano.
- **Avisos a Slack** cuando hay que escalar a un asesor.

## Lo que es distinto de Invictus, y por qué importa

**La calidad.** Invictus vende una sola gama (1.1) y contesta con una frase
fija. El Emperador maneja **doble A y triple A**, así que "¿qué calidad es?"
ya no tiene una respuesta única: depende del par, y eso el bot no lo ve —
el catálogo le da un título y una foto, no la gama.

Por eso el prompt dice las dos gamas con naturalidad, y **si preguntan por un
par concreto lo manda al asesor**:

> "Esa te la confirma un asesor en un momento 😊"

Decir "triple A" de un par que es doble A es la equivocación más cara que
podría cometer: el cliente paga esperando una cosa y recibe otra.

## Lo que FALTA, y es lo que más se va a notar

**El catálogo de El Emperador no está cargado.** El bot conversa, atiende
fotos y vende igual, pero adivina los términos de búsqueda y va a fallar más
de la cuenta hasta que se cargue.

Ahora mismo los prompts dicen "todavía no tienes la lista de productos de
esta tienda", que es lo honesto: así el modelo usa las palabras exactas del
cliente en vez de inventar nombres de modelos que quizá no existen aquí.

**NO se puede copiar el catálogo de Invictus.** Esa lista está hecha a la
medida de los títulos de la otra tienda, erratas incluidas ("New Balamce",
los Jordan titulados "Retro 4"). Aplicarla aquí haría que la búsqueda
devolviera cero en productos que sí existen — que es exactamente el fallo que
hace creer al cliente que no hay stock.

**Cómo cargarlo:** en el panel de Shopify de El Emperador, Productos →
Exportar → CSV. Pasame ese archivo y te devuelvo los prompts con la lista y
con la tabla de términos hechas a la medida de esos títulos.

## Puesta en marcha, en orden

1. **Cambiar las cinco cosas de `wrangler.toml`** (están marcadas arriba del
   archivo, con MAYÚSCULAS).
2. **Crear la base:**
   ```
   npx.cmd wrangler d1 create emperador-bot-db
   ```
   y pegar el `database_id` que imprime. Si dice que ya existe:
   `npx.cmd wrangler d1 list`.
3. **Los secretos:**
   ```
   npx.cmd wrangler secret put OPENAI_API_KEY
   npx.cmd wrangler secret put SHOPIFY_TOKEN
   npx.cmd wrangler secret put SLACK_WEBHOOK
   npx.cmd wrangler secret put META_APP_SECRET_IG
   npx.cmd wrangler secret put IG_TOKEN
   ```
   `META_APP_SECRET_IG` es la clave del **producto Instagram**, no la de
   Configuración → Básica. Y el `SHOPIFY_TOKEN` tiene que ser el de la
   Shopify de El Emperador: con el de Invictus el bot mostraría el catálogo
   de la otra tienda **sin dar ningún error**.
4. **Desplegar:** `npx.cmd wrangler deploy`
5. **Comprobar** `https://emperador-bot.<tu-subdominio>.workers.dev/estado`:
   tiene que decir la versión y "DB conectada".
6. **El webhook en Meta.** Antes de apretar "Verificar y guardar", abrir en el
   navegador:
   ```
   https://emperador-bot.<tu-subdominio>.workers.dev/webhook?hub.mode=subscribe&hub.verify_token=emperador2026&hub.challenge=PRUEBA12345
   ```
   Tiene que devolver `PRUEBA12345` y nada más. Después, suscribir el webhook
   a **`messages`** y a **`message_echoes`** (los dos, en el producto
   Instagram). Sin el segundo no funciona la pausa automática.
7. **Indexar el catálogo:** abrir `/indexar-catalogo` y recargar hasta que
   diga LISTO. Hay que repetirlo cuando se agreguen productos.

## Rutas útiles

| Ruta | Para qué |
|---|---|
| `/estado` | Versión desplegada, secretos que faltan, estado de la base |
| `/probar-imagen?url=...` | Probar la visión completa con una foto, sin Instagram |
| `/indexar-catalogo` | Llenar el índice del catálogo (por tandas) |
| `/probar-aviso` | Mandar un aviso de prueba a Slack |

## Una advertencia sobre las dos tiendas

Invictus y El Emperador tienen **carpetas separadas, Workers separados y
bases separadas**. Los archivos de `src/` son casi idénticos a propósito: si
se arregla un fallo, se arregla pegando el mismo archivo en las dos carpetas.

Lo que NUNCA se cruza: `wrangler.toml`, `src/prompts/` y los secretos. Ahí es
donde vive lo que hace que cada bot sea de su tienda.
