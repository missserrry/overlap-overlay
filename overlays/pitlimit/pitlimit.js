import { connect, setupPage, onPitChange } from '/common/overlay.js';

const params = setupPage();
const FORCE = params.get('force') === '1';   // превью в панели: по кругу показываем все состояния
const root = document.getElementById('root');

// по умолчанию совпадает со схемой в src/main/layouts.js (PITLIMIT_SCHEMA)
const DEFAULTS = { exitSeconds: 3, tolerance: 1, units: 'auto', bar: true, hint: true };
let cfg = { ...DEFAULTS };
let model = null;

const KPH_PER_MPH = 1.609344;
const CHECK = '<svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/></svg>';

// Режим превью: красный (лимитер выключен), зелёный (лимитер включён), «Можно ехать»
function demoModel() {
  const fixed = params.get('phase');   // ?phase=0|1|2 — зафиксировать состояние (для проверки)
  const phase = fixed != null ? Number(fixed) : ((Date.now() / 3000) | 0) % 3, f = (Date.now() % 3000) / 3000;
  if (phase === 0) return { active: true, mode: 'limit', speed: 100 - f * 25, limit: 60, limiter: false, imperial: false };
  if (phase === 1) return { active: true, mode: 'limit', speed: 62 - f * 3, limit: 60, limiter: true, imperial: false };
  return { active: true, mode: 'exit', speed: 58, limit: 60, limiter: false, imperial: false, sinceExit: 500 };
}

function render() {
  const m = FORCE ? demoModel() : model;
  if (!m || !m.active || m.mode === 'hidden') { root.classList.add('hidden'); return; }
  // «Можно ехать» показывается заданное число секунд
  if (m.mode === 'exit' && m.sinceExit != null && m.sinceExit > cfg.exitSeconds * 1000) { root.classList.add('hidden'); return; }
  root.classList.remove('hidden');

  const mph = cfg.units === 'mph' || (cfg.units === 'auto' && m.imperial);
  const k = mph ? 1 / KPH_PER_MPH : 1, unit = mph ? 'mph' : 'km/h';
  const speed = m.speed * k, limit = m.limit != null ? m.limit * k : null;

  if (m.mode === 'exit') {
    root.className = 'pl go';
    root.innerHTML = `${CHECK}<div class="big">МОЖНО ЕХАТЬ</div>${cfg.hint && m.limiter ? '<div class="sub">Выключите лимитер</div>' : '<div class="sub">Линия выезда пройдена</div>'}`;
    layout();
    return;
  }

  const over = limit != null && speed > limit + cfg.tolerance * k;
  const bad = !m.limiter && over;                 // лимитер выключен, а скорость выше лимита
  root.className = `pl ${bad ? 'bad' : ''}`;
  const max = limit != null ? limit * 1.5 : Math.max(speed, 100);
  const pct = Math.min(speed / max, 1) * 100, lim = limit != null ? (limit / max) * 100 : null;
  const state = bad ? 'ЛИМИТЕР ВЫКЛЮЧЕН' : m.limiter ? 'ЛИМИТЕР ВКЛЮЧЁН' : 'СКОРОСТЬ В НОРМЕ';
  const msg = bad ? 'Включите лимитер' : m.limiter ? 'Скорость ограничена' : 'Лимит боксов соблюдён';
  const bar = cfg.bar ? `<div class="sbar"><i style="width:${pct.toFixed(1)}%"></i>${lim != null && pct > lim ? `<span class="over" style="left:${lim}%;width:${(pct - lim).toFixed(1)}%"></span>` : ''}${lim != null ? `<u style="left:${lim}%"></u>` : ''}</div>${lim != null ? `<div class="scale"><span style="left:${Math.min(Math.max(lim, 8), 92)}%">лимит ${Math.round(limit)}</span></div>` : ''}` : '';
  root.innerHTML = `<div class="top"><span>PIT LIMITER</span><span class="state">${state}</span></div><div class="spd"><b>${Math.round(speed)}</b><small>${unit}</small></div>${bar}${cfg.hint ? `<div class="msg">${msg}</div>` : ''}`;
  layout();
}

// Содержимое вписывается в окно: измеряем при базовом размере и подбираем масштаб
function layout() {
  root.style.setProperty('--scale', 1);
  root.style.width = '340px';
  const w0 = root.offsetWidth, h0 = root.offsetHeight;
  if (!w0 || !h0) return;
  const k = Math.min(window.innerWidth / w0, window.innerHeight / h0);
  root.style.setProperty('--scale', k.toFixed(4));
  root.style.width = `${window.innerWidth}px`;
}

onPitChange((obj) => { cfg = { ...DEFAULTS, ...obj }; render(); });
window.addEventListener('resize', layout);
connect('pitlimit', (msg) => { model = msg.data; render(); });
if (FORCE) setInterval(render, 80);   // живая анимация в превью
else setInterval(() => { if (model?.mode === 'exit') render(); }, 250);   // «Можно ехать» гаснет по времени
