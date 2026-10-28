// Режим «Тренировка»: эталонный круг (из файла телеметрии) и сравнение с ним по дистанции круга.
//   buildReference(lap)    — круг окна «Телеметрия» → эталон: ряды на сетке 1 м и зоны торможения;
//   nextZones(ref, dist)   — ближайшие зоны торможения впереди (для подсказки «через 3-2-1»);
//   compareLap(ref, lap)   — как пилот проехал те же зоны: раньше/позже, скорость входа и минимум.
// Ничего не знает про игру и окна: на входе ряды (dist м, speed м/с, brk/thr 0..1, steer град.), на выходе числа.

const STEP = 1;              // м между точками эталона
const BRAKE_ON = 0.12;       // с этого нажатия считаем, что пилот тормозит
const BRAKE_OFF = 0.05;      // ниже этого — отпустил
const MIN_PEAK = 0.35;       // слабее — не торможение, а подтормаживание
const MIN_LEN = 15;          // короче (м) — случайное касание
const MERGE_GAP = 25;        // зоны ближе (м) — одна (тормоз-отпустил-тормоз в одном повороте)
const LOOKBACK = 120;        // насколько раньше эталонной точки ищем начало торможения пилота (м)

// Ряды круга → сетка по дистанции. Дистанция внутри круга только растёт: откаты (шум, разворот) срезаем.
function resample(lap, length) {
  const { dist, n = dist.length } = lap;
  const N = Math.floor(length / STEP);
  const out = { step: STEP, n: N, speed: new Float32Array(N), brk: new Float32Array(N), thr: new Float32Array(N), steer: new Float32Array(N) };
  let i = 0, prev = 0;
  const dm = new Float64Array(n);
  for (let q = 0; q < n; q++) dm[q] = prev = Math.max(prev, dist[q]);
  for (let k = 0; k < N; k++) {
    const d = k * STEP;
    while (i < n - 2 && dm[i + 1] < d) i++;
    const d0 = dm[i], d1 = dm[i + 1];
    const f = d1 > d0 ? Math.min(1, Math.max(0, (d - d0) / (d1 - d0))) : 0;
    for (const key of ['speed', 'brk', 'thr', 'steer']) out[key][k] = lap[key][i] + (lap[key][i + 1] - lap[key][i]) * f;
  }
  return out;
}

// Зоны торможения: от нажатия до отпускания, с пиком, скоростью на входе и минимальной скоростью
function brakeZones(r) {
  const raw = [];
  let start = -1, peak = 0;
  for (let k = 0; k < r.n; k++) {
    if (start < 0) { if (r.brk[k] >= BRAKE_ON) { start = k; peak = r.brk[k]; } continue; }
    peak = Math.max(peak, r.brk[k]);
    if (r.brk[k] < BRAKE_OFF) { raw.push({ a: start, b: k, peak }); start = -1; }
  }
  if (start >= 0) raw.push({ a: start, b: r.n - 1, peak });
  const merged = [];
  for (const z of raw) {
    const last = merged[merged.length - 1];
    if (last && z.a - last.b <= MERGE_GAP) { last.b = z.b; last.peak = Math.max(last.peak, z.peak); } else merged.push({ ...z });
  }
  return merged.filter((z) => z.peak >= MIN_PEAK && z.b - z.a >= MIN_LEN).map((z, i) => {
    let minV = Infinity, minAt = z.a;
    // минимум скорости — до конца торможения плюс немного после: апекс обычно сразу за отпусканием
    for (let k = z.a; k <= Math.min(r.n - 1, z.b + 40); k++) if (r.speed[k] < minV) { minV = r.speed[k]; minAt = k; }
    return { id: i + 1, start: z.a * STEP, end: z.b * STEP, peak: z.peak, entrySpeed: r.speed[z.a], minSpeed: minV, minAt: minAt * STEP };
  });
}

function buildReference(lap, trackLength) {
  const length = trackLength || lap.meta?.trackLength || Math.max(...lap.dist);
  const r = resample(lap, length);
  return { length, ...r, zones: brakeZones(r), time: lap.lap?.time ?? null, car: lap.meta?.car || '', track: lap.meta?.track || '' };
}

// Подсказка во время езды: ближайшие зоны впереди с расстоянием до начала торможения (м). Круг замкнут:
// после финиша ищем зоны с начала трассы.
function nextZones(ref, dist, count = 1) {
  const out = [];
  const L = ref.length;
  for (const z of ref.zones) {
    let ahead = z.start - dist;
    if (ahead < -20) ahead += L;      // уже проехали (с запасом: торможение идёт), значит следующая — на новом круге
    out.push({ ...z, ahead });
  }
  return out.filter((z) => z.ahead >= -20).sort((a, b) => a.ahead - b.ahead).slice(0, count);
}

// Значение эталона в точке дистанции
function at(ref, key, dist) {
  const k = Math.min(ref.n - 1, Math.max(0, Math.round(dist / ref.step)));
  return ref[key][k];
}

// Как пилот проехал одну зону эталона; mine — ряды на сетке 1 м (resample или записанные вживую).
// Начало его торможения ищем в окне от «эталон − LOOKBACK» до конца эталонной зоны.
function compareZone(ref, mine, z) {
  const from = Math.max(0, Math.floor((z.start - LOOKBACK) / STEP));
  const to = Math.min(mine.n - 1, Math.floor(z.end / STEP));
  let ks = -1, peak = 0;
  for (let k = from; k <= to; k++) {
    if (mine.brk[k] >= BRAKE_ON && ks < 0) ks = k;
    if (ks >= 0) peak = Math.max(peak, mine.brk[k]);
  }
  if (ks < 0 || peak < MIN_PEAK) return { id: z.id, ref: z, missed: true };
  let minV = Infinity;
  for (let k = ks; k <= Math.min(mine.n - 1, to + 40); k++) if (mine.speed[k] < minV) minV = mine.speed[k];
  return {
    id: z.id, ref: z, missed: false,
    start: ks * STEP,
    startDelta: ks * STEP - z.start,                 // + позже эталона, − раньше (м)
    entrySpeed: mine.speed[ks], entrySpeedDelta: mine.speed[ks] - z.entrySpeed,
    minSpeed: minV, minSpeedDelta: minV - z.minSpeed,
    peak, peakDelta: peak - z.peak,
  };
}

function compareLap(ref, lap) {
  const mine = resample(lap, ref.length);
  return { zones: ref.zones.map((z) => compareZone(ref, mine, z)) };
}

module.exports = { buildReference, brakeZones, nextZones, compareLap, compareZone, at, resample, STEP };
