import { connect, setupPage, onTrafficChange } from '/common/overlay.js';

const params = setupPage();
const FORCE = params.get('force') === '1';   // превью в панели: показываем пример
const root = document.getElementById('root');

// по умолчанию совпадает со схемой в src/main/layouts.js (TRAFFIC_SCHEMA)
const DEFAULTS = { behind: true, ahead: true, number: false, range: 30, warn: 6 };
let cfg = { ...DEFAULTS };
let model = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ARROW = (down) => `<svg class="arr" viewBox="0 0 10 10" aria-hidden="true"><path d="${down ? 'M1 3 L5 7.5 L9 3' : 'M1 7 L5 2.5 L9 7'}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// Пример для превью: ETA плавно уменьшается
function demoModel() {
  const t = (Date.now() / 1000) % 14;
  return { active: true, behind: { className: 'GTP', color: '#b57cff', number: '7', eta: 14 - t }, ahead: { className: 'GT4', color: '#3ddc84', number: '88', eta: 9 }, };
}

function seg(kind, c, warn) {
  const num = cfg.number ? `<span class="n">#${esc(c.number)}</span>` : '';
  return `<span class="seg ${warn ? 'warn' : ''}">${ARROW(kind === 'behind')}<span class="ctag" style="--cls:${esc(c.color)}">${esc((c.className || '').slice(0, 5))}</span>${num}<span class="t">${Math.max(c.eta, 0).toFixed(c.eta < 10 ? 1 : 0)}<small>s</small></span></span>`;
}

function render() {
  const m = FORCE ? demoModel() : model;
  if (!m || !m.active) { root.classList.add('hidden'); return; }
  const b = cfg.behind && m.behind && m.behind.eta <= cfg.range ? m.behind : null;
  const a = cfg.ahead && m.ahead && m.ahead.eta <= cfg.range ? m.ahead : null;
  if (!b && !a) { root.classList.add('hidden'); return; }
  root.classList.remove('hidden');
  const threat = !!b && b.eta < cfg.warn;
  root.className = `tr${threat ? ' threat' : ''}`;
  root.innerHTML = (b ? seg('behind', b, threat) : '') + (a ? seg('ahead', a, false) : '');
  layout();
}

// Плашка вписывается в окно
function layout() {
  root.style.setProperty('--scale', 1);
  root.style.width = 'auto';
  const w0 = root.offsetWidth, h0 = root.offsetHeight;
  if (!w0 || !h0) return;
  const k = Math.min(window.innerWidth / w0, window.innerHeight / h0);
  root.style.setProperty('--scale', k.toFixed(4));
  root.style.width = `${window.innerWidth}px`;
  root.style.height = `${window.innerHeight}px`;
}

onTrafficChange((obj) => { cfg = { ...DEFAULTS, ...obj }; render(); });
window.addEventListener('resize', layout);
connect('traffic', (msg) => { model = msg.data; render(); });
if (FORCE) setInterval(render, 100);
