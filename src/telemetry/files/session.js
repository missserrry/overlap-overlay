// Файл телеметрии → единый вид для окна «Телеметрия», независимо от игры:
//   meta  — игра, машина, трасса, пилот, дата, длина трассы, начала секторов (доли круга);
//   ряды одной частоты: t (время сессии, с), lat/lon (градусы), alt (м, только iRacing), dist (м от линии старта),
//   speed (м/с), thr/brk/clu (0..1), steer (угол руля, градусы, + влево), gear, rpm,
//   pathLat/edge (только LMU: смещение от осевой трассы и до края, м — по ним строятся настоящие края);
//   laps  — круги: индексы, время, полный ли круг, засчитан ли, были ли боксы и вылеты.
const path = require('path');
const { readIbtInfo, readIbtChannels } = require('./ibt');
const { readLmuInfo, readLmuChannels } = require('./lmu');

const kindOf = (file) => (/\.ibt$/i.test(file) ? 'iracing' : /\.duckdb$/i.test(file) ? 'lmu' : null);
const num = (s) => { const m = String(s ?? '').match(/-?[\d.]+/); return m ? Number(m[0]) : null; };

// ---------- описание файла для библиотеки (быстро) ----------

async function describe(file) {
  const kind = kindOf(file);
  if (kind === 'iracing') {
    const { head, session } = readIbtInfo(file);
    const w = session?.WeekendInfo || {};
    const di = session?.DriverInfo || {};
    const me = di.Drivers?.find((d) => d.CarIdx === di.DriverCarIdx) || {};
    return {
      source: 'iracing', file, name: path.basename(file),
      car: me.CarScreenName || me.CarPath || '', carId: me.CarPath || '', carClass: me.CarClassShortName || '',
      track: w.TrackDisplayName || w.TrackName || '', trackConfig: w.TrackConfigName || '', trackId: w.TrackName || String(w.TrackID ?? ''),
      driver: me.UserName || '', date: head.startDate ? head.startDate * 1000 : null,
      duration: Math.max(0, head.endTime - head.startTime), lapCount: head.lapCount,
    };
  }
  if (kind === 'lmu') {
    const { meta, laps, span } = await readLmuInfo(file);
    const date = Date.parse(String(meta.RecordingTime || '').replace(/T(\d+)_(\d+)_(\d+)/, 'T$1:$2:$3'));
    return {
      source: 'lmu', file, name: path.basename(file),
      car: meta.CarName || '', carId: meta.CarName || '', carClass: meta.CarClass || '',
      track: meta.TrackName || '', trackConfig: meta.TrackLayout && meta.TrackLayout !== meta.TrackName ? meta.TrackLayout : '',
      trackId: `${meta.TrackName || ''}|${meta.TrackLayout || ''}`,
      driver: meta.DriverName || '', date: Number.isFinite(date) ? date : null, sessionType: meta.SessionType || '',
      duration: span ? span[1] - span[0] : 0, lapCount: laps.length,
    };
  }
  throw new Error('неизвестный формат файла');
}

// ---------- полное чтение ----------

// Педали — «сырые» (ThrottleRaw/BrakeRaw): то, что нажал пилот. В Throttle машина подмешивает свою автоперегазовку при понижении
// передачи и отсечку при повышении — на графике это «штыки», которых пилот не делал. В старых файлах сырых каналов нет — берём обычные.
// YawNorth — куда смотрит машина (от физики, ровно и с заносом); курс по GPS заметно шумнее
const IBT_CHANNELS = ['SessionTime', 'SessionNum', 'Lap', 'LapDist', 'LapDistPct', 'Lat', 'Lon', 'Alt', 'YawNorth', 'Speed', 'Throttle', 'Brake', 'ThrottleRaw', 'BrakeRaw', 'Clutch',
  'SteeringWheelAngle', 'Gear', 'RPM', 'OnPitRoad', 'PlayerTrackSurface', 'PlayerCarMyIncidentCount', 'LapLastLapTime'];

function loadIracing(file) {
  const { session, n, ch, head } = readIbtChannels(file, IBT_CHANNELS);
  const w = session?.WeekendInfo || {};
  const di = session?.DriverInfo || {};
  const me = di.Drivers?.find((d) => d.CarIdx === di.DriverCarIdx) || {};
  const f32 = (a, k = 1) => { const o = new Float32Array(n); if (a) for (let i = 0; i < n; i++) o[i] = a[i] * k; return o; };
  const s = {
    meta: {
      source: 'iracing', file, car: me.CarScreenName || me.CarPath || '', carId: me.CarPath || '', track: w.TrackDisplayName || w.TrackName || '',
      trackConfig: w.TrackConfigName || '', trackId: w.TrackName || '', driver: me.UserName || '', date: head.startDate ? head.startDate * 1000 : null,
      trackLength: (num(w.TrackLength) || 0) * 1000, redline: di.DriverCarRedLine || null,
      sectors: (session?.SplitTimeInfo?.Sectors || []).map((x) => x.SectorStartPct).filter((p) => p > 0 && p < 1),
      hz: head.tickRate || 60,
    },
    n, t: ch.SessionTime || new Float64Array(n), lat: ch.Lat || null, lon: ch.Lon || null, alt: f32(ch.Alt), yaw: ch.YawNorth ? f32(ch.YawNorth) : null,
    dist: f32(ch.LapDist), speed: f32(ch.Speed), thr: f32(ch.ThrottleRaw || ch.Throttle), brk: f32(ch.BrakeRaw || ch.Brake),
    // в iRacing Clutch: 1 — педаль отпущена, 0 — выжата; приводим к «насколько нажата»
    clu: ch.Clutch ? Float32Array.from(ch.Clutch, (v) => 1 - v) : new Float32Array(n),
    steer: f32(ch.SteeringWheelAngle, 180 / Math.PI), gear: fixGear(f32(ch.Gear), head.tickRate || 60), rpm: f32(ch.RPM), pathLat: null, edge: null,
  };
  s.laps = iracingLaps(s, ch);
  return s;
}

// Круги iRacing: граница — смена номера круга, когда доля круга перескакивает с ~1 на ~0.
// Время пересечения линии уточняем по доле круга между соседними тиками.
function iracingLaps(s, ch) {
  const { n, t } = s;
  const lap = ch.Lap, pct = ch.LapDistPct, sess = ch.SessionNum;
  if (!lap || !pct || n < 2) return [];
  const cross = (i) => {
    const a = pct[i - 1], b = pct[i] + 1;
    const k = b > a ? (1 - a) / (b - a) : 0;
    return t[i - 1] + (t[i] - t[i - 1]) * Math.min(1, Math.max(0, k));
  };
  const starts = [{ i: 0, line: false }];
  for (let i = 1; i < n; i++) {
    const gap = t[i] - t[i - 1] > 0.5 || (sess && sess[i] !== sess[i - 1]);
    if (gap) starts.push({ i, line: false });
    else if (lap[i] !== lap[i - 1]) starts.push({ i, line: pct[i - 1] > 0.9 && pct[i] < 0.1, at: cross(i) });
  }
  const laps = [];
  for (let k = 0; k < starts.length; k++) {
    const a = starts[k], b = starts[k + 1];
    const i0 = a.i, i1 = (b ? b.i : n) - 1;
    if (i1 - i0 < 10) continue;
    const complete = !!(a.line && b?.line);
    let pit = false, off = false;
    for (let i = i0; i <= i1; i++) {
      if (ch.OnPitRoad?.[i]) pit = true;
      if (ch.PlayerTrackSurface?.[i] === 0) off = true;
    }
    const inc = ch.PlayerCarMyIncidentCount ? ch.PlayerCarMyIncidentCount[i1] - ch.PlayerCarMyIncidentCount[i0] : 0;
    const start = a.line ? a.at : t[i0];
    const end = b?.line ? b.at : t[i1];
    let time = complete ? end - start : null;
    // официальное время iRacing появляется в LapLastLapTime через доли секунды после линии
    let official = null;
    if (complete && ch.LapLastLapTime) {
      for (let i = b.i; i < Math.min(n, b.i + 240); i++) {
        const v = ch.LapLastLapTime[i];
        if (v > 0 && Math.abs(v - time) < 1) { official = v; break; }
      }
      if (official) time = official;
    }
    laps.push({ num: lap[i0], i0, i1, start, time, complete, pit, off, inc, valid: complete && !pit && !off && official !== null });
  }
  return laps;
}

// педали LMU — Unfiltered (нажатие пилота), обычные — после автоперегазовки и помощников
const LMU_CHANNELS = ['GPS Time', 'GPS Latitude', 'GPS Longitude', 'Lap Dist', 'Ground Speed', 'Throttle Pos', 'Brake Pos', 'Throttle Pos Unfiltered', 'Brake Pos Unfiltered', 'Clutch Pos',
  'Steering Pos', 'Engine RPM', 'Path Lateral', 'Track Edge'];
const LMU_EVENTS = ['Lap', 'Lap Time', 'Gear', 'In Pits', 'Current Sector'];
const LMU_HZ = 50;
// LMU пишет руль в процентах от полного поворота; градусы считаем по типичному повороту руля 540° (±270°)
const LMU_STEER_DEG = 270;

// Нейтраль на долю секунды при переключении (между двумя передачами) — не настоящая нейтраль: показываем новую передачу
function fixGear(g, hz) {
  const max = Math.round(hz * 0.35);
  for (let i = 1; i < g.length; i++) {
    if (g[i] !== 0 || g[i - 1] === 0) continue;
    let j = i;
    while (j < g.length && g[j] === 0 && j - i <= max) j++;
    if (j < g.length && g[j] !== 0 && j - i <= max) for (let k = i; k < j; k++) g[k] = g[j];
    i = j;
  }
  return g;
}

async function loadLmu(file) {
  const { meta, ch, ev } = await readLmuChannels(file, LMU_CHANNELS, LMU_EVENTS);
  const gt = ch['GPS Time'];
  const t0 = gt?.values.length ? gt.values[0] : (ev.Lap?.[0]?.[0] ?? 0);
  const dur = gt ? gt.values.length / gt.freq : Math.max(...Object.values(ch).map((c) => c.values.length / c.freq));
  const n = Math.max(0, Math.floor(dur * LMU_HZ));
  const t = new Float64Array(n);
  for (let j = 0; j < n; j++) t[j] = t0 + j / LMU_HZ;
  let trackLength = 0;
  if (ch['Lap Dist']) for (const v of ch['Lap Dist'].values) if (v > trackLength) trackLength = v;
  // постоянный канал на сетку времени окна; wrap — значения, которые перескакивают через ноль на линии (дистанция круга)
  // smooth — кривая Катмулла-Рома через соседние отсчёты (для GPS: 10 Гц линейно дали бы излом на каждом отсчёте — машина дёргалась бы)
  const sample = (name, k = 1, wrap = 0, T = Float32Array, smooth = false) => {
    const c = ch[name];
    const out = new T(n);
    if (!c) return out;
    const v = c.values, last = v.length - 1;
    for (let j = 0; j < n; j++) {
      const x = (t[j] - t0) * c.freq;
      const i = Math.min(last, Math.max(0, Math.floor(x)));
      const i2 = Math.min(last, i + 1), f = Math.min(1, Math.max(0, x - i));
      const a = v[i], b = v[i2];
      if (smooth) {
        const p0 = v[Math.max(0, i - 1)], p3 = v[Math.min(last, i + 2)];
        const f2 = f * f, f3 = f2 * f;
        out[j] = (0.5 * (2 * a + (b - p0) * f + (2 * p0 - 5 * a + 4 * b - p3) * f2 + (3 * a - p0 - 3 * b + p3) * f3)) * k;
      } else out[j] = (wrap && Math.abs(b - a) > wrap / 2 ? (f < 0.5 ? a : b) : a + (b - a) * f) * k;
    }
    return out;
  };
  const step = (name) => {
    const out = new Float32Array(n), e = ev[name] || [];
    let k = 0, cur = e.length ? e[0][1] : 0;
    for (let j = 0; j < n; j++) {
      while (k < e.length && e[k][0] <= t[j] + 1e-6) cur = e[k++][1];
      out[j] = cur;
    }
    return out;
  };
  const s = {
    meta: {
      source: 'lmu', file, car: meta.CarName || '', carId: meta.CarName || '', track: meta.TrackName || '',
      trackConfig: meta.TrackLayout && meta.TrackLayout !== meta.TrackName ? meta.TrackLayout : '',
      trackId: `${meta.TrackName || ''}|${meta.TrackLayout || ''}`, driver: meta.DriverName || '',
      date: Date.parse(String(meta.RecordingTime || '').replace(/T(\d+)_(\d+)_(\d+)/, 'T$1:$2:$3')) || null,
      trackLength, redline: null, sectors: [], hz: LMU_HZ,
    },
    n, t,
    lat: sample('GPS Latitude', 1, 0, Float64Array, true), lon: sample('GPS Longitude', 1, 0, Float64Array, true), alt: null,
    dist: sample('Lap Dist', 1, trackLength), speed: sample('Ground Speed', 1 / 3.6),
    thr: sample(ch['Throttle Pos Unfiltered'] ? 'Throttle Pos Unfiltered' : 'Throttle Pos', 0.01),
    brk: sample(ch['Brake Pos Unfiltered'] ? 'Brake Pos Unfiltered' : 'Brake Pos', 0.01), clu: sample('Clutch Pos', 0.01),
    steer: sample('Steering Pos', -LMU_STEER_DEG / 100), gear: fixGear(step('Gear'), LMU_HZ), rpm: sample('Engine RPM'),
    pathLat: ch['Path Lateral'] ? sample('Path Lateral') : null, edge: ch['Track Edge'] ? sample('Track Edge') : null,
  };
  const inPits = step('In Pits');
  s.laps = lmuLaps(s, ev, inPits);
  s.meta.sectors = lmuSectors(s, ev['Current Sector'] || []);
  return s;
}

// Круги LMU: граница — событие Lap. Lap Time в момент границы — время только что законченного круга, 0 — круг не засчитан.
function lmuLaps(s, ev, inPits) {
  const { n, t, dist } = s;
  const marks = ev.Lap || [];
  const times = new Map((ev['Lap Time'] || []).map(([ts, v]) => [ts.toFixed(3), v]));
  const L = s.meta.trackLength;
  const idx = (ts) => Math.min(n - 1, Math.max(0, Math.round((ts - t[0]) * LMU_HZ)));
  // событие Lap и перескок дистанции через ноль расходятся на доли секунды: границей берём сам перескок,
  // а если его рядом нет (запись началась посреди круга, телепорт в боксы) — круг неполный
  const bounds = marks.map(([ts, num]) => {
    const c = idx(ts);
    for (let j = Math.max(1, c - LMU_HZ); j <= Math.min(n - 1, c + LMU_HZ); j++) {
      if (dist[j - 1] - dist[j] > L / 2) return { ts, num, i: j, line: true };
    }
    return { ts, num, i: c, line: false };
  });
  if (!bounds.length || bounds[0].i > 0) bounds.unshift({ ts: t[0], num: (marks[0]?.[1] ?? 1) - 1, i: 0, line: false });
  const laps = [];
  for (let k = 0; k < bounds.length; k++) {
    const a = bounds[k], b = bounds[k + 1];
    const i0 = a.i, i1 = (b ? b.i : n) - 1;
    if (i1 - i0 < 10) continue;
    const complete = !!(a.line && b?.line);
    let pit = false;
    for (let i = i0; i <= i1; i++) if (inPits[i]) { pit = true; break; }
    const official = b ? times.get(b.ts.toFixed(3)) : undefined;
    const time = complete ? (official > 0 ? official : b.ts - a.ts) : null;
    laps.push({ num: a.num, i0, i1, start: a.ts, time, complete, pit, off: false, inc: 0, valid: complete && !pit && official > 0 });
  }
  return laps;
}

// Начала секторов LMU — по событиям «Current Sector» (1 → 2 → 0): медиана доли круга на смене сектора
function lmuSectors(s, ev) {
  const L = s.meta.trackLength;
  if (!L || !ev.length) return [];
  const at = { 2: [], 0: [] };
  for (let k = 1; k < ev.length; k++) {
    const v = ev[k][1];
    if (!(v in at)) continue;
    const i = Math.round((ev[k][0] - s.t[0]) * LMU_HZ);
    if (i > 0 && i < s.n) at[v].push(s.dist[i] / L);
  }
  const med = (a) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
  return [med(at[2]), med(at[0])].filter((p) => p > 0 && p < 1);
}

async function load(file) {
  const kind = kindOf(file);
  if (kind === 'iracing') return loadIracing(file);
  if (kind === 'lmu') return loadLmu(file);
  throw new Error('неизвестный формат файла');
}

// Один круг для окна: ряды от линии до линии, время — от начала круга
function lapSlice(s, lapIndex) {
  const L = s.laps[lapIndex];
  if (!L) return null;
  const sl = (a) => (a ? a.slice(L.i0, L.i1 + 1) : null);
  const t = new Float32Array(L.i1 - L.i0 + 1);
  for (let i = 0; i < t.length; i++) t[i] = s.t[L.i0 + i] - L.start;
  return {
    meta: s.meta, lap: L, t,
    lat: sl(s.lat), lon: sl(s.lon), alt: sl(s.alt), yaw: sl(s.yaw), dist: sl(s.dist), speed: sl(s.speed), thr: sl(s.thr), brk: sl(s.brk),
    clu: sl(s.clu), steer: sl(s.steer), gear: sl(s.gear), rpm: sl(s.rpm), pathLat: sl(s.pathLat), edge: sl(s.edge),
  };
}

// ---------- трасса ----------

const R_EARTH = 6378137, RAD = Math.PI / 180;
const TRACK_STEP = 2; // м между точками осевой

// Осевая трассы через каждые 2 м: среднее полных кругов файла (засчитанных, если такие есть).
// iRacing краёв не пишет — ширину окно берёт из настройки. LMU пишет смещение от осевой (Path Lateral)
// и расстояние до края (Track Edge) — по ним восстанавливаем настоящую осевую и ширину в каждой точке.
function trackModel(s) {
  const L = s.meta.trackLength;
  let laps = s.laps.filter((l) => l.valid);
  if (!laps.length) laps = s.laps.filter((l) => l.complete);
  if (!laps.length) laps = [...s.laps].sort((a, b) => (b.i1 - b.i0) - (a.i1 - a.i0)).slice(0, 1);
  if (!L || !laps.length || !s.lat) return null;
  const N = Math.max(10, Math.round(L / TRACK_STEP));
  const step = L / N;
  const lat0 = s.lat[laps[0].i0], lon0 = s.lon[laps[0].i0];
  const kx = RAD * R_EARTH * Math.cos(lat0 * RAD), ky = RAD * R_EARTH;
  const lmu = !!(s.pathLat && s.edge);

  // один круг на сетке дистанции: x, y (м), высота, смещение и край
  const resample = (l) => {
    const o = { x: new Float64Array(N), y: new Float64Array(N), z: new Float64Array(N), lat: new Float64Array(N), edge: new Float64Array(N) };
    // дистанция внутри круга должна только расти: мелкие откаты (разворот, шум) срезаем
    const dm = new Float64Array(l.i1 - l.i0 + 1);
    for (let q = 0; q < dm.length; q++) dm[q] = Math.max(q ? dm[q - 1] : 0, s.dist[l.i0 + q]);
    let i = l.i0;
    for (let k = 0; k < N; k++) {
      const d = k * step;
      while (i < l.i1 && dm[i + 1 - l.i0] < d) i++;
      const d0 = dm[i - l.i0], d1 = dm[Math.min(l.i1, i + 1) - l.i0];
      const f = d1 > d0 ? Math.min(1, Math.max(0, (d - d0) / (d1 - d0))) : 0;
      const j = Math.min(l.i1, i + 1);
      const mix = (a) => a[i] + (a[j] - a[i]) * f;
      o.x[k] = (mix(s.lon) - lon0) * kx;
      o.y[k] = (mix(s.lat) - lat0) * ky;
      o.z[k] = s.alt ? mix(s.alt) : 0;
      if (lmu) { o.lat[k] = mix(s.pathLat); o.edge[k] = mix(s.edge); }
    }
    return o;
  };
  const rs = laps.map(resample);
  const nrm = (r, k) => {
    const a = (k - 1 + N) % N, b = (k + 1) % N;
    const tx = r.x[b] - r.x[a], ty = r.y[b] - r.y[a];
    const m = Math.hypot(tx, ty) || 1;
    return [-ty / m, tx / m]; // нормаль влево по ходу
  };
  // знак смещения LMU выбираем по данным: с правильным знаком осевая получается гладкой
  let sign = 1;
  if (lmu) {
    const rough = (sg) => {
      let sum = 0;
      for (const r of rs) {
        const cx = new Float64Array(N), cy = new Float64Array(N);
        for (let k = 0; k < N; k++) { const [nx, ny] = nrm(r, k); cx[k] = r.x[k] - nx * sg * r.lat[k]; cy[k] = r.y[k] - ny * sg * r.lat[k]; }
        for (let k = 1; k < N - 1; k++) sum += (cx[k + 1] - 2 * cx[k] + cx[k - 1]) ** 2 + (cy[k + 1] - 2 * cy[k] + cy[k - 1]) ** 2;
      }
      return sum;
    };
    sign = rough(1) <= rough(-1) ? 1 : -1;
  }
  const cx = new Float64Array(N), cy = new Float64Array(N), cz = new Float64Array(N);
  const hl = new Float64Array(N), hr = new Float64Array(N), nl = new Float64Array(N), nr = new Float64Array(N);
  for (const r of rs) {
    for (let k = 0; k < N; k++) {
      let x = r.x[k], y = r.y[k];
      if (lmu) {
        const [nx, ny] = nrm(r, k);
        x -= nx * sign * r.lat[k]; y -= ny * sign * r.lat[k];
        const e = sign * r.edge[k];
        if (e > 0) { hl[k] += e; nl[k]++; } else if (e < 0) { hr[k] -= e; nr[k]++; }
      }
      cx[k] += x / rs.length; cy[k] += y / rs.length; cz[k] += r.z[k] / rs.length;
    }
  }
  let hwL = null, hwR = null;
  if (lmu) {
    hwL = new Float32Array(N); hwR = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      const l = nl[k] ? hl[k] / nl[k] : 0, r = nr[k] ? hr[k] / nr[k] : 0;
      hwL[k] = l || r || 6; hwR[k] = r || l || 6;
    }
    const smooth = (a) => { const o = new Float32Array(N); for (let k = 0; k < N; k++) { let m = 0; for (let q = -4; q <= 4; q++) m += a[(k + q + N) % N]; o[k] = m / 9; } return o; };
    hwL = smooth(hwL); hwR = smooth(hwR);
  }
  const lat = new Float64Array(N), lon = new Float64Array(N);
  for (let k = 0; k < N; k++) { lat[k] = lat0 + cy[k] / ky; lon[k] = lon0 + cx[k] / kx; }
  const closed = Math.hypot(cx[0] - cx[N - 1], cy[0] - cy[N - 1]) < 30;
  return { step, lat, lon, alt: s.alt ? Float32Array.from(cz) : null, hwL, hwR, closed, laps: rs.length };
}

module.exports = { kindOf, describe, load, lapSlice, trackModel };
