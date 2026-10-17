# WhatsApp en EPICCELL: cómo conectarlo

**Desde la v54 (7 de octubre de 2026)** el mismo bot que atiende Instagram también contesta por WhatsApp. Todo lo que ya hace funciona igual: la memoria, Cashea, las fichas, la ficha técnica, el revisor y el panel.

**Hasta que no hagas los pasos de abajo, no cambia nada.** Con `WA_PHONE_ID` vacío el bot sigue solo en Instagram.

---

## Qué ve el cliente por WhatsApp

| Situación | Instagram | WhatsApp |
|---|---|---|
| Equipos | carrusel de fichas | una foto por equipo, con el **nombre en negrita** y el precio debajo (hasta 10) |
| Botones de enlace (Maps, ficha técnica) | botón | botón "cta_url" (se abre al tocarlo) |
| "¿Quieres ver las imágenes?" | botones rápidos | botones (hasta 3) o una lista (hasta 10) |
| Mientras la IA piensa | — | los dos ✓ azules y "escribiendo…" |
| Notas de voz | se transcriben | se transcriben igual |
| Fotos del cliente | la IA las mira | la IA las mira igual: se bajan con el token, porque WhatsApp no da un enlace público |
| Anuncios "Clic a WhatsApp" | — | el bot sabe de qué anuncio viene, igual que en Instagram |

**La IA sabe que el cliente está en WhatsApp:** no le pide "escríbenos por WhatsApp" ni que toque "Comprar".

---

## El mismo número que usan hoy los asesores ("coexistencia")

Meta deja que **la app de WhatsApp Business del celular y la API compartan el mismo número**.
- **Los asesores siguen contestando desde el celular, como siempre.**
- **Cuando un asesor escribe desde la app, el bot se calla con ese cliente.** Es la misma pausa que en Instagram: Meta avisa de esos mensajes con el evento `smb_message_echoes`.
- **Para devolverle la conversación al bot**, el asesor escribe la frase de siempre (`FRASE_DESPAUSAR`), o se devuelve desde el panel.

**Importante: este alta no la puedes hacer tú solo.** Para conectar un número que ya está en la app de WhatsApp Business, Meta exige su flujo de alta ("Embedded Signup"), que se hace **a través de un proveedor oficial de WhatsApp (BSP / Tech Provider)**. El código habla **directo con la API de Meta** (graph.facebook.com), así que el proveedor que elijas debe dejar usar la API de Meta directa: el token de Meta y el webhook propio.
- **Si el proveedor obliga a usar su propia API**, como 360dialog con su `D360-API-KEY`, hay que adaptar `whatsapp.js`. Dímelo y lo adapto.

---

## Pasos

### 1. En Meta (una vez)
1. Da de alta el número de la tienda en la WhatsApp Business Platform eligiendo **"conectar mi app de WhatsApp Business existente"** (coexistencia). Lo hace el proveedor o el flujo de alta de Meta.
2. En **developers.facebook.com → tu app → WhatsApp → Configuración de la API** copia el **"Identificador del número de teléfono"** (Phone number ID). Es un número largo; **no es el teléfono**.
3. En **business.facebook.com → Configuración → Usuarios del sistema**:
   - crea (o usa) un usuario del sistema con permisos `whatsapp_business_messaging` y `whatsapp_business_management`;
   - genera un **token permanente**;
   - **ese token es secreto: no lo pegues en ningún chat ni archivo.**
4. En **tu app → WhatsApp → Configuración → Webhook**:
   - URL de devolución: `https://bot-telefonos.<tu-subdominio>.workers.dev/webhook` (la misma de Instagram);
   - token de verificación: el mismo `META_VERIFY_TOKEN` de `wrangler.toml`;
   - suscribe los campos **`messages`** y **`smb_message_echoes`**. Sin el segundo, el bot no se entera de que el asesor escribió y le habla encima.

### 2. En la carpeta de EPICCELL
1. En `wrangler.toml` pon el id del número:
   ```toml
   WA_PHONE_ID = "123456789012345"
   ```
2. Carga el token **desde la terminal, dentro de la carpeta de EPICCELL**:
   ```
   npx.cmd wrangler secret put WA_TOKEN
   ```
3. **Solo si la app de Meta de WhatsApp es otra que la de Instagram**, carga también su clave secreta (Configuración → Básica → Clave secreta de la app):
   ```
   npx.cmd wrangler secret put WA_APP_SECRET
   ```
4. Despliega:
   ```
   npx.cmd wrangler deploy
   ```

### 3. Comprobar
- Abre `https://bot-telefonos.<tu-subdominio>.workers.dev/estado?clave=<PANEL_API_CLAVE>`. Debe decir:
  - `WHATSAPP (bot)  conectado (número …)`
  - `WA_TOKEN  cargado`
- Escríbele al número desde otro teléfono: "hola, tienes el A57?". Deben llegar los ✓ azules, "escribiendo…", la respuesta y la foto del A57.
- Desde la app del celular, contesta tú a ese chat. El bot tiene que callarse con ese cliente; en el panel sale "en pausa".
- En el panel, los clientes de WhatsApp salen con 📱 y su número. Lo que escribas desde el panel les llega por WhatsApp.

---

## Reglas de WhatsApp que conviene saber
- **Ventana de 24 horas.** Igual que en Instagram, al cliente solo se le puede escribir dentro de las 24 h desde su último mensaje. Pasado ese tiempo, Meta exige plantillas aprobadas; el bot no las manda.
- **Costo.** Contestar dentro de esas 24 h a un cliente que escribió **no tiene costo de Meta**. Lo que sí cuesta es la IA (OpenAI), igual que en Instagram.
- **Si algo no sale**, `wrangler tail` lo dice en una línea: "WhatsApp rechazó el envío: …" o "la ventana de 24 h está cerrada".
