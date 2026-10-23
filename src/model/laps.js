// Модель Laps: текущий круг, предикт, лучший и прошлый круги, лучший круг лидера вашего класса.
// Предикт = лучший круг + текущая дельта к лучшему (iRacing считает дельту нарастающей по кругу).

const pos = (v) => (Number.isFinite(v) && v > 0 ? v : null);

function buildLaps(race) {
  const v = race.vars || {};
  const ref = race.ref;
  if (!ref || !ref.inWorld || ref.carIdx !== v.PlayerCarIdx) return { active: false };

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
    last: pos(v.LapLastLapTime) ?? ref.lastLap,
    predict: best != null && delta != null ? best + delta : null,
    delta,
    leader: leaderBest,
    leaderIsYou: !!leader && leader.carIdx === ref.carIdx,
  };
}

module.exports = { buildLaps };
