// SIN CUPO NO ES "NO ESTÁ": una ronda de cotejo que OpenAI rechazó por
// cupo no puede contar como mirada.
//
// QUÉ SE PROTEGE. Caso real del 30-sep-2026: una historia con unos Adidas
// que la tienda SÍ tiene. La ronda del índice con los 8 más parecidos se
// cayó por el límite de gpt-4o (Limit 30000, Used 25511, Requested 7819),
// el modelo no vio ni una foto... y el registro dijo "ya miré los 14 más
// parecidos", el bot contestó que no lo reconocía y al asesor le llegó
// "no supe qué calzado es".
//
// Y de paso el "107% hecho" de /indexar-catalogo y el falso "se están
// pisando" del mismo día: completarle el color a un producto que ya estaba
// indexado reescribe su fila, no suma una nueva.
//
// Aquí OpenAI, Shopify y el CDN son de mentira (se cambia fetch), así que
// se puede hacer que OpenAI conteste 429 justo cuando interesa.

import { prepararSrc, baseDeMentira, ok, titulo, terminar } from "./ayuda.mjs";

const SIN = {
  camaraAireTalon: false, camaraAireCompleta: false, suelaTransparente: false,
  suelaRedondeadaSinAire: false, suelaPlanaPlacaDura: false, muescaLateralArco: false,
  suelaNubesHuecas: false, mallaPlasticaCuadros: false, alasPlasticasCordones: false,
  jumpman: false, swooshGrandeRecto: false, piezaMetalicaOjal: false, tresFranjas: false,
  punteraGamuzaT: false, punteraGomaConcha: false,
};

// 250 productos: por encima de INDICE_SUFICIENTE (200), como en producción,
// para que el cotejo NO caiga al barrido de Shopify.
const INDICE = Array.from({ length: 250 }, (_, i) => ({
  titulo: `Modelo ${i}`,
  imagen: `https://cdn.test/p${i}.jpg`,
  precio: "$50,00",
  url: `/p/${i}`,
  visto: `zapato ${i}`,
  rasgos: { ...SIN, tresFranjas: i < 20 },
  color: i % 2 ? "blanco" : "negro",
}));

const FOTO = "data:image/jpeg;base64,AAAA";
const ENV_BASE = { OPENAI_API_KEY: "x", SHOPIFY_TIENDA: "tienda.test", SHOPIFY_TOKEN: "x" };

// ── fetch de mentira ─────────────────────────────────────────────────
//
// "openai" es la lista de lo que contesta OpenAI, en orden. Cada entrada es
// 429 (sin cupo) o un objeto que va como contenido de la respuesta.
function fetchDeMentira({ openai = [], catalogo = [] }) {
  const llamadas = [];
  const cola = [...openai];

  const falso = async (url, opciones = {}) => {
    const u = String(url);

    if (u.includes("api.openai.com")) {
      const cuerpo = JSON.parse(opciones.body);
      llamadas.push(cuerpo);
      const turno = cola.length ? cola.shift() : 429;
      if (turno === 429) {
        return new Response(
          JSON.stringify({
            error: {
              message:
                "Rate limit reached for gpt-4o in organization org-x on tokens per min (TPM): " +
                "Limit 30000, Used 25511, Requested 7819. Please try again in 1s.",
            },
          }),
          { status: 429, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(turno) } }],
          usage: { prompt_tokens: 100, completion_tokens: 10 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (u.includes("/graphql.json")) {
      const edges = catalogo.map((p) => ({
        node: { title: p.titulo, featuredImage: { url: p.imagen }, onlineStoreUrl: p.url,
                priceRangeV2: { minVariantPrice: { amount: "50.0", currencyCode: "USD" } } },
      }));
      return new Response(
        JSON.stringify({ data: { products: { edges, pageInfo: { hasNextPage: false } } } }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    // Cualquier otra cosa es una foto del catálogo.
    return new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    });
  };

  return { falso, llamadas };
}

// Qué candidatos vio el modelo en una llamada de cotejo (sus títulos).
function titulosDe(cuerpo) {
  if (!cuerpo) return [];
  return cuerpo.messages[1].content
    .filter((c) => c.type === "text" && /^\d+\. /.test(c.text))
    .map((c) => c.text.replace(/^\d+\. /, ""));
}

// Cada escenario con su copia de src/: el límite de OpenAI se recuerda en
// el módulo (ia.js) y no puede pasar de un escenario a otro.
async function escenario({ openai, catalogo = [], sinIndice = false }) {
  const src = await prepararSrc();
  const I = await src.cargar("indice.js");
  const C = await src.cargar("cotejo.js");
  const base = baseDeMentira();
  if (!sinIndice) await I.guardarIndexados(base.DB, INDICE);

  const { falso, llamadas } = fetchDeMentira({ openai, catalogo });
  const env = { ...ENV_BASE, DB: base.DB };

  // Lo que se escribe en el registro, para comprobar que no miente.
  const registro = [];
  const log = console.log;
  const error = console.error;

  return {
    I, C, env, base, llamadas, registro,
    async correr(fn) {
      const fetchReal = globalThis.fetch;
      globalThis.fetch = falso;
      console.log = (...a) => registro.push(a.join(" "));
      console.error = (...a) => registro.push(a.join(" "));
      try {
        return await fn();
      } finally {
        globalThis.fetch = fetchReal;
        console.log = log;
        console.error = error;
        src.limpiar();
      }
    },
  };
}

const NINGUNO = { eleccion: 0, confianza: "alta", porque: "ninguno coincide" };
const EL_PRIMERO = { eleccion: 1, confianza: "alta", porque: "mismo par" };

// ───────────────────────────────────────────────────────────────────────
titulo("el incidente: 429 en la ronda del índice, sin tiempo para esperar");
{
  const e = await escenario({ openai: [429] });
  const informe = {};
  const r = await e.correr(() =>
    e.C.cotejoPorImagen({
      env: e.env, foto: FOTO, textoCliente: "", productos: [], termino: "NADA",
      rasgos: { ...SIN, tresFranjas: true }, color: "blanco", visto: "zapato",
      informe, // sin recibidoEn: no se sabe cuánto queda, no se espera
    })
  );
  const todo = e.registro.join("\n");

  ok(r === null, "no inventa un resultado");
  ok(informe.sinCupo === true, "queda apuntado que algo se quedó SIN MIRAR por cupo");
  ok(e.llamadas.length === 1, "no machaca a OpenAI con la segunda ronda", `${e.llamadas.length} llamada(s)`);
  ok(!/ya miré los \d+ más parecidos/.test(todo),
     'el registro ya no dice "ya miré los N más parecidos" cuando no miró nada');
  ok(/NO LO MIRÉ TODO/.test(todo), "dice claramente que no pudo mirarlo todo");
}

// ───────────────────────────────────────────────────────────────────────
titulo("429 y SÍ da el tiempo: espera al cupo, reintenta y lo encuentra");
{
  const e = await escenario({ openai: [429, EL_PRIMERO] });
  const informe = {};
  const antes = Date.now();
  const r = await e.correr(() =>
    e.C.cotejoPorImagen({
      env: e.env, foto: FOTO, textoCliente: "", productos: [], termino: "NADA",
      rasgos: { ...SIN, tresFranjas: true }, color: "blanco", visto: "zapato",
      recibidoEn: Date.now(), informe,
    })
  );
  const tardo = Date.now() - antes;

  ok(r?.elegido, "encuentra el zapato en el reintento");
  ok(informe.sinCupo === false, "y no queda marcado como sin cupo");
  ok(e.llamadas.length === 2, "exactamente un reintento", `${e.llamadas.length} llamada(s)`);
  ok(
    e.llamadas.length === 2 &&
      JSON.stringify(titulosDe(e.llamadas[0])) === JSON.stringify(titulosDe(e.llamadas[1])),
    "el reintento es con LOS MISMOS candidatos que el cupo dejó sin mirar"
  );
  ok(tardo >= 1000 && tardo < 5000, "esperó lo que pidió OpenAI (1s), no más", `${tardo} ms`);
}

// ───────────────────────────────────────────────────────────────────────
titulo("429 con el reloj casi agotado: no espera, no se pasa de los 30 s");
{
  const e = await escenario({ openai: [429, EL_PRIMERO] });
  const informe = {};
  const antes = Date.now();
  const r = await e.correr(() =>
    e.C.cotejoPorImagen({
      env: e.env, foto: FOTO, textoCliente: "", productos: [], termino: "NADA",
      rasgos: { ...SIN, tresFranjas: true }, color: "blanco", visto: "zapato",
      // Llegó hace 18 s: quedan 7 para contestar, y una ronda son 7.
      recibidoEn: Date.now() - 18000, informe,
    })
  );

  ok(r === null && informe.sinCupo === true, "no reintenta y lo deja apuntado");
  ok(e.llamadas.length === 1, "una sola llamada", `${e.llamadas.length}`);
  ok(Date.now() - antes < 1000, "y no se quedó esperando", `${Date.now() - antes} ms`);
}

// ───────────────────────────────────────────────────────────────────────
titulo("el modelo SÍ miró y dijo que ninguno: eso sí cuenta como mirado");
{
  const e = await escenario({ openai: [NINGUNO, NINGUNO] });
  const informe = {};
  const r = await e.correr(() =>
    e.C.cotejoPorImagen({
      env: e.env, foto: FOTO, textoCliente: "", productos: [], termino: "NADA",
      rasgos: { ...SIN, tresFranjas: true }, color: "blanco", visto: "zapato",
      informe,
    })
  );
  const [uno, dos] = e.llamadas.map(titulosDe);

  ok(r === null && informe.sinCupo === false, "no es un problema de cupo: no se marca");
  ok(e.llamadas.length === 2, "baja a la segunda ronda del ranking", `${e.llamadas.length}`);
  ok(uno && dos && !uno.some((t) => dos.includes(t)),
     "y la segunda ronda NO repite ninguno de la primera");
  ok(/ya miré los 16 más parecidos/.test(e.registro.join("\n")),
     "el registro cuenta los 16 que de verdad miró");
}

// ───────────────────────────────────────────────────────────────────────
titulo("429 sobre los del NOMBRE: no se dan por rechazados");
{
  // La visión nombró el modelo y la búsqueda trajo 3. Antes, un 429 en esa
  // ronda los contaba como "mirados y rechazados", y eso mandaba al índice
  // a buscar OTRO modelo para cambiárselos al cliente.
  const e = await escenario({ openai: [429, 429, 429] });
  const productos = [0, 1, 2].map((i) => ({
    titulo: `Jordan 40 color ${i}`, imagen: `https://cdn.test/j40-${i}.jpg`, precio: "$90,00", url: `/p/j${i}`,
  }));
  const informe = {};
  const r = await e.correr(() =>
    e.C.cotejoPorImagen({
      env: e.env, foto: FOTO, textoCliente: "precio", productos, termino: "Jordan 40",
      rasgos: { ...SIN, jumpman: true }, color: "negro", visto: "jumpman",
      nombreFiable: true, informe,
    })
  );

  ok(r === null, "devuelve null: decidir() enseña los 3 Jordan 40 que encontró la búsqueda");
  ok(e.llamadas.length === 1, "y no sigue al índice a buscar otro modelo", `${e.llamadas.length} llamada(s)`);
  ok(!/el nombre no es de fiar/.test(e.registro.join("\n")),
     'el registro no dice "el nombre no es de fiar"');
}

// ───────────────────────────────────────────────────────────────────────
titulo("/indexar-catalogo: completar el color no pasa del 100% ni da falsa alarma");
{
  // 250 en Shopify. En la base: los 250 indexados ANTES del color (NULL),
  // que es justo cómo quedó producción al desplegar la v27.
  const catalogo = INDICE.map(({ titulo, imagen, url }) => ({ titulo, imagen, url }));
  const rasgosOk = { visto: "zapato", rasgos: { ...SIN }, color: "blanco" };
  const e = await escenario({ openai: Array(40).fill(rasgosOk), catalogo, sinIndice: true });
  await e.I.guardarIndexados(e.base.DB, INDICE);
  e.base.sql.prepare("UPDATE catalogo SET color = NULL").run();

  const r = await e.correr(() => e.I.indexarTanda(e.env, { cuantos: 40 }));
  const hecho = Math.round(((r.yaEstaban + r.indexados) * 100) / r.indexables);
  const filas = e.base.sql.prepare("SELECT COUNT(*) AS n FROM catalogo").get().n;
  const conColor = e.base.sql.prepare("SELECT COUNT(*) AS n FROM catalogo WHERE color IS NOT NULL").get().n;

  ok(r.indexados === 40, "la tanda completa 40", `${r.indexados}`);
  ok(hecho <= 100, "el porcentaje no pasa del 100", `${hecho}%`);
  ok(hecho === 16, "y es el real: 40 de 250 con color", `${hecho}%`);
  ok(r.sinColor === 250, "dice cuántos esperan solo el color", `${r.sinColor}`);
  ok(filas === 250 && conColor === 40, "no se duplicó ni se perdió ninguna fila", `${filas} filas, ${conColor} con color`);
  ok(!/se están pisando/i.test(e.registro.join("\n")), 'sin el falso "se están pisando"');
}

{
  // Y la alarma tiene que seguir sonando cuando SÍ se pisan: dos productos
  // nuevos con la misma foto dejan una fila en vez de dos.
  const catalogo = [
    { titulo: "Nuevo A", imagen: "https://cdn.test/igual.jpg", url: "/p/a" },
    { titulo: "Nuevo B", imagen: "https://cdn.test/igual.jpg", url: "/p/b" },
  ];
  const rasgosOk = { visto: "zapato", rasgos: { ...SIN }, color: "negro" };
  const e = await escenario({ openai: [rasgosOk, rasgosOk], catalogo, sinIndice: true });
  await e.correr(() => e.I.indexarTanda(e.env, { cuantos: 40 }));
  ok(/se están pisando/i.test(e.registro.join("\n")), "la alarma de verdad sigue sonando");
}

// ───────────────────────────────────────────────────────────────────────
titulo("la visión solo dijo 'Nike': la primera ronda busca SOLO entre los Nike");
{
  // Caso real (30-sep): unas Nike Waffle grises, y el bot enseñó P6000. En
  // el catálogo hay de todo lo gris; la Waffle, contra el catálogo entero,
  // quedaba fuera de los 16 más parecidos.
  const grises = Array.from({ length: 40 }, (_, i) => ({
    titulo: `Adidas gris ${i}`, imagen: `https://cdn.test/a${i}.jpg`, precio: "$60", url: "",
    visto: "zapatilla gris suela blanca", rasgos: { ...SIN, suelaRedondeadaSinAire: true }, color: "gris",
  }));
  const nikes = Array.from({ length: 12 }, (_, i) => ({
    titulo: i === 11 ? "Nike waffle trainer 2 caballero" : `Nike modelo ${i}`,
    imagen: `https://cdn.test/n${i}.jpg`, precio: "$75", url: "",
    // La Waffle de verdad: gris, gamuza, swoosh negro. Los demás Nike, negros.
    visto: i === 11 ? "zapatilla gris gamuza swoosh negro suela blanca" : "zapatilla",
    rasgos: i === 11 ? { ...SIN, suelaRedondeadaSinAire: true } : { ...SIN },
    color: i === 11 ? "gris" : "negro",
  }));
  const src = await prepararSrc();
  const I = await src.cargar("indice.js");
  const C = await src.cargar("cotejo.js");
  const base = baseDeMentira();
  await I.guardarIndexados(base.DB, [...grises, ...nikes]);
  const { falso, llamadas } = fetchDeMentira({ openai: [NINGUNO, NINGUNO] });
  const fetchReal = globalThis.fetch;
  const log = console.log;
  globalThis.fetch = falso;
  console.log = () => {};
  try {
    await C.cotejoPorImagen({
      env: { ...ENV_BASE, DB: base.DB }, foto: FOTO, textoCliente: "Precio", productos: [], termino: "Nike",
      rasgos: { ...SIN, suelaRedondeadaSinAire: true }, color: "gris", visto: "zapatilla gris suela blanca",
      informe: {},
    });
  } finally {
    globalThis.fetch = fetchReal;
    console.log = log;
    src.limpiar();
  }
  const primera = titulosDe(llamadas[0]);
  ok(primera.length > 0 && primera.every((t) => /nike/i.test(t)), "la ronda 1 compara SOLO Nike", primera.join(" · ").slice(0, 90));
  ok(primera.some((t) => /waffle/i.test(t)), "y la Waffle está entre ellos (contra el catálogo entero no entraba)");
  const segunda = titulosDe(llamadas[1]);
  ok(segunda.some((t) => /adidas/i.test(t)), "la ronda 2 vuelve al catálogo entero, por si la marca no era");
}

titulo("confianza 'media': no se afirma, pero la pista se guarda");
{
  const e = await escenario({ openai: [{ eleccion: 2, confianza: "media", porque: "se parece" }, NINGUNO] });
  const informe = {};
  const r = await e.correr(() =>
    e.C.cotejoPorImagen({
      env: e.env, foto: FOTO, textoCliente: "", productos: [], termino: "NADA",
      rasgos: { ...SIN, tresFranjas: true }, color: "blanco", visto: "zapato", informe,
    })
  );
  const segundoDeLaRonda = titulosDe(e.llamadas[0])[1];
  ok(r === null, "no la da por encontrada (no se le dice 'es este')");
  ok(informe.mejorMedia && informe.mejorMedia.titulo === segundoDeLaRonda,
     "pero queda la pista para enseñarla PRIMERO", informe.mejorMedia?.titulo);
}

terminar();
