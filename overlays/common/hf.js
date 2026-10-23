// Шапка и подвал оверлеев: пункты из каталога, порядок и набор выбирает пользователь (настройки оверлея).
// Каталог id совпадает с HF_CATALOG в src/main/layouts.js; здесь — как каждый пункт выглядит.
import { fmtClock, fmtDuration, fmtLap, fmtIrating, onHfChange, ARROW_UP, ARROW_DOWN } from '/common/overlay.js';

const DEFAULTS = {
  relative: { header: ['sof', 'inc'], footer: ['session', 'lap', 'pos'] },
  standings: { header: ['session'], footer: [] },
  dash: { header: [], footer: ['trackTemp', 'sof', 'fuel', 'clock'] },
};

let state = { header: null, footer: null };
const listeners = [];
// onChange вызывается, когда набор пунктов поменялся (настройки, адрес, панель)
export function initHf(type, onChange) {
  listeners.push(onChange);
  onHfChange((lists) => { state = { ...state, ...lists }; listeners.forEach((f) => f()); });
  return { ids: (zone) => state[zone] ?? DEFAULTS[type][zone] };
}

const item = (k, v, cls = '') => `<span class="hf ${cls}">${k ? `<span class="k">${k}</span>` : ''}<span class="v">${v}</span></span>`;
const chip = (c, v) => `<span class="hf"><span class="chip">${c}</span><span class="v">${v}</span></span>`;
const dash = '–';

const temp = (c, i) => (i.imperial ? `${(c * 9 / 5 + 32).toFixed(0)}°F` : `${c.toFixed(1)}°C`);
const pct = (f) => `${Math.round(f * 100)}%`;
const WET = ['', 'Dry', 'Mostly dry', 'V. light wet', 'Light wet', 'Mod. wet', 'Very wet', 'Ext. wet'];
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const LETTER = { race: 'R', qualify: 'Q', practice: 'P' };

// null — данных нет, пункт не показывается
const RENDER = {
  session: (i) => chip(LETTER[i.kind] || 'T', `${fmtClock(i.elapsed)} / ${fmtDuration(i.total)}`),
  sof: (i) => chip('SOF', fmtIrating(i.sof)),
  inc: (i) => item('<span class="inc-icon">✕</span>', `${i.incidents}${i.incidentLimit ? '/' + i.incidentLimit : ''}`),
  remain: (i) => item('Rem', i.lapsTotal ? `${Math.max(i.lapsTotal - i.lap, 0)} L` : i.remain != null ? fmtClock(i.remain) : dash),
  time: (i) => item('Time', i.remain != null ? fmtClock(i.remain) : dash),
  elapsed: (i) => item('Elapsed', fmtClock(i.elapsed)),
  toFinish: (i) => (i.lapsLeft == null ? null : item('To finish', i.lapsEstimate.exact ? Math.ceil(i.lapsLeft) : '≈' + i.lapsLeft.toFixed(1))),
  drivers: (i) => item('Cars', i.drivers),
  clock: () => item('', new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
  tod: (i) => (i.timeOfDay == null ? null : item('Sim', fmtClock(i.timeOfDay).slice(0, 5))),
  lap: (i) => {
    const est = i.lapsEstimate;
    return item('Lap', `${i.lap}${est ? '/' + (est.exact ? est.value : '~' + est.value.toFixed(1)) : ''}`);
  },
  pos: (i) => chip('P', `${i.classPos ?? dash}${i.classSize ? `<span class="of">/${i.classSize}</span>` : ''}`),
  posGain: (i) => {
    const d = i.posChange;
    if (d == null) return null;
    return item('', d ? `${d > 0 ? ARROW_UP : ARROW_DOWN}${Math.abs(d)}` : '0', d > 0 ? 'up' : d < 0 ? 'down' : '');
  },
  irating: (i) => (i.irDelta == null || i.kind !== 'race' ? null : item('iR', `${i.irDelta > 0 ? '+' : ''}${i.irDelta}`, i.irDelta > 0 ? 'up' : i.irDelta < 0 ? 'down' : '')),
  last: (i) => item('Last', fmtLap(i.last)),
  best: (i) => item('Best', fmtLap(i.best)),
  delta: (i) => (i.delta == null ? null : item('Δ', `${i.delta > 0 ? '+' : '−'}${Math.abs(i.delta).toFixed(2)}`, i.delta > 0 ? 'down' : 'up')),
  airTemp: (i) => (i.airTemp == null ? null : item('Air', temp(i.airTemp, i))),
  trackTemp: (i) => (i.trackTemp == null ? null : item('Track', temp(i.trackTemp, i))),
  wet: (i) => (i.trackWetness == null ? null : item('Surface', WET[i.trackWetness] || dash)),
  rain: (i) => (i.precip == null ? null : item('Rain', pct(i.precip))),
  humidity: (i) => (i.humidity == null ? null : item('Hum', pct(i.humidity))),
  wind: (i) => {
    if (i.windSpeed == null) return null;
    const speed = i.imperial ? `${(i.windSpeed * 2.237).toFixed(0)} mph` : `${(i.windSpeed * 3.6).toFixed(0)} km/h`;
    const deg = i.windDir == null ? null : (((i.windDir * 180) / Math.PI) % 360 + 360) % 360;
    return item('Wind', speed + (deg == null ? '' : ` ${COMPASS[Math.round(deg / 45) % 8]}`));
  },
  fog: (i) => (i.fog == null ? null : item('Fog', pct(i.fog))),
  fuel: (i) => (i.fuel == null ? null : item('Fuel', i.imperial ? `${(i.fuel.level * 0.2642).toFixed(1)} gal` : `${i.fuel.level.toFixed(1)} L`)),
  fuelLaps: (i) => (i.fuel?.laps == null ? null : item('Fuel laps', i.fuel.laps.toFixed(1))),
  oil: (i) => (i.oil == null ? null : item('Oil', temp(i.oil, i))),
  water: (i) => (i.water == null ? null : item('Water', temp(i.water, i))),
  bb: (i) => (i.brakeBias == null ? null : item('BB', `${i.brakeBias.toFixed(1)}%`)),
};

// Заполнить полосу пунктами; пустая полоса прячется
export function renderBar(el, ids, info) {
  const html = info ? ids.map((id) => RENDER[id]?.(info) ?? '').filter(Boolean).join('') : '';
  el.innerHTML = html;
  el.classList.toggle('empty', !html);
}

// Если пункты не помещаются в ширину — убираем с конца, пока не влезут
export function fitBar(el) {
  const items = [...el.children];
  items.forEach((x) => { x.hidden = false; });
  let n = items.length;
  while (n > 1 && el.scrollWidth > el.clientWidth + 0.5) items[--n].hidden = true;
}
