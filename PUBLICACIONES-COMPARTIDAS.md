# Lo que hay que agregar a los prompts

Los archivos de `src/` son iguales para todas las tiendas y se pegan tal
cual. **Los dos prompts no**, si la tienda tiene los suyos adaptados —los de
este repo hablan de calzado, y pegarlos encima de unos prompts de teléfonos
borraría meses de ajustes.

Así que si `texto.txt` y `vision.txt` de tu carpeta **no** son los de este
repo, no los pises: abre los tuyos y pega estos dos bloques dentro. Es lo
único que les falta para que el bot entienda una publicación compartida.

Si tus prompts **sí** son los de este repo, no hagas nada de esto: los
archivos que te mandé ya los traen.

---

## 1. En `src/prompts/texto.txt`

Pégalo **justo antes** de la sección `RESPUESTAS A HISTORIAS`. Si tu prompt
no tiene esa sección, va al final, antes del repaso final.

```
PUBLICACIONES COMPARTIDAS DEL FEED

Un cliente ve una publicación en el feed, le da a compartir y te la manda
por el chat. O copia el enlace y lo pega. Es la misma persona que responde
una historia: ya vio el producto y ya lo quiere. Se atiende igual de bien.

Lo reconoces porque te llega esta línea:

  [EL CLIENTE COMPARTIÓ UNA PUBLICACIÓN DE NUESTRO PROPIO FEED]

Debajo puede venir el texto de la publicación y, cuando el enlace era la
ficha de un producto, su nombre exacto:

  [Texto de la publicación: ...]
  [La publicación es la ficha de este producto: "..."]

SI TE DAN EL NOMBRE DEL PRODUCTO, ESE ES EL BUENO. No lo corrijas, no lo
completes y no lo cambies por otro que te suene mejor: sale de la tienda.

SI NO, MIRA EL TEXTO DE LA PUBLICACIÓN Y EL MENSAJE DEL CLIENTE. Casi
siempre uno de los dos nombra el producto. Búscalo con el término más
corto que lo identifique.

LO QUE NUNCA HACES CON UNA PUBLICACIÓN COMPARTIDA:

  NUNCA preguntes "¿qué estás buscando?". Acaba de señalártelo con el
  dedo. Es la peor respuesta posible y la que hace que el cliente se vaya.
  NUNCA digas que no puedes abrir la publicación, que no te cargó, ni que
  hubo un error.
  NUNCA le pidas una foto de lo que ya te mandó.
  NUNCA lo mandes al catálogo: está preguntando por algo concreto.

SOLO SI DE VERDAD NO HAY NINGÚN NOMBRE —ni en la publicación ni en su
mensaje— pregúntale UNA cosa, en corto:

  "¡Claro que sí! 😊 Dime cuál de los que salen ahí te interesa y te paso
   el precio"

Anótalo en el historial: "Preguntó por X desde una publicación."
```

---

## 2. En `src/prompts/vision.txt`

Pégalo **justo antes** de la sección `CÓMO ESCRIBIR "buscar"`. Si no la
tienes, va después de lo que diga tu prompt sobre las historias.

Los dos ejemplos de abajo son a propósito uno de teléfono y uno de calzado:
lo que enseñan no es el producto, es que **el nombre está escrito en la
imagen** y hay que leerlo.

```
SI TE LLEGA ESTA LÍNEA: UNA PUBLICACIÓN COMPARTIDA

  [EL CLIENTE COMPARTIÓ UNA PUBLICACIÓN DE NUESTRO PROPIO FEED — la imagen
   que ves ES esa publicación]

El cliente vio un post o un reel en el feed, le dio a compartir y te lo
mandó. Igual que con las historias: esa imagen NO la tomó él, la publicó la
tienda, y él ya sabe cuál quiere. Identificar bien aquí vale doble.

LA DIFERENCIA CON UNA FOTO NORMAL: estas imágenes son montajes de
publicidad, y casi siempre traen EL NOMBRE DEL PRODUCTO ESCRITO ENCIMA, con
su marca y a veces su capacidad o su versión. LÉELO Y ÚSALO. Ahí no estás
adivinando nada: es el nombre que la propia tienda le puso.

  Un montaje con "SAMSUNG A57 5G" escrito  →  buscar: "Samsung A57"
  Un montaje con "NIKE AIR MAX 270" escrito →  buscar: "Air Max 270"

Sigue poniendo "rasgos" con honestidad, como siempre: describe lo que se ve
en la imagen. Pero cuando el nombre está escrito, ese nombre manda sobre lo
que te parezca la foto.

Si además te llega esta línea, ese nombre es todavía mejor —sale de la
ficha de la tienda, no de la imagen— y va tal cual en "buscar":

  [La publicación es la ficha de este producto: "..."]

Y si en la imagen no hay ningún nombre escrito ni se distingue el producto,
pregúntale con naturalidad cuál le interesa. NUNCA le preguntes "¿qué
buscas?" —acaba de señalártelo— ni le pidas una foto, ni le digas que no
pudiste ver la publicación.

Anótalo en el historial: "Identificó X desde una publicación compartida."
```

---

## Cómo saber si quedó bien

Con el Worker desplegado, comparte una publicación del feed a la cuenta
desde otro Instagram y escribe "precio?". Tiene que contestar **una sola
vez**, con el producto de esa publicación y su precio.

Si contesta con la bienvenida ("¿qué estás buscando?"), el prompt no tiene
el bloque o los archivos de `src/` no se copiaron. Con `npx wrangler tail`
lo ves en una línea: tiene que salir `Publicación compartida por ...`.
