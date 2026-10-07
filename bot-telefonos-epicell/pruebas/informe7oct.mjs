// EL INFORME DE ERRORES DE EPICCELL DEL 7-OCT-2026 (54 🔴; los del 5 y 6
// de octubre ya estaban arreglados en v42-v49). Cada bloque es un caso.
import { turno } from "./banco.mjs";
import { contestarCuotas } from "./.stub/cuotas.js";
import { sinListaPegada, esAgradecimiento } from "./.stub/index.js";
import { juntarModelo } from "./.stub/modelo.js";

let fallos = 0;
const comprobar = (n, real, esperado = true) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};
const textos = (e) => e.filter((m) => m.text).map((m) => m.text);
const titulos = (e) => e.flatMap((m) => m.attachment?.payload?.elements || []).map((f) => f.title);

const HOJA = `Nombre,Cantidad,Precio Cashea,Precio Divisas ($),Foto
Redmi 15c,4,182,145,https://x/2.jpg
Redmi 17 4G,1,268,215,https://x/4.jpg
Redmi Note 17,1,307,245,https://x/5.jpg
Redmi Note 17 Pro Max 5G,1,613,490,https://x/7.jpg
Redmi Note 15 pro + 5G,1,560,445,https://x/9.jpg
Redmi Pad 2,2,295,235,https://x/32.jpg
Samsung A57,1,763,610,https://x/17.jpg
Samsung A37,1,487,390,https://x/19.jpg
Xbyte Base para carro  Xb-4978,3,25,20,https://x/68.jpg
xbyte OTG Sx-54,5,7,5,https://x/69.jpg
xbyte Audifonos Sport Xb 4755,2,12,10,https://x/71.jpg`;
const PAD = { titulo: "Redmi Pad 2", precioCashea: "295" };
const pedir = (texto, buscar, { fila = {}, respuesta = "¡Claro! Mira 👇" } = {}) =>
  turno({ texto, fila: { historial: "Ya di la bienvenida.", ...fila }, respuestaDelModelo: { respuesta, buscar }, hoja: HOJA });

// ── Krece y las cuotas ──────────────────────────────────────────────
{
  const k = contestarCuotas({ texto: "Precio en krece", equipo: PAD });
  comprobar("'Precio en krece' → la tabla de Krece y el monto al asesor (sin inventar un $ de Krece)", /Azul — 30%/.test(k?.respuesta) && k?.asesor === true && !/\$/.test(k?.respuesta));
  comprobar("'Esperaré a 6 cuotas' no es una pregunta: no se le manda ninguna cuenta", contestarCuotas({ texto: "No, aun no..Esperare a 6 cuotas", equipo: PAD }), null);
  comprobar("'Gracias… aún no tengo la inicial' tampoco", contestarCuotas({ texto: "Gracias...aun no tengo la inicial , pero me pondré en eso", equipo: PAD }), null);
  // (dueño, 7-oct) "Nivel 6" es de Cashea (Krece no tiene nivel 6): la cuenta
  // de Cashea está bien. Si venía hablando de Krece, una línea lo aclara.
  const n6 = contestarCuotas({ texto: "Nivel 6", historial: "Preguntó por Krece.", equipo: PAD })?.respuesta || "";
  comprobar("'Nivel 6' → la cuenta de Cashea: inicial $59.00 y 3 cuotas de $78.67", /Inicial \(20%\): \$59\.00/.test(n6) && /3 cuotas de \$78\.67/.test(n6));
  comprobar("…y si venía hablando de Krece, se le aclara que en Krece van por color", /en Krece van por color/.test(n6));
  comprobar("sin hablar de Krece, sin la aclaración", /Krece/.test(contestarCuotas({ texto: "Nivel 6", historial: "Es de Cashea.", equipo: PAD })?.respuesta || ""), false);
  comprobar("'En Krece estoy en nivel inicial' → Azul (30% y 6 cuotas)", /nivel Azul .* 30% .* 6 cuotas/s.test(contestarCuotas({ texto: "En Krece estoy en nivel inicial", equipo: PAD })?.respuesta || ""));
  const ambas = contestarCuotas({ texto: "Cuánto cuesta por Cashea o Krece?", equipo: { titulo: "Redmi 15c", precioCashea: "182" } });
  comprobar("'¿por Cashea o Krece?' → la cuenta de Cashea del equipo y la tabla de Krece", /Redmi 15c está en \$182\.00 con Cashea/.test(ambas?.respuesta) && /Y con Krece/.test(ambas?.respuesta));
  comprobar("'Cashea' a secas con un equipo delante → cómo le queda", /Nivel 1 — inicial/.test(contestarCuotas({ texto: "Cashea", equipo: PAD })?.respuesta || ""));
}
{
  const r = await pedir("Cuánto cuesta por Cashea o Krece?", "NADA", { fila: { ultimos_productos: JSON.stringify(["Redmi 15c"]) }, respuesta: "¡Sí trabajamos con cuotas!" });
  const t = textos(r.enviados).join("\n");
  comprobar("turno: con el 15C visto, contesta con ESE equipo (no la tabla general de dos mensajes)", /Redmi 15c está en \$182\.00/.test(t) && !/¿Con cuál de las dos quieres comprar\?/.test(t));
}
{
  const r = await pedir("Gracias...aun no tengo la inicial , pero me pondré en eso", "NADA", { respuesta: "¡Con gusto! Aquí estoy cuando estés lista 😊" });
  comprobar("turno: un 'gracias, aún no tengo la inicial' ya no recibe la tabla de pagos", textos(r.enviados).some((t) => /Tu inicial según tu nivel/.test(t)), false);
}
{
  const r = await pedir("y el precio?", "NADA", { fila: { ultimos_productos: JSON.stringify(["Redmi Pad 2"]) }, respuesta: "El Redmi Pad 2 está en $295.00 con Krece. ¿Te lo aparto?" });
  comprobar("turno: 'está en $295 con Krece' (era el de Cashea) no sale", textos(r.enviados).some((t) => /con Krece/.test(t) && /\$295/.test(t)), false);
}

// ── Los "gracias" ───────────────────────────────────────────────────
{
  for (const t of ["Gracias", "gracias!!", "Ok gracias", "Gracias...aun no tengo la inicial , pero me pondré en eso", "👍", "listo"]) comprobar(`"${t}" es un agradecimiento`, esAgradecimiento(t));
  for (const t of ["gracias, y tienen el A57?", "¿y el precio?", "quiero el A57"]) comprobar(`"${t}" NO es solo un agradecimiento`, esAgradecimiento(t), false);
  const r = await pedir("Gracias...aun no tengo la inicial , pero me pondré en eso", "Redmi Pad 2", {
    fila: { ultimos_productos: JSON.stringify(["Redmi Pad 2"]), mostrados: JSON.stringify(["Redmi Pad 2"]) },
    respuesta: "¡Con gusto! Cuando la tengas, aquí estoy para apartarte el Redmi Pad 2 😊",
  });
  comprobar("turno: a 'gracias, aún no tengo la inicial' le contesta con lo que hablaban…", /apartarte el Redmi Pad 2/.test(textos(r.enviados).join(" ")));
  comprobar("…sin volver a mandarle fichas ni tablas", titulos(r.enviados).length === 0 && !textos(r.enviados).some((t) => /Nivel 1|inicial \(/.test(t)), true);
}

// ── Lo que preguntan los botones de los anuncios ────────────────────
{
  const r = await turno({ texto: "¿Está disponible?", respuestaDelModelo: { respuesta: "¡Hola! Soy la asistente virtual de EPICCELL 👋 ¿Qué equipo estás buscando? 😊", buscar: "NADA" }, hoja: HOJA });
  comprobar("'¿Está disponible?' a secas → '¿de cuál equipo? te digo si está'", /te digo al momento si está/.test(textos(r.enviados).join(" ")));
}

// ── Los nombres de los modelos ──────────────────────────────────────
{
  comprobar("'pro+' = 'pro plus', '15 C' = '15C', 'A 57' = 'A57'", [juntarModelo("note 15 pro+").replace(/\s+/g, " ").trim(), juntarModelo("redmi 15 C"), juntarModelo("Samsung A 57")], ["note 15 pro plus", "redmi 15C", "Samsung A57"]);
  let r = await pedir("Precio del redmi note 15?", "Redmi Note 15", { respuesta: "¡Claro que sí! Aquí lo tienes 👇" });
  comprobar("'redmi note 15' (no hay) → solo el Note 15 Pro+, sin decir que es ese", titulos(r.enviados), ["Redmi Note 15 pro + 5G"]);
  comprobar("…y sin '¡aquí lo tienes!'", /aqu[ií] lo tienes/i.test(textos(r.enviados)[0]), false);
  r = await pedir("Redmi note 15 pro plus 5g", "Redmi Note 15 Pro Plus 5G", { respuesta: "Ahora mismo no tengo el Redmi Note 15 Pro Plus 5G 😅" });
  comprobar("'pro plus' ES el 'pro +': sin 'no lo tengo'", /no tengo/i.test(textos(r.enviados).join(" ")) === false && titulos(r.enviados)[0] === "Redmi Note 15 pro + 5G", true);
  r = await pedir("Cuánto cuesta el redmi 15 C?", "Redmi 15C", { respuesta: "Justo el Redmi 15C no me queda 😅" });
  comprobar("'redmi 15 C' ES el 15c: sin 'no me queda'", /no me queda/i.test(textos(r.enviados).join(" ")) === false && titulos(r.enviados)[0] === "Redmi 15c", true);
  r = await pedir("Redmi note 17 pro max 5g de 8/512gb VS Redmi note 15 pro plus 5g de 12/512gb cual es mejor ?", "Redmi Note 17 Pro Max 5G");
  comprobar("comparar dos ('17 pro max VS 15 pro plus') → los dos, sin 'ese no lo tengo'", titulos(r.enviados).sort(), ["Redmi Note 15 pro + 5G", "Redmi Note 17 Pro Max 5G"]);
  r = await pedir("cual es mejor el samsung a57 o el a37?", "Samsung A57");
  comprobar("'¿el A57 o el A37?' → los dos", titulos(r.enviados).includes("Samsung A37") && titulos(r.enviados).includes("Samsung A57"), true);
}

// ── "Xbyte" a secas, y el precio con errata ─────────────────────────
{
  let r = await pedir("Xbyte", "NADA", { respuesta: "No logro identificar \"Xbyte\" 😅" });
  comprobar("'Xbyte' a secas → todo lo de Xbyte (también el OTG, que ya no cuenta como teléfono)", titulos(r.enviados).length, 3);
  comprobar("…sin 'de teléfonos de esa marca no me queda'", /tel[eé]fonos/i.test(textos(r.enviados).join(" ")), false);
  r = await pedir("Xbite", "NADA", { respuesta: "No logro identificar \"Xbite\" 😅" });
  comprobar("'Xbite' (errata) → también", titulos(r.enviados).length, 3);
  r = await pedir("Prexio samsing A57", "Samsung A57", { respuesta: "Aquí tienes las opciones del Samsung A57: ¿Cuál te interesa?" });
  comprobar("'Prexio' (errata) → el precio va escrito", /💵 Samsung A57/.test(textos(r.enviados).join(" ")));
}

// ── Los dos puntos que presentaban una lista ────────────────────────
comprobar("'tengo dos relojes para ti:' sin la lista → 👇", sinListaPegada("Ahora tengo dos relojes disponibles para ti:\n- Reloj Honor\n- Reloj Xiaomi\nSi te interesa alguno, ¡dímelo! 😊"), "Ahora tengo dos relojes disponibles para ti 👇\nSi te interesa alguno, ¡dímelo! 😊");

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
