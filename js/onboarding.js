/* ============================================
   ONBOARDING
   ============================================ */
const Onboarding = (() => {
  function start() {
    const ov = document.getElementById('onboarding-overlay');
    document.getElementById('onb-step-1').hidden = false;
    document.getElementById('onb-step-2').hidden = true;
    document.getElementById('onb-name').value = Storage.get().user.name || '';
    renderTemplates();
    ov.hidden = false;
  }

  function close() {
    document.getElementById('onboarding-overlay').hidden = true;
    Storage.get().settings.onboarded = true;
    Storage.save();
  }

  function next() {
    const name = document.getElementById('onb-name').value.trim();
    Storage.get().user.name = name;
    Storage.save();
    document.getElementById('onb-step-1').hidden = true;
    document.getElementById('onb-step-2').hidden = false;
  }

  let selectedTemplate = null;

  function renderTemplates() {
    const c = document.getElementById('onb-templates');
    const tpls = Templates.getAll();
    c.innerHTML = tpls.map(t => {
      const habitCount = t.composite
        ? t.composite.reduce((sum, id) => sum + (tpls.find(x => x.id === id)?.habits?.length || 0), 0)
        : (t.habits || []).length;
      const goalCount = t.composite
        ? t.composite.reduce((sum, id) => sum + (tpls.find(x => x.id === id)?.goals?.length || 0), 0)
        : (t.goals || []).length;
      return `
        <button class="onb-template" data-tpl="${t.id}">
          <span class="onb-tpl-icon">${t.icon}</span>
          <div class="onb-tpl-body">
            <div class="onb-tpl-title">${t.title}</div>
            <div class="onb-tpl-desc">${t.desc}</div>
            <div class="onb-tpl-count">${habitCount} hábitos · ${goalCount} metas</div>
          </div>
        </button>
      `;
    }).join('');

    c.querySelectorAll('.onb-template').forEach(btn => {
      btn.addEventListener('click', () => {
        c.querySelectorAll('.onb-template').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedTemplate = btn.dataset.tpl;
      });
    });
  }

  function finish() {
    if (selectedTemplate) {
      const r = Templates.apply(selectedTemplate);
      UI.toast(`✨ ${r.habits} hábitos y ${r.goals} metas cargadas`);
    }
    close();
    setTimeout(() => location.reload(), 600);
  }

  function skipTemplates() {
    close();
    location.reload();
  }

  function skipAll() {
    close();
    location.reload();
  }

  function openFromSettings() {
    UI.openModal({
      title: '📦 Plantillas',
      okText: 'Cerrar',
      bodyHTML: `
        <p style="color:var(--text-dim);font-size:13px;margin-bottom:14px">Selecciona una plantilla para agregar hábitos y metas. Se suman a lo que ya tienes (no se reemplaza nada).</p>
        <div id="settings-templates"></div>
      `,
      onSave: () => true
    });

    setTimeout(() => {
      const c = document.getElementById('settings-templates');
      if (!c) return;
      const tpls = Templates.getAll();
      c.innerHTML = tpls.map(t => {
        const habitCount = t.composite
          ? t.composite.reduce((sum, id) => sum + (tpls.find(x => x.id === id)?.habits?.length || 0), 0)
          : (t.habits || []).length;
        const goalCount = t.composite
          ? t.composite.reduce((sum, id) => sum + (tpls.find(x => x.id === id)?.goals?.length || 0), 0)
          : (t.goals || []).length;
        return `
          <button class="onb-template" data-tpl="${t.id}" style="width:100%;margin-bottom:8px">
            <span class="onb-tpl-icon">${t.icon}</span>
            <div class="onb-tpl-body">
              <div class="onb-tpl-title">${t.title}</div>
              <div class="onb-tpl-desc">${t.desc}</div>
              <div class="onb-tpl-count">${habitCount} hábitos · ${goalCount} metas</div>
            </div>
          </button>
        `;
      }).join('');

      c.querySelectorAll('.onb-template').forEach(btn => {
        btn.addEventListener('click', () => {
          const tplId = btn.dataset.tpl;
          const tpl = Templates.getAll().find(t => t.id === tplId);
          UI.confirm2({
            title: `Aplicar "${tpl.title}"`,
            message: `Se agregarán los hábitos y metas de esta plantilla a tu dashboard. ¿Continuar?`,
            okText: 'Sí, agregar',
            onConfirm: () => {
              const r = Templates.apply(tplId);
              UI.toast(`✨ +${r.habits} hábitos, +${r.goals} metas`);
              setTimeout(() => location.reload(), 700);
            }
          });
        });
      });
    }, 80);
  }

  function bindUI() {
    document.getElementById('onb-next-1').addEventListener('click', next);
    document.getElementById('onb-finish').addEventListener('click', finish);
    document.getElementById('onb-skip-templates').addEventListener('click', skipTemplates);
    document.getElementById('onb-skip-all').addEventListener('click', skipAll);
  }

  document.addEventListener('DOMContentLoaded', bindUI);

  return { start, openFromSettings };
})();
