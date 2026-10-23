// Модель Dash: передача, обороты, скорость, педали, руль и пороги шифт-ламп машины.
// Пороги берём из описания машины в iRacing (DriverInfo): точки и дуга совпадут с родными лампами игры.

const num = (v) => (Number.isFinite(v) ? v : null);

function buildDash(race) {
  const v = race.vars || {};
  const di = race.driverInfo || {};
  return {
    gear: num(v.Gear),                 // -1 задняя, 0 нейтраль
    rpm: num(v.RPM),
    speed: num(v.Speed),               // м/с
    imperial: v.DisplayUnits === 0,
    throttle: num(v.Throttle),         // 0…1
    brake: num(v.Brake),               // 0…1
    clutch: v.Clutch == null ? null : 1 - v.Clutch, // iRacing: 1 — сцепление включено, педаль отпущена
    steer: num(v.SteeringWheelAngle),  // рад
    abs: !!v.BrakeABSactive,
    pitLimiter: ((v.EngineWarnings | 0) & 0x10) !== 0, // включён ограничитель скорости в боксах
    shiftPct: num(v.ShiftIndicatorPct),// 0…1: «насколько близко до переключения» по версии iRacing
    sl: {
      first: num(parseFloat(di.DriverCarSLFirstRPM)),
      shift: num(parseFloat(di.DriverCarSLShiftRPM)),
      last: num(parseFloat(di.DriverCarSLLastRPM)),
      blink: num(parseFloat(di.DriverCarSLBlinkRPM)),
      redline: num(parseFloat(di.DriverCarRedLine)),
      idle: num(parseFloat(di.DriverCarIdleRPM)),
    },
    classPos: race.ref?.classPos ?? null,
  };
}

module.exports = { buildDash };
