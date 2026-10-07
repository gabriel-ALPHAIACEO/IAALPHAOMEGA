# Instrucciones de trabajo para este repositorio

## Flujo de entrega (regla fija)

El dueño del bot **no despliega desde este repo de GitHub directamente** — copia y pega los archivos a mano en su propia carpeta del proyecto. Por eso:

**Cada vez que se modifique o cree un archivo, hay que mandárselo con la herramienta de enviar archivos (para que lo descargue), además de subirlo a GitHub.** No basta con el commit/push. Nunca asumir que con el push alcanza.

Al entregar, decir claramente:
- Qué archivos cambiaron y dónde van (ruta dentro de su proyecto: `wrangler.toml` en la raíz, el resto bajo `src/`, prompts bajo `src/prompts/`).
- Si algún archivo es nuevo (no existía antes).
- Cualquier paso manual que haga falta (secretos con `wrangler secret put`, configuración en Meta, etc.) antes de que el cambio funcione.

Como los archivos se pegan a mano, **cada entrega sube la constante `VERSION` de `src/index.js`**, y se comprueba en `https://<worker>/estado` que coincide. "Ya lo pegué" ≠ "ya está desplegado".

## Qué carpeta es cuál (importante)

| Carpeta | Qué es |
|---|---|
| `invictus-bot/` | **LA DE PRODUCCIÓN.** Es el código que atiende clientes hoy. Todo cambio para Invictus se hace acá. |
| `emperador-bot/` | **El Emperador** (DeepSeek + catálogo en Google Drive). Vende **calzado, bolsos, camisas, pantalones y gorras** (5-oct-2026): `src/categorias.js` decide la categoría por texto y por foto, y la búsqueda filtra por ella. Calidad doble A / triple A en vez de 1.1. Conectada al panel central (`panel.js`, `registro.js`, `revisor.js`, `crm.js` iguales a Invictus). Ver su `EMPEZAR-AQUI.md`. |
| `kit-meta/` | Las piezas de Meta directo (`instagram.js`, `estado.js`, `imagen.js` + migraciones), copiadas de producción sin cambios, con `GUIA.md` para portarlas a otro bot. **Decisión del dueño (22-sep): todos los bots van a Meta directo, ManyChat se retira de todos.** |
| `bot-telefonos-epicell/` | **EPICCELL** (teléfonos, Google Sheets) — el nombre de la tienda se escribe con **dos C** (5-oct-2026); la carpeta, el Worker `bot-telefonos`, el id `epicell` y el secreto `CLAVE_EPICELL` se quedan como están. Meta directo, completo. Las **especificaciones de cada teléfono** viven en la tabla `especificaciones` de su D1 (`src/especificaciones.js`, se siembra sola y se edita en ALPHA IA › Bases de datos): lo técnico lo contesta la IA con esos datos, no el asesor, y con la `pagina` oficial manda el botón "Ver ficha técnica". La cuenta de Cashea por nivel la hace `src/cuotas.js`. Ver su `PENDIENTE.md`. **WhatsApp** (7-oct-2026): el mismo bot contesta por WhatsApp con `src/whatsapp.js` (cliente = `wa:` + número; `instagram.js` desvía los envíos); se enciende con `WA_PHONE_ID` y el secreto `WA_TOKEN`, ver su `WHATSAPP.md`. |
| `panel-central/` | **El panel central del dueño** (2-oct-2026). Un Worker suyo que NO atiende clientes: mira todas las tiendas por su `/api/central` y lo junta (en vivo, alertas, métricas, ganadores, gastos, en pausa, bases editables, diagrama). Su `src/` es SOLO suyo, no se pega en las tiendas. Ver su `LEEME.md`. Pruebas: `node pruebas/central.mjs` (usa `invictus-bot/` como tienda de verdad). |

**`src/` es casi idéntico en `invictus-bot/`, `emperador-bot/` y `bot-telefonos-epicell/` a propósito.** Un arreglo se aplica pegando el mismo archivo en las carpetas que correspondan. Lo que NUNCA se cruza entre tiendas: `wrangler.toml`, `src/prompts/` y los secretos — ahí vive lo que hace que cada bot sea de su tienda. (EPICELL además lee de Google Sheets en vez de Shopify, así que sus `sheets.js`, `capacidad.js` y `recomendados.js` son suyos.)

**`src/whatsapp.js` está en las 3 tiendas** (7-oct-2026) porque `panel.js` lo usa para escribirle desde el panel a un cliente de WhatsApp; solo EPICCELL lo tiene encendido.

**`src/alpha.js` y `src/iconos.js` son idénticos en las 3 tiendas Y en `panel-central/src/`** (5-oct-2026; `iconos.js` desde el 7-oct, porque `alpha.js` lo importa): es la cara de ALPHA IA en los dos paneles — el logo (dentro del archivo, en base64), el estilo (oscuro por defecto; desde el 6-oct con botón ☀️/🌙 para el tema claro, que cada navegador recuerda), el script que pone la página al día sin parpadear, y cómo se pintan la foto del cliente y el carrusel de fichas. Un cambio de diseño se pega en las cuatro carpetas.

**El `/panel` de cada tienda es el panel del CLIENTE (5-oct-2026)**: chats, CRM (`src/crm.js`: ficha, etapas, notas, etiquetas, Excel), métricas y ganadores con calendario, y **Errores IA** (6-oct: las respuestas señaladas ❌🔴⚠️👎 con su conversación, a Excel y texto; en un ❌ sin el detalle técnico). **✅ Solucionar errores** (6-oct, en los dos paneles): marca `resuelto` en `turnos`/`errores` de la tienda y `resuelta` en las alertas del central; deja de salir en rojo pero NO se borra, y lo que vuelva a pasar sale otra vez. Lo confidencial —gastos de la IA, estado técnico y errores, bases de datos— queda SOLO en el panel ALPHA IA. Con `PANEL_API_CLAVE` puesta, el `/estado` público solo dice "vivo" y la versión; completo con `/estado?clave=<PANEL_API_CLAVE>` o desde ALPHA IA.

**📦 INVENTARIO Y 🧾 CAJA (7-oct-2026, fase 1, sin nada fiscal)**: `src/inventario.js` (datos y reglas) e `src/inventario-panel.js` (pantallas en `/panel/inventario` y `/panel/caja`) son IGUALES en las 3 tiendas. La caja cobra también lo que no está en stock (un servicio), al fiado (con el nombre del cliente) y manda el recibo por WhatsApp; una venta mal cobrada se **anula** desde Ventas (el stock vuelve, la venta queda marcada, no se borra). Tablas `inv_*` en la D1 de cada tienda, creadas por código. Stock por talla/variante y por sede, con un movimiento por cada cambio (quién, cuánto queda). Cada variante recibe sola un EAN-13 que empieza por 2; el código viejo o de fábrica se guarda aparte y también pasa en caja. **Reglas del dueño: el stock solo baja cuando el asesor/dueño confirma que el cliente se lo llevó ("Vendí" o Cobrar en la caja). La IA nunca descuenta ni aparta.** Lo único propio de cada tienda es `traerCatalogo` (en su `index.js`): Invictus desde Shopify, sin tallas (variante "única"); El Emperador desde Drive, tallas del rango del nombre; EPICCELL desde la hoja ENTERA (también agotados e inactivos, precios, fotos, capacidad, columnas extra y cantidad). Pruebas: `pruebas/inventario.mjs` en las tres, y `pruebas/negocio.mjs` en Invictus y El Emperador (gastos, fiados, anular, balance, Cashea en la caja, rubros, la sesión abierta).

**💼 EL NEGOCIO Y EL DISEÑO PROPIO (7-oct-2026)**: `src/marco.js` (el marco de todas las páginas del panel de la tienda: menú, estilo, animaciones, tema claro/oscuro), `src/iconos.js` (los íconos propios de ALPHA IA, nada de emojis de Android en la interfaz), `src/negocio.js` (gastos, fiados y abonos, ventas anuladas, el balance y el asistente) y `src/negocio-panel.js` (Inicio, Ventas, Gastos, Fiados) son IGUALES en las 3 tiendas. Un cambio de diseño del panel de la tienda va en `marco.js`; uno de los dos paneles, en `alpha.js`.
- **Cada tienda funciona según su negocio** (decisión del dueño, 7-oct): el `rubro` que cada `index.js` le pasa a `atenderPanel` — `calzado` (Invictus: tallas), `moda` (El Emperador: tallas, calidad AA/AAA), `telefonos` (EPICCELL: capacidades, condición, IMEI en la caja y en el recibo). Las palabras salen de `RUBROS` en `marco.js`; una tienda nueva solo elige su rubro.
- **Caja de EPICCELL (regla del dueño, 7-oct)**: se cobra el **precio Cashea**; el precio en dólares SOLO si el cliente paga en "Divisas (efectivo)". Lo pone `tarifaDeCaja: "cashea"` en su `index.js` y lo decide `tarifaDeLaVenta` en `inventario-panel.js`.
- **La hoja de EPICCELL**: dos filas con el mismo nombre, capacidad y color son la misma variante; al importar se suman sus cantidades y el informe dice cuántas se juntaron (`juntarParaInventario` en su `sheets.js`). Cada fila guarda en su variante su precio, Cashea, Bs, foto, columnas y su Activo (`oculta`).
- **En EPICCELL MANDA EL INVENTARIO** (decisión del dueño, 7-oct: "todo pasa, hasta precios y fotos"): la primera vez que se trae la hoja al inventario, el bot pasa a ofrecer lo del inventario (`leerDelInventario` en su `sheets.js`, ajuste `catalogo_del_bot` en `inv_ajustes`). Ofrece cada variante de un modelo activo, no oculta, con stock o **sin contar** (el "SI" de la hoja); una contada en 0, no. Lo vendido en la caja deja de ofrecerse solo (se mira cada 30 s). En Importar › "Lo que ofrece el bot" se vuelve a la hoja; si la base falla, el bot sigue con la hoja. Una variante con precio propio NO toma el Cashea ni los Bs del modelo (eran de otra capacidad). Prueba: `bot-telefonos-epicell/pruebas/inventario-bot.mjs` (el bot ofrece lo mismo con la hoja y con el inventario).

**🔐 "¿DEJAR LA SESIÓN ABIERTA?" (7-oct-2026, pedido del dueño)**: la pantalla de entrada de los dos paneles lo pregunta (marcado de entrada). Sí = la cookie dura 90 días y se renueva sola al usar el panel (pasados 10 días); no = se acaba al cerrar el navegador (y como mucho 12 horas). La cookie lleva el modo firmado (`<expira>.<r|s>.<firma>`); las viejas siguen valiendo. La de la tienda es `SameSite=Lax` (para que el programa instalado y los enlaces de WhatsApp entren sin pedir la clave); la del central sigue `Strict`.

**📲 EL PANEL SE INSTALA COMO PROGRAMA (7-oct-2026)**: es una app instalable (PWA), no otra base de código. `alpha.js` trae el ícono, el manifiesto (`/panel/app.webmanifest`), el trabajador (`/panel/sw.js`, alcance `/panel`) y el botón 📲 Instalar. `panel.js` los sirve sin sesión. Sin internet enseña "Sin internet" y NUNCA guarda ventas ni stock a escondidas.

**Las tres IA son distintas** (6-oct-2026): la de TEXTO (`OPENAI_MODELO`) redacta, la de IMAGEN (`OPENAI_MODELO_VISION`) mira fotos, y el REVISOR (`REVISOR_MODELO`) encuentra los errores. Solo el revisor usa un modelo que piensa (gpt-5 en Invictus, con `REVISOR_RESPALDO` por si no está). **La IA aprende sola** (`src/lecciones.js`, igual en las 3 tiendas, se enciende con `APRENDER = "si"`): el revisor escribe una regla por error y la IA de texto o de imágenes la recibe en cada mensaje; las alertas rojas no suenan y solo llega 🛠️ al panel ALPHA IA cuando hay que tocar el código. El código NO se reescribe solo: lo aprendido vive en la base y se ve/olvida en ALPHA IA › la tienda › 🧠 Aprendido.

**UN WORKER POR TIENDA, y así se queda (decidido el 29-sep-2026).** Se probó
la vía multi-tienda —un solo Worker que atendía a varias con `tienda.js` y
`tiendas/*.js`— y se descartó: con pocos clientes que son negocios de verdad,
el aislamiento vale más que dar de alta rápido. Un despliegue malo tumba a UNA
tienda, no a todas, y cada una tiene su D1 sin que los datos se mezclen.

(El `panel-central/` no contradice esto: no atiende a nadie ni toca la base de
ninguna tienda; si se cae, las tiendas siguen atendiendo igual.)

Esa carpeta (`worker/`) se borró para que nadie vuelva a trabajar así. Está en
el historial de git si alguna vez hace falta mirarla.

Lo que evita las copias que se separan no es meter todo en un Worker: es que
`src/` sea idéntico en todas las carpetas y que un arreglo se pegue en todas.
Eso ya es la regla de arriba.

## Reglas aprendidas a golpes

1. **Los secretos NUNCA van en archivos.** Se cargan con `npx.cmd wrangler secret put NOMBRE` (en Windows PowerShell es `npx.cmd`, no `npx`).
2. **No mezclar versiones.** Existió una versión vieja con KV + ManyChat (`memoria.js`, `nombre.js`). Producción es D1 + Meta directo. Si esos archivos aparecen en la carpeta de despliegue, rompen el arranque.
3. **Todo cambio en la base de datos se crea desde el código** (`asegurarColumnas` en `estado.js`), nunca dependiendo de que alguien corra una migración a mano.
4. **A Meta siempre se le responde 200 y rápido**; el trabajo va en `ctx.waitUntil`. Si no, Meta reintenta (mensajes duplicados) o desactiva el webhook.
5. **Español neutro** con el cliente: "¿Qué estás buscando?", nunca "¿Qué andas buscando?".
6. **El catálogo NO es la respuesta por defecto.** Un vendedor enseña zapatos, no manda un link. El botón del catálogo sale solo cuando: el cliente lo pide por su nombre, se buscó y no hubo nada, se acabaron los de ese modelo, o hay más de 10 (no caben en el carrusel).
7. Antes de entregar: **`node pruebas/correr.mjs`** desde `invictus-bot/`. Hace el `node --check` de cada `.js` y corre las suites; devuelve 1 si algo falla. Ver `invictus-bot/pruebas/LEEME.md`. Esa carpeta NO se despliega. Para D1 usa `node:sqlite` (Node 22+) como base real en memoria.
8. **Una red de seguridad nueva sobre la IA se añade a `GUARDIANES` en `pruebas/corpus.mjs`.** El riesgo de esas capas no es que se les escape algo malo: es que atrapen algo bueno, y eso no da error en ninguna parte.

## Sobre el proyecto

Ver `README.md` para la estructura del Worker, los prompts y el estado de los problemas conocidos.

- Rama de trabajo: `claude/relaxed-euler-qoly23`.
- El Worker corre en Cloudflare (sin n8n, sin Make, sin ManyChat). Worker `invictus-bot`, base D1 `invictus-bot-db`.
- Dos modelos de OpenAI: `OPENAI_MODELO` (gpt-4o-mini) redacta, `OPENAI_MODELO_VISION` (gpt-4o) mira fotos y hace el cotejo visual.
