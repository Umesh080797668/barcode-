const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const excelHandler = require('./excel-handler.cjs');
const BarcodeDB    = require('./barcode-db.cjs');
const printHandler = require('./print-handler.cjs');
const fs = require('fs');

// Periodic flusher for pending Excel operations
const FLUSH_INTERVAL_MS = 5000;

let mainWindow;
let barcodeDB;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'ScanVault',
    backgroundColor: '#0d0e11',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Dev: load Vite dev server | Production: load built files
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  } else {
    mainWindow.loadURL('http://localhost:5173');
  }
}

app.whenReady().then(() => {
  barcodeDB = new BarcodeDB(app);
  createWindow();
});

// Start periodic flusher after app ready
app.whenReady().then(() => {
  try {
    setInterval(() => {
      try { excelHandler.flushAllPending(); } catch (e) { /* ignore */ }
    }, FLUSH_INTERVAL_MS);
  } catch (e) { /* ignore */ }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC: Read Excel file
ipcMain.handle('excel:read', async (_, payload) => {
  if (typeof payload === 'string') {
    return excelHandler.readExcel(payload);
  }
  return excelHandler.readExcel(payload.filePath, payload.sheetName);
});

// IPC: Process a scanned barcode → update Excel
ipcMain.handle('excel:update', async (_, { filePath, barcode, columnConfig, sheetName }) => {
  try {
    // attempt to enrich the scan with product data from the product DB
    let product = null;
    try { product = await barcodeDB.getProduct(barcode); } catch (_) { product = null; }
    return excelHandler.updateExcel(filePath, barcode, columnConfig, sheetName, product);
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// IPC: Rewrite sheet for structure changes (column rename)
ipcMain.handle('excel:rewrite', async (_, { filePath, sheetName, rows, columnsOrder }) => {
  return excelHandler.rewriteExcel(filePath, sheetName, rows, columnsOrder);
});

// IPC: Undo last scan
ipcMain.handle('excel:undo', async (_, filePath) => {
  return excelHandler.undoLastScan(filePath);
});

// IPC: Redo last scan
ipcMain.handle('excel:redo', async (_, filePath) => {
  return excelHandler.redoLastScan(filePath);
});

// IPC: Select File Dialog
ipcMain.handle('dialog:selectFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Spreadsheet Files', extensions: ['xlsx', 'xls', 'ods'] }
    ]
  });
  if (result.canceled) {
    return null;
  } else {
    return result.filePaths[0]; // Return selected path
  }
});

// IPC: Export to CSV
ipcMain.handle('excel:exportCSV', async (_, filePath) => {
  try {
    const csvData = excelHandler.exportToCSV();
    if (!csvData) {
      return { success: false, error: "No active data to export" };
    }
    
    const { filePath: savePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export to CSV',
      defaultPath: `export-${Date.now()}.csv`,
      filters: [{ name: 'CSV Files', extensions: ['csv'] }]
    });

    if (savePath) {
      fs.writeFileSync(savePath, csvData, 'utf8');
      return { success: true, filePath: savePath };
    }
    return { success: false, error: "Export cancelled" };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── Barcode Generator / Product DB IPC ──────────────────────────────────────

ipcMain.handle('barcode:generate', async () => {
  return { barcode: barcodeDB.generateBarcodeNumber() };
});

ipcMain.handle('barcode:getProducts', async (_, opts) => {
  try { return { success: true, products: await barcodeDB.getProducts(opts) }; }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('barcode:getProduct', async (_, barcode) => {
  try { return { success: true, product: await barcodeDB.getProduct(barcode) }; }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('barcode:saveProduct', async (_, product) => {
  try { return await barcodeDB.saveProduct(product); }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('barcode:deleteProduct', async (_, id) => {
  try { return await barcodeDB.deleteProduct(id); }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('barcode:getStats', async () => {
  try { return { success: true, ...(await barcodeDB.getStats()) }; }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('barcode:getCustomFields', async () => {
  try { return { success: true, fields: await barcodeDB.getCustomFields() }; }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('barcode:saveCustomField', async (_, field) => {
  try { return await barcodeDB.saveCustomField(field); }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('barcode:deleteCustomField', async (_, id) => {
  try { return await barcodeDB.deleteCustomField(id); }
  catch (e) { return { success: false, error: e.message }; }
});

// ── Billing / Invoice IPC ─────────────────────────────────────────────────────

ipcMain.handle('invoice:save', async (_, invoice) => {
  try { return await barcodeDB.saveInvoice(invoice); }
  catch (e) { return { success: false, error: e.message }; }
});

// Apply stock changes to an Excel file (decrement quantities)
ipcMain.handle('invoice:applyStockChanges', async (_, { filePath, changes, columnConfig, sheetName }) => {
  try {
    return excelHandler.applyStockChanges(filePath, changes, columnConfig, sheetName);
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('invoice:getAll', async (_, limit) => {
  try { return { success: true, invoices: await barcodeDB.getInvoices(limit) }; }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('invoice:get', async (_, invoiceNo) => {
  try { return { success: true, invoice: await barcodeDB.getInvoice(invoiceNo) }; }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('invoice:delete', async (_, invoiceNo) => {
  try { return await barcodeDB.deleteInvoice(invoiceNo); }
  catch (e) { return { success: false, error: e.message }; }
});

// ── Printer IPC ───────────────────────────────────────────────────────────────

ipcMain.handle('printer:list', async () => {
  try {
    const printers = await printHandler.getAvailablePrinters(mainWindow);
    return { success: true, printers };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('printer:print', async (_, { invoice, shopConfig, printerName }) => {
  try { return await printHandler.printReceipt(invoice, shopConfig, printerName); }
  catch (e) { return { success: false, error: e.message }; }
});

// ── Shop Settings IPC ─────────────────────────────────────────────────────────

ipcMain.handle('settings:getShop', async () => {
  const p = path.join(app.getPath('userData'), 'shop-config.json');
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  return {};
});

ipcMain.handle('settings:saveShop', async (_, config) => {
  const p = path.join(app.getPath('userData'), 'shop-config.json');
  fs.writeFileSync(p, JSON.stringify(config, null, 2), 'utf8');
  return { success: true };
});
