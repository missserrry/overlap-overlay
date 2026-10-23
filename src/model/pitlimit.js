// Модель Pit Limiter: подъезд к питлейну и скорость в боксах.
// Показываем, пока вы на дороге к питлейну (iRacing: TrackSurface = AproachingPits) и на питлейне (но не в боксе).
// После пересечения линии выезда ещё несколько секунд отдаём режим «exit» — «можно ехать».

const SURF_STALL = 1, SURF_APPROACH = 2, SURF_TRACK = 3;
const LIMITER_BIT = 0x10;       // EngineWarnings: включён ограничитель скорости в боксах

let wasOnPit = false;
let exitAt = 0;
let key = '';

// "60.00 kph" или "37.28 mph" → км/ч
function limitKph(text) {
  const n = parseFloat(text);
  if (!Number.isFinite(n) || n <= 0) return null;
  return /mph/i.test(String(text)) ? n * 1.609344 : n;
}

function buildPit(race, now = Date.now()) {
  const v = race.vars || {};
  const ref = race.ref;
  if (!ref || !ref.inWorld || ref.carIdx !== v.PlayerCarIdx) { wasOnPit = false; return { active: false }; }

  const k = `${race.kind}|${race.refIdx}`;
  if (k !== key) { key = k; wasOnPit = false; exitAt = 0; }

  const surf = v.CarIdxTrackSurface?.[ref.carIdx];
  const onPit = !!ref.onPitRoad;
  // пересекли линию выезда: были на питлейне, теперь на трассе
  if (wasOnPit && !onPit && surf === SURF_TRACK) exitAt = now;
  wasOnPit = onPit;

  let mode = 'hidden';
  if (surf === SURF_STALL) mode = 'hidden';
  else if (onPit || surf === SURF_APPROACH) mode = 'limit';
  else if (exitAt && surf === SURF_TRACK && now - exitAt < 30000) mode = 'exit';

  return {
    active: true,
    mode,
    speed: Number.isFinite(v.Speed) ? v.Speed * 3.6 : 0,        // км/ч
    limit: limitKph(race.pitSpeedLimit),                         // км/ч, null — неизвестен
    limiter: (((v.EngineWarnings | 0) & LIMITER_BIT) !== 0),
    imperial: v.DisplayUnits === 0,
    sinceExit: exitAt ? now - exitAt : null,                     // мс с момента выезда
  };
}

module.exports = { buildPit };
