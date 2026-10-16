# Protocolo del agente puente

Este documento es para **quien programa la tienda o la plataforma que recibe el stock**. Con esto, cualquier tienda (Shopify con un middleware, WooCommerce, una página propia, un ERP, Zapier, Make, n8n…) puede recibir lo que manda el agente. No hace falta usar ALPHA IA.

Hay dos formas de recibir:

1. **Webhook** (lo más simple): la plataforma tiene una dirección que recibe un `POST` con los productos. Ver la sección 1.
2. **La puerta ALPHA IA** (`/api/sync/…`): la de las tiendas con ALPHA IA. Agrega el latido, la orden «Sincronizar ahora» desde el panel y las ventas de vuelta. Otra plataforma también puede implementarla. Ver la sección 2.

---

## 1. Webhook

### Lo que llega

```
POST <la url del destino>
Content-Type: application/json
User-Agent: agente-puente/2.1.0
X-Agente-Puente: 2.1.0
X-Puente-Envio: caja-1-1792115958133      ← igual en todas las partes de un mismo envío
X-Puente-Parte: 1/3                       ← parte 1 de 3
X-Puente-Tiempo: 1792115958200            ← solo si hay firma (milisegundos)
X-Puente-Firma: sha256=9f2c…              ← solo si hay firma
<las cabeceras que se pusieron en el destino, por ejemplo X-Api-Key>
```

```json
{
  "agente": "caja-1",
  "origen": "Saint",
  "equipo": "PC de la caja",
  "version": "2.1.0",
  "envio": "caja-1-1792115958133",
  "generado": "2026-10-16T14:30:00.000Z",
  "parte": 1,
  "partes": 3,
  "total": 2400,
  "productos": [
    {
      "codigo": "Z-01",
      "producto": "Zapato Casual",
      "cantidad": 7,
      "precio": 45.5,
      "talla": "40",
      "color": "Negro",
      "marca": "Acme",
      "sede": "Principal",
      "categoria": "Calzado",
      "extras": { "Ubicación": "Pasillo 3" }
    }
  ]
}
```

- **`cantidad`** es lo que **contó el sistema** en el momento `generado`. No es una venta ni una resta: es el número que hay. Si una venta se hizo en la plataforma después de `generado`, la plataforma decide si la descuenta.
- `codigo` o `producto` siempre vienen; uno de los dos puede ser `null`. `cantidad` es un número, o `null` si el sistema escribió algo que no lo es.
- `precio` (y `costo`) son números. Los formatos `1.234,50`, `1,234.50` y `$ 45` ya llegan convertidos.
- Solo vienen los campos que el sistema tiene. Las columnas que no son ningún campo conocido van en `extras`, con su nombre original.
- El **costo** solo viene si el destino tiene `"incluirCosto": true`. Por defecto no sale de la PC.
- Con más de `lote` productos (1000 por defecto) llega en **varias partes**: todas con el mismo `envio`, cada una con su `parte`/`partes`. Si hace falta el total, se juntan las partes de un `envio`.
- Con `"formato": "csv"` llega un CSV separado por `;`, con estos encabezados: `codigo;producto;talla;color;cantidad;precio;costo;marca;sede;categoria;foto` (solo los que haya).

### Qué tiene que contestar

- **2xx** = recibido. Puede tener cualquier contenido.
- **4xx** = no lo acepta. El agente **no lo repite**: lo anota como error, con el `message` o `error` del JSON de la respuesta, y avisa si se configuraron avisos. Usarlo para «clave mala» (401/403) o «datos malos» (422).
- **5xx** o sin respuesta = el agente lo **reintenta** 2 veces más (a los 2 s y a los 4 s). Por eso **recibir dos veces lo mismo no puede duplicar nada**: hay que tratar la cantidad como «poner este número», nunca como «sumar».
- El agente espera **60 s** como mucho por respuesta (se cambia con `timeoutSegundos` en el destino).

### Comprobar la firma (recomendado)

Si el destino tiene `"secretoFirma"`, cada envío lleva:

```
X-Puente-Firma: sha256=HEX( HMAC-SHA256( secreto, X-Puente-Tiempo + "." + cuerpo ) )
```

Del lado que recibe:
1. Calcular el HMAC con el **cuerpo tal cual llegó** (los bytes, antes de interpretar el JSON).
2. Compararlo con una comparación de tiempo constante.
3. Rechazar un `X-Puente-Tiempo` de hace más de 5 minutos (así no sirve repetir un envío viejo).

Ejemplos que funcionan: `ejemplos/recibir-webhook.php` y `ejemplos/recibir-webhook.mjs`.

---

## 2. La puerta ALPHA IA (`/api/sync`)

Todas las rutas llevan `Authorization: Bearer <clave>`. Respuestas en JSON con `ok: true|false` y `error` cuando falla. Sin clave cargada en la tienda: `503`. Clave mala: `401`.

| Ruta | Para qué |
|---|---|
| `POST /api/sync/inventario?origen=&generado=<ms>&sede=&probar=1&precios=no` | El conteo, en CSV (`text/csv`) con los encabezados `codigo;producto;talla;color;cantidad;precio;costo;marca;sede`. `200` = terminó · `202` = va por tandas (`{ trabajo }`) · `409` = hay otro a medias (reintentar en 60 s) · `400` = el archivo no se entiende · `413` = más de 2 MB o 20 000 filas |
| `POST /api/sync/avanzar?trabajo=<id>` | La siguiente tanda; repetir hasta `estado: "listo"` |
| `POST /api/sync/latido` | «Estoy vivo» (abajo) |
| `GET /api/sync/estado` | Productos, los últimos conteos, los agentes y si hay una orden pendiente |
| `GET /api/sync/ventas?desde=AAAA-MM-DD \| desde_id=N \| formato=json` | Las ventas, para cargarlas en el sistema (nunca con el costo) |
| `POST /api/sync/orden` | Pide que el agente sincronice ya (lo mismo que el botón del panel) |

### El latido

El agente lo manda en cada vuelta (cada minuto, si se instaló con `instalar.bat`):

```json
{ "agente": "caja-1", "origen": "Saint", "equipo": "PC de la caja", "version": "2.1.0",
  "modo": "continuo", "cadaMinutos": 15,
  "estado": "inicio | espera | trabajando | ok | error",
  "ciclo": true, "mensaje": "120 filas, 118 sin cambios", "filas": 120, "sinCambios": 118,
  "ordenHecha": 1792115958133 }
```

- `ciclo: true` = el latido trae el resultado de un conteo («ok» o «error»). Sin `ciclo`, es un «sigo vivo».
- `mensaje` nunca lleva secretos: el agente los tapa antes de mandarlo, y la tienda otra vez al guardarlo.
- La respuesta: `{ "ok": true, "ordenes": ["sincronizar"], "ordenEn": 1792115958133, "silencioMin": 10 }`. Si `ordenes` trae `"sincronizar"`, el agente cuenta enseguida y, al terminar, manda `ordenHecha` con ese mismo `ordenEn`. Una orden pedida después (con un `ordenEn` mayor) sigue pendiente. **No hay otra orden**: el agente no corre nada que venga de afuera.
- Si no llega ningún latido en `silencioMin` minutos, la tienda avisa: «no da señal».

---

## 3. Lo que el agente nunca hace

- No escribe ni borra nada en el sistema del cliente: solo lee.
- No crea ventas ni descuenta stock en ninguna tienda.
- No borra en el destino lo que dejó de venir: si un producto se acabó, el sistema tiene que mandarlo con cantidad 0.
- No acepta comandos de afuera.
- Nunca escribe un secreto en la pantalla, el registro, el latido ni los avisos.
