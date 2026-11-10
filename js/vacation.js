/* ============================================
   VACATION MODE
   ============================================ */
const Vacation = (() => {
  function isActive(date = new Date()) {
    const v = Storage.get().settings.vacation;
    if (!v || !v.start || !v.end) return false;
    const key = UI.localDateKey(date);
    return key >= v.start && key <= v.end;
  }

  function get() {
    return Storage.get().settings.vacation;
  }

  function set(start, end) {
    Storage.get().settings.vacation = { start, end, createdAt: Date.now() };
    Storage.save();
  }

  function clear() {
    Storage.get().settings.vacation = null;
    Storage.save();
  }

  function isDateInVacation(dateKey) {
    const v = Storage.get().settings.vacation;
    if (!v || !v.start || !v.end) return false;
    return dateKey >= v.start && dateKey <= v.end;
  }

  function renderBanner() {
    const slot = document.getElementById('vacation-banner-slot');
    if (!slot) return;
    if (!isActive()) { slot.innerHTML = ''; return; }
    const v = get();
    const fmt = (d) => new Date(d + 'T12:00:00').toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
    const today = new Date();
    const endDate = new Date(v.end + 'T23:59:59');
    const daysLeft = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
    slot.innerHTML = `
      <div class="vacation-banner">
        <span class="vacation-icon">🏖️</span>
        <div class="vacation-body">
          <div class="vacation-title">Modo vacaciones activo</div>
          <div class="vacation-msg">${fmt(v.start)} → ${fmt(v.end)} · ${daysLeft} día${daysLeft !== 1 ? 's' : ''} restante${daysLeft !== 1 ? 's' : ''}</div>
        </div>
        <button class="vacation-end-btn" id="vacation-end-now-btn">Terminar</button>
      </div>
    `;
    document.getElementById('vacation-end-now-btn').addEventListener('click', () => {
      UI.confirm2({
        title: '🏖️ Terminar vacaciones',
        message: '¿Quieres terminar el modo vacaciones ahora? Tus hábitos volverán a aparecer en "Enfoque".',
        okText: 'Terminar',
        onConfirm: () => {
          clear();
          UI.toast('Modo vacaciones terminado');
          App.refreshAll();
        }
      });
    });
  }

  function renderStatus() {
    const el = document.getElementById('vacation-status');
    if (!el) return;
    const v = get();
    if (!v) { el.innerHTML = ''; return; }
    const fmt = (d) => new Date(d + 'T12:00:00').toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
    const isCurrent = isActive();
    const status = isCurrent ? '✅ Activo' : '⏳ Programado';
    el.innerHTML = `
      <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-dim);margin:8px 0;text-transform:uppercase;letter-spacing:0.5px">
        ${status}: ${fmt(v.start)} → ${fmt(v.end)}
      </div>
    `;
  }

  function openModal() {
    const v = get();
    const today = UI.todayKey();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 7);
    const defaultEnd = UI.localDateKey(tomorrow);
    UI.openModal({
      title: '🏖️ Modo vacaciones',
      okText: v ? 'Actualizar' : 'Activar',
      bodyHTML: `
        <p style="color:var(--text-dim);font-size:13px;margin-bottom:14px;line-height:1.4">Define un rango de fechas. Durante ese tiempo, tus hábitos no aparecerán en "Enfoque" y los días dentro del rango no romperán rachas.</p>
        <label>Fecha de inicio</label>
        <input type="date" id="vac-start" value="${v ? v.start : today}" />
        <label>Fecha de fin</label>
        <input type="date" id="vac-end" value="${v ? v.end : defaultEnd}" />
        ${v ? `<button class="btn-danger" id="vac-cancel-btn" style="margin-top:14px">Cancelar vacaciones programadas</button>` : ''}
      `,
      onSave: () => {
        const start = document.getElementById('vac-start').value;
        const end = document.getElementById('vac-end').value;
        if (!start || !end) { UI.toast('Faltan fechas'); return false; }
        if (end < start) { UI.toast('La fecha de fin debe ser después del inicio'); return false; }
        set(start, end);
        UI.toast('Modo vacaciones configurado');
        App.refreshAll();
      }
    });
    setTimeout(() => {
      const cancelBtn = document.getElementById('vac-cancel-btn');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
          clear();
          UI.closeModal();
          UI.toast('Vacaciones canceladas');
          App.refreshAll();
        });
      }
    }, 50);
  }

  return { isActive, isDateInVacation, get, set, clear, renderBanner, renderStatus, openModal };
})();
