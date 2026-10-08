# Worker "memoria" — modelos IA con identidad fija

Guarda en Cloudflare (D1 + R2) cada modelo generada por IA, su LoRA y todo lo que se genera con ella, y manda a generar las imágenes a [fal.ai](https://fal.ai/models/fal-ai/flux-lora/api).

## Cómo se mantiene "la misma" en cada imagen

Quien genera **solo escribe la escena**. La identidad la pone siempre el Worker desde la ficha guardada en D1:

```
prompt final = palabra clave del LoRA + rostro + cuerpo + rasgos fijos + ESCENA + estilo
```

Tres capas, de la más fuerte a la más débil:

1. **El LoRA de la modelo** (entrenado con 15–30 fotos de ella). Es lo que de verdad fija cara y cuerpo; sin un buen LoRA, nada de lo demás alcanza. Va siempre primero y con su escala fija.
2. **La ficha en texto** (`rostro`, `cuerpo`, `rasgos_fijos`): se pega delante de cada escena. Refuerza lo que el LoRA a veces pierde (lunares, tatuajes, color de ojos).
3. **La semilla** (opcional): cuando sale una imagen que te encanta, `POST /modelos/<nombre>/fijar` copia su semilla a la ficha y las siguientes salen más parecidas. Quita variedad de pose; se suelta mandando `"semilla": null`.

**Regla:** la escena no debe contradecir la ficha. Si la ficha dice "pelo negro" y la escena pide "rubia", sale una mezcla. Para cambiar algo de la identidad se edita la ficha, no la escena.

## Instalación (una sola vez)

Va en una carpeta **aparte** del bot de Invictus: `wrangler.toml` en su raíz, el código en `src/`, la migración en `migrations/`.

```
npx wrangler d1 create memoria-db
   → pega el database_id en wrangler.toml
npx wrangler d1 migrations apply memoria-db --remote
npx wrangler r2 bucket create memoria-archivos
npx wrangler secret put MEMORIA_TOKEN     ← una clave larga inventada por ti
npx wrangler secret put FAL_KEY           ← tu clave de fal.ai (fal.ai/dashboard/keys)
npx wrangler deploy
```

Abre la URL del Worker en el navegador: todo tiene que decir `ok` / `conectada`.

## Uso

En todos los ejemplos: `-H "Authorization: Bearer TU_MEMORIA_TOKEN"` y `W=https://memoria.<tu-cuenta>.workers.dev`.

**1. Registrar el LoRA y subir su archivo**
```
curl -X POST $W/loras -d '{"nombre":"sofia-v1","palabra_clave":"sofiaxyz"}'
curl -X PUT  $W/loras/sofia-v1/archivo --data-binary @sofia-v1.safetensors
```
Si pesa más de 100 MB (límite de Cloudflare por petición), súbelo con wrangler y regístralo con su ruta:
```
npx wrangler r2 object put memoria-archivos/loras/sofia-v1.safetensors --file sofia-v1.safetensors --remote
curl -X POST $W/loras -d '{"nombre":"sofia-v1","r2_key":"loras/sofia-v1.safetensors"}'
```
Si ya está en Hugging Face o en fal: `{"nombre":"sofia-v1","url_externa":"https://..."}`.

**2. Crear la ficha de la modelo**
```
curl -X POST $W/modelos -d '{
  "nombre": "Sofia",
  "lora": "sofia-v1",
  "escala": 0.9,
  "rostro": "ojos verdes, pelo negro largo y liso, lunar en la mejilla izquierda",
  "cuerpo": "delgada, 1.68 m, piel morena clara",
  "rasgos_fijos": "tatuaje pequeño de rosa en la muñeca derecha",
  "estilo": "foto realista, luz natural, cámara de celular"
}'
```

**3. Generar (solo la escena)**
```
curl -X POST $W/generar -d '{"modelo":"Sofia","escena":"tomando café en una terraza de París","cantidad":2}'
```
Responde al instante con un `id` y `"estado":"pendiente"`. fal avisa al Worker cuando termina (5–30 s) y las imágenes se copian al bucket.

**4. Ver el resultado**
```
curl $W/generaciones/<id>                → estado "lista" + rutas de imágenes
curl $W/imagenes/<id>/0.jpg -o foto.jpg
curl "$W/generaciones?modelo=Sofia"      → historial de esa modelo
```

**5. Fijar la semilla de una imagen que gustó**
```
curl -X POST $W/modelos/Sofia/fijar -d '{"generacion":"<id>"}'
```

Opcionales al generar: `tamano` (`portrait_4_3`, `portrait_16_9`, `square_hd`…), `semilla`, `pasos`, `loras_extra` (`[{"nombre":"estilo-film","escala":0.5}]`: van detrás del de la modelo y nunca lo reemplazan), `filtro_seguridad` (por defecto `true`; es el filtro de fal).

## Seguridad

- El bucket es privado. fal descarga el LoRA por un enlace firmado que caduca en `ENLACE_MINUTOS` (30 por defecto); un enlace alterado o vencido da 403.
- El aviso de fal llega a una URL firmada por generación; uno falso da 403. Si fal repite el aviso, no se duplica nada.
- Si el aviso nunca llega, al consultar la generación pasado un minuto el Worker le pregunta a fal directamente.
