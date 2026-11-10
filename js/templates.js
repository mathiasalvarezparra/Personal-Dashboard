/* ============================================
   TEMPLATES (plantillas predefinidas)
   ============================================ */
const Templates = (() => {

  const TEMPLATES = [
    {
      id: 'lectura',
      icon: '📚',
      title: 'Lector ávido',
      desc: 'Hábito de lectura diario conectado con metas mensuales y anuales de páginas/libros leídos.',
      goals: [
        { name: 'Leer 100 páginas esta semana', horizon: 'week', area: 'crecimiento', target: 100, unit: 'páginas' },
        { name: 'Leer 1 libro este mes', horizon: 'month', area: 'crecimiento', target: 1, unit: 'libro' },
        { name: 'Leer 12 libros este año', horizon: 'year', area: 'crecimiento', target: 12, unit: 'libros' },
      ],
      habits: [
        { name: 'Leer 20 páginas', icon: '📚', color: '#a78bfa', area: 'crecimiento', timeOfDay: 'noche', frequency: { type: 'daily' }, linkGoalIndex: 0, defaultIncrement: 20 },
      ],
    },
    {
      id: 'salud',
      icon: '💪',
      title: 'Más saludable',
      desc: 'Hábitos físicos, hidratación, sueño y descanso. Metas de entrenamientos y actividad.',
      goals: [
        { name: 'Entrenar 4 veces esta semana', horizon: 'week', area: 'salud', target: 4, unit: 'sesiones' },
        { name: '12 entrenamientos este mes', horizon: 'month', area: 'salud', target: 12, unit: 'sesiones' },
      ],
      habits: [
        { name: 'Tomar 2 litros de agua', icon: '💧', color: '#60a5fa', area: 'salud', timeOfDay: 'mañana', frequency: { type: 'daily' } },
        { name: 'Estiramiento mañanero', icon: '🤸', color: '#4ade80', area: 'salud', timeOfDay: 'mañana', frequency: { type: 'daily' } },
        { name: 'Entrenar', icon: '🏋️', color: '#ef4444', area: 'salud', timeOfDay: 'tarde', frequency: { type: 'days', days: [1, 3, 5] }, linkGoalIndex: 0, defaultIncrement: 1 },
        { name: 'Dormir antes de medianoche', icon: '😴', color: '#a78bfa', area: 'salud', timeOfDay: 'noche', frequency: { type: 'daily' } },
      ],
    },
    {
      id: 'finanzas',
      icon: '💰',
      title: 'Finanzas en orden',
      desc: 'Revisión diaria, control de gastos y metas de ahorro mensuales y anuales.',
      goals: [
        { name: 'Ahorrar este mes', horizon: 'month', area: 'finanzas', target: 300000, unit: 'CLP' },
        { name: 'Construir fondo de emergencia', horizon: 'year', area: 'finanzas', target: 3000000, unit: 'CLP' },
      ],
      habits: [
        { name: 'Revisar gastos del día', icon: '💰', color: '#f5c842', area: 'finanzas', timeOfDay: 'tarde', frequency: { type: 'daily' } },
        { name: 'No pedir delivery hoy', icon: '🍱', color: '#fb923c', area: 'finanzas', timeOfDay: 'tarde', frequency: { type: 'days', days: [1,2,3,4,5] } },
      ],
    },
    {
      id: 'productividad',
      icon: '🚀',
      title: 'Más productivo',
      desc: 'Foco profundo, planificación diaria y revisión semanal para avanzar en lo importante.',
      goals: [
        { name: 'Cerrar 3 tareas importantes esta semana', horizon: 'week', area: 'carrera', target: 3, unit: 'tareas' },
      ],
      habits: [
        { name: 'Planificar el día', icon: '📋', color: '#60a5fa', area: 'carrera', timeOfDay: 'mañana', frequency: { type: 'daily' } },
        { name: 'Bloque de foco profundo (90min)', icon: '🎯', color: '#a78bfa', area: 'carrera', timeOfDay: 'mañana', frequency: { type: 'days', days: [1,2,3,4,5] } },
        { name: 'Revisar pendientes y agenda', icon: '✅', color: '#f5c842', area: 'carrera', timeOfDay: 'tarde', frequency: { type: 'days', days: [1,2,3,4,5] } },
      ],
    },
    {
      id: 'bienestar',
      icon: '🧘',
      title: 'Bienestar mental',
      desc: 'Meditación, gratitud, journaling y conexión con personas importantes.',
      goals: [
        { name: 'Meditar 5 días esta semana', horizon: 'week', area: 'crecimiento', target: 5, unit: 'días' },
      ],
      habits: [
        { name: 'Meditar 10 minutos', icon: '🧘', color: '#a78bfa', area: 'crecimiento', timeOfDay: 'mañana', frequency: { type: 'daily' }, linkGoalIndex: 0, defaultIncrement: 1 },
        { name: 'Journaling antes de dormir', icon: '📓', color: '#f0abfc', area: 'crecimiento', timeOfDay: 'noche', frequency: { type: 'daily' } },
        { name: 'Llamar a alguien que quieres', icon: '📞', color: '#ef4444', area: 'relaciones', timeOfDay: 'noche', frequency: { type: 'days', days: [3, 0] } },
      ],
    },
    {
      id: 'completo',
      icon: '✨',
      title: 'Sistema completo',
      desc: 'Combina lo mejor de todos los anteriores. Ideal si quieres arrancar fuerte. Puedes ajustar después.',
      composite: ['salud', 'lectura', 'productividad', 'bienestar'],
    },
  ];

  function getAll() { return TEMPLATES; }

  function apply(templateId) {
    const tpl = TEMPLATES.find(t => t.id === templateId);
    if (!tpl) return { habits: 0, goals: 0 };

    // Si es compuesta, aplicar todas las subplantillas
    if (tpl.composite) {
      let totalH = 0, totalG = 0;
      tpl.composite.forEach(id => {
        const r = apply(id);
        totalH += r.habits;
        totalG += r.goals;
      });
      return { habits: totalH, goals: totalG };
    }

    const state = Storage.get();
    const createdGoals = [];

    // Crear metas primero
    (tpl.goals || []).forEach(g => {
      const goal = {
        id: Storage.uid(),
        name: g.name,
        horizon: g.horizon,
        area: g.area,
        target: g.target || 0,
        unit: g.unit || '',
        current: 0,
        done: false,
        archived: false,
        createdAt: Date.now(),
      };
      state.goals.push(goal);
      createdGoals.push(goal);
    });

    // Crear hábitos (vinculados a las metas si corresponde)
    (tpl.habits || []).forEach(h => {
      const linkedGoalId = (h.linkGoalIndex !== undefined && createdGoals[h.linkGoalIndex])
        ? createdGoals[h.linkGoalIndex].id
        : null;
      state.habits.push({
        id: Storage.uid(),
        name: h.name,
        icon: h.icon,
        color: h.color,
        area: h.area,
        timeOfDay: h.timeOfDay,
        frequency: h.frequency,
        linkedGoalId,
        defaultIncrement: h.defaultIncrement || null,
        createdAt: Date.now(),
        history: [],
        contributions: {},
      });
    });

    Storage.save();
    return { habits: (tpl.habits || []).length, goals: (tpl.goals || []).length };
  }

  return { getAll, apply };
})();
