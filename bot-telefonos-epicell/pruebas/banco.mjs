// Banco de pruebas del turno COMPLETO: la hoja de Google, Instagram y
// OpenAI simulados, y una D1 de mentira. Es lo que permite comprobar lo
// que el cliente recibe de verdad, no solo las piezas por separado.
import { atenderMeta } from "./.stub/index.js";
import { DatabaseSync } from "node:sqlite";

// La tabla de especificaciones va en SQLite de verdad (6-oct-2026): así el
// turno completo lee la ficha técnica igual que en D1.
function sqliteReal() {
  const db = new DatabaseSync(":memory:");
  const preparada = (sql, args = []) => ({
    bind: (...a) => preparada(sql, a),
    run: async () => db.prepare(sql).run(...args),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) ?? null,
  });
  return (sql) => preparada(sql);
}

export const HOJA = `Nombre,Precio Divisas ($),Precio Cashea,Foto
Samsung A57,310,95,https://x/a57.jpg
Samsung A17,180,60,https://x/a17.jpg
Poco M8 pro 5G,185,62,https://x/poco.jpg
Poco X8 pro 5G,210,70,https://x/pocox8.jpg
Poco C81 pro,120,40,https://x/pococ81.jpg
Samsung Cable Tipo C 1Metro,8,,https://x/c1.jpg
Skydolphing cable 4 en 1 S40E,10,,https://x/c2.jpg`;

// La hoja se cachea diez minutos por SHEET_ID (sheets.js), así que dos
// turnos seguidos con hojas distintas se pisarían: el segundo leería la del
// primero. Cada hoja que no sea la de siempre se lee con su propio id.
let hojasAparte = 0;

export function baseFalsa(filaInicial = {}) {
  const filas = new Map();
  // La tabla de comentarios ya contestados: un id solo entra una vez,
  // igual que en D1 (PRIMARY KEY).
  const comentarios = new Set();
  let especificaciones = null;
  if (filaInicial.id) filas.set(filaInicial.id, { nombre: "", historial: "", pausado_hasta: 0, mids_enviados: "[]", ultimo_envio: 0, mostrados: "[]", ultima_respuesta: "", ultimos_productos: "[]", ultimos_textos: "[]", publicacion: "", ...filaInicial });

  const columnas = ["id","nombre","nombre_completo","usuario","historial","pausado_hasta","mids_enviados","ultimo_envio","mostrados","ultima_respuesta","ultimos_productos","ultimos_textos","publicacion"];

  return {
    filas,
    batch: async (lista) => { for (const p of lista) await p.run(); },
    prepare(sql) {
      if (/\bespecificaciones\b/i.test(sql)) return (especificaciones ||= sqliteReal())(sql);
      return {
        bind(...args) {
          const correr = async () => {
            // Soltar un comentario que no se pudo contestar, para que el
            // reintento de Meta valga (ver olvidarComentario).
            if (/DELETE FROM comentarios/i.test(sql)) {
              comentarios.delete(args[0]);
              return;
            }
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
              // LA D1 DE MENTIRA TIENE QUE MENTIR BIEN.
              //
              // Antes repartía los argumentos por orden entre TODAS las
              // columnas, y eso solo funciona cuando el INSERT es "(?, ?,
              // ?)". La pausa usa "VALUES (?, '', '', ?, '[]')" con un
              // ON CONFLICT que toca UNA columna, y ahí el reparto se
              // descolocaba: el test decía que el bot no pausaba cuando sí
              // pausaba. Un banco de pruebas que miente esconde justo los
              // fallos que tiene que enseñar.
              const campos = sql.match(/INSERT INTO contactos \(([^)]+)\)/i)[1].split(",").map((c) => c.trim());
              const literales = (sql.match(/VALUES\s*\(([^)]+)\)/i)?.[1] || "").split(",").map((v) => v.trim());

              // Qué valor le toca a cada columna: los "?" se van comiendo
              // los argumentos por orden; lo demás es un literal del SQL.
              const valorDe = {};
              let siguiente = 0;
              campos.forEach((campo, i) => {
                const literal = literales[i];
                valorDe[campo] =
                  literal === "?" ? args[siguiente++] : String(literal ?? "").replace(/^'|'$/g, "");
              });

              const id = valorDe[campos[0]];
              const previa = filas.get(id);

              // Fila nueva: entra entera.
              if (!previa) {
                filas.set(id, { ...valorDe });
                return;
              }

              // Fila que ya existe: solo se tocan las columnas del
              // ON CONFLICT DO UPDATE SET, como hace D1 de verdad.
              const conflicto = sql.match(/DO UPDATE SET([\s\S]+)$/i)?.[1] || "";
              const nueva = { ...previa };

              if (!conflicto) {
                filas.set(id, { ...previa, ...valorDe });
                return;
              }

              // El SET se parte por comas, pero NO por las que van dentro de
              // un paréntesis: "COALESCE(NULLIF(x, ''), y)" es un valor
              // solo. Sin esto, el fake troceaba mal y guardaba basura en
              // las columnas que usan COALESCE — justo las que no se
              // quieren pisar cuando quien llama no las trae.
              const trozos = [];
              let nivel = 0;
              let actual = "";
              for (const letra of conflicto) {
                if (letra === "(") nivel++;
                if (letra === ")") nivel--;
                if (letra === "," && nivel === 0) {
                  trozos.push(actual);
                  actual = "";
                  continue;
                }
                actual += letra;
              }
              if (actual.trim()) trozos.push(actual);

              for (const trozo of trozos) {
                const corte = trozo.indexOf("=");
                if (corte === -1) continue;
                const col = trozo.slice(0, corte).trim().replace(/[`"]/g, "");
                const valor = trozo.slice(corte + 1).trim();
                if (!col || !valor) continue;

                // "COALESCE(NULLIF(excluded.X, ''), contactos.X)": si lo
                // que llega está vacío, se queda lo que ya había.
                const cuidado = valor.match(
                  /^COALESCE\s*\(\s*NULLIF\s*\(\s*excluded\.(\w+)\s*,\s*''\s*\)\s*,\s*contactos\.(\w+)\s*\)$/i
                );
                if (cuidado) {
                  const llega = valorDe[cuidado[1]];
                  nueva[col] = llega === "" || llega === undefined ? previa[cuidado[2]] : llega;
                  continue;
                }

                nueva[col] = /^excluded\./i.test(valor)
                  ? valorDe[valor.split(".")[1].trim()]
                  : String(valor).replace(/^'|'$/g, "");
              }

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
export async function turno({ texto = "", opcion = "", fila = {}, respuestaDelModelo = {}, mensaje = {}, hoja = HOJA, env: envExtra = {}, apis = {}, fotosRotas = null, rechazarCarrusel = false, transcripcion = null, redaccion = null, db = null } = {}) {
  const enviados = [];
  // Lo que se le mandó a OpenAI, para mirar qué sabía el modelo.
  const alModelo = [];
  // db: una D1 de verdad (SQLite) para las pruebas que la necesitan entera.
  const DB = db || baseFalsa({ id: "cliente1", ...fila });

  globalThis.fetch = async (url, opciones = {}) => {
    const donde = String(url);

    if (donde.includes("docs.google.com")) return { ok: true, status: 200, text: async () => hoja };

    // LAS NOTAS DE VOZ (2-oct-2026): el audio que se baja de Instagram y lo
    // que OpenAI "escucha". transcripcion: el texto, o null para que falle.
    if (donde.startsWith("https://cdn/nota")) {
      return { ok: true, status: 200, headers: new Headers({ "content-type": "video/mp4" }), arrayBuffer: async () => new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 77, 52, 65]).buffer };
    }
    if (donde.includes("/audio/transcriptions")) {
      return transcripcion
        ? { ok: true, status: 200, json: async () => ({ text: transcripcion }), text: async () => "" }
        : { ok: false, status: 500, json: async () => ({}), text: async () => '{"error":{"message":"boom"}}' };
    }
    if (donde.includes("/audio/speech")) {
      enviados.push({ HABLO: true });
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(2) };
    }

    // LA SEGUNDA PASADA (2-oct-2026): la IA redacta viendo los resultados.
    // Sin "redaccion", falla, y sale la frase de siempre: así las pruebas
    // de antes siguen probando lo mismo.
    if (donde.includes("api.openai.com") && JSON.parse(opciones.body || "{}")?.messages?.[0]?.content === "REDACTAR") {
      alModelo.push({ ...JSON.parse(opciones.body), redaccion: true });
      if (redaccion === null) return { ok: false, status: 500, text: async () => "sin redacción en esta prueba", json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ respuesta: redaccion }) } }] }) };
    }

    if (donde.includes("api.openai.com")) {
      alModelo.push(JSON.parse(opciones.body || "{}"));
      const cuerpo = JSON.stringify({
        respuesta: "Aquí lo tienes 👇",
        buscar: "NADA",
        historial: "Ya di la bienvenida.",
        ...respuestaDelModelo,
      });
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: cuerpo } }] }) };
    }

    // Otras APIs, por un trozo de su dirección: { "graph.facebook.com": {...} }.
    for (const [trozo, json] of Object.entries(apis)) {
      if (donde.includes(trozo)) return { ok: true, status: 200, json: async () => json };
    }

    // Las fotos de la hoja, cuando la prueba dice cuáles están rotas: las
    // demás cargan como imagen.
    if (fotosRotas && donde.startsWith("https://x/")) {
      return fotosRotas.includes(donde)
        ? { ok: false, status: 404, headers: new Headers({ "content-type": "text/html" }), body: null }
        : { ok: true, status: 200, headers: new Headers({ "content-type": "image/jpeg" }), body: null };
    }

    if (donde.includes("graph.instagram.com")) {
      if (donde.includes("/me/messages")) {
        // Como el Instagram de verdad: un carrusel con UNA foto que no puede
        // descargar se rechaza entero.
        const pedido = JSON.parse(opciones.body).message;
        const conFotoRota = (pedido?.attachment?.payload?.elements || []).some(
          (e) => fotosRotas && fotosRotas.includes(e.image_url)
        );
        if (conFotoRota || (rechazarCarrusel && pedido?.attachment)) {
          return {
            ok: false,
            status: 400,
            text: async () => '{"error":{"message":"(#100) Failed to fetch image_url","code":100}}',
          };
        }
        enviados.push(JSON.parse(opciones.body).message);
        return { ok: true, status: 200, json: async () => ({ message_id: `m${enviados.length}` }) };
      }
      return { ok: true, status: 200, json: async () => ({ name: "Perlita", username: "perlita" }) };
    }

    return { ok: false, status: 404, text: async () => "", json: async () => ({}) };
  };

  const env = {
    DB, SHEET_ID: hoja === HOJA ? "abc" : `hoja${++hojasAparte}`, SHEET_NOMBRE: "Hoja 1", IG_TOKEN: "t",
    OPENAI_API_KEY: "k", URL_CATALOGO: "https://CAMBIA-ESTO.com", WHATSAPP: "584121234567",
    ...envExtra,
  };

  await atenderMeta(env, {
    tipo: "texto", igsid: "cliente1", mid: "in1", texto, opcion,
    foto: "", historia: { url: "", id: "" }, publicacion: { url: "", titulo: "", enlace: "" },
    ...mensaje,
  });

  return { enviados, fila: DB.filas?.get("cliente1"), alModelo };
}
