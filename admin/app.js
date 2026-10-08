/* ============================================================
   KarA-BelA — panel de administración (Firebase + DOM)
   La lógica pura (columnas, comparación, snapshot) vive en logica.js
   ============================================================ */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = KB.fmtGs;

  /* ---------- Toast ---------- */
  function toast(msg, err) {
    const t = $('#toast'); t.textContent = msg; t.classList.toggle('err', !!err); t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), err ? 4500 : 2200);
  }
  window.addEventListener('error', (e) => { if (e.error) console.error(e.error); });
  // Si una foto no carga (todavía no está en Storage, o las reglas no se publicaron), se muestra el emoji
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || img.dataset.ph == null) return;
    const d = document.createElement('div'); d.className = img.className; d.textContent = img.dataset.ph; d.title = 'La foto no se pudo cargar'; img.replaceWith(d);
  }, true);

  /* ---------- Configuración ---------- */
  const cfg = window.KB_FIREBASE || {};
  const configurado = !!(cfg.apiKey && cfg.projectId && cfg.storageBucket);
  if (!configurado) {
    $('#login-sin-config').hidden = false;
    $('#login-form').hidden = true;
    return;
  }
  firebase.initializeApp(cfg);
  const auth = firebase.auth();
  const db = firebase.firestore();
  const storage = firebase.storage();
  const ahoraISO = () => new Date().toISOString();
  const rutaFoto = (id) => 'productos/' + id + '.jpg';
  const urlFoto = (p) => p.imgV ? `https://firebasestorage.googleapis.com/v0/b/${cfg.storageBucket}/o/${encodeURIComponent(rutaFoto(p.id))}?alt=media&v=${p.imgV}` : null;

  /* ---------- Estado ---------- */
  const S = {
    productos: new Map(), tienda: null, catMapa: {}, pedidos: [], usuario: null,
    fichas: new Map(), clientes: [], novedades: [],
    pagina: 1, subs: [], partesPrevias: 1, pubEstado: 'pendiente', pubTimer: null, cargando: true
  };
  const POR_PAGINA = 50;

  /* ============================================================
     LOGIN
     ============================================================ */
  const ERRORES_AUTH = {
    'auth/invalid-credential': 'Correo o contraseña incorrectos.',
    'auth/wrong-password': 'Contraseña incorrecta.',
    'auth/user-not-found': 'No existe un usuario con ese correo.',
    'auth/invalid-email': 'El correo no es válido.',
    'auth/too-many-requests': 'Demasiados intentos. Esperá unos minutos y probá de nuevo.',
    'auth/network-request-failed': 'Sin conexión. Revisá internet y probá de nuevo.'
  };
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#login-btn'), err = $('#login-error');
    btn.disabled = true; err.hidden = true;
    try {
      await auth.signInWithEmailAndPassword($('#login-email').value.trim(), $('#login-pass').value);
    } catch (ex) {
      err.textContent = ERRORES_AUTH[ex.code] || ('No se pudo entrar (' + (ex.code || ex.message) + ').');
      err.hidden = false;
    } finally { btn.disabled = false; }
  });
  $('#login-olvide').addEventListener('click', async (e) => {
    e.preventDefault();
    const email = $('#login-email').value.trim();
    if (!email) { toast('Escribí tu correo arriba y volvé a tocar acá', true); return; }
    try { await auth.sendPasswordResetEmail(email); toast('Te mandamos un correo para cambiar la contraseña 💌'); }
    catch (ex) { toast(ERRORES_AUTH[ex.code] || 'No se pudo enviar el correo', true); }
  });
  $('#salir').addEventListener('click', () => auth.signOut());

  auth.onAuthStateChanged((u) => { if (u) entrar(u); else salirUI(); });

  function salirUI() {
    S.subs.forEach(fn => { try { fn(); } catch (_) {} });
    S.subs = []; S.productos = new Map(); S.pedidos = []; S.tienda = null; S.usuario = null;
    S.fichas = new Map(); S.clientes = []; S.novedades = [];
    $('#app').hidden = true; $('#login').hidden = false;
    $('#login-pass').value = '';
  }

  async function entrar(u) {
    S.usuario = u;
    $('#usuario').textContent = u.email || '';
    $('#login').hidden = true; $('#app').hidden = false;
    S.cargando = true;

    // Productos (colección completa, en vivo)
    S.subs.push(db.collection('productos').onSnapshot((snap) => {
      snap.docChanges().forEach(ch => {
        if (ch.type === 'removed') S.productos.delete(ch.doc.id);
        else S.productos.set(ch.doc.id, { id: ch.doc.id, ...ch.doc.data() });
      });
      S.cargando = false;
      renderProductos(); renderCategorias(); llenarSelectCats();
    }, (e) => { console.error(e); toast('No se pudieron leer los productos: ' + e.message, true); }));

    // Config de la tienda y de categorías
    S.subs.push(db.collection('config').doc('tienda').onSnapshot((d) => { S.tienda = d.exists ? d.data() : null; llenarTienda(); llenarMsgCumple(); renderCumples(); }));
    S.subs.push(db.collection('config').doc('novedades').onSnapshot((d) => { S.novedades = (d.exists && d.data().items) || []; renderNovedades(); }, (e) => { console.error(e); }));

    // Fichas de clientas (lo que ella carga o corrige a mano)
    S.subs.push(db.collection('clientes').onSnapshot((snap) => {
      S.fichas = new Map(snap.docs.map(d => [d.id, d.data()]));
      recalcularClientes();
    }, (e) => { console.error(e); toast('No se pudieron leer las clientas: ' + e.message, true); }));
    S.subs.push(db.collection('config').doc('categorias').onSnapshot((d) => { S.catMapa = (d.exists && d.data().mapa) || {}; renderCategorias(); }));

    // Pedidos
    S.subs.push(db.collection('pedidos').orderBy('fecha', 'desc').limit(1500).onSnapshot((snap) => {
      S.pedidos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderPedidos(); recalcularClientes();
    }, (e) => { console.error(e); }));

    // Estado de lo publicado
    try {
      const pub = await db.collection('publico').doc('catalogo').get();
      if (pub.exists) { S.partesPrevias = pub.data().partes || 1; setPub('ok', null, pub.data().generado); }
      else setPub('pendiente');
    } catch (e) { console.error(e); }
  }

  /* ============================================================
     PESTAÑAS
     ============================================================ */
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('.tab'); if (!b) return;
    irA(b.dataset.tab);
  });
  function irA(tab) {
    $$('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === tab));
    ['productos', 'importar', 'pedidos', 'clientes', 'novedades', 'categorias', 'tienda'].forEach(t => { $('#tab-' + t).hidden = t !== tab; });
    window.scrollTo({ top: 0 });
  }
  $('#ir-importar').addEventListener('click', () => irA('importar'));

  /* ============================================================
     PUBLICACIÓN (snapshot público en Firestore)
     ============================================================ */
  function setPub(estado, error, generado) {
    S.pubEstado = estado;
    const el = $('#pub-estado');
    el.className = 'pub ' + (estado === 'ok' ? '' : estado);
    if (estado === 'ok') { const h = generado ? new Date(generado) : new Date(); el.textContent = '● Publicado ' + h.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' }); el.title = 'La web ya muestra la última versión'; }
    else if (estado === 'trabajando') { el.textContent = '⟳ Publicando…'; el.title = ''; }
    else if (estado === 'error') { el.textContent = '⚠ No se pudo publicar — tocá para reintentar'; el.title = error ? error.message : ''; }
    else { el.textContent = '● Sin cambios'; el.title = 'Todavía no hay cambios pendientes'; }
  }
  $('#pub-estado').addEventListener('click', () => { if (S.pubEstado === 'error') publicar(); });
  function programarPublicacion() {
    clearTimeout(S.pubTimer);
    setPub('trabajando');
    S.pubTimer = setTimeout(publicar, 1500);
  }
  async function publicar() {
    clearTimeout(S.pubTimer);
    setPub('trabajando');
    try {
      const snap = KB.construirSnapshot(Array.from(S.productos.values()), tiendaPublica(), ahoraISO());
      snap.principal.novedades = KB.novedadesPublicas(S.novedades);
      const batch = db.batch();
      batch.set(db.collection('publico').doc('catalogo'), snap.principal);
      snap.resto.forEach((parte, i) => batch.set(db.collection('publico').doc('catalogo_' + (i + 1)), parte));
      for (let i = snap.resto.length + 1; i < S.partesPrevias; i++) batch.delete(db.collection('publico').doc('catalogo_' + i));
      await batch.commit();
      S.partesPrevias = snap.principal.partes;
      setPub('ok', null, snap.principal.generado);
    } catch (e) { console.error(e); setPub('error', e); }
  }
  function tiendaPublica() {
    const t = S.tienda || {};
    const out = {};
    ['nombre', 'whatsapp', 'direccion', 'horario', 'instagram', 'facebook', 'maps'].forEach(k => { if (t[k] != null && String(t[k]).trim()) out[k] = String(t[k]).trim(); });
    ['deliveryCentro', 'deliveryLejos'].forEach(k => { const n = KB.entero(t[k]); if (n != null) out[k] = n; });
    if (Array.isArray(t.marcas) && t.marcas.length) out.marcas = t.marcas.filter(Boolean);
    return out;
  }

  /* ============================================================
     PRODUCTOS
     ============================================================ */
  const catNombre = (id) => (KB.CATEGORIAS_WEB.find(c => c.i === id) || {}).n || id || '';
  const catEmoji = (id) => (KB.CATEGORIAS_WEB.find(c => c.i === id) || {}).e || '🛍️';

  function llenarSelectCats() {
    const sel = $('#f-cat');
    if (sel.options.length > 1) return;
    KB.CATEGORIAS_WEB.forEach(c => { const o = document.createElement('option'); o.value = c.i; o.textContent = c.e + ' ' + c.n; sel.appendChild(o); });
    const m = $('#m-catweb');
    KB.CATEGORIAS_WEB.forEach(c => { const o = document.createElement('option'); o.value = c.i; o.textContent = c.e + ' ' + c.n; m.appendChild(o); });
  }
  llenarSelectCats();

  function productosFiltrados() {
    const q = KB.normalizar($('#buscar').value);
    const cat = $('#f-cat').value, est = $('#f-estado').value;
    let l = Array.from(S.productos.values());
    if (cat) l = l.filter(p => p.catWeb === cat);
    if (est) l = l.filter(p => {
      const e = KB.estadoWeb(p);
      switch (est) {
        case 'publicados': return e.ok;
        case 'ocultos': return p.visible === false;
        case 'sinstock': return p.origen !== 'manual' && p.stock != null && p.stock <= 0;
        case 'sinprecio': return p.precio == null || p.precio <= 0;
        case 'destacados': return !!p.destacado;
        case 'confoto': return !!p.imgV;
        case 'sinfoto': return !p.imgV;
        case 'manuales': return p.origen === 'manual';
      } return true;
    });
    if (q) l = l.filter(p => KB.normalizar(p.nombre + ' ' + (p.nombreWeb || '') + ' ' + p.codigo + ' ' + p.id).includes(q));
    l.sort((a, b) => (b.destacado ? 1 : 0) - (a.destacado ? 1 : 0) || (a.nombreWeb || a.nombre).localeCompare(b.nombreWeb || b.nombre, 'es'));
    return l;
  }
  function renderProductos() {
    const total = S.productos.size;
    const vacio = $('#vacio'); vacio.hidden = S.cargando || total > 0;
    $('#tabla').hidden = total === 0;
    const l = productosFiltrados();
    const publicados = Array.from(S.productos.values()).filter(KB.publicable).length;
    $('#contador').textContent = total ? `${l.length} de ${total} productos · ${publicados} en la web` : '';
    const paginas = Math.max(1, Math.ceil(l.length / POR_PAGINA));
    if (S.pagina > paginas) S.pagina = paginas;
    const desde = (S.pagina - 1) * POR_PAGINA;
    const pag = l.slice(desde, desde + POR_PAGINA);
    $('#tbody').innerHTML = pag.map(p => {
      const e = KB.estadoWeb(p);
      const foto = urlFoto(p);
      return `<tr data-id="${esc(p.id)}">
        <td>${foto ? `<img class="thumb" src="${esc(foto)}" alt="" loading="lazy" data-ph="${catEmoji(p.catWeb)}">` : `<div class="thumb">${catEmoji(p.catWeb)}</div>`}</td>
        <td class="cod">${esc(p.codigo || p.id)}${p.origen === 'manual' ? ' <span class="chip">a mano</span>' : ''}</td>
        <td class="nom">${esc(p.nombre)}${p.nombreWeb ? `<small>${esc(p.nombreWeb)}</small>` : ''}</td>
        <td><span class="chip">${catEmoji(p.catWeb)} ${esc(catNombre(p.catWeb))}</span>${p.categoria ? `<div class="cambio">${esc(p.categoria)}</div>` : ''}</td>
        <td class="num">${fmt(p.precio)}</td>
        <td class="num">${p.origen === 'manual' ? '—' : (p.stock == null ? '<span title="Sin dato hasta la primera importación">—</span>' : p.stock)}</td>
        <td><div style="display:flex;align-items:center;gap:8px;"><button class="sw ${p.visible !== false ? 'on' : ''}" data-a="visible" title="Mostrar / ocultar en la web"></button><span class="chip ${e.ok ? 'ok' : (e.motivo === 'Oculto' ? 'off' : 'warn')}">${e.motivo}</span></div></td>
        <td><button class="star ${p.destacado ? 'on' : ''}" data-a="destacado" title="Destacado">★</button></td>
        <td><button class="btn-ic" data-a="editar" title="Editar">✎</button></td>
      </tr>`;
    }).join('');
    $('#paginado').hidden = paginas <= 1;
    $('#pag-info').textContent = `Página ${S.pagina} de ${paginas}`;
    $('#pag-ant').disabled = S.pagina <= 1; $('#pag-sig').disabled = S.pagina >= paginas;
  }
  ['#buscar', '#f-cat', '#f-estado'].forEach(s => $(s).addEventListener('input', () => { S.pagina = 1; renderProductos(); }));
  $('#pag-ant').addEventListener('click', () => { S.pagina--; renderProductos(); });
  $('#pag-sig').addEventListener('click', () => { S.pagina++; renderProductos(); });

  $('#tbody').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const tr = b.closest('tr'); const p = S.productos.get(tr.dataset.id); if (!p) return;
    if (b.dataset.a === 'editar') { abrirModal(p); return; }
    try {
      if (b.dataset.a === 'visible') await db.collection('productos').doc(p.id).update({ visible: p.visible === false, actualizadoEn: ahoraISO() });
      if (b.dataset.a === 'destacado') await db.collection('productos').doc(p.id).update({ destacado: !p.destacado, actualizadoEn: ahoraISO() });
      programarPublicacion();
    } catch (ex) { toast('No se pudo guardar: ' + ex.message, true); }
  });
  $('#nuevo').addEventListener('click', () => abrirModal(null));

  /* ---------- Modal de producto ---------- */
  const M = { p: null, fotoNueva: null, quitarFoto: false };
  function abrirModal(p) {
    M.p = p; M.fotoNueva = null; M.quitarFoto = false;
    const manual = !p || p.origen === 'manual';
    $('#m-titulo').textContent = p ? 'Editar producto' : 'Nuevo producto (a mano)';
    $('#m-codigo').value = p ? (p.codigo || p.id) : '';
    $('#m-codigo').readOnly = !!p; $('#m-codigo').classList.toggle('ro', !!p);
    $('#m-codigo-ayuda').textContent = p ? '' : 'Opcional. Si lo dejás vacío se genera uno.';
    $('#m-categoria').value = p ? (p.categoria || '') : 'Kits y combos';
    $('#m-categoria').readOnly = !manual; $('#m-categoria').classList.toggle('ro', !manual);
    $('#m-nombre').value = p ? p.nombre : '';
    $('#m-nombre').readOnly = !manual; $('#m-nombre').classList.toggle('ro', !manual);
    $('#m-nombreweb').value = p ? (p.nombreWeb || '') : '';
    $('#m-precio').value = p && p.precio != null ? p.precio : '';
    $('#m-precio-ayuda').textContent = manual ? 'Vacío = «Consultar precio» (el botón lleva a WhatsApp).' : 'Ojo: al importar, el precio del sistema pisa este valor.';
    $('#m-stock').value = p && p.stock != null ? p.stock : '';
    $('#m-stock').disabled = manual;
    $('#m-stock-ayuda').textContent = manual ? 'Los productos a mano no controlan stock: se muestran mientras estén visibles.' : 'Vacío = sin dato (se muestra igual). 0 = se oculta de la web.';
    $('#m-catweb').value = p ? (p.catWeb || 'accesorios') : 'kits';
    $('#m-orden').value = p && p.orden ? p.orden : '';
    $('#m-descripcion').value = p ? (p.descripcion || '') : '';
    $('#m-visible').checked = p ? p.visible !== false : true;
    $('#m-destacado').checked = p ? !!p.destacado : true;
    $('#m-eliminar').hidden = !p || !manual;
    $('#m-foto-estado').textContent = '';
    pintarFoto(p ? urlFoto(p) : null);
    $('#modal').hidden = false;
  }
  function pintarFoto(url) {
    const box = $('#m-foto-prev');
    box.innerHTML = url ? `<img src="${esc(url)}" alt="" data-ph="${catEmoji($('#m-catweb').value)}">` : catEmoji($('#m-catweb').value);
    $('#m-foto-quitar').hidden = !url;
  }
  function cerrarModal() { $('#modal').hidden = true; M.p = null; M.fotoNueva = null; }
  $('#m-cerrar').addEventListener('click', cerrarModal);
  $('#m-cancelar').addEventListener('click', cerrarModal);
  $('#modal').addEventListener('click', (e) => { if (e.target === $('#modal')) cerrarModal(); });
  $('#m-catweb').addEventListener('change', () => { if (!M.fotoNueva && !(M.p && urlFoto(M.p) && !M.quitarFoto)) pintarFoto(null); });
  $('#m-foto').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    $('#m-foto-estado').textContent = 'Procesando la foto…';
    try {
      M.fotoNueva = await procesarImagen(f);
      M.quitarFoto = false;
      pintarFoto(URL.createObjectURL(M.fotoNueva));
      $('#m-foto-estado').textContent = `Lista para subir (${Math.round(M.fotoNueva.size / 1024)} KB). Se sube al guardar.`;
    } catch (ex) { console.error(ex); $('#m-foto-estado').textContent = 'No se pudo procesar esa imagen.'; }
    e.target.value = '';
  });
  $('#m-foto-quitar').addEventListener('click', () => { M.fotoNueva = null; M.quitarFoto = true; pintarFoto(null); $('#m-foto-estado').textContent = 'La foto se quita al guardar.'; });

  async function procesarImagen(file, max) {
    max = max || 900;
    let img;
    try { img = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (_) {
      img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
    }
    const w = img.width, h = img.height, k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
    if (!blob) throw new Error('canvas');
    return blob;
  }
  async function subirFoto(id, blob) {
    await storage.ref(rutaFoto(id)).put(blob, { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000' });
    return Date.now();
  }
  async function borrarFoto(id) {
    try { await storage.ref(rutaFoto(id)).delete(); } catch (e) { if (e.code !== 'storage/object-not-found') throw e; }
  }

  $('#m-guardar').addEventListener('click', async () => {
    const p = M.p, manual = !p || p.origen === 'manual';
    const nombre = $('#m-nombre').value.trim();
    if (!nombre) { toast('El nombre no puede quedar vacío', true); return; }
    const precio = KB.entero($('#m-precio').value);
    if ($('#m-precio').value.trim() && precio == null) { toast('El precio tiene que ser un número', true); return; }
    const stock = manual ? null : KB.entero($('#m-stock').value);
    const catWeb = $('#m-catweb').value;
    const btn = $('#m-guardar'); btn.disabled = true;
    try {
      const ahora = ahoraISO();
      let id = p ? p.id : '';
      const campos = {
        nombre, nombreWeb: $('#m-nombreweb').value.trim(), precio: precio == null ? null : precio,
        catWeb, descripcion: $('#m-descripcion').value.trim(), orden: KB.entero($('#m-orden').value) || 0,
        visible: $('#m-visible').checked, destacado: $('#m-destacado').checked, actualizadoEn: ahora
      };
      if (manual) { campos.categoria = $('#m-categoria').value.trim(); campos.stock = null; }
      else campos.stock = stock;
      // Si cambió la sección a mano, queda fija
      if (p && catWeb !== p.catWeb) campos.catFija = true;
      if (!p) {
        const cod = KB.limpiarCodigo($('#m-codigo').value);
        id = cod || ('m' + Date.now().toString(36));
        if (S.productos.has(id)) { toast('Ya existe un producto con ese código', true); btn.disabled = false; return; }
        Object.assign(campos, { id, codigo: cod || id, origen: 'manual', catFija: true, imgV: null, creadoEn: ahora });
      }
      if (M.quitarFoto && p && p.imgV) { await borrarFoto(id); campos.imgV = null; }
      if (M.fotoNueva) campos.imgV = await subirFoto(id, M.fotoNueva);
      await db.collection('productos').doc(id).set(campos, { merge: true });
      programarPublicacion();
      toast('Guardado 💖'); cerrarModal();
    } catch (ex) { console.error(ex); toast('No se pudo guardar: ' + ex.message, true); }
    finally { btn.disabled = false; }
  });
  $('#m-eliminar').addEventListener('click', async () => {
    const p = M.p; if (!p) return;
    if (!confirm(`¿Eliminar «${p.nombre}» de la web? Esta acción no se puede deshacer.`)) return;
    try {
      if (p.imgV) await borrarFoto(p.id);
      await db.collection('productos').doc(p.id).delete();
      programarPublicacion(); toast('Producto eliminado'); cerrarModal();
    } catch (ex) { toast('No se pudo eliminar: ' + ex.message, true); }
  });

  /* ============================================================
     CARGA INICIAL (catálogo de la fase 1)
     ============================================================ */
  $('#semilla').addEventListener('click', async () => {
    if (S.productos.size > 0) { toast('Ya hay productos cargados', true); return; }
    if (!confirm('Se van a cargar los productos y las fotos que ya estaban en la web (fase 1). ¿Continuar?')) return;
    const btn = $('#semilla'); btn.disabled = true;
    try {
      const r = await fetch('/catalogo.json', { cache: 'no-store' });
      if (!r.ok) throw new Error('No se pudo leer /catalogo.json');
      const data = await r.json();
      const ahora = ahoraISO();
      const lista = data.productos || [];
      let hechos = 0;
      for (let i = 0; i < lista.length; i += 400) {
        const batch = db.batch();
        for (const p of lista.slice(i, i + 400)) {
          const manual = !!p.m;
          batch.set(db.collection('productos').doc(p.i), {
            id: p.i, codigo: p.i, nombre: p.n, nombreWeb: '', categoria: catNombre(p.c),
            catWeb: p.c, catFija: manual, precio: p.p == null ? null : p.p, stock: null, visible: true,
            destacado: !!p.d, orden: p.o || 0, descripcion: p.s || '', imgV: null, origen: manual ? 'manual' : 'import',
            creadoEn: ahora, actualizadoEn: ahora, importadoEn: manual ? null : ahora
          });
        }
        await batch.commit();
        hechos += Math.min(400, lista.length - i);
        btn.textContent = `Cargando productos… ${hechos}/${lista.length}`;
      }
      // Fotos de los destacados
      const conFoto = lista.filter(p => typeof p.f === 'string');
      let f = 0;
      for (const p of conFoto) {
        try {
          const rr = await fetch(p.f); if (!rr.ok) continue;
          const blob = await rr.blob();
          const v = await subirFoto(p.i, blob);
          await db.collection('productos').doc(p.i).update({ imgV: v });
        } catch (ex) { console.error('foto', p.i, ex); }
        f++; btn.textContent = `Subiendo fotos… ${f}/${conFoto.length}`;
      }
      if (!S.tienda && data.tienda) await db.collection('config').doc('tienda').set(data.tienda);
      programarPublicacion();
      toast('Catálogo inicial cargado 💖');
    } catch (ex) { console.error(ex); toast('Falló la carga inicial: ' + ex.message, true); }
    finally { btn.disabled = false; btn.textContent = 'Cargar el catálogo inicial (fase 1)'; }
  });

  /* ============================================================
     IMPORTAR
     ============================================================ */
  const I = { archivos: [], analisis: null, vista: 'nuevos' };
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) cargarArchivos(Array.from(e.dataTransfer.files)); });
  $('#archivos').addEventListener('change', (e) => { cargarArchivos(Array.from(e.target.files)); e.target.value = ''; });

  const celda = (v) => {
    if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('fullwide', { useGrouping: false }) : String(v);
    return v == null ? '' : String(v);
  };
  async function leerArchivo(file) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', raw: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true }).map(f => f.map(celda));
    const enc = KB.encontrarEncabezado(filas);
    return { nombre: file.name, filas, cabecera: enc ? enc.fila : 0, cols: enc ? enc.cols : KB.detectarColumnas(filas[0] || []), valido: !!enc };
  }
  async function cargarArchivos(files) {
    if (typeof XLSX === 'undefined') { toast('No se pudo cargar el lector de Excel. Revisá la conexión y recargá.', true); return; }
    I.archivos = [];
    for (const f of files) {
      try { I.archivos.push(await leerArchivo(f)); }
      catch (ex) { console.error(ex); toast(`No se pudo leer ${f.name}`, true); }
    }
    renderArchivos(); analizar();
  }
  function renderArchivos() {
    const cont = $('#imp-archivos');
    cont.innerHTML = I.archivos.map((a, i) => {
      const enc = a.filas[a.cabecera] || [];
      const opciones = (sel) => `<option value="-1">— no usar —</option>` + enc.map((h, j) => `<option value="${j}" ${sel === j ? 'selected' : ''}>${esc(h || ('col ' + (j + 1)))}</option>`).join('');
      const nFilas = Math.max(0, a.filas.length - a.cabecera - 1);
      return `<details class="archivo" data-i="${i}" ${a.valido ? '' : 'open'}>
        <summary>${a.valido ? '✅' : '⚠️'} ${esc(a.nombre)} — ${nFilas} filas${a.valido ? '' : ' · no se reconocieron las columnas, elegilas abajo'}</summary>
        <div class="cols">
          ${['codigo', 'nombre', 'categoria', 'precio', 'stock'].map(c => `<div><label>${{ codigo: 'Código', nombre: 'Nombre', categoria: 'Categoría', precio: 'Precio de venta', stock: 'Cantidad / stock' }[c]}</label><select data-campo="${c}">${opciones(a.cols[c])}</select></div>`).join('')}
          <div><label>Fila de encabezados</label><input type="number" min="1" value="${a.cabecera + 1}" data-campo="cabecera"></div>
        </div>
      </details>`;
    }).join('');
  }
  $('#imp-archivos').addEventListener('change', (e) => {
    const det = e.target.closest('.archivo'); if (!det) return;
    const a = I.archivos[+det.dataset.i];
    const campo = e.target.dataset.campo;
    if (campo === 'cabecera') { a.cabecera = Math.max(0, (+e.target.value || 1) - 1); a.cols = KB.detectarColumnas(a.filas[a.cabecera] || []); renderArchivos(); }
    else a.cols[campo] = +e.target.value;
    a.valido = KB.columnasValidas(a.cols);
    analizar();
  });

  function analizar() {
    const validos = I.archivos.filter(a => a.valido);
    const box = $('#imp-analisis');
    if (!validos.length) { box.hidden = true; I.analisis = null; return; }
    let entrantes = [];
    for (const a of validos) entrantes = entrantes.concat(KB.filasAProductos(a.filas.slice(a.cabecera + 1), a.cols));
    const ids = KB.asignarIds(entrantes);
    const diff = KB.diffImportacion(S.productos, ids.productos);
    I.analisis = { diff, ids, total: ids.productos.length };
    box.hidden = false; $('#imp-ok').hidden = true; $('#imp-progreso').hidden = true; $('#imp-aplicar').disabled = false;
    const notas = [`${entrantes.length} filas leídas → ${ids.productos.length} productos.`];
    if (ids.repetidos) notas.push(`${ids.repetidos} filas repetidas (mismo código y nombre) se unificaron tomando el mayor stock.`);
    if (ids.variantes) notas.push(`${ids.variantes} productos comparten código con otro nombre: se cargan como variantes separadas.`);
    $('#imp-nota').textContent = notas.join(' ');
    const nCambios = (campo) => diff.cambian.filter(c => c.cambios.some(x => x.campo === campo)).length;
    const kpis = [
      ['nuevos', diff.nuevos.length, 'Nuevos'],
      ['cambian', diff.cambian.length, `Cambian (${nCambios('precio')} precio · ${nCambios('stock')} stock)`],
      ['iguales', diff.iguales.length, 'Sin cambios'],
      ['noVienen', diff.noVienen.length, 'No vienen en el archivo']
    ];
    if (!diff[I.vista] || !diff[I.vista].length) I.vista = kpis.find(k => k[1] > 0) ? kpis.find(k => k[1] > 0)[0] : 'nuevos';
    $('#imp-kpis').innerHTML = kpis.map(([k, n, t]) => `<div class="kpi ${I.vista === k ? 'on' : ''}" data-v="${k}"><b>${n}</b><span>${t}</span></div>`).join('');
    $('#imp-cero-box').hidden = !diff.noVienen.length;
    $('#imp-cero-txt').textContent = `Poner stock 0 a los ${diff.noVienen.length} productos que no vienen en el archivo (quedan ocultos en la web). Dejalo sin marcar si exportaste solo una parte del inventario.`;
    $('#imp-cero').checked = false;
    renderVistaImport();
  }
  $('#imp-kpis').addEventListener('click', (e) => { const k = e.target.closest('.kpi'); if (!k) return; I.vista = k.dataset.v; $$('.kpi').forEach(x => x.classList.toggle('on', x.dataset.v === I.vista)); renderVistaImport(); });
  function renderVistaImport() {
    const d = I.analisis.diff, v = I.vista, MAX = 300;
    const th = $('#imp-thead'), tb = $('#imp-tbody');
    let filas = [];
    if (v === 'nuevos') {
      th.innerHTML = '<tr><th>Código</th><th>Nombre</th><th>Categoría</th><th class="num">Precio</th><th class="num">Stock</th><th>Sección web</th></tr>';
      filas = d.nuevos.map(({ entrante: e }) => `<tr><td class="cod">${esc(e.id)}</td><td>${esc(e.nombre)}</td><td>${esc(e.categoria)}</td><td class="num">${fmt(e.precio)}</td><td class="num">${e.stock == null ? '—' : e.stock}</td><td><span class="chip">${esc(catNombre(KB.catWebDesde(e.categoria || e.nombre, S.catMapa)))}</span></td></tr>`);
    } else if (v === 'cambian') {
      th.innerHTML = '<tr><th>Código</th><th>Nombre</th><th>Qué cambia</th></tr>';
      filas = d.cambian.map(({ entrante: e, cambios }) => `<tr><td class="cod">${esc(e.id)}</td><td>${esc(e.nombre)}</td><td>${cambios.map(c => `<div class="cambio">${c.campo}: <b>${esc(c.campo === 'precio' ? fmt(c.antes) : (c.antes == null ? '—' : c.antes))}</b> → <b>${esc(c.campo === 'precio' ? fmt(c.despues) : c.despues)}</b></div>`).join('')}</td></tr>`);
    } else if (v === 'iguales') {
      th.innerHTML = '<tr><th>Código</th><th>Nombre</th><th class="num">Precio</th><th class="num">Stock</th></tr>';
      filas = d.iguales.map(({ entrante: e }) => `<tr><td class="cod">${esc(e.id)}</td><td>${esc(e.nombre)}</td><td class="num">${fmt(e.precio)}</td><td class="num">${e.stock == null ? '—' : e.stock}</td></tr>`);
    } else {
      th.innerHTML = '<tr><th>Código</th><th>Nombre</th><th class="num">Precio</th><th class="num">Stock actual</th><th>Estado</th></tr>';
      filas = d.noVienen.map(p => `<tr><td class="cod">${esc(p.id)}</td><td>${esc(p.nombre)}</td><td class="num">${fmt(p.precio)}</td><td class="num">${p.stock == null ? '—' : p.stock}</td><td><span class="chip">${KB.estadoWeb(p).motivo}</span></td></tr>`);
    }
    tb.innerHTML = filas.slice(0, MAX).join('') || '<tr><td colspan="6" class="vacio">Nada en esta lista.</td></tr>';
    $('#imp-mas').hidden = filas.length <= MAX;
    $('#imp-mas').textContent = `Se muestran ${MAX} de ${filas.length}.`;
  }
  $('#imp-cancelar').addEventListener('click', () => { I.archivos = []; I.analisis = null; $('#imp-archivos').innerHTML = ''; $('#imp-analisis').hidden = true; });
  $('#imp-aplicar').addEventListener('click', async () => {
    const a = I.analisis; if (!a) return;
    const d = a.diff, cero = $('#imp-cero').checked && d.noVienen.length;
    const nEscrituras = d.nuevos.length + d.cambian.length + (cero ? d.noVienen.length : 0);
    if (!nEscrituras) { toast('No hay nada que cambiar 👌'); return; }
    if (!confirm(`Se van a crear ${d.nuevos.length} productos, actualizar ${d.cambian.length}${cero ? ` y poner en 0 el stock de ${d.noVienen.length}` : ''}. ¿Aplicar?`)) return;
    const btn = $('#imp-aplicar'); btn.disabled = true;
    $('#imp-progreso').hidden = false; $('#imp-ok').hidden = true;
    const barra = $('#imp-barra'), txt = $('#imp-prog-txt');
    try {
      const ahora = ahoraISO();
      const ops = [];
      d.nuevos.forEach(({ entrante }) => ops.push(['set', entrante.id, KB.camposDesdeEntrante(entrante, null, S.catMapa, ahora)]));
      d.cambian.forEach(({ entrante, existente }) => ops.push(['set', entrante.id, KB.camposDesdeEntrante(entrante, existente, S.catMapa, ahora)]));
      if (cero) d.noVienen.forEach(p => ops.push(['update', p.id, { stock: 0, actualizadoEn: ahora }]));
      let hechas = 0;
      for (let i = 0; i < ops.length; i += 400) {
        const batch = db.batch();
        for (const [tipo, id, campos] of ops.slice(i, i + 400)) {
          const ref = db.collection('productos').doc(id);
          if (tipo === 'set') batch.set(ref, campos, { merge: true }); else batch.update(ref, campos);
        }
        await batch.commit();
        hechas += Math.min(400, ops.length - i);
        barra.style.width = Math.round(hechas / ops.length * 100) + '%';
        txt.textContent = `Guardando… ${hechas} de ${ops.length}`;
      }
      barra.style.width = '100%';
      txt.textContent = 'Listo.';
      $('#imp-ok').hidden = false;
      $('#imp-ok').textContent = `✅ Importación aplicada: ${d.nuevos.length} nuevos, ${d.cambian.length} actualizados${cero ? `, ${d.noVienen.length} con stock 0` : ''}. La web se actualiza en unos segundos.`;
      programarPublicacion();
      I.archivos = []; $('#imp-archivos').innerHTML = '';
      toast('Importación aplicada 💖');
    } catch (ex) { console.error(ex); toast('Falló la importación: ' + ex.message, true); btn.disabled = false; }
  });

  /* ============================================================
     PEDIDOS
     ============================================================ */
  const ESTADOS = ['nuevo', 'confirmado', 'entregado', 'cancelado'];
  const ESTADO_TXT = { nuevo: 'Nuevo', confirmado: 'Confirmado', entregado: 'Entregado', cancelado: 'Cancelado' };
  $('#ped-filtro').addEventListener('change', renderPedidos);
  function fechaPedido(p) {
    const f = p.fecha && p.fecha.toDate ? p.fecha.toDate() : (p.fecha ? new Date(p.fecha) : null);
    return f ? f.toLocaleString('es-PY', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  }
  function renderPedidos() {
    const nuevos = S.pedidos.filter(p => (p.estado || 'nuevo') === 'nuevo').length;
    $('#pedidos-nuevos').hidden = !nuevos; $('#pedidos-nuevos').textContent = nuevos;
    const f = $('#ped-filtro').value;
    const l = f ? S.pedidos.filter(p => (p.estado || 'nuevo') === f) : S.pedidos;
    const cont = $('#pedidos-lista');
    if (!l.length) { cont.innerHTML = '<div class="vacio">Todavía no hay pedidos por acá.</div>'; return; }
    cont.innerHTML = l.map(p => {
      const c = p.cliente || {}, en = p.entrega || {}, est = p.estado || 'nuevo';
      const tel = (c.telefono || '').replace(/\D/g, '');
      return `<div class="pedido est-${est}" data-id="${esc(p.id)}">
        <div class="pedido-head">
          <span class="fecha">${esc(fechaPedido(p))}</span>
          <span class="cli">${esc(c.nombre || 'Sin nombre')}${c.telefono ? ` · <a href="https://wa.me/${tel.startsWith('595') ? tel : '595' + tel.replace(/^0/, '')}" target="_blank" rel="noopener">${esc(c.telefono)}</a>` : ''}</span>
          <span class="chip">${esc(en.tipo || '')}</span>
          <span class="tot">${fmt(p.total)}</span>
          <select data-a="estado">${ESTADOS.map(e => `<option value="${e}" ${e === est ? 'selected' : ''}>${ESTADO_TXT[e]}</option>`).join('')}</select>
        </div>
        <div class="pedido-det" hidden>
          <ul>${(p.items || []).map(it => `<li><span>${it.cant} × ${esc(it.nombre)}</span><span>${fmt((it.precio || 0) * (it.cant || 0))}</span></li>`).join('')}</ul>
          <div class="cambio">Subtotal <b>${fmt(p.subtotal)}</b> · Envío <b>${en.costo == null || en.costo < 0 ? 'a coordinar' : fmt(en.costo)}</b> · Total <b>${fmt(p.total)}</b></div>
          ${en.direccion ? `<div class="cambio">📍 ${esc(en.direccion)}</div>` : ''}
          ${p.nota ? `<div class="cambio">📝 ${esc(p.nota)}</div>` : ''}
          ${c.acepta ? `<div class="cambio">🎁 Quiere recibir ofertas${c.cumple ? ' · cumple el ' + esc(KB.cumpleTexto(c.cumple)) : ''}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  }
  $('#pedidos-lista').addEventListener('click', (e) => {
    if (e.target.closest('select, a')) return;
    const h = e.target.closest('.pedido-head'); if (!h) return;
    const det = h.nextElementSibling; det.hidden = !det.hidden;
  });
  $('#pedidos-lista').addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-a="estado"]'); if (!sel) return;
    const id = sel.closest('.pedido').dataset.id;
    try { await db.collection('pedidos').doc(id).update({ estado: sel.value, actualizadoEn: ahoraISO() }); toast('Estado actualizado'); }
    catch (ex) { toast('No se pudo cambiar el estado: ' + ex.message, true); }
  });

  /* ============================================================
     CATEGORÍAS
     ============================================================ */
  function categoriasReales() {
    const m = new Map();
    for (const p of S.productos.values()) {
      if (p.origen === 'manual') continue;
      const k = KB.normalizar(p.categoria || '') || '(sin categoría)';
      if (!m.has(k)) m.set(k, { k, nombre: (p.categoria || '').trim() || '(sin categoría)', n: 0 });
      m.get(k).n++;
    }
    return Array.from(m.values()).sort((a, b) => b.n - a.n);
  }
  function renderCategorias() {
    const cont = $('#cats-lista'); if (!cont) return;
    const l = categoriasReales();
    if (!l.length) { cont.innerHTML = '<div class="vacio">Cuando importes el export del sistema, acá van a aparecer sus categorías.</div>'; return; }
    cont.innerHTML = l.map(c => `<div class="cat-row" data-k="${esc(c.k)}">
      <div><b>${esc(c.nombre)}</b></div>
      <div class="cambio">${c.n} prod.</div>
      <select>${KB.CATEGORIAS_WEB.map(w => `<option value="${w.i}" ${KB.catWebDesde(c.nombre, S.catMapa) === w.i ? 'selected' : ''}>${w.e} ${w.n}</option>`).join('')}</select>
    </div>`).join('');
  }
  $('#cats-guardar').addEventListener('click', async () => {
    const mapa = {};
    $$('#cats-lista .cat-row').forEach(r => { mapa[r.dataset.k] = r.querySelector('select').value; });
    const btn = $('#cats-guardar'); btn.disabled = true;
    try {
      await db.collection('config').doc('categorias').set({ mapa, actualizadoEn: ahoraISO() }, { merge: true });
      // Re-derivar la sección de cada producto no fijado
      const ops = [];
      for (const p of S.productos.values()) {
        if (p.origen === 'manual' || p.catFija) continue;
        const nueva = KB.catWebDesde(p.categoria || p.nombre, mapa);
        if (nueva !== p.catWeb) ops.push([p.id, nueva]);
      }
      for (let i = 0; i < ops.length; i += 400) {
        const batch = db.batch();
        ops.slice(i, i + 400).forEach(([id, catWeb]) => batch.update(db.collection('productos').doc(id), { catWeb, actualizadoEn: ahoraISO() }));
        await batch.commit();
      }
      programarPublicacion();
      toast(ops.length ? `Listo: ${ops.length} productos cambiaron de sección` : 'Categorías guardadas');
    } catch (ex) { toast('No se pudo guardar: ' + ex.message, true); }
    finally { btn.disabled = false; }
  });

  /* ============================================================
     TIENDA
     ============================================================ */
  function llenarTienda() {
    const t = S.tienda || {};
    $('#t-nombre').value = t.nombre || ''; $('#t-whatsapp').value = t.whatsapp || '';
    $('#t-direccion').value = t.direccion || ''; $('#t-horario').value = t.horario || '';
    $('#t-delcentro').value = t.deliveryCentro != null ? t.deliveryCentro : ''; $('#t-dellejos').value = t.deliveryLejos != null ? t.deliveryLejos : '';
    $('#t-marcas').value = Array.isArray(t.marcas) ? t.marcas.join(', ') : '';
    $('#t-instagram').value = t.instagram || ''; $('#t-facebook').value = t.facebook || ''; $('#t-maps').value = t.maps || '';
  }
  $('#tienda-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const wa = $('#t-whatsapp').value.replace(/\D/g, '');
    if (wa && !/^595\d{9}$/.test(wa)) { toast('El WhatsApp tiene que ser 595 + 9 dígitos (ej.: 595975158244)', true); return; }
    const t = {
      nombre: $('#t-nombre').value.trim(), whatsapp: wa, direccion: $('#t-direccion').value.trim(), horario: $('#t-horario').value.trim(),
      deliveryCentro: KB.entero($('#t-delcentro').value), deliveryLejos: KB.entero($('#t-dellejos').value),
      marcas: $('#t-marcas').value.split(',').map(s => s.trim()).filter(Boolean),
      instagram: $('#t-instagram').value.trim(), facebook: $('#t-facebook').value.trim(), maps: $('#t-maps').value.trim(),
      actualizadoEn: ahoraISO()
    };
    try { await db.collection('config').doc('tienda').set(t, { merge: true }); programarPublicacion(); toast('Datos guardados 💖'); }
    catch (ex) { toast('No se pudo guardar: ' + ex.message, true); }
  });

  /* ============================================================
     CLIENTAS (se arman con los pedidos + la ficha que ella edita)
     ============================================================ */
  const waLink = (tel, texto) => { const t = KB.telClave(tel); return t ? `https://wa.me/${t}${texto ? '?text=' + encodeURIComponent(texto) : ''}` : null; };
  const fechaCorta = (d) => d ? d.toLocaleDateString('es-PY', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '';
  function recalcularClientes() {
    S.clientes = KB.derivarClientes(S.pedidos, S.fichas);
    renderClientes(); renderCumples();
  }
  function llenarMsgCumple() { const el = $('#msg-cumple'); if (document.activeElement !== el) el.value = (S.tienda && S.tienda.msgCumple) || KB.MSG_CUMPLE; }
  llenarMsgCumple();
  $('#msg-cumple-guardar').addEventListener('click', async () => {
    const txt = $('#msg-cumple').value.trim();
    if (!txt) { toast('El mensaje no puede quedar vacío', true); return; }
    try { await db.collection('config').doc('tienda').set({ msgCumple: txt, actualizadoEn: ahoraISO() }, { merge: true }); toast('Mensaje guardado 💖'); }
    catch (ex) { toast('No se pudo guardar: ' + ex.message, true); }
  });
  function renderCumples() {
    const cont = $('#cumples-lista'); if (!cont) return;
    const l = KB.proximosCumples(S.clientes, new Date(), 15);
    const hoy = l.filter(x => x.en === 0).length;
    $('#cumples-n').hidden = !hoy; $('#cumples-n').textContent = hoy;
    if (!l.length) { cont.innerHTML = '<div class="vacio" style="padding:18px;">Nadie cumple años en los próximos 15 días (o todavía no hay cumpleaños cargados).</div>'; return; }
    const plantilla = (S.tienda && S.tienda.msgCumple) || KB.MSG_CUMPLE;
    cont.innerHTML = l.map(({ c, en }) => {
      const link = c.acepta ? waLink(c.telefono, KB.mensajeCumple(plantilla, c)) : null;
      return `<div class="cumple-row">
        <span class="cuando">${en === 0 ? '🎂 Hoy' : (en === 1 ? 'Mañana' : 'En ' + en + ' días')}</span>
        <span class="quien">${esc(c.nombre || 'Sin nombre')} <span class="cambio">· ${esc(KB.cumpleTexto(c.cumple))}${c.nPedidos ? ` · ${c.nPedidos} pedido${c.nPedidos === 1 ? '' : 's'}` : ''}</span></span>
        ${link ? `<a class="btn wa chico" href="${esc(link)}" target="_blank" rel="noopener">Saludar por WhatsApp</a>` : `<span class="chip off">${c.telefono ? 'No pidió recibir mensajes' : 'Sin teléfono'}</span>`}
      </div>`;
    }).join('');
  }
  function clientesFiltrados() {
    const q = KB.normalizar($('#cli-buscar').value), qd = $('#cli-buscar').value.replace(/\D/g, '');
    const f = $('#cli-filtro').value;
    let l = S.clientes;
    if (f === 'acepta') l = l.filter(c => c.acepta);
    if (f === 'cumple') l = l.filter(c => c.cumple);
    if (f === 'repiten') l = l.filter(c => c.nPedidos > 1);
    if (q) l = l.filter(c => KB.normalizar(c.nombre).includes(q) || (qd.length >= 3 && KB.telClave(c.telefono).includes(qd.replace(/^0/, ''))));
    return l;
  }
  const abiertos = new Set();
  function renderClientes() {
    const cont = $('#clientes-lista'); if (!cont) return;
    const l = clientesFiltrados();
    $('#cli-contador').textContent = S.clientes.length ? `${l.length} de ${S.clientes.length} clientas · ${S.clientes.filter(c => c.acepta).length} quieren ofertas` : '';
    if (!l.length) { cont.innerHTML = `<div class="vacio">${S.clientes.length ? 'Ninguna clienta coincide con la búsqueda.' : 'Todavía no hay clientas. Aparecen solas con el primer pedido de la web, o podés agregarlas a mano.'}</div>`; return; }
    cont.innerHTML = l.slice(0, 200).map(c => {
      const chat = waLink(c.telefono);
      return `<div class="cli" data-k="${esc(c.clave)}">
        <div class="cli-head">
          <span class="nombre">${esc(c.nombre || 'Sin nombre')}<small>${esc(c.telefono || 'sin teléfono')}${c.cumple ? ' · 🎂 ' + esc(KB.cumpleTexto(c.cumple)) : ''}</small></span>
          <span class="chip ${c.acepta ? 'ok' : 'off'}">${c.acepta ? 'Quiere ofertas' : 'Sin ofertas'}</span>
          <span class="chip">${c.nPedidos} pedido${c.nPedidos === 1 ? '' : 's'}</span>
          <span class="tot">${fmt(c.total)}</span>
          <span class="cambio">${c.ultimo ? 'último ' + fechaCorta(c.ultimo) : 'cargada a mano'}</span>
        </div>
        <div class="cli-det" ${abiertos.has(c.clave) ? '' : 'hidden'}>
          ${c.nota ? `<div class="cambio">📝 ${esc(c.nota)}</div>` : ''}
          ${c.productos.length ? `<h4>Lo que más pide</h4><ul>${c.productos.slice(0, 8).map(p => `<li><span>${esc(p.nombre)}</span><span>${p.cant} u.</span></li>`).join('')}</ul>` : ''}
          ${c.pedidos.length ? `<h4>Pedidos</h4><ul>${c.pedidos.slice(0, 20).map(p => `<li><span>${esc(fechaCorta(KB.aFecha(p.fecha)))} · ${(p.items || []).length} producto${(p.items || []).length === 1 ? '' : 's'}${(p.estado || 'nuevo') === 'cancelado' ? ' · cancelado' : ''}</span><span>${fmt(p.total)}</span></li>`).join('')}</ul>` : ''}
          <div class="cli-acc">
            ${chat ? `<a class="btn wa chico" href="${esc(chat)}" target="_blank" rel="noopener">Abrir chat de WhatsApp</a>` : ''}
            <button class="btn sec chico" data-a="editar">Editar ficha</button>
          </div>
          ${chat && !c.acepta ? '<div class="cambio" style="margin-top:8px;">No marcó que quiere recibir ofertas: escribile solo por sus pedidos.</div>' : ''}
        </div>
      </div>`;
    }).join('') + (l.length > 200 ? `<p class="sub">Se muestran 200 de ${l.length}. Usá el buscador para encontrar al resto.</p>` : '');
  }
  ['#cli-buscar', '#cli-filtro'].forEach(s => $(s).addEventListener('input', renderClientes));
  $('#clientes-lista').addEventListener('click', (e) => {
    const cli = e.target.closest('.cli'); if (!cli) return;
    if (e.target.closest('[data-a="editar"]')) { abrirCliente(S.clientes.find(c => c.clave === cli.dataset.k)); return; }
    if (e.target.closest('a')) return;
    if (!e.target.closest('.cli-head')) return;
    const det = cli.querySelector('.cli-det'); det.hidden = !det.hidden;
    if (det.hidden) abiertos.delete(cli.dataset.k); else abiertos.add(cli.dataset.k);
  });

  // Ficha
  const MC = { c: null };
  (function llenarSelectsCumple() {
    $('#mc-dia').innerHTML = '<option value="">—</option>' + Array.from({ length: 31 }, (_, i) => `<option value="${String(i + 1).padStart(2, '0')}">${i + 1}</option>`).join('');
    $('#mc-mes').innerHTML = '<option value="">—</option>' + KB.MESES.map((m, i) => `<option value="${String(i + 1).padStart(2, '0')}">${m}</option>`).join('');
  })();
  function abrirCliente(c) {
    MC.c = c || null;
    $('#mc-titulo').textContent = c ? 'Ficha de la clienta' : 'Agregar clienta';
    $('#mc-nombre').value = c ? c.nombre : '';
    $('#mc-telefono').value = c ? c.telefono : '';
    const [mm, dd] = (c && c.cumple ? c.cumple : '-').split('-');
    $('#mc-mes').value = mm || ''; $('#mc-dia').value = dd || '';
    $('#mc-acepta').checked = !!(c && c.acepta);
    $('#mc-nota').value = c ? (c.nota || '') : '';
    $('#mc-borrar').hidden = !c;
    $('#modal-cli').hidden = false;
  }
  function cerrarCliente() { $('#modal-cli').hidden = true; MC.c = null; }
  $('#cli-nueva').addEventListener('click', () => abrirCliente(null));
  $('#mc-cerrar').addEventListener('click', cerrarCliente);
  $('#mc-cancelar').addEventListener('click', cerrarCliente);
  $('#modal-cli').addEventListener('click', (e) => { if (e.target === $('#modal-cli')) cerrarCliente(); });
  $('#mc-guardar').addEventListener('click', async () => {
    const nombre = $('#mc-nombre').value.trim(), telefono = $('#mc-telefono').value.trim();
    if (!nombre) { toast('Falta el nombre', true); return; }
    const dia = $('#mc-dia').value, mes = $('#mc-mes').value;
    if ((dia && !mes) || (!dia && mes)) { toast('Para el cumpleaños completá el día y el mes', true); return; }
    const acepta = $('#mc-acepta').checked;
    if (acepta && !KB.telClave(telefono)) { toast('Para mandarle ofertas hace falta el teléfono', true); return; }
    // Una clienta que ya existe conserva su clave (así sigue unida a sus pedidos)
    const clave = MC.c ? MC.c.clave : KB.claveCliente({ nombre, telefono });
    if (!clave) { toast('No se pudo armar la ficha con esos datos', true); return; }
    if (!MC.c && S.clientes.some(c => c.clave === clave)) { toast('Esa clienta ya está en la lista', true); return; }
    const btn = $('#mc-guardar'); btn.disabled = true;
    try {
      await db.collection('clientes').doc(clave).set({
        nombre, telefono, cumple: dia && mes ? `${mes}-${dia}` : '', acepta, nota: $('#mc-nota').value.trim(), actualizadoEn: ahoraISO()
      }, { merge: true });
      toast('Ficha guardada 💖'); cerrarCliente();
    } catch (ex) { toast('No se pudo guardar: ' + ex.message, true); }
    finally { btn.disabled = false; }
  });
  // Borrado a pedido de la clienta: se va la ficha y sus pedidos quedan sin nombre ni teléfono
  $('#mc-borrar').addEventListener('click', async () => {
    const c = MC.c; if (!c) return;
    if (!confirm(`¿Borrar los datos de «${c.nombre || 'esta clienta'}»? Se elimina su ficha y sus ${c.pedidos.length} pedido(s) quedan sin nombre ni teléfono. No se puede deshacer.`)) return;
    try {
      for (let i = 0; i < c.pedidos.length; i += 400) {
        const batch = db.batch();
        c.pedidos.slice(i, i + 400).forEach(p => batch.update(db.collection('pedidos').doc(p.id), { cliente: { nombre: '(datos borrados)', telefono: '', acepta: false, borrado: true }, actualizadoEn: ahoraISO() }));
        await batch.commit();
      }
      await db.collection('clientes').doc(c.clave).delete();
      abiertos.delete(c.clave);
      toast('Datos borrados'); cerrarCliente();
    } catch (ex) { toast('No se pudo borrar: ' + ex.message, true); }
  });

  /* ============================================================
     NOVEDADES (cursos, tips, lanzamientos)
     ============================================================ */
  const urlNov = (n) => n.imgV ? `https://firebasestorage.googleapis.com/v0/b/${cfg.storageBucket}/o/${encodeURIComponent(rutaFoto('nov_' + n.id))}?alt=media&v=${n.imgV}` : null;
  async function guardarNovedades(items) {
    await db.collection('config').doc('novedades').set({ items, actualizadoEn: ahoraISO() });
    programarPublicacion();
  }
  function renderNovedades() {
    const cont = $('#nov-lista'); if (!cont) return;
    if (!S.novedades.length) { cont.innerHTML = '<div class="vacio">Todavía no hay novedades. Cargá el próximo curso o un tip y aparece en la web.</div>'; return; }
    cont.innerHTML = S.novedades.map((n, i) => `<div class="nov-row" data-id="${esc(n.id)}">
      <span class="chip">${esc(n.tipo || 'Novedad')}</span>
      <span class="tit">${esc(n.titulo)}<small>${esc(n.fecha || '')}${n.imgV ? ' · con foto' : ''}</small></span>
      <button class="sw ${n.visible !== false ? 'on' : ''}" data-a="visible" title="Mostrar / ocultar en la web"></button>
      <button class="btn-ic" data-a="subir" title="Subir" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button class="btn-ic" data-a="bajar" title="Bajar" ${i === S.novedades.length - 1 ? 'disabled' : ''}>↓</button>
      <button class="btn-ic" data-a="editar" title="Editar">✎</button>
    </div>`).join('');
  }
  $('#nov-lista').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const id = b.closest('.nov-row').dataset.id;
    const i = S.novedades.findIndex(n => n.id === id); if (i < 0) return;
    if (b.dataset.a === 'editar') { abrirNovedad(S.novedades[i]); return; }
    const items = S.novedades.map(n => ({ ...n }));
    if (b.dataset.a === 'visible') items[i].visible = items[i].visible === false;
    if (b.dataset.a === 'subir' && i > 0) [items[i - 1], items[i]] = [items[i], items[i - 1]];
    if (b.dataset.a === 'bajar' && i < items.length - 1) [items[i + 1], items[i]] = [items[i], items[i + 1]];
    try { await guardarNovedades(items); } catch (ex) { toast('No se pudo guardar: ' + ex.message, true); }
  });
  const MN = { n: null, fotoNueva: null, quitarFoto: false };
  function pintarFotoNov(url) {
    $('#mn-foto-prev').innerHTML = url ? `<img src="${esc(url)}" alt="" data-ph="📰">` : '📰';
    $('#mn-foto-quitar').hidden = !url;
  }
  function abrirNovedad(n) {
    MN.n = n || null; MN.fotoNueva = null; MN.quitarFoto = false;
    $('#mn-titulo-modal').textContent = n ? 'Editar novedad' : 'Nueva novedad';
    $('#mn-tipo').value = n ? (n.tipo || 'Novedad') : 'Curso';
    $('#mn-fecha').value = n ? (n.fecha || '') : '';
    $('#mn-titulo').value = n ? n.titulo : '';
    $('#mn-texto').value = n ? (n.texto || '') : '';
    $('#mn-boton').value = n ? (n.boton || '') : '';
    $('#mn-visible').checked = n ? n.visible !== false : true;
    $('#mn-eliminar').hidden = !n;
    $('#mn-foto-estado').textContent = '';
    pintarFotoNov(n ? urlNov(n) : null);
    $('#modal-nov').hidden = false;
  }
  function cerrarNovedad() { $('#modal-nov').hidden = true; MN.n = null; MN.fotoNueva = null; }
  $('#nov-nueva').addEventListener('click', () => abrirNovedad(null));
  $('#mn-cerrar').addEventListener('click', cerrarNovedad);
  $('#mn-cancelar').addEventListener('click', cerrarNovedad);
  $('#modal-nov').addEventListener('click', (e) => { if (e.target === $('#modal-nov')) cerrarNovedad(); });
  $('#mn-foto').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    $('#mn-foto-estado').textContent = 'Procesando la foto…';
    try {
      MN.fotoNueva = await procesarImagen(f, 1200); MN.quitarFoto = false;
      pintarFotoNov(URL.createObjectURL(MN.fotoNueva));
      $('#mn-foto-estado').textContent = `Lista para subir (${Math.round(MN.fotoNueva.size / 1024)} KB). Se sube al guardar.`;
    } catch (ex) { console.error(ex); $('#mn-foto-estado').textContent = 'No se pudo procesar esa imagen.'; }
    e.target.value = '';
  });
  $('#mn-foto-quitar').addEventListener('click', () => { MN.fotoNueva = null; MN.quitarFoto = true; pintarFotoNov(null); $('#mn-foto-estado').textContent = 'La foto se quita al guardar.'; });
  $('#mn-guardar').addEventListener('click', async () => {
    const titulo = $('#mn-titulo').value.trim();
    if (!titulo) { toast('Falta el título', true); return; }
    const btn = $('#mn-guardar'); btn.disabled = true;
    try {
      const previa = MN.n;
      const n = {
        id: previa ? previa.id : 'n' + Date.now().toString(36),
        tipo: $('#mn-tipo').value, fecha: $('#mn-fecha').value.trim(), titulo,
        texto: $('#mn-texto').value.trim(), boton: $('#mn-boton').value.trim(),
        visible: $('#mn-visible').checked, imgV: previa ? (previa.imgV || null) : null
      };
      if (MN.quitarFoto && n.imgV) { await borrarFoto('nov_' + n.id); n.imgV = null; }
      if (MN.fotoNueva) n.imgV = await subirFoto('nov_' + n.id, MN.fotoNueva);
      const items = previa ? S.novedades.map(x => x.id === n.id ? n : x) : [n, ...S.novedades];
      await guardarNovedades(items);
      toast('Novedad guardada 💖'); cerrarNovedad();
    } catch (ex) { console.error(ex); toast('No se pudo guardar: ' + ex.message, true); }
    finally { btn.disabled = false; }
  });
  $('#mn-eliminar').addEventListener('click', async () => {
    const n = MN.n; if (!n) return;
    if (!confirm(`¿Eliminar «${n.titulo}»?`)) return;
    try {
      if (n.imgV) await borrarFoto('nov_' + n.id);
      await guardarNovedades(S.novedades.filter(x => x.id !== n.id));
      toast('Novedad eliminada'); cerrarNovedad();
    } catch (ex) { toast('No se pudo eliminar: ' + ex.message, true); }
  });
})();
