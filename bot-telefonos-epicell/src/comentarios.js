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

// META LOS MANDA EN LOTES, Y ANTES SOLO SE LEÍA EL PRIMERO.
//
// El webhook trae "entry" como lista y, dentro de cada uno, "changes"
// también. Cuando la cuenta recibe varios comentarios en el mismo segundo
// —lo normal al publicar algo que gusta— Meta los junta en un solo aviso.
// Leyendo entry[0].changes[0] se contestaba a uno y los demás se tiraban
// a la basura, sin que nada quedara registrado: clientes preguntando
// debajo de la publicación y nadie contestándoles.
export function leerComentarios(cuerpo) {
  const todos = [];

  for (const entrada of cuerpo?.entry || []) {
    for (const cambio of entrada?.changes || []) {
      const uno = deUnCambio(entrada, cambio);
      if (uno) todos.push(uno);
    }
  }

  return todos;
}

// El primero, para quien solo espera uno.
export function leerComentario(cuerpo) {
  return leerComentarios(cuerpo)[0] || null;
}

// De lo que manda Meta a lo que nos hace falta. Devuelve null para todo lo
// que no sea un comentario de una persona.
function deUnCambio(entrada, cambio) {
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
  if (!comentario) return false;

  // LA RED QUE NO DEPENDE DE NADA (25-sep-2026).
  //
  // Las tres comprobaciones de abajo necesitan un id: el de la cuenta que
  // manda Meta, o el que devuelve quienSoy. Si el token no tiene permiso
  // para preguntar quiénes somos —pasa cuando falta un permiso— y el id
  // del evento no cuadra con el del autor, no queda ninguna, y entonces el
  // bot contesta a su propia respuesta pública: eso genera otro webhook,
  // que genera otra respuesta, y así hasta que alguien lo ve. Un bucle
  // así, en público y debajo de una publicación, se cobra la cuenta.
  //
  // Nuestras respuestas públicas son cuatro frases fijas, escritas por
  // nosotros. Reconocerlas no cuesta una llamada ni depende de un permiso.
  if (esFraseNuestra(comentario.texto)) return true;

  if (!comentario.de) return false;
  if (comentario.de === comentario.cuenta) return true;
  if (yo?.id && comentario.de === yo.id) return true;
  if (yo?.usuario && comentario.usuario && comentario.usuario.toLowerCase() === yo.usuario.toLowerCase())
    return true;
  return false;
}

// Sin tildes, sin signos y sin emojis, que es como se compara una frase
// escrita por nosotros con la que vuelve en el webhook.
function pelada(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function esFraseNuestra(texto) {
  const dicho = pelada(texto);
  if (!dicho) return false;
  return NUESTRAS.some((frase) => frase && frase === dicho);
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

// Y si un asesor ya está hablando con esa persona por privado, no se le
// dice "te respondimos al DM" —no le llegó nada nuevo— ni se le pide que
// escriba, porque ya escribió. Se le dice lo que es verdad.
export function respuestaPublicaYaAtendido() {
  return "¡Ya te estamos atendiendo por privado! 📩";
}

// Todas las frases que salen de aquí, para reconocerlas si vuelven como
// comentario (ver esNuestro).
const NUESTRAS = [...EN_PUBLICO, respuestaPublicaSinPrivado(), respuestaPublicaYaAtendido()].map(
  (frase) => pelada(frase)
);

/* ── Qué se contesta por privado ──────────────────────────────────── */

// EL PRIVADO NOMBRA LA PUBLICACIÓN, Y EL EQUIPO.
//
// Es lo que hace que el cliente sepa, en la primera línea, que le están
// contestando LO SUYO y no un mensaje automático cualquiera. Y si no se
// supo de qué equipo hablaba, se le pregunta por los de ESA publicación —
// nunca se le ofrece otra cosa.
export function saludoPrivado(usuario, producto) {
  const quien = usuario ? ` @${usuario}` : "";

  if (producto) {
    return `¡Hola${quien}! 😊 Vi tu comentario en la publicación del ${producto}, te paso la info 👇`;
  }

  return (
    `¡Hola${quien}! 😊 Vi tu comentario en la publicación. ` +
    "¿Cuál de los equipos que salen ahí te interesa? Así te paso el precio"
  );
}
