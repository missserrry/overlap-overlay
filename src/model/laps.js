// Модель Laps: текущий круг, предикт, лучший и прошлый круги, лучший круг лидера вашего класса.
// Предикт = лучший круг + текущая дельта к лучшему (iRacing считает дельту нарастающей по кругу).

const pos = (v) => (Number.isFinite(v) && v > 0 ? v : null);

// Круг со срезкой iRacing в «прошлый круг» не записывает (значение остаётся старым или пустым), хотя время честное.
// Поэтому сами запоминаем последнее показание текущего круга перед пересечением линии; в питах круг не считаем (там время нечестное).
let own = { key: null, lap: null, cur: 0, pit: false, off: null, cutLap: null, cutTime: null };
function trackOwn(v, ref) {
  const key = `${v.SessionNum}|${ref.carIdx}`;
  if (own.key !== key) own = { key, lap: null, cur: 0, pit: false, off: null, cutLap: null, cutTime: null };
  const cur = pos(v.LapCurrentLapTime) ?? 0;
  if (own.lap != null && ref.lap === own.lap + 1 && own.cur > 10 && !own.pit) {
    const official = pos(v.LapLastLapTime);
    own.cutLap = ref.lap; own.cutTime = own.cur; own.off = own.official;   // официальное значение до линии; сменилось — круг записан iRacing, берём его
  }
  if (ref.lap !== own.lap) own.pit = false;
  if (ref.onPitRoad) own.pit = true;
  own.lap = ref.lap; own.cur = cur; own.official = pos(v.LapLastLapTime);
}

function buildLaps(race) {
  const v = race.vars || {};
  const ref = race.ref;
  if (!ref || !ref.inWorld || ref.carIdx !== v.PlayerCarIdx) return { active: false };

  trackOwn(v, ref);
  const official = pos(v.LapLastLapTime);
  const cutShown = own.cutLap === ref.lap && own.cutTime != null && (official == null || official === own.off);
  const best = pos(v.LapBestLapTime) ?? ref.bestLap;
  const deltaOk = v.LapDeltaToBestLap_OK !== false && Number.isFinite(v.LapDeltaToBestLap);
  const delta = deltaOk ? v.LapDeltaToBestLap : null;

  const cls = race.classes?.get(ref.classId);
  const leader = cls?.cars?.[0] ?? null;
  const leaderBest = leader?.bestLap ?? cls?.fastest ?? null;

  return {
    active: true,
    current: pos(v.LapCurrentLapTime) ?? 0,
    best,
    last: cutShown ? own.cutTime : (official ?? ref.lastLap),
    lastCut: cutShown,
    predict: best != null && delta != null ? best + delta : null,
    delta,
    leader: leaderBest,
    leaderIsYou: !!leader && leader.carIdx === ref.carIdx,
  };
}

module.exports = { buildLaps };
