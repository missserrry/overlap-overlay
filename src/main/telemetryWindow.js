// Окно «Телеметрия»: отдельное полноценное окно (не оверлей) — библиотека кругов, трасса, проигрывание и сравнение кругов.
// Открывается кнопкой в панели; повторное нажатие выводит уже открытое окно вперёд. Размер и положение запоминаются.
const path = require('path');
const { app, BrowserWindow, ipcMain, dialog, screen, shell } = require('electron');
const logger = require('./logger');
const { TelemetryLibrary } = require('../telemetry/files/library');

let win = null;
let lib = null;
let ctx = null; // { port, cfg }

function library() {
  if (!lib) {
    lib = new TelemetryLibrary({
      documents: app.getPath('documents'),
      userData: app.getPath('userData'),
      onChange: () => { if (win && !win.isDestroyed()) win.webContents.send('tlm-library', lib.list()); },
    });
  }
  return lib;
}

// Сохранённое положение — только если оно ещё попадает на один из мониторов
function savedBounds() {
  const b = ctx.cfg.telemetryWindow;
  if (!b || !b.width || !b.height) return null;
  const visible = screen.getAllDisplays().some(({ workArea: w }) => b.x < w.x + w.width - 80 && b.x + b.width > w.x + 80 && b.y >= w.y - 10 && b.y < w.y + w.height - 80);
  return visible ? b : null;
}

function rememberBounds() {
  if (!win || win.isDestroyed()) return;
  const maximized = win.isMaximized();
  const b = maximized ? (ctx.cfg.telemetryWindow || win.getNormalBounds()) : win.getBounds();
  ctx.cfg.telemetryWindow = { x: b.x, y: b.y, width: b.width, height: b.height, maximized };
  ctx.cfg.save();
}

function openTelemetry() {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return;
  }
  const b = savedBounds();
  win = new BrowserWindow({
    ...(b ? { x: b.x, y: b.y, width: b.width, height: b.height } : { width: 1400, height: 880 }),
    minWidth: 960, minHeight: 620,
    title: 'Overlap — Телеметрия',
    icon: path.join(__dirname, '..', '..', 'overlays', 'common', 'brand', 'icon.png'),
    backgroundColor: '#0E0F11',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0E0F11', symbolColor: '#8A9099', height: 40 },
    show: false,
    webPreferences: { preload: path.join(__dirname, 'telemetryPreload.js') },
  });
  logger.attachWindow(win, 'телеметрия');
  win.loadURL(`http://127.0.0.1:${ctx.port}/telemetry/`);
  win.once('ready-to-show', () => {
    if (b?.maximized) win.maximize();
    win.show();
  });
  let t = null;
  const later = () => { clearTimeout(t); t = setTimeout(rememberBounds, 400); };
  win.on('resize', later);
  win.on('move', later);
  win.on('maximize', rememberBounds);
  win.on('unmaximize', rememberBounds);
  win.on('close', rememberBounds);
  win.on('closed', () => {
    win = null;
    // процесс чтения больше не нужен: память от больших файлов освобождается
    lib?.stop();
  });
  library().scan();
}

function initTelemetry({ port, cfg }) {
  ctx = { port, cfg };
  ipcMain.handle('tlm-library', () => library().list());
  ipcMain.handle('tlm-rescan', () => { library().scan(); return true; });
  ipcMain.handle('tlm-lap', (_e, file, lap) => library().lap(file, lap));
  ipcMain.handle('tlm-track', (_e, file) => library().track(file));
  ipcMain.handle('tlm-import', (_e, paths) => library().importFiles(Array.isArray(paths) ? paths.filter((p) => typeof p === 'string') : []));
  ipcMain.handle('tlm-remove-ref', (_e, file) => library().removeRef(String(file)));
  ipcMain.handle('tlm-pick', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Добавить телеметрию', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Телеметрия и архивы с ней', extensions: ['ibt', 'duckdb', 'zip', '7z', 'rar'] }],
    });
    return r.canceled ? { added: [], skipped: [] } : library().importFiles(r.filePaths);
  });
  ipcMain.handle('tlm-open-folder', (_e, which) => {
    const d = library().list().dirs;
    const dir = which === 'refs' ? d.refs : which === 'lmu' ? d.lmu[0] : d.iracing;
    if (dir) { require('fs').mkdirSync(dir, { recursive: true }); shell.openPath(dir); }
    return !!dir;
  });
  // игра из панели (iRacing или LMU): окно показывает телеметрию только этой игры
  ipcMain.handle('tlm-settings', () => ({ ...(ctx.cfg.telemetry || {}), game: ctx.cfg.game === 'lmu' ? 'lmu' : 'iracing' }));
  ipcMain.on('tlm-settings-set', (_e, patch) => {
    if (!patch || typeof patch !== 'object') return;
    const { game, ...rest } = patch;
    ctx.cfg.telemetry = { ...(ctx.cfg.telemetry || {}), ...rest };
    ctx.cfg.save();
  });
}

module.exports = { initTelemetry, openTelemetry };
