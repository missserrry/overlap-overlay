import { connect, setupPage, onSectorsChange } from '/common/overlay.js';

setupPage();
const rootEl = document.getElementById('root');
const track = document.getElementById('track');

// по умолчанию совпадает со схемой в src/main/layouts.js (SECTORS_SCHEMA)
const DEFAULTS = { max: 5, ref: 'best', decimals: 3, labels: true, fill: true, underline: true, slide: true };
let cfg = { ...DEFAULTS };
let model = null;
let cells = [];
let built = 0;
let winStart = 0;       // первый видимый сектор
let lastIdx = -1;

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

// ---------- ячейки ----------
function build(n) {
  track.textContent = '';
  cells = [];
  for (let i = 0; i < n; i++) {
    const el = document.createElement('div');
    el.className = 'sec wait';
    el.innerHTML = `<i class="fill"></i><span class="lbl">S${i + 1}</span><b class="val">–</b><i class="line"></i>`;
    track.appendChild(el);
    cells.push({ el, lbl: el.querySelector('.lbl'), val: el.querySelector('.val'), fill: el.querySelector('.fill') });
  }
  built = n;
  lastIdx = -1; winStart = 0;
}

const fmt = (d) => `${d < 0 ? '-' : '+'}${Math.abs(d).toFixed(cfg.decimals)}`;

// ---------- окно из max секторов и прокрутка ----------
// Показываем до max секторов; когда проехали последний видимый, окно сдвигается так, что первым становится только что
// проеханный (если секторов осталось меньше — окно упирается в конец, и последним видимым будет последний сектор).
function placeWindow(n, M, idx) {
  if (n <= M) return 0;
  if (idx < lastIdx) winStart = 0;                                // новый круг — снова с первых секторов
  else if (idx > winStart + M - 1) winStart = Math.min(idx - (M > 1 ? 1 : 0), n - M);
  return winStart;
}

function layout() {
  const W = window.innerWidth, H = window.innerHeight;
  const n = built, M = clamp(Math.min(cfg.max, n || 1), 1, 5);
  const cellW = W / M;
  // шрифт вписывается и по высоте, и по ширине ячейки, чтобы подписи не вылезали при сжатии
  const fs = clamp(Math.min(H / 3.1, cellW / 4.4), 6, 80);
  document.documentElement.style.setProperty('--scale', (fs / 14).toFixed(4));
  cells.forEach((c) => { c.el.style.width = `${cellW}px`; });
  const shift = -winStart * cellW;
  track.style.transform = `translateX(${shift}px)`;
}

function render() {
  const m = model;
  if (!m || !m.active) { rootEl.classList.add('hidden'); return; }
  rootEl.classList.remove('hidden');
  if (built !== m.sectors) build(m.sectors);
  track.classList.toggle('slide', !!cfg.slide);
  const M = clamp(Math.min(cfg.max, m.sectors), 1, 5);
  placeWindow(m.sectors, M, m.idx);
  lastIdx = m.idx;

  const r = m.refs?.[cfg.ref] ?? m.refs?.best;
  cells.forEach((c, i) => {
    const done = i < m.idx, live = i === m.idx;
    c.lbl.style.display = cfg.labels ? '' : 'none';
    let d = null;
    if (done) d = r?.values?.[i] ?? null; else if (live) d = r?.live ?? null;
    c.val.textContent = d == null ? '–' : fmt(d);
    // цвет значения — по знаку дельты; цветная линия снизу — только у проеханных секторов
    c.el.className = 'sec' + (live ? ' live' : done ? ' done' : ' wait')
      + (d != null && (done || live) ? (d <= 0 ? ' fast' : ' slow') : '')
      + (cfg.underline && done ? ' ul' : '');
    c.fill.style.width = cfg.fill ? (done ? '0%' : live ? `${(m.fill * 100).toFixed(1)}%` : '0%') : '0%';
  });
  layout();
}

onSectorsChange((obj) => { cfg = { ...DEFAULTS, ...obj }; if (model) render(); else layout(); });
window.addEventListener('resize', layout);
connect('sectors', (msg) => { model = msg.data; render(); });
