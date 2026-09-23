// Aviso al asesor por Slack. Si falla, no se cae nada: el cliente ya recibió
// su respuesta.
//
// La dirección del webhook va como secreto y no escrita aquí: quien la tenga
// puede publicar en tu canal, así que no conviene que viaje en un archivo.
//   npx wrangler secret put SLACK_WEBHOOK

export async function avisarAsesor(
  env,
  {
    nombre,
    nombreCompleto,
    usuario,
    igsid,
    mensaje,
    respuesta,
    motivo,
    historial,
    productos,
    historia,
    busco,
  }
) {
  if (!env.SLACK_WEBHOOK) {
    console.error("No hay SLACK_WEBHOOK cargado: el aviso no sale.");
    return "FALLO - no hay SLACK_WEBHOOK cargado en el Worker";
  }

  // El asesor entra a la conversación a media película. Todo esto es para que
  // sepa de qué se venía hablando sin tener que abrir Instagram y leer.
  const lineas = [
    `*${motivo || "El bot lo paso a un asesor"}*`,
    `*Cliente:* ${quienEs({ nombre, nombreCompleto, usuario })}`,
    // Con el @ el asesor lo encuentra en Instagram en dos toques, sin tener
    // que buscar entre todos los chats. El ID solo sale si no hay @.
    usuario ? `*Perfil:* https://instagram.com/${usuario}` : "",
    igsid && !usuario ? `*ID:* ${igsid}` : "",
    historia ? `*Viene de la historia:* ${historia}` : "",
    `*Escribió:* ${mensaje || ""}`,
    historial ? `*De qué venían hablando:* ${historial}` : "",
    busco ? `*Buscó en el catálogo:* ${busco}` : "",
    productos?.length ? `*Le mostró:* ${listar(productos)}` : "",
    `*El bot respondió:* ${respuesta || ""}`,
  ].filter(Boolean);

  try {
    const r = await fetch(env.SLACK_WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: lineas.join("\n") }),
    });

    const detalle = await r.text();

    if (r.ok) {
      console.log("Aviso enviado a Slack:", motivo || "sin motivo");
      return `OK - Slack respondio ${r.status} (${detalle})`;
    }

    // Slack contesta en texto plano: "invalid_token", "no_service", etc.
    console.error("Slack rechazo el aviso:", r.status, detalle);
    return `FALLO - Slack respondio ${r.status}\n${detalle}`;
  } catch (error) {
    console.error("No se pudo llamar a Slack:", error.message);
    return `FALLO - no se pudo llamar a Slack: ${error.message}`;
  }
}

// Los títulos con su precio, hasta tres. Más que eso llena el aviso y el
// asesor deja de leerlo.
function listar(productos) {
  const tres = productos
    .slice(0, 3)
    .map((p) => (p.precio ? `${p.titulo} (${p.precio})` : p.titulo))
    .join(" · ");
  const resto = productos.length - 3;
  return resto > 0 ? `${tres} y ${resto} más` : tres;
}

// "María José Pérez (@mariajo.p)" con lo que haya. Si Instagram no compartió
// ni nombre ni @, se dice claro para que el asesor no piense que es un fallo
// del aviso.
function quienEs({ nombre, nombreCompleto, usuario }) {
  const quien = nombreCompleto || nombre || "";
  if (quien && usuario) return `${quien} (@${usuario})`;
  if (quien) return quien;
  if (usuario) return `@${usuario}`;
  return "sin nombre (Instagram no compartió su perfil)";
}
