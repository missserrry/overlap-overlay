// Окно «Телеметрия»: слева библиотека кругов (iRacing .ibt, LMU .duckdb, эталоны) и галерея блоков,
// справа рабочая область: блоки («Трасса», «Графики», «Дельта», «Приборы», «Карта», «Сектора»…) стыкуются, как окна в Windows.
// Проигрывание общее, полосой внизу.
// Круг А — ваш (проигрывается), круг Б — эталон: едет рядом «призраком» по времени, дельта считается в той же точке трассы.
import { projector, prepareLap, snapToTrack, stateAt, timeAtDist, fmtLap } from './laps.js';
import { DEFAULT_CHANNELS } from './charts.js';
import { PRESETS, cellCount, presetIcon, presetTree, leavesOf, Dock, MAX_BLOCKS } from './layout.js';
import { BLOCKS, GALLERY, GALLERY_CHANNELS, newSpec, chartsSpec, WHEEL } from './blocks.js';
import { CHANNELS } from './charts.js';

const tlm = window.tlm;
const $ = (id) => document.getElementById(id);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const icon = (name, cls = '') => `<i class="ico ${cls}" style="--i:url(/vendor/icons/${name}.svg)"></i>`;
const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4];
const DEFAULT_WIDTH = 12; // м: ширина трассы iRacing по умолчанию (в файле .ibt краёв нет)

function load(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }
function save(k, v) { try { localStorage.setItem(k, v); } catch { /* не критично */ } }

let lib = { files: [], scanning: false, dirs: {} };
let settings = { lineMode: 'inputs', lineModeB: 'solid', widths: {} };
let game = 'iracing';                // игра из панели: показываем телеметрию только её
let query = '';
let session = null;                   // открытая сессия (файл) — шаг 2: её круги и сравнение
let showEmpty = false;                // показывать сессии без полных кругов
let pendingRefs = [];
const names = { a: '', b: '' };      // подписи карточек пилотов: имя пилота или эталона
const lapNo = { a: '', b: '' };                 // эталоны, которые только что перетащили: ждём, пока их прочитают, и ставим в Б

// выбранные круги и всё, что для них построено
const sel = { a: null, b: null };   // { file, index, info (описание файла) }
const laps = { a: null, b: null };  // готовые к проигрыванию круги
let track = null;                   // { file, trackId, model, proj }
let loading = 0;

// t — куда перемотали, vt — что показываем: при перемотке мышью картинка плавно догоняет t, а не прыгает по кадрам
const play = { t: 0, vt: 0, on: false, speed: Number(load('tlmSpeed', '1')) || 1, last: 0 };
let trackData = null;               // трасса в координатах сцены (для блоков «Трасса»)

// ---------- рабочая область ----------

const blocks = new Map();           // описание блока → блок
let shown = [];                     // блоки по порядку
let activeView = null;              // блок «Трасса», к которому относятся клавиши 1/2/3/F
const views = () => shown.filter((b) => b.kind === 'view');

// по умолчанию: трасса сверху, под ней графики (дельта, скорость, газ, тормоз, передача, руль)
const defaultTree = () => ({ dir: 'col', r: 0.42, a: { leaf: newSpec('view-top') }, b: { leaf: newSpec('charts') } });

const dock = new Dock($('ws'), {
  blockEl: (spec) => (blocks.get(spec) || createBlock(spec)).el,
  onChange: () => { syncBlocks(); saveWorkspace(); },
  removeZone: document.querySelector('.lib'),
  note: (t) => toast(t),
});

const blockCtx = {
  // ведут мышью по графику — проигрывание на паузу, иначе машина убегала бы от курсора
  seekDist: (d, o) => { if (!laps.a) return; if (o?.hover && play.on) setPlaying(false); seek(timeAtDist(laps.a, d)); },
  save: () => saveWorkspace(),
  drag: (b, e) => dock.drag(e, { spec: b.spec, title: b.spec.title }),
  remove: (b) => dock.remove(b.spec),
  dragChannel: (e, o) => dragChannel(e, o),
  activate: (b) => { if (b.kind === 'view') activeView = b; },
};

function createBlock(spec) {
  const Kind = BLOCKS[spec.kind] || BLOCKS.charts;
  const b = new Kind(spec, blockCtx);
  blocks.set(spec, b);
  if (b.kind === 'view') {
    if (trackData) {
      b.scene.setTrack(trackData);
      if (laps.a) b.scene.setLine('a', laps.a, settings.lineMode);
      if (laps.b) b.scene.setLine('b', laps.b, settings.lineModeB);
      b.scene.fit();
    }
    b.scene.setMode(spec.cam || 'top');
  }
  b.setData(blockData());
  return b;
}

const blockData = () => ({ a: laps.a, b: laps.b, L: track?.model?.trackLength, sectors: track?.model?.sectors });

// после правки раскладки: убранные блоки освобождаем (3D-сцены держат видеопамять)
function syncBlocks() {
  const specs = leavesOf(dock.tree);
  for (const [spec, b] of blocks) if (!specs.includes(spec)) { b.dispose(); blocks.delete(spec); }
  shown = specs.map((spec) => blocks.get(spec)).filter(Boolean);
  if (!shown.includes(activeView)) activeView = views()[0] || null;
  renderGallery();
}

let saveTimer = null;
function saveWorkspace() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => tlm.saveSettings({ workspace: { tree: dock.tree } }), 300);
}

// готовая раскладка из меню: блоки встают по ячейкам по порядку, недостающие — из галереи
function setPreset(id) {
  const p = PRESETS.find((x) => x.id === id);
  const n = cellCount(p.tree);
  const specs = leavesOf(dock.tree).slice(0, n);
  const fill = ['view-top', 'charts', 'view-3d', 'inputs'];
  for (const g of fill) if (specs.length < n && !specs.some((sp) => sp.title === newSpec(g).title)) specs.push(newSpec(g));
  while (specs.length < n) specs.push(newSpec('charts'));
  dock.setTree(presetTree(p.tree, specs));
  syncBlocks();
  saveWorkspace();
  $('layoutPop').hidden = true;
}

function renderLayoutPop() {
  $('layoutPop').innerHTML = `<div class="lbl">Готовые раскладки</div>
    <div class="grid">${PRESETS.map((p) => `<button data-preset="${p.id}" title="${p.title}">${presetIcon(p.tree)}</button>`).join('')}</div>
    <p class="note">Или соберите свою: тяните блок за ручку ⠿ — к краю другого блока он встанет рядом, к краю всей области — во всю высоту или ширину,
    в середину — поменяется местами. Новые блоки — во вкладке «Блоки» слева. Унесите блок на панель слева, чтобы убрать.</p>`;
}

// ---------- галерея блоков ----------

let sideTab = load('tlmSide', 'laps');
function setSideTab(tab) {
  sideTab = tab;
  save('tlmSide', tab);
  document.querySelectorAll('[data-side]').forEach((b) => b.classList.toggle('on', b.dataset.side === tab));
  $('libPane').hidden = tab !== 'laps';
  $('galleryPane').hidden = tab !== 'blocks';
}

function renderGallery() {
  const n = dock.count;
  $('gallery').innerHTML = `<div class="gal-sub">Блоки</div>${GALLERY.map((g) => `<div class="gal" data-gal="${g.id}" title="Перетащите в рабочую область или нажмите, чтобы добавить справа">
      <span class="gal-ico">${icon(g.icon)}</span><span class="gal-t"><b>${g.title}</b><small>${g.desc}</small></span></div>`).join('')}
    <div class="gal-sub">Каналы графиков</div>${GALLERY_CHANNELS.map((g) => `<div class="gal ch" data-chan="${g.channel}" title="Перетащите между графиками или нажмите, чтобы добавить вниз графиков">
      <span class="gal-ico">${icon(g.icon, 'sm')}</span><span class="gal-t"><b>${g.title}</b><small>${g.desc}</small></span></div>`).join('')}`;
  $('galleryNote').textContent = n >= MAX_BLOCKS ? `Уже ${n} блоков — больше не поместится. Уберите лишний (✕ или унесите сюда).` : `Блоков: ${n} из ${MAX_BLOCKS}. Унесите блок сюда, чтобы убрать его.`;
}

$('gallery').addEventListener('pointerdown', (e) => {
  const el = e.target.closest('[data-gal], [data-chan]');
  if (!el || e.button !== 0) return;
  const { gal, chan } = el.dataset;
  const x0 = e.clientX, y0 = e.clientY;
  // короткое нажатие — добавить (блок — справа, канал — вниз первых графиков); потянули — перетаскивание с подсказкой
  const move = (ev) => {
    if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
    cleanup();
    if (chan) dragChannel(ev, { id: chan });
    else dock.drag(ev, { make: () => newSpec(gal), title: el.querySelector('b').textContent });
  };
  const up = () => {
    cleanup();
    if (!chan) return dock.add(newSpec(gal));
    const target = shown.find((b) => b.kind === 'charts');
    if (target) target.insertChannel(chan, target.spec.channels.length);
    else dock.add(chartsSpec([chan]));
    return undefined;
  };
  const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
});

// Перетаскивание канала графиков (из галереи или за название панели):
//   в блок «Графики» — встанет между панелями (жёлтая линия), в том числе в другой блок;
//   на панель слева — уберётся; в другое место рабочей области — появится новый блок графиков с этим каналом.
function dragChannel(e, { id, from }) {
  e.preventDefault();
  const title = CHANNELS.find((c) => c.id === id)?.title || id;
  const ghost = Object.assign(document.createElement('div'), { className: 'ws-ghost', textContent: title });
  const line = Object.assign(document.createElement('div'), { className: 'ch-insert' });
  const preview = Object.assign(document.createElement('div'), { className: 'dock-preview' });
  document.body.append(ghost, line, preview);
  document.body.classList.add('ws-dragging');
  const zone = document.querySelector('.lib');
  let h = null;
  const move = (ev) => {
    const x = ev.clientX, y = ev.clientY;
    ghost.style.transform = `translate(${x + 14}px, ${y + 10}px)`;
    const blk = document.elementFromPoint(x, y)?.closest('.blk[data-kind=charts]');
    const target = blk && shown.find((b) => b.el === blk);
    h = null;
    if (target) {
      const at = target.charts.insertAt(y);
      const body = target.body.getBoundingClientRect();
      Object.assign(line.style, { left: `${at.left + 6}px`, top: `${Math.max(body.top, Math.min(body.bottom, at.y))}px`, width: `${at.width - 12}px`, display: 'block' });
      h = { insert: target, index: at.index };
    } else line.style.display = 'none';
    const z = zone.getBoundingClientRect();
    const overZone = from && x >= z.left && x <= z.right && y >= z.top && y <= z.bottom;
    zone.classList.toggle('drop-remove', !!overZone);
    if (overZone) h = { remove: true };
    const dh = !h ? dock.hit(x, y, null) : null;
    if (dh?.rect) {
      h = { dock: dh };
      Object.assign(preview.style, { left: `${dh.rect.left}px`, top: `${dh.rect.top}px`, width: `${dh.rect.width}px`, height: `${dh.rect.height}px`, opacity: 1 });
    } else preview.style.opacity = 0;
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    ghost.remove(); line.remove(); preview.remove();
    document.body.classList.remove('ws-dragging');
    zone.classList.remove('drop-remove');
    if (!h) return;
    if (h.insert) {
      if (from && from !== h.insert) from.removeChannel(id);
      h.insert.insertChannel(id, h.index);
    } else if (h.remove) from.removeChannel(id);
    else if (h.dock) {
      // на середину блока другого вида — рядом с ним, а не вместо него
      if (!dock.place(h.dock.target, h.dock.side, chartsSpec([id]))) return;
      from?.removeChannel(id);
    }
    // последний канал унесли — пустой блок графиков убираем
    if (from && !from.spec.channels.length) dock.remove(from.spec);
  };
  move(e);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function setLibHidden(hidden) {
  $('app').classList.toggle('lib-hidden', hidden);
  $('libToggleIco').style.setProperty('--i', `url(/vendor/icons/${hidden ? 'panel-left-open' : 'panel-left-close'}.svg)`);
  $('libToggle').title = hidden ? 'Показать список кругов' : 'Скрыть список кругов';
  save('tlmLibHidden', hidden ? '1' : '0');
}

// ---------- библиотека: шаг 1 — сессия, шаг 2 — её круги и сравнение ----------

const fmtDate = (ms) => {
  if (!ms) return '';
  const d = new Date(ms);
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace('.', '');
};
const fmtTime = (ms) => (ms ? new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '');
const dayTitle = (ms) => {
  if (!ms) return 'Без даты';
  const d = new Date(ms), now = new Date();
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  if (days === 0) return 'Сегодня';
  if (days === 1) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
};
const trackName = (i) => [i.track, i.trackConfig].filter(Boolean).join(' — ');
const baseName = (p) => String(p).split(/[\\/]/).pop();
const refName = (f) => baseName(f).replace(/\.(ibt|duckdb)$/i, '');
const plural = (n, one, few, many) => {
  const a = n % 10, b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
};

// круги, которые годятся для сравнения: засчитанные полные, а если таких нет — просто полные
const goodLaps = (info) => {
  const v = (info?.laps || []).filter((l) => l.complete && l.valid);
  return v.length ? v : (info?.laps || []).filter((l) => l.complete);
};
const bestLap = (info) => goodLaps(info).reduce((b, l) => (!b || l.time < b.time ? l : b), null);
const fullLaps = (info) => (info?.laps || []).filter((l) => l.complete).length;

// файлы выбранной игры: её папка и эталоны этой игры
const gameFiles = () => lib.files.filter((f) => f.group === game || (f.group === 'refs' && (!f.info || f.info.source === game)));
const fileInfo = (file) => lib.files.find((f) => f.file === file)?.info || null;
const gameTitle = () => (game === 'lmu' ? 'Le Mans Ultimate' : 'iRacing');

function renderLibrary() {
  $('sessView').hidden = !!session;
  $('lapsView').hidden = !session;
  if (session) renderSession(); else renderSessions();
}

function sessHtml(f) {
  const i = f.info, best = bestLap(i), n = fullLaps(i);
  const ref = f.group === 'refs';
  return `<div class="sess ${n ? '' : 'weak'} ${session === f.file ? 'on' : ''}" data-open="${esc(f.file)}" title="${esc(baseName(f.file))}">
    <div class="s-main"><b>${esc(i.track)}</b><span>${esc([i.trackConfig, i.car, ref ? refName(f.file) : ''].filter(Boolean).join(' · '))}</span></div>
    <div class="s-side"><span class="t">${best ? fmtLap(best.time) : '—'}</span><small>${n ? `${n} ${plural(n, 'круг', 'круга', 'кругов')}` : 'нет кругов'}${ref ? '' : ` · ${fmtTime(i.date)}`}</small></div>
    ${ref ? `<button class="ibtn del" data-del="${esc(f.file)}" title="Убрать эталон">${icon('trash-2', 'sm')}</button>` : ''}</div>`;
}

function renderSessions() {
  const q = query.trim().toLowerCase();
  const files = gameFiles().filter((f) => !q || `${f.info?.track} ${f.info?.trackConfig} ${f.info?.car} ${f.file}`.toLowerCase().includes(q));
  const read = files.filter((f) => f.info);
  const refs = read.filter((f) => f.group === 'refs');
  const own = read.filter((f) => f.group !== 'refs');
  const shownOwn = own.filter((f) => showEmpty || fullLaps(f.info));
  const hidden = own.length - shownOwn.length;
  let html = '';
  if (refs.length) html += `<div class="day">Эталоны</div>${refs.map(sessHtml).join('')}`;
  let day = null;
  for (const f of shownOwn) {
    const t = dayTitle(f.info.date);
    if (t !== day) { html += `<div class="day">${t}</div>`; day = t; }
    html += sessHtml(f);
  }
  if (hidden) html += `<button class="more" data-showempty>${showEmpty ? 'Скрыть' : 'Показать'} сессии без полных кругов (${hidden})</button>`;
  const unread = files.length - read.length;
  if (lib.scanning && unread) html += '<div class="skeleton"></div><div class="skeleton"></div>';
  if (!html) html = emptyLibraryNote();
  $('libList').innerHTML = html;
  const total = gameFiles().length, done = gameFiles().filter((f) => f.info || f.error).length;
  $('libFoot').innerHTML = `${lib.scanning && done < total ? `Читаю ${done} из ${total}…` : `${gameTitle()}: ${total} ${plural(total, 'файл', 'файла', 'файлов')}`} · <button data-folder="${game}">открыть папку</button>`;
}

function emptyLibraryNote() {
  if (lib.scanning) return '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  if (query) return '<div class="lib-note">Ничего не нашлось.</div>';
  if (game === 'lmu') return lib.dirs.lmu?.length
    ? '<div class="lib-note">Сессий LMU нет. Включите запись телеметрии в настройках игры (Settings → Gameplay), и после заезда они появятся здесь.</div>'
    : '<div class="lib-note">Папка Le Mans Ultimate не найдена. Файлы <code>.duckdb</code> из <code>UserData\\Telemetry</code> можно перетащить в окно.</div>';
  return `<div class="lib-note">Сессий нет. В iRacing запись включается в машине клавишами <code>Alt+L</code>
    или навсегда — строкой <code>irsdkAutoLogDisk=1</code> в <code>app.ini</code>. Файлы ложатся в <code>${esc(lib.dirs.iracing || 'Документы\\iRacing\\telemetry')}</code>.</div>`;
}

// как подписать круг Б: из этой сессии — номер, из эталона — его имя, из другой сессии — дата
function lapLabel(key) {
  const s = sel[key];
  const info = s && fileInfo(s.file);
  const l = info?.laps?.find((x) => x.index === s.index);
  if (!l) return null;
  const t = `К${l.num} · ${l.complete ? fmtLap(l.time) : '—'}`;
  if (s.file === session) return t;
  const f = lib.files.find((x) => x.file === s.file);
  return f?.group === 'refs' ? `Эталон «${refName(s.file)}» · ${t}` : `${fmtDate(info.date)} · ${t}`;
}

function renderSession() {
  const info = fileInfo(session);
  if (!info) { session = null; return renderSessions(); }
  const best = bestLap(info);
  const good = goodLaps(info).filter((l) => !(sel.a?.file === session && sel.a.index === l.index));
  const a = lapLabel('a'), b = lapLabel('b');
  let html = `<div class="s-head"><b>${esc(trackName(info))}</b><span>${esc(info.car)} · ${esc(fmtDate(info.date))}</span></div>
    <div class="cmp">
      <div class="slot"><span class="tag a">А</span><div><small>Ваш круг</small><b>${a ? esc(a) : 'выберите круг ниже'}</b></div></div>
      <div class="slot ${b ? '' : 'unset'}"><span class="tag b">Б</span><div><small>Сравнить с</small><b>${b ? esc(b) : 'не выбрано'}</b></div>
        ${b ? `<button class="ibtn" data-clearb title="Убрать сравнение">${icon('x', 'sm')}</button>` : ''}</div>
      <div class="quick"><span>Сравнить со своим:</span>
        <button data-quick="best" ${good.length ? '' : 'disabled'}>лучшим</button>
        <button data-quick="avg" ${good.length ? '' : 'disabled'}>средним</button>
        <button data-quick="worst" ${good.length ? '' : 'disabled'}>худшим</button></div>
      <p class="cmp-hint">Эталон сетапера — перетащите файл или архив в окно: он сразу встанет в Б.</p>
    </div>
    <div class="sec-h">Круги сессии<small>нажмите круг — он станет вашим (А) · «Б» — сравнить с ним</small></div><div class="laps">`;
  for (const l of info.laps) {
    const isA = sel.a?.file === session && sel.a.index === l.index;
    const isB = sel.b?.file === session && sel.b.index === l.index;
    const flags = [];
    if (!l.complete) flags.push('<span class="flag">неполный</span>');
    if (l.pit) flags.push('<span class="flag">боксы</span>');
    if (l.off) flags.push('<span class="flag bad">вылет</span>');
    if (l.inc) flags.push(`<span class="flag bad">${l.inc}x</span>`);
    const gap = l.complete && best && l.index !== best.index ? `+${(l.time - best.time).toFixed(3)}` : '';
    html += `<div class="lap ${best?.index === l.index ? 'best' : ''} ${l.complete ? '' : 'weak'} ${isA ? 'sel-a' : ''} ${isB ? 'sel-b' : ''}" data-lap="${l.index}" data-lfile="${esc(session)}">
      <span class="n">К${l.num}</span><span class="t ${l.complete && !l.valid ? 'bad' : ''}" ${l.complete && !l.valid ? 'title="Круг не засчитан"' : ''}>${l.complete ? fmtLap(l.time) : '—'}</span>
      <span class="gap">${gap}</span><span class="flags">${flags.join('')}</span>
      <button class="pick a ${isA ? 'on' : ''}" data-pick="a" title="Ваш круг (А)">А</button>
      <button class="pick b ${isB ? 'on' : ''}" data-pick="b" title="Сравнить с этим кругом (Б)" ${l.complete ? '' : 'disabled'}>Б</button></div>`;
  }
  html += '</div>';
  // эталоны и другие свои сессии на этой трассе: сравнение с их лучшим кругом
  const others = gameFiles().filter((f) => f.info && f.file !== session && f.info.trackId === info.trackId && bestLap(f.info))
    // сначала эталоны, потом та же машина, внутри — от быстрых к медленным
    .sort((x, y) => (y.group === 'refs') - (x.group === 'refs') || (y.info.carId === info.carId) - (x.info.carId === info.carId) || bestLap(x.info).time - bestLap(y.info).time);
  html += `<div class="sec-h">Сравнить с другими<small>эталоны и ваши сессии на этой трассе — лучший круг</small></div>`;
  html += others.length ? others.slice(0, 30).map((f) => {
    const bl = bestLap(f.info), on = sel.b?.file === f.file;
    return `<div class="other ${on ? 'on' : ''}" data-cmp="${esc(f.file)}" title="Сравнить с лучшим кругом этого файла">
      ${f.group === 'refs' ? '<span class="badge">Эталон</span>' : ''}<span class="o-name">${esc(f.group === 'refs' ? refName(f.file) : fmtDate(f.info.date))}${f.info.carId !== info.carId ? ` · ${esc(f.info.car)}` : ''}</span>
      <span class="t">${fmtLap(bl.time)}</span><span class="pick b ${on ? 'on' : ''}">Б</span></div>`;
  }).join('') : '<div class="lib-note">Других файлов с этой трассы нет. Перетащите эталон в окно.</div>';
  $('lapsBox').innerHTML = html;
}

async function openSession(file) {
  const info = fileInfo(file);
  if (!info) return;
  session = file;
  const best = bestLap(info) || info.laps[0];
  renderLibrary();
  if (best && !(sel.a?.file === file && sel.a.index === best.index)) await pick('a', file, best.index);
}

// быстрое сравнение со своим кругом этой же сессии
function quickB(kind) {
  const info = fileInfo(session);
  const pool = goodLaps(info).filter((l) => !(sel.a?.file === session && sel.a.index === l.index));
  if (!pool.length) return;
  let lap;
  if (kind === 'best') lap = pool.reduce((b, l) => (l.time < b.time ? l : b));
  else if (kind === 'worst') lap = pool.reduce((b, l) => (l.time > b.time ? l : b));
  else {
    const mean = pool.reduce((s2, l) => s2 + l.time, 0) / pool.length;
    lap = pool.reduce((b, l) => (Math.abs(l.time - mean) < Math.abs(b.time - mean) ? l : b));
  }
  pick('b', session, lap.index, true);
}

// эталон прочитан: та же трасса — в Б, другая (или сессия не открыта) — открываем его как сессию
function applyPendingRefs() {
  for (const p of [...pendingRefs]) {
    const info = fileInfo(p);
    const f = lib.files.find((x) => x.file === p);
    if (!info && !f?.error) continue;
    pendingRefs = pendingRefs.filter((x) => x !== p);
    if (!info) { toast(`Не удалось прочитать «${baseName(p)}»: ${f.error}`); continue; }
    const best = bestLap(info);
    if (session && fileInfo(session)?.trackId === info.trackId && best) {
      pick('b', p, best.index, true);
      toast(`Эталон «${refName(p)}» поставлен в Б — ${fmtLap(best.time)}`);
    } else {
      openSession(p);
      if (session) toast(`Эталон с другой трассы (${trackName(info)}) — открыт как сессия`);
    }
    pendingRefs = [];
    break;
  }
}

// ---------- выбор кругов ----------

async function pick(key, file, index, force = false) {
  const info = fileInfo(file);
  if (!info) return;
  if (key === 'b' && sel.a && fileInfo(sel.a.file)?.trackId !== info.trackId) return toast('Эталон должен быть с той же трассы, что и круг А.');
  if (sel[key]?.file === file && sel[key].index === index) {
    if (force) return;
    if (key === 'b') { sel.b = null; laps.b = null; for (const v of views()) v.scene.setLine('b', null); renderAll(); }
    return;
  }
  sel[key] = { file, index };
  loading++;
  renderAll();
  try {
    // круг А с другой трассы — новая трасса, эталон сбрасываем
    if (key === 'a' && (!track || track.trackId !== info.trackId)) {
      sel.b = null; laps.b = null;
      for (const v of views()) v.scene.setLine('b', null);
      await loadTrack(file, info);
    }
    if (!track) await loadTrack(file, info);
    const raw = await tlm.lap(file, index);
    if (sel[key]?.file !== file || sel[key].index !== index) return; // пока читали, выбрали другой
    laps[key] = snapToTrack(prepareLap(raw, track.proj), trackData);
    for (const v of views()) v.scene.setLine(key, laps[key], key === 'a' ? settings.lineMode : settings.lineModeB);
    if (key === 'a') { play.t = play.vt = 0; play.on = false; }
  } catch (e) {
    sel[key] = null;
    toast(`Не удалось прочитать круг: ${e.message}`);
  } finally {
    loading--;
    renderAll();
  }
}

async function loadTrack(file, info) {
  const model = await tlm.track(file);
  if (!model?.lat) throw new Error('не получилось построить трассу');
  const proj = projector(model.lat[0], model.lon[0], model.alt ? model.alt[0] : 0);
  track = { file, trackId: info.trackId, source: info.source, model, proj };
  buildTrack();
  for (const v of views()) {
    v.scene.fit();
    v.scene.setMode(v.spec.cam || 'top');
  }
}

function trackWidth() {
  return Number(settings.widths?.[track?.trackId]) || DEFAULT_WIDTH;
}

function buildTrack() {
  if (!track) { trackData = null; for (const v of views()) v.scene.setTrack(null); return; }
  const m = track.model, p = track.proj;
  const n = m.lat.length;
  const pts = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    pts[k * 3] = p.x(m.lon[k]);
    pts[k * 3 + 1] = m.alt ? m.alt[k] - p.alt0 : 0;
    pts[k * 3 + 2] = p.z(m.lat[k]);
  }
  // высота осевой — сглаженная (±20 м): в iRacing она записана ступеньками по 10 см
  if (m.alt) {
    const y = Float32Array.from({ length: n }, (_, k) => pts[k * 3 + 1]);
    const W = 10;
    for (let k = 0; k < n; k++) {
      let sum = 0, cnt = 0;
      for (let q = -W; q <= W; q++) {
        const j = m.closed ? (k + q + n) % n : k + q;
        if (j < 0 || j >= n) continue;
        sum += y[j]; cnt++;
      }
      pts[k * 3 + 1] = sum / cnt;
    }
  }
  const half = trackWidth() / 2;
  track.pts = pts;
  trackData = {
    pts, n, closed: m.closed, length: m.trackLength,
    hwL: m.hwL || half, hwR: m.hwR || half,
    start: 0, sectors: (m.sectors || []).map((pct) => Math.round(pct * n) % n),
  };
  for (const v of views()) v.scene.setTrack(trackData);
  drawMinimapBase();
}

// ---------- кадр ----------

let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  const A = laps.a, B = laps.b;
  if (A && play.on) {
    play.t += dt * play.speed;
    if (play.t >= A.end) { play.t = A.end; setPlaying(false); }
  }
  // при проигрывании показываем как есть; при перемотке — догоняем плавно, а большой скачок (> 4 с круга) — сразу
  if (play.on || Math.abs(play.t - play.vt) > 4) play.vt = play.t;
  else play.vt += (play.t - play.vt) * (1 - Math.exp(-dt * 14));
  const sa = A ? stateAt(A, play.vt) : null;
  const sb = B ? stateAt(B, Math.min(play.vt, B.end)) : null;
  const f = { sa, sb, dt, has: !!A, mini, track: trackData, inputs: '', delta: '' };
  if (A) {
    f.inputs = inputRow('a', sa) + (sb ? inputRow('b', sb) : '');
    f.delta = deltaHtml(sa);
    updateTransport();
  }
  for (const b of shown) b.render(f);
  requestAnimationFrame(frame);
}

function setPlaying(on) {
  if (on && laps.a && play.t >= laps.a.end - 0.01) play.t = 0;
  play.on = on && !!laps.a;
  $('playIco').style.setProperty('--i', `url(/vendor/icons/${play.on ? 'pause' : 'play'}.svg)`);
}

function seek(t) {
  if (!laps.a) return;
  play.t = Math.max(0, Math.min(laps.a.end, t));
}

function setSpeed(dir) {
  const i = SPEEDS.indexOf(play.speed);
  play.speed = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 3 : i) + dir))];
  save('tlmSpeed', String(play.speed));
  $('speedVal').textContent = `${play.speed}×`;
}

// ---------- плашки ----------

// Карточка пилота поверх трассы (как в GoFast): кольцо — сколько круга пройдено, имя, круг и время, педали, скорость, передача, обороты
const CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
function inputRow(key, s) {
  const lap = laps[key];
  const pct = (v) => Math.round(Math.max(0, Math.min(1, v)) * 100);
  const gear = s.gear < 0 ? 'R' : s.gear === 0 ? 'N' : String(s.gear);
  const prog = lap?.end ? Math.min(100, (s.t / lap.end) * 100) : 0;
  const who = names[key] || (key === 'a' ? 'Ваш круг' : 'Эталон');
  return `<div class="drv" style="--c:var(--car-${key})">
    <div class="ring" style="--p:${prog.toFixed(1)}"><span style="transform:rotate(${(-s.steer).toFixed(1)}deg)">${WHEEL}</span></div>
    <div class="d-body">
      <div class="d-top"><b>${esc(who)}</b><span class="d-sub">${esc(lapNo[key] || '')}</span><span class="d-clock">${CLOCK}${fmtLap(s.t)}</span></div>
      <div class="d-row">
        <span class="ped thr ${s.thr > 0.01 ? 'on' : ''}"><span class="pct">${pct(s.thr)}%</span><span class="bar"><i style="width:${pct(s.thr)}%"></i></span></span>
        <span class="ped brk ${s.brk > 0.01 ? 'on' : ''}"><span class="pct">${pct(s.brk)}%</span><span class="bar"><i style="width:${pct(s.brk)}%"></i></span></span>
        <span class="d-spd">${(s.speed * 3.6).toFixed(0)}<small>км/ч</small></span>
        <span class="d-gear"><small>ПЕР</small>${gear}</span>
        <span class="d-rpm"><small>RPM</small>${Math.round(s.rpm)}</span>
      </div>
    </div></div>`;
}

function sectorAt(d) {
  const L = track?.model?.trackLength;
  const sec = track?.model?.sectors || [];
  if (!L || !sec.length) return '';
  let k = 0;
  while (k < sec.length && d >= sec[k] * L) k++;
  return `S${k + 1}`;
}

function deltaHtml(sa) {
  if (laps.b) {
    const dt = play.vt - timeAtDist(laps.b, sa.dist);
    const cls = dt > 0.0005 ? 'loss' : dt < -0.0005 ? 'gain' : '';
    return `<span class="v ${cls}">${dt > 0 ? '+' : dt < 0 ? '−' : ''}${Math.abs(dt).toFixed(3)}</span><span class="s">к Б · ${sectorAt(sa.dist) || '—'}</span>`;
  }
  return sectorAt(sa.dist) ? `<span class="v">${sectorAt(sa.dist)}</span><span class="s">${Math.round(sa.dist)} м</span>` : '';
}

function updateTransport() {
  const A = laps.a;
  const f = A.end ? play.vt / A.end : 0;
  $('tlFill').style.width = `${f * 100}%`;
  $('tlHead').style.left = `${f * 100}%`;
  $('clock').textContent = fmtLap(play.vt);
}

// ---------- миникарта ----------

let mini = null; // { path: Path2D, map(x, z) → [px, py] } — миникарта холста 360×260, общая для всех блоков «Трасса»
function drawMinimapBase() {
  if (!track?.pts) { mini = null; return; }
  const pts = track.pts, n = pts.length / 3;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let k = 0; k < n; k++) { x0 = Math.min(x0, pts[k * 3]); x1 = Math.max(x1, pts[k * 3]); z0 = Math.min(z0, pts[k * 3 + 2]); z1 = Math.max(z1, pts[k * 3 + 2]); }
  const W = 360, H = 260, pad = 22;
  const s = Math.min((W - pad * 2) / (x1 - x0 || 1), (H - pad * 2) / (z1 - z0 || 1));
  const ox = (W - (x1 - x0) * s) / 2, oz = (H - (z1 - z0) * s) / 2;
  const map = (x, z) => [ox + (x - x0) * s, oz + (z - z0) * s];
  const path = new Path2D();
  for (let k = 0; k < n; k += 2) { const [px, py] = map(pts[k * 3], pts[k * 3 + 2]); k ? path.lineTo(px, py) : path.moveTo(px, py); }
  if (track.model.closed) path.closePath();
  mini = { path, map };
}

// ---------- общий вид ----------

function renderHead() {
  const part = (key) => {
    const s = sel[key];
    if (!s) return '';
    const info = fileInfo(s.file);
    const l = info?.laps?.find((x) => x.index === s.index);
    if (!info || !l) return '';
    return `<span class="car"><span class="tag ${key}">${key === 'a' ? 'А' : 'Б'}</span><b>${esc(info.car)}</b><span>К${l.num}</span><span class="t">${l.complete ? fmtLap(l.time) : '—'}</span></span>`;
  };
  const tr = sel.a ? fileInfo(sel.a.file) : null;
  $('lapsHead').innerHTML = (tr ? `<span class="car"><b>${esc(trackName(tr))}</b></span>` : '') + part('a') + part('b');
}

function updateNames() {
  for (const key of ['a', 'b']) {
    const sl = sel[key], info = sl && fileInfo(sl.file), l = info?.laps?.find((x) => x.index === sl.index);
    const f = sl && lib.files.find((x) => x.file === sl.file);
    names[key] = !info ? '' : f?.group === 'refs' ? refName(sl.file) : (info.driver || (key === 'a' ? 'Ваш круг' : 'Сравнение'));
    lapNo[key] = l ? `Круг ${l.num}` : '';
  }
}

function renderAll() {
  updateNames();
  renderLibrary();
  renderHead();
  const has = !!laps.a;
  $('empty').hidden = has || loading > 0;
  if (loading > 0 && !has) $('empty').hidden = true;
  $('transport').hidden = !has;
  for (const b of shown) b.setData(blockData());
  if (has) {
    $('total').textContent = fmtLap(laps.a.time);
    const L = track?.model?.trackLength;
    $('tlSectors').innerHTML = (track?.model?.sectors || []).map((p) => `<i style="left:${(timeAtDist(laps.a, p * L) / laps.a.end) * 100}%"></i>`).join('');
  }
  document.body.style.cursor = loading > 0 ? 'progress' : '';
}

function renderOpts() {
  const o = $('opts');
  const lmu = track?.source === 'lmu';
  const seg = (key, list, cur) => `<div class="seg">${list.map(([k, t]) => `<button data-line${key}="${k}" class="${cur === k ? 'on' : ''}">${t}</button>`).join('')}</div>`;
  o.innerHTML = `
    <div><div class="lbl">Раскраска линии А</div>${seg('', [['inputs', 'Педали'], ['speed', 'Скорость'], ['solid', 'Цвет']], settings.lineMode)}</div>
    <div><div class="lbl">Раскраска линии Б</div>${seg('-b', [['inputs', 'Педали'], ['solid', 'Цвет машины']], settings.lineModeB)}</div>
    <p class="hint"><span style="color:#E5544B">■</span> тормоз · <span style="color:#3CCB6F">■</span> газ · <span style="color:#DFE2E7">■</span> накат (ни одна педаль не нажата)</p>
    ${lmu
    ? '<p class="hint">Края трассы LMU берутся из файла телеметрии.</p>'
    : `<div><div class="lbl">Ширина трассы <b id="wVal">${trackWidth()} м</b></div>
        <input type="range" id="wRange" min="6" max="25" step="0.5" value="${trackWidth()}">
        <p class="hint">В файлах iRacing краёв трассы нет: ширина одна на всю трассу, запоминается для каждой трассы.</p></div>`}
    <p class="hint credit">3D-модель машины: «2019 McLaren 720S GT3» — Ddiaz Design (sketchfab.com/ddiaz-design), лицензия CC BY 4.0. Упрощена и перекрашена для Overlap.</p>`;
}

let toastTimer = null;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

// ---------- события ----------

document.addEventListener('click', (e) => {
  const el = e.target.closest('button, .lap, .sess, .other');
  if (!e.target.closest('#opts, #optBtn')) $('opts').hidden = true;
  if (!e.target.closest('#layoutPop, #layoutBtn')) $('layoutPop').hidden = true;
  if (!el || el.closest('.blk')) return;
  const d = el.dataset;
  if (d.del) { e.stopPropagation(); if (session === d.del) session = null; return tlm.removeRef(d.del); }
  if (d.open) return openSession(d.open);
  if (d.cmp) { const bl = bestLap(fileInfo(d.cmp)); return bl ? pick('b', d.cmp, bl.index, true) : undefined; }
  if (d.quick) return quickB(d.quick);
  if ('clearb' in d) { sel.b = null; laps.b = null; for (const v of views()) v.scene.setLine('b', null); return renderAll(); }
  if ('showempty' in d) { showEmpty = !showEmpty; return renderLibrary(); }
  if (d.folder) return tlm.openFolder(d.folder);
  if (d.pick) {
    const row = el.closest('.lap');
    return pick(d.pick, row.dataset.lfile, Number(row.dataset.lap));
  }
  if (el.classList.contains('lap')) return pick('a', d.lfile, Number(d.lap));
  if (d.preset) return setPreset(d.preset);
  if (d.side) return setSideTab(d.side);
  if (d.line) {
    settings.lineMode = d.line;
    tlm.saveSettings({ lineMode: d.line });
    if (laps.a) for (const v of views()) v.scene.setLine('a', laps.a, d.line);
    return renderOpts();
  }
  if (d.lineB) {
    settings.lineModeB = d.lineB;
    tlm.saveSettings({ lineModeB: d.lineB });
    if (laps.b) for (const v of views()) v.scene.setLine('b', laps.b, d.lineB);
    return renderOpts();
  }
  switch (el.id) {
    case 'addBtn': return tlm.pick().then(afterImport);
    case 'rescanBtn': return tlm.rescan();
    case 'backBtn': session = null; return renderLibrary();
    case 'play': return setPlaying(!play.on);
    case 'toStart': return seek(0);
    case 'toEnd': return seek(Infinity);
    case 'back': return seek(play.t - 1);
    case 'fwd': return seek(play.t + 1);
    case 'slower': return setSpeed(-1);
    case 'faster': return setSpeed(1);
    case 'libToggle': return setLibHidden(!$('app').classList.contains('lib-hidden'));
    case 'layoutBtn': renderLayoutPop(); $('opts').hidden = true; $('layoutPop').hidden = !$('layoutPop').hidden; return undefined;
    case 'optBtn': renderOpts(); $('layoutPop').hidden = true; $('opts').hidden = !$('opts').hidden; return undefined;
    default: return undefined;
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'search') { query = e.target.value; renderLibrary(); }
  if (e.target.id === 'wRange' && track) {
    const w = Number(e.target.value);
    settings.widths = { ...(settings.widths || {}), [track.trackId]: w };
    $('wVal').textContent = `${w} м`;
    buildTrack();
  }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'wRange') tlm.saveSettings({ widths: settings.widths });
});

// перемотка по шкале: нажать и тянуть
(() => {
  const tl = $('timeline');
  let on = false;
  const at = (e) => {
    const r = tl.getBoundingClientRect();
    seek(((e.clientX - r.left) / r.width) * (laps.a?.end || 0));
  };
  tl.addEventListener('pointerdown', (e) => { on = true; tl.setPointerCapture(e.pointerId); at(e); });
  tl.addEventListener('pointermove', (e) => { if (on) at(e); });
  tl.addEventListener('pointerup', () => { on = false; });
})();

document.addEventListener('keydown', (e) => {
  if (e.target.matches?.('input, select')) return;
  const v = activeView || views()[0];
  const step = e.shiftKey ? 5 : 1;
  if (e.code === 'Space') { e.preventDefault(); setPlaying(!play.on); }
  else if (e.key === 'ArrowLeft') seek(play.t - step);
  else if (e.key === 'ArrowRight') seek(play.t + step);
  else if (e.key === 'Home') seek(0);
  else if (e.key === 'End') seek(Infinity);
  else if (e.key === '+' || e.key === '=') setSpeed(1);
  else if (e.key === '-') setSpeed(-1);
  else if (v && e.key === '1') v.setCam('top');
  else if (v && (e.key === '2' || e.key === '3')) v.setCam('chase');
  else if (v && (e.key.toLowerCase() === 'c' || e.key.toLowerCase() === 'с')) v.setFollow(true);
  else if (v && (e.key.toLowerCase() === 'f' || e.key.toLowerCase() === 'а')) v.fit();
});

// перетаскивание файлов в окно — в «Эталоны»
let dragDepth = 0;
const isFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => { if (!isFiles(e)) return; e.preventDefault(); dragDepth++; $('drop').hidden = false; });
window.addEventListener('dragover', (e) => { if (isFiles(e)) e.preventDefault(); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop').hidden = true; } });
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('drop').hidden = true;
  const paths = [...(e.dataTransfer?.files || [])].map((f) => tlm.pathFor(f)).filter(Boolean);
  if (paths.length) afterImport(await tlm.importFiles(paths));
});

function afterImport(r) {
  if (!r) return;
  if (r.added.length) {
    pendingRefs = [...r.added];
    setSideTab('laps');
    toast(`Читаю эталон: ${r.added.map(refName).join(', ')}…`);
    applyPendingRefs();
  }
  if (r.skipped.length) toast(`Не телеметрия (нужны .ibt, .duckdb или архив с ними): ${r.skipped.join(', ')}`);
}

// ---------- запуск ----------

(async () => {
  settings = { lineMode: 'inputs', lineModeB: 'solid', widths: {}, ...(await tlm.settings()) };
  dock.setTree(settings.workspace?.tree !== undefined ? settings.workspace.tree : defaultTree());
  syncBlocks();
  setSideTab(sideTab);
  setLibHidden(load('tlmLibHidden', '0') === '1');
  game = settings.game === 'lmu' ? 'lmu' : 'iracing';
  $('speedVal').textContent = `${play.speed}×`;
  tlm.onLibrary((l) => { lib = l; renderAll(); if (pendingRefs.length) applyPendingRefs(); });
  lib = await tlm.library();
  renderAll();
  requestAnimationFrame(frame);
})();
