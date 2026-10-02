// LAS DOS PÁGINAS QUE META EXIGE PARA PUBLICAR LA APP (2-oct-2026).
//
// QUÉ PASÓ. El bot de El Emperador no recibía ni un mensaje de Instagram:
// la app de Meta estaba sin publicar, y Meta lo dice claro en el panel —
// "Para recibir webhooks, tu aplicación debe tener el estado publicada"—.
// Para publicarla, Meta pide la URL de una POLÍTICA DE PRIVACIDAD y la de
// unas INSTRUCCIONES PARA ELIMINAR LOS DATOS. La tienda no tenía ninguna,
// así que las sirve el propio Worker:
//
//   https://<worker>/privacidad
//   https://<worker>/eliminar-datos
//
// Dicen la verdad sobre lo que hace ESTE bot y nada más: qué guarda (el
// nombre y el usuario de Instagram, los mensajes y fotos que manda el
// cliente, un resumen de la conversación), para qué, quién lo procesa
// (Meta, Cloudflare, el proveedor de IA), y cómo pedir que se borre. El
// contacto es el WhatsApp de wrangler.toml. No inventan razón social, RIF
// ni dirección: eso no está en ningún sitio del bot.

const FECHA = "2 de octubre de 2026";

function proveedorIA(env) {
  const p = String(env.PROVEEDOR || "deepseek").toLowerCase();
  return p === "openai" ? "OpenAI" : "DeepSeek";
}

function whatsapp(env) {
  const numero = String(env.WHATSAPP || "").replace(/\D/g, "");
  return numero ? { texto: `+${numero}`, enlace: `https://wa.me/${numero}` } : null;
}

function pagina(titulo, cuerpo) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titulo} · El Emperador</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:760px;margin:0 auto;padding:24px 16px;line-height:1.6;color:#1d1d1f;background:#fff}
  h1{font-size:1.6rem;margin-bottom:.2rem} h2{font-size:1.15rem;margin-top:1.8rem}
  .fecha{color:#666;margin-top:0} a{color:#0a58ca} li{margin:.3rem 0}
</style></head><body>
<h1>${titulo}</h1>
<p class="fecha">El Emperador · última actualización: ${FECHA}</p>
${cuerpo}
</body></html>`;
}

function contacto(env) {
  const w = whatsapp(env);
  return w
    ? `por mensaje directo a nuestra cuenta de Instagram, o por WhatsApp al <a href="${w.enlace}">${w.texto}</a>`
    : "por mensaje directo a nuestra cuenta de Instagram";
}

export function paginaDePrivacidad(env = {}) {
  const ia = proveedorIA(env);
  return pagina(
    "Política de privacidad",
    `
<p>Esta política explica qué datos trata el asistente virtual de <strong>El Emperador</strong> cuando nos escribes por mensaje directo de Instagram, y para qué.</p>

<h2>Qué datos tratamos</h2>
<ul>
  <li>Tu nombre y tu usuario de Instagram, tal como Instagram nos los muestra.</li>
  <li>Los mensajes, las fotos y las respuestas a historias que nos envías.</li>
  <li>Un resumen breve de la conversación (qué productos preguntaste) y los productos que te mostramos, para no repetirte lo mismo.</li>
</ul>
<p>No te pedimos ni guardamos datos bancarios, contraseñas ni documentos de identidad. El asistente no solicita datos de pago: esos los gestiona una persona de la tienda cuando cierras una compra.</p>

<h2>Para qué los usamos</h2>
<ul>
  <li>Responder tus preguntas sobre productos, precios, horario y formas de pago.</li>
  <li>Mostrarte los productos del catálogo que coinciden con lo que buscas, incluida la comparación de la foto que nos mandas con las fotos del catálogo.</li>
  <li>Pasarle tu conversación a un asesor de la tienda cuando hace falta una persona.</li>
</ul>
<p>No usamos tus datos para publicidad ni los vendemos a nadie.</p>

<h2>Quién más los procesa</h2>
<ul>
  <li><strong>Meta (Instagram)</strong>, que es por donde nos llegan y salen los mensajes.</li>
  <li><strong>Cloudflare</strong>, donde funciona el asistente y se guarda la conversación.</li>
  <li><strong>${ia}</strong>, el servicio de inteligencia artificial que redacta las respuestas y analiza las fotos que nos envías.</li>
</ul>

<h2>Cuánto tiempo los guardamos</h2>
<p>Mientras la conversación siga activa y lo necesitemos para atenderte. Puedes pedir que los borremos en cualquier momento.</p>

<h2>Tus derechos y cómo borrar tus datos</h2>
<p>Puedes pedir ver, corregir o eliminar tus datos ${contacto(env)}. Las instrucciones están en <a href="/eliminar-datos">Eliminación de datos</a>.</p>

<h2>Contacto</h2>
<p>Para cualquier duda sobre esta política, escríbenos ${contacto(env)}.</p>
`
  );
}

export function paginaDeEliminacion(env = {}) {
  return pagina(
    "Eliminación de datos",
    `
<p>Si nos escribiste por Instagram y quieres que borremos los datos que guarda nuestro asistente virtual (tu nombre y usuario, el resumen de la conversación y los productos que te mostramos), sigue estos pasos:</p>
<ol>
  <li>Escríbenos ${contacto(env)} con el mensaje <strong>"Quiero eliminar mis datos"</strong>.</li>
  <li>Si nos escribes por WhatsApp, indícanos tu usuario de Instagram para encontrar la conversación.</li>
  <li>Borramos tus datos en un plazo máximo de 30 días y te confirmamos por el mismo medio.</li>
</ol>
<p>Los mensajes que quedan en tu propia bandeja de Instagram los gestiona Instagram; puedes borrarlos desde la app.</p>
<p>Más información en nuestra <a href="/privacidad">Política de privacidad</a>.</p>
`
  );
}

export function html200(cuerpo) {
  return new Response(cuerpo, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}
