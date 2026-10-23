// Служебные окна (оверлеи, направляющие) не должны попадать в Alt+Tab и на панель задач.
// Electron скрывает их только с панели задач, а Alt+Tab показывает любое окно, которое может получить фокус
// (в режиме редактирования оверлеи фокусируются). Стиль WS_EX_TOOLWINDOW убирает окно из Alt+Tab совсем.
const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x80;
const WS_EX_APPWINDOW = 0x40000;
const SWP_FLAGS = 0x0001 | 0x0002 | 0x0004 | 0x0010 | 0x0020; // NOSIZE | NOMOVE | NOZORDER | NOACTIVATE | FRAMECHANGED

let api = null;
function load() {
  if (api !== null) return api;
  api = false;
  if (process.platform !== 'win32') return api;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    api = {
      get: user32.func('intptr __stdcall GetWindowLongPtrW(intptr hwnd, int index)'),
      set: user32.func('intptr __stdcall SetWindowLongPtrW(intptr hwnd, int index, intptr value)'),
      pos: user32.func('bool __stdcall SetWindowPos(intptr hwnd, intptr after, int x, int y, int cx, int cy, uint flags)'),
    };
  } catch (e) { console.warn('[winstyle] не удалось загрузить user32:', e.message); }
  return api;
}

function hideFromAltTab(win) {
  const a = load();
  if (!a) return;
  try {
    const hwnd = win.getNativeWindowHandle().readBigUInt64LE(0);
    const cur = BigInt(a.get(hwnd, GWL_EXSTYLE));
    const next = (cur | BigInt(WS_EX_TOOLWINDOW)) & ~BigInt(WS_EX_APPWINDOW);
    if (next !== cur) { a.set(hwnd, GWL_EXSTYLE, next); a.pos(hwnd, 0n, 0, 0, 0, 0, SWP_FLAGS); }
  } catch (e) { console.warn('[winstyle]', e.message); }
}

module.exports = { hideFromAltTab };
