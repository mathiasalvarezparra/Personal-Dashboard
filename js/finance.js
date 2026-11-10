/* ============================================
   FINANCE (gastos recurrentes, gastos puntuales e ingresos)
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
    { id: 'inversion',    name: 'Inversión/Ahorro',  icon: '🏦' },
    { id: 'otros',        name: 'Otros',             icon: '📦' },
    { id: 'ajuste',       name: 'Ajuste',            icon: '⚖️' },
  ];

  // Categorías de ingresos
  const INCOME_CATEGORIES = [
    { id: 'sueldo',     name: 'Sueldo',     icon: '💼' },
    { id: 'freelance',  name: 'Freelance',  icon: '🧑‍💻' },
    { id: 'inversion',  name: 'Inversión',  icon: '📈' },
    { id: 'venta',      name: 'Venta',      icon: '🏷️' },
    { id: 'reembolsos', name: 'Reembolsos', icon: '↩️' },
    { id: 'arriendo',   name: 'Arriendo',   icon: '🏘️' },
    { id: 'bonos',      name: 'Bonos',      icon: '🏅' },
    { id: 'otros',      name: 'Otros',      icon: '💵' },
    { id: 'ajuste',     name: 'Ajuste',     icon: '⚖️' },
  ];

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
    { id: 'income',    label: 'Ingresos' },
    { id: 'once',      label: 'Gastos' },
    { id: 'archive',   label: 'Archivo' },
  ];

  let activeSubTab = 'scheduled'; // por defecto: pagos programados (recurrentes)

  function getExpenseCategory(id) {
    return EXPENSE_CATEGORIES.find(c => c.id === id) || EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1];
  }
  function getIncomeCategory(id) {
    return INCOME_CATEGORIES.find(c => c.id === id) || INCOME_CATEGORIES[INCOME_CATEGORIES.length - 1];
  }
  function getRecurrence(id) {
    return RECURRENCES.find(r => r.id === id) || RECURRENCES[0];
  }

  function formatCLP(n) {
    if (n == null || isNaN(n)) return '';
    return '$' + Math.round(Number(n)).toLocaleString('es-CL');
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
    if (activeSubTab === 'income') {
      renderIncomeList(c);
    } else if (activeSubTab === 'once') {
      renderOnceExpensesList(c);
    } else if (activeSubTab === 'archive') {
      // El archivo histórico se renderiza dentro de su propio contenedor,
      // que renderArchive() busca por id.
      c.innerHTML = '<div id="finance-archive-list"></div>';
      renderArchive();
    } else {
      renderScheduledList(c);
    }
  }

  // Pagos programados: TODOS los recurrentes juntos, ordenados por proximidad
  // de vencimiento. La frecuencia se muestra como etiqueta en cada ítem.
  function renderScheduledList(c) {
    const list = (Storage.get().recurringExpenses || []).slice();
    if (list.length === 0) {
      c.innerHTML = '<div class="empty">Sin pagos programados · toca "+ Nuevo movimiento" para crear</div>';
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
    const list = (Storage.get().movements || []).filter(m =>
      m.type === 'expense' && m.date && m.date >= start && m.date <= end
    );
    if (list.length === 0) {
      c.innerHTML = '<div class="empty">Sin gastos este mes · los de meses anteriores están en Archivo</div>';
      return;
    }
    list.sort((a, b) => {
      const dateCmp = (b.date || '').localeCompare(a.date || '');
      if (dateCmp !== 0) return dateCmp;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    c.innerHTML = list.map(m => renderMovementItem(m)).join('');
    bindMovementActions(c);
  }

  // --- Ingresos del mes en curso (los de otros meses están en Archivo)
  function renderIncomeList(c) {
    const { start, end } = getMonthRange(getCurrentMonthKey());
    const list = (Storage.get().movements || []).filter(m =>
      m.type === 'income' && m.date && m.date >= start && m.date <= end
    );
    if (list.length === 0) {
      c.innerHTML = '<div class="empty">Sin ingresos este mes · toca "+ Nuevo movimiento" para registrar</div>';
      return;
    }
    list.sort((a, b) => {
      const dateCmp = (b.date || '').localeCompare(a.date || '');
      if (dateCmp !== 0) return dateCmp;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    c.innerHTML = list.map(m => renderMovementItem(m)).join('');
    bindMovementActions(c);
  }

  // --- Gastos recurrentes (recurringExpenses por tipo, ordenados por proximidad a fecha de pago)

  // ===== Item de gasto recurrente =====
  function renderRecurringItem(re) {
    const cat = getExpenseCategory(re.category);
    const rec = getRecurrence(re.recurrence);
    const amountLabel = re.defaultAmount
      ? `<span class="re-amount">${formatCLP(re.defaultAmount)}</span>`
      : '<span class="re-amount-empty">Variable</span>';
    const dayLabel = re.dueDay
      ? (re.recurrence === 'monthly' ? `Día ${re.dueDay}` : `Día ${re.dueDay} del mes de pago`)
      : 'Sin fecha definida';
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

  // ===== Item de movimiento (gasto puntual o ingreso) =====
  function renderMovementItem(m, opts = {}) {
    const isIncome = m.type === 'income';
    const cat = isIncome ? getIncomeCategory(m.category) : getExpenseCategory(m.category);
    const dateLabel = m.date
      ? new Date(m.date + 'T12:00:00').toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: '2-digit' }).toUpperCase()
      : '—';
    const amountClass = isIncome ? 're-amount income' : 're-amount expense';
    const sign = isIncome ? '+' : '−';
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
            <span class="${amountClass}">${sign} ${formatCLP(m.amount)}</span>
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

  // ====== MODAL UNIFICADO: NUEVO MOVIMIENTO ======
  // Opciones:
  //  - prefillType: 'expense' | 'income' (para shortcuts del FAB)
  //  - editRecurringId: editar un recurringExpense existente
  //  - editMovementId: editar un movement existente
  function openMovementModal(opts = {}) {
    const state = Storage.get();
    let editing = null;       // un movement (expense puntual o income)
    let editingRecurring = null; // un recurringExpense

    if (opts.editMovementId) {
      editing = (state.movements || []).find(x => x.id === opts.editMovementId) || null;
    }
    if (opts.editRecurringId) {
      editingRecurring = (state.recurringExpenses || []).find(x => x.id === opts.editRecurringId) || null;
    }

    // Tipo inicial
    let initialType = 'expense';
    if (editing) initialType = editing.type;
    else if (editingRecurring) initialType = 'expense'; // los recurrentes son siempre gastos
    else if (opts.prefillType) initialType = opts.prefillType;

    // Recurrencia inicial
    let initialRec = 'once';
    if (editingRecurring) initialRec = editingRecurring.recurrence;
    else if (editing) initialRec = 'once'; // movement = siempre puntual

    // Estado del modal (mutable mientras está abierto)
    const modalState = { type: initialType, recurrence: initialRec };

    const isEditingSomething = editing || editingRecurring;
    const title = isEditingSomething ? 'Editar movimiento' : 'Nuevo movimiento';
    const okText = isEditingSomething ? 'Guardar cambios' : 'Registrar';

    UI.openModal({
      title,
      okText,
      bodyHTML: `
        <label>Tipo</label>
        <div class="finance-type-toggle" id="mv-type-toggle">
          <button type="button" class="finance-type-btn ${modalState.type === 'expense' ? 'active' : ''}" data-type="expense">− Gasto</button>
          <button type="button" class="finance-type-btn ${modalState.type === 'income' ? 'active' : ''}" data-type="income">+ Ingreso</button>
        </div>

        <label>Nombre</label>
        <input type="text" id="mv-name" placeholder="Ej: Luz, Sueldo, Bencina"
          value="${(editing && escapeAttr(editing.name)) || (editingRecurring && escapeAttr(editingRecurring.name)) || ''}" />

        <label>Categoría</label>
        <select id="mv-category"></select>

        <div id="mv-recurrence-wrap">
          <label>Recurrencia</label>
          <select id="mv-recurrence">
            ${RECURRENCES.map(r => `<option value="${r.id}" ${modalState.recurrence === r.id ? 'selected' : ''}>${r.name}</option>`).join('')}
          </select>
        </div>

        <div id="mv-amount-wrap">
          <label id="mv-amount-label">Monto (CLP)</label>
          <input type="number" id="mv-amount" inputmode="numeric" min="0" step="1" placeholder="Ej: 45000"
            value="${(editing && editing.amount != null) ? editing.amount : (editingRecurring && editingRecurring.defaultAmount != null ? editingRecurring.defaultAmount : '')}"
            style="font-family:var(--font-mono)" />
          <p id="mv-amount-help" style="color:var(--text-faint);font-size:11px;margin-top:4px"></p>
        </div>

        <div id="mv-date-wrap">
          <label id="mv-date-label">Fecha</label>
          <input type="date" id="mv-date" value="${(editing && editing.date) || UI.todayKey()}" />
        </div>

        <div id="mv-due-wrap" hidden>
          <label id="mv-due-label">Fecha de referencia del pago</label>
          <input type="date" id="mv-due-date"
            value="${editingRecurring && editingRecurring.dueDate ? editingRecurring.dueDate : (editingRecurring && editingRecurring.dueDay ? deriveDueDateFromLegacy(editingRecurring) : UI.todayKey())}" />
          <p id="mv-due-help" style="color:var(--text-faint);font-size:11px;margin-top:4px"></p>
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
          <p style="color:var(--text-faint);font-size:11px;margin-top:2px">La cuota se calcula como monto total ÷ total de cuotas. Al pagar la última, deja de repetirse.</p>
        </div>

        <label>Nota (opcional)</label>
        <textarea id="mv-note" placeholder="Detalles, observaciones">${
          (editing && editing.note) ? escapeHtml(editing.note) :
          (editingRecurring && editingRecurring.note) ? escapeHtml(editingRecurring.note) : ''
        }</textarea>
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
      const monto = amountEl ? Number(amountEl.value) : NaN;
      if (total > 0 && monto > 0) {
        line.textContent = `Cuota mensual: ${formatCLP(Math.round(monto / total))}`;
      } else {
        line.textContent = 'Cuota mensual: —';
      }
    };

    // Setup inicial: completar categorías y aplicar visibilidad según tipo/recurrencia
    const refreshUI = () => {
      const isIncome = modalState.type === 'income';
      const isRecurring = modalState.recurrence !== 'once';

      // Categorías según tipo
      const catSel = document.getElementById('mv-category');
      const cats = isIncome ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
      // Preservar lo que el usuario tenga elegido (si sigue siendo válido para el tipo);
      // si no, caer en la categoría del ítem editado o la primera.
      const prevCat = catSel.value;
      const currentCat = (prevCat && cats.some(c => c.id === prevCat))
        ? prevCat
        : ((editing && editing.category) || (editingRecurring && editingRecurring.category) || null);
      catSel.innerHTML = cats.map(c =>
        `<option value="${c.id}" ${currentCat === c.id ? 'selected' : ''}>${c.icon} ${c.name}</option>`
      ).join('');

      // Toggle tipo (estado visual de los botones)
      document.querySelectorAll('.finance-type-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.type === modalState.type);
      });

      // Ingresos: sin recurrencia, sin fecha de referencia
      const recurrenceWrap = document.getElementById('mv-recurrence-wrap');
      const dueWrap = document.getElementById('mv-due-wrap');
      const dueLabel = document.getElementById('mv-due-label');
      const dueHelp = document.getElementById('mv-due-help');
      const dateWrap = document.getElementById('mv-date-wrap');
      const amountLabel = document.getElementById('mv-amount-label');
      const amountHelp = document.getElementById('mv-amount-help');

      // Cuotas: interruptor disponible para cualquier gasto MENSUAL (no solo deudas).
      // El interruptor aparece en mensuales; los campos se muestran al encenderlo.
      const instToggleWrap = document.getElementById('mv-inst-toggle-wrap');
      const instToggle = document.getElementById('mv-inst-toggle');
      const instWrap = document.getElementById('mv-installments-wrap');
      const showToggle = !isIncome && modalState.recurrence === 'monthly';
      if (instToggleWrap) instToggleWrap.hidden = !showToggle;
      if (instWrap) instWrap.hidden = !(showToggle && instToggle && instToggle.checked);
      if (!showToggle && instToggle) instToggle.checked = false;
      updateInstComputed();
      const instOn = !isIncome && showToggle && instToggle && instToggle.checked;

      if (isIncome) {
        recurrenceWrap.hidden = true;
        dueWrap.hidden = true;
        dateWrap.hidden = false;
        amountLabel.textContent = 'Monto recibido (CLP)';
        amountHelp.textContent = '';
      } else {
        recurrenceWrap.hidden = false;
        if (isRecurring) {
          // Gasto recurrente: ocultar fecha puntual, mostrar fecha de referencia
          dateWrap.hidden = true;
          dueWrap.hidden = false;
          amountLabel.textContent = 'Monto estimado (CLP, opcional)';
          amountHelp.textContent = 'Sirve como referencia. El monto real se registra al pagar (en pestaña Finanzas).';
          // Texto contextual según recurrencia
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
          // Gasto puntual: mostrar fecha, ocultar fecha de referencia
          dateWrap.hidden = false;
          dueWrap.hidden = true;
          amountLabel.textContent = 'Monto (CLP)';
          amountHelp.textContent = '';
        }
      }

      // Si el interruptor de cuotas está encendido, el monto pasa a ser el TOTAL
      // de la compra y la fecha de referencia se rotula como "Fecha de pago".
      if (instOn) {
        amountLabel.textContent = 'Monto total de la compra (CLP)';
        amountHelp.textContent = 'Se divide en las cuotas indicadas. La cuota mensual se calcula abajo.';
        dueLabel.textContent = 'Fecha de pago';
        dueHelp.textContent = 'Día en que pagas cada cuota. Se repite el mismo día cada mes.';
      }
    };

    setTimeout(() => {
      // Bind toggle de tipo
      document.querySelectorAll('.finance-type-btn').forEach(b => {
        b.addEventListener('click', () => {
          if (b.disabled) return;
          modalState.type = b.dataset.type;
          // Al cambiar a ingreso, forzar recurrencia 'once'
          if (modalState.type === 'income') {
            modalState.recurrence = 'once';
            const recSel = document.getElementById('mv-recurrence');
            if (recSel) recSel.value = 'once';
          }
          refreshUI();
        });
      });
      // Bind cambio de recurrencia
      const recSel = document.getElementById('mv-recurrence');
      if (recSel) {
        recSel.addEventListener('change', () => {
          modalState.recurrence = recSel.value;
          refreshUI();
        });
      }
      // Interruptor de cuotas: al encender/apagar, muestra u oculta los campos.
      const instToggleBind = document.getElementById('mv-inst-toggle');
      if (instToggleBind) {
        instToggleBind.addEventListener('change', () => refreshUI());
      }
      // Recalcular la cuota mensual en vivo al cambiar monto total o total de cuotas.
      ['mv-amount', 'mv-inst-total'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateInstComputed);
      });
      // Si estamos editando, deshabilitar el toggle de tipo (no cambias gasto↔ingreso al editar)
      if (isEditingSomething) {
        document.querySelectorAll('.finance-type-btn').forEach(b => {
          b.disabled = true;
          b.style.opacity = '0.5';
          b.style.pointerEvents = 'none';
        });
      }
      // Si estamos editando un recurringExpense, fijar la recurrencia (no cambiar entre tipos)
      // Pero permitir cambiar entre mensual/trimestral/anual y bloquear "once" para no confundir
      if (editingRecurring) {
        const recSelEl = document.getElementById('mv-recurrence');
        if (recSelEl) {
          Array.from(recSelEl.options).forEach(opt => {
            if (opt.value === 'once') opt.disabled = true;
          });
        }
      }

      // Al editar un recurrente que ya tiene cuotas, encender el interruptor y
      // mostrar el MONTO TOTAL en el campo de monto (no la cuota individual).
      if (editingRecurring && editingRecurring.installmentsTotal) {
        const instToggle = document.getElementById('mv-inst-toggle');
        if (instToggle) instToggle.checked = true;
        const amountEl = document.getElementById('mv-amount');
        if (amountEl) {
          const total = editingRecurring.installmentTotalAmount != null
            ? editingRecurring.installmentTotalAmount
            : (editingRecurring.defaultAmount != null ? editingRecurring.defaultAmount * editingRecurring.installmentsTotal : '');
          amountEl.value = total;
        }
      }

      refreshUI();
      const i = document.getElementById('mv-name');
      if (i) i.focus();
    }, 50);
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
    const totalAmount = (a && a.value.trim() !== '') ? Math.max(0, Number(a.value)) : null;
    if (total && !current) current = 1;                 // hay total pero no cuota → empieza en 1
    if (total && current > total) current = total;      // no exceder el total
    const perCuota = (total && totalAmount != null) ? Math.round(totalAmount / total) : null;
    return { total: total || null, current: total ? current : null, totalAmount: total ? totalAmount : null, perCuota };
  }

  function saveMovement(modalState, editing, editingRecurring) {
    const name = document.getElementById('mv-name').value.trim();
    if (!name) { UI.toast('Falta el nombre'); return false; }
    const category = document.getElementById('mv-category').value;
    const amountRaw = document.getElementById('mv-amount').value.trim();
    const note = document.getElementById('mv-note').value.trim() || null;

    const isIncome = modalState.type === 'income';
    const isRecurring = modalState.recurrence !== 'once' && !isIncome;

    let amount = null;
    if (amountRaw !== '') {
      const n = Number(amountRaw);
      if (!isNaN(n) && n >= 0) amount = n;
    }
    // Para gastos puntuales e ingresos, monto es obligatorio
    if (!isRecurring && (amount == null || amount === 0)) {
      UI.toast('Falta el monto');
      return false;
    }

    const s = Storage.get();
    s.movements = s.movements || [];
    s.recurringExpenses = s.recurringExpenses || [];

    if (editing) {
      // Editar movement existente (gasto puntual o ingreso)
      editing.name = name;
      editing.category = category;
      editing.amount = amount;
      editing.note = note;
      const dateEl = document.getElementById('mv-date');
      if (dateEl && !dateEl.closest('[hidden]')) editing.date = dateEl.value;
      UI.toast('Movimiento actualizado');
    } else if (editingRecurring) {
      // Editar recurring existente
      editingRecurring.name = name;
      editingRecurring.category = category;
      editingRecurring.recurrence = modalState.recurrence;
      editingRecurring.defaultAmount = amount;
      editingRecurring.note = note;
      const dueDateRaw = document.getElementById('mv-due-date').value;
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
      // Si cambió la recurrencia, saltar a la sub-tab correspondiente para que el usuario vea el resultado
      activeSubTab = 'scheduled';
      UI.toast('Gasto actualizado');
    } else if (isRecurring) {
      // Nuevo gasto recurrente
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
      UI.toast('Gasto recurrente creado');
    } else {
      // Nuevo movement (gasto puntual o ingreso)
      const date = document.getElementById('mv-date').value || UI.todayKey();
      s.movements.push({
        id: Storage.uid(),
        type: isIncome ? 'income' : 'expense',
        name,
        category,
        amount,
        date,
        note,
        recurringExpenseId: null,
        createdAt: Date.now(),
      });
      activeSubTab = isIncome ? 'income' : 'once';
      UI.toast(isIncome ? 'Ingreso registrado' : 'Gasto registrado');
    }
    Storage.save();
    render();
    renderDashboard();
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
        render();
        renderDashboard();
        UI.toast('Eliminado');
      }
    });
  }

  function deleteMovement(id) {
    const s = Storage.get();
    const m = (s.movements || []).find(x => x.id === id);
    if (!m) return;
    UI.confirm2({
      title: 'Eliminar movimiento',
      message: `¿Eliminar "${m.name}"?`,
      okText: 'Eliminar',
      danger: true,
      onConfirm: () => {
        s.movements = s.movements.filter(x => x.id !== id);
        Storage.save();
        render();
        renderDashboard();
        UI.toast('Eliminado');
      }
    });
  }

  // Shortcut para abrir desde el FAB con tipo prellenado
  function openNewExpense() { openMovementModal({ prefillType: 'expense' }); }
  function openNewIncome()  { openMovementModal({ prefillType: 'income' }); }

  // ============================================
  // PESTAÑA "MIS FINANZAS" (dashboard mes en curso)
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

  // ====== RENDER PRINCIPAL DASHBOARD ======
  function renderDashboard() {
    renderMonthBanner();
    renderBalance();
    renderMonthMovements();
  }

  function renderMonthBanner() {
    const c = document.getElementById('finance-month-banner');
    if (!c) return;
    const mk = getCurrentMonthKey();
    const [y, m] = mk.split('-').map(Number);
    const d = new Date(y, m - 1, 15);
    const txt = d.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
    c.textContent = txt;
  }

  function renderBalance() {
    const c = document.getElementById('finance-balance');
    if (!c) return;
    const mk = getCurrentMonthKey();
    const { start, end } = getMonthRange(mk);
    const all = (Storage.get().movements || []);

    // Saldo arrastrado: todos los movimientos ANTERIORES al mes en curso.
    // Se calcula dinámico para que se autocorrija si editas/borras algo viejo.
    const carried = all
      .filter(m => m.date && m.date < start)
      .reduce((s, m) => s + (m.type === 'income' ? (m.amount || 0) : -(m.amount || 0)), 0);

    const movs = all.filter(m => m.date && m.date >= start && m.date <= end);
    const income = movs.filter(m => m.type === 'income').reduce((s, m) => s + (m.amount || 0), 0);
    const expense = movs.filter(m => m.type === 'expense').reduce((s, m) => s + (m.amount || 0), 0);

    const net = carried + income - expense;
    const netClass = net > 0 ? 'positive' : (net < 0 ? 'negative' : 'zero');
    const netSign = net > 0 ? '+ ' : (net < 0 ? '− ' : '');

    const carrySign = carried < 0 ? '− ' : '';
    const carryRow = carried !== 0 ? `
      <div class="finance-balance-row carry">
        <span class="fb-label">Saldo anterior</span>
        <span class="fb-amount">${carrySign}${formatCLP(Math.abs(carried))}</span>
      </div>` : '';

    c.innerHTML = `
      ${carryRow}
      <div class="finance-balance-row income">
        <span class="fb-label">Ingresos</span>
        <span class="fb-amount">+ ${formatCLP(income)}</span>
      </div>
      <div class="finance-balance-row expense">
        <span class="fb-label">Gastos</span>
        <span class="fb-amount">− ${formatCLP(expense)}</span>
      </div>
      <div class="finance-balance-divider"></div>
      <div class="finance-balance-row net ${netClass}">
        <span class="fb-label">Balance</span>
        <span class="fb-amount">${netSign}${formatCLP(Math.abs(net))}</span>
      </div>
    `;
  }

  // Saldo neto actual = arrastre de meses anteriores + ingresos − gastos del mes
  function getCurrentNet() {
    const { start, end } = getMonthRange(getCurrentMonthKey());
    const all = Storage.get().movements || [];
    const carried = all.filter(m => m.date && m.date < start)
      .reduce((s, m) => s + (m.type === 'income' ? (m.amount || 0) : -(m.amount || 0)), 0);
    const movs = all.filter(m => m.date && m.date >= start && m.date <= end);
    const income = movs.filter(m => m.type === 'income').reduce((s, m) => s + (m.amount || 0), 0);
    const expense = movs.filter(m => m.type === 'expense').reduce((s, m) => s + (m.amount || 0), 0);
    return carried + income - expense;
  }

  // Cuadra el saldo declarando cuánto tienes de verdad.
  // No edita el balance: registra un movimiento de ajuste por la diferencia.
  function openAdjustBalanceModal() {
    const current = getCurrentNet();

    UI.openModal({
      title: '⚖️ Ajustar saldo',
      okText: 'Registrar ajuste',
      bodyHTML: `
        <div class="adj-current">
          <span class="adj-current-lbl">Saldo según la app</span>
          <span class="adj-current-val">${formatCLP(current)}</span>
        </div>
        <label>¿Cuánto tienes realmente? (CLP)</label>
        <input type="number" id="adj-real" inputmode="numeric" placeholder="0" value="${current}" />
        <div class="adj-diff" id="adj-diff"></div>
        <label>Nota (opcional)</label>
        <input type="text" id="adj-note" placeholder="Ej: efectivo sin registrar" />
        <p class="settings-help" style="margin-top:10px">Se registrará como un movimiento de ajuste con la fecha de hoy. Puedes editarlo o borrarlo después.</p>
      `,
      onSave: () => {
        const real = parseFloat(document.getElementById('adj-real').value);
        if (isNaN(real)) { UI.toast('Ingresa un monto válido'); return false; }
        const diff = Math.round(real - current);
        if (diff === 0) { UI.toast('El saldo ya está cuadrado'); return; }
        const note = document.getElementById('adj-note').value.trim();
        const s = Storage.get();
        s.movements.push({
          id: Storage.uid(),
          type: diff > 0 ? 'income' : 'expense',
          name: 'Ajuste de saldo',
          category: 'ajuste',
          amount: Math.abs(diff),
          date: UI.todayKey(),
          note,
          recurringExpenseId: null,
          isAdjustment: true,
          createdAt: Date.now(),
        });
        Storage.save();
        render();
        renderDashboard();
        UI.toast(`Ajuste de ${diff > 0 ? '+' : '−'} ${formatCLP(Math.abs(diff))}`);
      }
    });

    setTimeout(() => {
      const input = document.getElementById('adj-real');
      const out = document.getElementById('adj-diff');
      if (!input || !out) return;
      const refresh = () => {
        const real = parseFloat(input.value);
        if (isNaN(real)) { out.textContent = ''; out.className = 'adj-diff'; return; }
        const diff = Math.round(real - current);
        if (diff === 0) {
          out.textContent = 'Sin diferencia · ya está cuadrado';
          out.className = 'adj-diff zero';
        } else {
          out.textContent = `Se registrará ${diff > 0 ? '+' : '−'} ${formatCLP(Math.abs(diff))}`;
          out.className = 'adj-diff ' + (diff > 0 ? 'positive' : 'negative');
        }
      };
      input.addEventListener('input', refresh);
      refresh();
      input.focus(); input.select();
    }, 80);
  }


  // Pagos pendientes en la vista "Hoy": solo lo que está vencido, vence hoy
  // o vence dentro de los próximos 3 días. Ordenado por urgencia. Aparece
  // únicamente si hay algo por pagar (si no, no muestra nada).
  function renderTodayPending() {
    const c = document.getElementById('today-pending');
    if (!isLive(c)) return;

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const curMk = getCurrentMonthKey();
    const pending = getAllPending();

    const items = [];
    pending.forEach(item => {
      const re = item.recurring;
      const mk = item.periodMk;
      const dueDateKey = getDueDateForRecurringInMonth(re, mk);
      let daysLeft; // <0 atrasado · 0 hoy · >0 faltan
      if (mk < curMk) {
        if (dueDateKey) {
          const dDue = new Date(dueDateKey + 'T00:00:00');
          daysLeft = -Math.max(1, Math.round((today - dDue) / 86400000));
        } else {
          daysLeft = -1; // arrastrado sin fecha: vencido
        }
      } else if (dueDateKey) {
        const dDue = new Date(dueDateKey + 'T00:00:00');
        daysLeft = Math.round((dDue - today) / 86400000);
      } else {
        return; // del mes actual sin fecha: no se puede ubicar, se omite en Hoy
      }
      if (daysLeft > 3) return; // aún lejos: no se muestra en Hoy
      items.push({ re, mk, daysLeft });
    });

    // En Hoy basta una línea por gasto recurrente: la de su período más
    // urgente (más atrasado). El desglose mes a mes vive en Finanzas.
    const byRe = new Map();
    items.forEach(it => {
      const prev = byRe.get(it.re.id);
      if (!prev || it.daysLeft < prev.daysLeft) byRe.set(it.re.id, it);
    });
    const collapsed = [...byRe.values()];

    if (collapsed.length === 0) { c.innerHTML = ''; return; }

    // Orden por urgencia: más atrasado primero
    collapsed.sort((a, b) => a.daysLeft - b.daysLeft);

    const total = collapsed.reduce((sum, it) => sum + (it.re.defaultAmount || 0), 0);
    const subtitle = `${collapsed.length} ${collapsed.length === 1 ? 'pendiente' : 'pendientes'}${total ? ` · ${formatCLP(total)}` : ''}`;

    const rows = collapsed.map(it => {
      const cat = getExpenseCategory(it.re.category);
      let tagClass, tagText;
      if (it.daysLeft < 0) { tagClass = 'overdue'; tagText = `Atrasado ${Math.abs(it.daysLeft)}d`; }
      else if (it.daysLeft === 0) { tagClass = 'today'; tagText = 'Vence hoy'; }
      else { tagClass = 'soon'; tagText = it.daysLeft === 1 ? 'Vence mañana' : `Vence en ${it.daysLeft}d`; }
      const amount = it.re.defaultAmount ? `~ ${formatCLP(it.re.defaultAmount)}` : 'Monto variable';
      const instTag = (it.re.installmentsTotal)
        ? `<span class="tp-inst">Cuota ${it.re.installmentsCurrent || 1}/${it.re.installmentsTotal}</span>`
        : '';
      return `
        <div class="tp-item ${tagClass}">
          <div class="tp-main">
            <div class="tp-name">${cat.icon} ${escapeHtml(it.re.name)}</div>
            <div class="tp-meta">
              <span class="tp-tag ${tagClass}">${tagText}</span>
              <span class="tp-amount">${amount}</span>
              ${instTag}
            </div>
          </div>
          <button class="tp-pay" data-tp-pay="${it.re.id}" data-tp-period="${it.mk}">Pagar</button>
        </div>`;
    }).join('');

    c.innerHTML = `
      <div class="section-card">
        <div class="section-head">
          <div>
            <div class="section-title">💰 Pagos pendientes</div>
            <div class="section-subtitle">${subtitle}</div>
          </div>
          <button class="section-icon-btn" data-go="finance" aria-label="Ir a Finanzas"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg></button>
        </div>
        <div class="tp-list">${rows}</div>
      </div>`;

    c.querySelectorAll('[data-tp-pay]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openPayRecurringModal(btn.dataset.tpPay, btn.dataset.tpPeriod);
      });
    });
  }

  function renderMonthMovements() {
    const c = document.getElementById('finance-movements-list');
    if (!isLive(c)) return;
    const mk = getCurrentMonthKey();
    const { start, end } = getMonthRange(mk);
    const movs = (Storage.get().movements || []).filter(m =>
      m.date && m.date >= start && m.date <= end
    );
    if (movs.length === 0) {
      c.innerHTML = '<div class="empty">Sin movimientos registrados este mes</div>';
      return;
    }
    movs.sort((a, b) => {
      // Primero por fecha descendente (más reciente arriba)
      const dateCmp = (b.date || '').localeCompare(a.date || '');
      if (dateCmp !== 0) return dateCmp;
      // Mismo día: por orden de creación descendente (último ingresado primero)
      const ca = a.createdAt || 0;
      const cb = b.createdAt || 0;
      return cb - ca;
    });
    // Modo solo lectura: edición/eliminación se hace desde Mi Sistema → Finanzas
    c.innerHTML = movs.map(m => renderMovementItem(m, { readonly: true })).join('');
  }

  // Modal "Pagar recurrente"
  function openPayRecurringModal(recurringId, periodMk) {
    const s = Storage.get();
    const re = (s.recurringExpenses || []).find(x => x.id === recurringId);
    if (!re) return;
    let zeroConfirmed = false; // para confirmar un pago de $0
    const cat = getExpenseCategory(re.category);
    // Si es del mes en curso → fecha de hoy. Si es atrasado → hoy igualmente (el pago se hace HOY, va al balance de HOY).
    const defaultDate = UI.todayKey();

    const curMk = getCurrentMonthKey();
    const periodHint = (periodMk && periodMk !== curMk)
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
        renderDashboard();
        render();
        if (typeof App !== 'undefined' && App.refreshKPIs) App.refreshKPIs();
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

    // Los ajustes de saldo quedan fuera del análisis: son descuadres, no hábitos de gasto
    const movs = (Storage.get().movements || []).filter(m =>
      m.date && m.date >= start && m.date <= end && !m.isAdjustment
    );
    const expenses = movs.filter(m => m.type === 'expense');
    const incomes = movs.filter(m => m.type === 'income');

    const income = incomes.reduce((s2, m) => s2 + (m.amount || 0), 0);
    const expense = expenses.reduce((s2, m) => s2 + (m.amount || 0), 0);
    const net = income - expense;
    const netCls = net > 0 ? 'positive' : (net < 0 ? 'negative' : 'zero');

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

    // Sin movimientos: no tiene sentido pintar gráficos en cero
    if (movs.length === 0) {
      c.innerHTML = nav +
        '<div class="empty" style="margin:22px 0">Sin movimientos registrados en este mes</div>' +
        `<div class="analysis-block">
           <div class="analysis-block-title">Ingresos vs gastos · 6 meses hasta ${monthShort(mk)}</div>
           ${renderCompareBars(mk)}
         </div>`;
      bindAnalysis(c);
      return;
    }

    const summary = `
      <div class="m-summary">
        <div class="ms-cell"><span class="ms-val income">+ ${formatCLP(income)}</span><span class="ms-lbl">Ingresos</span></div>
        <div class="ms-cell"><span class="ms-val expense">− ${formatCLP(expense)}</span><span class="ms-lbl">Gastos</span></div>
        <div class="ms-cell"><span class="ms-val ${netCls}">${net > 0 ? '+ ' : (net < 0 ? '− ' : '')}${formatCLP(Math.abs(net))}</span><span class="ms-lbl">Balance</span></div>
      </div>`;

    c.innerHTML = `
      ${nav}
      ${summary}
      <div class="analysis-block">
        <div class="analysis-block-title">Gastos por categoría</div>
        ${renderExpenseDonut(expenses, mk)}
      </div>
      <div class="analysis-block">
        <div class="analysis-block-title">Ingresos del mes</div>
        ${renderIncomeTable(incomes)}
      </div>
      <div class="analysis-block">
        <div class="analysis-block-title">Ingresos vs gastos · 6 meses hasta ${monthShort(mk)}</div>
        ${renderCompareBars(mk)}
      </div>
    `;
    bindAnalysis(c);
  }

  function bindAnalysis(c) {
    const cur = analysisMk || getCurrentMonthKey();
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

    // Construir slices ordenados por monto desc
    const entries = Object.entries(byCat)
      .map(([id, val]) => ({ cat: { ...getExpenseCategory(id), id }, val, pct: val / total }))
      .sort((a, b) => b.val - a.val);

    // Paleta basada en variables existentes + tonos
    const palette = ['#f5c842', '#4ade80', '#60a5fa', '#a78bfa', '#ef4444', '#f0abfc', '#34d399'];

    // SVG donut: más gruesa, mejor proporcionada
    const SIZE = 180;
    const cx = SIZE / 2, cy = SIZE / 2;
    const r = 64;
    const sw = 28;
    const C = 2 * Math.PI * r;
    let offset = 0;
    const slices = entries.map((e, idx) => {
      const dash = C * e.pct;
      const gap = C - dash;
      const color = palette[idx % palette.length];
      // Pequeño separador visual entre slices (gap de 1.5)
      const visualDash = Math.max(0, dash - 1.5);
      const visualGap = gap + 1.5;
      const el = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="butt"
        stroke-dasharray="${visualDash} ${visualGap}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})" />`;
      offset += dash;
      return el;
    }).join('');

    const legend = entries.map((e, idx) => {
      const color = palette[idx % palette.length];
      const pctTxt = Math.round(e.pct * 100);
      // Contraste contra el promedio de los otros meses con datos
      let delta = '';
      if (avgData && avgData.avg[e.cat.id] > 0) {
        const a = avgData.avg[e.cat.id];
        const diff = Math.round(((e.val - a) / a) * 100);
        if (Math.abs(diff) >= 5) {
          const over = diff > 0;
          delta = `<div class="donut-delta ${over ? 'over' : 'under'}">${over ? '▲' : '▼'} ${Math.abs(diff)}% ${over ? 'sobre' : 'bajo'} tu promedio</div>`;
        } else {
          delta = '<div class="donut-delta even">= en tu promedio</div>';
        }
      }
      return `
        <div class="donut-legend-row">
          <span class="donut-dot" style="background:${color}"></span>
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
            <div class="donut-total-label">Total gastos</div>
            <div class="donut-total">${formatCLP(total)}</div>
          </div>
        </div>
        <div class="donut-legend">${legend}</div>
      </div>
    `;
  }

  function renderIncomeTable(incomes) {
    if (incomes.length === 0) {
      return '<div class="empty" style="margin:6px 0">Sin ingresos este mes</div>';
    }
    const byCat = {};
    incomes.forEach(i => {
      const id = i.category || 'otros';
      if (!byCat[id]) byCat[id] = 0;
      byCat[id] += (i.amount || 0);
    });
    const total = Object.values(byCat).reduce((s, v) => s + v, 0);
    const entries = Object.entries(byCat)
      .map(([id, val]) => ({ cat: getIncomeCategory(id), val }))
      .sort((a, b) => b.val - a.val);

    return `
      <div class="income-table">
        ${entries.map(e => `
          <div class="income-row">
            <span class="income-cat">${e.cat.icon} ${e.cat.name}</span>
            <span class="income-val">${formatCLP(e.val)}</span>
          </div>
        `).join('')}
        <div class="income-row total">
          <span class="income-cat">Total</span>
          <span class="income-val">${formatCLP(total)}</span>
        </div>
      </div>
    `;
  }

  function renderCompareBars(endMk) {
    const months = getLast6Months(endMk);
    const allMovs = Storage.get().movements || [];
    const data = months.map(mk => {
      const { start, end } = getMonthRange(mk);
      const inMovs = allMovs.filter(m => m.date && m.date >= start && m.date <= end && !m.isAdjustment);
      return {
        mk,
        income: inMovs.filter(m => m.type === 'income').reduce((s, m) => s + (m.amount || 0), 0),
        expense: inMovs.filter(m => m.type === 'expense').reduce((s, m) => s + (m.amount || 0), 0),
      };
    });
    if (data.every(d => d.income === 0 && d.expense === 0)) {
      return '<div class="empty" style="margin:6px 0">Sin datos suficientes</div>';
    }
    const max = Math.max(...data.flatMap(d => [d.income, d.expense]), 1);
    const curMk = endMk || getCurrentMonthKey();

    // Dimensiones generosas
    const w = 320, h = 200;
    const padL = 8, padR = 8, padT = 18, padB = 36;
    const chartW = w - padL - padR;
    const chartH = h - padT - padB;
    const baseY = h - padB;

    // Líneas guía (3 niveles: 25%, 50%, 75%, 100%)
    const guides = [0.25, 0.5, 0.75, 1].map(pct => {
      const y = baseY - chartH * pct;
      return `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="var(--border-soft)" stroke-width="0.5" stroke-dasharray="2 3" opacity="0.5"/>`;
    }).join('');

    // Etiqueta de valor máximo
    const maxLabel = `<text x="${padL + 2}" y="${padT + 8}" font-family="ui-monospace" font-size="9" fill="var(--text-faint)" text-anchor="start">máx ${formatCLP(max)}</text>`;

    const slotW = chartW / data.length;
    const barW = (slotW - 8) / 2;

    // Helper: monto formateado en versión muy corta para etiquetas
    const shortAmount = (n) => {
      if (n === 0) return '';
      if (n >= 1000000) return Math.round(n / 100000) / 10 + 'M';
      if (n >= 1000) return Math.round(n / 1000) + 'k';
      return String(Math.round(n));
    };

    const bars = data.map((d, i) => {
      const slotX = padL + i * slotW + 4;
      const inH = max > 0 ? (d.income / max) * chartH : 0;
      const exH = max > 0 ? (d.expense / max) * chartH : 0;
      const inY = baseY - inH;
      const exY = baseY - exH;
      const isCurrent = d.mk === curMk;
      const monthLbl = monthShort(d.mk);
      const monthCls = isCurrent ? 'chart-month-current' : 'chart-month-label';
      const net = d.income - d.expense;
      const netClass = net >= 0 ? 'positive' : 'negative';
      const netSign = net > 0 ? '+' : (net < 0 ? '−' : '');
      // Highlight para mes actual: fondo sutil de la columna
      const highlight = isCurrent
        ? `<rect x="${slotX - 3}" y="${padT}" width="${barW * 2 + 8}" height="${chartH + 4}" rx="4" fill="var(--accent-yellow)" opacity="0.06"/>`
        : '';
      // Etiquetas de monto encima de cada barra (solo si hay espacio)
      const inLabel = d.income > 0 && inH > 14
        ? `<text x="${slotX + barW / 2}" y="${inY - 3}" text-anchor="middle" font-family="ui-monospace" font-size="8" fill="var(--accent-green)" font-weight="700">${shortAmount(d.income)}</text>`
        : '';
      const exLabel = d.expense > 0 && exH > 14
        ? `<text x="${slotX + barW + 2 + barW / 2}" y="${exY - 3}" text-anchor="middle" font-family="ui-monospace" font-size="8" fill="var(--accent-red)" font-weight="700">${shortAmount(d.expense)}</text>`
        : '';
      // Balance neto debajo del mes
      const netY = baseY + 28;
      const netColor = net >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
      const netLabel = (d.income > 0 || d.expense > 0)
        ? `<text x="${slotX + barW + 1}" y="${netY}" text-anchor="middle" font-family="ui-monospace" font-size="8" fill="${netColor}" font-weight="700">${netSign}${shortAmount(Math.abs(net))}</text>`
        : '';
      return `
        ${highlight}
        <rect class="bar-hit" data-jump="${d.mk}" x="${padL + i * slotW}" y="${padT}" width="${slotW}" height="${chartH + padB - 6}" fill="transparent" style="cursor:pointer" />
        <rect class="chart-bar" x="${slotX}" y="${inY}" width="${barW}" height="${inH}" rx="2" fill="var(--accent-green)" opacity="${isCurrent ? '1' : '0.78'}" />
        <rect class="chart-bar" x="${slotX + barW + 2}" y="${exY}" width="${barW}" height="${exH}" rx="2" fill="var(--accent-red)" opacity="${isCurrent ? '1' : '0.78'}" />
        ${inLabel}
        ${exLabel}
        <text x="${slotX + barW + 1}" y="${baseY + 14}" text-anchor="middle" font-family="ui-monospace" font-size="9" fill="${isCurrent ? 'var(--accent-yellow)' : 'var(--text-dim)'}" font-weight="${isCurrent ? '700' : '400'}">${monthLbl}</text>
        ${netLabel}
      `;
    }).join('');

    // Eje base (línea horizontal en 0)
    const baseLine = `<line x1="${padL}" y1="${baseY}" x2="${w - padR}" y2="${baseY}" stroke="var(--border)" stroke-width="1"/>`;

    return `
      <div class="chart-bars-wrap">
        <svg viewBox="0 0 ${w} ${h}" width="100%" preserveAspectRatio="xMidYMid meet" style="overflow:visible">
          ${guides}
          ${maxLabel}
          ${bars}
          ${baseLine}
        </svg>
        <div class="chart-legend-row">
          <span><span class="dot-green"></span> Ingresos</span>
          <span><span class="dot-red"></span> Gastos</span>
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

  // Mes más antiguo con movimientos (límite para navegar hacia atrás)
  function firstMonthWithData() {
    const dates = (Storage.get().movements || []).map(m => m.date).filter(Boolean).sort();
    return dates.length ? dates[0].slice(0, 7) : getCurrentMonthKey();
  }

  // Promedio de gasto por categoría en los demás meses con datos.
  // El denominador son todos los meses con gasto, no solo aquellos donde
  // apareció la categoría: un mes sin ese gasto cuenta como cero.
  function categoryAverages(excludeMk) {
    const byMonth = {};
    (Storage.get().movements || []).forEach(m => {
      if (m.isAdjustment || m.type !== 'expense' || !m.date) return;
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

    // Agrupar movements por mes (excluyendo mes en curso)
    const groups = {};
    allMovs.forEach(m => {
      if (!m.date) return;
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
      const movs = groups[mk].slice().sort((a, b) => {
        const dateCmp = (b.date || '').localeCompare(a.date || '');
        if (dateCmp !== 0) return dateCmp;
        const ca = a.createdAt || 0;
        const cb = b.createdAt || 0;
        return cb - ca;
      });
      const income = movs.filter(m => m.type === 'income').reduce((s, m) => s + (m.amount || 0), 0);
      const expense = movs.filter(m => m.type === 'expense').reduce((s, m) => s + (m.amount || 0), 0);
      const net = income - expense;
      const netClass = net > 0 ? 'positive' : (net < 0 ? 'negative' : 'zero');
      const netSign = net > 0 ? '+' : (net < 0 ? '−' : '');
      const monthLabel = new Date(mk + '-15T12:00:00').toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
      const open = (archiveOpen[mk] === true);

      return `
        <div class="archive-month ${open ? 'open' : ''}">
          <button class="archive-month-head" data-archive-toggle="${mk}" aria-expanded="${open}">
            <span class="archive-month-arrow">${open ? '▼' : '▶'}</span>
            <span class="archive-month-title">${monthLabel}</span>
            <span class="archive-month-meta">
              <span class="archive-amt income">+${formatCLP(income)}</span>
              <span class="archive-amt expense">−${formatCLP(expense)}</span>
              <span class="archive-amt net ${netClass}">${netSign}${formatCLP(Math.abs(net))}</span>
            </span>
          </button>
          <div class="archive-month-body" ${open ? '' : 'hidden'}>
            ${movs.map(m => renderMovementItem(m)).join('')}
          </div>
        </div>
      `;
    };

    // Agrupar los meses por AÑO. Año más reciente abierto por defecto.
    const todayYear = String(new Date().getFullYear());
    const isYearOpen = (yk) => (yk in archiveYearOpen) ? archiveYearOpen[yk] : (yk === todayYear);
    const yearKeys = [...new Set(monthKeys.map(mk => mk.slice(0, 4)))].sort((a, b) => b.localeCompare(a));

    c.innerHTML = yearKeys.map(yk => {
      const monthsOfYear = monthKeys.filter(mk => mk.slice(0, 4) === yk);
      // Resumen del año: ingresos, gastos y neto
      const yMovs = monthsOfYear.flatMap(mk => groups[mk]);
      const yInc = yMovs.filter(m => m.type === 'income').reduce((s, m) => s + (m.amount || 0), 0);
      const yExp = yMovs.filter(m => m.type === 'expense').reduce((s, m) => s + (m.amount || 0), 0);
      const yNet = yInc - yExp;
      const yNetClass = yNet > 0 ? 'positive' : (yNet < 0 ? 'negative' : 'zero');
      const yNetSign = yNet > 0 ? '+' : (yNet < 0 ? '−' : '');
      const yOpen = isYearOpen(yk);
      return `
        <div class="hist-year ${yOpen ? 'open' : ''}">
          <button class="hist-year-label" data-archive-year-toggle="${yk}" type="button">
            <span class="hist-year-name">${yk}</span>
            <span class="archive-amt net ${yNetClass}" style="margin-left:auto">${yNetSign}${formatCLP(Math.abs(yNet))}</span>
            <span class="hist-year-chevron">▾</span>
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

  let archiveOpen = {};
  let archiveYearOpen = {};

  return {
    render,
    renderDashboard,
    renderTodayPending,
    renderAnalysis,
    openAnalysis,
    renderArchive,
    openMovementModal,
    openNewExpense,
    openNewIncome,
    openAdjustBalanceModal,
    EXPENSE_CATEGORIES,
    INCOME_CATEGORIES,
    RECURRENCES,
    getExpenseCategory,
    getIncomeCategory,
    getRecurrence,
    formatCLP,
  };
})();
