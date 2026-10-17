# Solventas (Grupo Sotecsis) — arreglarlo y conectarlo al bot

**Para quién es:** la tienda de Rodrigo (RR Venleb Sport), que usa **Solventas** (el programa `C:\SSCA\Solventas.exe`) como sistema de inventario y de caja.
**Decisión del dueño (16-oct-2026):** se **sigue con Solventas** y se arregla; no se reemplaza.
**Límite:** no tenemos el código fuente del programa (es un `.exe` de Delphi de Sotecsis). Lo que se arregla aquí es **todo lo que está debajo del programa**: la base de datos SQL Server, el servicio y la configuración de Windows. Lo que viva dentro del `.exe` solo lo cambia Sotecsis (ver «Lo que solo puede arreglar Sotecsis»).

Nada de esta carpeta se despliega en un Worker ni se mezcla con los bots. Va en la **PC del servidor** de la tienda (donde está SQL Server).

## Qué se encontró (en una copia de la base, `RRVS2013CA`, restaurada en una prueba)

| Hallazgo | Por qué da los síntomas | Arreglo |
|---|---|---|
| **`AUTO_CLOSE = ON`** | Cada vez que se va el último usuario, la base **se cierra**; la siguiente conexión la **reabre**, y tarda (a veces segundos, a veces falla) → «no abre / no conecta», y se cuelga al abrir. | `reparar-base.bat` lo apaga |
| **`AUTO_SHRINK = ON`** | SQL Server encoge el archivo sin parar y lo **fragmenta**; la base se hace lenta con el tiempo. | `reparar-base.bat` lo apaga |
| **96 de 100 tablas sin ningún índice** (`Productos`, `ventas`, `renglon`, `movinv`… ) | Cada búsqueda por código de barras o por factura **lee la tabla entera**. Con 100 000 productos de prueba: **4 768 lecturas → 4 lecturas** al crear el índice del código de barras (≈1 000 veces menos trabajo). | `reparar-base.bat` crea 25 índices (los de las consultas del propio programa) |
| `TORN_PAGE_DETECTION` | Detecta menos daños del disco que `CHECKSUM`. | `reparar-base.bat` activa `CHECKSUM` |
| Estadísticas viejas | SQL Server elige mal los planes. | `reparar-base.bat` las actualiza (`FULLSCAN` en 9 tablas) |
| El programa se conecta como **`sa`** (administrador total) con la clave escrita dentro del `.exe`, a un servidor de nombre fijo (`USER\SQLEXPRESS` en `modoc.ini`) | Si la PC del servidor **no se llama `USER`**, desde las otras PC **no conecta**. Y quien abra el `.exe` con un editor ve la clave. | Ver «No abre o no conecta» abajo |
| **Claves de los usuarios del programa guardadas en texto** (tabla `usuarios`) | Cualquiera con acceso a la base las lee. | Solo Sotecsis puede cifrarlas. Mientras: cambiar las claves y no reutilizarlas |
| SQL Server **Express**: tope de **4 GB** por base | Al llegar, deja de guardar y «se cuelga». | `diagnostico.bat` muestra el tamaño; se corrige con respaldos y limpieza de históricos |

## Lo que se vio en la base REAL (respaldo del 16-oct-2026, servidor `USER\SQLEXPRESS`, Windows 8.1)

- La base de producción vive en la **PC con Windows 8.1** (la misma máquina, en otro disco/arranque). La PC con Windows 11 solo tiene una copia del programa: sin SQL Server ni base.
- Es chica: **11 MB** (SQL Server 2005 Express). La lentitud no viene del tamaño.
- **Confirmado:** `AUTO_CLOSE = ON`, `AUTO_SHRINK = ON` y `TORN_PAGE_DETECTION`; 96 de 100 tablas sin índice. `reparar-base.sql` se probó sobre una copia restaurada de esta base real: 25 índices, sin errores.
- **Inventario:** solo 4 productos (creados el 15-oct-2026, existencia 0, `PVP1Prod` = 75 y 80, en dólares). 2 204 modelos viejos están en la tabla `eliminados` (precios en bolívares de 2019). 5 725 renglones de facturas viejas apuntan a códigos que ya no existen.
- **Ventas:** 639 facturas desde 2019; casi ninguna desde 2023 (una en oct-2025, una en oct-2026; la última el 14-oct-2026). Última compra: ene-2025. O sea: la tienda está **retomando** Solventas y todavía no ha cargado el stock.
- Usuario `TIENDA` con clave muy corta (menos de 6 caracteres).
- **El agente puente necesita Node 18, que no corre en Windows 8.1.** Para conectar el stock con el bot desde esa PC hay que usar un envío en PowerShell (pendiente) o mudar Solventas a otra PC.

## Cómo se usa (en la PC del servidor, con Solventas cerrado en todas las PC)

1. Copiar esta carpeta (`sistemas\solventas`) a la PC del servidor.
2. **`diagnostico.bat`** (doble clic). Solo lee. Deja `diagnostico-solventas.txt`: servicios, archivos que faltan (BDE, `VMAX.ocx`), servidor de `modoc.ini` sin claves, tamaño de la base, últimos respaldos, tablas sin índice, códigos de barras repetidos, facturas que no cuadran, fragmentación. **Mándame ese archivo**: no tiene contraseñas.
3. **`reparar-base.bat`** (clic derecho → *Ejecutar como administrador*). Pide escribir `SI`, **hace un respaldo primero** en `C:\SSCA\respaldos` (si el respaldo falla, **no cambia nada**) y luego aplica el arreglo. Se puede repetir sin problema: lo que ya está hecho lo salta. No borra ni cambia ningún dato.
   - **No hay que instalar nada**: usa `ejecutar-sql.ps1` (PowerShell, que ya trae Windows) en vez de `sqlcmd`. Entra con el usuario de Windows con el que lo abras: **ejecútalo como Administrador** para que SQL Server lo deje pasar.
   - Si la instancia no se llama `SQLEXPRESS`, cambia `SERVIDOR` al principio del `.bat` (el `diagnostico-solventas.txt` lista los servicios de SQL que hay en la PC).
4. Abrir Solventas y comprobar. Si algo se ve raro, el respaldo que dice el resultado deja todo como estaba.

> Hazlo **una vez, en un momento tranquilo** (cierre de la tienda). Tarda minutos según el tamaño.

## «No abre o no conecta» — qué mirar, en orden

1. **El servicio.** `diagnostico.bat` (sección A) dice si `MSSQL$SQLEXPRESS` está *RUNNING*. Si está detenido: `services.msc` → *SQL Server (SQLEXPRESS)* → Iniciar, y ponerlo en *Automático*.
2. **El nombre del servidor.** Primera línea de `C:\SSCA\modoc.ini` (hoy `USER\SQLEXPRESS`).
   - Si el servidor está en **la misma PC** donde se abre Solventas: poner `.\SQLEXPRESS`.
   - Si hay **varias PC**: poner `NOMBRE-DE-LA-PC-SERVIDOR\SQLEXPRESS` (el que muestra `diagnostico.bat`: «Equipo: …»).
   - Guardar una copia del `modoc.ini` antes de tocarlo.
3. **Varias PC:** en el servidor, *SQL Server Configuration Manager* → Protocolos de SQLEXPRESS → activar **TCP/IP** y reiniciar el servicio; activar el servicio **SQL Server Browser**; abrir en el firewall de Windows UDP 1434 y el puerto TCP de la instancia.
4. **`VMAX.ocx`** (control del programa): en la PC que no abre, como administrador: `regsvr32 "C:\SSCA\VMAX.ocx"`.
5. **BDE** (`IDAPI32.DLL`, el motor Borland que usa el programa): si `diagnostico.bat` dice FALTA en una PC, copiar la carpeta `Borland Shared\BDE` de una PC que sí abre (o reinstalar el BDE de Sotecsis) y ejecutar `BDEAdmin` para comprobar.
6. **No instalar SQL Server 2022** como sustitución: el programa usa el proveedor viejo `SQLOLEDB`, que las versiones nuevas ya no traen por defecto. Quedarse en SQL Server 2005–2019 Express.
7. Después de `reparar-base.bat` el problema típico de «tarda mucho en abrir» (la base dormida por `AUTO_CLOSE`) desaparece.

## El stock hacia el bot de Rodrigo (agente puente)

El agente puente (`agente-puente.mjs`, en la misma PC) lee el stock de Solventas con `sacar-stock-solventas.bat` y lo manda a la tienda.

- `sacar-stock-solventas.ps1`: **solo un SELECT**. Une `Productos` con `marcas` y `categorias`. Entrega, en UTF-8 y separado por `;`: `codigo` (el `cb`, único por talla/color), `producto`, `talla`, `color`, `cantidad` (`ExistProd`), `precio`, `marca`, `categoria`, `foto`. **No saca el costo.** Probado con 100 007 filas contra la base restaurada; el agente reconoce las nueve columnas solo.
- `sacar-stock-solventas.bat`: ahí se ajusta lo propio de la PC: `SOLVENTAS_SERVIDOR`, `SOLVENTAS_BASE`, y **qué columna es el precio de venta** (`SOLVENTAS_PRECIO`: `PVP1Prod`, `PVP2Prod`, `PVP3Prod`, `cifus` en dólares o `PVPBSF` en bolívares). *Hay que confirmar con el dueño cuál usa de verdad en caja.*
- **Seguridad:** lo recomendado es dejar `SOLVENTAS_USUARIO` vacío (seguridad de Windows). Si hay que usar usuario, crear uno de **solo lectura** (nunca `sa`) y no escribir la clave en ningún archivo de la carpeta: ponerla con `setx SOLVENTAS_CLAVE "…"` en esa PC.
- `config.solventas.ejemplo.json`: copiarlo como `config.json` en la carpeta del agente y poner `url` (la de `rodrigo-bot`) y `clave` (`SYNC_CLAVE`). `"columnas": { "costo": "" }` asegura que el costo no salga aunque aparezca. En `fotos.carpeta` va **la carpeta donde Solventas guarda las fotos** (pendiente de confirmar: el campo `foto` del producto es solo el nombre del archivo).
- Probar sin mandar nada: `node agente-puente.mjs --probar`.

## Lo que solo puede arreglar Sotecsis (proveedor)

- La clave de `sa` y el nombre del servidor **dentro del `.exe`** (hoy se pueden compensar con `modoc.ini`, pero no cambiar la clave).
- Cifrar las claves de los usuarios.
- Cualquier error que salga del propio programa (mensaje con texto) y no de la conexión o la lentitud.
- Soporte para sistemas nuevos de Windows (los `.dll` fiscales `tfhkaif.dll`, `vmax3fpi.dll`, `impf.exe`).

## Seguridad (importante)

- **Se pegaron contraseñas en el chat de trabajo.** Cámbialas en el programa. Esta carpeta no guarda ninguna.
- En `C:\SSCA` hay archivos de **otra tienda** (`modoc-RossTiendas.ini`) y de configuración con datos personales (`impf.ini`, `copia.ini`): no compartir el contenido de la carpeta completa.
- El `.bak` es de **SQL Server 2005**: guardarlo fuera de la tienda es guardar todos los clientes y facturas.
- Respaldos: copiar `C:\SSCA\respaldos` a un disco externo o a la nube cada semana. Un único disco en la tienda no es respaldo.

## Vendedores (herramienta aparte, 16-oct-2026)

Solventas no trae como eliminar vendedores (tabla `Vendedor`, 10 filas, sin llaves ni triggers). `vendedores.bat` (como administrador, Solventas cerrado) permite **ver, eliminar, agregar y deshacer**: respaldo antes de eliminar, no deja eliminar al ultimo, guarda lo eliminado en `puente_vendedores_borrados` y las facturas viejas no cambian (cada una guarda el nombre de su vendedor). Efecto: un vendedor eliminado ya no sale para facturar, y `generacomision` (INNER JOIN con `Vendedor`) deja de generarle comisiones sobre facturas aun no procesadas. Probado sobre una copia de la base real; no se puede agregar un boton al programa (sin codigo fuente).

## Archivos

| Archivo | Para qué |
|---|---|
| `ejecutar-sql.ps1` | Corre los `.sql` sin `sqlcmd` (lo usan los dos `.bat` de arriba) |
| `diagnostico.bat` / `diagnostico.sql` | Mirar el estado (solo lee) y dejar un `.txt` para enviar |
| `reparar-base.bat` / `reparar-base.sql` | Respaldo + AUTO_CLOSE/AUTO_SHRINK apagados + CHECKSUM + 25 índices + estadísticas |
| `sacar-stock-solventas.bat` / `.ps1` | El stock en CSV para el agente puente |
| `config.solventas.ejemplo.json` | Configuración del agente para Rodrigo |
