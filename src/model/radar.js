// Модель Radar: кто рядом с вашей машиной. iRacing не отдаёт боковое положение чужих машин, зато даёт
//   — CarLeftRight: слышит ли споттер машину слева/справа (и сколько их);
//   — CarIdxLapDistPct: где каждая машина вдоль трассы (отсюда расстояние в метрах).
// Радар складывает одно с другим: машины «рядом» (±SIDE_ZONE м) встают на тот борт, о котором говорит споттер,
// остальные ближайшие спереди и сзади дают дуги приближения.

const { trackLengthM } = require('./common');

const CAR_LENGTH = 4.6;      // м, средняя длина машины
const SIDE_ZONE = 9;         // м: ближе этого машина считается «рядом»
const MAX_RANGE = 45;        // м: дальше не отдаём

// irsdk_CarLeftRight: 0 выкл, 1 чисто, 2 слева, 3 справа, 4 с обеих сторон, 5 две слева, 6 две справа
const LEFT_COUNT = { 2: 1, 4: 1, 5: 2 };
const RIGHT_COUNT = { 3: 1, 4: 1, 6: 2 };

// Запоминаем, на каком борту машина была, чтобы при обгоне она не перепрыгивала
let sticky = new Map();
let stickyKey = '';

function buildRadar(race) {
  const ref = race.ref;
  const vars = race.vars || {};
  const len = trackLengthM(race);
  const base = { carLength: CAR_LENGTH, left: [], right: [], front: null, rear: null, active: false };
  if (!ref || !ref.inWorld || !len) return base;

  const key = `${race.kind}|${race.refIdx}`;
  if (key !== stickyKey) { sticky = new Map(); stickyKey = key; }

  const near = [];
  for (const c of race.cars) {
    if (c === ref || !c.inWorld) continue;
    let d = c.lapDistPct - ref.lapDistPct;
    if (d > 0.5) d -= 1;
    if (d < -0.5) d += 1;
    d *= len;
    if (Math.abs(d) <= MAX_RANGE) near.push({ car: c, d });
  }

  const lr = vars.CarLeftRight;
  const wantLeft = LEFT_COUNT[lr] || 0, wantRight = RIGHT_COUNT[lr] || 0;
  const alongside = near.filter((x) => Math.abs(x.d) <= SIDE_ZONE).sort((a, b) => Math.abs(a.d) - Math.abs(b.d));
  const picked = alongside.slice(0, wantLeft + wantRight);

  // раздаём борта: сначала тем, кто уже был на борту, остальным — туда, где ещё не хватает
  const left = [], right = [];
  for (const x of picked) {
    const side = sticky.get(x.car.carIdx);
    if (side === 'L' && left.length < wantLeft) left.push(x);
    else if (side === 'R' && right.length < wantRight) right.push(x);
  }
  for (const x of picked) {
    if (left.includes(x) || right.includes(x)) continue;
    if (left.length < wantLeft) left.push(x); else right.push(x);
  }
  const used = new Set();
  for (const x of left) { sticky.set(x.car.carIdx, 'L'); used.add(x.car.carIdx); }
  for (const x of right) { sticky.set(x.car.carIdx, 'R'); used.add(x.car.carIdx); }
  for (const idx of [...sticky.keys()]) if (!used.has(idx)) sticky.delete(idx);

  const shape = (x) => ({ idx: x.car.carIdx, d: +x.d.toFixed(2), color: x.car.classColor });
  // ближайшие спереди и сзади среди тех, кто не «борт»
  const rest = near.filter((x) => !used.has(x.car.carIdx));
  const ahead = rest.filter((x) => x.d > 0).sort((a, b) => a.d - b.d)[0];
  const behind = rest.filter((x) => x.d <= 0).sort((a, b) => b.d - a.d)[0];

  return {
    carLength: CAR_LENGTH,
    left: left.map(shape), right: right.map(shape),
    front: ahead ? shape(ahead) : null,
    rear: behind ? shape(behind) : null,
    active: !!(left.length || right.length || ahead || behind),
    spotter: lr > 0,                       // есть ли данные споттера (нет при просмотре повтора)
  };
}

// Radar Bars: только машины на бортах — смещение центра соперника вдоль вашей машины (м, плюс — впереди) и длина машины;
// какая часть полосы закрашена, оверлей считает сам по заданной зоне
function buildRadarBars(race) {
  const r = buildRadar(race);
  return { active: r.active, spotter: !!r.spotter, carLength: r.carLength, left: r.left.map((c) => ({ d: c.d })), right: r.right.map((c) => ({ d: c.d })) };
}

module.exports = { buildRadar, buildRadarBars, CAR_LENGTH };
