const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),

  // ── Window Management ──────────────────────────────────────────────────
  openUsedPurchaseWindow: () => ipcRenderer.invoke('window:openUsedPurchase'),

  // ── CSV Export ──────────────────────────────────────────────────────────
  csvGetExportPath: () => ipcRenderer.invoke('csv:getExportPath'),
  csvSetExportPath: () => ipcRenderer.invoke('csv:setExportPath'),
  csvExportAll: () => ipcRenderer.invoke('csv:exportAll'),

  // ── Backup ──────────────────────────────────────────────────────────────
  createBackup: () => ipcRenderer.invoke('backup:create'),
  restoreBackup: () => ipcRenderer.invoke('backup:restore'),
  runBackupNow: () => ipcRenderer.invoke('backup:runNow'),
  getBackupSchedule: () => ipcRenderer.invoke('backup:getScheduleInfo'),

  onBackupProgress: (callback) => {
    const listener = (_, payload) => callback(payload);
    ipcRenderer.on('backup:progress', listener);
    return () => ipcRenderer.removeListener('backup:progress', listener);
  },

  onAutoBackupComplete: (callback) => {
    const listener = (_, payload) => callback(payload);
    ipcRenderer.on('autoBackup:complete', listener);
    return () => ipcRenderer.removeListener('autoBackup:complete', listener);
  },

  // ── Billing ─────────────────────────────────────────────────────────────
  saveInvoice: (invoice) => ipcRenderer.invoke('invoice:save', invoice),
  getInvoices: (limit) => ipcRenderer.invoke('invoice:getAll', limit),
  getInvoice: (invoiceNo) => ipcRenderer.invoke('invoice:get', invoiceNo),
  deleteInvoice: (invoiceNo) => ipcRenderer.invoke('invoice:delete', invoiceNo),

  // ── Printer ─────────────────────────────────────────────────────────────
  listPrinters: () => ipcRenderer.invoke('printer:list'),
  printReceipt: (payload) => ipcRenderer.invoke('printer:print', payload),

  // ── Shop Settings ────────────────────────────────────────────────────────
  getShopConfig: () => ipcRenderer.invoke('settings:getShop'),
  saveShopConfig: (config) => ipcRenderer.invoke('settings:saveShop', config),

  // ── Update ───────────────────────────────────────────────────────────────
  downloadAndInstallUpdate: (payload) => ipcRenderer.invoke('update:downloadAndInstall', payload),
  onUpdateProgress: (callback) => {
    const listener = (_, payload) => callback(payload);
    ipcRenderer.on('update:progress', listener);
    return () => ipcRenderer.removeListener('update:progress', listener);
  },

  // ── Barcode / Product DB ──────────────────────────────────────────────────
  generateBarcode: () => ipcRenderer.invoke('barcode:generate'),
  getProducts: (opts) => ipcRenderer.invoke('barcode:getProducts', opts),
  getProduct: (barcode) => ipcRenderer.invoke('barcode:getProduct', barcode),
  saveProduct: (product) => ipcRenderer.invoke('barcode:saveProduct', product),
  syncProduct: (product) => ipcRenderer.invoke('barcode:syncProduct', product),
  deleteProduct: (id) => ipcRenderer.invoke('barcode:deleteProduct', id),
  getBarcodeStats: () => ipcRenderer.invoke('barcode:getStats'),
  getCustomFields: () => ipcRenderer.invoke('barcode:getCustomFields'),
  saveCustomField: (field) => ipcRenderer.invoke('barcode:saveCustomField', field),
  deleteCustomField: (id) => ipcRenderer.invoke('barcode:deleteCustomField', id),

  // ── Supplier Returns ──────────────────────────────────────────────────────
  saveSupplierReturn: (data) => ipcRenderer.invoke('returns:save', data),
  getSupplierReturns: (limit) => ipcRenderer.invoke('returns:getAll', limit),
  deleteSupplierReturn: (id) => ipcRenderer.invoke('returns:delete', id),
});
