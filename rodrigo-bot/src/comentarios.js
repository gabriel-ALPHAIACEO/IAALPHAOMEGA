// LOS COMENTARIOS DE LAS PUBLICACIONES, EN EL EMPERADOR (12-oct-2026).
//
// Pedido del dueño: "que la IA responda todos los comentarios". Hasta hoy
// los comentarios llegaban al webhook como "changes" y se tiraban. Es lo más
// visible que hay: lo ve todo el que entra a la publicación, y uno sin
// responder le dice a cada persona que aquí no contestan.
//
// QUÉ HACE AHORA. Por cada comentario:
//   · EN PÚBLICO, una respuesta corta escrita por la IA, a lo que dijo esa
//     persona (gracias, una pregunta contestada, un "ya te escribimos").
//   · POR PRIVADO, solo si la persona muestra interés de compra (precio,
//     talla, disponibilidad, "lo quiero"): Meta deja mandar UN mensaje por
//     comentario, y ahí van el saludo y los productos con su precio, que
//     los arma el código con el catálogo (la IA no inventa precios).
//
// Este archivo solo LEE el comentario y reconoce los NUESTROS. Contestar
// está en index.js (atenderComentario) y la IA en ia.js.

const CAMPOS = new Set(["comments", "live_comments"]);

// Meta junta varios comentarios en un solo aviso: se leen todos.
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

function deUnCambio(entrada, cambio) {
  if (!cambio || !CAMPOS.has(String(cambio.field || "").toLowerCase())) return null;
  const valor = cambio.value || {};
  const id = String(valor.id || "").trim();
  if (!id) return null;
  // Un comentario borrado llega con "verb": "remove": no hay nada que contestar.
  if (String(valor.verb || "").toLowerCase() === "remove") return null;
  return {
    tipo: "comentario",
    id,
    texto: String(valor.text || "").trim(),
    de: String(valor.from?.id || "").trim(),
    usuario: String(valor.from?.username || "").trim(),
    // La publicación donde comentó: de ahí sale de qué producto habla.
    media: String(valor.media?.id || "").trim(),
    // Si es respuesta a otro comentario, el del padre.
    padre: String(valor.parent_id || "").trim(),
    // El id de la cuenta que recibió el evento: la nuestra.
    cuenta: String(entrada.id || "").trim(),
  };
}

// ¿Es un comentario NUESTRO? Si no se comprueba, el bot se responde a sí
// mismo: su respuesta pública genera otro webhook, y otro, y otro. Se mira
// contra el id y el usuario de la cuenta. Además, cada respuesta que
// publicamos se anota por su id (ver atenderComentario), así que aunque el
// token no deje preguntar quiénes somos, el eco de la nuestra se descarta.
export function esNuestro(comentario, yo) {
  if (!comentario) return false;
  if (!comentario.de) return false;
  if (comentario.de === comentario.cuenta) return true;
  if (yo?.id && comentario.de === yo.id) return true;
  if (yo?.usuario && comentario.usuario && comentario.usuario.toLowerCase() === yo.usuario.toLowerCase()) return true;
  return false;
}

// Qué se hace con los comentarios (wrangler.toml, COMENTARIOS):
//   "todo"     responde en público Y abre el privado cuando hay interés  <- por defecto
//   "privado"  solo el privado
//   "publico"  solo la respuesta pública
//   "off"      no toca los comentarios
export function modoComentarios(env) {
  const puesto = String(env?.COMENTARIOS || "todo").trim().toLowerCase();
  return ["todo", "privado", "publico", "off"].includes(puesto) ? puesto : "todo";
}

// El saludo del privado si la IA no escribió uno.
export function saludoPrivado(usuario, hayProductos) {
  const quien = usuario ? ` @${usuario}` : "";
  return hayProductos
    ? `¡Hola${quien}! 😊 Vi tu comentario en la publicación, te paso la info 👇`
    : `¡Hola${quien}! 😊 Vi tu comentario en la publicación. ¿Cuál de los productos que salen ahí te interesa? Así te paso el precio`;
}

// Una línea por producto, con su precio tal cual lo tiene el catálogo.
export function conLosPrecios(saludo, productos, { maximo = 5 } = {}) {
  const lineas = (productos || []).slice(0, maximo).map((p) => `🔹 ${p.titulo}${p.precio ? ` — ${p.precio}` : ""}`);
  const faltan = (productos || []).length - lineas.length;
  if (faltan > 0) lineas.push(`…y ${faltan} más`);
  return lineas.length ? `${saludo}\n\n${lineas.join("\n")}\n\n¿Quieres ver las fotos? Escríbeme por aquí 😊`.slice(0, 1000) : saludo;
}
