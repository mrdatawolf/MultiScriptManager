const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // App info
  getVersion: () => ipcRenderer.invoke('app:version'),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (updates) => ipcRenderer.invoke('settings:set', updates),
  pickFolder: () => ipcRenderer.invoke('settings:pickFolder'),
  clearSettings: () => ipcRenderer.invoke('settings:clear'),
  getLoginItem: () => ipcRenderer.invoke('settings:getLoginItem'),
  setLoginItem: (opts) => ipcRenderer.invoke('settings:setLoginItem', opts),

  // Folder metadata (short name + URI)
  getFolderMeta: () => ipcRenderer.invoke('folders:getMeta'),
  setFolderMeta: (folderName, meta) => ipcRenderer.invoke('folders:setMeta', { folderName, meta }),
  openExternal: (uri) => ipcRenderer.invoke('shell:openExternal', uri),

  // Script discovery
  scanScripts: () => ipcRenderer.invoke('scripts:scan'),

  // Process control
  startProcess: (opts) => ipcRenderer.invoke('process:start', opts),
  stopProcess: (opts) => ipcRenderer.invoke('process:stop', opts),
  getOutput: (opts) => ipcRenderer.invoke('process:output', opts),
  getLastRunning: () => ipcRenderer.invoke('process:lastRunning'),

  // Live events from main
  onOutput: (cb) => ipcRenderer.on('process:output', (_e, data) => cb(data)),
  onStopped: (cb) => ipcRenderer.on('process:stopped', (_e, data) => cb(data)),
});
