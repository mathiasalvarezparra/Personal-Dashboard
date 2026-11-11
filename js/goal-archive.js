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

  // Estado de expansión: solo en memoria (la sesión). Todo parte colapsado.
  const expanded = { years: new Set(), months: new Set(), weeks: new Set() };

  function subsection(title, goals) {
    if (!goals.length) return '';
    return `<div class="archive-subsection"><div class="archive-subsection-title">${title}</div>${goals.map(renderArchivedGoal).join('')}</div>`;
  }

  function renderWeek(wk, goals) {
    const isOpen = expanded.weeks.has(wk);
    return `
      <div class="archive-week ${isOpen ? 'is-open' : ''}">
        <button class="archive-toggle archive-week-toggle" data-gt-week="${wk}" aria-expanded="${isOpen}">
          <span class="coll-chev" aria-hidden="true">▸</span>
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
        <button class="archive-toggle archive-month-toggle" data-gt-month="${mk}" aria-expanded="${isOpen}">
          <span class="coll-chev" aria-hidden="true">▸</span>
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
        <button class="archive-toggle archive-year-toggle" data-gt-year="${year}" aria-expanded="${isOpen}">
          <span class="coll-chev" aria-hidden="true">▸</span>
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
