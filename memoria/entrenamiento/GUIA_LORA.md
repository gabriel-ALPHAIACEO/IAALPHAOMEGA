# Entrenar el LoRA de una modelo (para que la cara no cambie)

Un LoRA por persona. Hace falta una sola vez; despues el Worker lo carga solo.

## 1. Juntar las imagenes
```
cd "C:\ia comfy y swarm\memoria\entrenamiento"
python preparar_dataset.py Camila "Camila Reyes Ortega" camilareyes
```
Copia a `dataset\Camila\10_camilareyes\` las imagenes de SwarmUI que tengan su
nombre y les pone un .txt con la palabra clave. **Despues revisalas a mano**
y borra las malas. Quedate con 20-30 donde:
- la cara se vea nitida y sea claramente ella (no deformada);
- haya variedad: de frente, 3/4, perfil, sonriendo, distinta luz y ropa;
- no haya manos raras ni otra persona;
- incluyas algunos primeros planos de cara y otros de cuerpo entero.

## 2. Entrenar (SDXL, mismo checkpoint: analogMadnessSDXL_xl5)
Herramienta recomendada: **kohya_ss** (interfaz web). Ajustes de partida:
- Pretrained model: el archivo `analogMadnessSDXL_xl5` de `models\checkpoints`
- Train data dir: `...\entrenamiento\dataset\Camila` (la carpeta que contiene `10_camilareyes`)
- Tipo: LoRA, SDXL. Resolucion 1024,1024. Network dim/rank 32, alpha 16.
- Optimizador AdamW8bit, learning rate 1e-4, scheduler cosine.
- Epocas 10-15 (guarda un archivo cada 2-3 epocas para elegir el mejor).
- Batch size 1; si la VRAM no alcanza, activar gradient checkpointing.
- Output name: `camila_lora`

## 3. Probar
Copia el `.safetensors` a `C:\ia comfy y swarm\ComfyUI_V137\ComfyUI\models\loras`.
En SwarmUI genera con `<lora:camila_lora:0.8>` y `camilareyes` en el prompt,
con distintas escenas. Si la cara se pasa de "pegada" a todo, baja el peso
a 0.6-0.7; si no se parece lo suficiente, sube a 0.9-1.0 o usa una epoca
posterior.

## 4. Conectarlo a la memoria
Con tu clave en `$h`:
```
Invoke-RestMethod -Method Post -Uri https://memoria.pompanava.workers.dev/loras -Headers $h -Body '{"nombre":"camila_lora","archivo_local":"camila_lora","palabra_clave":"camilareyes","modelo_base":"sdxl","escala":0.8}'
Invoke-RestMethod -Method Post -Uri https://memoria.pompanava.workers.dev/modelos -Headers $h -Body '{"nombre":"Camila","lora":"camila_lora"}'
```
Desde ahi, cada `/generar` de Camila usa su LoRA y la palabra clave.
Para Ines repite todo con `Ines` / `inesporto`.
