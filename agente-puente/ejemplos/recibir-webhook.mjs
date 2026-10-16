// EJEMPLO: recibir el stock del agente puente con Node (sin dependencias).
// Ver PROTOCOLO.md.   CLAVE=... FIRMA=... node recibir-webhook.mjs
import http from "node:http";
import crypto from "node:crypto";

const CLAVE = process.env.CLAVE || "";
const FIRMA = process.env.FIRMA || "";
const igual = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

http
  .createServer(async (req, res) => {
    const trozos = [];
    for await (const t of req) trozos.push(t);
    const cuerpo = Buffer.concat(trozos).toString("utf8"); // tal cual: la firma es sobre esto
    const responder = (estado, datos) => res.writeHead(estado, { "content-type": "application/json" }).end(JSON.stringify(datos));

    if (!CLAVE || !igual(String(req.headers["x-api-key"] || ""), CLAVE)) return responder(401, { error: "clave incorrecta" });
    const tiempo = String(req.headers["x-puente-tiempo"] || "");
    const esperada = `sha256=${crypto.createHmac("sha256", FIRMA).update(`${tiempo}.${cuerpo}`).digest("hex")}`;
    if (!FIRMA || !igual(String(req.headers["x-puente-firma"] || ""), esperada) || Math.abs(Date.now() - Number(tiempo)) > 5 * 60 * 1000) {
      return responder(401, { error: "firma inválida" });
    }
    const datos = JSON.parse(cuerpo);
    for (const p of datos.productos) {
      // La cantidad es la que CONTÓ el sistema: se PONE, no se suma.
      console.log(`${p.codigo ?? p.producto}: ${p.cantidad}`);
    }
    responder(200, { recibido: datos.productos.length, parte: datos.parte, partes: datos.partes });
  })
  .listen(8080, () => console.log("Esperando el stock en http://localhost:8080"));
