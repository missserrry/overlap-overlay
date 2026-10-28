import { connect, setupPage, getFixedScale, onScaleChange, onCardsChange } from '/common/overlay.js';

setupPage();
const wx = document.getElementById('wx');
const DEFAULT_CARDS = ['trackTemp', 'wetness', 'precip', 'wind'];
const BASE_WIDTH = 240; // ширина окна, при которой масштаб = 1 в режиме «авто»

const WET_NAMES = ['', 'Dry', 'Mostly dry', 'Very lightly wet', 'Lightly wet', 'Moderately wet', 'Very wet', 'Extremely wet'];
const icon = (name) => `<i class="ico" style="--i:url(/vendor/icons/${name}.svg)"></i>`;

const CAR = `<svg class="car" viewBox="0 0 34 56" aria-hidden="true">
  <rect x="2" y="9" width="5" height="11" rx="1.5" fill="#3a3d42"/><rect x="27" y="9" width="5" height="11" rx="1.5" fill="#3a3d42"/>
  <rect x="2" y="36" width="5" height="11" rx="1.5" fill="#3a3d42"/><rect x="27" y="36" width="5" height="11" rx="1.5" fill="#3a3d42"/>
  <path d="M17 1c7 0 11 4 11.5 11l1 14-1 20c-.4 5-5 8-11.5 8s-11.100-3-11.500-8l-1-20 1-14C6 5 10 1 17 1z" fill="#5a5e65"/>
  <path d="M9.500 19c2.500-2 5-2.500 7.500-2.500s5 .5 7.500 2.500l-1 7c-2 1-4 1.300-6.500 1.300s-4.500-.3-6.500-1.300z" fill="#1e2024"/>
  <path d="M10 38c2 1 4.500 1.500 7 1.500s5-.5 7-1.500l.5 5c-2 1.500-4.500 2-7.500 2s-5.500-.5-7.500-2z" fill="#1e2024"/>
</svg>`;
const ARROW = `<svg viewBox="0 0 24 32" aria-hidden="true"><defs><linearGradient id="wg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--accent,#35d0e6)" stop-opacity="0.15"/><stop offset="1" style="stop-color:var(--accent,#35d0e6)"/></linearGradient></defs>
  <path d="M12 31 L2 17 L9 19 L9 2 L15 2 L15 19 L22 17 Z" fill="url(#wg)"/></svg>`;

// Каждая карточка: html и функция обновления значений на месте (без перестройки — иначе не будет плавного вращения)
const CARDS = {
  trackTemp: {
    html: () => `<div class="label">Track temp</div><div class="line">${icon('road')}<div class="big" data-v>–</div></div>`,
    update: (el, m) => { el.querySelector('[data-v]').innerHTML = temp(m.trackTemp, m); },
    ok: (m) => m.trackTemp != null,
  },
  airTemp: {
    html: () => `<div class="label">Air temp</div><div class="line">${icon('thermometer')}<div class="big" data-v>–</div></div>`,
    update: (el, m) => { el.querySelector('[data-v]').innerHTML = temp(m.airTemp, m); },
    ok: (m) => m.airTemp != null,
  },
  wetness: {
    html: () => `<div class="label">Track wetness</div><div class="wet">${icon('sun')}<div class="bar2"><i data-bar></i></div>${icon('droplet')}</div><div class="wet-name" data-v>–</div>`,
    update: (el, m) => {
      const w = Math.min(Math.max(m.trackWetness, 1), 7);
      el.querySelector('[data-bar]').style.width = `${((w - 1) / 6) * 100}%`;
      el.querySelector('[data-v]').textContent = WET_NAMES[w] || '–';
    },
    ok: (m) => m.trackWetness != null,
  },
  precip: {
    html: () => `<div class="label">Precipitation</div><div class="line">${icon('cloud-rain')}<div class="big" data-v>–</div></div>`,
    update: (el, m) => { el.querySelector('[data-v]').innerHTML = percent(m.precip); },
    ok: (m) => m.precip != null,
  },
  humidity: {
    html: () => `<div class="label">Humidity</div><div class="line">${icon('droplets')}<div class="big" data-v>–</div></div>`,
    update: (el, m) => { el.querySelector('[data-v]').innerHTML = percent(m.humidity); },
    ok: (m) => m.humidity != null,
  },
  fog: {
    html: () => `<div class="label">Fog</div><div class="line">${icon('cloud-fog')}<div class="big" data-v>–</div></div>`,
    update: (el, m) => { el.querySelector('[data-v]').innerHTML = percent(m.fog); },
    ok: (m) => m.fog != null,
  },
  wind: {
    html: () => `<div class="label">Wind</div>
      <div class="compass"><div class="ring" data-ring><b class="n">N</b><b class="e">E</b><b class="s">S</b><b class="w">W</b></div>${CAR}<div class="arrow" data-arrow>${ARROW}</div></div>
      <div class="wind-speed">${icon('wind')}<div class="big" data-v>–</div></div>`,
    update: (el, m) => {
      const speed = m.imperial ? m.windSpeed * 2.237 : m.windSpeed * 3.6;
      el.querySelector('[data-v]').innerHTML = `${Math.round(speed)}<small>${m.imperial ? 'MPH' : 'KPH'}</small>`;
      const arrow = el.querySelector('[data-arrow]');
      const known = Number.isFinite(m.yawNorth) && Number.isFinite(m.windDir);
      arrow.hidden = !known;
      if (Number.isFinite(m.yawNorth)) turn(el.querySelector('[data-ring]'), -m.yawNorth * 180 / Math.PI);
      if (known) turn(arrow, (m.windDir - m.yawNorth) * 180 / Math.PI);
    },
    ok: (m) => m.windSpeed != null,
  },
};

const temp = (c, m) => (c == null ? '–' : m.imperial ? `${Math.round((c * 9) / 5 + 32)}<small>°F</small>` : `${c.toFixed(1)}<small>°C</small>`);
const percent = (f) => (f == null ? '–' : `${Math.round(f * 100)}<small>%</small>`);

// Поворот без «перемотки» через 360°: берём ближайший к прошлому углу эквивалент
function turn(el, deg) {
  const prev = el._deg ?? deg;
  const next = deg + 360 * Math.round((prev - deg) / 360);
  el._deg = next;
  el.style.transform = `rotate(${next.toFixed(1)}deg)`;
}

let model = null;
let cardIds = [];
let nodes = new Map();

function build(ids) {
  cardIds = ids.filter((id) => CARDS[id]);
  wx.textContent = '';
  nodes = new Map();
  for (const id of cardIds) {
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = CARDS[id].html();
    wx.appendChild(el);
    nodes.set(id, el);
  }
}
build(DEFAULT_CARDS);

function fit() {
  const W = window.innerWidth, H = window.innerHeight;
  const fixed = getFixedScale();
  document.documentElement.style.setProperty('--scale', (fixed ?? Math.min(Math.max(W / BASE_WIDTH, 0.5), 3)).toFixed(4));
  // карточки, не поместившиеся по высоте, убираем с конца
  const els = [...nodes.values()];
  els.forEach((el) => { el.hidden = false; });
  for (let i = els.length - 1; i > 0 && wx.scrollHeight > H + 0.5; i--) els[i].hidden = true;
}

function render() {
  if (!model) { wx.classList.add('hidden'); return; }
  wx.classList.remove('hidden');
  for (const id of cardIds) {
    const el = nodes.get(id), def = CARDS[id];
    const ok = def.ok(model);
    el.classList.toggle('nodata', !ok);
    if (ok) def.update(el, model);
  }
  fit();
}

onCardsChange((ids) => { build(ids); render(); });
onScaleChange(fit);
window.addEventListener('resize', fit);
connect('weather', (msg) => { model = msg.data; render(); });
