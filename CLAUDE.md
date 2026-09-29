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
| `emperador-bot/` | **El Emperador** (calzado, Shopify). Copia al día de Invictus con sus propios prompts: calidad doble A / triple A en vez de 1.1. **Le falta el catálogo** — ver su `EMPEZAR-AQUI.md`. |
| `kit-meta/` | Las piezas de Meta directo (`instagram.js`, `estado.js`, `imagen.js` + migraciones), copiadas de producción sin cambios, con `GUIA.md` para portarlas a otro bot. **Decisión del dueño (22-sep): todos los bots van a Meta directo, ManyChat se retira de todos.** |
| `bot-telefonos-epicell/` | **EPICELL** (teléfonos, Google Sheets). Meta directo, completo. Ver su `PENDIENTE.md`. |

**`src/` es casi idéntico en `invictus-bot/`, `emperador-bot/` y `bot-telefonos-epicell/` a propósito.** Un arreglo se aplica pegando el mismo archivo en las carpetas que correspondan. Lo que NUNCA se cruza entre tiendas: `wrangler.toml`, `src/prompts/` y los secretos — ahí vive lo que hace que cada bot sea de su tienda. (EPICELL además lee de Google Sheets en vez de Shopify, así que sus `sheets.js`, `capacidad.js` y `recomendados.js` son suyos.)

**UN WORKER POR TIENDA, y así se queda (decidido el 29-sep-2026).** Se probó
la vía multi-tienda —un solo Worker que atendía a varias con `tienda.js` y
`tiendas/*.js`— y se descartó: con pocos clientes que son negocios de verdad,
el aislamiento vale más que dar de alta rápido. Un despliegue malo tumba a UNA
tienda, no a todas, y cada una tiene su D1 sin que los datos se mezclen.

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
