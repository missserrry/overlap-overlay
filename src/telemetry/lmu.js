// Чтение телеметрии Le Mans Ultimate из встроенной общей памяти игры (LMU_Data) через koffi, плагин не нужен.
// Игра сама отдаёт данные при включённом в настройках «Enable Plugins» (Settings → Gameplay).
// Формат (раскладка структур) — из заголовков Studio 397 Plugin SDK (Support\SharedMemoryInterface в папке игры); сами заголовки
// мы не копируем, а читаем нужные поля по смещениям. Смещения проверены по живой памяти игры (LMU 1.4, gameVersion 14200).
// На выходе — снимок в том же виде, что у iRacing (vars + session), чтобы модели оверлеев работали без изменений.
const koffi = require('koffi');
const { execFile } = require('child_process');

const MAP_NAME = 'LMU_Data';
const FILE_MAP_READ = 0x0004;
const PROCESS_NAME = 'Le Mans Ultimate.exe';

// Раскладка SharedMemoryObjectOut (общая структура идёт с упаковкой по умолчанию: size_t выровнен по 8, остальные — упаковка 4)
const OFF = {
  scoring: 1632,            // ScoringInfoV01
  vehicles: 1632 + 560,     // VehicleScoringInfoV01[104]: после scoringInfo (548) идёт size_t scoringStreamSize, выровненный до 560
  telemetry: 128464,        // activeVehicles, playerVehicleIdx, playerHasVehicle, затем TelemInfoV01[104]
};
const VEH_SIZE = 584, TEL_SIZE = 1888, TEL_HEAD = 4, MAX_CARS = 104;

// ScoringInfoV01
const SC = {
  track: 0, session: 64, currentET: 68, endET: 76, maxLaps: 84, lapDist: 88, numVehicles: 104, gamePhase: 108, yellowState: 109,
  sectorFlag: 110, inRealtime: 115, playerName: 116, raining: 220, ambientTemp: 228, trackTemp: 236, wind: 244, startET: 328,
  avgWetness: 332, timeRemaining: 340, timeOfDay: 344,
};
// VehicleScoringInfoV01
const VE = {
  id: 0, driver: 4, vehicle: 36, totalLaps: 100, sector: 102, finish: 103, lapDist: 104, bestLap: 144, lastLap: 168,
  pitstops: 192, penalties: 194, isPlayer: 196, inPits: 198, place: 199, cls: 200, behindLeader: 244, lapStartET: 256,
  flag: 504, garage: 507, timeIntoLap: 464, estLap: 472, pitState: 457,
};
// TelemInfoV01
const TE = {
  elapsed: 12, lapStartET: 24, localVel: 184, gear: 352, rpm: 356, water: 364, oil: 372,
  unfThrottle: 388, unfBrake: 396, unfSteer: 404, unfClutch: 412, fuel: 524, maxRPM: 532, limiter: 604,
  frontTire: 620, visualSteerRange: 660, rearBrakeBias: 664, deltaBest: 696, absActive: 746, limiterActive: 748, model: 796,
};

// Классы машин: id, короткое имя, цвет (как в WEC); порядок = старшинство
const CLASSES = [
  { match: /^hyper/i, id: 1, short: 'HYPER', color: '0xE5393B' },
  { match: /^lmp2/i, id: 2, short: 'LMP2', color: '0x2F6FED' },
  { match: /^lmp3/i, id: 3, short: 'LMP3', color: '0xA855F7' },
  { match: /^gte/i, id: 4, short: 'GTE', color: '0x2FBF71' },
  { match: /^gt3|^lmgt3/i, id: 5, short: 'GT3', color: '0xF59E0B' },
];
function classOf(name) {
  const hit = CLASSES.find((c) => c.match.test(name));
  if (hit) return hit;
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { id: 100 + (h % 900), short: name.slice(0, 6).toUpperCase() || '—', color: '0x9CA3AF' };
}

let kernel32 = null;
function win32() {
  if (!kernel32) {
    const lib = koffi.load('kernel32.dll');
    kernel32 = {
      OpenFileMappingW: lib.func('void *OpenFileMappingW(uint32_t access, int inherit, str16 name)'),
      MapViewOfFile: lib.func('void *MapViewOfFile(void *h, uint32_t access, uint32_t offHi, uint32_t offLo, size_t size)'),
      UnmapViewOfFile: lib.func('int UnmapViewOfFile(void *p)'),
      CloseHandle: lib.func('int CloseHandle(void *h)'),
      RtlMoveMemory: lib.func('void RtlMoveMemory(void *dst, uintptr_t src, size_t len)'),
    };
  }
  return kernel32;
}

// Строки в памяти — UTF-8 с завершающим нулём
function cstr(buf, off, max) {
  let end = off;
  while (end < off + max && buf[end] !== 0) end++;
  return buf.toString('utf8', off, end).trim();
}

// "Garage 59 2026 #10:WEC" → команда «Garage 59 2026», номер «10»
function splitVehicleName(name) {
  const m = name.match(/^(.*?)\s*#\s*([0-9A-Za-z]+)(?::.*)?$/);
  return m ? { team: m[1].trim(), number: m[2] } : { team: name, number: '' };
}

const SESSION_TYPES = (n) => (n >= 10 ? 'Race' : n === 9 ? 'Warmup' : n >= 5 ? 'Qualify' : 'Practice');
const SESSION_LABEL = (n) => (n >= 10 ? 'Race' : n === 9 ? 'Warmup' : n >= 5 ? 'Qualifying' : n === 0 ? 'Test Day' : 'Practice');

// SessionFlags iRacing (биты те же, что разбирает модель digiflag)
const FL = { checkered: 0x1, green: 0x4, yellow: 0x8, red: 0x10, blue: 0x20, caution: 0x4000, black: 0x10000, disqualify: 0x20000 };

function hash32(s) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

class LmuSdk {
  constructor() {
    this.handle = null;
    this.ptr = null;
    this.base = 0n;
    this.session = null;
    this.sessionVersion = 0;
    this.sessionSig = '';
    this.running = null;        // запущен ли процесс игры (null — ещё не проверяли)
    this.lastCheck = 0;
    this.lastET = null;
    this.lastChange = 0;
    this.phase = { last: -1, greenSince: 0, state: 1 };
    this.hinted = false;
  }

  // Раз в пару секунд спрашиваем систему, жива ли игра: у приостановленной игры время сессии стоит, это не повод считать, что её нет
  checkProcess() {
    const now = Date.now();
    if (now - this.lastCheck < 3000) return;
    this.lastCheck = now;
    try {
      execFile('tasklist', ['/FI', `IMAGENAME eq ${PROCESS_NAME}`, '/NH', '/FO', 'CSV'], { windowsHide: true, timeout: 4000 }, (err, out) => {
        if (!err) this.running = String(out).toLowerCase().includes(PROCESS_NAME.toLowerCase());
      });
    } catch { /* без проверки процесса работаем по свежести данных */ }
  }

  open() {
    if (this.ptr) return true;
    if (process.platform !== 'win32') return false;
    const k = win32();
    const h = k.OpenFileMappingW(FILE_MAP_READ, 0, MAP_NAME);
    if (!h) return false;
    const p = k.MapViewOfFile(h, FILE_MAP_READ, 0, 0, 0);
    if (!p) { k.CloseHandle(h); return false; }
    this.handle = h; this.ptr = p; this.base = BigInt(koffi.address(p));
    this.lastET = null; this.lastChange = Date.now();
    return true;
  }

  close() {
    if (!this.ptr) return;
    const k = win32();
    k.UnmapViewOfFile(this.ptr);
    k.CloseHandle(this.handle);
    this.ptr = this.handle = null;
    this.session = null;
  }

  copy(offset, len) {
    const buf = Buffer.alloc(len);
    win32().RtlMoveMemory(buf, this.base + BigInt(offset), len);
    return buf;
  }

  read() {
    this.checkProcess();
    if (!this.ptr && !this.open()) {
      // игра запущена, а общей памяти нет: чаще всего выключены плагины — подскажем в журнале один раз
      if (this.running && !this.hinted) {
        this.hinted = true;
        console.warn('[lmu] игра запущена, но общая память LMU_Data не найдена: включите «Enable Plugins» в настройках игры (Settings → Gameplay) и перезапустите LMU');
      }
      return { connected: false };
    }
    this.hinted = false;

    const sc = this.copy(OFF.scoring, 560);
    const n = Math.min(sc.readInt32LE(SC.numVehicles), MAX_CARS);
    const track = cstr(sc, SC.track, 64);
    const et = sc.readDoubleLE(SC.currentET);
    if (!(n > 0) || !track || !Number.isFinite(et)) return { connected: this.alive(false) };
    const veh = this.copy(OFF.vehicles, n * VEH_SIZE);
    const tel0 = this.copy(OFF.telemetry, TEL_HEAD);
    const active = Math.min(tel0[0], n);
    const playerTel = tel0[1];
    const tel = active > 0 ? this.copy(OFF.telemetry + TEL_HEAD, active * TEL_SIZE) : Buffer.alloc(0);

    // свежесть: время сессии движется, либо игра жива (пауза, меню)
    const player = telemetryTime(tel, playerTel, active);
    const stamp = et + (player || 0);
    if (stamp !== this.lastET) { this.lastET = stamp; this.lastChange = Date.now(); }
    const connected = this.alive(Date.now() - this.lastChange < 5000);
    if (!connected) { if (this.running === false) this.close(); return { connected: false }; }

    return { connected: true, tick: Math.round(et * 1000), ...this.build(sc, veh, n, tel, active, playerTel, track, et) };
  }

  alive(fresh) { return fresh || this.running === true; }

  build(sc, veh, n, tel, active, playerTelIdx, track, et) {
    const trackLen = sc.readDoubleLE(SC.lapDist);
    const sessionNum = sc.readInt32LE(SC.session);
    const phase = sc.readUInt8(SC.gamePhase);
    const yellowState = sc.readInt8(SC.yellowState);
    const inRealtime = sc.readUInt8(SC.inRealtime) !== 0;
    const maxLaps = sc.readInt32LE(SC.maxLaps);
    const endET = sc.readDoubleLE(SC.endET);

    // --- машины
    let playerIdx = -1;
    const cars = [];
    for (let i = 0; i < n; i++) {
      const o = i * VEH_SIZE;
      const vehicle = cstr(veh, o + VE.vehicle, 64);
      const cls = cstr(veh, o + VE.cls, 32);
      const { team, number } = splitVehicleName(vehicle);
      const isPlayer = veh.readUInt8(o + VE.isPlayer) !== 0;
      if (isPlayer) playerIdx = i;
      cars.push({
        i, o, isPlayer, vehicle, team, number, clsName: cls, klass: classOf(cls),
        name: cstr(veh, o + VE.driver, 32),
        laps: veh.readInt16LE(o + VE.totalLaps),
        dist: veh.readDoubleLE(o + VE.lapDist),
        best: veh.readDoubleLE(o + VE.bestLap), last: veh.readDoubleLE(o + VE.lastLap),
        inPits: veh.readUInt8(o + VE.inPits) !== 0, garage: veh.readUInt8(o + VE.garage) !== 0,
        place: veh.readUInt8(o + VE.place), finish: veh.readInt8(o + VE.finish), penalties: veh.readInt16LE(o + VE.penalties),
        behindLeader: veh.readDoubleLE(o + VE.behindLeader), timeInto: veh.readDoubleLE(o + VE.timeIntoLap),
        est: veh.readDoubleLE(o + VE.estLap), flag: veh.readUInt8(o + VE.flag),
        pace: /pace/i.test(cls),
      });
    }
    if (playerIdx < 0 && playerTelIdx < n) playerIdx = playerTelIdx;
    const me = cars[playerIdx] || null;

    // --- места внутри класса
    const byClass = new Map();
    for (const c of cars) { if (!byClass.has(c.klass.id)) byClass.set(c.klass.id, []); byClass.get(c.klass.id).push(c); }
    for (const list of byClass.values()) {
      list.sort((a, b) => (a.place || 999) - (b.place || 999));
      list.forEach((c, k) => { c.classPos = c.place ? k + 1 : 0; });
    }
    // темп класса — медиана оценок времени круга от игры
    const estLap = new Map();
    for (const [id, list] of byClass) {
      const xs = list.map((c) => c.est).filter((x) => x > 0).sort((a, b) => a - b);
      estLap.set(id, xs.length ? xs[xs.length >> 1] : 0);
    }

    // --- переменные в виде iRacing
    const vars = {
      PlayerCarIdx: playerIdx, CamCarIdx: playerIdx,
      SessionNum: sessionNum, SessionTime: et,
      SessionTimeRemain: endET > 0 && endET < 1e6 ? Math.max(endET - et, 0) : -1,
      SessionTimeTotal: endET > 0 && endET < 1e6 ? endET : 0,
      SessionLapsTotal: maxLaps > 0 && maxLaps < 32767 ? maxLaps : 32767,
      SessionState: this.sessionState(phase),
      IsReplayPlaying: false,
      IsOnTrack: !!me && inRealtime && !me.garage,
      IsInGarage: !!me && (!inRealtime || me.garage),
      CarIdxLapDistPct: new Array(n), CarIdxLap: new Array(n), CarIdxLapCompleted: new Array(n), CarIdxEstTime: new Array(n),
      CarIdxPosition: new Array(n), CarIdxClassPosition: new Array(n), CarIdxF2Time: new Array(n),
      CarIdxBestLapTime: new Array(n), CarIdxLastLapTime: new Array(n), CarIdxOnPitRoad: new Array(n),
      CarIdxTrackSurface: new Array(n), CarIdxClass: new Array(n), CarIdxTireCompound: new Array(n).fill(-1),
      AirTemp: sc.readDoubleLE(SC.ambientTemp), TrackTemp: sc.readDoubleLE(SC.trackTemp), TrackTempCrew: sc.readDoubleLE(SC.trackTemp),
      Precipitation: sc.readDoubleLE(SC.raining), TrackWetness: Math.round(sc.readDoubleLE(SC.avgWetness) * 7),
      WindVel: Math.hypot(sc.readDoubleLE(SC.wind), sc.readDoubleLE(SC.wind + 8), sc.readDoubleLE(SC.wind + 16)),
      SessionTimeOfDay: sc.readFloatLE(SC.timeOfDay), DisplayUnits: 1,
    };
    for (const c of cars) {
      const pct = trackLen > 0 ? ((c.dist % trackLen) + trackLen) % trackLen / trackLen : 0;
      const away = c.garage;
      vars.CarIdxLapDistPct[c.i] = away ? -1 : pct;
      vars.CarIdxLap[c.i] = c.laps + 1;
      vars.CarIdxLapCompleted[c.i] = c.laps;
      vars.CarIdxEstTime[c.i] = c.timeInto > 0 ? c.timeInto : 0;
      vars.CarIdxPosition[c.i] = c.place;
      vars.CarIdxClassPosition[c.i] = c.classPos;
      vars.CarIdxF2Time[c.i] = c.behindLeader > 0 ? c.behindLeader : 0;
      vars.CarIdxBestLapTime[c.i] = c.best > 0 ? c.best : -1;
      vars.CarIdxLastLapTime[c.i] = c.last > 0 ? c.last : -1;
      vars.CarIdxOnPitRoad[c.i] = c.inPits;
      vars.CarIdxTrackSurface[c.i] = away ? -1 : c.inPits ? 2 : 3;
      vars.CarIdxClass[c.i] = c.klass.id;
    }

    // --- ваша машина
    if (me && playerIdx < active) {
      const to = playerIdx * TEL_SIZE;
      const vx = tel.readDoubleLE(to + TE.localVel), vy = tel.readDoubleLE(to + TE.localVel + 8), vz = tel.readDoubleLE(to + TE.localVel + 16);
      const rpm = tel.readDoubleLE(to + TE.rpm), maxRpm = tel.readDoubleLE(to + TE.maxRPM);
      const range = tel.readFloatLE(to + TE.visualSteerRange);
      const steer = tel.readDoubleLE(to + TE.unfSteer);
      const share = maxRpm > 0 ? rpm / maxRpm : 0;
      vars.Gear = tel.readInt32LE(to + TE.gear);
      vars.RPM = rpm;
      vars.Speed = Math.hypot(vx, vy, vz);
      vars.Throttle = tel.readDoubleLE(to + TE.unfThrottle);
      vars.Brake = tel.readDoubleLE(to + TE.unfBrake);
      vars.Clutch = 1 - tel.readDoubleLE(to + TE.unfClutch);                 // iRacing: 1 — сцепление включено (педаль отпущена)
      // руль: у LMU -1…1 слева направо, у iRacing положительный угол — влево; диапазон отдаётся в градусах на весь оборот руля
      vars.SteeringWheelAngle = range > 0 ? -steer * (range / 2) * Math.PI / 180 : 0;
      vars.BrakeABSactive = tel.readUInt8(to + TE.absActive) !== 0;
      vars.EngineWarnings = tel.readUInt8(to + TE.limiterActive) !== 0 ? 0x10 : 0;
      vars.ShiftIndicatorPct = Math.min(Math.max((share - 0.8) / 0.17, 0), 1);
      vars.FuelLevel = tel.readDoubleLE(to + TE.fuel);
      vars.WaterTemp = tel.readDoubleLE(to + TE.water);
      vars.OilTemp = tel.readDoubleLE(to + TE.oil);
      vars.dcBrakeBias = (1 - tel.readDoubleLE(to + TE.rearBrakeBias)) * 100;
      const lapTime = tel.readDoubleLE(to + TE.elapsed) - tel.readDoubleLE(to + TE.lapStartET);
      vars.LapCurrentLapTime = lapTime > 0 && lapTime < 3600 ? lapTime : 0;
      vars.LapBestLapTime = me.best > 0 ? me.best : -1;
      vars.LapLastLapTime = me.last > 0 ? me.last : -1;
      vars.LapDeltaToBestLap = tel.readDoubleLE(to + TE.deltaBest);
      vars.LapDeltaToBestLap_OK = me.best > 0;
      this.maxRpm = maxRpm;
    }
    vars.SessionFlags = this.flags(phase, yellowState, sc, me);

    // --- описание сессии в виде iRacing-YAML
    const sig = `${track}|${sessionNum}|${sc.readFloatLE(SC.startET)}|${cars.map((c) => `${c.name}/${c.vehicle}/${c.clsName}`).join(';')}`;
    if (sig !== this.sessionSig) {
      this.sessionSig = sig;
      this.sessionVersion++;
    }
    this.session = this.describe(track, trackLen, sessionNum, endET, cars, byClass, estLap, playerIdx, sc);
    return { vars, session: this.session, sessionVersion: this.sessionVersion };
  }

  describe(track, trackLen, sessionNum, endET, cars, byClass, estLap, playerIdx, sc) {
    const rpm = this.maxRpm || 8000;
    // CarClassRelSpeed в iRacing — относительная скорость класса (по нему Standings ставит быстрый класс выше).
    // У LMU такого поля нет: берём по темпу (самый быстрый класс = 100), а пока темпа нет — по старшинству из CLASSES
    const fastest = Math.min(...[...estLap.values()].filter((x) => x > 0));
    const relSpeed = (k) => {
      const est = estLap.get(k.id);
      if (est > 0 && Number.isFinite(fastest)) return Math.round(10000 * fastest / est) / 100;
      const idx = CLASSES.findIndex((c) => c.id === k.id);
      return idx >= 0 ? 90 - idx : 0;
    };
    return {
      WeekendInfo: {
        TrackDisplayName: track,
        TrackLength: `${(trackLen / 1000).toFixed(3)} km`,
        SubSessionID: hash32(`${track}|${sc.readFloatLE(SC.startET)}`) % 2147483000 + 1,
        Category: 'SportsCar',
        WeekendOptions: {},
      },
      SessionInfo: {
        Sessions: [{
          SessionNum: sessionNum,
          SessionType: SESSION_TYPES(sessionNum),
          SessionName: SESSION_LABEL(sessionNum),
          SessionTime: endET > 0 && endET < 1e6 ? `${endET.toFixed(4)} sec` : 'unlimited',
          ResultsPositions: [],
        }],
      },
      SplitTimeInfo: { Sectors: [] },
      DriverInfo: {
        DriverCarIdx: playerIdx,
        DriverCarRedLine: String(rpm), DriverCarIdleRPM: '1000',
        DriverCarSLFirstRPM: String(Math.round(rpm * 0.82)), DriverCarSLShiftRPM: String(Math.round(rpm * 0.93)),
        DriverCarSLLastRPM: String(Math.round(rpm * 0.97)), DriverCarSLBlinkRPM: String(Math.round(rpm * 0.985)),
        Drivers: cars.map((c) => ({
          CarIdx: c.i, UserName: c.name, TeamName: c.team, CarNumber: c.number || String(c.i),
          CarClassID: c.klass.id, CarClassShortName: c.klass.short, CarClassColor: c.klass.color,
          CarClassRelSpeed: relSpeed(c.klass), CarClassEstLapTime: estLap.get(c.klass.id) || 0,
          IRating: 0, LicString: 'R 0.00',
          CarPath: c.vehicle, CarScreenName: c.vehicle, CarScreenNameShort: c.team,
          CarIsPaceCar: c.pace ? 1 : 0, IsSpectator: 0,
        })),
      },
    };
  }

  // Фазы игры LMU → SessionState iRacing (4 — гонка идёт, 5 — клетчатый, 6 — остывание)
  sessionState(phase) {
    const map = { 0: 1, 1: 2, 2: 2, 3: 3, 4: 3, 5: 4, 6: 4, 7: 4, 8: 5 };
    if (phase in map) this.phase.state = map[phase];       // 9 — пауза: оставляем прежнее
    return this.phase.state;
  }

  flags(phase, yellowState, sc, me) {
    const now = Date.now();
    if (phase !== this.phase.last) { if (phase === 5 && this.phase.last >= 0) this.phase.greenSince = now; this.phase.last = phase; }
    let bits = 0;
    if (phase === 5 && now - this.phase.greenSince < 6000) bits |= FL.green;      // зелёный — только на старте и после рестарта
    if (phase === 6 || (yellowState >= 1 && yellowState <= 5)) bits |= FL.caution;
    if (phase === 7) bits |= FL.red;
    if (phase === 8) bits |= FL.checkered;
    // Местные жёлтые по секторам: значения в памяти пока не расшифрованы (в тихой сессии во всех трёх стоит 11), поэтому флаг по ним
    // не показываем, а изменения пишем в журнал — по ним потом уточним
    const sectors = [0, 1, 2].map((s) => sc.readInt8(SC.sectorFlag + s)).join(',');
    if (sectors !== this.sectors) { if (this.sectors != null) console.log(`[lmu] флаги секторов: ${this.sectors} → ${sectors}, фаза ${phase}`); this.sectors = sectors; }
    if (me) {
      if (me.finish === 1) bits |= FL.checkered;
      if (me.finish === 3) bits |= FL.disqualify;
      if (me.penalties > 0) bits |= FL.black;
      if (me.flag === 6) bits |= FL.blue;
    }
    return bits;
  }
}

function telemetryTime(tel, idx, active) {
  if (!(idx < active)) return 0;
  return tel.readDoubleLE(idx * TEL_SIZE + TE.elapsed);
}

module.exports = { LmuSdk, splitVehicleName };
