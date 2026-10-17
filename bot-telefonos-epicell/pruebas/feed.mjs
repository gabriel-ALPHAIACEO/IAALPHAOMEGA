import { codigoDePublicacion, buscarEnNuestroFeed } from "./.stub/publicacion.js";
import { leerMensaje } from "./.stub/instagram.js";

let fallos = 0;
const comprobar = (n, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};

// El código dentro del enlace
comprobar("post", codigoDePublicacion("https://www.instagram.com/p/DAbC-1_x/"), "DAbC-1_x");
comprobar("reel", codigoDePublicacion("https://instagram.com/reel/XYZ123?igsh=abc"), "XYZ123");
comprobar("perfil no tiene código", codigoDePublicacion("https://www.instagram.com/epiccell.vzla/"), "");
comprobar("otra web tampoco", codigoDePublicacion("https://epiccell.com/p/1"), "");

// La API, con respuestas de mentira
const feed = {
  data: [
    { id: "1", permalink: "https://www.instagram.com/p/OTRA/", caption: "iPhone 14", media_type: "IMAGE", media_url: "https://cdn/1.jpg" },
    { id: "2", permalink: "https://www.instagram.com/reel/POCOM8/", caption: "🔥 POCO M8 PRO 8GB/256GB disponible", media_type: "VIDEO", media_url: "https://cdn/2.mp4", thumbnail_url: "https://cdn/2.jpg" },
  ],
};

let llamadas = 0;
globalThis.fetch = async () => { llamadas++; return { ok: true, json: async () => feed }; };

const reel = await buscarEnNuestroFeed({ IG_TOKEN: "x" }, "https://www.instagram.com/reel/POCOM8/?igsh=1");
comprobar("encuentra la publicación por su código", reel?.titulo, "🔥 POCO M8 PRO 8GB/256GB disponible");
comprobar("de un vídeo se queda con la miniatura", reel?.imagen, "https://cdn/2.jpg");

const otra = await buscarEnNuestroFeed({ IG_TOKEN: "x" }, "https://www.instagram.com/p/OTRA/");
comprobar("y con la imagen cuando es foto", otra?.imagen, "https://cdn/1.jpg");

const antes = llamadas;
await buscarEnNuestroFeed({ IG_TOKEN: "x" }, "https://www.instagram.com/p/OTRA/");
comprobar("el feed queda en memoria (no vuelve a pedirlo)", llamadas, antes);

comprobar("una publicación que no es nuestra", await buscarEnNuestroFeed({ IG_TOKEN: "x" }, "https://www.instagram.com/p/DEOTRO/"), null);
comprobar("sin token no lo intenta", await buscarEnNuestroFeed({}, "https://www.instagram.com/p/OTRA/"), null);

// Si la API falla, no revienta: se sigue por el otro camino
globalThis.fetch = async () => { throw new Error("sin red"); };
const { buscarEnNuestroFeed: otraVez } = await import("./.stub/publicacion.js?nuevo=1");
comprobar("si la API falla, devuelve null y sigue", await otraVez({ IG_TOKEN: "x" }, "https://www.instagram.com/p/LOQUESEA/"), null);

// El registro nuevo de adjuntos no rompe la lectura del mensaje
const m = leerMensaje({ entry: [{ messaging: [{ sender: { id: "1" }, message: { mid: "a", attachments: [{ type: "share", payload: { url: "https://www.instagram.com/p/ABC/" } }] } }] }] });
comprobar("un share con permalink va como enlace", m.publicacion.enlace, "https://www.instagram.com/p/ABC/");
comprobar("y se atiende como publicación", m.tipo, "publicacion");

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
