# Lo nuevo en Invictus (25-sep-2026)

## 1 · Cashea

Traído tal cual de EPICELL, donde ya lleva días en producción.

## Qué hace

Invictus trabaja **solo con Cashea**. Cuando el cliente pregunta por cuotas
—"¿tienen Cashea?", "¿puedo pagar a crédito?"— el bot manda la tabla con
sus porcentajes exactos:

```
¡Sí trabajamos con cuotas! 🙌 Tenemos dos opciones 👇

💳 CASHEA
3 cuotas sin intereses, una cada 14 días 🗓️

Tu inicial según tu nivel:
🔹 Nivel 1 — 60%
🔹 Nivel 2 — 50%
🔹 Nivel 3 — 30%
🔹 Nivel 4 — 25%
🔹 Nivel 5 — 20%
🔹 Nivel 6 — 20%
```


**Esos seis números no los redacta el modelo**, están escritos en
`index.js`. Un porcentaje parafraseado es un cliente que llega a la tienda
con una cuenta distinta a la que le hicieron.

## Lo que cambió, archivo por archivo

| Archivo | Qué se le puso |
|---|---|
| `src/index.js` | Las dos tablas, cuándo salen (`PREGUNTA_POR_PAGOS`), y el envío del segundo mensaje |
| `src/prompts/texto.txt` | Cashea y Krece dejan de ir al asesor; los niveles, los topes y sus ejemplos |

Y de paso, en el prompt: **los saltos de línea**. Decía "tampoco saltos de
línea dentro de los valores" sin distinguir entre un salto de verdad (que
rompe el JSON) y un `\n` escrito (que no). Con esa regla, todo lo que
escribía el bot salía pegado. Ahora se le enseña a usar `\n` y `\n\n`, y hay
una sección de cómo se escribe una lista.

## Tres topes, y son importantes

1. **No adivina el nivel.** Es de la cuenta del cliente; se le preguntan.
2. **No hace la cuenta.** Nada de "el 30% de 40$ son 12$": da el porcentaje
   y el precio, y la multiplicación la hace él o un asesor.
3. **No inventa nada más.** Sabe la inicial por nivel, que son 3 cuotas y
   que van cada 14 días. Los montos mínimos, cómo se sube de nivel y qué
   pasa si el cliente se atrasa NO los sabe: eso es del asesor.

## Y si preguntan por Krece

Con Krece no se trabaja, así que no se calla ni se le da largas: se le dice
que no y se le ofrece Cashea **en la misma frase**, con su tabla debajo.

> Con Krece no trabajamos por ahora 😊 Pero sí con Cashea 👇

Lo que NUNCA hace es inventarse los porcentajes de Krece. Si algún día se
trabaja con ella, se añade su tabla igual que la de Cashea.

## Lo que NO se trajo, y por qué

En EPICELL, cada ficha puede llevar **su precio Cashea** al lado del normal.
Ese dato sale de una columna de la hoja de Google que el dueño llena a mano.
Invictus lee de Shopify, donde esa columna no existe: no hay de dónde
sacarlo, y calcularlo sería inventar un número. Por eso aquí Cashea es la
tabla de porcentajes, no un precio por producto.

## Probarlo sin desplegar

```
python comprobar-imports.py
python pruebas/preparar.py
node pruebas/pagos.mjs
```

Comprobaciones: que la tabla quepa en un mensaje de Instagram, que cada
nivel vaya en su línea con su emoji, a quién le sale y a quién no, que un
"¿puedo pagar a cuotas?" acabe en la tabla y no en el asesor, y que un
"¿trabajan con krece?" reciba el no + Cashea sin porcentajes inventados.


---

## 2 · Lo que la tienda sabe de sí misma

Siete preguntas que se repiten todos los días y que antes iban al asesor.
Ahora las contesta el bot, con el texto exacto (`src/datos.js`):

| Preguntan | Responde |
|---|---|
| Horarios | lunes a viernes 9am-7pm · domingos 9am-5pm · feriados igual |
| Ubicación | la dirección + foto del local + botón **Cómo llegar** a Google Maps |
| Envíos | sí, nacionales, por ZOOM y MRW, a todo el territorio 🇻🇪 |
| Delivery | toda la isla de Margarita, gratis en algunas zonas, y pregunta la zona |
| Tasa | a la del BCV |
| Métodos de pago | los nueve, en bolívares y en divisas |
| Empleo | personal completo; se publica en las historias |

**Por qué están en el código y no en el prompt:** son datos exactos —nueve
métodos de pago, dos empresas de envío—. Si los redacta el modelo, tarde o
temprano se deja uno fuera o añade el que no es, y un método de pago
inventado es un cliente intentando pagar por donde no puede.

**Solo saltan cuando la pregunta va sola.** Mezclada con un calzado
—"¿tienen las Air Force y hacen envíos?"— contesta el modelo las dos cosas
y las fichas salen igual: un dato de la tienda no puede costar una venta.
El prompt los conoce en corto (sección **DATOS DE LA TIENDA**) justo para
ese caso.

**El bot no promete mandar los datos de pago.** Enumera los métodos y
cierra con "Elige el que más te convenga 😊": pasar la cuenta, confirmar el
monto y cerrar es trabajo de un asesor. Una promesa del bot que después
cumple una persona a destiempo es un cliente esperando con el dinero en la
mano.

**Quien pregunta cómo pagar está a un paso de pagar**, así que en ese mismo
momento sale el aviso a Slack con el motivo "PREGUNTÓ CÓMO PAGAR". Ese
aviso **no depende** de cómo esté redactada la frase final: se dispara en el
código.

### Lo que hay que rellenar

En `wrangler.toml`, dentro de `[vars]`:

```toml
DIRECCION  = "..."   # la dirección completa, como quieres que la lea el cliente
MAPS_URL   = "..."   # Google Maps → tu local → Compartir → Copiar vínculo
FOTO_LOCAL = "..."   # enlace http de una foto del local (opcional)
```

**Con la dirección basta para que salga el botón.** Si `MAPS_URL` está
vacío, el enlace se arma solo buscando esa dirección en Google Maps. Poner
`MAPS_URL` es mejor —lleva a tu ficha exacta— pero ya no es obligatorio
para que el cliente reciba su botón.

Sin dirección y sin enlace no hay botón: el bot dice que un asesor le pasa
la dirección. Nunca manda un botón que no lleve a ninguna parte.

### Cómo sale, según lo que tengas puesto

| Tienes | Le llega al cliente |
|---|---|
| Dirección | **un mensaje**: la dirección y el botón **Cómo llegar** |
| Dirección + foto | **un mensaje**: la foto, la dirección y el botón, juntos |
| Dirección muy larga (+80) + foto | dos: la dirección en texto y la foto con el botón |
| Nada | un texto diciendo que un asesor le pasa la dirección |

La dirección va en el **título** de la tarjeta, que admite 80 caracteres.
Solo si no cabe ahí se parte en dos, porque cortarla sería peor: el cliente
leería media calle.

### Si la foto sale rota

Instagram **no abre el enlace en un navegador**: se descarga el archivo él
mismo, desde sus servidores y sin sesión. Así que solo sirve una dirección
que devuelva **la imagen**, sin pantalla de por medio.

Lo que casi siempre se pega y sale roto:

| Enlace | Qué pasa |
|---|---|
| Google Drive (Compartir) | **se arregla solo**: el bot lo convierte al que sí devuelve la imagen |
| Google Fotos (`photos.app.goo.gl`) | es una página; se descarta y el mensaje sale sin foto |
| Una publicación de Instagram o Facebook | igual: es una página |
| Algo privado o con contraseña | Instagram no entra |

Cuando el enlace no sirve, **no se manda roto**: el mensaje sale sin foto,
con su dirección y su botón, y en `wrangler tail` queda la línea diciendo
por qué.

**Para verlo antes que un cliente**, abre en el navegador:

```
https://invictus-bot.invictusshoes.workers.dev/probar-ubicacion
```

Te dice la dirección, el botón, si la foto se descarga de verdad, si hizo
falta arreglar el enlace, y cómo le va a llegar el mensaje. Lo más fácil
para tener una foto que funcione: súbela a la hoja de Google o a cualquier
sitio público, ábrela sola y copia **esa** dirección (la que termina en
`.jpg` o `.png`).

### Dos cosas que cambiaron de lo que había

- **Los horarios.** El prompt decía *lunes a sábado de 9am a 7pm, domingos
  de 10am a 3pm*. Ahora dice lo nuevo: **lunes a viernes 9am-7pm, domingos
  9am-5pm, feriados igual**. Del **sábado** no se dijo nada, así que el bot
  no lo nombra — si abren, hay que añadirlo.
- **"Envíos" salió de la lista de lo que no puede responder**, porque ahora
  sí lo sabe. Lo que sigue siendo del asesor: la dirección exacta, las zonas
  de delivery gratis, los datos de la cuenta y cuánto cuesta un envío.

### Probarlo

```
python pruebas/preparar.py
node pruebas/datos.mjs
node pruebas/pagos.mjs
```


---

## 3 · El wrangler.toml, revisado contra el código (25-sep-2026)

Se comparó **lo que el código lee** con **lo que el archivo tiene**, una por
una. El resultado:

- **24 variables leídas por `src/`**: 18 están en `[vars]`, 5 son secretos
  (`wrangler secret put`) y una es el binding `DB`.
- **Ninguna de más:** no hay variables en el archivo que el código ignore.
- **Faltaba una:** `D1_NOMBRE`. La lee `index.js` para que `/estado`
  imprima los comandos ya escritos —reanudar una conversación pausada, por
  ejemplo— y sin ella los escribía con `tu-base-d1`, que hay que corregir a
  mano cada vez. Ya está puesta, con el mismo nombre que el `database_name`
  de la base.

Dos cosas que se comprobaron y están bien, por si hubiera dudas:

- **`WHATSAPP = "+584262992111"`** — el `+` no molesta: el código deja solo
  los dígitos antes de armar el enlace (`584262992111`).
- **`URL_CATALOGO`** apunta a la tienda de verdad, así que el botón "Ver
  catálogo" sí lleva a algún lado (al revés que en EPICELL, donde hubo que
  apagarlo).

Lo único que sigue pendiente de rellenar son los tres de la ubicación:
`DIRECCION`, `MAPS_URL` y `FOTO_LOCAL`.
