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
    ipcRenderer.invoke('dialog:selectFile'),

  // ── Barcode Generator / Product DB ───────────────────────────────────────
  generateBarcode:     ()        => ipcRenderer.invoke('barcode:generate'),
  getProducts:         (opts)    => ipcRenderer.invoke('barcode:getProducts', opts),
  getProduct:          (barcode) => ipcRenderer.invoke('barcode:getProduct', barcode),
  saveProduct:         (product) => ipcRenderer.invoke('barcode:saveProduct', product),
  deleteProduct:       (id)      => ipcRenderer.invoke('barcode:deleteProduct', id),
  getBarcodeStats:     ()        => ipcRenderer.invoke('barcode:getStats'),
  getCustomFields:     ()        => ipcRenderer.invoke('barcode:getCustomFields'),
  saveCustomField:     (field)   => ipcRenderer.invoke('barcode:saveCustomField', field),
  deleteCustomField:   (id)      => ipcRenderer.invoke('barcode:deleteCustomField', id),
});
