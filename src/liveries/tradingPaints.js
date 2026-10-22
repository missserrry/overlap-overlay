// Загрузка ливрей Trading Paints — по схеме Better TP из Kapps (разбор: reverse/BETTERTP.md).
//   1. По списку пилотов сессии спрашиваем fetch.tradingpaints.gg, какие файлы есть.
//   2. Качаем их в Documents\iRacing\paint (bz2 распаковываем, .mip пишем как есть).
//   3. Просим iRacing перезагрузить текстуры этой машины.
//   4. Не качаем повторно то, что уже лежит с тем же размером; старое чистим через N дней.
const fs = require('fs');
const path = require('path');
const bzip = require('seek-bzip');
const { XMLParser } = require('fast-xml-parser');

const FETCH_URL = 'https://fetch.tradingpaints.gg/fetch.php';
const CAR_TYPES = ['car', 'car_decal', 'car_num', 'car_spec'];
const DAY = 24 * 3600 * 1000;

const DEFAULT_SETTINGS = {
  enabled: false,      // выключено по умолчанию: не качать параллельно с Kapps/официальным загрузчиком
  specMaps: true,      // car_spec (.mip)
  helmets: true,       // шлемы и комбинезоны
  decals: true,        // car_decal
  myOwn: true,         // своя ливрея
  cleanAfterDays: 30,  // 0 — не чистить
};

class TradingPaints {
  /**
   * @param {object} o
   * @param {string} o.paintDir   Documents\iRacing\paint
   * @param {string} o.dataFile   файл состояния (что и какого размера скачано)
   * @param {() => object} o.getSettings
   * @param {(carIdx:number) => void} o.reloadTexture
   * @param {() => void} o.onChange  состояние/журнал изменились (для панели)
   * @param {string} [o.fetchUrl] для тестов
   */
  constructor(o) {
    this.paintDir = o.paintDir;
    this.dataFile = o.dataFile;
    this.getSettings = () => ({ ...DEFAULT_SETTINGS, ...(o.getSettings() || {}) });
    this.reloadTexture = o.reloadTexture;
    this.onChange = o.onChange || (() => {});
    this.fetchUrl = o.fetchUrl || FETCH_URL;
    this.allowHttp = !!o.allowHttp; // только для тестов с локальной заглушкой; по-настоящему — только https
    this.data = this.loadData();
    this.log = [];
    this.status = { state: 'idle', total: 0, done: 0, totalBytes: 0, doneBytes: 0, lastFetch: null };
    this.lastKey = null;
    this.pending = null;   // сессия, пришедшая во время загрузки
    this.running = false;
    this.parser = new XMLParser({ parseTagValue: false, ignoreAttributes: false, attributeNamePrefix: '' });
  }

  // ---------- журнал и состояние ----------

  write(level, msg) {
    const t = new Date();
    const stamp = `${t.toLocaleDateString('sv-SE')} ${t.toLocaleTimeString('ru-RU')}`;
    this.log.push({ t: stamp, level, msg });
    if (this.log.length > 300) this.log.splice(0, this.log.length - 300);
    console.log(`[liveries] ${level}: ${msg}`);
    this.onChange();
  }

  loadData() {
    try {
      return JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
    } catch {
      return { version: 1, skins: {} };
    }
  }

  saveData() {
    fs.mkdirSync(path.dirname(this.dataFile), { recursive: true });
    const tmp = this.dataFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.dataFile);
  }

  snapshot() {
    return { settings: this.getSettings(), status: this.status, log: this.log.slice(-120), skins: Object.keys(this.data.skins).length };
  }

  // ---------- сессия ----------

  // Вызывается при каждом обновлении сессионного YAML iRacing (и с телеметрией LoadNumTextures)
  onSession(session, loadNumTextures) {
    const s = this.getSettings();
    if (!s.enabled || !session?.DriverInfo?.Drivers) return;
    const req = buildRequest(session, loadNumTextures);
    if (!req || req.key === this.lastKey) return;
    this.lastKey = req.key;
    if (this.running) { this.pending = { session, loadNumTextures }; return; }
    this.run(session, req).catch((e) => this.write('error', `Сбой загрузки: ${e.message}`));
  }

  // Сбросить «последний запрос» — следующая сессия будет обработана заново (кнопка «Обновить сейчас»)
  refresh(session, loadNumTextures) {
    this.lastKey = null;
    this.onSession(session, loadNumTextures);
  }

  async run(session, req) {
    this.running = true;
    try {
      const cars = await this.fetchList(req);
      if (cars) await this.downloadAll(session, req, cars);
      this.clean();
    } finally {
      this.running = false;
      this.status.state = 'idle';
      this.onChange();
      if (this.pending) {
        const p = this.pending;
        this.pending = null;
        this.lastKey = null;
        this.onSession(p.session, p.loadNumTextures);
      }
    }
  }

  async fetchList(req) {
    this.status = { ...this.status, state: 'fetching', lastFetch: new Date().toISOString() };
    this.onChange();
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(this.fetchUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(req.form).toString(),
          signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const xml = await res.text();
        let cars = this.parser.parse(xml)?.TPXML?.Cars?.Car ?? [];
        if (!Array.isArray(cars)) cars = [cars];
        return cars;
      } catch (e) {
        this.write('warning', `Не удалось получить список ливрей (${e.message}), повтор через 5 с`);
        await sleep(5000);
      }
    }
    return null;
  }

  async downloadAll(session, req, cars) {
    const s = this.getSettings();
    const queue = [];
    for (const car of orderCars(cars, req)) {
      const type = String(car.type);
      if (req.teamRacing && !CAR_TYPES.includes(type) && car.teamid === '0') continue; // личный шлем в командной гонке
      if (!s.helmets && (type === 'helmet' || type === 'suit')) continue;
      if (!s.decals && type === 'car_decal') continue;
      if (!s.specMaps && type === 'car_spec') continue;

      const driver = findDriver(req.drivers, car, req.teamRacing);
      if (!driver) continue;
      if (!s.myOwn && driver.CarIdx === req.myCarIdx) continue;

      const skinPath = this.skinPath(car, driver);
      if (!skinPath) continue;
      if (this.isSame(skinPath, car)) {
        this.touch(skinPath, car);
        continue;
      }
      // одна запись на машину и тип: если пришло дважды — берём последнюю
      const dup = queue.findIndex((q) => q.car.carid === car.carid && q.car.type === car.type && q.driver.CarIdx === driver.CarIdx);
      if (dup >= 0) queue.splice(dup, 1);
      queue.push({ car, driver, skinPath });
    }
    this.saveData();

    if (!queue.length) {
      this.write('info', 'Все ливреи уже на месте');
      return;
    }
    const totalBytes = queue.reduce((n, q) => n + (Number(q.car.filesize) || 0), 0);
    this.status = { ...this.status, state: 'downloading', total: queue.length, done: 0, totalBytes, doneBytes: 0 };
    this.write('info', `${queue.length} ливр. / ${formatBytes(totalBytes)} к загрузке`);

    for (const item of queue) {
      const ok = await this.downloadOne(item);
      this.status.done++;
      this.status.doneBytes += Number(item.car.filesize) || 0;
      if (ok) {
        this.reloadTexture(item.driver.CarIdx);
        const who = item.car.teamid !== '0' && req.teamRacing ? item.driver.TeamName : item.driver.UserName;
        this.write('info', `Загружено ${item.car.type.padStart(9)} #${String(item.driver.CarNumber ?? '').padStart(3)} ${who}`);
      }
      this.onChange();
    }
    this.saveData();
    this.write('info', 'Загрузка завершена');
  }

  // Куда класть файл — те же имена, что у Better TP и официального загрузчика
  skinPath(car, driver) {
    const team = car.teamid && car.teamid !== '0';
    const dir = String(car.directory || '');
    if (dir === 'helmets' || dir === 'suits' || car.type === 'helmet' || car.type === 'suit') {
      const folder = dir || (car.type === 'helmet' ? 'helmets' : 'suits');
      return path.join(this.paintDir, folder, team ? `team_${car.teamid}.tga` : `${car.userid}.tga`);
    }
    const carPath = String(driver.CarPath || '').trim();
    if (!carPath || /[\\/:*?"<>|]|\.\./.test(carPath)) return null;
    const name = team ? `${car.type}_team_${car.teamid}` : `${car.type}_${car.userid}`;
    return path.join(this.paintDir, carPath, name + (car.type === 'car_spec' ? '.mip' : '.tga'));
  }

  isSame(skinPath, car) {
    const rec = this.data.skins[skinPath];
    if (!rec || !fs.existsSync(skinPath)) return false;
    try {
      const size = fs.statSync(skinPath).size;
      return rec.realFilesize === size && Number(rec.filesize) === Number(car.filesize);
    } catch {
      return false;
    }
  }

  touch(skinPath, car, realFilesize) {
    const rec = this.data.skins[skinPath] || {};
    this.data.skins[skinPath] = {
      ...rec,
      filesize: Number(car.filesize) || 0,
      realFilesize: realFilesize ?? rec.realFilesize ?? null,
      type: car.type,
      lastUsed: Date.now(),
    };
  }

  async downloadOne({ car, driver, skinPath }) {
    const url = String(car.file || '');
    if (!(this.allowHttp ? /^https?:\/\//i : /^https:\/\//i).test(url)) {
      this.write('warning', `Пропуск ${car.type} #${driver.CarNumber}: нет ссылки на файл`);
      return false;
    }
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
        if (res.status !== 200) {
          this.write('warning', `Сервер ответил ${res.status}, пропуск ${car.type} #${driver.CarNumber}`);
          return false;
        }
        let body = Buffer.from(await res.arrayBuffer());
        if (!body.length) throw new Error('пустой ответ');
        if (car.type !== 'car_spec' && body[0] === 0x42 && body[1] === 0x5a && body[2] === 0x68) body = bzip.decode(body); // «BZh»
        fs.mkdirSync(path.dirname(skinPath), { recursive: true });
        const tmp = skinPath + '.part';
        fs.writeFileSync(tmp, body);
        fs.renameSync(tmp, skinPath);
        this.touch(skinPath, car, body.length);
        return true;
      } catch (e) {
        this.write('warning', `Не скачалось ${car.type} #${driver.CarNumber} (${e.message}), повтор через 5 с`);
        await sleep(5000);
      }
    }
    return false;
  }

  // Удаляем только то, что качали сами и что не использовалось cleanAfterDays дней
  clean() {
    const days = Number(this.getSettings().cleanAfterDays) || 0;
    if (days <= 0) return;
    const limit = Date.now() - days * DAY;
    let count = 0, bytes = 0;
    for (const [p, rec] of Object.entries(this.data.skins)) {
      if ((rec.lastUsed || 0) >= limit) continue;
      if (!p.startsWith(this.paintDir)) { delete this.data.skins[p]; continue; }
      try {
        bytes += fs.statSync(p).size;
        fs.unlinkSync(p);
        count++;
      } catch { /* файла уже нет */ }
      delete this.data.skins[p];
    }
    if (count) this.write('info', `Удалено старых ливрей: ${count}, освобождено ${formatBytes(bytes)}`);
    this.saveData();
  }
}

// ---------- запрос ----------

function buildRequest(session, loadNumTextures) {
  const di = session.DriverInfo;
  const wi = session.WeekendInfo || {};
  const drivers = (di.Drivers || []).filter((d) => !d.CarIsPaceCar && !d.IsSpectator && d.UserID > 0);
  if (!drivers.length) return null;
  const me = drivers.find((d) => d.CarIdx === di.DriverCarIdx);
  const teamRacing = !!Number(wi.TeamRacing);
  // формат как у Better TP: "{UserID}={CarPath}={TeamID}={CarNumberRaw}" через запятую; булевы — как в Python
  const list = drivers.map((d) => `${d.UserID}=${d.CarPath}=${d.TeamID ?? 0}=${d.CarNumberRaw ?? ''}`).join(',');
  const form = {
    list,
    series: String(wi.SeriesID ?? 0),
    league: String(wi.LeagueID ?? 0),
    night: String(wi.WeekendOptions?.TimeOfDay ?? ''),
    team: teamRacing ? 'True' : 'False',
    numbers: loadNumTextures ? 'True' : 'False',
    user: String(me?.UserID ?? ''),
  };
  return { form, key: JSON.stringify(form), drivers, teamRacing, myCarIdx: di.DriverCarIdx, myUserId: String(me?.UserID ?? '') };
}

// Своя машина первой, дальше в порядке пилотов сессии
function orderCars(cars, req) {
  const me = req.drivers.find((d) => d.CarIdx === req.myCarIdx);
  const rank = (car) => {
    const i = req.drivers.findIndex((d) => matches(d, car, req.teamRacing));
    if (me && matches(me, car, req.teamRacing)) return -1;
    return i < 0 ? 1e9 : i;
  };
  return [...cars].sort((a, b) => rank(a) - rank(b));
}

function matches(d, car, teamRacing) {
  if (teamRacing && CAR_TYPES.includes(String(car.type)) && String(d.TeamID) === String(car.teamid)) return true;
  return String(d.UserID) === String(car.userid);
}

function findDriver(drivers, car, teamRacing) {
  return drivers.find((d) => matches(d, car, teamRacing)) || null;
}

function formatBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const e = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  return `${(n / 1024 ** e).toFixed(e ? 1 : 0)}${u[e]}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { TradingPaints, buildRequest, DEFAULT_SETTINGS, formatBytes };
