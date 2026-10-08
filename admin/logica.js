/* ============================================================
   KarA-BelA — lógica pura del panel (sin Firebase, sin DOM)
   Se usa en el navegador (window.KB) y en Node (module.exports)
   para poder probarla sin conexión.
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KB = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- Categorías de la web (fijas) ---------- */
  const CATEGORIAS_WEB = [
    { i: 'maquillaje', n: 'Maquillaje', e: '💄' },
    { i: 'skincare',   n: 'Skincare',   e: '🧴' },
    { i: 'corporal',   n: 'Corporal',   e: '🫧' },
    { i: 'cabello',    n: 'Cabello',    e: '💆‍♀️' },
    { i: 'unas',       n: 'Uñas',       e: '💅' },
    { i: 'accesorios', n: 'Accesorios', e: '👛' },
    { i: 'kits',       n: 'Kits y combos', e: '🎁' }
  ];
  const CAT_IDS = CATEGORIAS_WEB.map(c => c.i);

  /* ---------- Utilidades de texto ---------- */
  function normalizar(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }
  function hash6(s) {
    let h = 5381;
    const t = normalizar(s);
    for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36).slice(0, 6);
  }
  function limpiarCodigo(c) {
    // Un ID de documento de Firestore no puede tener "/" ni ser "." o ".."
    let s = String(c == null ? '' : c).trim().replace(/\s+/g, ' ').replace(/\//g, '-');
    if (s === '.' || s === '..') s = '_' + s;
    return s;
  }

  /* ---------- Números que vienen del export ---------- */
  function parsearNumero(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = String(v).trim().replace(/gs\.?|₲|\$/gi, '').replace(/\s/g, '');
    if (!s) return null;
    // "48.000" / "48.000,50" (formato local) vs "48000.50" (formato inglés)
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
    else s = s.replace(/,/g, '');
    const n = Number(s);
    return isFinite(n) ? n : null;
  }
  function entero(v) {
    const n = parsearNumero(v);
    return n == null ? null : Math.round(n);
  }

  /* ---------- Categoría web a partir de la categoría real ---------- */
  const PISTAS = [
    ['unas',       [/u[ñn]a/, /esmalte/, /manicur/, /pedicur/, /acrilic/, /gel\b/]],
    ['cabello',    [/capilar/, /cabell/, /pelo/, /shampoo/, /champu/, /acondicion/, /peinad/, /tintur/]],
    ['skincare',   [/skin/, /facial/, /rostro/, /piel/, /serum/, /crema/, /mascarilla/, /limpiador/, /tonic/]],
    ['corporal',   [/corporal/, /cuerpo/, /perfum/, /fragancia/, /desodor/, /jabon/, /exfolian/, /body/]],
    ['maquillaje', [/maquill/, /labio/, /ojo/, /pesta/, /ceja/, /rubor/, /base/, /polvo/, /sombra/, /delinead/, /corrector/, /iluminad/, /contorno/, /make/]],
    ['kits',       [/kit/, /combo/, /box/, /set\b/, /regalo/]],
    ['accesorios', [/accesor/, /general/, /bijou/, /cartera/, /billet/, /brocha/, /esponja/, /organizador/, /vaso/]]
  ];
  function catWebPorPistas(texto) {
    const t = normalizar(texto);
    for (const [cat, res] of PISTAS) if (res.some(r => r.test(t))) return cat;
    return null;
  }
  // mapa: { [categoriaRealNormalizada]: catWebId }
  function catWebDesde(categoriaReal, mapa) {
    const k = normalizar(categoriaReal);
    if (mapa && mapa[k] && CAT_IDS.includes(mapa[k])) return mapa[k];
    return catWebPorPistas(k) || 'accesorios';
  }

  /* ---------- Detección de columnas del export ---------- */
  const SINONIMOS = {
    codigo:    ['codigo', 'cod', 'cod.', 'code', 'sku', 'id', 'codigo de barras', 'barra', 'barcode', 'referencia', 'ref'],
    nombre:    ['nombre', 'descripcion', 'producto', 'articulo', 'detalle', 'item', 'name', 'description'],
    categoria: ['categoria', 'rubro', 'familia', 'grupo', 'linea', 'category', 'tipo'],
    precio:    ['precio', 'precio venta', 'precio de venta', 'pventa', 'p. venta', 'venta', 'price', 'pvp', 'precio unitario', 'precio minorista', 'minorista'],
    stock:     ['cantidad', 'stock', 'existencia', 'existencias', 'disponible', 'cant', 'cant.', 'qty', 'quantity', 'saldo', 'inventario'],
    costo:     ['costo', 'cost', 'precio costo', 'precio de costo', 'pcosto', 'compra', 'precio compra']
  };
  function detectarColumnas(encabezados) {
    const h = encabezados.map(normalizar);
    const res = {};
    for (const campo of Object.keys(SINONIMOS)) {
      let idx = -1;
      // 1) coincidencia exacta con algún sinónimo
      for (const s of SINONIMOS[campo]) { const i = h.indexOf(s); if (i >= 0 && !Object.values(res).includes(i)) { idx = i; break; } }
      // 2) el encabezado contiene el sinónimo (p. ej. "precio de venta (gs)")
      if (idx < 0) for (const s of SINONIMOS[campo]) {
        const i = h.findIndex((x, j) => x.includes(s) && !Object.values(res).includes(j));
        if (i >= 0) { idx = i; break; }
      }
      res[campo] = idx;
    }
    // "precio" nunca debe caer en la columna de costo
    if (res.precio >= 0 && res.precio === res.costo) res.precio = -1;
    return res;
  }
  function columnasValidas(cols) {
    return cols.codigo >= 0 && cols.nombre >= 0 && (cols.precio >= 0 || cols.stock >= 0);
  }
  // Busca la fila de encabezados entre las primeras 15 filas
  function encontrarEncabezado(filas) {
    const tope = Math.min(filas.length, 15);
    for (let i = 0; i < tope; i++) {
      const cols = detectarColumnas(filas[i] || []);
      if (columnasValidas(cols)) return { fila: i, cols };
    }
    return null;
  }

  /* ---------- Filas → productos entrantes ---------- */
  function filasAProductos(filas, cols) {
    const out = [];
    for (const f of filas) {
      if (!f || !f.length) continue;
      const codigo = limpiarCodigo(cols.codigo >= 0 ? f[cols.codigo] : '');
      const nombre = String(cols.nombre >= 0 ? (f[cols.nombre] == null ? '' : f[cols.nombre]) : '').replace(/\s+/g, ' ').trim();
      if (!codigo || !nombre) continue;
      if (/^total/i.test(codigo) || /^total/i.test(nombre)) continue;
      const categoria = cols.categoria >= 0 ? String(f[cols.categoria] == null ? '' : f[cols.categoria]).trim() : '';
      const precio = cols.precio >= 0 ? entero(f[cols.precio]) : null;
      const stock = cols.stock >= 0 ? entero(f[cols.stock]) : null;
      out.push({ codigo, nombre, categoria, precio, stock });
    }
    return out;
  }

  /* ---------- IDs estables y códigos repetidos ---------- */
  // Mismo código + mismo nombre → un solo producto (se toma el mayor stock).
  // Mismo código + distinto nombre → cada uno con id "codigo~hash(nombre)".
  function asignarIds(entrantes) {
    const porCodigo = new Map();
    for (const e of entrantes) {
      if (!porCodigo.has(e.codigo)) porCodigo.set(e.codigo, []);
      porCodigo.get(e.codigo).push(e);
    }
    const out = []; let repetidos = 0, variantes = 0;
    for (const [codigo, lista] of porCodigo) {
      const porNombre = new Map();
      for (const e of lista) {
        const k = normalizar(e.nombre);
        if (!porNombre.has(k)) porNombre.set(k, { ...e });
        else {
          repetidos++;
          const p = porNombre.get(k);
          if (e.stock != null) p.stock = p.stock == null ? e.stock : Math.max(p.stock, e.stock);
          if (p.precio == null && e.precio != null) p.precio = e.precio;
        }
      }
      if (porNombre.size === 1) { const p = porNombre.values().next().value; p.id = codigo; out.push(p); }
      else for (const p of porNombre.values()) { variantes++; p.id = codigo + '~' + hash6(p.nombre); out.push(p); }
    }
    return { productos: out, repetidos, variantes };
  }

  /* ---------- Comparación importación vs. lo que hay ---------- */
  // existentes: Map id → producto guardado. entrantes: [{id, codigo, nombre, categoria, precio, stock}]
  function diffImportacion(existentes, entrantes) {
    const r = { nuevos: [], cambian: [], iguales: [], noVienen: [] };
    const vistos = new Set();
    for (const e of entrantes) {
      vistos.add(e.id);
      const x = existentes.get(e.id);
      if (!x) { r.nuevos.push({ entrante: e }); continue; }
      const cambios = [];
      if (e.precio != null && e.precio !== (x.precio == null ? null : x.precio)) cambios.push({ campo: 'precio', antes: x.precio, despues: e.precio });
      if (e.stock != null && e.stock !== (x.stock == null ? null : x.stock)) cambios.push({ campo: 'stock', antes: x.stock, despues: e.stock });
      if (e.nombre && e.nombre !== x.nombre) cambios.push({ campo: 'nombre', antes: x.nombre, despues: e.nombre });
      if (e.categoria && normalizar(e.categoria) !== normalizar(x.categoria)) cambios.push({ campo: 'categoria', antes: x.categoria, despues: e.categoria });
      if (cambios.length) r.cambian.push({ entrante: e, existente: x, cambios });
      else r.iguales.push({ entrante: e, existente: x });
    }
    for (const x of existentes.values()) {
      if (x.origen !== 'manual' && !vistos.has(x.id)) r.noVienen.push(x);
    }
    return r;
  }

  // Campos a escribir para un entrante (respeta lo editado para la web)
  function camposDesdeEntrante(entrante, existente, mapa, ahora) {
    const base = {
      codigo: entrante.codigo,
      nombre: entrante.nombre,
      categoria: entrante.categoria || (existente ? existente.categoria : '') || '',
      origen: 'import',
      importadoEn: ahora,
      actualizadoEn: ahora
    };
    if (entrante.precio != null) base.precio = entrante.precio;
    else if (!existente) base.precio = null;
    if (entrante.stock != null) base.stock = entrante.stock;
    else if (!existente) base.stock = null;
    const catFija = existente && existente.catFija;
    if (!catFija) base.catWeb = catWebDesde(base.categoria || entrante.nombre, mapa);
    if (!existente) {
      Object.assign(base, { id: entrante.id, nombreWeb: '', visible: true, destacado: false, orden: 0, descripcion: '', imgV: null, catFija: false, creadoEn: ahora });
    }
    return base;
  }

  /* ---------- Qué se publica ---------- */
  function estadoWeb(p) {
    if (p.visible === false) return { ok: false, motivo: 'Oculto' };
    if (p.origen !== 'manual') {
      if (p.stock != null && p.stock <= 0) return { ok: false, motivo: 'Sin stock' };
      if (p.precio == null || p.precio <= 0) return { ok: false, motivo: 'Sin precio' };
    }
    return { ok: true, motivo: 'Publicado' };
  }
  function publicable(p) { return estadoWeb(p).ok; }

  /* ---------- Snapshot público ---------- */
  const TAM_PARTE = 700;
  function construirSnapshot(productos, tienda, generado) {
    const lista = productos.filter(publicable).map(p => {
      const o = { i: p.id, n: (p.nombreWeb || '').trim() || p.nombre, c: CAT_IDS.includes(p.catWeb) ? p.catWeb : 'accesorios', p: p.precio == null || p.precio <= 0 ? null : p.precio };
      if (p.imgV) o.f = p.imgV;
      if (p.destacado) { o.d = 1; o.o = p.orden || 0; }
      if (p.origen === 'manual') o.m = 1;
      if (p.descripcion && String(p.descripcion).trim()) o.s = String(p.descripcion).trim().slice(0, 300);
      return o;
    });
    // Destacados primero (por orden), después el resto por nombre
    lista.sort((a, b) => (b.d || 0) - (a.d || 0) || ((a.o || 0) - (b.o || 0)) || a.n.localeCompare(b.n, 'es'));
    const partes = [];
    for (let i = 0; i < lista.length; i += TAM_PARTE) partes.push(lista.slice(i, i + TAM_PARTE));
    if (!partes.length) partes.push([]);
    const principal = {
      generado: generado || new Date().toISOString(),
      partes: partes.length,
      total: lista.length,
      tienda: tienda || {},
      categorias: CATEGORIAS_WEB,
      productos: partes[0]
    };
    return { principal, resto: partes.slice(1).map(productos => ({ productos })) };
  }

  /* ---------- Clientas: se arman a partir de los pedidos + la ficha guardada ---------- */
  // Teléfono → solo dígitos con 595 adelante ("0975 158 244" y "+595 975158244" son la misma persona)
  function telClave(t) {
    let d = String(t == null ? '' : t).replace(/\D/g, '');
    if (!d) return '';
    if (d.startsWith('595')) return d;
    if (d.startsWith('0')) d = d.slice(1);
    return d.length >= 8 ? '595' + d : d;
  }
  // Clave estable de una clienta: por teléfono si lo dejó; si no, por nombre
  function claveCliente(c) {
    const t = telClave(c && c.telefono);
    if (t) return 't' + t;
    const n = normalizar(c && c.nombre).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    return n ? 'n-' + n : '';
  }
  function aFecha(f) {
    if (!f) return null;
    if (f instanceof Date) return f;
    if (typeof f.toDate === 'function') return f.toDate();
    const d = new Date(f);
    return isNaN(d) ? null : d;
  }
  const cumpleValido = (c) => typeof c === 'string' && /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(c);
  // pedidos: [{id, fecha, estado, cliente, items, total}] · fichas: Map clave → {nombre, telefono, cumple, acepta, nota}
  function derivarClientes(pedidos, fichas) {
    const m = new Map();
    const ordenados = (pedidos || []).slice().sort((a, b) => (aFecha(b.fecha) || 0) - (aFecha(a.fecha) || 0));
    for (const p of ordenados) {
      const c = p.cliente || {};
      if (c.borrado) continue;
      const clave = claveCliente(c);
      if (!clave) continue;
      if (!m.has(clave)) m.set(clave, { clave, nombre: (c.nombre || '').trim(), telefono: (c.telefono || '').trim(), cumple: '', acepta: null, nota: '', manual: false, pedidos: [] });
      const x = m.get(clave);
      // El pedido más nuevo manda; los más viejos solo completan lo que falte
      if (!x.nombre && c.nombre) x.nombre = c.nombre.trim();
      if (!x.telefono && c.telefono) x.telefono = c.telefono.trim();
      if (!x.cumple && cumpleValido(c.cumple)) x.cumple = c.cumple;
      if (x.acepta == null && typeof c.acepta === 'boolean') x.acepta = c.acepta;
      x.pedidos.push(p);
    }
    if (fichas) for (const [clave, f] of fichas) {
      if (!m.has(clave)) m.set(clave, { clave, nombre: '', telefono: '', cumple: '', acepta: null, nota: '', manual: true, pedidos: [] });
      const x = m.get(clave);
      // Lo que ella corrigió a mano en la ficha tiene prioridad
      if (f.nombre) x.nombre = f.nombre;
      if (f.telefono) x.telefono = f.telefono;
      if ('cumple' in f) x.cumple = cumpleValido(f.cumple) ? f.cumple : ''; // la ficha manda: si ella lo borró, queda vacío
      if (typeof f.acepta === 'boolean') x.acepta = f.acepta;
      if (f.nota) x.nota = f.nota;
      x.ficha = true;
    }
    const out = [];
    for (const x of m.values()) {
      const validos = x.pedidos.filter(p => (p.estado || 'nuevo') !== 'cancelado');
      x.acepta = x.acepta === true;
      x.nPedidos = validos.length;
      x.total = validos.reduce((s, p) => s + (Number(p.total) || 0), 0);
      x.ultimo = x.pedidos.length ? aFecha(x.pedidos[0].fecha) : null;
      const prod = new Map();
      for (const p of validos) for (const it of (p.items || [])) {
        const k = it.id || it.nombre;
        if (!prod.has(k)) prod.set(k, { nombre: it.nombre, cant: 0 });
        prod.get(k).cant += Number(it.cant) || 0;
      }
      x.productos = Array.from(prod.values()).sort((a, b) => b.cant - a.cant || a.nombre.localeCompare(b.nombre, 'es'));
      out.push(x);
    }
    out.sort((a, b) => (b.ultimo || 0) - (a.ultimo || 0) || a.nombre.localeCompare(b.nombre, 'es'));
    return out;
  }
  // Cuántos días faltan para el próximo cumpleaños ("MM-DD"); 0 = hoy
  function diasParaCumple(cumple, hoy) {
    if (!cumpleValido(cumple)) return null;
    const [mm, dd] = cumple.split('-').map(Number);
    const base = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    for (let anho = base.getFullYear(); anho <= base.getFullYear() + 1; anho++) {
      let f = new Date(anho, mm - 1, dd);
      if (f.getMonth() !== mm - 1) f = new Date(anho, 1, 28); // 29 de febrero en un año común
      const dif = Math.round((f - base) / 86400000);
      if (dif >= 0) return dif;
    }
    return null;
  }
  function proximosCumples(clientes, hoy, dias) {
    return (clientes || []).map(c => ({ c, en: diasParaCumple(c.cumple, hoy) }))
      .filter(x => x.en != null && x.en <= dias)
      .sort((a, b) => a.en - b.en || a.c.nombre.localeCompare(b.c.nombre, 'es'));
  }
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function cumpleTexto(c) { if (!cumpleValido(c)) return ''; const [mm, dd] = c.split('-').map(Number); return dd + ' de ' + MESES[mm - 1]; }
  const MSG_CUMPLE = '¡Feliz cumple, {nombre}! 🎂 En KarA-BelA te esperamos con un regalo por tu día. Escribinos o pasá por la tienda 💖';
  function mensajeCumple(plantilla, cliente) {
    const nombre = String((cliente && cliente.nombre) || '').trim().split(/\s+/)[0] || '';
    return String(plantilla || MSG_CUMPLE).replace(/\{nombre\}/g, nombre).replace(/ ,/g, ',').replace(/\s{2,}/g, ' ').trim();
  }

  /* ---------- Novedades que se publican ---------- */
  function novedadesPublicas(items) {
    return (items || []).filter(n => n && n.visible !== false && String(n.titulo || '').trim()).slice(0, 12).map(n => {
      const o = { id: n.id, tipo: String(n.tipo || 'Novedad').slice(0, 20), titulo: String(n.titulo).trim().slice(0, 90) };
      if (n.fecha && String(n.fecha).trim()) o.fecha = String(n.fecha).trim().slice(0, 40);
      if (n.texto && String(n.texto).trim()) o.texto = String(n.texto).trim().slice(0, 400);
      if (n.boton && String(n.boton).trim()) o.boton = String(n.boton).trim().slice(0, 30);
      if (n.imgV) o.f = n.imgV;
      return o;
    });
  }

  /* ---------- Formato ---------- */
  function fmtGs(n) { return n == null ? '—' : 'Gs. ' + Number(n).toLocaleString('es-PY'); }

  return {
    CATEGORIAS_WEB, CAT_IDS, normalizar, hash6, limpiarCodigo, parsearNumero, entero,
    catWebDesde, catWebPorPistas, detectarColumnas, columnasValidas, encontrarEncabezado,
    filasAProductos, asignarIds, diffImportacion, camposDesdeEntrante, estadoWeb, publicable,
    construirSnapshot, fmtGs, TAM_PARTE,
    telClave, claveCliente, aFecha, cumpleValido, derivarClientes, diasParaCumple, proximosCumples, cumpleTexto, mensajeCumple, MSG_CUMPLE, MESES, novedadesPublicas
  };
});
