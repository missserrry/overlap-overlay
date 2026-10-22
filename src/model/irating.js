// Оценка изменения iRating по текущим позициям внутри класса.
// Формула — общеизвестная реконструкция расчёта iRacing (Elo-подобная, BR = 1600 / ln 2).

const BR = 1600 / Math.LN2;

function chance(a, b) {
  const ea = Math.exp(-a / BR), eb = Math.exp(-b / BR);
  return ((1 - ea) * eb) / ((1 - eb) * ea + (1 - ea) * eb);
}

// entries: [{carIdx, irating, position}] — позиции 1..N внутри класса
// Возвращает Map carIdx -> целое изменение iRating
function estimateIratingDeltas(entries) {
  const list = entries.filter((e) => e.irating > 0 && e.position > 0);
  const n = list.length;
  const out = new Map();
  if (n < 2) return out;
  for (const e of list) {
    let expected = -0.5; // шанс «обыграть самого себя» = 0.5, вычитаем
    for (const o of list) expected += chance(e.irating, o.irating);
    const fudge = (n / 2 - e.position) / 100;
    const delta = ((n - e.position - expected - fudge) * 200) / n;
    out.set(e.carIdx, Math.round(delta));
  }
  return out;
}

module.exports = { estimateIratingDeltas };
