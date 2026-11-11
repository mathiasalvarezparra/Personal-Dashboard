/* ============================================
   WEEK SUMMARY — resumen motivador de una semana
   Solo lectura: todo se calcula con datos existentes (dailySnapshots, hábitos,
   metas, tareas, gastos y cierres diarios). No guarda nada ni tiene campos.
   Se abre desde el botón de Enfoque (domingo/lunes) y desde las barras de la
   tendencia de Estadísticas, en la vista de pantalla completa `week-summary`.
   ============================================ */
const WeekSummary = (() => {
  const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const RING_R = 54;
  const RING_C = 2 * Math.PI * RING_R;
  let currentWk = null;

  const keyDate = k => new Date(k + 'T12:00:00');
  function shiftWeek(wk, n) {
    const d = keyDate(App.weekRange(wk).start);
    d.setDate(d.getDate() + n * 7);
    return UI.weekKey(d);
  }
  const fmt1 = n => (Math.round(n * 10) / 10).toString().replace('.', ',');

  // "3 – 9 nov" / "27 oct – 2 nov"
  function rangeLabel(wk) {
    const r = App.weekRange(wk);
    const a = keyDate(r.start), b = keyDate(r.end);
    return a.getMonth() === b.getMonth()
      ? `${a.getDate()} – ${b.getDate()} ${MONTHS_SHORT[b.getMonth()]}`
      : `${a.getDate()} ${MONTHS_SHORT[a.getMonth()]} – ${b.getDate()} ${MONTHS_SHORT[b.getMonth()]}`;
  }

  // Puntaje = promedio del % diario guardado (misma lógica que la Tendencia)
  function weekScore(wk) {
    const snaps = Storage.get().dailySnapshots || {};
    const today = UI.todayKey();
    const vals = App.weekRange(wk).days.filter(d => d <= today).map(d => snaps[d]).filter(v => typeof v === 'number');
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  }

  // Veredicto: el primero que aplique (récord → alza → sólida → a medias → difícil)
  function verdictFor(wk) {
    const score = weekScore(wk);
    const prev = weekScore(shiftWeek(wk, -1));
    const before = [];
    for (let i = 1; i <= 11; i++) { const v = weekScore(shiftWeek(wk, -i)); if (v !== null) before.push(v); }
    const record = Math.max(...[score, ...before].filter(v => v !== null), 0);
    let kind, text;
    if (score === null) { kind = 'none'; text = 'Sin registros esta semana'; }
    else if (before.length && score > Math.max(...before)) { kind = 'record'; text = '¡Nueva mejor semana!'; }
    else if (prev !== null && score > prev) { kind = 'up'; text = 'Semana en alza'; }
    else if (score >= 80) { kind = 'solid'; text = 'Semana sólida'; }
    else if (score >= 50) { kind = 'half'; text = 'Semana a medias'; }
    else { kind = 'hard'; text = 'Semana difícil · el lunes empieza otra'; }
    return { score, prev, record, kind, text, delta: (score !== null && prev !== null) ? score - prev : null };
  }

  // Cumplimiento de cada hábito en la semana, sobre sus días programados
  // (sin vacaciones ni días previos a crearlo; hoy cuenta solo si ya se cumplió)
  function habitWeek(h, r) {
    const today = UI.todayKey();
    const born = h.createdAt ? UI.localDateKey(new Date(h.createdAt)) : null;
    const hist = new Set(h.history || []);
    let scheduled = 0, done = 0;
    r.days.forEach(dk => {
      if (dk > today || (born && dk < born) || Vacation.isDateInVacation(dk)) return;
      if (!Habits.countsForDate(h, keyDate(dk))) return;
      if (dk === today && !hist.has(dk)) return;
      scheduled++;
      if (hist.has(dk)) done++;
    });
    return { h, scheduled, done };
  }

  // Gasto (sin Ahorro) entre dos fechas, con su categoría principal
  function spending(from, to) {
    const byCat = {};
    let total = 0;
    (Storage.get().movements || []).forEach(m => {
      if (!Finance.isTrackedExpense(m) || m.category === 'inversion') return;
      if (!m.date || m.date < from || m.date > to) return;
      total += m.amount || 0;
      byCat[m.category] = (byCat[m.category] || 0) + (m.amount || 0);
    });
    const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
    return { total, top: top ? { cat: Finance.getExpenseCategory(top[0]), amount: top[1] } : null };
  }

  // Presupuesto mensual a una fecha: % usado vs % del mes transcurrido
  function budgetAt(refKey) {
    const budget = (Storage.get().settings || {}).monthlyBudget;
    if (!(budget > 0)) return null;
    const d = keyDate(refKey);
    const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const spent = spending(refKey.slice(0, 8) + '01', refKey).total;
    return { budget, spent, usedPct: Math.round(spent / budget * 100), monthPct: Math.round(d.getDate() / days * 100) };
  }

  // Proyección lineal de una meta mensual/anual con objetivo numérico
  function projection(g) {
    const r = Goals.periodRange(g.horizon);
    const cur = g.current || 0;
    const rate = cur / r.elapsed;
    const projected = rate * r.total;
    const unit = g.unit ? ' ' + g.unit : '';
    if (cur > 0 && projected >= g.target) {
      const at = new Date(r.start);
      at.setDate(at.getDate() + Math.ceil(g.target / rate) - 1);
      return { ok: true, text: g.horizon === 'month' ? `llegas el día ${at.getDate()}` : `llegas en ${MONTHS_LONG[at.getMonth()]}` };
    }
    return { ok: false, text: `quedarías en ${fmt1(projected)}${unit}` };
  }

  // ---- Bloques ----
  function achievements(wk, r, isRecent, habitRows) {
    const s = Storage.get();
    const out = [];
    const weekGoals = s.goals.filter(g => g.horizon === 'week' && UI.weekKey(new Date(g.createdAt)) === wk);
    const goalsDone = weekGoals.filter(g => g.done).length;
    if (goalsDone > 0) out.push(['🎯', `${goalsDone} de ${weekGoals.length} ${weekGoals.length === 1 ? 'meta semanal' : 'metas semanales'}`]);

    // Rachas (con el estado actual: solo para la semana en curso o la recién terminada)
    if (isRecent) {
      s.habits.filter(h => !h.archived).map(h => {
        const streak = Habits.calcStreak(h);
        const weekly = Habits.hasWeeklyMin(h);
        return { h, streak, weekly, best: Habits.calcBestStreak(h), score: weekly ? streak * 7 : streak };
      })
        .filter(x => x.weekly ? x.streak >= 2 : x.streak >= 7)
        .sort((a, b) => b.score - a.score)
        .slice(0, 2)
        .forEach(x => out.push(['🔥', `${x.h.name}: racha de ${x.streak} ${x.weekly ? 'semanas' : 'días'}${x.streak >= x.best ? ' · récord' : ''}`]));
    }

    const perfect = habitRows.filter(x => x.scheduled > 0 && x.done === x.scheduled);
    if (perfect.length) {
      out.push(['✨', perfect.length === 1
        ? `${perfect[0].h.name} al 100%`
        : `${perfect.length} hábitos al 100%: ${perfect.map(x => x.h.name).join(', ')}`]);
    }

    const tasksDone = s.tasks.filter(t => t.done && t.doneAt && (() => { const k = UI.localDateKey(new Date(t.doneAt)); return k >= r.start && k <= r.end; })()).length;
    if (tasksDone > 0) out.push(['✅', `${tasksDone} ${tasksDone === 1 ? 'tarea completada' : 'tareas completadas'}`]);

    const ref = r.end < UI.todayKey() ? r.end : UI.todayKey();
    const b = budgetAt(ref);
    if (b && b.usedPct <= b.monthPct) out.push(['💰', `Gasto bajo presupuesto: ${b.usedPct}% usado con ${b.monthPct}% del mes`]);
    return out.slice(0, 5);
  }

  const block = (title, inner, cls = '') => `
      <div class="ws-block ${cls}">
        <div class="ws-block-title">${title}</div>
        ${inner}
      </div>`;

  function render() {
    const c = document.getElementById('week-summary-content');
    if (!isLive(c) || !currentWk) return;
    const s = Storage.get();
    const wk = currentWk;
    const r = App.weekRange(wk);
    const today = UI.todayKey();
    const isCurrent = wk === UI.weekKey();
    const isRecent = isCurrent || wk === shiftWeek(UI.weekKey(), -1);
    const v = verdictFor(wk);
    const habitRows = s.habits.filter(h => !h.archived).map(h => habitWeek(h, r));

    // a + b) Encabezado y puntaje
    const pct = v.score === null ? 0 : v.score;
    const deltaHTML = v.delta === null ? '' : (v.delta >= 0
      ? `<span class="ws-delta up">+${v.delta} pts vs semana pasada</span>`
      : `<span class="ws-delta down">−${Math.abs(v.delta)} pts vs semana pasada</span>`);
    const hero = `
      <div class="ws-hero ws-${v.kind}">
        <div class="ws-range">${rangeLabel(wk)}${isCurrent ? ' <span class="ws-live">en curso</span>' : ''}</div>
        <div class="ws-ring-wrap">
          <svg class="ws-ring" viewBox="0 0 128 128" aria-hidden="true">
            <circle class="ws-ring-track" cx="64" cy="64" r="${RING_R}"></circle>
            <circle class="ws-ring-bar" cx="64" cy="64" r="${RING_R}" stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${(RING_C * (1 - pct / 100)).toFixed(2)}"></circle>
          </svg>
          <div class="ws-score"><span class="ws-score-num">${v.score === null ? '—' : v.score + '%'}</span><span class="ws-score-lbl">puntaje</span></div>
        </div>
        <div class="ws-verdict">${v.text}</div>
        <div class="ws-compare">${deltaHTML}<span class="ws-best">Récord 12 semanas: ${v.record}%</span></div>
      </div>`;

    // c) Logros
    const ach = achievements(wk, r, isRecent, habitRows);
    const achHTML = ach.length ? block('Logros', `<div class="ws-ach-list">${ach.map(([ic, t]) => `<div class="ws-ach"><span class="ws-ach-icon">${ic}</span><span>${escapeHtml(t)}</span></div>`).join('')}</div>`, 'ws-achievements') : '';

    // e) Metas a este ritmo (estado actual: solo semana en curso o recién terminada)
    let projHTML = '';
    if (isRecent) {
      const goals = s.goals.filter(g => (g.horizon === 'month' || g.horizon === 'year') && !g.archived && !g.done && g.target > 0);
      if (goals.length) {
        projHTML = block('Metas a este ritmo', goals.map(g => {
          const p = projection(g);
          return `<div class="ws-proj"><span class="ws-row-name">${escapeHtml(g.name)}</span><span class="ws-proj-txt ${p.ok ? 'ok' : ''}">${escapeHtml(p.text)}</span></div>`;
        }).join(''));
      }
    }

    // f) Finanzas de la semana
    const lastDay = r.end < today ? r.end : today;
    const sp = spending(r.start, lastDay);
    const bud = budgetAt(lastDay);
    const budCls = bud ? (bud.usedPct > 100 ? 'over' : (bud.usedPct > bud.monthPct ? 'warn' : 'ok')) : '';
    const finHTML = block('Finanzas de la semana', `
        <div class="ws-fin-main"><span class="ws-fin-num">${Finance.formatCLP(sp.total)}</span><span class="ws-fin-lbl">gastado</span></div>
        ${sp.top ? `<div class="ws-fin-line">Principal: ${sp.top.cat.icon} ${escapeHtml(sp.top.cat.name)} · ${Finance.formatCLP(sp.top.amount)}</div>` : ''}
        ${bud ? `<div class="ws-fin-line ws-budget ${budCls}">Presupuesto: ${bud.usedPct}% usado · ${bud.monthPct}% del mes</div>` : ''}`);

    // g) Bienestar (solo si hay cierres diarios con datos)
    const cl = r.days.map(d => (s.closures || {})[d]).filter(Boolean);
    const avg = f => { const xs = cl.map(e => e[f]).filter(x => typeof x === 'number'); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
    const wb = [['⚡', 'Energía', avg('energy'), '/5'], ['😮‍💨', 'Estrés', avg('stress'), '/5'], ['💤', 'Sueño', avg('sleep'), ' h']].filter(x => x[2] !== null);
    const wbHTML = wb.length ? block('Bienestar', `<div class="ws-wb">${wb.map(([ic, l, val, u]) => `
        <div class="ws-wb-item"><span class="ws-wb-val">${fmt1(val)}${u}</span><span class="ws-wb-lbl">${ic} ${l}</span></div>`).join('')}</div>`) : '';

    c.innerHTML = hero + achHTML + projHTML + finHTML + wbHTML;
    return v;
  }

  // Abre el resumen de una semana (weekKey). Celebración breve si es récord.
  function open(wk) {
    currentWk = wk || UI.weekKey();
    UI.go('week-summary');
    const v = render();
    if (v && v.kind === 'record') {
      UI.buzz(30);
      UI.toast('¡Nueva mejor semana! 🎉');
    }
  }

  return { open, render, weekScore, verdictFor, rangeLabel };
})();
