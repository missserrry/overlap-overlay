// Математика кругов окна «Телеметрия»: перевод GPS в метры сцены, состояние машины в момент времени,
// время по дистанции (для дельты). Координаты сцены: X — восток, Y — высота, Z — юг (−север), в метрах.

const R = 6378137, RAD = Math.PI / 180;

// Одна точка отсчёта на трассу: все круги одной трассы ложатся в одни координаты
export function projector(lat0, lon0, alt0 = 0) {
  const kx = RAD * R * Math.cos(lat0 * RAD), ky = RAD * R;
  return { lat0, lon0, alt0, x: (lon) => (lon - lon0) * kx, z: (lat) => -(lat - lat0) * ky };
}

// Круг из главного процесса → готовый к проигрыванию: позиции, курс, монотонная дистанция
export function prepareLap(raw, proj) {
  const n = raw.t.length;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = proj.x(raw.lon[i]);
    pos[i * 3 + 1] = raw.alt ? raw.alt[i] - proj.alt0 : 0;
    pos[i * 3 + 2] = proj.z(raw.lat[i]);
  }
  // GPS LMU может колебаться между отсчётами. Сглаживаем только геометрию
  // визуализации, оставляя исходную телеметрию и время круга без изменений.
  if (raw.meta?.source === 'lmu') {
    // Окно около 1,2 с убирает мелкие боковые зигзаги GPS; вес плавно
    // уменьшается к краям, чтобы сохранить общую форму поворотов.
    const w = Math.max(2, Math.round((raw.meta.hz || 50) * 0.6));
    const original = pos.slice();
    for (let i = 0; i < n; i++) {
      let x = 0, z = 0, weight = 0;
      for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) {
        const k = w + 1 - Math.abs(j - i);
        x += original[j * 3] * k; z += original[j * 3 + 2] * k; weight += k;
      }
      pos[i * 3] = x / weight; pos[i * 3 + 2] = z / weight;
    }
  }
  // высота в iRacing записана ступеньками по 10 см — сглаживаем (±0,6 с), иначе машина и камера подпрыгивают
  if (raw.alt) {
    const w = Math.max(2, Math.round((raw.meta?.hz || 60) * 0.6));
    const y = Float32Array.from({ length: n }, (_, i) => pos[i * 3 + 1]);
    let sum = 0, cnt = 0;
    for (let i = 0; i < Math.min(n, w); i++) { sum += y[i]; cnt++; }
    for (let i = 0; i < n; i++) {
      if (i + w < n) { sum += y[i + w]; cnt++; }
      if (i - w - 1 >= 0) { sum -= y[i - w - 1]; cnt--; }
      pos[i * 3 + 1] = sum / cnt;
    }
  }
  // курс: в iRacing — канал YawNorth (куда смотрит машина, ровно и с заносом; 0 — север, по часовой);
  // в LMU — по направлению движения (±0,2 с: GPS у неё 10 Гц); на месте — прежний
  const head = new Float32Array(n);
  if (raw.yaw) {
    for (let i = 0; i < n; i++) head[i] = raw.yaw[i];
  } else {
    const w = Math.max(3, Math.round((raw.meta?.hz || 60) * 0.5));
    let last = 0;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - w), b = Math.min(n - 1, i + w);
      const dx = pos[b * 3] - pos[a * 3], dz = pos[b * 3 + 2] - pos[a * 3 + 2];
      if (dx * dx + dz * dz > 0.04) last = Math.atan2(dx, -dz);
      head[i] = last;
    }
  }
  const dist = new Float32Array(n);
  for (let i = 0; i < n; i++) dist[i] = Math.max(i ? dist[i - 1] : 0, raw.dist[i]);
  const time = raw.lap.time ?? raw.t[n - 1];
  return { ...raw, n, pos, head, dist, time, end: raw.t[n - 1] };
}

// Машина и линия круга — на полотне трассы: высота из осевой трассы в той же точке круга. Иначе линия на виражах
// и в наклонах местами уходила под полотно (высота круга и средняя осевая расходятся на десятки сантиметров)
export function snapToTrack(lap, tr) {
  if (!tr?.pts || !tr.length) return lap;
  const n = tr.n, step = tr.length / n;
  for (let i = 0; i < lap.n; i++) {
    const x = Math.max(0, lap.dist[i]) / step;
    const k = Math.floor(x) % n, k2 = (k + 1) % n, f = x - Math.floor(x);
    lap.pos[i * 3 + 1] = tr.pts[k * 3 + 1] + (tr.pts[k2 * 3 + 1] - tr.pts[k * 3 + 1]) * f;
  }
  return lap;
}

// индекс последнего отсчёта с a[i] <= v
function search(a, v, n = a.length) {
  let lo = 0, hi = n - 1;
  if (v <= a[0]) return 0;
  if (v >= a[hi]) return hi;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (a[m] <= v) lo = m; else hi = m;
  }
  return lo;
}

const lerpAngle = (a, b, f) => {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * f;
};

// Машина в момент t (секунды от начала круга)
export function stateAt(lap, t) {
  const i = search(lap.t, t);
  const j = Math.min(lap.n - 1, i + 1);
  const f = lap.t[j] > lap.t[i] ? Math.min(1, Math.max(0, (t - lap.t[i]) / (lap.t[j] - lap.t[i]))) : 0;
  const mix = (a) => (a ? a[i] + (a[j] - a[i]) * f : 0);
  const p = lap.pos;
  return {
    i, t,
    x: p[i * 3] + (p[j * 3] - p[i * 3]) * f,
    y: p[i * 3 + 1] + (p[j * 3 + 1] - p[i * 3 + 1]) * f,
    z: p[i * 3 + 2] + (p[j * 3 + 2] - p[i * 3 + 2]) * f,
    head: lerpAngle(lap.head[i], lap.head[j], f),
    dist: mix(lap.dist), speed: mix(lap.speed), thr: mix(lap.thr), brk: mix(lap.brk), clu: mix(lap.clu),
    steer: mix(lap.steer), rpm: mix(lap.rpm), gear: lap.gear[f < 0.5 ? i : j],
  };
}

// Время, за которое круг дошёл до дистанции d (для дельты «на той же точке трассы»)
export function timeAtDist(lap, d) {
  const i = search(lap.dist, d);
  const j = Math.min(lap.n - 1, i + 1);
  const d0 = lap.dist[i], d1 = lap.dist[j];
  const f = d1 > d0 ? Math.min(1, Math.max(0, (d - d0) / (d1 - d0))) : 0;
  return lap.t[i] + (lap.t[j] - lap.t[i]) * f;
}

export const fmtLap = (s) => {
  if (s == null || !Number.isFinite(s)) return '—';
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(3).padStart(6, '0')}`;
};
