# karabela-web

Tienda en línea de KarA-BelA Cosmétics (Pilar, Paraguay). Catálogo con carrito de
compras; los pedidos se confirman por WhatsApp (0975 158 244).

## Estructura

- `index.html` — sitio completo (catálogo de 763 productos, buscador, filtros, carrito y checkout; imágenes embebidas)
- `favicon.png`, `apple-touch-icon.png` — ícono con la mariposa del logo
- `robots.txt`

## Publicación (Cloudflare Pages)

1. Crear el proyecto en Cloudflare Pages conectado a este repo (rama `main`).
   - Framework preset: **None** · Build command: *(vacío)* · Output directory: `/`
2. Sin variables de entorno (el sitio es 100% estático).
3. Dominio propio: pendiente — por ahora se usa `karabela-web.pages.dev`.

## Actualización del catálogo

El catálogo sale del export del sistema de inventario de la tienda (products_*.xls).
Proceso actual: re-exportar → pasar los archivos a Claude → se regenera `index.html`
(solo productos con stock > 0, sin costos, sin filas internas).

Fase 2 (previsto): panel de administración donde la dueña edita stock e imágenes
de cada producto e importa el CSV directamente.

## Roadmap

- F2: panel admin (stock + imágenes por producto + importación CSV)
- F3: pago con tarjeta vía Pagopar (requiere alta de comercio)
