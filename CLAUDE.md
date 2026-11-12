# Mi Dashboard

## Qué es

App personal de hábitos, tareas, metas y finanzas. Uso principal: instalada en pantalla de inicio del iPhone (PWA-ish, sin ser instalable de verdad). 100% offline, sin backend, un solo usuario (sin login, sin sync entre dispositivos salvo exportar/importar JSON manual).

## Stack y restricciones

HTML, CSS y JS **vanilla**. Scripts clásicos (`<script src="...">`, sin `type="module"`) cargados en orden fijo desde `index.html`, compartiendo scope global. Sin frameworks, sin paso de build, sin dependencias de npm.

**No introduzcas nada de eso** (framework, bundler, paquete npm, módulos ES) **sin que yo lo pida explícitamente.**

## Mapa de archivos (`js/`, en orden de carga real en `index.html`)

1. `storage.js` — `Storage`: estado global, persistencia en `localStorage`, export/import JSON, migraciones por `version` (`migrate`, aplicada al cargar y al importar).
2. `ui.js` — `UI`: navegación entre vistas (`go`/`goBack`), modal genérico (viewport visible con `visualViewport`, `revealInModal`), toast, helpers de fecha.
3. `helpers.js` — `escapeHtml`, `escapeAttr`, `isLive`, `capitalizeFirst` (funciones sueltas, no un módulo).
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
16. `app.js` — `App`: controlador principal, orquesta el resto, migraciones one-shot, cierre del día, botón "📊 Resumen de la semana" y peso de los datos en Configuración.
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
- **Tono positivo:** el avance se muestra en positivo (lo logrado frente a lo esperado). No se muestran avisos de ritmo atrasado ni de racha en riesgo. Ámbar/rojo solo para tareas atrasadas, pagos y presupuesto excedido.
- **Uso obligatorio** de `escapeHtml()` al insertar cualquier texto ingresado por el usuario dentro de HTML, y `escapeAttr()` al insertarlo dentro de un atributo (ej. `value="${escapeAttr(x)}"`).

## Sistema de diseño

Estilos en `style.css`; todas las variables están al inicio, en `:root` (modo oscuro, por defecto) y `[data-theme="light"]` (modo claro, se activa desde Configuración › Tema con `data-theme` en `<html>`). **Regla: todo componente nuevo debe usar estas variables**; no escribir píxeles sueltos de espaciado, radio, tamaño de letra ni sombra.

- **Paleta:** fondos `--bg` (página), `--bg-elev`, `--bg-card`, `--bg-card-hover`; bordes `--border`, `--border-soft`; texto `--text`, `--text-dim`, `--text-faint`. Acento amarillo `--accent-yellow` (#f5c842) = `--primary`. Fuentes: Inter (`--font-sans`) y JetBrains Mono (`--font-mono`).
- **Acento en texto:** `--primary` solo para rellenos (barras, anillos, fondos de botón y chips activos; el texto encima usa `--on-primary`). Todo texto, ícono o borde en color de acento usa `--primary-text`: en oscuro es el mismo amarillo; en claro es ocre `#8a6700` (contraste AA sobre blanco y sobre fondos amarillos tenues).
- **Espaciados:** escala única `--space-1` 4px · `--space-2` 8px · `--space-3` 12px · `--space-4` 16px · `--space-5` 24px · `--space-6` 32px (solo se permiten 1–3px literales para bordes y ajustes finos).
- **Radios:** `--radius-sm` 8px (botones, chips, pestañas, inputs) · `--radius-md` 12px (ítems internos de una tarjeta, mosaicos) · `--radius-lg` 16px (tarjetas de sección, modales). Píldoras y círculos (100px / 50%) solo para barras, puntos y badges mínimos.
- **Tipografía:** `--fs-hero` 22px (saludo de Enfoque, veredicto) · `--fs-view-title` 18px (título de vista, modal o sheet) · `--fs-card-title` 15px (título de tarjeta) · `--fs-item` 14px (nombre de ítem, peso `--fw-item` 600) · `--fs-body` 13px (botones, inputs, texto de apoyo) · `--fs-secondary` 12px · `--fs-meta` 11px (montos/fechas mono) · `--fs-label` 10px (etiqueta mono en mayúsculas con `--ls-label`, ej. "MAÑANA · 2/3") · `--fs-micro` 9px (badges). Títulos con `--fw-title` 700. Números grandes de estadísticas e íconos conservan su tamaño propio.
- **Controles:** `--control-h` 44px (botones e inputs), `--chip-h` 30px (chips y pestañas de Tareas/Finanzas/Metas, todos con `--radius-sm`), `--icon-btn` 38px (botones de ícono).
- **Sombras:** `--shadow-card` (una sola, sutil, para tarjetas) y `--shadow-modal` (modales, toast).
- **Tarjetas sobre fondo gris:** la página usa `--bg` (claro: `#f7f8fa`); cada sección (Tareas, Finanzas, Hábitos, Metas, calendario, bloques de Estadísticas, gestión, Configuración, resumen semanal) va en su tarjeta `--bg-card` con borde `--border`, `--radius-lg`, `--shadow-card`, padding `--space-4` y `--space-4` de separación vertical. Encabezado común `.section-head`: título (`.section-title`) + subtítulo mono (`.section-subtitle`) a la izquierda y botones de ícono (`.section-icon-btn`) a la derecha.
- **Colores semánticos (sin cambios):** verde (`--accent-green`) = cumplido/ahorro; ámbar (`--accent-amber`) y rojo (`--accent-red`) solo para tareas atrasadas, pagos atrasados o por vencer y presupuesto excedido.
- **Animaciones:** duraciones y easing en `--anim-*` (ver `js/animate.js`).

## Navegación y componentes

Lo mínimo para operar hoy:

- Cambiar de vista: cualquier elemento con `data-go="nombre-de-vista"` dispara `UI.go('nombre-de-vista')` (listener delegado en `ui.js`). También se puede llamar `UI.go(...)` directo desde código.
- Volver atrás: `data-back` dispara `UI.goBack()` (pila de historial interna).
- **Posición al volver:** `UI.go` guarda en memoria el scroll de la vista que se deja. Navegar hacia adelante empieza arriba; `UI.goBack()` (volver / `data-back`) y la barra inferior (Enfoque ↔ Estadísticas) restauran la posición guardada de la vista de destino tras el render, sin animación de scroll.
- **Tres tipos de modal** (`UI.openModal` / `UI.confirm2`), con botones del mismo alto, padding, tipografía y radio, siempre abajo:
  · **Formulario** (crear/editar, por defecto): "Cancelar" (secundario, izquierda) + acción (primario, derecha: "Guardar", "Crear", "Guardar cambios", "Crear metas"…), 50/50.
  · **Confirmación** (`UI.confirm2`): "Cancelar" + acción (primario, o rojo con `danger: true` para eliminar/borrar), 50/50.
  · **Solo lectura/información** (`openModal({ single: true })`): un solo botón "Cerrar" a ancho completo. Nunca "Cancelar" + "Cerrar" juntos; no usar "Listo" para cerrar.
- **Regla de modales en iPhone (estructura y altura):** `.modal` es una columna flex de tres partes: encabezado (`h3`) fijo arriba, cuerpo `#modal-body` como **único** elemento con scroll (`flex: 1`, `min-height: 0`, `overflow-y: auto`, padding inferior para que el último campo no quede pegado al pie) y pie `.modal-actions` fijo abajo, sin superponerse (nada de `sticky` ni márgenes negativos). La altura **nunca usa `vh`**: `max-height: calc(var(--vvh) - var(--space-6) - env(safe-area-inset-top))`, donde `--vvh`/`--vv-top` los actualiza `UI` con `window.visualViewport` (resize/scroll) y su fallback es `100dvh`. Así el modal se achica con el teclado y el pie queda sobre él (clase `html.kb-open` mientras el teclado está abierto). Backdrop, sheets (`.sheet`) y el onboarding ocupan solo el área visible (`top: var(--vv-top)`, `height: var(--vvh)`). Al enfocar un campo del modal, `UI` lo centra dentro del cuerpo en el siguiente frame (`UI.revealInModal(el, 'center' | 'end')`); se usa también tras agregar subtareas.
- **Regla de mayúscula inicial:** todo campo de texto libre (nombres de tarea, subtarea, hábito, meta y metas hijas, gasto; notas) lleva `autocapitalize="sentences"`. Respaldo al guardar con `capitalizeFirst()` (`js/helpers.js`): si el texto empieza con letra minúscula, solo esa letra pasa a mayúscula; se aplica a tareas, subtareas, hábitos, metas, gastos y sus notas. Campos como unidad o ícono no se capitalizan.
- Cada vista es una sección `<section id="view-nombre-de-vista" class="view">` en `index.html`.
- Bottom-nav: solo **Enfoque** (`today`) y **Estadísticas** (`stats`). Finanzas no tiene pestaña propia.
- **Calendario de Enfoque** (ícono del encabezado → sheet `sheet-calendar`, `renderCalendar` en `js/app.js`): un solo recuadro (`.section-card.cal-card`) con navegación de mes, días de la semana (Lu–Do) y la grilla. Cada día es su número dentro de un anillo SVG verde (`.cal-ring-bar`, animado por `Animate` al abrir y al cambiar de mes) según el % del día: hoy en vivo (`computeTodayPct`, el mismo cálculo de Enfoque), días pasados desde `dailySnapshots` y, si falta, el mismo cálculo aplicado a esa fecha; sin datos = anillo vacío. 100% = círculo verde relleno. Hoy con el número destacado; vacaciones sin anillo con 🏖️ pequeño; futuros y días anteriores a los primeros datos solo con el número atenuado. Punto bajo el número = hay cierre del día. Tocar un día pasado u hoy abre su resumen (`openDaySummary`); los futuros no hacen nada.
- **Regla: historiales y detalles parten colapsados; se abren al tocar y el estado se recuerda solo durante la sesión** (en memoria; al recargar todo vuelve cerrado). Aplica a archivos e historiales agrupados por año/mes/semana (Archivo de metas, metas anteriores de la gestión, tareas hechas, Movimientos › Archivo, Estadísticas › Cierres, hábitos archivados) y a bloques de detalle ("Aporta a esta meta", "Registros del mes" en Estadísticas › Finanzas). El encabezado muestra su resumen (período, totales, contadores) y el indicador común `.coll-chev` (▸ cerrado / ▾ abierto, según `aria-expanded`); el contenido entra con `Animate` (`TAB_TRIGGERS` o `Animate.reveal`).
- Hábitos en Hoy (`Habits.renderTodayHabits`): agrupados por `timeOfDay` (Mañana, Tarde, Noche y "Cualquier momento" si no tiene). Orden: el momento actual (mañana < 12:00, tarde 12:00–18:59, noche ≥ 19:00), los siguientes, "Cualquier momento" y al final los ya pasados. Encabezado "Mañana · 2/3"; dentro, pendientes arriba (orden manual de `moveHabit`) y completados abajo. Un grupo completo se colapsa con ✓ (tocar para expandir); los grupos vacíos no se muestran.
- Frecuencia de hábitos: **días en que aparece** ("Todos los días" o "Días específicos") + **mínimo semanal para la racha** opcional (`frequency.weeklyMin`). No existe "X veces por semana" ni bloque "Flexibles".
- **Regla: el mínimo semanal solo flexibiliza la racha, nunca el % del día.** El hábito aparece en Enfoque y cuenta en el % del día todos sus días elegidos, se cumpla o no el mínimo; la racha se mide en semanas con ≥ mínimo días cumplidos (`Habits.weekMinInfo`).
- Hábitos con mínimo semanal en Enfoque: bajo el nombre, la semana en puntos L M M J V S D (cumplidos rellenos y animados, días en que aparece con borde, el resto apagados) y "2/3 mín." (sin avisos de racha en riesgo). Al registrar la sesión que alcanza el mínimo: animación breve en los puntos y toast "Racha asegurada esta semana 💪".
- Archivar hábitos: desde el detalle o la gestión (📦, con confirmación). Los archivados viven en la sección colapsable "Archivados" de la gestión, con "Reactivar" y "Eliminar"; no aparecen en Hoy ni cuentan en KPIs/estadísticas/rachas globales. Para saber si un hábito cuenta un día usar siempre `Habits.countsForDate` / `isHabitForToday`, nunca leer `frequency` directo.
- Tareas en Enfoque: tarjeta **"✅ Tareas"** (`Tasks.renderToday`, contenedor `#today-tasks`) con "+" (captura rápida) y botón de gestión. Arriba, siempre visible y fuera de las pestañas, "⚠ Atrasadas". Debajo, pestañas con contador (estilo de las de Metas, clase `.task-tab`): **Hoy** (fecha efectiva = hoy), **Semana** (mañana → domingo de esta semana), **Mes** (lunes siguiente → fin de mes), **Más adelante** (lo posterior) y **Próximamente** (sin fecha y sin subtareas fechadas pendientes). Por defecto Hoy; la pestaña elegida se recuerda durante la sesión (`sessionStorage`). Orden: fecha efectiva, luego importantes, luego creación (Próximamente: por creación). Tocar una tarea de las pestañas abre su edición. Una tarea aparece una sola vez. No existe tarjeta "Mañana".
- **Fecha efectiva** (`Tasks.effectiveDate`): la más próxima entre la fecha de la tarea y las de sus subtareas pendientes. Si es anterior a hoy va a Atrasadas; si el atraso viene de una subtarea muestra "Subtarea atrasada · Nd". El % y los contadores del día usan `Tasks.countsForToday` (fecha = hoy, o fecha efectiva hoy): agregar tareas futuras o en Próximamente no los cambia.
- Modal de tarea (crear desde Enfoque o la gestión, y editar): nombre primero (Enter guarda, error inline si está vacío), chips de fecha **Hoy / Mañana / Próximamente / Fecha**, y bajo "Más opciones" área, ⭐, repetición, meta y subtareas (abierto al editar si tiene alguno de esos datos). Cada subtarea tiene 📅 con chips Hoy / Mañana / Fecha / Sin fecha; si la tarea tiene fecha, una subtarea posterior muestra error inline y no deja guardar. La bitácora de tareas hechas no cambia.
- Vinculación a metas: el selector solo ofrece metas **semanales** activas (no archivadas ni cumplidas). Un vínculo existente a otra meta se conserva y se muestra "(mensual)" / "(anual)". El avance sube a mensual/anual por `parentGoalId`.
- Subtareas en el modal: input de nueva subtarea a ancho completo (mismo alto y estilo que los demás inputs); con Enter se agrega, el input hace blur + focus en el mismo gesto (el teclado vuelve a mayúscula) y el cuerpo se desplaza para dejar a la vista el input y la última subtarea. Filas `.t-sub-row` (y `.subtask-row` del checklist en Enfoque/gestión): nombre a la izquierda (`flex: 1`, `min-width: 0`, salta de línea) y botones de fecha / × a la derecha con ancho fijo, centrados verticalmente.
- Subtareas: visibles en todas partes (pestañas, Atrasadas y todos los filtros de la gestión): "2/5" con mini barra; tocarlo abre el checklist inline para marcarlas. Cada una muestra su fecha corta; las vencidas en rojo como las tareas atrasadas. Orden: pendientes por fecha (vencidas primero, sin fecha al final, luego creación) y completadas al final. Sin texto de "siguiente paso". Completar todas solo destaca el checkbox (no cierra la tarea). En Archivo se ve "✓ 4/5 subtareas".
- **Próximamente** (`date: null`): filtro propio en la gestión con contador y botones rápidos Hoy / Mañana / Fecha (solo ahí). Sin repetición.
- **Regla: no agregar acciones rápidas de reprogramación ni "pasar a hoy" a las tareas atrasadas** (sección "⚠ Atrasadas"). Su urgencia visual es intencional: mismo estilo de siempre, solo checkbox y checklist de subtareas.
- **Regla de Enfoque limpio** (tareas, metas y hábitos): en Enfoque solo nombre, avance/estado, fecha o urgencia cuando corresponda, ⭐, indicador de subtareas y estado de ritmo. Nada de área/categoría, badge de repetición (🔁), etiqueta de período ni otra metadata de configuración: eso vive solo en las vistas de gestión. En tareas se controla con `renderItem(t, { focus: true })`.
- **Ritmo esperado** (`Goals.goalPace`, cálculo sin cambios): solo metas cuantitativas activas y no cumplidas. Esperado = target × días transcurridos del período (con hoy) / días del período (semana lunes–domingo, mes o año calendario). **Solo se muestra en la gestión de metas**, como una línea en positivo "Llevas X de Y a la fecha" (X = avance, Y = ⌈esperado⌉, en la unidad de la meta): verde con "✓" si X ≥ Y, gris neutro si no. Sin marca en la barra. En Enfoque las metas muestran solo nombre, "X/Y unidad" y la barra de avance.
- **Origen del avance** (`Goals.originBreakdown`, solo en la tarjeta de gestión de metas cuantitativas): bloque "Aporta a esta meta" con hábitos (suma de `contributions` del período que cayeron en esta meta vía `Habits.findGoalForDate`), "Tareas · N" (completadas vinculadas dentro del período), cada meta hija ("Nombre · semana 10–16 nov · 2": `current` si está activa, `propagatedCurrent` si está archivada) y "Manual" con el resto si es > 0. Sin hábitos, tareas ni hijas: "Sin acciones vinculadas".
- **División en cascada**: al crear una meta anual o mensual con objetivo > 0 aparece "Dividir en metas más pequeñas" (no en semanales ni cualitativas); también la acción "✂️ Dividir" en la tarjeta de una anual/mensual activa sin hijas activas. Anual → secciones Mensual y Semanal; mensual → Semanal. Nombre y unidad por defecto los de la padre; objetivos sugeridos ⌈target/12⌉ y ⌈target/52⌉ desde anual, ⌈target/(días del mes/7)⌉ desde mensual. "Vincular hábito" opcional (activos) con aviso "Reemplazará el vínculo con [meta]". Crea solo las metas del período actual (recurrentes `monthly`/`weekly`, área de la padre); `GoalRollover` crea las siguientes ya vinculadas.
- Avance de metas: todo aporte (hábitos, también con el modal de cantidad; tareas; ajustes manuales) sube en tiempo real por `parentGoalId` vía `Goals.updateCurrent`. Al archivar, `GoalRollover` no vuelve a sumar al padre. Sobrecumplir está permitido.
- **Cierre semanal = solo resumen** (`WeekSummary.open(weekKey)`, vista de pantalla completa `week-summary` con botón cerrar): sin preguntas ni campos, no guarda nada. Accesos: en Enfoque el botón "📊 Resumen de la semana" (domingo → semana en curso, marcada "en curso"; lunes → la que terminó; otros días no aparece) y cada barra de Estadísticas › Resumen › Tendencia. Contenido: rango, puntaje (promedio de `dailySnapshots`, como la tendencia) en anillo animado, veredicto (récord de 12 semanas → "¡Nueva mejor semana!" con celebración; mejor que la anterior → "Semana en alza"; ≥ 80 "Semana sólida"; 50–79 "Semana a medias"; < 50 "Semana difícil · el lunes empieza otra"), ±pts vs semana pasada y récord; Logros (máx. 5), Metas a este ritmo ("llegas en [mes]" / "llegas el día N" en verde; "quedarías en N" en gris neutro), Finanzas de la semana y Bienestar. Sin sección "A mejorar". Rachas y proyecciones usan el estado actual, así que solo aparecen en la semana en curso y la recién terminada.
- **Foco de la semana eliminado** y respuestas del antiguo cierre semanal (`weekClosures`) ocultas en toda la app (incluido Estadísticas › Cierres): son datos legados que se conservan en el JSON pero no se muestran ni se escriben. No existe lógica de "semana pendiente sin cerrar". El cierre del DÍA no cambia.
- Finanzas en Hoy: la tarjeta **"💰 Finanzas"** (`Finance.renderTodayPending`, contenedor `#today-pending`) se muestra siempre. Si hay presupuesto o meta de ahorro, muestra sus barras ("Gastado $X de $Y", "Ahorro $A de $B"). Debajo, "⚠ Atrasados" (fuera de las pestañas, uno por pago con su período más antiguo) y pestañas de pagos con cantidad y total (clase `.fin-tab`, estilo de las de Tareas/Metas): **Hoy**, **Semana** (mañana → domingo), **Mes** (lunes siguiente → fin de mes) y **Más adelante**. Hoy/Semana/Mes incluyen todo pago programado no pagado (mensual, trimestral, anual, cuotas y puntual) que venza en ese rango; **regla: "Más adelante" solo muestra pagos programados puntuales (`recurrence 'once'`) que vencen después del mes actual**, nunca recurrentes ni cuotas. Vencimientos vía `Finance` `getPaymentOccurrences` (extiende `getAllPending` con el mes siguiente y los puntuales). Cada pago: nombre, monto, vencimiento corto y "Cuota N/M"; "Pagar" en todas las pestañas (permite adelantar). Por defecto Hoy; la pestaña se recuerda en la sesión (`sessionStorage`). Subtítulo "N pendientes este mes · $total" (Atrasados + Hoy + Semana + Mes) o "Gastado este mes · $X"; sin pagos en ningún lado: "No hay gastos pendientes". Su "+" abre el modal de registro rápido y la billetera ("Ver movimientos") lleva a **"🧾 Movimientos"** (vista `finance-settings`), cuyo "volver" regresa a donde se entró.
- Pago programado puntual: en el modal de gasto, "No se repite" con **fecha futura** se guarda como pago pendiente (`recurringExpenses` con `recurrence: 'once'` y `dueDate`) en vez de gasto ya hecho. Al pagarlo se registra el movimiento y el puntual sale de la lista.
- Subpestañas de Movimientos: **Pagos programados, Pagado [mes], Archivo, Plan**. "Pagado [mes]" (id `'once'`) lleva el nombre del mes actual en minúscula, generado al renderizar (ej. "Pagado noviembre"), y lista los gastos registrados en el mes en curso. En **Plan** se definen presupuesto mensual, meta de ahorro mensual y presupuesto por categoría (`Finance.openPlan()` abre directo esa pestaña).
- El análisis mensual vive en Estadísticas › Finanzas: resumen Gastado/Ahorrado/%, bloques Presupuesto y Meta de ahorro (o estado vacío con link a Plan), dona, "Gastos y ahorro · 6 meses" (con línea punteada del presupuesto) y "Registros del mes" con editar/eliminar.
- Configuración › Respaldo de datos muestra el peso del estado guardado: "Datos guardados: X KB de 5 MB" (MB con un decimal sobre 1 MB) con una barra (`App.renderStorageUsage`, se recalcula al entrar a Configuración; tamaño = bytes del JSON en `localStorage`). Sin avisos.

## Cómo agregar un módulo nuevo (ej. "Deporte")

1. Crear `js/deporte.js` siguiendo el mismo patrón IIFE y de render que los módulos existentes.
2. Agregar su `<script src="js/deporte.js">` en `index.html`, en el orden correcto según sus dependencias.
3. Agregar su entidad a `defaultState` en `Storage` (ej. `deporte: []`), sin romper datos existentes. Si hace falta migrar datos de usuarios ya existentes, subir `version` y escribir la migración en `Storage.load()`.
4. Agregar su vista (`<section id="view-deporte">`) en `index.html` y su acceso en la navegación vigente.
5. Si corresponde, integrarlo en "Hoy" (`App`) y en "Estadísticas" (`Stats`).
6. Actualizar **`CLAUDE.md`** (mapa de archivos) y **`docs/DATA_MODEL.md`** (nueva entidad) **en el mismo commit**.

## Regla de documentación

Cualquier cambio que agregue, elimine o renombre archivos, módulos, vistas o campos de datos debe actualizar `CLAUDE.md` y `docs/DATA_MODEL.md` en el mismo commit.

## Flujo de Git

Procedimiento estándar para cada cambio (nunca `--force`; si un paso falla por permisos o autenticación, detenerse e informar):

1. Desde `main` actualizado: `git checkout main && git pull`, luego rama nueva `git checkout -b tipo/nombre-corto`.
2. Commit con mensaje descriptivo (un commit por cambio).
3. `git push -u origin tipo/nombre-corto`.
4. Abrir PR hacia `main` con resumen de cambios.
5. Squash merge del PR.
6. Eliminar la rama remota y verificar con `git ls-remote --heads origin tipo/nombre-corto`; si sigue existiendo, `git push origin --delete tipo/nombre-corto` (o el botón "Delete branch" del PR en GitHub).
7. Eliminar la rama local: `git branch -D tipo/nombre-corto`.
8. Volver a `main`, `git pull` y `git fetch --prune`; confirmar con `git ls-remote --heads origin` que solo queda `main` (más ramas con PR abierto).

Recomendado: activar en GitHub *Settings › General › Pull Requests › "Automatically delete head branches"*, así GitHub borra la rama al mergear aunque la herramienta que mergea no lo haga.

## Flujo de trabajo

- Proponer un plan antes de cambios grandes y esperar confirmación.
- Cambios mínimos y acotados a lo pedido; no tocar módulos no relacionados.
- Cero errores en consola.
- Entregar checklist de prueba manual.
- Un commit por cambio, con mensaje descriptivo.
