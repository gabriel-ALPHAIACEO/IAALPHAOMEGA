// Worker "memoria": guarda en D1 + R2 las modelos generadas por IA, sus
// LoRA y todo lo que se genera con ellas. Quien genera las imagenes lo dice
// GENERADOR en wrangler.toml: "local" (tu SwarmUI, con los modelos y LoRA
// que ya tienes, via puente/puente_swarm.py) o "fal" (GPU en la nube).
//
// Rutas (todas piden "Authorization: Bearer <MEMORIA_TOKEN>" salvo las
// marcadas):
//   GET  /                         estado de la configuracion (sin token)
//   GET  /loras                    lista de LoRA
//   POST /loras                    registra o edita un LoRA (JSON)
//   PUT  /loras/<nombre>/archivo   (solo fal) sube el .safetensors al bucket
//   GET  /modelos                  lista de modelos
//   POST /modelos                  crea o edita la ficha fija de una modelo
//   POST /modelos/<nombre>/fijar   copia a la ficha la semilla de una imagen que gusto
//   POST /generar                  { modelo, escena, cantidad?, tamano?, semilla?, loras_extra? }
//   GET  /generaciones?modelo=..   historial
//   GET  /generaciones/<id>        una generacion (y si fal no aviso, le pregunta)
//   POST /trabajos/tomar           (el puente de tu equipo) siguiente trabajo
//   PUT  /trabajos/<id>/imagen/<n> (el puente) sube una imagen
//   POST /trabajos/<id>/terminar   (el puente) { semilla } o { error }
//   GET  /imagenes/<id>/<n>.jpg    la imagen guardada
//   GET  /archivo-lora/<id>        (sin token, URL firmada) fal descarga el LoRA
//   POST /fal/aviso/<id>           (sin token, URL firmada) fal avisa que termino

import { autorizado, firmaValida } from "./auth.js";
import { registrarLora, subirArchivo, listarLoras, servirArchivo } from "./loras.js";
import { registrarModelo, listarModelos } from "./modelos.js";
import { generar, recibirAviso, leerGeneracion, listarGeneraciones } from "./generaciones.js";
import { tomarTrabajo, subirImagen, terminarTrabajo } from "./trabajos.js";

const VERSION = "2026-10-08 · fichas fijas + generacion en tu SwarmUI";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const ruta = url.pathname.replace(/\/+$/, "") || "/";
    const metodo = request.method;

    try {
      if (ruta === "/" && metodo === "GET") return json(await estado(env));

      // --- Sin token: los llama fal, protegidos por firma ----------------
      let m = ruta.match(/^\/archivo-lora\/([\w-]+)$/);
      if (m && metodo === "GET") return servirArchivo(env, m[1], url);

      m = ruta.match(/^\/fal\/aviso\/([\w-]+)$/);
      if (m && metodo === "POST") {
        if (!(await firmaValida(env, `aviso:${m[1]}`, url.searchParams.get("firma")))) {
          return json({ error: "firma invalida" }, 403);
        }
        // fal quiere un 200 rapido; copiar las imagenes a R2 sigue despues.
        const cuerpo = await request.json();
        ctx.waitUntil(recibirAviso(env, m[1], cuerpo).catch((e) => console.error("Aviso de fal:", e)));
        return json({ ok: true });
      }

      // --- Con token --------------------------------------------------------
      if (!autorizado(request, env)) return json({ error: "Falta el token (Authorization: Bearer ...)" }, 401);

      if (ruta === "/loras" && metodo === "GET") return json(await listarLoras(env));
      if (ruta === "/loras" && metodo === "POST") return json(await registrarLora(env, await request.json()));

      m = ruta.match(/^\/loras\/([^/]+)\/archivo$/);
      if (m && metodo === "PUT") return json(await subirArchivo(env, decodeURIComponent(m[1]), request.body));

      if (ruta === "/modelos" && metodo === "GET") return json(await listarModelos(env));
      if (ruta === "/modelos" && metodo === "POST") return json(await registrarModelo(env, await request.json()));

      m = ruta.match(/^\/modelos\/([^/]+)\/fijar$/);
      if (m && metodo === "POST") {
        const { generacion } = await request.json();
        const g = await leerGeneracion(env, String(generacion || ""));
        if (!g || g.semilla == null) return json({ error: "Esa generacion no existe o no termino" }, 400);
        return json(await registrarModelo(env, { nombre: decodeURIComponent(m[1]), semilla: g.semilla }));
      }

      if (ruta === "/generar" && metodo === "POST") {
        return json(await generar(env, url.origin, await request.json()), 202);
      }
      if (ruta === "/generaciones" && metodo === "GET") {
        return json(await listarGeneraciones(env, {
          modelo: url.searchParams.get("modelo"),
          limite: url.searchParams.get("limite"),
        }));
      }
      m = ruta.match(/^\/generaciones\/([\w-]+)$/);
      if (m && metodo === "GET") {
        const g = await leerGeneracion(env, m[1]);
        return g ? json(g) : json({ error: "No existe" }, 404);
      }

      if (ruta === "/trabajos/tomar" && metodo === "POST") return json(await tomarTrabajo(env));
      m = ruta.match(/^\/trabajos\/([\w-]+)\/imagen\/(\d+)$/);
      if (m && metodo === "PUT") return json(await subirImagen(env, m[1], Number(m[2]), request));
      m = ruta.match(/^\/trabajos\/([\w-]+)\/terminar$/);
      if (m && metodo === "POST") return json(await terminarTrabajo(env, m[1], await request.json()));

      m = ruta.match(/^\/imagenes\/[\w-]+\/\d+\.(jpg|png)$/);
      if (m && metodo === "GET") {
        const objeto = await env.ARCHIVOS.get(ruta.slice(1));
        if (!objeto) return json({ error: "No existe" }, 404);
        return new Response(objeto.body, {
          headers: { "Content-Type": objeto.httpMetadata?.contentType || "image/jpeg" },
        });
      }

      return json({ error: "Ruta desconocida" }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: e.message }, 400);
    }
  },
};

async function estado(env) {
  let db = "FALTA";
  try {
    await env.DB.prepare("SELECT 1 FROM modelos LIMIT 1").first();
    db = "conectada";
  } catch (e) {
    db = `FALTA (${e.message}) — corre la migracion`;
  }
  return {
    version: VERSION,
    db,
    bucket: env.ARCHIVOS ? "conectado" : "FALTA",
    MEMORIA_TOKEN: env.MEMORIA_TOKEN ? "ok" : "FALTA",
    generador: env.GENERADOR === "fal" ? "fal" : "local",
    ...(env.GENERADOR === "fal"
      ? { FAL_KEY: env.FAL_KEY ? "ok" : "FALTA", modelo_fal: env.FAL_MODELO }
      : { en_cola: await enCola(env) }),
  };
}

// Si esto crece y no baja, el puente de tu equipo no esta corriendo.
async function enCola(env) {
  try {
    const fila = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM generaciones WHERE generador = 'local' AND estado IN ('pendiente', 'tomado')",
    ).first();
    return fila.n;
  } catch {
    return "?";
  }
}

function json(datos, status = 200) {
  return new Response(JSON.stringify(datos, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
