// Los comentarios de las publicaciones: que se lean, que no se conteste
// dos veces, que el bot no se responda a sí mismo, y que el cliente
// termine con su equipo y su precio en el privado.
import { leerComentario, esNuestro, respuestaPublica, saludoPrivado } from "./.stub/comentarios.js";
import { atenderComentario, modoComentarios } from "./.stub/index.js";
import { HOJA, baseFalsa } from "./banco.mjs";

let fallos = 0;
const comprobar = (n, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};

const webhook = (valor, field = "comments") => ({
  entry: [{ id: "17841400000000000", time: 1, changes: [{ field, value: valor }] }],
});

// ── Leer lo que manda Meta ─────────────────────────────────────
const crudo = webhook({
  id: "17900000000000001",
  text: "precio?",
  from: { id: "178000000000001", username: "perlita" },
  media: { id: "18000000000000001", media_product_type: "FEED" },
});

const c = leerComentario(crudo);
comprobar("reconoce un comentario", c.tipo, "comentario");
comprobar("con su texto", c.texto, "precio?");
comprobar("quién lo escribió", c.usuario, "perlita");
comprobar("y en qué publicación", c.media, "18000000000000001");
comprobar("los de un vivo también", leerComentario(webhook({ id: "1", text: "hola", from: { id: "2" } }, "live_comments"))?.tipo, "comentario");
comprobar("un comentario borrado no se contesta", leerComentario(webhook({ id: "1", text: "x", verb: "remove", from: { id: "2" } })), null);
comprobar("un mensaje directo no es un comentario", leerComentario({ entry: [{ messaging: [{ message: { text: "hola" } }] }] }), null);

// ── No responderse a sí mismo ──────────────────────────────────
const yo = { id: "17841400000000000", usuario: "epiccell.vzla" };
comprobar("el comentario del cliente NO es nuestro", esNuestro(c, yo), false);
comprobar("el nuestro por id de cuenta sí", esNuestro({ de: "17841400000000000", cuenta: "17841400000000000" }, yo), true);
comprobar("el nuestro por usuario también", esNuestro({ de: "999", usuario: "EPICCELL.VZLA", cuenta: "1" }, yo), true);

// ── Lo que se dice en cada lado ────────────────────────────────
comprobar("en público no va el precio", /\d+\s*\$|\$\s*\d+/.test(respuestaPublica()), false);
comprobar("en público se le manda al DM", /DM/.test(respuestaPublica()), true);
comprobar("el privado saluda por su usuario", saludoPrivado("perlita", "Samsung A57").includes("@perlita"), true);
comprobar("y nombra la publicación y el equipo", /publicaci[oó]n del Samsung A57/.test(saludoPrivado("perlita", "Samsung A57")), true);
comprobar("si no se sabe el equipo, pregunta por los de ESA publicación", /que salen ah[ií]/i.test(saludoPrivado("", "")), true);

// ── El turno completo ──────────────────────────────────────────
function montar({ privadoFalla = false, sinPie = false, visionDice = "" } = {}) {
  const publicos = [];
  const privados = [];
  const DB = baseFalsa({ id: "cliente-del-comentario" });

  globalThis.fetch = async (url, opciones = {}) => {
    const donde = String(url);

    if (donde.includes("docs.google.com")) return { ok: true, status: 200, text: async () => HOJA };

    if (donde.includes("/replies")) {
      publicos.push(JSON.parse(opciones.body).message);
      return { ok: true, status: 200, json: async () => ({ id: "resp1" }) };
    }

    if (donde.includes("/me/messages")) {
      const cuerpo = JSON.parse(opciones.body);
      if (cuerpo.recipient?.comment_id) {
        if (privadoFalla) return { ok: false, status: 400, text: async () => "no autorizado" };
        privados.push(cuerpo.message);
        return { ok: true, status: 200, json: async () => ({ recipient_id: "cliente-del-comentario", message_id: "m1" }) };
      }
      privados.push(cuerpo.message);
      return { ok: true, status: 200, json: async () => ({ message_id: "m2" }) };
    }

    if (donde.includes("/me?fields=id,username")) {
      return { ok: true, status: 200, json: async () => ({ id: "17841400000000000", username: "epiccell.vzla" }) };
    }

    // La publicación donde comentó
    if (donde.includes("api.openai.com")) {
      const cuerpo = JSON.stringify({ visto: "un telefono", buscar: visionDice || "NADA", pedirNombreExacto: false });
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: cuerpo } }] }) };
    }

    if (donde.includes("x/a57.jpg")) {
      return { ok: true, status: 200, headers: { get: (k) => (k === "content-type" ? "image/jpeg" : null) }, arrayBuffer: async () => new ArrayBuffer(8) };
    }

    if (donde.includes("18000000000000001")) {
      return { ok: true, status: 200, json: async () => ({
        id: "18000000000000001",
        caption: sinPie ? "🔥 Disponible ya 🔥 #epiccell" : "🔥 SAMSUNG A57 5G 12GB/512GB disponible",
        media_type: "IMAGE",
        media_url: "https://x/a57.jpg",
        permalink: "https://www.instagram.com/p/ABC/",
      }) };
    }

    return { ok: true, status: 200, json: async () => ({}) , text: async () => "" };
  };

  return { publicos, privados, DB };
}

const env = { SHEET_ID: "abc", SHEET_NOMBRE: "Hoja 1", IG_TOKEN: "t", OPENAI_API_KEY: "k", COMENTARIOS: "todo" };

let m = montar();
await atenderComentario({ ...env, DB: m.DB }, c);
comprobar("contesta en público una vez", m.publicos.length, 1);
comprobar("abre el privado", m.privados.length >= 1, true);
comprobar("y manda las fichas del equipo de la publicación", m.privados.some((p) => p.attachment?.payload?.elements?.length), true);
comprobar("las fichas son del A57", m.privados.find((p) => p.attachment)?.attachment.payload.elements[0].title, "Samsung A57");

// El mismo comentario otra vez (Meta reintenta): no se repite nada
const antes = m.publicos.length;
await atenderComentario({ ...env, DB: m.DB }, c);
comprobar("un reintento de Meta no se contesta dos veces", m.publicos.length, antes);

// Un comentario nuestro: ni se toca
m = montar();
await atenderComentario({ ...env, DB: m.DB }, { ...c, id: "otro", de: "17841400000000000", usuario: "epiccell.vzla" });
comprobar("no se responde a sí mismo", m.publicos.length + m.privados.length, 0);

// Si el privado no se puede abrir, se le dice en público que escriba
m = montar({ privadoFalla: true });
await atenderComentario({ ...env, DB: m.DB }, { ...c, id: "sin-privado" });
comprobar("sin privado: contesta en público igual", m.publicos.length, 1);
comprobar("y lo invita a escribir", /escr[ií]benos por privado/i.test(m.publicos[0]), true);

// ── COHERENCIA: siempre el equipo de ESA publicación ───────────
//
// El caso que reportó el dueño: alguien comenta "precio" en una
// publicación y el bot contesta con otra cosa.

// 1. El pie de la publicación manda
m = montar();
await atenderComentario({ ...env, DB: m.DB }, { ...c, id: "coherente-1", texto: "precio" });
let fichas = m.privados.find((p) => p.attachment)?.attachment.payload.elements || [];
comprobar("«precio» a secas: contesta con el equipo de la publicación", fichas[0]?.title, "Samsung A57");
comprobar("y lo nombra en el saludo", /publicaci[oó]n del Samsung A57/.test(m.privados[0].text), true);

// 2. Si él nombra otro equipo, manda el suyo
m = montar();
await atenderComentario({ ...env, DB: m.DB }, { ...c, id: "coherente-2", texto: "y el Poco M8 pro cuanto?" });
fichas = m.privados.find((p) => p.attachment)?.attachment.payload.elements || [];
comprobar("si pregunta por otro equipo, ese le muestra", fichas[0]?.title, "Poco M8 pro 5G");

// 3. Publicación sin nombre en el pie y sin imagen: pregunta, NO inventa
m = montar({ sinPie: true });
await atenderComentario({ ...env, DB: m.DB }, { ...c, id: "coherente-3", texto: "precio" });
comprobar("sin saber de qué habla: ninguna ficha", m.privados.some((p) => p.attachment), false);
comprobar("y le pregunta por los de esa publicación", /que salen ah[ií]/i.test(m.privados[0].text), true);

// 4. El pie no lo dice, pero la imagen sí (la lee la IA de visión)
m = montar({ sinPie: true, visionDice: "Poco X8" });
await atenderComentario({ ...env, DB: m.DB }, { ...c, id: "coherente-4", texto: "precio?" });
fichas = m.privados.find((p) => p.attachment)?.attachment.payload.elements || [];
comprobar("lo lee en la imagen de la publicación", fichas[0]?.title, "Poco X8 pro 5G");

// 5. Se identifica algo que no está en el catálogo: pregunta igual
m = montar({ sinPie: true, visionDice: "Nokia 3310" });
await atenderComentario({ ...env, DB: m.DB }, { ...c, id: "coherente-5", texto: "precio?" });
comprobar("si no lo tenemos, no manda otra cosa", m.privados.some((p) => p.attachment), false);

// Los modos
comprobar("por defecto, todo", modoComentarios({}), "todo");
comprobar("se puede apagar", modoComentarios({ COMENTARIOS: "off" }), "off");
comprobar("un valor raro no lo rompe", modoComentarios({ COMENTARIOS: "loquesea" }), "todo");

m = montar();
await atenderComentario({ ...env, COMENTARIOS: "privado", DB: m.DB }, { ...c, id: "solo-privado" });
comprobar("en modo privado no comenta en público", m.publicos.length, 0);
comprobar("pero sí abre el chat", m.privados.length >= 1, true);

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
