import { connect, setupPage, createFitter, esc, fmtIrating, fmtClock, fmtDuration, onColumnsChange, onSizesChange, onDecimalsChange, onRelChange } from '/common/overlay.js';
import { buildLevels, cellHtml, currentColumns, onColumns, rowScale, setColumns, setSizes, setDecimals, sizesKey } from '/common/columns.js';
import { fitBar, initHf, renderBar } from '/common/hf.js';

setupPage();
const $ = (id) => document.getElementById(id);
const panel = $('panel');

// Уровни по ширине: от полного набора колонок к минимальному (порядок ухода — приоритет колонок в columns.js)
const levels = [];
function rebuildLevels() {
  levels.length = 0;
  levels.push(...buildLevels('relative', currentColumns('relative')));
}
rebuildLevels();

let model = null;
const hf = initHf('relative', () => { if (model?.rows?.length) { fitter.invalidate(); fitter.fit(); } });
const fitter = createFitter({ root: panel, levels, render, minRows: 3, key: sizesKey, after: () => { fitBar($('hdr')); fitBar($('foot')); } });
onColumns(() => { rebuildLevels(); fitter.invalidate(); if (model?.rows?.length) fitter.fit(); });
onColumnsChange(setColumns);
// Оформление: круговые обводкой или заливкой, подписи кругов, мигание угрозы
let rel = { ring: true, label: true, pulse: true, pulseSec: 5 };
onRelChange((s) => {
  rel = { ...rel, ...s };
  document.body.classList.toggle('lap-ring', !!rel.ring);
  fitter.invalidate();
  if (model?.rows?.length) fitter.fit();
});
document.body.classList.add('lap-ring');
onSizesChange((s) => { if (setSizes(s)) { fitter.invalidate(); if (model?.rows?.length) fitter.fit(); } });
onDecimalsChange((d) => { if (setDecimals(d)) { fitter.invalidate(); if (model?.rows?.length) fitter.fit(); } }); // после onColumns: колонки из адреса приходят сразу

connect('relative', (msg) => {
  model = msg.data;
  if (!model || !model.rows?.length) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  fitter.fit();
});

function render(level, rows) {
  const m = model;
  rowScale(level.cols);
  renderBar($('hdr'), hf.ids('header'), m.info);
  renderBar($('foot'), hf.ids('footer'), m.info);

  // колонка «Класс» нужна, только когда в списке больше одного класса
  const shown = pickRows(m.rows, rows);
  const multi = new Set(m.rows.map((r) => r.classColor)).size > 1;
  const cols = multi ? level.cols : level.cols.filter((id) => id !== 'cls');
  const lv = cols === level.cols ? level : { ...level, cols };
  // общая ширина ячейки отрыва, если у кого-то есть подпись круга: столбец остаётся ровным
  const wide = rel.label && shown.some((r) => r.lapDiff);
  $('rows').innerHTML = shown.map((r) => rowHtml(r, m, lv, wide)).join('');
}

// Оставить n строк так, чтобы своя машина была посередине (если сверху/снизу не хватает — добираем с другой стороны)
function pickRows(all, n) {
  const p = all.findIndex((r) => r.isPlayer);
  if (p < 0 || n >= all.length) return all.slice(0, n);
  let ahead = Math.floor((n - 1) / 2);
  let behind = n - 1 - ahead;
  const haveAhead = p, haveBehind = all.length - p - 1;
  if (ahead > haveAhead) { behind += ahead - haveAhead; ahead = haveAhead; }
  if (behind > haveBehind) { ahead = Math.min(haveAhead, ahead + behind - haveBehind); behind = haveBehind; }
  return all.slice(p - ahead, p + behind + 1);
}

function rowHtml(r, m, level, wide) {
  const cls = ['row'];
  if (r.isPlayer) cls.push('player');
  if (r.onPitRoad) cls.push('pit');
  if (r.lapState === 'ahead') cls.push('lap-ahead');
  if (r.lapState === 'behind') cls.push('lap-behind');
  // угроза: машина на круг впереди вас догоняет сзади и уже близко
  if (rel.pulse && r.lapState === 'ahead' && r.behind && r.gap < rel.pulseSec) cls.push('threat');
  const ctx = { overlay: 'relative', showDelta: level.cols.includes('delta') && m.kind === 'race', wideGap: wide, lapLabel: rel.label };
  return `<div class="${cls.join(' ')}">${level.cols.filter((id) => id !== 'delta').map((id) => cellHtml(id, r, ctx)).join('')}</div>`;
}
