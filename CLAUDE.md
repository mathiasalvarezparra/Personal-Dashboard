# Mi Dashboard

## Qué es

App personal de hábitos, tareas, metas y finanzas. Uso principal: instalada en pantalla de inicio del iPhone (PWA-ish, sin ser instalable de verdad). 100% offline, sin backend, un solo usuario (sin login, sin sync entre dispositivos salvo exportar/importar JSON manual).

## Stack y restricciones

HTML, CSS y JS **vanilla**. Scripts clásicos (`<script src="...">`, sin `type="module"`) cargados en orden fijo desde `index.html`, compartiendo scope global. Sin frameworks, sin paso de build, sin dependencias de npm.

**No introduzcas nada de eso** (framework, bundler, paquete npm, módulos ES) **sin que yo lo pida explícitamente.**

## Mapa de archivos (`js/`, en orden de carga real en `index.html`)

1. `storage.js` — `Storage`: estado global, persistencia en `localStorage`, export/import JSON, migraciones.
2. `ui.js` — `UI`: navegación entre vistas (`go`/`goBack`), modal genérico, toast, helpers de fecha.
3. `helpers.js` — `escapeHtml`, `escapeAttr`, `isLive` (funciones sueltas, no un módulo).
4. `habits.js` — `Habits`: hábitos cuantitativos, streaks, heatmap, progreso diario.
5. `tasks.js` — `Tasks`: tareas puntuales y recurrentes.
6. `goals.js` — `Goals`: metas por horizonte (semana/mes/año), jerarquía padre-hijo.
7. `goal-archive.js` — `GoalArchive`: vista de solo lectura de metas archivadas.
8. `finance.js` — `Finance`: gastos recurrentes, movimientos (gastos/ingresos), balance mensual.
9. `templates.js` — `Templates`: sets predefinidos de hábitos+metas para onboarding.
10. `goal-rollover.js` — `GoalRollover`: archiva metas vencidas y auto-crea las recurrentes.
11. `vacation.js` — `Vacation`: modo vacaciones (pausa hábitos en un rango de fechas).
12. `stats.js` — `Stats`: vista de estadísticas (tendencias, cumplimiento, bienestar, finanzas).
13. `onboarding.js` — `Onboarding`: flujo de bienvenida para usuarios nuevos.
14. `app.js` — `App`: controlador principal, orquesta el resto, migraciones one-shot, cierres de día/semana.
15. `main.js` — una línea: `document.addEventListener('DOMContentLoaded', App.init)`.

Cada módulo es un IIFE (`const Nombre = (() => {...})()`) que queda en el scope global del documento (no en `window`, pero accesible como identificador en cualquier script posterior). El orden de carga importa: un módulo puede referenciar a otro definido más abajo, pero solo dentro de funciones que se ejecutan después de que todos los scripts cargaron — nunca en el cuerpo del IIFE al momento de definirse.

## Datos

El estado vive en `localStorage` bajo la clave **`mi_dashboard_v1`**.

**Regla:** nunca cambiar esa clave ni romper datos existentes. Si el esquema cambia de forma incompatible, subir `state.version` y escribir la migración dentro de `Storage.load()`. Las migraciones one-shot específicas de una entidad (ej. agregar un área nueva) viven en `App` con su propio flag en `settings` (ver ejemplos reales en `docs/DATA_MODEL.md`).

Estructura completa de cada entidad, relaciones y qué módulo lee/escribe qué: **`docs/DATA_MODEL.md`** (leerlo antes de tocar cualquier dato).

## Convenciones

- Todos los textos de la UI van en **español**.
- Patrón de render de cada módulo: función `renderX()` que busca su contenedor por `id`, hace `if (!isLive(c)) return;` (evita repintar vistas ocultas), lee `Storage.get()`, arma un string HTML y lo asigna a `.innerHTML`.
- **Uso obligatorio** de `escapeHtml()` al insertar cualquier texto ingresado por el usuario dentro de HTML, y `escapeAttr()` al insertarlo dentro de un atributo (ej. `value="${escapeAttr(x)}"`).

## Sistema de diseño y navegación: pendiente de rediseño

Los estilos viven en `style.css`. El diseño visual y el menú/navegación completos se van a rediseñar — no están documentados en detalle acá a propósito. Solo lo mínimo para operar hoy:

- Cambiar de vista: cualquier elemento con `data-go="nombre-de-vista"` dispara `UI.go('nombre-de-vista')` (listener delegado en `ui.js`). También se puede llamar `UI.go(...)` directo desde código.
- Volver atrás: `data-back` dispara `UI.goBack()` (pila de historial interna).
- Cada vista es una sección `<section id="view-nombre-de-vista" class="view">` en `index.html`.

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
