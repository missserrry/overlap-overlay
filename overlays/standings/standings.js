import { connect, setupPage, createFitter, esc, fmtIrating, fmtClock, fmtDuration, onColumnsChange, onSizesChange, onDecimalsChange, onLicModeChange, getSplit, deliverSplit, onSplit, onStandingsChange } from '/common/overlay.js';
import { DEFS, buildLevels, cellHtml, currentColumns, headOf, secView, onColumns, rowScale, setColumns, setSizes, setDecimals, setLicMode, sizeOf, sizesKey } from '/common/columns.js';
import { fitBar, initHf, renderBar } from '/common/hf.js';

setupPage();
const $ = (id) => document.getElementById(id);
const root = $('root');   // строка из левой и правой частей
const wrap = $('wrap');   // всё вместе: шапка, таблица, подвал

// Уровни по ширине: от полного набора колонок к минимальному (порядок ухода — приоритет колонок в columns.js)
const levels = [];
function rebuildLevels() {
  levels.length = 0;
  levels.push(...buildLevels('standings', currentColumns('standings')));
}
rebuildLevels();

let model = null;
let windowCfg = { min: 3, max: null };
onStandingsChange((cfg) => { windowCfg = { min: 3, max: null, ...cfg }; if (model?.classes?.length) { fitter.invalidate(); fitter.fit(); } });
const hf = initHf('standings', () => { if (model?.classes?.length) { fitter.invalidate(); fitter.fit(); } });
const fitter = createFitter({
  root: wrap, levels, render, minRows: 3,
  key: () => (model ? `${model.multiClass}|${model.kind}|${sizesKey()}` : ''),
  after: () => { distribute(); fitBar($('hdr')); fitBar($('foot')); },
});
onColumns(() => { rebuildLevels(); fitter.invalidate(); if (model?.classes?.length) fitter.fit(); });
onColumnsChange(setColumns);
onSizesChange((s) => { if (setSizes(s)) { fitter.invalidate(); if (model?.classes?.length) fitter.fit(); } });
onLicModeChange((m) => { if (setLicMode(m)) { fitter.invalidate(); if (model?.classes?.length) fitter.fit(); } });
onDecimalsChange((d) => { if (setDecimals(d)) { fitter.invalidate(); if (model?.classes?.length) fitter.fit(); } }); // после onColumns: колонки из адреса приходят сразу

connect('standings', (msg) => {
  model = msg.data;
  if (!model || !model.classes?.length) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  fitter.fit();
});

function render(level, budget) {
  const m = model;
  rowScale(level.cols);
  renderBar($('hdr'), hf.ids('header'), m.info);
  renderBar($('foot'), hf.ids('footer'), m.info);
  const mainIds = level.cols.filter((id) => DEFS[id].zone === 'main' && id !== 'delta');
  const sideIds = level.cols.filter((id) => DEFS[id].zone === 'side');
  $('rightPanel').classList.toggle('hidden', !sideIds.length);
  $('spacer').classList.toggle('hidden', !sideIds.length);
  const sec = secView(m.secInfo);
  $('cols').innerHTML = sideIds.map((id) => `<span class="c-h${id === sideIds[0] ? ' first' : ''}" style="--w:${(DEFS[id].w * sizeOf(id)).toFixed(2)}em">${headOf(id, sec)}</span>`).join('');
  const ctx = { overlay: 'standings', showDelta: level.cols.includes('delta') && m.kind === 'race', sec };
  let left = '', right = '';
  for (const c of sliceClasses(m, budget)) {
    if (m.multiClass) {
      left += `<div class="class-head" style="--cls:${esc(c.color)}"><span class="cname">${esc(c.name)}</span><span>SOF ${fmtIrating(c.sof)}</span><span>${c.drivers} cars</span></div>`;
      right += `<div class="class-head-r"></div>`;
    }
    let i = 0;
    for (const r of c.rows) {
      if (r.separator) { left += '<div class="sep"></div>'; right += '<div class="sep"></div>'; continue; }
      const cls = ['row'];
      if (r.isPlayer) cls.push('player');
      if (r.onPitRoad) cls.push('pit');
      if (!r.inWorld) cls.push('out');
      // чередование фона внутри класса считаем сами: в левой и правой колонке оно должно совпадать
      const bg = r.isPlayer ? '' : (i++ % 2 ? ' style="background:var(--bg-row-alt)"' : ' style="background:none"');
      left += `<div class="${cls.join(' ')}"${bg}>${mainIds.map((id) => cellHtml(id, r, ctx)).join('')}</div>`;
      right += `<div class="${cls.join(' ')}"${bg}>${sideIds.map((id) => cellHtml(id, r, ctx)).join('')}</div>`;
    }
  }
  $('left').innerHTML = left;
  $('right').innerHTML = right;
}

// Сколько строк каждому классу при бюджете budget:
//   свой класс — лидеры + окно вокруг вас; другие классы — топ-3, при нехватке места топ-2, затем только лидер.
//   Лидер каждого класса виден всегда.
function sliceClasses(m, budget) {
  const classes = m.classes;
  const head = m.multiClass ? 0.8 : 0; // заголовок класса занимает примерно 0.8 строки
  const mine = classes.find((c) => c.rows.some((r) => r.isPlayer));

  if (!mine) {
    // не в гонке (зритель): делим поровну
    const per = Math.max(Math.floor((budget - head * classes.length) / classes.length), 1);
    return classes.map((c) => ({ ...c, rows: c.rows.slice(0, per) }));
  }

  const others = classes.filter((c) => c !== mine);
  let k = 3, own = 0;
  for (; k >= 1; k--) {
    const used = others.reduce((s, c) => s + head + Math.min(k, c.rows.length), 0);
    own = Math.floor(budget - used - head);
    if (own >= Math.min(5, mine.rows.length) || k === 1) break;
  }
  return classes
    .map((c) => (c === mine ? { ...c, rows: aroundPlayer(c.rows, Math.max(own, 2)) } : { ...c, rows: c.rows.slice(0, k) }))
    .filter((c) => c.rows.length);
}

function aroundPlayer(rows, n) {
  const p = rows.findIndex((r) => r.isPlayer);
  if (p < 0) return rows.slice(0, n);
  const below = Math.min(Math.max(0, Math.floor(windowCfg.min || 0)), n - 1, rows.length - p - 1);
  const maxBelow = windowCfg.max == null ? n - 1 : Math.max(below, Math.floor(windowCfg.max));
  const choose = (win) => {
    const want = Math.min(maxBelow, Math.max(below, Math.floor((win - 1) / 2)), win - 1);
    return Math.max(0, Math.min(p - (win - 1 - want), rows.length - win, p));
  };
  let start = choose(n);
  const lead = start > 0 ? (n >= 8 ? 3 : n >= 2 ? 1 : 0) : 0;
  if (!lead || p < lead) return rows.slice(start, Math.min(start + n, p + 1 + maxBelow));
  const win = n - lead;
  start = Math.max(lead, choose(win));
  const out = rows.slice(0, lead);
  if (start > lead) out.push({ separator: true });
  return out.concat(rows.slice(start, Math.min(start + win, p + 1 + maxBelow)));
}

function gapText(g) {
  if (!g || g.type === 'leader' || g.type === 'none') return '-';
  if (g.type === 'laps') return `${g.value}L`;
  return g.value.toFixed(1);
}

// Лишняя ширина (окно шире, чем нужно при заданном масштабе) делится так: сначала растягивается правая панель —
// её колонки становятся шире, но не больше чем на RIGHT_STRETCH от своей ширины, — и только потом левая:
// имя забирает остаток, и между фамилией и плашками растёт разрыв.
const RIGHT_STRETCH = 0.6;
const rightPanel = $('rightPanel'), leftPanel = root.querySelector('.panel.left');
let distSig = '', natural = null;
function distribute() {
  if (rightPanel.classList.contains('hidden')) { rightPanel.style.removeProperty('--sx'); placeHandle(); return; }
  const sideCount = rightPanel.querySelectorAll('#cols .c-h').length;
  const sig = `${sizesKey()}|${[...rightPanel.querySelectorAll('#cols .c-h')].map((x) => x.textContent).join()}|${model?.multiClass}|${getComputedStyle(document.documentElement).fontSize}|${leftPanel.querySelector('.row')?.children.length}`;
  if (sig !== distSig || !natural) {
    // естественные ширины панелей: как при замере (имя минимальной ширины, ничего не растянуто)
    rightPanel.style.setProperty('--sx', '0px');
    document.body.classList.add('measure');
    natural = { left: leftPanel.offsetWidth, right: rightPanel.offsetWidth };
    document.body.classList.remove('measure');
    distSig = sig;
  }
  const gap = parseFloat(getComputedStyle(root).columnGap) || 0;
  const total = root.clientWidth;
  const split = getSplit();
  let grow;
  if (split == null) {
    const extra = total - gap - natural.left - natural.right;
    grow = Math.max(Math.min(extra, natural.right * RIGHT_STRETCH), 0);
  } else {
    // разделитель поставлен вручную: правой части — то, что осталось от доли левой, но не меньше её естественной ширины
    const right = Math.min(Math.max(total - gap - split * total, natural.right), Math.max(total - gap - natural.left, natural.right));
    grow = Math.max(right - natural.right, 0);
  }
  rightPanel.style.setProperty('--sx', `${(grow / sideCount).toFixed(2)}px`);
  placeHandle(gap);
}

// Разделитель: виден в режиме редактирования, тянется мышью; положение сохраняется в настройках оверлея
const handle = document.createElement('div');
handle.className = 'split-handle';
handle.title = 'Потяните, чтобы изменить ширину левой и правой части (двойной щелчок — авто)';
handle.innerHTML = '<i></i>';
root.appendChild(handle);
function placeHandle(gap = parseFloat(getComputedStyle(root).columnGap) || 0) {
  if (rightPanel.classList.contains('hidden')) { handle.style.display = 'none'; return; }
  handle.style.display = '';
  handle.style.left = `${leftPanel.offsetWidth + gap / 2}px`;
}
onSplit(() => distribute());
handle.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault(); e.stopPropagation(); // не двигаем окно, пока тянем разделитель
  handle.setPointerCapture(e.pointerId);
  const move = (ev) => deliverSplit(ev.clientX / window.innerWidth);
  const end = () => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', end);
    handle.removeEventListener('lostpointercapture', end);
    window.overlayBridge?.setSplit(getSplit());
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', end);
  handle.addEventListener('lostpointercapture', end);
});
handle.addEventListener('dblclick', (e) => { e.stopPropagation(); deliverSplit(null); window.overlayBridge?.setSplit(null); });
