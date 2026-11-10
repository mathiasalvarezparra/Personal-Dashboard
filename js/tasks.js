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
