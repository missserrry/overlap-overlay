// Блоки рабочей области окна «Телеметрия» и галерея, из которой их перетаскивают.
// У каждого блока шапка: ручка (перетащить в другое место), название, свои кнопки и ✕ (убрать).
import { TrackScene } from './scene.js';
import { Charts, CHANNELS, DEFAULT_CHANNELS } from './charts.js';
import { timeAtDist, fmtLap } from './laps.js';

const icon = (name, cls = '') => `<i class="ico ${cls}" style="--i:url(/vendor/icons/${name}.svg)"></i>`;
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const CAMS = [['top', 'Сверху', 'Вид сверху: едет за машиной (потяните мышью — свободный вид), зажмите колесо и ведите вверх-вниз — наклон'], ['chase', '3D', 'От третьего лица']];
export const WHEEL = '<svg class="wheel" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9.5"/><path d="M2.8 11.2h6.4M14.8 11.2h6.4M12 14.2v7.2"/><circle cx="12" cy="12" r="2.6"/></svg>';

// Галерея: блоки и отдельные каналы графиков. spec — с чем блок появляется (дальше его настраивают в шапке);
// у каналов — channel: их бросают в блок «Графики» (между панелями) или в пустое место — тогда появится новый блок графиков
export const GALLERY = [
  { id: 'view-top', kind: 'view', title: 'Трасса сверху', desc: 'Сверху за машиной по ходу движения; потяните — свободный вид, зажатое колесо — наклон', icon: 'map', spec: { cam: 'top', follow: true, tilt: 0, hud: false } },
  { id: 'view-3d', kind: 'view', title: 'Трасса 3D', desc: 'От третьего лица, как в Race Overlay', icon: 'car', spec: { cam: 'chase', hud: true } },
  { id: 'charts', kind: 'charts', title: 'Графики', desc: 'Дельта, скорость, газ, тормоз, передача, руль друг под другом', icon: 'chart-line', spec: { channels: DEFAULT_CHANNELS } },
  { id: 'inputs', kind: 'inputs', title: 'Приборы', desc: 'Руль, газ, тормоз, передача и скорость А и Б и дельта прямо сейчас', icon: 'layers-2', spec: {} },
  { id: 'map', kind: 'map', title: 'Карта', desc: 'Схема трассы с машинами и секторами', icon: 'route', spec: {} },
  { id: 'sectors', kind: 'sectors', title: 'Сектора', desc: 'Время секторов А и Б и разница', icon: 'table', spec: {} },
];
export const GALLERY_CHANNELS = [
  { channel: 'delta', desc: 'Где вы выигрываете и проигрываете эталону Б', icon: 'activity' },
  { channel: 'speed', desc: 'Скорость А и Б по дистанции', icon: 'timer' },
  { channel: 'thr', desc: 'Газ, %', icon: 'chevrons-up' },
  { channel: 'brk', desc: 'Тормоз, %', icon: 'chevrons-down' },
  { channel: 'gear', desc: 'Передача', icon: 'cog' },
  { channel: 'steer', desc: 'Угол руля, градусы', icon: 'rotate-ccw' },
  { channel: 'rpm', desc: 'Обороты двигателя', icon: 'gauge' },
  { channel: 'clu', desc: 'Сцепление, %', icon: 'disc' },
].map((g) => ({ ...g, title: CHANNELS.find((c) => c.id === g.channel).title }));
export const chartsSpec = (channels) => ({ kind: 'charts', title: 'Графики', channels, follow: true });
export const galleryItem = (id) => GALLERY.find((g) => g.id === id);
export const newSpec = (id) => {
  const g = galleryItem(id);
  // у трассы камера переключается в шапке, поэтому и название одно — «Трасса»
  return JSON.parse(JSON.stringify({ kind: g.kind, title: g.kind === 'view' ? 'Трасса' : g.title, ...g.spec }));
};

class Block {
  constructor(spec, ctx, tools = '') {
    this.spec = spec;
    this.kind = spec.kind;
    this.ctx = ctx;
    this.el = document.createElement('div');
    this.el.className = 'blk';
    this.el.dataset.kind = spec.kind;
    this.el.innerHTML = `<div class="blk-h">
        <button class="grip" title="Перетащите: к краю другого блока — встанет рядом, в середину — поменяются местами">${icon('grip-vertical', 'sm')}</button>
        <span class="blk-title">${esc(spec.title)}</span>
        ${tools}
        <button class="ibtn close" data-close title="Убрать блок (вернуть можно из галереи)">${icon('x', 'sm')}</button>
      </div>
      <div class="blk-body"></div>`;
    this.body = this.el.querySelector('.blk-body');
    this.el.querySelector('.grip').addEventListener('pointerdown', (e) => ctx.drag(this, e));
    this.el.querySelector('[data-close]').addEventListener('click', () => ctx.remove(this));
    this.el.addEventListener('pointerdown', () => ctx.activate(this), true);
  }

  setData() {}
  render() {}
  dispose() {}
}

// ---------- трасса ----------

export class ViewBlock extends Block {
  constructor(spec, ctx) {
    super(spec, ctx, `
      <div class="seg cams">${CAMS.map(([k, t, tip]) => `<button data-c="${k}" title="${tip}">${t}</button>`).join('')}</div>
      <span class="sp"></span>
      <button class="ibtn" data-a="follow" title="Следить за машиной (C)">${icon('locate-fixed', 'sm')}</button>
      <button class="ibtn" data-a="hud" title="Плашки педалей и дельта поверх трассы">${icon('gauge', 'sm')}</button>
      <button class="ibtn" data-a="zoomOut" title="Отдалить">${icon('minus', 'sm')}</button>
      <button class="ibtn" data-a="zoomIn" title="Приблизить">${icon('plus', 'sm')}</button>
      <button class="ibtn" data-a="fit" title="Вся трасса (F)">${icon('maximize-2', 'sm')}</button>`);
    this.body.innerHTML = `<canvas class="scene"></canvas><canvas class="minimap" width="360" height="260"></canvas>
      <div class="hud"><div class="inputs"></div><div class="delta"></div></div>`;
    this.scene = new TrackScene(this.body.querySelector('.scene'));
    // прежний режим «за машиной» — теперь вид сверху со слежением
    if (spec.cam === 'follow') { spec.cam = 'top'; spec.follow = true; }
    this.scene.follow = spec.follow !== false;
    this.scene.setTilt(spec.tilt || 0);
    this.scene.onFollowChange = (on) => { this.spec.follow = on; this.paint(); this.ctx.save(); };
    this.scene.onTilt = (t) => { this.spec.tilt = Math.round(t * 1000) / 1000; this.ctx.save(); };
    this.mini = this.body.querySelector('.minimap');
    this.hudEl = this.body.querySelector('.hud');
    this.inputsEl = this.body.querySelector('.inputs');
    this.deltaEl = this.body.querySelector('.delta');
    this.last = { inputs: '', delta: '' };
    this.el.querySelector('.blk-h').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.c) this.setCam(b.dataset.c);
      const a = b.dataset.a;
      if (a === 'hud') { this.spec.hud = !this.spec.hud; this.paint(); this.ctx.save(); }
      if (a === 'follow') this.setFollow(!this.scene.follow);
      if (a === 'zoomIn') this.scene.zoomBy(0.7);
      if (a === 'zoomOut') this.scene.zoomBy(1 / 0.7);
      if (a === 'fit') this.fit();
    });
    this.paint();
  }

  setCam(mode, apply = true) {
    if (mode === 'follow') { mode = 'top'; this.setFollow(true); }
    this.spec.cam = mode;
    if (apply) this.scene.setMode(mode);
    this.paint();
    this.ctx.save();
  }

  setFollow(on) {
    this.scene.setFollow(on);
    this.spec.follow = !!on;
    if (this.spec.cam !== 'top') { this.spec.cam = 'top'; this.scene.setMode('top'); }
    this.paint();
    this.ctx.save();
  }

  // вся трасса: свободный вид сверху, север вверху
  fit() {
    this.scene.setFollow(false);
    this.spec.follow = false;
    this.scene.setMode('top');
    this.scene.fit();
    this.setCam('top', false);
  }

  paint() {
    this.el.querySelectorAll('[data-c]').forEach((b) => b.classList.toggle('on', b.dataset.c === this.spec.cam));
    this.el.querySelector('[data-a=hud]').classList.toggle('on', !!this.spec.hud);
    const fol = this.el.querySelector('[data-a=follow]');
    fol.classList.toggle('on', this.spec.cam === 'top' && this.scene?.follow !== false && this.spec.follow !== false);
    fol.hidden = this.spec.cam !== 'top';
    this.hudEl.hidden = !this.spec.hud;
  }

  render(f) {
    this.scene.setCar('a', f.sa);
    this.scene.setCar('b', f.sb);
    this.scene.render(f.sa, f.dt);
    const hud = !!(this.spec.hud && f.has);
    this.hudEl.hidden = !hud;
    if (hud) {
      if (f.inputs !== this.last.inputs) { this.inputsEl.innerHTML = f.inputs; this.last.inputs = f.inputs; }
      if (f.delta !== this.last.delta) { this.deltaEl.innerHTML = f.delta; this.deltaEl.hidden = !f.delta; this.last.delta = f.delta; }
    }
    // миникарта — когда трасса не видна целиком (сверху её и так видно)
    const showMini = f.has && !!f.mini && this.spec.cam !== 'top';
    this.mini.hidden = !showMini;
    if (showMini) drawMinimap(this.mini, f.mini, f.sa, f.sb);
  }

  dispose() {
    try { this.scene.renderer.dispose(); this.scene.renderer.forceContextLoss(); } catch { /* уже освобождён */ }
  }
}

function drawMinimap(c, mini, sa, sb) {
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.lineJoin = 'round';
  g.strokeStyle = '#3a3f46'; g.lineWidth = 9; g.stroke(mini.path);
  g.strokeStyle = '#23272d'; g.lineWidth = 5; g.stroke(mini.path);
  const dot = (s, color) => {
    if (!s) return;
    const [x, y] = mini.map(s.x, s.z);
    g.fillStyle = color; g.strokeStyle = '#0b0c0e'; g.lineWidth = 3;
    g.beginPath(); g.arc(x, y, 8, 0, Math.PI * 2); g.fill(); g.stroke();
  };
  dot(sb, '#F29A38');
  dot(sa, '#4A9BF5');
}

// ---------- графики ----------

export class ChartsBlock extends Block {
  constructor(spec, ctx) {
    super(spec, ctx, `
      <span class="sp"></span>
      <label class="ch-check" title="Ведите мышью по графику — машины на трассе и камеры едут за курсором (проигрывание встаёт на паузу). Клик — закрепить машину в точке и увести мышь, ещё клик — отпустить"><input type="checkbox" data-a="follow"><i></i>Курсор за мышью</label>
      <button class="ch-btn accent" data-a="all" title="Показать весь круг (двойной клик по графику)">Весь круг</button>
      <button class="ch-btn" data-a="channels" aria-haspopup="dialog">Каналы</button>`);
    this.body.innerHTML = '<canvas class="chart"></canvas><div class="ch-pop" hidden></div>';
    this.pop = this.body.querySelector('.ch-pop');
    this.charts = new Charts(this.body.querySelector('.chart'), {
      onSeek: (d, o) => ctx.seekDist(d, o),
      onPanelDrag: (id, e) => ctx.dragChannel(e, { id, from: this }),
      onWeights: (w) => { this.spec.heights = w; ctx.save(); },
    });
    this.charts.setChannels(spec.channels || DEFAULT_CHANNELS);
    this.charts.setWeights(spec.heights);
    // ведение мышью по графику включено, пока его не выключили
    this.charts.follow = spec.follow !== false;
    const follow = this.el.querySelector('[data-a=follow]');
    follow.checked = this.charts.follow;
    follow.addEventListener('change', () => { this.charts.follow = this.spec.follow = follow.checked; this.charts.pinned = false; ctx.save(); });
    this.el.querySelector('.blk-h').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b?.dataset.a === 'all') this.charts.resetView();
      if (b?.dataset.a === 'channels') { this.renderPop(); this.pop.hidden = !this.pop.hidden; }
    });
    this.pop.addEventListener('change', () => {
      const on = new Set([...this.pop.querySelectorAll('input:checked')].map((x) => x.dataset.ch));
      this.spec.channels = CHANNELS.map((c) => c.id).filter((id) => on.has(id));
      this.charts.setChannels(this.spec.channels);
      ctx.save();
    });
    this.onDoc = (e) => {
      if (!this.pop.hidden && !e.target.closest('.ch-pop') && e.target.closest('button')?.dataset.a !== 'channels') this.pop.hidden = true;
    };
    document.addEventListener('pointerdown', this.onDoc);
  }

  // поставить канал на место index (если он уже есть в блоке — переставить)
  insertChannel(id, index) {
    const list = [...this.spec.channels];
    const old = list.indexOf(id);
    if (old >= 0) { list.splice(old, 1); if (old < index) index--; }
    list.splice(Math.max(0, Math.min(list.length, index)), 0, id);
    this.spec.channels = list;
    this.charts.setChannels(list);
    this.ctx.save();
  }

  removeChannel(id) {
    this.spec.channels = this.spec.channels.filter((c) => c !== id);
    this.charts.setChannels(this.spec.channels);
    this.ctx.save();
  }

  renderPop() {
    this.pop.innerHTML = CHANNELS.map((c) => `<label><input type="checkbox" data-ch="${c.id}" ${this.charts.channels.includes(c.id) ? 'checked' : ''}>${c.title}${c.needB ? '<small>нужен Б</small>' : ''}</label>`).join('');
  }

  setData(d) {
    if (this.charts.a !== d.a || this.charts.b !== d.b) this.charts.setData(d.a, d.b, d.L, d.sectors);
  }

  render(f) {
    if (!f.has) return;
    // дельта без эталона — подсказка вместо пустого графика
    this.charts.render(f.sa.dist);
  }

  dispose() { document.removeEventListener('pointerdown', this.onDoc); }
}

// ---------- приборы ----------

export class InputsBlock extends Block {
  constructor(spec, ctx) {
    super(spec, ctx, '<span class="sp"></span>');
    this.body.innerHTML = '<div class="gauges"></div>';
    this.box = this.body.firstElementChild;
    this.last = '';
  }

  render(f) {
    if (!f.has) { if (this.last) { this.box.innerHTML = ''; this.last = ''; } return; }
    const row = (key, s) => {
      if (!s) return '';
      const pct = (v) => Math.round(Math.max(0, Math.min(1, v)) * 100);
      const gear = s.gear < 0 ? 'R' : s.gear === 0 ? 'N' : String(s.gear);
      return `<div class="g-row" style="--c:var(--car-${key})">
        <span class="tag ${key}">${key === 'a' ? 'А' : 'Б'}</span>
        <span class="g-wheel" style="transform:rotate(${(-s.steer).toFixed(1)}deg)">${WHEEL}</span>
        <div class="g-bars">
          <div class="g-bar thr"><i style="width:${pct(s.thr)}%"></i><b>${pct(s.thr)}%</b></div>
          <div class="g-bar brk"><i style="width:${pct(s.brk)}%"></i><b>${pct(s.brk)}%</b></div>
        </div>
        <span class="g-gear">${gear}</span>
        <span class="g-spd">${(s.speed * 3.6).toFixed(0)}<small>км/ч</small></span>
      </div>`;
    };
    const html = `${row('a', f.sa)}${row('b', f.sb)}${f.delta ? `<div class="g-delta">${f.delta}</div>` : ''}`;
    if (html !== this.last) { this.box.innerHTML = html; this.last = html; }
  }
}

// ---------- карта ----------

export class MapBlock extends Block {
  constructor(spec, ctx) {
    super(spec, ctx, '<span class="sp"></span>');
    this.body.innerHTML = '<canvas class="map"></canvas>';
    this.canvas = this.body.firstElementChild;
    this.key = '';
  }

  render(f) {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); this.key = ''; }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const tr = f.track;
    if (!tr) return;
    const key = `${w}x${h}|${tr.n}|${tr.pts[0]}`;
    if (key !== this.key) {
      // схема вписывается в блок; поворот не нужен — север вверху, как на виде сверху
      const pts = tr.pts, n = tr.n;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let k = 0; k < n; k++) { x0 = Math.min(x0, pts[k * 3]); x1 = Math.max(x1, pts[k * 3]); z0 = Math.min(z0, pts[k * 3 + 2]); z1 = Math.max(z1, pts[k * 3 + 2]); }
      const pad = 18;
      const s = Math.min((w - pad * 2) / (x1 - x0 || 1), (h - pad * 2) / (z1 - z0 || 1));
      const ox = (w - (x1 - x0) * s) / 2, oz = (h - (z1 - z0) * s) / 2;
      this.map = (x, z) => [ox + (x - x0) * s, oz + (z - z0) * s];
      this.path = new Path2D();
      for (let k = 0; k < n; k++) { const [px, py] = this.map(pts[k * 3], pts[k * 3 + 2]); k ? this.path.lineTo(px, py) : this.path.moveTo(px, py); }
      if (tr.closed) this.path.closePath();
      this.marks = [0, ...(tr.sectors || [])].map((k) => this.map(pts[k * 3], pts[k * 3 + 2]));
      this.key = key;
    }
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = '#3a3f46'; g.lineWidth = 12; g.stroke(this.path);
    g.strokeStyle = '#24272e'; g.lineWidth = 8; g.stroke(this.path);
    this.marks.forEach(([x, y], k) => {
      g.fillStyle = k ? '#E2B93B' : '#E9EAEC';
      g.beginPath(); g.arc(x, y, k ? 3.5 : 4.5, 0, Math.PI * 2); g.fill();
    });
    const dot = (st, color) => {
      if (!st) return;
      const [x, y] = this.map(st.x, st.z);
      g.fillStyle = color; g.strokeStyle = '#0b0c0e'; g.lineWidth = 3;
      g.beginPath(); g.arc(x, y, 8, 0, Math.PI * 2); g.fill(); g.stroke();
    };
    dot(f.sb, '#F29A38');
    dot(f.sa, '#4A9BF5');
  }
}

// ---------- сектора ----------

export class SectorsBlock extends Block {
  constructor(spec, ctx) {
    super(spec, ctx, '<span class="sp"></span>');
    this.body.innerHTML = '<div class="sec"></div>';
    this.box = this.body.firstElementChild;
    this.rows = null;
    this.cur = -1;
  }

  // время секторов: от границы до границы по дистанции; последний сектор — до конца круга
  setData(d) {
    if (this.a === d.a && this.b === d.b) return;
    this.a = d.a; this.b = d.b;
    if (!d.a || !d.L) { this.rows = null; this.box.innerHTML = ''; return; }
    const bounds = [0, ...(d.sectors || []).map((p) => p * d.L), d.L];
    const times = (lap) => bounds.slice(0, -1).map((x, k) => {
      const t1 = k === bounds.length - 2 ? (lap.time ?? lap.end) : timeAtDist(lap, bounds[k + 1]);
      return t1 - timeAtDist(lap, x);
    });
    const ta = times(d.a), tb = d.b ? times(d.b) : null;
    this.bounds = bounds;
    this.rows = ta.map((t, k) => ({ a: t, b: tb ? tb[k] : null }));
    this.total = { a: d.a.time ?? d.a.end, b: d.b ? (d.b.time ?? d.b.end) : null };
    this.cur = -1;
    this.paint(-1);
  }

  paint(cur) {
    const diff = (a, b) => {
      if (b == null) return '<td class="d">—</td>';
      const v = a - b;
      return `<td class="d ${v > 0.0005 ? 'loss' : v < -0.0005 ? 'gain' : ''}">${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(3)}</td>`;
    };
    const sec = (v) => (v == null ? '—' : v < 60 ? v.toFixed(3) : fmtLap(v));
    this.box.innerHTML = `<table>
      <thead><tr><th></th><th><span class="tag a">А</span></th><th><span class="tag b">Б</span></th><th>Разница</th></tr></thead>
      <tbody>${this.rows.map((r, k) => `<tr class="${k === cur ? 'cur' : ''}"><td class="n">S${k + 1}</td><td>${sec(r.a)}</td><td>${sec(r.b)}</td>${diff(r.a, r.b)}</tr>`).join('')}</tbody>
      <tfoot><tr><td class="n">Круг</td><td>${fmtLap(this.total.a)}</td><td>${this.total.b == null ? '—' : fmtLap(this.total.b)}</td>${diff(this.total.a, this.total.b)}</tr></tfoot>
    </table>${this.b ? '' : '<p class="sec-hint">Выберите эталон — кнопка «Б» у круга, — чтобы увидеть разницу.</p>'}`;
  }

  render(f) {
    if (!this.rows || !f.has) return;
    let k = 0;
    while (k < this.bounds.length - 2 && f.sa.dist >= this.bounds[k + 1]) k++;
    if (k !== this.cur) { this.cur = k; this.paint(k); }
  }
}

export const BLOCKS = { view: ViewBlock, charts: ChartsBlock, inputs: InputsBlock, map: MapBlock, sectors: SectorsBlock };
