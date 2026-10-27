// Разовое дополнение таблицы src/model/srCornersConfigs.json: число номеров поворотов на картах трасс (карты конфигураций с вики iRacing
// и из приложения iRacing). Запуск: node scripts/add-config-corners.js — добавляет трассы из списка ниже (уже записанные обновляет).
// Ключ в файле: «название трассы|конфигурация» без регистра и знаков; конфигурации сравниваем по смыслу (without/w/out, with/w/).
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'src', 'model', 'srCornersConfigs.json');

const DATA = {
  'Autodromo Nazionale Monza': { 'Grand Prix': 11, 'GP Without First Chicane': 9, 'GP Without Chicanes': 7, 'Combined': 13, 'Combined Without First Chicane': 11, 'Combined Without Chicanes': 10, 'Junior': 4, 'Oval - Right Turning': 4, 'Oval - Left Turning': 4 },
  'Suzuka International Racing Course': { 'Grand Prix': 17, 'Moto': 17, 'East': 8, 'West': 10, 'West w/ Chicane': 10 },
  'Circuit de Barcelona Catalunya': { 'Grand Prix': 16, 'National': 11, 'Club': 7, 'Moto': 16, 'Historic': 13 },
  'Silverstone Circuit': { 'Grand Prix': 18, 'International': 9, 'National': 6 },
  'Road Atlanta': { 'Full Course': 13, 'Club': 14, 'Short': 10 },
  'Watkins Glen International': { 'Cup': 7, 'Boot': 11, 'Classic Boot': 11 },
  'Auto Club Speedway': { 'Oval': 4, 'Competition': 20, 'Moto': 22 },
  'Willow Springs International Raceway': { 'Big Willow': 9 },
  'Long Beach Street Circuit': { 'Street Circuit': 11 },
  'Detroit Grand Prix at Belle Isle': { 'Detroit Grand Prix at Belle Isle': 14 },
};

const key = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
// конфигурации сравниваем по смыслу: w/o, w/out, without → without; w/ → with
const cfgKey = (s) => key(String(s || '').toLowerCase().replace(/w\/\s*out|w\/o|\bwithout\b/g, ' without ').replace(/w\//g, ' with ').replace(/\bwith\s+out\b/g, ' without '));

let cur = { _source: '', tracks: {} };
try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* новый файл */ }
cur._source = 'Число номеров поворотов на картах конфигураций трасс iRacing (карты с вики iRacing и из приложения iRacing), прочитано вручную 2026-10-27. Ключ — «трасса|конфигурация». Карта и данные iRacing иногда расходятся на 1–2 поворота: числа уточняет самонастройка по реальному SR.';
for (const [track, cfgs] of Object.entries(DATA)) for (const [cfg, n] of Object.entries(cfgs)) cur.tracks[`${key(track)}|${cfgKey(cfg)}`] = n;
fs.writeFileSync(file, JSON.stringify(cur, null, 1));
console.log('записей:', Object.keys(cur.tracks).length);
module.exports = { key, cfgKey };
