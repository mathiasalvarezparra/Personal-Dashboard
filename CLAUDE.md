# Mi Dashboard

## Qué es

App personal de hábitos, tareas, metas y finanzas. Uso principal: instalada en pantalla de inicio del iPhone (PWA-ish, sin ser instalable de verdad). 100% offline, sin backend, un solo usuario (sin login, sin sync entre dispositivos salvo exportar/importar JSON manual).

## Stack y restricciones

HTML, CSS y JS **vanilla**. Scripts clásicos (`<script src="...">`, sin `type="module"`) cargados en orden fijo desde `index.html`, compartiendo scope global. Sin frameworks, sin paso de build, sin dependencias de npm.

**No introduzcas nada de eso** (framework, bundler, paquete npm, módulos ES) **sin que yo lo pida explícitamente.**

## Mapa de archivos (`js/`, en orden de carga real en `index.html`)

1. `storage.js` — `Storage`: estado global, persistencia en `localStorage`, export/import JSON, migraciones por `version` (`migrate`, aplicada al cargar y al importar).
2. `ui.js` — `UI`: navegación entre vistas (`go`/`goBack`), modal genérico, toast, helpers de fecha.
3. `helpers.js` — `escapeHtml`, `escapeAttr`, `isLive` (funciones sueltas, no un módulo).
4. `animate.js` — `Animate`: animaciones de entrada (barras, anillos, gráficos SVG, mapa de calor, números y listas). Solo visual; se engancha automáticamente vía `MutationObserver` + `UI.go`.
5. `habits.js` — `Habits`: hábitos cuantitativos (todos los días o días específicos, con mínimo semanal opcional para la racha), rachas, heatmap, progreso diario, archivado y la lista de Hoy agrupada por momento del día.
6. `tasks.js` — `Tasks`: tareas puntuales y recurrentes, tarjeta "✅ Tareas" de Enfoque (Atrasadas + pestañas por plazo), fecha efectiva, subtareas con fecha (checklist), Próximamente y el modal de captura rápida.
7. `goals.js` — `Goals`: metas por horizonte (semana/mes/año), jerarquía padre-hijo, ritmo esperado (`goalPace`), origen del avance (`originBreakdown`) y división en cascada.
8. `goal-archive.js` — `GoalArchive`: vista de solo lectura de metas archivadas.
9. `finance.js` — `Finance`: **solo seguimiento de gastos y ahorro** (sin ingresos ni balance): pagos programados, gastos registrados, presupuesto y meta de ahorro, tarjeta "💰 Finanzas" de Hoy, Estadísticas › Finanzas, vista "🧾 Movimientos" y el modal de registro rápido. `Finance.isTrackedExpense(m)` decide qué movimiento cuenta.
10. `templates.js` — `Templates`: sets predefinidos de hábitos+metas para onboarding.
11. `goal-rollover.js` — `GoalRollover`: archiva metas vencidas (registrando en `propagatedCurrent` lo que ya aportaron, sin volver a sumarlo) y auto-crea las recurrentes re-enlazadas a la padre vigente.
12. `vacation.js` — `Vacation`: modo vacaciones (pausa hábitos en un rango de fechas).
13. `stats.js` — `Stats`: vista de estadísticas (tendencias, cumplimiento, bienestar, finanzas). Cada barra de la tendencia de 12 semanas abre el resumen de esa semana.
14. `week-summary.js` — `WeekSummary`: resumen motivador de una semana (vista `week-summary`, solo lectura, sin guardar nada).
15. `onboarding.js` — `Onboarding`: flujo de bienvenida para usuarios nuevos.
16. `app.js` — `App`: controlador principal, orquesta el resto, migraciones one-shot, cierre del día y botón "📊 Resumen de la semana".
17. `main.js` — una línea: `document.addEventListener('DOMContentLoaded', App.init)`.

Cada módulo es un IIFE (`const Nombre = (() => {...})()`) que queda en el scope global del documento (no en `window`, pero accesible como identificador en cualquier script posterior). El orden de carga importa: un módulo puede referenciar a otro definido más abajo, pero solo dentro de funciones que se ejecutan después de que todos los scripts cargaron — nunca en el cuerpo del IIFE al momento de definirse.

## Datos

El estado vive en `localStorage` bajo la clave **`mi_dashboard_v1`**.

**Regla:** nunca cambiar esa clave ni romper datos existentes. Si el esquema cambia de forma incompatible, subir `state.version` y escribir la migración dentro de `Storage.load()`. Las migraciones one-shot específicas de una entidad (ej. agregar un área nueva) viven en `App` con su propio flag en `settings` (ver ejemplos reales en `docs/DATA_MODEL.md`).

Estructura completa de cada entidad, relaciones y qué módulo lee/escribe qué: **`docs/DATA_MODEL.md`** (leerlo antes de tocar cualquier dato).

## Convenciones

- Todos los textos de la UI van en **español**.
- Patrón de render de cada módulo: función `renderX()` que busca su contenedor por `id`, hace `if (!isLive(c)) return;` (evita repintar vistas ocultas), lee `Storage.get()`, arma un string HTML y lo asigna a `.innerHTML`.
- Todo gráfico o barra nuevo debe usar el módulo de animación central (`js/animate.js`): renderizar el valor final en `style` (`width`/`height` en %) o `stroke-dashoffset`, y agregar su selector a las listas de `Animate`. Duraciones y easing salen de las variables `--anim-*` de `style.css`.
- Colores en Finanzas: los montos de gasto van en color de texto neutro (`var(--text)`) y sin signo "−"; el Ahorro en verde (`.savings`). El **rojo se reserva para alertas**: pagos atrasados, "Vence hoy", presupuesto excedido y tendencias negativas. Barras de presupuesto: neutro < 80%, ámbar (`--accent-amber`) 80–100%, rojo > 100%.
- **Uso obligatorio** de `escapeHtml()` al insertar cualquier texto ingresado por el usuario dentro de HTML, y `escapeAttr()` al insertarlo dentro de un atributo (ej. `value="${escapeAttr(x)}"`).

## Sistema de diseño y navegación: pendiente de rediseño

Los estilos viven en `style.css`. El diseño visual y el menú/navegación completos se van a rediseñar — no están documentados en detalle acá a propósito. Solo lo mínimo para operar hoy:

- Cambiar de vista: cualquier elemento con `data-go="nombre-de-vista"` dispara `UI.go('nombre-de-vista')` (listener delegado en `ui.js`). También se puede llamar `UI.go(...)` directo desde código.
- Volver atrás: `data-back` dispara `UI.goBack()` (pila de historial interna).
- Cada vista es una sección `<section id="view-nombre-de-vista" class="view">` en `index.html`.
- Bottom-nav: solo **Enfoque** (`today`) y **Estadísticas** (`stats`). Finanzas no tiene pestaña propia.
- **Regla: historiales y detalles parten colapsados; se abren al tocar y el estado se recuerda solo durante la sesión** (en memoria; al recargar todo vuelve cerrado). Aplica a archivos e historiales agrupados por año/mes/semana (Archivo de metas, metas anteriores de la gestión, tareas hechas, Movimientos › Archivo, Estadísticas › Cierres, hábitos archivados) y a bloques de detalle ("Aporta a esta meta", "Registros del mes" en Estadísticas › Finanzas). El encabezado muestra su resumen (período, totales, contadores) y el indicador común `.coll-chev` (▸ cerrado / ▾ abierto, según `aria-expanded`); el contenido entra con `Animate` (`TAB_TRIGGERS` o `Animate.reveal`).
- Hábitos en Hoy (`Habits.renderTodayHabits`): agrupados por `timeOfDay` (Mañana, Tarde, Noche y "Cualquier momento" si no tiene). Orden: el momento actual (mañana < 12:00, tarde 12:00–18:59, noche ≥ 19:00), los siguientes, "Cualquier momento" y al final los ya pasados. Encabezado "Mañana · 2/3"; dentro, pendientes arriba (orden manual de `moveHabit`) y completados abajo. Un grupo completo se colapsa con ✓ (tocar para expandir); los grupos vacíos no se muestran.
- Frecuencia de hábitos: **días en que aparece** ("Todos los días" o "Días específicos") + **mínimo semanal para la racha** opcional (`frequency.weeklyMin`). No existe "X veces por semana" ni bloque "Flexibles".
- **Regla: el mínimo semanal solo flexibiliza la racha, nunca el % del día.** El hábito aparece en Enfoque y cuenta en el % del día todos sus días elegidos, se cumpla o no el mínimo; la racha se mide en semanas con ≥ mínimo días cumplidos (`Habits.weekMinInfo`).
- Hábitos con mínimo semanal en Enfoque: bajo el nombre, la semana en puntos L M M J V S D (cumplidos rellenos y animados, días en que aparece con borde, el resto apagados) y "2/3 mín.". Si con los días que quedan apenas se alcanza el mínimo: ámbar "Racha en riesgo: te faltan N"; si ya no se alcanza: neutro "Esta semana no alcanza el mínimo". Al registrar la sesión que alcanza el mínimo: animación breve en los puntos y toast "Racha asegurada esta semana 💪".
- Archivar hábitos: desde el detalle o la gestión (📦, con confirmación). Los archivados viven en la sección colapsable "Archivados" de la gestión, con "Reactivar" y "Eliminar"; no aparecen en Hoy ni cuentan en KPIs/estadísticas/rachas globales. Para saber si un hábito cuenta un día usar siempre `Habits.countsForDate` / `isHabitForToday`, nunca leer `frequency` directo.
- Tareas en Enfoque: tarjeta **"✅ Tareas"** (`Tasks.renderToday`, contenedor `#today-tasks`) con "+" (captura rápida) y botón de gestión. Arriba, siempre visible y fuera de las pestañas, "⚠ Atrasadas". Debajo, pestañas con contador (estilo de las de Metas, clase `.task-tab`): **Hoy** (fecha efectiva = hoy), **Semana** (mañana → domingo de esta semana), **Mes** (lunes siguiente → fin de mes), **Más adelante** (lo posterior) y **Próximamente** (sin fecha y sin subtareas fechadas pendientes). Por defecto Hoy; la pestaña elegida se recuerda durante la sesión (`sessionStorage`). Orden: fecha efectiva, luego importantes, luego creación (Próximamente: por creación). Tocar una tarea de las pestañas abre su edición. Una tarea aparece una sola vez. No existe tarjeta "Mañana".
- **Fecha efectiva** (`Tasks.effectiveDate`): la más próxima entre la fecha de la tarea y las de sus subtareas pendientes. Si es anterior a hoy va a Atrasadas; si el atraso viene de una subtarea muestra "Subtarea atrasada · Nd". El % y los contadores del día usan `Tasks.countsForToday` (fecha = hoy, o fecha efectiva hoy): agregar tareas futuras o en Próximamente no los cambia.
- Modal de tarea (crear desde Enfoque o la gestión, y editar): nombre primero (Enter guarda, error inline si está vacío), chips de fecha **Hoy / Mañana / Próximamente / Fecha**, y bajo "Más opciones" área, ⭐, repetición, meta y subtareas (abierto al editar si tiene alguno de esos datos). Cada subtarea tiene 📅 con chips Hoy / Mañana / Fecha / Sin fecha; si la tarea tiene fecha, una subtarea posterior muestra error inline y no deja guardar. La bitácora de tareas hechas no cambia.
- Vinculación a metas: el selector solo ofrece metas **semanales** activas (no archivadas ni cumplidas). Un vínculo existente a otra meta se conserva y se muestra "(mensual)" / "(anual)". El avance sube a mensual/anual por `parentGoalId`.
- Subtareas: visibles en todas partes (pestañas, Atrasadas y todos los filtros de la gestión): "2/5" con mini barra; tocarlo abre el checklist inline para marcarlas. Cada una muestra su fecha corta; las vencidas en rojo como las tareas atrasadas. Orden: pendientes por fecha (vencidas primero, sin fecha al final, luego creación) y completadas al final. Sin texto de "siguiente paso". Completar todas solo destaca el checkbox (no cierra la tarea). En Archivo se ve "✓ 4/5 subtareas".
- **Próximamente** (`date: null`): filtro propio en la gestión con contador y botones rápidos Hoy / Mañana / Fecha (solo ahí). Sin repetición.
- **Regla: no agregar acciones rápidas de reprogramación ni "pasar a hoy" a las tareas atrasadas** (sección "⚠ Atrasadas"). Su urgencia visual es intencional: mismo estilo de siempre, solo checkbox y checklist de subtareas.
- **Regla de Enfoque limpio** (tareas, metas y hábitos): en Enfoque solo nombre, avance/estado, fecha o urgencia cuando corresponda, ⭐, indicador de subtareas y estado de ritmo. Nada de área/categoría, badge de repetición (🔁), etiqueta de período ni otra metadata de configuración: eso vive solo en las vistas de gestión. En tareas se controla con `renderItem(t, { focus: true })`.
- **Ritmo esperado** (`Goals.goalPace`): solo metas cuantitativas activas y no cumplidas. Esperado = target × días transcurridos del período (con hoy) / días del período (semana lunes–domingo, mes o año calendario). current > ⌈esperado⌉ → verde "Vas N adelante"; current < ⌊esperado⌋ → ámbar "Vas N atrás"; si no, neutro "Al día" (N en la unidad de la meta). La barra lleva una marca vertical en el esperado (`.goal-pace-mark`, animada por `Animate`). Se ve en Enfoque y en la gestión de metas (Estadísticas solo muestra conteos por período, sin metas individuales).
- **Origen del avance** (`Goals.originBreakdown`, solo en la tarjeta de gestión de metas cuantitativas): bloque "Aporta a esta meta" con hábitos (suma de `contributions` del período que cayeron en esta meta vía `Habits.findGoalForDate`), "Tareas · N" (completadas vinculadas dentro del período), cada meta hija ("Nombre · semana 10–16 nov · 2": `current` si está activa, `propagatedCurrent` si está archivada) y "Manual" con el resto si es > 0. Sin hábitos, tareas ni hijas: "Sin acciones vinculadas".
- **División en cascada**: al crear una meta anual o mensual con objetivo > 0 aparece "Dividir en metas más pequeñas" (no en semanales ni cualitativas); también la acción "✂️ Dividir" en la tarjeta de una anual/mensual activa sin hijas activas. Anual → secciones Mensual y Semanal; mensual → Semanal. Nombre y unidad por defecto los de la padre; objetivos sugeridos ⌈target/12⌉ y ⌈target/52⌉ desde anual, ⌈target/(días del mes/7)⌉ desde mensual. "Vincular hábito" opcional (activos) con aviso "Reemplazará el vínculo con [meta]". Crea solo las metas del período actual (recurrentes `monthly`/`weekly`, área de la padre); `GoalRollover` crea las siguientes ya vinculadas.
- Avance de metas: todo aporte (hábitos, también con el modal de cantidad; tareas; ajustes manuales) sube en tiempo real por `parentGoalId` vía `Goals.updateCurrent`. Al archivar, `GoalRollover` no vuelve a sumar al padre. Sobrecumplir está permitido.
- **Cierre semanal = solo resumen** (`WeekSummary.open(weekKey)`, vista de pantalla completa `week-summary` con botón cerrar): sin preguntas ni campos, no guarda nada. Accesos: en Enfoque el botón "📊 Resumen de la semana" (domingo → semana en curso, marcada "en curso"; lunes → la que terminó; otros días no aparece) y cada barra de Estadísticas › Resumen › Tendencia. Contenido: rango, puntaje (promedio de `dailySnapshots`, como la tendencia) en anillo animado, veredicto (récord de 12 semanas → "¡Nueva mejor semana!" con celebración; mejor que la anterior → "Semana en alza"; ≥ 80 "Semana sólida"; 50–79 "Semana a medias"; < 50 "Semana difícil · el lunes empieza otra"), ±pts vs semana pasada y récord; Logros (máx. 5), A mejorar (máx. 2), Metas a este ritmo, Finanzas de la semana y Bienestar. Rachas, metas atrasadas y proyecciones usan el estado actual, así que solo aparecen en la semana en curso y la recién terminada.
- **Foco de la semana eliminado** y respuestas del antiguo cierre semanal (`weekClosures`) ocultas en toda la app (incluido Estadísticas › Cierres): son datos legados que se conservan en el JSON pero no se muestran ni se escriben. No existe lógica de "semana pendiente sin cerrar". El cierre del DÍA no cambia.
- Finanzas en Hoy: la tarjeta **"💰 Finanzas"** (`Finance.renderTodayPending`, contenedor `#today-pending`) se muestra siempre. Si hay presupuesto o meta de ahorro, muestra sus barras ("Gastado $X de $Y", "Ahorro $A de $B"). Debajo, "⚠ Atrasados" (fuera de las pestañas, uno por pago con su período más antiguo) y pestañas de pagos con cantidad y total (clase `.fin-tab`, estilo de las de Tareas/Metas): **Hoy**, **Semana** (mañana → domingo), **Mes** (lunes siguiente → fin de mes) y **Más adelante**. Hoy/Semana/Mes incluyen todo pago programado no pagado (mensual, trimestral, anual, cuotas y puntual) que venza en ese rango; **regla: "Más adelante" solo muestra pagos programados puntuales (`recurrence 'once'`) que vencen después del mes actual**, nunca recurrentes ni cuotas. Vencimientos vía `Finance` `getPaymentOccurrences` (extiende `getAllPending` con el mes siguiente y los puntuales). Cada pago: nombre, monto, vencimiento corto y "Cuota N/M"; "Pagar" en todas las pestañas (permite adelantar). Por defecto Hoy; la pestaña se recuerda en la sesión (`sessionStorage`). Subtítulo "N pendientes este mes · $total" (Atrasados + Hoy + Semana + Mes) o "Gastado este mes · $X"; sin pagos en ningún lado: "No hay gastos pendientes". Su "+" abre el modal de registro rápido y la billetera ("Ver movimientos") lleva a **"🧾 Movimientos"** (vista `finance-settings`), cuyo "volver" regresa a donde se entró.
- Pago programado puntual: en el modal de gasto, "No se repite" con **fecha futura** se guarda como pago pendiente (`recurringExpenses` con `recurrence: 'once'` y `dueDate`) en vez de gasto ya hecho. Al pagarlo se registra el movimiento y el puntual sale de la lista.
- Subpestañas de Movimientos: **Pagos programados, Puntuales, Archivo, Plan**. En **Plan** se definen presupuesto mensual, meta de ahorro mensual y presupuesto por categoría (`Finance.openPlan()` abre directo esa pestaña).
- El análisis mensual vive en Estadísticas › Finanzas: resumen Gastado/Ahorrado/%, bloques Presupuesto y Meta de ahorro (o estado vacío con link a Plan), dona, "Gastos y ahorro · 6 meses" (con línea punteada del presupuesto) y "Registros del mes" con editar/eliminar.

Esta sección se completará después del rediseño.

## Cómo agregar un módulo nuevo (ej. "Deporte")

1. Crear `js/deporte.js` siguiendo el mismo patrón IIFE y de render que los módulos existentes.
2. Agregar su `<script src="js/deporte.js">` en `index.html`, en el orden correcto según sus dependencias.
3. Agregar su entidad a `defaultState` en `Storage` (ej. `deporte: []`), sin romper datos existentes. Si hace falta migrar datos de usuarios ya existentes, subir `version` y escribir la migración en `Storage.load()`.
4. Agregar su vista (`<section id="view-deporte">`) en `index.html` y su acceso en la navegación vigente.
5. Si corresponde, integrarlo en "Hoy" (`App`) y en "Estadísticas" (`Stats`).
6. Actualizar **`CLAUDE.md`** (mapa de archivos) y **`docs/DATA_MODEL.md`** (nueva entidad) **en el mismo commit**.

## Regla de documentación

Cualquier cambio que agregue, elimine o renombre archivos, módulos, vistas o campos de datos debe actualizar `CLAUDE.md` y `docs/DATA_MODEL.md` en el mismo commit.

## Flujo de trabajo

- Proponer un plan antes de cambios grandes y esperar confirmación.
- Cambios mínimos y acotados a lo pedido; no tocar módulos no relacionados.
- Cero errores en consola.
- Entregar checklist de prueba manual.
- Un commit por cambio, con mensaje descriptivo.
