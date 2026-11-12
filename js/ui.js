/* ============================================
   UI
   ============================================ */
const UI = (() => {
  // Historial de navegación: rastrear de qué vista venimos para botones "volver"
  let currentView = 'today';
  const navHistory = [];
  // Posición de scroll de cada vista (solo en memoria), para volver al mismo lugar
  const scrollPos = {};

  function saveScroll() {
    // Con el fondo bloqueado (modal/sheet abierto) la posición real es la guardada
    if (currentView) scrollPos[currentView] = lockedY !== null ? lockedY : window.scrollY;
  }

  // Navegar a una vista. Hacia adelante empieza arriba; con { restore: true }
  // (goBack y barra inferior) vuelve a la posición guardada de esa vista.
  function go(view, opts = {}) {
    if (!opts.skipSave) saveScroll();
    // Navegar libera el bloqueo del fondo sin restaurar (la vista nueva decide su scroll)
    unlockScroll(false);
    // Al navegar, cerrar cualquier sheet a pantalla completa abierto
    document.querySelectorAll('.sheet').forEach(s => { s.hidden = true; });
    // Guardar la vista anterior en el historial (excepto si es la misma)
    if (currentView && currentView !== view) {
      navHistory.push(currentView);
      // Limitar el historial a 10 entradas para evitar crecimiento infinito
      if (navHistory.length > 10) navHistory.shift();
    }
    currentView = view;

    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const t = document.getElementById('view-' + view);
    if (t) t.classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.go === view);
    });
    const target = opts.restore ? (scrollPos[view] || 0) : 0;
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (view === 'settings' && typeof App !== 'undefined' && App.renderStorageUsage) {
      App.renderStorageUsage();
    }
    if (view === 'finance-settings' && typeof Finance !== 'undefined' && Finance.render) {
      Finance.render();
    }
    // Renderizar estadísticas (heatmap, ring, mood) al entrar a la vista de stats
    if (view === 'stats' && typeof Stats !== 'undefined') {
      Stats.render();
    }
    // Renderizar listas de gestión al entrar
    if (view === 'habits-manage' && typeof Habits !== 'undefined') {
      Habits.renderFull();
    }
    if (view === 'tasks-manage' && typeof Tasks !== 'undefined') {
      Tasks.renderFull();
    }
    if (view === 'goals-manage' && typeof Goals !== 'undefined') {
      Goals.renderAll();
    }
    // Al volver a Enfoque, refrescar solo el panel activo
    if (view === 'today' && typeof App !== 'undefined' && App.renderFocusTab) {
      App.renderFocusTab();
    }
    if (typeof Animate !== 'undefined') Animate.enter(t);
    // Restaurar tras el render (sin animación de scroll); se repite tras dos
    // frames por si el alto final de la vista se termina de calcular después.
    if (target > 0) {
      window.scrollTo({ top: target, behavior: 'instant' });
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (currentView === view) window.scrollTo({ top: target, behavior: 'instant' });
      }));
    }
  }

  // Vuelve a la vista anterior. Si no hay historial, va a 'today'.
  function goBack(fallback = 'today') {
    const prev = navHistory.pop();
    const target = prev || fallback;
    saveScroll();
    // Evitar registrar este goBack como nueva entrada en el historial
    currentView = null;
    go(target, { restore: true, skipSave: true });
  }

  let toastTO;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTO);
    toastTO = setTimeout(() => el.classList.remove('show'), 2200);
  }

  let modalSave = null;
  // Tres tipos de modal (mismos botones: alto, padding, tipografía y radio):
  //  · Formulario (por defecto): "Cancelar" (secundario) + acción (primario), 50/50.
  //  · Confirmación (confirm2): "Cancelar" + acción (primario o peligro si danger).
  //  · Solo lectura (single: true): un solo botón "Cerrar" de ancho completo.
  function openModal({ title, bodyHTML, onSave, okText = 'Guardar', cancelText = 'Cancelar', single = false, danger = false }) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHTML;
    const okBtn = document.getElementById('modal-ok');
    const cancelBtn = document.getElementById('modal-cancel');
    okBtn.textContent = single ? 'Cerrar' : okText;
    okBtn.style.background = '';
    okBtn.style.color = '';
    okBtn.classList.toggle('is-close', single);
    okBtn.classList.toggle('is-danger', !single && danger);
    cancelBtn.textContent = cancelText;
    cancelBtn.hidden = single;
    document.querySelector('#modal .modal-actions').classList.toggle('single', single);
    document.getElementById('modal-body').scrollTop = 0;
    syncViewport();
    lockScroll();
    document.getElementById('modal-backdrop').hidden = false;
    modalSave = single ? (onSave || (() => true)) : onSave;
  }
  function closeModal() {
    clearTimeout(focusTO);
    document.getElementById('modal-backdrop').hidden = true;
    modalSave = null;
    syncScrollLock();
  }

  // ====== BLOQUEO DEL FONDO (modales y sheets) ======
  // Mientras hay un modal o sheet abierto el body queda fijo en su posición, así
  // Safari no desplaza la página de fondo al enfocar un campo. Al cerrar el
  // último, se restaura la posición exacta sin animación.
  let lockedY = null;
  function anyOverlayOpen() {
    const bd = document.getElementById('modal-backdrop');
    return (bd && !bd.hidden) || [...document.querySelectorAll('.sheet')].some(s => !s.hidden);
  }
  function lockScroll() {
    if (lockedY !== null) return;
    lockedY = window.scrollY;
    Object.assign(document.body.style, { position: 'fixed', top: `-${lockedY}px`, left: '0', right: '0', width: '100%', overflow: 'hidden' });
  }
  function unlockScroll(restore = true) {
    if (lockedY === null) return;
    const y = lockedY;
    lockedY = null;
    Object.assign(document.body.style, { position: '', top: '', left: '', right: '', width: '', overflow: '' });
    if (restore) window.scrollTo({ top: y, left: 0, behavior: 'instant' });
  }
  function syncScrollLock() {
    if (anyOverlayOpen()) lockScroll(); else unlockScroll();
  }
  // Apertura/cierre de sheets a pantalla completa (mismo bloqueo que los modales)
  function openSheet(id) {
    const s = document.getElementById(id);
    if (!s) return;
    syncViewport();
    lockScroll();
    s.hidden = false;
  }
  function closeSheet(sheet) {
    const s = typeof sheet === 'string' ? document.getElementById(sheet) : sheet;
    if (!s) return;
    s.hidden = true;
    syncScrollLock();
  }

  // ====== VIEWPORT VISIBLE (iPhone: barras de Safari y teclado) ======
  // --vvh / --vv-top = alto y desplazamiento del área realmente visible. Modales,
  // sheets y overlays se ajustan a ella, así el pie queda sobre el teclado.
  function syncViewport() {
    const vv = window.visualViewport;
    const root = document.documentElement;
    if (!vv) return;
    root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
    root.style.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`);
    // Teclado abierto: el área visible es bastante más baja que la ventana
    root.classList.toggle('kb-open', window.innerHeight - vv.height > 120);
  }

  // Desplaza SOLO el cuerpo del modal (único con scroll; nunca la página) para dejar
  // `el` a la vista. 'nearest' (o 'end'): no hace nada si ya se ve completo; si no,
  // mueve lo mínimo para que quede sobre el pie. 'center': lo centra.
  function revealInModal(el, block = 'nearest') {
    const body = document.getElementById('modal-body');
    if (!el || !body || !body.contains(el)) return;
    const b = body.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const pad = 16;
    let delta = 0;
    if (block === 'center') delta = (r.top + r.height / 2) - (b.top + b.height / 2);
    else if (r.bottom > b.bottom - pad) delta = r.bottom - (b.bottom - pad);
    else if (r.top < b.top + pad) delta = r.top - (b.top + pad);
    if (delta) body.scrollTop += delta;
  }
  const isField = el => el && el.matches && el.matches('input:not([type="checkbox"]):not([type="radio"]), textarea, select');

  // Una sola actualización por frame en resize/scroll del visualViewport, sin
  // transiciones: el modal queda anclado al borde inferior del área visible
  // (encima del teclado). Después, si el campo enfocado quedó tapado, se ajusta
  // solo el scroll del cuerpo del modal.
  let vvRaf = 0;
  let focusTO = 0;
  function ensureFocusedVisible() {
    const a = document.activeElement;
    const bd = document.getElementById('modal-backdrop');
    if (bd && !bd.hidden && isField(a)) revealInModal(a, 'nearest');
  }
  function scheduleViewport() {
    if (vvRaf) return;
    vvRaf = requestAnimationFrame(() => {
      vvRaf = 0;
      syncViewport();
      ensureFocusedVisible();
    });
  }

  // Confirmación visual (en lugar de confirm() del navegador)
  function confirm2({ title, message, okText = 'Confirmar', cancelText = 'Cancelar', danger = false, onConfirm }) {
    openModal({
      title,
      bodyHTML: `<p style="color:var(--text-dim);font-size:14px;line-height:1.5">${message}</p>`,
      okText, cancelText, danger,
      onSave: () => { onConfirm(); }
    });
  }

  function todayKey() {
    // Devolver fecha local (no UTC) para evitar bugs de zona horaria
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  // Helper: convierte cualquier objeto Date a string YYYY-MM-DD usando hora local
  function localDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }
  function weekKey(date = new Date()) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dn = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dn);
    const ys = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const wn = Math.ceil((((d - ys) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(wn).padStart(2, '0')}`;
  }
  function monthKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
  }
  function quarterKey(date = new Date()) {
    return `${date.getFullYear()}-Q${Math.floor(date.getMonth()/3)+1}`;
  }
  function yearKey(date = new Date()) {
    return String(date.getFullYear());
  }
  function formatDate(date = new Date()) {
    return date.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
  }
  function formatDateLong(date = new Date()) {
    return date.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  function getDayOfWeek(date = new Date()) { return date.getDay(); }
  function buzz(ms = 10) { if (navigator.vibrate) navigator.vibrate(ms); }

  document.addEventListener('click', (e) => {
    const back = e.target.closest('[data-back]');
    if (back) {
      goBack();
      return;
    }
    const b = e.target.closest('[data-go]');
    if (b) {
      // Barra inferior (Enfoque ↔ Estadísticas): recuerda la posición de cada una
      go(b.dataset.go, { restore: b.classList.contains('nav-btn') });
      return;
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    syncViewport();
    const vv = window.visualViewport;
    // Teclado, barras de Safari o rotación: reajustar una vez por frame
    if (vv) { vv.addEventListener('resize', scheduleViewport); vv.addEventListener('scroll', scheduleViewport); }
    window.addEventListener('resize', scheduleViewport);
    window.addEventListener('orientationchange', scheduleViewport);
    // Al enfocar un campo del modal: esperar a que el teclado termine de cambiar el
    // área visible (su resize ya llama a ensureFocusedVisible) y, como respaldo,
    // revisar tras un instante. Si el campo ya se ve, no se mueve nada.
    document.getElementById('modal-body').addEventListener('focusin', (e) => {
      if (!isField(e.target)) return;
      clearTimeout(focusTO);
      focusTO = setTimeout(ensureFocusedVisible, 350);
    });

    document.getElementById('modal-backdrop').addEventListener('click', (e) => {
      if (e.target.id === 'modal-backdrop') closeModal();
    });
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-ok').addEventListener('click', () => {
      if (!modalSave) return closeModal();
      const r = modalSave();
      if (r !== false) closeModal();
    });
  });

  return { go, goBack, toast, openModal, closeModal, confirm2, revealInModal, openSheet, closeSheet, todayKey, localDateKey, weekKey, monthKey, quarterKey, yearKey, formatDate, formatDateLong, getDayOfWeek, buzz };
})();
