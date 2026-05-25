const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () =>
    ipcRenderer.invoke('app:getVersion'),

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

  // ── Billing ───────────────────────────────────────────────────────────────────
  saveInvoice: (invoice) => 
    ipcRenderer.invoke('invoice:save', invoice),

  getInvoices: (limit) => 
    ipcRenderer.invoke('invoice:getAll', limit),

  getInvoice: (invoiceNo) => 
    ipcRenderer.invoke('invoice:get', invoiceNo),

  deleteInvoice: (invoiceNo) => 
    ipcRenderer.invoke('invoice:delete', invoiceNo),

// ── Printer ───────────────────────────────────────────────────────────────────
  listPrinters: () => 
    ipcRenderer.invoke('printer:list'),

  printReceipt: (payload) => 
    ipcRenderer.invoke('printer:print', payload),

// ── Shop Settings ─────────────────────────────────────────────────────────────
  getShopConfig: () => 
    ipcRenderer.invoke('settings:getShop'),
  
  saveShopConfig: (config) => 
    ipcRenderer.invoke('settings:saveShop', config),

  downloadAndInstallUpdate: (payload) =>
    ipcRenderer.invoke('update:downloadAndInstall', payload),

  // ── Barcode Generator / Product DB ───────────────────────────────────────
  generateBarcode:     ()        => ipcRenderer.invoke('barcode:generate'),
  getProducts:         (opts)    => ipcRenderer.invoke('barcode:getProducts', opts),
  getProduct:          (barcode) => ipcRenderer.invoke('barcode:getProduct', barcode),
  saveProduct:         (product) => ipcRenderer.invoke('barcode:saveProduct', product),
  syncProduct:         (product) => ipcRenderer.invoke('barcode:syncProduct', product),
  deleteProduct:       (id)      => ipcRenderer.invoke('barcode:deleteProduct', id),
  getBarcodeStats:     ()        => ipcRenderer.invoke('barcode:getStats'),
  getCustomFields:     ()        => ipcRenderer.invoke('barcode:getCustomFields'),
  saveCustomField:     (field)   => ipcRenderer.invoke('barcode:saveCustomField', field),
  deleteCustomField:   (id)      => ipcRenderer.invoke('barcode:deleteCustomField', id),
  applyStockChanges:   (payload) => ipcRenderer.invoke('invoice:applyStockChanges', payload),
  syncInventoryProduct: (payload) => ipcRenderer.invoke('excel:syncProduct', payload),
});
