// Модель Sectors: дельта по секторам относительно выбранного эталона круга.
// iRacing отдаёт непрерывную дельту круга (LapDeltaToBestLap и т.п.). Дельта сектора — это разница дельты на конце
// и на начале сектора. Считаем здесь, с памятью между тиками: так окно можно пересоздавать, данные не пропадают.

const REFS = {
  best: ['LapDeltaToBestLap', 'LapDeltaToBestLap_OK'],
  session: ['LapDeltaToSessionBestLap', 'LapDeltaToSessionBestLap_OK'],
  optimal: ['LapDeltaToOptimalLap', 'LapDeltaToOptimalLap_OK'],
};

const num = (v) => (Number.isFinite(v) ? v : null);

// границы секторов из описания трассы; если их нет — три равных сектора
function sectorStarts(race) {
  const list = (race.sectorsInfo || []).map((s) => Number(s.SectorStartPct)).filter(Number.isFinite).sort((a, b) => a - b);
  if (!list.length || list[0] > 0.001) list.unshift(0);
  return list.length > 1 ? list : [0, 1 / 3, 2 / 3];
}

const fresh = () => ({ idx: -1, startDelta: null, lastDelta: null, values: [], live: null, partial: false });
let state = { key: '', lastPct: -1, lap: -1, refs: { best: fresh(), session: fresh(), optimal: fresh() } };

function buildSectors(race) {
  const v = race.vars || {};
  const ref = race.ref;
  const starts = sectorStarts(race);
  const n = starts.length;
  // дельта есть только у вашей машины
  if (!ref || !ref.inWorld || ref.carIdx !== v.PlayerCarIdx || !(ref.lapDistPct >= 0)) return { active: false, sectors: n };

  const pct = ref.lapDistPct;
  let idx = 0;
  for (let i = 0; i < n; i++) if (starts[i] <= pct) idx = i;

  const key = `${race.kind}|${n}|${Math.round(starts[1] * 1000)}`;
  if (key !== state.key) state = { key, lastPct: -1, lap: -1, refs: { best: fresh(), session: fresh(), optimal: fresh() } };

  // новый круг: линию старта/финиша пересекли (или сбросили машину): всё начинается заново
  const wrapped = state.lastPct > 0.85 && pct < 0.15;
  const jumped = state.lastPct >= 0 && pct < state.lastPct - 0.02 && !wrapped;
  state.lastPct = pct;

  const out = { active: true, sectors: n, starts, lap: Math.max(ref.lap, 0), idx, fill: 0, refs: {} };
  const end = idx + 1 < n ? starts[idx + 1] : 1;
  out.fill = Math.min(Math.max((pct - starts[idx]) / Math.max(end - starts[idx], 1e-6), 0), 1);

  for (const [name, [dv, okv]] of Object.entries(REFS)) {
    const r = state.refs[name];
    const delta = v[okv] === false ? null : num(v[dv]);
    if (wrapped || jumped) {
      // закрываем последний сектор прошлого круга и начинаем сначала
      if (wrapped && r.idx === n - 1 && !r.partial && r.lastDelta != null && r.startDelta != null) r.values[n - 1] = r.lastDelta - r.startDelta;
      Object.assign(r, fresh());
    }
    if (r.idx !== idx) {
      // перешли в следующий сектор: сохраняем дельту закрытого
      if (r.idx >= 0 && idx > r.idx) {
        for (let i = r.idx; i < idx; i++) r.values[i] = i === r.idx && !r.partial && delta != null && r.startDelta != null ? delta - r.startDelta : null;
      }
      // вошли в сектор посреди проезда (запуск или сброс машины): его дельта неполная, не показываем
      r.partial = r.idx < 0 && out.fill > 0.1 && idx > 0;
      r.idx = idx;
      r.startDelta = delta;
    }
    if (r.startDelta == null && delta != null) r.startDelta = delta; // первая дельта в секторе
    r.lastDelta = delta;
    r.live = delta != null && r.startDelta != null ? delta - r.startDelta : null;
    const values = Array.from({ length: n }, (_, i) => (i < idx ? (r.values[i] ?? null) : null));
    out.refs[name] = { values, live: r.live, valid: delta != null };
  }
  return out;
}

module.exports = { buildSectors };
