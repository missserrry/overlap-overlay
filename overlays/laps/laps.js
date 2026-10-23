import { connect, setupPage, onLapsChange } from '/common/overlay.js';

setupPage();
const root = document.getElementById('root');

// по умолчанию совпадает со схемой в src/main/layouts.js (LAPS_SCHEMA)
const DEFAULTS = { 'blocks.current': true, 'blocks.predict': true, 'blocks.best': true, 'blocks.last': true, 'blocks.leader': true, labels: true };
let cfg = { ...DEFAULTS };
let model = null;

const ICON_TIMER = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2h4"/><path d="M12 14l3-3"/><circle cx="12" cy="14" r="8"/></svg>';
const ICON_TARGET = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>';

const fmt = (s) => {
  if (s == null || !(s >= 0)) return '–:––.–––';
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r.toFixed(3).padStart(6, '0')}`;
};
const fmtDelta = (d) => `${d < 0 ? '-' : '+'}${Math.abs(d).toFixed(3)}`;
const val = (v) => `<b class="${v == null ? 'na' : ''}">${fmt(v)}</b>`;

function render() {
  const m = model;
  if (!m || !m.active) { root.classList.add('hidden'); return; }
  root.classList.remove('hidden');
  const lab = (t) => (cfg.labels ? `<small>${t}</small>` : '');
  const cells = [];
  if (cfg['blocks.best']) cells.push(`<div class="cell">${lab('BEST')}${val(m.best)}</div>`);
  if (cfg['blocks.last']) cells.push(`<div class="cell">${lab('LAST LAP')}${val(m.last)}</div>`);
  if (cfg['blocks.leader']) cells.push(`<div class="cell">${lab(m.leaderIsYou ? 'LEADER · YOU' : 'LEADER')}${val(m.leader)}</div>`);
  const parts = [];
  if (cfg['blocks.current']) parts.push(`<div class="cur">${ICON_TIMER}<span>${fmt(m.current)}</span></div>`);
  if (cfg['blocks.predict']) {
    const d = m.delta == null ? '' : `<span class="d ${m.delta <= 0 ? 'fast' : 'slow'}">${fmtDelta(m.delta)}</span>`;
    parts.push(`<div class="pre">${ICON_TARGET}<span class="${m.predict == null ? 'na' : ''}">${fmt(m.predict)}</span>${d}</div>`);
  }
  if (cells.length) parts.push(`<div class="cells">${cells.join('')}</div>`);
  root.innerHTML = parts.join('');
  root.classList.toggle('empty', !parts.length);
  layout();
}

// Масштаб подгоняется под окно: измеряем блок при базовом размере и вписываем в ширину и высоту
function layout() {
  if (!model?.active) return;
  root.style.setProperty('--scale', 1);
  root.style.width = '320px';
  const w0 = root.offsetWidth, h0 = root.offsetHeight;
  if (!w0 || !h0) return;
  const k = Math.min(window.innerWidth / w0, window.innerHeight / h0);
  root.style.setProperty('--scale', k.toFixed(4));
  root.style.width = `${window.innerWidth}px`;
}

onLapsChange((obj) => { cfg = { ...DEFAULTS, ...obj }; if (model) render(); });
window.addEventListener('resize', layout);
connect('laps', (msg) => { model = msg.data; render(); });
