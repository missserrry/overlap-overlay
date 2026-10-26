import { connect, setupPage, onSrChange } from '/common/overlay.js';

const params = setupPage();
const FORCE = params.get('force') === '1';   // превью в панели: пример, который то растёт, то падает
const root = document.getElementById('root');

// по умолчанию совпадает со схемой в src/main/layouts.js (SR_SCHEMA)
const DEFAULTS = { start: true, delta: true, ir: true, 'stats.incidents': true, 'stats.corners': false, 'stats.clean': true, hideUnranked: true, tech: false };
let cfg = { ...DEFAULTS };
let model = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WEIGHT_NAME = { 1: 'гонка', 0.5: 'открытая сессия', 0.35: 'одиночная сессия' };

// Пример для превью: 40 секунд по кругу — чистые повороты поднимают оценку, инцидент роняет
function demoModel() {
  const t = (Date.now() / 1000) % 40;
  const incidents = t < 20 ? 0 : 4;
  const delta = t < 20 ? 0.004 * t : 0.08 - 0.15 * Math.min((t - 20) / 4, 1) + 0.002 * Math.max(t - 24, 0);
  const corners = 120 + t * 6;
  return { active: true, weight: 1, srStart: 2.75, srNow: 2.75 + delta, delta, incidents, corners, cleanNeeded: incidents ? Math.max(4 * 22.4 - corners * 0.2, 0) : 0, srNowAlt: 2.75 + delta * 1.25, deltaAlt: delta * 1.25, cornersAlt: corners * 1.12, licence: 'C', licColor: '#CA8A04', kind: 'race', iratingNow: 2912, irDelta: t < 20 ? Math.round(t * 1.5) : Math.round(30 - (t - 20) * 2) };
}

// изменение меньше 0.005 на экране — «±0.00», без знака роста или падения
const fmtIr = (ir) => (ir >= 1000 ? `${(ir / 1000).toFixed(1)}k` : String(ir));
const fmtDelta = (d) => (Math.abs(d) < 0.005 ? '±0.00' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}`);

function render() {
  const m = FORCE ? demoModel() : model;
  if (!m || !m.active || m.srStart == null) { root.classList.add('hidden'); return; }
  const counts = m.weight > 0;
  if (!counts && cfg.hideUnranked) { root.classList.add('hidden'); return; }
  root.classList.remove('hidden');

  const now = counts && m.srNow != null ? m.srNow : m.srStart;
  // ±0.005 и меньше на экране всё равно «0.00»: не красим это ни в рост, ни в падение
  const d = counts && m.delta != null ? m.delta : 0;
  const dir = d >= 0.005 ? 'up' : d <= -0.005 ? 'down' : 'flat';
  root.className = `srw ${dir}${counts ? '' : ' off'}`;

  const stats = [];
  if (counts && cfg.start) stats.push(`<span class="st"><small>Было</small><b>${m.srStart.toFixed(2)}</b></span>`);
  if (counts && cfg['stats.incidents']) stats.push(`<span class="st"><small>Инциденты</small><b>${m.incidents}x</b></span>`);
  if (counts && cfg['stats.corners']) stats.push(`<span class="st"><small>Поворотов</small><b>${Math.floor(m.corners)}</b></span>`);
  if (counts && cfg['stats.clean'] && m.cleanNeeded != null) {
    const n = Math.ceil(m.cleanNeeded);
    stats.push(`<span class="st"><small>До нуля</small><b class="${n > 0 ? 'need' : 'ok'}">${n > 0 ? `${n} пов.` : 'в плюсе'}</b></span>`);
  }

  const top = counts ? `оценка · ${esc(WEIGHT_NAME[m.weight] || `вес ${m.weight}`)}` : 'не влияет на SR';
  root.innerHTML = `<div class="top"><span>SAFETY RATING</span><span class="note">${top}</span></div>`
    + `<div class="main"><span class="slic" style="--lic:${esc(m.licColor || '#888')}">${esc(m.licence || '')}</span>`
    + `<b class="now">${now.toFixed(2)}</b>`
    + (counts && cfg.delta ? `<span class="delta">${fmtDelta(d)}</span>` : '')
    + irBlock(m)
    + `</div>`
    + (stats.length ? `<div class="stats">${stats.join('')}</div>` : '')
    + techLine(m, counts);
  layout();
}

// Техническая строка (включается в настройках, в группе «Для разработчика»): оценка с поворотами до последнего финиша гонки, для сверки
function techLine(m, counts) {
  if (!cfg.tech || !counts || m.srNowAlt == null) return '';
  return `<div class="tech">техн. ${fmtDelta(m.deltaAlt ?? 0)} · ${Math.floor(m.cornersAlt ?? 0)} пов.</div>`;
}

// Прогноз iRating рядом с SR: только в гонке (в практике и квалификации iRating не меняется)
function irBlock(m) {
  if (!cfg.ir || m.kind !== 'race' || m.irDelta == null) return '';
  const dir = m.irDelta > 0 ? 'up' : m.irDelta < 0 ? 'down' : 'flat';
  const d = m.irDelta === 0 ? '±0' : `${m.irDelta > 0 ? '+' : '−'}${Math.abs(m.irDelta)}`;
  return `<span class="irb ${dir}"><small>iR</small><b>${m.iratingNow ? fmtIr(m.iratingNow) : ''}</b><span class="idelta">${d}</span></span>`;
}

// Карточка вписывается в окно: измеряем при базовом размере и подбираем масштаб
function layout() {
  root.style.setProperty('--scale', 1);
  root.style.width = '300px';
  const w0 = root.offsetWidth, h0 = root.offsetHeight;
  if (!w0 || !h0) return;
  const k = Math.min(window.innerWidth / w0, window.innerHeight / h0);
  root.style.setProperty('--scale', k.toFixed(4));
  root.style.width = `${window.innerWidth}px`;
}

onSrChange((obj) => { cfg = { ...DEFAULTS, ...obj }; render(); });
window.addEventListener('resize', layout);
connect('sr', (msg) => { model = msg.data; render(); });
if (FORCE) setInterval(render, 200);
