-- Memoria de generacion: que LoRA hay, que modelo usa cada uno, y que se
-- genero con cada modelo.
--
-- loras.r2_key        donde esta el .safetensors dentro del bucket. Vacio
--                     si el LoRA vive afuera (url_externa).
-- loras.palabra_clave la palabra de activacion con la que se entreno. Si el
--                     prompt no la trae, se le agrega sola al generar.
-- generaciones.fal_urls JSON con status_url y response_url que devolvio fal,
--                     para consultar a mano si el aviso de fal no llega.
-- generaciones.estado pendiente | lista | error
-- generaciones.imagenes JSON con las claves en R2 de cada imagen, ya
--                     copiadas: las URL de fal caducan, las de R2 no.
CREATE TABLE IF NOT EXISTS loras (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  palabra_clave TEXT NOT NULL DEFAULT '',
  modelo_base TEXT NOT NULL DEFAULT 'flux-dev',
  escala REAL NOT NULL DEFAULT 1,
  r2_key TEXT NOT NULL DEFAULT '',
  url_externa TEXT NOT NULL DEFAULT '',
  notas TEXT NOT NULL DEFAULT '',
  creado INTEGER NOT NULL
);

-- Una "modelo" = una persona generada por IA que tiene que verse SIEMPRE
-- igual. Su identidad la sostienen dos cosas, guardadas aca:
--   1. su LoRA (lora_id), entrenado con fotos de ella: es lo que de verdad
--      fija rostro y cuerpo.
--   2. su ficha en texto (rostro, cuerpo, rasgos_fijos), que se pega a
--      TODOS los prompts, delante de la escena. Quien genera solo escribe
--      la escena ("en la playa al atardecer"); la identidad no se toca.
-- semilla   opcional. Si se fija, todas las imagenes salen de la misma
--           semilla: mas parecidas entre si, menos variedad de pose.
-- estilo    lo que va al final de cada prompt (tipo de foto, luz, camara).
CREATE TABLE IF NOT EXISTS modelos (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  lora_id TEXT NOT NULL REFERENCES loras(id),
  escala REAL NOT NULL DEFAULT 1,
  rostro TEXT NOT NULL DEFAULT '',
  cuerpo TEXT NOT NULL DEFAULT '',
  rasgos_fijos TEXT NOT NULL DEFAULT '',
  estilo TEXT NOT NULL DEFAULT '',
  semilla INTEGER,
  tamano TEXT NOT NULL DEFAULT 'portrait_4_3',
  notas TEXT NOT NULL DEFAULT '',
  creado INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS generaciones (
  id TEXT PRIMARY KEY,
  modelo_id TEXT NOT NULL REFERENCES modelos(id),
  escena TEXT NOT NULL,
  loras TEXT NOT NULL DEFAULT '[]',
  prompt TEXT NOT NULL,
  parametros TEXT NOT NULL DEFAULT '{}',
  request_id TEXT NOT NULL DEFAULT '',
  fal_urls TEXT NOT NULL DEFAULT '{}',
  estado TEXT NOT NULL DEFAULT 'pendiente',
  imagenes TEXT NOT NULL DEFAULT '[]',
  semilla INTEGER,
  error TEXT NOT NULL DEFAULT '',
  creado INTEGER NOT NULL,
  terminado INTEGER
);

CREATE INDEX IF NOT EXISTS generaciones_request ON generaciones (request_id);
CREATE INDEX IF NOT EXISTS generaciones_modelo ON generaciones (modelo_id, creado);
