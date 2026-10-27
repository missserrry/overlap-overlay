// Загрузчик сетапов: берёт архивы (.zip, .7z, .rar) и отдельные файлы (.sto, .blap, .olap) и раскладывает по папкам iRacing.
//   сетапы .sto         → Documents\iRacing\setups\<папка машины>\
//   базовые круги .blap → Documents\iRacing\lapfiles\<трасса>\   (название папки — путь трассы с пробелом вместо обратной косой: «lemans full»)
// Машина и трасса:
//   • в .blap записаны папка машины и путь трассы — если базовые круги есть, всё раскладывается само;
//   • .sto зашифрованы, поэтому без .blap машину берём из имени архива (ferrari499p_Le_Mans_W07.zip, «Ferrari 499P …») и просим подтвердить;
//   • если не удалось и по имени — пользователь выбирает машину из списка.
// Ничего не перезаписывается: одинаковый файл пропускается, отличающийся получает суффикс. Всё созданное запоминается, загрузку можно отменить.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const NAMES = require('./carNames.json');

const sha = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
const SAFE = (name) => path.basename(String(name).replace(/\\/g, '/')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const WANTED = new Set(['.sto', '.blap', '.olap']);

// ---------- zip без внешних библиотек (хранение и deflate) ----------
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('это не zip-архив');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('повреждён список файлов архива');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nlen);
    p += 46 + nlen + elen + clen;
    if (name.endsWith('/')) continue;
    out.push({ name, method, csize, off });
  }
  return out.map((e) => ({
    name: e.name,
    read() {
      if (buf.readUInt32LE(e.off) !== 0x04034b50) throw new Error(`повреждён файл «${e.name}»`);
      const start = e.off + 30 + buf.readUInt16LE(e.off + 26) + buf.readUInt16LE(e.off + 28);
      const raw = buf.subarray(start, start + e.csize);
      if (e.method === 0) return Buffer.from(raw);
      if (e.method === 8) return zlib.inflateRawSync(raw);
      throw new Error(`«${e.name}»: неподдерживаемое сжатие`);
    },
  }));
}

// ---------- .7z и .rar через 7-Zip (WASM): распаковываем в память, нужные файлы забираем ----------
// wanted — какие расширения забирать (окно «Телеметрия» берёт так же .ibt и .duckdb из архивов с эталонами)
let sevenZipInit = null;
async function readWith7z(buf, ext, wanted = WANTED) {
  const SevenZip = require('7z-wasm');
  sevenZipInit = sevenZipInit || SevenZip;
  const z = await sevenZipInit({ print: () => {}, printErr: () => {} });
  const name = `in${ext}`;
  const s = z.FS.open(name, 'w+'); z.FS.write(s, buf, 0, buf.length); z.FS.close(s);
  z.FS.mkdir('/out');
  z.callMain(['x', name, '-o/out', '-y', '-bso0', '-bsp0']);
  const out = [];
  (function walk(dir) {
    for (const n of z.FS.readdir(dir)) {
      if (n === '.' || n === '..') continue;
      const p = `${dir}/${n}`;
      if (z.FS.isDir(z.FS.stat(p).mode)) walk(p);
      else if (wanted.has(path.extname(n).toLowerCase())) { const data = Buffer.from(z.FS.readFile(p)); out.push({ name: n, read: () => data }); }
    }
  })('/out');
  return out;
}

// ---------- .blap: папка машины и путь трассы записаны текстом в начале файла ----------
function parseLap(buf) {
  if (buf.toString('latin1', 0, 4) !== 'BLAP') return null;
  const strs = [...buf.subarray(0, 4000).toString('latin1').matchAll(/[ -~]{3,}/g)].map((m) => m[0]);
  // строки по порядку: «BLAP», имя пилота, папка машины, «undefined», цвета…
  const car = /^[a-z0-9]+(?: [a-z0-9]+)*$/.test(strs[2] || '') ? strs[2] : null;
  const track = strs.find((s) => /^[\w .-]+\\[\w .-]+$/.test(s));
  return car && track ? { car, track, trackDir: track.replace(/\\/g, ' ') } : null;
}

// ---------- сбор файлов ----------
async function collect(paths) {
  const items = [], problems = [];
  for (const src of paths) {
    try {
      const st = fs.statSync(src);
      if (st.isDirectory()) { const sub = await collect(fs.readdirSync(src).map((f) => path.join(src, f))); items.push(...sub.items); problems.push(...sub.problems); continue; }
      const base = path.basename(src), ext = path.extname(base).toLowerCase();
      let entries = null;
      if (ext === '.zip') entries = readZip(fs.readFileSync(src));
      else if (ext === '.7z' || ext === '.rar') entries = await readWith7z(fs.readFileSync(src), ext);
      if (entries) {
        let useful = 0;
        for (const e of entries) {
          const name = SAFE(e.name);
          if (!name) continue;
          const eext = path.extname(name).toLowerCase();
          if (WANTED.has(eext)) useful++;
          items.push({ archive: base, name, ext: eext, data: () => e.read() });
        }
        if (!useful) problems.push(`«${base}»: в архиве нет ни сетапов (.sto), ни базовых кругов (.blap)`);
      } else if (WANTED.has(ext)) {
        items.push({ archive: null, name: SAFE(base), ext, data: () => fs.readFileSync(src) });
      } else problems.push(`«${base}»: такой тип файла не поддерживается (нужны .zip, .7z, .rar, .sto, .blap)`);
    } catch (e) { problems.push(`«${path.basename(src)}»: ${e.message}`); }
  }
  return { items, problems };
}

// ---------- машины ----------
const prettify = (dir) => dir.replace(/\b\w/g, (c) => c.toUpperCase());
const carName = (dir) => NAMES[dir] || prettify(dir);

// Все известные машины: существующие папки setups и папки iRacing\cars (рядом с игрой), плюс те, для которых есть название
function knownCars(iracingDir) {
  const set = new Set(Object.keys(NAMES).filter((k) => k !== '_comment'));
  try { for (const d of fs.readdirSync(path.join(iracingDir, 'setups'), { withFileTypes: true })) if (d.isDirectory()) set.add(d.name); } catch { /* папки ещё нет */ }
  return [...set].sort().map((dir) => ({ dir, name: carName(dir) }));
}

// Кандидаты по имени архива/файла: имя содержит папку машины или её название («Ferrari 499P»), побеждает самое длинное совпадение
function carsFromName(label, cars) {
  const n = norm(String(label || '').replace(/\.(zip|7z|rar|sto)$/i, ''));
  if (!n) return [];
  const hits = [];
  for (const c of cars) {
    const keys = new Set([norm(c.dir), norm(c.name)]);
    const noBrand = norm(c.name.split(' ').slice(1).join(' '));
    if (noBrand.length >= 6) keys.add(noBrand);                 // «Corvette Z06 GT3.R» без марки
    let best = 0;
    for (const k of keys) if (k.length >= 4 && n.includes(k)) best = Math.max(best, k.length);
    if (best) hits.push({ ...c, score: best });
  }
  hits.sort((a, b) => b.score - a.score);
  if (!hits.length) return [];
  // если у лидера нет равных соперников — это уверенный выбор, иначе вернём всех с лучшим счётом
  return hits.filter((h) => h.score === hits[0].score);
}

function uniquePath(dir, name, car) {
  const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
  const tries = [name];
  if (car && !stem.toLowerCase().includes(car.toLowerCase())) tries.push(`${stem}_${car}${ext}`);
  for (let i = 2; i < 100; i++) tries.push(`${stem} (${i})${ext}`);
  return tries.map((t) => path.join(dir, t));
}

// Положить файл: одинаковый уже лежит — пропускаем; другой с тем же именем — берём свободное имя
function place(dir, name, data, car) {
  fs.mkdirSync(dir, { recursive: true });
  const digest = sha(data);
  for (const target of uniquePath(dir, name, car)) {
    if (!fs.existsSync(target)) { fs.writeFileSync(target, data); return { status: 'new', file: target }; }
    if (sha(fs.readFileSync(target)) === digest) return { status: 'same', file: target };
  }
  return { status: 'fail', file: null };
}

// ---------- шаг 1: разбор. Ничего не копирует, только определяет машину и решает, нужно ли подтверждение ----------
async function analyze(paths, { iracingDir }) {
  const res = { groups: [], problems: [], cars: [] };
  if (!fs.existsSync(iracingDir)) { res.problems.push(`Не найдена папка iRacing: ${iracingDir}`); return res; }
  const cars = res.cars = knownCars(iracingDir);
  const { items, problems } = await collect(paths);
  res.problems.push(...problems);

  const byArchive = new Map();
  for (const it of items) { const k = it.archive || '(отдельные файлы)'; if (!byArchive.has(k)) byArchive.set(k, []); byArchive.get(k).push(it); }

  let n = 0;
  for (const [archive, files] of byArchive) {
    const laps = files.filter((f) => f.ext === '.blap' || f.ext === '.olap').map((f) => { let data = null, info = null; try { data = f.data(); info = parseLap(data); } catch { /* битый файл */ } return { f, data, info }; });
    const votes = new Map();
    for (const l of laps) if (l.info) votes.set(l.info.car, (votes.get(l.info.car) || 0) + 1);
    const lapCar = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const stoNames = files.filter((f) => f.ext === '.sto');
    const byName = carsFromName(archive === '(отдельные файлы)' ? stoNames[0]?.name : archive, cars);
    const g = { id: `g${++n}`, archive, files, laps, lapCar, setupsCount: stoNames.length, guess: null, candidates: [], how: null, car: null, note: '' };
    if (lapCar) {                                   // базовые круги — надёжный источник: раскладываем сами
      g.how = 'laps'; g.car = lapCar;
      if (byName.length === 1 && byName[0].dir.toLowerCase() !== lapCar.toLowerCase()) g.note = `имя архива указывает на «${byName[0].name}», но базовые круги внутри — для «${carName(lapCar)}»; использована машина из базовых кругов`;
    } else if (stoNames.length) {                   // только по имени: нужно подтверждение
      g.how = byName.length ? 'name' : 'none';
      g.candidates = byName.map((c) => ({ dir: c.dir, name: c.name }));
      g.guess = byName.length === 1 ? { dir: byName[0].dir, name: byName[0].name } : null;
    }
    res.groups.push(g);
  }
  return res;
}

// ---------- шаг 2: загрузка группы в выбранную машину ----------
function execute(g, car, { iracingDir }) {
  const setupsRoot = path.join(iracingDir, 'setups'), lapRoot = path.join(iracingDir, 'lapfiles');
  const out = { archive: g.archive, car: car || g.car || null, carName: car || g.car ? carName(car || g.car) : '', how: g.how, note: g.note, tracks: [], setups: 0, laps: 0, same: 0, skipped: [], renamed: [], where: [], created: [] };
  const where = new Set(), tracks = new Set();
  const tally = (r, f, kind, dirLabel) => {
    if (r.status === 'fail') { out.skipped.push(`${f.name}: не удалось сохранить`); return; }
    if (r.status === 'same') { out.same++; return; }
    out[kind]++; out.created.push(r.file); where.add(dirLabel);
    if (path.basename(r.file) !== f.name) out.renamed.push(`${f.name} → ${path.basename(r.file)}`);
  };
  for (const f of g.files) {
    if (f.ext === '.sto') {
      if (!out.car) { out.skipped.push(`${f.name}: машина не выбрана`); continue; }
      tally(place(path.join(setupsRoot, out.car), f.name, f.data(), null), f, 'setups', path.join('setups', out.car));
    }
  }
  for (const l of g.laps) {
    if (!l.info) { out.skipped.push(`${l.f.name}: не удалось прочитать трассу и машину`); continue; }
    tracks.add(l.info.trackDir);
    tally(place(path.join(lapRoot, l.info.trackDir), l.f.name, l.data, l.info.car), l.f, 'laps', path.join('lapfiles', l.info.trackDir));
  }
  for (const f of g.files) if (!['.sto', '.blap', '.olap'].includes(f.ext)) out.skipped.push(`${f.name}: не сетап и не круг, пропущен`);
  out.where = [...where]; out.tracks = [...tracks];
  return out;
}

// Отмена загрузки: удаляем только то, что создали, и только если файл на месте
function undo(created) {
  let removed = 0;
  for (const f of created || []) { try { fs.unlinkSync(f); removed++; } catch { /* уже удалён */ } }
  return removed;
}

module.exports = { analyze, execute, undo, readZip, readWith7z, parseLap, carsFromName, knownCars, carName };
