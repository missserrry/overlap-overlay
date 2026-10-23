// Какое окно сейчас на переднем плане: нужно, чтобы прятать оверлеи, когда вы свернули игру или ушли на рабочий стол.
// Берём процесс окна переднего плана через user32/kernel32 (koffi, как и остальные вызовы Windows в приложении).
const koffi = require('koffi');

let api = null;
function load() {
  if (api) return api;
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  api = {
    GetForegroundWindow: user32.func('void* GetForegroundWindow()'),
    GetWindowThreadProcessId: user32.func('uint32_t GetWindowThreadProcessId(void* hwnd, _Out_ uint32_t* pid)'),
    OpenProcess: kernel32.func('void* OpenProcess(uint32_t access, bool inherit, uint32_t pid)'),
    CloseHandle: kernel32.func('bool CloseHandle(void* h)'),
    QueryFullProcessImageNameW: kernel32.func('bool QueryFullProcessImageNameW(void* h, uint32_t flags, _Out_ uint16_t* buf, _Inout_ uint32_t* size)'),
  };
  return api;
}

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

// { pid, exe } окна переднего плана; exe — имя файла без пути в нижнем регистре ('' если не удалось узнать)
function foreground() {
  try {
    const a = load();
    const hwnd = a.GetForegroundWindow();
    if (!hwnd) return { pid: 0, exe: '' };
    const pidOut = [0];
    a.GetWindowThreadProcessId(hwnd, pidOut);
    const pid = pidOut[0];
    let exe = '';
    const h = a.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
    if (h) {
      const buf = new Uint16Array(1024);
      const size = [buf.length];
      if (a.QueryFullProcessImageNameW(h, 0, buf, size)) {
        exe = String.fromCharCode(...buf.subarray(0, size[0])).split('\\').pop().toLowerCase();
      }
      a.CloseHandle(h);
    }
    return { pid, exe };
  } catch {
    return { pid: 0, exe: '' };
  }
}

const isIRacing = (exe) => /^iracingsim/.test(exe);   // iRacingSim64DX11.exe, iRacingSim64.exe

module.exports = { foreground, isIRacing };
