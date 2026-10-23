import { connect, setupPage, getFlagOpts, onFlagOpts } from '/common/overlay.js';

const params = setupPage();
const FORCE = params.get('force'); // ?force=safety — показать флаг принудительно (для проверки и предпросмотра)
const box = document.getElementById('flagbox');

const COLOR = { Y: 'var(--flag-y, #ffe600)', W: 'var(--flag-w, #f4f4f4)', R: 'var(--flag-r, #ff2a1f)', G: 'var(--flag-g, #21d63a)', B: 'var(--flag-b, #2a74ff)', O: 'var(--flag-o, #ff6a10)' };

// Буквы S и C: сетка 3×7 «пикселей», каждый — квадрат из k×k светодиодов
const GLYPH = {
  S: ['XXX', 'X..', 'X..', 'XXX', '..X', '..X', 'XXX'],
  C: ['XXX', 'X.X', 'X..', 'X..', 'X..', 'X.X', 'XXX'],
};
const glyphAt = (x, y, ch, ox, oy, k) => {
  const gx = Math.floor((x - ox) / k), gy = Math.floor((y - oy) / k);
  return x >= ox && y >= oy && gy >= 0 && gy < 7 && gx >= 0 && gx < 3 && GLYPH[ch][gy][gx] === 'X';
};

// Каждый флаг: два кадра (A, B), которые мигают раз в полсекунды; у «ровных» флагов кадры одинаковы.
// Кадр — функция (x, y, w, h) → буква цвета или null. Узоры считаются от размера сетки, поэтому годятся и для квадрата, и для полос.
const solid = (c) => () => c;
const ring = (x, y, w, h, t = Math.max(1, Math.round(Math.min(w, h) / 12))) => (x < t || y < t || x >= w - t || y >= h - t);
const diag = (x, y, w, h) => (w > 1 ? x / (w - 1) : 0) + (h > 1 ? y / (h - 1) : 0) - 1; // < 0 — верхний левый угол, > 0 — нижний правый

// SC: на квадрате S и C рядом, на полосе друг над другом
function sc(withRing) {
  return (x, y, w, h) => {
    if (withRing && ring(x, y, w, h)) return 'Y';
    let lit;
    if (w >= 8) {
      const k = Math.max(1, Math.floor(w / 8));           // толщина штриха
      const gw = 3 * k, gh = 7 * k, gap = k;
      const ox = Math.floor((w - (2 * gw + gap)) / 2), oy = Math.floor((h - gh) / 2);
      lit = glyphAt(x, y, 'S', ox, oy, k) || glyphAt(x, y, 'C', ox + gw + gap, oy, k);
    } else {
      lit = glyphAt(x, y, 'S', 0, 1, 1) || glyphAt(x, y, 'C', 0, 9, 1);
    }
    return lit ? 'W' : null;
  };
}

const stripe = (w) => Math.max(1, Math.round(w / 6)); // ширина диагональной полосы мусорного флага
const cell = (w) => Math.max(1, Math.round(w / 8));    // клетка шахматки
const debris = (x, y, w, h) => ((Math.floor((x + y) / stripe(Math.min(w, h) > 5 ? w : 4)) % 2) ? 'R' : 'Y');

const FLAGS = {
  green: [solid('G'), solid('G')],
  blue: [solid('B'), solid('B')],
  white: [solid('W'), solid('W')],
  red: [solid('R'), solid('R')],
  yellow: [(x, y, w, h) => (diag(x, y, w, h) >= -0.001 ? 'Y' : null), (x, y, w, h) => (diag(x, y, w, h) <= 0.001 ? 'Y' : null)],
  debris: [debris, (x, y, w, h) => (diag(x, y, w, h) >= -0.001 ? debris(x, y, w, h) : null)],
  safety: [sc(false), sc(true)],
  repair: [(x, y, w, h) => {
    const cx = (w - 1) / 2, cy = (h - 1) / 2;
    const rx = w >= 8 ? w * 0.36 : w / 2, ry = w >= 8 ? w * 0.36 : h * 0.32;
    return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 ? 'O' : null;
  }],
  black: [() => null, (x, y, w, h) => (ring(x, y, w, h) ? 'W' : null)],
  disqualify: [() => null, (x, y, w, h) => (ring(x, y, w, h) ? 'W' : null)],
  checkered: [
    (x, y, w) => (((Math.floor(x / cell(w)) + Math.floor(y / cell(w))) % 2 === 0) ? 'W' : null),
    (x, y, w) => (((Math.floor(x / cell(w)) + Math.floor(y / cell(w))) % 2 === 1) ? 'W' : null),
  ],
};
FLAGS.repair[1] = FLAGS.repair[0];

// ---------- панель ----------
let panels = [];   // [{ el, leds, w, h }]
let layout = null;
let flag = null;
let frame = 0;

function buildPanels() {
  box.textContent = '';
  panels = [];
  const dims = getFlagOpts().layout === 'strip' ? [[6, 24], [6, 24]] : [[25, 25]];
  for (const [w, h] of dims) {
    const el = document.createElement('div');
    el.className = 'led-panel';
    el.style.gridTemplateColumns = `repeat(${w}, 1fr)`;
    const leds = [];
    for (let i = 0; i < w * h; i++) { const d = document.createElement('i'); el.appendChild(d); leds.push(d); }
    box.appendChild(el);
    panels.push({ el, leds, w, h });
  }
  layout = getFlagOpts().layout;
  size();
  paint();
}

function size() {
  const W = window.innerWidth, H = window.innerHeight;
  document.documentElement.style.setProperty('--scale', 1);
  if (layout === 'strip') {
    const gap = H * 0.03;
    box.style.gap = `${gap}px`;
    const ph = Math.min(H, ((W - gap) / 2) * (24 / 6));
    for (const p of panels) { p.el.style.height = `${ph}px`; p.el.style.width = `${ph * 6 / 24}px`; p.el.style.fontSize = `${ph / 24}px`; }
  } else {
    const s = Math.min(W, H);
    for (const p of panels) { p.el.style.width = `${s}px`; p.el.style.height = `${s}px`; p.el.style.fontSize = `${s / 25}px`; }
  }
}

function paint() {
  const hide = getFlagOpts().hide && !flag;
  box.classList.toggle('gone', hide);
  const frames = flag ? FLAGS[flag] : null;
  const fn = frames ? frames[frame % frames.length] : null;
  for (const { el, leds, w, h } of panels) {
    let glow = null;
    leds.forEach((led, i) => {
      const x = i % w, y = (i / w) | 0;
      const c = fn ? fn(x, y, w, h) : null;
      if (c) { led.className = 'on'; led.style.setProperty('--c', COLOR[c]); glow ||= COLOR[c]; } else { led.className = ''; }
    });
    el.style.setProperty('--glow', glow ? `color-mix(in srgb, ${glow} 45%, transparent)` : 'transparent');
  }
}

setInterval(() => { frame++; paint(); }, 500);
onFlagOpts(() => { if (getFlagOpts().layout !== layout) buildPanels(); else paint(); });
window.addEventListener('resize', size);
connect('digiflag', (msg) => {
  const id = FORCE || msg.data?.flag;
  const next = id && FLAGS[id] ? id : null;
  if (next !== flag) { flag = next; frame = 0; paint(); }
});
buildPanels();
