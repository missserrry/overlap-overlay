// Палитра: цвета оверлеев. Хранится в cfg.palette = { all: {токен: '#rrggbb'}, types: { relative: {...}, radar: {...} } }.
// Итоговый цвет токена для оверлея: переопределение его типа → общее → стандартный (то, что зашито в CSS).
// В страницы оверлеев уходит готовая карта CSS-переменных ({'--player-strong': '#eabe11', ...}), поэтому логика только здесь.

const TABLE = ['relative', 'standings'];
// Где цвет реально что-то красит (проверено на отрисовке): у DigiFlag и Radar нет ни текста, ни фона, у Sectors текст и подписи заданы жёстко
const WITH_TEXT = ['relative', 'standings', 'weather', 'dash', 'laps', 'rejoin', 'fuel', 'pitlimit', 'traffic', 'sr', 'forecast'];
const WITH_BG = ['relative', 'standings', 'weather', 'dash', 'sectors', 'laps', 'rejoin', 'fuel', 'pitlimit', 'traffic', 'sr', 'forecast'];
const ALL = ['relative', 'standings', 'weather', 'digiflag', 'radar', 'dash', 'sectors', 'laps', 'rejoin', 'fuel', 'pitlimit', 'traffic', 'sr', 'forecast', 'radarbars'];

// key — идентификатор, def — стандартный цвет (он же показывается в панели), types — где токен действует
const GROUPS = [
  {
    title: 'Основные', tokens: [
      { key: 'primary', label: 'Основной цвет', hint: 'Ваша строка в таблице и метка PIT', def: '#EABE11', types: TABLE },
      { key: 'accent', label: 'Акцентный цвет', hint: 'Погода, сектора, график руля', def: '#35D0E6', types: ['weather', 'sectors', 'dash', 'laps'] },
      { key: 'text', label: 'Текст', def: '#FFFFFF', types: WITH_TEXT },
      { key: 'textDim', label: 'Подписи', def: '#8A8A8F', types: WITH_TEXT },
      { key: 'bg', label: 'Фон оверлея', hint: 'Прозрачность — в настройках оверлея', def: '#0A0A0B', types: WITH_BG },
    ],
  },
  {
    title: 'Таблица', tokens: [
      { key: 'nameColor', label: 'Имя и фамилия', def: '#FFFFFF', types: TABLE },
      { key: 'ahead', label: 'Круг впереди', hint: 'Только в Relative: машина, обогнавшая вас на круг', def: '#C82020', types: ['relative'] },
      { key: 'behind', label: 'Круг позади', hint: 'Только в Relative: вы обогнали её на круг', def: '#2563EB', types: ['relative'] },
      { key: 'good', label: 'Рост iRating', hint: 'Стрелка вверх у iRating', def: '#3D9B41', types: TABLE },
      { key: 'bad', label: 'Падение iRating', hint: 'Стрелка вниз у iRating', def: '#EA0600', types: TABLE },
      { key: 'posUp', label: 'Позиция выросла', hint: 'Стрелка у изменения позиции; без своего цвета берёт цвет роста', def: '#3D9B41', types: TABLE },
      { key: 'posDown', label: 'Позиция упала', hint: 'Стрелка у изменения позиции; без своего цвета берёт цвет падения', def: '#EA0600', types: TABLE },
      { key: 'best', label: 'Лучший круг', hint: 'Только в Standings', def: '#DD61FF', types: ['standings'] },
      { key: 'badgeBg', label: 'Плашка iRating', def: '#FFFFFF', types: TABLE },
      { key: 'badgeText', label: 'Текст плашки', def: '#000000', types: TABLE },
    ],
  },
  {
    title: 'Лицензии', tokens: [
      { key: 'licR', label: 'Rookie', def: '#DC2626', types: TABLE },
      { key: 'licD', label: 'D', def: '#EA580C', types: TABLE },
      { key: 'licC', label: 'C', def: '#CA8A04', types: TABLE },
      { key: 'licB', label: 'B', def: '#65A30D', types: TABLE },
      { key: 'licA', label: 'A', def: '#2563EB', types: TABLE },
      { key: 'licP', label: 'Pro', def: '#3F3F46', types: TABLE },
    ],
  },
  {
    title: 'Радар', tokens: [
      { key: 'radarWarn', label: 'Машина сбоку, далеко', def: '#FFB020', types: ['radar'] },
      { key: 'radarDanger', label: 'Машина вплотную', def: '#FF2A1F', types: ['radar'] },
      { key: 'radarFront', label: 'Дуга спереди и сзади', def: '#FFD000', types: ['radar'] },
      { key: 'radarMe', label: 'Ваша машина', def: '#FFFFFF', types: ['radar'] },
      { key: 'barColor', label: 'Цвет полос', def: '#FFB020', types: ['radarbars'] },
    ],
  },
  {
    title: 'Dash', tokens: [
      { key: 'dashThr', label: 'Газ', def: '#2EE34A', types: ['dash'] },
      { key: 'dashBrk', label: 'Тормоз', def: '#FF3B30', types: ['dash'] },
      { key: 'dashClu', label: 'Сцепление', def: '#F5C342', types: ['dash'] },
    ],
  },
  {
    title: 'Sectors и Laps', tokens: [
      { key: 'secFast', label: 'Быстрее эталона', def: '#2EE34A', types: ['sectors', 'laps'] },
      { key: 'secSlow', label: 'Медленнее эталона', def: '#FF3B30', types: ['sectors', 'laps'] },
    ],
  },
  {
    title: 'Rejoin, Fuel и Pit Limiter', tokens: [
      { key: 'rjSafe', label: 'Можно выезжать / хватает / лимитер в норме / SR растёт / дождя нет', def: '#2EE34A', types: ['rejoin', 'fuel', 'pitlimit', 'sr', 'forecast'] },
      { key: 'rjWarn', label: 'Осторожно / впритык / дождь скоро', def: '#FFB020', types: ['rejoin', 'fuel', 'forecast'] },
      { key: 'rjDanger', label: 'Опасно / не хватит / нарушение лимита / быстрый класс рядом / SR падает / дождь идёт', def: '#FF3B30', types: ['rejoin', 'fuel', 'pitlimit', 'traffic', 'sr', 'forecast'] },
    ],
  },
  {
    title: 'Флаги', tokens: [
      { key: 'flagY', label: 'Жёлтый', def: '#FFE600', types: ['digiflag'] },
      { key: 'flagW', label: 'Белый', def: '#F4F4F4', types: ['digiflag'] },
      { key: 'flagR', label: 'Красный', def: '#FF2A1F', types: ['digiflag'] },
      { key: 'flagG', label: 'Зелёный', def: '#21D63A', types: ['digiflag'] },
      { key: 'flagB', label: 'Синий', def: '#2A74FF', types: ['digiflag'] },
      { key: 'flagO', label: 'Оранжевый', def: '#FF6A10', types: ['digiflag'] },
    ],
  },
];

const TOKENS = Object.fromEntries(GROUPS.flatMap((g) => g.tokens.map((t) => [t.key, t])));
const HEX = /^#[0-9a-f]{6}$/i;

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const rgba = (hex, a) => `rgba(${rgb(hex).join(',')},${a})`;
const toHex = (a) => '#' + a.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
const darken = (hex, k) => toHex(rgb(hex).map((v) => v * (1 - k)));

// токен → CSS-переменные страницы
const CSS = {
  primary: (c) => ({ '--player-strong': c, '--player': rgba(c, 0.55), '--primary': c }),
  accent: (c) => ({ '--accent': c }),
  text: (c) => ({ '--text': c }),
  textDim: (c) => ({ '--text-dim': c }),
  bg: (c) => ({ '--bg-rgb': rgb(c).join(' ') }),
  nameColor: (c) => ({ '--name-color': c }),
  ahead: (c) => ({ '--lap-ahead': rgba(c, 0.75), '--ring-ahead': c }),
  behind: (c) => ({ '--lap-behind': rgba(c, 0.7), '--ring-behind': c }),
  good: (c) => ({ '--green': c }),
  posUp: (c) => ({ '--pch-up': c }),
  posDown: (c) => ({ '--pch-down': c }),
  bad: (c) => ({ '--red': c }),
  best: (c) => ({ '--purple': c }),
  badgeBg: (c) => ({ '--badge-bg': c }),
  badgeText: (c) => ({ '--badge-text': c }),
  radarWarn: (c) => ({ '--radar-warn': c }),
  radarDanger: (c) => ({ '--radar-danger': c }),
  radarFront: (c) => ({ '--radar-front': c }),
  radarMe: (c) => ({ '--radar-me': c }),
  barColor: (c) => ({ '--bar-color': c }),
  rjSafe: (c) => ({ '--rj-safe': c }),
  rjWarn: (c) => ({ '--rj-warn': c }),
  rjDanger: (c) => ({ '--rj-danger': c }),
  dashThr: (c) => ({ '--d-thr': c }),
  dashBrk: (c) => ({ '--d-brk': c }),
  dashClu: (c) => ({ '--d-clu': c }),
  secFast: (c) => ({ '--sec-fast': c, '--sec-fast-text': toHex(rgb(c).map((v) => v + (255 - v) * 0.5)) }),
  secSlow: (c) => ({ '--sec-slow': c, '--sec-slow-text': toHex(rgb(c).map((v) => v + (255 - v) * 0.5)) }),
};
for (const k of ['R', 'D', 'C', 'B', 'A', 'P']) CSS[`lic${k}`] = (c) => ({ [`--lic-${k.toLowerCase()}`]: c, [`--lic-${k.toLowerCase()}-d`]: darken(c, 0.5) });
for (const k of ['Y', 'W', 'R', 'G', 'B', 'O']) CSS[`flag${k}`] = (c) => ({ [`--flag-${k.toLowerCase()}`]: c });

// Готовые наборы (значения поверх стандартных). «Классика» — пустой набор, то есть исходный вид.
const PRESETS = [
  { id: 'classic', name: 'Классика', values: {} },
  { id: 'ocean', name: 'Океан', values: { primary: '#38BDF8', accent: '#2DD4BF', bg: '#07131C', textDim: '#7C98AC', ahead: '#E05555', behind: '#3B82F6', good: '#34D399', bad: '#F87171', best: '#C084FC' } },
  { id: 'sunset', name: 'Закат', values: { primary: '#FB923C', accent: '#F43F5E', bg: '#140B0D', textDim: '#A38B8B', ahead: '#E11D48', behind: '#6366F1', good: '#84CC16', bad: '#EF4444', best: '#F0ABFC' } },
  { id: 'lime', name: 'Лайм', values: { primary: '#A3E635', accent: '#22D3EE', bg: '#0B120A', textDim: '#8A9A80', good: '#4ADE80', bad: '#F97316', best: '#E879F9' } },
  { id: 'sakura', name: 'Сакура', values: { primary: '#F472B6', accent: '#A78BFA', bg: '#130B14', textDim: '#A18AA6', ahead: '#E11D74', behind: '#818CF8', good: '#5EEAD4', bad: '#FB7185', best: '#FDE047' } },
  { id: 'ice', name: 'Лёд', values: { primary: '#E2E8F0', accent: '#7DD3FC', bg: '#0B0F14', textDim: '#94A3B8', nameColor: '#F8FAFC', ahead: '#F87171', behind: '#60A5FA', good: '#6EE7B7', bad: '#FCA5A5', best: '#C4B5FD' } },
  { id: 'racing', name: 'Гоночный красный', values: { primary: '#EF4444', accent: '#F59E0B', bg: '#120909', textDim: '#A08A8A', ahead: '#F59E0B', behind: '#3B82F6', good: '#22C55E', bad: '#F97316' } },
  { id: 'mono', name: 'Графит', values: { primary: '#FFFFFF', accent: '#9CA3AF', bg: '#000000', textDim: '#6B7280', ahead: '#9CA3AF', behind: '#4B5563', good: '#D1D5DB', bad: '#6B7280', best: '#FFFFFF', licR: '#6B7280', licD: '#6B7280', licC: '#6B7280', licB: '#6B7280', licA: '#6B7280', licP: '#3F3F46' } },
  { id: 'cvd', name: 'Для дальтоников', values: { primary: '#FFD400', accent: '#00B4FF', ahead: '#FF8A00', behind: '#3DA5FF', good: '#3DA5FF', bad: '#FF8A00', best: '#FFFFFF', secFast: '#3DA5FF', secSlow: '#FF8A00', dashThr: '#3DA5FF', dashBrk: '#FF8A00' } },
];

const emptyPalette = () => ({ all: {}, types: {} });

// Оставить только известные токены с корректным цветом
function cleanValues(values) {
  const out = {};
  for (const [k, v] of Object.entries(values || {})) if (TOKENS[k] && typeof v === 'string' && HEX.test(v)) out[k] = v.toUpperCase();
  return out;
}

function normalize(p) {
  const out = emptyPalette();
  out.all = cleanValues(p?.all);
  for (const t of ALL) if (p?.types?.[t]) out.types[t] = cleanValues(p.types[t]);
  return out;
}

// карта CSS-переменных для оверлея данного типа
function buildVars(palette, type) {
  const merged = { ...(palette?.all || {}), ...(palette?.types?.[type] || {}) };
  const vars = {};
  for (const [k, v] of Object.entries(merged)) {
    const t = TOKENS[k];
    if (t && t.types.includes(type) && CSS[k] && HEX.test(v)) Object.assign(vars, CSS[k](v));
  }
  return vars;
}

// Действия панели: palette.set / palette.preset / palette.reset. scope: 'all' или тип оверлея.
function apply(palette, a) {
  const scope = a.scope === 'all' || ALL.includes(a.scope) ? a.scope : null;
  if (!scope) return false;
  const bucket = () => (scope === 'all' ? palette.all : (palette.types[scope] ||= {}));
  if (a.type === 'palette.set') {
    if (!TOKENS[a.key]) return false;
    if (a.value == null) delete bucket()[a.key];
    else if (typeof a.value === 'string' && HEX.test(a.value)) bucket()[a.key] = a.value.toUpperCase();
    else return false;
    return true;
  }
  if (a.type === 'palette.preset') {
    const p = PRESETS.find((x) => x.id === a.id);
    if (!p) return false;
    if (scope === 'all') { palette.all = cleanValues(p.values); palette.types = {}; } // набор для всех сбрасывает и частные
    else palette.types[scope] = cleanValues(p.values);
    return true;
  }
  if (a.type === 'palette.reset') {
    if (scope === 'all') { palette.all = {}; palette.types = {}; } else delete palette.types[scope];
    return true;
  }
  return false;
}

// Подсветка цвета при редактировании: все цвета, кроме выбранного, приглушаются до серого.
// DIM[ключ] — переменные «серого» варианта токена (фон не приглушаем: он остаётся рамкой);
// NAMES[ключ] — какие переменные страницы относятся к токену.
const DIM_GRAY = '#3A3D42';
const DIM = {}, NAMES = {};
for (const k of Object.keys(CSS)) {
  NAMES[k] = Object.keys(CSS[k]('#000000'));
  if (k !== 'bg') DIM[k] = CSS[k](DIM_GRAY);
}

// SEL[ключ] — какие элементы оверлеев закрашены этим цветом; в панели они обводятся рамкой при наведении на строку цвета
const SEL = {
  primary: ['.row.player', '.pit-tag'],
  accent: ['.wet .bar2 i', '.compass .arrow', '.sec .fill', '.laps .ico'],
  text: ['.name', '.row .pos', '.row .gap', '.hf b', '.sec .val', '.laps .cur', '.laps .cell b', '.fuel .stat b', '.pl .spd b', '.srw .now', '.srw .st b', '.srw .irb b', '.fc .pct', '.fc .sky .ico'],
  textDim: ['.bar .label', '.chip', '.inc-icon', '.sc.int-v', '.sc.last-v', '.num', '.hf .k', '.hf .of', '.standings .cols', '.class-head span:not(.cname)', '.laps .cell small', '.fuel .top', '.fuel .stat small', '.rj .top', '.pl .top', '.sec .lbl', '.tr .t small', '.srw .top', '.srw .st small', '.srw .irb small', '.fc .top', '.fc .when', '.fc .clk', '.fc .tmp', '.fc .none'],
  bg: ['.panel', '.sectors', '.laps', '.fuel', '.rj', '.pl', '.tr', '.dash .main', '.radarbox', '.srw', '.fc'],
  nameColor: ['.name'],
  ahead: ['.row.lap-ahead .gap'],
  behind: ['.row.lap-behind .gap'],
  good: ['.badge .delta.gain'],
  bad: ['.badge .delta.lose'],
  posUp: ['.pch.up'],
  posDown: ['.pch.down'],
  best: ['.best.fastest'],
  badgeBg: ['.badge'],
  badgeText: ['.badge'],
  radarWarn: ['.radarbox'], radarDanger: ['.radarbox'], radarFront: ['.radarbox'], radarMe: ['.radarbox'], barColor: ['.rbw .rbs'],
  dashThr: ['.ring .path.thr', '.barcol[data-col=throttle] .pedal', 'canvas[data-graph]'],
  dashBrk: ['.ring .path.brk', '.barcol[data-col=brake] .pedal', 'canvas[data-graph]'],
  dashClu: ['.barcol[data-col=clutch] .pedal', 'canvas[data-graph]'],
  secFast: ['.sec.fast .val', '.sec.ul.fast .line', '.laps .d.fast'],
  secSlow: ['.sec.slow .val', '.sec.ul.slow .line', '.laps .d.slow'],
  rjSafe: ['.rj', '.fuel', '.pl', '.srw.up .delta', '.srw .st b.ok', '.srw .irb.up .idelta', '.fc.dry .head'], rjWarn: ['.rj', '.fuel', '.pl', '.fc.soon .head', '.fc .cell.mid .rain'], rjDanger: ['.rj', '.fuel', '.pl', '.tr', '.srw.down .delta', '.srw .st b.need', '.srw .irb.down .idelta', '.fc.wet .head', '.fc .cell.hi .rain'],
};
for (const k of ['R', 'D', 'C', 'B', 'A', 'P']) SEL[`lic${k}`] = [`.lic[style*="--lic-${k.toLowerCase()},"]`];
for (const k of Object.keys(CSS)) if (k.startsWith('flag')) SEL[k] = ['.flagbox'];

// Переменные токена с его текущим значением (своё → общее → стандартное): при подсветке выбранный цвет остаётся настоящим и меняется вживую
function liveVars(palette, type) {
  const out = {};
  for (const [k, t] of Object.entries(TOKENS)) {
    if (!t.types.includes(type) || !CSS[k]) continue;
    const v = palette?.types?.[type]?.[k] ?? palette?.all?.[k] ?? t.def;
    out[k] = CSS[k](v);
  }
  return out;
}

module.exports = { GROUPS, PRESETS, TOKENS, emptyPalette, normalize, buildVars, apply, DIM, NAMES, SEL, liveVars };
