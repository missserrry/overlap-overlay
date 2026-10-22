// Мост между окном оверлея и главным процессом: режим редактирования, прозрачность фона,
// перемещение/растягивание окна (курсор ведёт главный процесс) и направляющие прилипания.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayBridge', {
  onSettings: (cb) => ipcRenderer.on('overlay-settings', (_e, s) => cb(s)),
  dragStart: (mode) => ipcRenderer.send('overlay-drag-start', mode),
  dragEnd: () => ipcRenderer.send('overlay-drag-end'),
  setShift: (down) => ipcRenderer.send('overlay-drag-shift', !!down),
  setSplit: (ratio) => ipcRenderer.send('overlay-split', ratio),
  onGuides: (cb) => ipcRenderer.on('guides', (_e, g) => cb(g)),
});
