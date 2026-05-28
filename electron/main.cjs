const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const XLSX = require('xlsx');
const excelHandler = require('./excel-handler.cjs');
const BarcodeDB    = require('./barcode-db.cjs');
const printHandler = require('./print-handler.cjs');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

// Periodic flusher for pending Excel operations
const FLUSH_INTERVAL_MS = 5000;
const BACKUP_SHEET_PREFIX = '__sv_';
const BACKUP_META_SHEET = '__sv_meta';
const BACKUP_PRODUCTS_SHEET = '__sv_products';
const BACKUP_CUSTOM_FIELDS_SHEET = '__sv_custom_fields';
const BACKUP_INVOICES_SHEET = '__sv_invoices';
const BACKUP_INVOICE_ITEMS_SHEET = '__sv_invoice_items';
const BACKUP_SHOP_CONFIG_SHEET = '__sv_shop_config';
const BACKUP_DIR_NAME = 'ScanVault Backups';
const BACKUP_FILE_NAME = 'scanvault-full-backup.xlsx';

let mainWindow;
let barcodeDB;

function getShopConfigPath() {
  return path.join(app.getPath('userData'), 'shop-config.json');
}

function readShopConfig() {
  const configPath = getShopConfigPath();
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (_) {
    return {};
  }
}

function writeShopConfig(config) {
  const configPath = getShopConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(config || {}, null, 2), 'utf8');
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getBackupDirPath() {
  const dirPath = path.join(app.getPath('userData'), BACKUP_DIR_NAME);
  ensureDir(dirPath);
  return dirPath;
}

function getBackupFilePath() {
  return path.join(getBackupDirPath(), BACKUP_FILE_NAME);
}

function sendBackupProgress(event, operation, status, phase, progress, details) {
  event.sender.send('backup:progress', {
    operation,
    status,
    phase,
    progress,
    details,
  });
}

function isBlankValue(value) {
  return value === undefined || value === null || value === '';
}

function cloneRow(row) {
  return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [key, value]));
}

function getRowValue(row, keyName) {
  if (!row) return undefined;
  if (Object.prototype.hasOwnProperty.call(row, keyName)) return row[keyName];
  const matchKey = Object.keys(row).find((key) => key.toLowerCase() === String(keyName).toLowerCase());
  return matchKey ? row[matchKey] : undefined;
}

function buildRowKey(row, keyFields) {
  const fields = Array.isArray(keyFields) ? keyFields : [];
  if (fields.length > 0) {
    return fields.map((field) => `${field}=${String(getRowValue(row, field) ?? '').trim()}`).join('|');
  }

  const barcode = getRowValue(row, 'barcode') ?? getRowValue(row, 'Barcode');
  if (!isBlankValue(barcode)) return `barcode=${String(barcode).trim()}`;

  const invoiceNo = getRowValue(row, 'invoice_no') ?? getRowValue(row, 'invoiceNo') ?? getRowValue(row, 'Invoice No');
  if (!isBlankValue(invoiceNo)) return `invoice_no=${String(invoiceNo).trim()}`;

  const idValue = getRowValue(row, 'id');
  if (!isBlankValue(idValue)) return `id=${String(idValue).trim()}`;

  const ordered = {};
  for (const key of Object.keys(row || {}).sort()) {
    ordered[key] = row[key];
  }
  return `json=${JSON.stringify(ordered)}`;
}

function mergeRowObjects(baseRow, incomingRow, mode = 'preferIncoming') {
  const merged = cloneRow(baseRow);
  for (const [key, incomingValue] of Object.entries(incomingRow || {})) {
    const currentValue = merged[key];
    if (mode === 'preferIncoming') {
      if (!isBlankValue(incomingValue)) {
        merged[key] = incomingValue;
      } else if (isBlankValue(currentValue) && incomingValue !== undefined) {
        merged[key] = incomingValue;
      }
    } else if (isBlankValue(currentValue) && !isBlankValue(incomingValue)) {
      merged[key] = incomingValue;
    }
  }
  return merged;
}

function mergeRowArrays(existingRows = [], incomingRows = [], mode = 'preferIncoming', keyFields = null) {
  const mergedMap = new Map();
  const order = [];

  const addRow = (row, mergeMode) => {
    const key = buildRowKey(row, keyFields);
    if (mergedMap.has(key)) {
      mergedMap.set(key, mergeRowObjects(mergedMap.get(key), row, mergeMode));
    } else {
      mergedMap.set(key, cloneRow(row));
      order.push(key);
    }
  };

  for (const row of existingRows || []) addRow(row, 'preferIncoming');
  for (const row of incomingRows || []) addRow(row, mode);

  return order.map((key) => mergedMap.get(key));
}

function mergeObjectShallow(existingValue, incomingValue, mode = 'preferIncoming') {
  if (existingValue && typeof existingValue === 'object' && !Array.isArray(existingValue)) {
    const merged = { ...existingValue };
    for (const [key, value] of Object.entries(incomingValue || {})) {
      if (mode === 'preferIncoming') {
        if (!isBlankValue(value)) merged[key] = value;
      } else if (isBlankValue(merged[key]) && !isBlankValue(value)) {
        merged[key] = value;
      }
    }
    return merged;
  }

  if (mode === 'preferIncoming') {
    return isBlankValue(incomingValue) ? existingValue : incomingValue;
  }

  return isBlankValue(existingValue) ? incomingValue : existingValue;
}

function setWorkbookSheet(workbook, sheetName, rows) {
  const sheet = XLSX.utils.json_to_sheet(rows || []);
  workbook.Sheets[sheetName] = sheet;
  if (!workbook.SheetNames.includes(sheetName)) {
    workbook.SheetNames.push(sheetName);
  }
}

function guessSheetKeyFields(sheetName, rows = []) {
  const name = String(sheetName || '').toLowerCase();
  if (name === BACKUP_PRODUCTS_SHEET.toLowerCase()) return ['barcode'];
  if (name === BACKUP_CUSTOM_FIELDS_SHEET.toLowerCase()) return ['id'];
  if (name === BACKUP_INVOICES_SHEET.toLowerCase()) return ['invoice_no'];
  if (name === BACKUP_INVOICE_ITEMS_SHEET.toLowerCase()) {
    return ['invoice_no', 'barcode', 'name', 'price', 'quantity', 'discount', 'net_price', 'total', 'warranty', 'remaining_warranty'];
  }

  const allKeys = new Set();
  for (const row of rows || []) {
    for (const key of Object.keys(row || {})) {
      allKeys.add(key.toLowerCase());
    }
  }
  if (allKeys.has('barcode')) return ['Barcode'];
  if (allKeys.has('invoice_no') || allKeys.has('invoice no')) return ['invoice_no'];
  if (allKeys.has('id')) return ['id'];
  return null;
}

function getRowsFromWorkbook(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

function workbookHasSheet(workbook, sheetName) {
  return Boolean(workbook?.Sheets?.[sheetName]);
}

function isAppBackupSheet(sheetName) {
  return String(sheetName || '').startsWith(BACKUP_SHEET_PREFIX);
}

function sheetToJsonRows(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

function appendJsonSheet(workbook, sheetName, rows) {
  setWorkbookSheet(workbook, sheetName, rows || []);
}

function buildOrMergeBackupWorkbook(existingBackupWorkbook, sourceWorkbook, dbSnapshot, shopConfig, metadata) {
  const backupWorkbook = existingBackupWorkbook || XLSX.utils.book_new();

  for (const sheetName of sourceWorkbook.SheetNames || []) {
    if (isAppBackupSheet(sheetName)) continue;
    const currentRows = getRowsFromWorkbook(sourceWorkbook, sheetName);
    const existingRows = workbookHasSheet(backupWorkbook, sheetName) ? getRowsFromWorkbook(backupWorkbook, sheetName) : [];
    const keyFields = guessSheetKeyFields(sheetName, [...existingRows, ...currentRows]);
    const mergedRows = mergeRowArrays(existingRows, currentRows, 'preferIncoming', keyFields);
    setWorkbookSheet(backupWorkbook, sheetName, mergedRows);
  }

  const existingProducts = workbookHasSheet(backupWorkbook, BACKUP_PRODUCTS_SHEET) ? getRowsFromWorkbook(backupWorkbook, BACKUP_PRODUCTS_SHEET) : [];
  const existingCustomFields = workbookHasSheet(backupWorkbook, BACKUP_CUSTOM_FIELDS_SHEET) ? getRowsFromWorkbook(backupWorkbook, BACKUP_CUSTOM_FIELDS_SHEET) : [];
  const existingInvoices = workbookHasSheet(backupWorkbook, BACKUP_INVOICES_SHEET) ? getRowsFromWorkbook(backupWorkbook, BACKUP_INVOICES_SHEET) : [];
  const existingInvoiceItems = workbookHasSheet(backupWorkbook, BACKUP_INVOICE_ITEMS_SHEET) ? getRowsFromWorkbook(backupWorkbook, BACKUP_INVOICE_ITEMS_SHEET) : [];
  const existingShopConfigRows = workbookHasSheet(backupWorkbook, BACKUP_SHOP_CONFIG_SHEET) ? getRowsFromWorkbook(backupWorkbook, BACKUP_SHOP_CONFIG_SHEET) : [];

  setWorkbookSheet(backupWorkbook, BACKUP_META_SHEET, [{ json: JSON.stringify(metadata || {}) }]);
  setWorkbookSheet(backupWorkbook, BACKUP_PRODUCTS_SHEET, mergeRowArrays(existingProducts, dbSnapshot.products || [], 'preferIncoming', ['barcode']));
  setWorkbookSheet(backupWorkbook, BACKUP_CUSTOM_FIELDS_SHEET, mergeRowArrays(existingCustomFields, dbSnapshot.customFields || [], 'preferIncoming', ['id']));
  setWorkbookSheet(backupWorkbook, BACKUP_INVOICES_SHEET, mergeRowArrays(existingInvoices, dbSnapshot.invoices || [], 'preferIncoming', ['invoice_no']));
  setWorkbookSheet(backupWorkbook, BACKUP_INVOICE_ITEMS_SHEET, mergeRowArrays(existingInvoiceItems, dbSnapshot.invoiceItems || [], 'preferIncoming', ['invoice_no', 'barcode', 'name', 'price', 'quantity', 'discount', 'net_price', 'total', 'warranty', 'remaining_warranty']));

  const currentShopConfigRows = [{ json: JSON.stringify(shopConfig || {}) }];
  const existingShopConfig = existingShopConfigRows[0]?.json ? (() => { try { return JSON.parse(String(existingShopConfigRows[0].json)); } catch (_) { return {}; } })() : {};
  const currentShopConfig = currentShopConfigRows[0]?.json ? (() => { try { return JSON.parse(String(currentShopConfigRows[0].json)); } catch (_) { return {}; } })() : {};
  const mergedShopConfig = mergeObjectShallow(existingShopConfig, currentShopConfig, 'preferIncoming');
  setWorkbookSheet(backupWorkbook, BACKUP_SHOP_CONFIG_SHEET, [{ json: JSON.stringify(mergedShopConfig || {}) }]);

  return backupWorkbook;
}

function readBackupWorkbookPayload(workbook) {
  const userSheetNames = (workbook.SheetNames || []).filter((sheetName) => !isAppBackupSheet(sheetName));
  const metaRows = sheetToJsonRows(workbook, BACKUP_META_SHEET);
  const shopConfigRows = sheetToJsonRows(workbook, BACKUP_SHOP_CONFIG_SHEET);

  let shopConfig = {};
  if (shopConfigRows.length > 0) {
    const raw = shopConfigRows[0].json || shopConfigRows[0].value || '{}';
    try { shopConfig = JSON.parse(String(raw || '{}')); } catch (_) { shopConfig = {}; }
  }

  return {
    userSheetNames,
    meta: metaRows[0]?.json ? (() => {
      try { return JSON.parse(String(metaRows[0].json)); } catch (_) { return {}; }
    })() : {},
    shopConfig,
    products: sheetToJsonRows(workbook, BACKUP_PRODUCTS_SHEET),
    customFields: sheetToJsonRows(workbook, BACKUP_CUSTOM_FIELDS_SHEET),
    invoices: sheetToJsonRows(workbook, BACKUP_INVOICES_SHEET),
    invoiceItems: sheetToJsonRows(workbook, BACKUP_INVOICE_ITEMS_SHEET),
  };
}

function mergeBackupWorkbookIntoTarget(backupWorkbook, targetWorkbook) {
  const payload = readBackupWorkbookPayload(backupWorkbook);
  let sheetsChanged = 0;
  let rowsAdded = 0;

  for (const sheetName of payload.userSheetNames) {
    const backupRows = getRowsFromWorkbook(backupWorkbook, sheetName);
    const existingRows = workbookHasSheet(targetWorkbook, sheetName) ? getRowsFromWorkbook(targetWorkbook, sheetName) : [];
    const keyFields = guessSheetKeyFields(sheetName, [...existingRows, ...backupRows]);
    const mergedRows = mergeRowArrays(existingRows, backupRows, 'preferExisting', keyFields);
    const changed = JSON.stringify(mergedRows) !== JSON.stringify(existingRows);
    if (changed) {
      setWorkbookSheet(targetWorkbook, sheetName, mergedRows);
      sheetsChanged += 1;
      rowsAdded += Math.max(0, mergedRows.length - existingRows.length);
    }
  }

  return {
    changed: sheetsChanged > 0,
    restoredSheets: sheetsChanged,
    restoredRows: rowsAdded,
    userSheetNames: payload.userSheetNames,
    shopConfig: payload.shopConfig,
    meta: payload.meta,
    products: payload.products,
    customFields: payload.customFields,
    invoices: payload.invoices,
    invoiceItems: payload.invoiceItems,
  };
}

function createWindow() {
  const appIconPath = path.join(app.getAppPath(), 'build', 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'ScanVault',
    backgroundColor: '#0d0e11',
    icon: appIconPath,
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

ipcMain.handle('app:getVersion', async () => {
  return { success: true, version: app.getVersion() };
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

ipcMain.handle('backup:createFull', async (event, { sourceFilePath }) => {
  try {
    if (!sourceFilePath) {
      sendBackupProgress(event, 'backup:createFull', 'error', 'Select source workbook', 0, 'Select an Excel file first');
      return { success: false, error: 'Select an Excel file first' };
    }

    sendBackupProgress(event, 'backup:createFull', 'running', 'Preparing backup', 5, 'Flushing pending Excel changes');
    excelHandler.flushPendingForFile(sourceFilePath);

    if (!fs.existsSync(sourceFilePath)) {
      sendBackupProgress(event, 'backup:createFull', 'error', 'Source file missing', 0, 'Source Excel file not found');
      return { success: false, error: 'Source Excel file not found' };
    }

    sendBackupProgress(event, 'backup:createFull', 'running', 'Reading source workbook', 20, 'Loading Excel workbook');
    const savePath = getBackupFilePath();
    const sourceWorkbook = XLSX.readFile(sourceFilePath);
    sendBackupProgress(event, 'backup:createFull', 'running', 'Reading existing backup', 35, 'Loading persistent backup workbook');
    const existingBackupWorkbook = fs.existsSync(savePath) ? XLSX.readFile(savePath) : null;
    sendBackupProgress(event, 'backup:createFull', 'running', 'Collecting database snapshot', 55, 'Reading products, invoices, and shop settings');
    const dbSnapshot = await barcodeDB.exportBackupSnapshot();
    sendBackupProgress(event, 'backup:createFull', 'running', 'Merging backup data', 75, 'Combining Excel and SQLite data');
    const backupWorkbook = buildOrMergeBackupWorkbook(existingBackupWorkbook, sourceWorkbook, dbSnapshot, readShopConfig(), {
      createdAt: new Date().toISOString(),
      sourceFilePath,
      appVersion: app.getVersion(),
      sheetNames: sourceWorkbook.SheetNames || [],
    });

    sendBackupProgress(event, 'backup:createFull', 'running', 'Writing backup file', 90, 'Saving merged workbook to app data');
    XLSX.writeFile(backupWorkbook, savePath);

    sendBackupProgress(event, 'backup:createFull', 'success', 'Backup completed', 100, `Backup saved to ${savePath}`);

    return {
      success: true,
      backupPath: savePath,
      backupLocation: savePath,
      sheetCount: sourceWorkbook.SheetNames?.length || 0,
      productCount: dbSnapshot.products?.length || 0,
      invoiceCount: dbSnapshot.invoices?.length || 0,
      customFieldCount: dbSnapshot.customFields?.length || 0,
    };
  } catch (err) {
    sendBackupProgress(event, 'backup:createFull', 'error', 'Backup failed', 100, err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('backup:restoreFull', async (event, { backupPath, targetFilePath }) => {
  try {
    const resolvedBackupPath = backupPath || getBackupFilePath();

    if (!fs.existsSync(resolvedBackupPath)) {
      sendBackupProgress(event, 'backup:restoreFull', 'error', 'Backup file missing', 0, 'Backup file not found');
      return { success: false, error: 'Backup file not found' };
    }

    sendBackupProgress(event, 'backup:restoreFull', 'running', 'Opening backup workbook', 10, 'Reading persisted backup file');
    let resolvedTargetPath = targetFilePath;
    if (!resolvedTargetPath) {
      sendBackupProgress(event, 'backup:restoreFull', 'running', 'Selecting restore target', 20, 'Waiting for target workbook selection');
      const selectedTarget = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx', 'xls', 'ods'] }],
      });
      if (selectedTarget.canceled || !selectedTarget.filePaths?.[0]) {
        return { success: false, error: 'Select a target Excel file to restore into' };
      }
      resolvedTargetPath = selectedTarget.filePaths[0];
    }

    sendBackupProgress(event, 'backup:restoreFull', 'running', 'Reading backup payload', 35, 'Loading backup sheets and metadata');
    const backupWorkbook = XLSX.readFile(resolvedBackupPath);
    const payload = readBackupWorkbookPayload(backupWorkbook);

    if (!payload.userSheetNames.length) {
      sendBackupProgress(event, 'backup:restoreFull', 'error', 'Invalid backup file', 100, 'Backup file does not contain Excel sheets to restore');
      return { success: false, error: 'Backup file does not contain any Excel sheets to restore' };
    }

    sendBackupProgress(event, 'backup:restoreFull', 'running', 'Merging Excel sheets', 55, 'Applying backup workbook data to the target file');
    const restoreWorkbook = fs.existsSync(resolvedTargetPath) ? XLSX.readFile(resolvedTargetPath) : XLSX.utils.book_new();
    const workbookMergeResult = mergeBackupWorkbookIntoTarget(backupWorkbook, restoreWorkbook);
    if (workbookMergeResult.changed) {
      sendBackupProgress(event, 'backup:restoreFull', 'running', 'Writing Excel workbook', 70, 'Saving restored workbook');
      XLSX.writeFile(restoreWorkbook, resolvedTargetPath);
    }

    sendBackupProgress(event, 'backup:restoreFull', 'running', 'Restoring database data', 85, 'Merging products, invoices, and settings');
    const dbResult = await barcodeDB.restoreBackupSnapshot(payload);
    writeShopConfig(payload.shopConfig);

    sendBackupProgress(
      event,
      'backup:restoreFull',
      'success',
      dbResult.alreadySynced ? 'Restore completed' : 'Restore completed',
      100,
      dbResult.alreadySynced ? 'Excel and database were already in sync' : 'Backup data restored into workbook and SQLite'
    );

    return {
      success: true,
      backupPath: resolvedBackupPath,
      targetFilePath: resolvedTargetPath,
      restoredSheets: workbookMergeResult.restoredSheets,
      restoredRows: workbookMergeResult.restoredRows,
      ...dbResult,
      alreadySynced: !workbookMergeResult.changed && dbResult.alreadySynced,
    };
  } catch (err) {
    sendBackupProgress(event, 'backup:restoreFull', 'error', 'Restore failed', 100, err.message);
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

ipcMain.handle('barcode:syncProduct', async (_, product) => {
  try { return await barcodeDB.syncProductRecord(product); }
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

ipcMain.handle('excel:syncProduct', async (_, { filePath, product, columnConfig, sheetName }) => {
  try {
    return excelHandler.syncProductRecord(filePath, product, columnConfig, sheetName);
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

ipcMain.handle('update:downloadAndInstall', async (_, { url, filename }) => {
  try {
    if (!url) {
      return { success: false, error: 'Missing update URL' };
    }

    const updateDir = path.join(app.getPath('downloads'), 'ScanVault Updates');
    fs.mkdirSync(updateDir, { recursive: true });

    let resolvedName = filename;
    if (!resolvedName) {
      try {
        resolvedName = path.basename(new URL(url).pathname) || 'ScanVault-Update.bin';
      } catch (_) {
        resolvedName = 'ScanVault-Update.bin';
      }
    }

    const targetPath = path.join(updateDir, resolvedName);
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok || !response.body) {
      throw new Error(`Download failed (${response.status})`);
    }

    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(targetPath));

    if (process.platform === 'win32' && targetPath.toLowerCase().endsWith('.exe')) {
      shell.showItemInFolder(targetPath);
      spawn(targetPath, [], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      setImmediate(() => app.quit());
      return { success: true, downloadedPath: targetPath, launched: true };
    }

    return { success: true, downloadedPath: targetPath, launched: false };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
