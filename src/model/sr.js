// Модель SR: живая оценка Safety Rating игрока по ходу события (практика → квалификация → гонка).
// Математика — src/model/srmath.js (модель Nishizumi-SR, MIT). Здесь — откуда берутся входные числа:
//   повороты — по пройденной дистанции (доля круга × поворотов на круге), как их считает iRacing;
//   инциденты — PlayerCarMyIncidentCount от начала сессии;
//   SR и лицензия на старте — LicSubLevel / LicLevel игрока из сессионного YAML;
//   вес сессии — по типу сессии; неофициальные события (хостед, лиги, тест) SR не меняют.
// Считаем на каждом тике, даже когда окно оверлея закрыто: иначе повороты до его открытия потерялись бы.
// Состояние события пишем в файл, чтобы перезапуск приложения посреди гонки ничего не сбросил.
const fs = require('fs');
const M = require('./srmath');
const { LICENSE_COLORS } = require('./common');
const CORNERS = require('./srCorners.json');

const SURF_NOT_IN_WORLD = -1, SURF_PIT_STALL = 1;
const MAX_TICK_LAPS = 0.10;     // больше за тик не проехать: эвакуатор, сброс, телепорт — не считаем
const SAVE_EVERY_LAPS = 0.25;
const CLASS_LETTERS = ['R', 'D', 'C', 'B', 'A', 'P'];

// Трассы, где SR считается на меньшем числе поворотов, чем говорят и таблица, и описание сессии. Каждое значение — corners_per_lap из
// официального результата iRacing по этой трассе (экспорт результатов события), а не оценка.
//   249 Nordschleife Industriefahrten: сессия и таблица дают 154, iRacing считает 73. Проверено по двум гонкам (subsession 89656819 и
//   следующей): при 154 оверлей давал +1.05 и +0.94 вместо реальных +0.23 и +0.16, при 73 выходит +0.26 и +0.16.
const SCORED_CORNERS = { 249: 73 };

// Поворотов на круге, которые идут в зачёт SR: проверенное значение по трассе, затем официальная таблица iRacing по TrackID, иначе число из YAML
function cornersPerLap(weekend) {
  const scored = SCORED_CORNERS[Number(weekend?.TrackID)];
  if (scored) return scored;
  const official = CORNERS.tracks[String(weekend?.TrackID)];
  if (official) return official;
  const n = parseInt(weekend?.TrackNumTurns, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function eventWeight(session, sessionNum) {
  const w = session?.WeekendInfo || {};
  const event = String(w.EventType || '').toLowerCase();
  if (event.includes('practice') || event.includes('test')) return 0;   // тренировочный сервер не в зачёт
  if (w.Official != null && Number(w.Official) === 0) return 0;          // хостед, лига: SR не меняется
  const list = session?.SessionInfo?.Sessions || [];
  const sess = list.find((s) => s.SessionNum === sessionNum);
  return M.sessionWeight(sess?.SessionType);
}

function playerRating(session) {
  const di = session?.DriverInfo;
  const me = (di?.Drivers || []).find((d) => d.CarIdx === di?.DriverCarIdx);
  const lic = M.licenceFromLevel(me?.LicLevel);
  const sub = Number(me?.LicSubLevel);
  if (!lic || !Number.isFinite(sub) || sub < 0) return null;
  return { sr: sub / 100, cls: lic.cls, band: lic.band };
}

// Счётчик сессии мог начаться не с нуля (пришли посреди сессии) или сброситься — отсчёт от базы
function sinceBase(start, key, current) {
  if (!Number.isFinite(current)) return null;
  if (start[key] == null || current < start[key]) start[key] = current;
  return current - start[key];
}

// ---------- журнал: всё, что нужно, чтобы по логу понять, почему SR вышел таким ----------
const f2 = (x) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(2));
const ratingText = (r) => (r ? `${CLASS_LETTERS[r.cls] || '?'} ${f2(r.sr)}` : '—');
function cornersSource(weekend) {
  if (SCORED_CORNERS[Number(weekend?.TrackID)]) return 'проверено по официальным результатам iRacing';
  if (CORNERS.tracks[String(weekend?.TrackID)]) return 'таблица iRacing';
  const n = parseInt(weekend?.TrackNumTurns, 10);
  return Number.isFinite(n) && n > 0 ? 'TrackNumTurns из сессии (в таблице трека нет)' : 'нет данных';
}

class SrTracker {
  constructor({ stateFile = null } = {}) {
    this.stateFile = stateFile;
    this.saved = null;
    this.restoreFrom = null;
    if (stateFile) {
      try { this.restoreFrom = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { /* файла ещё нет */ }
    }
    this.reset(null);
    this.out = { active: false };
  }

  reset(eventKey) {
    this.eventKey = eventKey;
    this.start = this.freshStart(null, null);
    this.distance = 0;      // пройдено кругов в этой сессии (основная оценка: до вашего финиша под клетчатым)
    this.distanceAll = 0;   // то же, но пока не финишировал последний пилот (техническая оценка для сверки)
    this.prevPct = null;
    this.finishLap = null; this.finished = false;   // клетчатый флаг: после пересечения финиша круги в зачёт не идут
    this.outcome = null;    // где сессия оставила рейтинг (для следующей сессии события)
  }

  // Что сессия знает о своём начале: номер, база счётчика инцидентов, рейтинг старта
  freshStart(sessionNum, carried) {
    return { sessionNum, incBase: null, rating: null, yamlSr: null, carried };
  }

  update(snap) {
    const { vars = {}, session } = snap || {};
    if (!snap?.connected || !session) {
      if (this.out?.active) this.logSummary('игра закрыта или данных сессии нет');
      this.out = { active: false };
      return;
    }

    const w = session.WeekendInfo || {};
    const eventKey = `${snap.source}|${w.SubSessionID ?? 0}`;
    if (eventKey !== this.eventKey) {
      this.logSummary('событие сменилось');
      this.reset(eventKey);
      this.tryRestore(snap.source, w.SubSessionID);
    }

    const sessionNum = vars.SessionNum;
    if (this.start.sessionNum !== sessionNum) {
      this.logSummary('сессия сменилась');
      // новая сессия события стартует с оценки предыдущей: iRacing переписывает SR в YAML только после события
      const carried = this.start.sessionNum != null ? this.outcome : null;
      this.start = this.freshStart(sessionNum, carried);
      this.distance = 0;
      this.distanceAll = 0;
      this.prevPct = null;
      this.finishLap = null; this.finished = false;
      this.outcome = null;
    }

    this.countDistance(vars);
    const incidents = sinceBase(this.start, 'incBase', vars.PlayerCarMyIncidentCount) ?? 0;
    const rating = this.startRating(playerRating(session));
    const weight = eventWeight(session, sessionNum);
    const cpl = cornersPerLap(w);
    const corners = this.distance * (cpl || 0);
    const cornersAlt = this.distanceAll * (cpl || 0);

    const out = {
      active: true,
      weight,
      sessionType: String((session.SessionInfo?.Sessions || []).find((s) => s.SessionNum === sessionNum)?.SessionType || ''),
      incidents,
      corners,
      cornersAlt,
      cornersPerLap: cpl,
      srStart: rating?.sr ?? null,
      srNow: null,
      delta: null,
      cleanNeeded: null,
      licence: rating ? CLASS_LETTERS[rating.cls] || 'R' : null,
      licColor: rating ? (LICENSE_COLORS[CLASS_LETTERS[rating.cls]] || LICENSE_COLORS.R)[0] : null,
    };
    if (rating && cpl) {
      // Сессия с нулевым весом (практика, разминка, неофициальное событие) рейтинг не трогает — ни на чуть:
      // даже нулевой расчёт перерисовал бы CPI в другой полосе и сдвинул SR
      const p = weight > 0 && corners > 0
        ? M.project(rating.sr, rating.cls, rating.band, corners * weight, incidents * weight)
        : { sr: rating.sr, band: rating.band };
      out.srNow = p.sr;
      out.delta = p.sr - rating.sr;
      // техническая оценка: те же вход и формула, но поворотов набрано до последнего финиша (показывается только в техническом режиме, пишется в журнал)
      const pa = weight > 0 && cornersAlt > 0 ? M.project(rating.sr, rating.cls, rating.band, cornersAlt * weight, incidents * weight) : { sr: rating.sr };
      out.srNowAlt = pa.sr;
      out.deltaAlt = pa.sr - rating.sr;
      this.outcome = { yamlSr: this.start.yamlSr, rating: { sr: p.sr, cls: rating.cls, band: p.band } };
      if (weight > 0) out.cleanNeeded = M.cleanCornersNeeded(incidents, corners, M.cpiFromSr(rating.sr, rating.cls, rating.band));
    }
    this.out = out;
    this.logProgress(w, session, sessionNum, out, rating);
    this.save(w.SubSessionID);
  }

  // Шапка при старте каждой сессии события и строка хода: при смене числа инцидентов и не чаще раза в минуту
  logProgress(w, session, sessionNum, out, rating) {
    const now = Date.now();
    const key = `${this.eventKey}|${sessionNum}`;
    if (this.loggedKey !== key) {
      this.loggedKey = key;
      this.lastLogAt = now;
      this.lastLogInc = out.incidents;
      console.log(`[sr] событие ${w.SubSessionID ?? '—'} (${this.eventKey?.split('|')[0]}): тип ${w.EventType || '—'}, официальное: ${w.Official == null ? '—' : Number(w.Official) ? 'да' : 'нет'}; `
        + `сессия ${sessionNum} «${out.sessionType || '—'}», вес ${out.weight}${out.weight === 0 ? ' (SR не меняется)' : ''}; `
        + `трек ${w.TrackID ?? '—'} «${w.TrackDisplayName || w.TrackName || '—'}», поворотов на круге ${out.cornersPerLap ?? '—'} (${cornersSource(w)}); `
        + `старт SR ${ratingText(rating)}${this.start.carried ? ' (перенесён из прошлой сессии)' : ''}`);
      return;
    }
    const incChanged = out.incidents !== this.lastLogInc;
    if (!incChanged && now - this.lastLogAt < 60000) return;
    this.lastLogAt = now;
    this.lastLogInc = out.incidents;
    console.log(`[sr] сессия ${sessionNum}: пройдено ${f2(this.distance)} кр., поворотов ${f2(out.corners)}, инцидентов ${out.incidents}${incChanged ? ' (изменилось)' : ''}, `
      + `SR ${f2(out.srStart)} → ${f2(out.srNow)} (${out.delta == null ? '—' : (out.delta >= 0 ? '+' : '') + f2(out.delta)}); `
      + `техн.: ${f2(this.distanceAll)} кр., SR → ${f2(out.srNowAlt)} (${out.deltaAlt == null ? '—' : (out.deltaAlt >= 0 ? '+' : '') + f2(out.deltaAlt)})`);
  }

  // Итог сессии в журнал: вызывается, когда сессия или событие закончились
  logSummary(reason) {
    const o = this.out;
    if (!o?.active || this.eventKey == null || this.start.sessionNum == null || this.distance <= 0) return;
    console.log(`[sr] итог сессии ${this.start.sessionNum} (${reason}): пройдено ${f2(this.distance)} кр., поворотов ${f2(o.corners)}, инцидентов ${o.incidents}, вес ${o.weight}, `
      + `SR ${f2(o.srStart)} → ${f2(o.srNow)} (${o.delta == null ? '—' : (o.delta >= 0 ? '+' : '') + f2(o.delta)}); `
      + `техн.: ${f2(this.distanceAll)} кр., SR → ${f2(o.srNowAlt)} (${o.deltaAlt == null ? '—' : (o.deltaAlt >= 0 ? '+' : '') + f2(o.deltaAlt)})`);
  }

  // Повороты по дистанции: только пока вы сами в машине, на трассе и не в боксе
  countDistance(vars) {
    const p = vars.PlayerCarIdx;
    const surface = vars.CarIdxTrackSurface?.[p] ?? SURF_NOT_IN_WORLD;
    const pct = vars.CarIdxLapDistPct?.[p];
    const inCar = !!vars.IsOnTrack && !vars.IsReplayPlaying && surface !== SURF_NOT_IN_WORLD && surface !== SURF_PIT_STALL;
    if (!inCar || !(pct >= 0 && pct <= 1)) { this.prevPct = null; return; }
    if (this.prevPct != null) {
      let d = pct - this.prevPct;
      if (d < 0) d += 1;                 // пересекли линию старта
      if (d <= MAX_TICK_LAPS) {
        if (!this.finished) this.distance += d;                    // основная: после вашего финиша круг остывания не идёт в зачёт
        if (!(vars.SessionState >= 6)) this.distanceAll += d;      // техническая: считаем, пока гонку не закончили все (6 — остывание после последнего финиша)
      }
    }
    this.prevPct = pct;
    // Клетчатый флаг: для вас гонка кончается на следующем пересечении линии. Проверено по результату iRacing: гонка из трёх кругов с кругом
    // остывания давала 3.43 круга по дистанции, а iRacing засчитал 3.10 — основная оценка этот хвост срезает.
    const lap = vars.CarIdxLap?.[p];
    if (vars.SessionState >= 5 && Number.isFinite(lap)) {
      if (this.finishLap == null) this.finishLap = lap;
      else if (lap > this.finishLap) this.finished = true;
    }
  }

  // Рейтинг старта сессии: перенесённый из прошлой сессии события, пока YAML не переписан; иначе первое значение из YAML
  // (первое — потому что позже YAML может уже содержать SR, записанный по итогам этой самой сессии)
  startRating(yaml) {
    const st = this.start;
    if (st.yamlSr == null && yaml) st.yamlSr = yaml.sr;
    if (st.carried) {
      if (!yaml || yaml.sr === st.carried.yamlSr) return st.carried.rating;
      st.carried = null;                 // iRacing прислал новый SR — он главнее нашей оценки
      st.rating = yaml;
      st.yamlSr = yaml.sr;
    }
    if (!st.rating && yaml) st.rating = yaml;
    return st.rating;
  }

  // После перезапуска приложения посреди того же события продолжаем с сохранённого места
  tryRestore(source, subSessionId) {
    const s = this.restoreFrom;
    this.restoreFrom = null;
    if (source !== 'iracing' || !s || !subSessionId || s.subSessionId !== subSessionId) return;
    this.start = s.start;
    this.distance = s.distance || 0;
    this.distanceAll = s.distanceAll || s.distance || 0;
    this.outcome = s.outcome || null;
    this.saved = JSON.stringify(s);
    console.log(`[sr] продолжаем событие ${subSessionId} после перезапуска, сессия ${s.start?.sessionNum}, ${this.distance.toFixed(2)} кр.`);
  }

  // Пишем сразу при смене стартовых значений, иначе раз в четверть круга; только живые события с номером
  save(subSessionId) {
    if (!this.stateFile || !subSessionId || !this.eventKey?.startsWith('iracing|')) return;
    const state = { subSessionId, start: this.start, distance: this.distance, distanceAll: this.distanceAll, outcome: this.outcome };
    const prev = this.saved ? JSON.parse(this.saved) : null;
    const due = !prev || prev.subSessionId !== subSessionId || JSON.stringify(prev.start) !== JSON.stringify(state.start)
      || state.distance - prev.distance >= SAVE_EVERY_LAPS;
    if (!due) return;
    this.saved = JSON.stringify(state);
    // файл крошечный и пишется не чаще раза в четверть круга: синхронно через временный файл, чтобы записи
    // не накладывались друг на друга и обрыв посреди записи не оставил битый JSON
    try {
      fs.writeFileSync(`${this.stateFile}.tmp`, this.saved);
      fs.renameSync(`${this.stateFile}.tmp`, this.stateFile);
    } catch (e) { console.warn('[sr] не удалось сохранить состояние:', e.message); }
  }

  frame() { return this.out; }
}

module.exports = { SrTracker, cornersPerLap, eventWeight };
