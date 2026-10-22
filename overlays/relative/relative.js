import { connect, setupPage, createFitter, esc, fmtIrating, fmtClock, fmtDuration, onColumnsChange } from '/common/overlay.js';
import { buildLevels, cellHtml, currentColumns, onColumns, setColumns } from '/common/columns.js';
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
const fitter = createFitter({ root: panel, levels, render, minRows: 3, after: () => { fitBar($('hdr')); fitBar($('foot')); } });
onColumns(() => { rebuildLevels(); fitter.invalidate(); if (model?.rows?.length) fitter.fit(); });
onColumnsChange(setColumns); // после onColumns: колонки из адреса приходят сразу

connect('relative', (msg) => {
  model = msg.data;
  if (!model || !model.rows?.length) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  fitter.fit();
});

function render(level, rows) {
  const m = model;
  renderBar($('hdr'), hf.ids('header'), m.info);
  renderBar($('foot'), hf.ids('footer'), m.info);

  $('rows').innerHTML = pickRows(m.rows, rows).map((r) => rowHtml(r, m, level)).join('');
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

function rowHtml(r, m, level) {
  const cls = ['row'];
  if (r.isPlayer) cls.push('player');
  if (r.onPitRoad) cls.push('pit');
  if (r.lapState === 'ahead') cls.push('lap-ahead');
  if (r.lapState === 'behind') cls.push('lap-behind');
  const ctx = { overlay: 'relative', showDelta: level.cols.includes('delta') && m.kind === 'race' };
  return `<div class="${cls.join(' ')}">${level.cols.filter((id) => id !== 'delta').map((id) => cellHtml(id, r, ctx)).join('')}</div>`;
}
