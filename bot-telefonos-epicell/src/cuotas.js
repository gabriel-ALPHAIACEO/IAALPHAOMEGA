// RED DE SEGURIDAD PARA LO QUE SE PROMETE DE CASHEA Y KRECE.
//
// EL FALLO QUE RESUELVE, tal como pasó. El bot le dijo a un cliente que
// había "0% con Cashea". No existe: la inicial más baja de Cashea es 20%
// y la de Krece 15%. El cliente entiende que no paga nada el primer día,
// viene a la tienda con las manos vacías, y la venta se cae en el
// mostrador — con el cliente enfadado y con razón.
//
// De dónde sale. El prompt dice SIN INTERESES, que es cierto, y el modelo
// lo convierte en "0%". Son dos cosas distintas: los intereses son lo que
// se paga de más por financiar (y ahí sí es cero), la inicial es lo que
// se paga el primer día (y nunca es cero).
//
// POR QUÉ NO ALCANZA CON EL PROMPT. Ya se lo dice, y con todas las letras.
// Pero un porcentaje inventado es dinero, y el cliente se lo cree: esto no
// puede depender de que el modelo se acuerde. Es la misma idea que
// identificar.js en el bot de calzado — código puro revisando lo que la IA
// quiere mandar, antes de que salga.
//
// QUÉ NO HACE. No comprueba si el nivel que dijo el cliente es el suyo, ni
// hace cuentas, ni valida el texto que acompaña. Solo una cosa, la que
// cuesta dinero: que no salga por la puerta un porcentaje que no existe.

// Las iniciales que existen de verdad. Cashea: 60, 50, 30, 25, 20 (por
// nivel 1 a 6). Krece: 30, 25, 20, 15 (Azul, Plata, Oro, Platino).
const INICIALES_QUE_EXISTEN = new Set([60, 50, 30, 25, 20, 15]);

// Y los números de cuotas: 3 en Cashea, 6/8/10 en Krece. Van aparte
// porque "en 8 cuotas" no es un porcentaje y no hay que confundirlos.
const CUOTAS_QUE_EXISTEN = new Set([3, 6, 8, 10]);

// Solo se revisa si el mensaje habla de financiamiento. Un porcentaje en
// cualquier otra frase no es asunto de este archivo.
const HABLA_DE_CUOTAS = /\b(cashea|krece|inicial|cuotas?|abono|financi)/i;

// Cualquier número seguido de % o de "por ciento".
const PORCENTAJES = /(\d{1,3})\s*(?:%|por\s*ciento)/gi;

// Lo que se le dice al cliente cuando se atrapa un invento. No se intenta
// corregir el número —no sabemos cuál quería decir— y no se le miente: se
// le pasa a alguien que sí lo sabe.
const MEJOR_UN_ASESOR =
  "Para no darte un dato equivocado con las cuotas, deja que te lo " +
  "confirme un asesor en un momento 😊";

// Revisa lo que el modelo quiere mandar. Devuelve la respuesta tal cual
// si está bien, o una segura si se inventó un porcentaje.
export function revisarCuotas(respuesta) {
  const texto = String(respuesta || "");

  if (!HABLA_DE_CUOTAS.test(texto)) {
    return { respuesta: texto, corregido: false };
  }

  const inventados = [];
  for (const [entero, numero] of texto.matchAll(PORCENTAJES)) {
    const valor = Number(numero);

    // El 0% es el caso que motivó todo esto. Ni siquiera como "0% de
    // interés": el prompt pide decirlo con palabras ("sin intereses")
    // justo para que un "0%" suelto no pueda leerse como la inicial.
    if (valor === 0) {
      inventados.push(entero.trim());
      continue;
    }

    if (!INICIALES_QUE_EXISTEN.has(valor)) inventados.push(entero.trim());
  }

  if (!inventados.length) return { respuesta: texto, corregido: false };

  console.error(
    `CUOTAS: el modelo iba a mandar ${inventados.join(", ")}, que no existe. ` +
      `Las iniciales son ${[...INICIALES_QUE_EXISTEN].sort((a, b) => b - a).join("%, ")}%. ` +
      "Lo cambio por pasar a un asesor."
  );

  return { respuesta: MEJOR_UN_ASESOR, corregido: true, inventados };
}

// Para /estado y para quien quiera leerlo desde fuera.
export function inicialesValidas() {
  return [...INICIALES_QUE_EXISTEN].sort((a, b) => b - a);
}

export function cuotasValidas() {
  return [...CUOTAS_QUE_EXISTEN].sort((a, b) => a - b);
}
