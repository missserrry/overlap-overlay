import { connect, setupPage, onRejoinChange } from '/common/overlay.js';

const params = setupPage();
const FORCE = params.get('force') === '1'; // превью в панели: показывать, даже когда вы едете
const root = document.getElementById('root');

// по умолчанию совпадает со схемой в src/main/layouts.js (REJOIN_SCHEMA)
const DEFAULTS = { stopSpeed: 15, always: false, danger: 3, warn: 7, count: 2, names: true, dist: true, bar: true };
let cfg = { ...DEFAULTS };
let model = null;
let hideTimer = null;
let shown = false;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function render() {
  const m = model;
  const stopped = m?.active && m.onTrack && m.speed <= cfg.stopSpeed;
  const want = !!m?.active && (FORCE || cfg.always || stopped);
  // не мигаем: после того как тронулись, держим окно ещё чуть-чуть
  if (want) { clearTimeout(hideTimer); hideTimer = null; shown = true; }
  else if (shown && !hideTimer) hideTimer = setTimeout(() => { shown = false; render(); }, 1200);
  if (!shown || !m?.active) { root.classList.add('hidden'); return; }
  root.classList.remove('hidden');

  const cars = (m.cars || []).slice(0, cfg.count);
  const first = cars[0];
  const level = !first ? 'safe' : first.time < cfg.danger ? 'danger' : first.time < cfg.warn ? 'warn' : 'safe';
  const label = { safe: 'CLEAR', warn: 'CAUTION', danger: 'WAIT' }[level];
  root.className = `rj ${level}`;

  const main = first
    ? `<div class="main"><b>${first.time.toFixed(1)}</b><small>s</small></div>`
    : '<div class="main none"><b>Никого сзади</b></div>';
  const bar = cfg.bar ? `<div class="bar"><i style="width:${first ? Math.max(0, Math.min(1, 1 - first.time / Math.max(cfg.warn * 1.6, 1))) * 100 : 0}%"></i></div>` : '';
  const rows = cfg.names || cfg.dist ? cars.map((c, i) => `<div class="car ${i ? 'sec' : ''}"><span class="stripe" style="--cls:${esc(c.color)}"></span>${cfg.names ? `<span class="num">#${esc(c.number)}</span><span class="nm">${esc(c.name)}</span>` : '<span class="nm"></span>'}<span class="t">${cfg.dist ? `${c.dist} м · ` : ''}<b>${c.time.toFixed(1)} s</b></span></div>`).join('') : '';
  root.innerHTML = `<div class="top"><span>REJOIN</span><span class="state">${label}</span></div>${main}${bar}${rows}`;
  layout();
}

// Содержимое вписывается в окно: измеряем при базовом размере и подбираем масштаб
function layout() {
  root.style.setProperty('--scale', 1);
  root.style.width = '300px';
  const w0 = root.offsetWidth, h0 = root.offsetHeight;
  if (!w0 || !h0) return;
  const k = Math.min(window.innerWidth / w0, window.innerHeight / h0);
  root.style.setProperty('--scale', k.toFixed(4));
  root.style.width = `${window.innerWidth}px`;
}

onRejoinChange((obj) => { cfg = { ...DEFAULTS, ...obj }; render(); });
window.addEventListener('resize', layout);
connect('rejoin', (msg) => { model = msg.data; render(); });
