// Dos cerrojos distintos, los dos con la misma clave (MEMORIA_TOKEN):
//
// 1. Quien llama a la API (tus agentes, scripts, n8n) manda
//    "Authorization: Bearer <MEMORIA_TOKEN>".
// 2. Quien NO puede mandar cabeceras (fal descargando un LoRA, fal
//    avisando que termino) recibe una URL firmada: la firma es un HMAC de
//    lo que la URL autoriza, asi que no sirve para nada mas.

const codificador = new TextEncoder();

export function autorizado(request, env) {
  const cabecera = request.headers.get("Authorization") || "";
  const token = cabecera.startsWith("Bearer ") ? cabecera.slice(7) : "";
  return Boolean(env.MEMORIA_TOKEN) && iguales(token, env.MEMORIA_TOKEN);
}

export async function firmar(env, texto) {
  const clave = await crypto.subtle.importKey(
    "raw",
    codificador.encode(env.MEMORIA_TOKEN),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const firma = await crypto.subtle.sign("HMAC", clave, codificador.encode(texto));
  return [...new Uint8Array(firma)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function firmaValida(env, texto, firma) {
  if (!env.MEMORIA_TOKEN || !firma) return false;
  return iguales(await firmar(env, texto), firma);
}

// Comparacion en tiempo constante: no corta en el primer caracter distinto,
// para que el tiempo de respuesta no delate cuanto de la clave se acerto.
function iguales(a, b) {
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferencia === 0;
}
