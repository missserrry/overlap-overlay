// Модель Standings: полные списки по классам. Сколько строк показать, решает сам оверлей —
// по высоте своего окна (см. overlays/standings/standings.js).

// Дельта к вашему времени по одному и тому же кругу: берём последний круг (сектор), который есть и у вас, и у пилота, без заездов на питлейн.
// Значение меняется только когда кто-то из вас закончил круг (сектор), а не вживую по ходу круга.
function sameLapDelta(my, their, pick) {
  const laps = [...my.laps.keys(), ...my.secs.keys()];
  for (const k of [...new Set(laps)].sort((a, b) => b - a).slice(0, 6)) {
    const a = pick(my, k), b = pick(their, k);
    if (a != null && b != null) return b - a;
  }
  return null;
}
const pickLap = (st, k) => st.laps.get(k) ?? null;
const pickSector = (i) => (st, k) => st.secs.get(k)?.[i] ?? null;

function buildStandings(race) {
  const classes = [...race.classes.values()].sort((a, b) => b.relSpeed - a.relSpeed);
  // Дельта круга: прошлый круг пилота минус ваш прошлый круг. Только внутри вашего класса: сравнивать GT3 с гиперкаром бессмысленно
  const mine = classes.find((cls) => cls.cars.some((c) => c.isPlayer));
  const me = mine?.cars.find((c) => c.isPlayer)?.timing;
  const sectorCount = me?.count > 1 ? me.count : 0;
  return {
    kind: race.kind,
    sessionName: race.sessionName,
    session: race.session,
    multiClass: race.multiClass,
    // где вы на трассе по секторам: сколько секторов, какой закончили последним и сколько закончено (по этому счёту оверлей листает тройки секторов)
    secInfo: sectorCount ? { count: sectorCount, done: me.secDone ? me.secDone.idx : -1, seq: me.secDone ? me.secDone.n : 0 } : null,
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
        lapDelta: cls === mine && !c.isPlayer && me && c.timing ? sameLapDelta(me, c.timing, pickLap) : null,
        secDelta: sectorCount && cls === mine && !c.isPlayer && c.timing ? Array.from({ length: sectorCount }, (_, i) => sameLapDelta(me, c.timing, pickSector(i))) : null,
        isFastest: !!c.bestLap && c.bestLap === cls.fastest,
        isPlayer: c.isPlayer,
        onPitRoad: c.onPitRoad,
        inWorld: c.inWorld,
      })),
    })),
  };
}

module.exports = { buildStandings };
