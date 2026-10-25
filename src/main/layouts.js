// Раскладки оверлеев (по мотивам Edge Overlays):
//   раскладка = набор экземпляров оверлеев + фильтр машины + типы сессий;
//   внутри раскладки — варианты для практики/квалификации/гонки/споттинга;
//   автопереключение выбирает раскладку с наибольшим счётом совпадения.
const crypto = require('crypto');

const OVERLAY_TYPES = {
  relative: { title: 'Relative', width: 520, height: 320 },
  standings: { title: 'Standings', width: 440, height: 640 },
  weather: { title: 'Weather', width: 240, height: 560 },
  digiflag: { title: 'DigiFlag', width: 200, height: 200 },
  radar: { title: 'Radar', width: 260, height: 260 },
  dash: { title: 'Dash', width: 560, height: 150 },
  sectors: { title: 'Sectors', width: 640, height: 70 },
  laps: { title: 'Laps', width: 320, height: 200 },
  rejoin: { title: 'Rejoin', width: 320, height: 170 },
  fuel: { title: 'Fuel', width: 320, height: 230 },
  pitlimit: { title: 'Pit Limiter', width: 380, height: 150 },
  traffic: { title: 'Traffic', width: 300, height: 56 },
  sr: { title: 'Safety Rating', width: 300, height: 130 },
  forecast: { title: 'Forecast', width: 360, height: 190 },
  radarbars: { title: 'Radar Bars', width: 360, height: 220 },
};
// Колонки таблиц. Порядок ключей = порядок по умолчанию, значение = включена ли.
// Подписи, ширины и приоритет ухода при сужении окна — в overlays/common/columns.js (id должны совпадать).
const COLUMN_CATALOG = {
  pos: { label: 'Позиция' },
  posChange: { label: 'Изменение позиции' },
  cls: { label: 'Класс (плашка)' },
  num: { label: 'Номер машины' },
  brand: { label: 'Марка машины' },
  name: { label: 'Имя', fixed: true },
  lic: { label: 'Лицензия и SR' },
  ir: { label: 'iRating' },
  delta: { label: 'Прирост iRating', sub: 'ir' },
  gap: { label: 'Отрыв', labelBy: { standings: 'Отрыв до лидера' } },
  int: { label: 'Интервал до соседа' },
  last: { label: 'Прошлый круг' },
  best: { label: 'Лучший круг' },
  lapDelta: { label: 'Дельта круга к вашему', hint: 'Только Standings, только в вашем классе' },
  tire: { label: 'Шины' },
  pit: { label: 'Питлейн' },
};
const COLUMN_DEFAULTS = {
  relative: { pos: 1, cls: 1, posChange: 0, num: 0, brand: 0, name: 1, lic: 1, ir: 1, delta: 1, gap: 1, last: 0, tire: 0, pit: 0 },
  standings: { pos: 1, posChange: 0, num: 0, brand: 0, name: 1, lic: 0, ir: 1, delta: 1, gap: 1, int: 0, last: 0, best: 1, lapDelta: 0, tire: 0, pit: 0 },
};

// Привести список колонок к актуальному виду: неизвестные убрать, недостающие добавить в конец
// Размер полей таблицы в процентах (70–200, шаг 5); 100 не храним
function normalizeSizes(cur, patch) {
  const out = {};
  const src = { ...(cur || {}), ...(patch || {}) };
  for (const [id, v] of Object.entries(src)) {
    if (v == null || !COLUMN_CATALOG[id] || COLUMN_CATALOG[id].sub) continue;
    const n = Math.round(Number(v) / 5) * 5;
    if (Number.isFinite(n) && n !== 100) out[id] = Math.min(Math.max(n, 70), 200);
  }
  return out;
}

function normalizeColumns(type, cols) {
  const def = COLUMN_DEFAULTS[type] || {};
  const out = [], seen = new Set();
  for (const c of Array.isArray(cols) ? cols : []) {
    if (!c || def[c.id] === undefined || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({ id: c.id, on: COLUMN_CATALOG[c.id].fixed ? true : !!c.on });
  }
  for (const id of Object.keys(def)) {
    if (seen.has(id)) continue;
    const item = { id, on: !!def[id] };
    // колонка «Класс» появилась позже остальных: у старых настроек вставляем её перед именем, а не в самый конец
    const at = id === 'cls' ? out.findIndex((c) => c.id === 'name') : -1;
    if (at >= 0) out.splice(at, 0, item); else out.push(item);
  }
  return out;
}

// Шапка и подвал: список пунктов в нужном порядке. Подписи — для панели, как показываются — overlays/common/hf.js (id те же).
const HF_CATALOG = {
  session: { label: 'Сессия и время', group: 'Сессия' },
  sof: { label: 'SOF', group: 'Сессия' },
  inc: { label: 'Инциденты', group: 'Сессия' },
  remain: { label: 'Осталось (круги / время)', group: 'Сессия' },
  time: { label: 'Время до конца', group: 'Сессия' },
  elapsed: { label: 'Прошло времени', group: 'Сессия' },
  toFinish: { label: 'Кругов до финиша', group: 'Сессия' },
  drivers: { label: 'Пилотов в сессии', group: 'Сессия' },
  clock: { label: 'Часы компьютера', group: 'Сессия' },
  tod: { label: 'Время суток в игре', group: 'Сессия' },
  lap: { label: 'Текущий круг', group: 'Гонка' },
  pos: { label: 'Позиция', group: 'Гонка' },
  posGain: { label: 'Изменение позиции', group: 'Гонка' },
  irating: { label: 'Прогноз iRating', group: 'Гонка' },
  sr: { label: 'Оценка SR', group: 'Гонка' },
  last: { label: 'Прошлый круг', group: 'Круги' },
  best: { label: 'Лучший круг', group: 'Круги' },
  delta: { label: 'Дельта к лучшему', group: 'Круги' },
  airTemp: { label: 'Температура воздуха', group: 'Погода' },
  trackTemp: { label: 'Температура трассы', group: 'Погода' },
  wet: { label: 'Влажность трассы', group: 'Погода' },
  rain: { label: 'Осадки', group: 'Погода' },
  humidity: { label: 'Влажность воздуха', group: 'Погода' },
  wind: { label: 'Ветер', group: 'Погода' },
  fog: { label: 'Туман', group: 'Погода' },
  fuel: { label: 'Топливо', group: 'Машина' },
  fuelLaps: { label: 'Топлива на кругов', group: 'Машина' },
  oil: { label: 'Масло', group: 'Машина' },
  water: { label: 'Температура воды', group: 'Машина' },
  bb: { label: 'Тормозной баланс', group: 'Машина' },
};
const HF_ORDER = Object.keys(HF_CATALOG);
const HF_DEFAULTS = {
  relative: { header: ['sof', 'inc'], footer: ['session', 'lap', 'pos'] },
  standings: { header: ['session'], footer: [] },
  dash: { header: [], footer: ['trackTemp', 'sof', 'fuel', 'clock'] },
};
// Список {id, on}: известные пункты в сохранённом порядке, недостающие — в конце (выключены, кроме включённых по умолчанию)
function normalizeHf(type, zone, list) {
  const on = new Set(HF_DEFAULTS[type]?.[zone] || []);
  const out = [], seen = new Set();
  for (const c of Array.isArray(list) ? list : []) {
    if (!c || !HF_CATALOG[c.id] || seen.has(c.id)) continue;
    seen.add(c.id); out.push({ id: c.id, on: !!c.on });
  }
  if (!out.length && !Array.isArray(list)) for (const id of HF_DEFAULTS[type]?.[zone] || []) { out.push({ id, on: true }); seen.add(id); }
  for (const id of HF_ORDER) if (!seen.has(id)) out.push({ id, on: !list && on.has(id) });
  return out;
}

// Карточки оверлея Weather: порядок и что показывать (как показываются — overlays/weather/weather.js, id те же)
const WEATHER_CARDS = {
  trackTemp: { label: 'Температура трассы', on: true },
  wetness: { label: 'Состояние трассы', on: true },
  precip: { label: 'Осадки', on: true },
  wind: { label: 'Ветер и направление', on: true },
  airTemp: { label: 'Температура воздуха', on: false },
  humidity: { label: 'Влажность воздуха', on: false },
  fog: { label: 'Туман', on: false },
};
function normalizeCards(type, list) {
  if (type !== 'weather') return [];
  const out = [], seen = new Set();
  for (const c of Array.isArray(list) ? list : []) {
    if (!c || !WEATHER_CARDS[c.id] || seen.has(c.id)) continue;
    seen.add(c.id); out.push({ id: c.id, on: !!c.on });
  }
  for (const [id, d] of Object.entries(WEATHER_CARDS)) if (!seen.has(id)) out.push({ id, on: !list && d.on });
  return out;
}

// Настройки Dash: одна схема на всё — значения по умолчанию, границы и подписи для панели.
// Ключи плоские через точку (dots.count). Как они показываются — overlays/dash/dash.js.
const bool = (key, label, def) => ({ key, type: 'bool', label, def });
const range = (key, label, def, min, max, step = 1, unit = '') => ({ key, type: 'range', label, def, min, max, step, unit });
const select = (key, label, def, options) => ({ key, type: 'select', label, def, options });
const DASH_SCHEMA = [
  { group: 'Что показывать', items: [
    bool('blocks.ring', 'Кольцо с передачей', true), bool('blocks.dots', 'Точки над числами', true),
    bool('blocks.speed', 'Скорость', true), bool('blocks.rpm', 'Обороты', true),
    bool('blocks.graph', 'График педалей', true), bool('blocks.bars', 'Столбики педалей', true),
    bool('blocks.pos', 'Позиция справа', false), bool('blocks.foot', 'Нижняя плашка', true),
  ] },
  { group: 'Точки', items: [
    range('dots.count', 'Количество (кратно 3: зелёные, оранжевые, красные)', 9, 6, 18, 3),
    select('dots.shape', 'Форма', 'circle', [['circle', 'Круг'], ['bar', 'Черта']]),
    select('dots.source', 'Пороги', 'car', [['car', 'Как в iRacing для этой машины'], ['custom', 'Свои проценты']]),
    range('dots.from', 'Свои: начало, % оборотов', 60, 30, 95, 1, '%'),
    range('dots.to', 'Свои: конец, % оборотов', 95, 70, 100, 1, '%'),
    bool('dots.pit', 'Голубые лампы на питлейне', true),
    bool('dots.blink', 'Мигание на пределе', false),
  ] },
  { group: 'Кольцо и передача', items: [
    bool('ring.arc', 'Дуги газа и тормоза вокруг передачи', true),
    bool('ring.flash', 'Вспышка при смене передачи', true),
  ] },
  { group: 'Скорость и обороты', items: [
    select('speedUnit', 'Единицы скорости', 'auto', [['auto', 'Как в игре'], ['kph', 'км/ч'], ['mph', 'миль/ч']]),
    bool('labels', 'Подписи KPH и RPM', true), bool('rpmK', 'Обороты в тысячах (5.6)', false),
  ] },
  { group: 'График', items: [
    range('graph.seconds', 'Окно времени', 10, 5, 30, 1, ' с'), range('graph.thick', 'Толщина линий', 2, 1, 5),
    bool('graph.throttle', 'Газ', true), bool('graph.brake', 'Тормоз', true), bool('graph.clutch', 'Сцепление', false), bool('graph.steer', 'Руль', false),
    bool('graph.grid', 'Сетка', true), bool('graph.fill', 'Заливка под линиями', false), bool('graph.abs', 'Подсветка ABS', true),
  ] },
];
const DASH_ITEMS = DASH_SCHEMA.flatMap((g) => g.items);

// Привести настройки к актуальному виду: известные ключи, значения в границах; patch — плоские изменения поверх cur
function normalizeSchema(items, cur, patch = {}) {
  const defaults = Object.fromEntries(items.map((i) => [i.key, i.def]));
  const src = { ...defaults, ...(cur || {}), ...patch };
  const out = {};
  for (const it of items) {
    const v = src[it.key];
    if (it.type === 'bool') out[it.key] = typeof v === 'boolean' ? v : it.def;
    else if (it.type === 'range') out[it.key] = Number.isFinite(v) ? Math.min(it.max, Math.max(it.min, Math.round(v))) : it.def;
    else out[it.key] = it.options.some(([id]) => id === v) ? v : it.def;
  }
  return out;
}
const normalizeDash = (cur, patch) => normalizeSchema(DASH_ITEMS, cur, patch);

// Настройки Sectors (полоса секторов с наполнением)
const SECTORS_SCHEMA = [
  { group: 'Секторы', items: [
    range('max', 'Максимум секторов на экране', 5, 1, 5),
    select('ref', 'Сравнивать с', 'best', [['best', 'Моим лучшим кругом'], ['session', 'Лучшим кругом сессии'], ['optimal', 'Идеальным кругом (лучшие сектора)'], ['last', 'Прошлым кругом']]),
    range('decimals', 'Знаков после точки', 3, 2, 3),
    bool('labels', 'Подписи S1, S2…', true),
    bool('fill', 'Заливка по мере проезда сектора', true),
    bool('underline', 'Цветная линия под сектором', true),
    bool('slide', 'Плавная прокрутка секторов', true),
  ] },
];
const SECTORS_ITEMS = SECTORS_SCHEMA.flatMap((g) => g.items);
const normalizeSectors = (cur, patch) => normalizeSchema(SECTORS_ITEMS, cur, patch);

// Настройки Laps (блок кругов): каждый из блоков включается отдельно
const LAPS_SCHEMA = [
  { group: 'Что показывать', items: [
    bool('blocks.current', 'Время текущего круга', true),
    bool('blocks.predict', 'Предикт круга и дельта', true),
    bool('blocks.best', 'Лучший круг', true),
    bool('blocks.last', 'Прошлый круг', true),
    bool('blocks.leader', 'Лучший круг лидера класса', true),
    bool('labels', 'Подписи блоков', true),
  ] },
];
const LAPS_ITEMS = LAPS_SCHEMA.flatMap((g) => g.items);
const normalizeLaps = (cur, patch) => normalizeSchema(LAPS_ITEMS, cur, patch);

// Настройки Rejoin (помощник выезда на трассу)
const REJOIN_SCHEMA = [
  { group: 'Когда показывать', items: [
    range('stopSpeed', 'Считать остановкой скорость до', 15, 1, 60, 1, ' км/ч'),
    bool('always', 'Показывать всегда (для настройки)', false),
  ] },
  { group: 'Сигнал', items: [
    range('danger', 'Опасно, если меньше', 3, 1, 10, 1, ' с'),
    range('warn', 'Осторожно, если меньше', 7, 3, 20, 1, ' с'),
  ] },
  { group: 'Вид', items: [
    range('count', 'Сколько машин показывать', 2, 1, 3),
    bool('names', 'Имена и номера', true),
    bool('dist', 'Расстояние в метрах', true),
    bool('bar', 'Шкала приближения', true),
  ] },
];
const REJOIN_ITEMS = REJOIN_SCHEMA.flatMap((g) => g.items);
const normalizeRejoin = (cur, patch) => normalizeSchema(REJOIN_ITEMS, cur, patch);

// Настройки Fuel Calculator
const FUEL_SCHEMA = [
  { group: 'Расчёт', items: [
    range('margin', 'Запас сверху, кругов', 0.5, 0, 3, 0.5),
    range('planLaps', 'Если дистанции нет (практика) считать на кругов', 10, 1, 60, 1),
    select('units', 'Единицы', 'auto', [['auto', 'Как в игре'], ['l', 'Литры'], ['gal', 'Галлоны']]),
  ] },
  { group: 'Что показывать', items: [
    bool('blocks.bar', 'Полоса бака', true),
    bool('blocks.stats', 'Расход, хватит на, до финиша', true),
    bool('blocks.save', 'Экономия: цель по расходу и полоса «лифт»', true),
    bool('blocks.pit', 'Выбранное в меню боксов', true),
  ] },
];
const FUEL_ITEMS = FUEL_SCHEMA.flatMap((g) => g.items);
const normalizeFuel = (cur, patch) => normalizeSchema(FUEL_ITEMS, cur, patch);

// Настройки Pit Limiter
const PITLIMIT_SCHEMA = [
  { group: 'Поведение', items: [
    range('exitSeconds', 'Показывать «Можно ехать» после выезда', 3, 1, 8, 1, ' с'),
    range('tolerance', 'Допуск скорости над лимитом', 1, 0, 5, 1, ' км/ч'),
    select('units', 'Единицы', 'auto', [['auto', 'Как в игре'], ['kph', 'км/ч'], ['mph', 'миль/ч']]),
  ] },
  { group: 'Вид', items: [
    bool('bar', 'Шкала скорости с отсечкой лимита', true),
    bool('hint', 'Подсказки («Включи лимитер»)', true),
  ] },
];
const PITLIMIT_ITEMS = PITLIMIT_SCHEMA.flatMap((g) => g.items);
const normalizePitlimit = (cur, patch) => normalizeSchema(PITLIMIT_ITEMS, cur, patch);

// Оформление Relative: как показываются классы и круговые
const REL_SCHEMA = [
  { group: 'Классы и круговые', items: [
    bool('ring', 'Круговые обводкой (иначе заливкой)', true),
    bool('label', 'Подпись +1L / −1L у круговых', true),
    bool('pulse', 'Мигание, когда круговой догоняет сзади', true),
    range('pulseSec', 'Мигать, если до него меньше', 5, 1, 15, 1, ' с'),
  ] },
];
const REL_ITEMS = REL_SCHEMA.flatMap((g) => g.items);
const normalizeRel = (cur, patch) => normalizeSchema(REL_ITEMS, cur, patch);

// Настройки Traffic (плашка мультикласса)
const TRAFFIC_SCHEMA = [
  { group: 'Что показывать', items: [
    bool('behind', 'Быстрый класс сзади', true),
    bool('ahead', 'Медленный класс впереди', true),
    bool('number', 'Номер машины', false),
  ] },
  { group: 'Когда', items: [
    range('range', 'Показывать, если до встречи меньше', 30, 10, 90, 5, ' с'),
    range('warn', 'Мигать, если быстрый класс ближе чем', 6, 2, 15, 1, ' с'),
  ] },
];
const TRAFFIC_ITEMS = TRAFFIC_SCHEMA.flatMap((g) => g.items);
const normalizeTraffic = (cur, patch) => normalizeSchema(TRAFFIC_ITEMS, cur, patch);

// Настройки Safety Rating (оценка SR по ходу сессии)
const SR_SCHEMA = [
  { group: 'Что показывать', items: [
    bool('delta', 'Изменение за сессию', true),
    bool('start', 'SR на старте сессии', true),
    bool('ir', 'Прогноз iRating (в гонке)', true),
    bool('stats.incidents', 'Инциденты', true),
    bool('stats.clean', 'Чистых поворотов до нуля', true),
    bool('stats.corners', 'Пройдено поворотов', false),
  ] },
  { group: 'Когда', items: [
    bool('hideUnranked', 'Скрывать, когда сессия не влияет на SR', true),
  ] },
];
const SR_ITEMS = SR_SCHEMA.flatMap((g) => g.items);
const normalizeSr = (cur, patch) => normalizeSchema(SR_ITEMS, cur, patch);

// Настройки Forecast (прогноз погоды)
const FORECAST_SCHEMA = [
  { group: 'Что показывать', items: [
    bool('headline', 'Строка «Дождь через…»', true),
    bool('temp', 'Температура', true),
    bool('clock', 'Игровое время ячейки', false),
    range('cells', 'Ячеек в полосе', 5, 3, 8, 1),
  ] },
  { group: 'Когда', items: [
    range('threshold', 'Считать дождём от', 40, 10, 90, 5, ' %'),
    bool('hideDry', 'Скрывать, пока дождя не ожидается', false),
  ] },
];
const FORECAST_ITEMS = FORECAST_SCHEMA.flatMap((g) => g.items);
const normalizeForecast = (cur, patch) => normalizeSchema(FORECAST_ITEMS, cur, patch);

// Настройки Radar Bars (полосы машин на бортах)
const RADARBARS_SCHEMA = [
  { group: 'Вид', items: [
    range('thickness', 'Толщина полос', 14, 4, 60, 2, ' px'),
    bool('track', 'Тусклая основа полос', true),
  ] },
];
const RADARBARS_ITEMS = RADARBARS_SCHEMA.flatMap((g) => g.items);
const normalizeRadarbars = (cur, patch) => normalizeSchema(RADARBARS_ITEMS, cur, patch);

const VARIATIONS = ['practice', 'qualify', 'race', 'spotting'];
const SESSION_TYPES = ['practice', 'qualify', 'race'];
const CATEGORIES = ['sportscar', 'formulacar', 'oval', 'dirtroad', 'dirtoval'];
// Игры: для каждой — какие оверлеи в ней работают (null — все)
const GAMES = {
  iracing: { name: 'iRacing', types: null },
  lmu: { name: 'Le Mans Ultimate', short: 'LMU', types: ['digiflag', 'dash', 'rejoin', 'traffic'] },
};
const gameAllows = (game, type) => { const t = (GAMES[game] || GAMES.iracing).types; return !t || t.includes(type); };

const uid = (prefix) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

function createOverlay(type, at = {}) {
  const meta = OVERLAY_TYPES[type];
  return {
    id: uid(type),
    type,
    name: meta.title,
    enabled: true,
    x: at.x ?? 80, y: at.y ?? 80,
    width: meta.width, height: meta.height, // размер окна = масштаб и количество строк
    bgOpacity: 0.8,
    scale: 1,            // масштаб содержимого, если не включена подгонка под ширину окна
    autoScale: type === 'dash', // true — масштаб следует за шириной окна (у Dash так по умолчанию)
    sizes: {},           // Relative и Standings: размер каждого поля, % (id колонки → 70…200)
    dash: normalizeDash(),
    sectors: normalizeSectors(),
    laps: normalizeLaps(),
    rejoin: normalizeRejoin(),
    fuel: normalizeFuel(),
    rel: normalizeRel(),
    traffic: normalizeTraffic(),
    pitlimit: normalizePitlimit(),
    sr: normalizeSr(),
    forecast: normalizeForecast(),
    radarbars: normalizeRadarbars(),
    flagLayout: 'big',   // DigiFlag: big — квадрат, strip — две вертикальные полосы
    hideEmpty: false,    // DigiFlag: прятать панель, когда флага нет
    radarRange: 15,      // Radar: на сколько метров видно машины спереди и сзади
    radarIdle: 0.35,     // Radar: прозрачность, когда рядом никого нет
    radarDist: true,     // Radar: расстояние цифрами
    radarClass: false,   // Radar: окрашивать машины цветом класса
    columns: normalizeColumns(type),
    cards: normalizeCards(type),
    header: normalizeHf(type, 'header'),
    footer: normalizeHf(type, 'footer'),
    visibility: { onTrack: true, inGarage: false, disconnected: false },
  };
}

function createLayout(name, overlays = []) {
  return {
    id: uid('layout'),
    name,
    carFilter: { type: 'all', values: [] },  // all | car | category
    sessionTypes: ['all'],                   // ['all'] или подмножество SESSION_TYPES
    isDefault: false,
    overlays,
    variations: {},                          // { race: { enabled, overlays } , ... }
    updatedAt: new Date().toISOString(),
  };
}

const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------- совпадение раскладки с текущей сессией ----------

function normalizeCarName(s) {
  return String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    .replace(/([a-z])([0-9])/g, '$1 $2').replace(/([0-9])([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function carMatches(values, car) {
  const c = normalizeCarName(car);
  if (!c) return false;
  return values.some((v) => {
    const n = normalizeCarName(v);
    return n && (c.includes(n) || n.includes(c));
  });
}

function categoryMatches(value, current) {
  const v = String(value).toLowerCase().replace(/\s+/g, '');
  const c = String(current).toLowerCase().replace(/\s+/g, '');
  if (v === c) return true;
  // старое деление iRacing: «road» = спортпрототипы и формулы
  const road = new Set(['sportscar', 'formulacar', 'road']);
  return road.has(v) && road.has(c);
}

// Счёт совпадения. 0 — раскладка не подходит.
function matchScore(layout, { car, category, session }) {
  const types = layout.sessionTypes || ['all'];
  const anySession = types.includes('all');
  if (!anySession && !types.includes(session)) return 0;
  let score = anySession ? 1 : 10;

  const f = layout.carFilter || { type: 'all', values: [] };
  switch (f.type) {
    case 'car':
      if (!f.values.length) score += 2;
      else if (carMatches(f.values, car)) score += 100;
      else return 0;
      break;
    case 'category':
      if (!f.values.length) score += 2;
      else if (category && f.values.some((v) => categoryMatches(v, category))) score += 50;
      else return 0;
      break;
    default:
      score += 3;
  }
  if (layout.isDefault) score += 1;
  return score;
}

function findMatchingLayout(layouts, ctx) {
  let best = null, bestScore = 0;
  for (const l of layouts) {
    const s = matchScore(l, ctx);
    if (s > bestScore) { best = l; bestScore = s; }
  }
  return best ? { layout: best, score: bestScore } : null;
}

// ---------- активный набор оверлеев ----------

// Какой вариант раскладки сейчас действует: споттинг важнее типа сессии
// Каждый тип оверлея всегда есть в наборе раскладки: в панели его только включают и выключают.
// Недостающие (новые типы после обновления, наборы из старых версий) добавляются выключенными.
function ensureAllTypes(list) {
  if (!Array.isArray(list)) return false;
  let n = list.length, added = false;
  for (const type of Object.keys(OVERLAY_TYPES)) {
    if (list.some((o) => o.type === type)) continue;
    const o = createOverlay(type, { x: 80 + n * 30, y: 80 + n * 30 });
    o.enabled = false;
    list.push(o);
    n++;
    added = true;
  }
  return added;
}
const ensureLayoutTypes = (l) => [l.overlays, ...Object.values(l.variations || {}).map((v) => v?.overlays)].map(ensureAllTypes).some(Boolean);

function activeVariation(layout, { session, spotting }) {
  const v = layout?.variations || {};
  if (spotting && v.spotting?.enabled) return 'spotting';
  if (session && v[session]?.enabled) return session;
  return 'base';
}

function overlaysOf(layout, variation) {
  if (!layout) return [];
  if (variation && variation !== 'base') return layout.variations?.[variation]?.overlays || layout.overlays;
  return layout.overlays;
}

module.exports = {
  OVERLAY_TYPES, VARIATIONS, SESSION_TYPES, CATEGORIES, GAMES, gameAllows,
  createOverlay, createLayout, clone, uid, ensureAllTypes, ensureLayoutTypes,
  matchScore, findMatchingLayout, activeVariation, overlaysOf, normalizeCarName,
  COLUMN_CATALOG, COLUMN_DEFAULTS, normalizeColumns, HF_CATALOG, normalizeHf, WEATHER_CARDS, normalizeCards,
  DASH_SCHEMA, normalizeDash, SECTORS_SCHEMA, normalizeSectors, LAPS_SCHEMA, normalizeLaps, REJOIN_SCHEMA, normalizeRejoin, FUEL_SCHEMA, normalizeFuel, normalizeSizes, REL_SCHEMA, normalizeRel, TRAFFIC_SCHEMA, normalizeTraffic, PITLIMIT_SCHEMA, normalizePitlimit, SR_SCHEMA, normalizeSr, FORECAST_SCHEMA, normalizeForecast, RADARBARS_SCHEMA, normalizeRadarbars,
};
