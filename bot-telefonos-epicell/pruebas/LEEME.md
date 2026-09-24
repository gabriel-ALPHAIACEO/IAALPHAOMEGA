# Las pruebas

Comprueban lo que el cliente RECIBE, sin tocar Instagram, ni Google, ni
OpenAI: están los tres simulados (`banco.mjs`), junto con una base D1 de
mentira. Una prueba que falla aquí es un cliente que habría recibido algo
raro allá.

## Cómo se corren

Desde la carpeta del bot, con Node instalado:

```
python pruebas/preparar.py
node pruebas/turnos.mjs
```

`preparar.py` hace una copia desechable de `src/` en `pruebas/.stub` con
los prompts sustituidos por texto suelto (Node no sabe importar un `.txt`,
eso lo hace wrangler). **No toca nada de `src/`.**

Para correrlas todas:

```
python pruebas/preparar.py
for %f in (pruebas\*.mjs) do node pruebas\%f
```

(en PowerShell: `Get-ChildItem pruebas\*.mjs | % { node $_.FullName }`)

## Qué hay

| Archivo | Qué comprueba |
|---|---|
| `turnos.mjs` | **El turno completo**: qué mensajes y qué fichas le llegan al cliente |
| `banco.mjs` | La hoja, Instagram, OpenAI y la base, simulados. No es una prueba |
| `busqueda.mjs` | Que la búsqueda encuentre con erratas y marcas raras ("dophin" → Skydolphing) |
| `lista.mjs` | La lista de productos, las marcas y los botones |
| `sinlista.mjs` | Que la lista escrita no se pegue encima de las fotos |
| `pagos.mjs` | Cashea y Krece: que quepan, que no se crucen y que se lean |
| `pausas.mjs` | Que el bot reconozca su propio eco y no se pause solo |
| `adjuntos.mjs` | Los tipos de adjunto con los que Meta manda un post compartido |
| `feed.mjs` | Leer una publicación nuestra por la API de Instagram |

## Antes de desplegar

```
python comprobar-imports.py   <- que no falte ningún archivo
python pruebas/preparar.py
node pruebas/turnos.mjs        <- que el bot siga contestando lo que debe
npx.cmd wrangler deploy
```
