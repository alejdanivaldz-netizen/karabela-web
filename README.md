# karabela-web

Tienda en línea de KarA-BelA Cosmétics (Pilar, Paraguay). Catálogo con carrito de
compras; los pedidos se confirman por WhatsApp. Desde la fase 2 el catálogo se
administra desde un panel propio (`/admin/`) sobre Firebase.

## Estructura

- `index.html` — sitio público (catálogo, buscador, filtros, carrito y checkout). Lee el catálogo publicado desde Firestore; si no puede, usa `catalogo.json`.
- `admin/` — panel de administración (login, productos, fotos, importación del export, pedidos, categorías, datos de la tienda).
  - `admin/index.html` — pantalla; `admin/app.js` — Firebase y UI; `admin/logica.js` — lógica pura (columnas del export, comparación, snapshot).
- `config.js` — configuración de Firebase (se completa una vez con los datos del proyecto).
- `catalogo.json` — catálogo de respaldo (el de la fase 1). Lo usa la web si Firebase no responde y el panel para la «carga inicial».
- `img/` — fotos de los destacados de la fase 1 (se suben a Storage con la carga inicial).
- `logo.png`, `favicon.png`, `apple-touch-icon.png`, `robots.txt`.
- `firestore.rules`, `storage.rules` — reglas de seguridad para pegar en la consola de Firebase.
- `GUIA_F2.md` — guía paso a paso de la puesta en marcha.

## Publicación (Cloudflare Pages)

Proyecto conectado a este repo (rama `main`), framework **None**, sin build, output `/`.
Cada commit se publica solo en 1–2 minutos. Sin variables de entorno.

## Cómo funciona por dentro

- Firestore: `productos/{id}` (uno por producto), `config/tienda`, `config/categorias`,
  `pedidos/{id}` y `publico/catalogo` (+ `publico/catalogo_N` si hay más de 700 productos).
- Cada guardado en el panel regenera `publico/catalogo`, un documento liviano con solo lo
  que se muestra. La web lo lee con **una** lectura por visita (API REST, sin SDK) y lo
  guarda en `localStorage` para pintar al instante la próxima vez.
- Fotos en Storage: `productos/{id}.jpg`, achicadas y comprimidas en el navegador antes de subir.
- Pedidos: al enviar por WhatsApp, la web crea un documento en `pedidos` (las reglas solo
  permiten crear con forma válida); el panel los lista y permite cambiar el estado.
- Importación: se leen .xls/.xlsx/.csv con SheetJS en el navegador, se detectan las columnas
  (código, nombre, categoría, precio, cantidad — el costo nunca se usa), se compara con lo
  cargado y recién después de ver el resumen se aplica en lotes.

## Roadmap

- F1: sitio + carrito → pedido por WhatsApp ✅
- F2: panel admin (stock + fotos por producto + importación + pedidos + datos de la tienda) ✅ (este commit)
- F3: pago con tarjeta vía Pagopar (requiere alta de comercio)

## Cambios del 08/10/2026

- Diseño nuevo de la web pública (marfil / vino / dorado, DM Serif Display + Jost), `og.jpg` para la vista previa al compartir.
- Pedido: casilla de ofertas y cumpleaños (día y mes), con aviso de uso de datos.
- Panel: pestañas **Clientas** (se derivan de `pedidos` + fichas en `clientes/{clave}`) y **Novedades** (`config/novedades`, se publican dentro de `publico/catalogo`).
- `firestore.rules`: colección `clientes` solo para el panel; `pedidos.cliente` valida `acepta` y `cumple`.
