// Общие помощники для моделей оверлеев: пилоты, классы, лицензии, сессия.
const { brandInfo } = require('./brands');

// Переменные телеметрии, которые читаем каждый тик
const TELEMETRY_VARS = [
  'PlayerCarIdx', 'CamCarIdx', 'SessionNum', 'SessionTime', 'SessionTimeRemain', 'SessionTimeTotal',
  'SessionLapsRemainEx', 'SessionLapsTotal', 'SessionState', 'IsOnTrack', 'IsInGarage', 'IsReplayPlaying',
  'PlayerCarMyIncidentCount', 'PlayerCarDriverIncidentCount', 'LoadNumTextures',
  'CarIdxLapDistPct', 'CarIdxLap', 'CarIdxLapCompleted', 'CarIdxEstTime', 'CarIdxPosition',
  'CarIdxClassPosition', 'CarIdxF2Time', 'CarIdxBestLapTime', 'CarIdxLastLapTime',
  'CarIdxOnPitRoad', 'CarIdxTrackSurface', 'CarIdxClass', 'CarIdxTireCompound',
  'AirTemp', 'TrackTempCrew', 'TrackTemp', 'TrackWetness', 'Precipitation', 'RelativeHumidity', 'FogLevel', 'WindDir', 'WindVel',
  'SessionTimeOfDay', 'LapDeltaToBestLap', 'FuelLevel', 'OilTemp', 'WaterTemp', 'dcBrakeBias', 'DisplayUnits', 'YawNorth', 'SessionFlags', 'CarLeftRight',
  'LapDeltaToBestLap_OK', 'LapDeltaToSessionLastlLap', 'LapDeltaToSessionLastlLap_OK', 'LapDeltaToSessionLastLap', 'LapDeltaToSessionLastLap_OK', 'LapCurrentLapTime', 'LapBestLapTime', 'LapLastLapTime', 'LapDeltaToSessionBestLap', 'LapDeltaToSessionBestLap_OK', 'LapDeltaToOptimalLap', 'LapDeltaToOptimalLap_OK',
  'Gear', 'RPM', 'Speed', 'Throttle', 'Brake', 'Clutch', 'SteeringWheelAngle', 'BrakeABSactive', 'ShiftIndicatorPct', 'EngineWarnings',
];

// Цвета лицензий: [основной (буква), тёмный (рейтинг)]
const LICENSE_COLORS = {
  R: ['#DC2626', '#7F1D1D'],
  D: ['#EA580C', '#7C2D12'],
  C: ['#CA8A04', '#713F12'],
  B: ['#65A30D', '#365314'],
  A: ['#2563EB', '#1E3A8A'],
  P: ['#3F3F46', '#18181B'],
  W: ['#3F3F46', '#18181B'],
};

function hexColor(value, fallback = '#ffffff') {
  if (value == null || value === '') return fallback;
  const n = typeof value === 'number' ? value : parseInt(String(value).replace(/^0x/i, ''), 16);
  if (!Number.isFinite(n)) return fallback;
  return '#' + n.toString(16).padStart(6, '0').slice(-6);
}

function parseLicense(licString) {
  // "A 3.70" или "PWC 4.99"
  const [cls = 'R', sr = '0.00'] = String(licString || '').trim().split(/\s+/);
  const letter = cls === 'PWC' ? 'P' : cls.charAt(0).toUpperCase();
  const [bg, dark] = LICENSE_COLORS[letter] || LICENSE_COLORS.R;
  return { name: letter, safetyRank: Number(sr).toFixed(1), bgColor: bg, darkBgColor: dark };
}

function formatIrating(ir) {
  if (!ir || ir <= 0) return '';
  return ir >= 1000 ? (ir / 1000).toFixed(1) + 'k' : String(ir);
}

// Индекс пилотов из сессионного YAML: carIdx -> пилот
function driverIndex(session) {
  const map = new Map();
  const drivers = session?.DriverInfo?.Drivers || [];
  for (const d of drivers) {
    if (d.CarIsPaceCar || d.IsSpectator) continue;
    map.set(d.CarIdx, {
      carIdx: d.CarIdx,
      name: String(d.UserName ?? '').trim(),
      team: String(d.TeamName ?? '').trim(),
      number: String(d.CarNumber ?? ''),
      classId: d.CarClassID,
      className: String(d.CarClassShortName || d.CarScreenNameShort || '').trim(),
      classColor: hexColor(d.CarClassColor),
      classRelSpeed: Number(d.CarClassRelSpeed) || 0,
      classEstLap: Number(d.CarClassEstLapTime) || 0,
      irating: Number(d.IRating) || 0,
      license: parseLicense(d.LicString),
      brand: brandInfo(d.CarPath, d.CarScreenName),
    });
  }
  return map;
}

function currentSession(session, sessionNum) {
  const list = session?.SessionInfo?.Sessions || [];
  return list.find((s) => s.SessionNum === sessionNum) || list[list.length - 1] || null;
}

function sessionKind(sess) {
  const t = String(sess?.SessionType || '').toLowerCase();
  if (t.includes('race')) return 'race';
  if (t.includes('qual')) return 'qualify';
  if (t.includes('practice') || t.includes('warmup')) return 'practice';
  return 'other';
}

function sessionLetter(kind) {
  return { race: 'R', qualify: 'Q', practice: 'P' }[kind] || 'T';
}

// "2700.0000 sec" -> 2700, "unlimited" -> null
function parseSessionTime(str) {
  const n = parseFloat(String(str ?? ''));
  return Number.isFinite(n) ? n : null;
}

// Машина, относительно которой считаем (своя или камера при просмотре повтора/споттинге)
function referenceCar(vars) {
  const player = vars.PlayerCarIdx;
  const inWorld = (idx) => idx >= 0 && (vars.CarIdxTrackSurface?.[idx] ?? -1) !== -1;
  if (!vars.IsReplayPlaying && inWorld(player)) return player;
  if (inWorld(vars.CamCarIdx)) return vars.CamCarIdx;
  return player;
}

// Что происходит в симе — для выбора раскладки и видимости оверлеев
function simContext(snap) {
  const { vars = {}, session } = snap;
  const me = (session?.DriverInfo?.Drivers || []).find((d) => d.CarIdx === session?.DriverInfo?.DriverCarIdx);
  const sess = currentSession(session, vars.SessionNum);
  const onTrack = !!vars.IsOnTrack;
  const inGarage = !!vars.IsInGarage;
  return {
    car: String(me?.CarScreenName || ''),
    carClass: String(me?.CarClassShortName || ''),
    category: String(session?.WeekendInfo?.Category || '').toLowerCase().replace(/\s+/g, ''),
    track: String(session?.WeekendInfo?.TrackDisplayName || ''),
    session: sessionKind(sess),
    onTrack,
    inGarage,
    spotting: !onTrack && !inGarage,
  };
}

function strengthOfField(iratings) {
  const list = iratings.filter((x) => x > 0);
  if (!list.length) return 0;
  const br = 1600 / Math.LN2;
  const sum = list.reduce((s, r) => s + Math.exp(-r / br), 0);
  return Math.round(br * Math.log(list.length / sum));
}

module.exports = {
  TELEMETRY_VARS, driverIndex, currentSession, sessionKind, sessionLetter, parseSessionTime,
  referenceCar, strengthOfField, formatIrating, hexColor, simContext, tireNames, tireInfo,
};

// Шины: индекс состава из телеметрии (CarIdxTireCompound) + названия составов из YAML (DriverInfo.DriverTires)
const TIRE_COLORS = { S: '#E5483D', M: '#F2C230', H: '#F2F2F2', W: '#3B82F6', I: '#34B36B', D: '#BDBDBD' };
function tireNames(session) {
  const map = new Map();
  for (const t of session?.DriverInfo?.DriverTires || []) map.set(Number(t.TireIndex), String(t.TireCompoundType || '').trim());
  // У машины один сухой состав (как у GT3): iRacing называет его Hard, но выбора нет — показываем просто «сухие» (D)
  const slicks = [...map.values()].filter((n) => !/^(wet|inter)/i.test(n));
  map.single = slicks.length <= 1;
  return map;
}
function tireInfo(idx, names) {
  if (idx == null || idx < 0) return null;
  const name = names.get(idx) || '';
  const n = name.toLowerCase();
  const code = names.single && /^(hard|med|soft)/.test(n) ? 'D' : n.startsWith('wet') ? 'W' : n.startsWith('inter') ? 'I' : n.startsWith('dry') ? 'D'
    : n.startsWith('soft') ? 'S' : n.startsWith('med') ? 'M' : n.startsWith('hard') ? 'H'
    : n.startsWith('prim') ? 'P' : n.startsWith('alt') ? 'A' : (name.charAt(0).toUpperCase() || String(idx));
  return { code, name: name || `Состав ${idx}`, color: TIRE_COLORS[code] || '#BDBDBD' };
}
