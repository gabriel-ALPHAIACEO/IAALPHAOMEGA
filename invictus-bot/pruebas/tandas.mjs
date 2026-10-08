// IMPORTAR Y EXPORTAR POR TANDAS (8-oct-2026). Gabriel: "la parte de
// exportar y traer ahora debe ser como el cron por que pasa el limite de
// workers ... debe traerse asi como la indexacion".
//
// Aquí la base hace lo que hace Cloudflare: cuenta las llamadas de cada
// pasada del Worker y, pasadas 1000, ya no deja ni una más ("Too many API
// requests by single Worker invocation").
//
// Lo que no se puede romper:
//   · ninguna pasada (traer, cada tanda, cada parte del Excel) llega al tope;
//   · por tandas queda EXACTAMENTE lo mismo que de una vez: los mismos
//     modelos, tallas, códigos de barras, fotos y stock, y el mismo informe;
//   · si Cloudflare corta una tanda a medias, se repite y no duplica nada;
//   · dos pasadas a la vez no trabajan la misma importación;
//   · el bot de EPICCELL pasa al inventario cuando está TODO, no antes;
//   · el Excel por partes es el mismo archivo, byte por byte.

import { prepararSrc, baseDeMentira, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const inv = await src.cargar("inventario.js");
const { atenderPanel } = await src.cargar("panel.js");

const TOPE = 1000;

// La base como en Cloudflare: el batch es una transacción y cuenta como UNA
// llamada; cada pasada tiene su cuenta y, pasado el tope, todo falla.
function baseComoCloudflare() {
  const base = baseDeMentira();
  const real = base.DB;
  real.batch = async (sentencias) => {
    base.sql.exec("BEGIN");
    try {
      const salida = [];
      for (const s of sentencias) salida.push(await s.run());
      base.sql.exec("COMMIT");
      return salida;
    } catch (error) {
      base.sql.exec("ROLLBACK");
      throw error;
    }
  };
  const pasada = { llamadas: 0, maximo: 0, tope: TOPE };
  const contar = () => {
    pasada.llamadas++;
    pasada.maximo = Math.max(pasada.maximo, pasada.llamadas);
    if (pasada.llamadas > pasada.tope) throw new Error("Too many API requests by single Worker invocation.");
  };
  const DB = {
    prepare(consulta) {
      const s = real.prepare(consulta);
      const envuelta = {
        __real: s,
        bind: (...a) => (s.bind(...a), envuelta),
        run: async () => (contar(), s.run()),
        all: async () => (contar(), s.all()),
        first: async () => (contar(), s.first()),
      };
      return envuelta;
    },
    batch: async (lista) => (contar(), real.batch(lista.map((s) => s.__real || s))),
  };
  return {
    DB,
    sql: base.sql,
    pasada,
    // Una pasada nueva del Worker (un pedido, una vuelta del cron).
    nueva(tope = TOPE) {
      pasada.llamadas = 0;
      pasada.tope = tope;
    },
  };
}

// Una base nueva para cada escenario: el inventario vuelve a crear sus tablas.
function otraBase() {
  inv.olvidarQueEstaListo();
  return baseComoCloudflare();
}

// Un catálogo como el de El Emperador: cientos de fotos de Drive, cada una
// con su COD y un rango de tallas (10 tallas).
function catalogoGrande(n, { conCantidad = false } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    origen: "drive",
    origen_id: `archivo-${i}`,
    titulo: `Modelo ${String(i).padStart(4, "0")} COD A${i}`,
    precio: 30 + (i % 20),
    enlace: `https://drive.google.com/file/d/archivo-${i}/view`,
    extras: { codigo: `A${i}`, categoria: i % 3 ? "calzado" : "gorra" },
    fotos: [`https://lh3.googleusercontent.com/d/archivo-${i}=w1000`],
    variantes: Array.from({ length: 10 }, (_, t) => ({ opcion: String(36 + t), ...(conCantidad ? { cantidad: (i + t) % 4 } : {}) })),
  }));
}

// Lo que quedó en la base, para comparar dos importaciones. Por lo que es
// cada cosa y no por su número: SQLite gasta un id cada vez que un modelo ya
// guardado se vuelve a pasar (el upsert), así que una tanda repetida corre
// los números, y los modelos que sube un Excel llevan un origen_id al azar.
// El código de barras propio sale del id: se comprueba que sea el suyo.
function foto(sql) {
  const q = (consulta) => sql.prepare(consulta).all();
  const producto = new Map(q("SELECT id, origen, origen_id, titulo FROM inv_productos").map((p) => [p.id, `${p.origen}|${p.origen.startsWith("manual") && p.origen_id.startsWith("m-") ? `nombre:${p.titulo}` : p.origen_id}`]));
  const variantes = q("SELECT id, producto_id, opcion, color, codigo_barras, codigo_fabricante, precio, precio_cashea, precio_local, foto, extras, oculta FROM inv_variantes");
  const variante = new Map(variantes.map((v) => [v.id, `${producto.get(v.producto_id)}|${v.opcion}|${v.color}`]));
  const orden = (lista) => lista.map((x) => JSON.stringify(x)).sort();
  return JSON.stringify({
    productos: orden(q("SELECT id, origen, titulo, marca, precio, precio_cashea, precio_local, enlace, extras, activo FROM inv_productos").map(({ id, ...p }) => ({ clave: producto.get(id), ...p }))),
    variantes: orden(variantes.map(({ id, producto_id, codigo_barras, ...v }) => ({ clave: variante.get(id), codigo: codigo_barras === inv.codigoInterno(id) ? "el suyo" : codigo_barras, ...v }))),
    fotos: orden(q("SELECT producto_id, url, orden FROM inv_fotos").map(({ producto_id, ...f }) => ({ de: producto.get(producto_id), ...f }))),
    stock: orden(q("SELECT variante_id, local_id, cantidad FROM inv_stock").map(({ variante_id, ...x }) => ({ de: variante.get(variante_id), ...x }))),
    // Los movimientos en el orden en que pasaron.
    movimientos: q("SELECT variante_id, local_id, tipo, delta, queda, quien, nota FROM inv_movimientos ORDER BY id").map(({ variante_id, ...m }) => JSON.stringify({ de: variante.get(variante_id), ...m })),
  });
}

// Lo primero que no coincide, para leer el fallo.
function diferencia(a, b) {
  const x = JSON.parse(a);
  const y = JSON.parse(b);
  for (const k of Object.keys(x)) {
    const n = Math.max(x[k].length, y[k].length);
    for (let i = 0; i < n; i++) if (x[k][i] !== y[k][i]) return `${k} (${x[k].length} vs ${y[k].length}): ${x[k][i]} ≠ ${y[k][i]}`;
  }
  return "";
}

// Pasa una importación entera, tanda por tanda, cada una en su pasada.
async function hastaTerminar(b, id, { cuantos = 25, consultas, llave = "prueba", topeDePasada = TOPE } = {}) {
  let r;
  let tandas = 0;
  let maximo = 0;
  do {
    b.nueva(topeDePasada);
    r = await inv.seguirImportacion(b.DB, { id, cuantos, consultas, llave });
    maximo = Math.max(maximo, b.pasada.llamadas);
    tandas++;
  } while (r && r.estado === "trabajando" && tandas < 2000);
  return { r, tandas, maximo };
}

const callado = async (fn) => {
  const log = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
};

/* ── 1. El problema ─────────────────────────────────────────────────── */

titulo("de una vez, un catálogo grande pasa el tope de Cloudflare");
{
  const b = otraBase();
  b.nueva();
  const informe = await inv.importarCatalogo(b.DB, catalogoGrande(200), {});
  ok(b.pasada.maximo > TOPE && informe.errores.some((e) => /Too many API requests/.test(e)), "200 modelos con sus tallas en UNA pasada: Cloudflare corta", `${b.pasada.maximo} llamadas`);
}

/* ── 2. Por tandas, lo mismo que de una vez ─────────────────────────── */

titulo("por tandas: 600 modelos de El Emperador, ninguna pasada llega al tope");
{
  const grande = catalogoGrande(600, { conCantidad: true });
  // La referencia: de una vez, en una base sin tope.
  const ref = otraBase();
  ref.nueva(Infinity);
  const informeDeUnaVez = await inv.importarCatalogo(ref.DB, grande, { quien: "Ana" });
  const esperado = foto(ref.sql);

  const b = otraBase();
  b.nueva();
  const id = await inv.empezarImportacion(b.DB, { tipo: "catalogo", items: grande, opciones: { quien: "Ana" } });
  const alEmpezar = b.pasada.llamadas;
  ok(alEmpezar < 60, "guardar lo que hay que pasar cuesta pocas llamadas", `${alEmpezar}`);
  const { r, tandas, maximo } = await hastaTerminar(b, id);
  ok(r.estado === "listo", "termina", `${tandas} tandas`);
  ok(maximo <= inv.CONSULTAS_POR_TANDA + 60, `ninguna tanda pasa de ${inv.CONSULTAS_POR_TANDA} llamadas (más el arranque)`, `la más cara: ${maximo}`);
  ok(foto(b.sql) === esperado, "la base queda IGUAL que de una vez: modelos, tallas, códigos, fotos, stock y movimientos");
  const { errores: _a, ...cifrasPorTandas } = r.informe;
  const { errores: _b, ...cifrasDeUnaVez } = informeDeUnaVez;
  ok(JSON.stringify({ ...cifrasPorTandas, pasoAlInventario: undefined }) === JSON.stringify({ ...cifrasDeUnaVez, pasoAlInventario: undefined }), "y el mismo informe", JSON.stringify(cifrasPorTandas));
  ok(!b.sql.prepare("SELECT COUNT(*) AS n FROM inv_trabajo_items").get().n, "terminada, no deja nada guardado de más");

  // Traerlo otra vez: nada nuevo, nada duplicado.
  b.nueva();
  const otra = await inv.empezarImportacion(b.DB, { tipo: "catalogo", items: grande, opciones: { quien: "Ana" } });
  const segunda = await hastaTerminar(b, otra);
  ok(segunda.r.informe.conStock === 0 && segunda.r.informe.modelos === 600 && foto(b.sql) === esperado, "traerlo otra vez no duplica ni recarga stock");
}

titulo("un catálogo con de todo: COD que cambió de archivo, repetidos, sin nombre, cantidades");
{
  const mezcla = [
    { origen: "drive", origen_id: "nuevo-1", titulo: "Gorra NY COD G125", extras: { codigo: "G125" }, variantes: [{ opcion: "única" }] },
    { origen: "sheets", origen_id: "moto-g", titulo: "Moto G", juntadas: 2, variantes: [{ opcion: "64GB", cantidad: 5, precio: 120, precio_cashea: 140, foto: "https://x/m.jpg", extras: { RAM: "4GB" } }, { opcion: "128GB", cantidad: "SI" }, { opcion: "256GB", cantidad: 0, oculta: true }] },
    { origen: "sheets", origen_id: "sin-nombre", titulo: "", variantes: [{ opcion: "64GB", cantidad: 1 }] },
    { origen: "shopify", origen_id: "77", titulo: "Air Force 1", precio: "60 USD", fotos: ["https://x/a.jpg", "https://x/b.jpg", "no-es-https"] },
    { origen: "sheets", origen_id: "fab", titulo: "Cargador", variantes: [{ opcion: "única", codigo_fabricante: "7790000000017", cantidad: 3 }, { opcion: "única", cantidad: 9 }] },
    ...catalogoGrande(40, { conCantidad: true }),
  ];
  const preparar = async (b) => {
    // Ya había una gorra con ese COD, de otro archivo de Drive.
    const id = await inv.guardarProducto(b.DB, { origen: "drive", origen_id: "viejo-1", titulo: "Gorra NY", extras: { codigo: "G125" } });
    await inv.guardarVariante(b.DB, id, { opcion: "única" });
  };
  const ref = otraBase();
  ref.nueva(Infinity);
  await preparar(ref);
  const deUnaVez = await inv.importarCatalogo(ref.DB, mezcla, { quien: "Luis" });

  const b = otraBase();
  b.nueva(Infinity);
  await preparar(b);
  const id = await inv.empezarImportacion(b.DB, { tipo: "catalogo", items: mezcla, opciones: { quien: "Luis" } });
  const { r } = await hastaTerminar(b, id, { cuantos: 3 });
  ok(foto(b.sql) === foto(ref.sql), "de 3 en 3 queda igual que de una vez");
  ok(JSON.stringify(r.informe.errores) === JSON.stringify(deUnaVez.errores) && r.informe.errores.length === 1, "con el mismo error (el que no tiene nombre)", r.informe.errores[0]);
  ok(r.informe.juntadas === 2 && r.informe.conStock === deUnaVez.conStock && r.informe.variantes === deUnaVez.variantes, "y las mismas cuentas", JSON.stringify({ t: r.informe, u: deUnaVez }));
  ok(b.sql.prepare("SELECT COUNT(*) AS n FROM inv_productos WHERE extras LIKE '%G125%'").get().n === 1, "la gorra del COD sigue siendo una sola (tomó el archivo nuevo)");
}

/* ── 3. Cuando Cloudflare corta ─────────────────────────────────────── */

titulo("Cloudflare corta una tanda a medias: se repite y no duplica nada");
{
  const lista = catalogoGrande(60, { conCantidad: true });
  const ref = otraBase();
  ref.nueva(Infinity);
  const deUnaVez = await inv.importarCatalogo(ref.DB, lista, {});

  const b = otraBase();
  b.nueva();
  const id = await inv.empezarImportacion(b.DB, { tipo: "catalogo", items: lista, opciones: {} });
  // Tandas que piden más de lo que deja la pasada: Cloudflare las corta a
  // las 120 llamadas, y después de cortar no deja ni guardar.
  let cortadas = 0;
  let r = null;
  for (let i = 0; i < 400; i++) {
    b.nueva(120);
    try {
      r = await inv.seguirImportacion(b.DB, { id, cuantos: 40, consultas: 900, llave: "pagina-1" });
    } catch (error) {
      if (!/Too many API requests/.test(error.message)) throw error;
      cortadas++;
      // La página, como hace de verdad: la próxima tanda más chica.
      b.nueva(120);
      r = await inv.seguirImportacion(b.DB, { id, cuantos: 5, consultas: 90, llave: "pagina-1" });
    }
    if (r?.estado === "listo") break;
  }
  ok(cortadas > 0, "hubo tandas cortadas", `${cortadas}`);
  ok(r?.estado === "listo" && foto(b.sql) === foto(ref.sql), "y aun así queda igual que de una vez (la misma página retoma su tanda enseguida)", diferencia(foto(b.sql), foto(ref.sql)));
  ok(r.informe.conStock === deUnaVez.conStock && r.informe.modelos === deUnaVez.modelos && r.informe.variantes === deUnaVez.variantes, "con las cuentas exactas (el stock cargado se cuenta en la base)", JSON.stringify({ t: r.informe.conStock, u: deUnaVez.conStock }));
}

/* ── 4. Dos pasadas a la vez ────────────────────────────────────────── */

titulo("dos pasadas a la vez no trabajan la misma importación");
{
  const b = otraBase();
  b.nueva(Infinity);
  const id = await inv.empezarImportacion(b.DB, { tipo: "catalogo", items: catalogoGrande(30), opciones: {} });
  const [una, otra] = await Promise.all([inv.seguirImportacion(b.DB, { id, cuantos: 5, llave: "pagina" }), inv.seguirImportacion(b.DB, { id, cuantos: 5, llave: "cron" })]);
  ok([una, otra].filter((x) => x.ocupado).length === 1 && [una, otra].find((x) => !x.ocupado).hechos === 5, "una trabaja y la otra espera (ocupado)");
  // Una pasada que muere sin soltarla: la misma página sigue enseguida; el
  // cron espera a que venza.
  b.sql.prepare("UPDATE inv_trabajos SET ocupado_hasta = ?, ocupado_por = 'pagina' WHERE id = ?").run(Date.now() + 60000, id);
  ok((await inv.seguirImportacion(b.DB, { id, cuantos: 5, llave: "cron" })).ocupado === true, "con la tanda de la página a medias, el cron no entra");
  const misma = await inv.seguirImportacion(b.DB, { id, cuantos: 5, llave: "pagina" });
  ok(!misma.ocupado && misma.hechos === 10, "la misma página sí retoma la suya", JSON.stringify({ o: misma.ocupado, h: misma.hechos }));
  b.sql.prepare("UPDATE inv_trabajos SET ocupado_hasta = ?, ocupado_por = 'otra' WHERE id = ?").run(Date.now() - 1, id);
  ok(!(await inv.seguirImportacion(b.DB, { id, cuantos: 5, llave: "cron" })).ocupado, "y vencido el plazo, sigue cualquiera");
}

/* ── 5. Traer otra vez, detener, el cron ────────────────────────────── */

titulo("traer otra vez reemplaza la que quedó a medias; detener la para");
{
  const b = otraBase();
  b.nueva(Infinity);
  const vieja = await inv.empezarImportacion(b.DB, { tipo: "catalogo", items: catalogoGrande(50), opciones: {} });
  await inv.seguirImportacion(b.DB, { id: vieja, cuantos: 10 });
  const nueva = await inv.empezarImportacion(b.DB, { tipo: "catalogo", items: catalogoGrande(20), opciones: {} });
  ok((await inv.verImportacion(b.DB, vieja)).estado === "cancelado" && (await inv.importacionesEnCurso(b.DB)).map((t) => t.id).join() === String(nueva), "la vieja queda cancelada; en curso, solo la nueva");
  ok(!b.sql.prepare("SELECT COUNT(*) AS n FROM inv_trabajo_items WHERE trabajo_id = ?").get(vieja).n, "y no guarda nada de la vieja");
  const csv = await inv.empezarImportacion(b.DB, { tipo: "csv", items: [["X", "1"]], opciones: { col: inv.columnasDelCsv(["producto", "cantidad"]), sedeFija: 1 } });
  ok((await inv.importacionesEnCurso(b.DB)).length === 2, "un Excel no cancela el catálogo (son cosas distintas)");
  await inv.detenerImportacion(b.DB, nueva);
  ok((await inv.verImportacion(b.DB, nueva)).estado === "cancelado" && (await inv.seguirImportacion(b.DB, { id: nueva })).estado === "cancelado", "Detener la para, y ya no avanza");
  await inv.detenerImportacion(b.DB, csv);
}

titulo("el cron: sin nada pendiente no toca nada; con algo a medias, una tanda chica");
{
  const b = otraBase();
  b.nueva();
  ok((await inv.avanzarImportacionesSolas(b.DB)) === null && !b.sql.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'inv_trabajos'").get().n, "en una tienda que nunca importó, ni crea tablas", `${b.pasada.llamadas} llamada(s)`);
  b.nueva();
  const id = await inv.empezarImportacion(b.DB, { tipo: "catalogo", items: catalogoGrande(25), opciones: {} });
  b.nueva();
  const r = await callado(() => inv.avanzarImportacionesSolas(b.DB));
  ok(r && r.estado === "trabajando" && r.hechos === 10 && b.pasada.llamadas <= 150 + 20, "avanza sola, una tanda chica (10 modelos)", JSON.stringify(r && { h: r.hechos, t: r.total, llamadas: b.pasada.llamadas }));
  let vueltas = 0;
  let ultimo = r;
  while (ultimo && ultimo.estado === "trabajando" && vueltas < 50) {
    b.nueva();
    ultimo = await callado(() => inv.avanzarImportacionesSolas(b.DB));
    vueltas++;
  }
  ok((await inv.verImportacion(b.DB, id)).estado === "listo" && b.sql.prepare("SELECT COUNT(*) AS n FROM inv_productos").get().n === 25, "y termina sola, vuelta tras vuelta del cron", `${vueltas + 1} vueltas`);
  b.nueva();
  ok((await inv.avanzarImportacionesSolas(b.DB)) === null && b.pasada.llamadas === 1, "terminada, el cron vuelve a costar una consulta");
}

/* ── 6. El Excel del sistema viejo, por tandas ──────────────────────── */

titulo("el Excel por tandas: lo mismo que de una vez, y «solo probar» no guarda");
{
  const filas = ["Código;Producto;Talla;Cantidad;Costo"];
  for (let i = 0; i < 300; i++) filas.push(`${i % 7 === 0 ? `77900000${String(i).padStart(5, "0")}` : ""};Zapato ${i % 120};${36 + (i % 8)};${i % 5};${i % 9 === 0 ? "12,5" : ""}`);
  filas.push(";Fila mala;40;muchos;");
  filas.push(";;;;");
  const texto = filas.join("\n");

  const ref = otraBase();
  ref.nueva(Infinity);
  const deUnaVez = await inv.importarCsv(ref.DB, texto, { quien: "Excel" });

  const b = otraBase();
  b.nueva(Infinity);
  const leido = await inv.prepararCsv(b.DB, texto, {});
  const probar = await inv.empezarImportacion(b.DB, { tipo: "csv", items: leido.filas, opciones: { col: leido.col, sedeFija: leido.sedeFija, quien: "Excel", aplicar: false } });
  const prueba = await hastaTerminar(b, probar, { cuantos: 2 });
  ok(prueba.r.estado === "listo" && !b.sql.prepare("SELECT COUNT(*) AS n FROM inv_productos").get().n, "«solo probar», por tandas, no guarda nada", JSON.stringify(prueba.r.informe).slice(0, 120));
  const id = await inv.empezarImportacion(b.DB, { tipo: "csv", items: leido.filas, opciones: { col: leido.col, sedeFija: leido.sedeFija, quien: "Excel" } });
  const { r, maximo } = await hastaTerminar(b, id, { cuantos: 4 });
  ok(foto(b.sql) === foto(ref.sql), "subido por tandas queda igual que de una vez", diferencia(foto(b.sql), foto(ref.sql)));
  ok(JSON.stringify(r.informe) === JSON.stringify(deUnaVez), "con el mismo informe (y la fila mala, con su número)", JSON.stringify(r.informe.errores));
  ok(maximo <= TOPE, "ninguna tanda pasa del tope", `${maximo}`);
}

/* ── 7. Desde el panel ──────────────────────────────────────────────── */

titulo("desde el panel: Traer ahora, la barra de progreso y el informe");
{
  const b = otraBase();
  b.nueva(Infinity);
  const ENV = { DB: b.DB, PANEL_CLAVE: "clave-de-prueba", TIENDA_NOMBRE: "Prueba" };
  const entrar = new FormData();
  entrar.set("clave", "clave-de-prueba");
  const r0 = await atenderPanel(new Request("https://bot.test/panel/entrar", { method: "POST", body: entrar }), ENV, { tienda: "Prueba" });
  const cookie = (r0.headers.get("set-cookie") || "").split(";")[0];
  let catalogo = catalogoGrande(150, { conCantidad: true });
  const opciones = { tienda: "Prueba", rubro: "moda", seSigueSola: true, botLeeInventario: true, nombreDelCatalogo: "la hoja", traerCatalogo: async () => catalogo };
  const pedir = (ruta, init = {}) => {
    b.nueva();
    return callado(() => atenderPanel(new Request(`https://bot.test${ruta}`, { ...init, headers: { cookie, "sec-fetch-site": "same-origin", ...(init.headers || {}) } }), ENV, opciones));
  };

  const traer = new FormData();
  let r = await pedir("/panel/inventario/importar/catalogo", { method: "POST", body: traer });
  const destino = r.headers.get("location") || "";
  ok(r.status === 303 && /^\/panel\/inventario\/importar\/progreso\?id=\d+$/.test(destino), "un catálogo grande no se pasa en el mismo pedido: lleva a la barra de progreso", destino);
  ok(b.pasada.maximo <= TOPE, "y ese pedido no pasa del tope", `${b.pasada.llamadas}`);
  let html = await (await pedir(destino)).text();
  ok(/Trayendo el catálogo/.test(html) && /de 150 productos/.test(html) && /importar\/seguir/.test(html) && /sigue sola cada 15 minutos/.test(html), "la página del progreso, con su barra y el aviso del cron");
  html = await (await pedir("/panel/inventario/importar")).text();
  ok(/El catálogo a medio traer: 0 de 150 productos/.test(html) && /Ver cómo va/.test(html), "Importar avisa que hay una a medias");
  ok((await inv.leerAjuste(b.DB, "catalogo_del_bot")) === null, "a medias, el bot de EPICCELL todavía NO pasa al inventario");

  const id = Number(destino.split("=")[1]);
  let d;
  let tandas = 0;
  let maximo = 0;
  do {
    r = await pedir("/panel/inventario/importar/seguir", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, cuantos: 25, consultas: 300, llave: "pagina-x" }) });
    maximo = Math.max(maximo, b.pasada.llamadas);
    d = await r.json();
    tandas++;
  } while (d.ok && d.estado === "trabajando" && tandas < 100);
  ok(d.ok && d.estado === "listo" && d.hechos === 150 && d.total === 150, "tanda tras tanda hasta terminar", `${tandas} tandas, la más cara ${maximo} llamadas`);
  ok(maximo <= inv.CONSULTAS_POR_TANDA + 60, "cada tanda por debajo del tope");
  ok((await inv.leerAjuste(b.DB, "catalogo_del_bot")) === "inventario", "terminado TODO, el bot pasa al inventario");
  html = await (await pedir(destino)).text();
  ok(/Catálogo traído/.test(html) && /Desde ahora el bot ofrece lo del inventario/.test(html) && />150</.test(html) && />1\.500</.test(html), "la misma página enseña el informe (150 productos, 1.500 tallas)");
  html = await (await pedir("/panel/inventario/importar")).text();
  ok(!/a medio traer/.test(html), "y en Importar ya no sale el aviso");

  // Un catálogo corto se termina en el mismo pedido, como siempre.
  catalogo = catalogoGrande(12);
  html = await (await pedir("/panel/inventario/importar/catalogo", { method: "POST", body: traer })).text();
  ok(/Catálogo traído/.test(html), "uno corto: el informe enseguida, sin barra");

  r = await pedir("/panel/inventario/importar/seguir", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: 999999 }) });
  ok(r.status === 404, "una tanda de una importación que no existe: 404 (la página vuelve a Importar)");
  r = await pedir("/panel/inventario/importar/seguir", { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" }, body: JSON.stringify({ id }) });
  ok(r.status === 403, "otra web no puede mover las tandas");

  // El Excel grande también va por tandas.
  const filas = ["producto;talla;cantidad", ...Array.from({ length: 120 }, (_, i) => `Bota ${i};${38 + (i % 5)};${i % 4}`)];
  const archivo = new FormData();
  archivo.set("archivo", new File([filas.join("\n")], "stock.csv", { type: "text/csv" }));
  archivo.set("probar", "si");
  r = await pedir("/panel/inventario/importar/csv", { method: "POST", body: archivo });
  const destinoCsv = r.headers.get("location") || "";
  ok(r.status === 303 && /progreso\?id=\d+$/.test(destinoCsv), "un Excel de 120 filas va a la barra de progreso", destinoCsv);
  html = await (await pedir(destinoCsv)).text();
  ok(/Probando el Excel/.test(html) && /de 120 filas/.test(html), "probándolo (viene marcado «Solo probar»), contado en filas");
  const idCsv = Number(destinoCsv.split("=")[1]);
  do {
    d = await (await pedir("/panel/inventario/importar/seguir", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: idCsv, cuantos: 4 }) })).json();
  } while (d.ok && d.estado === "trabajando");
  html = await (await pedir(destinoCsv)).text();
  ok(d.hechos === 120 && /Fue una prueba/.test(html) && /Así quedaría el Excel/.test(html), "terminado: el informe de la prueba");

  // Detener desde la página.
  catalogo = catalogoGrande(80);
  r = await pedir("/panel/inventario/importar/catalogo", { method: "POST", body: traer });
  const idParar = Number((r.headers.get("location") || "").split("=")[1]);
  const parar = new FormData();
  parar.set("id", String(idParar));
  r = await pedir("/panel/inventario/importar/detener", { method: "POST", body: parar });
  ok(r.status === 303 && /detenida/.test(decodeURIComponent(r.headers.get("location") || "")) && (await inv.verImportacion(b.DB, idParar)).estado === "cancelado", "Detener desde la página");
  r = await pedir(`/panel/inventario/importar/progreso?id=${idParar}`);
  ok(r.status === 303 && /se%20detuvo/i.test(r.headers.get("location") || ""), "y su página ya lleva a Importar");
}

/* ── 8. El Excel del inventario, por partes ─────────────────────────── */

// Pide todas las partes del Excel, como hace el botón.
async function bajarPorPartes(pedir, b, { entre } = {}) {
  const partes = [];
  let tras = "";
  let d;
  let vueltas = 0;
  let maximo = 0;
  let total = null;
  let modelos = 0;
  do {
    d = await (await pedir(`/panel/inventario/exportar${tras ? `?tras=${encodeURIComponent(tras)}` : ""}`)).json();
    maximo = Math.max(maximo, b.pasada.llamadas);
    if (d.total !== null && d.total !== undefined) total = d.total;
    modelos += d.modelos;
    partes.push(d.texto);
    tras = d.siguiente;
    vueltas++;
    if (entre && vueltas === 1) await entre();
  } while (d.siguiente !== null && vueltas < 50);
  return { juntas: partes.join(""), vueltas, maximo, total, modelos, nombre: d.nombre };
}

titulo("el Excel del inventario por partes: el mismo archivo, sin pasar el tope");
{
  const b = otraBase();
  b.nueva(Infinity);
  await inv.crearSede(b.DB, "Sambil");
  const id0 = await inv.empezarImportacion(b.DB, { tipo: "catalogo", items: catalogoGrande(260, { conCantidad: true }), opciones: {} });
  await hastaTerminar(b, id0, { topeDePasada: Infinity });
  // Uno con el mismo nombre que otro (el orden tiene que ser estable entre
  // partes), y sin tallas: no sale en el Excel.
  await inv.guardarProducto(b.DB, { origen: "manual", origen_id: "rep-1", titulo: "Modelo 0001 COD A1" });
  const ENV = { DB: b.DB, PANEL_CLAVE: "clave-de-prueba", TIENDA_NOMBRE: "Prueba" };
  const entrar = new FormData();
  entrar.set("clave", "clave-de-prueba");
  const r0 = await atenderPanel(new Request("https://bot.test/panel/entrar", { method: "POST", body: entrar }), ENV, { tienda: "Prueba" });
  const cookie = (r0.headers.get("set-cookie") || "").split(";")[0];
  const opciones = { tienda: "Prueba", rubro: "calzado" };
  const pedir = (ruta) => {
    b.nueva();
    return atenderPanel(new Request(`https://bot.test${ruta}`, { headers: { cookie, "sec-fetch-site": "same-origin" } }), ENV, opciones);
  };
  // .text() se come el BOM del principio; Excel lo necesita, así que se lee entero.
  const leerEntero = async () => new TextDecoder("utf-8", { ignoreBOM: true }).decode(await (await pedir("/panel/inventario.csv")).arrayBuffer());
  const entero = await leerEntero();
  const x = await bajarPorPartes(pedir, b);
  ok(x.vueltas === 3 && x.total === 261 && x.modelos === 261, "261 modelos: 3 partes de 100", `${x.vueltas} partes, total ${x.total}, ${x.modelos} modelos`);
  ok(x.juntas === entero, "las partes juntas son el mismo archivo, byte por byte", `${x.juntas.length} vs ${entero.length}`);
  ok(x.juntas.startsWith("﻿Producto;Marca;Gama;Talla;") && (x.juntas.match(/\r\n/g) || []).length === 1 + 260 * 10 * 2, "con el encabezado una sola vez y una fila por talla y sede", `${(x.juntas.match(/\r\n/g) || []).length} líneas`);
  ok(/^inventario-\d{4}-\d{2}-\d{2}\.csv$/.test(x.nombre) && x.maximo < 20, "con su nombre de siempre, y cada parte cuesta pocas llamadas", `${x.maximo}`);

  // Mientras se baja, entran modelos (una importación en otra pestaña) y se
  // quita uno: ninguna fila de las que ya estaban se repite ni se pierde.
  const antes = new Set(entero.split("\r\n"));
  const y = await bajarPorPartes(pedir, b, {
    entre: async () => {
      for (const t of ["Modelo 0005 bis", "Modelo 0150 bis", "Modelo 0250 bis", "AAA primero"]) {
        const id = await inv.guardarProducto(b.DB, { origen: "manual", titulo: t });
        await inv.guardarVariante(b.DB, id, { opcion: "40" });
      }
      b.sql.prepare("UPDATE inv_productos SET activo = 0 WHERE titulo = 'Modelo 0200 COD A200'").run();
    },
  });
  const lineas = y.juntas.split("\r\n");
  const repetidas = lineas.filter((l, i) => l && lineas.indexOf(l) !== i);
  const viejasQueFaltan = [...antes].filter((l) => l && !l.includes("Modelo 0200 COD A200") && !lineas.includes(l));
  ok(!repetidas.length && !viejasQueFaltan.length, "con cambios en medio: ni repetidas ni perdidas", JSON.stringify({ repetidas: repetidas.slice(0, 3), faltan: viejasQueFaltan.slice(0, 3) }));
  ok(lineas.some((l) => l.startsWith("Modelo 0150 bis")) && lineas.some((l) => l.startsWith("Modelo 0250 bis")), "y lo que entró después de donde iba, sale");

  const lista = await (await pedir("/panel/inventario")).text();
  ok(/data-excel-por-partes="\/panel\/inventario\/exportar"/.test(lista) && /Preparando el Excel/.test(lista) && /\?tras=/.test(lista), "el botón Excel del inventario lo arma por partes");
  const movs = await (await pedir("/panel/inventario/movimientos")).text();
  ok(/data-excel-por-partes/.test(movs), "y el «Excel del stock» de Movimientos también");
}

/* ── 9. Lo que encontró la revisión ─────────────────────────────────── */

titulo("un Excel que termina horas después no deshace las ventas de la caja");
{
  const b = otraBase();
  b.nueva(Infinity);
  const sede = (await inv.sedes(b.DB))[0].id;
  const bota = await inv.guardarProducto(b.DB, { origen: "manual", titulo: "Bota 99" });
  const v40 = await inv.guardarVariante(b.DB, bota, { opcion: "40" });
  const v41 = await inv.guardarVariante(b.DB, bota, { opcion: "41" });
  const v42 = await inv.guardarVariante(b.DB, bota, { opcion: "42" });
  for (const v of [v40, v41, v42]) await inv.ajustarStock(b.DB, { varianteId: v, sedeId: sede, cantidad: 5 });
  const filas = ["producto;talla;cantidad", ...Array.from({ length: 60 }, (_, i) => `Relleno ${i};40;1`), "Bota 99;40;5", "Bota 99;41;8", "Bota 99;42;5"];
  const leido = await inv.prepararCsv(b.DB, filas.join("\n"), {});
  await new Promise((r) => setTimeout(r, 5)); // el conteo de antes, en otro milisegundo que la subida
  const id = await inv.empezarImportacion(b.DB, { tipo: "csv", items: leido.filas, opciones: { col: leido.col, sedeFija: leido.sedeFija, quien: "Excel" } });
  await inv.seguirImportacion(b.DB, { id }); // una tanda, y se cierra la página
  // Mientras tanto, en la caja: se venden 2 de la 40 y 1 de la 41; la 42 se cuenta a mano.
  await inv.cobrar(b.DB, { sedeId: sede, items: [{ varianteId: v40, cantidad: 2 }, { varianteId: v41, cantidad: 1 }] });
  await inv.ajustarStock(b.DB, { varianteId: v42, sedeId: sede, cantidad: 4, quien: "Ana" });
  const { r } = await hastaTerminar(b, id, { cuantos: 1 });
  const hay = (v) => b.sql.prepare("SELECT cantidad FROM inv_stock WHERE variante_id = ? AND local_id = ?").get(v, sede).cantidad;
  ok(hay(v40) === 3, "la 40: el Excel decía 5 y se vendieron 2 después: quedan 3 (la venta no se deshace)", `${hay(v40)}`);
  ok(hay(v41) === 7, "la 41: el Excel decía 8 y se vendió 1 después: quedan 7", `${hay(v41)}`);
  ok(hay(v42) === 4 && r.informe.errores.some((e) => /Fila 64: se contó o se cargó a mano/.test(e)), "la 42, contada a mano después: manda su conteo, y el informe lo dice", JSON.stringify(r.informe.errores));
  ok(r.informe.conVentasEnMedio === 2, "el informe cuenta las filas que tenían ventas en medio", `${r.informe.conVentasEnMedio}`);
}

titulo("el informe del Excel sale exacto aunque Cloudflare corte una tanda");
{
  const filas = ["producto;talla;cantidad", ...Array.from({ length: 60 }, (_, i) => `Nuevo ${i % 25};${38 + (i % 3)};${1 + (i % 4)}`)];
  const ref = otraBase();
  ref.nueva(Infinity);
  const deUnaVez = await inv.importarCsv(ref.DB, filas.join("\n"), {});
  const b = otraBase();
  b.nueva(Infinity);
  const leido = await inv.prepararCsv(b.DB, filas.join("\n"), {});
  const id = await inv.empezarImportacion(b.DB, { tipo: "csv", items: leido.filas, opciones: { col: leido.col, sedeFija: leido.sedeFija } });
  // La primera tanda se corta a las 200 llamadas, y después no deja ni guardar.
  b.nueva(200);
  let cortada = false;
  try {
    await callado(() => inv.seguirImportacion(b.DB, { id, cuantos: 3, consultas: 900, llave: "p" }));
  } catch (error) {
    cortada = /Too many API requests/.test(error.message);
  }
  ok(cortada && b.sql.prepare("SELECT hechos FROM inv_trabajos WHERE id = ?").get(id).hechos === 0, "la tanda se cortó sin poder guardar por dónde iba");
  b.sql.prepare("UPDATE inv_trabajos SET ocupado_hasta = 0 WHERE id = ?").run(id); // venció su plazo
  const { r } = await hastaTerminar(b, id, { topeDePasada: Infinity });
  ok(foto(b.sql) === foto(ref.sql), "la base queda igual que de una vez", diferencia(foto(b.sql), foto(ref.sql)));
  ok(JSON.stringify(r.informe) === JSON.stringify(deUnaVez), "y el informe también (nuevos y con stock puesto, contados de verdad)", JSON.stringify({ t: r.informe, u: deUnaVez }));
}

titulo("subir otro Excel no corta el que va a medias");
{
  const b = otraBase();
  b.nueva(Infinity);
  const leer = async (n, nombre) => inv.prepararCsv(b.DB, ["producto;cantidad", ...Array.from({ length: n }, (_, i) => `${nombre} ${i};1`)].join("\n"), {});
  const a = await leer(100, "Real");
  const real = await inv.empezarImportacion(b.DB, { tipo: "csv", items: a.filas, opciones: { col: a.col, sedeFija: a.sedeFija } });
  await inv.seguirImportacion(b.DB, { id: real });
  const p = await leer(30, "Prueba");
  const prueba = await inv.empezarImportacion(b.DB, { tipo: "csv", items: p.filas, opciones: { col: p.col, sedeFija: p.sedeFija, aplicar: false } });
  ok((await inv.verImportacion(b.DB, real)).estado === "trabajando" && (await inv.verImportacion(b.DB, prueba)).estado === "trabajando", "«Solo probar» otro archivo deja seguir al de verdad");
  const otraPrueba = await inv.empezarImportacion(b.DB, { tipo: "csv", items: p.filas, opciones: { col: p.col, sedeFija: p.sedeFija, aplicar: false } });
  ok((await inv.verImportacion(b.DB, prueba)).estado === "cancelado" && (await inv.verImportacion(b.DB, real)).estado === "trabajando", "una prueba nueva reemplaza a la prueba vieja, no al de verdad");
  let error = "";
  try {
    await inv.empezarImportacion(b.DB, { tipo: "csv", items: a.filas, opciones: { col: a.col, sedeFija: a.sedeFija } });
  } catch (e) {
    error = e.message;
  }
  ok(/Hay un Excel a medio subir \(20 de 100 filas\)\. Espera a que termine o detenlo/.test(error) && (await inv.verImportacion(b.DB, real)).estado === "trabajando", "otro de verdad se rechaza, con el aviso de cómo va el primero", error);
  await inv.detenerImportacion(b.DB, real);
  await inv.detenerImportacion(b.DB, otraPrueba);
  const ahoraSi = await inv.empezarImportacion(b.DB, { tipo: "csv", items: a.filas, opciones: { col: a.col, sedeFija: a.sedeFija } });
  ok(ahoraSi > 0, "detenido el primero, ya se puede subir otro");
}

titulo("Detener justo mientras una tanda trabaja: no la da por terminada");
{
  const b = otraBase();
  b.nueva(Infinity);
  const id = await inv.empezarImportacion(b.DB, { tipo: "catalogo", items: catalogoGrande(12), opciones: { botLeeInventario: true } });
  // Alguien toca «Detener» cuando la tanda ya tomó la importación.
  const DB = {
    ...b.DB,
    prepare(consulta) {
      if (/^SELECT n, datos FROM inv_trabajo_items/.test(consulta) && !DB.yaPaso) {
        DB.yaPaso = true;
        return { bind: (...a) => ({ all: async () => (await inv.detenerImportacion(b.DB, id), b.DB.prepare(consulta).bind(...a).all()) }) };
      }
      return b.DB.prepare(consulta);
    },
    batch: (l) => b.DB.batch(l),
  };
  const r = await inv.seguirImportacion(DB, { id, cuantos: 25, llave: "p" });
  ok(r.estado === "cancelado", "la tanda contesta «cancelado», no «listo»", r.estado);
  ok((await inv.leerAjuste(b.DB, "catalogo_del_bot")) === null, "y el bot de EPICCELL NO pasa al inventario a medias");
  const t = b.sql.prepare("SELECT estado, ocupado_hasta FROM inv_trabajos WHERE id = ?").get(id);
  ok(t.estado === "cancelado" && t.ocupado_hasta === 0 && !b.sql.prepare("SELECT COUNT(*) AS n FROM inv_trabajo_items WHERE trabajo_id = ?").get(id).n, "queda detenida, suelta y sin nada guardado de más");
}

titulo("el cron reparte sus vueltas y no toca la que una página está pasando");
{
  const b = otraBase();
  b.nueva(Infinity);
  const leido = await inv.prepararCsv(b.DB, ["producto;cantidad", ...Array.from({ length: 200 }, (_, i) => `Cosa ${i};1`)].join("\n"), {});
  const csv = await inv.empezarImportacion(b.DB, { tipo: "csv", items: leido.filas, opciones: { col: leido.col, sedeFija: leido.sedeFija } });
  const cat = await inv.empezarImportacion(b.DB, { tipo: "catalogo", items: catalogoGrande(30), opciones: {} });
  const vueltas = [];
  for (let i = 0; i < 4; i++) vueltas.push((await callado(() => inv.avanzarImportacionesSolas(b.DB)))?.id);
  ok(vueltas.includes(csv) && vueltas.includes(cat), "con un Excel y un catálogo a medias, avanzan los dos", JSON.stringify(vueltas));
  b.sql.prepare("UPDATE inv_trabajos SET ocupado_hasta = ? WHERE id = ?").run(Date.now() + 60000, csv);
  const r = await callado(() => inv.avanzarImportacionesSolas(b.DB));
  ok(!r || r.id === cat, "y la que una página tiene tomada, la deja", JSON.stringify(r && r.id));
}

titulo("lo corto se termina en el mismo pedido");
{
  const b = otraBase();
  b.nueva(Infinity);
  const ENV = { DB: b.DB, PANEL_CLAVE: "clave-de-prueba", TIENDA_NOMBRE: "Prueba" };
  const entrar = new FormData();
  entrar.set("clave", "clave-de-prueba");
  const r0 = await atenderPanel(new Request("https://bot.test/panel/entrar", { method: "POST", body: entrar }), ENV, { tienda: "Prueba" });
  const cookie = (r0.headers.get("set-cookie") || "").split(";")[0];
  let catalogo = [];
  const opciones = { tienda: "Prueba", rubro: "moda", traerCatalogo: async () => catalogo };
  const subir = async (n, probar) => {
    const archivo = new FormData();
    archivo.set("archivo", new File([["producto;talla;cantidad", ...Array.from({ length: n }, (_, i) => `Bota ${i};${38 + (i % 5)};${(i % 4) + 1}`)].join("\n")], "stock.csv", { type: "text/csv" }));
    if (probar) archivo.set("probar", "si");
    b.nueva();
    const r = await callado(() => atenderPanel(new Request("https://bot.test/panel/inventario/importar/csv", { method: "POST", body: archivo, headers: { cookie, "sec-fetch-site": "same-origin" } }), ENV, opciones));
    return { r, llamadas: b.pasada.llamadas };
  };
  let x = await subir(40, false);
  ok(x.r.status === 200 && /Excel importado/.test(await x.r.text()) && x.llamadas < TOPE, "un Excel de 40 filas: el informe enseguida", `${x.r.status}, ${x.llamadas} llamadas`);
  x = await subir(41, true);
  ok(x.r.status === 303 && /progreso/.test(x.r.headers.get("location") || ""), "uno de 41: a la barra de progreso");
  catalogo = catalogoGrande(30, { conCantidad: true }).map((m) => ({ ...m, fotos: [...m.fotos, "https://x/2.jpg", "https://x/3.jpg"] }));
  b.nueva();
  const traer = new FormData();
  const r = await callado(() => atenderPanel(new Request("https://bot.test/panel/inventario/importar/catalogo", { method: "POST", body: traer, headers: { cookie, "sec-fetch-site": "same-origin" } }), ENV, opciones));
  ok(r.status === 200 && /Catálogo traído/.test(await r.text()) && b.pasada.llamadas < TOPE, "30 modelos con fotos y cantidades: el informe enseguida", `${r.status}, ${b.pasada.llamadas} llamadas`);
}

titulo("los avisos dicen la verdad en cada tienda");
{
  const b = otraBase();
  b.nueva(Infinity);
  const ENV = { DB: b.DB, PANEL_CLAVE: "clave-de-prueba", TIENDA_NOMBRE: "Prueba" };
  const entrar = new FormData();
  entrar.set("clave", "clave-de-prueba");
  const r0 = await atenderPanel(new Request("https://bot.test/panel/entrar", { method: "POST", body: entrar }), ENV, { tienda: "Prueba" });
  const cookie = (r0.headers.get("set-cookie") || "").split(";")[0];
  await inv.empezarImportacion(b.DB, { tipo: "catalogo", items: catalogoGrande(50), opciones: {} });
  const leido = await inv.prepararCsv(b.DB, ["producto;cantidad", ...Array.from({ length: 80 }, (_, i) => `X ${i};1`)].join("\n"), {});
  await inv.empezarImportacion(b.DB, { tipo: "csv", items: leido.filas, opciones: { col: leido.col, sedeFija: leido.sedeFija, aplicar: false } });
  const ver = async (ruta, extra) => (await atenderPanel(new Request(`https://bot.test${ruta}`, { headers: { cookie, "sec-fetch-site": "same-origin" } }), ENV, { tienda: "Prueba", rubro: "moda", ...extra })).text();
  const conCron = await ver("/panel/inventario", { seSigueSola: true });
  const sinCron = await ver("/panel/inventario/importar", {});
  ok(/Sigue sola cada 15 minutos/.test(conCron) && !/en pausa/.test(conCron), "con cron: «sigue sola cada 15 minutos»");
  ok(/Está en pausa: ábrelo para que siga/.test(sinCron) && !/Sigue sola/.test(sinCron), "sin cron (EPICCELL): «está en pausa: ábrelo para que siga»");
  ok(/Un Excel a medio probar/.test(sinCron), "una prueba se llama prueba");
  const progreso = await ver("/panel/inventario/importar/progreso?id=1", {});
  ok(!/Worker|Cloudflare/.test(progreso.replace(/<script[\s\S]*?<\/script>/g, "")), "sin palabras técnicas en la página del progreso");
}

src.limpiar();
terminar();
