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
| `comentarios.mjs` | Los comentarios: leerlos en lote, no responderse solo, y contestar con el equipo de ESA publicación |
| `rescates.mjs` | Cuando la búsqueda exacta falla: la capacidad, la categoría y el precio en divisas |
| `alucinaciones.mjs` | Que ninguna cifra inventada por el modelo llegue al cliente ni al historial |
| `anuncios.mjs` | Que a quien llega desde una publicidad se le conteste, con el equipo del anuncio (y leerlo en la API con ADS_TOKEN) |
| `memoria.mjs` | Que el bot guarde la conversación entera y se la dé al modelo |
| `modelos.mjs` | Mismo modelo, pariente o solo la marca: "Redmi 17" agotado no es "¡Claro!, los Note 17" |
| `datos.mjs` | Horario, formas de pago y demás datos de la tienda: salen tal cual de wrangler.toml, y si falta uno lo confirma un asesor (nunca se inventa) |
| `tienda.mjs` | El panel /panel: la clave, la lista, lo que pensó la IA debajo de cada respuesta, pausar y devolver (con SQLite de verdad) |
| `panel.mjs` | El panel /anuncios (token, cuentas, cada anuncio con su equipo, agotados, llegadas) y ANUNCIOS_EQUIPOS |
| `sesion.mjs` | Lo del 2-oct: "mándalos" / "en imágenes" / nota de voz traen las fotos; notas de voz (solo se escuchan); piensa y elige cómo responder; precio en la ficha; marcas que no hay; tono |
| `fichas.mjs` | Que nunca quede un "aquí lo tienes 👇" sin nada debajo: foto rota → la ficha sale sin esa foto; si aun así no sale → lista escrita con nombre y precio |

## Antes de desplegar

```
python comprobar-imports.py   <- que no falte ningún archivo
python comprobar-config.py    <- que el wrangler.toml no tenga repetidos
python comprobar-prompt.py    <- que el prompt hable SOLO de lo que vendes
python pruebas/preparar.py
node pruebas/turnos.mjs        <- que el bot siga contestando lo que debe
npx.cmd wrangler deploy
```
