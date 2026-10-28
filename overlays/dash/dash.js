import { connect, setupPage, getFixedScale, onScaleChange, onDashChange, cssVar } from '/common/overlay.js';
import { fitBar, initHf, renderBar } from '/common/hf.js';
import { absLatch } from '/common/pedals.js';

setupPage();
const root = document.getElementById('dash');
const NS = 'http://www.w3.org/2000/svg';

// настройки по умолчанию совпадают со схемой в src/main/layouts.js (DASH_SCHEMA)
const DEFAULTS = {
  'blocks.ring': true, 'blocks.dots': true, 'blocks.speed': true, 'blocks.rpm': true, 'blocks.graph': true, 'blocks.bars': true, 'blocks.pos': false, 'blocks.foot': true,
  'dots.count': 9, 'dots.shape': 'circle', 'dots.source': 'car', 'dots.from': 60, 'dots.to': 95, 'dots.pit': true, 'dots.blink': false,
  'ring.arc': true, 'ring.flash': true,
  speedUnit: 'auto', labels: true, rpmK: false,
  'graph.seconds': 10, 'graph.thick': 2, 'graph.throttle': true, 'graph.brake': true, 'graph.clutch': false, 'graph.steer': false, 'graph.grid': true, 'graph.fill': false, 'graph.abs': true,
};
let cfg = { ...DEFAULTS };
let model = null;
let refs = {};
let arcGeom = null;

const hf = initHf('dash', () => { if (model) { render(); fitScale(); } });
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
// цвета ламп как у RaceLab: светло-зелёная, оранжевая, красная; голубая — ограничитель питлейна
const LED = { 1: '#90ee90', 2: 'orange', 4: 'red', 5: '#0fe9ff' };

// ---------- разметка по настройкам ----------
function build() {
  const c = cfg;
  const parts = [];
  parts.push('<div class="main' + (c['blocks.ring'] ? '' : ' noring') + '">');
  if (c['blocks.ring']) {
    // как react-circular-progressbar: путь по окружности радиуса 47.5, дуга задаётся штриховкой
    const R = 47.5, C2 = 2 * Math.PI * R;
    const d = `M 50,50 m 0,-${R} a ${R},${R} 0 1 1 0,${2 * R} a ${R},${R} 0 1 1 0,-${2 * R}`;
    const withFoot = c['blocks.foot'];
    const thr = { ratio: withFoot ? 0.67 : 0.74, rot: 0.76 }, brk = { ratio: withFoot ? 0.21 : 0.24, rot: withFoot ? 0.53 : 0.5 };
    arcGeom = { C2, thr, brk };
    const ring = (cls, g) => `<svg viewBox="0 0 100 100"><path class="trail" d="${d}" stroke-width="5" style="stroke-dasharray:${C2}px ${C2}px;stroke-dashoffset:${(1 - g.ratio) * C2}px;transform:rotate(${g.rot}turn);transform-origin:center center"/>`
      + `<path class="path ${cls}" d="${d}" stroke-width="5" data-${cls} style="stroke-dasharray:${C2}px ${C2}px;stroke-dashoffset:${C2}px;transform:rotate(${g.rot}turn);transform-origin:center center"/></svg>`;
    parts.push(`<div class="ring ${c['ring.flash'] ? '' : 'noanim'}" data-ring><div class="tbi" data-tbi>${c['ring.arc'] ? ring('thr', thr) : ''}${c['ring.arc'] ? `<div class="brakeProgress">${ring('brk', brk)}</div>` : ''}</div><div class="gear" data-gear>–</div></div>`);
  }
  if (c['blocks.dots'] || c['blocks.speed'] || c['blocks.rpm']) {
    parts.push('<div class="col">');
    if (c['blocks.dots']) parts.push(`<div class="dots ${c['dots.shape'] === 'bar' ? 'bars' : ''}" data-dots>${'<i></i>'.repeat(c['dots.count'])}</div>`);
    if (c['blocks.speed'] || c['blocks.rpm']) {
      parts.push(`<div class="nums ${c.labels ? '' : 'nolabels'}">`);
      if (c['blocks.speed']) parts.push(`<div>${c.labels ? '<small data-unit>KPH</small>' : ''}<b data-speed>0</b></div>`);
      if (c['blocks.rpm']) parts.push(`<div>${c.labels ? '<small>RPM</small>' : ''}<b data-rpm>0</b></div>`);
      parts.push('</div>');
    }
    parts.push('</div>');
  }
  if (c['blocks.graph']) parts.push('<div class="trace"><canvas data-graph></canvas></div>');
  if (c['blocks.bars'] && !c['bars.out']) {   // bars.out: столбики вынесены в отдельный оверлей Pedals
    parts.push('<div class="bars-wrap">' + [['clutch', 'var(--d-clu, #f5c342)'], ['brake', 'var(--d-brk, #ff3b30)'], ['throttle', 'var(--d-thr, #2ee34a)']]
      .map(([k, col]) => `<div class="barcol" data-col="${k}"><div class="pedal"><i style="--c:${col}" data-bar="${k}"></i></div><b data-val="${k}">0</b></div>`).join('') + '</div>');
  }
  if (c['blocks.pos']) parts.push('<div class="dpos" data-pos>P–</div>');
  parts.push('</div>');
  if (c['blocks.foot']) parts.push('<div class="bar foot hfbar" data-foot></div>');
  root.innerHTML = parts.join('');
  refs = {
    ring: root.querySelector('[data-ring]'), tbi: root.querySelector('[data-tbi]'), thr: root.querySelector('[data-thr]'), brk: root.querySelector('[data-brk]'), gear: root.querySelector('[data-gear]'),
    dots: root.querySelector('[data-dots]'), speed: root.querySelector('[data-speed]'), rpm: root.querySelector('[data-rpm]'),
    unit: root.querySelector('[data-unit]'), graph: root.querySelector('[data-graph]'), pos: root.querySelector('[data-pos]'),
    foot: root.querySelector('[data-foot]'), cols: Object.fromEntries([...root.querySelectorAll('[data-col]')].map((e) => [e.dataset.col, e])),
    bars: Object.fromEntries([...root.querySelectorAll('[data-bar]')].map((e) => [e.dataset.bar, e])),
    vals: Object.fromEntries([...root.querySelectorAll('[data-val]')].map((e) => [e.dataset.val, e])),
  };
  fitScale();
}

// ---------- обороты → лампы ----------
// Как convertRpmToLed у RaceLab: три зоны (зелёная, оранжевая, красная) по N ламп; лампа горит, когда
// (обороты − начало зоны) / длина зоны больше её номера / N. Границы зон берём у машины или по своим процентам.
function limits(m) {
  const sl = m.sl || {};
  const red = sl.redline || sl.last || 8000;
  if (cfg['dots.source'] === 'custom' || sl.first == null || sl.shift == null || sl.last == null) {
    const lo = red * cfg['dots.from'] / 100, hi = red * cfg['dots.to'] / 100, step = (hi - lo) / 3;
    return { green: lo, orange: lo + step, red: lo + 2 * step, max: hi, blink: hi };
  }
  return { green: sl.first, orange: (sl.first + sl.shift) / 2, red: sl.shift, max: sl.last, blink: sl.blink || sl.last };
}
function ledStates(m, n) {
  const out = [];
  if (cfg['dots.pit'] && m.pitLimiter) return Array(n).fill(5);
  const L = limits(m), per = n / 3, rpm = m.rpm ?? 0;
  for (const [from, to, color] of [[L.green, L.orange, 1], [L.orange, L.red, 2], [L.red, L.max, 4]]) {
    for (let i = 0; i < per; i++) out.push(rpm >= to ? color : (rpm - from) / Math.max(to - from, 1) > i / per ? color : 0);
  }
  return out;
}

// ---------- обновление по данным ----------
const samples = [];
let lastGear = null;
const absHeld = absLatch();

function render() {
  const m = model;
  if (!m) { root.classList.add('hidden'); return; }
  root.classList.remove('hidden');
  if (refs.gear) {
    const g = m.gear;
    refs.gear.textContent = g == null ? '–' : g < 0 ? 'R' : g === 0 ? 'N' : g;
    refs.gear.classList.toggle('neutral', g === 0);
    if (g !== lastGear) {                       // смена передачи: перезапускаем анимации (у RaceLab это remount по key)
      lastGear = g;
      for (const el of [refs.tbi, refs.gear]) { if (!el) continue; const base = el === refs.tbi ? 'tbi' : 'gear'; el.className = base + (el === refs.gear && g === 0 ? ' neutral' : ''); void el.offsetWidth; }
      if (refs.tbi && g >= 1 && g <= 6) refs.tbi.classList.add(`g${g}`);
    }
  }
  if (arcGeom && refs.thr) {
    const { C2, thr, brk } = arcGeom;
    refs.thr.style.strokeDashoffset = `${(1 - clamp(m.throttle ?? 0, 0, 1) * thr.ratio) * C2}px`;
    if (refs.brk) refs.brk.style.strokeDashoffset = `${(1 - clamp(m.brake ?? 0, 0, 1) * brk.ratio) * C2}px`;
  }
  if (refs.dots) {
    const n = refs.dots.children.length, st = ledStates(m, n);
    [...refs.dots.children].forEach((d, i) => { d.classList.toggle('on', !!st[i]); if (st[i]) d.style.setProperty('--c', LED[st[i]]); });
    refs.dots.classList.toggle('blink', cfg['dots.blink'] && (m.rpm ?? 0) >= limits(m).blink);
  }
  if (refs.speed) {
    const mph = cfg.speedUnit === 'mph' || (cfg.speedUnit === 'auto' && m.imperial);
    refs.speed.textContent = m.speed == null ? '–' : Math.round(m.speed * (mph ? 2.237 : 3.6));
    if (refs.unit) refs.unit.textContent = mph ? 'MPH' : 'KPH';
  }
  if (refs.rpm) refs.rpm.textContent = m.rpm == null ? '–' : cfg.rpmK ? (m.rpm / 1000).toFixed(1) : Math.round(m.rpm);
  if (refs.pos) refs.pos.textContent = m.classPos ? `P${m.classPos}` : 'P–';
  for (const k of ['clutch', 'brake', 'throttle']) {
    const v = clamp(m[k] ?? 0, 0, 1);
    if (refs.bars[k]) refs.bars[k].style.height = `${(v * 100).toFixed(0)}%`;
    if (refs.vals[k]) refs.vals[k].textContent = Math.round(v * 100);
  }
  refs.cols.brake?.classList.toggle('abs', cfg['graph.abs'] && absHeld(m));
  if (refs.foot) { renderBar(refs.foot, hf.ids('footer'), m.info); fitBar(refs.foot); }
  samples.push({ t: performance.now(), throttle: m.throttle ?? 0, brake: m.brake ?? 0, clutch: m.clutch ?? 0, steer: m.steer ?? 0, abs: m.abs });
}

// ---------- график: перерисовка по таймеру (rAF засыпает, когда окно закрыто игрой) ----------
const lines = () => [['throttle', cssVar('--d-thr', '#2ee34a')], ['brake', cssVar('--d-brk', '#ff3b30')], ['clutch', cssVar('--d-clu', '#f5c342')], ['steer', cssVar('--accent', '#4da3ff')]];
function drawGraph() {
  const cv = refs.graph;
  if (!cv || !root.isConnected) return;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
  if (!w || !h) return;
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const c = cv.getContext('2d');
  c.clearRect(0, 0, w, h);
  const span = cfg['graph.seconds'] * 1000, now = performance.now();
  while (samples.length && now - samples[0].t > span + 500) samples.shift();
  if (cfg['graph.grid']) {
    c.strokeStyle = 'rgba(255,255,255,0.1)'; c.lineWidth = Math.max(1, dpr);
    for (let k = 1; k < 4; k++) { c.beginPath(); c.moveTo(0, h * k / 4); c.lineTo(w, h * k / 4); c.stroke(); }
  }
  const pad = 4 * dpr, thick = cfg['graph.thick'] * dpr;
  for (const [key, col] of lines()) {
    if (!cfg[`graph.${key}`] || samples.length < 2) continue;
    const val = (s) => (key === 'steer' ? clamp(0.5 + s.steer / 2 / Math.PI / 1.5 * 1, 0, 1) : s[key]);
    const pts = samples.map((s) => [w - ((now - s.t) / span) * w, h - pad - val(s) * (h - 2 * pad)]);
    if (cfg['graph.fill'] && key !== 'steer') {
      c.beginPath(); c.moveTo(pts[0][0], h); pts.forEach(([x, y]) => c.lineTo(x, y)); c.lineTo(pts[pts.length - 1][0], h); c.closePath();
      c.fillStyle = col + '30'; c.fill();
    }
    c.beginPath(); c.strokeStyle = col; c.lineWidth = thick; c.lineJoin = 'round'; c.lineCap = 'round';
    pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.stroke();
    if (key === 'brake' && cfg['graph.abs']) {   // ABS: белые штрихи по линии тормоза
      c.strokeStyle = '#fff'; c.lineWidth = thick;
      for (let i = 1; i < samples.length; i++) if (samples[i].abs && samples[i].brake > 0.05) { c.beginPath(); c.moveTo(pts[i - 1][0], pts[i - 1][1]); c.lineTo(pts[i][0], pts[i][1]); c.stroke(); }
    }
  }
}
setInterval(drawGraph, 33);

// ---------- масштаб ----------
function fitScale() {
  const W = window.innerWidth, H = window.innerHeight;
  const fixed = getFixedScale();
  const style = document.documentElement.style;
  style.setProperty('--scale', 1);
  if (fixed != null) { style.setProperty('--scale', fixed.toFixed(4)); return; }
  const nw = root.offsetWidth, nh = root.offsetHeight;
  if (!nw || !nh) return;
  style.setProperty('--scale', clamp(Math.min(W / nw, H / nh), 0.3, 4).toFixed(4));
}

onDashChange((obj) => { cfg = { ...DEFAULTS, ...obj }; build(); if (model) render(); });
onScaleChange(fitScale);
window.addEventListener('resize', fitScale);
let first = true;
connect('dash', (msg) => { model = msg.data; render(); if (first && model) { first = false; fitScale(); } });
build();
