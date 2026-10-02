// EL PANEL DE ANUNCIOS (/anuncios) Y EL EQUIPO PUESTO A MANO (2-oct-2026).
// Meta (graph.facebook.com), la hoja y la base son de mentira.
import worker from "./.stub/index.js";
import { HOJA, baseFalsa, turno } from "./banco.mjs";

let fallos = 0;
const comprobar = (n, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};

const ANUNCIOS = [
  { id: "111", name: "A57 en cuotas", campaign: { name: "Octubre" }, creative: { title: "Samsung A57 12/512", body: "Llévatelo con Cashea" } },
  { id: "222", name: "Poco X99", campaign: { name: "Octubre" }, creative: { title: "Poco X99 pro", body: "Nuevo" } },
  { id: "333", name: "Oferta", campaign: { name: "Octubre" }, creative: { title: "¡Oferta!", body: "Solo esta semana" } },
  { id: "444", name: "Poco a mano", campaign: { name: "Octubre" }, creative: { title: "Mira esto", body: "" } },
];

function meta({ token = "ok", cuentas = [{ account_id: "999", name: "EPICELL", account_status: 1 }] } = {}) {
  return async (url) => {
    const u = String(url);
    if (u.includes("docs.google.com")) return { ok: true, status: 200, text: async () => HOJA };
    if (u.includes("graph.facebook.com")) {
      const json = (d, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => d });
      if (token === "vencido") return json({ error: { code: 190, message: "Error validating access token: Session has expired" } }, false);
      if (u.includes("/me?")) return json({ id: "1", name: "Bot EPICELL" });
      if (u.includes("/me/permissions")) return json({ data: token === "sin-permiso" ? [{ permission: "pages_show_list", status: "granted" }] : [{ permission: "ads_read", status: "granted" }] });
      if (u.includes("/me/adaccounts")) return json({ data: cuentas });
      if (u.includes("/act_999/ads")) return json({ data: ANUNCIOS });
    }
    return { ok: false, status: 404, text: async () => "", json: async () => ({}) };
  };
}

async function panel(env = {}, opciones = {}) {
  globalThis.fetch = meta(opciones);
  const log = console.log, err = console.error;
  console.log = console.error = () => {};
  try {
    const r = await worker.fetch(new Request("https://bot/anuncios"), { DB: baseFalsa(), SHEET_ID: `panel${Math.random()}`, ADS_TOKEN: "t", ...env }, { waitUntil() {} });
    return await r.text();
  } finally {
    console.log = log; console.error = err;
  }
}

let t = await panel({ ANUNCIOS_EQUIPOS: "444=Poco X8 pro 5G" });
comprobar("el token funciona", /✓ funciona \(Bot EPICELL\)/.test(t), true);
comprobar("ve la cuenta publicitaria", /act_999\s+EPICELL \(activa\)/.test(t), true);
comprobar("los 4 anuncios activos", /ANUNCIOS ACTIVOS \(4\)/.test(t), true);
comprobar("el del A57: manda el A57", /✓ manda el Samsung A57/.test(t), true);
comprobar("el del Poco X99 (no está): avisa que está AGOTADO", /trae gente al .*X99.*AGOTADO/i.test(t), true);
comprobar("el de '¡Oferta!': no sabe cuál es, y dice cómo arreglarlo", /ANUNCIOS_EQUIPOS = "333=/.test(t), true);
comprobar("el puesto a mano: manda ese", /✓ manda el Poco X8 pro 5G \(puesto a mano\)/.test(t), true);

t = await panel({}, { token: "vencido" });
comprobar("token vencido: lo dice con esas palabras", /VENCIDO/.test(t), true);
comprobar("y explica cómo sacar uno que no caduca", /Usuarios del sistema/.test(t), true);

t = await panel({}, { token: "sin-permiso" });
comprobar("sin ads_read: lo dice", /falta: ads_read/.test(t), true);

t = await panel({}, { cuentas: [] });
comprobar("sin cuenta asignada: lo dice", /NO VE NINGUNA CUENTA PUBLICITARIA/.test(t), true);

t = await panel({ ADS_TOKEN: "" });
comprobar("sin ADS_TOKEN: lo dice", /FALTA el secreto ADS_TOKEN/.test(t), true);

// ── El equipo puesto a mano, en una conversación de verdad ───────────
{
  const r = await turno({
    texto: "info",
    mensaje: { anuncio: { fuente: "ADS", id: "555", titulo: "¡Oferta!", ref: "", foto: "", publicacion: "" } },
    env: { ANUNCIOS_EQUIPOS: "555=Samsung A57" },
    respuestaDelModelo: { respuesta: "¡Mira! 👇", buscar: "Samsung A57" },
  });
  const fichas = r.enviados.flatMap((m) => m.attachment?.payload?.elements || []).map((f) => f.title);
  comprobar("anuncio '¡Oferta!' con ANUNCIOS_EQUIPOS: manda el A57", fichas, ["Samsung A57"]);
  const alModelo = JSON.stringify(r.alModelo.at(-1)?.messages || []);
  comprobar("y la IA sabe que el anuncio es del A57", /Samsung A57/.test(alModelo), true);
}

console.log(fallos ? `\n${fallos} fallo(s)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
