# Modelo de datos

Fuente de verdad: `js/storage.js` (`Storage.defaultState` y `Storage.load()`). Todo lo demás en este documento está derivado de leer el código real de `js/*.js`.

## Dónde vive

`localStorage['mi_dashboard_v1']` → JSON del objeto `state` completo. Se lee una sola vez al cargar la página (`Storage.load()` al definir el módulo) y se escribe en cada `Storage.save()`.

## Versión y migraciones

- `state.version` (hoy **`2`**) versiona los cambios de esquema incompatibles. `Storage.migrate()` aplica las migraciones pendientes según la versión, tanto al cargar (`Storage.load()`) como al importar un respaldo (`Storage.importJSON()`), ambos vía `Storage.hydrate()`:
  - **v1 → v2** — hábitos `frequency.type: 'weekly'` ("X veces por semana") pasan a `{ type: 'days', days: suggestedDays (o los 7 días si estaba vacío), weeklyMin: timesPerWeek (sin superar la cantidad de días) }`. `history`, `notes`, `contributions`, `dailyProgress` y `linkedGoalId` no se tocan. El tipo `'weekly'` ya no existe en el resto del código.
- Las migraciones reales que existen hoy son **one-shot basadas en flags dentro de `settings`**, ejecutadas al inicio (`App.init()`), no en `Storage.load()`:
  - `migrateAreas()` (`js/app.js`): agrega el área `espiritualidad` a usuarios existentes. Flag: `settings.areasEspiritualidadAdded`.
  - `migrateRemoveQuarter()` (`js/app.js`): elimina metas con `horizon: 'quarter'` (se descartó ese horizonte) y normaliza `recurrence: 'quarterly'` huérfana a `'none'`. Flag: `settings.quarterRemoved`.
  - Migración de `settings.lastWeekKey` (viejo) → `settings.lastPeriodKeys.week` (nuevo), hecha inline en `GoalRollover` la primera vez que corre.
- Dentro de `Storage.load()` sí hay una normalización que corre siempre (no es one-shot, no tiene flag): si un hábito no tiene `dailyTarget` válido, se le asigna `dailyTarget: 1, unit: 'sesión'`, y si tiene `history` sin `dailyProgress` correspondiente, se completa `dailyProgress[día] = dailyTarget`. Esto existe porque los hábitos fueron binarios (hecho/no hecho) antes de volverse cuantitativos.

## Entidades

### `settings` (objeto único, no array)

| Campo | Tipo | Valores / notas |
|---|---|---|
| `theme` | string | `'dark'` \| `'light'` |
| `lastBackup` | number\|null | timestamp del último `exportJSON()` |
| `backupReminderDismissed` | any\|null | cuándo se descartó el recordatorio de backup |
| `onboarded` | boolean | si ya pasó por `Onboarding` |
| `lastWeekKey` | string\|null | **deprecado**, migrado a `lastPeriodKeys.week` |
| `vacation` | object\|null | `{ start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }` |
| `pendingWeekClose` | string\|null | **Legado** (ya no se lee ni se escribe; puede quedar en datos antiguos): marcaba una semana terminada sin cerrar |
| `areasEspiritualidadAdded` | boolean | flag de migración (ver arriba) |
| `quarterRemoved` | boolean | flag de migración (ver arriba) |
| `lastPeriodKeys` | object | `{ week?, month?, year?: string }`, último período procesado por `GoalRollover` |
| `monthlyBudget` | number\|null | presupuesto de gasto mensual en CLP, **sin contar Ahorro**. `null` = sin presupuesto |
| `categoryBudgets` | object | `{ [categoryId]: number }` límite mensual en CLP por categoría de gasto (nunca `inversion`). Vacío `{}` = sin límites; una categoría ausente = sin límite |
| `monthlySavingsGoal` | number\|null | meta de ahorro mensual en CLP (categoría `inversion` / Ahorro). `null` = sin meta |

Ejemplo de los campos del plan de Finanzas:

```json
{
  "monthlyBudget": 600000,
  "categoryBudgets": { "alimentacion": 200000, "ocio": 50000 },
  "monthlySavingsGoal": 150000
}
```

Los tres campos están en `defaultState.settings`; el merge de un nivel de `Storage.load()` se los agrega a los datos existentes (no hizo falta subir `version`). Se editan en Movimientos › Plan y se guardan al salir de cada campo. "Gastado" del mes = gastos registrados (`Finance.isTrackedExpense`) excepto Ahorro; "Ahorrado" = gastos en Ahorro.

Leído/escrito por: casi todos los módulos leen `settings.theme`/`vacation`; `App` escribe las migraciones; `GoalRollover` escribe `lastPeriodKeys`; `Onboarding` escribe `onboarded`; `Vacation` escribe `vacation`; `Finance` lee y escribe `monthlyBudget`, `categoryBudgets` y `monthlySavingsGoal`.

### `areas` (array, catálogo fijo editable)

```json
{ "id": "salud", "name": "Salud", "icon": "💪", "color": "#4ade80" }
```
8 áreas por defecto (`salud`, `finanzas`, `carrera`, `crecimiento`, `relaciones`, `creatividad`, `hogar`, `espiritualidad`). `habit.area` y `goal.area` referencian `area.id`. Leído por `Habits`, `Goals`; escrito solo por la migración `migrateAreas` y por configuración manual (si existe UI para editar áreas, no se encontró — hoy es básicamente de solo lectura en runtime).

### `habits` (array)

```json
{
  "id": "m3k2j1", "name": "Leer", "icon": "📖", "color": "#f5c842",
  "area": "crecimiento",
  "frequency": { "type": "daily" },
  "linkedGoalId": null, "defaultIncrement": 1,
  "dailyTarget": 20, "unit": "páginas",
  "createdAt": 1732000000000,
  "history": ["2026-11-01", "2026-11-02"],
  "contributions": { "2026-11-02": 20 },
  "dailyProgress": { "2026-11-02": 20 },
  "notes": { "2026-11-02": "Capítulo 3" },
  "_completedAt": { "2026-11-02": 1732000500000 }
}
```

| Campo | Tipo | Notas |
|---|---|---|
| `frequency` | object | `{ type: 'daily' }` o `{ type: 'days', days: [0-6] }` (0=domingo): días en que aparece. Ambos con `weeklyMin` opcional (ver abajo) |
| `timeOfDay` | string\|null\|undefined | `'mañana'` \| `'tarde'` \| `'noche'`; vacío = "Cualquier momento". Agrupa la lista de Hoy |
| `archived` | boolean\|undefined | `true` si está archivado (opcional; ausente = activo) |
| `archivedAt` | number\|undefined | timestamp del archivado actual (solo mientras `archived: true`) |
| `archivedRanges` | `{ from, to }[]`\|undefined | períodos pasados en que estuvo archivado (`YYYY-MM-DD`, inclusive). Se agrega uno al reactivar; esos días cuentan como "no aplica" |
| `linkedGoalId` | string\|null | → `goals[].id` (ver Relaciones) |
| `defaultIncrement` | number | paso del botón "+" |
| `dailyTarget` / `unit` | number / string | meta diaria cuantitativa (todos los hábitos son cuantitativos; binario = `dailyTarget: 1`) |
| `history` | string[] | fechas (`YYYY-MM-DD`) en que se alcanzó el target del día |
| `dailyProgress` | object | `{ fecha: cantidadAcumulada }` |
| `contributions` | object | `{ fecha: cantidad }` aportada a `linkedGoalId` ese día (trazabilidad, para poder deshacer) |
| `notes` | object | `{ fecha: texto }` nota opcional al registrar |
| `_completedAt` | object | `{ fecha: timestamp }`, pese al prefijo `_` **sí se persiste** (se usa para ordenar la lista de hoy) |

**Mínimo semanal para la racha (`frequency.weeklyMin`)** — ejemplo:

```json
{
  "id": "sp1", "name": "Deporte", "frequency": { "type": "days", "days": [1, 2, 3, 4, 5], "weeklyMin": 3 },
  "timeOfDay": "tarde", "dailyTarget": 1, "unit": "sesión",
  "history": ["2026-11-10", "2026-11-11"]
}
```

- `weeklyMin` es opcional: entero entre 1 y la cantidad de días en que aparece (`'daily'` = 7). Ausente = racha diaria estricta, como siempre.
- **Solo flexibiliza la racha, nunca el % del día:** el hábito aparece en Enfoque y cuenta en el % del día y los KPIs todos sus días (`Habits.countsForDate` = `isHabitForDate`), se cumpla o no el mínimo.
- La semana va de **lunes a domingo**; conteo de la semana = días completos × 1 + días parciales × 0,5 (ver "Días parciales"). Racha en **semanas** consecutivas con conteo ≥ `weeklyMin` ("N semanas"). La semana en curso no rompe mientras el mínimo siga alcanzable (cada día restante puede sumar hasta 1; hoy parcial, 0,5 más) o ya esté cumplido. El texto muestra decimales con coma: "3,5/5 mín." (sin decimal si es entero).
- Semanas con días de vacaciones, archivados o previos a la creación: el mínimo se reduce en proporción a los días disponibles (`⌊weeklyMin × disponibles ÷ días en que aparece⌋`, mínimo 1); sin días disponibles la semana no rompe ni suma (`Habits.weekMinInfo`).
- Cumplimiento (ventanas 7/30/90, heatmap, detalle, Estadísticas): sobre los días en que aparece, igual que `'days'`, independiente del mínimo.

**Días parciales (sin campos nuevos; se calculan con `dailyProgress` y `history`, `Habits.dayStatus` / `Habits.dayValue`):**
- **Completo:** progreso del día ≥ `dailyTarget` (queda en `history`) → vale 1.
- **Parcial:** progreso ≥ 50% y < 100% del `dailyTarget`, **solo si `dailyTarget` > 1** (un hábito binario no puede ser parcial) → vale **0,5 para el mínimo semanal** y para el cumplimiento de Estadísticas/detalle; para la **racha diaria** (hábitos sin `weeklyMin`, también en `calcBestStreak`) es **neutro**: no la rompe ni la suma, igual que un día que no aplica.
- **Menos del 50%:** vale 0 y rompe la racha diaria como siempre.
- No cambian: el % del día (proporcional, `getHabitDayPct`), los aportes a la meta vinculada (cantidad real registrada) ni `complianceWindow` (ya era proporcional).

**Archivado:** `archived`, `archivedAt` y `archivedRanges` son opcionales; los hábitos existentes no necesitan migración (no se subió `version`). Un hábito archivado no aparece en Hoy, no cuenta en KPIs, porcentajes, rachas globales ni en el heatmap general, y no se puede registrar (por eso deja de aportar a su meta vinculada, aunque conserva `linkedGoalId`). Al reactivar se conserva todo el historial.

Leído/escrito por: `Habits` (dueño). Lee `Goals.updateCurrent` al propagar avance a una meta vinculada. Leído por `Stats`, `App` (KPIs del día, resumen del día y de la semana vía `Habits.countsForDate` / `isHabitForToday`), `Vacation` (pausa cómputo de streaks).

### `tasks` (array)

```json
{
  "id": "a1b2c3", "name": "Comprar pan", "date": "2026-11-10",
  "area": "hogar", "goalId": null, "important": false,
  "recurrence": "none", "seriesId": null,
  "done": false, "createdAt": 1732000000000
}
```

| Campo | Tipo | Notas |
|---|---|---|
| `date` | string\|null | `YYYY-MM-DD`, o `null` = sin fecha: **Idea** (sin subtareas) o **Proyecto** (con subtareas) |
| `goalId` | string\|null | → `goals[].id` (ver Relaciones). El modal solo ofrece metas semanales activas; vínculos antiguos a metas mensuales/anuales se conservan |
| `recurrence` | string | `'none'` \| `'daily'` \| `'weekly'` \| `'monthly'` \| `'yearly'` (ver `getNextRecurrenceDate`) |
| `seriesId` | string\|null | agrupa ocurrencias generadas por la misma tarea recurrente; `null` hasta que se genera la 2ª ocurrencia |
| `note` | string | opcional, solo en tareas ya completadas (bitácora) |
| `subtasks` | `{ id, name, done, date }[]`\|undefined | checklist opcional. Ausente o vacío = sin subtareas. `date`: `YYYY-MM-DD` o `null`/ausente (sin fecha) |

**Tarea sin fecha (Proyecto) y subtareas con fecha** — ejemplo:

```json
{
  "id": "k9l8", "name": "Ordenar la bodega", "date": null,
  "area": "hogar", "goalId": null, "important": false,
  "recurrence": "none", "seriesId": null, "done": false, "createdAt": 1732000000000,
  "subtasks": [
    { "id": "s1", "name": "Sacar cajas", "done": true, "date": null },
    { "id": "s2", "name": "Botar lo roto", "done": false, "date": "2026-11-14" }
  ]
}
```

- **Fecha efectiva** (`Tasks.effectiveDate(t)`, no se guarda): la más próxima entre `date` y las `date` de las subtareas **pendientes**. Decide si la tarea va a "⚠ Atrasadas" (< hoy) o a qué pestaña de la tarjeta Tareas (Hoy, Semana, Mes, Más adelante).
- `date: null` = **Idea o Proyecto según sus subtareas** (se deduce, no hay campo nuevo): **Idea** = sin subtareas → pestaña "💡 Ideas" y filtro Ideas de la gestión; **Proyecto** = al menos una subtarea → bloque "📁 Proyectos" de Enfoque y filtro Proyectos de la gestión. Un proyecto con una subtarea pendiente vencida o para hoy aparece además en "⚠ Atrasadas" u Hoy (su fecha efectiva); nunca en Semana/Mes/Más adelante. Siempre con `recurrence: 'none'` (para repetir hace falta fecha). Al completarla pasa a Hechas como cualquier otra.
- `subtasks[].date`: si la tarea tiene fecha, ninguna subtarea puede ser posterior (validación en el modal); si no tiene fecha (Idea/Proyecto), cualquier fecha vale. Completar todas **no** completa la tarea (solo destaca el checkbox) y la tarea se puede completar con subtareas pendientes. En una recurrente, la siguiente ocurrencia copia el checklist con ids nuevos, `done: false` y las fechas desplazadas los mismos días que la tarea (las sin fecha siguen sin fecha).
- Todos estos campos son opcionales (subtareas antiguas sin `date` = sin fecha): no hubo migración ni cambio de `version`.

Leído/escrito por: `Tasks` (dueño). Leído por `App` (KPIs y contadores del día vía `Tasks.countsForToday`: fecha = hoy, o pendiente con fecha efectiva hoy), `Stats`.

### `goals` (array)

```json
{
  "id": "g7h8i9", "name": "Terminar curso", "horizon": "month",
  "area": "crecimiento", "target": 10, "unit": "módulos",
  "parentGoalId": null, "recurrence": "none", "seriesId": null,
  "current": 3, "done": false, "createdAt": 1732000000000,
  "doneAt": null, "archived": false, "archivedAt": null,
  "propagatedCurrent": null
}
```

| Campo | Tipo | Notas |
|---|---|---|
| `horizon` | string | `'week'` \| `'month'` \| `'year'` (`'quarter'` existió y fue eliminado, ver migraciones) |
| `target` / `unit` | number\|0 / string | meta cuantitativa; `target: 0` o ausente = meta cualitativa (sí/no) |
| `parentGoalId` | string\|null | → otra meta de horizonte mayor (ver Relaciones) |
| `recurrence` | string | `'none'` \| `'weekly'` \| `'monthly'` \| `'yearly'` |
| `seriesId` | string\|null | agrupa metas recurrentes generadas por `GoalRollover` |
| `current` / `done` / `doneAt` | number / boolean / number\|undefined | progreso; `doneAt` se setea al cruzar `target` y se borra si vuelve a bajar |
| `archived` / `archivedAt` | boolean / number | la archiva `GoalRollover` al cerrar su período |
| `propagatedCurrent` | number\|undefined | solo en metas archivadas con padre: cuánto de su `current` ya se sumó al padre (al archivar, `GoalRollover` registra su `current`, que ya subió en tiempo real), para no duplicar al editarla después de archivada. Lo usa también el "origen del avance" de la padre |

Sin campos nuevos por ritmo esperado, origen del avance ni división en cascada: todo se calcula al vuelo (`Goals.goalPace`, `Goals.originBreakdown`) y la división crea metas normales (`recurrence` `'monthly'`/`'weekly'`, `seriesId` propio, `parentGoalId` a la padre, área de la padre). No hubo migración ni cambio de `version`.

Leído/escrito por: `Goals` (dueño, activas), `GoalArchive` (solo lectura de archivadas), `GoalRollover` (archiva + crea recurrentes). Leído por `Habits` (link), `Tasks` (link), `Stats`.

### `recurringExpenses` (array) — gastos programados (Finanzas)

```json
{
  "id": "r1r2r3", "name": "Luz", "category": "servicios",
  "recurrence": "monthly", "defaultAmount": 25000,
  "dueDate": "2026-11-15", "dueDay": 15, "note": null,
  "installmentsTotal": null, "installmentsCurrent": null,
  "installmentTotalAmount": null, "installmentsDone": false,
  "createdAt": 1732000000000
}
```

| Campo | Tipo | Notas |
|---|---|---|
| `category` | string | id de `Finance.EXPENSE_CATEGORIES` (ver `movements` para Ahorro) |
| `recurrence` | string | `'monthly'` \| `'quarterly'` \| `'yearly'` \| `'once'` (pago programado puntual: vence en `dueDate`; se crea con "No se repite" y fecha futura, y se elimina de la lista al pagarlo, conservando su movimiento) |
| `defaultAmount` | number | monto estimado por ciclo (o monto de la cuota, si tiene cuotas) |
| `dueDay` | number\|null | día del mes en que vence (para ordenar "próximos a vencer") |
| `installmentsTotal/Current/TotalAmount/Done` | number\|null / number\|null / number\|null / boolean | soporte de compras en cuotas |

Leído/escrito por: `Finance` (dueño). No lo lee ningún otro módulo.

### `movements` (array) — gastos puntuales y pagos registrados (+ ingresos/ajustes legados)

Finanzas es **solo seguimiento de gastos y ahorro**. Un movimiento cuenta en la app si y solo si `Finance.isTrackedExpense(m)`: `type === 'expense'`, sin `isAdjustment` y con `category !== 'ajuste'`.

- **Datos legados ocultos:** los movimientos con `type: 'income'` y los ajustes de saldo (`isAdjustment: true` o `category: 'ajuste'`) ya no se pueden crear ni se muestran en ninguna vista, lista, total ni gráfico (Hoy, Estadísticas, gestión, Archivo, resumen del día). **No se borran:** siguen en el estado y exportar/importar JSON los conserva intactos.
- **Ahorro:** la categoría de gasto con id `'inversion'` se muestra como **"🏦 Ahorro"** (el id no cambia para no romper datos). Cuenta como "Ahorrado", no como "Gastado"; el % ahorrado del mes es ahorrado ÷ (gastado + ahorrado).

```json
{
  "id": "mv1mv2", "type": "expense", "name": "Luz noviembre",
  "category": "servicios", "amount": 25000, "date": "2026-11-10",
  "note": null, "recurringExpenseId": "r1r2r3", "periodMk": null,
  "isAdjustment": false, "createdAt": 1732000000000
}
```

| Campo | Tipo | Notas |
|---|---|---|
| `type` | string | `'expense'` (único tipo que se crea hoy) \| `'income'` (legado, oculto) |
| `category` | string | id de `Finance.EXPENSE_CATEGORIES` (`'inversion'` = Ahorro). Legado: ids de ingreso y `'ajuste'` |
| `recurringExpenseId` | string\|null | → `recurringExpenses[].id` si este movimiento es el pago de un gasto programado |
| `periodMk` | string\|null | `monthKey` del ciclo que se está pagando, si es distinto al mes real del pago |
| `isAdjustment` | boolean | legado: `true` si vino del antiguo "⚖️ Ajustar saldo" (ya no existe). Oculto |

Leído/escrito por: `Finance` (dueño; incluye la tarjeta "💰 Gastos" de Hoy y Estadísticas › Finanzas vía `Finance.openAnalysis`). Leído por `App` (pagos del día en el resumen de un día, filtrado con `Finance.isTrackedExpense`).

### `focus` (objeto único)

`{ week: string, weekKey: string|null, updatedAt: number|null }` — **legado**: el antiguo "foco de la semana". Se eliminó de la app: no se muestra ni se escribe, pero se conserva en el estado y en exportar/importar.

### `closures` (objeto, clave = `YYYY-MM-DD`)

```json
{ "gratitude": ["..."], "learn": "...", "energy": 4, "stress": 2, "sleep": 7, "savedAt": 1732000000000 }
```
Cierre de día. `energy`/`stress`/`sleep` solo se guardan si el usuario los marcó (si no, la clave ni existe). Dueño: `App`. Leído por `Stats` y `WeekSummary` (Bienestar de la semana).

### `weekClosures` (objeto, clave = `YYYY-Www`)

```json
{ "worked": "...", "blocked": "...", "focus": "...", "savedAt": 1732000000000 }
```
Respuestas del antiguo cierre de semana (legado, ver abajo).

**Legado:** el cierre semanal ya no tiene preguntas (es solo el resumen de `WeekSummary`, calculado al vuelo sin guardar nada). `weekClosures` no se muestra (tampoco en Estadísticas › Cierres) ni se escribe, pero se conserva intacto en el estado y en exportar/importar.

### `dailySnapshots` (objeto, clave = `YYYY-MM-DD`, valor = número 0-100)

% de cumplimiento del día, guardado como snapshot para que el strip semanal no tenga que recalcular días pasados. Dueño: `App`. Leído por `Stats` (tendencia) y `WeekSummary` (puntaje de la semana).

### `user` (objeto único)

`{ name: string }`. Dueño: `Onboarding`/Configuración.

## Relaciones entre entidades

- `habit.linkedGoalId → goal.id`: al registrar avance en el hábito (`Habits.addToHabitProgress` o el modal de cantidad) suma a `goal.current` vía `Goals.updateCurrent` (y registra el aporte en `habit.contributions[fecha]`). Si la meta vinculada ya está archivada, `Habits.findGoalForDate` encuentra la de la misma serie (`seriesId`) del período de esa fecha.
- `task.goalId → goal.id`: al completar la tarea suma 1 al `current` de la meta (si tiene `target`) vía `Goals.updateCurrent`, y al desmarcarla resta 1; el avance sube a metas mensuales/anuales por la cadena `parentGoalId`. Las tareas nuevas solo se vinculan a metas **semanales** activas.
- `goal.parentGoalId → goal.id` (de un horizonte mayor): `Goals.updateCurrent` propaga el delta del hijo al padre recursivamente (semana → mes → año), en tiempo real. Al archivar, `GoalRollover` solo guarda en `propagatedCurrent` lo ya propagado (no lo vuelve a sumar). Si el padre también cambió de período, la hija activa se re-enlaza al reemplazo de la misma serie.
- `movement.recurringExpenseId → recurringExpense.id`: el movimiento es el pago registrado de ese gasto programado.
- `habit.area`, `goal.area → area.id`: solo para mostrar ícono/color/nombre, sin lógica adicional.

## Quién lee y quién escribe cada entidad

| Entidad | Dueño (lee+escribe) | Solo lectura |
|---|---|---|
| `settings` | `App`, `Vacation`, `Onboarding`, `GoalRollover` (según sub-campo) | casi todos |
| `areas` | migración en `App` | `Habits`, `Goals` |
| `habits` | `Habits` | `App`, `Stats`, `Vacation`, `Goals` (vía `updateCurrent`) |
| `tasks` | `Tasks` | `App`, `Stats` |
| `goals` | `Goals`, `GoalRollover` | `GoalArchive`, `Habits`, `Tasks`, `Stats` |
| `recurringExpenses` | `Finance` | — |
| `movements` | `Finance` (solo gastos; ingresos/ajustes legados ocultos) | `App` (resumen del día) |
| `closures`, `dailySnapshots` | `App` | `Stats`, `WeekSummary` |
| `focus`, `weekClosures` (legados) | — (no se escriben) | — (no se muestran; solo viajan en exportar/importar) |
| `user` | `Onboarding` / Configuración | — |
