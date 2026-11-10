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

  const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const fmtNum = n => String(Math.round(n * 10) / 10);

  // Período calendario de un horizonte que contiene `ref`: semana lunes→domingo
  // (igual que UI.weekKey), mes o año. elapsed incluye el día de `ref`.
  function periodRange(horizon, ref = new Date()) {
    const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 12);
    let start, end;
    if (horizon === 'week') {
      start = new Date(d); start.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      end = new Date(start); end.setDate(start.getDate() + 6);
    } else if (horizon === 'month') {
      start = new Date(d.getFullYear(), d.getMonth(), 1, 12);
      end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12);
    } else {
      start = new Date(d.getFullYear(), 0, 1, 12);
      end = new Date(d.getFullYear(), 11, 31, 12);
    }
    return {
      start, end,
      startKey: UI.localDateKey(start), endKey: UI.localDateKey(end),
      total: Math.round((end - start) / 86400000) + 1,
      elapsed: Math.round((d - start) / 86400000) + 1,
    };
  }

  // Ritmo esperado (solo metas cuantitativas activas no cumplidas):
  // esperado = target × días transcurridos (con hoy) / días del período.
  function goalPace(g, now = new Date()) {
    if (!(g.target > 0) || g.done || g.archived) return null;
    const r = periodRange(g.horizon, now);
    const expected = g.target * r.elapsed / r.total;
    const cur = g.current || 0;
    const pct = Math.min(100, Math.round((r.elapsed / r.total) * 1000) / 10);
    const unit = g.unit ? ' ' + g.unit : '';
    if (cur > Math.ceil(expected)) {
      return { state: 'ahead', pct, expected, n: cur - Math.ceil(expected), text: `Vas ${fmtNum(cur - Math.ceil(expected))}${unit} adelante` };
    }
    if (cur < Math.floor(expected)) {
      return { state: 'behind', pct, expected, n: Math.floor(expected) - cur, text: `Vas ${fmtNum(Math.floor(expected) - cur)}${unit} atrás` };
    }
    return { state: 'ok', pct, expected, n: 0, text: 'Al día' };
  }

  // Barra de progreso + marca vertical del esperado (ambas animadas por Animate)
  function goalBarHTML(pct, pace, style = '') {
    return `<div class="goal-bar ${pace ? 'has-pace' : ''}" ${style ? `style="${style}"` : ''}>` +
      `<div class="goal-bar-fill" style="width:${pct}%"></div>` +
      (pace ? `<div class="goal-pace-mark" style="width:${pace.pct}%"></div>` : '') +
      `</div>`;
  }
  const paceHTML = pace => pace ? `<div class="goal-pace ${pace.state}">${pace.text}</div>` : '';

  // Etiqueta corta del período de una meta (por su fecha de creación)
  function shortPeriodLabel(g) {
    const r = periodRange(g.horizon, new Date(g.createdAt));
    if (g.horizon === 'week') {
      const a = r.start, b = r.end;
      return a.getMonth() === b.getMonth()
        ? `semana ${a.getDate()}–${b.getDate()} ${MONTHS_SHORT[b.getMonth()]}`
        : `semana ${a.getDate()} ${MONTHS_SHORT[a.getMonth()]}–${b.getDate()} ${MONTHS_SHORT[b.getMonth()]}`;
    }
    if (g.horizon === 'month') return `${MONTHS_SHORT[r.start.getMonth()]} ${r.start.getFullYear()}`;
    return String(r.start.getFullYear());
  }

  /**
   * Origen del avance de una meta cuantitativa: hábitos (contributions dentro del
   * período que cayeron en esta meta), tareas completadas vinculadas, metas hijas
   * (current si está activa, propagatedCurrent si está archivada) y "Manual" (el resto).
   */
  function originBreakdown(g) {
    const s = Storage.get();
    const r = periodRange(g.horizon, new Date(g.createdAt));
    const inRange = dk => dk >= r.startKey && dk <= r.endKey;
    const today = UI.todayKey();
    const refKey = inRange(today) ? today : r.endKey;
    const rows = [];
    let linked = false;

    s.habits.forEach(h => {
      if (!h.linkedGoalId) return;
      let sum = 0;
      Object.keys(h.contributions || {}).forEach(dk => {
        const v = h.contributions[dk] || 0;
        if (!v || !inRange(dk)) return;
        const tg = Habits.findGoalForDate(h, dk);
        if (tg && tg.id === g.id) sum += v;
      });
      const feeds = Habits.findGoalForDate(h, refKey);
      if ((feeds && feeds.id === g.id) || sum > 0) {
        linked = true;
        rows.push({ kind: 'habit', label: h.name, value: sum });
      }
    });

    const linkedTasks = s.tasks.filter(t => t.goalId === g.id);
    if (linkedTasks.length) {
      linked = true;
      const n = linkedTasks.filter(t => t.done && t.doneAt && inRange(UI.localDateKey(new Date(t.doneAt)))).length;
      rows.push({ kind: 'tasks', label: 'Tareas', value: n });
    }

    s.goals
      .filter(c => c.parentGoalId === g.id && c.target > 0)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      .forEach(c => {
        linked = true;
        const v = c.archived ? (c.propagatedCurrent != null ? c.propagatedCurrent : (c.current || 0)) : (c.current || 0);
        if (!c.archived || v > 0) rows.push({ kind: 'child', label: `${c.name} · ${shortPeriodLabel(c)}`, value: v });
      });

    const sum = rows.reduce((a, x) => a + x.value, 0);
    const manual = Math.round(((g.current || 0) - sum) * 100) / 100;
    if (manual > 0) rows.push({ kind: 'manual', label: 'Manual', value: manual });
    return { rows, linked };
  }

  function originHTML(g) {
    const { rows, linked } = originBreakdown(g);
    return `
          <div class="goal-origin">
            <div class="goal-origin-title">Aporta a esta meta</div>
            ${rows.map(x => `<div class="goal-origin-row ${x.kind}">${escapeHtml(x.label)} · <strong>${fmtNum(x.value)}</strong></div>`).join('')}
            ${linked ? '' : '<div class="goal-origin-empty">Sin acciones vinculadas</div>'}
          </div>`;
  }

  // ---- División en cascada (anual → mensual + semanal; mensual → semanal) ----
  function splitSuggestions(horizon, target, now = new Date()) {
    if (horizon === 'year') return { month: Math.ceil(target / 12), week: Math.ceil(target / 52) };
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return { week: Math.ceil(target / (days / 7)) };
  }
  const canSplit = g => !g.archived && (g.horizon === 'year' || g.horizon === 'month') && g.target > 0 &&
    !Storage.get().goals.some(c => c.parentGoalId === g.id && !c.archived);

  // Campos de las secciones "Mensual"/"Semanal" + hábito opcional (ids gs-*)
  function splitFieldsHTML() {
    const habits = Storage.get().habits.filter(h => !h.archived);
    const sec = (h, title) => `
      <div class="g-split-sec" data-split-sec="${h}">
        <div class="g-split-title">${title}</div>
        <label for="gs-${h}-name">Nombre</label>
        <input type="text" id="gs-${h}-name" autocomplete="off" />
        <div class="g-split-row">
          <div><label for="gs-${h}-target">Objetivo</label><input type="number" id="gs-${h}-target" min="1" step="1" /></div>
          <div><label for="gs-${h}-unit">Unidad</label><input type="text" id="gs-${h}-unit" autocomplete="off" /></div>
        </div>
      </div>`;
    return `
      ${sec('month', 'Mensual · este mes')}
      ${sec('week', 'Semanal · esta semana')}
      ${habits.length ? `
        <label for="gs-habit">Vincular hábito (opcional)</label>
        <select id="gs-habit">
          <option value="">— Ninguno —</option>
          ${habits.map(h => `<option value="${h.id}">${h.icon || '⭐'} ${escapeHtml(h.name)}</option>`).join('')}
        </select>
        <p class="g-split-warn" id="gs-habit-warn" hidden></p>` : ''}
      <p class="qe-error" id="gs-error" hidden></p>`;
  }

  // Enlaza los campos de división. getParent() → { horizon, name, target, unit }.
  // Los valores sugeridos se recalculan mientras el usuario no edite ese campo.
  function bindSplitFields(getParent) {
    const $ = id => document.getElementById(id);
    ['month', 'week'].forEach(h => ['name', 'target', 'unit'].forEach(f => {
      const el = $(`gs-${h}-${f}`);
      el.addEventListener('input', () => { el.dataset.dirty = '1'; $('gs-error').hidden = true; });
    }));
    const habitSel = $('gs-habit');
    if (habitSel) {
      habitSel.addEventListener('change', () => {
        const warn = $('gs-habit-warn');
        const h = Storage.get().habits.find(x => x.id === habitSel.value);
        const old = h && h.linkedGoalId ? Storage.get().goals.find(g => g.id === h.linkedGoalId) : null;
        warn.textContent = old ? `Reemplazará el vínculo con ${old.name}` : '';
        warn.hidden = !old;
      });
    }
    const setDefault = (el, v) => { if (!el.dataset.dirty) el.value = v; };
    function refresh() {
      const p = getParent();
      document.querySelector('[data-split-sec="month"]').hidden = p.horizon !== 'year';
      const sug = p.target > 0 ? splitSuggestions(p.horizon, p.target) : {};
      ['month', 'week'].forEach(h => {
        setDefault($(`gs-${h}-name`), p.name);
        setDefault($(`gs-${h}-unit`), p.unit);
        setDefault($(`gs-${h}-target`), sug[h] || '');
      });
    }
    function read() {
      const p = getParent();
      const levels = p.horizon === 'year' ? ['month', 'week'] : ['week'];
      const out = { habitId: habitSel ? (habitSel.value || null) : null };
      for (const h of levels) {
        const target = +$(`gs-${h}-target`).value || 0;
        if (target <= 0) {
          const err = $('gs-error');
          err.textContent = `Define un objetivo mayor a 0 para la meta ${h === 'month' ? 'mensual' : 'semanal'}`;
          err.hidden = false;
          return null;
        }
        out[h] = {
          name: $(`gs-${h}-name`).value.trim() || p.name,
          target,
          unit: $(`gs-${h}-unit`).value.trim(),
        };
      }
      return out;
    }
    refresh();
    return { refresh, read };
  }

  // Crea SOLO las metas del período actual, recurrentes y vinculadas a la padre.
  function createSplitChildren(parent, v) {
    const s = Storage.get();
    const now = Date.now();
    const mk = (horizon, data, parentGoalId) => ({
      id: Storage.uid(), name: data.name, horizon, area: parent.area,
      target: data.target, unit: data.unit, parentGoalId,
      recurrence: horizon === 'month' ? 'monthly' : 'weekly', seriesId: Storage.uid(),
      current: 0, done: false, createdAt: now,
    });
    let weekParentId = parent.id;
    const created = [];
    if (parent.horizon === 'year' && v.month) {
      const m = mk('month', v.month, parent.id);
      s.goals.push(m); created.push(m);
      weekParentId = m.id;
    }
    const w = mk('week', v.week, weekParentId);
    s.goals.push(w); created.push(w);
    if (v.habitId) {
      const h = s.habits.find(x => x.id === v.habitId);
      if (h) h.linkedGoalId = w.id;
    }
    return created;
  }

  // Acción "Dividir" sobre una meta anual/mensual activa sin hijas activas
  function openSplitModal(id) {
    const g = Storage.get().goals.find(x => x.id === id);
    if (!g || !canSplit(g)) return;
    let fields;
    UI.openModal({
      title: `✂️ Dividir "${g.name}"`,
      okText: 'Crear metas',
      bodyHTML: `
        <p class="qe-help" style="margin-top:0">Se crean solo las metas del período actual; las siguientes se generan solas y quedan vinculadas.</p>
        ${splitFieldsHTML()}`,
      onSave: () => {
        const v = fields.read();
        if (!v) return false;
        const created = createSplitChildren(g, v);
        Storage.save();
        renderAll(); renderWeeklyMini(); renderTodayGoals(); App.refreshKPIs();
        if (typeof Habits !== 'undefined') { Habits.renderFull(); }
        UI.toast(`✂️ Dividida en ${created.length} meta${created.length > 1 ? 's' : ''}`);
      }
    });
    fields = bindSplitFields(() => ({ horizon: g.horizon, name: g.name, target: g.target, unit: g.unit || '' }));
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
    // Enfoque limpio: nombre, avance y ritmo (sin área, período ni recurrencia)
    const pace = goalPace(g);
    return `
      <div class="goal-mini-item ${g.done ? 'done' : ''}" data-goal-quick="${g.id}">
        <div class="goal-mini-row">
          <span class="goal-mini-name">${escapeHtml(g.name)}</span>
          <span class="goal-mini-progress">${tt}</span>
        </div>
        ${goalBarHTML(pct, pace)}
        ${paceHTML(pace)}
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
    const pace = goalPace(g);

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
        ${goalBarHTML(pct, pace, 'margin-top:8px')}
        ${paceHTML(pace)}
        ${isQuant ? `
          <div class="goal-card-progress">
            <input type="number" data-action="current" value="${g.current || 0}" min="0" step="0.5" />
            <span>/ ${g.target} ${g.unit || ''}</span>
            ${canSplit(g) ? '<button type="button" class="goal-split-btn" data-action="split">✂️ Dividir</button>' : ''}
          </div>
          ${originHTML(g)}
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
      else if (a === 'split') el.addEventListener('click', () => openSplitModal(id));
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
        ${editing ? '' : `
          <div class="g-split" id="g-split" hidden>
            <label class="g-split-toggle">
              <input type="checkbox" id="g-split-on" />
              <span>Dividir en metas más pequeñas</span>
            </label>
            <div class="g-split-body" id="g-split-body" hidden>${splitFieldsHTML()}</div>
          </div>`}
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
        // División en cascada (solo al crear una anual/mensual cuantitativa)
        const splitOn = !editing && splitFields && document.getElementById('g-split-on').checked &&
          !document.getElementById('g-split').hidden;
        const splitValues = splitOn ? splitFields.read() : null;
        if (splitOn && !splitValues) return false;

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
          if (splitValues) {
            const created = createSplitChildren(newGoal, splitValues);
            UI.toast(`Meta creada · dividida en ${created.length} meta${created.length > 1 ? 's' : ''}`);
          } else {
            UI.toast(recurrence !== 'none' ? `🔁 Meta recurrente creada (${recurrenceLabel(recurrence)})` : 'Meta creada');
          }
        }
        Storage.save();
        renderAll(); renderWeeklyMini(); App.refreshKPIs();
        if (splitValues && splitValues.habitId && typeof Habits !== 'undefined') Habits.renderFull();
      }
    });

    // Interruptor "Dividir en metas más pequeñas": solo anual/mensual con objetivo > 0
    let splitFields = null;
    if (!editing) {
      const val = id => document.getElementById(id).value;
      splitFields = bindSplitFields(() => ({
        horizon: val('g-horizon'),
        name: val('g-name').trim(),
        target: val('g-type') === 'quant' ? (+val('g-target') || 0) : 0,
        unit: val('g-unit').trim(),
      }));
      const refreshSplit = () => {
        const p = { horizon: val('g-horizon'), quant: val('g-type') === 'quant', target: +val('g-target') || 0 };
        const show = (p.horizon === 'year' || p.horizon === 'month') && p.quant && p.target > 0;
        document.getElementById('g-split').hidden = !show;
        document.getElementById('g-split-body').hidden = !(show && document.getElementById('g-split-on').checked);
        splitFields.refresh();
      };
      ['g-horizon', 'g-type', 'g-target', 'g-name', 'g-unit', 'g-split-on'].forEach(id => {
        const el = document.getElementById(id);
        el.addEventListener('input', refreshSplit);
        el.addEventListener('change', refreshSplit);
      });
      refreshSplit();
    }

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

  return { renderAll, renderWeeklyMini, renderTodayGoals, openCreateModal, setInnerHorizon, openQuickProgressModal, updateCurrent, goalPace, originBreakdown, openSplitModal, periodRange };
})();
