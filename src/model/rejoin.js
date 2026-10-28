// Модель Rejoin: сколько секунд до машин, которые догоняют вас сзади.
// Нужна, когда вы стоите (развернуло, вынесло): видно, можно ли выезжать на трассу.
// Скорость соперника берём из его реального движения (сглаженно), пока данных нет — из темпа его класса.

const { trackLengthM } = require('./common');

const MAX_BEHIND = 30;   // с: дальше не показываем
const MIN_SPEED = 2;     // м/с: чтобы стоящая сзади машина не давала «бесконечность»
const MAX_CARS = 3;

let speeds = new Map();  // carIdx -> { pct, t, v, n }
let speedsKey = '';

function trackSpeeds(race, len, now) {
  const key = `${race.kind}|${race.refIdx}|${Math.round(len)}`;
  if (key !== speedsKey) { speeds = new Map(); speedsKey = key; }
  for (const c of race.cars) {
    if (!c.inWorld) { speeds.delete(c.carIdx); continue; }
    const s = speeds.get(c.carIdx);
    if (!s) { speeds.set(c.carIdx, { pct: c.lapDistPct, t: now, v: 0, n: 0 }); continue; }
    const dt = (now - s.t) / 1000;
    if (dt < 0.05) continue; // тик тот же или слишком частый
    let d = c.lapDistPct - s.pct;
    if (d < -0.5) d += 1;
    s.pct = c.lapDistPct; s.t = now;
    if (d < 0 || d > 0.05) { s.n = 0; continue; } // сброс машины в боксы/назад — измерения недействительны
    const inst = (d * len) / dt;
    s.v = s.n ? s.v + (inst - s.v) * 0.25 : inst;
    s.n++;
  }
}

function buildRejoin(race, now = Date.now()) {
  const v = race.vars || {};
  const ref = race.ref;
  const len = trackLengthM(race);
  if (!ref || !ref.inWorld || ref.carIdx !== v.PlayerCarIdx || !len) return { active: false };

  trackSpeeds(race, len, now);

  const cars = [];
  for (const c of race.cars) {
    if (c === ref || !c.inWorld || c.onPitRoad) continue;
    let d = ref.lapDistPct - c.lapDistPct;   // сколько трассы между ним и вами (он сзади — положительно)
    if (d < 0) d += 1;
    const dist = d * len;
    if (dist < 1) continue;                  // уже рядом или чуть впереди
    const s = speeds.get(c.carIdx);
    const pace = len / (c.classEstLap || c.bestLap || c.lastLap || 100);
    const speed = Math.max(s && s.n > 3 && s.v > 0.5 ? s.v : pace, MIN_SPEED);
    const time = dist / speed;
    if (time > MAX_BEHIND) continue;
    cars.push({ number: c.number, name: c.name, color: c.classColor, dist: Math.round(dist), time, speed: Math.round(speed * 3.6) });
  }
  cars.sort((a, b) => a.time - b.time);

  return {
    active: true,
    speed: Number.isFinite(v.Speed) ? v.Speed * 3.6 : 0,     // км/ч
    onTrack: !!v.IsOnTrack && !ref.onPitRoad,
    cars: cars.slice(0, MAX_CARS),
  };
}

module.exports = { buildRejoin };
