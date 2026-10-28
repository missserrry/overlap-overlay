// Библиотека телеметрии для окна «Телеметрия»: где лежат файлы, что в них (машина, трасса, круги) и чтение кругов.
//   iRacing — Документы\iRacing\telemetry\*.ibt (пишутся сами при irsdkAutoLogDisk=1 или по Alt+L);
//   LMU     — <папка игры>\UserData\Telemetry\*.duckdb (игра пишет сама, если включена запись телеметрии);
//   Эталоны — файлы, которые пользователь перетащил сам (телеметрия сетаперов и т. п.): копируем к себе в userData.
// Описание файлов кешируется в telemetry-index.json по размеру и дате изменения: повторный запуск ничего не перечитывает.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { utilityProcess } = require('electron');
const { kindOf } = require('./session');

const LMU_SUB = path.join('steamapps', 'common', 'Le Mans Ultimate', 'UserData', 'Telemetry');
const INDEX_VERSION = 1;
const ARCHIVES = new Set(['.zip', '.7z', '.rar']);
const TELEMETRY_EXT = new Set(['.ibt', '.duckdb']);

class TelemetryLibrary {
  /**
   * @param {object} o
   * @param {string} o.documents  папка «Документы»
   * @param {string} o.userData   папка настроек приложения
   * @param {() => void} o.onChange  список файлов или их описание поменялись
   */
  constructor({ documents, userData, onChange }) {
    this.iracingDir = path.join(documents, 'iRacing', 'telemetry');
    this.refsDir = path.join(userData, 'telemetry-refs');
    this.indexFile = path.join(userData, 'telemetry-index.json');
    this.onChange = onChange || (() => {});
    this.lmuDirs = [];
    this.index = this.loadIndex();
    this.files = [];      // [{ file, group: 'iracing'|'lmu'|'refs', size, mtime }]
    this.scanning = false;
    this.worker = null;
    this.pending = new Map();
    this.seq = 0;
  }

  loadIndex() {
    try {
      const j = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
      if (j.version === INDEX_VERSION) return j.files || {};
    } catch { /* индекса ещё нет */ }
    return {};
  }

  saveIndex() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try { fs.writeFileSync(this.indexFile, JSON.stringify({ version: INDEX_VERSION, files: this.index })); } catch (e) { console.warn('[telemetry] индекс не сохранён:', e.message); }
    }, 500);
  }

  // ---------- процесс-читатель ----------

  call(msg) {
    if (!this.worker) {
      this.worker = utilityProcess.fork(path.join(__dirname, 'worker.js'), [], { serviceName: 'Overlap Telemetry' });
      this.worker.on('message', (m) => {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.ok) p.resolve(m.data); else p.reject(new Error(m.error));
      });
      this.worker.on('exit', (code) => {
        if (code) console.warn(`[telemetry] процесс чтения завершился с кодом ${code}`);
        this.worker = null;
        for (const p of this.pending.values()) p.reject(new Error('процесс чтения телеметрии остановился'));
        this.pending.clear();
      });
    }
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...msg, id });
    });
  }

  // окно закрыли: описание файлов дочитаем при следующем открытии
  stop() {
    this.stopped = true;
    this.again = false;
    try { this.worker?.kill(); } catch { /* уже остановлен */ }
    this.worker = null;
  }

  // ---------- папки ----------

  // Папки телеметрии LMU во всех библиотеках Steam (путь Steam — из реестра, библиотеки — из libraryfolders.vdf)
  async findLmuDirs() {
    const steam = await new Promise((resolve) => {
      execFile('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true }, (err, out) => {
        const m = !err && String(out).match(/SteamPath\s+REG_SZ\s+(.+)/);
        resolve(m ? m[1].trim().replace(/\//g, '\\') : 'C:\\Program Files (x86)\\Steam');
      });
    });
    const libs = new Set([steam]);
    try {
      const vdf = fs.readFileSync(path.join(steam, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(m[1].replace(/\\\\/g, '\\'));
    } catch { /* Steam не найден */ }
    return [...libs].map((l) => path.join(l, LMU_SUB)).filter((d) => fs.existsSync(d));
  }

  listDir(dir, group) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return []; }
    const out = [];
    for (const name of names) {
      if (!kindOf(name)) continue;
      const file = path.join(dir, name);
      try {
        const st = fs.statSync(file);
        if (st.size < 4096) continue;
        out.push({ file, group, size: st.size, mtime: st.mtimeMs });
      } catch { /* файл пропал */ }
    }
    return out;
  }

  // Найти все файлы и описать новые (по одному, в фоне). Описание приходит в окно по мере готовности.
  async scan() {
    if (this.scanning) { this.again = true; return; }
    this.scanning = true;
    this.again = false;
    this.stopped = false;
    try {
      this.lmuDirs = await this.findLmuDirs();
      this.files = [
        ...this.listDir(this.iracingDir, 'iracing'),
        ...this.lmuDirs.flatMap((d) => this.listDir(d, 'lmu')),
        ...this.listDir(this.refsDir, 'refs'),
      ].sort((a, b) => b.mtime - a.mtime);
      this.onChange();
      for (const f of this.files) {
        if (this.stopped) break;
        const key = f.file;
        const cached = this.index[key];
        if (cached && cached.size === f.size && cached.mtime === f.mtime) continue;
        // LMU ещё пишет этот файл: опишем, когда игра его допишет
        if (f.group === 'lmu' && fs.existsSync(`${f.file}.wal`) && Date.now() - f.mtime < 10 * 60 * 1000) continue;
        try {
          const info = await this.call({ op: 'summary', file: f.file });
          this.index[key] = { size: f.size, mtime: f.mtime, info };
        } catch (e) {
          if (this.stopped) break;
          this.index[key] = { size: f.size, mtime: f.mtime, error: e.message };
        }
        this.saveIndex();
        this.onChange();
      }
    } finally {
      this.scanning = false;
      this.onChange();
    }
    if (this.again && !this.stopped) this.scan();
  }

  // Список для окна: файл, группа и описание (или null, пока не прочитан)
  list() {
    return {
      scanning: this.scanning,
      dirs: { iracing: this.iracingDir, lmu: this.lmuDirs, refs: this.refsDir },
      files: this.files.map((f) => {
        const ix = this.index[f.file];
        const fresh = ix && ix.size === f.size && ix.mtime === f.mtime;
        return { file: f.file, group: f.group, size: f.size, mtime: f.mtime, info: fresh ? ix.info || null : null, error: fresh ? ix.error || null : null };
      }),
    };
  }

  lap(file, lap) {
    return this.call({ op: 'lap', file, lap });
  }

  track(file) {
    return this.call({ op: 'track', file });
  }

  // Быстрейший круг файла: засчитанный, а если таких нет — любой полный. Для эталона режима «Тренировка».
  async bestLap(file) {
    const s = await this.call({ op: 'summary', file });
    const pool = (l) => s.laps.filter(l).sort((a, b) => a.time - b.time)[0];
    const best = pool((l) => l.valid && l.time > 0) || pool((l) => l.complete && l.time > 0);
    return best ? { summary: s, lap: best } : null;
  }

  // Эталоны: копируем перетащенные файлы к себе, чтобы они не пропали вместе с папкой загрузок.
  // Из архивов (.zip, .7z, .rar — так телеметрию раздают сетаперы) забираем только файлы телеметрии.
  async importFiles(paths) {
    fs.mkdirSync(this.refsDir, { recursive: true });
    const added = [], skipped = [];
    const free = (name) => {
      let dest = path.join(this.refsDir, name);
      for (let k = 2; fs.existsSync(dest); k++) dest = path.join(this.refsDir, `${path.parse(name).name} (${k})${path.extname(name)}`);
      return dest;
    };
    for (const p of paths) {
      const ext = path.extname(p).toLowerCase();
      if (ARCHIVES.has(ext)) {
        try {
          const { readZip, readWith7z } = require('../../setups/installer');
          const buf = fs.readFileSync(p);
          const entries = ext === '.zip' ? readZip(buf) : await readWith7z(buf, ext, TELEMETRY_EXT);
          const found = entries.filter((e) => kindOf(e.name));
          if (!found.length) { skipped.push(`${path.basename(p)} (в архиве нет телеметрии)`); continue; }
          for (const e of found) {
            const dest = free(path.basename(e.name.replace(/\\/g, '/')));
            fs.writeFileSync(dest, e.read());
            added.push(dest);
          }
        } catch (err) {
          skipped.push(`${path.basename(p)} (${err.message})`);
        }
        continue;
      }
      if (!kindOf(p)) { skipped.push(path.basename(p)); continue; }
      let dest = path.join(this.refsDir, path.basename(p));
      if (path.resolve(p) !== path.resolve(dest)) {
        dest = free(path.basename(p));
        fs.copyFileSync(p, dest);
        if (fs.existsSync(`${p}.wal`)) fs.copyFileSync(`${p}.wal`, `${dest}.wal`);
      }
      added.push(dest);
    }
    this.scan();
    return { added, skipped };
  }

  removeRef(file) {
    if (path.dirname(path.resolve(file)) !== path.resolve(this.refsDir)) return false;
    for (const f of [file, `${file}.wal`]) try { fs.rmSync(f, { force: true }); } catch { /* уже нет */ }
    delete this.index[file];
    this.saveIndex();
    this.scan();
    return true;
  }
}

module.exports = { TelemetryLibrary };
