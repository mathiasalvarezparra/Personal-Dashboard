/* ============================================
   HELPERS
   ============================================ */
// ¿El contenedor está realmente a la vista? (vista activa + panel activo)
// Evita repintar listas ocultas en cada interacción. Es seguro porque cada
// entrada a una vista/pestaña vuelve a renderizar su contenido.
function isLive(el) {
  if (!el) return false;
  // Dentro de un sheet a pantalla completa: vivo si el sheet está visible
  const sheet = el.closest('.sheet');
  if (sheet) return !sheet.hidden;
  const view = el.closest('.view');
  if (!view || !view.classList.contains('active')) return false;
  const panel = el.closest('.focus-panel, .stats-panel');
  return !panel || panel.classList.contains('active');
}

// Mayúscula inicial: si el texto empieza con letra minúscula, solo esa letra pasa
// a mayúscula (respaldo de autocapitalize="sentences" al guardar).
function capitalizeFirst(s) {
  return String(s == null ? '' : s).replace(/^(\s*)(\p{Ll})/u, (m, sp, c) => sp + c.toLocaleUpperCase('es'));
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s) { return String(s || '').replace(/"/g, '&quot;'); }
