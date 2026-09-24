// Traer la imagen al Worker antes de enseñársela al modelo.
//
// EL PROBLEMA: a OpenAI se le puede pasar la URL de una imagen y él la
// descarga. Pero las fotos de Instagram están en un CDN protegido que
// responde 403 a cualquiera que Meta no reconozca, y los servidores de
// OpenAI no lo son. El resultado es este error:
//
//   "Error while downloading file. Upstream status code: 403."
//   "code": "invalid_image_url"
//
// LA SOLUCIÓN: la descarga la hace el Worker, que sí puede autenticarse, y
// la imagen viaja dentro de la propia petición a OpenAI como data URI. Una
// descarga más por foto, y a cambio deja de depender de si un tercero puede
// o no abrir un enlace privado.

// OpenAI admite hasta 20 MB. Se corta antes, porque una foto de Instagram
// que pese más que esto es que no es una foto.
const MAXIMO_MB = 15;

// Devuelve { uri, motivo }. El motivo importa: un vídeo NO es una avería,
// es lo normal en las historias, y el cliente tiene que recibir una pregunta
// de vendedora, no un "se me trabó el sistema".
//
//   ""          todo bien, en uri está la imagen
//   "video"     la historia es un vídeo: no se puede mirar, pero se atiende
//   "caducada"  el enlace ya no sirve
//   "otro"      cualquier otra cosa
export async function comoDataUri(env, url) {
  const enlace = String(url || "").trim();

  // Si ya viene en data URI, no hay nada que traer. Va primero: un data URI
  // no empieza por http y la comprobación de abajo lo descartaría.
  if (/^data:image\//i.test(enlace)) return { uri: enlace, motivo: "" };

  if (!/^https?:\/\//i.test(enlace)) return { uri: "", motivo: "otro" };

  let respuesta = await traer(enlace);

  // Algunos enlaces del CDN de Meta solo se sirven con el token. Se prueba
  // primero sin él, porque los de las historias suelen ir firmados y no
  // hace falta gastar el token en cada foto.
  if (respuesta && respuesta.status === 403 && env.IG_TOKEN) {
    console.log("La imagen dio 403: reintento con el token de Instagram");
    respuesta = await traer(enlace, env.IG_TOKEN);
  }

  if (!respuesta) return { uri: "", motivo: "otro" };

  if (!respuesta.ok) {
    console.error(
      `No pude descargar la imagen: ${respuesta.status}. ` +
        (respuesta.status === 403
          ? "El enlace está protegido o ya caducó. Los del CDN de Instagram duran horas."
          : respuesta.status === 404
            ? "El enlace ya no existe."
            : "")
    );
    return { uri: "", motivo: respuesta.status === 403 || respuesta.status === 404 ? "caducada" : "otro" };
  }

  const tipo = (respuesta.headers.get("content-type") || "").split(";")[0].trim();
  if (!tipo.startsWith("image/")) {
    // Las historias en vídeo son lo más habitual aquí. No es un fallo.
    const esVideo = tipo.startsWith("video/");
    console.log(
      esVideo
        ? "La historia es un vídeo: no puedo mirarla, sigo con el texto."
        : `Lo que descargué no es una imagen, es ${tipo || "algo sin tipo"}.`
    );
    return { uri: "", motivo: esVideo ? "video" : "otro" };
  }

  const datos = await respuesta.arrayBuffer();
  const mb = datos.byteLength / (1024 * 1024);
  if (mb > MAXIMO_MB) {
    console.error(`La imagen pesa ${mb.toFixed(1)} MB, más del límite de ${MAXIMO_MB}.`);
    return { uri: "", motivo: "otro" };
  }

  console.log(`Imagen descargada: ${tipo}, ${Math.round(datos.byteLength / 1024)} KB`);
  return { uri: `data:${tipo};base64,${aBase64(datos)}`, motivo: "" };
}

async function traer(url, token) {
  const cabeceras = {
    // Sin un agente reconocible, algunos CDN devuelven 403 aunque el enlace
    // sea correcto.
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  };
  if (token) cabeceras.authorization = `Bearer ${token}`;

  try {
    return await fetch(url, { headers: cabeceras, redirect: "follow" });
  } catch (error) {
    console.error("No se pudo conectar con el CDN de la imagen:", error.message);
    return null;
  }
}

// btoa() solo acepta texto, y pasarle un array entero de golpe revienta la
// pila con imágenes grandes. Por eso se hace a trozos.
function aBase64(datos) {
  const bytes = new Uint8Array(datos);
  const TROZO = 0x8000;
  let binario = "";

  for (let i = 0; i < bytes.length; i += TROZO) {
    binario += String.fromCharCode.apply(null, bytes.subarray(i, i + TROZO));
  }

  return btoa(binario);
}
