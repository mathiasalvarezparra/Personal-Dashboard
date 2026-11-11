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
        <div class="trend-col ${d.isCurrent ? 'is-current' : ''} ${d.pct === null ? 'is-empty' : ''}" data-week-summary="${d.wk}" role="button" tabindex="0" aria-label="Resumen de la semana del ${label}${d.isCurrent ? ' (en curso)' : ''}" title="${label}: ${d.pct === null ? 'sin datos' : d.pct + '%'}">
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
      <div class="trend-chart">${bars}</div>
      <div class="trend-hint">Toca una barra para ver el resumen de esa semana</div>`;
    c.querySelectorAll('[data-week-summary]').forEach(col => {
      const openIt = () => { UI.buzz(8); WeekSummary.open(col.dataset.weekSummary); };
      col.addEventListener('click', openIt);
      col.addEventListener('keydown', e => { if (e.key === 'Enter') openIt(); });
    });
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
    const habits = state.habits.filter(h => !h.archived);
    if (!habits.length) {
      c.innerHTML = '<div class="empty">No tienes hábitos activos</div>';
      return;
    }
    c.innerHTML = habits.map(h => {
      const w7 = Habits.complianceWindow(h, 7).pct;
      const w30 = Habits.complianceWindow(h, 30).pct;
      const w90 = Habits.complianceWindow(h, 90).pct;
      const streak = Habits.calcStreak(h);
      const best = Habits.calcBestStreak(h);
      const weekly = Habits.hasWeeklyMin(h);
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
              <div class="sh-streak"><span class="sh-streak-val">${streak}</span><span class="sh-streak-lbl">${weekly ? 'sem. racha' : 'racha'}</span></div>
              <div class="sh-streak"><span class="sh-streak-val">${best}</span><span class="sh-streak-lbl">${weekly ? 'sem. récord' : 'récord'}</span></div>
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

    // Solo cierres del día. Las respuestas del antiguo cierre semanal (weekClosures)
    // son datos legados: se conservan en el JSON pero no se muestran.
    const dayItems = Object.keys(state.closures || {}).map(dk => ({ kind: 'day', key: dk, sort: dk }));
    const weekItems = [];

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
        monthsHTML += monthItems.map(dayCard).join('');
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

  // Desde el historial, tocar un cierre del día lo abre editable (mismo formulario).
  function openClosure(kind, key) {
    App.openDayCloseModal(key);
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
