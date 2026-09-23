# Auditoría del bot de Invictus — 23-sep-2026

Lectura completa de los 15 archivos de `src/` y de los dos prompts, **sin
tocar nada**. Esto es el mapa para decidir qué podar con datos y no a ojo.

---

## Resumen: la grasa no está en el código

Lo primero que hay que decir, porque cambia el plan: **el código está
limpio.** Busqué lo de siempre y no apareció nada.

| Lo que busqué | Encontrado |
|---|---|
| Imports que no se usan | **0** |
| Constantes definidas y nunca usadas | **0** |
| Archivos que nadie importa | **0** |
| Funciones exportadas y nunca usadas | 1 (`asegurarIndice`, y se usa dentro de su propio archivo) |
| Helpers duplicados | 2 menores (`despejar` en 2 archivos, `normalizar` en 3 — aunque el de `ia.js` hace otra cosa) |

Son 4.925 líneas en 15 archivos, y la arquitectura es clara: `index.js` es
el centro y casi todo lo demás es una hoja que no depende de nadie. Solo
`cotejo.js` importa a otros cuatro.

**Conclusión: no hay nada que borrar en `src/`.** Si el objetivo era
"quitar lo que hace espacio", el espacio está en otro lado.

---

## Dónde SÍ está: los prompts

| | Bytes | Tokens aprox. |
|---|---|---|
| `texto.txt` | 73.235 | **~18.300** |
| `vision.txt` | 45.155 | **~11.300** |

Esto viaja **entero, en cada mensaje**. No es espacio en disco: es dinero y
es cupo de OpenAI.

### El número que más importa

`vision.txt` son **~11.300 tokens en cada foto**, y tu cupo es de **30.000
por minuto**.

**Cada foto se come más de un tercio de tu cuota antes de mirar la imagen.**
Esa es la razón de fondo por la que el barrido del catálogo chocó contra el
429 tan rápido: no arrancaba de cero, arrancaba con un tercio del minuto ya
gastado.

### El catálogo está DOS veces

| | Bytes | % de su prompt |
|---|---|---|
| Catálogo dentro de `texto.txt` | 13.765 | 18% |
| Catálogo dentro de `vision.txt` | 15.818 | **35%** |

- `texto.txt` lista **317** productos.
- `vision.txt` lista **315**.
- **315 son idénticos.** Es la misma lista, escrita dos veces.

Son ~30 KB de datos que Shopify ya tiene, que hay que mantener a mano cada
vez que entra un producto, y que se mandan en cada mensaje.

### El resto del reparto de `texto.txt`

| Sección | Bytes | % |
|---|---|---|
| Catálogo + cómo usarlo | 13.765 | 18% |
| Ejemplos de respuesta completa (205 líneas) | 11.926 | 16% |
| Repaso final (165 líneas) | 7.622 | 10% |

El **repaso final** repite reglas que ya están más arriba — es a propósito
(los modelos se olvidan), pero 165 líneas es mucho para eso.

---

## Reglas que el prompt pelea y el código ya garantiza

Esto es lo que más margen deja. Hay reglas que ocupan párrafos enteros del
prompt para defender algo que el código **ya hace de forma determinista**:

| Regla en el prompt | El código que ya la garantiza |
|---|---|
| "No saludes si ya se conocen" (3 lugares distintos) | `sinBienvenida()` borra el saludo si hay historial |
| "Quítale la talla al término" | `sinTalla()` |
| "El color va fuera de la búsqueda" | `separarColor()` |
| "No afirmes que no existe" | el override `SIN_RESULTADOS` |
| "No nombres un modelo que no cuadre con la foto" | `validarIdentificacion()` |

El prompt puede decir cada una de estas en **una línea** en vez de en una
sección, porque si el modelo falla, el código lo corrige igual.

---

## El problema de fondo: el bot contesta antes de saber

Es lo estructural, y de ahí salieron **todos** los fallos de esta semana.

```
1. El modelo escribe su respuesta   ← ya se comprometió con algo
2. El código busca en Shopify       ← recién acá se sabe qué hay
3. El código PISA lo que escribió si no cuadra
```

Conté **6 lugares** en `index.js` donde el código tapa lo que el modelo
escribió:

- `SOLO_TALLA` · `HAY_MAS_EN_CATALOGO` · `YA_TE_MOSTRE_TODO`
- `TE_OFREZCO_PARECIDOS` · `SIN_RESULTADOS` · `ENCONTRE_EL_DE_LA_FOTO`

(En EPICELL ya son 7, con los de capacidad.)

Cada uno es un parche correcto — sin ellos el bot mentiría. Pero tienen dos
costos: suenan a robot, y **cada caso nuevo necesita otro parche**. La
capacidad inventada del A57 fue exactamente eso: un caso que todavía no
tenía su parche.

**La solución de fondo es partirlo en dos pasos**, como ya hace la visión:

```
1. Decidir QUÉ buscar   (prompt corto: reglas de búsqueda + catálogo)
2. Buscar
3. Redactar CON los resultados delante  (prompt corto: tono + reglas de venta)
```

Y acá está lo interesante: **el total baja**. Hoy los dos trabajos comparten
un prompt de 18.300 tokens. Partido, el paso 1 no necesita el tono ni los
ejemplos de venta, y el paso 2 no necesita el catálogo ni la tabla de
términos.

---

## Lo único que veo flojo en el código

`index.js` tiene **1.602 líneas**, y `decidir()` creció a ~250 con seis
ramas de override. No cuesta dinero ni tokens, pero es donde vive la lógica
más delicada del bot y ya cuesta leerla entera. Si se hace el cambio de los
dos pasos, esa función se parte sola.

---

## Recomendación, en orden

| # | Qué | Gana | Riesgo |
|---|---|---|---|
| 1 | **Sacar el catálogo de `vision.txt`** | ~4.000 tokens por foto (13% del cupo) | Bajo — el cotejo visual y el índice ya hacen ese trabajo mejor |
| 2 | **Un solo catálogo**, no dos copias | ~3.400 tokens por mensaje, y deja de haber dos listas que mantener | Bajo |
| 3 | **Comprimir las reglas que el código ya garantiza** | ~2.000-3.000 tokens | Bajo, con pruebas |
| 4 | **Partir en dos pasos** | mejores respuestas + menos tokens | **Alto: toca el corazón del bot** |

Los tres primeros son poda con red: se miden antes y después, y se prueban
con `/probar-imagen` sin que los vea un cliente.

El cuarto lo haría **sobre El Emperador primero**, que todavía no tiene
clientes, y lo pasamos a Invictus cuando esté probado en vivo.

---

## Lo que NO hay que tocar

Por si la tentación de "optimizar" llega hasta acá:

- **Las firmas visuales de `vision.txt`** (~430 líneas). Parecen mucho, pero
  cada una se agregó por una foto que falló de verdad. Son el motivo de que
  el reconocimiento funcione.
- **`identificar.js`**. Es la red que impide que el bot nombre un modelo que
  su propia descripción contradice.
- **Los comentarios largos del código.** No viajan a ningún modelo, no
  cuestan un token, y son lo que explica por qué cada parche existe.
