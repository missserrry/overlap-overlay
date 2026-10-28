import { connect, setupPage, onAbsChange } from '/common/overlay.js';
import { absLatch } from '/common/pedals.js';

const params = setupPage();
const FORCE = params.get('force') === '1';   // превью в панели: лампа то горит, то нет
const root = document.getElementById('root');

// по умолчанию совпадает со схемой в src/main/layouts.js (ABS_SCHEMA)
const DEFAULTS = { look: 'icon', idle: 'dim', hold: 300 };
let cfg = { ...DEFAULTS };
let model = null;
let held = absLatch(cfg.hold);

// значок ABS как на приборной панели: круг с надписью и дуги по бокам
const ICON = `<svg viewBox="0 0 120 80" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round">
  <circle cx="60" cy="40" r="27"/>
  <path d="M22 16a40 40 0 0 0 0 48M98 16a40 40 0 0 1 0 48"/>
  <text x="60" y="47.5" text-anchor="middle" fill="currentColor" stroke="none" font-size="20" font-weight="800" letter-spacing="1">ABS</text>
</svg>`;

function build() {
  held = absLatch(cfg.hold);
  root.innerHTML = cfg.look === 'text' ? '<div class="txt">ABS</div>' : ICON;
  root.classList.toggle('hide', cfg.idle === 'hide');
  layout();
  render();
}

// надпись — по высоте и ширине окна
function layout() {
  const fs = Math.min(window.innerWidth / 3, window.innerHeight * 0.6);
  root.style.setProperty('--fs', `${Math.max(fs, 8).toFixed(1)}px`);
}

function render() {
  const on = FORCE ? ((Date.now() / 1200) | 0) % 2 === 0 : !!model && held(model);
  root.classList.toggle('on', on);
  root.classList.toggle('off', !on);
}

onAbsChange((obj) => { cfg = { ...DEFAULTS, ...obj }; build(); });
window.addEventListener('resize', layout);
// флаг ABS и тормоз уже есть в модели Dash
connect('dash', (msg) => { model = msg.data; render(); });
setInterval(render, 100);   // подсветка гаснет по времени, даже если данные перестали приходить
build();
