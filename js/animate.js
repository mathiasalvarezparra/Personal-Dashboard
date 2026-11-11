/* ============================================
   ANIMATE — animaciones de entrada (solo visual)
   Los renders siguen escribiendo el valor final. Este módulo lo guarda en
   data-anim-target, parte desde 0 (o desde el valor anterior si es un
   re-render por una acción del usuario) y aplica el final dos frames
   después para que corra la transición CSS. Nunca toca datos.
   ============================================ */
const Animate = (() => {
  const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const DUR = 800;
  const STAGGER = 50;
  const MAX_STAGGER_STEPS = 8;
  const CELL_STAGGER = 12;
  const CELL_MAX_DELAY = 480;

  const BAR_W = '.ws-bar-fill, .goal-pace-mark, .subtask-fill, .fin-bar-fill, .hab-ov-bar-fill, .goal-bar-fill, .qty-bar-fill, .sg-fill, .wb-fill, .archive-goal-bar-fill, .dc-fill';
  const BAR_H = '.trend-bar, .sh-win-fill, .hab-dot-fill';
  const RING = '.week-day-ring .ring-bar, .ws-ring-bar';
  const NUM = '.trend-summary-val, .trend-val, .sg-val, .sh-win-val, .sh-streak-val, .wb-val, .cd-stat-val, .ws-score-num, .ws-fin-num, .ws-wb-val, .ms-val, .donut-total, .stat-value, .fin-prog-pct';
  const LIST = '.item, .hab-ov-item, .goal-card, .goal-mini-item, .recurring-expense-item, .hist-item, .sh-item, .archive-goal, .donut-legend-row, .sg-row, .wb-row, .day-summary-item, .ws-block';
  const CELL = '.heatmap-cell';
  const SVG_BAR = '.chart-bar';
  const DONUT = '.donut-svg';
  // Controles que cambian de pestaña/sub-vista: lo que rendericen entra "desde 0"
  const TAB_TRIGGERS = '[data-stats-tab], [data-finance-subtab], [data-mnav], [data-jump], [data-horizon-tab], [data-filter], [data-today-horizon], [data-task-tab], [data-fin-tab], [data-archive-toggle], [data-month-toggle], .hist-month-label, .hist-year-label, .focus-tab, .chip';

  const memory = new Map();       // clave estable → último valor final
  const handled = new WeakSet();  // elementos ya preparados (evita doble proceso)
  let entering = true;            // arranque y justo después de navegar/cambiar pestaña
  let enterRaf = 0;
  let maskSeq = 0;

  const ease = t => 1 - Math.pow(1 - t, 5); // ≈ cubic-bezier(0.22, 1, 0.36, 1)

  function twoFrames(fn) { requestAnimationFrame(() => requestAnimationFrame(fn)); }

  function openEnterWindow() {
    entering = true;
    cancelAnimationFrame(enterRaf);
    enterRaf = requestAnimationFrame(() => { entering = false; });
  }

  // Vista/panel activo (isLive) o modal abierto, y además realmente dibujado
  // (descarta pestañas internas con display:none).
  function visible(el) {
    const modal = el.closest('#modal-backdrop');
    if (modal ? modal.hidden : !isLive(el)) return false;
    return el.getClientRects().length > 0;
  }

  function findAll(root, sel) {
    const list = Array.from(root.querySelectorAll(sel));
    if (root.matches(sel)) list.unshift(root);
    return list;
  }

  function keyFor(el) {
    const box = el.closest('[id]');
    const item = el.closest('[data-id]');
    const scope = item || box || document.body;
    const cls = '.' + el.classList[0];
    const idx = Array.from(scope.querySelectorAll(cls)).indexOf(el);
    return `${box ? box.id : ''}/${item ? item.dataset.id : ''}${cls}#${idx}`;
  }

  // Índice de cada elemento dentro de su grupo (mismo contenedor) para el desfase
  function staggered(els, groupOf, step, maxDelay) {
    const counters = new Map();
    return els.map(el => {
      const g = groupOf(el);
      const i = counters.get(g) || 0;
      counters.set(g, i + 1);
      return [el, Math.min(i * step, maxDelay)];
    });
  }

  function clearLater(el, delay, fn) { setTimeout(fn, delay + DUR + 60); }

  function animateBar(el, prop, enter, delay) {
    const finalStr = el.dataset.animTarget || el.style[prop];
    if (!finalStr || !finalStr.endsWith('%')) return;
    const final = parseFloat(finalStr);
    if (isNaN(final)) return;
    const key = keyFor(el);
    const from = enter ? 0 : (memory.has(key) ? memory.get(key) : 0);
    memory.set(key, final);
    if (from === final) return;
    el.dataset.animTarget = finalStr;
    el.style.transition = 'none';
    el.style[prop] = from + '%';
    const startStr = el.style[prop];
    twoFrames(() => {
      el.style.transition = '';
      el.style.transitionDelay = delay ? delay + 'ms' : '';
      // Si el código cambió el valor mientras tanto, se respeta el suyo
      if (el.style[prop] === startStr) el.style[prop] = finalStr;
      delete el.dataset.animTarget;
      clearLater(el, delay, () => { el.style.transitionDelay = ''; });
    });
  }

  function animateRing(el, enter, delay) {
    const C = parseFloat(el.getAttribute('stroke-dasharray'));
    const final = parseFloat(el.dataset.animTarget || el.getAttribute('stroke-dashoffset'));
    if (isNaN(C) || isNaN(final)) return;
    const key = keyFor(el);
    const from = enter ? C : (memory.has(key) ? memory.get(key) : C);
    memory.set(key, final);
    if (from === final) return;
    el.dataset.animTarget = String(final);
    el.style.transition = 'none';
    el.style.strokeDashoffset = from + 'px';
    twoFrames(() => {
      el.style.transition = '';
      el.style.transitionDelay = delay ? delay + 'ms' : '';
      el.style.strokeDashoffset = final + 'px';
      delete el.dataset.animTarget;
      // Al terminar manda de nuevo el atributo (mismo valor final)
      clearLater(el, delay, () => { el.style.strokeDashoffset = ''; el.style.transitionDelay = ''; });
    });
  }

  // ── Números: cuentan respetando el formato original (moneda, %, decimales) ──
  function parseToken(tok, prefix) {
    if (/^\d{1,3}(\.\d{3})+$/.test(tok)) return { value: +tok.replace(/\./g, ''), style: 'locale' };
    if (/^\d+,\d+$/.test(tok)) return { value: +tok.replace(',', '.'), style: 'comma', decimals: tok.split(',')[1].length };
    if (/^\d+\.\d+$/.test(tok)) return { value: +tok, style: 'dot', decimals: tok.split('.')[1].length };
    if (/^\d+$/.test(tok)) return { value: +tok, style: prefix.includes('$') ? 'locale' : 'int' };
    return null;
  }
  function fmt(v, p) {
    if (p.style === 'locale') return Math.round(v).toLocaleString('es-CL');
    if (p.style === 'comma') return v.toFixed(p.decimals).replace('.', ',');
    if (p.style === 'dot') return v.toFixed(p.decimals);
    return String(Math.round(v));
  }

  function animateNumber(el, enter, delay) {
    if (el.children.length) return;
    const original = el.dataset.animText || el.textContent;
    const m = original.match(/\d[\d.,]*/);
    if (!m) return;
    const prefix = original.slice(0, m.index);
    const suffix = original.slice(m.index + m[0].length);
    const p = parseToken(m[0], prefix);
    if (!p) return;
    const key = keyFor(el);
    const from = enter ? 0 : (memory.has(key) ? memory.get(key) : 0);
    memory.set(key, p.value);
    if (from === p.value) return;

    const run = {};
    el.__animRun = run;
    el.dataset.animText = original;
    const write = txt => { el.textContent = txt; el.__animLast = txt; };
    const finish = () => { delete el.dataset.animText; };
    write(prefix + fmt(from, p) + suffix);
    const start = performance.now() + delay;
    const step = now => {
      if (el.__animRun !== run) return;
      // Si el código reescribió el texto mientras tanto, se respeta el suyo
      if (!el.isConnected || el.textContent !== el.__animLast) return finish();
      const t = Math.min(1, Math.max(0, (now - start) / DUR));
      if (t >= 1) { write(original); return finish(); }
      write(prefix + fmt(from + (p.value - from) * ease(t), p) + suffix);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ── Cascadas por clase CSS (keyframes; solo transform/opacity) ──
  function playClass(pairs, cls) {
    if (!pairs.length) return;
    pairs.forEach(([el]) => el.classList.remove(cls));
    void document.body.offsetWidth; // un solo reflow para poder repetir la animación
    pairs.forEach(([el, delay]) => {
      el.style.animationDelay = delay ? delay + 'ms' : '';
      el.classList.add(cls);
      el.addEventListener('animationend', () => {
        el.classList.remove(cls);
        el.style.animationDelay = '';
      }, { once: true });
    });
  }

  // ── Dona de Finanzas: barrido con una máscara (solo stroke-dashoffset) ──
  function animateDonut(svg) {
    const segs = Array.from(svg.querySelectorAll('circle[stroke-dasharray]'));
    if (!segs.length || svg.querySelector('[data-anim-mask]')) return;
    const s0 = segs[0];
    const cx = s0.getAttribute('cx'), cy = s0.getAttribute('cy');
    const r = parseFloat(s0.getAttribute('r'));
    const sw = parseFloat(s0.getAttribute('stroke-width')) || 10;
    if (isNaN(r)) return;
    const C = 2 * Math.PI * r;
    const NS = 'http://www.w3.org/2000/svg';
    const id = 'anim-donut-' + (++maskSeq);
    const defs = document.createElementNS(NS, 'defs');
    defs.setAttribute('data-anim-mask', '');
    const mask = document.createElementNS(NS, 'mask');
    mask.setAttribute('id', id);
    mask.setAttribute('maskUnits', 'userSpaceOnUse');
    const mc = document.createElementNS(NS, 'circle');
    [['cx', cx], ['cy', cy], ['r', r], ['fill', 'none'], ['stroke', '#fff'],
     ['stroke-width', sw * 2 + 2], ['stroke-dasharray', C], ['transform', `rotate(-90 ${cx} ${cy})`]]
      .forEach(([k, v]) => mc.setAttribute(k, v));
    mc.style.strokeDashoffset = C + 'px';
    mask.appendChild(mc);
    defs.appendChild(mask);
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('mask', `url(#${id})`);
    s0.parentNode.insertBefore(g, s0);
    segs.forEach(s => g.appendChild(s));
    svg.insertBefore(defs, svg.firstChild);
    twoFrames(() => {
      mc.classList.add('anim-sweep');
      mc.style.strokeDashoffset = '0px';
      clearLater(mc, 0, () => {
        // Deja la dona exactamente como la dibujó el render
        g.removeAttribute('mask');
        defs.remove();
      });
    });
  }

  function process(roots, enterMode, force) {
    if (reduced) return;
    const pick = sel => {
      const out = [];
      roots.forEach(root => findAll(root, sel).forEach(el => {
        if ((force || !handled.has(el)) && !out.includes(el) && visible(el)) out.push(el);
      }));
      out.forEach(el => handled.add(el));
      return out;
    };
    const isEnter = el => enterMode || !!el.closest('#modal-backdrop');
    const box = el => el.closest('[id]');
    const step = el => isEnter(el) ? STAGGER : 0;
    const enterOnly = sel => pick(sel).filter(isEnter);
    const MAXD = STAGGER * MAX_STAGGER_STEPS;

    // Primero todas las lecturas (layout), después todas las escrituras
    const barsW = staggered(pick(BAR_W), box, STAGGER, MAXD);
    const barsH = staggered(pick(BAR_H), box, STAGGER, MAXD);
    const rings = staggered(pick(RING), box, STAGGER, MAXD);
    const nums = staggered(pick(NUM), box, STAGGER, MAXD);
    // Solo en entradas (cargar, navegar, cambiar pestaña, abrir panel)
    const items = staggered(enterOnly(LIST).filter(el => !el.parentElement.closest(LIST)), el => el.parentElement, STAGGER, MAXD);
    const cells = staggered(enterOnly(CELL), el => el.parentElement, CELL_STAGGER, CELL_MAX_DELAY);
    const svgBars = enterOnly(SVG_BAR).map(el => {
      const i = Array.from(el.ownerSVGElement.querySelectorAll(SVG_BAR)).indexOf(el);
      return [el, Math.min(i, MAX_STAGGER_STEPS) * STAGGER];
    });
    const donuts = enterOnly(DONUT);

    barsW.forEach(([el, d]) => animateBar(el, 'width', isEnter(el), step(el) && d));
    barsH.forEach(([el, d]) => animateBar(el, 'height', isEnter(el), step(el) && d));
    rings.forEach(([el, d]) => animateRing(el, isEnter(el), step(el) && d));
    nums.forEach(([el, d]) => animateNumber(el, isEnter(el), step(el) && d));
    playClass(items, 'anim-rise');
    playClass(cells, 'anim-pop');
    playClass(svgBars, 'anim-grow-y');
    donuts.forEach(animateDonut);
  }

  // Re-anima todo lo visible dentro de `scope` desde 0 (al entrar a una vista)
  function enter(scope) {
    if (reduced || !scope) return;
    openEnterWindow();
    process([scope], true, true);
  }

  // Tras un cambio de pestaña: lo que quedó oculto se olvida (para animarse la
  // próxima vez que aparezca) y lo que apareció sin re-render se anima ahora.
  const ALL = [BAR_W, BAR_H, RING, NUM, LIST, CELL, SVG_BAR, DONUT].join(', ');
  function revealPass() {
    const view = document.querySelector('.view.active');
    if (!view) return;
    view.querySelectorAll(ALL).forEach(el => {
      if (!el.getClientRects().length) handled.delete(el);
    });
    process([view], true, false);
  }

  if (!reduced) {
    new MutationObserver(records => {
      const roots = [];
      records.forEach(r => r.addedNodes.forEach(n => {
        if (n.nodeType === 1 && n.isConnected) roots.push(n);
      }));
      if (roots.length) process(roots, entering, false);
    }).observe(document.body, { childList: true, subtree: true });

    // Fase de captura: corre antes que los handlers de la app, así lo que
    // rendericen al cambiar de pestaña se anima como entrada.
    document.addEventListener('click', e => {
      if (!e.target.closest || !e.target.closest(TAB_TRIGGERS)) return;
      openEnterWindow();
      requestAnimationFrame(revealPass);
    }, true);

    // El arranque (App.init) cuenta como entrada; termina en el primer frame.
    document.addEventListener('DOMContentLoaded', openEnterWindow);
  }

  return { enter };
})();
