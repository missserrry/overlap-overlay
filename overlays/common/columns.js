// Колонки таблиц Relative и Standings: одни и те же ячейки, у каждого оверлея свой набор и порядок.
// Список id и значения по умолчанию дублируют src/main/layouts.js (COLUMN_DEFAULTS) — менять вместе.
import { ARROW_DOWN, ARROW_UP, esc, fmtIrating, fmtLap, iratingBadge, licenseBadge } from '/common/overlay.js';

// prio — в каком порядке колонки уходят, когда окно сужается (меньше — уходит раньше).
// 90 и выше не уходят никогда. zone — где колонка в Standings: main — слева, side — в боковой панели.
// w — ширина боковой ячейки, em; head — подпись в заголовке боковой панели.
export const DEFS = {
  pos:   { prio: 95, zone: 'main' },
  posChange: { prio: 28, zone: 'main' },
  cls:   { prio: 42, zone: 'main' },
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
  lapDelta: { prio: 22, zone: 'side', w: 4.4, head: 'Δ Lap' },
  sec1: { prio: 24, zone: 'side', w: 4.2, head: 'Δ S1' },
  sec2: { prio: 24, zone: 'side', w: 4.2, head: 'Δ S2' },
  sec3: { prio: 24, zone: 'side', w: 4.2, head: 'Δ S3' },
  pitTime: { prio: 21, zone: 'side', w: 4.4, head: 'Pit time' },
  pitLap: { prio: 23, zone: 'side', w: 3.6, head: 'Pit lap' },
  tire:  { prio: 38, zone: 'side', w: 2.6, head: 'Tyre' },
  pit:   { prio: 35, zone: 'side', w: 3.2, head: 'Pit' },
};

const DEFAULTS = {
  relative: ['pos', 'cls', 'name', 'lic', 'ir', 'delta', 'gap'],
  standings: ['pos', 'name', 'ir', 'delta', 'gap', 'best'],
};
const SUPPORTED = {
  relative: new Set(['pos', 'cls', 'posChange', 'tire', 'num', 'brand', 'name', 'lic', 'ir', 'delta', 'gap', 'last', 'pit']),
  standings: new Set(['pos', 'posChange', 'tire', 'num', 'brand', 'name', 'lic', 'ir', 'delta', 'gap', 'int', 'last', 'best', 'lapDelta', 'sec1', 'sec2', 'sec3', 'pitTime', 'pitLap', 'pit']),
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

// ---------- сектора: три колонки листают сектора трассы тройками ----------
// Закончили сектор — в колонке появляется дельта; закончили третий в тройке (или последний на трассе) — через паузу показ плавно
// переезжает на следующие три сектора. Трасса не длиннее трёх секторов — листать нечего, колонки держат последние значения.
const SEC_SLOTS = 3, HOLD_MS = 3500, OUT_MS = 260, IN_MS = 320;
let sv = { n: null, seq: -1, done: -1, page: 0, prev: null, flipAt: 0, pending: null, appear: new Map() };
export function secView(info, now = Date.now()) {
  if (!info || !(info.count > 1)) return null;
  const N = info.count, pages = Math.ceil(N / SEC_SLOTS), paged = N > SEC_SLOTS;
  if (sv.n !== N || info.seq < sv.seq) sv = { n: N, seq: -1, done: -1, page: 0, prev: null, flipAt: 0, pending: null, appear: new Map() };
  if (sv.seq === -1) {                                                  // первый взгляд: просто встаём на текущее место, без анимации
    sv.seq = info.seq; sv.done = info.done;
    sv.page = paged && info.done >= 0 ? Math.floor(info.done / SEC_SLOTS) : 0;
  } else if (info.seq !== sv.seq) {                                     // закончили очередной сектор
    sv.seq = info.seq; sv.done = info.done; sv.appear.set(info.done, now);
    if (paged) {
      const pg = Math.floor(info.done / SEC_SLOTS);
      if (pg !== sv.page) { sv.prev = sv.page; sv.page = pg; sv.flipAt = now; }
      sv.pending = (info.done % SEC_SLOTS === SEC_SLOTS - 1 || info.done === N - 1) ? { at: now + HOLD_MS, to: pg + 1 < pages ? pg + 1 : 0 } : null;
    }
  }
  if (sv.pending && now >= sv.pending.at) { sv.prev = sv.page; sv.page = sv.pending.to; sv.flipAt = now; sv.pending = null; }
  const leaving = paged && sv.prev != null && now - sv.flipAt < OUT_MS;
  const page = leaving ? sv.prev : sv.page;
  const slots = [];
  for (let i = 0; i < SEC_SLOTS; i++) {
    const k = page * SEC_SLOTS + i;
    if (k >= N) { slots.push({ k, label: '', show: false }); continue; }
    const show = !paged || leaving || k <= sv.done;
    const since = sv.appear.has(k) ? now - sv.appear.get(k) : null;
    slots.push({ k, label: `S${k + 1}`, show, anim: leaving ? { kind: 'out', ms: now - sv.flipAt } : since != null && since < IN_MS ? { kind: 'in', ms: since } : null });
  }
  return { slots, paged };
}
// Подпись колонки: у секторных — номер сектора, который она сейчас показывает
export const headOf = (id, sec) => (/^sec[123]$/.test(id) ? `Δ ${sec?.slots[Number(id.slice(3)) - 1]?.label || `S${id.slice(3)}`}` : DEFS[id].head);

// ---------- ячейки ----------
export function brandHtml(b) {
  if (!b) return '<span class="brand none"></span>';
  return `<span class="brand" title="${esc(b.name)}"><img src="/common/brands/${esc(b.file)}" alt="${esc(b.name)}" draggable="false"></span>`;
}

// Состав шин: кольцо цвета состава и такая же буква по центру (SVG — буква встаёт ровно, без зависимости от шрифта)
// Буквы шин нарисованы контурами, а не шрифтом: у шрифта буквы центруются по-своему и «плывут» внутри кольца.
// Каждая буква вписана в рамку 7.2 в высоту, по центру кольца (10, 10), и симметрична относительно своей оси.
const TIRE_GLYPHS = {
  S: 'M12.3 7.9C12.3 6.7 11.3 6.4 10 6.4C8.6 6.4 7.7 7.1 7.7 8.2C7.7 9.3 8.6 9.7 10 10C11.4 10.3 12.3 10.7 12.3 11.8C12.3 12.9 11.4 13.6 10 13.6C8.7 13.6 7.7 13.3 7.7 12.1',
  M: 'M7 13.6V6.4L10 11L13 6.4V13.6',
  H: 'M7.2 6.4V13.6M12.8 6.4V13.6M7.2 10H12.8',
  D: 'M7.3 6.4V13.6H9.2C11.7 13.6 12.7 12 12.7 10C12.7 8 11.7 6.4 9.2 6.4Z',
  W: 'M6.6 6.4L8.3 13.6L10 8.6L11.7 13.6L13.4 6.4',
  I: 'M8.4 6.4H11.6M10 6.4V13.6M8.4 13.6H11.6',
  P: 'M7.7 13.6V6.4H10.1C11.7 6.4 12.3 7.3 12.3 8.4C12.3 9.5 11.7 10.4 10.1 10.4H7.7',
  A: 'M6.9 13.6L10 6.4L13.1 13.6M8.2 11.2H11.8',
};
const tireHtml = (t) => {
  const c = esc(t.color), g = TIRE_GLYPHS[t.code];
  const mark = g
    ? `<path d="${g}" fill="none" stroke="${c}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<text x="10" y="10.4" text-anchor="middle" dominant-baseline="central" font-size="10.5" font-weight="700" fill="${c}">${esc(t.code)}</text>`;
  return `<svg class="tire" viewBox="0 0 20 20" role="img" aria-label="${esc(t.name)}"><title>${esc(t.name)}</title><circle cx="10" cy="10" r="8.2" fill="rgba(0,0,0,0.35)" stroke="${c}" stroke-width="2.2"/>${mark}</svg>`;
};

// Знаки после запятой по колонкам: настройка оверлея или значение по умолчанию
const DEC_DEFAULT = { gap: 1, int: 1, last: 3, best: 3, lapDelta: 2, sec1: 2, sec2: 2, sec3: 2, pitTime: 1 };
let licMode = 'full';
export function setLicMode(m) {
  const next = m === 'num' || m === 'letter' ? m : 'full';
  if (next === licMode) return false;
  licMode = next;
  return true;
}
let decimals = {};
export function setDecimals(obj) {
  const next = obj && typeof obj === 'object' ? obj : {};
  if (JSON.stringify(next) === JSON.stringify(decimals)) return false;
  decimals = next;
  return true;
}
const dec = (id) => { const n = Number(decimals[id]); return Number.isFinite(n) ? Math.min(Math.max(Math.round(n), 0), 3) : DEC_DEFAULT[id]; };

const gapStandings = (g, d = 1) => {
  if (!g || g.type === 'leader' || g.type === 'none') return '-';
  return g.type === 'laps' ? `${g.value}L` : g.value.toFixed(d);
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
    case 'lapDelta': {
      const d = r.lapDelta;      // секунды: меньше нуля — пилот проехал круг быстрее вас
      if (d == null || !Number.isFinite(d) || Math.abs(d) >= 100) return side('lapDelta', 'ld-v', '');
      return side('lapDelta', `ld-v ${d < 0 ? 'ld-fast' : d > 0 ? 'ld-slow' : ''}`, `${d < 0 ? '−' : '+'}${Math.abs(d).toFixed(dec('lapDelta'))}`);
    }
    case 'sec1': case 'sec2': case 'sec3': {   // дельта сектора к вашему: меньше нуля — пилот проехал сектор быстрее вас
      const slot = ctx.sec?.slots[Number(id.slice(3)) - 1];
      const d = slot?.show ? r.secDelta?.[slot.k] : null;
      const a = slot?.anim;
      // анимация с отрицательной задержкой: таблица перерисовывается чаще, чем идёт анимация, и без этого она бы начиналась заново
      const anim = a ? ` sec-${a.kind}` : '';
      const style = a ? `;animation-delay:-${Math.round(a.ms)}ms` : '';
      const text = d == null || !Number.isFinite(d) || Math.abs(d) >= 30 ? '' : `${d < 0 ? '−' : '+'}${Math.abs(d).toFixed(dec(id))}`;
      const cls = text ? (d < 0 ? 'ld-fast' : d > 0 ? 'ld-slow' : '') : '';
      return `<span class="sc ld-v ${cls}${anim}" style="--w:${DEFS[id].w}em${style}">${text}</span>`;
    }
    case 'pitTime': {      // секунды на питлейне при последнем стопе; пусто — стопа ещё не было или чужой класс
      const t = r.pitTime;
      if (t == null || !Number.isFinite(t)) return side('pitTime', 'pt-v', '');
      return side('pitTime', 'pt-v', t >= 100 ? `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}` : t.toFixed(dec('pitTime')));
    }
    case 'pitLap': return side('pitLap', 'pl-v', r.pitLap != null ? `L${r.pitLap}` : '');
    case 'tire': return side('tire', 'tire-v', r.tire ? tireHtml(r.tire) : '');
    case 'cls': return `<span class="ctag" style="--cls:${esc(r.classColor)}" title="${esc(r.className)}">${esc((r.className || '').slice(0, 5))}</span>`;
    case 'num': return `<span class="num">${esc(r.number)}</span>`;
    case 'brand': return brandHtml(r.brand);
    case 'name': return `<span class="stripe" style="--cls:${esc(r.classColor)}"></span><span class="name">${esc(r.name)}</span>`;
    case 'lic': return licenseBadge(r.license, licMode);
    case 'ir': return iratingBadge(r.irating, r.iratingDelta, ctx.showDelta);
    case 'gap':
      return ctx.overlay === 'relative'
        ? `<span class="gap${ctx.wideGap ? ' wide' : ''}">${ctx.lapLabel && r.lapDiff ? `<small class="lapn">${r.lapDiff > 0 ? '+' : '−'}${Math.abs(r.lapDiff)}L</small>` : ''}${r.gap.toFixed(dec('gap'))}</span>`
        : side('gap', 'gap-v', gapStandings(r.gap, dec('gap')));
    case 'int': return side('int', 'int-v', gapStandings(r.int, dec('int')));
    case 'last': return side('last', 'last-v', fmtLap(r.lastLap, dec('last')));
    case 'best': return side('best', `best${r.isFastest ? ' fastest' : ''}`, fmtLap(r.bestLap, dec('best')));
    case 'pit': return side('pit', 'pit-v', r.onPitRoad ? '<span class="pit-tag">PIT</span>' : '');
    default: return '';
  }
}

export { fmtIrating };
