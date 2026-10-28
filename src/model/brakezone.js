// Модели оверлеев режима «Тренировка»: «Торможение» (до зоны и итог зоны) и «Тормоз и руль» (график с эталоном «по прописям»).
// Эталон (src/model/training.js) приносит главный процесс. Пока вы едете, ряды вашего круга пишутся на ту же сетку 1 м, что и у эталона:
// по ним зона оценивается сразу после поворота, а график показывает ваш след поверх эталонной кривой.
// Запись общая для обоих оверлеев (advance), чтобы работал любой из них по отдельности.
// Всё важное пишется в лог со строкой «[training]»: по ней друг может прислать отчёт («Если что-то сломалось» в настройках).
const { trackLengthM } = require('./common');
const { compareZone, STEP } = require('./training');

const AFTER = 40;        // оцениваем зону, когда отъехали от её конца на столько метров (там апекс)
const MAX_FILL = 60;     // больше этого между двумя кадрами — телепорт (боксы, перезапуск), ряд не тянем
const KPH = 3.6;
const KEYS = ['speed', 'brk', 'thr', 'steer'];

// ---------- лог ----------
let sink = { info: () => {}, debug: () => {} };
function setLog(s) { sink = { info: s?.info || (() => {}), debug: s?.debug || (() => {}) }; }
const info = (m) => { try { sink.info(`[training] ${m}`); } catch { /* лог не должен ломать модель */ } };
const debug = (m) => { try { sink.debug(`[training] ${m}`); } catch { /* то же */ } };
const f0 = (n) => (Number.isFinite(n) ? n.toFixed(0) : '—');
const fs1 = (n) => (Number.isFinite(n) ? `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(0)}` : '—');

// ---------- запись круга ----------
let rec = null;          // состояние записи для текущего эталона
let frameKey = null, frameOut = null;   // один расчёт на кадр сервера, даже если подписаны оба оверлея
let lastStatus = '';

function maxAbs(a) { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i])); return m; }

function fresh(ref) {
  const r = {
    ref, lapNo: 0, last: -1, lastVals: null,
    grid: { n: ref.n, step: STEP, speed: new Float32Array(ref.n), brk: new Float32Array(ref.n), thr: new Float32Array(ref.n), steer: new Float32Array(ref.n) },
    done: new Set(),     // зоны, уже оценённые на этом круге
    results: new Map(),  // id зоны → оценка (последняя)
    lastId: null,        // какая зона оценена последней
    refSteerMax: Math.max(90, Math.ceil(maxAbs(ref.steer) / 30) * 30),
  };
  newLapStats(r);
  return r;
}

function newLapStats(r) {
  r.stats = { frames: 0, sumStep: 0, maxStep: 0, jumps: 0, steerMax: 0, brkMax: 0, startD: null, zones: 0, missed: 0, started: Date.now() };
}

function describeRef(ref) {
  info(`эталон подключён: «${ref.track}», ${ref.car}, круг ${ref.time?.toFixed?.(3) ?? '—'} с, длина ${f0(ref.length)} м, зон торможения ${ref.zones.length}, руль эталона до ±${f0(maxAbs(ref.steer))}°`);
  for (const z of ref.zones) info(`  Т${z.id}: ${f0(z.start)}–${f0(z.end)} м, пик ${z.peak.toFixed(2)}, вход ${f0(z.entrySpeed * KPH)} км/ч, апекс ${f0(z.minSpeed * KPH)} км/ч`);
}

function lapSummary(r) {
  const s = r.stats;
  if (s.frames < 20) return;
  const start = s.startD > 60 ? `, круг начат с ${f0(s.startD)} м (неполный)` : '';
  info(`круг ${r.lapNo} завершён: кадров ${s.frames} за ${((Date.now() - s.started) / 1000).toFixed(0)} с, шаг по дистанции ср. ${(s.sumStep / Math.max(1, s.frames - 1)).toFixed(1)} м, макс. ${f0(s.maxStep)} м, скачков ${s.jumps}; зон оценено ${s.zones} (не тормозил ${s.missed}) из ${r.ref.zones.length}; тормоз до ${s.brkMax.toFixed(2)}, руль до ±${f0(s.steerMax)}° (у эталона ±${f0(maxAbs(r.ref.steer))}°)${start}`);
}

function record(r, d, vals) {
  const g = r.grid, st = r.stats;
  const i = Math.min(g.n - 1, Math.max(0, Math.floor(d / STEP)));
  st.frames++;
  st.brkMax = Math.max(st.brkMax, vals.brk);
  st.steerMax = Math.max(st.steerMax, Math.abs(vals.steer));
  if (st.startD == null) st.startD = d;
  if (r.last >= 0 && i > r.last && i - r.last <= MAX_FILL && r.lastVals) {
    st.sumStep += i - r.last; st.maxStep = Math.max(st.maxStep, i - r.last);
    // кадры идут с шагом в несколько метров: промежутки заполняем линейно
    for (let k = r.last + 1; k <= i; k++) {
      const f = (k - r.last) / (i - r.last);
      for (const key of KEYS) g[key][k] = r.lastVals[key] + (vals[key] - r.lastVals[key]) * f;
    }
  } else {
    if (r.last >= 0 && Math.abs(i - r.last) > MAX_FILL) { st.jumps++; debug(`скачок дистанции ${f0(r.last)} → ${f0(i)} м: ряд не тянем`); }
    for (const key of KEYS) g[key][i] = vals[key];
  }
  r.last = i;
  r.lastVals = vals;
}

function status(s) {
  if (s === lastStatus) return;
  info(`состояние: ${lastStatus || '—'} → ${s}`);
  lastStatus = s;
}

// Один шаг: записать кадр, оценить пройденные зоны. Возвращает { active:false, reason } или { active:true, r, d, vals, v }.
function advance(race, ref) {
  if (frameKey === race && frameOut) return frameOut;
  frameKey = race;
  frameOut = step(race, ref);
  return frameOut;
}

function step(race, ref) {
  const v = race.vars || {};
  const me = race.ref;
  if (!ref) { status('нет эталона'); return { active: false, reason: 'noref' }; }
  if (!me || !me.inWorld || me.carIdx !== v.PlayerCarIdx) { status('вы не на трассе'); return { active: false, reason: 'idle' }; }
  const len = trackLengthM(race);
  if (!len || Math.abs(len - ref.length) / ref.length > 0.015) {
    status(`другая трасса: длина сессии ${len ? f0(len) : '—'} м, эталона ${f0(ref.length)} м («${ref.track}»)`);
    return { active: false, reason: 'track', refTrack: ref.track, refLength: ref.length, length: len || null };
  }
  const pct = v.CarIdxLapDistPct?.[me.carIdx];
  if (!(pct >= 0)) { status('нет дистанции круга'); return { active: false, reason: 'idle' }; }
  status('работает');

  if (!rec || rec.ref !== ref) { rec = fresh(ref); describeRef(ref); }
  const d = pct * ref.length;
  if (rec.last >= 0 && d < rec.last * STEP - ref.length / 2) {
    // пересекли линию старта/финиша: новый круг. Оценки прошлого круга остаются на экране, пока их не заменят новые
    lapSummary(rec);
    rec.lapNo++;
    rec.grid = fresh(ref).grid; rec.done = new Set(); rec.last = -1; rec.lastVals = null;
    newLapStats(rec);
  }
  const vals = { speed: Number.isFinite(v.Speed) ? v.Speed : 0, brk: v.Brake || 0, thr: v.Throttle || 0, steer: (v.SteeringWheelAngle || 0) * 180 / Math.PI };
  record(rec, d, vals);

  // оцениваем зоны, которые только что проехали
  for (const z of ref.zones) {
    if (rec.done.has(z.id)) continue;
    const past = d - z.end;
    if (past >= AFTER && past < AFTER + 250) {
      rec.done.add(z.id);
      const res = compareZone(ref, rec.grid, z);
      rec.results.set(z.id, res);
      rec.lastId = z.id;
      if (res.missed) { rec.stats.missed++; debug(`Т${z.id}: не тормозил (эталон начинал на ${f0(z.start)} м)`); }
      else { rec.stats.zones++; debug(`Т${z.id}: ${res.startDelta < 0 ? 'раньше' : 'позже'} на ${f0(Math.abs(res.startDelta))} м (вы ${f0(res.start)} м, эталон ${f0(z.start)} м), вход ${fs1(res.entrySpeedDelta * KPH)} км/ч, апекс ${fs1(res.minSpeedDelta * KPH)} км/ч, пик ${res.peak.toFixed(2)} (эталон ${z.peak.toFixed(2)})`); }
    } else if (past >= AFTER + 250 && d > z.end) rec.done.add(z.id);   // вставали посреди круга: эту зону не видели
  }
  return { active: true, r: rec, d, vals, v };
}

// ---------- оверлей «Торможение» ----------
function buildBrakeZone(race, ref) {
  const a = advance(race, ref);
  if (!a.active) return a;
  const { r, d, vals, v } = a;

  // где мы: внутри зоны эталона, либо ближайшая впереди (после финиша — с начала трассы)
  let inZone = null, next = null, best = Infinity;
  for (const z of ref.zones) {
    if (d >= z.start && d <= z.end) { inZone = z; continue; }
    let ahead = z.start - d;
    if (ahead < 0) ahead += ref.length;
    if (ahead < best) { best = ahead; next = { z, ahead }; }
  }
  const show = inZone ? { z: inZone, ahead: 0 } : next;
  const zinfo = (z) => ({ id: z.id, entrySpeed: z.entrySpeed * KPH, minSpeed: z.minSpeed * KPH, peak: z.peak, length: z.end - z.start });
  const last = r.lastId != null ? r.results.get(r.lastId) : null;
  return {
    active: true,
    dist: d,
    speed: vals.speed * KPH,
    brake: vals.brk,
    imperial: v.DisplayUnits === 0,
    count: ref.zones.length,
    zone: show ? { ...zinfo(show.z), ahead: show.ahead, inside: !!inZone } : null,
    last: last ? {
      id: last.id, missed: last.missed,
      startDelta: last.startDelta ?? null,
      entrySpeedDelta: last.missed ? null : last.entrySpeedDelta * KPH,
      minSpeedDelta: last.missed ? null : last.minSpeedDelta * KPH,
      peakDelta: last.missed ? null : last.peakDelta,
    } : null,
    refTime: ref.time,
  };
}

// ---------- оверлей «Тормоз и руль» ----------
const BACK = 100, FWD = 300, TSTEP = 2;   // окно графика: 100 м позади и 300 м впереди, точка через 2 м

function buildBrakeTrace(race, ref) {
  const a = advance(race, ref);
  if (!a.active) return a;
  const { r, d, vals } = a;
  const n = (BACK + FWD) / TSTEP + 1;
  const L = ref.length, g = r.grid;
  const refBrk = new Array(n), refSteer = new Array(n), myBrk = new Array(n), mySteer = new Array(n);
  for (let k = 0; k < n; k++) {
    const dist = d - BACK + k * TSTEP;
    const ri = Math.min(ref.n - 1, Math.max(0, Math.round((((dist % L) + L) % L) / STEP)));
    refBrk[k] = +ref.brk[ri].toFixed(3);
    refSteer[k] = Math.round(ref.steer[ri]);
    // ваш след — только пройденное на этом круге
    const gi = Math.floor(dist / STEP);
    const mine = dist >= 0 && dist <= d && gi < g.n;
    myBrk[k] = mine ? +g.brk[gi].toFixed(3) : null;
    mySteer[k] = mine ? Math.round(g.steer[gi]) : null;
  }
  // зоны эталона в окне — полосами; круг замкнут, поэтому проверяем и соседний оборот
  const zones = [];
  for (const z of ref.zones) for (const off of [-L, 0, L]) {
    const from = z.start + off - d, to = z.end + off - d;
    if (to > -BACK && from < FWD) zones.push([Math.max(-BACK, from), Math.min(FWD, to)]);
  }
  return {
    active: true, back: BACK, fwd: FWD, step: TSTEP,
    refBrk, myBrk, refSteer, mySteer, zones,
    steerMax: r.refSteerMax,
    brake: vals.brk, steer: vals.steer,
    refBrakeNow: ref.brk[Math.min(ref.n - 1, Math.round(d / STEP))],
    refSteerNow: ref.steer[Math.min(ref.n - 1, Math.round(d / STEP))],
  };
}

// Новый эталон — записанный круг больше не к месту
function resetBrakeZone() { rec = null; frameKey = null; frameOut = null; lastStatus = ''; }

module.exports = { buildBrakeZone, buildBrakeTrace, resetBrakeZone, setLog };
