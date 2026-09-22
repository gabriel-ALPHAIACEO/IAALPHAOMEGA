# Kit de Meta — pasar cualquier bot a Instagram directo

Los tres `.js` de esta carpeta son **los mismos que corren en producción en
Invictus**, sin una línea cambiada. No importan nada de otro archivo, así que
se pegan tal cual en el `src/` de cualquier bot:

| Archivo | Qué hace |
|---|---|
| `instagram.js` | Firma HMAC del webhook, leer el mensaje que manda Meta (texto, foto, respuesta a historia, eco), enviar texto / fichas / botón de catálogo, leer el perfil del cliente |
| `estado.js` | La memoria en D1: historial, nombre, qué productos ya vio, pausa cuando contesta un asesor. Crea sus columnas solo |
| `imagen.js` | Descarga la foto de Instagram y la pasa a data URI (el CDN de Instagram le responde 403 a OpenAI, así que el enlace directo no sirve) |
| `migrations/` | La tabla base de D1 |

Lo que **no** se puede pegar y hay que cablear a mano es el `index.js` de cada
bot, porque cada uno tiene su propio cuerpo. Es lo de abajo.

---

## Por qué Meta directo y no ManyChat

Lo aprendido en Invictus, para no repetirlo:

Con ManyChat había **dos apps recibiendo el mismo webhook** de Meta —la de
ManyChat y la propia— y cada una le contestaba al cliente por su cuenta:
mensaje duplicado. Se intentó coordinarlas y no se pudo: la API de ManyChat no
acepta el `igsid` de Instagram para identificar a un subscriber, usa un
`contact_id` propio y no hay endpoint público para traducir uno al otro.

La solución de fondo es que haya **una sola app**. Sin un segundo sistema, el
duplicado deja de existir por diseño, no por parche.

---

## 1. Variables y secretos

En `wrangler.toml`, dentro de `[vars]`:

```toml
# "todo" atiende todo tipo de mensaje; "off" apaga el webhook
META_MODO = "todo"

# El que TU te inventas y escribes IGUAL en el panel de Meta
META_VERIFY_TOKEN = "loquesea2026"

# Horas que el bot se calla cuando un asesor contesta a mano
PAUSA_HORAS = "4"

# La frase con la que el asesor le devuelve la conversación al bot
FRASE_DESPAUSAR = "te dejo con la asistente"
```

Y los dos secretos:

```
npx.cmd wrangler secret put META_APP_SECRET_IG
npx.cmd wrangler secret put IG_TOKEN
```

> **OJO CON `META_APP_SECRET_IG`.** Meta tiene DOS claves y las dos miden 32
> caracteres, así que no se distinguen a ojo. La que sirve es la del **producto
> Instagram**, NO la de Configuración → Básica. Si el registro dice que la firma
> no cuadra, es que cargaste la otra.

## 2. La base de datos

Cada bot necesita la suya (son cuentas de Cloudflare distintas):

```
npx.cmd wrangler d1 create NOMBRE-DEL-BOT-db
```

Ese comando imprime un `database_id`. Va en `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "NOMBRE-DEL-BOT-db"
database_id = "el_que_imprimio_el_comando"
```

Y después:

```
npx.cmd wrangler d1 migrations apply NOMBRE-DEL-BOT-db --remote
```

Las columnas que se agregaron después las crea `asegurarColumnas()` sola, desde
el código. No hay que correr nada más.

## 3. Las dos rutas en `index.js`

Esto va dentro del `fetch`, y es lo único que hay que escribir a mano. Tal cual
está en Invictus:

```js
    if (url.pathname === "/webhook" && request.method === "GET") {
      const modo = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const desafio = url.searchParams.get("hub.challenge");

      if (modo === "subscribe" && token && token === env.META_VERIFY_TOKEN) {
        console.log("Meta verificó el webhook");
        return new Response(desafio || "", { status: 200 });
      }
      console.error("Meta intentó verificar con un token que no coincide");
      return new Response("token incorrecto", { status: 403 });
    }
```

**Y la que recibe los mensajes.** Lo importante: a Meta se le responde 200
SIEMPRE y rápido; el trabajo real va en `ctx.waitUntil`. Si tarda, Meta
reintenta (y el cliente recibe el mensaje dos veces) o desactiva el webhook.

```js
    if (url.pathname === "/webhook" && request.method === "POST") {
      // Se lee el cuerpo CRUDO: la firma se calcula sobre los bytes tal
      // como llegaron, así que volver a serializar el JSON la rompería.
      const crudo = await request.text();

      const cabecera = request.headers.get("x-hub-signature-256");

      // Meta tiene DOS claves secretas y las dos miden 32 caracteres, así
      // que no se distinguen a ojo:
      //
      //   · la de la app de Facebook   → Configuración → Básica
      //   · la de Instagram            → producto Instagram → Configuración
      //                                   de la API con inicio de sesión
      //
      // Los webhooks de Instagram se firman con la SEGUNDA. Como acertar a
      // la primera es cuestión de suerte, se prueban las dos y el registro
      // dice cuál funcionó: así se carga esa y se borra la otra.
      const claves = [
        ["META_APP_SECRET", env.META_APP_SECRET],
        ["META_APP_SECRET_IG", env.META_APP_SECRET_IG],
      ].filter(([, valor]) => valor);

      let cualFuncionó = "";
      for (const [nombre, valor] of claves) {
        if (await firmaValida(valor, cabecera, crudo)) {
          cualFuncionó = nombre;
          break;
        }
      }

      if (!cualFuncionó) {
        // A Meta se le responde 200 IGUAL. Parece raro, pero es lo correcto:
        // un 401 le dice "no te llegó" y lo reintenta, y el reintento vuelve
        // a fallar, y otra vez. Eso multiplica por tres o por diez cada
        // evento y agota la cuota del Worker.
        //
        // El mensaje se descarta igual: no se mira, no se responde. Solo se
        // le quita a Meta el motivo para insistir.
        console.error(
          "Webhook con firma inválida: lo ignoro. " +
            (!claves.length
              ? "CAUSA: no hay ninguna clave cargada. Ejecuta: " +
                "wrangler secret put META_APP_SECRET_IG"
              : !cabecera
                ? "CAUSA: la petición no trae la cabecera x-hub-signature-256. " +
                  "¿Seguro que viene de Meta?"
                : `CAUSA: ninguna de las claves cargadas (${claves
                    .map(([n]) => n)
                    .join(", ")}) firma este mensaje. Los webhooks de ` +
                  "Instagram se firman con la clave del producto Instagram, " +
                  "NO con la de Configuración → Básica. Cárgala con: " +
                  "wrangler secret put META_APP_SECRET_IG")
        );
        return new Response("ok", { status: 200 });
      }

      console.log(`Firma válida con ${cualFuncionó}`);

      // El descarte va AQUÍ, antes de nada. Meta manda cientos de avisos al
      // día que no necesitan respuesta, y esto hace que cada uno cueste
      // exactamente cero: ni OpenAI, ni Shopify, ni un envío.
      const mensaje = queAtender(env, crudo);

      // A Meta se le responde 200 siempre y rápido. Si tarda o falla, lo
      // reintenta y el cliente acaba recibiendo la misma respuesta varias
      // veces; y si falla mucho, Meta desactiva el webhook.
      if (mensaje) ctx.waitUntil(atenderConRed(env, mensaje));
      return new Response("ok", { status: 200 });
    }
```

## 4. En el panel de Meta

1. **URL de devolución de llamada:** `https://TU-WORKER.workers.dev/webhook`
2. **Identificador de verificación:** el mismo texto que pusiste en
   `META_VERIFY_TOKEN`, carácter por carácter.
3. Suscribirse a los campos **`messages`** y **`message_echoes`**.

   Sin `message_echoes` no funciona la pausa automática: el bot se entera de que
   un asesor contestó a mano porque Meta le manda el eco de todo lo que sale de
   la cuenta. Si el `mid` no es de los que mandó el bot, fue una persona.

## Comprobarlo antes de apretar "Verificar y guardar"

Abre esto en el navegador, con tu token:

```
https://TU-WORKER.workers.dev/webhook?hub.mode=subscribe&hub.verify_token=TU_TOKEN&hub.challenge=PRUEBA12345
```

Tiene que salir **`PRUEBA12345`** y nada más. Si sale cualquier otra cosa —el
cartel del bot, un error, una página en blanco— Meta va a decir que no puede
validar la URL, y tiene razón.

Fue exactamente lo que pasó con EPICELL el 22-sep: contestaba
`bot activo · 2026-09-22 · ...` a todo, incluida la verificación.
