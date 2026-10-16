// EL AGENTE PUENTE, VISTO DESDE LA TIENDA (16-oct-2026, agentes.js): el
// latido, la orden «Sincronizar ahora» del panel, las alertas (error, sin
// señal, volvió) y la tarjeta de Inventario › Importar.
//
// Lo que no se puede romper:
//   · sin la clave no entra ningún latido, y lo que llega se guarda sin secretos;
//   · un error se avisa (Slack y panel central) UNA vez, no cada minuto;
//   · un «sigo vivo» no borra el error del último conteo;
//   · un agente callado se avisa una vez, y cuando vuelve se dice;
//   · la orden del panel llega al agente y, cumplida, se borra (una más nueva no);
//   · el panel enseña cada agente con su estado y nunca la clave;
//   · un latido nunca toca el inventario.

import { prepararSrc, baseDeMentira, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const con = await src.cargar("conectores.js");
const ag = await src.cargar("agentes.js");

const inv = await src.cargar("inventario.js");
const { DB, sql } = baseDeMentira();
await inv.asegurarInventario(DB);
const CLAVE = "clave-de-prueba-123";
const CENTRAL = { PANEL_CENTRAL_URL: "https://central.test", PANEL_API_CLAVE: "clave-del-central-0123456789", TIENDA_ID: "tienda-prueba" };
const env = { DB, SYNC_CLAVE: CLAVE, SLACK_WEBHOOK: "https://hooks.slack.test/x", ...CENTRAL };

async function llamar(ruta, { metodo = "GET", cuerpo, clave = CLAVE } = {}, entorno = env) {
  const headers = { "content-type": "application/json" };
  if (clave) headers.authorization = `Bearer ${clave}`;
  const solicitud = new Request(`https://bot.test${ruta}`, { method: metodo, headers, body: cuerpo === undefined ? undefined : typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo) });
  const r = await con.atenderSync(solicitud, entorno, new URL(solicitud.url), { waitUntil: () => {} });
  const texto = await r.text();
  let json = null;
  try {
    json = JSON.parse(texto);
  } catch {}
  return { estado: r.status, cuerpo: json, texto };
}

// Los avisos que salen (Slack y el panel central), sin red de verdad.
const avisos = [];
const fetchReal = globalThis.fetch;
globalThis.fetch = async (url, opciones = {}) => {
  const u = String(url);
  if (u.startsWith("https://hooks.slack.test")) {
    avisos.push({ a: "slack", texto: JSON.parse(opciones.body).text });
    return new Response("ok");
  }
  if (u.startsWith("https://central.test")) {
    const c = JSON.parse(opciones.body);
    for (const x of c.alertas) avisos.push({ a: "central", tienda: c.tienda, tipo: x.tipo, texto: x.texto });
    return new Response("{}");
  }
  return fetchReal(url, opciones);
};
const latir = (datos, entorno = env) => llamar("/api/sync/latido", { metodo: "POST", cuerpo: { agente: "caja-1", origen: "Profit", equipo: "PC Caja", version: "2.0.0", modo: "continuo", cadaMinutos: 15, ...datos } }, entorno);
const fila = (id = "caja-1") => sql.prepare("SELECT * FROM sync_agentes WHERE id = ?").get(id);
const eventos = (id = "caja-1") => sql.prepare("SELECT tipo, mensaje FROM sync_eventos WHERE agente = ? ORDER BY id").all(id);

try {
  titulo("la puerta del latido");
  {
    let r = await llamar("/api/sync/latido", { metodo: "POST", cuerpo: { agente: "x" }, clave: "" });
    ok(r.estado === 401, "sin la clave: 401", String(r.estado));
    r = await llamar("/api/sync/latido", { metodo: "POST", cuerpo: { agente: "x" } }, { DB });
    ok(r.estado === 503, "sin SYNC_CLAVE en la tienda: cerrada (503)");
    r = await llamar("/api/sync/latido");
    ok(r.estado === 405, "es POST");
    r = await llamar("/api/sync/latido", { metodo: "POST", cuerpo: "{no es json" });
    ok(r.estado === 400, "un JSON roto: 400");
    r = await llamar("/api/sync/latido", { metodo: "POST", cuerpo: [1, 2] });
    ok(r.estado === 400, "un latido que no es un objeto: 400");
    r = await llamar("/api/sync/latido", { metodo: "POST", cuerpo: { agente: "x", mensaje: "a".repeat(9000) } });
    ok(r.estado === 413, "un latido gigante: 413");
  }

  titulo("el primer latido registra al agente");
  {
    const productos = sql.prepare("SELECT COUNT(*) AS n FROM inv_productos").get()?.n ?? 0;
    const r = await latir({ estado: "inicio" });
    const a = fila();
    ok(r.estado === 200 && r.cuerpo.ok && Array.isArray(r.cuerpo.ordenes) && !r.cuerpo.ordenes.length, "contesta ok, sin órdenes", r.texto);
    ok(a && a.origen === "Profit" && a.equipo === "PC Caja" && a.modo === "continuo" && a.estado === "inicio", "guarda quién es, de qué PC y cómo corre", JSON.stringify(a));
    ok(eventos().some((e) => e.tipo === "inicio"), "y anota que se encendió");
    ok(r.cuerpo.silencioMin === 10, "le dice a los cuántos minutos sin señal se avisa (10 si corre siempre)", String(r.cuerpo.silencioMin));
    ok((sql.prepare("SELECT COUNT(*) AS n FROM inv_productos").get()?.n ?? 0) === productos, "un latido no toca el inventario");
    ok(!avisos.length, "y no avisa nada a nadie");
  }

  titulo("un conteo bueno, y un «sigo vivo» entre conteos");
  {
    await latir({ estado: "ok", ciclo: true, mensaje: "120 filas, 118 sin cambios", filas: 120, sinCambios: 118 });
    let a = fila();
    ok(a.estado === "ok" && a.ultimo_ok > 0 && a.filas === 120 && a.sin_cambios === 118 && a.ciclos_ok === 1, "el conteo bueno queda con sus números", JSON.stringify(a));
    await latir({ estado: "espera" });
    a = fila();
    ok(a.ciclos_ok === 1 && eventos().filter((e) => e.tipo === "ok").length === 1, "un «sigo vivo» no cuenta como conteo ni llena los hechos");
  }

  titulo("un error se avisa una vez, sin secretos");
  {
    avisos.length = 0;
    const r = await latir({ estado: "error", ciclo: true, mensaje: `El comando falló (código 2): Login failed. Password=SuperSecreta1; Bearer ${CLAVE}` });
    const a = fila();
    ok(r.estado === 200 && a.estado === "error" && /Login failed/.test(a.ultimo_error), "guarda el error con sus palabras", a.ultimo_error);
    ok(!/SuperSecreta1/.test(a.ultimo_error) && !a.ultimo_error.includes(CLAVE), "sin la contraseña ni la clave", a.ultimo_error);
    ok(avisos.some((x) => x.a === "slack" && /Profit \(PC Caja\) tiene un error/.test(x.texto)), "avisa por Slack", JSON.stringify(avisos));
    ok(avisos.some((x) => x.a === "central" && x.tipo === "puente" && x.tienda === "tienda-prueba"), "y al panel central (tipo «puente»)");
    ok(!JSON.stringify(avisos).includes("SuperSecreta1") && !JSON.stringify(avisos).includes(CLAVE), "los avisos tampoco llevan secretos");
    avisos.length = 0;
    await latir({ estado: "error", ciclo: true, mensaje: `El comando falló (código 2): Login failed. Password=SuperSecreta1; Bearer ${CLAVE}` });
    ok(!avisos.length, "el mismo error un minuto después: no se repite el aviso");
    await latir({ estado: "espera" });
    ok(fila().estado === "error", "un «sigo vivo» no borra el «con error» del panel");
    await latir({ estado: "error", ciclo: true, mensaje: "No encuentro el archivo C:\\exportes\\stock.csv" });
    ok(avisos.filter((x) => x.a === "slack").length === 1, "un error DISTINTO sí se avisa");
    avisos.length = 0;
    const cuando = Date.now() + ag.REPETIR_AVISO_MS + 60000;
    await ag.recibirLatido(env, { agente: "caja-1", origen: "Profit", estado: "error", ciclo: true, mensaje: "No encuentro el archivo C:\\exportes\\stock.csv" }, cuando);
    ok(avisos.filter((x) => x.a === "slack").length === 1, "y el mismo, pasadas 6 horas, se recuerda");
    avisos.length = 0;
    await latir({ estado: "ok", ciclo: true, mensaje: "120 filas", filas: 120 });
    ok(fila().estado === "ok" && avisos.some((x) => x.tipo === "puenteok" && /volvió a funcionar/.test(x.texto)), "el primer conteo bueno: «volvió a funcionar»", JSON.stringify(avisos));
    ok(eventos().some((e) => e.tipo === "volvio"), "y queda en sus hechos");
    avisos.length = 0;
    await latir({ estado: "ok", ciclo: true, mensaje: "120 filas", filas: 120 });
    ok(!avisos.length, "el siguiente conteo bueno ya no avisa nada");
  }

  titulo("un agente que deja de dar señal");
  {
    avisos.length = 0;
    const ultimo = fila().ultimo_latido;
    let n = await ag.vigilarAgentes(env, ultimo + 5 * 60000);
    ok(n === 0 && !avisos.length, "a los 5 minutos todavía no (corre siempre: avisa a los 10)");
    n = await ag.vigilarAgentes(env, ultimo + 11 * 60000);
    ok(n === 1 && avisos.some((x) => x.a === "slack" && /no da señal/.test(x.texto) && /encendida/.test(x.texto)), "a los 11 minutos: avisa, y dice qué revisar", JSON.stringify(avisos));
    ok(avisos.some((x) => x.a === "central" && x.tipo === "puente"), "también al panel central");
    avisos.length = 0;
    n = await ag.vigilarAgentes(env, ultimo + 40 * 60000);
    ok(n === 0 && !avisos.length, "y no repite el aviso en cada cron");
    ok(ag.estadoDelAgente(fila(), ultimo + 40 * 60000).clave === "sin_senal", "el panel lo ve «Sin señal»");
    await latir({ estado: "espera" });
    ok(avisos.some((x) => x.tipo === "puenteok" && /volvió a dar señal/.test(x.texto)), "cuando vuelve a latir: «volvió a dar señal»", JSON.stringify(avisos));
    ok(fila().silencio_avisado === 0, "y queda listo para avisar otra vez si se vuelve a callar");
    // Uno que corre por el Programador de tareas cada 15 min tiene más margen.
    await ag.recibirLatido(env, { agente: "otra-pc", estado: "ok", ciclo: true, modo: "una-vez", cadaMinutos: 15 });
    ok(ag.umbralDeSilencioMin(fila("otra-pc")) === 45, "uno que corre cada 15 min: 45 min de margen (3 vueltas)", String(ag.umbralDeSilencioMin(fila("otra-pc"))));
    ok(ag.umbralDeSilencioMin(fila("otra-pc"), { AGENTE_SILENCIO_MIN: "30" }) === 30, "AGENTE_SILENCIO_MIN lo cambia");
  }

  titulo("la orden «Sincronizar ahora»");
  {
    let r = await llamar("/api/sync/orden", { metodo: "POST" });
    ok(r.estado === 200 && r.cuerpo.orden === "sincronizar" && r.cuerpo.ordenEn > 0, "se pide (como el botón del panel)");
    const marca = r.cuerpo.ordenEn;
    r = await latir({ estado: "espera" });
    ok(r.cuerpo.ordenes.includes("sincronizar") && r.cuerpo.ordenEn === marca, "el siguiente latido la recibe", r.texto);
    r = await llamar("/api/sync/estado");
    ok(r.cuerpo.ordenPendiente === true, "/api/sync/estado la enseña pendiente");
    // Una orden más nueva, pedida mientras el agente sincronizaba, no se pierde.
    sql.prepare("UPDATE inv_ajustes SET valor = ? WHERE clave = 'sync_orden'").run(String(marca + 5000));
    r = await latir({ estado: "ok", ciclo: true, mensaje: "10 filas", ordenHecha: marca });
    ok(r.cuerpo.ordenes.includes("sincronizar"), "si pidieron otra mientras sincronizaba, esa sigue esperando");
    r = await latir({ estado: "ok", ciclo: true, mensaje: "10 filas", ordenHecha: marca + 5000 });
    ok(!r.cuerpo.ordenes.length && eventos().some((e) => e.tipo === "orden"), "cumplida, se borra y queda en sus hechos", r.texto);
  }

  titulo("/api/sync/estado enseña los agentes");
  {
    const r = await llamar("/api/sync/estado");
    const caja = r.cuerpo.agentes.find((x) => x.agente === "caja-1");
    ok(caja && caja.origen === "Profit" && caja.estado === "activo" && caja.ultimoOk > 0, "con su estado y su último conteo bueno", JSON.stringify(caja));
    ok(!r.texto.includes(CLAVE), "sin la clave");
  }

  titulo("los nombres raros y los de más");
  {
    await ag.recibirLatido(env, { agente: "<script>PC Ñ'1</script>", estado: "espera" });
    ok(sql.prepare("SELECT id FROM sync_agentes WHERE id LIKE '%script%'").get()?.id === "scriptpc 1script", "el nombre del agente se limpia", JSON.stringify(sql.prepare("SELECT id FROM sync_agentes").all()));
    for (let i = 0; i < ag.MAXIMO_DE_AGENTES; i++) await ag.recibirLatido(env, { agente: `pc-${i}`, estado: "espera" });
    const r = await latir({ agente: "uno-de-mas", estado: "espera" });
    ok(r.estado === 409 && /20 agentes/.test(r.cuerpo.error), "no más de 20 agentes por tienda", r.texto);
    for (let i = 0; i < ag.MAXIMO_DE_AGENTES; i++) await ag.borrarAgente(DB, `pc-${i}`);
    await ag.borrarAgente(DB, "scriptpc 1script");
    for (let i = 0; i < 130; i++) await ag.recibirLatido(env, { agente: "caja-1", origen: "Profit", estado: "ok", ciclo: true, mensaje: `vuelta ${i}` });
    ok(sql.prepare("SELECT COUNT(*) AS n FROM sync_eventos WHERE agente = 'caja-1'").get().n <= ag.MAXIMO_DE_EVENTOS + 1, "guarda solo los últimos hechos de cada agente");
  }

  titulo("el panel (Inventario › Importar) enseña los agentes");
  {
    const { atenderPanel } = await src.cargar("panel.js");
    const entorno = { ...env, PANEL_CLAVE: "clave-del-panel", TIENDA_NOMBRE: "Prueba" };
    const formulario = new FormData();
    formulario.set("clave", "clave-del-panel");
    const sesion = await atenderPanel(new Request("https://bot.test/panel/entrar", { method: "POST", body: formulario }), entorno, { tienda: "Prueba" });
    const cookie = (sesion.headers.get("set-cookie") || "").split(";")[0];
    const ver = async (e2 = entorno) => {
      const r = await atenderPanel(new Request("https://bot.test/panel/inventario/importar", { headers: { cookie, "sec-fetch-site": "same-origin" } }), e2, { tienda: "Prueba", rubro: "calzado", verTexto: async () => "" });
      return r.text();
    };
    await ag.recibirLatido(env, { agente: "caja-1", origen: "Profit", equipo: "PC Caja", estado: "error", ciclo: true, mensaje: "No encuentro el archivo C:\\exportes\\stock.csv" });
    let html = await ver();
    ok(/Agente puente/.test(html) && /Profit/.test(html) && /PC Caja/.test(html), "cada agente con su sistema y su PC");
    ok(/chip mal">Con error/.test(html) && /No encuentro el archivo/.test(html), "con error: el chip rojo y el motivo", html.match(/chip [a-z]+">[^<]+/g)?.join(", "));
    ok(/Sincronizar ahora/.test(html) && /\/panel\/inventario\/conector\/sincronizar/.test(html), "y el botón «Sincronizar ahora»");
    sql.prepare("INSERT INTO inv_productos (titulo, origen, origen_id, activo, actualizado) VALUES ('Sin Imagen', 'manual', 'm-sinimg', 1, 0)").run();
    html = await ver();
    ok(/no tienen? foto/.test(html) && /\/panel\/inventario\?f=sin-foto/.test(html), "dice cuántos productos no tienen foto y lleva a subirlas");
    const lista = await atenderPanel(new Request("https://bot.test/panel/inventario?f=sin-foto", { headers: { cookie, "sec-fetch-site": "same-origin" } }), entorno, { tienda: "Prueba", rubro: "calzado", verTexto: async () => "" });
    const htmlLista = await lista.text();
    ok(/Sin foto \(\d+\)/.test(htmlLista) && /Sin Imagen/.test(htmlLista), "el inventario tiene el atajo «Sin foto» con los que faltan", String(lista.status));
    ok(!html.includes(CLAVE), "la clave no sale");
    // El botón.
    const pedir = await atenderPanel(new Request("https://bot.test/panel/inventario/conector/sincronizar", { method: "POST", headers: { cookie, "sec-fetch-site": "same-origin", origin: "https://bot.test" }, body: new FormData() }), entorno, { tienda: "Prueba", rubro: "calzado" });
    ok(pedir.status === 303 || pedir.status === 302, "el botón vuelve a Importar", String(pedir.status));
    ok(Number(await ag.ordenPendiente(DB)) > 0, "y deja la orden");
    html = await ver();
    ok(/Sincronización pedida/.test(html), "el panel dice que está pedida");
    const r = await latir({ estado: "espera" });
    ok(r.cuerpo.ordenes.includes("sincronizar"), "y el agente la recibe en su latido");
    await latir({ estado: "ok", ciclo: true, mensaje: "10 filas", filas: 10, ordenHecha: r.cuerpo.ordenEn });
    html = await ver();
    ok(/chip bien">Activo/.test(html) && !/Sincronización pedida/.test(html), "cumplida: «Activo» y ya no dice pedida");
    // Sin agentes: explica qué es.
    sql.prepare("DELETE FROM sync_agentes").run();
    html = await ver();
    ok(/Ningún agente puente se ha conectado/.test(html), "sin agentes: explica qué es y qué se va a ver");
    // Apagada: no hay tarjeta de agentes ni botón.
    html = await ver({ ...entorno, SYNC_CLAVE: "" });
    ok(!/Sincronizar ahora/.test(html) && /agente-puente/.test(html), "con la conexión apagada: sin botón, y dice dónde están las instrucciones");
  }

  titulo("el AGENTE de verdad (agente-puente/) contra esta tienda");
  {
    const http = await import("node:http");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { pathToFileURL } = await import("node:url");
    const agente = await import(pathToFileURL(path.resolve(import.meta.dirname, "../../agente-puente/agente-puente.mjs")).href);
    const servidor = http.createServer(async (req, res) => {
      const trozos = [];
      for await (const t of req) trozos.push(t);
      const url = new URL(req.url, "http://127.0.0.1");
      const solicitud = new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(trozos) });
      const r = await con.atenderSync(solicitud, env, url, { waitUntil: () => {} });
      res.writeHead(r.status, { "content-type": r.headers.get("content-type") || "text/plain" });
      res.end(Buffer.from(await r.arrayBuffer()));
    });
    await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "puente-tienda-"));
    try {
      const archivo = path.join(carpeta, "stock.csv");
      fs.writeFileSync(archivo, "Código;Descripción;Talla;Existencia\nPZ1;Bota Puente;40;3\n");
      const config = agente.completarConfig({ url: `http://127.0.0.1:${servidor.address().port}`, clave: CLAVE, origen: "SistemaX", agente: "oficina", equipo: "PC Oficina", fuente: { tipo: "archivo", ruta: archivo } }, carpeta);
      let v = await agente.vuelta(config, { registrar: () => {}, esperar: async () => {} });
      const a = fila("oficina");
      ok(v.ok && v.sincronizo && a?.estado === "ok" && a.ultimo_ok > 0 && a.origen === "SistemaX", "una vuelta: el stock entra y la tienda lo ve «ok»", JSON.stringify(a));
      ok(sql.prepare("SELECT 1 AS x FROM inv_productos WHERE titulo = 'Bota Puente'").get(), "el producto está en el inventario");
      // El dueño aprieta el botón; la siguiente vuelta sincroniza aunque no toque.
      await ag.pedirSincronizacion(DB);
      fs.writeFileSync(archivo, "Código;Descripción;Talla;Existencia\nPZ1;Bota Puente;40;7\n");
      v = await agente.vuelta(config, { registrar: () => {}, esperar: async () => {} });
      const stock = sql.prepare("SELECT SUM(s.cantidad) AS n FROM inv_stock s JOIN inv_variantes v ON v.id = s.variante_id JOIN inv_productos p ON p.id = v.producto_id WHERE p.titulo = 'Bota Puente'").get()?.n;
      ok(v.sincronizo && Number(stock) === 7 && !(await ag.ordenPendiente(DB)), "con la orden del panel: sincroniza enseguida y la orden se borra", `stock ${stock}`);
      // Se rompe la fuente: la tienda se entera y avisa.
      avisos.length = 0;
      fs.rmSync(archivo);
      v = await agente.vuelta(config, { forzar: true, registrar: () => {}, esperar: async () => {} });
      ok(!v.ok && fila("oficina").estado === "error" && /No encuentro/.test(fila("oficina").ultimo_error), "si la fuente falla, la tienda queda «Con error» con el motivo", fila("oficina").ultimo_error);
      ok(avisos.some((x) => x.a === "slack" && /SistemaX \(PC Oficina\)/.test(x.texto)), "y llega el aviso");

      // LAS FOTOS (dueño, 16-oct-2026: "en caso de que el sistema no contenga
      // imágenes, nosotros tendríamos que cargarlas"): lo que llega sin foto
      // sale en «Sin foto», se le sube en el panel y el sistema no la toca.
      const bota = sql.prepare("SELECT id FROM inv_productos WHERE titulo = 'Bota Puente'").get().id;
      const sinFoto = await inv.listarProductos(DB, { sinFoto: true });
      ok(sinFoto.some((p) => p.id === bota) && (await inv.contarSinFoto(DB)) >= 1, "lo que llegó del sistema sin imagen sale en «Sin foto»");
      sql.prepare("INSERT INTO inv_fotos (producto_id, url, orden) VALUES (?, 'https://bot.test/tienda/img/1.jpg', 0)").run(bota);
      fs.writeFileSync(archivo, "Código;Descripción;Talla;Existencia;Precio\nPZ1;Bota Puente;40;9;55\n");
      v = await agente.vuelta(config, { forzar: true, registrar: () => {}, esperar: async () => {} });
      const fotos = sql.prepare("SELECT url FROM inv_fotos WHERE producto_id = ?").all(bota);
      ok(v.ok && fotos.length === 1 && fotos[0].url.endsWith("/1.jpg"), "la foto subida en el panel sigue ahí después de otro conteo del sistema", JSON.stringify(fotos));
      ok(!(await inv.listarProductos(DB, { sinFoto: true })).some((p) => p.id === bota), "y ya no sale en «Sin foto»");
    } finally {
      servidor.close();
      fs.rmSync(carpeta, { recursive: true, force: true });
    }
  }
} finally {
  globalThis.fetch = fetchReal;
}

terminar();
