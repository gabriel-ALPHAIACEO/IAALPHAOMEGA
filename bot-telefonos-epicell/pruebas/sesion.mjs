// LO DEL 2-OCT-2026, SOBRE LA VERSIÓN DEL DUEÑO:
//   · el caso real de la captura: "ahora muéstrame, quiero verlos" (nota
//     de voz), "en imágenes", "mándalos" — y no llegaba ni una foto;
//   · las notas de voz: se escuchan y se contesta POR ESCRITO;
//   · la IA piensa (pienso) y elige cómo responder (mostrar);
//   · el precio ya está en la ficha; el tono; lo que NO hay en la hoja.
import { turno } from "./banco.mjs";

let fallos = 0;
const comprobar = (n, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};
const textos = (e) => e.filter((m) => m.text).map((m) => m.text);
const fichas = (e) => e.flatMap((m) => m.attachment?.payload?.elements || []);
const titulos = (e) => fichas(e).map((f) => f.title);
const AUDIO = { tipo: "audio", audio: "https://cdn/nota.mp4" };

// Lo que el bot le había escrito en la captura: una lista sin fotos.
const LISTO = {
  historial: "Ya di la bienvenida. Pidió ver teléfonos.",
  ultima_respuesta: "Te muestro los teléfonos disponibles que tengo:\n\n- Samsung A57 — 12GB / 512GB\n- Samsung A17\n- Poco M8 pro 5G",
};

// ── 1. El caso de la captura ────────────────────────────────────
for (const dicho of ["En imágenes", "Mandalos", "Mándalos", "Ahora muéstrame, quiero verlos."]) {
  const r = await turno({ texto: dicho, fila: LISTO });
  comprobar(`"${dicho}" después de la lista → las fichas de lo listado`, titulos(r.enviados), ["Samsung A57", "Samsung A17", "Poco M8 pro 5G"]);
}
{
  const r = await turno({ mensaje: AUDIO, transcripcion: "Ahora muéstrame, quiero verlos.", fila: LISTO });
  comprobar("por NOTA DE VOZ también → las fichas", titulos(r.enviados), ["Samsung A57", "Samsung A17", "Poco M8 pro 5G"]);
  comprobar("y no se le manda ninguna nota de voz", r.enviados.some((m) => m.HABLO || m.attachment?.type === "audio"), false);
}

// ── 2. La IA promete fotos sin buscar nada ──────────────────────
{
  const r = await turno({
    texto: "cual me recomiendas?",
    fila: { historial: "Ya di la bienvenida." },
    respuestaDelModelo: { respuesta: "Te muestro lo que tengo 👇\n\n- Samsung A57\n- Poco X8 pro 5G", buscar: "NADA" },
  });
  comprobar("nombra equipos en su texto → van esas fichas", titulos(r.enviados), ["Samsung A57", "Poco X8 pro 5G"]);
  comprobar("y la lista escrita se quita de encima de las fotos", textos(r.enviados).some((t) => /- Samsung A57/.test(t)), false);
}
{
  const r = await turno({
    texto: "cual me recomiendas?",
    fila: { historial: "Ya di la bienvenida." },
    respuestaDelModelo: { respuesta: "¡Claro! Aquí tienes los teléfonos que tengo disponibles 👇", buscar: "NADA" },
  });
  const conBotones = r.enviados.find((m) => m.quick_replies);
  comprobar("no nombra ninguno → se le pregunta la marca, con botones", Boolean(conBotones), true);
  comprobar("con las marcas de la hoja", (conBotones?.quick_replies || []).map((q) => q.title).includes("Samsung"), true);
  comprobar("y no le queda un 'aquí tienes 👇' sin nada debajo", textos(r.enviados).some((t) => /Aquí tienes los teléfonos/.test(t)), false);
}

// ── 3. Notas de voz ─────────────────────────────────────────────
{
  const r = await turno({
    mensaje: AUDIO, transcripcion: "hola tienes el samsung a57",
    fila: { historial: "Ya di la bienvenida." },
    respuestaDelModelo: { respuesta: "¡Mira el Samsung A57! 📱", buscar: "Samsung A57" },
  });
  const alModelo = JSON.stringify(r.alModelo[0]?.messages || []);
  comprobar("lo que dijo le llega a la IA", /hola tienes el samsung a57/.test(alModelo), true);
  comprobar("y sabe que vino por voz", /NOTA DE VOZ/.test(alModelo), true);
  comprobar("le contesta por escrito, con la ficha", titulos(r.enviados), ["Samsung A57"]);
  comprobar("nunca con voz", r.enviados.some((m) => m.HABLO || m.attachment?.type === "audio"), false);
}
{
  const r = await turno({ mensaje: AUDIO, transcripcion: null, fila: { historial: "Ya di la bienvenida." } });
  comprobar("si no se puede escuchar, le pide que escriba", textos(r.enviados).some((t) => /no logré escuchar tu nota de voz/.test(t)), true);
  comprobar("sin inventarle una respuesta", r.alModelo.length, 0);
}

// ── 4. Piensa, y elige cómo responder ───────────────────────────
{
  const r = await turno({ texto: "tienes el samsung a57?", fila: { historial: "Ya di la bienvenida." }, respuestaDelModelo: { respuesta: "¡Mira! 📱", buscar: "Samsung A57" } });
  const esquema = r.alModelo[0]?.response_format?.json_schema?.schema;
  comprobar("'pienso' va primero y 'mostrar' es obligatorio", esquema?.required, ["pienso", "mostrar", "respuesta", "buscar", "historial"]);
}
{
  const r = await turno({
    texto: "y con cashea cuanto es la inicial? soy level 5",
    fila: { historial: "Pidió Samsung A57. Ya busqué: Samsung A57.", ultimos_productos: JSON.stringify(["Samsung A57"]) },
    respuestaDelModelo: { mostrar: "texto", respuesta: "Con tu nivel 5 la inicial es del 20% 😊", buscar: "Samsung A57" },
  });
  comprobar("SOLO TEXTO: del equipo que ya vio no se repiten las fichas", fichas(r.enviados).length, 0);
  comprobar("pero la respuesta sí llega", textos(r.enviados).some((t) => /nivel 5/.test(t)), true);
}
{
  const r = await turno({
    texto: "tienes poco?",
    fila: { historial: "Pidió Samsung A57. Ya busqué: Samsung A57.", ultimos_productos: JSON.stringify(["Samsung A57"]) },
    respuestaDelModelo: { mostrar: "texto", respuesta: "¡Sí, claro!", buscar: "Poco" },
  });
  comprobar("marcó 'texto' pero son NUEVOS para él → las fichas van igual", fichas(r.enviados).length > 0, true);
}

// ── 5. El precio ya está en la ficha ────────────────────────────
{
  const r = await turno({ texto: "tienes el samsung a57?", fila: { historial: "Ya di la bienvenida." }, respuestaDelModelo: { respuesta: "¡Mira el Samsung A57! ¿Quieres saber el precio?", buscar: "Samsung A57" } });
  comprobar("no pregunta si quiere saber el precio", textos(r.enviados).some((t) => /quieres saber el precio/i.test(t)), false);
  comprobar("dice que está en cada foto", textos(r.enviados).some((t) => /precios están en cada foto/i.test(t)), true);
}

// ── 6. Lo que NO hay en la hoja ─────────────────────────────────
{
  const r = await turno({ texto: "tienes iphone 15?", fila: { historial: "Ya di la bienvenida." }, respuestaDelModelo: { respuesta: "¡Sí tenemos iPhone 15! 📱", buscar: "NADA" } });
  const alModelo = JSON.stringify(r.alModelo[0]?.messages || []);
  comprobar("la IA recibe que no hay ningún iPhone", /NO HAY NINGÚN equipo de: iPhone/.test(alModelo), true);
  comprobar("y si igual dice que hay, se corrige", textos(r.enviados).some((t) => /no tengo iPhone/.test(t) && !/Sí tenemos/.test(t)), true);
}

// ── 7. El tono ──────────────────────────────────────────────────
{
  const r = await turno({ texto: "esta mrd no responde", fila: { historial: "Ya di la bienvenida." }, respuestaDelModelo: { respuesta: "No seas bruto, ya te respondí. ¿Qué equipo buscas?", buscar: "NADA" } });
  comprobar("se quita el insulto, queda lo útil", textos(r.enviados), ["¿Qué equipo buscas?"]);
}

// ── 9. La IA redacta viendo lo que hay (menos frases fijas) ─────────
{
  const base = { texto: "tienes el samsung a57?", fila: { historial: "Ya di la bienvenida." }, respuestaDelModelo: { respuesta: "Déjame revisar 👇", buscar: "Samsung A57" } };
  let r = await turno({ ...base, redaccion: "¡Sí! El Samsung A57 de 12/512 es de lo mejor que tengo 👇 ¿Es para ti o para regalo?" });
  comprobar("con fichas: sale lo que redactó viendo el resultado", textos(r.enviados)[0], "¡Sí! El Samsung A57 de 12/512 es de lo mejor que tengo 👇 ¿Es para ti o para regalo?");
  const pedido = r.alModelo.find((x) => x.redaccion);
  const lo = JSON.stringify(pedido?.messages || []);
  comprobar("la IA recibe lo que se le va a enseñar, con su precio", /- Samsung A57 · precio en divisas: \$310 · precio con Cashea: \$95/.test(lo), true);
  comprobar("y la conversación y su borrador", /LO QUE PIDE AHORA: tienes el samsung a57/.test(lo) && /TU BORRADOR: Déjame revisar/.test(lo), true);

  r = await turno({ ...base, redaccion: "Uy, ese no lo tengo 😅" });
  comprobar("si contradice la búsqueda (dice que no hay con la ficha debajo) → la de siempre", textos(r.enviados)[0], "Déjame revisar 👇");

  r = await turno({ ...base, redaccion: "No seas bruto, ya te lo dije. Mira el A57 👇" });
  comprobar("las redes también pasan por lo que redacta (tono)", /bruto|ya te lo dije/.test(textos(r.enviados)[0]), false);

  r = await turno({ ...base, redaccion: "El A57 te sale en $999, una ganga 👇" });
  comprobar("un precio inventado en la redacción no sale", /999/.test(textos(r.enviados).join(" ")), false);

  r = await turno({ ...base, env: { REDACCION_LIBRE: "no" }, redaccion: "esto no debería salir" });
  comprobar("REDACCION_LIBRE = no → no se pide la segunda pasada", r.alModelo.some((x) => x.redaccion), false);

  r = await turno({ texto: "gracias!", fila: { historial: "Ya di la bienvenida." }, respuestaDelModelo: { respuesta: "¡Con gusto! 😊", buscar: "NADA" }, redaccion: "otra cosa" });
  comprobar("conversación sin fichas y sin cambios del código: una sola llamada", r.alModelo.filter((x) => x.redaccion).length, 0);
}

// ── 10. La IA ve el anuncio por el que llegó, con sus precios ──────
{
  const ANUNCIO = { fuente: "ADS", id: "777", titulo: "Samsung A57 12/512 · llévatelo en cuotas", ref: "", foto: "", publicacion: "" };
  let r = await turno({
    texto: "precio?",
    mensaje: { anuncio: ANUNCIO },
    respuestaDelModelo: { respuesta: "¡Hola! Soy la asistente virtual de EPICCELL 👋 El Samsung A57 está en $310 en divisas, o $95 con Cashea 📱", buscar: "Samsung A57" },
  });
  const lo = JSON.stringify(r.alModelo.find((x) => !x.redaccion)?.messages || []);
  comprobar("la IA sabe que viene del anuncio del A57", /LLEGÓ POR UN ANUNCIO DEL SAMSUNG A57/.test(lo), true);
  comprobar("y tiene sus precios reales", /Precio en divisas: \$310/.test(lo) && /Precio con Cashea: \$95/.test(lo), true);
  comprobar("si dice el precio de verdad, se queda", textos(r.enviados).some((t) => /\$310 en divisas/.test(t)), true);
  comprobar("y la ficha del A57 va debajo", titulos(r.enviados), ["Samsung A57"]);

  const AYER = JSON.stringify({ titulo: ANUNCIO.titulo, descripcion: "", cuando: Date.now() - 20 * 60 * 60 * 1000, atendida: true, deAnuncio: true, equipo: "Samsung A57" });
  r = await turno({
    texto: "y si soy nivel 3 de cashea cuanto seria la inicial?",
    fila: { historial: "Ya di la bienvenida. Vino del anuncio del A57.", publicacion: AYER },
    respuestaDelModelo: { respuesta: "Con nivel 3 la inicial es el 30% 😊 y el A57 con Cashea está en $95", buscar: "NADA" },
  });
  const lo2 = JSON.stringify(r.alModelo.find((x) => !x.redaccion)?.messages || []);
  comprobar("al día siguiente la IA SIGUE sabiendo del anuncio", /LLEGÓ POR UN ANUNCIO DEL SAMSUNG A57/.test(lo2), true);
  comprobar("y el precio de ese equipo no se toma por inventado", textos(r.enviados).some((t) => /\$95/.test(t)), true);

  r = await turno({
    texto: "cuanto cuesta?",
    fila: { historial: "Ya di la bienvenida.", publicacion: AYER },
    respuestaDelModelo: { respuesta: "Está en $500 😊", buscar: "NADA" },
  });
  comprobar("un precio que NO es del equipo del anuncio sí se quita", textos(r.enviados).some((t) => /500/.test(t)), false);

  const VIEJO = JSON.stringify({ titulo: ANUNCIO.titulo, cuando: Date.now() - 9 * 24 * 60 * 60 * 1000, atendida: true, deAnuncio: true, equipo: "Samsung A57" });
  r = await turno({ texto: "hola de nuevo", fila: { historial: "Ya di la bienvenida.", publicacion: VIEJO }, respuestaDelModelo: { respuesta: "¡Hola! ¿Qué estás buscando? 😊", buscar: "NADA" } });
  const lo3 = JSON.stringify(r.alModelo.find((x) => !x.redaccion)?.messages || []);
  comprobar("un anuncio de hace más de una semana ya no se arrastra", /LLEGÓ POR UN ANUNCIO/.test(lo3), false);
}

// ── 8. Las redes nuevas no tocan las respuestas buenas del prompt ─
// El riesgo de una red así no es que se le escape algo malo: es que atrape
// algo bueno. Se le pasan por encima todos los ejemplos de texto.txt.
{
  const fs = await import("node:fs");
  const { revisarTono } = await import("./.stub/tono.js");
  const { revisarPrecio } = await import("./.stub/precio.js");
  const { revisarDisponibilidad } = await import("./.stub/disponible.js");
  const ejemplos = fs.readFileSync(new URL("../src/prompts/texto.txt", import.meta.url), "utf8")
    .split("\n").map((l) => l.trim()).filter((l) => l.startsWith('{"'))
    .map((l) => { try { return JSON.parse(l).respuesta; } catch { return ""; } }).filter(Boolean);
  const CON_TODO = ["iPhone 15", "Samsung A57", "Redmi Note 17", "Xiaomi 14", "Poco X8", "Infinix Hot 50", "Tecno Spark 20",
    "Honor X8", "Motorola Moto G84", "Realme 12", "Huawei Nova 12", "Oppo A79"].map((titulo) => ({ titulo }));
  const tocadas = ejemplos.filter((t) =>
    revisarTono(t).corregido || revisarPrecio(t, { hayFichas: true }).corregido || revisarDisponibilidad(t, CON_TODO).corregido
  );
  comprobar(`ninguno de los ${ejemplos.length} ejemplos del prompt se altera`, tocadas, []);
}

console.log(fallos ? `\n${fallos} fallo(s)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
