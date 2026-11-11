/* ============================================
   FINANCE (solo gastos y ahorro: pagos programados y gastos registrados)
   ============================================ */
const Finance = (() => {

  // Categorías de gastos
  const EXPENSE_CATEGORIES = [
    { id: 'servicios',    name: 'Servicios básicos', icon: '🔌' },
    { id: 'vivienda',     name: 'Vivienda',          icon: '🏠' },
    { id: 'alimentacion', name: 'Alimentación',      icon: '🍽️' },
    { id: 'transporte',   name: 'Transporte',        icon: '🚗' },
    { id: 'salud',        name: 'Salud',             icon: '💊' },
    { id: 'ocio',         name: 'Ocio',              icon: '🎮' },
    { id: 'suscripciones',name: 'Suscripciones',     icon: '🔄' },
    { id: 'educacion',    name: 'Educación',         icon: '📚' },
    { id: 'deudas',       name: 'Deudas',            icon: '💳' },
    { id: 'vestuario',    name: 'Vestuario',         icon: '👕' },
    { id: 'mascotas',     name: 'Mascotas',          icon: '🐾' },
    { id: 'regalos',      name: 'Regalos',           icon: '🎁' },
    { id: 'tecnologia',   name: 'Tecnología',        icon: '💻' },
    { id: 'inversion',    name: 'Ahorro',            icon: '🏦' }, // id histórico: no cambiar
    { id: 'otros',        name: 'Otros',             icon: '📦' },
  ];

  // Categoría de ahorro (id legado 'inversion'): se suma aparte de lo gastado
  const SAVINGS_CAT = 'inversion';
  const isSavings = m => m.category === SAVINGS_CAT;

  // Finanzas es solo seguimiento de gastos. Los ingresos y los ajustes de saldo
  // son datos legados: se conservan en el estado (export/import) pero ninguna
  // vista, total ni gráfico los considera.
  function isTrackedExpense(m) {
    return m.type === 'expense' && !m.isAdjustment && m.category !== 'ajuste';
  }

  // Recurrencias para gastos (puntual = solo evento, los otros son configurables y se repiten)
  const RECURRENCES = [
    { id: 'once',      name: 'Puntual',     short: 'Puntual' },
    { id: 'monthly',   name: 'Mensual',     short: 'Mensual' },
    { id: 'quarterly', name: 'Trimestral',  short: 'Trimestral' },
    { id: 'yearly',    name: 'Anual',       short: 'Anual' },
  ];

  // Sub-tabs (orden visible)
  const SUB_TABS = [
    { id: 'scheduled', label: 'Pagos programados' },
    { id: 'once',      label: 'Puntuales' },
    { id: 'archive',   label: 'Archivo' },
    { id: 'plan',      label: 'Plan' },
  ];

  let activeSubTab = 'scheduled'; // por defecto: pagos programados (recurrentes)

  function getExpenseCategory(id) {
    return EXPENSE_CATEGORIES.find(c => c.id === id) || EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1];
  }
  function getRecurrence(id) {
    return RECURRENCES.find(r => r.id === id) || RECURRENCES[0];
  }

  function formatCLP(n) {
    if (n == null || isNaN(n)) return '';
    return '$' + Math.round(Number(n)).toLocaleString('es-CL');
  }

  // ── Montos en inputs de texto con teclado numérico y miles con punto (CLP) ──
  function parseMoney(str) {
    const digits = String(str == null ? '' : str).replace(/\D/g, '');
    return digits ? Number(digits) : null;
  }
  function moneyText(n) {
    if (n == null || isNaN(n)) return '';
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
  function bindMoneyInput(el, onInput) {
    el.addEventListener('input', () => {
      const n = parseMoney(el.value);
      el.value = moneyText(n);
      if (onInput) onInput(n);
    });
  }

  // ── Plan: presupuesto mensual, presupuesto por categoría y meta de ahorro ──
  function getPlan() {
    const st = Storage.get().settings || {};
    return {
      budget: st.monthlyBudget > 0 ? st.monthlyBudget : null,
      goal: st.monthlySavingsGoal > 0 ? st.monthlySavingsGoal : null,
      catBudgets: st.categoryBudgets || {},
    };
  }

  // Nivel del presupuesto: neutro < 80% · ámbar 80–100% · rojo > 100%
  function budgetLevel(pct) { return pct > 100 ? 'over' : (pct >= 80 ? 'warn' : 'ok'); }

  // Barra de progreso (animada por js/animate.js vía .fin-bar-fill)
  function progressRow(label, value, total, opts = {}) {
    const ratio = total > 0 ? (value / total) * 100 : 0;
    const pct = Math.round(ratio);
    const level = opts.savings ? 'savings' : budgetLevel(ratio);
    const alert = level === 'over' ? `<div class="fin-prog-alert">Excedido por ${formatCLP(value - total)}</div>` : '';
    return `
      <div class="fin-prog ${level}">
        <div class="fin-prog-top">
          <span class="fin-prog-label">${label}</span>
          <span class="fin-prog-pct">${pct}%</span>
        </div>
        <div class="fin-bar"><div class="fin-bar-fill" style="width:${Math.min(100, Math.round(ratio * 10) / 10)}%"></div></div>
        ${alert}
      </div>`;
  }
  const budgetRow = (spent, budget) => progressRow(`Gastado ${formatCLP(spent)} de ${formatCLP(budget)}`, spent, budget);
  const savingsRow = (saved, goal) => progressRow(`Ahorro ${formatCLP(saved)} de ${formatCLP(goal)}`, saved, goal, { savings: true });

  // Abre Movimientos › Plan
  function openPlan() {
    activeSubTab = 'plan';
    UI.go('finance-settings');
  }

  // Distancia en días desde hoy hasta el próximo día de pago (1-31). Para ordenar por proximidad.
  function daysUntilDueDay(dueDay) {
    if (!dueDay) return 9999;
    const today = new Date();
    const cur = today.getDate();
    const year = today.getFullYear();
    const month = today.getMonth();
    // Si ya pasó el día este mes → próximo mes
    if (cur > dueDay) {
      const nextMonth = new Date(year, month + 1, Math.min(dueDay, 28));
      // Ajustar a dueDay real (clamp si el mes no lo tiene)
      const daysInNext = new Date(year, month + 2, 0).getDate();
      nextMonth.setDate(Math.min(dueDay, daysInNext));
      return Math.round((nextMonth - today) / 86400000);
    } else {
      return dueDay - cur;
    }
  }

  // ====== RENDER PRINCIPAL ======
  function render() {
    renderSubTabs();
    renderActiveList();
  }

  function renderSubTabs() {
    const c = document.getElementById('finance-subtabs');
    if (!c) return;
    c.innerHTML = SUB_TABS.map(t =>
      `<button class="chip ${activeSubTab === t.id ? 'active' : ''}" data-finance-subtab="${t.id}">${t.label}</button>`
    ).join('');
    c.querySelectorAll('[data-finance-subtab]').forEach(btn => {
      btn.addEventListener('click', () => {
        activeSubTab = btn.dataset.financeSubtab;
        render();
      });
    });
  }

  function renderActiveList() {
    const c = document.getElementById('finance-list');
    if (!c) return;
    if (activeSubTab === 'once') {
      renderOnceExpensesList(c);
    } else if (activeSubTab === 'archive') {
      // El archivo histórico se renderiza dentro de su propio contenedor,
      // que renderArchive() busca por id.
      c.innerHTML = '<div id="finance-archive-list"></div>';
      renderArchive();
    } else if (activeSubTab === 'plan') {
      renderPlan(c);
    } else {
      renderScheduledList(c);
    }
  }

  // Pagos programados: TODOS los recurrentes juntos, ordenados por proximidad
  // de vencimiento. La frecuencia se muestra como etiqueta en cada ítem.
  function renderScheduledList(c) {
    const list = (Storage.get().recurringExpenses || []).slice();
    if (list.length === 0) {
      c.innerHTML = '<div class="empty">Sin pagos programados · toca "+" y usa "Más opciones" para crear uno</div>';
      return;
    }
    list.sort((a, b) => {
      const da = a.dueDay ? daysUntilDueDay(a.dueDay) : 9999;
      const db = b.dueDay ? daysUntilDueDay(b.dueDay) : 9999;
      if (da !== db) return da - db;
      return (a.name || '').localeCompare(b.name || '');
    });
    c.innerHTML = list.map(re => renderRecurringItem(re)).join('');
    bindRecurringActions(c);
  }

  // --- Movimientos puntuales: gastos puntuales + pagos hechos a gastos recurrentes
  // (ambos comparten naturaleza de "movimiento real registrado" y deben ser editables/eliminables)
  function renderOnceExpensesList(c) {
    const { start, end } = getMonthRange(getCurrentMonthKey());
    const list = monthExpenses(start, end);
    if (list.length === 0) {
      c.innerHTML = '<div class="empty">Sin gastos este mes · los de meses anteriores están en Archivo</div>';
      return;
    }
    c.innerHTML = sortByRecent(list).map(m => renderMovementItem(m)).join('');
    bindMovementActions(c);
  }

  // Gastos registrados (sin ingresos ni ajustes legados) dentro de un rango de fechas
  function monthExpenses(start, end) {
    return (Storage.get().movements || []).filter(m =>
      isTrackedExpense(m) && m.date && m.date >= start && m.date <= end
    );
  }

  // Más reciente arriba; mismo día: último ingresado primero
  function sortByRecent(list) {
    return list.slice().sort((a, b) => {
      const dateCmp = (b.date || '').localeCompare(a.date || '');
      if (dateCmp !== 0) return dateCmp;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  const sumAmount = list => list.reduce((s, m) => s + (m.amount || 0), 0);

  // --- Plan: presupuesto mensual, meta de ahorro y presupuesto por categoría.
  // Cada campo se guarda al salir de él (evento change).
  function renderPlan(c) {
    const st = Storage.get().settings;
    const catBudgets = st.categoryBudgets || {};
    const moneyField = (attrs, value, placeholder) =>
      `<span class="plan-money"><span class="plan-currency">$</span><input type="text" inputmode="numeric" autocomplete="off" ${attrs} placeholder="${placeholder}" value="${moneyText(value)}" /></span>`;
    const cats = EXPENSE_CATEGORIES.filter(cat => cat.id !== SAVINGS_CAT);
    c.innerHTML = `
      <div class="plan-form">
        <div class="plan-field">
          <label for="plan-budget">Presupuesto mensual</label>
          ${moneyField('id="plan-budget" data-plan="monthlyBudget"', st.monthlyBudget, 'Sin presupuesto')}
          <p class="plan-help">Tope de gasto del mes, sin contar Ahorro.</p>
        </div>
        <div class="plan-field">
          <label for="plan-goal">Meta de ahorro mensual</label>
          ${moneyField('id="plan-goal" data-plan="monthlySavingsGoal"', st.monthlySavingsGoal, 'Sin meta')}
          <p class="plan-help">Lo que quieres apartar cada mes en la categoría 🏦 Ahorro.</p>
        </div>
        <div class="plan-section-title">Presupuesto por categoría (opcional)</div>
        <p class="plan-help">Vacío = sin límite.</p>
        <div class="plan-cats">
          ${cats.map(cat => `
            <label class="plan-cat">
              <span class="plan-cat-name">${cat.icon} ${cat.name}</span>
              ${moneyField(`data-plan-cat="${cat.id}"`, catBudgets[cat.id], 'Sin límite')}
            </label>`).join('')}
        </div>
      </div>`;
    c.querySelectorAll('input').forEach(inp => {
      bindMoneyInput(inp);
      inp.addEventListener('change', () => savePlanField(inp));
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
    });
  }

  function savePlanField(inp) {
    const s = Storage.get();
    const n = parseMoney(inp.value);
    const val = n > 0 ? n : null;
    if (inp.dataset.plan) {
      s.settings[inp.dataset.plan] = val;
      const what = inp.dataset.plan === 'monthlyBudget' ? 'Presupuesto mensual' : 'Meta de ahorro';
      UI.toast(val ? `${what} guardado · ${formatCLP(val)}` : `${what} eliminado`);
    } else {
      const cat = getExpenseCategory(inp.dataset.planCat);
      s.settings.categoryBudgets = s.settings.categoryBudgets || {};
      if (val) s.settings.categoryBudgets[inp.dataset.planCat] = val;
      else delete s.settings.categoryBudgets[inp.dataset.planCat];
      UI.toast(val ? `${cat.name} · límite ${formatCLP(val)}` : `${cat.name} · sin límite`);
    }
    inp.value = moneyText(val);
    Storage.save();
    renderTodayPending();
  }

  // --- Gastos recurrentes (recurringExpenses por tipo, ordenados por proximidad a fecha de pago)

  // ===== Item de gasto recurrente =====
  function renderRecurringItem(re) {
    const cat = getExpenseCategory(re.category);
    const rec = getRecurrence(re.recurrence);
    const amountLabel = re.defaultAmount
      ? `<span class="re-amount">${formatCLP(re.defaultAmount)}</span>`
      : '<span class="re-amount-empty">Variable</span>';
    const dayLabel = (re.recurrence === 'once' && re.dueDate)
      ? `Vence ${new Date(re.dueDate + 'T12:00:00').toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }).replace('.', '')}`
      : (re.dueDay
        ? (re.recurrence === 'monthly' ? `Día ${re.dueDay}` : `Día ${re.dueDay} del mes de pago`)
        : 'Sin fecha definida');
    // Proximidad como hint sutil
    let proximityLabel = '';
    if (re.dueDay && re.recurrence === 'monthly' && !re.installmentsDone) {
      const d = daysUntilDueDay(re.dueDay);
      if (d === 0) proximityLabel = '<span class="re-proximity due-today">Hoy</span>';
      else if (d <= 3) proximityLabel = `<span class="re-proximity soon">En ${d}d</span>`;
      else if (d <= 7) proximityLabel = `<span class="re-proximity">En ${d}d</span>`;
    }
    // Cuotas: "Cuota 5/24" o "Completada 24/24" (cualquier categoría)
    let instLabel = '';
    if (re.installmentsTotal) {
      instLabel = re.installmentsDone
        ? `<span class="re-inst done">✓ ${re.installmentsTotal}/${re.installmentsTotal}</span>`
        : `<span class="re-inst">Cuota ${re.installmentsCurrent || 1}/${re.installmentsTotal}</span>`;
    }
    return `
      <div class="recurring-expense-item ${re.installmentsDone ? 'is-done' : ''}" data-id="${re.id}" data-kind="recurring">
        <div class="re-main">
          <div class="re-name">${cat.icon} ${escapeHtml(re.name)} ${proximityLabel}</div>
          <div class="re-meta">
            <span class="re-rec">${rec.name}</span>
            <span class="re-cat">${cat.name}</span>
            ${amountLabel}
            ${instLabel || `<span class="re-due">${dayLabel}</span>`}
          </div>
        </div>
        <div class="re-actions">
          <button class="re-edit" data-action="edit" aria-label="Editar">✎</button>
          <button class="re-delete" data-action="delete" aria-label="Eliminar">×</button>
        </div>
      </div>
    `;
  }

  // ===== Item de movimiento (gasto registrado; Ahorro se marca aparte) =====
  function renderMovementItem(m, opts = {}) {
    const cat = getExpenseCategory(m.category);
    const dateLabel = m.date
      ? new Date(m.date + 'T12:00:00').toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: '2-digit' }).toUpperCase()
      : '—';
    const amountClass = isSavings(m) ? 're-amount savings' : 're-amount expense';
    const noteBlock = m.note ? `<div class="task-note">${escapeHtml(m.note)}</div>` : '';
    const actionsBlock = opts.readonly ? '' : `
        <div class="re-actions">
          <button class="re-edit" data-action="edit" aria-label="Editar">✎</button>
          <button class="re-delete" data-action="delete" aria-label="Eliminar">×</button>
        </div>`;
    return `
      <div class="recurring-expense-item ${opts.readonly ? 'readonly' : ''}" data-id="${m.id}" data-kind="movement">
        <div class="re-main">
          <div class="re-name">${cat.icon} ${escapeHtml(m.name)}</div>
          <div class="re-meta">
            <span class="re-due">${dateLabel}</span>
            <span class="re-cat">${cat.name}</span>
            <span class="${amountClass}">${formatCLP(m.amount)}</span>
          </div>
          ${noteBlock}
        </div>
        ${actionsBlock}
      </div>
    `;
  }

  function bindRecurringActions(c) {
    c.querySelectorAll('[data-kind="recurring"]').forEach(el => {
      const id = el.dataset.id;
      el.querySelector('[data-action="edit"]').addEventListener('click', (e) => {
        e.stopPropagation();
        openMovementModal({ editRecurringId: id });
      });
      el.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteRecurring(id);
      });
    });
  }

  function bindMovementActions(c) {
    c.querySelectorAll('[data-kind="movement"]').forEach(el => {
      const id = el.dataset.id;
      const editBtn = el.querySelector('[data-action="edit"]');
      const delBtn = el.querySelector('[data-action="delete"]');
      // Si el item está en modo readonly no tiene botones, salir
      if (!editBtn || !delBtn) return;
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openMovementModal({ editMovementId: id });
      });
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteMovement(id);
      });
    });
  }

  // Categorías de gasto ordenadas por uso (frecuencia en movements); a igualdad,
  // mantiene el orden de EXPENSE_CATEGORIES (sort estable).
  function categoriesByUse() {
    const count = {};
    (Storage.get().movements || []).forEach(m => {
      if (isTrackedExpense(m)) count[m.category] = (count[m.category] || 0) + 1;
    });
    return EXPENSE_CATEGORIES.slice().sort((a, b) => (count[b.id] || 0) - (count[a.id] || 0));
  }

  // ====== MODAL DE GASTO (registro rápido) ======
  // Solo gastos (type 'expense'). Monto primero, categoría en chips, nombre
  // opcional (si queda vacío se usa el de la categoría) y lo menos usado
  // (repetición, cuotas, nota) bajo "Más opciones". Opciones:
  //  - editRecurringId: editar un recurringExpense existente
  //  - editMovementId: editar un movement existente
  function openMovementModal(opts = {}) {
    const state = Storage.get();
    let editing = null;       // un movement (gasto puntual o pago registrado)
    let editingRecurring = null; // un recurringExpense

    if (opts.editMovementId) {
      editing = (state.movements || []).find(x => x.id === opts.editMovementId) || null;
    }
    if (opts.editRecurringId) {
      editingRecurring = (state.recurringExpenses || []).find(x => x.id === opts.editRecurringId) || null;
    }
    const src = editing || editingRecurring;

    // Estado del modal (mutable mientras está abierto)
    const modalState = {
      recurrence: editingRecurring ? editingRecurring.recurrence : 'once',
      category: src ? src.category : null,
    };

    const isEditingSomething = !!src;
    const title = isEditingSomething ? 'Editar gasto' : 'Nuevo gasto';
    const okText = isEditingSomething ? 'Guardar cambios' : 'Guardar';

    // Chips: las 6 categorías más usadas a la vista; el resto tras "Más"
    const ordered = categoriesByUse();
    const top = ordered.slice(0, 6);
    const rest = ordered.slice(6);
    const chip = c => `<button type="button" class="qe-chip ${modalState.category === c.id ? 'active' : ''}" data-cat="${c.id}">${c.icon} ${c.name}</button>`;
    const showRest = !!modalState.category && rest.some(c => c.id === modalState.category);

    const amountInit = editing ? editing.amount : (editingRecurring ? editingRecurring.defaultAmount : null);
    const noteInit = src && src.note ? src.note : '';
    // "Más opciones" abierto al editar algo con nota o repetición
    const moreOpen = !!noteInit || !!editingRecurring;

    UI.openModal({
      title,
      okText,
      bodyHTML: `
        <div class="qe-amount-wrap">
          <label id="mv-amount-label" for="mv-amount">Monto (CLP)</label>
          <div class="qe-amount-field">
            <span class="qe-currency">$</span>
            <input type="text" id="mv-amount" class="qe-amount" inputmode="numeric" autocomplete="off" placeholder="0"
              value="${moneyText(amountInit)}" />
          </div>
          <p class="qe-error" id="mv-amount-error" hidden></p>
          <p class="qe-help" id="mv-amount-help"></p>
        </div>

        <label>Categoría</label>
        <div class="qe-chips" id="mv-cat-chips">
          ${top.map(chip).join('')}
          ${rest.length ? `<button type="button" class="qe-chip qe-chip-more" id="mv-cat-more" aria-expanded="${showRest}">${showRest ? 'Menos ▴' : 'Más ▾'}</button>` : ''}
        </div>
        <div class="qe-chips" id="mv-cat-extra" ${showRest ? '' : 'hidden'}>${rest.map(chip).join('')}</div>
        <p class="qe-error" id="mv-cat-error" hidden></p>

        <div class="qe-row">
          <div class="qe-name">
            <label for="mv-name">Nombre <span class="qe-opt">(opcional)</span></label>
            <input type="text" id="mv-name" placeholder="Se usa la categoría"
              value="${src ? escapeAttr(src.name) : ''}" />
          </div>
          <div class="qe-date" id="mv-date-wrap">
            <label id="mv-date-label" for="mv-date">Fecha</label>
            <input type="date" id="mv-date" value="${(editing && editing.date) || (editingRecurring && editingRecurring.recurrence === 'once' && editingRecurring.dueDate) || UI.todayKey()}" />
          </div>
        </div>
        <p class="qe-help" id="mv-date-help" hidden>Fecha futura: quedará como pago programado pendiente (aparece en Finanzas de Enfoque con "Pagar").</p>

        <button type="button" class="qe-more-toggle" id="mv-more-toggle" aria-expanded="${moreOpen}">
          Más opciones <span class="qe-more-arrow">${moreOpen ? '▴' : '▾'}</span>
        </button>
        <div class="qe-more" id="mv-more" ${moreOpen ? '' : 'hidden'}>
          <div id="mv-recurrence-wrap" ${editing ? 'hidden' : ''}>
            <label for="mv-recurrence">Repetición</label>
            <select id="mv-recurrence">
              ${RECURRENCES.map(r => `<option value="${r.id}" ${modalState.recurrence === r.id ? 'selected' : ''} ${editingRecurring && editingRecurring.recurrence !== 'once' && r.id === 'once' ? 'disabled' : ''}>${r.id === 'once' ? 'No se repite' : r.name}</option>`).join('')}
            </select>
          </div>

          <div id="mv-due-wrap" hidden>
            <label id="mv-due-label">Fecha de referencia del pago</label>
            <input type="date" id="mv-due-date"
              value="${editingRecurring && editingRecurring.dueDate ? editingRecurring.dueDate : (editingRecurring && editingRecurring.dueDay ? deriveDueDateFromLegacy(editingRecurring) : UI.todayKey())}" />
            <p id="mv-due-help" class="qe-help"></p>
          </div>

          <div id="mv-inst-toggle-wrap" hidden>
            <label style="display:flex;align-items:center;gap:10px;cursor:pointer;margin-top:4px">
              <input type="checkbox" id="mv-inst-toggle" style="width:18px;height:18px;accent-color:var(--primary)" />
              <span style="font-weight:600">Compra en cuotas</span>
            </label>
          </div>

          <div id="mv-installments-wrap" hidden>
            <div style="display:flex;gap:8px">
              <div style="flex:1">
                <label>Cuota actual</label>
                <input type="number" id="mv-inst-current" inputmode="numeric" min="1" step="1" placeholder="Ej: 5"
                  value="${editingRecurring && editingRecurring.installmentsCurrent != null ? editingRecurring.installmentsCurrent : ''}"
                  style="font-family:var(--font-mono)" />
              </div>
              <div style="flex:1">
                <label>Total de cuotas</label>
                <input type="number" id="mv-inst-total" inputmode="numeric" min="1" step="1" placeholder="Ej: 24"
                  value="${editingRecurring && editingRecurring.installmentsTotal != null ? editingRecurring.installmentsTotal : ''}"
                  style="font-family:var(--font-mono)" />
              </div>
            </div>
            <p id="mv-inst-computed" style="color:var(--primary);font-size:12px;font-weight:600;margin-top:6px">Cuota mensual: —</p>
            <p class="qe-help">La cuota se calcula como monto total ÷ total de cuotas. Al pagar la última, deja de repetirse.</p>
          </div>

          <label for="mv-note">Nota (opcional)</label>
          <textarea id="mv-note" placeholder="Detalles, observaciones">${escapeHtml(noteInit)}</textarea>
        </div>
      `,
      onSave: () => saveMovement(modalState, editing, editingRecurring)
    });

    // Calcula y muestra la cuota mensual (monto total ÷ total de cuotas) en vivo.
    const updateInstComputed = () => {
      const line = document.getElementById('mv-inst-computed');
      if (!line) return;
      const toggle = document.getElementById('mv-inst-toggle');
      const totalEl = document.getElementById('mv-inst-total');
      const amountEl = document.getElementById('mv-amount');
      if (!toggle || !toggle.checked) return;
      const total = totalEl ? parseInt(totalEl.value, 10) : NaN;
      const monto = amountEl ? parseMoney(amountEl.value) : null;
      if (total > 0 && monto > 0) {
        line.textContent = `Cuota mensual: ${formatCLP(Math.round(monto / total))}`;
      } else {
        line.textContent = 'Cuota mensual: —';
      }
    };

    // Visibilidad y textos según repetición/cuotas
    const refreshUI = () => {
      const isRecurring = modalState.recurrence !== 'once';
      const dueWrap = document.getElementById('mv-due-wrap');
      const dueLabel = document.getElementById('mv-due-label');
      const dueHelp = document.getElementById('mv-due-help');
      const dateWrap = document.getElementById('mv-date-wrap');
      const amountLabel = document.getElementById('mv-amount-label');
      const amountHelp = document.getElementById('mv-amount-help');

      // Cuotas: interruptor disponible para cualquier gasto MENSUAL (no solo deudas).
      const instToggleWrap = document.getElementById('mv-inst-toggle-wrap');
      const instToggle = document.getElementById('mv-inst-toggle');
      const instWrap = document.getElementById('mv-installments-wrap');
      const showToggle = modalState.recurrence === 'monthly';
      if (instToggleWrap) instToggleWrap.hidden = !showToggle;
      if (instWrap) instWrap.hidden = !(showToggle && instToggle && instToggle.checked);
      if (!showToggle && instToggle) instToggle.checked = false;
      updateInstComputed();
      const instOn = showToggle && instToggle && instToggle.checked;

      if (isRecurring) {
        // Pago programado: sin fecha puntual, con fecha de referencia
        dateWrap.hidden = true;
        dueWrap.hidden = false;
        amountLabel.textContent = 'Monto estimado (CLP, opcional)';
        amountHelp.textContent = 'Sirve como referencia. El monto real se registra al pagar (desde la tarjeta Finanzas en Hoy).';
        if (modalState.recurrence === 'monthly') {
          dueLabel.textContent = 'Fecha de referencia';
          dueHelp.textContent = 'Selecciona una fecha. Se repetirá el mismo día cada mes (ej: día 15 cada mes).';
        } else if (modalState.recurrence === 'quarterly') {
          dueLabel.textContent = 'Fecha del primer pago';
          dueHelp.textContent = 'Selecciona una fecha. Se repetirá cada 3 meses a partir de esa fecha.';
        } else if (modalState.recurrence === 'yearly') {
          dueLabel.textContent = 'Fecha del pago anual';
          dueHelp.textContent = 'Selecciona la fecha del año. Se repetirá cada año en ese mismo día y mes.';
        }
      } else {
        dateWrap.hidden = false;
        dueWrap.hidden = true;
        amountLabel.textContent = 'Monto (CLP)';
        amountHelp.textContent = '';
      }
      // Puntual con fecha futura → pago programado puntual (no al editar un gasto ya registrado)
      const dateVal = document.getElementById('mv-date').value;
      document.getElementById('mv-date-help').hidden = isRecurring || !!editing || !(dateVal > UI.todayKey());

      // Con cuotas, el monto pasa a ser el TOTAL de la compra
      if (instOn) {
        amountLabel.textContent = 'Monto total de la compra (CLP)';
        amountHelp.textContent = 'Se divide en las cuotas indicadas. La cuota mensual se calcula abajo.';
        dueLabel.textContent = 'Fecha de pago';
        dueHelp.textContent = 'Día en que pagas cada cuota. Se repite el mismo día cada mes.';
      }
    };

    // Los elementos ya existen: UI.openModal pinta el HTML de forma síncrona
    const amountEl = document.getElementById('mv-amount');
    bindMoneyInput(amountEl, () => {
      document.getElementById('mv-amount-error').hidden = true;
      updateInstComputed();
    });

    // Chips de categoría
    document.querySelectorAll('#modal-body .qe-chip[data-cat]').forEach(btn => {
      btn.addEventListener('click', () => {
        modalState.category = btn.dataset.cat;
        document.querySelectorAll('#modal-body .qe-chip[data-cat]').forEach(b => b.classList.toggle('active', b === btn));
        document.getElementById('mv-cat-error').hidden = true;
      });
    });
    const moreCats = document.getElementById('mv-cat-more');
    if (moreCats) {
      moreCats.addEventListener('click', () => {
        const extra = document.getElementById('mv-cat-extra');
        extra.hidden = !extra.hidden;
        moreCats.textContent = extra.hidden ? 'Más ▾' : 'Menos ▴';
        moreCats.setAttribute('aria-expanded', String(!extra.hidden));
      });
    }

    // "Más opciones"
    const moreToggle = document.getElementById('mv-more-toggle');
    moreToggle.addEventListener('click', () => {
      const more = document.getElementById('mv-more');
      more.hidden = !more.hidden;
      moreToggle.setAttribute('aria-expanded', String(!more.hidden));
      moreToggle.querySelector('.qe-more-arrow').textContent = more.hidden ? '▾' : '▴';
    });

    document.getElementById('mv-date').addEventListener('change', () => refreshUI());
    const recSel = document.getElementById('mv-recurrence');
    recSel.addEventListener('change', () => {
      modalState.recurrence = recSel.value;
      refreshUI();
    });
    const instToggle = document.getElementById('mv-inst-toggle');
    instToggle.addEventListener('change', () => refreshUI());
    document.getElementById('mv-inst-total').addEventListener('input', updateInstComputed);

    // Al editar un recurrente con cuotas: interruptor encendido y monto TOTAL de la compra
    if (editingRecurring && editingRecurring.installmentsTotal) {
      instToggle.checked = true;
      const total = editingRecurring.installmentTotalAmount != null
        ? editingRecurring.installmentTotalAmount
        : (editingRecurring.defaultAmount != null ? editingRecurring.defaultAmount * editingRecurring.installmentsTotal : null);
      amountEl.value = moneyText(total);
    }

    // Enter guarda (el guardado valida monto y categoría; si falla, el modal sigue abierto)
    document.querySelectorAll('#modal-body input').forEach(inp => {
      inp.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        document.getElementById('modal-ok').click();
      });
    });

    refreshUI();
    setTimeout(() => { amountEl.focus(); }, 50);
  }

  // Lee los campos de cuotas del modal. Aplica cuando el interruptor está encendido
  // (cualquier categoría, solo gastos mensuales). Devuelve total de cuotas, cuota
  // actual, monto total de la compra y la cuota mensual calculada (total ÷ cuotas).
  function readInstallmentsFields() {
    const toggle = document.getElementById('mv-inst-toggle');
    const on = !!(toggle && toggle.checked);
    if (!on) return { total: null, current: null, totalAmount: null, perCuota: null };
    const t = document.getElementById('mv-inst-total');
    const c = document.getElementById('mv-inst-current');
    const a = document.getElementById('mv-amount');
    const total = (t && t.value.trim() !== '') ? Math.max(1, parseInt(t.value, 10)) : null;
    let current = (c && c.value.trim() !== '') ? Math.max(1, parseInt(c.value, 10)) : null;
    const totalAmount = a ? parseMoney(a.value) : null;
    if (total && !current) current = 1;                 // hay total pero no cuota → empieza en 1
    if (total && current > total) current = total;      // no exceder el total
    const perCuota = (total && totalAmount != null) ? Math.round(totalAmount / total) : null;
    return { total: total || null, current: total ? current : null, totalAmount: total ? totalAmount : null, perCuota };
  }

  function showFieldError(id, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function saveMovement(modalState, editing, editingRecurring) {
    const isRecurring = modalState.recurrence !== 'once';
    const amountEl = document.getElementById('mv-amount');
    const amount = parseMoney(amountEl.value);
    const category = modalState.category;

    // Validación inline: monto > 0 (opcional en pagos programados) y categoría
    const amountBad = !isRecurring && !(amount > 0);
    showFieldError('mv-amount-error', amountBad ? 'Ingresa un monto mayor a $0' : '');
    showFieldError('mv-cat-error', category ? '' : 'Elige una categoría');
    if (amountBad || !category) {
      if (amountBad) amountEl.focus();
      return false;
    }

    // Nombre opcional: si queda vacío, el de la categoría
    const name = document.getElementById('mv-name').value.trim() || getExpenseCategory(category).name;
    const note = document.getElementById('mv-note').value.trim() || null;

    const s = Storage.get();
    s.movements = s.movements || [];
    s.recurringExpenses = s.recurringExpenses || [];

    if (editing) {
      // Editar movement existente (gasto puntual o pago registrado)
      editing.name = name;
      editing.category = category;
      editing.amount = amount;
      editing.note = note;
      const dateEl = document.getElementById('mv-date');
      if (dateEl && dateEl.value) editing.date = dateEl.value;
      UI.toast('Gasto actualizado');
    } else if (editingRecurring) {
      // Editar recurring existente
      editingRecurring.name = name;
      editingRecurring.category = category;
      editingRecurring.recurrence = modalState.recurrence;
      editingRecurring.defaultAmount = amount;
      editingRecurring.note = note;
      // Puntual programado: su vencimiento es la Fecha del gasto
      const dueDateRaw = modalState.recurrence === 'once'
        ? (document.getElementById('mv-date').value || UI.todayKey())
        : document.getElementById('mv-due-date').value;
      if (dueDateRaw) {
        editingRecurring.dueDate = dueDateRaw;
        // dueDay derivado para compatibilidad con código que lo lee
        const [, , dd] = dueDateRaw.split('-');
        editingRecurring.dueDay = parseInt(dd, 10);
      } else {
        editingRecurring.dueDate = null;
        editingRecurring.dueDay = null;
      }
      // Cuotas (cualquier categoría, gasto mensual): total, cuota actual, monto total.
      const instE = readInstallmentsFields();
      editingRecurring.installmentsTotal = instE.total;
      editingRecurring.installmentsCurrent = instE.current;
      editingRecurring.installmentTotalAmount = instE.totalAmount;
      // Si hay cuotas, el monto por pago (defaultAmount) es la cuota calculada.
      if (instE.total) {
        editingRecurring.defaultAmount = instE.perCuota;
        if (!editingRecurring.installmentsCurrent || editingRecurring.installmentsCurrent <= instE.total) {
          editingRecurring.installmentsDone = false;
        }
      } else {
        editingRecurring.installmentsDone = false;
        editingRecurring.installmentTotalAmount = null;
      }
      activeSubTab = 'scheduled';
      UI.toast('Gasto actualizado');
    } else if (isRecurring) {
      // Nuevo pago programado
      const dueDateRaw = document.getElementById('mv-due-date').value;
      let dueDate = null, dueDay = null;
      if (dueDateRaw) {
        dueDate = dueDateRaw;
        const [, , dd] = dueDateRaw.split('-');
        dueDay = parseInt(dd, 10);
      }
      const inst = readInstallmentsFields();
      s.recurringExpenses.push({
        id: Storage.uid(),
        name, category,
        recurrence: modalState.recurrence,
        // Con cuotas, el monto por pago es la cuota (total ÷ cuotas); si no, el estimado.
        defaultAmount: inst.total ? inst.perCuota : amount,
        dueDate, dueDay,
        note,
        installmentsTotal: inst.total,
        installmentsCurrent: inst.current,
        installmentTotalAmount: inst.totalAmount,
        installmentsDone: false,
        createdAt: Date.now(),
      });
      activeSubTab = 'scheduled';
      UI.toast('Pago programado creado');
    } else if ((document.getElementById('mv-date').value || '') > UI.todayKey()) {
      // Puntual con fecha futura: pago programado puntual (pendiente hasta pagarlo)
      const dueDate = document.getElementById('mv-date').value;
      s.recurringExpenses.push({
        id: Storage.uid(),
        name, category,
        recurrence: 'once',
        defaultAmount: amount,
        dueDate, dueDay: parseInt(dueDate.slice(8, 10), 10),
        note,
        installmentsTotal: null,
        installmentsCurrent: null,
        installmentTotalAmount: null,
        installmentsDone: false,
        createdAt: Date.now(),
      });
      activeSubTab = 'scheduled';
      UI.toast(`Pago programado para el ${new Date(dueDate + 'T12:00:00').toLocaleDateString('es-CL', { day: '2-digit', month: 'short' }).replace('.', '')}`);
    } else {
      // Nuevo gasto puntual
      const date = document.getElementById('mv-date').value || UI.todayKey();
      s.movements.push({
        id: Storage.uid(),
        type: 'expense',
        name,
        category,
        amount,
        date,
        note,
        recurringExpenseId: null,
        createdAt: Date.now(),
      });
      activeSubTab = 'once';
      UI.toast(isSavings({ category }) ? 'Ahorro registrado' : 'Gasto registrado');
    }
    Storage.save();
    refreshViews();
  }

  // Tras cualquier cambio: gestión, tarjeta "Gastos" de Hoy y Estadísticas › Finanzas
  function refreshViews() {
    render();
    renderTodayPending();
    if (isLive(document.getElementById('finance-analysis-card'))) renderAnalysis();
    if (typeof App !== 'undefined' && App.refreshKPIs) App.refreshKPIs();
  }

  function deleteRecurring(id) {
    const s = Storage.get();
    const re = (s.recurringExpenses || []).find(x => x.id === id);
    if (!re) return;
    UI.confirm2({
      title: 'Eliminar gasto',
      message: `¿Eliminar "${re.name}"? Los movimientos ya registrados de este gasto se conservan.`,
      okText: 'Eliminar',
      danger: true,
      onConfirm: () => {
        s.recurringExpenses = s.recurringExpenses.filter(x => x.id !== id);
        Storage.save();
        refreshViews();
        UI.toast('Eliminado');
      }
    });
  }

  function deleteMovement(id) {
    const s = Storage.get();
    const m = (s.movements || []).find(x => x.id === id);
    if (!m) return;
    UI.confirm2({
      title: 'Eliminar gasto',
      message: `¿Eliminar "${m.name}"?`,
      okText: 'Eliminar',
      danger: true,
      onConfirm: () => {
        s.movements = s.movements.filter(x => x.id !== id);
        Storage.save();
        refreshViews();
        UI.toast('Eliminado');
      }
    });
  }

  // Atajo del botón "+" de la tarjeta Gastos en Hoy
  function openNewExpense() { openMovementModal(); }

  // ============================================
  // FECHAS Y PENDIENTES
  // ============================================

  function getCurrentMonthKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function getMonthRange(mk) {
    const [y, m] = mk.split('-').map(Number);
    const start = `${mk}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const end = `${mk}-${String(lastDay).padStart(2, '0')}`;
    return { start, end, year: y, month: m, lastDay };
  }

  // ¿Un gasto recurrente está pagado en el mes mk?
  function isRecurringPaidInMonth(re, mk) {
    const s = Storage.get();
    const movs = (s.movements || []).filter(m =>
      m.type === 'expense' && m.recurringExpenseId === re.id
    );
    if (movs.length === 0) return false;
    if (re.recurrence === 'monthly') {
      // Si el movement tiene periodMk explícito, lo respetamos (el usuario marcó qué ciclo se está pagando)
      // Si no tiene periodMk (movements legacy), usamos la fecha del movement como fallback
      return movs.some(m => {
        if (m.periodMk) return m.periodMk === mk;
        return (m.date || '').startsWith(mk);
      });
    }
    if (re.recurrence === 'quarterly') {
      // Si hay periodMk explícito, comparar directo
      const withPeriod = movs.filter(m => m.periodMk);
      if (withPeriod.some(m => m.periodMk === mk)) return true;
      // Fallback por fecha (legacy)
      const [y, m] = mk.split('-').map(Number);
      const fromDate = new Date(y, m - 3, 1);
      const toDate = new Date(y, m, 0);
      return movs.filter(m => !m.periodMk).some(mv => {
        if (!mv.date) return false;
        const d = new Date(mv.date + 'T12:00:00');
        return d >= fromDate && d <= toDate;
      });
    }
    if (re.recurrence === 'yearly') {
      const withPeriod = movs.filter(m => m.periodMk);
      if (withPeriod.some(m => m.periodMk === mk)) return true;
      // Fallback por fecha (legacy): mismo año
      const year = mk.split('-')[0];
      return movs.filter(m => !m.periodMk).some(m => (m.date || '').startsWith(year + '-'));
    }
    return false;
  }

  // Para datos legacy que solo tienen dueDay numérico, derivar una dueDate
  // usando el mes en curso como referencia (mejor que nada para los gastos viejos).
  function deriveDueDateFromLegacy(re) {
    if (!re || !re.dueDay) return UI.todayKey();
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth() + 1;
    const daysInMonth = new Date(y, m, 0).getDate();
    const day = Math.min(re.dueDay, daysInMonth);
    return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function getDueDateForRecurringInMonth(re, mk) {
    // Si tiene dueDate (fecha completa de referencia), proyectarla al mes pedido
    // tomando el día y mes según el tipo de recurrencia.
    if (re.dueDate) {
      const [refY, refM, refD] = re.dueDate.split('-').map(Number);
      const [y, m] = mk.split('-').map(Number);
      if (re.recurrence === 'yearly') {
        // Anual: solo aplica si el mes coincide con el mes de referencia
        if (m !== refM) return null;
        const daysInMonth = new Date(y, m, 0).getDate();
        const day = Math.min(refD, daysInMonth);
        return `${mk}-${String(day).padStart(2, '0')}`;
      }
      if (re.recurrence === 'quarterly') {
        // Trimestral: aplica solo si la diferencia entre el mes pedido y el de referencia es múltiplo de 3
        const diff = (y - refY) * 12 + (m - refM);
        if (diff < 0 || diff % 3 !== 0) return null;
        const daysInMonth = new Date(y, m, 0).getDate();
        const day = Math.min(refD, daysInMonth);
        return `${mk}-${String(day).padStart(2, '0')}`;
      }
      // Mensual: mismo día cada mes
      const daysInMonth = new Date(y, m, 0).getDate();
      const day = Math.min(refD, daysInMonth);
      return `${mk}-${String(day).padStart(2, '0')}`;
    }
    // Legacy: solo dueDay
    if (!re.dueDay) return null;
    const [y, m] = mk.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const day = Math.min(re.dueDay, daysInMonth);
    return `${mk}-${String(day).padStart(2, '0')}`;
  }

  // Retorna todos los pendientes: del mes en curso + arrastrados desde meses anteriores
  // Pendiente arrastrado: el gasto recurrente NO se pagó en su mes correspondiente
  // y tampoco se ha pagado aún (no existe ningún movement para ese ciclo).
  function getAllPending() {
    const recs = Storage.get().recurringExpenses || [];
    const curMk = getCurrentMonthKey();
    const result = [];

    recs.forEach(re => {
      // Deuda con cuotas ya completada: no genera más pendientes
      if (re.installmentsDone) return;
      // Mes en que se creó el gasto recurrente. Antes de ese mes no hay pendientes posibles.
      const createdDate = new Date(re.createdAt || Date.now());
      const createdMk = `${createdDate.getFullYear()}-${String(createdDate.getMonth() + 1).padStart(2, '0')}`;

      if (re.recurrence === 'monthly') {
        // El primer período pendiente posible es el mes del PRIMER vencimiento
        // (dueDate). Antes de esa fecha el pago todavía no vence, así que no
        // debe contar como pendiente ni como atrasado. Sin dueDate (legacy),
        // se usa el mes de creación como referencia.
        const startMk = re.dueDate ? re.dueDate.slice(0, 7) : createdMk;

        // Pendientes desde startMk hasta el mes actual (límite: 24 meses por seguridad)
        const periods = [];
        for (let i = 0; i <= 24; i++) {
          const d = new Date();
          d.setDate(1);
          d.setMonth(d.getMonth() - i);
          const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          if (mk < startMk) break;
          if (!isRecurringPaidInMonth(re, mk)) {
            periods.push(mk);
          } else {
            // Si encontramos uno pagado, dejamos de buscar hacia atrás
            break;
          }
        }
        periods.forEach(mk => {
          result.push({ recurring: re, periodMk: mk, isFromCurrentMonth: mk === curMk });
        });
      } else if (re.recurrence === 'quarterly' || re.recurrence === 'yearly') {
        // Para trimestrales/anuales: aparece como pendiente solo si su fecha de vencimiento
        // ya llegó este ciclo y aún no se pagó.
        if (createdMk > curMk) return; // creado en el futuro, ignorar
        if (isRecurringPaidInMonth(re, curMk)) return; // ya pagado en este ciclo

        // Determinar el "mes objetivo" del próximo vencimiento
        let targetMk = curMk;
        if (re.dueDate) {
          // Buscar el mes en el que cae el vencimiento de este ciclo
          // Para anual: mes de re.dueDate dentro del año en curso
          // Para trimestral: el ciclo más cercano hacia atrás (o el actual) que aún no se haya pagado
          const [refY, refM] = re.dueDate.split('-').map(Number);
          const [curY, curMonth] = curMk.split('-').map(Number);
          if (re.recurrence === 'yearly') {
            targetMk = `${curY}-${String(refM).padStart(2, '0')}`;
          } else {
            // trimestral: encontrar el último múltiplo de 3 desde refM hasta antes de hoy
            const diffMonths = (curY - refY) * 12 + (curMonth - refM);
            if (diffMonths >= 0) {
              const cyclesElapsed = Math.floor(diffMonths / 3);
              const targetMonth = refM + cyclesElapsed * 3;
              const targetYear = refY + Math.floor((targetMonth - 1) / 12);
              const adjMonth = ((targetMonth - 1) % 12) + 1;
              targetMk = `${targetYear}-${String(adjMonth).padStart(2, '0')}`;
            } else {
              return; // aún no llega el primer ciclo
            }
          }
        }
        // Solo mostrar pendiente si el mes objetivo ya llegó o pasó (no si es futuro)
        if (targetMk > curMk) return;
        result.push({ recurring: re, periodMk: targetMk, isFromCurrentMonth: targetMk === curMk });
      }
    });

    result.sort((a, b) => {
      if (a.periodMk !== b.periodMk) return a.periodMk.localeCompare(b.periodMk);
      const da = a.recurring.dueDay || 32;
      const db = b.recurring.dueDay || 32;
      return da - db;
    });

    return result;
  }

  // ---- Vencimientos para la tarjeta de Enfoque ----
  const keyAddDays = (k, n) => { const d = new Date(k + 'T12:00:00'); d.setDate(d.getDate() + n); return UI.localDateKey(d); };
  const keyDiffDays = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);

  // ¿Ya se pagó este pago programado puntual (recurrence 'once')?
  const isOncePaid = re => (Storage.get().movements || []).some(m => m.type === 'expense' && m.recurringExpenseId === re.id);

  // Todos los vencimientos no pagados que ve la tarjeta Finanzas:
  //  · los de getAllPending (atrasados de meses anteriores y los del mes en curso),
  //  · el ciclo del mes siguiente que cae antes de `untilKey` (la semana puede cruzar de mes),
  //  · los pagos programados puntuales ('once') con su fecha.
  // Cada uno: { re, mk, dueKey (null = sin fecha), cuota (n.º o null) }.
  function getPaymentOccurrences(untilKey) {
    const curMk = getCurrentMonthKey();
    const nextMk = shiftMonth(curMk, 1);
    const occ = getAllPending().map(p => ({
      re: p.recurring, mk: p.periodMk, dueKey: getDueDateForRecurringInMonth(p.recurring, p.periodMk),
    }));
    (Storage.get().recurringExpenses || []).forEach(re => {
      if (re.installmentsDone) return;
      if (re.recurrence === 'once') {
        if (re.dueDate && !isOncePaid(re)) occ.push({ re, mk: re.dueDate.slice(0, 7), dueKey: re.dueDate });
        return;
      }
      // Mismas reglas de getAllPending, aplicadas al mes siguiente
      const created = new Date(re.createdAt || Date.now());
      const createdMk = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}`;
      const startMk = (re.recurrence === 'monthly' && re.dueDate) ? re.dueDate.slice(0, 7) : createdMk;
      if (startMk > nextMk) return;
      if (re.dueDate && re.recurrence !== 'monthly' && re.dueDate.slice(0, 7) > nextMk) return;
      const dueKey = getDueDateForRecurringInMonth(re, nextMk);
      if (!dueKey || dueKey > untilKey || isRecurringPaidInMonth(re, nextMk)) return;
      occ.push({ re, mk: nextMk, dueKey });
    });
    // Cuotas: cada vencimiento pendiente de la misma deuda es la cuota siguiente
    const byRe = new Map();
    occ.sort((a, b) => (a.dueKey || a.mk).localeCompare(b.dueKey || b.mk));
    return occ.filter(o => {
      if (!o.re.installmentsTotal) { o.cuota = null; return true; }
      const i = byRe.get(o.re.id) || 0;
      byRe.set(o.re.id, i + 1);
      o.cuota = (o.re.installmentsCurrent || 1) + i;
      return o.cuota <= o.re.installmentsTotal;
    });
  }

  // Pestañas de pagos en Enfoque (mismos rangos que Tareas)
  const FIN_TABS = [['today', 'Hoy'], ['week', 'Semana'], ['month', 'Mes'], ['later', 'Más adelante']];
  const FIN_TAB_STORE = 'mi_dashboard_fin_tab'; // sessionStorage: dura la sesión
  let finTab = 'today';
  try {
    const saved = sessionStorage.getItem(FIN_TAB_STORE);
    if (FIN_TABS.some(([id]) => id === saved)) finTab = saved;
  } catch (e) { /* sin sessionStorage: Hoy */ }

  // Tarjeta "💰 Finanzas" en Enfoque. Siempre visible. Arriba presupuesto y ahorro;
  // luego "⚠ Atrasados" (uno por pago, el período más antiguo) y las pestañas
  // Hoy · Semana · Mes · Más adelante (esta última solo con pagos puntuales).
  function renderTodayPending() {
    const c = document.getElementById('today-pending');
    if (!isLive(c)) return;

    const todayKey = UI.todayKey();
    const curMk = getCurrentMonthKey();
    const d = new Date(todayKey + 'T12:00:00');
    const sunday = keyAddDays(todayKey, d.getDay() === 0 ? 0 : 7 - d.getDay());
    const nextMonday = keyAddDays(sunday, 1);
    const endMonth = getMonthRange(curMk).end;

    const groups = { overdue: [], today: [], week: [], month: [], later: [] };
    const overdueByRe = new Map();
    getPaymentOccurrences(sunday).forEach(o => {
      // Del mes en curso sin fecha: no se puede ubicar (como antes, se omite)
      if (!o.dueKey && o.mk >= curMk) return;
      if (!o.dueKey || o.dueKey < todayKey) {
        o.daysLate = o.dueKey ? Math.max(1, keyDiffDays(o.dueKey, todayKey)) : 1;
        const prev = overdueByRe.get(o.re.id);
        if (!prev || o.daysLate > prev.daysLate) overdueByRe.set(o.re.id, o);
        return;
      }
      if (o.dueKey === todayKey) groups.today.push(o);
      else if (o.dueKey <= sunday) groups.week.push(o);
      else if (o.dueKey >= nextMonday && o.dueKey <= endMonth) groups.month.push(o);
      else if (o.re.recurrence === 'once' && o.dueKey > endMonth) groups.later.push(o);
    });
    groups.overdue = [...overdueByRe.values()].sort((a, b) => b.daysLate - a.daysLate);

    const { start, end } = getMonthRange(curMk);
    const monthEx = monthExpenses(start, end);
    const spent = sumAmount(monthEx.filter(m => !isSavings(m)));
    const saved = sumAmount(monthEx.filter(isSavings));
    const plan = getPlan();
    const planHTML = (plan.budget || plan.goal)
      ? `<div class="fin-plan">${plan.budget ? budgetRow(spent, plan.budget) : ''}${plan.goal ? savingsRow(saved, plan.goal) : ''}</div>`
      : '';

    const total = list => list.reduce((s, o) => s + (o.re.defaultAmount || 0), 0);
    const pendingThisMonth = [...groups.overdue, ...groups.today, ...groups.week, ...groups.month];
    const anyItem = pendingThisMonth.length + groups.later.length > 0;
    const subtitle = pendingThisMonth.length
      ? `${pendingThisMonth.length} ${pendingThisMonth.length === 1 ? 'pendiente' : 'pendientes'} este mes · ${formatCLP(total(pendingThisMonth))}`
      : `Gastado este mes · ${formatCLP(spent)}`;

    let body;
    if (!anyItem) {
      body = '<div class="empty">No hay gastos pendientes</div>';
    } else {
      const overdueHTML = groups.overdue.length ? `
        <div class="overdue-section fin-overdue">
          <div class="overdue-section-title">
            <span>⚠ Atrasados</span>
            <span class="overdue-count">${groups.overdue.length}</span>
          </div>
          <div class="tp-list">${renderPendingRows(groups.overdue, 'overdue')}</div>
        </div>` : '';
      const tabsHTML = `<div class="fin-tabs" role="tablist">${FIN_TABS.map(([id, label]) => {
        const n = groups[id].length, t = total(groups[id]);
        return `<button type="button" class="fin-tab ${id === finTab ? 'active' : ''}" data-fin-tab="${id}" role="tab" aria-selected="${id === finTab}">${label}<span class="fin-tab-meta"> · ${n}${t ? ` · ${formatCLP(t)}` : ''}</span></button>`;
      }).join('')}</div>`;
      const list = groups[finTab];
      body = overdueHTML + tabsHTML + (list.length
        ? `<div class="tp-list">${renderPendingRows(list, finTab)}</div>`
        : '<div class="empty fin-tab-empty">No hay pagos</div>');
    }

    c.innerHTML = `
      <div class="section-card">
        <div class="section-head">
          <div>
            <div class="section-title">💰 Finanzas</div>
            <div class="section-subtitle">${subtitle}</div>
          </div>
          <div class="section-head-actions">
            <button class="section-icon-btn" id="today-expense-add" aria-label="Nuevo gasto"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>
            <button class="section-icon-btn" data-go="finance-settings" aria-label="Ver movimientos"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg></button>
          </div>
        </div>
        ${planHTML}
        ${body}
      </div>`;

    // Pestañas desplazables: mantener visible la activa
    const tabsEl = c.querySelector('.fin-tabs');
    if (tabsEl) {
      const act = tabsEl.querySelector('.fin-tab.active');
      const rel = act.getBoundingClientRect().left - tabsEl.getBoundingClientRect().left;
      if (rel + act.offsetWidth > tabsEl.clientWidth) tabsEl.scrollLeft = rel - 8;
    }

    c.querySelector('#today-expense-add').addEventListener('click', (e) => {
      e.stopPropagation();
      openNewExpense();
    });
    c.querySelectorAll('[data-fin-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        finTab = btn.dataset.finTab;
        try { sessionStorage.setItem(FIN_TAB_STORE, finTab); } catch (err) { /* solo en memoria */ }
        renderTodayPending();
      });
    });
    c.querySelectorAll('[data-tp-pay]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openPayRecurringModal(btn.dataset.tpPay, btn.dataset.tpPeriod);
      });
    });
  }

  // Filas de pagos: nombre, monto, vencimiento corto (o atraso) y "Cuota N/M"
  function renderPendingRows(list, kind) {
    return list.map(o => {
      const cat = getExpenseCategory(o.re.category);
      let tagClass, tagText;
      if (kind === 'overdue') { tagClass = 'overdue'; tagText = `Atrasado ${o.daysLate}d`; }
      else if (kind === 'today') { tagClass = 'today'; tagText = 'Vence hoy'; }
      else {
        tagClass = 'soon';
        tagText = new Date(o.dueKey + 'T12:00:00').toLocaleDateString('es-CL', { day: '2-digit', month: 'short' }).replace('.', '');
      }
      const amount = o.re.defaultAmount ? `~ ${formatCLP(o.re.defaultAmount)}` : 'Monto variable';
      const instTag = o.cuota ? `<span class="tp-inst">Cuota ${o.cuota}/${o.re.installmentsTotal}</span>` : '';
      return `
        <div class="tp-item ${tagClass}">
          <div class="tp-main">
            <div class="tp-name">${cat.icon} ${escapeHtml(o.re.name)}</div>
            <div class="tp-meta">
              <span class="tp-tag ${tagClass}">${tagText}</span>
              <span class="tp-amount">${amount}</span>
              ${instTag}
            </div>
          </div>
          <button class="tp-pay" data-tp-pay="${o.re.id}" data-tp-period="${o.mk}">Pagar</button>
        </div>`;
    }).join('');
  }

  // Modal "Pagar recurrente"
  function openPayRecurringModal(recurringId, periodMk) {
    const s = Storage.get();
    const re = (s.recurringExpenses || []).find(x => x.id === recurringId);
    if (!re) return;
    let zeroConfirmed = false; // para confirmar un pago de $0
    const cat = getExpenseCategory(re.category);
    // Si es del mes en curso → fecha de hoy. Si es atrasado → hoy igualmente (el pago se registra con la fecha de HOY).
    const defaultDate = UI.todayKey();

    const curMk = getCurrentMonthKey();
    const periodHint = (periodMk && periodMk < curMk)
      ? `<p style="color:var(--accent-red);font-size:12px;margin-bottom:8px">⚠ Pago atrasado · correspondía a ${new Date(periodMk + '-15T12:00:00').toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })}</p>`
      : '';

    // Línea de cuota, si es una deuda con cuotas
    const instHint = (re.installmentsTotal)
      ? `<p style="color:var(--text-dim);font-size:12px;margin-bottom:8px">📄 Cuota ${re.installmentsCurrent || 1} de ${re.installmentsTotal}${(re.installmentsCurrent || 1) >= re.installmentsTotal ? ' · última' : ''}</p>`
      : '';

    UI.openModal({
      title: `💸 Pagar · ${re.name}`,
      okText: 'Registrar pago',
      bodyHTML: `
        <p style="color:var(--text-dim);font-size:13px;margin-bottom:6px">${cat.icon} ${cat.name} · ${getRecurrence(re.recurrence).name}</p>
        ${periodHint}
        ${instHint}
        <label>Monto pagado (CLP)</label>
        <input type="number" id="pay-amount" inputmode="numeric" min="0" step="1" placeholder="Ej: 45000" value="${re.defaultAmount != null ? re.defaultAmount : ''}" style="font-family:var(--font-mono)" />
        ${re.defaultAmount ? `<p style="color:var(--text-faint);font-size:11px;margin-top:4px">Estimado: ${formatCLP(re.defaultAmount)}. Modifica si difiere.</p>` : ''}

        <label>Fecha de pago</label>
        <input type="date" id="pay-date" value="${defaultDate}" />

        <label>Nota (opcional)</label>
        <textarea id="pay-note" placeholder="Detalles, observaciones"></textarea>
      `,
      onSave: () => {
        const amountRaw = document.getElementById('pay-amount').value.trim();
        if (amountRaw === '' || isNaN(Number(amountRaw)) || Number(amountRaw) < 0) {
          UI.toast('Ingresa un monto válido (0 o más)');
          return false;
        }
        const amount = Number(amountRaw);

        // Confirmación de pago en $0 (doble toque)
        if (amount === 0 && !zeroConfirmed) {
          zeroConfirmed = true;
          UI.toast('El pago es $0. Toca de nuevo para confirmar.');
          const okBtn = document.getElementById('modal-ok');
          if (okBtn) okBtn.textContent = 'Confirmar pago de $0';
          return false;
        }

        const date = document.getElementById('pay-date').value || UI.todayKey();
        const note = document.getElementById('pay-note').value.trim() || null;

        const ss = Storage.get();
        ss.movements = ss.movements || [];
        ss.movements.push({
          id: Storage.uid(),
          type: 'expense',
          name: re.name,
          category: re.category,
          amount,
          date,
          note,
          recurringExpenseId: re.id,
          // Si el pago se hace en mes distinto al del ciclo, lo dejamos marcado
          periodMk: periodMk || null,
          createdAt: Date.now(),
        });

        // Pago programado puntual: queda pagado y sale de la lista (el pago se conserva)
        if (re.recurrence === 'once') {
          ss.recurringExpenses = (ss.recurringExpenses || []).filter(x => x.id !== re.id);
        }

        // Avanzar cuota si el gasto está en cuotas (cualquier categoría)
        if (re.installmentsTotal) {
          const cur = re.installmentsCurrent || 1;
          if (cur >= re.installmentsTotal) {
            re.installmentsDone = true;   // pagó la última: deja de repetirse
          } else {
            re.installmentsCurrent = cur + 1;
          }
        }

        Storage.save();
        refreshViews();
        UI.toast(amount === 0 ? 'Pago de $0 registrado' : 'Pago registrado');
      }
    });
    setTimeout(() => {
      const i = document.getElementById('pay-amount');
      if (i) { i.focus(); i.select(); }
    }, 80);
  }

  // ====== GRÁFICOS (SVG nativo) ======

  // Mes que se está analizando (se reinicia al mes actual al entrar a la vista)
  let analysisMk = null;
  // "Registros del mes" desplegado (solo en memoria; parte colapsado)
  let recordsOpen = false;

  function openAnalysis() {
    analysisMk = getCurrentMonthKey();
    renderAnalysis();
  }

  function setAnalysisMonth(mk) {
    analysisMk = mk;
    renderAnalysis();
    const view = document.getElementById('view-finance-analysis');
    if (view) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderAnalysis() {
    const c = document.getElementById('finance-analysis-card');
    if (!c) return;
    const mk = analysisMk || getCurrentMonthKey();
    const curMk = getCurrentMonthKey();
    const { start, end } = getMonthRange(mk);

    // Solo gastos registrados: ingresos y ajustes de saldo (legados) quedan fuera
    const expenses = monthExpenses(start, end);
    const spent = sumAmount(expenses.filter(m => !isSavings(m)));
    const saved = sumAmount(expenses.filter(isSavings));
    const out = spent + saved;
    const savedPct = out > 0 ? Math.round((saved / out) * 100) : null;

    // Navegador de meses
    const firstMk = firstMonthWithData();
    const canPrev = mk > firstMk;
    const canNext = mk < curMk;
    const nav = `
      <div class="mnav">
        <button class="mnav-btn" data-mnav="prev" ${canPrev ? '' : 'disabled'} aria-label="Mes anterior">‹</button>
        <div class="mnav-center">
          <div class="mnav-month">${monthLong(mk)}</div>
          <div class="mnav-sub">${mk === curMk ? 'Mes en curso' : ''}</div>
        </div>
        <button class="mnav-btn" data-mnav="next" ${canNext ? '' : 'disabled'} aria-label="Mes siguiente">›</button>
      </div>`;

    const chart = `
      <div class="analysis-block">
        <div class="analysis-block-title">Gastos y ahorro · 6 meses hasta ${monthShort(mk)}</div>
        ${renderSpendSaveBars(mk)}
      </div>`;

    // Sin registros: no tiene sentido pintar el resumen ni la dona en cero
    if (expenses.length === 0) {
      c.innerHTML = nav +
        '<div class="empty" style="margin:22px 0">Sin gastos registrados en este mes</div>' + chart;
      bindAnalysis(c);
      return;
    }

    const summary = `
      <div class="m-summary">
        <div class="ms-cell"><span class="ms-val expense">${formatCLP(spent)}</span><span class="ms-lbl">Gastado</span></div>
        <div class="ms-cell"><span class="ms-val savings">${formatCLP(saved)}</span><span class="ms-lbl">Ahorrado</span></div>
        <div class="ms-cell"><span class="ms-val ${savedPct ? 'savings' : 'zero'}">${savedPct === null ? '—' : savedPct + '%'}</span><span class="ms-lbl">% ahorrado</span></div>
      </div>`;

    c.innerHTML = `
      ${nav}
      ${summary}
      ${renderPlanBlocks(expenses, spent, saved)}
      <div class="analysis-block">
        <div class="analysis-block-title">Gastos por categoría</div>
        ${renderExpenseDonut(expenses, mk)}
      </div>
      ${chart}
      <div class="analysis-block">
        <button type="button" class="coll-head analysis-records-head" data-records-toggle aria-expanded="${recordsOpen}">
          <span class="analysis-block-title">Registros del mes · ${expenses.length}</span>
          ${expenses.length ? `<span class="coll-sum">${formatCLP(sumAmount(expenses))}</span>` : ''}
          <span class="coll-chev" aria-hidden="true">▸</span>
        </button>
        <div class="month-records" ${recordsOpen ? '' : 'hidden'}>${expenses.length ? sortByRecent(expenses).map(m => renderMovementItem(m)).join('') : '<div class="empty" style="margin:6px 0">Sin registros este mes</div>'}</div>
      </div>
    `;
    const recToggle = c.querySelector('[data-records-toggle]');
    recToggle.addEventListener('click', () => {
      recordsOpen = !recordsOpen;
      recToggle.setAttribute('aria-expanded', String(recordsOpen));
      const list = recToggle.nextElementSibling;
      list.hidden = !recordsOpen;
      if (recordsOpen) Animate.reveal(list);
    });
    bindAnalysis(c);
    bindMovementActions(c);
  }

  // Presupuesto (general + por categoría) y meta de ahorro del mes analizado
  function renderPlanBlocks(expenses, spent, saved) {
    const plan = getPlan();
    const emptyPlan = (msg, link) =>
      `<div class="plan-empty">${msg} <button type="button" class="link-btn" data-open-plan>${link}</button></div>`;

    const byCat = {};
    expenses.forEach(m => { byCat[m.category] = (byCat[m.category] || 0) + (m.amount || 0); });
    const catRows = Object.entries(plan.catBudgets)
      .filter(([id, limit]) => limit > 0 && id !== SAVINGS_CAT)
      .map(([id, limit]) => ({ cat: getExpenseCategory(id), used: byCat[id] || 0, limit }))
      .sort((a, b) => (b.used / b.limit) - (a.used / a.limit))
      .map(r => progressRow(`${r.cat.icon} ${r.cat.name} · ${formatCLP(r.used)} de ${formatCLP(r.limit)}`, r.used, r.limit))
      .join('');

    const budgetBody = (plan.budget || catRows)
      ? `${plan.budget ? budgetRow(spent, plan.budget) : ''}${catRows ? `<div class="plan-cat-bars">${catRows}</div>` : ''}`
      : emptyPlan('Sin presupuesto mensual.', 'Define tu presupuesto');
    const goalBody = plan.goal
      ? savingsRow(saved, plan.goal)
      : emptyPlan('Sin meta de ahorro.', 'Define tu meta de ahorro');

    return `
      <div class="analysis-block">
        <div class="analysis-block-title">Presupuesto</div>
        ${budgetBody}
      </div>
      <div class="analysis-block">
        <div class="analysis-block-title">Meta de ahorro</div>
        ${goalBody}
      </div>`;
  }

  function bindAnalysis(c) {
    const cur = analysisMk || getCurrentMonthKey();
    c.querySelectorAll('[data-open-plan]').forEach(b => b.addEventListener('click', openPlan));
    c.querySelectorAll('[data-mnav]').forEach(b => {
      b.addEventListener('click', () => {
        if (b.disabled) return;
        UI.buzz(8);
        setAnalysisMonth(shiftMonth(cur, b.dataset.mnav === 'prev' ? -1 : 1));
      });
    });
    c.querySelectorAll('[data-jump]').forEach(r => {
      r.addEventListener('click', () => {
        const mk = r.dataset.jump;
        if (mk === cur || mk > getCurrentMonthKey()) return;
        UI.buzz(8);
        setAnalysisMonth(mk);
      });
    });
  }

  function renderExpenseDonut(expenses, mk) {
    if (expenses.length === 0) {
      return '<div class="empty" style="margin:6px 0">Sin gastos este mes</div>';
    }
    const avgData = categoryAverages(mk);
    // Agrupar por categoría
    const byCat = {};
    expenses.forEach(e => {
      const id = e.category || 'otros';
      if (!byCat[id]) byCat[id] = 0;
      byCat[id] += (e.amount || 0);
    });
    const total = Object.values(byCat).reduce((s, v) => s + v, 0);
    if (total === 0) return '<div class="empty" style="margin:6px 0">Sin datos</div>';

    // Gastos ordenados por monto desc; Ahorro siempre al final, separado del resto
    const all = Object.entries(byCat)
      .map(([id, val]) => ({ cat: { ...getExpenseCategory(id), id }, val, pct: val / total, savings: id === SAVINGS_CAT }))
      .filter(e => e.val > 0);
    const entries = [
      ...all.filter(e => !e.savings).sort((a, b) => b.val - a.val),
      ...all.filter(e => e.savings),
    ];

    // Paleta de gastos (sin verdes); Ahorro usa el verde de acento
    // (sin rojo: el rojo queda reservado para alertas)
    const palette = ['#f5c842', '#60a5fa', '#a78bfa', '#2dd4bf', '#f0abfc', '#fb923c', '#94a3b8'];
    const SAVINGS_COLOR = '#4ade80';
    const colorOf = (e, idx) => e.savings ? SAVINGS_COLOR : palette[idx % palette.length];

    // SVG donut: más gruesa, mejor proporcionada
    const SIZE = 180;
    const cx = SIZE / 2, cy = SIZE / 2;
    const r = 64;
    const sw = 28;
    const C = 2 * Math.PI * r;
    let offset = 0;
    const slices = entries.map((e, idx) => {
      const dash = C * e.pct;
      // Separador entre slices: 1.5 normal; más ancho a ambos lados del Ahorro
      const sep = (e.savings && entries.length > 1) ? 6 : 1.5;
      const visualDash = Math.max(0, dash - sep);
      const visualGap = C - visualDash;
      const shift = e.savings && entries.length > 1 ? sep / 2 : 0;
      const width = e.savings ? sw + 6 : sw;
      const el = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${colorOf(e, idx)}" stroke-width="${width}" stroke-linecap="butt"
        stroke-dasharray="${visualDash} ${visualGap}" stroke-dashoffset="${-(offset + shift)}" transform="rotate(-90 ${cx} ${cy})" />`;
      offset += dash;
      return el;
    }).join('');

    const legend = entries.map((e, idx) => {
      const pctTxt = Math.round(e.pct * 100);
      // Contraste contra el promedio de los otros meses con datos.
      // En Ahorro, estar sobre el promedio es bueno (colores invertidos).
      let delta = '';
      if (avgData && avgData.avg[e.cat.id] > 0) {
        const a = avgData.avg[e.cat.id];
        const diff = Math.round(((e.val - a) / a) * 100);
        if (Math.abs(diff) >= 5) {
          const over = diff > 0;
          const cls = (over !== e.savings) ? 'over' : 'under';
          delta = `<div class="donut-delta ${cls}">${over ? '▲' : '▼'} ${Math.abs(diff)}% ${over ? 'sobre' : 'bajo'} tu promedio</div>`;
        } else {
          delta = '<div class="donut-delta even">= en tu promedio</div>';
        }
      }
      return `
        <div class="donut-legend-row ${e.savings ? 'is-savings' : ''}">
          <span class="donut-dot" style="background:${colorOf(e, idx)}"></span>
          <div class="donut-legend-body">
            <div class="donut-legend-top">
              <span class="donut-cat-name">${e.cat.icon} ${e.cat.name}</span>
              <span class="donut-cat-val">${formatCLP(e.val)} · ${pctTxt}%</span>
            </div>
            ${delta}
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="donut-wrap">
        <div class="donut-svg-wrap">
          <svg class="donut-svg" viewBox="0 0 ${SIZE} ${SIZE}" preserveAspectRatio="xMidYMid meet">
            <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--bg-elev)" stroke-width="${sw}" />
            ${slices}
          </svg>
          <div class="donut-center">
            <div class="donut-total-label">Total del mes</div>
            <div class="donut-total">${formatCLP(total)}</div>
          </div>
        </div>
        <div class="donut-legend">${legend}</div>
      </div>
    `;
  }

  // Barras apiladas por mes: gastado (abajo) + ahorrado (arriba)
  function renderSpendSaveBars(endMk) {
    const months = getLast6Months(endMk);
    const data = months.map(mk => {
      const { start, end } = getMonthRange(mk);
      const ex = monthExpenses(start, end);
      return {
        mk,
        spent: sumAmount(ex.filter(m => !isSavings(m))),
        saved: sumAmount(ex.filter(isSavings)),
      };
    });
    if (data.every(d => d.spent === 0 && d.saved === 0)) {
      return '<div class="empty" style="margin:6px 0">Sin datos suficientes</div>';
    }
    const budget = getPlan().budget;
    const max = Math.max(...data.map(d => d.spent + d.saved), budget || 0, 1);
    const curMk = endMk || getCurrentMonthKey();

    // Dimensiones generosas
    const w = 320, h = 200;
    const padL = 8, padR = 8, padT = 18, padB = 36;
    const chartW = w - padL - padR;
    const chartH = h - padT - padB;
    const baseY = h - padB;

    // Líneas guía (25%, 50%, 75%, 100%)
    const guides = [0.25, 0.5, 0.75, 1].map(pct => {
      const y = baseY - chartH * pct;
      return `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="var(--border-soft)" stroke-width="0.5" stroke-dasharray="2 3" opacity="0.5"/>`;
    }).join('');

    // Etiqueta de valor máximo
    const maxLabel = `<text x="${padL + 2}" y="${padT + 8}" font-family="ui-monospace" font-size="9" fill="var(--text-faint)" text-anchor="start">máx ${formatCLP(max)}</text>`;

    const slotW = chartW / data.length;
    const barW = Math.min(28, slotW - 14);

    // Helper: monto formateado en versión muy corta para etiquetas
    const shortAmount = (n) => {
      if (n === 0) return '';
      if (n >= 1000000) return Math.round(n / 100000) / 10 + 'M';
      if (n >= 1000) return Math.round(n / 1000) + 'k';
      return String(Math.round(n));
    };

    const bars = data.map((d, i) => {
      const slotX = padL + i * slotW;
      const x = slotX + (slotW - barW) / 2;
      const spentH = (d.spent / max) * chartH;
      const savedH = (d.saved / max) * chartH;
      const totalH = spentH + savedH;
      const isCurrent = d.mk === curMk;
      const op = isCurrent ? '1' : '0.78';
      // Highlight para el mes analizado: fondo sutil de la columna
      const highlight = isCurrent
        ? `<rect x="${x - 5}" y="${padT}" width="${barW + 10}" height="${chartH + 4}" rx="4" fill="var(--accent-yellow)" opacity="0.06"/>`
        : '';
      const totalLabel = (d.spent + d.saved) > 0 && totalH > 10
        ? `<text x="${x + barW / 2}" y="${baseY - totalH - 3}" text-anchor="middle" font-family="ui-monospace" font-size="8" fill="var(--text-dim)" font-weight="700">${shortAmount(d.spent + d.saved)}</text>`
        : '';
      const savedPct = (d.spent + d.saved) > 0 ? Math.round((d.saved / (d.spent + d.saved)) * 100) : 0;
      const savedLabel = d.saved > 0
        ? `<text x="${x + barW / 2}" y="${baseY + 28}" text-anchor="middle" font-family="ui-monospace" font-size="8" fill="var(--accent-green)" font-weight="700">${savedPct}%</text>`
        : '';
      // Un <g class="chart-bar"> por mes: la pila completa crece desde la base (js/animate.js)
      return `
        ${highlight}
        <rect class="bar-hit" data-jump="${d.mk}" x="${slotX}" y="${padT}" width="${slotW}" height="${chartH + padB - 6}" fill="transparent" style="cursor:pointer" />
        <g class="chart-bar">
          <rect x="${x}" y="${baseY - spentH}" width="${barW}" height="${spentH}" rx="2" fill="var(--text-dim)" opacity="${op}" />
          <rect x="${x}" y="${baseY - totalH}" width="${barW}" height="${savedH}" rx="2" fill="var(--accent-green)" opacity="${op}" />
        </g>
        ${totalLabel}
        <text x="${x + barW / 2}" y="${baseY + 14}" text-anchor="middle" font-family="ui-monospace" font-size="9" fill="${isCurrent ? 'var(--accent-yellow)' : 'var(--text-dim)'}" font-weight="${isCurrent ? '700' : '400'}">${monthShort(d.mk)}</text>
        ${savedLabel}
      `;
    }).join('');

    // Eje base (línea horizontal en 0)
    const baseLine = `<line x1="${padL}" y1="${baseY}" x2="${w - padR}" y2="${baseY}" stroke="var(--border)" stroke-width="1"/>`;

    // Presupuesto mensual: línea horizontal punteada sutil (comparable con lo gastado)
    let budgetLine = '';
    if (budget) {
      const y = baseY - (budget / max) * chartH;
      budgetLine = `
        <line class="budget-line" x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="var(--text-faint)" stroke-width="1" stroke-dasharray="4 4" opacity="0.8"/>
        <text x="${w - padR - 2}" y="${y - 3}" text-anchor="end" font-family="ui-monospace" font-size="8" fill="var(--text-faint)">presupuesto ${shortAmount(budget)}</text>`;
    }

    return `
      <div class="chart-bars-wrap">
        <svg viewBox="0 0 ${w} ${h}" width="100%" preserveAspectRatio="xMidYMid meet" style="overflow:visible">
          ${guides}
          ${maxLabel}
          ${bars}
          ${baseLine}
          ${budgetLine}
        </svg>
        <div class="chart-legend-row">
          <span><span class="dot-neutral"></span> Gastado</span>
          <span><span class="dot-green"></span> Ahorrado (%)</span>
          <span class="chart-legend-hint">Toca un mes para verlo</span>
        </div>
      </div>
    `;
  }

  function getLast6Months(endMk) {
    const arr = [];
    const [ey, em] = (endMk || getCurrentMonthKey()).split('-').map(Number);
    for (let i = 5; i >= 0; i--) {
      const x = new Date(ey, em - 1 - i, 1);
      arr.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`);
    }
    return arr;
  }

  // Desplaza una monthKey n meses
  function shiftMonth(mk, n) {
    const [y, m] = mk.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  // Etiqueta larga: "JULIO 2026"
  function monthLong(mk) {
    const [y, m] = mk.split('-').map(Number);
    return new Date(y, m - 1, 15)
      .toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })
      .replace(' de ', ' ').toUpperCase();
  }

  // Mes más antiguo con gastos registrados (límite para navegar hacia atrás)
  function firstMonthWithData() {
    const dates = (Storage.get().movements || []).filter(isTrackedExpense).map(m => m.date).filter(Boolean).sort();
    return dates.length ? dates[0].slice(0, 7) : getCurrentMonthKey();
  }

  // Promedio de gasto por categoría en los demás meses con datos.
  // El denominador son todos los meses con gasto, no solo aquellos donde
  // apareció la categoría: un mes sin ese gasto cuenta como cero.
  function categoryAverages(excludeMk) {
    const byMonth = {};
    (Storage.get().movements || []).forEach(m => {
      if (!isTrackedExpense(m) || !m.date) return;
      const mk = m.date.slice(0, 7);
      if (mk === excludeMk) return;
      byMonth[mk] = byMonth[mk] || {};
      const id = m.category || 'otros';
      byMonth[mk][id] = (byMonth[mk][id] || 0) + (m.amount || 0);
    });
    const months = Object.keys(byMonth);
    if (months.length === 0) return null;
    const sums = {};
    months.forEach(mk => Object.entries(byMonth[mk]).forEach(([id, v]) => {
      sums[id] = (sums[id] || 0) + v;
    }));
    const avg = {};
    Object.keys(sums).forEach(id => { avg[id] = sums[id] / months.length; });
    return { avg, count: months.length };
  }

  function monthShort(mk) {
    const [y, m] = mk.split('-').map(Number);
    return new Date(y, m - 1, 15).toLocaleDateString('es-CL', { month: 'short' }).toUpperCase().replace('.', '');
  }

  // ====== ARCHIVO HISTÓRICO (Mi Sistema → Finanzas) ======
  function renderArchive() {
    const c = document.getElementById('finance-archive-list');
    if (!c) return;
    const allMovs = Storage.get().movements || [];
    const curMk = getCurrentMonthKey();

    // Agrupar gastos registrados por mes (excluyendo mes en curso).
    // Ingresos y ajustes legados no aparecen en el archivo.
    const groups = {};
    allMovs.forEach(m => {
      if (!m.date || !isTrackedExpense(m)) return;
      const mk = m.date.slice(0, 7);
      if (mk === curMk) return; // el mes en curso no va al archivo
      if (!groups[mk]) groups[mk] = [];
      groups[mk].push(m);
    });
    const monthKeys = Object.keys(groups).sort((a, b) => b.localeCompare(a));
    if (monthKeys.length === 0) {
      c.innerHTML = '<div class="empty">Aún no hay meses cerrados</div>';
      return;
    }

    const monthCardHTML = (mk) => {
      const movs = sortByRecent(groups[mk]);
      const monthLabel = new Date(mk + '-15T12:00:00').toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
      const open = (archiveOpen[mk] === true);

      return `
        <div class="archive-month ${open ? 'open' : ''}">
          <button class="archive-month-head" data-archive-toggle="${mk}" aria-expanded="${open}">
            <span class="coll-chev" aria-hidden="true">▸</span>
            <span class="archive-month-title">${monthLabel}</span>
            <span class="archive-month-meta">${archiveAmounts(movs)}</span>
          </button>
          <div class="archive-month-body" ${open ? '' : 'hidden'}>
            ${movs.map(m => renderMovementItem(m)).join('')}
          </div>
        </div>
      `;
    };

    // Agrupar los meses por AÑO (colapsados por defecto; lo abierto se recuerda en memoria)
    const isYearOpen = (yk) => archiveYearOpen[yk] === true;
    const yearKeys = [...new Set(monthKeys.map(mk => mk.slice(0, 4)))].sort((a, b) => b.localeCompare(a));

    c.innerHTML = yearKeys.map(yk => {
      const monthsOfYear = monthKeys.filter(mk => mk.slice(0, 4) === yk);
      // Resumen del año: gastado y ahorrado
      const yMovs = monthsOfYear.flatMap(mk => groups[mk]);
      const yOpen = isYearOpen(yk);
      return `
        <div class="hist-year ${yOpen ? 'open' : ''}">
          <button class="hist-year-label" data-archive-year-toggle="${yk}" type="button" aria-expanded="${yOpen}">
            <span class="hist-year-name">${yk}</span>
            <span class="archive-month-meta" style="margin-left:auto">${archiveAmounts(yMovs)}</span>
            <span class="coll-chev" aria-hidden="true">▸</span>
          </button>
          <div class="hist-year-body">${monthsOfYear.map(monthCardHTML).join('')}</div>
        </div>
      `;
    }).join('');

    c.querySelectorAll('[data-archive-year-toggle]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const yk = btn.dataset.archiveYearToggle;
        archiveYearOpen[yk] = !isYearOpen(yk);
        renderArchive();
      });
    });

    c.querySelectorAll('[data-archive-toggle]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mk = btn.dataset.archiveToggle;
        archiveOpen[mk] = !archiveOpen[mk];
        renderArchive();
      });
    });

    // Bindings de movement actions (en archive)
    c.querySelectorAll('[data-kind="movement"]').forEach(el => {
      const id = el.dataset.id;
      el.querySelector('[data-action="edit"]').addEventListener('click', (e) => {
        e.stopPropagation();
        openMovementModal({ editMovementId: id });
      });
      el.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteMovement(id);
      });
    });
  }

  // Montos de un grupo del archivo: gastado y, si hay, ahorrado
  function archiveAmounts(movs) {
    const spent = sumAmount(movs.filter(m => !isSavings(m)));
    const saved = sumAmount(movs.filter(isSavings));
    return `<span class="archive-amt expense">${formatCLP(spent)}</span>` +
      (saved ? `<span class="archive-amt savings">🏦 ${formatCLP(saved)}</span>` : '');
  }

  let archiveOpen = {};
  let archiveYearOpen = {};

  return {
    render,
    renderTodayPending,
    getPaymentOccurrences,
    renderAnalysis,
    openAnalysis,
    renderArchive,
    openMovementModal,
    openNewExpense,
    openPlan,
    isTrackedExpense,
    EXPENSE_CATEGORIES,
    RECURRENCES,
    getExpenseCategory,
    getRecurrence,
    formatCLP,
  };
})();
