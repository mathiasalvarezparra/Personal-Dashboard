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

  // "Próximamente": tarea pendiente sin fecha (date = null). En la gestión vive en su
  // propio filtro; en Enfoque va a la pestaña Próximamente salvo que tenga subtareas
  // pendientes con fecha (entonces se ubica según la fecha efectiva).
  const isSomeday = t => !t.done && !t.date;
  function tomorrowKey() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return UI.localDateKey(d);
  }
  // Checklist inline abierto (por id de tarea) en Enfoque y en la gestión
  const openSubtasks = new Set();
  const subtaskStats = t => {
    const list = Array.isArray(t.subtasks) ? t.subtasks : [];
    return { total: list.length, done: list.filter(x => x.done).length };
  };

  // ---- Fechas (claves 'YYYY-MM-DD', mediodía local para evitar saltos de zona) ----
  const keyToDate = k => new Date(k + 'T12:00:00');
  function addDaysKey(k, n) {
    const d = keyToDate(k);
    d.setDate(d.getDate() + n);
    return UI.localDateKey(d);
  }
  const daysBetween = (a, b) => Math.round((keyToDate(b) - keyToDate(a)) / 86400000);

  // Fecha efectiva: la más próxima entre la fecha de la tarea y las fechas de sus
  // subtareas pendientes. null = sin fecha (Próximamente).
  function effectiveDate(t) {
    let d = t.date || null;
    (Array.isArray(t.subtasks) ? t.subtasks : []).forEach(x => {
      if (!x.done && x.date && (!d || x.date < d)) d = x.date;
    });
    return d;
  }
  // Subtarea pendiente vencida más antigua (para "Subtarea atrasada · Nd")
  function oldestOverdueSubtask(t, todayKey) {
    let d = null;
    (Array.isArray(t.subtasks) ? t.subtasks : []).forEach(x => {
      if (!x.done && x.date && x.date < todayKey && (!d || x.date < d)) d = x.date;
    });
    return d;
  }

  // ¿La tarea cuenta para el % y los contadores del día? Igual que antes
  // (fecha de la tarea = hoy, hecha o no) más las pendientes cuya fecha efectiva
  // es hoy por una subtarea, y las hechas con una subtarea fechada hoy.
  function countsForToday(t) {
    const today = UI.todayKey();
    if (t.date === today) return true;
    if (!t.done) return effectiveDate(t) === today;
    return (Array.isArray(t.subtasks) ? t.subtasks : []).some(x => x.date === today);
  }

  // Pestañas de la tarjeta Tareas en Enfoque
  const TASK_TABS = [
    ['today', 'Hoy', 'Nada para hoy'],
    ['week', 'Semana', 'Semana libre'],
    ['month', 'Mes', 'Mes despejado'],
    ['later', 'Más adelante', 'Nada más adelante'],
    ['soon', 'Próximamente', 'Sin ideas pendientes'],
  ];
  const TAB_STORE = 'mi_dashboard_task_tab'; // solo sessionStorage: dura la sesión
  let todayTab = 'today';
  try {
    const saved = sessionStorage.getItem(TAB_STORE);
    if (TASK_TABS.some(([id]) => id === saved)) todayTab = saved;
  } catch (e) { /* sin sessionStorage: se usa Hoy */ }

  // Rangos: Semana = mañana → domingo de esta semana; Mes = lunes siguiente →
  // último día del mes actual; Más adelante = todo lo posterior.
  function tabRanges(todayKey) {
    const d = keyToDate(todayKey);
    const dow = d.getDay(); // 0 = domingo
    const sunday = addDaysKey(todayKey, dow === 0 ? 0 : 7 - dow);
    return {
      sunday,
      nextMonday: addDaysKey(sunday, 1),
      endMonth: UI.localDateKey(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12)),
    };
  }
  function bucketOf(t, todayKey, r) {
    const ed = effectiveDate(t);
    if (!ed) return 'soon';
    if (ed < todayKey) return 'overdue';
    if (ed === todayKey) return 'today';
    if (ed <= r.sunday) return 'week';
    if (ed >= r.nextMonday && ed <= r.endMonth) return 'month';
    return 'later';
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
      if (rec && t.date) {
        const nextDate = getNextRecurrenceDate(t.date, rec);
        if (nextDate) {
          // Las subtareas fechadas se desplazan los mismos días que la tarea
          const shift = daysBetween(t.date, nextDate);
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
              // La nueva ocurrencia trae el mismo checklist, sin marcar
              ...(t.subtasks && t.subtasks.length
                ? { subtasks: t.subtasks.map(x => ({
                    id: Storage.uid(), name: x.name, done: false,
                    date: x.date ? addDaysKey(x.date, shift) : null,
                  })) }
                : {}),
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
        <textarea id="task-complete-note" autocapitalize="sentences" placeholder="Ej: detalles relevantes"></textarea>
      `,
      onSave: () => {
        const note = capitalizeFirst(document.getElementById('task-complete-note').value.trim());
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

  // Tarjeta "✅ Tareas" en Enfoque: Atrasadas siempre arriba (fuera de las pestañas)
  // y debajo pestañas por plazo según la fecha efectiva. Cada tarea aparece una sola vez.
  function renderToday() {
    const c = document.getElementById('today-tasks');
    if (!isLive(c)) return;
    const todayKey = UI.todayKey();
    const r = tabRanges(todayKey);
    const groups = { overdue: [], today: [], week: [], month: [], later: [], soon: [] };
    Storage.get().tasks.forEach(t => { if (!t.done) groups[bucketOf(t, todayKey, r)].push(t); });

    const imp = t => (t.important ? 1 : 0);
    // Atrasadas: primero importantes, luego normales. Dentro de cada grupo, las más viejas arriba.
    groups.overdue.sort((a, b) => (imp(b) - imp(a)) || effectiveDate(a).localeCompare(effectiveDate(b)));
    // Pestañas con fecha: fecha efectiva ascendente; mismo día → importantes, luego creación
    const byDate = (a, b) => effectiveDate(a).localeCompare(effectiveDate(b))
      || (imp(b) - imp(a)) || ((a.createdAt || 0) - (b.createdAt || 0));
    ['today', 'week', 'month', 'later'].forEach(k => groups[k].sort(byDate));
    groups.soon.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

    let html = '';
    if (groups.overdue.length > 0) {
      html += `
        <div class="overdue-section">
          <div class="overdue-section-title">
            <span>⚠ Atrasadas</span>
            <span class="overdue-count">${groups.overdue.length}</span>
          </div>
          ${groups.overdue.map(t => renderItem(t, { overdue: true, noActions: true, focus: true })).join('')}
        </div>
      `;
    }

    const tab = TASK_TABS.find(([id]) => id === todayTab) || TASK_TABS[0];
    html += `<div class="task-tabs" role="tablist">${TASK_TABS.map(([id, label]) => `
      <button type="button" class="task-tab ${id === tab[0] ? 'active' : ''}" data-task-tab="${id}" role="tab" aria-selected="${id === tab[0]}">${label}<span class="task-tab-count">${groups[id].length}</span></button>`).join('')}
    </div>`;
    const list = groups[tab[0]];
    html += `<div class="task-tab-list">${list.length
      ? list.map(t => renderItem(t, { noActions: true, tapEdit: true, focus: true })).join('')
      : `<div class="empty empty-tasks">${tab[2]}</div>`}</div>`;

    c.innerHTML = html;
    // Las pestañas se desplazan en horizontal: mantener visible la activa tras repintar
    const tabsEl = c.querySelector('.task-tabs');
    const activeTab = tabsEl.querySelector('.task-tab.active');
    const relLeft = activeTab.getBoundingClientRect().left - tabsEl.getBoundingClientRect().left;
    if (relLeft + activeTab.offsetWidth > tabsEl.clientWidth) tabsEl.scrollLeft = relLeft - 8;
    bindClicks(c);
    c.querySelectorAll('[data-task-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        todayTab = btn.dataset.taskTab;
        try { sessionStorage.setItem(TAB_STORE, todayTab); } catch (e) { /* solo en memoria */ }
        renderToday();
      });
    });
  }

  function renderFull() {
    const c = document.getElementById('tasks-full-list');
    if (!isLive(c)) return;

    // Contador del filtro "Próximamente"
    const somedayCount = Storage.get().tasks.filter(isSomeday).length;
    const countEl = document.getElementById('someday-count');
    if (countEl) countEl.textContent = somedayCount ? String(somedayCount) : '';

    // Archivo: tareas hechas, con agrupación por mes (vista especial)
    if (filter === 'archive') {
      renderDoneGrouped(c);
      return;
    }

    let list = Storage.get().tasks.slice();
    if (filter === 'scheduled') {
      // Programadas = tareas recurrentes activas (se repiten)
      list = list.filter(t => !t.done && t.date && t.recurrence && t.recurrence !== 'none');
    } else if (filter === 'once') {
      // Puntuales = tareas sin recurrencia, activas y con fecha
      list = list.filter(t => !t.done && t.date && (!t.recurrence || t.recurrence === 'none'));
    } else if (filter === 'someday') {
      // Próximamente = pendientes sin fecha (orden: importantes, luego por creación)
      list = list.filter(isSomeday).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    }
    list.sort((a, b) => {
      if ((a.important?1:0) !== (b.important?1:0)) return (b.important?1:0) - (a.important?1:0);
      return (a.date || '').localeCompare(b.date || '');
    });
    if (list.length === 0) {
      const msg = filter === 'scheduled'
        ? 'Sin tareas recurrentes · crea una y elige que se repita'
        : (filter === 'someday'
          ? 'Sin ideas pendientes · guarda aquí lo que quieras hacer sin fecha'
          : 'Sin tareas puntuales pendientes');
      c.innerHTML = `<div class="empty">${msg}</div>`;
      return;
    }
    c.innerHTML = list.map(t => renderItem(t, { someday: filter === 'someday' })).join('');
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
    // Todo parte colapsado; se recuerda lo que el usuario abra (solo en memoria).
    const isMonthOpen = (mk) => doneMonthsOpen[mk] === true;

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
            <span class="coll-chev" aria-hidden="true">▸</span>
            <span class="done-month-title">${monthLabel}</span>
            <span class="done-month-meta">${tasks.length} ${tasks.length === 1 ? 'hecha' : 'hechas'}</span>
          </button>
          <div class="done-month-body" ${open ? '' : 'hidden'}>
            ${tasks.map(t => renderItem(t)).join('')}
          </div>
        </div>
      `;
    };

    // Agrupar los meses por AÑO (colapsados por defecto)
    const isYearOpen = (yk) => doneYearsOpen[yk] === true;
    const yearKeys = [...new Set(monthKeys.map(mk => mk.slice(0, 4)))].sort((a, b) => b.localeCompare(a));

    const monthsHTML = yearKeys.map(yk => {
      const yearLabel = yk === '0000' ? 'Sin fecha' : yk;
      const monthsOfYear = monthKeys.filter(mk => mk.slice(0, 4) === yk);
      const yearCount = monthsOfYear.reduce((n, mk) => n + groups[mk].length, 0);
      const yOpen = isYearOpen(yk);
      return `
        <div class="hist-year ${yOpen ? 'open' : ''}">
          <button class="hist-year-label" data-year-toggle="${yk}" type="button" aria-expanded="${yOpen}">
            <span class="hist-year-name">${yearLabel}</span>
            <span class="hist-year-count">${yearCount}</span>
            <span class="coll-chev" aria-hidden="true">▸</span>
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
        doneYearsOpen[yk] = !(doneYearsOpen[yk] === true);
        renderFull();
      });
    });
    c.querySelectorAll('[data-month-toggle]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mk = btn.dataset.monthToggle;
        doneMonthsOpen[mk] = !(doneMonthsOpen[mk] === true);
        renderFull();
      });
    });
  }

  function renderItem(t, opts = {}) {
    const area = Storage.get().areas.find(a => a.id === t.area);
    // Enfoque limpio (opts.focus): solo fecha/urgencia; sin área, repetición ni "Próximamente"
    const focus = !!opts.focus;
    const dl = t.date ? formatTaskDate(t.date) : (t.done || focus ? '' : '📥 PRÓXIMAMENTE');
    const recLabel = {
      daily: 'DIARIA',
      weekly: 'SEMANAL',
      monthly: 'MENSUAL',
      yearly: 'ANUAL',
    }[t.recurrence];
    const overdue = !!opts.overdue;
    const todayKey = UI.todayKey();
    // Calcular cuántos días lleva atrasada (vs hoy). Si la tarea no está atrasada
    // pero sí una subtarea, la etiqueta es "Subtarea atrasada · Nd" (la más antigua).
    let overdueBadge = '';
    if (overdue && t.date && t.date < todayKey) {
      const overdueDays = Math.max(1, daysBetween(t.date, todayKey));
      overdueBadge = `<span class="overdue-badge">${overdueDays === 1 ? '1 día atrasada' : `${overdueDays} días atrasada`}</span>`;
    } else if (overdue) {
      const od = oldestOverdueSubtask(t, todayKey);
      if (od) overdueBadge = `<span class="overdue-badge">Subtarea atrasada · ${Math.max(1, daysBetween(od, todayKey))}d</span>`;
    }

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

    // Subtareas: checklist expandible en todas partes (también en Atrasadas);
    // en Hechas/Archivo solo el resumen.
    const sub = subtaskStats(t);
    const showSubtasks = sub.total > 0;
    let subtasksHTML = '';
    if (showSubtasks && t.done) {
      subtasksHTML = `<div class="subtask-summary">✓ ${sub.done}/${sub.total} subtareas</div>`;
    } else if (showSubtasks) {
      const open = openSubtasks.has(t.id);
      const pct = Math.round((sub.done / sub.total) * 100);
      subtasksHTML = `
          <button type="button" class="subtask-toggle ${open ? 'open' : ''}" data-action="subtasks" aria-expanded="${open}">
            <span class="subtask-count">${sub.done}/${sub.total}</span>
            <span class="subtask-bar"><span class="subtask-fill" style="width:${pct}%"></span></span>
            <span class="subtask-chevron">▾</span>
          </button>
          ${open ? `<div class="subtask-list">${sortSubtasks(t.subtasks).map(x => {
            const late = !x.done && x.date && x.date < todayKey;
            return `
            <button type="button" class="subtask-row ${x.done ? 'done' : ''} ${late ? 'overdue' : ''}" data-action="subtask" data-sub="${escapeAttr(x.id)}">
              <span class="subtask-check">${x.done ? '✓' : ''}</span>
              <span class="subtask-name">${escapeHtml(x.name)}</span>
              ${x.date ? `<span class="subtask-date">${formatTaskDate(x.date)}</span>` : ''}
            </button>`;
          }).join('')}</div>` : ''}`;
    }
    // Todas las subtareas hechas: el checkbox se destaca (lista para cerrarse), sin completarla sola
    const ready = showSubtasks && !t.done && sub.done === sub.total;

    // Filtro "Próximamente" de la gestión: botones rápidos para asignar fecha (solo ahí)
    const somedayHTML = (opts.someday && !t.done && !t.date) ? `
          <div class="someday-actions">
            <button type="button" class="someday-btn" data-action="date-today">Hoy</button>
            <button type="button" class="someday-btn" data-action="date-tomorrow">Mañana</button>
            <button type="button" class="someday-btn" data-action="date-pick">Fecha</button>
            <input type="date" class="someday-date" data-action="date-input" hidden />
          </div>` : '';

    return `
      <div class="item ${t.done ? 'done' : ''} ${overdue ? 'overdue' : ''}" data-id="${t.id}">
        <button class="checkbox ${t.done ? 'checked' : ''} ${ready ? 'ready' : ''}" data-action="toggle" ${ready ? 'aria-label="Subtareas listas: completar tarea"' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>
        </button>
        ${t.important ? '<span class="item-icon">⭐</span>' : ''}
        <div class="item-body ${opts.tapEdit ? 'tap-edit' : ''}" ${opts.tapEdit ? 'data-action="edit"' : ''}>
          <div class="item-name">${escapeHtml(t.name)}${overdueBadge}</div>
          ${focus && !dl ? '' : `<div class="item-meta">
            ${doneInfo || (dl ? `<span>${dl}</span>` : '')}
            ${area && !focus ? `<span class="area-tag">${area.name}</span>` : ''}
            ${recLabel && !focus ? `<span class="recurrence-badge">🔁 ${recLabel}</span>` : ''}
          </div>`}
          ${noteBlock}
          ${subtasksHTML}
          ${somedayHTML}
        </div>
        ${opts.noActions ? '' : `
        <div class="item-actions">
          <button class="item-edit" data-action="edit" aria-label="Editar">✎</button>
          <button class="item-delete" data-action="delete">×</button>
        </div>`}
      </div>`;
  }

  // Orden del checklist: pendientes por fecha (atrasadas primero, sin fecha al final,
  // luego por orden de creación) y las completadas al final.
  function sortSubtasks(list) {
    const pos = new Map(list.map((x, i) => [x.id, i]));
    return list.slice().sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (!a.done) {
        if (!!a.date !== !!b.date) return a.date ? -1 : 1;
        if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
      }
      return pos.get(a.id) - pos.get(b.id);
    });
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
      if (b.dataset.action === 'date-input') {
        b.addEventListener('click', e => e.stopPropagation());
        b.addEventListener('change', () => { if (b.value) setTaskDate(b.closest('.item').dataset.id, b.value); });
        return;
      }
      b.addEventListener('click', e => {
        e.stopPropagation();
        const id = b.closest('.item').dataset.id;
        const a = b.dataset.action;
        if (a === 'toggle') toggle(id);
        if (a === 'delete') remove(id);
        if (a === 'edit') openCreateModal(id);
        if (a === 'subtasks') {
          if (openSubtasks.has(id)) openSubtasks.delete(id); else openSubtasks.add(id);
          rerender();
        }
        if (a === 'subtask') toggleSubtask(id, b.dataset.sub);
        if (a === 'date-today') setTaskDate(id, UI.todayKey());
        if (a === 'date-tomorrow') setTaskDate(id, tomorrowKey());
        if (a === 'date-pick') {
          const inp = b.parentElement.querySelector('.someday-date');
          inp.hidden = false;
          inp.focus();
          try { if (inp.showPicker) inp.showPicker(); } catch (err) { /* el input visible basta */ }
        }
      });
    });
  }

  function rerender() { renderToday(); renderFull(); App.refreshKPIs(); }

  // Marcar/desmarcar una subtarea sin abrir el modal (no completa la tarea sola)
  function toggleSubtask(taskId, subId) {
    const t = Storage.get().tasks.find(x => x.id === taskId);
    const st = t && (t.subtasks || []).find(x => x.id === subId);
    if (!st) return;
    st.done = !st.done;
    UI.buzz(8);
    Storage.save();
    rerender();
  }

  // Asignar fecha a una tarea de "Próximamente" (botones rápidos de la gestión)
  function setTaskDate(taskId, dateKey) {
    const t = Storage.get().tasks.find(x => x.id === taskId);
    if (!t || !dateKey) return;
    t.date = dateKey;
    Storage.save();
    rerender();
    UI.toast(`Movida a ${formatTaskDate(dateKey).toLowerCase()}`);
  }

  // Modal de tarea (crear desde Enfoque o la gestión, y editar). Nombre primero, chips de
  // fecha (Hoy · Mañana · Próximamente · Fecha) y el resto bajo "Más opciones".
  function openCreateModal(editId = null) {
    const state = Storage.get();
    const editing = editId ? state.tasks.find(t => t.id === editId) : null;
    const areasOpts = state.areas.map(a => `<option value="${a.id}" ${editing && editing.area === a.id ? 'selected' : ''}>${a.icon} ${a.name}</option>`).join('');
    // Vinculación: solo metas semanales activas. Si la tarea ya estaba vinculada a otra
    // meta (mensual/anual, o una semanal ya cerrada) se conserva y se marca entre paréntesis.
    const goalChoices = state.goals.filter(g => g.horizon === 'week' && !g.done && !g.archived);
    const linked = editing && editing.goalId ? state.goals.find(g => g.id === editing.goalId) : null;
    if (linked && !goalChoices.includes(linked)) goalChoices.push(linked);
    const goalSuffix = g => {
      if (g.horizon === 'month') return ' (mensual)';
      if (g.horizon === 'year') return ' (anual)';
      if (g.horizon !== 'week') return '';
      return g.archived ? ' (archivada)' : (g.done ? ' (cumplida)' : '');
    };
    const goalsOpts = goalChoices.map(g => `<option value="${g.id}" ${linked === g ? 'selected' : ''}>${escapeHtml(g.name)}${goalSuffix(g)}</option>`).join('');
    const today = UI.todayKey();
    const tomorrow = tomorrowKey();
    const currentRec = (editing && editing.recurrence) || 'none';
    const recChoices = [
      ['none', 'No se repite'],
      ['monthly', '🔁 Mensual'],
      ['yearly', '🔁 Anual'],
    ];
    // Recurrencias antiguas (diaria/semanal) que ya no se ofrecen: se conservan al editar
    if (currentRec === 'daily') recChoices.push(['daily', '🔁 Diaria']);
    if (currentRec === 'weekly') recChoices.push(['weekly', '🔁 Semanal']);
    const recOpts = recChoices.map(([v, l]) => `<option value="${v}" ${currentRec === v ? 'selected' : ''}>${l}</option>`).join('');

    // Estado del modal
    const modalState = {
      when: !editing ? 'today'
        : (!editing.date ? 'someday'
          : (editing.date === today ? 'today'
            : (editing.date === tomorrow ? 'tomorrow' : 'pick'))),
      subtasks: (editing && Array.isArray(editing.subtasks))
        ? editing.subtasks.map(x => ({ ...x, date: x.date || null }))
        : [],
      calOpen: null, // id de la subtarea con el selector de fecha abierto
    };
    const pickInit = editing && editing.date ? editing.date : today;
    const shortDate = dk => new Date(dk + 'T12:00:00').toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
    const pickLabel = dk => `📅 ${shortDate(dk)}`;

    // "Más opciones" abierto al editar algo con importante, repetición, meta o subtareas
    const moreOpen = !!(editing && (editing.important || currentRec !== 'none' || editing.goalId || modalState.subtasks.length));

    // Campos extra solo cuando editamos una tarea HECHA (bitácora)
    const isEditingDone = editing && editing.done;
    const doneFieldsHTML = isEditingDone ? `
      <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border-soft)">
        <p style="color:var(--text-dim);font-size:11px;margin-bottom:8px;font-family:var(--font-mono);text-transform:uppercase;letter-spacing:0.5px">Bitácora</p>
        <label>Nota (opcional)</label>
        <textarea id="t-note" autocapitalize="sentences" placeholder="Detalles relevantes">${editing.note ? escapeHtml(editing.note) : ''}</textarea>
      </div>
    ` : '';

    const whenChip = (id, label) => `<button type="button" class="qe-chip ${modalState.when === id ? 'active' : ''}" data-when="${id}">${label}</button>`;

    UI.openModal({
      title: editing ? 'Editar tarea' : 'Nueva tarea',
      okText: editing ? 'Guardar cambios' : 'Guardar',
      bodyHTML: `
        <label for="t-name">Tarea</label>
        <input type="text" id="t-name" placeholder="Ej: Pagar la luz" autocomplete="off" autocapitalize="sentences" value="${editing ? escapeAttr(editing.name) : ''}" />
        <p class="qe-error" id="t-name-error" hidden></p>

        <label>Fecha</label>
        <div class="qe-chips" id="t-when-chips">
          ${whenChip('today', 'Hoy')}
          ${whenChip('tomorrow', 'Mañana')}
          ${whenChip('someday', '📥 Próximamente')}
          ${whenChip('pick', modalState.when === 'pick' ? pickLabel(pickInit) : '📅 Fecha')}
        </div>
        <input type="date" id="t-date" value="${pickInit}" ${modalState.when === 'pick' ? '' : 'hidden'} />

        <button type="button" class="qe-more-toggle" id="t-more-toggle" aria-expanded="${moreOpen}">
          Más opciones <span class="qe-more-arrow">${moreOpen ? '▴' : '▾'}</span>
        </button>
        <div class="qe-more" id="t-more" ${moreOpen ? '' : 'hidden'}>
          <label for="t-area">Área</label>
          <select id="t-area">${areasOpts}</select>
          <label style="display:flex;align-items:center;gap:8px;margin-top:14px;text-transform:none;">
            <input type="checkbox" id="t-imp" style="width:auto;margin:0" ${editing && editing.important ? 'checked' : ''} /> ⭐ Marcar como importante
          </label>
          <label for="t-recurrence">🔁 Repetición</label>
          <select id="t-recurrence">${recOpts}</select>
          <p class="qe-help" id="t-rec-help">Si es recurrente, al completarla se generará automáticamente la próxima ocurrencia.</p>
          ${goalsOpts ? `
            <label for="t-goal">Vincular a meta semanal (opcional)</label>
            <select id="t-goal">
              <option value="">— Ninguna —</option>
              ${goalsOpts}
            </select>` : ''}
          <label for="t-sub-input">Subtareas</label>
          <div class="t-sub-list" id="t-sub-list"></div>
          <p class="qe-error" id="t-sub-error" hidden></p>
          <input type="text" id="t-sub-input" placeholder="Agregar subtarea y presiona Enter" autocomplete="off" autocapitalize="sentences" enterkeyhint="enter" />
        </div>
        ${doneFieldsHTML}
      `,
      onSave: () => {
        const nameEl = document.getElementById('t-name');
        const name = capitalizeFirst(nameEl.value.trim());
        const errEl = document.getElementById('t-name-error');
        if (!name) {
          errEl.textContent = 'Escribe el nombre de la tarea';
          errEl.hidden = false;
          nameEl.focus();
          return false;
        }
        // Subtarea escrita pero sin Enter: también se guarda
        addPendingSubtask();
        // Ninguna subtarea puede ser posterior a la fecha de la tarea
        if (!validateSubtasks()) {
          const more = document.getElementById('t-more');
          if (more.hidden) moreToggle.click();
          document.getElementById('t-sub-error').scrollIntoView({ block: 'center' });
          return false;
        }

        const date = currentTaskDate();
        const area = document.getElementById('t-area').value;
        const goalId = document.getElementById('t-goal')?.value || null;
        const important = document.getElementById('t-imp').checked;
        // "Próximamente" no puede repetirse
        const recurrence = date ? document.getElementById('t-recurrence').value : 'none';
        const subtasks = modalState.subtasks
          .filter(x => x.name.trim())
          .map(x => ({ id: x.id, name: capitalizeFirst(x.name), done: !!x.done, date: x.date || null }));

        if (editing) {
          editing.name = name;
          editing.date = date;
          editing.area = area;
          editing.goalId = goalId;
          editing.important = important;
          editing.recurrence = recurrence;
          if (subtasks.length) editing.subtasks = subtasks;
          else delete editing.subtasks;
          // Campos de bitácora (solo si edita una hecha)
          if (isEditingDone) {
            const noteInp = document.getElementById('t-note');
            if (noteInp) {
              const note = capitalizeFirst(noteInp.value.trim());
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
            ...(subtasks.length ? { subtasks } : {}),
          });
          UI.toast(!date ? 'Guardada en Próximamente' : (recurrence !== 'none' ? `Tarea recurrente creada (${recurrence})` : 'Tarea creada'));
        }
        Storage.save();
        rerender();
      }
    });

    // --- Interacción (UI.openModal pinta el HTML de forma síncrona) ---
    const recSel = document.getElementById('t-recurrence');
    const recHelp = document.getElementById('t-rec-help');
    const dateInp = document.getElementById('t-date');
    function currentTaskDate() {
      if (modalState.when === 'today') return today;
      if (modalState.when === 'tomorrow') return tomorrow;
      if (modalState.when === 'someday') return null;
      return dateInp.value || today;
    }
    const refreshWhen = () => {
      document.querySelectorAll('#t-when-chips .qe-chip').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.when === modalState.when);
        if (btn.dataset.when === 'pick') btn.textContent = modalState.when === 'pick' && dateInp.value ? pickLabel(dateInp.value) : '📅 Fecha';
      });
      dateInp.hidden = modalState.when !== 'pick';
      const someday = modalState.when === 'someday';
      recSel.disabled = someday;
      if (someday) recSel.value = 'none';
      recHelp.textContent = someday
        ? 'Asigna una fecha para repetir'
        : 'Si es recurrente, al completarla se generará automáticamente la próxima ocurrencia.';
      renderSubList();
    };
    document.querySelectorAll('#t-when-chips .qe-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        modalState.when = btn.dataset.when;
        refreshWhen();
        if (modalState.when === 'pick') {
          dateInp.focus();
          try { if (dateInp.showPicker) dateInp.showPicker(); } catch (err) { /* el input visible basta */ }
        }
      });
    });
    dateInp.addEventListener('change', refreshWhen);

    const moreToggle = document.getElementById('t-more-toggle');
    moreToggle.addEventListener('click', () => {
      const more = document.getElementById('t-more');
      more.hidden = !more.hidden;
      moreToggle.setAttribute('aria-expanded', String(!more.hidden));
      moreToggle.querySelector('.qe-more-arrow').textContent = more.hidden ? '▾' : '▴';
    });

    // Subtareas en el modal: Enter agrega y deja el foco listo; 📅 fecha opcional; × elimina
    const subList = document.getElementById('t-sub-list');
    const subInput = document.getElementById('t-sub-input');
    const subErr = document.getElementById('t-sub-error');
    // Subtareas con fecha posterior a la de la tarea (si la tarea no tiene fecha, todo vale)
    const invalidSubIds = () => {
      const td = currentTaskDate();
      return new Set(td ? modalState.subtasks.filter(x => x.date && x.date > td).map(x => x.id) : []);
    };
    function validateSubtasks() {
      const bad = invalidSubIds();
      const td = currentTaskDate();
      subErr.textContent = bad.size
        ? `Una subtarea no puede ser posterior a la fecha de la tarea (${shortDate(td)})`
        : '';
      subErr.hidden = !bad.size;
      return bad.size === 0;
    }
    function renderSubList() {
      const bad = invalidSubIds();
      const td = currentTaskDate();
      subList.innerHTML = modalState.subtasks.map(x => `
        <div class="t-sub-item ${bad.has(x.id) ? 'invalid' : ''}">
          <div class="t-sub-row ${x.done ? 'done' : ''}">
            <span class="t-sub-name">${x.done ? '✓ ' : ''}${escapeHtml(x.name)}</span>
            <button type="button" class="t-sub-cal ${x.date ? 'has-date' : ''}" data-sub-cal="${escapeAttr(x.id)}" aria-label="Fecha de la subtarea">${x.date ? `📅 ${shortDate(x.date)}` : '📅'}</button>
            <button type="button" class="t-sub-del" data-sub-del="${escapeAttr(x.id)}" aria-label="Eliminar subtarea">×</button>
          </div>
          ${modalState.calOpen === x.id ? `
          <div class="t-sub-when">
            <button type="button" class="qe-chip ${x.date === today ? 'active' : ''}" data-sub-when="today">Hoy</button>
            <button type="button" class="qe-chip ${x.date === tomorrow ? 'active' : ''}" data-sub-when="tomorrow">Mañana</button>
            <button type="button" class="qe-chip ${x.date && x.date !== today && x.date !== tomorrow ? 'active' : ''}" data-sub-when="pick">Fecha</button>
            ${x.date ? '<button type="button" class="qe-chip" data-sub-when="none">Sin fecha</button>' : ''}
            <input type="date" class="t-sub-date" value="${x.date || td || today}" ${td ? `max="${td}"` : ''} hidden />
          </div>` : ''}
        </div>`).join('');
      subList.querySelectorAll('[data-sub-del]').forEach(btn => {
        btn.addEventListener('click', () => {
          modalState.subtasks = modalState.subtasks.filter(x => x.id !== btn.dataset.subDel);
          renderSubList();
        });
      });
      subList.querySelectorAll('[data-sub-cal]').forEach(btn => {
        btn.addEventListener('click', () => {
          modalState.calOpen = modalState.calOpen === btn.dataset.subCal ? null : btn.dataset.subCal;
          renderSubList();
        });
      });
      const sx = modalState.subtasks.find(x => x.id === modalState.calOpen);
      if (sx) {
        const setSubDate = v => { sx.date = v; modalState.calOpen = null; renderSubList(); };
        const dInp = subList.querySelector('.t-sub-date');
        dInp.addEventListener('change', () => { if (dInp.value) setSubDate(dInp.value); });
        subList.querySelectorAll('[data-sub-when]').forEach(btn => {
          btn.addEventListener('click', () => {
            const w = btn.dataset.subWhen;
            if (w === 'today') setSubDate(today);
            else if (w === 'tomorrow') setSubDate(tomorrow);
            else if (w === 'none') setSubDate(null);
            else {
              dInp.hidden = false;
              dInp.focus();
              try { if (dInp.showPicker) dInp.showPicker(); } catch (err) { /* el input visible basta */ }
            }
          });
        });
      }
      validateSubtasks();
    }
    function addPendingSubtask() {
      const v = capitalizeFirst(subInput.value.trim());
      if (!v) return false;
      modalState.subtasks.push({ id: Storage.uid(), name: v, done: false, date: null });
      subInput.value = '';
      renderSubList();
      return true;
    }
    subInput.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      addPendingSubtask();
      // blur + focus dentro del mismo gesto: el teclado del iPhone vuelve a mayúscula
      // automática sin cerrarse (un focus diferido fuera del gesto no lo reabriría)
      subInput.blur();
      subInput.focus();
      // Tras pintar la lista: el input (y la última subtarea) quedan sobre el pie y el teclado
      requestAnimationFrame(() => UI.revealInModal(subInput, 'end'));
    });

    // Enter en el nombre guarda (con validación inline)
    const nameInp = document.getElementById('t-name');
    nameInp.addEventListener('input', () => { document.getElementById('t-name-error').hidden = true; });
    nameInp.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      document.getElementById('modal-ok').click();
    });

    refreshWhen();
    setTimeout(() => nameInp.focus(), 50);
  }

  return { renderToday, renderFull, openCreateModal, setFilter, countsForToday, effectiveDate };
})();
