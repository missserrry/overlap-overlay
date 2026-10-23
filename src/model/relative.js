// Модель Relative: машины рядом на трассе (впереди/позади), отрыв во времени.
// Отдаём с запасом — сколько строк влезет, решает оверлей по высоте окна.

function buildRelative(race, opts = {}) {
  const ahead = opts.carsAhead ?? 10;
  const behind = opts.carsBehind ?? 10;
  const ref = race.ref;
  if (!ref || !ref.inWorld) return { ...header(race), rows: [] };

  // Отрыв — реальное время до машины на трассе, независимо от круга и класса. Считаем от расстояния по трассе:
  //   впереди — за сколько вы её догоните на своём темпе (доля круга × ваш круг),
  //   сзади — за сколько она догонит вас на своём (доля круга × её круг).
  // CarIdxEstTime тут не годится: он считается в «часах» своего класса, и между классами отрыв получался в сотни секунд.
  const myLap = ref.classEstLap || ref.bestLap || ref.lastLap || 100;
  const lapOf = (c) => c.classEstLap || c.bestLap || c.lastLap || myLap;
  const around = [];
  for (const c of race.cars) {
    if (!c.inWorld || c === ref) continue;
    let d = c.lapDistPct - ref.lapDistPct;
    if (d > 0.5) d -= 1;
    if (d < -0.5) d += 1;
    const t = d > 0 ? d * myLap : d * lapOf(c); // знак как у d: впереди +, сзади −
    around.push({ car: c, d, t });
  }

  const front = around.filter((x) => x.d > 0).sort((a, b) => a.d - b.d).slice(0, ahead).reverse();
  const back = around.filter((x) => x.d <= 0).sort((a, b) => b.d - a.d).slice(0, behind);

  const rows = [
    ...front.map((x) => row(x.car, x.t, x.d, ref, race)),
    row(ref, 0, 0, ref, race),
    ...back.map((x) => row(x.car, x.t, x.d, ref, race)),
  ];
  return { ...header(race), rows };
}

function row(car, t, d, ref, race) {
  // В гонке подсвечиваем машины на другом круге: впереди по кругу (красный) или отстающие (синий)
  let lapState = 'same';
  if (race.kind === 'race' && car !== ref) {
    const lapDiff = Math.round(car.totalDist - ref.totalDist - d);
    if (lapDiff > 0) lapState = 'ahead';
    else if (lapDiff < 0) lapState = 'behind';
  }
  return {
    carIdx: car.carIdx,
    position: car.classPos,
    number: car.number,
    brand: car.brand,
    tire: car.tire,
    posChange: car.posChange,
    lastLap: car.lastLap,
    bestLap: car.bestLap,
    name: car.name,
    classColor: car.classColor,
    license: car.license,
    irating: car.irating,
    iratingDelta: car.iratingDelta ?? null,
    gap: Math.abs(t),
    isPlayer: car === ref,
    onPitRoad: car.onPitRoad,
    lapState,
  };
}

function header(race) {
  const ref = race.ref;
  const cls = ref ? race.classes.get(ref.classId) : null;
  return {
    kind: race.kind,
    sessionName: race.sessionName,
    sof: cls ? cls.sof : race.sof,
    incidents: race.incidents,
    incidentLimit: race.incidentLimit,
    session: race.session,
    lap: ref ? Math.max(ref.lap, 0) : 0,
    lapsEstimate: estimateTotalLaps(race),
    classPos: ref?.classPos ?? null,
    classSize: cls?.cars.length ?? null,
  };
}

// Сколько кругов будет в гонке на время: проехано + оставшееся время / темп лидера
function estimateTotalLaps(race) {
  if (race.session.lapsTotal) return { value: race.session.lapsTotal, exact: true };
  const ref = race.ref;
  if (!ref || race.session.remain == null) return null;
  const cls = race.classes.get(ref.classId);
  const leader = cls?.leader || ref;
  const pace = leader.lastLap || leader.bestLap || leader.classEstLap;
  if (!pace) return null;
  const leaderLaps = leader.totalDist + race.session.remain / pace;
  const refLaps = leaderLaps - (leader.totalDist - ref.totalDist);
  return { value: Math.max(refLaps, 0), exact: false };
}

module.exports = { buildRelative, estimateTotalLaps };

