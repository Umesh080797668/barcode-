const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  readExcel: (filePath) =>
    ipcRenderer.invoke('excel:read', filePath),

  updateExcel: (payload) =>
    ipcRenderer.invoke('excel:update', payload),

  undoScan: (filePath) =>
    ipcRenderer.invoke('excel:undo', filePath),

  redoScan: (filePath) => 
    ipcRenderer.invoke('excel:redo', filePath),

  exportCSV: (filePath) => 
    ipcRenderer.invoke('excel:exportCSV', filePath),

  selectFile: () =>
    ipcRenderer.invoke('dialog:selectFile')
});
