// Отдельный процесс для чтения файлов телеметрии (Electron utilityProcess): файл .ibt бывает в сотни мегабайт,
// и разбор в главном процессе подвесил бы оверлеи. Главный процесс шлёт { id, op, file, lap }, мы отвечаем { id, ok, data | error }.
//   op 'summary' — описание файла и список кругов (без рядов);
//   op 'lap'     — ряды одного круга.
// Последние прочитанные файлы держим в памяти: круги одного файла обычно смотрят подряд.
const S = require('./session');
const fs = require('fs');
const path = require('path');
const { kindOf } = S;
const ARCHIVES = new Set(['.zip', '.7z', '.rar']);
const TELEMETRY_EXT = new Set(['.ibt', '.duckdb', '.ld', '.ldx']);

async function importFiles(paths, refsDir) {
    fs.mkdirSync(refsDir, { recursive: true });
    const added = [], skipped = [];
    const free = (name) => {
      let dest = path.join(refsDir, name);
      for (let k = 2; fs.existsSync(dest); k++) dest = path.join(refsDir, `${path.parse(name).name} (${k})${path.extname(name)}`);
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
          // к MoTeC .ld кладём и его .ldx (сводка кругов), если он лежит в архиве рядом
          for (const e of entries) if (/\.ldx$/i.test(e.name) && found.some((f) => f.name.replace(/\.ld$/i, '') === e.name.replace(/\.ldx$/i, ''))) found.push(e);
          if (!found.length) { skipped.push(`${path.basename(p)} (в архиве нет телеметрии)`); continue; }
          for (const e of found) {
            try {
            const dest = free(path.basename(e.name.replace(/\\/g, '/')));
            fs.writeFileSync(dest, e.read());
            if (kindOf(dest)) added.push(dest);
            } catch (err) { skipped.push(`${e.name} (${err.message})`); }
          }
        } catch (err) {
          skipped.push(`${path.basename(p)} (${err.message})`);
        }
        continue;
      }
      if (ext === '.ldx') continue;   // сводка кругов MoTeC едет вместе со своим .ld
      if (!kindOf(p)) { skipped.push(path.basename(p)); continue; }
      try {
      let dest = path.join(refsDir, path.basename(p));
      if (path.resolve(p) !== path.resolve(dest)) {
        dest = free(path.basename(p));
        fs.copyFileSync(p, dest);
        if (fs.existsSync(`${p}.wal`)) fs.copyFileSync(`${p}.wal`, `${dest}.wal`);
        const ldx = p.replace(/\.ld$/i, '.ldx');
        if (kindOf(p) === 'motec' && fs.existsSync(ldx)) fs.copyFileSync(ldx, dest.replace(/\.ld$/i, '.ldx'));
      }
      added.push(dest);
      } catch (err) { skipped.push(`${path.basename(p)} (${err.message})`); }
    }
    return { added, skipped, total: added.length + skipped.length };
  }



const cache = new Map();
const KEEP = 3;

async function session(file) {
  const st = await fs.promises.stat(file);
  const version = `${st.mtimeMs}|${st.size}`;
  if (cache.has(file) && cache.get(file).version === version) {
    const s = cache.get(file);
    cache.delete(file);
    cache.set(file, s);
    return s.data;
  }
  const s = await S.load(file);
  cache.set(file, { version, data: s });
  while (cache.size > KEEP) cache.delete(cache.keys().next().value);
  return s;
}

const lapInfo = (l, i) => ({ index: i, num: l.num, time: l.time, complete: l.complete, valid: l.valid, pit: l.pit, off: l.off, inc: l.inc });

async function handle(msg) {
  if (msg.op === 'import') return importFiles(msg.paths, msg.refsDir);
  if (msg.op === 'summary') {
    const info = await S.describe(msg.file);
    const s = await session(msg.file);
    return { ...info, trackLength: s.meta.trackLength, sectors: s.meta.sectors, laps: s.laps.map(lapInfo) };
  }
  if (msg.op === 'lap') {
    const s = await session(msg.file);
    const lap = S.lapSlice(s, msg.lap);
    if (!lap) throw new Error('круг не найден');
    return { ...lap, lap: lapInfo(lap.lap, msg.lap) };
  }
  if (msg.op === 'track') {
    const s = await session(msg.file);
    return { ...S.trackModel(s), trackLength: s.meta.trackLength, sectors: s.meta.sectors, source: s.meta.source };
  }
  throw new Error(`неизвестная операция ${msg.op}`);
}

process.parentPort.on('message', async (e) => {
  const msg = e.data || {};
  try {
    process.parentPort.postMessage({ id: msg.id, ok: true, data: await handle(msg) });
  } catch (err) {
    process.parentPort.postMessage({ id: msg.id, ok: false, error: String(err?.message || err) });
  }
});
