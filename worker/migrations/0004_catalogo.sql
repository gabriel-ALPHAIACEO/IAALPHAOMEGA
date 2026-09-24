-- EL CATALOGO DE LA TIENDA, INDEXADO DESDE SHOPIFY.
--
-- Guarda los titulos de los productos publicados para que la IA sepa que
-- existen. Antes esa lista estaba escrita a mano en src/tiendas/<tienda>.js
-- y habia que volver a pegarla cada vez que entraba mercancia; lo que
-- entraba en medio, el bot no lo ofrecia nunca porque no sabia que estaba.
--
-- NO HACE FALTA CORRER ESTA MIGRACION. src/indice.js crea la tabla solo la
-- primera vez que sincroniza (CREATE TABLE IF NOT EXISTS). Esta aqui para
-- que el esquema quede escrito junto a los demas y para quien prefiera
-- crearla a mano.
--
-- La llena el cron de wrangler.toml, o /indice?sincronizar=1 a mano.

CREATE TABLE IF NOT EXISTS catalogo (
  -- El titulo tal cual esta en Shopify. Es la clave: es lo que se le
  -- ensena al modelo y lo que la busqueda tiene que poder encontrar.
  titulo  TEXT PRIMARY KEY,

  -- Cuando se vio por primera vez. Sirve para decir que entro nuevo.
  primero INTEGER NOT NULL,

  -- Cuando se vio por ultima vez. Lo que no aparece en una pasada ya no
  -- esta publicado y se borra: asi el bot deja de ofrecer lo retirado.
  ultimo  INTEGER NOT NULL
);
