// Чтение файлов MoTeC .ld (формат логгера MoTeC i2): заголовок, цепочка описаний каналов, затем сами данные.
// Такие файлы выгружают из LMU сторонние программы, и их же раздают сетаперы как эталоны.
// Рядом может лежать .ldx — XML со сводкой кругов (число кругов, лучший круг и его время).
// Значение канала = сырое * mul / scale * 10^-dec + shift (проверено по образцу из LMU: скорость, педали, руль, GPS).
const fs = require('fs');

const HEAD_META_PTR = 8;
const HEAD_EVENT_PTR = 0x24;
const CH_RECORD = 124;      // длина описания канала в цепочке
const CH_NAME = 32, CH_UNIT = 72;

const cstr = (buf, off, len) => {
  const end = buf.indexOf(0, off);
  return buf.toString('latin1', off, end < 0 || end > off + len ? off + len : end).trim();
};

// Описания всех каналов: имя, единицы, частота, где лежат данные и как приводить к реальным числам
function readChannelList(buf) {
  if (buf.length < 0x200 || buf.readUInt32LE(0) !== 0x40) throw new Error('это не файл MoTeC .ld');
  const list = [];
  const seen = new Set();
  let p = buf.readUInt32LE(HEAD_META_PTR);
  while (p && p + CH_RECORD <= buf.length && !seen.has(p) && list.length < 5000) {
    seen.add(p);
    const next = buf.readUInt32LE(p + 4);
    const kind = buf.readUInt16LE(p + 18), size = buf.readUInt16LE(p + 20);
    list.push({
      name: cstr(buf, p + CH_NAME, 32), unit: cstr(buf, p + CH_UNIT, 12),
      dataPtr: buf.readUInt32LE(p + 8), n: buf.readUInt32LE(p + 12),
      float: kind === 7, size, freq: buf.readUInt16LE(p + 22),
      shift: buf.readInt16LE(p + 24), mul: buf.readInt16LE(p + 26), scale: buf.readInt16LE(p + 28), dec: buf.readInt16LE(p + 30),
    });
    p = next;
  }
  if (!list.length) throw new Error('в файле MoTeC нет каналов');
  return list;
}

function readValues(buf, c) {
  const out = new Float64Array(c.n);
  if (!c.freq || !c.n || c.dataPtr + c.n * c.size > buf.length) return null;
  const k = (c.mul || 1) / (c.scale || 1) * 10 ** -c.dec;
  for (let i = 0; i < c.n; i++) {
    const o = c.dataPtr + i * c.size;
    let v;
    if (c.float) v = c.size === 8 ? buf.readDoubleLE(o) : c.size === 4 ? buf.readFloatLE(o) : halfToFloat(buf.readUInt16LE(o));
    else v = c.size === 4 ? buf.readInt32LE(o) : c.size === 2 ? buf.readInt16LE(o) : c.size === 1 ? buf.readInt8(o) : NaN;
    out[i] = c.float ? v : v * k + c.shift;
  }
  return out;
}

function halfToFloat(h) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
  if (!e) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

// Шапка файла: пилот, трасса, машина, дата
function readHeader(buf) {
  const meta = { driver: cstr(buf, 0x9e, 64), venue: cstr(buf, 0x15e, 64), vehicle: cstr(buf, 0xde, 64), vehicleClass: '', date: null };
  const d = cstr(buf, 0x5e, 16).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/), t = cstr(buf, 0x7e, 16).match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (d) meta.date = new Date(+d[3], +d[2] - 1, +d[1], t ? +t[1] : 0, t ? +t[2] : 0, t ? +t[3] : 0).getTime();
  try {   // машина в этих файлах лежит в записи «транспорт»: событие → место → транспорт
    const ev = buf.readUInt32LE(HEAD_EVENT_PTR);
    if (ev) {
      const venue = buf.readUInt16LE(ev + 64 + 64 + 1024);
      const veh = venue ? buf.readUInt16LE(venue + 64 + 1034) : 0;
      // в записи подряд идут класс машины («GT3») и её полное название («TF Sport 2026 #2:LM»)
      const cls = veh ? cstr(buf, veh, 64) : '', name = veh ? cstr(buf, veh + 64, 64) : '';
      if (name) meta.vehicle = name;
      if (cls) meta.vehicleClass = cls;
    }
  } catch { /* шапка без записи о транспорте — остаётся то, что есть */ }
  return meta;
}

// Сводка из .ldx рядом с файлом: { laps, fastestTime (с), fastestLap (номер с 1) } — или null
function readLdx(file) {
  try {
    const xml = fs.readFileSync(file.replace(/\.ld$/i, '.ldx'), 'utf8');
    const get = (id) => (xml.match(new RegExp(`Id="${id}"\\s+Value="([^"]*)"`)) || [])[1];
    const m = String(get('Fastest Time') || '').match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
    return {
      laps: Number(get('Total Laps')) || 0,
      fastestTime: m ? (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]) : null,
      fastestLap: Number(get('Fastest Lap')) || null,
    };
  } catch {
    return null;
  }
}

const find = (list, names) => {
  for (const n of names) {
    const c = list.find((x) => x.name.toLowerCase() === n.toLowerCase());
    if (c) return c;
  }
  return null;
};

// Нужные окну сигналы и под какими именами они встречаются в выгрузках
const SIGNALS = {
  time: ['Session Elapsed Time', 'Time', 'Session Time'],
  lap: ['Lap Number', 'Lap', 'Laps'],
  speed: ['Ground Speed', 'Speed', 'Vehicle Speed', 'GPS Speed'],
  thr: ['Throttle Pos', 'Throttle', 'Throttle Position'],
  brk: ['Brake Pos', 'Brake', 'Brake Position'],
  clu: ['Clutch Pos', 'Clutch'],
  steer: ['Steering Wheel Position', 'Steering Angle', 'Steering Wheel Angle'],
  steerPct: ['Steering', 'Steering Pos'],
  rpm: ['Engine RPM', 'RPM', 'Engine Speed'],
  gear: ['Gear', 'Gear Number'],
  lat: ['GPS Latitude', 'Latitude'],
  lon: ['GPS Longitude', 'Longitude'],
};

// Файл целиком: шапка, сводка .ldx и значения нужных каналов ({ values, freq, unit })
function readLd(file) {
  const buf = fs.readFileSync(file);
  const list = readChannelList(buf);
  const ch = {};
  for (const [key, names] of Object.entries(SIGNALS)) {
    const c = find(list, names);
    if (!c) continue;
    const values = readValues(buf, c);
    if (values) ch[key] = { values, freq: c.freq, unit: c.unit };
  }
  if (!ch.lap) throw new Error('в файле нет канала номера круга (Lap Number)');
  return { head: readHeader(buf), ldx: readLdx(file), ch, channels: list.length };
}

// Быстрое описание для библиотеки: тот же файл, но по каналам, которые нужны для числа кругов и длительности
function readLdInfo(file) {
  const buf = fs.readFileSync(file);
  const list = readChannelList(buf);
  const head = readHeader(buf);
  const lapCh = find(list, SIGNALS.lap);
  if (!lapCh) throw new Error('в файле нет канала номера круга (Lap Number)');
  const laps = readValues(buf, lapCh);
  let changes = 0;
  for (let i = 1; i < laps.length; i++) if (laps[i] !== laps[i - 1]) changes++;
  const ldx = readLdx(file);
  return { head, ldx, duration: lapCh.freq ? lapCh.n / lapCh.freq : 0, lapCount: ldx?.laps || Math.max(0, changes - 1) };
}

module.exports = { readLd, readLdInfo };
