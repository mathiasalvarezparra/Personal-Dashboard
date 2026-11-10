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
