// Обновления: проверка новых версий на GitHub, скачивание и установка, список «Что нового» из описаний релизов.
// Установленная версия (NSIS) обновляется сама через electron-updater (нужны файлы latest.yml, .exe и .blockmap в релизе).
// Portable и запуск из исходников обновить сами не могут: для них только сообщение о новой версии и ссылка на релиз.
const { app, net } = require('electron');

const OWNER = 'missserrry';
const REPO = 'overlap-overlay';
const CHECK_EVERY = 4 * 60 * 60_000;

let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch (e) { console.warn('[updater] electron-updater недоступен:', e.message); }

const canAuto = !!autoUpdater && app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR;
let onChange = () => {};
let timer = null;
let releases = [];       // [{ version, name, date, body, url }]
let releasesError = null;
const state = { status: 'idle', version: null, progress: 0, error: null, url: null, checkedAt: null };

const set = (patch) => {
  if (patch.status && patch.status !== state.status) console.log(`[updater] ${state.status} → ${patch.status}${patch.version ? ` (${patch.version})` : ''}${patch.error ? `: ${patch.error}` : ''}`);
  Object.assign(state, patch);
  onChange();
  if (patch.status === 'error') scheduleRetry();
};

// Ошибка проверки (нет сети, GitHub не ответил): пробуем ещё раз через несколько минут, но не больше трёх раз подряд
let retries = 0, retryTimer = null;
function scheduleRetry() {
  if (retries >= 3 || retryTimer) return;
  retries++;
  retryTimer = setTimeout(() => { retryTimer = null; if (state.status === 'error') check(); }, 3 * 60_000);
}

// «0.4.3» → [0, 4, 3]; сравнение версий
const parts = (v) => String(v || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
function newer(a, b) {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

async function fetchReleases() {
  try {
    const res = await net.fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=20`, { headers: { 'User-Agent': 'Overlap', Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`GitHub ответил ${res.status}`);
    const list = await res.json();
    releases = list.filter((r) => !r.draft).map((r) => ({
      version: String(r.tag_name || '').replace(/^v/i, ''), name: r.name || r.tag_name, date: r.published_at, body: r.body || '', url: r.html_url,
    }));
    releasesError = null;
  } catch (e) {
    releasesError = e.message;
  }
  onChange();
}

// Новая версия без электрон-апдейтера: сравниваем с последним релизом
async function checkManual() {
  await fetchReleases();
  const latest = releases[0];
  if (releasesError) return set({ status: 'error', error: releasesError, checkedAt: Date.now() });
  if (latest && newer(latest.version, app.getVersion())) set({ status: 'manual', version: latest.version, url: latest.url, checkedAt: Date.now() });
  else set({ status: 'none', version: null, checkedAt: Date.now() });
}

async function check() {
  if (['checking', 'downloading', 'ready'].includes(state.status)) return;
  console.log(`[updater] проверка (текущая ${app.getVersion()}, ${canAuto ? 'автообновление' : 'только уведомление'})`);
  set({ status: 'checking', error: null });
  if (!canAuto) return checkManual();
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    set({ status: 'error', error: e.message, checkedAt: Date.now() });
  }
  fetchReleases();
}

function init(onStateChange, isEnabled) {
  onChange = onStateChange;
  if (canAuto) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-available', (info) => { retries = 0; set({ status: 'available', version: info.version, checkedAt: Date.now() }); });
    autoUpdater.on('update-not-available', () => { retries = 0; set({ status: 'none', version: null, checkedAt: Date.now() }); });
    autoUpdater.on('download-progress', (p) => set({ status: 'downloading', progress: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', version: info.version, progress: 100 }));
    autoUpdater.on('error', (e) => set({ status: 'error', error: String(e?.message || e), checkedAt: Date.now() }));
  }
  fetchReleases();
  // автоматическая проверка: через 20 секунд после запуска и дальше раз в несколько часов
  const auto = () => { if (isEnabled()) check(); };
  setTimeout(auto, 20_000);
  timer = setInterval(auto, CHECK_EVERY);
}

function download() {
  if (!canAuto || state.status !== 'available') return;
  set({ status: 'downloading', progress: 0 });
  autoUpdater.downloadUpdate().catch((e) => set({ status: 'error', error: e.message }));
}

function install() {
  if (canAuto && state.status === 'ready') autoUpdater.quitAndInstall(false, true);
}

const snapshot = () => ({ ...state, canAuto, current: app.getVersion(), releases, releasesError });

module.exports = { init, check, download, install, snapshot, fetchReleases, stop: () => clearInterval(timer) };
