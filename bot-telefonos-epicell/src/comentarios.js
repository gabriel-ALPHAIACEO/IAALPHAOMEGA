// LOS COMENTARIOS DE LAS PUBLICACIONES.
//
// Hasta hoy el bot los tiraba a la basura: en instagram.js, todo lo que
// llegaba como "changes" se descartaba con un "es un comentario, no es
// asunto nuestro". Y sí lo es — es de lo más caliente que hay:
//
//   · El que comenta "precio?" debajo de una foto ya vio el equipo y lo
//     quiere. No hay que identificar nada: la publicación dice cuál es.
//   · Lo ve TODO EL MUNDO. Un comentario sin responder, con el "precio?"
//     colgando, le dice a cada persona que entra al perfil que aquí no
//     contestan.
//   · Y se puede pasar a privado. Meta deja mandar UN mensaje directo por
//     comentario, aunque esa persona nunca te haya escrito. Es la única
//     forma de abrir una conversación con alguien que solo comentó — lo
//     que hacía ManyChat, y lo que más clientes trae.
//
// Así que la respuesta va por los dos lados: una línea corta en público,
// para que se vea que se atiende, y la respuesta de verdad por privado,
// con las fichas y el precio.

// Qué campos del webhook son comentarios. "live_comments" son los de una
// transmisión en vivo: mismo formato, misma respuesta.
const CAMPOS = new Set(["comments", "live_comments"]);

// De lo que manda Meta a lo que nos hace falta. Devuelve null para todo lo
// que no sea un comentario de una persona.
export function leerComentario(cuerpo) {
  const entrada = cuerpo?.entry?.[0];
  const cambio = entrada?.changes?.[0];
  if (!cambio || !CAMPOS.has(String(cambio.field || "").toLowerCase())) return null;

  const valor = cambio.value || {};
  const id = String(valor.id || "").trim();
  if (!id) return null;

  // Un comentario borrado llega con "verb": "remove". No hay nada que
  // contestar y responder ahí sería hablarle a un hueco.
  if (String(valor.verb || "").toLowerCase() === "remove") return null;

  return {
    tipo: "comentario",
    id,
    texto: String(valor.text || "").trim(),
    de: String(valor.from?.id || "").trim(),
    usuario: String(valor.from?.username || "").trim(),
    // La publicación donde comentó: de ahí sale QUÉ equipo es, sin
    // preguntarle nada.
    media: String(valor.media?.id || "").trim(),
    // Si es respuesta a otro comentario, el del padre. Se usa para no
    // contestar a nuestras propias respuestas.
    padre: String(valor.parent_id || "").trim(),
    // El id de la cuenta que recibió el evento: la nuestra.
    cuenta: String(entrada.id || "").trim(),
  };
}

// ¿Es un comentario NUESTRO? Si no se comprueba, el bot se responde a sí
// mismo: su respuesta pública genera otro webhook, y otro, y otro.
//
// Se mira contra el id y el usuario de la propia cuenta (quienSoy), y
// contra el id de la cuenta que viene en el evento. Cualquiera de los tres
// que coincida, es nuestro.
export function esNuestro(comentario, yo) {
  if (!comentario?.de) return false;
  if (comentario.de === comentario.cuenta) return true;
  if (yo?.id && comentario.de === yo.id) return true;
  if (yo?.usuario && comentario.usuario && comentario.usuario.toLowerCase() === yo.usuario.toLowerCase())
    return true;
  return false;
}

/* ── Qué se contesta en público ───────────────────────────────────
   Una línea. Ni el precio ni el modelo: eso va por privado, que es donde
   se vende y donde el cliente puede seguir preguntando. En público solo
   tiene que verse que aquí se atiende, y que el otro sepa que le llegó
   algo.
   ───────────────────────────────────────────────────────────────── */
const EN_PUBLICO = [
  "¡Respondido al DM! 📩",
  "¡Te respondimos al DM! 📩",
  "Respondido al DM 📩 Revisa tu bandeja 😊",
  "¡Listo! Te respondimos al DM 📩",
];

export function respuestaPublica() {
  return EN_PUBLICO[Math.floor(Math.random() * EN_PUBLICO.length)];
}

// Y si no se puede abrir el privado (le tiene los mensajes cerrados a
// desconocidos, o Meta rechaza el envío), al menos no se le deja
// colgado: se le contesta en público que escriba él.
export function respuestaPublicaSinPrivado() {
  return "¡Hola! 😊 Escríbenos por privado y te pasamos toda la info 📩";
}

/* ── Qué se contesta por privado ──────────────────────────────────── */

export function saludoPrivado(usuario, producto) {
  const quien = usuario ? `@${usuario}` : "";

  if (producto) {
    return `¡Hola${quien ? " " + quien : ""}! 😊 Vi tu comentario en la publicación, te paso la info 👇`;
  }

  return (
    `¡Hola${quien ? " " + quien : ""}! 😊 Vi tu comentario en la publicación. ` +
    "¿Cuál de los equipos te interesa? Así te paso el precio"
  );
}
