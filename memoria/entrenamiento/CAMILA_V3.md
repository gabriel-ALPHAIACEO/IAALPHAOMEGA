# Camila v3: el look nuevo (desde el 15/10)

Desde ahora Camila es la de las imágenes **2130 y 2134** del 14/10: piel blanca, cara afinada, cejas definidas,
pelo negro largo y lacio, cuerpo de reloj de arena. La 003 queda como historia; ya no es la referencia.

## Referencias de cara (IP-Adapter)
En `C:\ia comfy y swarm\memoria\entrenamiento\`:
- `camila_v3_cara_ref.png`: cara de la 2134 (Image 1).
- `camila_v3_cara_ref2.png`: cara de la 2130 (Image 2).

Image Prompting con **PLUS FACE (portraits)** en 0.5. En tandas solo de espalda se baja a 0.3 o se apaga.

## Ajustes de SwarmUI
- Modelo `analogMadnessSDXL_xl5`, LoRA `camila_v2-000008` en 0.7.
- CFG 4.5, 40 pasos, sampler DPM++ 2M SDE, scheduler Karras.
- Refiner: Control Percentage 0.35, upscale 1.5 (Lanczos).
- 832x1216. Semilla fija (12345) cuando se comparan cambios; -1 para variar.

## Prompt base
```
camilareyes, a woman, (pale white skin:1.3), fair complexion, nude, (large round perky breasts:1.3), full firm breasts, slim waist, (hourglass figure:1.2), (round firm butt:1.3), perky butt, wide hips, toned flat stomach, long slender legs, full body shot, standing, <random:front view, looking at camera|back view, looking back over shoulder|back view, from behind|three-quarter view from behind, looking at camera>, plain grey studio background, natural body proportions, raw photo, shot on Canon EOS R5, 85mm f/1.8, soft diffused daylight, high key lighting, natural matte skin texture, visible pores, peach fuzz, subtle skin imperfections, fine film grain
```
Para cambiar la escena o la pose se reemplaza solo `standing, <random:...>` y `plain grey studio background`.
La piel y el cuerpo van siempre delante: lo primero del prompt es lo que más pesa.

## Negativo
```
(tan, tanned skin, dark skin, olive skin, bronze skin:1.3), warm color cast, (small breasts, flat chest, saggy breasts, droopy breasts:1.2), (flat butt, saggy butt:1.2), uneven breasts, chubby, twisted torso, extra limbs, airbrushed, plastic skin, smooth skin, oily skin, shiny skin, glossy skin, beauty filter, CGI, 3d render, doll, HDR, overexposed
```

## Siguiente paso: LoRA v3
Hoy la cara nueva sale del prompt más el IP-Adapter, encima de una LoRA entrenada con la cara vieja.
Para que salga sola y siempre igual (también en video) hay que entrenar `camila_v3` con fotos del look nuevo:
unas 30 de cuerpo y 15 primeros planos generados con esta receta y elegidos a mano, con el mismo método que la ronda 2.
