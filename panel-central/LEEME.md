# Panel central — todas las tiendas en un solo sitio

Es un Worker **tuyo** que mira todas las tiendas a la vez. **No atiende clientes.**
Cada tienda sigue siendo su propio Worker con su propia base, y eso no cambia
(decisión del 29-sep-2026). Este panel les pide los datos por internet, por la
puerta `/api/central` de cada una, con una clave que solo conocen los dos.

## Qué hay dentro

| Sección | Qué ves |
|---|---|
| **Inicio** | Todas las tiendas de un vistazo: clientes, mensajes, ventas por cerrar, problemas y gasto de hoy. También las últimas alertas. |
| **🟢 En vivo** | Los mensajes de todas las tiendas entrando solos, el más nuevo arriba: 👤 cliente, 🤖 bot, 🧑‍💼 asesor y 🧠 lo que pensó la IA. Si tocas uno, se abre la conversación. |
| **🔔 Alertas** | Lo que salió mal, en el momento: ❌ 🔴 ⚠️ 👎 🚨. Suena un pitido, sale un aviso en pantalla y, si lo activas, una notificación del navegador. |
| **⏸️ En pausa** | Las personas con el bot en pausa, de todas las tiendas. Puedes devolverle al bot una por una o todas de una vez. |
| **Métricas** | Números día por día (7, 14, 30 o 90 días), de todas las tiendas juntas y tienda por tienda. Gráficos y la tabla. |
| **Ganadores** | Los productos que más se venden (avisos de compra con ese producto delante) y los que más gente vio. |
| **Errores** | Los errores técnicos ⚙️ y las correcciones de las redes de seguridad 🛡️, de todas las tiendas. |
| **Gastos** | Lo que lleva cada tienda en OpenAI este mes, lo que saldrá el mes completo y el gasto por modelo. |
| **Estado** | Si cada tienda responde. Se comprueba solo cada 2 minutos; también hay un botón para comprobar ahora. |
| **Cómo funciona** | El diagrama de los pasos que sigue el bot con cada mensaje. |
| **Una tienda** (`/t/epicell`…) | Sus chats con lo que pensó la IA y el **recorrido** de cada respuesta. También pausar o devolver al bot, sus métricas, ganadores, errores, alertas, su `/estado` y **sus bases de datos**. |

### Los símbolos

- ❌ **Respuesta con error**: la IA no respondió (OpenAI falló o tardó) y salió la frase de emergencia.
- 🔴 **Respuesta indebida**: el revisor vio que alucinó, se contradijo o no contestó lo que le preguntaron.
- ⚠️ **Corregida**: la IA inventó algo (un precio, una marca que no hay…) y una red de seguridad lo arregló antes de enviarlo.
- 👎 **Queja**: el cliente se quejó de la respuesta anterior ("no es eso lo que te pregunté").
- ⚙️ **Error técnico**: una línea de error del registro (Meta, Slack, la base…). No siempre le llega al cliente.
- 🚨 / ✅ **La tienda dejó de responder / volvió.**

### Las bases de datos (ver y editar)

En **Bases de datos** de cada tienda ves todas sus tablas y puedes buscar, editar una fila y borrar filas. Al guardar,
solo se manda lo que cambiaste. Cada edición y cada borrado queda en el **historial** y se puede **deshacer**.

La **consola SQL** sirve para lo que no se puede hacer con el formulario:

- `SELECT`, `PRAGMA` y `WITH` solo leen.
- `UPDATE`, `DELETE`, `INSERT` y los demás cambian la base de verdad.

Un SQL queda anotado en el historial, pero **no se deshace solo**. Revisa bien antes de ejecutar.

## Ponerlo en marcha (una vez)

En Windows PowerShell es `npx.cmd`, no `npx`. **Los secretos nunca van en archivos:**
se cargan con `wrangler secret put` y se escriben cuando la consola los pide.

### 1. La base del panel

Dentro de la carpeta `panel-central`:

```
npx.cmd wrangler d1 create panel-central-db
```

Ese comando imprime un `database_id`. Pégalo en `wrangler.toml`, en lugar de `PEGA_AQUI_EL_ID`.
Las tablas se crean solas: no hay migraciones que correr.

### 2. Las claves

Necesitas **una clave larga distinta por tienda**. Una forma de inventarla en PowerShell, sin escribirla en ningún lado:

```
[guid]::NewGuid().ToString() + [guid]::NewGuid().ToString()
```

Cada vez que lo corres sale una distinta (72 letras). Úsala solo en los dos sitios que le tocan (abajo).

En la carpeta `panel-central`:

```
npx.cmd wrangler secret put PANEL_CLAVE
npx.cmd wrangler secret put CLAVE_INVICTUS
npx.cmd wrangler secret put CLAVE_EPICELL
```

- `PANEL_CLAVE` es la clave para entrar al panel: **12 letras o más**. Este panel puede editar las bases de todas las tiendas.
- `CLAVE_INVICTUS` y `CLAVE_EPICELL` son las claves largas de cada tienda.

### 3. Desplegar el panel

```
npx.cmd wrangler deploy
```

Apunta la dirección que imprime. Será algo como `https://panel-central.TU-SUBDOMINIO.workers.dev`.

### 4. Conectar cada tienda

Haz esto en la carpeta de **cada** tienda (Invictus y EPICELL):

```
npx.cmd wrangler secret put PANEL_API_CLAVE
npx.cmd wrangler secret put PANEL_CENTRAL_URL
```

- `PANEL_API_CLAVE`: **la misma** que pusiste en el panel para esa tienda (`CLAVE_INVICTUS` en Invictus, `CLAVE_EPICELL` en EPICELL).
- `PANEL_CENTRAL_URL`: la dirección del paso 3. Por ahí manda la tienda las alertas en el momento.

Después despliega la tienda con su versión nueva (Invictus **51**, EPICELL **23**).

### 5. Comprobar

1. `https://<tienda>/estado` tiene que decir la versión nueva, `PANEL_API_CLAVE` puesta y `PANEL_CENTRAL_URL` puesta.
2. `https://panel-central.../estado` dice la versión del panel. Si falta alguna clave, la nombra.
3. Entra al panel y abre **Estado** → **Comprobar ahora**. Cada tienda tiene que salir ✅ con su versión.
4. Pulsa **Activar avisos** (arriba) para que el navegador te deje mandar notificaciones.

## Añadir una tienda más

1. En `wrangler.toml`, en `TIENDAS`, añade su `id` (minúsculas, sin espacios), su `nombre` y su `url`.
2. Pon su clave en el panel: `npx.cmd wrangler secret put CLAVE_<ID>`, con el id en mayúsculas (por ejemplo `CLAVE_EMPERADOR`).
3. En la tienda, pon esa misma clave en `PANEL_API_CLAVE` y la dirección del panel en `PANEL_CENTRAL_URL`.
4. Despliega el panel y la tienda.

La tienda tiene que tener el `src/panel.js`, `src/registro.js` y `src/revisor.js` nuevos (los mismos de Invictus).

## Cómo funciona el "tiempo real"

- Con el panel abierto, cada 8 segundos pregunta si hay alertas nuevas. Si hay, suena, sale el aviso y la notificación.
- **En vivo** pregunta cada 4 segundos y una conversación abierta se pone al día cada 6. Las dos cosas solo pasan con la pestaña a la vista, porque cada pregunta lee de la base de la tienda.
- La tienda avisa al panel en el momento en que pasa algo; no espera a que preguntes.
- **Lo que no hace:** avisarte con el navegador cerrado. En la computadora basta con dejar la pestaña abierta, aunque esté detrás de otras. En el teléfono, el navegador duerme las páginas que no estás mirando: las alertas te esperan en 🔔 cuando vuelvas.

## Lo que cuesta

- **Este Worker:** va en el plan pagado de Workers (US$5 al mes, 10 millones de peticiones). Le sobra.
- **Las tiendas:** pueden seguir en el plan gratis. Las consultas usan índices (se crean solos) y leen solo lo nuevo, así que gastan muy poco de su base.
- **El revisor** (la IA que marca 🔴): unos US$0,0002 por respuesta, con gpt-4o-mini. Se apaga con `REVISOR_IA = "no"` en el `wrangler.toml` de la tienda.

## Si algo sale mal

| Lo que dice | Qué hacer |
|---|---|
| "la clave no coincide con la PANEL_API_CLAVE de la tienda" | La `CLAVE_<TIENDA>` del panel y la `PANEL_API_CLAVE` de la tienda no son iguales. Vuelve a ponerlas, las dos con la misma. |
| "la tienda no tiene puesta su PANEL_API_CLAVE" | Falta el paso 4 en esa tienda, o la clave tiene menos de 16 letras. |
| "la tienda no tiene la versión con el panel central" | La tienda no tiene los archivos nuevos. Despliégala y comprueba su `/estado`. |
| "Falta la clave CLAVE_X en el panel central" | `npx.cmd wrangler secret put CLAVE_X` en la carpeta del panel. |
| No llegan alertas en el momento | Falta `PANEL_CENTRAL_URL` en la tienda, o no empieza por `https://`. |
| "Demasiadas claves equivocadas" | Tras 8 intentos fallidos hay que esperar 15 minutos. |

Para ver lo que pasa por dentro: `npx.cmd wrangler tail` en la carpeta del panel.

## Pruebas (no se despliegan)

```
node pruebas/central.mjs
```

Se corre desde `panel-central/`, con Node 22 o más nuevo, y con la carpeta `invictus-bot/` al lado.
Levanta dos Invictus de verdad (cada uno con su base SQLite), más una tienda caída, y prueba todo de punta a punta:

- la entrada;
- las alertas;
- en vivo;
- despausar;
- las métricas;
- editar las bases;
- el chequeo de cada 2 minutos.
