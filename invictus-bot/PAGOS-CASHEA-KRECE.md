# Cashea y Krece en Invictus (25-sep-2026)

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
