import { connect, setupPage, onForecastChange } from '/common/overlay.js';

const params = setupPage();
const FORCE = params.get('force') === '1';   // превью в панели: пример прогноза с дождём
const root = document.getElementById('root');

// по умолчанию совпадает со схемой в src/main/layouts.js (FORECAST_SCHEMA)
const DEFAULTS = { headline: true, temp: true, clock: false, cells: 5, threshold: 40, hideDry: false };
let cfg = { ...DEFAULTS };
let model = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name) => `<i class="ico" style="--i:url(/vendor/icons/${name}.svg)"></i>`;

// Пример для превью: через ~12 минут дождь, потом проясняется
function demoModel() {
  const rain = [4, 12, 38, 72, 85, 60, 25, 8];
  const entries = rain.map((r, i) => ({ inMin: i === 0 ? 0 : 6 + (i - 1) * 6, rain: r, temp: 23 - (i > 2 ? 3 : 0), skies: i < 2 ? 1 : 3, clock: (14 * 3600 + i * 360) % 86400 }));
  return { active: true, available: true, entries, imperial: false, precipNow: 0, wetness: 1, multKnown: true };
}

const skyIcon = (skies, rain) => {
  if (rain >= cfg.threshold) return 'cloud-rain';
  const s = String(skies ?? '');
  if (s === 'Clear' || s === '0') return 'sun';
  if (s === 'PartlyCloudy' || s === '1') return 'cloud-sun';
  if (s === 'MostlyCloudy' || s === '2' || s === 'Overcast' || s === '3') return 'cloud';
  return 'sun';
};

const fmtMin = (min) => {
  const m = Math.max(Math.round(min), 1);
  return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${m % 60 ? `${m % 60} мин` : ''}`.trim();
};
const fmtClock = (sec) => `${String(Math.floor(sec / 3600) % 24).padStart(2, '0')}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}`;
const fmtTemp = (c, imperial) => (c == null ? '–' : `${Math.round(imperial ? c * 1.8 + 32 : c)}°`);

// Осадки, состояние покрытия и вероятность в прогнозе — разные показатели
const isRaining = (m) => (m.precipNow ?? 0) >= 0.05;

function headline(m) {
  const list = m.entries;
  const first = list[0];
  const eta = m.multKnown === false ? '~' : '';
  if (isRaining(m)) {
    const clear = list.find((e) => e.inMin > 0.5 && e.rain < cfg.threshold);
    return clear
      ? { kind: 'wet', text: `Дождь идёт · стихнет через ${eta}${fmtMin(clear.inMin)}` }
      : { kind: 'wet', text: 'Дождь идёт · конца в прогнозе не видно' };
  }
  if ((m.wetness ?? 1) >= 3) return { kind: 'wet', text: 'Трасса мокрая' };
  if (first.rain >= cfg.threshold) return { kind: 'soon', text: `Вероятность дождя сейчас · ${Math.round(first.rain)}%` };
  const rainy = list.find((e) => e.inMin > 0.5 && e.rain >= cfg.threshold);
  if (rainy) return { kind: 'soon', text: `Прогноз дождя через ${eta}${fmtMin(rainy.inMin)} · ${Math.round(rainy.rain)}%` };
  const horizon = list[list.length - 1].inMin;
  return { kind: 'dry', text: horizon > 1 ? `Дождя не ожидается · ${fmtMin(horizon)} вперёд` : 'Дождя не ожидается' };
}

function render() {
  const m = FORCE ? demoModel() : model;
  if (!m || !m.active) { root.classList.add('hidden'); return; }
  root.classList.remove('hidden');

  if (!m.available || !m.entries?.length) {
    const t = String(m.weatherType || '');
    const why = /static/i.test(t) || /realistic/i.test(t) ? `режим погоды ${esc(t)}` : 'в этой сессии прогноза нет';
    root.className = 'fc empty';
    root.innerHTML = `<div class="top"><span>${icon('cloud-sun')}FORECAST</span></div><div class="none">Прогноза нет: ${why}</div>`;
    layout();
    return;
  }

  const h = headline(m);
  if (cfg.hideDry && h.kind === 'dry') { root.classList.add('hidden'); return; }
  const cells = m.entries.slice(0, Math.max(3, Math.min(8, cfg.cells)));
  root.className = `fc ${h.kind}`;
  root.innerHTML = `<div class="top"><span>${icon('cloud-sun')}FORECAST</span>${cfg.headline ? '' : ''}</div>`
    + (cfg.headline ? `<div class="head">${esc(h.text)}</div>` : '')
    + `<div class="strip">${cells.map((e, i) => {
      const lvl = e.rain >= cfg.threshold ? 'hi' : e.rain >= cfg.threshold / 2 ? 'mid' : 'lo';
      const label = i === 0 ? 'сейчас' : `+${fmtMin(e.inMin)}`;
      return `<div class="cell ${lvl}${i === 0 ? ' now' : ''}"><span class="when">${label}</span>`
        + (cfg.clock && e.clock != null ? `<span class="clk">${fmtClock(e.clock)}</span>` : '')
        + `<span class="sky">${icon(skyIcon(e.skies, e.rain))}</span>`
        + `<span class="rain"><i style="height:${Math.max(e.rain, 3)}%"></i></span><b class="pct">${Math.round(e.rain)}%</b>`
        + (cfg.temp ? `<span class="tmp">${fmtTemp(e.temp, m.imperial)}</span>` : '')
        + `</div>`;
    }).join('')}</div>`;
  layout();
}

// Карточка вписывается в окно: измеряем при базовом размере и подбираем масштаб
function layout() {
  root.style.setProperty('--scale', 1);
  root.style.width = '360px';
  const w0 = root.offsetWidth, h0 = root.offsetHeight;
  if (!w0 || !h0) return;
  const k = Math.min(window.innerWidth / w0, window.innerHeight / h0);
  root.style.setProperty('--scale', k.toFixed(4));
  root.style.width = `${window.innerWidth}px`;
}

onForecastChange((obj) => { cfg = { ...DEFAULTS, ...obj }; render(); });
window.addEventListener('resize', layout);
connect('forecast', (msg) => { model = msg.data; render(); });
if (FORCE) setInterval(render, 500);
