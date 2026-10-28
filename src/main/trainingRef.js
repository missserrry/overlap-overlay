// Эталонный круг режима «Тренировка»: пользователь сам выбирает файл телеметрии (.duckdb LMU, MoTeC .ld, .ibt iRacing или архив с ними),
// мы берём из него быстрейший круг, считаем зоны торможения и отдаём модели оверлея «Торможение».
// В настройках хранится только описание (cfg.training.ref); сам круг при запуске читается из файла заново.
const path = require('path');
const fs = require('fs');
const { dialog } = require('electron');
const { library } = require('./telemetryWindow');
const T = require('../model/training');
const { resetBrakeZone } = require('../model/brakezone');
const logger = require('./logger');

const log = (m, level = 'INFO') => logger.write(level, `[training] ${m}`);

class TrainingRef {
  /**
   * @param {object} o
   * @param {object} o.cfg
   * @param {(ref: object|null) => void} o.setRef  передать эталон серверу телеметрии
   * @param {() => void} o.onChange  описание эталона поменялось (сохранить, перерисовать панель)
   * @param {() => any} o.parent  окно для диалога выбора файла
   */
  constructor({ cfg, setRef, onChange, parent }) {
    Object.assign(this, { cfg, setRef, onChange, parent });
    this.busy = false;
    this.error = '';
  }

  get t() { return this.cfg.training; }

  // Диалог выбора файла → в «Эталоны» библиотеки (копия, архивы распаковываются) → быстрейший круг
  async pick() {
    const lib = library();
    const r = await dialog.showOpenDialog(this.parent() || undefined, {
      title: 'Эталонный круг: файл телеметрии',
      defaultPath: lib.refsDir,
      properties: ['openFile'],
      filters: [{ name: 'Телеметрия и архивы с ней', extensions: ['duckdb', 'ibt', 'ld', 'zip', '7z', 'rar'] }],
    });
    if (r.canceled || !r.filePaths.length) return log('выбор эталона отменён');
    return this.load(r.filePaths, 'диалог');
  }

  // Файлы из диалога или с рабочего стола (перетаскивание): в библиотеку эталонов, из первого подошедшего берём быстрейший круг
  async load(paths, how) {
    const lib = library();
    paths = (paths || []).filter((p) => typeof p === 'string' && p);
    if (!paths.length) return;
    log(`выбран файл (${how}): ${paths.join(', ')}`);
    this.busy = true; this.error = ''; this.onChange();
    try {
      const { added, skipped } = await lib.importFiles(paths);
      if (!added.length) throw new Error(skipped.length ? `в «${skipped[0]}» телеметрии не нашлось` : 'файл не подошёл');
      log(`в библиотеке эталонов: ${added.join(', ')}${skipped.length ? `; пропущено: ${skipped.join(', ')}` : ''}`);
      await this.useFile(added[0]);
    } catch (e) {
      this.error = e.message;
      log(`эталон не выбран: ${e.stack || e.message}`, 'ERROR');
    } finally {
      this.busy = false;
      this.onChange();
    }
  }

  async useFile(file) {
    const t0 = Date.now();
    const found = await library().bestLap(file);
    if (!found) throw new Error('в файле нет ни одного полного круга');
    const { summary, lap } = found;
    log(`в файле ${summary.laps.length} кругов (засчитанных ${summary.laps.filter((l) => l.valid).length}), лучший: №${lap.num} (индекс ${lap.index}), ${lap.time} с, валиден=${lap.valid}; трасса «${summary.track}», машина «${summary.car}», длина ${Math.round(summary.trackLength)} м`);
    const data = await library().lap(file, lap.index);
    if (!data?.dist?.length) throw new Error('в круге нет данных по дистанции');
    const ref = T.buildReference(data, summary.trackLength);
    if (!ref.zones.length) throw new Error('на круге не нашлось торможений');
    resetBrakeZone();
    this.setRef(ref);
    log(`эталон готов за ${Date.now() - t0} мс: зон ${ref.zones.length}, точек в круге ${data.dist.length}`);
    this.t.ref = { file, lapIndex: lap.index, time: lap.time, car: summary.car || '', track: summary.track || '', length: ref.length, zones: ref.zones.length, laps: summary.laps.length };
  }

  // При запуске приложения: тот же файл, тот же круг
  async restore() {
    const d = this.t.ref;
    if (!d) return;
    log(`восстанавливаю эталон: ${d.file}, круг ${d.lapIndex}`);
    if (!fs.existsSync(d.file)) { log('файл эталона не найден', 'WARN'); this.error = `файл эталона не найден: ${path.basename(d.file)}`; return this.onChange(); }
    this.busy = true; this.onChange();
    try {
      const data = await library().lap(d.file, d.lapIndex);
      const sum = await library().call({ op: 'summary', file: d.file });
      const ref = T.buildReference(data, sum.trackLength);
      resetBrakeZone();
      this.setRef(ref);
    } catch (e) {
      this.error = `эталон не прочитан: ${e.message}`;
      log(`${this.error}
${e.stack || ''}`, 'ERROR');
    } finally {
      this.busy = false;
      this.onChange();
    }
  }

  clear() {
    log('эталон убран');
    this.t.ref = null;
    this.error = '';
    resetBrakeZone();
    this.setRef(null);
    this.onChange();
  }

  snapshot() { return { busy: this.busy, error: this.error }; }
}

module.exports = { TrainingRef };
