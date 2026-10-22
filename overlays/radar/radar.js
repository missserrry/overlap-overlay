import { connect, setupPage, getFlagOpts, onFlagOpts } from '/common/overlay.js';

setupPage();
const box = document.getElementById('box');
const NS = 'http://www.w3.org/2000/svg';
const S = 200;                 // размер холста; центр — (100, 100)
const C = S / 2;
const SIDE_SLOTS = 2;          // до двух машин с каждого борта

const el = (name, attrs = {}, parent) => {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
};
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const mix = (a, b, t) => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16)), pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((x, i) => Math.round(x + (pb[i] - x) * t)).join(',')})`;
};

// ---------- холст ----------
const svg = el('svg', { viewBox: `0 0 ${S} ${S}` }, box);
const defs = el('defs', {}, svg);
// затухание боковой полосы к краю: маски (чёрное — прозрачно, белое — видно)
for (const side of ['L', 'R']) {
  const g = el('linearGradient', { id: `fade${side}`, x1: side === 'L' ? 0 : 1, y1: 0, x2: side === 'L' ? 1 : 0, y2: 0 }, defs);
  el('stop', { offset: 0, 'stop-color': '#000' }, g);
  el('stop', { offset: 0.85, 'stop-color': '#fff' }, g);
  const m = el('mask', { id: `mask${side}`, maskUnits: 'userSpaceOnUse', x: 0, y: -60, width: S, height: 120 }, defs);
  el('rect', { x: side === 'L' ? 34 : C + 10, y: -60, width: 56, height: 120, fill: `url(#fade${side})` }, m);
}
const blur = el('filter', { id: 'soft', x: '-30%', y: '-30%', width: '160%', height: '160%' }, defs);
el('feGaussianBlur', { stdDeviation: 1.2 }, blur);
el('clipPath', { id: 'clipFront' }, defs).appendChild(el('rect', { x: 0, y: 0, width: S, height: C }));
el('clipPath', { id: 'clipRear' }, defs).appendChild(el('rect', { x: 0, y: C, width: S, height: C }));

// перекрестие
const axes = el('g', { opacity: 0.85 }, svg);
const vg = el('linearGradient', { id: 'axisV', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
for (const [o, a] of [[0, 0], [0.5, 1], [1, 0]]) el('stop', { offset: o, 'stop-color': '#fff', 'stop-opacity': a }, vg);
const hg = el('linearGradient', { id: 'axisH', x1: 0, y1: 0, x2: 1, y2: 0 }, defs);
for (const [o, a] of [[0, 0], [0.5, 0.7], [1, 0]]) el('stop', { offset: o, 'stop-color': '#fff', 'stop-opacity': a }, hg);
el('rect', { x: C - 0.6, y: 12, width: 1.2, height: S - 24, fill: 'url(#axisV)' }, axes);
el('rect', { x: 14, y: C - 0.5, width: S - 28, height: 1, fill: 'url(#axisH)' }, axes);

// дуги приближения: спереди (clipFront) и сзади (clipRear)
function makeArc(clip) {
  const gr = el('radialGradient', { id: `arcGlow-${clip}` }, defs);
  const stops = [el('stop', { offset: 0.35, 'stop-opacity': 0.95 }, gr), el('stop', { offset: 1, 'stop-opacity': 0 }, gr)];
  const g = el('g', { class: 'arc', opacity: 0, 'clip-path': `url(#${clip})` }, svg);
  const e = el('ellipse', { cx: C, cy: C, rx: 40, ry: 40, fill: `url(#arcGlow-${clip})`, filter: 'url(#soft)' }, g);
  return { g, e, stops, label: el('text', { x: C, y: C, 'font-size': 11, opacity: 0 }, svg) };
}
const front = makeArc('clipFront'), rear = makeArc('clipRear');

// боковые машины: слоты слева и справа
function makeSide(side) {
  const g = el('g', { class: 'side', opacity: 0 }, svg);
  const rect = el('rect', { x: side === 'L' ? 34 : C + 10, y: -12, width: 56, height: 24, rx: 3, mask: `url(#mask${side})` }, g);
  const core = el('rect', { x: side === 'L' ? C - 21 : C + 10, y: -12, width: 11, height: 24, rx: 3, fill: '#ff2a1f' }, g);
  const label = el('text', { x: side === 'L' ? 50 : S - 50, y: 4, 'font-size': 10 }, g);
  return { g, rect, core, label, side };
}
const sides = { L: Array.from({ length: SIDE_SLOTS }, () => makeSide('L')), R: Array.from({ length: SIDE_SLOTS }, () => makeSide('R')) };

// своя машина
const me = el('rect', { x: C - 7, y: C - 15, width: 14, height: 30, rx: 3.5, fill: '#fff' }, svg);
me.style.filter = 'drop-shadow(0 0 3px rgba(255,255,255,0.6))';

// ---------- обновление ----------
let model = null;

function size() {
  const s = Math.min(window.innerWidth, window.innerHeight);
  svg.setAttribute('width', s); svg.setAttribute('height', s);
}

const colorFor = (m, fromClass, classColor) => {
  if (fromClass && classColor) return classColor;
  // чем ближе борт к борту, тем краснее: от янтарного к красному
  return mix('#ffb020', '#ff2a1f', clamp(1 - (Math.abs(m) - 2) / 8, 0, 1));
};

function render() {
  const o = getFlagOpts();
  const R = clamp(o.range || 15, 8, 40);
  const k = 78 / (R + 4.6);               // единиц холста на метр: в видимую область входит R метров за корпус
  const carH = Math.max(model ? model.carLength * k : 24, 16);
  me.setAttribute('height', carH * 1.2); me.setAttribute('y', C - carH * 0.6);

  const active = !!model?.active;
  box.style.opacity = model ? (active ? 1 : o.idle) : 0;
  if (!model) return;

  // боковые машины
  for (const side of ['L', 'R']) {
    const list = side === 'L' ? model.left : model.right;
    sides[side].forEach((slot, i) => {
      const car = list[i];
      if (!car) { slot.g.setAttribute('opacity', 0); return; }
      const y = C - car.d * k;
      const col = colorFor(car.d, o.cls, car.color);
      slot.g.style.transform = `translateY(${y.toFixed(1)}px)`;
      slot.rect.setAttribute('height', carH); slot.rect.setAttribute('y', -carH / 2);
      slot.core.setAttribute('height', carH); slot.core.setAttribute('y', -carH / 2);
      slot.rect.style.fill = col; slot.core.style.fill = col;
      slot.g.setAttribute('opacity', 1);
      slot.label.textContent = o.dist ? `${Math.abs(car.d).toFixed(1)}` : '';
      slot.label.setAttribute('opacity', o.dist ? 1 : 0);
    });
  }

  // дуги спереди и сзади: чем ближе — тем больше и краснее
  for (const [arc, car, dir] of [[front, model.front, -1], [rear, model.rear, 1]]) {
    if (!car) { arc.g.setAttribute('opacity', 0); arc.label.setAttribute('opacity', 0); continue; }
    const gap = Math.max(Math.abs(car.d) - model.carLength, 0);   // метры между бамперами
    const e = clamp(1 - gap / R, 0, 1);
    const rx = 26 + 62 * e;
    arc.e.setAttribute('rx', rx.toFixed(1)); arc.e.setAttribute('ry', (rx * 0.9).toFixed(1));
    const tint = mix('#ffd000', '#ff2a1f', clamp((e - 0.5) * 2.2, 0, 1));
    arc.stops.forEach((st) => st.setAttribute('stop-color', tint));
    arc.g.setAttribute('opacity', (0.25 + 0.75 * e).toFixed(2));
    if (o.dist) {
      arc.label.textContent = `${gap.toFixed(1)} m`;
      arc.label.setAttribute('y', (C + dir * (rx * 0.9 * 0.92 + 8)).toFixed(1));
      arc.label.setAttribute('opacity', 1);
    } else arc.label.setAttribute('opacity', 0);
  }
}

onFlagOpts(() => { if (model) render(); });
window.addEventListener('resize', size);
connect('radar', (msg) => { model = msg.data; render(); });
size();
