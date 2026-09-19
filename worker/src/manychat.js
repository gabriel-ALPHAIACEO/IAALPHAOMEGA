// Respuestas con el formato de Contenido Dinámico v2 de ManyChat.
// Es el modo "entrelazado": ManyChat es el canal, el Worker es el cerebro.

export function respuestaManyChat({
  respuesta,
  productos = [],
  historial = "",
  escalada = false,
  // Un saludo no lleva botón: el cliente acaba de decir "hola", todavía no
  // ha pedido nada. Ponerle "Ver catálogo" ahí suena a vendedor con prisa.
  conBoton = true,
  urlCatalogo,
  // Número de WhatsApp de la tienda, para el botón "Comprar" de cada ficha.
  // Si no está puesto, la ficha sale solo con "Ver producto".
  whatsapp = "",
}) {
  const messages = [];

  if (productos.length) {
    messages.push({ type: "text", text: respuesta });
    messages.push({
      type: "cards",
      elements: productos.slice(0, 10).map((p) => ficha(p, whatsapp)),
      image_aspect_ratio: "horizontal",
    });
  } else {
    // Sin fichas que mostrar, el mensaje lleva el botón al catálogo.
    const mensaje = { type: "text", text: respuesta };
    if (conBoton && urlCatalogo) {
      mensaje.buttons = [{ type: "url", caption: "Ver catálogo", url: urlCatalogo }];
    }
    messages.push(mensaje);
  }

  return {
    version: "v2",
    content: {
      type: "instagram",
      messages,
      // Los tres campos que antes escribía Make. El de origen_historia se
      // vacía siempre, para que no se quede pegado al mensaje siguiente.
      // Los nombres van EXACTAMENTE como están creados en ManyChat, que
      // distingue mayúsculas: con "Historial" la escritura falla en silencio,
      // el campo se queda vacío y el bot vuelve a saludar en cada mensaje.
      actions: [
        campo("historial", historial),
        campo("aviso_asesor", escalada ? "SI" : ""),
        campo("origen_historia", ""),
      ],
    },
  };
}

// ManyChat rechaza un set_field_value con valor vacío; para dejar un campo en
// blanco hay que pedirle expresamente que lo borre.
function campo(nombre, valor) {
  return valor
    ? { action: "set_field_value", field_name: nombre, value: valor }
    : { action: "unset_field_value", field_name: nombre };
}

function ficha(producto, whatsapp) {
  const elemento = {
    title: recortar(producto.titulo, 80),
    subtitle: producto.precio || "",
    image_url: producto.imagen || "",
  };

  const botones = [];
  if (producto.url) {
    botones.push({ type: "url", caption: "Ver producto", url: producto.url });
  }
  // Debajo, el atajo para comprar: abre WhatsApp con el mensaje ya escrito,
  // así el asesor sabe de qué producto le hablan sin tener que preguntar.
  const comprar = enlaceWhatsapp(whatsapp, producto.titulo);
  if (comprar) {
    botones.push({ type: "url", caption: "Comprar", url: comprar });
  }

  // Una lista de botones vacía es un valor inválido para ManyChat: si no hay
  // ninguno, la ficha va sin la clave.
  if (botones.length) elemento.buttons = botones;

  return elemento;
}

// El enlace de WhatsApp con el mensaje ya escrito. El número va en formato
// internacional y SIN el +, sin espacios y sin guiones: 584121234567. Aquí se
// limpia por si en wrangler.toml quedó escrito "+58 412-123 45 67".
function enlaceWhatsapp(numero, titulo) {
  const limpio = String(numero || "").replace(/\D/g, "");
  if (!limpio) return "";

  const mensaje = `Hola, me interesa ${recortar(titulo, 80)} 😊`;
  return `https://wa.me/${limpio}?text=${encodeURIComponent(mensaje)}`;
}

function recortar(texto, limite) {
  const limpio = String(texto || "");
  return limpio.length > limite ? limpio.slice(0, limite - 1) + "…" : limpio;
}
