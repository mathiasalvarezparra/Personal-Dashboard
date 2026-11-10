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
