# Worker "memoria" — modelos IA con identidad fija

Guarda en Cloudflare (D1 + R2) la ficha fija de cada modelo generada por IA y todo lo que se genera con ella. Las imágenes se generan **en tu equipo, con tu SwarmUI** y los modelos que ya tienes: el Worker guarda la memoria y reparte los trabajos, y un puente en tu PC los genera y sube el resultado.

```
tú / agentes ──POST /generar {modelo, escena}──▶ Worker (D1: fichas + historial, R2: imágenes)
                                                     ▲            │
                                    sube imágenes    │            │ "¿hay trabajo?" cada 5 s
                                                     │            ▼
                                          puente_swarm.py (tu PC) ──▶ SwarmUI 127.0.0.1:7801
```

## Cómo se mantiene "la misma" en cada imagen

Quien genera **solo escribe la escena**. La identidad la pone siempre el Worker desde la ficha guardada en D1, con la misma forma que ya tenían tus prompts de Camila e Inês en SwarmUI:

```
rostro + cuerpo + rasgos fijos + ESCENA + estilo  <segment:yolo-face…> refuerzo_rostro
```

Lo que sostiene la cara, de más fuerte a más débil:

1. **Un LoRA de la modelo** (entrenado con 15–30 fotos de ella). Hoy **ni Camila ni Inês tienen uno**: en tu equipo solo hay LoRA de uso general. Es el siguiente paso si la cara todavía cambia entre imágenes. Cuando exista, se registra con `POST /loras` y se asigna a la ficha con `"lora"`.
2. **El segmento de cara** (`refuerzo_rostro`): SwarmUI repinta la cara con su descripción después de generar.
3. **La ficha en texto** (`rostro`, `cuerpo`, `rasgos_fijos`), delante de cada escena.
4. **La semilla**: las fichas iniciales traen la de las imágenes originales. `POST /modelos/<nombre>/fijar` cambia a la de una imagen nueva que guste; `"semilla": null` la suelta.

También se guardan el checkpoint (`analogMadnessSDXL_xl5`), pasos, CFG y tamaño con los que se creó cada una, para no cambiar de "cámara".

**Regla:** la escena no debe contradecir la ficha. Si la ficha dice "pelo negro" y la escena pide "rubia", sale una mezcla. Para cambiar algo de la identidad se edita la ficha.

## Instalación (una sola vez)

**1. El Worker** (en una carpeta aparte del bot de Invictus):
```
npx wrangler d1 create memoria-db
   → pega el database_id en wrangler.toml
npx wrangler d1 migrations apply memoria-db --remote
npx wrangler secret put MEMORIA_TOKEN     ← una clave larga inventada por ti
npx wrangler deploy
```
Abre la URL del Worker en el navegador: tiene que decir `conectada`, `ok` y `"generador": "local"`.

En PowerShell, si `npx` da "la ejecución de scripts está deshabilitada", usa `npx.cmd` en su lugar (mismo comando).

**R2 es opcional.** Sin él, las imágenes se quedan en tu PC (carpeta de salida de SwarmUI) y la generación guarda la dirección para abrirlas desde tu navegador (`http://127.0.0.1:7801/View/...`). Para guardarlas también en la nube: activa R2 en el panel de Cloudflare (R2 Object Storage; pide una tarjeta aunque los primeros 10 GB son gratis), corre `npx.cmd wrangler r2 bucket create memoria-archivos`, quita los `#` del bloque `[[r2_buckets]]` en `wrangler.toml` y vuelve a desplegar.

**2. El puente en tu PC** (carpeta `puente/`, por ejemplo en `C:\ia comfy y swarm\puente-memoria`):
- Copia `config.ejemplo.json` como `config.json` y pon la URL del Worker y tu `MEMORIA_TOKEN`. `swarm_url` ya apunta a tu SwarmUI (`http://127.0.0.1:7801`).
- Sube las fichas de Camila e Inês (una vez): `python puente_swarm.py cargar-fichas fichas.json`
- Con SwarmUI abierto, doble clic en `Iniciar_Puente.bat` y deja la ventana abierta. Mientras esté apagado, los pedidos esperan en la cola (`en_cola` en la página del Worker).

## Uso

En los ejemplos: `-H "Authorization: Bearer TU_MEMORIA_TOKEN"` y `W=https://memoria.<tu-cuenta>.workers.dev`.

**Generar (solo la escena)**
```
curl -X POST $W/generar -d '{"modelo":"Camila","escena":"red bikini on a beach at sunset","cantidad":4}'
```
Responde al instante con un `id` y `"estado":"pendiente"`. El puente lo toma, lo genera en SwarmUI y sube las imágenes.

**Ver el resultado**
```
curl $W/generaciones/<id>                → estado "lista" + dónde están las imágenes
curl $W/imagenes/<id>/0.png -o foto.png  (solo con R2; sin R2 abre la URL de tu SwarmUI que trae la generación)
curl "$W/generaciones?modelo=Camila"     → historial de esa modelo
```

**Editar una ficha o crear otra modelo**
```
curl -X POST $W/modelos -d '{"nombre":"Camila","estilo":"shot on iPhone, natural light"}'
```
Solo cambian los campos que mandes.

**Fijar la semilla de una imagen que gustó**
```
curl -X POST $W/modelos/Camila/fijar -d '{"generacion":"<id>"}'
```

**Usar un LoRA que ya tienes**
```
curl -X POST $W/loras -d '{"nombre":"flux-turbo","archivo_local":"Flux_2_Turbo_LoRA_Fixed","escala":0.5}'
```
`archivo_local` es el nombre como lo ve SwarmUI, sin `.safetensors`. Para que sea el de la modelo: `POST /modelos {"nombre":"Camila","lora":"..."}`. Para usarlo solo en una imagen: `"loras_extra":[{"nombre":"flux-turbo"}]` en `/generar`. Ojo: el LoRA tiene que ser del mismo tipo que el checkpoint (SDXL con SDXL).

Opcionales al generar: `cantidad` (hasta 10), `semilla` (`-1` = al azar), `pasos`, `guia`.

## Generar en la nube en vez de tu PC

`GENERADOR = "fal"` en `wrangler.toml` manda los trabajos a fal.ai (pide `FAL_KEY` y subir el LoRA con `PUT /loras/<nombre>/archivo`). Queda como opción para cuando tu PC no alcance; por defecto todo se genera en tu equipo.

## Seguridad

- El puente solo sale de tu PC hacia el Worker (HTTPS con tu token): nadie de afuera puede entrar a tu SwarmUI.
- Si el puente toma un trabajo y se cae, a los 15 minutos vuelve a la cola.
- (fal) El bucket es privado. fal descarga el LoRA por un enlace firmado que caduca en `ENLACE_MINUTOS` (30 por defecto); un enlace alterado o vencido da 403.
- (fal) El aviso de fal llega a una URL firmada por generación; uno falso da 403. Si fal repite el aviso, no se duplica nada.
- (fal) Si el aviso nunca llega, al consultar la generación pasado un minuto el Worker le pregunta a fal directamente.
