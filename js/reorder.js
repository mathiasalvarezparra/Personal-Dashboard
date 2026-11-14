/* ============================================
   REORDER — modo ordenar reutilizable
   ============================================
   Uso:
     // 1) Activador: mantener presionado (500 ms sin moverse más de 8 px)
     Reorder.onLongPress(root, '.selector', (el, e) => { ... });
     // 2) Modo ordenar sobre una lista
     Reorder.enable({
       container,                       // elemento cuyo contenido se reemplaza por filas compactas
       items: [{ id, label, icon }],    // en el orden actual
       groupBy: item => 'clave',        // opcional: solo se reordena dentro de cada grupo
       groupLabels: { clave: 'Título' },// opcional: encabezado de cada grupo
       onSave: ids => { ... },          // al tocar "Listo": ids en el nuevo orden
     });
   Solo "Listo" sale del modo (tocar fuera no cancela). Fuera del modo, el scroll y
   los toques funcionan igual que siempre.
*/
const Reorder = (() => {
  const HOLD_MS = 500;   // tiempo de presión para activar
  const MOVE_TOL = 8;    // px de tolerancia: si el dedo se mueve más, es scroll
  const EDGE = 72;       // px desde el borde de la pantalla en que empieza el auto-scroll
  let session = null;    // { container, wrap, doneBtn, onSave }

  // ---------- Mantener presionado ----------
  // Delegado: sirve para elementos que se vuelven a renderizar (innerHTML).
  function onLongPress(root, selector, handler, opts = {}) {
    if (!root) return () => {};
    let timer = 0, start = null, target = null;
    const cancel = () => { clearTimeout(timer); timer = 0; start = null; target = null; };
    const down = e => {
      if (session || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const el = e.target.closest(selector);
      if (!el || !root.contains(el) || (opts.accept && !opts.accept(el, e))) return;
      start = { x: e.clientX, y: e.clientY };
      target = el;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const el2 = target;
        cancel();
        if (!el2 || session) return;
        suppressNextClick();
        el2.classList.add('ro-press');
        setTimeout(() => el2.classList.remove('ro-press'), 260);
        handler(el2, e);
      }, opts.delay || HOLD_MS);
    };
    const move = e => {
      if (!start) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_TOL) cancel();
    };
    root.addEventListener('pointerdown', down);
    root.addEventListener('pointermove', move);
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => root.addEventListener(t, cancel));
    window.addEventListener('scroll', cancel, { passive: true });
    // Sin menú contextual / de copiar al mantener presionado
    root.addEventListener('contextmenu', e => { if (e.target.closest(selector)) e.preventDefault(); });
    return () => {
      root.removeEventListener('pointerdown', down);
      root.removeEventListener('pointermove', move);
      window.removeEventListener('scroll', cancel);
    };
  }
  // El toque que activó el modo no debe abrir nada (detalle, pestaña, etc.)
  function suppressNextClick() {
    const stop = e => { e.stopPropagation(); e.preventDefault(); };
    document.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => document.removeEventListener('click', stop, { capture: true }), 700);
  }

  // ---------- Modo ordenar ----------
  function isActive(el) {
    return !!session && (!el || session.container === el || session.container.contains(el));
  }

  function enable({ container, items, groupBy = null, groupLabels = {}, onSave }) {
    if (!container || session) return;
    const groups = [];
    const byGroup = new Map();
    items.forEach(it => {
      const g = groupBy ? groupBy(it) : '_';
      if (!byGroup.has(g)) { byGroup.set(g, []); groups.push(g); }
      byGroup.get(g).push(it);
    });

    const wrap = document.createElement('div');
    wrap.className = 'ro-wrap';
    wrap.innerHTML = groups.map(g => `
      ${groupBy && groupLabels[g] ? `<div class="ro-group-label">${escapeHtml(groupLabels[g])}</div>` : ''}
      <div class="ro-group" data-ro-group="${escapeAttr(g)}">
        ${byGroup.get(g).map(it => `
        <div class="ro-row" data-ro-id="${escapeAttr(it.id)}">
          <span class="ro-handle" aria-label="Arrastrar para mover" role="button">≡</span>
          ${it.icon ? `<span class="ro-icon">${escapeHtml(it.icon)}</span>` : ''}
          <span class="ro-label">${escapeHtml(it.label)}</span>
          <button type="button" class="ro-btn" data-ro-move="-1" aria-label="Subir">↑</button>
          <button type="button" class="ro-btn" data-ro-move="1" aria-label="Bajar">↓</button>
        </div>`).join('')}
      </div>`).join('');

    // El contenido normal se oculta (no se destruye) mientras dura el modo
    [...container.children].forEach(ch => { ch.dataset.roHidden = ch.hidden ? 'keep' : '1'; ch.hidden = true; });
    container.appendChild(wrap);
    container.classList.add('ro-on');

    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = 'ro-done btn-primary';
    doneBtn.textContent = 'Listo';
    document.body.appendChild(doneBtn);
    document.body.classList.add('ro-active');

    session = { container, wrap, doneBtn, onSave };
    refreshButtons();
    wrap.addEventListener('click', onWrapClick);
    wrap.addEventListener('pointerdown', onHandleDown);
    doneBtn.addEventListener('click', finish);

    // Que la lista compacta quede a la vista (sin animación de scroll)
    const top = wrap.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.6) {
      window.scrollTo({ top: Math.max(0, window.scrollY + top - 96), behavior: 'instant' });
    }
  }

  function finish() {
    if (!session) return;
    const { container, wrap, doneBtn, onSave } = session;
    const ids = [...wrap.querySelectorAll('.ro-row')].map(r => r.dataset.roId);
    wrap.remove();
    doneBtn.remove();
    container.classList.remove('ro-on');
    [...container.children].forEach(ch => {
      if (ch.dataset.roHidden === '1') ch.hidden = false;
      delete ch.dataset.roHidden;
    });
    document.body.classList.remove('ro-active');
    session = null;
    if (onSave) onSave(ids);
  }

  // ↑ ↓ deshabilitados en los bordes de cada grupo
  function refreshButtons() {
    if (!session) return;
    session.wrap.querySelectorAll('.ro-group').forEach(g => {
      const rows = [...g.querySelectorAll('.ro-row')];
      rows.forEach((r, i) => {
        r.querySelector('[data-ro-move="-1"]').disabled = i === 0;
        r.querySelector('[data-ro-move="1"]').disabled = i === rows.length - 1;
      });
    });
  }

  function animateMove(group, mutate) {
    const rows = [...group.querySelectorAll('.ro-row:not(.ro-dragging)')];
    if (typeof Animate !== 'undefined' && Animate.flip) Animate.flip(rows, mutate);
    else mutate();
    refreshButtons();
  }

  function onWrapClick(e) {
    const btn = e.target.closest('[data-ro-move]');
    if (!btn || btn.disabled) return;
    const row = btn.closest('.ro-row');
    const group = row.parentElement;
    const dir = +btn.dataset.roMove;
    const sib = dir < 0 ? row.previousElementSibling : row.nextElementSibling;
    if (!sib) return;
    animateMove(group, () => {
      if (dir < 0) group.insertBefore(row, sib);
      else group.insertBefore(sib, row);
    });
  }

  // ---------- Arrastre desde ≡ (pointer events propios) ----------
  let drag = null;
  function onHandleDown(e) {
    const handle = e.target.closest('.ro-handle');
    if (!handle || drag) return;
    e.preventDefault();
    const row = handle.closest('.ro-row');
    const group = row.parentElement;
    const rect = row.getBoundingClientRect();
    const ph = document.createElement('div');
    ph.className = 'ro-placeholder';
    ph.style.height = `${rect.height}px`;
    group.insertBefore(ph, row);
    row.classList.add('ro-dragging');
    Object.assign(row.style, { position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px` });
    drag = { row, group, ph, pointerId: e.pointerId, offset: e.clientY - rect.top, y: e.clientY, raf: 0 };
    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* sin captura: igual funciona con window */ }
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragEnd);
    // La página no se desplaza mientras se arrastra (además de touch-action: none en ≡)
    document.addEventListener('touchmove', blockTouch, { passive: false });
    drag.raf = requestAnimationFrame(autoScroll);
  }
  const blockTouch = e => { if (drag) e.preventDefault(); };

  function placeRow() {
    const { row, group, ph, offset, y } = drag;
    const g = group.getBoundingClientRect();
    // La fila arrastrada no sale de su grupo
    const top = Math.min(Math.max(y - offset, g.top - 4), g.bottom - row.offsetHeight + 4);
    row.style.top = `${top}px`;
    const mid = top + row.offsetHeight / 2;
    const others = [...group.querySelectorAll('.ro-row:not(.ro-dragging)')];
    const before = others.find(r => { const rr = r.getBoundingClientRect(); return mid < rr.top + rr.height / 2; });
    const ref = before || null;
    if (ref ? ph.nextElementSibling !== ref : group.lastElementChild !== ph) {
      animateMove(group, () => group.insertBefore(ph, ref));
    }
  }
  function onDragMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.y = e.clientY;
    placeRow();
  }
  // Auto-scroll al acercarse a los bordes (la fila sigue al dedo)
  function autoScroll() {
    if (!drag) return;
    const nav = document.querySelector('.bottom-nav');
    const bottomLimit = window.innerHeight - (nav ? nav.offsetHeight : 0) - EDGE;
    let dy = 0;
    if (drag.y < EDGE) dy = -Math.ceil((EDGE - drag.y) / 6);
    else if (drag.y > bottomLimit) dy = Math.ceil((drag.y - bottomLimit) / 6);
    if (dy) { window.scrollBy(0, dy); placeRow(); }
    drag.raf = requestAnimationFrame(autoScroll);
  }
  function onDragEnd(e) {
    if (!drag || (e.pointerId != null && e.pointerId !== drag.pointerId)) return;
    const { row, group, ph, raf } = drag;
    cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragEnd);
    document.removeEventListener('touchmove', blockTouch);
    drag = null;
    // La fila "aterriza" suavemente en el lugar del marcador
    const land = () => {
      group.insertBefore(row, ph);
      ph.remove();
      row.classList.remove('ro-dragging');
      Object.assign(row.style, { position: '', left: '', top: '', width: '' });
    };
    if (typeof Animate !== 'undefined' && Animate.flip) Animate.flip([row], land);
    else land();
    refreshButtons();
  }

  return { onLongPress, enable, finish, isActive };
})();
