// Модель Standings: полные списки по классам. Сколько строк показать, решает сам оверлей —
// по высоте своего окна (см. overlays/standings/standings.js).

function buildStandings(race) {
  const classes = [...race.classes.values()].sort((a, b) => b.relSpeed - a.relSpeed);
  // Дельта круга: прошлый круг пилота минус ваш прошлый круг. Только внутри вашего класса: сравнивать GT3 с гиперкаром бессмысленно
  const mine = classes.find((cls) => cls.cars.some((c) => c.isPlayer));
  const myLap = mine?.cars.find((c) => c.isPlayer)?.lastLap;
  return {
    kind: race.kind,
    sessionName: race.sessionName,
    session: race.session,
    multiClass: race.multiClass,
    classes: classes.map((cls) => ({
      id: cls.id, name: cls.name, color: cls.color, sof: cls.sof,
      drivers: cls.cars.length,
      rows: cls.cars.map((c) => ({
        carIdx: c.carIdx,
        position: c.classPos,
        number: c.number,
        brand: c.brand,
        tire: c.tire,
        posChange: c.posChange,
        name: c.name,
        classColor: c.classColor,
        irating: c.irating,
        iratingDelta: c.iratingDelta ?? null,
        license: c.license,
        gap: c.gap,
        int: c.int,
        bestLap: c.bestLap,
        lastLap: c.lastLap,
        // последний пит-стоп пилота (только ваш класс): время на питлейне и круг въезда
        pitTime: cls === mine ? c.lastPit?.time ?? null : null,
        pitLap: cls === mine ? c.lastPit?.lap ?? null : null,
        lapDelta: cls === mine && !c.isPlayer && myLap > 0 && c.lastLap > 0 ? c.lastLap - myLap : null,
        isFastest: !!c.bestLap && c.bestLap === cls.fastest,
        isPlayer: c.isPlayer,
        onPitRoad: c.onPitRoad,
        inWorld: c.inWorld,
      })),
    })),
  };
}

module.exports = { buildStandings };
