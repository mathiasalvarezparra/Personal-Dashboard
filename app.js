/* ============================================
   STORAGE
   ============================================ */
const Storage = (() => {
  const KEY = 'mi_dashboard_v1';
  const defaultState = {
    version: 1,
    user: { name: '' },
    settings: {
      theme: 'dark',
      lastBackup: null,
      backupReminderDismissed: null,
      onboarded: false,
      lastWeekKey: null,
      vacation: null, // { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' } o null
      pendingWeekClose: null, // weekKey de una semana terminada sin cerrar
    },
    areas: [
      { id: 'salud',       name: 'Salud',       icon: '💪', color: '#4ade80' },
      { id: 'finanzas',    name: 'Finanzas',    icon: '💰', color: '#f5c842' },
      { id: 'carrera',     name: 'Carrera',     icon: '🚀', color: '#60a5fa' },
      { id: 'crecimiento', name: 'Crecimiento', icon: '🧠', color: '#a78bfa' },
      { id: 'relaciones',  name: 'Relaciones',  icon: '❤️', color: '#ef4444' },
      { id: 'creatividad', name: 'Creatividad', icon: '🎨', color: '#f0abfc' },
      { id: 'hogar',       name: 'Hogar',       icon: '🏡', color: '#34d399' },
      { id: 'espiritualidad', name: 'Espiritualidad', icon: '🧘', color: '#818cf8' },
    ],
    habits: [],
    tasks: [],
    goals: [],
    focus: { week: '', updatedAt: null },
    closures: {},
    // Cierres de semana: { 'YYYY-Www': { worked, blocked, focus, savedAt } }
    weekClosures: {},
    // Snapshot de % logrado por día (para que el strip semanal mantenga el círculo de días pasados)
    // Formato: { 'YYYY-MM-DD': pct }
    dailySnapshots: {},
    // === FINANZAS ===
    // Gastos recurrentes configurados (luz, arriendo, basura, etc.)
    recurringExpenses: [],
    // Movimientos registrados (gastos pagados + ingresos)
    movements: [],
  };

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return structuredClone(defaultState);
      const parsed = JSON.parse(raw);
      const merged = { ...structuredClone(defaultState), ...parsed };
      // Merge settings un nivel para que las nuevas keys (lastMonthKey, etc.) no falten
      merged.settings = { ...structuredClone(defaultState.settings), ...(parsed.settings || {}) };
      // Garantizar que las estructuras nuevas existen
      if (!merged.dailySnapshots) merged.dailySnapshots = {};
      if (!merged.closures) merged.closures = {};
      if (!merged.weekClosures) merged.weekClosures = {};
      // Migración: todos los hábitos son cuantitativos por defecto (target=1, unit=sesión).
      // Para hábitos ya marcados hoy/historial, infiero dailyProgress[día] = dailyTarget.
      (merged.habits || []).forEach(h => {
        if (!h.dailyTarget || h.dailyTarget <= 0) {
          h.dailyTarget = 1;
          h.unit = h.unit || 'sesión';
        }
        h.dailyProgress = h.dailyProgress || {};
        // Si tiene history de días marcados pero no progreso, completarlo
        (h.history || []).forEach(dk => {
          if (h.dailyProgress[dk] == null) h.dailyProgress[dk] = h.dailyTarget;
        });
      });
      return merged;
    } catch (e) {
      console.error(e);
      return structuredClone(defaultState);
    }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { console.error(e); }
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mi-dashboard-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    state.settings.lastBackup = Date.now();
    save();
  }

  function importJSON(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          if (typeof data !== 'object' || !data.version) return rej(new Error('Inválido'));
          state = { ...structuredClone(defaultState), ...data };
          save(); res();
        } catch (err) { rej(err); }
      };
      r.onerror = () => rej(r.error);
      r.readAsText(file);
    });
  }

  function reset() { state = structuredClone(defaultState); save(); }
  // Reemplaza el estado completo (memoria + disco). Sin esto, cualquier save()
  // posterior sobrescribiría el estado nuevo con el viejo que sigue en memoria.
  function replace(next) { state = next; save(); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  return { get: () => state, save, exportJSON, importJSON, reset, replace, uid };
})();

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

/* ============================================
   HELPERS
   ============================================ */
// ¿El contenedor está realmente a la vista? (vista activa + panel activo)
// Evita repintar listas ocultas en cada interacción. Es seguro porque cada
// entrada a una vista/pestaña vuelve a renderizar su contenido.
function isLive(el) {
  if (!el) return false;
  // Dentro de un sheet a pantalla completa: vivo si el sheet está visible
  const sheet = el.closest('.sheet');
  if (sheet) return !sheet.hidden;
  const view = el.closest('.view');
  if (!view || !view.classList.contains('active')) return false;
  const panel = el.closest('.focus-panel, .stats-panel');
  return !panel || panel.classList.contains('active');
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s) { return String(s || '').replace(/"/g, '&quot;'); }

/* ============================================
   HABITS
   ============================================ */
const Habits = (() => {
  const TIME_LABELS = { 'mañana': '◐ MAÑANA', 'tarde': '◑ TARDE', 'noche': '◓ NOCHE' };
  const DAY_NAMES = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

  // Mover un hábito dentro de su grupo de timeOfDay
  // direction: -1 = arriba, +1 = abajo
  function moveHabit(id, direction) {
    const state = Storage.get();
    const habits = state.habits;
    const pos = habits.findIndex(h => h.id === id);
    if (pos === -1) return;
    const newPos = pos + direction;
    if (newPos < 0 || newPos >= habits.length) return;
    [habits[pos], habits[newPos]] = [habits[newPos], habits[pos]];
    Storage.save();
    renderOverview();
    renderFull();
    renderHeatmap();
    UI.buzz(8);
  }

  // Indica si el hábito se puede mover en esa dirección (para deshabilitar el botón en los extremos)
  function canMove(id, direction) {
    const habits = Storage.get().habits;
    const pos = habits.findIndex(h => h.id === id);
    if (pos === -1) return false;
    if (direction === -1) return pos > 0;
    if (direction === 1) return pos < habits.length - 1;
    return false;
  }

  function isHabitForToday(h) {
    return isHabitForDate(h, new Date());
  }

  function isHabitForDate(h, date) {
    const f = h.frequency || { type: 'daily' };
    if (f.type === 'daily') return true;
    if (f.type === 'days' && Array.isArray(f.days)) return f.days.includes(date.getDay());
    return true;
  }

  function isCompletedToday(h) { return h.history?.includes(UI.todayKey()); }

  // ====== HÁBITOS CUANTITATIVOS ======
  // Todos los hábitos son cuantitativos. Si no tienen dailyTarget explícito, se asume 1 sesión.
  function isQuant(h) { return true; }
  function getDailyTarget(h) { return (h.dailyTarget && h.dailyTarget > 0) ? h.dailyTarget : 1; }
  function getUnit(h) { return h.unit || 'sesión'; }

  // Progreso del día (cantidad acumulada hoy)
  function getDailyProgress(h, dateKey = UI.todayKey()) {
    return (h.dailyProgress && h.dailyProgress[dateKey]) || 0;
  }

  // % del hábito para un día dado (0-100): proporcional al dailyTarget
  function getHabitDayPct(h, dateKey = UI.todayKey()) {
    const cur = getDailyProgress(h, dateKey);
    return Math.min(100, Math.round((cur / getDailyTarget(h)) * 100));
  }

  // Suma una cantidad al progreso diario del hábito. Si llega al target, marca el día como hecho.
  // Si tiene meta vinculada (linkedGoalId), también suma a la meta.
  function addToHabitProgress(habitId, amount, dateKey = UI.todayKey(), note = null) {
    const state = Storage.get();
    const h = state.habits.find(x => x.id === habitId);
    if (!h || amount <= 0) return;

    // Validaciones de fecha
    const todayKey = UI.todayKey();
    if (dateKey > todayKey) { UI.toast('No puedes registrar días futuros'); return; }
    if (!isWithinRetroLimit(dateKey)) { UI.toast(`Solo puedes editar los últimos ${RETRO_DAYS_LIMIT} días`); return; }
    const dateObj = new Date(dateKey + 'T12:00:00');
    if (!isHabitForDate(h, dateObj)) { UI.toast('Este hábito no aplica este día'); return; }

    const target = getDailyTarget(h);

    h.dailyProgress = h.dailyProgress || {};
    h.dailyProgress[dateKey] = (h.dailyProgress[dateKey] || 0) + amount;
    if (note) {
      h.notes = h.notes || {};
      h.notes[dateKey] = note;
    }

    // ¿Llegó al target? → marcar como hecho
    const reached = h.dailyProgress[dateKey] >= target;
    h.history = h.history || [];
    if (reached && !h.history.includes(dateKey)) {
      h.history.push(dateKey);
      h._completedAt = h._completedAt || {};
      h._completedAt[dateKey] = Date.now();
      UI.buzz(20);
      UI.toast(`✓ ${h.name} completado`);
    }

    // Si tiene meta vinculada, también suma a la meta (propagando a padres)
    if (h.linkedGoalId) {
      const goal = findGoalForDate(h, dateKey);
      if (goal && goal.target && goal.target > 0) {
        // Usar Goals.updateCurrent para que propague recursivamente a padres (mensual → anual)
        Goals.updateCurrent(goal.id, (goal.current || 0) + amount);
        // Registrar contribución por trazabilidad
        h.contributions = h.contributions || {};
        h.contributions[dateKey] = (h.contributions[dateKey] || 0) + amount;
      }
    }

    Storage.save();
    renderOverview(); renderFull(); renderHeatmap(); App.refreshKPIs();
    Goals.renderAll(); Goals.renderWeeklyMini();
  }

  // Resta del progreso diario (para corregir errores)
  function subFromHabitProgress(habitId, amount, dateKey = UI.todayKey()) {
    const state = Storage.get();
    const h = state.habits.find(x => x.id === habitId);
    if (!h || amount <= 0) return;
    const target = getDailyTarget(h);
    h.dailyProgress = h.dailyProgress || {};
    const before = h.dailyProgress[dateKey] || 0;
    const wasReached = before >= target;
    h.dailyProgress[dateKey] = Math.max(0, before - amount);
    const after = h.dailyProgress[dateKey];
    const stillReached = after >= target;

    // Si ya no llega al target, desmarcar
    if (wasReached && !stillReached) {
      const i = h.history.indexOf(dateKey);
      if (i !== -1) h.history.splice(i, 1);
      if (h._completedAt) delete h._completedAt[dateKey];
    }

    // Restar también de la meta vinculada (propagando a padres)
    if (h.linkedGoalId) {
      const goal = findGoalForDate(h, dateKey);
      if (goal && goal.target && goal.target > 0) {
        const restado = before - after; // cantidad efectivamente restada
        Goals.updateCurrent(goal.id, Math.max(0, (goal.current || 0) - restado));
        if (h.contributions) h.contributions[dateKey] = Math.max(0, (h.contributions[dateKey] || 0) - restado);
      }
    }

    Storage.save();
    renderOverview(); renderFull(); renderHeatmap(); App.refreshKPIs();
    Goals.renderAll(); Goals.renderWeeklyMini();
  }

  function calcStreak(h) {
    if (!h.history || h.history.length === 0) return 0;
    const set = new Set(h.history);
    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = UI.localDateKey(today);

    for (let i = 0; i < 730; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = UI.localDateKey(d);
      const applies = isHabitForDate(h, d);

      if (!applies) {
        // Día que no aplica al hábito: no rompe la racha, no la suma
        continue;
      }

      // Si está dentro del rango de vacaciones, tampoco rompe ni suma
      if (Vacation.isDateInVacation(key)) {
        continue;
      }

      if (set.has(key)) {
        streak++;
      } else {
        if (key === todayKey) {
          // Hoy aún sin marcar: no rompe la racha
          continue;
        }
        break;
      }
    }
    return streak;
  }

  function maxStreakAcrossAll() {
    const state = Storage.get();
    let max = 0;
    state.habits.forEach(h => { const s = calcStreak(h); if (s > max) max = s; });
    return max;
  }

  // Cuántos días hacia atrás se permite editar
  const RETRO_DAYS_LIMIT = 7;

  // Devuelve el dateKey de hace N días
  function dateKeyDaysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return UI.localDateKey(d);
  }

  // Verifica si dateKey está dentro del rango editable retroactivamente
  function isWithinRetroLimit(dateKey) {
    const todayKey = UI.todayKey();
    if (dateKey === todayKey) return true;
    if (dateKey > todayKey) return false; // futuro no permitido
    // Verificar que no esté más allá del límite
    const oldestAllowed = dateKeyDaysAgo(RETRO_DAYS_LIMIT);
    return dateKey >= oldestAllowed;
  }

  /**
   * Marca o desmarca un hábito en una fecha específica.
   * Maneja: validaciones (aplicabilidad, límite retroactivo), confirmación de
   * romper racha, vinculación con metas del período correcto.
   */
  function toggleHabitOnDate(id, dateKey) {
    const state = Storage.get();
    const h = state.habits.find(x => x.id === id);
    if (!h) return;

    // Hábitos cuantitativos: el check no aplica, se registra con el modal
    if (isQuant(h)) {
      openQuantModal(id, dateKey);
      return;
    }

    h.history = h.history || [];

    // Validación: fecha futura
    const todayKey = UI.todayKey();
    if (dateKey > todayKey) {
      UI.toast('No puedes marcar días futuros');
      return;
    }
    // Validación: límite retroactivo
    if (!isWithinRetroLimit(dateKey)) {
      UI.toast(`Solo puedes editar los últimos ${RETRO_DAYS_LIMIT} días`);
      return;
    }
    // Validación: ¿aplica este día?
    const dateObj = new Date(dateKey + 'T12:00:00');
    if (!isHabitForDate(h, dateObj)) {
      UI.toast('Este hábito no aplica este día');
      return;
    }

    const i = h.history.indexOf(dateKey);

    // Si ya estaba marcado → desmarcar (con confirmación de racha)
    if (i !== -1) {
      const streak = calcStreak(h);
      const isRetro = dateKey !== todayKey;
      const dateLabel = dateObj.toLocaleDateString('es-CL', { weekday: 'long', day: '2-digit', month: 'long' });

      const doUnmark = () => {
        unlinkContribution(h, dateKey);
        h.history.splice(i, 1);
        if (h.notes) delete h.notes[dateKey];
        // Limpiar marca de completado y, si es cuantitativo, también el progreso del día
        if (h._completedAt) delete h._completedAt[dateKey];
        if (isQuant(h) && h.dailyProgress) delete h.dailyProgress[dateKey];
        Storage.save();
        renderOverview(); renderFull(); renderHeatmap(); App.refreshKPIs();
        Goals.renderAll(); Goals.renderWeeklyMini();
        UI.toast(isRetro ? `Desmarcado · ${dateLabel}` : 'Hábito desmarcado');
      };

      if (streak >= 3 && !isRetro) {
        // Solo pedir confirmación de racha para HOY (desmarcar pasado no afecta racha actual igual)
        UI.confirm2({
          title: '🔥 Romper racha',
          message: `Tienes una racha activa de <strong style="color:var(--accent-orange)">${streak} días</strong> en "<strong>${escapeHtml(h.name)}</strong>". ¿Seguro quieres desmarcar este hábito hoy?`,
          okText: 'Romper racha',
          cancelText: 'Mantener',
          danger: true,
          onConfirm: doUnmark,
        });
        return;
      }
      doUnmark();
      return;
    }

    // Marcar como cumplido: buscar meta del período correcto (si tiene vinculación)
    const linkedGoal = findGoalForDate(h, dateKey);
    if (linkedGoal && linkedGoal.target && linkedGoal.target > 0) {
      askQuantity(h, linkedGoal, dateKey);
      return;
    }
    askNote(h, dateKey);
  }

  function toggleToday(id) {
    toggleHabitOnDate(id, UI.todayKey());
  }

  // Modal para capturar nota opcional (sin cantidad)
  function askNote(habit, dateKey) {
    const todayKey = UI.todayKey();
    const isRetroactive = dateKey !== todayKey;
    const dateDate = new Date(dateKey + 'T12:00:00');
    const dateLabel = dateDate.toLocaleDateString('es-CL', { weekday: 'long', day: '2-digit', month: 'long' });
    const existingNote = habit.notes && habit.notes[dateKey] ? habit.notes[dateKey] : '';

    UI.openModal({
      title: `${habit.icon || '⭐'} ${habit.name}`,
      okText: 'Registrar',
      bodyHTML: `
        ${isRetroactive ? `<div class="retro-badge">📅 Registrando para: <strong>${dateLabel}</strong></div>` : ''}
        <p style="color:var(--text-dim);font-size:13px;margin-bottom:6px">${isRetroactive ? 'Marcar como cumplido ese día' : '¡Cumpliste este hábito hoy! 🎉'}</p>
        <div class="note-input-block">
          <label>Nota (opcional)</label>
          <textarea id="note-input" placeholder="¿Algo destacable? Ej: corrí 5 km en 28 min">${escapeHtml(existingNote)}</textarea>
        </div>
      `,
      onSave: () => {
        const note = document.getElementById('note-input').value.trim();
        if (!habit.history.includes(dateKey)) {
          habit.history.push(dateKey);
        }
        // Marca de tiempo de completado (para ordenar al final en Hoy)
        habit._completedAt = habit._completedAt || {};
        habit._completedAt[dateKey] = Date.now();
        if (note) {
          habit.notes = habit.notes || {};
          habit.notes[dateKey] = note;
        } else if (habit.notes) {
          delete habit.notes[dateKey];
        }
        UI.buzz(15);
        Storage.save();
        renderOverview(); renderFull(); renderHeatmap(); App.refreshKPIs();
        Goals.renderAll(); Goals.renderWeeklyMini();
      }
    });
    setTimeout(() => {
      const inp = document.getElementById('note-input');
      if (inp) inp.focus();
    }, 80);
  }

  // Devuelve la meta vinculada que estaba ACTIVA en el período al que pertenece dateKey.
  // Busca primero entre activas; si no, busca en archivadas cuyo período coincide.
  function findGoalForDate(habit, dateKey) {
    if (!habit.linkedGoalId) return null;
    const state = Storage.get();
    // Buscar la meta original (puede estar activa o archivada)
    const original = state.goals.find(g => g.id === habit.linkedGoalId);
    if (!original) return null;
    if (!original.archived) return original;

    // Si la meta original está archivada, buscar la meta correcta:
    // 1) Si pertenece al período de dateKey → es la archivada misma
    // 2) Si no, buscar otra meta con el mismo seriesId cuyo período coincida con dateKey
    const targetPeriod = periodKeyFromDate(original.horizon, dateKey);
    const goalPeriod = periodKeyFromDate(original.horizon, UI.localDateKey(new Date(original.createdAt)));
    if (goalPeriod === targetPeriod) return original;

    // Buscar entre todas las metas de la misma serie
    if (original.seriesId) {
      const sameSeries = state.goals.filter(g => g.seriesId === original.seriesId);
      for (const g of sameSeries) {
        const gPeriod = periodKeyFromDate(g.horizon, UI.localDateKey(new Date(g.createdAt)));
        if (gPeriod === targetPeriod) return g;
      }
    }
    return null;
  }

  // Helper: calcular periodKey desde un dateKey "YYYY-MM-DD"
  function periodKeyFromDate(horizon, dateKey) {
    const d = new Date(dateKey + 'T12:00:00');
    if (horizon === 'week') return UI.weekKey(d);
    if (horizon === 'month') return `${d.getFullYear()}-M${String(d.getMonth()+1).padStart(2,'0')}`;
    if (horizon === 'quarter') return `${d.getFullYear()}-Q${Math.floor(d.getMonth()/3)+1}`;
    if (horizon === 'year') return `${d.getFullYear()}`;
    return '';
  }

  // Después de modificar el current de una meta, recalcular si está done y
  // re-propagar al padre si cambió el estado done. Maneja tanto activas como archivadas.
  function recalcGoalAfterContribChange(goal) {
    if (!goal || !goal.target) return;
    const wasDone = goal.done;
    goal.done = goal.current >= goal.target;
    if (!goal.archived) return; // si está activa, propagateToParent ya se aplica via updateCurrent estándar

    // Si está archivada y tiene padre, hay que ajustar el aporte al padre
    if (goal.parentGoalId && goal.target > 0) {
      const state = Storage.get();
      const parent = state.goals.find(p => p.id === goal.parentGoalId);
      if (parent && parent.target) {
        const previouslyPropagated = goal.propagatedCurrent != null
          ? goal.propagatedCurrent
          : (wasDone ? goal.target : 0);
        const nowPropagated = goal.done ? goal.target : Math.max(0, goal.current || 0);
        const delta = nowPropagated - previouslyPropagated;
        if (delta !== 0) {
          parent.current = Math.max(0, (parent.current || 0) + delta);
          parent.done = parent.current >= parent.target;
        }
        goal.propagatedCurrent = nowPropagated;
      }
    }
  }

  // Restar aporte cuando se desmarca un hábito vinculado (busca meta del período correcto)
  function unlinkContribution(habit, dateKey) {
    if (!habit.linkedGoalId) return;
    if (!habit.contributions || !habit.contributions[dateKey]) return;
    const goal = findGoalForDate(habit, dateKey);
    if (!goal || !goal.target) {
      delete habit.contributions[dateKey];
      return;
    }
    const amount = habit.contributions[dateKey];
    Goals.updateCurrent(goal.id, Math.max(0, (goal.current || 0) - amount));
    delete habit.contributions[dateKey];
  }

  // Modal para capturar la cantidad y sumarla a la meta
  function askQuantity(habit, goal, dateKey) {
    const state = Storage.get();
    const remaining = Math.max(0, goal.target - (goal.current || 0));
    const defaultAmount = habit.defaultIncrement || Math.min(remaining, Math.ceil(goal.target / 7));
    const shortcuts = [
      defaultAmount,
      Math.max(1, Math.round(defaultAmount / 2)),
      defaultAmount * 2,
    ].filter((v, i, arr) => arr.indexOf(v) === i && v > 0);

    const pct = Math.min(100, Math.round(((goal.current || 0) / goal.target) * 100));
    const todayKey = UI.todayKey();
    const isRetroactive = dateKey !== todayKey;
    const dateDate = new Date(dateKey + 'T12:00:00');
    const dateLabel = dateDate.toLocaleDateString('es-CL', { weekday: 'long', day: '2-digit', month: 'long' });

    UI.openModal({
      title: `${habit.icon || '⭐'} ${habit.name}`,
      okText: 'Registrar',
      bodyHTML: `
        ${isRetroactive ? `<div class="retro-badge">📅 Registrando para: <strong>${dateLabel}</strong></div>` : ''}
        <div class="qty-modal-info">
          <div class="qty-goal-row">
            <span class="qty-goal-name">🎯 ${escapeHtml(goal.name)} ${goal.archived ? '<span style="color:var(--text-faint);font-size:10px;text-transform:uppercase">📦 archivada</span>' : ''}</span>
            <span class="qty-goal-progress">${goal.current || 0}/${goal.target} ${goal.unit || ''}</span>
          </div>
          <div class="qty-bar"><div class="qty-bar-fill" style="width:${pct}%"></div></div>
        </div>
        <label>¿Cuánto cumpliste${isRetroactive ? ' ese día' : ' hoy'}? ${goal.unit ? `(en ${goal.unit})` : ''}</label>
        <input type="number" id="qty-input" class="qty-input-big" value="${defaultAmount}" min="0" step="0.5" inputmode="decimal" />
        <div class="qty-shortcuts">
          ${shortcuts.map(v => `<button type="button" class="qty-shortcut" data-qty="${v}">+${v}</button>`).join('')}
        </div>
        <div class="note-input-block">
          <label>Nota (opcional)</label>
          <textarea id="qty-note" placeholder="Ej: capítulo 4 sobre microservicios">${habit.notes && habit.notes[dateKey] ? escapeHtml(habit.notes[dateKey]) : ''}</textarea>
        </div>
      `,
      onSave: () => {
        const amount = parseFloat(document.getElementById('qty-input').value) || 0;
        if (amount < 0) { UI.toast('Cantidad inválida'); return false; }
        const note = document.getElementById('qty-note').value.trim();

        // Marcar el hábito como cumplido (si no estaba ya)
        if (!habit.history.includes(dateKey)) {
          habit.history.push(dateKey);
        }
        habit._completedAt = habit._completedAt || {};
        habit._completedAt[dateKey] = Date.now();
        habit.contributions = habit.contributions || {};
        habit.contributions[dateKey] = amount;
        if (note) {
          habit.notes = habit.notes || {};
          habit.notes[dateKey] = note;
        }
        // Sumar a la meta (del período correcto)
        if (amount > 0) {
          goal.current = (goal.current || 0) + amount;
          recalcGoalAfterContribChange(goal);
        }

        UI.buzz(15);
        Storage.save();
        renderOverview(); renderFull(); renderHeatmap(); App.refreshKPIs();
        Goals.renderAll(); Goals.renderWeeklyMini();

        if (amount > 0) {
          UI.toast(`+${amount} ${goal.unit || ''} a "${goal.name}"`);
        }
      }
    });

    setTimeout(() => {
      // Click en shortcuts: setear input
      document.querySelectorAll('.qty-shortcut').forEach(b => {
        b.addEventListener('click', () => {
          document.getElementById('qty-input').value = b.dataset.qty;
        });
      });
      // Auto-focus al input
      const inp = document.getElementById('qty-input');
      if (inp) {
        inp.focus();
        inp.select();
      }
    }, 80);
  }

  function remove(id) {
    const h = Storage.get().habits.find(x => x.id === id);
    if (!h) return;
    UI.confirm2({
      title: '🗑️ Eliminar hábito',
      message: `¿Eliminar el hábito "<strong>${escapeHtml(h.name)}</strong>"? Se perderá su historial completo.`,
      okText: 'Eliminar',
      danger: true,
      onConfirm: () => {
        const s = Storage.get();
        s.habits = s.habits.filter(h => h.id !== id);
        Storage.save();
        renderFull(); renderOverview(); renderHeatmap(); App.refreshKPIs();
        UI.toast('Hábito eliminado');
      }
    });
  }

  function renderFull() {
    const c = document.getElementById('habits-full-list');
    if (!isLive(c)) return;
    const state = Storage.get();
    if (state.habits.length === 0) {
      c.innerHTML = '<div class="empty">No tienes hábitos creados · usa el + de arriba para crear uno</div>';
      return;
    }
    // Lista plana en el orden de state.habits (el usuario controla con ▲▼)
    c.innerHTML = state.habits.map(renderItemFull).join('');
    bindClicks(c);
  }

  // Cumplimiento promedio de los últimos 30 días, contando solo los días
  // en que el hábito estaba programado y descartando días de vacaciones.
  function complianceLast30(h) { return complianceWindow(h, 30); }

  function complianceWindow(h, nDays) {
    let total = 0, sum = 0, full = 0;
    const base = new Date();
    // No contar días anteriores a la creación del hábito (falsearían el %)
    const bornKey = h.createdAt ? UI.localDateKey(new Date(h.createdAt)) : null;
    for (let i = 0; i < nDays; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() - i);
      const dk = UI.localDateKey(d);
      if (bornKey && dk < bornKey) continue;
      if (typeof Vacation !== 'undefined' && Vacation.isDateInVacation && Vacation.isDateInVacation(dk)) continue;
      if (!isHabitForDate(h, d)) continue;
      total++;
      const p = getHabitDayPct(h, dk);
      sum += p;
      if (p >= 100) full++;
    }
    return { pct: total === 0 ? 0 : Math.round(sum / total), full, total };
  }

  // Lista de hábitos de la pestaña "Hábitos" de Enfoque.
  // Barra = progreso de HOY. El cumplimiento a 30 días va como dato secundario.
  function renderOverview() {
    const c = document.getElementById('habits-overview-list');
    if (!isLive(c)) return;
    const state = Storage.get();

    if (Vacation.isActive()) {
      c.innerHTML = '<div class="empty">🏖️ De vacaciones · tus hábitos vuelven cuando termines</div>';
      return;
    }
    if (!state.habits.length) {
      c.innerHTML = '<div class="empty">Sin hábitos · usa el ícono de arriba para crear el primero</div>';
      return;
    }

    // Orden: pendientes de hoy → completados de hoy → los que no tocan hoy
    const todayKey = UI.todayKey();
    const pending = [], completed = [], offDay = [];
    state.habits.forEach(h => {
      if (!isHabitForToday(h)) offDay.push(h);
      else if (isCompletedToday(h)) completed.push(h);
      else pending.push(h);
    });
    completed.sort((a, b) => {
      const ta = (a._completedAt && a._completedAt[todayKey]) || 0;
      const tb = (b._completedAt && b._completedAt[todayKey]) || 0;
      return ta - tb;
    });

    c.innerHTML = [...pending, ...completed, ...offDay].map(renderOverviewItem).join('');
    bindOverviewClicks(c);
  }

  // Lista compacta de hábitos para el panel "Hoy": SOLO los que tocan hoy,
  // en versión limpia (sin racha ni 30d). Reutiliza el mismo item y binds.
  function renderTodayHabits() {
    const c = document.getElementById('today-habits-list');
    if (!isLive(c)) return;
    const state = Storage.get();

    if (Vacation.isActive()) {
      c.innerHTML = '<div class="empty">🏖️ De vacaciones · tus hábitos vuelven cuando termines</div>';
      return;
    }

    const todayKey = UI.todayKey();
    const pending = [], completed = [];
    state.habits.forEach(h => {
      if (!isHabitForToday(h)) return; // solo los de hoy
      if (isCompletedToday(h)) completed.push(h);
      else pending.push(h);
    });
    completed.sort((a, b) => {
      const ta = (a._completedAt && a._completedAt[todayKey]) || 0;
      const tb = (b._completedAt && b._completedAt[todayKey]) || 0;
      return ta - tb;
    });

    if (pending.length + completed.length === 0) {
      c.innerHTML = '<div class="empty">No hay hábitos para hoy · disfruta 🌿</div>';
      return;
    }

    c.innerHTML = [...pending, ...completed].map(h => renderOverviewItem(h, true)).join('');
    bindOverviewClicks(c);
  }

  function renderOverviewItem(h, clean = false) {
    const today   = isHabitForToday(h);
    const done    = isCompletedToday(h);
    const target  = getDailyTarget(h);
    const unit    = getUnit(h);
    const cur     = getDailyProgress(h);
    const dayPct  = getHabitDayPct(h);
    const color   = h.color || '#f5c842';
    const step    = h.defaultIncrement || Math.max(1, Math.ceil(target / 4));

    let meta;
    if (clean) {
      // Versión limpia para "Hoy": solo progreso del día, sin racha ni 30d
      meta = today ? `${cur}/${target} ${unit}` : 'no toca hoy';
    } else {
      const streak = calcStreak(h);
      const { pct: pct30 } = complianceLast30(h);
      meta = [
        today ? `${cur}/${target} ${unit}` : 'no toca hoy',
        streak > 0 ? `${streak}🔥` : null,
        `${pct30}% 30d`,
      ].filter(Boolean).join(' · ');
    }

    return `
      <div class="hab-ov-item ${done ? 'done' : ''} ${today ? '' : 'off-day'}" data-id="${h.id}">
        <button class="hab-ov-icon" data-action="quant-modal" aria-label="Registrar cantidad exacta">${h.icon || '⭐'}</button>
        <div class="hab-ov-body" data-action="detail">
          <div class="hab-ov-name">${escapeHtml(h.name)}${done ? ' <span class="hab-ov-check">✓</span>' : ''}</div>
          <div class="hab-ov-meta">${meta}</div>
          <div class="hab-ov-bar"><div class="hab-ov-bar-fill" style="width:${dayPct}%;background:${color}"></div></div>
        </div>
        <div class="hab-ov-actions">
          <button class="hab-ov-btn" data-action="minus" data-step="${step}" ${cur > 0 ? '' : 'disabled'} aria-label="Restar ${step}">−${step}</button>
          <button class="hab-ov-btn plus" data-action="plus" data-step="${step}" aria-label="Sumar ${step}">+${step}</button>
        </div>
      </div>`;
  }

  function bindOverviewClicks(c) {
    c.querySelectorAll('[data-action]').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        const id = b.closest('.hab-ov-item').dataset.id;
        const a = b.dataset.action;
        const step = parseFloat(b.dataset.step) || 1;
        if (a === 'detail') openDetail(id);
        if (a === 'quant-modal') openQuantModal(id);
        if (a === 'plus') { UI.buzz(8); addToHabitProgress(id, step); }
        if (a === 'minus') { UI.buzz(8); subFromHabitProgress(id, step); }
      });
    });
  }

  function renderItemFull(h) {
    const done = isCompletedToday(h);
    const streak = calcStreak(h);
    const state = Storage.get();
    const area = state.areas.find(a => a.id === h.area);
    const linkedGoal = h.linkedGoalId ? state.goals.find(g => g.id === h.linkedGoalId && !g.archived) : null;
    const ft = formatFreq(h.frequency);
    const todayNote = h.notes && h.notes[UI.todayKey()];
    const canUp = canMove(h.id, -1);
    const canDown = canMove(h.id, 1);
    const quant = isQuant(h);
    const dailyCur = quant ? getDailyProgress(h) : 0;
    return `
      <div class="item ${done ? 'done' : ''}" data-id="${h.id}">
        <button class="checkbox ${done ? 'checked' : ''}" data-action="toggle">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>
        </button>
        <span class="item-icon" data-action="detail">${h.icon || '⭐'}</span>
        <div class="item-body" data-action="detail">
          <div class="item-name">${escapeHtml(h.name)}${todayNote ? `<span class="note-indicator">📝</span>` : ''}</div>
          <div class="item-meta">
            ${quant ? `<span class="quant-progress">${dailyCur}/${h.dailyTarget} ${h.unit || ''}</span>` : ''}
            ${streak > 0 ? `<span class="streak">${streak}🔥</span>` : ''}
            ${area ? `<span class="area-tag">${area.name}</span>` : ''}
            <span>${ft}</span>
            ${linkedGoal ? `<span class="goal-link-badge">🎯 ${escapeHtml(linkedGoal.name.length > 18 ? linkedGoal.name.slice(0, 18) + '…' : linkedGoal.name)}</span>` : ''}
          </div>
        </div>
        <div class="reorder-actions">
          <button class="reorder-btn" data-action="up" ${canUp ? '' : 'disabled'} aria-label="Subir">▲</button>
          <button class="reorder-btn" data-action="down" ${canDown ? '' : 'disabled'} aria-label="Bajar">▼</button>
        </div>
        <div class="item-actions">
          <button class="item-edit" data-action="edit" aria-label="Editar">✎</button>
          <button class="item-delete" data-action="delete">×</button>
        </div>
      </div>`;
  }

  function formatFreq(f) {
    if (!f || f.type === 'daily') return 'Diario';
    if (f.type === 'days') return f.days.map(d => DAY_NAMES[d]).join(' ');
    return 'Diario';
  }

  function bindClicks(c) {
    c.querySelectorAll('[data-action]').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        const id = b.closest('.item').dataset.id;
        const a = b.dataset.action;
        if (a === 'toggle') toggleToday(id);
        if (a === 'delete') remove(id);
        if (a === 'edit') openEditModal(id);
        if (a === 'detail') openDetail(id);
        if (a === 'up') moveHabit(id, -1);
        if (a === 'down') moveHabit(id, 1);
        if (a === 'quant-quick') {
          const step = parseFloat(b.dataset.step) || 1;
          addToHabitProgress(id, step);
        }
        if (a === 'quant-modal') openQuantModal(id);
      });
    });
  }

  // Modal grande para registrar cantidad exacta (input + +/- + atajos)
  function openQuantModal(habitId, dateKey = UI.todayKey()) {
    const state = Storage.get();
    const h = state.habits.find(x => x.id === habitId);
    if (!h) return;

    const target = getDailyTarget(h);
    const unit = getUnit(h);
    const cur = getDailyProgress(h, dateKey);
    const remaining = Math.max(0, target - cur);
    const step = h.defaultIncrement || Math.max(1, Math.ceil(target / 4));
    const shortcuts = [step, Math.max(0.5, step / 2), step * 2, remaining]
      .filter((v, i, arr) => v > 0 && arr.findIndex(x => Math.abs(x - v) < 0.01) === i);
    const pct = Math.min(100, Math.round((cur / target) * 100));

    UI.openModal({
      title: `${h.icon || '⭐'} ${h.name}`,
      okText: 'Sumar',
      bodyHTML: `
        <div class="qty-modal-info">
          <div class="qty-goal-row">
            <span class="qty-goal-name">Progreso de hoy</span>
            <span class="qty-goal-progress">${cur}/${target} ${unit}</span>
          </div>
          <div class="qty-bar"><div class="qty-bar-fill" style="width:${pct}%"></div></div>
        </div>
        <label>¿Cuánto sumar? ${unit ? `(en ${unit})` : ''}</label>
        <div class="qty-input-row">
          <button type="button" class="qty-step-btn" id="qty-minus" aria-label="Menos">−</button>
          <input type="number" id="qty-input" class="qty-input-big" value="${step}" min="0" step="0.5" inputmode="decimal" />
          <button type="button" class="qty-step-btn" id="qty-plus" aria-label="Más">+</button>
        </div>
        <div class="qty-shortcuts">
          ${shortcuts.map(v => `<button type="button" class="qty-shortcut" data-qty="${v}">${v}</button>`).join('')}
        </div>
        ${cur > 0 ? `<button type="button" class="qty-undo" id="qty-undo">↶ Restar ${step} (corregir)</button>` : ''}
        <div class="note-input-block">
          <label>Nota (opcional)</label>
          <textarea id="qty-note" placeholder="Ej: capítulo 4">${h.notes && h.notes[dateKey] ? escapeHtml(h.notes[dateKey]) : ''}</textarea>
        </div>
      `,
      onSave: () => {
        const amount = parseFloat(document.getElementById('qty-input').value) || 0;
        if (amount <= 0) { UI.toast('Cantidad inválida'); return false; }
        const note = document.getElementById('qty-note').value.trim();
        addToHabitProgress(habitId, amount, dateKey, note || null);
      }
    });

    setTimeout(() => {
      const inp = document.getElementById('qty-input');
      const minus = document.getElementById('qty-minus');
      const plus = document.getElementById('qty-plus');
      const stepDelta = step >= 1 ? 1 : 0.5;
      if (minus) minus.addEventListener('click', () => {
        const v = Math.max(0, (parseFloat(inp.value) || 0) - stepDelta);
        inp.value = v;
      });
      if (plus) plus.addEventListener('click', () => {
        const v = (parseFloat(inp.value) || 0) + stepDelta;
        inp.value = v;
      });
      document.querySelectorAll('.qty-shortcut').forEach(b => {
        b.addEventListener('click', () => { inp.value = b.dataset.qty; });
      });
      const undo = document.getElementById('qty-undo');
      if (undo) undo.addEventListener('click', () => {
        UI.closeModal();
        subFromHabitProgress(habitId, step, dateKey);
      });
      inp.focus();
      inp.select();
    }, 50);
  }

  function openCreateModal(editId = null) {
    const state = Storage.get();
    const editing = editId ? state.habits.find(h => h.id === editId) : null;
    const areasOpts = state.areas.map(a => `<option value="${a.id}" ${editing && editing.area === a.id ? 'selected' : ''}>${a.icon} ${a.name}</option>`).join('');
    const dayPicker = [1,2,3,4,5,6,0].map(d => {
      const checked = editing && editing.frequency?.type === 'days' && editing.frequency.days.includes(d) ? 'checked' : '';
      return `<label><input type="checkbox" name="day" value="${d}" ${checked} /><span class="day-pill">${DAY_NAMES[d]}</span></label>`;
    }).join('');
    const colorOpts = ['#f5c842','#4ade80','#60a5fa','#a78bfa','#ef4444','#f0abfc','#fb923c'].map((c, i) => {
      const checked = editing ? (editing.color === c ? 'checked' : '') : (i===0 ? 'checked' : '');
      return `<label><input type="radio" name="color" value="${c}" ${checked} /><span class="color-dot" style="background:${c}"></span></label>`;
    }).join('');
    const tods = [['mañana','◐ Mañana'],['tarde','◑ Tarde'],['noche','◓ Noche']];
    const todOpts = tods.map(([v,l]) => `<option value="${v}" ${editing && editing.timeOfDay === v ? 'selected' : ''}>${l}</option>`).join('');
    const freqOpts = [['daily','Todos los días'],['days','Días específicos']]
      .map(([v,l]) => `<option value="${v}" ${editing && editing.frequency?.type === v ? 'selected' : ''}>${l}</option>`).join('');
    const showDays = editing && editing.frequency?.type === 'days' ? 'block' : 'none';

    // Metas activas para vincular (no archivadas, no cumplidas)
    const linkableGoals = state.goals.filter(g => !g.done && !g.archived);
    const goalsOpts = linkableGoals.map(g => {
      const sel = editing && editing.linkedGoalId === g.id ? 'selected' : '';
      const horizonLabel = { week:'Sem', month:'Mes', quarter:'Trim', year:'Año' }[g.horizon] || '';
      const targetTxt = g.target > 0 ? ` (${g.current||0}/${g.target} ${g.unit||''})`.trim() : '';
      return `<option value="${g.id}" ${sel}>[${horizonLabel}] ${escapeHtml(g.name)}${targetTxt}</option>`;
    }).join('');

    const linkedGoal = editing && editing.linkedGoalId ? state.goals.find(g => g.id === editing.linkedGoalId) : null;
    const showIncrement = linkedGoal && linkedGoal.target && linkedGoal.target > 0 ? 'block' : 'none';
    const incrementVal = editing && editing.defaultIncrement ? editing.defaultIncrement : '';

    // Hábito cuantitativo (propio del hábito, independiente de meta vinculada)
    const dailyTargetVal = editing && editing.dailyTarget ? editing.dailyTarget : '';
    const unitVal = editing && editing.unit ? editing.unit : '';

    UI.openModal({
      title: editing ? 'Editar hábito' : 'Nuevo hábito',
      okText: editing ? 'Guardar cambios' : 'Crear',
      bodyHTML: `
        <label>Nombre del hábito</label>
        <input type="text" id="h-name" placeholder="Ej: Leer 20 páginas" value="${editing ? escapeAttr(editing.name) : ''}" />
        <label>Emoji (opcional)</label>
        <input type="text" id="h-icon" placeholder="📚" maxlength="2" value="${editing ? escapeAttr(editing.icon) : ''}" />
        <label>Área de vida</label>
        <select id="h-area">${areasOpts}</select>
        <label>Frecuencia</label>
        <select id="h-freq">${freqOpts}</select>
        <div id="h-days-wrap" style="display:${showDays}">
          <label>Días</label>
          <div class="day-picker">${dayPicker}</div>
        </div>

        <label style="margin-top:14px">📊 Cantidad diaria</label>
        <div style="display:flex;gap:8px">
          <input type="number" id="h-daily-target" placeholder="Ej: 20" min="0.5" step="0.5" value="${dailyTargetVal || 1}" style="flex:2" />
          <input type="text" id="h-unit" placeholder="páginas, L, min, km, sesión…" maxlength="20" value="${escapeAttr(unitVal || 'sesión')}" style="flex:3" />
        </div>
        <p style="color:var(--text-dim);font-size:11px;margin-top:6px">Si tu hábito no tiene cantidad medible, deja "1 sesión". Puedes registrar en varios momentos del día.</p>

        <label>🎯 Vincular a meta (opcional)</label>
        <select id="h-goal">
          <option value="">— Sin vincular —</option>
          ${goalsOpts}
        </select>

        <div id="h-increment-wrap" style="display:${showIncrement}">
          <label>Cantidad sugerida por toque <span style="text-transform:none;color:var(--text-faint)">(opcional)</span></label>
          <input type="number" id="h-increment" placeholder="Ej: 5" min="0" step="0.5" value="${incrementVal}" />
          <p style="color:var(--text-dim);font-size:11px;margin-top:6px">Si está vinculado a una meta cuantitativa, esta cantidad aparece como sugerencia al registrar.</p>
        </div>

        <label>Color</label>
        <div class="color-picker">${colorOpts}</div>
      `,
      onSave: () => {
        const name = document.getElementById('h-name').value.trim();
        if (!name) { UI.toast('Falta el nombre'); return false; }
        const icon = document.getElementById('h-icon').value.trim() || '⭐';
        const area = document.getElementById('h-area').value;
        const freqType = document.getElementById('h-freq').value;
        const color = document.querySelector('input[name=color]:checked')?.value || '#f5c842';
        const linkedGoalId = document.getElementById('h-goal').value || null;
        const defaultIncrement = parseFloat(document.getElementById('h-increment').value) || null;
        const dailyTarget = parseFloat(document.getElementById('h-daily-target').value) || 1;
        const unit = document.getElementById('h-unit').value.trim() || 'sesión';
        let frequency = { type: 'daily' };
        if (freqType === 'days') {
          const days = [...document.querySelectorAll('input[name=day]:checked')].map(i => +i.value);
          if (days.length === 0) { UI.toast('Selecciona al menos un día'); return false; }
          frequency = { type: 'days', days };
        }
        if (editing) {
          editing.name = name;
          editing.icon = icon;
          editing.color = color;
          editing.area = area;
          editing.frequency = frequency;
          editing.linkedGoalId = linkedGoalId;
          editing.defaultIncrement = defaultIncrement;
          editing.dailyTarget = dailyTarget;
          editing.unit = unit;
          UI.toast('Hábito actualizado');
        } else {
          Storage.get().habits.push({
            id: Storage.uid(), name, icon, color, area, frequency,
            linkedGoalId, defaultIncrement, dailyTarget, unit,
            createdAt: Date.now(), history: [], contributions: {}, dailyProgress: {},
          });
          UI.toast('Hábito creado');
        }
        Storage.save();
        renderOverview(); renderFull(); renderHeatmap(); App.refreshKPIs();
        Goals.renderAll(); Goals.renderWeeklyMini();
      }
    });

    setTimeout(() => {
      const sel = document.getElementById('h-freq');
      sel.addEventListener('change', () => {
        document.getElementById('h-days-wrap').style.display = sel.value === 'days' ? 'block' : 'none';
      });

      // Mostrar/ocultar campo de cantidad según meta seleccionada
      const goalSel = document.getElementById('h-goal');
      goalSel.addEventListener('change', () => {
        const gid = goalSel.value;
        const g = gid ? Storage.get().goals.find(x => x.id === gid) : null;
        const isQuant = g && g.target && g.target > 0;
        document.getElementById('h-increment-wrap').style.display = isQuant ? 'block' : 'none';
      });
    }, 50);
  }

  function openEditModal(id) { openCreateModal(id); }

  function openEditFromDetail() {
    if (currentDetailId) openCreateModal(currentDetailId);
  }

  let currentDetailId = null;

  function openDetail(id) {
    currentDetailId = id;
    UI.go('habit-detail');
    renderDetail();
  }

  function renderDetail() {
    if (!currentDetailId) return;
    const c = document.getElementById('habit-detail-content');
    if (!c) return;
    const state = Storage.get();
    const h = state.habits.find(x => x.id === currentDetailId);
    if (!h) {
      c.innerHTML = '<div class="empty">Hábito no encontrado</div>';
      return;
    }
    const area = state.areas.find(a => a.id === h.area);
    const linkedGoal = h.linkedGoalId ? state.goals.find(g => g.id === h.linkedGoalId) : null;
    const streak = calcStreak(h);

    // Calcular stats
    const history = h.history || [];
    const set = new Set(history);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Mejor racha histórica
    const bestStreak = calcBestStreak(h);

    // % últimos 7, 30, 90 días (sobre días aplicables)
    const pct = (days) => {
      let total = 0, done = 0;
      for (let i = 0; i < days; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        if (!isHabitForDate(h, d)) continue;
        const key = UI.localDateKey(d);
        if (Vacation.isDateInVacation(key)) continue;
        total++;
        if (set.has(key)) done++;
      }
      return total === 0 ? 0 : Math.round((done / total) * 100);
    };
    const pct7 = pct(7), pct30 = pct(30), pct90 = pct(90);

    // Total cumplido
    const totalDone = history.length;

    // Fecha de creación
    const createdDate = h.createdAt ? new Date(h.createdAt).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

    // Construir mini heatmap de los últimos 90 días (3 meses) — SOLO VISUAL
    const heatmapDays = 90;
    const heatmapCells = [];
    const todayKey = UI.todayKey();
    for (let i = heatmapDays - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = UI.localDateKey(d);
      const applies = isHabitForDate(h, d);
      const onVac = Vacation.isDateInVacation(key);
      const isDone = set.has(key);
      const isToday = i === 0;
      const classes = [];
      if (!applies || onVac) classes.push('notapplies');
      else if (isDone) classes.push('done');
      if (isToday) classes.push('today');
      const dateLabel = d.toLocaleDateString('es-CL', { weekday: 'short', day: '2-digit', month: 'short' });
      const stateLabel = !applies ? ' (no aplica)' : (onVac ? ' (vacaciones)' : (isDone ? ' · ✓ hecho' : ' · sin marcar'));
      heatmapCells.push(`<div class="heatmap-cell ${classes.join(' ')}" title="${dateLabel}${stateLabel}"></div>`);
    }

    // Historial con notas (últimos 30 cumplidos)
    const recentHistory = [...history].sort((a, b) => b.localeCompare(a)).slice(0, 30);
    const historyHTML = recentHistory.length === 0
      ? `<div class="history-empty">Aún sin registros · marca el hábito hoy</div>`
      : recentHistory.map(dk => {
          const note = h.notes && h.notes[dk];
          const amount = h.contributions && h.contributions[dk];
          const dateObj = new Date(dk + 'T12:00:00');
          const dateLbl = dateObj.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' }).toUpperCase();
          return `
            <div class="history-entry">
              <div class="history-date">${dateLbl}</div>
              <div class="history-body">
                ${amount && linkedGoal ? `<div class="history-amount">+${amount} ${linkedGoal.unit || ''}</div>` : ''}
                ${note ? `<div class="history-note">${escapeHtml(note)}</div>` : (!amount ? `<div class="history-note" style="color:var(--text-faint);font-style:italic">Sin nota</div>` : '')}
              </div>
            </div>
          `;
        }).join('');

    c.innerHTML = `
      <div class="habit-detail-hero">
        <span class="habit-detail-icon">${h.icon || '⭐'}</span>
        <div class="habit-detail-name">${escapeHtml(h.name)}</div>
        <div class="habit-detail-meta">
          ${area ? `${area.icon} ${area.name} · ` : ''}${formatFreq(h.frequency)}
          ${linkedGoal ? `<br>🎯 ${escapeHtml(linkedGoal.name)}` : ''}
          <br><span style="color:var(--text-faint);font-size:11px">Creado · ${createdDate}</span>
        </div>
      </div>

      <div class="habit-stats-grid">
        <div class="stat-card" style="--stat-color:var(--accent-orange)">
          <div class="stat-label">Racha 🔥</div>
          <div class="stat-value">${streak}</div>
        </div>
        <div class="stat-card" style="--stat-color:var(--accent-yellow)">
          <div class="stat-label">Mejor 🏆</div>
          <div class="stat-value">${bestStreak}</div>
        </div>
        <div class="stat-card" style="--stat-color:var(--accent-green)">
          <div class="stat-label">Total ✓</div>
          <div class="stat-value">${totalDone}</div>
        </div>
      </div>

      <div class="section-card">
        <div class="section-head">
          <div>
            <div class="section-title">📊 Cumplimiento</div>
            <div class="section-subtitle">% sobre días aplicables</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
          <div style="text-align:center">
            <div style="font-family:var(--font-mono);font-size:24px;font-weight:700;color:var(--accent-yellow)">${pct7}%</div>
            <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.5px;margin-top:2px">7 DÍAS</div>
          </div>
          <div style="text-align:center">
            <div style="font-family:var(--font-mono);font-size:24px;font-weight:700;color:var(--accent-yellow)">${pct30}%</div>
            <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.5px;margin-top:2px">30 DÍAS</div>
          </div>
          <div style="text-align:center">
            <div style="font-family:var(--font-mono);font-size:24px;font-weight:700;color:var(--accent-yellow)">${pct90}%</div>
            <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.5px;margin-top:2px">90 DÍAS</div>
          </div>
        </div>
      </div>

      <div class="detail-heatmap-wrap">
        <div class="detail-heatmap-header">
          <div class="heatmap-block-title">📅 Últimos 90 días</div>
          <button class="heatmap-edit-btn" id="heatmap-retro-edit-btn" data-habit-id="${h.id}" aria-label="Editar últimos 7 días" title="Editar últimos 7 días">
            <span class="edit-icon">✎</span>
          </button>
        </div>
        <div class="detail-heatmap-cells">${heatmapCells.join('')}</div>
      </div>

      <div class="section-card">
        <div class="section-head">
          <div>
            <div class="section-title">📝 Historial reciente</div>
            <div class="section-subtitle">Últimos 30 registros</div>
          </div>
        </div>
        <div class="history-list">${historyHTML}</div>
      </div>
    `;

    // Botón para editar últimos 7 días (modal con lista)
    const editBtn = document.getElementById('heatmap-retro-edit-btn');
    if (editBtn) {
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openRetroEditModal(h.id);
      });
    }
  }

  // Modal de edición retroactiva: lista de los últimos 7 días (desde ayer)
  function openRetroEditModal(habitId) {
    const renderRows = () => {
      const state = Storage.get();
      const h = state.habits.find(x => x.id === habitId);
      if (!h) return '';
      const set = new Set(h.history || []);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const rows = [];
      // Desde hoy (i=0) hasta hace 7 días (i=7) → 8 días en total
      for (let i = 0; i <= RETRO_DAYS_LIMIT; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const key = UI.localDateKey(d);
        const applies = isHabitForDate(h, d);
        const onVac = Vacation.isDateInVacation(key);
        const isDone = set.has(key);
        const disabled = !applies || onVac;
        const isToday = i === 0;
        const dayLabel = isToday ? 'Hoy' : d.toLocaleDateString('es-CL', { weekday: 'long' });
        const dateLabel = d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
        const subLabel = disabled
          ? (onVac ? 'Vacaciones · no editable' : 'No aplica este día')
          : (isDone ? '✓ Marcado como hecho' : 'Sin marcar');
        rows.push(`
          <div class="retro-edit-row ${isDone ? 'done' : ''} ${disabled ? 'disabled' : ''} ${isToday ? 'is-today' : ''}">
            <div class="retro-date">
              <div class="retro-date-day">${dayLabel}</div>
              <div class="retro-date-sub">${dateLabel.toUpperCase()} · ${subLabel}</div>
            </div>
            <button class="retro-toggle" data-retro-key="${key}" ${disabled ? 'disabled' : ''} aria-label="Marcar/desmarcar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>
            </button>
          </div>
        `);
      }
      return rows.join('');
    };

    const state = Storage.get();
    const h = state.habits.find(x => x.id === habitId);
    if (!h) return;

    UI.openModal({
      title: `✎ Editar · ${h.name}`,
      okText: 'Listo',
      cancelText: 'Cerrar',
      bodyHTML: `
        <div class="retro-edit-hint">Toca un día para marcar o desmarcar · hoy + últimos ${RETRO_DAYS_LIMIT} días</div>
        <div class="retro-edit-list" id="retro-edit-list">${renderRows()}</div>
      `,
      onSave: () => true,
    });

    // Re-render local de la lista tras cada toggle (sin cerrar el modal)
    const refresh = () => {
      const listEl = document.getElementById('retro-edit-list');
      if (listEl) {
        listEl.innerHTML = renderRows();
        bindRowClicks();
      }
    };
    const bindRowClicks = () => {
      document.querySelectorAll('#retro-edit-list .retro-toggle').forEach(btn => {
        if (btn.disabled) return;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const dateKey = btn.dataset.retroKey;
          // Marcar/desmarcar y refrescar la lista
          quickToggleRetro(habitId, dateKey, refresh);
        });
      });
    };
    setTimeout(bindRowClicks, 30);
  }

  // Toggle simplificado para el modal de edición retroactiva:
  // marca/desmarca sin confirmaciones de racha (estamos en pasado) y refresca.
  // Si el hábito tiene meta vinculada con target, igualmente pide cantidad/nota.
  function quickToggleRetro(habitId, dateKey, onAfter) {
    const state = Storage.get();
    const h = state.habits.find(x => x.id === habitId);
    if (!h) return;
    h.history = h.history || [];
    const i = h.history.indexOf(dateKey);

    if (i !== -1) {
      // Desmarcar directo (sin confirmación de racha porque es retroactivo)
      unlinkContribution(h, dateKey);
      h.history.splice(i, 1);
      if (h.notes) delete h.notes[dateKey];
      Storage.save();
      renderDetail();
      renderOverview(); renderFull(); renderHeatmap(); App.refreshKPIs();
      Goals.renderAll(); Goals.renderWeeklyMini();
      UI.toast('Desmarcado');
      if (onAfter) onAfter();
      return;
    }

    // Marcar: usar el flujo existente que respeta metas/notas
    const linkedGoal = findGoalForDate(h, dateKey);
    if (linkedGoal && linkedGoal.target && linkedGoal.target > 0) {
      askQuantity(h, linkedGoal, dateKey);
      // El modal de cantidad reemplaza al de edición. Cuando se cierre,
      // si el usuario vuelve al detalle, ya verá los cambios reflejados.
      return;
    }
    askNote(h, dateKey);
  }

  function calcBestStreak(h) {
    if (!h.history || h.history.length === 0) return 0;
    const set = new Set(h.history);
    const sortedDates = [...set].sort();
    if (sortedDates.length === 0) return 0;
    let best = 0, current = 0;
    const firstDate = new Date(sortedDates[0] + 'T12:00:00');
    const lastDate = new Date(); lastDate.setHours(0, 0, 0, 0);
    const day = new Date(firstDate);
    while (day <= lastDate) {
      const key = UI.localDateKey(day);
      const applies = isHabitForDate(h, day);
      const onVac = Vacation.isDateInVacation(key);
      if (!applies || onVac) {
        // No suma ni rompe
      } else if (set.has(key)) {
        current++;
        if (current > best) best = current;
      } else {
        current = 0;
      }
      day.setDate(day.getDate() + 1);
    }
    return best;
  }

  // ====== HEATMAP de últimos 30 días ======
  function renderHeatmap() {
    const c = document.getElementById('heatmap-list');
    if (!isLive(c)) return;
    const state = Storage.get();
    if (state.habits.length === 0) {
      c.innerHTML = '<div class="empty">No hay hábitos para mostrar</div>';
      return;
    }
    const today = new Date();
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      days.push(UI.localDateKey(d));
    }
    const todayKey = UI.todayKey();

    c.innerHTML = state.habits.map(h => {
      const set = new Set(h.history || []);
      // Generamos las celdas con información de "aplica o no" para este hábito
      const cells = days.map(dk => {
        const dateObj = new Date(dk + 'T12:00:00');
        const applies = isHabitForDate(h, dateObj);
        const isDone = set.has(dk);
        const isToday = dk === todayKey;
        const classes = [];
        if (!applies) classes.push('notapplies');
        else if (isDone) classes.push('done');
        if (isToday) classes.push('today');
        const dateLabel = dateObj.toLocaleDateString('es-CL', { weekday: 'short', day: '2-digit', month: 'short' });
        const stateLabel = !applies ? ' (no aplica)' : (isDone ? ' · ✓ hecho' : ' · sin marcar');
        return `<div class="heatmap-cell ${classes.join(' ')}" title="${dateLabel}${stateLabel}"></div>`;
      }).join('');
      // Solo contar días que SÍ aplicaban
      const applicableDays = days.filter(dk => isHabitForDate(h, new Date(dk + 'T12:00:00')));
      const completed = applicableDays.filter(dk => set.has(dk)).length;
      const totalApplicable = applicableDays.length;
      const pct = totalApplicable > 0 ? Math.round((completed / totalApplicable) * 100) : 0;
      const streak = calcStreak(h);
      return `
        <div class="heatmap-block">
          <div class="heatmap-block-title">
            <span>${h.icon || '⭐'}</span>
            <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(h.name)}</span>
            ${streak > 0 ? `<span class="streak">${streak}🔥</span>` : ''}
          </div>
          <div class="heatmap-cells">${cells}</div>
          <div class="heatmap-stats">
            <span><strong>${completed}</strong>/${totalApplicable} días aplicables</span>
            <span><strong>${pct}%</strong> cumplimiento</span>
          </div>
        </div>`;
    }).join('');

    // Heatmap 30 días: solo visual (la edición se hace desde el detalle del hábito)

    // Label del rango
    const startD = new Date(today); startD.setDate(today.getDate() - 29);
    const fmt = (d) => d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
    const label = document.getElementById('heatmap-month-label');
    if (label) label.textContent = `${fmt(startD)} → ${fmt(today)} · solo visual`;
  }

  return { complianceWindow, calcBestStreak, renderOverview, renderTodayHabits, renderFull, renderHeatmap, openCreateModal, openEditModal, openDetail, renderDetail, openEditFromDetail, isHabitForToday, isHabitForDate, isCompletedToday, calcStreak, maxStreakAcrossAll, toggleHabitOnDate, toggleToday, RETRO_DAYS_LIMIT, isQuant, getDailyProgress, getHabitDayPct, addToHabitProgress, subFromHabitProgress, openQuantModal };
})();

/* ============================================
   TASKS
   ============================================ */
const Tasks = (() => {
  let filter = 'scheduled';
  let doneSearchQuery = '';
  let doneMonthsOpen = {}; // { '2026-05': true/false } — control de qué meses están expandidos
  let doneYearsOpen = {};  // { '2026': true/false } — control de qué años están expandidos

  function setFilter(f) {
    if (filter !== f) {
      // Al salir del filtro "archivo", limpiar la búsqueda para que arranque limpia
      if (filter === 'archive') doneSearchQuery = '';
    }
    filter = f;
    document.querySelectorAll('.task-filter .chip').forEach(c => {
      c.classList.toggle('active', c.dataset.filter === f);
    });
    renderFull();
  }

  function isToday(t) { return t.date === UI.todayKey(); }
  function isThisWeek(t) {
    if (!t.date) return false;
    return UI.weekKey(new Date(t.date + 'T12:00:00')) === UI.weekKey();
  }

  // Calcular siguiente fecha según recurrencia
  function getNextRecurrenceDate(currentDate, recurrence) {
    const d = new Date(currentDate + 'T12:00:00');
    switch (recurrence) {
      case 'daily':   d.setDate(d.getDate() + 1); break;
      case 'weekly':  d.setDate(d.getDate() + 7); break;
      case 'monthly': d.setMonth(d.getMonth() + 1); break;
      case 'yearly':  d.setFullYear(d.getFullYear() + 1); break;
      default: return null;
    }
    return UI.localDateKey(d);
  }

  // Tipos de recurrencia cuyas tareas se BORRAN al completarse
  // (se generó la próxima ocurrencia, la vieja no aporta a la bitácora)
  const DELETE_ON_COMPLETE = new Set(['daily', 'weekly']);
  // Tipos de recurrencia donde se pide nota opcional al completar
  // (sirven como bitácora con detalle: monto pagado, observaciones, etc.)
  const ASK_NOTE_RECURRENCES = new Set(['monthly', 'yearly']);

  function toggle(id) {
    const s = Storage.get();
    const t = s.tasks.find(x => x.id === id);
    if (!t) return;

    // Si estaba completada → simplemente la desmarcamos (sin nota ni borrado)
    if (t.done) {
      t.done = false;
      delete t.doneAt;
      // Si está vinculada a una meta, restar 1 de su current
      if (t.goalId && typeof Goals !== 'undefined' && Goals.updateCurrent) {
        const g = s.goals.find(x => x.id === t.goalId && !x.archived);
        if (g && g.target && g.target > 0) {
          Goals.updateCurrent(t.goalId, Math.max(0, (g.current || 0) - 1));
        }
      }
      Storage.save();
      renderToday(); renderFull(); App.refreshKPIs();
      return;
    }

    // Si NO estaba completada → la marcamos como hecha
    const rec = t.recurrence && t.recurrence !== 'none' ? t.recurrence : null;
    const willBeDeleted = rec && DELETE_ON_COMPLETE.has(rec);
    const shouldAskNote = !willBeDeleted; // pedimos nota para todo lo que se conserva (mensual, anual, sin recurrencia)

    // Función que hace el "marcado real" después de capturar (o saltar) la nota
    const doComplete = (data) => {
      const noteText = data && data.note ? data.note : null;
      t.done = true;
      t.doneAt = Date.now();
      if (noteText) t.note = noteText;
      UI.buzz(15);

      // Si está vinculada a una meta, sumar 1 a su current (propaga a padres automáticamente)
      if (t.goalId && typeof Goals !== 'undefined' && Goals.updateCurrent) {
        const g = s.goals.find(x => x.id === t.goalId && !x.archived);
        if (g && g.target && g.target > 0) {
          Goals.updateCurrent(t.goalId, (g.current || 0) + 1);
        }
      }

      // Generar siguiente ocurrencia si es recurrente
      if (rec) {
        const nextDate = getNextRecurrenceDate(t.date, rec);
        if (nextDate) {
          const seriesId = t.seriesId || t.id;
          const exists = s.tasks.some(x =>
            (x.seriesId === seriesId || x.id === seriesId) &&
            x.date === nextDate &&
            !x.done
          );
          if (!exists) {
            s.tasks.push({
              id: Storage.uid(),
              seriesId: seriesId,
              name: t.name,
              date: nextDate,
              area: t.area,
              goalId: t.goalId,
              important: t.important,
              recurrence: rec,
              done: false,
              createdAt: Date.now(),
            });
            UI.toast(`✓ Próxima: ${formatTaskDate(nextDate)}`);
          }
        }
      }

      // Si es diaria/semanal recurrente → borrar la actual (ya generó la próxima)
      if (willBeDeleted) {
        s.tasks = s.tasks.filter(x => x.id !== t.id);
      }

      Storage.save();
      renderToday(); renderFull(); App.refreshKPIs();
    };

    if (shouldAskNote) {
      askCompletionNote(t, doComplete);
    } else {
      doComplete(null);
    }
  }

  // Modal opcional al completar (mensuales, anuales y sin recurrencia)
  function askCompletionNote(task, onConfirm) {
    UI.openModal({
      title: `✓ ${task.name}`,
      okText: 'Marcar como hecha',
      bodyHTML: `
        <p style="color:var(--text-dim);font-size:13px;margin-bottom:8px">Bitácora opcional: detalles, lo que quieras recordar.</p>
        <label>Nota (opcional)</label>
        <textarea id="task-complete-note" placeholder="Ej: detalles relevantes"></textarea>
      `,
      onSave: () => {
        const note = document.getElementById('task-complete-note').value.trim();
        onConfirm({ note: note || null });
      }
    });
    setTimeout(() => {
      const inp = document.getElementById('task-complete-note');
      if (inp) inp.focus();
    }, 80);
  }

  function remove(id) {
    const s = Storage.get();
    s.tasks = s.tasks.filter(t => t.id !== id);
    Storage.save();
    renderToday(); renderFull(); App.refreshKPIs();
  }

  function renderToday() {
    const c = document.getElementById('today-tasks');
    if (!isLive(c)) return;
    const todayKey = UI.todayKey();
    const all = Storage.get().tasks.filter(t => !t.done);
    const overdue = all.filter(t => t.date && t.date < todayKey);
    const todays = all.filter(t => t.date === todayKey);

    if (overdue.length === 0 && todays.length === 0) {
      c.innerHTML = '<div class="empty empty-tasks">🌤️ No tienes tareas pendientes</div>';
      return;
    }

    // Atrasadas: primero importantes, luego normales. Dentro de cada grupo, las más viejas arriba.
    overdue.sort((a, b) => {
      const ai = a.important ? 1 : 0;
      const bi = b.important ? 1 : 0;
      if (ai !== bi) return bi - ai;
      return (a.date || '').localeCompare(b.date || '');
    });
    // Del día: primero importantes, luego normales (orden de creación).
    todays.sort((a, b) => {
      const ai = a.important ? 1 : 0;
      const bi = b.important ? 1 : 0;
      if (ai !== bi) return bi - ai;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });

    let html = '';
    if (overdue.length > 0) {
      html += `
        <div class="overdue-section">
          <div class="overdue-section-title">
            <span>⚠ Atrasadas</span>
            <span class="overdue-count">${overdue.length}</span>
          </div>
          ${overdue.map(t => renderItem(t, { overdue: true, noActions: true })).join('')}
        </div>
      `;
    }
    if (todays.length > 0) {
      html += todays.map(t => renderItem(t, { noActions: true })).join('');
    }
    c.innerHTML = html;
    bindClicks(c);
  }

  // Tareas de mañana en "Hoy": aparecen SOLO después de registrar el cierre
  // del día, como adelanto para planificar. En modo preview (no accionable).
  function renderTomorrow() {
    const c = document.getElementById('tomorrow-tasks');
    if (!isLive(c)) return;
    const todayKey = UI.todayKey();
    const closures = Storage.get().closures || {};

    // Gatillo: tras cerrar el día O pasadas las 21:00 (lo que ocurra primero)
    const hora = new Date().getHours();
    const yaCerro = !!closures[todayKey];
    if (!yaCerro && hora < 21) { c.innerHTML = ''; return; }

    const tom = new Date();
    tom.setDate(tom.getDate() + 1);
    const tomorrowKey = UI.localDateKey(tom);

    const list = Storage.get().tasks.filter(t => !t.done && t.date === tomorrowKey);
    list.sort((a, b) => {
      const ai = a.important ? 1 : 0;
      const bi = b.important ? 1 : 0;
      if (ai !== bi) return bi - ai;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });

    const body = list.length
      ? list.map(t => renderItem(t, { noActions: true, preview: true })).join('')
      : '<div class="empty">Mañana sin tareas aún · buen momento para planificar</div>';

    c.innerHTML = `
      <div class="section-card tomorrow-card">
        <div class="section-head">
          <div>
            <div class="section-title">🌙 Mañana</div>
            <div class="section-subtitle">Para ir preparando</div>
          </div>
          <button class="section-icon-btn" data-go="tasks-manage" aria-label="Gestionar tareas"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3"/><path d="M14 2v4M8 10v4M16 18v4"/></svg></button>
        </div>
        <div class="tomorrow-list">${body}</div>
      </div>`;
  }

  function renderFull() {
    const c = document.getElementById('tasks-full-list');
    if (!isLive(c)) return;

    // Archivo: tareas hechas, con agrupación por mes (vista especial)
    if (filter === 'archive') {
      renderDoneGrouped(c);
      return;
    }

    let list = Storage.get().tasks.slice();
    if (filter === 'scheduled') {
      // Programadas = tareas recurrentes activas (se repiten)
      list = list.filter(t => !t.done && t.recurrence && t.recurrence !== 'none');
    } else if (filter === 'once') {
      // Puntuales = tareas sin recurrencia, activas
      list = list.filter(t => !t.done && (!t.recurrence || t.recurrence === 'none'));
    }
    list.sort((a, b) => {
      if ((a.important?1:0) !== (b.important?1:0)) return (b.important?1:0) - (a.important?1:0);
      return (a.date || '').localeCompare(b.date || '');
    });
    if (list.length === 0) {
      const msg = filter === 'scheduled'
        ? 'Sin tareas recurrentes · crea una y elige que se repita'
        : 'Sin tareas puntuales pendientes';
      c.innerHTML = `<div class="empty">${msg}</div>`;
      return;
    }
    c.innerHTML = list.map(t => renderItem(t)).join('');
    bindClicks(c);
  }

  // Vista "Hechas": buscador + tareas agrupadas por mes con totales
  function renderDoneGrouped(c) {
    const allDone = Storage.get().tasks.filter(t => t.done);

    // Filtrado por búsqueda (nombre + nota)
    const q = doneSearchQuery.trim().toLowerCase();
    const filtered = q
      ? allDone.filter(t =>
          (t.name || '').toLowerCase().includes(q) ||
          (t.note || '').toLowerCase().includes(q)
        )
      : allDone;

    // Encabezado: buscador
    const searchHTML = `
      <div class="done-search-wrap">
        <input type="search"
          id="done-search-input"
          class="done-search-input"
          placeholder="Buscar por nombre o nota…"
          value="${escapeAttr(doneSearchQuery)}"
          autocomplete="off" />
        ${q ? `<button class="done-search-clear" id="done-search-clear" aria-label="Limpiar">×</button>` : ''}
      </div>
    `;

    if (filtered.length === 0) {
      const emptyMsg = q ? 'No hay coincidencias' : 'Sin tareas hechas todavía';
      c.innerHTML = `${searchHTML}<div class="empty">${emptyMsg}</div>`;
      bindDoneSearch(c);
      return;
    }

    // Agrupar por YYYY-MM usando doneAt (fallback: date original)
    const groups = {}; // { 'YYYY-MM': [tasks...] }
    filtered.forEach(t => {
      let monthKey;
      if (t.doneAt) {
        const d = new Date(t.doneAt);
        monthKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      } else if (t.date) {
        monthKey = t.date.slice(0, 7);
      } else {
        monthKey = '0000-00';
      }
      if (!groups[monthKey]) groups[monthKey] = [];
      groups[monthKey].push(t);
    });

    // Orden de meses: más reciente arriba
    const monthKeys = Object.keys(groups).sort((a, b) => b.localeCompare(a));
    const todayMonth = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    })();

    // Por defecto: mes actual abierto, resto cerrados. Pero respeta lo que el usuario haya tocado.
    const isMonthOpen = (mk) => {
      if (mk in doneMonthsOpen) return doneMonthsOpen[mk];
      return mk === todayMonth;
    };

    const monthCardHTML = (mk) => {
      const tasks = groups[mk];
      // Ordenar dentro del mes: más recientes primero
      tasks.sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));

      const monthLabel = mk === '0000-00'
        ? 'Sin fecha'
        : new Date(mk + '-15T12:00:00').toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });

      const open = isMonthOpen(mk);
      return `
        <div class="done-month ${open ? 'open' : ''}">
          <button class="done-month-head" data-month-toggle="${mk}" aria-expanded="${open}">
            <span class="done-month-arrow">${open ? '▼' : '▶'}</span>
            <span class="done-month-title">${monthLabel}</span>
            <span class="done-month-meta">${tasks.length} ${tasks.length === 1 ? 'hecha' : 'hechas'}</span>
          </button>
          <div class="done-month-body" ${open ? '' : 'hidden'}>
            ${tasks.map(t => renderItem(t)).join('')}
          </div>
        </div>
      `;
    };

    // Agrupar los meses por AÑO. Año más reciente abierto por defecto.
    const todayYear = String(new Date().getFullYear());
    const isYearOpen = (yk) => (yk in doneYearsOpen) ? doneYearsOpen[yk] : (yk === todayYear);
    const yearKeys = [...new Set(monthKeys.map(mk => mk.slice(0, 4)))].sort((a, b) => b.localeCompare(a));

    const monthsHTML = yearKeys.map(yk => {
      const yearLabel = yk === '0000' ? 'Sin fecha' : yk;
      const monthsOfYear = monthKeys.filter(mk => mk.slice(0, 4) === yk);
      const yearCount = monthsOfYear.reduce((n, mk) => n + groups[mk].length, 0);
      const yOpen = isYearOpen(yk);
      return `
        <div class="hist-year ${yOpen ? 'open' : ''}">
          <button class="hist-year-label" data-year-toggle="${yk}" type="button">
            <span class="hist-year-name">${yearLabel}</span>
            <span class="hist-year-count">${yearCount}</span>
            <span class="hist-year-chevron">▾</span>
          </button>
          <div class="hist-year-body">${monthsOfYear.map(monthCardHTML).join('')}</div>
        </div>
      `;
    }).join('');

    c.innerHTML = searchHTML + monthsHTML;
    bindDoneSearch(c);
    bindMonthToggles(c);
    bindClicks(c);
  }

  function bindDoneSearch(c) {
    const input = c.querySelector('#done-search-input');
    if (input) {
      input.addEventListener('input', (e) => {
        doneSearchQuery = e.target.value;
        renderFull();
        // Re-foco al input tras el re-render
        setTimeout(() => {
          const ni = document.getElementById('done-search-input');
          if (ni) {
            ni.focus();
            // Mantener cursor al final
            const v = ni.value;
            ni.setSelectionRange(v.length, v.length);
          }
        }, 0);
      });
    }
    const clear = c.querySelector('#done-search-clear');
    if (clear) {
      clear.addEventListener('click', (e) => {
        e.stopPropagation();
        doneSearchQuery = '';
        renderFull();
      });
    }
  }

  function bindMonthToggles(c) {
    c.querySelectorAll('[data-year-toggle]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const yk = btn.dataset.yearToggle;
        const todayYear = String(new Date().getFullYear());
        const current = (yk in doneYearsOpen) ? doneYearsOpen[yk] : (yk === todayYear);
        doneYearsOpen[yk] = !current;
        renderFull();
      });
    });
    c.querySelectorAll('[data-month-toggle]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mk = btn.dataset.monthToggle;
        const todayMonth = (() => {
          const d = new Date();
          return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        })();
        const current = (mk in doneMonthsOpen) ? doneMonthsOpen[mk] : (mk === todayMonth);
        doneMonthsOpen[mk] = !current;
        renderFull();
      });
    });
  }

  function renderItem(t, opts = {}) {
    const area = Storage.get().areas.find(a => a.id === t.area);
    const dl = formatTaskDate(t.date);
    const recLabel = {
      daily: 'DIARIA',
      weekly: 'SEMANAL',
      monthly: 'MENSUAL',
      yearly: 'ANUAL',
    }[t.recurrence];
    const overdue = !!opts.overdue;
    // Calcular cuántos días lleva atrasada (vs hoy)
    let overdueDays = 0;
    if (overdue && t.date) {
      const todayKey = UI.todayKey();
      const dToday = new Date(todayKey + 'T12:00:00');
      const dTask = new Date(t.date + 'T12:00:00');
      overdueDays = Math.max(1, Math.round((dToday - dTask) / 86400000));
    }
    const overdueBadge = overdue
      ? `<span class="overdue-badge">${overdueDays === 1 ? '1 día atrasada' : `${overdueDays} días atrasada`}</span>`
      : '';

    // Para tareas hechas (filtro "Hechas"): mostrar fecha de realización y nota si existe
    let doneInfo = '';
    if (t.done) {
      const doneLabel = t.doneAt
        ? new Date(t.doneAt).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: '2-digit' }).toUpperCase()
        : '—';
      doneInfo = `<span class="done-date">✓ ${doneLabel}</span>`;
    }
    const noteBlock = (t.done && t.note)
      ? `<div class="task-note">${escapeHtml(t.note)}</div>`
      : '';

    return `
      <div class="item ${t.done ? 'done' : ''} ${overdue ? 'overdue' : ''} ${opts.preview ? 'preview' : ''}" data-id="${t.id}">
        ${opts.preview
          ? '<span class="checkbox preview" aria-hidden="true"></span>'
          : `<button class="checkbox ${t.done ? 'checked' : ''}" data-action="toggle">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>
        </button>`}
        ${t.important ? '<span class="item-icon">⭐</span>' : ''}
        <div class="item-body">
          <div class="item-name">${escapeHtml(t.name)}${overdueBadge}</div>
          <div class="item-meta">
            ${doneInfo || (dl ? `<span>${dl}</span>` : '')}
            ${area ? `<span class="area-tag">${area.name}</span>` : ''}
            ${recLabel ? `<span class="recurrence-badge">🔁 ${recLabel}</span>` : ''}
          </div>
          ${noteBlock}
        </div>
        ${opts.noActions ? '' : `
        <div class="item-actions">
          <button class="item-edit" data-action="edit" aria-label="Editar">✎</button>
          <button class="item-delete" data-action="delete">×</button>
        </div>`}
      </div>`;
  }

  function formatTaskDate(d) {
    if (!d) return '';
    if (d === UI.todayKey()) return 'HOY';
    // Calcular "mañana" en hora local
    const tom = new Date();
    tom.setDate(tom.getDate() + 1);
    const tomKey = `${tom.getFullYear()}-${String(tom.getMonth()+1).padStart(2,'0')}-${String(tom.getDate()).padStart(2,'0')}`;
    if (d === tomKey) return 'MAÑANA';
    // Parsear fecha como local (mediodía evita problemas de zona horaria)
    return new Date(d + 'T12:00:00').toLocaleDateString('es-CL', { day: '2-digit', month: 'short' }).toUpperCase();
  }

  function bindClicks(c) {
    c.querySelectorAll('[data-action]').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        const id = b.closest('.item').dataset.id;
        if (b.dataset.action === 'toggle') toggle(id);
        if (b.dataset.action === 'delete') remove(id);
        if (b.dataset.action === 'edit') openCreateModal(id);
      });
    });
  }

  function openCreateModal(editId = null) {
    const state = Storage.get();
    const editing = editId ? state.tasks.find(t => t.id === editId) : null;
    const areasOpts = state.areas.map(a => `<option value="${a.id}" ${editing && editing.area === a.id ? 'selected' : ''}>${a.icon} ${a.name}</option>`).join('');
    const goalsOpts = state.goals.filter(g => !g.done && !g.archived).map(g => `<option value="${g.id}" ${editing && editing.goalId === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('');
    const today = UI.todayKey();
    const currentRec = (editing && editing.recurrence) || 'none';
    const recOpts = [
      ['none', 'No se repite'],
      ['monthly', '🔁 Mensual'],
      ['yearly', '🔁 Anual'],
    ].map(([v, l]) => `<option value="${v}" ${currentRec === v ? 'selected' : ''}>${l}</option>`).join('');

    // Campos extra solo cuando editamos una tarea HECHA (bitácora)
    const isEditingDone = editing && editing.done;
    const doneFieldsHTML = isEditingDone ? `
      <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border-soft)">
        <p style="color:var(--text-dim);font-size:11px;margin-bottom:8px;font-family:var(--font-mono);text-transform:uppercase;letter-spacing:0.5px">Bitácora</p>
        <label>Nota (opcional)</label>
        <textarea id="t-note" placeholder="Detalles relevantes">${editing.note ? escapeHtml(editing.note) : ''}</textarea>
      </div>
    ` : '';

    UI.openModal({
      title: editing ? 'Editar tarea' : 'Nueva tarea',
      okText: editing ? 'Guardar cambios' : 'Crear',
      bodyHTML: `
        <label>Nombre de la tarea</label>
        <input type="text" id="t-name" placeholder="Ej: Pagar la luz" value="${editing ? escapeAttr(editing.name) : ''}" />
        <label>Fecha</label>
        <input type="date" id="t-date" value="${editing ? editing.date : today}" />
        <label>🔁 Recurrencia</label>
        <select id="t-recurrence">${recOpts}</select>
        <p style="color:var(--text-dim);font-size:11px;margin-top:6px;line-height:1.4">Si es recurrente, al completarla se generará automáticamente la próxima ocurrencia.</p>
        <label>Área</label>
        <select id="t-area">${areasOpts}</select>
        ${goalsOpts ? `
          <label>Vincular a meta (opcional)</label>
          <select id="t-goal">
            <option value="">— Ninguna —</option>
            ${goalsOpts}
          </select>` : ''}
        <label style="display:flex;align-items:center;gap:8px;margin-top:14px;text-transform:none;">
          <input type="checkbox" id="t-imp" style="width:auto;margin:0" ${editing && editing.important ? 'checked' : ''} /> ⭐ Marcar como importante
        </label>
        ${doneFieldsHTML}
      `,
      onSave: () => {
        const name = document.getElementById('t-name').value.trim();
        if (!name) { UI.toast('Falta el nombre'); return false; }
        const date = document.getElementById('t-date').value;
        const area = document.getElementById('t-area').value;
        const goalId = document.getElementById('t-goal')?.value || null;
        const important = document.getElementById('t-imp').checked;
        const recurrence = document.getElementById('t-recurrence').value;
        if (editing) {
          editing.name = name;
          editing.date = date;
          editing.area = area;
          editing.goalId = goalId;
          editing.important = important;
          editing.recurrence = recurrence;
          // Campos de bitácora (solo si edita una hecha)
          if (isEditingDone) {
            const noteInp = document.getElementById('t-note');
            if (noteInp) {
              const note = noteInp.value.trim();
              if (note) editing.note = note;
              else delete editing.note;
            }
          }
          UI.toast('Tarea actualizada');
        } else {
          Storage.get().tasks.push({
            id: Storage.uid(), name, date, area, goalId, important,
            recurrence,
            seriesId: null, // se llena solo en las generadas automáticamente
            done: false, createdAt: Date.now(),
          });
          UI.toast(recurrence !== 'none' ? `Tarea recurrente creada (${recurrence})` : 'Tarea creada');
        }
        Storage.save();
        renderToday(); renderFull(); App.refreshKPIs();
      }
    });
  }

  return { renderToday, renderTomorrow, renderFull, openCreateModal, setFilter };
})();

/* ============================================
   GOALS
   ============================================ */
const Goals = (() => {
  const HORIZONS = ['week','month','year'];
  const HORIZON_LABEL = { week:'Semanal', month:'Mensual', year:'Anual' };
  const HORIZON_ORDER = { week: 1, month: 2, year: 3 };

  // Reordenamiento de metas dentro del mismo horizonte (excluyendo archivadas)
  function moveGoal(id, direction) {
    const state = Storage.get();
    const goals = state.goals;
    const target = goals.find(g => g.id === id);
    if (!target) return;
    const horizon = target.horizon;

    // Lista de metas del mismo horizonte NO archivadas, con índice global
    const sameGroup = [];
    goals.forEach((g, idx) => {
      if (g.horizon === horizon && !g.archived) {
        sameGroup.push({ goal: g, globalIdx: idx });
      }
    });

    const groupPos = sameGroup.findIndex(x => x.goal.id === id);
    if (groupPos === -1) return;

    const newGroupPos = groupPos + direction;
    if (newGroupPos < 0 || newGroupPos >= sameGroup.length) return;

    const idxA = sameGroup[groupPos].globalIdx;
    const idxB = sameGroup[newGroupPos].globalIdx;
    [goals[idxA], goals[idxB]] = [goals[idxB], goals[idxA]];

    Storage.save();
    renderAll();
    renderWeeklyMini();
    UI.buzz(8);
  }

  function canMoveGoal(id, direction) {
    const state = Storage.get();
    const target = state.goals.find(g => g.id === id);
    if (!target) return false;
    const sameGroup = state.goals.filter(g => g.horizon === target.horizon && !g.archived);
    const pos = sameGroup.findIndex(g => g.id === id);
    if (direction === -1) return pos > 0;
    if (direction === 1) return pos < sameGroup.length - 1;
    return false;
  }

  function getProgress(g) {
    if (g.target && g.target > 0) return Math.min(100, Math.round((g.current / g.target) * 100));
    return g.done ? 100 : 0;
  }

  /**
   * Devuelve metas que pueden ser "padres" de la meta dada
   * (mismo área, horizonte mayor, cuantitativas, no archivadas).
   */
  function getPossibleParents(goal) {
    const state = Storage.get();
    const order = HORIZON_ORDER[goal.horizon] || 0;
    return state.goals.filter(g =>
      g.id !== goal.id &&
      !g.archived &&
      g.target > 0 &&
      HORIZON_ORDER[g.horizon] > order &&
      g.area === goal.area
    );
  }

  /**
   * Propaga un cambio (delta) hacia la meta padre.
   * Cuando una meta vinculada se cumple, suma su target a la padre.
   * Cuando se descumple, resta.
   */
  function propagateToParent(goal, delta) {
    if (!goal.parentGoalId || delta === 0) return;
    const state = Storage.get();
    // Permitir propagar incluso si el padre está archivado (para ediciones retroactivas)
    const parent = state.goals.find(g => g.id === goal.parentGoalId);
    if (!parent || !parent.target) return;
    const parentWasDone = !!parent.done;
    parent.current = Math.max(0, (parent.current || 0) + delta);
    parent.done = parent.current >= parent.target;
    if (!parentWasDone && parent.done) parent.doneAt = Date.now();
    if (parentWasDone && !parent.done) delete parent.doneAt;
    // Propagar recursivamente hacia el abuelo, bisabuelo, etc.
    // Así una semanal vinculada a mensual vinculada a anual actualiza la anual también.
    if (parent.parentGoalId) {
      propagateToParent(parent, delta);
    }
  }

  function updateCurrent(id, v) {
    const s = Storage.get();
    const g = s.goals.find(x => x.id === id);
    if (!g) return;
    const oldCurrent = g.current || 0;
    const wasDone = !!g.done;
    g.current = Math.max(0, +v || 0);
    g.done = g.target ? g.current >= g.target : g.done;
    if (!wasDone && g.done) g.doneAt = Date.now();
    if (wasDone && !g.done) delete g.doneAt;

    // Propagar el delta proporcional al padre (en tiempo real, no esperar al 100%)
    const delta = g.current - oldCurrent;
    if (delta !== 0) propagateToParent(g, delta);

    Storage.save();
    renderAll(); renderWeeklyMini(); App.refreshKPIs();
  }

  /**
   * Edita el current de una meta ARCHIVADA y ajusta el padre con el delta correcto.
   * Usa propagatedCurrent (lo que ya se sumó al padre) como referencia para no duplicar.
   */
  function updateArchivedCurrent(id, newValue) {
    const s = Storage.get();
    const g = s.goals.find(x => x.id === id);
    if (!g || !g.archived) return;

    const oldCurrent = g.current || 0;
    const newCurrent = Math.max(0, +newValue || 0);
    if (newCurrent === oldCurrent) return;

    g.current = newCurrent;
    const wasDone = g.done;
    g.done = g.target ? g.current >= g.target : g.done;

    // Calcular cuánto se debe ajustar el padre
    if (g.parentGoalId && g.target > 0) {
      const previouslyPropagated = g.propagatedCurrent != null
        ? g.propagatedCurrent
        : (wasDone ? g.target : oldCurrent);

      // Lo que corresponde aportar ahora al padre
      let nowPropagated;
      if (g.done) {
        nowPropagated = g.target;
      } else {
        nowPropagated = g.current;
      }

      const delta = nowPropagated - previouslyPropagated;
      if (delta !== 0) {
        propagateToParent(g, delta);
      }
      g.propagatedCurrent = nowPropagated;
    }

    Storage.save();
    renderAll(); renderWeeklyMini(); App.refreshKPIs();
    UI.toast('Avance archivado actualizado · padre recalculado');
  }

  function toggleDone(id) {
    const s = Storage.get();
    const g = s.goals.find(x => x.id === id);
    if (!g) return;
    const oldCurrent = g.current || 0;
    const oldDone = g.done;
    g.done = !g.done;
    if (g.done) g.doneAt = Date.now(); else delete g.doneAt;
    // Si la marca como hecha, llevar current al target. Si la desmarca y current está en target, no tocar current.
    if (g.done && g.target) g.current = g.target;

    // Propagar el delta real (no target completo) para evitar doble suma
    if (g.target > 0) {
      const newCurrent = g.current || 0;
      const delta = newCurrent - oldCurrent;
      if (delta !== 0) propagateToParent(g, delta);
    }

    Storage.save();
    renderAll(); renderWeeklyMini(); App.refreshKPIs();
    UI.buzz(20);
  }

  function remove(id) {
    const g = Storage.get().goals.find(x => x.id === id);
    if (!g) return;
    const children = Storage.get().goals.filter(c => c.parentGoalId === id);
    const childrenWarning = children.length > 0
      ? `<br><br><strong style="color:var(--accent-orange)">⚠️ ${children.length} meta${children.length>1?'s':''} vinculada${children.length>1?'s':''}</strong> se desvincularán (no se eliminan).`
      : '';
    UI.confirm2({
      title: '🗑️ Eliminar meta',
      message: `¿Eliminar la meta "<strong>${escapeHtml(g.name)}</strong>"?${childrenWarning}`,
      okText: 'Eliminar',
      danger: true,
      onConfirm: () => {
        const s = Storage.get();
        // Restar el aporte al padre. Usa propagatedCurrent si la meta estaba archivada
        // (refleja exactamente lo que se sumó al padre, sea total o parcial).
        if (g.parentGoalId && g.target > 0) {
          const parent = s.goals.find(p => p.id === g.parentGoalId);
          if (parent) {
            let aporte = 0;
            if (g.archived && g.propagatedCurrent != null) {
              aporte = g.propagatedCurrent;
            } else if (g.done) {
              aporte = g.target;
            }
            if (aporte > 0) {
              parent.current = Math.max(0, (parent.current || 0) - aporte);
              parent.done = parent.target ? (parent.current >= parent.target) : parent.done;
            }
          }
        }
        // Limpiar referencias en hijas
        s.goals.forEach(child => {
          if (child.parentGoalId === id) child.parentGoalId = null;
        });
        // Limpiar referencias en hábitos
        s.habits.forEach(h => {
          if (h.linkedGoalId === id) h.linkedGoalId = null;
        });
        // Limpiar referencias en tareas
        s.tasks.forEach(t => {
          if (t.goalId === id) t.goalId = null;
        });
        // Eliminar la meta
        s.goals = s.goals.filter(g => g.id !== id);
        Storage.save();
        renderAll(); renderWeeklyMini(); App.refreshKPIs();
        UI.toast('Meta eliminada');
      }
    });
  }

  // Horizonte actualmente seleccionado en las pestañas internas de Metas (Hoy)
  let currentInnerHorizon = 'week';

  function renderWeeklyMini() {
    const c = document.getElementById('goals-unified-list');
    if (!isLive(c)) return;
    const list = Storage.get().goals.filter(g =>
      g.horizon === currentInnerHorizon && !g.archived
    ).sort((a, b) => (a.done === b.done) ? 0 : (a.done ? 1 : -1));
    const emptyMsg = {
      'week':    'Sin metas semanales · usa el ícono de arriba para crear',
      'month':   'Sin metas mensuales · usa el ícono de arriba para crear',
      'year':    'Sin metas anuales · usa el ícono de arriba para crear',
    }[currentInnerHorizon] || 'Sin metas';
    if (list.length === 0) {
      c.innerHTML = `<div class="empty">${emptyMsg}</div>`;
      return;
    }
    c.innerHTML = list.map(renderGoalMini).join('');
  }

  function setInnerHorizon(horizon) {
    currentInnerHorizon = horizon;
    document.querySelectorAll('.goals-inner-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.innerHorizon === horizon);
    });
    renderWeeklyMini();
  }

  // Horizonte activo de las metas en "Hoy". Semanal por defecto.
  let todayGoalsHorizon = 'week';

  // Metas en "Hoy": pestañas Semanal / Mensual / Anual (una a la vez),
  // mismo formato que el sheet de Metas. Semanal por defecto.
  function renderTodayGoals() {
    const c = document.getElementById('today-goals');
    if (!isLive(c)) return;
    const state = Storage.get();

    const tabs = [
      ['week',  'Semanal'],
      ['month', 'Mensual'],
      ['year',  'Anual'],
    ];

    const list = state.goals
      .filter(g => g.horizon === todayGoalsHorizon && !g.archived)
      .sort((a, b) => (a.done === b.done) ? 0 : (a.done ? 1 : -1));

    const tabsHtml = tabs.map(([hz, label]) =>
      `<button class="goals-inner-tab ${hz === todayGoalsHorizon ? 'active' : ''}" data-today-horizon="${hz}" type="button">${label}</button>`
    ).join('');

    const listHtml = list.length
      ? list.map(renderGoalMini).join('')
      : '<div class="empty">Sin metas en este período</div>';

    c.innerHTML =
      `<div class="goals-inner-tabs" id="today-goals-tabs">${tabsHtml}</div>` +
      `<div id="today-goals-list">${listHtml}</div>`;

    // Cambiar de pestaña
    c.querySelectorAll('[data-today-horizon]').forEach(btn => {
      btn.addEventListener('click', () => {
        todayGoalsHorizon = btn.dataset.todayHorizon;
        renderTodayGoals();
      });
    });

    // Tap en una meta → registrar avance
    c.querySelectorAll('[data-goal-quick]').forEach(item => {
      item.addEventListener('click', () => openQuickProgressModal(item.dataset.goalQuick));
    });
  }

  function renderGoalMini(g) {
    const pct = g.done ? 100 : getProgress(g);
    const tt = g.done ? '✓' : (g.target ? `${g.current || 0}/${g.target} ${g.unit || ''}`.trim() : `${pct}%`);
    return `
      <div class="goal-mini-item ${g.done ? 'done' : ''}" data-goal-quick="${g.id}">
        <div class="goal-mini-row">
          <span class="goal-mini-name">${escapeHtml(g.name)}</span>
          <span class="goal-mini-progress">${tt}</span>
        </div>
        <div class="goal-bar"><div class="goal-bar-fill" style="width:${pct}%"></div></div>
      </div>`;
  }

  // Modal compacto para registrar avance rápido desde Hoy
  function openQuickProgressModal(goalId) {
    const s = Storage.get();
    const g = s.goals.find(x => x.id === goalId);
    if (!g) return;
    // Si la meta no es cuantitativa (sin target), marcar/desmarcar como hecha
    if (!g.target || g.target <= 0) {
      toggleDone(goalId);
      return;
    }
    const cur = g.current || 0;
    const remaining = Math.max(0, g.target - cur);
    const pct = getProgress(g);
    UI.openModal({
      title: `📌 ${g.name}`,
      okText: 'Cerrar',
      bodyHTML: `
        <div class="qty-modal-info">
          <div class="qty-goal-row">
            <span class="qty-goal-name">Avance actual</span>
            <span class="qty-goal-progress" id="qp-current-label">${cur}/${g.target} ${g.unit || ''}</span>
          </div>
          <div class="qty-bar"><div class="qty-bar-fill" id="qp-bar-fill" style="width:${pct}%"></div></div>
        </div>

        <label>Sumar o restar ${g.unit ? `(en ${g.unit})` : ''}</label>
        <div class="qp-adjust-row">
          <button type="button" class="qp-adjust-btn qp-minus" data-qp-sign="-1">−</button>
          <input type="number" id="qp-amount" min="0" step="any" placeholder="0" value="" />
          <button type="button" class="qp-adjust-btn qp-plus" data-qp-sign="1">+</button>
        </div>
        ${remaining > 0 ? `<p style="color:var(--text-faint);font-size:11px;margin-top:6px">Te faltan ${remaining} ${g.unit || ''} para completar</p>` : ''}

        <label style="margin-top:14px">O fijar valor exacto</label>
        <div class="qp-set-row">
          <input type="number" id="qp-set" min="0" step="any" placeholder="${cur}" value="" />
          <button type="button" class="qp-set-btn" id="qp-set-btn">Fijar</button>
        </div>
        <p style="color:var(--text-faint);font-size:11px;margin-top:6px">Útil si te equivocaste y quieres corregir el total</p>
      `,
      onSave: () => true
    });

    // Helper para refrescar el modal sin cerrarlo
    function refreshModalUI() {
      const sNow = Storage.get();
      const gNow = sNow.goals.find(x => x.id === goalId);
      if (!gNow) return;
      const curNow = gNow.current || 0;
      const pctNow = getProgress(gNow);
      const label = document.getElementById('qp-current-label');
      const bar = document.getElementById('qp-bar-fill');
      if (label) label.textContent = `${curNow}/${gNow.target} ${gNow.unit || ''}`;
      if (bar) bar.style.width = pctNow + '%';
    }

    // Bind +/-
    setTimeout(() => {
      document.querySelectorAll('.qp-adjust-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const sign = parseInt(btn.dataset.qpSign, 10);
          const v = parseFloat(document.getElementById('qp-amount').value) || 0;
          if (v <= 0) { UI.toast('Ingresa un número mayor a 0'); return; }
          const sNow = Storage.get();
          const gNow = sNow.goals.find(x => x.id === goalId);
          if (!gNow) return;
          const delta = sign * v;
          updateCurrent(goalId, (gNow.current || 0) + delta);
          UI.buzz(10);
          refreshModalUI();
          document.getElementById('qp-amount').value = '';
          if (sign > 0) {
            const updated = Storage.get().goals.find(x => x.id === goalId);
            if (updated && updated.current >= updated.target) UI.toast(`✓ ${gNow.name} completada`);
            else UI.toast(`+${v} registrado`);
          } else {
            UI.toast(`−${v} revertido`);
          }
        });
      });

      // Bind Fijar
      const setBtn = document.getElementById('qp-set-btn');
      if (setBtn) {
        setBtn.addEventListener('click', () => {
          const v = parseFloat(document.getElementById('qp-set').value);
          if (Number.isNaN(v) || v < 0) { UI.toast('Ingresa un número válido'); return; }
          updateCurrent(goalId, v);
          UI.buzz(10);
          refreshModalUI();
          document.getElementById('qp-set').value = '';
          UI.toast(`Avance fijado en ${v}`);
        });
      }
    }, 50);
  }

  // Función obsoleta: ahora se renderiza unificado en Hoy
  function renderHorizonMini(horizon, containerId, emptyMsg) {
    const c = document.getElementById(containerId);
    if (!c) return;
    const list = Storage.get().goals.filter(g => g.horizon === horizon && !g.done && !g.archived);
    if (list.length === 0) {
      c.innerHTML = `<div class="empty">${emptyMsg}</div>`;
      return;
    }
    c.innerHTML = list.map(renderGoalMini).join('');
  }

  // Genera la etiqueta del período al que pertenece la meta archivada
  function periodLabelForGoal(g) {
    const d = new Date(g.createdAt);
    if (g.horizon === 'week') {
      return weekRangeLabel(UI.weekKey(d));
    }
    if (g.horizon === 'month') {
      return d.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
    }
    if (g.horizon === 'quarter') {
      const q = Math.floor(d.getMonth() / 3) + 1;
      return `Q${q} · ${d.getFullYear()}`;
    }
    if (g.horizon === 'year') {
      return `${d.getFullYear()}`;
    }
    return '';
  }
  function periodGroupKey(g) {
    const d = new Date(g.createdAt);
    if (g.horizon === 'week') return UI.weekKey(d);
    if (g.horizon === 'month') return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    if (g.horizon === 'quarter') return `${d.getFullYear()}-Q${Math.floor(d.getMonth()/3)+1}`;
    if (g.horizon === 'year') return `${d.getFullYear()}`;
    return 'unk';
  }

  let showArchivedByHorizon = { week: false, month: false, quarter: false, year: false };

  // Helpers para agrupar archivadas por semana ISO
  function getGoalWeekKey(g) {
    // La semana a la que pertenece la meta = la semana en la que se creó
    return UI.weekKey(new Date(g.createdAt));
  }
  function weekRangeLabel(weekKey) {
    // weekKey: "2026-W18" → calcula lunes y domingo de esa semana ISO
    const m = weekKey.match(/^(\d{4})-W(\d{2})$/);
    if (!m) return weekKey;
    const year = +m[1], week = +m[2];
    // Primer jueves del año (regla ISO 8601)
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const jan4Day = jan4.getUTCDay() || 7;
    const week1Monday = new Date(jan4);
    week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
    const monday = new Date(week1Monday);
    monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    const fmt = (d) => d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', timeZone: 'UTC' });
    return `Semana ${week} · ${fmt(monday)} – ${fmt(sunday)}`;
  }

  function renderAll() {
    HORIZONS.forEach(h => {
      const c = document.querySelector(`.goal-list[data-horizon="${h}"]`);
      if (!c) return;
      const allList = Storage.get().goals.filter(g => g.horizon === h);
      const active = allList.filter(g => !g.archived);
      const archived = allList.filter(g => g.archived);

      let html = '';

      if (active.length === 0 && archived.length === 0) {
        html = `<div class="empty">Sin metas ${HORIZON_LABEL[h].toLowerCase()}es</div>`;
      } else {
        // Respetar el orden manual del usuario (no ordenar por done)
        html = active.map(renderCard).join('');

        // Sección de archivadas para CUALQUIER horizonte
        if (archived.length > 0) {
          // Agrupar por período
          const byPeriod = {};
          archived.forEach(g => {
            const key = periodGroupKey(g);
            if (!byPeriod[key]) byPeriod[key] = { goals: [], label: periodLabelForGoal(g) };
            byPeriod[key].goals.push(g);
          });
          const sortedKeys = Object.keys(byPeriod).sort().reverse();

          const groupsHTML = sortedKeys.map(key => {
            const group = byPeriod[key];
            const goals = group.goals.sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
            return `
              <div class="archived-week-group">
                <div class="archived-week-header">📦 ${group.label}</div>
                ${goals.map(renderArchivedCard).join('')}
              </div>`;
          }).join('');

          const isOpen = showArchivedByHorizon[h];
          const periodWord = { week: 'Semanas', month: 'Meses', year: 'Años' }[h];
          html += `
            <div class="archived-section">
              <button class="archived-toggle" data-toggle-archived data-horizon-toggle="${h}">
                <span>${isOpen ? '▼' : '▶'}</span>
                <span>${periodWord} anteriores (${archived.length} meta${archived.length>1?'s':''} · ${sortedKeys.length} ${sortedKeys.length>1?'períodos':'período'})</span>
              </button>
              <div style="display:${isOpen ? 'block' : 'none'}">
                ${groupsHTML}
              </div>
            </div>`;
        }
      }

      c.innerHTML = html;
      bindCardEvents(c);
      bindArchivedCardEvents(c);

      // Bind toggle de archivadas
      const togBtn = c.querySelector('[data-toggle-archived]');
      if (togBtn) {
        togBtn.addEventListener('click', () => {
          const hz = togBtn.dataset.horizonToggle;
          showArchivedByHorizon[hz] = !showArchivedByHorizon[hz];
          renderAll();
        });
      }
    });
  }

  function renderArchivedCard(g) {
    const state = Storage.get();
    const area = state.areas.find(a => a.id === g.area);
    const pct = getProgress(g);
    const archivedDate = g.archivedAt ? new Date(g.archivedAt).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' }) : '';
    const result = g.done ? '✓ CUMPLIDA' : `${pct}% completada`;
    const isQuant = g.target && g.target > 0;

    // Información de meta padre y aporte
    const parent = g.parentGoalId ? state.goals.find(p => p.id === g.parentGoalId) : null;
    const aporteNote = (parent && g.propagatedCurrent != null && g.propagatedCurrent > 0)
      ? `<span class="parent-contribution-note">↑ aportó ${g.propagatedCurrent} ${g.unit || ''} a "${escapeHtml(parent.name.length > 26 ? parent.name.slice(0,26)+'…' : parent.name)}"</span>`
      : (!parent && isQuant && (g.current || 0) > 0
          ? `<span class="parent-contribution-note" style="color:var(--text-faint)">Sin vincular a meta superior</span>`
          : '');

    return `
      <div class="goal-card archived" data-id="${g.id}">
        <div class="goal-card-head" style="display:flex;align-items:flex-start;gap:8px">
          <div class="goal-card-title" style="flex:1;min-width:0">${escapeHtml(g.name)}</div>
          <div class="item-actions">
            ${isQuant ? `<button class="item-edit" data-action="archived-quick-toggle" aria-label="Ajustar avance" title="Ajustar avance rápido">🔢</button>` : ''}
            <button class="item-edit" data-action="archived-edit-full" aria-label="Editar meta" title="Editar meta completa">✎</button>
            <button class="item-delete" data-action="delete">×</button>
          </div>
        </div>
        <div class="item-meta">
          ${area ? `<span class="area-tag">${area.name}</span>` : ''}
          <span>${result}</span>
        </div>
        <div class="goal-bar" style="margin-top:8px"><div class="goal-bar-fill" style="width:${pct}%"></div></div>
        ${aporteNote}
        <div class="goal-archived-date">📦 Archivada el ${archivedDate}</div>
        ${isQuant ? `
          <div class="goal-archived-edit-row" data-edit-row style="display:none">
            <input type="number" data-action="archived-current" value="${g.current || 0}" min="0" step="0.5" />
            <span style="font-family:var(--font-mono);font-size:11px;color:var(--text-dim);white-space:nowrap">/ ${g.target} ${g.unit || ''}</span>
            <button class="btn-secondary" data-action="archived-save" style="margin:0;padding:6px 12px;font-size:11px;width:auto">Guardar</button>
          </div>
        ` : ''}
      </div>`;
  }

  function bindArchivedCardEvents(c) {
    c.querySelectorAll('.goal-card.archived').forEach(card => {
      const id = card.dataset.id;
      const quickToggle = card.querySelector('[data-action="archived-quick-toggle"]');
      const editFull = card.querySelector('[data-action="archived-edit-full"]');
      const editRow = card.querySelector('[data-edit-row]');
      const saveBtn = card.querySelector('[data-action="archived-save"]');
      const input = card.querySelector('[data-action="archived-current"]');

      // 🔢 → mostrar/ocultar fila inline para ajustar solo el current
      if (quickToggle && editRow) {
        quickToggle.addEventListener('click', (e) => {
          e.stopPropagation();
          const visible = editRow.style.display !== 'none';
          editRow.style.display = visible ? 'none' : 'flex';
          card.classList.toggle('editing', !visible);
          if (!visible && input) input.focus();
        });
      }

      // ✎ → abrir modal completo para editar todos los campos
      if (editFull) {
        editFull.addEventListener('click', (e) => {
          e.stopPropagation();
          openCreateModal(id);
        });
      }

      // Guardar ajuste rápido inline
      if (saveBtn && input) {
        saveBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const newVal = input.value;
          const goal = Storage.get().goals.find(x => x.id === id);
          if (!goal) return;
          const parent = goal.parentGoalId ? Storage.get().goals.find(p => p.id === goal.parentGoalId) : null;
          UI.confirm2({
            title: 'Ajustar avance archivado',
            message: parent
              ? `Esto recalculará el avance de la meta superior "<strong>${escapeHtml(parent.name)}</strong>". ¿Continuar?`
              : '¿Guardar el nuevo avance para esta meta archivada?',
            okText: 'Guardar',
            onConfirm: () => updateArchivedCurrent(id, newVal)
          });
        });
      }
    });
  }

  function renderCard(g) {
    const state = Storage.get();
    const area = state.areas.find(a => a.id === g.area);
    const pct = getProgress(g);
    const isQuant = g.target && g.target > 0;

    // Buscar meta padre y metas hijas
    const parent = g.parentGoalId ? state.goals.find(p => p.id === g.parentGoalId && !p.archived) : null;
    const children = state.goals.filter(c => c.parentGoalId === g.id && !c.archived);
    const childrenDone = children.filter(c => c.done).length;

    // Sub-metas archivadas que aportaron a esta meta padre
    const archivedChildren = state.goals.filter(c => c.parentGoalId === g.id && c.archived && (c.propagatedCurrent || 0) > 0);
    const archivedSum = archivedChildren.reduce((s, c) => s + (c.propagatedCurrent || 0), 0);

    const parentBadge = parent ? `<span class="goal-link-badge" title="Vinculada a meta superior">↑ ${escapeHtml(parent.name.length > 22 ? parent.name.slice(0, 22) + '…' : parent.name)}</span>` : '';
    const childrenBadge = children.length > 0
      ? `<span class="goal-link-badge" title="Metas vinculadas">↓ ${childrenDone}/${children.length} sub-metas</span>`
      : '';
    const archivedChildrenBadge = archivedChildren.length > 0
      ? `<span class="goal-link-badge" title="Sub-metas archivadas que aportaron">📦 ${archivedChildren.length} aportó${archivedSum > 0 ? ' ' + archivedSum : ''} ${g.unit || ''}</span>`
      : '';

    const recurrenceBadge = (g.recurrence && g.recurrence !== 'none')
      ? `<span class="goal-link-badge goal-link-badge-recurring" title="Meta recurrente: ${recurrenceLabel(g.recurrence)}">🔁 ${recurrenceLabel(g.recurrence)}</span>`
      : '';

    const canUp = canMoveGoal(g.id, -1);
    const canDown = canMoveGoal(g.id, 1);

    return `
      <div class="goal-card ${g.done ? 'done' : ''}" data-id="${g.id}">
        <div class="goal-card-head" style="display:flex;align-items:flex-start;gap:8px">
          <div class="goal-card-title" style="flex:1;min-width:0">${g.done ? '✓ ' : ''}${escapeHtml(g.name)}</div>
          <div class="item-actions">
            <button class="item-edit" data-action="edit" aria-label="Editar">✎</button>
            <button class="item-delete" data-action="delete">×</button>
          </div>
          <div class="reorder-actions">
            <button class="reorder-btn" data-action="up" ${canUp ? '' : 'disabled'} aria-label="Subir">▲</button>
            <button class="reorder-btn" data-action="down" ${canDown ? '' : 'disabled'} aria-label="Bajar">▼</button>
          </div>
        </div>
        <div class="item-meta">
          ${area ? `<span class="area-tag">${area.name}</span>` : ''}
          <span>${pct}%</span>
          ${parentBadge}
          ${childrenBadge}
          ${archivedChildrenBadge}
          ${recurrenceBadge}
        </div>
        <div class="goal-bar" style="margin-top:8px"><div class="goal-bar-fill" style="width:${pct}%"></div></div>
        ${isQuant ? `
          <div class="goal-card-progress">
            <input type="number" data-action="current" value="${g.current || 0}" min="0" step="0.5" />
            <span>/ ${g.target} ${g.unit || ''}</span>
          </div>
        ` : `
          <div class="goal-card-progress">
            <button class="btn-secondary" data-action="toggle-done" style="margin:0;width:auto;padding:8px 14px;font-size:12px;">
              ${g.done ? '↩️ Reabrir' : '✓ Cumplida'}
            </button>
          </div>
        `}
      </div>`;
  }

  function bindCardEvents(c) {
    c.querySelectorAll('[data-action]').forEach(el => {
      const id = el.closest('.goal-card').dataset.id;
      const a = el.dataset.action;
      if (a === 'delete') el.addEventListener('click', () => remove(id));
      else if (a === 'current') el.addEventListener('change', () => updateCurrent(id, el.value));
      else if (a === 'toggle-done') el.addEventListener('click', () => toggleDone(id));
      else if (a === 'edit') el.addEventListener('click', () => openCreateModal(id));
      else if (a === 'up') el.addEventListener('click', () => moveGoal(id, -1));
      else if (a === 'down') el.addEventListener('click', () => moveGoal(id, 1));
    });
  }

  function openCreateModal(editId = null) {
    const state = Storage.get();
    const editing = editId ? state.goals.find(g => g.id === editId) : null;
    const isArchived = editing && editing.archived;

    const areasOpts = state.areas.map(a => `<option value="${a.id}" ${editing && editing.area === a.id ? 'selected' : ''}>${a.icon} ${a.name}</option>`).join('');
    const horizonOpts = [['week','📅 Semanal'],['month','🗓️ Mensual'],['year','🎯 Anual']]
      .map(([v,l]) => `<option value="${v}" ${editing && editing.horizon === v ? 'selected' : ''}>${l}</option>`).join('');
    const isQuant = editing ? (editing.target && editing.target > 0 ? 'quant' : 'qual') : 'quant';
    const typeOpts = [['quant','Cuantitativa (con número)'],['qual','Cualitativa (sí/no)']]
      .map(([v,l]) => `<option value="${v}" ${isQuant === v ? 'selected' : ''}>${l}</option>`).join('');

    // Opciones de recurrencia
    const currentRec = editing && editing.recurrence ? editing.recurrence : 'none';
    const recOpts = [
      ['none', 'Solo esta vez'],
      ['weekly', '🔁 Cada semana'],
      ['monthly', '🔁 Cada mes'],
      ['yearly', '🔁 Cada año'],
    ].map(([v, l]) => `<option value="${v}" ${currentRec === v ? 'selected' : ''}>${l}</option>`).join('');

    // Banner de advertencia para archivadas
    const archivedBanner = isArchived ? `
      <div class="archived-edit-banner">
        <span class="archived-edit-banner-icon">⚠️</span>
        <div>
          <strong>Esta meta está archivada.</strong>
          Los cambios en <em>vinculación</em>, <em>objetivo</em> o <em>área</em> recalcularán el aporte a las metas superiores. El horizonte no se puede modificar.
        </div>
      </div>` : '';

    UI.openModal({
      title: editing ? (isArchived ? 'Editar meta archivada' : 'Editar meta') : 'Nueva meta',
      okText: editing ? 'Guardar cambios' : 'Crear',
      bodyHTML: `
        ${archivedBanner}
        <label>Nombre de la meta</label>
        <input type="text" id="g-name" placeholder="Ej: Leer 100 páginas" value="${editing ? escapeAttr(editing.name) : ''}" />
        <label>Horizonte</label>
        <select id="g-horizon" ${isArchived ? 'disabled' : ''}>${horizonOpts}</select>
        ${isArchived ? '<p style="color:var(--text-faint);font-size:11px;margin-top:4px">El horizonte no se puede cambiar en metas archivadas.</p>' : ''}
        <label>Área de vida</label>
        <select id="g-area">${areasOpts}</select>
        <label>Tipo de meta</label>
        <select id="g-type">${typeOpts}</select>
        <div id="g-quant-wrap" style="display:${isQuant === 'quant' ? 'block' : 'none'}">
          <label>Cantidad objetivo</label>
          <input type="number" id="g-target" placeholder="100" min="1" step="0.5" value="${editing && editing.target ? editing.target : ''}" />
          <label>Unidad (opcional)</label>
          <input type="text" id="g-unit" placeholder="páginas, km, $..." value="${editing ? escapeAttr(editing.unit) : ''}" />
        </div>
        <div id="g-parent-wrap" style="display:none">
          <label>🔗 Vincular a meta superior <span style="text-transform:none;color:var(--text-faint)">(opcional)</span></label>
          <select id="g-parent">
            <option value="">— Sin vincular —</option>
          </select>
          <p style="color:var(--text-dim);font-size:11px;margin-top:6px;line-height:1.4">
            Cuando esta meta se cumpla, sumará su objetivo a la meta padre. Ej: si esta meta es "Leer 1 libro este mes" vinculada a "Leer 12 libros este año", al cumplir esta sumará 1 a la anual.
          </p>
        </div>
        ${isArchived ? '' : `
          <label>🔁 Recurrencia</label>
          <select id="g-recurrence">${recOpts}</select>
          <p style="color:var(--text-dim);font-size:11px;margin-top:6px;line-height:1.4">
            Si activas recurrencia, al cerrarse el ciclo (semana/mes/año) se creará automáticamente una nueva copia para el siguiente período. Para pausar: cambia a "Solo esta vez".
          </p>
        `}
      `,
      onSave: () => {
        const name = document.getElementById('g-name').value.trim();
        if (!name) { UI.toast('Falta el nombre'); return false; }
        // Si es archivada, mantener el horizon original (input deshabilitado igual lo devuelve)
        const horizon = isArchived ? editing.horizon : document.getElementById('g-horizon').value;
        const area = document.getElementById('g-area').value;
        const type = document.getElementById('g-type').value;
        let target = 0, unit = '';
        if (type === 'quant') {
          target = +document.getElementById('g-target').value || 0;
          unit = document.getElementById('g-unit').value.trim();
          if (target <= 0) { UI.toast('Define un objetivo > 0'); return false; }
        }
        const parentSel = document.getElementById('g-parent');
        const parentGoalId = parentSel ? (parentSel.value || null) : null;
        const recurrenceSel = document.getElementById('g-recurrence');
        const recurrence = recurrenceSel ? recurrenceSel.value : 'none';

        if (editing) {
          if (isArchived) {
            // ── EDICIÓN DE META ARCHIVADA: recalcular aporte al padre ──
            // 1) Calcular cuánto aportaba ANTES con su configuración previa
            const oldParentId = editing.parentGoalId || null;
            const oldTarget = editing.target || 0;
            const oldPropagated = editing.propagatedCurrent != null
              ? editing.propagatedCurrent
              : (editing.done ? oldTarget : (editing.current || 0));

            // 2) Si la meta sigue siendo cuantitativa, calcular nuevo aporte
            let newPropagated = 0;
            if (type === 'quant' && target > 0) {
              // Recalcular done con el nuevo target
              const newDone = (editing.current || 0) >= target;
              newPropagated = newDone ? target : (editing.current || 0);
              editing.done = newDone;
            } else {
              // Si pasó a cualitativa, no propaga
              newPropagated = 0;
              editing.done = false;
              editing.current = 0;
            }

            // 3) Restar lo viejo al padre viejo (si lo había)
            if (oldParentId && oldPropagated > 0) {
              const oldParent = Storage.get().goals.find(g => g.id === oldParentId);
              if (oldParent && oldParent.target) {
                oldParent.current = Math.max(0, (oldParent.current || 0) - oldPropagated);
                oldParent.done = oldParent.current >= oldParent.target;
              }
            }
            // 4) Sumar lo nuevo al padre nuevo (si lo hay)
            if (parentGoalId && newPropagated > 0) {
              const newParent = Storage.get().goals.find(g => g.id === parentGoalId);
              if (newParent && newParent.target) {
                newParent.current = Math.max(0, (newParent.current || 0) + newPropagated);
                newParent.done = newParent.current >= newParent.target;
              }
            }

            // 5) Persistir cambios en la meta
            editing.name = name;
            editing.area = area;
            editing.target = target;
            editing.unit = unit;
            editing.parentGoalId = parentGoalId;
            editing.propagatedCurrent = newPropagated;
            // Nota: no se permite cambiar horizon ni recurrence en archivadas

            UI.toast('📦 Meta archivada actualizada · padres recalculados');
          } else {
            // ── EDICIÓN DE META ACTIVA (lógica anterior, igual) ──
            const oldParentId = editing.parentGoalId || null;
            if (oldParentId !== parentGoalId && editing.done && editing.target > 0) {
              if (oldParentId) {
                const oldParent = Storage.get().goals.find(g => g.id === oldParentId && !g.archived);
                if (oldParent) {
                  oldParent.current = Math.max(0, (oldParent.current || 0) - editing.target);
                  oldParent.done = oldParent.current >= oldParent.target;
                }
              }
              if (parentGoalId) {
                const newParent = Storage.get().goals.find(g => g.id === parentGoalId && !g.archived);
                if (newParent) {
                  newParent.current = (newParent.current || 0) + editing.target;
                  newParent.done = newParent.current >= newParent.target;
                }
              }
            }
            editing.name = name;
            editing.horizon = horizon;
            editing.area = area;
            editing.target = target;
            editing.unit = unit;
            editing.parentGoalId = parentGoalId;
            editing.recurrence = recurrence;
            // Si activa recurrencia y no tiene seriesId, crearlo
            if (recurrence !== 'none' && !editing.seriesId) {
              editing.seriesId = Storage.uid();
            }
            if (type === 'qual') editing.current = 0;
            UI.toast('Meta actualizada');
          }
        } else {
          // ── NUEVA META ──
          const newGoal = {
            id: Storage.uid(), name, horizon, area, target, unit,
            parentGoalId,
            recurrence,
            seriesId: recurrence !== 'none' ? Storage.uid() : null,
            current: 0, done: false, createdAt: Date.now(),
          };
          Storage.get().goals.push(newGoal);
          UI.toast(recurrence !== 'none' ? `🔁 Meta recurrente creada (${recurrenceLabel(recurrence)})` : 'Meta creada');
        }
        Storage.save();
        renderAll(); renderWeeklyMini(); App.refreshKPIs();
      }
    });

    setTimeout(() => {
      const typeSel = document.getElementById('g-type');
      const horizonSel = document.getElementById('g-horizon');
      const areaSel = document.getElementById('g-area');
      const parentSel = document.getElementById('g-parent');

      // Función para refrescar las opciones de "meta padre"
      const refreshParents = () => {
        const horizon = horizonSel.value;
        const area = areaSel.value;
        const type = typeSel.value;
        const parentWrap = document.getElementById('g-parent-wrap');

        // Solo metas cuantitativas pueden tener padre
        if (type !== 'quant') {
          parentWrap.style.display = 'none';
          return;
        }

        // Buscar metas candidatas: misma área, horizonte mayor, cuantitativas, no archivadas
        const order = HORIZON_ORDER[horizon] || 0;
        const candidates = Storage.get().goals.filter(g =>
          (!editing || g.id !== editing.id) &&
          !g.archived &&
          g.target > 0 &&
          HORIZON_ORDER[g.horizon] > order &&
          g.area === area
        );

        if (candidates.length === 0) {
          parentWrap.style.display = 'none';
          return;
        }

        parentWrap.style.display = 'block';
        const currentParentId = editing && editing.parentGoalId ? editing.parentGoalId : '';
        parentSel.innerHTML = '<option value="">— Sin vincular —</option>' +
          candidates.map(g => {
            const horizonLbl = { week:'Sem', month:'Mes', quarter:'Trim', year:'Año' }[g.horizon];
            const sel = currentParentId === g.id ? 'selected' : '';
            return `<option value="${g.id}" ${sel}>[${horizonLbl}] ${escapeHtml(g.name)} (${g.current||0}/${g.target} ${g.unit||''})</option>`;
          }).join('');
      };

      typeSel.addEventListener('change', () => {
        document.getElementById('g-quant-wrap').style.display = typeSel.value === 'quant' ? 'block' : 'none';
        refreshParents();
      });
      horizonSel.addEventListener('change', refreshParents);
      areaSel.addEventListener('change', refreshParents);

      // Inicializar
      refreshParents();
    }, 50);
  }

  function recurrenceLabel(rec) {
    return {
      weekly: 'cada semana',
      monthly: 'cada mes',
      quarterly: 'cada trimestre',
      yearly: 'cada año',
    }[rec] || '';
  }

  return { renderAll, renderWeeklyMini, renderTodayGoals, openCreateModal, setInnerHorizon, openQuickProgressModal, updateCurrent };
})();

/* ============================================
   GOAL ARCHIVE — vista de metas archivadas
   Lee state.goals donde archived=true y las agrupa por período (derivado de createdAt+horizon).
   El archivado lo hace el módulo GoalRollover existente. Este módulo solo lee y muestra.
   ============================================ */
const GoalArchive = (() => {

  function getPct(g) {
    if (g.target && g.target > 0) return Math.min(100, Math.round(((g.current || 0) / g.target) * 100));
    return g.done ? 100 : 0;
  }

  function mondayOfISOWeek(year, week) {
    const simple = new Date(Date.UTC(year, 0, 4));
    const dow = simple.getUTCDay() || 7;
    const monday = new Date(simple);
    monday.setUTCDate(simple.getUTCDate() - dow + 1 + (week - 1) * 7);
    return new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate());
  }

  const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  function monthLabel(mk) {
    const [y, m] = mk.split('-');
    return `${MONTHS[parseInt(m, 10) - 1]} ${y}`;
  }
  const HORIZON_WORD = { week: 'Semanal', month: 'Mensual', year: 'Anual' };

  function weekRangeLabel(weekKey) {
    const [yStr, wStr] = weekKey.split('-W');
    const monday = mondayOfISOWeek(parseInt(yStr, 10), parseInt(wStr, 10));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const f = d => d.toLocaleDateString('es-CL', { day: 'numeric', month: 'short' }).replace(/\./g, '');
    return `${f(monday)} – ${f(sunday)}`;
  }

  // Ubica cada meta archivada en año / mes / semana según su horizonte.
  function placementFor(g) {
    const d = new Date(g.createdAt || g.archivedAt || Date.now());
    const pad = n => String(n).padStart(2, '0');
    if (g.horizon === 'year') {
      return { year: String(d.getFullYear()) };
    }
    if (g.horizon === 'month') {
      return { year: String(d.getFullYear()), month: `${d.getFullYear()}-${pad(d.getMonth() + 1)}` };
    }
    if (g.horizon === 'week') {
      const wk = UI.weekKey(d);
      const [yStr, wStr] = wk.split('-W');
      const monday = mondayOfISOWeek(parseInt(yStr, 10), parseInt(wStr, 10));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6); // ubicar por el fin de la semana
      const y = sunday.getFullYear();
      return { year: String(y), month: `${y}-${pad(sunday.getMonth() + 1)}`, week: wk };
    }
    return { year: String(d.getFullYear()) };
  }

  // Árbol: año → { metas anuales, meses → { metas mensuales, semanas → [metas semanales] } }
  function buildTree() {
    const archived = Storage.get().goals.filter(g => g.archived);
    const tree = {};
    archived.forEach(g => {
      const p = placementFor(g);
      const y = p.year;
      tree[y] = tree[y] || { yearGoals: [], months: {} };
      if (!p.month) { tree[y].yearGoals.push(g); return; }
      tree[y].months[p.month] = tree[y].months[p.month] || { monthGoals: [], weeks: {} };
      if (!p.week) { tree[y].months[p.month].monthGoals.push(g); return; }
      tree[y].months[p.month].weeks[p.week] = tree[y].months[p.month].weeks[p.week] || [];
      tree[y].months[p.month].weeks[p.week].push(g);
    });
    return tree;
  }

  // Estado de expansión (persistente en la sesión).
  const expanded = { years: new Set(), months: new Set(), weeks: new Set() };
  let defaultsSet = false;

  function subsection(title, goals) {
    if (!goals.length) return '';
    return `<div class="archive-subsection"><div class="archive-subsection-title">${title}</div>${goals.map(renderArchivedGoal).join('')}</div>`;
  }

  function renderWeek(wk, goals) {
    const isOpen = expanded.weeks.has(wk);
    return `
      <div class="archive-week ${isOpen ? 'is-open' : ''}">
        <button class="archive-toggle archive-week-toggle" data-gt-week="${wk}">
          <span class="archive-arrow">${isOpen ? '▼' : '▶'}</span>
          <span class="archive-label">🗓️ ${weekRangeLabel(wk)}</span>
        </button>
        ${isOpen ? `<div class="archive-content">${goals.map(renderArchivedGoal).join('')}</div>` : ''}
      </div>`;
  }

  function renderMonth(mk, data) {
    const isOpen = expanded.months.has(mk);
    const weeks = Object.keys(data.weeks).sort().reverse();
    return `
      <div class="archive-month ${isOpen ? 'is-open' : ''}">
        <button class="archive-toggle archive-month-toggle" data-gt-month="${mk}">
          <span class="archive-arrow">${isOpen ? '▼' : '▶'}</span>
          <span class="archive-label">${monthLabel(mk)}</span>
        </button>
        ${isOpen ? `<div class="archive-content">${subsection('📆 Metas mensuales', data.monthGoals)}${weeks.map(wk => renderWeek(wk, data.weeks[wk])).join('')}</div>` : ''}
      </div>`;
  }

  function renderYear(year, data) {
    const isOpen = expanded.years.has(year);
    const months = Object.keys(data.months).sort().reverse();
    return `
      <div class="archive-year ${isOpen ? 'is-open' : ''}">
        <button class="archive-toggle archive-year-toggle" data-gt-year="${year}">
          <span class="archive-arrow">${isOpen ? '▼' : '▶'}</span>
          <span class="archive-label">📅 ${year}</span>
        </button>
        ${isOpen ? `<div class="archive-content">${subsection('🏆 Metas anuales', data.yearGoals)}${months.map(mk => renderMonth(mk, data.months[mk])).join('')}</div>` : ''}
      </div>`;
  }

  function render() {
    const c = document.getElementById('goal-archive-list');
    if (!isLive(c)) return;
    const tree = buildTree();
    const years = Object.keys(tree).sort().reverse();
    if (years.length === 0) {
      c.innerHTML = '<div class="empty">Aún no hay metas archivadas · cuando termine la semana, el mes o el año verás aquí lo cerrado</div>';
      return;
    }
    // Defaults la primera vez: año más reciente abierto + su mes más reciente abierto.
    if (!defaultsSet) {
      const y0 = years[0];
      expanded.years.add(y0);
      const m0 = Object.keys(tree[y0].months).sort().reverse()[0];
      if (m0) expanded.months.add(m0);
      defaultsSet = true;
    }
    c.innerHTML = years.map(y => renderYear(y, tree[y])).join('');

    const toggle = (set, key) => { set.has(key) ? set.delete(key) : set.add(key); render(); };
    c.querySelectorAll('[data-gt-year]').forEach(b => b.addEventListener('click', () => toggle(expanded.years, b.dataset.gtYear)));
    c.querySelectorAll('[data-gt-month]').forEach(b => b.addEventListener('click', () => toggle(expanded.months, b.dataset.gtMonth)));
    c.querySelectorAll('[data-gt-week]').forEach(b => b.addEventListener('click', () => toggle(expanded.weeks, b.dataset.gtWeek)));
  }

  function renderArchivedGoal(g) {
    const pct = getPct(g);
    const icon = pct >= 100 ? '✅' : (pct >= 50 ? '🟡' : '⚪️');
    const base = g.target ? `${g.current || 0}/${g.target} ${g.unit || ''}`.trim() : (g.done ? 'Hecho' : 'No completada');
    const tt = `${HORIZON_WORD[g.horizon] || ''} · ${base}`;
    return `
      <div class="archive-goal" data-edit-archived="${g.id}">
        <div class="archive-goal-row">
          <span class="archive-goal-icon">${icon}</span>
          <div class="archive-goal-body">
            <div class="archive-goal-name">${escapeHtml(g.name)}</div>
            <div class="archive-goal-meta">${tt} · ${pct}%</div>
          </div>
          <span class="archive-goal-edit">✎</span>
        </div>
        <div class="archive-goal-bar"><div class="archive-goal-bar-fill" style="width:${pct}%"></div></div>
      </div>
    `;
  }

  // Editor de meta archivada (solo se puede cambiar current)
  function openEditModal(goalId) {
    const state = Storage.get();
    const g = state.goals.find(x => x.id === goalId && x.archived);
    if (!g) return;

    UI.openModal({
      title: '✎ Editar meta archivada',
      bodyHTML: `
        <div style="color:var(--text-dim);font-size:12px;margin-bottom:10px">${escapeHtml(g.name)}</div>
        <label>Avance final</label>
        <input type="number" id="edit-archived-current" min="0" step="any" value="${g.current || 0}" />
        ${g.target ? `<p style="color:var(--text-dim);font-size:12px;margin-top:6px">Meta: ${g.target} ${g.unit || ''}</p>` : ''}
        <p style="color:var(--text-faint);font-size:11px;margin-top:8px">Solo se puede corregir el avance. El nombre y la meta no se modifican.</p>
      `,
      onSave: () => {
        const v = parseFloat(document.getElementById('edit-archived-current').value) || 0;
        g.current = v;
        if (g.target && v >= g.target) g.done = true;
        else if (g.target) g.done = false;
        Storage.save();
        render();
        UI.toast('Avance actualizado');
      }
    });
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  return { render, openEditModal };
})();

/* ============================================
   FINANCE (gastos recurrentes, gastos puntuales e ingresos)
   ============================================ */
const Finance = (() => {

  // Categorías de gastos
  const EXPENSE_CATEGORIES = [
    { id: 'servicios',    name: 'Servicios básicos', icon: '🔌' },
    { id: 'vivienda',     name: 'Vivienda',          icon: '🏠' },
    { id: 'alimentacion', name: 'Alimentación',      icon: '🍽️' },
    { id: 'transporte',   name: 'Transporte',        icon: '🚗' },
    { id: 'salud',        name: 'Salud',             icon: '💊' },
    { id: 'ocio',         name: 'Ocio',              icon: '🎮' },
    { id: 'suscripciones',name: 'Suscripciones',     icon: '🔄' },
    { id: 'educacion',    name: 'Educación',         icon: '📚' },
    { id: 'deudas',       name: 'Deudas',            icon: '💳' },
    { id: 'vestuario',    name: 'Vestuario',         icon: '👕' },
    { id: 'mascotas',     name: 'Mascotas',          icon: '🐾' },
    { id: 'regalos',      name: 'Regalos',           icon: '🎁' },
    { id: 'tecnologia',   name: 'Tecnología',        icon: '💻' },
    { id: 'inversion',    name: 'Inversión/Ahorro',  icon: '🏦' },
    { id: 'otros',        name: 'Otros',             icon: '📦' },
    { id: 'ajuste',       name: 'Ajuste',            icon: '⚖️' },
  ];

  // Categorías de ingresos
  const INCOME_CATEGORIES = [
    { id: 'sueldo',     name: 'Sueldo',     icon: '💼' },
    { id: 'freelance',  name: 'Freelance',  icon: '🧑‍💻' },
    { id: 'inversion',  name: 'Inversión',  icon: '📈' },
    { id: 'venta',      name: 'Venta',      icon: '🏷️' },
    { id: 'reembolsos', name: 'Reembolsos', icon: '↩️' },
    { id: 'arriendo',   name: 'Arriendo',   icon: '🏘️' },
    { id: 'bonos',      name: 'Bonos',      icon: '🏅' },
    { id: 'otros',      name: 'Otros',      icon: '💵' },
    { id: 'ajuste',     name: 'Ajuste',     icon: '⚖️' },
  ];

  // Recurrencias para gastos (puntual = solo evento, los otros son configurables y se repiten)
  const RECURRENCES = [
    { id: 'once',      name: 'Puntual',     short: 'Puntual' },
    { id: 'monthly',   name: 'Mensual',     short: 'Mensual' },
    { id: 'quarterly', name: 'Trimestral',  short: 'Trimestral' },
    { id: 'yearly',    name: 'Anual',       short: 'Anual' },
  ];

  // Sub-tabs (orden visible)
  const SUB_TABS = [
    { id: 'scheduled', label: 'Pagos programados' },
    { id: 'income',    label: 'Ingresos' },
    { id: 'once',      label: 'Gastos' },
    { id: 'archive',   label: 'Archivo' },
  ];

  let activeSubTab = 'scheduled'; // por defecto: pagos programados (recurrentes)

  function getExpenseCategory(id) {
    return EXPENSE_CATEGORIES.find(c => c.id === id) || EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1];
  }
  function getIncomeCategory(id) {
    return INCOME_CATEGORIES.find(c => c.id === id) || INCOME_CATEGORIES[INCOME_CATEGORIES.length - 1];
  }
  function getRecurrence(id) {
    return RECURRENCES.find(r => r.id === id) || RECURRENCES[0];
  }

  function formatCLP(n) {
    if (n == null || isNaN(n)) return '';
    return '$' + Math.round(Number(n)).toLocaleString('es-CL');
  }

  // Distancia en días desde hoy hasta el próximo día de pago (1-31). Para ordenar por proximidad.
  function daysUntilDueDay(dueDay) {
    if (!dueDay) return 9999;
    const today = new Date();
    const cur = today.getDate();
    const year = today.getFullYear();
    const month = today.getMonth();
    // Si ya pasó el día este mes → próximo mes
    if (cur > dueDay) {
      const nextMonth = new Date(year, month + 1, Math.min(dueDay, 28));
      // Ajustar a dueDay real (clamp si el mes no lo tiene)
      const daysInNext = new Date(year, month + 2, 0).getDate();
      nextMonth.setDate(Math.min(dueDay, daysInNext));
      return Math.round((nextMonth - today) / 86400000);
    } else {
      return dueDay - cur;
    }
  }

  // ====== RENDER PRINCIPAL ======
  function render() {
    renderSubTabs();
    renderActiveList();
  }

  function renderSubTabs() {
    const c = document.getElementById('finance-subtabs');
    if (!c) return;
    c.innerHTML = SUB_TABS.map(t =>
      `<button class="chip ${activeSubTab === t.id ? 'active' : ''}" data-finance-subtab="${t.id}">${t.label}</button>`
    ).join('');
    c.querySelectorAll('[data-finance-subtab]').forEach(btn => {
      btn.addEventListener('click', () => {
        activeSubTab = btn.dataset.financeSubtab;
        render();
      });
    });
  }

  function renderActiveList() {
    const c = document.getElementById('finance-list');
    if (!c) return;
    if (activeSubTab === 'income') {
      renderIncomeList(c);
    } else if (activeSubTab === 'once') {
      renderOnceExpensesList(c);
    } else if (activeSubTab === 'archive') {
      // El archivo histórico se renderiza dentro de su propio contenedor,
      // que renderArchive() busca por id.
      c.innerHTML = '<div id="finance-archive-list"></div>';
      renderArchive();
    } else {
      renderScheduledList(c);
    }
  }

  // Pagos programados: TODOS los recurrentes juntos, ordenados por proximidad
  // de vencimiento. La frecuencia se muestra como etiqueta en cada ítem.
  function renderScheduledList(c) {
    const list = (Storage.get().recurringExpenses || []).slice();
    if (list.length === 0) {
      c.innerHTML = '<div class="empty">Sin pagos programados · toca "+ Nuevo movimiento" para crear</div>';
      return;
    }
    list.sort((a, b) => {
      const da = a.dueDay ? daysUntilDueDay(a.dueDay) : 9999;
      const db = b.dueDay ? daysUntilDueDay(b.dueDay) : 9999;
      if (da !== db) return da - db;
      return (a.name || '').localeCompare(b.name || '');
    });
    c.innerHTML = list.map(re => renderRecurringItem(re)).join('');
    bindRecurringActions(c);
  }

  // --- Movimientos puntuales: gastos puntuales + pagos hechos a gastos recurrentes
  // (ambos comparten naturaleza de "movimiento real registrado" y deben ser editables/eliminables)
  function renderOnceExpensesList(c) {
    const { start, end } = getMonthRange(getCurrentMonthKey());
    const list = (Storage.get().movements || []).filter(m =>
      m.type === 'expense' && m.date && m.date >= start && m.date <= end
    );
    if (list.length === 0) {
      c.innerHTML = '<div class="empty">Sin gastos este mes · los de meses anteriores están en Archivo</div>';
      return;
    }
    list.sort((a, b) => {
      const dateCmp = (b.date || '').localeCompare(a.date || '');
      if (dateCmp !== 0) return dateCmp;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    c.innerHTML = list.map(m => renderMovementItem(m)).join('');
    bindMovementActions(c);
  }

  // --- Ingresos del mes en curso (los de otros meses están en Archivo)
  function renderIncomeList(c) {
    const { start, end } = getMonthRange(getCurrentMonthKey());
    const list = (Storage.get().movements || []).filter(m =>
      m.type === 'income' && m.date && m.date >= start && m.date <= end
    );
    if (list.length === 0) {
      c.innerHTML = '<div class="empty">Sin ingresos este mes · toca "+ Nuevo movimiento" para registrar</div>';
      return;
    }
    list.sort((a, b) => {
      const dateCmp = (b.date || '').localeCompare(a.date || '');
      if (dateCmp !== 0) return dateCmp;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    c.innerHTML = list.map(m => renderMovementItem(m)).join('');
    bindMovementActions(c);
  }

  // --- Gastos recurrentes (recurringExpenses por tipo, ordenados por proximidad a fecha de pago)

  // ===== Item de gasto recurrente =====
  function renderRecurringItem(re) {
    const cat = getExpenseCategory(re.category);
    const rec = getRecurrence(re.recurrence);
    const amountLabel = re.defaultAmount
      ? `<span class="re-amount">${formatCLP(re.defaultAmount)}</span>`
      : '<span class="re-amount-empty">Variable</span>';
    const dayLabel = re.dueDay
      ? (re.recurrence === 'monthly' ? `Día ${re.dueDay}` : `Día ${re.dueDay} del mes de pago`)
      : 'Sin fecha definida';
    // Proximidad como hint sutil
    let proximityLabel = '';
    if (re.dueDay && re.recurrence === 'monthly' && !re.installmentsDone) {
      const d = daysUntilDueDay(re.dueDay);
      if (d === 0) proximityLabel = '<span class="re-proximity due-today">Hoy</span>';
      else if (d <= 3) proximityLabel = `<span class="re-proximity soon">En ${d}d</span>`;
      else if (d <= 7) proximityLabel = `<span class="re-proximity">En ${d}d</span>`;
    }
    // Cuotas: "Cuota 5/24" o "Completada 24/24" (cualquier categoría)
    let instLabel = '';
    if (re.installmentsTotal) {
      instLabel = re.installmentsDone
        ? `<span class="re-inst done">✓ ${re.installmentsTotal}/${re.installmentsTotal}</span>`
        : `<span class="re-inst">Cuota ${re.installmentsCurrent || 1}/${re.installmentsTotal}</span>`;
    }
    return `
      <div class="recurring-expense-item ${re.installmentsDone ? 'is-done' : ''}" data-id="${re.id}" data-kind="recurring">
        <div class="re-main">
          <div class="re-name">${cat.icon} ${escapeHtml(re.name)} ${proximityLabel}</div>
          <div class="re-meta">
            <span class="re-rec">${rec.name}</span>
            <span class="re-cat">${cat.name}</span>
            ${amountLabel}
            ${instLabel || `<span class="re-due">${dayLabel}</span>`}
          </div>
        </div>
        <div class="re-actions">
          <button class="re-edit" data-action="edit" aria-label="Editar">✎</button>
          <button class="re-delete" data-action="delete" aria-label="Eliminar">×</button>
        </div>
      </div>
    `;
  }

  // ===== Item de movimiento (gasto puntual o ingreso) =====
  function renderMovementItem(m, opts = {}) {
    const isIncome = m.type === 'income';
    const cat = isIncome ? getIncomeCategory(m.category) : getExpenseCategory(m.category);
    const dateLabel = m.date
      ? new Date(m.date + 'T12:00:00').toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: '2-digit' }).toUpperCase()
      : '—';
    const amountClass = isIncome ? 're-amount income' : 're-amount expense';
    const sign = isIncome ? '+' : '−';
    const noteBlock = m.note ? `<div class="task-note">${escapeHtml(m.note)}</div>` : '';
    const actionsBlock = opts.readonly ? '' : `
        <div class="re-actions">
          <button class="re-edit" data-action="edit" aria-label="Editar">✎</button>
          <button class="re-delete" data-action="delete" aria-label="Eliminar">×</button>
        </div>`;
    return `
      <div class="recurring-expense-item ${opts.readonly ? 'readonly' : ''}" data-id="${m.id}" data-kind="movement">
        <div class="re-main">
          <div class="re-name">${cat.icon} ${escapeHtml(m.name)}</div>
          <div class="re-meta">
            <span class="re-due">${dateLabel}</span>
            <span class="re-cat">${cat.name}</span>
            <span class="${amountClass}">${sign} ${formatCLP(m.amount)}</span>
          </div>
          ${noteBlock}
        </div>
        ${actionsBlock}
      </div>
    `;
  }

  function bindRecurringActions(c) {
    c.querySelectorAll('[data-kind="recurring"]').forEach(el => {
      const id = el.dataset.id;
      el.querySelector('[data-action="edit"]').addEventListener('click', (e) => {
        e.stopPropagation();
        openMovementModal({ editRecurringId: id });
      });
      el.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteRecurring(id);
      });
    });
  }

  function bindMovementActions(c) {
    c.querySelectorAll('[data-kind="movement"]').forEach(el => {
      const id = el.dataset.id;
      const editBtn = el.querySelector('[data-action="edit"]');
      const delBtn = el.querySelector('[data-action="delete"]');
      // Si el item está en modo readonly no tiene botones, salir
      if (!editBtn || !delBtn) return;
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openMovementModal({ editMovementId: id });
      });
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteMovement(id);
      });
    });
  }

  // ====== MODAL UNIFICADO: NUEVO MOVIMIENTO ======
  // Opciones:
  //  - prefillType: 'expense' | 'income' (para shortcuts del FAB)
  //  - editRecurringId: editar un recurringExpense existente
  //  - editMovementId: editar un movement existente
  function openMovementModal(opts = {}) {
    const state = Storage.get();
    let editing = null;       // un movement (expense puntual o income)
    let editingRecurring = null; // un recurringExpense

    if (opts.editMovementId) {
      editing = (state.movements || []).find(x => x.id === opts.editMovementId) || null;
    }
    if (opts.editRecurringId) {
      editingRecurring = (state.recurringExpenses || []).find(x => x.id === opts.editRecurringId) || null;
    }

    // Tipo inicial
    let initialType = 'expense';
    if (editing) initialType = editing.type;
    else if (editingRecurring) initialType = 'expense'; // los recurrentes son siempre gastos
    else if (opts.prefillType) initialType = opts.prefillType;

    // Recurrencia inicial
    let initialRec = 'once';
    if (editingRecurring) initialRec = editingRecurring.recurrence;
    else if (editing) initialRec = 'once'; // movement = siempre puntual

    // Estado del modal (mutable mientras está abierto)
    const modalState = { type: initialType, recurrence: initialRec };

    const isEditingSomething = editing || editingRecurring;
    const title = isEditingSomething ? 'Editar movimiento' : 'Nuevo movimiento';
    const okText = isEditingSomething ? 'Guardar cambios' : 'Registrar';

    UI.openModal({
      title,
      okText,
      bodyHTML: `
        <label>Tipo</label>
        <div class="finance-type-toggle" id="mv-type-toggle">
          <button type="button" class="finance-type-btn ${modalState.type === 'expense' ? 'active' : ''}" data-type="expense">− Gasto</button>
          <button type="button" class="finance-type-btn ${modalState.type === 'income' ? 'active' : ''}" data-type="income">+ Ingreso</button>
        </div>

        <label>Nombre</label>
        <input type="text" id="mv-name" placeholder="Ej: Luz, Sueldo, Bencina"
          value="${(editing && escapeAttr(editing.name)) || (editingRecurring && escapeAttr(editingRecurring.name)) || ''}" />

        <label>Categoría</label>
        <select id="mv-category"></select>

        <div id="mv-recurrence-wrap">
          <label>Recurrencia</label>
          <select id="mv-recurrence">
            ${RECURRENCES.map(r => `<option value="${r.id}" ${modalState.recurrence === r.id ? 'selected' : ''}>${r.name}</option>`).join('')}
          </select>
        </div>

        <div id="mv-amount-wrap">
          <label id="mv-amount-label">Monto (CLP)</label>
          <input type="number" id="mv-amount" inputmode="numeric" min="0" step="1" placeholder="Ej: 45000"
            value="${(editing && editing.amount != null) ? editing.amount : (editingRecurring && editingRecurring.defaultAmount != null ? editingRecurring.defaultAmount : '')}"
            style="font-family:var(--font-mono)" />
          <p id="mv-amount-help" style="color:var(--text-faint);font-size:11px;margin-top:4px"></p>
        </div>

        <div id="mv-date-wrap">
          <label id="mv-date-label">Fecha</label>
          <input type="date" id="mv-date" value="${(editing && editing.date) || UI.todayKey()}" />
        </div>

        <div id="mv-due-wrap" hidden>
          <label id="mv-due-label">Fecha de referencia del pago</label>
          <input type="date" id="mv-due-date"
            value="${editingRecurring && editingRecurring.dueDate ? editingRecurring.dueDate : (editingRecurring && editingRecurring.dueDay ? deriveDueDateFromLegacy(editingRecurring) : UI.todayKey())}" />
          <p id="mv-due-help" style="color:var(--text-faint);font-size:11px;margin-top:4px"></p>
        </div>

        <div id="mv-inst-toggle-wrap" hidden>
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;margin-top:4px">
            <input type="checkbox" id="mv-inst-toggle" style="width:18px;height:18px;accent-color:var(--primary)" />
            <span style="font-weight:600">Compra en cuotas</span>
          </label>
        </div>

        <div id="mv-installments-wrap" hidden>
          <div style="display:flex;gap:8px">
            <div style="flex:1">
              <label>Cuota actual</label>
              <input type="number" id="mv-inst-current" inputmode="numeric" min="1" step="1" placeholder="Ej: 5"
                value="${editingRecurring && editingRecurring.installmentsCurrent != null ? editingRecurring.installmentsCurrent : ''}"
                style="font-family:var(--font-mono)" />
            </div>
            <div style="flex:1">
              <label>Total de cuotas</label>
              <input type="number" id="mv-inst-total" inputmode="numeric" min="1" step="1" placeholder="Ej: 24"
                value="${editingRecurring && editingRecurring.installmentsTotal != null ? editingRecurring.installmentsTotal : ''}"
                style="font-family:var(--font-mono)" />
            </div>
          </div>
          <p id="mv-inst-computed" style="color:var(--primary);font-size:12px;font-weight:600;margin-top:6px">Cuota mensual: —</p>
          <p style="color:var(--text-faint);font-size:11px;margin-top:2px">La cuota se calcula como monto total ÷ total de cuotas. Al pagar la última, deja de repetirse.</p>
        </div>

        <label>Nota (opcional)</label>
        <textarea id="mv-note" placeholder="Detalles, observaciones">${
          (editing && editing.note) ? escapeHtml(editing.note) :
          (editingRecurring && editingRecurring.note) ? escapeHtml(editingRecurring.note) : ''
        }</textarea>
      `,
      onSave: () => saveMovement(modalState, editing, editingRecurring)
    });

    // Calcula y muestra la cuota mensual (monto total ÷ total de cuotas) en vivo.
    const updateInstComputed = () => {
      const line = document.getElementById('mv-inst-computed');
      if (!line) return;
      const toggle = document.getElementById('mv-inst-toggle');
      const totalEl = document.getElementById('mv-inst-total');
      const amountEl = document.getElementById('mv-amount');
      if (!toggle || !toggle.checked) return;
      const total = totalEl ? parseInt(totalEl.value, 10) : NaN;
      const monto = amountEl ? Number(amountEl.value) : NaN;
      if (total > 0 && monto > 0) {
        line.textContent = `Cuota mensual: ${formatCLP(Math.round(monto / total))}`;
      } else {
        line.textContent = 'Cuota mensual: —';
      }
    };

    // Setup inicial: completar categorías y aplicar visibilidad según tipo/recurrencia
    const refreshUI = () => {
      const isIncome = modalState.type === 'income';
      const isRecurring = modalState.recurrence !== 'once';

      // Categorías según tipo
      const catSel = document.getElementById('mv-category');
      const cats = isIncome ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
      // Preservar lo que el usuario tenga elegido (si sigue siendo válido para el tipo);
      // si no, caer en la categoría del ítem editado o la primera.
      const prevCat = catSel.value;
      const currentCat = (prevCat && cats.some(c => c.id === prevCat))
        ? prevCat
        : ((editing && editing.category) || (editingRecurring && editingRecurring.category) || null);
      catSel.innerHTML = cats.map(c =>
        `<option value="${c.id}" ${currentCat === c.id ? 'selected' : ''}>${c.icon} ${c.name}</option>`
      ).join('');

      // Toggle tipo (estado visual de los botones)
      document.querySelectorAll('.finance-type-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.type === modalState.type);
      });

      // Ingresos: sin recurrencia, sin fecha de referencia
      const recurrenceWrap = document.getElementById('mv-recurrence-wrap');
      const dueWrap = document.getElementById('mv-due-wrap');
      const dueLabel = document.getElementById('mv-due-label');
      const dueHelp = document.getElementById('mv-due-help');
      const dateWrap = document.getElementById('mv-date-wrap');
      const amountLabel = document.getElementById('mv-amount-label');
      const amountHelp = document.getElementById('mv-amount-help');

      // Cuotas: interruptor disponible para cualquier gasto MENSUAL (no solo deudas).
      // El interruptor aparece en mensuales; los campos se muestran al encenderlo.
      const instToggleWrap = document.getElementById('mv-inst-toggle-wrap');
      const instToggle = document.getElementById('mv-inst-toggle');
      const instWrap = document.getElementById('mv-installments-wrap');
      const showToggle = !isIncome && modalState.recurrence === 'monthly';
      if (instToggleWrap) instToggleWrap.hidden = !showToggle;
      if (instWrap) instWrap.hidden = !(showToggle && instToggle && instToggle.checked);
      if (!showToggle && instToggle) instToggle.checked = false;
      updateInstComputed();
      const instOn = !isIncome && showToggle && instToggle && instToggle.checked;

      if (isIncome) {
        recurrenceWrap.hidden = true;
        dueWrap.hidden = true;
        dateWrap.hidden = false;
        amountLabel.textContent = 'Monto recibido (CLP)';
        amountHelp.textContent = '';
      } else {
        recurrenceWrap.hidden = false;
        if (isRecurring) {
          // Gasto recurrente: ocultar fecha puntual, mostrar fecha de referencia
          dateWrap.hidden = true;
          dueWrap.hidden = false;
          amountLabel.textContent = 'Monto estimado (CLP, opcional)';
          amountHelp.textContent = 'Sirve como referencia. El monto real se registra al pagar (en pestaña Finanzas).';
          // Texto contextual según recurrencia
          if (modalState.recurrence === 'monthly') {
            dueLabel.textContent = 'Fecha de referencia';
            dueHelp.textContent = 'Selecciona una fecha. Se repetirá el mismo día cada mes (ej: día 15 cada mes).';
          } else if (modalState.recurrence === 'quarterly') {
            dueLabel.textContent = 'Fecha del primer pago';
            dueHelp.textContent = 'Selecciona una fecha. Se repetirá cada 3 meses a partir de esa fecha.';
          } else if (modalState.recurrence === 'yearly') {
            dueLabel.textContent = 'Fecha del pago anual';
            dueHelp.textContent = 'Selecciona la fecha del año. Se repetirá cada año en ese mismo día y mes.';
          }
        } else {
          // Gasto puntual: mostrar fecha, ocultar fecha de referencia
          dateWrap.hidden = false;
          dueWrap.hidden = true;
          amountLabel.textContent = 'Monto (CLP)';
          amountHelp.textContent = '';
        }
      }

      // Si el interruptor de cuotas está encendido, el monto pasa a ser el TOTAL
      // de la compra y la fecha de referencia se rotula como "Fecha de pago".
      if (instOn) {
        amountLabel.textContent = 'Monto total de la compra (CLP)';
        amountHelp.textContent = 'Se divide en las cuotas indicadas. La cuota mensual se calcula abajo.';
        dueLabel.textContent = 'Fecha de pago';
        dueHelp.textContent = 'Día en que pagas cada cuota. Se repite el mismo día cada mes.';
      }
    };

    setTimeout(() => {
      // Bind toggle de tipo
      document.querySelectorAll('.finance-type-btn').forEach(b => {
        b.addEventListener('click', () => {
          if (b.disabled) return;
          modalState.type = b.dataset.type;
          // Al cambiar a ingreso, forzar recurrencia 'once'
          if (modalState.type === 'income') {
            modalState.recurrence = 'once';
            const recSel = document.getElementById('mv-recurrence');
            if (recSel) recSel.value = 'once';
          }
          refreshUI();
        });
      });
      // Bind cambio de recurrencia
      const recSel = document.getElementById('mv-recurrence');
      if (recSel) {
        recSel.addEventListener('change', () => {
          modalState.recurrence = recSel.value;
          refreshUI();
        });
      }
      // Interruptor de cuotas: al encender/apagar, muestra u oculta los campos.
      const instToggleBind = document.getElementById('mv-inst-toggle');
      if (instToggleBind) {
        instToggleBind.addEventListener('change', () => refreshUI());
      }
      // Recalcular la cuota mensual en vivo al cambiar monto total o total de cuotas.
      ['mv-amount', 'mv-inst-total'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateInstComputed);
      });
      // Si estamos editando, deshabilitar el toggle de tipo (no cambias gasto↔ingreso al editar)
      if (isEditingSomething) {
        document.querySelectorAll('.finance-type-btn').forEach(b => {
          b.disabled = true;
          b.style.opacity = '0.5';
          b.style.pointerEvents = 'none';
        });
      }
      // Si estamos editando un recurringExpense, fijar la recurrencia (no cambiar entre tipos)
      // Pero permitir cambiar entre mensual/trimestral/anual y bloquear "once" para no confundir
      if (editingRecurring) {
        const recSelEl = document.getElementById('mv-recurrence');
        if (recSelEl) {
          Array.from(recSelEl.options).forEach(opt => {
            if (opt.value === 'once') opt.disabled = true;
          });
        }
      }

      // Al editar un recurrente que ya tiene cuotas, encender el interruptor y
      // mostrar el MONTO TOTAL en el campo de monto (no la cuota individual).
      if (editingRecurring && editingRecurring.installmentsTotal) {
        const instToggle = document.getElementById('mv-inst-toggle');
        if (instToggle) instToggle.checked = true;
        const amountEl = document.getElementById('mv-amount');
        if (amountEl) {
          const total = editingRecurring.installmentTotalAmount != null
            ? editingRecurring.installmentTotalAmount
            : (editingRecurring.defaultAmount != null ? editingRecurring.defaultAmount * editingRecurring.installmentsTotal : '');
          amountEl.value = total;
        }
      }

      refreshUI();
      const i = document.getElementById('mv-name');
      if (i) i.focus();
    }, 50);
  }

  // Lee los campos de cuotas del modal. Aplica cuando el interruptor está encendido
  // (cualquier categoría, solo gastos mensuales). Devuelve total de cuotas, cuota
  // actual, monto total de la compra y la cuota mensual calculada (total ÷ cuotas).
  function readInstallmentsFields() {
    const toggle = document.getElementById('mv-inst-toggle');
    const on = !!(toggle && toggle.checked);
    if (!on) return { total: null, current: null, totalAmount: null, perCuota: null };
    const t = document.getElementById('mv-inst-total');
    const c = document.getElementById('mv-inst-current');
    const a = document.getElementById('mv-amount');
    const total = (t && t.value.trim() !== '') ? Math.max(1, parseInt(t.value, 10)) : null;
    let current = (c && c.value.trim() !== '') ? Math.max(1, parseInt(c.value, 10)) : null;
    const totalAmount = (a && a.value.trim() !== '') ? Math.max(0, Number(a.value)) : null;
    if (total && !current) current = 1;                 // hay total pero no cuota → empieza en 1
    if (total && current > total) current = total;      // no exceder el total
    const perCuota = (total && totalAmount != null) ? Math.round(totalAmount / total) : null;
    return { total: total || null, current: total ? current : null, totalAmount: total ? totalAmount : null, perCuota };
  }

  function saveMovement(modalState, editing, editingRecurring) {
    const name = document.getElementById('mv-name').value.trim();
    if (!name) { UI.toast('Falta el nombre'); return false; }
    const category = document.getElementById('mv-category').value;
    const amountRaw = document.getElementById('mv-amount').value.trim();
    const note = document.getElementById('mv-note').value.trim() || null;

    const isIncome = modalState.type === 'income';
    const isRecurring = modalState.recurrence !== 'once' && !isIncome;

    let amount = null;
    if (amountRaw !== '') {
      const n = Number(amountRaw);
      if (!isNaN(n) && n >= 0) amount = n;
    }
    // Para gastos puntuales e ingresos, monto es obligatorio
    if (!isRecurring && (amount == null || amount === 0)) {
      UI.toast('Falta el monto');
      return false;
    }

    const s = Storage.get();
    s.movements = s.movements || [];
    s.recurringExpenses = s.recurringExpenses || [];

    if (editing) {
      // Editar movement existente (gasto puntual o ingreso)
      editing.name = name;
      editing.category = category;
      editing.amount = amount;
      editing.note = note;
      const dateEl = document.getElementById('mv-date');
      if (dateEl && !dateEl.closest('[hidden]')) editing.date = dateEl.value;
      UI.toast('Movimiento actualizado');
    } else if (editingRecurring) {
      // Editar recurring existente
      editingRecurring.name = name;
      editingRecurring.category = category;
      editingRecurring.recurrence = modalState.recurrence;
      editingRecurring.defaultAmount = amount;
      editingRecurring.note = note;
      const dueDateRaw = document.getElementById('mv-due-date').value;
      if (dueDateRaw) {
        editingRecurring.dueDate = dueDateRaw;
        // dueDay derivado para compatibilidad con código que lo lee
        const [, , dd] = dueDateRaw.split('-');
        editingRecurring.dueDay = parseInt(dd, 10);
      } else {
        editingRecurring.dueDate = null;
        editingRecurring.dueDay = null;
      }
      // Cuotas (cualquier categoría, gasto mensual): total, cuota actual, monto total.
      const instE = readInstallmentsFields();
      editingRecurring.installmentsTotal = instE.total;
      editingRecurring.installmentsCurrent = instE.current;
      editingRecurring.installmentTotalAmount = instE.totalAmount;
      // Si hay cuotas, el monto por pago (defaultAmount) es la cuota calculada.
      if (instE.total) {
        editingRecurring.defaultAmount = instE.perCuota;
        if (!editingRecurring.installmentsCurrent || editingRecurring.installmentsCurrent <= instE.total) {
          editingRecurring.installmentsDone = false;
        }
      } else {
        editingRecurring.installmentsDone = false;
        editingRecurring.installmentTotalAmount = null;
      }
      // Si cambió la recurrencia, saltar a la sub-tab correspondiente para que el usuario vea el resultado
      activeSubTab = 'scheduled';
      UI.toast('Gasto actualizado');
    } else if (isRecurring) {
      // Nuevo gasto recurrente
      const dueDateRaw = document.getElementById('mv-due-date').value;
      let dueDate = null, dueDay = null;
      if (dueDateRaw) {
        dueDate = dueDateRaw;
        const [, , dd] = dueDateRaw.split('-');
        dueDay = parseInt(dd, 10);
      }
      const inst = readInstallmentsFields();
      s.recurringExpenses.push({
        id: Storage.uid(),
        name, category,
        recurrence: modalState.recurrence,
        // Con cuotas, el monto por pago es la cuota (total ÷ cuotas); si no, el estimado.
        defaultAmount: inst.total ? inst.perCuota : amount,
        dueDate, dueDay,
        note,
        installmentsTotal: inst.total,
        installmentsCurrent: inst.current,
        installmentTotalAmount: inst.totalAmount,
        installmentsDone: false,
        createdAt: Date.now(),
      });
      activeSubTab = 'scheduled';
      UI.toast('Gasto recurrente creado');
    } else {
      // Nuevo movement (gasto puntual o ingreso)
      const date = document.getElementById('mv-date').value || UI.todayKey();
      s.movements.push({
        id: Storage.uid(),
        type: isIncome ? 'income' : 'expense',
        name,
        category,
        amount,
        date,
        note,
        recurringExpenseId: null,
        createdAt: Date.now(),
      });
      activeSubTab = isIncome ? 'income' : 'once';
      UI.toast(isIncome ? 'Ingreso registrado' : 'Gasto registrado');
    }
    Storage.save();
    render();
    renderDashboard();
  }

  function deleteRecurring(id) {
    const s = Storage.get();
    const re = (s.recurringExpenses || []).find(x => x.id === id);
    if (!re) return;
    UI.confirm2({
      title: 'Eliminar gasto',
      message: `¿Eliminar "${re.name}"? Los movimientos ya registrados de este gasto se conservan.`,
      okText: 'Eliminar',
      danger: true,
      onConfirm: () => {
        s.recurringExpenses = s.recurringExpenses.filter(x => x.id !== id);
        Storage.save();
        render();
        renderDashboard();
        UI.toast('Eliminado');
      }
    });
  }

  function deleteMovement(id) {
    const s = Storage.get();
    const m = (s.movements || []).find(x => x.id === id);
    if (!m) return;
    UI.confirm2({
      title: 'Eliminar movimiento',
      message: `¿Eliminar "${m.name}"?`,
      okText: 'Eliminar',
      danger: true,
      onConfirm: () => {
        s.movements = s.movements.filter(x => x.id !== id);
        Storage.save();
        render();
        renderDashboard();
        UI.toast('Eliminado');
      }
    });
  }

  // Shortcut para abrir desde el FAB con tipo prellenado
  function openNewExpense() { openMovementModal({ prefillType: 'expense' }); }
  function openNewIncome()  { openMovementModal({ prefillType: 'income' }); }

  // ============================================
  // PESTAÑA "MIS FINANZAS" (dashboard mes en curso)
  // ============================================

  function getCurrentMonthKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function getMonthRange(mk) {
    const [y, m] = mk.split('-').map(Number);
    const start = `${mk}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const end = `${mk}-${String(lastDay).padStart(2, '0')}`;
    return { start, end, year: y, month: m, lastDay };
  }

  // ¿Un gasto recurrente está pagado en el mes mk?
  function isRecurringPaidInMonth(re, mk) {
    const s = Storage.get();
    const movs = (s.movements || []).filter(m =>
      m.type === 'expense' && m.recurringExpenseId === re.id
    );
    if (movs.length === 0) return false;
    if (re.recurrence === 'monthly') {
      // Si el movement tiene periodMk explícito, lo respetamos (el usuario marcó qué ciclo se está pagando)
      // Si no tiene periodMk (movements legacy), usamos la fecha del movement como fallback
      return movs.some(m => {
        if (m.periodMk) return m.periodMk === mk;
        return (m.date || '').startsWith(mk);
      });
    }
    if (re.recurrence === 'quarterly') {
      // Si hay periodMk explícito, comparar directo
      const withPeriod = movs.filter(m => m.periodMk);
      if (withPeriod.some(m => m.periodMk === mk)) return true;
      // Fallback por fecha (legacy)
      const [y, m] = mk.split('-').map(Number);
      const fromDate = new Date(y, m - 3, 1);
      const toDate = new Date(y, m, 0);
      return movs.filter(m => !m.periodMk).some(mv => {
        if (!mv.date) return false;
        const d = new Date(mv.date + 'T12:00:00');
        return d >= fromDate && d <= toDate;
      });
    }
    if (re.recurrence === 'yearly') {
      const withPeriod = movs.filter(m => m.periodMk);
      if (withPeriod.some(m => m.periodMk === mk)) return true;
      // Fallback por fecha (legacy): mismo año
      const year = mk.split('-')[0];
      return movs.filter(m => !m.periodMk).some(m => (m.date || '').startsWith(year + '-'));
    }
    return false;
  }

  // Para datos legacy que solo tienen dueDay numérico, derivar una dueDate
  // usando el mes en curso como referencia (mejor que nada para los gastos viejos).
  function deriveDueDateFromLegacy(re) {
    if (!re || !re.dueDay) return UI.todayKey();
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth() + 1;
    const daysInMonth = new Date(y, m, 0).getDate();
    const day = Math.min(re.dueDay, daysInMonth);
    return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function getDueDateForRecurringInMonth(re, mk) {
    // Si tiene dueDate (fecha completa de referencia), proyectarla al mes pedido
    // tomando el día y mes según el tipo de recurrencia.
    if (re.dueDate) {
      const [refY, refM, refD] = re.dueDate.split('-').map(Number);
      const [y, m] = mk.split('-').map(Number);
      if (re.recurrence === 'yearly') {
        // Anual: solo aplica si el mes coincide con el mes de referencia
        if (m !== refM) return null;
        const daysInMonth = new Date(y, m, 0).getDate();
        const day = Math.min(refD, daysInMonth);
        return `${mk}-${String(day).padStart(2, '0')}`;
      }
      if (re.recurrence === 'quarterly') {
        // Trimestral: aplica solo si la diferencia entre el mes pedido y el de referencia es múltiplo de 3
        const diff = (y - refY) * 12 + (m - refM);
        if (diff < 0 || diff % 3 !== 0) return null;
        const daysInMonth = new Date(y, m, 0).getDate();
        const day = Math.min(refD, daysInMonth);
        return `${mk}-${String(day).padStart(2, '0')}`;
      }
      // Mensual: mismo día cada mes
      const daysInMonth = new Date(y, m, 0).getDate();
      const day = Math.min(refD, daysInMonth);
      return `${mk}-${String(day).padStart(2, '0')}`;
    }
    // Legacy: solo dueDay
    if (!re.dueDay) return null;
    const [y, m] = mk.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const day = Math.min(re.dueDay, daysInMonth);
    return `${mk}-${String(day).padStart(2, '0')}`;
  }

  // Retorna todos los pendientes: del mes en curso + arrastrados desde meses anteriores
  // Pendiente arrastrado: el gasto recurrente NO se pagó en su mes correspondiente
  // y tampoco se ha pagado aún (no existe ningún movement para ese ciclo).
  function getAllPending() {
    const recs = Storage.get().recurringExpenses || [];
    const curMk = getCurrentMonthKey();
    const result = [];

    recs.forEach(re => {
      // Deuda con cuotas ya completada: no genera más pendientes
      if (re.installmentsDone) return;
      // Mes en que se creó el gasto recurrente. Antes de ese mes no hay pendientes posibles.
      const createdDate = new Date(re.createdAt || Date.now());
      const createdMk = `${createdDate.getFullYear()}-${String(createdDate.getMonth() + 1).padStart(2, '0')}`;

      if (re.recurrence === 'monthly') {
        // El primer período pendiente posible es el mes del PRIMER vencimiento
        // (dueDate). Antes de esa fecha el pago todavía no vence, así que no
        // debe contar como pendiente ni como atrasado. Sin dueDate (legacy),
        // se usa el mes de creación como referencia.
        const startMk = re.dueDate ? re.dueDate.slice(0, 7) : createdMk;

        // Pendientes desde startMk hasta el mes actual (límite: 24 meses por seguridad)
        const periods = [];
        for (let i = 0; i <= 24; i++) {
          const d = new Date();
          d.setDate(1);
          d.setMonth(d.getMonth() - i);
          const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          if (mk < startMk) break;
          if (!isRecurringPaidInMonth(re, mk)) {
            periods.push(mk);
          } else {
            // Si encontramos uno pagado, dejamos de buscar hacia atrás
            break;
          }
        }
        periods.forEach(mk => {
          result.push({ recurring: re, periodMk: mk, isFromCurrentMonth: mk === curMk });
        });
      } else if (re.recurrence === 'quarterly' || re.recurrence === 'yearly') {
        // Para trimestrales/anuales: aparece como pendiente solo si su fecha de vencimiento
        // ya llegó este ciclo y aún no se pagó.
        if (createdMk > curMk) return; // creado en el futuro, ignorar
        if (isRecurringPaidInMonth(re, curMk)) return; // ya pagado en este ciclo

        // Determinar el "mes objetivo" del próximo vencimiento
        let targetMk = curMk;
        if (re.dueDate) {
          // Buscar el mes en el que cae el vencimiento de este ciclo
          // Para anual: mes de re.dueDate dentro del año en curso
          // Para trimestral: el ciclo más cercano hacia atrás (o el actual) que aún no se haya pagado
          const [refY, refM] = re.dueDate.split('-').map(Number);
          const [curY, curMonth] = curMk.split('-').map(Number);
          if (re.recurrence === 'yearly') {
            targetMk = `${curY}-${String(refM).padStart(2, '0')}`;
          } else {
            // trimestral: encontrar el último múltiplo de 3 desde refM hasta antes de hoy
            const diffMonths = (curY - refY) * 12 + (curMonth - refM);
            if (diffMonths >= 0) {
              const cyclesElapsed = Math.floor(diffMonths / 3);
              const targetMonth = refM + cyclesElapsed * 3;
              const targetYear = refY + Math.floor((targetMonth - 1) / 12);
              const adjMonth = ((targetMonth - 1) % 12) + 1;
              targetMk = `${targetYear}-${String(adjMonth).padStart(2, '0')}`;
            } else {
              return; // aún no llega el primer ciclo
            }
          }
        }
        // Solo mostrar pendiente si el mes objetivo ya llegó o pasó (no si es futuro)
        if (targetMk > curMk) return;
        result.push({ recurring: re, periodMk: targetMk, isFromCurrentMonth: targetMk === curMk });
      }
    });

    result.sort((a, b) => {
      if (a.periodMk !== b.periodMk) return a.periodMk.localeCompare(b.periodMk);
      const da = a.recurring.dueDay || 32;
      const db = b.recurring.dueDay || 32;
      return da - db;
    });

    return result;
  }

  // ====== RENDER PRINCIPAL DASHBOARD ======
  function renderDashboard() {
    renderMonthBanner();
    renderBalance();
    renderMonthMovements();
  }

  function renderMonthBanner() {
    const c = document.getElementById('finance-month-banner');
    if (!c) return;
    const mk = getCurrentMonthKey();
    const [y, m] = mk.split('-').map(Number);
    const d = new Date(y, m - 1, 15);
    const txt = d.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
    c.textContent = txt;
  }

  function renderBalance() {
    const c = document.getElementById('finance-balance');
    if (!c) return;
    const mk = getCurrentMonthKey();
    const { start, end } = getMonthRange(mk);
    const all = (Storage.get().movements || []);

    // Saldo arrastrado: todos los movimientos ANTERIORES al mes en curso.
    // Se calcula dinámico para que se autocorrija si editas/borras algo viejo.
    const carried = all
      .filter(m => m.date && m.date < start)
      .reduce((s, m) => s + (m.type === 'income' ? (m.amount || 0) : -(m.amount || 0)), 0);

    const movs = all.filter(m => m.date && m.date >= start && m.date <= end);
    const income = movs.filter(m => m.type === 'income').reduce((s, m) => s + (m.amount || 0), 0);
    const expense = movs.filter(m => m.type === 'expense').reduce((s, m) => s + (m.amount || 0), 0);

    const net = carried + income - expense;
    const netClass = net > 0 ? 'positive' : (net < 0 ? 'negative' : 'zero');
    const netSign = net > 0 ? '+ ' : (net < 0 ? '− ' : '');

    const carrySign = carried < 0 ? '− ' : '';
    const carryRow = carried !== 0 ? `
      <div class="finance-balance-row carry">
        <span class="fb-label">Saldo anterior</span>
        <span class="fb-amount">${carrySign}${formatCLP(Math.abs(carried))}</span>
      </div>` : '';

    c.innerHTML = `
      ${carryRow}
      <div class="finance-balance-row income">
        <span class="fb-label">Ingresos</span>
        <span class="fb-amount">+ ${formatCLP(income)}</span>
      </div>
      <div class="finance-balance-row expense">
        <span class="fb-label">Gastos</span>
        <span class="fb-amount">− ${formatCLP(expense)}</span>
      </div>
      <div class="finance-balance-divider"></div>
      <div class="finance-balance-row net ${netClass}">
        <span class="fb-label">Balance</span>
        <span class="fb-amount">${netSign}${formatCLP(Math.abs(net))}</span>
      </div>
    `;
  }

  // Saldo neto actual = arrastre de meses anteriores + ingresos − gastos del mes
  function getCurrentNet() {
    const { start, end } = getMonthRange(getCurrentMonthKey());
    const all = Storage.get().movements || [];
    const carried = all.filter(m => m.date && m.date < start)
      .reduce((s, m) => s + (m.type === 'income' ? (m.amount || 0) : -(m.amount || 0)), 0);
    const movs = all.filter(m => m.date && m.date >= start && m.date <= end);
    const income = movs.filter(m => m.type === 'income').reduce((s, m) => s + (m.amount || 0), 0);
    const expense = movs.filter(m => m.type === 'expense').reduce((s, m) => s + (m.amount || 0), 0);
    return carried + income - expense;
  }

  // Cuadra el saldo declarando cuánto tienes de verdad.
  // No edita el balance: registra un movimiento de ajuste por la diferencia.
  function openAdjustBalanceModal() {
    const current = getCurrentNet();

    UI.openModal({
      title: '⚖️ Ajustar saldo',
      okText: 'Registrar ajuste',
      bodyHTML: `
        <div class="adj-current">
          <span class="adj-current-lbl">Saldo según la app</span>
          <span class="adj-current-val">${formatCLP(current)}</span>
        </div>
        <label>¿Cuánto tienes realmente? (CLP)</label>
        <input type="number" id="adj-real" inputmode="numeric" placeholder="0" value="${current}" />
        <div class="adj-diff" id="adj-diff"></div>
        <label>Nota (opcional)</label>
        <input type="text" id="adj-note" placeholder="Ej: efectivo sin registrar" />
        <p class="settings-help" style="margin-top:10px">Se registrará como un movimiento de ajuste con la fecha de hoy. Puedes editarlo o borrarlo después.</p>
      `,
      onSave: () => {
        const real = parseFloat(document.getElementById('adj-real').value);
        if (isNaN(real)) { UI.toast('Ingresa un monto válido'); return false; }
        const diff = Math.round(real - current);
        if (diff === 0) { UI.toast('El saldo ya está cuadrado'); return; }
        const note = document.getElementById('adj-note').value.trim();
        const s = Storage.get();
        s.movements.push({
          id: Storage.uid(),
          type: diff > 0 ? 'income' : 'expense',
          name: 'Ajuste de saldo',
          category: 'ajuste',
          amount: Math.abs(diff),
          date: UI.todayKey(),
          note,
          recurringExpenseId: null,
          isAdjustment: true,
          createdAt: Date.now(),
        });
        Storage.save();
        render();
        renderDashboard();
        UI.toast(`Ajuste de ${diff > 0 ? '+' : '−'} ${formatCLP(Math.abs(diff))}`);
      }
    });

    setTimeout(() => {
      const input = document.getElementById('adj-real');
      const out = document.getElementById('adj-diff');
      if (!input || !out) return;
      const refresh = () => {
        const real = parseFloat(input.value);
        if (isNaN(real)) { out.textContent = ''; out.className = 'adj-diff'; return; }
        const diff = Math.round(real - current);
        if (diff === 0) {
          out.textContent = 'Sin diferencia · ya está cuadrado';
          out.className = 'adj-diff zero';
        } else {
          out.textContent = `Se registrará ${diff > 0 ? '+' : '−'} ${formatCLP(Math.abs(diff))}`;
          out.className = 'adj-diff ' + (diff > 0 ? 'positive' : 'negative');
        }
      };
      input.addEventListener('input', refresh);
      refresh();
      input.focus(); input.select();
    }, 80);
  }


  // Pagos pendientes en la vista "Hoy": solo lo que está vencido, vence hoy
  // o vence dentro de los próximos 3 días. Ordenado por urgencia. Aparece
  // únicamente si hay algo por pagar (si no, no muestra nada).
  function renderTodayPending() {
    const c = document.getElementById('today-pending');
    if (!isLive(c)) return;

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const curMk = getCurrentMonthKey();
    const pending = getAllPending();

    const items = [];
    pending.forEach(item => {
      const re = item.recurring;
      const mk = item.periodMk;
      const dueDateKey = getDueDateForRecurringInMonth(re, mk);
      let daysLeft; // <0 atrasado · 0 hoy · >0 faltan
      if (mk < curMk) {
        if (dueDateKey) {
          const dDue = new Date(dueDateKey + 'T00:00:00');
          daysLeft = -Math.max(1, Math.round((today - dDue) / 86400000));
        } else {
          daysLeft = -1; // arrastrado sin fecha: vencido
        }
      } else if (dueDateKey) {
        const dDue = new Date(dueDateKey + 'T00:00:00');
        daysLeft = Math.round((dDue - today) / 86400000);
      } else {
        return; // del mes actual sin fecha: no se puede ubicar, se omite en Hoy
      }
      if (daysLeft > 3) return; // aún lejos: no se muestra en Hoy
      items.push({ re, mk, daysLeft });
    });

    // En Hoy basta una línea por gasto recurrente: la de su período más
    // urgente (más atrasado). El desglose mes a mes vive en Finanzas.
    const byRe = new Map();
    items.forEach(it => {
      const prev = byRe.get(it.re.id);
      if (!prev || it.daysLeft < prev.daysLeft) byRe.set(it.re.id, it);
    });
    const collapsed = [...byRe.values()];

    if (collapsed.length === 0) { c.innerHTML = ''; return; }

    // Orden por urgencia: más atrasado primero
    collapsed.sort((a, b) => a.daysLeft - b.daysLeft);

    const total = collapsed.reduce((sum, it) => sum + (it.re.defaultAmount || 0), 0);
    const subtitle = `${collapsed.length} ${collapsed.length === 1 ? 'pendiente' : 'pendientes'}${total ? ` · ${formatCLP(total)}` : ''}`;

    const rows = collapsed.map(it => {
      const cat = getExpenseCategory(it.re.category);
      let tagClass, tagText;
      if (it.daysLeft < 0) { tagClass = 'overdue'; tagText = `Atrasado ${Math.abs(it.daysLeft)}d`; }
      else if (it.daysLeft === 0) { tagClass = 'today'; tagText = 'Vence hoy'; }
      else { tagClass = 'soon'; tagText = it.daysLeft === 1 ? 'Vence mañana' : `Vence en ${it.daysLeft}d`; }
      const amount = it.re.defaultAmount ? `~ ${formatCLP(it.re.defaultAmount)}` : 'Monto variable';
      const instTag = (it.re.installmentsTotal)
        ? `<span class="tp-inst">Cuota ${it.re.installmentsCurrent || 1}/${it.re.installmentsTotal}</span>`
        : '';
      return `
        <div class="tp-item ${tagClass}">
          <div class="tp-main">
            <div class="tp-name">${cat.icon} ${escapeHtml(it.re.name)}</div>
            <div class="tp-meta">
              <span class="tp-tag ${tagClass}">${tagText}</span>
              <span class="tp-amount">${amount}</span>
              ${instTag}
            </div>
          </div>
          <button class="tp-pay" data-tp-pay="${it.re.id}" data-tp-period="${it.mk}">Pagar</button>
        </div>`;
    }).join('');

    c.innerHTML = `
      <div class="section-card">
        <div class="section-head">
          <div>
            <div class="section-title">💰 Pagos pendientes</div>
            <div class="section-subtitle">${subtitle}</div>
          </div>
          <button class="section-icon-btn" data-go="finance" aria-label="Ir a Finanzas"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg></button>
        </div>
        <div class="tp-list">${rows}</div>
      </div>`;

    c.querySelectorAll('[data-tp-pay]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openPayRecurringModal(btn.dataset.tpPay, btn.dataset.tpPeriod);
      });
    });
  }

  function renderMonthMovements() {
    const c = document.getElementById('finance-movements-list');
    if (!isLive(c)) return;
    const mk = getCurrentMonthKey();
    const { start, end } = getMonthRange(mk);
    const movs = (Storage.get().movements || []).filter(m =>
      m.date && m.date >= start && m.date <= end
    );
    if (movs.length === 0) {
      c.innerHTML = '<div class="empty">Sin movimientos registrados este mes</div>';
      return;
    }
    movs.sort((a, b) => {
      // Primero por fecha descendente (más reciente arriba)
      const dateCmp = (b.date || '').localeCompare(a.date || '');
      if (dateCmp !== 0) return dateCmp;
      // Mismo día: por orden de creación descendente (último ingresado primero)
      const ca = a.createdAt || 0;
      const cb = b.createdAt || 0;
      return cb - ca;
    });
    // Modo solo lectura: edición/eliminación se hace desde Mi Sistema → Finanzas
    c.innerHTML = movs.map(m => renderMovementItem(m, { readonly: true })).join('');
  }

  // Modal "Pagar recurrente"
  function openPayRecurringModal(recurringId, periodMk) {
    const s = Storage.get();
    const re = (s.recurringExpenses || []).find(x => x.id === recurringId);
    if (!re) return;
    let zeroConfirmed = false; // para confirmar un pago de $0
    const cat = getExpenseCategory(re.category);
    // Si es del mes en curso → fecha de hoy. Si es atrasado → hoy igualmente (el pago se hace HOY, va al balance de HOY).
    const defaultDate = UI.todayKey();

    const curMk = getCurrentMonthKey();
    const periodHint = (periodMk && periodMk !== curMk)
      ? `<p style="color:var(--accent-red);font-size:12px;margin-bottom:8px">⚠ Pago atrasado · correspondía a ${new Date(periodMk + '-15T12:00:00').toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })}</p>`
      : '';

    // Línea de cuota, si es una deuda con cuotas
    const instHint = (re.installmentsTotal)
      ? `<p style="color:var(--text-dim);font-size:12px;margin-bottom:8px">📄 Cuota ${re.installmentsCurrent || 1} de ${re.installmentsTotal}${(re.installmentsCurrent || 1) >= re.installmentsTotal ? ' · última' : ''}</p>`
      : '';

    UI.openModal({
      title: `💸 Pagar · ${re.name}`,
      okText: 'Registrar pago',
      bodyHTML: `
        <p style="color:var(--text-dim);font-size:13px;margin-bottom:6px">${cat.icon} ${cat.name} · ${getRecurrence(re.recurrence).name}</p>
        ${periodHint}
        ${instHint}
        <label>Monto pagado (CLP)</label>
        <input type="number" id="pay-amount" inputmode="numeric" min="0" step="1" placeholder="Ej: 45000" value="${re.defaultAmount != null ? re.defaultAmount : ''}" style="font-family:var(--font-mono)" />
        ${re.defaultAmount ? `<p style="color:var(--text-faint);font-size:11px;margin-top:4px">Estimado: ${formatCLP(re.defaultAmount)}. Modifica si difiere.</p>` : ''}

        <label>Fecha de pago</label>
        <input type="date" id="pay-date" value="${defaultDate}" />

        <label>Nota (opcional)</label>
        <textarea id="pay-note" placeholder="Detalles, observaciones"></textarea>
      `,
      onSave: () => {
        const amountRaw = document.getElementById('pay-amount').value.trim();
        if (amountRaw === '' || isNaN(Number(amountRaw)) || Number(amountRaw) < 0) {
          UI.toast('Ingresa un monto válido (0 o más)');
          return false;
        }
        const amount = Number(amountRaw);

        // Confirmación de pago en $0 (doble toque)
        if (amount === 0 && !zeroConfirmed) {
          zeroConfirmed = true;
          UI.toast('El pago es $0. Toca de nuevo para confirmar.');
          const okBtn = document.getElementById('modal-ok');
          if (okBtn) okBtn.textContent = 'Confirmar pago de $0';
          return false;
        }

        const date = document.getElementById('pay-date').value || UI.todayKey();
        const note = document.getElementById('pay-note').value.trim() || null;

        const ss = Storage.get();
        ss.movements = ss.movements || [];
        ss.movements.push({
          id: Storage.uid(),
          type: 'expense',
          name: re.name,
          category: re.category,
          amount,
          date,
          note,
          recurringExpenseId: re.id,
          // Si el pago se hace en mes distinto al del ciclo, lo dejamos marcado
          periodMk: periodMk || null,
          createdAt: Date.now(),
        });

        // Avanzar cuota si el gasto está en cuotas (cualquier categoría)
        if (re.installmentsTotal) {
          const cur = re.installmentsCurrent || 1;
          if (cur >= re.installmentsTotal) {
            re.installmentsDone = true;   // pagó la última: deja de repetirse
          } else {
            re.installmentsCurrent = cur + 1;
          }
        }

        Storage.save();
        renderDashboard();
        render();
        if (typeof App !== 'undefined' && App.refreshKPIs) App.refreshKPIs();
        UI.toast(amount === 0 ? 'Pago de $0 registrado' : 'Pago registrado');
      }
    });
    setTimeout(() => {
      const i = document.getElementById('pay-amount');
      if (i) { i.focus(); i.select(); }
    }, 80);
  }

  // ====== GRÁFICOS (SVG nativo) ======

  // Mes que se está analizando (se reinicia al mes actual al entrar a la vista)
  let analysisMk = null;

  function openAnalysis() {
    analysisMk = getCurrentMonthKey();
    renderAnalysis();
  }

  function setAnalysisMonth(mk) {
    analysisMk = mk;
    renderAnalysis();
    const view = document.getElementById('view-finance-analysis');
    if (view) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderAnalysis() {
    const c = document.getElementById('finance-analysis-card');
    if (!c) return;
    const mk = analysisMk || getCurrentMonthKey();
    const curMk = getCurrentMonthKey();
    const { start, end } = getMonthRange(mk);

    // Los ajustes de saldo quedan fuera del análisis: son descuadres, no hábitos de gasto
    const movs = (Storage.get().movements || []).filter(m =>
      m.date && m.date >= start && m.date <= end && !m.isAdjustment
    );
    const expenses = movs.filter(m => m.type === 'expense');
    const incomes = movs.filter(m => m.type === 'income');

    const income = incomes.reduce((s2, m) => s2 + (m.amount || 0), 0);
    const expense = expenses.reduce((s2, m) => s2 + (m.amount || 0), 0);
    const net = income - expense;
    const netCls = net > 0 ? 'positive' : (net < 0 ? 'negative' : 'zero');

    // Navegador de meses
    const firstMk = firstMonthWithData();
    const canPrev = mk > firstMk;
    const canNext = mk < curMk;
    const nav = `
      <div class="mnav">
        <button class="mnav-btn" data-mnav="prev" ${canPrev ? '' : 'disabled'} aria-label="Mes anterior">‹</button>
        <div class="mnav-center">
          <div class="mnav-month">${monthLong(mk)}</div>
          <div class="mnav-sub">${mk === curMk ? 'Mes en curso' : ''}</div>
        </div>
        <button class="mnav-btn" data-mnav="next" ${canNext ? '' : 'disabled'} aria-label="Mes siguiente">›</button>
      </div>`;

    // Sin movimientos: no tiene sentido pintar gráficos en cero
    if (movs.length === 0) {
      c.innerHTML = nav +
        '<div class="empty" style="margin:22px 0">Sin movimientos registrados en este mes</div>' +
        `<div class="analysis-block">
           <div class="analysis-block-title">Ingresos vs gastos · 6 meses hasta ${monthShort(mk)}</div>
           ${renderCompareBars(mk)}
         </div>`;
      bindAnalysis(c);
      return;
    }

    const summary = `
      <div class="m-summary">
        <div class="ms-cell"><span class="ms-val income">+ ${formatCLP(income)}</span><span class="ms-lbl">Ingresos</span></div>
        <div class="ms-cell"><span class="ms-val expense">− ${formatCLP(expense)}</span><span class="ms-lbl">Gastos</span></div>
        <div class="ms-cell"><span class="ms-val ${netCls}">${net > 0 ? '+ ' : (net < 0 ? '− ' : '')}${formatCLP(Math.abs(net))}</span><span class="ms-lbl">Balance</span></div>
      </div>`;

    c.innerHTML = `
      ${nav}
      ${summary}
      <div class="analysis-block">
        <div class="analysis-block-title">Gastos por categoría</div>
        ${renderExpenseDonut(expenses, mk)}
      </div>
      <div class="analysis-block">
        <div class="analysis-block-title">Ingresos del mes</div>
        ${renderIncomeTable(incomes)}
      </div>
      <div class="analysis-block">
        <div class="analysis-block-title">Ingresos vs gastos · 6 meses hasta ${monthShort(mk)}</div>
        ${renderCompareBars(mk)}
      </div>
    `;
    bindAnalysis(c);
  }

  function bindAnalysis(c) {
    const cur = analysisMk || getCurrentMonthKey();
    c.querySelectorAll('[data-mnav]').forEach(b => {
      b.addEventListener('click', () => {
        if (b.disabled) return;
        UI.buzz(8);
        setAnalysisMonth(shiftMonth(cur, b.dataset.mnav === 'prev' ? -1 : 1));
      });
    });
    c.querySelectorAll('[data-jump]').forEach(r => {
      r.addEventListener('click', () => {
        const mk = r.dataset.jump;
        if (mk === cur || mk > getCurrentMonthKey()) return;
        UI.buzz(8);
        setAnalysisMonth(mk);
      });
    });
  }

  function renderExpenseDonut(expenses, mk) {
    if (expenses.length === 0) {
      return '<div class="empty" style="margin:6px 0">Sin gastos este mes</div>';
    }
    const avgData = categoryAverages(mk);
    // Agrupar por categoría
    const byCat = {};
    expenses.forEach(e => {
      const id = e.category || 'otros';
      if (!byCat[id]) byCat[id] = 0;
      byCat[id] += (e.amount || 0);
    });
    const total = Object.values(byCat).reduce((s, v) => s + v, 0);
    if (total === 0) return '<div class="empty" style="margin:6px 0">Sin datos</div>';

    // Construir slices ordenados por monto desc
    const entries = Object.entries(byCat)
      .map(([id, val]) => ({ cat: { ...getExpenseCategory(id), id }, val, pct: val / total }))
      .sort((a, b) => b.val - a.val);

    // Paleta basada en variables existentes + tonos
    const palette = ['#f5c842', '#4ade80', '#60a5fa', '#a78bfa', '#ef4444', '#f0abfc', '#34d399'];

    // SVG donut: más gruesa, mejor proporcionada
    const SIZE = 180;
    const cx = SIZE / 2, cy = SIZE / 2;
    const r = 64;
    const sw = 28;
    const C = 2 * Math.PI * r;
    let offset = 0;
    const slices = entries.map((e, idx) => {
      const dash = C * e.pct;
      const gap = C - dash;
      const color = palette[idx % palette.length];
      // Pequeño separador visual entre slices (gap de 1.5)
      const visualDash = Math.max(0, dash - 1.5);
      const visualGap = gap + 1.5;
      const el = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="butt"
        stroke-dasharray="${visualDash} ${visualGap}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})" />`;
      offset += dash;
      return el;
    }).join('');

    const legend = entries.map((e, idx) => {
      const color = palette[idx % palette.length];
      const pctTxt = Math.round(e.pct * 100);
      // Contraste contra el promedio de los otros meses con datos
      let delta = '';
      if (avgData && avgData.avg[e.cat.id] > 0) {
        const a = avgData.avg[e.cat.id];
        const diff = Math.round(((e.val - a) / a) * 100);
        if (Math.abs(diff) >= 5) {
          const over = diff > 0;
          delta = `<div class="donut-delta ${over ? 'over' : 'under'}">${over ? '▲' : '▼'} ${Math.abs(diff)}% ${over ? 'sobre' : 'bajo'} tu promedio</div>`;
        } else {
          delta = '<div class="donut-delta even">= en tu promedio</div>';
        }
      }
      return `
        <div class="donut-legend-row">
          <span class="donut-dot" style="background:${color}"></span>
          <div class="donut-legend-body">
            <div class="donut-legend-top">
              <span class="donut-cat-name">${e.cat.icon} ${e.cat.name}</span>
              <span class="donut-cat-val">${formatCLP(e.val)} · ${pctTxt}%</span>
            </div>
            ${delta}
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="donut-wrap">
        <div class="donut-svg-wrap">
          <svg class="donut-svg" viewBox="0 0 ${SIZE} ${SIZE}" preserveAspectRatio="xMidYMid meet">
            <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--bg-elev)" stroke-width="${sw}" />
            ${slices}
          </svg>
          <div class="donut-center">
            <div class="donut-total-label">Total gastos</div>
            <div class="donut-total">${formatCLP(total)}</div>
          </div>
        </div>
        <div class="donut-legend">${legend}</div>
      </div>
    `;
  }

  function renderIncomeTable(incomes) {
    if (incomes.length === 0) {
      return '<div class="empty" style="margin:6px 0">Sin ingresos este mes</div>';
    }
    const byCat = {};
    incomes.forEach(i => {
      const id = i.category || 'otros';
      if (!byCat[id]) byCat[id] = 0;
      byCat[id] += (i.amount || 0);
    });
    const total = Object.values(byCat).reduce((s, v) => s + v, 0);
    const entries = Object.entries(byCat)
      .map(([id, val]) => ({ cat: getIncomeCategory(id), val }))
      .sort((a, b) => b.val - a.val);

    return `
      <div class="income-table">
        ${entries.map(e => `
          <div class="income-row">
            <span class="income-cat">${e.cat.icon} ${e.cat.name}</span>
            <span class="income-val">${formatCLP(e.val)}</span>
          </div>
        `).join('')}
        <div class="income-row total">
          <span class="income-cat">Total</span>
          <span class="income-val">${formatCLP(total)}</span>
        </div>
      </div>
    `;
  }

  function renderCompareBars(endMk) {
    const months = getLast6Months(endMk);
    const allMovs = Storage.get().movements || [];
    const data = months.map(mk => {
      const { start, end } = getMonthRange(mk);
      const inMovs = allMovs.filter(m => m.date && m.date >= start && m.date <= end && !m.isAdjustment);
      return {
        mk,
        income: inMovs.filter(m => m.type === 'income').reduce((s, m) => s + (m.amount || 0), 0),
        expense: inMovs.filter(m => m.type === 'expense').reduce((s, m) => s + (m.amount || 0), 0),
      };
    });
    if (data.every(d => d.income === 0 && d.expense === 0)) {
      return '<div class="empty" style="margin:6px 0">Sin datos suficientes</div>';
    }
    const max = Math.max(...data.flatMap(d => [d.income, d.expense]), 1);
    const curMk = endMk || getCurrentMonthKey();

    // Dimensiones generosas
    const w = 320, h = 200;
    const padL = 8, padR = 8, padT = 18, padB = 36;
    const chartW = w - padL - padR;
    const chartH = h - padT - padB;
    const baseY = h - padB;

    // Líneas guía (3 niveles: 25%, 50%, 75%, 100%)
    const guides = [0.25, 0.5, 0.75, 1].map(pct => {
      const y = baseY - chartH * pct;
      return `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="var(--border-soft)" stroke-width="0.5" stroke-dasharray="2 3" opacity="0.5"/>`;
    }).join('');

    // Etiqueta de valor máximo
    const maxLabel = `<text x="${padL + 2}" y="${padT + 8}" font-family="ui-monospace" font-size="9" fill="var(--text-faint)" text-anchor="start">máx ${formatCLP(max)}</text>`;

    const slotW = chartW / data.length;
    const barW = (slotW - 8) / 2;

    // Helper: monto formateado en versión muy corta para etiquetas
    const shortAmount = (n) => {
      if (n === 0) return '';
      if (n >= 1000000) return Math.round(n / 100000) / 10 + 'M';
      if (n >= 1000) return Math.round(n / 1000) + 'k';
      return String(Math.round(n));
    };

    const bars = data.map((d, i) => {
      const slotX = padL + i * slotW + 4;
      const inH = max > 0 ? (d.income / max) * chartH : 0;
      const exH = max > 0 ? (d.expense / max) * chartH : 0;
      const inY = baseY - inH;
      const exY = baseY - exH;
      const isCurrent = d.mk === curMk;
      const monthLbl = monthShort(d.mk);
      const monthCls = isCurrent ? 'chart-month-current' : 'chart-month-label';
      const net = d.income - d.expense;
      const netClass = net >= 0 ? 'positive' : 'negative';
      const netSign = net > 0 ? '+' : (net < 0 ? '−' : '');
      // Highlight para mes actual: fondo sutil de la columna
      const highlight = isCurrent
        ? `<rect x="${slotX - 3}" y="${padT}" width="${barW * 2 + 8}" height="${chartH + 4}" rx="4" fill="var(--accent-yellow)" opacity="0.06"/>`
        : '';
      // Etiquetas de monto encima de cada barra (solo si hay espacio)
      const inLabel = d.income > 0 && inH > 14
        ? `<text x="${slotX + barW / 2}" y="${inY - 3}" text-anchor="middle" font-family="ui-monospace" font-size="8" fill="var(--accent-green)" font-weight="700">${shortAmount(d.income)}</text>`
        : '';
      const exLabel = d.expense > 0 && exH > 14
        ? `<text x="${slotX + barW + 2 + barW / 2}" y="${exY - 3}" text-anchor="middle" font-family="ui-monospace" font-size="8" fill="var(--accent-red)" font-weight="700">${shortAmount(d.expense)}</text>`
        : '';
      // Balance neto debajo del mes
      const netY = baseY + 28;
      const netColor = net >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
      const netLabel = (d.income > 0 || d.expense > 0)
        ? `<text x="${slotX + barW + 1}" y="${netY}" text-anchor="middle" font-family="ui-monospace" font-size="8" fill="${netColor}" font-weight="700">${netSign}${shortAmount(Math.abs(net))}</text>`
        : '';
      return `
        ${highlight}
        <rect class="bar-hit" data-jump="${d.mk}" x="${padL + i * slotW}" y="${padT}" width="${slotW}" height="${chartH + padB - 6}" fill="transparent" style="cursor:pointer" />
        <rect x="${slotX}" y="${inY}" width="${barW}" height="${inH}" rx="2" fill="var(--accent-green)" opacity="${isCurrent ? '1' : '0.78'}" />
        <rect x="${slotX + barW + 2}" y="${exY}" width="${barW}" height="${exH}" rx="2" fill="var(--accent-red)" opacity="${isCurrent ? '1' : '0.78'}" />
        ${inLabel}
        ${exLabel}
        <text x="${slotX + barW + 1}" y="${baseY + 14}" text-anchor="middle" font-family="ui-monospace" font-size="9" fill="${isCurrent ? 'var(--accent-yellow)' : 'var(--text-dim)'}" font-weight="${isCurrent ? '700' : '400'}">${monthLbl}</text>
        ${netLabel}
      `;
    }).join('');

    // Eje base (línea horizontal en 0)
    const baseLine = `<line x1="${padL}" y1="${baseY}" x2="${w - padR}" y2="${baseY}" stroke="var(--border)" stroke-width="1"/>`;

    return `
      <div class="chart-bars-wrap">
        <svg viewBox="0 0 ${w} ${h}" width="100%" preserveAspectRatio="xMidYMid meet" style="overflow:visible">
          ${guides}
          ${maxLabel}
          ${bars}
          ${baseLine}
        </svg>
        <div class="chart-legend-row">
          <span><span class="dot-green"></span> Ingresos</span>
          <span><span class="dot-red"></span> Gastos</span>
          <span class="chart-legend-hint">Toca un mes para verlo</span>
        </div>
      </div>
    `;
  }

  function getLast6Months(endMk) {
    const arr = [];
    const [ey, em] = (endMk || getCurrentMonthKey()).split('-').map(Number);
    for (let i = 5; i >= 0; i--) {
      const x = new Date(ey, em - 1 - i, 1);
      arr.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`);
    }
    return arr;
  }

  // Desplaza una monthKey n meses
  function shiftMonth(mk, n) {
    const [y, m] = mk.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  // Etiqueta larga: "JULIO 2026"
  function monthLong(mk) {
    const [y, m] = mk.split('-').map(Number);
    return new Date(y, m - 1, 15)
      .toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })
      .replace(' de ', ' ').toUpperCase();
  }

  // Mes más antiguo con movimientos (límite para navegar hacia atrás)
  function firstMonthWithData() {
    const dates = (Storage.get().movements || []).map(m => m.date).filter(Boolean).sort();
    return dates.length ? dates[0].slice(0, 7) : getCurrentMonthKey();
  }

  // Promedio de gasto por categoría en los demás meses con datos.
  // El denominador son todos los meses con gasto, no solo aquellos donde
  // apareció la categoría: un mes sin ese gasto cuenta como cero.
  function categoryAverages(excludeMk) {
    const byMonth = {};
    (Storage.get().movements || []).forEach(m => {
      if (m.isAdjustment || m.type !== 'expense' || !m.date) return;
      const mk = m.date.slice(0, 7);
      if (mk === excludeMk) return;
      byMonth[mk] = byMonth[mk] || {};
      const id = m.category || 'otros';
      byMonth[mk][id] = (byMonth[mk][id] || 0) + (m.amount || 0);
    });
    const months = Object.keys(byMonth);
    if (months.length === 0) return null;
    const sums = {};
    months.forEach(mk => Object.entries(byMonth[mk]).forEach(([id, v]) => {
      sums[id] = (sums[id] || 0) + v;
    }));
    const avg = {};
    Object.keys(sums).forEach(id => { avg[id] = sums[id] / months.length; });
    return { avg, count: months.length };
  }

  function monthShort(mk) {
    const [y, m] = mk.split('-').map(Number);
    return new Date(y, m - 1, 15).toLocaleDateString('es-CL', { month: 'short' }).toUpperCase().replace('.', '');
  }

  // ====== ARCHIVO HISTÓRICO (Mi Sistema → Finanzas) ======
  function renderArchive() {
    const c = document.getElementById('finance-archive-list');
    if (!c) return;
    const allMovs = Storage.get().movements || [];
    const curMk = getCurrentMonthKey();

    // Agrupar movements por mes (excluyendo mes en curso)
    const groups = {};
    allMovs.forEach(m => {
      if (!m.date) return;
      const mk = m.date.slice(0, 7);
      if (mk === curMk) return; // el mes en curso no va al archivo
      if (!groups[mk]) groups[mk] = [];
      groups[mk].push(m);
    });
    const monthKeys = Object.keys(groups).sort((a, b) => b.localeCompare(a));
    if (monthKeys.length === 0) {
      c.innerHTML = '<div class="empty">Aún no hay meses cerrados</div>';
      return;
    }

    const monthCardHTML = (mk) => {
      const movs = groups[mk].slice().sort((a, b) => {
        const dateCmp = (b.date || '').localeCompare(a.date || '');
        if (dateCmp !== 0) return dateCmp;
        const ca = a.createdAt || 0;
        const cb = b.createdAt || 0;
        return cb - ca;
      });
      const income = movs.filter(m => m.type === 'income').reduce((s, m) => s + (m.amount || 0), 0);
      const expense = movs.filter(m => m.type === 'expense').reduce((s, m) => s + (m.amount || 0), 0);
      const net = income - expense;
      const netClass = net > 0 ? 'positive' : (net < 0 ? 'negative' : 'zero');
      const netSign = net > 0 ? '+' : (net < 0 ? '−' : '');
      const monthLabel = new Date(mk + '-15T12:00:00').toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
      const open = (archiveOpen[mk] === true);

      return `
        <div class="archive-month ${open ? 'open' : ''}">
          <button class="archive-month-head" data-archive-toggle="${mk}" aria-expanded="${open}">
            <span class="archive-month-arrow">${open ? '▼' : '▶'}</span>
            <span class="archive-month-title">${monthLabel}</span>
            <span class="archive-month-meta">
              <span class="archive-amt income">+${formatCLP(income)}</span>
              <span class="archive-amt expense">−${formatCLP(expense)}</span>
              <span class="archive-amt net ${netClass}">${netSign}${formatCLP(Math.abs(net))}</span>
            </span>
          </button>
          <div class="archive-month-body" ${open ? '' : 'hidden'}>
            ${movs.map(m => renderMovementItem(m)).join('')}
          </div>
        </div>
      `;
    };

    // Agrupar los meses por AÑO. Año más reciente abierto por defecto.
    const todayYear = String(new Date().getFullYear());
    const isYearOpen = (yk) => (yk in archiveYearOpen) ? archiveYearOpen[yk] : (yk === todayYear);
    const yearKeys = [...new Set(monthKeys.map(mk => mk.slice(0, 4)))].sort((a, b) => b.localeCompare(a));

    c.innerHTML = yearKeys.map(yk => {
      const monthsOfYear = monthKeys.filter(mk => mk.slice(0, 4) === yk);
      // Resumen del año: ingresos, gastos y neto
      const yMovs = monthsOfYear.flatMap(mk => groups[mk]);
      const yInc = yMovs.filter(m => m.type === 'income').reduce((s, m) => s + (m.amount || 0), 0);
      const yExp = yMovs.filter(m => m.type === 'expense').reduce((s, m) => s + (m.amount || 0), 0);
      const yNet = yInc - yExp;
      const yNetClass = yNet > 0 ? 'positive' : (yNet < 0 ? 'negative' : 'zero');
      const yNetSign = yNet > 0 ? '+' : (yNet < 0 ? '−' : '');
      const yOpen = isYearOpen(yk);
      return `
        <div class="hist-year ${yOpen ? 'open' : ''}">
          <button class="hist-year-label" data-archive-year-toggle="${yk}" type="button">
            <span class="hist-year-name">${yk}</span>
            <span class="archive-amt net ${yNetClass}" style="margin-left:auto">${yNetSign}${formatCLP(Math.abs(yNet))}</span>
            <span class="hist-year-chevron">▾</span>
          </button>
          <div class="hist-year-body">${monthsOfYear.map(monthCardHTML).join('')}</div>
        </div>
      `;
    }).join('');

    c.querySelectorAll('[data-archive-year-toggle]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const yk = btn.dataset.archiveYearToggle;
        archiveYearOpen[yk] = !isYearOpen(yk);
        renderArchive();
      });
    });

    c.querySelectorAll('[data-archive-toggle]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mk = btn.dataset.archiveToggle;
        archiveOpen[mk] = !archiveOpen[mk];
        renderArchive();
      });
    });

    // Bindings de movement actions (en archive)
    c.querySelectorAll('[data-kind="movement"]').forEach(el => {
      const id = el.dataset.id;
      el.querySelector('[data-action="edit"]').addEventListener('click', (e) => {
        e.stopPropagation();
        openMovementModal({ editMovementId: id });
      });
      el.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteMovement(id);
      });
    });
  }

  let archiveOpen = {};
  let archiveYearOpen = {};

  return {
    render,
    renderDashboard,
    renderTodayPending,
    renderAnalysis,
    openAnalysis,
    renderArchive,
    openMovementModal,
    openNewExpense,
    openNewIncome,
    openAdjustBalanceModal,
    EXPENSE_CATEGORIES,
    INCOME_CATEGORIES,
    RECURRENCES,
    getExpenseCategory,
    getIncomeCategory,
    getRecurrence,
    formatCLP,
  };
})();

/* ============================================
   TEMPLATES (plantillas predefinidas)
   ============================================ */
const Templates = (() => {

  const TEMPLATES = [
    {
      id: 'lectura',
      icon: '📚',
      title: 'Lector ávido',
      desc: 'Hábito de lectura diario conectado con metas mensuales y anuales de páginas/libros leídos.',
      goals: [
        { name: 'Leer 100 páginas esta semana', horizon: 'week', area: 'crecimiento', target: 100, unit: 'páginas' },
        { name: 'Leer 1 libro este mes', horizon: 'month', area: 'crecimiento', target: 1, unit: 'libro' },
        { name: 'Leer 12 libros este año', horizon: 'year', area: 'crecimiento', target: 12, unit: 'libros' },
      ],
      habits: [
        { name: 'Leer 20 páginas', icon: '📚', color: '#a78bfa', area: 'crecimiento', timeOfDay: 'noche', frequency: { type: 'daily' }, linkGoalIndex: 0, defaultIncrement: 20 },
      ],
    },
    {
      id: 'salud',
      icon: '💪',
      title: 'Más saludable',
      desc: 'Hábitos físicos, hidratación, sueño y descanso. Metas de entrenamientos y actividad.',
      goals: [
        { name: 'Entrenar 4 veces esta semana', horizon: 'week', area: 'salud', target: 4, unit: 'sesiones' },
        { name: '12 entrenamientos este mes', horizon: 'month', area: 'salud', target: 12, unit: 'sesiones' },
      ],
      habits: [
        { name: 'Tomar 2 litros de agua', icon: '💧', color: '#60a5fa', area: 'salud', timeOfDay: 'mañana', frequency: { type: 'daily' } },
        { name: 'Estiramiento mañanero', icon: '🤸', color: '#4ade80', area: 'salud', timeOfDay: 'mañana', frequency: { type: 'daily' } },
        { name: 'Entrenar', icon: '🏋️', color: '#ef4444', area: 'salud', timeOfDay: 'tarde', frequency: { type: 'days', days: [1, 3, 5] }, linkGoalIndex: 0, defaultIncrement: 1 },
        { name: 'Dormir antes de medianoche', icon: '😴', color: '#a78bfa', area: 'salud', timeOfDay: 'noche', frequency: { type: 'daily' } },
      ],
    },
    {
      id: 'finanzas',
      icon: '💰',
      title: 'Finanzas en orden',
      desc: 'Revisión diaria, control de gastos y metas de ahorro mensuales y anuales.',
      goals: [
        { name: 'Ahorrar este mes', horizon: 'month', area: 'finanzas', target: 300000, unit: 'CLP' },
        { name: 'Construir fondo de emergencia', horizon: 'year', area: 'finanzas', target: 3000000, unit: 'CLP' },
      ],
      habits: [
        { name: 'Revisar gastos del día', icon: '💰', color: '#f5c842', area: 'finanzas', timeOfDay: 'tarde', frequency: { type: 'daily' } },
        { name: 'No pedir delivery hoy', icon: '🍱', color: '#fb923c', area: 'finanzas', timeOfDay: 'tarde', frequency: { type: 'days', days: [1,2,3,4,5] } },
      ],
    },
    {
      id: 'productividad',
      icon: '🚀',
      title: 'Más productivo',
      desc: 'Foco profundo, planificación diaria y revisión semanal para avanzar en lo importante.',
      goals: [
        { name: 'Cerrar 3 tareas importantes esta semana', horizon: 'week', area: 'carrera', target: 3, unit: 'tareas' },
      ],
      habits: [
        { name: 'Planificar el día', icon: '📋', color: '#60a5fa', area: 'carrera', timeOfDay: 'mañana', frequency: { type: 'daily' } },
        { name: 'Bloque de foco profundo (90min)', icon: '🎯', color: '#a78bfa', area: 'carrera', timeOfDay: 'mañana', frequency: { type: 'days', days: [1,2,3,4,5] } },
        { name: 'Revisar pendientes y agenda', icon: '✅', color: '#f5c842', area: 'carrera', timeOfDay: 'tarde', frequency: { type: 'days', days: [1,2,3,4,5] } },
      ],
    },
    {
      id: 'bienestar',
      icon: '🧘',
      title: 'Bienestar mental',
      desc: 'Meditación, gratitud, journaling y conexión con personas importantes.',
      goals: [
        { name: 'Meditar 5 días esta semana', horizon: 'week', area: 'crecimiento', target: 5, unit: 'días' },
      ],
      habits: [
        { name: 'Meditar 10 minutos', icon: '🧘', color: '#a78bfa', area: 'crecimiento', timeOfDay: 'mañana', frequency: { type: 'daily' }, linkGoalIndex: 0, defaultIncrement: 1 },
        { name: 'Journaling antes de dormir', icon: '📓', color: '#f0abfc', area: 'crecimiento', timeOfDay: 'noche', frequency: { type: 'daily' } },
        { name: 'Llamar a alguien que quieres', icon: '📞', color: '#ef4444', area: 'relaciones', timeOfDay: 'noche', frequency: { type: 'days', days: [3, 0] } },
      ],
    },
    {
      id: 'completo',
      icon: '✨',
      title: 'Sistema completo',
      desc: 'Combina lo mejor de todos los anteriores. Ideal si quieres arrancar fuerte. Puedes ajustar después.',
      composite: ['salud', 'lectura', 'productividad', 'bienestar'],
    },
  ];

  function getAll() { return TEMPLATES; }

  function apply(templateId) {
    const tpl = TEMPLATES.find(t => t.id === templateId);
    if (!tpl) return { habits: 0, goals: 0 };

    // Si es compuesta, aplicar todas las subplantillas
    if (tpl.composite) {
      let totalH = 0, totalG = 0;
      tpl.composite.forEach(id => {
        const r = apply(id);
        totalH += r.habits;
        totalG += r.goals;
      });
      return { habits: totalH, goals: totalG };
    }

    const state = Storage.get();
    const createdGoals = [];

    // Crear metas primero
    (tpl.goals || []).forEach(g => {
      const goal = {
        id: Storage.uid(),
        name: g.name,
        horizon: g.horizon,
        area: g.area,
        target: g.target || 0,
        unit: g.unit || '',
        current: 0,
        done: false,
        archived: false,
        createdAt: Date.now(),
      };
      state.goals.push(goal);
      createdGoals.push(goal);
    });

    // Crear hábitos (vinculados a las metas si corresponde)
    (tpl.habits || []).forEach(h => {
      const linkedGoalId = (h.linkGoalIndex !== undefined && createdGoals[h.linkGoalIndex])
        ? createdGoals[h.linkGoalIndex].id
        : null;
      state.habits.push({
        id: Storage.uid(),
        name: h.name,
        icon: h.icon,
        color: h.color,
        area: h.area,
        timeOfDay: h.timeOfDay,
        frequency: h.frequency,
        linkedGoalId,
        defaultIncrement: h.defaultIncrement || null,
        createdAt: Date.now(),
        history: [],
        contributions: {},
      });
    });

    Storage.save();
    return { habits: (tpl.habits || []).length, goals: (tpl.goals || []).length };
  }

  return { getAll, apply };
})();

/* ============================================
   WEEK ROLLOVER (archivar metas semanales viejas)
   ============================================ */
/* ============================================
   GOAL ROLLOVER (archivar + auto-crear recurrentes)
   Maneja week / month / year
   ============================================ */
const GoalRollover = (() => {

  // Mapeo: horizon → función que devuelve un "key" único para el período actual
  function periodKey(horizon, date = new Date()) {
    if (horizon === 'week') return UI.weekKey(date);
    if (horizon === 'month') return `${date.getFullYear()}-M${String(date.getMonth()+1).padStart(2,'0')}`;
    if (horizon === 'quarter') {
      const q = Math.floor(date.getMonth() / 3) + 1;
      return `${date.getFullYear()}-Q${q}`;
    }
    if (horizon === 'year') return `${date.getFullYear()}`;
    return '';
  }

  // Mapeo: horizon de la meta → frecuencia de recurrencia que aplica a ese horizonte
  // Una meta semanal puede tener recurrencia weekly. Una mensual: monthly. Etc.
  const RECURRENCE_FOR_HORIZON = {
    week: 'weekly',
    month: 'monthly',
    year: 'yearly',
  };

  function check() {
    const state = Storage.get();
    state.settings.lastPeriodKeys = state.settings.lastPeriodKeys || {};

    // Migración: si existe lastWeekKey viejo pero no lastPeriodKeys.week, usarlo
    if (state.settings.lastWeekKey && !state.settings.lastPeriodKeys.week) {
      state.settings.lastPeriodKeys.week = state.settings.lastWeekKey;
    }
    // Para month/quarter/year: si no existen registros previos, inicializar al período
    // actual (sin hacer rollover) para evitar que la primera ejecución archive todo
    // de golpe. Solo se archivarán a partir del próximo cambio de período.
    ['month', 'year'].forEach(h => {
      if (!state.settings.lastPeriodKeys[h]) {
        state.settings.lastPeriodKeys[h] = periodKey(h);
      }
    });

    let totalArchived = 0;
    let totalPropagated = 0;
    let totalCreated = 0;

    ['week', 'month', 'year'].forEach(horizon => {
      const currentKey = periodKey(horizon);
      const lastKey = state.settings.lastPeriodKeys[horizon];

      if (lastKey && lastKey !== currentKey) {
        // Cambió el período → archivar + auto-crear recurrentes
        const result = rolloverHorizon(horizon, currentKey);
        totalArchived += result.archived;
        totalPropagated += result.propagated;
        totalCreated += result.created;
        // Si terminó una semana sin cerrar, dejarla marcada para poder revisarla
        if (horizon === 'week' && !(state.weekClosures || {})[lastKey]) {
          state.settings.pendingWeekClose = lastKey;
        }
      }

      // Actualizar tracker
      state.settings.lastPeriodKeys[horizon] = currentKey;
    });

    // RE-ENLACE: si alguna meta activa quedó apuntando a un padre archivado
    // (porque el padre también cambió de período y se recreó con nuevo id en
    // esta misma corrida), reapuntarla al reemplazo activo de la misma serie.
    // Esto evita que la vinculación con las metas mayores se rompa al cambiar
    // de semana/mes simultáneamente.
    state.goals.forEach(g => {
      if (g.archived || !g.parentGoalId) return;
      const parent = state.goals.find(p => p.id === g.parentGoalId);
      if (parent && !parent.archived) return; // vínculo sano, nada que hacer
      if (parent && parent.seriesId) {
        const replacement = state.goals.find(p =>
          !p.archived &&
          p.seriesId === parent.seriesId &&
          p.horizon === parent.horizon &&
          p.id !== parent.id
        );
        if (replacement) g.parentGoalId = replacement.id;
      }
    });

    // Compatibilidad con tracker viejo de solo-semanas
    state.settings.lastWeekKey = periodKey('week');

    // Mostrar toast con resumen
    if (totalArchived > 0 || totalCreated > 0) {
      const parts = [];
      if (totalArchived > 0) {
        parts.push(`📦 ${totalArchived} archivada${totalArchived>1?'s':''}`);
      }
      if (totalPropagated > 0) {
        parts.push(`+${totalPropagated} a metas mayores`);
      }
      if (totalCreated > 0) {
        parts.push(`🔁 ${totalCreated} recurrente${totalCreated>1?'s':''} creada${totalCreated>1?'s':''}`);
      }
      UI.toast(parts.join(' · '));
    }

    Storage.save();
  }

  function rolloverHorizon(horizon, currentKey) {
    const state = Storage.get();
    let archivedCount = 0;
    let totalPropagated = 0;
    let createdCount = 0;

    // 1) ARCHIVAR metas del horizonte que NO sean del período actual
    const toRecreate = []; // metas recurrentes que deben crear copia para el nuevo período

    state.goals.forEach(g => {
      if (g.horizon !== horizon || g.archived) return;

      const goalPeriod = periodKey(horizon, new Date(g.createdAt));
      if (goalPeriod === currentKey) return; // todavía del período actual

      // Propagar avance real al padre antes de archivar
      if (g.parentGoalId && g.target > 0) {
        if (g.done) {
          g.propagatedCurrent = g.target;
        } else if ((g.current || 0) > 0) {
          const delta = g.current;
          const parent = state.goals.find(p => p.id === g.parentGoalId);
          if (parent && parent.target) {
            parent.current = Math.max(0, (parent.current || 0) + delta);
            parent.done = parent.current >= parent.target;
            g.propagatedCurrent = delta;
            totalPropagated += delta;
          }
        } else {
          g.propagatedCurrent = 0;
        }
      }

      g.archived = true;
      g.archivedAt = Date.now();
      archivedCount++;

      // Si era recurrente con la frecuencia correspondiente, marcarla para recrear
      const expectedRec = RECURRENCE_FOR_HORIZON[horizon];
      if (g.recurrence === expectedRec && g.seriesId) {
        toRecreate.push(g);
      }
    });

    // 2) AUTO-CREAR copia para período actual de cada meta recurrente
    toRecreate.forEach(originalGoal => {
      // Verificar que no exista ya una activa de esta serie en el período actual
      const alreadyExists = state.goals.some(g =>
        !g.archived &&
        g.seriesId === originalGoal.seriesId &&
        g.horizon === horizon
      );
      if (alreadyExists) return;

      // Crear copia limpia
      const copy = {
        id: Storage.uid(),
        seriesId: originalGoal.seriesId,
        name: originalGoal.name,
        horizon: originalGoal.horizon,
        area: originalGoal.area,
        target: originalGoal.target,
        unit: originalGoal.unit,
        parentGoalId: originalGoal.parentGoalId, // mantener vinculación
        recurrence: originalGoal.recurrence,
        current: 0,
        done: false,
        createdAt: Date.now(),
      };
      state.goals.push(copy);
      createdCount++;
    });

    return { archived: archivedCount, propagated: totalPropagated, created: createdCount };
  }

  return { check, periodKey };
})();



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

/* ============================================
   STATS (vista de revisión)
   ============================================ */
const Stats = (() => {
  let currentTab = 'resumen';
  // Meses del historial de cierres abiertos/colapsados (por defecto: solo el más reciente)
  const histMonthsOpen = {};
  const histYearsOpen = {};

  function setTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.stats-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.statsTab === tab);
    });
    document.querySelectorAll('.stats-panel').forEach(pn => {
      pn.classList.toggle('active', pn.id === 'stats-panel-' + tab);
    });
    render();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function render() {
    if (currentTab === 'resumen') {
      renderTrend();
      renderGoals();
      Habits.renderHeatmap();
    } else if (currentTab === 'habitos') {
      renderHabits();
    } else if (currentTab === 'cierres') {
      renderWellbeing();
      renderHistory();
    } else if (currentTab === 'finanzas') {
      if (typeof Finance !== 'undefined' && Finance.openAnalysis) Finance.openAnalysis();
    }
  }

  /* ---------- Tendencia semanal ---------- */
  function weeklyAverages(nWeeks) {
    const state = Storage.get();
    const today = new Date();
    const todayKey = UI.todayKey();
    const out = [];
    for (let i = nWeeks - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i * 7);
      const wk = UI.weekKey(d);
      const r = App.weekRange(wk);
      if (!r) continue;
      const vals = r.days
        .filter(dk => dk <= todayKey)
        .map(dk => state.dailySnapshots[dk])
        .filter(v => typeof v === 'number');
      out.push({
        wk,
        start: r.start,
        pct: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null,
        isCurrent: i === 0,
      });
    }
    return out;
  }

  function renderTrend() {
    const c = document.getElementById('stats-trend');
    if (!c) return;
    const data = weeklyAverages(12);
    const withData = data.filter(d => d.pct !== null);
    if (withData.length < 2) {
      c.innerHTML = '<div class="empty">Aún no hay suficiente historial · vuelve en unos días</div>';
      return;
    }

    const avg = Math.round(withData.reduce((a, b) => a + b.pct, 0) / withData.length);
    const cur = data[data.length - 1].pct;
    const prev = data.length > 1 ? data[data.length - 2].pct : null;
    let deltaHTML = '';
    if (cur !== null && prev !== null) {
      const diff = cur - prev;
      const cls = diff > 0 ? 'positive' : (diff < 0 ? 'negative' : 'zero');
      const sign = diff > 0 ? '▲ +' : (diff < 0 ? '▼ ' : '= ');
      deltaHTML = `<span class="trend-delta ${cls}">${sign}${diff === 0 ? '' : Math.abs(diff) + ' pts'}</span>`;
    }

    const bars = data.map((d, i) => {
      const h = d.pct === null ? 0 : Math.max(3, d.pct);
      const label = new Date(d.start + 'T12:00:00').toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
      const showLbl = (data.length - 1 - i) % 3 === 0;
      return `
        <div class="trend-col ${d.isCurrent ? 'is-current' : ''} ${d.pct === null ? 'is-empty' : ''}" title="${label}: ${d.pct === null ? 'sin datos' : d.pct + '%'}">
          <div class="trend-val">${d.pct === null ? '' : d.pct}</div>
          <div class="trend-bar-wrap"><div class="trend-bar" style="height:${h}%"></div></div>
          <div class="trend-lbl">${showLbl ? label.replace('.', '') : ''}</div>
        </div>`;
    }).join('');

    c.innerHTML = `
      <div class="trend-summary">
        <div class="trend-summary-main">
          <span class="trend-summary-val">${cur === null ? '—' : cur + '%'}</span>
          <span class="trend-summary-lbl">Esta semana</span>
        </div>
        ${deltaHTML}
        <div class="trend-summary-side">Promedio ${avg}%</div>
      </div>
      <div class="trend-chart">${bars}</div>`;
  }

  /* ---------- Metas del período ---------- */
  function renderGoals() {
    const c = document.getElementById('stats-goals');
    if (!c) return;
    const state = Storage.get();
    const rows = [
      ['week', 'Semana'], ['month', 'Mes'], ['year', 'Año'],
    ].map(([h, label]) => {
      const key = GoalRollover.periodKey(h);
      const list = state.goals.filter(g =>
        g.horizon === h && GoalRollover.periodKey(h, new Date(g.createdAt)) === key
      );
      return { label, done: list.filter(g => g.done).length, total: list.length };
    });

    if (rows.every(r => r.total === 0)) {
      c.innerHTML = '<div class="empty">Sin metas definidas en los períodos en curso</div>';
      return;
    }

    c.innerHTML = rows.map(r => {
      const pct = r.total === 0 ? 0 : Math.round((r.done / r.total) * 100);
      return `
        <div class="sg-row ${r.total === 0 ? 'is-empty' : ''}">
          <span class="sg-label">${r.label}</span>
          <div class="sg-bar"><div class="sg-fill" style="width:${pct}%"></div></div>
          <span class="sg-val">${r.total === 0 ? '—' : r.done + '/' + r.total}</span>
        </div>`;
    }).join('');
  }

  /* ---------- Cumplimiento por hábito ---------- */
  function renderHabits() {
    const c = document.getElementById('stats-habits');
    if (!c) return;
    const state = Storage.get();
    if (!state.habits.length) {
      c.innerHTML = '<div class="empty">No tienes hábitos creados</div>';
      return;
    }
    c.innerHTML = state.habits.map(h => {
      const w7 = Habits.complianceWindow(h, 7).pct;
      const w30 = Habits.complianceWindow(h, 30).pct;
      const w90 = Habits.complianceWindow(h, 90).pct;
      const streak = Habits.calcStreak(h);
      const best = Habits.calcBestStreak(h);
      const color = h.color || '#f5c842';
      const trend = w7 - w30;
      const trendCls = trend > 4 ? 'positive' : (trend < -4 ? 'negative' : 'zero');
      const trendTxt = trend > 4 ? '▲ subiendo' : (trend < -4 ? '▼ bajando' : '= estable');
      return `
        <div class="sh-item">
          <div class="sh-head">
            <span class="sh-name">${h.icon || '⭐'} ${escapeHtml(h.name)}</span>
            <span class="sh-trend ${trendCls}">${trendTxt}</span>
          </div>
          <div class="sh-windows">
            ${[['7d', w7], ['30d', w30], ['90d', w90]].map(([lbl, v]) => `
              <div class="sh-win">
                <div class="sh-win-bar"><div class="sh-win-fill" style="height:${Math.max(2, v)}%;background:${color}"></div></div>
                <div class="sh-win-val">${v}%</div>
                <div class="sh-win-lbl">${lbl}</div>
              </div>`).join('')}
            <div class="sh-streaks">
              <div class="sh-streak"><span class="sh-streak-val">${streak}</span><span class="sh-streak-lbl">racha</span></div>
              <div class="sh-streak"><span class="sh-streak-val">${best}</span><span class="sh-streak-lbl">récord</span></div>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  /* ---------- Bienestar ---------- */
  function renderWellbeing() {
    const c = document.getElementById('stats-wellbeing');
    if (!c) return;
    const state = Storage.get();
    const today = new Date();
    const entries = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const e = state.closures[UI.localDateKey(d)];
      if (e) entries.push(e);
    }
    if (entries.length === 0) {
      const sub = document.getElementById('wellbeing-subtitle');
      if (sub) sub.textContent = 'Promedio · últimos 30 días';
      c.innerHTML = '<div class="empty">Aún no has cerrado ningún día · el cierre está al final de Enfoque → Hoy</div>';
      return;
    }
    const avgOf = (k) => {
      const vals = entries.map(e => e[k]).filter(v => typeof v === 'number');
      return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    };
    const rows = [
      { icon: '⚡', label: 'Energía', val: avgOf('energy'), max: 5, unit: '/5', color: 'var(--accent-yellow)' },
      { icon: '😰', label: 'Estrés', val: avgOf('stress'), max: 5, unit: '/5', color: 'var(--accent-red)' },
      { icon: '💤', label: 'Sueño', val: avgOf('sleep'), max: 9, unit: ' h', color: 'var(--accent-blue, #60a5fa)' },
    ];
    const sub = document.getElementById('wellbeing-subtitle');
    if (sub) sub.textContent = `Promedio · ${entries.length} de 30 días cerrados`;

    c.innerHTML = rows.map(r => {
      const pct = r.val === null ? 0 : Math.min(100, Math.round((r.val / r.max) * 100));
      return `
        <div class="wb-row">
          <span class="wb-label">${r.icon} ${r.label}</span>
          <div class="wb-bar"><div class="wb-fill" style="width:${pct}%;background:${r.color}"></div></div>
          <span class="wb-val">${r.val === null ? '—' : r.val.toFixed(1) + r.unit}</span>
        </div>`;
    }).join('');
  }

  /* ---------- Historial de cierres ---------- */
  function renderHistory() {
    const c = document.getElementById('stats-history');
    if (!c) return;
    const state = Storage.get();

    const dayItems = Object.keys(state.closures || {}).map(dk => ({ kind: 'day', key: dk, sort: dk }));
    const weekItems = Object.keys(state.weekClosures || {}).map(wk => {
      const r = App.weekRange(wk) || {};
      // La semana se ubica por su fecha de FIN (domingo): el cierre semanal se
      // hace al terminar la semana, así que va DESPUÉS de sus días.
      return { kind: 'week', key: wk, sort: r.end || r.start || wk };
    });

    if (dayItems.length + weekItems.length === 0) {
      c.innerHTML = '<div class="empty">Todavía no hay cierres guardados</div>';
      return;
    }

    // Agrupar por mes (YYYY-MM) usando la fecha de orden de cada cierre
    const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const monthLabel = mk => {
      const [y, m] = mk.split('-');
      return `${MONTHS[parseInt(m, 10) - 1]} ${y}`;
    };
    const monthKeys = new Set();
    [...dayItems, ...weekItems].forEach(it => monthKeys.add(it.sort.slice(0, 7)));
    const orderedMonths = [...monthKeys].sort((a, b) => b.localeCompare(a));

    const dayCard = it => {
      const e = state.closures[it.key];
      const label = new Date(it.key + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'short', day: '2-digit', month: 'short' });
      const bits = [];
      if (typeof e.energy === 'number') bits.push(`⚡ ${e.energy}`);
      if (typeof e.sleep === 'number') bits.push(`💤 ${e.sleep} h`);
      const preview = e.learn || (e.gratitude || []).filter(Boolean)[0] || bits.join(' · ') || 'Sin notas';
      return `
        <div class="hist-item" data-kind="day" data-key="${it.key}">
          <span class="hist-icon">🌙</span>
          <div class="hist-body">
            <div class="hist-title">${label}</div>
            <div class="hist-preview">${escapeHtml(preview)}</div>
          </div>
        </div>`;
    };
    const weekCard = it => {
      const e = state.weekClosures[it.key];
      const preview = e.focus || e.worked || e.blocked || 'Sin notas';
      return `
        <div class="hist-item" data-kind="week" data-key="${it.key}">
          <span class="hist-icon">📅</span>
          <div class="hist-body">
            <div class="hist-title">Semana ${App.weekLabelFor(it.key)}</div>
            <div class="hist-preview">${escapeHtml(preview)}</div>
          </div>
        </div>`;
    };

    let html = '';
    // Agrupar meses por AÑO. Dentro de cada año, los meses; dentro de cada mes,
    // los cierres (días y semanas) intercalados por fecha.
    const yearKeys = [...new Set(orderedMonths.map(mk => mk.slice(0, 4)))].sort((a, b) => b.localeCompare(a));

    yearKeys.forEach((yk, yIdx) => {
      const monthsOfYear = orderedMonths.filter(mk => mk.slice(0, 4) === yk);
      const yearItemCount = [...dayItems, ...weekItems].filter(it => it.sort.slice(0, 4) === yk).length;
      const yearOpen = (yk in histYearsOpen) ? histYearsOpen[yk] : (yIdx === 0);

      let monthsHTML = '';
      monthsOfYear.forEach((mk, mIdx) => {
        const monthItems = [...dayItems, ...weekItems]
          .filter(it => it.sort.slice(0, 7) === mk)
          .sort((a, b) => {
            const cc = b.sort.localeCompare(a.sort);
            if (cc !== 0) return cc;
            return a.kind === 'week' ? 1 : -1;
          });
        // Mes abierto: el más reciente del año más reciente por defecto.
        const monthOpen = (mk in histMonthsOpen) ? histMonthsOpen[mk] : (yIdx === 0 && mIdx === 0);
        monthsHTML += `<div class="hist-month ${monthOpen ? 'open' : ''}">`;
        monthsHTML += `<button class="hist-month-label" data-hist-month="${mk}" type="button">
          <span class="hist-month-name">${monthLabel(mk)}</span>
          <span class="hist-month-count">${monthItems.length}</span>
          <span class="hist-month-chevron">▾</span>
        </button>`;
        monthsHTML += `<div class="hist-month-body">`;
        monthsHTML += monthItems.map(it => it.kind === 'week' ? weekCard(it) : dayCard(it)).join('');
        monthsHTML += `</div></div>`;
      });

      html += `<div class="hist-year ${yearOpen ? 'open' : ''}">`;
      html += `<button class="hist-year-label" data-hist-year="${yk}" type="button">
        <span class="hist-year-name">${yk}</span>
        <span class="hist-year-count">${yearItemCount}</span>
        <span class="hist-year-chevron">▾</span>
      </button>`;
      html += `<div class="hist-year-body">${monthsHTML}</div></div>`;
    });
    c.innerHTML = html;

    // Toggle de años
    c.querySelectorAll('[data-hist-year]').forEach(btn => {
      btn.addEventListener('click', () => {
        const yk = btn.dataset.histYear;
        const yearEl = btn.closest('.hist-year');
        const nowOpen = !yearEl.classList.contains('open');
        histYearsOpen[yk] = nowOpen;
        yearEl.classList.toggle('open', nowOpen);
      });
    });

    // Toggle de meses (sin re-render, solo alterna la clase)
    c.querySelectorAll('[data-hist-month]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mk = btn.dataset.histMonth;
        const monthEl = btn.closest('.hist-month');
        const nowOpen = !monthEl.classList.contains('open');
        histMonthsOpen[mk] = nowOpen;
        monthEl.classList.toggle('open', nowOpen);
      });
    });

    c.querySelectorAll('.hist-item').forEach(el => {
      el.addEventListener('click', () => openClosure(el.dataset.kind, el.dataset.key));
    });
  }

  // Desde el historial, tocar un cierre lo abre editable (mismo formulario del
  // cierre real). App expone los abridores para reutilizar la lógica.
  function openClosure(kind, key) {
    if (kind === 'week') {
      App.openWeekCloseModal(key);
    } else {
      App.openDayCloseModal(key);
    }
  }

  function bind() {
    document.querySelectorAll('.stats-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        UI.buzz(8);
        setTab(tab.dataset.statsTab);
      });
    });
  }

  return { setTab, render, bind };
})();


/* ============================================
   ONBOARDING
   ============================================ */
const Onboarding = (() => {
  function start() {
    const ov = document.getElementById('onboarding-overlay');
    document.getElementById('onb-step-1').hidden = false;
    document.getElementById('onb-step-2').hidden = true;
    document.getElementById('onb-name').value = Storage.get().user.name || '';
    renderTemplates();
    ov.hidden = false;
  }

  function close() {
    document.getElementById('onboarding-overlay').hidden = true;
    Storage.get().settings.onboarded = true;
    Storage.save();
  }

  function next() {
    const name = document.getElementById('onb-name').value.trim();
    Storage.get().user.name = name;
    Storage.save();
    document.getElementById('onb-step-1').hidden = true;
    document.getElementById('onb-step-2').hidden = false;
  }

  let selectedTemplate = null;

  function renderTemplates() {
    const c = document.getElementById('onb-templates');
    const tpls = Templates.getAll();
    c.innerHTML = tpls.map(t => {
      const habitCount = t.composite
        ? t.composite.reduce((sum, id) => sum + (tpls.find(x => x.id === id)?.habits?.length || 0), 0)
        : (t.habits || []).length;
      const goalCount = t.composite
        ? t.composite.reduce((sum, id) => sum + (tpls.find(x => x.id === id)?.goals?.length || 0), 0)
        : (t.goals || []).length;
      return `
        <button class="onb-template" data-tpl="${t.id}">
          <span class="onb-tpl-icon">${t.icon}</span>
          <div class="onb-tpl-body">
            <div class="onb-tpl-title">${t.title}</div>
            <div class="onb-tpl-desc">${t.desc}</div>
            <div class="onb-tpl-count">${habitCount} hábitos · ${goalCount} metas</div>
          </div>
        </button>
      `;
    }).join('');

    c.querySelectorAll('.onb-template').forEach(btn => {
      btn.addEventListener('click', () => {
        c.querySelectorAll('.onb-template').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedTemplate = btn.dataset.tpl;
      });
    });
  }

  function finish() {
    if (selectedTemplate) {
      const r = Templates.apply(selectedTemplate);
      UI.toast(`✨ ${r.habits} hábitos y ${r.goals} metas cargadas`);
    }
    close();
    setTimeout(() => location.reload(), 600);
  }

  function skipTemplates() {
    close();
    location.reload();
  }

  function skipAll() {
    close();
    location.reload();
  }

  function openFromSettings() {
    UI.openModal({
      title: '📦 Plantillas',
      okText: 'Cerrar',
      bodyHTML: `
        <p style="color:var(--text-dim);font-size:13px;margin-bottom:14px">Selecciona una plantilla para agregar hábitos y metas. Se suman a lo que ya tienes (no se reemplaza nada).</p>
        <div id="settings-templates"></div>
      `,
      onSave: () => true
    });

    setTimeout(() => {
      const c = document.getElementById('settings-templates');
      if (!c) return;
      const tpls = Templates.getAll();
      c.innerHTML = tpls.map(t => {
        const habitCount = t.composite
          ? t.composite.reduce((sum, id) => sum + (tpls.find(x => x.id === id)?.habits?.length || 0), 0)
          : (t.habits || []).length;
        const goalCount = t.composite
          ? t.composite.reduce((sum, id) => sum + (tpls.find(x => x.id === id)?.goals?.length || 0), 0)
          : (t.goals || []).length;
        return `
          <button class="onb-template" data-tpl="${t.id}" style="width:100%;margin-bottom:8px">
            <span class="onb-tpl-icon">${t.icon}</span>
            <div class="onb-tpl-body">
              <div class="onb-tpl-title">${t.title}</div>
              <div class="onb-tpl-desc">${t.desc}</div>
              <div class="onb-tpl-count">${habitCount} hábitos · ${goalCount} metas</div>
            </div>
          </button>
        `;
      }).join('');

      c.querySelectorAll('.onb-template').forEach(btn => {
        btn.addEventListener('click', () => {
          const tplId = btn.dataset.tpl;
          const tpl = Templates.getAll().find(t => t.id === tplId);
          UI.confirm2({
            title: `Aplicar "${tpl.title}"`,
            message: `Se agregarán los hábitos y metas de esta plantilla a tu dashboard. ¿Continuar?`,
            okText: 'Sí, agregar',
            onConfirm: () => {
              const r = Templates.apply(tplId);
              UI.toast(`✨ +${r.habits} hábitos, +${r.goals} metas`);
              setTimeout(() => location.reload(), 700);
            }
          });
        });
      });
    }, 80);
  }

  function bindUI() {
    document.getElementById('onb-next-1').addEventListener('click', next);
    document.getElementById('onb-finish').addEventListener('click', finish);
    document.getElementById('onb-skip-templates').addEventListener('click', skipTemplates);
    document.getElementById('onb-skip-all').addEventListener('click', skipAll);
  }

  document.addEventListener('DOMContentLoaded', bindUI);

  return { start, openFromSettings };
})();


const App = (() => {
  function migrateAreas() {
    const s = Storage.get();
    if (s.settings.areasEspiritualidadAdded) return;
    s.areas = s.areas || [];
    if (!s.areas.some(a => a.id === 'espiritualidad')) {
      s.areas.push({ id: 'espiritualidad', name: 'Espiritualidad', icon: '🧘', color: '#818cf8' });
    }
    s.settings.areasEspiritualidadAdded = true;
    Storage.save();
  }

  // Migración one-shot: elimina el horizonte trimestral de metas.
  // Se descartó por completo (eran datos de prueba). Borra las metas 'quarter'
  // y normaliza cualquier recurrencia 'quarterly' huérfana a 'none'.
  function migrateRemoveQuarter() {
    const s = Storage.get();
    if (s.settings.quarterRemoved) return;
    s.goals = (s.goals || []).filter(g => g.horizon !== 'quarter');
    s.goals.forEach(g => { if (g.recurrence === 'quarterly') g.recurrence = 'none'; });
    if (s.settings.lastPeriodKeys) delete s.settings.lastPeriodKeys.quarter;
    s.settings.quarterRemoved = true;
    Storage.save();
  }

  function init() {
    applyTheme();

    // Migración one-shot: agregar el área "Espiritualidad" a usuarios existentes.
    // Usa un flag para no reinsertarla si el usuario decide borrarla luego.
    migrateAreas();
    migrateRemoveQuarter();

    // Verificar rollover de semana antes de cualquier render
    GoalRollover.check();

    renderHeader();
    renderWeekStrip();
    renderBackupReminder();
    Vacation.renderBanner();
    Vacation.renderStatus();
    Habits.renderOverview(); Habits.renderFull(); Habits.renderHeatmap();
    Tasks.renderToday(); Tasks.renderFull();
    Goals.renderAll(); Goals.renderWeeklyMini();
    Finance.render();
    Finance.renderDashboard();
    refreshKPIs();
    renderCloseDay();
    renderWeekClose();
    bindAll();
    Stats.bind();
    renderWeekLabel();
    setupDayRolloverWatcher();

    // Onboarding: mostrar si no se hizo y no hay datos previos
    const s = Storage.get();
    const hasData = s.habits.length > 0 || s.tasks.length > 0 || s.goals.length > 0;
    if (!s.settings.onboarded && !hasData) {
      Onboarding.start();
    }
  }

  // Refresca todas las vistas (útil al activar/desactivar vacaciones)
  function refreshAll() {
    renderHeader();
    renderWeekStrip();
    renderBackupReminder();
    Vacation.renderBanner();
    Vacation.renderStatus();
    Habits.renderOverview(); Habits.renderFull(); Habits.renderHeatmap();
    Tasks.renderToday(); Tasks.renderFull();
    Goals.renderAll(); Goals.renderWeeklyMini();
    Finance.render();
    Finance.renderDashboard();
    refreshKPIs();
    renderCloseDay();
    renderWeekClose();
    renderWeekLabel();
    if (typeof Stats !== 'undefined') Stats.render();
    if (typeof Habits.renderDetail === 'function') Habits.renderDetail();
  }

  function applyTheme() {
    const t = Storage.get().settings.theme || 'dark';
    document.documentElement.setAttribute('data-theme', t);
    // OJO: el propio <html> lleva data-theme, así que hay que acotar el selector
    // a los botones reales. Si no, se le cuelga un listener al <html> y CADA clic
    // de la app termina escribiendo el estado completo en localStorage.
    document.querySelectorAll('.theme-row [data-theme]').forEach(b => {
      b.classList.toggle('active', b.dataset.theme === t);
    });
  }

  function renderHeader() {
    // Pintar la fecha bajo el título "Hoy"
    const el = document.getElementById('today-date-label');
    if (el) {
      const d = new Date();
      const txt = d.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
      el.textContent = txt;
    }
  }

  function renderWeekStrip(precomputedPct) {
    const c = document.getElementById('week-strip');
    const labels = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    const today = new Date();
    // Lunes como inicio de semana
    const dow = today.getDay(); // 0=Dom..6=Sáb
    const offsetToMonday = (dow === 0 ? -6 : 1 - dow);
    const monday = new Date(today);
    monday.setDate(today.getDate() + offsetToMonday);

    let pctToday;
    if (typeof precomputedPct === 'number') {
      pctToday = precomputedPct;
    } else {
      // Mismo cálculo que refreshKPIs: promedio de % de cada hábito/tarea
      const state = Storage.get();
      const onVacation = Vacation.isActive();
      const habitsToday = onVacation ? [] : state.habits.filter(Habits.isHabitForToday);
      const tasksToday = state.tasks.filter(t => t.date === UI.todayKey());
      const habitsPctSum = habitsToday.reduce((acc, h) => acc + Habits.getHabitDayPct(h), 0);
      const tasksPctSum = tasksToday.reduce((acc, t) => acc + (t.done ? 100 : 0), 0);
      const total = habitsToday.length + tasksToday.length;
      pctToday = total === 0 ? 0 : Math.round((habitsPctSum + tasksPctSum) / total);
    }

    // Persistir el % de hoy en dailySnapshots (para que mañana, cuando este día sea
    // pasado, conserve su anillo). Se guarda aunque el strip no esté a la vista,
    // pero solo si el valor cambió: evita escribir en localStorage en cada render.
    const state = Storage.get();
    if (!state.dailySnapshots) state.dailySnapshots = {};
    const tk = UI.todayKey();
    if (state.dailySnapshots[tk] !== pctToday) {
      state.dailySnapshots[tk] = pctToday;
      Storage.save();
    }

    // Desde aquí es solo pintado
    if (!isLive(c)) return;

    // Anillo: radio 22 en viewBox 48, circunferencia ≈ 138.23
    const R = 22;
    const C = 2 * Math.PI * R;

    // Helper para generar SVG de anillo con un % dado
    const ringSVG = (pct) => {
      const off = C - (pct / 100) * C;
      return `
        <svg class="week-day-ring" viewBox="0 0 48 48">
          <defs>
            <linearGradient id="weekDayRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#f5c842"/>
              <stop offset="100%" stop-color="#fb923c"/>
            </linearGradient>
          </defs>
          <circle class="ring-track" cx="24" cy="24" r="${R}"/>
          <circle class="ring-bar" cx="24" cy="24" r="${R}"
            stroke-dasharray="${C}"
            stroke-dashoffset="${off}"
            transform="rotate(-90 24 24)"/>
        </svg>
      `;
    };

    let html = '';
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const isToday = d.toDateString() === today.toDateString();
      const isFuture = d > today && !isToday;
      const isPast = !isToday && !isFuture;
      const dateKey = UI.localDateKey(d);

      const classes = ['week-day'];
      if (isToday) classes.push('is-today');
      if (isFuture) classes.push('is-future');
      if (isPast) classes.push('is-past');

      let ring = '';
      if (isToday) {
        ring = ringSVG(pctToday);
      } else if (isPast) {
        // Buscar snapshot del día; si no existe, anillo en 0%
        const past = state.dailySnapshots[dateKey];
        if (typeof past === 'number') {
          ring = ringSVG(past);
        }
      }

      html += `
        <button class="${classes.join(' ')}" data-date-key="${dateKey}" type="button">
          <div class="week-day-label">${labels[i]}</div>
          <div class="week-day-num">${d.getDate()}${ring}</div>
        </button>
      `;
    }
    c.innerHTML = html;

    // Bind clicks: tocar un día abre el resumen de ese día
    c.querySelectorAll('.week-day').forEach(btn => {
      btn.addEventListener('click', () => {
        const dk = btn.dataset.dateKey;
        if (!dk) return;
        // Si es hoy, no hacer nada (ya estás en Hoy)
        if (dk === UI.todayKey()) return;
        openDaySummary(dk);
      });
    });
  }

  function renderWeekLabel() {
    const wk = UI.weekKey();
    const el = document.getElementById('week-label');
    if (el) el.textContent = wk + ' · ESTA SEMANA';
  }

  // Modal con el resumen de un día (tareas + hábitos + pagos pendientes)
  function openDaySummary(dateKey) {
    const state = Storage.get();
    const date = new Date(dateKey + 'T12:00:00');
    const dateLabel = date.toLocaleDateString('es-CL', {
      weekday: 'long', day: 'numeric', month: 'long'
    });
    const isFuture = dateKey > UI.todayKey();
    const isPast = dateKey < UI.todayKey();

    // Tareas del día
    const tasks = (state.tasks || [])
      .filter(t => t.date === dateKey)
      .sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0));

    // Hábitos que aplican en ese día (según frequency)
    const habits = (state.habits || []).filter(h => {
      if (h.frequency?.type === 'daily') return true;
      if (h.frequency?.type === 'days') {
        const dow = date.getDay();
        return (h.frequency.days || []).includes(dow);
      }
      return false;
    });

    // Pagos REALES de ese día: gastos registrados en movements con esa fecha
    const dayPayments = (state.movements || []).filter(m =>
      m.type === 'expense' && m.date === dateKey
    );

    // Render
    let html = `<div class="day-summary-info">${dateLabel}${isFuture ? ' · futuro (solo lectura)' : isPast ? ' · pasado (solo lectura)' : ''}</div>`;

    // Tareas
    html += `<div class="day-summary-section"><div class="day-summary-section-title">✅ Tareas (${tasks.length})</div>`;
    if (tasks.length === 0) {
      html += '<div class="empty">Sin tareas para este día</div>';
    } else {
      html += tasks.map(t => `
        <div class="day-summary-item ${t.done ? 'is-done' : ''}">
          <span class="day-summary-check">${t.done ? '✓' : '○'}</span>
          <span class="day-summary-name">${escapeHtml(t.name || '')}</span>
        </div>
      `).join('');
    }
    html += '</div>';

    // Hábitos
    html += `<div class="day-summary-section"><div class="day-summary-section-title">✨ Hábitos (${habits.length})</div>`;
    if (habits.length === 0) {
      html += '<div class="empty">Sin hábitos para este día</div>';
    } else {
      html += habits.map(h => {
        const target = (h.dailyTarget && h.dailyTarget > 0) ? h.dailyTarget : 1;
        const unit = h.unit || 'sesión';
        const cur = (h.dailyProgress && h.dailyProgress[dateKey]) || 0;
        const reached = cur >= target;
        return `
          <div class="day-summary-item ${reached ? 'is-done' : ''}">
            <span class="day-summary-check">${reached ? '✓' : '○'}</span>
            <span class="day-summary-icon">${h.icon || '⭐'}</span>
            <span class="day-summary-name">${escapeHtml(h.name)}</span>
            <span class="day-summary-progress">${cur}/${target} ${unit}</span>
          </div>
        `;
      }).join('');
    }
    html += '</div>';

    // Pagos del día (reales)
    html += `<div class="day-summary-section"><div class="day-summary-section-title">💰 Pagos del día (${dayPayments.length})</div>`;
    if (dayPayments.length === 0) {
      html += '<div class="empty">Sin pagos este día</div>';
    } else {
      html += dayPayments.map(p => `
        <div class="day-summary-item">
          <span class="day-summary-icon">💸</span>
          <span class="day-summary-name">${escapeHtml(p.name || 'Pago')}</span>
          <span class="day-summary-progress">${Finance.formatCLP(p.amount || 0)}</span>
        </div>
      `).join('');
    }
    html += '</div>';

    // Cierre del día (solo lectura, solo si existe)
    const cl = (state.closures || {})[dateKey];
    if (cl) {
      const grat = (cl.gratitude || []).filter(Boolean);
      html += '<div class="day-summary-section"><div class="day-summary-section-title">🌙 Cierre del día</div>';
      html += `<div class="ds-close-metrics">
          <span>⚡ Energía ${cl.energy ?? '—'}/5</span>
          <span>😰 Estrés ${cl.stress ?? '—'}/5</span>
          <span>💤 ${cl.sleep ?? '—'} h</span>
        </div>`;
      if (grat.length) {
        html += '<div class="ds-close-block"><div class="ds-close-lbl">Agradecido por</div>' +
          grat.map(g => `<div class="ds-close-txt">· ${escapeHtml(g)}</div>`).join('') + '</div>';
      }
      if (cl.learn) {
        html += `<div class="ds-close-block"><div class="ds-close-lbl">Destacado del día</div><div class="ds-close-txt">${escapeHtml(cl.learn)}</div></div>`;
      }
      html += '</div>';
    }

    UI.openModal({
      title: `📅 ${dateLabel}`,
      okText: 'Cerrar',
      bodyHTML: html,
      onSave: () => true
    });
  }

  // ====== CALENDARIO MENSUAL (sheet) ======
  const CAL_MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  let calYear, calMonth;

  function openCalendarSheet() {
    const now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();
    renderCalendar();
    const s = document.getElementById('sheet-calendar');
    if (s) s.hidden = false;
  }

  function calNav(delta) {
    calMonth += delta;
    if (calMonth < 0) { calMonth = 11; calYear--; }
    if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar();
  }

  function renderCalendar() {
    const grid = document.getElementById('cal-grid');
    const label = document.getElementById('cal-month-label');
    if (!grid || !label) return;

    label.textContent = `${CAL_MONTHS[calMonth]} ${calYear}`;

    const dows = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];
    let html = dows.map(d => `<div class="cal-dow">${d}</div>`).join('');

    const first = new Date(calYear, calMonth, 1);
    // Lunes = 0 ... Domingo = 6
    const startDow = (first.getDay() === 0) ? 6 : first.getDay() - 1;
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const todayKey = UI.todayKey();
    const closures = Storage.get().closures || {};

    for (let i = 0; i < startDow; i++) html += '<div class="cal-cell empty"></div>';

    for (let d = 1; d <= daysInMonth; d++) {
      const dk = UI.localDateKey(new Date(calYear, calMonth, d));
      const isToday = dk === todayKey;
      const isFuture = dk > todayKey;
      const hasClosure = !!closures[dk];
      const cls = ['cal-cell'];
      if (isToday) cls.push('is-today');
      if (isFuture) cls.push('is-future');
      const dot = hasClosure ? '<span class="cal-dot" aria-hidden="true"></span>' : '';
      html += `<button class="${cls.join(' ')}" data-cal-day="${dk}" type="button"><span class="cal-num">${d}</span>${dot}</button>`;
    }

    grid.innerHTML = html;
    grid.querySelectorAll('[data-cal-day]').forEach(b => {
      b.addEventListener('click', () => openDaySummary(b.dataset.calDay));
    });
  }

  function getGreeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Buenos días';
    if (h < 19) return 'Buenas tardes';
    return 'Buenas noches';
  }




  // ====== BACKUP REMINDER ======
  function renderBackupReminder() {
    const slot = document.getElementById('backup-reminder-slot');
    if (!slot) return;
    const s = Storage.get();
    const lastBackup = s.settings.lastBackup;
    const dismissed = s.settings.backupReminderDismissed;
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;

    // Solo mostrar si hay datos y no se respaldó en >=10 días
    const hasData = s.habits.length > 0 || s.tasks.length > 0 || s.goals.length > 0;
    if (!hasData) { slot.innerHTML = ''; return; }

    const daysSinceBackup = lastBackup ? Math.floor((now - lastBackup) / DAY) : null;
    const daysSinceDismiss = dismissed ? Math.floor((now - dismissed) / DAY) : null;

    // Mostrar si: nunca se respaldó (y se descartó hace >=7 días o nunca), o si pasaron >=10 días desde el último respaldo
    const shouldShow = (
      (lastBackup === null && (dismissed === null || daysSinceDismiss >= 7)) ||
      (lastBackup !== null && daysSinceBackup >= 10 && (dismissed === null || daysSinceDismiss >= 7))
    );

    if (!shouldShow) { slot.innerHTML = ''; return; }

    const message = lastBackup === null
      ? 'Aún no has respaldado tus datos. Si pierdes el celular, se perderá todo.'
      : `Han pasado <strong>${daysSinceBackup} días</strong> desde tu último respaldo.`;

    slot.innerHTML = `
      <div class="backup-reminder">
        <span class="backup-reminder-icon">💾</span>
        <div class="backup-reminder-body">
          <div class="backup-reminder-title">Respaldo recomendado</div>
          <div class="backup-reminder-msg">${message}</div>
        </div>
        <button class="backup-reminder-btn" id="backup-now-btn">Respaldar</button>
        <button class="backup-dismiss" id="backup-dismiss-btn" aria-label="Descartar">×</button>
      </div>
    `;

    document.getElementById('backup-now-btn').addEventListener('click', () => {
      Storage.exportJSON();
      UI.toast('Datos exportados');
      renderBackupReminder();
    });
    document.getElementById('backup-dismiss-btn').addEventListener('click', () => {
      Storage.get().settings.backupReminderDismissed = Date.now();
      Storage.save();
      renderBackupReminder();
    });
  }

  // ====== WATCHER de cambio de día ======
  let lastSeenDay = UI.todayKey();
  function setupDayRolloverWatcher() {
    // Verificar cada minuto si cambió el día (caso: app abierta del lunes al martes)
    setInterval(() => {
      const now = UI.todayKey();
      if (now !== lastSeenDay) {
        lastSeenDay = now;
        UI.toast('☀️ Buen día — actualizando');
        // Refrescar todo
        renderHeader();
        renderWeekStrip();
        renderWeekLabel();
        Habits.renderOverview(); Habits.renderFull(); Habits.renderHeatmap();
        Tasks.renderToday(); Tasks.renderFull();
        Goals.renderAll(); Goals.renderWeeklyMini();
        refreshKPIs();
        renderBackupReminder();
      }
    }, 60 * 1000);

    // También cuando la app vuelve a foco (típico al abrir desde el home)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        const now = UI.todayKey();
        if (now !== lastSeenDay) {
          lastSeenDay = now;
          renderHeader();
          renderWeekStrip();
          renderWeekLabel();
          Habits.renderOverview(); Habits.renderFull(); Habits.renderHeatmap();
          Tasks.renderToday(); Tasks.renderFull();
          Goals.renderAll(); Goals.renderWeeklyMini();
          refreshKPIs();
          renderBackupReminder();
        }
      }
    });
  }

  // ====== PESTAÑAS DE ENFOQUE ======
  let currentFocusTab = 'hoy';

  function setFocusTab(tab) {
    currentFocusTab = tab;
    document.querySelectorAll('.focus-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.focusTab === tab);
    });
    document.querySelectorAll('.focus-panel').forEach(p => {
      p.classList.toggle('active', p.id === 'focus-panel-' + tab);
    });
    renderFocusTab(tab);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  // Refresca solo el contenido del panel visible
  function renderFocusTab(tab = currentFocusTab) {
    if (tab === 'hoy') {
      countersAnimated = false;
      Tasks.renderToday();
      refreshKPIs();
      renderCloseDay();
      renderWeekClose();
    } else if (tab === 'habitos') {
      Habits.renderOverview();
      refreshKPIs();
    } else if (tab === 'metas') {
      Goals.renderWeeklyMini();
      renderWeekLabel();
    }
  }

  function refreshKPIs() {
    const state = Storage.get();
    const onVacation = Vacation.isActive();
    const habitsToday = onVacation ? [] : state.habits.filter(Habits.isHabitForToday);
    const tasksToday = state.tasks.filter(t => t.date === UI.todayKey());

    // Suma de % por hábito (0..100 cada uno). Para binarios: 0 o 100. Para cuantitativos: proporcional.
    const habitsPctSum = habitsToday.reduce((acc, h) => acc + Habits.getHabitDayPct(h), 0);
    const tasksPctSum = tasksToday.reduce((acc, t) => acc + (t.done ? 100 : 0), 0);

    const total = habitsToday.length + tasksToday.length;
    // Hábitos "completados" para el detalle textual (sigue siendo binario: hechos / no hechos)
    const habitsDone = habitsToday.filter(Habits.isCompletedToday).length;
    const tasksDone = tasksToday.filter(t => t.done).length;
    const done = habitsDone + tasksDone;

    // % del día = promedio de los % de cada ítem
    const pct = total === 0 ? 0 : Math.round((habitsPctSum + tasksPctSum) / total);

    renderGreeting();
    renderFocusCard();

    // Persistir el % del día (alimenta la Tendencia semanal). El strip visual
    // ya no existe: renderWeekStrip solo guarda el snapshot y no pinta.
    renderWeekStrip(pct);

    // Secciones nuevas del panel "Hoy"
    Habits.renderTodayHabits();
    Goals.renderTodayGoals();
    Finance.renderTodayPending();
    Tasks.renderTomorrow();
  }

  // ---------- Saludo y estado del día ----------
  function renderGreeting() {
    const g = document.getElementById('today-greet');
    if (!g) return;
    const h = new Date().getHours();
    const saludo = h < 6 ? 'Buenas noches' : h < 12 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
    const name = (Storage.get().user.name || '').trim();
    g.textContent = name ? `${saludo}, ${name}` : saludo;
  }

  function progressColor(pct) {
    if (pct >= 100) return 'var(--accent-green)';
    if (pct >= 50) return 'var(--accent-yellow)';
    return 'var(--accent-orange)';
  }

  let countersAnimated = false;

  // ---------- Tarjeta de foco ----------
  // El foco de la semana en curso se escribió al cerrar la semana ANTERIOR
  // ("foco de la próxima semana"), así que se busca ahí.
  function currentWeekFocus() {
    const s = Storage.get();
    const curWk = UI.weekKey();
    // Foco escrito directamente desde Hoy para la semana en curso
    if (s.focus && s.focus.week && s.focus.weekKey === curWk) {
      return { text: s.focus.week, editable: true };
    }
    // Si no, el "foco de la próxima semana" del cierre de la semana pasada
    const prevWk = UI.weekKey(new Date(Date.now() - 7 * 86400000));
    const e = (s.weekClosures || {})[prevWk];
    return e && e.focus ? { text: e.focus, wk: prevWk } : null;
  }

  function openFocusEditor() {
    const f = currentWeekFocus();
    const cur = f ? f.text : '';
    UI.openModal({
      title: '🎯 Foco de la semana',
      okText: 'Guardar',
      bodyHTML: `
        <p style="color:var(--text-dim);font-size:13px;margin-bottom:12px;line-height:1.45">Una frase corta que te recuerde qué priorizar esta semana.</p>
        <textarea id="focus-input" rows="2" placeholder="Ej: Proteger la primera hora del día">${escapeHtml(cur)}</textarea>
      `,
      onSave: () => {
        const val = document.getElementById('focus-input').value.trim();
        const st = Storage.get();
        if (!val) { st.focus = { week: '', weekKey: null, updatedAt: Date.now() }; }
        else { st.focus = { week: val, weekKey: UI.weekKey(), updatedAt: Date.now() }; }
        Storage.save();
        renderFocusCard();
        UI.toast(val ? 'Foco actualizado' : 'Foco borrado');
      }
    });
  }

  // Sin foco escrito: rota entre tus propios destacados, estable durante el día
  function pickPastLearning() {
    const cl = Storage.get().closures || {};
    const todayKey = UI.todayKey();
    const items = Object.keys(cl)
      .filter(dk => dk !== todayKey && cl[dk] && cl[dk].learn && cl[dk].learn.trim())
      .sort();
    if (!items.length) return null;
    let hash = 0;
    for (const ch of todayKey) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    const dk = items[hash % items.length];
    return { text: cl[dk].learn, dk };
  }

  function renderFocusCard() {
    const c = document.getElementById('focus-card-slot');
    if (!isLive(c)) return;

    const f = currentWeekFocus();
    if (f) {
      c.innerHTML = `
        <div class="focus-card" data-editable="1">
          <div class="focus-card-label">Esta semana</div>
          <div class="focus-card-text">${escapeHtml(f.text)}</div>
        </div>`;
      // Tocar la tarjeta abre los avances de la semana (foco editable dentro)
      c.querySelector('.focus-card').addEventListener('click', () => openWeekCloseModal(UI.weekKey()));
      return;
    }

    const p = pickPastLearning();
    if (p) {
      const label = new Date(p.dk + 'T12:00:00')
        .toLocaleDateString('es-CL', { day: 'numeric', month: 'long' });
      c.innerHTML = `
        <div class="focus-card past" data-focus-day="${p.dk}">
          <div class="focus-card-label">Lo anotaste el ${label}</div>
          <div class="focus-card-text">${escapeHtml(p.text)}</div>
        </div>`;
      c.querySelector('.focus-card').addEventListener('click', () => openDaySummary(p.dk));
      return;
    }

    // Sin foco ni destacados: invitación discreta a definir uno
    c.innerHTML = `
      <button class="focus-card focus-card-empty">
        <span class="focus-card-empty-icon">🎯</span>
        <span>Define tu foco de la semana</span>
      </button>`;
    c.querySelector('.focus-card').addEventListener('click', openFocusEditor);
  }


  // ====== HELPERS DE SEMANA ======
  // Devuelve { start, end } (YYYY-MM-DD) del lunes y domingo de una weekKey ISO
  function weekRange(wk) {
    const m = String(wk).match(/^(\d{4})-W(\d{2})$/);
    if (!m) return null;
    const year = +m[1], week = +m[2];
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const jan4Day = jan4.getUTCDay() || 7;
    const monday = new Date(jan4);
    monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1) + (week - 1) * 7);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setUTCDate(monday.getUTCDate() + i);
      days.push(d.toISOString().slice(0, 10));
    }
    return { start: days[0], end: days[6], days };
  }

  function weekLabelFor(wk) {
    const r = weekRange(wk);
    if (!r) return wk;
    const fmt = k => new Date(k + 'T12:00:00').toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
    return `${fmt(r.start)} – ${fmt(r.end)}`;
  }

  // Estadísticas agregadas de una semana (para el cierre semanal)
  function weekStats(wk) {
    const state = Storage.get();
    const r = weekRange(wk);
    const todayKey = UI.todayKey();
    if (!r) return null;

    // Solo días ya transcurridos
    const past = r.days.filter(d => d <= todayKey);

    // Promedio del anillo diario
    const snaps = past.map(d => state.dailySnapshots[d]).filter(v => typeof v === 'number');
    const ringAvg = snaps.length ? Math.round(snaps.reduce((a, b) => a + b, 0) / snaps.length) : 0;

    // Hábitos: promedio de cumplimiento sobre días programados
    let hSum = 0, hCount = 0;
    state.habits.forEach(h => {
      const born = h.createdAt ? UI.localDateKey(new Date(h.createdAt)) : null;
      past.forEach(dk => {
        if (born && dk < born) return;
        if (Vacation.isDateInVacation(dk)) return;
        if (!Habits.isHabitForDate(h, new Date(dk + 'T12:00:00'))) return;
        hSum += Habits.getHabitDayPct(h, dk);
        hCount++;
      });
    });
    const habitsPct = hCount ? Math.round(hSum / hCount) : 0;

    // Tareas de la semana
    const tasks = state.tasks.filter(t => t.date >= r.start && t.date <= r.end);
    const tasksDone = tasks.filter(t => t.done).length;

    // Metas semanales de esa semana (activas y archivadas)
    const goals = state.goals
      .filter(g => g.horizon === 'week' && UI.weekKey(new Date(g.createdAt)) === wk)
      .map(g => ({
        name: g.name,
        done: !!g.done,
        pct: g.done ? 100 : (g.target ? Math.min(100, Math.round(((g.current || 0) / g.target) * 100)) : 0),
        detail: g.target ? `${g.current || 0}/${g.target} ${g.unit || ''}`.trim() : '',
      }))
      .sort((a, b) => (a.done === b.done) ? b.pct - a.pct : (a.done ? -1 : 1));

    return {
      ringAvg, habitsPct,
      tasksDone, tasksTotal: tasks.length,
      goals, goalsDone: goals.filter(g => g.done).length,
    };
  }

  // ====== CIERRE DE SEMANA ======
  // Devuelve la weekKey que corresponde cerrar, o null si no toca
  function weekCloseTarget() {
    const s = Storage.get();
    const day = new Date().getDay(); // 0 = domingo, 1 = lunes
    const pending = s.settings.pendingWeekClose;

    // Semana pendiente sin cerrar → se ofrece hasta el domingo siguiente.
    // Después caduca (se olvida el pendiente); sigue en el historial.
    if (pending && !s.weekClosures[pending]) {
      const nextSunday = weekEndDateKey(shiftWeek(pending, 1));
      if (UI.todayKey() <= nextSunday) return pending;
      s.settings.pendingWeekClose = null;
      Storage.save();
    }

    // Domingo o lunes: se puede cerrar la semana que corresponde.
    // Lunes cierra la semana que recién terminó (por si te atrasas un día).
    if (day === 0) return UI.weekKey();
    if (day === 1) return shiftWeek(UI.weekKey(), -1);

    // Cualquier otro día: solo si ya la cerraste, para poder editarla.
    const cur = UI.weekKey();
    if (s.weekClosures[cur]) return cur;
    return null;
  }

  // Desplaza una weekKey n semanas
  function shiftWeek(wk, n) {
    const r = weekRange(wk);
    if (!r) return wk;
    const d = new Date(r.start + 'T12:00:00');
    d.setDate(d.getDate() + n * 7);
    return UI.weekKey(d);
  }

  // Domingo (fin) de una weekKey, en YYYY-MM-DD
  function weekEndDateKey(wk) {
    const r = weekRange(wk);
    return r ? r.end : wk;
  }

  function renderWeekClose() {
    const btn = document.getElementById('week-close-btn');
    if (!btn) return;
    const wk = weekCloseTarget();
    if (!wk) { btn.hidden = true; return; }
    const s = Storage.get();
    const closed = !!s.weekClosures[wk];
    const isPast = wk !== UI.weekKey();
    btn.hidden = false;
    btn.dataset.week = wk;
    btn.textContent = closed
      ? `✓ Semana cerrada · editar`
      : (isPast ? `📅 Cerrar la semana pasada` : `📅 Cerrar la semana`);
    btn.classList.toggle('is-closed', closed);
  }

  // Modal de la semana. Si wk es la semana en curso → "Avances de la semana"
  // (revisión + foco editable). Si es una semana terminada → cierre completo.
  function openWeekCloseModal(wk) {
    const s = Storage.get();
    const e = s.weekClosures[wk] || {};
    const st = weekStats(wk);
    if (!st) return;
    const isCurrent = wk === UI.weekKey();

    const goalsHTML = st.goals.length === 0
      ? '<div class="wc-empty">No definiste metas esta semana</div>'
      : st.goals.map(g => `
          <div class="wc-goal ${g.done ? 'done' : ''}">
            <div class="wc-goal-top">
              <span class="wc-goal-name">${g.done ? '✓ ' : ''}${escapeHtml(g.name)}</span>
              <span class="wc-goal-pct">${g.detail || g.pct + '%'}</span>
            </div>
            <div class="wc-goal-bar"><div class="wc-goal-fill" style="width:${g.pct}%"></div></div>
          </div>`).join('');

    const statsHTML = `
      <div class="wc-stats">
        <div class="wc-stat"><span class="wc-stat-val">${st.ringAvg}%</span><span class="wc-stat-lbl">Promedio</span></div>
        <div class="wc-stat"><span class="wc-stat-val">${st.habitsPct}%</span><span class="wc-stat-lbl">Hábitos</span></div>
        <div class="wc-stat"><span class="wc-stat-val">${st.tasksDone}/${st.tasksTotal}</span><span class="wc-stat-lbl">Tareas</span></div>
        <div class="wc-stat"><span class="wc-stat-val">${st.goalsDone}/${st.goals.length}</span><span class="wc-stat-lbl">Metas</span></div>
      </div>`;

    if (isCurrent) {
      // Semana en curso: avances + solo el foco editable
      const curFocus = currentWeekFocus();
      UI.openModal({
        title: '📊 Avances de la semana',
        okText: 'Guardar foco',
        cancelText: 'Cerrar',
        bodyHTML: `
          <div class="wc-period">${weekLabelFor(wk)} · en curso</div>
          ${statsHTML}
          <div class="wc-section-title">Tus metas semanales</div>
          ${goalsHTML}
          <label>🎯 Foco de la semana</label>
          <textarea id="wc-focus-only" rows="2" placeholder="Ej: Proteger la primera hora del día">${escapeHtml(curFocus ? curFocus.text : '')}</textarea>
        `,
        onSave: () => {
          const val = document.getElementById('wc-focus-only').value.trim();
          const st2 = Storage.get();
          st2.focus = val
            ? { week: val, weekKey: UI.weekKey(), updatedAt: Date.now() }
            : { week: '', weekKey: null, updatedAt: Date.now() };
          Storage.save();
          renderFocusCard();
          UI.toast(val ? 'Foco actualizado' : 'Foco borrado');
        }
      });
      return;
    }

    // Semana terminada: cierre completo
    UI.openModal({
      title: '📅 Cierre de semana',
      okText: 'Guardar cierre',
      bodyHTML: `
        <div class="wc-period">${weekLabelFor(wk)}</div>
        ${statsHTML}
        <div class="wc-section-title">Tus metas semanales</div>
        ${goalsHTML}
        <label>¿Qué funcionó bien?</label>
        <textarea id="wc-worked" rows="2">${escapeHtml(e.worked)}</textarea>
        <label>¿Qué te frenó?</label>
        <textarea id="wc-blocked" rows="2">${escapeHtml(e.blocked)}</textarea>
        <label>Foco de la próxima semana</label>
        <textarea id="wc-focus" rows="2">${escapeHtml(e.focus)}</textarea>
      `,
      onSave: () => {
        const st2 = Storage.get();
        st2.weekClosures[wk] = {
          worked:  document.getElementById('wc-worked').value.trim(),
          blocked: document.getElementById('wc-blocked').value.trim(),
          focus:   document.getElementById('wc-focus').value.trim(),
          savedAt: Date.now(),
        };
        if (st2.settings.pendingWeekClose === wk) st2.settings.pendingWeekClose = null;
        Storage.save();
        renderWeekClose();
        UI.toast('Semana cerrada · buen inicio');
      }
    });
  }

  // ====== CIERRE DEL DÍA ======
  function renderCloseDay() {
    const btn = document.getElementById('close-day-btn');
    if (!btn) return;
    const closed = !!Storage.get().closures[UI.todayKey()];
    btn.textContent = closed ? '✓ Día cerrado · editar' : '🌙 Cerrar el día';
    btn.classList.toggle('is-closed', closed);
  }

  // Cierre del día. Sin argumento = hoy. Con dateKey = editar un día pasado
  // (mismo formulario, precargado). No permite guardar completamente vacío.
  // Día que se cierra por defecto. Con "corte de madrugada": si son antes de
  // las 5 AM, se asume que sigues cerrando el día anterior (el que viviste).
  function closingDayKey() {
    const n = new Date();
    if (n.getHours() < 5) n.setDate(n.getDate() - 1);
    return UI.localDateKey(n);
  }

  function openCloseDayModal(dateKey) {
    const today = UI.todayKey();
    const isClosingCurrent = !dateKey;              // cierre en curso (no edición desde historial)
    const key = dateKey || closingDayKey();          // día propuesto (ajustable si es cierre en curso)
    const isToday = key === today;                   // controla si mostrar el resumen automático
    const hasClosure = !!(Storage.get().closures || {})[key];
    const state = Storage.get();
    const e = state.closures[key] || {};

    // Resumen automático (solo para hoy; en días pasados no aplica)
    let summaryHTML = '';
    if (isToday) {
      const onVacation = Vacation.isActive();
      const habitsToday = onVacation ? [] : state.habits.filter(Habits.isHabitForToday);
      const habitsDone = habitsToday.filter(Habits.isCompletedToday).length;
      const tasksToday = state.tasks.filter(t => t.date === today);
      const tasksDone = tasksToday.filter(t => t.done).length;
      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      const closedToday = state.goals.filter(g => g.done && g.doneAt && g.doneAt >= startOfDay.getTime());
      const goalsLine = closedToday.length
        ? `<div class="cd-goals">🎯 Cerraste: ${closedToday.map(g => escapeHtml(g.name)).join(' · ')}</div>`
        : '';
      const stat = (icon, label, done, total, vac) => `
        <div class="cd-stat">
          <span class="cd-stat-val">${vac ? '🏖️' : (total === 0 ? '—' : done + '/' + total)}</span>
          <span class="cd-stat-lbl">${icon} ${label}</span>
        </div>`;
      summaryHTML = `
        <div class="cd-summary">
          <div class="cd-stats">
            ${stat('✨', 'Hábitos', habitsDone, habitsToday.length, onVacation)}
            ${stat('✅', 'Tareas', tasksDone, tasksToday.length, false)}
          </div>
          ${goalsLine}
        </div>`;
    }

    // Selector de 1 a 5 (energía / estrés)
    const scale = (id, current) => {
      const v = current || 0;
      const btns = [1, 2, 3, 4, 5].map(n =>
        `<button type="button" class="cd-pick ${n === v ? 'sel' : ''}" data-scale="${id}" data-val="${n}">${n}</button>`
      ).join('');
      return `<div class="cd-scale" id="cd-${id}" data-value="${v}">${btns}</div>`;
    };

    // Selector de rangos de sueño → guarda un valor representativo en horas
    const SLEEP_OPTS = [
      { lbl: '<5h', val: 4.5 }, { lbl: '5–6', val: 5.5 }, { lbl: '6–7', val: 6.5 },
      { lbl: '7–8', val: 7.5 }, { lbl: '8+', val: 8.5 },
    ];
    const sleepSel = (() => {
      const cur = typeof e.sleep === 'number' ? e.sleep : null;
      const match = cur === null ? -1 : SLEEP_OPTS.reduce((best, o, i) =>
        Math.abs(o.val - cur) < Math.abs(SLEEP_OPTS[best].val - cur) ? i : best, 0);
      const btns = SLEEP_OPTS.map((o, i) =>
        `<button type="button" class="cd-pick ${i === match ? 'sel' : ''}" data-scale="sleep" data-val="${o.val}">${o.lbl}</button>`
      ).join('');
      return `<div class="cd-scale" id="cd-sleep" data-value="${cur === null ? '' : SLEEP_OPTS[match].val}">${btns}</div>`;
    })();

    // Cierre en curso: selector de fecha (con corte de madrugada ya aplicado).
    // Edición desde historial: solo muestra qué día se edita.
    const dateBlock = isClosingCurrent
      ? `<label>Estás cerrando el día</label>
         <input type="date" id="cd-date" value="${key}" max="${today}" />`
      : `<div class="cd-editing-label">Editando ${new Date(key + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}</div>`;

    // Botón para eliminar un cierre ya guardado (disponible al editarlo)
    const deleteBlock = (hasClosure && !isClosingCurrent)
      ? `<button type="button" class="cd-delete-btn" id="cd-delete">🗑️ Eliminar este cierre</button>`
      : '';

    UI.openModal({
      title: isClosingCurrent ? '✨ Cierre del día' : '✏️ Editar cierre',
      okText: isClosingCurrent ? 'Cerrar el día' : 'Guardar',
      bodyHTML: `
        ${summaryHTML}
        ${dateBlock}
        <label>3 cosas por las que estás agradecido</label>
        <input type="text" id="cd-g1" placeholder="1." value="${escapeAttr(e.gratitude?.[0])}" />
        <input type="text" id="cd-g2" placeholder="2." value="${escapeAttr(e.gratitude?.[1])}" style="margin-top:6px" />
        <input type="text" id="cd-g3" placeholder="3." value="${escapeAttr(e.gratitude?.[2])}" style="margin-top:6px" />
        <label>¿Qué destacas o aprendiste hoy?</label>
        <textarea id="cd-learn" rows="3">${escapeHtml(e.learn)}</textarea>
        <label>Energía</label>
        ${scale('energy', e.energy)}
        <label>Estrés</label>
        ${scale('stress', e.stress)}
        <label>Horas dormidas anoche</label>
        ${sleepSel}
        ${deleteBlock}
      `,
      onSave: () => {
        const g = [
          document.getElementById('cd-g1').value.trim(),
          document.getElementById('cd-g2').value.trim(),
          document.getElementById('cd-g3').value.trim(),
        ].filter(Boolean);
        const learn = document.getElementById('cd-learn').value.trim();
        const energy = +document.getElementById('cd-energy').dataset.value || 0;
        const stress = +document.getElementById('cd-stress').dataset.value || 0;
        const sleepRaw = document.getElementById('cd-sleep').dataset.value;
        const sleep = sleepRaw === '' ? null : +sleepRaw;

        // No guardar un cierre completamente vacío
        const isEmpty = g.length === 0 && !learn && !energy && !stress && sleep === null;
        if (isEmpty) {
          UI.toast('Escribe o marca algo antes de guardar');
          return false;
        }

        const rec = { gratitude: g, learn, savedAt: Date.now() };
        if (energy) rec.energy = energy;
        if (stress) rec.stress = stress;
        if (sleep !== null) rec.sleep = sleep;

        // La fecha efectiva del cierre: la del selector (si el usuario la ajustó)
        // o el día propuesto (con corte de madrugada).
        const dateInput = document.getElementById('cd-date');
        const saveKey = (dateInput && dateInput.value) ? dateInput.value : key;

        Storage.get().closures[saveKey] = rec;
        Storage.save();
        renderCloseDay();
        if (typeof Stats !== 'undefined') Stats.render();
        if (saveKey === today) renderFocusCard();
        refreshKPIs();
        UI.toast(isClosingCurrent ? 'Día cerrado · buen descanso' : 'Cierre actualizado');
      }
    });

    // Enlazar los selectores 1-5 / rangos
    setTimeout(() => {
      document.querySelectorAll('.cd-scale').forEach(scaleEl => {
        scaleEl.querySelectorAll('.cd-pick').forEach(btn => {
          btn.addEventListener('click', () => {
            UI.buzz(6);
            scaleEl.querySelectorAll('.cd-pick').forEach(b => b.classList.remove('sel'));
            btn.classList.add('sel');
            scaleEl.dataset.value = btn.dataset.val;
          });
        });
      });

      // Eliminar el cierre (con confirmación)
      const delBtn = document.getElementById('cd-delete');
      if (delBtn) {
        delBtn.addEventListener('click', () => {
          UI.confirm2({
            title: 'Eliminar cierre',
            message: '¿Seguro que quieres eliminar este cierre? No se puede deshacer.',
            okText: 'Eliminar',
            danger: true,
            onConfirm: () => {
              const st = Storage.get();
              if (st.closures) delete st.closures[key];
              Storage.save();
              renderCloseDay();
              if (typeof Stats !== 'undefined') Stats.render();
              refreshKPIs();
              UI.toast('Cierre eliminado');
            }
          });
        });
      }
    }, 40);
  }


  function bindAll() {
    // Helper para bindear toggles de acordeón sub-section
    function bindAccordion(toggleId, contentId) {
      const toggle = document.getElementById(toggleId);
      if (!toggle) return;
      const content = document.getElementById(contentId);
      const arrow = toggle.querySelector('.sub-section-toggle-arrow');
      toggle.addEventListener('click', () => {
        const expanded = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', !expanded);
        if (expanded) {
          content.setAttribute('hidden', '');
          if (arrow) arrow.textContent = '▶';
        } else {
          content.removeAttribute('hidden');
          if (arrow) arrow.textContent = '▼';
        }
      });
    }

    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        const parent = tab.closest('.view');
        parent.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        parent.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        parent.querySelector('#' + target).classList.add('active');
      });
    });

    // Sub-tabs de horizonte dentro del tab de Metas
    document.querySelectorAll('[data-horizon-tab]').forEach(chip => {
      chip.addEventListener('click', () => {
        const horizon = chip.dataset.horizonTab;
        document.querySelectorAll('[data-horizon-tab]').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        document.querySelectorAll('[data-horizon-content]').forEach(c => {
          c.classList.toggle('active', c.dataset.horizonContent === horizon);
        });
        // Render archivo histórico al seleccionar ese tab
        if (horizon === 'archive' && typeof GoalArchive !== 'undefined') {
          GoalArchive.render();
        }
      });
    });

    document.querySelectorAll('.task-filter .chip').forEach(chip => {
      chip.addEventListener('click', () => Tasks.setFilter(chip.dataset.filter));
    });

    // Botones + en vistas de gestión
    const habAdd = document.getElementById('habits-manage-add');
    if (habAdd) habAdd.addEventListener('click', () => Habits.openCreateModal());
    const tskAdd = document.getElementById('tasks-manage-add');
    if (tskAdd) tskAdd.addEventListener('click', () => Tasks.openCreateModal());
    const goalAdd = document.getElementById('goals-manage-add');
    if (goalAdd) goalAdd.addEventListener('click', () => Goals.openCreateModal());
    const adjBtn = document.getElementById('balance-adjust-btn');
    if (adjBtn) adjBtn.addEventListener('click', () => Finance.openAdjustBalanceModal());
    const finAdd = document.getElementById('finance-add-btn');
    if (finAdd) finAdd.addEventListener('click', () => Finance.openMovementModal());
    const finSetAdd = document.getElementById('finance-settings-add');
    if (finSetAdd) finSetAdd.addEventListener('click', () => Finance.openMovementModal());

    // Contadores del día → llevan a la pestaña / sección correspondiente
    const counters = document.getElementById('day-counters');
    if (counters) {
      counters.addEventListener('click', e => {
        const b = e.target.closest('[data-counter]');
        if (!b) return;
        if (b.dataset.counter === 'habitos') {
          setFocusTab('habitos');
        } else {
          const card = document.getElementById('today-tasks');
          if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    }

    // Cierre del día
    const closeDay = document.getElementById('close-day-btn');
    if (closeDay) closeDay.addEventListener('click', () => openCloseDayModal());

    const weekClose = document.getElementById('week-close-btn');
    if (weekClose) weekClose.addEventListener('click', () => {
      const wk = weekClose.dataset.week;
      if (wk) openWeekCloseModal(wk);
    });

    // Ícono de Calendario del header de Hoy → abre el sheet de calendario
    const openCal = document.getElementById('open-calendar-sheet');
    if (openCal) openCal.addEventListener('click', () => {
      UI.buzz(8);
      openCalendarSheet();
    });

    // Cerrar cualquier sheet
    document.querySelectorAll('[data-close-sheet]').forEach(b => {
      b.addEventListener('click', () => {
        const s = b.closest('.sheet');
        if (s) s.hidden = true;
      });
    });

    // Navegación de meses del calendario
    const calPrev = document.getElementById('cal-prev');
    if (calPrev) calPrev.addEventListener('click', () => calNav(-1));
    const calNext = document.getElementById('cal-next');
    if (calNext) calNext.addEventListener('click', () => calNav(1));

    // (Compatibilidad) Pestañas principales de Enfoque, si existieran
    document.querySelectorAll('.focus-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        UI.buzz(8);
        setFocusTab(tab.dataset.focusTab);
      });
    });

    // Pestañas internas del recuadro Metas en Hoy
    document.querySelectorAll('.goals-inner-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        Goals.setInnerHorizon(tab.dataset.innerHorizon);
      });
    });

    // Click en meta del recuadro de Hoy → modal de registrar avance
    const goalsUnified = document.getElementById('goals-unified-list');
    if (goalsUnified) {
      goalsUnified.addEventListener('click', e => {
        const item = e.target.closest('[data-goal-quick]');
        if (item) Goals.openQuickProgressModal(item.dataset.goalQuick);
      });
    }

    // Archivo de metas: editar una meta archivada al tocarla.
    // (El toggle de meses colapsables se liga dentro de GoalArchive.render)
    const archiveList = document.getElementById('goal-archive-list');
    if (archiveList) {
      archiveList.addEventListener('click', e => {
        const editBtn = e.target.closest('[data-edit-archived]');
        if (editBtn) GoalArchive.openEditModal(editBtn.dataset.editArchived);
      });
    }

    const nameInput = document.getElementById('user-name');
    nameInput.value = Storage.get().user.name || '';
    nameInput.addEventListener('change', () => {
      Storage.get().user.name = nameInput.value.trim();
      Storage.save();
      renderHeader();
      UI.toast('Nombre guardado');
    });

    document.querySelectorAll('.theme-row [data-theme]').forEach(b => {
      b.addEventListener('click', () => {
        Storage.get().settings.theme = b.dataset.theme;
        Storage.save();
        applyTheme();
      });
    });

    document.getElementById('open-templates-btn').addEventListener('click', () => {
      Onboarding.openFromSettings();
    });

    // Vacaciones
    document.getElementById('vacation-btn').addEventListener('click', () => {
      Vacation.openModal();
    });

    // Detalle de hábito: botones de back y edit
    document.getElementById('habit-detail-back').addEventListener('click', () => {
      UI.goBack('today');
    });
    document.getElementById('habit-detail-edit').addEventListener('click', () => {
      // Buscar el id del hábito en detalle: lo guardamos en el módulo Habits
      // Como no tenemos getter, navegamos a habits y abrimos modal de edición
      // a través de un atributo data del contenedor
      const c = document.getElementById('habit-detail-content');
      const h = c.querySelector('[data-id]');
      // Más simple: trigger via Habits con id en una variable expuesta
      Habits.openEditFromDetail();
    });

    document.getElementById('export-btn').addEventListener('click', () => {
      Storage.exportJSON();
      UI.toast('Datos exportados');
      renderBackupReminder();
    });
    document.getElementById('import-btn').addEventListener('click', () => {
      document.getElementById('import-file').click();
    });
    document.getElementById('import-file').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      UI.confirm2({
        title: '⚠️ Confirmar importación',
        message: 'Importar este archivo <strong>reemplazará todos los datos actuales</strong>. Esta acción no se puede deshacer.',
        okText: 'Sí, importar',
        danger: true,
        onConfirm: async () => {
          try {
            await Storage.importJSON(f);
            UI.toast('Datos importados');
            setTimeout(() => location.reload(), 700);
          } catch (err) {
            UI.toast('Error al importar');
            console.error(err);
          }
        }
      });
      // Limpiar input para que se pueda volver a importar el mismo archivo
      e.target.value = '';
    });

    document.getElementById('reset-btn').addEventListener('click', () => {
      UI.confirm2({
        title: '⚠️ Borrar todos mis datos',
        message: 'Esta acción <strong>borrará permanentemente</strong> todos tus hábitos, tareas, metas, ánimo, cierres del día y configuración.<br><br>Si quieres conservar tus datos, exporta el JSON primero.<br><br><strong style="color:var(--accent-red)">No se puede deshacer.</strong>',
        okText: 'Sí, borrar todo',
        cancelText: 'Cancelar',
        danger: true,
        onConfirm: () => {
          // Cerrar el modal antes de hacer el reset
          UI.closeModal();
          // Pequeño delay para que se cierre el modal antes del reset
          setTimeout(() => {
            try {
              Storage.reset();
              // Forzar limpieza directa del localStorage por si acaso
              try { localStorage.removeItem('mi_dashboard_v1'); } catch (e) {}
              location.reload();
            } catch (err) {
              console.error('Error al borrar:', err);
              UI.toast('Error al borrar datos');
            }
          }, 200);
        }
      });
    });
  }

  return { init, refreshKPIs, refreshAll, setFocusTab, renderFocusTab, weekRange, weekLabelFor, weekStats, openWeekCloseModal, openDayCloseModal: openCloseDayModal };
})();

document.addEventListener('DOMContentLoaded', App.init);
