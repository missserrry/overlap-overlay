import { connect, setupPage, onRadarBarsChange } from '/common/overlay.js';

const params = setupPage();
const FORCE = params.get('force') === '1';   // превью в панели: машины по очереди проезжают с обеих сторон
const root = document.getElementById('root');
const bars = { l: document.getElementById('barL'), r: document.getElementById('barR') };
const SLOTS = 2;                               // до двух машин на борт

// по умолчанию совпадает со схемой в src/main/layouts.js (RADARBARS_SCHEMA)
const DEFAULTS = { thickness: 14, range: 10, track: true };
let cfg = { ...DEFAULTS };
let model = null;

const segs = { l: [], r: [] };
for (const side of ['l', 'r']) {
  for (let i = 0; i < SLOTS; i++) {
    const s = document.createElement('i');
    s.className = 'rbs';
    bars[side].appendChild(s);
    segs[side].push(s);
  }
}

// Пример для превью: слева машина догоняет и проезжает вперёд, справа — через несколько секунд такая же
function demoModel() {
  const t = (Date.now() / 1000) % 12;
  const pass = (shift) => { const x = ((t - shift + 12) % 12) / 9; return x <= 1 ? -16 + x * 32 : null; };
  const l = pass(0), r = pass(5);
  return { active: true, carLength: 4.6, left: l == null ? [] : [{ d: l }], right: r == null ? [] : [{ d: r }] };
}

// Участок кузова соперника в зоне вдоль вашей машины [-range, +range] м; плюс — впереди, то есть вверху полосы
function place(el, car, len) {
  const R = cfg.range;
  const bottom = Math.max(car.d - len / 2, -R), top = Math.min(car.d + len / 2, R);
  if (top <= bottom) { el.style.opacity = 0; return; }
  el.style.top = `${((R - top) / (2 * R)) * 100}%`;
  el.style.height = `${((top - bottom) / (2 * R)) * 100}%`;
  el.style.opacity = 1;
}

function render() {
  root.style.setProperty('--thick', `${cfg.thickness}px`);
  root.classList.toggle('track', !!cfg.track);
  const m = FORCE ? demoModel() : model;
  const len = m?.carLength || 4.6;
  for (const side of ['l', 'r']) {
    const cars = (side === 'l' ? m?.left : m?.right) || [];
    segs[side].forEach((el, i) => (cars[i] ? place(el, cars[i], len) : (el.style.opacity = 0)));
  }
}

onRadarBarsChange((obj) => { cfg = { ...DEFAULTS, ...obj }; render(); });
connect('radarbars', (msg) => { model = msg.data; render(); });
if (FORCE) setInterval(render, 60);
