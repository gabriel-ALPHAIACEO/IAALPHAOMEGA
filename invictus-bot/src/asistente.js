// EL ASISTENTE, A LA VISTA EN TODO EL PANEL (8-oct-2026).
//
// QUÉ SE PEDÍA. Gabriel: "mejorar el asistente de los paneles, que sea
// visible para poder hablar con el asistente y que responda bien las
// preguntas según lo que está en el panel y lo que podemos hacer".
//
// LO QUE HABÍA. Una tarjeta "Pregúntale a tu negocio" solo en Inicio, al
// fondo de la columna izquierda. Solo veía los números del negocio, no
// sabía qué hace cada pantalla del panel ni cómo se hace nada, y además
// fallaba siempre: el POST leía `opciones.rubro` donde `opciones` no existía
// ("opciones is not defined" en cada pregunta).
//
// LO QUE HAY AHORA:
//   · Un botón flotante con el ícono de la IA en TODAS las páginas del
//     panel (arriba de la isla de pestañas en el teléfono, abajo a la
//     derecha en la computadora). Abre la charla sin salir de la pantalla.
//   · La charla es la misma en el botón y en la tarjeta de Inicio: se
//     recuerda mientras la pestaña siga abierta.
//   · El asistente recibe la GUÍA DEL PANEL (abajo): qué hay en cada
//     pantalla y cómo se hace cada cosa, con las palabras del negocio de la
//     tienda (tallas o capacidades). Sabe en qué pantalla está la persona.
//   · Puede proponer "Abrir Inventario" (u otra pantalla) como botón. Solo
//     rutas de esta lista: nunca un enlace inventado.
//   · Las reglas de siempre siguen: no inventa cifras, y si le piden anotar
//     un gasto lo deja listo para que una persona lo confirme.
//
// ESTE ARCHIVO ES IGUAL EN LAS TRES TIENDAS. marco.js pinta el botón;
// negocio.js usa la guía para preguntarle a la IA.

import { icono } from "./iconos.js";

function esc(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ── Las pantallas a las que puede mandar ────────────────────────────── */

// ruta (la de marco.js) → [dirección, nombre]. Lo que la IA ponga en "ir"
// tiene que ser una de estas direcciones, o no sale ningún botón.
export const PANTALLAS = {
  inicio: ["/panel/inicio", "Inicio"],
  caja: ["/panel/caja", "Caja"],
  ventas: ["/panel/ventas", "Ventas"],
  reportes: ["/panel/reportes", "Reportes"],
  ganancias: ["/panel/ganancias", "Ganancias"],
  pedidos: ["/panel/pedidos", "Pedidos web"],
  pagos: ["/panel/pedidos/pagos", "Métodos de pago"],
  inventario: ["/panel/inventario", "Inventario"],
  importar: ["/panel/inventario/importar", "Importar productos"],
  nuevo: ["/panel/inventario/nuevo", "Nuevo producto"],
  etiquetas: ["/panel/inventario/etiquetas", "Etiquetas"],
  sedes: ["/panel/inventario/sedes", "Sedes"],
  movimientos: ["/panel/inventario/movimientos", "Movimientos"],
  gastos: ["/panel/gastos", "Gastos"],
  chats: ["/panel", "Chats"],
  clientes: ["/panel/clientes", "Clientes"],
  metricas: ["/panel/metricas", "Métricas"],
  ganadores: ["/panel/ganadores", "Ganadores"],
  errores: ["/panel/errores", "Errores IA"],
  anuncios: ["/panel/anuncios", "Anuncios"],
};

const POR_DIRECCION = new Map(Object.values(PANTALLAS).map(([href, nombre]) => [href, nombre]));

// Lo que la IA propone abrir, si es una pantalla de verdad. Admite que
// escriba la clave ("inventario") o la dirección ("/panel/inventario").
export function pantallaValida(ir, { conAnuncios = true } = {}) {
  const t = String(ir || "").trim();
  if (!t) return null;
  const href = PANTALLAS[t]?.[0] || t.split(/[?#]/)[0];
  if (!POR_DIRECCION.has(href)) return null;
  if (href === "/panel/anuncios" && !conAnuncios) return null;
  return { href, nombre: POR_DIRECCION.get(href) };
}

// El nombre de la pantalla en la que está la persona (para la IA).
export function nombreDePantalla(ruta) {
  return PANTALLAS[ruta]?.[1] || "";
}

/* ── La guía del panel ───────────────────────────────────────────────── */
//
// Es lo que el asistente sabe de la APP. Si se agrega una pantalla o cambia
// cómo se hace algo, se cambia AQUÍ: si no, el asistente explica lo viejo.
// palabras: el rubro de marco.js (variante/variantes, gama, conSerial).

export function guiaDelPanel(palabras = {}, { conAnuncios = true, tarifaDeCaja = "" } = {}) {
  const v = palabras.variante || "variante";
  const vs = palabras.variantes || "variantes";
  const gama = palabras.gama || "";
  return `GUÍA DEL PANEL (qué hay en cada pantalla y cómo se hace cada cosa)

El menú tiene dos grupos. En la computadora va a la izquierda; en el teléfono
abajo hay Inicio, Caja, Inventario, Chats y "Más" con el resto.

TU NEGOCIO
· Inicio (/panel/inicio): cómo va el negocio hoy o en el período que se
  elija arriba (hoy, 7 días, 30 días, el mes, fechas a medida): vendido,
  cobrado, gastos, balance y ganancia; lo más vendido, las VENTAS POR
  CATEGORÍA (cuánto vendió cada sección: Relojes, Calzados…), lo que se está
  acabando, cómo te pagaron, consejos de ALPHA IA y este asistente.
· Caja (/panel/caja): cobrar. Se agrega cada producto escaneando su código
  de barras con un lector (USB o Bluetooth), con la cámara del teléfono, o
  escribiendo el nombre y tocándolo. Se elige ${v}, cantidad, cómo pagó
  (los métodos de pago de la lista) y se toca Cobrar. Al cobrar baja el
  stock y queda la venta con su recibo.${palabras.conSerial ? ` Para teléfonos pide el IMEI o serial, que sale en el recibo.` : ""}
  También cobra cosas que no están en el inventario (un servicio). Si se
  olvidó anotar las ventas de
  un día, arriba de "Cómo pagó" está "Venta de": Hoy, Ayer u Otro día. La
  venta queda en ese día (en Ventas, en Inicio y en el balance) y se marca
  "anotada después"; el stock baja en el momento en que se anota. La
  elección se queda mientras se cargan varias seguidas. (En "Vendí" de un
  producto también se puede poner el día.)
  Al tocar un producto que tiene colores, la caja pregunta primero el COLOR
  y después la ${v}; el stock baja de esa ${v} y de ninguna otra. CASHEA: al
  elegir "Cashea" aparece el nivel del cliente (cada nivel con su porcentaje
  de inicial, como en Cashea) o "Inicial libre" para escribir el porcentaje
  que se quiera; la caja muestra la INICIAL y el MONTO FINANCIADO (con sus
  cuotas) y pide con qué se pagó la inicial: Pago móvil, Transferencia,
  Punto de venta, Divisas o Zelle. Los porcentajes por nivel se cambian en
  Caja › Tabla de Cashea.${tarifaDeCaja === "cashea" ? `
  En esta tienda la caja cobra el PRECIO CASHEA; el precio en dólares solo
  si el cliente paga con "Divisas (efectivo)".` : ""}
· Ventas (/panel/ventas): todo lo cobrado, por día, con las ventas por
  categoría del período arriba. Cada venta abre su
  recibo: imprimir, mandarlo por WhatsApp o ANULAR (si se cobró mal: el
  stock vuelve y la venta queda marcada como anulada, no se borra). Se baja
  a Excel.
· Reportes (/panel/reportes): el reporte del día (o de hoy, ayer, 7 días, el
  mes, fechas a medida) para cerrar la caja: vendido, cobrado, gastos y
  balance, cómo se pagó y CASHEA (ventas con Cashea, inicial cobrada y con
  qué se pagó, monto financiado, por nivel y cada venta). Se imprime, se
  manda por WhatsApp o se baja a Excel.
· Ganancias (/panel/ganancias): lo que se ganó (precio de venta menos costo)
  venta por venta, por día y por producto, con el margen. Solo cuenta los
  productos que tienen el costo cargado (Inventario › Editar); avisa cuántos
  faltan. Al cobrar en la Caja, la pantalla de "Venta registrada" muestra la
  ganancia de esa venta y el botón "Ver todas las ganancias".
· Inventario (/panel/inventario): los productos con cuántos quedan. Buscador
  y filtros (con stock, por reponer, agotados) y, debajo, atajos por
  categoría (y «Sin categoría» para ver a cuáles les falta). Al abrir un producto se ven sus ${vs}, el
  stock por sede, su código de barras, y se edita nombre, marca, ${gama ? `${gama.toLowerCase()}, ` : ""}categoría,
  precio, precio Cashea (obligatorio) y costo. Las FOTOS se suben ahí mismo
  (desde el teléfono o la computadora, hasta 10): «Principal» elige la que
  sale primero (en la tienda web y en la ficha) y «Quitar» la saca. La cantidad de cada ${v} se cambia escribiéndola ahí mismo
  (se guarda sola, con Deshacer; sube = Entrada, baja = Ajuste). También se
  puede mover con el botón Mover: Entrada (llegó mercancía), Vendí (se
  vendió fuera de la caja), Devolución, o Contar (poner la cantidad exacta
  que se contó). Cada cambio queda en Movimientos.
  - Nuevo producto (/panel/inventario/nuevo): crear uno a mano con sus ${vs},
    sus fotos y su categoría. El precio Cashea es obligatorio.
    Al escribir las ${vs} aparece una casilla por cada una para poner cuántas
    hay (o "Igual para todas"). Lo mismo al añadir ${vs} a un producto, pero ahí lo que escribes se SUMA a lo que ya había (es una entrada).
  - Importar (/panel/inventario/importar): "Traer del catálogo" (trae los
    productos de la tienda online o la hoja de la tienda) o subir un Excel
    o CSV con columnas como producto, código, ${v}, color, cantidad, precio,
    sede. Conviene probar primero con "Solo probar". Lo grande se pasa por
    partes, con una barra de progreso: con esa página abierta va rápido, y
    si se cierra sigue donde iba. Mientras un Excel de verdad va a medias
    no se puede subir otro (hay que esperar o tocar Detener); el Excel es
    el conteo del momento en que se subió, así que lo que se vende en la
    caja mientras tanto se respeta.
  - Etiquetas (/panel/inventario/etiquetas): imprimir códigos de barras.
    Cada ${v} recibe sola su código (EAN-13 que empieza por 2). Formato
    impresora de etiquetas (rollo 50×25 mm) u hoja carta. Se elige cuántas
    copias y si llevan precio. El código de fábrica de un producto también
    pasa en la caja.
  - Sedes (/panel/inventario/sedes): las tiendas o almacenes; el stock se
    lleva por sede.
  - Movimientos (/panel/inventario/movimientos): todo lo que entró y salió,
    quién y cuándo.
  - El inventario completo se baja a Excel.
· Pedidos web (/panel/pedidos): los pagos que los clientes hicieron en la
  tienda web (/tienda) con su comprobante (foto o PDF). «Aprobar y anotar la
  venta» anota la venta con su método y baja el stock (si no alcanza, avisa:
  se corrige el stock o se aprueba sin anotar la venta y se cobra en la
  caja). «Rechazar» pide el motivo, que el cliente ve en el enlace de su
  pedido. Por revisar · Aprobados · Rechazados. Le llega aviso al asesor.
  - Métodos de pago (/panel/pedidos/pagos): Pago Móvil, Transferencia,
    Zelle, Zinli, Binance y los que se añadan, con sus datos (lo que ve el
    cliente) y si se pagan en dólares o bolívares; la tasa del día (Bs por
    dólar) es opcional. Un método sin datos no sale en la web; sin ninguno,
    la web solo pide por WhatsApp.
· Gastos (/panel/gastos): anotar lo que sale (monto, categoría, método,
  fecha). Se puede borrar uno mal puesto. Suma en el balance.

VENTAS CON IA (el bot que atiende Instagram, y WhatsApp donde esté encendido)
· Chats (/panel): las conversaciones en vivo, con filtros (con problemas,
  bot en pausa${conAnuncios ? ", de un anuncio" : ""}), y qué pensó la IA en cada
  respuesta. Se puede escribirle al cliente desde aquí (dentro de las 24 h
  desde su último mensaje), PAUSAR el bot en esa conversación o devolvérsela.
  Cuando un asesor escribe desde la app de Instagram el bot se pausa solo.
· Clientes (/panel/clientes): el CRM. Cada cliente con su etapa (Nuevo,
  Interesado, Quiere comprar, Vendido, Perdido), notas y etiquetas que
  edita la tienda. Filtros y Excel.
· Métricas (/panel/metricas): cómo atiende el bot en el período elegido:
  clientes, mensajes, respuestas de la IA, cuántos quieren comprar, cuántos
  pasaron al asesor, notas de voz y quejas, día por día. Se baja a Excel.
· Ganadores (/panel/ganadores): los productos que más ganas de comprar
  despiertan en el chat (quieren comprar, clientes que lo vieron, veces
  mostrado). Se baja a Excel.
· Errores IA (/panel/errores): respuestas del bot marcadas como mal. Se
  marcan como solucionadas con "Solucionar errores" (no se borran).${conAnuncios ? `
· Anuncios (/panel/anuncios): los anuncios y los clientes que llegaron por
  ellos.` : ""}

OTRAS COSAS
· El panel se instala como programa (botón "Instalar la app"), en
  computadora, Android o iPhone.
· Al entrar se puede dejar la sesión abierta (90 días) para no poner la
  clave a cada rato.
· Tema claro u oscuro con el botón del sol/luna.

REGLAS QUE NO CAMBIAN
· El stock solo baja cuando una persona confirma la venta (Cobrar en la
  caja o "Vendí" en el inventario). La IA nunca descuenta ni aparta nada.
· Lo confidencial de ALPHA IA (gastos de la IA, estado técnico) no está en
  este panel.

LO QUE TODAVÍA NO HACE (dilo así si lo piden): facturación fiscal (SENIAT),
compras a proveedores con cuentas por pagar, varios usuarios con permisos
distintos, y guardar ventas sin internet.`;
}

/* ── El botón flotante y la charla ───────────────────────────────────── */

const SUGERENCIAS = {
  inicio: ["¿Cuánto vendí esta semana?", "¿Qué se está acabando?", "Dame una idea para vender más"],
  caja: ["¿Cómo cobro con la cámara?", "¿Cómo cobro con Cashea?", "¿Cómo anulo una venta?"],
  ventas: ["¿Cuánto vendí hoy?", "¿Cómo anulo una venta?", "¿Cómo mando el recibo por WhatsApp?"],
  ganancias: ["¿Cuánto gané hoy?", "¿Qué producto me deja más ganancia?", "¿Por qué una venta sale sin ganancia?"],
  reportes: ["¿Cuánto cobré de inicial de Cashea hoy?", "¿Cuánto se financió con Cashea?", "¿Cómo mando el reporte por WhatsApp?"],
  inventario: ["¿Cómo cargo mi inventario de Excel?", "¿Cómo imprimo las etiquetas?", "¿Qué se está acabando?"],
  gastos: ["¿En qué gasté más este mes?", "Gasté 20 en transporte", "¿Cuál es mi balance?"],
  pedidos: ["¿Cómo apruebo un pago de la web?", "¿Dónde pongo mis datos de Pago Móvil?", "¿Qué pasa si rechazo un pedido?"],
  chats: ["¿Cómo pauso el bot con un cliente?", "¿Cómo le escribo a un cliente?"],
  clientes: ["¿Cómo marco un cliente como vendido?", "¿Cómo bajo los clientes a Excel?"],
};
const SUGERENCIAS_POR_DEFECTO = ["¿Qué puedo hacer en esta pantalla?", "¿Cuánto vendí hoy?", "¿Qué se está acabando?"];

export function sugerenciasPara(ruta) {
  return SUGERENCIAS[ruta] || SUGERENCIAS_POR_DEFECTO;
}

// El botón y la ventana de la charla. Va en todas las páginas del panel
// (marco.js → documento). En Inicio la tarjeta grande sigue: es la misma
// charla.
export function botonDelAsistente(ruta = "") {
  const sugerencias = sugerenciasPara(ruta);
  return `<button type="button" class="asis-boton no-imprimir" popovertarget="asis-ventana" aria-label="Hablar con el asistente" title="Asistente ALPHA IA">${icono("ia")}<span>Asistente</span></button>
<div popover id="asis-ventana" class="asis-ventana no-imprimir" data-pantalla="${esc(ruta)}" role="dialog" aria-label="Asistente ALPHA IA">
<div class="asis-cabeza"><span class="ia-marca">${icono("ia")}</span><div><b>Asistente ALPHA IA</b><small>Pregúntame por tus números o cómo se hace algo en el panel</small></div><button type="button" class="icono fantasma" popovertarget="asis-ventana" popovertargetaction="hide" aria-label="Cerrar">${icono("cerrar")}</button></div>
<div class="ia-charla asis-charla" data-ia-charla aria-live="polite"></div>
<div class="ia-sugerencias" data-ia-sugerencias>${sugerencias.map((t) => `<button type="button" data-pregunta="${esc(t)}">${esc(t)}</button>`).join("")}</div>
<form class="ia-preguntar" data-ia-form><input name="pregunta" placeholder="Escribe tu pregunta…" autocomplete="off" maxlength="500" required><button class="principal" aria-label="Preguntar">${icono("enviar")}</button></form>
</div>${SCRIPT_ASISTENTE}`;
}

export const ESTILO_ASISTENTE = `
.asis-boton{position:fixed;z-index:25;right:22px;bottom:calc(22px + env(safe-area-inset-bottom));display:inline-flex;align-items:center;gap:8px;min-height:52px;padding:0 20px 0 16px;border:0;border-radius:999px;color:#fff;font-weight:750;font-size:14.5px;background:var(--grad-ia);box-shadow:inset 0 1px 0 rgba(255,255,255,.35),0 16px 34px -12px rgba(139,124,255,.95);cursor:pointer;animation:entrar .6s var(--resorte) both}
.asis-boton .ico{width:22px;height:22px;--ico-acento:#fff;--ico-opacidad:.45}
.asis-boton:hover{transform:translateY(-2px)}
.asis-ventana{position:fixed;inset:auto 22px calc(86px + env(safe-area-inset-bottom)) auto;margin:0;width:min(420px,calc(100vw - 32px));max-height:min(620px,calc(100dvh - 120px));padding:16px;border-radius:26px;border:1px solid var(--borde-fuerte);background:var(--tarjeta-alta);color:var(--texto);box-shadow:var(--sombra-alta);flex-direction:column;overflow:hidden}
.asis-ventana:popover-open,.asis-ventana.abierto{display:flex}
.asis-ventana:not(:popover-open):not(.abierto){display:none}
.asis-cabeza{display:flex;align-items:center;gap:12px;margin-bottom:12px}
.asis-cabeza>div{flex:1;min-width:0}
.asis-cabeza b{display:block;font-size:15.5px}
.asis-cabeza small{display:block;font-size:12.5px;color:var(--suave)}
.asis-cabeza .ia-marca{width:38px;height:38px;border-radius:14px}
.asis-charla{flex:1;max-height:none;min-height:60px}
.asis-ventana .ia-sugerencias{margin-bottom:10px}
.ia-ir{align-self:flex-start;display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:999px;font-size:13px;font-weight:750;text-decoration:none;color:var(--texto);background:var(--velo);border:1px solid var(--borde);animation:entrar .5s var(--resorte) both}
@media (max-width:999px){.asis-boton{right:16px;bottom:calc(90px + env(safe-area-inset-bottom));min-height:48px;padding:0 16px 0 14px}.asis-ventana{inset:auto 16px calc(148px + env(safe-area-inset-bottom)) 16px;width:auto;max-height:calc(100dvh - 190px)}}
@media (max-width:640px){.asis-boton span{display:none}.asis-boton{width:52px;padding:0;justify-content:center}}
@media print{.asis-boton,.asis-ventana{display:none!important}}
`;

// La charla: sirve para la ventana flotante y para la tarjeta de Inicio
// (cualquier bloque con data-ia-charla / data-ia-form dentro de un mismo
// padre). Pregunta sin recargar, enseña "escribiendo…", los botones para
// abrir una pantalla y, si propone registrar algo, el botón para
// confirmarlo (la IA nunca lo registra sola). La conversación se recuerda
// mientras la pestaña esté abierta y es la misma en los dos sitios.
export const SCRIPT_ASISTENTE = `<script>
(function(){
if(window.__alphaAsistente)return;window.__alphaAsistente=1;
var K="alpha-asistente",hist=[];try{hist=JSON.parse(sessionStorage.getItem(K)||"[]")}catch(e){}
var pantalla=(document.getElementById("asis-ventana")||{}).getAttribute?document.getElementById("asis-ventana").getAttribute("data-pantalla")||"":"";
function esc(t){return String(t==null?"":t).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function plata(n){var v=Number(n)||0,e=Math.abs(v-Math.round(v))<.005;return"$"+v.toLocaleString("es-VE",{minimumFractionDigits:e?0:2,maximumFractionDigits:e?0:2})}
function guardar(){try{sessionStorage.setItem(K,JSON.stringify(hist.slice(-16)))}catch(e){}}
function quien(){try{return localStorage.getItem("inv_quien")||""}catch(e){return""}}
var charlas=[].slice.call(document.querySelectorAll("[data-ia-charla]"));if(!charlas.length)return;
function bajar(c){c.scrollTop=c.scrollHeight}
function burbuja(c,de,texto){var d=document.createElement("div");d.className=de==="yo"?"ia-yo":"ia-ella";d.textContent=texto;c.appendChild(d);bajar(c);return d}
function boton(c,ir){if(!ir||!ir.href)return;var a=document.createElement("a");a.className="ia-ir";a.href=ir.href;a.textContent="Abrir "+ir.nombre+" \\u2192";c.appendChild(a);bajar(c)}
charlas.forEach(function(c){hist.slice(-10).forEach(function(h){burbuja(c,h.de,h.texto);if(h.ir)boton(c,h.ir)})});
function propuesta(c,a){
 var d=document.createElement("div");d.className="ia-propuesta";
 var texto="Registrar un gasto de <b>"+esc(plata(a.monto))+"</b> en "+esc(a.categoria)+(a.descripcion?" ("+esc(a.descripcion)+")":"");
 d.innerHTML='<span>'+texto+'</span><button type="button" class="fantasma chico" data-no>No</button><button type="button" class="principal chico" data-si>Sí, registrar</button>';
 c.appendChild(d);bajar(c);
 d.querySelector("[data-no]").onclick=function(){d.remove()};
 d.querySelector("[data-si]").onclick=function(){var b=this;b.disabled=true;
  var url="/panel/gastos/nuevo";
  var datos={monto:a.monto,categoria:a.categoria,descripcion:a.descripcion,quien:quien()};
  fetch(url,{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify(datos)}).then(function(r){return r.json()}).then(function(r){
   if(!r.ok){b.disabled=false;d.querySelector("span").textContent=r.error||"No se pudo registrar.";return}
   d.innerHTML='<span>Listo: '+esc(r.mensaje||"registrado")+'. Actualizando tus números…</span>';hist.push({de:"ella",texto:"Listo: "+(r.mensaje||"registrado")+"."});guardar();setTimeout(function(){location.reload()},1300);
  }).catch(function(){b.disabled=false;d.querySelector("span").textContent="Sin conexión: no se registró nada."})};
}
var ocupado=false;
function preguntar(c,texto){
 texto=String(texto||"").trim();if(!texto||ocupado)return;ocupado=true;
 burbuja(c,"yo",texto);var ant=hist.slice(-6).map(function(h){return{de:h.de,texto:h.texto}});hist.push({de:"yo",texto:texto});guardar();
 var esp=document.createElement("div");esp.className="ia-ella ia-escribiendo";esp.innerHTML="<i></i><i></i><i></i>";c.appendChild(esp);bajar(c);
 fetch("/panel/asistente",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify({pregunta:texto,historial:ant,pantalla:pantalla,direccion:location.pathname})}).then(function(r){return r.json()}).then(function(r){
  esp.remove();ocupado=false;var t=r.ok?r.respuesta:(r.error||"No pude responder.");burbuja(c,"ella",t);
  var h={de:"ella",texto:t};if(r.ok&&r.ir){h.ir=r.ir;boton(c,r.ir)}hist.push(h);guardar();if(r.ok&&r.accion)propuesta(c,r.accion);
 }).catch(function(){esp.remove();ocupado=false;burbuja(c,"ella","Sin conexión. Prueba otra vez.")});
}
charlas.forEach(function(c){
 var caja=c.parentNode,form=caja.querySelector("[data-ia-form]");
 if(form)form.addEventListener("submit",function(e){e.preventDefault();var i=form.querySelector("input");preguntar(c,i.value);i.value=""});
 caja.querySelectorAll("[data-pregunta]").forEach(function(b){b.onclick=function(){preguntar(c,b.getAttribute("data-pregunta"))}});
});
var v=document.getElementById("asis-ventana");
if(v)v.addEventListener("toggle",function(e){if(e.newState==="open"){var c=v.querySelector("[data-ia-charla]");bajar(c);var i=v.querySelector("input");if(i&&matchMedia("(pointer:fine)").matches)i.focus()}});
})();
</script>`;
