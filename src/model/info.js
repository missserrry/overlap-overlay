// Сводка для шапки и подвала оверлеев: сессия, свои круги, погода, топливо, температуры.
// Считается один раз за тик и уходит и Relative, и Standings; что из этого показывать — решает сам оверлей.
const { estimateTotalLaps } = require('./relative');

// Расход топлива за круг: по трём последним полным кругам без заезда на пит
const fuelTrack = { key: null, lap: -1, startFuel: null, pitted: false, samples: [] };

function trackFuel(race, vars) {
  const ref = race.ref;
  const fuel = vars.FuelLevel;
  if (!ref || !Number.isFinite(fuel) || fuel < 0 || vars.IsReplayPlaying) return null;
  const key = `${race.kind}|${Math.round(race.session.total ?? 0)}`;
  if (fuelTrack.key !== key) Object.assign(fuelTrack, { key, lap: -1, startFuel: null, pitted: false, samples: [] });
  if (ref.onPitRoad) fuelTrack.pitted = true;
  if (ref.lap !== fuelTrack.lap) {
    if (fuelTrack.lap >= 0 && fuelTrack.startFuel != null && !fuelTrack.pitted) {
      const used = fuelTrack.startFuel - fuel;
      if (used > 0) { fuelTrack.samples.push(used); if (fuelTrack.samples.length > 3) fuelTrack.samples.shift(); }
    }
    fuelTrack.lap = ref.lap; fuelTrack.startFuel = fuel; fuelTrack.pitted = !!ref.onPitRoad;
  }
  const perLap = fuelTrack.samples.length ? fuelTrack.samples.reduce((a, b) => a + b, 0) / fuelTrack.samples.length : null;
  return { level: fuel, perLap, laps: perLap ? fuel / perLap : null };
}

const num = (v) => (Number.isFinite(v) ? v : null);

function buildInfo(race) {
  const { vars = {}, ref, session, classes } = race;
  const cls = ref ? classes.get(ref.classId) : null;
  const est = estimateTotalLaps(race);
  const fuel = trackFuel(race, vars);
  const imperial = vars.DisplayUnits === 0;
  return {
    kind: race.kind,
    sessionName: race.sessionName,
    elapsed: session.elapsed, remain: session.remain, total: session.total, lapsTotal: session.lapsTotal,
    sof: cls ? cls.sof : race.sof,
    incidents: race.incidents, incidentLimit: race.incidentLimit,
    lap: ref ? Math.max(ref.lap, 0) : 0,
    lapsEstimate: est,
    lapsLeft: est && ref ? Math.max(est.value - Math.max(ref.lap, 0), 0) : null,
    pos: ref?.overallPos || ref?.livePos || null,
    classPos: ref?.classPos ?? null,
    classSize: cls?.cars.length ?? null,
    drivers: race.cars.length,
    posChange: ref?.posChange ?? null,
    irDelta: ref?.iratingDelta ?? null,
    // оценка SR (только своя): SR сейчас и изменение, если сессия влияет на SR
    sr: race.sr?.active && race.sr.srStart != null ? { now: race.sr.weight > 0 ? race.sr.srNow : race.sr.srStart, delta: race.sr.weight > 0 ? race.sr.delta : null } : null,
    last: ref?.lastLap ?? null,
    best: ref?.bestLap ?? null,
    delta: num(vars.LapDeltaToBestLap),
    timeOfDay: num(vars.SessionTimeOfDay),
    airTemp: num(vars.AirTemp), trackTemp: num(vars.TrackTempCrew ?? vars.TrackTemp),
    trackWetness: num(vars.TrackWetness),
    precip: num(vars.Precipitation), humidity: num(vars.RelativeHumidity), fog: num(vars.FogLevel),
    windDir: num(vars.WindDir), windSpeed: num(vars.WindVel),
    fuel, oil: num(vars.OilTemp), water: num(vars.WaterTemp), brakeBias: num(vars.dcBrakeBias),
    imperial,
  };
}

module.exports = { buildInfo };
