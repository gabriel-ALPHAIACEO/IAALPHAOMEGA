-- Memoria de generacion: que LoRA hay, que modelo usa cada uno, y que se
-- genero con cada modelo.
--
-- loras.archivo_local nombre del LoRA tal como lo ve SwarmUI en tu equipo
--                     (carpeta ComfyUI/models/loras, sin .safetensors). Es lo
--                     que usa el generador "local": el archivo nunca sale
--                     de tu equipo.
-- loras.r2_key        solo para el generador "fal": donde esta el
--                     .safetensors dentro del bucket. Vacio si el LoRA vive
--                     afuera (url_externa).
-- loras.palabra_clave la palabra de activacion con la que se entreno. Si el
--                     prompt no la trae, se le agrega sola al generar.
-- generaciones.fal_urls JSON con status_url y response_url que devolvio fal,
--                     para consultar a mano si el aviso de fal no llega.
-- generaciones.generador local (tu SwarmUI, via puente/) | fal
-- generaciones.estado pendiente | tomado (tu equipo lo esta generando) |
--                     lista | error
-- generaciones.imagenes JSON con las claves en R2 de cada imagen, ya
--                     copiadas: las URL de fal caducan, las de R2 no.
CREATE TABLE IF NOT EXISTS loras (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  palabra_clave TEXT NOT NULL DEFAULT '',
  archivo_local TEXT NOT NULL DEFAULT '',
  modelo_base TEXT NOT NULL DEFAULT 'flux-dev',
  escala REAL NOT NULL DEFAULT 1,
  r2_key TEXT NOT NULL DEFAULT '',
  url_externa TEXT NOT NULL DEFAULT '',
  notas TEXT NOT NULL DEFAULT '',
  creado INTEGER NOT NULL
);

-- Una "modelo" = una persona generada por IA que tiene que verse SIEMPRE
-- igual. Su identidad, guardada aca, se pega a TODOS los prompts; quien
-- genera solo escribe la escena ("en la playa al atardecer"):
--   rostro, cuerpo, rasgos_fijos  la descripcion fija, delante de la escena.
--   refuerzo_rostro  el prompt del segmento de cara de SwarmUI
--                    (<segment:yolo-face...>): repinta la cara con esta
--                    descripcion despues de generar. Es lo que mas sostiene
--                    la cara cuando no hay LoRA.
--   lora_id          opcional. Un LoRA entrenado con fotos de ella es lo que
--                    de verdad fija rostro y cuerpo; sin el, la cara
--                    depende del texto y de la semilla.
--   checkpoint, pasos, cfg, ancho, alto  los mismos ajustes de SwarmUI
--                    con los que se creo, para no cambiar de "camara".
--   semilla          opcional. Si se fija, las imagenes salen mas parecidas
--                    entre si, con menos variedad de pose.
--   estilo           lo que va al final de cada prompt (tipo de foto, luz).
CREATE TABLE IF NOT EXISTS modelos (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  lora_id TEXT REFERENCES loras(id),
  escala REAL NOT NULL DEFAULT 1,
  rostro TEXT NOT NULL DEFAULT '',
  cuerpo TEXT NOT NULL DEFAULT '',
  rasgos_fijos TEXT NOT NULL DEFAULT '',
  estilo TEXT NOT NULL DEFAULT '',
  refuerzo_rostro TEXT NOT NULL DEFAULT '',
  checkpoint TEXT NOT NULL DEFAULT '',
  pasos INTEGER NOT NULL DEFAULT 40,
  cfg REAL NOT NULL DEFAULT 7,
  ancho INTEGER NOT NULL DEFAULT 1024,
  alto INTEGER NOT NULL DEFAULT 1024,
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
  generador TEXT NOT NULL DEFAULT 'local',
  tomado INTEGER,
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
CREATE INDEX IF NOT EXISTS generaciones_cola ON generaciones (generador, estado, creado);
CREATE INDEX IF NOT EXISTS generaciones_modelo ON generaciones (modelo_id, creado);
