// Мост окна «Телеметрия»: библиотека файлов, чтение кругов, добавление эталонов, настройки окна.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('tlm', {
  library: () => ipcRenderer.invoke('tlm-library'),
  onLibrary: (cb) => ipcRenderer.on('tlm-library', (_e, l) => cb(l)),
  rescan: () => ipcRenderer.invoke('tlm-rescan'),
  lap: (file, lap) => ipcRenderer.invoke('tlm-lap', file, lap),
  track: (file) => ipcRenderer.invoke('tlm-track', file),
  importFiles: (paths) => ipcRenderer.invoke('tlm-import', paths),
  pick: () => ipcRenderer.invoke('tlm-pick'),
  removeRef: (file) => ipcRenderer.invoke('tlm-remove-ref', file),
  openFolder: (which) => ipcRenderer.invoke('tlm-open-folder', which),
  settings: () => ipcRenderer.invoke('tlm-settings'),
  saveSettings: (patch) => ipcRenderer.send('tlm-settings-set', patch),
  // путь перетащенного файла: у File в Electron его больше нет, спрашиваем у webUtils
  pathFor: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
});
