// Отдельный процесс для чтения файлов телеметрии (Electron utilityProcess): файл .ibt бывает в сотни мегабайт,
// и разбор в главном процессе подвесил бы оверлеи. Главный процесс шлёт { id, op, file, lap }, мы отвечаем { id, ok, data | error }.
//   op 'summary' — описание файла и список кругов (без рядов);
//   op 'lap'     — ряды одного круга.
// Последние прочитанные файлы держим в памяти: круги одного файла обычно смотрят подряд.
const S = require('./session');

const cache = new Map();
const KEEP = 3;

async function session(file) {
  if (cache.has(file)) {
    const s = cache.get(file);
    cache.delete(file);
    cache.set(file, s);
    return s;
  }
  const s = await S.load(file);
  cache.set(file, s);
  while (cache.size > KEEP) cache.delete(cache.keys().next().value);
  return s;
}

const lapInfo = (l, i) => ({ index: i, num: l.num, time: l.time, complete: l.complete, valid: l.valid, pit: l.pit, off: l.off, inc: l.inc });

async function handle(msg) {
  if (msg.op === 'summary') {
    const info = await S.describe(msg.file);
    const s = await session(msg.file);
    return { ...info, trackLength: s.meta.trackLength, sectors: s.meta.sectors, laps: s.laps.map(lapInfo) };
  }
  if (msg.op === 'lap') {
    const s = await session(msg.file);
    const lap = S.lapSlice(s, msg.lap);
    if (!lap) throw new Error('круг не найден');
    return { ...lap, lap: lapInfo(lap.lap, msg.lap) };
  }
  if (msg.op === 'track') {
    const s = await session(msg.file);
    return { ...S.trackModel(s), trackLength: s.meta.trackLength, sectors: s.meta.sectors, source: s.meta.source };
  }
  throw new Error(`неизвестная операция ${msg.op}`);
}

process.parentPort.on('message', async (e) => {
  const msg = e.data || {};
  try {
    process.parentPort.postMessage({ id: msg.id, ok: true, data: await handle(msg) });
  } catch (err) {
    process.parentPort.postMessage({ id: msg.id, ok: false, error: String(err?.message || err) });
  }
});
