// Модель Weather: температуры, состояние трассы, осадки, ветер и курс машины относительно севера
// (оверлей крутит компас так, чтобы машина смотрела вверх, а стрелка ветра показывала, откуда дует).

const num = (v) => (Number.isFinite(v) ? v : null);

function buildWeather(race) {
  const v = race.vars || {};
  return {
    kind: race.kind,
    imperial: v.DisplayUnits === 0,
    trackTemp: num(v.TrackTempCrew ?? v.TrackTemp),
    airTemp: num(v.AirTemp),
    trackWetness: num(v.TrackWetness),   // 1 сухо … 7 очень мокро
    precip: num(v.Precipitation),        // 0…1
    humidity: num(v.RelativeHumidity),   // 0…1
    fog: num(v.FogLevel),                // 0…1
    windSpeed: num(v.WindVel),           // м/с
    windDir: num(v.WindDir),             // рад от севера, откуда дует
    yawNorth: num(v.YawNorth),           // рад, курс машины от севера
  };
}

module.exports = { buildWeather };
