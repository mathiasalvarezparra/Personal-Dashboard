/* ============================================
   STORAGE
   ============================================ */
const Storage = (() => {
  const KEY = 'mi_dashboard_v1';
  // v2: frecuencia 'weekly' (X veces por semana) → 'days' + weeklyMin (ver migrate)
  const VERSION = 2;
  const defaultState = {
    version: VERSION,
    user: { name: '' },
    settings: {
      theme: 'dark',
      lastBackup: null,
      backupReminderDismissed: null,
      onboarded: false,
      lastWeekKey: null,
      vacation: null, // { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' } o null
      // Plan de Finanzas (Movimientos › Plan)
      monthlyBudget: null,      // tope de gasto mensual en CLP (sin Ahorro) o null
      categoryBudgets: {},      // { categoryId: CLP } límite mensual por categoría
      monthlySavingsGoal: null, // meta de ahorro mensual en CLP o null
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
    // Legado (ya no se muestra ni se escribe; se conserva en el JSON): foco de la semana
    focus: { week: '', updatedAt: null },
    closures: {},
    // Legado: respuestas del antiguo cierre de semana { 'YYYY-Www': { worked, blocked, focus, savedAt } }.
    // Ya no se muestran ni se escriben (el cierre semanal es solo el resumen de WeekSummary).
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

  // Migraciones por versión. Se aplican al cargar y al importar un respaldo.
  function migrate(data) {
    const v = data.version || 1;
    if (v < 2) {
      // Hábitos "X veces por semana" → días en que aparece (los sugeridos o, si no
      // había, los 7) + mínimo semanal para la racha (= veces por semana, sin superar
      // los días). Historial, notas, contributions y vínculos no se tocan.
      (data.habits || []).forEach(h => {
        const f = h.frequency;
        if (!f || f.type !== 'weekly') return;
        const sug = Array.isArray(f.suggestedDays) ? f.suggestedDays.map(Number).filter(d => d >= 0 && d <= 6) : [];
        const days = [1, 2, 3, 4, 5, 6, 0].filter(d => !sug.length || sug.includes(d));
        const times = Math.max(1, parseInt(f.timesPerWeek, 10) || 1);
        h.frequency = { type: 'days', days, weeklyMin: Math.min(times, days.length) };
      });
    }
    data.version = Math.max(v, VERSION);
    return data;
  }

  // Estado completo a partir de lo guardado (o de un respaldo): defaults + migraciones
  function hydrate(parsed) {
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
    return migrate(merged);
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return structuredClone(defaultState);
      return hydrate(JSON.parse(raw));
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
          state = hydrate(data);
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
