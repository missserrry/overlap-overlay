// Загрузчик сетапов: берёт архивы (.zip) и отдельные файлы (.sto, .blap, .olap) и раскладывает по папкам iRacing.
//   сетапы .sto        → Documents\iRacing\setups\<папка машины>\
//   базовые круги .blap → Documents\iRacing\lapfiles\<трасса>\   (название папки — путь трассы с пробелом вместо обратной косой: «lemans full»)
// Машину и трассу берём из самих файлов: в .blap записаны папка машины и путь трассы; .sto зашифрованы, поэтому машину для них определяем
// по имени архива (ferrari499p_Le_Mans_W07.zip → ferrari499p, сверяя с существующими папками setups) или по .blap из того же архива.
// Ничего не перезаписывается: одинаковый файл пропускается, отличающийся получает суффикс. Всё созданное запоминается, загрузку можно отменить.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const sha = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
const SAFE = (name) => path.basename(String(name).replace(/\\/g, '/')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();

// ---------- чтение zip без внешних библиотек (хранение и deflate; zip64 не нужен для сетапов) ----------
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
    const csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nlen);
    p += 46 + nlen + elen + clen;
    if (name.endsWith('/')) continue;
    out.push({ name, method, csize, usize, off });
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

// ---------- что внутри .blap: папка машины и путь трассы записаны текстом в начале файла ----------
function parseLap(buf) {
  if (buf.toString('latin1', 0, 4) !== 'BLAP') return null;
  const strs = [...buf.subarray(0, 4000).toString('latin1').matchAll(/[ -~]{3,}/g)].map((m) => m[0]);
  // строки по порядку: «BLAP», имя пилота, папка машины, «undefined», цвета…
  const car = /^[a-z0-9]+(?: [a-z0-9]+)*$/.test(strs[2] || '') ? strs[2] : null;
  const track = strs.find((s) => /^[\w .-]+\\[\w .-]+$/.test(s));
  return car && track ? { car, track, trackDir: track.replace(/\\/g, ' ') } : null;
}

// ---------- сбор файлов из архивов и из отдельных путей ----------
function collect(paths) {
  const items = [], problems = [];
  for (const src of paths) {
    try {
      const st = fs.statSync(src);
      if (st.isDirectory()) { items.push(...collect(fs.readdirSync(src).map((f) => path.join(src, f)))); continue; }
      const base = path.basename(src), ext = path.extname(base).toLowerCase();
      if (ext === '.zip') {
        for (const e of readZip(fs.readFileSync(src))) {
          const name = SAFE(e.name);
          if (name) items.push({ archive: base, name, ext: path.extname(name).toLowerCase(), data: () => e.read() });
        }
      } else if (['.sto', '.blap', '.olap'].includes(ext)) {
        items.push({ archive: null, name: SAFE(base), ext, data: () => fs.readFileSync(src) });
      } else problems.push(`«${base}»: такой тип файла не поддерживается (нужны .zip, .sto, .blap)`);
    } catch (e) { problems.push(`«${path.basename(src)}»: ${e.message}`); }
  }
  return { items, problems };
}

// Машина по имени архива: самая длинная существующая папка setups, с которой имя начинается («ferrari499p_Le_Mans_W07.zip»)
function carFromName(archive, cars) {
  const base = String(archive || '').toLowerCase().replace(/\.zip$/, '');
  const hit = cars.filter((c) => base === c.toLowerCase() || base.startsWith(c.toLowerCase() + '_') || base.startsWith(c.toLowerCase() + ' ') || base.startsWith(c.toLowerCase() + '-'))
    .sort((a, b) => b.length - a.length)[0];
  return hit || null;
}

function uniquePath(dir, name, car) {
  const ext = path.extname(name), stem = name.slice(0, -ext.length || undefined);
  const tries = [name, car && !stem.toLowerCase().includes(car.toLowerCase()) ? `${stem}_${car}${ext}` : null];
  for (let i = 2; i < 100; i++) tries.push(`${stem} (${i})${ext}`);
  return tries.filter(Boolean).map((t) => path.join(dir, t));
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

// ---------- основной разбор и загрузка ----------
function install(paths, { iracingDir }) {
  const setupsRoot = path.join(iracingDir, 'setups'), lapRoot = path.join(iracingDir, 'lapfiles');
  const res = { groups: [], created: [], problems: [], total: { setups: 0, laps: 0, same: 0, skipped: 0 } };
  if (!fs.existsSync(iracingDir)) { res.problems.push(`Не найдена папка iRacing: ${iracingDir}`); return res; }
  const cars = fs.existsSync(setupsRoot) ? fs.readdirSync(setupsRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
  const { items, problems } = collect(paths);
  res.problems.push(...problems);

  // группируем по архиву (отдельные файлы — своя группа)
  const byArchive = new Map();
  for (const it of items) { const k = it.archive || '(отдельные файлы)'; if (!byArchive.has(k)) byArchive.set(k, []); byArchive.get(k).push(it); }

  for (const [archive, files] of byArchive) {
    const g = { archive, car: null, carNote: '', tracks: new Set(), setups: 0, laps: 0, same: 0, skipped: [], renamed: [], where: new Set() };
    // машина и трасса по .blap
    const laps = files.filter((f) => f.ext === '.blap' || f.ext === '.olap').map((f) => { let info = null, data = null; try { data = f.data(); info = parseLap(data); } catch { /* битый файл */ } return { f, data, info }; });
    const carVotes = new Map();
    for (const l of laps) if (l.info) carVotes.set(l.info.car, (carVotes.get(l.info.car) || 0) + 1);
    const lapCar = [...carVotes].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const nameCar = carFromName(archive === '(отдельные файлы)' ? null : archive, cars);
    g.car = nameCar || lapCar;
    if (nameCar && lapCar && nameCar.toLowerCase() !== lapCar.toLowerCase()) g.carNote = `имя архива говорит «${nameCar}», а базовые круги внутри — «${lapCar}»; сетапы положены в «${nameCar}»`;

    for (const f of files) {
      if (f.ext === '.sto') {
        // отдельный .sto без архива: машину берём из имени файла или из .blap, брошенных вместе
        const car = g.car || carFromName(f.name, cars);
        if (!car) { g.skipped.push(`${f.name}: не удалось определить машину`); continue; }
        const r = place(path.join(setupsRoot, car), f.name, f.data(), null);
        if (r.status === 'fail') { g.skipped.push(`${f.name}: не удалось сохранить`); continue; }
        if (r.status === 'same') { g.same++; res.total.same++; continue; }
        g.setups++; res.total.setups++; res.created.push(r.file); g.where.add(path.join('setups', car));
        if (path.basename(r.file) !== f.name) g.renamed.push(`${f.name} → ${path.basename(r.file)}`);
      } else if (f.ext === '.blap' || f.ext === '.olap') {
        const l = laps.find((x) => x.f === f);
        if (!l?.info) { g.skipped.push(`${f.name}: не удалось прочитать трассу и машину`); continue; }
        const r = place(path.join(lapRoot, l.info.trackDir), f.name, l.data, l.info.car);
        if (r.status === 'fail') { g.skipped.push(`${f.name}: не удалось сохранить`); continue; }
        g.tracks.add(l.info.trackDir);
        if (r.status === 'same') { g.same++; res.total.same++; continue; }
        g.laps++; res.total.laps++; res.created.push(r.file); g.where.add(path.join('lapfiles', l.info.trackDir));
        if (path.basename(r.file) !== f.name) g.renamed.push(`${f.name} → ${path.basename(r.file)}`);
      } else { g.skipped.push(`${f.name}: не сетап и не круг, пропущен`); res.total.skipped++; }
    }
    res.groups.push({ ...g, tracks: [...g.tracks], where: [...g.where] });
  }
  return res;
}

// Отмена загрузки: удаляем только то, что создали, и только если файл на месте
function undo(created) {
  let removed = 0;
  for (const f of created || []) { try { fs.unlinkSync(f); removed++; } catch { /* уже удалён */ } }
  return removed;
}

module.exports = { install, undo, readZip, parseLap, carFromName };
