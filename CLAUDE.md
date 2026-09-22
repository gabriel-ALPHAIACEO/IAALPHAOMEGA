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
| `worker/` | Rama **multi-tienda sin fusionar** (`tienda.js`, `tiendas/*.js`, prompts con `{{TIENDA}}`). Viene de una base más vieja: no tiene visión en dos pasos, ni `hayMas`, ni despausar, ni nombres de clientes. **No copiar sus archivos a la carpeta de despliegue.** |

Si algún día se integra el multi-tienda, se porta `tienda.js` + `tiendas/` + los prompts con marcadores **hacia** `invictus-bot/`, nunca al revés.

## Reglas aprendidas a golpes

1. **Los secretos NUNCA van en archivos.** Se cargan con `npx.cmd wrangler secret put NOMBRE` (en Windows PowerShell es `npx.cmd`, no `npx`).
2. **No mezclar versiones.** Existió una versión vieja con KV + ManyChat (`memoria.js`, `nombre.js`). Producción es D1 + Meta directo. Si esos archivos aparecen en la carpeta de despliegue, rompen el arranque.
3. **Todo cambio en la base de datos se crea desde el código** (`asegurarColumnas` en `estado.js`), nunca dependiendo de que alguien corra una migración a mano.
4. **A Meta siempre se le responde 200 y rápido**; el trabajo va en `ctx.waitUntil`. Si no, Meta reintenta (mensajes duplicados) o desactiva el webhook.
5. **Español neutro** con el cliente: "¿Qué estás buscando?", nunca "¿Qué andas buscando?".
6. **El catálogo NO es la respuesta por defecto.** Un vendedor enseña zapatos, no manda un link. El botón del catálogo sale solo cuando: el cliente lo pide por su nombre, se buscó y no hubo nada, se acabaron los de ese modelo, o hay más de 10 (no caben en el carrusel).
7. Antes de entregar: `node --check` en cada `.js` y pruebas con `fetch` simulado. Para D1 sirve `node:sqlite` (Node 22+) como base real en memoria.

## Sobre el proyecto

Ver `README.md` para la estructura del Worker, los prompts y el estado de los problemas conocidos.

- Rama de trabajo: `claude/relaxed-euler-qoly23`.
- El Worker corre en Cloudflare (sin n8n, sin Make, sin ManyChat). Worker `invictus-bot`, base D1 `invictus-bot-db`.
- Dos modelos de OpenAI: `OPENAI_MODELO` (gpt-4o-mini) redacta, `OPENAI_MODELO_VISION` (gpt-4o) mira fotos y hace el cotejo visual.
