// Los comentarios de las publicaciones: que se lean, que no se conteste
// dos veces, que el bot no se responda a sí mismo, y que el cliente
// termine con su equipo y su precio en el privado.
import { leerComentario, leerComentarios, esNuestro, respuestaPublica, saludoPrivado } from "./.stub/comentarios.js";
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

// META LOS MANDA EN LOTES. Antes se leía solo el primero y los demás se
// tiraban: gente preguntando debajo de la publicación y nadie contestando.
const dosJuntos = {
  entry: [
    {
      id: "17841400000000000",
      changes: [
        { field: "comments", value: { id: "c1", text: "precio?", from: { id: "u1", username: "ana" }, media: { id: "p1" } } },
        { field: "comments", value: { id: "c2", text: "y el poco?", from: { id: "u2", username: "luis" }, media: { id: "p1" } } },
      ],
    },
  ],
};
comprobar("dos comentarios en un aviso: se leen los dos", leerComentarios(dosJuntos).map((x) => x.id), ["c1", "c2"]);
comprobar("y en dos entry distintos también", leerComentarios({ entry: [dosJuntos.entry[0], { id: "1", changes: [{ field: "comments", value: { id: "c3", text: "hola", from: { id: "u3" } } }] }] }).length, 3);
comprobar("sin comentarios, lista vacía", leerComentarios({ entry: [{ messaging: [{}] }] }), []);

// ── No responderse a sí mismo ──────────────────────────────────
const yo = { id: "17841400000000000", usuario: "epiccell.vzla" };
comprobar("el comentario del cliente NO es nuestro", esNuestro(c, yo), false);
comprobar("el nuestro por id de cuenta sí", esNuestro({ de: "17841400000000000", cuenta: "17841400000000000" }, yo), true);
comprobar("el nuestro por usuario también", esNuestro({ de: "999", usuario: "EPICCELL.VZLA", cuenta: "1" }, yo), true);
// LA RED QUE NO DEPENDE DE NADA: si quienSoy falla (un permiso que falta),
// el bot se contestaba a sí mismo en bucle, en público. Sus propias frases
// se reconocen sin preguntarle nada a Meta.
comprobar("reconoce su propia frase sin quienSoy", esNuestro({ de: "999", cuenta: "1", texto: "¡Respondido al DM! 📩" }, null), true);
comprobar("y la de «escríbenos por privado»", esNuestro({ de: "999", cuenta: "1", texto: "¡Hola! 😊 Escríbenos por privado y te pasamos toda la info 📩" }, null), true);
comprobar("un «precio?» del cliente no", esNuestro({ de: "999", cuenta: "1", texto: "precio?" }, null), false);

// ── Lo que se dice en cada lado ────────────────────────────────
comprobar("en público no va el precio", /\d+\s*\$|\$\s*\d+/.test(respuestaPublica()), false);
comprobar("en público se le manda al DM", /DM/.test(respuestaPublica()), true);
comprobar("el privado saluda por su usuario", saludoPrivado("perlita", "Samsung A57").includes("@perlita"), true);
comprobar("y nombra la publicación y el equipo", /publicaci[oó]n del Samsung A57/.test(saludoPrivado("perlita", "Samsung A57")), true);
comprobar("si no se sabe el equipo, pregunta por los de ESA publicación", /que salen ah[ií]/i.test(saludoPrivado("", "")), true);

// ── El turno completo ──────────────────────────────────────────
function montar({ privadoFalla = false, publicoFalla = false, ventanaCerrada = false, sinPie = false, visionDice = "", hoja = HOJA, pie = "" } = {}) {
  const publicos = [];
  const privados = [];
  const DB = baseFalsa({ id: "cliente-del-comentario" });

  const control = { privadoFalla, publicoFalla, ventanaCerrada };

  globalThis.fetch = async (url, opciones = {}) => {
    const donde = String(url);

    if (donde.includes("docs.google.com")) return { ok: true, status: 200, text: async () => hoja };

    if (donde.includes("/replies")) {
      // Se mira el control y no el parámetro, para poder apagar el fallo a
      // mitad de la prueba (el reintento de Meta).
      if (control.publicoFalla) return { ok: false, status: 500, text: async () => "meta caido" };
      publicos.push(JSON.parse(opciones.body).message);
      return { ok: true, status: 200, json: async () => ({ id: "resp1" }) };
    }

    if (donde.includes("/me/messages")) {
      const cuerpo = JSON.parse(opciones.body);
      if (cuerpo.recipient?.comment_id) {
        if (control.privadoFalla) return { ok: false, status: 400, text: async () => "no autorizado" };
        privados.push(cuerpo.message);
        return { ok: true, status: 200, json: async () => ({ recipient_id: "cliente-del-comentario", message_id: "m1" }) };
      }
      // El segundo mensaje a quien solo comentó: Instagram lo rechaza.
      if (control.ventanaCerrada) {
        return {
          ok: false,
          status: 403,
          text: async () =>
            '{"error":{"message":"This message is sent outside of allowed window.","type":"IGApiException","code":10,"error_subcode":2534022}}',
        };
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
        caption: pie || (sinPie ? "🔥 Disponible ya 🔥 #epiccell" : "🔥 SAMSUNG A57 5G 12GB/512GB disponible"),
        media_type: "IMAGE",
        media_url: "https://x/a57.jpg",
        permalink: "https://www.instagram.com/p/ABC/",
      }) };
    }

    return { ok: true, status: 200, json: async () => ({}) , text: async () => "" };
  };

  return { publicos, privados, DB, control };
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

/* ── EL CASO REAL DEL 26-sep-2026 ──────────────────────────────────
   Del registro de producción:

     Comentario de @yosoyelilavenezolana: "Precio por favor"
     Publicación del comentario: con imagen, pie: "🔥 ¿Buscas alta gama
       sin pagar una fortuna? El Galaxy S25 FE"
     No pude saber de qué equipo habla la publicación

   El equipo estaba en la hoja. No se reconoció porque el emparejador
   miraba el título de la hoja desde el principio ("samsung galaxy"), y
   ningún pie de Instagram empieza nombrando la marca.
   ───────────────────────────────────────────────────────────────── */
const HOJA_S25 = `Nombre,Precio Divisas ($),Precio Cashea,Foto
Samsung Galaxy S25 FE 256GB,540,170,https://x/s25fe.jpg
Samsung Galaxy S25 Ultra 512GB,980,300,https://x/s25u.jpg
Samsung Galaxy A57 128GB,310,95,https://x/a57.jpg
Poco M8 pro 5G,185,62,https://x/poco.jpg`;

m = montar({ hoja: HOJA_S25, pie: "🔥 ¿Buscas alta gama sin pagar una fortuna? El Galaxy S25 FE" });
await atenderComentario({ ...env, SHEET_ID: "s25", DB: m.DB }, { ...c, id: "s25-fe", texto: "Precio por favor" });
fichas = m.privados.find((p) => p.attachment)?.attachment.payload.elements || [];
comprobar("«Precio por favor» en el post del S25 FE: le manda el S25 FE", fichas[0]?.title, "Samsung Galaxy S25 FE 256GB");
comprobar("y NO el S25 Ultra ni otro Samsung", fichas.every((f) => /S25 FE/.test(f.title)), true);
comprobar("el saludo nombra ese equipo", /Galaxy S25 FE/.test(m.privados[0].text), true);

// Y el pie que no nombra nada sigue sin inventar
m = montar({ hoja: HOJA_S25, pie: "🔥 Promoción de fin de semana, aprovecha 🔥" });
await atenderComentario({ ...env, SHEET_ID: "s25b", DB: m.DB }, { ...c, id: "pie-vacio", texto: "Precio por favor" });
comprobar("un pie sin nombre no le inventa un equipo", m.privados.some((p) => p.attachment), false);

/* ── INSTAGRAM SOLO DEJA MANDAR UN MENSAJE ─────────────────────────
   Del registro de produccion (26-sep): el saludo salio y el carrusel lo
   rechazo Meta con 403 "outside of allowed window". El cliente recibio
   "te paso la info 👇" y debajo, nada. El precio tiene que ir DENTRO de
   ese unico mensaje.
   ───────────────────────────────────────────────────────────────── */
m = montar({ ventanaCerrada: true });
await atenderComentario({ ...env, DB: m.DB }, { ...c, id: "ventana-cerrada", texto: "Precio" });
comprobar("con la ventana cerrada, igual le llega un mensaje", m.privados.length, 1);
comprobar("y trae el equipo", /Samsung A57/.test(m.privados[0].text), true);
comprobar("con su precio", /\$/.test(m.privados[0].text), true);
comprobar("y lo invita a contestar, que es lo que abre la ventana", /escr[ií]beme por aqu[ií]/i.test(m.privados[0].text), true);
comprobar("no se queda ninguna ficha a medias", m.privados.some((p) => p.attachment), false);
comprobar("en público se contesta igual", m.publicos.length, 1);

// Y si la ventana SÍ está abierta (esa persona ya venía escribiendo),
// las fotos salen además del texto.
m = montar();
await atenderComentario({ ...env, DB: m.DB }, { ...c, id: "ventana-abierta", texto: "Precio" });
comprobar("con la ventana abierta sí van las fotos", m.privados.some((p) => p.attachment), true);
comprobar("y el texto sigue trayendo el precio", /Samsung A57/.test(m.privados[0].text), true);

/* ── LA FAMILIA COMPLETA DEL MODELO, CON SUS ACCESORIOS ────────────
   Pedido del dueño: si el comentario es sobre un modelo que tiene
   familia —varias versiones y accesorios—, en ese único mensaje va todo.
   ───────────────────────────────────────────────────────────────── */
const HOJA_NOTE = `Nombre,Precio Divisas ($),Precio Cashea,Foto
Redmi Note 17 256GB,240,75,https://x/n17.jpg
Redmi Note 17 Pro 512GB,300,95,https://x/n17p.jpg
Redmi Note 17 8/128,210,68,https://x/n17b.jpg
Redmi Note 14 128GB,190,60,https://x/n14.jpg
Forro Redmi Note 17,8,,https://x/f17.jpg
Vidrio Redmi Note 17,5,,https://x/v17.jpg`;

m = montar({
  hoja: HOJA_NOTE,
  pie: "🔥 ¡Batería colosal de 8,340 mAh! El Redmi Note 17 ya está aquí",
  ventanaCerrada: true,
});
await atenderComentario({ ...env, SHEET_ID: "note17", DB: m.DB }, { ...c, id: "familia", texto: "Precio" });
const dicho = m.privados[0].text;

comprobar("van las TRES versiones del Note 17", ["256GB", "Pro 512GB", "8/128"].every((v) => dicho.includes(v)), true);
comprobar("cada una con su precio", (dicho.match(/\$\d+/g) || []).length >= 3, true);
comprobar("los accesorios del modelo también", /Forro Redmi Note 17/.test(dicho) && /Vidrio Redmi Note 17/.test(dicho), true);
comprobar("pero en su propio bloque, no mezclados", /ACCESORIOS/.test(dicho), true);
comprobar("y NO se cuela el Note 14, que es otro modelo", /Note 14/.test(dicho), false);
comprobar("cabe en un mensaje de Instagram", dicho.length <= 1000, true);
comprobar("el saludo nombra el modelo, sin los gigas", /publicación del Redmi Note 17,/.test(dicho), true);

// Si el COMENTARIO dice qué quiere, eso es lo que va.
m = montar({ hoja: HOJA_NOTE, pie: "El Redmi Note 17 ya está aquí", ventanaCerrada: true });
await atenderComentario({ ...env, SHEET_ID: "note17b", DB: m.DB }, { ...c, id: "pide-forro", texto: "precio del forro?" });
const paraElForro = m.privados[0].text;
comprobar("pide el forro: le manda el forro", /Forro Redmi Note 17/.test(paraElForro), true);
comprobar("y no le mete los teléfonos", /Redmi Note 17 256GB/.test(paraElForro), false);

// Y un pie que solo habla de fichas técnicas no identifica nada: mejor
// preguntar que mandarle un cargador porque coincidió el "25w".
m = montar({ hoja: HOJA_NOTE, pie: "⚡ Carga rápida de 25w, batería para todo el día" });
await atenderComentario({ ...env, SHEET_ID: "solofichas", DB: m.DB }, { ...c, id: "solo-fichas", texto: "Precio" });
comprobar("un pie de pura ficha técnica: pregunta, no inventa", m.privados.some((p) => p.attachment), false);

// Los modos
comprobar("por defecto, todo", modoComentarios({}), "todo");
comprobar("se puede apagar", modoComentarios({ COMENTARIOS: "off" }), "off");
comprobar("un valor raro no lo rompe", modoComentarios({ COMENTARIOS: "loquesea" }), "todo");

m = montar();
await atenderComentario({ ...env, COMENTARIOS: "privado", DB: m.DB }, { ...c, id: "solo-privado" });
comprobar("en modo privado no comenta en público", m.publicos.length, 0);
comprobar("pero sí abre el chat", m.privados.length >= 1, true);

m = montar();
await atenderComentario({ ...env, COMENTARIOS: "publico", DB: m.DB }, { ...c, id: "solo-publico" });
comprobar("en modo público no abre el privado", m.privados.length, 0);
comprobar("y NO le promete un DM que no mandó", /respondido al dm|te respondimos/i.test(m.publicos[0]), false);
comprobar("le pide que escriba él", /escr[ií]benos por privado/i.test(m.publicos[0]), true);

// ── SI UN ASESOR YA LO ATIENDE, EL BOT NO SE METE ──────────────
//
// El cliente escribió por privado, un asesor le contestó a mano (el bot en
// pausa), y el mismo cliente comenta en una publicación. Sin esto, el bot
// le soltaba su saludo automático encima de la conversación del asesor.
m = montar();
m.DB.filas.set("178000000000001", {
  id: "178000000000001",
  nombre: "", historial: "", pausado_hasta: Date.now() + 60 * 60 * 1000,
  mids_enviados: "[]", ultimo_envio: 0, mostrados: "[]", ultima_respuesta: "",
  ultimos_productos: "[]", ultimos_textos: "[]", publicacion: "",
});
await atenderComentario({ ...env, DB: m.DB }, { ...c, id: "en-pausa" });
comprobar("no le escribe por privado por encima del asesor", m.privados.length, 0);
comprobar("pero no lo deja colgado en público", m.publicos.length, 1);
comprobar("y le dice la verdad: ya lo atienden", /ya te estamos atendiendo/i.test(m.publicos[0]), true);

// ── SI NO SE PUDO CONTESTAR, EL COMENTARIO SE SUELTA ───────────
//
// La marca de "ya contestado" se pone antes de contestar, para que dos
// webhooks del mismo comentario no contesten los dos. Si después falla
// todo, hay que soltarla: el reintento de Meta es la única segunda
// oportunidad que hay.
m = montar({ privadoFalla: true, publicoFalla: true });
await atenderComentario({ ...env, DB: m.DB }, { ...c, id: "todo-falla" });
comprobar("no le llegó nada", m.publicos.length + m.privados.length, 0);
m.control.publicoFalla = false;
m.control.privadoFalla = false;
await atenderComentario({ ...env, DB: m.DB }, { ...c, id: "todo-falla" });
comprobar("y el reintento de Meta SÍ le contesta", m.publicos.length, 1);

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
