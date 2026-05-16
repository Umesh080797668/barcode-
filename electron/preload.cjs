const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  readExcel: (filePath, sheetName) =>
    ipcRenderer.invoke('excel:read', { filePath, sheetName }),

  updateExcel: (payload) =>
    ipcRenderer.invoke('excel:update', payload),

  rewriteExcel: (payload) =>
    ipcRenderer.invoke('excel:rewrite', payload),

  undoScan: (filePath) =>
    ipcRenderer.invoke('excel:undo', filePath),

  redoScan: (filePath) => 
    ipcRenderer.invoke('excel:redo', filePath),

  exportCSV: (filePath) => 
    ipcRenderer.invoke('excel:exportCSV', filePath),

  selectFile: () =>
    ipcRenderer.invoke('dialog:selectFile')
});
