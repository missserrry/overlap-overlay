import { connect, setupPage, onPedalsChange } from '/common/overlay.js';
import { absLatch } from '/common/pedals.js';

setupPage();
const root = document.getElementById('root');

// по умолчанию совпадает со схемой в src/main/layouts.js (PEDALS_SCHEMA)
const DEFAULTS = { clutch: true, brake: true, throttle: true, values: true, abs: true };
const PEDALS = [['clutch', 'var(--d-clu, #f5c342)'], ['brake', 'var(--d-brk, #ff3b30)'], ['throttle', 'var(--d-thr, #2ee34a)']];
let cfg = { ...DEFAULTS };
let model = null;
let refs = { cols: {}, bars: {}, vals: {} };
const absHeld = absLatch();
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

function build() {
  const on = PEDALS.filter(([k]) => cfg[k]);
  root.innerHTML = on.map(([k, col]) => `<div class="barcol" data-col="${k}"><div class="pedal"><i style="--c:${col}" data-bar="${k}"></i></div>${cfg.values ? `<b data-val="${k}">0</b>` : ''}</div>`).join('');
  const by = (sel, key) => Object.fromEntries([...root.querySelectorAll(sel)].map((e) => [e.dataset[key], e]));
  refs = { cols: by('[data-col]', 'col'), bars: by('[data-bar]', 'bar'), vals: by('[data-val]', 'val') };
  layout();
}

// Шрифт подписей — от ширины столбика и высоты окна, чтобы цифры росли вместе с окном
function layout() {
  const n = Math.max(1, Object.keys(refs.cols).length);
  const fs = clamp(Math.min(window.innerWidth / n * 0.32, window.innerHeight * 0.085), 8, 72);
  root.style.setProperty('--fs', `${fs.toFixed(1)}px`);
}

function render() {
  const m = model;
  if (!m) { root.classList.add('hidden'); return; }
  root.classList.remove('hidden');
  for (const [k] of PEDALS) {
    const v = clamp(m[k] ?? 0, 0, 1);
    if (refs.bars[k]) refs.bars[k].style.transform = `scaleY(${v.toFixed(3)})`;
    if (refs.vals[k]) refs.vals[k].textContent = Math.round(v * 100);
  }
  refs.cols.brake?.classList.toggle('abs', cfg.abs && absHeld(m));
}

onPedalsChange((obj) => { cfg = { ...DEFAULTS, ...obj }; build(); render(); });
window.addEventListener('resize', layout);
// те же данные, что у Dash: педали в модели Dash уже есть
connect('dash', (msg) => { model = msg.data; render(); });
build();
