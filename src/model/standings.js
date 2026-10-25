// Модель Standings: полные списки по классам. Сколько строк показать, решает сам оверлей —
// по высоте своего окна (см. overlays/standings/standings.js).

function buildStandings(race) {
  const classes = [...race.classes.values()].sort((a, b) => b.relSpeed - a.relSpeed);
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
        srDelta: c.srDelta ?? null,
        license: c.license,
        gap: c.gap,
        int: c.int,
        bestLap: c.bestLap,
        lastLap: c.lastLap,
        isFastest: !!c.bestLap && c.bestLap === cls.fastest,
        isPlayer: c.isPlayer,
        onPitRoad: c.onPitRoad,
        inWorld: c.inWorld,
      })),
    })),
  };
}

module.exports = { buildStandings };
