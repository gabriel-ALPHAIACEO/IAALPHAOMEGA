# Conectar el bot con un sistema de inventario CERRADO (sin API)

Esta carpeta **no se despliega en Cloudflare**. Es para la PC o el servidor del cliente, junto a su sistema.

## En una frase

El sistema cerrado no tiene API, pero casi todos pueden **sacar un Excel/CSV** y casi todos viven sobre **una base de datos** que se puede consultar. El **agente puente** (`agente-puente.mjs`) lee esos datos y le manda el stock al bot cada 15 minutos. De vuelta, el bot le entrega las ventas en un archivo para cargarlas en el sistema.

```
 Sistema cerrado ──(base de datos o Excel/CSV)──► AGENTE PUENTE ──► /api/sync/inventario ──► el bot y su panel
 Sistema cerrado ◄──(Excel/CSV de ventas)───────── AGENTE PUENTE ◄── /api/sync/ventas ◄────── (caja, tienda web)
```

## Qué camino elegir

| El sistema… | Camino | Qué hace falta |
|---|---|---|
| Solo permite exportar a Excel, y alguien lo hace a mano | **A. Subir el Excel en el panel** (ya existe: Inventario › Importar) | Nada nuevo |
| Exporta solo a una carpeta (programado) | **B. Agente puente, fuente «archivo»** | El agente en esa PC |
| Está en un servidor/PC con base de datos (SQL Server, MySQL, PostgreSQL, Access, SQLite, Firebird…) | **B. Agente puente, fuente «comando»** con una consulta de solo lectura | El agente + un usuario de solo lectura |
| Exporta el CSV a una carpeta compartida de Drive/OneDrive/Dropbox | **C. El Worker lo lee solo** (`CONECTOR_URL`) | Un enlace de descarga directa |
| Tiene API | **C.** si devuelve CSV o JSON simple; si no, un script propio que lo empuje con el formato de abajo | Su documentación |
| Nada de lo anterior | Cambiar de sistema, o usar el inventario de la tienda como principal (caja incluida) | — |

## Paso 0 (una sola vez, en cada tienda): encender la puerta

La puerta está **cerrada** hasta que exista la clave. La clave es un secreto: nunca va en un archivo.

1. Inventa una clave larga. En PowerShell:
   ```powershell
   [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
   ```
2. Cárgala en la tienda (te la pide al escribirla):
   ```powershell
   npx.cmd wrangler secret put SYNC_CLAVE
   ```
3. Despliega: `npx.cmd wrangler deploy`.
4. Comprueba en el panel: **Inventario › Importar** debe decir «Conectar con tu sistema de inventario · encendida» y enseñar la dirección.

Cada tienda tiene **su propia clave** (nunca la misma en dos).

## Camino B: el agente puente

### Requisitos
- Una PC o servidor del cliente que esté prendido (de preferencia el mismo donde corre el sistema) con **Node.js 18 o más** (https://nodejs.org).
- Que el cliente (y el proveedor de su sistema, si la licencia lo pide) **autorice** leer sus datos. Se hace con un usuario de **solo lectura**: el agente solo hace `SELECT`, nunca escribe en el sistema.

### Instalar
1. Copia esta carpeta (`conector-puente`) a la PC, por ejemplo `C:\conector-puente`.
2. Copia `config.ejemplo.json` como `config.json` y complétalo:

   | Campo | Qué poner |
   |---|---|
   | `url` | La dirección del bot, sin barra al final: `https://tu-worker.workers.dev` |
   | `clave` | La clave del paso 0 (o déjalo vacío y usa la variable de entorno `SYNC_CLAVE`) |
   | `origen` | El nombre del sistema (sale en el historial de movimientos: «Sistema: Profit») |
   | `sede` | Vacío = la sede principal; o el nombre exacto de una sede ya creada en el panel |
   | `cadaMinutos` | Cada cuánto (15 por defecto) |
   | `fuente` | De dónde sale el stock (ver abajo) |
   | `ventas` | Opcional: dónde dejar las ventas de la tienda (ver abajo) |

3. **Prueba primero** sin guardar nada:
   ```powershell
   node agente-puente.mjs --una-vez --probar
   ```
   Te dice cuántas filas lee y qué haría. Si algo no se entiende, lo dice (por ejemplo, que no encuentra la columna de la cantidad).
4. Corre de verdad una vez: `node agente-puente.mjs --una-vez`.
5. Déjalo programado (ver «Que corra solo»).

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
(En JSON, las comillas dobles y las barras del comando se escriben con `\"` y `\\`. Si se vuelve incómodo, guarda el comando en un `.bat` y pon `"comando": "C:\\conector-puente\\sacar-stock.bat"`.)

> La clave de la base va dentro del comando, así que **la PC donde corre el agente debe ser de confianza** y el usuario de la base, de solo lectura.

### Las ventas de vuelta (opcional)
```json
"ventas": { "activar": true, "carpeta": "C:\\ventas-de-la-tienda" }
```
En cada vuelta el agente deja en esa carpeta:
- `ventas-nuevas-<n>.csv`: solo lo vendido desde la última vez que bajó (para cargarlo una vez).
- `ventas-ultimos-3-dias.csv`: los últimos 3 días completos; ahí se ven también las **anuladas** (columna `anulada = si`).

Cada fila es un producto vendido: `venta, id, fecha, sede, codigo, codigo_modelo, producto, marca, talla, color, cantidad, precio_unitario, total_linea, metodo_pago, cliente, telefono, fiado, anulada, nota`. **El costo nunca sale.** `codigo_modelo` es el código que el sistema de afuera mandó en su conteo; `codigo` es el de barras/fábrica de esa talla. Se cargan en el sistema con **su propio importador de Excel**, o a mano si son pocas.

### Que corra solo (Windows)
Programador de tareas, una vez por vuelta, aunque no haya nadie con la sesión abierta:
```powershell
schtasks /Create /TN "Puente del bot" /SC MINUTE /MO 15 /RU SYSTEM /TR "cmd /c cd /d C:\conector-puente && node agente-puente.mjs --una-vez >> puente.log 2>&1"
```
Mira `puente.log` si algo falla. También puedes dejar una ventana con `node agente-puente.mjs` (sin `--una-vez`) y se repite sola.

## Camino C: el Worker lee una dirección solo (sin instalar nada en el cliente)

Si el sistema (o alguien) deja el CSV en una dirección que se pueda descargar directo, se lo pones al bot en `wrangler.toml` (en `[vars]`) y el cron (cada 15 minutos) lo lee:

```toml
CONECTOR_URL    = "https://…/stock.csv"     # descarga directa (CSV o JSON)
CONECTOR_ORIGEN = "Profit"                  # cómo se llama el sistema
# CONECTOR_SEDE = "Principal"               # opcional
# CONECTOR_CABECERA = "Authorization"       # opcional: otra cabecera para la clave
```
y, si la dirección pide clave: `npx.cmd wrangler secret put CONECTOR_CLAVE` (se manda como `Bearer <clave>`).

Funciona en **Invictus y El Emperador** (tienen cron). **EPICCELL no tiene cron**: allá usa el agente puente.

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
- La clave solo en el secreto del Worker y en la PC del cliente; **nunca en GitHub ni en el chat**.
- Usuario de **solo lectura** en la base del cliente.
- Cada tienda con su clave. Si una clave se filtra: `npx.cmd wrangler secret put SYNC_CLAVE` con otra y cámbiala en el agente.
- Sin `SYNC_CLAVE`, la puerta está cerrada (503).

## Lo que no hace (todavía)
- No escribe en el sistema cerrado: las ventas se entregan en archivo.
- No maneja una talla con precio distinto dentro del mismo modelo (el precio es del modelo).
- No lee fotos del sistema (las fotos se suben en el panel).
- No borra productos que desaparecen del archivo.
