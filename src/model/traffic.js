// Модель Traffic: ближайшая машина быстрее вас другого класса сзади и ближайшая медленнее впереди.
// Время до встречи = расстояние (доля круга) / скорость сближения. Скорость каждой машины — по темпу её класса
// (доля круга в секунду), поэтому сближение считается правильно и между классами, и на разных трассах.

const MAX_HALF = 0.5;      // дальше полкруга не смотрим: машина «впереди» через полкруга — это уже «сзади»

function buildTraffic(race) {
  const ref = race.ref;
  if (!ref || !ref.inWorld || ref.onPitRoad || race.classes.size < 2) return { active: false };

  const lapOf = (c) => c.classEstLap || c.bestLap || c.lastLap || null;
  const myLap = lapOf(ref);
  if (!myLap) return { active: false };

  let behind = null, ahead = null;
  for (const c of race.cars) {
    if (c === ref || !c.inWorld || c.onPitRoad || c.classId === ref.classId) continue;
    const lap = lapOf(c);
    if (!lap) continue;
    const rate = 1 / lap - 1 / myLap;                      // сближение, доля круга в секунду: > 0 — он быстрее вас
    // сзади: быстрее вас, догоняет
    let d = ref.lapDistPct - c.lapDistPct;
    if (d < 0) d += 1;
    if (d > 0 && d <= MAX_HALF && rate > 0) {
      const eta = d / rate;
      if (!behind || eta < behind.eta) behind = pack(c, eta, d, race);
    }
    // впереди: медленнее вас, вы догоняете
    let f = c.lapDistPct - ref.lapDistPct;
    if (f < 0) f += 1;
    if (f > 0 && f <= MAX_HALF && rate < 0) {
      const eta = f / -rate;
      if (!ahead || eta < ahead.eta) ahead = pack(c, eta, f, race);
    }
  }
  return { active: true, behind, ahead };
}

function pack(c, eta, d, race) {
  return { className: c.className, color: c.classColor, number: c.number, eta, gap: d * (race.trackLengthM || 0) };
}

module.exports = { buildTraffic };
