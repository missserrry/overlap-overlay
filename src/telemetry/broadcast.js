// Широковещательные команды iRacing SDK (как irsdk_broadcastMsg в официальном SDK / pyirsdk).
const koffi = require('koffi');

const HWND_BROADCAST = 0xffff;
const MSG = { reloadTextures: 7 };
const RELOAD = { all: 0, carIdx: 1 };

let api = null;
function user32() {
  if (!api) {
    const lib = koffi.load('user32.dll');
    api = {
      RegisterWindowMessageW: lib.func('uint32_t RegisterWindowMessageW(str16 name)'),
      SendNotifyMessageW: lib.func('int SendNotifyMessageW(uintptr_t hwnd, uint32_t msg, uintptr_t wParam, intptr_t lParam)'),
    };
    api.msgId = api.RegisterWindowMessageW('IRSDK_BROADCASTMSG');
  }
  return api;
}

function broadcast(msg, var1, var2) {
  if (process.platform !== 'win32') return false;
  const u = user32();
  const wParam = ((var1 & 0xffff) << 16) | (msg & 0xffff); // MAKELONG(msg, var1)
  return !!u.SendNotifyMessageW(HWND_BROADCAST, u.msgId, wParam >>> 0, var2);
}

// Перезагрузить текстуры одной машины (после загрузки её ливреи)
const reloadCarTexture = (carIdx) => broadcast(MSG.reloadTextures, RELOAD.carIdx, carIdx);

module.exports = { reloadCarTexture, broadcast };
