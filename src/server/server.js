// Сервер телеметрии: читает iRacing (или демо), считает модели и раздаёт их по WebSocket.
//   HTTP:  http://127.0.0.1:<port>/relative/   /standings/   — страницы оверлеев (работают и в OBS/браузере)
//   WS:    ws://127.0.0.1:<port>/ws/relative   /ws/standings   /ws/weather   /ws/digiflag   /ws/radar   /ws/dash   /ws/sectors   /ws/laps   /ws/rejoin   /ws/fuel   /ws/pitlimit   /ws/traffic   /ws/sr   /ws/forecast   /ws/radarbars
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { IRacingSdk } = require('../telemetry/irsdk');
const { LmuSdk } = require('../telemetry/lmu');
const { DemoSource } = require('../telemetry/demo');
const { TELEMETRY_VARS, simContext } = require('../model/common');
const { buildRaceState } = require('../model/race');
const { buildRelative } = require('../model/relative');
const { buildStandings } = require('../model/standings');
const { buildInfo } = require('../model/info');
const { buildWeather } = require('../model/weather');
const { buildFlags } = require('../model/flags');
const { buildRadar, buildRadarBars } = require('../model/radar');
const { buildDash } = require('../model/dash');
const { buildSectors } = require('../model/sectors');
const { buildLaps } = require('../model/laps');
const { buildRejoin } = require('../model/rejoin');
const { buildFuel, setFuelStore } = require('../model/fuel');
const { buildPit } = require('../model/pitlimit');
const { buildTraffic } = require('../model/traffic');
const { SrTracker } = require('../model/sr');
const { ForecastTracker } = require('../model/forecast');

const ROOT = path.resolve(__dirname, '..', '..');
const STATIC_DIRS = {
  '/fonts/': path.join(ROOT, 'node_modules', '@fontsource', 'montserrat', 'files'),
  '/vendor/inter/': path.join(ROOT, 'node_modules', '@fontsource-variable', 'inter', 'files'),
  '/vendor/mono/': path.join(ROOT, 'node_modules', '@fontsource', 'jetbrains-mono', 'files'),
  '/vendor/icons/': path.join(ROOT, 'node_modules', 'lucide-static', 'icons'),
  '/': path.join(ROOT, 'overlays'),
};
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
};

const CHANNELS = {
  relative: (race, opts) => ({ ...buildRelative(race, opts.relative), info: buildInfo(race) }),
  standings: (race, opts) => ({ ...buildStandings(race, opts.standings), info: buildInfo(race) }),
  weather: (race) => buildWeather(race),
  digiflag: (race) => buildFlags(race),
  radar: (race) => buildRadar(race),
  radarbars: (race) => buildRadarBars(race),
  dash: (race) => ({ ...buildDash(race), info: buildInfo(race) }),
  sectors: (race) => buildSectors(race),
  laps: (race) => buildLaps(race),
  rejoin: (race) => buildRejoin(race),
  fuel: (race) => buildFuel(race),
  pitlimit: (race) => buildPit(race),
  traffic: (race) => buildTraffic(race),
  // к оценке SR — прогноз iRating игрока: в оверлее их можно показать вместе
  forecast: (race, opts, sr, fc) => fc.frame(),
  sr: (race, opts, sr) => ({ ...sr.frame(), kind: race.kind, irDelta: race.kind === 'race' ? (playerCar(race)?.iratingDelta ?? null) : null, iratingNow: playerCar(race)?.irating ?? null }),
};

const playerCar = (race) => race.cars.find((c) => c.carIdx === race.vars?.PlayerCarIdx) || null;

function startServer(options = {}) {
  const opts = {
    port: 8900,
    rateHz: 15,
    demo: 'auto', // 'auto' — демо, пока iRacing не в сессии; 'on' — всегда демо; 'off' — только живые данные
    relative: {},
    standings: {},
    ...options,
  };

  const sdk = new IRacingSdk();
  const lmu = new LmuSdk();
  // оценка SR копит повороты на каждом тике, даже без открытого окна оверлея
  setFuelStore(opts.fuelStateFile || null);
  const srTracker = new SrTracker({ stateFile: opts.srStateFile || null, learnedFile: opts.srLearnedFile || null });
  const forecastTracker = new ForecastTracker();
  let demo = null;
  let lastOpenAttempt = 0, lastLmuAttempt = 0;
  const listeners = new Set();
  const sessionListeners = new Set(); // новый сессионный YAML живого iRacing (для загрузки ливрей)
  let lastSessionVersion = -1;
  let lastSession = null;

  const server = http.createServer((req, res) => serveStatic(req, res));
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Map(Object.keys(CHANNELS).map((k) => [k, new Set()]));

  server.on('upgrade', (req, socket, head) => {
    const name = (req.url || '').split('?')[0].replace(/^\/ws\//, '');
    if (!clients.has(name)) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => {
      clients.get(name).add(ws);
      debug(`[server] канал ${name}: страница подключилась (${clients.get(name).size})`);
      if (lastMessages[name]) ws.send(lastMessages[name]);
      ws.on('close', () => { clients.get(name).delete(ws); debug(`[server] канал ${name}: страница отключилась (${clients.get(name).size})`); });
    });
  });

  const lastMessages = {};
  let status = { source: 'none', connected: false };

  // Здоровье каналов (по одному на оверлей): сколько страниц подключено, когда последний раз данные ушли без ошибки,
  // какая была последняя ошибка модели. Идёт в отчёт и в сторожа главного процесса.
  const debug = opts.debug || (() => {});
  const health = new Map(Object.keys(CHANNELS).map((k) => [k, { errors: 0, failing: false, lastError: '', lastOkAt: 0 }]));
  function markOk(name) {
    const h = health.get(name);
    h.lastOkAt = Date.now();
    if (h.failing) { h.failing = false; console.log(`[server] канал ${name}: снова работает`); }
  }
  function markError(name, e) {
    const h = health.get(name);
    h.errors++;
    h.lastError = String(e?.message || e);
    if (!h.failing) { h.failing = true; console.error(`[server] канал ${name}: ошибка модели, оверлей не обновляется: ${e?.stack || e}`); }
  }

  // переоткрываем общую память не чаще раза в 2 с, если игра ещё не запускалась
  function readIracing() {
    if (!(sdk.ptr || Date.now() - lastOpenAttempt > 2000)) return null;
    lastOpenAttempt = Date.now();
    try {
      return sdk.read(TELEMETRY_VARS);
    } catch (e) {
      console.warn('[irsdk] read failed:', e.message);
      sdk.close();
      return null;
    }
  }
  function readLmu() {
    if (!(lmu.ptr || Date.now() - lastLmuAttempt > 2000)) return null;
    lastLmuAttempt = Date.now();
    try {
      return lmu.read();
    } catch (e) {
      console.warn('[lmu] read failed:', e.message);
      lmu.close();
      return null;
    }
  }

  function readSnapshot() {
    let snap = null;
    if (opts.demo !== 'on') {
      // сначала источник выбранной игры, потом другой: если запущена только одна игра, находится именно она
      const order = (typeof opts.game === 'function' ? opts.game() : opts.game) === 'lmu'
        ? [['lmu', readLmu], ['iracing', readIracing]] : [['iracing', readIracing], ['lmu', readLmu]];
      for (const [source, read] of order) {
        const got = read();
        if (got?.connected && got.session) { snap = { ...got, source }; break; }
      }
    }
    if (snap) {
      if (snap.sessionVersion !== lastSessionVersion) {
        lastSessionVersion = snap.sessionVersion;
        lastSession = { session: snap.session, loadNumTextures: !!snap.vars.LoadNumTextures };
        for (const fn of sessionListeners) {
          try { fn(snap.session, !!snap.vars.LoadNumTextures); } catch (e) { console.error('[server] session listener:', e); }
        }
      }
      return snap;
    }
    if (opts.demo === 'on' || opts.demo === 'auto') {
      demo = demo || new DemoSource();
      return { ...demo.read(), source: 'demo' };
    }
    return { connected: false, source: 'none' };
  }

  // Пролаг интернета: на мгновение пропадают и ваша машина, и остальные пилоты (или сим отдаёт пустое состояние). Чтобы оверлеи
  // не мигали, на HOLD_MS замираем на последнем нормальном кадре; если провал затянулся — показываем как есть.
  const HOLD_MS = 6000;
  const goodMsgs = {};
  let goodStatus = null, goodAt = 0, lostSince = null;

  function tick() {
    const snap = readSnapshot();
    const now = Date.now();
    let race = null;
    if (snap.connected) {
      try {
        race = buildRaceState(snap);
        race.sr = srTracker.frame();   // оценка SR — для пунктов шапки и подвала
      } catch (e) {
        console.error('[server] model error:', e);
      }
    }
    const healthy = (snap.source === 'iracing' || snap.source === 'lmu') && !!race && !!race.ref && race.ref.inWorld;
    if (healthy) { lostSince = null; goodAt = now; }
    else if (goodAt && lostSince == null) lostSince = now;
    const holding = !healthy && goodAt > 0 && lostSince != null && now - lostSince < HOLD_MS;
    if (!healthy && !holding) goodAt = 0;     // удержание закончилось: дальше как есть, пока снова не появятся нормальные данные

    // Состояние сима (машина, сессия, на трассе/в боксах) — по нему главный процесс выбирает раскладку
    const next = holding && goodStatus ? goodStatus : { source: snap.source, connected: !!snap.connected, ...(snap.connected && snap.session ? simContext(snap) : {}) };
    if (healthy) goodStatus = next;
    if (JSON.stringify(next) !== JSON.stringify(status)) {
      status = next;
      console.log(`[server] ${JSON.stringify(status)}`);
      listeners.forEach((fn) => fn(status));
    }

    // SR и прогноз — только iRacing (у LMU своих рейтингов нет)
    const rated = snap.source === 'iracing' ? snap : { connected: false, source: snap.source };
    try { srTracker.update(rated); } catch (e) { console.error('[server] sr error:', e); }
    try { forecastTracker.update(rated); } catch (e) { console.error('[server] forecast error:', e); }

    for (const [name, build] of Object.entries(CHANNELS)) {
      const subs = clients.get(name);
      if (!subs.size) { delete lastMessages[name]; continue; }
      let msg;
      try {
        msg = JSON.stringify(race
          ? { type: 'model', source: snap.source, data: build(race, opts, srTracker, forecastTracker) }
          : { type: 'model', source: snap.source, data: null });
      } catch (e) {
        markError(name, e);   // этот оверлей остаётся с прошлыми данными, остальные продолжают работать
        continue;
      }
      markOk(name);
      if (healthy) goodMsgs[name] = msg;
      else if (holding && goodMsgs[name]) msg = goodMsgs[name];
      lastMessages[name] = msg;
      for (const ws of subs) if (ws.readyState === 1) ws.send(msg);
    }
  }

  const timer = setInterval(tick, Math.round(1000 / opts.rateHz));

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, '127.0.0.1', () => {
      console.log(`[server] http://127.0.0.1:${opts.port}/  (demo=${opts.demo})`);
      resolve({
        port: opts.port,
        get status() { return status; },
        onStatus(fn) { listeners.add(fn); },
        onSession(fn) { sessionListeners.add(fn); },
        get lastSession() { return lastSession; },
        health() {
          const now = Date.now();
          return Object.fromEntries([...health].map(([k, h]) => [k, {
            clients: clients.get(k).size, errors: h.errors, failing: h.failing, lastError: h.lastError,
            okAgo: h.lastOkAt ? Math.round((now - h.lastOkAt) / 1000) : null,
          }]));
        },
        setDemo(mode) { opts.demo = mode; },
        get demoMode() { return opts.demo; },
        close() { clearInterval(timer); wss.close(); server.close(); sdk.close(); },
      });
    });
  });
}

function serveStatic(req, res) {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url.endsWith('/')) url += 'index.html';
  for (const [prefix, dir] of Object.entries(STATIC_DIRS)) {
    if (!url.startsWith(prefix)) continue;
    const file = path.join(dir, url.slice(prefix.length));
    if (!file.startsWith(dir)) break;
    return fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  }
  res.writeHead(404); res.end('not found');
}

module.exports = { startServer };
