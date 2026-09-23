CREATE TABLE IF NOT EXISTS contactos (
  id            TEXT PRIMARY KEY,
  nombre        TEXT    DEFAULT '',
  historial     TEXT    DEFAULT '',
  pausado_hasta INTEGER DEFAULT 0,
  mids_enviados TEXT    DEFAULT '[]'
);
