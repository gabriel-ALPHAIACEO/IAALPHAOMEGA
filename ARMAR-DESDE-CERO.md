# Armar el proyecto desde cero — El Emperador

Esta guía es para una computadora **donde no hay nada instalado todavía**:
ni Node, ni wrangler, ni la carpeta del bot. Al terminar tienes el Worker
de El Emperador desplegado y contestando.

Está escrita para Windows, que es donde corre el proyecto
(`C:\Users\ivoo\Documents\...`). Los comandos van en **PowerShell** o en
**CMD**, da igual cuál.

> Si ya tienes Node instalado y solo te falta la carpeta, salta al Paso 2.

---

## Paso 0 — Instalar Node.js

Node es el programa que ejecuta `npm` y `wrangler`. Sin él no hay nada que
hacer: no es opcional ni se puede reemplazar.

1. Entra a <https://nodejs.org> y descarga la versión **LTS** (hoy la 22.x).
   El archivo es un `.msi` — *Windows Installer (x64)*.
2. Ábrelo y dale a *Next* hasta el final, aceptando el acuerdo. Todo por
   defecto está bien.
3. En la pantalla que dice **"Tools for Native Modules"** (instalar
   Chocolatey y herramientas de compilación) — **déjala SIN marcar**. Este
   proyecto no la necesita, y marcarla abre otro instalador larguísimo.
4. Termina y **cierra todas las ventanas de PowerShell/CMD que tengas
   abiertas**. Esto importa: Node se agrega al PATH, y una ventana que ya
   estaba abierta sigue sin verlo. Hay que abrir una **nueva**.

Comprueba que quedó bien. En una ventana **nueva**:

```
node -v
npm -v
```

Tiene que imprimir algo como `v22.x.x` y `10.x.x` (o `11.x`). Si en vez de
eso dice *"node no se reconoce como un comando interno o externo"*, ve al
final de esta guía, sección **Si algo falla**.

---

## Paso 1 — (opcional) Git

**No hace falta.** El proyecto se despliega desde la carpeta local, y los
archivos te los paso yo uno a uno o en el `.zip`. Git solo sirve si algún
día quieres bajar el repo tú mismo. Sáltate este paso.

---

## Paso 2 — La carpeta de El Emperador

Te mandé un archivo **`emperador-bot.zip`** con la carpeta ya armada y
completa: el `wrangler.toml` de El Emperador ya renombrado, todo `src/`,
las migraciones y el `package.json` nuevo.

1. Descomprímelo en `C:\Users\ivoo\Documents\`.
2. Te queda la carpeta `C:\Users\ivoo\Documents\emperador-bot`.

Así tiene que verse por dentro:

```
emperador-bot\
  package.json          <- NUEVO. Es lo que hacía falta para "npm install".
  .gitignore            <- NUEVO
  .nvmrc                <- NUEVO (solo dice qué versión de Node usar)
  wrangler.toml         <- el de El Emperador, ya renombrado
  migrations\
    0001_contactos.sql
    0002_ultimo_envio.sql
    0003_mostrados.sql
  src\
    index.js  ia.js  imagen.js  instagram.js  estado.js  identificar.js
    shopify.js  color.js  historial.js  catalogo.js  parecidos.js
    saludo.js  aviso.js  tienda.js
    prompts\
      texto.txt  vision.txt
    tiendas\
      invictus.js  emperador.js
```

**Lo que NO debe haber en esa carpeta** (si aparece, bórralo — es de la
versión vieja del bot y rompe el arranque):

- `memoria.js`
- `nombre.js`
- `manychat.js` o `manychat-campo.js`
- `wrangler.emperador.toml` (ese nombre ya no va; el bueno es
  `wrangler.toml`)

> `invictus.js` sí va dentro de `src/tiendas/`, aunque esta sea la carpeta
> de El Emperador. Es el mismo código para las dos tiendas: quién atiende
> lo decide `TIENDA = "emperador"` en el `wrangler.toml`, no qué archivos
> hay. Borrarlo rompería el arranque.

---

## Paso 3 — Instalar las dependencias

Abre PowerShell y entra a la carpeta:

```
cd C:\Users\ivoo\Documents\emperador-bot
npm install
```

Tarda medio minuto y crea una carpeta `node_modules` con wrangler dentro.

Sobre `node_modules`: **no se copia a mano, no se toca y no se sube a
ningún lado.** Se regenera con `npm install` cuando haga falta. Si algún
día ves errores raros, borrarla y repetir `npm install` es una reparación
válida.

Comprueba:

```
npx wrangler --version
```

Tiene que decir `4.x.x`.

---

## Paso 4 — Entrar a tu cuenta de Cloudflare

```
npm run login
```

Abre el navegador y te pide autorizar. Después:

```
npm run quien-soy
```

Tiene que imprimir tu correo y tu cuenta. Si imprime otra cuenta,
`npx wrangler logout` y repite el login con la correcta.

---

## Paso 5 — Crear la base de datos

Desde dentro de `emperador-bot`:

```
npx wrangler d1 create emperador-bot-db
```

Imprime un `database_id` (una ristra larga de letras y números). **Cópialo.**

Tiene que ser una base **propia**, distinta a la de Invictus. Compartirla
mezclaría las conversaciones de las dos tiendas.

No hace falta correr migraciones: las tablas se crean solas con el primer
mensaje que atienda el bot.

---

## Paso 6 — Rellenar los PENDIENTE del `wrangler.toml`

Abre `wrangler.toml` con el Bloc de notas y rellena estas cuatro líneas:

| Línea | Qué va | De dónde sale |
|---|---|---|
| `database_id` | la ristra del paso 5 | `wrangler d1 create` |
| `SHOPIFY_TIENDA` | `algo.myshopify.com` (sin `https://`) | panel de Shopify de El Emperador |
| `URL_CATALOGO` | `https://algo.myshopify.com/` | el mismo dominio, con `https://` |
| `WHATSAPP` | `584121234567` (sin `+`, sin espacios, sin guiones) | el WhatsApp de la tienda |

Si dejas `WHATSAPP` vacío no falla nada: las fichas de producto salen solo
con el botón "Ver producto", sin el de "Comprar".

---

## Paso 7 — Los secretos

Cinco comandos, **desde dentro de `emperador-bot`**. Cada uno te pide el
valor y lo guarda cifrado en Cloudflare (no queda escrito en ningún
archivo):

```
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put SLACK_WEBHOOK
npx wrangler secret put SHOPIFY_TOKEN
npx wrangler secret put META_APP_SECRET
npx wrangler secret put IG_TOKEN
```

- `OPENAI_API_KEY` y `SLACK_WEBHOOK`: pueden ser los mismos de Invictus.
- `SHOPIFY_TOKEN`, `META_APP_SECRET`, `IG_TOKEN`: **propios de El
  Emperador**. Los de Invictus no sirven aquí.

> **Ojo con la carpeta.** Los secretos se le cargan al Worker que dice el
> `wrangler.toml` de la carpeta donde estás parado. Si corres esto desde la
> carpeta de Invictus, se los pones a Invictus.

---

## Paso 8 — Probar sin desplegar

```
npm run probar
```

Esto compila el bot y te dice qué variables ve, **sin tocar nada en
Cloudflare**. Si hay un archivo que falta o una errata, sale aquí y no en
producción. Tiene que terminar con `--dry-run: exiting now.` y, entre las
variables, verse:

```
env.TIENDA ("emperador")
```

---

## Paso 9 — Desplegar

```
npm run desplegar
```

Al terminar imprime la URL del Worker, algo como
`https://emperador-bot.TU-CUENTA.workers.dev`.

Ábrela con `/estado` al final:

```
https://emperador-bot.TU-CUENTA.workers.dev/estado
```

Tiene que decir **El Emperador** y **DB conectada**. Si dice *Invictus
Shoes*, falta `TIENDA = "emperador"` en el `wrangler.toml` — eso es grave,
el bot se presentaría con el nombre del otro negocio.

---

## Paso 10 — Conectar Instagram

Esto es lo único que no se hace desde la computadora sino en el panel de
Meta, y **solo se puede hacer con el Worker ya desplegado** (necesita la
URL del paso 9).

Los pasos están en `MONTAR-OTRA-TIENDA.md`, **Paso 3**. En resumen: crear
la app de Meta, conectar el Instagram de El Emperador, dar de alta el
webhook `https://emperador-bot.TU-CUENTA.workers.dev/webhook` con el token
`emperador2026`, y suscribirse a `messages` **y** `message_echoes`.

`message_echoes` no es opcional: es lo que hace que el bot se calle cuando
un asesor contesta a mano.

---

## Paso 11 — El catálogo

Con todo lo anterior el bot ya conversa y vende, pero **busca a ciegas**:
no sabe qué productos existen en esta tienda.

En Shopify: **Productos → Exportar → CSV**. Mándame ese archivo y te
devuelvo el `src/tiendas/emperador.js` completo, con el catálogo y la tabla
de términos de búsqueda hechos a la medida de los títulos de El Emperador.

---

## La carpeta de Invictus también necesita el `package.json`

`package.json`, `.gitignore` y `.nvmrc` son archivos **nuevos**: antes no
existían en ninguna de las dos carpetas. Pégalos también en
`C:\Users\ivoo\Documents\invictus-bot` y corre `npm install` ahí una vez.

Son idénticos en las dos carpetas — no llevan nada de una tienda en
concreto. El `"name": "bot-tiendas"` de `package.json` es solo una etiqueta
de npm: **el nombre del Worker lo decide `name` en `wrangler.toml`**
(`invictus-bot` en una carpeta, `emperador-bot` en la otra), y eso no
cambia.

Invictus sigue funcionando exactamente igual sin esto; con esto, los
comandos son los mismos en las dos carpetas (`npm run desplegar`) y wrangler
queda fijado a una versión conocida en vez de bajar la última cada vez.

---

## Si algo falla

**`node` no se reconoce como un comando**
No abriste una ventana nueva después de instalar. Cierra todas las de
PowerShell/CMD y abre una nueva. Si aun así, reinstala Node y asegúrate de
no desmarcar la opción *"Add to PATH"*.

**`npm install` se queda colgado o da error de red**
Casi siempre es el antivirus o la red de la casa. Prueba otra red, o
repite el comando: npm reanuda lo que ya bajó.

**`wrangler` no se reconoce**
O no corriste `npm install`, o estás parado en otra carpeta. Comprueba con
`cd` que estás en `C:\Users\ivoo\Documents\emperador-bot` y que ahí existe
`package.json`.

**`npm run desplegar` dice que el Worker ya existe / pisa a Invictus**
Mira la línea `name = ` del `wrangler.toml`. En la carpeta de El Emperador
tiene que decir `emperador-bot`. Si dice `invictus-bot`, estás a punto de
pisar el bot que ya funciona: **no despliegues** y corrige primero.

**`/estado` no carga (error 1101 o pantalla en blanco)**
El Worker no arranca, y casi siempre es un archivo que no se copió.
Comprueba que existan `src/tienda.js` y `src/tiendas/` con los dos archivos
dentro. Para ver el error real:

```
npx wrangler tail
```

Déjalo corriendo, manda un mensaje al Instagram de la tienda, y pásame lo
que imprima.
