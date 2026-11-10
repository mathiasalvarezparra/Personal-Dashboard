/* ============================================
   UI
   ============================================ */
const UI = (() => {
  // Historial de navegación: rastrear de qué vista venimos para botones "volver"
  let currentView = 'today';
  const navHistory = [];

  function go(view) {
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
    window.scrollTo({ top: 0, behavior: 'instant' });
    // Refrescar dashboard de finanzas al entrar
    if (view === 'finance' && typeof Finance !== 'undefined' && Finance.renderDashboard) {
      Finance.renderDashboard();
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
  }

  // Vuelve a la vista anterior. Si no hay historial, va a 'today'.
  function goBack(fallback = 'today') {
    const prev = navHistory.pop();
    const target = prev || fallback;
    // Evitar registrar este goBack como nueva entrada en el historial
    currentView = null;
    go(target);
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
  function openModal({ title, bodyHTML, onSave, okText = 'Guardar', cancelText = 'Cancelar' }) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHTML;
    const okBtn = document.getElementById('modal-ok');
    okBtn.textContent = okText;
    okBtn.style.background = '';
    okBtn.style.color = '';
    document.getElementById('modal-cancel').textContent = cancelText;
    document.getElementById('modal-backdrop').hidden = false;
    modalSave = onSave;
  }
  function closeModal() {
    document.getElementById('modal-backdrop').hidden = true;
    modalSave = null;
  }

  // Confirmación visual (en lugar de confirm() del navegador)
  function confirm2({ title, message, okText = 'Confirmar', cancelText = 'Cancelar', danger = false, onConfirm }) {
    openModal({
      title,
      bodyHTML: `<p style="color:var(--text-dim);font-size:14px;line-height:1.5">${message}</p>`,
      okText, cancelText,
      onSave: () => { onConfirm(); }
    });
    if (danger) {
      setTimeout(() => {
        const btn = document.getElementById('modal-ok');
        btn.style.background = 'var(--accent-red)';
        btn.style.color = 'white';
      }, 30);
    }
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
      go(b.dataset.go);
      return;
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
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

  return { go, goBack, toast, openModal, closeModal, confirm2, todayKey, localDateKey, weekKey, monthKey, quarterKey, yearKey, formatDate, formatDateLong, getDayOfWeek, buzz };
})();
