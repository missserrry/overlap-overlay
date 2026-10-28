// Electron: сервер телеметрии, окна оверлеев по активной раскладке и панель управления.
//   Ctrl+Shift+L — закрепить/открепить оверлеи (режим редактирования: перетаскивание и растягивание за края)
//   Ctrl+Shift+H — скрыть/показать все оверлеи
//   Ctrl+Shift+J — открыть панель управления (или клик по значку в трее)
const path = require('path');
const { app, BrowserWindow, Tray, Menu, nativeImage, globalShortcut, ipcMain, shell, screen, clipboard, Notification, dialog } = require('electron');
const logger = require('./logger');
const { foreground, isSim, monitorOf, isShown } = require('./foreground');
const { startServer } = require('../server/server');
const config = require('./config');
const P = require('./palette');
const { hideFromAltTab } = require('./winstyle');
const updater = require('./updater');
const { LayoutState } = require('./state');
const snapper = require('./snapper');
const { execFile } = require('child_process');
const { TradingPaints, DEFAULT_SETTINGS: DEFAULT_LIVERY_SETTINGS } = require('../liveries/tradingPaints');
const setupsInstaller = require('../setups/installer');
const { reloadCarTexture } = require('../telemetry/broadcast');
const { initTelemetry, openTelemetry } = require('./telemetryWindow');
const { TrainingRef } = require('./trainingRef');

let liveries;

// Папка настроек всегда одна и та же (%APPDATA%\svoy-overlay), чем бы ни запускали приложение: установщик, portable или npm start.
// Благодаря этому обновление поверх старой версии сохраняет раскладки, позиции окон и всё, что настроил пользователь.
// OVERLAP_USER_DATA — отдельная папка данных для проверки версии из проекта рядом с установленной (иначе второй экземпляр не запустится)
app.setPath('userData', process.env.OVERLAP_USER_DATA || path.join(app.getPath('appData'), 'svoy-overlay'));

// Логи пишем с самого старта, чтобы не потерять ошибки запуска
logger.init(app.getPath('userData'));
logger.hookConsole();
// При падении сами сохраняем отчёт и говорим об этом уведомлением (не чаще раза в 10 минут)
let lastCrashNote = 0;
function onFatal(reason) {
  if (Date.now() - lastCrashNote < 10 * 60_000) return;
  lastCrashNote = Date.now();
  try {
    const f = path.join(logger.getDir(), `overlap-crash-${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}.txt`);
    require('fs').writeFileSync(f, `Причина: ${reason}

${report()}`);
    if (Notification.isSupported()) {
      const n = new Notification({ title: 'Overlap: произошла ошибка', body: 'Отчёт сохранён. Нажмите, чтобы открыть папку, и отправьте файл разработчику.' });
      n.on('click', () => shell.showItemInFolder(f));
      n.show();
    }
  } catch { /* не мешаем работе */ }
}
app.setAppUserModelId('local.overlap');
logger.installCrashHandlers(onFatal);
let diagNote = null; // сообщение под кнопками диагностики в панели

let cfg;
let server;
let state;
let trainingRef;
let tray;
let panel = null;
const windows = new Map(); // overlayId -> BrowserWindow

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => openPanel());

app.whenReady().then(async () => {
  // на чистой установке «Что нового» не показываем: версию помечаем увиденной сразу
  const firstRun = !require('fs').existsSync(path.join(app.getPath('userData'), 'config.json'));
  cfg = config.load(app.getPath('userData'));
  if (firstRun) cfg.lastSeenVersion = app.getVersion();
  logger.setVerbose(cfg.verboseLog);
  console.log(`Overlap ${app.getVersion()} запущен (Electron ${process.versions.electron}, ${process.platform} ${process.arch})`);
  try {
    server = await startServer({ port: cfg.port, demo: cfg.demo, game: () => cfg.game, debug: logger.debug, log: (m) => logger.write('INFO', m), srStateFile: path.join(app.getPath('userData'), 'safety-rating.json'), srLearnedFile: path.join(app.getPath('userData'), 'sr-corners-learned.json'), fuelStateFile: path.join(app.getPath('userData'), 'fuel-history.json') });
  } catch (e) {
    console.error('Не удалось запустить сервер:', e);
    if (e && e.code === 'EADDRINUSE') {
      dialog.showErrorBox('Overlap не запустился', `Порт ${cfg.port} занят другой программой (возможно, второй экземпляр Overlap или другое приложение).

Закройте её и запустите Overlap снова.`);
    } else {
      dialog.showErrorBox('Overlap не запустился', `Не удалось запустить сервер телеметрии:
${e && e.message ? e.message : e}`);
    }
    app.quit();
    return;
  }
  state = new LayoutState(cfg, onStateChanged);
  initTelemetry({ port: server.port, cfg });
  // эталон режима «Тренировка»: выбирается в панели, читается из файла телеметрии
  trainingRef = new TrainingRef({ cfg, setRef: (ref) => server.setTrainingRef(ref), onChange: () => { cfg.save(); onStateChanged(); }, parent: () => panel });
  trainingRef.restore();
  watchForeground();
  watchOverlayHealth();
  state.sim = server.status;
  server.onStatus((s) => { state.sim = s; onStateChanged(); });

  // Ливреи Trading Paints: при каждом новом списке пилотов живого iRacing
  cfg.liveries = { ...DEFAULT_LIVERY_SETTINGS, ...(cfg.liveries || {}) };
  liveries = new TradingPaints({
    paintDir: path.join(app.getPath('documents'), 'iRacing', 'paint'),
    dataFile: path.join(app.getPath('userData'), 'liveries.json'),
    getSettings: () => cfg.liveries,
    reloadTexture: (carIdx) => { try { reloadCarTexture(carIdx); } catch (e) { console.warn('[liveries] reload:', e.message); } },
    onChange: sendPanelStateSoon,
  });
  server.onSession((session, numbers) => liveries.onSession(session, numbers));
  watchOtherDownloaders();

  updater.init(sendPanelStateSoon, () => cfg.autoUpdate !== false);
  createTray();
  const shortcuts = {
    'CommandOrControl+Shift+L': () => state.apply({ type: 'app.set', locked: !cfg.locked }),
    'CommandOrControl+Shift+H': () => state.apply({ type: 'app.set', hiddenAll: !cfg.hiddenAll }),
    'CommandOrControl+Shift+J': openPanel,
  };
  for (const [keys, fn] of Object.entries(shortcuts)) {
    if (!globalShortcut.register(keys, fn)) console.warn(`[main] горячая клавиша ${keys} занята другой программой`);
  }
  syncWindows();
  if (!process.argv.includes('--hidden')) openPanel();
});

app.on('window-all-closed', (e) => e.preventDefault()); // живём в трее
app.on('will-quit', () => {
  try { cfg?.flush?.(); } catch { /* не мешаем выходу */ }
  globalShortcut.unregisterAll();
  server?.close();
});

function onStateChanged() {
  server.setDemo(cfg.demo);
  syncWindows();
  rebuildTrayMenu();
  sendPanelState();
}

function panelState() {
  return { ...state.snapshot(), trainingRef: trainingRef?.snapshot() || { busy: false, error: '' }, liveries: { ...liveries.snapshot(), otherDownloader }, setups: setupsView(), update: updater.snapshot(), diag: { dir: logger.getDir() || '', note: diagNote, verbose: !!cfg.verboseLog } };
}

function sendPanelState() {
  if (panel && !panel.isDestroyed()) panel.webContents.send('panel-state', panelState());
}

// журнал ливрей пишет часто — отправляем в панель не чаще 4 раз в секунду
let panelTimer = null;
function sendPanelStateSoon() {
  if (panelTimer) return;
  panelTimer = setTimeout(() => { panelTimer = null; sendPanelState(); }, 250);
}

// ---------- сетапы ----------

// Документы\iRacing: Документы могут лежать в OneDrive, поэтому путь спрашиваем у системы
const iracingDocs = () => path.join(app.getPath('documents'), 'iRacing');
let setupsLast = null;                 // итог загрузки (для панели и отмены): группы, созданные файлы, суммы
let setupsPending = new Map();         // архивы, ждущие подтверждения машины: id → группа (с содержимым, только в главном процессе)
let setupsCars = [];                   // список машин для выбора вручную
let setupsBusy = false;

const emptyLast = (problems = []) => ({ groups: [], created: [], total: { setups: 0, laps: 0, same: 0 }, problems });
function addResult(out) {
  setupsLast = setupsLast || emptyLast();
  setupsLast.groups.push({ ...out, created: undefined });
  setupsLast.created.push(...out.created);
  setupsLast.total.setups += out.setups; setupsLast.total.laps += out.laps; setupsLast.total.same += out.same;
  console.log(`[setups] ${out.archive}: машина ${out.car || '—'} (${{ laps: 'по базовым кругам', name: 'по названию, подтверждено', none: 'выбрана вручную' }[out.how] || '—'}), сетапов ${out.setups}, кругов ${out.laps}, уже было ${out.same}${out.skipped.length ? `, пропущено ${out.skipped.length}` : ''} → ${out.where.join(', ') || '—'}`);
}

async function installSetups(paths) {
  setupsBusy = true; sendPanelState();
  try {
    const a = await setupsInstaller.analyze(paths, { iracingDir: iracingDocs() });
    setupsLast = emptyLast(a.problems);
    setupsPending = new Map();
    setupsCars = a.cars;
    for (const p of a.problems) console.warn(`[setups] ${p}`);
    for (const g of a.groups) {
      if (!g.setupsCount && !g.laps.length) { setupsLast.problems.push(`«${g.archive}»: сетапов и базовых кругов не нашлось`); continue; }
      // базовые круги надёжно называют и машину, и трассу: раскладываем сами; сетапы по одному имени архива — только после подтверждения
      if (g.how === 'laps' || !g.setupsCount) addResult(setupsInstaller.execute(g, g.car, { iracingDir: iracingDocs() }));
      else setupsPending.set(g.id, g);
    }
  } catch (e) {
    console.error('[setups] ошибка:', e);
    setupsLast = emptyLast([`Не удалось обработать файлы: ${e.message}`]);
  } finally { setupsBusy = false; }
}

function applySetupsAction(a) {
  if (a.type === 'setups.drop' && Array.isArray(a.paths)) { installSetups(a.paths.filter((p) => typeof p === 'string')).then(sendPanelState); return; }
  if (a.type === 'setups.pick') {
    dialog.showOpenDialog(panel && !panel.isDestroyed() ? panel : undefined, { title: 'Сетапы и базовые круги', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Архивы, сетапы и круги', extensions: ['zip', '7z', 'rar', 'sto', 'blap', 'olap'] }] })
      .then((r) => (!r.canceled && r.filePaths.length ? installSetups(r.filePaths) : null))
      .then(sendPanelState)
      .catch((e) => console.warn('[setups] выбор файлов:', e.message));
    return;
  }
  if (a.type === 'setups.confirm') {
    const g = setupsPending.get(a.id);
    const car = setupsCars.find((c) => c.dir === a.car)?.dir;
    if (g && car) { setupsPending.delete(a.id); addResult(setupsInstaller.execute(g, car, { iracingDir: iracingDocs() })); }
  } else if (a.type === 'setups.skip') {
    const g = setupsPending.get(a.id);
    if (g) { setupsPending.delete(a.id); setupsLast?.problems.push(`«${g.archive}»: пропущен по вашему решению`); console.log(`[setups] ${g.archive}: пропущен пользователем`); }
  } else if (a.type === 'setups.undo' && setupsLast?.created?.length) {
    const n = setupsInstaller.undo(setupsLast.created);
    console.log(`[setups] загрузка отменена, удалено файлов: ${n}`);
    setupsLast = emptyLast([`Загрузка отменена, удалено файлов: ${n}`]);
  } else if (a.type === 'setups.openFolder') shell.openPath(path.join(iracingDocs(), 'setups'));
  sendPanelState();
}

function setupsView() {
  return {
    dir: iracingDocs(), last: setupsLast, canUndo: !!setupsLast?.created?.length, busy: setupsBusy, cars: setupsCars,
    pending: [...setupsPending.values()].map((g) => ({ id: g.id, archive: g.archive, count: g.setupsCount, how: g.how, guess: g.guess, candidates: g.candidates })),
  };
}

// ---------- ливреи ----------

function applyLiveryAction(a) {
  if (a.type === 'liveries.set') {
    const p = a.patch || {};
    for (const k of ['enabled', 'specMaps', 'helmets', 'decals', 'myOwn']) if (typeof p[k] === 'boolean') cfg.liveries[k] = p[k];
    if (Number.isFinite(p.cleanAfterDays)) cfg.liveries.cleanAfterDays = Math.max(0, Math.min(365, Math.round(p.cleanAfterDays)));
    cfg.save();
    // включили или поменяли набор — сразу пройтись по текущей сессии
    const last = server.lastSession;
    if (cfg.liveries.enabled && last) liveries.refresh(last.session, last.loadNumTextures);
  } else if (a.type === 'liveries.refresh') {
    const last = server.lastSession;
    if (last) liveries.refresh(last.session, last.loadNumTextures);
    else liveries.write('info', 'iRacing не в сессии — обновлять нечего');
  } else if (a.type === 'liveries.openFolder') {
    shell.openPath(path.join(app.getPath('documents'), 'iRacing', 'paint'));
  }
  sendPanelState();
}

// Следим, какое окно на переднем плане: игра свернута или её закрыло другое окно — оверлеи прячутся.
// Своё окно (панель, оверлеи) не считается уходом из игры: тогда остаётся прежнее состояние.
// Клик по другому монитору — не уход из игры: если окно iRacing не свёрнуто, а на передний план вышло окно
// с другого монитора (браузер, Discord, рабочий стол второго экрана), игра по-прежнему видна, и оверлеи остаются.
let simWindow = null;   // окно iRacing, каким его видели на переднем плане в последний раз
function watchForeground() {
  const check = () => {
    const f = foreground();
    if (!f.exe && !f.pid) return;
    if (f.pid === process.pid) return;
    let focused = isSim(f.exe);
    if (focused) simWindow = f.hwnd;
    else if (simWindow && isShown(simWindow)) {
      const simMonitor = monitorOf(simWindow), fgMonitor = monitorOf(f.hwnd);
      focused = !!simMonitor && !!fgMonitor && simMonitor !== fgMonitor;
    }
    if (focused !== state.gameFocused) {
      state.gameFocused = focused;
      logger.debug(`передний план: ${f.exe || '?'} → оверлеи ${focused ? 'показаны' : 'скрыты'}`);
      onStateChanged();
    }
  };
  setInterval(check, 400);
  check();
}

// Kapps Better TP или официальный загрузчик Trading Paints качают в те же папки — предупреждаем в панели
let otherDownloader = null;
function watchOtherDownloaders() {
  const check = () => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true }, (err, out) => {
    if (err) return;
    const names = out.toLowerCase();
    const found = names.includes('"bettertp.exe"') ? 'Kapps (Better TP)'
      : names.includes('tradingpaints') ? 'Trading Paints Downloader' : null;
    if (found !== otherDownloader) { otherDownloader = found; sendPanelState(); }
  });
  check();
  setInterval(check, 15000);
}

// ---------- окна оверлеев ----------

// Что сейчас на экране и почему не показаны включённые: пишем в журнал только при изменении
let overlaySetSig = '';
function logOverlaySet() {
  let st;
  try { st = state.overlayStatus(); } catch { return; }
  const shown = st.list.filter((o) => o.shown).map((o) => o.type);
  // скрытые включённые оверлеи группируем по причине: «окно игры не в фокусе: relative, fuel, …»
  const byWhy = new Map();
  for (const o of st.list) if (o.enabled && !o.shown) byWhy.set(o.why, [...(byWhy.get(o.why) || []), o.type]);
  const hidden = [...byWhy].map(([why, types]) => `${why}: ${types.join(', ')}`);
  const sig = JSON.stringify([st.layout, st.variation, shown, hidden]);
  if (sig === overlaySetSig) return;
  overlaySetSig = sig;
  logger.write('INFO', `оверлеи: раскладка «${st.layout}» (${st.variation}), на экране: ${shown.join(', ') || 'ничего'}${hidden.length ? `; включены, но скрыты — ${hidden.join('; ')}` : ''}`);
}

// Педали вынесены в отдельный оверлей Pedals — тогда Dash рисуется без своих столбиков
let pedalsOut = false;

function syncWindows() {
  const desired = state.desiredOverlays();
  pedalsOut = desired.some((o) => o.type === 'pedals');
  logOverlaySet();
  const editing = !cfg.locked;
  const ids = new Set(desired.map((o) => o.id));

  for (const [id, win] of windows) {
    if (!ids.has(id)) win.destroy();
  }
  for (const o of desired) {
    let win = windows.get(o.id);
    if (!win || win.isDestroyed()) win = createOverlayWindow(o);
    applyOverlay(win, o, editing);
  }
}

function createOverlayWindow(o) {
  const win = new BrowserWindow({
    x: o.x, y: o.y, width: o.width, height: o.height,
    title: o.name,
    transparent: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false, // не тормозить отрисовку, когда окно «за» игрой
    },
  });
  win.overlayId = o.id;
  win.overlayType = o.type;
  hideFromAltTab(win);
  logger.attachWindow(win, `оверлей ${o.type}`);
  const born = Date.now();
  win.bornAt = born;
  logger.write('INFO', `оверлей ${o.type}: окно создано ${o.width}×${o.height} в (${o.x}, ${o.y})`);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadURL(`http://127.0.0.1:${server.port}/${o.type}/`);
  win.webContents.on('did-finish-load', () => {
    win.ready = true;
    logger.write('INFO', `оверлей ${o.type}: страница загружена за ${Date.now() - born} мс`);
    const cur = state.findOverlay(win.overlayId);
    if (cur) applyOverlay(win, cur, !cfg.locked, true);
    win.showInactive();
  });

  const saveBounds = () => {
    if (win.applying) return;
    const cur = state.findOverlay(win.overlayId);
    if (!cur) return;
    Object.assign(cur, win.getBounds());
    cfg.save();
  };
  win.on('moved', saveBounds);
  win.on('resized', saveBounds);
  win.on('closed', () => { windows.delete(o.id); logger.write('INFO', `оверлей ${o.type}: окно закрыто`); });
  windows.set(o.id, win);
  return win;
}

// Привести окно к настройкам оверлея (позиция, масштаб, прозрачность фона, режим редактирования)
function applyOverlay(win, o, editing, force = false) {
  win.applying = true;
  const b = win.getBounds();
  const dragging = resizing?.win === win; // пока тянут за край, границы задаёт курсор
  if (!dragging && (force || b.x !== o.x || b.y !== o.y || b.width !== o.width || b.height !== o.height)) {
    win.setBounds({ x: o.x, y: o.y, width: o.width, height: o.height });
  }
  win.applying = false;
  win.setIgnoreMouseEvents(!editing);
  win.setFocusable(editing);
  if (!win.ready) return;
  win.webContents.setZoomFactor(1); // масштаб теперь задаётся размером окна
  win.webContents.send('overlay-settings', { editing, bgOpacity: o.bgOpacity ?? 0.8, name: o.name, columns: o.columns, header: o.header, footer: o.footer, cards: o.cards, dash: o.type === 'dash' ? { ...o.dash, 'bars.out': pedalsOut } : o.dash, pedals: o.pedals, abs: o.abs, sectors: o.sectors, laps: o.laps, rejoin: o.rejoin, fuel: o.fuel, pitlimit: o.pitlimit, sr: o.sr, forecast: o.forecast, radarbars: o.radarbars, sizes: o.sizes || {}, decimals: o.decimals || {}, licMode: o.licMode || 'full', rel: o.rel, traffic: o.traffic, flagLayout: o.flagLayout ?? 'big', hideEmpty: !!o.hideEmpty, radar: { range: o.radarRange ?? 15, idle: o.radarIdle ?? 0.35, dist: o.radarDist !== false, cls: !!o.radarClass }, scale: o.autoScale ? null : (o.scale ?? 1), split: o.split ?? null, palette: P.buildVars(cfg.palette, o.type) });
}

// Перемещение и растягивание (как в Laki Overlay): двигать — за любое место окна,
// тянуть — за правый край, низ или правый нижний угол. Курсор ведёт главный процесс,
// по пути окно прилипает к краям экрана и других оверлеев (snapper.js), Shift отключает прилипание.
// Содержимое оверлея само подстраивается под новый размер.
let resizing = null; // { win, timer, mode, shift }

ipcMain.on('overlay-drag-start', (e, mode) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || cfg.locked || !/^(move|e|s|se)$/.test(mode)) return;
  stopDrag();
  const bounds = win.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const others = [...windows.values()].filter((w) => w !== win && !w.isDestroyed() && w.isVisible()).map((w) => w.getBounds());
  const snap = snapper.begin(bounds, others, display.bounds);
  const start = { cursor: screen.getCursorScreenPoint(), bounds };
  const startedAt = Date.now();
  lastGuides = '';
  showGuides(display.bounds);

  const session = { win, mode, shift: false };
  session.timer = setInterval(() => {
    // страховка: если отпускание мыши потерялось, через 30 с прекращаем
    if (win.isDestroyed() || Date.now() - startedAt > 30000) return stopDrag();
    const c = screen.getCursorScreenPoint();
    const dx = c.x - start.cursor.x, dy = c.y - start.cursor.y;
    const raw = { ...start.bounds };
    let result;
    if (mode === 'move') {
      raw.x += dx; raw.y += dy;
      result = snapper.moving(snap, raw, session.shift);
    } else {
      if (mode.includes('e')) raw.width += dx;
      if (mode.includes('s')) raw.height += dy;
      result = snapper.sizing(snap, raw, mode, session.shift);
    }
    sendGuides(display.bounds, result.guides);
    const b = win.getBounds(), r = { ...result.rect };
    // DigiFlag растягивается строго с заданным соотношением сторон (квадрат или две полосы)
    const o = state.findOverlay(win.overlayId);
    if ((o?.type === 'digiflag' || o?.type === 'radar') && mode !== 'move') {
      const aspect = flagAspect(o);
      if (mode === 's') r.width = Math.round(r.height * aspect); else r.height = Math.round(r.width / aspect);
    }
    if (b.x === r.x && b.y === r.y && b.width === r.width && b.height === r.height) return;
    win.applying = true;
    win.setBounds(r);
    win.applying = false;
  }, 16);
  resizing = session;
});

ipcMain.on('overlay-drag-shift', (_e, down) => { if (resizing) resizing.shift = down; });
// Ширина / высота окна DigiFlag: квадрат или две вертикальные полосы (см. overlays/digiflag/digiflag.js)
function flagAspect(o) {
  if (o.type === 'radar') return 1;
  return o.flagLayout === 'strip' ? (2 * 4 / 15 + 0.03) : 1;
}
ipcMain.on('overlay-drag-end', stopDrag);

// Положение разделителя между левой и правой частью таблицы (доля ширины окна под левую часть)
ipcMain.on('overlay-split', (e, ratio) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const o = win && state.findOverlay(win.overlayId);
  if (!o) return;
  o.split = Number.isFinite(ratio) ? Math.min(0.85, Math.max(0.15, ratio)) : null;
  state.changed();
});

function stopDrag() {
  if (!resizing) return;
  clearInterval(resizing.timer);
  const { win } = resizing;
  resizing = null;
  hideGuides();
  if (win.isDestroyed()) return;
  const o = state.findOverlay(win.overlayId);
  if (o) {
    Object.assign(o, win.getBounds());
    cfg.save();
  }
}

// Прозрачное окно поверх монитора для линий-направляющих; кликов не перехватывает
let guidesWin = null;

function showGuides(area) {
  if (!guidesWin || guidesWin.isDestroyed()) {
    guidesWin = new BrowserWindow({
      ...area, transparent: true, frame: false, resizable: false, skipTaskbar: true, hasShadow: false,
      focusable: false, alwaysOnTop: true, show: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
    });
    hideFromAltTab(guidesWin);
    guidesWin.setAlwaysOnTop(true, 'screen-saver');
    guidesWin.setIgnoreMouseEvents(true);
    guidesWin.loadURL(`http://127.0.0.1:${server.port}/common/guides.html`);
  }
  guidesWin.setBounds(area);
  guidesWin.webContents.send('guides', { origin: area, guides: [] });
  guidesWin.showInactive();
}

// Направляющие шлём только когда они изменились: тик — 16 мс, а перерисовывать окно на весь экран каждый раз незачем
let lastGuides = '';
function sendGuides(area, guides) {
  const sig = JSON.stringify(guides);
  if (sig === lastGuides) return;
  lastGuides = sig;
  if (guidesWin && !guidesWin.isDestroyed()) guidesWin.webContents.send('guides', { origin: area, guides });
}

function hideGuides() {
  if (guidesWin && !guidesWin.isDestroyed()) guidesWin.hide();
}

// ---------- панель управления ----------

function openPanel() {
  if (panel && !panel.isDestroyed()) {
    if (panel.isMinimized()) panel.restore();
    panel.show();
    panel.focus();
    return;
  }
  panel = new BrowserWindow({
    width: 1100, height: 760, minWidth: 900, minHeight: 600,
    title: 'Overlap',
    icon: path.join(__dirname, '..', '..', 'overlays', 'common', 'brand', 'icon.png'),
    backgroundColor: '#0E0F11',
    autoHideMenuBar: true,
    // рама одного цвета с навигацией: системный заголовок скрыт, кнопки окна рисуются поверх верхней полосы
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0E0F11', symbolColor: '#8A9099', height: 40 },
    show: false,
    webPreferences: { preload: path.join(__dirname, 'panelPreload.js') },
  });
  logger.attachWindow(panel, 'панель');
  panel.loadURL(`http://127.0.0.1:${server.port}/panel/`);
  panel.once('ready-to-show', () => panel.show());
  panel.on('closed', () => {
    panel = null;
    state.panelSelection = null;
    onStateChanged();
  });
}

// Сторож: оверлей на экране, а его страница так и не подключилась к серверу, или данные перестали идти
const watchdogSeen = new Set();
function watchOverlayHealth() {
  setInterval(() => {
    const health = server?.health?.() || {};
    for (const win of windows.values()) {
      if (win.isDestroyed() || !win.isVisible()) continue;
      const h = health[win.overlayType];
      if (!h) continue;
      const age = Date.now() - (win.bornAt || Date.now());
      const problem = h.clients === 0 && age > 20000 ? 'страница не подключена к каналу данных'
        : h.clients > 0 && h.okAgo != null && h.okAgo > 10 ? `данные не обновляются ${h.okAgo} с` : '';
      const key = `${win.overlayId}|${problem}`;
      if (problem && !watchdogSeen.has(key)) { watchdogSeen.add(key); logger.write('WARN', `оверлей ${win.overlayType}: ${problem}`); }
      if (!problem) for (const k of [...watchdogSeen]) if (k.startsWith(`${win.overlayId}|`)) { watchdogSeen.delete(k); logger.write('INFO', `оверлей ${win.overlayType}: снова в порядке`); }
    }
  }, 15000);
}

// Строки отчёта по оверлеям: что на экране, окно, канал данных, последняя ошибка
function overlayReportLines() {
  if (!state || !server) return ['(приложение ещё запускается)'];
  const health = server.health();
  const st = state.overlayStatus();
  const lines = [`Игра: ${cfg.game || 'iracing'}   Раскладка: «${st.layout}» (${st.variation}, выбрана: ${st.reason})   Сейчас: ${st.sim}${st.editing ? ', режим редактирования' : ''}`];
  for (const o of st.list) {
    const win = windows.get(o.id);
    const h = health[o.type] || {};
    const winText = win && !win.isDestroyed() ? `окно ${win.isVisible() ? 'видно' : 'скрыто'}, ${win.ready ? 'страница загружена' : 'страница не загрузилась'}, ${win.getBounds().width}×${win.getBounds().height}` : 'окна нет';
    const dataText = win && !win.isDestroyed() ? `канал: подключено ${h.clients ?? 0}, данные ${h.okAgo == null ? 'не шли' : `${h.okAgo} с назад`}${h.errors ? `, ошибок модели ${h.errors}${h.failing ? ' (сейчас сбоит)' : ''}: ${h.lastError}` : ''}` : '';
    lines.push(`- ${o.type}: ${o.shown ? 'НА ЭКРАНЕ' : o.enabled ? `включён, скрыт — ${o.why}` : 'выключен'}${winText && o.shown ? `; ${winText}; ${dataText}` : ''}`);
  }
  return lines;
}

// Диагностика: папка логов, отчёт в буфер обмена или в файл
function report() {
  // файл самонастройки SR: какие числа поворотов подобраны и что ждёт проверки
  const extra = [];
  try {
    const learned = require('fs').readFileSync(path.join(app.getPath('userData'), 'sr-corners-learned.json'), 'utf8');
    extra.push('=== Самонастройка SR (файл) ===', learned.length > 4000 ? `${learned.slice(0, 4000)}…` : learned, '');
  } catch { /* файла ещё нет */ }
  return logger.buildReport({ app, screen, cfg: cfg || {}, status: server?.status, overlays: overlayReportLines(), extra });
}
function applyDiagAction(a) {
  if (a.type === 'diag.openFolder') {
    require('fs').mkdirSync(logger.getDir(), { recursive: true });
    shell.openPath(logger.getDir()).then((err) => { if (err) { diagNote = `Не удалось открыть папку: ${err}`; sendPanelState(); } });
    diagNote = null;
  } else if (a.type === 'diag.copyReport') {
    clipboard.writeText(report());
    diagNote = 'Отчёт скопирован в буфер обмена — вставьте его в сообщение.';
  } else if (a.type === 'diag.saveReport') {
    const f = path.join(logger.getDir(), `overlap-report-${new Date().toISOString().slice(0, 10)}.txt`);
    require('fs').writeFileSync(f, report());
    shell.showItemInFolder(f);
    diagNote = 'Отчёт сохранён в папку логов — отправьте этот файл.';
  } else if (a.type === 'diag.verbose') {
    cfg.verboseLog = !!a.value;
    logger.setVerbose(cfg.verboseLog);
    cfg.save();
    console.log(`Подробные логи: ${cfg.verboseLog ? 'включены' : 'выключены'}`);
  }
  sendPanelState();
}

ipcMain.handle('panel-get-state', () => panelState());
ipcMain.on('panel-action', (_e, action) => {
  try {
    if (action?.type === 'update.check') updater.check();
    else if (action?.type === 'update.download') updater.download();
    else if (action?.type === 'update.install') updater.install();
    else if (String(action?.type).startsWith('liveries.')) applyLiveryAction(action);
    else if (String(action?.type).startsWith('setups.')) applySetupsAction(action);
    else if (String(action?.type).startsWith('diag.')) applyDiagAction(action);
    else if (action?.type === 'telemetry.open') openTelemetry();
    else if (action?.type === 'training.pickRef') trainingRef.pick();
    else if (action?.type === 'training.clearRef') trainingRef.clear();
    else state.apply(action);
  } catch (e) {
    console.error('[panel] action failed:', action, e);
  }
});
ipcMain.on('panel-open-url', (_e, url) => {
  if (/^http:\/\/127\.0\.0\.1:\d+\//.test(url) || String(url).startsWith('https://github.com/missserrry/overlap-overlay/')) shell.openExternal(url);
});

// ---------- трей ----------

function trayIcon() {
  // значок Overlap (design/make-icon.py → overlays/common/brand/tray.png)
  return nativeImage.createFromPath(path.join(__dirname, '..', '..', 'overlays', 'common', 'brand', 'tray.png'));
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.on('click', openPanel);
  rebuildTrayMenu();
}

function rebuildTrayMenu() {
  if (!tray) return;
  const snap = state.snapshot();
  const active = state.layout(snap.active.layoutId);
  const src = { iracing: 'iRacing', lmu: 'Le Mans Ultimate', demo: 'демо', none: 'нет данных' }[snap.sim.source] || snap.sim.source;
  tray.setToolTip(`Overlap — ${src}${active ? ' · ' + active.name : ''}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Панель управления (Ctrl+Shift+J)', click: openPanel },
    { type: 'separator' },
    {
      label: 'Раскладка',
      submenu: cfg.layouts.map((l) => ({
        label: l.name, type: 'radio', checked: l.id === snap.active.layoutId,
        click: () => state.apply({ type: 'layout.activate', id: l.id }),
      })),
    },
    { label: 'Закрепить оверлеи (Ctrl+Shift+L)', type: 'checkbox', checked: cfg.locked, click: (i) => state.apply({ type: 'app.set', locked: i.checked }) },
    { label: 'Скрыть все (Ctrl+Shift+H)', type: 'checkbox', checked: cfg.hiddenAll, click: (i) => state.apply({ type: 'app.set', hiddenAll: i.checked }) },
    { type: 'separator' },
    { label: 'Выход', click: () => app.quit() },
  ]));
}
