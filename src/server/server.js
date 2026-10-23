// Сервер телеметрии: читает iRacing (или демо), считает модели и раздаёт их по WebSocket.
//   HTTP:  http://127.0.0.1:<port>/relative/   /standings/   — страницы оверлеев (работают и в OBS/браузере)
//   WS:    ws://127.0.0.1:<port>/ws/relative   /ws/standings   /ws/weather   /ws/digiflag   /ws/radar   /ws/dash   /ws/sectors   /ws/laps
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { IRacingSdk } = require('../telemetry/irsdk');
const { DemoSource } = require('../telemetry/demo');
const { TELEMETRY_VARS, simContext } = require('../model/common');
const { buildRaceState } = require('../model/race');
const { buildRelative } = require('../model/relative');
const { buildStandings } = require('../model/standings');
const { buildInfo } = require('../model/info');
const { buildWeather } = require('../model/weather');
const { buildFlags } = require('../model/flags');
const { buildRadar } = require('../model/radar');
const { buildDash } = require('../model/dash');
const { buildSectors } = require('../model/sectors');
const { buildLaps } = require('../model/laps');

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
  dash: (race) => ({ ...buildDash(race), info: buildInfo(race) }),
  sectors: (race) => buildSectors(race),
  laps: (race) => buildLaps(race),
};

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
  let demo = null;
  let lastOpenAttempt = 0;
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
      if (lastMessages[name]) ws.send(lastMessages[name]);
      ws.on('close', () => clients.get(name).delete(ws));
    });
  });

  const lastMessages = {};
  let status = { source: 'none', connected: false };

  function readSnapshot() {
    let snap = null;
    if (opts.demo !== 'on') {
      // переоткрываем общую память не чаще раза в 2 с, если iRacing ещё не запускался
      if (sdk.ptr || Date.now() - lastOpenAttempt > 2000) {
        lastOpenAttempt = Date.now();
        try {
          snap = sdk.read(TELEMETRY_VARS);
        } catch (e) {
          console.warn('[irsdk] read failed:', e.message);
          sdk.close();
        }
      }
    }
    if (snap?.connected && snap.session) {
      if (snap.sessionVersion !== lastSessionVersion) {
        lastSessionVersion = snap.sessionVersion;
        lastSession = { session: snap.session, loadNumTextures: !!snap.vars.LoadNumTextures };
        for (const fn of sessionListeners) {
          try { fn(snap.session, !!snap.vars.LoadNumTextures); } catch (e) { console.error('[server] session listener:', e); }
        }
      }
      return { ...snap, source: 'iracing' };
    }
    if (opts.demo === 'on' || opts.demo === 'auto') {
      demo = demo || new DemoSource();
      return { ...demo.read(), source: 'demo' };
    }
    return { connected: false, source: 'none' };
  }

  function tick() {
    const snap = readSnapshot();
    // Состояние сима (машина, сессия, на трассе/в боксах) — по нему главный процесс выбирает раскладку
    const next = { source: snap.source, connected: !!snap.connected, ...(snap.connected && snap.session ? simContext(snap) : {}) };
    if (JSON.stringify(next) !== JSON.stringify(status)) {
      status = next;
      console.log(`[server] ${JSON.stringify(status)}`);
      listeners.forEach((fn) => fn(status));
    }

    let race = null;
    if (snap.connected) {
      try {
        race = buildRaceState(snap);
      } catch (e) {
        console.error('[server] model error:', e);
      }
    }
    for (const [name, build] of Object.entries(CHANNELS)) {
      const subs = clients.get(name);
      if (!subs.size) { delete lastMessages[name]; continue; }
      const msg = JSON.stringify(race
        ? { type: 'model', source: snap.source, data: build(race, opts) }
        : { type: 'model', source: snap.source, data: null });
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
