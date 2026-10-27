// Мост панели управления: получить состояние, отправить действие, подписаться на изменения.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('panelBridge', {
  getState: () => ipcRenderer.invoke('panel-get-state'),
  action: (a) => ipcRenderer.send('panel-action', a),
  onState: (cb) => ipcRenderer.on('panel-state', (_e, s) => cb(s)),
  openUrl: (url) => ipcRenderer.send('panel-open-url', url),
  // путь перетащенного файла: у File в Electron его больше нет, спрашиваем у webUtils
  pathFor: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
});
