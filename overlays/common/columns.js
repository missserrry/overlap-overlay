// Колонки таблиц Relative и Standings: одни и те же ячейки, у каждого оверлея свой набор и порядок.
// Список id и значения по умолчанию дублируют src/main/layouts.js (COLUMN_DEFAULTS) — менять вместе.
import { ARROW_DOWN, ARROW_UP, esc, fmtIrating, fmtLap, iratingBadge, licenseBadge } from '/common/overlay.js';

// prio — в каком порядке колонки уходят, когда окно сужается (меньше — уходит раньше).
// 90 и выше не уходят никогда. zone — где колонка в Standings: main — слева, side — в боковой панели.
// w — ширина боковой ячейки, em; head — подпись в заголовке боковой панели.
export const DEFS = {
  pos:   { prio: 95, zone: 'main' },
  posChange: { prio: 28, zone: 'main' },
  num:   { prio: 40, zone: 'main' },
  brand: { prio: 45, zone: 'main' },
  name:  { prio: 99, zone: 'main' },
  lic:   { prio: 50, zone: 'main' },
  ir:    { prio: 60, zone: 'main' },
  delta: { prio: 10, zone: 'main' },
  gap:   { prio: 90, zone: 'side', w: 3.6, head: 'Gap' },
  int:   { prio: 30, zone: 'side', w: 3.6, head: 'Int' },
  last:  { prio: 20, zone: 'side', w: 6.4, head: 'Last' },
  best:  { prio: 25, zone: 'side', w: 6.4, head: 'Fastest' },
  tire:  { prio: 38, zone: 'side', w: 2.6, head: 'Tyre' },
  pit:   { prio: 35, zone: 'side', w: 3.2, head: 'Pit' },
};

const DEFAULTS = {
  relative: ['pos', 'name', 'lic', 'ir', 'delta', 'gap'],
  standings: ['pos', 'name', 'ir', 'delta', 'gap', 'best'],
};
const SUPPORTED = {
  relative: new Set(['pos', 'posChange', 'tire', 'num', 'brand', 'name', 'lic', 'ir', 'delta', 'gap', 'last', 'pit']),
  standings: new Set(['pos', 'posChange', 'tire', 'num', 'brand', 'name', 'lic', 'ir', 'delta', 'gap', 'int', 'last', 'best', 'pit']),
};

// ---------- какие колонки включены (адрес ?cols=..., настройки из приложения, сообщение панели) ----------
let enabled = null;
const listeners = [];
export const currentColumns = (type) => (enabled ?? DEFAULTS[type]).filter((id) => SUPPORTED[type].has(id));
export function onColumns(fn) { listeners.push(fn); }
export function setColumns(ids) {
  if (!Array.isArray(ids) || JSON.stringify(ids) === JSON.stringify(enabled)) return;
  enabled = ids;
  listeners.forEach((f) => f());
}
export const parseColsParam = (v) => (v == null ? null : v.split(',').filter(Boolean));

// Уровни для подгонки под ширину: первый — все колонки, каждый следующий без самой «дешёвой» из оставшихся
export function buildLevels(type, ids) {
  const droppable = ids.filter((id) => DEFS[id].prio < 90).sort((a, b) => DEFS[a].prio - DEFS[b].prio);
  const levels = [];
  for (let k = 0; k <= droppable.length; k++) {
    const gone = new Set(droppable.slice(0, k));
    levels.push({ cols: ids.filter((id) => !gone.has(id)) });
  }
  return levels;
}

// ---------- ячейки ----------
export function brandHtml(b) {
  if (!b) return '<span class="brand none"></span>';
  return `<span class="brand" title="${esc(b.name)}"><img src="/common/brands/${esc(b.file)}" alt="${esc(b.name)}" draggable="false"></span>`;
}

// Состав шин: кольцо цвета состава и такая же буква по центру (SVG — буква встаёт ровно, без зависимости от шрифта)
const tireHtml = (t) => `<svg class="tire" viewBox="0 0 20 20" role="img" aria-label="${esc(t.name)}"><title>${esc(t.name)}</title><circle cx="10" cy="10" r="8.2" fill="rgba(0,0,0,0.35)" stroke="${esc(t.color)}" stroke-width="2.2"/><text x="10" y="10.4" text-anchor="middle" dominant-baseline="central" font-size="10.5" font-weight="700" fill="${esc(t.color)}">${esc(t.code)}</text></svg>`;

const gapStandings = (g) => {
  if (!g || g.type === 'leader' || g.type === 'none') return '-';
  return g.type === 'laps' ? `${g.value}L` : g.value.toFixed(1);
};

const side = (id, cls, html) => `<span class="sc ${cls}" style="--w:${DEFS[id].w}em">${html}</span>`;

// ---------- размер полей ----------
// Каждое поле можно увеличить или уменьшить отдельно: ячейка оборачивается в блок с другим font-size, и всё внутри
// (ширины в em, значки, текст) растёт вместе с ней. Колонка расширяется, строка становится выше, а если ширины окна не хватает —
// подгонка (createFitter) убирает колонки с низким приоритетом. Поле со стандартным размером не оборачивается вовсе.
let sizes = {};
export function setSizes(obj) {
  const next = obj && typeof obj === 'object' ? obj : {};
  if (JSON.stringify(next) === JSON.stringify(sizes)) return false;
  sizes = next;
  return true;
}
export const sizeOf = (id) => Math.min(Math.max(Number(sizes[id]) || 100, 70), 200) / 100;
export const sizesKey = () => JSON.stringify(sizes);
// высота строки — по самому крупному из видимых полей
export function rowScale(ids) {
  const k = Math.max(1, ...ids.map(sizeOf));
  document.documentElement.style.setProperty('--row-k', k.toFixed(3));
}
const zoomWrap = (id, html) => {
  const k = sizeOf(id);
  return k === 1 ? html : `<span class="cz${id === 'name' ? ' grow' : ''}" style="font-size:${k}em">${html}</span>`;
};

// ctx: { showDelta, kind, overlay } — row r берётся из модели оверлея
export const cellHtml = (id, r, ctx) => zoomWrap(id, cellRaw(id, r, ctx));
function cellRaw(id, r, ctx) {
  switch (id) {
    case 'pos': return `<span class="pos">${r.position ?? ''}</span>`;
    case 'posChange': {
      const d = r.posChange;
      if (!d) return '<span class="pch"></span>';
      return `<span class="pch ${d > 0 ? 'up' : 'down'}">${d > 0 ? ARROW_UP : ARROW_DOWN}${Math.abs(d)}</span>`;
    }
    case 'tire': return side('tire', 'tire-v', r.tire ? tireHtml(r.tire) : '');
    case 'num': return `<span class="num">${esc(r.number)}</span>`;
    case 'brand': return brandHtml(r.brand);
    case 'name': return `<span class="stripe" style="--cls:${esc(r.classColor)}"></span><span class="name">${esc(r.name)}</span>`;
    case 'lic': return licenseBadge(r.license);
    case 'ir': return iratingBadge(r.irating, r.iratingDelta, ctx.showDelta);
    case 'gap':
      return ctx.overlay === 'relative'
        ? `<span class="gap">${r.gap.toFixed(1)}</span>`
        : side('gap', 'gap-v', gapStandings(r.gap));
    case 'int': return side('int', 'int-v', gapStandings(r.int));
    case 'last': return side('last', 'last-v', fmtLap(r.lastLap));
    case 'best': return side('best', `best${r.isFastest ? ' fastest' : ''}`, fmtLap(r.bestLap));
    case 'pit': return side('pit', 'pit-v', r.onPitRoad ? '<span class="pit-tag">PIT</span>' : '');
    default: return '';
  }
}

export { fmtIrating };
