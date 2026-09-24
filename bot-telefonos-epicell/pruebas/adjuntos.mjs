import { leerMensaje } from "./.stub/instagram.js";
import { desenvolver, leerAdjuntoCompartido } from "./.stub/publicacion.js";
import { NO_PUDE_ABRIRLO } from "./.stub/index.js";

let fallos = 0;
const comprobar = (n, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`✗ ${n}\n   esperado ${JSON.stringify(esperado)}\n   real     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${n}`);
};
const webhook = (m) => ({ entry: [{ messaging: [{ sender: { id: "1" }, message: { mid: "x", ...m } }] }] });

// El caso del registro: un post compartido con un tipo que no conocíamos
comprobar("fallback → publicación", leerMensaje(webhook({ attachments: [{ type: "fallback", payload: { url: "https://www.instagram.com/p/ABC/", title: "POCO M8 PRO" } }] })).tipo, "publicacion");
comprobar("y trae su título", leerMensaje(webhook({ attachments: [{ type: "fallback", payload: { url: "https://www.instagram.com/p/ABC/", title: "POCO M8 PRO" } }] })).publicacion.titulo, "POCO M8 PRO");

// Un tipo que Meta invente mañana, con URL: cajón de sastre
comprobar("tipo desconocido con URL → publicación", leerMensaje(webhook({ attachments: [{ type: "lo_que_sea_2027", payload: { url: "https://www.instagram.com/reel/XYZ/" } }] })).tipo, "publicacion");

// Lo que NO debe colarse como publicación
comprobar("una nota de voz no es publicación", leerMensaje(webhook({ attachments: [{ type: "audio", payload: { url: "https://cdn/x.mp4" } }] })).tipo, "texto");
comprobar("una foto sigue siendo foto", leerMensaje(webhook({ attachments: [{ type: "image", payload: { url: "https://cdn/x.jpg" } }] })).tipo, "imagen");
comprobar("un adjunto sin URL no inventa nada", leerAdjuntoCompartido([{ type: "raro", payload: {} }]), { url: "", titulo: "", enlace: "" });

// El redirector de Meta
comprobar("l.instagram.com se desenvuelve", desenvolver("https://l.instagram.com/?u=https%3A%2F%2Fwww.instagram.com%2Fp%2FABC%2F&e=xyz"), "https://www.instagram.com/p/ABC/");
comprobar("l.facebook.com también", desenvolver("https://l.facebook.com/l.php?u=https%3A%2F%2Fepiccell.com%2Fx"), "https://epiccell.com/x");
comprobar("un enlace normal no se toca", desenvolver("https://www.instagram.com/p/ABC/"), "https://www.instagram.com/p/ABC/");
comprobar("y el adjunto envuelto llega limpio", leerMensaje(webhook({ attachments: [{ type: "fallback", payload: { url: "https://l.instagram.com/?u=https%3A%2F%2Fwww.instagram.com%2Freel%2FPOCO%2F" } }] })).publicacion.enlace, "https://www.instagram.com/reel/POCO/");

// Y la red de seguridad: un mensaje en blanco
comprobar("hay frases para lo que no se puede abrir", NO_PUDE_ABRIRLO.length >= 3, true);
comprobar("ninguna saluda (ya se conocen)", NO_PUDE_ABRIRLO.every((f) => !/hola/i.test(f)), true);
comprobar("todas piden el equipo", NO_PUDE_ABRIRLO.every((f) => /equipo|modelo/i.test(f)), true);

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
