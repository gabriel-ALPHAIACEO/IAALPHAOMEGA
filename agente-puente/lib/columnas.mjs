// QUÉ ES CADA COLUMNA. Cada sistema llama distinto a lo mismo («Existencia»,
// «STOCK_ACT», «Qty»…). Aquí se reconocen solas las de siempre (en español y en
// inglés, con o sin tildes) y, si el sistema usa nombres raros, se dicen en
// config.json:
//
//   "columnas": { "codigo": "CO_ART", "producto": "ART_DES", "cantidad": "STOCK_ACT", "precio": "PREC_VTA1" }
//
// Los campos: codigo, producto, talla, color, cantidad, precio, costo, marca,
// sede, categoria, foto. Hace falta la CANTIDAD y el CÓDIGO o el PRODUCTO.

import { aNumero } from "./tabla.mjs";

export function normal(texto) {
  return String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// exactos: el encabezado entero; prefijos: el encabezado empieza así.
// El orden importa: «Precio de compra» es costo antes que precio.
export const CAMPOS = {
  costo: { exactos: ["costo", "preciocosto", "preciodecosto", "costounitario", "preciocompra", "preciodecompra", "compra", "cost", "unitcost"], prefijos: ["costo", "preciodecosto", "preciocosto", "preciodecompra", "preciocompra", "cost"] },
  precio: { exactos: ["precio", "pvp", "precioventa", "preciodeventa", "preciousd", "valor", "price", "saleprice", "precio1"], prefijos: ["precio", "pvp", "price"] },
  codigo: { exactos: ["codigo", "cod", "sku", "barras", "codigodebarras", "codigobarras", "ean", "upc", "referencia", "ref", "code", "barcode", "id", "idproducto", "itemcode"], prefijos: ["codigo", "cod", "sku", "referencia", "barcode", "ean"] },
  cantidad: { exactos: ["cantidad", "stock", "existencia", "existencias", "unidades", "inventario", "cant", "qty", "quantity", "disponible", "saldo", "onhand"], prefijos: ["cantidad", "stock", "existencia", "unidades", "cant", "qty", "quantity", "disponible", "saldo"] },
  producto: { exactos: ["producto", "modelo", "titulo", "nombre", "descripcion", "articulo", "item", "name", "title", "description", "product"], prefijos: ["producto", "descripcion", "nombre", "articulo", "titulo", "modelo", "product", "description"] },
  talla: { exactos: ["talla", "tallas", "opcion", "capacidad", "tamano", "medida", "size", "variante", "variant"], prefijos: ["talla", "capacidad", "size"] },
  color: { exactos: ["color", "colores", "colour"], prefijos: ["color"] },
  marca: { exactos: ["marca", "fabricante", "brand", "manufacturer"], prefijos: ["marca", "brand"] },
  sede: { exactos: ["sede", "local", "tienda", "almacen", "sucursal", "deposito", "bodega", "store", "warehouse", "location"], prefijos: ["sede", "almacen", "sucursal", "deposito", "bodega"] },
  categoria: { exactos: ["categoria", "categorias", "departamento", "linea", "grupo", "familia", "rubro", "category", "department"], prefijos: ["categoria", "departamento", "category"] },
  foto: { exactos: ["foto", "fotos", "imagen", "imagenes", "image", "images", "photo", "urlimagen", "imagenurl", "imageurl"], prefijos: ["foto", "imagen", "image"] },
};
export const NOMBRES_DE_CAMPOS = Object.keys(CAMPOS);

// Para el panel de una tienda ALPHA IA: el nombre que entiende su importador.
const ENCABEZADO_ALPHA = { codigo: "codigo", producto: "producto", talla: "talla", color: "color", cantidad: "cantidad", precio: "precio", costo: "costo", marca: "marca", sede: "sede" };

// columnas: los encabezados que trajo el sistema. mapeo: lo de config.json.
// Devuelve { indices: { campo: i | -1 }, problemas: [texto], comoSeLeyo: [{ campo, columna, dicho }] }.
export function detectarColumnas(columnas, mapeo = {}) {
  const normales = columnas.map(normal);
  const indices = Object.fromEntries(NOMBRES_DE_CAMPOS.map((c) => [c, -1]));
  const usadas = new Set();
  const problemas = [];
  const comoSeLeyo = [];
  for (const [campo, nombre] of Object.entries(mapeo || {})) {
    if (!(campo in CAMPOS)) {
      problemas.push(`En "columnas", «${campo}» no es un campo. Los que hay: ${NOMBRES_DE_CAMPOS.join(", ")}.`);
      continue;
    }
    if (nombre === "" || nombre === null || nombre === false) {
      // "precio": "" = no usar esa columna aunque se reconozca sola.
      usadas.add(`no:${campo}`);
      continue;
    }
    const i = normales.indexOf(normal(nombre));
    if (i === -1) {
      problemas.push(`La columna «${nombre}» que pusiste para «${campo}» no está en lo que manda el sistema. Las que hay: ${columnas.join(", ")}.`);
      continue;
    }
    indices[campo] = i;
    usadas.add(i);
    comoSeLeyo.push({ campo, columna: columnas[i], dicho: true });
  }
  for (const [campo, { exactos, prefijos }] of Object.entries(CAMPOS)) {
    if (indices[campo] !== -1 || usadas.has(`no:${campo}`) || campo in (mapeo || {})) continue;
    // Por orden de los nombres (no de las columnas): si están «ID» y «Código»,
    // el código es «Código».
    const buscar = (lista, igual) => {
      for (const nombre of lista) {
        const k = normales.findIndex((c, n) => !usadas.has(n) && c && igual(c, nombre));
        if (k !== -1) return k;
      }
      return -1;
    };
    let i = buscar(exactos, (c, n) => c === n);
    if (i === -1) i = buscar(prefijos, (c, n) => c.startsWith(n));
    if (i !== -1) {
      indices[campo] = i;
      usadas.add(i);
      comoSeLeyo.push({ campo, columna: columnas[i], dicho: false });
    }
  }
  if (indices.cantidad === -1) problemas.push(`No encuentro la columna de la CANTIDAD (cantidad, stock, existencia…). Las que hay: ${columnas.join(", ")}. Dila en config.json: "columnas": { "cantidad": "NOMBRE_DE_LA_COLUMNA" }.`);
  if (indices.codigo === -1 && indices.producto === -1) problemas.push(`No encuentro ni el CÓDIGO ni el NOMBRE del producto. Las que hay: ${columnas.join(", ")}. Dilas en config.json: "columnas": { "codigo": "…", "producto": "…" }.`);
  comoSeLeyo.sort((a, b) => NOMBRES_DE_CAMPOS.indexOf(a.campo) - NOMBRES_DE_CAMPOS.indexOf(b.campo));
  return { indices, problemas, comoSeLeyo };
}

export function textoDeLasColumnas(comoSeLeyo) {
  return comoSeLeyo.map((x) => `${x.campo} ← «${x.columna}»${x.dicho ? " (dicho en config.json)" : ""}`).join(", ");
}

// La tabla con solo los campos reconocidos y sus nombres de siempre (para una
// tienda ALPHA IA: su importador entiende esos encabezados). Los valores van
// tal cual los escribió el sistema: la tienda los interpreta.
export function tablaParaAlpha(tabla, indices) {
  const campos = Object.keys(ENCABEZADO_ALPHA).filter((c) => indices[c] !== -1);
  return {
    columnas: campos.map((c) => ENCABEZADO_ALPHA[c]),
    filas: tabla.filas.map((f) => campos.map((c) => f[indices[c]] ?? "")),
  };
}

// Los productos como objetos limpios (para cualquier otra plataforma): números
// de verdad, y lo que no es un campo conocido va en «extras». El costo solo
// si se pide (es un dato interno del negocio).
export function productosDe(tabla, indices, { conCosto = false } = {}) {
  const conocidas = new Set(Object.values(indices).filter((i) => i !== -1));
  const productos = [];
  let saltadas = 0;
  for (const f of tabla.filas) {
    const v = (campo) => (indices[campo] === -1 ? "" : String(f[indices[campo]] ?? "").trim());
    if (!v("codigo") && !v("producto")) {
      saltadas++;
      continue;
    }
    const p = { codigo: v("codigo") || null, producto: v("producto") || null, cantidad: aNumero(v("cantidad")) };
    for (const campo of ["talla", "color", "marca", "sede", "categoria", "foto"]) if (v(campo)) p[campo] = v(campo);
    if (v("precio")) p.precio = aNumero(v("precio"));
    if (conCosto && v("costo")) p.costo = aNumero(v("costo"));
    const extras = {};
    tabla.columnas.forEach((nombre, i) => {
      if (!conocidas.has(i) && String(f[i] ?? "").trim() !== "") extras[nombre] = f[i];
    });
    if (Object.keys(extras).length) p.extras = extras;
    productos.push(p);
  }
  return { productos, saltadas };
}
