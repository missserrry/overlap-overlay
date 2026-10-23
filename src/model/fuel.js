// Модель Fuel Calculator: сколько топлива в баке, сколько нужно до финиша и сколько долить.
//
// Расход считаем по настоящим кругам: топливо на старте круга минус на финише. В среднее не попадают круги
// с питлейном (въезд, выезд, дозаправка), под жёлтыми и неполные, иначе расход получится заниженным или завышенным.
// Остаток дистанции: в гонке на круги — SessionLapsRemainEx; в гонке на время — доезжаем текущий круг и ещё
// столько кругов, сколько успеем до нуля таймера, плюс финишный круг. Без дистанции (практика) считаем «план» из настроек.

const KEEP_LAPS = 5;               // сколько последних чистых кругов усредняем
const YELLOW_BITS = 0x0008 | 0x0100 | 0x4000 | 0x8000; // жёлтый, махание жёлтым, caution, caution waving
const L_PER_GAL = 3.785411784;

const num = (v) => (Number.isFinite(v) ? v : null);
const fresh = () => ({ key: '', lap: -1, fuelAtStart: null, timeAtStart: null, dirty: false, laps: [] });
let st = fresh();

function remainingLaps(race, f) {
  const v = race.vars || {};
  const lapsLeft = v.SessionLapsRemainEx;
  if (Number.isFinite(lapsLeft) && lapsLeft > 0 && lapsLeft < 10000) return { laps: Math.max(lapsLeft - f, 0), by: 'laps' };
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
  const maxPct = num(parseFloat(di.DriverCarMaxFuelPct)) ?? 1;
  let tank = num(parseFloat(di.DriverCarFuelMaxLtr));
  tank = tank != null ? tank * maxPct : (num(v.FuelLevelPct) > 0 ? fuel / v.FuelLevelPct : null);

  // --- учёт кругов
  const key = `${race.kind}|${race.refIdx}`;
  if (key !== st.key) { st = fresh(); st.key = key; }
  const lap = ref.lap;
  const now = v.SessionTime;
  if (st.lap < 0 || lap < st.lap) {            // начало или сброс (перезапуск машины, новая сессия)
    st.lap = lap; st.fuelAtStart = fuel; st.timeAtStart = now; st.dirty = true;
  } else if (lap > st.lap) {
    const used = st.fuelAtStart - fuel;
    const time = now - st.timeAtStart;
    if (!st.dirty && lap === st.lap + 1 && used > 0.001 && used < (tank || 400) && time > 5) st.laps.push({ used, time });
    if (st.laps.length > KEEP_LAPS) st.laps.shift();
    st.lap = lap; st.fuelAtStart = fuel; st.timeAtStart = now; st.dirty = false;
  }
  // этот круг «грязный»: питлейн, жёлтый флаг, топливо прибавилось (дозаправка)
  if (ref.onPitRoad || ((v.SessionFlags ?? 0) & YELLOW_BITS) || fuel > st.fuelAtStart + 0.05) st.dirty = true;

  const n = st.laps.length;
  let perLap = n ? st.laps.reduce((s, l) => s + l.used, 0) / n : null;
  let lapTime = n ? st.laps.reduce((s, l) => s + l.time, 0) / n : (ref.lastLap || ref.bestLap || null);
  let source = n ? 'laps' : null;
  if (perLap == null && num(v.FuelUsePerHour) > 0 && lapTime > 0) { perLap = (v.FuelUsePerHour / 3600) * lapTime; source = 'rate'; }

  // --- остаток дистанции
  const f = Math.min(Math.max(ref.lapDistPct, 0), 1);
  const rem = remainingLaps(race, f) || remainingByTime(race, f, lapTime);

  return {
    active: true,
    fuel,
    tank,
    imperial: v.DisplayUnits === 0,
    perLap,                                   // л на круг (null — ещё нет данных)
    perLapMin: n ? Math.min(...st.laps.map((l) => l.used)) : null,
    perLapMax: n ? Math.max(...st.laps.map((l) => l.used)) : null,
    samples: n,
    source,
    lapsOfFuel: perLap > 0 ? fuel / perLap : null,
    remLaps: rem ? rem.laps : null,           // null — дистанция неизвестна
    remBy: rem ? rem.by : null,
    pitSelected: num(v.PitSvFuel),            // сколько выбрано долить в меню боксов
    onPitRoad: !!ref.onPitRoad,
    lapTime,
  };
}

module.exports = { buildFuel, L_PER_GAL };
