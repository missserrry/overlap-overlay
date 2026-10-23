// Демо-источник: имитирует мультиклассовую гонку и отдаёт снимки в том же виде, что IRacingSdk.read(),
// чтобы модели Relative/Standings работали одинаково на живых и демо-данных.

const FIRST = ['Alex', 'Max', 'Lukas', 'Daniel', 'Marco', 'Jonas', 'Pierre', 'Tom', 'Sergey', 'Ivan', 'Mateo', 'Erik',
  'Noah', 'Felix', 'Oscar', 'Leo', 'Hugo', 'Kai', 'Nico', 'Rafael', 'Simon', 'Viktor', 'Adam', 'Elias'];
const LAST = ['Novak', 'Berg', 'Moreau', 'Kowalski', 'Lindqvist', 'Rossi', 'Petrov', 'Hansen', 'Costa', 'Weber',
  'Duarte', 'Nilsson', 'Fischer', 'Romano', 'Volkov', 'Laurent', 'Becker', 'Svensson', 'Marin', 'Keller',
  'Horvat', 'Sokolov', 'Bauer', 'Ortiz'];
const LIC = [['A', 0x0153db], ['B', 0x33cc00], ['C', 0xfeec04], ['D', 0xfc8a27], ['R', 0xfc0706]];

// зелёный, жёлтый, SC, синий, белый, клетчатый, красный, чёрный, мусор, механик, снова зелёный
const DEMO_FLAGS = [0x4, 0x8, 0x4000, 0x20, 0x2, 0x1, 0x10, 0x10000, 0x40, 0x100000, 0];

const CLASSES = [
  { id: 4029, short: 'LMP2', color: 0xffda59, relSpeed: 90, estLap: 92.4, cars: 6 },
  { id: 2708, short: 'GT3', color: 0x33ceff, relSpeed: 70, estLap: 101.8, cars: 16 },
];

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

class DemoSource {
  constructor() {
    const rand = rng(7);
    this.cars = [];
    let idx = 1; // 0 — пейс-кар
    for (const cls of CLASSES) {
      for (let i = 0; i < cls.cars; i++) {
        const lic = LIC[Math.floor(rand() * LIC.length)];
        this.cars.push({
          idx: idx++,
          cls,
          name: `${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`,
          number: String(Math.floor(rand() * 98) + 2),
          irating: Math.round(1100 + rand() * 4200),
          lic: lic[0],
          licColor: lic[1],
          sr: (1 + rand() * 3.9).toFixed(2),
          lapTime: cls.estLap * (1 + (i * 0.0025) + rand() * 0.004),
          startDist: -i * 0.012 - (cls === CLASSES[0] ? 0 : 0.09),
          best: 0,
          pitUntil: 0,
        });
      }
    }
    this.cars.forEach((c) => { c.best = c.lapTime * (0.992 + Math.random() * 0.004); });
    this.player = this.cars.find((c) => c.cls.short === 'GT3' && c.idx === 13) || this.cars[10];
    this.player.name = 'Вы (Demo)';
    this.raceStart = Date.now() - 20 * 60 * 1000; // будто гонка идёт 20 минут
    this.session = this.buildSession();
  }

  buildSession() {
    return {
      WeekendInfo: {
        TrackDisplayName: 'Demo Raceway', TrackLength: '5.51 km', Category: 'SportsCar',
        WeekendOptions: { IncidentLimit: 25 },
      },
      DriverInfo: {
        DriverCarFuelMaxLtr: 60, DriverCarMaxFuelPct: 1, DriverCarRedLine: 7500, DriverCarIdleRPM: 900, DriverCarSLFirstRPM: 5500, DriverCarSLShiftRPM: 6900, DriverCarSLLastRPM: 7200, DriverCarSLBlinkRPM: 7350,
        DriverTires: [{ TireIndex: 0, TireCompoundType: 'Soft' }, { TireIndex: 1, TireCompoundType: 'Medium' }, { TireIndex: 2, TireCompoundType: 'Hard' }, { TireIndex: 3, TireCompoundType: 'Wet' }],
        DriverCarIdx: this.player.idx,
        Drivers: [
          { CarIdx: 0, UserName: 'Pace Car', CarIsPaceCar: 1, CarClassID: 11, IRating: 0, LicString: 'R 0.00', CarClassShortName: '' },
          ...this.cars.map((c) => ({
            CarIdx: c.idx, UserName: c.name, CarNumber: c.number, CarIsPaceCar: 0, IsSpectator: 0,
            CarScreenName: c.cls.short === 'GT3' ? 'Demo GT3' : 'Demo LMP2',
            CarPath: c.cls.short === 'GT3' ? ['porsche992rgt3', 'bmwm4gt3', 'ferrari296gt3', 'mclaren720sgt3', 'audir8lmsevo2gt3'][c.idx % 5] : 'dallarap217',
            CarClassID: c.cls.id, CarClassShortName: c.cls.short, CarClassRelSpeed: c.cls.relSpeed,
            CarClassColor: c.cls.color, CarClassEstLapTime: c.cls.estLap,
            IRating: c.irating, LicString: `${c.lic} ${c.sr}`, LicColor: c.licColor,
          })),
        ],
      },
      SplitTimeInfo: { Sectors: [0, 0.12, 0.25, 0.38, 0.5, 0.62, 0.75, 0.88].map((p, i) => ({ SectorNum: i, SectorStartPct: p })) },
      QualifyResultsInfo: {
        Results: [...this.cars].sort((a, b) => b.startDist - a.startDist).map((c) => ({
          CarIdx: c.idx, ClassPosition: this.cars.filter((x) => x.cls === c.cls && x.startDist > c.startDist).length,
        })),
      },
      SessionInfo: {
        Sessions: [{ SessionNum: 0, SessionType: 'Race', SessionName: 'RACE', SessionTime: '2700.0000 sec', SessionLaps: 'unlimited', ResultsPositions: null }],
      },
    };
  }

  read() {
    const t = (Date.now() - this.raceStart) / 1000;
    const n = 64;
    const pct = new Array(n).fill(-1), lap = new Array(n).fill(-1), est = new Array(n).fill(0);
    const pos = new Array(n).fill(0), cpos = new Array(n).fill(0), f2 = new Array(n).fill(0);
    const best = new Array(n).fill(-1), last = new Array(n).fill(-1), onPit = new Array(n).fill(false);
    const surface = new Array(n).fill(-1), carClass = new Array(n).fill(0), tire = new Array(n).fill(-1);

    const dist = new Map();
    for (const c of this.cars) {
      // небольшие колебания темпа, чтобы отрывы «дышали»
      const wobble = Math.sin(t / 37 + c.idx) * 0.0016;
      const d = c.startDist + t / c.lapTime + wobble;
      dist.set(c.idx, d);
      const l = Math.floor(d);
      pct[c.idx] = d - l;
      lap[c.idx] = Math.max(l, 0);
      est[c.idx] = pct[c.idx] * c.cls.estLap;
      best[c.idx] = c.best;
      last[c.idx] = c.lapTime * (0.995 + ((c.idx * 7919 + l) % 13) / 1000);
      surface[c.idx] = 3;
      carClass[c.idx] = c.cls.id;
      tire[c.idx] = c.idx % 3 === 0 ? 0 : c.idx % 3 === 1 ? 1 : 2;
      // каждые ~9 минут кто-то заезжает на пит
      onPit[c.idx] = ((t / 60 + c.idx * 1.7) % 9) < 0.5;
      if (onPit[c.idx]) surface[c.idx] = 1;
    }

    // Радар: две машины качаются рядом с игроком (±16 м), по ним же считается «споттер»
    const trackM = 5510;
    const me = this.player;
    const sameClass = [...this.cars].filter((c) => c.cls === me.cls && c !== me).sort((a, b) => Math.abs(dist.get(a.idx) - dist.get(me.idx)) - Math.abs(dist.get(b.idx) - dist.get(me.idx)));
    const gA = sameClass[0], gB = sameClass[1];
    const offA = Math.sin(t / 3.1) * 16, offB = Math.sin(t / 4.4 + 1.2) * 16;
    if (gA) { dist.set(gA.idx, dist.get(me.idx) + offA / trackM); pct[gA.idx] = ((dist.get(gA.idx) % 1) + 1) % 1; }
    if (gB) { dist.set(gB.idx, dist.get(me.idx) + offB / trackM); pct[gB.idx] = ((dist.get(gB.idx) % 1) + 1) % 1; }
    const sideA = gA && Math.abs(offA) < 6.5, sideB = gB && Math.abs(offB) < 6.5;
    const carLR = sideA && sideB ? 4 : sideA ? 2 : sideB ? 3 : 1;

    const order = [...this.cars].sort((a, b) => dist.get(b.idx) - dist.get(a.idx));
    order.forEach((c, i) => { pos[c.idx] = i + 1; });
    for (const cls of CLASSES) {
      const inCls = order.filter((c) => c.cls === cls);
      const leader = inCls[0];
      inCls.forEach((c, i) => {
        cpos[c.idx] = i + 1;
        f2[c.idx] = (dist.get(leader.idx) - dist.get(c.idx)) * c.lapTime;
      });
    }

    // приборы игрока: разгон на каждой передаче 5 секунд, потом переключение, иногда торможение
    const cyc = (t % 5) / 5, gearNo = 1 + (Math.floor(t / 5) % 6);
    const rpmFrac = cyc < 0.9 ? 0.3 + cyc * 0.74 : 0.25;
    const dashRpm = Math.round(900 + rpmFrac * 6600);
    const slFirst = 5500, slLast = 7200;
    const shiftPct = Math.min(Math.max((dashRpm - slFirst) / (slLast - slFirst), 0), 1);
    const braking = (t % 30) > 27;
    const dash = {
      Gear: cyc > 0.9 && cyc < 0.97 ? 0 : gearNo, RPM: dashRpm, Speed: (60 + gearNo * 11 + cyc * 14) / 3.6,
      Throttle: braking ? 0 : (cyc < 0.9 ? 1 : 0), Brake: braking ? 0.7 : 0, Clutch: cyc > 0.9 && cyc < 0.97 ? 0 : 1,
      SteeringWheelAngle: Math.sin(t / 2.3) * 1.2, BrakeABSactive: braking && Math.sin(t * 40) > 0, ShiftIndicatorPct: shiftPct,
      EngineWarnings: (t % 40) > 37 ? 0x10 : 0,
    };

    const p = this.player.idx;
    // дельта круга: накапливается по кругу с разным наклоном в разных секторах, на каждом круге по-новому
    const myPct = pct[p], myLapNo = lap[p];
    const lapDelta = (0.5 + 0.35 * Math.sin(myLapNo * 1.7)) * myPct + 0.12 * Math.sin(myPct * 22 + myLapNo);
    return {
      connected: true,
      demo: true,
      tick: Math.floor(t * 60),
      sessionVersion: 1,
      session: this.session,
      vars: {
        PlayerCarIdx: p, CamCarIdx: p, SessionNum: 0,
        SessionTime: t, SessionTimeRemain: Math.max(2700 - t, 0), SessionTimeTotal: 2700,
        SessionLapsRemainEx: 32767, SessionLapsTotal: 32767,
        SessionState: 4, IsOnTrack: true, IsInGarage: false, IsReplayPlaying: false,
        PlayerCarMyIncidentCount: 6, PlayerCarDriverIncidentCount: 6,
        CarIdxLapDistPct: pct, CarIdxLap: lap, CarIdxLapCompleted: lap.map((x) => Math.max(x - 1, -1)),
        CarIdxEstTime: est, CarIdxPosition: pos, CarIdxClassPosition: cpos, CarIdxF2Time: f2,
        CarIdxBestLapTime: best, CarIdxLastLapTime: last, CarIdxOnPitRoad: onPit,
        CarIdxTrackSurface: surface, CarIdxClass: carClass,
        CarIdxTireCompound: tire,
        CarLeftRight: carLR,
        ...dash,
        SessionFlags: DEMO_FLAGS[Math.floor(Date.now() / 4000) % DEMO_FLAGS.length],
        AirTemp: 24.3, TrackTempCrew: 31.8, TrackWetness: 3, Precipitation: 0.18, YawNorth: (t * 0.12) % (Math.PI * 2), RelativeHumidity: 0.46, FogLevel: 0,
        WindDir: 1.2, WindVel: 3.6, SessionTimeOfDay: 52200 + t, LapCurrentLapTime: myPct * this.player.lapTime, LapBestLapTime: best[p] > 0 ? best[p] : this.player.lapTime * 0.996, LapLastLapTime: last[p] > 0 ? last[p] : this.player.lapTime * 1.004, LapDeltaToBestLap: lapDelta, LapDeltaToBestLap_OK: true, LapDeltaToSessionBestLap: lapDelta * 1.2, LapDeltaToSessionBestLap_OK: true, LapDeltaToSessionLastlLap: lapDelta * 0.8, LapDeltaToSessionLastlLap_OK: true, LapDeltaToOptimalLap: lapDelta * 1.5, LapDeltaToOptimalLap_OK: true,
        FuelLevel: 42 - ((t / this.player.lapTime) % 40) * 0.9, FuelLevelPct: (42 - ((t / this.player.lapTime) % 40) * 0.9) / 60, FuelUsePerHour: 0.9 * 3600 / this.player.lapTime, PitSvFuel: 0, OilTemp: 104, WaterTemp: 88, dcBrakeBias: 54.3, DisplayUnits: 1,
      },
    };
  }
}

module.exports = { DemoSource };
