# Instrucciones de trabajo para este repositorio

## Flujo de entrega (regla fija)

El dueño del bot **no despliega desde este repo de GitHub directamente** — copia y pega los archivos a mano en su propia carpeta del proyecto. Por eso:

**Cada vez que se modifique o cree un archivo, hay que mandárselo con la herramienta de enviar archivos (para que lo descargue), además de subirlo a GitHub.** No basta con el commit/push. Nunca asumir que con el push alcanza.

Al entregar, decir claramente:
- Qué archivos cambiaron y dónde van (ruta dentro de su proyecto: `wrangler.toml` en la raíz, el resto bajo `src/`, prompts bajo `src/prompts/`).
- Si algún archivo es nuevo (no existía antes).
- Cualquier paso manual que haga falta (secretos con `wrangler secret put`, configuración en ManyChat, etc.) antes de que el cambio funcione.

## Sobre el proyecto

Ver `README.md` para la estructura del Worker, los prompts, y el estado de los problemas conocidos.

- Rama de trabajo: `claude/zen-noether-wzy122`.
- El Worker corre en Cloudflare (sin n8n ni Make). Cloudflare Worker `invictus-bot`.
- `src/nombre.js` falta en este repo (index.js lo importa) — pendiente de que lo pase el dueño.
