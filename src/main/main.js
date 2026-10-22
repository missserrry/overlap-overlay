// Electron: сервер телеметрии, окна оверлеев по активной раскладке и панель управления.
//   Ctrl+Shift+L — закрепить/открепить оверлеи (режим редактирования: перетаскивание и растягивание за края)
//   Ctrl+Shift+H — скрыть/показать все оверлеи
//   Ctrl+Shift+J — открыть панель управления (или клик по значку в трее)
const path = require('path');
const { app, BrowserWindow, Tray, Menu, nativeImage, globalShortcut, ipcMain, shell, screen } = require('electron');
const { startServer } = require('../server/server');
const config = require('./config');
const { LayoutState } = require('./state');
const snapper = require('./snapper');
const { execFile } = require('child_process');
const { TradingPaints, DEFAULT_SETTINGS: DEFAULT_LIVERY_SETTINGS } = require('../liveries/tradingPaints');
const { reloadCarTexture } = require('../telemetry/broadcast');

let liveries;

let cfg;
let server;
let state;
let tray;
let panel = null;
const windows = new Map(); // overlayId -> BrowserWindow

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => openPanel());

app.whenReady().then(async () => {
  cfg = config.load(app.getPath('userData'));
  try {
    server = await startServer({ port: cfg.port, demo: cfg.demo });
  } catch (e) {
    console.error('Не удалось запустить сервер:', e);
    app.quit();
    return;
  }
  state = new LayoutState(cfg, onStateChanged);
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
  return { ...state.snapshot(), liveries: { ...liveries.snapshot(), otherDownloader } };
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

function syncWindows() {
  const desired = state.desiredOverlays();
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
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadURL(`http://127.0.0.1:${server.port}/${o.type}/`);
  win.webContents.on('did-finish-load', () => {
    win.ready = true;
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
  win.on('closed', () => windows.delete(o.id));
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
  win.webContents.send('overlay-settings', { editing, bgOpacity: o.bgOpacity ?? 0.8, name: o.name, columns: o.columns, header: o.header, footer: o.footer, cards: o.cards, flagLayout: o.flagLayout ?? 'big', hideEmpty: !!o.hideEmpty, radar: { range: o.radarRange ?? 15, idle: o.radarIdle ?? 0.35, dist: o.radarDist !== false, cls: !!o.radarClass }, scale: o.autoScale ? null : (o.scale ?? 1), split: o.split ?? null });
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
  panel.loadURL(`http://127.0.0.1:${server.port}/panel/`);
  panel.once('ready-to-show', () => panel.show());
  panel.on('closed', () => {
    panel = null;
    state.panelSelection = null;
    onStateChanged();
  });
}

ipcMain.handle('panel-get-state', () => panelState());
ipcMain.on('panel-action', (_e, action) => {
  try {
    if (String(action?.type).startsWith('liveries.')) applyLiveryAction(action);
    else state.apply(action);
  } catch (e) {
    console.error('[panel] action failed:', action, e);
  }
});
ipcMain.on('panel-open-url', (_e, url) => {
  if (/^http:\/\/127\.0\.0\.1:\d+\//.test(url)) shell.openExternal(url);
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
  const src = { iracing: 'iRacing', demo: 'демо', none: 'нет данных' }[snap.sim.source] || snap.sim.source;
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
