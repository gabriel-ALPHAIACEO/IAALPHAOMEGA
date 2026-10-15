// LOS DATOS DE LA TIENDA EN RODRIGO (15-oct-2026): horario, envíos, delivery y
// empleo. Hoy tienda.txt está VACÍO, así que el bot NO los sabe y no los
// inventa: los confirma un asesor. Cuando el dueño los escriba, el mismo
// código los contesta y no deja que la IA se salga de ellos.

import { prepararSrc, ok, titulo, terminar } from "./ayuda.mjs";

const src = await prepararSrc();
const D = await src.cargar("datos.js");

titulo("tienda.txt vacío: no hay ningún dato, y no hay datos de otra tienda");
{
  ok(["horarios", "envios", "delivery", "trabajo"].every((t) => D.hayDato(t) === false), "ningún tema tiene dato");
  ok(Object.values(D.RESPUESTAS).every((v) => v === ""), "y ninguna respuesta fija", JSON.stringify(D.RESPUESTAS));
  ok(D.queDatoPide("a que hora abren?") === "" && D.queDatoPide("hacen envios?") === "", "sin dato no hay atajo: contesta el modelo, que sabe que NO lo sabe");
  const p = D.datosParaElPrompt();
  ok(/Estos NO los sabes \(la tienda todavía no los cargó\): Horario, Envíos, Delivery, Empleo/.test(p) && /Eso te lo confirma un asesor en un momento 😊/.test(p), "el prompt manda al asesor los cuatro", p.slice(0, 200));
  ok(!/\d\s*(am|pm)|ZOOM|MRW|Margarita|delivery a|8:30/i.test(p.replace(/Delivery/g, "")), "sin horas, empresas ni zonas de otra tienda", p);
}

titulo("al escribir sus datos, el mismo código los hace cumplir");
{
  D.usarDatosDeTienda("[HORARIOS]\n🕘 Nuestro horario:\n\n🔹 Lunes a sábado — 9:00am a 6:00pm\n\n¡Te esperamos! 😊\n\n[ENVIOS]\nSí hacemos envíos con MRW a todo el país 📦\n\n[DELIVERY]\nPor ahora no hacemos delivery 😊\n\n[TRABAJO]\n");
  ok(D.hayDato("horarios") && D.hayDato("envios") && D.hayDato("delivery") && !D.hayDato("trabajo"), "los tres escritos cuentan; el empleo, vacío, sigue sin dato");
  ok(D.queDatoPide("a que hora abren?") === "horarios" && D.queDatoPide("hacen envios?") === "envios", "ahora sí detecta la pregunta");
  const hora = D.revisarDatoDeLaTienda("Abrimos de 8am a 4pm 🕘", "horarios");
  ok(hora.corregido && /9:00am a 6:00pm/.test(hora.respuesta), "una hora inventada se cambia por el horario escrito", hora.respuesta);
  const empresa = D.revisarDatoDeLaTienda("Enviamos por Zoom a todo el país", "envios");
  ok(empresa.corregido && /MRW/.test(empresa.respuesta), "una empresa de envíos que no es la suya se cambia por la suya");
  const delivery = D.revisarDatoDeLaTienda("Sí, hacemos delivery 🛵", "delivery");
  ok(delivery.corregido && /no hacemos delivery/.test(delivery.respuesta), "si dice que no hay delivery, la IA no puede decir que sí");
  ok(D.revisarDatoDeLaTienda("¡Claro! Abrimos de lunes a sábado de 9:00am a 6:00pm 🕘", "horarios").corregido === false, "y lo correcto pasa tal cual");
}

terminar();
