// Lo que la tienda sabe de sí misma: horarios, ubicación, envíos,
// delivery, tasa, métodos de pago y empleo.
import { atenderMeta } from "./.stub/index.js";
import { queDatoPide, RESPUESTAS, ubicacionDe, nombraUnProducto } from "./.stub/datos.js";

let fallos = 0;
const comprobar = (n, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};

// ── Cada pregunta, a su respuesta ──────────────────────────────
comprobar("«a que hora abren?»", queDatoPide("a que hora abren?"), "horarios");
comprobar("«donde estan ubicados?»", queDatoPide("donde estan ubicados?"), "ubicacion");
comprobar("«como llego?»", queDatoPide("como llego?"), "ubicacion");
comprobar("«hacen envios a valencia?»", queDatoPide("hacen envios a valencia?"), "envios");
comprobar("«trabajan con mrw?»", queDatoPide("trabajan con mrw?"), "envios");
comprobar("«hacen delivery?»", queDatoPide("hacen delivery?"), "delivery");
comprobar("«a que tasa reciben?»", queDatoPide("a que tasa reciben?"), "tasa");
comprobar("«aceptan zelle?»", queDatoPide("aceptan zelle?"), "pagos");
comprobar("«estan contratando?»", queDatoPide("estan contratando?"), "trabajo");

comprobar("«tienen las air force?» no es ninguna", queDatoPide("tienen las air force?"), "");
comprobar("«me mandas fotos?» tampoco", queDatoPide("me mandas fotos?"), "");
comprobar("las cuotas siguen siendo de Cashea", queDatoPide("puedo pagar con cashea?"), "");

// ── Mezclada con un calzado: manda el calzado ──────────────────
comprobar("reconoce el modelo en el mensaje", nombraUnProducto("tienen las Air Force y hacen envios?"), "Air Force One blancas");
comprobar("y no se inventa uno donde no hay", nombraUnProducto("hacen envios?"), "");

// ── Los textos ─────────────────────────────────────────────────
for (const [tema, texto] of Object.entries(RESPUESTAS)) {
  comprobar(`${tema}: cabe en un mensaje`, [...texto].length <= 1000, true);
}
comprobar("horarios: los tres tramos", /lunes a viernes/i.test(RESPUESTAS.horarios) && /domingos/i.test(RESPUESTAS.horarios) && /feriados/i.test(RESPUESTAS.horarios), true);
comprobar("envíos: ZOOM y MRW", /ZOOM/.test(RESPUESTAS.envios) && /MRW/.test(RESPUESTAS.envios), true);
comprobar("pagos: los nueve métodos", ["Pago Móvil","Transferencia","Punto de venta","Zelle","PayPal","Zinli","Binance","Mercantil Panamá","Banesco Panamá"].every((m) => RESPUESTAS.pagos.includes(m)), true);
comprobar("pagos: NO promete mandar los datos", /te paso los datos|te env[ií]o los datos|escr[ií]beme/i.test(RESPUESTAS.pagos), false);
comprobar("pagos: cierra invitando a elegir", /Elige el que m[aá]s te convenga/.test(RESPUESTAS.pagos), true);

// ── La ubicación, con y sin datos ──────────────────────────────
comprobar("sin dirección puesta, no la inventa", ubicacionDe({ DIRECCION: "PENDIENTE: la direccion completa" }).completa, false);
comprobar("y sin enlace, sin botón", ubicacionDe({ MAPS_URL: "PENDIENTE: el enlace de Google Maps" }).maps, "");
const puesta = ubicacionDe({ DIRECCION: "Av. 4 de Mayo, local 3", MAPS_URL: "https://maps.app.goo.gl/abc", FOTO_LOCAL: "https://x/local.jpg" });
comprobar("con dirección, sale escrita", puesta.texto.includes("Av. 4 de Mayo, local 3"), true);

// ── El turno completo ──────────────────────────────────────────
const env0 = {
  SHOPIFY_TIENDA: "x.myshopify.com", SHOPIFY_TOKEN: "t", IG_TOKEN: "t",
  OPENAI_API_KEY: "k", URL_CATALOGO: "https://invictus.com",
  DIRECCION: "Av. 4 de Mayo, local 3", MAPS_URL: "https://maps.app.goo.gl/abc",
  FOTO_LOCAL: "",
};

async function turno(texto, respuestaDelModelo = {}) {
  const enviados = [];
  globalThis.fetch = async (url, opciones = {}) => {
    const donde = String(url);
    if (donde.includes("myshopify.com")) {
      return { ok: true, status: 200, json: async () => ({ data: { products: { edges: [
        { node: { title: "Air Force One blancas", onlineStoreUrl: "https://t/af1", featuredImage: { url: "https://x/af1.jpg" }, priceRangeV2: { minVariantPrice: { amount: "35.0", currencyCode: "USD" } } } },
      ] } } }) };
    }
    if (donde.includes("api.openai.com")) {
      const cuerpo = JSON.stringify({ respuesta: "Con gusto 😊", buscar: "NADA", historial: "Ya di la bienvenida.", ...respuestaDelModelo });
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: cuerpo } }] }) };
    }
    if (donde.includes("graph.instagram.com")) {
      if (donde.includes("/me/messages")) {
        enviados.push(JSON.parse(opciones.body).message);
        return { ok: true, status: 200, json: async () => ({ message_id: `m${enviados.length}` }) };
      }
      return { ok: true, status: 200, json: async () => ({ name: "Ana", username: "ana" }) };
    }
    return { ok: false, status: 404, text: async () => "", json: async () => ({}) };
  };

  const fila = { id: "c1", nombre: "Ana", historial: "Ya di la bienvenida.", pausado_hasta: 0, mids_enviados: "[]", ultimo_envio: 0, mostrados: "[]" };
  const DB = {
    prepare(sql) {
      return {
        bind() {
          const correr = async () => {
            if (/^SELECT \* FROM contactos/i.test(sql.trim())) return fila;
            if (/PRAGMA table_info/i.test(sql)) return { results: Object.keys(fila).concat(["nombre_completo", "usuario"]).map((name) => ({ name })) };
          };
          return { first: correr, run: correr, all: correr };
        },
        async first() { return null; },
        async all() { return { results: [] }; },
        async run() {},
      };
    },
  };

  await atenderMeta({ ...env0, DB }, { tipo: "texto", igsid: "c1", mid: "in1", texto, foto: "", historia: { url: "", id: "" } });
  return enviados;
}

async function turnoConFoto(texto) {
  const guardado = env0.FOTO_LOCAL;
  env0.FOTO_LOCAL = "https://x/local.jpg";
  const salida = await turno(texto);
  env0.FOTO_LOCAL = guardado;
  return salida;
}

let e = await turno("a que hora abren?");
comprobar("horarios: contesta él solo", /9:00am a 7:00pm/.test(e[0].text), true);
comprobar("y en un solo mensaje", e.length, 1);

e = await turno("donde estan?");
comprobar("ubicación: va con su botón de Maps", e[0].attachment.payload.buttons?.[0]?.title || e[0].attachment.payload.elements?.[0]?.buttons?.[0]?.title, "Cómo llegar");

e = await turno("aceptan zelle?");
comprobar("pagos: la lista entera", /Banesco Panamá/.test(e[0].text), true);

e = await turno("tienen las Air Force y hacen envios?", { respuesta: "¡Sí hacemos envíos por ZOOM y MRW! 📦 Mira estas 👇", buscar: "Air Force One" });
comprobar("mezclada: salen las fichas igual", e.some((m) => m.attachment?.payload?.elements?.length), true);

// ── El botón de la ubicación, en los tres casos ────────────────
const { ubicacionDe: ubi } = await import("./.stub/datos.js");

const soloDireccion = ubi({ DIRECCION: "Av. 4 de Mayo, CC Jumbo, local 3, Porlamar" });
comprobar("sin MAPS_URL, se arma el enlace con la dirección", soloDireccion.maps.startsWith("https://www.google.com/maps/search/"), true);
comprobar("y lleva la dirección dentro", decodeURIComponent(soloDireccion.maps).includes("Av. 4 de Mayo"), true);

const conEnlace = ubi({ DIRECCION: "Av. 4 de Mayo", MAPS_URL: "https://maps.app.goo.gl/abc" });
comprobar("con MAPS_URL puesto, manda ese", conEnlace.maps, "https://maps.app.goo.gl/abc");

comprobar("sin dirección ni enlace, no hay botón", ubi({}).maps, "");

// Con foto: dos mensajes, y la dirección NO se corta
let e2 = await turno("donde estan?");
comprobar("sin foto: un solo mensaje, con su botón", e2.length, 1);
comprobar("y la dirección va entera", e2[0].attachment.payload.text.includes("Av. 4 de Mayo, local 3"), true);

const antes = globalThis.fetch;
e2 = await turnoConFoto("donde estan?");
comprobar("con foto: la dirección va en texto, sin recortar", e2[0].text.includes("Av. 4 de Mayo, local 3"), true);
comprobar("y la tarjeta trae la foto y el botón", e2[1].attachment.payload.elements[0].buttons[0].title, "Cómo llegar");
comprobar("con un subtítulo que sí cabe", e2[1].attachment.payload.elements[0].subtitle.length <= 80, true);

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
