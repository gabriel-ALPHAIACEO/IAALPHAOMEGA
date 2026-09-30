# Pruebas de EPICELL

**Esto NO se despliega.** Va en la carpeta del proyecto, AL LADO de `src/`
(no dentro), a la misma altura que `wrangler.toml`:

```
bot-telefonos-epicell\
├── wrangler.toml
├── src\        ← lo que va a Cloudflare
└── pruebas\    ← esto: se queda en tu PC
```

No sube al Worker: `wrangler deploy` empaqueta solo lo que importa
`src/index.js`, y nada de `src/` importa estas pruebas.

## Cómo se corren

```
node pruebas/correr.mjs
```

Desde la carpeta `bot-telefonos-epicell/`. Necesita **Node 22 o más nuevo**
(usa `node:sqlite`, SQLite de verdad en memoria, para hacer de D1).

Primero revisa que cada `.js` de `src/` compile —si un archivo se pegó a
medias, sale "ROTO"— y después corre las pruebas. **Si algo dice FALLA, no
despliegues.**

## Qué cubre cada una

| Archivo | Qué protege |
|---|---|
| `cupo.mjs` | Que "OpenAI sin cupo" no se cuente como "miré y no está" (caso real en Invictus, 30-sep; EPICELL tenía el mismo código): esos equipos no cuentan como mirados, se reintenta solo si da el tiempo, y el registro lo dice. También que `/indexar-catalogo` no pase del 100% y que `?rehacer=si` no dé la falsa alarma de "se están pisando". Contra el código de antes fallan 13 de 23. |

OpenAI, Google Sheets y las fotos son de mentira (se cambia `fetch`): no se
gasta un token ni se lee la hoja de verdad.

`ayuda.mjs` es la misma de Invictus: arma una copia de `src/` con los
prompts ya resueltos a texto, y da la base de mentira.
