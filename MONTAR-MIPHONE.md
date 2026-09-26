# MIPHONE — lo que necesito para montarla

Miphone hace lo mismo que EPICELL, así que el punto de partida es el bot de
EPICELL tal como está hoy funcionando (`bot-telefonos-epicell/`): Instagram
como único canal, el inventario leído de una hoja de Google, fichas con foto
y precio, respuesta a los comentarios de las publicaciones, respuesta a
publicaciones compartidas y a historias, y pausa automática cuando un asesor
contesta a mano.

**Nada de eso hay que volver a programarlo.** Lo que hay que reunir son los
datos de Miphone: su cuenta, su inventario y sus reglas de venta. Esta guía
es esa lista.

---

## 1. La cuenta de Instagram y su app de Meta

Tiene que ser **propia de Miphone**, no se puede compartir con EPICELL: el
token de Meta manda los mensajes desde la cuenta a la que pertenece, así que
con el de EPICELL Miphone contestaría desde el Instagram equivocado.

- La cuenta de Instagram de Miphone, **profesional** (no personal).
- Una app nueva en <https://developers.facebook.com>, tipo **Negocios**, con
  el producto **Instagram → API con inicio de sesión de Instagram**.
- De ahí salen dos cosas que me tienes que pasar o cargar tú como secretos:
  - `IG_TOKEN` — el token de acceso de esa cuenta.
  - `META_APP_SECRET_IG` — la clave secreta **del producto Instagram**, no la
    de Configuración → Básica. Las dos miden 32 caracteres y a ojo no se
    distinguen; si se carga la otra, el bot rechaza todos los mensajes por
    firma inválida.
- El token necesita, además de los permisos de mensajes,
  **`instagram_business_manage_comments`** — es el que deja contestar los
  comentarios de las publicaciones. Sin eso los mensajes privados funcionan
  igual, pero los comentarios no.
- En **Webhooks** hay que suscribir tres campos: `messages`,
  `message_echoes` y `comments`.
  - `message_echoes` no es opcional: es lo que hace que el bot se calle
    cuando un asesor toma la conversación.
  - `comments` es lo que le deja contestar "precio?" debajo de una foto.

> La URL del webhook solo se puede dar de alta cuando el Worker de Miphone ya
> está desplegado, así que ese paso va al final.

---

## 2. El inventario (la hoja de Google)

- **El enlace de la hoja** de Miphone, compartida como *"cualquier persona
  con el enlace puede ver"*. No hace falta token de Google: se lee por el
  enlace público.
- **El nombre exacto de la pestaña** donde está el catálogo, tal como se ve
  en la barra de abajo.

  ⚠️ Si el nombre lleva la fecha del inventario (en EPICELL es
  `INVENTARIO AL 050926`), cada vez que se renombre la pestaña hay que
  cambiarlo en la configuración y volver a desplegar, o el bot deja de
  encontrar productos y contesta que no tiene nada.

- **No hace falta renombrar ninguna columna.** El código reconoce los
  nombres que se usan normalmente. Lo imprescindible es una columna con el
  nombre del producto y otra con el precio; y ayudan mucho, si existen:

  | Para qué | Nombres que ya reconoce |
  |---|---|
  | producto | producto, modelo, equipo, descripción, título, artículo |
  | precio | precio, pvp, valor, monto, precio usd, precio divisas |
  | segunda moneda | precio bs, bolívares, precio local |
  | precio a crédito | cashea, precio cashea |
  | capacidad | capacidad, almacenamiento, memoria, gb, rom |
  | foto | imagen, foto, img, url imagen |
  | stock | stock, cantidad, existencias, unidades |

  Si alguna columna de Miphone se llama distinto, me dices cómo y la agrego.
  Con el Worker arriba, `/probar-hoja` dice qué columnas encontró y qué
  entendió de cada una.

- **La foto importa más de lo que parece:** sin columna de imagen las fichas
  salen sin foto, y este bot vende mostrando.

---

## 3. La tienda en palabras (esto es lo que más cambia)

Todo esto está escrito dentro de los prompts, y hoy dice EPICELL. Necesito
lo de Miphone:

1. **Cómo se llama y cómo se presenta.** El bot dice *"Soy la asistente
   virtual de EPICELL"*. ¿Miphone, MiPhone, Mi Phone?
2. **Qué vende y qué NO vende.** Esto es crítico: EPICELL **no vende Apple**,
   y eso está escrito en el prompt de fotos para que no ofrezca un iPhone que
   no tiene. ¿Miphone vende Apple? ¿Vende accesorios (cables, cargadores,
   audífonos, relojes, tablets, routers)?
3. **Nuevo, usado o reacondicionado** — cuál de los tres maneja. (En EPICELL
   este bloque está sin llenar todavía.)
4. **Horarios**, tal como quieres que los diga.
5. **Financiamiento.** EPICELL trabaja con Cashea y Krece, con estos
   porcentajes metidos en el prompt:
   - Cashea (inicial por nivel): N1 60% · N2 50% · N3 30% · N4 25% · N5 20% ·
     N6 20% — siempre 3 cuotas, una cada 14 días.
   - Krece: Azul 30% y 6 cuotas · Plata 25% y 8 · Oro 20% y 8 · Platino 15% y 10.

   ¿Miphone trabaja con las dos, con una, con ninguna? ¿Mismos porcentajes?
   Si no trabaja con alguna, se quita del prompt: prometer un financiamiento
   que la tienda no da es de los errores más caros.
6. **Los precios de la hoja, ¿en qué moneda están?** En EPICELL están en
   divisas (dólares) y el bot los da sin consultar a nadie.
7. **El WhatsApp** de Miphone, para el botón "Comprar" de cada ficha.
8. **¿Tiene tienda web?** EPICELL no, y por eso el bot no nombra ningún
   catálogo ni manda botones que no llevan a ningún lado. Si Miphone tiene,
   me pasas el enlace y los botones se prenden solos.
9. **Qué se responde y qué va al asesor.** En EPICELL van al asesor:
   colores, garantía, envíos, permutas, reparaciones, facturas, reclamos,
   liberación de banda. Si en Miphone alguna de esas sí se puede contestar,
   dímelo.
10. **A dónde llega el aviso** de "te están esperando" (el Slack de EPICELL u
    otro).

---

## 4. Cloudflare

- **Nombre del Worker** de Miphone — es parte de su dirección. EPICELL usa
  `bot-telefonos`; para Miphone serviría `bot-miphone`
  (`https://bot-miphone.arizatecnologia.workers.dev`).
- **Una base de datos D1 propia.** Se crea con
  `npx wrangler d1 create bot-miphone-db`, y ese comando imprime un
  `database_id` que me pasas (o lo pegas tú en `wrangler.toml`).

  ⚠️ **Tiene que ser propia, no la de EPICELL.** Compartida, un cliente de
  Miphone vería el historial de EPICELL, y las pausas de asesor de una
  tienda callarían al bot de la otra.

---

## 5. Qué se comparte y qué es propio

| | EPICELL | Miphone |
|---|---|---|
| El código (`src/`) | el mismo | el mismo |
| Worker | `bot-telefonos` | propio |
| Base D1 | propia | propia |
| App de Meta + `IG_TOKEN` | propia | propia |
| Hoja de inventario | propia | propia |
| WhatsApp | propio | propio |
| `OPENAI_API_KEY` | se puede compartir | se puede compartir |
| `SLACK_WEBHOOK` | se puede compartir | se puede compartir |

---

## 6. Lo que queda de tu lado al final

Desde la carpeta de Miphone (esto importa: los secretos se cargan al Worker
de la carpeta donde estás):

```
npx wrangler d1 create bot-miphone-db
npx wrangler d1 migrations apply bot-miphone-db --remote
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put SLACK_WEBHOOK
npx wrangler secret put META_APP_SECRET_IG
npx wrangler secret put IG_TOKEN
npx wrangler deploy
```

Y después, con el Worker ya arriba:

1. Dar de alta el webhook en Meta con la URL de Miphone y el token de
   verificación, y suscribir `messages`, `message_echoes` y `comments`.
2. Comprobar, antes de apretar "Verificar y guardar", que esto devuelva
   `PRUEBA12345` y nada más:
   `https://bot-miphone.arizatecnologia.workers.dev/webhook?hub.mode=subscribe&hub.verify_token=EL_TOKEN&hub.challenge=PRUEBA12345`
3. Abrir `/estado`: tiene que decir el nombre de Miphone, "DB conectada" y
   ningún secreto en FALTA.
4. Abrir `/probar-hoja`: tiene que encontrar la hoja y las columnas.

---

## 7. Una decisión que hay que tomar antes de escribir nada

Hay dos formas de montar Miphone, y conviene elegir ahora:

**A. Un solo código para las dos tiendas.** Los datos de cada una viven en su
propio archivo (`tiendas/epicell.js`, `tiendas/miphone.js`) y la
configuración dice de cuál se trata. Un arreglo se hace una vez y sirve para
las dos. Es lo que ya se hizo con el bot de zapatos (Invictus y El
Emperador). Cuesta más ahora: hay que sacar de los prompts de EPICELL todo lo
que es suyo —el nombre, el financiamiento, lo que vende— y comprobar que
EPICELL sigue contestando igual que hoy.

**B. Una copia de la carpeta para Miphone.** Más rápido y sin tocar EPICELL,
pero cada arreglo futuro hay que hacerlo dos veces, y en cuanto una copia se
queda atrás las dos tiendas dejan de comportarse igual. En este mismo
proyecto ya pasó dos veces.

**Recomiendo A**, precisamente porque el trabajo grande de este bot está en
los prompts, que es justo lo que en la opción B se duplica.
