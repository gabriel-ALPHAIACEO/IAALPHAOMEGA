# Ronda 2: que Camila quede igual a la imagen de referencia (camilareyes_003)

## Por qué la ronda 1 no alcanzó
Las 24 fotos tienen la misma pose, fondo gris y vestido beige, y la cara varía un poco de una a otra
(tono de piel, cejas). La LoRA aprendió "esa pose y ese vestido" más que la cara, y en escenas nuevas se pierde.
La solución es un dataset con **cara fija y todo lo demás variado**.

## Paso A. Limpiar lo que ya tienes (2 min)
Se conservan las 10 que más se parecen a la referencia (elegidas a ojo): 003, 006, 008, 009, 017, 018, 019, 020, 022, 023.
Las demás pasan a `entrenamiento\descartadas`. Desde PowerShell:

```
cd "C:\ia comfy y swarm\memoria\entrenamiento\dataset\Camila\10_camilareyes"
mkdir ..\..\..\descartadas -Force
foreach($n in 007,010,011,012,013,014,015,016,024,025,026,027,028,030,032,033,035,036){ Move-Item "camilareyes_$n.*" ..\..\..\descartadas\ -ErrorAction SilentlyContinue }
```

## Paso B. Generar fotos nuevas con la cara fija (SwarmUI)
- Modelo `analogMadnessSDXL_xl5`, LoRA `camila_lora-000006` con peso **0.6** (más bajo para que deje variar pose y fondo).
- En "Añadir imagen" pon `camilareyes_003.png` como Image Prompt con IP-Adapter (si SwarmUI ofrece el modelo *face*, úsalo; si te pide descargar un modelo, acepta).
- Mantén el segmento de cara `<segment:yolo-face_yolov9c.pt-1,0.7,0.5>`.
- Imágenes: 60. Semilla: -1. Prompt (pégalo tal cual):

```
camilareyes, a woman, long straight black hair, <random:close-up face portrait|head and shoulders portrait|upper body shot|medium shot|full body shot|three-quarter view|side profile view|looking over shoulder>, <random:smiling softly|serious expression|laughing|looking at camera|looking away>, wearing <random:a white t-shirt and jeans|a black dress|a red bikini|a green sweater|a denim jacket|a yellow summer dress|sportswear|a pink lace bodysuit>, <random:in a cafe|on a beach at sunset|on a city street at night|in a bedroom with soft window light|in a park|in a modern kitchen|in a studio with a colored background>, natural lighting, photo
```

## Paso C. Elegir (lo más importante)
Quédate solo con las ~30 fotos donde la cara se ve **igual a la referencia** (forma de cara, cejas gruesas y arqueadas, ojos, labios, tono de piel).
Si dudas, descártala. Es mejor 25 perfectas que 60 regulares. Procura que haya al menos 8 primeros planos de la cara.
Cópialas a `entrenamiento\dataset\Camila2\8_camilareyes\` junto con las 10 buenas del paso A.

## Paso D. Captions con variedad
En kohya_ss: Utilities > Captioning > BLIP captioning.
Carpeta: `...\dataset\Camila2\8_camilareyes`, extensión `.txt`, prefijo `camilareyes, a woman, `.
Así cada foto describe su ropa y su fondo, y la LoRA asocia a `camilareyes` solo la cara.

## Paso E. Reentrenar
En kohya_ss carga `entrenamiento\camila_v2.json` (Configuration file > abrir > Load). Ya trae estos cambios sobre la ronda 1:
- `train_data_dir` → `C:\ia comfy y swarm\memoria\entrenamiento\dataset\Camila2`
- `output_name` → `camila_v2`
- `max_train_epochs` → 10, `max_train_steps` → 0, `save_every_n_epochs` → 2 (la ronda 1 se cortó en 1600 pasos por el valor por defecto de `max_train_steps`)
- `enable_bucket` → true (hay fotos verticales y cuadradas)

Estado del dataset (14/10): el look final es **piel clara y rostro afinado** (como `camilareyes_003`).
- `Camila2\5_camilareyes`: 33 fotos de cuerpo, incluida la 003 (5 repeticiones).
- `Camila2\8_camilareyes`: 15 primeros planos de piel clara, 5 con sonrisa de dientes (8 repeticiones, para que la cara pese más).
- Fuera del dataset: las originales de la ronda 1 (r2_34 a r2_42), con piel oscura y cara más ancha.
Son 33×5 + 15×8 = 285 pasos por época, 2850 en total con 10 épocas.

## Paso F. Probar
Mismo método de la ronda 1: Grid con las épocas de `camila_v2` y pesos 0.7, 0.9 y 1.0, siempre con `camilareyes, a woman` al inicio.
Cuando una combinación mantenga la cara en 10 escenas distintas, la registramos en el Worker.

## Si todavía no queda idéntica
Se repite la ronda 2 con la LoRA nueva (cada vuelta fija más la cara) y, como último paso, se aplica ReActor con `camilareyes_003.png`
como cara fuente.
