# Lo nuevo en Invictus (25-sep-2026)

## 1 · Cashea y Krece

Traído tal cual de EPICELL, donde ya lleva días en producción.

## Qué hace

Cuando el cliente pregunta por cuotas —"¿tienen Cashea?", "¿puedo pagar a
crédito?", "trabajan con crece?"— el bot manda **dos mensajes**, uno por
plataforma, con sus porcentajes exactos:

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

```
💰 KRECE
Aquí la inicial Y las cuotas van por nivel 👇

🔵 Azul — 30% inicial · 6 cuotas
⚪ Plata — 25% inicial · 8 cuotas
🟡 Oro — 20% inicial · 8 cuotas
💎 Platino — 15% inicial · 10 cuotas

¿Con cuál de las dos quieres comprar? 😊
Dime tu nivel y te digo cuánto te queda de inicial 👌
```

**Esos diez números no los redacta el modelo**, están escritos en
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
3. **No cruza las dos.** Cashea va por número (1 al 6), Krece por color. Un
   "soy nivel 2" a secas se pregunta antes de dar un porcentaje.

## Si Invictus NO trabaja con Krece

Borra la constante `PAGOS_KRECE` de `src/index.js` y la línea que la
devuelve como `segundoMensaje`, y quita del prompt la sección **KRECE**. Lo
demás sigue funcionando igual, con Cashea sola.

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

22 comprobaciones: que las tablas quepan en un mensaje de Instagram, que
cada nivel vaya en su línea con su emoji, que no se crucen las dos
plataformas, a quién le sale la tabla y a quién no, y que un "¿puedo pagar
a cuotas?" acabe en **dos mensajes** y no en el asesor.


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

**Quien pregunta cómo pagar está a un paso de pagar**, así que además sale
el aviso a Slack con el motivo "PREGUNTÓ CÓMO PAGAR".

### Lo que hay que rellenar

En `wrangler.toml`, dentro de `[vars]`:

```toml
DIRECCION  = "..."   # la dirección completa, como quieres que la lea el cliente
MAPS_URL   = "..."   # Google Maps → tu local → Compartir → Copiar vínculo
FOTO_LOCAL = "..."   # enlace http de una foto del local (opcional)
```

Mientras no estén, el bot contesta igual pero sin foto y sin botón. Nunca
manda un botón que no lleve a ninguna parte.

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
