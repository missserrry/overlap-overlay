import { connect, setupPage, onFuelChange } from '/common/overlay.js';

setupPage();
const root = document.getElementById('root');

// по умолчанию совпадает со схемой в src/main/layouts.js (FUEL_SCHEMA)
const STRATEGY = { l10: 'L10', l5: 'L5', avg: 'ВСЕ', max: 'МАКС', min: 'МИН', last: 'ПОСЛ' };
const DEFAULTS = { strategy: 'l10', margin: 0.5, planLaps: 10, units: 'auto', 'blocks.bar': true, 'blocks.stats': true, 'blocks.save': true, 'blocks.pit': true };
let cfg = { ...DEFAULTS };
let model = null;

const L_PER_GAL = 3.785411784;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function compute(m) {
  const gal = cfg.units === 'gal' || (cfg.units === 'auto' && m.imperial);
  const k = gal ? 1 / L_PER_GAL : 1;
  const unit = gal ? 'gal' : 'L';
  const f = (l, d = 1) => (l == null ? '–' : (l * k).toFixed(d));

  let laps = m.remLaps, planned = false;
  // дистанции нет: в практике считаем «план»; в гонке длину ещё не знаем — лучше промолчать, чем звать долить по выдуманным 10 кругам
  const unknownDist = laps == null && m.kind === 'race';
  if (laps == null) { laps = cfg.planLaps; planned = true; }
  // расход по выбранному способу (последние 10/5 кругов, среднее, максимум, минимум, последний); пока кругов нет — как отдала модель
  const perLap = m.usage && m.usage[cfg.strategy] != null ? m.usage[cfg.strategy] : m.perLap;
  const lapsOfFuel = perLap > 0 ? m.fuel / perLap : null;
  const need = perLap != null && !unknownDist ? (laps + cfg.margin) * perLap : null;   // нужно всего
  let add = need != null ? Math.max(need - m.fuel, 0) : null;           // долить
  const room = m.tank != null ? Math.max(m.tank - m.fuel, 0) : null;    // сколько влезет
  const enough = need != null && add <= 0.05;
  const fits = add == null || room == null || add <= room + 0.05;
  const cap = add != null && room != null ? Math.min(add, room) : add;
  // цвет: хватает — зелёный; нужно долить и влезает — жёлтый; в бак не влезет — красный
  // меньше двух кругов топлива — красная рамка, чтобы заметить сразу
  // (если до финиша и так хватает, красный не нужен: на последних кругах топлива может быть и меньше двух кругов)
  const critical = lapsOfFuel != null && lapsOfFuel < 2 && !enough;
  // «заезжайте на этом круге»: до финиша не хватает, а топлива после финиша этого круга уже меньше, чем на следующий целый круг
  // (с небольшим запасом: решение нужно принять заранее, а не на последних метрах)
  // (если можно дотянуть до финиша хотя бы с запасом в десятую круга, заезд ради нескольких литров не предлагаем)
  const canFinish = perLap > 0 && m.fuel >= (laps + 0.1) * perLap;
  const pitNow = !m.onPitRoad && !unknownDist && perLap > 0 && !enough && !canFinish && lapsOfFuel != null && lapsOfFuel < (1 - (m.lapPct ?? 0)) + 1.15;
  const level = critical || pitNow ? 'low' : need == null ? 'warn' : enough ? 'safe' : fits ? 'warn' : 'low';
  // сколько всего долить до финиша и сколько заездов в боксы это потребует; сколько останется в баке на финише
  const totalRefuel = need != null ? Math.max(need - m.fuel, 0) : null;
  const stops = totalRefuel > 0 && m.tank > 0 ? Math.ceil(totalRefuel / m.tank) : 0;
  const atEnd = perLap != null && !unknownDist ? (enough ? m.fuel - (laps * perLap) : cfg.margin * perLap) : null;
  return { f, unit, k, laps, planned, perLap, need, add, room, enough, fits, cap, level, unknownDist, lapsOfFuel, totalRefuel, stops, atEnd, critical, pitNow };
}

function render() {
  const m = model;
  if (!m || !m.active) { root.classList.add('hidden'); return; }
  root.classList.remove('hidden');
  const c = compute(m);
  const pct = m.tank ? Math.min(m.fuel / m.tank, 1) * 100 : 0;
  root.className = `fuel ${c.level === 'safe' ? '' : c.level}${c.pitNow ? ' pitnow' : ''}`;

  const est = m.source === 'estimate' ? ' · оценка по этому кругу' : m.source === 'history' ? ' · по прошлым сессиям' : '';   // пока нет ни одного полного чистого круга
  let hero;
  if (c.perLap == null) {
    hero = `<div class="hero"><small>РАСХОД</small><b class="na" style="font-size:1.6em;color:var(--text-dim);text-shadow:none">Проедьте круг</b><div class="msg">Считаю расход топлива</div></div>`;
  } else if (c.pitNow) {
    const need = c.fits ? c.add : c.cap;
    hero = `<div class="hero"><small>БОКСЫ</small><b class="pitword">ЭТОТ КРУГ</b><div class="msg">Ещё круг не проедете: заезжайте на дозаправку · долить ${c.f(need)} ${c.unit}${c.stops > 1 ? `, заездов: ${c.stops}` : ''}</div></div>`;
  } else if (c.unknownDist) {
    hero = `<div class="hero"><small>ДОЛИТЬ</small><b class="na" style="font-size:1.6em;color:var(--text-dim);text-shadow:none">–</b><div class="msg">Длина гонки пока неизвестна</div></div>`;
  } else if (c.enough) {
    hero = `<div class="hero"><small>ДОЛИТЬ</small><b>0<span>${c.unit}</span></b><div class="msg">Топлива хватит${c.planned ? ` на ${c.laps} кр` : ' до финиша'}${est}</div></div>`;
  } else if (!c.fits) {
    hero = `<div class="hero"><small>ДОЛИТЬ</small><b>${c.f(c.cap)}<span>${c.unit}</span></b><div class="msg">Бак полный, не хватит ещё ${c.f(c.add - c.room)} ${c.unit}${c.stops ? ` · всего ${c.f(c.totalRefuel)} ${c.unit}, заездов в боксы: ${c.stops}` : ''}${est}</div></div>`;
  } else {
    hero = `<div class="hero"><small>ДОЛИТЬ</small><b>${c.f(c.add)}<span>${c.unit}</span></b><div class="msg">${c.planned ? `Для ${c.laps} кр + запас` : 'Для финиша с запасом'}${est}</div></div>`;
  }

  const bar = cfg['blocks.bar'] ? `<div class="tank"><i style="width:${pct.toFixed(1)}%"></i></div>` : '';
  const left = c.lapsOfFuel != null ? c.lapsOfFuel.toFixed(1) : null;
  const stat = (lab, val) => `<div class="stat"><small>${lab}</small><b class="${val == null ? 'na' : ''}">${val ?? '–'}</b></div>`;
  const stats = cfg['blocks.stats'] ? `<div class="stats">${stat(`РАСХОД / КР · ${STRATEGY[cfg.strategy] || 'L10'}`, c.perLap != null ? `${c.f(c.perLap, 2)} ${c.unit}` : null)}${stat('ХВАТИТ НА', left != null ? `${left} кр` : null)}${stat(c.planned ? 'ПЛАН' : 'ДО ФИНИША', `${c.laps >= 10 ? c.laps.toFixed(0) : c.laps.toFixed(1)} кр`)}</div>` : '';

  // Экономия: цель по расходу на круг и полоса «лифт». Вправо (красное) — тратите больше цели, влево (зелёное) — меньше
  let save = '';
  if (cfg['blocks.save'] && c.perLap != null && m.remLaps != null) {
    const tgt = Math.max((m.fuel / Math.max(m.remLaps + cfg.margin, 0.5)), 0);   // с запасом из настроек
    const over = c.perLap - tgt;                                                  // > 0 — тратите больше, чем можно
    const need = over > 0.005;
    const span = Math.max(tgt * 0.1, 0.05);                                       // ширина полосы: ±10% цели
    const d = m.liveDelta != null ? m.liveDelta : null;
    const pos = d != null ? Math.max(-1, Math.min(1, d / span)) : 0;
    const msg = !need ? 'Экономить не нужно' : `Лифтите: нужно экономить ${c.f(over, 2)} ${c.unit} на круг`;
    const mark = d != null ? `<i class="mk ${d > 0 ? 'over' : 'under'}" style="${pos >= 0 ? `left:50%;width:${pos * 50}%` : `right:50%;width:${-pos * 50}%`}"></i>` : '';
    save = `<div class="save ${need ? 'need' : ''}"><div class="save-head"><small>ЭКОНОМИЯ</small><span>Цель ${c.f(tgt, 2)} ${c.unit}/кр · сейчас ${c.f(c.perLap, 2)}</span></div>${need ? `<div class="sbar"><u></u>${mark}</div><div class="smsg">${d != null ? `<b class="${d > 0 ? 'over' : 'under'}">${d > 0 ? '+' : '–'}${c.f(Math.abs(d), 2)} ${c.unit}</b> на этом круге · ` : ''}${msg}</div>` : `<div class="smsg">${msg}</div>`}</div>`;
  }

  let pit = '';
  if (cfg['blocks.pit'] && m.onPitRoad && m.pitSelected != null && c.add != null) {
    const sel = m.pitSelected;
    const diff = c.add - sel;                  // PitSvFuel приходит в литрах
    const ok = diff <= 0.05;
    pit = `<div class="pit ${ok ? 'ok' : 'bad'}">В меню боксов: <b>${c.f(sel)} ${c.unit}</b> — ${ok ? 'достаточно' : `не хватает ${c.f(diff)} ${c.unit}`}</div>`;
  }

  root.innerHTML = `<div class="top"><span>FUEL</span><b>${c.f(m.fuel)} ${c.unit}</b></div>${bar}${hero}${stats}${save}${pit}`;
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

onFuelChange((obj) => { cfg = { ...DEFAULTS, ...obj }; render(); });
window.addEventListener('resize', layout);
connect('fuel', (msg) => { model = msg.data; render(); });
