// LO RECIÉN TRAÍDO NO ES AGOTADO (11-oct-2026, pedido del dueño): al traer
// el catálogo, un modelo sin ninguna talla contada sale "Sin contar · pon
// las unidades", no "Agotado", y no cuenta como agotado ni por reponer.

import { prepararSrc, baseDeMentira, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const inv = await src.cargar("inventario.js");
const { pastillaDeStock } = await src.cargar("marco.js");
const { DB } = baseDeMentira();

const nuevo = await inv.guardarProducto(DB, { titulo: "Adidas Campus nuevo", origen: "shopify", origen_id: "1", precio: 75 });
const idNuevo = nuevo?.id ?? nuevo;
await inv.guardarVariante(DB, idNuevo, { opcion: "única" });
const viejo = await inv.guardarProducto(DB, { titulo: "Adidas Samba contado", origen: "shopify", origen_id: "2", precio: 75 });
const idViejo = viejo?.id ?? viejo;
const v = await inv.guardarVariante(DB, idViejo, { opcion: "única" });
const [sede] = await inv.sedes(DB);
await inv.ajustarStock(DB, { varianteId: v?.id ?? v, sedeId: sede.id, cantidad: 0 });

titulo("la lista");
const todos = await inv.listarProductos(DB);
const n = todos.find((p) => p.titulo === "Adidas Campus nuevo");
const c = todos.find((p) => p.titulo === "Adidas Samba contado");
ok(n && Number(n.contadas) === 0, "el recién traído no tiene ninguna talla contada");
ok(c && Number(c.contadas) === 1 && Number(c.total) === 0, "el contado en 0 sí");
const agotados = await inv.listarProductos(DB, { agotados: true });
ok(agotados.length === 1 && agotados[0].titulo === "Adidas Samba contado", "el filtro Agotados solo trae el contado en 0");

titulo("los números de arriba");
const cuenta = await inv.contarProductos(DB);
ok(cuenta.agotados === 1 && cuenta.sinContar === 1 && cuenta.porReponer === 1, "1 agotado, 1 sin contar, 1 por reponer", JSON.stringify(cuenta));

titulo("la etiqueta de la foto");
ok(/Sin contar · pon las unidades/.test(pastillaDeStock(0, { sinContar: true })), "sin contar → «Sin contar · pon las unidades»");
ok(/Agotado/.test(pastillaDeStock(0)), "contado en 0 → «Agotado»");

terminar();
