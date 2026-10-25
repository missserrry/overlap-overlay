// Оценка Safety Rating. iRacing формулу не публикует; здесь открытая реконструкция
// Nishizumi-SR (https://github.com/nishizumi-maho/Nishizumi-SR, © 2026 Maho Nishizumi, MIT),
// подобранная по официальным CPI «до/после» из результатов iRacing (123 361 сессия, средняя ошибка ≈0.03 SR).
// Описание модели и происхождение констант — docs/MODEL.md в том репозитории.
//
// Скрытое состояние — CPI (поворотов на инцидент). Видимый SR — только отображение CPI внутри целой «полосы» b:
//   Φ(класс, b) = Φ0 · r^(класс + b)          — CPI, при котором полоса показывает ровно b.00
//   SR          = b + a · ln(CPI / Φ)
//   α           = 1 − e^(−повороты / W)        — доля сессии в скользящем среднем
//   1/CPI'      = (1 − α)/CPI + α · инциденты/повороты
// Если SR выходит за [b, b + 1), тот же CPI перерисовывается в соседней полосе — отсюда скачок ≈0.43 через целое.

const A = 1.5236;          // наклон SR от ln(CPI) внутри полосы
const R = 1.4562;          // отношение порогов соседних полос и классов
const PHI0 = 3.4949;       // порог CPI: класс Rookie, полоса 0
const W1 = 1060;           // память скользящего среднего в полосе 1, поворотов
const W_RATIO = 1.4142;    // рост памяти на каждую полосу (≈√2)
const W_FACTOR = [0.69, 0.83];  // Rookie и D меняются быстрее; C и выше — 1
const SR_MAX = 4.99;
const BAND_MAX = 4;

// LicLevel (1…24) хранит класс и полосу вместе: класс 0 Rookie … 5 Pro, полоса 1…4.
// Полосу берём отсюда, а не из округления SR: сразу после скачка на 3.41 полоса уже 3.
function licenceFromLevel(level) {
  const l = Number(level);
  if (!Number.isFinite(l) || l < 1) return null;
  return { cls: Math.floor((l - 1) / 4), band: ((l - 1) % 4) + 1 };
}

const bandFloor = (cls, band) => PHI0 * Math.pow(R, cls + band);

function srFromCpi(cpi, cls, band) {
  if (cpi <= 0) return band;
  return band + A * Math.log(cpi / bandFloor(cls, band));
}

function cpiFromSr(sr, cls, band) {
  const b = Math.min(Math.max(band, 0), BAND_MAX);
  return bandFloor(cls, b) * Math.exp((sr - b) / A);
}

// Перерисовать CPI в той полосе, где SR ложится в [b, b + 1)
function remapBand(cpi, cls, band) {
  let b = Math.min(Math.max(band, 0), BAND_MAX);
  for (let i = 0; i < 8; i++) {
    const sr = srFromCpi(cpi, cls, b);
    if (sr >= b + 1 && b < BAND_MAX) { b++; continue; }
    if (sr < b && b > 0) { b--; continue; }
    break;
  }
  return { sr: Math.min(Math.max(srFromCpi(cpi, cls, b), 0), SR_MAX), band: b };
}

function windowCorners(cls, band) {
  const factor = cls <= 0 ? W_FACTOR[0] : cls === 1 ? W_FACTOR[1] : 1;
  return W1 * Math.pow(W_RATIO, Math.max(band - 1, 0)) * factor;
}

function sessionAlpha(corners, cls, band) {
  if (corners <= 0) return 0;
  return 1 - Math.exp(-corners / Math.max(windowCorners(cls, band), 1));
}

// Сессия (повороты и инциденты уже умножены на вес сессии) вливается в накопленный CPI
function updateCpi(cpiOld, corners, incidents, cls, band) {
  if (corners <= 0 || cpiOld <= 0) return cpiOld;
  const alpha = sessionAlpha(corners, cls, band);
  const rate = (1 - alpha) / cpiOld + (alpha * incidents) / corners;
  return rate <= 1e-9 ? 1e9 : 1 / rate;   // совсем чистое окно — огромный, но конечный CPI
}

// SR после сессии, начатой с srBefore в полосе band; возвращает и полосу, в которой она закончилась
function project(srBefore, cls, band, corners, incidents) {
  const cpi = updateCpi(cpiFromSr(srBefore, cls, band), corners, incidents, cls, band);
  const next = remapBand(cpi, cls, band);
  const delta = Math.min(Math.max(next.sr - srBefore, -3), 3);   // страховка; на практике не достигается
  return { sr: srBefore + delta, band: next.band, cpi };
}

// Сколько ещё чистых поворотов нужно, чтобы сессия вышла в ноль: ΔSR ≥ 0 ⇔ инциденты/повороты ≤ 1/CPI.
// Вес сессии умножает обе стороны, поэтому считаем по настоящим числам.
const cleanCornersNeeded = (incidents, corners, startCpi) => Math.max(incidents * startCpi - corners, 0);

// Вес сессии: гонка 1, квалификация 0.5, одиночные (lone) и заезд на время 0.35;
// практика и разминка SR не меняют (проверено на реальной гонке: рейтинг на входе в гонку — тот, что был до практики),
// одиночные (lone) и заезд на время 0.35, остальное (оффлайн-тесты) — 0.
function sessionWeight(sessionType) {
  const t = String(sessionType || '').toLowerCase();
  if (t.includes('time trial') || t.includes('lone')) return 0.35;
  if (t.includes('practice') || t.includes('warmup')) return 0;
  if (t.includes('qualify')) return 0.5;
  if (t.includes('heat') || t.includes('race')) return 1;
  return 0;
}

module.exports = {
  licenceFromLevel, bandFloor, srFromCpi, cpiFromSr, remapBand, windowCorners, sessionAlpha, updateCpi, project,
  cleanCornersNeeded, sessionWeight, CONSTANTS: { A, R, PHI0, W1, W_RATIO, W_FACTOR, SR_MAX },
};
