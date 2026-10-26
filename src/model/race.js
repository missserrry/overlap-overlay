// Сводное состояние гонки на один тик: список машин с позициями, отрывами и дельтами iRating.
// Используется и Relative, и Standings, чтобы считать всё один раз.
const {
  driverIndex, currentSession, sessionKind, parseSessionTime, referenceCar, strengthOfField, tireNames, tireInfo,
} = require('./common');
const { estimateIratingDeltas } = require('./irating');

let driverCache = { version: -1, drivers: new Map(), tires: new Map() };
// Стартовая решётка гонки: позиции в классе на старте. Берём из результатов квалификации, а если её не было —
// запоминаем позиции до зелёного флага (SessionState < 4) и замораживаем на старте.
let grid = { key: null, map: new Map(), frozen: false };

// Пит-стопы соперников: время на питлейне (въезд → выезд) и круг, на котором заехал. Считаем по смене CarIdxOnPitRoad.
// Если пилот уже стоял в боксах, когда мы его впервые увидели (старт из боксов, подключились посреди стопа), этот стоп не считаем:
// не знаем, когда он заехал.
let pits = { key: null, cars: new Map() };
const MIN_PIT_SEC = 2;
function trackPits(snap, cars) {
  const { vars, session } = snap;
  const key = `${snap.source}|${session?.WeekendInfo?.SubSessionID ?? 0}|${vars.SessionNum}`;
  if (pits.key !== key) pits = { key, cars: new Map() };
  const t = vars.SessionTime;
  if (!Number.isFinite(t)) return;
  for (const c of cars) {
    let s = pits.cars.get(c.carIdx);
    if (!s) {
      s = { on: false, valid: false, t0: 0, lap0: 0, last: null, stops: 0 }; pits.cars.set(c.carIdx, s); s.first = true;
      // демо: как будто идёт середина гонки, у части машин уже был пит-стоп (иначе колонки пустые, пока кто-то не заедет в боксы)
      if (snap.source === 'demo' && c.carIdx % 3 === 1 && c.lap > 3) { s.last = { lap: c.lap - 2 - (c.carIdx % 4), time: 22 + (c.carIdx % 9) * 1.7 }; s.stops = 1; }
    }
    const on = c.onPitRoad && c.inWorld;
    if (s.on && t < s.t0) { s.on = false; s.valid = false; }              // время пошло назад (повтор, перемотка)
    if (!s.on && on) { s.on = true; s.valid = !s.first; s.t0 = t; s.lap0 = c.lap; }
    else if (s.on && !c.onPitRoad) {
      if (s.valid && t - s.t0 >= MIN_PIT_SEC) { s.last = { lap: s.lap0, time: t - s.t0 }; s.stops++; }
      s.on = false; s.valid = false;
    }
    s.first = false;
    c.lastPit = s.last;
    c.pitStops = s.stops;
  }
}

// История кругов и секторов каждой машины: время круга по его номеру, время каждого из первых трёх секторов по номеру круга.
// Нужна, чтобы сравнивать пилотов «по прохождению»: дельта считается по одному и тому же кругу (и сектору), а не по текущему положению
// на трассе, поэтому не бегает вживую. Круги и секторы с заездом на питлейн в историю не попадают (пустое значение).
// Времена секторов считаем сами: iRacing не отдаёт чужие сектора — берём момент пересечения границы (по CarIdxLapDistPct, с интерполяцией
// между двумя тиками) из SplitTimeInfo.Sectors.
let timing = { key: null, cars: new Map() };
const KEEP_LAPS_HIST = 8, MAX_SECTORS = 64, MAX_STEP = 0.1;   // шаг по трассе больше 10% за тик — телепорт, эвакуатор: не считаем
function trimHist(map) { while (map.size > KEEP_LAPS_HIST) map.delete(Math.min(...map.keys())); }
function trackTiming(snap, cars, sectorsInfo) {
  const { vars, session } = snap;
  const key = `${snap.source}|${session?.WeekendInfo?.SubSessionID ?? 0}|${vars.SessionNum}`;
  if (timing.key !== key) timing = { key, cars: new Map() };
  const t = vars.SessionTime;
  if (!Number.isFinite(t)) return;
  const starts = (sectorsInfo || []).map((s) => Number(s.SectorStartPct)).filter(Number.isFinite).sort((a, b) => a - b);
  if (starts[0] !== 0) starts.unshift(0);                       // первый сектор начинается на линии
  for (const c of cars) {
    let s = timing.cars.get(c.carIdx);
    if (!s) {
      s = { laps: new Map(), secs: new Map(), dirty: new Set(), lap: null, last: null, pend: null, wait: null, prev: null, enter: null };
      timing.cars.set(c.carIdx, s);
      // демо: как будто гонка идёт давно — несколько кругов и секторов уже в истории, дельты видны сразу, а не после первых кругов
      if (snap.source === 'demo' && c.lastLap > 0 && c.lap > 3) {
        for (let k = 1; k <= 3; k++) {
          const lap = c.lap - k;
          s.laps.set(lap, c.lastLap * (1 + 0.004 * Math.sin(c.carIdx * 1.7 + lap)));
          s.secs.set(lap, starts.map((st, i) => c.lastLap * ((starts[i + 1] ?? 1) - st) * (1 + 0.012 * Math.sin(c.carIdx * 2.3 + i * 1.1 + lap))));
        }
        s.secDone = { idx: Math.min(2, starts.length - 1), n: Math.min(3, starts.length) };
      }
    }
    c.timing = s;
    s.count = starts.length;
    if (!c.inWorld || !(c.lapDistPct >= 0)) { s.prev = null; s.enter = null; s.lap = c.lap; continue; }
    if (c.onPitRoad) { s.dirty.add(c.lap); if (s.enter) s.enter.dirty = true; }

    // --- круги: номер завершённого круга и время приходят на границе круга; порядок двух обновлений может быть любым
    if (c.lap > (s.lap ?? c.lap)) {
      s.pend = c.lap - 1;
      if (s.wait != null) { s.laps.set(s.pend, s.dirty.has(s.pend) ? null : s.wait); s.wait = null; s.pend = null; trimHist(s.laps); }
    }
    if (!s.seen) { s.seen = true; s.last = c.lastLap; }          // значение, которое уже было, когда мы увидели машину, — не наш круг
    else if (c.lastLap != null && c.lastLap !== s.last) {
      if (s.pend != null) { s.laps.set(s.pend, s.dirty.has(s.pend) ? null : c.lastLap); s.pend = null; trimHist(s.laps); }
      else s.wait = c.lastLap;
      s.last = c.lastLap;
    }

    // --- сектора: пересечения границ между прошлым и этим тиком
    const p = c.lapDistPct;
    if (s.prev && starts.length > 1) {
      let dp = p - s.prev.p;
      if (dp < -0.5) dp += 1;
      if (dp > 0 && dp <= MAX_STEP) {
        const a = s.prev.p, b = a + dp;                          // b может быть больше 1: линия старта внутри шага
        for (let j = 0; j < starts.length; j++) {
          for (const bound of [starts[j], starts[j] + 1]) {
            if (!(bound > a && bound <= b)) continue;
            const tc = s.prev.t + ((bound - a) / dp) * (t - s.prev.t);
            if (s.enter && s.enter.sector === (j + starts.length - 1) % starts.length) {
              const idx = s.enter.sector;
              if (idx < MAX_SECTORS) {
                const row = s.secs.get(s.enter.lap) || new Array(starts.length).fill(null);
                row[idx] = s.enter.dirty ? null : tc - s.enter.t;
                s.secs.set(s.enter.lap, row);
                trimHist(s.secs);
                s.secDone = { idx, n: (s.secDone?.n ?? 0) + 1 };      // какой сектор закончен последним и сколько их закончено за сессию
              }
            }
            const lapNow = j === 0 && c.lap === s.lap ? c.lap + 1 : c.lap;   // линия пересечена, а счётчик кругов ещё не обновился
            s.enter = { sector: j, t: tc, lap: lapNow, dirty: !!c.onPitRoad };
          }
        }
      } else if (dp > MAX_STEP || dp <= 0) s.enter = null;
    }
    s.prev = { p, t };
    s.lap = c.lap;
  }
}

function buildRaceState(snap) {
  const { vars, session } = snap;
  if (driverCache.version !== snap.sessionVersion) {
    driverCache = { version: snap.sessionVersion, drivers: driverIndex(session), tires: tireNames(session) };
  }
  const drivers = driverCache.drivers;
  const sess = currentSession(session, vars.SessionNum);
  const kind = sessionKind(sess);
  const refIdx = referenceCar(vars);

  // Результаты из YAML (обновляются раз в несколько секунд) — запасной источник позиций
  const results = new Map();
  for (const r of sess?.ResultsPositions || []) results.set(r.CarIdx, r);

  const pct = vars.CarIdxLapDistPct || [];
  const cars = [];
  for (const d of drivers.values()) {
    const i = d.carIdx;
    const surface = vars.CarIdxTrackSurface?.[i] ?? -1;
    const p = pct[i] ?? -1;
    const res = results.get(i);
    const best = vars.CarIdxBestLapTime?.[i] ?? -1;
    cars.push({
      ...d,
      inWorld: surface !== -1 && p >= 0,
      lapDistPct: p,
      lap: vars.CarIdxLap?.[i] ?? -1,
      totalDist: (vars.CarIdxLap?.[i] ?? 0) + Math.max(p, 0),
      estTime: vars.CarIdxEstTime?.[i] ?? 0,
      f2Time: vars.CarIdxF2Time?.[i] ?? 0,
      onPitRoad: !!vars.CarIdxOnPitRoad?.[i],
      bestLap: best > 0 ? best : (res?.FastestTime > 0 ? res.FastestTime : null),
      lastLap: (vars.CarIdxLastLapTime?.[i] ?? -1) > 0 ? vars.CarIdxLastLapTime[i] : null,
      livePos: vars.CarIdxPosition?.[i] || 0,
      liveClassPos: vars.CarIdxClassPosition?.[i] || 0,
      resultsClassPos: res ? res.ClassPosition + 1 : 0,
      resultsLapsComplete: res?.LapsComplete ?? null,
      isPlayer: i === refIdx,
      tire: tireInfo(vars.CarIdxTireCompound?.[i], driverCache.tires),
    });
  }

  // Классы: позиции внутри класса, лидер, SOF, оценка iRating
  const classes = new Map();
  for (const c of cars) {
    if (!classes.has(c.classId)) {
      classes.set(c.classId, {
        id: c.classId, name: c.className, color: c.classColor, relSpeed: c.classRelSpeed,
        estLap: c.classEstLap, cars: [],
      });
    }
    classes.get(c.classId).cars.push(c);
  }

  // В гонке после старта порядок считаем «вживую» по пройденной дистанции (круги + доля круга): позиции iRacing
  // (CarIdxPosition, CarIdxClassPosition) и время отрыва (CarIdxF2Time) обновляются только при пересечении линии.
  const live = kind === 'race' && (vars.SessionState ?? 0) >= 4;

  for (const cls of classes.values()) {
    const sorted = [...cls.cars].sort((a, b) => classOrder(a, b, kind, live));
    sorted.forEach((c, i) => { c.classPos = i + 1; });
    cls.cars = sorted;
    cls.leader = sorted[0];
    cls.sof = strengthOfField(sorted.map((c) => c.irating));
    cls.fastest = sorted.reduce((m, c) => (c.bestLap && (!m || c.bestLap < m) ? c.bestLap : m), null);

    if (kind === 'race') {
      const deltas = estimateIratingDeltas(sorted.map((c) => ({ carIdx: c.carIdx, irating: c.irating, position: c.classPos })));
      for (const c of sorted) c.iratingDelta = deltas.get(c.carIdx) ?? null;
    }
    sorted.forEach((c, i) => {
      c.gap = gapToLeader(c, cls.leader, kind, live);
      c.int = gapToLeader(c, sorted[i - 1] || c, kind, live); // интервал — тот же расчёт, но до машины впереди
    });
  }

  // общая позиция (для «P7» в подвале): тоже по дистанции, если порядок живой
  const overall = [...cars].sort((a, b) => (live && a.inWorld && b.inWorld ? b.totalDist - a.totalDist : (a.livePos || 999) - (b.livePos || 999)));
  overall.forEach((c, i) => { c.overallPos = live ? i + 1 : c.livePos; });

  updateGrid(snap, kind, cars);
  trackPits(snap, cars);
  trackTiming(snap, cars, snap.session?.SplitTimeInfo?.Sectors);
  for (const c of cars) {
    const start = kind === 'race' ? grid.map.get(c.carIdx) : null;
    c.posChange = start && c.classPos ? start - c.classPos : null; // > 0 — отыграл позиции
  }

  const ref = cars.find((c) => c.isPlayer) || null;
  const totalTime = parseSessionTime(sess?.SessionTime) ?? (vars.SessionTimeTotal > 0 ? vars.SessionTimeTotal : null);
  const clock = raceClock(snap, kind, totalTime);
  const incidentLimit = parseInt(session?.WeekendInfo?.WeekendOptions?.IncidentLimit, 10);

  return {
    kind,
    demo: snap.source === 'demo',
    sessionName: String(sess?.SessionName || sess?.SessionType || '').toUpperCase(),
    cars, classes, ref, refIdx, vars,
    trackLength: session?.WeekendInfo?.TrackLength,
    pitSpeedLimit: session?.WeekendInfo?.TrackPitSpeedLimit,
    driverInfo: session?.DriverInfo,
    sectorsInfo: session?.SplitTimeInfo?.Sectors,
    multiClass: classes.size > 1,
    sof: strengthOfField(cars.map((c) => c.irating)),
    session: {
      elapsed: clock.elapsed,
      remain: vars.SessionTimeRemain >= 0 && vars.SessionTimeRemain < 604800 ? vars.SessionTimeRemain : null,
      total: clock.total,
      lapsTotal: vars.SessionLapsTotal > 0 && vars.SessionLapsTotal < 32767 ? vars.SessionLapsTotal : null,
    },
    incidents: vars.PlayerCarMyIncidentCount ?? 0,
    incidentLimit: Number.isFinite(incidentLimit) ? incidentLimit : null,
  };
}

// Часы гонки. SessionTime идёт с начала сессии (с сетки и круга прогрева), а длина в описании сессии может включать то же лишнее время:
// выходило «16 из 122 мин» вместо «16 из 120». Остаток (SessionTimeRemain) стартует с зелёного флага и честный: длину гонки берём как остаток
// перед зелёным, прошло = длина − остаток. Если оверлей запущен посреди гонки, зелёного не видели — считаем как раньше.
let rclock = { key: null, total: null, last: null };
function raceClock(snap, kind, totalTime) {
  const { vars, session } = snap;
  const plain = { elapsed: vars.SessionTime ?? 0, total: totalTime };
  if (kind !== 'race') return plain;
  const key = `${snap.source}|${session?.WeekendInfo?.SubSessionID ?? 0}|${vars.SessionNum}`;
  if (rclock.key !== key) rclock = { key, total: null, last: null };
  const remain = vars.SessionTimeRemain;
  if (!(remain >= 0 && remain < 604800)) return plain;
  const state = vars.SessionState ?? 0;
  if (rclock.total == null) {
    if (state >= 1 && state <= 3) rclock.last = remain;               // до зелёного остаток равен длине гонки
    else if (state === 4 && rclock.last != null && remain >= rclock.last - 5) rclock.total = Math.max(rclock.last, remain);
    if (rclock.total == null) return state >= 1 && state <= 3 && rclock.last != null ? { elapsed: 0, total: rclock.last } : plain;
  }
  return { elapsed: Math.max(rclock.total - remain, 0), total: rclock.total };
}

function updateGrid(snap, kind, cars) {
  const { vars, session } = snap;
  if (kind !== 'race') return;
  const key = `${session?.WeekendInfo?.SubSessionID ?? 0}|${vars.SessionNum}`;
  if (grid.key !== key) {
    grid = { key, map: new Map(), frozen: false };
    const q = session?.QualifyResultsInfo?.Results;
    if (Array.isArray(q) && q.length) {
      // ClassPosition в YAML — с нуля
      for (const r of q) if (r.ClassPosition != null) grid.map.set(r.CarIdx, r.ClassPosition + 1);
      grid.frozen = grid.map.size > 0;
    }
  }
  if (grid.frozen) return;
  if (vars.SessionState >= 4) { grid.frozen = true; return; }
  for (const c of cars) if (c.classPos && c.liveClassPos) grid.map.set(c.carIdx, c.classPos);
}

// Порядок внутри класса: живая позиция в гонке, иначе результаты, иначе лучший круг
function classOrder(a, b, kind, live = false) {
  if (live && a.inWorld && b.inWorld) return b.totalDist - a.totalDist;
  const pa = kind === 'race' ? (a.liveClassPos || a.resultsClassPos) : (a.resultsClassPos || 0);
  const pb = kind === 'race' ? (b.liveClassPos || b.resultsClassPos) : (b.resultsClassPos || 0);
  if (pa && pb) return pa - pb;
  if (pa) return -1;
  if (pb) return 1;
  if (a.bestLap && b.bestLap) return a.bestLap - b.bestLap;
  if (a.bestLap) return -1;
  if (b.bestLap) return 1;
  return b.totalDist - a.totalDist;
}

// Отрыв: в гонке — по дистанции (живой), иначе по лучшему кругу.
// Время до лидера/машины впереди = недостающая доля круга × темп этой машины; на круг и больше — «+N кругов».
function gapToLeader(car, leader, kind, live = false) {
  if (car === leader) return { type: 'leader' };
  if (kind === 'race') {
    if (live && car.inWorld && leader.inWorld) {
      const delta = leader.totalDist - car.totalDist;               // в кругах
      const lapsDown = Math.floor(delta);
      if (lapsDown >= 1) return { type: 'laps', value: lapsDown };
      const lapRef = car.classEstLap || car.lastLap || car.bestLap || leader.classEstLap || leader.lastLap || 100;
      return { type: 'time', value: Math.max(delta * lapRef, 0) };
    }
    const lapsDown = Math.floor(leader.totalDist - car.totalDist);
    if (lapsDown >= 1) return { type: 'laps', value: lapsDown };
    const t = car.f2Time - leader.f2Time;
    return t > 0 ? { type: 'time', value: t } : { type: 'none' };
  }
  if (car.bestLap && leader.bestLap) return { type: 'time', value: car.bestLap - leader.bestLap };
  return { type: 'none' };
}

module.exports = { buildRaceState, trackPits, trackTiming };
