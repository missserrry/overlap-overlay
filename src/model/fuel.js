// Модель Fuel Calculator: сколько топлива в баке, сколько нужно до финиша и сколько долить.
//
// Расход считаем по настоящим кругам: топливо на старте круга минус на финише. В среднее не попадают круги
// с питлейном (въезд, выезд, дозаправка), с остановкой машины и под общим жёлтым (safety car), иначе расход получится
// заниженным или завышенным. Местные жёлтые флаги круг не портят.
// Остаток дистанции: в гонке на круги — SessionLapsRemainEx; в гонке на время — доезжаем текущий круг и ещё
// столько кругов, сколько успеем до нуля таймера, плюс финишный круг. Без дистанции (практика) считаем «план» из настроек.

const KEEP_LAPS = 10;              // сколько последних чистых кругов усредняем
const CAUTION_BITS = 0x4000 | 0x8000;  // общий жёлтый (safety car): вся пелотон едет медленно, расход не показательный
const STOPPED = 3;                     // м/с (~11 км/ч): ниже — вы остановились, круг не считаем
const L_PER_GAL = 3.785411784;

const num = (v) => (Number.isFinite(v) ? v : null);
const BINS = 100;
const fresh = () => ({ key: '', lap: -1, fuelAtStart: null, timeAtStart: null, dirty: false, go: null, lastEst: null, laps: [], cur: new Array(BINS + 1).fill(null) });
const MIN_EST = 0.2;               // доля круга, после которой расход по текущему кругу уже можно оценить

// сколько топлива ушло к каждой сотой круга; пропуски заполняем предыдущим значением
function closeProfile(cur) {
  const out = [0];
  for (let i = 1; i <= BINS; i++) out.push(cur[i] ?? out[i - 1]);
  return out;
}
let st = fresh();

// История расхода по связке «трасса + машина» между сессиями: после практики в гонку садимся уже с известным расходом,
// а не с пустым калькулятором на первом круге (так делают и сторонние калькуляторы). Храним последние чистые круги.
const KEEP_HIST = 10;
let store = { file: null, data: {} };
function setFuelStore(file) {
  store = { file, data: {} };
  if (!file) return;
  try { store.data = JSON.parse(require('fs').readFileSync(file, 'utf8')) || {}; } catch { /* файла ещё нет */ }
}
function saveHistory(key, lap) {
  if (!key) return;
  const list = (store.data[key] ||= []);
  list.push({ used: +lap.used.toFixed(4), time: +lap.time.toFixed(2) });
  while (list.length > KEEP_HIST) list.shift();
  const keys = Object.keys(store.data);
  while (keys.length > 200) delete store.data[keys.shift()];          // старые связки не копим бесконечно
  if (!store.file) return;
  try { require('fs').writeFileSync(store.file, JSON.stringify(store.data)); } catch { /* не страшно: останется в памяти */ }
}
function historyList(key) {
  return key && store.data[key] ? store.data[key].map((l) => ({ used: l.used, time: l.time })) : [];
}

// Расход на круг шестью способами: среднее по всем, максимум, минимум, последний, среднее за 5 и за 10 последних
function usageStrategies(used) {
  if (!used.length) return null;
  const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  return { avg: avg(used), max: Math.max(...used), min: Math.min(...used), last: used[used.length - 1], l5: avg(used.slice(-5)), l10: avg(used.slice(-10)) };
}

// Остаток гонки на время по лидеру: гонка кончается, когда лидер пересёк линию после нуля таймера, а вы — на следующем своём пересечении.
// Лидер проедет ещё floor(остаток / его темп) + 1 круг; если вы отстали на круг, вам ехать на круг меньше.
function remainingByLeader(race, f) {
  const v = race.vars || {};
  const me = race.ref;
  const t = v.SessionTimeRemain;
  if (race.kind !== 'race' || !me || !Number.isFinite(t) || t < 0 || t > 86400 * 2) return null;
  if (!(v.SessionTimeTotal > 0 && v.SessionTimeTotal < 86400 * 2)) return null;
  let leader = null;
  for (const c of race.cars) if (c.inWorld && (!leader || c.totalDist > leader.totalDist)) leader = c;
  const pace = leader && (leader.lastLap || leader.bestLap || leader.classEstLap);
  if (!leader || !(pace > 0)) return null;
  const leaderFinish = Math.ceil(leader.totalDist + t / pace);        // сколько кругов лидер проедет всего
  const down = Math.floor(leader.totalDist) - Math.floor(me.totalDist);
  return { laps: Math.max(leaderFinish - down - me.totalDist, 0), by: 'time' };
}

function remainingLaps(race, f) {
  const v = race.vars || {};
  const lapsLeft = v.SessionLapsRemainEx;
  if (Number.isFinite(lapsLeft) && lapsLeft > 0 && lapsLeft < 10000) return { laps: Math.max(lapsLeft - f, 0), by: 'laps' };
  // до зелёного флага (а иногда и в гонке) iRacing отдаёт здесь «без ограничения»: тогда берём число кругов гонки из описания сессии
  const total = race.session?.lapsTotal;
  if (race.kind === 'race' && total > 0 && race.ref) return { laps: Math.max(total - (Math.max(race.ref.lap, 1) - 1) - f, 0), by: 'laps' };
  return null;
}

function remainingByTime(race, f, lapTime) {
  const v = race.vars || {};
  const t = v.SessionTimeRemain;
  if (!Number.isFinite(t) || t < 0 || t > 86400 * 2 || !(lapTime > 0)) return null;
  if (!(v.SessionTimeTotal > 0 && v.SessionTimeTotal < 86400 * 2)) return null;
  const toLineLeft = (1 - f) * lapTime;                        // сколько осталось до конца текущего круга
  const extra = t > toLineLeft ? Math.ceil((t - toLineLeft) / lapTime) : 0;
  return { laps: (1 - f) + extra, by: 'time' };
}

function buildFuel(race) {
  const v = race.vars || {};
  const ref = race.ref;
  const fuel = num(v.FuelLevel);
  if (!ref || !ref.inWorld || ref.carIdx !== v.PlayerCarIdx || fuel == null) return { active: false };

  const di = race.driverInfo || {};
  const me = (di.Drivers || []).find((d) => d.CarIdx === di.DriverCarIdx);
  const histKey = !race.demo && race.trackKey && me?.CarScreenName ? `${race.trackKey}|${me.CarScreenName}` : null;
  const maxPct = num(parseFloat(di.DriverCarMaxFuelPct)) ?? 1;
  let tank = num(parseFloat(di.DriverCarFuelMaxLtr));
  tank = tank != null ? tank * maxPct : (num(v.FuelLevelPct) > 0 ? fuel / v.FuelLevelPct : null);

  // --- учёт кругов
  const key = `${race.kind}|${race.refIdx}`;
  if (key !== st.key) { st = fresh(); st.key = key; }
  const lap = ref.lap;
  const now = v.SessionTime;
  if (st.lap < 0 || lap < st.lap) {            // начало или сброс (перезапуск машины, новая сессия)
    st.lap = lap; st.fuelAtStart = fuel; st.timeAtStart = now; st.dirty = true; st.go = null; st.cur.fill(null);
  } else if (lap > st.lap) {
    const used = st.fuelAtStart - fuel;
    const time = now - st.timeAtStart;
    if (!st.dirty && lap === st.lap + 1 && used > 0.001 && used < (tank || 400) && time > 5) {
      st.laps.push({ used, time, prof: closeProfile(st.cur) });
      saveHistory(histKey, { used, time });
    }
    if (st.laps.length > KEEP_LAPS) st.laps.shift();
    st.lap = lap; st.fuelAtStart = fuel; st.timeAtStart = now; st.dirty = false; st.go = null; st.cur.fill(null);
  }
  // запоминаем, сколько топлива ушло к этой точке круга
  const pct = Math.min(Math.max(ref.lapDistPct, 0), 0.999);
  if (st.fuelAtStart != null) st.cur[Math.floor(pct * BINS)] = Math.max(st.fuelAtStart - fuel, 0);
  // этот круг «грязный»: питлейн, общий жёлтый (safety car), остановка, топливо прибавилось (дозаправка).
  // Местные жёлтые флаги круг не портят: в игре почти никто не сбрасывает скорость, а машины лежат у отбойников.
  // Круг до зелёного флага (сетка, круг прогрева) — тоже не боевой темп
  const formation = race.kind === 'race' && (v.SessionState ?? 4) < 4;
  if (ref.onPitRoad || formation || ((v.SessionFlags ?? 0) & CAUTION_BITS) || (num(v.Speed) != null && v.Speed < STOPPED) || fuel > st.fuelAtStart + 0.05) st.dirty = true;

  // Оценка по текущему кругу, пока нет ни одного чистого: считаем от момента, когда машина тронулась (стоянка на решётке
  // расход портит), и только пока круг чистый. Так расход виден уже на первом круге, а не после двух.
  const moving = num(v.Speed) != null && v.Speed >= STOPPED;
  const cleanNow = !ref.onPitRoad && !formation && !((v.SessionFlags ?? 0) & CAUTION_BITS);
  if (st.go && (!cleanNow || fuel > st.go.fuel + 0.05)) st.go = null;                       // питлейн, жёлтый, дозаправка — начинаем заново
  if (!st.go && moving && cleanNow && now != null) st.go = { fuel, pct, time: now };
  let est = null;
  if (st.go && now != null) {
    const dp = pct - st.go.pct, used = st.go.fuel - fuel, dt = now - st.go.time;
    if (dp >= MIN_EST && used > 0.001 && dt > 5) est = st.lastEst = { perLap: used / dp, lapTime: dt / dp };
  }
  if (!est && !st.laps.length) est = st.lastEst;     // новый круг ещё не набрал 20% — держим прошлую оценку, чтобы число не пропадало

  // Расход по шести способам (как в сторонних калькуляторах): по чистым кругам прошлых сессий на этой трассе и машине плюс этой сессии.
  // Прошлые сессии снимаем один раз при входе в сессию, иначе круги этой сессии считались бы дважды (они пишутся в историю сразу).
  if (st.histKey !== histKey) { st.histKey = histKey; st.hist = historyList(histKey); }
  const n = st.laps.length;
  const all = [...st.hist, ...st.laps];
  const usage = usageStrategies(all.map((l) => l.used));
  let perLap = usage ? usage.l10 : null;
  let lapTime = all.length ? all.slice(-KEEP_LAPS).reduce((s, l) => s + l.time, 0) / Math.min(all.length, KEEP_LAPS) : (ref.lastLap || ref.bestLap || ref.classEstLap || null);
  let source = n ? 'laps' : all.length ? 'history' : null;
  // ни прошлых кругов, ни чистых в этой сессии: оценка по текущему кругу
  if (!all.length && est) { perLap = est.perLap; lapTime = est.lapTime; source = 'estimate'; }
  if (perLap == null && num(v.FuelUsePerHour) > 0 && lapTime > 0) { perLap = (v.FuelUsePerHour / 3600) * lapTime; source = 'rate'; }

  // --- остаток дистанции
  const f = Math.min(Math.max(ref.lapDistPct, 0), 1);
  const rem = remainingLaps(race, f) || remainingByLeader(race, f) || remainingByTime(race, f, lapTime);

  // --- цель по расходу: сколько можно тратить на круг, чтобы доехать до финиша без доливки
  const target = rem && fuel > 0 ? fuel / Math.max(rem.laps + 0.5, 0.5) : null; // 0.5 — запас, точный задаётся в оверлее
  let liveDelta = null;
  if (n && perLap > 0 && target != null) {
    // эталонная кривая: среднее по чистым кругам; сравниваем с тем, сколько ушло бы при расходе «цели»
    const total = st.laps.reduce((s, l) => s + l.prof[BINS], 0) / n;
    const at = (b) => st.laps.reduce((s, l) => s + l.prof[b], 0) / n;
    const x = pct * BINS, i = Math.floor(x), fr = x - i;
    const refCum = at(i) + (at(Math.min(i + 1, BINS)) - at(i)) * fr;
    const used = st.fuelAtStart != null ? st.fuelAtStart - fuel : null;
    if (used != null && total > 0 && !st.dirty) liveDelta = used - refCum * (target / total);
  }

  return {
    active: true,
    kind: race.kind,
    fuel,
    target,
    liveDelta,
    tank,
    imperial: v.DisplayUnits === 0,
    perLap,                                   // л на круг (null — ещё нет данных); по умолчанию — среднее за 10 последних чистых кругов
    usage,                                    // тот же расход по шести способам: avg, max, min, last, l5, l10
    perLapMin: usage ? usage.min : null,
    perLapMax: usage ? usage.max : null,
    samples: n,
    source,
    lapsOfFuel: perLap > 0 ? fuel / perLap : null,
    remLaps: rem ? rem.laps : null,           // null — дистанция неизвестна
    remBy: rem ? rem.by : null,
    pitSelected: num(v.PitSvFuel),            // сколько выбрано долить в меню боксов
    onPitRoad: !!ref.onPitRoad,
    lapPct: f,                                // где вы на круге: нужно, чтобы понять, хватит ли топлива ещё на круг после этого
    lapTime,
  };
}

module.exports = { buildFuel, setFuelStore, L_PER_GAL };
