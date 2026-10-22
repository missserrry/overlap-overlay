// Прилипание окон оверлеев при перемещении и растягивании.
// Повторяет поведение Laki Overlay (RaceOverlay.Overlay.WindowSnapper), константы — оттуда же:
//   прилипание на 8 px, подсказки-направляющие с 40 px, выступ направляющей 14 px, минимальный размер 30 px.
//   Цели: края и центр экрана, края других оверлеев; при растягивании — ещё и размер соседнего окна.
//   Shift отключает прилипание.

const THRESHOLD = 8;
const HINT = 40;
const OVERHANG = 14;
const MIN_SIZE = 30;

// Цвета направляющих: прилипло к краю / размер как у соседа / рядом (из EdgeColor, MirrorColor, NearColor)
const COLORS = { edge: 'rgb(245,197,24)', mirror: 'rgb(77,163,255)', near: 'rgb(150,156,170)' };

const right = (r) => r.x + r.width;
const bottom = (r) => r.y + r.height;

// Линии, к которым можно прилипнуть. Считаются один раз в начале перетаскивания.
function begin(rect, others, monitor) {
  const xs = [], ys = [];
  const add = (list, pos, from, to) => list.push({ pos, from, to });
  // экран: края и центр
  add(xs, monitor.x, monitor.y, bottom(monitor));
  add(xs, right(monitor), monitor.y, bottom(monitor));
  add(xs, monitor.x + Math.round(monitor.width / 2), monitor.y, bottom(monitor));
  add(ys, monitor.y, monitor.x, right(monitor));
  add(ys, bottom(monitor), monitor.x, right(monitor));
  add(ys, monitor.y + Math.round(monitor.height / 2), monitor.x, right(monitor));
  // другие оверлеи: их края (выравнивание по краю и вплотную друг к другу)
  for (const o of others) {
    add(xs, o.x, o.y, bottom(o));
    add(xs, right(o), o.y, bottom(o));
    add(ys, o.y, o.x, right(o));
    add(ys, bottom(o), o.x, right(o));
  }
  return { start: { ...rect }, xs, ys, others };
}

// Ближайшая линия к одному из значений edges (на сколько сдвинуть, чтобы совпало)
function best(lines, edges, limit) {
  let found = null;
  for (const line of lines) {
    for (const e of edges) {
      const d = line.pos - e.value;
      if (Math.abs(d) <= limit && (!found || Math.abs(d) < Math.abs(found.delta))) found = { delta: d, line, edge: e.name };
    }
  }
  return found;
}

function guideFor(line, vertical, rect, color) {
  // линия тянется вдоль обоих объектов (окно и цель) и выступает на OVERHANG
  const a = vertical ? rect.y : rect.x;
  const b = vertical ? bottom(rect) : right(rect);
  const from = Math.min(a, line.from) - OVERHANG;
  const to = Math.max(b, line.to) + OVERHANG;
  return vertical ? { x1: line.pos, y1: from, x2: line.pos, y2: to, color } : { x1: from, y1: line.pos, x2: to, y2: line.pos, color };
}

// Перемещение: rect — куда окно хочет встать по курсору. Возвращает прилипший rect и направляющие.
function moving(state, rect, disabled) {
  if (disabled) return { rect, guides: [] };
  const out = { ...rect };
  const guides = [];
  const xEdges = () => [
    { name: 'left', value: out.x }, { name: 'right', value: right(out) }, { name: 'center', value: out.x + out.width / 2 },
  ];
  const yEdges = () => [
    { name: 'top', value: out.y }, { name: 'bottom', value: bottom(out) }, { name: 'middle', value: out.y + out.height / 2 },
  ];
  const bx = best(state.xs, xEdges(), THRESHOLD);
  if (bx) out.x += Math.round(bx.delta);
  const by = best(state.ys, yEdges(), THRESHOLD);
  if (by) out.y += Math.round(by.delta);

  if (bx) guides.push(guideFor(bx.line, true, out, COLORS.edge));
  else { const n = best(state.xs, xEdges(), HINT); if (n) guides.push(guideFor(n.line, true, out, COLORS.near)); }
  if (by) guides.push(guideFor(by.line, false, out, COLORS.edge));
  else { const n = best(state.ys, yEdges(), HINT); if (n) guides.push(guideFor(n.line, false, out, COLORS.near)); }
  return { rect: out, guides };
}

// Растягивание за правый/нижний край или угол (edge: 'e' | 's' | 'se').
function sizing(state, rect, edge, disabled) {
  const out = { ...rect, width: Math.max(MIN_SIZE, rect.width), height: Math.max(MIN_SIZE, rect.height) };
  const guides = [];
  if (disabled) return { rect: out, guides };

  if (edge.includes('e')) {
    const r = best(state.xs, [{ name: 'right', value: right(out) }], THRESHOLD);
    // размер как у соседа (синяя направляющая) — если правый край никуда не прилип
    const mirror = !r && state.others
      .map((o) => ({ o, d: o.width - out.width }))
      .filter((m) => Math.abs(m.d) <= THRESHOLD)
      .sort((a, b) => Math.abs(a.d) - Math.abs(b.d))[0];
    if (r) {
      out.width = Math.max(MIN_SIZE, out.width + Math.round(r.delta));
      guides.push(guideFor(r.line, true, out, COLORS.edge));
    } else if (mirror) {
      out.width += mirror.d;
      guides.push(widthGuide(out, COLORS.mirror), widthGuide(mirror.o, COLORS.mirror));
    } else {
      const n = best(state.xs, [{ name: 'right', value: right(out) }], HINT);
      if (n) guides.push(guideFor(n.line, true, out, COLORS.near));
    }
  }
  if (edge.includes('s')) {
    const b = best(state.ys, [{ name: 'bottom', value: bottom(out) }], THRESHOLD);
    const mirror = !b && state.others
      .map((o) => ({ o, d: o.height - out.height }))
      .filter((m) => Math.abs(m.d) <= THRESHOLD)
      .sort((a, c) => Math.abs(a.d) - Math.abs(c.d))[0];
    if (b) {
      out.height = Math.max(MIN_SIZE, out.height + Math.round(b.delta));
      guides.push(guideFor(b.line, false, out, COLORS.edge));
    } else if (mirror) {
      out.height += mirror.d;
      guides.push(heightGuide(out, COLORS.mirror), heightGuide(mirror.o, COLORS.mirror));
    } else {
      const n = best(state.ys, [{ name: 'bottom', value: bottom(out) }], HINT);
      if (n) guides.push(guideFor(n.line, false, out, COLORS.near));
    }
  }
  return { rect: out, guides };
}

// Отметка «такой же размер»: линия вдоль верхней/левой стороны окна
const widthGuide = (r, color) => ({ x1: r.x, y1: r.y - 3, x2: right(r), y2: r.y - 3, color });
const heightGuide = (r, color) => ({ x1: r.x - 3, y1: r.y, x2: r.x - 3, y2: bottom(r), color });

module.exports = { begin, moving, sizing, MIN_SIZE, THRESHOLD, HINT, OVERHANG, COLORS };
