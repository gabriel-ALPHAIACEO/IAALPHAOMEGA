// LOS DATOS DE LA TIENDA: HORARIO, FORMAS DE PAGO, DIRECCIÓN, ENVÍOS...
//
// Los contesta el código con lo que está en wrangler.toml, tal cual. El
// modelo no los sabe, y un modelo sin un dato lo inventa: en la revisión
// del 29-sep-2026 contestó "abrimos de 8 a 5" (son 9 a 7).
//
// Lo que se comprueba: que cada pregunta se reconozca, que salga el texto
// EXACTO del dueño, que un dato vacío vaya al asesor y no se invente, y
// que Cashea y Krece sigan teniendo su propia respuesta.
import { turno } from "./banco.mjs";
import { queDatoPide, respuestaDeDato } from "./.stub/datos.js";

let fallos = 0;
const comprobar = (n, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};

// El texto que pidió el dueño, tal como va en wrangler.toml (con \n).
const METODOS_PAGO =
  "Aceptamos los siguientes métodos de pago:\\n• Pago Móvil\\n• Transferencia bancaria\\n\\n🌎 Internacional:\\n• Zelle\\n• PayPal\\n• Binance (USDT)";
const COMO_LO_LEE_EL_CLIENTE =
  "Aceptamos los siguientes métodos de pago:\n• Pago Móvil\n• Transferencia bancaria\n\n🌎 Internacional:\n• Zelle\n• PayPal\n• Binance (USDT)";

// ── Qué pregunta es ───────────────────────────────────────────
for (const [frase, tema] of [
  ["que metodos de pago aceptan?", "pagos"],
  ["Formas de pago?", "pagos"],
  ["como puedo pagar", "pagos"],
  ["aceptan zelle?", "pagos"],
  ["se puede pagar con binance", "pagos"],
  ["tienen pago movil", "pagos"],
  ["a que hora abren?", "horarios"],
  ["donde estan ubicados", "ubicacion"],
  ["hacen envios a valencia?", "envios"],
  ["tienen delivery", "delivery"],
  ["a como tienen el dolar", "tasa"],
  ["estan contratando?", "trabajo"],
  ["hola, hay trabajo?", "trabajo"],
  ["quiero trabajar con ustedes", "trabajo"],
  ["necesitan vendedores?", "trabajo"],
  ["busco empleo", "trabajo"],
  ["un telefono bueno para el trabajo", ""],
]) {
  comprobar(`"${frase}" → ${tema}`, queDatoPide(frase), tema);
}

// Cashea y Krece tienen su propia respuesta, con los niveles.
comprobar("Cashea NO es esto", queDatoPide("aceptan cashea?"), "");
comprobar("ni las cuotas", queDatoPide("se puede pagar en cuotas"), "");
// Quien YA pagó no pregunta cómo pagar.
comprobar("\"ya te hice la transferencia\" no es preguntar", queDatoPide("ya te hice la transferencia"), "");
comprobar("ni mandar el comprobante del zelle", queDatoPide("te mando el comprobante del zelle"), "");
comprobar("ni \"ya pagué por pago movil\"", queDatoPide("ya pagué por pago movil"), "");
comprobar("una pregunta de producto no es un dato", queDatoPide("tienen el redmi note 17?"), "");

// ── Qué se contesta ───────────────────────────────────────────
comprobar(
  "las formas de pago salen TAL CUAL, con sus saltos de línea",
  respuestaDeDato("pagos", { METODOS_PAGO }),
  { texto: COMO_LO_LEE_EL_CLIENTE, alAsesor: false }
);
comprobar(
  "sin cargar, las confirma un asesor (no se inventan)",
  respuestaDeDato("pagos", {}).alAsesor,
  true
);
comprobar(
  "un relleno de plantilla cuenta como vacío",
  respuestaDeDato("envios", { ENVIOS: "CAMBIA-ESTO" }).alAsesor,
  true
);
comprobar(
  "el horario, el de la tienda",
  respuestaDeDato("horarios", { HORARIOS: "De 9am a 7pm" }).texto,
  "De 9am a 7pm"
);

// Quien busca trabajo: la respuesta de Invictus, sin molestar al asesor.
comprobar("trabajo sin cargar: contesta igual, sin asesor", respuestaDeDato("trabajo", {}).alAsesor, false);
comprobar("con la de Invictus (personal completo, historias)", /personal completo[\s\S]*historias/.test(respuestaDeDato("trabajo", {}).texto), true);
comprobar("y si se carga TRABAJO, manda eso", respuestaDeDato("trabajo", { TRABAJO: "Deja tu CV" }).texto, "Deja tu CV");

// La dirección con su mapa.
const conMapa = respuestaDeDato("ubicacion", { DIRECCION: "C.C. Tal, local 12", MAPS_URL: "https://maps.app.goo.gl/xyz" });
comprobar("la dirección sale escrita", /C\.C\. Tal, local 12/.test(conMapa.texto), true);
comprobar("con el botón Cómo llegar", conMapa.boton?.url, "https://maps.app.goo.gl/xyz");
comprobar("solo el mapa: sale el botón igual", respuestaDeDato("ubicacion", { MAPS_URL: "https://maps.app.goo.gl/xyz" }).boton?.url, "https://maps.app.goo.gl/xyz");
comprobar("sin dirección ni mapa: asesor", respuestaDeDato("ubicacion", {}).alAsesor, true);

// ── El turno entero ───────────────────────────────────────────
{
  const { enviados, alModelo } = await turno({
    texto: "que metodos de pago aceptan?",
    env: { METODOS_PAGO },
  });
  comprobar("al cliente le llega UN mensaje", enviados.length, 1);
  comprobar("y es el texto del dueño", enviados[0]?.text, COMO_LO_LEE_EL_CLIENTE);
  comprobar("sin pasar por el modelo", alModelo.length, 0);
}

{
  // "¿aceptan zelle?" suelto también.
  const { enviados } = await turno({ texto: "aceptan zelle?", env: { METODOS_PAGO } });
  comprobar("\"aceptan zelle?\" → la lista", enviados[0]?.text, COMO_LO_LEE_EL_CLIENTE);
}

{
  // Si nombra un equipo, contesta el modelo: y el modelo tiene que tener
  // la lista delante, o se la inventa.
  const { alModelo } = await turno({
    texto: "el Samsung A57 lo puedo pagar con zelle?",
    env: { METODOS_PAGO },
  });
  const sistema = alModelo[0]?.messages?.find((m) => m.role === "system")?.content || "";
  comprobar("con un equipo en la frase, va al modelo", alModelo.length > 0, true);
  comprobar("y el modelo conoce las formas de pago", sistema.includes("• Binance (USDT)"), true);
  comprobar("sin el hueco de la plantilla", sistema.includes("{{METODOS DE PAGO}}"), false);
}

{
  // Sin cargar: el modelo sabe que NO las sabe.
  const { alModelo } = await turno({ texto: "el Samsung A57 lo puedo pagar con zelle?" });
  const sistema = alModelo[0]?.messages?.find((m) => m.role === "system")?.content || "";
  comprobar("sin cargar, el modelo sabe que no las sabe", /NO SABES las formas de pago/.test(sistema), true);
}

{
  // El turno: "¿dónde están?" → texto con el botón que abre Google Maps.
  const { enviados, alModelo } = await turno({
    texto: "donde estan ubicados?",
    env: { DIRECCION: "C.C. Tal, local 12", MAPS_URL: "https://maps.app.goo.gl/xyz" },
  });
  const plantilla = enviados[0]?.attachment?.payload;
  comprobar("\"¿dónde están?\" → un mensaje con botón", plantilla?.template_type, "button");
  comprobar("que abre Google Maps", plantilla?.buttons?.[0]?.url, "https://maps.app.goo.gl/xyz");
  comprobar("con la dirección en el texto", /local 12/.test(plantilla?.text || ""), true);
  comprobar("sin gastar una llamada a la IA", alModelo.length, 0);
}

{
  // Mezclado con un equipo contesta la IA: tiene que saber la dirección.
  const { alModelo } = await turno({
    texto: "el Samsung A57 lo tienen? y donde quedan?",
    env: { DIRECCION: "C.C. Tal, local 12", MAPS_URL: "https://maps.app.goo.gl/xyz" },
  });
  const sistema = alModelo[0]?.messages?.find((m) => m.role === "system")?.content || "";
  comprobar("mezclado con un equipo, la IA conoce la dirección", /Dirección: C\.C\. Tal, local 12/.test(sistema), true);
  comprobar("y el mapa", /maps\.app\.goo\.gl\/xyz/.test(sistema), true);
}

console.log(fallos ? `\n${fallos} fallo(s)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
