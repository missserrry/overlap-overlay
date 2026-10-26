// Общий клиент оверлеев: WebSocket с переподключением, масштаб, режим редактирования, форматтеры.

export function connect(channel, onData) {
  let ws;
  const open = () => {
    ws = new WebSocket(`ws://${location.host}/ws/${channel}`);
    // Рисуем сразу, без requestAnimationFrame: он засыпает, когда окно перекрыто игрой.
    // Сервер шлёт ~15 сообщений в секунду, этого достаточно.
    ws.onmessage = (e) => onData(JSON.parse(e.data));
    ws.onclose = () => {
      onData({ data: null });
      setTimeout(open, 2000);
    };
  };
  open();
}

// Оверлей подключает обработчик смены колонок (см. columns.js: setColumns)
// Масштаб: число — фиксированный (окно задаёт только сколько строк и колонок влезет), null — «авто», как раньше:
// масштаб подгоняется под ширину окна. Источники те же, что у колонок: адрес (?scale=1.25 | auto), настройки приложения, панель.
let fixedScale = 1;
const scaleListeners = [];
export const getFixedScale = () => fixedScale;
export const onScaleChange = (fn) => scaleListeners.push(fn);
function deliverScale(v) {
  const next = v === 'auto' || v === null ? null : Number(v);
  if (next !== null && !(next > 0)) return;
  if (next === fixedScale) return;
  fixedScale = next;
  scaleListeners.forEach((f) => f());
}

// Разделитель между частями таблицы (Standings): доля ширины окна под левую часть, null — авто
let splitValue = null;
const splitListeners = [];
export const getSplit = () => splitValue;
export const onSplit = (fn) => splitListeners.push(fn);
export function deliverSplit(v) {
  const next = Number.isFinite(v) && v > 0 && v < 1 ? v : null;
  if (next === splitValue) return;
  splitValue = next;
  splitListeners.forEach((f) => f());
}

// Шапка и подвал: упорядоченные списки включённых пунктов (см. hf.js). Источники те же: ?hdr=sof,inc&ftr=session,lap, настройки, панель
let hfHook = null, lastHf = { header: null, footer: null };
const deliverHf = (zone, ids) => { lastHf = { ...lastHf, [zone]: ids }; hfHook?.(lastHf); };
export const onHfChange = (fn) => { hfHook = fn; if (lastHf.header || lastHf.footer) fn(lastHf); };

// Карточки оверлея Weather: упорядоченный список включённых id (?cards=trackTemp,wind, настройки, панель)
let cardsHook = null, lastCards = null;
const deliverCards = (ids) => { lastCards = ids; cardsHook?.(ids); };
export const onCardsChange = (fn) => { cardsHook = fn; if (lastCards) fn(lastCards); };

// DigiFlag: вид панели и «прятать, когда флага нет» (?layout=strip&hide=1, настройки, панель)
let flagOpts = { layout: 'big', hide: false, range: 15, idle: 0.35, dist: true, cls: false };
const flagListeners = [];
export const getFlagOpts = () => flagOpts;
export const onFlagOpts = (fn) => flagListeners.push(fn);
function deliverFlagOpts(o) {
  const next = { ...flagOpts, ...o };
  if (JSON.stringify(next) === JSON.stringify(flagOpts)) return;
  flagOpts = next;
  flagListeners.forEach((f) => f());
}

// Настройки Dash (JSON): ?dash=..., настройки приложения, панель
let dashHook = null, lastDash = null;
const deliverDash = (obj) => { lastDash = obj; dashHook?.(obj); };
export const onDashChange = (fn) => { dashHook = fn; if (lastDash) fn(lastDash); };

// Настройки Sectors (JSON): ?sectors=..., настройки приложения, панель
let sectorsHook = null, lastSectors = null;
const deliverSectors = (obj) => { lastSectors = obj; sectorsHook?.(obj); };
export const onSectorsChange = (fn) => { sectorsHook = fn; if (lastSectors) fn(lastSectors); };

// Палитра: карта CSS-переменных ({'--player-strong': '#eabe11'}) из настроек приложения, ?palette=... или панели.
// Прежние значения снимаются, поэтому сброс в панели возвращает стандартные цвета из CSS.
let palVars = {};
const palListeners = [];
export const cssVar = (name, fallback) => palVars[name] ?? fallback;
export const onPalette = (fn) => palListeners.push(fn);
// Подсветка зоны цвета в превью панели. Показываем тур: для каждой зоны сначала один образец (его приближает панель), потом вся группа
// одним прямоугольником, в конце общий план со всеми зонами. Фон показываем как пустой прямоугольник. Пока цвет правят, тур стоит.
let focus = null;
const FRAME_CSS = `#pal-frames { position: fixed; inset: 0; z-index: 99999; pointer-events: none; }
#pal-frames i { position: absolute; border: 2px solid #E2B93B; border-radius: 5px; box-shadow: 0 0 0 5px rgba(226, 185, 59, 0.2); transition: left 220ms, top 220ms, width 220ms, height 220ms; }
body.pal-focus :is(.ctag, .stripe, .brand, .tire, .class-head, .cname) { filter: grayscale(1) opacity(0.45); }`;
const visibleEls = (sel) => [...document.querySelectorAll(sel)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
const rectOf = (els) => {
  const rs = els.map((e) => e.getBoundingClientRect());
  const x1 = Math.min(...rs.map((r) => r.left)), y1 = Math.min(...rs.map((r) => r.top));
  const x2 = Math.max(...rs.map((r) => r.right)), y2 = Math.max(...rs.map((r) => r.bottom));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
};
function drawFrames(rects) {
  const box = document.getElementById('pal-frames');
  if (!box) return;
  while (box.children.length < rects.length) box.appendChild(document.createElement('i'));
  [...box.children].forEach((el, i) => {
    const r = rects[i];
    el.style.display = r ? '' : 'none';
    if (r) Object.assign(el.style, { left: `${r.x - 3}px`, top: `${r.y - 3}px`, width: `${r.w + 6}px`, height: `${r.h + 6}px` });
  });
}
function focusTick() {
  if (!focus) return;
  const zs = focus.zones.map((sel) => ({ sel, els: visibleEls(sel) })).filter((z) => z.els.length);
  let steps = [];
  zs.forEach((z, i) => { steps.push({ z: i, mode: 'one' }); if (z.els.length > 1) steps.push({ z: i, mode: 'all' }); });
  if (zs.length > 1) steps.push({ mode: 'overview' });
  let rects = [], box = null;
  if (!steps.length) { drawFrames([]); return reportFocus(null, true); }
  if (focus.i >= steps.length) focus.i = 0;
  const st = steps[focus.i];
  if (focus.solo) rects = [rectOf(zs.flatMap((z) => z.els))];
  else if (st.mode === 'overview') rects = zs.map((z) => rectOf(z.els));
  else if (st.mode === 'one') { box = rectOf([zs[st.z].els[0]]); rects = [box]; }
  else { box = rectOf(zs[st.z].els); rects = [box]; }
  drawFrames(rects);
  reportFocus(box, false);
}
let focusSig = '';
function reportFocus(box, empty) {
  const sig = JSON.stringify([box && [Math.round(box.x), Math.round(box.y), Math.round(box.w), Math.round(box.h)], empty]);
  if (sig === focusSig) return;
  focusSig = sig;
  window.parent?.postMessage({ svoyFocusBox: box && { ...box, iw: window.innerWidth, ih: window.innerHeight }, svoyFocusEmpty: empty }, location.origin);
}
function setFocusSel(cfg) {
  clearInterval(focus?.tick); clearInterval(focus?.step);
  document.getElementById('pal-focus-style')?.remove();
  document.getElementById('pal-frames')?.remove();
  document.body.classList.remove('pal-focus', 'pal-solo');
  focusSig = '';
  if (!cfg || !Array.isArray(cfg.zones) || !cfg.zones.length) {
    focus = null;
    window.parent?.postMessage({ svoyFocusBox: null, svoyFocusEmpty: false }, location.origin);
    return;
  }
  const st = document.createElement('style');
  st.id = 'pal-focus-style';
  st.textContent = FRAME_CSS + (cfg.solo ? `\nbody.pal-solo :is(${cfg.zones.join(',')}) > * { visibility: hidden; }` : '');
  document.head.appendChild(st);
  const fr = document.createElement('div');
  fr.id = 'pal-frames';
  document.body.appendChild(fr);
  document.body.classList.add('pal-focus');
  if (cfg.solo) document.body.classList.add('pal-solo');
  focus = { zones: cfg.zones, solo: !!cfg.solo, i: 0, paused: false };
  focus.tick = setInterval(focusTick, 200);
  focus.step = setInterval(() => { if (!focus.paused) focus.i++; }, 2000);
  setTimeout(focusTick, 40);
}

function deliverPalette(vars) {
  const next = vars && typeof vars === 'object' ? vars : {};
  if (JSON.stringify(next) === JSON.stringify(palVars)) return;
  const st = document.documentElement.style;
  for (const k of Object.keys(palVars)) if (!(k in next)) st.removeProperty(k);
  for (const [k, v] of Object.entries(next)) st.setProperty(k, v);
  palVars = next;
  palListeners.forEach((f) => f());
}

// Настройки Laps (JSON): ?laps=..., настройки приложения, панель
let lapsHook = null, lastLaps = null;
const deliverLaps = (obj) => { lastLaps = obj; lapsHook?.(obj); };
export const onLapsChange = (fn) => { lapsHook = fn; if (lastLaps) fn(lastLaps); };

// Настройки Rejoin (JSON): ?rejoin=..., настройки приложения, панель
let rejoinHook = null, lastRejoin = null;
const deliverRejoin = (obj) => { lastRejoin = obj; rejoinHook?.(obj); };
export const onRejoinChange = (fn) => { rejoinHook = fn; if (lastRejoin) fn(lastRejoin); };

// Настройки Fuel (JSON): ?fuel=..., настройки приложения, панель
let fuelHook = null, lastFuel = null;
const deliverFuel = (obj) => { lastFuel = obj; fuelHook?.(obj); };
export const onFuelChange = (fn) => { fuelHook = fn; if (lastFuel) fn(lastFuel); };

// Настройки Pit Limiter (JSON): ?pitlimit=..., настройки приложения, панель
let pitHook = null, lastPit = null;
const deliverPit = (obj) => { lastPit = obj; pitHook?.(obj); };
export const onPitChange = (fn) => { pitHook = fn; if (lastPit) fn(lastPit); };

// Настройки Safety Rating (JSON): ?sr=..., настройки приложения, панель
let srHook = null, lastSr = null;
const deliverSr = (obj) => { lastSr = obj; srHook?.(obj); };
export const onSrChange = (fn) => { srHook = fn; if (lastSr) fn(lastSr); };

// Настройки Forecast (JSON): ?forecast=..., настройки приложения, панель
let forecastHook = null, lastForecast = null;
const deliverForecast = (obj) => { lastForecast = obj; forecastHook?.(obj); };
export const onForecastChange = (fn) => { forecastHook = fn; if (lastForecast) fn(lastForecast); };

// Настройки Radar Bars (JSON): ?radarbars=..., настройки приложения, панель
let rbHook = null, lastRb = null;
const deliverRb = (obj) => { lastRb = obj; rbHook?.(obj); };
export const onRadarBarsChange = (fn) => { rbHook = fn; if (lastRb) fn(lastRb); };

// Знаки после запятой у колонок (JSON {id: 0…3}): ?dec=..., настройки приложения, панель
let decHook = null, lastDec = null;
const deliverDecimals = (obj) => { lastDec = obj; decHook?.(obj); };
export const onDecimalsChange = (fn) => { decHook = fn; if (lastDec) fn(lastDec); };

// Размеры полей таблицы (JSON {id: %}): ?sizes=..., настройки приложения, панель
let sizesHook = null, lastSizes = null;
const deliverSizes = (obj) => { lastSizes = obj; sizesHook?.(obj); };
export const onSizesChange = (fn) => { sizesHook = fn; if (lastSizes) fn(lastSizes); };

// Оформление Relative (JSON): ?rel=..., настройки приложения, панель
let relHook = null, lastRel = null;
const deliverRel = (obj) => { lastRel = obj; relHook?.(obj); };
export const onRelChange = (fn) => { relHook = fn; if (lastRel) fn(lastRel); };

// Настройки Traffic (JSON): ?traffic=..., настройки приложения, панель
let trafficHook = null, lastTraffic = null;
const deliverTraffic = (obj) => { lastTraffic = obj; trafficHook?.(obj); };
export const onTrafficChange = (fn) => { trafficHook = fn; if (lastTraffic) fn(lastTraffic); };

let colsHook = null, lastCols = null;
const deliverCols = (ids) => { lastCols = ids; colsHook?.(ids); };
export const onColumnsChange = (fn) => { colsHook = fn; if (lastCols) fn(lastCols); };

export function setupPage() {
  const params = new URLSearchParams(location.search);
  if (params.has('preview')) document.body.classList.add('preview');
  const bg = parseFloat(params.get('bg'));
  if (bg >= 0) setBgOpacity(bg);
  // колонки: из адреса (OBS, превью) → из настроек приложения → сообщением от панели (живое превью)
  if (params.has('layout')) deliverFlagOpts({ layout: params.get('layout') === 'strip' ? 'strip' : 'big' });
  if (params.has('hide')) deliverFlagOpts({ hide: params.get('hide') === '1' });
  if (params.has('range')) deliverFlagOpts({ range: parseFloat(params.get('range')) || 15 });
  if (params.has('idle')) deliverFlagOpts({ idle: parseFloat(params.get('idle')) });
  if (params.has('dist')) deliverFlagOpts({ dist: params.get('dist') === '1' });
  if (params.has('cls')) deliverFlagOpts({ cls: params.get('cls') === '1' });
  if (params.has('palette')) { try { deliverPalette(JSON.parse(params.get('palette'))); } catch { /* битый адрес — цвета по умолчанию */ } }
  if (params.has('traffic')) { try { deliverTraffic(JSON.parse(params.get('traffic'))); } catch { /* настройки по умолчанию */ } }
  if (params.has('rel')) { try { deliverRel(JSON.parse(params.get('rel'))); } catch { /* настройки по умолчанию */ } }
  if (params.has('dec')) { try { deliverDecimals(JSON.parse(params.get('dec'))); } catch { /* знаки по умолчанию */ } }
  if (params.has('sizes')) { try { deliverSizes(JSON.parse(params.get('sizes'))); } catch { /* размеры по умолчанию */ } }
  if (params.has('radarbars')) { try { deliverRb(JSON.parse(params.get('radarbars'))); } catch { /* настройки по умолчанию */ } }
  if (params.has('forecast')) { try { deliverForecast(JSON.parse(params.get('forecast'))); } catch { /* настройки по умолчанию */ } }
  if (params.has('sr')) { try { deliverSr(JSON.parse(params.get('sr'))); } catch { /* настройки по умолчанию */ } }
  if (params.has('pitlimit')) { try { deliverPit(JSON.parse(params.get('pitlimit'))); } catch { /* настройки по умолчанию */ } }
  if (params.has('fuel')) { try { deliverFuel(JSON.parse(params.get('fuel'))); } catch { /* настройки по умолчанию */ } }
  if (params.has('rejoin')) { try { deliverRejoin(JSON.parse(params.get('rejoin'))); } catch { /* настройки по умолчанию */ } }
  if (params.has('laps')) { try { deliverLaps(JSON.parse(params.get('laps'))); } catch { /* настройки по умолчанию */ } }
  if (params.has('sectors')) { try { deliverSectors(JSON.parse(params.get('sectors'))); } catch { /* остаются настройки по умолчанию */ } }
  if (params.has('dash')) { try { deliverDash(JSON.parse(params.get('dash'))); } catch { /* битый адрес — остаются настройки по умолчанию */ } }
  if (params.has('cards')) deliverCards(params.get('cards').split(',').filter(Boolean));
  if (params.has('hdr')) deliverHf('header', params.get('hdr').split(',').filter(Boolean));
  if (params.has('ftr')) deliverHf('footer', params.get('ftr').split(',').filter(Boolean));
  if (params.has('scale')) deliverScale(params.get('scale'));
  if (params.has('split')) deliverSplit(parseFloat(params.get('split')));
  const fromUrl = params.get('cols');
  if (fromUrl != null) deliverCols(fromUrl.split(',').filter(Boolean));
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin) return;
    if (Array.isArray(e.data?.svoyColumns)) deliverCols(e.data.svoyColumns);
    if (e.data && 'svoyScale' in e.data) deliverScale(e.data.svoyScale);
    if (e.data?.svoyFlag) deliverFlagOpts(e.data.svoyFlag);
    if (e.data?.svoyDash) deliverDash(e.data.svoyDash);
    if (e.data?.svoySectors) deliverSectors(e.data.svoySectors);
    if (e.data?.svoyLaps) deliverLaps(e.data.svoyLaps);
    if (e.data?.svoyRejoin) deliverRejoin(e.data.svoyRejoin);
    if (e.data?.svoyFuel) deliverFuel(e.data.svoyFuel);
    if (e.data?.svoyPit) deliverPit(e.data.svoyPit);
    if (e.data?.svoySr) deliverSr(e.data.svoySr);
    if (e.data?.svoyForecast) deliverForecast(e.data.svoyForecast);
    if (e.data?.svoyRadarbars) deliverRb(e.data.svoyRadarbars);
    if (e.data?.svoySizes) deliverSizes(e.data.svoySizes);
    if (e.data?.svoyDecimals) deliverDecimals(e.data.svoyDecimals);
    if (e.data?.svoyRel) deliverRel(e.data.svoyRel);
    if (e.data?.svoyTraffic) deliverTraffic(e.data.svoyTraffic);
    if (e.data?.svoyPalette) deliverPalette(e.data.svoyPalette);
    if (e.data && 'svoyFocus' in e.data) setFocusSel(e.data.svoyFocus);
    if (e.data && 'svoyFocusPause' in e.data && focus) focus.paused = !!e.data.svoyFocusPause;
    if (Array.isArray(e.data?.svoyCards)) deliverCards(e.data.svoyCards);
    if (Array.isArray(e.data?.svoyHdr)) deliverHf('header', e.data.svoyHdr);
    if (Array.isArray(e.data?.svoyFtr)) deliverHf('footer', e.data.svoyFtr);
    if (e.data && 'svoySplit' in e.data) deliverSplit(e.data.svoySplit);
  });

  // Мост из preload Electron (если открыто не в Electron — его просто нет)
  const bridge = window.overlayBridge;
  if (bridge) {
    bridge.onSettings((s) => {
      document.body.classList.toggle('edit', !!s.editing);
      setBgOpacity(s.bgOpacity);
      const hint = document.querySelector('.edit-hint');
      if (hint && s.name) hint.textContent = `${s.name} · тяни за края`;
      if (s.flagLayout && !params.has('layout')) deliverFlagOpts({ layout: s.flagLayout });
      if (s.radar && !params.has('range')) deliverFlagOpts(s.radar);
      if ('hideEmpty' in s && !params.has('hide')) deliverFlagOpts({ hide: !!s.hideEmpty });
      if (s.dash && !params.has('dash')) deliverDash(s.dash);
      if (s.palette && !params.has('palette')) deliverPalette(s.palette);
      if (s.traffic && !params.has('traffic')) deliverTraffic(s.traffic);
      if (s.rel && !params.has('rel')) deliverRel(s.rel);
      if (s.sizes && !params.has('sizes')) deliverSizes(s.sizes);
      if (s.decimals && !params.has('dec')) deliverDecimals(s.decimals);
      if (s.pitlimit && !params.has('pitlimit')) deliverPit(s.pitlimit);
      if (s.sr && !params.has('sr')) deliverSr(s.sr);
      if (s.forecast && !params.has('forecast')) deliverForecast(s.forecast);
      if (s.radarbars && !params.has('radarbars')) deliverRb(s.radarbars);
      if (s.fuel && !params.has('fuel')) deliverFuel(s.fuel);
      if (s.rejoin && !params.has('rejoin')) deliverRejoin(s.rejoin);
      if (s.laps && !params.has('laps')) deliverLaps(s.laps);
      if (s.sectors && !params.has('sectors')) deliverSectors(s.sectors);
      if (Array.isArray(s.cards) && s.cards.length && !params.has('cards')) deliverCards(s.cards.filter((c) => c.on).map((c) => c.id));
      if (Array.isArray(s.header) && !params.has('hdr')) deliverHf('header', s.header.filter((c) => c.on).map((c) => c.id));
      if (Array.isArray(s.footer) && !params.has('ftr')) deliverHf('footer', s.footer.filter((c) => c.on).map((c) => c.id));
      if ('scale' in s && !params.has('scale')) deliverScale(s.scale);
      if ('split' in s && !params.has('split')) deliverSplit(s.split);
      if (Array.isArray(s.columns) && !params.has('cols')) deliverCols(s.columns.filter((c) => c.on).map((c) => c.id));
    });
    addResizeHandles(bridge);
  }
  return params;
}

// ---------- перемещение и растягивание (режим редактирования) ----------
// Как в Laki Overlay: за любое место окно двигается, за правый край, низ и правый нижний угол
// (полоса 18 px) — растягивается. Курсор ведёт главный процесс (там же прилипание к краям),
// страница только сообщает, что взяли, отпустили и зажат ли Shift (Shift — без прилипания).

const GRIPS = ['e', 's', 'se'];

function addResizeHandles(bridge) {
  const start = (e, mode, el) => {
    if (e.button !== 0 || !document.body.classList.contains('edit')) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    bridge.dragStart(mode);
    bridge.setShift(e.shiftKey);
    let shift = e.shiftKey;
    const move = (ev) => { if (ev.shiftKey !== shift) bridge.setShift(shift = ev.shiftKey); };
    const end = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('lostpointercapture', end);
      bridge.dragEnd();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('lostpointercapture', end);
  };
  for (const edge of GRIPS) {
    const h = document.createElement('div');
    h.className = `rz rz-${edge}`;
    h.addEventListener('pointerdown', (e) => { e.stopPropagation(); start(e, edge, h); });
    document.body.appendChild(h);
  }
  document.documentElement.addEventListener('pointerdown', (e) => start(e, 'move', document.documentElement));
}

// ---------- подгонка под размер окна ----------
// Как картинка: ширина окна задаёт масштаб, высота — сколько строк влезет.
//
//   levels:  массив уровней от полного к минимальному (объекты-флаги колонок)
//   render(level, rows) — нарисовать содержимое; rows — сколько строк данных показать
//   key()    — «форма» данных, от которой зависит естественная ширина (например, мультикласс или нет)

// Колонки не прячем: когда они не помещаются по ширине, масштаб уменьшается (в том числе в превью панели).
export function createFitter({ root, levels, render, key = () => '', after = null, maxScale = 3.5, minRows = 2 }) {
  const cache = new Map();
  let memo = null, epoch = 0;
  const rootStyle = document.documentElement.style;

  // Естественные размеры уровня при масштабе 1: ширина, высота «обвязки» и одной строки
  function measure(levelIdx) {
    const k = `${levelIdx}|${key()}`;
    if (cache.has(k)) return cache.get(k);
    rootStyle.setProperty('--scale', 1);
    document.body.classList.add('measure');
    // Высоту строки берём на заметном числе строк: на трёх-четырёх Standings ещё упирается в минимум по классам
    // (лидеры других классов), и разница между n и n+1 строкой выходит нулевой.
    const sample = (n) => { render(levels[levelIdx], n); return root.offsetHeight; };
    let n = minRows + 8, ha = sample(n);
    const width = root.scrollWidth;
    let row = sample(n + 1) - ha;
    if (row < 4) { n = minRows; ha = sample(n); row = Math.max(sample(n + 1) - ha, 1); }
    document.body.classList.remove('measure');
    const m = { width, row, chrome: Math.max(ha - row * n, 0) };
    if (width > 0) cache.set(k, m);
    return m;
  }

  function fitInner() {
    const W = window.innerWidth, H = window.innerHeight;
    const fixed = fixedScale;
    // Колонки не убираем: если всё не помещается по ширине, уменьшаем масштаб (текст мельче, но видно всё)
    const idx = 0, m = measure(0);
    let s;
    if (fixed != null) s = Math.min(fixed, W / m.width);
    else {
      s = W / m.width;
      // по высоте должно влезать хотя бы minRows строк — иначе уменьшаем масштаб
      const sByHeight = H / (m.chrome + m.row * minRows);
      s = Math.min(s, sByHeight, maxScale);
    }
    rootStyle.setProperty('--scale', s.toFixed(4));

    // Данные приходят ~15 раз в секунду, а размер окна и колонки почти не меняются: тогда число строк то же,
    // и хватает одной отрисовки (проверяем только, что не вылезли за высоту).
    const sig = `${W}|${H}|${s.toFixed(4)}|${idx}|${key()}|${epoch}`;
    if (memo && memo.sig === sig) {
      render(levels[idx], memo.rows);
      if (root.offsetHeight <= H + 0.5) return { level: idx, scale: s, rows: memo.rows };
    }

    // Оценка по замеру приблизительная (заголовки классов, разделители) — доводим по факту бинарным поиском:
    // самое большое число строк, при котором содержимое не выше окна.
    const est = Math.max(Math.floor((H - m.chrome * s) / (m.row * s)), 1);
    const fits = (n) => { render(levels[idx], n); return root.offsetHeight <= H + 0.5; };
    let lo = 1, hi = est + 3;
    if (fits(est)) lo = est; else hi = est - 1;
    if (lo === est) { while (lo < hi && fits(lo + 1)) lo++; }
    else { while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (fits(mid)) lo = mid; else hi = mid - 1; } }
    const rows = lo;
    render(levels[idx], rows);
    memo = { sig, rows };
    return { level: idx, scale: s, rows };
  }

  // after(result) — довести раскладку после подгонки (например, распределить лишнюю ширину между панелями)
  function fit() { const r = fitInner(); after?.(r); reportContent(); return r; }

  // Где в окне лежит содержимое: панель по этому прямоугольнику увеличивает превью (таблица не всегда занимает всё окно)
  let contentSig = '';
  function reportContent() {
    if (window.parent === window) return;
    const r = root.getBoundingClientRect();
    if (r.width < 20 || r.height < 20) return;
    const box = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    const sig = JSON.stringify(box);
    if (sig === contentSig) return;
    contentSig = sig;
    window.parent.postMessage({ svoyContent: box }, location.origin);
  }

  window.addEventListener('resize', () => fit.last && fit());
  scaleListeners.push(() => fit.last && fit());
  document.fonts?.ready.then(() => { cache.clear(); epoch++; if (fit.last) fit(); });
  return {
    fit() { fit.last = true; return fit(); },
    invalidate() { cache.clear(); epoch++; },
  };
}

function setBgOpacity(a) {
  if (a == null) return;
  document.documentElement.style.setProperty('--bg-a', a);
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function fmtIrating(ir) {
  if (!ir || ir <= 0) return '–';
  return ir >= 1000 ? (ir / 1000).toFixed(1) + 'k' : String(ir);
}

// 1234.5 -> "00:20:34"
export function fmtClock(sec) {
  if (sec == null || sec < 0) return '--:--:--';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return [h, m, r].map((x) => String(x).padStart(2, '0')).join(':');
}

// 2700 -> "00:45m"
export function fmtDuration(sec) {
  if (sec == null) return '∞';
  const m = Math.round(sec / 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}m`;
}

// 98.0217 -> "01:38.021"
export function fmtLap(sec, dec = 3) {
  if (!sec || sec <= 0) return dec ? `--:--.${'-'.repeat(dec)}` : '--:--';
  if (dec === 0) {
    const t = Math.round(sec);
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  }
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(dec).padStart(dec + 3, '0')}`;
}

export const ARROW_UP = '<svg viewBox="0 0 10 10"><path d="M1 7 L5 2.5 L9 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
export const ARROW_DOWN = '<svg viewBox="0 0 10 10"><path d="M1 3 L5 7.5 L9 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// showDelta: Relative показывает колонку дельты всегда (даже пустую), чтобы плашки были одной ширины
export function iratingBadge(ir, delta, showDelta = delta != null) {
  if (!showDelta) return `<span class="badge">${fmtIrating(ir)}</span>`;
  let d = '';
  if (delta) d = `${delta > 0 ? ARROW_UP : ARROW_DOWN}${Math.abs(delta)}`;
  const cls = delta > 0 ? 'gain' : delta < 0 ? 'lose' : '';
  return `<span class="badge with-delta">${fmtIrating(ir)}<span class="delta ${cls}">${d}</span></span>`;
}

export function licenseBadge(lic) {
  if (!lic) return '';
  return `<span class="lic" style="--lic:var(--lic-${lic.name === 'W' ? 'p' : esc(String(lic.name).toLowerCase())}, ${esc(lic.bgColor)});--lic-dark:var(--lic-${lic.name === 'W' ? 'p' : esc(String(lic.name).toLowerCase())}-d, ${esc(lic.darkBgColor)})"><span class="sr">${esc(lic.safetyRank)}</span><span class="letter">${esc(lic.name)}</span></span>`;
}
