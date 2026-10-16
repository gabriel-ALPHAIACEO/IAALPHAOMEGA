// PRUEBAS DEL AGENTE PUENTE, solas (no necesitan ningún bot): una tienda de
// mentira en http://127.0.0.1 que contesta como /api/sync, y el agente de
// verdad contra ella.
//
//   node pruebas/agente.mjs          (desde la carpeta agente-puente; devuelve 1 si algo falla)
//
// Lo que no se puede romper:
//   · la clave y las contraseñas de la base NUNCA salen (pantalla, registro, latido);
//   · el latido se manda en cada vuelta, y el conteo solo cuando toca o lo piden;
//   · una orden del panel se cumple y se confirma; un error se reporta con su motivo;
//   · si la tienda no contesta, el agente no se cae;
//   · dos vueltas no corren a la vez;
//   · el instalador arma la tarea correcta (cada minuto, sin pararse por la batería).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "../agente-puente.mjs");
const a = await import(pathToFileURL(SCRIPT).href);

let fallos = 0;
let pasadas = 0;
function ok(condicion, que, detalle = "") {
  if (condicion) {
    pasadas++;
    console.log(`  ✅ ${que}`);
  } else {
    fallos++;
    console.log(`  ❌ ${que}${detalle ? `\n      ${detalle}` : ""}`);
  }
}
function titulo(t) {
  console.log(`\n${t}`);
}

const CLAVE = "clave-larga-de-la-tienda-123";
const SECRETO_DB = "ContraDeLaBase99";

/* ── Una tienda de mentira ───────────────────────────────────────────── */

const tienda = {
  latidos: [],
  conteos: [],
  orden: 0,
  fallar500: 0,
  apagada: false,
  productos: 3,
  ventas: [{ id: 1, venta: 10, producto: "Camisa", cantidad: 1 }],
};
const servidor = http.createServer(async (req, res) => {
  const trozos = [];
  for await (const t of req) trozos.push(t);
  const cuerpo = Buffer.concat(trozos).toString("utf8");
  const url = new URL(req.url, "http://127.0.0.1");
  const enviar = (estado, datos, tipo = "application/json") => {
    res.writeHead(estado, { "content-type": tipo });
    res.end(typeof datos === "string" ? datos : JSON.stringify(datos));
  };
  if (tienda.apagada) return enviar(503, { ok: false, error: "apagada" });
  if (req.headers.authorization !== `Bearer ${CLAVE}`) return enviar(401, { ok: false, error: "Clave incorrecta." });
  if (tienda.fallar500 > 0) {
    tienda.fallar500--;
    return enviar(500, { ok: false, error: "se cayó" });
  }
  if (url.pathname === "/api/sync/latido") {
    const l = JSON.parse(cuerpo);
    tienda.latidos.push(l);
    if (l.ordenHecha && Number(l.ordenHecha) >= tienda.orden) tienda.orden = 0;
    return enviar(200, { ok: true, ordenes: tienda.orden ? ["sincronizar"] : [], ordenEn: tienda.orden || undefined });
  }
  if (url.pathname === "/api/sync/inventario") {
    tienda.conteos.push({ csv: cuerpo, consulta: Object.fromEntries(url.searchParams) });
    const filas = cuerpo.split("\n").length - 1;
    return enviar(200, { ok: true, trabajo: tienda.conteos.length, estado: "listo", filas, informe: { nuevos: 1, errores: [] } });
  }
  if (url.pathname === "/api/sync/estado") return enviar(200, { ok: true, productos: tienda.productos, variantes: 5 });
  if (url.pathname === "/api/sync/ventas") {
    const desde = Number(url.searchParams.get("desde_id")) || 0;
    const nuevas = tienda.ventas.filter((v) => v.id > desde);
    if (url.searchParams.get("formato") === "json") return enviar(200, { ok: true, ventas: nuevas });
    return enviar(200, "venta;id;producto\n" + nuevas.map((v) => `${v.venta};${v.id};${v.producto}`).join("\n"), "text/csv");
  }
  enviar(404, { ok: false, error: "no existe" });
});
await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
const URL_TIENDA = `http://127.0.0.1:${servidor.address().port}`;

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "agente-puente-"));
const archivo = path.join(carpeta, "stock.csv");
fs.writeFileSync(archivo, Buffer.from("Código;Descripción;Existencia\nA1;Camisa Azul;4\nA2;Pantalón;2\n", "latin1"));
const sinEsperar = async () => {};
const base = () =>
  a.completarConfig({ url: URL_TIENDA, clave: CLAVE, origen: "Profit", agente: "caja-1", equipo: "PC caja", cadaMinutos: 15, fuente: { tipo: "archivo", ruta: archivo, codificacion: "latin1" } }, carpeta);

try {
  /* ── Secretos ──────────────────────────────────────────────────────── */
  titulo("ningún secreto por escrito");
  {
    const t = a.sinSecretos(`sqlcmd -S srv -U lector -P "${SECRETO_DB}" -Q x; mysql -p${SECRETO_DB}; Server=x;Password=${SECRETO_DB};Uid=u; Authorization: Bearer ${CLAVE}`, [CLAVE]);
    ok(!t.includes(SECRETO_DB) && !t.includes(CLAVE), "tapa -P, -pCLAVE, Password= y Bearer", t);
    ok(/-U lector/.test(t) && /sqlcmd -S srv/.test(t), "y deja lo demás para entender el error", t);
    const s = a.secretosDe({ clave: CLAVE, fuente: { comando: `sqlcmd -U x -P "${SECRETO_DB}" -Q "SELECT 1"` } });
    ok(s.includes(CLAVE) && s.includes(SECRETO_DB), "saca la contraseña del comando para taparla donde salga", JSON.stringify(s));
  }

  /* ── Configuración ─────────────────────────────────────────────────── */
  titulo("la configuración dice qué falta");
  {
    ok(!a.problemasDeConfig(base()).length, "una configuración completa no tiene problemas", a.problemasDeConfig(base()).join(" | "));
    ok(a.problemasDeConfig({ ...base(), url: "http://mi-bot.workers.dev" }).some((p) => /https/.test(p)), "sin https no se acepta (la clave viajaría sin cifrar)");
    ok(a.problemasDeConfig({ ...base(), url: "https://x.workers.dev/api/sync/inventario" }).some((p) => /sin \/api\/sync/.test(p)), "con /api/sync en la dirección, lo dice");
    const previa = process.env.SYNC_CLAVE;
    delete process.env.SYNC_CLAVE;
    ok(a.problemasDeConfig({ ...base(), clave: "" }).some((p) => /clave/.test(p)), "sin clave, lo dice");
    if (previa !== undefined) process.env.SYNC_CLAVE = previa;
    ok(a.problemasDeConfig({ ...base(), fuente: { tipo: "otra" } }).some((p) => /archivo.*comando/.test(p)), "una fuente que no existe, lo dice");
  }

  /* ── La vuelta: latido, conteo cuando toca, orden del panel ────────── */
  titulo("la vuelta: latido siempre, conteo cuando toca o cuando lo piden");
  {
    const config = base();
    let reloj = Date.parse("2026-10-16T10:00:00Z");
    const ahora = () => reloj;
    const registro = [];
    const registrar = (m) => registro.push(m);
    let r = await a.vuelta(config, { esperar: sinEsperar, registrar, ahora });
    ok(r.sincronizo && r.ok && tienda.conteos.length === 1, "la primera vuelta manda el stock", JSON.stringify(r).slice(0, 150));
    ok(tienda.latidos[0]?.estado === "inicio" && tienda.latidos[0]?.agente === "caja-1" && tienda.latidos[0]?.version === a.VERSION, "y el primer latido dice «inicio», con su nombre y versión", JSON.stringify(tienda.latidos[0]));
    const final = tienda.latidos.at(-1);
    ok(final.estado === "ok" && final.ciclo === true && final.filas === 2 && /2 filas/.test(final.mensaje), "al terminar, un latido «ok» con cuántas filas", JSON.stringify(final));
    ok(tienda.conteos[0].consulta.origen === "Profit" && Number(tienda.conteos[0].consulta.generado) > 0, "con el nombre del sistema y la hora del archivo (generado)");
    ok(tienda.conteos[0].csv.includes("Pantalón"), "las tildes del latin1 llegan bien");
    const estado = a.leerEstado(config);
    ok(estado.ultimoOk === reloj && estado.proximaSync === reloj + 15 * 60000, "recuerda cuándo le toca otra vez (estado-puente.json)", JSON.stringify(estado));

    reloj += 60000;
    const antes = tienda.conteos.length;
    r = await a.vuelta(config, { esperar: sinEsperar, registrar, ahora });
    ok(!r.sincronizo && tienda.conteos.length === antes && tienda.latidos.at(-1).estado === "espera", "un minuto después: solo el latido («espera»), sin mandar el stock");

    tienda.orden = reloj - 1000;
    reloj += 60000;
    r = await a.vuelta(config, { esperar: sinEsperar, registrar, ahora });
    ok(r.sincronizo && tienda.conteos.length === antes + 1, "con una orden del panel, sincroniza aunque no toque");
    ok(Number(tienda.latidos.at(-1).ordenHecha) > 0 && tienda.orden === 0, "y confirma la orden (ordenHecha) para que no se repita", JSON.stringify(tienda.latidos.at(-1)));
    ok(registro.some((m) => /pidieron sincronizar/.test(m)), "y lo anota en el registro");

    reloj += 16 * 60000;
    r = await a.vuelta(config, { esperar: sinEsperar, registrar, ahora });
    ok(r.sincronizo, "pasados los 15 minutos, vuelve a mandar el stock");
    r = await a.vuelta(config, { forzar: true, esperar: sinEsperar, registrar, ahora });
    ok(r.sincronizo, "--una-vez (forzar) manda aunque no toque");
  }

  /* ── Los errores ───────────────────────────────────────────────────── */
  titulo("un error se reporta con su motivo, sin secretos, y no tumba al agente");
  {
    // Como sqlcmd: la contraseña va en el comando (-P) y el programa la repite en su error.
    const roto = path.join(carpeta, "roto.mjs");
    fs.writeFileSync(roto, "console.error('Login failed for user lector, password ' + process.argv.at(-1)); process.exit(2);");
    const config = a.completarConfig({ ...base(), agente: "caja-err", fuente: { tipo: "comando", comando: `"${process.execPath}" "${roto}" -P "${SECRETO_DB}"` } }, carpeta);
    fs.rmSync(path.join(carpeta, "estado-puente.json"), { force: true });
    const registro = [];
    const r = await a.vuelta(config, { esperar: sinEsperar, registrar: (m) => registro.push(m) });
    const l = tienda.latidos.at(-1);
    ok(!r.ok && l.estado === "error" && /El comando falló \(código 2\)/.test(l.mensaje) && /Login failed/.test(l.mensaje), "el latido dice «error» y por qué", l.mensaje);
    ok(!JSON.stringify(tienda.latidos).includes(SECRETO_DB) && !registro.join(" ").includes(SECRETO_DB), "la contraseña de la base no sale en el latido ni en el registro", l.mensaje);
    ok(!l.mensaje.includes("roto.mjs"), "el error no repite el comando entero");
    const e = a.leerEstado(config);
    ok(e.proximaSync - e.ultimaSync === 5 * 60000, "tras un error, reintenta en 5 minutos (no cada minuto)", JSON.stringify(e));

    const falta = a.completarConfig({ ...base(), agente: "caja-falta", fuente: { tipo: "archivo", ruta: path.join(carpeta, "no-existe.csv") } }, carpeta);
    fs.rmSync(path.join(carpeta, "estado-puente.json"), { force: true });
    await a.vuelta(falta, { esperar: sinEsperar, registrar: () => {} });
    ok(/No encuentro el archivo/.test(tienda.latidos.at(-1).mensaje) && /unidad de red/.test(tienda.latidos.at(-1).mensaje), "un archivo que no está: lo dice, y avisa de las unidades de red", tienda.latidos.at(-1).mensaje);

    // La tienda no contesta: nada se cae.
    const muerta = a.completarConfig({ ...base(), url: "http://127.0.0.1:9", timeoutSegundos: 2 }, carpeta);
    fs.rmSync(path.join(carpeta, "estado-puente.json"), { force: true });
    const reg = [];
    const r2 = await a.vuelta(muerta, { esperar: sinEsperar, registrar: (m) => reg.push(m) });
    ok(!r2.ok && /No pude llegar a la tienda/.test(r2.error) && /internet/.test(r2.error), "sin conexión: lo dice claro y sigue vivo", r2.error);
    ok(reg.some((m) => /latido no llegó/.test(m)), "y anota que el latido no llegó");

    // Un 500 se reintenta; un 401 no.
    tienda.fallar500 = 1;
    const llamadas = [];
    const contar = (u, o) => {
      llamadas.push(u);
      return fetch(u, o);
    };
    const re = await a.llamar(base(), "/api/sync/estado", {}, { hacer: contar, esperar: sinEsperar });
    ok(re.estado === 200 && llamadas.length === 2, "un 500 de la tienda se reintenta", `${re.estado} en ${llamadas.length} llamadas`);
    llamadas.length = 0;
    const mal = await a.llamar({ ...base(), clave: "otra-clave-mala" }, "/api/sync/estado", {}, { hacer: contar, esperar: sinEsperar });
    ok(mal.estado === 401 && llamadas.length === 1, "un 401 no se reintenta (es la clave, no la red)");
    let error = null;
    try {
      await a.ciclo({ ...base(), clave: "otra-clave-mala" }, { registrar: () => {}, esperar: sinEsperar });
    } catch (e) {
      error = e;
    }
    ok(/401/.test(error?.message) && /SYNC_CLAVE/.test(error?.message) && !error.message.includes("otra-clave-mala"), "clave mala: explica qué revisar, sin repetirla", error?.message);
    tienda.apagada = true;
    error = null;
    try {
      await a.ciclo(base(), { registrar: () => {}, esperar: sinEsperar });
    } catch (e) {
      error = e;
    }
    tienda.apagada = false;
    ok(/503/.test(error?.message) && /apagada/.test(error?.message), "conexión apagada en la tienda (503): lo dice", error?.message);
  }

  /* ── Candado ───────────────────────────────────────────────────────── */
  titulo("dos vueltas no corren a la vez");
  {
    const config = base();
    a.soltarCandado(config);
    ok(a.tomarCandado(config), "la primera toma el candado");
    ok(!a.tomarCandado(config), "la segunda, no");
    ok(a.tomarCandado(config, Date.now() + 31 * 60000), "uno de hace más de 30 min se da por muerto");
    a.renovarCandado(config);
    ok(!a.tomarCandado(config), "el que corre siempre lo renueva");
    a.soltarCandado(config);
  }

  /* ── Registro ──────────────────────────────────────────────────────── */
  titulo("el registro (puente.log) rota y no guarda secretos");
  {
    const log = path.join(carpeta, "prueba.log");
    const registrar = a.crearRegistro({ archivo: log, consola: false, maximo: 300, secretos: [CLAVE] });
    for (let i = 0; i < 20; i++) registrar(`línea ${i} con Bearer ${CLAVE}`);
    ok(fs.existsSync(`${log}.1`) && fs.statSync(log).size < 400, "pasado el tamaño, el viejo queda como .1 (uno solo)");
    ok(!fs.readFileSync(log, "utf8").includes(CLAVE) && !fs.readFileSync(`${log}.1`, "utf8").includes(CLAVE), "la clave no está en el archivo");
  }

  /* ── Configurar ────────────────────────────────────────────────────── */
  titulo("--configurar pregunta y escribe config.json");
  {
    const respuestas = ["http://mal", `${URL_TIENDA}/api/sync/inventario`, CLAVE, "Saint", "PC Oficina", "", "x", "2", `"${process.execPath}" "${path.join(carpeta, "salida.mjs")}"`, "utf8", "90", "10", "s", path.join(carpeta, "ventas")];
    const vistas = [];
    const ruta = path.join(carpeta, "config-preguntas.json");
    const salida = [];
    const c = await a.configurar({ ruta, preguntar: async (t) => (vistas.push(t), respuestas.shift() ?? ""), escribir: (m) => salida.push(m) });
    const leido = JSON.parse(fs.readFileSync(ruta, "utf8"));
    ok(leido.url === URL_TIENDA, "quita /api/sync de la dirección y no acepta una sin https", leido.url);
    ok(leido.fuente.tipo === "comando" && leido.fuente.timeoutSegundos === 90 && leido.cadaMinutos === 10 && leido.ventas.activar, "guarda la fuente, el tiempo, cada cuánto y las ventas", JSON.stringify(leido));
    ok(vistas.filter((t) => /^6\./.test(t)).length === 2, "una respuesta que no vale («x») se vuelve a preguntar");
    ok(salida.some((m) => /no lo compartas/.test(m)), "avisa que la clave quedó en el archivo");
    ok(c.origen === "Saint" && c.equipo === "PC Oficina", "con el nombre del sistema y de la PC");
  }

  /* ── Doctor ────────────────────────────────────────────────────────── */
  titulo("--doctor revisa todo y dice qué arreglar");
  {
    const instalada = async (programa) => ({ codigo: programa === "schtasks" ? 0 : 1, salida: "" });
    const r = await a.doctor(base(), { esperar: sinEsperar, ejecutar: instalada, plataforma: "win32" });
    ok(r.every((x) => x.ok !== false), "todo bien: ninguna ❌", a.textoDelDoctor(r));
    ok(r.some((x) => /tienda contesta/.test(x.nombre) && /3 productos/.test(x.detalle)), "dice que la tienda contesta y cuántos productos tiene");
    ok(r.some((x) => /Prueba completa/.test(x.nombre) && x.ok), "hace la prueba sin guardar nada (?probar=1)", JSON.stringify(tienda.conteos.at(-1)?.consulta));
    ok(tienda.conteos.at(-1).consulta.probar === "1", "y de verdad con probar=1");
    const mala = await a.doctor({ ...base(), clave: "clave-que-no-es" }, { esperar: sinEsperar, ejecutar: instalada, plataforma: "win32" });
    const linea = mala.find((x) => /tienda contesta/.test(x.nombre));
    ok(linea?.ok === false && /401/.test(linea.detalle) && /SYNC_CLAVE/.test(linea.detalle), "con la clave mala: ❌ y qué revisar", linea?.detalle);
    fs.writeFileSync(path.join(carpeta, "sin-cantidad.csv"), "Código;Descripción\nA1;Camisa\n");
    const sin = await a.doctor({ ...base(), fuente: { tipo: "archivo", ruta: path.join(carpeta, "sin-cantidad.csv") } }, { esperar: sinEsperar, ejecutar: async () => ({ codigo: 1 }), plataforma: "win32" });
    ok(sin.some((x) => x.ok === null && /cantidad/.test(x.detalle)), "sin columna de cantidad: lo avisa");
    ok(sin.some((x) => /tarea programada/.test(x.nombre) && x.ok === null), "y que todavía no corre solo");
    const vacia = await a.doctor({ ...base(), url: "" }, { esperar: sinEsperar });
    ok(vacia.some((x) => x.ok === false && /url/.test(x.detalle)), "sin dirección: ❌ en la configuración");
  }

  /* ── Instalar ──────────────────────────────────────────────────────── */
  titulo("--instalar arma la tarea correcta");
  {
    const t = a.tareaDeWindows({ node: "C:\\Program Files\\nodejs\\node.exe", script: "C:\\agente & puente\\agente-puente.mjs", config: "C:\\agente & puente\\config.json" });
    ok(/<Interval>PT1M<\/Interval>/.test(t) && /<MultipleInstancesPolicy>IgnoreNew/.test(t), "cada minuto, una sola a la vez");
    ok(/<DisallowStartIfOnBatteries>false/.test(t) && /<StopIfGoingOnBatteries>false/.test(t), "no se para con la batería (portátiles)");
    ok(/S-1-5-18/.test(t) && /--vuelta/.test(t) && /PT30M/.test(t), "como SYSTEM, con --vuelta, y cortada a los 30 min si se cuelga");
    ok(/agente &amp; puente/.test(t) && !/agente & puente/.test(t), "las rutas raras se escapan bien en el XML");
    ok(/<LogonType>Password<\/LogonType>/.test(a.tareaDeWindows({ usuario: "OFICINA\\ana" })), "con --usuario, corre con esa cuenta (ve sus unidades de red)");

    const llamadas = [];
    let xmlLeido = "";
    const ejecutar = async (programa, args) => {
      llamadas.push([programa, ...args]);
      const i = args.indexOf("/XML");
      if (i !== -1) xmlLeido = fs.readFileSync(args[i + 1]);
      return { codigo: 0, salida: "" };
    };
    const salida = [];
    const hecho = await a.instalar({ rutaConfig: path.join(carpeta, "config.json"), ejecutar, plataforma: "win32", escribir: (m) => salida.push(m), carpetaTemporal: carpeta });
    const crear = llamadas.find((l) => l[1] === "/Create");
    ok(hecho && crear && crear.includes("/F") && crear.includes(a.NOMBRE_DE_LA_TAREA), "Windows: schtasks /Create /F con su nombre", JSON.stringify(crear));
    ok(xmlLeido[0] === 0xff && xmlLeido[1] === 0xfe, "el XML va en UTF-16 con su marca (así lo lee schtasks)");
    ok(llamadas.some((l) => l[1] === "/Run"), "y la arranca de una vez");
    ok(!fs.existsSync(path.join(carpeta, "agente-puente-tarea.xml")), "sin dejar el XML tirado");
    ok(salida.some((m) => /unidades de red/.test(m)), "avisa de las unidades de red como SYSTEM");

    let cron = "0 3 * * * /usr/bin/respaldo\n* * * * * 'node' 'viejo.mjs' --vuelta # agente-puente\n";
    const ejecutarCron = async (programa, args, o = {}) => {
      if (args[0] === "-l") return { codigo: 0, salida: cron };
      if (args[0] === "-") cron = o.entrada;
      return { codigo: 0, salida: "" };
    };
    await a.instalar({ rutaConfig: path.join(carpeta, "config.json"), ejecutar: ejecutarCron, plataforma: "linux", escribir: () => {} });
    ok(/respaldo/.test(cron) && (cron.match(/# agente-puente/g) || []).length === 1 && !/viejo\.mjs/.test(cron), "Linux/Mac: una sola línea en cron, sin borrar las demás", cron);
    ok(await a.estaInstalado({ ejecutar: ejecutarCron, plataforma: "linux" }), "y se reconoce instalado");
    await a.desinstalar({ ejecutar: ejecutarCron, plataforma: "linux", escribir: () => {} });
    ok(!/agente-puente/.test(cron) && /respaldo/.test(cron), "--desinstalar la quita y deja las demás");
  }

  /* ── El programa de verdad, como lo correría la tarea ─────────────── */
  titulo("el programa de verdad (línea de comandos)");
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agente-cli-"));
    const ruta = path.join(dir, "config.json");
    fs.writeFileSync(ruta, JSON.stringify({ url: URL_TIENDA, clave: CLAVE, origen: "CLI", agente: "cli", fuente: { tipo: "archivo", ruta: archivo, codificacion: "latin1" }, ventas: { activar: true, carpeta: path.join(dir, "ventas") } }));
    const correr = (...args) => spawnSync(process.execPath, [SCRIPT, ...args, "--config", ruta], { encoding: "utf8", env: { ...process.env, SYNC_CLAVE: "" } });
    const v = spawnSync(process.execPath, [SCRIPT, "--version"], { encoding: "utf8" });
    ok(v.stdout.trim() === a.VERSION, "--version", v.stdout + v.stderr);
    // spawnSync bloquea el hilo y la tienda de mentira vive aquí: se corre aparte.
    const { spawn } = await import("node:child_process");
    const enFondo = (...args) =>
      new Promise((r) => {
        const h = spawn(process.execPath, [SCRIPT, ...args, "--config", ruta], { env: { ...process.env, SYNC_CLAVE: "" } });
        let out = "";
        h.stdout.on("data", (d) => (out += d));
        h.stderr.on("data", (d) => (out += d));
        h.on("close", (codigo) => r({ codigo, out }));
      });
    const antes = tienda.conteos.length;
    const u = await enFondo("--una-vez");
    ok(u.codigo === 0 && tienda.conteos.length === antes + 1, "--una-vez manda el stock y sale con 0", u.out);
    ok(fs.existsSync(path.join(dir, "puente.log")) && fs.existsSync(path.join(dir, "estado-puente.json")), "deja su registro y su estado junto a config.json");
    ok(fs.existsSync(path.join(dir, "ventas", "ventas-nuevas-1.csv")), "y baja las ventas a su carpeta");
    ok(!fs.existsSync(path.join(dir, "puente.lock")), "suelta el candado al terminar");
    ok(!u.out.includes(CLAVE) && !fs.readFileSync(path.join(dir, "puente.log"), "utf8").includes(CLAVE), "la clave no sale en pantalla ni en el registro");
    const v2 = await enFondo("--vuelta");
    ok(v2.codigo === 0 && tienda.conteos.length === antes + 1 && tienda.latidos.at(-1).agente === "cli", "--vuelta enseguida: solo el latido", v2.out);
    const est = await enFondo("--estado");
    ok(/Último conteo bueno/.test(est.out) && /Últimas líneas del registro/.test(est.out), "--estado cuenta cómo le fue", est.out.slice(0, 200));
    fs.writeFileSync(ruta, JSON.stringify({ url: "", fuente: {} }));
    const malo = await enFondo("--una-vez");
    ok(malo.codigo === 1 && /url/.test(malo.out), "con la configuración mal: sale con 1 y dice qué falta", malo.out);
    const sinConfig = spawnSync(process.execPath, [SCRIPT, "--una-vez", "--config", path.join(dir, "no-hay.json")], { encoding: "utf8" });
    ok(sinConfig.status === 1 && /--configurar/.test(sinConfig.stderr), "sin config.json: explica cómo crearlo", sinConfig.stderr);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  /* ── El modo siempre ───────────────────────────────────────────────── */
  titulo("corriendo siempre (en una ventana)");
  {
    const config = a.completarConfig({ ...base(), agente: "ventana" }, carpeta);
    fs.rmSync(path.join(carpeta, "estado-puente.json"), { force: true });
    const esperas = [];
    let renovado = 0;
    await a.correrSiempre(config, { vueltas: 3, esperar: async (ms) => esperas.push(ms), registrar: () => {}, alEmpezar: () => renovado++ });
    const suyos = tienda.latidos.filter((l) => l.agente === "ventana");
    ok(suyos.length >= 4 && esperas.length === 2 && esperas.every((ms) => ms === 60000), "una vuelta por minuto, con su latido", `${suyos.length} latidos, esperas ${esperas}`);
    ok(renovado === 3, "renueva el candado en cada vuelta");
    ok(suyos.every((l) => l.modo === "continuo"), "y se presenta como «continuo» (la tienda espera un latido por minuto)");
  }
} finally {
  servidor.close();
  fs.rmSync(carpeta, { recursive: true, force: true });
}

console.log(`\n${pasadas} bien, ${fallos} mal.`);
process.exitCode = fallos ? 1 : 0;
