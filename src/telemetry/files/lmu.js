// Чтение файла телеметрии Le Mans Ultimate (.duckdb, игра пишет их сама с версии 1.2 в UserData\Telemetry).
// Внутри — база DuckDB: по таблице на канал. У каналов с постоянной частотой (список и частота — в channelsList)
// только столбец value, время отсчёта i — начало записи + i / частота. У событий (eventsList) есть ts — время сессии.
// Колёсные каналы — value1..value4. Метаданные (трасса, машина, пилот, сетап) — в таблице metadata (key, value).
const fs = require('fs');
const os = require('os');
const path = require('path');

let duck = null;
const duckdb = () => (duck ||= require('@duckdb/node-api'));

// Игра держит файл открытым, пока пишет (рядом лежит .wal). Читаем всегда копию: так не мешаем игре,
// а журнал .wal подтягивается в копию при открытии.
async function withCopy(file, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlap-lmu-'));
  const copy = path.join(dir, 'telemetry.duckdb');
  fs.copyFileSync(file, copy);
  if (fs.existsSync(`${file}.wal`)) fs.copyFileSync(`${file}.wal`, `${copy}.wal`);
  let inst = null, conn = null;
  try {
    inst = await duckdb().DuckDBInstance.create(copy);
    conn = await inst.connect();
    const q = async (sql) => (await conn.runAndReadAll(sql)).getRows();
    return await fn(q);
  } finally {
    try { conn?.closeSync?.(); } catch { /* уже закрыто */ }
    try { inst?.closeSync?.(); } catch { /* уже закрыто */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const ident = (name) => `"${String(name).replace(/"/g, '""')}"`;

async function readMeta(q) {
  const meta = {};
  for (const [k, v] of await q('select key, value from metadata')) meta[k] = v;
  return meta;
}

// Описание для библиотеки: метаданные и круги по событиям (без чтения самих каналов)
async function readLmuInfo(file) {
  return withCopy(file, async (q) => {
    const meta = await readMeta(q);
    const tables = new Set((await q('show tables')).map((r) => r[0]));
    const ev = async (name) => (tables.has(name) ? (await q(`select ts, value from ${ident(name)} order by ts`)).map(([ts, v]) => [Number(ts), Number(v)]) : []);
    const dur = tables.has('GPS Time') ? (await q('select min(value), max(value) from "GPS Time"'))[0].map(Number) : null;
    return { meta, laps: await ev('Lap'), lapTimes: await ev('Lap Time'), span: dur };
  });
}

// Все нужные каналы: постоянные — { freq, values: Float64Array }, события — [[ts, value], ...]
async function readLmuChannels(file, names, events) {
  return withCopy(file, async (q) => {
    const meta = await readMeta(q);
    const tables = new Set((await q('show tables')).map((r) => r[0]));
    const freqs = new Map((await q('select * from channelsList')).map((r) => [r[0], Number(r[1])]));
    const ch = {};
    for (const name of names) {
      if (!tables.has(name) || !freqs.get(name)) continue;
      const rows = await q(`select value from ${ident(name)}`);
      const values = new Float64Array(rows.length);
      for (let i = 0; i < rows.length; i++) values[i] = Number(rows[i][0]);
      ch[name] = { freq: freqs.get(name), values };
    }
    const ev = {};
    for (const name of events) {
      if (!tables.has(name)) continue;
      ev[name] = (await q(`select ts, value from ${ident(name)} order by ts`)).map(([ts, v]) => [Number(ts), Number(v)]);
    }
    return { meta, ch, ev };
  });
}

module.exports = { readLmuInfo, readLmuChannels };
