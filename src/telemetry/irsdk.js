// Чтение телеметрии iRacing из общей памяти (Local\IRSDKMemMapFileName) через koffi, без компиляции.
// Формат заголовков — из официального irsdk_defines.h.
const koffi = require('koffi');
const { parseSessionInfo } = require('./sessionInfo');

const MEM_MAP_NAME = 'Local\\IRSDKMemMapFileName';
const FILE_MAP_READ = 0x0004;
const STATUS_CONNECTED = 1;

const HEADER_SIZE = 112;      // irsdk_header (48 байт) + 4 * irsdk_varBuf (16 байт)
const VAR_HEADER_SIZE = 144;  // irsdk_varHeader

// irsdk_VarType -> размер одного элемента
const TYPE_SIZE = [1, 1, 4, 4, 4, 8];
const T_CHAR = 0, T_BOOL = 1, T_INT = 2, T_BITFIELD = 3, T_FLOAT = 4, T_DOUBLE = 5;

let kernel32 = null;
function win32() {
  if (!kernel32) {
    const lib = koffi.load('kernel32.dll');
    kernel32 = {
      OpenFileMappingW: lib.func('void *OpenFileMappingW(uint32_t access, int inherit, str16 name)'),
      MapViewOfFile: lib.func('void *MapViewOfFile(void *h, uint32_t access, uint32_t offHi, uint32_t offLo, size_t size)'),
      UnmapViewOfFile: lib.func('int UnmapViewOfFile(void *p)'),
      CloseHandle: lib.func('int CloseHandle(void *h)'),
      // Копирование из общей памяти в Buffer. koffi.view() здесь не подходит: Electron запрещает
      // ArrayBuffer поверх внешней памяти (V8 sandbox), поэтому всегда копируем нужные участки.
      RtlMoveMemory: lib.func('void RtlMoveMemory(void *dst, uintptr_t src, size_t len)'),
    };
  }
  return kernel32;
}

class IRacingSdk {
  constructor() {
    this.handle = null;
    this.ptr = null;
    this.base = 0n;          // адрес отображённой памяти
    this.headerBuf = Buffer.alloc(HEADER_SIZE);
    this.vars = null;        // Map имя -> {type, offset, count}
    this.varHeaderSig = '';
    this.sessionInfoUpdate = -1;
    this.session = null;
    this.sessionVersion = 0;
    this.lastTick = -1;
    this.lastTickChange = 0;
  }

  // Открыть отображение памяти, если iRacing запущен. Возвращает true при успехе.
  open() {
    if (this.ptr) return true;
    if (process.platform !== 'win32') return false;
    const k = win32();
    const h = k.OpenFileMappingW(FILE_MAP_READ, 0, MEM_MAP_NAME);
    if (!h) return false;
    const p = k.MapViewOfFile(h, FILE_MAP_READ, 0, 0, 0);
    if (!p) { k.CloseHandle(h); return false; }
    this.handle = h;
    this.ptr = p;
    this.base = BigInt(koffi.address(p));
    this.vars = null;
    this.sessionInfoUpdate = -1;
    return true;
  }

  close() {
    if (!this.ptr) return;
    const k = win32();
    k.UnmapViewOfFile(this.ptr);
    k.CloseHandle(this.handle);
    this.ptr = this.handle = this.vars = null;
    this.session = null;
  }

  // Скопировать len байт по смещению offset из общей памяти
  copy(offset, len, into) {
    const buf = into || Buffer.alloc(len);
    win32().RtlMoveMemory(buf, this.base + BigInt(offset), len);
    return buf;
  }

  readHeader() {
    const v = new DataView(this.copy(0, HEADER_SIZE, this.headerBuf).buffer, this.headerBuf.byteOffset, HEADER_SIZE);
    const h = {
      ver: v.getInt32(0, true),
      status: v.getInt32(4, true),
      tickRate: v.getInt32(8, true),
      sessionInfoUpdate: v.getInt32(12, true),
      sessionInfoLen: v.getInt32(16, true),
      sessionInfoOffset: v.getInt32(20, true),
      numVars: v.getInt32(24, true),
      varHeaderOffset: v.getInt32(28, true),
      numBuf: v.getInt32(32, true),
      bufLen: v.getInt32(36, true),
      bufs: [],
    };
    for (let i = 0; i < h.numBuf && i < 4; i++) {
      h.bufs.push({ tickCount: v.getInt32(48 + i * 16, true), bufOffset: v.getInt32(52 + i * 16, true) });
    }
    return h;
  }

  readVarHeaders(h) {
    const sig = `${h.numVars}:${h.varHeaderOffset}:${h.bufLen}`;
    if (this.vars && sig === this.varHeaderSig) return;
    const raw = this.copy(h.varHeaderOffset, h.numVars * VAR_HEADER_SIZE);
    const vars = new Map();
    for (let i = 0; i < h.numVars; i++) {
      const base = i * VAR_HEADER_SIZE;
      const type = raw.readInt32LE(base);
      const offset = raw.readInt32LE(base + 4);
      const count = raw.readInt32LE(base + 8);
      const name = cString(raw, base + 16, 32);
      vars.set(name, { type, offset, count });
    }
    this.vars = vars;
    this.varHeaderSig = sig;
  }

  // Прочитать снимок: { connected, tick, vars:{имя:значение|массив}, session, sessionVersion }
  read(wanted) {
    if (!this.ptr && !this.open()) return { connected: false };
    let h = this.readHeader();
    if ((h.status & STATUS_CONNECTED) === 0) {
      this.lastTick = -1;
      return { connected: false };
    }
    this.readVarHeaders(h);

    // Свежая сессионная информация (YAML), перечитываем только при изменении счётчика
    if (h.sessionInfoUpdate !== this.sessionInfoUpdate) {
      const raw = latin1(this.copy(h.sessionInfoOffset, h.sessionInfoLen), 0, h.sessionInfoLen);
      const parsed = parseSessionInfo(raw);
      if (parsed) {
        this.session = parsed;
        this.sessionVersion++;
      }
      this.sessionInfoUpdate = h.sessionInfoUpdate;
    }

    // Последний буфер: копируем и проверяем, что тик не сменился во время копирования
    let snapshot = null;
    for (let attempt = 0; attempt < 3 && !snapshot; attempt++) {
      const buf = h.bufs.reduce((a, b) => (b.tickCount > a.tickCount ? b : a));
      const data = this.copy(buf.bufOffset, h.bufLen);
      const after = this.readHeader().bufs[h.bufs.indexOf(buf)].tickCount;
      if (after === buf.tickCount) snapshot = { tick: buf.tickCount, data: new DataView(data.buffer, data.byteOffset, data.length) };
      else h = this.readHeader();
    }
    if (!snapshot) return { connected: false };

    if (snapshot.tick !== this.lastTick) {
      this.lastTick = snapshot.tick;
      this.lastTickChange = Date.now();
    }
    // Если тик не меняется больше 2 с — сим завис или вышел, не сбросив флаг
    const fresh = Date.now() - this.lastTickChange < 2000;

    const out = {};
    for (const name of wanted) {
      const meta = this.vars.get(name);
      if (meta) out[name] = readVar(snapshot.data, meta);
    }
    return {
      connected: fresh,
      tick: snapshot.tick,
      vars: out,
      session: this.session,
      sessionVersion: this.sessionVersion,
    };
  }
}

function readVar(dv, { type, offset, count }) {
  const one = (o) => {
    switch (type) {
      case T_CHAR: return dv.getUint8(o);
      case T_BOOL: return dv.getUint8(o) !== 0;
      case T_INT:
      case T_BITFIELD: return dv.getInt32(o, true);
      case T_FLOAT: return dv.getFloat32(o, true);
      case T_DOUBLE: return dv.getFloat64(o, true);
      default: return null;
    }
  };
  if (count === 1) return one(offset);
  const arr = new Array(count);
  const size = TYPE_SIZE[type] || 4;
  for (let i = 0; i < count; i++) arr[i] = one(offset + i * size);
  return arr;
}

function cString(bytes, start, max) {
  let end = start;
  while (end < start + max && bytes[end] !== 0) end++;
  return Buffer.from(bytes.subarray(start, end)).toString('latin1');
}

function latin1(bytes, start, len) {
  let end = start;
  const stop = start + len;
  while (end < stop && bytes[end] !== 0) end++;
  return Buffer.from(bytes.subarray(start, end)).toString('latin1');
}

module.exports = { IRacingSdk };
