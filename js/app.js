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
    refreshKPIs();
    renderCloseDay();
    renderWeekSummaryBtn();
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
    refreshKPIs();
    renderCloseDay();
    renderWeekSummaryBtn();
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
      const tasksToday = state.tasks.filter(Tasks.countsForToday);
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

    // Hábitos que cuentan ese día (según frequency; sin archivados)
    const habits = (state.habits || []).filter(h => Habits.countsForDate(h, date));

    // Pagos REALES de ese día: gastos registrados en movements con esa fecha
    const dayPayments = (state.movements || []).filter(m =>
      Finance.isTrackedExpense(m) && m.date === dateKey
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
      single: true, // solo lectura: un botón "Cerrar"
      bodyHTML: html,
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
      renderWeekSummaryBtn();
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
    const tasksToday = state.tasks.filter(Tasks.countsForToday);

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

    // Persistir el % del día (alimenta la Tendencia semanal). El strip visual
    // ya no existe: renderWeekStrip solo guarda el snapshot y no pinta.
    renderWeekStrip(pct);

    // Secciones nuevas del panel "Hoy"
    Habits.renderTodayHabits();
    Goals.renderTodayGoals();
    Finance.renderTodayPending();
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

  // ====== RESUMEN DE LA SEMANA ======
  // Botón de Enfoque: domingo → semana en curso; lunes → la que terminó.
  // Otros días no aparece. Abre WeekSummary (solo lectura, sin preguntas).
  function weekSummaryTarget() {
    const day = new Date().getDay(); // 0 = domingo, 1 = lunes
    if (day === 0) return UI.weekKey();
    if (day === 1) {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      return UI.weekKey(d);
    }
    return null;
  }

  function renderWeekSummaryBtn() {
    const btn = document.getElementById('week-summary-btn');
    if (!btn) return;
    const wk = weekSummaryTarget();
    btn.hidden = !wk;
    if (!wk) return;
    btn.dataset.week = wk;
    btn.textContent = '📊 Resumen de la semana';
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
      const tasksToday = state.tasks.filter(Tasks.countsForToday);
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
    const todayTaskAdd = document.getElementById('today-task-add');
    if (todayTaskAdd) todayTaskAdd.addEventListener('click', () => Tasks.openCreateModal());
    const goalAdd = document.getElementById('goals-manage-add');
    if (goalAdd) goalAdd.addEventListener('click', () => Goals.openCreateModal());
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

    const weekSummaryBtn = document.getElementById('week-summary-btn');
    if (weekSummaryBtn) weekSummaryBtn.addEventListener('click', () => {
      const wk = weekSummaryBtn.dataset.week;
      if (wk) WeekSummary.open(wk);
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

    // Pestañas internas del recuadro Metas (legado, con data-inner-horizon). Las de
    // Enfoque (data-today-horizon) las maneja Goals.renderTodayGoals; enlazarlas aquí
    // marcaba las tres como activas al tocar una.
    document.querySelectorAll('.goals-inner-tab[data-inner-horizon]').forEach(tab => {
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

  return { init, refreshKPIs, refreshAll, setFocusTab, renderFocusTab, weekRange, weekLabelFor, openDayCloseModal: openCloseDayModal };
})();
