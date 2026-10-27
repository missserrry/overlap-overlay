// Графики окна «Телеметрия»: каналы друг под другом по дистанции круга, круг А и эталон Б наложены друг на друга.
// Каждый канал (дельта, скорость, газ…) — отдельная панель: её тянут за название — выше/ниже, в другой блок графиков
// или влево на панель, чтобы убрать. Высота панели меняется мышью у её верхнего края (над названием) — без видимой полосы.
// У панели есть минимальная высота: если каналов много, блок прокручивается.
// Курсор синхронизирован с проигрыванием: клик или ведение мышью (по умолчанию включено) перематывает круг.
// Линии рисуются в запасной холст только при смене данных, масштаба или размера; каждый кадр — только курсор и подписи.

const COL = { a: '#4A9BF5', b: '#F29A38', grid: 'rgba(255,255,255,0.06)', axis: '#8A9099', text: '#E9EAEC', cursor: '#E2B93B', loss: '#E5544B', gain: '#3CCB6F' };
const MONO = '"JetBrains Mono", ui-monospace, monospace';
const SANS = '"Inter", system-ui, sans-serif';

// Каналы: откуда значение, единицы, вес высоты и пределы оси
export const CHANNELS = [
  { id: 'delta', title: 'Дельта', unit: 'с', weight: 1.1, needB: true, fmt: (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(3)}` },
  { id: 'speed', title: 'Скорость', unit: 'км/ч', key: 'speed', k: 3.6, weight: 1.4, min: 0, fmt: (v) => v.toFixed(0) },
  { id: 'thr', title: 'Газ', unit: '%', key: 'thr', k: 100, weight: 0.85, min: 0, max: 100, fmt: (v) => v.toFixed(0) },
  { id: 'brk', title: 'Тормоз', unit: '%', key: 'brk', k: 100, weight: 0.85, min: 0, max: 100, fmt: (v) => v.toFixed(0) },
  { id: 'gear', title: 'Передача', unit: '', key: 'gear', k: 1, weight: 0.7, min: 0, step: true, fmt: (v) => (v < 0 ? 'R' : v === 0 ? 'N' : v.toFixed(0)) },
  { id: 'steer', title: 'Руль', unit: '°', key: 'steer', k: 1, weight: 1, sym: true, fmt: (v) => v.toFixed(0) },
  { id: 'rpm', title: 'Обороты', unit: 'об/мин', key: 'rpm', k: 1, weight: 0.9, min: 0, fmt: (v) => v.toFixed(0) },
  { id: 'clu', title: 'Сцепление', unit: '%', key: 'clu', k: 100, weight: 0.6, min: 0, max: 100, fmt: (v) => v.toFixed(0) },
];
export const DEFAULT_CHANNELS = ['delta', 'speed', 'thr', 'brk', 'gear', 'steer'];

const SECT_H = 26, AXIS_H = 20, PAD_L = 8, PAD_R = 44;
const MIN_H = 100;   // минимальная высота панели веса 1, пикселей
const GRAB_W = 300;  // зона названия панели слева, за которую панель перетаскивают
const EDGE = 5;      // ±пикселей у границы между панелями — тянуть высоту
const LOW_H = 40;    // ниже панель не сжимается

// индекс последнего отсчёта с a[i] <= v
function search(a, v) {
  let lo = 0, hi = a.length - 1;
  if (v <= a[0]) return 0;
  if (v >= a[hi]) return hi;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (a[m] <= v) lo = m; else hi = m; }
  return lo;
}

// значение ряда arr круга lap на дистанции d
function atDist(lap, arr, d, step) {
  const i = search(lap.dist, d), j = Math.min(lap.n - 1, i + 1);
  if (step) return arr[i];
  const d0 = lap.dist[i], d1 = lap.dist[j];
  const f = d1 > d0 ? Math.min(1, Math.max(0, (d - d0) / (d1 - d0))) : 0;
  return arr[i] + (arr[j] - arr[i]) * f;
}

export class Charts {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} o
   * @param {(d: number) => void} o.onSeek   перемотать круг А на дистанцию d
   */
  constructor(canvas, { onSeek, onPanelDrag, onWeights }) {
    this.canvas = canvas;
    this.onSeek = onSeek;
    this.onPanelDrag = onPanelDrag;
    this.onWeights = onWeights;
    this.weights = {};           // доли высоты панелей, заданные мышью (иначе — вес канала)
    this.base = document.createElement('canvas');
    this.a = null; this.b = null; this.delta = null;
    this.L = 0; this.sectors = [];
    this.view = null;            // [d0, d1] — видимая часть круга
    this.channels = [...DEFAULT_CHANNELS];
    this.follow = false;         // курсор за мышью
    this.pinned = false;         // клик при «курсоре за мышью» закрепляет машину в точке: мышь можно увести, следующий клик — открепить
    this.hover = null;           // дистанция под мышью
    this.cursor = 0;             // дистанция машины А
    this.dirty = true;
    this.bind();
  }

  setData(a, b, L, sectors) {
    const sameLap = a === this.a;
    this.a = a; this.b = b;
    this.L = L || (a ? a.dist[a.n - 1] : 0);
    this.sectors = sectors || [];
    // дельта в каждой точке круга А: на сколько позже (+) или раньше (−) эталона А проезжает эту дистанцию
    this.delta = null;
    if (a && b) {
      this.delta = new Float32Array(a.n);
      for (let i = 0; i < a.n; i++) this.delta[i] = a.t[i] - atDist(b, b.t, a.dist[i]);
    }
    if (!sameLap || !this.view) this.view = [0, this.L || 1];
    this.dirty = true;
  }

  setChannels(ids) { this.channels = ids; this.dirty = true; }
  resetView() { this.view = [0, this.L || 1]; this.dirty = true; }

  // зона между началами секторов k-1 и k
  zoomSector(k) {
    const b = [0, ...this.sectors.map((p) => p * this.L), this.L];
    if (k < 0 || k >= b.length - 1) return;
    const pad = (b[k + 1] - b[k]) * 0.04;
    this.view = [Math.max(0, b[k] - pad), Math.min(this.L, b[k + 1] + pad)];
    this.dirty = true;
  }

  // ---------- раскладка ----------

  list() { return this.channels.map((id) => CHANNELS.find((c) => c.id === id)).filter(Boolean); }
  weightOf(c) { return this.weights[c.id] ?? c.weight; }
  setWeights(w) { this.weights = { ...(w || {}) }; this.dirty = true; }

  // высота холста: вся высота блока или больше, если панелям не хватает минимальной высоты (тогда блок прокручивается)
  wantHeight(avail) {
    const min = this.list().reduce((s, c) => s + Math.max(LOW_H, Math.round(MIN_H * this.weightOf(c))), 0);
    return Math.max(avail, SECT_H + AXIS_H + min);
  }

  // панели по порядку каналов; лишняя высота делится по весам
  panels() {
    const list = this.list();
    const w = this.cw, h = this.ch;
    const top = SECT_H, bottom = h - AXIS_H;
    const total = list.reduce((s, c) => s + this.weightOf(c), 0) || 1;
    let y = top;
    return list.map((c) => {
      const ph = ((bottom - top) * this.weightOf(c)) / total;
      const p = { c, y, h: ph, x0: PAD_L, x1: w - PAD_R };
      y += ph;
      return p;
    });
  }

  // куда встанет панель, если отпустить на высоте clientY: номер места и линия-подсказка (в координатах экрана)
  insertAt(clientY) {
    const r = this.canvas.getBoundingClientRect();
    const ps = this.panels();
    let i = 0;
    while (i < ps.length && clientY > r.top + ps[i].y + ps[i].h / 2) i++;
    const y = i < ps.length ? r.top + ps[i].y : r.top + (ps.length ? ps[ps.length - 1].y + ps[ps.length - 1].h : SECT_H);
    return { index: i, y, left: r.left, width: r.width };
  }

  xOf(d) { const [d0, d1] = this.view; return PAD_L + ((d - d0) / (d1 - d0)) * (this.cw - PAD_L - PAD_R); }
  dOf(x) { const [d0, d1] = this.view; return d0 + ((x - PAD_L) / (this.cw - PAD_L - PAD_R)) * (d1 - d0); }

  // пределы оси канала по обоим кругам в видимой части
  range(c) {
    if (c.id === 'delta') {
      if (!this.delta) return [-1, 1];
      let m = 0.05;
      for (let i = 0; i < this.a.n; i++) if (this.a.dist[i] >= this.view[0] && this.a.dist[i] <= this.view[1]) m = Math.max(m, Math.abs(this.delta[i]));
      return [-m * 1.15, m * 1.15];
    }
    if (c.max != null) return [c.min, c.max];
    let lo = Infinity, hi = -Infinity;
    for (const lap of [this.a, this.b]) {
      if (!lap) continue;
      const arr = lap[c.key];
      for (let i = 0; i < lap.n; i++) { const v = arr[i] * c.k; if (v < lo) lo = v; if (v > hi) hi = v; }
    }
    if (c.sym) { const m = Math.max(Math.abs(lo), Math.abs(hi), 1); return [-m * 1.08, m * 1.08]; }
    if (c.step) return [c.min ?? lo, Math.max(hi, 1)];
    return [c.min ?? lo, hi + (hi - (c.min ?? lo)) * 0.06];
  }

  // ---------- рисование ----------

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const box = this.canvas.parentElement;
    const want = this.wantHeight(box.clientHeight);
    if (Math.round(parseFloat(this.canvas.style.height) || 0) !== Math.round(want)) this.canvas.style.height = `${want}px`;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return false;
    if (this.cw !== w || this.ch !== h || this.dpr !== dpr) {
      this.cw = w; this.ch = h; this.dpr = dpr;
      for (const c of [this.canvas, this.base]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      this.dirty = true;
    }
    return true;
  }

  drawBase() {
    const g = this.base.getContext('2d');
    const dpr = this.dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.cw, this.ch);
    if (!this.a) return;
    const [d0, d1] = this.view;
    // сетка дистанции и подписи оси
    const span = d1 - d0;
    const stepM = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000].find((s) => span / s <= 10) || 10000;
    g.font = `11px ${MONO}`;
    g.fillStyle = COL.axis;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let d = Math.ceil(d0 / stepM) * stepM; d <= d1; d += stepM) {
      const x = this.xOf(d);
      g.strokeStyle = COL.grid; g.lineWidth = 1;
      g.beginPath(); g.moveTo(Math.round(x) + 0.5, SECT_H); g.lineTo(Math.round(x) + 0.5, this.ch - AXIS_H); g.stroke();
      g.fillText(`${d} м`, Math.max(x, PAD_L + 18), this.ch - AXIS_H / 2);
    }
    // границы секторов — пунктир через все графики
    g.setLineDash([3, 4]);
    g.strokeStyle = 'rgba(226,185,59,0.28)';
    for (const p of this.sectors) {
      const x = this.xOf(p * this.L);
      if (x < PAD_L || x > this.cw - PAD_R) continue;
      g.beginPath(); g.moveTo(Math.round(x) + 0.5, SECT_H); g.lineTo(Math.round(x) + 0.5, this.ch - AXIS_H); g.stroke();
    }
    g.setLineDash([]);

    for (const p of this.panels()) {
      const { c } = p;
      const [lo, hi] = this.range(c);
      p.lo = lo; p.hi = hi;
      const yOf = (v) => p.y + 18 + (1 - (v - lo) / (hi - lo || 1)) * (p.h - 26);
      g.strokeStyle = 'rgba(255,255,255,0.08)';
      g.beginPath(); g.moveTo(0, Math.round(p.y) + 0.5); g.lineTo(this.cw, Math.round(p.y) + 0.5); g.stroke();
      // подписи пределов справа
      g.fillStyle = COL.axis; g.textAlign = 'right';
      g.fillText(c.fmt(hi), this.cw - 4, yOf(hi));
      // в низком графике подписи пределов налезли бы друг на друга
      if (yOf(lo) - yOf(hi) > 22) g.fillText(c.fmt(lo), this.cw - 4, yOf(lo));
      g.save();
      g.beginPath(); g.rect(p.x0, p.y + 1, p.x1 - p.x0, p.h - 2); g.clip();
      if (c.id === 'delta' && !this.delta) {
        // эталона нет — панель на месте, но вместо линии подсказка
        g.font = `500 12px ${SANS}`; g.fillStyle = COL.axis; g.textAlign = 'center';
        g.fillText('Дельта появится, когда выбран эталон — кнопка «Б» у круга', (p.x0 + p.x1) / 2, p.y + p.h / 2 + 6);
        g.textAlign = 'right';
      } else if (c.id === 'delta') {
        const y0 = yOf(0);
        g.strokeStyle = 'rgba(255,255,255,0.18)';
        g.beginPath(); g.moveTo(p.x0, y0); g.lineTo(p.x1, y0); g.stroke();
        this.series(g, this.a, this.delta, 1, yOf, false, null, y0);
      } else {
        if (this.b) this.series(g, this.b, this.b[c.key], c.k, yOf, c.step, COL.b);
        this.series(g, this.a, this.a[c.key], c.k, yOf, c.step, COL.a);
      }
      g.restore();
    }
  }

  // линия ряда; для дельты (fill0 — уровень нуля) — заливка: красное — проигрыш, зелёное — выигрыш
  series(g, lap, arr, k, yOf, step, color, fill0) {
    const [d0, d1] = this.view;
    let i0 = Math.max(0, search(lap.dist, d0) - 1);
    const i1 = Math.min(lap.n - 1, search(lap.dist, d1) + 1);
    const pts = [];
    let lastX = -1;
    for (let i = i0; i <= i1; i++) {
      const x = this.xOf(lap.dist[i]);
      // на мелком масштабе отсчётов больше, чем пикселей: соседние в одном пикселе не дублируем (кроме ступенек)
      if (!step && Math.abs(x - lastX) < 0.35 && i !== i1) continue;
      lastX = x;
      pts.push([x, yOf(arr[i] * k)]);
    }
    if (pts.length < 2) return;
    if (fill0 != null) {
      for (const [clr, above] of [[COL.loss, true], [COL.gain, false]]) {
        g.save();
        g.beginPath();
        if (above) g.rect(0, 0, this.cw, fill0); else g.rect(0, fill0, this.cw, this.ch);
        g.clip();
        g.beginPath(); g.moveTo(pts[0][0], fill0);
        for (const [x, y] of pts) g.lineTo(x, y);
        g.lineTo(pts[pts.length - 1][0], fill0); g.closePath();
        g.fillStyle = clr; g.globalAlpha = 0.22; g.fill();
        g.globalAlpha = 1;
        g.strokeStyle = clr; g.lineWidth = 1.6;
        g.beginPath(); pts.forEach(([x, y], q) => (q ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
        g.restore();
      }
      return;
    }
    g.strokeStyle = color; g.lineWidth = 1.6; g.lineJoin = 'round';
    g.beginPath();
    pts.forEach(([x, y], q) => {
      if (!q) return g.moveTo(x, y);
      if (step) g.lineTo(x, pts[q - 1][1]);
      g.lineTo(x, y);
    });
    g.stroke();
  }

  // каждый кадр: готовые линии + полоса секторов + курсоры + значения в точке курсора
  render(cursorDist) {
    if (!this.resize()) return;
    this.cursor = cursorDist ?? this.cursor;
    if (this.dirty) { this.drawBase(); this.dirty = false; }
    const g = this.canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.drawImage(this.base, 0, 0);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (!this.a) return;
    if (!this.panels().length) {
      g.font = `500 13px ${SANS}`; g.fillStyle = COL.axis; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('Перетащите сюда каналы из галереи слева', this.cw / 2, this.ch / 2);
      return;
    }
    this.drawSectors(g);
    // закреплено — значения в точке машины, а не под мышью
    const at = this.pinned ? this.cursor : this.hover ?? this.cursor;
    const xc = this.xOf(this.cursor);
    if (xc >= PAD_L && xc <= this.cw - PAD_R) {
      g.strokeStyle = COL.cursor; g.lineWidth = this.pinned ? 2 : 1.5;
      g.beginPath(); g.moveTo(xc, SECT_H); g.lineTo(xc, this.ch - AXIS_H); g.stroke();
      if (this.pinned) {
        // флажок «закреплено» над линией
        const label = 'Закреплено · клик — отпустить';
        g.font = `600 11px ${SANS}`;
        const w = g.measureText(label).width + 16;
        const x = Math.min(this.cw - PAD_R - w, Math.max(PAD_L, xc - w / 2));
        g.fillStyle = COL.cursor; roundRect(g, x, SECT_H + 4, w, 20, 6); g.fill();
        g.fillStyle = '#15171A'; g.textAlign = 'left'; g.textBaseline = 'middle';
        g.fillText(label, x + 8, SECT_H + 14);
      }
    }
    if (this.hover != null && (!this.follow || this.pinned)) {
      const xh = this.xOf(this.hover);
      g.strokeStyle = 'rgba(233,234,236,0.45)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(xh, SECT_H); g.lineTo(xh, this.ch - AXIS_H); g.stroke();
    }
    // название канала и значения А / Б в точке курсора (или под мышью)
    for (const p of this.panels()) {
      const { c } = p;
      let x = PAD_L + 2;
      const y = p.y + 11;
      g.textBaseline = 'middle'; g.textAlign = 'left';
      g.font = `600 12px ${SANS}`; g.fillStyle = COL.text;
      g.fillText(c.title, x, y); x += g.measureText(c.title).width + 6;
      if (c.unit) { g.font = `500 11px ${SANS}`; g.fillStyle = COL.axis; g.fillText(c.unit, x, y); x += g.measureText(c.unit).width + 10; }
      g.font = `600 12px ${MONO}`;
      if (c.id === 'delta') {
        if (!this.delta) continue;
        const v = atDist(this.a, this.delta, at);
        g.fillStyle = v > 0.0005 ? COL.loss : v < -0.0005 ? COL.gain : COL.text;
        g.fillText(c.fmt(v), x, y);
        continue;
      }
      for (const [key, lap] of [['a', this.a], ['b', this.b]]) {
        if (!lap) continue;
        const v = atDist(lap, lap[c.key], at, c.step) * c.k;
        const s = c.fmt(c.step ? Math.round(v) : v);
        g.fillStyle = COL[key]; g.fillText(s, x, y); x += g.measureText(s).width + 12;
      }
    }
  }

  // полоса секторов сверху: кнопки S1…Sn, клик — показать сектор целиком
  drawSectors(g) {
    const b = [0, ...this.sectors.map((p) => p * this.L), this.L];
    this.sectorBoxes = [];
    const cur = b.findIndex((x, k) => k < b.length - 1 && this.cursor >= x && this.cursor < b[k + 1]);
    for (let k = 0; k < b.length - 1; k++) {
      const x0 = Math.max(PAD_L, this.xOf(b[k]) + 2), x1 = Math.min(this.cw - PAD_R, this.xOf(b[k + 1]) - 2);
      if (x1 - x0 < 6) continue;
      const on = k === cur;
      g.fillStyle = on ? 'rgba(226,185,59,0.16)' : '#1C1F23';
      roundRect(g, x0, 4, x1 - x0, SECT_H - 8, 5); g.fill();
      if (on) { g.strokeStyle = 'rgba(226,185,59,0.6)'; g.lineWidth = 1; roundRect(g, x0 + 0.5, 4.5, x1 - x0 - 1, SECT_H - 9, 5); g.stroke(); }
      g.font = `600 11px ${SANS}`; g.fillStyle = on ? COL.cursor : COL.axis; g.textAlign = 'left'; g.textBaseline = 'middle';
      if (x1 - x0 > 26) g.fillText(`S${k + 1}`, x0 + 8, SECT_H / 2);
      this.sectorBoxes.push({ k, x0, x1 });
    }
  }

  // ---------- мышь ----------

  bind() {
    const c = this.canvas;
    let drag = null;
    const pos = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const clampD = (d) => Math.max(0, Math.min(this.L, d));
    // граница между панелями k-1 и k (верхний край панели k) — тянуть высоту; у первой панели верхнего края нет
    const edgeAt = (p) => { const ps = this.panels(); const k = ps.findIndex((q, i) => i > 0 && Math.abs(p.y - q.y) <= EDGE); return k > 0 ? k : -1; };
    const grabbed = (p) => (edgeAt(p) > 0 ? null : this.panels().find((q) => p.y >= q.y && p.y <= q.y + 24 && p.x < GRAB_W));
    let resize = null;
    c.addEventListener('pointerdown', (e) => {
      if (!this.a || e.button !== 0) return;
      const p = pos(e);
      const k = edgeAt(p);
      if (k > 0) {
        const ps = this.panels();
        const a = ps[k - 1], b = ps[k];
        resize = { a, b, y: p.y, sumH: a.h + b.h, sumW: this.weightOf(a.c) + this.weightOf(b.c), h0: a.h };
        try { c.setPointerCapture(e.pointerId); } catch { /* без захвата тоже работает */ }
        return;
      }
      const q = grabbed(p);
      if (q && this.onPanelDrag) { this.hover = null; this.onPanelDrag(q.c.id, e); return; }
      drag = { x: p.x, view: [...this.view], moved: false, y: p.y };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.a) return;
      const p = pos(e);
      if (resize) {
        // пара соседних панелей делит свою общую высоту: остальные не двигаются
        const ha = Math.max(LOW_H, Math.min(resize.sumH - LOW_H, resize.h0 + (p.y - resize.y)));
        const wa = (ha / resize.sumH) * resize.sumW;
        this.weights[resize.a.c.id] = Math.round(wa * 1000) / 1000;
        this.weights[resize.b.c.id] = Math.round((resize.sumW - wa) * 1000) / 1000;
        this.dirty = true;
        return;
      }
      if (drag) {
        const dx = p.x - drag.x;
        if (Math.abs(dx) > 3) drag.moved = true;
        if (drag.moved) {
          // перетаскивание — сдвиг видимой части круга
          const span = drag.view[1] - drag.view[0];
          const dd = (dx / (this.cw - PAD_L - PAD_R)) * span;
          let v0 = drag.view[0] - dd;
          v0 = Math.max(0, Math.min(this.L - span, v0));
          this.view = [v0, v0 + span];
          this.dirty = true;
          c.style.cursor = 'grabbing';
          return;
        }
      }
      const onEdge = edgeAt(p) > 0;
      const onTitle = !onEdge && !!grabbed(p);
      this.hover = p.y > SECT_H && !onTitle && !onEdge ? clampD(this.dOf(p.x)) : null;
      c.style.cursor = p.y <= SECT_H ? 'pointer' : onEdge ? 'row-resize' : onTitle ? 'grab' : 'crosshair';
      if (this.follow && !this.pinned && this.hover != null) this.onSeek(this.hover, { hover: true });
    });
    c.addEventListener('pointerup', (e) => {
      if (resize) { resize = null; this.onWeights?.({ ...this.weights }); return; }
      if (!drag) return;
      const p = pos(e);
      if (!drag.moved) {
        if (p.y <= SECT_H) {
          const box = this.sectorBoxes?.find((s) => p.x >= s.x0 && p.x <= s.x1);
          if (box) this.zoomSector(box.k);
        } else if (this.follow && this.pinned) {
          // открепили: машина снова едет за мышью — сразу к точке под курсором
          this.pinned = false;
          this.onSeek(clampD(this.dOf(p.x)), { hover: true });
        } else {
          this.onSeek(clampD(this.dOf(p.x)), { hover: this.follow });
          if (this.follow) this.pinned = true;
        }
      }
      drag = null;
      c.style.cursor = '';
    });
    c.addEventListener('pointerleave', () => { this.hover = null; });
    c.addEventListener('dblclick', () => this.resetView());
    c.addEventListener('wheel', (e) => {
      if (!this.a) return;
      e.preventDefault();
      const d = this.dOf(pos(e).x);
      const [d0, d1] = this.view;
      const f = Math.exp(e.deltaY * 0.0015);
      const span = Math.max(40, Math.min(this.L, (d1 - d0) * f));
      const k = (d - d0) / (d1 - d0);
      let v0 = d - span * k;
      v0 = Math.max(0, Math.min(this.L - span, v0));
      this.view = [v0, v0 + span];
      this.dirty = true;
    }, { passive: false });
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
