// Модель Forecast: прогноз погоды из описания сессии iRacing и время до дождя.
//
// Прогноз iRacing показывает в своём окне «View Forecast», а в описании сессии (YAML) он лежит списком записей
// {Time, Temp, WindSpeed, WindDir, Skies, Humidity, Fog, шанс дождя}. Точное имя блока и полей у разных версий игры разное,
// поэтому список ищем по признакам (массив записей со временем и шансом осадков), а не по одному жёсткому пути.
// Прогноз есть не в каждой сессии: в режимах Static и Realistic его нет, и тогда оверлей говорит об этом прямо.
//
// Время в записях — секунды игровых часов. Игровое время может идти быстрее реального (множитель времени), поэтому
// «через сколько минут» считаем в реальных минутах: множитель оцениваем по ходу игровых часов относительно сессионного времени.

const num = (v) => { const n = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(n) ? n : null; };
const lower = (s) => String(s).toLowerCase();

const RAIN_KEYS = ['rainpct', 'rainprobability', 'precipitation', 'precipchance', 'chanceofrain', 'rainchance', 'precip'];
const pick = (obj, keys) => {
  for (const [k, v] of Object.entries(obj)) if (keys.includes(lower(k))) return v;
  return undefined;
};

// Запись прогноза: объект со временем и шансом осадков
function readEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const time = num(pick(raw, ['time', 'timeofday', 'starttime']));
  const rain = num(pick(raw, RAIN_KEYS));
  if (time == null || rain == null) return null;
  return {
    time,
    rain,
    temp: num(pick(raw, ['temp', 'airtemp', 'temperature'])),
    windSpeed: num(pick(raw, ['windspeed', 'windvel'])),
    windDir: num(pick(raw, ['winddir', 'winddirection'])),
    skies: pick(raw, ['skies', 'sky']) ?? null,
    humidity: num(pick(raw, ['humidity', 'relativehumidity'])),
    fog: num(pick(raw, ['fog', 'foglevel'])),
  };
}

// Ищем список записей в дереве описания сессии (с ограничением глубины); возвращает { path, entries }
function findForecast(node, path = '', depth = 0) {
  if (!node || typeof node !== 'object' || depth > 4) return null;
  if (Array.isArray(node)) {
    const entries = node.map(readEntry).filter(Boolean);
    if (entries.length && entries.length >= node.length / 2) return { path, entries };
    for (let i = 0; i < Math.min(node.length, 3); i++) {
      const hit = findForecast(node[i], `${path}[${i}]`, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  // сначала ветки с «forecast» в имени, потом остальные: так находим нужный список быстрее и надёжнее
  const keys = Object.keys(node).sort((a, b) => (/forecast/i.test(b) ? 1 : 0) - (/forecast/i.test(a) ? 1 : 0));
  for (const k of keys) {
    if (!/forecast|weather|precip/i.test(k) && depth > 0) continue;
    const hit = findForecast(node[k], path ? `${path}.${k}` : k, depth + 1);
    if (hit) return hit;
  }
  return null;
}

// Шанс осадков в процентах: если все значения не больше 1, это доли
function toPercent(entries) {
  const max = Math.max(...entries.map((e) => e.rain));
  const k = max <= 1 ? 100 : 1;
  return entries.map((e) => ({ ...e, rain: Math.min(Math.max(e.rain * k, 0), 100) }));
}

const SNAP = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 16, 20, 24, 30, 32, 48, 60];

class ForecastTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.version = null;
    this.parsed = null;       // { path, entries } или null
    this.samples = [];        // [sessionTime, timeOfDay] для оценки множителя времени
    this.mult = null;
    this.anchor = null;       // 'tod' — время записей по игровым часам; 'session' — секунды от начала сессии
    this.out = { active: false };
  }

  // Множитель времени: на сколько игровые часы идут быстрее реальных
  trackMultiplier(sessionTime, tod) {
    const s = this.samples;
    const last = s[s.length - 1];
    if (last && (sessionTime < last[0] || tod < last[1] - 1)) s.length = 0;   // перемотка, новая сессия, полночь
    if (!last || sessionTime - last[0] >= 1) s.push([sessionTime, tod]);
    while (s.length > 2 && sessionTime - s[0][0] > 90) s.shift();
    if (s.length > 1 && sessionTime - s[0][0] >= 20) {
      const raw = (tod - s[0][1]) / (sessionTime - s[0][0]);
      if (raw > 0.5 && raw < 100) {
        const near = SNAP.reduce((a, b) => (Math.abs(b - raw) < Math.abs(a - raw) ? b : a));
        this.mult = Math.abs(near - raw) / near < 0.15 ? near : raw;
      }
    }
  }

  update(snap) {
    const { vars = {}, session } = snap || {};
    if (!snap?.connected || !session) { this.out = { active: false }; return; }

    if (snap.sessionVersion !== this.version) this.load(snap);

    const tod = num(vars.SessionTimeOfDay);
    const st = num(vars.SessionTime);
    if (tod != null && st != null) this.trackMultiplier(st, tod);

    const w = session.WeekendInfo || {};
    const base = {
      active: true,
      weatherType: String(w.TrackWeatherType ?? w.WeekendOptions?.WeatherType ?? ''),
      precipNow: num(vars.Precipitation),
      wetness: num(vars.TrackWetness),
      declaredWet: !!vars.WeatherDeclaredWet,
      imperial: vars.DisplayUnits === 0,
    };

    if (!this.parsed) { this.out = { ...base, available: false }; return; }

    // относительно чего записи: по игровым часам или от начала сессии (определяем один раз по первой записи)
    const entries = this.parsed.entries;
    if (!this.anchor && tod != null && st != null) {
      // игровые часы внутри охвата записей — значит, время абсолютное; иначе, если внутри охвата сессионное время, — от старта сессии
      const first = entries[0].time, last = entries[entries.length - 1].time;
      const inSpan = (x) => x >= first - 1800 && x <= last + 1800;
      this.anchor = inSpan(tod) ? 'tod' : inSpan(st) ? 'session' : 'tod';
      console.log(`[forecast] время записей считаем ${this.anchor === 'tod' ? 'по игровым часам' : 'от начала сессии'} (часы ${Math.round(tod)} с, сессия ${Math.round(st)} с, записи ${first}…${last} с)`);
    }
    const now = this.anchor === 'session' ? st : tod;
    if (now == null) { this.out = { ...base, available: false }; return; }

    const mult = this.mult ?? 1;
    let list = entries.map((e) => {
      let dt = e.time - now;
      if (this.anchor === 'tod' && dt < -12 * 3600) dt += 86400;      // записи после полуночи
      return { ...e, inMin: dt / mult / 60, clock: this.anchor === 'tod' ? ((e.time % 86400) + 86400) % 86400 : null };
    });
    // текущая запись (последняя уже наступившая) остаётся как «сейчас», дальше — будущие
    const nowIdx = list.reduce((acc, e, i) => (e.inMin <= 0 ? i : acc), -1);
    list = list.slice(Math.max(nowIdx, 0));
    this.out = { ...base, available: true, mult, multKnown: this.mult != null, entries: list.slice(0, 24), anchor: this.anchor };
  }

  // Новая версия описания сессии: заново ищем прогноз и пишем в журнал, что нашли (чтобы по логу видеть структуру)
  load(snap) {
    this.version = snap.sessionVersion;
    this.anchor = null;
    const session = snap.session;
    const hit = findForecast(session);
    this.parsed = hit ? { path: hit.path, entries: toPercent(hit.entries).sort((a, b) => a.time - b.time) } : null;
    const w = session.WeekendInfo || {};
    if (this.parsed) {
      const e = this.parsed.entries;
      console.log(`[forecast] прогноз найден: ${this.parsed.path}, записей ${e.length}, первая ${JSON.stringify(e[0])}, тип погоды ${w.TrackWeatherType ?? '?'}`);
    } else {
      const keys = Object.keys(session).filter((k) => /weather|forecast|precip/i.test(k));
      console.log(`[forecast] прогноза в описании сессии нет; тип погоды ${w.TrackWeatherType ?? '?'}, похожие блоки: ${keys.join(', ') || '—'}`);
    }
  }

  frame() { return this.out; }
}

module.exports = { ForecastTracker, findForecast, readEntry };
