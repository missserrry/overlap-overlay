// Панель Overlap. Состояние живёт в главном процессе; здесь отрисовка и отправка действий.
// Разделы: Оверлеи (список | настройки | живое превью), Раскладки, Ливреи, Настройки.

const bridge = window.panelBridge;
const $ = (id) => document.getElementById(id);
const act = (a) => bridge.action(a);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const icon = (name, cls = '') => `<i class="ico ${cls}" style="--i:url(/vendor/icons/${name}.svg)"></i>`;
const sw = (attrs, on) => `<label class="sw"><input type="checkbox" ${attrs} ${on ? 'checked' : ''}><i></i></label>`;

const TITLES = { overlays: 'Оверлеи', layouts: 'Раскладки', palette: 'Палитра', liveries: 'Ливреи', settings: 'Настройки' };
const VAR_LABELS = { base: 'Основной набор', practice: 'Практика', qualify: 'Квалификация', race: 'Гонка', spotting: 'Споттинг' };
const SESSION_LABELS = { practice: 'Практика', qualify: 'Квалификация', race: 'Гонка' };
const CAT_LABELS = { sportscar: 'Sports car', formulacar: 'Formula', oval: 'Oval', dirtroad: 'Dirt road', dirtoval: 'Dirt oval' };
// Оверлеи по назначению: так проще найти нужный (в группе не больше пяти)
const OV_GROUPS = [['Таблицы', ['relative', 'standings']], ['Пилотирование', ['dash', 'laps', 'sectors', 'fuel', 'pitlimit']], ['Окружение', ['radar', 'traffic', 'rejoin', 'weather', 'digiflag']]];
const TYPE_INFO = {
  relative: 'Машины рядом с вами на трассе и отрыв до них.',
  standings: 'Таблица по классам: позиции, отрыв, лучший круг.',
  digiflag: 'Светодиодная панель флагов: зелёный, жёлтый, SC, синий, белый, красный, клетчатый, чёрный и другие. Мигает, как настоящие.',
  dash: 'Передача в кольце, точки-лампы оборотов, скорость, график и столбики педалей и нижняя плашка. Все блоки настраиваются.',
  sectors: 'Полоса секторов: каждый сектор заполняется по мере проезда и показывает дельту к эталону. До 5 секторов на экране, остальные прокручиваются.',
  traffic: 'Мультикласс: тонкая плашка с ближайшей машиной быстрого класса сзади и медленного впереди и секундами до встречи. Появляется, только когда есть кого ждать.',
  pitlimit: 'Скорость в питлейне: появляется на въезде в питлейн. Зелёный — лимитер включён или скорость в норме, красный — лимитер выключен и скорость выше лимита. После линии выезда — «Можно ехать».',
  fuel: 'Расчёт топлива: сколько осталось, расход на круг и сколько долить, чтобы доехать до финиша с запасом. Цвет подсказывает, хватает ли топлива.',
  rejoin: 'Помощник выезда: когда вы стоите на трассе, показывает, через сколько секунд вас догонит машина сзади, и подсвечивает, можно ли выезжать.',
  laps: 'Круги: время текущего круга, предикт с дельтой, лучший и прошлый круги, лучший круг лидера класса. Каждый блок включается отдельно.',
  radar: 'Радар вокруг вашей машины: кто рядом по бортам, кто близко спереди и сзади. Цвет и размер меняются с расстоянием.',
  weather: 'Температура трассы, её состояние, осадки и ветер с компасом, который вращается вместе с машиной.',
};

let S = null;          // последнее состояние из главного процесса
let pending = null;    // состояние, пришедшее во время ввода
let view = load('panelView', 'overlays');
let sel = null;        // { layoutId, variation } — какой набор редактируем
let selOv = null;      // выбранный оверлей
let selLayout = null;  // выбранная раскладка в разделе «Раскладки»
let mounted = null;    // какой экран сейчас смонтирован (для постоянного превью и индикатора)
let lastLayoutShown = null;

function load(k, d) { try { return localStorage.getItem(k) || d; } catch { return d; } }
function save(k, v) { try { localStorage.setItem(k, v); } catch { /* не критично */ } }

// ---------- состояние ----------

function setState(s) {
  if (document.activeElement?.matches?.('input[type=range], input[type=text], input[type=number], input[type=color]')) {
    pending = s;
    // цвет тянут пальцем: поля не пересоздаём, но превью обновляем сразу
    if (view === 'palette' && mounted === 'palette') { S = s; renderPalPreview(); }
    else if (view === 'overlays' && mounted === 'overlays') {
      S = s;
      const cur = currentSet().list.find((x) => x.id === selOv);
      if (cur) $('pv')?.contentWindow?.postMessage({ svoyPalette: pvPalette(cur.type) }, location.origin);
    }
    return;
  }
  S = s;
  maybeWhatsNew();
  renderUpdateUi();
  const layouts = S.cfg.layouts;
  if (!sel || !layouts.some((l) => l.id === sel.layoutId)) sel = S.panelSelection || { layoutId: S.active.layoutId, variation: 'base' };
  if (!selLayout || !layouts.some((l) => l.id === selLayout)) selLayout = sel.layoutId;
  render();
}
document.addEventListener('focusout', () => {
  if (!pending) return;
  setTimeout(() => { if (pending) { const p = pending; pending = null; setState(p); } }, 0);
});

const layoutById = (id) => S.cfg.layouts.find((l) => l.id === id);
function currentSet() {
  const l = layoutById(sel.layoutId);
  if (!l) return { layout: null, list: [] };
  const v = sel.variation;
  const list = v === 'base' ? l.overlays : l.variations?.[v]?.enabled ? l.variations[v].overlays : l.overlays;
  return { layout: l, list, variation: v === 'base' || l.variations?.[v]?.enabled ? v : 'base' };
}

// ---------- каркас ----------

function render() {
  $('title').textContent = TITLES[view];
  renderStatus();
  document.querySelectorAll('.rail-btn').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  if (view === 'overlays') renderOverlays();
  else if (view === 'layouts') renderLayouts();
  else if (view === 'palette') renderPalette();
  else if (view === 'liveries') renderLiveries();
  else renderSettings();
}

// Подпись движения: индикатор переезжает к выбранному пункту (translateY), а не появляется заново
function moveIndicator(ind, target, h) {
  if (!ind) return;
  if (!target) { ind.style.opacity = 0; return; }
  const y = target.offsetTop + (target.offsetHeight - h) / 2;
  ind.style.height = `${h}px`;
  ind.style.transform = `translateY(${y}px)`;
  ind.style.opacity = 1;
}

function renderStatus() {
  const sim = S.sim;
  let dot = '', text;
  if (sim.source === 'iracing' && sim.connected) { dot = 'live'; text = sim.car ? `iRacing · ${sim.car}` : 'iRacing подключён'; }
  else if (sim.source === 'demo') text = 'iRacing не в сессии · демо';
  else { dot = 'bad'; text = 'iRacing не запущен'; }
  const editing = !S.cfg.locked;
  // связь — просто текст с точкой; видимость — действие; режим окон — сегментированный переключатель
  $('status').innerHTML = `
    <span class="conn"><span class="dot ${dot}"></span>${esc(text)}</span>
    <button class="btn quiet" data-app-toggle="hiddenAll" title="Ctrl+Shift+H">${icon('eye', 'sm')}${S.cfg.hiddenAll ? 'Показать оверлеи' : 'Скрыть оверлеи'}</button>
    <span class="mode" role="group" aria-label="Режим окон оверлеев" title="Ctrl+Shift+L">
      <button class="${editing ? '' : 'on'}" data-mode="lock">${icon('lock', 'sm')}Закреплены</button>
      <button class="${editing ? 'on' : ''}" data-mode="edit">${icon('move', 'sm')}Редактирование</button>
    </span>`;
}

// ---------- Оверлеи ----------

function renderOverlays() {
  const card = $('card');
  if (mounted !== 'overlays') {
    card.innerHTML = `
      <div class="ov-screen">
        <section class="col"><div class="list"><i class="list-ind" id="listInd"></i><div id="ovList"></div></div></section>
        <section class="col" id="ovSettings"></section>
        <section class="preview" id="ovPreview"><div class="stage" id="stage"></div><span class="state-pill" id="statePill"></span><span class="size-tag mono" id="sizeTag"></span></section>
      </div>`;
    mounted = 'overlays';
    lastPreviewKey = null;
  }
  const { layout, list, variation } = currentSet();
  if (selOv !== 'none' && !list.some((o) => o.id === selOv)) selOv = list[0]?.id ?? null;
  const o = list.find((x) => x.id === selOv) || null;

  // список: что уже в наборе (с переключателем «показывать») и что можно добавить
  const varNote = variation !== 'base' ? `, ${VAR_LABELS[variation].toLowerCase()}` : '';
  // тип, который уже есть в наборе, второй раз не предлагаем (копия — через «Дублировать»)
  const addable = Object.entries(S.types).filter(([t]) => !list.some((x) => x.type === t));
  $('ovList').innerHTML = `
    <div class="group">
      <div class="label"><span>Раскладка</span><button class="btn quiet" style="height:20px;padding:0 4px;font-size:inherit;letter-spacing:inherit" data-goto="layouts" title="Набор раскладки — открыть раскладки">${esc(layout?.name || '—')}${esc(varNote)}</button></div>
      ${list.length ? OV_GROUPS.map(([gt, types]) => {
        const items = list.filter((x) => types.includes(x.type));
        return items.length ? `<div class="sublabel">${gt}</div>${items.map((x) => `
        <div class="row ${x.id === selOv ? 'on' : ''} ${x.enabled ? '' : 'muted'}" data-ov="${x.id}" title="${x.enabled ? 'Показывается' : 'Скрыт — включите переключатель'}">
          <span class="name">${esc(x.name)}</span>
          ${sw(`data-ov-enabled="${x.id}" aria-label="Показывать ${esc(x.name)}"`, x.enabled)}
        </div>`).join('')}` : '';
      }).join('') : '<div class="empty-list">Пока пусто.</div>'}
    </div>
    ${addable.length ? `<div class="group">
      <div class="label">Добавить</div>
      ${addable.map(([t, m]) => `
        <div class="row adder" data-add="${t}" title="${esc(TYPE_INFO[t] || '')}">${icon('plus', 'sm')}<span class="name">${esc(m.title)}</span></div>`).join('')}
    </div>` : ''}`;
  const placeInd = () => moveIndicator($('listInd'), document.querySelector(`#ovList .row[data-ov="${selOv}"]`), 34);
  placeInd();
  requestAnimationFrame(placeInd);
  document.fonts?.ready.then(placeInd);

  renderOverlaySettings(o, layout, variation);
  renderPreview(o);
}

// Вид таблицы (Relative, Standings): сначала то, что включено, ниже расширенное в закрытых блоках
function tableView(o) {
  const cat = S.columnCatalog || {};
  const cols = (o.columns || []).filter((c) => !cat[c.id]?.sub);
  const onCount = cols.filter((c) => c.on).length;
  const rowsOn = columnRows(o, true), rowsOff = columnRows(o, false);
  const offCount = cols.length - onCount;
  return `<div class="block">
        <div class="label">Колонки</div>
        <div class="cols-list" id="colsList">${rowsOn}</div>
        ${offCount ? `<details class="hf-details" data-cfg-details="cols:more" style="margin-top:10px" ${cfgOpen['cols:more'] ? 'open' : ''}>
          <summary><span class="hf-sum">Ещё поля (${offCount})</span>${icon('chevron-down', 'sm')}</summary>
          <div class="cols-list" style="margin-top:8px">${rowsOff}</div>
        </details>` : ''}
        <p class="hint" style="margin-top:8px">Порядок меняется перетаскиванием. В узком окне лишние колонки уходят сами.</p>
      </div>
      ${o.type === 'relative' ? relBlock(o) : ''}
      ${hfBlock(o, 'header')}
      ${hfBlock(o, 'footer')}
      ${sizesBlock(o)}`;
}

// Строки колонок: «прирост iRating» — вложенный переключатель под iRating, в порядок не входит
function columnRows(o, showOn = null) {
  const cat = S.columnCatalog || {};
  const cols = o.columns || [];
  const on = (id) => !!cols.find((c) => c.id === id)?.on;
  const label = (id) => cat[id]?.labelBy?.[o.type] || cat[id]?.label || id;
  return cols.filter((c) => !cat[c.id]?.sub && (showOn == null || !!c.on === showOn)).map((c) => {
    const fixed = cat[c.id]?.fixed;
    const sub = cols.filter((x) => cat[x.id]?.sub === c.id).map((x) =>
      `<div class="col-sub ${c.on ? '' : 'dim'}"><span>${esc(label(x.id))}</span>${sw(`data-col="${x.id}" ${c.on ? '' : 'disabled'}`, on(x.id))}</div>`).join('');
    return `<div class="col-item" draggable="true" data-list="columns" data-col-id="${c.id}">
      <div class="col-row"><span class="grip" title="Перетащить">${icon('grip-vertical', 'sm')}</span><span class="col-name">${esc(label(c.id))}</span>${fixed ? '<span class="col-fixed">всегда</span>' : sw(`data-col="${c.id}" aria-label="${esc(label(c.id))}"`, c.on)}</div>${sub}</div>`;
  }).join('');
}

// Шапка и подвал: список пунктов, перетаскивание и переключатели как у колонок; блок раскрывается
const hfOpen = { header: false, footer: false };
const HF_TITLES = { header: 'Шапка', footer: 'Подвал' };
function hfBlock(o, zone, title = HF_TITLES[zone]) {
  const cat = S.hfCatalog || {};
  const list = o[zone] || [];
  const on = list.filter((c) => c.on).map((c) => cat[c.id]?.label || c.id);
  const rows = list.map((c) => `<div class="col-item" draggable="true" data-list="${zone}" data-col-id="${c.id}">
      <div class="col-row"><span class="grip" title="Перетащить">${icon('grip-vertical', 'sm')}</span><span class="col-name">${esc(cat[c.id]?.label || c.id)}</span><span class="col-grp">${esc(cat[c.id]?.group || '')}</span>${sw(`data-hf="${zone}:${c.id}" aria-label="${esc(cat[c.id]?.label || c.id)}"`, c.on)}</div></div>`).join('');
  return `<div class="block">
    <details class="hf-details" data-hf-details="${zone}" ${hfOpen[zone] ? 'open' : ''}>
      <summary><span class="hf-sum" style="font-weight:600">${title}</span><span class="sum-n">${on.length ? esc(on.join(' · ')) : 'пусто'}</span>${icon('chevron-down', 'sm')}</summary>
      <div class="cols-list" style="margin-top:8px">${rows}</div>
    </details>
  </div>`;
}

// Настройки по схеме из главного процесса (Dash, Sectors): группы раскрываются, элементы — переключатель, ползунок, выбор.
// Каждый элемент помнит, в каком поле оверлея лежит (data-cfg) и под каким ключом (data-k).
const cfgOpen = { 'dash:Что показывать': true, 'sectors:Секторы': true, 'laps:Что показывать': true, 'rejoin:Когда показывать': true, 'fuel:Расчёт': true, 'traffic:Что показывать': true, 'pitlimit:Поведение': true, 'colors:Основные': true };
function schemaBlock(o, field, schema) {
  const v = o[field] || {};
  const ctl = (it) => {
    const val = v[it.key] ?? it.def;
    const at = `data-k="${it.key}"`;
    if (it.type === 'bool') return `<label class="toggle" style="margin-top:10px"><span>${esc(it.label)}</span>${sw(`data-cfg="${field}" ${at}`, !!val)}</label>`;
    if (it.type === 'range') return `<div class="sub-label" style="margin-top:12px">${esc(it.label)}</div><div class="slider"><input class="range" type="range" min="${it.min}" max="${it.max}" step="${it.step}" value="${val}" data-cfg-range="${field}" ${at} aria-label="${esc(it.label)}"><output>${val}${esc(it.unit || '')}</output></div>`;
    return `<div class="sub-label" style="margin-top:12px">${esc(it.label)}</div><select class="field" data-cfg-select="${field}" ${at}>${it.options.map(([id, t]) => `<option value="${id}" ${val === id ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  };
  return (schema || []).map((g) => `<div class="block">
    <details class="hf-details" data-cfg-details="${field}:${esc(g.group)}" ${cfgOpen[`${field}:${g.group}`] ? 'open' : ''}>
      <summary><span class="hf-sum" style="font-weight:600">${esc(g.group)}</span><span class="sum-n">${g.items.length}</span>${icon('chevron-down', 'sm')}</summary>
      <div style="margin-top:4px">${g.items.map(ctl).join('')}</div>
    </details>
  </div>`).join('');
}
const dashBlock = (o) => schemaBlock(o, 'dash', S.dashSchema);
const sectorsBlock = (o) => schemaBlock(o, 'sectors', S.sectorsSchema);
const lapsBlock = (o) => schemaBlock(o, 'laps', S.lapsSchema);
const rejoinBlock = (o) => schemaBlock(o, 'rejoin', S.rejoinSchema);
const trafficBlock = (o) => schemaBlock(o, 'traffic', S.trafficSchema);
const relBlock = (o) => schemaBlock(o, 'rel', S.relSchema);
const fuelBlock = (o) => schemaBlock(o, 'fuel', S.fuelSchema);
// Размер каждого поля таблицы: колонка расширяется вместе с ним, а если окну не хватает ширины, лишние колонки уходят по приоритету
function sizesBlock(o) {
  const cat = S.columnCatalog || {};
  const sz = o.sizes || {};
  const label = (id) => cat[id]?.labelBy?.[o.type] || cat[id]?.label || id;
  const rows = (o.columns || []).filter((c) => !cat[c.id]?.sub).map((c) => {
    const v = sz[c.id] || 100;
    return `<div class="sub-label" style="margin-top:12px;${c.on ? '' : 'opacity:.5'}">${esc(label(c.id))}${c.on ? '' : ' · выключено'}</div><div class="slider"><input class="range" type="range" min="70" max="200" step="5" value="${v}" data-size-range="${c.id}" aria-label="Размер: ${esc(label(c.id))}"><output>${v}%</output></div>`;
  }).join('');
  return `<div class="block">
    <details class="hf-details" data-cfg-details="size:Размер полей" ${cfgOpen['size:Размер полей'] ? 'open' : ''}>
      <summary><span class="hf-sum" style="font-weight:600">Размер полей</span>${icon('chevron-down', 'sm')}</summary>
      <p class="hint" style="margin-top:8px">Увеличьте нужное поле: колонка расширится, строка станет выше. Если в окно всё не помещается, лишние колонки уйдут сами — сначала менее важные.</p>
      ${rows}
      <div class="actions" style="margin:14px 0 0"><button class="btn quiet" data-sizes-reset ${Object.keys(sz).length ? '' : 'disabled'}>${icon('rotate-ccw', 'sm')}Сбросить размеры</button></div>
    </details>
  </div>`;
}

// Подробные цвета оверлея: те же цвета, что в «Палитре», но рядом с самим оверлеем; группы свёрнуты, открыта первая
function colorsBlock(o) {
  const own = palOwn(o.type);
  const groups = palTokens(o.type);
  return `<div class="block">
    <p class="hint">Цвета только для ${esc(S.types[o.type].title)}. Что не изменено здесь, берётся из общей палитры.</p>
  </div>
  ${groups.map((g, i) => {
    const key = `colors:${g.title}`;
    return `<div class="block" style="padding-top:${i ? 12 : 4}px">
      <details class="hf-details" data-cfg-details="${esc(key)}" ${cfgOpen[key] ? 'open' : ''}>
        <summary><span class="hf-sum">${esc(g.title)}</span><span class="sum-n">${g.tokens.filter((t) => own[t.key]).length ? `изменено ${g.tokens.filter((t) => own[t.key]).length}` : plural(g.tokens.length, ['цвет', 'цвета', 'цветов'])}</span>${icon('chevron-down', 'sm')}</summary>
        <div style="margin-top:4px">${g.tokens.map((t) => palField(t, o.type)).join('')}</div>
      </details>
    </div>`;
  }).join('')}
  <div class="actions" style="margin-top:20px"><button class="btn quiet" data-pal-reset-sc="${o.type}" ${Object.keys(own).length ? '' : 'disabled'}>${icon('rotate-ccw', 'sm')}Сбросить цвета оверлея</button></div>`;
}

const pitlimitBlock = (o) => schemaBlock(o, 'pitlimit', S.pitlimitSchema);

// Radar: дальность, прозрачность без машин, цифры и цвет класса
function radarBlock(o) {
  const range = Math.round(o.radarRange ?? 15), idle = Math.round((o.radarIdle ?? 0.35) * 100);
  return `<div class="block">
    <div class="label">Радар</div>
    <div class="sub-label">Дальность</div>
    <div class="slider"><input class="range" type="range" min="8" max="40" step="1" value="${range}" data-ov-range="radarRange" aria-label="Дальность"><output>${range} м</output></div>
    <div class="sub-label" style="margin-top:16px">Прозрачность, когда рядом никого</div>
    <div class="slider"><input class="range" type="range" min="0" max="100" step="5" value="${idle}" data-ov-range="radarIdle" aria-label="Прозрачность без машин"><output>${idle}%</output></div>
    <label class="toggle" style="margin-top:16px"><span>Расстояние цифрами</span>${sw('data-radar-dist', o.radarDist !== false)}</label>
    <label class="toggle" style="margin-top:12px"><span>Цвет класса вместо красного</span>${sw('data-radar-cls', !!o.radarClass)}</label>
    <p class="hint" style="margin-top:10px">Квадратное окно: вписывается по меньшей стороне. Боковые машины определяет споттер iRacing, дуги — расстояние по трассе.</p>
  </div>`;
}

// DigiFlag: вид панели (квадрат или две полосы) и поведение, когда флага нет
function flagBlock(o) {
  const lay = o.flagLayout || 'big';
  const chip = (id, label) => `<button class="chip ${lay === id ? 'on' : ''}" data-flag-layout="${id}" aria-pressed="${lay === id}">${lay === id ? icon('check') : ''}${label}</button>`;
  return `<div class="block">
    <div class="label">Вид панели</div>
    <div class="where" style="grid-template-columns:repeat(2,1fr)">${chip('big', 'Квадрат')}${chip('strip', 'Две полосы')}</div>
    <label class="toggle" style="margin-top:14px"><span>Прятать, когда флага нет</span>${sw('data-hide-empty', !!o.hideEmpty)}</label>
    <p class="hint" style="margin-top:10px">Панель вписывается в окно по меньшей стороне: тяните окно — флаг станет больше или меньше. В превью флаги сменяются сами.</p>
  </div>`;
}

// Карточки оверлея Weather: переключатели и порядок, как у колонок
function cardsBlock(o) {
  const cat = S.weatherCards || {};
  const rows = (o.cards || []).map((c) => `<div class="col-item" draggable="true" data-list="cards" data-col-id="${c.id}">
      <div class="col-row"><span class="grip" title="Перетащить">${icon('grip-vertical', 'sm')}</span><span class="col-name">${esc(cat[c.id]?.label || c.id)}</span>${sw(`data-card="${c.id}" aria-label="${esc(cat[c.id]?.label || c.id)}"`, c.on)}</div></div>`).join('');
  return `<div class="block">
    <div class="label">Карточки</div>
    <div class="cols-list">${rows}</div>
    <p class="hint" style="margin-top:10px">Порядок меняется перетаскиванием. Если окно низкое, нижние карточки скрываются.</p>
  </div>`;
}

let ovTab = load('ovTab', 'main');   // вкладка настроек оверлея: main | view | colors
const OV_TABS = [['main', 'Основное'], ['view', 'Вид'], ['colors', 'Цвета']];
let lastSettingsId = null;
function renderOverlaySettings(o, layout, variation) {
  const box = $('ovSettings');
  if (!o) {
    box.innerHTML = '<div class="settings"><p class="hint">Выберите оверлей в наборе или добавьте новый.</p></div>';
    lastSettingsId = null;
    return;
  }
  const v = o.visibility || {};
  const bg = Math.round((o.bgOpacity ?? 0.8) * 100);
  const cols = o.columns || [];
  const colsOn = cols.filter((c) => c.on).map((c) => c.id);
  const scaleParam = o.autoScale ? 'auto' : (o.scale ?? 1);
  const sc = Math.round((o.scale ?? 1) * 100);
  const url = o.type === 'traffic'
    ? `${location.origin}/traffic/?traffic=${encodeURIComponent(JSON.stringify(o.traffic || {}))}`
    : o.type === 'pitlimit'
    ? `${location.origin}/pitlimit/?pitlimit=${encodeURIComponent(JSON.stringify(o.pitlimit || {}))}`
    : o.type === 'fuel'
    ? `${location.origin}/fuel/?fuel=${encodeURIComponent(JSON.stringify(o.fuel || {}))}`
    : o.type === 'rejoin'
    ? `${location.origin}/rejoin/?rejoin=${encodeURIComponent(JSON.stringify(o.rejoin || {}))}`
    : o.type === 'laps'
    ? `${location.origin}/laps/?laps=${encodeURIComponent(JSON.stringify(o.laps || {}))}`
    : o.type === 'sectors'
    ? `${location.origin}/sectors/?sectors=${encodeURIComponent(JSON.stringify(o.sectors || {}))}`
    : o.type === 'dash'
    ? `${location.origin}/dash/?ftr=${hfOf(o, 'footer')}&scale=${scaleParam}&dash=${encodeURIComponent(JSON.stringify(o.dash || {}))}`
    : o.type === 'radar'
    ? `${location.origin}/radar/?range=${o.radarRange ?? 15}&idle=${o.radarIdle ?? 0.35}&dist=${o.radarDist !== false ? 1 : 0}&cls=${o.radarClass ? 1 : 0}`
    : o.type === 'digiflag'
    ? `${location.origin}/digiflag/?layout=${o.flagLayout || 'big'}&hide=${o.hideEmpty ? 1 : 0}`
    : o.type === 'weather'
    ? `${location.origin}/weather/?cards=${cardsOf(o)}&scale=${scaleParam}`
    : `${location.origin}/${o.type}/?cols=${colsOn.join(',')}&hdr=${hfOf(o, 'header')}&ftr=${hfOf(o, 'footer')}&scale=${scaleParam}${o.split != null ? `&split=${o.split.toFixed(3)}` : ''}`;
  const fresh = lastSettingsId !== o.id;
  lastSettingsId = o.id;
  const where = (key, label, on, tip = '') => `<button class="chip ${on ? 'on' : ''}" data-vis="${key}" aria-pressed="${on}" title="${tip}">${on ? icon('check') : ''}${label}</button>`;
  const NOSCALE = ['digiflag', 'radar', 'sectors', 'laps', 'rejoin', 'fuel', 'pitlimit', 'traffic'].includes(o.type);
  const bWhere = `<div class="block">
        <div class="label">Где показывать</div>
        <div class="where">
          ${where('onTrack', 'За рулём', v.onTrack !== false, 'Вы в машине на трассе, включая питлейн')}
          ${where('inGarage', 'Гараж', !!v.inGarage, 'Вы на экране гаража')}
          ${where('disconnected', 'Без игры', !!v.disconnected, 'Когда iRacing не запущен (демо тоже считается «без игры»)')}
        </div>
      </div>`;
  const bScale = NOSCALE ? '' : `<div class="block">
        <div class="label">Масштаб</div>
        <div class="slider ${o.autoScale ? 'dim' : ''}">
          <input class="range" type="range" min="50" max="250" step="5" value="${sc}" data-ov-range="scale" ${o.autoScale ? 'disabled' : ''} aria-label="Масштаб">
          <output>${sc}%</output>
        </div>
        <label class="toggle" style="margin-top:12px"><span>Подгонять под ширину окна</span>${sw('data-auto-scale', !!o.autoScale)}</label>
      </div>`;
  const bBg = (o.type === 'digiflag' || o.type === 'radar') ? '' : `<div class="block">
        <div class="label">Непрозрачность фона</div>
        <div class="slider">
          <input class="range" type="range" min="0" max="100" step="5" value="${bg}" data-ov-range="bgOpacity" aria-label="Непрозрачность фона">
          <output>${bg}%</output>
        </div>
      </div>`;
  const bSplit = o.type === 'standings' ? `<div class="block">
        <div class="label">Левая часть таблицы<button class="btn quiet copy-btn" data-split-auto ${o.split == null ? 'disabled' : ''} title="Вернуть автоматическое распределение"><span>Авто</span></button></div>
        <div class="slider ${o.split == null ? 'dim' : ''}">
          <input class="range" type="range" min="20" max="80" step="1" value="${Math.round((o.split ?? 0.5) * 100)}" data-ov-range="split" aria-label="Доля левой части">
          <output>${o.split == null ? 'авто' : Math.round(o.split * 100) + '%'}</output>
        </div>
      </div>` : '';
  const bWin = `<div class="block">
        <details class="hf-details" data-cfg-details="win:obs" ${cfgOpen['win:obs'] ? 'open' : ''}>
          <summary><span class="hf-sum">Окно и OBS</span><span class="sum-n">${o.width}×${o.height}</span>${icon('chevron-down', 'sm')}</summary>
          <p class="hint" style="margin-top:8px">Окно ${o.width} × ${o.height}. Размер меняется растягиванием в режиме редактирования.</p>
          <div class="label" style="margin-top:12px">Адрес для OBS<button class="btn quiet copy-btn" data-copy="${esc(url)}" title="Скопировать адрес">${icon('copy', 'sm')}<span>Копировать</span></button></div>
          <div class="urlbox"><div class="field mono" title="${esc(url)}">${esc(url.replace(/^https?:\/\//, ''))}</div></div>
        </details>
      </div>`;
  const bActions = `<div class="actions">
        <button class="btn quiet" data-ov-act="overlay.duplicate">${icon('copy', 'sm')}Дублировать</button>
        <button class="btn danger" data-ov-act="overlay.remove">${icon('trash-2', 'sm')}Удалить</button>
      </div>`;
  if (!OV_TABS.some(([k]) => k === ovTab)) ovTab = 'main';
  const pane = ovTab === 'main' ? bWhere + bScale + bBg + bSplit + bWin + bActions
    : ovTab === 'view' ? (o.type === 'traffic' ? trafficBlock(o) : o.type === 'pitlimit' ? pitlimitBlock(o) : o.type === 'fuel' ? fuelBlock(o) : o.type === 'rejoin' ? rejoinBlock(o) : o.type === 'laps' ? lapsBlock(o) : o.type === 'sectors' ? sectorsBlock(o) : o.type === 'dash' ? dashBlock(o) + hfBlock(o, 'footer', 'Нижняя плашка') : o.type === 'radar' ? radarBlock(o) : o.type === 'digiflag' ? flagBlock(o) : o.type === 'weather' ? cardsBlock(o) : tableView(o))
    : colorsBlock(o);
  box.innerHTML = `
    <div class="settings ${fresh ? 'fade' : ''}">
      <div class="head">
        <input type="text" id="ovName" data-ov-field="name" value="${esc(o.name)}" spellcheck="false" aria-label="Название">
        <button class="btn quiet rename" data-rename title="Переименовать">${icon('pencil', 'sm')}</button>
        <button class="btn quiet" data-ov-close title="Закрыть">${icon('x', 'sm')}</button>
      </div>
      <p class="kind">${esc(TYPE_INFO[o.type] || '')}</p>
      ${o.enabled ? '' : `<div class="state-line"><span title="В игре не показывается"><i class="dot"></i>Выключен</span><button class="btn" data-enable-ov>Включить</button></div>`}
      <div class="tabs ovtabs" role="tablist">${OV_TABS.map(([k, t]) => `<button class="tab ${k === ovTab ? 'on' : ''}" role="tab" aria-selected="${k === ovTab}" data-ov-tab="${k}">${t}</button>`).join('')}</div>
      ${pane}
    </div>`;
}

// Превью — живой оверлей в настоящем размере окна; не пересоздаём iframe без нужды
const cardsOf = (o) => (o.cards || []).filter((c) => c.on).map((c) => c.id).join(',');
const hfOf = (o, zone) => (o[zone] || []).filter((c) => c.on).map((c) => c.id).join(',');
const colsOf = (o) => (o.columns || []).filter((c) => c.on).map((c) => c.id).join(',');
let lastPreviewKey = null;
function renderPreview(o) {
  const stage = $('stage'), tag = $('sizeTag');
  if (!o) { stage.innerHTML = ''; tag.textContent = ''; $('statePill').innerHTML = ''; lastPreviewKey = null; return; }
  const key = `${o.id}|${o.type}`;
  if (key !== lastPreviewKey) {
    stage.innerHTML = `<div class="frame-wrap"><iframe id="pv" title="Превью" src="/${o.type}/?bg=${o.bgOpacity ?? 0.8}&dash=${encodeURIComponent(JSON.stringify(o.dash || {}))}&sectors=${encodeURIComponent(JSON.stringify(o.sectors || {}))}&sizes=${encodeURIComponent(JSON.stringify(o.sizes || {}))}&rel=${encodeURIComponent(JSON.stringify(o.rel || {}))}&traffic=${encodeURIComponent(JSON.stringify(o.traffic || {}))}&palette=${palVarsFor(o.type)}&laps=${encodeURIComponent(JSON.stringify(o.laps || {}))}&rejoin=${encodeURIComponent(JSON.stringify(o.rejoin || {}))}&fuel=${encodeURIComponent(JSON.stringify(o.fuel || {}))}&pitlimit=${encodeURIComponent(JSON.stringify(o.pitlimit || {}))}${o.type === 'rejoin' || o.type === 'pitlimit' || o.type === 'traffic' ? '&force=1' : ''}&layout=${o.flagLayout || 'big'}&hide=${o.hideEmpty ? 1 : 0}&range=${o.radarRange ?? 15}&idle=${o.radarIdle ?? 0.35}&dist=${o.radarDist !== false ? 1 : 0}&cls=${o.radarClass ? 1 : 0}&cols=${colsOf(o)}&cards=${cardsOf(o)}&hdr=${hfOf(o, 'header')}&ftr=${hfOf(o, 'footer')}&scale=${o.autoScale ? 'auto' : (o.scale ?? 1)}${o.split != null ? `&split=${o.split}` : ''}"></iframe></div>`;
    lastPreviewKey = key;
  } else {
    // фон меняем без перезагрузки: оверлей читает --bg
    const doc = $('pv')?.contentDocument;
    doc?.documentElement?.style.setProperty('--bg-a', o.bgOpacity ?? 0.8);
    $('pv')?.contentWindow?.postMessage({ svoyDash: o.dash, svoySectors: o.sectors, svoyLaps: o.laps, svoyRejoin: o.rejoin, svoyFuel: o.fuel, svoyPit: o.pitlimit, svoySizes: o.sizes || {}, svoyRel: o.rel || {}, svoyTraffic: o.traffic || {}, svoyPalette: pvPalette(o.type), svoyFlag: { layout: o.flagLayout || 'big', hide: !!o.hideEmpty, range: o.radarRange ?? 15, idle: o.radarIdle ?? 0.35, dist: o.radarDist !== false, cls: !!o.radarClass }, svoyCards: cardsOf(o).split(',').filter(Boolean), svoyColumns: colsOf(o).split(',').filter(Boolean), svoyHdr: hfOf(o, 'header').split(',').filter(Boolean), svoyFtr: hfOf(o, 'footer').split(',').filter(Boolean), svoyScale: o.autoScale ? null : (o.scale ?? 1), svoySplit: o.split ?? null }, location.origin);
  }
  const pv = $('pv'), wrap = pv.parentElement;
  const box = $('ovPreview').getBoundingClientRect();
  const k = Math.min(1, (box.width - 64) / o.width, (box.height - 64) / o.height);
  pv.style.width = `${o.width}px`;
  pv.style.height = `${o.height}px`;
  pv.style.transform = `scale(${k})`;
  wrap.style.width = `${Math.round(o.width * k)}px`;
  wrap.style.height = `${Math.round(o.height * k)}px`;
  $('ovPreview').classList.toggle('off', !o.enabled);
  $('statePill').innerHTML = o.enabled ? '' : '<i></i>Выключен';
  tag.textContent = `Предпросмотр · ${o.width} × ${o.height}${k < 1 ? ` · ${Math.round(k * 100)}%` : ''}`;
}
window.addEventListener('resize', () => { if (view === 'overlays' && S) renderPreview(currentSet().list.find((x) => x.id === selOv)); });

// ---------- Обновления и «Что нового» ----------
// Описание релиза с GitHub (Markdown): заголовки, жирные строки-подзаголовки, списки, `код`
function mdHtml(src) {
  const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>');
  const isMd = (l) => /^([-*]\s|#{1,4}\s|\*\*)/.test(l);
  const out = [];
  for (const block of String(src || '').replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    if (!lines.some(isMd)) {
      // простой текст без разметки: одна короткая строка — подзаголовок, несколько строк — список
      if (lines.length === 1) out.push(lines[0].length <= 48 && !/[.:]$/.test(lines[0]) ? `<h4>${inline(lines[0])}</h4>` : `<p>${inline(lines[0])}</p>`);
      else out.push(`<ul>${lines.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`);
      continue;
    }
    let list = false;
    for (const line of lines) {
      const li = line.match(/^[-*]\s+(.*)/);
      if (li) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(li[1])}</li>`); continue; }
      if (list) { out.push('</ul>'); list = false; }
      const h = line.match(/^#{1,4}\s+(.*)/) || line.match(/^\*\*([^*]+)\*\*:?$/);
      out.push(h ? `<h4>${inline(h[1])}</h4>` : `<p>${inline(line)}</p>`);
    }
    if (list) out.push('</ul>');
  }
  return out.join('');
}
const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return ''; } };

// Уведомление об обновлении: всплывает карточка → по крестику сворачивается в значок «i» в левой рейке → по значку открывается окно со списком нового
const updActive = () => S.update && ['available', 'manual', 'downloading', 'ready'].includes(S.update.status);
let toastFor = null;   // для какой версии карточка уже показана в этом запуске
let popOpen = false;

const updDismissed = () => load('updDismissed', '') === S.update?.version;

function updBody() {
  const u = S.update;
  const r = (u.releases || []).find((x) => x.version === u.version);
  const notes = r ? (mdHtml(r.body) || '<p class="hint">Описание не добавлено.</p>') : `<p class="hint">${u.releasesError ? 'Не удалось загрузить описание. Его можно прочитать на GitHub.' : 'Загружаю описание…'}</p>`;
  let primary = '';
  if (u.status === 'downloading') primary = `<button class="btn primary" disabled>${icon('download', 'sm')}Загрузка ${u.progress}%</button>`;
  else if (u.status === 'ready') primary = `<button class="btn primary" data-update="update.install">${icon('refresh-cw', 'sm')}Перезапустить и обновить</button>`;
  else if (u.canAuto) primary = `<button class="btn primary" data-update="update.download">${icon('download', 'sm')}Обновить сейчас</button>`;
  const url = r?.url || u.url;
  const link = url ? `<button class="btn" data-update-url="${esc(url)}">${icon('external-link', 'sm')}Открыть на GitHub</button>` : '';
  const bar = u.status === 'downloading' ? `<div class="upd-bar"><i style="width:${u.progress}%"></i></div>` : '';
  const note = u.status === 'ready' ? '<p class="hint">Версия загружена. Приложение перезапустится за несколько секунд, настройки сохранятся.</p>'
    : u.canAuto ? '' : '<p class="hint">Эта сборка не обновляется сама: скачайте новую версию на странице релиза.</p>';
  return `<div class="pop-head"><div><div class="pop-title">Доступна версия ${esc(u.version)}</div><div class="pop-sub">Сейчас установлена ${esc(u.current)}${r ? ` · вышла ${esc(fmtDate(r.date))}` : ''}</div></div><button class="btn quiet" data-upd-close title="Закрыть" aria-label="Закрыть">${icon('x', 'sm')}</button></div>
    <div class="pop-label">Что нового</div><div class="rel-body pop-notes">${notes}</div>${bar}${note}
    <div class="actions" style="margin:14px 0 0">${primary}${link}</div>`;
}

function renderUpdatePop() {
  let pop = document.getElementById('updPop');
  if (!popOpen || !updActive()) { pop?.remove(); return; }
  if (!pop) {
    pop = document.createElement('div');
    pop.id = 'updPop';
    pop.className = 'upd-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Доступно обновление');
    document.body.appendChild(pop);
    pop.innerHTML = updBody();
    pop.animate([{ opacity: 0, transform: 'translate(-12px, 12px) scale(.94)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
    return;
  }
  const notes = pop.querySelector('.pop-notes');
  const top = notes ? notes.scrollTop : 0;
  pop.innerHTML = updBody();
  const n = pop.querySelector('.pop-notes');
  if (n) n.scrollTop = top;
}

// Карточка сворачивается в значок «i»: летит к нему и уменьшается
function dismissToast() {
  const t = document.getElementById('updToast');
  if (!t) return;
  save('updDismissed', S.update?.version || '');
  const to = $('updBtn').getBoundingClientRect(), from = t.getBoundingClientRect();
  const dx = to.left + to.width / 2 - (from.left + from.width / 2), dy = to.top + to.height / 2 - (from.top + from.height / 2);
  t.style.pointerEvents = 'none';
  const anim = t.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translate(${dx}px, ${dy}px) scale(.08)` }], { duration: 520, easing: 'cubic-bezier(.5,0,.2,1)', fill: 'forwards' });
  anim.finished.then(() => {
    t.remove();
    $('updBtn').animate([{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'ease-out' });
  });
}

function renderUpdateUi() {
  const btn = $('updBtn');
  if (!btn) return;
  const on = !!updActive();
  btn.hidden = !on;
  btn.classList.toggle('on', on && popOpen);
  if (!on) { popOpen = false; document.getElementById('updToast')?.remove(); renderUpdatePop(); return; }
  btn.title = `Доступна версия ${S.update.version}`;
  // карточка — один раз на версию, пока пользователь её не закрыл
  if (toastFor !== S.update.version && !updDismissed()) {
    toastFor = S.update.version;
    const t = document.createElement('div');
    t.id = 'updToast';
    t.className = 'upd-toast';
    t.setAttribute('role', 'status');
    t.innerHTML = `<i class="ico" style="--i:url(/vendor/icons/info.svg)"></i><div class="toast-text"><b>Доступна версия ${esc(S.update.version)}</b><span>Нажмите, чтобы посмотреть, что нового</span></div><button class="btn quiet" data-upd-toast-close title="Закрыть" aria-label="Закрыть">${icon('x', 'sm')}</button>`;
    document.body.appendChild(t);
    t.animate([{ opacity: 0, transform: 'translateX(-24px)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  renderUpdatePop();
}

function updateStatusText() {
  const u = S.update;
  if (!u) return '';
  const when = u.checkedAt ? ` Проверено в ${new Date(u.checkedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}.` : '';
  switch (u.status) {
    case 'checking': return 'Проверяю…';
    case 'available': return `Доступна версия ${u.version}.`;
    case 'manual': return `Доступна версия ${u.version}. Эта сборка не обновляется сама — скачайте новую со страницы релиза.`;
    case 'downloading': return `Загрузка ${u.progress}%…`;
    case 'ready': return `Версия ${u.version} загружена. Установится при перезапуске (или при закрытии приложения).`;
    case 'error': return `Не удалось проверить: ${u.error || 'ошибка сети'}`;
    case 'none': return `У вас последняя версия.${when}`;
    default: return '';
  }
}

function updatesBlock() {
  const u = S.update || {};
  const busy = ['checking', 'downloading'].includes(u.status);
  const action = u.status === 'available' && u.canAuto ? `<button class="btn primary" data-update="update.download">${icon('download', 'sm')}Скачать ${esc(u.version)}</button>`
    : u.status === 'ready' ? `<button class="btn primary" data-update="update.install">${icon('refresh-cw', 'sm')}Перезапустить и обновить</button>`
    : (u.status === 'manual' || (u.status === 'available' && !u.canAuto)) ? `<button class="btn primary" data-update-url="${esc(u.url || '')}">${icon('external-link', 'sm')}Страница релиза</button>`
    : `<button class="btn" data-update="update.check" ${busy ? 'disabled' : ''}>${icon('refresh-cw', 'sm')}Проверить обновления</button>`;
  const rel = (u.releases || []).slice(0, 8);
  return `
      <div class="block" style="padding-top:0">
        <div class="label">Обновления</div>
        <div class="kv">
          <span>Установлена версия</span><span class="mono">${esc(u.current || '')}</span>
          <span>Проверять автоматически</span><span>${sw('data-app="autoUpdate"', S.cfg.autoUpdate !== false)}</span>
        </div>
        <div class="actions" style="margin-top:14px;margin-left:0">${action}</div>
        <p class="hint" style="margin-top:12px">${esc(updateStatusText())}</p>
      </div>
      <div class="sep"></div>
      <div class="block">
        <details class="hf-details" data-cfg-details="whatsnew:list" ${cfgOpen['whatsnew:list'] ? 'open' : ''}>
        <summary><span class="hf-sum">Что нового (${rel.length} ${rel.length === 1 ? 'релиз' : 'релизов'})</span>${icon('chevron-down', 'sm')}</summary>
        <div style="margin-top:8px"></div>
        ${rel.length ? rel.map((r, i) => `<details class="rel" ${i === 0 ? 'open' : ''}><summary><span class="rel-v">${esc(r.version)}</span><span class="rel-d">${esc(fmtDate(r.date))}</span>${icon('chevron-down', 'sm')}</summary><div class="rel-body">${mdHtml(r.body) || '<p class="hint">Без описания.</p>'}</div></details>`).join('')
          : `<p class="hint">${u.releasesError ? `Не удалось загрузить список: ${esc(u.releasesError)}` : 'Загружаю список релизов с GitHub…'}</p>`}
        </details>
      </div>
      <div class="sep"></div>`;
}

// Окно «Что нового» после обновления: один раз для каждой установленной версии
function maybeWhatsNew() {
  const u = S.update;
  if (!u || document.getElementById('whatsNew')) return;
  const seen = S.cfg.lastSeenVersion;
  if (!seen || seen === u.current) return;
  const r = (u.releases || []).find((x) => x.version === u.current);
  if (!r) return; // описание ещё не загрузилось; попробуем при следующем обновлении состояния
  const el = document.createElement('div');
  el.id = 'whatsNew';
  el.className = 'modal';
  el.innerHTML = `<div class="modal-box" role="dialog" aria-label="Что нового"><div class="modal-head"><h2>Что нового в ${esc(u.current)}</h2><span class="rel-d">${esc(fmtDate(r.date))}</span></div><div class="rel-body">${mdHtml(r.body) || '<p class="hint">Без описания.</p>'}</div><div class="actions" style="margin:20px 0 0"><button class="btn primary" data-whats-new-ok>Понятно</button></div></div>`;
  document.body.appendChild(el);
}

// ---------- Палитра ----------
let palScope = load('palScope', 'all');   // 'all' или тип оверлея
let palPrev = load('palPrev', 'relative'); // какой оверлей показан в превью, когда выбран «Все»
const palOwn = (scope) => (scope === 'all' ? S.cfg.palette?.all : S.cfg.palette?.types?.[scope]) || {};
const palTokens = (scope) => S.paletteGroups.map((g) => ({ ...g, tokens: g.tokens.filter((t) => scope === 'all' || t.types.includes(scope)) })).filter((g) => g.tokens.length);
const palValue = (t, scope) => palOwn(scope)[t.key] ?? (scope !== 'all' ? S.cfg.palette?.all?.[t.key] : null) ?? t.def;
const palVarsFor = (type) => encodeURIComponent(JSON.stringify(S.paletteVars?.[type] || {}));
const sameValues = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

function palField(t, scope) {
  const own = palOwn(scope)[t.key];
  const val = palValue(t, scope);
  return `<div class="pal-row">
    <span class="pal-name" ${t.hint ? `title="${esc(t.hint)}"` : ''}>${esc(t.label)}</span>
    <input type="color" data-pal-key="${t.key}" data-pal-sc="${scope}" value="${val.toLowerCase()}" aria-label="${esc(t.label)}">
    <input type="text" class="pal-hex mono" data-pal-hex="${t.key}" data-pal-sc="${scope}" value="${val.toUpperCase()}" maxlength="7" spellcheck="false" aria-label="${esc(t.label)}, код цвета">
    <button class="btn quiet ${own ? '' : 'invisible'}" data-pal-clear="${t.key}" data-pal-sc="${scope}" title="Вернуть стандартный" ${own ? '' : 'tabindex="-1"'}>${icon('rotate-ccw', 'sm')}</button>
  </div>`;
}

const TABLE_TYPES = ['relative', 'standings'];

// Подсветка цвета: пока курсор на строке цвета (или идёт правка), в превью все остальные цвета серые
let palFocus = null, palEditing = false;
function pvPalette(type) {
  const base = S.paletteVars?.[type] || {};
  if (!palFocus) return base;
  const out = {};
  for (const g of S.paletteGroups) for (const t of g.tokens) {
    if (!t.types.includes(type)) continue;
    if (t.key === palFocus) Object.assign(out, S.paletteLive?.[type]?.[t.key] || {});
    else if (S.paletteDim?.[t.key]) Object.assign(out, S.paletteDim[t.key]);
  }
  return out;
}
function pushPalette() {
  const type = view === 'palette' ? (palScope === 'all' ? palPrev : palScope) : currentSet().list.find((x) => x.id === selOv)?.type;
  if (type && $('pv')) $('pv').contentWindow?.postMessage({ svoyPalette: pvPalette(type) }, location.origin);
}
function setPalFocus(key) {
  if (palFocus === key) return;
  palFocus = key;
  pushPalette();
  // рамки на элементах этого цвета; пустой список снимает подсветку
  const type = view === 'palette' ? (palScope === 'all' ? palPrev : palScope) : currentSet().list.find((x) => x.id === selOv)?.type;
  $('pv')?.contentWindow?.postMessage({ svoyFocus: key ? { zones: S.paletteSel?.[key] || [], solo: key === 'bg' } : null }, location.origin);
  if (!key) { zoomPreview(null); document.getElementById('palNote')?.remove(); }
}

// Приближение превью к зоне выбранного цвета: габариты зоны присылает сама страница оверлея
function zoomPreview(box) {
  const pv = $('pv'); if (!pv) return;
  const wrap = pv.parentElement, stage = wrap.parentElement;
  const k = parseFloat(/scale\(([\d.]+)\)/.exec(pv.style.transform || '')?.[1]) || 1;
  wrap.style.transformOrigin = '0 0';
  wrap.style.transition = 'transform 260ms cubic-bezier(.2,.8,.2,1)';
  if (!box || !box.w || !box.h || (box.w * box.h) / (box.iw * box.ih) > 0.45) { wrap.style.transform = 'none'; return; }
  const sw = stage.clientWidth, sh = stage.clientHeight;
  const z = Math.min(4, Math.max(1, Math.min((sw * 0.5) / (box.w * k), (sh * 0.45) / (box.h * k))));
  if (z < 1.25) { wrap.style.transform = 'none'; return; }   // зона и так крупная: не двигаем превью
  const cx = (box.x + box.w / 2) * k, cy = (box.y + box.h / 2) * k;
  wrap.style.transform = `translate(${(sw / 2 - wrap.offsetLeft - cx * z).toFixed(1)}px, ${(sh / 2 - wrap.offsetTop - cy * z).toFixed(1)}px) scale(${z.toFixed(3)})`;
}
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || !e.data || !('svoyFocusBox' in e.data)) return;
  if (!palFocus) return;
  zoomPreview(e.data.svoyFocusBox);
  // у этого цвета нет элементов в превью (например, в демо нет такого события): говорим об этом, а не молчим
  const pane = document.querySelector('.preview');
  let note = document.getElementById('palNote');
  if (e.data.svoyFocusEmpty && pane) {
    if (!note) { note = document.createElement('div'); note.id = 'palNote'; note.className = 'pal-note'; pane.appendChild(note); }
    note.textContent = 'В превью сейчас нет элементов этого цвета (в демо они появляются не всегда)';
  } else note?.remove();
});
document.addEventListener('mouseover', (e) => {
  if (palEditing || !S) return;
  const row = e.target.closest?.('.pal-row');
  setPalFocus(row ? row.querySelector('[data-pal-key]')?.dataset.palKey ?? null : null);
});
document.addEventListener('focusin', (e) => {
  const key = e.target.closest?.('.pal-row')?.querySelector('[data-pal-key]')?.dataset.palKey;
  if (key) { palEditing = true; setPalFocus(key); $('pv')?.contentWindow?.postMessage({ svoyFocusPause: true }, location.origin); }
});
document.addEventListener('focusout', (e) => {
  if (!e.target.closest?.('.pal-row')) return;
  palEditing = false;
  $('pv')?.contentWindow?.postMessage({ svoyFocusPause: false }, location.origin);
  setTimeout(() => { if (!document.activeElement?.closest?.('.pal-row')) setPalFocus(null); }, 0);
});
const plural = (n, w) => `${n} ${w[n % 10 === 1 && n % 100 !== 11 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 1 : 2]}`;
let palPreviewKey = null;
function renderPalette() {
  const card = $('card');
  if (mounted !== 'palette') {
    card.innerHTML = `
      <div class="ov-screen">
        <section class="col"><div class="list"><div id="palList"></div></div></section>
        <section class="col" id="palSettings"></section>
        <section class="preview"><div class="pal-types" id="palTypes"></div><div class="stage" id="palStage"></div><span class="size-tag mono" id="palTag"></span></section>
      </div>`;
    mounted = 'palette';
    palPreviewKey = null;
  }
  if (palScope !== 'all' && !S.types[palScope]) palScope = 'all';
  const scope = palScope;
  const own = palOwn(scope);
  const types = Object.entries(S.types);
  const dotOf = (t) => (Object.keys(S.cfg.palette?.types?.[t] || {}).length ? '<i class="pal-dot" title="Своя палитра"></i>' : '');

  $('palList').innerHTML = `
    <div class="group">
      <div class="label">Палитра для</div>
      <div class="row ${scope === 'all' ? 'on' : ''}" data-pal-scope="all"><span class="name">Все оверлеи</span></div>
      ${OV_GROUPS.map(([gt, ids]) => `<div class="sublabel">${gt}</div>${ids.filter((t) => S.types[t]).map((t) => `<div class="row ${scope === t ? 'on' : ''}" data-pal-scope="${t}"><span class="name">${esc(S.types[t].title)}</span>${dotOf(t)}</div>`).join('')}`).join('')}
    </div>`;

  const allTokens = S.paletteGroups.flatMap((g) => g.tokens);
  const quick = scope === 'all' ? ['primary', 'accent'].map((k) => allTokens.find((t) => t.key === k)) : [];
  const relevant = (k) => scope === 'all' || allTokens.some((t) => t.key === k && t.types.includes(scope));
  const presetOn = (p) => sameValues(Object.fromEntries(Object.entries(p.values).filter(([k]) => relevant(k))), own);
  const swatch = (p) => ['primary', 'accent', 'bg', 'good'].map((k) => `<i style="background:${p.values[k] || allTokens.find((t) => t.key === k).def}"></i>`).join('');
  const groups = palTokens(scope);

  $('palSettings').innerHTML = `
    <div class="settings">
      <div class="head"><span class="pal-title">${scope === 'all' ? 'Все оверлеи' : esc(S.types[scope].title)}</span></div>
      <p class="kind">${scope === 'all' ? 'Общие цвета для всех оверлеев. Если у оверлея есть своя палитра — она важнее.' : 'Своя палитра этого оверлея. Что не изменено здесь — берётся из общей палитры.'}</p>

      ${quick.length ? `<div class="block"><div class="label">Быстрая настройка</div>${quick.map((t) => palField(t, scope)).join('')}</div>` : ''}

      <div class="block"><div class="label">Готовые палитры</div>
        <div class="pal-presets">${S.palettePresets.map((p) => `<button class="pal-preset ${presetOn(p) ? 'on' : ''}" data-pal-preset="${p.id}"><span class="pal-sw">${swatch(p)}</span><span>${esc(p.name)}</span></button>`).join('')}</div>
      </div>

      <div class="block"><div class="label">${scope === 'all' ? 'Общие цвета' : 'Подробная настройка'}</div>
        ${scope !== 'all' ? `<p class="hint">Подробные цвета этого оверлея теперь в его настройках, вкладка «Цвета».</p><div class="actions" style="margin:12px 0 0"><button class="btn" data-pal-open="${scope}">${icon('external-link', 'sm')}Открыть настройки ${esc(S.types[scope].title)}</button></div>` : groups.slice(0, 1).map((g) => {
          const rest = g.tokens.filter((t) => !quick.includes(t));
          return rest.length ? `<div class="sub-label pal-group">${esc(g.title)}</div>${rest.map((t) => palField(t, scope)).join('')}` : '';
        }).join('')}
      </div>

      <div class="actions"><button class="btn" data-pal-reset ${Object.keys(own).length || (scope === 'all' && Object.keys(S.cfg.palette?.types || {}).length) ? '' : 'disabled'}>${icon('rotate-ccw', 'sm')}${scope === 'all' ? 'Сбросить всё к стандартным' : 'Сбросить этот оверлей'}</button></div>
    </div>`;
  renderPalPreview();
}

function renderPalPreview() {
  const type = palScope === 'all' ? palPrev : palScope;
  const m = S.types[type];
  $('palTypes').innerHTML = palScope === 'all' ? `<span class="seg">${Object.entries(S.types).map(([t, x]) => `<button class="${t === type ? 'on' : ''}" data-pal-prev="${t}">${esc(x.title)}</button>`).join('')}</span>` : '';
  const stage = $('palStage');
  if (palPreviewKey !== type) {
    stage.innerHTML = `<div class="frame-wrap"><iframe id="pv" title="Превью" src="/${type}/?bg=0.8&scale=1&palette=${palVarsFor(type)}"></iframe></div>`;
    palPreviewKey = type;
  } else {
    $('pv')?.contentWindow?.postMessage({ svoyPalette: pvPalette(type) }, location.origin);
  }
  const pv = $('pv'), wrap = pv.parentElement;
  const box = stage.parentElement.getBoundingClientRect();
  const k = Math.min(1, (box.width - 64) / m.width, (box.height - 120) / m.height);
  pv.style.width = `${m.width}px`; pv.style.height = `${m.height}px`; pv.style.transform = `scale(${k})`;
  wrap.style.width = `${Math.round(m.width * k)}px`; wrap.style.height = `${Math.round(m.height * k)}px`;
  $('palTag').textContent = 'Предпросмотр · демо-данные';
}
window.addEventListener('resize', () => { if (view === 'palette' && S && mounted === 'palette') renderPalPreview(); });

let palTimer = null;
function palSend(key, value, scope = palScope) {
  clearTimeout(palTimer);
  palTimer = setTimeout(() => act({ type: 'palette.set', scope, key, value }), 40);
}

// ---------- Раскладки ----------

function renderLayouts() {
  if (mounted !== 'layouts') {
    $('card').innerHTML = `
      <div class="pane-split">
        <section class="col"><div class="list"><i class="list-ind" id="listInd"></i><div id="lyList"></div></div></section>
        <section class="col" id="lyDetail"></section>
      </div>`;
    mounted = 'layouts';
    lastLayoutShown = null;
  }
  const l = layoutById(selLayout) || S.cfg.layouts[0];
  selLayout = l.id;
  const isActive = l.id === S.active.layoutId;
  const why = { auto: 'выбрана автоматически', manual: 'включена вручную', default: 'основная' }[S.active.reason];
  const f = l.carFilter;
  const allSessions = l.sessionTypes.includes('all');
  let values = '';
  if (f.type === 'car') {
    values = `<div class="chips" style="margin-top:12px">
      ${f.values.map((v, i) => `<span class="chip on">${esc(v)}<button class="x" data-remove-car="${i}" aria-label="Убрать">${icon('x', 'sm')}</button></span>`).join('')}
      <input class="field" id="carInput" type="text" placeholder="Машина, Enter" style="width:200px;height:30px">
      ${S.sim.connected && S.sim.car && !f.values.includes(S.sim.car) ? `<button class="chip" data-lact="layout.addCurrentCar">${icon('plus', 'sm')}${esc(S.sim.car)}</button>` : ''}
    </div>`;
  } else if (f.type === 'category') {
    values = `<div class="chips" style="margin-top:12px">${S.categories.map((c) => `<button class="chip ${f.values.includes(c) ? 'on' : ''}" data-cat="${c}">${CAT_LABELS[c] || c}</button>`).join('')}</div>`;
  }
  const now = isActive ? S.active.variation : null;

  const fresh = lastLayoutShown !== l.id;
  lastLayoutShown = l.id;
  $('lyList').innerHTML = `
        <div class="group">
          <div class="label">Мои раскладки <button class="btn quiet" data-lact="layout.create" title="Новая раскладка" style="height:24px;padding:0 4px">${icon('plus', 'sm')}</button></div>
          ${S.cfg.layouts.map((x) => `
            <div class="row ${x.id === selLayout ? 'on' : ''}" data-layout="${x.id}">
              <span class="name">${esc(x.name)}</span>
              ${x.id === S.active.layoutId ? '<span class="label" style="padding:0;letter-spacing:.04em">сейчас</span>' : ''}
            </div>`).join('')}
        </div>`;
  $('lyDetail').innerHTML = `
      <div class="page ${fresh ? 'fade' : ''}"><div class="page-inner">
        <div class="settings" style="padding:0">
          <div class="head"><input type="text" data-layout-field="name" value="${esc(l.name)}" spellcheck="false" aria-label="Название раскладки"></div>
          <p class="kind">${isActive ? `Активна — ${why}.` : 'Сейчас не активна.'}</p>
        </div>
        <div class="actions" style="margin-top:16px">
          ${isActive ? '' : `<button class="btn primary" data-lact="layout.activate">Включить сейчас</button>`}
          <button class="btn quiet" data-lact="layout.duplicate">${icon('copy', 'sm')}Дублировать</button>
          <button class="btn danger" data-lact="layout.delete" ${S.cfg.layouts.length <= 1 ? 'disabled' : ''}>${icon('trash-2', 'sm')}Удалить</button>
        </div>

        <div class="block">
          <div class="label">Когда включать</div>
          <div class="seg">${[['all', 'Все машины'], ['car', 'Выбранные машины'], ['category', 'Категория']]
            .map(([t, n]) => `<button data-filter-type="${t}" class="${f.type === t ? 'on' : ''}">${n}</button>`).join('')}</div>
          ${values}
          <div class="chips" style="margin-top:12px">
            <button class="chip ${allSessions ? 'on' : ''}" data-session="all">Все сессии</button>
            ${Object.entries(SESSION_LABELS).map(([k, t]) => `<button class="chip ${!allSessions && l.sessionTypes.includes(k) ? 'on' : ''}" data-session="${k}">${t}</button>`).join('')}
          </div>
          <p class="hint" style="margin-top:12px">Если подходит несколько раскладок, побеждает самая точная: машина важнее категории, выбранная сессия важнее «всех».</p>
        </div>
        <div class="block toggle" style="padding-top:20px">
          <span>Основная — когда ничего не подошло</span>${sw('data-default', l.isDefault)}
        </div>

        <div class="block">
          <div class="label">Наборы оверлеев</div>
          <div class="tabs">${Object.entries(VAR_LABELS).map(([k, t]) => {
            const en = k === 'base' || l.variations?.[k]?.enabled;
            return `<button class="tab ${en ? '' : ''}" data-edit-var="${k}" style="${en ? '' : 'opacity:.55'}">${k === 'base' ? 'Основной' : t}${now === k ? '<span class="note">сейчас</span>' : ''}</button>`;
          }).join('')}</div>
          <p class="hint">Отдельный набор на практику, квалификацию, гонку или споттинг (когда вы не за рулём). Без него используется основной. Нажмите на вкладку, чтобы открыть набор в разделе «Оверлеи».</p>
          <div class="chips" style="margin-top:12px">
            ${['practice', 'qualify', 'race', 'spotting'].map((k) => l.variations?.[k]?.enabled
              ? `<button class="chip on" data-var-off="${k}">${VAR_LABELS[k]} ${icon('x', 'sm')}</button>`
              : `<button class="chip" data-var-on="${k}">${icon('plus', 'sm')}${VAR_LABELS[k]}</button>`).join('')}
          </div>
        </div>
      </div></div>`;
  moveIndicator($('listInd'), document.querySelector(`#lyList .row[data-layout="${selLayout}"]`), 36);
}

// ---------- Ливреи ----------

function renderLiveries() {
  mounted = 'liveries';
  const lv = S.liveries;
  if (!lv) { $('card').innerHTML = ''; return; }
  const s = lv.settings, st = lv.status;
  const busy = st.state !== 'idle';
  const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
  const stateText = { idle: 'Ожидание сессии', fetching: 'Запрос списка', downloading: `Загрузка ${st.done} из ${st.total}` }[st.state] || st.state;
  const oldLog = $('lvLog');
  const stick = !oldLog || oldLog.scrollTop + oldLog.clientHeight >= oldLog.scrollHeight - 8;
  const keepScroll = $('lvPage')?.scrollTop || 0;
  const opt = (k, t, hint) => `<label class="toggle"><span>${t}${hint ? `<br><span class="hint">${hint}</span>` : ''}</span>${sw(`data-lv="${k}"`, s[k])}</label>`;

  $('card').innerHTML = `
    <div class="page" id="lvPage"><div class="page-inner">
      <div class="toggle" style="margin-bottom:8px">
        <span style="font-size:var(--fs-item);font-weight:600">Загружать ливреи Trading Paints</span>${sw('data-lv="enabled"', s.enabled)}
      </div>
      <p class="hint lead">Когда в сессии iRacing меняется состав, приложение спрашивает Trading Paints, какие у пилотов ливреи, качает их в Документы\\iRacing\\paint и сразу просит iRacing перерисовать машины. Настройка сохраняется между запусками.</p>
      ${lv.otherDownloader ? `<div class="warn"><span class="dot"></span><span>Сейчас запущен ${esc(lv.otherDownloader)}. Он качает в те же папки — закройте его или оставьте загрузку здесь выключенной.</span></div>` : ''}

      <div class="block" style="padding-top:0">
        <div class="label">Что загружать</div>
        <div class="toggles">
          ${opt('specMaps', 'Спекулярные карты', 'блеск и металлик, файлы .mip')}
          ${opt('helmets', 'Шлемы и комбинезоны')}
          ${opt('decals', 'Слои декалей')}
          ${opt('myOwn', 'Свою ливрею')}
        </div>
      </div>
      <div class="sep"></div>
      <div class="block">
        <div class="label">Чистка</div>
        <div class="toggle"><span>Удалять ливреи, не встречавшиеся дольше</span>
          <span style="display:flex;align-items:center;gap:8px"><input class="field" style="width:64px;text-align:center" type="number" min="0" max="365" data-lv-num="cleanAfterDays" value="${s.cleanAfterDays}">дней</span></div>
        <p class="hint" style="margin-top:8px">0 — не удалять. Удаляется только то, что скачало это приложение.</p>
      </div>
      <div class="sep"></div>
      <div class="block">
        <div class="label">${esc(stateText)}
          <span style="display:flex;gap:4px">
            <button class="btn quiet" data-lv-act="liveries.refresh" ${s.enabled && !busy ? '' : 'disabled'}>${icon('refresh-cw', 'sm')}Обновить</button>
            <button class="btn quiet" data-lv-act="liveries.openFolder">${icon('folder-open', 'sm')}Папка</button>
          </span>
        </div>
        <div class="progress"><i style="width:${busy ? pct : 0}%"></i></div>
        <div class="stats"><span>В учёте <b>${lv.skins}</b></span>${st.lastFetch ? `<span>Последний запрос <b>${new Date(st.lastFetch).toLocaleTimeString('ru-RU')}</b></span>` : ''}</div>
        <div class="log mono" id="lvLog" style="margin-top:16px">${lv.log.length
          ? lv.log.map((x) => `<div class="${x.level}"><span class="t">${esc(x.t.slice(11))}</span>${esc(x.msg)}</div>`).join('')
          : '<span class="t">Журнал появится, когда iRacing будет в сессии и загрузка включена.</span>'}</div>
      </div>
    </div></div>`;
  $('lvPage').scrollTop = keepScroll;
  const log = $('lvLog');
  if (stick) log.scrollTop = log.scrollHeight;
}

// ---------- Настройки ----------

function renderSettings() {
  mounted = 'settings';
  const c = S.cfg;
  $('card').innerHTML = `
    <div class="page fade"><div class="page-inner">
      ${updatesBlock()}
      <div class="block">
        <div class="label">Данные</div>
        <div class="kv">
          <span>Демо-гонка</span>
          <select class="field" data-app="demo" style="max-width:280px">
            ${[['auto', 'Пока iRacing не в сессии'], ['on', 'Всегда'], ['off', 'Никогда']].map(([v, t]) => `<option value="${v}" ${c.demo === v ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
          <span>Автовыбор раскладки</span>
          <span>${sw('data-app="autoSwitch"', c.autoSwitch)}</span>
          <span>Показывать только когда iRacing в фокусе</span>
          <span>${sw('data-app="onlyWhenFocused"', c.onlyWhenFocused !== false)}</span>
        </div>
        <details class="hf-details" data-cfg-details="obs:server" style="margin-top:14px" ${cfgOpen['obs:server'] ? 'open' : ''}>
          <summary><span class="hf-sum">Для OBS и браузера</span><span class="sum-n">адрес</span>${icon('chevron-down', 'sm')}</summary>
          <div class="kv" style="margin-top:10px"><span>Адрес</span><span class="mono">${esc(location.origin)}</span></div>
          <p class="hint" style="margin-top:10px">Этот адрес открывают оверлеи в окнах и OBS. Работает только на этом компьютере.</p>
        </details>
      </div>
      <div class="sep"></div>
      <div class="block">
        <div class="label">Горячие клавиши</div>
        <div class="kv">
          <span>Редактирование оверлеев</span><span><kbd>Ctrl+Shift+L</kbd></span>
          <span>Скрыть / показать все</span><span><kbd>Ctrl+Shift+H</kbd></span>
          <span>Открыть эту панель</span><span><kbd>Ctrl+Shift+J</kbd></span>
          <span>Двигать без прилипания</span><span><kbd>Shift</kbd> при перетаскивании</span>
        </div>
      </div>
      <div class="sep"></div>
      <div class="block">
        <div class="label">Если что-то сломалось</div>
        <p class="hint" style="margin-bottom:14px">Overlap записывает ошибки в логи. Нажмите «Сохранить отчёт» и отправьте файл разработчику, либо скопируйте отчёт и вставьте в сообщение. В отчёте только версия, система, сводка настроек и последние строки лога, без паролей и личных путей.</p>
        <div class="diag-actions">
          <button class="btn" data-diag="diag.saveReport">${icon('file-text', 'sm')}Сохранить отчёт</button>
          <button class="btn" data-diag="diag.copyReport">${icon('copy', 'sm')}Скопировать отчёт</button>
          <button class="btn quiet" data-diag="diag.openFolder">${icon('folder-open', 'sm')}Открыть папку логов</button>
        </div>
        ${S.diag?.note ? `<p class="hint" style="margin-top:12px;color:var(--text)">${esc(S.diag.note)}</p>` : ''}
        <div class="kv" style="margin-top:16px">
          <span>Подробные логи</span><span>${sw('data-diag-verbose', !!S.diag?.verbose)}</span>
          <span>Папка логов</span><span class="mono" style="word-break:break-all">${esc(S.diag?.dir || '')}</span>
        </div>
      </div>
    </div></div>`;
}

// ---------- события ----------

const ovAction = (type, extra = {}) => act({ type, layoutId: sel.layoutId, variation: currentSet().variation, overlayId: selOv, ...extra });

// клик по самой карточке (не по крестику): открыть окно со списком нового
document.addEventListener('click', (e) => {
  if (!S || e.target.closest('[data-upd-toast-close]') || !e.target.closest('#updToast')) return;
  document.getElementById('updToast')?.remove();
  save('updDismissed', S.update?.version || '');
  popOpen = true;
  renderUpdateUi();
});

document.addEventListener('click', (e) => {
  const t = e.target.closest('button, .row, [data-ov]');
  if (!t || !S) return;
  const d = t.dataset;

  if ('updToastClose' in d) return dismissToast();
  if (e.target.closest('#updBtn')) { popOpen = !popOpen; return renderUpdateUi(); }
  if ('updClose' in d) { popOpen = false; return renderUpdateUi(); }
  if (d.update) return act({ type: d.update });
  if (d.updateUrl) return bridge.openUrl?.(d.updateUrl);
  if ('whatsNewOk' in d) { document.getElementById('whatsNew')?.remove(); return act({ type: 'app.set', lastSeenVersion: S.update?.current }); }
  if (d.ovTab) { ovTab = d.ovTab; save('ovTab', ovTab); return render(); }
  if ('sizesReset' in d) return ovAction('overlay.update', { patch: { sizes: null } });
  if (d.palResetSc) return act({ type: 'palette.reset', scope: d.palResetSc });
  if (d.palOpen) {
    view = 'overlays'; save('panelView', view); mounted = null; ovTab = 'colors'; save('ovTab', ovTab);
    const target = currentSet().list.find((x) => x.type === d.palOpen);
    if (target) selOv = target.id;
    return render();
  }
  if (d.palScope) { palScope = d.palScope; save('palScope', palScope); return render(); }
  if (d.palPrev) { palPrev = d.palPrev; save('palPrev', palPrev); return render(); }
  if (d.palPreset) return act({ type: 'palette.preset', scope: palScope, id: d.palPreset });
  if ('palReset' in d) return act({ type: 'palette.reset', scope: palScope });
  if (d.palClear) return act({ type: 'palette.set', scope: d.palSc || palScope, key: d.palClear, value: null });
  if (d.view) { view = d.view; save('panelView', view); mounted = null; return render(); }
  if (d.goto) { view = d.goto; save('panelView', view); mounted = null; selLayout = sel.layoutId; return render(); }
  if (d.diag) return act({ type: d.diag });
  if (d.appToggle) return act({ type: 'app.set', [d.appToggle]: !S.cfg[d.appToggle] });
  if (d.mode) return act({ type: 'app.set', locked: d.mode === 'lock' });
  if (d.copy) { navigator.clipboard?.writeText(d.copy); t.innerHTML = `${icon('check', 'sm')}<span>Скопировано</span>`; setTimeout(() => render(), 1200); return; }
  if (d.flagLayout) return ovAction('overlay.update', { patch: { flagLayout: d.flagLayout } });
  if ('splitAuto' in d) return ovAction('overlay.update', { patch: { split: null } });
  if ('enableOv' in d) return ovAction('overlay.update', { patch: { enabled: true } });

  // Оверлеи
  if (d.ov && !e.target.closest('.sw')) { selOv = d.ov; return render(); }
  if (d.add) { selOv = null; }
  if ('ovClose' in d) { selOv = 'none'; return render(); }
  if ('rename' in d) { const n = $('ovName'); n?.focus(); n?.select(); return; }
  if (d.vis) {
    const o = currentSet().list.find((x) => x.id === selOv);
    const cur = d.vis === 'onTrack' ? o?.visibility?.onTrack !== false : !!o?.visibility?.[d.vis];
    return ovAction('overlay.update', { patch: { visibility: { [d.vis]: !cur } } });
  }
  if (d.add) { act({ type: 'overlay.add', layoutId: sel.layoutId, variation: currentSet().variation, overlayType: d.add }); return; }
  if (d.ovAct) {
    if (d.ovAct === 'overlay.remove' && !confirm('Удалить оверлей из набора?')) return;
    return ovAction(d.ovAct);
  }

  // Раскладки
  if (d.layout) { selLayout = d.layout; return render(); }
  if (d.lact) {
    const l = layoutById(selLayout);
    if (d.lact === 'layout.delete' && !confirm(`Удалить раскладку «${l.name}»?`)) return;
    if (d.lact === 'layout.create') return act({ type: 'layout.create', name: 'Новая раскладка' });
    return act({ type: d.lact, id: l.id });
  }
  if (d.filterType) { const l = layoutById(selLayout); return act({ type: 'layout.update', id: l.id, patch: { carFilter: { type: d.filterType, values: d.filterType === l.carFilter.type ? l.carFilter.values : [] } } }); }
  if (d.removeCar != null) { const l = layoutById(selLayout); return act({ type: 'layout.update', id: l.id, patch: { carFilter: { type: 'car', values: l.carFilter.values.filter((_, i) => i !== Number(d.removeCar)) } } }); }
  if (d.cat) { const l = layoutById(selLayout); const s = new Set(l.carFilter.values); s.has(d.cat) ? s.delete(d.cat) : s.add(d.cat); return act({ type: 'layout.update', id: l.id, patch: { carFilter: { type: 'category', values: [...s] } } }); }
  if (d.session) {
    const l = layoutById(selLayout);
    let types = l.sessionTypes.includes('all') ? [] : [...l.sessionTypes];
    types = d.session === 'all' ? ['all'] : types.includes(d.session) ? types.filter((x) => x !== d.session) : [...types, d.session];
    return act({ type: 'layout.update', id: l.id, patch: { sessionTypes: types } });
  }
  if (d.editVar) {
    sel = { layoutId: selLayout, variation: d.editVar };
    act({ type: 'panel.select', layoutId: selLayout, variation: d.editVar });
    view = 'overlays'; save('panelView', view); mounted = null; selOv = null;
    return render();
  }
  if (d.varOn) return act({ type: 'variation.enable', layoutId: selLayout, variation: d.varOn });
  if (d.varOff) return act({ type: 'variation.disable', layoutId: selLayout, variation: d.varOff });

  // Ливреи
  if (d.lvAct) return act({ type: d.lvAct });
});

document.addEventListener('change', (e) => {
  const t = e.target, d = t.dataset;
  if (!S) return;
  if (d.palHex) {
    const v = '#' + t.value.trim().replace(/^#/, '');
    if (/^#[0-9a-f]{6}$/i.test(v)) return act({ type: 'palette.set', scope: d.palSc || palScope, key: d.palHex, value: v.toUpperCase() });
    return render(); // неверный код — вернуть прежний
  }
  if (d.ovEnabled) return act({ type: 'overlay.update', layoutId: sel.layoutId, variation: currentSet().variation, overlayId: d.ovEnabled, patch: { enabled: t.checked } });
  if ('autoScale' in d) return ovAction('overlay.update', { patch: { autoScale: t.checked } });
  if (d.cfg) return ovAction('overlay.update', { patch: { [d.cfg]: { [d.k]: t.checked } } });
  if (d.cfgSelect) return ovAction('overlay.update', { patch: { [d.cfgSelect]: { [d.k]: t.value } } });
  if ('diagVerbose' in d) return act({ type: 'diag.verbose', value: t.checked });
  if ('radarDist' in d) return ovAction('overlay.update', { patch: { radarDist: t.checked } });
  if ('radarClass' in d) return ovAction('overlay.update', { patch: { radarClass: t.checked } });
  if ('hideEmpty' in d) return ovAction('overlay.update', { patch: { hideEmpty: t.checked } });
  if (d.card) {
    const o = currentSet().list.find((x) => x.id === selOv);
    return ovAction('overlay.update', { patch: { cards: o.cards.map((c) => (c.id === d.card ? { ...c, on: t.checked } : c)) } });
  }
  if (d.hf) {
    const [zone, id] = d.hf.split(':');
    const o = currentSet().list.find((x) => x.id === selOv);
    return ovAction('overlay.update', { patch: { [zone]: o[zone].map((c) => (c.id === id ? { ...c, on: t.checked } : c)) } });
  }
  if (d.col) {
    const o = currentSet().list.find((x) => x.id === selOv);
    return ovAction('overlay.update', { patch: { columns: o.columns.map((c) => (c.id === d.col ? { ...c, on: t.checked } : c)) } });
  }
  if (d.ovField === 'name') return ovAction('overlay.update', { patch: { name: t.value } });
  if (d.layoutField === 'name') return act({ type: 'layout.update', id: selLayout, patch: { name: t.value } });
  if (t.matches('[data-default]') && t.checked) return act({ type: 'layout.update', id: selLayout, patch: { isDefault: true } });
  if (d.lv) return act({ type: 'liveries.set', patch: { [d.lv]: t.checked } });
  if (d.lvNum) return act({ type: 'liveries.set', patch: { [d.lvNum]: Number(t.value) } });
  if (d.app) return act({ type: 'app.set', [d.app]: t.type === 'checkbox' ? t.checked : t.value });
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.sizeRange) {
    const n = Number(t.value);
    t.nextElementSibling.textContent = `${n}%`;
    const o = currentSet().list.find((x) => x.id === selOv);
    $('pv')?.contentWindow?.postMessage({ svoySizes: { ...(o?.sizes || {}), [t.dataset.sizeRange]: n } }, location.origin);
    return ovAction('overlay.update', { patch: { sizes: { [t.dataset.sizeRange]: n } } });
  }
  if (t.dataset.palKey) {
    const hex = t.parentElement.querySelector('[data-pal-hex]');
    if (hex) hex.value = t.value.toUpperCase();
    return palSend(t.dataset.palKey, t.value.toUpperCase(), t.dataset.palSc || palScope);
  }
  if (t.dataset.ovRange === 'scale') {
    t.nextElementSibling.textContent = `${t.value}%`;
    $('pv')?.contentWindow?.postMessage({ svoyScale: t.value / 100 }, location.origin);
    return ovAction('overlay.update', { patch: { scale: t.value / 100 } });
  }
  if (t.dataset.cfgRange) {
    t.nextElementSibling.textContent = `${t.value}${(t.nextElementSibling.textContent.match(/\D+$/) || [''])[0]}`;
    const field = t.dataset.cfgRange, key = t.dataset.k, num = Number(t.value);
    const o = currentSet().list.find((x) => x.id === selOv);
    $('pv')?.contentWindow?.postMessage({ [{ dash: 'svoyDash', sectors: 'svoySectors', laps: 'svoyLaps', rejoin: 'svoyRejoin', fuel: 'svoyFuel', pitlimit: 'svoyPit', rel: 'svoyRel', traffic: 'svoyTraffic' }[field]]: { ...(o?.[field] || {}), [key]: num } }, location.origin);
    return ovAction('overlay.update', { patch: { [field]: { [key]: num } } });
  }
  if (t.dataset.ovRange === 'radarRange' || t.dataset.ovRange === 'radarIdle') {
    const isRange = t.dataset.ovRange === 'radarRange';
    t.nextElementSibling.textContent = isRange ? `${t.value} м` : `${t.value}%`;
    $('pv')?.contentWindow?.postMessage({ svoyFlag: isRange ? { range: Number(t.value) } : { idle: t.value / 100 } }, location.origin);
    return ovAction('overlay.update', { patch: isRange ? { radarRange: Number(t.value) } : { radarIdle: t.value / 100 } });
  }
  if (t.dataset.ovRange === 'split') {
    t.nextElementSibling.textContent = `${t.value}%`;
    $('pv')?.contentWindow?.postMessage({ svoySplit: t.value / 100 }, location.origin);
    return ovAction('overlay.update', { patch: { split: t.value / 100 } });
  }
  if (t.dataset.ovRange !== 'bgOpacity') return;
  t.nextElementSibling.textContent = `${t.value}%`;
  const doc = $('pv')?.contentDocument;
  doc?.documentElement?.style.setProperty('--bg-a', t.value / 100);
  ovAction('overlay.update', { patch: { bgOpacity: t.value / 100 } });
});

// Перетаскивание колонок, пунктов шапки и подвала: бросили на другую строку того же списка — встаёт на её место
let drag = null; // { list, id }
document.addEventListener('dragstart', (e) => {
  const it = e.target.closest?.('.col-item');
  if (!it) return;
  drag = { list: it.dataset.list || 'columns', id: it.dataset.colId };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', drag.id);
  requestAnimationFrame(() => it.classList.add('dragging'));
});
document.addEventListener('dragover', (e) => {
  const it = e.target.closest?.('.col-item');
  if (!drag || !it || (it.dataset.list || 'columns') !== drag.list) return;
  e.preventDefault();
  document.querySelectorAll('.col-item.over').forEach((x) => x !== it && x.classList.remove('over'));
  if (it.dataset.colId !== drag.id) it.classList.add('over');
});
document.addEventListener('dragend', () => {
  drag = null;
  document.querySelectorAll('.col-item.over, .col-item.dragging').forEach((x) => x.classList.remove('over', 'dragging'));
});
document.addEventListener('drop', (e) => {
  const it = e.target.closest?.('.col-item');
  if (!drag || !it || !S || (it.dataset.list || 'columns') !== drag.list) return;
  e.preventDefault();
  const { list, id } = drag;
  drag = null;
  const o = currentSet().list.find((x) => x.id === selOv);
  const from = o[list].findIndex((c) => c.id === id);
  const to = o[list].findIndex((c) => c.id === it.dataset.colId);
  if (from < 0 || to < 0 || from === to) return;
  const next = [...o[list]];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  ovAction('overlay.update', { patch: { [list]: next } });
});

// Раскрытие блоков «Шапка» и «Подвал» запоминаем: панель перерисовывается на каждое изменение
document.addEventListener('toggle', (e) => {
  const z = e.target.dataset?.hfDetails;
  if (z) hfOpen[z] = e.target.open;
  const dz = e.target.dataset?.cfgDetails;
  if (dz) cfgOpen[dz] = e.target.open;
}, true);

document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (e.key === 'Enter' && t.id === 'carInput' && t.value.trim()) {
    const l = layoutById(selLayout);
    act({ type: 'layout.update', id: l.id, patch: { carFilter: { type: 'car', values: [...l.carFilter.values, t.value.trim()] } } });
    t.value = '';
    t.blur();
  } else if (e.key === 'Enter' && t.matches('input[type=text]')) t.blur();
});

// ---------- старт ----------
if (bridge) {
  bridge.onState(setState);
  bridge.getState().then(setState);
} else {
  $('card').innerHTML = '<div class="page"><p class="hint">Панель работает внутри приложения (npm start).</p></div>';
}
