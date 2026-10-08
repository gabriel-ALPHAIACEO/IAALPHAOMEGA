// LOS ÍCONOS DE ALPHA IA (7-oct-2026).
//
// QUÉ SE PEDÍA. El dueño: "nada genérico; los emojis de Android no me
// gustan; que los diseños se vean propios". Los emojis cambian de dibujo
// según el teléfono (Android, iPhone, Windows) y hacen que el panel se vea
// improvisado. Estos son nuestros: el mismo trazo en todos lados.
//
// EL ESTILO: dibujados a mano en una cuadrícula de 24, trazo de 1.8 con
// puntas redondas, y un "acento": una parte rellena y suave (la puerta de
// la casa, la cara de la caja) que les da el sello de ALPHA IA. El acento
// toma el color de --ico-acento (por defecto el mismo del ícono, suave).
//
// CÓMO SE USAN. Cada página lleva UNA VEZ el SPRITE (los dibujos), y cada
// ícono es un <svg><use href="#i-nombre"></svg> que lo reutiliza:
//
//   icono("caja")                      → el ícono a 20 px
//   icono("ia", { clase: "grande" })   → con una clase más
//
// ESTE ARCHIVO ES IGUAL EN LAS TRES TIENDAS Y EN EL PANEL CENTRAL.

// El acento: relleno suave que respeta el color del ícono.
const A = 'style="fill:var(--ico-acento,currentColor);opacity:var(--ico-opacidad,.2)" stroke="none"';

const DIBUJOS = {
  inicio: `<path ${A} d="M10 14.2h4v6.3h-4z"/><path d="M3.5 10.6 12 4l8.5 6.6"/><path d="M5.5 9.2V19a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V9.2"/><path d="M10 20.5v-6.3h4v6.3"/>`,
  caja: `<rect ${A} x="6" y="14" width="5" height="3" rx="1"/><rect x="3" y="11" width="18" height="9.5" rx="2.5"/><rect x="6.5" y="3.5" width="9" height="5" rx="1.4"/><path d="M11 8.5V11M14.5 14.5h3M14.5 17h3"/>`,
  ventas: `<path ${A} d="M5.6 13.5h12.8l-.6 5.6a1.8 1.8 0 0 1-1.8 1.6H8a1.8 1.8 0 0 1-1.8-1.6Z"/><path d="M5 8h14l-1.2 11.1a1.8 1.8 0 0 1-1.8 1.6H8a1.8 1.8 0 0 1-1.8-1.6Z"/><path d="M9 10.5V6.5a3 3 0 0 1 6 0v4"/>`,
  inventario: `<path ${A} d="M12 11.6 20 7.4v9.2l-8 4.2Z"/><path d="M12 3.2 20 7.4v9.2l-8 4.2-8-4.2V7.4Z"/><path d="m4 7.4 8 4.2 8-4.2M12 11.6v9.2M8 5.3l8 4.2"/>`,
  gastos: `<path ${A} d="M16 12.5h5v4h-5a2 2 0 0 1 0-4Z"/><path d="M19 8.5V7A1.5 1.5 0 0 0 17.5 5.5H6A2.5 2.5 0 0 0 3.5 8v9A2.5 2.5 0 0 0 6 19.5h11.5A1.5 1.5 0 0 0 19 18v-1.5"/><path d="M16 12.5h4.5a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5H16a2 2 0 0 1 0-4Z"/><path d="M3.5 8.5A2.5 2.5 0 0 0 6 11h4"/>`,
  fiados: `<circle ${A} cx="12" cy="12" r="5.2"/><path d="M19.9 13.2A8 8 0 1 1 17.7 6.4"/><path d="M20.2 3.8v3.4h-3.4"/><path d="M13.9 9.6c-.4-.7-1.1-1-1.9-1-1.1 0-1.9.6-1.9 1.5 0 2.1 4 1.1 4 3.4 0 .9-.9 1.6-2.1 1.6-.9 0-1.7-.4-2.1-1.1M12 7.4v1.2M12 15.1v1.2"/>`,
  chats: `<path ${A} d="M20 11.5a7.5 7 0 0 1-10.6 6.4L4.5 19.5l1.4-3.9A7 6.6 0 1 1 20 11.5Z"/><path d="M20 11.5a7.5 7 0 0 1-10.6 6.4L4.5 19.5l1.4-3.9A7 6.6 0 1 1 20 11.5Z"/><path d="M8.6 11.5h.01M12.3 11.5h.01M16 11.5h.01" stroke-width="2.4"/>`,
  clientes: `<circle ${A} cx="9" cy="8.5" r="3.2"/><circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5c.6-3.2 2.9-5 5.5-5s4.9 1.8 5.5 5M15.5 5.6a3 3 0 0 1 0 5.8M17 14.6c2 .5 3.2 2.1 3.6 4.9"/>`,
  metricas: `<rect ${A} x="10.25" y="7" width="3.5" height="13" rx="1.75"/><rect x="4" y="12" width="3.5" height="8" rx="1.75"/><rect x="10.25" y="7" width="3.5" height="13" rx="1.75"/><rect x="16.5" y="3.5" width="3.5" height="16.5" rx="1.75"/>`,
  ganadores: `<path ${A} d="m12 3.8 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8Z"/><path d="m12 3.8 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8Z"/>`,
  errores: `<path ${A} d="M10.3 4.6a2 2 0 0 1 3.4 0l7 12.2a2 2 0 0 1-1.7 3H5a2 2 0 0 1-1.7-3Z"/><path d="M10.3 4.6a2 2 0 0 1 3.4 0l7 12.2a2 2 0 0 1-1.7 3H5a2 2 0 0 1-1.7-3Z"/><path d="M12 9.5v4M12 16.6h.01"/>`,
  anuncios: `<path ${A} d="M7 8.5 14.5 4.5v15L7 15.5Z"/><path d="M4 10v4a1.5 1.5 0 0 0 1.5 1.5H7l7.5 4v-15L7 8.5H5.5A1.5 1.5 0 0 0 4 10Z"/><path d="M18 9a4 4 0 0 1 0 6M8 15.5l1 4"/>`,
  salir: `<path d="M14 4.5h3.5A2.5 2.5 0 0 1 20 7v10a2.5 2.5 0 0 1-2.5 2.5H14M10 8l-4 4 4 4M6 12h9"/>`,
  sol: `<circle ${A} cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="4"/><path d="M12 2.8v1.7M12 19.5v1.7M2.8 12h1.7M19.5 12h1.7M5.5 5.5l1.2 1.2M17.3 17.3l1.2 1.2M5.5 18.5l1.2-1.2M17.3 6.7l1.2-1.2"/>`,
  luna: `<path ${A} d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>`,
  instalar: `<rect ${A} x="7" y="2.5" width="10" height="19" rx="2.5"/><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M12 7v7.5M9.2 11.8 12 14.6l2.8-2.8M10.5 18.5h3"/>`,
  buscar: `<circle ${A} cx="11" cy="11" r="6.5"/><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>`,
  mas: `<path d="M12 5v14M5 12h14"/>`,
  menos: `<path d="M5 12h14"/>`,
  cerrar: `<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>`,
  check: `<path d="m5 12.5 4.5 4.5L19 7.5"/>`,
  camara: `<circle ${A} cx="12" cy="12.5" r="3.5"/><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5Z"/><circle cx="12" cy="12.5" r="3.5"/>`,
  teclado: `<rect ${A} x="3" y="6" width="18" height="12" rx="3"/><rect x="3" y="6" width="18" height="12" rx="3"/><path d="M7 10h.01M10 10h.01M13 10h.01M16.5 10h.01M8 14h8"/>`,
  escanear: `<rect ${A} x="7" y="7" width="10" height="10" rx="1.5"/><path d="M4 8V6.5A2.5 2.5 0 0 1 6.5 4H8M16 4h1.5A2.5 2.5 0 0 1 20 6.5V8M20 16v1.5a2.5 2.5 0 0 1-2.5 2.5H16M8 20H6.5A2.5 2.5 0 0 1 4 17.5V16M8.5 8.5v7M11 8.5v7M13.5 8.5v7M15.5 8.5v7"/>`,
  etiqueta: `<path ${A} d="M3.5 5v7.4a1.5 1.5 0 0 0 .44 1.06L7.5 17 13 11.5 5 3.5a1.5 1.5 0 0 0-1.5 1.5Z"/><path d="M3.5 12.4V5A1.5 1.5 0 0 1 5 3.5h7.4a1.5 1.5 0 0 1 1.06.44l7.1 7.1a1.5 1.5 0 0 1 0 2.12l-7.4 7.4a1.5 1.5 0 0 1-2.12 0l-7.1-7.1A1.5 1.5 0 0 1 3.5 12.4Z"/><circle cx="8" cy="8" r="1.4"/>`,
  imprimir: `<path ${A} d="M7 14.5h10V20H7Z"/><path d="M7 9V4.5h10V9M7 17H5.5A2 2 0 0 1 3.5 15v-4A2 2 0 0 1 5.5 9h13a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H17"/><path d="M7 14.5h10V20H7ZM16.5 12h.01"/>`,
  subir: `<path ${A} d="M4.5 15h15v2.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2Z"/><path d="M12 15V4.5M7.5 9 12 4.5 16.5 9M4.5 15v2.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15"/>`,
  bajar: `<path ${A} d="M4.5 15h15v2.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2Z"/><path d="M12 4.5V15M7.5 10.5 12 15l4.5-4.5M4.5 15v2.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15"/>`,
  sede: `<path ${A} d="M10 19.5v-4h4v4Z"/><path d="M4 9.5 5.5 4.5h13L20 9.5M4 9.5a2.67 2.67 0 0 0 5.33 0 2.67 2.67 0 0 0 5.34 0 2.67 2.67 0 0 0 5.33 0M5.5 12v7.5h13V12M10 19.5v-4h4v4"/>`,
  movimientos: `<path d="M7 7.5h12M15.5 4 19 7.5 15.5 11M17 16.5H5M8.5 13 5 16.5 8.5 20"/>`,
  editar: `<path ${A} d="M14.5 5.5l4 4L9 19H5v-4Z"/><path d="M14.5 5.5l4 4L9 19H5v-4ZM12.5 7.5l4 4"/>`,
  borrar: `<path ${A} d="m6.5 7 .8 11.2A2 2 0 0 0 9.3 20h5.4a2 2 0 0 0 2-1.8L17.5 7Z"/><path d="M5 7h14M9.5 7V5A1.5 1.5 0 0 1 11 3.5h2A1.5 1.5 0 0 1 14.5 5v2M6.5 7l.8 11.2A2 2 0 0 0 9.3 20h5.4a2 2 0 0 0 2-1.8L17.5 7M10.5 11v5M13.5 11v5"/>`,
  archivar: `<rect ${A} x="3.5" y="4.5" width="17" height="4.5" rx="1.5"/><rect x="3.5" y="4.5" width="17" height="4.5" rx="1.5"/><path d="M5 9v8.5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/>`,
  atras: `<path d="M15 5.5 8.5 12l6.5 6.5"/>`,
  adelante: `<path d="M9 5.5l6.5 6.5L9 18.5"/>`,
  abajo: `<path d="m5.5 9 6.5 6.5L18.5 9"/>`,
  ia: `<path ${A} d="M11 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5Z"/><path d="M11 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5ZM18.5 15c.25 1.5 1 2.25 2.5 2.5-1.5.25-2.25 1-2.5 2.5-.25-1.5-1-2.25-2.5-2.5 1.5-.25 2.25-1 2.5-2.5Z"/>`,
  enviar: `<path ${A} d="m20 4-6 16-4.2-5.8L4 10Z"/><path d="m20 4-6 16-4.2-5.8L4 10ZM20 4 9.8 14.2"/>`,
  usuario: `<circle ${A} cx="12" cy="8.5" r="3.5"/><circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>`,
  telefono: `<path ${A} d="M6.5 3.5h2.4l1.6 4-2 1.3a10 10 0 0 0 1.4 2.4L8.4 13a14 14 0 0 1-3.9-7.3 2 2 0 0 1 2-2.2Z"/><path d="M6.5 3.5h2.4l1.6 4-2 1.3a10 10 0 0 0 6.7 6.7l1.3-2 4 1.6v2.4a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2Z"/>`,
  calendario: `<rect ${A} x="7" y="12.5" width="3.2" height="3.2" rx=".8"/><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>`,
  sube: `<path d="m4 16.5 5-5 3.5 3.5L20 7.5M15 7.5h5v5"/>`,
  baja: `<path d="m4 7.5 5 5 3.5-3.5L20 16.5M15 16.5h5v-5"/>`,
  alerta: `<circle ${A} cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V13M12 16.3h.01"/>`,
  info: `<circle ${A} cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.7h.01"/>`,
  idea: `<path ${A} d="M12 3.5a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V17h5.2v-.7c0-.8.4-1.5 1-2A6 6 0 0 0 12 3.5Z"/><path d="M12 3.5a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V17h5.2v-.7c0-.8.4-1.5 1-2A6 6 0 0 0 12 3.5ZM9.5 20.5h5"/>`,
  recibo: `<path ${A} d="M6 3.5h12v17l-2.4-1.5-2.4 1.5-2.4-1.5-2.4 1.5L6 20.5Z"/><path d="M6 3.5h12v17l-2.4-1.5-2.4 1.5-2.4-1.5-2.4 1.5L6 20.5ZM9 8h6M9 11.5h6M9 15h3.5"/>`,
  efectivo: `<circle ${A} cx="12" cy="12" r="2.6"/><rect x="2.5" y="6.5" width="19" height="11" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5h.01M18 14.5h.01"/>`,
  tarjeta: `<rect ${A} x="3" y="5.5" width="18" height="4.5"/><rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 14.5h3"/>`,
  pausa: `<rect ${A} x="7" y="5" width="3.5" height="14" rx="1.5"/><rect x="7" y="5" width="3.5" height="14" rx="1.5"/><rect x="13.5" y="5" width="3.5" height="14" rx="1.5"/>`,
  reanudar: `<path ${A} d="M8 5.5v13l10-6.5Z"/><path d="M8 5.5v13l10-6.5Z"/>`,
  filtro: `<path ${A} d="M4 5.5h16l-6 7.3v5.2l-4 2v-7.2Z"/><path d="M4 5.5h16l-6 7.3v5.2l-4 2v-7.2Z"/>`,
  puntos: `<path d="M6 12h.01M12 12h.01M18 12h.01" stroke-width="2.8"/>`,
  foto: `<path ${A} d="M4 17l4.5-4.5 3.5 3.5 2.5-2.5L20 18v.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z"/><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="9.5" r="1.8"/><path d="m4 17 4.5-4.5 3.5 3.5 2.5-2.5L20 18"/>`,
  medalla: `<circle ${A} cx="12" cy="14.5" r="5.5"/><circle cx="12" cy="14.5" r="5.5"/><path d="M8.6 10.2 6 3.5h4l2 4.5M15.4 10.2 18 3.5h-4l-1.2 2.6"/>`,
  reloj: `<circle ${A} cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v4.8l3 1.8"/>`,
  ojo: `<circle ${A} cx="12" cy="12" r="2.8"/><path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>`,
  carrito: `<path ${A} d="M6.6 8h12.4l-1.7 6.3a1 1 0 0 1-1 .7H8.2Z"/><path d="M3.5 4.5h2l2 10.5h10l2-7H6.6"/><circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>`,
  microfono: `<rect ${A} x="9" y="3.5" width="6" height="11" rx="3"/><rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/>`,
  escudo: `<path ${A} d="M12 3.5 19 6v5.5c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6Z"/><path d="M12 3.5 19 6v5.5c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6Z"/><path d="m9 12 2.2 2.2L15.5 10"/>`,
  queja: `<path ${A} d="M4 6a1.5 1.5 0 0 1 1.5-1.5H8v10H5.5A1.5 1.5 0 0 1 4 13Z"/><path d="M8 14.5V4.5M8 4.5h8.2a2 2 0 0 1 2 1.6l1.2 6a2 2 0 0 1-2 2.4H14l.8 3.6a1.9 1.9 0 0 1-3.5 1.3L8 14.5H5.5A1.5 1.5 0 0 1 4 13V6a1.5 1.5 0 0 1 1.5-1.5Z"/>`,
  rayo: `<path ${A} d="M13 3 5 13.5h6l-1 7.5 8-10.5h-6Z"/><path d="M13 3 5 13.5h6l-1 7.5 8-10.5h-6Z"/>`,
  copia: `<rect ${A} x="8.5" y="8.5" width="11" height="11" rx="2.5"/><rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6A2.5 2.5 0 0 0 13 3.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>`,
  enlace: `<path d="M10 14a4.5 4.5 0 0 0 6.4 0l2.7-2.7a4.5 4.5 0 0 0-6.4-6.4L11.5 6M14 10a4.5 4.5 0 0 0-6.4 0l-2.7 2.7a4.5 4.5 0 0 0 6.4 6.4l1.2-1.1"/>`,
  libre: `<circle ${A} cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="8.5"/><path d="M12 8v8M8 12h8"/>`,
  grafica: `<path ${A} d="M4 19.5V14l4.5-4 4 3 7.5-7v13.5Z"/><path d="M4 4.5v15h16"/><path d="m4 14 4.5-4 4 3 7.5-7"/>`,
  banco: `<path ${A} d="M4 9.5h16L12 4.5Z"/><path d="M4 9.5h16L12 4.5ZM5.5 9.5v8M9.8 9.5v8M14.2 9.5v8M18.5 9.5v8M3.5 20h17"/>`,
  camion: `<path ${A} d="M14.5 9.5h3.2l2.8 3.6v3.4h-6Z"/><path d="M3.5 6.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v10h-11ZM14.5 9.5h3.2l2.8 3.6v3.4h-6"/><circle cx="7.5" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>`,
  porcentaje: `<circle ${A} cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="8.5"/><path d="m8.5 15.5 7-7M9 9h.01M15 15h.01" stroke-width="2.2"/>`,
  herramienta: `<path ${A} d="M14.6 4.2a4.5 4.5 0 0 0-4.9 6.1l-5.4 5.4a1.8 1.8 0 0 0 2.6 2.6l5.4-5.4a4.5 4.5 0 0 0 6.1-4.9l-2.6 2.6-2.4-.6-.6-2.4Z"/><path d="M14.6 4.2a4.5 4.5 0 0 0-4.9 6.1l-5.4 5.4a1.8 1.8 0 0 0 2.6 2.6l5.4-5.4a4.5 4.5 0 0 0 6.1-4.9l-2.6 2.6-2.4-.6-.6-2.4Z"/>`,
  deshacer: `<path d="M8.5 5 4.5 9l4 4"/><path d="M4.5 9h10a5 5 0 0 1 0 10H9"/>`,
  candado: `<rect ${A} x="5" y="10.5" width="14" height="10" rx="2.5"/><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5M12 14.5v2"/>`,
  lista: `<path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" stroke-width="2"/>`,
  rejilla: `<rect ${A} x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>`,
};

export const NOMBRES_DE_ICONOS = Object.keys(DIBUJOS);

// Todos los dibujos, para poner UNA vez en la página (escondido).
export const SPRITE_ICONOS = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true"><defs>${Object.entries(DIBUJOS)
  .map(([nombre, dibujo]) => `<symbol id="i-${nombre}" viewBox="0 0 24 24">${dibujo}</symbol>`)
  .join("")}</defs></svg>`;

// Un ícono. Sin título es decorativo (lo lee el texto de al lado); con
// título, un lector de pantalla lo dice.
export function icono(nombre, { clase = "", titulo = "" } = {}) {
  const n = DIBUJOS[nombre] ? nombre : "puntos";
  const accesible = titulo ? `role="img" aria-label="${String(titulo).replace(/[&<>"]/g, "")}"` : 'aria-hidden="true"';
  return `<svg class="ico${clase ? ` ${clase}` : ""}" ${accesible} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><use href="#i-${n}"/></svg>`;
}

// El mismo ícono con el dibujo adentro, para las pocas partes que se pintan
// en páginas que no llevan el SPRITE (el botón del tema, por ejemplo).
export function iconoSuelto(nombre, { clase = "" } = {}) {
  const n = DIBUJOS[nombre] ? nombre : "puntos";
  return `<svg class="ico${clase ? ` ${clase}` : ""}" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${DIBUJOS[n]}</svg>`;
}
