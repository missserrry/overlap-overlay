// Настройки приложения и раскладки. Хранятся в %APPDATA%/svoy-overlay/config.json.
const fs = require('fs');
const path = require('path');
const P = require('./palette');
const { createLayout, createOverlay, ensureLayoutTypes, normalizeColumns, normalizeHf, normalizeCards, normalizeDash, normalizeSectors, normalizeLaps, normalizeRejoin, normalizeFuel, normalizePitlimit, normalizeSr, normalizeForecast, normalizeRadarbars, normalizeSizes, normalizeDecimals, normalizeLicMode, normalizeRel, normalizeTraffic } = require('./layouts');

const DEFAULTS = {
  port: 8900,
  demo: 'auto',            // auto | on | off
  gameChosen: false,       // пользователь уже выбирал игру (или был до этого экрана): стартовый выбор показываем один раз
  game: 'iracing',         // для какой игры оверлеи: iracing | lmu (см. GAMES в layouts.js)
  autoSwitch: true,        // выбирать раскладку по машине/сессии
  locked: true,            // оверлеи закреплены (клики проходят в игру)
  hiddenAll: false,
  onlyWhenFocused: true,   // оверлеи видны, только когда на переднем плане iRacing
  autoUpdate: true,        // проверять обновления сами
  lastSeenVersion: null,   // для окна «Что нового» после обновления
  verboseLog: false,       // подробные логи (для поиска сложных поломок)
  activeLayoutId: null,    // выбранная вручную (если автопереключение выключено или ничего не подошло)
  palette: null,           // цвета оверлеев (см. palette.js)
  layouts: null,
};

function defaultLayouts(oldOverlays) {
  // Перенос позиций из первой версии (overlays: {relative:{x,y,...}, standings:{...}})
  const fromOld = (type, fallback) => {
    const o = createOverlay(type, fallback);
    const old = oldOverlays?.[type];
    if (old) Object.assign(o, { x: old.x, y: old.y, width: old.width, height: old.height, zoom: old.zoom ?? 1, enabled: old.enabled !== false });
    return o;
  };
  const main = createLayout('Основная', [
    fromOld('standings', { x: 40, y: 40 }),
    fromOld('relative', { x: 500, y: 40 }),
  ]);
  main.isDefault = true;
  ensureLayoutTypes(main);
  return [main];
}

function load(dir) {
  const file = path.join(dir, 'config.json');
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { /* первый запуск */ }

  const cfg = { ...DEFAULTS, ...saved };
  // чистая установка: настроек ещё нет — на первом запуске предложим выбрать игру; у тех, кто уже пользуется, не спрашиваем
  if (typeof saved.gameChosen !== 'boolean') cfg.gameChosen = Object.keys(saved).length > 0;
  if (!Array.isArray(cfg.layouts) || !cfg.layouts.length) cfg.layouts = defaultLayouts(saved.overlays);
  delete cfg.overlays;
  cfg.palette = P.normalize(cfg.palette);
  // у оверлеев из старых конфигов колонок ещё нет
  for (const l of cfg.layouts) {
    ensureLayoutTypes(l);
    const lists = [l.overlays, ...Object.values(l.variations || {}).map((v) => v?.overlays)];
    for (const list of lists) for (const o of list || []) {
      o.columns = normalizeColumns(o.type, o.columns);
      o.header = normalizeHf(o.type, 'header', o.header);
      o.footer = normalizeHf(o.type, 'footer', o.footer);
      o.cards = normalizeCards(o.type, o.cards);
      o.sizes = (o.type === 'relative' || o.type === 'standings') ? normalizeSizes(o.sizes) : {};
      o.decimals = (o.type === 'relative' || o.type === 'standings') ? normalizeDecimals(o.decimals) : {};
      o.licMode = (o.type === 'relative' || o.type === 'standings') ? normalizeLicMode(o.licMode) : 'full';
      if (o.type === 'dash') o.dash = normalizeDash(o.dash);
      if (o.type === 'sectors') o.sectors = normalizeSectors(o.sectors);
      if (o.type === 'laps') o.laps = normalizeLaps(o.laps);
      if (o.type === 'rejoin') o.rejoin = normalizeRejoin(o.rejoin);
      if (o.type === 'fuel') o.fuel = normalizeFuel(o.fuel);
      if (o.type === 'relative') o.rel = normalizeRel(o.rel);
      if (o.type === 'traffic') o.traffic = normalizeTraffic(o.traffic);
      if (o.type === 'pitlimit') o.pitlimit = normalizePitlimit(o.pitlimit);
      if (o.type === 'sr') o.sr = normalizeSr(o.sr);
      if (o.type === 'forecast') o.forecast = normalizeForecast(o.forecast);
      if (o.type === 'radarbars') o.radarbars = normalizeRadarbars(o.radarbars);
    }
  }

  let timer = null;
  cfg.save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const { save, ...data } = cfg;
      fs.mkdirSync(dir, { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, file);
    }, 300);
  };
  return cfg;
}

module.exports = { load };
