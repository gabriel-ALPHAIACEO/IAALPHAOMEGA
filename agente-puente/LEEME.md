# AGENTE PUENTE v2.2: el inventario de CUALQUIER sistema, a CUALQUIER tienda

**Funciona solo, aparte de todo.** No se despliega en Cloudflare y no necesita ningún archivo de los bots: esta carpeta se copia a la PC o al servidor donde está el sistema de inventario y, con **Node.js 18 o más**, corre.

**Está abierto a cualquier tienda.** Lee el stock de cualquier sistema instalado en una computadora (aunque no tenga API) y lo entrega a:
- **una tienda con ALPHA IA** (el bot y su panel), con todo: latido, «Sincronizar ahora» desde el panel, ventas de vuelta y avisos;
- **cualquier otra tienda o plataforma** que tenga una dirección para recibir datos: su API, WooCommerce o una página propia con un PHP chico, Zapier, Make, n8n… Recibe un JSON (o un CSV) limpio, con su clave y una firma para comprobar que viene del agente. Todo está en **`PROTOCOLO.md`**, con ejemplos que funcionan en PHP y en Node;
- **una carpeta**: un `stock.csv` o `stock.json` limpio, siempre con el mismo formato, para un programa que importa desde ahí o para una carpeta de Google Drive, OneDrive o Dropbox que otra plataforma lee;
- **varios a la vez** (por ejemplo, la tienda ALPHA IA y un respaldo en una carpeta): si uno falla, los demás reciben igual.

```
                                   ┌──► tienda con ALPHA IA  (/api/sync, latido, panel, ventas de vuelta)
 Sistema de inventario ──► AGENTE ─┼──► cualquier otra plataforma  (webhook JSON/CSV, con clave y firma)
 (archivo, Excel, carpeta,  PUENTE └──► una carpeta  (stock.csv / stock.json)
  o su base de datos)        │
                             └──► si falla: aviso a Slack, Teams, Google Chat o Discord
```

## Qué hay en esta carpeta

| Archivo | Para qué |
|---|---|
| `agente-puente.mjs` | **El programa**: junta las piezas de `lib/` y es lo que se corre. |
| `lib/fuentes.mjs` | De dónde lee: un archivo, el más nuevo de una carpeta o un comando. |
| `lib/tabla.mjs` · `lib/excel.mjs` | Leer CSV (con `;` `,` tab o `|`, comillas, UTF-8 o latin1) y Excel `.xlsx` sin instalar nada. |
| `lib/columnas.mjs` | Qué es cada columna (solas o dichas en `"columnas"`). |
| `lib/destinos.mjs` | A dónde manda: tienda ALPHA IA, webhook o carpeta. |
| `lib/avisos.mjs` | Los avisos propios (Slack, Teams, Google Chat, Discord). |
| `lib/fotos.mjs` | Las fotos del sistema: dónde están, cuáles cambiaron, mandarlas. |
| `lib/secretos.mjs` · `lib/registro.mjs` · `lib/instalar.mjs` | Tapar secretos, el registro y la tarea programada. |
| `PROTOCOLO.md` | **Para quien programa la tienda que recibe**: qué llega, qué contestar, cómo comprobar la firma. |
| `instalar.bat` · `probar.bat` · `sincronizar-ya.bat` · `estado.bat` · `desinstalar.bat` | Doble clic (Windows). |
| `ejemplos/sacar-stock-*.bat` | Consultas de ejemplo para SQL Server, MySQL, PostgreSQL, SQLite y ODBC. |
| `ejemplos/configuraciones/` | Cuatro `config.json` de ejemplo: tienda ALPHA IA, otra plataforma, carpeta de Drive y varios a la vez. |
| `ejemplos/recibir-webhook.php` · `.mjs` | Cómo recibir el stock en otra tienda (con la clave y la firma comprobadas). |
| `pruebas/` | `node pruebas/correr.mjs`: las pruebas del agente (corren solas, sin ningún bot). |

**Sistemas ya preparados:** `sistemas/solventas/` (Solventas / Sotecsis, SQL Server): diagnóstico, reparación de la base y la consulta de stock lista. Ver su `LEEME.md`.

Lo que el agente escribe al correr (no se copia de una PC a otra): `config.json` (con las claves: **no se comparte**), `estado-puente.json`, `fotos-enviadas.json`, `puente.log` (al pasar de 1 MB el viejo queda como `puente.log.1`) y `puente.lock`.

## Instalar en la PC del cliente (Windows), en 5 minutos

1. Instala **Node.js** (la versión LTS) desde https://nodejs.org si no lo tiene.
2. Copia esta carpeta a `C:\agente-puente` (una ruta corta y sin espacios).
3. **Doble clic en `instalar.bat`** y acepta el permiso de administrador. Te pregunta:
   1. **a dónde va el stock**: una tienda con ALPHA IA (su dirección y su clave), **otra plataforma** (la dirección que recibe los datos, su clave y, si quieres, una clave para firmar) o **una carpeta**,
   2. el nombre del sistema y de esa PC,
   3. **de dónde sale el stock**: un archivo (CSV, TXT, Excel o JSON; de un Excel, qué hoja), la carpeta donde el sistema deja uno nuevo cada vez, o un comando que consulta su base (ver `ejemplos/`),
   4. **lee el stock una vez y te enseña cómo entendió cada columna** («cantidad ← Existencia, código ← Ref…»); si alguna está mal, la corriges ahí mismo,
   5. cada cuántos minutos se manda (15),
   6. con ALPHA IA: si quieres las ventas de la tienda en una carpeta; con otra plataforma: a qué Slack, Teams o Discord avisar si falla.
4. Después corre solo el **doctor**, que revisa una por una: Node, la configuración, que la tienda conteste y la clave sea la buena, que el stock se pueda leer (y las columnas y las tildes), y **una prueba completa sin guardar nada**. Si algo sale con ❌, dice qué arreglar y no instala.
5. Si todo sale bien, crea la tarea **«Agente puente»** en el Programador de tareas: **cada minuto, como SYSTEM** (corre aunque nadie inicie sesión y vuelve sola tras reiniciar), sin pararse con la batería, una sola a la vez y cortada si se cuelga más de 30 minutos.
6. Con una tienda ALPHA IA: en su panel, **Inventario › Importar**, en menos de un minuto sale el agente como **Activo**. Con otra plataforma: `estado.bat` dice cómo le fue.

**¿Cada minuto? ¿No es mucho?** Cada minuto solo **avisa** (un mensaje chiquito). El stock se manda cada `cadaMinutos` (15) o cuando lo pides desde el panel. Y como cada vuelta es un programa que arranca y termina, si algo se traba la siguiente vuelta empieza limpia.

**Unidades de red:** como SYSTEM, la tarea **no ve las letras** (`Z:\…`). Usa la ruta `\\servidor\carpeta\stock.csv`, o instala con una cuenta: `node agente-puente.mjs --instalar --usuario OFICINA\ana` (te pide su contraseña de Windows). Lo mismo si la base usa la seguridad de Windows (`sqlcmd -E`).

**Linux o Mac:** `node agente-puente.mjs --configurar`, `--doctor` y `--instalar` (queda en `cron`, cada minuto).

## Todo lo que sabe hacer

| Comando | Qué hace |
|---|---|
| `node agente-puente.mjs --configurar` | Las preguntas; escribe `config.json` (Enter deja lo que ya estaba). |
| `node agente-puente.mjs --doctor` | Revisa todo y dice qué falla y cómo arreglarlo (sale con 1 si hay alguna ❌). |
| `node agente-puente.mjs --probar` | Dice qué mandaría a cada destino (y enseña el primer producto), **sin mandar ni guardar nada**. A una tienda ALPHA IA le pregunta con `?probar=1`. |
| `node agente-puente.mjs --instalar [--usuario X]` | Lo deja corriendo solo (Programador de tareas / cron). |
| `node agente-puente.mjs --desinstalar` | Lo quita. |
| `node agente-puente.mjs --una-vez` | Sincroniza **ya** y sale (con 1 si falló). |
| `node agente-puente.mjs --vuelta` | Una vuelta normal: lo que corre la tarea cada minuto. |
| `node agente-puente.mjs --estado` | El último conteo bueno, el último error, el próximo conteo y las últimas líneas del registro. |
| `node agente-puente.mjs` | Corre para siempre en esta ventana (Ctrl+C para parar). |
| `--config otra.json` | Con otra configuración (dos sistemas en la misma PC: dos carpetas es más simple). |

## A dónde manda (destinos)

Con una sola tienda ALPHA IA basta con `"url"` y `"clave"` arriba del todo, como siempre. Para cualquier otra cosa, `"destinos"`, una lista:

```json
"destinos": [
  { "tipo": "alpha" },
  { "tipo": "webhook", "url": "https://mi-tienda.com/api/stock", "formato": "json",
    "cabeceras": { "X-Api-Key": "${ENV:CLAVE_DE_MI_TIENDA}" }, "secretoFirma": "${ENV:FIRMA}", "lote": 1000 },
  { "tipo": "carpeta", "carpeta": "G:\\Mi unidad\\stock", "formato": "csv" }
]
```

| Destino | Opciones |
|---|---|
| `alpha` | `url`, `clave` (si no, las de arriba), `sede`, `precios: false` (no tocar los precios), `ventas` |
| `webhook` | `url` (https), `formato` (`json` o `csv`), `metodo` (`POST`), `cabeceras` (la clave de esa plataforma), `secretoFirma`, `lote` (productos por envío), `incluirCosto` (por defecto el costo **no** sale de la PC), `timeoutSegundos` |
| `carpeta` | `carpeta`, `formato` (`csv` o `json`), `archivo` (`stock.csv`), `separador` (`;`), `incluirCosto` |

Ejemplos completos en `ejemplos/configuraciones/`.

## De dónde lee (fuente)

| Fuente | Cuándo | Ejemplo |
|---|---|---|
| `archivo` | El sistema exporta un archivo, a mano o programado | `{ "tipo": "archivo", "ruta": "C:\\exportes\\stock.xlsx", "hoja": "Stock", "maximoMinutos": 180 }` |
| `carpeta` | Deja uno **nuevo** cada vez (con la fecha en el nombre) | `{ "tipo": "carpeta", "carpeta": "C:\\exportes", "patron": "stock_*.csv" }`: toma el **más nuevo** |
| `comando` | Se puede consultar su base de datos | `{ "tipo": "comando", "comando": "C:\\agente-puente\\ejemplos\\sacar-stock-sqlserver.bat" }` |

- **Formatos**: CSV y TXT (separados por `;` `,` tab o `|`, el agente lo adivina), **Excel `.xlsx`** (sin instalar nada; `"hoja"` para elegir una, si no la primera) y **JSON** (una lista de productos, o `{ "productos": [...] }`). Los `.xls` viejos (de antes de 2007) no: en el sistema se guardan como `.xlsx` o `.csv`.
- **`codificacion`**: `auto` (por defecto: UTF-8 si lo es, si no el latin1 de Windows), `utf8`, `latin1` o `utf16le`. Si ves letras raras (`Ã³`, `�`), fíjala.
- **`maximoMinutos`**: si el archivo es más viejo que eso, **no se manda** (un sistema que dejó de exportar no hace creer que el stock sigue igual).
- Si el sistema está escribiendo el archivo justo cuando el agente lo lee, el agente espera y lo vuelve a leer: nunca manda uno a medias.

### Fuente «comando»: consultar la base del sistema

```json
"fuente": { "tipo": "comando", "comando": "…lo que escribe el stock por pantalla…", "timeoutSegundos": 120 }
```
El agente quita solo las rayas de `sqlcmd` y el «(123 filas afectadas)». **Los nombres de tablas y columnas de abajo son de ejemplo: cada sistema tiene los suyos** (pídeselos al proveedor, o míralos con el explorador de la base). Siempre con un usuario de **solo lectura**.

**SQL Server** (sistemas como Profit, Saint y similares suelen usarlo; confírmalo con el proveedor):
```
sqlcmd -S SERVIDOR\INSTANCIA -d NombreDeLaBase -U usuario_lectura -P "clave" -W -s";" -Q "SET NOCOUNT ON; SELECT a.co_art AS codigo, a.art_des AS producto, a.stock_act AS cantidad, a.prec_vta1 AS precio FROM art a WHERE a.stock_act IS NOT NULL"
```
(Con seguridad integrada de Windows: `-E` en lugar de `-U … -P …`.)

**MySQL / MariaDB** (sale separado por tabulaciones: también se entiende):
```
mysql -h servidor -u usuario_lectura -pCLAVE --batch -e "SELECT codigo, nombre AS producto, existencia AS cantidad, precio FROM productos" nombre_base
```

**PostgreSQL:**
```
psql -h servidor -U usuario_lectura -d nombre_base -A -F ";" -P footer=off -c "SELECT codigo, nombre AS producto, existencia AS cantidad, precio FROM productos"
```

**SQLite:**
```
sqlite3 -header -csv C:\datos\sistema.db "SELECT codigo, nombre AS producto, existencia AS cantidad, precio FROM productos"
```

**Access, DBF, Firebird, etc. (por ODBC) con PowerShell:**
```
powershell -NoProfile -Command "$c = New-Object System.Data.Odbc.OdbcConnection('DSN=MiSistema'); $c.Open(); $cmd = $c.CreateCommand(); $cmd.CommandText = 'SELECT codigo, nombre AS producto, existencia AS cantidad, precio FROM productos'; $t = New-Object System.Data.DataTable; $t.Load($cmd.ExecuteReader()); $c.Close(); $t | ConvertTo-Csv -NoTypeInformation"
```
(En JSON, las comillas dobles y las barras del comando se escriben con `\"` y `\\`. Por eso es mejor copiar uno de los `.bat` de `ejemplos/`, cambiarle la consulta y poner su ruta: `"comando": "C:\\agente-puente\\ejemplos\\sacar-stock-sqlserver.bat"`.)

> La clave de la base va dentro del comando, así que **la PC donde corre el agente debe ser de confianza** y el usuario de la base, de solo lectura.

## Qué es cada columna

Se reconocen **solas**, en español o en inglés, con o sin tildes y mayúsculas:

| Campo | Nombres que entiende solo |
|---|---|
| `codigo` | código, cod, sku, barras, ean, upc, referencia, ref, code, barcode, id |
| `producto` | producto, modelo, título, nombre, descripción, artículo, item, name, title, description |
| `talla` | talla, opción, capacidad, tamaño, medida, size, variante |
| `color` | color, colour |
| **`cantidad`** (obligatoria) | cantidad, stock, existencia(s), unidades, inventario, cant, qty, quantity, disponible, saldo |
| `precio` | precio, pvp, precio de venta, valor, price |
| `costo` | costo, precio de costo, precio de compra, cost (va antes que el precio: «Precio de compra» es costo) |
| `marca` | marca, fabricante, brand |
| `sede` | sede, local, tienda, almacén, sucursal, depósito, bodega, warehouse |
| `categoria` | categoría, departamento, línea, grupo, familia, rubro, category |
| `foto` | foto, imagen, image, photo |

Hace falta **la cantidad** y **el código o el nombre**. Si el sistema usa nombres raros (Profit, por ejemplo, `CO_ART`, `ART_DES`, `STOCK_ACT`), se dicen en `config.json`:

```json
"columnas": { "codigo": "CO_ART", "producto": "ART_DES", "cantidad": "STOCK_ACT", "precio": "PREC_VTA1" }
```
`"precio": ""` = no usar esa columna aunque se reconozca sola. El `--doctor` y el `--configurar` dicen cómo entendieron cada una («cantidad ← «Existencia»…»).

**Los números** se entienden en cualquier formato: `1.234,50`, `1,234.50`, `$ 45`, `Bs. 1.000.000`. Un solo punto con tres cifras detrás es de miles (`12.500` = 12500).

## Las fotos

**Si el sistema tiene fotos, el agente las manda.** Sirven dos maneras, y se activan solas:

1. **Una columna con la foto** de cada producto (se reconoce sola: foto, imagen, image, photo…). Puede tener:
   - una dirección: `https://…`, o una de la red de la oficina (`http://192.168.1.10/img/A1.jpg`), que el agente baja desde esa PC;
   - la ruta de un archivo: `C:\Sistema\Fotos\A1.jpg`, o solo `A1.jpg` (se busca en `"fotos.carpeta"`);
   - varias fotos en la misma celda, separadas por `|`. La primera es la principal.
2. **Una carpeta con las fotos nombradas por el código** del producto: `A1.jpg` (la principal), `A1-2.jpg`, `A1_3.png`, `A1 (4).jpg`… Sin importar mayúsculas.

```json
"fotos": { "carpeta": "C:\\Sistema\\Fotos", "por": "codigo", "maximoPorVuelta": 30 }
```
- `por`: `codigo` (lo normal) o `producto` (si las fotos se llaman como el nombre del producto).
- `maximoPorVuelta`: cuántas fotos se mandan como mucho en cada vuelta (30). La primera vez, un catálogo de miles se completa en varias vueltas sin trabar el stock.
- `"fotos": { "activar": false }` las apaga.

**Solo se manda lo nuevo o lo cambiado.** El agente recuerda en `fotos-enviadas.json` la huella de cada foto mandada a cada destino. Un archivo se vuelve a leer solo si cambió su fecha o su tamaño, y una dirección se revisa una vez al día.

**Las fotos van después del stock** y solo a los destinos que lo recibieron bien. Una foto que no se puede mandar (no está, no es JPG, PNG o WEBP, o pesa más de 1,5 MB) se salta y se cuenta, con su motivo («2 fotos con problemas (B7.jpg: pesa 3.2 MB…)»), pero **no hace malo el conteo**. En Windows, una foto más grande o en BMP, GIF o TIFF se achica sola a un JPG de 1600 px con el propio Windows (PowerShell).

**En una tienda ALPHA IA, las fotos del panel mandan:**
- Si el producto ya tiene fotos puestas por una persona, el sistema no le añade ni le cambia ninguna.
- Si el sistema cambia una foto, se cambia en el mismo lugar y la vieja se borra.
- Si alguien quita en el panel una foto que vino del sistema, esa misma no vuelve a entrar.
- Un producto que todavía no llegó en el stock recibe su foto más tarde.
- Lo que el sistema no tiene se sube en el panel: en **Inventario** está el atajo **«Sin foto (N)»**, y la tarjeta del agente puente dice cuántas fotos llegaron del sistema y cuántos productos siguen sin foto.

**A otra plataforma** le llega cada foto en un envío aparte, un JSON con la foto en base64, firmado igual que el stock (ver `PROTOCOLO.md`). Va a `"urlFotos"` del destino o, si no hay, a su misma `"url"`. **A una carpeta** se copian en `fotos/<código>-<n>.jpg`.

## Los avisos propios (cuando el stock va a otra plataforma)

Una tienda ALPHA IA avisa sola (ver más abajo). Si el stock va a otra plataforma, el agente puede avisar **él mismo**:

```json
"avisos": { "webhook": "${ENV:SLACK_WEBHOOK}", "formato": "slack" }
```
`formato`: `slack` (también Google Chat y Mattermost), `teams`, `discord` o `json`. Igual que en la tienda: un error se avisa **una vez** (el mismo, a las 6 horas; uno distinto, enseguida) y cuando vuelve a funcionar, también. Un agente **apagado** no puede avisar de sí mismo: el «no da señal» solo lo ve una tienda con ALPHA IA, porque nota que no le llega el latido.

## Si el stock va a una tienda con ALPHA IA: encender la puerta (una vez por tienda)

La puerta está **cerrada** hasta que exista la clave. La clave es un secreto: nunca va en GitHub ni en el chat.

1. Inventa una clave larga. En PowerShell:
   ```powershell
   [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
   ```
2. Cárgala en la tienda, **desde la carpeta de esa tienda** (te la pide al escribirla):
   ```powershell
   npx.cmd wrangler secret put SYNC_CLAVE
   ```
3. Despliega: `npx.cmd wrangler deploy`.
4. En el panel: **Inventario › Importar** dice «Conectar con tu sistema de inventario · encendida» y, debajo, «Agente puente: ningún agente se ha conectado todavía».

Cada tienda tiene **su propia clave** (nunca la misma en dos).

## Con una tienda ALPHA IA: lo que ve el dueño en su panel (Inventario › Importar › Agente puente)

- Cada agente con su sistema y su PC, y un chip: **Activo** (verde), **Sincronizando**, **Con error** (rojo, con el motivo) o **Sin señal** (amarillo, con qué revisar).
- Cuándo avisó por última vez, su **último conteo bueno** (filas y cuántas sin cambios), cada cuánto corre y su versión.
- Sus últimos 5 hechos (se encendió, conteo correcto, error, dejó de dar señal, volvió, sincronizó por orden del panel).
- El botón **«Sincronizar ahora»**: la tienda no puede entrar a la PC del cliente, así que deja la orden y el agente la recoge en su próximo latido (en menos de un minuto). Es la **única** orden que existe: el agente no acepta comandos de afuera.

## Con una tienda ALPHA IA: los avisos de la tienda

Por **Slack** (el `SLACK_WEBHOOK` de la tienda) y al **panel central** (alerta 🔌 «Agente puente con problemas» / ✅ «El agente puente volvió»):

| Cuándo | Aviso |
|---|---|
| Un conteo falla | «🔌 El puente de inventario de Profit (PC Caja) tiene un error: <motivo>». El **mismo** error se recuerda a las 6 horas, no cada minuto; uno **distinto** se avisa enseguida. |
| No da señal | Si corre cada minuto: a los **10 min**. Si corre por su cuenta cada N min (`--una-vez` programado): a las 3 vueltas, y nunca antes de 45 min. Se cambia con `AGENTE_SILENCIO_MIN` en el `wrangler.toml` de la tienda. Un solo aviso hasta que vuelva. |
| Vuelve | «✅ … volvió a funcionar» (tras un error) o «… volvió a dar señal» (tras el silencio). |

El aviso de silencio lo da el **cron** de la tienda (cada 15 min): **Invictus, El Emperador y Rodrigo**. **EPICCELL no tiene cron**: allá el panel igual lo enseña «Sin señal», pero no llega el aviso.

Mientras el agente falle o esté callado, **el bot sigue con el último stock que recibió** (no se borra nada).

### Las ventas de vuelta (solo con una tienda ALPHA IA, opcional)
```json
"ventas": { "activar": true, "carpeta": "C:\\ventas-de-la-tienda" }
```
En cada vuelta el agente deja en esa carpeta:
- `ventas-nuevas-<n>.csv`: solo lo vendido desde la última vez que bajó (para cargarlo una vez).
- `ventas-ultimos-3-dias.csv`: los últimos 3 días completos; ahí se ven también las **anuladas** (columna `anulada = si`).

Cada fila es un producto vendido: `venta, id, fecha, sede, codigo, codigo_modelo, producto, marca, talla, color, cantidad, precio_unitario, total_linea, metodo_pago, cliente, telefono, fiado, anulada, nota`. **El costo nunca sale.** `codigo_modelo` es el código que el sistema de afuera mandó en su conteo; `codigo` es el de barras/fábrica de esa talla. Se cargan en el sistema con **su propio importador de Excel**, o a mano si son pocas.

## Sin instalar nada: la tienda ALPHA IA lee una dirección sola

Si el sistema (o alguien) deja el CSV en una dirección que se pueda descargar directo, se lo pones al bot en `wrangler.toml` (en `[vars]`) y el cron (cada 15 minutos) lo lee:

```toml
CONECTOR_URL    = "https://…/stock.csv"     # descarga directa (CSV o JSON)
CONECTOR_ORIGEN = "Profit"                  # cómo se llama el sistema
# CONECTOR_SEDE = "Principal"               # opcional
# CONECTOR_CABECERA = "Authorization"       # opcional: otra cabecera para la clave
```
y, si la dirección pide clave: `npx.cmd wrangler secret put CONECTOR_CLAVE` (se manda como `Bearer <clave>`).

Funciona en **Invictus, El Emperador y Rodrigo** (tienen cron). **EPICCELL no tiene cron**: allá usa el agente puente.

## Mandarle a una tienda ALPHA IA sin el agente (un script, Zapier, Make…)

```
POST https://tu-worker.workers.dev/api/sync/inventario?origen=Profit&generado=2026-10-15T10:30:00Z
Authorization: Bearer <SYNC_CLAVE>
Content-Type: text/csv            (o application/json)
```
**CSV:** la primera fila son los encabezados (tabla de arriba), separado por `,` o `;` o tabulación.
**JSON:** cualquiera de estas formas:
```json
[ { "codigo": "A100", "producto": "Zapato Casual", "talla": "40", "cantidad": 5, "precio": 45 } ]
```
```json
{ "origen": "Profit", "generado": "2026-10-15T10:30:00Z",
  "productos": [ { "sku": "C300", "nombre": "Sandalia", "precio": 30,
                   "variantes": [ { "talla": "36", "stock": 2 }, { "talla": "37", "stock": 4 } ] } ] }
```
Parámetros: `origen` (nombre del sistema), `sede`, `generado` (cuándo leíste el stock; ver abajo), `probar=1` (no guarda nada), `precios=no` (no tocar los precios).

Respuestas: `200` terminó · `202` está en marcha (pide `POST /api/sync/avanzar?trabajo=<id>` hasta que diga `listo`) · `409` hay otro conteo a medias (espera 60 s y reintenta) · `400` algo del archivo (el mensaje dice qué) · `401` clave mala · `413` pasa de 2 MB o 20 000 filas (mándalo en partes) · `503` falta cargar `SYNC_CLAVE`.

Otras rutas (todas con la clave): `GET /api/sync/estado` (productos y últimos conteos) y `GET /api/sync/ventas?desde=AAAA-MM-DD | desde_id=N | formato=json`.

## Cómo se comporta una tienda ALPHA IA con lo que recibe (las reglas)

1. **La cantidad de cada fila es la que contó el sistema.** Queda tal cual, con su movimiento («Carga inicial» la primera vez, «Ajuste» si cambia), a nombre de «Sistema: <origen>». Repetir el mismo archivo no duplica nada.
2. **Lo vendido en la caja después de que el sistema leyó su stock se tiene en cuenta.** Por eso importa `generado`: el agente manda la hora en que leyó la base (o la fecha del archivo). Si el sistema leyó 7 unidades y después la caja vendió 2, queda 5, no 7. Cuando el sistema recibe esas ventas (se cargan allá) y reporta 5, sigue 5.
3. **Solo se pasa lo que cambió.** En archivos de 60 filas o más, se compara cada fila con el último conteo terminado y solo se procesan las nuevas o distintas. Así un catálogo de miles de productos se mantiene al día cada 15 minutos. Cada 30 días se vuelve a pasar todo (reconciliación).
4. **Dos conteos no se mezclan:** mientras uno va a medias, el siguiente espera (`409`).
5. **El precio del sistema manda** (por defecto): si cambia allá, cambia aquí. Se apaga con `precios=no`. El precio de Cashea no se toca: sigue siendo del panel.
6. **Esto nunca crea una venta ni descuenta por su cuenta.** Solo pone el conteo del sistema. Las ventas las sigue confirmando una persona (caja, «Vendí», pedidos web).
7. **No borra ni desactiva** lo que deja de aparecer en el archivo. Si un producto se acaba, el sistema debe mandarlo con cantidad 0.
8. **Si el sistema se cae**, el bot sigue con lo último que tiene. Un archivo viejo (`maximoMinutos`) no se manda.

## Seguridad

- **Las claves, mejor en variables de entorno de la PC**: en `config.json` cualquier valor puede ser `"${ENV:NOMBRE}"` (la clave de la tienda, la de otra plataforma, la firma, la dirección de Slack), y así no quedan escritas en el archivo. Si quedan en `config.json`, ese archivo **no se comparte**. **Nunca en GitHub ni en el chat.**
- **Nada de lo que escribe el agente lleva secretos**: ni la pantalla, ni `puente.log`, ni el latido, ni los avisos. Tapa las claves, la dirección de Slack/Teams y las contraseñas del comando (`-P`, `-p…`, `password=`, `pwd=`), y un error nunca repite el comando entero.
- Todo viaja por `https://` (el agente no acepta otra cosa, salvo pruebas en la propia PC). A otra plataforma, con la **firma** HMAC-SHA256 (ver `PROTOCOLO.md`) puede comprobar que viene del agente y que nadie lo cambió.
- El **costo** no sale de la PC hacia otras plataformas salvo que se pida (`incluirCosto`).
- Usuario de **solo lectura** en la base del cliente. El agente solo lee: no escribe ni borra nada en su sistema.
- La única orden que acepta de afuera es «sincronizar» (de una tienda ALPHA IA). No corre nada que venga de afuera.

## Lo que no hace (todavía)

- No escribe en el sistema cerrado: las ventas de una tienda ALPHA IA se entregan en archivo.
- No lee los `.xls` viejos (binarios), ni fechas de Excel como fechas.
- No baja ventas de otras plataformas (solo de las tiendas ALPHA IA).
- No borra en el destino los productos que desaparecen del sistema: si se acaba, el sistema tiene que mandarlo con cantidad 0.
- No borra en la tienda las fotos que el sistema deja de tener (si se quita una del sistema, sigue en la tienda hasta que alguien la quite en el panel).
- No se actualiza solo: una versión nueva se copia encima (la carpeta entera menos `config.json`). El panel de una tienda ALPHA IA enseña qué versión tiene cada PC.
