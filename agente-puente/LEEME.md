# AGENTE PUENTE v2 — conectar el bot con un sistema de inventario CERRADO (sin API)

**Esta carpeta funciona sola, aparte de todo.** No se despliega en Cloudflare y no necesita ningún archivo de los bots: se copia tal cual a la PC o al servidor del cliente, junto a su sistema, y con **Node.js 18 o más** ya corre.

## En una frase

El sistema cerrado no tiene API, pero casi todos pueden **sacar un Excel/CSV** y casi todos viven sobre **una base de datos** que se puede consultar. El agente lee esos datos y le manda el stock al bot; de vuelta, le deja las ventas en un archivo. **Y desde la v2 está conectado al panel**: cada minuto le avisa a la tienda que está vivo, el dueño ve en el panel si funciona, puede pedirle «Sincronizar ahora», y si algo falla le llega un aviso.

```
 Sistema cerrado ──(base de datos o CSV)──► AGENTE PUENTE ──► /api/sync/inventario ──► el bot y su panel
                                               │  ▲
                                   latido c/min │  │ «Sincronizar ahora» (del panel)
                                               ▼  │
                                         /api/sync/latido ──► Slack + panel central si falla
 Sistema cerrado ◄──(CSV de ventas)───────── AGENTE PUENTE ◄── /api/sync/ventas ◄──── (caja, tienda web)
```

## Qué hay en esta carpeta

| Archivo | Para qué |
|---|---|
| `agente-puente.mjs` | **El programa.** Todo está aquí (un solo archivo, sin dependencias). |
| `instalar.bat` | **Doble clic y listo** (Windows): pide permiso de administrador, hace las preguntas, revisa todo y lo deja corriendo solo. |
| `probar.bat` | Revisa todo (el «doctor») sin guardar nada. |
| `sincronizar-ya.bat` | Manda el stock ahora mismo. |
| `estado.bat` | Cómo le fue la última vez y las últimas líneas del registro. |
| `desinstalar.bat` | Quita la tarea programada. |
| `config.ejemplo.json` | Un ejemplo de configuración (el `--configurar` escribe la de verdad: `config.json`). |
| `ejemplos/` | Comandos de ejemplo para SQL Server, MySQL, PostgreSQL, SQLite y ODBC (Access, DBF, Firebird…). |
| `pruebas/agente.mjs` | Las pruebas del agente (corren solas: `node pruebas/agente.mjs`). |

Lo que el agente escribe al correr (no se copia de una PC a otra): `config.json` (con la clave: **no se comparte**), `estado-puente.json` (cuándo fue el último conteo), `puente.log` (el registro; al pasar de 1 MB el viejo queda como `puente.log.1`) y `puente.lock` (mientras corre una vuelta).

## Paso 0 (una sola vez, en cada tienda): encender la puerta

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

## Instalar en la PC del cliente (Windows), en 5 minutos

1. Instala **Node.js** (la versión LTS) desde https://nodejs.org si no lo tiene.
2. Copia esta carpeta a `C:\agente-puente` (una ruta corta y sin espacios).
3. **Doble clic en `instalar.bat`** y acepta el permiso de administrador. Te pregunta:
   1. la dirección del bot (`https://<tienda>.<tu-cuenta>.workers.dev`),
   2. la clave del paso 0,
   3. el nombre del sistema (sale en los movimientos: «Sistema: Profit»),
   4. el nombre de esa PC (para reconocerla en el panel),
   5. la sede (vacío = la principal),
   6. de dónde sale el stock: **1** un archivo que exporta el sistema, **2** un comando o consulta (ver `ejemplos/`),
   7. cada cuántos minutos se manda (15),
   8. si quieres las ventas de la tienda en una carpeta.
4. Después corre solo el **doctor**, que revisa una por una: Node, la configuración, que la tienda conteste y la clave sea la buena, que el stock se pueda leer (y las columnas y las tildes), y **una prueba completa sin guardar nada**. Si algo sale con ❌, dice qué arreglar y no instala.
5. Si todo sale bien, crea la tarea **«Agente puente»** en el Programador de tareas: **cada minuto, como SYSTEM** (corre aunque nadie inicie sesión y vuelve sola tras reiniciar), sin pararse con la batería, una sola a la vez y cortada si se cuelga más de 30 minutos.
6. En el panel de la tienda, **Inventario › Importar**, en menos de un minuto sale el agente como **Activo**.

**¿Cada minuto? ¿No es mucho?** Cada minuto solo **avisa** (un mensaje chiquito). El stock se manda cada `cadaMinutos` (15) o cuando lo pides desde el panel. Y como cada vuelta es un programa que arranca y termina, si algo se traba la siguiente vuelta empieza limpia.

**Unidades de red:** como SYSTEM, la tarea **no ve las letras** (`Z:\…`). Usa la ruta `\\servidor\carpeta\stock.csv`, o instala con una cuenta: `node agente-puente.mjs --instalar --usuario OFICINA\ana` (te pide su contraseña de Windows). Lo mismo si la base usa la seguridad de Windows (`sqlcmd -E`).

**Linux o Mac:** `node agente-puente.mjs --configurar`, `--doctor` y `--instalar` (queda en `cron`, cada minuto).

## Todo lo que sabe hacer

| Comando | Qué hace |
|---|---|
| `node agente-puente.mjs --configurar` | Las preguntas; escribe `config.json` (Enter deja lo que ya estaba). |
| `node agente-puente.mjs --doctor` | Revisa todo y dice qué falla y cómo arreglarlo (sale con 1 si hay alguna ❌). |
| `node agente-puente.mjs --probar` | Manda con `?probar=1`: la tienda dice qué haría, **sin guardar nada**. |
| `node agente-puente.mjs --instalar [--usuario X]` | Lo deja corriendo solo (Programador de tareas / cron). |
| `node agente-puente.mjs --desinstalar` | Lo quita. |
| `node agente-puente.mjs --una-vez` | Sincroniza **ya** y sale (con 1 si falló). |
| `node agente-puente.mjs --vuelta` | Una vuelta normal: lo que corre la tarea cada minuto. |
| `node agente-puente.mjs --estado` | El último conteo bueno, el último error, el próximo conteo y las últimas líneas del registro. |
| `node agente-puente.mjs` | Corre para siempre en esta ventana (Ctrl+C para parar). |
| `--config otra.json` | Con otra configuración (dos sistemas en la misma PC: dos carpetas es más simple). |

## Qué pasa en cada vuelta

1. **Latido**: le dice a la tienda «estoy vivo» (nombre, PC, versión) y pregunta si desde el panel pidieron «Sincronizar ahora».
2. **¿Toca?** Si pasaron `cadaMinutos` desde el último conteo, o se lo pidieron, saca el stock; si no, termina ahí.
3. **El stock**: lee el archivo o corre el comando, y lo manda. Si es grande, pide las tandas hasta que termine. Si hay otro conteo a medias en la tienda, espera.
4. **Las ventas** (si las activaste): las deja en la carpeta.
5. **El resultado**: otro latido, «ok» (cuántas filas, cuántas sin cambios) o «error» con el motivo. Tras un error vuelve a intentar a los **5 minutos** (no cada minuto).

## Lo que ve el dueño en el panel (Inventario › Importar › Agente puente)

- Cada agente con su sistema y su PC, y un chip: **Activo** (verde), **Sincronizando**, **Con error** (rojo, con el motivo) o **Sin señal** (amarillo, con qué revisar).
- Cuándo avisó por última vez, su **último conteo bueno** (filas y cuántas sin cambios), cada cuánto corre y su versión.
- Sus últimos 5 hechos (se encendió, conteo correcto, error, dejó de dar señal, volvió, sincronizó por orden del panel).
- El botón **«Sincronizar ahora»**: la tienda no puede entrar a la PC del cliente, así que deja la orden y el agente la recoge en su próximo latido (en menos de un minuto). Es la **única** orden que existe: el agente no acepta comandos de afuera.

## Los avisos

Por **Slack** (el `SLACK_WEBHOOK` de la tienda) y al **panel central** (alerta 🔌 «Agente puente con problemas» / ✅ «El agente puente volvió»):

| Cuándo | Aviso |
|---|---|
| Un conteo falla | «🔌 El puente de inventario de Profit (PC Caja) tiene un error: <motivo>». El **mismo** error se recuerda a las 6 horas, no cada minuto; uno **distinto** se avisa enseguida. |
| No da señal | Si corre cada minuto: a los **10 min**. Si corre por su cuenta cada N min (`--una-vez` programado): a las 3 vueltas, y nunca antes de 45 min. Se cambia con `AGENTE_SILENCIO_MIN` en el `wrangler.toml` de la tienda. Un solo aviso hasta que vuelva. |
| Vuelve | «✅ … volvió a funcionar» (tras un error) o «… volvió a dar señal» (tras el silencio). |

El aviso de silencio lo da el **cron** de la tienda (cada 15 min): **Invictus, El Emperador y Rodrigo**. **EPICCELL no tiene cron**: allá el panel igual lo enseña «Sin señal», pero no llega el aviso.

Mientras el agente falle o esté callado, **el bot sigue con el último stock que recibió** (no se borra nada).

### Las columnas que se reconocen (en cualquier orden, con o sin tildes)

| Dato | Nombres que entiende |
|---|---|
| Código | código, cod, sku, barras, ean, referencia, ref |
| Producto | producto, modelo, título, nombre, descripción, artículo |
| Talla / capacidad | talla, opción, capacidad, tamaño, medida, size |
| Color | color |
| **Cantidad (obligatoria)** | cantidad, stock, existencia, unidades, inventario, cant |
| Precio de venta | precio, pvp, precio de venta, valor |
| Costo | costo, precio de costo, precio de compra |
| Marca | marca, fabricante |
| Sede | sede, local, tienda, almacén, sucursal |

Hace falta **la cantidad** y **el producto o el código**. Si el sistema usa otros nombres, en la consulta SQL se renombran con `AS` (ver ejemplos).

### Fuente «archivo» (el sistema exporta un CSV)
```json
"fuente": { "tipo": "archivo", "ruta": "C:\\exportes\\stock.csv", "codificacion": "latin1", "maximoMinutos": 180 }
```
- `codificacion`: `utf8` (por defecto), `latin1` (la mayoría de sistemas viejos en Windows), `utf16le` (algunos Excel «Unicode»). Si ves letras raras (`Ã³`, `�`), prueba otra.
- `maximoMinutos`: si el archivo es más viejo que eso, **no se manda** (así un sistema que dejó de exportar no hace creer al bot que el stock sigue igual). Recomendado.

### Fuente «comando» (se consulta la base)
```json
"fuente": { "tipo": "comando", "comando": "…lo que escribe el stock por pantalla…", "codificacion": "latin1" }
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
(En JSON, las comillas dobles y las barras del comando se escriben con `\"` y `\\`. Si se vuelve incómodo, guarda el comando en un `.bat` y pon `"comando": "C:\\agente-puente\\ejemplos\\sacar-stock-sqlserver.bat"`.)

> La clave de la base va dentro del comando, así que **la PC donde corre el agente debe ser de confianza** y el usuario de la base, de solo lectura.

### Las ventas de vuelta (opcional)
```json
"ventas": { "activar": true, "carpeta": "C:\\ventas-de-la-tienda" }
```
En cada vuelta el agente deja en esa carpeta:
- `ventas-nuevas-<n>.csv`: solo lo vendido desde la última vez que bajó (para cargarlo una vez).
- `ventas-ultimos-3-dias.csv`: los últimos 3 días completos; ahí se ven también las **anuladas** (columna `anulada = si`).

Cada fila es un producto vendido: `venta, id, fecha, sede, codigo, codigo_modelo, producto, marca, talla, color, cantidad, precio_unitario, total_linea, metodo_pago, cliente, telefono, fiado, anulada, nota`. **El costo nunca sale.** `codigo_modelo` es el código que el sistema de afuera mandó en su conteo; `codigo` es el de barras/fábrica de esa talla. Se cargan en el sistema con **su propio importador de Excel**, o a mano si son pocas.

## Ventaja de un `.bat` para el comando

En vez de escribir el comando dentro de `config.json` (con sus `\"` y `\\`), copia el ejemplo de `ejemplos/`, cámbiale la consulta y pon su ruta:
```json
"fuente": { "tipo": "comando", "comando": "C:\\agente-puente\\ejemplos\\sacar-stock-sqlserver.bat", "codificacion": "latin1" }
```

## Camino C: el Worker lee una dirección solo (sin instalar nada en el cliente)

Si el sistema (o alguien) deja el CSV en una dirección que se pueda descargar directo, se lo pones al bot en `wrangler.toml` (en `[vars]`) y el cron (cada 15 minutos) lo lee:

```toml
CONECTOR_URL    = "https://…/stock.csv"     # descarga directa (CSV o JSON)
CONECTOR_ORIGEN = "Profit"                  # cómo se llama el sistema
# CONECTOR_SEDE = "Principal"               # opcional
# CONECTOR_CABECERA = "Authorization"       # opcional: otra cabecera para la clave
```
y, si la dirección pide clave: `npx.cmd wrangler secret put CONECTOR_CLAVE` (se manda como `Bearer <clave>`).

Funciona en **Invictus, El Emperador y Rodrigo** (tienen cron). **EPICCELL no tiene cron**: allá usa el agente puente.

## Camino «lo empujo yo» (para quien tenga un script, Zapier, Make, etc.)

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

## Cómo se comporta (las reglas)

1. **La cantidad de cada fila es la que contó el sistema.** Queda tal cual, con su movimiento («Carga inicial» la primera vez, «Ajuste» si cambia), a nombre de «Sistema: <origen>». Repetir el mismo archivo no duplica nada.
2. **Lo vendido en la caja después de que el sistema leyó su stock se tiene en cuenta.** Por eso importa `generado`: el agente manda la hora en que leyó la base (o la fecha del archivo). Si el sistema leyó 7 unidades y después la caja vendió 2, queda 5, no 7. Cuando el sistema recibe esas ventas (se cargan allá) y reporta 5, sigue 5.
3. **Solo se pasa lo que cambió.** En archivos de 60 filas o más, se compara cada fila con el último conteo terminado y solo se procesan las nuevas o distintas. Así un catálogo de miles de productos se mantiene al día cada 15 minutos. Cada 30 días se vuelve a pasar todo (reconciliación).
4. **Dos conteos no se mezclan:** mientras uno va a medias, el siguiente espera (`409`).
5. **El precio del sistema manda** (por defecto): si cambia allá, cambia aquí. Se apaga con `precios=no`. El precio de Cashea no se toca: sigue siendo del panel.
6. **Esto nunca crea una venta ni descuenta por su cuenta.** Solo pone el conteo del sistema. Las ventas las sigue confirmando una persona (caja, «Vendí», pedidos web).
7. **No borra ni desactiva** lo que deja de aparecer en el archivo. Si un producto se acaba, el sistema debe mandarlo con cantidad 0.
8. **Si el sistema se cae**, el bot sigue con lo último que tiene. Un archivo viejo (`maximoMinutos`) no se manda.

## Seguridad

- La clave solo en el secreto del Worker y en el `config.json` de la PC del cliente; **nunca en GitHub ni en el chat**. Si prefieres, déjala vacía en `config.json` y ponla en la variable de entorno `SYNC_CLAVE` de esa PC.
- **Nada de lo que escribe el agente lleva secretos**: ni la pantalla, ni `puente.log`, ni el latido. Tapa la clave y también las contraseñas del comando (`-P`, `-p…`, `password=`, `pwd=`), y un error nunca repite el comando entero. La tienda los vuelve a tapar al guardarlos, por si acaso.
- La dirección del bot tiene que ser `https://` (el agente no acepta otra, salvo pruebas en la propia PC).
- Usuario de **solo lectura** en la base del cliente. El agente solo lee: no escribe ni borra nada en su sistema.
- La única orden que acepta de la tienda es «sincronizar». No corre nada que venga de afuera.
- Cada tienda con su clave. Si una se filtra: `npx.cmd wrangler secret put SYNC_CLAVE` con otra, y cámbiala con `--configurar`.

## Lo que no hace (todavía)

- No escribe en el sistema cerrado: las ventas se entregan en archivo.
- No maneja una talla con precio distinto dentro del mismo modelo (el precio es del modelo).
- No lee fotos del sistema (las fotos se suben en el panel).
- No borra productos que desaparecen del archivo.
- No se actualiza solo: una versión nueva se copia encima de `agente-puente.mjs` (el panel enseña qué versión tiene cada PC).
