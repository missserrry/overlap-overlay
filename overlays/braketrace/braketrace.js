import { connect, setupPage, cssVar, onPalette } from '/common/overlay.js';

const params = setupPage();
const FORCE = params.get('force') === '1';   // превью: синтетические кривые, чтобы было видно, как выглядит
const root = document.getElementById('root');
const cBrk = document.getElementById('cBrk'), cStr = document.getElementById('cStr');
let model = null;

// Эталон — залитая кривая («прописи»), ваш след — яркая линия поверх. Тормоз красным (как в Dash), руль акцентным цветом.
const brkColor = () => cssVar('--d-brk', '#ff3b30');
const strColor = () => cssVar('--accent', '#35d0e6');

function demoModel() {
  const t = Date.now() / 1000, d = (t * 40) % 400, n = 201;
  const bump = (x, a, b) => (x < a || x > b ? 0 : Math.sin(((x - a) / (b - a)) * Math.PI) ** 0.6);
  const ref = (k) => k * 2 - 100;
  const refBrk = Array.from({ length: n }, (_, k) => +bump(ref(k) + d, 220, 300).toFixed(2));
  const refSteer = Array.from({ length: n }, (_, k) => Math.round(-140 * bump(ref(k) + d, 250, 380)));
  const nowK = 50;
  return {
    active: true, back: 100, fwd: 300, step: 2, steerMax: 180, zones: [[220 - d, 300 - d]],
    refBrk, refSteer,
    myBrk: refBrk.map((v, k) => (k <= nowK ? +(v * 0.9).toFixed(3) : null)),
    mySteer: refSteer.map((v, k) => (k <= nowK ? Math.round(v * 0.85) : null)),
    brake: 0.4, steer: -30, refBrakeNow: 0.5, refSteerNow: -35,
  };
}

function size(c) {
  const dpr = window.devicePixelRatio || 1, w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return { w, h, dpr };
}

// Дорожка: lo..hi — диапазон значений, ref/mine — массивы по окну дистанции, zones — полосы зон торможения эталона
function lane(c, m, ref, mine, lo, hi, color, zones) {
  const { w, h, dpr } = size(c);
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, h);
  const n = ref.length, X = (k) => (k / (n - 1)) * w, Y = (v) => h - ((v - lo) / (hi - lo)) * h;
  if (zones) {
    g.fillStyle = 'rgba(255,255,255,0.05)';
    for (const [a, b] of zones) {
      const x0 = ((a + m.back) / (m.back + m.fwd)) * w, x1 = ((b + m.back) / (m.back + m.fwd)) * w;
      g.fillRect(Math.max(0, x0), 0, Math.min(w, x1) - Math.max(0, x0), h);
    }
  }
  // нулевая линия руля / низ тормоза
  g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = dpr;
  const y0 = Y(lo < 0 ? 0 : lo);
  g.beginPath(); g.moveTo(0, y0); g.lineTo(w, y0); g.stroke();
  // эталон — заливка от нулевой линии
  g.beginPath(); g.moveTo(X(0), y0);
  for (let k = 0; k < n; k++) g.lineTo(X(k), Y(Math.max(lo, Math.min(hi, ref[k]))));
  g.lineTo(X(n - 1), y0); g.closePath();
  g.fillStyle = color; g.globalAlpha = 0.28; g.fill(); g.globalAlpha = 1;
  g.strokeStyle = color; g.globalAlpha = 0.55; g.lineWidth = 1.2 * dpr; g.stroke(); g.globalAlpha = 1;
  // ваш след
  g.beginPath();
  let pen = false;
  for (let k = 0; k < n; k++) {
    if (mine[k] == null) { pen = false; continue; }
    const x = X(k), y = Y(Math.max(lo, Math.min(hi, mine[k])));
    if (pen) g.lineTo(x, y); else { g.moveTo(x, y); pen = true; }
  }
  g.strokeStyle = '#fff'; g.lineWidth = 2.2 * dpr; g.lineJoin = 'round'; g.stroke();
  // «сейчас»: вертикальная линия
  const xn = (m.back / (m.back + m.fwd)) * w;
  g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = dpr;
  g.beginPath(); g.moveTo(xn, 0); g.lineTo(xn, h); g.stroke();
}

function render() {
  const m = FORCE ? demoModel() : model;
  if (!m || !m.active) { root.classList.add('hidden'); return; }
  root.classList.remove('hidden');
  lane(cBrk, m, m.refBrk, m.myBrk, 0, 1, brkColor(), m.zones);
  lane(cStr, m, m.refSteer, m.mySteer, -m.steerMax, m.steerMax, strColor(), null);
  document.getElementById('valBrk').innerHTML = `эталон <b>${Math.round((m.refBrakeNow || 0) * 100)}%</b> · вы <span class="me">${Math.round((m.brake || 0) * 100)}%</span>`;
  document.getElementById('valStr').innerHTML = `эталон <b>${Math.round(m.refSteerNow || 0)}°</b> · вы <span class="me">${Math.round(m.steer || 0)}°</span>`;
}

onPalette(render);
window.addEventListener('resize', render);
connect('braketrace', (msg) => { model = msg.data; render(); });
if (FORCE) setInterval(render, 60);
