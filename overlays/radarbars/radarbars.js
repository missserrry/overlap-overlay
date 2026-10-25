import { connect, setupPage, onRadarBarsChange } from '/common/overlay.js';

const params = setupPage();
const FORCE = params.get('force') === '1';   // превью в панели: машины по очереди проезжают с обеих сторон
const root = document.getElementById('root');
const bars = { l: document.getElementById('barL'), r: document.getElementById('barR') };

// по умолчанию совпадает со схемой в src/main/layouts.js (RADARBARS_SCHEMA)
const DEFAULTS = { thickness: 14, track: true };
let cfg = { ...DEFAULTS };
let model = null;

// Полоса — это корпус машины соперника на этом борту: низ — корма, верх — нос. Закрашена та часть его кузова,
// которая сейчас рядом с вашей машиной.
const segs = {};
for (const side of ['l', 'r']) {
  const seg = document.createElement('i');
  seg.className = 'rbs';
  bars[side].appendChild(seg);
  segs[side] = seg;
}

// Пример для превью: слева машина догоняет и проезжает вперёд, справа — через несколько секунд такая же
function demoModel() {
  const fixed = params.get('d');   // ?d=-2 — зафиксировать положение (для проверки): слева смещение d, справа -d
  if (fixed != null) return { active: true, carLength: 4.6, left: [{ d: Number(fixed) }], right: [{ d: -Number(fixed) }] };
  const t = (Date.now() / 1000) % 12;
  const pass = (shift) => { const x = ((t - shift + 12) % 12) / 9; return x <= 1 ? -9 + x * 18 : null; };
  const l = pass(0), r = pass(5);
  return { active: true, carLength: 4.6, left: l == null ? [] : [{ d: l }], right: r == null ? [] : [{ d: r }] };
}

// Какая часть кузова соперника (0 — корма, 1 — нос) лежит вдоль вашей машины. d — смещение его центра относительно вашего
// (плюс — он впереди), длины машин считаем одинаковыми. Догоняет сзади — сначала рядом с вами его нос (закрашивается верх),
// поравнялся — вся полоса, проехал вперёд — остаётся корма, и она тоже уходит.
function place(el, car, len) {
  const lo = Math.max(-len / 2, car.d - len / 2), hi = Math.min(len / 2, car.d + len / 2);
  if (hi <= lo) { el.style.opacity = 0; return; }
  const from = (lo - car.d + len / 2) / len, to = (hi - car.d + len / 2) / len;
  el.style.top = `${(1 - to) * 100}%`;
  el.style.height = `${(to - from) * 100}%`;
  el.style.opacity = 1;
}

function render() {
  root.style.setProperty('--thick', `${cfg.thickness}px`);
  root.classList.toggle('track', !!cfg.track);
  const m = FORCE ? demoModel() : model;
  const len = m?.carLength || 4.6;
  for (const side of ['l', 'r']) {
    const cars = (side === 'l' ? m?.left : m?.right) || [];
    // на борту может быть две машины; полоса показывает ближайшую
    const car = cars.reduce((best, c) => (!best || Math.abs(c.d) < Math.abs(best.d) ? c : best), null);
    if (car) place(segs[side], car, len); else segs[side].style.opacity = 0;
  }
}

onRadarBarsChange((obj) => { cfg = { ...DEFAULTS, ...obj }; render(); });
connect('radarbars', (msg) => { model = msg.data; render(); });
if (FORCE) setInterval(render, 60);
