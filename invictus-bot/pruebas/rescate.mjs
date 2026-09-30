// "NO ES ESE": el bot deja de adivinar y llama a una persona.
//
// Caso real del 30-sep-2026, cliente perdido: respondió a una historia con
// unas Nike Waffle; el bot le enseñó P6000, luego Nike Trail, luego otra vez
// P6000, y el cliente se fue con un "será que estás ciego". Estas son SUS
// frases, tal cual las escribió.

import { prepararSrc, fuente, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const R = await src.cargar("rescate.js");
const tras = { yaLeMostre: true, deUnaFoto: true };

titulo("las frases del cliente que se perdió");

ok(R.hayQueRescatar("No ninguna de las q me estás mostrando", tras), '"No ninguna de las q me estás mostrando" → a un asesor (aquí se salvaba)');
ok(R.hayQueRescatar("Estoy preguntando por este☝️", tras), '"Estoy preguntando por este☝️" → a un asesor');
ok(R.hayQueRescatar("Olvídalo, serán q estás ciego", tras), '"Olvídalo, serán q estás ciego" → a un asesor');

titulo("otras formas de decir que no es");

for (const t of ["no es ese", "esa no es", "no son esos", "ninguno de esos", "no se parece", "no es el de la historia",
                 "el de la foto", "ese mismo que te mandé"]) {
  ok(R.hayQueRescatar(t, tras), `"${t}" → a un asesor`);
}

titulo("frustración o pide una persona: siempre, aunque no se le haya mostrado nada");

for (const t of ["no entiendes nada", "quiero hablar con una persona", "pásame con un asesor", "eres un bot?"]) {
  ok(R.hayQueRescatar(t, {}), `"${t}" → a un asesor`);
}

titulo("lo que NO es un rechazo no se toca");

for (const t of ["precio", "me gusta el segundo", "tienen en negro?", "y en talla 42?", "cuanto cuesta ese",
                 "ese me gusta", "es ese!", "sí, ese es", "tienen otros?", "hola"]) {
  ok(!R.hayQueRescatar(t, tras), `"${t}" → sigue normal`);
}
ok(!R.hayQueRescatar("no es ese", { yaLeMostre: false }), "sin haberle mostrado nada, un \"no es ese\" no rescata");
ok(!R.hayQueRescatar("estoy preguntando por este", { yaLeMostre: true, deUnaFoto: false }),
   "\"preguntando por este\" solo rescata si la conversación viene de una foto");

titulo("lo que pasa cuando rescata");

ok(/asesor/.test(R.FRASE_DE_RESCATE) && /Disculpa/.test(R.FRASE_DE_RESCATE) && !/\?/.test(R.FRASE_DE_RESCATE),
   "se disculpa y dice que lo atiende una persona (sin hacerle otra pregunta)");
const indice = fuente("index.js");
ok(/hayQueRescatar\(/.test(indice) && /pausado_hasta: Date\.now\(\) \+ horas/.test(indice),
   "index.js avisa al asesor y el bot se aparta (como cuando un asesor escribe)");

src.limpiar();
terminar();
