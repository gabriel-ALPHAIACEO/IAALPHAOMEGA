-- Memoria del bot: un renglón por cliente (igsid de Instagram).
--
-- historial       lo que ya escribió el modelo antes, recortado (ver
--                 historial.js) — reemplaza lo que antes guardaba ManyChat
--                 en sus campos personalizados.
-- pausado_hasta   timestamp (ms) hasta el que el bot se calla porque un
--                 asesor humano tomó la conversación a mano. 0 = no pausado.
-- mids_enviados   JSON con los últimos message_id que mandó EL BOT. Sirve
--                 para reconocer su propio eco y no confundirlo con el de
--                 un asesor escribiendo desde la app de Instagram.
CREATE TABLE IF NOT EXISTS contactos (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL DEFAULT '',
  historial TEXT NOT NULL DEFAULT '',
  pausado_hasta INTEGER NOT NULL DEFAULT 0,
  mids_enviados TEXT NOT NULL DEFAULT '[]'
);
