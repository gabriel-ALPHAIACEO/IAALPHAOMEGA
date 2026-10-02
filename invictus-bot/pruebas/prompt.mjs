// EL PROMPT QUE SE LE MANDA AL MODELO: que se arme entero y sin huecos.
//
// QUÉ SE PROTEGE. Los prompts llevan marcadores —{{CATALOGO}}, {{PAGOS}},
// {{TASA}}— que ia.js rellena al arrancar. Si uno se queda sin rellenar, el
// modelo recibe literalmente "{{PAGOS}}" y le contesta cualquier cosa al
// cliente. Es un fallo silencioso: no rompe nada, solo empeora las
// respuestas, y así puede pasar semanas sin que nadie lo note.
//
// Y también se comprueba que las reglas que se pelearon a golpes sigan
// escritas. Una regla que desaparece de un prompt no da error en ninguna
// parte: simplemente vuelve el problema que resolvió.

import { prepararSrc, prompt, fuente, ok, titulo, terminar } from "./ayuda.mjs";

const texto = prompt("texto.txt");
const vision = prompt("vision.txt");

titulo("los marcadores de texto.txt");

for (const marca of ["{{CATALOGO}}", "{{PAGOS}}", "{{TASA}}", "{{CASHEA}}", "{{UBICACION}}"]) {
  const veces = (texto.match(new RegExp(marca.replace(/[{}]/g, "\\$&"), "g")) || []).length;
  ok(veces === 1, `${marca} aparece exactamente una vez`, `${veces}`);
}
ok(!/\{\{(?!CATALOGO|PAGOS|TASA|CASHEA|UBICACION)\w+\}\}/.test(texto), "no hay ningún otro marcador suelto que nadie rellene");
ok((vision.match(/\{\{MODELOS\}\}/g) || []).length === 1, "vision.txt tiene un {{MODELOS}}");
ok(!/\{\{(?!MODELOS)\w+\}\}/.test(vision), "y ningún otro");

titulo("se rellenan de verdad al armar el prompt");

// La versión vacía de pagos.txt: comprueba el caso de una tienda sin cargar.
const PAGOS_VACIO = prompt("pagos.txt").replace(/^(?!#|\[|\s*$).*$/gm, "");

for (const [estado, txt] of [
  ["con los métodos y la tasa cargados", {}],
  ["con pagos.txt vacío", { "prompts/pagos.txt": PAGOS_VACIO }],
]) {
  const src = await prepararSrc({ txt });
  const ia = await src.cargar("ia.js");

  const registro = [];
  const logReal = console.log;
  console.log = (...a) => registro.push(a.join(" "));
  // Arma el prompt y después falla la llamada por no haber clave. Lo que
  // importa es lo primero; el fallo de red da igual.
  try {
    await ia.responderTexto({}, "hola");
  } catch {}
  console.log = logReal;

  const dice = (re) => registro.find((l) => re.test(l)) || "";
  titulo(estado);

  // LAS AFIRMACIONES NO SABEN DE QUÉ TIENDA SON. Se comparan contra lo que
  // esa tienda tiene cargado, así esta misma prueba vale para todas: una con
  // nueve métodos y otra recién montada sin ninguno tienen que pasar las dos.
  const pagos = await src.cargar("pagos.js");
  const cuantos = pagos.metodosDePago().length;
  const suTasa = pagos.tasaDePago();

  if (cuantos) {
    ok(
      new RegExp(`pegados al prompt: ${cuantos}`).test(dice(/m[eé]todos de pago/i)),
      `pega los ${cuantos} métodos de esta tienda`,
      dice(/m[eé]todos de pago/i)
    );
  } else {
    ok(/seguir[aá] yendo al asesor/.test(dice(/m[eé]todos de pago/i)), "sin métodos, avisa que va al asesor");
  }

  if (suTasa) {
    ok(dice(/^Tasa pegada/).includes(suTasa), "pega la tasa de esta tienda", dice(/^Tasa pegada/));
  } else {
    ok(/Sin tasa cargada/.test(dice(/tasa/i)), "sin tasa, avisa que va al asesor");
  }

  // El catálogo puede estar cargado o no —una tienda nueva empieza sin él— y
  // las dos cosas son correctas. Lo que NO puede es quedarse callado.
  ok(
    /Cat[aá]logo pegado al prompt|Sin cat[aá]logo cargado/.test(dice(/[Cc]at[aá]logo/)),
    "dice qué hizo con el catálogo",
    dice(/[Cc]at[aá]logo/)
  );

  src.limpiar();
}

titulo("las reglas que costaron sangre siguen escritas");

for (const [regla, donde, patron] of [
  ["español neutro, no '¿qué andas buscando?'", texto, /qué estás buscando|español neutro/i],
  ["la talla nunca va en la búsqueda", texto, /NUNCA metas la talla en "buscar"/],
  ["los métodos de pago se contestan", texto, /^MÉTODOS DE PAGO \(crítico\)$/m],
  ["prohibido prometer los datos de pago", texto, /PROHIBIDO decir que le vas a mandar los datos/],
  ["la tasa se contesta, la cifra no", texto, /^LA TASA \(crítico\)$/m],
  ["prohibido escribir una cifra de tasa", texto, /PROHIBIDO escribir una cifra de tasa/],
  ["el descuento por divisas sigue escalando", texto, /descuento, rebaja o mejor precio POR PAGAR EN/],
  ["'formas de pago' YA NO está en el NO puedes", texto, /^(?!.*NO puedes: env[ií]os, formas de pago)/],
  ["el texto escrito en el zapato va primero", vision, /TEXTO ESCRITO EN EL ZAPATO/i],
  ["el número del modelo no se adivina", vision, /EL NÚMERO DEL MODELO NO SE ADIVINA/],
  ["la vitrina manda al catálogo", vision, /UNA VITRINA/],
]) ok(patron.test(donde), regla);

ok(!/NO puedes: env[ií]os, formas de pago/.test(texto), "confirmado: 'formas de pago' fuera del NO puedes");

titulo("las reglas que viven en el código, no en el prompt");

const indexjs = fuente("index.js");
const cotejojs = fuente("cotejo.js");

for (const [regla, donde, patron] of [
  ["el catálogo NO es la respuesta por defecto", indexjs, /EL CATÁLOGO NO ES LA RESPUESTA POR DEFECTO/],
  ["el botón sale solo en tres casos", indexjs, /buscoSinExito \|\| seAcabaron \|\| hayMasDelCatalogo/],
  ["el carrusel de Instagram aguanta 10", indexjs, /MAXIMO_EN_CARRUSEL = 10/],
  ["se piden 60 antes de filtrar por color", indexjs, /CUANTOS_PARA_FILTRAR = 60/],
  ["cada envío se anota en el momento (pausa falsa)", indexjs, /ENVIAR Y ANOTAR TIENEN QUE SER UNA SOLA COSA/],
  ["a Meta se le responde 200 siempre", indexjs, /responde 200 siempre y rápido|le quita a Meta el motivo/],
  ["el aviso de pagos no se duplica", indexjs, /escalada && !avisePorLosPagos/],
  ["solo la confianza alta llega al cliente", cotejojs, /confianza|alta/i],
  ["dos rondas del índice, ocho cada una", cotejojs, /DESDE_EL_INDICE = 8[\s\S]*RONDAS_DEL_INDICE = 2/],
]) ok(patron.test(donde), regla);

titulo("los ejemplos del prompt son JSON válido");

let malos = 0;
let cuantos = 0;
for (const linea of texto.split("\n")) {
  const t = linea.trim();
  if (!t.startsWith('{"respuesta"')) continue;
  cuantos++;
  try {
    const o = JSON.parse(t);
    if (typeof o.respuesta !== "string" || typeof o.buscar !== "string") malos++;
  } catch {
    malos++;
    console.log(`        JSON roto: ${t.slice(0, 70)}`);
  }
}
ok(cuantos > 40, `hay ${cuantos} ejemplos de respuesta en el prompt`);
ok(malos === 0, "todos parsean y traen 'respuesta' y 'buscar'");

titulo("piensa antes de responder (2-oct)");
{
  const ia = fuente("ia.js");
  ok(/pienso: \{ type: "string" \}/.test(ia) && /required: \["pienso", "respuesta", "buscar", "historial"\]/.test(ia), "la respuesta de texto lleva 'pienso' PRIMERO y obligatorio");
  ok(/required: \["porque", "eleccion", "confianza"\]/.test(ia), "el cotejo dice el porqué ANTES de elegir");
  ok(/PIENSA ANTES DE RESPONDER/.test(texto) && /level 6/.test(texto), "el prompt explica cómo pensar, con el caso del level 6");
}

terminar();
