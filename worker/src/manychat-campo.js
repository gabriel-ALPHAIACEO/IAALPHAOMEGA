// Escribir un campo personalizado en un subscriber de ManyChat, vía su API.
//
// PARA QUÉ SIRVE. El bug de los dos mensajes: cuando el cliente responde a
// una historia con imagen, Meta entrega el mismo webhook a la app de
// ManyChat Y a esta app propia (la que existe solo para bajar la imagen).
// Antes, esta app propia contestaba directo por la API de Instagram —y
// ManyChat, que también recibe el evento, contestaba por su cuenta. Dos
// respuestas para un mismo mensaje.
//
// LA IDEA. Esta app deja de hablarle al cliente. En vez de eso, le pasa a
// ManyChat la URL de la imagen en un campo del subscriber (vía esta
// llamada), y es ManyChat —que YA está llevando la conversación y YA llama
// a /manychat en cada mensaje— quien la recoge y la manda como si el
// cliente la hubiera adjuntado directo. Solo contesta uno.
//
// SETUP QUE HACE FALTA EN MANYCHAT (fuera de este código):
//   1. Crear un campo personalizado de texto, por ejemplo "imagen_historia_url".
//   2. En Configuración → API, copiar el token y cargarlo aquí con:
//        npx wrangler secret put MANYCHAT_API_TOKEN
//   3. En wrangler.toml, poner el nombre EXACTO del campo (sensible a
//      mayúsculas, igual que con "historial" vs "Historial"):
//        MANYCHAT_CAMPO_IMAGEN = "imagen_historia_url"
//   4. En el flow de ManyChat, en el mismo External Request que ya llama a
//      POST /manychat, agregar ese campo como parámetro "image_url" (o
//      "img_url" / "imagen" / "foto" — son los nombres que ya reconoce
//      atenderManyChat en index.js). Ejemplo de valor a mandar:
//        {{imagen_historia_url}}
//      Un pequeño retraso (1-2s) antes de ese External Request reduce la
//      chance de que ManyChat llegue antes de que este Worker alcance a
//      escribir el campo.
//
// Si esta llamada falla (token no cargado, API caída, subscriber_id que no
// cuadra), index.js cae al camino viejo: responde él mismo por Instagram.
// Es mejor una respuesta que se pueda duplicar que ninguna respuesta.

const API = "https://api.manychat.com/fb/subscriber/setCustomFieldByName";

export async function ponerCampoManyChat(env, igsid, valor) {
  if (!env.MANYCHAT_API_TOKEN || !env.MANYCHAT_CAMPO_IMAGEN) {
    console.log(
      "Relevo a ManyChat sin configurar (falta MANYCHAT_API_TOKEN o " +
        "MANYCHAT_CAMPO_IMAGEN): no lo intento."
    );
    return false;
  }

  // ManyChat pide el subscriber_id como número. El igsid que manda Meta es
  // una cadena de dígitos; si por lo que sea no lo es, se manda tal cual y
  // que sea ManyChat quien lo rechace.
  const numerico = Number(igsid);
  const subscriberId = Number.isFinite(numerico) ? numerico : igsid;

  let respuesta;
  try {
    respuesta = await fetch(API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.MANYCHAT_API_TOKEN}`,
      },
      body: JSON.stringify({
        subscriber_id: subscriberId,
        field_name: env.MANYCHAT_CAMPO_IMAGEN,
        field_value: valor,
      }),
    });
  } catch (error) {
    console.error("No se pudo llamar a la API de ManyChat:", error.message);
    return false;
  }

  if (!respuesta.ok) {
    console.error(
      "ManyChat rechazó el campo:",
      respuesta.status,
      await respuesta.text()
    );
    return false;
  }

  return true;
}
