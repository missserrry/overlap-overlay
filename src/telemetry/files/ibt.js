// Чтение файла телеметрии iRacing (.ibt). Формат — из официального irsdk_defines.h:
//   irsdk_header (112 байт) → irsdk_diskSubHeader (32 байта) → заголовки переменных (по 144 байта) → сессионный YAML → записи.
// Записи идут подряд, каждая bufLen байт, по одной на тик (60 Гц, или 360 Гц у части каналов, если включено).
// Файл бывает в сотни мегабайт, поэтому читаем его кусками и достаём только нужные каналы.
const fs = require('fs');
const { parseSessionInfo } = require('../sessionInfo');

const HEADER_SIZE = 112, DISK_HEADER_SIZE = 32, VAR_HEADER_SIZE = 144;
const T_CHAR = 0, T_BOOL = 1, T_INT = 2, T_BITFIELD = 3, T_FLOAT = 4, T_DOUBLE = 5;
const CHUNK = 8 * 1024 * 1024;

function readAt(fd, offset, len) {
  const buf = Buffer.alloc(len);
  const got = fs.readSync(fd, buf, 0, len, offset);
  return got === len ? buf : buf.subarray(0, got);
}

// Заголовок, список переменных и сессия — без чтения самих записей (быстро даже для огромного файла)
function readHeader(fd) {
  const h = readAt(fd, 0, HEADER_SIZE + DISK_HEADER_SIZE);
  if (h.length < HEADER_SIZE + DISK_HEADER_SIZE) throw new Error('файл слишком короткий');
  const head = {
    ver: h.readInt32LE(0), tickRate: h.readInt32LE(8),
    sessionInfoLen: h.readInt32LE(16), sessionInfoOffset: h.readInt32LE(20),
    numVars: h.readInt32LE(24), varHeaderOffset: h.readInt32LE(28), bufLen: h.readInt32LE(36),
    bufOffset: h.readInt32LE(48 + 4),
    startDate: Number(h.readBigInt64LE(HEADER_SIZE)), startTime: h.readDoubleLE(HEADER_SIZE + 8),
    endTime: h.readDoubleLE(HEADER_SIZE + 16), lapCount: h.readInt32LE(HEADER_SIZE + 24), recordCount: h.readInt32LE(HEADER_SIZE + 28),
  };
  if (head.ver < 1 || head.numVars <= 0 || head.numVars > 10000 || head.bufLen <= 0) throw new Error('это не файл телеметрии iRacing');
  const vh = readAt(fd, head.varHeaderOffset, head.numVars * VAR_HEADER_SIZE);
  const vars = new Map();
  for (let i = 0; i < head.numVars; i++) {
    const o = i * VAR_HEADER_SIZE;
    const name = vh.toString('latin1', o + 16, o + 48).replace(/\0.*$/s, '');
    vars.set(name, { type: vh.readInt32LE(o), offset: vh.readInt32LE(o + 4), count: vh.readInt32LE(o + 8) });
  }
  return { head, vars };
}

function readSession(fd, head) {
  const raw = readAt(fd, head.sessionInfoOffset, head.sessionInfoLen).toString('latin1').replace(/\0+$/, '');
  return parseSessionInfo(raw);
}

// Описание файла для библиотеки: машина, трасса, дата, длительность
function readIbtInfo(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const { head } = readHeader(fd);
    const s = readSession(fd, head) || {};
    return { head, session: s };
  } finally { fs.closeSync(fd); }
}

// Каналы целиком: { name: Float64Array } (у массивов — первый элемент). Отсутствующие каналы пропускаются.
function readIbtChannels(file, names) {
  const fd = fs.openSync(file, 'r');
  try {
    const { head, vars } = readHeader(fd);
    const session = readSession(fd, head);
    const size = fs.fstatSync(fd).size;
    const n = Math.max(0, Math.min(head.recordCount || Infinity, Math.floor((size - head.bufOffset) / head.bufLen)));
    const want = names.map((name) => [name, vars.get(name)]).filter(([, v]) => v && v.type !== T_CHAR);
    const out = {};
    for (const [name] of want) out[name] = new Float64Array(n);
    const perChunk = Math.max(1, Math.floor(CHUNK / head.bufLen));
    const buf = Buffer.alloc(perChunk * head.bufLen);
    for (let i0 = 0; i0 < n; i0 += perChunk) {
      const cnt = Math.min(perChunk, n - i0);
      fs.readSync(fd, buf, 0, cnt * head.bufLen, head.bufOffset + i0 * head.bufLen);
      for (const [name, v] of want) {
        const arr = out[name];
        for (let k = 0; k < cnt; k++) {
          const o = k * head.bufLen + v.offset;
          arr[i0 + k] = v.type === T_DOUBLE ? buf.readDoubleLE(o) : v.type === T_FLOAT ? buf.readFloatLE(o)
            : v.type === T_BOOL ? buf[o] : buf.readInt32LE(o);
        }
      }
    }
    return { head, session, n, ch: out };
  } finally { fs.closeSync(fd); }
}

module.exports = { readIbtInfo, readIbtChannels, T_BITFIELD };
