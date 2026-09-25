// Banco de pruebas del turno COMPLETO: la hoja de Google, Instagram y
// OpenAI simulados, y una D1 de mentira. Es lo que permite comprobar lo
// que el cliente recibe de verdad, no solo las piezas por separado.
import { atenderMeta } from "./.stub/index.js";

export const HOJA = `Nombre,Precio Divisas ($),Precio Cashea,Foto
Samsung A57,310,95,https://x/a57.jpg
Samsung A17,180,60,https://x/a17.jpg
Poco M8 pro 5G,185,62,https://x/poco.jpg
Poco X8 pro 5G,210,70,https://x/pocox8.jpg
Poco C81 pro,120,40,https://x/pococ81.jpg
Samsung Cable Tipo C 1Metro,8,,https://x/c1.jpg
Skydolphing cable 4 en 1 S40E,10,,https://x/c2.jpg`;

export function baseFalsa(filaInicial = {}) {
  const filas = new Map();
  // La tabla de comentarios ya contestados: un id solo entra una vez,
  // igual que en D1 (PRIMARY KEY).
  const comentarios = new Set();
  if (filaInicial.id) filas.set(filaInicial.id, { nombre: "", historial: "", pausado_hasta: 0, mids_enviados: "[]", ultimo_envio: 0, mostrados: "[]", ultima_respuesta: "", ultimos_productos: "[]", ultimos_textos: "[]", publicacion: "", ...filaInicial });

  const columnas = ["id","nombre","nombre_completo","usuario","historial","pausado_hasta","mids_enviados","ultimo_envio","mostrados","ultima_respuesta","ultimos_productos","ultimos_textos","publicacion"];

  return {
    filas,
    prepare(sql) {
      return {
        bind(...args) {
          const correr = async () => {
            if (/INSERT INTO comentarios/i.test(sql)) {
              if (comentarios.has(args[0])) {
                throw new Error("UNIQUE constraint failed: comentarios.id");
              }
              comentarios.add(args[0]);
              return;
            }
            if (/^SELECT \* FROM contactos/i.test(sql.trim())) return filas.get(args[0]) || null;
            if (/PRAGMA table_info/i.test(sql)) return { results: columnas.map((name) => ({ name })) };
            if (/INSERT INTO contactos/i.test(sql)) {
              const campos = sql.match(/INSERT INTO contactos \(([^)]+)\)/i)[1].split(",").map((c) => c.trim());
              const id = args[0];
              const previa = filas.get(id) || {};
              const nueva = { ...previa };
              campos.forEach((campo, i) => { nueva[campo] = args[i]; });
              filas.set(id, nueva);
              return;
            }
            if (/^UPDATE contactos/i.test(sql.trim())) {
              const id = args[args.length - 1];
              const previa = filas.get(id);
              if (previa && /pausado_hasta = 0/.test(sql)) filas.set(id, { ...previa, pausado_hasta: 0 });
              return;
            }
            return;
          };
          return { first: correr, run: correr, all: correr };
        },
        async first() { return null; },
        async all() { return { results: columnas.map((name) => ({ name })) }; },
        async run() {
          return;
        },
      };
    },
  };
}

// Devuelve todo lo que el bot mandó a Instagram en este turno.
export async function turno({ texto = "", opcion = "", fila = {}, respuestaDelModelo = {}, mensaje = {} } = {}) {
  const enviados = [];
  const DB = baseFalsa({ id: "cliente1", ...fila });

  globalThis.fetch = async (url, opciones = {}) => {
    const donde = String(url);

    if (donde.includes("docs.google.com")) return { ok: true, status: 200, text: async () => HOJA };

    if (donde.includes("api.openai.com")) {
      const cuerpo = JSON.stringify({
        respuesta: "Aquí lo tienes 👇",
        buscar: "NADA",
        historial: "Ya di la bienvenida.",
        ...respuestaDelModelo,
      });
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: cuerpo } }] }) };
    }

    if (donde.includes("graph.instagram.com")) {
      if (donde.includes("/me/messages")) {
        enviados.push(JSON.parse(opciones.body).message);
        return { ok: true, status: 200, json: async () => ({ message_id: `m${enviados.length}` }) };
      }
      return { ok: true, status: 200, json: async () => ({ name: "Perlita", username: "perlita" }) };
    }

    return { ok: false, status: 404, text: async () => "", json: async () => ({}) };
  };

  const env = {
    DB, SHEET_ID: "abc", SHEET_NOMBRE: "Hoja 1", IG_TOKEN: "t",
    OPENAI_API_KEY: "k", URL_CATALOGO: "https://CAMBIA-ESTO.com", WHATSAPP: "584121234567",
  };

  await atenderMeta(env, {
    tipo: "texto", igsid: "cliente1", mid: "in1", texto, opcion,
    foto: "", historia: { url: "", id: "" }, publicacion: { url: "", titulo: "", enlace: "" },
    ...mensaje,
  });

  return { enviados, fila: DB.filas.get("cliente1") };
}
