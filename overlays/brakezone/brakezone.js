import { connect, setupPage } from '/common/overlay.js';

const params = setupPage();
const FORCE = params.get('force') === '1';   // превью в панели: по кругу показываем подсказку, зону и результат
const root = document.getElementById('root');
let model = null;

const KPH_PER_MPH = 1.609344;
const sign = (n, unit, digits = 0) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(digits)} ${unit}`;

// Режим превью: подъезжаем к зоне, тормозим, показываем результат
function demoModel() {
  const t = (Date.now() % 9000) / 9000;
  const ahead = Math.max(0, 420 - t * 520), inside = t > 0.8 && t < 0.95;
  return {
    active: true, speed: 250 - t * 120, imperial: false, count: 8, brake: inside ? 0.8 : 0,
    zone: { id: 3, entrySpeed: 203, minSpeed: 100, peak: 1, length: 88, ahead: inside ? 0 : ahead, inside },
    last: { id: 2, missed: false, startDelta: 9, entrySpeedDelta: 1.5, minSpeedDelta: -8, peakDelta: 0 },
  };
}

// Три отметки «3-2-1»: загораются на 300, 200 и 100 м до торможения
const dots = (ahead) => [300, 200, 100].map((m) => `<i class="${ahead <= m ? 'on' : ''}"></i>`).join('');

function result(m, k, unit) {
  const l = m.last;
  if (!l) return '<div class="res none">Результат появится после первой пройденной зоны</div>';
  if (l.missed) return `<div class="res"><b>Т${l.id}</b><span class="warn">не тормозил</span></div>`;
  const early = l.startDelta < 0;
  const place = Math.abs(l.startDelta) < 2 ? { t: 'в точку', c: 'ok' } : { t: `${early ? 'раньше' : 'позже'} на ${Math.abs(Math.round(l.startDelta))} м`, c: early ? 'warn' : 'info' };
  return `<div class="res"><b>Т${l.id}</b><span class="${place.c}">${place.t}</span>
    <span class="d">вход ${sign(l.entrySpeedDelta * k, unit)}</span><span class="d">апекс ${sign(l.minSpeedDelta * k, unit)}</span></div>`;
}

function render() {
  const m = FORCE ? demoModel() : model;
  if (!m || !m.active) {
    // эталона нет, не та трасса или вы не за рулём: подсказываем причину, но не прячем окно, чтобы было видно, что оно работает
    const text = m?.reason === 'noref' ? 'Выберите эталонный круг<br>в разделе «Тренировка»' : m?.reason === 'track' ? 'Эталон снят на другой трассе' : '';
    if (!text) { root.classList.add('hidden'); return; }
    root.classList.remove('hidden');
    root.className = 'bz idle';
    root.innerHTML = `<div class="top"><span>ТОРМОЖЕНИЕ</span></div><div class="msg">${text}</div>`;
    return layout();
  }
  root.classList.remove('hidden');

  const mph = m.imperial;
  const k = mph ? 1 / KPH_PER_MPH : 1, unit = mph ? 'mph' : 'km/h';
  const z = m.zone;
  if (!z) { root.className = 'bz idle'; root.innerHTML = '<div class="top"><span>ТОРМОЖЕНИЕ</span></div><div class="msg">На круге эталона нет торможений</div>'; return layout(); }

  const now = z.ahead <= 20 || z.inside;
  const big = z.inside ? 'ТОРМОЗИ' : now ? 'СЕЙЧАС' : `${Math.round(z.ahead / 10) * 10}`;
  const state = z.inside ? 'in' : now ? 'now' : z.ahead <= 100 ? 'near' : '';
  const dv = m.speed - z.entrySpeed;   // ваша скорость сейчас против скорости эталона в точке начала торможения
  root.className = `bz ${state}`;
  root.innerHTML = `
    <div class="top"><span>ТОРМОЖЕНИЕ · Т${z.id}<small>/${m.count}</small></span><span class="dots">${dots(z.ahead)}</span></div>
    <div class="dist">${z.inside || now ? `<b class="word">${big}</b>` : `<b>${big}</b><small>м</small>`}</div>
    <div class="spd">
      <div><small>эталон на входе</small><b>${Math.round(z.entrySpeed * k)}</b><em>${unit}</em></div>
      <div><small>вы сейчас</small><b class="${dv > 4 ? 'warn' : ''}">${Math.round(m.speed * k)}</b><em>${unit}</em></div>
      <div><small>апекс эталона</small><b>${Math.round(z.minSpeed * k)}</b><em>${unit}</em></div>
    </div>
    ${result(m, k, unit)}`;
  layout();
}

// Содержимое вписывается в окно: измеряем при базовом размере и подбираем масштаб
function layout() {
  root.style.setProperty('--scale', 1);
  root.style.width = '360px';
  const w0 = root.offsetWidth, h0 = root.offsetHeight;
  if (!w0 || !h0) return;
  const k = Math.min(window.innerWidth / w0, window.innerHeight / h0);
  root.style.setProperty('--scale', k.toFixed(4));
  root.style.width = `${window.innerWidth}px`;
}

window.addEventListener('resize', layout);
connect('brakezone', (msg) => { model = msg.data; render(); });
if (FORCE) setInterval(render, 80);   // живая анимация в превью
