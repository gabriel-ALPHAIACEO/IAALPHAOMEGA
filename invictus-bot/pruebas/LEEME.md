# Pruebas de Invictus

**Esto NO se despliega.** Va en la carpeta del proyecto, AL LADO de `src/`
(no dentro), a la misma altura que `wrangler.toml`:

```
invictus-bot\
├── wrangler.toml
├── src\        ← lo que va a Cloudflare
└── pruebas\    ← esto: se queda en tu PC
```

No sube al Worker: `wrangler deploy` empaqueta solo lo que importa
`src/index.js`, y nada de `src/` importa estas pruebas. Tenerla ahí sirve
justo para probar los archivos que acabas de pegar, antes de desplegar.

## Cómo se corren

```
node pruebas/correr.mjs
```

Desde la carpeta `invictus-bot/`. Necesita **Node 22 o más nuevo** (usa
`node:sqlite`, que es SQLite de verdad en memoria para hacer de D1).

Tarda unos segundos y termina con un resumen. Si algo falla, devuelve 1 y lo
dice con todas las letras: **no entregues hasta que esté en verde.**

También se puede correr una sola:

```
node pruebas/pagos.mjs
```

## Para qué sirve esto

La regla de trabajo es mejorar sin dañar. El problema es que en este bot la
mayoría de los daños **no dan error en ninguna parte**:

- Una regla que desaparece de un prompt no rompe nada: simplemente vuelve el
  problema que esa regla resolvía, semanas después.
- Un marcador `{{PAGOS}}` sin rellenar no lanza excepción: el modelo recibe
  el texto literal y contesta peor.
- Un guardián demasiado ancho empieza a cambiar respuestas correctas por
  otra cosa, y nadie se entera hasta que un cliente se queja.

Nada de eso lo atrapa `node --check`. Por eso existe esta carpeta.

## Qué cubre cada una

| Archivo | Qué protege |
|---|---|
| `pagos.mjs` | Que los nueve métodos y la tasa del BCV se contesten, y que los DATOS de la cuenta no salgan nunca: ni prometidos, ni pedidos, ni inventados. También que con `pagos.txt` vacío el bot vuelva a pasar la pregunta a un asesor, como antes de que esto existiera. |
| `gasto.mjs` | Que la cuenta de tokens y dólares esté bien —incluido el descuento de caché, que no se puede cobrar dos veces— y, sobre todo, que **medir nunca deje a un cliente sin respuesta**: con la base de datos caída no lanza. |
| `prompt.mjs` | Que los prompts se armen enteros, sin marcadores sin rellenar, y que las reglas que costaron sangre sigan escritas: el catálogo no es la respuesta por defecto, la talla nunca va en la búsqueda, el número del modelo no se adivina, el aviso al asesor no se duplica. |
| `corpus.mjs` | **La más importante.** Saca las respuestas que el bot escribe de verdad —los ejemplos del prompt y las frases fijas del código— y se las pasa a cada guardián. Si alguno altera una sola, es un falso positivo. Crece solo: cada ejemplo nuevo del prompt entra sin tocar nada. |
| `cotejo.mjs` | Que al modelo le llegue el zapato del color de la foto: con diecisiete "New Balance 9060 Dama" iguales de título, que salga primero el del color correcto. Y que una foto cuyo color no se pudo leer no se vuelva a pagar en cada pasada del cron. |
| `cupo.mjs` | Que "OpenAI sin cupo" no se cuente como "miré y no está" (incidente del 30-sep): esos zapatos no cuentan como mirados, se reintenta solo si da el tiempo, y el aviso al asesor lo dice. También que `/indexar-catalogo` no pase del 100% y no dé la falsa alarma de "se están pisando". |
| `inventario.mjs` | El inventario y la caja: el stock nunca baja de 0, una venta que no alcanza no descuenta nada, cada talla con su EAN-13, importar dos veces no duplica, y el Excel del sistema viejo se lee bien. |
| `negocio.mjs` | Gastos, fiados (un abono no pasa de lo que se debe y paga primero lo más viejo), anular una venta (el stock vuelve, no se borra), el balance, Cashea en la caja de EPICCELL (salvo divisas en efectivo), cada tienda con las palabras de su negocio, y "¿Dejar la sesión abierta?" (90 días que se renuevan, o hasta cerrar el navegador). |
| `tandas.mjs` | "Traer ahora", "Subir un Excel" y el Excel del inventario por tandas, con una base que corta como Cloudflare a las 1000 llamadas: ninguna pasada llega al tope, por tandas queda IGUAL que de una vez (modelos, tallas, códigos, fotos, stock, movimientos e informe), una tanda cortada se repite sin duplicar, dos pasadas no trabajan lo mismo a la vez, el cron termina solo, EPICCELL pasa al inventario solo al final (ni con Detener a medias), un Excel que termina tarde no deshace las ventas de la caja, subir otro Excel no corta el que va a medias, y las partes del Excel juntas son el mismo archivo byte por byte (sin repetidas aunque entren modelos mientras se baja). |

## Cómo está armado

`ayuda.mjs` tiene lo que necesitan todas:

- **`prepararSrc()`** — el código de `src/` no se puede importar desde Node
  tal cual, porque importa los prompts como `.txt` (eso lo hace Cloudflare al
  empaquetar). Así que se arma una copia de `src/` en una carpeta temporal
  con los `.txt` ya resueltos a texto, y se importa de ahí. **Nunca se
  escribe nada dentro de `src/`.** Se le puede pasar un prompt distinto para
  probar otro escenario, por ejemplo `pagos.txt` vacío.
- **`baseDeMentira()`** — D1 falso por fuera, SQLite real por dentro. Un SQL
  mal escrito falla aquí igual que fallaría en Cloudflare.
- **`baseCaida()`** — una base que revienta a la primera, para comprobar que
  el bot sigue atendiendo igual.
- **`ok()` / `titulo()` / `terminar()`** — llevar la cuenta y salir con el
  código correcto.

## Al añadir algo nuevo

- **Una red de seguridad que revise lo que se le manda al cliente** →
  añádela a la lista `GUARDIANES` de `corpus.mjs`. Es una línea, y desde ese
  momento queda protegida contra falsos positivos.
- **Una regla nueva en un prompt** que costó resolver un problema →
  añádela a la tabla de `prompt.mjs`, para que nadie la borre sin enterarse.
- **Una prueba nueva** → créala como `.mjs`, impórtale `ayuda.mjs` y
  añádela a la lista `SUITES` de `correr.mjs`.

## Comprobado que sirve

Estas pruebas se validaron rompiendo el guardián de pagos a propósito
—ensanchándolo para que atrapara frases buenas—. `correr.mjs` devolvió 1 y
señaló los falsos positivos en las respuestas del prompt. Una prueba que no
falla cuando rompes el código no vale nada.
