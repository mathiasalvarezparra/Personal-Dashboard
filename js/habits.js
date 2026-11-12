/* ============================================
   HABITS
   ============================================ */
const Habits = (() => {
  const TIME_LABELS = { 'mañana': '◐ MAÑANA', 'tarde': '◑ TARDE', 'noche': '◓ NOCHE' };
  const DAY_NAMES = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  // Grupos de "Hoy" por momento del día (timeOfDay); sin timeOfDay → 'any'
  const MOMENTS = ['mañana', 'tarde', 'noche'];
  const MOMENT_LABELS = { 'mañana': 'Mañana', 'tarde': 'Tarde', 'noche': 'Noche', any: 'Cualquier momento' };

  // ====== FRECUENCIA: días en que aparece + mínimo semanal opcional para la racha ======
  // frequency = { type: 'daily' } | { type: 'days', days: [0-6] }, ambos con weeklyMin opcional.
  // El mínimo SOLO flexibiliza la racha (semanas con ≥ weeklyMin días cumplidos);
  // el % del día y Enfoque siguen los días en que aparece.
  const ALL_DAYS = [1, 2, 3, 4, 5, 6, 0];
  function appearDays(h) {
    const f = h.frequency || { type: 'daily' };
    if (f.type === 'days' && Array.isArray(f.days)) return ALL_DAYS.filter(d => f.days.includes(d));
    return ALL_DAYS.slice();
  }
  // Mínimo semanal válido (1..días en que aparece) o null = racha diaria estricta
  function weeklyMinOf(h) {
    const n = parseInt(h.frequency && h.frequency.weeklyMin, 10);
    if (!Number.isInteger(n) || n < 1) return null;
    return Math.min(n, appearDays(h).length);
  }
  const hasWeeklyMin = h => weeklyMinOf(h) != null;

  // Lunes (12:00 para evitar saltos de horario) de la semana de `date`
  function mondayOf(date) {
    const d = new Date(date);
    d.setHours(12, 0, 0, 0);
    const dow = d.getDay();
    d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
    return d;
  }
  // Las 7 fechas (YYYY-MM-DD) de la semana de `date`, de lunes a domingo
  function weekKeys(date) {
    const m = mondayOf(date);
    return Array.from({ length: 7 }, (_, i) => {
      const x = new Date(m);
      x.setDate(m.getDate() + i);
      return UI.localDateKey(x);
    });
  }

  // Estado de la semana de `ref` para un hábito con mínimo semanal.
  //  done      = días cumplidos de la semana (history)
  //  min       = mínimo efectivo: se reduce en proporción a los días disponibles
  //              (sin vacaciones, archivo ni días previos a la creación), ⌊⌋ y ≥ 1;
  //              0 si no hay días disponibles (la semana no rompe ni suma)
  //  remaining = días en que aparece que quedan (incluido hoy si aún no se cumple)
  //  state     = 'met' | 'ok' | 'risk' (apenas alcanza) | 'unreachable' | 'none'
  function weekMinInfo(h, ref = new Date()) {
    const base = weeklyMinOf(h);
    if (base == null) return null;
    const set = new Set(h.history || []);
    const todayKey = UI.todayKey();
    const bornKey = h.createdAt ? UI.localDateKey(new Date(h.createdAt)) : null;
    const show = appearDays(h);
    let scheduled = 0, available = 0, done = 0, remaining = 0;
    const days = weekKeys(ref).map(k => {
      const dow = new Date(k + 'T12:00:00').getDay();
      const appears = show.includes(dow);
      const isDone = set.has(k);
      const blocked = appears && !isDone && (
        (typeof Vacation !== 'undefined' && Vacation.isDateInVacation(k)) ||
        archivedOn(h, k) || (bornKey && k < bornKey));
      if (appears) scheduled++;
      if (appears && !blocked) available++;
      if (isDone) done++;
      if (appears && !blocked && !isDone && k >= todayKey) remaining++;
      return { key: k, dow, appears, done: isDone, blocked };
    });
    const min = available === 0 ? 0
      : (available >= scheduled ? base : Math.max(1, Math.floor(base * available / scheduled)));
    const missing = Math.max(0, min - done);
    let state = 'ok';
    if (min === 0) state = 'none';
    else if (done >= min) state = 'met';
    else if (missing > remaining) state = 'unreachable';
    else if (missing === remaining) state = 'risk';
    return { base, min, done, missing, remaining, state, days };
  }

  // ====== ARCHIVO ======
  // Un hábito archivado no aparece en Hoy ni cuenta en KPIs/estadísticas.
  // Los días en que estuvo archivado se tratan como "no aplica" (no rompen rachas),
  // salvo que ese día haya quedado registrado antes de archivar.
  function archivedOn(h, dk) {
    if (!h.archived && !(h.archivedRanges && h.archivedRanges.length)) return false;
    if (h.archived && h.archivedAt && dk >= UI.localDateKey(new Date(h.archivedAt))) return true;
    return (h.archivedRanges || []).some(r => dk >= r.from && dk <= r.to);
  }
  function activeHabits() { return Storage.get().habits.filter(h => !h.archived); }

  // ¿Cuenta este hábito en el % del día `date`? (KPIs, resumen del día, semana)
  // Siempre según los días en que aparece; el mínimo semanal no lo flexibiliza.
  function countsForDate(h, date) {
    if (h.archived) return false;
    return isHabitForDate(h, date);
  }

  // Mover un hábito dentro de su grupo de timeOfDay (entre hábitos activos)
  // direction: -1 = arriba, +1 = abajo
  function moveHabit(id, direction) {
    const state = Storage.get();
    const habits = state.habits;
    const pos = habits.findIndex(h => h.id === id);
    if (pos === -1) return;
    let newPos = pos + direction;
    while (newPos >= 0 && newPos < habits.length && habits[newPos].archived) newPos += direction;
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
    const habits = Storage.get().habits.filter(h => !h.archived);
    const pos = habits.findIndex(h => h.id === id);
    if (pos === -1) return false;
    if (direction === -1) return pos > 0;
    if (direction === 1) return pos < habits.length - 1;
    return false;
  }

  // Hoy: ¿entra en el % del día? (ver countsForDate)
  function isHabitForToday(h) {
    return countsForDate(h, new Date());
  }

  // ¿Aparece / se puede registrar el hábito ese día? (días elegidos, sin días archivados)
  function isHabitForDate(h, date) {
    if (h.archived || h.archivedRanges) {
      const dk = UI.localDateKey(date);
      if (archivedOn(h, dk) && !(h.history || []).includes(dk)) return false;
    }
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
    const minBefore = weekMinInfo(h);

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
      if (!celebrateIfMinReached(h, dateKey, minBefore)) UI.toast(`✓ ${h.name} completado`);
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

  // Con mínimo semanal: veredicto de una semana para la racha.
  //  'met'  → cumplida (suma) · 'miss' → no cumplida (rompe) · 'skip' → ni suma ni rompe
  // No rompen ni suman: semanas sin días disponibles (vacaciones/archivo), la semana
  // en curso mientras el mínimo siga alcanzable y la semana de creación incompleta.
  function weekVerdict(h, monday, isCurrent) {
    const info = weekMinInfo(h, monday);
    if (info.state === 'none') return 'skip';
    if (info.state === 'met') return 'met';
    if (isCurrent && info.state !== 'unreachable') return 'skip';
    const keys = weekKeys(monday);
    const bornKey = h.createdAt ? UI.localDateKey(new Date(h.createdAt)) : null;
    if (bornKey && keys[0] < bornKey && keys[6] >= bornKey) return 'skip';
    return 'miss';
  }

  // Racha en semanas consecutivas con el mínimo cumplido (se muestra como "N semanas")
  function weeklyStreak(h) {
    if (!h.history || h.history.length === 0) return 0;
    const bornKey = h.createdAt ? UI.localDateKey(new Date(h.createdAt)) : null;
    const base = mondayOf(new Date());
    let streak = 0;
    for (let w = 0; w < 260; w++) {
      const m = new Date(base);
      m.setDate(base.getDate() - 7 * w);
      if (bornKey && weekKeys(m)[6] < bornKey) break; // antes de crear el hábito
      const v = weekVerdict(h, m, w === 0);
      if (v === 'met') streak++;
      else if (v === 'miss') break;
    }
    return streak;
  }

  function weeklyBestStreak(h) {
    if (!h.history || h.history.length === 0) return 0;
    const first = [...h.history].sort()[0];
    const bornKey = h.createdAt ? UI.localDateKey(new Date(h.createdAt)) : first;
    const m = mondayOf(new Date((first < bornKey ? first : bornKey) + 'T12:00:00'));
    const cur = mondayOf(new Date());
    let best = 0, run = 0;
    while (m <= cur) {
      const v = weekVerdict(h, m, UI.localDateKey(m) === UI.localDateKey(cur));
      if (v === 'met') { run++; if (run > best) best = run; }
      else if (v === 'miss') run = 0;
      m.setDate(m.getDate() + 7);
    }
    return best;
  }

  // Texto de racha: "5🔥" (días) o "2 semanas🔥" (con mínimo semanal)
  function streakLabel(h, streak) {
    if (!hasWeeklyMin(h)) return `${streak}🔥`;
    return `${streak} ${streak === 1 ? 'semana' : 'semanas'}🔥`;
  }

  function calcStreak(h) {
    if (hasWeeklyMin(h)) return weeklyStreak(h);
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

  // Racha máxima en días entre hábitos activos (los de mínimo semanal se miden en semanas: no entran)
  function maxStreakAcrossAll() {
    let max = 0;
    activeHabits().filter(h => !hasWeeklyMin(h)).forEach(h => { const s = calcStreak(h); if (s > max) max = s; });
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
        const minBefore = weekMinInfo(habit);
        if (!habit.history.includes(dateKey)) {
          habit.history.push(dateKey);
        }
        celebrateIfMinReached(habit, dateKey, minBefore);
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
        const minBefore = weekMinInfo(habit);
        if (!habit.history.includes(dateKey)) {
          habit.history.push(dateKey);
        }
        const celebrated = celebrateIfMinReached(habit, dateKey, minBefore);
        habit._completedAt = habit._completedAt || {};
        habit._completedAt[dateKey] = Date.now();
        habit.contributions = habit.contributions || {};
        habit.contributions[dateKey] = amount;
        if (note) {
          habit.notes = habit.notes || {};
          habit.notes[dateKey] = note;
        }
        // Sumar a la meta (del período correcto). Si está activa, vía Goals.updateCurrent
        // para que suba en tiempo real por la cadena parentGoalId (semanal → mensual → anual),
        // igual que los hábitos cuantitativos y las tareas.
        if (amount > 0) {
          if (!goal.archived) {
            Goals.updateCurrent(goal.id, (goal.current || 0) + amount);
          } else {
            goal.current = (goal.current || 0) + amount;
            recalcGoalAfterContribChange(goal);
          }
        }

        UI.buzz(15);
        Storage.save();
        renderOverview(); renderFull(); renderHeatmap(); App.refreshKPIs();
        Goals.renderAll(); Goals.renderWeeklyMini();

        if (amount > 0 && !celebrated) {
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

  function remove(id, onAfter = null) {
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
        if (onAfter) onAfter();
      }
    });
  }

  // Archivar: deja de aparecer en Hoy, KPIs y estadísticas; conserva el historial
  function archive(id) {
    const h = Storage.get().habits.find(x => x.id === id);
    if (!h || h.archived) return;
    UI.confirm2({
      title: '📦 Archivar hábito',
      message: `"<strong>${escapeHtml(h.name)}</strong>" dejará de aparecer en Hoy y en estadísticas. Su historial se conserva y puedes reactivarlo cuando quieras.`,
      okText: 'Archivar',
      onConfirm: () => {
        h.archived = true;
        h.archivedAt = Date.now();
        Storage.save();
        afterArchiveChange();
        UI.toast('Hábito archivado');
      }
    });
  }

  // Reactivar: el período archivado queda registrado para que no rompa rachas
  function unarchive(id) {
    const h = Storage.get().habits.find(x => x.id === id);
    if (!h || !h.archived) return;
    if (h.archivedAt) {
      const from = UI.localDateKey(new Date(h.archivedAt));
      const to = dateKeyDaysAgo(1);
      if (from <= to) h.archivedRanges = [...(h.archivedRanges || []), { from, to }];
    }
    h.archived = false;
    delete h.archivedAt;
    Storage.save();
    afterArchiveChange();
    UI.toast('Hábito reactivado');
  }

  function afterArchiveChange() {
    renderFull(); renderOverview(); renderTodayHabits(); renderHeatmap(); renderDetail(); App.refreshKPIs();
    if (typeof Stats !== 'undefined') Stats.render();
  }

  let archivedOpen = false;

  function renderFull() {
    const c = document.getElementById('habits-full-list');
    if (!isLive(c)) return;
    const state = Storage.get();
    if (state.habits.length === 0) {
      c.innerHTML = '<div class="empty">No tienes hábitos creados · usa el + de arriba para crear uno</div>';
      return;
    }
    const active = state.habits.filter(h => !h.archived);
    const archivedList = state.habits.filter(h => h.archived);
    // Lista plana en el orden de state.habits (el usuario controla con ▲▼)
    const activeHTML = active.length
      ? active.map(renderItemFull).join('')
      : '<div class="empty">Sin hábitos activos · usa el + de arriba para crear uno</div>';
    const archivedHTML = archivedList.length ? `
      <div class="hab-archived ${archivedOpen ? 'open' : ''}">
        <button type="button" class="hab-archived-head" id="hab-archived-toggle" aria-expanded="${archivedOpen}">
          <span>📦 Archivados (${archivedList.length})</span>
          <span class="coll-chev" aria-hidden="true">▸</span>
        </button>
        ${archivedOpen ? `<div class="hab-archived-body">${archivedList.map(renderArchivedItem).join('')}</div>` : ''}
      </div>` : '';
    c.innerHTML = activeHTML + archivedHTML;
    bindClicks(c);
    const tgl = document.getElementById('hab-archived-toggle');
    if (tgl) tgl.addEventListener('click', () => { archivedOpen = !archivedOpen; renderFull(); });
  }

  function renderArchivedItem(h) {
    const when = h.archivedAt ? new Date(h.archivedAt).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
    return `
      <div class="item archived-item" data-id="${h.id}">
        <span class="item-icon" data-action="detail">${h.icon || '⭐'}</span>
        <div class="item-body" data-action="detail">
          <div class="item-name">${escapeHtml(h.name)}</div>
          <div class="item-meta"><span>${formatFreq(h.frequency)}</span><span>Archivado${when ? ' · ' + when : ''}</span></div>
        </div>
        <div class="item-actions">
          <button class="item-reactivate" data-action="unarchive">Reactivar</button>
          <button class="item-delete" data-action="delete" aria-label="Eliminar">×</button>
        </div>
      </div>`;
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
    const list = state.habits.filter(h => !h.archived);
    if (!list.length) {
      c.innerHTML = '<div class="empty">Sin hábitos · usa el ícono de arriba para crear el primero</div>';
      return;
    }

    // Orden: pendientes de hoy → completados de hoy → los que no tocan hoy
    const todayKey = UI.todayKey();
    const pending = [], completed = [], offDay = [];
    list.forEach(h => {
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

  // Momento del día actual: mañana < 12:00 · tarde 12:00–18:59 · noche ≥ 19:00
  function currentMoment(now = new Date()) {
    const hr = now.getHours();
    return hr < 12 ? 'mañana' : (hr < 19 ? 'tarde' : 'noche');
  }
  // Orden de grupos: el momento actual, los siguientes, "Cualquier momento" y al final los ya pasados
  function momentOrder(now = new Date()) {
    const i = MOMENTS.indexOf(currentMoment(now));
    return [...MOMENTS.slice(i), 'any', ...MOMENTS.slice(0, i)];
  }

  // Grupos ya completos que el usuario expandió a mano (se colapsan solos al completarse)
  const expandedGroups = new Set();

  // ¿Un hábito de Hoy se considera hecho? Solo si se cumplió hoy (también con mínimo semanal).
  function isDoneForToday(h) { return isCompletedToday(h); }

  // Hábito que acaba de asegurar su mínimo semanal (animación breve en sus puntos).
  // Se limpia solo a los 2 s (varios repintados seguidos mantienen la clase) y
  // entonces su grupo, si quedó completo, se colapsa como siempre.
  let celebrateId = null;
  let celebrateTimer = 0;

  // Lista de hábitos del panel "Hoy", agrupada por momento del día.
  // Solo los que aparecen hoy (días elegidos), con o sin mínimo semanal.
  function renderTodayHabits() {
    const c = document.getElementById('today-habits-list');
    if (!isLive(c)) return;
    const state = Storage.get();

    if (Vacation.isActive()) {
      c.innerHTML = '<div class="empty">🏖️ De vacaciones · tus hábitos vuelven cuando termines</div>';
      return;
    }

    const now = new Date();
    const todayKey = UI.todayKey();
    const list = state.habits.filter(h => countsForDate(h, now));

    if (list.length === 0) {
      c.innerHTML = '<div class="empty">No hay hábitos para hoy · disfruta 🌿</div>';
      return;
    }

    const byCompletion = (a, b) => ((a._completedAt && a._completedAt[todayKey]) || 0) - ((b._completedAt && b._completedAt[todayKey]) || 0);
    c.innerHTML = momentOrder(now).map(m => {
      const items = list.filter(h => (MOMENTS.includes(h.timeOfDay) ? h.timeOfDay : 'any') === m);
      if (!items.length) return '';
      const pending = items.filter(h => !isDoneForToday(h));   // respeta el orden manual (moveHabit)
      const done = items.filter(isDoneForToday).sort(byCompletion);
      const allDone = pending.length === 0;
      // Mientras celebra el mínimo semanal, el grupo sigue abierto para ver la animación
      const collapsed = allDone && !expandedGroups.has(m) && !items.some(h => h.id === celebrateId);
      return `
        <div class="hab-group ${allDone ? 'complete' : ''} ${collapsed ? 'collapsed' : ''}">
          <button type="button" class="hab-group-head" data-group-toggle="${m}" ${allDone ? '' : 'disabled'} aria-expanded="${!collapsed}">
            <span class="hab-group-name">${MOMENT_LABELS[m]}</span>
            <span class="hab-group-count">· ${done.length}/${items.length}</span>
            ${allDone ? '<span class="hab-group-check">✓</span>' : ''}
          </button>
          ${collapsed ? '' : `<div class="hab-group-body">${[...pending, ...done].map(h => renderOverviewItem(h, true)).join('')}</div>`}
        </div>`;
    }).join('');
    bindOverviewClicks(c);
    c.querySelectorAll('[data-group-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        const m = btn.dataset.groupToggle;
        if (expandedGroups.has(m)) expandedGroups.delete(m); else expandedGroups.add(m);
        renderTodayHabits();
      });
    });
  }

  // Semana en puntos (L M M J V S D) para hábitos con mínimo semanal:
  // cumplidos rellenos (animados), días en que aparece con borde, el resto apagados.
  const DOT_LETTERS = { 1: 'L', 2: 'M', 3: 'M', 4: 'J', 5: 'V', 6: 'S', 0: 'D' };
  function weekDotsHTML(h) {
    const info = weekMinInfo(h);
    if (!info) return '';
    const todayKey = UI.todayKey();
    const dots = info.days.map(d => `
          <span class="hab-dot ${d.done ? 'done' : ''} ${d.appears ? 'appears' : 'off'} ${d.key === todayKey ? 'today' : ''}" title="${DAY_NAMES[d.dow]}">
            <span class="hab-dot-fill" style="height:${d.done ? 100 : 0}%"></span>
            <span class="hab-dot-letter">${DOT_LETTERS[d.dow]}</span>
          </span>`).join('');
    // Tono positivo: sin avisos de racha en riesgo (solo puntos y "N/M mín.")
    return `
          <div class="hab-week ${celebrateId === h.id ? 'celebrate' : ''}">
            <div class="hab-dots">${dots}</div>
            ${info.min > 0 ? `<span class="hab-week-txt ${info.state === 'met' ? 'met' : ''}">${Math.min(info.done, 99)}/${info.min} mín.</span>` : ''}
          </div>`;
  }

  // Si el registro de `dk` asegura el mínimo de la semana en curso: toast + animación
  function celebrateIfMinReached(h, dk, before) {
    if (!before || before.state === 'met') return false;
    if (weekKeys(new Date())[0] !== weekKeys(new Date(dk + 'T12:00:00'))[0]) return false;
    const after = weekMinInfo(h);
    if (!after || after.state !== 'met') return false;
    celebrateId = h.id;
    clearTimeout(celebrateTimer);
    celebrateTimer = setTimeout(() => { celebrateId = null; renderTodayHabits(); }, 2000);
    UI.toast('Racha asegurada esta semana 💪');
    return true;
  }

  function renderOverviewItem(h, clean = false) {
    const today   = isHabitForDate(h, new Date());
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
        streak > 0 ? streakLabel(h, streak) : null,
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
          ${weekDotsHTML(h)}
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
            ${streak > 0 ? `<span class="streak">${streakLabel(h, streak)}</span>` : ''}
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
          <button class="item-archive" data-action="archive" aria-label="Archivar">📦</button>
          <button class="item-delete" data-action="delete" aria-label="Eliminar">×</button>
        </div>
      </div>`;
  }

  // "Diario" / "Lun Mié Vie"; con mínimo semanal: "Todos los días · mín. 5/sem", "L M M J V · mín. 3/sem"
  function formatFreq(f) {
    const min = parseInt(f && f.weeklyMin, 10);
    if (!f || f.type !== 'days' || !Array.isArray(f.days)) {
      return min >= 1 ? `Todos los días · mín. ${Math.min(min, 7)}/sem` : 'Diario';
    }
    if (min >= 1) {
      const days = ALL_DAYS.filter(d => f.days.includes(d));
      return `${days.map(d => DOT_LETTERS[d]).join(' ')} · mín. ${Math.min(min, days.length)}/sem`;
    }
    return f.days.map(d => DAY_NAMES[d]).join(' ');
  }

  function bindClicks(c) {
    c.querySelectorAll('[data-action]').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        const id = b.closest('.item').dataset.id;
        const a = b.dataset.action;
        if (a === 'toggle') toggleToday(id);
        if (a === 'delete') remove(id);
        if (a === 'archive') archive(id);
        if (a === 'unarchive') unarchive(id);
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
    const tods = [['', 'Cualquier momento'], ['mañana','◐ Mañana'],['tarde','◑ Tarde'],['noche','◓ Noche']];
    const curTod = editing && MOMENTS.includes(editing.timeOfDay) ? editing.timeOfDay : '';
    const todOpts = tods.map(([v,l]) => `<option value="${v}" ${curTod === v ? 'selected' : ''}>${l}</option>`).join('');
    const freqOpts = [['daily','Todos los días'],['days','Días específicos']]
      .map(([v,l]) => `<option value="${v}" ${editing && editing.frequency?.type === v ? 'selected' : ''}>${l}</option>`).join('');
    const showDays = editing && editing.frequency?.type === 'days' ? 'block' : 'none';
    const minVal = editing ? (weeklyMinOf(editing) || '') : '';

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
        <label for="h-min">Mínimo semanal para la racha <span style="text-transform:none;color:var(--text-faint)">(opcional)</span></label>
        <input type="number" id="h-min" inputmode="numeric" min="1" max="7" step="1" placeholder="Sin mínimo (racha diaria)" value="${minVal}" />
        <p style="color:var(--text-dim);font-size:11px;margin-top:6px">Si cumples al menos este número de días en la semana, tu racha no se pierde</p>
        <p class="qe-error" id="h-min-error" hidden></p>

        <label for="h-tod">Momento del día</label>
        <select id="h-tod">${todOpts}</select>

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
        const todSel = document.getElementById('h-tod').value;
        const timeOfDay = MOMENTS.includes(todSel) ? todSel : null;
        let frequency = { type: 'daily' };
        if (freqType === 'days') {
          const days = [...document.querySelectorAll('input[name=day]:checked')].map(i => +i.value);
          if (days.length === 0) { UI.toast('Selecciona al menos un día'); return false; }
          frequency = { type: 'days', days };
        }
        // Mínimo semanal opcional (solo flexibiliza la racha): entre 1 y los días elegidos
        const minEl = document.getElementById('h-min');
        const minErr = document.getElementById('h-min-error');
        const minRaw = minEl.value.trim();
        const maxMin = frequency.type === 'days' ? frequency.days.length : 7;
        if (minRaw) {
          const n = Number(minRaw);
          if (!Number.isInteger(n) || n < 1 || n > maxMin) {
            minErr.textContent = `El mínimo debe estar entre 1 y ${maxMin}`;
            minErr.hidden = false;
            minEl.focus();
            return false;
          }
          frequency.weeklyMin = n;
        }
        minErr.hidden = true;
        if (editing) {
          editing.name = name;
          editing.icon = icon;
          editing.color = color;
          editing.area = area;
          editing.frequency = frequency;
          editing.timeOfDay = timeOfDay;
          editing.linkedGoalId = linkedGoalId;
          editing.defaultIncrement = defaultIncrement;
          editing.dailyTarget = dailyTarget;
          editing.unit = unit;
          UI.toast('Hábito actualizado');
        } else {
          Storage.get().habits.push({
            id: Storage.uid(), name, icon, color, area, frequency, timeOfDay,
            linkedGoalId, defaultIncrement, dailyTarget, unit,
            createdAt: Date.now(), history: [], contributions: {}, dailyProgress: {},
          });
          UI.toast('Hábito creado');
        }
        Storage.save();
        renderOverview(); renderFull(); renderHeatmap(); renderDetail(); App.refreshKPIs();
        Goals.renderAll(); Goals.renderWeeklyMini();
      }
    });

    setTimeout(() => {
      const sel = document.getElementById('h-freq');
      sel.addEventListener('change', () => {
        document.getElementById('h-days-wrap').style.display = sel.value === 'days' ? 'block' : 'none';
      });

      // Mostrar/ocultar campo de cantidad según meta seleccionada
      const minInp = document.getElementById('h-min');
      minInp.addEventListener('input', () => { document.getElementById('h-min-error').hidden = true; });

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
    // Cumplimiento sobre los días en que aparece (independiente del mínimo semanal)
    const weekly = hasWeeklyMin(h);
    const pct7 = pct(7);
    const pct30 = pct(30);
    const pct90 = pct(90);

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
      const stateLabel = !applies ? (archivedOn(h, key) ? ' (archivado)' : ' (no aplica)') : (onVac ? ' (vacaciones)' : (isDone ? ' · ✓ hecho' : ' · sin marcar'));
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

    const archivedBanner = h.archived ? `
      <div class="habit-archived-banner">📦 Archivado${h.archivedAt ? ' el ' + new Date(h.archivedAt).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }) : ''} · no aparece en Hoy ni en estadísticas</div>` : '';
    const detailActions = h.archived
      ? `<button class="btn-secondary" data-detail-action="unarchive">↩︎ Reactivar</button>
         <button class="btn-danger" data-detail-action="delete">Eliminar</button>`
      : `<button class="btn-secondary" data-detail-action="archive">📦 Archivar hábito</button>`;

    c.innerHTML = `
      ${archivedBanner}
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
          <div class="stat-label">${weekly ? 'Racha (semanas) 🔥' : 'Racha 🔥'}</div>
          <div class="stat-value">${streak}</div>
        </div>
        <div class="stat-card" style="--stat-color:var(--accent-yellow)">
          <div class="stat-label">${weekly ? 'Mejor (semanas) 🏆' : 'Mejor 🏆'}</div>
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
            <div class="section-subtitle">${weekly ? '% sobre sesiones esperadas' : '% sobre días aplicables'}</div>
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
          ${h.archived ? '' : `<button class="heatmap-edit-btn" id="heatmap-retro-edit-btn" data-habit-id="${h.id}" aria-label="Editar últimos 7 días" title="Editar últimos 7 días">
            <span class="edit-icon">✎</span>
          </button>`}
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

      <div class="habit-detail-actions">${detailActions}</div>
    `;

    c.querySelectorAll('[data-detail-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const a = btn.dataset.detailAction;
        if (a === 'archive') archive(h.id);
        if (a === 'unarchive') unarchive(h.id);
        if (a === 'delete') remove(h.id, () => UI.goBack('habits-manage'));
      });
    });

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
      single: true, // cada toque se guarda al momento: solo "Cerrar"
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
    if (hasWeeklyMin(h)) return weeklyBestStreak(h);
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
    const list = activeHabits();
    if (list.length === 0) {
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

    c.innerHTML = list.map(h => {
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
            ${streak > 0 ? `<span class="streak">${streakLabel(h, streak)}</span>` : ''}
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

  return { findGoalForDate, countsForDate, hasWeeklyMin, weeklyMinOf, weekMinInfo, formatFreq, archive, unarchive, streakLabel, complianceWindow, calcBestStreak, renderOverview, renderTodayHabits, renderFull, renderHeatmap, openCreateModal, openEditModal, openDetail, renderDetail, openEditFromDetail, isHabitForToday, isHabitForDate, isCompletedToday, calcStreak, maxStreakAcrossAll, toggleHabitOnDate, toggleToday, RETRO_DAYS_LIMIT, isQuant, getDailyProgress, getHabitDayPct, addToHabitProgress, subFromHabitProgress, openQuantModal };
})();
