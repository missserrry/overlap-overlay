// Модель DigiFlag: какой флаг показывать. iRacing отдаёт SessionFlags битовой маской; на панели
// одновременно один флаг — самый важный (как у RaceLab: красный, клетчатый, чёрный, жёлтый/SC, синий, белый, зелёный).

const F = {
  checkered: 0x0001, white: 0x0002, green: 0x0004, yellow: 0x0008, red: 0x0010, blue: 0x0020, debris: 0x0040,
  crossed: 0x0080, yellowWaving: 0x0100, greenHeld: 0x0400, randomWaving: 0x2000, caution: 0x4000, cautionWaving: 0x8000,
  black: 0x010000, disqualify: 0x020000, furled: 0x080000, repair: 0x100000, startGo: 0x80000000,
};

// По убыванию важности: id флага на панели → какие биты его включают
const ORDER = [
  ['red', F.red],
  ['checkered', F.checkered],
  ['disqualify', F.disqualify],
  ['black', F.black | F.furled],
  ['repair', F.repair],
  ['safety', F.caution | F.cautionWaving],
  ['debris', F.debris],
  ['yellow', F.yellow | F.yellowWaving | F.randomWaving | F.crossed],
  ['blue', F.blue],
  ['white', F.white],
  ['green', F.green | F.greenHeld | F.startGo],
];

function buildFlags(race) {
  const bits = (race.vars?.SessionFlags ?? 0) >>> 0;
  const active = ORDER.filter(([, mask]) => (bits & mask) !== 0).map(([id]) => id);
  return { flag: active[0] || null, active };
}

module.exports = { buildFlags };
