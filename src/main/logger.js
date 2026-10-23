// Логи приложения: %APPDATA%\svoy-overlay\logs\overlap-ГГГГ-ММ-ДД.log (папка настроек называется так исторически).
// Пишем только то, что помогает найти поломку: запуск, смена источника данных, предупреждения и ошибки
// главного процесса и окон оверлеев. Личные пути заменяются на ~, повторяющиеся строки склеиваются.
const fs = require('fs');
const os = require('os');
const path = require('path');

const KEEP_FILES = 7;                 // сколько дней хранить
const MAX_FILE_BYTES = 3 * 1024 * 1024; // потолок одного дневного файла
const REPEAT_WINDOW_MS = 60_000;

let dir = null;
let verbose = false;
let last = { key: '', count: 0, at: 0, level: '' };
let stopped = false;                  // файл переполнен — дальше пишем только ошибки

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const clock = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

// Убираем из текста имя пользователя Windows и домашнюю папку
function redact(text) {
  let s = String(text);
  const home = os.homedir();
  if (home) s = s.split(home).join('~').split(home.replace(/\\/g, '/')).join('~');
  const user = os.userInfo().username;
  if (user && user.length > 2) s = s.replace(new RegExp(user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '<user>');
  return s;
}

const file = () => path.join(dir, `overlap-${stamp()}.log`);

function init(userDataDir) {
  dir = path.join(userDataDir, 'logs');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const old = fs.readdirSync(dir).filter((f) => /^overlap-.*\.log$/.test(f)).sort();
    for (const f of old.slice(0, Math.max(old.length - KEEP_FILES, 0))) fs.unlinkSync(path.join(dir, f));
  } catch { /* логи — не повод ронять приложение */ }
  return dir;
}

function flushRepeat() {
  if (last.count > 1) append(`${clock()} ${last.level.padEnd(5)} (то же сообщение повторилось ещё ${last.count - 1} раз)\n`, last.level);
  last = { key: '', count: 0, at: 0, level: '' };
}

function append(line, level) {
  if (!dir) return;
  try {
    const f = file();
    if (stopped && level !== 'ERROR') return;
    if (fs.existsSync(f) && fs.statSync(f).size > MAX_FILE_BYTES) {
      if (!stopped) { stopped = true; fs.appendFileSync(f, `${clock()} WARN  файл лога переполнен, дальше записываются только ошибки\n`); }
      if (level !== 'ERROR') return;
    }
    fs.appendFileSync(f, line);
  } catch { /* ничего */ }
}

function write(level, message) {
  const text = redact(message).replace(/\r?\n/g, '\n      ');
  const key = `${level}|${text}`;
  const now = Date.now();
  if (key === last.key && now - last.at < REPEAT_WINDOW_MS) { last.count++; return; }
  flushRepeat();
  last = { key, count: 1, at: now, level };
  append(`${clock()} ${level.padEnd(5)} ${text}\n`, level);
}

const fmt = (args) => args.map((a) => (a instanceof Error ? (a.stack || a.message) : typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(' ');

// Всё, что приложение печатает в консоль, попадает и в файл
function hookConsole() {
  for (const [method, level] of [['log', 'INFO'], ['info', 'INFO'], ['warn', 'WARN'], ['error', 'ERROR']]) {
    const orig = console[method].bind(console);
    console[method] = (...args) => { try { write(level, fmt(args)); } catch { /* ничего */ } try { orig(...args); } catch { /* ничего */ } };
  }
}

function installCrashHandlers() {
  process.on('uncaughtException', (e) => write('ERROR', `uncaughtException: ${e?.stack || e}`));
  process.on('unhandledRejection', (e) => write('ERROR', `unhandledRejection: ${e?.stack || e}`));
}

// Ошибки и сбои окон (оверлеи, панель): console.error/warn страниц, падения, зависания, не загрузилось
function attachWindow(win, label) {
  const wc = win.webContents;
  wc.on('console-message', (...args) => {
    // Electron 35+ шлёт один объект, раньше — позиционные аргументы
    const ev = args[0] || {};
    const level = typeof ev.level === 'string' ? ev.level : ['verbose', 'info', 'warning', 'error'][args[1]] ?? 'info';
    const message = String(ev.message ?? args[2] ?? '');
    if (/Electron Security Warning/.test(message)) return; // только в режиме разработки, не помогает искать поломки
    const source = (ev.sourceId ?? args[4] ?? '').toString().split('/').slice(-2).join('/');
    const line = ev.lineNumber ?? args[3];
    if (level === 'error') write('ERROR', `[${label}] ${message}${source ? ` (${source}:${line})` : ''}`);
    else if (level === 'warning') write('WARN', `[${label}] ${message}`);
    else if (verbose) write('DEBUG', `[${label}] ${message}`);
  });
  wc.on('did-fail-load', (_e, code, desc, url) => write('ERROR', `[${label}] не загрузилось ${url}: ${desc} (${code})`));
  wc.on('render-process-gone', (_e, d) => write('ERROR', `[${label}] процесс окна завершился: ${d.reason} (код ${d.exitCode})`));
  win.on('unresponsive', () => write('WARN', `[${label}] окно не отвечает`));
  win.on('responsive', () => write('INFO', `[${label}] окно снова отвечает`));
}

function setVerbose(v) { verbose = !!v; }
const debug = (msg) => { if (verbose) write('DEBUG', msg); };

// Последние строки логов (сегодняшний файл, при нехватке — вчерашний)
function tail(lines = 400) {
  if (!dir) return '';
  flushRepeat();
  try {
    const files = fs.readdirSync(dir).filter((f) => /^overlap-.*\.log$/.test(f)).sort().reverse();
    let out = [];
    for (const f of files) {
      out = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).concat(out);
      if (out.length >= lines) break;
    }
    return out.slice(-lines).join('\n');
  } catch { return ''; }
}

// Отчёт для отправки: окружение, краткая сводка настроек и хвост лога
function buildReport({ app, screen, cfg, status }) {
  const displays = screen.getAllDisplays().map((d) => `${d.size.width}×${d.size.height} @${d.scaleFactor}`).join(', ');
  const overlays = [];
  for (const l of cfg.layouts || []) {
    for (const o of l.overlays || []) overlays.push(`${o.type}${o.enabled ? '' : ' (выкл)'} ${o.width}×${o.height}`);
  }
  const lines = [
    '=== Overlap: отчёт ===',
    `Версия: ${app.getVersion()}   Electron ${process.versions.electron}, Chrome ${process.versions.chrome}, Node ${process.versions.node}`,
    `Система: ${os.type()} ${os.release()} ${os.arch()}, RAM ${(os.totalmem() / 2 ** 30).toFixed(1)} ГБ`,
    `Экраны: ${displays}`,
    `Работает: ${Math.round(process.uptime() / 60)} мин   Портативная сборка: ${process.env.PORTABLE_EXECUTABLE_FILE ? 'да' : 'нет'}`,
    `Источник данных: ${status ? JSON.stringify(status) : 'нет данных'}`,
    `Настройки: демо=${cfg.demo}, автовыбор раскладки=${cfg.autoSwitch}, закреплены=${cfg.locked}, скрыты все=${cfg.hiddenAll}, ливреи=${cfg.liveries?.enabled ? 'вкл' : 'выкл'}`,
    `Раскладок: ${(cfg.layouts || []).length}; оверлеи: ${overlays.join('; ') || 'нет'}`,
    '',
    '=== Последние строки лога ===',
    tail(400) || '(лог пуст)',
    '',
  ];
  return redact(lines.join('\n'));
}

module.exports = { init, write, debug, hookConsole, installCrashHandlers, attachWindow, setVerbose, tail, buildReport, getDir: () => dir, redact };
