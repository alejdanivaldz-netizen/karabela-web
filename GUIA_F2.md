# Karabela — Fase 2: puesta en marcha del panel

*Versión del 08/10/2026: incluye el diseño nuevo de la web, la pestaña **Clientas** (historial y cumpleaños) y la pestaña **Novedades** (cursos, tips, lanzamientos).*

Tiempo estimado: 30–40 minutos, todo desde el navegador. No hace falta instalar nada.

Orden: **1) Firebase → 2) pasarle a Claude los seis valores → 3) carga inicial → 4) probar**.

Los archivos ya están subidos al repo `karabela-web`, en una rama de prueba llamada `f2`. Mientras Firebase no esté configurado, la web funciona igual que hoy (con el catálogo de respaldo).

---

## 1. Crear el proyecto de Firebase

1. Entrá a https://console.firebase.google.com con la cuenta de Google que quieras usar como dueña del proyecto.
2. **Agregar proyecto** → nombre `karabela` → Google Analytics: **desactivar** → Crear.
3. **Plan de facturación (necesario para Storage):** rueda ⚙ → *Uso y facturación* → *Detalles y configuración* → **Modificar plan** → **Blaze (pago por uso)** → vinculá la **misma cuenta de facturación que ya usás para AVALDZ**.
   - Con el volumen de la tienda queda dentro de la franja sin costo (Firestore: 50.000 lecturas y 20.000 escrituras por día; Storage: 5 GB guardados en una región de EE. UU.; Auth: sin costo). Si querés dormir tranquilo, en Google Cloud → *Facturación* → *Presupuestos y alertas* creá un presupuesto de USD 1 con aviso por correo.

## 2. Authentication (usuarios del panel)

1. Menú **Compilación → Authentication → Comenzar**.
2. Pestaña **Método de acceso** → **Correo electrónico/contraseña** → Habilitar → Guardar.
3. Pestaña **Configuración** (Settings) → **Acciones de usuario** → **destildar «Habilitar creación (registro)»** → Guardar. Así nadie puede registrarse solo: los usuarios los creás vos.
4. Pestaña **Configuración → Dominios autorizados** → Agregar `karabela-web.pages.dev` (y el dominio propio cuando lo tengan).
5. Pestaña **Usuarios → Agregar usuario**: el correo de ella + una contraseña, y otro para vos. (Desde el panel se puede pedir «¿Olvidaste tu contraseña?» y llega un correo para cambiarla.)

## 3. Firestore (la base de datos)

1. **Compilación → Firestore Database → Crear base de datos**.
2. Ubicación: **nam5 (United States)** o `us-east1`. Modo: **producción**. Crear.
3. Pestaña **Reglas** → borrá todo → pegá el contenido completo del archivo **`firestore.rules`** → **Publicar**.

## 4. Storage (las fotos)

1. **Compilación → Storage → Comenzar**.
2. Ubicación: **`us-east1`** (una de las tres regiones con franja gratuita: us-east1, us-central1, us-west1). Modo: **producción**. Listo.
3. Pestaña **Reglas** → borrá todo → pegá el contenido de **`storage.rules`** → **Publicar**.

## 5. Registrar la app web y pasar los seis valores

1. En **Descripción general del proyecto** → botón **`</>`** (Web) → apodo `karabela-web` → **sin** Firebase Hosting → Registrar app.
2. Aparece un bloque `const firebaseConfig = { apiKey: "...", authDomain: "...", ... }`. Copiá esos seis valores.
3. **Pegale a Claude ese bloque en el chat** (o sacale una foto con el celular). Claude completa `config.js` y lo publica. Queda así (con tus datos):

```js
window.KB_FIREBASE = {
  apiKey: "AIza...",
  authDomain: "karabela-xxxxx.firebaseapp.com",
  projectId: "karabela-xxxxx",
  storageBucket: "karabela-xxxxx.firebasestorage.app",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef"
};
```

Estos valores son públicos por diseño (viajan al navegador de cualquier visitante); lo que protege los datos son las reglas que pegaste.

## 6. Publicación

No hay que subir nada a mano. Cuando Claude tenga los seis valores:

1. Completa `config.js` en la rama de prueba `f2` y te pasa el link de prueba para que entres al panel y mires todo tranquilo.
2. Cuando des el visto bueno, pasa todo a la versión pública (`main`) y Cloudflare lo publica en 1–2 minutos.

Las reglas (`firestore.rules` y `storage.rules`) están en el repo: copiá el contenido desde ahí cuando hagas los pasos 3 y 4. **Si ya habías pegado las reglas de la versión del 15/09, volvé a pegar `firestore.rules`**: la nueva agrega las fichas de clientas.

## 7. Carga inicial (una sola vez)

1. Entrá a **https://karabela-web.pages.dev/admin/** e iniciá sesión.
2. Como todavía no hay productos, aparece el botón **«Cargar el catálogo inicial (fase 1)»**. Tocalo: sube los 764 productos que ya estaban en la web y las 11 fotos de los destacados. Tarda menos de un minuto.
3. Arriba a la derecha tiene que decir **● Publicado hh:mm**. Abrí la web pública y comprobá que se ve igual que antes (los mismos kits arriba, el catálogo abajo).

Mientras la web no encuentre nada publicado (o `config.js` esté vacío), muestra el catálogo de respaldo (`catalogo.json`, el de la fase 1). O sea: **la web nunca queda en blanco**, ni durante la puesta en marcha.

## 8. Uso diario (esto es lo que usa ella)

- **Productos**: buscar, filtrar, y con ✎ editar cada uno: nombre para la web, precio, stock, sección, descripción, foto, visible, destacado. El interruptor «En la web» y la ★ se cambian directo en la lista. Cada cambio se publica solo (mirá el indicador «Publicado»).
- **Fotos**: en el producto → **Subir foto** (desde el celular también sirve sacar la foto en el momento). Se achica y comprime antes de subir; ideal vertical (4:5), fondo claro.
- **Importar**: exportá desde el sistema de inventario (.xls/.xlsx/.csv, pueden ser varios archivos a la vez), arrastralos y revisá el resumen: **Nuevos / Cambian / Sin cambios / No vienen en el archivo**. Recién con **Aplicar** se guarda. El costo nunca se sube. Lo que ella editó para la web (foto, nombre lindo, descripción, visible, destacado, sección fijada a mano) **no se pisa**.
  - La casilla «Poner stock 0 a los que no vienen en el archivo» solo hay que marcarla cuando el export es del inventario **completo**.
- **Pedidos**: cada pedido enviado por WhatsApp desde la web queda registrado con fecha, cliente, ítems y total. Se le cambia el estado (nuevo → confirmado → entregado / cancelado).
- **Clientas**: se arma sola con los pedidos de la web (la misma clienta se reconoce por su teléfono, aunque lo escriba distinto). De cada una ves cuántos pedidos hizo, cuánto compró, qué es lo que más pide y su historial. Con **Editar ficha** le cargás el cumpleaños, una nota («tono 02, prefiere Ruby Rose») o corregís el nombre. Con **+ Agregar clienta** cargás a mano a las del mostrador.
  - **Cumpleaños**: arriba aparecen las que cumplen en los próximos 15 días. **Saludar por WhatsApp** abre el chat con el mensaje ya escrito; ella lo revisa y lo manda. El texto se cambia en «Cambiar el mensaje de saludo» (ahí va el regalo o el descuento).
  - **Ofertas**: en el pedido de la web hay una casilla «Quiero recibir ofertas y un regalo en mi cumpleaños». Solo a las que la marcaron les aparece «Quiere ofertas» y el botón de saludo. A las demás, escribirles solo por sus pedidos.
  - **Borrar sus datos**: si una clienta lo pide, en su ficha está el botón. Se elimina la ficha y sus pedidos quedan sin nombre ni teléfono (los montos se conservan para tus números).
  - Límite: solo cuenta lo que se pide por la web. Las ventas del mostrador siguen en el sistema de inventario.
- **Novedades**: cursos, tips, lanzamientos, sorteos. **+ Nueva novedad** → tipo, fecha, título, texto, foto opcional y, si querés, un botón («Quiero anotarme») que le abre WhatsApp a la clienta con la consulta ya escrita. El interruptor la muestra u oculta; con ↑ ↓ elegís cuál va primero. Si no hay ninguna visible, la sección desaparece sola de la web.
- **Categorías**: cómo se traducen las categorías del sistema (GENERAL, LABIOS, UÑAS, CAPILAR…) a las secciones de la web. El panel propone una traducción sola; se ajusta y se guarda una vez.
- **Tienda**: WhatsApp de pedidos, dirección, horario, costos de delivery, marcas, links.

## 9. Si algo falla

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| El panel dice «Falta configurar Firebase» | `config.js` vacío o mal pegado | Revisar las seis claves; tienen que estar entre comillas y con coma al final de cada línea menos la última. |
| «Correo o contraseña incorrectos» | Usuario no creado / contraseña | Authentication → Usuarios. O «¿Olvidaste tu contraseña?». |
| «No se pudieron leer los productos: Missing or insufficient permissions» | Reglas de Firestore sin publicar | Paso 3.3. |
| Las fotos no se suben o no se ven | Reglas de Storage sin publicar / Storage sin activar | Paso 4. |
| Indicador «⚠ No se pudo publicar» | Reglas o conexión | Tocá el indicador para reintentar; si sigue, revisar reglas. |
| La web muestra el catálogo viejo | Aún no se publicó nada, o caché del navegador | Esperar 1 min y recargar. La web trae lo publicado en cada visita. |
| «No se pudieron leer las clientas: Missing or insufficient permissions» | Quedaron publicadas las reglas viejas de Firestore | Volver a pegar `firestore.rules` (paso 3.3) y Publicar. |
| El export no reconoce las columnas | Encabezados distintos | En «Importar», cada archivo tiene un desplegable para elegir a mano qué columna es código, nombre, precio y cantidad. |

## 10. Qué cuesta

Con este esquema, un mes normal de la tienda entra completo en la franja gratuita de Firebase y de Cloudflare Pages. Lo único que podría generar centavos es un uso muy por encima (decenas de miles de visitas por día). El presupuesto de USD 1 con alerta (paso 1) avisa antes de que pase nada.
